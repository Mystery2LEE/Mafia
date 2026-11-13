const defaultCfg = require('../config/rating');
const { calcMatch } = require('./calc');
const { tierOf } = require('./tiers');

/**
 * 게임이 끝나면 서버가(오직 서버만) 점수를 계산해 DB에 한 트랜잭션으로 반영하고,
 * 각 참가자에게 본인의 변화만 'game:rating' 으로 보낸다.
 */
function registerRating({ rooms, db, cfg = defaultCfg }) {
  rooms.on('ended', (report) => {
    try {
      const calc = calcMatch(report, cfg);
      const { changes } = db.matches.recordMatch({
        roomTitle: report.title,
        winnerTeam: report.winner,
        counted: calc.counted,
        players: calc.players.map((p) => ({
          userId: p.id, role: p.role, team: p.team, survived: p.survived,
          result: p.result, delta: p.delta, leftEarly: p.leftEarly,
        })),
      });
      for (const ch of changes) {
        const detail = calc.players.find((p) => p.id === ch.userId);
        rooms.emit('toUser', ch.userId, 'game:rating', {
          counted: calc.counted,
          reason: calc.reason,
          result: detail.result,
          before: ch.before,
          after: ch.after,
          delta: ch.delta,
          tierBefore: tierOf(ch.before, cfg),
          tierAfter: tierOf(ch.after, cfg),
          breakdown: detail.breakdown,
        });
      }
    } catch (err) {
      // 점수 반영 실패가 게임 진행을 막아서는 안 된다 (트랜잭션이라 부분 반영도 없다)
      console.error('[rating] 점수 반영 실패:', err);
    }
  });
}

module.exports = { registerRating };
