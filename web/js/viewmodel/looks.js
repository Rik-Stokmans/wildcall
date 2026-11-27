// Pure: what the held tools look like for the equipped items (no three.js). Colours are
// 0xRRGGBB numbers; sizes are multipliers on the base model. Cheap per-item flavour:
// tier-1 kit is small and plain, better kit is bigger with rubber armour, the
// historical binoculars are brass and leather, the vintage recorder is wood and metal.

const SKIN = 0xe9b48f;

// Shared palette (warm, slightly desaturated, matching the game's soft look).
export const C = {
  skin: SKIN,
  skinShade: 0xd59a78,
  black: 0x36383b,
  charcoal: 0x4c5055,
  slate: 0x4a5560,
  olive: 0x5d6b45,
  moss: 0x46583a,
  sage: 0x8a9a7a,
  tan: 0xb59a6c,
  cream: 0xe8dcc0,
  brass: 0xc99a45,
  brassDark: 0x8e6a2c,
  leather: 0x6b4128,
  leatherDark: 0x4a2c1c,
  wood: 0x8a5a33,
  woodLight: 0xb07a46,
  metal: 0xa7adb2,
  steel: 0x6f777e,
  glass: 0x24415a,
  glassHi: 0x5f8fb0,
  white: 0xeeeae2,
  red: 0xc4453a,
  fur: 0xb3a48c,
  furLight: 0xcfc3ad,
  strap: 0x3f3a33,
};

const SLEEVES = {
  field_clothes: { sleeve: 0x7d7a52, cuff: 0x67643f },
  rain_shell: { sleeve: 0x3f7d86, cuff: 0x2f5f66 },
  sturdy_boots: { sleeve: 0x7d7a52, cuff: 0x67643f },
  camouflage_smock: { sleeve: 0x5b6a3e, cuff: 0x45512f, mottle: [0x3f4a2a, 0x7a7448] },
};
const DEFAULT_SLEEVE = { sleeve: 0x8a7a56, cuff: 0x6d6044 };

/** Look of the arms for the equipped clothing item id. */
export function armLook(clothingId) {
  const s = SLEEVES[clothingId] || DEFAULT_SLEEVE;
  return { skin: C.skin, skinShade: C.skinShade, sleeve: s.sleeve, cuff: s.cuff, mottle: s.mottle || null };
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Binocular look for an item id (+ its ItemDef for tier fallback).
 * kind: 'roof' (straight barrels) | 'porro' (offset, chunky) | 'scope' (one long tube)
 */
export function binoLook(id, def) {
  const tier = num(def?.tier, 1);
  switch (id) {
    case 'basic_binoculars':
      return { kind: 'roof', size: 0.86, length: 0.92, body: C.charcoal, armour: C.charcoal, trim: C.steel, ring: null, strap: C.strap };
    case 'explorer_binoculars':
      return { kind: 'roof', size: 1.06, length: 1.0, body: C.olive, armour: C.moss, trim: C.black, ring: null, strap: C.strap, rubber: true };
    case 'wide_field_binoculars':
      return { kind: 'porro', size: 1.04, length: 0.9, body: C.tan, armour: 0x8c7650, trim: C.black, ring: null, strap: C.leather };
    case 'specialist_binoculars':
      return { kind: 'roof', size: 1.1, length: 1.14, body: C.slate, armour: 0x37424c, trim: C.black, ring: 0x8fb5a0, strap: C.black, rubber: true };
    case 'spotting_scope':
      return { kind: 'scope', size: 1.15, length: 1.55, body: 0x5a6a52, armour: 0x48573f, trim: C.black, ring: 0xd0b25a, strap: C.black, rubber: true };
    case 'historical_binoculars':
      return { kind: 'porro', size: 0.98, length: 1.0, body: C.leather, armour: C.leatherDark, trim: C.brass, ring: C.brass, strap: C.leather, brass: true };
    default:
      return tier >= 3
        ? { kind: 'roof', size: 1.1, length: 1.1, body: C.slate, armour: 0x37424c, trim: C.black, ring: null, strap: C.black, rubber: true }
        : { kind: 'roof', size: tier >= 2 ? 1.0 : 0.88, length: 1, body: C.charcoal, armour: C.charcoal, trim: C.steel, ring: null, strap: C.strap };
  }
}

/** Camera look. lens: base barrel length multiplier; style: 'dslr' | 'compact' | 'rangefinder'. */
export function cameraLook(id, def) {
  const tier = num(def?.tier, 1);
  switch (id) {
    case 'starter_camera':
      return { style: 'compact', size: 0.88, body: C.charcoal, top: C.cream, lens: 0.8, lensR: 0.9, lensColor: C.black, ring: C.metal, hood: false };
    case 'wildlife_camera':
      return { style: 'dslr', size: 1.0, body: C.black, top: C.black, lens: 1.25, lensR: 1.0, lensColor: C.charcoal, ring: C.red, hood: true };
    case 'silent_camera':
      return { style: 'dslr', size: 0.95, body: 0x34383a, top: 0x34383a, lens: 1.0, lensR: 0.95, lensColor: 0x2d3133, ring: 0x6f8a7a, hood: false };
    case 'macro_camera':
      return { style: 'dslr', size: 0.96, body: C.charcoal, top: C.charcoal, lens: 0.85, lensR: 1.15, lensColor: C.black, ring: 0xd0a040, hood: false };
    case 'telephoto_camera':
      return { style: 'dslr', size: 1.04, body: C.black, top: C.black, lens: 2.0, lensR: 1.2, lensColor: C.white, ring: C.red, hood: true };
    case 'fast_action_camera':
      return { style: 'dslr', size: 1.06, body: C.black, top: C.black, lens: 1.4, lensR: 1.05, lensColor: C.charcoal, ring: 0xd9a23c, hood: true, grip: true };
    case 'vintage_camera':
      return { style: 'rangefinder', size: 0.95, body: C.black, top: C.metal, lens: 0.7, lensR: 0.85, lensColor: C.metal, ring: C.black, hood: false };
    default:
      return { style: tier >= 2 ? 'dslr' : 'compact', size: 1, body: C.black, top: C.black, lens: 1 + (tier - 1) * 0.3, lensR: 1, lensColor: C.charcoal, ring: C.metal, hood: tier >= 2 };
  }
}

/**
 * Audio look. kind: 'handheld' (recorder + fur mic) | 'shotgun' (long mic in a fur
 * windshield on a pistol grip) | 'dish' (parabolic) | 'vintage' (wood-and-metal box).
 */
export function audioLook(id, def) {
  const icon = def?.icon || '';
  switch (id) {
    case 'basic_recorder':
      return { kind: 'handheld', size: 0.9, body: C.sage, face: 0x2f3532, fur: C.fur, twin: false };
    case 'advanced_recorder':
      return { kind: 'handheld', size: 1.05, body: 0x3b4247, face: 0x22272a, fur: C.furLight, twin: true };
    case 'directional_microphone':
      return { kind: 'shotgun', size: 1, body: C.charcoal, face: C.black, fur: C.furLight, twin: false };
    case 'parabolic_microphone':
      return { kind: 'dish', size: 1, body: C.charcoal, face: C.black, fur: C.fur, dish: 0xd8d4c8, twin: false };
    case 'vintage_recorder':
      return { kind: 'vintage', size: 1, body: C.wood, face: C.metal, fur: C.fur, trim: C.brass, twin: false };
    default:
      if (icon === 'microphone') return { kind: 'shotgun', size: 1, body: C.charcoal, face: C.black, fur: C.furLight, twin: false };
      return { kind: 'handheld', size: 1, body: C.sage, face: 0x2f3532, fur: C.fur, twin: false };
  }
}

/** The look key for a tool: changes when the model must be rebuilt. */
export function lookKey(tool, equipped, clothing) {
  if (!tool || tool === 'none') return 'none';
  return tool + '|' + (equipped || '') + '|' + (clothing || '');
}

/** Equipment slot of a tool. */
export function slotOf(tool) {
  return tool === 'binoculars' ? 'optics' : tool === 'camera' ? 'camera' : tool === 'recorder' ? 'audio' : '';
}
