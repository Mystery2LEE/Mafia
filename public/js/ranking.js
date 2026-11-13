const cell = (text, cls) => {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
};

(async () => {
  await requireLogin();
  try {
    const { players } = await api('/api/ranking');
    const body = document.getElementById('rows');
    if (!players.length) document.getElementById('msg').textContent = '아직 기록이 없습니다.';
    for (const p of players) {
      const tr = document.createElement('tr');
      if (p.isMe) tr.className = 'me';
      const tierTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `tier tier-${p.tier.key}`;
      badge.textContent = p.tier.name;
      tierTd.append(badge);
      tr.append(cell(p.rank), cell(p.nickname), tierTd, cell(p.rating, 'num'),
        cell(`${p.wins}승 ${p.games - p.wins}패`, 'num'), cell(`${p.winRate}%`, 'num'));
      body.append(tr);
    }
  } catch (e) {
    document.getElementById('msg').textContent = e.message;
  }
})();
