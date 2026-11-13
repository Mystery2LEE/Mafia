// 소켓 이벤트 ↔ RoomManager 연결. 한 유저는 소켓 1개만 유지한다(새 탭이 열리면 이전 소켓 종료).
const LOBBY = 'lobby';
const roomChannel = (id) => `room:${id}`;
// 채팅 채널 room: 읽기 권한이 있는 소켓만 join 한다. 메시지는 이 room 으로만 emit 한다.
const chatRoom = (id, channel) => `room:${id}:chat:${channel}`;

function registerSockets({ io, rooms }) {
  const userSockets = new Map(); // userId -> socket

  /**
   * 소켓의 채팅 채널 소속을 Game 의 읽기 권한(readChannels)과 일치시킨다.
   * 새로 읽을 수 있게 된 채널은 히스토리를 한 번 내려준다(예: 사망 시 dead 채널 히스토리).
   */
  const syncChannels = (game, userId) => {
    const sock = userSockets.get(userId);
    if (!sock) return;
    const want = new Set(game.readChannels(userId));
    const have = (sock.data.channels ??= new Set());
    for (const ch of want) {
      if (have.has(ch)) continue;
      sock.join(chatRoom(game.id, ch));
      have.add(ch);
      sock.emit('chat:history', { channel: ch, messages: game.historyOf(ch) });
    }
    for (const ch of [...have]) {
      if (want.has(ch)) continue;
      sock.leave(chatRoom(game.id, ch));
      have.delete(ch);
    }
  };

  const leaveAllChannels = (sock, roomId) => {
    for (const ch of sock.data.channels ?? []) sock.leave(chatRoom(roomId, ch));
    sock.data.channels = new Set();
  };

  const sendRoomState = (game, userId) => {
    const sock = userSockets.get(userId);
    if (!sock) return;
    syncChannels(game, userId); // 상태를 보내기 전에 채널 소속부터 맞춘다
    if (game.players.get(userId)?.left) return; // 이탈자에게는 더 이상 방 상태를 보내지 않는다
    sock.emit('room:state', game.stateFor(userId));
  };

  rooms.on('lobby', () => io.to(LOBBY).emit('lobby:update', { rooms: rooms.list() }));
  rooms.on('room', (roomId) => {
    const game = rooms.get(roomId);
    if (!game) return;
    for (const userId of game.players.keys()) sendRoomState(game, userId);
  });
  rooms.on('toRoom', (roomId, event, payload) => io.to(roomChannel(roomId)).emit(event, payload));
  rooms.on('toUser', (userId, event, payload) => userSockets.get(userId)?.emit(event, payload));
  rooms.on('toChannel', (roomId, channel, event, payload) =>
    io.to(chatRoom(roomId, channel)).emit(event, payload));

  const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.emit('hello', { user });

    const prev = userSockets.get(user.id);
    userSockets.set(user.id, socket);
    if (prev) {
      prev.emit('session:replaced');
      prev.disconnect(true);
    }

    // 새로고침 재접속: 이미 방에 있으면 같은 방으로 복구
    const game = rooms.markConnected(user.id);
    if (game) {
      socket.join(roomChannel(game.id));
      socket.emit('room:resume', { roomId: game.id });
      sendRoomState(game, user.id);
    } else {
      socket.join(LOBBY);
      socket.emit('lobby:update', { rooms: rooms.list() });
    }

    const enterRoom = (g) => {
      socket.leave(LOBBY);
      socket.join(roomChannel(g.id));
    };

    socket.on('lobby:list', (ack) => reply(ack, { rooms: rooms.list() }));

    socket.on('room:create', async (opts, ack) => {
      const r = await rooms.create(user, opts);
      if (r.error) return reply(ack, { error: r.error, roomId: r.roomId });
      enterRoom(r.room);
      reply(ack, { ok: true, roomId: r.room.id });
      sendRoomState(r.room, user.id);
    });

    socket.on('room:join', async (payload, ack) => {
      const { roomId, password } = payload || {};
      const r = await rooms.join(user, roomId, password);
      if (r.error) return reply(ack, { error: r.error, roomId: r.roomId });
      enterRoom(r.room);
      reply(ack, { ok: true, roomId: r.room.id });
    });

    socket.on('game:start', (ack) => {
      const g = rooms.getRoomOf(user.id);
      if (!g) return reply(ack, { error: 'not_in_room' });
      reply(ack, g.start(user.id));
    });

    // 밤 능력 / 투표 / 찬반: 모든 판정은 Game 이 한다. 소켓 계층은 전달만 한다.
    const gameAct = (fn) => (payload, ack) => {
      const g = rooms.getRoomOf(user.id);
      if (!g) return reply(ack, { error: 'not_in_room' });
      reply(ack, fn(g, payload || {}));
    };
    const asId = (v) => (Number.isInteger(v) ? v : null);
    socket.on('night:action', gameAct((g, { targetId }) =>
      asId(targetId) === null ? { error: 'invalid_target' } : g.nightAction(user.id, targetId)));
    socket.on('vote:cast', gameAct((g, { targetId }) =>
      targetId === null ? g.castVote(user.id, null)
        : asId(targetId) === null ? { error: 'invalid_target' } : g.castVote(user.id, targetId)));
    socket.on('verdict:cast', gameAct((g, { agree }) => g.castVerdict(user.id, agree)));

    // 발신 권한은 서버(Game.chat)가 매번 검증한다. 클라이언트가 보내는 channel 값은 신뢰하지 않는다.
    socket.on('chat:send', (payload, ack) => {
      const g = rooms.getRoomOf(user.id);
      if (!g) return reply(ack, { error: 'not_in_room' });
      const { channel, text } = payload || {};
      reply(ack, g.chat(user.id, channel, text));
    });

    socket.on('room:leave', (ack) => {
      const r = rooms.leave(user.id);
      if (r) {
        leaveAllChannels(socket, r.roomId);
        socket.leave(roomChannel(r.roomId));
        socket.join(LOBBY);
      }
      reply(ack, { ok: true });
      socket.emit('lobby:update', { rooms: rooms.list() });
    });

    socket.on('disconnect', () => {
      // 이미 새 소켓으로 교체된 경우에는 무시
      if (userSockets.get(user.id) !== socket) return;
      userSockets.delete(user.id);
      rooms.markDisconnected(user.id);
    });
  });
}

module.exports = { registerSockets };
