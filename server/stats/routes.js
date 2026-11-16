const express = require('express');
const { userFromCookieHeader } = require('../auth/routes');
const { tierOf } = require('../rating/tiers');
const cfg = require('../config/rating');

const rate = (wins, games) => (games ? Math.round((wins / games) * 1000) / 10 : 0);

function createStatsRouter({ db, jwt }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const user = userFromCookieHeader(req.headers.cookie, { db, jwt });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  });

  // 상위 50명 랭킹
  router.get('/ranking', (req, res) => {
    const rows = db.matches.ranking(50);
    res.json({
      players: rows.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        nickname: r.nickname,
        av: db.avatars.versionOf(r.id),
        rating: r.rating,
        tier: tierOf(r.rating, cfg),
        games: r.games,
        wins: r.wins,
        winRate: rate(r.wins, r.games),
        isMe: r.id === req.user.id,
      })),
    });
  });

  // 연속 기록: 가장 최근부터 같은 결과가 몇 번 이어졌는지 (이탈은 패배로 센다)
  const streakOf = (results) => {
    if (!results.length) return { type: null, count: 0, bestWin: 0 };
    const isWin = (r) => r === 'win';
    let count = 0;
    while (count < results.length && isWin(results[count]) === isWin(results[0])) count++;
    let best = 0;
    let run = 0;
    for (const r of results) { run = isWin(r) ? run + 1 : 0; best = Math.max(best, run); }
    return { type: isWin(results[0]) ? 'win' : 'lose', count, bestWin: best };
  };

  // 프로필: 티어, 레이팅, 전적, 직업별/팀별 승률, 생존율, 연승, 레이팅 추이, 최근 20경기
  // ?id= 로 다른 사람의 프로필도 볼 수 있다 (로그인한 사람끼리 공개)
  router.get('/profile', (req, res) => {
    const wanted = req.query.id === undefined ? req.user.id : Number(req.query.id);
    const u = Number.isInteger(wanted) ? db.users.findById(wanted) : null;
    if (!u) return res.status(404).json({ error: 'not_found' });
    const tier = tierOf(u.rating, cfg);
    const next = cfg.tiers[tier.index + 1];
    const totals = db.matches.totals(u.id);
    const surv = db.matches.survival(u.id);
    res.json({
      user: {
        id: u.id, nickname: u.nickname, av: db.avatars.versionOf(u.id), rating: u.rating, createdAt: u.created_at,
        rank: db.matches.rankOf(u.rating),
        tier,
        nextTier: next ? { name: next.name, min: next.min } : null,
        currentTierMin: cfg.tiers[tier.index].min,
        isMe: u.id === req.user.id,
      },
      totals: { games: totals.games, wins: totals.wins, winRate: rate(totals.wins, totals.games) },
      byRole: db.matches.byRole(u.id).map((r) => ({ ...r, winRate: rate(r.wins, r.games) })),
      byTeam: db.matches.byTeam(u.id).map((r) => ({ ...r, winRate: rate(r.wins, r.games) })),
      survivalRate: rate(surv.survived, surv.games),
      leftEarly: surv.leftEarly,
      streak: streakOf(db.matches.results(u.id)),
      ratingHistory: db.matches.ratingHistory(u.id, u.rating, 30),
      recent: db.matches.recent(u.id, 20),
    });
  });

  // 더 보기: beforeMatchId 보다 오래된 경기 20건
  router.get('/profile/matches', (req, res) => {
    const id = req.query.id === undefined ? req.user.id : Number(req.query.id);
    const before = Number(req.query.before);
    if (!Number.isInteger(id) || !Number.isInteger(before) || before < 1) return res.status(400).json({ error: 'invalid_query' });
    if (!db.users.findById(id)) return res.status(404).json({ error: 'not_found' });
    res.json({ matches: db.matches.page(id, before, 20) });
  });

  // 경기 상세: 참가자 전원의 직업/결과/점수 (끝난 판이라 직업 공개)
  router.get('/match/:id', (req, res) => {
    const id = Number(req.params.id);
    const m = Number.isInteger(id) ? db.matches.match(id) : null;
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(m);
  });

  return router;
}

module.exports = { createStatsRouter };
