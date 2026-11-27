// Shared client state. Plain object; modules read it freely and react to bus events
// ('welcome', 'profile', 'env', 'mode'). Only main.js / core mutate the top-level fields.
const SETTINGS_KEY = 'wildcall.settings.v1';

export const DEFAULT_SETTINGS = {
  volMaster: 0.8,
  volBirds: 1.0,
  volAmbient: 0.7,
  volMusic: 0.35,
  volUI: 0.6,
  volNarrator: 0.9,
  narrator: 'off',    // off | sparse | normal | chatty  — how often the narrator speaks. Off unless the player turns it on.
  narratorOptIn: false, // true once the player has switched the narrator on themselves (see createState)
  narratorVoice: '',  // preferred system voice name ('' = pick the best British voice)
  sensitivity: 1.0,
  invertY: false,
  fov: 70,            // naked-eye vertical FOV, degrees
  quality: 'medium',  // low | medium | high  (view distance, shadows, foliage density)
  hints: true,        // tutorial hints
  subtitles: true,    // sound captions in the clue panel
  soundRing: true,    // ring around the centre of the view showing where sounds come from
  clueCards: 'one',   // one | all — one clue card (the voice being followed, Q pins it) or a card per voice
  songRipples: true,  // soft rings from a nearby singing bird you have a line of sight to
  birdOutline: true,  // a soft light edge around birds you have a clear line of sight to
  leafFade: true,     // leaves right in front of a nearby bird thin out so it is not buried
  flightTrails: true, // a faint streak of soft dabs behind a bird you scared off (birds/flightfx.js)
  minimap: true,      // small map in the top-left corner
  minimapRotate: true, // true = the minimap turns with you (heading up); false = north up
};

export function createState(bus) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* ignore */ }
  // The narrator used to be on by default; it is now opt-in. A saved 'normal' from that
  // time is not a choice the player made, so it is dropped unless they opted in since.
  if (saved && !saved.narratorOptIn) delete saved.narrator;
  const state = {
    /** 'boot' | 'mainmenu' | 'play' | 'ui'  — 'ui' while any screen is open in-game. */
    mode: 'boot',
    welcome: null,
    profile: null,
    env: null,
    settings: { ...DEFAULT_SETTINGS, ...saved },
    // Indexes built from the welcome message:
    species: [],          // by index
    speciesById: {},
    items: {},            // id → ItemDef
    skills: {},           // id → SkillDef
    quests: {},           // id → QuestDef
    npcs: {},             // id → NPCDef
    pois: {},             // id → POI
    collectibles: {},     // id → CollectibleDef
    lore: {},             // id → LoreDef
    cabinUpgrades: {},    // id → CabinUpgradeDef
    regions: [],          // by region id
    ranks: [],            // RankDef[], index-1 = position
    disciplines: [],
    skillTiers: [],
    trails: [],
    shop: [],

    applyWelcome(w) {
      state.welcome = w;
      state.species = w.species || [];
      state.speciesById = index(state.species);
      state.items = index(w.items);
      state.skills = index(w.skills);
      state.quests = index(w.quests);
      state.npcs = index(w.npcs);
      state.pois = index(w.pois);
      state.collectibles = index(w.collectibles);
      state.lore = index(w.lore);
      state.cabinUpgrades = index(w.cabinUpgrades);
      state.regions = w.regions || [];
      state.ranks = w.ranks || [];
      state.disciplines = w.disciplines || [];
      state.skillTiers = w.skillTiers || [];
      state.trails = w.trails || [];
      state.shop = w.shop || [];
      state.profile = w.profile;
      state.env = w.env;
    },
    setMode(m) {
      if (state.mode === m) return;
      const prev = state.mode;
      state.mode = m;
      bus.emit('mode', { mode: m, prev });
    },
    setSetting(key, value) {
      state.settings[key] = value;
      if (key === 'narrator') state.settings.narratorOptIn = value !== 'off';
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
      bus.emit('settings', { key, value, settings: state.settings });
    },
    /** Current derived stats (core.Stats) or an empty object before welcome. */
    get stats() { return state.profile?.stats || {}; },
  };
  return state;
}

function index(list) {
  const out = {};
  for (const x of list || []) out[x.id] = x;
  return out;
}
