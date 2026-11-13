function createAvatarRepo(db) {
  const get = db.prepare('SELECT mime, data, version FROM user_avatars WHERE user_id = ?');
  const ver = db.prepare('SELECT version FROM user_avatars WHERE user_id = ?');
  const upsert = db.prepare(
    `INSERT INTO user_avatars (user_id, mime, data, version) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
       version = excluded.version, updated_at = datetime('now')`
  );
  const del = db.prepare('DELETE FROM user_avatars WHERE user_id = ?');
  let lastVersion = 0;

  return {
    get: (userId) => get.get(userId),
    /** 사진이 있으면 버전(캐시 무효화용), 없으면 0 */
    versionOf: (userId) => ver.get(userId)?.version ?? 0,
    set(userId, mime, data) {
      // 삭제 후 다시 올려도 이전 버전 번호와 겹치지 않도록 시간 기반 + 단조 증가
      lastVersion = Math.max(Date.now(), lastVersion + 1);
      upsert.run(userId, mime, data, lastVersion);
      return lastVersion;
    },
    remove: (userId) => del.run(userId).changes > 0,
  };
}

module.exports = { createAvatarRepo };
