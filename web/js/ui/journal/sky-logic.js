import { weatherSlow } from '../../player/mantle.js';

// Pure logic for the Weather & Time page of the journal (spec §20, screen 19): the day
// phases and what wildlife does in each, plain-language weather effects, and the forecast
// the player's Weather Sense allows. No DOM.
//
// The effect lines follow what the simulation really does (internal/core Env.WeatherNoise,
// internal/field clarity + photo scoring, internal/eco rare-species gates and vagrants),
// so the page never promises something the world will not deliver.

/** Day phases (internal/core/sim.go PhaseAt) with spec §20.1's wildlife activity. */
export const DAY_PHASES = [
  { id: 'Dawn', from: 4.5, to: 7, icon: 'dawn', activity: 'High vocal activity', more: 'The dawn chorus: the best hour to hear birds you have never seen.' },
  { id: 'Morning', from: 7, to: 11, icon: 'sunny', activity: 'Feeding and movement', more: 'Birds are busy feeding and easy to watch.' },
  { id: 'Midday', from: 11, to: 14, icon: 'sunny', activity: 'Reduced activity', more: 'A quiet spell: many birds rest in cover.' },
  { id: 'Afternoon', from: 14, to: 18, icon: 'cloudy', activity: 'Increased movement', more: 'Things stir again; good light for photographs.' },
  { id: 'Evening', from: 18, to: 21.5, icon: 'dawn', activity: 'Calls and returning activity', more: 'Birds call as they head back to roost.' },
  { id: 'Night', from: 21.5, to: 4.5, icon: 'moon', activity: 'Nocturnal wildlife', more: 'Owls and other night birds. Optics struggle without low-light gear.' },
];

/** Index into DAY_PHASES for an hour of day (0..24). */
export function phaseIndexAt(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h >= 4.5 && h < 7) return 0;
  if (h >= 7 && h < 11) return 1;
  if (h >= 11 && h < 14) return 2;
  if (h >= 14 && h < 18) return 3;
  if (h >= 18 && h < 21.5) return 4;
  return 5;
}

/** Phase index by the server's phase name, falling back to the hour. */
export function currentPhase(env) {
  const byName = DAY_PHASES.findIndex((p) => p.id === env?.phase);
  return byName >= 0 ? byName : phaseIndexAt(env?.time ?? 12);
}

/** Hours until the next phase starts (0..24). */
export function hoursToNextPhase(hour) {
  const i = phaseIndexAt(hour);
  const next = DAY_PHASES[(i + 1) % DAY_PHASES.length].from;
  const h = ((Number(hour) % 24) + 24) % 24;
  return ((next - h) % 24 + 24) % 24;
}

/** "about 2 h" / "under an hour". */
export function hoursText(h) {
  if (!(h > 0)) return '';
  if (h < 1) return 'under an hour';
  return `about ${Math.round(h)} h`;
}

const word = (v, steps) => { for (const [lim, w] of steps) if (v <= lim) return w; return steps[steps.length - 1][1]; };
export const windWord = (v) => word(v || 0, [[0.12, 'Still'], [0.3, 'Light breeze'], [0.55, 'Breezy'], [0.8, 'Windy'], [1, 'Gale']]);
export const rainWord = (v) => word(v || 0, [[0.02, 'Dry'], [0.25, 'Drizzle'], [0.6, 'Rain'], [1, 'Downpour']]);
export const mistWord = (v) => word(v || 0, [[0.1, 'Clear air'], [0.4, 'A little mist'], [1, 'Misty']]);
export const cloudWord = (v) => word(v || 0, [[0.15, 'Clear sky'], [0.5, 'Some cloud'], [0.85, 'Cloudy'], [1, 'Overcast']]);

/** Masking noise from weather (internal/core Env.WeatherNoise). */
export function weatherNoise(env) {
  return Math.min(1, (env?.wind || 0) * 0.45 + (env?.rain || 0) * 0.6);
}

/**
 * Plain-language effects of the current weather on the four things a naturalist cares
 * about. Each: {key, title, icon, tone: 'good'|'fair'|'poor', text}.
 * @param env    EnvMsg
 * @param stats  core.Stats (rainProof softens rain)
 */
export function weatherEffects(env, stats = {}) {
  const e = env || {};
  const rain = e.rain || 0, wind = e.wind || 0, mist = e.mist || 0, cloud = e.cloud || 0, light = e.light ?? 1;
  const proof = Math.max(0, Math.min(1, stats.rainProof || 0));
  const night = light < 0.15;
  const out = [];

  const noise = weatherNoise(e);
  out.push({
    key: 'hearing', title: 'Hearing', icon: 'ear',
    tone: noise < 0.15 ? 'good' : noise < 0.4 ? 'fair' : 'poor',
    text: noise < 0.15 ? 'Calm air: faint and distant calls carry well.'
      : noise < 0.4 ? `${rain > wind ? 'Rain patters' : 'The wind rustles'} enough to mask the faintest calls.`
        : `${rain > 0.3 ? 'Rain' : 'Wind'} drowns out quiet voices. Move closer and hold F to listen.`,
  });

  const rainCut = 0.45 * rain * (1 - proof);
  const seeLoss = rainCut + mist * 0.3 + (night ? 0.5 : 0);
  out.push({
    key: 'seeing', title: 'Seeing', icon: 'eye',
    tone: seeLoss < 0.12 ? 'good' : seeLoss < 0.35 ? 'fair' : 'poor',
    text: night ? 'Dark: birds are hard to make out without low-light optics.'
      : rain > 0.25 ? (proof >= 0.5 ? 'Rain, but your rain gear keeps the view clear enough.' : 'Rain blurs distant birds; details take longer to notice.')
        : mist > 0.4 ? 'Mist softens everything beyond a stone\'s throw.'
          : 'Good visibility: field marks are easy to pick out.',
  });

  const wet = rain > 0.25 || (e.weather === 2 && rain > 0.08);
  const golden = rain < 0.1 && cloud < 0.5 && ((e.time >= 5 && e.time < 8) || (e.time >= 17 && e.time < 20.5));
  const dull = cloud * 0.25 + rain * 0.35 + mist * 0.2;
  out.push({
    key: 'photo', title: 'Photography', icon: 'camera',
    tone: night ? 'poor' : wet ? 'fair' : golden ? 'good' : dull < 0.15 ? 'good' : dull < 0.3 ? 'fair' : 'poor',
    text: night ? 'Too dark for good photographs.'
      : golden ? 'Golden light: a lovely time for photographs.'
        : wet ? 'Rain softens the image and dulls the colours.'
          : cloud > 0.6 ? 'Soft, even light. No harsh shadows, but less sparkle.'
            : 'Bright, clear light for crisp photographs.',
  });

  const shy = rain > 0.25 || wind > 0.55;
  out.push({
    key: 'birds', title: 'Bird activity', icon: 'bird',
    tone: shy ? 'poor' : 'good',
    text: rain > 0.25 ? 'Birds shelter from the rain, and rare ones stay hidden. Afterwards, wanderers blown off course may turn up.'
      : wind > 0.55 ? 'Woodland birds keep low in the wind and rare ones hide; open-country birds do not mind. Strong winds can bring a vagrant.'
        : 'Settled weather: birds are out and about, and rare visitors may show themselves at their favourite hour.',
  });
  return out;
}

/** Is the player slowed by the weather (matches the player controller's rule)? */
export function weatherSlows(env, stats = {}) {
  return weatherSlow(env, stats.rainProof || 0) < 0.965;
}

/**
 * Forecast rows the player may see: slots starting within stats.forecast hours of now
 * (soonest first). Each {hour, weather, inHours}.
 */
export function forecastRows(forecast, now, hoursAllowed) {
  if (!(hoursAllowed > 0) || !Array.isArray(forecast)) return [];
  const rows = forecast.map((s) => ({ hour: s.hour, weather: s.weather, inHours: ((((s.hour - now) % 24) + 24) % 24) }));
  rows.sort((a, b) => a.inHours - b.inHours);
  const within = rows.filter((r) => r.inHours <= hoursAllowed);
  return within.length ? within : rows.slice(0, 1);
}

/** The forecast note under the list. */
export function forecastNote(hoursAllowed, total) {
  if (!(hoursAllowed > 0)) return 'You can only read the sky as it is now. The Weather Sense skill (Fieldcraft) lets you see what is coming.';
  if (hoursAllowed < 12 && total > 0) return `Weather Sense shows you ${Math.round(hoursAllowed)} hours ahead. Practising it further extends the forecast.`;
  return 'You read the sky half a day ahead.';
}

/** "Recorded voice" when a pregenerated narrator voice pack is playing, else "System voice". */
export function narratorVoiceLabel(narrator) {
  const p = narrator?.voicePack;
  return p && (p.lines > 0 || p.voice) ? 'Recorded voice' : 'System voice';
}
