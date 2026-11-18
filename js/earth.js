// LUMENFALL · 人間 — the human world beneath the cloud sea
// 1.28 km of mortal land ringed by mountains and opening east onto the sea. Survivors keep small lights burning:
// the walled town of Belldawn, a lighthouse harbour, a mountain abbey, a field watchtower. Miasma beasts hold people
// sealed in dark crystal. In the north a rift splits the land; a fallen colossus kneels over it, its sword driven
// into the dark — the way down, sealed for now.
import * as THREE from 'three';
import { EWORLD, EHALF, ESEG, EGN, ECELL, EARTH_Y, grid2, groundAtL, fbm, smooth, lerp, clamp, mulberry, TEX } from './core.js';
import { W, colliders, noReflect } from './world.js';
import { terrainDetail, strataMaterial, rockGeo, foliageMaterial } from './env.js';
import { bakeStatic } from './hero.js';

export const EP = {
  crater: { x: 20, z: -10 }, town: { x: -30, z: 330 }, mill: { x: 78, z: 408 }, lake: { x: 215, z: 330, r: 56 },
  harbor: { x: 440, z: 175 }, light: { x: 518, z: 92 }, monastery: { x: 330, z: -318 }, castle: { x: -330, z: -250 },
  swamp: { x: -395, z: 130, r: 120 }, forest: { x: -215, z: 270 }, watch: { x: 178, z: 74 },
};
// the rift: a crooked chasm across the north, tapering shut at both ends
export const riftZ = (x) => -480 + 18 * Math.sin(x * 0.012 + 0.5);
export const riftW = (x) => (22 + 8 * Math.sin(x * 0.023 + 1.3)) * smooth(-345, -270, x) * (1 - smooth(235, 300, x));
export function inRift(x, z, pad = 0) { const w = riftW(x); return w > 1 && Math.abs(z - riftZ(x)) < w + pad; }
export const SEA_NORTH = -415; // the water sheet stops short of the rift
const COLO = { x: -20, z: riftZ(-20) - riftW(-20) - 20 };
EP.colossus = COLO;

const RIVER = [[300, -392], [236, -262], [166, -132], [120, 0], [150, 110], [196, 230], [212, 296]];
const OUTFLOW = [[248, 346], [330, 320], [420, 270], [520, 256], [650, 252]];
const ROADS = [
  [[-30, 330], [-12, 232], [8, 122], [18, 24]],
  [[20, -10], [92, 32], [142, 62], [232, 112], [332, 150], [424, 172]],
  [[20, -10], [-82, -62], [-202, -152], [-296, -228]],
  [[20, -10], [120, -110], [222, -212], [306, -290]],
  [[20, -10], [2, -150], [-14, -300], [-20, -436]],
  [[-30, 330], [62, 396]],
  [[-30, 330], [-150, 302], [-262, 222], [-312, 170]],
  [[-30, 330], [100, 342], [152, 334]],
];
function segD(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1); return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
function polyD(P, x, z) { let d = 1e9; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; }
const riverD = (x, z) => Math.min(polyD(RIVER, x, z), polyD(OUTFLOW, x, z));
export function roadD(x, z) { let d = 1e9; for (const R of ROADS) d = Math.min(d, polyD(R, x, z)); return d; }
const coastX = (z) => 452 + fbm(z * 0.0075, 3.3, 2) * 50;
const openEast = (x, z) => smooth(300, 420, x) * (1 - smooth(250, 360, Math.abs(z - 130)));
const swampK = (x, z) => 1 - smooth(0.65, 1.05, Math.hypot(x - EP.swamp.x, z - EP.swamp.z) / EP.swamp.r);
const dist = (x, z, p) => Math.hypot(x - p.x, z - p.z);

export function earthH(x, z) {
  let h = 8 + fbm(x * 0.0042 + 50, z * 0.0042 - 20, 4) * 26 + fbm(x * 0.017 - 7, z * 0.017 + 3, 3) * 4;
  const rr = Math.hypot(x, z), open = openEast(x, z);
  h += smooth(470, 610, rr) * (70 + fbm(x * 0.009, z * 0.009, 3) * 80) * (1 - open); // the ring of mountains
  h += 46 * Math.exp(-((x - 350) ** 2 + (z + 370) ** 2) / 32000); // the frost ridge highlands
  h += 12 * Math.exp(-((x - EP.mill.x) ** 2 + (z - EP.mill.z) ** 2) / 1800);
  // the eastern sea, a sand spit and the lighthouse cape
  const cx = coastX(z);
  h = lerp(h, -16, smooth(cx - 40, cx + 30, x) * open);
  h = lerp(h, 3.5, (1 - smooth(7, 16, segD(x, z, 452, 150, 512, 98))) * open);
  h = lerp(h, 26, 1 - smooth(16, 30, dist(x, z, EP.light)));
  h = lerp(h, 9, 1 - smooth(5, 11, dist(x, z, { x: 566, z: -18 }))); // a sea stack
  // water: river, still lake, swamp pools
  h = lerp(-3.5, h, smooth(5, 20, riverD(x, z)));
  const la = Math.atan2(z - EP.lake.z, x - EP.lake.x);
  const ld = dist(x, z, EP.lake) / (EP.lake.r * (1 + 0.14 * Math.sin(3 * la + 1) + 0.08 * Math.sin(5 * la)));
  h = lerp(-4.5, h, smooth(0.7, 1.15, ld));
  h = lerp(h, 0.5 + fbm(x * 0.035 + 9, z * 0.035 - 4, 3) * 2.6, swampK(x, z));
  // where people built
  h = lerp(10, h, smooth(72, 100, dist(x, z, EP.town)));
  h = lerp(2.2, h, smooth(42, 72, dist(x, z, EP.harbor)));
  h = lerp(34, h, smooth(40, 56, dist(x, z, EP.castle)));
  h = lerp(72, h, smooth(34, 52, dist(x, z, EP.monastery)));
  const kd = dist(x, z, EP.crater);
  h = lerp(24, h, smooth(52, 84, kd)); // the crater sits on a low rise, its floor dry
  h += -15 * Math.exp(-((kd / 24) ** 2)) + 5 * Math.exp(-(((kd - 32) / 9) ** 2));
  // the colossus' terrace, then the rift itself
  h = lerp(16, h, smooth(34, 52, dist(x, z, COLO)));
  const w = riftW(x);
  if (w > 0.5) {
    const dz = Math.abs(z - riftZ(x));
    h = lerp(h, -175, 1 - smooth(w * 0.5, w, dz));
    h += 7 * Math.exp(-(((dz - w) / 7) ** 2)) * smooth(2, 10, w);
  }
  const rd = roadD(x, z);
  if (rd < 7 && h > 0.8) h = lerp(h - 0.25, h, smooth(2.5, 7, rd));
  return h;
}
const gi = (x, z) => clamp(Math.round((z + EHALF) / ECELL), 0, ESEG) * EGN + clamp(Math.round((x + EHALF) / ECELL), 0, ESEG);
export function buildEarthGrid() {
  const { h, mask, flower, wheat } = grid2;
  for (let iz = 0; iz < EGN; iz++) for (let ix = 0; ix < EGN; ix++) h[iz * EGN + ix] = earthH(-EHALF + ix * ECELL, -EHALF + iz * ECELL);
  for (let iz = 0; iz < EGN; iz++) for (let ix = 0; ix < EGN; ix++) {
    const i = iz * EGN + ix, x = -EHALF + ix * ECELL, z = -EHALF + iz * ECELL;
    const hx = h[iz * EGN + Math.min(EGN - 1, ix + 1)] - h[iz * EGN + Math.max(0, ix - 1)], hz = h[Math.min(EGN - 1, iz + 1) * EGN + ix] - h[Math.max(0, iz - 1) * EGN + ix];
    const slope = Math.max(Math.abs(hx), Math.abs(hz)) / (2 * ECELL);
    let m = smooth(0.6, 1.6, h[i]) * (1 - smooth(0.55, 1.0, slope));
    m *= smooth(3.5, 6, roadD(x, z));
    m *= 1 - smooth(33, 35, dist(x, z, EP.castle)) * (h[i] > 32 ? 0.8 : 0);
    m *= 0.3 + 0.7 * smooth(16, 24, dist(x, z, EP.town));
    m *= 1 - smooth(85, 110, h[i]);
    m *= 1 - 0.45 * swampK(x, z);
    if (inRift(x, z, 8)) m = 0;
    const vd = dist(x, z, EP.town);
    // fields: a tilted patchwork east and south of the town walls
    const a = 0.32, u = x * Math.cos(a) + z * Math.sin(a), v = -x * Math.sin(a) + z * Math.cos(a);
    const cu = Math.floor(u / 24), cv = Math.floor(v / 32), hash = Math.abs(Math.sin(cu * 127.1 + cv * 311.7) * 43758.5) % 1;
    const inField = smooth(76, 90, vd) * (1 - smooth(170, 200, vd)) * smooth(5, 8, roadD(x, z)) * (h[i] > 1.5 ? 1 : 0) * smooth(-140, -90, x) * smooth(14, 26, riverD(x, z)) * smooth(0.95, 1.3, dist(x, z, EP.lake) / EP.lake.r);
    wheat[i] = inField * (hash > 0.36 ? 1 : 0) * (1 - smooth(0.42, 0.5, Math.abs(((u / 24) % 1 + 1) % 1 - 0.5)));
    mask[i] = m;
    flower[i] = smooth(0.15, 0.45, fbm(x * 0.017 - 40, z * 0.017 + 12, 3)) * m * (1 - wheat[i]) * (1 - swampK(x, z));
  }
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o));
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const haze = (m, k = 0.5) => { m.defines = Object.assign({}, m.defines, { FOG_SCALE: k }); return m; }; // landmarks read through the fog

export const EARTH = { feathers: [], moreFeathers: [], enemies: [], marks: [], updrafts: [], cull: [], captives: [], beacons: [], town: null, lamps: null };

// far scenery switches off with distance; the fog has swallowed it by then
export function earthCull(cam) {
  for (const m of EARTH.cull) { const s = m.boundingSphere; m.visible = !s || cam.distanceTo(s.center) - s.radius < 540; }
}
function scatter(root, geo, material, list, { cast = true, recv = true, cell = 140 } = {}) {
  const buckets = new Map(), v = new THREE.Vector3();
  for (const it of list) {
    v.setFromMatrixPosition(it.m);
    const k = Math.floor((v.x + EHALF) / cell) + ',' + Math.floor((v.z + EHALF) / cell);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  for (const items of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, material, items.length);
    items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
    im.castShadow = cast; im.receiveShadow = recv; im.computeBoundingSphere();
    root.add(im); EARTH.cull.push(im);
  }
}

// ---------------------------------------------------------------- terrain: 8×8 chunks, two levels of detail each
function buildTerrain(root, Y) {
  const H = grid2.h, N = EGN * EGN;
  const cols = new Float32Array(N * 3), nrms = new Float32Array(N * 3);
  const cLo = new THREE.Color('#5f7d3e'), cHi = new THREE.Color('#9aa75c'), cWheat = new THREE.Color('#c9a95a'), cWheat2 = new THREE.Color('#a8a253');
  const cRoad = new THREE.Color('#b29a72'), cBed = new THREE.Color('#5f7a74'), cSand = new THREE.Color('#c8b98f'), cRock = new THREE.Color('#9a9184'), cSnow = new THREE.Color('#e9ece8');
  const cSwamp = new THREE.Color('#4f5a36'), cMud = new THREE.Color('#4b4636'), cScorch = new THREE.Color('#463a37'), cDeep = new THREE.Color('#1e1517'), cEmber = new THREE.Color('#7a2414');
  const c = new THREE.Color(), nv = new THREE.Vector3();
  for (let iz = 0; iz < EGN; iz++) for (let ix = 0; ix < EGN; ix++) {
    const i = iz * EGN + ix, x = -EHALF + ix * ECELL, z = -EHALF + iz * ECELL, h = H[i];
    const hx = H[iz * EGN + Math.min(EGN - 1, ix + 1)] - H[iz * EGN + Math.max(0, ix - 1)], hz = H[Math.min(EGN - 1, iz + 1) * EGN + ix] - H[Math.max(0, iz - 1) * EGN + ix];
    nv.set(-hx / (2 * ECELL), 1, -hz / (2 * ECELL)).normalize();
    nrms[i * 3] = nv.x; nrms[i * 3 + 1] = nv.y; nrms[i * 3 + 2] = nv.z;
    const ny = nv.y, n = fbm(x * 0.04, z * 0.04, 2) * 0.5 + 0.5;
    c.copy(cLo).lerp(cHi, clamp(n * 0.7 + smooth(5, 40, h) * 0.4, 0, 1));
    c.lerp(n > 0.5 ? cWheat : cWheat2, grid2.wheat[i] * 0.9);
    const sk = swampK(x, z); if (sk > 0) c.lerp(n > 0.45 ? cSwamp : cMud, sk * 0.85);
    c.lerp(cSand, 1 - smooth(-0.2, 1.4, h));
    if (h < -0.2) c.copy(cBed).lerp(cSand, smooth(-3, -0.2, h));
    c.lerp(cRoad, (1 - smooth(2.2, 4.2, roadD(x, z))) * (h > 0.5 ? 0.9 : 0));
    c.lerp(cRock, smooth(0.82, 0.6, ny));
    c.lerp(cSnow, smooth(78, 108, h) * smooth(0.55, 0.8, ny));
    if (inRift(x, z, 22)) {
      const w = riftW(x), dz = Math.abs(z - riftZ(x));
      c.lerp(cScorch, (1 - smooth(w * 0.85, w + 22, dz)) * 0.9);
      if (dz < w) { c.lerp(cDeep, smooth(14, -70, h)); c.lerp(cEmber, smooth(-100, -172, h)); }
    }
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  const material = terrainDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { tint: true });
  const CH = 8, CS = ESEG / CH;
  for (let cz = 0; cz < CH; cz++) for (let cx = 0; cx < CH; cx++) {
    const lod = new THREE.LOD();
    const gx0 = cx * CS, gz0 = cz * CS, wx = -EHALF + (gx0 + CS / 2) * ECELL, wz = -EHALF + (gz0 + CS / 2) * ECELL;
    lod.position.set(wx, Y, wz);
    for (const [step, far] of [[1, 0], [4, 330]]) {
      const n = CS / step + 1, pos = [], nor = [], col = [], idx = [];
      const vert = (gx, gz, dy = 0) => { const i = gz * EGN + gx; pos.push(-EHALF + gx * ECELL - wx, H[i] + dy, -EHALF + gz * ECELL - wz); nor.push(nrms[i * 3], nrms[i * 3 + 1], nrms[i * 3 + 2]); col.push(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]); return pos.length / 3 - 1; };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vert(gx0 + i * step, gz0 + j * step);
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = (j + 1) * n + i, cc = (j + 1) * n + i + 1, d = j * n + i + 1; idx.push(a, b, d, b, cc, d); }
      if (step > 1) { // skirts hide the cracks against finer neighbours
        const edge = [];
        for (let i = 0; i < n; i++) edge.push([i, 0]); for (let j = 1; j < n; j++) edge.push([n - 1, j]);
        for (let i = n - 2; i >= 0; i--) edge.push([i, n - 1]); for (let j = n - 2; j > 0; j--) edge.push([0, j]);
        edge.push(edge[0]);
        let prevTop = -1, prevBot = -1;
        for (const [i, j] of edge) {
          const top = j * n + i, bot = vert(gx0 + i * step, gz0 + j * step, -7);
          if (prevTop >= 0) idx.push(prevTop, top, prevBot, top, bot, prevBot, prevTop, prevBot, top, top, prevBot, bot);
          prevTop = top; prevBot = bot;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material); m.receiveShadow = true;
      lod.addLevel(m, far);
    }
    root.add(lod);
  }
  // grass heightmap (relative heights; the grass shader adds the layer's base)
  const data = new Uint16Array(N * 4), Hf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < N; i++) { data[i * 4] = Hf(H[i]); data[i * 4 + 1] = Hf(grid2.mask[i]); data[i * 4 + 2] = Hf(grid2.flower[i]); data[i * 4 + 3] = Hf(grid2.wheat[i]); }
  const tex = new THREE.DataTexture(data, EGN, EGN, THREE.RGBAFormat, THREE.HalfFloatType); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  EARTH.heightTex = tex;
}

export function buildEarth(scene) {
  const R = mulberry(777);
  const Y = EARTH_Y;
  const gA = (x, z) => groundAtL(x, z, 1);
  const root = new THREE.Group(); root.name = 'earth'; scene.add(root);
  EARTH.root = root;
  buildTerrain(root, Y);
  // ---- water: the sea, the river and the lake share one sheet at the waterline (it stops before the rift)
  const wd = EHALF - SEA_NORTH;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(EWORLD, wd), W.water.simple.material);
  water.rotation.x = -Math.PI / 2; water.position.set(0, Y - 0.05, SEA_NORTH + wd / 2); root.add(water);
  EARTH.water = water;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), c = new THREE.Color();
  const M = (x, y, z, rx, ry, rz, sx, sy, sz) => { e.set(rx, ry, rz); q.setFromEuler(e); return new THREE.Matrix4().compose(pv.set(x, y, z), q, sv.set(sx, sy, sz)); };
  const H0 = (x, z) => grid2.h[gi(x, z)];
  const near = (x, z, p, r) => dist(x, z, p) < r;
  const built = [EP.town, EP.castle, EP.crater, EP.harbor, EP.monastery, EP.watch, COLO, EP.light];
  const builtR = [78, 54, 44, 52, 50, 18, 46, 30];

  // ---- trees: the whispering wood, scattered copses, darker firs on the frost ridge
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.4, 1, 7, 2); trunkGeo.translate(0, 0.5, 0);
  const trunkMat = mat('#6f5e4c', { roughness: 0.9 });
  const leafMat = foliageMaterial(W.leafTex);
  const pal = ['#56783a', '#668a40', '#4a6a34', '#7d9446', '#8f8a3c', '#a57a3a'].map((h) => new THREE.Color(h));
  const palFir = ['#3f5a36', '#36503a', '#4a6340'].map((h) => new THREE.Color(h));
  const trunks = [], crowns = [], spots = [];
  const okTree = (x, z) => {
    const h = H0(x, z);
    if (h < 1.5 || h > 95 || roadD(x, z) < 6 || inRift(x, z, 26) || swampK(x, z) > 0.2) return false;
    for (let i = 0; i < built.length; i++) if (near(x, z, built[i], builtR[i])) return false;
    if (grid2.wheat[gi(x, z)] > 0.2 || grid2.mask[gi(x, z)] < 0.25) return false;
    for (const s of spots) if (Math.abs(s[0] - x) < 6.5 && Math.abs(s[1] - z) < 6.5 && Math.hypot(s[0] - x, s[1] - z) < 6.5) return false;
    return true;
  };
  let guard = 0;
  while (spots.length < 560 && guard++ < 26000) {
    const k = R();
    let x, z;
    if (k < 0.55) { const a = R() * 6.28, r = Math.sqrt(R()) * 175; x = EP.forest.x + Math.cos(a) * r * 1.2; z = EP.forest.z + Math.sin(a) * r * 0.9; }
    else if (k < 0.68) { const a = R() * 6.28, r = Math.sqrt(R()) * 120; x = 330 + Math.cos(a) * r; z = -220 + Math.sin(a) * r; }
    else { x = (R() * 2 - 1) * 540; z = (R() * 2 - 1) * 540; }
    if (Math.hypot(x, z) > 560 || !okTree(x, z)) continue;
    const fir = x > 180 && z < -120, g = gA(x, z), Ht = fir ? 9 + R() * 7 : 7 + R() * 8;
    trunks.push({ m: M(x, g - 0.3, z, (R() - 0.5) * 0.1, R() * 6.28, (R() - 0.5) * 0.1, 1 + Ht * 0.05, Ht, 1 + Ht * 0.05) });
    const base = (fir ? palFir : pal)[Math.floor(R() * (fir ? 3 : pal.length))], kk = 3 + Math.floor(R() * 2), cs = 0.9 + Ht * 0.06;
    for (let j = 0; j < kk; j++) {
      const a = R() * 6.28, rr = j ? (fir ? 0.8 : 1.2 + R()) * cs : 0, sz = (j ? 2 + R() : 3.2) * cs * (fir ? 0.8 : 1);
      const yy = fir ? g + Ht * (0.35 + j * 0.2) : g + Ht - 0.6 + (j ? (R() - 0.5) * 1.8 : 1);
      crowns.push({ m: M(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, R() - 0.5, R() * 6, R() - 0.5, sz, sz * (fir ? 1.2 : 0.9), sz), c: c.copy(base).multiplyScalar(0.85 + R() * 0.3).clone() });
    }
    spots.push([x, z]); colliders.solids.push({ x, z, r: 0.6, y0: g - 1, y1: g + Ht });
  }
  scatter(root, trunkGeo, trunkMat, trunks, { cast: true, recv: false });
  scatter(root, W.canopyGeo, leafMat, crowns, { cast: true, recv: true });
  // dead trees in the swamp: bare trunks with crooked limbs
  {
    const parts = [];
    const t0 = new THREE.CylinderGeometry(0.12, 0.42, 1, 6, 1); t0.translate(0, 0.5, 0); parts.push(t0);
    for (const [y, a, l] of [[0.55, 0.7, 0.42], [0.72, -0.9, 0.34], [0.86, 2.2, 0.28]]) { const b = new THREE.CylinderGeometry(0.05, 0.1, l, 5, 1); b.translate(0, l / 2, 0); b.rotateZ(a > 0 ? -0.9 : 0.9); b.rotateY(a); b.translate(0, y, 0); parts.push(b); }
    const g = mergeAll(parts);
    const list = [];
    for (let i = 0, tries = 0; i < 80 && tries < 3000; tries++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * EP.swamp.r * 1.05, x = EP.swamp.x + Math.cos(a) * r, z = EP.swamp.z + Math.sin(a) * r;
      if (H0(x, z) < 0.2 || roadD(x, z) < 5) continue;
      const Ht = 5 + R() * 7; i++;
      list.push({ m: M(x, gA(x, z) - 0.4, z, (R() - 0.5) * 0.35, R() * 6.28, (R() - 0.5) * 0.35, Ht * 0.12, Ht, Ht * 0.12) });
      colliders.solids.push({ x, z, r: 0.5, y0: gA(x, z) - 1, y1: gA(x, z) + Ht });
    }
    scatter(root, g, mat('#3b342e', { roughness: 0.95 }), list, { cast: true, recv: false });
  }
  // boulders, and black spires along the rift's lips
  {
    const list = [], spires = [];
    for (let i = 0, tries = 0; i < 170 && tries < 6000; tries++) {
      const x = (R() * 2 - 1) * 560, z = (R() * 2 - 1) * 560;
      if (Math.hypot(x, z) > 580 || roadD(x, z) < 6 || inRift(x, z, 6) || H0(x, z) < 1) continue;
      let ok = true; for (let k = 0; k < built.length; k++) if (near(x, z, built[k], builtR[k] * 0.8)) ok = false;
      if (!ok) continue;
      const g = gA(x, z), sc = 0.8 + R() * 3.2; i++;
      list.push({ m: M(x, g + sc * 0.2, z, R(), R() * 6, R(), sc * (1 + R()), sc * 0.7, sc * (1 + R())) });
      if (sc > 1.8) colliders.solids.push({ x, z, r: sc * 1.1, y0: g - 1, y1: g + sc });
    }
    for (let i = 0; i < 70; i++) {
      const x = -330 + R() * 620, w = riftW(x); if (w < 6) continue;
      const side = R() < 0.5 ? -1 : 1, z = riftZ(x) + side * (w + 3 + R() * 10);
      if (near(x, z, COLO, 30)) continue;
      const g = gA(x, z), hh = 4 + R() * 12;
      spires.push({ m: M(x, g + hh * 0.3, z, (R() - 0.5) * 0.5, R() * 6, side * (0.15 + R() * 0.3), 1.4 + R(), hh, 1.4 + R()) });
    }
    scatter(root, rockGeo(31, 2), W.rockMat, list, { cast: true, recv: true });
    scatter(root, rockGeo(57, 2), mat('#3a3236', { roughness: 0.9, map: TEX.marble }), spires, { cast: true, recv: true });
  }

  // ---- shared building kit
  const wallM = mat('#ece2cd', { map: TEX.marble, roughness: 0.9 }), roofM = mat('#a5583a', { roughness: 0.75 }), roofM2 = mat('#7d5a46'), roofSea = mat('#5f707c', { roughness: 0.7 });
  const woodM = mat('#6b5240'), winM = new THREE.MeshStandardMaterial({ color: '#ffd98f', emissive: '#ffb352', emissiveIntensity: 1.6 });
  const house = (grp, x, z, base, w, d, hgt, rot, roof = roofM) => {
    const g = new THREE.Group(); g.position.set(x, base, z); g.rotation.y = rot;
    const body = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wallM)); body.position.y = hgt / 2; g.add(body);
    const roofMesh = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.72, w * 0.72, d + 0.8, 3, 1), roof));
    roofMesh.rotation.set(Math.PI / 2, 0, Math.PI / 2); roofMesh.scale.set(1, 1, 0.62); roofMesh.position.y = hgt + w * 0.2; g.add(roofMesh);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.12), woodM); door.position.set(0, 1.0, d / 2 + 0.02); g.add(door);
    for (const sx of [-w * 0.3, w * 0.3]) { const wi = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), winM); wi.position.set(sx, hgt * 0.62, d / 2 + 0.03); g.add(wi); }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2, 0.7), wallM); chim.position.set(w * 0.25, hgt + w * 0.35, -d * 0.2); g.add(chim);
    grp.add(g);
    colliders.solids.push({ x, z, r: Math.max(w, d) * 0.62, y0: base - 1, y1: base + hgt + 2 });
  };
  const watchTower = (grp, x, z, base, H = 8) => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.35, H + 2.5, 0.35), woodM)); p.position.set(x + sx * 1.6, base + (H + 2.5) / 2, z + sz * 1.6); grp.add(p); }
    const deck = shadowy(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 4.2), woodM)); deck.position.set(x, base + H, z); grp.add(deck);
    for (const [rx, rz, w, d] of [[0, -2, 4.2, 0.15], [0, 2, 4.2, 0.15], [-2, 0, 0.15, 4.2], [2, 0, 0.15, 4.2]]) { const rail = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), woodM)); rail.position.set(x + rx, base + H + 0.9, z + rz); grp.add(rail); }
    const rf = shadowy(new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.2, 4), roofM2)); rf.position.set(x, base + H + 3.6, z); rf.rotation.y = Math.PI / 4; grp.add(rf);
    colliders.solids.push({ x, z, r: 2.4, y0: base - 1, y1: base + H });
    colliders.pads.push({ x, z, r: 2.2, top: base + H + 0.15, bot: base + H - 1 });
  };
  const lamps = []; // street lanterns that light up as people come home
  const lampPost = (grp, x, z, base, h = 3) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), woodM); post.position.set(x, base + h / 2, z); grp.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), woodM); arm.position.set(x + 0.25, base + h - 0.1, z); grp.add(arm);
    lamps.push(new THREE.Vector3(x + 0.5, base + h - 0.45, z));
  };

  // ---- 晨鐘堡 · Belldawn Hold, the last walled town
  const T = EP.town, vg = Y + 10;
  const town = new THREE.Group();
  [[14, 0.2], [15, 1.1], [13, 2.0], [16, 2.9], [14, 3.8], [15, 4.7], [25, 0.6], [27, 1.6], [26, 2.5], [28, 3.4], [25, 4.4], [27, 5.4],
    [36, 0.2], [38, 1.1], [37, 2.0], [39, 2.6], [36, 3.6], [38, 4.4], [37, 5.2], [46, 0.9], [47, 1.9], [46, 3.1], [48, 4.0], [46, 5.0]].forEach(([r, a]) => {
    const x = T.x + Math.cos(a) * r, z = T.z + Math.sin(a) * r;
    if (roadD(x, z) < 5.5 || dist(x, z, { x: T.x - 8, z: T.z - 26 }) < 11) return;
    house(town, x, z, vg, 5 + R() * 2.5, 6 + R() * 3, 3.6 + R() * 1.6, -a + Math.PI / 2 + (R() - 0.5) * 0.4, R() < 0.25 ? roofM2 : roofM);
  });
  { // the chapel of the morning bell
    const g = new THREE.Group(); g.position.set(T.x - 8, vg, T.z - 26);
    const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(8, 8, 13), wallM)); b.position.y = 4; g.add(b);
    const rf = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 13.6, 3), roofM2)); rf.rotation.set(Math.PI / 2, 0, Math.PI / 2); rf.scale.set(1, 1, 0.65); rf.position.y = 9.8; g.add(rf);
    const tw = shadowy(new THREE.Mesh(new THREE.BoxGeometry(3.6, 16, 3.6), wallM)); tw.position.set(0, 8, -7.5); g.add(tw);
    const sp = shadowy(new THREE.Mesh(new THREE.ConeGeometry(3, 7, 4), roofM2)); sp.position.set(0, 19.5, -7.5); sp.rotation.y = Math.PI / 4; g.add(sp);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d7b468', { metalness: 0.9, roughness: 0.3 })); bell.rotation.x = Math.PI; bell.position.set(0, 14.5, -7.5); g.add(bell);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), winM); rose.position.set(0, 10.6, 6.52); g.add(rose);
    g.rotation.y = 0.12; town.add(g);
    colliders.solids.push({ x: T.x - 8, z: T.z - 26, r: 7, y0: vg - 1, y1: vg + 20 });
    EARTH.feathers.push([T.x - 8 + Math.sin(0.12) * -7.5, vg + 24, T.z - 26 - 7.5]);
  }
  { // well + plaza lanterns
    const well = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 1.1, 16), wallM)); well.position.set(T.x, vg + 0.55, T.z); town.add(well);
    const rf = shadowy(new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 4), roofM)); rf.position.set(T.x, vg + 3.3, T.z); rf.rotation.y = Math.PI / 4; town.add(rf);
    for (const sx of [-1.3, 1.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.8, 0.15), woodM); p.position.set(T.x + sx, vg + 1.4, T.z); town.add(p); }
    colliders.solids.push({ x: T.x, z: T.z, r: 1.6, y0: vg - 1, y1: vg + 3 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28 + 0.3, x = T.x + Math.cos(a) * 9, z = T.z + Math.sin(a) * 9; lampPost(town, x, z, vg); }
    for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28 + 0.1, x = T.x + Math.cos(a) * 31, z = T.z + Math.sin(a) * 31; if (roadD(x, z) > 3) lampPost(town, x, z, vg); }
  }
  { // the palisade: stakes ring the town; the roads leave gaps that become its gates
    const stakes = [];
    for (let a = 0; a < Math.PI * 2; a += 0.0105) {
      const x = T.x + Math.cos(a) * 64, z = T.z + Math.sin(a) * 64;
      if (roadD(x, z) < 6.5) continue;
      const g = gA(x, z), hh = 2.4 + R() * 0.7;
      stakes.push({ m: M(x, g - 0.4, z, (R() - 0.5) * 0.06, R() * 6, (R() - 0.5) * 0.06, 0.85, hh, 0.85) });
      if (stakes.length % 6 === 0) colliders.solids.push({ x, z, r: 2.2, y0: g - 1, y1: g + hh });
    }
    const sg = new THREE.CylinderGeometry(0.28, 0.32, 1, 6, 1); sg.translate(0, 0.5, 0);
    const tip = new THREE.ConeGeometry(0.3, 0.6, 6, 1); tip.translate(0, 1.25, 0);
    scatter(root, mergeAll([sg, tip.scale(1, 0.8, 1)]), mat('#8a6d52', { roughness: 0.9 }), stakes, { cast: true, recv: true, cell: 400 });
    for (const R2 of [ROADS[0], ROADS[5], ROADS[6], ROADS[7]]) { // a watchtower beside each gate
      const [ax, az] = R2[0], [bx, bz] = R2[1], L = Math.hypot(bx - ax, bz - az), t = 64 / L, gx = ax + (bx - ax) * t, gz = az + (bz - az) * t;
      const px = -(bz - az) / L, pz = (bx - ax) / L;
      watchTower(town, gx + px * 9, gz + pz * 9, gA(gx + px * 9, gz + pz * 9), 7);
      lamps.push(new THREE.Vector3(gx + px * 9, gA(gx + px * 9, gz + pz * 9) + 9.2, gz + pz * 9));
    }
  }
  root.add(town); bakeStatic(town);
  EARTH.town = { x: T.x, z: T.z, y: vg, slots: [[6, 8], [-8, 7], [11, -3], [-4, -11], [17, 9], [-16, 2], [3, 17], [-12, 15]] };
  // windmill on the hill
  {
    const Mi = EP.mill, mg = gA(Mi.x, Mi.z);
    const tw = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 11, 10), wallM)); tw.position.set(Mi.x, mg + 5.5, Mi.z); root.add(tw);
    const cap = shadowy(new THREE.Mesh(new THREE.ConeGeometry(3, 3, 10), roofM)); cap.position.set(Mi.x, mg + 12.5, Mi.z); root.add(cap);
    const hub = new THREE.Group(); hub.position.set(Mi.x, mg + 10, Mi.z + 3.1); root.add(hub);
    for (let i = 0; i < 4; i++) { const bl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 0.12), mat('#e8dcc4'))); bl.position.y = 4.2; const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; arm.add(bl); hub.add(arm); }
    W.animated.push((t) => { hub.rotation.z = t * 0.5; });
    colliders.solids.push({ x: Mi.x, z: Mi.z, r: 3, y0: mg - 1, y1: mg + 12 });
    EARTH.feathers.push([Mi.x + 2, mg + 15, Mi.z]);
    EARTH.updrafts.push({ x: Mi.x - 7, z: Mi.z - 4, top: mg + 22, g: gA(Mi.x - 7, Mi.z - 4) });
  }
  // a bridge where the harbour road crosses the river
  {
    const Rd = ROADS[1]; let best = null;
    for (let i = 0; i < Rd.length - 1; i++) for (let t = 0; t <= 1; t += 0.01) { const x = lerp(Rd[i][0], Rd[i + 1][0], t), z = lerp(Rd[i][1], Rd[i + 1][1], t), d = riverD(x, z); if (!best || d < best.d) best = { d, x, z, a: Math.atan2(Rd[i + 1][0] - Rd[i][0], Rd[i + 1][1] - Rd[i][1]) }; }
    const deck = shadowy(new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 30), mat('#9c8d7a', { map: TEX.marble })));
    deck.position.set(best.x, Y + 1.4, best.z); deck.rotation.y = best.a; root.add(deck);
    for (const s of [-1, 1]) { const rl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 30), mat('#9c8d7a', { map: TEX.marble }))); rl.position.set(best.x + Math.cos(best.a) * 2.3 * s, Y + 2.1, best.z - Math.sin(best.a) * 2.3 * s); rl.rotation.y = best.a; root.add(rl); }
    for (let k = -12; k <= 12; k += 4) colliders.pads.push({ x: best.x + Math.sin(best.a) * k, z: best.z + Math.cos(best.a) * k, r: 2.6, top: Y + 1.7, bot: Y - 1 });
    EARTH.feathers.push([best.x, Y + 3.2, best.z]);
  }

  // ---- 燈塔港 · the lighthouse harbour, and the keeper's light that never went out
  {
    const Hb = EP.harbor, hg = Y + 2.2, grp = new THREE.Group();
    [[-18, -14, 0.6], [-24, 6, 1.3], [-10, 20, 2.4], [6, -22, 0.1], [-30, -8, 1.0], [14, 24, 2.9]].forEach(([dx, dz, rot]) => house(grp, Hb.x + dx, Hb.z + dz, hg, 4.5 + R() * 2, 5.5 + R() * 2, 3.2 + R(), rot, roofSea));
    // pier into the sea
    const pierM = mat('#7b6450', { roughness: 0.9 });
    const px0 = Hb.x + 12, pz0 = Hb.z + 2;
    const deck = shadowy(new THREE.Mesh(new THREE.BoxGeometry(46, 0.4, 4), pierM)); deck.position.set(px0 + 23, Y + 1.6, pz0); grp.add(deck);
    for (let k = 0; k <= 46; k += 4) for (const s of [-1.7, 1.7]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4, 6), pierM); p.position.set(px0 + k, Y, pz0 + s); grp.add(p); }
    for (let k = 2; k <= 46; k += 4) colliders.pads.push({ x: px0 + k, z: pz0, r: 2.2, top: Y + 1.8, bot: Y - 2 });
    root.add(grp); bakeStatic(grp);
    EARTH.feathers.push([px0 + 46, Y + 3.4, pz0]);
    // little boats bobbing at the pier
    const hullG = new THREE.CylinderGeometry(1.1, 1.1, 6, 10, 1, false, 0, Math.PI); hullG.rotateZ(Math.PI / 2); hullG.rotateX(Math.PI / 2); hullG.scale(1, 0.6, 1);
    const boats = [];
    for (const [dx, dz, ry] of [[18, 6, 0.2], [30, -6, -0.3], [40, 7, 0.5]]) {
      const b = shadowy(new THREE.Mesh(hullG, mat('#8c6e52'))); b.position.set(px0 + dx, Y + 0.2, pz0 + dz); b.rotation.y = ry; root.add(b); boats.push(b);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 5), woodM); mast.position.y = 2; b.add(mast);
    }
    W.animated.push((t) => boats.forEach((b, i) => { b.position.y = Y + 0.15 + Math.sin(t * 1.3 + i * 2) * 0.12; b.rotation.z = Math.sin(t * 0.9 + i) * 0.05; }));
    // the lighthouse on the cape
    const L = EP.light, lg = gA(L.x, L.z), ivory = haze(mat('#efe6d3', { map: TEX.marble, roughness: 0.8 }), 0.45), gold = haze(mat('#d7b468', { metalness: 0.8, roughness: 0.35 }), 0.45);
    const lt = new THREE.Group();
    const tower = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 4.2, 26, 18), ivory)); tower.position.set(L.x, lg + 13, L.z); lt.add(tower);
    for (const y of [6, 13, 20]) { const band = new THREE.Mesh(new THREE.TorusGeometry(3.8 - y * 0.05, 0.18, 6, 32), gold); band.rotation.x = Math.PI / 2; band.position.set(L.x, lg + y, L.z); lt.add(band); }
    const gallery = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.5, 18), ivory)); gallery.position.set(L.x, lg + 26.2, L.z); lt.add(gallery);
    const room = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 12), new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf7a', emissiveIntensity: 2.6 })); room.position.set(L.x, lg + 28.2, L.z); lt.add(room);
    const dome = shadowy(new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold)); dome.position.set(L.x, lg + 29.9, L.z); lt.add(dome);
    root.add(lt);
    colliders.solids.push({ x: L.x, z: L.z, r: 4.2, y0: lg - 1, y1: lg + 26 });
    colliders.pads.push({ x: L.x, z: L.z, r: 3.9, top: lg + 26.45, bot: lg + 25 });
    const beamM = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.6, 1.3, 0.8), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const beamG = new THREE.ConeGeometry(9, 120, 20, 1, true); beamG.translate(0, -60, 0); beamG.rotateZ(Math.PI / 2);
    const rot = new THREE.Group(); rot.position.set(L.x, lg + 28.2, L.z); root.add(rot);
    for (const s of [0, Math.PI]) { const bm = new THREE.Mesh(beamG, beamM); bm.rotation.y = s; rot.add(noReflect(bm)); }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(2.4, 1.9, 1.1), transparent: true, depthWrite: false, fog: false })); glow.scale.setScalar(16); glow.position.set(L.x, lg + 28.2, L.z); root.add(noReflect(glow));
    W.animated.push((t) => { rot.rotation.y = t * 0.45; });
    EARTH.feathers.push([L.x, lg + 33, L.z]);
    EARTH.updrafts.push({ x: L.x - 9, z: L.z + 7, top: lg + 36, g: gA(L.x - 9, L.z + 7) });
  }

  // ---- 霜脊修道院 · the abbey on the frost ridge, where monks still keep candles
  {
    const A = EP.monastery, ag = Y + 72, grp = new THREE.Group(), stone = mat('#e3dccd', { map: TEX.marble, roughness: 0.88 }), slate = mat('#59606e', { roughness: 0.7 });
    const hall = shadowy(new THREE.Mesh(new THREE.BoxGeometry(12, 9, 24), stone)); hall.position.set(A.x, ag + 4.5, A.z - 10); grp.add(hall);
    const hr = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 24.6, 3), slate)); hr.rotation.set(Math.PI / 2, 0, Math.PI / 2); hr.scale.set(1, 1, 0.6); hr.position.set(A.x, ag + 11.3, A.z - 10); grp.add(hr);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), winM); rose.position.set(A.x, ag + 6.5, A.z + 2.05); grp.add(rose);
    const tw = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.4, 24, 16), stone)); tw.position.set(A.x + 10, ag + 12, A.z - 18); grp.add(tw);
    const dome = shadowy(new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), slate)); dome.position.set(A.x + 10, ag + 24, A.z - 18); grp.add(dome);
    const sp = shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 6), slate)); sp.position.set(A.x + 10, ag + 30, A.z - 18); grp.add(sp);
    for (const [x0, z0, x1, z1] of [[-14, 2, -14, 26], [14, 2, 14, 26], [-14, 26, -4, 26], [4, 26, 14, 26]]) {
      const L = Math.hypot(x1 - x0, z1 - z0), wl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.4, L), stone));
      wl.position.set(A.x + (x0 + x1) / 2, ag + 1.7, A.z + (z0 + z1) / 2); wl.rotation.y = Math.atan2(x1 - x0, z1 - z0); grp.add(wl);
      for (let k = 0; k <= L; k += 4) colliders.solids.push({ x: A.x + lerp(x0, x1, k / L), z: A.z + lerp(z0, z1, k / L), r: 1.4, y0: ag - 1, y1: ag + 3.4 });
    }
    root.add(grp); bakeStatic(grp);
    colliders.solids.push({ x: A.x, z: A.z - 4, r: 6.5, y0: ag - 1, y1: ag + 12 }, { x: A.x, z: A.z - 16, r: 6.5, y0: ag - 1, y1: ag + 12 }, { x: A.x + 10, z: A.z - 18, r: 4.6, y0: ag - 1, y1: ag + 24 });
    colliders.pads.push({ x: A.x + 10, z: A.z - 18, r: 3.6, top: ag + 26, bot: ag + 22 });
    EARTH.feathers.push([A.x + 10, ag + 30, A.z - 18]);
    EARTH.updrafts.push({ x: A.x - 34, z: A.z + 44, top: ag + 18, g: gA(A.x - 34, A.z + 44) });
  }

  // ---- 麥原守望塔 · the field watch by the bridge
  { const Wt = EP.watch, wg = gA(Wt.x, Wt.z), grp = new THREE.Group(); watchTower(grp, Wt.x - 7, Wt.z - 5, gA(Wt.x - 7, Wt.z - 5), 10); root.add(grp); bakeStatic(grp); EARTH.feathers.push([Wt.x - 7, gA(Wt.x - 7, Wt.z - 5) + 13, Wt.z - 5]); void wg; }

  // ---- 傾城遺跡 · the ruined castle on its mesa
  const C = EP.castle, cg = Y + 34;
  const castle = new THREE.Group();
  const stoneM = strataMaterial(0.35);
  const wall = (x0, z0, x1, z1, hgt) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n2 = Math.ceil(L / 6);
    for (let i = 0; i < n2; i++) {
      if (R() < 0.18) continue; // breaches
      const t0 = i / n2, t1 = (i + 1) / n2, h2 = hgt * (0.45 + R() * 0.55);
      const x = lerp(x0, x1, (t0 + t1) / 2), z = lerp(z0, z1, (t0 + t1) / 2);
      const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(L / n2 + 0.1, h2, 3.2), stoneM));
      b.position.set(x, cg + h2 / 2 - 0.5, z); b.rotation.y = -Math.atan2(z1 - z0, x1 - x0); castle.add(b);
      colliders.solids.push({ x, z, r: 2.6, y0: cg - 2, y1: cg + h2 });
    }
  };
  const S2 = 26;
  wall(C.x - S2, C.z - S2, C.x + S2, C.z - S2, 10); wall(C.x - S2, C.z - S2, C.x - S2, C.z + S2, 10);
  wall(C.x + S2, C.z - S2, C.x + S2, C.z - 6, 10); wall(C.x - S2, C.z + S2, C.x + 6, C.z + S2, 10);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const H = sx > 0 && sz > 0 ? 9 : 15 + R() * 5;
    const tw = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(4, 4.6, H, 12), stoneM)); tw.position.set(C.x + sx * S2, cg + H / 2 - 0.5, C.z + sz * S2); castle.add(tw);
    colliders.solids.push({ x: C.x + sx * S2, z: C.z + sz * S2, r: 4.6, y0: cg - 2, y1: cg + H });
    colliders.pads.push({ x: C.x + sx * S2, z: C.z + sz * S2, r: 4.2, top: cg + H - 0.5, bot: cg + H - 3 });
    if (sx < 0 && sz < 0) EARTH.feathers.push([C.x + sx * S2, cg + H + 1, C.z + sz * S2]);
  }
  EARTH.updrafts.push({ x: C.x - S2 + 9, z: C.z - S2 + 9, top: cg + 26, g: cg });
  const throne = shadowy(new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), stoneM)); throne.position.set(C.x, cg + 1, C.z - 18); castle.add(throne);
  root.add(castle); bakeStatic(castle);
  EARTH.bossHome = new THREE.Vector3(C.x, cg, C.z - 4);
  EARTH.castleFloor = cg;
  EARTH.keepGate = { x: C.x + 40, z: C.z + 30 }; // the cracked rock below the keep

  // ---- 墜光坑 · the crater of the fallen light: the stairway home
  const K = EP.crater, kg = gA(K.x, K.z);
  {
    const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#eef3fb', emissive: '#c8dcff', emissiveIntensity: 0.9, roughness: 0.15 }), 26);
    for (let i = 0; i < 26; i++) { const a = R() * 6.28, r = 5 + R() * 13, x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r, h = 1 + R() * 3.5; shards.setMatrixAt(i, M(x, gA(x, z) + h * 0.4, z, (R() - 0.5) * 0.9, R() * 6, (R() - 0.5) * 0.9, 0.4 + R() * 0.4, h, 0.4 + R() * 0.4)); }
    root.add(noReflect(shards));
    const beamM = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.0, 1.6, 1.0), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 32, 1, true).translate(0, 0.5, 0), beamM);
    beam.scale.set(1, 260, 1); beam.position.set(K.x, kg, K.z); root.add(noReflect(beam));
    const rune = new THREE.Mesh(new THREE.RingGeometry(2.6, 6.5, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.3, 1.0, 0.6), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    rune.rotation.x = -Math.PI / 2; rune.position.set(K.x, kg + 0.12, K.z); root.add(rune);
    W.animated.push((t) => { rune.rotation.z = t * 0.2; beamM.opacity = 0.55 + Math.sin(t * 1.3) * 0.12; });
  }
  EARTH.pillar = new THREE.Vector3(K.x, kg, K.z);
  EARTH.landing = new THREE.Vector3(K.x - 14, kg + 4, K.z + 18);

  // ---- the pilgrims' road north: broken arches lead to the rift
  {
    const grp = new THREE.Group(), st = mat('#cfc6b4', { map: TEX.marble, roughness: 0.9 });
    [[2, -150], [-8, -250], [-16, -350], [-19, -420]].forEach(([x, z], i) => {
      const g = gA(x, z), broken = i % 2 === 1;
      for (const s of [-1, 1]) { const hh = broken && s > 0 ? 3.5 : 8; const p = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, hh, 1.4), st)); p.position.set(x + s * 4.5, g + hh / 2 - 0.3, z); grp.add(p); colliders.solids.push({ x: x + s * 4.5, z, r: 1.1, y0: g - 1, y1: g + hh }); }
      if (!broken) { const l = shadowy(new THREE.Mesh(new THREE.BoxGeometry(11, 1.2, 1.8), st)); l.position.set(x, g + 8.2, z); grp.add(l); }
    });
    root.add(grp); bakeStatic(grp);
  }

  // ---- 墮天裂谷 · the rift: red light far below, embers rising
  {
    const ribbon = (y, wk, color, opacity) => {
      const pos = [], idx = []; let n = 0;
      for (let x = -345; x <= 300; x += 6) { const zc = riftZ(x), w = riftW(x) * wk; pos.push(x, y, zc - w, x, y, zc + w); if (n) idx.push(n * 2 - 2, n * 2 - 1, n * 2, n * 2 - 1, n * 2 + 1, n * 2); n++; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
      root.add(noReflect(m)); return m;
    };
    const deep = ribbon(Y - 158, 0.55, new THREE.Color(1.8, 0.42, 0.14), 0.95);
    const mid = ribbon(Y - 90, 0.75, new THREE.Color(0.9, 0.2, 0.08), 0.32);
    ribbon(Y - 30, 0.95, new THREE.Color(0.5, 0.12, 0.05), 0.12);
    // embers drifting up out of the dark
    const NE = 700, ep = new Float32Array(NE * 3), es = new Float32Array(NE);
    for (let i = 0; i < NE; i++) { const x = -330 + R() * 610, w = riftW(x) * 0.8; ep[i * 3] = x; ep[i * 3 + 1] = Y - 160; ep[i * 3 + 2] = riftZ(x) + (R() * 2 - 1) * w; es[i] = R(); }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setAttribute('aSeed', new THREE.BufferAttribute(es, 1));
    const em = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: TEX.glow } },
      vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
        void main(){ vec3 p = position; float k = fract(aSeed*7.31 + uTime*(0.025 + aSeed*0.03)); p.y += k*185.0; p.x += sin(uTime*0.6 + aSeed*40.0)*3.0*k; p.z += cos(uTime*0.5 + aSeed*31.0)*2.0*k;
          vA = smoothstep(0.0, 0.08, k)*(1.0 - smoothstep(0.7, 1.0, k));
          vec4 mv = modelViewMatrix*vec4(p, 1.0); gl_Position = projectionMatrix*mv; gl_PointSize = (2.0 + aSeed*3.0)*(260.0/-mv.z); }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vec3(2.4, 0.9, 0.35)*a*vA, a*vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const embers = new THREE.Points(eg, em); embers.frustumCulled = false; root.add(noReflect(embers));
    W.animated.push((t) => { em.uniforms.uTime.value = t; deep.material.opacity = 0.8 + Math.sin(t * 0.7) * 0.15; mid.material.opacity = 0.28 + Math.sin(t * 0.5 + 1) * 0.06; });
  }
  buildColossus(root, COLO.x, COLO.z, Y + 16);

  // ---- swamp mist: low sickly glows over the pools
  {
    const mm = new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(0.55, 0.62, 0.42), transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 22; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * EP.swamp.r * 0.9, x = EP.swamp.x + Math.cos(a) * r, z = EP.swamp.z + Math.sin(a) * r; const s = new THREE.Sprite(mm); s.scale.set(26 + R() * 20, 8 + R() * 5, 1); s.position.set(x, gA(x, z) + 2.5, z); root.add(noReflect(s)); }
  }

  // ---- updrafts (visuals are made by the world's updraft builder pattern)
  { const ux = COLO.x + 30, uz = riftZ(COLO.x + 30) + riftW(COLO.x + 30) + 12; EARTH.updrafts.push({ x: ux, z: uz, top: Y + 76, g: gA(ux, uz) }); EARTH.riftRim = new THREE.Vector3(ux - 8, gA(ux - 8, uz + 8) + 0.5, uz + 8); }
  for (const u of EARTH.updrafts) {
    const h = u.top - u.g;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float s = fract(vUv.y*7.0 - uTime*0.5 + sin(vUv.x*25.0)*0.08);
          float streak = smoothstep(0.0, 0.08, s)*(1.0 - smoothstep(0.12, 0.5, s));
          float fade = smoothstep(0.0, 0.08, vUv.y)*(1.0 - smoothstep(0.7, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(1.25, 0.95, 0.5), streak*(0.4 + 0.6*(0.5 + 0.5*sin(vUv.x*56.5)))*fade*0.55); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, h, 32, 1, true), m); col.position.set(u.x, u.g + h / 2, u.z); root.add(noReflect(col));
    const base = new THREE.Mesh(new THREE.RingGeometry(1.5, 4.6, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(0.85, 0.62, 0.3), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.set(u.x, u.g + 0.1, u.z); root.add(base);
    W.updrafts.push({ x: u.x, z: u.z, top: u.top, g: u.g, mat: m, base, earth: true });
  }

  // ---- street lanterns (lit by the people who come home)
  {
    const lm = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 1.0) }), lamps.length);
    lamps.forEach((p, i) => { lm.setMatrixAt(i, M(p.x, p.y, p.z, 0, 0, 0, 1, 1.3, 1)); lm.setColorAt(i, c.setRGB(0.18, 0.15, 0.12)); });
    root.add(noReflect(lm));
    const gp = new Float32Array(lamps.length * 3), gc = new Float32Array(lamps.length * 3);
    lamps.forEach((p, i) => { gp[i * 3] = p.x; gp[i * 3 + 1] = p.y; gp[i * 3 + 2] = p.z; });
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3)); gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    const glow = new THREE.Points(gg, new THREE.PointsMaterial({ map: TEX.glow, size: 3.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    root.add(noReflect(glow));
    EARTH.lamps = {
      n: lamps.length, lit: 0,
      set(n) { // light the first n lanterns
        this.lit = Math.min(n, lamps.length);
        for (let i = 0; i < lamps.length; i++) { const on = i < this.lit; lm.setColorAt(i, c.setRGB(on ? 1 : 0.18, on ? 1 : 0.15, on ? 1 : 0.12)); gc[i * 3] = on ? 1.2 : 0; gc[i * 3 + 1] = on ? 0.85 : 0; gc[i * 3 + 2] = on ? 0.45 : 0; }
        lm.instanceColor.needsUpdate = true; gg.attributes.color.needsUpdate = true;
      },
    };
  }

  // ---- feathers: twenty marked ones (ids kept stable for saves), then the rest of the land
  const F = EARTH.feathers, fa = (x, z, dy = 1.4) => F.push([x, gA(x, z) + dy, z]);
  fa(K.x + 10, K.z - 6); fa(-395, 130, 2.2); fa(EP.forest.x - 20, EP.forest.z + 30); fa(EP.lake.x + 6, EP.lake.z - 4, 2.4);
  fa(-14, -400); fa(C.x, C.z + 10); fa(300, -392, 3); fa(566, -18, 12); fa(-200, riftZ(-200) + riftW(-200) + 8); fa(60, 250);
  fa(-300, 340); fa(-60, 60);
  while (F.length < 20) fa(-150 + F.length * 20, 100);
  F.length = 20;
  const F2 = EARTH.moreFeathers, fb = (x, z, dy = 1.4) => F2.push([x, gA(x, z) + dy, z]);
  [[-100, 100], [250, -100], [380, -150], [-450, -80], [-480, 250], [100, -250], [-120, -330], [230, 450], [-150, 470], [300, 420], [480, 320], [-60, -200], [150, -380], [-380, -380], [420, -60], [0, 180]].forEach(([x, z]) => fb(x, z));
  fb(COLO.x, COLO.z, 0); F2[F2.length - 1][1] = EARTH.colossusHead.y + 2; F2[F2.length - 1][0] = EARTH.colossusHead.x; F2[F2.length - 1][2] = EARTH.colossusHead.z;

  // ---- miasma beasts roaming the land
  const foe = (x, z, t = 'melee') => EARTH.enemies.push([x, z, t]);
  [[60, 92], [118, 150, 'charger'], [-90, 140], [-60, 60, 'bomber'], [-130, 40, 'archer'], [20, 120], [45, 212, 'archer'], [-100, -100, 'charger'], [-160, -150], [-140, -190, 'archer'],
    [122, -86], [178, -132, 'bomber'], [-40, -80], [80, -40, 'archer'], [240, -200, 'charger'], [260, -160, 'archer'], [-250, -80], [-280, 20, 'bomber'], [350, 40], [300, 120, 'archer'],
    [-200, 400], [-260, 350, 'archer'], [150, -300, 'charger'], [-60, -330], [30, -360, 'archer'], [-420, -60, 'bomber'], [400, 420], [-430, 330, 'charger'],
    [-380, 60, 'bomber'], [-420, 180, 'bomber'], [-30, -250, 'charger'], [210, 30, 'bomber']].forEach(([x, z, t]) => foe(x, z, t));

  // ---- the people: sealed in crystal, or holding a light against the dark
  EARTH.captives = [
    { id: 'cSwampA', x: -420, z: 92, guards: [[6, 4, 'bomber'], [-5, 6], [2, -8, 'archer']], line: '……光？是天上的光嗎？' },
    { id: 'cSwampB', x: -352, z: 192, guards: [[6, -3], [-6, -4]], line: '我的燈……我以為再也點不著了。' },
    { id: 'cWood', x: -262, z: 214, guards: [[5, 5], [-6, 2, 'archer']], line: '森林一直在低語，叫我不要睡著。' },
    { id: 'cField', x: 128, z: 236, guards: [[6, 2], [-4, -6]], line: '天使大人……您不是來懲罰我們的吧？' },
    { id: 'cRuins', x: -214, z: -168, guards: [[6, 4, 'charger'], [-6, 3], [0, -8, 'archer']], line: '騎士長倒下那天，我們就再沒見過光。' },
    { id: 'cRift', x: 74, z: -396, guards: [[6, 5, 'charger'], [-6, 4, 'bomber'], [3, -7, 'archer']], line: '裂谷裡……有東西在叫我的名字。' },
  ];
  for (const cp of EARTH.captives) cp.y = gA(cp.x, cp.z);
  EARTH.beacons = [
    { id: 'bWatch', name: '麥原守望塔', en: 'THE FIELD WATCH', x: EP.watch.x, z: EP.watch.z, waves: [2, 3], folk: 3, line: '守住了……我們還守得住！' },
    { id: 'bHarbor', name: '燈塔港', en: 'LIGHTHOUSE HARBOR', x: EP.harbor.x - 2, z: EP.harbor.z - 2, waves: [3, 3], folk: 4, line: '燈塔從來沒熄過，今晚也不會。' },
    { id: 'bAbbey', name: '霜脊修道院', en: 'FROSTRIDGE ABBEY', x: EP.monastery.x, z: EP.monastery.z + 14, waves: [3, 4], folk: 4, monks: true, line: '我們祈禱了很多年。原來天上有回應。' },
  ];
  for (const b of EARTH.beacons) { b.y = gA(b.x, b.z); buildBrazier(root, b); }

  EARTH.marks = [
    { x: T.x, z: T.z, r: 80, name: '晨鐘堡', en: 'BELLDAWN HOLD' },
    { x: C.x, z: C.z, r: 60, name: '傾城遺跡', en: 'THE FALLEN KEEP' },
    { x: K.x, z: K.z, r: 44, name: '墜光坑', en: 'THE CRATER OF FALLEN LIGHT' },
    { x: EP.lake.x, z: EP.lake.z, r: 64, name: '靜湖', en: 'THE STILL LAKE' },
    { x: EP.mill.x, z: EP.mill.z, r: 24, name: '風車丘', en: 'WINDMILL HILL' },
    { x: EP.harbor.x, z: EP.harbor.z, r: 62, name: '燈塔港', en: 'LIGHTHOUSE HARBOR' },
    { x: EP.light.x, z: EP.light.z, r: 30, name: '守燈岬', en: "THE KEEPER'S CAPE" },
    { x: EP.monastery.x, z: EP.monastery.z, r: 58, name: '霜脊修道院', en: 'FROSTRIDGE ABBEY' },
    { x: EP.watch.x, z: EP.watch.z, r: 26, name: '麥原守望塔', en: 'THE FIELD WATCH' },
    { x: COLO.x, z: COLO.z, r: 60, name: '墮天巨像', en: 'THE FALLEN COLOSSUS' },
  ];
}

// ---------------------------------------------------------------- a beacon brazier: dim until the people around it are safe
function buildBrazier(root, b) {
  const st = new THREE.MeshStandardMaterial({ color: '#d9cfbb', map: TEX.marble, roughness: 0.85 });
  const ped = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 1.6, 8), st)); ped.position.set(b.x, b.y + 0.8, b.z); root.add(ped);
  const bowl = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.7, 0.7, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }))); bowl.position.set(b.x, b.y + 1.95, b.z); root.add(bowl);
  colliders.solids.push({ x: b.x, z: b.z, r: 1.2, y0: b.y - 1, y1: b.y + 2.2 });
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.05, 0.45), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 10, 1, true).translate(0, 1.2, 0), flameM); flame.position.set(b.x, b.y + 2.1, b.z); root.add(noReflect(flame));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(2.4, 1.5, 0.7), transparent: true, depthWrite: false, fog: false })); glow.position.set(b.x, b.y + 3, b.z); root.add(noReflect(glow));
  b.fx = { flame, glow, flameM };
  b.setPower = (k, t) => { // 0 = embers, 1 = a full blaze
    const f = 0.25 + k * 0.75, wob = 1 + Math.sin(t * 9 + b.x) * 0.08 * f;
    flame.scale.set(f * wob, f * (1.2 + Math.sin(t * 7) * 0.12), f * wob); flameM.opacity = 0.35 + k * 0.6;
    glow.scale.setScalar(3 + k * 6.5); glow.material.opacity = 0.55 + k * 0.3;
  };
  b.setPower(0, 0);
}

// ---------------------------------------------------------------- 墮天巨像 · the fallen colossus kneeling over the rift
function buildColossus(root, x, z, g0) {
  const stone = haze(new THREE.MeshStandardMaterial({ color: '#6b6572', map: TEX.marble, roughness: 0.92 }), 0.42);
  const dark = haze(new THREE.MeshStandardMaterial({ color: '#46404c', map: TEX.marble, roughness: 0.9 }), 0.42);
  const pale = haze(new THREE.MeshStandardMaterial({ color: '#9c96a0', roughness: 0.85 }), 0.42);
  const steel = haze(new THREE.MeshStandardMaterial({ color: '#4e4a55', metalness: 0.55, roughness: 0.5 }), 0.42);
  const crackM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.75, 0.25), fog: false });
  const body = new THREE.Group(); body.position.set(x, g0, z);
  const add = (m, mat_ = stone) => { const o = shadowy(new THREE.Mesh(m, mat_)); body.add(o); return o; };
  // kneeling robe pooled on the terrace
  add(new THREE.LatheGeometry([[16, 0], [15.6, 3], [13.4, 8], [11.2, 14], [9.6, 18.5], [9.2, 20], [0.01, 20.2]].map(([r, y]) => new THREE.Vector2(r, y)), 28));
  // torso leans forward over the sword
  const torso = new THREE.Group(); torso.position.y = 18; torso.rotation.x = 0.22; body.add(torso);
  const tAdd = (m, mat_ = stone) => { const o = shadowy(new THREE.Mesh(m, mat_)); torso.add(o); return o; };
  tAdd(new THREE.LatheGeometry([[9, 0], [10.6, 6], [11.6, 12], [10.6, 18], [7, 22], [4, 24], [0.01, 24.5]].map(([r, y]) => new THREE.Vector2(r, y)), 24));
  for (const s of [-1, 1]) { const sh = tAdd(new THREE.SphereGeometry(6, 16, 12), dark); sh.position.set(s * 11.5, 18.5, 0); sh.scale.set(1, 0.8, 1); }
  const hood = tAdd(new THREE.SphereGeometry(5.8, 18, 14), dark); hood.position.set(0, 28.5, 3.2); hood.scale.set(1, 1.06, 1.15);
  const face = tAdd(new THREE.SphereGeometry(4.2, 16, 12), pale); face.position.set(0, 27.8, 6.6); face.scale.set(1, 1.1, 0.75);
  // the crack in its chest, glowing from inside
  const crack = new THREE.Group(); crack.position.set(0, 0, 11.2); torso.add(crack);
  [[0, 7, 0.4], [1.2, 9.6, -0.5], [0.2, 12.2, 0.6], [1.4, 14.6, -0.4], [0.4, 16.8, 0.3], [-1, 11, 1.1]].forEach(([cx, cy, rz]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3, 0.8), crackM); b.position.set(cx, cy, 0); b.rotation.z = rz; crack.add(b); });
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(2.6, 0.55, 0.2), transparent: true, depthWrite: false, fog: false })); heart.position.set(0.4, 12, 12.4); heart.scale.setScalar(10); torso.add(noReflect(heart));
  // arms reach forward to the pommel
  const limb = (a, b, r1, r2, m_ = stone) => { const d = new THREE.Vector3().subVectors(b, a), L = d.length(); const g = new THREE.CylinderGeometry(r2, r1, L, 12); const o = shadowy(new THREE.Mesh(g, m_)); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); body.add(o); return o; };
  for (const s of [-1, 1]) {
    const sh = new THREE.Vector3(s * 11.5, 36, 4), el = new THREE.Vector3(s * 10.5, 30.5, 17), hd = new THREE.Vector3(s * 2.9, 37.5, 29.6);
    limb(sh, el, 3.4, 2.9); limb(el, hd, 2.9, 2.3);
    const fist = add(new THREE.SphereGeometry(2.9, 12, 10), dark); fist.position.copy(hd);
  }
  // the sword, driven into the rift
  const sw = new THREE.Group(); sw.position.set(0, 0, 30); body.add(sw);
  const swAdd = (g, m_ = steel) => { const o = shadowy(new THREE.Mesh(g, m_)); sw.add(o); return o; };
  swAdd(new THREE.BoxGeometry(2, 9, 2)).position.y = 36;
  swAdd(new THREE.SphereGeometry(2.4, 12, 10)).position.y = 41.5;
  swAdd(new THREE.BoxGeometry(18, 2, 2.8)).position.y = 31;
  const blade = swAdd(new THREE.BoxGeometry(5.5, 170, 1.2)); blade.position.y = 30 - 85;
  // wings: one still spread, one shattered
  const featherG = (L) => { const g = new THREE.CylinderGeometry(0.3, 3.4, L, 6, 1); g.scale(1, 1, 0.3); g.translate(0, L / 2, 0); return g; };
  { // the spread wing: an arm sweeping up and out, feathers hanging from it
    const r0 = new THREE.Vector3(7, 38, -7), tip = new THREE.Vector3(34, 60, -16);
    limb(r0, new THREE.Vector3(20, 54, -11), 2.6, 2.2, dark); limb(new THREE.Vector3(20, 54, -11), tip, 2.2, 1.2, dark);
    for (let i = 0; i < 12; i++) {
      const k = i / 11, b = i < 6 ? r0.clone().lerp(new THREE.Vector3(20, 54, -11), k * 2) : new THREE.Vector3(20, 54, -11).lerp(tip, (k - 0.5) * 2);
      const L = 12 + k * 30, f = add(featherG(L), i % 2 ? stone : dark);
      f.position.copy(b); f.rotation.set(-0.28 - k * 0.1, 0, Math.PI + 0.12 + k * 0.85);
    }
  }
  { // the shattered wing: a snapped arm and a few short feathers
    const r0 = new THREE.Vector3(-7, 38, -7), br = new THREE.Vector3(-17, 47, -10);
    limb(r0, br, 2.6, 2.0, dark);
    for (const [k, L] of [[0.3, 10], [0.6, 13], [0.95, 8]]) { const f = add(featherG(L), dark); f.position.copy(r0.clone().lerp(br, k)); f.rotation.set(-0.3, 0, Math.PI - 0.15 - k * 0.6); }
  }
  const loose = new THREE.Group(); loose.position.set(x, g0, z); root.add(loose);
  const frags = [];
  for (let i = 0; i < 7; i++) { const f = shadowy(new THREE.Mesh(featherG(5 + i * 1.3), i % 2 ? stone : dark)); const a = 0.6 + i * 0.16, r = 16 + i * 4; f.position.set(-7 - Math.sin(a) * r, 37 + Math.cos(a) * r * 0.7, -9 - i * 0.8); f.rotation.set(i, i * 2, 0.5 + a); loose.add(f); frags.push({ f, y: f.position.y, ph: i * 1.3 }); }
  // a broken halo behind the bowed head
  const halo = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 64, Math.PI * 1.35), dark); halo.castShadow = true;
  const haloG = new THREE.Group(); haloG.position.set(x, g0 + 51, z - 1); haloG.rotation.set(0.25, 0, 2.2); haloG.add(halo); root.add(haloG);
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 10, 0.32), dark); p.rotation.z = -0.5 - i * 0.42; p.position.set(Math.cos(-0.7 - i * 0.4) * 1.4, Math.sin(-0.7 - i * 0.4) * 1.4, 0); haloG.add(p); frags.push({ f: p, y: p.position.y, ph: 4 + i, small: true }); }
  root.add(body);
  // the seal: rune rings around the blade
  const rings = [];
  for (const [y, r] of [[22, 6.5], [9, 8], [-6, 9.5]]) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(2.2, 0.7, 0.3), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, g0 + y, z + 30); root.add(noReflect(m)); rings.push(m);
  }
  W.animated.push((t) => {
    const p = 0.75 + Math.sin(t * 1.6) * 0.25;
    crackM.color.setRGB(3.4 * p, 0.75 * p, 0.25 * p); heart.material.opacity = 0.6 + p * 0.35; heart.scale.setScalar(9 + p * 3);
    rings.forEach((m, i) => { m.rotation.z = t * (i % 2 ? -0.25 : 0.18); });
    for (const fr of frags) { fr.f.position.y = fr.y + Math.sin(t * 0.5 + fr.ph) * (fr.small ? 0.3 : 0.9); fr.f.rotation.y += 0.002; }
  });
  // collision & perches: robe, torso, blade; the head, shoulders and hands can be stood on
  colliders.solids.push({ x, z, r: 15, y0: g0 - 2, y1: g0 + 20 }, { x, z: z + 3, r: 11, y0: g0 + 18, y1: g0 + 42 }, { x, z: z + 30, r: 3, y0: g0 - 160, y1: g0 + 40 });
  const head = new THREE.Vector3(x, g0 + 18 + 28.5 * Math.cos(0.22) + 6, z + 28.5 * Math.sin(0.22) + 3.2 * Math.cos(0.22));
  colliders.pads.push({ x: head.x, z: head.z, r: 4.2, top: head.y, bot: head.y - 5 });
  for (const s of [-1, 1]) colliders.pads.push({ x: x + s * 11.5, z: z + 4.2, r: 4.5, top: g0 + 40.6, bot: g0 + 36 });
  colliders.pads.push({ x, z: z + 30, r: 3.6, top: g0 + 44, bot: g0 + 39 });
  EARTH.colossusHead = head;
  EARTH.colossus = { x, z, y: g0, sword: new THREE.Vector3(x, g0 + 31, z + 30) };
}
function mergeAll(geos) {
  // tiny local merge (positions/normals only) so we don't drag in extra utilities for a couple of shapes
  let n = 0, idx = 0; for (const g of geos) { n += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), index = new Uint32Array(idx);
  let o = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.array[i] + o; else for (let i = 0; i < g.attributes.position.count; i++) index[io++] = i + o;
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

export function earthRegion(x, z) {
  for (const m of EARTH.marks) if (Math.hypot(x - m.x, z - m.z) < m.r) return [m.name, m.en];
  if (inRift(x, z, 46)) return ['墮天裂谷', 'THE RIFT OF THE FALLEN'];
  if (swampK(x, z) > 0.3) return ['瘴氣沼澤', 'THE MIASMA MIRE'];
  if (riverD(x, z) < 16) return ['銀溪', 'THE SILVER BROOK'];
  if (x > coastX(z) - 10 && openEast(x, z) > 0.5) return ['東海', 'THE EASTERN SEA'];
  if (Math.hypot(x, z) > 480) return ['環山', 'THE RINGING MOUNTAINS'];
  if (x > 200 && z < -150) return ['霜脊高地', 'THE FROSTRIDGE HIGHLANDS'];
  if (Math.hypot(x - EP.forest.x, z - EP.forest.z) < 190) return ['低語森林', 'THE WHISPERING WOOD'];
  if (grid2.wheat[gi(x, z)] > 0.3) return ['金麥原', 'THE GOLDEN FIELDS'];
  return ['人間 · 蒼原', 'THE MORTAL VALE'];
}
// map helpers
export const EARTH_MAP = { coastX, riverD, roadD };
