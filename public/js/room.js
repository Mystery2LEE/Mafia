// 게임방 클라이언트. 서버가 내려주는 상태를 그리기만 한다 (판정은 전부 서버).
// 연출은 window.Anim 의 훅을 호출해서 처리한다 (anim.js). 아이콘/아바타는 ui.js (이모지 미사용).
const $ = (id) => document.getElementById(id);
const A = () => window.Anim || {};

const ROLE_NAMES = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const PHASE_NAMES = {
  role_reveal: '직업 공개', night: '밤', morning: '아침 결과', discussion: '낮 토론',
  vote: '투표', defense: '최후 변론', verdict: '찬반 투표', execution: '처형',
};
const PHASE_ICONS = {
  waiting: 'users', role_reveal: 'eye', night: 'moon', morning: 'sun', discussion: 'chat',
  vote: 'ballot', defense: 'mic', verdict: 'scales', execution: 'gavel',
};
const TAB_NAMES = { public: '전체', mafia: '마피아', dead: '사망자', system: '알림' };
const TAB_ICONS = { public: 'chat', mafia: 'fedora', dead: 'ghost', system: 'bell' };
const ERRORS = {
  not_host: '방장만 시작할 수 있습니다.', not_enough_players: '최소 4명이 필요합니다.',
  already_started: '이미 시작되었습니다.', forbidden: '지금은 할 수 없습니다.',
  wrong_phase: '지금은 할 수 없는 단계입니다.', invalid_target: '선택할 수 없는 대상입니다.',
  no_ability: '능력이 없는 직업입니다.', rate_limited: '너무 빠르게 보내고 있습니다.',
  invalid_text: '1~200자로 입력하세요.', invalid_vote: '잘못된 요청입니다.',
};
const RING = 113.1; // 타이머 원의 둘레(2πr, r=18)

let socket;
let state = null;
let gotState = false;
const chat = { public: [], mafia: [], dead: [], system: [] };
const unread = { public: 0, mafia: 0, dead: 0, system: 0 };
let activeTab = 'public';
let tally = {};
let revealed = {}; // userId -> role (투표 처형으로 공개된 직업)
let phaseStart = null;

// ---------- 유틸 ----------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const nickOf = (id) => state?.players.find((p) => p.id === id)?.nickname ?? '?';
const flash = (msg) => { $('center-msg').textContent = msg; };

// ---------- 렌더링 ----------
function render() {
  if (!state) return;
  const playing = state.status === 'playing';
  const phase = playing ? state.phase : null;

  document.body.classList.toggle('night', phase === 'night');
  document.body.classList.toggle('ghost', playing && !!state.you && !state.you.alive); // 사망자 화면 채도 감소
  $('room-title').textContent = state.title;
  const custom = state.mafiaCount != null ? ` · 마피아 ${state.mafiaCount}명 설정` : '';
  $('room-sub').textContent = playing
    ? `${state.day}일차 · 생존 ${state.players.filter((p) => !p.left && p.alive).length}명${state.customRules ? ' · 랭킹 미반영' : ''}`
    : `대기실 · ${state.players.length}/${state.maxPlayers}명${state.hasPassword ? ' · 비밀방' : ''}${custom}`;
  $('phase-label').textContent = playing ? (PHASE_NAMES[phase] || '') : '대기실';
  $('phase-ico').innerHTML = Icons.svg(PHASE_ICONS[playing ? phase : 'waiting'] || 'users', 20);

  renderRole();
  renderRing();
  renderActions();
  renderTabs();
  renderLog();
  renderChatInput();
}

function renderRole() {
  const dos = $('role-card');
  const you = state.you;
  if (state.status !== 'playing' || !you) { dos.classList.add('hidden'); return; }
  dos.classList.remove('hidden');
  const flip = $('role-flip');
  if (!A().holdRoleCard) flip.classList.add('flipped'); // 직업 배정 연출 중에는 anim.js 가 직접 뒤집는다
  $('role-front-ico').innerHTML = Icons.svg('fedora', 34);
  $('role-img').src = `/img/${you.role}.svg`;
  $('role-img').alt = ROLE_NAMES[you.role];
  $('role-name').textContent = ROLE_NAMES[you.role];
  dos.classList.toggle('mafia', you.role === 'mafia');
  $('role-mates').textContent = you.mafiaTeam
    ? `동료 ${you.mafiaTeam.filter((m) => m.id !== state.youId).map((m) => m.nickname).join(', ') || '없음'}` : '';
}

function targetable(p) {
  if (state.status !== 'playing' || !state.you?.alive || !p.alive || p.left) return false;
  const phase = state.phase;
  const role = state.you.role;
  if (phase === 'vote') return true;
  if (phase !== 'night') return false;
  if (role === 'mafia') return !state.you.mafiaTeam.some((m) => m.id === p.id);
  if (role === 'doctor') return true;
  if (role === 'police') return p.id !== state.youId;
  return false;
}

function selectedTarget() {
  const you = state.you;
  if (!you) return null;
  if (state.phase === 'vote') return you.vote ?? null;
  if (state.phase === 'night') return you.nightTarget ?? null;
  return null;
}

function renderRing() {
  const ring = $('ring');
  ring.replaceChildren();
  const list = state.players.filter((p) => !p.left);
  const playing = state.status === 'playing';
  const total = Math.max(1, list.filter((p) => p.alive !== false).length);
  const sel = selectedTarget();
  const policeLog = state.you?.policeLog || [];
  const mates = state.you?.mafiaTeam || [];
  const picks = state.you?.mafiaPicks || {};

  list.forEach((p, i) => {
    const ang = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    const card = el('button', 'pcard');
    card.type = 'button';
    card.dataset.id = p.id;
    card.style.left = `${50 + 43 * Math.cos(ang)}%`;
    card.style.top = `${50 + 41 * Math.sin(ang)}%`;
    const dead = playing && p.alive === false;
    if (dead) card.classList.add('dead');
    if (p.id === state.youId) card.classList.add('me');
    if (!p.connected) card.classList.add('offline');
    if (playing && state.defendantId === p.id) card.classList.add('defendant');
    const can = targetable(p);
    if (can) card.classList.add('selectable');
    const isSel = sel === p.id;
    if (isSel) card.classList.add('selected');

    // 아바타: id 로 결정되는 초상화 (생성된 SVG 문자열이라 사용자 입력이 섞이지 않는다)
    const av = el('div', 'avatar');
    const portrait = el('div', 'portrait');
    portrait.innerHTML = Icons.avatar(p.id, 64, p.av);
    av.append(portrait);
    if (dead) av.append(stampEl('dead', Icons.svg('cross', 34)));
    const log = policeLog.filter((l) => l.targetId === p.id).at(-1);
    if (log) av.append(stampEl(log.isMafia ? 'mafia' : 'clean', log.isMafia ? '마피아' : '시민'));
    if (tally[p.id]) {
      const vc = el('span', 'votecount');
      vc.insertAdjacentHTML('beforeend', Icons.svg('ballot', 12));
      vc.append(document.createTextNode(String(tally[p.id])));
      av.append(vc);
    }
    if (isSel) {
      const pb = el('span', 'pick-badge');
      pb.innerHTML = Icons.svg('target', 14);
      av.append(pb);
    }
    card.append(av);

    const plate = el('span', 'plate');
    if (p.isHost) plate.insertAdjacentHTML('beforeend', Icons.svg('crown', 12));
    if (p.tier) {
      const t = el('span', 'plate-tier');
      t.title = Icons.tierName(p.tier);
      t.innerHTML = Icons.tierCrest(p.tier, 14); // 생성된 SVG (모르는 키는 기본 문장)
      plate.append(t);
    }
    plate.append(document.createTextNode(p.nickname));
    card.append(plate);

    let tag = '';
    let tagCls = 'ptag';
    if (revealed[p.id]) { tag = ROLE_NAMES[revealed[p.id]]; tagCls += ' role'; }
    else if (mates.some((m) => m.id === p.id) && p.id !== state.youId) { tag = '마피아 동료'; tagCls += ' mafia'; }
    else if (Object.values(picks).includes(p.id) && state.phase === 'night') { tag = '지목됨'; tagCls += ' mafia'; }
    else if (!p.connected) tag = '연결 끊김';
    else if (p.id === state.youId) tag = '나';
    card.append(el('div', tagCls, tag));

    if (state.phase === 'vote' && playing) {
      const bar = el('div', 'votebar');
      const fill = document.createElement('i');
      fill.style.width = `${((tally[p.id] || 0) / total) * 100}%`;
      bar.append(fill);
      card.append(bar);
    }
    if (can) card.onclick = () => onPlayerClick(p);
    ring.append(card);
  });
}

function stampEl(kind, content) {
  const s = el('span', `stamp ${kind}`);
  if (content.startsWith('<')) s.innerHTML = content; else s.textContent = content;
  return s;
}

function renderActions() {
  const box = $('actions');
  box.replaceChildren();
  const msg = $('center-msg');
  const you = state.you;

  if (state.status === 'waiting') {
    const n = state.players.length;
    if (state.hostId === state.youId) {
      const b = el('button', 'btn-sm');
      b.innerHTML = `${Icons.svg('gavel', 16)}게임 시작`;
      b.disabled = n < 4;
      b.onclick = startGame;
      box.append(b);
      msg.textContent = n < 4 ? `최소 4명이 필요합니다 (${n}/${state.maxPlayers})` : `${n}/${state.maxPlayers}명 · 시작할 수 있습니다`;
    } else {
      msg.textContent = `방장이 시작하기를 기다리는 중 (${n}/${state.maxPlayers})`;
    }
    return;
  }
  if (!you) return;
  const phase = state.phase;
  if (!you.alive) { msg.textContent = '당신은 사망했습니다. 사망자 채팅으로 대화할 수 있습니다.'; return; }

  switch (phase) {
    case 'role_reveal': msg.textContent = `당신의 직업은 ${ROLE_NAMES[you.role]}입니다.`; break;
    case 'night':
      msg.textContent = ({
        mafia: '죽일 사람을 선택하세요. 마피아 채팅으로 상의할 수 있습니다.',
        doctor: '보호할 사람을 선택하세요.',
        police: '조사할 사람을 선택하세요.',
      })[you.role] || '밤입니다. 조용히 기다리세요.';
      break;
    case 'morning': msg.textContent = '아침이 밝았습니다.'; break;
    case 'discussion':
      msg.textContent = state.day === 1 && !state.firstDayVote
        ? '첫날은 토론만 합니다. 처형 투표는 없고, 밤이 되면 능력이 시작됩니다.'
        : '토론 시간입니다. 의심되는 사람을 찾아보세요.';
      break;
    case 'vote': {
      msg.textContent = '처형할 사람을 선택하세요.';
      if (you.vote != null) {
        const b = el('button', 'btn-sm ghost', '투표 취소');
        b.onclick = () => castVote(null);
        box.append(b);
      }
      break;
    }
    case 'defense': msg.textContent = `${nickOf(state.defendantId)}님의 최후 변론`; break;
    case 'verdict':
      if (state.defendantId === state.youId) { msg.textContent = '당신의 처형 여부를 투표 중입니다.'; break; }
      msg.textContent = `${nickOf(state.defendantId)}님을 처형할까요?`;
      for (const [label, agree, cls, icon] of [['찬성', true, 'agree', 'check'], ['반대', false, 'disagree', 'cross']]) {
        const b = el('button', `btn-sm ${cls}`);
        b.innerHTML = `${Icons.svg(icon, 16)}${label}`;
        if (you.verdict === agree) b.classList.add('on');
        b.onclick = () => castVerdict(agree);
        box.append(b);
      }
      break;
    case 'execution': msg.textContent = '처형이 집행됩니다...'; break;
    default: msg.textContent = '';
  }
}

function renderTabs() {
  const tabs = $('tabs');
  tabs.replaceChildren();
  const read = state.chat.read;
  if (!read.includes(activeTab)) activeTab = 'public';
  for (const ch of ['public', 'mafia', 'dead', 'system']) {
    if (!read.includes(ch)) continue;
    const b = el('button', ch === activeTab ? 'active' : '');
    b.type = 'button';
    b.innerHTML = Icons.svg(TAB_ICONS[ch], 15);
    b.append(document.createTextNode(TAB_NAMES[ch]));
    if (unread[ch] > 0 && ch !== activeTab) b.append(el('span', 'unread', String(unread[ch])));
    b.onclick = () => { activeTab = ch; unread[ch] = 0; render(); };
    tabs.append(b);
  }
}

function renderLog() {
  const log = $('log');
  log.replaceChildren();
  log.classList.toggle('dead-tab', activeTab === 'dead');
  for (const m of chat[activeTab]) {
    const mine = m.from && m.from.id === state.youId;
    const li = el('li', m.channel === 'system' ? 'sys' : mine ? 'mine' : '');
    if (m.channel === 'system') {
      li.textContent = m.text;
    } else {
      if (!mine && m.from) {
        const from = el('span', 'from');
        const tk = state && state.players.find((q) => q.id === m.from.id)?.tier;
        if (tk) {
          const t = el('span', 'from-tier');
          t.title = Icons.tierName(tk);
          t.innerHTML = Icons.tierCrest(tk, 13);
          from.append(t);
        }
        from.append(document.createTextNode(m.from.nickname));
        li.append(from);
      }
      li.append(el('span', 'body', m.text));
    }
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;
}

function renderChatInput() {
  const input = $('chat-input');
  const can = state.chat.write.includes(activeTab);
  input.disabled = !can;
  $('chat-form').querySelector('button').disabled = !can;
  input.placeholder = can ? '메시지 입력'
    : activeTab === 'system' ? '알림 채널입니다' : '지금은 이 채널에 쓸 수 없습니다';
}

// ---------- 행동 ----------
function startGame() {
  socket.emit('game:start', (res) => { if (res.error) flash(ERRORS[res.error] || '시작할 수 없습니다.'); });
}

function onPlayerClick(p) {
  if (state.phase === 'vote') return castVote(p.id);
  if (state.phase === 'night') return nightAct(p);
}

function nightAct(p) {
  socket.emit('night:action', { targetId: p.id }, (res) => {
    if (res.error) return flash(ERRORS[res.error] || '선택할 수 없습니다.');
    state.you.nightTarget = p.id;
    if (state.you.role === 'police') A().investigate?.(p.id);
    render();
  });
}

function castVote(targetId) {
  socket.emit('vote:cast', { targetId }, (res) => {
    if (res.error) return flash(ERRORS[res.error] || '투표할 수 없습니다.');
    state.you.vote = targetId;
    render();
  });
}

function castVerdict(agree) {
  socket.emit('verdict:cast', { agree }, (res) => {
    if (res.error) return flash(ERRORS[res.error] || '투표할 수 없습니다.');
    state.you.verdict = agree;
    render();
  });
}

// ---------- 소켓 이벤트 ----------
function addMessage(m) {
  const list = chat[m.channel];
  if (!list) return;
  list.push(m);
  if (list.length > 300) list.shift();
  if (m.channel !== activeTab) unread[m.channel]++;
}

function wire() {
  socket.on('connect_error', () => { location.href = '/login.html'; });
  socket.on('session:replaced', () => { document.body.textContent = '다른 탭에서 접속하여 이 탭의 연결이 종료되었습니다.'; });
  // 연결 직후에도 room:state가 오지 않으면 참여 중인 방이 없는 것 → 로비로
  socket.on('lobby:update', () => { if (!gotState) location.href = '/lobby.html'; });

  socket.on('room:state', (s) => {
    const wasAlive = state?.you?.alive;
    const prevStatus = state?.status;
    state = s;
    gotState = true;
    if (s.tally) tally = s.tally;
    if (s.phase !== 'vote') tally = {};
    if (s.status === 'waiting') revealed = {};
    if (prevStatus === 'playing' && wasAlive && s.you && !s.you.alive) {
      activeTab = 'dead'; // 사망하면 사망자 채팅 탭 자동 활성화
      A().iDied?.();
    }
    if (!phaseStart || !s.endsAt) phaseStart = Date.now();
    render();
  });

  socket.on('role:assigned', (r) => {
    chat.public = []; chat.system = []; chat.mafia = []; chat.dead = [];
    revealed = {};
    A().roleAssigned?.(r);
  });
  socket.on('phase:change', (p) => {
    phaseStart = Date.now();
    if (state) { state.endsAt = p.endsAt; state.phase = p.phase; state.day = p.day; }
    A().phaseChange?.(p);
  });
  socket.on('vote:update', (v) => {
    tally = v.tally;
    if (state) render();
    A().voteUpdate?.(tally);
  });
  socket.on('vote:result', (r) => A().voteResult?.(r));
  socket.on('verdict:result', (r) => A().verdictResult?.(r));
  socket.on('night:saved', () => A().saved?.());
  socket.on('mafia:picks', ({ picks }) => { if (state?.you) { state.you.mafiaPicks = picks; render(); } });
  socket.on('police:result', (r) => {
    if (!state?.you) return;
    (state.you.policeLog ||= []).push({ ...r });
    render(); // 스탬프가 먼저 그려진 뒤, 연출이 그 요소를 찾아 애니메이션한다
    A().policeResult?.(r);
  });
  socket.on('player:killed', (k) => {
    if (k.role) revealed[k.id] = k.role;
    A().killed?.(k);
  });
  socket.on('game:over', (r) => showOver(r));
  // 점수는 서버가 계산해서 본인 몫만 보내 준다 (game:over 직후 도착)
  socket.on('game:rating', (r) => A().rating?.(r, $('over-rating')));

  socket.on('chat:history', ({ channel, messages }) => {
    if (!chat[channel]) return;
    chat[channel] = messages.slice();
    if (state) render();
  });
  socket.on('chat:message', (m) => { addMessage(m); if (state) { renderTabs(); renderLog(); } });
}

function showOver(r) {
  const mafiaWin = r.winner === 'mafia';
  $('over-title').textContent = mafiaWin ? '마피아 팀 승리' : '시민 팀 승리';
  $('over-kicker').textContent = mafiaWin ? 'THE MAFIA TAKES THE CITY' : 'JUSTICE PREVAILS';
  document.querySelector('.over-card').classList.toggle('win-mafia', mafiaWin);
  const list = $('over-roles');
  list.replaceChildren();
  r.roles.forEach((x) => {
    const li = el('li');
    const flip = el('div', 'flip');
    const front = el('div', 'side front');
    front.innerHTML = Icons.svg('fedora', 30);
    const rev = el('div', 'side rev');
    const img = document.createElement('img');
    img.src = `/img/${x.role}.svg`;
    img.alt = ROLE_NAMES[x.role];
    rev.append(img);
    flip.append(front, rev);
    // 이름표는 카드 밖에 두어 카드가 가려지거나 잘리지 않게 한다
    const cap = el('div', `cap${x.alive ? '' : ' dead'}`);
    if (!x.alive) cap.insertAdjacentHTML('beforeend', Icons.svg('cross', 12));
    cap.append(document.createTextNode(x.nickname));
    li.append(flip, cap);
    list.append(li);
  });
  $('over-rating').textContent = '';
  $('over').classList.remove('hidden');
  A().gameOver?.(r);
}

// ---------- 타이머 (원형 게이지) ----------
setInterval(() => {
  const ring = $('timerring');
  const box = $('timer-box');
  if (!state?.endsAt || state.status !== 'playing') {
    $('timer').textContent = '';
    ring.style.strokeDashoffset = '0';
    box.classList.remove('low');
    return;
  }
  const remain = Math.max(0, state.endsAt - Date.now());
  const total = Math.max(remain, state.endsAt - (phaseStart || Date.now()));
  $('timer').textContent = Math.ceil(remain / 1000);
  ring.style.strokeDashoffset = String(RING * (1 - remain / total));
  box.classList.toggle('low', remain <= 5000);
}, 150);

async function init() {
  await requireLogin();
  socket = io();
  wire();

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    socket.emit('chat:send', { channel: activeTab, text }, (res) => {
      if (res.error) flash(ERRORS[res.error] || '전송할 수 없습니다.');
    });
    $('chat-input').value = '';
  });
  $('over-close').onclick = () => $('over').classList.add('hidden');
  $('leave').onclick = () => socket.emit('room:leave', () => { location.href = '/lobby.html'; });
}

init();
