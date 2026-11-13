const $ = (id) => document.getElementById(id);
const ROLE = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const RESULT = { win: '승리', lose: '패배', left: '이탈' };

const cell = (text, cls) => {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
};
const empty = (tbody, cols, text) => {
  const tr = document.createElement('tr');
  const td = cell(text);
  td.colSpan = cols;
  tr.append(td);
  tbody.append(tr);
};

(async () => {
  await requireLogin();
  try {
    const d = await api('/api/profile');
    $('nick').textContent = d.user.nickname;
    $('tier').textContent = d.user.tier.name;
    $('tier').className = `tier tier-${d.user.tier.key}`;
    $('rating').textContent = d.user.rating;
    $('rank').textContent = `${d.user.rank}위`;
    $('record').textContent = `${d.totals.wins}승 ${d.totals.games - d.totals.wins}패`;
    $('winrate').textContent = `${d.totals.winRate}%`;

    if (d.user.nextTier) {
      const span = d.user.nextTier.min - d.user.currentTierMin;
      const pct = Math.min(100, Math.max(0, ((d.user.rating - d.user.currentTierMin) / span) * 100));
      $('progress').style.width = `${pct}%`;
      $('next-label').textContent = `${d.user.nextTier.name}까지 ${Math.max(0, d.user.nextTier.min - d.user.rating)}점`;
    } else {
      $('progress').style.width = '100%';
      $('next-label').textContent = '최고 티어입니다';
    }

    const roles = $('roles');
    if (!d.byRole.length) empty(roles, 4, '기록이 없습니다.');
    for (const r of d.byRole) {
      const tr = document.createElement('tr');
      tr.append(cell(ROLE[r.role] || r.role), cell(r.games, 'num'), cell(r.wins, 'num'), cell(`${r.winRate}%`, 'num'));
      roles.append(tr);
    }

    const recent = $('recent');
    if (!d.recent.length) empty(recent, 4, '아직 경기가 없습니다.');
    for (const m of d.recent) {
      const tr = document.createElement('tr');
      const dl = m.ratingDelta;
      tr.append(
        cell(m.roomTitle),
        cell(ROLE[m.role] || m.role),
        cell(RESULT[m.result] + (m.counted ? '' : ' (미반영)')),
        cell(dl > 0 ? `+${dl}` : `${dl}`, `num ${dl > 0 ? 'pos' : dl < 0 ? 'neg' : ''}`),
      );
      recent.append(tr);
    }
  } catch (e) {
    $('msg').textContent = e.message;
  }
})();
