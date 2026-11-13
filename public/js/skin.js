// 스킨 선택/적용. <head> 에서 동기 로드해서 첫 화면부터 깜빡임 없이 적용한다.
// 선택값은 localStorage 에 저장한다 (저장소를 못 쓰는 환경에서는 기본 스킨으로 동작).
(function () {
  const KEY = 'mafia.skin';
  const SKINS = [
    ['', '기본 (누아르)'],
    ['claude', 'Claude 스타일'],
    ['mm', 'Mattermost 스타일'],
  ];
  const valid = (v) => SKINS.some(([k]) => k === v);

  function read() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, v); } catch { /* 저장소 사용 불가 */ }
  }

  // Mattermost 스타일은 Open Sans 를 쓴다. 해당 스킨일 때만 글꼴을 내려받는다.
  function loadFont() {
    if (document.getElementById('skin-font')) return;
    const l = document.createElement('link');
    l.id = 'skin-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap';
    document.head.append(l);
  }

  function apply(v) {
    const root = document.documentElement;
    if (v && valid(v)) root.dataset.skin = v; else delete root.dataset.skin;
    if (v === 'mm') loadFont();
    const sel = document.getElementById('skin-select');
    if (sel) sel.value = valid(v) ? v : '';
  }

  apply(read());
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(read()); }); // 다른 탭과 동기화

  document.addEventListener('DOMContentLoaded', () => {
    const wrap = document.createElement('label');
    wrap.className = 'skin-pick';
    wrap.title = '화면 스킨';
    if (window.Icons) wrap.insertAdjacentHTML('afterbegin', Icons.svg('palette', 16));
    const sel = document.createElement('select');
    sel.id = 'skin-select';
    sel.setAttribute('aria-label', '화면 스킨');
    for (const [k, name] of SKINS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = name;
      sel.append(o);
    }
    sel.value = valid(read()) ? read() : '';
    sel.addEventListener('change', () => { write(sel.value); apply(sel.value); });
    wrap.append(sel);

    // 상단 바가 있으면 거기에, 없으면(로그인) 화면 모서리에 띄운다
    const right = document.querySelector('.gb-right');
    const nav = document.querySelector('.topbar .nav-links');
    if (right) right.prepend(wrap);
    else if (nav) nav.before(wrap);
    else { wrap.classList.add('floating'); document.body.append(wrap); }
  });
})();
