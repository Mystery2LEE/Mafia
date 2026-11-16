// 유령 시점: 사망자에게만 전원의 직업과 밤 행동 현황을 보여 준다
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emitAck, harness, waitFor, clearEvents, sleep } = require('./helpers');

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

const byRole = (ps, role) => ps.filter((p) => p.role === role);

test('유령과 관전자는 전원의 직업을 보고, 산 참가자는 보지 못한다', async () => {
  const { game, ps, roomId } = await h.startedRoom(6);
  const w = await h.player('w');
  await emitAck(w.socket, 'room:spectate', { roomId });
  const dead = byRole(ps, 'citizen')[0];
  const alive = ps.find((p) => p !== dead);
  game._kill(dead.user.id, 'mafia');

  const ghost = game.stateFor(dead.user.id);
  assert.ok(ghost.reveal);
  for (const p of ps) assert.equal(ghost.reveal.roles[p.user.id], p.role);
  assert.equal(game.stateFor(alive.user.id).reveal, undefined);
  // 관전자도 유령과 같은 전지적 시점
  const spec = game.stateFor(w.user.id);
  for (const p of ps) assert.equal(spec.reveal.roles[p.user.id], p.role);
  assert.equal(spec.you, undefined);
});

test('밤에는 마피아 지목/의사 보호/경찰 조사가 실시간으로 유령에게 전달된다', async () => {
  const { game, ps } = await h.startedRoom(6);
  const mafia = byRole(ps, 'mafia');
  const doctor = byRole(ps, 'doctor')[0];
  const police = byRole(ps, 'police')[0];
  const ghost = byRole(ps, 'citizen')[0];
  const victim = byRole(ps, 'citizen')[1];
  game._kill(ghost.user.id, 'mafia');
  game._startNight();

  assert.deepEqual(game.stateFor(ghost.user.id).reveal.night, { mafia: [], doctor: null, police: null });
  clearEvents(ghost.socket);

  await emitAck(mafia[0].socket, 'night:action', { targetId: victim.user.id });
  await emitAck(doctor.socket, 'night:action', { targetId: victim.user.id });
  await emitAck(police.socket, 'night:action', { targetId: mafia[0].user.id });

  // 행동할 때마다 유령에게 새 상태가 간다
  const last = await waitFor(ghost.socket, 'room:state', (s) => s.reveal?.night?.police === mafia[0].user.id);
  assert.deepEqual(last.reveal.night.mafia, [{ from: mafia[0].user.id, to: victim.user.id }]);
  assert.equal(last.reveal.night.doctor, victim.user.id);

  // 산 시민은 남의 행동을 받지 않는다
  const st = game.stateFor(victim.user.id); // 산 시민
  assert.equal(st.reveal, undefined);
  assert.equal(st.you.mafiaPicks, undefined);

  // 밤이 아닐 때는 행동 현황이 없다
  game._enter('discussion', 1000);
  assert.equal(game.stateFor(ghost.user.id).reveal.night, null);
});

test('나간 사람은 유령 시점을 받지 않는다', async () => {
  const { game, ps } = await h.startedRoom(6);
  const p = byRole(ps, 'citizen')[0];
  game._kill(p.user.id, 'mafia');
  game.players.get(p.user.id).left = true;
  assert.equal(game.stateFor(p.user.id).reveal, undefined);
  await sleep(10);
});
