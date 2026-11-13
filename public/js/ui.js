// 공용 UI 부품: SVG 아이콘 세트, 인물 아바타, 티어 문장(crest). 이모지는 쓰지 않는다.
// 아이콘은 24x24 선(stroke) 스타일이며 currentColor 를 따른다.
(function () {
  const P = {
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z"/><path d="M5 21h14"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    ghost: '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.33-1.8L14.33 20 12 18.2 9.67 20 7.33 18.2 5 20z"/><circle cx="9.5" cy="11" r="1" fill="currentColor"/><circle cx="14.5" cy="11" r="1" fill="currentColor"/>',
    cross: '<path d="M6 6l12 12M18 6L6 18"/>',
    magnifier: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',
    gavel: '<path d="M13 4l7 7-3.5 3.5-7-7L13 4z"/><path d="M11.5 12.5L4 20"/><path d="M3 21h8"/>',
    ballot: '<path d="M4 12h16v8H4z"/><path d="M9 4h6v8H9z"/><path d="M11 8h2"/>',
    scales: '<path d="M12 3v17"/><path d="M5 7h14"/><path d="M5 7l-3 7h6l-3-7z"/><path d="M19 7l-3 7h6l-3-7z"/><path d="M8 20h8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    chat: '<path d="M4 5h16v11H9l-5 4V5z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
    star: '<path d="M12 3l2.8 6 6.2.7-4.7 4.3 1.3 6.5L12 17.2 6.4 20.5l1.3-6.5L3 9.7 9.2 9 12 3z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    fedora: '<path d="M2.5 16h19"/><path d="M6 16c0-6 2-9.5 6-9.5S18 10 18 16"/><path d="M6.2 12.5h11.6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    door: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
    trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0V4z"/><path d="M8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 14v4M8 20h8"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3v4l5 5 5-5V3M7 21v-4l5-5 5 5v4"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21h4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    wifiOff: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M3 3l18 18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/>',
    dagger:'<path d="M20 4L10 14"/><path d="M13 17l-6-6 2.5-2.5 6 6L13 17z"/><path d="M7 17l-4 4"/>',
  };

  /** SVG 문자열 */
  function svg(name, size = 18, cls = '') {
    const body = P[name] || '';
    return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  /** SVG 요소 */
  function el(name, size, cls) {
    const t = document.createElement('template');
    t.innerHTML = svg(name, size, cls);
    return t.content.firstElementChild;
  }
  /** [data-icon] 속성을 가진 요소에 아이콘을 채운다 */
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((n) => {
      if (n.dataset.iconDone) return;
      n.insertAdjacentHTML('afterbegin', svg(n.dataset.icon, Number(n.dataset.iconSize) || 16));
      n.dataset.iconDone = '1';
    });
  }

  // ---------- 인물 아바타 (id 로 결정되는 누아르 초상화) ----------
  const SKIN = ['#e8c9a8', '#d9ad84', '#c08d63', '#9a6a45', '#f0d5bd'];
  const SUIT = ['#1b1a22', '#2a1c20', '#1c2430', '#262219', '#241b2e'];
  const TIE = ['#c9302c', '#d4a843', '#4f8fd9', '#4fae7d', '#b45cc9'];

  /** av(프로필 사진 버전)가 있으면 업로드한 사진, 없으면 id 로 결정되는 생성 초상화 */
  function avatar(id, size = 56, av = 0) {
    const n = Math.abs(Number(id) || 0);
    if (Number(av) > 0) {
      return `<img class="avatar-img" src="/api/avatar/${n}?v=${Number(av)}" width="${Number(size)}" height="${Number(size)}" alt="" draggable="false">`;
    }
    const skin = SKIN[n % SKIN.length];
    const suit = SUIT[(n >> 1) % SUIT.length];
    const tie = TIE[(n >> 2) % TIE.length];
    const kind = (n * 7 + 3) % 6;
    const hue = (n * 67) % 360;
    const hair = ['#1b1410', '#3b2a1c', '#6b4a2a', '#2a2a2e', '#7d7d86'][(n >> 3) % 5];
    let top = '';
    if (kind === 0) { // 중절모
      top = `<ellipse cx="32" cy="22" rx="19" ry="4" fill="#111"/><path d="M19 22c1-9 5-13 13-13s12 4 13 13z" fill="#1d1d22"/><rect x="19.5" y="18" width="25" height="3.4" fill="${tie}"/>`;
    } else if (kind === 1) { // 단발
      top = `<path d="M20 25c-1-11 5-16 12-16s13 5 12 16c-3-5-8-7-12-7s-9 2-12 7z" fill="${hair}"/>`;
    } else if (kind === 2) { // 긴 머리
      top = `<path d="M19 30c-2-13 4-21 13-21s15 8 13 21l-3 12h-4V26c-4-1-8-3-10-7-1 4-4 6-8 7v16h-4l-3-12z" fill="${hair}"/>`;
    } else if (kind === 3) { // 대머리 + 안경
      top = `<g fill="none" stroke="#111" stroke-width="1.6"><circle cx="26" cy="28" r="4.4"/><circle cx="38" cy="28" r="4.4"/><path d="M30.4 28h3.2"/></g>`;
    } else if (kind === 4) { // 캡
      top = `<path d="M19 24c0-9 5-13 13-13s13 4 13 13z" fill="${suit === '#1b1a22' ? '#33364a' : '#222'}"/><path d="M19 24h30c0 2-3 3-8 3H19z" fill="#111"/>`;
    } else { // 올림머리
      top = `<circle cx="32" cy="9" r="5" fill="${hair}"/><path d="M20 26c-1-10 4-15 12-15s13 5 12 15c-3-4-8-6-12-6s-9 2-12 6z" fill="${hair}"/>`;
    }
    return `<svg class="avatar-svg" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <defs><radialGradient id="ag${n}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="hsl(${hue} 35% 34%)"/><stop offset="1" stop-color="hsl(${hue} 40% 10%)"/></radialGradient></defs>
      <rect width="64" height="64" fill="url(#ag${n})"/>
      <path d="M6 64c1-13 11-19 26-19s25 6 26 19z" fill="${suit}"/>
      <path d="M26 46l6 8 6-8-3-2h-6z" fill="#e8e2d2"/><path d="M30.5 49h3l1.2 11h-5.4z" fill="${tie}"/>
      <rect x="28" y="38" width="8" height="9" rx="3" fill="${skin}"/>
      <ellipse cx="32" cy="29" rx="11.5" ry="13" fill="${skin}"/>
      ${kind === 3 ? '' : ''}
      <circle cx="27.6" cy="29" r="1.2" fill="#1a1410"/><circle cx="36.4" cy="29" r="1.2" fill="#1a1410"/>
      <path d="M28.5 35.5q3.5 2 7 0" fill="none" stroke="#7a4a3a" stroke-width="1.3" stroke-linecap="round"/>
      ${top}
    </svg>`;
  }

  // ---------- 티어 문장 ----------
  const TIER_COLORS = {
    thug: ['#c5c0b4', '#4d4a43'], hoodlum: ['#e0a171', '#7a4a2a'], enforcer: ['#f0706a', '#7a1a16'],
    capo: ['#f6d77a', '#9a741a'], boss: ['#c9a2ff', '#4b2a8f'], godfather: ['#4a4a56', '#0e0e14'],
  };
  const TIER_NAMES = { thug: '똘마니', hoodlum: '건달', enforcer: '행동대장', capo: '간부', boss: '보스', godfather: '대부' };
  // 티어별 문장 안의 상징: 단검 → 중절모 → 해골 → 스페이드 → 왕관 → 장미
  const TIER_GLYPH = {
    thug: '<path d="M16 8l2.2 7-2.2 5-2.2-5z" fill="#fff"/><path d="M12.5 16.5h7" stroke="#fff" stroke-width="1.4"/><path d="M16 20v2.5" stroke="#fff" stroke-width="1.6"/>',
    hoodlum: '<ellipse cx="16" cy="17.5" rx="7.5" ry="2" fill="#fff"/><path d="M11.5 17c0-4 1.8-6.5 4.5-6.5s4.5 2.5 4.5 6.5z" fill="#fff"/><rect x="11.6" y="14.6" width="8.8" height="1.4" fill="rgba(0,0,0,.45)"/>',
    enforcer: '<path d="M16 9.5c-3.3 0-5.5 2.2-5.5 5 0 1.8.9 3 2 3.8V21h7v-2.7c1.1-.8 2-2 2-3.8 0-2.8-2.2-5-5.5-5z" fill="#fff"/><circle cx="13.6" cy="15" r="1.4" fill="rgba(0,0,0,.6)"/><circle cx="18.4" cy="15" r="1.4" fill="rgba(0,0,0,.6)"/>',
    capo: '<path d="M16 9c3 3 6 5 6 8a3 3 0 0 1-5 2c.1 1.2.5 2 1.4 2.8h-4.8c.9-.8 1.3-1.6 1.4-2.8a3 3 0 0 1-5-2c0-3 3-5 6-8z" fill="#fff"/>',
    boss: '<path d="M9.5 21l-1-9 4.3 3.7L16 10l3.2 5.7 4.3-3.7-1 9z" fill="#fff"/>',
    godfather: '<circle cx="16" cy="13.5" r="4.6" fill="#f3d98b"/><path d="M13 13.5c0-2 1.4-3 3-3s2.6 1 2.6 2.4c0 1.3-1 2-2 2" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1"/><path d="M16 18v6" stroke="#f3d98b" stroke-width="1.4"/><path d="M16 21c-2.5 0-3.5-1-4-2 2 0 3.2.5 4 2zM16 22c2.2 0 3.3-.8 4-1.8-2 0-3.2.4-4 1.8z" fill="#f3d98b"/>',
  };

  function tierCrest(key, size = 28) {
    const k = TIER_COLORS[key] ? key : 'thug';
    const [hi, lo] = TIER_COLORS[k];
    const rim = k === 'godfather' ? '#d4a843' : 'rgba(0,0,0,.45)';
    const inner = k === 'godfather' ? 'rgba(243,217,139,.7)' : 'rgba(255,255,255,.55)';
    return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="tc-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
      <path d="M16 2l12 4v9c0 8-5.5 12.5-12 15C9.5 27.5 4 23 4 15V6l12-4z" fill="url(#tc-${k})" stroke="${rim}" stroke-width="1"/>
      <path d="M16 5l9 3v7c0 6-4 9.5-9 11.6C11 24.5 7 21 7 15V8l9-3z" fill="none" stroke="${inner}" stroke-width=".9"/>
      ${TIER_GLYPH[k]}
    </svg>`;
  }
  const tierName = (key) => TIER_NAMES[key] || '';

  window.Icons = { svg, el, hydrate, avatar, tierCrest, tierName };
  document.addEventListener('DOMContentLoaded', () => hydrate());
})();
