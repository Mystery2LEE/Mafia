// 게임방 클라이언트. 서버가 내려주는 상태를 그리기만 한다 (판정은 전부 서버).
// 연출은 window.Anim 의 훅을 호출해서 처리한다 (anim.js).
const $ = (id) => document.getElementById(id);
const A = () => window.Anim || {};

const ROLE_NAMES = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const PHASE_NAMES = {
  role_reveal: '직업 공개', night: '밤', morning: '아침 결과', discussion: '낮 토론',
  vote: '투표', defense: '최후 변론', verdict: '찬반 투표', execution: '처형',
};
const TAB_NAMES = { public: '전체', mafia: '마피아', dead: '사망자 👻', system: '알림' };
const ERRORS = {
  not_host: '방장만 시작할 수 있습니다.', not_enough_players: '최소 4명이 필요합니다.',
  already_started: '이미 시작되었습니다.', forbidden: '지금은 할 수 없습니다.',
  wrong_phase: '지금은 할 수 없는 단계입니다.', invalid_target: '선택할 수 없는 대상입니다.',
  no_ability: '능력이 없는 직업입니다.', rate_limited: '너무 빠르게 보내고 있습니다.',
  invalid_text: '1~200자로 입력하세요.', invalid_vote: '잘못된 요청입니다.',
};

let socket;
let state = null;
let gotState = false;
const chat = { public: [], mafia: [], dead: [], system: [] };
const unread = { public: 0, mafia: 0, dead: 0, system: 0 };
let activeTab = 'public';
let tally = {};
let revealed = {}; // userId -> role (투표 처형으로 공개된 직업)
let phaseStart = null;
let lastOver = null;

// ---------- 유틸 ----------
const hue = (id) => (id * 67) % 360;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const me = () => state?.players.find((p) => p.id === state.youId);
const nickOf = (id) => state?.players.find((p) => p.id === id)?.nickname ?? '?';
const flash = (msg) => { $('center-msg').textContent = msg; };

// ---------- 렌더링 ----------
function render() {
  if (!state) return;
  const playing = state.status === 'playing';
  const phase = playing ? state.phase : null;

  document.body.classList.toggle('night', phase === 'night');
  document.body.classList.toggle('ghost', playing && !!state.you && !state.you.alive); // 사망자 화면 채도 감소
  $('room-title').textContent = (state.hasPassword ? '🔒 ' : '') + state.title;
  $('phase-label').textContent = playing ? `${state.day}일차 · ${PHASE_NAMES[phase] || ''}` : '대기실';

  renderRole();
  renderRing();
  renderActions();
  renderTabs();
  renderLog();
  renderChatInput();
}

function renderRole() {
  const card = $('role-card');
  const you = state.you;
  if (state.status !== 'playing' || !you) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  if (!A().holdRoleCard) card.classList.add('flipped'); // 직업 배정 연출 중에는 anim.js 가 직접 뒤집는다
  $('role-img').src = `/img/${you.role}.svg`;
  $('role-img').alt = ROLE_NAMES[you.role];
  $('role-name').textContent = ROLE_NAMES[you.role];
  card.classList.toggle('mafia', you.role === 'mafia');
  $('role-mates').textContent = you.mafiaTeam
    ? `동료: ${you.mafiaTeam.filter((m) => m.id !== state.youId).map((m) => m.nickname).join(', ') || '없음'}` : '';
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
    card.style.left = `${50 + 41 * Math.cos(ang)}%`;
    card.style.top = `${50 + 41 * Math.sin(ang)}%`;
    const dead = playing && p.alive === false;
    if (dead) card.classList.add('dead');
    if (p.id === state.youId) card.classList.add('me');
    if (!p.connected) card.classList.add('offline');
    if (playing && state.defendantId === p.id) card.classList.add('defendant');
    const can = targetable(p);
    if (can) card.classList.add('selectable');
    if (sel === p.id) card.classList.add('selected');

    const av = el('div', 'avatar', p.nickname.slice(0, 1).toUpperCase());
    av.style.background = `hsl(${hue(p.id)} 45% 38%)`;
    if (dead) av.append(el('span', 'stamp dead', '✖'));
    const log = policeLog.filter((l) => l.targetId === p.id).at(-1);
    if (log) av.append(el('span', `stamp ${log.isMafia ? 'mafia' : 'clean'}`, log.isMafia ? '마피아' : '시민'));
    if (tally[p.id]) av.append(el('span', 'votecount', `${tally[p.id]}`));
    card.append(av);

    card.append(el('div', 'pname', `${p.isHost ? '👑' : ''}${p.nickname}`));
    let tag = '';
    let tagCls = 'ptag';
    if (revealed[p.id]) { tag = ROLE_NAMES[revealed[p.id]]; tagCls += ' role'; }
    else if (mates.some((m) => m.id === p.id) && p.id !== state.youId) { tag = '마피아 동료'; tagCls += ' mafia'; }
    else if (Object.values(picks).includes(p.id) && state.phase === 'night') { tag = '🎯 지목됨'; tagCls += ' mafia'; }
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

function renderActions() {
  const box = $('actions');
  box.replaceChildren();
  const msg = $('center-msg');
  const you = state.you;

  if (state.status === 'waiting') {
    const n = state.players.length;
    if (state.hostId === state.youId) {
      const b = el('button', 'btn-sm', '게임 시작');
      b.disabled = n < 4;
      b.onclick = startGame;
      box.append(b);
      msg.textContent = n < 4 ? `최소 4명이 필요합니다 (${n}/${state.maxPlayers})` : `${n}/${state.maxPlayers}명 — 시작할 수 있습니다`;
    } else {
      msg.textContent = `방장이 시작하기를 기다리는 중... (${n}/${state.maxPlayers})`;
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
        mafia: '죽일 사람을 선택하세요 (마피아 채팅으로 상의)',
        doctor: '보호할 사람을 선택하세요',
        police: '조사할 사람을 선택하세요',
      })[you.role] || '밤입니다. 조용히 기다리세요.';
      break;
    case 'morning': msg.textContent = '아침이 밝았습니다.'; break;
    case 'discussion': msg.textContent = '토론 시간입니다. 의심되는 사람을 찾아보세요.'; break;
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
      for (const [label, agree, cls] of [['찬성', true, 'agree'], ['반대', false, 'disagree']]) {
        const b = el('button', `btn-sm ${cls}`, label);
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
    const b = el('button', ch === activeTab ? 'active' : '', TAB_NAMES[ch]);
    b.type = 'button';
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
    const li = el('li', m.channel === 'system' ? 'sys' : '');
    if (m.from) li.append(el('span', 'from', m.from.nickname));
    li.append(document.createTextNode(m.text));
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
  socket.on('game:over', (r) => { lastOver = r; showOver(r); });

  socket.on('chat:history', ({ channel, messages }) => {
    if (!chat[channel]) return;
    chat[channel] = messages.slice();
    if (state) render();
  });
  socket.on('chat:message', (m) => { addMessage(m); if (state) { renderTabs(); renderLog(); } });
}

function showOver(r) {
  $('over-title').textContent = `${r.winner === 'mafia' ? '마피아' : '시민'} 팀 승리!`;
  const list = $('over-roles');
  list.replaceChildren();
  r.roles.forEach((x) => {
    const li = el('li');
    const flip = el('div', 'flip');
    flip.append(el('div', 'side', '?'));
    const rev = el('div', 'side rev');
    const img = document.createElement('img');
    img.src = `/img/${x.role}.svg`;
    img.alt = ROLE_NAMES[x.role];
    rev.append(img, el('div', 'nm', `${x.nickname}${x.alive ? '' : ' ✖'}`));
    flip.append(rev);
    li.append(flip);
    list.append(li);
  });
  $('over-rating').textContent = '';
  $('over').classList.remove('hidden');
  A().gameOver?.(r);
}

// ---------- 타이머 ----------
setInterval(() => {
  if (!state?.endsAt || state.status !== 'playing') {
    $('timer').textContent = '';
    $('timerfill').style.width = '0';
    return;
  }
  const remain = Math.max(0, state.endsAt - Date.now());
  $('timer').textContent = `${Math.ceil(remain / 1000)}초`;
  const total = Math.max(remain, state.endsAt - (phaseStart || Date.now()));
  $('timerfill').style.width = `${(remain / total) * 100}%`;
}, 150);

// phase:change 로 endsAt 이 갱신되면 state 에도 반영 (room:state 가 곧 오지만 카운트다운을 끊김 없이 유지)
function syncEndsAt() {
  socket.on('phase:change', (p) => { if (state) { state.endsAt = p.endsAt; state.phase = p.phase; state.day = p.day; } });
}

async function init() {
  await requireLogin();
  socket = io();
  syncEndsAt();
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
