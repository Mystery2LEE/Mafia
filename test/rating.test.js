const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { calcMatch } = require('../server/rating/calc');
const { tierOf } = require('../server/rating/tiers');
const { startTestServer, waitFor, emitAck, sleep, harness } = require('./helpers');

// ---------- 순수 계산 / 티어 ----------
const P = (id, team, extra = {}) => ({
  id, role: team === 'mafia' ? 'mafia' : 'citizen', team, alive: true, left: false, executed: false,
  stats: { policeHits: 0, doctorSaves: 0 }, ...extra,
});
const delta = (calc, id) => calc.players.find((p) => p.id === id).delta;

test('티어 경계값', () => {
  const name = (r) => tierOf(r).name;
  assert.equal(name(0), '똘마니');
  assert.equal(name(1000), '똘마니'); // 가입 직후 점수
  assert.equal(name(1199), '똘마니');
  assert.equal(name(1200), '건달');
  assert.equal(name(1399), '건달');
  assert.equal(name(1400), '행동대장');
  assert.equal(name(1599), '행동대장');
  assert.equal(name(1600), '간부');
  assert.equal(name(1799), '간부');
  assert.equal(name(1800), '보스');
  assert.equal(name(1999), '보스');
  assert.equal(name(2000), '대부');
  assert.equal(name(9999), '대부');
});

test('계산: 승리 +25 / 패배 -15, 생존 +5, 경찰/의사 보너스', () => {
  const report = {
    winner: 'citizen',
    players: [
      P(1, 'citizen'), // 생존 시민: 25+5
      P(2, 'citizen', { alive: false }), // 사망 시민: 25
      P(3, 'citizen', { role: 'doctor', stats: { policeHits: 0, doctorSaves: 2 } }), // 25+5+10
      P(4, 'citizen', { role: 'police', stats: { policeHits: 1, doctorSaves: 0 } }), // 25+5+5
      P(5, 'mafia', { alive: false, executed: true }), // 패배 -15
      P(6, 'mafia'), // 패배 + 생존 → -15+5
    ],
  };
  const c = calcMatch(report);
  assert.equal(c.counted, true);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => delta(c, id)), [30, 25, 40, 35, -15, -10]);
});

test('계산: 마피아 승리 시 투표로 처형되지 않은 마피아만 +5', () => {
  const report = {
    winner: 'mafia',
    players: [
      P(1, 'mafia'), // 25 + 생존 5 + 미처형 5
      P(2, 'mafia', { alive: false, executed: false }), // 사망(마피아 킬 아님)이지만 투표 처형은 아님: 25 + 5
      P(3, 'mafia', { alive: false, executed: true }), // 처형됨: 25
      P(4, 'citizen'), // -15 + 5
      P(5, 'citizen', { alive: false }), // -15
    ],
  };
  const c = calcMatch(report);
  assert.deepEqual([1, 2, 3, 4, 5].map((id) => delta(c, id)), [35, 30, 25, -10, -15]);
});

test('계산: 이탈자는 패배 -15 + 추가 -10 = -25, 보너스 없음 (팀이 이겨도 동일)', () => {
  const report = {
    winner: 'citizen',
    players: [P(1, 'citizen'), P(2, 'citizen'), P(3, 'citizen', { left: true, alive: false }), P(4, 'mafia')],
  };
  const c = calcMatch(report);
  assert.equal(c.counted, true); // 4명 중 1명 이탈 → 반영
  assert.equal(delta(c, 3), -25);
  assert.equal(c.players.find((p) => p.id === 3).result, 'left');
});

test('어뷰징 방지: 이탈자가 절반을 넘으면 미반영(이탈자 패널티만 유지)', () => {
  const players = (n) => Array.from({ length: 6 }, (_, i) =>
    P(i + 1, i < 2 ? 'mafia' : 'citizen', i < n ? { left: true, alive: false } : {}));
  const half = calcMatch({ winner: 'mafia', players: players(3) }); // 6명 중 3명 = 절반 → 반영
  assert.equal(half.counted, true);
  const over = calcMatch({ winner: 'mafia', players: players(4) }); // 4명 > 절반 → 미반영
  assert.equal(over.counted, false);
  assert.equal(over.reason, 'too_many_leavers');
  assert.equal(delta(over, 1), -25); // 이탈자
  assert.equal(delta(over, 5), 0); // 남은 사람은 변화 없음
});

test('어뷰징 방지: 4명 미만 게임은 미반영', () => {
  const c = calcMatch({ winner: 'citizen', players: [P(1, 'citizen'), P(2, 'citizen'), P(3, 'mafia')] });
  assert.equal(c.counted, false);
  assert.equal(c.reason, 'too_few_players');
  assert.deepEqual(c.players.map((p) => p.delta), [0, 0, 0]);
});

// ---------- DB / 서버 통합 ----------
let srv;
let h;
const sockets = [];
before(async () => {
  srv = await startTestServer({
    limits: { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 } },
  });
  h = harness(srv, sockets, { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 });
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

const rowsOf = (matchId) =>
  srv.db.raw.prepare('SELECT * FROM match_players WHERE match_id = ?').all(matchId);
const lastMatch = () => srv.db.raw.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT 1').get();
const ratingOf = (p) => srv.db.users.findById(p.user.id).rating;
const byRole = (ps, r) => ps.filter((p) => p.role === r);

test('트랜잭션: 레이팅 하한 0 적용, rating_delta 는 실제 변화량', () => {
  const u = srv.db.users.create({ username: 'floorusr', passwordHash: 'x', nickname: '하한' }).user;
  srv.db.raw.prepare('UPDATE users SET rating = 10 WHERE id = ?').run(u.id);
  const { changes } = srv.db.matches.recordMatch({
    roomTitle: 't', winnerTeam: 'mafia', counted: true,
    players: [{ userId: u.id, role: 'citizen', team: 'citizen', survived: false, result: 'lose', delta: -25, leftEarly: true }],
  });
  assert.deepEqual(changes[0], { userId: u.id, before: 10, after: 0, delta: -10 });
  assert.equal(srv.db.users.findById(u.id).rating, 0);
  const row = srv.db.raw.prepare('SELECT * FROM match_players WHERE user_id = ?').get(u.id);
  assert.equal(row.rating_delta, -10);
  assert.equal(row.left_early, 1);
});

test('트랜잭션: 중간에 실패하면 경기/점수 전부 롤백', () => {
  const u = srv.db.users.create({ username: 'rollbk01', passwordHash: 'x', nickname: '롤백' }).user;
  const matchesBefore = srv.db.raw.prepare('SELECT COUNT(*) c FROM matches').get().c;
  assert.throws(() => srv.db.matches.recordMatch({
    roomTitle: 't', winnerTeam: 'mafia', counted: true,
    players: [
      { userId: u.id, role: 'citizen', team: 'citizen', survived: true, result: 'win', delta: 30, leftEarly: false },
      { userId: 999999, role: 'mafia', team: 'mafia', survived: true, result: 'lose', delta: -15, leftEarly: false },
    ],
  }));
  assert.equal(srv.db.raw.prepare('SELECT COUNT(*) c FROM matches').get().c, matchesBefore);
  assert.equal(srv.db.users.findById(u.id).rating, 1000); // 앞 사람의 점수도 반영되지 않음
});

test('게임 종료 → match 기록과 rating_delta 가 규칙대로 저장되고 본인에게만 통지된다', async () => {
  const { game, ps } = await h.startedRoom(6);
  const doctor = byRole(ps, 'doctor')[0];
  const police = byRole(ps, 'police')[0];
  const mafia = byRole(ps, 'mafia');
  const citizens = byRole(ps, 'citizen');
  game.players.get(doctor.user.id).stats.doctorSaves = 1;
  game.players.get(police.user.id).stats.policeHits = 2;
  game._kill(citizens[0].user.id, 'mafia'); // 사망 시민
  game.players.get(mafia[0].user.id).alive = false; // 처형된 마피아
  game.players.get(mafia[0].user.id).executed = true;

  const got = waitFor(police.socket, 'game:rating');
  game._endGame('citizen');
  const mine = await got;
  await sleep(60);

  const m = lastMatch();
  assert.equal(m.winner_team, 'citizen');
  assert.equal(m.room_title, '게임방');
  const rows = Object.fromEntries(rowsOf(m.id).map((r) => [r.user_id, r]));
  const expect = [
    [police, 25 + 5 + 10], // 승리 + 생존 + 조사 성공 2회
    [doctor, 25 + 5 + 5], // 승리 + 생존 + 세이브 1회
    [citizens[0], 25], // 승리, 사망
    [citizens[1], 25 + 5],
    [mafia[0], -15], // 패배, 사망
    [mafia[1], -15 + 5], // 패배 + 생존
  ];
  for (const [p, d] of expect) {
    assert.equal(rows[p.user.id].rating_delta, d, `${p.role} delta`);
    assert.equal(ratingOf(p), 1000 + d, `${p.role} rating`);
    assert.equal(rows[p.user.id].rating_counted, 1);
  }
  assert.equal(rows[police.user.id].result, 'win');
  assert.equal(rows[mafia[0].user.id].result, 'lose');
  assert.equal(rows[citizens[0].user.id].survived, 0);
  assert.equal(rowsOf(m.id).length, 6);

  // 본인에게 온 통지: 변화량/티어/세부 내역
  assert.equal(mine.before, 1000);
  assert.equal(mine.after, 1040);
  assert.equal(mine.delta, 40);
  assert.equal(mine.tierBefore.name, '똘마니');
  assert.equal(mine.tierAfter.name, '똘마니');
  assert.deepEqual(mine.breakdown.map((b) => b.key), ['win', 'survived', 'policeHit']);
  // 다른 사람의 점수 정보는 오지 않는다
  assert.equal(police.socket.events.filter((e) => e.event === 'game:rating').length, 1);
});

test('마피아 승리: 투표로 처형되지 않은 마피아 +5 / 이탈자 -25', async () => {
  const { roomId, game, ps } = await h.startedRoom(4);
  const mafia = byRole(ps, 'mafia')[0];
  const leaver = byRole(ps, 'citizen')[0];
  await emitAck(leaver.socket, 'room:leave'); // 실제 이탈 (사망 처리)
  await sleep(40);
  assert.equal(game.status, 'playing'); // 마피아 1 vs 시민팀 2 → 계속
  game._endGame('mafia');
  await sleep(60);

  const m = lastMatch();
  const rows = Object.fromEntries(rowsOf(m.id).map((r) => [r.user_id, r]));
  assert.equal(rows[mafia.user.id].rating_delta, 25 + 5 + 5);
  assert.equal(rows[leaver.user.id].rating_delta, -25);
  assert.equal(rows[leaver.user.id].left_early, 1);
  assert.equal(rows[leaver.user.id].result, 'left');
  assert.equal(ratingOf(leaver), 975);
  const others = ps.filter((p) => p !== mafia && p !== leaver);
  for (const o of others) assert.equal(rows[o.user.id].rating_delta, -15 + 5);
  assert.equal(srv.rooms.get(roomId).players.size, 3); // 이탈자는 방에서 정리됨
});

test('이탈자가 절반을 넘는 게임은 랭킹 미반영 (이탈자 패널티만)', async () => {
  const { game, ps } = await h.startedRoom(4);
  const stay = ps[0];
  for (const p of ps.slice(1)) game.players.get(p.user.id).left = true; // 3/4 이탈
  game._endGame('mafia');
  await sleep(60);
  const m = lastMatch();
  const rows = Object.fromEntries(rowsOf(m.id).map((r) => [r.user_id, r]));
  assert.equal(rows[stay.user.id].rating_delta, 0);
  assert.equal(rows[stay.user.id].rating_counted, 0);
  assert.equal(ratingOf(stay), 1000);
  for (const p of ps.slice(1)) {
    assert.equal(rows[p.user.id].rating_delta, -25);
    assert.equal(rows[p.user.id].rating_counted, 0);
  }
  const msg = await waitFor(stay.socket, 'game:rating');
  assert.equal(msg.counted, false);
  assert.equal(msg.reason, 'too_many_leavers');
  assert.equal(msg.delta, 0);
});

test('랭킹/프로필 API: 로그인 필요, 상위 50, 승률/직업별/최근 10경기', async () => {
  assert.equal((await fetch(`${srv.url}/api/ranking`)).status, 401);
  assert.equal((await fetch(`${srv.url}/api/profile`)).status, 401);

  // 한 유저가 여러 판을 하도록 직접 기록 (12경기)
  const { newUser } = require('./helpers');
  const u = await newUser(srv.url, 'rk');
  const other = await newUser(srv.url, 'rk');
  for (let i = 0; i < 12; i++) {
    const win = i % 3 !== 0; // 8승 4패
    srv.db.matches.recordMatch({
      roomTitle: `r${i}`, winnerTeam: win ? 'citizen' : 'mafia', counted: true,
      players: [
        { userId: u.user.id, role: i % 2 ? 'police' : 'citizen', team: 'citizen', survived: true, result: win ? 'win' : 'lose', delta: win ? 30 : -10, leftEarly: false },
        { userId: other.user.id, role: 'mafia', team: 'mafia', survived: true, result: win ? 'lose' : 'win', delta: 0, leftEarly: false },
      ],
    });
  }
  const rk = await (await fetch(`${srv.url}/api/ranking`, { headers: { cookie: u.cookie } })).json();
  assert.ok(rk.players.length <= 50);
  for (let i = 1; i < rk.players.length; i++) assert.ok(rk.players[i - 1].rating >= rk.players[i].rating);
  const mine = rk.players.find((p) => p.id === u.user.id);
  assert.equal(mine.games, 12);
  assert.equal(mine.wins, 8);
  assert.equal(mine.winRate, 66.7);
  assert.equal(mine.isMe, true);
  assert.ok(mine.tier.name);

  const pf = await (await fetch(`${srv.url}/api/profile`, { headers: { cookie: u.cookie } })).json();
  assert.equal(pf.user.nickname, u.user.nickname);
  assert.equal(pf.user.rating, 1000 + 8 * 30 - 4 * 10);
  assert.equal(pf.user.tier.name, '건달'); // 1200점 (건달 시작선)
  assert.equal(pf.totals.games, 12);
  assert.equal(pf.recent.length, 10);
  assert.equal(pf.recent[0].roomTitle, 'r11'); // 최신 경기 순
  const police = pf.byRole.find((r) => r.role === 'police');
  const citizen = pf.byRole.find((r) => r.role === 'citizen');
  assert.equal(police.games + citizen.games, 12);
  assert.equal(JSON.stringify(pf).includes('password'), false);
});
