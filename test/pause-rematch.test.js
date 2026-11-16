// 일시정지 / 이어하기 / 다시 하기
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emitAck, harness, sleep } = require('./helpers');

const LIMITS = { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 }, pauseMaxSec: 10, pausesPerPlayer: 2 };
const LONG = { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 };

let srv;
let h;
const sockets = [];
before(async () => {
  srv = await startTestServer({ limits: LIMITS });
  h = harness(srv, sockets, LONG);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

const pause = (p) => emitAck(p.socket, 'game:pause', {});
const resume = (p) => emitAck(p.socket, 'game:resume', {});
const rematch = (p, on = true) => emitAck(p.socket, 'game:rematch', { on });

test('일시정지: 타이머가 멈추고 남은 시간이 보존되며, 이어하면 같은 단계에서 다시 흐른다', async () => {
  const { game, ps } = await h.startedRoom(4);
  game._enter('discussion', 1000);
  const phaseBefore = game.phase;
  assert.equal((await pause(ps[1])).ok, true);
  assert.ok(game.paused);
  assert.equal(game.endsAt, null);
  const st = game.stateFor(ps[0].user.id);
  assert.equal(st.pause.active.by, ps[1].user.id);
  assert.ok(st.pause.active.remainMs > 0);

  const remain = game.paused.remainMs;
  await sleep(LIMITS.secondMs * 5);
  assert.equal(game.phase, phaseBefore); // 멈춘 동안 단계가 넘어가지 않는다

  assert.equal((await pause(ps[0])).error, 'already_paused');
  assert.equal((await resume(ps[2])).ok, true); // 누구나 이어갈 수 있다
  assert.equal(game.paused, null);
  assert.ok(Math.abs((game.endsAt - Date.now()) - remain) < 100);
  assert.equal((await resume(ps[2])).error, 'not_paused');
});

test('일시정지 중에는 투표·능력·채팅·시간 단축이 막힌다', async () => {
  const { game, ps } = await h.startedRoom(4);
  game._enter('vote', 1000);
  await pause(ps[0]);
  const target = ps[1].user.id;
  assert.equal((await emitAck(ps[2].socket, 'vote:cast', { targetId: target })).error, 'paused');
  assert.equal((await emitAck(ps[2].socket, 'chat:send', { channel: 'public', text: '안녕' })).error, 'paused');
  assert.equal((await emitAck(ps[2].socket, 'phase:hurry', { on: true })).error, 'paused');
  await resume(ps[0]);
  assert.equal((await emitAck(ps[2].socket, 'vote:cast', { targetId: target })).ok, true);
});

test('일시정지: 1인당 횟수 제한, 대기실/종료 후에는 불가', async () => {
  const { game, ps } = await h.startedRoom(4);
  game._enter('discussion', 1000);
  for (let i = 0; i < 2; i++) { assert.equal((await pause(ps[0])).ok, true); await resume(ps[0]); }
  assert.equal((await pause(ps[0])).error, 'pause_limit');
  assert.equal(game.stateFor(ps[0].user.id).pause.left, 0);
  assert.equal(game.stateFor(ps[1].user.id).pause.left, 2); // 다른 사람은 별도
  assert.equal((await pause(ps[1])).ok, true);
  game._endGame('citizen'); // 멈춘 채 판이 끝나도 정리된다
  assert.equal(game.paused, null);
  assert.equal((await pause(ps[1])).error, 'forbidden');
});

test('일시정지: 최대 시간이 지나면 자동으로 이어진다', async () => {
  const { game, ps } = await h.startedRoom(4);
  game._enter('discussion', 1000);
  await pause(ps[0]);
  await sleep(LIMITS.secondMs * LIMITS.pauseMaxSec + 150);
  assert.equal(game.paused, null);
  assert.ok(game.endsAt > Date.now());
});

test('다시 하기: 전원이 동의하면 자동으로 새 판이 시작된다', async () => {
  const { game, ps } = await h.startedRoom(4);
  game._endGame('citizen');
  assert.equal(game.status, 'waiting');
  assert.equal((await rematch(ps[0])).ok, true);
  assert.equal((await rematch(ps[1])).ok, true);
  assert.equal((await rematch(ps[2])).ok, true);
  const st = game.stateFor(ps[0].user.id);
  assert.equal(st.rematch.count, 3);
  assert.equal(st.players.filter((p) => p.ready).length, 3);
  assert.equal(game.status, 'waiting'); // 아직 한 명 남음

  await rematch(ps[2], false); // 철회
  assert.equal(game.rematch.size, 2);
  await rematch(ps[2]);
  assert.equal((await rematch(ps[3])).ok, true);
  assert.equal(game.status, 'playing');
  assert.equal(game.rematch.size, 0);
});

test('다시 하기: 게임 중에는 불가, 나간 사람은 동의에서 빠진다', async () => {
  const { game, ps } = await h.startedRoom(5);
  assert.equal((await rematch(ps[0])).error, 'forbidden');
  game._endGame('mafia');
  await rematch(ps[0]);
  await rematch(ps[1]);
  await emitAck(ps[4].socket, 'room:leave');
  assert.equal(game.players.size, 4);
  await rematch(ps[2]);
  assert.equal(game.status, 'waiting');
  await rematch(ps[3]);
  assert.equal(game.status, 'playing');
});
