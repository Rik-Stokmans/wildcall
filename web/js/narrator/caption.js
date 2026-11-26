// Narrator captions: timing and line balancing (pure, unit-tested in caption.test.js)
// plus a tiny DOM renderer for #narrator.

export const MAX_CHARS = 60;

/**
 * Estimated seconds a line takes to speak at `rate` (1 = normal). Used for caption
 * time when there is no voice, and as a safety bound while speaking. Never shorter
 * than a comfortable reading time.
 */
export function estimateDuration(text, rate = 0.92) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  const pauses = (String(text).match(/[.!?;:](\s|$)/g) || []).length;
  const r = rate > 0 ? rate : 1;
  const spoken = words / (2.6 * r) + pauses * 0.3 + 0.4; // ~155 wpm at rate 1
  const reading = 1.2 + words * 0.3;                        // ~200 wpm reading plus a glance
  return Math.max(2.2, spoken, reading);
}

/**
 * Split text into balanced caption lines of at most `max` characters: the fewest
 * lines possible, with lengths as even as possible (no long line over a short
 * orphan). A single word longer than `max` gets a line of its own.
 */
export function balanceLines(text, max = MAX_CHARS) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const total = words.join(' ').length;
  if (total <= max) return [words.join(' ')];
  const n = words.length;
  // len(i, j) = characters of words i..j-1 joined by spaces
  const prefix = [0];
  for (const w of words) prefix.push(prefix[prefix.length - 1] + w.length);
  const len = (i, j) => prefix[j] - prefix[i] + (j - i - 1);

  for (let k = Math.ceil(total / max); k <= n; k++) {
    const target = total / k;
    // dp[j][c] = min cost to set words 0..j-1 in c lines
    const INF = Infinity;
    const dp = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(INF));
    const from = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(-1));
    dp[0][0] = 0;
    for (let c = 1; c <= k; c++) {
      for (let j = 1; j <= n; j++) {
        for (let i = j - 1; i >= 0; i--) {
          const L = len(i, j);
          if (L > max && j - i > 1) break;
          if (dp[i][c - 1] === INF) continue;
          const cost = dp[i][c - 1] + (L - target) * (L - target);
          if (cost < dp[j][c]) { dp[j][c] = cost; from[j][c] = i; }
        }
      }
    }
    if (dp[n][k] < INF) {
      const lines = [];
      let j = n;
      for (let c = k; c > 0; c--) {
        const i = from[j][c];
        lines.unshift(words.slice(i, j).join(' '));
        j = i;
      }
      return lines;
    }
  }
  return words; // unreachable in practice: one word per line always fits the DP
}

/**
 * DOM caption for #narrator. show(text) fades a caption in; hide() fades it out.
 * Safe to call with a missing element (does nothing).
 */
export function createCaption(root) {
  if (!root || typeof document === 'undefined') {
    return { show() {}, hide() {}, clear() {} };
  }
  const box = document.createElement('div');
  box.className = 'nar-caption';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  const inner = document.createElement('p');
  inner.className = 'nar-text';
  box.appendChild(inner);
  root.appendChild(box);
  let hideTimer = 0;

  return {
    show(text) {
      clearTimeout(hideTimer);
      inner.textContent = '';
      for (const line of balanceLines(text)) {
        const span = document.createElement('span');
        span.className = 'nar-line';
        span.textContent = line;
        inner.appendChild(span);
      }
      box.classList.remove('nar-out');
      // restart the fade-in
      void box.offsetWidth;
      box.classList.add('nar-in');
    },
    hide() {
      box.classList.remove('nar-in');
      box.classList.add('nar-out');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (box.classList.contains('nar-out')) inner.textContent = ''; }, 900);
    },
    clear() {
      clearTimeout(hideTimer);
      box.classList.remove('nar-in', 'nar-out');
      inner.textContent = '';
    },
  };
}
