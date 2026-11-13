const express = require('express');
const { userFromCookieHeader } = require('../auth/routes');

const MAX_BYTES = 150 * 1024; // 클라이언트가 192x192 JPEG 로 줄여 보내므로 보통 10~30KB
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** 선언된 Content-Type 과 실제 파일 내용(매직 바이트)이 일치하는지 확인 */
function matchesMagic(mime, b) {
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function createAvatarRouter({ db, jwt }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const user = userFromCookieHeader(req.headers.cookie, { db, jwt });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  });

  // 다른 사람 사진 조회 (로그인한 사용자만). ?v=버전 이 붙으면 오래 캐시한다.
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) ? db.avatars.get(id) : null;
    if (!row) return res.status(404).end();
    res.set({
      'Content-Type': row.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    });
    res.send(row.data);
  });

  // 내 사진 올리기: 본문은 이미지 원본 바이트
  router.put('/', (req, res, next) => {
    express.raw({ type: TYPES, limit: MAX_BYTES })(req, res, (err) => {
      if (err) {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: '이미지가 너무 큽니다.' });
        return next(err);
      }
      const mime = (req.headers['content-type'] || '').split(';')[0].trim();
      const body = req.body;
      if (!TYPES.includes(mime) || !Buffer.isBuffer(body) || !body.length || !matchesMagic(mime, body)) {
        return res.status(400).json({ error: 'invalid_image', message: 'JPEG/PNG/WebP 이미지만 올릴 수 있습니다.' });
      }
      const av = db.avatars.set(req.user.id, mime, body);
      res.json({ ok: true, av });
    });
  });

  // 기본 아바타로 되돌리기
  router.delete('/', (req, res) => {
    db.avatars.remove(req.user.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAvatarRouter, MAX_BYTES };
