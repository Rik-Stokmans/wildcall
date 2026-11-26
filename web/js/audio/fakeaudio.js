// A strict, minimal fake of the Web Audio API for node tests of the engine wiring.
// It validates what real browsers reject (non-finite values, exponential ramps to
// values <= 0, starting a source twice, connecting to non-nodes) and counts nodes so
// tests can check that voices are released. Test-only: nothing in the game imports it.

let liveSources = 0;
export const stats = { created: 0, started: 0, get liveSources() { return liveSources; } };

class FakeParam {
  constructor(v = 0) { this._v = v; this.events = 0; }
  get value() { return this._v; }
  set value(v) { finite(v, 'value'); this._v = v; }
  setValueAtTime(v, t) { finite(v, 'setValueAtTime'); finite(t, 't'); this._v = v; this.events++; return this; }
  linearRampToValueAtTime(v, t) { finite(v, 'linearRamp'); finite(t, 't'); this._v = v; this.events++; return this; }
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'expRamp'); finite(t, 't');
    if (v <= 0) throw new RangeError('exponentialRampToValueAtTime: value must be > 0');
    this._v = v; this.events++; return this;
  }
  setTargetAtTime(v, t, tc) {
    finite(v, 'setTarget'); finite(t, 't'); finite(tc, 'tc');
    if (tc < 0) throw new RangeError('timeConstant must be >= 0');
    this._v = v; this.events++; return this;
  }
  cancelScheduledValues(t) { finite(t, 't'); return this; }
}

function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: non-finite ${v}`);
}

class FakeNode {
  constructor(ctx) { this.context = ctx; this.outputs = new Set(); stats.created++; }
  connect(dest) {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError('connect: bad destination');
    this.outputs.add(dest);
    return dest;
  }
  disconnect() { this.outputs.clear(); }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this._started = false; this._stopped = false; this.onended = null; this._listeners = [];
  }
  start(t = 0, offset, dur) {
    finite(t, 'start');
    if (offset !== undefined) finite(offset, 'start offset');
    if (dur !== undefined) finite(dur, 'start duration');
    this.startArgs = [t, offset, dur];
    if (this._started) throw new Error('InvalidStateError: start called twice');
    this._started = true; liveSources++; stats.started++;
    this.context._sources.add(this);
  }
  stop(t = 0) {
    finite(t, 'stop');
    if (!this._started) throw new Error('InvalidStateError: stop before start');
    this._stopAt = Math.min(this._stopAt ?? Infinity, t);
  }
  addEventListener(type, fn) { if (type === 'ended') this._listeners.push(fn); }
  _end() {
    if (this._stopped) return;
    this._stopped = true; liveSources--;
    this.onended?.();
    for (const fn of this._listeners) fn();
  }
}

export class FakeAudioContext {
  constructor() {
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.state = 'suspended';
    this.onstatechange = null;
    this._sources = new Set();
    this.destination = new FakeNode(this);
    const P = () => new FakeParam(0);
    this.listener = {
      positionX: P(), positionY: P(), positionZ: P(),
      forwardX: P(), forwardY: P(), forwardZ: P(), upX: P(), upY: P(), upZ: P(),
    };
  }
  resume() { this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  /** Test helper: advance time and end the sources whose stop time has passed. */
  advance(dt) {
    this.currentTime += dt;
    for (const s of [...this._sources]) {
      if (s._stopAt !== undefined && s._stopAt <= this.currentTime) { this._sources.delete(s); s._end(); }
    }
  }
  createGain() { const n = new FakeNode(this); n.gain = new FakeParam(1); return n; }
  createBiquadFilter() {
    const n = new FakeNode(this);
    n.type = 'lowpass'; n.frequency = new FakeParam(350); n.Q = new FakeParam(1); n.gain = new FakeParam(0);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this);
    n.type = 'sine'; n.frequency = new FakeParam(440); n.detune = new FakeParam(0);
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this);
    n.buffer = null; n.loop = false; n.playbackRate = new FakeParam(1);
    return n;
  }
  createBuffer(ch, len, sr) {
    finite(len, 'len');
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
  }
  /** Test stand-in for decoding: `bytes` of length n decode to n/100 seconds of silence; "bad" fails. */
  decodeAudioData(bytes) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 100) return Promise.reject(new Error('EncodingError'));
    return Promise.resolve(this.createBuffer(1, Math.round((bytes.byteLength / 100) * this.sampleRate), this.sampleRate));
  }
  createPanner() {
    const n = new FakeNode(this);
    n.positionX = new FakeParam(); n.positionY = new FakeParam(); n.positionZ = new FakeParam();
    n.panningModel = 'equalpower'; n.distanceModel = 'inverse'; n.refDistance = 1; n.rolloffFactor = 1; n.maxDistance = 10000;
    return n;
  }
  createWaveShaper() { const n = new FakeNode(this); n.curve = null; n.oversample = 'none'; return n; }
  createStereoPanner() { const n = new FakeNode(this); n.pan = new FakeParam(0); return n; }
  createConvolver() { const n = new FakeNode(this); n.buffer = null; n.normalize = true; return n; }
  createDelay() { const n = new FakeNode(this); n.delayTime = new FakeParam(0); return n; }
  createDynamicsCompressor() {
    const n = new FakeNode(this);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0);
    return n;
  }
  createAnalyser() {
    const n = new FakeNode(this);
    n.fftSize = 2048; n.smoothingTimeConstant = 0.8; n.minDecibels = -100; n.maxDecibels = -30;
    n.getByteFrequencyData = (a) => a.fill(0);
    n.getFloatTimeDomainData = (a) => a.fill(0.01);
    return n;
  }
}
