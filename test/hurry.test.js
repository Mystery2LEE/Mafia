// 시간 단축 / 오늘 건너뛰기: 생존자 과반 동의로만 동작한다
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emitAck, harness } = require('./helpers');

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

const force = (game, phase, day) => { if (day) game.day = day; game._enter(phase, 1000); };
const hurry = (p, on = true) => emitAck(p.socket, 'phase:hurry', { on });
const skip = (p, on = true) => emitAck(p.socket, 'day:skip', { on });

test('시간 단축: 과반 미만이면 그대로, 과반이면 남은 시간이 줄어든다', async () => {
  const { game, ps } = await h.startedRoom(5);
  force(game, 'discussion', 2);
  const before = game.endsAt;

  assert.equal((await hurry(ps[0])).ok, true);
  assert.equal((await hurry(ps[1])).ok, true);
  assert.equal(game.endsAt, before); // 5명 중 2명: 과반(3) 미달
  assert.equal(game.stateFor(ps[0].user.id).skip.hurry, 2);
  assert.equal(game.stateFor(ps[0].user.id).skip.need, 3);
  assert.equal(game.stateFor(ps[0].user.id).you.hurry, true);

  // 철회하면 다시 미달
  await hurry(ps[1], false);
  assert.equal(game.stateFor(ps[0].user.id).skip.hurry, 1);
  await hurry(ps[1], true);

  await hurry(ps[2]); // 3명 = 과반
  const left = game.endsAt - Date.now();
  assert.ok(left <= LIMITS.secondMs * 5 + 50, `남은 시간 ${left}ms`);
  assert.equal(game.hurried, true);
  assert.equal((await hurry(ps[3])).error, 'already_hurried');

  // 줄어든 시간이 지나면 실제로 다음 단계(투표)로 넘어간다
  await new Promise((r) => setTimeout(r, LIMITS.secondMs * 5 + 200));
  assert.equal(game.phase, 'vote');
});

test('시간 단축: 사망자/잘못된 단계는 거부, 단계가 바뀌면 동의가 초기화', async () => {
  const { game, ps } = await h.startedRoom(5);
  force(game, 'morning', 2);
  assert.equal((await hurry(ps[0])).error, 'wrong_phase');

  force(game, 'discussion', 2);
  game._kill(ps[4].user.id, 'mafia');
  assert.equal((await hurry(ps[4])).error, 'forbidden'); // 사망자는 투표 불가
  await hurry(ps[0]);
  assert.equal(game.hurryVotes.size, 1);
  force(game, 'vote');
  assert.equal(game.hurryVotes.size, 0);
  assert.equal(game.stateFor(ps[0].user.id).you.hurry, false);
});

test('오늘 건너뛰기: 과반이면 처형 없이 곧바로 밤', async () => {
  const { game, ps } = await h.startedRoom(5);
  force(game, 'discussion', 2);
  await skip(ps[0]);
  await skip(ps[1]);
  assert.equal(game.phase, 'discussion');
  assert.equal((await skip(ps[2])).ok, true);
  assert.equal(game.phase, 'night');
  assert.equal(game._aliveCount(), 5); // 아무도 처형되지 않음
  assert.equal(game.skipVotes.size, 0); // 새 단계라 초기화
});

test('오늘 건너뛰기: 투표 단계에서도 가능, 첫날(투표 없음)/밤에는 불가', async () => {
  const { game, ps } = await h.startedRoom(4);
  force(game, 'discussion', 1); // 첫날: 건너뛸 투표가 없다
  assert.equal((await skip(ps[0])).error, 'no_vote_today');
  assert.equal(game.stateFor(ps[0].user.id).skip.canSkip, false);

  force(game, 'night', 2);
  assert.equal((await skip(ps[0])).error, 'wrong_phase');

  force(game, 'vote', 2);
  assert.equal(game.stateFor(ps[0].user.id).skip.canSkip, true);
  await skip(ps[0]);
  await skip(ps[1]);
  assert.equal(game.phase, 'vote'); // 4명 중 2명: 과반(3) 미달
  await skip(ps[2]);
  assert.equal(game.phase, 'night');
});

test('생존자가 줄면 과반 기준도 줄어든다', async () => {
  const { game, ps } = await h.startedRoom(5);
  force(game, 'discussion', 2);
  game._kill(ps[3].user.id, 'mafia');
  game._kill(ps[4].user.id, 'mafia');
  if (game.status !== 'playing') return; // 사망 처리로 게임이 끝난 경우(직업 배정 우연)는 건너뛴다
  const alive = ps.filter((p) => game._isAlive(p.user.id));
  assert.equal(game._majority(), Math.floor(alive.length / 2) + 1);
});

test('방 밖/게임 전에는 사용할 수 없다', async () => {
  const room = await h.makeRoom(4);
  assert.equal((await hurry(room.ps[0])).error, 'forbidden');
  assert.equal((await skip(room.ps[0])).error, 'forbidden');
});
