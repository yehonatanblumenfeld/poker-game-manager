import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createGame, apply } = await import('../js/store.js');
const { results, transfers, countCheck, roundToTotal, tableTotals } = await import('../js/settle.js');

const host = { pid: null, host: true };

function setup({ type = 'fixed', buyIn = 10000, chip = { cents: 100, chips: 5 } } = {}) {
  const g = createGame({ name: 'Test', type, currency: 'ILS', buyIn, chip, seats: 9, hostName: 'Yoni', hostPlaying: true, clientId: 'c0' });
  host.pid = g.managerId;
  const add = (name) => {
    apply(g, 'addPlayer', { name }, host);
    return g.players[g.players.length - 1].id;
  };
  return { g, add, me: g.managerId };
}

test('100 for 500 chips: winners and losers net to zero', () => {
  const { g, add, me } = setup();
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  apply(g, 'buyin', { pid: d, cents: 10000 }, host); // Dana rebuys
  assert.equal(tableTotals(g).cents, 40000);
  assert.equal(tableTotals(g).chips, 2000);

  const stacks = { [me]: 300, [a]: 1200, [d]: 500 };
  assert.equal(countCheck(g, stacks).diff, 0);
  const res = results(g, stacks);
  const net = Object.fromEntries(res.map((r) => [r.name, r.net]));
  assert.deepEqual(net, { Yoni: -4000, Avi: 14000, Dana: -10000 });
  assert.equal(res.reduce((s, r) => s + r.net, 0), 0);

  const tx = transfers(g, res, 'fewest');
  assert.equal(tx.length, 2);
  assert.deepEqual(
    tx.map((x) => [x.from, x.to, x.cents]),
    [
      [d, a, 10000],
      [me, a, 4000],
    ],
  );
});

test('bank mode routes everything through the host', () => {
  const { g, add, me } = setup();
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  const res = results(g, { [me]: 500, [a]: 900, [d]: 100 });
  const tx = transfers(g, res, 'bank');
  assert.ok(tx.every((x) => x.from === me || x.to === me));
  assert.equal(tx.find((x) => x.to === me).cents, 8000);
  assert.equal(tx.find((x) => x.from === me).cents, 8000);
});

test('a player who left keeps their reported stack, and early settlement moves to the host', () => {
  const { g, add, me } = setup();
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  apply(g, 'leave', { pid: d, chips: 700, settled: true }, host); // Dana up 40
  assert.equal(tableTotals(g).onTable, 800);
  const stacks = { [me]: 300, [a]: 500 };
  const res = results(g, stacks);
  assert.equal(res.find((r) => r.id === d).net, 4000);
  const tx = transfers(g, res, 'fewest');
  const early = tx.filter((x) => x.early);
  assert.deepEqual(early.map((x) => [x.from, x.to, x.cents]), [[me, d, 4000]]);
  // Host now owes 40 (own loss) + 40 (paid Dana) and everyone else squares up.
  const rest = tx.filter((x) => !x.early);
  assert.deepEqual(rest, []);
});

test('miscounted chips can be spread proportionally', () => {
  const { g, add, me } = setup();
  const a = add('Avi');
  for (const id of [me, a]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  const stacks = { [me]: 330, [a]: 770 }; // 100 too many
  assert.equal(countCheck(g, stacks).diff, 100);
  const res = results(g, stacks, { adjust: true });
  assert.equal(res.reduce((s, r) => s + r.net, 0), 0);
  assert.equal(res.find((r) => r.id === me).net, -4000);
  assert.equal(res.find((r) => r.id === a).net, 4000);
});

test('odd chip values round to the cent and still balance', () => {
  const { g, add, me } = setup({ type: 'cash', buyIn: 5000, chip: { cents: 10000, chips: 300 } });
  const a = add('Avi');
  const b = add('Ben');
  apply(g, 'buyin', { pid: me, cents: 5000 }, host);
  apply(g, 'buyin', { pid: a, cents: 7300 }, host);
  apply(g, 'buyin', { pid: b, cents: 2000 }, host);
  const total = tableTotals(g).chips; // 429
  const stacks = { [me]: 101, [a]: 211, [b]: total - 312 };
  const res = results(g, stacks);
  assert.equal(res.reduce((s, r) => s + r.net, 0), 0);
  for (const r of res) assert.ok(Number.isInteger(r.net));
});

test('roundToTotal keeps the sum exact', () => {
  assert.deepEqual(roundToTotal([33.3333, 33.3333, -66.6666], 0).reduce((a, b) => a + b, 0), 0);
});

test('players can only act for themselves; host-only actions are guarded', () => {
  const { g, add } = setup();
  const a = add('Avi');
  const d = add('Dana');
  assert.throws(() => apply(g, 'buyin', { pid: d, cents: 10000 }, { pid: a, host: false }), /notAllowed/);
  assert.throws(() => apply(g, 'end', { stacks: {} }, { pid: a, host: false }), /notAllowed/);
  assert.throws(() => apply(g, 'buyin', { pid: a, cents: 5000 }, { pid: a, host: false }), /amount/); // not a multiple of the fixed buy-in
  apply(g, 'buyin', { pid: a, cents: 20000 }, { pid: a, host: false });
  assert.equal(g.players.find((p) => p.id === a).buyIns.length, 1);
});

test('seats cannot be double-booked; rejoining by clientId returns the same player', () => {
  const { g } = setup();
  const r1 = apply(g, 'join', { clientId: 'x1', name: 'Avi' }, { pid: null, host: false });
  const r2 = apply(g, 'join', { clientId: 'x2', name: 'Dana' }, { pid: null, host: false });
  apply(g, 'sit', { pid: r1.pid, seat: 3 }, { pid: r1.pid, host: false });
  assert.throws(() => apply(g, 'sit', { pid: r2.pid, seat: 3 }, { pid: r2.pid, host: false }), /seatTaken/);
  assert.equal(apply(g, 'join', { clientId: 'x1', name: 'Avi' }, { pid: null, host: false }).pid, r1.pid);
});
