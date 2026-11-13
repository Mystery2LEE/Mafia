const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, waitFor, clearEvents, emitAck, sleep, harness } = require('./helpers');

let srv;
let h;
const sockets = [];
const LONG = { night: 100, discussion: 100, vote: 100, defense: 100, verdict: 100 };

before(async () => {
  srv = await startTestServer({
    limits: { secondMs: 30, waitingGraceMs: 150, ingameGraceMs: 400, phaseSec: { min: 1 } },
  });
  h = harness(srv, sockets, LONG);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

/** 테스트에서 페이즈를 고정한다 (타이머를 넉넉히 늘려 자동 전환을 막는다) */
const force = (game, phase) => game._enter(phase, 1000);
const send = (p, channel, text = '안녕') => emitAck(p.socket, 'chat:send', { channel, text });
const msgs = (p, channel) =>
  p.socket.events.filter((e) => e.event === 'chat:message' && e.payload.channel === channel).map((e) => e.payload);
const texts = (p, channel) => msgs(p, channel).map((m) => m.text);
const byRole = (ps, role) => ps.filter((p) => p.role === role);

test('대기실: 전체 채팅만 가능하고 다른 채널/system 은 쓸 수 없다', async () => {
  const { ps } = await h.makeRoom(4);
  assert.equal((await send(ps[1], 'public', '반가워요')).ok, true);
  await sleep(50);
  for (const p of ps) assert.deepEqual(texts(p, 'public'), ['반가워요']);
  assert.equal((await send(ps[0], 'mafia')).error, 'forbidden');
  assert.equal((await send(ps[0], 'dead')).error, 'forbidden');
  assert.equal((await send(ps[0], 'system')).error, 'forbidden');
  assert.equal((await send(ps[0], 'bogus')).error, 'invalid_channel');
});

test('입력 검증: 빈 문자열/너무 긴 글/문자열 아님, 방 밖에서는 불가', async () => {
  const { ps } = await h.makeRoom(4);
  assert.equal((await send(ps[0], 'public', '   ')).error, 'invalid_text');
  assert.equal((await send(ps[0], 'public', 'a'.repeat(201))).error, 'invalid_text');
  assert.equal((await emitAck(ps[0].socket, 'chat:send', { channel: 'public', text: 123 })).error, 'invalid_text');
  assert.equal((await emitAck(ps[0].socket, 'chat:send', null)).error, 'invalid_channel');
  const outsider = await h.player('out');
  assert.equal((await send(outsider, 'public')).error, 'not_in_room');
});

test('도배 방지: 짧은 시간에 너무 많이 보내면 거부', async () => {
  const { ps } = await h.makeRoom(4);
  for (let i = 0; i < 5; i++) assert.equal((await send(ps[0], 'public', `m${i}`)).ok, true);
  assert.equal((await send(ps[0], 'public', 'm5')).error, 'rate_limited');
});

test('낮: 생존자 전원이 public 을 읽고 쓴다. 밤: 아무도 public 에 쓸 수 없다', async () => {
  const { game, ps } = await h.startedRoom(6);
  force(game, 'discussion');
  for (const p of ps) assert.equal((await send(p, 'public', `${p.role} 발언`)).ok, true);
  await sleep(60);
  for (const p of ps) assert.equal(texts(p, 'public').length, 6);

  force(game, 'night');
  for (const p of ps) assert.equal((await send(p, 'public')).error, 'forbidden');
});

test('시민은 mafia 채널을 받지 못하고 쓰지도 못한다 / 밤에만 마피아끼리 대화', async () => {
  const { game, ps } = await h.startedRoom(6);
  const mafia = byRole(ps, 'mafia');
  const others = ps.filter((p) => p.role !== 'mafia');

  force(game, 'discussion');
  assert.equal((await send(mafia[0], 'mafia', '낮엔 불가')).error, 'forbidden');

  force(game, 'night');
  assert.equal((await send(mafia[0], 'mafia', '오늘 누구를 죽일까')).ok, true);
  for (const o of others) assert.equal((await send(o, 'mafia', '엿듣기')).error, 'forbidden');
  await sleep(60);

  for (const m of mafia) assert.deepEqual(texts(m, 'mafia'), ['오늘 누구를 죽일까']);
  for (const o of others) {
    assert.equal(msgs(o, 'mafia').length, 0, `${o.role} 가 mafia 메시지를 받음`);
    assert.equal(JSON.stringify(o.socket.events).includes('오늘 누구를 죽일까'), false);
  }
  // 서버 측 room 소속으로도 확인: 마피아 외에는 mafia 채널 room 에 없다
  const inMafiaRoom = (await srv.io.in(`room:${game.id}:chat:mafia`).fetchSockets()).map((s) => s.data.user.id);
  assert.deepEqual(inMafiaRoom.sort(), mafia.map((m) => m.user.id).sort());
});

test('사망자: dead 채널 join + 히스토리 수신, 생존자에게는 dead 메시지가 절대 가지 않는다', async () => {
  const { game, ps } = await h.startedRoom(8);
  const citizens = byRole(ps, 'citizen');
  const [d1, d2] = [citizens[0], citizens[1]];
  const alive = ps.filter((p) => p !== d1 && p !== d2);

  // 첫 번째 사망자 발생 후 dead 채널에서 대화
  force(game, 'discussion');
  game._kill(d1.user.id, 'mafia');
  await sleep(60);
  assert.equal((await send(d1, 'dead', '나 죽었다')).ok, true);
  assert.equal((await send(d1, 'public')).error, 'forbidden'); // 사망자는 public 에 쓸 수 없다
  await sleep(60);

  // 두 번째 사망자는 합류 시점에 이전 dead 히스토리를 받는다
  game._kill(d2.user.id, 'vote');
  const hist = await waitFor(d2.socket, 'chat:history', (x) => x.channel === 'dead');
  assert.deepEqual(hist.messages.map((m) => m.text), ['나 죽었다']);
  assert.equal((await send(d2, 'dead', '나도 죽었다')).ok, true);
  await sleep(60);
  assert.deepEqual(texts(d1, 'dead'), ['나 죽었다', '나도 죽었다']);

  // 생존자: 어떤 경로로도 dead 메시지/히스토리를 받지 않는다
  for (const p of alive) {
    assert.equal(msgs(p, 'dead').length, 0, `${p.role} 에게 dead 메시지 도착`);
    assert.equal(JSON.stringify(p.socket.events).includes('나 죽었다'), false);
    assert.equal(p.socket.events.some((e) => e.event === 'chat:history' && e.payload.channel === 'dead'), false);
    assert.equal((await send(p, 'dead', '생존자 침투')).error, 'forbidden');
  }
  // 서버 측: dead 채널 room 에는 사망자 둘뿐
  const inDead = (await srv.io.in(`room:${game.id}:chat:dead`).fetchSockets()).map((s) => s.data.user.id);
  assert.deepEqual(inDead.sort(), [d1.user.id, d2.user.id].sort());

  // 사망자는 밤에도 dead 채널에 쓸 수 있고, public 은 낮이어도 쓸 수 없다
  force(game, 'night');
  assert.equal((await send(d1, 'dead', '밤에도 대화')).ok, true);
  force(game, 'discussion');
  assert.equal((await send(d1, 'public')).error, 'forbidden');
});

test('사망자는 mafia 채널을 읽을 수 있다 (사망 이후 + 이전 히스토리)', async () => {
  const { game, ps } = await h.startedRoom(6);
  const mafia = byRole(ps, 'mafia');
  const victim = byRole(ps, 'citizen')[0];

  force(game, 'night');
  await send(mafia[0], 'mafia', '타깃은 경찰');
  await sleep(40);
  game._kill(victim.user.id, 'mafia');
  const hist = await waitFor(victim.socket, 'chat:history', (x) => x.channel === 'mafia');
  assert.deepEqual(hist.messages.map((m) => m.text), ['타깃은 경찰']);
  await send(mafia[1], 'mafia', '알겠다');
  await sleep(60);
  assert.deepEqual(texts(victim, 'mafia'), ['알겠다']);
  // 읽기만 가능: 사망한 시민은 mafia 채널에 쓸 수 없다
  assert.equal((await send(victim, 'mafia')).error, 'forbidden');
  // 사망한 마피아는 읽지만 쓰지는 못한다
  const deadMafia = mafia[1];
  game._kill(deadMafia.user.id, 'vote');
  assert.equal((await send(deadMafia, 'mafia')).error, 'forbidden');
  assert.equal((await send(deadMafia, 'dead', '유령 마피아')).ok, true);
});

test('최후 변론 중에는 지목된 사람만 public 에 쓸 수 있다', async () => {
  const { game, ps } = await h.startedRoom(6);
  const defendant = ps[2];
  game.defendantId = defendant.user.id;
  force(game, 'defense');
  assert.equal((await send(defendant, 'public', '저는 시민입니다')).ok, true);
  for (const p of ps.filter((x) => x !== defendant)) assert.equal((await send(p, 'public')).error, 'forbidden');
  await sleep(60);
  for (const p of ps) assert.deepEqual(texts(p, 'public'), ['저는 시민입니다']); // 읽기는 전원
  force(game, 'verdict');
  assert.equal((await send(defendant, 'public')).error, 'forbidden');
});

test('system 채널: 서버만 쓴다. 페이즈 전환/사망이 전원에게 전달된다', async () => {
  const { game, ps } = await h.startedRoom(4);
  force(game, 'morning');
  game._kill(ps[3].user.id, 'mafia');
  await sleep(60);
  for (const p of ps) {
    assert.ok(msgs(p, 'system').some((m) => m.text.includes('아침이 밝았습니다')));
    assert.ok(msgs(p, 'system').some((m) => m.text.includes(ps[3].user.nickname)));
    assert.equal(msgs(p, 'system')[0].from, null);
  }
  assert.equal((await send(ps[0], 'system', '서버인 척')).error, 'forbidden');
});

test('재접속: 생존자는 dead 히스토리를 받지 않고, 사망자는 받는다', async () => {
  const { roomId, game, ps } = await h.startedRoom(6);
  const { connectSocket } = require('./helpers');
  const dead = byRole(ps, 'citizen')[0];
  const alive = byRole(ps, 'doctor')[0];
  force(game, 'discussion');
  game._kill(dead.user.id, 'mafia');
  await sleep(50);
  await send(dead, 'dead', '유령 대화');
  await sleep(50);

  dead.socket.close();
  alive.socket.close();
  await sleep(40);
  const d2 = await connectSocket(srv.url, dead.cookie);
  const a2 = await connectSocket(srv.url, alive.cookie);
  sockets.push(d2, a2);
  assert.equal((await waitFor(d2, 'room:resume')).roomId, roomId);
  await waitFor(a2, 'room:resume');
  const hist = await waitFor(d2, 'chat:history', (x) => x.channel === 'dead');
  assert.deepEqual(hist.messages.map((m) => m.text), ['유령 대화']);
  await sleep(60);
  assert.equal(a2.events.some((e) => e.event === 'chat:history' && e.payload.channel === 'dead'), false);
  assert.equal(JSON.stringify(a2.events).includes('유령 대화'), false);
});

test('게임이 끝나면 dead/mafia 채널 소속이 해제된다', async () => {
  const { game, ps } = await h.startedRoom(4);
  const dead = byRole(ps, 'citizen')[0];
  game._kill(dead.user.id, 'mafia');
  await sleep(40);
  assert.equal((await send(dead, 'dead', '유령')).ok, true);
  game._endGame('mafia');
  await sleep(60);
  assert.equal((await send(dead, 'dead', '종료 후')).error, 'forbidden');
  const inDead = await srv.io.in(`room:${game.id}:chat:dead`).fetchSockets();
  const inMafia = await srv.io.in(`room:${game.id}:chat:mafia`).fetchSockets();
  assert.equal(inDead.length + inMafia.length, 0);
  // 종료 후 대기실에서는 다시 전체 채팅 가능
  clearEvents(ps[0].socket);
  assert.equal((await send(dead, 'public', '다음 판 가자')).ok, true);
  await sleep(50);
  assert.deepEqual(texts(ps[0], 'public'), ['다음 판 가자']);
});
