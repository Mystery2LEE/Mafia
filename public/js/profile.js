const $ = (id) => document.getElementById(id);
const ROLE = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민', jester: '광대' };
const RESULT = { win: '승리', lose: '패배', left: '이탈' };
const TEAM = { mafia: '마피아 팀', citizen: '시민 팀', jester: '광대' };
const SVGNS = 'http://www.w3.org/2000/svg';
const viewId = new URLSearchParams(location.search).get('id'); // 다른 사람 프로필 (없으면 내 프로필)

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** 선택한 이미지를 가운데 정사각형으로 잘라 192x192 JPEG 로 줄인다 (서버 저장 용량/전송량 절약) */
function resizeToJpeg(file, size = 192) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      if (!s) return reject(new Error('이미지를 읽을 수 없습니다.'));
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; // 투명 PNG 배경
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 변환하지 못했습니다.'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 파일이 아닙니다.')); };
    img.src = url;
  });
}

function setupAvatar(u) {
  const show = (av) => {
    $('hav').innerHTML = Icons.avatar(u.id, 92, av);
    $('hav-reset').hidden = !av;
  };
  const say = (t, ok) => { const m = $('hav-msg'); m.textContent = t; m.classList.toggle('ok', !!ok); };
  $('hav-cam').innerHTML = Icons.svg('camera', 16);
  show(u.av);
  const file = $('hav-file');
  const pick = () => file.click();
  $('hav-btn').onclick = pick;
  $('hav-change').onclick = pick;
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return say('15MB 이하 이미지를 골라 주세요.');
    say('올리는 중...', true);
    try {
      const r = await sendAvatar(await resizeToJpeg(f));
      show(r.av);
      say('프로필 사진을 바꿨습니다.', true);
    } catch (e) { say(e.message); }
  };
  $('hav-reset').onclick = async () => {
    try { await removeAvatar(); show(0); say('기본 사진으로 되돌렸습니다.', true); } catch (e) { say(e.message); }
  };
}

const fmtDate = (t) => {
  const d = new Date(`${String(t).replace(' ', 'T')}Z`); // SQLite datetime 은 UTC
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
};
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** 레이팅 추이: 경기 후 레이팅을 이은 선 그래프 (점 색은 그 판의 점수 증감) */
function drawChart(history) {
  const box = $('chart');
  if (history.length < 2) { box.append(el('div', 'empty-note', '경기가 2판 이상 쌓이면 추이가 그려집니다.')); return; }
  const W = 600, H = 150, L = 38, R = 10, T = 12, B = 10;
  const vals = history.map((h) => h.rating);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 20) { lo -= 10; hi += 10; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => L + ((W - L - R) * i) / (history.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `최근 ${history.length}경기 레이팅 추이`);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const v of [hi - pad, (hi + lo) / 2, lo + pad]) {
    add('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) });
    add('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v)));
  }
  const pts = history.map((h, i) => `${x(i).toFixed(1)},${y(h.rating).toFixed(1)}`);
  add('polygon', { class: 'area', points: `${x(0)},${H - B} ${pts.join(' ')} ${x(history.length - 1)},${H - B}` });
  add('polyline', { class: 'line', points: pts.join(' ') });
  history.forEach((h, i) => {
    const dot = add('circle', {
      class: `dot ${h.delta > 0 ? 'win' : h.delta < 0 ? 'lose' : ''}`, cx: x(i), cy: y(h.rating), r: i === history.length - 1 ? 4.5 : 3,
    });
    const t = document.createElementNS(SVGNS, 'title');
    t.textContent = `${h.rating} (${signed(h.delta)})`;
    dot.append(t);
  });
  box.append(svg);
}

function winRow(icon, label, wins, games, winRate, cls = '') {
  const row = el('div', `role-row ${cls}`);
  const rn = el('div', 'rn');
  rn.append(icon, document.createTextNode(label));
  const bar = el('div', 'bar');
  const fill = document.createElement('i');
  fill.style.width = `${winRate}%`;
  bar.append(fill);
  row.append(rn, bar, el('div', 'rs', `${wins}/${games} · ${winRate}%`));
  return row;
}

function matchRow(m) {
  const tr = el('tr', 'clickable');
  tr.tabIndex = 0;
  const res = el('td');
  res.append(el('span', `chip ${m.result}`, RESULT[m.result] || m.result));
  if (!m.counted) res.append(el('span', 'muted', ' 미반영'));
  const dl = m.ratingDelta;
  tr.append(el('td', 'date', fmtDate(m.playedAt)), el('td', '', m.roomTitle), el('td', '', ROLE[m.role] || m.role), res,
    el('td', `num ${dl > 0 ? 'pos' : dl < 0 ? 'neg' : ''}`, signed(dl)));
  const open = () => showMatch(m.matchId);
  tr.onclick = open;
  tr.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  return tr;
}

let myId = null;

/** 경기 상세: 참가자 전원의 직업/결과/점수 */
async function showMatch(id) {
  try {
    const m = await api(`/api/match/${id}`);
    $('md-title').textContent = m.roomTitle;
    $('md-sub').textContent = `${fmtDate(m.playedAt)} · ${TEAM[m.winnerTeam] || '시민 팀'} 승리`;
    const rows = $('md-rows');
    rows.replaceChildren();
    for (const p of m.players) {
      const tr = el('tr', p.userId === myId ? 'me' : '');
      const nameTd = el('td');
      const a = el('a', '', p.nickname);
      a.href = `/profile.html?id=${p.userId}`;
      nameTd.append(a);
      const roleTd = el('td');
      const rc = el('div', 'rolecell');
      const img = document.createElement('img');
      img.src = `/img/${p.role}.svg`;
      img.alt = '';
      rc.append(img, document.createTextNode(ROLE[p.role] || p.role));
      roleTd.append(rc);
      const res = el('td');
      res.append(el('span', `chip ${p.result}`, RESULT[p.result] || p.result));
      res.append(el('span', 'muted', p.survived ? ' 생존' : ' 사망'));
      if (!p.counted) res.append(el('span', 'muted', ' · 미반영'));
      tr.append(nameTd, roleTd, res, el('td', `num ${p.ratingDelta > 0 ? 'pos' : p.ratingDelta < 0 ? 'neg' : ''}`, signed(p.ratingDelta)));
      rows.append(tr);
    }
    $('md').classList.remove('hidden');
    $('md-x').focus();
  } catch (e) { $('msg').textContent = e.message; }
}

(async () => {
  const meUser = await requireLogin();
  myId = meUser?.id ?? null;
  const close = () => $('md').classList.add('hidden');
  $('md-x').onclick = close;
  $('md').onclick = (e) => { if (e.target === $('md')) close(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  try {
    const d = await api(viewId ? `/api/profile?id=${encodeURIComponent(viewId)}` : '/api/profile');
    const u = d.user;
    if (u.isMe) {
      myId = u.id;
      setupAvatar(u);
    } else {
      $('hav').innerHTML = Icons.avatar(u.id, 92, u.av);
      $('hav-btn').disabled = true;
      $('hav-btn').style.cursor = 'default';
      document.querySelector('.hav-actions').remove();
      $('hav-cam').remove();
      document.title = `마피아 - ${u.nickname}`;
    }
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

    const st = d.streak;
    $('streak').textContent = st.count ? `${st.count}${st.type === 'win' ? '연승' : '연패'}` : '-';
    $('streak').className = st.type === 'win' ? 'pos' : st.type === 'lose' ? 'neg' : '';
    $('best-streak').textContent = st.bestWin ? `${st.bestWin}연승` : '-';
    $('survival').textContent = d.totals.games ? `${d.survivalRate}%` : '-';
    $('left-early').textContent = `${d.leftEarly}회`;

    drawChart(d.ratingHistory);

    const teams = $('teams');
    const roles = $('roles');
    if (!d.byRole.length) roles.append(el('div', 'empty-note', '아직 기록이 없습니다.'));
    for (const t of d.byTeam) {
      teams.append(winRow(el('span', `tdot ${t.team}`), TEAM[t.team] || t.team, t.wins, t.games, t.winRate, 'team'));
    }
    for (const r of d.byRole) {
      const img = document.createElement('img');
      img.src = `/img/${r.role}.svg`;
      img.alt = '';
      roles.append(winRow(img, ROLE[r.role] || r.role, r.wins, r.games, r.winRate));
    }

    const recent = $('recent');
    if (!d.recent.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '아직 경기가 없습니다.');
      td.colSpan = 5;
      tr.append(td);
      recent.append(tr);
    }
    for (const m of d.recent) recent.append(matchRow(m));

    // 더 보기: 지금 보이는 가장 오래된 경기보다 이전 20건
    let oldest = d.recent.length ? d.recent[d.recent.length - 1].matchId : null;
    const more = $('more');
    more.hidden = d.recent.length < 20;
    more.onclick = async () => {
      more.disabled = true;
      try {
        const q = `before=${oldest}${viewId ? `&id=${encodeURIComponent(viewId)}` : ''}`;
        const { matches } = await api(`/api/profile/matches?${q}`);
        for (const m of matches) recent.append(matchRow(m));
        if (matches.length) oldest = matches[matches.length - 1].matchId;
        more.hidden = matches.length < 20;
      } catch (e) { $('msg').textContent = e.message; }
      more.disabled = false;
    };
  } catch (e) {
    $('msg').textContent = e.message;
  }
})();
