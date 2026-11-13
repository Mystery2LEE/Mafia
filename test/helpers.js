const { io } = require('socket.io-client');
const { createServer } = require('../server');

/** 메모리 DB로 서버를 띄운다. limits로 유예시간 등을 테스트용으로 줄일 수 있다. */
async function startTestServer(opts = {}) {
  const ctx = createServer({ dbPath: ':memory:', jwtSecret: 'test-secret', ...opts });
  const port = await ctx.listen(0);
  return { ...ctx, port, url: `http://localhost:${port}` };
}

/** 회원가입 후 Set-Cookie에서 'token=...' 부분만 뽑아 반환 */
async function register(url, username, nickname, password = 'password123') {
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, nickname }),
  });
  const body = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, body, cookie: setCookie.split(';')[0], setCookie };
}

let seq = 0;
/** 고유한 테스트 유저 생성 → { cookie, user } */
async function newUser(url, label = 'p') {
  const n = ++seq;
  const r = await register(url, `user${n}x`, `${label}${n}`);
  return { cookie: r.cookie, user: r.body.user };
}

/**
 * 쿠키를 달고 소켓 연결. 성공 시 소켓, 실패 시 reject(Error).
 * 받은 모든 이벤트는 socket.events 에 쌓인다(연결 직후 오는 이벤트를 놓치지 않기 위함).
 */
function connectSocket(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      extraHeaders: cookie ? { cookie } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    socket.events = [];
    socket.onAny((event, payload) => socket.events.push({ event, payload }));
    socket.hello = new Promise((res) => socket.once('hello', res));
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => { socket.close(); reject(err); });
  });
}

/** 이미 받은 이벤트 또는 앞으로 올 이벤트 중 조건에 맞는 것을 기다린다. */
function waitFor(socket, event, pred = () => true, ms = 2000) {
  const hit = socket.events.find((e) => e.event === event && pred(e.payload));
  if (hit) return Promise.resolve(hit.payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    function handler(payload) {
      if (!pred(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

const clearEvents = (socket) => { socket.events.length = 0; };
const emitAck = (socket, event, payload) =>
  new Promise((resolve) => (payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 방/게임 테스트용 하네스. 플레이어 생성, 방 만들기, 게임 시작(직업 수신까지)을 묶어 준다.
 * sockets 배열에 소켓을 모아 두므로 테스트 종료 시 한 번에 닫을 수 있다.
 */
function harness(srv, sockets, defaultTimes) {
  async function player(label) {
    const u = await newUser(srv.url, label);
    const socket = await connectSocket(srv.url, u.cookie);
    sockets.push(socket);
    return { ...u, socket };
  }
  async function makeRoom(n, opts = {}) {
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(await player(`g${i}`));
    const r = await emitAck(ps[0].socket, 'room:create', {
      title: '게임방', maxPlayers: Math.max(n, 4), times: defaultTimes, ...opts,
    });
    if (!r.ok) throw new Error(`room:create failed: ${r.error}`);
    for (const p of ps.slice(1)) {
      const j = await emitAck(p.socket, 'room:join', { roomId: r.roomId });
      if (!j.ok) throw new Error(`room:join failed: ${j.error}`);
    }
    return { roomId: r.roomId, ps, game: srv.rooms.get(r.roomId) };
  }
  async function startedRoom(n, opts) {
    const room = await makeRoom(n, opts);
    const res = await emitAck(room.ps[0].socket, 'game:start');
    if (!res.ok) throw new Error(`game:start failed: ${res.error}`);
    for (const p of room.ps) {
      const a = await waitFor(p.socket, 'role:assigned');
      p.role = a.role;
      p.assigned = a;
    }
    return room;
  }
  return { player, makeRoom, startedRoom };
}

module.exports = {
  startTestServer, register, newUser, connectSocket, waitFor, clearEvents, emitAck, sleep, harness,
};
