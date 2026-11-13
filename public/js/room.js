const $ = (id) => document.getElementById(id);
let socket;
let gotState = false;

function renderState(s) {
  gotState = true;
  $('room-title').textContent = (s.hasPassword ? '🔒 ' : '') + s.title;
  $('count').textContent = `${s.players.length}/${s.maxPlayers}`;
  const list = $('players');
  list.replaceChildren();
  for (const p of s.players) {
    const li = document.createElement('li');
    li.className = 'player-item' + (p.connected ? '' : ' offline');
    if (p.isHost) {
      const crown = document.createElement('span');
      crown.className = 'crown';
      crown.textContent = '👑';
      li.append(crown);
    }
    const name = document.createElement('span');
    name.textContent = p.nickname + (p.id === s.youId ? ' (나)' : '') + (p.connected ? '' : ' · 연결 끊김');
    li.append(name);
    list.append(li);
  }
  $('hint').textContent = s.players.length < 4
    ? '게임을 시작하려면 최소 4명이 필요합니다.'
    : (s.hostId === s.youId ? '방장이 게임을 시작할 수 있습니다.' : '방장이 게임을 시작하기를 기다리는 중...');
}

async function init() {
  await requireLogin();
  socket = io();
  socket.on('connect_error', () => { location.href = '/login.html'; });
  socket.on('session:replaced', () => { document.body.textContent = '다른 탭에서 접속하여 이 탭의 연결이 종료되었습니다.'; });
  socket.on('room:state', renderState);
  // 연결 직후에도 room:state가 오지 않으면 참여 중인 방이 없는 것 → 로비로
  socket.on('lobby:update', () => { if (!gotState) location.href = '/lobby.html'; });

  $('leave').onclick = () => socket.emit('room:leave', () => { location.href = '/lobby.html'; });
}

init();
