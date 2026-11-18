// LUMENFALL · 人間 — the human world beneath the cloud sea
// Rolling farmland, a river and a still lake, a whispering forest, a village of warm windows,
// the ruined castle where a fallen knight waits, and the crater where the light first fell.
import * as THREE from 'three';
import { GN, SEG, CELL, HALF, WORLD, EARTH_Y, grid2, groundAtL, fbm, smooth, lerp, clamp, mulberry, TEX } from './core.js';
import { W, colliders, noReflect, rfn } from './world.js';
import { terrainDetail, strataMaterial, rockGeo, foliageMaterial, NOISE } from './env.js';
import { bakeStatic } from './hero.js';

export const EP = {
  village: { x: 92, z: 140 }, castle: { x: -150, z: -150 }, crater: { x: 150, z: -110 }, lake: { x: -90, z: 118, r: 46 },
  mill: { x: 128, z: 182 },
};
const riverZ = (x) => 70 * Math.sin(x * 0.011 + 0.6) - x * 0.25 - 10;
function riverD(x, z) { const dz = 70 * 0.011 * Math.cos(x * 0.011 + 0.6) - 0.25; return Math.abs(z - riverZ(x)) / Math.sqrt(1 + dz * dz); }
const ROADS = [
  [[92, 140], [128, 70], [140, 8], [150, -78]],
  [[92, 140], [40, 92], [-10, 36], [-70, -40], [-122, -112]],
  [[92, 140], [20, 150], [-40, 132]],
];
function segD(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1); return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
export function roadD(x, z) { let d = 1e9; for (const R of ROADS) for (let i = 0; i < R.length - 1; i++) d = Math.min(d, segD(x, z, R[i][0], R[i][1], R[i + 1][0], R[i + 1][1])); return d; }

export function earthH(x, z) {
  let h = 9 + fbm(x * 0.0055 + 50, z * 0.0055 - 20, 4) * 20 + fbm(x * 0.022 - 7, z * 0.022 + 3, 3) * 3;
  const rr = Math.hypot(x, z);
  h += smooth(225, 300, rr) * (55 + fbm(x * 0.012, z * 0.012, 3) * 60); // the ring of mountains that bounds the land
  h = lerp(-3.5, h, smooth(6, 24, riverD(x, z)));
  const la = Math.atan2(z - EP.lake.z, x - EP.lake.x);
  const ld = Math.hypot(x - EP.lake.x, z - EP.lake.z) / (EP.lake.r * (1 + 0.14 * Math.sin(3 * la + 1) + 0.08 * Math.sin(5 * la)));
  h = lerp(-4.5, h, smooth(0.7, 1.15, ld));
  h = lerp(10, h, smooth(40, 64, Math.hypot(x - EP.village.x, z - EP.village.z)));
  h = lerp(30, h, smooth(34, 47, Math.hypot(x - EP.castle.x, z - EP.castle.z)));
  const kd = Math.hypot(x - EP.crater.x, z - EP.crater.z);
  h += -15 * Math.exp(-((kd / 24) ** 2)) + 5 * Math.exp(-(((kd - 32) / 9) ** 2));
  const rd = roadD(x, z);
  if (rd < 6 && h > 0.8) h = lerp(h - 0.25, h, smooth(2, 6, rd));
  return h;
}
export function buildEarthGrid() {
  const { h, mask, flower, wheat } = grid2;
  for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) h[iz * GN + ix] = earthH(-HALF + ix * CELL, -HALF + iz * CELL);
  for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) {
    const i = iz * GN + ix, x = -HALF + ix * CELL, z = -HALF + iz * CELL;
    const hx = h[iz * GN + Math.min(GN - 1, ix + 1)] - h[iz * GN + Math.max(0, ix - 1)], hz = h[Math.min(GN - 1, iz + 1) * GN + ix] - h[Math.max(0, iz - 1) * GN + ix];
    const slope = Math.max(Math.abs(hx), Math.abs(hz)) / (2 * CELL);
    let m = smooth(0.6, 1.6, h[i]) * (1 - smooth(0.55, 1.0, slope));
    m *= smooth(3.5, 6, roadD(x, z));
    m *= 1 - smooth(33, 35, Math.hypot(x - EP.castle.x, z - EP.castle.z)) * (h[i] > 28 ? 1 : 0) * 0.8;
    const vd = Math.hypot(x - EP.village.x, z - EP.village.z);
    // fields: tilted patchwork around the village
    const a = 0.32, u = x * Math.cos(a) + z * Math.sin(a), v = -x * Math.sin(a) + z * Math.cos(a);
    const cu = Math.floor(u / 22), cv = Math.floor(v / 30), hash = Math.abs(Math.sin(cu * 127.1 + cv * 311.7) * 43758.5) % 1;
    const inField = smooth(36, 46, vd) * (1 - smooth(110, 130, vd)) * smooth(5, 8, roadD(x, z)) * (h[i] > 1.5 ? 1 : 0);
    wheat[i] = inField * (hash > 0.38 ? 1 : 0) * (1 - smooth(0.42, 0.5, Math.abs(((u / 22) % 1 + 1) % 1 - 0.5))) ;
    mask[i] = m;
    flower[i] = smooth(0.15, 0.45, fbm(x * 0.017 - 40, z * 0.017 + 12, 3)) * m * (1 - wheat[i]);
  }
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o));
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

export const EARTH = { feathers: [], enemies: [], marks: [], updrafts: [] };
export function buildEarth(scene) {
  const R = mulberry(777);
  const Y = EARTH_Y;
  const gA = (x, z) => groundAtL(x, z, 1);
  // ---- terrain
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, grid2.h[i]);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, cols = new Float32Array(pos.count * 3);
  const cLo = new THREE.Color('#5f7d3e'), cHi = new THREE.Color('#9aa75c'), cWheat = new THREE.Color('#c9a95a'), cWheat2 = new THREE.Color('#a8a253');
  const cRoad = new THREE.Color('#b29a72'), cBed = new THREE.Color('#5f7a74'), cSand = new THREE.Color('#c8b98f'), cRock = new THREE.Color('#9a9184'), cSnow = new THREE.Color('#e9ece8');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = grid2.h[i], ny = nrm.getY(i);
    const n = fbm(x * 0.04, z * 0.04, 2) * 0.5 + 0.5;
    c.copy(cLo).lerp(cHi, clamp(n * 0.7 + smooth(5, 40, h) * 0.4, 0, 1));
    c.lerp(n > 0.5 ? cWheat : cWheat2, grid2.wheat[i] * 0.9);
    c.lerp(cSand, 1 - smooth(-0.2, 1.4, h));
    if (h < -0.2) c.copy(cBed).lerp(cSand, smooth(-3, -0.2, h));
    c.lerp(cRoad, (1 - smooth(2.2, 4.2, roadD(x, z))) * (h > 0.5 ? 0.9 : 0));
    c.lerp(cRock, smooth(0.82, 0.6, ny));
    c.lerp(cSnow, smooth(70, 100, h) * smooth(0.55, 0.8, ny));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const terrain = new THREE.Mesh(geo, terrainDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  terrain.position.y = Y; terrain.receiveShadow = true; scene.add(terrain);
  // grass heightmap (relative heights; the grass shader adds the layer's base)
  const data = new Uint16Array(GN * GN * 4), Hf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < GN * GN; i++) { data[i * 4] = Hf(grid2.h[i]); data[i * 4 + 1] = Hf(grid2.mask[i]); data[i * 4 + 2] = Hf(grid2.flower[i]); data[i * 4 + 3] = Hf(grid2.wheat[i]); }
  const tex = new THREE.DataTexture(data, GN, GN, THREE.RGBAFormat, THREE.HalfFloatType); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  EARTH.heightTex = tex;
  // ---- water: one sheet at the waterline fills the river and the lake
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), W.water.simple.material);
  water.rotation.x = -Math.PI / 2; water.position.y = Y - 0.05; scene.add(water);
  EARTH.water = water;
  // ---- the underside of the cloud sea is this world's sky
  // ---- forest + scattered trees
  const N = 230;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.4, 1, 7, 2); trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat('#6f5e4c', { roughness: 0.9 }), N);
  const crowns = new THREE.InstancedMesh(W.canopyGeo, foliageMaterial(W.leafTex), N * 4);
  const pal = ['#56783a', '#668a40', '#4a6a34', '#7d9446', '#8f8a3c', '#a57a3a'].map((h) => new THREE.Color(h));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let n = 0, ci = 0, guard = 0;
  const spots = [];
  const okTree = (x, z) => {
    const h = grid2.h[Math.round((z + HALF) / CELL) * GN + Math.round((x + HALF) / CELL)];
    if (h < 1.5 || h > 60 || roadD(x, z) < 6) return false;
    if (Math.hypot(x - EP.village.x, z - EP.village.z) < 46 || Math.hypot(x - EP.castle.x, z - EP.castle.z) < 50 || Math.hypot(x - EP.crater.x, z - EP.crater.z) < 42) return false;
    const fi = Math.round((z + HALF) / CELL) * GN + Math.round((x + HALF) / CELL);
    if (grid2.wheat[fi] > 0.2) return false;
    return !spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 6.5);
  };
  while (n < N && guard++ < 9000) {
    const forest = R() < 0.62;
    const x = forest ? -170 + R() * 150 : (R() * 2 - 1) * 250, z = forest ? -70 + R() * 170 : (R() * 2 - 1) * 250;
    if (Math.hypot(x, z) > 245 || !okTree(x, z)) continue;
    const g = gA(x, z), H = 7 + R() * 8;
    e.set((R() - 0.5) * 0.1, R() * 6.28, (R() - 0.5) * 0.1); q.setFromEuler(e);
    trunks.setMatrixAt(n, m4.compose(pv.set(x, g - 0.3, z), q, sv.set(1 + H * 0.05, H, 1 + H * 0.05)));
    const base = pal[Math.floor(R() * pal.length)], k = 3 + Math.floor(R() * 2), cs = 0.9 + H * 0.06;
    for (let j = 0; j < k && ci < N * 4; j++) {
      const a = R() * 6.28, rr = j ? (1.2 + R()) * cs : 0, sz = (j ? 2 + R() : 3.2) * cs;
      e.set(R() - 0.5, R() * 6, R() - 0.5); q.setFromEuler(e);
      crowns.setMatrixAt(ci, m4.compose(pv.set(x + Math.cos(a) * rr, g + H - 0.6 + (j ? (R() - 0.5) * 1.8 : 1), z + Math.sin(a) * rr), q, sv.set(sz, sz * 0.9, sz)));
      crowns.setColorAt(ci++, c.copy(base).multiplyScalar(0.85 + R() * 0.3));
    }
    spots.push([x, z]); colliders.solids.push({ x, z, r: 0.6, y0: g - 1, y1: g + H });
    n++;
  }
  trunks.count = n; crowns.count = ci; trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
  scene.add(trunks, crowns);
  // boulders
  const rocks = new THREE.InstancedMesh(rockGeo(31, 2), W.rockMat, 60);
  let rn = 0; guard = 0;
  while (rn < 60 && guard++ < 3000) {
    const x = (R() * 2 - 1) * 240, z = (R() * 2 - 1) * 240;
    if (Math.hypot(x, z) > 250 || roadD(x, z) < 6 || Math.hypot(x - EP.village.x, z - EP.village.z) < 50) continue;
    const g = gA(x, z); if (g < Y + 1) continue;
    const sc = 0.8 + R() * 3; e.set(R(), R() * 6, R()); q.setFromEuler(e);
    rocks.setMatrixAt(rn++, m4.compose(pv.set(x, g + sc * 0.2, z), q, sv.set(sc * (1 + R()), sc * 0.7, sc * (1 + R()))));
    if (sc > 1.8) colliders.solids.push({ x, z, r: sc * 1.1, y0: g - 1, y1: g + sc });
  }
  rocks.count = rn; rocks.castShadow = rocks.receiveShadow = true; scene.add(noReflect(rocks));

  // ---- 晨鐘村 · the village
  const V = EP.village, vg = Y + 10;
  const village = new THREE.Group();
  const wallM = mat('#ece2cd', { map: TEX.marble, roughness: 0.9 }), roofM = mat('#a5583a', { roughness: 0.75 }), roofM2 = mat('#7d5a46'), woodM = mat('#6b5240'), winM = new THREE.MeshStandardMaterial({ color: '#ffd98f', emissive: '#ffb352', emissiveIntensity: 1.6 });
  const house = (x, z, w, d, hgt, rot, roof = roofM) => {
    const g = new THREE.Group(); g.position.set(x, vg, z); g.rotation.y = rot;
    const body = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wallM)); body.position.y = hgt / 2; g.add(body);
    const roofMesh = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.72, w * 0.72, d + 0.8, 3, 1), roof));
    roofMesh.rotation.set(Math.PI / 2, 0, Math.PI / 2); roofMesh.scale.set(1, 1, 0.62); roofMesh.position.y = hgt + w * 0.2; g.add(roofMesh);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.12), woodM); door.position.set(0, 1.0, d / 2 + 0.02); g.add(door);
    for (const sx of [-w * 0.3, w * 0.3]) { const wi = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), winM); wi.position.set(sx, hgt * 0.62, d / 2 + 0.03); g.add(wi); }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2, 0.7), wallM); chim.position.set(w * 0.25, hgt + w * 0.35, -d * 0.2); g.add(chim);
    village.add(g);
    colliders.solids.push({ x, z, r: Math.max(w, d) * 0.62, y0: vg - 1, y1: vg + hgt + 2 });
  };
  const ring = [[12, 0.2], [14, 1.1], [13, 2.0], [16, 2.9], [12, 3.8], [15, 4.7], [24, 0.6], [26, 1.6], [25, 2.5], [27, 3.4], [24, 4.4], [26, 5.4], [33, 1.0], [34, 2.2]];
  ring.forEach(([r, a], i) => {
    const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
    if (roadD(x, z) < 5) return;
    house(x, z, 5 + R() * 2.5, 6 + R() * 3, 3.6 + R() * 1.4, -a + Math.PI / 2 + (R() - 0.5) * 0.4, R() < 0.25 ? roofM2 : roofM);
  });
  { // chapel with a bell spire
    const g = new THREE.Group(); g.position.set(V.x - 6, vg, V.z - 20);
    const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(7, 7, 11), wallM)); b.position.y = 3.5; g.add(b);
    const rf = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 11.6, 3), roofM2)); rf.rotation.set(Math.PI / 2, 0, Math.PI / 2); rf.scale.set(1, 1, 0.65); rf.position.y = 8.6; g.add(rf);
    const tw = shadowy(new THREE.Mesh(new THREE.BoxGeometry(3.2, 13, 3.2), wallM)); tw.position.set(0, 6.5, 6.5); g.add(tw);
    const sp = shadowy(new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 4), roofM2)); sp.position.set(0, 16, 6.5); sp.rotation.y = Math.PI / 4; g.add(sp);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d7b468', { metalness: 0.9, roughness: 0.3 })); bell.rotation.x = Math.PI; bell.position.set(0, 12, 6.5); g.add(bell);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), winM); rose.position.set(0, 9.6, 8.12); g.add(rose);
    g.rotation.y = 0.3; village.add(g);
    colliders.solids.push({ x: V.x - 6, z: V.z - 20, r: 6, y0: vg - 1, y1: vg + 18 });
  }
  { // well + lanterns
    const well = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 1.1, 16), wallM)); well.position.set(V.x, vg + 0.55, V.z); village.add(well);
    const rf = shadowy(new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 4), roofM)); rf.position.set(V.x, vg + 3.3, V.z); rf.rotation.y = Math.PI / 4; village.add(rf);
    for (const sx of [-1.3, 1.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.8, 0.15), woodM); p.position.set(V.x + sx, vg + 1.4, V.z); village.add(p); }
    colliders.solids.push({ x: V.x, z: V.z, r: 1.6, y0: vg - 1, y1: vg + 3 });
    const lamp = new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffbe5c', emissiveIntensity: 2.4 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28 + 0.3, r = 19, x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 6), woodM); post.position.set(x, vg + 1.5, z); village.add(post);
      const l = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), lamp); l.position.set(x, vg + 3.1, z); village.add(l);
    }
  }
  scene.add(village); bakeStatic(village);
  // windmill on the hill
  {
    const M = EP.mill, mg = gA(M.x, M.z);
    const tw = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 11, 10), wallM)); tw.position.set(M.x, mg + 5.5, M.z); scene.add(tw);
    const cap = shadowy(new THREE.Mesh(new THREE.ConeGeometry(3, 3, 10), roofM)); cap.position.set(M.x, mg + 12.5, M.z); scene.add(cap);
    const hub = new THREE.Group(); hub.position.set(M.x, mg + 10, M.z + 3.1); scene.add(hub);
    for (let i = 0; i < 4; i++) { const bl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 0.12), mat('#e8dcc4'))); bl.position.y = 4.2; const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; arm.add(bl); hub.add(arm); }
    W.animated.push((t) => { hub.rotation.z = t * 0.5; });
    colliders.solids.push({ x: M.x, z: M.z, r: 3, y0: mg - 1, y1: mg + 12 });
    EARTH.feathers.push([M.x + 2, mg + 15, M.z]);
    EARTH.updrafts.push({ x: M.x - 7, z: M.z - 4, top: mg + 22, g: gA(M.x - 7, M.z - 4) });
  }
  // a bridge where the castle road crosses the river
  {
    const bx = -10, bz = riverZ(-10) + 2, deck = shadowy(new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 22), mat('#9c8d7a', { map: TEX.marble })));
    deck.position.set(bx, Y + 1.3, bz); deck.rotation.y = Math.atan2(-60, -80) + Math.PI / 2 - 0.1; scene.add(deck);
    EARTH.feathers.push([bx, Y + 3, bz]);
  }

  // ---- 傾城遺跡 · the ruined castle on its mesa
  const C = EP.castle, cg = Y + 30;
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
  scene.add(castle); bakeStatic(castle);
  EARTH.bossHome = new THREE.Vector3(C.x, cg, C.z - 4);
  EARTH.castleFloor = cg;

  // ---- 墜光坑 · the crater of the fallen light: the stairway home
  const K = EP.crater, kg = gA(K.x, K.z);
  const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#eef3fb', emissive: '#c8dcff', emissiveIntensity: 0.9, roughness: 0.15 }), 26);
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.28, r = 5 + R() * 13, x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r, h = 1 + R() * 3.5;
    e.set((R() - 0.5) * 0.9, R() * 6, (R() - 0.5) * 0.9); q.setFromEuler(e);
    shards.setMatrixAt(i, m4.compose(pv.set(x, gA(x, z) + h * 0.4, z), q, sv.set(0.4 + R() * 0.4, h, 0.4 + R() * 0.4)));
  }
  scene.add(noReflect(shards));
  const beamM = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.0, 1.6, 1.0), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 32, 1, true).translate(0, 0.5, 0), beamM);
  beam.scale.set(1, 260, 1); beam.position.set(K.x, kg, K.z); scene.add(noReflect(beam));
  const rune = new THREE.Mesh(new THREE.RingGeometry(2.6, 6.5, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.3, 1.0, 0.6), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2; rune.position.set(K.x, kg + 0.12, K.z); scene.add(rune);
  W.animated.push((t) => { rune.rotation.z = t * 0.2; beamM.opacity = 0.55 + Math.sin(t * 1.3) * 0.12; });
  EARTH.pillar = new THREE.Vector3(K.x, kg, K.z);
  EARTH.landing = new THREE.Vector3(K.x - 14, kg + 4, K.z + 18);

  // ---- updrafts (visuals are made by the world's updraft builder pattern)
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
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, h, 32, 1, true), m); col.position.set(u.x, u.g + h / 2, u.z); scene.add(noReflect(col));
    const base = new THREE.Mesh(new THREE.RingGeometry(1.5, 4.6, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(0.85, 0.62, 0.3), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.set(u.x, u.g + 0.1, u.z); scene.add(base);
    W.updrafts.push({ x: u.x, z: u.z, top: u.top, g: u.g, mat: m, base, earth: true });
  }

  // ---- feathers, foes, names
  const F = EARTH.feathers, fa = (x, z, dy = 1.4) => F.push([x, gA(x, z) + dy, z]);
  fa(V.x + 4, V.z + 4); fa(V.x - 20, V.z + 12); fa(V.x + 30, V.z - 30);
  fa(60, 80); fa(150, 120);
  fa(EP.lake.x + 40, EP.lake.z - 20); fa(EP.lake.x - 30, EP.lake.z + 30);
  fa(-120, 20); fa(-90, 60); fa(-150, -10);
  fa(C.x, C.z + 10); fa(C.x + 20, C.z - 20);
  fa(K.x + 10, K.z - 6); fa(K.x - 20, K.z + 30);
  fa(200, -200, 2); fa(-200, 160, 2); fa(30, -150);
  const foe = (x, z, t = 'melee') => EARTH.enemies.push([x, z, t]);
  foe(60, 92); foe(118, 100); foe(-100, 20); foe(-80, 60); foe(-130, 40, 'archer');
  foe(20, 30); foe(45, 12, 'archer'); foe(-100, -100); foe(-112, -126); foe(-88, -130, 'archer');
  foe(122, -86); foe(178, -132); foe(-40, -80); foe(80, -40, 'archer');
  EARTH.marks = [
    { x: V.x, z: V.z, r: 60, name: '晨鐘村', en: 'BELLDAWN VILLAGE' },
    { x: C.x, z: C.z, r: 48, name: '傾城遺跡', en: 'THE FALLEN KEEP' },
    { x: K.x, z: K.z, r: 40, name: '墜光坑', en: 'THE CRATER OF FALLEN LIGHT' },
    { x: EP.lake.x, z: EP.lake.z, r: 56, name: '靜湖', en: 'THE STILL LAKE' },
    { x: EP.mill.x, z: EP.mill.z, r: 22, name: '風車丘', en: 'WINDMILL HILL' },
  ];
}
export function earthRegion(x, z) {
  for (const m of EARTH.marks) if (Math.hypot(x - m.x, z - m.z) < m.r) return [m.name, m.en];
  if (riverD(x, z) < 16) return ['銀溪', 'THE SILVER BROOK'];
  if (Math.hypot(x, z) > 225) return ['環山', 'THE RINGING MOUNTAINS'];
  if (x < -20 && z > -70 && z < 100) return ['低語森林', 'THE WHISPERING WOOD'];
  const fi = Math.round((z + HALF) / CELL) * GN + Math.round((x + HALF) / CELL);
  if (grid2.wheat[fi] > 0.3) return ['金麥原', 'THE GOLDEN FIELDS'];
  return ['人間 · 蒼原', 'THE MORTAL VALE'];
}
