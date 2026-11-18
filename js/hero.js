// LUMENFALL · the seraph: procedural model, wings, cloth ribbons, pose animator
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX, clamp, lerp, damp, easeOut } from './core.js';

// merge every static mesh under `root` into one mesh per material (huge draw-call saving on phones)
export function bakeStatic(root, keep = () => false) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(), remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o === root || keep(o)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const keepAttr = ['position', 'normal', 'uv'].concat(o.material.vertexColors ? ['color'] : []);
    for (const k of Object.keys(g.attributes)) if (!keepAttr.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    const key = o.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: false, recv: false, order: o.renderOrder });
    const b = buckets.get(key);
    b.geos.push(g); b.cast ||= o.castShadow; b.recv ||= o.receiveShadow;
    remove.push(o);
  });
  remove.forEach((o) => o.parent.remove(o));
  const out = [];
  for (const b of buckets.values()) {
    const mg = mergeGeometries(b.geos);
    if (!mg) continue;
    mg.computeBoundingSphere();
    const mesh = new THREE.Mesh(mg, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.order;
    root.add(mesh); out.push(mesh);
  }
  return out;
}

const V2 = (a) => a.map(([r, y]) => new THREE.Vector2(r, y));
let featherGeo = null;
export function getFeatherGeo() {
  if (!featherGeo) { featherGeo = new THREE.PlaneGeometry(1, 1); featherGeo.translate(0, 0.5, 0); }
  return featherGeo;
}

export function makeHeroMats(stone) {
  if (stone) {
    const m = new THREE.MeshStandardMaterial({ color: '#efebe2', map: TEX.marble, roughness: 0.62 });
    const f = new THREE.MeshStandardMaterial({ color: '#ece8df', map: TEX.feather, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
    const g = new THREE.MeshStandardMaterial({ color: '#d2b26c', metalness: 0.85, roughness: 0.35 });
    return { skin: m, white: m, cloth: m, sheer: m, gold: g, goldGlow: g, hair: m, feather: f, sash: m, gem: g, stone: true };
  }
  return {
    skin: new THREE.MeshStandardMaterial({ color: '#f3e5db', roughness: 0.62 }),
    white: new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.42 }),
    cloth: new THREE.MeshStandardMaterial({ color: '#fbf9f4', roughness: 0.75, side: THREE.DoubleSide }),
    sheer: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false, emissive: '#fff4e2', emissiveIntensity: 0.2 }),
    gold: new THREE.MeshStandardMaterial({ color: '#dcb66c', metalness: 0.92, roughness: 0.26 }),
    goldGlow: new THREE.MeshStandardMaterial({ color: '#f6dc9c', emissive: '#ffd98c', emissiveIntensity: 2.6, metalness: 0.5, roughness: 0.3 }),
    hair: new THREE.MeshStandardMaterial({ color: '#dfe2ec', roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide, emissive: '#eef2ff', emissiveIntensity: 0.08 }),
    feather: new THREE.MeshStandardMaterial({ map: TEX.feather, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.03, color: '#f3efe7', emissive: '#fff0d4', emissiveMap: TEX.feather, emissiveIntensity: 0.3, roughness: 0.85 }),
    sash: new THREE.MeshStandardMaterial({ map: TEX.sash, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.7, emissive: '#fff6e8', emissiveIntensity: 0.12 }),
    gem: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e4eeff', emissiveIntensity: 3.2 }),
  };
}

// ---------- wing: a fan of feathers on a flat plane, folded by rotating the plane ----------
export function buildWing(mat, side) {
  const root = new THREE.Group();
  const plane = new THREE.Group();
  plane.scale.x = side;
  root.add(plane);
  const fg = getFeatherGeo();
  const feathers = [];
  const add = (x, y, z, len, w, th) => {
    const m = new THREE.Mesh(fg, mat);
    m.position.set(x, y, z);
    m.scale.set(w, len, 1);
    m.rotation.z = Math.PI + th;
    m.userData.th = th;
    m.userData.ph = Math.random() * 6.28;
    plane.add(m); feathers.push(m);
    return m;
  };
  const boneY = (x) => 0.3 * Math.sin(Math.min(1, x / 1.35) * Math.PI * 0.85);
  for (let k = 0; k < 9; k++) { // primaries
    const f = k / 8;
    add(1.0 + f * 0.36, boneY(1.0 + f * 0.36) + 0.02, 0, 1.3 - Math.abs(f - 0.35) * 0.45, 0.22, 0.42 + f * 1.1);
  }
  for (let k = 0; k < 9; k++) { // secondaries
    const f = k / 8;
    add(0.06 + f * 0.98, boneY(0.06 + f * 0.98) - 0.02, 0.012, 0.92 + f * 0.18, 0.26, 0.05 + f * 0.3);
  }
  for (let k = 0; k < 10; k++) { // coverts
    const f = k / 9;
    add(0.02 + f * 1.3, boneY(0.02 + f * 1.3) + 0.04, 0.024, 0.48 + Math.sin(f * 3) * 0.08, 0.22, 0.1 + f * 0.5);
  }
  for (let k = 0; k < 8; k++) { // lesser coverts
    const f = k / 7;
    add(0.02 + f * 1.1, boneY(0.02 + f * 1.1) + 0.07, 0.03, 0.28, 0.2, 0.15 + f * 0.4);
  }
  for (let k = 0; k < 6; k++) { // small scapulars near the root
    const f = k / 5;
    add(0.0 + f * 0.4, 0.06 + f * 0.05, 0.034, 0.3, 0.13, -0.05 + f * 0.25);
  }
  return { root, plane, feathers, side };
}

// ---------- cloth / hair ribbon simulated procedurally ----------
export class Ribbon {
  constructor(parent, pos, len, width, segs, mat, opt = {}) {
    this.geo = new THREE.PlaneGeometry(width, len, 1, segs);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.position.copy(pos);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.len = len; this.w = width; this.segs = segs;
    this.base = opt.base ?? 0.1;
    this.taper = opt.taper ?? 0.5;
    this.phase = opt.phase ?? Math.random() * 6.28;
    this.side = opt.side ?? 0;
    this.stiff = opt.stiff ?? 1;
    this.update(0, 0, 0);
  }
  update(t, trail, wind) {
    const p = this.geo.attributes.position;
    const n = this.segs, step = this.len / n;
    let y = 0, z = 0, x = 0;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (i > 0) {
        const ang = this.base + trail * 1.3 * f * this.stiff + Math.sin(t * 2.3 + this.phase - f * 3.2) * (0.05 + wind * 0.22) * f;
        y -= Math.cos(ang) * step;
        z -= Math.sin(ang) * step;
        x += Math.sin(t * 1.7 + this.phase + f * 2.5) * 0.012 * f * (1 + wind * 2) + this.side * step * 0.12 * f;
      }
      const hw = (this.w / 2) * (1 - this.taper * f);
      p.setXYZ(i * 2, x - hw, y, z);
      p.setXYZ(i * 2 + 1, x + hw, y, z);
    }
    p.needsUpdate = true;
  }
}

// ---------- the seraph ----------
export function buildSeraph(opt = {}) {
  const M = makeHeroMats(!!opt.stone);
  const shadow = !opt.noShadow;
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const R = { root, hips, M };

  // legs
  const legs = [];
  for (const side of [1, -1]) {
    const thigh = new THREE.Group(); thigh.position.set(side * 0.085, -0.02, 0); hips.add(thigh);
    mesh(new THREE.CapsuleGeometry(0.064, 0.34, 4, 10), M.white, thigh, 0, -0.22, 0);
    const knee = new THREE.Group(); knee.position.y = -0.45; thigh.add(knee);
    mesh(new THREE.CapsuleGeometry(0.048, 0.34, 4, 10), M.white, knee, 0, -0.21, 0);
    const orn = mesh(new THREE.OctahedronGeometry(1, 0), M.gold, knee, 0, 0.02, 0.05);
    orn.scale.set(0.05, 0.035, 0.012);
    const foot = mesh(new THREE.ConeGeometry(0.045, 0.2, 8), M.gold, knee, 0, -0.43, 0.06);
    foot.rotation.x = Math.PI / 2 + 0.25;
    legs.push({ thigh, knee });
  }
  R.legL = legs[0]; R.legR = legs[1];

  // skirts
  const skirt = mesh(new THREE.LatheGeometry(V2([[0.128, 0.03], [0.165, -0.06], [0.24, -0.19], [0.305, -0.31], [0.33, -0.36]]), 56), M.cloth, hips);
  const hem = mesh(new THREE.TorusGeometry(0.33, 0.009, 6, 40), M.gold, hips, 0, -0.36, 0);
  hem.rotation.x = Math.PI / 2;
  const over = mesh(new THREE.LatheGeometry(V2([[0.13, 0.03], [0.2, -0.1], [0.32, -0.36], [0.44, -0.64], [0.53, -0.86]]), 40, Math.PI - 1.9, 3.8), M.sheer, hips);
  over.castShadow = false;
  const pleat = (m, n, amt) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z), d = Math.min(1, Math.max(0, -y / 0.4));
      const k = 1 + Math.sin(a * n) * amt * d;
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    m.geometry.computeVertexNormals();
  };
  pleat(skirt, 14, 0.07); pleat(over, 9, 0.12);
  R.skirt = skirt; R.over = over;

  // torso
  const torso = new THREE.Group(); hips.add(torso); R.torso = torso;
  const body = mesh(new THREE.LatheGeometry(V2([[0.125, 0.0], [0.118, 0.08], [0.11, 0.16], [0.125, 0.25], [0.142, 0.33], [0.14, 0.4], [0.118, 0.45], [0.06, 0.5], [0.042, 0.53], [0.042, 0.62]]), 22), M.white, torso);
  body.scale.z = 0.78;
  const corset = mesh(new THREE.LatheGeometry(V2([[0.132, -0.01], [0.126, 0.08], [0.119, 0.16], [0.132, 0.24], [0.143, 0.29]]), 22), M.gold, torso);
  corset.scale.z = 0.8;
  const vplate = mesh(new THREE.OctahedronGeometry(1, 0), M.gold, torso, 0, 0.33, 0.112);
  vplate.scale.set(0.06, 0.11, 0.018);
  mesh(new THREE.SphereGeometry(0.018, 10, 8), M.gem, torso, 0, 0.36, 0.125);
  const collar = mesh(new THREE.TorusGeometry(0.047, 0.012, 6, 20), M.gold, torso, 0, 0.53, 0);
  collar.rotation.x = Math.PI / 2;

  // feather mantle over the shoulders
  const fg = getFeatherGeo();
  const mantle = new THREE.Group(); torso.add(mantle);
  for (let i = 0; i < 20; i++) {
    const f = i / 19;
    const a = Math.PI * 0.5 + 0.35 + f * (Math.PI * 2 - 0.7) - Math.PI * 0.5;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.47 - Math.abs(f - 0.5) * 0.03, 0);
    pivot.rotation.y = a;
    mantle.add(pivot);
    const fm = new THREE.Mesh(fg, M.feather);
    fm.position.z = 0.1;
    fm.rotation.x = Math.PI / 2 + 0.75 + Math.sin(i * 1.7) * 0.12;
    fm.scale.set(0.085, 0.24 + (i % 3) * 0.035, 1);
    pivot.add(fm);
  }

  // head
  const head = new THREE.Group(); head.position.y = 0.6; torso.add(head); R.head = head;
  mesh(new THREE.SphereGeometry(0.1, 24, 18), M.skin, head, 0, 0.1, 0.005);
  const cap = mesh(new THREE.SphereGeometry(0.112, 24, 16, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.78), M.hair, head, 0, 0.113, -0.008);
  cap.scale.set(1.03, 1.05, 1.08);
  const bangs = mesh(new THREE.SphereGeometry(0.113, 24, 10, 0, Math.PI * 2, 0, 0.95), M.hair, head, 0, 0.112, 0.004);
  bangs.rotation.x = 0.28;
  const visor = mesh(new THREE.CylinderGeometry(0.104, 0.1, 0.03, 28, 1, true, -1.35, 2.7), M.gold, head, 0, 0.105, 0.005);
  visor.material = M.gold;
  const crown = new THREE.Group(); head.add(crown);
  for (let i = 0; i < 9; i++) { // laurel crown
    const f = i / 8 - 0.5;
    const leaf = mesh(new THREE.OctahedronGeometry(1, 0), M.gold, crown, Math.sin(f * 2.6) * 0.115, 0.19 + Math.cos(f * 2.6) * 0.02, -0.03 - Math.cos(f * 2.6) * 0.03);
    leaf.scale.set(0.016, 0.065, 0.006);
    leaf.rotation.z = -f * 2.2;
    leaf.rotation.x = -0.5;
  }
  // halo
  const halo = new THREE.Group(); halo.position.set(0, 0.15, -0.17); head.add(halo); R.halo = halo;
  const hr = mesh(new THREE.TorusGeometry(0.22, 0.007, 8, 72), M.goldGlow, halo); hr.castShadow = false;
  const hr2 = mesh(new THREE.TorusGeometry(0.255, 0.003, 6, 72), M.goldGlow, halo); hr2.castShadow = false;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ray = mesh(new THREE.BoxGeometry(0.004, i % 2 ? 0.05 : 0.09, 0.004), M.goldGlow, halo, Math.cos(a) * (0.29 + (i % 2 ? 0 : 0.02)), Math.sin(a) * (0.29 + (i % 2 ? 0 : 0.02)), 0);
    ray.rotation.z = a - Math.PI / 2; ray.castShadow = false;
  }

  // arms
  const arms = [];
  for (const side of [1, -1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.165, 0.42, 0); torso.add(sh);
    mesh(new THREE.CapsuleGeometry(0.041, 0.2, 4, 8), M.skin, sh, 0, -0.13, 0);
    const band = mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16), M.gold, sh, 0, -0.08, 0); band.rotation.x = Math.PI / 2;
    const elbow = new THREE.Group(); elbow.position.y = -0.27; sh.add(elbow);
    mesh(new THREE.CapsuleGeometry(0.035, 0.19, 4, 8), M.skin, elbow, 0, -0.12, 0);
    const sleeve = mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.27, 14, 1, true), M.sheer, elbow, 0, -0.14, 0); sleeve.castShadow = false;
    const hand = new THREE.Group(); hand.position.y = -0.26; elbow.add(hand);
    mesh(new THREE.SphereGeometry(0.038, 10, 8), M.skin, hand);
    arms.push({ sh, elbow, hand });
  }
  R.armL = arms[0]; R.armR = arms[1];

  // spear in the right hand
  const spear = new THREE.Group(); R.armR.hand.add(spear); R.spear = spear;
  const shaft = mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.25, 8), M.gold, spear, 0, 0, 0.42);
  shaft.rotation.x = Math.PI / 2;
  const butt = mesh(new THREE.OctahedronGeometry(1, 0), M.gold, spear, 0, 0, -0.72); butt.scale.set(0.03, 0.03, 0.07);
  for (const z of [-0.09, 0.09, 1.45]) { const r = mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 12), M.gold, spear, 0, 0, z); }
  const blade = mesh(new THREE.OctahedronGeometry(1, 0), M.goldGlow, spear, 0, 0, 1.96); blade.scale.set(0.055, 0.016, 0.42);
  for (const s of [1, -1]) {
    const prong = mesh(new THREE.TorusGeometry(0.13, 0.011, 6, 18, 2.1), M.gold, spear, s * 0.02, 0, 1.6);
    prong.rotation.set(Math.PI / 2, 0, s > 0 ? -0.35 : Math.PI + 0.35);
    prong.scale.set(1, 1, 1);
  }
  mesh(new THREE.SphereGeometry(0.026, 10, 8), M.gem, spear, 0, 0, 1.56);
  spear.scale.setScalar(0.88);

  // wings
  const wings = [];
  for (const side of [1, -1]) {
    const w = buildWing(M.feather, side);
    w.root.position.set(side * 0.05, 0.37, -0.1);
    if (M.stone) w.feathers.forEach((f) => (f.castShadow = true));
    torso.add(w.root);
    wings.push(w);
  }
  R.wings = wings;

  // hair + sashes
  R.ribbons = [];
  if (!opt.noRibbons) {
    for (let k = 0; k < 9; k++) {
      const x = (k / 8 - 0.5) * 0.17;
      R.ribbons.push(new Ribbon(head, new THREE.Vector3(x, 0.15 - Math.abs(x) * 0.35, -0.085 + Math.abs(x) * 0.12), 0.82 + Math.sin(k * 2.3) * 0.12, 0.07, 8, M.hair, { base: 0.18 + Math.abs(x), taper: 0.65, side: x * 0.5, stiff: 1 }));
    }
    for (const s of [1, -1]) {
      R.ribbons.push(new Ribbon(head, new THREE.Vector3(s * 0.088, 0.12, 0.035), 0.32, 0.045, 5, M.hair, { base: 0.05, taper: 0.6, side: s * 0.3, stiff: 0.3 }));
      R.ribbons.push(new Ribbon(torso, new THREE.Vector3(s * 0.125, 0.41, -0.075), 1.28, 0.2, 10, M.sash, { base: 0.08, taper: 0.15, side: s * 0.25, stiff: 1.1 }));
    }
  }
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  // bake the static sub-assemblies
  bakeStatic(mantle); bakeStatic(crown); bakeStatic(halo); bakeStatic(spear);
  for (const w of wings) bakeStatic(w.plane);
  return R;
}

// ---------- pose animator ----------
const KEYS = ['thL', 'thR', 'knL', 'knR', 'hipY', 'hipX', 'tX', 'tY', 'tZ', 'hX', 'hY', 'sLx', 'sLz', 'eL', 'sRx', 'sRz', 'sRy', 'eR', 'spX', 'spY', 'spZ', 'fold', 'flap', 'wScale', 'wLift'];
export class SeraphRig {
  constructor(R) {
    this.R = R;
    this.c = {}; KEYS.forEach((k) => (this.c[k] = 0));
    Object.assign(this.c, { hipY: 0.95, fold: 0.6, wScale: 0.8, spX: -1.2 });
    this.t = 0;
  }
  // S: {speed (m/s), grounded, vy, glide, dash, atk:{idx,t}, cast, hurt, mode:'title'|'statue'|'play'}
  update(dt, S) {
    this.t += dt;
    const t = this.t, c = this.c;
    const T = {};
    const amp = clamp(S.speed / 7.2, 0, 1);
    const ph = (S.phase || 0);
    // base: idle / locomotion
    const breathe = Math.sin(t * 1.6) * 0.012;
    T.thL = -Math.sin(ph) * 0.62 * amp; T.thR = Math.sin(ph) * 0.62 * amp;
    T.knL = Math.max(0, Math.sin(ph + 1.3)) * 1.0 * amp + 0.05; T.knR = Math.max(0, -Math.sin(ph + 1.3)) * 1.0 * amp + 0.05;
    T.hipY = 0.95 - Math.abs(Math.cos(ph)) * 0.035 * amp + breathe * 0.3; T.hipX = 0;
    T.tX = 0.03 + amp * 0.16; T.tY = Math.sin(ph) * 0.12 * amp; T.tZ = 0; T.hX = -amp * 0.1; T.hY = 0;
    T.sLx = -0.32 + Math.sin(ph) * 0.4 * amp; T.sLz = 0.2 + amp * 0.1; T.eL = -1.55 + amp * 0.9;
    T.sRx = -0.12 - Math.sin(ph) * 0.15 * amp; T.sRz = -0.16; T.sRy = 0; T.eR = -0.35;
    T.spTilt = 0.12 + amp * 0.35; T.spMode = 'up';
    T.fold = 0.9 + amp * 0.12; T.flap = Math.sin(t * 1.2) * 0.03; T.wScale = 0.74 - amp * 0.04; T.wLift = 0;
    let rate = 12;

    if (S.mode === 'title') {
      T.fold = 0.42; T.wScale = 0.86; T.hX = -0.22; T.hY = 0.25; T.flap = Math.sin(t * 0.9) * 0.05; T.wLift = 0.08;
      T.sLx = -0.4; T.eL = -1.75; T.sLz = 0.24;
    } else if (S.mode === 'statue') {
      T.fold = -0.05; T.wScale = 1.0; T.wLift = 0.35; T.flap = 0; T.hX = 0.4;
      T.sLx = -0.55; T.sLz = -0.25; T.eL = -1.2; T.sRx = -0.55; T.sRz = 0.25; T.eR = -1.2; T.spTilt = 0; T.thL = -0.05; T.thR = 0.05;
    } else if (!S.grounded && S.glide) {
      T.hipX = 0.95; T.thL = 0.18; T.thR = 0.28; T.knL = 0.25; T.knR = 0.4; T.tX = 0.1; T.hX = -0.75; T.tY = 0;
      T.sLx = 0.25; T.sLz = 1.05; T.eL = -0.2; T.sRx = 0.2; T.sRz = -1.0; T.eR = -0.2; T.spMode = 'back';
      T.fold = -0.06; T.wScale = 1.18; T.flap = Math.sin(t * 2.4) * 0.06; T.wLift = 0.12; rate = 6;
    } else if (!S.grounded) {
      const up = clamp(S.vy / 9, -1, 1);
      T.thL = -0.7 + up * 0.2; T.thR = -0.1; T.knL = 1.1; T.knR = 0.55; T.tX = 0.08; T.hX = -0.05;
      T.sLx = -0.5; T.sLz = 0.6; T.eL = -0.5; T.sRx = -0.4; T.sRz = -0.5; T.eR = -0.4;
      T.fold = 0.45; T.wScale = 0.9; T.flap = up * 0.12;
    }
    if (S.dash > 0) {
      T.hipX = 0.55; T.tX = 0.2; T.thL = 0.4; T.thR = 0.55; T.knL = 0.6; T.knR = 0.8; T.fold = 0.05; T.wScale = 1.0; T.wLift = 0.25;
      T.sLx = 0.6; T.sLz = 0.5; T.sRx = 0.5; T.sRz = -0.5; T.spMode = 'back'; rate = 22;
    }
    if (S.atk && S.atk.idx >= 0) {
      const k = S.atk.idx, a = easeOut(S.atk.t / 0.2), rec = clamp((S.atk.t - 0.3) / 0.16, 0, 1);
      const W = (x, y) => lerp(x, y, a);
      T.thL = -0.45; T.thR = 0.32; T.knL = 0.25; T.knR = 0.35; T.hipY = 0.9; T.hipX = 0;
      T.spMode = 'arm'; T.fold = 0.7; T.wScale = 0.82; rate = 34;
      if (k === 0) { T.tY = W(-0.85, 0.75); T.sRx = W(-0.9, -1.45); T.sRz = W(-1.2, 0.15); T.eR = W(-0.9, -0.1); T.tX = 0.18; T.sLz = 0.55; T.sLx = -0.2; T.eL = -0.6; }
      else if (k === 1) { T.tY = W(0.7, -0.85); T.sRx = W(-1.6, -1.25); T.sRz = W(0.35, -1.3); T.eR = W(-0.25, -0.05); T.tX = 0.16; T.sLz = 0.6; T.sLx = 0.1; T.eL = -0.5; }
      else { T.tY = W(-0.45, 0.12); T.sRx = W(-1.0, -1.62); T.sRz = W(-0.4, -0.05); T.eR = W(-1.6, 0.0); T.tX = W(0.0, 0.32); T.thL = -0.75; T.knL = 0.5; T.sLz = 0.7; T.sLx = 0.3; T.eL = -0.3; T.fold = 0.2; }
      if (rec > 0) { // ease back toward base
        for (const key of ['tY', 'sRx', 'sRz', 'eR']) T[key] = lerp(T[key], key === 'sRx' ? -0.5 : key === 'eR' ? -0.4 : key === 'sRz' ? -0.4 : 0, rec * 0.6);
      }
    }
    if (S.cast >= 0) {
      const up = clamp(S.cast / 0.32, 0, 1), down = clamp((S.cast - 0.36) / 0.12, 0, 1);
      T.sLx = lerp(-2.9, -1.1, down); T.sRx = lerp(-2.9, -1.1, down); T.sLz = lerp(0.35, 0.5, down); T.sRz = lerp(-0.35, -0.5, down);
      T.eL = -0.2; T.eR = -0.2; T.hX = lerp(-0.45, 0.25, down); T.tX = lerp(-0.12, 0.35, down);
      T.fold = lerp(0.3, -0.12, up); T.wScale = lerp(0.95, 1.25, up); T.wLift = 0.3; T.spMode = 'arm'; rate = 26;
      T.hipY = lerp(0.95, 0.86, down);
    }
    if (S.hurt > 0) { T.tX = -0.35; T.hX = -0.3; T.sLz = 0.7; T.sRz = -0.7; rate = 30; }

    // spear orientation relative to the hand
    const pitch = (T.sRx ?? 0) + (T.eR ?? 0);
    if (T.spMode === 'up') { T.spX = -Math.PI / 2 - pitch + T.spTilt; T.spY = 0; T.spZ = 0; }
    else if (T.spMode === 'arm') { T.spX = Math.PI / 2; T.spY = 0; T.spZ = 0; }
    else { T.spX = Math.PI / 2 + 0.9 - pitch; T.spY = 0; T.spZ = 0; }

    for (const k of KEYS) if (T[k] !== undefined) c[k] = damp(c[k], T[k], rate, dt);
    this.apply(S, dt);
  }
  apply(S, dt) {
    const R = this.R, c = this.c, t = this.t;
    R.legL.thigh.rotation.x = c.thL; R.legR.thigh.rotation.x = c.thR;
    R.legL.knee.rotation.x = c.knL; R.legR.knee.rotation.x = c.knR;
    R.hips.position.y = c.hipY; R.hips.rotation.x = c.hipX;
    R.torso.rotation.set(c.tX, c.tY, c.tZ);
    R.head.rotation.set(c.hX, c.hY, 0);
    R.armL.sh.rotation.set(c.sLx, 0, c.sLz); R.armL.elbow.rotation.x = c.eL;
    R.armR.sh.rotation.set(c.sRx, c.sRy, c.sRz); R.armR.elbow.rotation.x = c.eR;
    R.spear.rotation.set(c.spX, c.spY, c.spZ);
    for (const w of R.wings) {
      const s = w.side;
      w.root.rotation.set(c.fold * 0.42 - c.wLift * 0.3, s * c.fold * 1.32, s * (0.22 + c.wLift - c.fold * 0.18 + c.flap));
      w.root.scale.setScalar(c.wScale);
    }
    if (R.halo) R.halo.rotation.z = t * 0.25;
    // cloth
    const trail = clamp((S.speed || 0) / 9 + (S.glide ? 0.75 : 0) + (S.dash > 0 ? 0.6 : 0) + (S.grounded ? 0 : clamp(-S.vy * 0.04, 0, 0.4)), 0, 1.25);
    const wind = 0.25 + (S.glide ? 0.8 : 0) + (S.mode === 'title' ? 0.35 : 0);
    for (const r of R.ribbons) r.update(t, trail, wind);
    R.over.rotation.x = -trail * 0.35 + Math.sin(t * 1.8) * 0.03;
    R.over.scale.y = 1 - trail * 0.15;
  }
}
