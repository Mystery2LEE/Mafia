const $ = (id) => document.getElementById(id);
const ROLE = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const RESULT = { win: '승리', lose: '패배', left: '이탈' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

(async () => {
  await requireLogin();
  try {
    const d = await api('/api/profile');
    const u = d.user;
    $('hav').innerHTML = Icons.avatar(u.id, 92);
    $('nick').textContent = u.nickname;
    const tier = $('tier');
    tier.className = `tier tier-${u.tier.key}`;
    tier.innerHTML = Icons.tierCrest(u.tier.key, 18);
    tier.append(document.createTextNode(u.tier.name));
    $('rank').textContent = `전체 ${u.rank}위`;
    $('crest').innerHTML = Icons.tierCrest(u.tier.key, 84);
    $('rating').textContent = u.rating;
    $('record').textContent = `${d.totals.wins}승 ${d.totals.games - d.totals.wins}패`;
    $('winrate').textContent = `${d.totals.winRate}%`;

    $('cur-label').textContent = `${u.tier.name} ${u.currentTierMin}~`;
    if (u.nextTier) {
      const span = u.nextTier.min - u.currentTierMin;
      const pct = Math.min(100, Math.max(0, ((u.rating - u.currentTierMin) / span) * 100));
      $('progress').style.width = `${pct}%`;
      $('next-label').textContent = `${u.nextTier.name}까지 ${Math.max(0, u.nextTier.min - u.rating)}점`;
    } else {
      $('progress').style.width = '100%';
      $('next-label').textContent = '최고 티어';
    }

    const roles = $('roles');
    if (!d.byRole.length) roles.append(el('div', 'empty-note', '아직 기록이 없습니다.'));
    for (const r of d.byRole) {
      const row = el('div', 'role-row');
      const rn = el('div', 'rn');
      const img = document.createElement('img');
      img.src = `/img/${r.role}.svg`;
      img.alt = '';
      rn.append(img, document.createTextNode(ROLE[r.role] || r.role));
      const bar = el('div', 'bar');
      const fill = document.createElement('i');
      fill.style.width = `${r.winRate}%`;
      bar.append(fill);
      row.append(rn, bar, el('div', 'rs', `${r.wins}/${r.games} · ${r.winRate}%`));
      roles.append(row);
    }

    const recent = $('recent');
    if (!d.recent.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '아직 경기가 없습니다.');
      td.colSpan = 4;
      tr.append(td);
      recent.append(tr);
    }
    for (const m of d.recent) {
      const tr = el('tr');
      const dl = m.ratingDelta;
      const res = el('td');
      const chip = el('span', `chip ${m.result}`, RESULT[m.result] || m.result);
      res.append(chip);
      if (!m.counted) res.append(el('span', 'muted', ' 미반영'));
      tr.append(
        el('td', '', m.roomTitle),
        el('td', '', ROLE[m.role] || m.role),
        res,
        el('td', `num ${dl > 0 ? 'pos' : dl < 0 ? 'neg' : ''}`, dl > 0 ? `+${dl}` : `${dl}`),
      );
      recent.append(tr);
    }
  } catch (e) {
    $('msg').textContent = e.message;
  }
})();
