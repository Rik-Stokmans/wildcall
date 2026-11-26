// c-field: foraging, the field kitchen and food buffs (docs/contract.md §12).
//
//   - forage plants drawn from the chunk vegetation (field.js, plants.js)
//   - "Pick" interactions, the pick motion and sound, results (pickfx.js, card.js)
//   - buff chips on the HUD (buffs.js)
//   - the 'cook' screen (cook.js), opened from the cabin's Kitchen station and by
//     interacting with a camp's fire
//   - the Herbarium section of the journal (herbarium.js)
//
// Public API (ctx.forage):
//   interactables() → [{id, kind:'forage', pos: Vector3, radius, label, verb}]
//       forage plants near the player, for ctx.props.interactables() to merge in
//   handlesInteract(id) → bool   true for ids this module answers on E (forage nodes,
//       camp fires); the module then does the action itself
//   activate(id)                 runs that action (pick / open the camp kitchen)
//   pick(id)                     sends forage {id} with the pick motion
//   openCook(at?, poi?)          opens the cook screen ('cabin' | 'camp' | auto)
//   herbarium(env) → {left, right}   journal section renderer
//   plantArt(plantId, opts) → HTMLCanvasElement   pressed-plant drawing
//   foodArt(itemId, size) → HTMLCanvasElement     small drawing of an ingredient/food
//   field                        the 3D field (nodes, debug)
//   debugFace(plantId) → id|null turns the player to the nearest such plant (harness)
import * as THREE from 'three';
import { createForageField } from './field.js';
import { createPickFx } from './pickfx.js';
import { createBuffChips } from './buffs.js';
import { createCookScreen } from './cook.js';
import { renderHerbarium } from './herbarium.js';
import { drawPlantArt, drawItemArt, cropColors } from './art.js';
import { createCards } from './card.js';
import { KIND_INFO } from './plants.js';
import { isNodeId, nodeState, stateReason, gotText, cookPlaceAt } from './logic.js';

const NEAR = 7; // metres around the player searched for forage targets

export default {
  name: 'forage',

  init(ctx) {
    const { bus, net, state } = ctx;
    const field = createForageField(ctx);
    const fx = createPickFx(ctx);
    const cards = createCards(ctx);
    const buffs = createBuffChips(ctx);
    const cook = createCookScreen(ctx);
    this._field = field; this._fx = fx; this._buffs = buffs;

    const nearList = [];
    const targets = [];
    const pending = new Map(); // id → time sent
    const known = (plant) => !!(plant && state.profile?.journal?.plants?.[plant.id]);
    const plantName = (plant, kind) => (known(plant) ? plant.name : KIND_INFO[kind]?.unknown || 'A wild plant');

    function interactables() {
      targets.length = 0;
      if (state.mode !== 'play') return targets;
      const f = ctx.player?.feet;
      if (!f) return targets;
      field.near(f.x, f.z, NEAR, nearList);
      for (const n of nearList) {
        const info = KIND_INFO[n.kind];
        if (!n.plant || !info) continue;
        const st = nodeState(n.plant, n.id, state.profile, state.env);
        const ripe = st.state === 'ripe' && !field.isPicked(n.id);
        const name = plantName(n.plant, n.kind);
        targets.push({
          id: n.id, kind: 'forage',
          pos: new THREE.Vector3(n.x, n.y + info.pickY * n.scale, n.z),
          radius: Math.min(2.1, Math.max(1.2, info.radius * n.scale * 0.8 + 0.6)),
          label: ripe ? name : `${name} · ${st.state === 'picked' ? 'picked' : 'nothing to pick'}`,
          verb: ripe ? 'Pick' : 'Look',
        });
      }
      return targets;
    }

    function pick(id) {
      const node = field.node(id);
      if (!node || !node.plant) return;
      const st = nodeState(node.plant, id, state.profile, state.env);
      if (st.state !== 'ripe') {
        fx.fail();
        bus.emit('toast', { kind: 'info', title: plantName(node.plant, node.kind), text: stateReason(st), icon: 'leaf' });
        return;
      }
      const last = pending.get(id);
      if (last && ctx.time - last < 2) return; // already asked; the answer is on its way
      if (fx.busy) return;
      pending.set(id, ctx.time);
      const info = KIND_INFO[node.kind];
      fx.reach(info.pickY * node.scale < 0.6 ? 0.3 : info.pickY * node.scale > 1.6 ? -0.05 : 0.16);
      net.send('forage', { id });
    }

    function openCook(at, poi) {
      let place = { at: at || null, poi: poi || null };
      if (!place.at) place = cookPlaceAt(ctx.player?.feet, state.pois);
      ctx.ui.open('cook', { at: place.at, poi: place.poi?.id || poi || null });
    }

    const isCamp = (id) => state.pois?.[id]?.kind === 'camp';
    const api = {
      field,
      interactables,
      handlesInteract: (id) => isNodeId(id) || isCamp(id),
      activate(id) {
        if (isNodeId(id)) pick(id);
        else if (isCamp(id)) openCook('camp', id);
      },
      pick,
      openCook,
      herbarium: (env) => renderHerbarium(env, api),
      plantArt: (plantId, opts) => drawPlantArt(plantId, opts),
      foodArt: (itemId, size) => drawItemArt(itemId, size, state.items?.[itemId]),
      debugFace(plantId, opts = {}) {
        const f = ctx.player?.feet;
        if (!f) return null;
        let best = null, bd = Infinity;
        for (const n of field.nodes) {
          if (plantId && n.plant?.id !== plantId) continue;
          const d = Math.hypot(n.x - f.x, n.z - f.z);
          if (d < bd) { bd = d; best = n; }
        }
        if (!best) return null;
        // stand back far enough to see the whole plant, on the side we came from
        const info = KIND_INFO[best.kind];
        const want = (opts.dist ?? Math.max(1.8, info.radius * best.scale + 1.3));
        const ux = (f.x - best.x) / (bd || 1), uz = (f.z - best.z) / (bd || 1);
        const px = best.x + ux * want, pz = best.z + uz * want;
        const py = ctx.world?.heightAt?.(px, pz) ?? f.y;
        const yaw = Math.atan2(best.x - px, -(best.z - pz));
        const dy = best.y + info.pickY * best.scale * 0.8 - (py + 1.6);
        ctx.player.teleport(px, py, pz, yaw);
        ctx.player.pitch = Math.atan2(dy, want) + (opts.pitch || 0);
        return best.id;
      },
    };
    ctx.forage = api;

    // E on a forage plant or a camp fire: the player module sends 'interact' for every
    // target it shows; the ones this module owns are answered here instead of by the
    // server (which knows no "fg@" POIs, and has nothing to say about cooking at a camp).
    // A narrow, explicit hook on the outgoing message; everything else passes through.
    const send = net.send.bind(net);
    net.send = (t, d) => {
      if (t === 'interact' && d && typeof d.poi === 'string' && api.handlesInteract(d.poi)) {
        try { api.activate(d.poi); } catch (err) { console.error('[forage] interact failed', err); }
        return;
      }
      return send(t, d);
    };

    net.on('foraged', (m) => {
      pending.delete(m.id);
      const node = field.node(m.id);
      const plant = (state.welcome?.plants || []).find((p) => p.id === m.plant) || node?.plant || null;
      if (!m.ok) {
        fx.fail();
        bus.emit('toast', { kind: 'info', title: plant && (known(plant) || m.first) ? plant.name : 'Nothing to pick', text: m.reason || 'Nothing to pick there.', icon: 'leaf' });
        return;
      }
      field.markPicked(m.id);
      if (node) {
        const info = KIND_INFO[node.kind];
        fx.puff(new THREE.Vector3(node.x, node.y + info.pickY * node.scale, node.z), cropColors(m.got?.[0]?.item));
      }
      const text = gotText(m.got, state.items);
      if (text) bus.emit('toast', { kind: 'item', title: 'Picked', text, icon: 'leaf' });
      if (m.first && plant) cards.newPlant(plant, m.learned || []);
    });

  },

  update(dt) {
    this._field?.update(dt);
    this._buffs?.update(dt);
  },

  lateUpdate(dt) {
    this._fx?.lateUpdate(dt);
  },
};
