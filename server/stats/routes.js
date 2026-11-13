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

  // 내 프로필: 티어, 레이팅, 전적, 직업별 승률, 최근 10경기
  router.get('/profile', (req, res) => {
    const u = db.users.findById(req.user.id);
    const tier = tierOf(u.rating, cfg);
    const next = cfg.tiers[tier.index + 1];
    const totals = db.matches.totals(u.id);
    res.json({
      user: {
        id: u.id, nickname: u.nickname, av: db.avatars.versionOf(u.id), rating: u.rating, createdAt: u.created_at,
        rank: db.matches.rankOf(u.rating),
        tier,
        nextTier: next ? { name: next.name, min: next.min } : null,
        currentTierMin: cfg.tiers[tier.index].min,
      },
      totals: { games: totals.games, wins: totals.wins, winRate: rate(totals.wins, totals.games) },
      byRole: db.matches.byRole(u.id).map((r) => ({ ...r, winRate: rate(r.wins, r.games) })),
      recent: db.matches.recent(u.id, 10),
    });
  });

  return router;
}

module.exports = { createStatsRouter };
