// Screen "rareitem" (overlay): Rare Item Presentation (spec §10.2-10.3, §28 screen 11).
// A large icon on a softly glowing, rarity-coloured medallion, then rarity, description,
// history and the item's special effect.
import { icon, rarityBadge, rarityColor, rarityName, formatMod, statIsGood, STAT_INFO, label } from '../kit.js';
import { el, fill, button, ico, sound, screenFrame, confirmKey } from './shell.js';

const KIND_TEXT = { equipment: 'Equipment', gadget: 'Gadget', supply: 'Supply', keepsake: 'Keepsake' };

export function createRareItem(ctx) {
  const { state, ui, bus } = ctx;
  let data = null;
  const frame = screenFrame({ cls: 'enc-rare', title: 'A Remarkable Find', overlay: true });
  frame.card.classList.add('enc-card-narrow');

  function close() { sound(ctx, 'click'); ui.close('rareitem'); }

  function medallion(item) {
    let big;
    try { big = icon(item.icon || 'backpack', 112); } catch { big = null; }
    return el('div', { class: 'enc-medallion', style: { '--rarity': rarityColor(item.rarity) } },
      el('div', { class: 'enc-medallion-glow', 'aria-hidden': 'true' }),
      el('div', { class: 'enc-medallion-ring' }, el('div', { class: 'enc-medallion-face' }, big)));
  }

  function render() {
    const id = data?.item;
    const item = state.items[id] || { id, name: String(id || 'Unknown item').replace(/_/g, ' '), desc: '', rarity: 3, icon: 'backpack' };
    frame.setTitle('A Remarkable Find', rarityName(item.rarity) + ' discovery');
    const mods = Object.entries(item.mods || {}).filter(([k, v]) => v && STAT_INFO[k]);
    fill(frame.body,
      medallion(item),
      el('div', { class: 'enc-rare-name' }, item.name),
      el('div', { class: 'enc-rare-meta' }, rarityBadge(item.rarity),
        el('span', {}, [KIND_TEXT[item.kind], item.slot && label(item.slot), item.tier && `Tier ${item.tier}`].filter(Boolean).join(' · '))),
      item.desc ? el('p', { class: 'enc-rare-desc' }, item.desc) : null,
      item.history ? el('blockquote', { class: 'enc-rare-history' }, el('div', { class: 'enc-tips-title' }, 'History'), item.history) : null,
      item.special ? el('div', { class: 'enc-rare-special' }, ico('star', 18), el('div', {}, el('div', { class: 'enc-tips-title' }, 'Special effect'), el('p', {}, item.special))) : null,
      mods.length || item.cons?.length ? el('div', { class: 'enc-rare-mods' },
        mods.map(([k, v]) => el('span', { class: 'enc-mod ' + (statIsGood(k, v) ? 'good' : 'bad'), title: STAT_INFO[k].label }, `${STAT_INFO[k].label} ${formatMod(k, v)}`)),
        (item.cons || []).map((c) => el('span', { class: 'enc-mod bad' }, c))) : null,
      el('div', { class: 'enc-unlock' }, ico('check', 16), 'Unlocked: added to your pack and noted in your journal'));
    fill(frame.footer, el('div', { class: 'enc-foot-actions' },
      button('Open equipment', { variant: 'secondary', icon: 'backpack', onClick: () => { sound(ctx, 'page'); ui.open('menu', { tab: 'inventory' }); } }),
      button('Continue', { variant: 'primary', onClick: close })));
  }

  confirmKey(ctx, 'rareitem', close);
  bus.on('profile', () => { if (ui.isOpen('rareitem') && data) render(); });

  ui.register('rareitem', {
    root: frame.root, overlay: true, closable: true,
    open(msg) { data = msg || {}; render(); sound(ctx, 'discover'); },
  });
}
