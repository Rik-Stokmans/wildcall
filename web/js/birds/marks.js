// Plumage painting: base palette regions + every field-mark kind, as pure functions of
// a part name and part-normalised coordinates. model.js evaluates this at the centroid
// of every triangle, so marks get crisp low-poly edges that read through binoculars.
//
// Part coordinates (all roughly -1..1 or 0..1):
//   body / head / crest:  s = side (+1 right, -1 left), y = up (+1 back/crown, -1 belly/chin),
//                         f = forward (+1 breast / bill side, -1 rear / nape side)
//   neck:                 s, y (+1 hind-neck, -1 fore-neck), f = t (0 at body … 1 at head)
//   wing:                 s = u span (0 shoulder … 1 tip), y = top (+1 upper surface, -1 under),
//                         f = v chord (0 leading edge … 1 trailing edge)
//   tail:                 s = lateral (-1..1), y = top (+1 upper, -1 under), f = l (0 base … 1 tip)
//   bill, lowerbill, eye, legs: bare parts, palette colour only (lowerbill's throat sac
//                         region is f < 0 and takes the throat colour if any).
// Pure module: no three.js.

import { parseHex, mix } from './color.js';

const frac = (x) => x - Math.floor(x);

/** Deterministic 0..1 hash of a lattice cell (for spots). */
export function cellHash(a, b, c) {
  return frac(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);
}

const abs = Math.abs;

/**
 * Where each mark kind is painted. Each entry maps part name → predicate(s, y, f, ctx).
 * ctx = { arch, disc } (silhouette archetype; owls paint 'cheek' as the facial disc,
 * gulls paint 'wingpatch' as the black wingtips).
 */
export const MARK_PLACEMENT = Object.freeze({
  breast: {
    body: (s, y, f) => (f > 0.05 && y < 0.15) || (f > 0.62 && y < 0.45),
    neck: (s, y, f) => y < -0.1 && f < 0.5,
  },
  throat: {
    head: (s, y, f) => y < -0.28 && f > -0.05 && abs(s) < 0.8,
    neck: (s, y) => y < -0.3,
    body: (s, y, f) => f > 0.84 && y > -0.15 && y < 0.35 && abs(s) < 0.6,
    lowerbill: (s, y, f) => f < 0,
  },
  bib: {
    head: (s, y, f) => y < -0.48 && f > -0.15 && abs(s) < 0.62,
    neck: (s, y) => y < -0.4 && abs(s) < 0.5,
    body: (s, y, f) => f > 0.42 && abs(s) < 0.42 && y > -0.75 && y < 0.42,
  },
  cap: {
    head: (s, y, f) => y > 0.34 && f > -0.72,
    crest: () => true,
  },
  mask: {
    head: (s, y, f) => (abs(s) > 0.3 && y > -0.28 && y < 0.46 && f > -0.18) || (f > 0.78 && y > -0.25 && y < 0.38),
  },
  eyestripe: {
    // A band at eye level running from the bill past the eye to the nape (covers both
    // dark eye-lines and pale eyebrows; the eye itself is a separate part on top).
    head: (s, y, f) => abs(s) > 0.32 && f > -0.78 && abs(y - (0.27 + 0.08 * f)) < 0.13,
  },
  cheek: {
    head: (s, y, f, ctx) => (ctx.disc
      ? f > 0.22 && y > -0.75 && y < 0.78 // owls: the whole facial disc
      : abs(s) > 0.44 && y > -0.52 && y < 0.14 && f > -0.48 && f < 0.7),
  },
  collar: {
    head: (s, y) => y < -0.6 && y > -0.95,
    neck: (s, y, f) => f > 0.12 && f < 0.3,
    body: (s, y, f) => f > 0.78 && f < 0.93 && y > -0.25,
  },
  nape: {
    head: (s, y, f) => f < -0.32 && y > -0.55 && y < 0.5,
    neck: (s, y, f) => y > 0.3 && f > 0.45,
    body: (s, y, f) => f > 0.74 && y > 0.32,
  },
  rump: {
    body: (s, y, f) => f < -0.32 && y > 0.3 && abs(s) < 0.75,
  },
  spots: {
    body: (s, y, f) => y < 0.42 && f > -0.65 && cellHash(Math.floor(s * 5), Math.floor(y * 5), Math.floor(f * 6)) > 0.6,
    neck: (s, y, f) => y < -0.2 && cellHash(Math.floor(s * 4), 3, Math.floor(f * 6)) > 0.6,
  },
  streaks: {
    // Lengthwise streaks: alternate along the side axis so lines run front-to-back.
    body: (s, y, f) => y < 0.3 && f > -0.62 && frac(s * 3.2 + 0.25) < 0.34,
    neck: (s, y, f) => y < -0.25 && abs(s) < 0.45 && frac(f * 4) < 0.55,
  },
  bars: {
    body: (s, y, f) => y < 0.22 && frac(f * 4.2 + 0.2) < 0.34,
    tail: (s, y, f) => frac(f * 4 + 0.15) < 0.3,
    wing: (s, y, f) => s > 0.25 && frac(s * 5) < 0.28,
  },
  tailtip: {
    tail: (s, y, f) => f > 0.76,
  },
  wingbar: {
    wing: (s, y, f) => y > 0 && f > 0.18 && f < 0.38 && s > 0.06 && s < 0.72,
  },
  wingpatch: {
    wing: (s, y, f, ctx) => (ctx.arch === 'gull'
      ? s > 0.76
      : s > 0.26 && s < 0.66 && f > 0.22 && f < 0.88),
  },
});

/** Pre-parse a look's palette and marks once per species (sRGB triples). */
export function preparePalette(look) {
  const c = look?.colors || {};
  const back = parseHex(c.back);
  const belly = parseHex(c.belly);
  const wing = parseHex(c.wing);
  const tail = parseHex(c.tail);
  return {
    back, belly, wing, tail,
    head: parseHex(c.head),
    bill: parseHex(c.bill),
    legs: parseHex(c.legs),
    eye: parseHex(c.eye),
    wingUnder: mix(wing, belly, 0.45),
    tailUnder: mix(tail, belly, 0.3),
    marks: (Array.isArray(look?.marks) ? look.marks : [])
      .filter((m) => m && MARK_PLACEMENT[m.kind])
      .map((m) => ({ kind: m.kind, rgb: parseHex(m.color) })),
  };
}

function copy(src, out) { out[0] = src[0]; out[1] = src[1]; out[2] = src[2]; return out; }

/**
 * Colour (sRGB triple) of a point on a part.
 * @param {object} pal preparePalette() result
 * @param {string} part body|head|crest|neck|wing|tail|bill|lowerbill|eye|legs|twig
 * @param {{arch:string, disc:boolean}} ctx
 */
export function paintAt(pal, part, s, y, f, ctx, out = [0, 0, 0]) {
  switch (part) {
    case 'bill': return copy(pal.bill, out);
    case 'eye': return copy(pal.eye, out);
    case 'legs': return copy(pal.legs, out);
    case 'body': {
      // Back on top, belly below, a soft-ish split along the flank.
      if (y > 0.08) copy(pal.back, out);
      else if (y < -0.18) copy(pal.belly, out);
      else mix(pal.belly, pal.back, (y + 0.18) / 0.26, out);
      break;
    }
    case 'head': case 'crest': copy(pal.head, out); break;
    case 'neck': {
      if (f > 0.55) copy(pal.head, out);
      else copy(y >= 0 ? pal.back : pal.belly, out);
      break;
    }
    case 'wing': copy(y >= 0 ? pal.wing : pal.wingUnder, out); break;
    case 'tail': copy(y >= 0 ? pal.tail : pal.tailUnder, out); break;
    case 'lowerbill': copy(pal.bill, out); break;
    default: copy(pal.back, out);
  }
  // Marks paint in authored order, later marks over earlier ones (catalog relies on this,
  // e.g. the song thrush's buff breast wash is painted before its spots).
  for (let i = 0; i < pal.marks.length; i++) {
    const m = pal.marks[i];
    const test = MARK_PLACEMENT[m.kind][part];
    if (test && test(s, y, f, ctx)) copy(m.rgb, out);
  }
  return out;
}
