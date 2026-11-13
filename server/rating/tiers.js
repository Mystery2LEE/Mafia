const defaultCfg = require('../config/rating');

/** 레이팅 → 티어 { key, name, index } */
function tierOf(rating, cfg = defaultCfg) {
  let found = 0;
  cfg.tiers.forEach((t, i) => { if (rating >= t.min) found = i; });
  const t = cfg.tiers[found];
  return { key: t.key, name: t.name, index: found };
}

module.exports = { tierOf };
