// WILDCALL journal module: the Field Journal, the Map, the Quest Log and the Collection.
// Registers four screens (docs/contract.md §5.3): journal, map, quests, collection.
//
// Public API (ctx.journal):
//   ctx.journal.open(section?, data?)  open the journal on a section ('species' | 'photos' |
//                                      'recordings' | 'locations' | 'history' | 'rare')
//   ctx.journal.regionMemory           region-type samples remembered for map lettering
// Screen data: journal {section, species, mystery}; map {focus: {x, z}}; quests {tab, quest};
// collection {set}.
import { createJournalScreen } from './journal-screen.js';
import { createMapScreen } from './map-screen.js';
import { createQuestScreen } from './quests-screen.js';
import { createCollectionScreen } from './collection-screen.js';
import { createRegionMemory } from './region-memory.js';
import { createMapWorld } from './map-world.js';

const memory = createRegionMemory();
let sampleClock = 0;

export default {
  name: 'journal',
  init(ctx) {
    const mapWorld = createMapWorld(ctx);
    ctx.bus.on('welcome', (w) => {
      memory.bind(w?.world?.seed ?? w?.seed ?? 'world');
      memory.addLocations(w?.profile?.journal?.locations);
      if (w?.world?.home) memory.addKnown(w.world.home.x, w.world.home.z, 0); // the home valley is always Greenhollow
      mapWorld.sync();
    });

    ctx.ui.register('journal', createJournalScreen(ctx));
    ctx.ui.register('map', createMapScreen(ctx, memory, mapWorld));
    ctx.ui.register('quests', createQuestScreen(ctx));
    ctx.ui.register('collection', createCollectionScreen(ctx));

    ctx.journal = {
      open(section, data = {}) { return ctx.ui.open('journal', { ...data, section }); },
      regionMemory: memory,
    };
  },

  // The map letters region names over explored ground, so while the player walks we keep
  // a light record of which region type lies where (ctx.world.regionAt answers only for
  // loaded chunks).
  update(dt, ctx) {
    memory.tick(dt);
    sampleClock += dt;
    if (sampleClock < 1.5) return;
    sampleClock = 0;
    const pos = ctx.player?.pos;
    if (!ctx.state.welcome || !pos || !Number.isFinite(pos.x)) return;
    memory.sample(ctx.world, pos.x, pos.z);
  },
};
