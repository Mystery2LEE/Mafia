// 관전: 진행 중인 방을 공개 정보만 보면서 지켜본다
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emitAck, harness, waitFor, clearEvents, sleep } = require('./helpers');

const LIMITS = { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 }, maxSpectators: 2 };
const LONG = { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 };

let srv;
let h;
const sockets = [];
before(async () => {
  srv = await startTestServer({ limits: LIMITS });
  h = harness(srv, sockets, LONG);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

const spectate = (p, roomId, password) => emitAck(p.socket, 'room:spectate', { roomId, password });

test('관전: 진행 중인 방만 가능, 대기 중이면 거부', async () => {
  const room = await h.makeRoom(4);
  const w = await h.player('w');
  assert.equal((await spectate(w, room.roomId)).error, 'not_playing'); // 대기 중 → 일반 입장
  assert.equal((await spectate(w, 'nope')).error, 'not_found');

  await emitAck(room.ps[0].socket, 'game:start');
  const r = await spectate(w, room.roomId);
  assert.equal(r.ok, true);
  assert.equal(room.game.spectators.size, 1);
  assert.equal((await spectate(w, room.roomId)).error, 'already_joined');
});

test('관전자는 전지적 시점(직업·밤 행동)을 보지만 본인 몫 개인 정보는 없다', async () => {
  const { game, ps, roomId } = await h.startedRoom(4);
  const w = await h.player('w');
  await spectate(w, roomId);
  const st = await waitFor(w.socket, 'room:state', (s) => s.spectator === true);
  assert.equal(st.spectator, true);
  assert.equal(st.you, undefined);
  assert.equal(st.status, 'playing');
  assert.ok(st.phase);
  assert.deepEqual(st.chat.read.sort(), ['dead', 'mafia', 'public', 'spectator', 'system']); // 전 채널 읽기
  assert.deepEqual(st.chat.write, ['spectator']); // 쓰기는 관전석만
  for (const p of ps) assert.equal(st.reveal.roles[p.user.id], p.role);
  // 본인 몫 정보는 없다
  const json = JSON.stringify(st);
  for (const key of ['mafiaTeam', 'policeLog', 'nightTarget', 'mafiaPicks']) assert.equal(json.includes(key), false, key);
  assert.equal(game.stateFor(ps[0].user.id).spectatorCount, 1);
  assert.equal(game.summary().spectatorCount, 1);
});

test('관전자는 투표·능력·일시정지·준비·시작을 할 수 없다', async () => {
  const { game, ps, roomId } = await h.startedRoom(4);
  const w = await h.player('w');
  await spectate(w, roomId);
  game._enter('vote', 1000);
  assert.ok((await emitAck(w.socket, 'vote:cast', { targetId: ps[0].user.id })).error);
  assert.ok((await emitAck(w.socket, 'night:action', { targetId: ps[0].user.id })).error);
  assert.ok((await emitAck(w.socket, 'phase:hurry', { on: true })).error);
  assert.equal((await emitAck(w.socket, 'game:pause', {})).error, 'forbidden');
  assert.equal((await emitAck(w.socket, 'game:rematch', { on: true })).error, 'forbidden');
  assert.ok((await emitAck(w.socket, 'game:start')).error);
  assert.equal(game.ballots.size, 0);
  assert.equal(game.paused, null);
});

test('관전 채팅: 관전석은 관전자끼리만, 참가자 채널에는 쓸 수 없고 읽기만 가능', async () => {
  const { game, ps, roomId } = await h.startedRoom(4);
  const a = await h.player('wa');
  const b = await h.player('wb');
  await spectate(a, roomId);
  await spectate(b, roomId);
  game._enter('discussion', 1000);
  clearEvents(a.socket); clearEvents(b.socket); ps.forEach((p) => clearEvents(p.socket));

  assert.equal((await emitAck(a.socket, 'chat:send', { channel: 'public', text: '끼어들기' })).error, 'forbidden');
  assert.equal((await emitAck(a.socket, 'chat:send', { channel: 'mafia', text: '엿보기' })).error, 'forbidden');
  assert.equal((await emitAck(a.socket, 'chat:send', { channel: 'dead', text: '엿보기' })).error, 'forbidden');
  assert.equal((await emitAck(a.socket, 'chat:send', { channel: 'spectator', text: '재밌다' })).ok, true);
  const got = await waitFor(b.socket, 'chat:message', (m) => m.channel === 'spectator');
  assert.equal(got.text, '재밌다');
  await sleep(100);
  for (const p of ps) assert.equal(p.socket.events.some((e) => e.event === 'chat:message' && e.payload.channel === 'spectator'), false);

  // 참가자는 관전 채널에 쓸 수 없다
  assert.equal((await emitAck(ps[0].socket, 'chat:send', { channel: 'spectator', text: 'x' })).error, 'forbidden');
  // 관전자는 public 메시지를 받는다
  clearEvents(a.socket);
  assert.equal((await emitAck(ps[0].socket, 'chat:send', { channel: 'public', text: '안녕하세요' })).ok, true);
  assert.equal((await waitFor(a.socket, 'chat:message', (m) => m.channel === 'public')).text, '안녕하세요');
});

test('관전: 인원 제한, 비밀번호, 이미 방에 있으면 거부', async () => {
  const { roomId, ps, game } = await h.startedRoom(4);
  game.passwordHash = require('bcryptjs').hashSync('pw12', 4); // 진행 중인 비밀방
  const a = await h.player('wa');
  const b = await h.player('wb');
  const c = await h.player('wc');
  assert.equal((await spectate(a, roomId)).error, 'bad_password');
  assert.equal((await spectate(a, roomId, 'pw12')).ok, true);
  assert.equal((await spectate(b, roomId, 'pw12')).ok, true);
  assert.equal((await spectate(c, roomId, 'pw12')).error, 'spectators_full'); // 상한 2명
  assert.equal((await spectate(ps[1], roomId, 'pw12')).error, 'already_joined'); // 참가자는 관전 불가
});

test('관전자가 나가거나 끊기면 정리되고, 참가자가 모두 나가면 방과 함께 닫힌다', async () => {
  const { game, ps, roomId } = await h.startedRoom(4);
  const a = await h.player('wa');
  const b = await h.player('wb');
  await spectate(a, roomId);
  await spectate(b, roomId);

  await emitAck(a.socket, 'room:leave');
  assert.equal(game.spectators.size, 1);
  b.socket.close(); // 끊김 → 유예 후 제거
  await sleep(LIMITS.ingameGraceMs + 200);
  assert.equal(game.spectators.size, 0);
  assert.equal(srv.rooms.getRoomOf(b.user.id), undefined);

  // 참가자 전원이 나가 방이 닫히면 남은 관전자도 내보낸다
  const c = await h.player('wc');
  await spectate(c, roomId);
  for (const p of ps) await emitAck(p.socket, 'room:leave');
  await waitFor(c.socket, 'room:closed');
  assert.equal(srv.rooms.get(roomId), undefined);
  assert.equal(srv.rooms.getRoomOf(c.user.id), undefined);
});

test('게임이 끝나 대기실로 돌아오면 관전자는 참가자로 전환할 수 있다', async () => {
  const { game, ps, roomId } = await h.startedRoom(4, { maxPlayers: 5 });
  const w = await h.player('w');
  await spectate(w, roomId);
  assert.equal((await emitAck(w.socket, 'room:play', {})).error, 'not_waiting'); // 진행 중에는 불가
  game._endGame('citizen');
  assert.equal(game.status, 'waiting');
  // 대기실에서도 관전자는 관전 채널만 쓴다
  assert.equal(game.canWrite(w.user.id, 'public'), false);
  assert.equal((await emitAck(w.socket, 'room:play', {})).ok, true);
  assert.equal(game.spectators.size, 0);
  assert.equal(game.players.size, 5);
  assert.equal(game.canWrite(w.user.id, 'public'), true);
  // 전환한 사람도 다시 하기에 참여해야 자동 시작된다
  for (const p of ps) await emitAck(p.socket, 'game:rematch', { on: true });
  assert.equal(game.status, 'waiting');
  await emitAck(w.socket, 'game:rematch', { on: true });
  assert.equal(game.status, 'playing');
});

test('가득 찬 방에서는 전환할 수 없다', async () => {
  const { game, roomId } = await h.startedRoom(4); // maxPlayers 4
  const w = await h.player('w');
  await spectate(w, roomId);
  game._endGame('mafia');
  assert.equal((await emitAck(w.socket, 'room:play', {})).error, 'full');
  assert.equal(game.spectators.size, 1);
});
