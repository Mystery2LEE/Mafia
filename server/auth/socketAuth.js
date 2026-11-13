const { userFromCookieHeader, publicUser } = require('./routes');

/** Socket.IO 미들웨어: handshake의 쿠키 JWT를 검증하고, 실패하면 연결을 거부한다. */
function socketAuth({ db, jwt }) {
  return (socket, next) => {
    const user = userFromCookieHeader(socket.handshake.headers.cookie, { db, jwt });
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = publicUser(user);
    next();
  };
}

module.exports = { socketAuth };
