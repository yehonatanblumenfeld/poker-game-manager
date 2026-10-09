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
//
// With `tipPct`, a group tip for the app's developer (that share of the
// buy-ins, rounded up to a whole unit) comes out of the winners' profits in
// proportion to what each won, like a rake. It is never more than they won.
export function results(game, stacks, { adjust = false, tipPct = 0 } = {}) {
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
  const won = nets.reduce((sum, n) => sum + Math.max(0, n), 0);
  const tip = Math.min(tipTotal(game, tipPct), won);
  const cut = tip ? roundToTotal(nets.map((n) => (n > 0 ? (n * tip) / won : 0)), tip) : nets.map(() => 0);
  return ids.map((id, i) => {
    const p = game.players.find((x) => x.id === id);
    const net = nets[i] - cut[i];
    return {
      id,
      name: p.name,
      bought: boughtCents(p),
      chips: fs[id],
      cashOut: boughtCents(p) + net,
      net,
      tip: cut[i],
    };
  });
}

// ---------------- developer tip ----------------

export const TIP = 'tip';

export function tipTotal(game, pct) {
  if (!(pct > 0)) return 0;
  return Math.ceil((tableTotals(game).cents * pct) / 100 / 100) * 100;
}

// ---------------- the pot ----------------

// The cash box on the table. Buy-ins paid in cash go into it; buy-ins "on
// credit" don't. Old games without the flag count as unpaid.
export const POT = 'pot';

export function isPaid(game, buy) {
  return buy.paid ?? false;
}

export function paidCents(game, player) {
  return player.buyIns.reduce((sum, b) => sum + (isPaid(game, b) ? b.cents : 0), 0);
}

export function unpaidCents(game, player) {
  return boughtCents(player) - paidCents(game, player);
}

export function potCents(game) {
  return game.players.reduce((sum, p) => sum + paidCents(game, p), 0);
}

// What a player still has coming once they put `paid` in the pot: the value
// of their chips minus any buy-ins they took on credit. Negative means they
// still owe that much.
export function dueCents(game, player, cashOut) {
  return cashOut - unpaidCents(game, player);
}

// Who pays whom. Every mode starts from the same balances: each player is due
// cashOut - unpaid, and the pot has to hand out everything that was paid in,
// so the books always sum to zero.
//   pot:    everyone settles with the cash box (take out / put in).
//   fewest: greedy biggest-owes-biggest matching, the pot counting as one
//           more "player" that owes its cash; at most n-1 payments.
//   bank:   everyone settles with the host, who holds the pot cash.
// Players marked settledOnLeave already squared up when they left (with the
// pot, or with the host in a game without one), so their balance moves there.
//
// A developer tip is collected by the host, who sends it on (one last line).
export function transfers(game, res, mode = 'fewest') {
  const managerId = game.managerId;
  const bal = new Map();
  for (const r of res) {
    const p = game.players.find((x) => x.id === r.id);
    bal.set(r.id, dueCents(game, p, r.cashOut));
  }
  bal.set(POT, -potCents(game));
  const tip = res.reduce((sum, r) => sum + (r.tip || 0), 0);
  if (tip) bal.set(managerId, (bal.get(managerId) ?? 0) + tip);
  const tipLine = tip ? [{ from: managerId, to: TIP, cents: tip }] : [];

  const early = game.pot ? POT : managerId;
  const settled = [];
  for (const p of game.players) {
    if (p.settledOnLeave && bal.has(p.id) && p.id !== early) {
      const n = bal.get(p.id);
      if (n !== 0) settled.push(n < 0 ? { from: p.id, to: early, cents: -n, early: true } : { from: early, to: p.id, cents: n, early: true });
      bal.set(early, (bal.get(early) ?? 0) + n);
      bal.set(p.id, 0);
    }
  }

  const list = [];
  if (mode === 'pot' || mode === 'bank') {
    let hub = POT;
    if (mode === 'bank') {
      // The host is holding the cash box.
      hub = managerId;
      bal.set(hub, (bal.get(hub) ?? 0) + bal.get(POT));
      bal.delete(POT);
    }
    for (const [id, n] of bal) {
      if (id === hub || n === 0) continue;
      list.push(n < 0 ? { from: id, to: hub, cents: -n } : { from: hub, to: id, cents: n });
    }
    // Money in first, then pay-outs, biggest first.
    list.sort((a, b) => (b.to === hub) - (a.to === hub) || b.cents - a.cents);
    return [...settled, ...list, ...tipLine];
  }

  const debtors = [];
  const creditors = [];
  for (const [id, n] of bal) {
    if (n < 0) debtors.push({ id, left: -n });
    else if (n > 0) creditors.push({ id, left: n });
  }
  // The pot pays first: it's cash already on the table.
  const order = (a, b) => (b.id === POT) - (a.id === POT) || b.left - a.left;
  debtors.sort(order);
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
  return [...settled, ...list, ...tipLine];
}

export function transferKey(t) {
  return `${t.from}>${t.to}${t.early ? '!' : ''}`;
}
