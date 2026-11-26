// Sky maths: sun and moon paths, daylight, sky colour keys, fog distances, region
// atmosphere and smooth interpolation of the 1 Hz env updates.
// Pure: no three.js, no DOM. Colours are sRGB triples in 0..1.
//
// Conventions (internal/core/types.go): metres, Y up, north = -Z, east = +X; a compass
// heading h points along (sin h, 0, -cos h).

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** core.RegionID values. */
export const REGION = Object.freeze({
  GREENHOLLOW: 0, MARSH: 1, WINDPEAK: 2, COAST: 3, AMBERWOOD: 4, FROSTVEIL: 5, NONE: 255,
});

/** core.Weather values. */
export const WEATHER = Object.freeze({ SUNNY: 0, CLOUDY: 1, RAIN: 2, WIND: 3 });

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export function mix3(a, b, t, out = [0, 0, 0]) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
/** 0xrrggbb → sRGB triple. */
export function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
const luma = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;

// ---------------------------------------------------------------------------
// Sun and moon

// Daylight per season (core.Season 0 spring … 3 winter): hours of daylight, the noon
// sun's elevation in degrees. Solar noon sits at 12:45 so the evening stays long
// and golden, matching the day phases of core.PhaseAt (Evening 18:00–21:30).
const SEASON_SUN = [
  { len: 14.5, peak: 52 }, // spring: 05:30 – 20:00
  { len: 16.5, peak: 62 }, // summer: 04:30 – 21:00
  { len: 13.0, peak: 40 }, // autumn: 06:15 – 19:15
  { len: 11.5, peak: 26 }, // winter: 07:00 – 18:30
];
const NOON = 12.75;
const NIGHT_DEPTH = 34; // how far (degrees) the sun dips below the horizon at midnight

const wrapHour = (h) => ((h % 24) + 24) % 24;
const seasonIdx = (s) => ((Math.round(+s || 0) % 4) + 4) % 4;

/** Sunrise and sunset hours for a season. */
export function sunTimes(season) {
  const { len } = SEASON_SUN[seasonIdx(season)];
  return { rise: NOON - len / 2, set: NOON + len / 2, len };
}

/**
 * Sun position for an hour of day and season.
 * The sun rises in the east, crosses the southern sky at noon and sets in the west;
 * at night it continues below the horizon through the north so every quantity is
 * continuous over the whole day.
 * @returns {{elevation:number, azimuth:number, dir:number[]}} radians; azimuth is a
 *   compass heading; dir is the unit vector pointing at the sun.
 */
export function sunPosition(hour, season) {
  const h = wrapHour(+hour || 0);
  const { rise, set, len } = sunTimes(season);
  const peak = SEASON_SUN[seasonIdx(season)].peak * DEG;
  let elevation, azimuth;
  if (h >= rise && h <= set) {
    const u = (h - rise) / len;
    elevation = peak * Math.sin(Math.PI * u);
    azimuth = Math.PI / 2 + Math.PI * u; // east → south → west
  } else {
    const nightLen = 24 - len;
    const u = wrapHour(h - set) / nightLen;
    elevation = -NIGHT_DEPTH * DEG * Math.sin(Math.PI * u);
    azimuth = 1.5 * Math.PI + Math.PI * u; // west → north → east
  }
  return { elevation, azimuth: azimuth % TAU, dir: dirFrom(azimuth, elevation) };
}

/** Unit vector for a compass heading and an elevation angle. */
export function dirFrom(azimuth, elevation) {
  const c = Math.cos(elevation);
  return [c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth)];
}

/**
 * The moon rides roughly opposite the sun (a full-ish moon every night keeps nights
 * readable), a little lower and offset so it is not a mirror image.
 */
export function moonPosition(hour, season) {
  const s = sunPosition(hour, season);
  const elevation = -s.elevation * 0.85 + 4 * DEG;
  const azimuth = (s.azimuth + Math.PI + 0.35) % TAU;
  return { elevation, azimuth, dir: dirFrom(azimuth, elevation) };
}

/** Moon phase 0..1 (0 new, 0.5 full) from the day counter; one cycle per 16-day year. */
export function moonPhase(day) {
  const p = ((((+day || 1) - 1) / 16) + 0.5) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Daylight 0..1 from the sun elevation (radians) and cloud cover: 0 deep night,
 * 1 bright midday. Heavy cloud dims it by up to a third.
 */
export function daylight(elevation, cloud = 0) {
  const d = smoothstep(-12 * DEG, 30 * DEG, elevation);
  return clamp(d * (1 - 0.32 * clamp(cloud)));
}

/** Star visibility 0..1: only once the sun is well down, hidden by cloud. */
export function starVisibility(elevation, cloud = 0) {
  return (1 - smoothstep(-12 * DEG, -2 * DEG, elevation)) * (1 - smoothstep(0.35, 0.85, cloud));
}

// ---------------------------------------------------------------------------
// Sky colour keys

// Keyed by sun elevation in degrees. `zen` is the sky overhead, `hor` the horizon
// band (also the base fog colour), `sun` the sun light colour, `glow` the halo
// around the sun. Pre-dawn and dusk share the elevations, so a separate warm table
// is blended in for the evening (the brief asks for a cool pre-dawn and warm
// golden dawn/evening light).
const KEYS = [
  { e: -90, zen: 0x0a1228, hor: 0x1a2747, sun: 0x8aa2d8, glow: 0x1a2747 },
  { e: -14, zen: 0x101b3a, hor: 0x2a3a62, sun: 0x8aa2d8, glow: 0x2a3a62 },
  { e: -6, zen: 0x22305c, hor: 0x5b6188, sun: 0x9aa6d0, glow: 0x7c6f8e },
  { e: -1.5, zen: 0x3a4f86, hor: 0xb89a9e, sun: 0xffa36b, glow: 0xf09a70 },
  { e: 3, zen: 0x5577b0, hor: 0xf2b37a, sun: 0xffb36e, glow: 0xffb070 },
  { e: 10, zen: 0x5b8ccb, hor: 0xf1d0a2, sun: 0xffd19a, glow: 0xffd6a0 },
  { e: 22, zen: 0x4f8bd2, hor: 0xc8dfea, sun: 0xfff0d8, glow: 0xfff2dc },
  { e: 90, zen: 0x3f80d0, hor: 0xb9d8ee, sun: 0xfff8ec, glow: 0xffffff },
];
const EVENING = [
  { e: -90, zen: 0x0b1229, hor: 0x1c2645, sun: 0x8aa2d8, glow: 0x1c2645 },
  { e: -14, zen: 0x141b3c, hor: 0x312f5a, sun: 0x8aa2d8, glow: 0x312f5a },
  { e: -6, zen: 0x2b2d5e, hor: 0x8a5f7a, sun: 0xb08aa8, glow: 0xa06a7c },
  { e: -1.5, zen: 0x46508a, hor: 0xe08f6e, sun: 0xff8f55, glow: 0xff8a55 },
  { e: 3, zen: 0x5d76ad, hor: 0xf7a866, sun: 0xffa458, glow: 0xffa05a },
  { e: 10, zen: 0x5a88c6, hor: 0xf4c890, sun: 0xffc887, glow: 0xffcc8c },
  { e: 22, zen: 0x4f8bd2, hor: 0xc8dfea, sun: 0xfff0d8, glow: 0xfff2dc },
  { e: 90, zen: 0x3f80d0, hor: 0xb9d8ee, sun: 0xfff8ec, glow: 0xffffff },
];
const toRgbKeys = (t) => t.map((k) => ({ e: k.e, zen: rgb(k.zen), hor: rgb(k.hor), sun: rgb(k.sun), glow: rgb(k.glow) }));
const KEYS_RGB = toRgbKeys(KEYS);
const EVENING_RGB = toRgbKeys(EVENING);

function sampleKeys(keys, eDeg, field, out) {
  if (eDeg <= keys[0].e) return mix3(keys[0][field], keys[0][field], 0, out);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (eDeg <= b.e) {
      const a = keys[i - 1];
      return mix3(a[field], b[field], smoothstep(0, 1, (eDeg - a.e) / (b.e - a.e)), out);
    }
  }
  const last = keys[keys.length - 1];
  return mix3(last[field], last[field], 0, out);
}

// Region atmosphere: a haze colour mixed into the horizon/fog, a tint on the sun,
// how much it applies, a fog distance multiplier and precipitation character.
const ATMO = {
  [REGION.GREENHOLLOW]: { haze: 0xcfe0c8, hazeAmt: 0.06, sunTint: 0xfff6e6, tintAmt: 0, fog: 1, snow: 0, leaves: 1, cold: 0 },
  [REGION.MARSH]: { haze: 0xc9d6c4, hazeAmt: 0.16, sunTint: 0xfff2dc, tintAmt: 0.05, fog: 0.85, snow: 0, leaves: 0.25, cold: 0 },
  [REGION.WINDPEAK]: { haze: 0xc4d2e2, hazeAmt: 0.08, sunTint: 0xf4f6ff, tintAmt: 0.08, fog: 1.12, snow: 0, leaves: 0.2, cold: 0.25 },
  [REGION.COAST]: { haze: 0xd6e2e6, hazeAmt: 0.14, sunTint: 0xfff8f0, tintAmt: 0.04, fog: 0.95, snow: 0, leaves: 0.15, cold: 0.1 },
  [REGION.AMBERWOOD]: { haze: 0xe9b47a, hazeAmt: 0.28, sunTint: 0xffc98a, tintAmt: 0.22, fog: 0.88, snow: 0, leaves: 1.6, cold: 0 },
  [REGION.FROSTVEIL]: { haze: 0xd2e2f2, hazeAmt: 0.3, sunTint: 0xdce8ff, tintAmt: 0.3, fog: 0.8, snow: 1, leaves: 0, cold: 1 },
};
const ATMO_RGB = {};
for (const [k, a] of Object.entries(ATMO)) {
  ATMO_RGB[k] = Object.freeze({ ...a, haze: rgb(a.haze), sunTint: rgb(a.sunTint) });
}

/**
 * Atmosphere parameters for a region type (255/unknown → Greenhollow).
 * @returns {{haze:number[], hazeAmt:number, sunTint:number[], tintAmt:number,
 *   fog:number, snow:number, leaves:number, cold:number}}
 */
export function regionAtmosphere(region) {
  return ATMO_RGB[region] || ATMO_RGB[REGION.GREENHOLLOW];
}

/** Blends two atmosphere records (for smooth region transitions). */
export function mixAtmosphere(a, b, t, out) {
  const o = out || { haze: [0, 0, 0], sunTint: [0, 0, 0] };
  mix3(a.haze, b.haze, t, o.haze);
  mix3(a.sunTint, b.sunTint, t, o.sunTint);
  for (const k of ['hazeAmt', 'tintAmt', 'fog', 'snow', 'leaves', 'cold']) o[k] = lerp(a[k], b[k], t);
  return o;
}

// Season colour drift applied on top of the keys: spring fresh, summer neutral,
// autumn warm, winter pale and cool.
const SEASON_TINT = [
  { c: rgb(0xe8f4e0), amt: 0.04 },
  { c: rgb(0xffffff), amt: 0 },
  { c: rgb(0xf3d2a4), amt: 0.08 },
  { c: rgb(0xdfe8f4), amt: 0.12 },
];

const GREY_DAY = rgb(0xaeb6bd);
const GREY_NIGHT = rgb(0x262c3a);

/**
 * All sky colours for a moment.
 * @param {object} p
 * @param {number} p.hour     0..24
 * @param {number} p.season   core.Season
 * @param {number} [p.cloud]  0..1
 * @param {number} [p.rain]   0..1
 * @param {number} [p.mist]   0..1
 * @param {object} [p.atmo]   regionAtmosphere(...) or a mixAtmosphere result
 * @returns {{zenith:number[], horizon:number[], fog:number[], sun:number[], glow:number[],
 *   ground:number[], hemiSky:number[], hemiGround:number[], elevation:number,
 *   daylight:number, sunIntensity:number, hemiIntensity:number, moonIntensity:number,
 *   moonLight:number[], exposure:number, stars:number}}
 */
export function skyColors(p) {
  const hour = +p.hour || 0;
  const cloud = clamp(+p.cloud || 0);
  const rain = clamp(+p.rain || 0);
  const mist = clamp(+p.mist || 0);
  const atmo = p.atmo || regionAtmosphere(REGION.GREENHOLLOW);
  const sun = sunPosition(hour, p.season);
  const eDeg = sun.elevation / DEG;
  // Afternoon/evening use the warm table; blend across midday so nothing pops.
  const evening = smoothstep(11.5, 15.5, wrapHour(hour)) * (1 - smoothstep(23, 23.9, wrapHour(hour)));

  const zenith = mix3(sampleKeys(KEYS_RGB, eDeg, 'zen', [0, 0, 0]), sampleKeys(EVENING_RGB, eDeg, 'zen', [0, 0, 0]), evening);
  const horizon = mix3(sampleKeys(KEYS_RGB, eDeg, 'hor', [0, 0, 0]), sampleKeys(EVENING_RGB, eDeg, 'hor', [0, 0, 0]), evening);
  const sunCol = mix3(sampleKeys(KEYS_RGB, eDeg, 'sun', [0, 0, 0]), sampleKeys(EVENING_RGB, eDeg, 'sun', [0, 0, 0]), evening);
  const glow = mix3(sampleKeys(KEYS_RGB, eDeg, 'glow', [0, 0, 0]), sampleKeys(EVENING_RGB, eDeg, 'glow', [0, 0, 0]), evening);

  const day = daylight(sun.elevation, 0);
  // Overcast: pull towards a grey of similar brightness (darker at night).
  const overcast = clamp(cloud * 0.75 + rain * 0.35);
  const grey = mix3(GREY_NIGHT, GREY_DAY, day, [0, 0, 0]);
  mix3(zenith, mix3(grey, zenith, 0.25, [0, 0, 0]), overcast * 0.85, zenith);
  mix3(horizon, mix3(grey, horizon, 0.35, [0, 0, 0]), overcast * 0.75, horizon);
  mix3(glow, horizon, overcast * 0.8, glow);

  // Season and region tints.
  const st = SEASON_TINT[seasonIdx(p.season)];
  const tintDay = st.amt * (0.3 + 0.7 * day);
  mix3(horizon, mulc(horizon, st.c), tintDay, horizon);
  mix3(zenith, mulc(zenith, st.c), tintDay * 0.6, zenith);
  const hazeAmt = atmo.hazeAmt * (0.25 + 0.75 * day);
  mix3(horizon, mix3(atmo.haze, horizon, 1 - luma(horizon), [0, 0, 0]), hazeAmt, horizon);
  mix3(zenith, atmo.haze, hazeAmt * 0.25, zenith);
  mix3(sunCol, mulc(sunCol, atmo.sunTint), clamp(atmo.tintAmt * 2), sunCol);

  // Fog sits between the horizon colour and the sky above it; mist whitens it a
  // little by day so mornings read as soft, not murky.
  const fog = mix3(horizon, zenith, 0.12, [0, 0, 0]);
  mix3(fog, mix3(rgb(0xdfe4e2), fog, 1 - day, [0, 0, 0]), mist * 0.35, fog);

  const groundBase = mix3(rgb(0x1c2418), rgb(0x6f6a4f), day, [0, 0, 0]);
  const ground = mix3(groundBase, fog, 0.45, [0, 0, 0]);

  // Lights. Never pitch black: the hemisphere keeps a cool floor at night.
  const sunUp = smoothstep(-3 * DEG, 8 * DEG, sun.elevation);
  const sunIntensity = sunUp * lerp(0.6, 2.6, smoothstep(0, 35 * DEG, sun.elevation)) * (1 - 0.62 * overcast);
  // Generous sky/bounce fill: faces turned away from the sun must stay readable and
  // soft (the look is cozy and stylised, never black).
  const hemiIntensity = lerp(0.9, 1.7, day) * (1 - 0.12 * overcast) + 0.3 * overcast * day;
  const hemiSky = mix3(rgb(0x51628f), mix3(zenith, horizon, 0.45, [0, 0, 0]), smoothstep(0, 0.4, day), [0, 0, 0]);
  mix3(hemiSky, rgb(0xffffff), 0.12, hemiSky);
  const hemiGround = mix3(rgb(0x3d4556), mix3(rgb(0x9a9870), ground, 0.3, [0, 0, 0]), day, [0, 0, 0]);
  const moon = moonPosition(hour, p.season);
  const moonIntensity = (1 - sunUp) * smoothstep(-2 * DEG, 15 * DEG, moon.elevation) * 0.55 * (1 - 0.6 * overcast);
  const moonLight = mix3(rgb(0x9fb4e6), atmo.haze, atmo.cold * 0.2, [0, 0, 0]);
  // Lift exposure at night so it stays readable and cozy.
  const exposure = lerp(1.4, 1.1, smoothstep(0, 0.6, day)) * (1 + 0.06 * overcast);

  return {
    zenith, horizon, fog, sun: sunCol, glow, ground, hemiSky, hemiGround,
    elevation: sun.elevation, daylight: daylight(sun.elevation, cloud),
    sunIntensity, hemiIntensity, moonIntensity, moonLight, exposure,
    stars: starVisibility(sun.elevation, cloud),
  };
}
function mulc(a, b) { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; }

// ---------------------------------------------------------------------------
// Particles

// Leaf mote colours per season (two to vary between) and how many fly about.
const LEAF_SEASON = [
  { a: rgb(0xf3c6d6), b: rgb(0x9ccc68), amt: 0.45 }, // spring: blossom petals + fresh leaves
  { a: rgb(0x6fa548), b: rgb(0x8fbf5a), amt: 0.35 },
  { a: rgb(0xe0a33a), b: rgb(0xc2582c), amt: 1 },
  { a: rgb(0x9a8a66), b: rgb(0x7f6e50), amt: 0.2 },
];
const AMBER_LEAVES = { a: rgb(0xf0b040), b: rgb(0xd0602c) };

/**
 * Precipitation and mote amounts (0..1 each) for the moment.
 * Frostveil turns rain into snowfall (and has light flurries under any cloud);
 * elsewhere a winter downpour falls partly as snow. Leaves follow wind × season ×
 * region (Amberwood always sheds gold and rust). Rain and leaves thin out under
 * canopy, where the crowns catch them.
 * @returns {{rain:number, snow:number, leaves:number, leafA:number[], leafB:number[]}}
 */
export function particleAmounts({ rain = 0, cloud = 0, wind = 0, season = 0, canopy = 0, atmo }) {
  const a = atmo || regionAtmosphere(REGION.GREENHOLLOW);
  const s = seasonIdx(season);
  const cold = clamp(a.snow + (s === 3 ? 0.5 : 0));
  const snowFromRain = clamp(rain) * cold;
  const flurries = a.snow * smoothstep(0.45, 0.9, cloud) * 0.45;
  const under = 1 - 0.85 * clamp(canopy);
  const lc = LEAF_SEASON[s];
  const amberT = clamp((a.leaves - 1) / 0.6);
  const leafA = mix3(lc.a, AMBER_LEAVES.a, amberT, [0, 0, 0]);
  const leafB = mix3(lc.b, AMBER_LEAVES.b, amberT, [0, 0, 0]);
  const leafAmt = Math.max(lc.amt, amberT) * Math.min(1, a.leaves) * smoothstep(0.08, 0.7, wind);
  return {
    rain: clamp(rain * (1 - cold)) * under,
    snow: clamp(Math.max(snowFromRain, flurries)) * (1 - 0.5 * clamp(canopy)),
    leaves: clamp(leafAmt * (1 - 0.6 * clamp(rain))),
    leafA, leafB,
  };
}

// ---------------------------------------------------------------------------
// Fog

/** View distance in metres by quality (chunk ring radius × 64 m, see js/world). */
export function viewDistance(quality) {
  const radius = quality === 'high' ? 10 : quality === 'low' ? 5 : 7;
  return (radius - 0.6) * 64;
}

/**
 * Linear fog range. Terrain must be fully faded into the fog (= sky horizon) colour
 * just before the edge of the loaded world, so far hills melt into the sky instead
 * of ending in a hard line. Mist and rain pull the fog in; regions scale it.
 * @returns {{near:number, far:number}}
 */
export function fogRange(viewDist, { mist = 0, rain = 0, cloud = 0, regionFog = 1 } = {}) {
  const edge = viewDist * 0.97;
  const weather = 1 - 0.72 * clamp(mist) - 0.42 * clamp(rain) - 0.08 * clamp(cloud);
  const far = Math.max(70, Math.min(edge, edge * Math.max(0.12, weather) * regionFog));
  const near = far * lerp(0.32, 0.04, clamp(mist + rain * 0.5));
  return { near, far };
}

// ---------------------------------------------------------------------------
// Env interpolation

/** Signed shortest difference b − a between two hours on the 24 h clock. */
export function hourDiff(a, b) {
  let d = wrapHour(b) - wrapHour(a);
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}

const EASED = ['wind', 'rain', 'mist', 'cloud', 'light'];

/**
 * Smooths the server's 1 Hz env updates. The clock is advanced locally at the
 * server's rate (24 h per dayLen seconds) and nudged towards each new reading;
 * large jumps (resting, debug) snap. Weather scalars ease exponentially.
 */
export class EnvInterp {
  constructor() {
    this.cur = { time: 6.5, day: 1, season: 0, weather: 0, wind: 0, rain: 0, mist: 0, cloud: 0, light: 0.5 };
    this.target = { ...this.cur };
    this.dayLen = 1440;
    this.timeErr = 0;
    this.ready = false;
  }

  /** Feeds a new EnvMsg. */
  set(env) {
    if (!env || typeof env !== 'object') return;
    const t = this.target;
    for (const k of EASED) if (Number.isFinite(env[k])) t[k] = env[k];
    if (Number.isFinite(env.day)) t.day = env.day;
    if (Number.isFinite(env.season)) t.season = env.season;
    if (Number.isFinite(env.weather)) t.weather = env.weather;
    if (Number.isFinite(env.dayLen) && env.dayLen > 0) this.dayLen = env.dayLen;
    if (Number.isFinite(env.time)) {
      t.time = wrapHour(env.time);
      const d = hourDiff(this.cur.time, t.time);
      if (!this.ready || Math.abs(d) > 0.5) { this.cur.time = t.time; this.timeErr = 0; } else this.timeErr = d;
    }
    this.cur.day = t.day; this.cur.season = t.season; this.cur.weather = t.weather;
    if (!this.ready) {
      for (const k of EASED) this.cur[k] = t[k];
      this.ready = true;
    }
  }

  /** Advances by dt seconds; returns this.cur. */
  step(dt) {
    const c = this.cur;
    if (!(dt > 0)) return c;
    const rate = 24 / this.dayLen;
    // Bleed the clock error away over ~1 s on top of the normal advance.
    const fix = this.timeErr * Math.min(1, dt * 1.5);
    this.timeErr -= fix;
    c.time = wrapHour(c.time + rate * dt + fix);
    this.target.time = wrapHour(this.target.time + rate * dt);
    const k = 1 - Math.exp(-dt / 1.6);
    for (const f of EASED) c[f] += (this.target[f] - c[f]) * k;
    return c;
  }
}
