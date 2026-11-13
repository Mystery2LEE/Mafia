const $ = (id) => document.getElementById(id);

const ERRORS = {
  not_found: '방이 존재하지 않습니다.',
  full: '방이 가득 찼습니다.',
  in_game: '이미 게임이 진행 중인 방입니다.',
  bad_password: '비밀번호가 올바르지 않습니다.',
  already_in_room: '이미 다른 방에 참여 중입니다.',
  invalid_title: '제목을 1~30자로 입력하세요.',
  invalid_max_players: '최대 인원은 4~12명입니다.',
  invalid_times: '페이즈 시간은 5~180초 사이로 입력하세요.',
  invalid_password: '비밀번호가 올바르지 않은 형식입니다.',
};
const errText = (code) => ERRORS[code] || '요청에 실패했습니다.';

let socket;
let pendingRoomId = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function renderRooms(rooms) {
  const list = $('rooms');
  list.replaceChildren();
  $('empty').classList.toggle('hidden', rooms.length > 0);
  for (const r of rooms) {
    const li = el('li', `room-item ${r.status}`);

    // 사용자 입력(제목/닉네임)은 항상 textContent 로만 넣는다
    const info = el('div');
    const title = el('div', 'room-title');
    if (r.hasPassword) title.insertAdjacentHTML('beforeend', Icons.svg('lock', 16));
    title.append(el('span', 't', r.title));

    const meta = el('div', 'room-meta');
    const seats = el('span', 'seats');
    for (let i = 0; i < r.maxPlayers; i++) seats.append(el('i', i < r.playerCount ? 'on' : ''));
    const count = el('span', '', `${r.playerCount}/${r.maxPlayers}명`);
    const host = el('span');
    host.insertAdjacentHTML('beforeend', Icons.svg('crown', 14));
    host.append(document.createTextNode(` ${r.hostNickname}`));
    const badge = el('span', `badge ${r.status}`, r.status === 'waiting' ? '대기중' : '게임중');
    meta.append(badge, seats, count, host);
    info.append(title, meta);

    const btn = el('button', 'btn-sm', r.status === 'waiting' ? '입장' : '진행 중');
    btn.disabled = r.status !== 'waiting' || r.playerCount >= r.maxPlayers;
    btn.onclick = () => tryJoin(r);

    li.append(info, btn);
    list.append(li);
  }
}

function tryJoin(room) {
  $('msg').textContent = '';
  if (room.hasPassword) {
    pendingRoomId = room.id;
    $('pw-input').value = '';
    $('pw-msg').textContent = '';
    $('pw-dialog').showModal();
  } else {
    join(room.id);
  }
}

function join(roomId, password, onError) {
  socket.emit('room:join', { roomId, password }, (res) => {
    if (res.ok || res.error === 'already_joined') return (location.href = '/room.html');
    if (onError) return onError(errText(res.error));
    $('msg').textContent = errText(res.error);
  });
}

function numOrUndef(id) {
  const v = $(id).value.trim();
  return v === '' ? undefined : Number(v);
}

async function init() {
  const me = await requireLogin();
  $('me-name').textContent = me.nickname;
  $('me-rating').textContent = me.rating;
  $('empty-ico').innerHTML = Icons.svg('fedora', 64);
  api('/api/profile').then(({ user }) => {
    $('my-crest').innerHTML = Icons.tierCrest(user.tier.key, 26);
    $('my-crest').title = user.tier.name;
  }).catch(() => {});

  socket = io();
  socket.on('connect_error', () => { location.href = '/login.html'; });
  socket.on('session:replaced', () => { document.body.textContent = '다른 탭에서 접속하여 이 탭의 연결이 종료되었습니다.'; });
  socket.on('room:resume', () => { location.href = '/room.html'; }); // 새로고침 시 진행 중이던 방으로
  socket.on('lobby:update', ({ rooms }) => renderRooms(rooms));

  $('logout').onclick = async (e) => {
    e.preventDefault();
    await api('/api/auth/logout', {});
    location.href = '/login.html';
  };

  $('open-create').onclick = () => { $('create-msg').textContent = ''; $('create-dialog').showModal(); };
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const times = {};
    for (const k of ['night', 'discussion', 'vote', 'defense', 'verdict']) {
      const v = numOrUndef(`t-${k}`);
      if (v !== undefined) times[k] = v;
    }
    socket.emit('room:create', {
      title: $('c-title').value,
      maxPlayers: Number($('c-max').value),
      password: $('c-pw').value || undefined,
      doctorSelfProtect: $('c-doctor').checked,
      times: Object.keys(times).length ? times : undefined,
    }, (res) => {
      if (res.ok) return (location.href = '/room.html');
      $('create-msg').textContent = errText(res.error);
    });
  });

  $('pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    join(pendingRoomId, $('pw-input').value, (text) => { $('pw-msg').textContent = text; });
  });
}

init();
