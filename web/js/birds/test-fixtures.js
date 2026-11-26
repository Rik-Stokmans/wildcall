// Shared fixtures for the birds module's node tests (not loaded by the game).

/** A plausible small songbird look; tests override single fields. */
export function look(over = {}) {
  return {
    length: 0.14, wingspan: 0.22, plump: 1.1, neck: 0.05, legs: 0.4, tail: 0.6, tailShape: 'square',
    bill: 0.45, billShape: 'thin', crest: false, wingShape: 'rounded',
    colors: { back: '#6b5a48', belly: '#e0d0b0', head: '#6b5a48', wing: '#5d4e3f', tail: '#5d4e3f', bill: '#333333', legs: '#8a7766', eye: '#111111' },
    marks: [], ...over,
  };
}

/** A species record around look(over); `extra` overrides top-level fields. */
export function species(over = {}, extra = {}) {
  return { look: look(over), move: { flight: 'direct', ground: 'hop', flapHz: 12 }, traits: { shape: 'songbird' }, ...extra };
}
