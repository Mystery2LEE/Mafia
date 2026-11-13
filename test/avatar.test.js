const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, register, connectSocket, emitAck, waitFor } = require('./helpers');

// 최소한의 유효한 헤더를 가진 가짜 이미지 바이트 (서버는 매직 바이트와 크기만 검사한다)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 2)]);

const put = (url, cookie, body, type = 'image/jpeg') =>
  fetch(`${url}/api/avatar`, { method: 'PUT', headers: { cookie, 'Content-Type': type }, body });

test('프로필 사진', async (t) => {
  const srv = await startTestServer();
  const sockets = [];
  t.after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });
  const a = await register(srv.url, 'avauser1', '사진주인');
  const b = await register(srv.url, 'avauser2', '구경꾼');

  await t.test('로그인 없이는 올리기/조회 불가', async () => {
    assert.strictEqual((await put(srv.url, '', JPEG)).status, 401);
    assert.strictEqual((await fetch(`${srv.url}/api/avatar/${a.body.user.id}`)).status, 401);
  });

  await t.test('사진이 없으면 404, 프로필 av 는 0', async () => {
    const r = await fetch(`${srv.url}/api/avatar/${a.body.user.id}`, { headers: { cookie: b.cookie } });
    assert.strictEqual(r.status, 404);
    const p = await (await fetch(`${srv.url}/api/profile`, { headers: { cookie: a.cookie } })).json();
    assert.strictEqual(p.user.av, 0);
  });

  await t.test('내용이 이미지가 아니거나 형식이 다르면 거부', async () => {
    assert.strictEqual((await put(srv.url, a.cookie, Buffer.from('<svg onload=alert(1)>'), 'image/jpeg')).status, 400);
    assert.strictEqual((await put(srv.url, a.cookie, PNG, 'image/jpeg')).status, 400); // 선언과 내용 불일치
    assert.strictEqual((await put(srv.url, a.cookie, '<svg/>', 'image/svg+xml')).status, 400); // SVG 불가
    assert.strictEqual((await put(srv.url, a.cookie, Buffer.alloc(0), 'image/jpeg')).status, 400);
  });

  await t.test('너무 큰 파일은 거부', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(200 * 1024)]);
    assert.strictEqual((await put(srv.url, a.cookie, big)).status, 413);
  });

  let av;
  await t.test('업로드 → 다른 사용자도 조회 가능, 안전 헤더', async () => {
    const r = await put(srv.url, a.cookie, JPEG);
    assert.strictEqual(r.status, 200);
    av = (await r.json()).av;
    assert.ok(av > 0);
    const g = await fetch(`${srv.url}/api/avatar/${a.body.user.id}?v=${av}`, { headers: { cookie: b.cookie } });
    assert.strictEqual(g.status, 200);
    assert.strictEqual(g.headers.get('content-type'), 'image/jpeg');
    assert.strictEqual(g.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await g.arrayBuffer()).equals(JPEG));
  });

  await t.test('다시 올리면 버전이 바뀐다 (캐시 무효화)', async () => {
    const r2 = await (await put(srv.url, a.cookie, PNG, 'image/png')).json();
    assert.ok(r2.av > av);
    av = r2.av;
  });

  await t.test('랭킹/프로필/방 상태에 av 가 실린다', async () => {
    const p = await (await fetch(`${srv.url}/api/profile`, { headers: { cookie: a.cookie } })).json();
    assert.strictEqual(p.user.av, av);
    const rk = await (await fetch(`${srv.url}/api/ranking`, { headers: { cookie: b.cookie } })).json();
    assert.strictEqual(rk.players.find((x) => x.id === a.body.user.id).av, av);

    const sa = await connectSocket(srv.url, a.cookie); sockets.push(sa);
    const sb = await connectSocket(srv.url, b.cookie); sockets.push(sb);
    const created = await emitAck(sa, 'room:create', { title: '사진방', maxPlayers: 4 });
    await emitAck(sb, 'room:join', { roomId: created.roomId });
    const st = await waitFor(sb, 'room:state', (s) => s.players.length === 2);
    assert.strictEqual(st.players.find((x) => x.id === a.body.user.id).av, av);
    assert.strictEqual(st.players.find((x) => x.id === b.body.user.id).av, undefined);
    assert.strictEqual(st.players[0].tier, 'hoodlum'); // 기본 레이팅 1000 = 건달
  });

  await t.test('삭제하면 기본 아바타로 돌아가고, 다시 올려도 버전이 겹치지 않는다', async () => {
    assert.strictEqual((await fetch(`${srv.url}/api/avatar`, { method: 'DELETE', headers: { cookie: a.cookie } })).status, 200);
    const g = await fetch(`${srv.url}/api/avatar/${a.body.user.id}`, { headers: { cookie: b.cookie } });
    assert.strictEqual(g.status, 404);
    const again = await (await put(srv.url, a.cookie, JPEG)).json();
    assert.ok(again.av > av);
  });
});
