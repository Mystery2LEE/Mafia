const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
require('dotenv').config();

const { openDb } = require('./db');
const { createJwt } = require('./auth/jwt');
const { createAuthRouter, userFromCookieHeader } = require('./auth/routes');
const { socketAuth } = require('./auth/socketAuth');
const { RoomManager } = require('./lobby/RoomManager');
const { registerSockets } = require('./sockets');
const { registerRating } = require('./rating');
const { createStatsRouter } = require('./stats/routes');
const { createAvatarRouter } = require('./avatar/routes');

function createServer({ dbPath, jwtSecret, limits } = {}) {
  const secret = jwtSecret || process.env.JWT_SECRET;
  if (!secret) {
    console.warn('[경고] JWT_SECRET 이 없어 개발용 임시 키를 사용합니다. .env 를 설정하세요.');
  }
  const db = openDb(dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'mafia.db'));
  const jwt = createJwt(secret || 'dev-only-insecure-secret');

  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => res.json({ ok: true })); // 배포 환경의 헬스체크용
  app.use('/api/auth', createAuthRouter({ db, jwt }));
  app.use('/api/avatar', createAvatarRouter({ db, jwt }));
  app.use('/api', createStatsRouter({ db, jwt }));

  // 루트: 로그인 여부에 따라 이동
  app.get('/', (req, res) => {
    const user = userFromCookieHeader(req.headers.cookie, { db, jwt });
    res.redirect(user ? '/lobby.html' : '/login.html');
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const server = http.createServer(app);
  const io = new Server(server);
  io.use(socketAuth({ db, jwt }));

  const rooms = new RoomManager({ limits, avatarVersion: (id) => db.avatars.versionOf(id) });
  registerSockets({ io, rooms });
  registerRating({ rooms, db });

  return {
    app, server, io, db, jwt, rooms,
    listen: (port) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      rooms.shutdown();
      io.close(() => { db.close(); resolve(); });
    }),
  };
}

if (require.main === module) {
  const ctx = createServer();
  const port = Number(process.env.PORT) || 3000;
  ctx.listen(port).then((p) => console.log(`마피아 서버 실행: http://localhost:${p}`));
}

module.exports = { createServer };
