import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSummary, signedCredits, ledgerByDay } from './ledger.js';

test('ledger: newest first, totals earned and spent, empty when absent', () => {
  assert.deepEqual(ledgerSummary(null), { rows: [], earned: 0, spent: 0, net: 0, count: 0 });
  assert.equal(ledgerSummary([]).count, 0);
  const s = ledgerSummary([
    { day: 1, amount: 120, reason: 'Quest: The Unseen Singer' },
    { day: 2, amount: -45, reason: 'Bought Film roll' },
    { day: 2, amount: 0, reason: 'nothing' },
    { day: 3, amount: 30, reason: '' },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.earned, 150);
  assert.equal(s.spent, 45);
  assert.equal(s.net, 105);
  assert.deepEqual(s.rows.map((r) => r.day), [3, 2, 1]);
  assert.equal(s.rows[0].reason, 'Earned');
  assert.equal(s.rows[1].kind, 'spent');
  assert.equal(signedCredits(120), '+120');
  assert.equal(signedCredits(-45), '−45');
  assert.equal(signedCredits(0), '0');
  const g = ledgerByDay(s.rows);
  assert.deepEqual(g.map((d) => [d.day, d.total]), [[3, 30], [2, -45], [1, 120]]);
});
