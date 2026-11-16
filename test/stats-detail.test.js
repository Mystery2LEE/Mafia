// 전적 상세: 연승, 팀별 승률, 레이팅 추이, 더 보기, 경기 상세, 다른 사람 프로필
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, newUser } = require('./helpers');

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

const get = async (path, cookie) => {
  const r = await fetch(`${srv.url}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: r.status, body: await r.json() };
};

test('전적 상세: 연승·팀별·생존율·레이팅 추이·더 보기·경기 상세', async () => {
  const me = await newUser(srv.url, 'st');
  const foe = await newUser(srv.url, 'st');
  // 결과 순서(오래된 → 최신): 패 승 승 패 승 승 승
  const seq = ['lose', 'win', 'win', 'lose', 'win', 'win', 'win'];
  seq.forEach((res, i) => {
    const win = res === 'win';
    srv.db.matches.recordMatch({
      roomTitle: `판${i}`, winnerTeam: win ? 'citizen' : 'mafia', counted: true,
      players: [
        { userId: me.user.id, role: 'doctor', team: 'citizen', survived: win, result: res, delta: win ? 20 : -10, leftEarly: false },
        { userId: foe.user.id, role: 'mafia', team: 'mafia', survived: true, result: win ? 'lose' : 'win', delta: 0, leftEarly: false },
      ],
    });
  });

  const { status, body: pf } = await get('/api/profile', me.cookie);
  assert.equal(status, 200);
  assert.deepEqual(pf.streak, { type: 'win', count: 3, bestWin: 3 });
  assert.equal(pf.byTeam.find((t) => t.team === 'citizen').games, 7);
  assert.equal(pf.survivalRate, 71.4); // 5/7
  assert.equal(pf.ratingHistory.length, 7);
  assert.equal(pf.ratingHistory.at(-1).rating, pf.user.rating); // 마지막 점이 현재 레이팅
  assert.equal(pf.ratingHistory[0].rating, 1000 - 10);
  assert.equal(pf.user.isMe, true);

  // 더 보기: 가장 오래된 경기 앞쪽으로
  const oldest = pf.recent.at(-1).matchId;
  const page = await get(`/api/profile/matches?before=${pf.recent[2].matchId}`, me.cookie);
  assert.equal(page.body.matches.length, 4);
  assert.equal(page.body.matches[0].roomTitle, '판3');
  assert.equal((await get(`/api/profile/matches?before=${oldest}`, me.cookie)).body.matches.length, 0);
  assert.equal((await get('/api/profile/matches?before=abc', me.cookie)).status, 400);

  // 경기 상세: 참가자 전원 + 직업
  const d = await get(`/api/match/${pf.recent[0].matchId}`, me.cookie);
  assert.equal(d.status, 200);
  assert.equal(d.body.players.length, 2);
  assert.deepEqual(d.body.players.map((p) => p.role).sort(), ['doctor', 'mafia']);
  assert.equal(JSON.stringify(d.body).includes('password'), false);
  assert.equal((await get('/api/match/99999', me.cookie)).status, 404);
  assert.equal((await get('/api/match/1')).status, 401);
});

test('다른 사람 프로필 보기: 로그인 필요, 없는 사용자는 404', async () => {
  const a = await newUser(srv.url, 'pf');
  const b = await newUser(srv.url, 'pf');
  const other = await get(`/api/profile?id=${b.user.id}`, a.cookie);
  assert.equal(other.body.user.nickname, b.user.nickname);
  assert.equal(other.body.user.isMe, false);
  assert.equal(other.body.streak.count, 0);
  assert.equal((await get('/api/profile?id=999999', a.cookie)).status, 404);
  assert.equal((await get('/api/profile?id=x', a.cookie)).status, 404);
  assert.equal((await get(`/api/profile?id=${b.user.id}`)).status, 401);
});
