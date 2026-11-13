function createUserRepo(db) {
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)'
  );
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?');

  return {
    /** 중복이면 { error: 'username_taken' | 'nickname_taken' } 반환 */
    create({ username, passwordHash, nickname }) {
      try {
        const info = insert.run(username, passwordHash, nickname);
        return { user: byId.get(info.lastInsertRowid) };
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return { error: /nickname/.test(e.message) ? 'nickname_taken' : 'username_taken' };
        }
        throw e;
      }
    },
    findById: (id) => byId.get(id),
    findByUsername: (username) => byUsername.get(username),
  };
}

module.exports = { createUserRepo };
