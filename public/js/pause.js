// 일시정지 + 위장 화면. 판정은 전부 서버가 하고, 여기서는 화면만 그린다.
// 위장 화면은 Claude 새 채팅 화면을 흉내 낸 정적 페이지다 (실제 Claude/서버와 아무 연결이 없다).
const Pause = (() => {
  const $ = (id) => document.getElementById(id);
  const ASTERISK = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#d97757" stroke-width="3" stroke-linecap="round" fill="none"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3L5.3 18.7"/></g></svg>';
  const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#faf9f5"/>'
    + '<g stroke="#d97757" stroke-width="3" stroke-linecap="round"><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"/></g></svg>');
  const RECENTS = ['파이썬 리스트 정렬 방법', '회의록 요약 부탁드려요', '엑셀 VLOOKUP 오류 해결', '이메일 문장 다듬기', '주간 보고서 초안'];
  let disguised = false;
  let built = false;
  let saved = null;

  const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? '늦은 시간이네요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  };

  function build() {
    if (built) return;
    built = true;
    const nick = (typeof state !== 'undefined' && state?.players?.find((p) => p.id === state.youId)?.nickname) || '';
    const root = document.createElement('div');
    root.id = 'fake-claude';
    root.className = 'fake-claude';
    root.innerHTML = `
      <aside class="fk-side">
        <div class="fk-brand">${ASTERISK}<span>Claude</span></div>
        <div class="fk-nav">
          <div class="new"><i>+</i>새 채팅</div>
          <div><span class="ic">▤</span>채팅</div>
          <div><span class="ic">▣</span>프로젝트</div>
          <div><span class="ic">◇</span>아티팩트</div>
        </div>
        <h6>최근 항목</h6>
        <div class="fk-recents"></div>
        <div class="fk-me"><b></b><span><span class="fk-name"></span><small>무료 플랜</small></span></div>
      </aside>
      <main class="fk-main">
        <div class="fk-plan">무료 플랜 · 업그레이드</div>
        <div class="fk-hello">${ASTERISK}<h1></h1></div>
        <div class="fk-box">
          <textarea rows="2" placeholder="오늘 어떤 도움이 필요하세요?"></textarea>
          <div class="fk-tools"><span class="plus">+</span><span class="model">Sonnet ⌄</span><span class="send">↑</span></div>
        </div>
        <div class="fk-chips"><span>✎ 글쓰기</span><span>🎓 학습</span><span>&lt;/&gt; 코드</span><span>☕ 일상</span></div>
      </main>`;
    const rec = root.querySelector('.fk-recents');
    for (const t of RECENTS) { const d = document.createElement('div'); d.textContent = t; rec.append(d); }
    root.querySelector('.fk-name').textContent = nick || '사용자';
    root.querySelector('.fk-me b').textContent = (nick || 'U').slice(0, 1).toUpperCase();
    root.querySelector('h1').textContent = nick ? `${greeting()}, ${nick}님` : greeting();
    // 입력해도 아무 일도 일어나지 않는다 (전송 없음)
    root.querySelector('textarea').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
    });
    // 숨은 복귀 장치: 인사말을 더블클릭하거나 Esc
    root.querySelector('h1').addEventListener('dblclick', hide);
    document.body.append(root);
  }

  function show() {
    build();
    if (disguised) return;
    disguised = true;
    saved = { title: document.title, icons: [...document.querySelectorAll('link[rel~="icon"]')] };
    document.title = 'Claude';
    saved.icons.forEach((l) => l.remove());
    const fav = document.createElement('link');
    fav.rel = 'icon';
    fav.id = 'fake-fav';
    fav.href = FAVICON;
    document.head.append(fav);
    $('fake-claude').classList.add('on');
    $('fake-claude').querySelector('textarea').focus();
  }

  function hide() {
    if (!disguised) return;
    disguised = false;
    $('fake-claude').classList.remove('on');
    $('fake-fav')?.remove();
    if (saved) { document.title = saved.title; saved.icons.forEach((l) => document.head.append(l)); }
    saved = null;
    if (document.activeElement) document.activeElement.blur();
  }

  const send = (event) => socket.emit(event, {}, (res) => {
    if (res?.error) flash(ERRORS[res.error] || '지금은 할 수 없습니다.');
  });

  /** 일시정지 + 화면 가리기 (버튼 / Esc). 일시정지 횟수가 없거나 대기실이어도 화면은 가린다. */
  function panic() {
    if (typeof state === 'undefined' || !state) return;
    const p = state.status === 'playing' ? state.pause : null;
    if (p && !p.active && p.left > 0) send('game:pause');
    show();
  }

  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  /** room:state 가 올 때마다 호출 */
  function sync(st) {
    const btn = $('pause-btn');
    const p = st.status === 'playing' ? st.pause : null;
    btn.hidden = !p;
    if (p) {
      btn.querySelector('.n').textContent = p.active ? '' : ` (${p.left})`;
      btn.disabled = !p.active && p.left <= 0;
    }
    $('pause-ov').classList.toggle('hidden', !p?.active);
    if (p?.active) {
      $('pause-who').textContent = p.active.by === st.youId ? '내가 게임을 멈췄습니다' : `${p.active.byNickname}님이 게임을 멈췄습니다`;
      tick();
    }
  }

  function tick() {
    const a = typeof state !== 'undefined' && state?.status === 'playing' && state.pause?.active;
    if (a) $('pause-auto').textContent = fmt(Math.max(0, a.until - Date.now()));
  }

  function init() {
    $('pause-btn').onclick = panic;
    $('pause-resume').onclick = () => send('game:resume');
    $('pause-hide').onclick = show;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.repeat) return;
      if (disguised) hide(); else panic();
    });
    setInterval(tick, 500);
  }

  return { init, sync, show, hide, panic, get disguised() { return disguised; } };
})();
