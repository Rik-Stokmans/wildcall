// Quest Log: Active / Available / Completed tabs, quests grouped by category with icons,
// and a detail pane with story, objectives, hints, rewards and tracking.

import { el, fill, icon, button, progressBar, itemCard, confirmDialog } from '../kit.js';
import {
  questTabs, groupByCategory, objectiveRows, questProgress, giverName, turnInText, availableText, rewardLines, readyToTurnIn, categoryInfo,
} from './quest-logic.js';
import { formatDay, plural } from './format.js';
import { screenRoot, sheet, emptyNote, chip, sectionTitle, keepScroll, uiSound } from './widgets.js';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'available', label: 'Available' },
  { id: 'completed', label: 'Completed' },
];

export function createQuestScreen(ctx) {
  const root = screenRoot(ctx, 'quests');
  const frame = sheet(ctx, 'quests', { title: 'Quest Log', subtitle: '', ico: 'quest', className: 'jr-quests' });
  root.appendChild(frame.panel);
  const st = { tab: 'active', sel: null };
  let isOpen = false;

  function render() {
    if (!isOpen || !ctx.state.profile) return;
    const restore = keepScroll(frame.panel);
    const profile = ctx.state.profile;
    const tabs = questTabs(Object.values(ctx.state.quests), profile.quests);
    const list = tabs[st.tab];
    if (!list.some((e) => e.def.id === st.sel)) st.sel = list[0]?.def.id || null;
    const entry = list.find((e) => e.def.id === st.sel);
    const ready = readyToTurnIn(profile.quests);
    frame.setSubtitle(ready ? `${plural(ready, 'quest')} ready to turn in` : '');

    fill(frame.headRight, el('div', { class: 'jr-pilltabs', role: 'tablist' }, TABS.map((t) => el('button', {
      type: 'button', role: 'tab', class: 'jr-pilltab' + (t.id === st.tab ? ' active' : ''),
      onclick: () => { if (st.tab !== t.id) { st.tab = t.id; st.sel = null; uiSound(ctx, 'page'); render(); } },
    }, t.label, el('span', { class: 'jr-pilltab-n' }, String(tabs[t.id].length))))));

    const groups = groupByCategory(list);
    fill(frame.body,
      el('div', { class: 'jr-qlist', 'data-scroll': 'qlist' },
        groups.length ? groups.map((g) => el('div', { class: 'jr-group' },
          el('div', { class: 'jr-qcat' }, icon(g.icon, 16), el('span', g.label), el('small', String(g.entries.length))),
          g.entries.map((e) => questRow(e))))
          : emptyNote(emptyText(st.tab), 'quest')),
      el('div', { class: 'jr-qdetail', 'data-scroll': 'qdetail' }, entry ? questDetail(entry) : emptyNote('Choose a quest to read its details.', 'journal')));
    restore();
  }

  function emptyText(tab) {
    if (tab === 'active') return 'No active quests. Talk to people around the valley, or check the research board in your cabin.';
    if (tab === 'available') return 'Nothing is on offer right now. New opportunities appear as you explore and earn trust.';
    return 'No quests completed yet.';
  }

  function questRow({ def, state }) {
    const prog = questProgress(def, state);
    const readyNow = state.status === 'complete';
    return el('button', {
      type: 'button', class: 'jr-qrow' + (def.id === st.sel ? ' selected' : '') + (readyNow ? ' ready' : ''),
      onclick: () => { st.sel = def.id; uiSound(ctx, 'click'); render(); },
    },
    el('span', { class: 'jr-qrow-main' }, el('b', def.name), el('small', readyNow ? 'Ready to turn in' : state.status === 'turned_in' ? `Completed ${formatDay(state.day)}` : state.status === 'available' ? giverName(def.giver, ctx.state.npcs) : `${prog.done} of ${prog.total} steps`)),
    state.tracked ? el('span', { class: 'jr-qrow-pin', title: 'Tracked' }, icon('pin', 14)) : null,
    readyNow ? el('span', { class: 'jr-qrow-pin amber', title: 'Ready to turn in' }, icon('check', 14)) : null);
  }

  function questDetail({ def, state }) {
    const rows = objectiveRows(def, state);
    const prog = questProgress(def, state);
    const cat = categoryInfo(def.category);
    const rewards = rewardLines(def.rewards, { regions: ctx.state.regions, quests: ctx.state.quests, lore: ctx.state.lore });
    const items = (def.rewards?.items || []).map((id) => ctx.state.items[id]).filter(Boolean);
    const active = state.status === 'active' || state.status === 'complete';
    const npcs = ctx.state.npcs;

    return el('div', { class: 'jr-qd' },
      el('div', { class: 'jr-qd-top' },
        el('div', { class: 'jr-sp-chips' }, chip(cat.label, { ico: cat.icon }),
          state.tracked ? chip('Tracked', { tone: 'good', ico: 'pin' }) : null,
          def.giver === 'board' ? chip('Research contract', { tone: 'amber' }) : null),
        el('h2', def.name),
        el('div', { class: 'jr-muted' }, `From ${giverName(def.giver, npcs)}`)),
      state.status === 'complete' ? el('div', { class: 'jr-banner' }, icon('check', 18), el('span', turnInText(def, npcs))) : null,
      state.status === 'available' ? el('div', { class: 'jr-banner soft' }, icon('info', 18), el('span', availableText(def, npcs))) : null,
      def.summary ? el('p', { class: 'jr-qsummary' }, def.summary) : null,
      def.story ? el('p', { class: 'jr-qstory' }, def.story) : null,
      sectionTitle('Objectives', prog.total ? `${prog.done} of ${prog.total}` : ''),
      prog.total ? progressBar(prog.done, prog.total, { height: 8 }) : null,
      el('ul', { class: 'jr-objs' }, rows.map((r) => el('li', { class: 'jr-obj ' + r.status },
        el('span', { class: 'jr-obj-check' }, r.done ? icon('check', 13) : ''),
        el('span', { class: 'jr-obj-body' },
          el('span', { class: 'jr-obj-text' }, r.text, r.need > 1 ? el('b', { class: 'jr-obj-count' }, ` ${r.have}/${r.need}`) : null),
          r.hint ? el('small', { class: 'jr-obj-hint' }, r.hint) : null)))),
      sectionTitle('Rewards'),
      (rewards.length || items.length) ? [
        el('ul', { class: 'jr-rewards' }, rewards.map((l) => el('li', icon(l.icon, 16), el('span', l.text)))),
        items.length ? el('div', { class: 'jr-reward-items' }, items.map((it) => itemCard(it, { compact: true }))) : null,
      ] : el('p', { class: 'jr-muted' }, 'The satisfaction of a job well done.'),
      active ? el('div', { class: 'jr-actions' },
        button(state.tracked ? 'Stop tracking' : 'Track quest', {
          variant: state.tracked ? 'secondary' : 'primary', icon: 'pin',
          onClick: () => { uiSound(ctx, 'click'); ctx.net.send('quest', { id: def.id, action: state.tracked ? 'untrack' : 'track' }); },
        }),
        !def.tutorial && state.status === 'active' ? button('Set aside', {
          variant: 'ghost', title: 'Put this quest down. You can pick it up again later.',
          onClick: async () => {
            if (await confirmDialog(`Set aside “${def.name}”? You can pick it up again later.`, { ok: 'Set aside', cancel: 'Keep it' })) ctx.net.send('quest', { id: def.id, action: 'abandon' });
          },
        }) : null) : null);
  }

  ctx.bus.on('profile', () => { if (isOpen) render(); });

  return {
    root,
    closable: true,
    open(data = {}) {
      isOpen = true;
      if (data.tab && TABS.some((t) => t.id === data.tab)) st.tab = data.tab;
      if (data.quest) {
        const state = ctx.state.profile?.quests?.[data.quest];
        const tab = state && ({ active: 'active', complete: 'active', available: 'available', turned_in: 'completed' })[state.status];
        if (tab) { st.tab = tab; st.sel = data.quest; }
      }
      // Nothing under way: show what is on offer rather than an empty page.
      if (!data.tab && !data.quest && st.tab === 'active') {
        const tabs = questTabs(Object.values(ctx.state.quests), ctx.state.profile?.quests || {});
        if (!tabs.active.length && tabs.available.length) { st.tab = 'available'; st.sel = null; }
      }
      uiSound(ctx, 'open');
      render();
    },
    close() { isOpen = false; uiSound(ctx, 'close'); },
  };
}
