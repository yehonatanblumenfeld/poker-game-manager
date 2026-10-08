// Pure game math. No DOM, no storage: everything here is unit-tested in tests/.
// Money is always integer cents. Chips can be fractional only after a
// proportional adjustment at the end of a game.

export function chipsForCents(game, cents) {
  return (cents * game.chip.chips) / game.chip.cents;
}

export function centsForChips(game, chips) {
  return (chips * game.chip.cents) / game.chip.chips;
}

export function boughtCents(player) {
  return player.buyIns.reduce((sum, b) => sum + b.cents, 0);
}

export function boughtChips(player) {
  return player.buyIns.reduce((sum, b) => sum + b.chips, 0);
}

export function tableTotals(game) {
  let cents = 0;
  let chips = 0;
  let left = 0;
  for (const p of game.players) {
    cents += boughtCents(p);
    chips += boughtChips(p);
    if (p.status === 'left') left += p.leftChips ?? 0;
  }
  // Chips that walked out with players who left are no longer on the table.
  return { cents, chips, onTable: chips - left };
}

// Round float cents to integers so the total stays exactly `target`
// (largest-remainder method). Keeps the books balanced to the cent.
export function roundToTotal(values, target = 0) {
  const floors = values.map(Math.floor);
  let missing = target - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  for (let k = 0; k < order.length && missing > 0; k++, missing--) out[order[k].i] += 1;
  return out;
}

// stacks: { playerId: chips } for everyone still at the table at the end.
// Players who left use the stack they reported when they left.
export function finalStacks(game, stacks) {
  const out = {};
  for (const p of game.players) {
    const chips = p.status === 'left' ? p.leftChips ?? 0 : Number(stacks[p.id] ?? 0);
    // Someone who never bought in and holds nothing has no result to show.
    if (!p.buyIns.length && !(chips > 0)) continue;
    out[p.id] = chips;
  }
  return out;
}

export function countCheck(game, stacks) {
  const expected = tableTotals(game).chips;
  const counted = Object.values(finalStacks(game, stacks)).reduce((a, b) => a + b, 0);
  return { expected, counted, diff: counted - expected };
}

// Per-player results. With `adjust`, stacks still on the table are scaled so the
// counted total matches the chips that were bought (players who already left
// keep what they reported, since they've been told their number).
export function results(game, stacks, { adjust = false } = {}) {
  const fs = finalStacks(game, stacks);
  const ids = Object.keys(fs);
  if (adjust) {
    const { diff } = countCheck(game, stacks);
    const live = ids.filter((id) => game.players.find((p) => p.id === id).status !== 'left');
    const liveTotal = live.reduce((s, id) => s + fs[id], 0);
    if (diff !== 0 && liveTotal > 0) {
      const factor = (liveTotal - diff) / liveTotal;
      for (const id of live) fs[id] = fs[id] * factor;
    }
  }
  const raw = ids.map((id) => {
    const p = game.players.find((x) => x.id === id);
    return centsForChips(game, fs[id]) - boughtCents(p);
  });
  const balanced = Math.abs(countCheck(game, stacks).diff) < 1e-9 || adjust;
  const target = balanced ? 0 : Math.round(raw.reduce((a, b) => a + b, 0));
  const nets = roundToTotal(raw, target);
  return ids.map((id, i) => {
    const p = game.players.find((x) => x.id === id);
    return {
      id,
      name: p.name,
      bought: boughtCents(p),
      chips: fs[id],
      cashOut: boughtCents(p) + nets[i],
      net: nets[i],
    };
  });
}

// Who pays whom. `fewest` greedily matches the biggest loser with the biggest
// winner, which needs at most n-1 payments. `bank` routes everything through
// the manager, which is how many home games already handle cash.
// Players marked settledOnLeave already squared up with the manager, so their
// net moves onto the manager's books.
export function transfers(game, res, mode = 'fewest') {
  const net = new Map(res.map((r) => [r.id, r.net]));
  const managerId = game.managerId;
  const settled = [];
  for (const p of game.players) {
    if (p.settledOnLeave && net.has(p.id) && p.id !== managerId) {
      const n = net.get(p.id);
      if (n !== 0) {
        settled.push(n < 0 ? { from: p.id, to: managerId, cents: -n, early: true } : { from: managerId, to: p.id, cents: n, early: true });
      }
      net.set(managerId, (net.get(managerId) ?? 0) + n);
      net.set(p.id, 0);
    }
  }

  const list = [];
  if (mode === 'bank') {
    for (const [id, n] of net) {
      if (id === managerId || n === 0) continue;
      list.push(n < 0 ? { from: id, to: managerId, cents: -n } : { from: managerId, to: id, cents: n });
    }
    list.sort((a, b) => b.cents - a.cents);
    return [...settled, ...list];
  }

  const debtors = [];
  const creditors = [];
  for (const [id, n] of net) {
    if (n < 0) debtors.push({ id, left: -n });
    else if (n > 0) creditors.push({ id, left: n });
  }
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].left, creditors[j].left);
    if (pay > 0) list.push({ from: debtors[i].id, to: creditors[j].id, cents: pay });
    debtors[i].left -= pay;
    creditors[j].left -= pay;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return [...settled, ...list];
}

export function transferKey(t) {
  return `${t.from}>${t.to}${t.early ? '!' : ''}`;
}
