// LUMENFALL · seraph.js
// Skinned humanoid on a Mixamo-standard skeleton. Animation is authored in a "normalized" T-pose space,
// so any Mixamo-rigged GLB (e.g. a Tripo model) can replace the placeholder body without touching the animations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TEX, clamp, lerp, damp, easeOut, smooth } from './core.js';
import { buildWing, bakeStatic, getFeatherGeo } from './hero.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
export const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
const PARENT = { Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot' };
// T-pose joint positions (metres, facing +Z, feet on y=0)
const TP = { Hips: [0, 0.98, 0], Spine: [0, 1.06, 0], Spine1: [0, 1.16, 0], Spine2: [0, 1.27, 0], Neck: [0, 1.45, 0], Head: [0, 1.53, 0],
  LeftShoulder: [0.04, 1.40, 0], LeftArm: [0.16, 1.40, 0], LeftForeArm: [0.42, 1.40, 0], LeftHand: [0.66, 1.40, 0],
  LeftUpLeg: [0.09, 0.95, 0], LeftLeg: [0.09, 0.52, 0], LeftFoot: [0.09, 0.08, 0], LeftToeBase: [0.09, 0.02, 0.11] };
for (const k of Object.keys(TP)) if (k.startsWith('Left')) { const p = TP[k]; TP[k.replace('Left', 'Right')] = [-p[0], p[1], p[2]]; }
const SEG_END = { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: [0, 1.76, 0],
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: [0.75, 1.40, 0],
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: [0.09, 0.02, 0.18] };
for (const k of Object.keys(SEG_END)) if (k.startsWith('Left')) { const e = SEG_END[k]; SEG_END[k.replace('Left', 'Right')] = typeof e === 'string' ? e.replace('Left', 'Right') : [-e[0], e[1], e[2]]; }
const tp = (n) => new V3(...TP[n]);
const segEnd = (n) => { const e = SEG_END[n]; return typeof e === 'string' ? tp(e) : new V3(...e); };

// ---------------------------------------------------------------- materials
function rim(mat, color, strength = 1, power = 3) {
  const c = new THREE.Color(color).multiplyScalar(strength);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: c };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace('#include <opaque_fragment>', `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), ${power.toFixed(1)});\noutgoingLight += uRim * rimF;\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `rim-${c.r.toFixed(2)}-${c.g.toFixed(2)}-${c.b.toFixed(2)}-${power}`;
  return mat;
}
export function makeSeraphMats(fallen) {
  if (fallen) {
    return {
      skin: rim(new THREE.MeshStandardMaterial({ color: '#2a2630', roughness: 0.3, metalness: 0.55, emissive: '#ffbf5c', emissiveMap: TEX.vein, emissiveIntensity: 1.5 }), '#ffcf86', 0.5),
      dress: rim(new THREE.MeshStandardMaterial({ color: '#1e1c24', roughness: 0.35, metalness: 0.5, emissive: '#ffbf5c', emissiveMap: TEX.vein, emissiveIntensity: 0.9, side: THREE.DoubleSide }), '#d9a85a', 0.45),
      white: rim(new THREE.MeshStandardMaterial({ color: '#25222b', roughness: 0.3, metalness: 0.6 }), '#d9a85a', 0.4),
      gold: new THREE.MeshStandardMaterial({ color: '#a8823c', metalness: 0.9, roughness: 0.35 }),
      goldGlow: new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ff9a3c', emissiveIntensity: 3, metalness: 0.5, roughness: 0.3 }),
      sheer: new THREE.MeshStandardMaterial({ color: '#0e0d12', roughness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      hair: rim(new THREE.MeshStandardMaterial({ color: '#d7d9e0', roughness: 0.45, side: THREE.DoubleSide }), '#ffffff', 0.25),
      feather: new THREE.MeshStandardMaterial({ map: TEX.feather, color: '#0e0c13', transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, depthWrite: false, roughness: 0.32, metalness: 0.55 }),
      sash: new THREE.MeshStandardMaterial({ map: TEX.sash, color: '#2b2730', transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.7, emissive: '#ffb04a', emissiveIntensity: 0.15 }),
      gem: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ff8a3a', emissiveIntensity: 4 }),
      fallen: true,
    };
  }
  return {
    skin: rim(new THREE.MeshStandardMaterial({ color: '#f1dccf', roughness: 0.6 }), '#ffe2c2', 0.5),
    dress: rim(new THREE.MeshStandardMaterial({ color: '#f8f5ef', roughness: 0.62, side: THREE.DoubleSide }), '#fff1d2', 0.6),
    white: rim(new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.35 }), '#fff1d2', 0.5),
    gold: new THREE.MeshStandardMaterial({ color: '#dcb66c', metalness: 0.92, roughness: 0.26 }),
    goldGlow: new THREE.MeshStandardMaterial({ color: '#f6dc9c', emissive: '#ffd98c', emissiveIntensity: 2.6, metalness: 0.5, roughness: 0.3 }),
    sheer: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, emissive: '#fff4e2', emissiveIntensity: 0.2 }),
    hair: rim(new THREE.MeshStandardMaterial({ color: '#cdd2e4', roughness: 0.38, metalness: 0.15, side: THREE.DoubleSide, emissive: '#e8ecff', emissiveIntensity: 0.05 }), '#ffffff', 0.6),
    feather: new THREE.MeshStandardMaterial({ map: TEX.feather, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.03, color: '#f3efe7', emissive: '#fff0d4', emissiveMap: TEX.feather, emissiveIntensity: 0.3, roughness: 0.85 }),
    sash: new THREE.MeshStandardMaterial({ map: TEX.sash, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.7, emissive: '#fff6e8', emissiveIntensity: 0.12 }),
    gem: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e4eeff', emissiveIntensity: 3.2 }),
  };
}

// the hero: a human warrior — cream tunic, leather and steel, brown hair. The angel only shows when the wings open.
export function makeWarriorMats() {
  const M = makeSeraphMats(false);
  M.dress = rim(new THREE.MeshStandardMaterial({ color: '#ece4d2', roughness: 0.7, side: THREE.DoubleSide }), '#fff1d2', 0.45);
  M.white = rim(new THREE.MeshStandardMaterial({ color: '#7d776c', roughness: 0.75 }), '#e8dcc4', 0.3);
  M.hair = rim(new THREE.MeshStandardMaterial({ color: '#5b4434', roughness: 0.55, side: THREE.DoubleSide }), '#d9b98e', 0.35);
  M.leather = new THREE.MeshStandardMaterial({ color: '#6e5038', roughness: 0.68, metalness: 0.08 });
  M.steel = rim(new THREE.MeshStandardMaterial({ color: '#c3c7cf', roughness: 0.32, metalness: 0.82 }), '#ffffff', 0.25);
  M.cape = new THREE.MeshStandardMaterial({ map: capeTexture(), roughness: 0.86, side: THREE.DoubleSide });
  M.eye = new THREE.MeshStandardMaterial({ color: '#3d2c22', roughness: 0.25, metalness: 0.1 });
  M.fur = new THREE.MeshStandardMaterial({ color: '#d8ccb4', roughness: 0.95 });
  M.sash = new THREE.MeshStandardMaterial({ map: TEX.sash, color: '#e9dcc0', transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.75, emissive: '#fff6e8', emissiveIntensity: 0.05 });
  return M;
}

// the hero's half-cape: deep Belldawn blue with a gold hem, so he reads against bright ground and sky
const _capeTex = {};
function capeTexture(col = '#2c3d6b') {
  if (_capeTex[col]) return _capeTex[col];
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const dk = new THREE.Color(col).multiplyScalar(0.68);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, col); gr.addColorStop(1, '#' + dk.getHexString());
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  g.globalAlpha = 0.18; g.fillStyle = '#0d1428'; for (let x = 4; x < 64; x += 9) g.fillRect(x, 0, 2, 128); // folds
  g.globalAlpha = 1; g.fillStyle = '#c9a45a'; g.fillRect(0, 114, 64, 4); g.fillRect(0, 121, 64, 2); g.fillRect(0, 0, 3, 128); g.fillRect(61, 0, 3, 128);
  g.fillStyle = '#e7cd8a'; for (let x = 6; x < 64; x += 12) { g.beginPath(); g.moveTo(x, 106); g.lineTo(x + 3, 110); g.lineTo(x, 114); g.lineTo(x - 3, 110); g.fill(); } // a row of small diamonds above the hem
  const t = _capeTex[col] = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// ---------------------------------------------------------------- the hero's look: outfit, hair, colours, build (the reliquary's dressing room)
export const OUTFITS = {
  belldawn: { name: '晨鐘旅裝', en: 'BELLDAWN TRAVELLER', dress: '#ece4d2', leather: '#6e5038', white: '#7d776c', steel: '#c3c7cf' },
  knight: { name: '騎士輕甲', en: "KNIGHT'S HALF-PLATE", dress: '#3d4b70', leather: '#4a3628', white: '#5d5f66', steel: '#d6dae2', plate: true },
  watcher: { name: '守望白袍', en: "WATCHER'S WHITE", dress: '#f5f0e6', leather: '#b7955c', white: '#e6dfd1', steel: '#e8d6a6', robe: true, noPauldron: true },
  hunter: { name: '獵人皮衣', en: "HUNTER'S LEATHERS", dress: '#5b6a48', leather: '#4c3a2a', white: '#4e4639', steel: '#8d8a83', fur: true },
};
export const HAIRS = { short: { name: '短髮', cloth: [4, 3, 0.2, 0.16] }, long: { name: '長髮', cloth: [5, 8, 0.22, 0.6] }, tied: { name: '束髮', cloth: [2, 6, 0.075, 0.42] } };
const HAIR_CLOTH = Object.assign({ none: { cloth: null } }, HAIRS);
export const CAPES = { half: { name: '半披風', cloth: [6, 9, 0.5, 0.86] }, long: { name: '長披風', cloth: [6, 12, 0.54, 1.3] }, none: { name: '不披', cloth: null } };
export const LOOK_DEFAULT = { outfit: 'belldawn', cape: 'half', capeCol: '#2c3d6b', hair: 'short', hairCol: '#5b4434', skin: '#f1dccf', eye: '#3d2c22', height: 1, build: 0 };
// ---------------------------------------------------------------- placeholder skinned body
function capsuleBetween(a, b, r) {
  const d = new V3().subVectors(b, a), L = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), 4, 14);
  g.applyQuaternion(new Q().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function lathe(pts, seg, zs = 1, phiStart = 0, phiLen = Math.PI * 2) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
  g.scale(1, 1, zs);
  return g;
}
function pleat(g, n, amt, top, bottom) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z), d = clamp((top - y) / (top - bottom), 0, 1);
    const k = 1 + Math.sin(a * n) * amt * d;
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function distSeg(p, a, b) {
  const ab = _t1.subVectors(b, a), ap = _t2.subVectors(p, a);
  const t = clamp(ap.dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return _t3.copy(a).addScaledVector(ab, t).distanceTo(p);
}
const _t1 = new V3(), _t2 = new V3(), _t3 = new V3();
function skinPart(g, cands, custom) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const pos = g.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const segs = cands ? cands.map((c) => [BONES.indexOf(c), tp(c), segEnd(c)]) : [];
  const p = new V3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let ws = custom ? custom(p) : segs.map(([bi, a, b]) => [bi, 1 / Math.pow(distSeg(p, a, b) ** 2 + 2e-4, 2)]);
    ws.sort((x, y) => y[1] - x[1]);
    ws = ws.slice(0, 4);
    const tot = ws.reduce((s, w) => s + w[1], 0) || 1;
    ws.forEach(([bi, w], k) => { si[i * 4 + k] = bi; sw[i * 4 + k] = w / tot; });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}
export function buildBody(M, style, look) {
  const war = style === 'warrior', L = (war && look) || {}, O = OUTFITS[L.outfit] || OUTFITS.belldawn, bw = 1 + (L.build || 0) * 0.11, lw = 1 + (L.build || 0) * 0.08;
  const fem = L.sex === 'f', belly = L.belly || 0;
  // girth swells the waist, a woman's frame narrows the shoulders and widens the hips
  const lt = (pts) => pts.map(([r, y]) => [r * bw * (1 + belly * 0.5 * Math.max(0, 1 - Math.abs(y - 1.1) / 0.22)) * (fem ? (y > 1.25 ? 0.9 : y < 1.04 ? 1.07 : 1) : 1), y]);
  const bones = {}, list = [];
  for (const n of BONES) { const b = new THREE.Bone(); b.name = 'mixamorig' + n; bones[n] = b; list.push(b); }
  for (const n of BONES) {
    const p = PARENT[n], pos = TP[n];
    if (p) { const pp = TP[p]; bones[n].position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]); bones[p].add(bones[n]); }
    else bones[n].position.set(...pos);
  }
  const parts = [];
  const add = (geo, mat, cands, custom) => parts.push({ g: skinPart(geo, cands, custom), m: mat });
  const BI = (n) => BONES.indexOf(n);
  // torso & dress
  if (war) add(lathe(lt([[0.128, 0.9], [0.126, 0.98], [0.124, 1.06], [0.132, 1.14], [0.152, 1.24], [0.162, 1.32], [0.148, 1.39], [0.1, 1.43], [0.05, 1.46], [0.04, 1.49]]), 26, 0.8), 'dress', ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder']);
  else add(lathe([[0.122, 0.9], [0.118, 0.98], [0.11, 1.06], [0.116, 1.14], [0.133, 1.24], [0.14, 1.32], [0.128, 1.39], [0.088, 1.43], [0.048, 1.46], [0.038, 1.49]], 26, 0.74), 'dress', ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder']);
  if (war) {
    // leather belt with a small gold buckle, a strap across the chest, steel pauldrons
    add(lathe(lt([[0.134, 0.975], [0.131, 1.0], [0.131, 1.03], [0.134, 1.05]]), 26, 0.82), O.robe ? 'gold' : 'leather', ['Hips', 'Spine']);
    { const g = new THREE.BoxGeometry(0.05, 0.05, 0.012); g.translate(0, 1.012, 0.108); add(g, 'gold', ['Hips', 'Spine']); }
    if (!O.plate && !O.robe) { const g = new THREE.TorusGeometry(0.15 * bw, 0.011, 6, 36); g.scale(1, 1.25, 0.72); g.rotateZ(0.62); g.translate(0, 1.2, 0); add(g, 'leather', ['Spine1', 'Spine2']); }
    if (O.plate) { // a breastplate over the surcoat
      add(lathe(lt([[0.146, 1.1], [0.165, 1.2], [0.176, 1.29], [0.163, 1.37], [0.12, 1.425], [0.07, 1.45]]), 26, 0.86), 'steel', ['Spine', 'Spine1', 'Spine2']);
      const g = new THREE.TorusGeometry(0.168 * bw, 0.007, 6, 36); g.rotateX(Math.PI / 2); g.scale(1, 0.86, 1); g.translate(0, 1.1, 0); add(g, 'gold', ['Spine']);
    }
    if (O.fur) { const g = new THREE.TorusGeometry(0.13 * bw, 0.045, 8, 28); g.rotateX(Math.PI / 2); g.scale(1.05, 0.82, 0.9); g.translate(0, 1.43, -0.005); add(g, 'fur', ['Spine2', 'Neck']); }
    if (O.robe) { const g = new THREE.TorusGeometry(0.11 * bw, 0.016, 6, 30); g.rotateX(Math.PI / 2); g.scale(1, 0.8, 1); g.translate(0, 1.42, 0); add(g, 'gold', ['Spine2']); }
    if (!O.noPauldron) for (const sx of [1, -1]) { const k = O.plate ? 1.3 : 1, g = new THREE.SphereGeometry(0.075 * k, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(1.1, 0.75, 1.0); g.rotateZ(-sx * 0.35); g.translate(sx * 0.17 * bw, 1.415, 0); add(g, O.fur ? 'leather' : 'steel', [sx > 0 ? 'LeftShoulder' : 'RightShoulder', sx > 0 ? 'LeftArm' : 'RightArm', 'Spine2']); }
  } else add(lathe([[0.121, 1.055], [0.117, 1.09], [0.119, 1.13], [0.126, 1.16]], 26, 0.77), 'gold', ['Spine', 'Spine1', 'Spine2']);
  if (!war) { const g = new THREE.TorusGeometry(0.128, 0.006, 6, 40); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.76); g.translate(0, 1.245, 0); add(g, 'gold', ['Spine2']); }
  if (!war) { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.058, 0.11, 0.016); g.translate(0, 1.31, 0.103); add(g, 'gold', ['Spine2']); }
  if (war && fem) for (const sx of [1, -1]) { const g = new THREE.SphereGeometry(0.052 * bw, 12, 8); g.scale(1, 0.85, 0.75); g.translate(sx * 0.055, 1.285, 0.088 * bw); add(g, 'dress', ['Spine1', 'Spine2']); }
  if (!war || !L.noPendant) { const g = new THREE.SphereGeometry(war ? 0.014 : 0.018, 10, 8); g.translate(0, war ? 1.34 : 1.335, war ? 0.13 : 0.112); add(g, 'gem', ['Spine2']); } // the warrior wears his father's light as a small pendant
  { const g = new THREE.TorusGeometry(0.045, 0.011, 6, 20); g.rotateX(Math.PI / 2); g.translate(0, 1.47, 0); add(g, 'gold', ['Neck']); }
  // neck + head
  add(capsuleBetween(new V3(0, 1.43, 0), new V3(0, 1.55, 0.005), 0.033), 'skin', ['Spine2', 'Neck', 'Head']);
  { const g = new THREE.SphereGeometry(0.1, 26, 20); g.scale(0.95, 1.07, 1.0); g.translate(0, 1.625, 0.01); add(g, 'skin', ['Head']); }
  if (war) { // a face: eyes and brows, so he reads as someone up close
    for (const sx of [1, -1]) {
      { const g = new THREE.SphereGeometry(0.0125, 12, 8); g.scale(1.25, 0.9, 0.5); g.translate(sx * 0.034, 1.633, 0.1); add(g, 'eye', ['Head']); }
      { const g = new THREE.BoxGeometry(0.032, 0.0055, 0.008); g.rotateZ(sx * -0.12); g.translate(sx * 0.035, 1.656, 0.1); add(g, 'hair', ['Head']); }
    }
  }
  if (war && L.beard) { const g = new THREE.SphereGeometry(0.085, 16, 10, Math.PI / 2 - 1.1, 2.2, Math.PI * 0.52, Math.PI * 0.38); g.scale(0.95, 1.15, 1.05); g.translate(0, 1.6, 0.012); add(g, 'hair', ['Head']); }
  if (war && L.hair === 'none') { /* a shaven head */ }
  else if (war && L.hair === 'long') { const g = new THREE.SphereGeometry(0.112, 26, 18, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.78); g.scale(1.05, 1.06, 1.1); g.translate(0, 1.642, -0.006); add(g, 'hair', ['Head']); }
  else if (war) { const g = new THREE.SphereGeometry(0.108, 26, 16, Math.PI / 2 + 1.2, Math.PI * 2 - 2.4, 0, Math.PI * 0.62); g.scale(1.04, 1.04, 1.08); g.translate(0, 1.645, -0.006); add(g, 'hair', ['Head']); }
  if (war && L.hair === 'tied') { const g = new THREE.SphereGeometry(0.036, 12, 10); g.scale(1, 0.9, 0.85); g.translate(0, 1.7, -0.098); add(g, 'hair', ['Head']); }
  else { const g = new THREE.SphereGeometry(0.112, 26, 18, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.8); g.scale(1.03, 1.06, 1.1); g.translate(0, 1.64, -0.004); add(g, 'hair', ['Head']); }
  if (!(war && L.hair === 'none')) { const g = new THREE.SphereGeometry(0.113, 26, 10, 0, Math.PI * 2, 0, 0.95); g.rotateX(0.28); g.translate(0, 1.637, 0.008); add(g, 'hair', ['Head']); }
  if (!war) { const g = new THREE.CylinderGeometry(0.103, 0.099, 0.028, 28, 1, true, -1.35, 2.7); g.translate(0, 1.628, 0.012); add(g, 'gold', ['Head']); }
  for (const sx of war ? [] : [1, -1]) { // side locks framing the face
    const g = new THREE.CylinderGeometry(0.03, 0.006, 0.3, 8, 4); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) * 0.45 + (0.15 - y) * 0.08); p.setX(i, p.getX(i) + Math.sin((0.15 - y) * 5) * 0.012 * sx); }
    g.computeVertexNormals(); g.translate(sx * 0.098, 1.52, 0.035); add(g, 'hair', ['Head']);
  }
  for (let i = 0; i < (war ? 0 : 9); i++) {
    const f = i / 8 - 0.5, g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.016, 0.065, 0.006); g.rotateX(-0.5); g.rotateZ(-f * 2.2);
    g.translate(Math.sin(f * 2.6) * 0.115, 1.715 + Math.cos(f * 2.6) * 0.02, -0.03 - Math.cos(f * 2.6) * 0.03);
    add(g, 'gold', ['Head']);
  }
  for (const s of ['Left', 'Right']) {
    const sx = s === 'Left' ? 1 : -1;
    { const g = new THREE.SphereGeometry(0.047, 14, 10); g.translate(sx * 0.163, 1.4, 0); add(g, 'skin', [s + 'Shoulder', s + 'Arm', 'Spine2']); }
    add(capsuleBetween(tp(s + 'Arm'), tp(s + 'ForeArm'), 0.039 * (war ? lw : 1)), war && (O.plate || O.robe) ? 'dress' : 'skin', [s + 'Shoulder', s + 'Arm', s + 'ForeArm']);
    { const g = new THREE.TorusGeometry(0.044, 0.008, 6, 16); g.rotateY(Math.PI / 2); g.translate(sx * 0.23, 1.4, 0); add(g, 'gold', [s + 'Arm']); }
    add(capsuleBetween(tp(s + 'ForeArm'), tp(s + 'Hand'), 0.032), 'skin', [s + 'Arm', s + 'ForeArm', s + 'Hand']);
    if (war) { const g = new THREE.CylinderGeometry(0.043, 0.04, 0.16, 12); g.rotateZ(-sx * Math.PI / 2); g.translate(sx * 0.6, 1.4, 0); add(g, 'leather', [s + 'ForeArm']); }
    else { const g = new THREE.CylinderGeometry(0.048, 0.115, 0.27, 16, 1, true); g.rotateZ(-sx * Math.PI / 2); g.translate(sx * 0.56, 1.4, 0); add(g, 'sheer', [s + 'ForeArm']); }
    { const g = new THREE.SphereGeometry(0.036, 10, 8); g.scale(1.45, 0.8, 0.95); g.translate(sx * 0.705, 1.4, 0); add(g, 'skin', [s + 'ForeArm', s + 'Hand']); }
    add(capsuleBetween(tp(s + 'UpLeg'), tp(s + 'Leg'), 0.062 * (war ? lw : 1)), 'white', ['Hips', s + 'UpLeg', s + 'Leg']);
    add(capsuleBetween(tp(s + 'Leg'), tp(s + 'Foot'), (war ? 0.054 : 0.046) * (war ? lw : 1)), war ? (O.plate ? 'steel' : 'leather') : 'white', [s + 'UpLeg', s + 'Leg', s + 'Foot']);
    { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.05, 0.035, 0.012); g.translate(sx * 0.09, 0.54, 0.055); add(g, 'gold', [s + 'Leg']); }
    { const g = new THREE.CylinderGeometry(0.008, 0.044, 0.22, 10); g.rotateX(Math.PI / 2 + 0.2); g.translate(sx * 0.09, 0.055, 0.05); add(g, 'gold', [s + 'Foot', s + 'ToeBase']); }
  }
  // skirts: mostly follow the hips, a little of each thigh
  const skirtW = (p) => {
    const down = clamp((1.0 - p.y) / 0.42, 0, 1), side = clamp(Math.abs(p.x) / 0.18, 0, 1) * down * 0.42;
    return [[BI('Hips'), 1 - side], [BI(p.x >= 0 ? 'LeftUpLeg' : 'RightUpLeg'), side]];
  };
  if (war) {
    // a short tunic skirt over the trousers, split at the sides (the watcher's robe falls to the knee)
    const sk = O.robe ? [[0.132, 1.0], [0.17, 0.92], [0.22, 0.79], [0.255, 0.66], [0.27, 0.58]] : [[0.132, 1.0], [0.16, 0.94], [0.2, 0.86], [0.225, 0.8]], hem = sk[sk.length - 1];
    add(pleat(lathe(lt(sk), 40), O.robe ? 12 : 8, O.robe ? 0.06 : 0.05, 1.0, hem[1]), 'dress', null, skirtW);
    { const g = new THREE.TorusGeometry(hem[0] * bw, 0.006, 6, 40); g.rotateX(Math.PI / 2); g.translate(0, hem[1], 0); add(g, 'gold', null, skirtW); }
  } else {
  add(pleat(lathe([[0.122, 1.0], [0.163, 0.92], [0.24, 0.79], [0.305, 0.67], [0.33, 0.62]], 56), 14, 0.07, 0.98, 0.62), 'dress', null, skirtW);
  { const g = new THREE.TorusGeometry(0.33, 0.009, 6, 48); g.rotateX(Math.PI / 2); g.translate(0, 0.62, 0); add(g, 'gold', null, skirtW); }
  add(pleat(lathe([[0.13, 1.0], [0.2, 0.88], [0.32, 0.62], [0.44, 0.34], [0.53, 0.14]], 40, 1, Math.PI - 1.9, 3.8), 9, 0.12, 1.0, 0.2), 'sheer', null, (p) => [[BI('Hips'), 0.85], [BI(p.x >= 0 ? 'LeftUpLeg' : 'RightUpLeg'), 0.15]]);
  }

  // merge by material
  const order = [], buckets = {};
  for (const part of parts) { if (!buckets[part.m]) { buckets[part.m] = []; order.push(part.m); } buckets[part.m].push(part.g); }
  const geos = order.map((m) => mergeGeometries(buckets[m]));
  const geo = mergeGeometries(geos, true);
  geo.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(geo, order.map((m) => M[m]));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(bones.Hips);
  mesh.bind(new THREE.Skeleton(list));
  return { mesh, bones };
}

// ---------------------------------------------------------------- normalized humanoid rig (works for any Mixamo/VRM-style skeleton)
const ALIAS = { chest: 'Spine1', upperchest: 'Spine2', leftupperarm: 'LeftArm', leftlowerarm: 'LeftForeArm', rightupperarm: 'RightArm', rightlowerarm: 'RightForeArm',
  leftupperleg: 'LeftUpLeg', leftlowerleg: 'LeftLeg', rightupperleg: 'RightUpLeg', rightlowerleg: 'RightLeg', lefttoes: 'LeftToeBase', righttoes: 'RightToeBase' };
const LOWER = Object.fromEntries(BONES.map((b) => [b.toLowerCase(), b]));
export function canonBone(name) {
  const s = name.replace(/^mixamorig\d*[:_]?/i, '').replace(/[\s:_.\-|]/g, '').toLowerCase();
  return LOWER[s] || ALIAS[s] || null;
}
export class HumanoidRig {
  constructor(modelRoot, boneMap) {
    this.root = modelRoot; this.b = boneMap; this.d = {};
    modelRoot.updateMatrixWorld(true);
    const rootQinv = modelRoot.getWorldQuaternion(new Q()).invert();
    const rootInvM = modelRoot.matrixWorld.clone().invert();
    const restRel = new Map(), posRel = {};
    modelRoot.traverse((o) => { if (o.isBone || o.isObject3D) restRel.set(o, rootQinv.clone().multiply(o.getWorldQuaternion(new Q()))); });
    for (const n of BONES) if (boneMap[n]) posRel[n] = boneMap[n].getWorldPosition(new V3()).applyMatrix4(rootInvM);
    const corr = {};
    const fix = (a, b, ideal) => { if (posRel[a] && posRel[b]) { const dir = posRel[b].clone().sub(posRel[a]).normalize(); if (dir.angleTo(ideal) > 0.04) corr[a] = new Q().setFromUnitVectors(dir, ideal); } };
    fix('LeftArm', 'LeftForeArm', new V3(1, 0, 0)); fix('RightArm', 'RightForeArm', new V3(-1, 0, 0));
    fix('LeftUpLeg', 'LeftLeg', new V3(0, -1, 0)); fix('RightUpLeg', 'RightLeg', new V3(0, -1, 0));
    const inh = new Map();
    const inherited = (o) => { for (let p = o.parent; p && p !== modelRoot; p = p.parent) if (inh.has(p)) return inh.get(p); return new Q(); };
    for (const n of BONES) {
      const bone = boneMap[n]; if (!bone) continue;
      const P = restRel.get(bone.parent) || new Q();
      const Cin = inherited(bone);
      const CP = Cin.clone().multiply(P);
      const own = corr[n];
      let post = CP.clone().multiply(bone.quaternion);
      if (own) post = own.clone().multiply(post);
      const Ctot = own ? own.clone() : Cin.clone();
      inh.set(bone, Ctot);
      this.d[n] = { bone, pre: CP.clone().invert(), post, restInv: Ctot.clone().multiply(restRel.get(bone)).invert(), restPos: bone.position.clone() };
    }
    const hips = boneMap.Hips;
    const parentRel = rootInvM.clone().multiply(hips.parent.matrixWorld);
    this.hipsM3 = new THREE.Matrix3().setFromMatrix4(parentRel.invert());
    this.scale = modelRoot.scale.x;
    this._q = new Q(); this._v = new V3();
  }
  apply(qs, hipsOffset) {
    for (const n in this.d) {
      const d = this.d[n];
      d.bone.quaternion.copy(d.pre);
      if (qs[n]) d.bone.quaternion.multiply(qs[n]);
      d.bone.quaternion.multiply(d.post);
    }
    const h = this.d.Hips;
    if (h && hipsOffset) h.bone.position.copy(h.restPos).add(this._v.copy(hipsOffset).divideScalar(this.scale).applyMatrix3(this.hipsM3));
  }
  // normalized world orientation + position of a bone
  socket(n, outPos, outQ) {
    const d = this.d[n]; if (!d) return false;
    d.bone.getWorldPosition(outPos);
    const rq = this.root.getWorldQuaternion(this._q);
    d.bone.getWorldQuaternion(outQ).premultiply(rq.clone().invert()).multiply(d.restInv).premultiply(rq);
    return true;
  }
}

// ---------------------------------------------------------------- verlet cloth strip (hair, sashes)
export class Cloth {
  constructor(nx, ny, w, h, mat, opt = {}) {
    this.nx = nx; this.ny = ny; this.w = w; this.h = h;
    const N = (nx + 1) * (ny + 1);
    this.p = new Float32Array(N * 3); this.o = new Float32Array(N * 3);
    this.geo = new THREE.PlaneGeometry(w, h, nx, ny);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = !!opt.shadow;
    this.cons = [];
    const id = (x, y) => y * (nx + 1) + x;
    const dx = w / nx, dy = h / ny, dd = Math.hypot(dx, dy);
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      if (x < nx) this.cons.push([id(x, y), id(x + 1, y), dx]);
      if (y < ny) this.cons.push([id(x, y), id(x, y + 1), dy]);
      if (x < nx && y < ny) { this.cons.push([id(x, y), id(x + 1, y + 1), dd]); this.cons.push([id(x + 1, y), id(x, y + 1), dd]); }
      if (y < ny - 1) this.cons.push([id(x, y), id(x, y + 2), dy * 2]);
    }
    this.pins = new Float32Array((nx + 1) * 3);
    this.ready = false;
    this.drag = opt.drag ?? 0.985; this.grav = opt.grav ?? -7.5; this.taper = opt.taper ?? 0;
  }
  setPins(fn) { const v = new V3(); for (let x = 0; x <= this.nx; x++) { fn(x / this.nx, v); this.pins[x * 3] = v.x; this.pins[x * 3 + 1] = v.y; this.pins[x * 3 + 2] = v.z; } }
  reset(down) {
    const { nx, ny, p, o } = this;
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const i = (y * (nx + 1) + x) * 3;
      p[i] = this.pins[x * 3] + down.x * (y / ny) * this.h; p[i + 1] = this.pins[x * 3 + 1] + down.y * (y / ny) * this.h; p[i + 2] = this.pins[x * 3 + 2] + down.z * (y / ny) * this.h;
      o[i] = p[i]; o[i + 1] = p[i + 1]; o[i + 2] = p[i + 2];
    }
    this.ready = true;
  }
  step(dt, wind, spheres, down) {
    if (!this.ready) this.reset(down);
    const { nx, ny, p, o, cons } = this;
    const sub = 2, h = Math.min(dt, 1 / 30) / sub;
    for (let s = 0; s < sub; s++) {
      for (let y = 1; y <= ny; y++) for (let x = 0; x <= nx; x++) {
        const i = (y * (nx + 1) + x) * 3;
        for (let k = 0; k < 3; k++) {
          const v = (p[i + k] - o[i + k]) * this.drag;
          o[i + k] = p[i + k];
          p[i + k] += v + ((k === 1 ? this.grav : 0) + wind[k]) * h * h;
        }
      }
      for (let x = 0; x <= nx; x++) { p[x * 3] = this.pins[x * 3]; p[x * 3 + 1] = this.pins[x * 3 + 1]; p[x * 3 + 2] = this.pins[x * 3 + 2]; }
      for (let it = 0; it < 3; it++) {
        for (const [a, b, r] of cons) {
          const wa = a <= nx ? 0 : 1, wb = b <= nx ? 0 : 1, wt = wa + wb;
          if (!wt) continue;
          const ia = a * 3, ib = b * 3;
          const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, diff = (d - r) / d;
          const ka = diff * wa / wt, kb = diff * wb / wt;
          p[ia] += dx * ka; p[ia + 1] += dy * ka; p[ia + 2] += dz * ka;
          p[ib] -= dx * kb; p[ib + 1] -= dy * kb; p[ib + 2] -= dz * kb;
        }
        for (const sp of spheres) {
          for (let i = (nx + 1) * 3; i < p.length; i += 3) {
            const dx = p[i] - sp.x, dy = p[i + 1] - sp.y, dz = p[i + 2] - sp.z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < sp.r * sp.r && d2 > 1e-8) { const d = Math.sqrt(d2), k = sp.r / d; p[i] = sp.x + dx * k; p[i + 1] = sp.y + dy * k; p[i + 2] = sp.z + dz * k; }
          }
        }
      }
    }
    const pos = this.geo.attributes.position;
    pos.array.set(p);
    if (this.taper) {
      for (let y = 0; y <= ny; y++) {
        const f = (y / ny) * this.taper;
        const a = (y * (nx + 1)) * 3, b = (y * (nx + 1) + nx) * 3;
        const cx = (p[a] + p[b]) / 2, cy = (p[a + 1] + p[b + 1]) / 2, cz = (p[a + 2] + p[b + 2]) / 2;
        for (let x = 0; x <= nx; x++) { const i = (y * (nx + 1) + x) * 3; pos.array[i] = lerp(p[i], cx, f); pos.array[i + 1] = lerp(p[i + 1], cy, f); pos.array[i + 2] = lerp(p[i + 2], cz, f); }
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ---------------------------------------------------------------- weapons found in the world (chests): a base form in its own metal
export const WVAR = {
  knight: { base: 'sword', blade: '#d9dde5', trim: '#40507a', glow: '#a9c4ff', gi: 0.3, br: 0.25 },
  fallen: { base: 'sword', blade: '#2e2a33', trim: '#5c2a22', glow: '#ff5a2a', gi: 1.4, bm: 0.6, br: 0.45, be: '#7a1c0c', len: 0.92 },
  keeper: { base: 'spear', blade: '#c9cdd3', trim: '#8a7556', glow: '#ffd08a', gi: 0.25, spearBlade: true, len: 1.08 },
  watcher: { base: 'spear', blade: '#f5f1e6', trim: '#e4d3a6', glow: '#fff0c4', gi: 0.9, spearBlade: true, be: '#ffe7b0' },
  bell: { base: 'hammer', blade: '#a77536', trim: '#5a3b22', glow: '#ffb54a', gi: 0.8, bm: 0.9, br: 0.35 },
};

// ---------------------------------------------------------------- pose animator (parameter space -> normalized bone rotations)
const KEYS = ['thL', 'thR', 'knL', 'knR', 'hipY', 'hipX', 'tX', 'tY', 'tZ', 'hX', 'hY', 'sLx', 'sLz', 'eL', 'sRx', 'sRz', 'sRy', 'eR', 'fold', 'flap', 'wScale', 'wLift', 'hand', 'spread'];
export class SeraphAnimator {
  constructor() { this.c = {}; KEYS.forEach((k) => (this.c[k] = 0)); Object.assign(this.c, { hipY: 0.95, fold: 0.8, wScale: 0.78, hand: 0.4, spread: 0.5, roll: 0, rY: 0, rZ: 0 }); this.t = 0; this.sp = { mode: 'up', tilt: 0.12 }; }
  update(dt, S) {
    this.t += dt;
    const t = this.t, c = this.c, T = {};
    const amp = clamp(S.speed / 7.2, 0, 1), ph = S.phase || 0, breathe = Math.sin(t * 1.6) * 0.012;
    T.thL = -Math.sin(ph) * 0.62 * amp; T.thR = Math.sin(ph) * 0.62 * amp;
    T.knL = Math.max(0, Math.sin(ph + 1.3)) * 1.0 * amp + 0.05; T.knR = Math.max(0, -Math.sin(ph + 1.3)) * 1.0 * amp + 0.05;
    T.hipY = 0.95 - Math.abs(Math.cos(ph)) * 0.035 * amp + breathe * 0.3; T.hipX = 0;
    T.tX = 0.03 + amp * 0.16; T.tY = Math.sin(ph) * 0.12 * amp; T.tZ = 0; T.hX = -amp * 0.1; T.hY = 0;
    T.sLx = -0.32 + Math.sin(ph) * 0.4 * amp; T.sLz = 0.2 + amp * 0.1; T.eL = -1.55 + amp * 0.9;
    T.sRx = -0.12 - Math.sin(ph) * 0.15 * amp; T.sRz = -0.16; T.sRy = 0; T.eR = -0.35;
    let spMode = 'up', spTilt = 0.12 + amp * 0.35;
    T.fold = 0.9 + amp * 0.12; T.flap = Math.sin(t * 1.2) * 0.03; T.wScale = 0.74 - amp * 0.04; T.wLift = 0;
    T.hand = 0.42 + amp * 0.1; T.spread = 0.45 + Math.sin(t * 0.8) * 0.04; // at rest: folded at the wrist, primaries stacked
    if (S.display) { // the hero standing with his wings out holds them half-open and raised; on the move they fold in
      const dp = 1 - amp;
      T.fold = lerp(0.98, 0.55, dp); T.hand = lerp(0.62, 0.14, dp); T.spread = lerp(0.3, 0.78, dp) + Math.sin(t * 0.8) * 0.03;
      T.wLift = lerp(0.04, 0.1, dp) + Math.sin(t * 1.3) * 0.025; T.wScale = lerp(0.72, 0.8, dp);
    }
    let rate = 12;
    if (S.mode === 'title') {
      T.fold = 0.42; T.wScale = 0.86; T.hX = -0.22; T.hY = 0.25; T.flap = Math.sin(t * 0.9) * 0.05; T.wLift = 0.08; T.hand = 0.12; T.spread = 0.85;
      T.sLx = -0.4; T.eL = -1.75; T.sLz = 0.24;
    } else if (!S.grounded && S.glide) {
      T.hipX = 0.95; T.thL = 0.18; T.thR = 0.28; T.knL = 0.25; T.knR = 0.4; T.tX = 0.1; T.hX = -0.75; T.tY = 0;
      T.sLx = 0.25; T.sLz = 1.05; T.eL = -0.2; T.sRx = 0.2; T.sRz = -1.0; T.eR = -0.2; spMode = 'back';
      T.fold = -0.06; T.wScale = 1.18; T.flap = Math.sin(t * 2.4) * 0.06; T.wLift = 0.12; rate = 6;
      T.hand = 0.04 + Math.sin(t * 1.1) * 0.04; T.spread = 1.0; // soaring: fully open, the hand breathing on the air
    } else if (!S.grounded) {
      const up = clamp(S.vy / 9, -1, 1);
      T.thL = -0.7 + up * 0.2; T.thR = -0.1; T.knL = 1.1; T.knR = 0.55; T.tX = 0.08; T.hX = -0.05;
      T.sLx = -0.5; T.sLz = 0.6; T.eL = -0.5; T.sRx = -0.4; T.sRz = -0.5; T.eR = -0.4;
      T.fold = 0.45; T.wScale = 0.9; T.flap = up * 0.12; T.hand = 0.3 - up * 0.1; T.spread = 0.7;
    }
    if (S.climb) { // on a wall: reach and pull hand over hand, knees up, head tipped back to find the next hold
      const K = S.climb, k = K.mv, s1 = Math.sin(ph);
      T.hipY = 0.9; T.hipX = K.slope ? 0.42 : 0.06; T.tX = K.slope ? 0.3 : 0.14; T.tY = s1 * 0.12 * k; T.tZ = 0; T.hX = K.slope ? -0.5 : -0.42; T.hY = 0;
      T.sLx = (K.slope ? -1.7 : -2.55) + s1 * 0.55 * k; T.sLz = 0.32; T.eL = -0.75 - Math.max(0, s1) * 0.7 * k;
      T.sRx = (K.slope ? -1.7 : -2.55) - s1 * 0.55 * k; T.sRz = -0.32; T.sRy = 0; T.eR = -0.75 - Math.max(0, -s1) * 0.7 * k;
      T.thL = -0.75 - s1 * 0.45 * k; T.knL = 1.15 + s1 * 0.45 * k; T.thR = -0.75 + s1 * 0.45 * k; T.knR = 1.15 - s1 * 0.45 * k;
      if (K.slope) { T.thL += 0.35; T.thR += 0.35; T.knL -= 0.35; T.knR -= 0.35; }
      T.fold = 1.05; T.wScale = 0.72; T.wLift = 0; T.hand = 0.6; T.spread = 0.2; T.flap = 0;
      spMode = 'back'; rate = 14;
      if (K.leap > 0) { T.sLx = -2.95; T.sRx = -2.95; T.eL = -0.15; T.eR = -0.15; T.thL = -0.25; T.thR = -0.15; T.knL = 0.35; T.knR = 0.25; T.hX = -0.6; rate = 22; }
      if (K.pull >= 0) { // hauling over: arms press down, a knee comes up onto the ledge, then he stands
        const u = clamp(K.pull, 0, 1), a = smooth(0, 0.55, u), b = smooth(0.5, 1, u);
        T.sLx = lerp(lerp(-2.6, -0.6, a), -0.3, b); T.sRx = lerp(lerp(-2.6, -0.6, a), -0.3, b); T.eL = lerp(-0.7, -0.15, a); T.eR = lerp(-0.7, -0.15, a);
        T.tX = lerp(lerp(0.2, 0.75, a), 0.05, b); T.hX = lerp(-0.4, 0.1, a);
        T.thL = lerp(lerp(-0.6, -1.7, a), -0.05, b); T.knL = lerp(lerp(1.0, 2.1, a), 0.1, b);
        T.thR = lerp(lerp(-0.4, 0.15, a), 0, b); T.knR = lerp(lerp(0.9, 0.5, a), 0.08, b); T.hipY = lerp(lerp(0.9, 0.8, a), 0.95, b); rate = 20;
      }
    }
    if (S.lock && S.grounded && !S.atk?.kind) { T.tX += 0.06; T.sRx = -0.6; T.eR = -0.9; spMode = 'guard'; }
    if (S.charge > 0) {
      const k = clamp(S.charge / 0.9, 0, 1);
      T.thL = -0.5; T.thR = 0.45; T.knL = 0.4; T.knR = 0.45; T.hipY = 0.9 - k * 0.04;
      T.tY = -0.55 - k * 0.2; T.tX = 0.05; T.sRx = -0.6; T.sRz = -0.5; T.eR = -1.7; T.sLx = -1.1; T.sLz = 0.3; T.eL = -0.4;
      spMode = 'guard'; T.fold = 0.55 - k * 0.3; T.wScale = 0.85 + k * 0.15; T.hand = 0.35 - k * 0.3; T.spread = 0.6 + k * 0.4; rate = 18;
    }
    if (S.dash > 0) { // air dash: wings swept back like a stooping falcon
      T.hipX = 0.55; T.tX = 0.2; T.thL = 0.4; T.thR = 0.55; T.knL = 0.6; T.knR = 0.8; T.fold = 0.62; T.wScale = 1.05; T.wLift = 0.1; T.hand = 0.3; T.spread = 0.4;
      T.sLx = 0.6; T.sLz = 0.5; T.sRx = 0.5; T.sRz = -0.5; spMode = 'back'; rate = 22;
    }
    if (S.roll >= 0) {
      const r = S.roll;
      if (S.rollKind === 'back') { // a quick hop back, weight low, eyes kept on the foe
        const k = Math.sin(clamp(r * 1.15, 0, 1) * Math.PI);
        T.hipY = 0.95 - k * 0.14; T.tX = 0.16 + k * 0.1; T.hX = -0.1; T.tY = 0;
        T.thL = -0.15 - k * 0.45; T.knL = 0.25 + k * 0.6; T.thR = 0.2 + k * 0.35; T.knR = 0.2 + k * 0.5;
        T.sLx = -0.2; T.sLz = 0.6; T.eL = -0.7; T.sRx = -0.55; T.sRz = -0.4; T.eR = -0.8;
        T.fold = 0.95; T.hand = 0.7; T.spread = 0.3; spMode = 'guard'; rate = 26;
      } else { // a forward roll: curl up, go over the shoulders, come up already moving
        const tuck = smooth(0, 0.16, r) * (1 - smooth(0.72, 0.98, r));
        T.tX = lerp(0.25, 1.2, tuck); T.hX = lerp(0.05, 0.8, tuck); T.tY = 0; T.tZ = 0; T.hY = 0;
        T.thL = lerp(-0.35, -2.05, tuck); T.thR = lerp(0.15, -1.85, tuck); T.knL = lerp(0.45, 2.35, tuck); T.knR = lerp(0.35, 2.45, tuck);
        T.sLx = lerp(-0.3, -1.2, tuck); T.sLz = lerp(0.3, 0.5, tuck); T.eL = lerp(-0.7, -1.95, tuck);
        T.sRx = lerp(-0.3, -0.75, tuck); T.sRz = lerp(-0.3, -0.75, tuck); T.sRy = 0; T.eR = lerp(-0.5, -1.35, tuck);
        T.fold = 1.2; T.hand = 1; T.spread = 0.05; T.wScale = 0.72; T.wLift = 0; T.flap = 0;
        spMode = 'roll'; rate = 34;
      }
    }
    const A = S.atk;
    if (A && A.kind) {
      const wp = S.wpn || 'spear', gs = wp === 'greatsword' || wp === 'hammer';
      // wind-up coils slowly into the pose, the swing snaps through on the hit, the recovery drifts back
      const k = A.kind, hitT = A.hit ?? 0.1, sw = A.sw ?? 0.1, s0 = Math.max(0, hitT - sw);
      const a = easeOut(clamp((A.t - s0) / (sw * 1.35), 0, 1)), wind = s0 > 0 ? clamp(A.t / s0, 0, 1) : 1;
      const rec = clamp((A.t - Math.max(A.dur * 0.62, (A.last ?? hitT) + 0.12)) / (A.dur * 0.3), 0, 1);
      const W = (x, y) => lerp(x, y, a);
      T.thL = -0.45; T.thR = 0.32; T.knL = 0.25; T.knR = 0.35; T.hipY = 0.9 - (1 - a) * wind * (gs ? 0.06 : 0.035); T.hipX = 0;
      spMode = 'arm'; T.fold = 0.7; T.wScale = 0.82; T.hand = 0.45; T.spread = 0.5;
      rate = A.t < s0 ? (gs ? 7 : 11) : 34;
      if (gs && (k === 'l0' || k === 'l1')) {
        // the greatsword: two-handed diagonal cleaves, the whole body turning into it
        const f = k === 'l0';
        T.tY = f ? W(-1.0, 0.95) : W(0.9, -0.9); T.tX = f ? W(-0.15, 0.4) : W(0.3, -0.05);
        T.sRx = f ? W(-2.6, -0.7) : W(-0.5, -2.1); T.sRz = f ? W(-0.7, 0.35) : W(0.5, -0.6); T.eR = W(-0.5, -0.1);
        T.sLx = f ? W(-2.3, -0.9) : W(-0.6, -1.9); T.sLz = f ? W(0.2, 0.75) : W(0.8, 0.2); T.eL = -0.7;
        T.thL = -0.65; T.knL = 0.65; T.thR = 0.5; T.knR = 0.55; T.hipY = 0.86;
      } else if (gs && (k === 'l3' || k === 'heavy')) {
        // overhead slam: lift it high, hang there, then bring it down into the ground
        const T0 = Math.max(0.05, hitT - 0.12), up = clamp(A.t / T0, 0, 1), dn = clamp((A.t - T0) / 0.12, 0, 1);
        T.sRx = lerp(lerp(-1.0, -3.0, up), -0.55, dn); T.sLx = lerp(lerp(-1.0, -2.9, up), -0.6, dn);
        T.sRz = -0.15; T.sLz = 0.2; T.eR = lerp(-0.6, -0.05, dn); T.eL = lerp(-0.6, -0.1, dn);
        T.tX = lerp(-0.3, 0.55, dn); T.hX = lerp(-0.35, 0.3, dn); T.hipY = lerp(0.96, 0.78, dn);
        T.thL = lerp(-0.4, -0.9, dn); T.knL = lerp(0.3, 0.9, dn); T.thR = 0.55; T.knR = lerp(0.3, 0.8, dn);
        T.fold = k === 'heavy' ? -0.1 : 0.25; T.wScale = k === 'heavy' ? 1.2 : 0.95; T.wLift = k === 'heavy' ? 0.3 : 0;
        T.hand = k === 'heavy' ? 0.05 : 0.3; T.spread = k === 'heavy' ? 1.1 : 0.7;
      } else if (wp === 'spear' && (k === 'l0' || k === 'l1')) {
        // the lance pierces: draw back, then drive straight through (the second thrust comes in higher)
        const hi = k === 'l1';
        T.tY = W(hi ? 0.35 : -0.5, hi ? -0.1 : 0.15); T.tX = W(0.0, 0.3);
        T.sRx = W(hi ? -1.3 : -1.0, hi ? -1.85 : -1.6); T.sRz = W(-0.45, -0.1); T.eR = W(-1.7, -0.02);
        T.thL = -0.7; T.knL = 0.5; T.thR = 0.45; T.sLz = 0.6; T.sLx = 0.25; T.eL = -0.4;
      } else if (k === 'l0') { T.tY = W(-0.85, 0.75); T.sRx = W(-0.9, -1.45); T.sRz = W(-1.2, 0.15); T.eR = W(-0.9, -0.1); T.tX = 0.18; T.sLz = 0.55; T.sLx = -0.2; T.eL = -0.6; }
      else if (k === 'l1') { T.tY = W(0.7, -0.85); T.sRx = W(-1.6, -1.25); T.sRz = W(0.35, -1.3); T.eR = W(-0.25, -0.05); T.tX = 0.16; T.sLz = 0.6; T.sLx = 0.1; T.eL = -0.5; }
      else if (k === 'l2') { T.tY = -0.2; T.sRx = -0.15; T.sRz = -1.45; T.eR = -0.05; T.tX = 0.12; T.sLz = 1.3; T.sLx = 0.1; T.eL = -0.2; T.thL = -0.3; T.thR = 0.2; T.fold = 0.15; T.wScale = 1.0; }
      else if (k === 'l3' || k === 'heavy') { T.tY = W(-0.45, 0.12); T.sRx = W(-1.0, -1.62); T.sRz = W(-0.4, -0.05); T.eR = W(-1.6, 0.0); T.tX = W(0.0, 0.34); T.thL = -0.8; T.knL = 0.55; T.thR = 0.5; T.sLz = 0.7; T.sLx = 0.3; T.eL = -0.3; T.fold = k === 'heavy' ? -0.05 : 0.2; T.wScale = k === 'heavy' ? 1.1 : 0.9; T.hand = k === 'heavy' ? 0.08 : 0.3; T.spread = k === 'heavy' ? 1.05 : 0.7; }
      else if (k === 'counter' || k === 'focus') {
        const up = clamp(A.t / Math.max(0.08, hitT - 0.08), 0, 1), dn = clamp((A.t - (hitT - 0.04)) / 0.12, 0, 1);
        T.sRx = lerp(lerp(-1.2, -2.9, up), -0.9, dn); T.sRz = -0.2; T.eR = -0.1; T.sLx = lerp(-2.4, -0.6, dn); T.sLz = 0.4; T.eL = -0.3;
        T.tX = lerp(-0.25, 0.42, dn); T.hX = lerp(-0.4, 0.2, dn); T.hipY = lerp(0.98, 0.84, dn); T.fold = -0.1; T.wScale = 1.2; T.wLift = 0.3; T.hand = 0.05; T.spread = 1.15;
      }
      if (wp === 'bow' && k !== 'focus') { // side-on to the target, bow arm out, the string drawn to the cheek; it snaps on release
        const draw = clamp(A.t / Math.max(0.08, hitT), 0, 1), rel = clamp((A.t - hitT) / 0.12, 0, 1);
        T.tY = -0.75; T.tX = 0.05; T.hY = 0.7; T.hX = -0.05; T.thL = -0.25; T.thR = 0.35; T.knL = 0.2; T.knR = 0.15;
        T.sRx = -1.45; T.sRz = -0.15; T.sRy = 0.25; T.eR = -0.05;
        T.sLx = lerp(-1.2, -1.5, draw); T.sLz = lerp(0.6, 0.15, draw); T.eL = lerp(-1.2, -2.3, draw) + rel * 0.9;
        if (k === 'heavy' || k === 'l3') { T.tX = -0.12; T.hX = -0.2; T.sRx = -1.7; }
        spMode = 'bow'; rate = A.t < hitT ? 16 : 30;
      } else if (wp === 'dual' && k !== 'focus') { // two short blades: alternating cuts, both arms crossing on the flurries
        const f = k === 'l0' || k === 'counter', g = k === 'l1', ph2 = A.t * 22;
        T.tX = 0.22; T.thL = -0.55; T.knL = 0.5; T.thR = 0.45; T.knR = 0.4; T.hipY = 0.88;
        if (f) { T.tY = W(-0.7, 0.6); T.sRx = W(-1.0, -1.3); T.sRz = W(-1.1, 0.3); T.eR = W(-1.2, -0.2); T.sLx = -0.6; T.sLz = 0.6; T.eL = -1.2; }
        else if (g) { T.tY = W(0.7, -0.6); T.sLx = W(-1.0, -1.3); T.sLz = W(1.1, -0.3); T.eL = W(-1.2, -0.2); T.sRx = -0.6; T.sRz = -0.6; T.eR = -1.2; }
        else { // flurries: both blades churning
          T.tY = Math.sin(ph2) * 0.5; T.sRx = -1.2 + Math.sin(ph2) * 0.5; T.sRz = -0.4 + Math.cos(ph2) * 0.6; T.eR = -0.6;
          T.sLx = -1.2 - Math.sin(ph2) * 0.5; T.sLz = 0.4 - Math.cos(ph2) * 0.6; T.eL = -0.6; T.tX = 0.32;
        }
        spMode = 'arm'; rate = 40;
      } else if (wp === 'censer' && k !== 'focus') { // the censer staff: two-handed sweeps, and raised high to pour out its light
        if (k === 'heavy' || k === 'l3') { const up = clamp(A.t / Math.max(0.1, hitT), 0, 1);
          T.sRx = lerp(-1.4, -2.95, up); T.sLx = lerp(-1.2, -2.6, up); T.sRz = -0.2; T.sLz = 0.25; T.eR = -0.15; T.eL = -0.3; T.hX = -0.35 * up; T.tX = -0.1 * up; spMode = 'up'; }
        else { const f = k !== 'l1'; T.tY = f ? W(-0.8, 0.7) : W(0.8, -0.7); T.sRx = W(-1.3, -1.0); T.sRz = f ? W(-0.9, 0.2) : W(0.3, -0.9); T.eR = -0.5; T.sLx = W(-1.1, -0.9); T.sLz = 0.5; T.eL = -1.3; spMode = 'arm'; }
        rate = 26;
      }
      if (rec > 0) for (const key of ['tY', 'sRx', 'sRz', 'eR']) T[key] = lerp(T[key], key === 'sRx' ? -0.5 : key === 'eR' ? -0.4 : key === 'sRz' ? -0.4 : 0, rec * 0.6);
    }
    if (S.cast >= 0) {
      const up = clamp(S.cast / 0.32, 0, 1), down = clamp((S.cast - 0.36) / 0.12, 0, 1);
      T.sLx = lerp(-2.9, -1.1, down); T.sRx = lerp(-2.9, -1.1, down); T.sLz = lerp(0.35, 0.5, down); T.sRz = lerp(-0.35, -0.5, down);
      T.eL = -0.2; T.eR = -0.2; T.hX = lerp(-0.45, 0.25, down); T.tX = lerp(-0.12, 0.35, down);
      T.fold = lerp(0.3, -0.12, up); T.wScale = lerp(0.95, 1.25, up); T.wLift = 0.3; T.hand = lerp(0.4, 0, up); T.spread = lerp(0.6, 1.2, up); spMode = 'arm'; rate = 26;
      T.hipY = lerp(0.95, 0.86, down);
    }
    if (S.heal > 0) { T.sLx = -1.2; T.sLz = 0.3; T.eL = -1.6; T.hX = 0.35; T.tX = 0.12; T.fold = 0.3; rate = 10; }
    if (S.hurt > 0) { T.tX = -0.35; T.hX = -0.3; T.sLz = 0.7; T.sRz = -0.7; rate = 30; }
    if (S.override) Object.assign(T, S.override);
    for (const k of KEYS) if (T[k] !== undefined) c[k] = damp(c[k], T[k], rate, dt);
    // the somersault itself is not damped (it must land exactly on a full turn), and it pivots on the
    // centre of the curled-up body rather than the hip joint, so he rolls along the ground instead of orbiting
    if (S.roll >= 0 && S.rollKind !== 'back') {
      const r = S.roll, tk = smooth(0, 0.2, r) * (1 - smooth(0.68, 1.0, r));
      const ang = Math.PI * 2 * smooth(0.05, 0.8, r), cs = Math.cos(ang), sn = Math.sin(ang);
      const cy = 0.1 * tk, cz = 0.24 * tk;
      c.roll = ang; c.rY = -0.6 * tk + cy - (cy * cs - cz * sn); c.rZ = cz - (cy * sn + cz * cs);
    } else { c.roll = 0; c.rY = 0; c.rZ = 0; }
    this.sp.mode = S.override?.spMode || spMode; this.sp.tilt = spTilt;
    return c;
  }
}
const _e = new THREE.Euler();
const qe = (x, y, z, o = 'XYZ') => new Q().setFromEuler(_e.set(x, y, z, o));
export function paramsToPose(c) {
  const H = Math.PI / 2;
  const q = {
    Hips: qe(c.hipX + (c.roll || 0), 0, 0),
    Spine: qe(c.tX * 0.3, c.tY * 0.3, c.tZ * 0.3), Spine1: qe(c.tX * 0.35, c.tY * 0.35, c.tZ * 0.35), Spine2: qe(c.tX * 0.35, c.tY * 0.35, c.tZ * 0.35),
    Neck: qe(c.hX * 0.4, c.hY * 0.4, 0), Head: qe(c.hX * 0.6, c.hY * 0.6, 0),
    LeftArm: qe(c.sLx, 0, -H + c.sLz), LeftForeArm: qe(0, c.eL, 0),
    RightArm: qe(c.sRx, c.sRy, H + c.sRz), RightForeArm: qe(0, -c.eR, 0),
    LeftUpLeg: qe(c.thL, 0, 0), LeftLeg: qe(c.knL, 0, 0), LeftFoot: qe(-(c.thL + c.knL) * 0.55, 0, 0),
    RightUpLeg: qe(c.thR, 0, 0), RightLeg: qe(c.knR, 0, 0), RightFoot: qe(-(c.thR + c.knR) * 0.55, 0, 0),
  };
  return { q, hips: new V3(0, c.hipY - 0.95 + (c.rY || 0), c.rZ || 0) };
}

// ---------------------------------------------------------------- the actor: body + accessories + cloth
const _p = new V3(), _q = new Q(), _q2 = new Q(), _v = new V3(), _m = new THREE.Matrix4();
const _fp = new V3(), _fq = new Q(), _fs = new V3(), _fe = new THREE.Euler(), _fm = new THREE.Matrix4(), _X = new V3(1, 0, 0);
// keyframed curve with cosine easing between keys: [[t, v], ...]
const KF = (b, ks) => { for (let i = 1; i < ks.length; i++) if (b <= ks[i][0]) { const [t0, v0] = ks[i - 1], [t1, v1] = ks[i]; const f = (b - t0) / (t1 - t0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * f)); } return ks[ks.length - 1][1]; };
export class SeraphActor {
  constructor(scene, opt = {}) {
    this.scene = scene; this.opt = opt;
    this.M = opt.style === 'warrior' ? makeWarriorMats() : makeSeraphMats(opt.fallen);
    this.angel = opt.style === 'warrior' ? 0 : 1; // how far the angel shows: wings, halo, feather mantle
    // the game sets wingWant (1 = wings out, 0 = folded away into light); a spring with a little overshoot
    // drives the unfurl so the arm rises first, then the wrist opens, then the primaries fan out
    this.wingWant = undefined; this.unf = this.angel; this.unfV = 0; this.shook = true;
    this.beat = -1; this.beatAmp = 1; this.flapPrev = 0; this.bank = 0; this.wingGlow = 0;
    this.root = new THREE.Group(); scene.add(this.root);
    this.scale = opt.scale || 1;
    this.anim = new SeraphAnimator();
    this.sockets = {};
    this.spearQ = new Q();
    this.useDefaultBody();
    this.buildAccessories();
  }
  useDefaultBody() {
    if (this.model) this.root.remove(this.model);
    const { mesh, bones } = buildBody(this.M, this.opt.style, this.opt.look);
    if (this.body && this.body.geometry) this.body.geometry.dispose();
    this.model = new THREE.Group(); this.model.add(mesh); this.model.scale.setScalar(this.scale * ((this.opt.look && this.opt.look.height) || 1));
    this.root.add(this.model);
    this.rig = new HumanoidRig(this.model, bones);
    this.body = mesh; this.custom = false;
  }
  // replace the body with a user GLB (Mixamo / VRM-style humanoid)
  loadGLB(buffer) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', (gltf) => {
        try {
          const model = gltf.scene;
          const map = {};
          model.traverse((o) => { if (o.isBone) { const c = canonBone(o.name); if (c && !map[c]) map[c] = o; } if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
          const need = ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'];
          const miss = need.filter((n) => !map[n]);
          if (miss.length) throw new Error('骨架缺少：' + miss.join(', '));
          const holder = new THREE.Group(); holder.add(model);
          holder.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const h = box.max.y - box.min.y || 1;
          const s = (1.72 / h) * this.scale;
          holder.scale.setScalar(s);
          model.position.y = -box.min.y;
          // face +Z: toes should point forward
          holder.updateMatrixWorld(true);
          if (map.LeftFoot && (map.LeftToeBase || map.LeftLeg)) {
            const f = map.LeftFoot.getWorldPosition(new V3()), t = (map.LeftToeBase || map.LeftFoot).getWorldPosition(new V3());
            const k = map.LeftLeg.getWorldPosition(new V3());
            const fw = map.LeftToeBase ? t.sub(f) : f.sub(k);
            if (map.LeftToeBase && fw.z < 0) model.rotation.y = Math.PI;
          }
          if (this.model) this.root.remove(this.model);
          this.model = holder; this.root.add(holder);
          this.rig = new HumanoidRig(holder, map);
          this.body = model; this.custom = true;
          // hide the default hair/visor cues: user model brings its own
          resolve(map);
        } catch (e) { reject(e); }
      }, reject);
    });
  }
  socket(name, offset = null) {
    const s = new THREE.Group(); s.userData.bone = name; s.userData.off = offset || new V3();
    this.root.add(s); (this.sockets[name] ||= []).push(s);
    return s;
  }
  buildAccessories() {
    const M = this.M;
    // wings on the upper back
    const back = this.socket('Spine2', new V3(0, 0.1, -0.1));
    this.wings = [];
    for (const side of [1, -1]) {
      const w = buildWing(M.feather, side, { joint: true });
      w.root.position.set(side * 0.05, 0, 0);
      bakeStatic(w.arm); bakeStatic(w.handStatic);
      w.tipTh = w.prim[w.prim.length - 1].th;
      back.add(w.root); this.wings.push(w);
    }
    this.featherE0 = M.feather.emissiveIntensity;
    // feather mantle
    const mantle = new THREE.Group();
    const fg = getFeatherGeo();
    for (let i = 0; i < 20; i++) {
      const f = i / 19, a = 0.35 + f * (Math.PI * 2 - 0.7);
      const pivot = new THREE.Group(); pivot.position.y = 0.0 - Math.abs(f - 0.5) * 0.03; pivot.rotation.y = a; mantle.add(pivot);
      const fm = new THREE.Mesh(fg, M.feather); fm.position.z = 0.1; fm.rotation.x = Math.PI / 2 + 0.75 + Math.sin(i * 1.7) * 0.12; fm.scale.set(0.085, 0.24 + (i % 3) * 0.035, 1);
      pivot.add(fm);
    }
    bakeStatic(mantle);
    this.socket('Spine2', new V3(0, 0.2, 0)).add(mantle); this.mantle = mantle;
    // halo
    const halo = new THREE.Group();
    const hr = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.007, 8, 72), M.goldGlow); halo.add(hr);
    halo.add(new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.003, 6, 72), M.goldGlow));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 0.29 + (i % 2 ? 0 : 0.02);
      const ray = new THREE.Mesh(new THREE.BoxGeometry(0.004, i % 2 ? 0.05 : 0.09, 0.004), M.goldGlow);
      ray.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); ray.rotation.z = a - Math.PI / 2; halo.add(ray);
    }
    bakeStatic(halo);
    this.halo = halo;
    this.socket('Head', new V3(0, 0.25, -0.17)).add(halo);
    // weapon
    this.weapon = this.buildWeapon(this.opt.weapon);
    this.weaponHolder = new THREE.Group(); this.weaponHolder.add(this.weapon);
    this.root.add(this.weaponHolder);
    this.offHolder = new THREE.Group(); this.root.add(this.offHolder); this.offQ = new Q(); // the second of the twin blades
    this.form = (WVAR[this.opt.weapon] && WVAR[this.opt.weapon].base) || this.opt.weapon;
    if (this.form === 'dual') { const t = this.tipLocal; this.offHolder.add(this.buildWeapon(this.opt.weapon)); this.tipLocal = t; }
    // cloth: long hair + two sashes
    this.cloths = [];
    if (!this.opt.noCloth) {
      const s = this.scale;
      this.hair = new Cloth(4, this.opt.style === 'warrior' ? 3 : 9, 0.2 * s, (this.opt.style === 'warrior' ? 0.16 : 0.85) * s, M.hair, { taper: 0.55, grav: -8 });
      if (this.opt.style === 'warrior' && M.cape) {
        this.cape = new Cloth(6, 9, 0.5 * s, 0.86 * s, M.cape, { grav: -7, drag: 0.975, shadow: true });
        for (const c of [this.hair, this.cape]) { this.scene.add(c.mesh); this.cloths.push(c); }
      } else {
        this.sashL = new Cloth(2, 12, 0.2 * s, 1.35 * s, M.sash, { taper: 0.1, grav: -6.5 });
        this.sashR = new Cloth(2, 12, 0.2 * s, 1.35 * s, M.sash, { taper: 0.1, grav: -6.5 });
        for (const c of [this.hair, this.sashL, this.sashR]) { this.scene.add(c.mesh); this.cloths.push(c); }
      }
    }
  }
  buildSpear(bladeM) {
    const M = this.M, g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.25, 8), M.gold); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.42; g.add(shaft);
    const butt = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), M.gold); butt.scale.set(0.03, 0.03, 0.07); butt.position.z = -0.72; g.add(butt);
    for (const z of [-0.09, 0.09, 1.45]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 12), M.gold); r.position.z = z; g.add(r); }
    const blade = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), bladeM || M.goldGlow); blade.scale.set(0.055, 0.016, 0.42); blade.position.z = 1.96; g.add(blade);
    for (const s of [1, -1]) { const pr = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.011, 6, 18, 2.1), M.gold); pr.position.set(s * 0.02, 0, 1.6); pr.rotation.set(Math.PI / 2, 0, s > 0 ? -0.35 : Math.PI + 0.35); g.add(pr); }
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), M.gem); gem.position.z = 1.56; g.add(gem);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bakeStatic(g);
    g.scale.setScalar(0.88 * this.scale);
    this.tipLocal = [new V3(0, 0, 2.3), new V3(0, 0, 1.25)];
    return g;
  }
  buildGreatsword() {
    const M = this.M, g = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), M.gold); grip.rotation.x = Math.PI / 2; grip.position.z = -0.05; g.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), M.gold); guard.position.z = 0.2; g.add(guard);
    for (const s of [1, -1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), M.gold); w.rotation.z = s * Math.PI / 2; w.position.set(s * 0.33, 0, 0.2); g.add(w); }
    const shape = new THREE.Shape();
    shape.moveTo(-0.11, 0); shape.lineTo(0.11, 0); shape.lineTo(0.09, 1.55); shape.lineTo(0, 1.8); shape.lineTo(-0.09, 1.55); shape.closePath();
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    bg.translate(0, 0, -0.012); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.23);
    const blade = new THREE.Mesh(bg, M.skin); g.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 1.5), M.goldGlow); edge.position.set(0, 0, 1.0); g.add(edge);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bakeStatic(g);
    g.scale.setScalar(this.scale * 0.85);
    this.tipLocal = [new V3(0, 0, 2.0), new V3(0, 0, 0.5)];
    return g;
  }
  buildWeapon(kind) {
    const V = WVAR[kind];
    if (V) { // a weapon found in the world: one of the three forms, in its own metal
      const M0 = this.M, mk = (o) => new THREE.MeshStandardMaterial(o);
      const ov = { gold: mk({ color: V.trim, metalness: 0.75, roughness: 0.4 }), goldGlow: mk({ color: V.glow, emissive: V.glow, emissiveIntensity: V.gi ?? 0.5, metalness: 0.6, roughness: 0.3 }),
        skin: mk({ color: V.blade, metalness: V.bm ?? 0.8, roughness: V.br ?? 0.3, emissive: V.be || '#000000', emissiveIntensity: V.be ? 0.25 : 0 }), gem: mk({ color: V.glow, emissive: V.glow, emissiveIntensity: 0.9, roughness: 0.2 }) };
      this.M = Object.assign(Object.create(M0), ov);
      try { const g = ['bow', 'hammer', 'dual', 'censer', 'pick', 'lantern'].includes(V.base) ? this.buildForm(V.base) : V.base === 'greatsword' ? this.buildGreatsword() : V.base === 'sword' ? this.buildSword(false, ov) : this.buildSpear(V.spearBlade ? ov.skin : null); if (V.len) g.scale.multiplyScalar(V.len); return g; }
      finally { this.M = M0; }
    }
    if (kind === 'bow' || kind === 'hammer' || kind === 'dual' || kind === 'censer' || kind === 'pick' || kind === 'lantern') return this.buildForm(kind);
    return kind === 'greatsword' ? this.buildGreatsword() : kind === 'tianshu' ? this.buildLongsword() : kind === 'sword' ? this.buildSword(this.opt.swordLit) : this.buildSpear(); }
  // the companions' weapons, each its own way of fighting
  buildForm(kind) {
    const M = this.M, g = new THREE.Group(), mk = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5 }, o));
    const wood = mk('#6b4c34', { roughness: 0.8 }), add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    if (kind === 'bow') { // the watcher's longbow: white wood and gold, the limbs sweeping back
      const lm = mk('#efe8d8', { roughness: 0.45 });
      for (const sgn of [1, -1]) { const t = new THREE.TorusGeometry(0.62, 0.016, 6, 24, 1.15); t.rotateZ(sgn > 0 ? -0.05 : Math.PI + 0.05 - 1.15); t.rotateY(Math.PI / 2); t.translate(0, 0, 0); const o = add(t, lm); o.position.y = -0.58; o.rotation.x = 0; }
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 8).rotateX(Math.PI / 2), M.gold);
      const str = add(new THREE.CylinderGeometry(0.003, 0.003, 1.18, 4).rotateX(Math.PI / 2), mk('#fff6dc', { emissive: '#ffe6a8', emissiveIntensity: 0.6 })); str.position.y = -0.2;
      this.tipLocal = [new V3(0, 0, 0.6), new V3(0, 0, 0)];
    } else if (kind === 'hammer') { // the bell-maul: a long haft and a head cast from a temple bell
      add(new THREE.CylinderGeometry(0.03, 0.034, 1.25, 8).rotateX(Math.PI / 2), wood, 0, 0, 0.42);
      const hd = add(new THREE.CylinderGeometry(0.17, 0.24, 0.4, 14), mk('#a67434', { metalness: 0.85, roughness: 0.38 }), 0, 0, 1.08); hd.rotation.z = Math.PI / 2;
      add(new THREE.TorusGeometry(0.2, 0.025, 6, 18).rotateY(Math.PI / 2), M.gold, 0.2, 0, 1.08); add(new THREE.TorusGeometry(0.2, 0.025, 6, 18).rotateY(Math.PI / 2), M.gold, -0.2, 0, 1.08);
      this.tipLocal = [new V3(0, 0, 1.25), new V3(0, 0, 0.9)];
    } else if (kind === 'dual') { // a hunter's short blade (one per hand)
      add(new THREE.CylinderGeometry(0.018, 0.02, 0.14, 6).rotateX(Math.PI / 2), wood, 0, 0, -0.02);
      add(new THREE.BoxGeometry(0.12, 0.02, 0.03), M.gold, 0, 0, 0.06);
      const sh = new THREE.Shape(); sh.moveTo(-0.032, 0); sh.lineTo(0.03, 0); sh.quadraticCurveTo(0.05, 0.3, 0.0, 0.56); sh.quadraticCurveTo(-0.01, 0.3, -0.032, 0);
      const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }); bg.translate(0, 0, -0.005); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.07);
      add(bg, mk('#d8dbe0', { metalness: 0.85, roughness: 0.25 }));
      this.tipLocal = [new V3(0, 0, 0.62), new V3(0, 0, 0.2)];
    } else if (kind === 'censer') { // a herbalist's staff with a censer of smouldering herbs hung from the crook
      add(new THREE.CylinderGeometry(0.02, 0.026, 1.5, 8).rotateX(Math.PI / 2), wood, 0, 0, 0.5);
      const crook = add(new THREE.TorusGeometry(0.09, 0.016, 6, 14, Math.PI * 1.2), wood, 0, 0.06, 1.25); crook.rotation.y = Math.PI / 2;
      add(new THREE.SphereGeometry(0.075, 10, 8), mk('#b98a45', { metalness: 0.8, roughness: 0.35 }), 0, -0.07, 1.33);
      add(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.9, 1.2) }), 0, -0.07, 1.33);
      this.tipLocal = [new V3(0, -0.07, 1.33), new V3(0, 0, 0.8)];
    } else if (kind === 'pick') { // a miner's blasting pick
      add(new THREE.CylinderGeometry(0.026, 0.03, 0.95, 8).rotateX(Math.PI / 2), wood, 0, 0, 0.3);
      const hd = add(new THREE.ConeGeometry(0.05, 0.55, 6), mk('#5c5a58', { metalness: 0.7, roughness: 0.4 }), 0, 0.12, 0.8); hd.rotation.x = 0;
      this.tipLocal = [new V3(0, 0.35, 0.8), new V3(0, 0, 0.5)];
    } else { // lantern on a pole
      add(new THREE.CylinderGeometry(0.018, 0.022, 1.3, 8).rotateX(Math.PI / 2), wood, 0, 0, 0.45);
      add(new THREE.BoxGeometry(0.16, 0.2, 0.16), mk('#2f2b28', { metalness: 0.6 }), 0, -0.12, 1.1);
      add(new THREE.BoxGeometry(0.12, 0.15, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.9) }), 0, -0.12, 1.1);
      this.tipLocal = [new V3(0, -0.12, 1.1), new V3(0, 0, 0.6)];
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(this.scale * 0.95);
    return g;
  }
  // the holy sword his father gave him: dull grey steel until the cradle's light polishes it
  buildSword(lit, ov) {
    const M = this.M, g = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: '#5e4330', roughness: 0.7 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.3, 8), leather); grip.rotation.x = Math.PI / 2; grip.position.z = -0.02; g.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), lit ? M.gem : M.gold); pommel.position.z = -0.19; g.add(pommel);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.06), M.gold); guard.position.z = 0.15; g.add(guard);
    const shape = new THREE.Shape();
    shape.moveTo(-0.06, 0); shape.lineTo(0.06, 0); shape.lineTo(0.052, 1.08); shape.lineTo(0, 1.24); shape.lineTo(-0.052, 1.08); shape.closePath();
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.009, bevelSegments: 1 });
    bg.translate(0, 0, -0.008); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.18);
    g.add(new THREE.Mesh(bg, ov ? ov.skin : lit ? new THREE.MeshStandardMaterial({ color: '#f6f2e8', metalness: 0.8, roughness: 0.2, emissive: '#ffd98c', emissiveIntensity: 0.35 })
      : new THREE.MeshStandardMaterial({ color: '#8e9198', metalness: 0.55, roughness: 0.62 })));
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.024, 0.95), ov ? ov.goldGlow : lit ? M.goldGlow : new THREE.MeshStandardMaterial({ color: '#6f7278', roughness: 0.7 })); fuller.position.z = 0.68; g.add(fuller);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bakeStatic(g);
    g.scale.setScalar(this.scale * 0.95);
    this.tipLocal = [new V3(0, 0, 1.42), new V3(0, 0, 0.4)];
    return g;
  }
  // 天樞 · the Lord's own sword: slender, silver-white, a cold blue light down its core
  buildLongsword() {
    const M = this.M, g = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.34, 8), M.gold); grip.rotation.x = Math.PI / 2; grip.position.z = -0.02; g.add(grip);
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), M.gem); pommel.position.z = -0.22; g.add(pommel);
    for (const s of [1, -1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.013, 6, 16, 1.7), M.gold); w.position.set(s * 0.02, 0, 0.16); w.rotation.set(Math.PI / 2, 0, s > 0 ? -0.25 : Math.PI + 0.25); g.add(w); }
    const shape = new THREE.Shape();
    shape.moveTo(-0.048, 0); shape.lineTo(0.048, 0); shape.lineTo(0.036, 1.3); shape.lineTo(0, 1.5); shape.lineTo(-0.036, 1.3); shape.closePath();
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
    bg.translate(0, 0, -0.007); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.19);
    g.add(new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: '#eef3fb', metalness: 0.85, roughness: 0.18, emissive: '#8fb8ff', emissiveIntensity: 0.35 })));
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.022, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.9, 2.6) })); core.position.z = 0.8; g.add(core);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bakeStatic(g);
    g.scale.setScalar(this.scale * 0.95);
    this.tipLocal = [new V3(0, 0, 1.68), new V3(0, 0, 0.45)];
    return g;
  }
  setWeapon(kind) {
    this.weaponHolder.remove(this.weapon); this.opt.weapon = kind; this.weapon = this.buildWeapon(kind); this.weaponHolder.add(this.weapon);
    this.offHolder.clear(); this.form = (WVAR[kind] && WVAR[kind].base) || kind;
    if (this.form === 'dual') { const t = this.tipLocal; this.offHolder.add(this.buildWeapon(kind)); this.tipLocal = t; }
  }
  tipWorld(i, out) { return out.copy(this.tipLocal[i]).applyMatrix4(this.weapon.matrixWorld); }
  update(dt, S, params) {
    const c = params || this.anim.update(dt, S);
    if (params) this.anim.t += dt;
    const pose = paramsToPose(c);
    pose.hips.multiplyScalar(this.scale);
    this.rig.apply(pose.q, pose.hips);
    this.root.updateMatrixWorld(true);
    // sockets
    const rootInv = _m.copy(this.root.matrixWorld).invert();
    const rootQinv = this.root.getWorldQuaternion(_q2).invert();
    for (const name in this.sockets) {
      if (!this.rig.socket(name, _p, _q)) continue;
      for (const s of this.sockets[name]) {
        s.quaternion.copy(rootQinv).multiply(_q);
        s.position.copy(_p).applyMatrix4(rootInv).add(_v.copy(s.userData.off).multiplyScalar(this.scale).applyQuaternion(s.quaternion));
      }
    }
    for (const n in this.sockets) for (const s of this.sockets[n]) s.scale.setScalar(this.scale);
    this.updateWings(dt, S, c);
    this.halo.rotation.z = this.anim.t * 0.25;
    this.halo.scale.setScalar(Math.max(0.001, this.angel)); this.halo.visible = this.angel > 0.02;
    if (this.mantle) { this.mantle.scale.setScalar(Math.max(0.001, this.angel)); this.mantle.visible = this.angel > 0.02; }
    this.updateWeapon(dt, S);
    this.root.updateMatrixWorld(true);
    this.updateCloth(dt, S);
  }
  // ---- wings: unfurl / fold-away spring, the wing-beat stroke, banking, and the primary fan
  updateWings(dt, S, c) {
    const want = this.wingWant, t = this.anim.t;
    if (want !== undefined) {
      const k = want ? 82 : 52, d = want ? 11 : 13.5, n = Math.min(40, Math.ceil(dt / 0.008)), h = dt / Math.max(1, n);
      for (let i = 0; i < n; i++) { this.unfV += (k * (want - this.unf) - d * this.unfV) * h; this.unf += this.unfV * h; }
      if (!want && this.unf < 0) { this.unf = 0; this.unfV = 0; }
      if (want && !this.shook && this.unf > 0.9) { this.shook = true; this.beat = 0; this.beatAmp = 0.6; } // shake the feathers out
      if (!want && this.unf < 0.5) this.shook = false;
      this.angel = smooth(0, 0.42, this.unf);
    }
    const u = this.unf, over = Math.max(0, u - 1), sc = this.angel;
    const e1 = smooth(0.04, 0.72, u), e2 = smooth(0.28, 0.95, u) + over * 1.4, e3 = smooth(0.5, 1.0, u) + over * 2.2;
    // opening, the wings sweep up as they stretch; folding away, they sweep down and back
    const rise = Math.sin(clamp(u, 0, 1) * Math.PI) * (want === 0 ? -0.35 : 0.4);
    // a wing-beat: raise, drive down hard with the hand open, then draw the wrist in on the recovery
    const fl = S.flap || 0;
    if (fl > this.flapPrev + 0.05) { this.beat = 0; this.beatAmp = 1; }
    this.flapPrev = fl;
    let sUp = 0, sFold = 0, sHand = 0, sFan = 0, sPitch = 0;
    if (this.beat >= 0) {
      const b = this.beat, A = this.beatAmp;
      sUp = KF(b, [[0, 0], [0.16, 0.6], [0.44, -0.85], [0.72, -0.15], [1, 0]]) * A;
      sFold = KF(b, [[0, 0], [0.16, 0.18], [0.44, -0.3], [0.75, 0.12], [1, 0]]) * A;
      sHand = KF(b, [[0, 0], [0.16, 0.28], [0.32, 0], [0.5, 0.05], [0.7, 0.6], [1, 0]]) * A;
      sFan = KF(b, [[0, 0], [0.16, -0.25], [0.4, 0.25], [0.62, -0.4], [1, 0]]) * A;
      sPitch = KF(b, [[0, 0], [0.16, -0.12], [0.44, 0.28], [0.72, -0.1], [1, 0]]) * A;
      this.beat += dt / 0.52; if (this.beat >= 1) this.beat = -1;
    }
    this.bank = damp(this.bank, S.bank || 0, 5, dt);
    const gl = S.glide && !S.grounded, flA = gl ? 0.045 : 0.012, flF = gl ? 9 : 3;
    for (const w of this.wings) {
      const s = w.side;
      w.root.visible = sc > 0.004;
      if (!w.root.visible) continue;
      const fold = lerp(1.38, c.fold, e1) + sFold;
      const up = lerp(-0.5, 0.22 + c.wLift - c.fold * 0.18 + c.flap, e1) + rise + sUp - s * this.bank * 0.42;
      const pitch = lerp(0.62, c.fold * 0.42 - c.wLift * 0.3, e1) + sPitch;
      w.root.rotation.set(pitch, s * fold * 1.32, s * up);
      w.root.scale.setScalar(Math.max(0.001, c.wScale * sc * (this.wingK ?? 1) * (1 + over * 0.35)));
      // the wrist: folded, the hand lies back along the arm with its primaries drooping
      const hf = clamp(lerp(1, c.hand, Math.min(e2, 1.3)) + sHand + (gl ? -s * this.bank * 0.06 : 0), -0.08, 1.05);
      w.hand.rotation.set(-hf * 0.2, hf * 2.7, -hf * 0.32);
      // the primaries fan: stacked when folded, spread and rippling on the air when open
      const spread = clamp(lerp(0.04, c.spread, Math.min(e3, 1.3)) + sFan, 0, 1.35), sp1 = Math.min(spread, 1);
      const n = w.prim.length;
      for (let i = 0; i < n; i++) {
        const p = w.prim[i], f = i / (n - 1);
        const th = lerp(1.3 - f * 0.1, p.th, spread) + Math.sin(t * flF + i * 0.8 + s) * flA * (0.4 + f);
        if (i === n - 1) w.tipTh = th;
        _fp.set(p.x * (0.3 + 0.7 * sp1), p.y, p.z - (1 - sp1) * f * 0.03);
        _fq.setFromEuler(_fe.set(0, 0, Math.PI + th));
        _fs.set(p.w, p.len * (0.9 + 0.1 * sp1), 1);
        w.primIM.setMatrixAt(i, _fm.compose(_fp, _fq, _fs));
      }
      w.primIM.instanceMatrix.needsUpdate = true;
    }
    // the feathers flare with light while they unfurl or dissolve
    const glow = want !== undefined ? clamp(4 * u * (1 - u), 0, 1) : 0;
    this.wingGlow = glow;
    this.M.feather.emissiveIntensity = this.featherE0 + glow * 0.45 + (this.beat >= 0 ? Math.sin(this.beat * Math.PI) * 0.12 : 0);
  }
  // world position of a wing's tip (outermost primary)
  wingTip(i, out) {
    const w = this.wings[i], p = w.prim[w.prim.length - 1], th = w.tipTh;
    out.set(p.x + Math.sin(th) * p.len, p.y - Math.cos(th) * p.len, p.z);
    return w.hand.localToWorld(out);
  }
  updateWeapon(dt, S) {
    const sp = this.anim.sp, mode = S.spMode || sp.mode;
    this.rig.socket('RightHand', _p, _q);
    const rootInv = _m.copy(this.root.matrixWorld).invert();
    const hand = _p.applyMatrix4(rootInv);
    // direction in character space
    let dir;
    if (mode === 'arm') {
      const fa = new V3(); this.rig.d.RightForeArm.bone.getWorldPosition(fa); fa.applyMatrix4(rootInv);
      dir = hand.clone().sub(fa).normalize();
    } else if (mode === 'back') dir = new V3(0, -0.35, -1).normalize();
    else if (mode === 'guard') dir = new V3(-0.15, 0.25, 1).normalize();
    else if (mode === 'down') dir = new V3(0, -1, 0.3).normalize();
    else if (mode === 'roll') dir = new V3(-0.35, -0.75, -0.55).normalize().applyAxisAngle(_X, this.anim.c.roll || 0); // blade laid along his flank, turning with him
    else if (mode === 'bow') dir = new V3(0.12, 1, 0.15).normalize();
    else dir = new V3(0, Math.cos(sp.tilt), Math.sin(sp.tilt));
    if (this.form === 'bow' && mode !== 'bow') dir = mode === 'back' ? new V3(0.3, 1, -0.3).normalize() : new V3(0.15, 1, 0.35).normalize(); // a bow is carried upright, never like a blade
    const tq = _q2.setFromUnitVectors(new V3(0, 0, 1), dir);
    const twist = new Q().setFromAxisAngle(dir, mode === 'arm' ? Math.PI / 2 : 0);
    tq.premultiply(twist);
    this.spearQ.slerp(tq, 1 - Math.exp(-(mode === 'arm' ? 40 : mode === 'roll' ? 60 : 14) * dt));
    this.weaponHolder.position.copy(hand);
    this.weaponHolder.quaternion.copy(this.spearQ);
    this.offHolder.visible = this.form === 'dual' && this.weaponHolder.visible;
    if (this.offHolder.visible) { // the left blade mirrors the right
      this.rig.socket('LeftHand', _p, _q); const lh = _p.applyMatrix4(rootInv);
      let ld;
      if (mode === 'arm') { const fa = new V3(); this.rig.d.LeftForeArm.bone.getWorldPosition(fa); fa.applyMatrix4(rootInv); ld = lh.clone().sub(fa).normalize(); }
      else if (mode === 'back') ld = new V3(0, -0.35, -1).normalize(); else ld = new V3(0.2, -0.85, 0.4).normalize();
      const oq = new Q().setFromUnitVectors(new V3(0, 0, 1), ld); if (mode === 'arm') oq.premultiply(new Q().setFromAxisAngle(ld, -Math.PI / 2));
      this.offQ.slerp(oq, 1 - Math.exp(-(mode === 'arm' ? 40 : 14) * dt));
      this.offHolder.position.copy(lh); this.offHolder.quaternion.copy(this.offQ);
    }
  }
  updateCloth(dt, S) {
    if (!this.cloths.length) return;
    const s = this.scale;
    const head = new V3(), hq = new Q(), chest = new V3(), cq = new Q(), hips = new V3();
    this.rig.socket('Head', head, hq); this.rig.socket('Spine2', chest, cq);
    this.rig.d.Hips.bone.getWorldPosition(hips);
    const down = new V3(0, -1, -0.15).applyQuaternion(cq).normalize();
    const vis = this.root.visible;
    if (this.hair) { if (this.hairStyle === 'tied') this.hair.setPins((f, out) => out.set((f - 0.5) * 0.04 * s, 0.07 * s, -0.12 * s).applyQuaternion(hq).add(head).add(_v.set(0, 0.1 * s, 0).applyQuaternion(hq)));
      else this.hair.setPins((f, out) => out.set((f - 0.5) * (this.hairStyle === 'long' ? 0.19 : 0.17) * s, 0.04 * s - Math.abs(f - 0.5) * 0.06 * s, -0.08 * s).applyQuaternion(hq).add(head).add(_v.set(0, 0.1 * s, 0).applyQuaternion(hq))); }
    if (this.sashL) {
      this.sashL.setPins((f, out) => out.set((0.1 + f * 0.07) * s, 0.13 * s, -0.08 * s).applyQuaternion(cq).add(chest));
      this.sashR.setPins((f, out) => out.set((-0.17 + f * 0.07) * s, 0.13 * s, -0.08 * s).applyQuaternion(cq).add(chest));
    }
    if (this.cape) { // pinned across the shoulders, curving round the back
      this.cape.setPins((f, out) => out.set((f - 0.5) * 0.4 * s, 0.17 * s, (-0.11 - Math.cos((f - 0.5) * Math.PI) * 0.03 + Math.abs(f - 0.5) * 0.06) * s).applyQuaternion(cq).add(chest));
      this.cape.mesh.visible = vis && this.angel < 0.3; // folded away while the wings are out
    }
    const back = new V3(0, 0.02, -0.06 * s).applyQuaternion(cq).add(chest);
    const spheres = [
      { x: back.x, y: back.y, z: back.z, r: (this.cape ? 0.2 : 0.15) * s },
      { x: back.x, y: back.y - 0.22 * s, z: back.z, r: (this.cape ? 0.19 : 0.001) * s },
      { x: hips.x, y: hips.y - 0.05 * s, z: hips.z, r: 0.2 * s },
      { x: head.x, y: head.y + 0.1 * s, z: head.z, r: 0.12 * s },
    ];
    const speed = S.speed || 0;
    const wind = [Math.sin(this.anim.t * 0.7) * 0.6, S.glide ? 2.5 : 0, Math.cos(this.anim.t * 0.5) * 0.4];
    for (const c of this.cloths) { c.step(dt, wind, spheres, down); c.mesh.visible = vis && (c !== this.cape || this.angel < 0.3); }
  }
  resetCloth() { for (const c of this.cloths) c.ready = false; }
  setVisible(v) { this.root.visible = v; this.weaponHolder.visible = v; this.offHolder.visible = v && this.form === 'dual'; for (const c of this.cloths) c.mesh.visible = v; }
  // dress the hero: colours change at once; outfit, hair and build rebuild the body; hair and cape are fresh cloth
  setLook(look) {
    if (this.opt.style !== 'warrior') return;
    const L = Object.assign({}, LOOK_DEFAULT, look), M = this.M, O = Object.assign({}, OUTFITS[L.outfit] || OUTFITS.belldawn, L.cols || {});
    M.dress.color.set(O.dress); M.leather.color.set(O.leather); M.white.color.set(O.white); M.steel.color.set(O.steel);
    M.hair.color.set(L.hairCol); M.skin.color.set(L.skin); M.eye.color.set(L.eye);
    if (M.cape.map !== capeTexture(L.capeCol)) { M.cape.map = capeTexture(L.capeCol); M.cape.needsUpdate = true; }
    const key = [L.outfit, L.hair, L.build.toFixed(2), L.height.toFixed(3), L.sex, L.belly, L.beard, L.noPendant].join('|');
    this.opt.look = L;
    if (key !== this.lookKey) { const first = this.lookKey === undefined; this.lookKey = key; this.useDefaultBody(); if (!first || L.hair !== 'short') this.remakeCloth('hair', L.hair); }
    if (L.cape !== this.capeStyle) { this.capeStyle = L.cape; this.remakeCloth('cape', L.cape); }
  }
  remakeCloth(which, style) {
    if (this.opt.noCloth) return;
    const s = this.scale, old = this[which];
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); this.cloths = this.cloths.filter((c) => c !== old); this[which] = null; }
    const P = which === 'hair' ? (HAIR_CLOTH[style] || HAIRS.short).cloth : (CAPES[style] || CAPES.half).cloth;
    if (!P) return;
    const c = which === 'hair' ? new Cloth(P[0], P[1], P[2] * s, P[3] * s, this.M.hair, { taper: style === 'tied' ? 0.3 : 0.55, grav: -8 })
      : new Cloth(P[0], P[1], P[2] * s, P[3] * s, this.M.cape, { grav: -7, drag: 0.975, shadow: true });
    this[which] = c; this.hairStyle = which === 'hair' ? style : this.hairStyle; this.scene.add(c.mesh); this.cloths.push(c);
  }
}
