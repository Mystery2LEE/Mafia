// 규칙 옵션: 첫날 낮(투표 없음), 방별 마피아 수 설정, 직접 정한 판의 랭킹 미반영
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { roleCounts, defaultMafia, maxMafia } = require('../server/config/game');
const { calcMatch } = require('../server/rating/calc');
const { startTestServer, waitFor, emitAck, sleep, harness } = require('./helpers');

const LIMITS = { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 } };
const LONG = { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 };

let srv;
let h;
const sockets = [];
before(async () => {
  srv = await startTestServer({ limits: LIMITS });
  h = harness(srv, sockets, LONG);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

const force = (game, phase) => game._enter(phase, 1000);
const byRole = (ps, role) => ps.filter((p) => p.role === role);
const sysTexts = (p) => p.socket.events
  .filter((e) => e.event === 'chat:message' && e.payload.channel === 'system').map((e) => e.payload.text);
const lastMatch = () => srv.db.raw.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT 1').get();
const rowsOf = (id) => srv.db.raw.prepare('SELECT * FROM match_players WHERE match_id = ?').all(id);

// ---------- 첫날: 낮 토론부터, 투표 없음 ----------
test('첫날은 낮 토론 → 바로 밤 (투표 단계 없음), 둘째 날부터 투표', async () => {
  const { game, ps } = await h.startedRoom(4);
  const sock = ps[0].socket;
  await waitFor(sock, 'phase:change', (p) => p.phase === 'discussion' && p.day === 1);

  // 첫날 토론 중에는 투표할 수 없다
  const v = await emitAck(ps[1].socket, 'vote:cast', { targetId: ps[2].user.id });
  assert.equal(v.error, 'wrong_phase');
  // 첫날 낮에는 아무도 죽지 않는다 (밤이 오기 전이므로 능력도 쓸 수 없다)
  assert.equal(game._aliveCount(), 4);
  const early = await emitAck(byRole(ps, 'mafia')[0].socket, 'night:action', { targetId: ps[1].user.id });
  assert.equal(early.error, 'wrong_phase');

  game._advance(); // 첫날 토론 종료
  assert.equal(game.phase, 'night');
  assert.equal(game.day, 1);
  assert.equal(sock.events.filter((e) => e.event === 'phase:change' && e.payload.phase === 'vote').length, 0);
  // 첫날 안내 메시지
  assert.ok(sysTexts(ps[0]).some((t) => t.includes('첫날') && t.includes('투표는 없습니다')));

  game._advance(); // 밤 → 아침
  game._advance(); // 아침 → 둘째 날 토론
  assert.equal(game.phase, 'discussion');
  assert.equal(game.day, 2);
  game._advance(); // 둘째 날부터는 투표
  assert.equal(game.phase, 'vote');
  assert.equal((await emitAck(ps[1].socket, 'vote:cast', { targetId: ps[2].user.id })).ok, true);
});

test('설정(firstDayVote=true)이면 첫날에도 투표한다', async () => {
  const own = [];
  const s2 = await startTestServer({ limits: { ...LIMITS, firstDayVote: true } });
  try {
    const h2 = harness(s2, own, LONG);
    const { game, ps } = await h2.startedRoom(4);
    await waitFor(ps[0].socket, 'phase:change', (p) => p.phase === 'discussion' && p.day === 1);
    game._advance();
    assert.equal(game.phase, 'vote');
  } finally {
    own.forEach((s) => s.close());
    await s2.close();
  }
});

// ---------- 마피아 수 설정 ----------
test('마피아 수 규칙: 기본값과 상한(인원÷3, 최소 1)', () => {
  assert.deepEqual([4, 5, 6, 8, 9, 12].map(defaultMafia), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11, 12].map(maxMafia), [1, 1, 2, 2, 2, 3, 3, 3, 4]);
  assert.deepEqual(roleCounts(12, 4), { mafia: 4, police: 1, doctor: 1, citizen: 6 });
  assert.deepEqual(roleCounts(8), { mafia: 2, police: 1, doctor: 1, citizen: 4 }); // 기본값
  // 어떤 인원에서도 상한 이하면 시민 팀이 마피아보다 많다
  for (let n = 4; n <= 12; n++) {
    const m = maxMafia(n);
    const c = roleCounts(n, m);
    assert.equal(c.mafia + c.police + c.doctor + c.citizen, n);
    assert.ok(c.citizen >= 1 && n - m > m, `${n}명 마피아 ${m}명`);
  }
});

test('방 생성 검증: 마피아 수는 1 ~ 최대인원÷3 정수', async () => {
  const tryCreate = async (maxPlayers, mafiaCount) => {
    const p = await h.player('mf');
    const r = await emitAck(p.socket, 'room:create', { title: 'm', maxPlayers, mafiaCount });
    await emitAck(p.socket, 'room:leave');
    return r;
  };
  assert.equal((await tryCreate(12, 4)).ok, true);
  assert.equal((await tryCreate(12, 5)).error, 'invalid_mafia_count');
  assert.equal((await tryCreate(4, 1)).ok, true);
  assert.equal((await tryCreate(4, 2)).error, 'invalid_mafia_count');
  assert.equal((await tryCreate(8, 0)).error, 'invalid_mafia_count');
  assert.equal((await tryCreate(8, 1.5)).error, 'invalid_mafia_count');
  assert.equal((await tryCreate(8, '2')).error, 'invalid_mafia_count');
  assert.equal((await tryCreate(8, undefined)).ok, true); // 비우면 기본
  assert.equal((await tryCreate(8, null)).ok, true);
});

test('설정한 마피아 수대로 직업이 배분되고, 방 목록에 설정이 보인다', async () => {
  const { roomId, game, ps } = await h.makeRoom(8, { mafiaCount: 1 });
  const { rooms } = await emitAck(ps[0].socket, 'lobby:list');
  assert.equal(rooms.find((r) => r.id === roomId).mafiaCount, 1);

  assert.equal((await emitAck(ps[0].socket, 'game:start')).ok, true);
  for (const p of ps) p.role = (await waitFor(p.socket, 'role:assigned')).role;
  const n = (r) => byRole(ps, r).length;
  assert.deepEqual([n('mafia'), n('police'), n('doctor'), n('citizen')], [1, 1, 1, 5]);
  assert.equal(game.customRules, true);
  assert.equal(game.stateFor(ps[0].user.id).customRules, true);
  await sleep(60);
  assert.ok(sysTexts(ps[0]).some((t) => t.includes('랭킹에 반영되지 않습니다')));
});

test('12명 + 마피아 4명 (상한)', async () => {
  const { ps } = await h.startedRoom(12, { mafiaCount: 4 });
  const n = (r) => byRole(ps, r).length;
  assert.deepEqual([n('mafia'), n('police'), n('doctor'), n('citizen')], [4, 1, 1, 6]);
  // 마피아 4명 모두 동료 목록을 안다
  for (const m of byRole(ps, 'mafia')) assert.equal(m.assigned.mafiaTeam.length, 4);
});

test('기본값과 같은 마피아 수를 골랐다면 직접 정한 판이 아니다 (랭킹 반영)', async () => {
  const { game, ps } = await h.startedRoom(6, { mafiaCount: 2 });
  assert.equal(game.customRules, false);
  assert.equal(byRole(ps, 'mafia').length, 2);
  await sleep(60);
  assert.equal(sysTexts(ps[0]).some((t) => t.includes('랭킹에 반영되지 않습니다')), false);
});

test('실제 인원이 적으면 상한에 맞춰 줄이고 안내한다 (줄인 값이 기본이면 랭킹 반영)', async () => {
  // 최대 12명 방에서 마피아 4명으로 설정했지만 6명만 모여 시작 → 상한 2명
  const { game, ps } = await h.startedRoom(6, { maxPlayers: 12, mafiaCount: 4 });
  assert.equal(byRole(ps, 'mafia').length, 2);
  assert.equal(game.customRules, false);
  await sleep(60);
  assert.ok(sysTexts(ps[0]).some((t) => t.includes('마피아 수를 2명으로 조정')));
});

// ---------- 직접 정한 판은 랭킹 미반영 ----------
test('계산: custom_rules 이면 미반영, 이탈자 패널티만 유지', () => {
  const P = (id, team, left = false) => ({
    id, role: team === 'mafia' ? 'mafia' : 'citizen', team, alive: !left, left, executed: false,
    stats: { policeHits: 0, doctorSaves: 0 },
  });
  const c = calcMatch({
    winner: 'citizen', customRules: true,
    players: [P(1, 'citizen'), P(2, 'citizen'), P(3, 'citizen'), P(4, 'mafia'), P(5, 'citizen', true)],
  });
  assert.equal(c.counted, false);
  assert.equal(c.reason, 'custom_rules');
  assert.deepEqual(c.players.map((p) => p.delta), [0, 0, 0, 0, -25]);
  // 기본 규칙이면 같은 판이 정상 반영된다
  assert.equal(calcMatch({ winner: 'citizen', customRules: false, players: [P(1, 'citizen'), P(2, 'citizen'), P(3, 'citizen'), P(4, 'mafia')] }).counted, true);
});

test('직접 정한 판이 끝나면 랭킹 미반영으로 기록된다 (레이팅 변화 없음, 이탈자만 -25)', async () => {
  const { game, ps } = await h.startedRoom(8, { mafiaCount: 1 });
  const leaver = byRole(ps, 'citizen')[0];
  const stay = byRole(ps, 'citizen')[1];
  await emitAck(leaver.socket, 'room:leave');
  await sleep(40);
  assert.equal(game.status, 'playing');

  const got = waitFor(stay.socket, 'game:rating');
  game._endGame('citizen');
  const msg = await got;
  await sleep(60);

  assert.equal(msg.counted, false);
  assert.equal(msg.reason, 'custom_rules');
  assert.equal(msg.delta, 0);
  const rows = Object.fromEntries(rowsOf(lastMatch().id).map((r) => [r.user_id, r]));
  for (const p of ps.filter((x) => x !== leaver)) {
    assert.equal(rows[p.user.id].rating_counted, 0);
    assert.equal(rows[p.user.id].rating_delta, 0);
    assert.equal(srv.db.users.findById(p.user.id).rating, 1000);
  }
  assert.equal(rows[leaver.user.id].rating_delta, -25);
  assert.equal(rows[leaver.user.id].left_early, 1);
  assert.equal(rows[leaver.user.id].rating_counted, 0);
  // 미반영 판은 랭킹의 전적(승/패 수)에도 집계되지 않는다
  assert.equal(srv.db.matches.totals(stay.user.id).games, 0);
  // 다음 판은 설정이 유지되지만 customRules 는 판마다 다시 계산된다
  assert.equal(game.customRules, false);
});
