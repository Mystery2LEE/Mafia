// 연출. CSS keyframes(anim.css) + Web Animations API 만 사용한다.
// room.js 가 서버 이벤트를 받을 때 window.Anim 의 훅을 호출한다.
(function () {
  const ROLE_NAMES = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };
  const $ = (id) => document.getElementById(id);
  const fx = () => $('fx');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ----- 움직임 줄이기 (OS 설정 + 수동 체크, 수동 설정은 localStorage 에 기억) -----
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches || document.body.classList.contains('reduce-motion');

  function initReduceToggle() {
    const box = $('reduce-motion');
    let saved = null;
    try { saved = localStorage.getItem('reduceMotion'); } catch { /* 저장소 사용 불가 */ }
    const on = saved === null ? mq.matches : saved === '1';
    document.body.classList.toggle('reduce-motion', on);
    if (box) {
      box.checked = on;
      box.addEventListener('change', () => {
        document.body.classList.toggle('reduce-motion', box.checked);
        try { localStorage.setItem('reduceMotion', box.checked ? '1' : '0'); } catch { /* 무시 */ }
      });
    }
  }
  document.addEventListener('DOMContentLoaded', initReduceToggle);

  // ----- 유틸 -----
  /** 요소에 애니메이션을 건다. 움직임 줄이기면 즉시 끝난 것으로 처리 */
  function play(el, keyframes, opts) {
    if (!el.animate) return Promise.resolve();
    const a = el.animate(keyframes, { fill: 'both', easing: 'ease-out', ...opts });
    return a.finished.catch(() => {});
  }
  function layer(cls, text) {
    const d = document.createElement('div');
    d.className = cls;
    if (text !== undefined) d.textContent = text;
    fx().append(d);
    return d;
  }
  const card = (id) => document.querySelector(`.pcard[data-id="${id}"]`);
  // 직후 room:state 로 목록이 다시 그려지므로, 요소는 잠깐 뒤에 찾는다
  const withCard = (id, fn) => setTimeout(() => { const c = card(id); if (c) fn(c); }, 80);

  function shake(el, ms = 400, amp = 10) {
    if (reduced()) return Promise.resolve();
    const k = [];
    for (let i = 0; i <= 8; i++) {
      const s = i === 8 ? 0 : (i % 2 ? 1 : -1) * amp * (1 - i / 9);
      k.push({ transform: `translate(${s}px, ${-s / 3}px)` });
    }
    return play(el, k, { duration: ms, easing: 'linear', fill: 'none' });
  }

  function banner(iconName, text, ms = 1600) {
    const b = layer('banner');
    b.innerHTML = `${Icons.svg(iconName, 34)}<span></span>`;
    b.lastChild.textContent = text;
    return play(b, [
      { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.9)' },
      { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)', offset: 0.2 },
      { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'translateX(-50%) translateY(-6px) scale(1)' },
    ], { duration: reduced() ? Math.min(ms, 900) : ms, easing: 'ease-in-out' }).then(() => b.remove());
  }

  function flipCard(role, caption) {
    const c = layer('flipcard');
    const inner = document.createElement('div');
    inner.className = 'inner';
    inner.innerHTML = `<div class="face front">${Icons.svg('fedora', 52)}</div><div class="face back"><img alt=""></div>`;
    inner.querySelector('img').src = `/img/${role}.svg`;
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = caption;
    c.append(inner, cap);
    const flip = play(inner, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
      { duration: reduced() ? 1 : 900, easing: 'ease-in-out' });
    return { el: c, flip };
  }

  const PHASE_BANNERS = {
    night: ['moon', '밤이 되었습니다'], morning: ['sun', '아침이 밝았습니다'], discussion: ['chat', '낮 토론'],
    vote: ['ballot', '투표 시간'], defense: ['mic', '최후 변론'], verdict: ['scales', '찬반 투표'],
  };

  const Anim = {
    holdRoleCard: false,

    // 직업 배정: 카드 3D 플립(rotateY 180°) → 직업 SVG 공개, 마피아면 붉은 글로우(CSS)
    roleAssigned() {
      const rc = $('role-flip');
      Anim.holdRoleCard = true;
      rc.classList.remove('flipped');
      setTimeout(() => {
        Anim.holdRoleCard = false;
        rc.classList.add('flipped');
      }, reduced() ? 50 : 1200);
    },

    // 낮/밤 전환은 body.night 클래스의 CSS 크로스페이드(배경 + 비네트). 여기서는 안내 배너만
    phaseChange(p) {
      if (PHASE_BANNERS[p.phase]) banner(...PHASE_BANNERS[p.phase]);
    },

    // 사망자 발생: 원인별 연출
    killed(k) {
      if (k.cause === 'mafia') Anim._mafiaKill(k);
      else if (k.cause === 'vote') Anim._execution(k);
      else withCard(k.id, (c) => play(c, [{ opacity: 1 }, { opacity: 0.4 }], { duration: 600 }));
    },

    // 마피아 킬: 붉은 플래시 → 스크린 셰이크(0.4s) → X 스탬프 → 흑백 + 기울어지며 아래로 떨어짐
    async _mafiaKill(k) {
      if (!reduced()) {
        const f = layer('flash');
        play(f, [{ opacity: 0 }, { opacity: 0.8, offset: 0.2 }, { opacity: 0 }], { duration: 450 }).then(() => f.remove());
        shake(document.querySelector('.stage'), 400, 12);
        await sleep(420);
      }
      withCard(k.id, async (c) => {
        const av = c.querySelector('.avatar');
        const stamp = av && av.querySelector('.stamp.dead');
        if (stamp) {
          play(stamp, [
            { transform: 'rotate(-18deg) scale(3)', opacity: 0 },
            { transform: 'rotate(-18deg) scale(1)', opacity: 1 },
          ], { duration: reduced() ? 1 : 300 });
        }
        await play(c, [
          { transform: 'translate(-50%, -50%) rotate(0deg)', filter: 'grayscale(0) brightness(1)' },
          { transform: 'translate(-50%, -44%) rotate(9deg)', filter: 'grayscale(1) brightness(0.7)' },
        ], { duration: reduced() ? 1 : 900, easing: 'cubic-bezier(.5,0,.9,.4)' });
      });
    },

    // 처형: 중앙으로 이동 → 스포트라이트/판결봉 → 쓰러지며 페이드아웃 → 직업 카드 뒤집어 공개 (총 ~3.6초)
    async _execution(k) {
      const fast = reduced();
      await sleep(100);
      const c = card(k.id);
      const name = c ? c.querySelector('.plate').textContent : '';
      const r = c ? c.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
      const cx = innerWidth / 2;
      const cy = innerHeight * 0.55;

      const spot = layer('spot');
      const av = layer('exec-avatar');
      const seatPortrait = c && c.querySelector('.portrait');
      av.innerHTML = `<div class="exec-portrait">${seatPortrait ? seatPortrait.innerHTML : Icons.avatar(k.id, 64)}</div>`; // 좌석에 그려진 초상화 복사 (생성 SVG 또는 서버 사진 <img>)
      const nm = layer('exec-name', name);
      av.style.left = `${r.left + r.width / 2 - 32}px`;
      av.style.top = `${r.top + 6}px`;
      nm.style.left = `${r.left + r.width / 2}px`;
      nm.style.top = `${r.top + 74}px`;

      play(spot, [{ opacity: 0 }, { opacity: 1 }], { duration: fast ? 1 : 500 });
      await Promise.all([
        play(av, [{ transform: 'translate(0,0)' }, { transform: `translate(${cx - (r.left + r.width / 2)}px, ${cy - r.top - 38}px) scale(1.7)` }],
          { duration: fast ? 1 : 800, easing: 'ease-in-out' }),
        play(nm, [{ transform: 'translateX(-50%) translate(0,0)' }, { transform: `translateX(-50%) translate(${cx - (r.left + r.width / 2)}px, ${cy - r.top - 20}px)` }],
          { duration: fast ? 1 : 800, easing: 'ease-in-out' }),
      ]);

      if (!fast) {
        const g = layer('gavel');
        g.innerHTML = Icons.svg('gavel', 96);
        await play(g, [
          { transform: 'translateY(-160px) rotate(-50deg)', opacity: 0 },
          { transform: 'translateY(-40px) rotate(-50deg)', opacity: 1, offset: 0.4 },
          { transform: 'translateY(30px) rotate(10deg)', opacity: 1 },
        ], { duration: 450, easing: 'ease-in' });
        shake(document.querySelector('.stage'), 300, 8);
        await sleep(250);
        g.remove();
      }
      await Promise.all([
        play(av, [{ opacity: 1 }, { opacity: 0 }].map((f, i) => ({
          ...f, transform: i ? `translate(${cx - (r.left + r.width / 2)}px, ${cy - r.top + 40}px) scale(1.7) rotate(90deg)`
            : `translate(${cx - (r.left + r.width / 2)}px, ${cy - r.top - 38}px) scale(1.7)`,
        })), { duration: fast ? 1 : 700, easing: 'ease-in' }),
        play(nm, [{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 1 : 700 }),
      ]);
      av.remove(); nm.remove();

      const { el, flip } = flipCard(k.role, `${name} — ${ROLE_NAMES[k.role] || ''}`);
      await flip;
      await sleep(fast ? 800 : 1000); // 전체 약 4.2초 — 처형 단계(5초) 안에 끝나야 밤 전환과 겹치지 않는다
      el.remove();
      play(spot, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).then(() => spot.remove());
    },

    // 의사 세이브: 녹색 펄스 링 + "누군가 살아남았습니다" 텍스트 팝
    saved() {
      const t = layer('poptext', '누군가 살아남았습니다');
      play(t, [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.6)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.08)', offset: 0.25 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
      ], { duration: reduced() ? 1400 : 2200, easing: 'ease-out' }).then(() => t.remove());
      if (reduced()) return;
      for (let i = 0; i < 2; i++) {
        const ring = layer('pulse');
        setTimeout(() => play(ring, [
          { transform: 'scale(0.2)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 },
        ], { duration: 1100 }).then(() => ring.remove()), i * 400);
      }
    },

    // 경찰 조사 결과: 돋보기가 대상 위로 이동 → 마피아면 빨강 / 아니면 파랑 스탬프(렌더 직후 스탬프가 팝)
    policeResult(r) {
      setTimeout(async () => {
        const c = card(r.targetId);
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const stamp = c.querySelector('.stamp:not(.dead)');
        if (stamp && !reduced()) {
          play(stamp, [
            { opacity: 0, transform: 'rotate(-18deg) scale(3)' },
            { opacity: 1, transform: 'rotate(-18deg) scale(1)' },
          ], { duration: 350, delay: 1100, fill: 'backwards' });
        }
        if (reduced()) return;
        const m = layer('magnifier');
        m.innerHTML = Icons.svg('magnifier', 52);
        const sx = innerWidth / 2;
        const sy = innerHeight - 80;
        const tx = rect.left + rect.width / 2 - 20;
        const ty = rect.top + 10;
        m.style.left = `${sx}px`;
        m.style.top = `${sy}px`;
        await play(m, [
          { transform: 'translate(0,0)' },
          { transform: `translate(${tx - sx}px, ${ty - sy}px)` },
        ], { duration: 900, easing: 'ease-in-out' });
        await sleep(300);
        play(m, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).then(() => m.remove());
      }, 100);
    },

    // 투표 집계: 득표 바는 CSS transition 으로 늘어나고, 최다 득표자 아바타가 흔들린다
    voteUpdate(tally) {
      const entries = Object.entries(tally);
      if (!entries.length || reduced()) return;
      const top = Math.max(...entries.map(([, n]) => n));
      const leaders = entries.filter(([, n]) => n === top);
      if (leaders.length !== 1) return;
      setTimeout(() => {
        const c = card(leaders[0][0]);
        const av = c && c.querySelector('.avatar');
        if (av) play(av, [
          { transform: 'rotate(0)' }, { transform: 'rotate(-12deg)' }, { transform: 'rotate(10deg)' },
          { transform: 'rotate(-6deg)' }, { transform: 'rotate(0)' },
        ], { duration: 500, fill: 'none', easing: 'linear' });
      }, 60);
    },

    // 동점 / 투표 없음: 이번 투표는 넘어간다는 것을 화면 가운데에 분명히 알린다
    notice(iconName, title, sub, ms = 4200) {
      const n = layer('notice');
      n.innerHTML = `${Icons.svg(iconName, 30)}<div><b></b><span></span></div>`;
      n.querySelector('b').textContent = title;
      n.querySelector('span').textContent = sub;
      return play(n, [
        { opacity: 0, transform: 'translate(-50%, -40%) scale(0.94)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.12 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.85 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
      ], { duration: reduced() ? Math.min(ms, 2400) : ms, easing: 'ease-out' }).then(() => n.remove());
    },

    voteResult(r) {
      if (r.defendantId == null) {
        if (r.reason === 'tie') {
          Anim.notice('scales', '동점입니다',
            `${(r.tied || []).map((t) => `${t.nickname} ${t.votes}표`).join(' · ')} — 이번 투표는 넘어갑니다`);
        } else if (r.reason === 'no_votes') {
          Anim.notice('ballot', '투표가 없었습니다', '이번 투표는 넘어갑니다');
        }
        return;
      }
      if (reduced()) return;
      setTimeout(() => {
        const c = card(r.defendantId);
        if (c) shake(c, 600, 8);
      }, 100);
    },

    // 내가 사망: "당신은 사망했습니다" 타이틀 (채도 감소는 body.ghost, 사망자 탭 활성화는 room.js)
    iDied() {
      const t = layer('bigtitle');
      t.innerHTML = `${Icons.svg('ghost', 56)}<span>당신은 사망했습니다</span>`;
      play(t, [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.2 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
      ], { duration: reduced() ? 1800 : 2800 }).then(() => t.remove());
    },

    // 게임 종료: 승리 진영 컬러 confetti + 전원 직업 카드 순차 플립
    gameOver(r) {
      const flips = document.querySelectorAll('#over-roles .flip');
      flips.forEach((f, i) => setTimeout(() => f.classList.add('shown'), reduced() ? 0 : 500 + i * 450));
      if (reduced()) return;
      const colors = r.winner === 'mafia'
        ? ['#d9473f', '#7a1f1a', '#222', '#ff8a80'] : ['#3a8dff', '#e0b341', '#fff', '#3fb56b'];
      Anim._confetti(colors, 3800);
    },

    // 종료 화면: 레이팅 변화 카운트업(+/-) + 승급/강등 연출
    rating(r, box) {
      const LABEL = {
        win: '승리', loss: '패배', survived: '생존', policeHit: '조사 성공', doctorSave: '세이브 성공',
        mafiaNotExecutedWin: '처형당하지 않은 승리', left: '이탈(패배 처리)', leavePenalty: '이탈 패널티',
      };
      box.replaceChildren();
      const line = document.createElement('div');
      line.className = 'rating-line';
      const num = document.createElement('span');
      const dl = document.createElement('span');
      dl.className = `rating-delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`;
      line.append(num, document.createTextNode(' '), dl);
      box.append(line);

      if (!r.counted) {
        const note = document.createElement('div');
        note.className = 'rating-break';
        note.textContent = ({
          too_few_players: '인원이 부족해 랭킹에 반영되지 않았습니다.',
          too_many_leavers: '이탈자가 많아 랭킹에 반영되지 않았습니다.',
          custom_rules: '마피아 수를 직접 정한 판이라 랭킹에 반영되지 않았습니다.',
        })[r.reason] || '이 판은 랭킹에 반영되지 않았습니다.';
        box.append(note);
      }
      if (r.breakdown.length) {
        const br = document.createElement('div');
        br.className = 'rating-break';
        br.textContent = r.breakdown.map((b) => `${LABEL[b.key] || b.key} ${b.value > 0 ? '+' : ''}${b.value}`).join(' · ');
        box.append(br);
      }

      const render = (v) => {
        num.textContent = Math.round(v);
        const d = Math.round(v) - r.before;
        dl.textContent = `(${d > 0 ? '+' : ''}${d})`;
      };
      const ms = reduced() ? 0 : 1400;
      if (!ms || r.delta === 0) {
        render(r.after);
      } else {
        const t0 = performance.now();
        (function tick(now) {
          const k = Math.min(1, (now - t0) / ms);
          render(r.before + (r.after - r.before) * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(tick);
        })(t0);
      }

      const up = r.tierAfter.index > r.tierBefore.index;
      const down = r.tierAfter.index < r.tierBefore.index;
      if (up || down) {
        const tc = document.createElement('div');
        tc.className = `tier-change ${up ? 'up' : 'down'}`;
        tc.innerHTML = `${Icons.svg(up ? 'arrowUp' : 'arrowDown', 20)}<span></span>`;
        tc.lastChild.textContent = up
          ? ` 승급 ${r.tierBefore.name} → ${r.tierAfter.name}` : ` 강등 ${r.tierBefore.name} → ${r.tierAfter.name}`;
        box.append(tc);
        play(tc, up
          ? [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1.25)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }]
          : [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: reduced() ? 1 : 900, delay: reduced() ? 0 : ms, fill: 'backwards' });
        if (up && !reduced()) setTimeout(() => Anim._confetti(['#e0b341', '#fff', '#ffd966'], 2500), ms);
      }
    },

    _confetti(colors, ms) {
      const cv = document.createElement('canvas');
      fx().append(cv);
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      ctx.scale(dpr, dpr);
      const parts = Array.from({ length: 160 }, () => ({
        x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
        vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
      }));
      const start = performance.now();
      (function frame(now) {
        const t = now - start;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of parts) {
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - t / ms);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        if (t < ms) requestAnimationFrame(frame); else cv.remove();
      })(start);
    },
  };

  window.Anim = Anim;
})();
