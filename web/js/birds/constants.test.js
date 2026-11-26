// The wire constants are copied from Go; these tests read the Go sources so a change
// there (append-only, but still) is caught here instead of as silently wrong birds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ACT, ACT_COUNT, ACT_KEYS, FLAG, SNAP, TICK_HZ, isAirborneAct,
  BILL_SHAPES, TAIL_SHAPES, WING_SHAPES, MARK_KINDS, FLIGHT_STYLES, GROUND_MODES,
} from './constants.js';

const read = (rel) => {
  try { return fs.readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch { return null; }
};
const simGo = read('../../../internal/core/sim.go');
const catalogGo = read('../../../internal/species/catalog.go');
const protoGo = read('../../../internal/proto/messages.go');
const typesGo = read('../../../internal/core/types.go');

test('ACT values follow the core.BirdAct iota order', { skip: !simGo && 'Go sources not present' }, () => {
  const block = simGo.slice(simGo.search(/ActPerched\s+BirdAct = iota/), simGo.indexOf('ActCount'));
  const names = [...block.matchAll(/^\s*Act([A-Za-z]+)/gm)].map((m) => m[1].toUpperCase());
  assert.equal(names.length, ACT_COUNT);
  names.forEach((n, i) => assert.equal(ACT[n], i, `ACT.${n}`));
});

test('ACT_KEYS match core actKeys', { skip: !simGo && 'Go sources not present' }, () => {
  const m = simGo.match(/var actKeys = \[\.\.\.\]string\{([^}]*)\}/);
  const keys = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...ACT_KEYS], keys);
});

test('FLAG bits follow the core Flag* iota order', { skip: !simGo && 'Go sources not present' }, () => {
  const block = simGo.slice(simGo.search(/FlagSinging\s+uint8/), simGo.indexOf('// BirdState'));
  const names = [...block.matchAll(/^\s*Flag([A-Za-z]+)/gm)].map((m) => m[1]);
  const map = { Singing: 'SINGING', Wary: 'WARY', Hidden: 'HIDDEN', RarePlumage: 'RARE_PLUMAGE', Vagrant: 'VAGRANT', Habituated: 'HABITUATED' };
  assert.equal(names.length, Object.keys(FLAG).length);
  names.forEach((n, i) => assert.equal(FLAG[map[n]], 1 << i, n));
});

test('Airborne mirrors core.BirdAct.Airborne', { skip: !simGo && 'Go sources not present' }, () => {
  const m = simGo.match(/func \(a BirdAct\) Airborne\(\) bool \{[\s\S]*?case ([^:]+):/);
  const air = m[1].split(',').map((s) => s.trim().replace('Act', '').toUpperCase());
  for (let a = 0; a < ACT_COUNT; a++) {
    const name = Object.keys(ACT).find((k) => ACT[k] === a);
    assert.equal(isAirborneAct(a), air.includes(name), name);
  }
});

test('snapshot layout matches proto.BirdsMsg', { skip: !protoGo && 'Go sources not present' }, () => {
  assert.match(protoGo, /\[id, speciesIndex, act, flags, x, y, z, yaw, speed\]/);
  assert.deepEqual([SNAP.ID, SNAP.SP, SNAP.ACT, SNAP.FLAGS, SNAP.X, SNAP.Y, SNAP.Z, SNAP.YAW, SNAP.SPEED, SNAP.LEN], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(protoGo, /B\s+\[\]\[\]float32 `json:"b"`/);
  assert.match(protoGo, /Tick uint32\s+`json:"tick"`/);
});

test('TICK_HZ matches core.TickHz', { skip: !typesGo && 'Go sources not present' }, () => {
  assert.equal(Number(typesGo.match(/TickHz\s*=\s*(\d+)/)[1]), TICK_HZ);
});

test('appearance vocabulary matches species.Validate', { skip: !catalogGo && 'Go sources not present' }, () => {
  const list = (field) => {
    const m = catalogGo.match(new RegExp(`in\\(${field.replace('.', '\\.')},([^)]*)\\)`));
    return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  };
  assert.deepEqual([...TAIL_SHAPES], list('l.TailShape'));
  assert.deepEqual([...BILL_SHAPES], list('l.BillShape'));
  assert.deepEqual([...WING_SHAPES], list('l.WingShape'));
  assert.deepEqual([...MARK_KINDS], list('m.Kind'));
  assert.deepEqual([...FLIGHT_STYLES], list('sp.Move.Flight'));
  assert.deepEqual([...GROUND_MODES], list('sp.Move.Ground'));
});
