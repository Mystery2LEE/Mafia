// DB 접근은 이 모듈(db/) 안에서만 한다. PostgreSQL로 옮길 때는 이 폴더만 교체하면 된다.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createUserRepo } = require('./users');
const { createMatchRepo } = require('./matches');
const { createAvatarRepo } = require('./avatars');
const ratingCfg = require('../config/rating');

function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  return {
    raw, // 테스트 전용 (서비스 코드는 저장소 메서드만 사용)
    users: createUserRepo(raw),
    matches: createMatchRepo(raw, { floor: ratingCfg.floor }),
    avatars: createAvatarRepo(raw),
    // 트랜잭션 헬퍼 (점수 반영 등에서 사용)
    transaction: (fn) => raw.transaction(fn)(),
    close: () => raw.close(),
  };
}

module.exports = { openDb };
