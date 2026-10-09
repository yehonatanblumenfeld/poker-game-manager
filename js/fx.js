// Game feedback: chips flying into the pot, the pot counting up, a ripple
// when someone sits down, and short sounds for what happens at the table.
// Sounds are synthesized with Web Audio (no files to download), quiet, and
// can be switched off; motion respects the reduced-motion setting.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
const SOUND_KEY = 'felt:sound';

// ---------------- sound ----------------

let ctx = null;
let master = null;

function soundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled() {
  return soundOn();
}

export function setSound(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {}
  if (on) {
    unlock();
    play('tick');
  }
}

// Browsers only allow audio after the person has touched the page.
function unlock() {
  if (!soundOn()) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
addEventListener('pointerdown', unlock, { passive: true });
addEventListener('keydown', unlock);

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// One clay chip landing on another: a short bright click with a body.
function clack(at, pitch = 1, level = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3400 * pitch;
  band.Q.value = 5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.55 * level, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  src.connect(band).connect(g).connect(master);
  src.start(at);
  src.stop(at + 0.06);

  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(2100 * pitch, at);
  body.frequency.exponentialRampToValueAtTime(1500 * pitch, at + 0.06);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, at);
  bg.gain.exponentialRampToValueAtTime(0.12 * level, at + 0.003);
  bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
  body.connect(bg).connect(master);
  body.start(at);
  body.stop(at + 0.09);
}

// A soft bell-like note.
function note(at, freq, { dur = 0.35, level = 0.12, type = 'triangle' } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

const SOUNDS = {
  // A small stack of chips: three clacks, each a little different.
  buyin(t) {
    clack(t, 1, 1);
    clack(t + 0.07, 0.94, 0.8);
    clack(t + 0.13, 1.06, 0.65);
  },
  join(t) {
    note(t, 659.25);
    note(t + 0.09, 880, { dur: 0.45 });
  },
  return(t) {
    note(t, 659.25, { dur: 0.25 });
    note(t + 0.07, 987.77, { dur: 0.35, level: 0.1 });
  },
  leave(t) {
    note(t, 880, { dur: 0.25, level: 0.09 });
    note(t + 0.1, 587.33, { dur: 0.45, level: 0.09 });
  },
  // The game is over: a short rising chord, then chips raked in.
  end(t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(t + i * 0.08, f, { dur: 0.9, level: 0.1 }));
    for (let i = 0; i < 5; i++) clack(t + 0.42 + i * 0.05, 0.9 + Math.random() * 0.2, 0.6);
  },
  tick(t) {
    clack(t, 1.15, 0.6);
  },
  error(t) {
    note(t, 196, { dur: 0.18, level: 0.12, type: 'sine' });
    note(t + 0.09, 164.81, { dur: 0.22, level: 0.1, type: 'sine' });
  },
};

let lastPlay = 0;
export function play(name) {
  if (!soundOn() || !ctx || ctx.state !== 'running' || !SOUNDS[name] || document.hidden) return;
  // Several moves at once (a queue arriving) make one sound, not a pile-up.
  const now = ctx.currentTime;
  if (now - lastPlay < 0.12) return;
  lastPlay = now;
  SOUNDS[name](now + 0.01);
}

function buzz(ms) {
  if (soundOn()) navigator.vibrate?.(ms);
}

// ---------------- motion ----------------

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// A few chips in the player's colour arc from their seat into the pot.
function chipsToPot(from, pot, color) {
  if (!from || !pot) return 0;
  const a = center(from);
  // They land on the felt next to the amount (above it from the far side of
  // the table, below it from the near side), never on top of it.
  const r = pot.getBoundingClientRect();
  const above = a.y < r.top + r.height / 2;
  const b = { x: r.left + r.width / 2, y: above ? r.top - 14 : r.bottom + 16 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A small arc, kept on the chips' side of the amount the whole way.
  const lift = Math.min(70, Math.hypot(dx, dy) * 0.3);
  const midY = above ? Math.min(a.y + dy * 0.5 - lift, r.top - 6) : Math.max(a.y + dy * 0.5 - lift, r.bottom + 6);
  const mx = dx * 0.45;
  const my = midY - a.y;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const chip = document.createElement('span');
    chip.className = `fly-chip avatar avatar--${color}`;
    chip.setAttribute('aria-hidden', 'true');
    chip.style.left = `${a.x}px`;
    chip.style.top = `${a.y}px`;
    document.body.append(chip);
    const jitter = (i - 1) * 7;
    const anim = chip.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.9)', opacity: 0 },
        { transform: `translate(calc(-50% + ${mx + jitter}px), calc(-50% + ${my}px)) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx + jitter}px), calc(-50% + ${dy + i * -3}px)) scale(0.85)`, opacity: 1 },
      ],
      { duration: 560, delay: i * 70, easing: EASE_IN_OUT, fill: 'backwards' },
    );
    anim.oncancel = () => chip.remove();
    // A moment on the felt, then they're part of the pot.
    anim.onfinish = () => {
      const out = chip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 160, easing: 'ease', fill: 'forwards' });
      out.onfinish = out.oncancel = () => chip.remove();
    };
  }
  return 560 + (n - 1) * 70;
}

// The pot rolls from its old amount to the new one when the chips land.
function countUp(el, from, to, format, delay) {
  if (!el || from === to) return;
  el.textContent = format(from);
  const start = performance.now() + delay;
  const dur = 420;
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, Math.max(0, (now - start) / dur));
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
    else el.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE_OUT });
  };
  requestAnimationFrame(step);
}

// A ring spreading from a seat: someone just sat down or came back.
function ripple(el) {
  if (!el) return;
  const ring = document.createElement('span');
  ring.className = 'seat-ripple';
  ring.setAttribute('aria-hidden', 'true');
  el.append(ring);
  const anim = ring.animate(
    [
      { transform: 'scale(0.95)', opacity: 0.55 },
      { transform: 'scale(1.7)', opacity: 0 },
    ],
    { duration: 700, easing: EASE_OUT },
  );
  anim.onfinish = () => ring.remove();
}

// Chips raining down the results when the game ends. Rare, so it can delight.
export function chipShower(colors) {
  if (reduceMotion() || !colors.length) return;
  const w = innerWidth;
  for (let i = 0; i < 16; i++) {
    const chip = document.createElement('span');
    chip.className = `fly-chip avatar avatar--${colors[i % colors.length]}`;
    chip.setAttribute('aria-hidden', 'true');
    chip.style.left = `${Math.random() * w}px`;
    chip.style.top = '-30px';
    document.body.append(chip);
    const fall = innerHeight * (0.55 + Math.random() * 0.4);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
    const drift = (Math.random() - 0.5) * 80;
    const anim = chip.animate(
      [
        { transform: 'translate(-50%, 0) rotateX(0deg) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${drift}px), ${fall}px) rotateX(${spin}deg) rotate(${spin / 3}deg)`, opacity: 0 },
      ],
      // Falling speeds up, like anything dropped.
      { duration: 1100 + Math.random() * 700, delay: Math.random() * 350, easing: 'cubic-bezier(0.5, 0, 0.75, 0.6)', fill: 'backwards' },
    );
    anim.onfinish = () => chip.remove();
  }
}

// Called after the table is drawn with the moves that just happened.
// `game` is the new state; `format(cents)` writes money the way the app does.
export function playMoves(root, game, entries, format) {
  const motion = !reduceMotion();
  const buyins = entries.filter((e) => e.type === 'buyin');
  if (buyins.length) {
    play('buyin');
    buzz(12);
    const potEl = root.querySelector('.pot__value');
    let landed = 0;
    if (motion) {
      for (const e of buyins.slice(0, 3)) {
        const p = game.players.find((x) => x.id === e.pid);
        // Their seat, or their row in the list if they aren't seated.
        const seat = root.querySelector(`[data-seat-pid="${e.pid}"] .avatar`) || root.querySelector(`[data-pid="${e.pid}"] .avatar`);
        landed = Math.max(landed, chipsToPot(seat, root.querySelector('.pot') || potEl, p?.color || 'gold'));
      }
      const added = buyins.reduce((n, e) => n + (e.cents || 0), 0);
      const now = Number(potEl?.dataset.cents);
      if (potEl && Number.isFinite(now)) countUp(potEl, now - added, now, format, Math.max(0, landed - 120));
    }
  }
  for (const e of entries) {
    if (e.type === 'join') {
      if (!e.quiet) play('join');
      if (motion) ripple(root.querySelector(`[data-seat-pid="${e.pid}"]`));
    } else if (e.type === 'sit') {
      if (motion) ripple(root.querySelector(`[data-seat-pid="${e.pid}"]`));
    } else if (e.type === 'return') {
      play('return');
      if (motion) ripple(root.querySelector(`[data-seat-pid="${e.pid}"]`));
    } else if (e.type === 'leave') {
      play('leave');
      const av = root.querySelector(`[data-seat-pid="${e.pid}"] .avatar`);
      if (motion && av) av.animate([{ filter: 'none' }, { filter: getComputedStyle(av).filter }], { duration: 500, easing: 'ease' });
    } else if (e.type === 'end') {
      play('end');
      buzz([12, 60, 18]);
    }
  }
}
