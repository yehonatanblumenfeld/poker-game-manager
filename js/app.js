import { t, initLang, setLang, lang, money, chips, duration, clock, date, currencySymbol } from './i18n.js';
import { esc, toast, sheet, closeSheet, floatLabel, ICONS } from './ui.js';
import { HostLink, PlayerLink } from './net.js';
import {
  createGame,
  rematch,
  apply,
  ActionError,
  storage,
  normalizeCode,
  cleanName,
  freeSeats,
  player,
  gameResults,
} from './store.js';
import { boughtCents, boughtChips, tableTotals, centsForChips, chipsForCents, countCheck, results, transfers, transferKey } from './settle.js';

const app = document.getElementById('app');
let session = null;
let currentView = () => {};

// ---------------- helpers ----------------

const m = (cents, g = session?.game, opts) => money(cents, g?.currency ?? 'ILS', opts);
const nameOf = (g, id) => player(g, id)?.name ?? '—';
const initials = (name) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();

// In a fixed game, "2 buy-ins" bought at once still counts as two.
function buyInCount(g, p) {
  return g.type === 'fixed' ? Math.round(boughtCents(p) / g.buyIn) : p.buyIns.length;
}

function parseMoney(s) {
  const v = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}

function parseNum(s) {
  if (String(s).trim() === '') return NaN;
  const v = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

function avatar(p, size = '') {
  return `<span class="avatar avatar--${p.color} ${size}" aria-hidden="true">${esc(initials(p.name))}</span>`;
}

function langButton() {
  return `<button class="lang-btn" data-act="lang" aria-label="${esc(t('lang.switchLabel'))}">${esc(t('lang.switch'))}</button>`;
}

function inviteUrl(code) {
  return `${location.origin}${location.pathname}${location.search}#/g/${code}`;
}

function haptic() {
  try {
    navigator.vibrate?.(8);
  } catch {}
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="lang"]')) {
    setLang(lang() === 'he' ? 'en' : 'he');
    closeSheet();
    currentView();
  }
});

// ---------------- router ----------------

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [view, arg] = hash.split('/');
  const code = normalizeCode(arg);
  if (session && !(view === 'g' && code === session.code)) {
    session.destroy();
    session = null;
  }
  closeSheet();
  window.scrollTo(0, 0);
  if (view === 'new') return show(viewNew);
  if (view === 'g' && code.length === 6) return show(() => viewGame(code));
  if (view === 'stats') return show(viewStats);
  return show(viewHome);
}

function show(fn) {
  currentView = fn;
  fn();
}

window.addEventListener('hashchange', route);

// ---------------- home ----------------

function viewHome() {
  const open = storage.openGames();
  app.innerHTML = `
  <main class="page page--home">
    <header class="topbar topbar--end">
      ${langButton()}
    </header>
    <section class="hero">
      ${heroArt()}
      <h1 class="wordmark">Felt</h1>
      <p class="hero__tag">${esc(t('app.tagline'))}</p>
    </section>
    <div class="stack stack--tight">
      <a class="btn btn--primary btn--lg" href="#/new">${esc(t('home.new'))}</a>
      <form class="join-form" data-form="join">
        <label class="sr-only" for="join-code">${esc(t('home.joinPlaceholder'))}</label>
        <input id="join-code" class="input input--code" name="code" placeholder="${esc(t('home.joinPlaceholder'))}"
          autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="7" dir="ltr" />
        <button class="btn" type="submit">${esc(t('home.joinGo'))}</button>
      </form>
    </div>
    ${
      open.length
        ? `<section class="section">
        <h2 class="eyebrow">${esc(t('home.active'))}</h2>
        <ul class="list">
          ${open
            .map(
              ({ role, game }) => `
            <li><a class="list-row" href="#/g/${game.code}">
              <span class="list-row__main">
                <span class="list-row__title">${esc(game.name)}</span>
                <span class="list-row__sub">${esc(role === 'host' ? t('home.hosting') : t('home.playing'))} · <span dir="ltr">${game.code}</span> · ${esc(clock(game.createdAt))}</span>
              </span>
              <span class="list-row__end">${m(tableTotals(game).cents, game)} ${ICONS.arrow}</span>
            </a></li>`,
            )
            .join('')}
        </ul>
      </section>`
        : `<p class="hint hint--center">${esc(t('home.empty'))}</p>`
    }
    <a class="link-row" href="#/stats">${esc(t('home.history'))} ${ICONS.arrow}</a>
  </main>`;

  app.querySelector('[data-form="join"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = e.target.code.value;
    // Accept a pasted invite link as well as a bare code.
    const fromLink = raw.match(/#\/g\/(\w+)/);
    const code = normalizeCode(fromLink ? fromLink[1] : raw);
    if (code.length === 6) location.hash = `#/g/${code}`;
    else e.target.code.focus();
  });
}

function heroArt() {
  // A short stack of chips, drawn rather than imported.
  const chip = (y, cls) => `
    <g transform="translate(0 ${y})" class="${cls}">
      <ellipse cx="60" cy="14" rx="44" ry="13" class="chip-side"/>
      <rect x="16" y="6" width="88" height="8" class="chip-side"/>
      <ellipse cx="60" cy="6" rx="44" ry="13" class="chip-top"/>
      <ellipse cx="60" cy="6" rx="30" ry="8.5" class="chip-inlay"/>
      <g class="chip-marks">
        <rect x="56" y="-7" width="8" height="4" rx="1"/><rect x="56" y="15" width="8" height="4" rx="1"/>
        <rect x="18" y="3" width="8" height="5" rx="1"/><rect x="94" y="3" width="8" height="5" rx="1"/>
      </g>
    </g>`;
  return `<svg class="hero__art" viewBox="0 0 120 70" aria-hidden="true">
    ${chip(46, 'c c--3')}${chip(34, 'c c--2')}${chip(22, 'c c--1')}${chip(10, 'c c--0')}
  </svg>`;
}

// ---------------- new game ----------------

function viewNew() {
  const last = storage.lastName();
  const f = {
    name: '',
    type: 'fixed',
    currency: 'ILS',
    buyIn: '100',
    chipMode: 'ratio',
    unit: '1',
    perUnit: '5',
    stack: '500',
    seats: 9,
    hostName: last,
    playing: true,
  };

  app.innerHTML = `
  <main class="page page--form">
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="${esc(t('new.back'))}">${ICONS.back}</a>
      <h1 class="topbar__title">${esc(t('new.title'))}</h1>
      ${langButton()}
    </header>
    <form class="form" data-form="new" novalidate>
      <label class="field">
        <span class="field__label">${esc(t('new.name'))}</span>
        <input class="input" name="name" placeholder="${esc(t('new.namePlaceholder'))}" maxlength="24" autocomplete="off" />
      </label>

      <fieldset class="field">
        <legend class="field__label">${esc(t('new.type'))}</legend>
        <div class="choice">
          <label class="choice__opt"><input type="radio" name="type" value="fixed" checked />
            <span><strong>${esc(t('new.fixed'))}</strong><small>${esc(t('new.fixedHint'))}</small></span></label>
          <label class="choice__opt"><input type="radio" name="type" value="cash" />
            <span><strong>${esc(t('new.cash'))}</strong><small>${esc(t('new.cashHint'))}</small></span></label>
        </div>
      </fieldset>

      <div class="field-row">
        <label class="field field--grow">
          <span class="field__label" data-buyin-label>${esc(t('new.buyIn'))}</span>
          <input class="input input--num" name="buyIn" inputmode="decimal" value="${f.buyIn}" dir="ltr" />
        </label>
        <label class="field">
          <span class="field__label">${esc(t('new.currency'))}</span>
          <select class="input" name="currency">
            ${['ILS', 'USD', 'EUR', 'GBP'].map((c) => `<option value="${c}" ${c === f.currency ? 'selected' : ''}>${esc(currencySymbol(c))} ${c}</option>`).join('')}
          </select>
        </label>
      </div>

      <fieldset class="field">
        <legend class="field__label">${esc(t('new.chips'))}</legend>
        <div class="seg" role="radiogroup">
          <label class="seg__opt"><input type="radio" name="chipMode" value="ratio" checked /><span>${esc(t('new.byRatio'))}</span></label>
          <label class="seg__opt"><input type="radio" name="chipMode" value="stack" /><span>${esc(t('new.byStack'))}</span></label>
        </div>
        <div class="ratio" data-mode="ratio">
          <input class="input input--num input--short" name="unit" inputmode="decimal" value="${f.unit}" dir="ltr" aria-label="Money" />
          <span class="ratio__sym" data-sym></span>
          <span class="ratio__eq">=</span>
          <input class="input input--num input--short" name="perUnit" inputmode="decimal" value="${f.perUnit}" dir="ltr" aria-label="Chips" />
          <span class="ratio__unit">${esc(t('new.chipsUnit'))}</span>
        </div>
        <div class="ratio" data-mode="stack" hidden>
          <span class="ratio__fixed" data-buyin-echo></span>
          <span class="ratio__eq">=</span>
          <input class="input input--num" name="stack" inputmode="numeric" value="${f.stack}" dir="ltr" aria-label="Chips" />
          <span class="ratio__unit">${esc(t('new.chipsUnit'))}</span>
        </div>
        <p class="preview" data-preview aria-live="polite"></p>
      </fieldset>

      <div class="field">
        <span class="field__label" id="seats-label">${esc(t('new.seats'))}</span>
        <div class="stepper" role="group" aria-labelledby="seats-label">
          <button type="button" class="icon-btn" data-step="-1" aria-label="−">${ICONS.minus}</button>
          <output name="seatsOut" class="stepper__value">${f.seats}</output>
          <button type="button" class="icon-btn" data-step="1" aria-label="+">${ICONS.plus}</button>
        </div>
      </div>

      <label class="field">
        <span class="field__label">${esc(t('new.you'))}</span>
        <input class="input" name="hostName" value="${esc(f.hostName)}" placeholder="${esc(t('new.youPlaceholder'))}" maxlength="24" autocomplete="nickname" />
      </label>
      <label class="switch">
        <input type="checkbox" name="playing" checked />
        <span class="switch__track" aria-hidden="true"></span>
        <span>${esc(t('new.playing'))}</span>
      </label>

      <div class="form__foot">
        <p class="form__error" data-error role="alert"></p>
        <button class="btn btn--primary btn--lg" type="submit">${esc(t('new.create'))}</button>
      </div>
    </form>
  </main>`;

  const form = app.querySelector('[data-form="new"]');
  const $ = (s) => form.querySelector(s);

  const read = () => {
    const fd = new FormData(form);
    const buyIn = parseMoney(fd.get('buyIn'));
    const mode = fd.get('chipMode');
    let chip;
    if (mode === 'ratio') chip = { cents: parseMoney(fd.get('unit')), chips: parseNum(fd.get('perUnit')) };
    else chip = { cents: buyIn, chips: parseNum(fd.get('stack')) };
    return {
      name: fd.get('name') || t('new.namePlaceholder'),
      type: fd.get('type'),
      currency: fd.get('currency'),
      buyIn,
      chip,
      mode,
      seats: f.seats,
      hostName: cleanName(fd.get('hostName')),
      hostPlaying: !!fd.get('playing'),
    };
  };

  const sync = () => {
    const v = read();
    const g = { currency: v.currency };
    $('[data-buyin-label]').textContent = t(v.type === 'cash' ? 'new.defaultBuyIn' : 'new.buyIn');
    $('[data-sym]').textContent = currencySymbol(v.currency);
    $('[data-buyin-echo]').textContent = v.buyIn > 0 ? m(v.buyIn, g) : '—';
    form.querySelectorAll('[data-mode]').forEach((el) => (el.hidden = el.dataset.mode !== v.mode));
    const ok = v.buyIn > 0 && v.chip.cents > 0 && v.chip.chips > 0;
    $('[data-preview]').textContent = ok
      ? t('new.preview', {
          money: m(v.buyIn, g),
          chips: chips(chipsForCents({ chip: v.chip }, v.buyIn)),
          each: money(v.chip.cents / v.chip.chips, v.currency).replace(/(\.\d{2})\d+/, '$1'),
        })
      : '';
    return { v, ok };
  };

  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  form.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (!step) return;
    f.seats = Math.min(10, Math.max(2, f.seats + Number(step.dataset.step)));
    form.seatsOut.value = f.seats;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { v, ok } = sync();
    if (!ok) {
      $('[data-error]').textContent = t('err.amount');
      return;
    }
    if (!v.hostName) {
      $('[data-error]').textContent = t('err.name');
      form.hostName.focus();
      return;
    }
    storage.setLastName(v.hostName);
    const game = createGame({ ...v, clientId: storage.clientId() });
    storage.saveHosted(game);
    location.hash = `#/g/${game.code}`;
  });
  sync();
}

// ---------------- game sessions ----------------

class HostSession {
  constructor(code) {
    this.role = 'host';
    this.code = code;
    this.game = storage.hostedGame(code);
    this.me = this.game.managerId;
    this.status = 'starting';
    this.seen = new Set();
    this.link = new HostLink(code, {
      onMessage: (msg, conn) => this.onMessage(msg, conn),
      onPresence: () => this.changed(null, { quiet: true }),
      onStatus: (s) => {
        this.status = s;
        renderStatus(this);
      },
    });
    this.wake();
    this.onVis = () => document.visibilityState === 'visible' && this.wake();
    document.addEventListener('visibilitychange', this.onVis);
  }

  online() {
    return new Set(this.link.online());
  }

  async wake() {
    if (this.game.status !== 'live' || !('wakeLock' in navigator)) return;
    try {
      this.lock = await navigator.wakeLock.request('screen');
    } catch {}
  }

  dispatch(type, payload) {
    try {
      const r = apply(this.game, type, payload, { pid: this.me, host: true });
      this.changed(r.entry, { mine: true });
      return Promise.resolve(r);
    } catch (e) {
      toast(t(`err.${e.code || 'generic'}`), { tone: 'error' });
      return Promise.reject(e);
    }
  }

  replaceGame(game) {
    this.game = game;
    this.changed(null, { mine: true });
  }

  onMessage(msg, conn) {
    if (msg.t === 'hello') {
      try {
        const { pid } = apply(this.game, 'join', { clientId: String(msg.clientId || ''), name: msg.name }, { pid: null, host: false });
        this.link.bind(conn, pid);
        this.link.send(conn, { t: 'welcome', pid });
        const last = this.game.log[this.game.log.length - 1];
        this.changed(last?.type === 'join' && last.pid === pid && !this.seen.has(last.id) ? last : null);
      } catch (e) {
        this.link.send(conn, { t: 'err', code: e.code || 'generic' });
      }
      return;
    }
    if (msg.t === 'act') {
      const pid = this.link.pidOf(conn);
      if (!pid) return;
      try {
        const r = apply(this.game, String(msg.type), { ...(msg.payload || {}) }, { pid, host: false });
        this.link.send(conn, { t: 'ok', rid: msg.rid });
        this.changed(r.entry);
      } catch (e) {
        this.link.send(conn, { t: 'err', rid: msg.rid, code: e instanceof ActionError ? e.code : 'generic' });
      }
    }
  }

  changed(entry, { mine = false, quiet = false } = {}) {
    storage.saveHosted(this.game);
    if (this.game.status === 'ended') storage.recordResult(this.game);
    this.link.broadcast({ t: 'state', game: this.game, online: this.link.online() });
    if (entry) {
      this.seen.add(entry.id);
      if (!mine) notify(this, [entry]);
    }
    if (!quiet || this.game) rerender(this, entry ? [entry] : []);
  }

  destroy() {
    this.link.close();
    this.lock?.release?.().catch(() => {});
    document.removeEventListener('visibilitychange', this.onVis);
    clearInterval(this.tick);
  }
}

class PlayerSession {
  constructor(code) {
    this.role = 'player';
    this.code = code;
    this.game = storage.snapshot(code);
    this.ident = storage.me(code);
    this.me = this.ident?.pid ?? null;
    this.status = 'connecting';
    this.onlineSet = new Set();
    if (this.ident) this.connect();
  }

  online() {
    return this.onlineSet;
  }

  connect() {
    this.link = new PlayerLink(this.code, {
      hello: () => ({ clientId: this.ident.clientId, name: this.ident.name }),
      onStatus: (s) => {
        this.status = s;
        renderStatus(this);
      },
      onMessage: (msg) => this.onMessage(msg),
    });
  }

  join(name) {
    this.ident = { clientId: storage.clientId(), name, pid: null };
    storage.saveMe(this.code, this.ident);
    storage.setLastName(name);
    this.connect();
    rerender(this, []);
  }

  onMessage(msg) {
    if (msg.t === 'welcome') {
      this.me = msg.pid;
      this.ident.pid = msg.pid;
      storage.saveMe(this.code, this.ident);
      return;
    }
    if (msg.t === 'err' && !msg.rid) {
      toast(t(`err.${msg.code || 'generic'}`), { tone: 'error' });
      return;
    }
    if (msg.t !== 'state' || !msg.game) return;
    const prev = this.game;
    const next = msg.game;
    let fresh = [];
    if (prev && prev.id !== next.id) {
      toast(t('toast.rematch'), { tone: 'good' });
    } else if (prev && this.primed) {
      const known = new Set(prev.log.map((e) => e.id));
      fresh = next.log.filter((e) => !known.has(e.id));
    }
    this.primed = true;
    this.game = next;
    this.onlineSet = new Set(msg.online || []);
    storage.saveSnapshot(next);
    if (next.status === 'ended') storage.recordResult(next);
    notify(this, fresh);
    rerender(this, fresh);
  }

  dispatch(type, payload) {
    if (!this.link) return Promise.reject(new Error('offline'));
    return this.link.request(type, payload).catch((e) => {
      toast(t(`err.${e.code || 'generic'}`), { tone: 'error' });
      throw e;
    });
  }

  destroy() {
    this.link?.close();
    clearInterval(this.tick);
  }
}

function notify(s, entries) {
  for (const e of entries) {
    if (e.quiet) continue;
    const actorIsMe = (e.by ?? e.pid) === s.me;
    if (actorIsMe && e.type !== 'end') continue;
    const name = nameOf(s.game, e.pid);
    const map = {
      join: ['toast.join', 'info'],
      buyin: ['toast.buyin', 'info'],
      leave: ['toast.leave', 'info'],
      return: ['toast.return', 'info'],
      end: ['toast.end', 'good'],
      reopen: ['toast.reopen', 'info'],
      undo: ['toast.undo', 'info'],
    }[e.type];
    if (!map) continue;
    if (e.type === 'end' && s.role === 'host') continue;
    toast(t(map[0], { name, money: m(e.cents ?? 0, s.game) }), { tone: map[1], icon: e.type === 'buyin' ? ICONS.chip : '' });
  }
}

function viewGame(code) {
  if (!session) {
    if (storage.isHost(code)) {
      if (!storage.hostedGame(code)) return renderMissing();
      session = new HostSession(code);
    } else {
      session = new PlayerSession(code);
    }
    session.tick = setInterval(() => updateClocks(), 30000);
  }
  rerender(session, []);
}

function renderMissing() {
  app.innerHTML = `<main class="page page--center">
    <p class="hint hint--center">${esc(t('game.notFound'))}</p>
    <a class="btn" href="#/">${esc(t('game.goHome'))}</a></main>`;
}

let renderedSeats = new Map(); // pid -> seat index, to animate only new arrivals

function rerender(s, fresh) {
  if (s !== session) return;
  if (s.role === 'player' && !s.ident) return renderJoin(s);
  if (!s.game) return renderConnecting(s);
  if (s.game.status === 'ended') renderResults(s);
  else renderTable(s);
  s.sheetRefresh?.();
  for (const e of fresh) {
    if (e.type === 'buyin') {
      floatLabel(app.querySelector(`[data-seat-pid="${e.pid}"]`), `+${m(e.cents, s.game)}`);
    }
  }
}

function renderJoin(s) {
  app.innerHTML = `
  <main class="page page--form">
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="${esc(t('new.back'))}">${ICONS.back}</a>
      <h1 class="topbar__title">${esc(t('join.title'))}</h1>
      ${langButton()}
    </header>
    <form class="form form--join" data-form="name">
      <p class="eyebrow">${esc(t('join.code', { code: s.code }))}</p>
      <label class="field">
        <span class="field__label">${esc(t('join.name'))}</span>
        <input class="input input--lg" name="name" value="${esc(storage.lastName())}" maxlength="24" autocomplete="nickname" autofocus required />
      </label>
      <p class="form__error" data-error role="alert"></p>
      <button class="btn btn--primary btn--lg" type="submit">${esc(t('join.go'))}</button>
    </form>
  </main>`;
  app.querySelector('[data-form="name"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanName(e.target.name.value);
    if (!name) {
      app.querySelector('[data-error]').textContent = t('err.name');
      return;
    }
    s.join(name);
  });
}

function renderConnecting(s) {
  app.innerHTML = `
  <main class="page page--center">
    <div class="loader" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="hint hint--center" data-status-text>${esc(statusText(s))}</p>
    <a class="btn btn--ghost" href="#/">${esc(t('game.goHome'))}</a>
  </main>`;
}

function statusText(s) {
  if (s.role === 'host') return t({ live: 'conn.hostLive', starting: 'conn.hostStarting', offline: 'conn.hostOffline', otherTab: 'conn.otherTab' }[s.status] || 'conn.hostStarting');
  return t({ connecting: 'conn.connecting', online: 'conn.online', offline: 'conn.offline', noHost: 'conn.noHost' }[s.status] || 'conn.connecting');
}

function statusTone(s) {
  if (s.status === 'live' || s.status === 'online') return 'ok';
  if (s.status === 'starting' || s.status === 'connecting') return 'wait';
  return 'bad';
}

// Connection changes only touch the status line, never the whole page.
function renderStatus(s) {
  if (s !== session) return;
  const dot = app.querySelector('[data-status-dot]');
  if (dot) dot.dataset.tone = statusTone(s);
  app.querySelectorAll('[data-status-text]').forEach((el) => (el.textContent = statusText(s)));
  const banner = app.querySelector('[data-conn-banner]');
  if (banner) {
    const bad = statusTone(s) === 'bad' || (s.role === 'player' && s.status !== 'online');
    banner.hidden = !bad;
    banner.querySelector('span').textContent = statusText(s);
  }
}

function updateClocks() {
  if (!session?.game) return;
  app.querySelectorAll('[data-elapsed]').forEach((el) => {
    el.textContent = t('game.elapsed', { time: duration(Date.now() - session.game.createdAt) });
  });
}

function gameHeader(s, sub) {
  return `
  <header class="gbar">
    <a class="icon-btn" href="#/" aria-label="${esc(t('game.goHome'))}">${ICONS.back}</a>
    <div class="gbar__title">
      <h1>${esc(s.game.name)}</h1>
      <p><span class="dot" data-status-dot data-tone="${statusTone(s)}"></span>${sub}</p>
    </div>
    ${langButton()}
  </header>
  <div class="banner banner--warn" data-conn-banner ${statusTone(s) === 'bad' || (s.role === 'player' && s.status !== 'online') ? '' : 'hidden'}><span>${esc(statusText(s))}</span></div>`;
}

// ---------------- live table ----------------

function seatPosition(display, n) {
  // Seats sit on the rail: the rail is inset 11% / 8% inside the table box.
  const angle = Math.PI / 2 + (display * 2 * Math.PI) / n;
  return { x: 50 + 39 * Math.cos(angle), y: 50 + 42 * Math.sin(angle) };
}

function renderTable(s) {
  const g = s.game;
  const me = player(g, s.me);
  const online = s.online();
  const totals = tableTotals(g);
  const isHost = s.role === 'host';
  const canAct = isHost || s.status === 'online';
  const seated = new Map(g.players.filter((p) => p.status === 'playing' && p.seat !== null).map((p) => [p.seat, p]));
  const rotate = me?.seat ?? 0;

  const seats = [];
  for (let i = 0; i < g.seats; i++) {
    const p = seated.get(i);
    const { x, y } = seatPosition((i - rotate + g.seats) % g.seats, g.seats);
    const style = `style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"`;
    if (p) {
      const isNew = renderedSeats.size && renderedSeats.get(p.id) !== i;
      const off = !isHost && p.id !== g.managerId && !online.has(p.id) && p.clientId;
      const offHost = isHost && p.clientId && p.id !== g.managerId && !online.has(p.id);
      seats.push(`
        <button class="seat ${p.id === s.me ? 'seat--me' : ''} ${isNew ? 'seat--new' : ''} ${off || offHost ? 'seat--off' : ''}" ${style}
          data-act="player" data-pid="${p.id}" data-seat-pid="${p.id}" aria-label="${esc(p.name)}">
          ${avatar(p)}
          <span class="seat__name"><bdi>${esc(p.name)}</bdi></span>
          ${p.buyIns.length ? `<span class="seat__amt">${m(boughtCents(p), g)}</span>` : ''}
        </button>`);
    } else {
      const canSit = (s.role === 'player' && me && me.status === 'playing' && canAct) || isHost;
      seats.push(`
        <button class="seat seat--empty" ${style} data-act="empty" data-seat="${i}" ${canSit ? '' : 'disabled'} aria-label="${esc(t('player.seat'))} ${i + 1}">
          <span class="avatar avatar--empty" aria-hidden="true">${canSit ? ICONS.plus : ''}</span>
        </button>`);
    }
  }
  renderedSeats = new Map([...seated].map(([i, p]) => [p.id, i]));

  const activePlayers = g.players.filter((p) => p.playing || p.buyIns.length);
  const roster = [...activePlayers].sort((a, b) => (a.status === 'left') - (b.status === 'left') || (a.seat ?? 99) - (b.seat ?? 99));
  const needSeat = s.role === 'player' && me && me.status === 'playing' && me.seat === null;
  const showTip = isHost && !storage.tipSeen('keepOpen');

  app.innerHTML = `
  <main class="page page--game">
    ${gameHeader(s, `<span data-status-text>${esc(statusText(s))}</span> · <span dir="ltr">${g.code}</span> · <span data-elapsed>${esc(t('game.elapsed', { time: duration(Date.now() - g.createdAt) }))}</span>`)}
    ${
      showTip
        ? `<div class="banner banner--tip"><span>${esc(t('game.keepOpen'))}</span><button class="btn btn--sm btn--ghost" data-act="tip">${esc(t('game.gotIt'))}</button></div>`
        : ''
    }
    ${needSeat ? `<div class="banner banner--accent"><span>${esc(t('game.pickSeat'))}</span></div>` : ''}

    <section class="table-wrap" aria-label="${esc(t('game.players'))}">
      <div class="table ${g.seats > 8 ? 'table--crowded' : ''}">
        <div class="table__rail"><div class="table__felt">
          <div class="pot">
            <span class="pot__label">${esc(t('game.pot'))}</span>
            <strong class="pot__value">${m(totals.cents, g)}</strong>
            <span class="pot__chips">${esc(t('game.chipsInPlay', { chips: chips(totals.onTable) }))}</span>
          </div>
        </div></div>
        ${seats.join('')}
      </div>
    </section>

    ${me && !isHost ? meCard(s, me) : ''}
    ${isHost && me?.playing ? meCard(s, me) : ''}

    <section class="section">
      <div class="section__head">
        <h2 class="eyebrow">${esc(t('game.players'))} · ${activePlayers.filter((p) => p.status === 'playing').length}</h2>
        <div class="section__tools">
          <button class="btn btn--sm btn--ghost" data-act="log">${ICONS.list}<span>${esc(t('game.log'))}</span></button>
          ${isHost ? `<button class="btn btn--sm btn--ghost" data-act="add">${ICONS.user}<span>${esc(t('game.addPlayer'))}</span></button>` : ''}
        </div>
      </div>
      <ul class="list">
        ${roster.map((p) => rosterRow(s, p, online)).join('')}
      </ul>
    </section>

    <div class="dock">
      ${
        isHost
          ? `
        <button class="btn btn--dock" data-act="invite">${ICONS.qr}<span>${esc(t('game.invite'))}</span></button>
        ${me?.playing && me.status === 'playing' ? `<button class="btn btn--dock btn--primary" data-act="buyin" data-pid="${me.id}">${ICONS.plus}<span>${esc(t('game.buyIn'))}</span></button>` : ''}
        <button class="btn btn--dock btn--danger-soft" data-act="end">${ICONS.flag}<span>${esc(t('game.end'))}</span></button>`
          : me
            ? me.status === 'playing'
              ? `
        <button class="btn btn--dock btn--primary" data-act="buyin" data-pid="${me.id}" ${canAct ? '' : 'disabled'}>${ICONS.plus}<span>${esc(me.buyIns.length ? t('game.addBuyIn') : t('game.buyIn'))}</span></button>
        <button class="btn btn--dock" data-act="leave" data-pid="${me.id}" ${canAct ? '' : 'disabled'}>${ICONS.door}<span>${esc(t('game.leave'))}</span></button>`
              : `<button class="btn btn--dock" data-act="return" data-pid="${me.id}" ${canAct ? '' : 'disabled'}><span>${esc(t('game.return'))}</span></button>`
            : ''
      }
    </div>
  </main>`;

  bindGame(s);
}

function meCard(s, me) {
  const g = s.game;
  if (me.status === 'left') {
    const net = Math.round(centsForChips(g, me.leftChips) - boughtCents(me));
    return `
    <section class="me me--left">
      ${avatar(me, 'avatar--lg')}
      <div class="me__main">
        <p class="me__big ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${esc(net > 0 ? t('you.up', { money: m(net, g) }) : net < 0 ? t('you.down', { money: m(-net, g) }) : t('you.even'))}</p>
        <p class="me__sub">${esc(t('you.leftWith', { chips: chips(me.leftChips) }))}</p>
        <p class="me__sub">${esc(me.settledOnLeave ? t('you.settledEarly') : t('you.finalAtEnd'))}</p>
      </div>
    </section>`;
  }
  return `
  <section class="me">
    ${avatar(me, 'avatar--lg')}
    <div class="me__main">
      <p class="me__label">${esc(t('game.you'))}${me.seat !== null ? ` · ${esc(t('player.seat'))} ${me.seat + 1}` : ''}</p>
      <p class="me__big">${me.buyIns.length ? m(boughtCents(me), g) : esc(t('game.noBuyIns'))}</p>
      ${me.buyIns.length ? `<p class="me__sub">${esc(t('game.buyIns', { n: buyInCount(g, me) }))} · ${esc(t('common.chips', { chips: chips(boughtChips(me)) }))}</p>` : ''}
    </div>
  </section>`;
}

function rosterRow(s, p, online) {
  const g = s.game;
  const tags = [];
  if (p.id === s.me) tags.push(t('game.you'));
  if (p.id === g.managerId) tags.push(t('game.host'));
  if (p.status === 'left') tags.push(t('game.left'));
  else if (p.clientId && p.id !== g.managerId && !online.has(p.id) && (s.role === 'host' || s.status === 'online')) tags.push(t('game.offline'));
  if (p.status === 'playing' && p.seat === null) tags.push(t('game.rail'));
  return `
  <li><button class="list-row ${p.status === 'left' ? 'is-left' : ''}" data-act="player" data-pid="${p.id}">
    ${avatar(p)}
    <span class="list-row__main">
      <span class="list-row__title"><bdi>${esc(p.name)}</bdi></span>
      ${tags.length ? `<span class="list-row__sub">${tags.map(esc).join(' · ')}</span>` : ''}
    </span>
    <span class="list-row__end">
      ${p.buyIns.length ? `<span class="tally">${esc(t('game.buyIns', { n: buyInCount(g, p) }))}</span>` : ''}
      <strong>${p.buyIns.length ? m(boughtCents(p), g) : '—'}</strong>
    </span>
  </button></li>`;
}

function bindGame(s) {
  app.querySelector('.page').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const pid = el.dataset.pid;
    switch (el.dataset.act) {
      case 'player':
        return openPlayer(s, pid);
      case 'empty':
        return onEmptySeat(s, Number(el.dataset.seat));
      case 'buyin':
        return openBuyIn(s, pid);
      case 'leave':
        return openLeave(s, pid);
      case 'return':
        return s.dispatch('return', { pid });
      case 'invite':
        return openInvite(s);
      case 'end':
        return openEnd(s);
      case 'log':
        return openLog(s);
      case 'add':
        return openAddPlayer(s, null);
      case 'tip':
        storage.markTip('keepOpen');
        return el.closest('.banner').remove();
      case 'mode':
        return s.dispatch('settleMode', { mode: el.dataset.mode });
      case 'paid':
        return s.dispatch('paid', { key: el.dataset.key, value: el.getAttribute('aria-pressed') !== 'true' });
      case 'share':
        return shareResults(s);
      case 'reopen':
        return s.dispatch('reopen', {});
      case 'rematch': {
        const next = rematch(s.game);
        s.replaceGame(next);
        toast(t('toast.rematch'), { tone: 'good' });
        return;
      }
    }
  });
}

function onEmptySeat(s, seat) {
  if (s.role === 'player') {
    haptic();
    return s.dispatch('sit', { pid: s.me, seat });
  }
  openAddPlayer(s, seat);
}

// ---------------- sheets ----------------

function withRefresh(s, fn) {
  // Re-render an open sheet when the game changes underneath it.
  s.sheetRefresh = fn;
  return () => {
    if (s.sheetRefresh === fn) s.sheetRefresh = null;
  };
}

function openPlayer(s, pid) {
  const isHost = s.role === 'host';
  const self = pid === s.me;
  const p0 = player(s.game, pid);
  if (!p0) return;
  let body;
  const draw = () => {
    const g = s.game;
    const p = player(g, pid);
    if (!p) return closeSheet();
    const canEdit = isHost || self;
    const free = freeSeats(g);
    body.innerHTML = `
      <div class="pcard">
        ${avatar(p, 'avatar--lg')}
        <div>
          <p class="pcard__name"><bdi>${esc(p.name)}</bdi></p>
          <p class="pcard__sub">${esc(t('player.bought'))}: <strong>${p.buyIns.length ? m(boughtCents(p), g) : '—'}</strong>${p.buyIns.length ? ` · ${esc(t('common.chips', { chips: chips(boughtChips(p)) }))}` : ''}</p>
          ${p.status === 'left' ? `<p class="pcard__sub">${esc(t('player.leftWith', { chips: chips(p.leftChips) }))}</p>` : ''}
        </div>
      </div>

      ${
        p.buyIns.length
          ? `<h3 class="eyebrow">${esc(t('player.history'))}</h3>
        <ul class="mini-list">
          ${p.buyIns
            .slice()
            .reverse()
            .map(
              (b) => `<li>
            <span class="mini-list__time">${esc(clock(b.at))}</span>
            <span class="mini-list__main">${m(b.cents, g)} · ${esc(t('common.chips', { chips: chips(b.chips) }))}</span>
            ${isHost ? `<button class="btn btn--sm btn--ghost" data-undo="${b.id}">${esc(t('player.undo'))}</button>` : ''}
          </li>`,
            )
            .join('')}
        </ul>`
          : ''
      }

      ${
        canEdit
          ? `
      <div class="sheet__actions">
        ${
          p.status === 'playing'
            ? `<button class="btn btn--primary" data-do="buyin">${ICONS.plus}<span>${esc(t('game.addBuyIn'))}</span></button>
               <button class="btn" data-do="leave">${ICONS.door}<span>${esc(t('game.leave'))}</span></button>`
            : `<button class="btn" data-do="return">${esc(t('game.return'))}</button>`
        }
      </div>
      ${
        isHost && p.status === 'left' && p.id !== g.managerId
          ? `<label class="switch"><input type="checkbox" data-do="settled" ${p.settledOnLeave ? 'checked' : ''}/><span class="switch__track" aria-hidden="true"></span><span>${esc(t('leave.settleNow'))}</span></label>`
          : ''
      }
      ${
        isHost && p.status === 'playing'
          ? `<label class="field field--inline"><span class="field__label">${esc(t('player.seat'))}</span>
          <select class="input" data-do="seat">
            <option value="">${esc(t('player.noSeat'))}</option>
            ${[...new Set([...(p.seat !== null ? [p.seat] : []), ...free])]
              .sort((a, b) => a - b)
              .map((i) => `<option value="${i}" ${i === p.seat ? 'selected' : ''}>${i + 1}</option>`)
              .join('')}
          </select></label>`
          : ''
      }
      <form class="field-row" data-do="rename">
        <label class="field field--grow"><span class="field__label">${esc(t('player.rename'))}</span>
          <input class="input" name="name" value="${esc(p.name)}" maxlength="24" /></label>
        <button class="btn btn--sm field-row__btn" type="submit">${esc(t('player.save'))}</button>
      </form>
      ${isHost && p.id !== g.managerId && !p.buyIns.length ? `<button class="btn btn--ghost btn--danger-text" data-do="remove">${esc(t('player.remove'))}</button>` : ''}
      `
          : ''
      }`;
  };
  const unhook = withRefresh(s, () => body && draw());
  sheet({
    title: p0.name,
    onClose: unhook,
    render: (b, close) => {
      body = b;
      draw();
      b.addEventListener('click', (e) => {
        const undo = e.target.closest('[data-undo]');
        if (undo) return s.dispatch('undoBuyin', { pid, buyinId: undo.dataset.undo }).then(() => toast(t('player.undone')));
        const act = e.target.closest('[data-do]')?.dataset.do;
        if (act === 'buyin') return openBuyIn(s, pid);
        if (act === 'leave') return openLeave(s, pid);
        if (act === 'return') return s.dispatch('return', { pid }).then(() => close());
        if (act === 'remove') return s.dispatch('remove', { pid }).then(() => close());
      });
      b.addEventListener('change', (e) => {
        const act = e.target.dataset.do;
        if (act === 'settled') s.dispatch('settleLeave', { pid, value: e.target.checked });
        if (act === 'seat') s.dispatch('setSeat', { pid, seat: e.target.value === '' ? null : Number(e.target.value) });
      });
      b.addEventListener('submit', (e) => {
        e.preventDefault();
        s.dispatch('rename', { pid, name: e.target.name.value }).catch(() => {});
      });
    },
  });
}

function openBuyIn(s, pid) {
  const g = s.game;
  const p = player(g, pid);
  if (!p) return;
  const fixed = g.type === 'fixed';
  let count = 1;
  sheet({
    title: pid === s.me ? t('buyin.title') : t('buyin.titleFor', { name: p.name }),
    render: (b, close) => {
      b.innerHTML = fixed
        ? `
        <p class="hint">${esc(t('buyin.fixedEach', { money: m(g.buyIn, g), chips: chips(chipsForCents(g, g.buyIn)) }))}</p>
        <div class="stepper stepper--lg" role="group" aria-label="${esc(t('buyin.count'))}">
          <button type="button" class="icon-btn" data-step="-1" aria-label="−">${ICONS.minus}</button>
          <output class="stepper__value" data-count>1×</output>
          <button type="button" class="icon-btn" data-step="1" aria-label="+">${ICONS.plus}</button>
        </div>
        <p class="preview preview--center" data-gets></p>
        <button class="btn btn--primary btn--lg" data-confirm></button>`
        : `
        <label class="field">
          <span class="field__label">${esc(t('buyin.amount'))} (${esc(currencySymbol(g.currency))})</span>
          <input class="input input--lg input--num" name="amount" inputmode="decimal" value="${g.buyIn / 100}" dir="ltr" autofocus />
        </label>
        <div class="quick">
          ${[0.5, 1, 2]
            .map((k) => Math.round(g.buyIn * k))
            .map((c) => `<button type="button" class="chip-btn" data-quick="${c}">${m(c, g)}</button>`)
            .join('')}
        </div>
        <p class="preview" data-gets></p>
        <button class="btn btn--primary btn--lg" data-confirm></button>`;
      const cents = () => (fixed ? count * g.buyIn : parseMoney(b.querySelector('[name="amount"]').value));
      const sync = () => {
        const c = cents();
        const ok = c > 0;
        if (fixed) b.querySelector('[data-count]').textContent = `${count}×`;
        b.querySelector('[data-gets]').textContent = ok ? t('buyin.gets', { chips: chips(chipsForCents(g, c)) }) : '';
        const btn = b.querySelector('[data-confirm]');
        btn.textContent = ok ? t('buyin.confirm', { money: m(c, g) }) : t('err.amount');
        btn.disabled = !ok;
      };
      b.addEventListener('input', sync);
      b.addEventListener('click', (e) => {
        const step = e.target.closest('[data-step]');
        if (step) {
          count = Math.min(10, Math.max(1, count + Number(step.dataset.step)));
          sync();
        }
        const q = e.target.closest('[data-quick]');
        if (q) {
          b.querySelector('[name="amount"]').value = Number(q.dataset.quick) / 100;
          sync();
        }
        const go = e.target.closest('[data-confirm]');
        if (go && !go.disabled) {
          go.disabled = true;
          haptic();
          s.dispatch('buyin', { pid, cents: cents() })
            .then(() => close())
            .catch(() => (go.disabled = false));
        }
      });
      sync();
    },
  });
}

function openLeave(s, pid) {
  const g = s.game;
  const p = player(g, pid);
  if (!p) return;
  const isHost = s.role === 'host';
  sheet({
    title: pid === s.me ? t('leave.title') : t('leave.titleFor', { name: p.name }),
    render: (b, close) => {
      b.innerHTML = `
        <label class="field">
          <span class="field__label">${esc(pid === s.me ? t('leave.count') : t('leave.countFor', { name: p.name }))}</span>
          <input class="input input--lg input--num" name="chips" inputmode="decimal" dir="ltr" autofocus placeholder="0" />
        </label>
        <div class="leave-sum" data-sum aria-live="polite"></div>
        ${
          isHost && pid !== g.managerId
            ? `<label class="switch"><input type="checkbox" name="settled"/><span class="switch__track" aria-hidden="true"></span>
               <span>${esc(t('leave.settleNow'))}<small>${esc(t('leave.settleNowHint'))}</small></span></label>`
            : ''
        }
        <button class="btn btn--primary btn--lg" data-confirm disabled>${esc(t('leave.confirm'))}</button>`;
      const input = b.querySelector('[name="chips"]');
      const sync = () => {
        const c = parseNum(input.value);
        const ok = c >= 0;
        b.querySelector('[data-confirm]').disabled = !ok;
        if (!ok) return (b.querySelector('[data-sum]').innerHTML = '');
        const worth = Math.round(centsForChips(g, c));
        const net = worth - boughtCents(p);
        b.querySelector('[data-sum]').innerHTML = `
          <span>${esc(t('leave.worth', { money: m(worth, g) }))}</span>
          <strong class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${m(net, g, { sign: true })}</strong>`;
      };
      input.addEventListener('input', sync);
      b.querySelector('[data-confirm]').addEventListener('click', (e) => {
        e.currentTarget.disabled = true;
        const settled = b.querySelector('[name="settled"]')?.checked;
        s.dispatch('leave', { pid, chips: parseNum(input.value), settled })
          .then(() => closeSheet())
          .catch(() => sync());
      });
    },
  });
}

function openInvite(s) {
  const url = inviteUrl(s.code);
  sheet({
    title: t('invite.title'),
    render: (b) => {
      let svg = '';
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch {}
      b.innerHTML = `
        <div class="invite">
          <div class="invite__qr">${svg}</div>
          <p class="invite__code" dir="ltr">${s.code.split('').map((c) => `<span>${c}</span>`).join('')}</p>
          <p class="hint hint--center">${esc(t('invite.scan'))}</p>
          <div class="sheet__actions">
            <button class="btn" data-copy>${ICONS.copy}<span>${esc(t('invite.copy'))}</span></button>
            ${navigator.share ? `<button class="btn btn--primary" data-share>${ICONS.share}<span>${esc(t('invite.share'))}</span></button>` : ''}
          </div>
        </div>`;
      b.querySelector('[data-copy]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast(t('invite.copied'), { tone: 'good' });
        } catch {
          prompt('', url);
        }
      });
      b.querySelector('[data-share]')?.addEventListener('click', () => {
        navigator.share({ title: 'Felt', text: t('invite.shareText', { name: s.game.name }), url }).catch(() => {});
      });
    },
  });
}

function openAddPlayer(s, seat) {
  const g = s.game;
  sheet({
    title: seat === null ? t('game.addPlayer') : `${t('player.seat')} ${seat + 1}`,
    render: (b, close) => {
      const movable = seat === null ? [] : g.players.filter((p) => p.status === 'playing' && p.playing !== false && p.seat !== seat);
      const hostCanSit = seat !== null && !player(g, g.managerId).playing;
      b.innerHTML = `
        ${
          movable.length || hostCanSit
            ? `<ul class="list list--compact">
          ${movable
            .map(
              (p) => `<li><button class="list-row" data-move="${p.id}">${avatar(p)}
            <span class="list-row__main"><span class="list-row__title"><bdi>${esc(p.name)}</bdi></span>
            <span class="list-row__sub">${p.seat === null ? esc(t('game.rail')) : `${esc(t('player.seat'))} ${p.seat + 1}`}</span></span>${ICONS.arrow}</button></li>`,
            )
            .join('')}
          ${hostCanSit ? `<li><button class="list-row" data-move="${g.managerId}">${avatar(player(g, g.managerId))}<span class="list-row__main"><span class="list-row__title"><bdi>${esc(player(g, g.managerId).name)}</bdi></span><span class="list-row__sub">${esc(t('new.playing'))}</span></span>${ICONS.arrow}</button></li>` : ''}
        </ul>`
            : ''
        }
        <form class="field-row" data-add>
          <label class="field field--grow"><span class="field__label">${esc(t('game.addPlayer'))}</span>
            <input class="input" name="name" placeholder="${esc(t('player.namePlaceholder'))}" maxlength="24" autocomplete="off" autofocus /></label>
          <button class="btn btn--primary field-row__btn" type="submit">${esc(t('player.add'))}</button>
        </form>`;
      b.addEventListener('click', (e) => {
        const mv = e.target.closest('[data-move]');
        if (mv) s.dispatch('setSeat', { pid: mv.dataset.move, seat }).then(() => close());
      });
      b.querySelector('[data-add]').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = cleanName(e.target.name.value);
        if (!name) return e.target.name.focus();
        s.dispatch('addPlayer', { name }).then(() => {
          const added = s.game.players[s.game.players.length - 1];
          if (seat !== null && added.seat !== seat) s.dispatch('setSeat', { pid: added.id, seat });
          close();
        });
      });
    },
  });
}

function openLog(s) {
  let body;
  const draw = () => {
    const g = s.game;
    const rows = g.log
      .slice()
      .reverse()
      .map((e) => {
        const name = e.name ?? nameOf(g, e.pid);
        const key = { created: 'log.created', join: 'log.join', sit: 'log.sit', buyin: 'log.buyin', undo: 'log.undo', leave: 'log.leave', return: 'log.return', rename: 'log.rename', remove: 'log.remove', end: 'log.end', reopen: 'log.reopen' }[e.type];
        if (!key) return '';
        return `<li><span class="mini-list__time">${esc(clock(e.at))}</span><span class="mini-list__main">${esc(t(key, { name, old: e.old ?? '', money: m(e.cents ?? 0, g), chips: chips(e.chips ?? 0) }))}</span></li>`;
      })
      .join('');
    body.innerHTML = rows ? `<ul class="mini-list mini-list--log">${rows}</ul>` : `<p class="hint">${esc(t('log.empty'))}</p>`;
  };
  const unhook = withRefresh(s, () => body && draw());
  sheet({
    title: t('log.title'),
    onClose: unhook,
    render: (b) => {
      body = b;
      draw();
    },
  });
}

function openEnd(s) {
  const g = s.game;
  const counting = g.players.filter((p) => p.status === 'playing' && (p.playing || p.buyIns.length));
  const gone = g.players.filter((p) => p.status === 'left');
  const stacks = {};
  sheet({
    title: t('end.title'),
    className: 'sheet--tall',
    render: (b) => {
      b.innerHTML = `
        <p class="hint">${esc(t('end.intro'))}</p>
        <ul class="count-list">
          ${counting
            .map(
              (p) => `<li>
            ${avatar(p)}
            <label class="count-list__name" for="stack-${p.id}"><bdi>${esc(p.name)}</bdi><small>${p.buyIns.length ? m(boughtCents(p), g) : '—'}</small></label>
            <span class="count-list__net" data-net="${p.id}"></span>
            <input id="stack-${p.id}" class="input input--num input--count" data-stack="${p.id}" inputmode="decimal" placeholder="0" dir="ltr" />
          </li>`,
            )
            .join('')}
          ${gone
            .map(
              (p) => `<li class="is-left">
            ${avatar(p)}
            <span class="count-list__name"><bdi>${esc(p.name)}</bdi><small>${esc(t('end.leftAlready'))}</small></span>
            <span class="count-list__net"></span>
            <span class="count-list__fixed" dir="ltr">${chips(p.leftChips)}</span>
          </li>`,
            )
            .join('')}
        </ul>
        <div class="tally-bar" data-tally aria-live="polite"></div>
        <label class="switch" data-adjust-wrap hidden><input type="checkbox" name="adjust"/><span class="switch__track" aria-hidden="true"></span>
          <span>${esc(t('end.adjust'))}<small>${esc(t('end.adjustHint'))}</small></span></label>
        <button class="btn btn--primary btn--lg" data-confirm>${esc(t('end.confirm'))}</button>`;

      const sync = () => {
        b.querySelectorAll('[data-stack]').forEach((inp) => {
          const v = parseNum(inp.value);
          stacks[inp.dataset.stack] = v >= 0 ? v : 0;
        });
        const adjust = b.querySelector('[name="adjust"]').checked;
        const check = countCheck(g, stacks);
        const res = results(g, stacks, { adjust });
        for (const r of res) {
          const el = b.querySelector(`[data-net="${r.id}"]`);
          if (el) {
            el.textContent = m(r.net, g, { sign: true });
            el.className = `count-list__net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`;
          }
        }
        const diff = Math.round(check.diff * 100) / 100;
        b.querySelector('[data-tally]').innerHTML = `
          <span>${esc(t('end.expected'))} <strong dir="ltr">${chips(check.expected)}</strong></span>
          <span>${esc(t('end.counted'))} <strong dir="ltr">${chips(check.counted)}</strong></span>
          <span class="tally-bar__state ${diff === 0 ? 'pos' : 'neg'}">${esc(diff === 0 ? t('end.matches') : diff > 0 ? t('end.diffOver', { chips: chips(diff) }) : t('end.diffUnder', { chips: chips(-diff) }))}</span>`;
        b.querySelector('[data-adjust-wrap]').hidden = diff === 0;
        const ok = diff === 0 || (adjust && check.counted > 0);
        const btn = b.querySelector('[data-confirm]');
        btn.disabled = !ok;
        btn.title = ok ? '' : t('end.fixFirst');
      };
      b.addEventListener('input', sync);
      b.addEventListener('change', sync);
      b.querySelector('[data-confirm]').addEventListener('click', (e) => {
        if (e.currentTarget.disabled) return;
        sync();
        s.dispatch('end', { stacks: { ...stacks }, adjust: b.querySelector('[name="adjust"]').checked }).then(() => closeSheet());
      });
      sync();
    },
  });
}

// ---------------- results ----------------

function renderResults(s) {
  const g = s.game;
  const res = gameResults(g).sort((a, b) => b.net - a.net);
  const mode = g.result.mode;
  const list = transfers(g, res, mode);
  const isHost = s.role === 'host';
  const me = s.me;
  const myNet = res.find((r) => r.id === me)?.net;
  const mine = list.filter((x) => x.from === me || x.to === me);
  // The reveal plays once, not on every paid-tick re-render.
  const reveal = s.revealed !== g.id;
  s.revealed = g.id;

  app.innerHTML = `
  <main class="page page--game page--results">
    ${gameHeader(s, `<span>${esc(t('res.duration', { time: duration((g.endedAt ?? Date.now()) - g.createdAt) }))}</span> · <span>${esc(date(g.createdAt))}</span>`)}

    ${
      myNet !== undefined
        ? `<section class="verdict ${myNet > 0 ? 'verdict--up' : myNet < 0 ? 'verdict--down' : ''}">
        <p class="verdict__big">${myNet > 0 ? esc(t('you.up', { money: m(myNet, g) })) : myNet < 0 ? esc(t('you.down', { money: m(-myNet, g) })) : esc(t('you.even'))}</p>
        <ul class="verdict__list">
          ${
            mine.length
              ? mine
                  .map((x) =>
                    x.early && x.from !== g.managerId && x.to !== g.managerId
                      ? ''
                      : `<li>${esc(x.from === me ? t('you.pay', { name: nameOf(g, x.to), money: m(x.cents, g) }) : t('you.get', { name: nameOf(g, x.from), money: m(x.cents, g) }))}${x.early ? ` <small>(${esc(t('res.early'))})</small>` : ''}${g.result.paid[transferKey(x)] ? ` <span class="badge">${esc(t('res.paid'))}</span>` : ''}</li>`,
                  )
                  .join('')
              : `<li>${esc(t('you.nothing'))}</li>`
          }
        </ul>
      </section>`
        : ''
    }

    <section class="section">
      <h2 class="eyebrow">${esc(t('res.title'))}</h2>
      <ol class="results ${reveal ? 'results--reveal' : ''}">
        ${res
          .map(
            (r, i) => `<li class="results__row" style="--i:${i}">
          ${avatar(player(g, r.id))}
          <span class="results__main">
            <span class="results__name"><bdi>${esc(r.name)}</bdi>${r.id === me ? ` <small>· ${esc(t('game.you'))}</small>` : ''}</span>
            <span class="results__sub">${esc(t('res.bought', { money: m(r.bought, g) }))} · ${esc(t('res.out', { money: m(r.cashOut, g) }))} · ${esc(t('common.chips', { chips: chips(r.chips) }))}</span>
          </span>
          <strong class="results__net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${m(r.net, g, { sign: true })}</strong>
        </li>`,
          )
          .join('')}
      </ol>
      ${g.result.adjust ? `<p class="hint">${esc(t('res.adjusted'))}</p>` : ''}
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="eyebrow">${esc(t('res.payments'))}</h2>
        ${
          isHost
            ? `<div class="seg seg--sm" role="group">
          <button class="seg__btn" data-act="mode" data-mode="fewest" aria-pressed="${mode === 'fewest'}">${esc(t('res.fewest'))}</button>
          <button class="seg__btn" data-act="mode" data-mode="bank" aria-pressed="${mode === 'bank'}">${esc(t('res.bank'))}</button>
        </div>`
            : `<span class="hint">${esc(t(mode === 'bank' ? 'res.bank' : 'res.fewest'))}</span>`
        }
      </div>
      ${
        list.length
          ? `<ul class="payments">
        ${list
          .map((x) => {
            const key = transferKey(x);
            const paid = !!g.result.paid[key] || x.early;
            return `<li class="payment ${paid ? 'is-paid' : ''} ${x.from === me || x.to === me ? 'is-mine' : ''}">
            <span class="payment__who"><bdi>${esc(nameOf(g, x.from))}</bdi> <span class="payment__arrow">${ICONS.arrow}</span> <bdi>${esc(nameOf(g, x.to))}</bdi>
              ${x.early ? `<small>${esc(t('res.early'))}</small>` : ''}</span>
            <strong class="payment__amt">${m(x.cents, g)}</strong>
            ${
              x.early
                ? `<span class="check is-on" aria-label="${esc(t('res.paid'))}">${ICONS.check}</span>`
                : isHost
                  ? `<button class="check ${paid ? 'is-on' : ''}" data-act="paid" data-key="${key}" aria-pressed="${paid}" aria-label="${esc(t('res.paid'))}">${ICONS.check}</button>`
                  : paid
                    ? `<span class="check is-on" aria-label="${esc(t('res.paid'))}">${ICONS.check}</span>`
                    : ''
            }
          </li>`;
          })
          .join('')}
      </ul>`
          : `<p class="hint">${esc(t('res.allSquare'))}</p>`
      }
    </section>

    <div class="stack stack--tight section">
      <button class="btn btn--primary btn--lg" data-act="share">${ICONS.share}<span>${esc(t('res.share'))}</span></button>
      ${
        isHost
          ? `<button class="btn btn--lg" data-act="rematch">${esc(t('res.rematch'))}</button>
             <p class="hint hint--center">${esc(t('res.rematchHint'))}</p>
             <button class="btn btn--ghost" data-act="reopen">${esc(t('res.reopen'))}</button>`
          : ''
      }
    </div>
  </main>`;
  bindGame(s);
}

async function shareResults(s) {
  const g = s.game;
  const res = gameResults(g).sort((a, b) => b.net - a.net);
  const list = transfers(g, res, g.result.mode);
  const lines = [
    `${g.name} · ${date(g.createdAt)}`,
    '',
    ...res.map((r) => `${r.name}: ${m(r.net, g, { sign: true })}`),
    '',
    `${t('res.payments')}:`,
    ...(list.length ? list.map((x) => `${nameOf(g, x.from)} → ${nameOf(g, x.to)}: ${m(x.cents, g)}${x.early ? ` (${t('res.early')})` : ''}`) : [t('res.allSquare')]),
  ];
  const text = lines.join('\n');
  if (navigator.share) {
    try {
      await navigator.share({ title: g.name, text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('res.copied'), { tone: 'good' });
  } catch {
    prompt('', text);
  }
}

// ---------------- stats ----------------

function viewStats() {
  const hist = storage.history();
  const byCurrency = new Map();
  for (const h of hist) {
    if (!byCurrency.has(h.currency)) byCurrency.set(h.currency, new Map());
    const board = byCurrency.get(h.currency);
    for (const r of h.rows) {
      const key = r.name.trim().toLowerCase();
      const row = board.get(key) ?? { name: r.name, net: 0, games: 0, best: -Infinity };
      row.net += r.net;
      row.games += 1;
      row.best = Math.max(row.best, r.net);
      board.set(key, row);
    }
  }
  app.innerHTML = `
  <main class="page page--form">
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="${esc(t('new.back'))}">${ICONS.back}</a>
      <h1 class="topbar__title">${esc(t('stats.title'))}</h1>
      ${langButton()}
    </header>
    ${
      hist.length
        ? [...byCurrency]
            .map(
              ([cur, board]) => `
      <section class="section">
        <h2 class="eyebrow">${esc(t('stats.leaderboard'))}${byCurrency.size > 1 ? ` · ${cur}` : ''}</h2>
        <ol class="results">
          ${[...board.values()]
            .sort((a, b) => b.net - a.net)
            .map(
              (r, i) => `<li class="results__row" style="--i:${i}">
            <span class="rank">${i + 1}</span>
            <span class="results__main"><span class="results__name"><bdi>${esc(r.name)}</bdi></span>
            <span class="results__sub">${esc(r.games === 1 ? t('stats.game1') : t('stats.games', { n: r.games }))}</span></span>
            <strong class="results__net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${money(r.net, cur, { sign: true })}</strong>
          </li>`,
            )
            .join('')}
        </ol>
      </section>`,
            )
            .join('') +
          `<section class="section"><h2 class="eyebrow">${esc(t('stats.title'))}</h2><ul class="list">
          ${hist
            .map((h) => {
              const top = [...h.rows].sort((a, b) => b.net - a.net)[0];
              const pot = h.rows.reduce((sum, r) => sum + r.bought, 0);
              return `<li class="list-row list-row--static">
              <span class="list-row__main"><span class="list-row__title">${esc(h.name)}</span>
              <span class="list-row__sub">${esc(date(h.startedAt))} · ${money(pot, h.currency)}${top && top.net > 0 ? ` · <bdi>${esc(top.name)}</bdi> ${money(top.net, h.currency, { sign: true })}` : ''}</span></span>
              <button class="btn btn--sm btn--ghost" data-del="${h.id}">${esc(t('stats.delete'))}</button></li>`;
            })
            .join('')}</ul></section>`
        : `<p class="hint hint--center">${esc(t('stats.none'))}</p>`
    }
  </main>`;
  app.querySelector('.page').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del && confirm(t('stats.clearConfirm'))) {
      storage.deleteHistory(del.dataset.del);
      viewStats();
    }
  });
}

// ---------------- boot ----------------

initLang();
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
