// 임시 대기실/게임 화면. 본격적인 게임 UI는 이후 단계(C4)에서 교체한다.
const $ = (id) => document.getElementById(id);
let socket;
let gotState = false;
let endsAt = null;

const PHASE_NAMES = {
  role_reveal: '직업 공개', night: '밤', morning: '아침 결과', discussion: '낮 토론',
  vote: '투표', defense: '최후 변론', verdict: '찬반 투표', execution: '처형',
};
const ROLE_NAMES = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
const ERRORS = {
  not_host: '방장만 시작할 수 있습니다.',
  not_enough_players: '최소 4명이 필요합니다.',
  already_started: '이미 시작되었습니다.',
};

function renderState(s) {
  gotState = true;
  const playing = s.status === 'playing';
  $('room-title').textContent = (s.hasPassword ? '🔒 ' : '') + s.title;
  $('count').textContent = `${s.players.length}/${s.maxPlayers}`;
  const list = $('players');
  list.replaceChildren();
  for (const p of s.players) {
    const li = document.createElement('li');
    li.className = 'player-item' + (p.connected && !p.left ? '' : ' offline');
    if (p.isHost) {
      const crown = document.createElement('span');
      crown.className = 'crown';
      crown.textContent = '👑';
      li.append(crown);
    }
    const name = document.createElement('span');
    name.textContent = p.nickname
      + (p.id === s.youId ? ' (나)' : '')
      + (playing && !p.alive ? ' · 사망' : '')
      + (p.connected ? '' : ' · 연결 끊김');
    li.append(name);
    list.append(li);
  }

  const isHost = s.hostId === s.youId;
  $('start').classList.toggle('hidden', playing || !isHost);
  $('start').disabled = s.players.length < 4;
  $('hint').textContent = playing ? '' : (s.players.length < 4
    ? '게임을 시작하려면 최소 4명이 필요합니다.'
    : (isHost ? '방장이 게임을 시작할 수 있습니다.' : '방장이 게임을 시작하기를 기다리는 중...'));

  $('game').classList.toggle('hidden', !playing);
  if (playing && s.you) {
    $('my-role').textContent = ROLE_NAMES[s.you.role] || '';
    $('my-mafia').textContent = s.you.mafiaTeam
      ? `(동료: ${s.you.mafiaTeam.map((m) => m.nickname).join(', ')})` : '';
    setPhase(s.phase, s.day, s.endsAt);
  }
}

function setPhase(phase, day, ends) {
  $('phase').textContent = PHASE_NAMES[phase] || '';
  $('day').textContent = day;
  endsAt = ends;
}

setInterval(() => {
  if (!endsAt) return;
  $('timer').textContent = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}, 200);

async function init() {
  await requireLogin();
  socket = io();
  socket.on('connect_error', () => { location.href = '/login.html'; });
  socket.on('session:replaced', () => { document.body.textContent = '다른 탭에서 접속하여 이 탭의 연결이 종료되었습니다.'; });
  socket.on('room:state', renderState);
  socket.on('phase:change', (p) => setPhase(p.phase, p.day, p.endsAt));
  socket.on('game:over', (r) => {
    const names = r.roles.map((x) => `${x.nickname}(${ROLE_NAMES[x.role]})`).join(', ');
    $('msg').style.color = 'var(--accent)';
    $('msg').textContent = `${r.winner === 'mafia' ? '마피아' : '시민'} 팀 승리! ${names}`;
  });
  // 연결 직후에도 room:state가 오지 않으면 참여 중인 방이 없는 것 → 로비로
  socket.on('lobby:update', () => { if (!gotState) location.href = '/lobby.html'; });

  $('start').onclick = () => {
    $('msg').textContent = '';
    socket.emit('game:start', (res) => {
      if (res.error) { $('msg').style.color = ''; $('msg').textContent = ERRORS[res.error] || '시작할 수 없습니다.'; }
    });
  };
  $('leave').onclick = () => socket.emit('room:leave', () => { location.href = '/lobby.html'; });
}

init();
