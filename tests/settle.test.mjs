import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createGame, apply, gameResults } = await import('../js/store.js');
const { results, transfers, countCheck, roundToTotal, tableTotals, potCents, POT, TIP } = await import('../js/settle.js');

const host = { pid: null, host: true };

function setup({ type = 'fixed', buyIn = 10000, chip = { cents: 100, chips: 5 }, pot = false } = {}) {
  const g = createGame({ name: 'Test', type, currency: 'ILS', buyIn, chip, pot, seats: 9, hostName: 'Yoni', hostPlaying: true });
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

test('seats cannot be double-booked; rejoining from the same device returns the same player', () => {
  const { g } = setup();
  const r1 = apply(g, 'join', { key: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', name: 'Avi' }, { pid: null, host: false });
  const r2 = apply(g, 'join', { key: 'a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', name: 'Dana' }, { pid: null, host: false });
  apply(g, 'sit', { pid: r1.pid, seat: 3 }, { pid: r1.pid, host: false });
  assert.throws(() => apply(g, 'sit', { pid: r2.pid, seat: 3 }, { pid: r2.pid, host: false }), /seatTaken/);
  assert.equal(apply(g, 'join', { key: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', name: 'Avi' }, { pid: null, host: false }).pid, r1.pid);
  // Only a hashed device key is accepted, never a raw id.
  assert.throws(() => apply(g, 'join', { key: 'raw-device-id', name: 'Ben' }, { pid: null, host: false }), /generic/);
});

const sumBy = (tx, id) => tx.reduce((s, x) => s + (x.to === id ? x.cents : 0) - (x.from === id ? x.cents : 0), 0);

test('pot game: everyone paid in cash, each takes their chips back out of the pot', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  apply(g, 'buyin', { pid: d, cents: 10000 }, host); // Dana rebuys, cash in the pot
  assert.equal(potCents(g), 40000);
  apply(g, 'end', { stacks: { [me]: 300, [a]: 1200, [d]: 500 } }, host);
  assert.equal(g.result.mode, 'pot');
  const res = results(g, g.result.stacks);
  const tx = transfers(g, res, 'pot');
  // Yoni gets 60 back, Avi 240, Dana 100: the pot ends empty.
  assert.deepEqual(
    tx.map((x) => [x.from, x.to, x.cents]),
    [
      [POT, a, 24000],
      [POT, d, 10000],
      [POT, me, 6000],
    ],
  );
  assert.equal(sumBy(tx, POT), -40000);
});

test('pot game with a buy-in on credit: that player pays it in or gets less', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  apply(g, 'buyin', { pid: d, cents: 10000, paid: false }, host); // Dana's rebuy is on credit
  const dana = g.players.find((p) => p.id === d);
  apply(g, 'paidBuyin', { pid: d, buyinId: dana.buyIns[0].id, value: false }, host); // and the first one too
  assert.equal(potCents(g), 20000);
  const res = results(g, { [me]: 300, [a]: 1200, [d]: 500 });
  const tx = transfers(g, res, 'pot');
  // Dana's chips are worth 100 but she owes 200: she puts 100 in.
  assert.deepEqual(tx.find((x) => x.from === d), { from: d, to: POT, cents: 10000 });
  assert.equal(tx.find((x) => x.to === a).cents, 24000);
  assert.equal(tx.find((x) => x.to === me).cents, 6000);
  assert.equal(sumBy(tx, POT), -20000);
  // Money goes in before it comes out.
  assert.equal(tx[0].to, POT);
});

test('pot game, player to player: the pot pays out first, then players settle', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  apply(g, 'buyin', { pid: me, cents: 10000 }, host);
  apply(g, 'buyin', { pid: a, cents: 10000 }, host);
  apply(g, 'buyin', { pid: d, cents: 20000, paid: false }, host);
  const res = results(g, { [me]: 300, [a]: 1200, [d]: 500 });
  const tx = transfers(g, res, 'fewest');
  for (const id of [me, a, d]) {
    const r = res.find((x) => x.id === id);
    const p = g.players.find((x) => x.id === id);
    const paid = p.buyIns.filter((b) => b.paid).reduce((s, b) => s + b.cents, 0);
    // Whatever they paid in, plus what they receive now, equals their result.
    assert.equal(sumBy(tx, id) - paid, r.net);
  }
  assert.equal(sumBy(tx, POT), -20000);
  assert.ok(tx.length <= 3);
});

test('pot game: leaving and taking cash from the pot early', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  apply(g, 'leave', { pid: d, chips: 700, settled: true }, host);
  const res = results(g, { [me]: 300, [a]: 500 });
  const tx = transfers(g, res, 'pot');
  assert.deepEqual(tx.filter((x) => x.early).map((x) => [x.from, x.to, x.cents]), [[POT, d, 14000]]);
  assert.deepEqual(
    tx.filter((x) => !x.early).map((x) => [x.from, x.to, x.cents]),
    [
      [POT, a, 10000],
      [POT, me, 6000],
    ],
  );
});

test('via the host: the host holds the pot', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  for (const id of [me, a, d]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  const res = results(g, { [me]: 500, [a]: 900, [d]: 100 });
  const tx = transfers(g, res, 'bank');
  assert.ok(tx.every((x) => x.from === me || x.to === me));
  assert.deepEqual(
    tx.map((x) => [x.to, x.cents]),
    [
      [a, 18000],
      [d, 2000],
    ],
  );
});

test('only the host can change whether a buy-in was paid', () => {
  const { g, add } = setup({ pot: true });
  const a = add('Avi');
  apply(g, 'buyin', { pid: a, cents: 10000 }, { pid: a, host: false });
  const b = g.players.find((p) => p.id === a).buyIns[0];
  assert.equal(b.paid, true);
  assert.throws(() => apply(g, 'paidBuyin', { pid: a, buyinId: b.id, value: false }, { pid: a, host: false }), /notAllowed/);
});

test('names are unique per game, and only the host can rename', () => {
  const { g, add } = setup();
  const a = add('Avi');
  assert.throws(() => apply(g, 'join', { key: 'a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9', name: ' avi ' }, { pid: null, host: false }), /nameTaken/);
  assert.throws(() => apply(g, 'addPlayer', { name: 'YONI' }, host), /nameTaken/);
  const { pid } = apply(g, 'join', { key: 'a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9', name: 'Dana' }, { pid: null, host: false });
  assert.throws(() => apply(g, 'rename', { pid, name: 'Dani' }, { pid, host: false }), /notAllowed/);
  assert.throws(() => apply(g, 'rename', { pid, name: 'Avi' }, host), /nameTaken/);
  apply(g, 'rename', { pid: a, name: 'AVI' }, host); // same player, new casing is fine
  apply(g, 'rename', { pid, name: 'Dani' }, host);
  assert.equal(g.players.find((p) => p.id === pid).name, 'Dani');
});

test('device keys are hashes, and codes and secrets have enough entropy', async () => {
  const { deviceKey, newCode, newSecret, isSecret, CODE_LENGTH } = await import('../js/store.js');
  const k = await deviceKey('abc');
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.notEqual(k, await deviceKey('abd'));
  assert.equal(newCode().length, CODE_LENGTH);
  const sec = newSecret();
  assert.ok(isSecret(sec) && sec.length === 22);
  assert.notEqual(sec, newSecret());
});

test('group tip: comes out of the winners by what they won, and the host sends it on', () => {
  const { g, add, me } = setup({ pot: true });
  const a = add('Avi');
  const d = add('Dana');
  const e = add('Eli');
  for (const id of [me, a, d, e]) apply(g, 'buyin', { pid: id, cents: 10000 }, host);
  // 400 in, 2% tip = 8. Avi is up 150, Eli up 50: they give 6 and 2.
  apply(g, 'end', { stacks: { [me]: 0, [a]: 1250, [d]: 0, [e]: 750 }, tipPct: 2 }, host);
  assert.equal(g.result.tipPct, 2);
  const res = gameResults(g);
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  assert.equal(by[a].net, 15000 - 600);
  assert.equal(by[e].net, 5000 - 200);
  assert.equal(by[me].net, -10000);
  assert.equal(by[d].net, -10000);
  assert.equal(res.reduce((s, r) => s + r.net, 0), -800);
  for (const mode of ['pot', 'fewest', 'bank']) {
    const tx = transfers(g, res, mode);
    assert.deepEqual(tx.at(-1), { from: me, to: TIP, cents: 800 }, mode);
    // Everyone ends square, the tip leaves through the host.
    // (In bank mode the host also holds the pot's cash, so skip them there.)
    for (const id of mode === 'bank' ? [a, d, e] : [me, a, d, e]) {
      const r = by[id];
      const p = g.players.find((x) => x.id === id);
      const paidIn = p.buyIns.reduce((s, b) => s + b.cents, 0);
      assert.equal(sumBy(tx, id) - paidIn, r.net, `${mode} ${r.name}`);
    }
  }
});

test('group tip: rounded up to a whole unit, never more than was won, ignored if not offered', () => {
  const { g, add, me } = setup({ buyIn: 3300 });
  const a = add('Avi');
  for (const id of [me, a]) apply(g, 'buyin', { pid: id, cents: 3300 }, host);
  // 66 in, 5% = 3.30, rounded up to 4. Avi only won 0.20.
  const res = results(g, { [me]: 164, [a]: 166 }, { tipPct: 5 });
  assert.equal(res.find((r) => r.id === a).tip, 20);
  apply(g, 'end', { stacks: { [me]: 165, [a]: 165 }, tipPct: 7 }, host);
  assert.equal(g.result.tipPct, 0);
});
