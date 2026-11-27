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
  narrator: 'normal', // off | sparse | normal | chatty  — how often the narrator speaks
  narratorVoice: '',  // preferred system voice name ('' = pick the best British voice)
  sensitivity: 1.0,
  invertY: false,
  fov: 70,            // naked-eye vertical FOV, degrees
  quality: 'medium',  // low | medium | high  (view distance, shadows, foliage density)
  hints: true,        // tutorial hints
  subtitles: true,    // sound captions in the clue panel
  soundRing: true,    // ring around the centre of the view showing where sounds come from
};

export function createState(bus) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* ignore */ }
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
