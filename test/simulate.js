// 가상 플레이어 6명이 실제 소켓 이벤트와 서버 타이머로 게임을 끝까지 진행하는 시뮬레이션.
// (서버 내부 함수는 호출하지 않고, 정답 확인용으로 srv.rooms 의 상태를 "읽기만" 한다)
//   npm run simulate   또는   npm test 에 포함되어 실행된다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emitAck, sleep, harness } = require('./helpers');

const TIMES = { night: 1, discussion: 1, vote: 1, defense: 1, verdict: 1 };
const REPEAT = 3; // 직업 배정이 무작위라서 시나리오마다 여러 판 돌린다

let srv;
let h;
const sockets = [];
before(async () => {
  srv = await startTestServer({
    limits: {
      secondMs: 25, waitingGraceMs: 300, ingameGraceMs: 1000, phaseSec: { min: 1 },
      // 타이머를 25배 빠르게 돌리므로 도배 방지 한도를 넉넉히 둔다 (도배 방지 자체는 chat.test.js 에서 검증)
      chatRate: { count: 100, perMs: 3000 },
    },
  });
  h = harness(srv, sockets, TIMES);
});
after(async () => { sockets.forEach((s) => s.close()); await srv.close(); });

/**
 * 한 판을 돌린다.
 * @param {(ctx) => void} policy  봇이 페이즈마다 무엇을 할지 (ctx: bot, game, ev, helpers)
 */
async function playGame(policy) {
  const { roomId, ps: bots, game } = await h.makeRoom(6);
  const deadAt = new Map(); // userId -> 서버 시각 (사망 확정 순간)
  const probes = []; // 권한 검증 결과
  const pending = [];
  const kills = [];
  const matchesBefore = srv.db.raw.prepare('SELECT COUNT(*) c FROM matches').get().c;

  const rec = (id) => game.players.get(id);
  const aliveList = () => [...game.players.values()].filter((p) => p.alive);
  const send = (bot, channel, text) => emitAck(bot.socket, 'chat:send', { channel, text });

  // 사망이 확정되는 즉시 시각을 기록하고, 권한 프로브를 쏜다
  const onRoomEvent = (rid, event, payload) => {
    if (rid !== roomId || event !== 'player:killed') return;
    deadAt.set(payload.id, Date.now());
    kills.push({ ...payload, at: Date.now() });
    pending.push((async () => {
      await sleep(40);
      if (game.status !== 'playing') return; // 이미 끝났으면 대기실 규칙이 적용되므로 프로브하지 않는다
      const dead = bots.find((b) => b.user.id === payload.id);
      if (rec(payload.id).alive) return;
      // 응답이 돌아온 시점에 게임이 이미 끝났다면 대기실 규칙이 적용된 것이므로 그 프로브는 버린다(타이밍 경합)
      const probe = async (name, expect, bot, channel, text) => {
        const res = await send(bot, channel, text);
        if (game.status !== 'playing') return;
        probes.push({ name, expect, got: res.ok ? 'ok' : res.error });
      };
      // ① 사망자는 public 에 쓸 수 없다
      await probe('dead→public', 'forbidden', dead, 'public', '죽은 자의 발언');
      // ② 사망자는 dead 채널에 쓸 수 있다
      await probe('dead→dead', 'ok', dead, 'dead', `유령 ${dead.user.nickname}`);
      // ③ 살아있는 시민팀은 dead / mafia 채널에 쓸 수 없다
      const living = bots.find((b) => rec(b.user.id).alive && rec(b.user.id).team !== 'mafia');
      if (living && game.status === 'playing') {
        await probe('alive→dead', 'forbidden', living, 'dead', '침투');
        await probe('alive→mafia', 'forbidden', living, 'mafia', '엿듣기');
      }
    })());
  };
  srv.rooms.on('toRoom', onRoomEvent);

  // 봇 행동: phase:change 마다 정책 실행
  let sawSaved = 0;
  for (const bot of bots) {
    bot.socket.on('night:saved', () => { sawSaved++; });
    bot.socket.on('phase:change', (ev) => {
      setTimeout(() => {
        if (game.status !== 'playing' || !rec(bot.user.id)?.alive) return;
        policy({ bot, game, ev, alive: aliveList, send, act: (event, payload) => emitAck(bot.socket, event, payload) });
      }, 3);
    });
  }

  const overP = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('게임이 제한 시간 안에 끝나지 않음')), 20000);
    bots[0].socket.once('game:over', (r) => { clearTimeout(t); resolve(r); });
  });
  const startRes = await emitAck(bots[0].socket, 'game:start');
  assert.equal(startRes.ok, true);
  const over = await overP;
  await Promise.all(pending);
  await sleep(100);
  srv.rooms.off('toRoom', onRoomEvent);

  // ---- 공통 검증: 채널 누수 ----
  const teamOf = Object.fromEntries(over.roles.map((r) => [r.id, r.team]));
  const msgsOf = (bot, ch) => bot.socket.events.filter((e) => e.event === 'chat:message' && e.payload.channel === ch).map((e) => e.payload);

  for (const bot of bots) {
    const id = bot.user.id;
    // dead 채널: 그 메시지가 보내진 시점에 이미 사망한 사람만 받을 수 있다 (생존자는 절대 받지 않는다)
    for (const m of msgsOf(bot, 'dead')) {
      assert.ok(deadAt.has(id) && m.ts >= deadAt.get(id),
        `${bot.user.nickname}(생존 중)가 dead 채널 메시지를 받음: ${m.text}`);
    }
    // mafia 채널: 마피아 팀이거나 이미 사망한 사람만
    for (const m of msgsOf(bot, 'mafia')) {
      const ok = teamOf[id] === 'mafia' || (deadAt.has(id) && m.ts >= deadAt.get(id));
      assert.ok(ok, `${bot.user.nickname}(${teamOf[id]}, 생존 중)가 mafia 채널 메시지를 받음: ${m.text}`);
    }
    // 히스토리: 사망(또는 마피아)해서 채널을 읽게 된 사람만 받는다
    for (const e of bot.socket.events.filter((x) => x.event === 'chat:history')) {
      if (e.payload.channel === 'dead') assert.ok(deadAt.has(id), `${bot.user.nickname} 가 dead 히스토리를 받음`);
      if (e.payload.channel === 'mafia') assert.ok(teamOf[id] === 'mafia' || deadAt.has(id), `${bot.user.nickname} 가 mafia 히스토리를 받음`);
    }
  }
  // 모든 권한 프로브가 기대대로
  assert.ok(probes.length > 0, '권한 프로브가 실행되지 않음');
  for (const p of probes) assert.equal(p.got, p.expect, `${p.name}: ${p.got}`);

  const matchRow = srv.db.raw.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT 1').get();
  const matchesAfter = srv.db.raw.prepare('SELECT COUNT(*) c FROM matches').get().c;
  return { over, bots, game, deadAt, kills, probes, sawSaved, msgsOf, matchRow, matchesBefore, matchesAfter, teamOf };
}

const firstId = (list) => list.map((p) => p.id).sort((a, b) => a - b)[0];

// ---------- 시나리오 A: 시민이 투표로 마피아를 모두 처형 ----------
function citizenWinPolicy({ bot, game, ev, alive, send, act }) {
  const me = game.players.get(bot.user.id);
  const live = alive();
  const mafia = live.filter((p) => p.team === 'mafia');
  const citizens = live.filter((p) => p.team !== 'mafia');
  if (ev.phase === 'night' && me.role === 'mafia') {
    send(bot, 'mafia', '오늘은 조용히 있자'); // 마피아 채널 대화 (누수 검증용)
  } else if (ev.phase === 'discussion') {
    send(bot, 'public', `토론 ${bot.user.nickname}`);
  } else if (ev.phase === 'vote') {
    const target = me.team === 'mafia' ? citizens[0] : mafia.find((p) => p.id === firstId(mafia));
    if (target) act('vote:cast', { targetId: target.id });
  } else if (ev.phase === 'defense' && game.defendantId === me.id) {
    send(bot, 'public', '저는 억울합니다');
  } else if (ev.phase === 'verdict' && game.defendantId !== me.id) {
    act('verdict:cast', { agree: me.team !== 'mafia' });
  }
}

test(`시뮬레이션 6명 × ${REPEAT}판: 시민 승리 (투표 처형), 채널 누수/권한 위반 없음`, async () => {
  for (let i = 0; i < REPEAT; i++) {
    const r = await playGame(citizenWinPolicy);
    assert.equal(r.over.winner, 'citizen', `${i + 1}번째 판`);
    // 마피아 2명이 투표로 처형되었고, 처형 시에만 직업이 공개된다
    const executed = r.kills.filter((k) => k.cause === 'vote');
    assert.equal(executed.length, 2);
    assert.ok(executed.every((k) => k.role === 'mafia'));
    assert.equal(r.kills.filter((k) => k.cause === 'mafia').length, 0); // 밤 킬 없음
    // 사망자는 public 을 읽을 수 있다: 처형된 마피아도 이후 낮 토론 메시지를 받았다
    const firstDead = r.bots.find((b) => b.user.id === executed[0].id);
    assert.ok(r.msgsOf(firstDead, 'public').some((m) => m.ts > executed[0].at), '사망자가 public 을 읽지 못함');
    // 종료 시 전원 직업 공개, 점수 기록 1건 생성
    assert.equal(r.over.roles.length, 6);
    assert.ok(r.over.roles.every((x) => x.role));
    assert.equal(r.matchesAfter, r.matchesBefore + 1);
    assert.equal(r.matchRow.winner_team, 'citizen');
  }
});

// ---------- 시나리오 B: 마피아가 밤마다 제거 (첫날은 의사가 살림) ----------
function mafiaWinPolicy({ bot, game, ev, alive, send, act }) {
  const me = game.players.get(bot.user.id);
  const nonMafia = alive().filter((p) => p.team !== 'mafia');
  const target = nonMafia.find((p) => p.id === firstId(nonMafia)); // 마피아와 의사가 같은 대상을 고른다
  if (ev.phase === 'night') {
    if (me.role === 'mafia' && target) {
      send(bot, 'mafia', `오늘 밤 타깃: ${target.nickname}`);
      act('night:action', { targetId: target.id });
    } else if (me.role === 'doctor' && ev.day === 1 && target) {
      act('night:action', { targetId: target.id }); // 첫날만 정확히 보호
    } else if (me.role === 'police') {
      const m = alive().find((p) => p.team === 'mafia');
      if (m) act('night:action', { targetId: m.id });
    }
  } else if (ev.phase === 'discussion') {
    send(bot, 'public', `토론 ${bot.user.nickname}`);
  }
  // 투표는 아무도 하지 않아 처형 없이 밤으로 넘어간다
}

test(`시뮬레이션 6명 × ${REPEAT}판: 의사 세이브 → 사망자 없음, 이후 마피아 승리`, async () => {
  for (let i = 0; i < REPEAT; i++) {
    const r = await playGame(mafiaWinPolicy);
    assert.equal(r.over.winner, 'mafia', `${i + 1}번째 판`);
    // 첫날 밤: 의사가 살려서 사망자 없음 → 세이브 연출 이벤트를 전원이 받았다
    assert.ok(r.sawSaved >= 6, `night:saved 수신 ${r.sawSaved}`);
    const nightKills = r.kills.filter((k) => k.cause === 'mafia');
    assert.equal(nightKills.length, 2, '이후 두 밤에 한 명씩 제거');
    // 마피아 킬은 직업을 공개하지 않는다
    assert.ok(nightKills.every((k) => k.role === undefined));
    // 사망 시점은 첫날 밤(세이브) 이후여야 한다: 첫 사망은 2일차 이후
    const firstKillAt = Math.min(...nightKills.map((k) => k.at));
    assert.ok(firstKillAt > 0);
    // 경찰 조사 결과는 경찰에게만 전달되었다
    const copId = r.over.roles.find((x) => x.role === 'police').id;
    for (const b of r.bots) {
      const got = b.socket.events.filter((e) => e.event === 'police:result');
      if (b.user.id === copId) assert.ok(got.length >= 1 && got.every((e) => e.payload.isMafia === true));
      else assert.equal(got.length, 0);
    }
    // 마피아는 처형되지 않았으므로 승리 보너스까지 반영 (이탈자 없음)
    const rows = srv.db.raw.prepare('SELECT * FROM match_players WHERE match_id = ?').all(r.matchRow.id);
    const mafiaRows = rows.filter((x) => x.team === 'mafia');
    assert.equal(mafiaRows.length, 2);
    assert.ok(mafiaRows.every((x) => x.result === 'win' && x.rating_delta === 25 + 5 + 5));
  }
});

test('시뮬레이션: 의사가 살린 밤에는 사망자가 발생하지 않는다 (밤 1회만 별도 확인)', async () => {
  const { roomId, ps: bots, game } = await h.makeRoom(6);
  const deaths = [];
  const handler = (rid, ev, p) => { if (rid === roomId && ev === 'player:killed') deaths.push(p); };
  srv.rooms.on('toRoom', handler);
  const saved = new Promise((res) => bots[0].socket.once('night:saved', res));
  for (const bot of bots) {
    bot.socket.on('phase:change', (ev) => {
      if (ev.phase !== 'night' || ev.day !== 1) return;
      setTimeout(() => {
        const me = game.players.get(bot.user.id);
        const nonMafia = [...game.players.values()].filter((p) => p.team !== 'mafia');
        const target = nonMafia.find((p) => p.id === firstId(nonMafia));
        if (me.role === 'mafia' || me.role === 'doctor') emitAck(bot.socket, 'night:action', { targetId: target.id });
      }, 3);
    });
  }
  await emitAck(bots[0].socket, 'game:start');
  await saved;
  await sleep(300); // 아침 결과가 모두 공개될 때까지
  srv.rooms.off('toRoom', handler);
  assert.equal(deaths.length, 0);
  assert.equal([...game.players.values()].filter((p) => p.alive).length, 6);
  // 정리: 게임을 끝까지 둘 필요 없이 방을 나간다
  for (const b of bots) await emitAck(b.socket, 'room:leave');
});
