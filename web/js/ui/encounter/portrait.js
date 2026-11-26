// Procedural NPC portrait on a canvas, drawn from proto.NPCLook (skin, hair, coat, trim,
// hat, prop, build). No external art: just shapes, in the soft naturalist-sketch style.
import { safeHex, shadeHex, mixHex } from './logic.js';
import { hashString } from './landscape.js';

const W = 260, H = 300;

/** drawPortrait(npc, { dpr }) -> HTMLCanvasElement (CSS size 260x300) */
export function drawPortrait(npc, opts = {}) {
  const look = npc?.look || {};
  const dpr = Math.min(opts.dpr || window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  c.style.width = W + 'px'; c.style.height = H + 'px';
  c.className = 'enc-portrait-canvas';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  paint(g, npc?.id || npc?.name || 'npc', look);
  return c;
}

function paint(g, seedText, look) {
  const skin = safeHex(look.skin, '#E0B58F'), hair = safeHex(look.hair, '#5A4030');
  const coat = safeHex(look.coat, '#4E6B52'), trim = safeHex(look.trim, '#C98A50');
  const build = Math.max(0.8, Math.min(1.3, look.build || 1));
  const h = hashString(String(seedText));
  const style = h % 4; // 0 short, 1 bob, 2 long, 3 bun
  const cx = W / 2;

  // Backdrop: a warm paper vignette with a soft leafy arch.
  const bg = g.createRadialGradient(cx, 120, 20, cx, 140, 220);
  bg.addColorStop(0, '#F2EBDD'); bg.addColorStop(1, '#D9C7A0');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(124,154,112,.28)';
  g.beginPath(); g.ellipse(cx, 150, 112, 134, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(85,69,55,.18)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, 150, 112, 134, 0, 0, Math.PI * 2); g.stroke();

  // Hair behind the head (long / bob / bun).
  g.fillStyle = hair;
  if (style === 2) rr(g, cx - 56, 78, 112, 150, 44);
  if (style === 1) rr(g, cx - 54, 80, 108, 92, 38);
  if (style === 3) { g.beginPath(); g.arc(cx, 52, 20, 0, Math.PI * 2); g.fill(); }

  // Shoulders and coat.
  const sw = 104 * build;
  g.fillStyle = coat;
  g.beginPath();
  g.moveTo(cx - sw, H); g.lineTo(cx - sw, 252);
  g.quadraticCurveTo(cx - sw, 196, cx - 40, 186);
  g.lineTo(cx + 40, 186);
  g.quadraticCurveTo(cx + sw, 196, cx + sw, 252);
  g.lineTo(cx + sw, H); g.closePath(); g.fill();
  g.fillStyle = shadeHex(coat, -0.16);
  g.beginPath(); g.moveTo(cx - sw, H); g.lineTo(cx - sw, 252); g.quadraticCurveTo(cx - sw, 220, cx - sw + 22, 206); g.lineTo(cx - sw + 40, H); g.fill();

  // Neck and collar.
  g.fillStyle = shadeHex(skin, -0.08);
  rr(g, cx - 17, 160, 34, 40, 10);
  g.fillStyle = coat;
  g.beginPath(); g.moveTo(cx - 40, 186); g.lineTo(cx, 224); g.lineTo(cx + 40, 186); g.lineTo(cx + 26, 180); g.lineTo(cx, 200); g.lineTo(cx - 26, 180); g.closePath(); g.fill();
  g.strokeStyle = trim; g.lineWidth = 5; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(cx - 38, 187); g.lineTo(cx, 224); g.lineTo(cx + 38, 187); g.stroke();
  g.fillStyle = trim;
  for (const dy of [248, 272]) { g.beginPath(); g.arc(cx, dy, 4, 0, Math.PI * 2); g.fill(); }

  // Prop (behind the face where it hangs from the neck, otherwise held at the side).
  drawProp(g, look.prop, cx, sw, coat, trim);

  // Head.
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(cx - 47, 124, 8, 12, 0, 0, Math.PI * 2); g.ellipse(cx + 47, 124, 8, 12, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, 120, 45, 54, 0, 0, Math.PI * 2); g.fill();
  // Gentle cheek colour.
  g.fillStyle = mixHex(skin, '#D77A6A', 0.35); g.globalAlpha = 0.45;
  g.beginPath(); g.ellipse(cx - 27, 138, 10, 7, 0, 0, Math.PI * 2); g.ellipse(cx + 27, 138, 10, 7, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;

  // Face.
  g.fillStyle = '#2A211B';
  g.beginPath(); g.ellipse(cx - 17, 120, 4.2, 5.4, 0, 0, Math.PI * 2); g.ellipse(cx + 17, 120, 4.2, 5.4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx - 15.5, 118, 1.4, 0, Math.PI * 2); g.arc(cx + 18.5, 118, 1.4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = shadeHex(hair, -0.1); g.lineWidth = 3.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 25, 108); g.quadraticCurveTo(cx - 17, 103, cx - 9, 107); g.moveTo(cx + 9, 107); g.quadraticCurveTo(cx + 17, 103, cx + 25, 108); g.stroke();
  g.strokeStyle = shadeHex(skin, -0.22); g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(cx, 124); g.quadraticCurveTo(cx + 5, 136, cx - 1, 138); g.stroke();
  g.strokeStyle = '#8A4A3C'; g.lineWidth = 2.8;
  g.beginPath(); g.moveTo(cx - 13, 152); g.quadraticCurveTo(cx, 163, cx + 13, 152); g.stroke();

  // Hair in front.
  g.fillStyle = hair;
  g.beginPath();
  g.moveTo(cx - 47, 118);
  g.quadraticCurveTo(cx - 52, 62, cx, 62);
  g.quadraticCurveTo(cx + 52, 62, cx + 47, 118);
  g.quadraticCurveTo(cx + 40, 92, cx + 8, 88);
  g.quadraticCurveTo(cx - 24, 92, cx - 47, 118);
  g.fill();

  drawHat(g, look.hat, cx, hair, coat, trim);
}

function drawHat(g, hat, cx, hair, coat, trim) {
  const felt = shadeHex(coat, -0.28);
  switch (hat) {
    case 'brim': {
      g.fillStyle = shadeHex('#8A6A4A', -0.05);
      g.beginPath(); g.ellipse(cx, 80, 82, 17, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9C7B58';
      g.beginPath(); g.moveTo(cx - 44, 80); g.quadraticCurveTo(cx - 46, 34, cx, 34); g.quadraticCurveTo(cx + 46, 34, cx + 44, 80); g.closePath(); g.fill();
      g.fillStyle = trim; g.fillRect(cx - 44, 66, 88, 10);
      break;
    }
    case 'beanie': {
      g.fillStyle = coat;
      g.beginPath(); g.moveTo(cx - 49, 88); g.quadraticCurveTo(cx - 52, 38, cx, 38); g.quadraticCurveTo(cx + 52, 38, cx + 49, 88); g.closePath(); g.fill();
      g.fillStyle = trim; rr(g, cx - 51, 78, 102, 16, 8);
      g.beginPath(); g.arc(cx, 34, 9, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'ranger': {
      g.fillStyle = felt;
      g.beginPath(); g.ellipse(cx, 78, 74, 12, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(cx - 40, 78); g.lineTo(cx - 34, 36); g.quadraticCurveTo(cx, 28, cx + 34, 36); g.lineTo(cx + 40, 78); g.closePath(); g.fill();
      g.fillStyle = trim; g.fillRect(cx - 40, 66, 80, 8);
      break;
    }
    case 'cap': {
      g.fillStyle = coat;
      g.beginPath(); g.moveTo(cx - 47, 86); g.quadraticCurveTo(cx - 50, 42, cx, 42); g.quadraticCurveTo(cx + 50, 42, cx + 47, 86); g.closePath(); g.fill();
      g.fillStyle = shadeHex(coat, -0.2);
      g.beginPath(); g.ellipse(cx + 28, 86, 38, 8, 0.08, 0, Math.PI * 2); g.fill();
      g.fillStyle = trim; g.beginPath(); g.arc(cx, 62, 5, 0, Math.PI * 2); g.fill();
      break;
    }
    default: void hair;
  }
}

function drawProp(g, prop, cx, sw, coat, trim) {
  g.save();
  switch (prop) {
    case 'binoculars': {
      g.strokeStyle = '#3A3027'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - 32, 188); g.quadraticCurveTo(cx - 30, 236, cx - 10, 244); g.moveTo(cx + 32, 188); g.quadraticCurveTo(cx + 30, 236, cx + 10, 244); g.stroke();
      g.fillStyle = '#3A3027'; rr(g, cx - 24, 236, 20, 34, 8); rr(g, cx + 4, 236, 20, 34, 8);
      g.fillStyle = '#5B7C8B'; g.beginPath(); g.ellipse(cx - 14, 270, 8, 3, 0, 0, Math.PI * 2); g.ellipse(cx + 14, 270, 8, 3, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'clipboard': {
      g.translate(cx + sw * 0.52, 252); g.rotate(-0.12);
      g.fillStyle = '#8A6A4A'; rr(g, -26, -34, 52, 70, 5);
      g.fillStyle = '#F2EBDD'; rr(g, -21, -26, 42, 58, 3);
      g.strokeStyle = 'rgba(85,69,55,.5)'; g.lineWidth = 1.6;
      for (let y = -16; y < 28; y += 9) { g.beginPath(); g.moveTo(-15, y); g.lineTo(15, y); g.stroke(); }
      g.fillStyle = '#A8A39A'; rr(g, -9, -40, 18, 10, 3);
      break;
    }
    case 'toolbelt': {
      g.fillStyle = '#6B4A32'; g.fillRect(cx - sw + 2, 276, sw * 2 - 4, 14);
      g.fillStyle = trim; rr(g, cx - 8, 274, 16, 18, 3);
      g.fillStyle = '#8A6A4A'; rr(g, cx - sw + 16, 262, 30, 28, 6); rr(g, cx + sw - 46, 262, 30, 28, 6);
      break;
    }
    case 'staff': {
      g.strokeStyle = '#6B4A32'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx + sw * 0.8, 292); g.lineTo(cx + sw * 0.8 + 6, 70); g.stroke();
      g.fillStyle = '#8A6A4A'; g.beginPath(); g.arc(cx + sw * 0.8 + 6, 66, 9, 0, Math.PI * 2); g.fill();
      break;
    }
    default: void coat;
  }
  g.restore();
}

/** Rounded rectangle, filled with the current fillStyle. */
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}
