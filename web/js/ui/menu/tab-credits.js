// Credits tab (spec screen 13 "Currency"): the Field Credits balance, what came in and
// what went out recently (profile.ledger), and where credits come from and go to.
import { el, icon } from '../kit.js';
import * as L from './logic.js';
import { ledgerSummary, ledgerByDay, signedCredits } from './ledger.js';
import { section, note } from './common.js';

const EARN = [
  ['quest', 'Quests and research contracts'],
  ['camera', 'Good photographs and recordings submitted at the desk'],
  ['bird', 'First identifications and rare discoveries'],
];
const SPEND = [
  ['shop', "Finn's stall: new gear, film and supplies"],
  ['upgrade', 'Equipment upgrades'],
  ['cabin', 'Cabin improvements'],
];

export function renderCredits(ctx) {
  const p = ctx.state.profile;
  if (!p) return el('div', { class: 'menu-empty' }, 'Your accounts are not ready yet.');
  const sum = ledgerSummary(p.ledger);

  const balance = el('div', { class: 'menu-card menu-wallet' },
    el('div', { class: 'menu-wallet-coin' }, icon('credits', 30)),
    el('div', { class: 'menu-wallet-body' },
      el('div', { class: 'menu-faint' }, 'Field Credits'),
      el('div', { class: 'menu-wallet-num' }, L.formatNumber(p.credits || 0)),
      sum.count ? el('div', { class: 'menu-wallet-totals' },
        el('span', { class: 'earned' }, `${signedCredits(sum.earned)} earned`),
        el('span', { class: 'spent' }, `${signedCredits(-sum.spent)} spent`),
        el('span', { class: 'menu-faint' }, `over the last ${sum.count} entr${sum.count === 1 ? 'y' : 'ies'}`)) : null));

  const ways = el('div', { class: 'menu-card menu-wallet-ways' },
    el('h3', { class: 'menu-h3' }, icon('plus', 15), 'Earned by'),
    el('ul', { class: 'menu-wallet-list' }, EARN.map(([ico, t]) => el('li', icon(ico, 15), el('span', t)))),
    el('h3', { class: 'menu-h3 spend' }, icon('minus', 15), 'Spent on'),
    el('ul', { class: 'menu-wallet-list' }, SPEND.map(([ico, t]) => el('li', icon(ico, 15), el('span', t)))));

  const ledger = sum.count
    ? el('div', { class: 'menu-card menu-ledger' }, ledgerByDay(sum.rows).map((g) => el('div', { class: 'menu-ledger-day' },
      el('div', { class: 'menu-ledger-dayhead' }, el('span', `Day ${g.day}`), el('b', { class: g.total >= 0 ? 'earned' : 'spent' }, signedCredits(g.total))),
      g.rows.map((r) => el('div', { class: 'menu-ledger-row ' + r.kind },
        el('span', { class: 'menu-ledger-mark' }, icon(r.kind === 'earned' ? 'plus' : 'minus', 12)),
        el('span', { class: 'menu-ledger-reason' }, r.reason),
        el('b', { class: 'menu-ledger-amt' }, signedCredits(r.amount)))))))
    : el('div', { class: 'menu-card menu-ledger-empty' }, icon('credits', 28),
      el('p', 'No credits have changed hands yet.'),
      note('Rewards from quests, photographs and discoveries will be written here, and so will anything you buy.'));

  return el('div', { class: 'menu-cols menu-credits-tab' },
    el('div', { class: 'menu-col menu-col-narrow', 'data-scroll': 'cr-l' }, balance, ways),
    el('div', { class: 'menu-col', 'data-scroll': 'cr-r' }, section('Recent ledger', ledger)));
}
