// 경기 기록 / 랭킹 / 프로필 조회. 레이팅 반영은 한 트랜잭션으로 처리한다.
function createMatchRepo(raw, { floor }) {
  const insertMatch = raw.prepare('INSERT INTO matches (room_title, winner_team) VALUES (?, ?)');
  const getRating = raw.prepare('SELECT rating FROM users WHERE id = ?');
  const setRating = raw.prepare('UPDATE users SET rating = ? WHERE id = ?');
  const insertPlayer = raw.prepare(`
    INSERT INTO match_players
      (match_id, user_id, role, team, survived, result, rating_delta, left_early, rating_counted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  /**
   * 경기 1건과 참가자 전원의 점수를 원자적으로 저장한다 (하나라도 실패하면 전부 롤백).
   * players[].delta 는 "원하는 변화량"이고, 하한(floor)을 적용한 실제 변화량이 rating_delta 로 저장된다.
   * @returns {{ matchId: number, changes: Array<{userId, before, after, delta}> }}
   */
  const recordMatch = raw.transaction(({ roomTitle, winnerTeam, counted, players }) => {
    const matchId = Number(insertMatch.run(roomTitle, winnerTeam).lastInsertRowid);
    const changes = [];
    for (const p of players) {
      const row = getRating.get(p.userId);
      if (!row) throw new Error(`unknown user ${p.userId}`);
      const after = Math.max(floor, row.rating + p.delta);
      setRating.run(after, p.userId);
      insertPlayer.run(matchId, p.userId, p.role, p.team, p.survived ? 1 : 0, p.result,
        after - row.rating, p.leftEarly ? 1 : 0, counted ? 1 : 0);
      changes.push({ userId: p.userId, before: row.rating, after, delta: after - row.rating });
    }
    return { matchId, changes };
  });

  const rankingStmt = raw.prepare(`
    SELECT u.id, u.nickname, u.rating,
           COUNT(mp.match_id) AS games,
           COALESCE(SUM(mp.result = 'win'), 0) AS wins
    FROM users u
    LEFT JOIN match_players mp ON mp.user_id = u.id AND mp.rating_counted = 1
    GROUP BY u.id
    ORDER BY u.rating DESC, u.id ASC
    LIMIT ?`);
  const rankOfStmt = raw.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE rating > ?');
  const totalsStmt = raw.prepare(`
    SELECT COUNT(*) AS games, COALESCE(SUM(result = 'win'), 0) AS wins
    FROM match_players WHERE user_id = ? AND rating_counted = 1`);
  const byRoleStmt = raw.prepare(`
    SELECT role, COUNT(*) AS games, COALESCE(SUM(result = 'win'), 0) AS wins
    FROM match_players WHERE user_id = ? AND rating_counted = 1 GROUP BY role`);
  const recentStmt = raw.prepare(`
    SELECT m.id AS matchId, m.room_title AS roomTitle, m.played_at AS playedAt, m.winner_team AS winnerTeam,
           mp.role, mp.result, mp.rating_delta AS ratingDelta, mp.survived, mp.rating_counted AS counted
    FROM match_players mp JOIN matches m ON m.id = mp.match_id
    WHERE mp.user_id = ? ORDER BY m.id DESC LIMIT ?`);

  return {
    recordMatch,
    ranking: (limit = 50) => rankingStmt.all(limit),
    rankOf: (rating) => rankOfStmt.get(rating).rank,
    totals: (userId) => totalsStmt.get(userId),
    byRole: (userId) => byRoleStmt.all(userId),
    recent: (userId, limit = 10) => recentStmt.all(userId, limit),
  };
}

module.exports = { createMatchRepo };
