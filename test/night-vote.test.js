const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, waitFor, clearEvents, emitAck, sleep, harness } = require('./helpers');

let srv;
let h;
const sockets = [];
const LONG = { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 };

before(async () => {
  srv = await startTestServer({
    limits: { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 } },
  });
  h = harness(srv, sockets, LONG);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

const force = (game, phase) => game._enter(phase, 1000);
const byRole = (ps, role) => ps.filter((p) => p.role === role);
const nonMafia = (ps) => ps.filter((p) => p.role !== 'mafia');
const night = (p, target) => emitAck(p.socket, 'night:action', { targetId: target.user.id });
const vote = (p, target) => emitAck(p.socket, 'vote:cast', { targetId: target ? target.user.id : null });
const verdict = (p, agree) => emitAck(p.socket, 'verdict:cast', { agree });
const events = (p, name) => p.socket.events.filter((e) => e.event === name).map((e) => e.payload);
const rec = (game, p) => game.players.get(p.user.id);

test('마피아 킬: 아침에 사망 발표(직업 비공개), 사망자는 dead 채널로', async () => {
  const { game, ps } = await h.startedRoom(6);
  const mafia = byRole(ps, 'mafia');
  const victim = byRole(ps, 'citizen')[0];
  force(game, 'night');
  clearEvents(ps[0].socket);
  assert.equal((await night(mafia[0], victim)).ok, true);
  assert.equal((await night(mafia[1], victim)).ok, true);
  game._advance(); // 밤 종료 → 아침
  await sleep(60);
  assert.equal(rec(game, victim).alive, false);
  assert.equal(game.phase, 'morning');
  const killed = events(ps[0], 'player:killed');
  assert.equal(killed.length, 1);
  assert.equal(killed[0].id, victim.user.id);
  assert.equal(killed[0].cause, 'mafia');
  assert.equal(killed[0].role, undefined); // 마피아 킬은 직업 비공개
  // 본인 직업(room:state, role:assigned)을 제외한 공개 이벤트에는 직업 정보가 없다
  const publicEvents = ps[0].socket.events.filter((e) => !['room:state', 'role:assigned'].includes(e.event));
  assert.equal(JSON.stringify(publicEvents).includes('"role"'), false);
  assert.ok((await srv.io.in(`room:${game.id}:chat:dead`).fetchSockets()).some((s) => s.data.user.id === victim.user.id));
});

test('의사가 살리면 사망자 없음 + "누군가 살아남았습니다"', async () => {
  const { game, ps } = await h.startedRoom(6);
  const [mafia] = byRole(ps, 'mafia');
  const [doctor] = byRole(ps, 'doctor');
  const victim = byRole(ps, 'citizen')[0];
  force(game, 'night');
  clearEvents(ps[0].socket);
  await night(mafia, victim);
  await night(byRole(ps, 'mafia')[1], victim);
  await night(doctor, victim);
  game._advance();
  await sleep(60);
  assert.equal(game._aliveCount(), 6);
  assert.equal(events(ps[0], 'player:killed').length, 0);
  assert.equal(events(ps[0], 'night:saved').length, 1);
  const sys = events(ps[0], 'chat:message').filter((m) => m.channel === 'system').map((m) => m.text);
  assert.ok(sys.includes('누군가 살아남았습니다.'));
  assert.equal(rec(game, doctor).stats.doctorSaves, 1);
});

test('의사가 다른 사람을 보호하면 킬은 그대로 성공', async () => {
  const { game, ps } = await h.startedRoom(6);
  const victim = byRole(ps, 'citizen')[0];
  const other = byRole(ps, 'citizen')[1];
  force(game, 'night');
  for (const m of byRole(ps, 'mafia')) await night(m, victim);
  await night(byRole(ps, 'doctor')[0], other);
  game._advance();
  assert.equal(rec(game, victim).alive, false);
  assert.equal(rec(game, other).alive, true);
});

test('의사 자기 보호: 기본 허용, 방 설정으로 금지 가능', async () => {
  const a = await h.startedRoom(6);
  force(a.game, 'night');
  const doc = byRole(a.ps, 'doctor')[0];
  assert.equal((await night(doc, doc)).ok, true);
  // 자기 보호로 살아남는 시나리오
  for (const m of byRole(a.ps, 'mafia')) await night(m, doc);
  a.game._advance();
  assert.equal(rec(a.game, doc).alive, true);

  const b = await h.startedRoom(6, { doctorSelfProtect: false });
  force(b.game, 'night');
  const doc2 = byRole(b.ps, 'doctor')[0];
  assert.equal((await night(doc2, doc2)).error, 'invalid_target');
  assert.equal((await night(doc2, byRole(b.ps, 'citizen')[0])).ok, true);
});

test('밤 능력 검증: 단계/직업/대상/생존 여부', async () => {
  const { game, ps } = await h.startedRoom(6);
  const [m1, m2] = byRole(ps, 'mafia');
  const [police] = byRole(ps, 'police');
  const [citizen, citizen2] = byRole(ps, 'citizen');

  force(game, 'discussion');
  assert.equal((await night(m1, citizen)).error, 'wrong_phase');
  force(game, 'night');
  assert.equal((await night(citizen, citizen2)).error, 'no_ability'); // 시민은 능력 없음
  assert.equal((await night(m1, m2)).error, 'invalid_target'); // 동료 지목 불가
  assert.equal((await night(police, police)).error, 'invalid_target'); // 자기 조사 불가
  assert.equal((await emitAck(m1.socket, 'night:action', { targetId: 'abc' })).error, 'invalid_target');
  assert.equal((await emitAck(m1.socket, 'night:action', { targetId: 99999 })).error, 'invalid_target');

  game._kill(citizen2.user.id, 'mafia'); // 사망자는 지목 대상이 될 수 없고, 능력도 쓸 수 없다
  assert.equal((await night(m1, citizen2)).error, 'invalid_target');
  game._kill(police.user.id, 'mafia');
  assert.equal((await night(police, m1)).error, 'forbidden');
});

test('마피아 다수결: 2:1 이면 다수 대상이 죽는다', async () => {
  const { game, ps } = await h.startedRoom(9); // 마피아 3명
  const mafia = byRole(ps, 'mafia');
  const [a, b] = byRole(ps, 'citizen');
  force(game, 'night');
  await night(mafia[0], a);
  await night(mafia[1], a);
  await night(mafia[2], b);
  game._advance();
  assert.equal(rec(game, a).alive, false);
  assert.equal(rec(game, b).alive, true);
});

test('마피아 동률(1:1): 둘 중 정확히 한 명만 죽는다 / 지목 없으면 킬 없음', async () => {
  const { game, ps } = await h.startedRoom(6);
  const mafia = byRole(ps, 'mafia');
  const [a, b] = byRole(ps, 'citizen');
  force(game, 'night');
  await night(mafia[0], a);
  await night(mafia[1], b);
  game._advance();
  assert.equal([a, b].filter((p) => !rec(game, p).alive).length, 1);
  assert.equal(game._aliveCount(), 5);

  game._startNight(); // 아무도 지목하지 않은 새 밤
  clearEvents(ps[0].socket);
  game._advance();
  await sleep(40);
  assert.equal(game._aliveCount(), 5);
  assert.ok(events(ps[0], 'chat:message').some((m) => m.text === '평화로운 밤이었습니다.'));
});

test('마지막 선택이 유효: 마피아가 지목을 바꾸면 바뀐 대상이 죽는다', async () => {
  const { game, ps } = await h.startedRoom(4);
  const mafia = byRole(ps, 'mafia')[0];
  const [a, b] = nonMafia(ps).filter((p) => p.role === 'citizen' || p.role === 'doctor');
  force(game, 'night');
  await night(mafia, a);
  await night(mafia, b);
  game._advance();
  assert.equal(rec(game, a).alive, true);
  assert.equal(rec(game, b).alive, false);
});

test('경찰 조사: 결과는 밤이 끝날 때 경찰에게만 전달된다', async () => {
  const { game, ps } = await h.startedRoom(6);
  const [police] = byRole(ps, 'police');
  const [mafia] = byRole(ps, 'mafia');
  force(game, 'night');
  clearEvents(police.socket);
  assert.equal((await night(police, mafia)).ok, true);
  await sleep(40);
  assert.equal(events(police, 'police:result').length, 0); // 밤 도중에는 아직 없음
  game._advance();
  const res = await waitFor(police.socket, 'police:result');
  assert.deepEqual(res, { targetId: mafia.user.id, isMafia: true });
  await sleep(40);
  for (const p of ps.filter((x) => x !== police)) assert.equal(events(p, 'police:result').length, 0);
  assert.equal(rec(game, police).stats.policeHits, 1);

  // 시민 조사 → 마피아 아님. 재접속용 상태에는 누적 기록이 있다
  game._startNight();
  const citizen = byRole(ps, 'citizen')[0];
  await night(police, citizen);
  game._advance();
  const res2 = await waitFor(police.socket, 'police:result', (r) => r.targetId === citizen.user.id);
  assert.equal(res2.isMafia, false);
  assert.equal(game.stateFor(police.user.id).you.policeLog.length, 2);
  assert.equal(game.stateFor(citizen.user.id).you.policeLog, undefined);
});

test('낮 투표: 집계는 익명, 최다 득표자가 최후 변론 대상이 된다', async () => {
  const { game, ps } = await h.startedRoom(6);
  force(game, 'discussion');
  game._advance(); // → vote
  assert.equal(game.phase, 'vote');
  const target = ps[2];
  clearEvents(ps[0].socket);
  assert.equal((await vote(ps[0], target)).ok, true);
  assert.equal((await vote(ps[1], target)).ok, true);
  assert.equal((await vote(ps[3], ps[4])).ok, true);
  await sleep(50);
  const last = events(ps[0], 'vote:update').at(-1);
  assert.deepEqual(last.tally, { [target.user.id]: 2, [ps[4].user.id]: 1 });
  assert.equal(JSON.stringify(last).includes('voter'), false);
  // 투표 변경/취소
  assert.equal((await vote(ps[3], null)).ok, true);
  assert.equal((await vote(ps[3], target)).ok, true);
  assert.equal(game.stateFor(ps[3].user.id).you.vote, target.user.id);
  game._advance(); // 투표 종료 → 변론
  assert.equal(game.phase, 'defense');
  assert.equal(game.defendantId, target.user.id);
  assert.equal(game.stateFor(ps[5].user.id).defendantId, target.user.id);
});

test('투표 동률/무투표면 처형 없이 밤으로', async () => {
  const a = await h.startedRoom(6);
  force(a.game, 'discussion');
  a.game._advance();
  clearEvents(a.ps[2].socket);
  await vote(a.ps[0], a.ps[1]);
  await vote(a.ps[1], a.ps[0]);
  a.game._advance();
  assert.equal(a.game.phase, 'night');
  assert.equal(a.game.defendantId, null);
  await sleep(60);
  // 동점이면 "동점이라 이번 투표는 넘어간다"는 것과 누가 몇 표인지를 모두에게 알린다
  const tie = events(a.ps[2], 'vote:result')[0];
  assert.equal(tie.defendantId, null);
  assert.equal(tie.reason, 'tie');
  assert.deepEqual(tie.tied.map((t) => [t.id, t.nickname, t.votes]).sort(),
    [a.ps[0], a.ps[1]].map((p) => [p.user.id, p.user.nickname, 1]).sort());
  const tieMsg = events(a.ps[2], 'chat:message').find((m) => m.channel === 'system' && m.text.includes('동점'));
  assert.ok(tieMsg, '동점 시스템 메시지');
  assert.ok(tieMsg.text.includes('넘어가') && tieMsg.text.includes(a.ps[0].user.nickname));

  const b = await h.startedRoom(6);
  force(b.game, 'discussion');
  b.game._advance();
  clearEvents(b.ps[0].socket);
  b.game._advance();
  assert.equal(b.game.phase, 'night');
  await sleep(60);
  // 아무도 투표하지 않았다면 동점이 아니라 "투표 없음"으로 구분해서 알린다
  const none = events(b.ps[0], 'vote:result')[0];
  assert.equal(none.reason, 'no_votes');
  assert.equal(none.tied, undefined);
  assert.ok(events(b.ps[0], 'chat:message').some((m) => m.channel === 'system' && m.text.includes('투표한 사람이 없어')));
});

test('투표 결과: 단독 최다 득표면 reason 이 없다 (변론으로 진행)', async () => {
  const { game, ps } = await h.startedRoom(6);
  force(game, 'discussion');
  game._advance();
  clearEvents(ps[0].socket);
  await vote(ps[0], ps[3]);
  await vote(ps[1], ps[3]);
  game._advance();
  await sleep(60);
  const res = events(ps[0], 'vote:result')[0];
  assert.equal(res.defendantId, ps[3].user.id);
  assert.equal(res.reason, null);
  assert.equal(game.phase, 'defense');
});

test('투표 단계: 사망자/밤/토론 중 투표 불가, 모두 투표하면 조기 종료', async () => {
  const { game, ps } = await h.startedRoom(4);
  force(game, 'discussion');
  assert.equal((await vote(ps[0], ps[1])).error, 'wrong_phase');
  game._advance();
  const dead = ps[3];
  game._kill(dead.user.id, 'mafia');
  assert.equal((await vote(dead, ps[0])).error, 'forbidden');
  assert.equal((await vote(ps[0], dead)).error, 'invalid_target'); // 사망자를 지목할 수 없다
  await vote(ps[0], ps[1]);
  await vote(ps[1], ps[2]);
  assert.equal(game.phase, 'vote');
  await vote(ps[2], ps[1]); // 생존자 3명 전원 투표 → 즉시 종료
  assert.equal(game.phase, 'defense');
  assert.equal(game.defendantId, ps[1].user.id);
});

test('찬반 투표: 과반 찬성이면 처형(직업 공개), 아니면 생존. 지목자 본인은 투표 불가', async () => {
  const { game, ps } = await h.startedRoom(6);
  const defendant = byRole(ps, 'citizen')[0];
  const voters = ps.filter((p) => p !== defendant);

  force(game, 'discussion');
  game._advance();
  for (const p of ps) await vote(p, defendant);
  assert.equal(game.phase, 'defense');
  game._advance(); // → verdict
  assert.equal(game.phase, 'verdict');
  assert.equal((await verdict(defendant, false)).error, 'forbidden');
  assert.equal((await emitAck(voters[0].socket, 'verdict:cast', { agree: 'yes' })).error, 'invalid_vote');

  // 5명 중 찬성 2 / 반대 1 / 기권 2 → 과반(>2.5) 아님 → 생존
  await verdict(voters[0], true);
  await verdict(voters[1], true);
  await verdict(voters[2], false);
  assert.equal(game.phase, 'verdict');
  game._advance();
  assert.equal(rec(game, defendant).alive, true);
  assert.equal(game.phase, 'night');

  // 다른 라운드: 찬성 3/5 → 처형
  const d2 = byRole(ps, 'police')[0];
  force(game, 'discussion');
  game._advance();
  for (const p of ps) await vote(p, d2);
  game._advance(); // → verdict
  clearEvents(ps[0].socket);
  const v2 = ps.filter((p) => p !== d2);
  for (const p of v2.slice(0, 3)) await verdict(p, true);
  game._advance();
  assert.equal(game.phase, 'execution');
  assert.equal(rec(game, d2).alive, false);
  await sleep(50);
  const killed = events(ps[0], 'player:killed')[0];
  assert.deepEqual({ id: killed.id, cause: killed.cause, role: killed.role }, { id: d2.user.id, cause: 'vote', role: 'police' });
  assert.equal(events(ps[0], 'verdict:result')[0].executed, true);
});

test('찬반 투표는 지목자를 뺀 전원이 투표하면 조기 종료', async () => {
  const { game, ps } = await h.startedRoom(4);
  const d = ps[0];
  force(game, 'discussion');
  game._advance();
  for (const p of ps) await vote(p, d);
  game._advance();
  const others = ps.slice(1);
  await verdict(others[0], true);
  await verdict(others[1], true);
  assert.equal(game.phase, 'verdict');
  await verdict(others[2], false);
  assert.equal(game.phase, 'execution'); // 2/3 찬성 → 처형, 조기 종료
});

test('시민 승리: 투표로 마피아를 모두 처형 (실제 흐름)', async () => {
  const { game, ps } = await h.startedRoom(4);
  const mafia = byRole(ps, 'mafia')[0];
  force(game, 'discussion');
  game._advance();
  for (const p of ps) await vote(p, p === mafia ? byRole(ps, 'citizen')[0] : mafia);
  assert.equal(game.phase, 'defense');
  game._advance();
  for (const p of ps.filter((x) => x !== mafia)) await verdict(p, true);
  assert.equal(game.phase, 'execution');
  clearEvents(ps[1].socket);
  game._advance(); // 처형 연출 종료 → 승리 판정
  const over = await waitFor(ps[1].socket, 'game:over');
  assert.equal(over.winner, 'citizen');
  assert.equal(over.roles.find((r) => r.id === mafia.user.id).role, 'mafia');
  assert.equal(game.status, 'waiting');
});

test('마피아 승리: 밤마다 제거해 마피아 수 ≥ 시민 팀 수 (실제 흐름)', async () => {
  const { game, ps } = await h.startedRoom(4);
  const mafia = byRole(ps, 'mafia')[0];
  const [v1, v2] = nonMafia(ps);

  game.day = 1; // 첫날 낮(투표 없음)을 이미 지난 첫 밤
  force(game, 'night');
  await night(mafia, v1);
  game._advance(); // → morning
  assert.equal(rec(game, v1).alive, false);
  game._advance(); // 1:2 → 계속
  assert.equal(game.status, 'playing');
  assert.equal(game.phase, 'discussion');
  game._advance(); // → vote
  game._advance(); // 무투표 → 밤
  assert.equal(game.phase, 'night');

  await night(mafia, v2);
  game._advance(); // → morning (1:1)
  const over = waitFor(mafia.socket, 'game:over');
  game._advance(); // 승리 판정
  const res = await over;
  assert.equal(res.winner, 'mafia');
  assert.equal(game.status, 'waiting');
});

test('종료 보고(ended): 처형/세이브/조사 통계가 담긴다', async () => {
  const { game, ps } = await h.startedRoom(4);
  let report = null;
  game.on('ended', (r) => { report = r; });
  const mafia = byRole(ps, 'mafia')[0];
  const police = byRole(ps, 'police')[0];
  force(game, 'night');
  await night(police, mafia);
  game._advance();
  game._endGame('citizen');
  assert.equal(report.winner, 'citizen');
  assert.equal(report.players.find((p) => p.id === police.user.id).stats.policeHits, 1);
  assert.equal(report.players.length, 4);
});
