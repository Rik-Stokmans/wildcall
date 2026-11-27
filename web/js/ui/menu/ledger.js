// Pure logic for the Field Credits ledger (spec screen 13: balance, earned rewards,
// spending). profile.ledger is the recent history, newest LAST, capped by the server.

/**
 * @param ledger proto.LedgerEntry[] ({day, amount, reason}) or null
 * @returns {{rows: {day, amount, reason, kind: 'earned'|'spent'}[], earned, spent, net, count}}
 *   rows newest first; zero-amount entries are dropped.
 */
export function ledgerSummary(ledger) {
  const list = Array.isArray(ledger) ? ledger : [];
  let earned = 0, spent = 0;
  const rows = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    const amount = Math.round(Number(e?.amount) || 0);
    if (!amount) continue;
    if (amount > 0) earned += amount; else spent -= amount;
    rows.push({ day: Math.max(1, e.day | 0), amount, reason: String(e.reason || (amount > 0 ? 'Earned' : 'Spent')), kind: amount > 0 ? 'earned' : 'spent' });
  }
  return { rows, earned, spent, net: earned - spent, count: rows.length };
}

/** "+120" / "−45" (a real minus sign). */
export function signedCredits(n) {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en-GB');
}

/** Group rows by day, keeping order: [{day, rows, total}]. */
export function ledgerByDay(rows) {
  const out = [];
  for (const r of rows || []) {
    let g = out[out.length - 1];
    if (!g || g.day !== r.day) { g = { day: r.day, rows: [], total: 0 }; out.push(g); }
    g.rows.push(r);
    g.total += r.amount;
  }
  return out;
}
