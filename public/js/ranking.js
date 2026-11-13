const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const cell = (text, cls) => el('td', cls, text);
const tierBadge = (t) => {
  const b = el('span', `tier tier-${t.key}`);
  b.innerHTML = Icons.tierCrest(t.key, 18); // 생성된 SVG
  b.append(document.createTextNode(t.name));
  return b;
};

(async () => {
  await requireLogin();
  try {
    const { players } = await api('/api/ranking');
    if (!players.length) {
      document.getElementById('msg').textContent = '아직 기록이 없습니다.';
      return;
    }

    // 시상대: 2위 - 1위 - 3위 순서로 배치
    const podium = document.getElementById('podium');
    const order = [players[1], players[0], players[2]].filter(Boolean);
    for (const p of order) {
      const pod = el('div', `pod p${p.rank}${p.isMe ? ' me' : ''}`);
      pod.append(el('div', 'medal', String(p.rank)));
      const pav = el('div', 'pav');
      pav.innerHTML = Icons.avatar(p.id, 78);
      pod.append(pav, el('div', 'nm', p.nickname), el('div', 'rt', String(p.rating)),
        el('div', 'wr', `${p.wins}승 ${p.games - p.wins}패 · ${p.winRate}%`), tierBadge(p.tier));
      podium.append(pod);
    }

    const body = document.getElementById('rows');
    for (const p of players) {
      const tr = el('tr', p.isMe ? 'me' : '');
      const tierTd = el('td');
      tierTd.append(tierBadge(p.tier));
      tr.append(cell(String(p.rank), 'rk'), cell(p.nickname), tierTd, cell(String(p.rating), 'num'),
        cell(`${p.wins}승 ${p.games - p.wins}패`, 'num'), cell(`${p.winRate}%`, 'num'));
      body.append(tr);
    }
  } catch (e) {
    document.getElementById('msg').textContent = e.message;
  }
})();
