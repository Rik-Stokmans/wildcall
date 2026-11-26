import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAT_INFO, STAT_GROUPS, formatStat, formatMod, statIsGood, statLabel, formatClock, formatCount, formatDuration,
  label, trimNumber, rarityName, rarityColor, clampRarity, tierNumeral, statsInGroup, RARITY_NAMES,
} from './format.js';
import * as kit from '../kit.js';

// Every json tag of core.Stats (internal/core/sim.go).
const CORE_STATS = `hearRange focusBonus dirAccuracy distAcc pitchInfo patternInfo habitatInfo noiseReduce clueSlots callMemory callRecognise
recRange recQuality recFocus spectrogram audioAssist binoZoom binoFov binoStability binoFocus binoClarity binoWeight lowLight
camZoom camStability camFocus camQuality camBurst camNoise camReady filmCap composition longLens momentBonus
observeSpeed nakedEye moveSense peripheral settle perchHint trackSigns instinct idAssist recognise journalInfo habitatKnow seasonKnow
behaviorInsight ecoKnow rareId stealth crouchBonus moveSpeed stamina terrain forecast trailSense camp familiarity rainProof
capacity compass mapDetail lensInspect xpMult creditMult discount`.split(/\s+/);

test('STAT_INFO covers every core.Stats field', () => {
  for (const k of CORE_STATS) {
    const i = STAT_INFO[k];
    assert.ok(i, `missing STAT_INFO.${k}`);
    assert.ok(i.label && i.group in STAT_GROUPS, `${k} needs a label and known group`);
    assert.ok(['high', 'low'].includes(i.better), `${k} better`);
    assert.ok(['×', '%', 'm', 's', 'kg', '', '/s', '°', 'h', 'flag', 'lvl'].includes(i.unit), `${k} unit ${i.unit}`);
  }
  for (const k of Object.keys(STAT_INFO)) assert.ok(CORE_STATS.includes(k), `STAT_INFO.${k} is not a core.Stats field`);
});

test('formatStat per unit', () => {
  assert.equal(formatStat('binoZoom', 8), '8×');
  assert.equal(formatStat('binoZoom', 7.5), '7.5×');
  assert.equal(formatStat('binoStability', 0.35), '35%');
  assert.equal(formatStat('binoWeight', 0.6), '0.6kg');
  assert.equal(formatStat('recRange', 25), '25m');
  assert.equal(formatStat('stamina', 6), '6s');
  assert.equal(formatStat('camBurst', 1.5), '1.5/s');
  assert.equal(formatStat('binoFov', 48), '48°');
  assert.equal(formatStat('forecast', 6), '6h');
  assert.equal(formatStat('capacity', 8), '8');
  assert.equal(formatStat('stealth', 0.85), '0.85×');
  assert.equal(formatStat('crouchBonus', 0.75), '0.75×');
  assert.equal(formatStat('pitchInfo', 1), 'Yes');
  assert.equal(formatStat('pitchInfo', 0), 'No');
  assert.equal(formatStat('audioAssist', 2), '2');
  assert.equal(formatStat('discount', 0.15), '15%');
  assert.equal(formatStat('unknownKey', 3.14159), '3.14');
  assert.equal(formatStat('binoZoom', NaN), '–');
  assert.equal(formatStat('binoZoom', undefined), '–');
});

test('formatMod is sign aware', () => {
  assert.equal(formatMod('binoZoom', 2), '+2×');
  assert.equal(formatMod('binoZoom', -1), '−1×');
  assert.equal(formatMod('binoStability', 0.1), '+10%');
  assert.equal(formatMod('binoStability', -0.05), '−5%');
  assert.equal(formatMod('stealth', -0.15), '−0.15×');
  assert.equal(formatMod('binoWeight', 0.4), '+0.4kg');
  assert.equal(formatMod('binoZoom', 0), '0×');
  assert.equal(formatMod('binoStability', 0.001), '0%', 'sub-display changes must not read as +0%');
  assert.equal(formatMod('pitchInfo', 1), 'Unlocks');
  assert.equal(formatMod('pitchInfo', -1), 'Removes');
  assert.equal(formatMod('x', Infinity), '–');
});

test('statIsGood honours the direction of each stat', () => {
  assert.equal(statIsGood('binoZoom', 1), true);
  assert.equal(statIsGood('binoZoom', -1), false);
  assert.equal(statIsGood('binoWeight', -0.2), true);
  assert.equal(statIsGood('binoWeight', 0.2), false);
  assert.equal(statIsGood('stealth', -0.1), true);
  assert.equal(statIsGood('camNoise', 0.1), false);
  assert.equal(statIsGood('camReady', -0.2), true);
  assert.equal(statIsGood('nothing', 1), true);
  assert.equal(statIsGood('binoWeight', 0), true);
});

test('statLabel and statsInGroup', () => {
  assert.equal(statLabel('binoZoom'), 'Magnification');
  assert.equal(statLabel('someNewStat'), 'Some new stat');
  assert.equal(statLabel('snake_case_stat'), 'Snake case stat');
  assert.ok(statsInGroup('optics').includes('binoZoom'));
  const grouped = Object.keys(STAT_GROUPS).flatMap(statsInGroup);
  assert.equal(grouped.length, Object.keys(STAT_INFO).length);
});

test('formatClock', () => {
  assert.equal(formatClock(13.5), '13:30');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(6.5), '06:30');
  assert.equal(formatClock(23.999), '23:59');
  assert.equal(formatClock(24), '00:00');
  assert.equal(formatClock(-1), '23:00');
  assert.equal(formatClock(12.25), '12:15');
  assert.equal(formatClock(NaN), '--:--');
});

test('label, counts and durations', () => {
  assert.equal(label('very high'), 'Very high');
  assert.equal(label('wing_bar'), 'Wing bar');
  assert.equal(label(''), '');
  assert.equal(label(null), '');
  assert.equal(label(0), '0');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount(undefined), '0');
  assert.equal(formatDuration(3725), '1h 02m');
  assert.equal(formatDuration(95), '1m 35s');
  assert.equal(formatDuration(-4), '0s');
  assert.equal(trimNumber(-0.001), '0');
  assert.equal(trimNumber(150.4), '150');
});

test('rarity helpers clamp', () => {
  assert.equal(rarityName(0), 'Common');
  assert.equal(rarityName(4), 'Legendary');
  assert.equal(rarityName(9), 'Legendary');
  assert.equal(rarityName(-3), 'Common');
  assert.equal(rarityName(undefined), 'Common');
  assert.equal(rarityColor(3), 'var(--rarity-3)');
  assert.equal(rarityColor(NaN), 'var(--rarity-0)');
  assert.equal(clampRarity('2'), 2);
  assert.equal(RARITY_NAMES.length, 5);
  assert.equal(tierNumeral(3), 'III');
  assert.equal(tierNumeral(9), 'IV');
});

test('kit.js re-exports the pinned names (no DOM needed to import it)', () => {
  for (const n of ['el', 'fill', 'icon', 'birdIllustration', 'RARITY_NAMES', 'rarityName', 'rarityColor', 'rarityBadge', 'button', 'tabs', 'panel',
    'progressBar', 'stars', 'STAT_INFO', 'formatStat', 'formatMod', 'statIsGood', 'itemCard', 'formatClock', 'SEASON_NAMES', 'WEATHER_NAMES',
    'WEATHER_ICONS', 'DISCOVERY_LEVELS', 'WILD_RARITY_NAMES', 'label', 'confirmDialog', 'tooltip']) {
    assert.ok(n in kit, `kit.${n} missing`);
  }
  assert.equal(kit.default.name, 'kit');
  const ctx = {};
  kit.default.init(ctx);
  assert.equal(ctx.kit.formatStat('binoZoom', 8), '8×');
  assert.equal(kit.SEASON_NAMES.length, 4);
  assert.deepEqual(kit.WEATHER_NAMES, ['Sunny', 'Cloudy', 'Rain', 'Wind']);
  assert.equal(kit.DISCOVERY_LEVELS[4], 'Identified');
});
