const { io } = require('socket.io-client');
const { createServer } = require('../server');

/** 메모리 DB로 서버를 띄운다. */
async function startTestServer() {
  const ctx = createServer({ dbPath: ':memory:', jwtSecret: 'test-secret' });
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

/** 쿠키를 달고 소켓 연결. 연결 성공 시 소켓, 실패 시 reject(Error) */
function connectSocket(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      extraHeaders: cookie ? { cookie } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    // 서버가 연결 직후 보내는 hello를 놓치지 않도록 미리 받아 둔다
    socket.hello = new Promise((res) => socket.once('hello', res));
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => { socket.close(); reject(err); });
  });
}

module.exports = { startTestServer, register, connectSocket };
