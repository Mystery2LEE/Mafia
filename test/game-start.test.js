const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { roleCounts } = require('../server/config/game');
const {
  startTestServer, newUser, connectSocket, waitFor, clearEvents, emitAck, sleep,
} = require('./helpers');

let srv;
const sockets = [];
// 1초 = 30ms 로 줄여 타이머를 빠르게 돌린다
const FAST = { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 } };
const FAST_TIMES = { night: 1, discussion: 1, vote: 1, defense: 1, verdict: 1 };

before(async () => { srv = await startTestServer({ limits: FAST }); });
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

async function player(label) {
  const u = await newUser(srv.url, label);
  const socket = await connectSocket(srv.url, u.cookie);
  sockets.push(socket);
  return { ...u, socket };
}

/** n명이 모인 방을 만든다(아직 시작 전). 첫 번째가 방장. */
async function makeRoom(n, opts = {}) {
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await player(`g${i}`));
  const r = await emitAck(ps[0].socket, 'room:create', {
    title: '게임방', maxPlayers: Math.max(n, 4), times: FAST_TIMES, ...opts,
  });
  assert.equal(r.ok, true);
  for (const p of ps.slice(1)) assert.equal((await emitAck(p.socket, 'room:join', { roomId: r.roomId })).ok, true);
  return { roomId: r.roomId, ps };
}

/** 방을 만들고 시작해서 각자 받은 직업을 p.role 에 담아 돌려준다 */
async function startedRoom(n, opts) {
  const room = await makeRoom(n, opts);
  const res = await emitAck(room.ps[0].socket, 'game:start');
  assert.equal(res.ok, true);
  for (const p of room.ps) {
    const a = await waitFor(p.socket, 'role:assigned');
    p.role = a.role;
    p.assigned = a;
  }
  return room;
}

test('인원별 직업 배분 표 (4~12명)', () => {
  const expected = { 4: [1, 1, 1, 1], 5: [1, 1, 1, 2], 6: [2, 1, 1, 2], 8: [2, 1, 1, 4], 9: [3, 1, 1, 4], 12: [3, 1, 1, 7] };
  for (const [n, [m, p, d, c]] of Object.entries(expected)) {
    assert.deepEqual(roleCounts(Number(n)), { mafia: m, police: p, doctor: d, citizen: c }, `${n}명`);
  }
  for (let n = 4; n <= 12; n++) {
    const c = roleCounts(n);
    assert.equal(c.mafia + c.police + c.doctor + c.citizen, n);
  }
});

test('시작 권한: 방장만 가능, 4명 미만이면 불가', async () => {
  const { roomId, ps } = await makeRoom(3, { maxPlayers: 4 });
  assert.equal((await emitAck(ps[1].socket, 'game:start')).error, 'not_host');
  assert.equal((await emitAck(ps[0].socket, 'game:start')).error, 'not_enough_players');
  const late = await player('late');
  await emitAck(late.socket, 'room:join', { roomId });
  assert.equal((await emitAck(ps[0].socket, 'game:start')).ok, true);
  assert.equal((await emitAck(ps[0].socket, 'game:start')).error, 'already_started');
  const outsider = await player('out');
  assert.equal((await emitAck(outsider.socket, 'game:start')).error, 'not_in_room');
});

test('6명 시작: 직업 배분, 마피아만 동료를 안다, 로비 상태가 게임중으로', async () => {
  const { roomId, ps } = await startedRoom(6);
  const count = (r) => ps.filter((p) => p.role === r).length;
  assert.deepEqual(
    { mafia: count('mafia'), police: count('police'), doctor: count('doctor'), citizen: count('citizen') },
    { mafia: 2, police: 1, doctor: 1, citizen: 2 },
  );
  const mafiaIds = ps.filter((p) => p.role === 'mafia').map((p) => p.user.id).sort();
  for (const p of ps) {
    if (p.role === 'mafia') {
      assert.deepEqual(p.assigned.mafiaTeam.map((m) => m.id).sort(), mafiaIds);
    } else {
      assert.equal(p.assigned.mafiaTeam, undefined);
    }
  }
  const { rooms } = await emitAck(ps[0].socket, 'lobby:list');
  assert.equal(rooms.find((r) => r.id === roomId).status, 'playing');
  const late = await player('late');
  assert.equal((await emitAck(late.socket, 'room:join', { roomId })).error, 'in_game');
});

test('room:state 에는 다른 사람의 직업이 절대 포함되지 않는다', async () => {
  const { ps } = await startedRoom(6);
  for (const p of ps) {
    const state = await waitFor(p.socket, 'room:state', (s) => s.status === 'playing' && s.you);
    assert.equal(state.you.role, p.role);
    // players 항목에는 role/team 정보가 없어야 한다
    for (const other of state.players) {
      assert.equal('role' in other, false);
      assert.equal('team' in other, false);
    }
    // 시민/경찰/의사의 상태 전체에서 role 문자열은 본인 직업뿐 (마피아는 동료 목록 허용)
    if (p.role !== 'mafia') assert.equal(state.you.mafiaTeam, undefined);
  }
  // 마피아가 아닌 사람이 받은 모든 이벤트에 다른 사람의 'mafia' 직업 정보가 없다
  const citizen = ps.find((p) => p.role === 'citizen');
  const dump = JSON.stringify(citizen.socket.events.filter((e) => e.event !== 'role:assigned'));
  const mafiaNames = ps.filter((p) => p.role === 'mafia').map((p) => p.user.nickname);
  assert.equal(dump.includes('"role":"mafia"'), false);
  assert.ok(mafiaNames.length === 2);
});

test('페이즈 루프: 첫날은 낮 토론부터(투표 없음) → 밤 → 아침 → 토론 → 투표 → 밤, endsAt 제공', async () => {
  const { ps } = await startedRoom(4);
  const events = [];
  const sock = ps[0].socket;
  await waitFor(sock, 'phase:change', (p) => p.phase === 'night' && p.day === 2, 4000);
  for (const e of sock.events) if (e.event === 'phase:change') events.push(e.payload);

  const seq = events.map((e) => e.phase);
  // 첫날(day 1)은 토론 뒤 투표 없이 바로 밤으로 간다. 둘째 날부터 투표가 있다.
  assert.deepEqual(seq.slice(0, 7), ['role_reveal', 'discussion', 'night', 'morning', 'discussion', 'vote', 'night']);
  assert.deepEqual(events.slice(0, 7).map((e) => e.day), [0, 1, 1, 1, 2, 2, 2]);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].endsAt > events[i - 1].endsAt);
  // 방 상태에도 현재 페이즈/종료시각이 있다
  const st = await waitFor(sock, 'room:state', (s) => s.phase === 'night' && s.day === 2);
  assert.ok(st.endsAt > 0);
});

test('이탈로 승리 조건 충족 시 게임 종료, 대기실로 복귀, 이탈자 정리', async () => {
  const { roomId, ps } = await startedRoom(4);
  const mafia = ps.find((p) => p.role === 'mafia');
  const others = ps.filter((p) => p.role !== 'mafia');
  // 시민팀 3명 중 2명이 나가면 마피아 1 ≥ 시민팀 1 → 마피아 승리
  await emitAck(others[0].socket, 'room:leave');
  const over = waitFor(mafia.socket, 'game:over');
  await emitAck(others[1].socket, 'room:leave');
  const res = await over;
  assert.equal(res.winner, 'mafia');
  assert.equal(res.roles.length, 4);
  assert.ok(res.roles.every((r) => r.role)); // 종료 시 전원 직업 공개

  const g = srv.rooms.get(roomId);
  assert.equal(g.status, 'waiting');
  assert.equal(g.players.size, 2); // 이탈자 2명은 정리
  assert.equal([...g.players.values()].every((p) => p.role === null), true);
  // 이후 방은 정상적으로 다시 입장 가능
  const late = await player('late');
  assert.equal((await emitAck(late.socket, 'room:join', { roomId })).ok, true);
});

test('게임 중 재접속하면 직업과 현재 페이즈가 복구된다', async () => {
  const { roomId, ps } = await startedRoom(4);
  const p = ps[1];
  p.socket.close();
  await sleep(40);
  const again = await connectSocket(srv.url, p.cookie);
  sockets.push(again);
  assert.equal((await waitFor(again, 'room:resume')).roomId, roomId);
  const st = await waitFor(again, 'room:state', (s) => s.you);
  assert.equal(st.you.role, p.role);
  assert.ok(st.phase);
});

test('게임 중 유예시간 내 재접속 없으면 이탈 처리(사망)된다', async () => {
  const { roomId, ps } = await startedRoom(6);
  const victim = ps.find((p) => p.role === 'citizen');
  victim.socket.close();
  await sleep(600); // ingameGraceMs(400) 경과
  const g = srv.rooms.get(roomId);
  const rec = g.players.get(victim.user.id);
  assert.equal(rec.left, true);
  assert.equal(rec.alive, false);
});

test('방 2개가 동시에 진행되어도 페이즈/타이머가 섞이지 않는다', async () => {
  const fast = await startedRoom(4, { times: { night: 1, discussion: 1, vote: 1, defense: 1, verdict: 1 } });
  const slow = await startedRoom(4, { times: { night: 40, discussion: 40, vote: 40, defense: 40, verdict: 40 } });
  await sleep(700);
  const phases = (room) => room.ps[0].socket.events.filter((e) => e.event === 'phase:change').map((e) => e.payload);
  const f = phases(fast);
  const s = phases(slow);
  assert.ok(f.length > 6, `빠른 방은 계속 진행 (${f.length})`);
  assert.deepEqual(s.map((e) => e.phase), ['role_reveal', 'discussion']); // 느린 방은 첫날 토론에서 대기
  assert.equal(s[1].day, 1);
  // 각 방의 소켓은 자기 방 이벤트만 받는다
  const slowSock = slow.ps[1].socket;
  assert.ok(slowSock.events.filter((e) => e.event === 'phase:change').length <= 2);
});
