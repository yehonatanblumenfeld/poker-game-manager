// Small UI primitives: escaping, toasts and bottom sheets.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Run `fn` after the browser has painted the element's starting state, so a
// CSS transition has something to transition from.
function nextFrame(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

// ---------------- toasts ----------------

const TOAST_MS = 3800;
let toastRoot;

export function toast(message, { tone = 'info', icon = '' } = {}) {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.append(toastRoot);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.dataset.state = 'enter';
  el.innerHTML = `${icon ? `<span class="toast__icon" aria-hidden="true">${icon}</span>` : ''}<span class="toast__text">${esc(message)}</span>`;
  toastRoot.prepend(el);
  nextFrame(() => (el.dataset.state = 'shown'));

  // Keep at most three on screen; the oldest leaves first.
  const live = [...toastRoot.querySelectorAll('.toast:not([data-state="exit"])')];
  live.slice(3).forEach(dismiss);

  // The timer pauses while the tab is hidden so nothing is missed.
  let remaining = TOAST_MS;
  let started = Date.now();
  let timer = setTimeout(() => dismiss(el), remaining);
  const onVis = () => {
    if (document.hidden) {
      clearTimeout(timer);
      remaining -= Date.now() - started;
    } else {
      started = Date.now();
      timer = setTimeout(() => dismiss(el), Math.max(800, remaining));
    }
  };
  document.addEventListener('visibilitychange', onVis);
  el.addEventListener('click', () => dismiss(el));
  el._cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
}

function dismiss(el) {
  if (el.dataset.state === 'exit') return;
  el._cleanup?.();
  el.dataset.state = 'exit';
  const done = () => el.remove();
  if (reduceMotion()) setTimeout(done, 160);
  else el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 600);
}

// ---------------- sheets ----------------

let openSheet = null;

// Opens a bottom sheet. `render(body, close)` fills it; returns `close`.
export function sheet({ title, render, onClose, className = '' }) {
  if (openSheet) openSheet.close(true);

  const root = document.createElement('div');
  root.className = 'sheet-layer';
  root.dataset.state = 'enter';
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet__grip" aria-hidden="true"></div>
      <header class="sheet__head">
        <h2 class="sheet__title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="sheet__body"></div>
    </section>`;
  document.body.append(root);
  const panel = root.querySelector('.sheet');
  const body = root.querySelector('.sheet__body');
  const restoreFocus = document.activeElement;

  let closed = false;
  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    if (openSheet?.root === root) openSheet = null;
    document.removeEventListener('keydown', onKey);
    root.dataset.state = 'exit';
    panel.style.transform = '';
    const done = () => root.remove();
    if (instant || reduceMotion()) done();
    else {
      panel.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 500);
    }
    document.body.classList.remove('has-sheet');
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus({ preventScroll: true });
    onClose?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  dragToDismiss(panel, [root.querySelector('.sheet__grip'), root.querySelector('.sheet__head')], close);

  openSheet = { root, close };
  document.body.classList.add('has-sheet');
  render(body, close);
  nextFrame(() => {
    root.dataset.state = 'open';
    const first = body.querySelector('[autofocus]');
    if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  });
  return close;
}

export function closeSheet() {
  openSheet?.close();
}

// Drag the sheet's handle area down to dismiss. A quick flick is enough;
// dragging upward meets increasing resistance instead of a hard stop.
function dragToDismiss(panel, handles, close) {
  let startY = 0;
  let startT = 0;
  let dy = 0;
  let pointerId = null;

  const down = (e) => {
    if (pointerId !== null || e.target.closest('button')) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    startT = performance.now();
    dy = 0;
    e.currentTarget.setPointerCapture(pointerId);
    panel.style.transition = 'none';
  };
  const move = (e) => {
    if (e.pointerId !== pointerId) return;
    const raw = e.clientY - startY;
    dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2;
    panel.style.transform = `translateY(${dy}px)`;
  };
  const up = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    panel.style.transition = '';
    const velocity = dy / Math.max(1, performance.now() - startT);
    if (dy > panel.offsetHeight * 0.3 || (dy > 12 && velocity > 0.11)) {
      close();
    } else {
      panel.style.transform = '';
    }
  };
  for (const h of handles) {
    h.addEventListener('pointerdown', down);
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }
}

// ---------------- motion helpers ----------------

// A small "+₪100" that rises off a seat when someone buys in.
export function floatLabel(anchor, text) {
  if (!anchor || reduceMotion()) return;
  const el = document.createElement('span');
  el.className = 'float-label';
  el.textContent = text;
  anchor.append(el);
  const anim = el.animate(
    [
      { transform: 'translate(-50%, 0)', opacity: 0 },
      { transform: 'translate(-50%, -14px)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -30px)', opacity: 0 },
    ],
    { duration: 1400, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
  anim.onfinish = () => el.remove();
}

export const ICONS = {
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1" fill="currentColor"/></svg>',
  back: '<svg class="flip-rtl" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  arrow: '<svg class="flip-rtl" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" stroke-linecap="round"/></svg>',
  door: '<svg class="flip-rtl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4H6a1 1 0 00-1 1v14a1 1 0 001 1h8"/><path d="M11 12h9M17 9l3 3-3 3"/></svg>',
  qr: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" stroke-linecap="round"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};
