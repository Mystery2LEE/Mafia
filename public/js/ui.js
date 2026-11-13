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

  function avatar(id, size = 56) {
    const n = Math.abs(Number(id) || 0);
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
    bronze: ['#e0a171', '#7a4a2a'], silver: ['#e6eaf2', '#7b8599'], gold: ['#f6d77a', '#9a741a'],
    platinum: ['#9ff0e2', '#2d8f86'], diamond: ['#a9ccff', '#3a62b8'], master: ['#ffb3ec', '#8a3fb8'],
  };
  const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];

  function tierCrest(key, size = 28) {
    const [hi, lo] = TIER_COLORS[key] || TIER_COLORS.bronze;
    const rank = Math.max(0, TIER_ORDER.indexOf(key)) + 1;
    const pips = Array.from({ length: Math.min(rank, 5) }, (_, i) => {
      const x = 16 - (Math.min(rank, 5) - 1) * 2.2 + i * 4.4;
      return `<circle cx="${x}" cy="15" r="1.25" fill="#fff" opacity=".92"/>`;
    }).join('');
    const star = rank === 6 ? '<path d="M16 9l1.7 3.5 3.8.5-2.8 2.6.7 3.8L16 17.6 12.6 19.4l.7-3.8-2.8-2.6 3.8-.5z" fill="#fff"/>' : pips;
    return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="tc-${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
      <path d="M16 2l12 4v9c0 8-5.5 12.5-12 15C9.5 27.5 4 23 4 15V6l12-4z" fill="url(#tc-${key})" stroke="rgba(0,0,0,.45)" stroke-width="1"/>
      <path d="M16 5l9 3v7c0 6-4 9.5-9 11.6C11 24.5 7 21 7 15V8l9-3z" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".9"/>
      ${star}
    </svg>`;
  }

  window.Icons = { svg, el, hydrate, avatar, tierCrest };
  document.addEventListener('DOMContentLoaded', () => hydrate());
})();
