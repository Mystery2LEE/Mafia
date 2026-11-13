const $ = (id) => document.getElementById(id);
const ROLE = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const RESULT = { win: '승리', lose: '패배', left: '이탈' };

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

(async () => {
  await requireLogin();
  try {
    const d = await api('/api/profile');
    const u = d.user;
    setupAvatar(u);
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
