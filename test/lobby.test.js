const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startTestServer, newUser, connectSocket, waitFor, clearEvents, emitAck, sleep,
} = require('./helpers');

let srv;
const sockets = [];
before(async () => {
  srv = await startTestServer({ limits: { waitingGraceMs: 150 } });
});
after(async () => {
  sockets.forEach((s) => s.close());
  await srv.close();
});

/** 새 유저 + 연결된 소켓 */
async function player(label) {
  const u = await newUser(srv.url, label);
  const socket = await connectSocket(srv.url, u.cookie);
  sockets.push(socket);
  return { ...u, socket };
}
const create = (p, opts = {}) =>
  emitAck(p.socket, 'room:create', { title: '테스트방', maxPlayers: 6, ...opts });
const join = (p, roomId, password) => emitAck(p.socket, 'room:join', { roomId, password });

test('방 생성: 목록에 나타나고 내부 정보(비밀번호 해시)는 노출되지 않는다', async () => {
  const a = await player('a');
  const r = await create(a, { title: '  비번방  ', password: 'secret' });
  assert.equal(r.ok, true);
  const { rooms } = await emitAck(a.socket, 'lobby:list');
  const room = rooms.find((x) => x.id === r.roomId);
  assert.equal(room.title, '비번방');
  assert.equal(room.hasPassword, true);
  assert.equal(room.playerCount, 1);
  assert.equal(room.status, 'waiting');
  assert.equal(JSON.stringify(rooms).includes('passwordHash'), false);
  assert.equal(JSON.stringify(rooms).includes('secret'), false);
});

test('방 생성 입력 검증 (제목, 인원 4~12, 시간 범위)', async () => {
  const a = await player('a');
  assert.equal((await create(a, { title: '   ' })).error, 'invalid_title');
  assert.equal((await create(a, { maxPlayers: 3 })).error, 'invalid_max_players');
  assert.equal((await create(a, { maxPlayers: 13 })).error, 'invalid_max_players');
  assert.equal((await create(a, { times: { night: 1 } })).error, 'invalid_times');
  assert.equal((await create(a, { times: { bogus: 30 } })).error, 'invalid_times');
  assert.equal((await create(a, { times: { night: 45 } })).ok, true);
});

test('입장: 정원 초과 / 비밀번호 / 없는 방', async () => {
  const host = await player('h');
  const { roomId } = await create(host, { maxPlayers: 4, password: 'pw1234' });
  const [b, c, d, e] = [await player('b'), await player('c'), await player('d'), await player('e')];

  assert.equal((await join(b, roomId)).error, 'bad_password');
  assert.equal((await join(b, roomId, 'wrong')).error, 'bad_password');
  assert.equal((await join(b, roomId, 'pw1234')).ok, true);
  assert.equal((await join(c, roomId, 'pw1234')).ok, true);
  assert.equal((await join(d, roomId, 'pw1234')).ok, true);
  assert.equal((await join(e, roomId, 'pw1234')).error, 'full');
  assert.equal((await join(e, 'nope00')).error, 'not_found');
});

test('한 유저는 동시에 한 방만 참여 가능', async () => {
  const a = await player('a');
  const b = await player('b');
  const r1 = await create(a);
  const r2 = await create(b);
  assert.equal((await create(a)).error, 'already_in_room');
  assert.equal((await join(a, r2.roomId)).error, 'already_in_room');
  assert.equal((await join(a, r1.roomId)).error, 'already_joined');
});

test('게임 중인 방은 입장 불가', async () => {
  const a = await player('a');
  const b = await player('b');
  const { roomId } = await create(a);
  srv.rooms.get(roomId).status = 'playing';
  assert.equal((await join(b, roomId)).error, 'in_game');
  assert.equal((await emitAck(a.socket, 'lobby:list')).rooms.find((x) => x.id === roomId).status, 'playing');
});

test('방장이 나가면 가장 먼저 입장한 사람에게 이전, 빈 방은 자동 삭제', async () => {
  const a = await player('a');
  const b = await player('b');
  const c = await player('c');
  const { roomId } = await create(a);
  await join(b, roomId);
  await join(c, roomId);

  clearEvents(b.socket);
  await emitAck(a.socket, 'room:leave');
  const state = await waitFor(b.socket, 'room:state', (s) => s.players.length === 2);
  assert.equal(state.hostId, b.user.id);
  assert.equal(state.players.find((p) => p.id === b.user.id).isHost, true);

  await emitAck(b.socket, 'room:leave');
  await emitAck(c.socket, 'room:leave');
  assert.equal(srv.rooms.get(roomId), undefined);
  const { rooms } = await emitAck(a.socket, 'lobby:list');
  assert.equal(rooms.some((x) => x.id === roomId), false);
});

test('로비의 다른 유저에게 방 목록이 실시간으로 갱신된다', async () => {
  const watcher = await player('w');
  const a = await player('a');
  clearEvents(watcher.socket);
  const { roomId } = await create(a, { title: '실시간방' });
  const upd = await waitFor(watcher.socket, 'lobby:update', (p) => p.rooms.some((r) => r.id === roomId));
  assert.equal(upd.rooms.find((r) => r.id === roomId).title, '실시간방');

  clearEvents(watcher.socket);
  await emitAck(a.socket, 'room:leave');
  const gone = await waitFor(watcher.socket, 'lobby:update', (p) => !p.rooms.some((r) => r.id === roomId));
  assert.ok(gone);
});

test('새로고침(재접속) 시 같은 방으로 복구된다', async () => {
  const a = await player('a');
  const { roomId } = await create(a);
  a.socket.close();
  await sleep(30);
  const again = await connectSocket(srv.url, a.cookie);
  sockets.push(again);
  const resume = await waitFor(again, 'room:resume');
  assert.equal(resume.roomId, roomId);
  const state = await waitFor(again, 'room:state');
  assert.equal(state.id, roomId);
  assert.equal(state.players[0].connected, true);
  // 이미 방에 있으므로 다른 방 생성은 불가
  assert.equal((await emitAck(again, 'room:create', { title: 'x', maxPlayers: 4 })).error, 'already_in_room');
});

test('재접속 없이 유예시간이 지나면 방에서 제거되고 빈 방은 삭제된다', async () => {
  const a = await player('a');
  const b = await player('b');
  const { roomId } = await create(a);
  await join(b, roomId);
  clearEvents(b.socket);
  a.socket.close();
  const dc = await waitFor(b.socket, 'room:state', (s) => s.players.some((p) => !p.connected));
  assert.ok(dc);
  await sleep(400);
  assert.equal(srv.rooms.get(roomId).players.has(a.user.id), false);
  assert.equal(srv.rooms.get(roomId).hostId, b.user.id);
  await emitAck(b.socket, 'room:leave');
  assert.equal(srv.rooms.get(roomId), undefined);
});

test('같은 계정으로 새 탭을 열면 이전 소켓은 종료되고 방 참가는 유지된다', async () => {
  const a = await player('a');
  const { roomId } = await create(a);
  const replaced = waitFor(a.socket, 'session:replaced');
  const second = await connectSocket(srv.url, a.cookie);
  sockets.push(second);
  await replaced;
  await sleep(300); // 유예시간(150ms)보다 길게 기다려도 제거되지 않아야 한다
  assert.ok(srv.rooms.get(roomId).players.has(a.user.id));
  assert.equal(srv.rooms.get(roomId).players.get(a.user.id).connected, true);
});

test('방끼리 상태가 섞이지 않는다', async () => {
  const a = await player('a');
  const b = await player('b');
  const c = await player('c');
  const r1 = await create(a, { title: '방1' });
  const r2 = await create(b, { title: '방2' });
  clearEvents(a.socket);
  await join(c, r2.roomId);
  await waitFor(b.socket, 'room:state', (s) => s.players.length === 2);
  await sleep(50);
  // 방1 참가자(a)는 방2 상태를 받지 않는다
  assert.equal(a.socket.events.some((e) => e.event === 'room:state'), false);
  assert.equal(srv.rooms.get(r1.roomId).players.size, 1);
  assert.equal(srv.rooms.get(r2.roomId).players.size, 2);
});
