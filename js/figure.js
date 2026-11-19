// LUMENFALL · figure.js
// The cast, modelled the way a low-poly character artist builds them: superellipse rings lofted along each bone,
// flat-shaded so every plane catches the light, a sculpted head with a painted face, clothes as shells over the body.
// It feeds seraph.js's buildBody (same Mixamo skeleton and T-pose), so every animation keeps working.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- loft kit
// a ring: c centre, w half-width, d half-depth to the front, b half-depth to the back, s squareness (2 = ellipse)
// axis 'y': width on X, front on +Z · axis 'x' (arms): width on Y, front on +Z · axis 'z' (feet): width on X, front = up
function ringPt(r, a, axis, out) {
  const sa = Math.sin(a), ca = Math.cos(a), e = 2 / (r.s || 2);
  let u = Math.sign(sa) * Math.pow(Math.abs(sa), e) * r.w;
  let v = Math.sign(ca) * Math.pow(Math.abs(ca), e) * (ca >= 0 ? r.d : (r.b ?? r.d));
  const c = r.c;
  if (axis === 'y') out.set(c[0] + u, c[1], c[2] + v);
  else if (axis === 'x') out.set(c[0], c[1] + u, c[2] + v);
  else out.set(c[0] + u, c[1] + v, c[2]);
  return out;
}
// rings → triangles, sorted by material. o: { n, axis, phase, arc:[a0,a1] (open strip), cap0, cap1, tip0, tip1, mod(p,a,k,i), mat(aMid,k,i) → key|null, uv(p) }
export function loft(rings, o) {
  const n = o.angles ? o.angles.length : o.n || 8, axis = o.axis || 'y', open = !!o.arc, cnt = open ? n + 1 : n;
  const P = rings.map((r, k) => {
    const row = [];
    for (let i = 0; i < cnt; i++) {
      const a = open ? o.arc[0] + (o.arc[1] - o.arc[0]) * (i / n) : o.angles ? o.angles[i] : (o.phase || 0) + (i / n) * TAU;
      const p = ringPt(r, a, axis, new V3());
      if (o.mod) o.mod(p, ((a + Math.PI) % TAU + TAU) % TAU - Math.PI, k, i, r);
      p.a = a; row.push(p);
    }
    return row;
  });
  const cen = rings.map((r) => new V3(...r.c));
  const out = {};
  const put = (key, a, b, c) => {
    if (!key) return;
    const t = out[key] || (out[key] = { pos: [], uv: [] });
    for (const p of [a, b, c]) {
      t.pos.push(p.x, p.y, p.z);
      if (o.uv) { const q = o.uv(p); t.uv.push(q[0], q[1]); } else t.uv.push(p.u ?? 0, p.v ?? 0);
    }
  };
  // winding: make the first quad face away from the loft's axis
  let flip = false;
  {
    const a = P[0][0], b = P[0][1 % cnt], c = P[1][0];
    const nrm = new V3().subVectors(b, a).cross(new V3().subVectors(c, a));
    const rad = new V3().subVectors(a, cen[0]).add(new V3().subVectors(b, cen[0]));
    const along = new V3().subVectors(cen[1], cen[0]);
    rad.addScaledVector(along, -rad.dot(along) / Math.max(1e-9, along.lengthSq()));
    flip = nrm.dot(rad) < 0;
  }
  const key = (a, k, i) => (typeof o.mat === 'function' ? o.mat(a, k, i) : o.mat || 'dress');
  for (let k = 0; k < P.length - 1; k++) {
    for (let i = 0; i < (open ? n : n); i++) {
      const j = open ? i + 1 : (i + 1) % n;
      const p00 = P[k][i], p01 = P[k][j], p10 = P[k + 1][i], p11 = P[k + 1][j];
      p00.u = p10.u = i / n; p01.u = p11.u = (i + 1) / n; p00.v = p01.v = k / (P.length - 1); p10.v = p11.v = (k + 1) / (P.length - 1);
      let am = (p00.a + (open ? p01.a : o.angles ? (j ? p01.a : TAU) : p00.a + TAU / n)) / 2;
      const m = key(((am + Math.PI) % TAU + TAU) % TAU - Math.PI, k, i);
      if (flip) { put(m, p00, p10, p01); put(m, p01, p10, p11); }
      else { put(m, p00, p01, p10); put(m, p01, p11, p10); }
    }
  }
  // caps: a fan to the ring centre (pushed out by tip along the loft's axis)
  const cap = (k, tip, m, outward) => {
    const c = cen[k].clone();
    const dir = new V3().subVectors(cen[k], cen[k === 0 ? 1 : k - 1]).normalize();
    c.addScaledVector(dir, tip || 0); c.u = 0.5; c.v = k === 0 ? 0 : 1;
    for (let i = 0; i < n; i++) {
      const a = P[k][i], b = P[k][(i + 1) % n];
      const nrm = new V3().subVectors(b, a).cross(new V3().subVectors(c, a));
      if ((nrm.dot(dir) > 0) === outward) put(m, a, b, c); else put(m, b, a, c);
    }
  };
  if (!open && o.cap0) cap(0, o.tip0, typeof o.cap0 === 'string' ? o.cap0 : key(0, 0, 0), true);
  if (!open && o.cap1) cap(P.length - 1, o.tip1, typeof o.cap1 === 'string' ? o.cap1 : key(0, P.length - 2, 0), true);
  const geos = {};
  for (const m in out) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out[m].pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(out[m].uv, 2));
    g.computeVertexNormals();
    geos[m] = g;
  }
  geos.pts = P;
  return geos;
}
// mirror a left-side part to the right (x → −x, winding swapped so it still faces out)
function mirror(g) {
  g = g.clone();
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  for (let i = 0; i < p.count; i += 3) {
    for (const A of [p, uv]) { const s = A.itemSize; for (let c = 0; c < s; c++) { const t = A.array[(i + 1) * s + c]; A.array[(i + 1) * s + c] = A.array[(i + 2) * s + c]; A.array[(i + 2) * s + c] = t; } }
  }
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}
const LR = (c) => c.map((n) => n.replace('Left', 'Right'));
// a faceted primitive: low segment counts so the planes read
function facet(g) { g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals(); return g; }

// ---------------------------------------------------------------- the painted face
const _face = {};
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
export const FACE_BOX = { x: 0.1, y0: 1.53, h: 0.24 };
export function faceTexture(L) {
  const fem = L.sex === 'f';
  const key = [L.skin, L.eye, L.hairCol, fem ? 1 : 0, L.hair, L.age || 0].join('|');
  if (_face[key]) return _face[key];
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const X = (x) => (0.5 + x / (2 * FACE_BOX.x)) * S, Y = (y) => (1 - (y - FACE_BOX.y0) / FACE_BOX.h) * S, U = (d) => (d / (2 * FACE_BOX.x)) * S;
  const skin = L.skin || '#f1dccf';
  g.fillStyle = skin; g.fillRect(0, 0, S, S);
  const shade = mixHex(skin, '#5a3a30', 0.22), deep = mixHex(skin, '#3a221c', 0.55);
  const browCol = L.hair === 'none' ? mixHex(skin, '#3a2a20', 0.55) : mixHex(L.hairCol || '#5b4434', '#1a120e', 0.35);
  // soft planes: a little shadow in the eye sockets and under the cheekbones, warmth on the cheeks and nose
  const blob = (x, y, rx, ry, col, a) => { g.save(); g.translate(X(x), Y(y)); g.scale(U(rx), U(ry)); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(1, col + '00'); g.globalAlpha = a; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); };
  const hx = (col) => '#' + new THREE.Color(col).getHexString();
  for (const sx of [1, -1]) {
    blob(sx * 0.031, 1.651, 0.024, 0.012, hx(shade), 0.55);
    blob(sx * 0.05, 1.612, 0.02, 0.016, hx(fem ? '#e88a7c' : '#d98e78'), fem ? 0.22 : 0.12);
  }
  blob(0, 1.606, 0.012, 0.008, hx('#d98e78'), 0.12);
  blob(0, 1.593, 0.011, 0.004, hx(deep), 0.3);
  // eyes: an almond of white, the iris tucked under the upper lid, a heavy lash line
  for (const sx of [1, -1]) {
    const ix = sx * 0.019, ox = sx * 0.046, ey = 1.645;
    const path = () => {
      g.beginPath(); g.moveTo(X(ix), Y(ey - 0.0005));
      g.bezierCurveTo(X(sx * 0.026), Y(ey + 0.0072), X(sx * 0.04), Y(ey + 0.0068), X(ox), Y(ey + 0.0018));
      g.bezierCurveTo(X(sx * 0.039), Y(ey - 0.0042), X(sx * 0.026), Y(ey - 0.0046), X(ix), Y(ey - 0.0005));
      g.closePath();
    };
    g.save(); path(); g.fillStyle = '#f3eee6'; g.fill(); g.clip();
    const cx = X(sx * 0.0315), cy = Y(ey + 0.0008), ir = U(0.0062);
    const ig = g.createRadialGradient(cx, cy - ir * 0.3, ir * 0.1, cx, cy, ir);
    ig.addColorStop(0, mixHex(L.eye || '#3d2c22', '#ffffff', 0.25)); ig.addColorStop(0.75, L.eye || '#3d2c22'); ig.addColorStop(1, mixHex(L.eye || '#3d2c22', '#000000', 0.55));
    g.fillStyle = ig; g.beginPath(); g.arc(cx, cy, ir, 0, TAU); g.fill();
    g.fillStyle = '#120c0a'; g.beginPath(); g.arc(cx, cy, ir * 0.42, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(cx + ir * 0.35 * -sx, cy - ir * 0.38, ir * 0.22, 0, TAU); g.fill();
    g.fillStyle = 'rgba(40,24,18,.28)'; g.fillRect(0, Y(ey + 0.0075), S, U(0.0035)); // the lid's shadow on the eyeball
    g.restore();
    // upper lid line
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#24170f'; g.lineWidth = U(fem ? 0.0026 : 0.0021);
    g.beginPath(); g.moveTo(X(ix + sx * 0.001), Y(ey + 0.0006));
    g.bezierCurveTo(X(sx * 0.026), Y(ey + 0.0074), X(sx * 0.04), Y(ey + 0.007), X(ox + sx * (fem ? 0.004 : 0.001)), Y(ey + (fem ? 0.0042 : 0.0022)));
    g.stroke();
    // lid crease and the lower lid
    g.strokeStyle = 'rgba(70,40,30,.35)'; g.lineWidth = U(0.0011);
    g.beginPath(); g.moveTo(X(sx * 0.022), Y(ey + 0.0098)); g.quadraticCurveTo(X(sx * 0.033), Y(ey + 0.0135), X(sx * 0.044), Y(ey + 0.0075)); g.stroke();
    g.strokeStyle = 'rgba(70,40,30,.3)'; g.lineWidth = U(0.0012);
    g.beginPath(); g.moveTo(X(sx * 0.024), Y(ey - 0.004)); g.quadraticCurveTo(X(sx * 0.035), Y(ey - 0.0058), X(ox), Y(ey + 0.001)); g.stroke();
    // brows: tapered, rising a little to the outer third
    g.fillStyle = browCol; g.beginPath();
    const bw = fem ? 0.0028 : 0.0042, by = 1.6635;
    g.moveTo(X(sx * 0.014), Y(by - 0.001));
    g.quadraticCurveTo(X(sx * 0.034), Y(by + 0.0055 + bw), X(sx * 0.053), Y(by + 0.0005));
    g.quadraticCurveTo(X(sx * 0.034), Y(by + 0.0042), X(sx * 0.0145), Y(by - 0.001 - bw));
    g.closePath(); g.fill();
    // nostril
    g.fillStyle = hx(deep); g.globalAlpha = 0.45; g.beginPath(); g.ellipse(X(sx * 0.0075), Y(1.5965), U(0.0032), U(0.0017), sx * 0.3, 0, TAU); g.fill(); g.globalAlpha = 1;
  }
  // mouth: a darker upper lip, a fuller lower one catching light
  const lip = mixHex(skin, fem ? '#b4505a' : '#a4625a', fem ? 0.5 : 0.32);
  const my = 1.5735, mw = fem ? 0.0165 : 0.0175;
  g.fillStyle = mixHex(lip, '#3a1c18', 0.18);
  g.beginPath(); g.moveTo(X(-mw), Y(my)); g.quadraticCurveTo(X(-0.008), Y(my + 0.0062), X(0), Y(my + 0.0042)); g.quadraticCurveTo(X(0.008), Y(my + 0.0062), X(mw), Y(my)); g.closePath(); g.fill();
  g.fillStyle = lip;
  g.beginPath(); g.moveTo(X(-mw * 0.92), Y(my)); g.quadraticCurveTo(X(0), Y(my - (fem ? 0.0095 : 0.007)), X(mw * 0.92), Y(my)); g.closePath(); g.fill();
  g.strokeStyle = mixHex(lip, '#2a1210', 0.55); g.lineWidth = U(0.0012);
  g.beginPath(); g.moveTo(X(-mw - 0.001), Y(my + 0.0006)); g.quadraticCurveTo(X(0), Y(my - 0.0008), X(mw + 0.001), Y(my + 0.0006)); g.stroke();
  blob(0, my - 0.0105, 0.012, 0.004, hx(shade), 0.35); // under the lower lip
  if (L.age) for (const sx of [1, -1]) { // smile lines for the elders
    g.strokeStyle = 'rgba(90,50,40,.25)'; g.lineWidth = U(0.0012);
    g.beginPath(); g.moveTo(X(sx * 0.017), Y(1.602)); g.quadraticCurveTo(X(sx * 0.026), Y(1.588), X(sx * 0.024), Y(1.573)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_face[key] = t);
}

// ---------------------------------------------------------------- the figure
// add(geo, mat, cands, custom) is buildBody's skinning hook. L = look, O = outfit (colours + flags)
export function buildFigure(add, L, O, BI) {
  const fem = L.sex === 'f';
  const g0 = L.build || 0, belly = L.belly || 0;
  const bw = 1 + g0 * 0.16, lw = 1 + g0 * 0.12;            // girth, limb girth
  const fw = fem ? 0.9 : 1;                                 // a woman's limbs are slimmer
  const addAll = (geos, cands, custom) => { for (const m in geos) if (m !== 'pts') add(geos[m], m, cands, custom); };
  const HY = -0.012; // the head sits a little low on the neck: a shorter, sturdier neck
  const addHead = (geos, cands) => { for (const m in geos) if (m !== 'pts') { geos[m].translate(0, HY, 0); add(geos[m], m, cands); } };
  const both = (geos, cands) => { for (const m in geos) if (m !== 'pts') { add(geos[m], m, cands); add(mirror(geos[m]), m, LR(cands)); } };
  const skirtW = (p) => {
    const down = Math.min(1, Math.max(0, (1.0 - p.y) / 0.42)), side = Math.min(1, Math.abs(p.x) / 0.18) * down * 0.42;
    return [[BI('Hips'), 1 - side], [BI(p.x >= 0 ? 'LeftUpLeg' : 'RightUpLeg'), side]];
  };

  // ---- torso: hips → waist → ribcage → shoulders → neck (12 sides: a sternum line down the front, a spine down the back)
  const T = fem
    ? [[0.88, 0.152, 0.092, 0.104, 2.6], [0.96, 0.162, 0.098, 0.11, 2.6], [1.04, 0.122, 0.084, 0.088, 2.3], [1.12, 0.124, 0.088, 0.084, 2.3],
       [1.2, 0.134, 0.096, 0.088, 2.3], [1.28, 0.142, 0.1, 0.09, 2.3], [1.345, 0.15, 0.094, 0.09, 2.35], [1.395, 0.152, 0.078, 0.082, 2.5], [1.446, 0.11, 0.058, 0.064, 2.3], [1.476, 0.052, 0.044, 0.048, 2]]
    : [[0.88, 0.148, 0.092, 0.1, 2.6], [0.96, 0.152, 0.096, 0.104, 2.6], [1.04, 0.136, 0.09, 0.092, 2.4], [1.12, 0.14, 0.096, 0.09, 2.4],
       [1.2, 0.152, 0.106, 0.094, 2.3], [1.28, 0.162, 0.112, 0.098, 2.3], [1.345, 0.168, 0.104, 0.098, 2.35], [1.395, 0.17, 0.084, 0.088, 2.5], [1.448, 0.124, 0.064, 0.07, 2.3], [1.478, 0.06, 0.048, 0.054, 2]];
  const bellyK = (y) => belly * Math.max(0, 1 - Math.abs(y - 1.09) / 0.17);
  const torsoRings = T.map(([y, w, d, b, s]) => {
    const k = y > 1.44 ? 1 : bw;
    return { c: [0, y, 0.012 * bellyK(y)], w: w * k * (1 + bellyK(y) * 0.28), d: d * k * (1 + bellyK(y) * 0.75), b: b * k * (1 + bellyK(y) * 0.12), s };
  });
  // the chest reads as two planes meeting at the sternum; shoulder blades soften the back
  const torsoMod = (p, a, k) => {
    const y = T[k][0];
    if (y > 1.18 && y < 1.37) { const f = Math.abs(a); if (f < 1.1) p.z += (fem ? 0.004 : 0.008) * Math.sin(f * 2.8) * bw; }
  };
  const torsoMat = O.torsoMat || 'dress';
  addAll(loft(torsoRings, { n: 12, axis: 'y', mod: torsoMod, mat: torsoMat }), ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder']);
  if (fem) for (const sx of [1, -1]) { // bust under the tunic
    const g = facet(new THREE.SphereGeometry(0.052 * bw, 8, 5)); g.scale(1, 0.86, 0.74); g.translate(sx * 0.054, 1.272, 0.07 * bw); add(g, torsoMat, ['Spine1', 'Spine2']);
  }

  // ---- neck
  const nk = fem ? [0.039, 0.036, 0.043] : [0.048, 0.044, 0.052];
  addAll(loft([{ c: [0, 1.45, -0.002], w: nk[0] * 1.15, d: nk[1], b: nk[2] }, { c: [0, 1.5, 0.002], w: nk[0], d: nk[1], b: nk[2] }, { c: [0, 1.56, 0.004], w: nk[0] * 0.98, d: nk[1] * 0.95, b: nk[2] }],
    { n: 8, axis: 'y', mat: 'skin' }), ['Spine2', 'Neck', 'Head']);

  // ---- head: sixteen sides packed toward the face (a narrow nose, eyes, cheekbones), thirteen rings chin to crown, then sculpted
  const HA = [0, 10, 22, 38, 58, 80, 105, 135, 180, 225, 255, 280, 302, 322, 338, 350].map((d) => (d * Math.PI) / 180);
  const jw = fem ? 0.88 : 1.04, jw2 = fem ? 0.94 : 1.02;
  const H = [ // y, w, d(front), b(back), zc
    [1.531, 0.034 * jw, 0.04, 0.046, 0.014], [1.547, 0.052 * jw, 0.076, 0.062, 0.008], [1.565, 0.062 * jw2, 0.082, 0.074, 0.006], [1.581, 0.068, 0.084, 0.082, 0.005],
    [1.595, 0.073, 0.085, 0.089, 0.004], [1.607, 0.076, 0.085, 0.093, 0.003], [1.625, 0.079, 0.085, 0.098, 0.002], [1.645, 0.081, 0.083, 0.101, 0],
    [1.667, 0.082, 0.085, 0.104, 0], [1.695, 0.081, 0.081, 0.104, -0.002], [1.725, 0.073, 0.067, 0.095, -0.004], [1.75, 0.054, 0.045, 0.07, -0.006], [1.764, 0.026, 0.02, 0.032, -0.008]];
  const headRings = H.map(([y, w, d, b, zc]) => ({ c: [0, y, zc], w, d, b, s: y > 1.7 ? 2.1 : 2.15 }));
  const SC = { // 'ring,side' → [dz, x-scale]   side 0 = the centre line, 1 = ±10°, 2 = ±22°, 3 = ±38°, 4 = ±58°
    '1,0': [0.008, 1], '1,1': [0.007, 1], '1,2': [0.003, 1],
    '2,0': [0.006, 1], '2,1': [0.005, 1], '2,2': [-0.002, 1], '3,0': [0.006, 1], '3,1': [0.005, 1], '3,2': [-0.002, 1],
    '4,0': [0.01, 1], '4,1': [0.006, 1], '5,0': [0.022, 1], '5,1': [0.011, 1], '5,2': [0.001, 1],
    '6,0': [0.014, 1], '6,1': [0.003, 1], '6,3': [0.002, 1.04], '6,4': [0, 1.04],
    '7,0': [0.007, 1], '7,1': [0.0, 1], '7,2': [-0.0035, 1], '7,3': [-0.0025, 1], '7,4': [-0.001, 1],
    '8,0': [0.003, 1], '8,1': [0.003, 1], '8,2': [0.0025, 1], '8,3': [0.002, 1],
    '2,4': [0, 1.03], '3,4': [0, 1.03], '2,5': [0, 1.02], '3,5': [0, 1.02],
  };
  const sideOf = (i) => (i <= 8 ? i : 16 - i);
  const headMod = (p, a, k, i) => {
    const e = SC[k + ',' + sideOf(i)];
    if (e) { p.z += e[0] * (fem && i === 0 && k === 5 ? 0.82 : 1); p.x *= e[1]; }
  };
  const faceUV = (p) => [0.5 + p.x / (2 * FACE_BOX.x), (p.y - FACE_BOX.y0) / FACE_BOX.h];
  const head = loft(headRings, { angles: HA, axis: 'y', mod: headMod, cap0: 'skin', cap1: 'skin', uv: faceUV, mat: (a, k) => (Math.abs(a) < 1.75 && k >= 1 && k <= 9 ? 'face' : 'skin') });
  addHead(head, ['Head']);
  for (const sx of [1, -1]) { // ears
    const g = facet(new THREE.SphereGeometry(1, 5, 4)); g.scale(0.011, 0.026, 0.018); g.rotateY(sx * 0.35); g.translate(sx * 0.081, 1.637 + HY, -0.008); add(g, 'skin', ['Head']);
  }

  // ---- hair: a shell over the skull whose edge tucks under the skin along the hairline
  const hair = L.hair || 'short';
  const HP = head.pts;
  const hairline = (a, style, i) => { // the height the hair comes down to, by angle (0 = front); the front edge zigzags into a fringe
    const f = Math.abs(a), zig = f < 0.75 ? (i % 2 ? -0.02 : 0.002) : 0;
    if (style === 'long') return (f < 0.5 ? 1.708 : f < 1.3 ? lerp(1.7, 1.6, (f - 0.5) / 0.8) : 1.58) + zig;
    if (style === 'tied') return f < 0.6 ? 1.71 : f < 1.35 ? lerp(1.704, 1.645, (f - 0.6) / 0.75) : f < 2.2 ? lerp(1.645, 1.61, (f - 1.35) / 0.85) : 1.6;
    return (f < 0.6 ? 1.708 : f < 1.35 ? lerp(1.702, 1.636, (f - 0.6) / 0.75) : f < 2.2 ? lerp(1.636, 1.6, (f - 1.35) / 0.85) : 1.586) + zig;
  };
  if (hair !== 'none') {
    const vol = hair === 'tied' ? 0.006 : 0.012, H0 = 3;
    const hr = headRings.slice(H0).map((r) => {
      const y = r.c[1], top = sm(1.66, 1.76, y);
      return { c: [r.c[0], y + top * 0.006, r.c[2] - 0.002], w: r.w + 0.008 + top * vol * 0.6, d: r.d + 0.007 + top * vol * 0.5, b: r.b + 0.01 + top * vol, s: 2.25 };
    });
    const hairMod = (p, a, k, i) => {
      const h = HP[k + H0][i];
      if (p.y < hairline(a, hair, i)) p.set(h.x * 0.95, h.y, h.z * 0.95 - (h.z > 0 ? 0.002 : 0)); // tucked under the skin: the edge vanishes into the head
      else if (Math.abs(a) < 0.75 && k + H0 >= 8) p.z += 0.004; // a little lift at the fringe
    };
    addHead(loft(hr, { angles: HA, axis: 'y', mod: hairMod, cap1: 'hair', tip1: 0.004, mat: 'hair' }), ['Head']);
    if (hair === 'long') { // a curtain falling behind the shoulders, open at the face
      const cur = [[1.66, 0.09, 0.08, 0.11], [1.6, 0.096, 0.07, 0.112], [1.53, 0.1, 0.06, 0.11], [1.46, 0.11, 0.05, 0.1], [1.4, 0.115, 0.03, 0.09]];
      addHead(loft(cur.map(([y, w, d, b]) => ({ c: [0, y, -0.01], w, d, b, s: 2.4 })), { n: 12, axis: 'y', arc: [1.15, TAU - 1.15], mat: 'hair', mod: (p, a, k) => { p.x += Math.sign(p.x) * Math.sin(k * 1.7) * 0.004; } }), ['Neck', 'Head', 'Spine2']);
    }
    if (hair === 'tied') { // a bun at the crown
      const g = facet(new THREE.IcosahedronGeometry(0.036, 0)); g.scale(1, 0.85, 0.9); g.translate(0, 1.722 + HY, -0.09); add(g, 'hair', ['Head']);
    }
  }
  if (L.beard) { // a jaw beard and moustache, chunky like the hair
    const BR = [[1.5, 0.026, 0.05, 0.03, 0.04], [1.522, 0.05, 0.08, 0.05, 0.02], [1.548, 0.068, 0.1, 0.07, 0.008], [1.572, 0.077, 0.1, 0.082, 0.006], [1.6, 0.083, 0.094, 0.092, 0.004], [1.628, 0.085, 0.086, 0.1, 0.002]];
    addHead(loft(BR.map(([y, w, d, b, zc]) => ({ c: [0, y, zc], w: w * jw, d, b, s: 2.3 })), {
      n: 16, axis: 'y', arc: [-1.9, 1.9], mat: (a, k) => (k >= 2 && Math.abs(a) < 0.62 ? null : 'hair'), // the mouth stays clear
      mod: (p, a, k) => { if (k >= 4) p.lerp(new V3(p.x * 0.97, p.y, p.z - 0.004), Math.abs(a) < 1.3 ? 0.9 : 0); },
    }), ['Head']);
    const g = new THREE.BufferGeometry(); // moustache: a shallow chevron over the lip
    const m = [[-0.026, 1.578, 0.084], [0, 1.594, 0.107], [0, 1.586, 0.108], [0.026, 1.578, 0.084]];
    const v = (q) => new V3(...q), M0 = v(m[0]), M1 = v(m[1]), M2 = v(m[2]), M3 = v(m[3]);
    const pts = [M0, M1, M2, M2, M1, M3];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pts.length * 2).fill(0), 2));
    g.translate(0, HY, 0); g.computeVertexNormals(); add(g, 'hair', ['Head']);
  }
  if (L.hood === true || L.hood === 'up') { // a deep hood and cowl, open at the face
    const HD = [[1.36, 0.215, 0.135, 0.145, 0], [1.42, 0.172, 0.12, 0.128, 0], [1.475, 0.112, 0.104, 0.11, 0], [1.55, 0.106, 0.118, 0.12, 0.004],
      [1.625, 0.112, 0.124, 0.126, 0.002], [1.695, 0.108, 0.122, 0.13, -0.002], [1.748, 0.088, 0.104, 0.126, -0.01], [1.785, 0.056, 0.064, 0.108, -0.032], [1.806, 0.02, 0.02, 0.062, -0.07]];
    addHead(loft(HD.map(([y, w, d, b, zc]) => ({ c: [0, y, zc], w, d, b, s: 2.1 })), {
      n: 16, axis: 'y', cap1: 'hood', mat: (a, k) => (k >= 3 && k <= 5 && Math.abs(a) < 0.95 ? null : 'hood'),
      mod: (p, a, k) => {
        const f = Math.max(0, Math.cos(a));
        if (k === 6 && Math.abs(a) < 1.2) { p.z += 0.012 * f; p.y -= 0.03 * f * f; } // the brim drops to the brows
        if (k === 3 && Math.abs(a) < 1.1) { p.z -= 0.01; p.y -= 0.012 * f; }
        if (k <= 1) p.y -= 0.014 * f;
        if (k === 0 || k === 1) { const fold = Math.sin(a * 5) * 0.006; p.x += Math.sign(p.x) * fold; } // folds in the cowl
      },
    }), ['Spine2', 'Neck', 'Head']);
  }

  // ---- arms (left, mirrored): shoulder → deltoid → elbow → wrist, then a hand with a thumb
  const AR = [[0.12, 0.066, 0.066, 0.066], [0.165, 0.064, 0.062, 0.062], [0.215, 0.056, 0.055, 0.056], [0.3, 0.048, 0.05, 0.05], [0.385, 0.041, 0.043, 0.043],
    [0.425, 0.035, 0.037, 0.038], [0.47, 0.037, 0.041, 0.039], [0.54, 0.035, 0.038, 0.036], [0.61, 0.028, 0.032, 0.03], [0.645, 0.024, 0.029, 0.028]];
  const sleeveTo = O.robe || O.plate ? 0.6 : O.sleeve || 0.2; // x where bare skin begins
  const armMat = (a, k) => (AR[k][0] < sleeveTo ? (O.sleeveMat || torsoMat) : 'skin');
  const armK = (x) => (x < 0.43 ? lw * fw : lerp(lw, 1, 0.4) * fw);
  both(loft(AR.map(([x, w, d, b]) => ({ c: [x, 1.4 - Math.max(0, 0.18 - x) * 0.05, 0], w: w * armK(x), d: d * armK(x), b: b * armK(x) })), { n: 8, axis: 'x', mat: armMat, phase: TAU / 16 }), ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']);
  if (sleeveTo < 0.5) both(loft([0, 1].map((t) => { const x = sleeveTo - 0.012 + t * 0.024, r = AR.reduce((a, q) => (q[0] <= x ? q : a)); return { c: [x, 1.4, 0], w: r[1] * armK(x) + 0.005, d: r[2] * armK(x) + 0.005, b: r[3] * armK(x) + 0.005 }; }), { n: 8, axis: 'x', phase: TAU / 16, mat: O.cuffMat || 'dress' }), ['LeftArm']);
  const HN = [[0.64, 0.02, 0.027, 0.027, 1.4], [0.668, 0.022, 0.04, 0.034, 1.399], [0.7, 0.018, 0.041, 0.035, 1.398], [0.727, 0.015, 0.039, 0.033, 1.396], [0.756, 0.011, 0.032, 0.028, 1.393]];
  const handMat = O.gloves ? 'leather' : 'skin';
  both(loft(HN.map(([x, w, d, b, y]) => ({ c: [x, y, 0], w: w * fw, d: d * fw, b: b * fw, s: 2.8 })), { n: 6, axis: 'x', cap1: handMat, tip1: 0.004, mat: handMat }), ['LeftForeArm', 'LeftHand']);
  both(loft([{ c: [0.662, 1.395, 0.026], w: 0.012 * fw, d: 0.012 * fw }, { c: [0.688, 1.389, 0.046], w: 0.0105 * fw, d: 0.011 * fw }, { c: [0.708, 1.386, 0.06], w: 0.009 * fw, d: 0.009 * fw }], { n: 5, axis: 'x', cap1: handMat, mat: handMat }), ['LeftHand']);
  // bracers: a leather shell over the forearm with a raised cuff
  if (!O.robe) both(loft([[0.5, 0.043, 0.047, 0.045], [0.53, 0.042, 0.045, 0.044], [0.6, 0.034, 0.038, 0.036], [0.635, 0.031, 0.035, 0.034], [0.642, 0.036, 0.039, 0.038]]
    .map(([x, w, d, b]) => ({ c: [x, 1.4, 0], w: w * armK(x), d: d * armK(x), b: b * armK(x) })), { n: 8, axis: 'x', phase: TAU / 16, mat: O.plate ? 'steel' : 'leather' }), ['LeftForeArm', 'LeftHand']);
  else both(loft([[0.52, 0.042, 0.046, 0.044], [0.6, 0.05, 0.054, 0.052], [0.645, 0.062, 0.066, 0.064]].map(([x, w, d, b]) => ({ c: [x, 1.4, 0], w: w * fw, d: d * fw, b: b * fw })), { n: 8, axis: 'x', phase: TAU / 16, mat: 'dress' }), ['LeftForeArm', 'LeftHand']);
  if (!O.noPauldron) { // a pauldron of overlapping plates
    const big = O.plate ? 1.25 : 1;
    for (const [dx, dy, r] of [[0, 0, 0.074], [0.03, -0.024, 0.062]]) {
      const g = facet(new THREE.SphereGeometry(r * big * lw, 7, 4, 0, TAU, 0, Math.PI * 0.5)); g.scale(1.05, 0.62, 1.0); g.rotateZ(-0.42); g.translate(0.17 * bw + dx, 1.43 + dy, 0);
      both({ [O.fur ? 'leather' : 'steel']: g }, ['LeftShoulder', 'LeftArm']);
    }
  }

  // ---- legs (left, mirrored): hip → knee → calf → ankle
  const LG = [[0.96, 0.088, 0.09, 0.092, 0.095], [0.86, 0.084, 0.084, 0.088, 0.094], [0.74, 0.072, 0.074, 0.078, 0.092], [0.62, 0.06, 0.062, 0.064, 0.09], [0.53, 0.052, 0.056, 0.054, 0.089],
    [0.47, 0.051, 0.052, 0.062, 0.089], [0.38, 0.053, 0.05, 0.066, 0.089], [0.27, 0.044, 0.042, 0.05, 0.089], [0.16, 0.036, 0.036, 0.038, 0.089], [0.09, 0.034, 0.036, 0.036, 0.089]];
  const legK = (y) => (y > 0.5 ? lw * fw * (fem ? 1.06 : 1) : lerp(1, lw, 0.6) * fw);
  both(loft(LG.map(([y, w, d, b, x]) => ({ c: [x, y, 0], w: w * legK(y), d: d * legK(y), b: b * legK(y), s: 2.2 })), { n: 8, axis: 'y', mat: 'white' }), ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot']);
  // boots: a shell from below the knee, a turned cuff, then the foot
  const bootMat = O.plate ? 'steel' : 'leather';
  const BT = [[0.47, 0.064, 0.064, 0.072], [0.45, 0.058, 0.057, 0.069], [0.38, 0.059, 0.056, 0.071], [0.27, 0.05, 0.048, 0.056], [0.16, 0.042, 0.042, 0.044], [0.1, 0.041, 0.043, 0.042], [0.06, 0.042, 0.05, 0.044]];
  both(loft(BT.map(([y, w, d, b]) => ({ c: [0.089, y, 0], w: w * legK(y), d: d * legK(y), b: b * legK(y), s: 2.2 })), { n: 8, axis: 'y', mat: bootMat }), ['LeftUpLeg', 'LeftLeg', 'LeftFoot']);
  const FT = [[-0.058, 0.036, 0.036, 0.04, 0.046], [-0.025, 0.041, 0.05, 0.046, 0.05], [0.035, 0.045, 0.036, 0.036, 0.04], [0.095, 0.043, 0.028, 0.027, 0.03], [0.145, 0.034, 0.02, 0.021, 0.022]];
  both(loft(FT.map(([z, w, d, b, y]) => ({ c: [0.089, y, z], w: w * fw, d, b, s: 3 })), { n: 8, axis: 'z', cap0: bootMat, cap1: bootMat, tip1: 0.012, mat: bootMat }), ['LeftLeg', 'LeftFoot', 'LeftToeBase']);
  // strap and buckle across each boot
  both(loft([{ c: [0.089, 0.205, 0], w: 0.047 * legK(0.2), d: 0.046 * legK(0.2), b: 0.05 * legK(0.2) }, { c: [0.089, 0.225, 0], w: 0.049 * legK(0.22), d: 0.048 * legK(0.22), b: 0.052 * legK(0.22) }], { n: 8, axis: 'y', mat: 'white' }), ['LeftLeg']);

  // ---- tunic skirt, belt, chest strap, collar
  const hem = O.robe ? 0.46 : O.plate ? 0.66 : 0.8;
  const SK = []; for (let k = 0; k <= 4; k++) { const t = k / 4, y = lerp(1.0, hem, t); SK.push({ c: [0, y, -0.004 * t], w: lerp(0.15, O.robe ? 0.235 : 0.205, Math.pow(t, 0.8)) * bw, d: lerp(0.1, O.robe ? 0.17 : 0.14, Math.pow(t, 0.8)) * bw, b: lerp(0.104, O.robe ? 0.18 : 0.148, Math.pow(t, 0.8)) * bw, s: 2.3 }); }
  addAll(loft(SK, {
    n: 18, axis: 'y', mat: (a, k) => (k >= 2 && Math.abs(Math.abs(a) - Math.PI / 2) < 0.18 && !O.robe ? null : 'dress'), // split at the sides so the legs can stride
    mod: (p, a, k, i) => { const t = k / 4; const f = 1 + (i % 2 ? 0.045 : -0.02) * t; p.x *= f; p.z = (p.z + 0.004 * t) * f - 0.004 * t; },
  }), null, skirtW);
  // hem trim
  { const r = SK[4]; addAll(loft([{ c: [0, hem + 0.022, r.c[2]], w: r.w * 0.985, d: r.d * 0.985, b: r.b * 0.985, s: 2.3 }, { c: [0, hem - 0.002, r.c[2]], w: r.w * 1.02, d: r.d * 1.02, b: r.b * 1.02, s: 2.3 }],
    { n: 18, axis: 'y', mat: (a) => (Math.abs(Math.abs(a) - Math.PI / 2) < 0.18 && !O.robe ? null : O.trim || 'gold'), mod: (p, a, k, i) => { const f = 1 + (i % 2 ? 0.045 : -0.02); p.x *= f; p.z = (p.z + 0.004) * f - 0.004; } }), null, skirtW); }
  // belt
  addAll(loft([{ c: [0, 0.985, 0], w: 0.156 * bw, d: 0.1 * bw, b: 0.108 * bw, s: 2.5 }, { c: [0, 1.04, 0], w: 0.142 * bw * (fem ? 0.9 : 1) * (1 + bellyK(1.04) * 0.2), d: 0.096 * bw * (1 + bellyK(1.04) * 0.75), b: 0.096 * bw, s: 2.4 }], { n: 12, axis: 'y', mat: O.robe ? 'gold' : 'leather' }), ['Hips', 'Spine']);
  { const g = facet(new THREE.BoxGeometry(0.042, 0.04, 0.012)); g.translate(0, 1.012, 0.1 * bw * (1 + bellyK(1.012) * 0.55) + 0.006); add(g, 'gold', ['Hips', 'Spine']);
    const g2 = facet(new THREE.BoxGeometry(0.024, 0.022, 0.014)); g2.translate(0, 1.012, 0.1 * bw * (1 + bellyK(1.012) * 0.55) + 0.008); add(g2, 'leather', ['Hips', 'Spine']); }
  // a pouch on the hip
  if (!O.robe) { const g = facet(new THREE.BoxGeometry(0.05, 0.06, 0.04)); g.rotateY(0.5); g.translate(-0.14 * bw, 0.96, 0.05); add(g, 'leather', ['Hips']); }
  if (!O.plate && !O.robe) { // a strap from shoulder to hip
    const g = facet(new THREE.TorusGeometry(0.16, 0.013, 4, 20)); g.scale(bw * (fem ? 0.94 : 1.02), 1.22, 0.8 * bw); g.rotateZ(0.6); g.translate(0, 1.21, 0.004); add(g, 'leather', ['Spine1', 'Spine2']);
  }
  if (O.plate) { // breastplate
    const BP = [[1.06, 0.146, 0.104, 0.1], [1.16, 0.156, 0.118, 0.1], [1.26, 0.172, 0.126, 0.106], [1.34, 0.178, 0.116, 0.104], [1.4, 0.16, 0.088, 0.092], [1.435, 0.11, 0.064, 0.072]];
    addAll(loft(BP.map(([y, w, d, b]) => ({ c: [0, y, 0], w: w * bw, d: d * bw, b: b * bw, s: 2.5 })), { n: 12, axis: 'y', mat: 'steel', mod: (p, a) => { if (Math.abs(a) < 1) p.z += 0.01 * Math.cos(a * 1.5); } }), ['Spine', 'Spine1', 'Spine2']);
  }
  if (O.fur) { // a fur collar of tufts
    addAll(loft([{ c: [0, 1.39, -0.005], w: 0.17 * bw, d: 0.1, b: 0.11 }, { c: [0, 1.44, -0.005], w: 0.15 * bw, d: 0.1, b: 0.11 }, { c: [0, 1.48, -0.01], w: 0.09, d: 0.075, b: 0.085 }],
      { n: 16, axis: 'y', mat: 'fur', mod: (p, a, k, i) => { const f = 1 + (i % 2 ? 0.1 : -0.04) * (k === 1 ? 1 : 0.4); p.x *= f; p.z *= f; } }), ['Spine2', 'Neck']);
  }
  { // collar: a folded band round the neckline
    addAll(loft([{ c: [0, 1.43, -0.004], w: 0.072 * (fem ? 0.9 : 1), d: 0.066, b: 0.07, s: 2 }, { c: [0, 1.47, -0.004], w: 0.058 * (fem ? 0.9 : 1), d: 0.056, b: 0.062 }],
      { n: 10, axis: 'y', mat: O.robe ? 'gold' : O.collarMat || 'dress', mod: (p, a, k) => { if (Math.abs(a) < 0.45 && k === 1) p.y -= 0.03; } }), ['Spine2', 'Neck']);
  }
  if (!L.noPendant && !O.plate) { const g = facet(new THREE.OctahedronGeometry(0.013, 0)); g.scale(0.8, 1.2, 0.6); g.translate(0, 1.34, 0.118 * bw); add(g, 'gem', ['Spine2']); }
}
const lerp = (a, b, t) => a + (b - a) * t;
