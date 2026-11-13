// 소켓 이벤트 ↔ RoomManager 연결. 한 유저는 소켓 1개만 유지한다(새 탭이 열리면 이전 소켓 종료).
const LOBBY = 'lobby';
const roomChannel = (id) => `room:${id}`;

function registerSockets({ io, rooms }) {
  const userSockets = new Map(); // userId -> socket

  const sendRoomState = (game, userId) => {
    userSockets.get(userId)?.emit('room:state', game.stateFor(userId));
  };

  rooms.on('lobby', () => io.to(LOBBY).emit('lobby:update', { rooms: rooms.list() }));
  rooms.on('room', (roomId) => {
    const game = rooms.get(roomId);
    if (!game) return;
    for (const userId of game.players.keys()) sendRoomState(game, userId);
  });
  rooms.on('toRoom', (roomId, event, payload) => io.to(roomChannel(roomId)).emit(event, payload));
  rooms.on('toUser', (userId, event, payload) => userSockets.get(userId)?.emit(event, payload));

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

    socket.on('room:leave', (ack) => {
      const r = rooms.leave(user.id);
      if (r) {
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
