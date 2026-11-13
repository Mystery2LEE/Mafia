const defaultCfg = require('../config/rating');

/**
 * 게임 종료 보고서 → 플레이어별 점수 변화. DB를 건드리지 않는 순수 함수다.
 * (레이팅 하한 0 적용은 DB 트랜잭션 안에서 실제 레이팅을 읽은 뒤 한다)
 *
 * report: { winner, players: [{ id, role, team, alive, left, executed, stats:{policeHits,doctorSaves} }] }
 * @returns {{ counted: boolean, reason: string|null, players: Array }}
 */
function calcMatch(report, cfg = defaultCfg) {
  const total = report.players.length;
  const leavers = report.players.filter((p) => p.left).length;

  let counted = true;
  let reason = null;
  if (total < cfg.minPlayers) { counted = false; reason = 'too_few_players'; }
  else if (leavers > total * cfg.maxLeaverRatio) { counted = false; reason = 'too_many_leavers'; }

  const players = report.players.map((p) => {
    const won = p.team === report.winner;
    const base = { id: p.id, role: p.role, team: p.team, survived: p.alive && !p.left, leftEarly: p.left };

    // 이탈자: 반영 여부와 관계없이 패배 + 추가 패널티, 보너스 없음
    if (p.left) {
      return {
        ...base, result: 'left', delta: cfg.loss + cfg.leavePenalty,
        breakdown: [{ key: 'left', value: cfg.loss }, { key: 'leavePenalty', value: cfg.leavePenalty }],
      };
    }
    if (!counted) return { ...base, result: won ? 'win' : 'lose', delta: 0, breakdown: [] };

    const breakdown = [{ key: won ? 'win' : 'loss', value: won ? cfg.win : cfg.loss }];
    if (base.survived) breakdown.push({ key: 'survived', value: cfg.bonus.survived });
    if (p.stats.policeHits > 0)
      breakdown.push({ key: 'policeHit', value: cfg.bonus.policeHit * p.stats.policeHits });
    if (p.stats.doctorSaves > 0)
      breakdown.push({ key: 'doctorSave', value: cfg.bonus.doctorSave * p.stats.doctorSaves });
    if (won && p.team === 'mafia' && !p.executed)
      breakdown.push({ key: 'mafiaNotExecutedWin', value: cfg.bonus.mafiaNotExecutedWin });

    return {
      ...base, result: won ? 'win' : 'lose',
      delta: breakdown.reduce((s, b) => s + b.value, 0), breakdown,
    };
  });

  return { counted, reason, players };
}

module.exports = { calcMatch };
