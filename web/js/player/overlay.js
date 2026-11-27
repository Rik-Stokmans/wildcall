// Tool overlays inside #tool-overlay (styled by css/tools.css, class prefix "tool-"):
// the soft twin-barrel binocular mask, the camera viewfinder, the recorder panel and the
// focused-listening vignette. DOM only; all numbers come from tools.js.
import { binoMask } from './optics.js';
import { formatTimer } from './field.js';

function div(cls, parent, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text != null) d.textContent = text;
  if (parent) parent.appendChild(d);
  return d;
}


export function createOverlay(root) {
  root = root || document.getElementById('tool-overlay') || document.body;

  // --- binoculars ---------------------------------------------------------
  const bino = div('tool-bino', root);
  const binoCanvas = document.createElement('canvas');
  binoCanvas.className = 'tool-bino-mask';
  bino.appendChild(binoCanvas);
  const binoTint = div('tool-bino-tint', bino);
  const binoZoom = div('tool-bino-zoom', bino);
  let maskKey = '';

  function drawMask(clarity) {
    const w = Math.max(1, Math.round(window.innerWidth / 2));
    const h = Math.max(1, Math.round(window.innerHeight / 2));
    const key = `${w}x${h}:${clarity.toFixed(2)}`;
    if (key === maskKey) return;
    maskKey = key;
    binoCanvas.width = w; binoCanvas.height = h;
    const g = binoCanvas.getContext('2d');
    const m = binoMask(clarity);
    const s = Math.min(w, h);
    const r = m.radius * s, f = m.feather * s, off = m.offset * s;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#0b0f0c';
    g.fillRect(0, 0, w, h);
    // Punch two feathered circles; overlapping barrels union naturally with
    // destination-out, giving the classic figure-of-eight view.
    g.globalCompositeOperation = 'destination-out';
    for (const cx of [w / 2 - off, w / 2 + off]) {
      const grad = g.createRadialGradient(cx, h / 2, Math.max(0, r - f), cx, h / 2, r + f * 0.35);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, h / 2, r + f, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  // --- camera viewfinder --------------------------------------------------
  const cam = div('tool-cam', root);
  const frame = div('tool-cam-frame', cam);
  for (const c of ['tl', 'tr', 'bl', 'br']) div('tool-cam-corner tool-cam-' + c, frame);
  const thirds = div('tool-cam-thirds', frame);
  for (let i = 0; i < 4; i++) div('tool-cam-third tool-cam-third-' + i, thirds);
  const brackets = div('tool-cam-brackets', frame);
  for (const c of ['tl', 'tr', 'bl', 'br']) div('tool-cam-bracket tool-cam-b' + c, brackets);
  const camInfo = div('tool-cam-info', cam);
  const camFilm = div('tool-cam-film', camInfo);
  const camZoom = div('tool-cam-zoom', camInfo);
  const camFocus = div('tool-cam-focus', camInfo);
  const camMsg = div('tool-cam-msg', cam);
  const shutter = div('tool-cam-shutter', cam);
  let msgTimer = 0;

  // --- recorder -----------------------------------------------------------
  const rec = div('tool-rec', root);
  const recHead = div('tool-rec-head', rec);
  div('tool-rec-dot', recHead);
  const recLabel = div('tool-rec-label', recHead, 'Recorder');
  const recTime = div('tool-rec-time', recHead, '0:00');
  const recBody = div('tool-rec-body', rec);
  const meter = div('tool-rec-meter', recBody);
  const bars = [];
  for (let i = 0; i < 16; i++) bars.push(div('tool-rec-bar', meter));
  const noiseMark = div('tool-rec-noise', meter);
  const dial = div('tool-rec-dial', recBody);
  div('tool-rec-dial-arc', dial);
  const needle = div('tool-rec-needle', dial);
  div('tool-rec-dial-label', dial, 'on-axis');
  const spectro = document.createElement('canvas');
  spectro.className = 'tool-rec-spectro';
  spectro.width = 220; spectro.height = 72;
  rec.appendChild(spectro);
  const recHint = div('tool-rec-hint', rec);

  // A message line for any tool (the camera's own line is hidden with its viewfinder,
  // so recorder and binocular messages used to vanish).
  const toolMsg = div('tool-cam-msg tool-msg', root);
  let toolMsgTimer = 0;

  // --- focused listening --------------------------------------------------
  const listen = div('tool-listen', root);
  div('tool-listen-ring', listen);

  const api = {
    /** Show the overlay for a tool; `amount` 0..1 is how far it is raised. */
    show(tool, amount, opts = {}) {
      const a = Math.max(0, Math.min(1, amount));
      bino.classList.toggle('tool-on', tool === 'binoculars' && a > 0.01);
      bino.style.opacity = tool === 'binoculars' ? String(a) : '0';
      if (tool === 'binoculars' && a > 0.01) drawMask(opts.clarity ?? 0.5);
      cam.classList.toggle('tool-on', tool === 'camera' && a > 0.01);
      cam.style.opacity = tool === 'camera' ? String(a) : '0';
      rec.classList.toggle('tool-on', tool === 'recorder');
      rec.classList.toggle('tool-rec-raised', tool === 'recorder' && a > 0.5);
    },
    bino({ zoom, brightness }) {
      binoZoom.textContent = `${zoom.toFixed(1)}×`;
      // Light loss at dusk/night is a dark wash over the glass, not a filter on the HUD.
      binoTint.style.opacity = String(Math.max(0, Math.min(0.6, 1 - brightness)));
    },
    camera({ zoom, filmLeft, filmCap, focus, noFilm }) {
      camFilm.textContent = filmCap > 0 ? `${filmLeft} / ${filmCap}` : '';
      camFilm.classList.toggle('tool-cam-film-low', filmCap > 0 && filmLeft <= 2);
      camZoom.textContent = `${zoom.toFixed(1)}×`;
      camFocus.textContent = focus === 'locked' ? 'AF ●' : focus === 'near' ? 'AF ◐' : 'AF ○';
      brackets.dataset.focus = focus;
      cam.classList.toggle('tool-cam-empty', !!noFilm);
      if (noFilm && !msgTimer) camMsg.textContent = 'Out of film';
      else if (!noFilm && !msgTimer) camMsg.textContent = '';
    },
    message(text, seconds = 1.6) {
      if (!cam.classList.contains('tool-on')) {
        toolMsg.textContent = text;
        toolMsg.classList.add('tool-cam-msg-on');
        clearTimeout(toolMsgTimer);
        toolMsgTimer = setTimeout(() => { toolMsgTimer = 0; toolMsg.classList.remove('tool-cam-msg-on'); }, seconds * 1000);
        return;
      }
      camMsg.textContent = text;
      camMsg.classList.add('tool-cam-msg-on');
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { msgTimer = 0; camMsg.classList.remove('tool-cam-msg-on'); }, seconds * 1000);
    },
    shutter() {
      shutter.classList.remove('tool-cam-shutter-on');
      void shutter.offsetWidth; // restart the CSS animation
      shutter.classList.add('tool-cam-shutter-on');
    },
    recorder({ recording, seconds, level, noise, onAxis, signal, idle, spectrogram, hint }) {
      rec.classList.toggle('tool-rec-live', !!recording);
      rec.classList.toggle('tool-rec-idle', !!idle);
      rec.classList.toggle('tool-rec-signal', !!signal);
      recLabel.textContent = recording ? 'Recording' : 'Recorder';
      recTime.textContent = formatTimer(seconds);
      const lit = Math.round(Math.max(0, Math.min(1, level)) * bars.length);
      for (let i = 0; i < bars.length; i++) {
        const on = i < lit;
        if (bars[i].classList.contains('tool-on') !== on) bars[i].classList.toggle('tool-on', on);
        bars[i].classList.toggle('tool-rec-hot', on && i >= bars.length - 3);
      }
      noiseMark.style.left = `${Math.max(0, Math.min(1, noise)) * 100}%`;
      // Needle: straight up = perfectly on axis; swings out as aim drifts.
      const ang = (1 - Math.max(0, Math.min(1, onAxis))) * 70;
      needle.style.transform = `rotate(${ang}deg)`;
      spectro.hidden = !spectrogram;
      recHint.textContent = hint || '';
    },
    /** Scroll the spectrogram by one column from a Uint8Array of analyser bins. */
    spectrogramColumn(bins) {
      if (!bins || !bins.length || spectro.hidden) return;
      const g = spectro.getContext('2d');
      const w = spectro.width, h = spectro.height;
      g.globalCompositeOperation = 'copy';
      g.drawImage(spectro, -2, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(w - 2, 0, 2, h);
      // Bird song lives roughly in the lower ~60 % of the analyser range.
      const usable = Math.floor(bins.length * 0.6);
      for (let y = 0; y < h; y++) {
        const i = Math.floor(((h - 1 - y) / h) * usable);
        const v = bins[i] / 255;
        const a = Math.min(1, v * 1.3);
        g.fillStyle = `rgba(${Math.round(242 - v * 40)}, ${Math.round(235 - v * 100)}, ${Math.round(221 - v * 170)}, ${a.toFixed(3)})`;
        g.fillRect(w - 2, y, 2, 1);
      }
    },
    clearSpectrogram() {
      const g = spectro.getContext('2d');
      g.clearRect(0, 0, spectro.width, spectro.height);
    },
    listening(on) {
      listen.classList.toggle('tool-on', !!on);
    },
    resize() { maskKey = ''; },
    hideAll() {
      api.show('none', 0);
      api.listening(false);
    },
  };
  return api;
}
