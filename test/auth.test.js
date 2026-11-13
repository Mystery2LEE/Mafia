const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, register, connectSocket } = require('./helpers');

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

const post = (path, body) => fetch(`${srv.url}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('회원가입 성공: httpOnly JWT 쿠키 발급, 비밀번호는 해시로 저장', async () => {
  const r = await register(srv.url, 'alice01', '앨리스');
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /SameSite=Lax/i);
  assert.equal(r.body.user.rating, 1000);
  const row = srv.db.users.findByUsername('alice01');
  assert.notEqual(row.password_hash, 'password123');
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('아이디/닉네임 중복 불가 (닉네임은 대소문자 무시)', async () => {
  await register(srv.url, 'bob00001', 'Bobby');
  const dupName = await register(srv.url, 'bob00001', '다른닉');
  assert.equal(dupName.status, 409);
  assert.equal(dupName.body.error, 'username_taken');
  const dupNick = await register(srv.url, 'bob00002', 'bobby');
  assert.equal(dupNick.status, 409);
  assert.equal(dupNick.body.error, 'nickname_taken');
});

test('입력 검증', async () => {
  assert.equal((await register(srv.url, 'ab', '닉네임')).status, 400);
  assert.equal((await register(srv.url, 'validid1', '닉네임', 'short')).status, 400);
  assert.equal((await register(srv.url, 'validid2', 'a')).status, 400);
});

test('로그인: 성공/실패, /me', async () => {
  await register(srv.url, 'carol001', '캐롤');
  const bad = await post('/api/auth/login', { username: 'carol001', password: 'wrongpass1' });
  assert.equal(bad.status, 401);
  const none = await post('/api/auth/login', { username: 'nobody99', password: 'password123' });
  assert.equal(none.status, 401);

  const ok = await post('/api/auth/login', { username: 'carol001', password: 'password123' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`${srv.url}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.nickname, '캐롤');
  assert.equal((await fetch(`${srv.url}/api/auth/me`)).status, 401);
});

test('비로그인 소켓 연결 거부', async () => {
  await assert.rejects(connectSocket(srv.url, null), /unauthorized/);
});

test('위조/잘못된 토큰 소켓 연결 거부', async () => {
  await assert.rejects(connectSocket(srv.url, 'token=not-a-jwt'), /unauthorized/);
  const forged = require('jsonwebtoken').sign({ uid: 1 }, 'other-secret');
  await assert.rejects(connectSocket(srv.url, `token=${forged}`), /unauthorized/);
});

test('로그인한 소켓은 연결되고 자기 유저 정보를 받는다', async () => {
  const { cookie } = await register(srv.url, 'dave0001', '데이브');
  const socket = await connectSocket(srv.url, cookie);
  const hello = await socket.hello;
  assert.equal(hello.user.nickname, '데이브');
  assert.equal(hello.user.password_hash, undefined);
  socket.close();
});
