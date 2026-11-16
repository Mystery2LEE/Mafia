// 중립 직업 '광대': 투표로 처형되면 단독 승리, 밤에 죽으면 승리 아님
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, harness } = require('./helpers');
const gameCfg = require('../server/config/game');

const LIMITS = { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 }, jesterChance: 1 };
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

test('직업 배분: 5명 이상이고 옵션이 켜져 있을 때만 시민 1명이 광대로 바뀐다', () => {
  assert.deepEqual(gameCfg.roleCounts(5, undefined, true), { mafia: 1, police: 1, doctor: 1, citizen: 1, jester: 1 });
  assert.deepEqual(gameCfg.roleCounts(5, undefined, false), { mafia: 1, police: 1, doctor: 1, citizen: 2 });
  assert.equal(gameCfg.roleCounts(4, undefined, true).jester, undefined); // 4명은 광대 없음
  const c = gameCfg.roleCounts(8, undefined, true);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 8);
  assert.equal(c.jester, 1);
});

test('5명 게임에 광대가 배정되고 팀은 jester 다', async () => {
  const { game, ps } = await h.startedRoom(5, { jester: true });
  assert.equal(byRole(ps, 'jester').length, 1);
  assert.equal(game.players.get(byRole(ps, 'jester')[0].user.id).team, 'jester');
});

test('방 옵션으로 광대를 끌 수 있다', async () => {
  const { ps } = await h.startedRoom(5, { jester: false });
  assert.equal(byRole(ps, 'jester').length, 0);
});

test('광대가 투표로 처형되면 광대 단독 승리로 게임이 끝난다', async () => {
  const { game, ps } = await h.startedRoom(5, { jester: true });
  const jester = byRole(ps, 'jester')[0];
  let report = null;
  game.once('ended', (r) => { report = r; });
  game._kill(jester.user.id, 'vote');
  assert.equal(game._checkWin(), true);
  assert.equal(report.winner, 'jester');
  assert.equal(game.status, 'waiting');
  const me = report.players.find((p) => p.id === jester.user.id);
  assert.equal(me.team, 'jester');
  assert.equal(me.executed, true);
});

test('광대가 밤에 마피아에게 죽으면 승리가 아니다', async () => {
  const { game, ps } = await h.startedRoom(5, { jester: true });
  const jester = byRole(ps, 'jester')[0];
  game._kill(jester.user.id, 'mafia');
  assert.equal(game.players.get(jester.user.id).executed, false);
  assert.equal(game.status, 'playing'); // 광대 승리로 끝나지 않는다 (마피아 1 vs 나머지 3)
});

test('경찰이 조사하면 광대는 마피아가 아니라고 나온다', async () => {
  const { game, ps } = await h.startedRoom(5, { jester: true });
  const jester = byRole(ps, 'jester')[0];
  const cop = byRole(ps, 'police')[0];
  game._startNight();
  game.nightAction(cop.user.id, jester.user.id);
  const r = game._resolveNight();
  assert.equal(r.policeResult.isMafia, false);
});

test('등장 확률 0 이면 옵션이 켜져 있어도 광대가 나오지 않는다', async () => {
  const { game, ps } = await h.startedRoom(5, { jester: true });
  game.limits = { ...game.limits, jesterChance: 0 };
  game._assignRoles(1);
  assert.equal([...game.players.values()].filter((p) => p.role === 'jester').length, 0);
  assert.equal(ps.length, 5);
});
