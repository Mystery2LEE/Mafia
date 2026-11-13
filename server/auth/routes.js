const express = require('express');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const { cookieOptions, COOKIE_NAME } = require('./jwt');

const USERNAME_RE = /^[A-Za-z0-9]{4,16}$/;
const NICKNAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
// 존재하지 않는 아이디로 로그인할 때도 비슷한 시간이 걸리게 하기 위한 더미 해시
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

function publicUser(u) {
  return { id: u.id, username: u.username, nickname: u.nickname, rating: u.rating };
}

function createAuthRouter({ db, jwt }) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const { username, password, nickname } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username))
      return res.status(400).json({ error: 'invalid_username', message: '아이디는 영문/숫자 4~16자입니다.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'invalid_password', message: '비밀번호는 8~72자입니다.' });
    if (typeof nickname !== 'string' || !NICKNAME_RE.test(nickname))
      return res.status(400).json({ error: 'invalid_nickname', message: '닉네임은 한글/영문/숫자/_ 2~12자입니다.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.users.create({ username, passwordHash, nickname });
    if (result.error === 'username_taken')
      return res.status(409).json({ error: 'username_taken', message: '이미 사용 중인 아이디입니다.' });
    if (result.error === 'nickname_taken')
      return res.status(409).json({ error: 'nickname_taken', message: '이미 사용 중인 닉네임입니다.' });

    res.cookie(COOKIE_NAME, jwt.sign(result.user.id), cookieOptions());
    res.status(201).json({ user: publicUser(result.user) });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'invalid_request' });
    const user = db.users.findByUsername(username);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok)
      return res.status(401).json({ error: 'bad_credentials', message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    res.cookie(COOKIE_NAME, jwt.sign(user.id), cookieOptions());
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const { maxAge, ...opts } = cookieOptions();
    res.clearCookie(COOKIE_NAME, opts);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const user = userFromCookieHeader(req.headers.cookie, { db, jwt });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    res.json({ user: publicUser(user) });
  });

  return router;
}

/** 쿠키 헤더 문자열 → DB 유저 (실패 시 null). HTTP와 소켓 handshake가 공용으로 쓴다. */
function userFromCookieHeader(header, { db, jwt }) {
  if (!header) return null;
  const token = cookie.parseCookie(header)[COOKIE_NAME];
  if (!token) return null;
  const payload = jwt.verify(token);
  if (!payload) return null;
  return db.users.findById(payload.uid) || null;
}

module.exports = { createAuthRouter, userFromCookieHeader, publicUser };
