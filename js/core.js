// LUMENFALL · core: math, noise, world layout, height grid, procedural textures
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export function dampAngle(a, b, l, dt) {
  let d = (((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * (1 - Math.exp(-l * dt));
}
export function angDiff(a, b) { return (((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
export function smax(a, b, k) { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); }
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export function mulberry(s) {
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- value noise ----------
function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
export function fbm(x, z, o = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < o; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

// ---------- world layout ----------
export const WORLD = 640, HALF = 320, SEG = 240, GN = SEG + 1, CELL = WORLD / SEG;
export const LAKE = { x: 0, z: 18, r: 64 };
export const TEMPLE = { x: 0, z: -152 };
export const WINGP = { x: 192, z: -70 };
export const ISLAND_R = 232;
export const SPAWN = { x: 0, z: 50 };
export const SHRINES = [
  { x: -150, z: 26, name: '晨羽聖壇', en: 'SHRINE OF DAWNFEATHER' },
  { x: 156, z: -24, name: '墮翼聖壇', en: 'SHRINE OF THE FALLEN WING' },
  { x: 74, z: 146, name: '鏡光聖壇', en: 'SHRINE OF MIRRORED LIGHT' },
  { x: -118, z: -120, name: '星痕聖壇', en: 'SHRINE OF STARSCAR' },
];
const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

function baseH(x, z) {
  let h = 7 + fbm(x * 0.0062 + 11.3, z * 0.0062 - 7.1, 4) * 10 + fbm(x * 0.028 + 3, z * 0.028 + 5, 3) * 1.6;
  h += gauss(x, z, TEMPLE.x, TEMPLE.z, 44) * 22;
  h += gauss(x, z, WINGP.x, WINGP.z, 36) * 15;
  h += gauss(x, z, -158, -118, 48) * 12;
  h += gauss(x, z, -170, 112, 36) * 9;
  h += gauss(x, z, 122, 168, 40) * 6;
  h = smax(h, 1.5, 2.0);
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / (LAKE.r * lakeR(Math.atan2(z - LAKE.z, x - LAKE.x)));
  h = lerp(-2.2, h, smooth(0.72, 1.16, ld));
  return h;
}
export const PADS = [
  { x: TEMPLE.x, z: TEMPLE.z, r0: 21.5, r1: 31 },
  ...SHRINES.map((s) => ({ x: s.x, z: s.z, r0: 7.5, r1: 14 })),
];
PADS.forEach((p) => (p.h = baseH(p.x, p.z)));
// coastline: bays and headlands instead of a near-perfect circle
const COAST = [[70, -24, 9], [243, -28, 15], [313, -22, 8], [30, -15, 6], [108, 16, 7], [180, 14, 6], [222, 10, 8]];
export function edgeR(a) {
  let v = ISLAND_R + Math.sin(a * 3 + 1.3) * 9 + Math.sin(a * 7 + 0.4) * 5 + Math.sin(a * 13 + 2.1) * 2.5 + Math.sin(a * 2 + 2.4) * 5 + Math.sin(a * 5 + 0.7) * 3;
  const deg = ((a * 180) / Math.PI + 360) % 360;
  for (const [c, A, w] of COAST) { const d = ((deg - c + 540) % 360) - 180; v += A * Math.exp(-((d / w) ** 2)); }
  return v;
}
// mirror lake: a wandering shoreline with coves
export function lakeR(a) { return 1 + 0.15 * Math.sin(2 * a + 0.7) + 0.1 * Math.sin(3 * a + 2.1) + 0.06 * Math.sin(5 * a + 0.3) + 0.03 * Math.sin(9 * a + 1.7); }
export function heightAt(x, z) {
  let h = baseH(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r1) h = lerp(p.h, h, smooth(p.r0, p.r1, d));
  }
  const r = Math.hypot(x, z);
  const er = edgeR(Math.atan2(z, x));
  if (r > er - 12) {
    const t = smooth(er - 9, er + 12, r);
    h = lerp(h, -100 + fbm(x * 0.03, z * 0.03, 2) * 12, t);
  }
  return h;
}

// ---------- height grid (matches terrain mesh vertices exactly) ----------
export const grid = {
  h: new Float32Array(GN * GN),
  mask: new Float32Array(GN * GN),
  flower: new Float32Array(GN * GN),
};
export function buildGrid() {
  const { h, mask, flower } = grid;
  for (let iz = 0; iz < GN; iz++) {
    for (let ix = 0; ix < GN; ix++) {
      h[iz * GN + ix] = heightAt(-HALF + ix * CELL, -HALF + iz * CELL);
    }
  }
  for (let iz = 0; iz < GN; iz++) {
    for (let ix = 0; ix < GN; ix++) {
      const i = iz * GN + ix;
      const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
      const hx = h[iz * GN + Math.min(GN - 1, ix + 1)] - h[iz * GN + Math.max(0, ix - 1)];
      const hz = h[Math.min(GN - 1, iz + 1) * GN + ix] - h[Math.max(0, iz - 1) * GN + ix];
      const slope = Math.max(Math.abs(hx), Math.abs(hz)) / (2 * CELL);
      let m = smooth(0.9, 2.2, h[i]) * (1 - smooth(0.5, 0.95, slope));
      const dt = Math.hypot(x - TEMPLE.x, z - TEMPLE.z);
      m *= smooth(20.5, 23, dt);
      for (const s of SHRINES) m *= smooth(6.4, 8.4, Math.hypot(x - s.x, z - s.z));
      const r = Math.hypot(x, z);
      m *= 1 - smooth(edgeR(Math.atan2(z, x)) - 16, edgeR(Math.atan2(z, x)) - 7, r);
      mask[i] = m;
      flower[i] = smooth(0.12, 0.42, fbm(x * 0.017 + 40, z * 0.017 - 12, 3)) * m;
    }
  }
}
// ---------- the human world: a second heightfield far below the cloud sea ----------
export const EARTH_Y = -700;
export const LAYER = { cur: 0 };
// the human world is a larger grid of its own: 1.28 km square at 4 m cells
export const EWORLD = 1280, EHALF = 640, ESEG = 320, EGN = ESEG + 1, ECELL = EWORLD / ESEG;
export const grid2 = { h: new Float32Array(EGN * EGN), mask: new Float32Array(EGN * EGN), flower: new Float32Array(EGN * EGN), wheat: new Float32Array(EGN * EGN) };
// triangle interpolation identical to PlaneGeometry's split; L = 0 island (y 0), L = 1 human world (y EARTH_Y)
export function groundAtL(x, z, L) {
  const half = L ? EHALF : HALF, cell = L ? ECELL : CELL, seg = L ? ESEG : SEG, gn = L ? EGN : GN;
  const fx = (x + half) / cell, fz = (z + half) / cell;
  const base = L ? EARTH_Y : 0;
  if (fx < 0 || fz < 0 || fx >= seg || fz >= seg) return base - 100;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const u = fx - ix, v = fz - iz;
  const H = L ? grid2.h : grid.h;
  const h00 = H[iz * gn + ix], h10 = H[iz * gn + ix + 1], h01 = H[(iz + 1) * gn + ix], h11 = H[(iz + 1) * gn + ix + 1];
  if (u + v <= 1) return base + h00 + (h10 - h00) * u + (h01 - h00) * v;
  return base + h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
export function groundAt(x, z) { return groundAtL(x, z, LAYER.cur); }
export function maskAt(x, z) {
  if (LAYER.cur) { const ix = clamp(Math.round((x + EHALF) / ECELL), 0, ESEG), iz = clamp(Math.round((z + EHALF) / ECELL), 0, ESEG); return grid2.mask[iz * EGN + ix]; }
  const ix = clamp(Math.round((x + HALF) / CELL), 0, SEG), iz = clamp(Math.round((z + HALF) / CELL), 0, SEG);
  return grid.mask[iz * GN + ix];
}

// ---------- procedural textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = c;
  return t;
}
export const TEX = {};
export function makeTextures() {
  const R = mulberry(99);

  TEX.feather = canvasTex(128, 512, (g, w, h) => {
    const cx = w / 2;
    g.save();
    g.beginPath();
    g.moveTo(cx, h - 8);
    g.bezierCurveTo(cx - w * 0.44, h * 0.78, cx - w * 0.47, h * 0.24, cx - 3, 3);
    g.bezierCurveTo(cx + w * 0.32, h * 0.16, cx + w * 0.46, h * 0.72, cx, h - 8);
    g.closePath();
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(0.42, 'rgba(255,255,255,1)');
    grd.addColorStop(0.58, 'rgba(255,252,246,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = grd;
    g.fill();
    g.clip();
    g.lineWidth = 1;
    for (let y = 16; y < h - 24; y += 4) {
      g.strokeStyle = `rgba(196,188,174,${0.22 + R() * 0.2})`;
      g.beginPath(); g.moveTo(cx, y + 9); g.quadraticCurveTo(cx - w * 0.2, y + 2, cx - w * 0.52, y - 16); g.stroke();
      g.beginPath(); g.moveTo(cx, y + 9); g.quadraticCurveTo(cx + w * 0.2, y + 2, cx + w * 0.52, y - 16); g.stroke();
    }
    // soft edge fade
    const eg = g.createLinearGradient(0, 0, 0, h);
    eg.addColorStop(0, 'rgba(255,255,255,0)');
    eg.addColorStop(0.12, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 2.4;
    for (let i = 0; i < 6; i++) {
      const y = 70 + R() * (h - 170), s = i % 2 ? 1 : -1;
      g.beginPath(); g.moveTo(cx + s * w * 0.1, y); g.lineTo(cx + s * w * 0.6, y - 30); g.stroke();
    }
    // warm pearl tint toward the tip gives the white wings some definition
    const tg = g.createLinearGradient(0, 0, 0, h);
    tg.addColorStop(0, 'rgba(214,182,120,0.55)');
    tg.addColorStop(0.3, 'rgba(226,206,170,0.18)');
    tg.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tg; g.fillRect(0, 0, w, h);
    const eg2 = g.createLinearGradient(0, 0, w, 0);
    eg2.addColorStop(0, 'rgba(170,170,190,0.28)'); eg2.addColorStop(0.3, 'rgba(255,255,255,0)'); eg2.addColorStop(0.7, 'rgba(255,255,255,0)'); eg2.addColorStop(1, 'rgba(170,170,190,0.28)');
    g.fillStyle = eg2; g.fillRect(0, 0, w, h);
    g.restore();
    const sg = g.createLinearGradient(0, h, 0, 0);
    sg.addColorStop(0, 'rgba(212,178,110,1)');
    sg.addColorStop(0.45, 'rgba(238,222,186,0.95)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = sg; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, h - 2); g.quadraticCurveTo(cx - 2, h * 0.5, cx - 1, 10); g.stroke();
  });

  TEX.glow = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, false);

  TEX.spark = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(32, 2); g.lineTo(32, 62); g.moveTo(2, 32); g.lineTo(62, 32); g.stroke();
  }, false);

  TEX.marble = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f3efe6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${200 + R() * 40},${195 + R() * 40},${185 + R() * 40},${R() * 0.08})`;
      g.fillRect(R() * w, R() * h, 2 + R() * 8, 2 + R() * 8);
    }
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(150,146,140,${0.08 + R() * 0.14})`; g.lineWidth = 0.6 + R() * 1.4;
      g.beginPath(); let x = R() * w, y = R() * h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 160; y += (R() - 0.3) * 120; g.quadraticCurveTo(x + (R() - .5) * 60, y + (R() - .5) * 60, x, y); }
      g.stroke();
    }
    for (let i = 0; i < 4; i++) { // kintsugi gold veins
      g.strokeStyle = `rgba(206,168,92,${0.35 + R() * 0.3})`; g.lineWidth = 0.8 + R();
      g.beginPath(); let x = R() * w, y = R() * h; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 90; y += R() * 70; g.lineTo(x, y); }
      g.stroke();
    }
  });
  TEX.marble.wrapS = TEX.marble.wrapT = THREE.RepeatWrapping;

  TEX.rune = canvasTex(1024, 1024, (g, w, h) => {
    const c = w / 2;
    g.translate(c, c);
    g.strokeStyle = 'rgba(255,240,205,1)'; g.fillStyle = 'rgba(255,240,205,1)';
    const ring = (r, lw) => { g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
    ring(500, 4); ring(486, 1.5); ring(430, 1.5); ring(418, 5); ring(340, 1.5); ring(250, 2);
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2, l = i % 5 === 0 ? 22 : 10;
      g.lineWidth = i % 5 === 0 ? 2.5 : 1.2;
      g.beginPath(); g.moveTo(Math.cos(a) * 486, Math.sin(a) * 486); g.lineTo(Math.cos(a) * (486 - l), Math.sin(a) * (486 - l)); g.stroke();
    }
    g.font = '600 30px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ✦';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      g.save(); g.rotate(a + Math.PI / 2); g.translate(0, -456);
      g.fillText(glyphs[i % glyphs.length], 0, 0); g.restore();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.save(); g.rotate(a);
      g.beginPath(); g.moveTo(0, -418); g.lineTo(14, -380); g.lineTo(0, -342); g.lineTo(-14, -380); g.closePath(); g.fill();
      g.restore();
    }
    g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { // hexagram-ish arcs
      const a = (i / 6) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * 160, Math.sin(a) * 160, 180, 0, Math.PI * 2); g.globalAlpha = 0.35; g.stroke(); g.globalAlpha = 1;
    }
  });

  TEX.beam = canvasTex(64, 256, (g, w, h) => {
    const v = g.createLinearGradient(0, h, 0, 0);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }, false);

  TEX.vein = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd27a'; g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      g.lineWidth = 0.8 + R() * 2.2;
      g.beginPath(); let x = R() * w, y = R() * h; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 70; y += (R() - 0.5) * 70; g.lineTo(x, y); }
      g.stroke();
    }
  });

  TEX.mask = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16131b';
    g.beginPath(); g.ellipse(w * 0.34, h * 0.55, 30, 7, -0.25, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w * 0.66, h * 0.55, 30, 7, 0.25, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#b8924a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(w / 2, h * 0.12); g.lineTo(w / 2, h * 0.42); g.stroke();
    g.beginPath(); g.moveTo(w * 0.42, h * 0.75); g.quadraticCurveTo(w / 2, h * 0.68, w * 0.58, h * 0.75); g.stroke();
  });

  TEX.sash = canvasTex(64, 256, (g, w, h) => {
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(250,246,236,0.95)');
    v.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(205,168,96,0.95)';
    g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
    g.fillRect(9, 0, 1.5, h); g.fillRect(w - 10.5, 0, 1.5, h);
    for (let y = 18; y < h; y += 34) {
      g.save(); g.translate(w / 2, y); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore();
    }
  });

  TEX.shadow = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(60,52,40,0.55)');
    r.addColorStop(0.6, 'rgba(60,52,40,0.2)');
    r.addColorStop(1, 'rgba(60,52,40,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });

  TEX.ripple = canvasTex(128, 128, (g, w, h) => {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.globalAlpha = 0.5; g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
  }, false);
}
