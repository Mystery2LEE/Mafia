const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function createJwt(secret) {
  return {
    sign: (userId) => jwt.sign({ uid: userId }, secret, { expiresIn: '7d' }),
    // 실패 시 null
    verify(token) {
      try {
        return jwt.verify(token, secret);
      } catch {
        return null;
      }
    },
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

module.exports = { createJwt, cookieOptions, COOKIE_NAME };
