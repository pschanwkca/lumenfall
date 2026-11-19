// LUMENFALL · 人間的人 — the faceless, cloaked folk of the mortal world
// Everyone shares one instanced mesh (a hooded cloak with a pale, featureless face, in the same visual language as the
// seraph) plus one instanced lantern and one glow sprite each. Poses are whole-body: kneel, cower, raise a lantern,
// bow, hop for joy, walk home. Lines are short and spoken once in a while when the seraph comes close.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './core.js';
import { loft } from './figure.js';

export const FOLK_PAL = {
  villager: ['#c9b79a', '#a8b3a0', '#b9a0a0', '#9fb0c2', '#c7bfae', '#b7a98a'],
  fisher: ['#7f93a3', '#8e9c8a', '#6f8495', '#94a0a8'],
  monk: ['#dcd6c9', '#cdc6b6', '#e6e1d6'],
};
const LANTERN = { idle: [0.3, 0.92, 0.22], guard: [0.24, 1.52, 0.34], pray: [0.46, 0.14, 0.32], sealed: [0.46, 0.14, 0.32], cower: [0.22, 0.62, 0.26], cheer: [0.3, 1.3, 0.2], bow: [0.32, 0.6, 0.36], walk: [0.3, 0.92, 0.22], leave: [0.3, 0.92, 0.22] };

export function createFolk(root, { ground, max = 96 }) {
  const tag = (g, col, tint) => {
    const n = g.attributes.position.count, cc = new THREE.Color(col), c = new Float32Array(n * 3), t = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; t[i] = tint; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
    return g;
  };
  // a low-poly, flat-shaded hooded figure: a cloak falling in folds, a cowl over the shoulders, sleeves meeting
  // at the front, a deep hood with a pale face in its shadow (the same hand as the cast in figure.js)
  const parts = [];
  const take = (geos, col, tint) => { for (const m in geos) if (m !== 'pts') parts.push(tag(geos[m], col, tint)); };
  const cl = [[0, 0.275, 0.25, 0.28], [0.08, 0.285, 0.26, 0.29], [0.4, 0.27, 0.235, 0.258], [0.75, 0.245, 0.2, 0.225], [1.0, 0.215, 0.16, 0.175], [1.17, 0.205, 0.135, 0.15], [1.3, 0.11, 0.09, 0.1], [1.34, 0.06, 0.06, 0.06]];
  take(loft(cl.map(([y, w, d, b]) => ({ c: [0, y, 0], w, d, b, s: 2.2 })), { n: 14, axis: 'y', cap0: 'c', cap1: 'c', mat: 'c',
    mod: (p, a, k, i) => { const f = 1 + (i % 2 ? 0.035 : -0.02) * Math.max(0, 1 - k / 4); p.x *= f; p.z *= f; } }), '#ffffff', 1);
  // cowl
  take(loft([[1.08, 0.245, 0.17, 0.185], [1.2, 0.22, 0.15, 0.165], [1.3, 0.13, 0.11, 0.12]].map(([y, w, d, b]) => ({ c: [0, y, 0], w, d, b, s: 2.2 })), { n: 14, axis: 'y', mat: 'c',
    mod: (p, a, k, i) => { if (k === 0) { const f = 1 + (i % 2 ? 0.05 : -0.02); p.x *= f; p.z *= f; p.y -= 0.02 * Math.max(0, Math.cos(a)); } } }), '#f2efe8', 1);
  // sleeves to the front, hands folded
  for (const [sx, hx, hy, hz] of [[1, 0.2, 0.96, 0.18], [-1, -0.08, 0.92, 0.2]]) {
    take(loft([{ c: [sx * 0.19, 1.16, 0.0], w: 0.07, d: 0.07 }, { c: [sx * 0.2 * 0.6 + hx * 0.4, 1.03, 0.1], w: 0.07, d: 0.07 }, { c: [hx, hy + 0.01, hz - 0.035], w: 0.092, d: 0.086 }], { n: 6, axis: 'y', mat: 'c' }), '#ffffff', 1);
    const h = new THREE.IcosahedronGeometry(0.036, 0); h.scale(1, 0.8, 1.1); h.translate(hx, hy - 0.02, hz + 0.01); parts.push(tag(h.toNonIndexed(), '#e9d6c0', 0));
  }
  // hood, open at the face, with a face in its shadow
  const HD = [[1.25, 0.19, 0.14, 0.15, 0], [1.34, 0.135, 0.13, 0.135, 0.008], [1.43, 0.14, 0.142, 0.142, 0.006], [1.515, 0.134, 0.138, 0.15, -0.002], [1.585, 0.108, 0.114, 0.144, -0.014], [1.628, 0.062, 0.056, 0.122, -0.045], [1.65, 0.022, 0.022, 0.066, -0.09]];
  take(loft(HD.map(([y, w, d, b, zc]) => ({ c: [0, y, zc], w, d, b, s: 2.1 })), { n: 14, axis: 'y', cap1: 'c', mat: (a, k) => (k >= 1 && k <= 3 && Math.abs(a) < 0.9 ? null : 'c'),
    mod: (p, a, k) => { const f = Math.max(0, Math.cos(a)); if (k === 4) { p.z += 0.012 * f; p.y -= 0.03 * f * f; } if (k === 1) p.y -= 0.012 * f; } }), '#f2efe8', 1);
  take(loft([[1.36, 0.035, 0.05, 0.05, 0.018], [1.39, 0.06, 0.08, 0.075, 0.012], [1.44, 0.074, 0.088, 0.09, 0.006], [1.5, 0.076, 0.084, 0.095, 0], [1.55, 0.062, 0.06, 0.08, -0.004], [1.575, 0.03, 0.03, 0.04, -0.006]]
    .map(([y, w, d, b, zc]) => ({ c: [0, y, zc], w, d, b, s: 2.2 })), { n: 10, axis: 'y', cap0: 'c', cap1: 'c', mat: 'c', mod: (p, a, k, i) => { if (i === 0 && k === 2) p.z += 0.012; } }), '#efe2cf', 0);
  for (const sx of [1, -1]) { // two dark eyes and a brow line: enough to meet their gaze
    const e = new THREE.IcosahedronGeometry(0.011, 0); e.scale(1.3, 0.75, 0.5); e.translate(sx * 0.027, 1.466, 0.083); parts.push(tag(e.toNonIndexed(), '#3a2a22', 0));
    const br = new THREE.BoxGeometry(0.03, 0.006, 0.006); br.rotateZ(sx * -0.12); br.translate(sx * 0.028, 1.486, 0.084); parts.push(tag(br.toNonIndexed(), '#8a7260', 0));
  }
  const scarf = new THREE.TorusGeometry(0.15, 0.04, 4, 14); scarf.rotateX(Math.PI / 2); scarf.scale(1, 1, 0.9); scarf.translate(0, 1.29, 0.0); parts.push(tag(scarf.toNonIndexed(), '#d8b463', 0));
  for (const g of parts) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aTint'].includes(k)) g.deleteAttribute(k); }
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', `vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aTint);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'lumenfall-folk-2';
  const bodies = new THREE.InstancedMesh(geo, mat, max);
  bodies.castShadow = true; bodies.receiveShadow = true; bodies.frustumCulled = false;
  const lgeo = new THREE.CylinderGeometry(0.09, 0.11, 0.24, 6);
  const lanterns = new THREE.InstancedMesh(lgeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.9) }), max);
  lanterns.frustumCulled = false;
  const gp = new Float32Array(max * 3), gc = new Float32Array(max * 3);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3)); gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  const glows = new THREE.Points(gg, new THREE.PointsMaterial({ map: TEX.glow, size: 2.0, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glows.frustumCulled = false;
  root.add(bodies, lanterns, glows);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < max; i++) { bodies.setMatrixAt(i, zero); lanterns.setMatrixAt(i, zero); bodies.setColorAt(i, new THREE.Color(1, 1, 1)); lanterns.setColorAt(i, new THREE.Color(1, 1, 1)); }
  bodies.count = lanterns.count = 0;
  const people = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sv = new THREE.Vector3(), pv = new THREE.Vector3(), cc = new THREE.Color();
  let lastSay = -99;

  function add(o) {
    if (people.length >= max) return null;
    const pal = FOLK_PAL[o.kind || 'villager'];
    const p = {
      i: people.length, x: o.x, z: o.z, yaw: o.yaw ?? Math.random() * 6.28, st: o.st || 'idle', t: 0, ph: Math.random() * 6.28,
      s: o.scale || (0.92 + Math.random() * 0.14), lit: o.lit ?? true, lantern: o.lantern ?? true, line: o.line, said: -99, on: true, fade: 1,
      lean: 0, sy: 1, bob: 0, dest: null, then: null, home: { x: o.x, z: o.z, yaw: o.yaw ?? 0 },
    };
    p.y = ground(p.x, p.z);
    bodies.setColorAt(p.i, cc.set(o.col || pal[Math.floor(Math.random() * pal.length)]));
    bodies.instanceColor.needsUpdate = true;
    people.push(p);
    bodies.count = lanterns.count = people.length;
    p.set = (st, then) => { p.st = st; p.t = 0; p.then = then || null; };
    p.goTo = (x, z, then, st = 'walk') => { p.dest = { x, z }; p.set(st, then); };
    return p;
  }

  function update(dt, t, cam, player, say) {
    let dirtyC = false;
    for (const p of people) {
      p.t += dt;
      if (!p.on) { if (!p.hidden) { bodies.setMatrixAt(p.i, zero); lanterns.setMatrixAt(p.i, zero); gc[p.i * 3] = gc[p.i * 3 + 1] = gc[p.i * 3 + 2] = 0; p.hidden = true; dirtyC = true; } continue; }
      p.hidden = false;
      const dc = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (dc > 170 && p.drawn && p.st !== 'walk' && p.st !== 'leave') continue;
      p.drawn = true;
      const dpx = player.x - p.x, dpz = player.z - p.z, dp = Math.hypot(dpx, dpz);
      let lean = 0, sy = 1, bob = 0, jit = 0;
      switch (p.st) {
        case 'idle': lean = Math.sin(t * 0.9 + p.ph) * 0.02; sy = 1 + Math.sin(t * 1.6 + p.ph) * 0.012; break;
        case 'guard': lean = -0.03; sy = 1.01; p.yaw += Math.sin(t * 0.7 + p.ph) * dt * 0.25; break;
        case 'pray': case 'sealed': sy = 0.64; lean = 0.3 + (p.st === 'pray' ? Math.sin(t * 0.8 + p.ph) * 0.04 : 0); break;
        case 'cower': sy = 0.8; lean = -0.12; jit = Math.sin(t * 38 + p.ph) * 0.02; break;
        case 'cheer': bob = Math.abs(Math.sin(t * 9 + p.ph)) * 0.32; lean = -0.06; if (p.t > 1.8) p.set('idle'); break;
        case 'bow': lean = Math.sin(Math.min(1, p.t / 1.4) * Math.PI) * 0.62; if (p.t > 1.5) { const f = p.then; p.set('idle'); if (f) f(p); } break;
        case 'walk': case 'leave': {
          bob = Math.abs(Math.sin(t * 8 + p.ph)) * 0.06; lean = 0.08;
          if (p.dest) {
            const dx = p.dest.x - p.x, dz = p.dest.z - p.z, d = Math.hypot(dx, dz), sp = (p.st === 'leave' ? 2.2 : 1.6) * dt;
            p.yaw = dampAngle(p.yaw, Math.atan2(dx, dz), 6, dt);
            if (d > sp) { p.x += (dx / d) * sp; p.z += (dz / d) * sp; p.y = ground(p.x, p.z); } else if (p.st === 'walk') { p.dest = null; const f = p.then; p.set('idle'); if (f) f(p); }
          }
          if (p.st === 'leave') { p.fade = Math.max(0, 1 - Math.max(0, p.t - 5) / 1.5); if (p.fade <= 0) p.on = false; }
          break;
        }
      }
      // people turn to look at the seraph
      if (dp < 7 && (p.st === 'idle' || p.st === 'guard' || p.st === 'cheer')) p.yaw = dampAngle(p.yaw, Math.atan2(dpx, dpz), 3, dt);
      p.lean += (lean - p.lean) * Math.min(1, dt * 6); p.sy += (sy - p.sy) * Math.min(1, dt * 6);
      const s = p.s * p.fade;
      e.set(p.lean, p.yaw, 0); q.setFromEuler(e);
      bodies.setMatrixAt(p.i, m4.compose(pv.set(p.x + jit, p.y + bob, p.z), q, sv.set(s, s * p.sy, s)));
      // the lantern
      const L = LANTERN[p.st] || LANTERN.idle, cy = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const lx = p.x + (cy * L[0] + sn * L[2]) * s, lz = p.z + (-sn * L[0] + cy * L[2]) * s, ly = p.y + bob + L[1] * s * (p.st === 'pray' || p.st === 'sealed' ? 1 : p.sy);
      if (p.lantern) {
        lanterns.setMatrixAt(p.i, m4.compose(pv.set(lx, ly, lz), q.identity(), sv.set(s, s, s)));
        const k = p.lit ? 1 : 0.12;
        lanterns.setColorAt(p.i, cc.setRGB(k, k * 0.95, k * 0.9));
        gp[p.i * 3] = lx; gp[p.i * 3 + 1] = ly; gp[p.i * 3 + 2] = lz;
        const g = p.lit ? (0.9 + Math.sin(t * 6 + p.ph) * 0.08) * p.fade : 0;
        gc[p.i * 3] = g * 1.1; gc[p.i * 3 + 1] = g * 0.72; gc[p.i * 3 + 2] = g * 0.36;
      } else { lanterns.setMatrixAt(p.i, zero); gc[p.i * 3] = gc[p.i * 3 + 1] = gc[p.i * 3 + 2] = 0; }
      dirtyC = true;
      // a word or two when the seraph comes close
      if (say && p.line && dp < 4.6 && Math.abs(player.y - p.y) < 3 && p.st !== 'sealed' && p.st !== 'leave' && p.st !== 'walk' && t - p.said > 45 && t - lastSay > 5) { p.said = t; lastSay = t; say(p.line, p); }
    }
    if (dirtyC) {
      bodies.instanceMatrix.needsUpdate = true; lanterns.instanceMatrix.needsUpdate = true;
      if (lanterns.instanceColor) lanterns.instanceColor.needsUpdate = true;
      gg.attributes.position.needsUpdate = true; gg.attributes.color.needsUpdate = true;
    }
  }
  return { add, update, people, bodies };
}
function dampAngle(a, b, k, dt) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * (1 - Math.exp(-k * dt)); }
