// LUMENFALL · 地獄 · 冥門前庭 — the abyssal threshold beneath the rift
// The only way in is the fall. A floor of basalt cracked over a sea of fire, a burning river, the ribs of something vast,
// and in the north wall the Gate of the Abyss with its keeper before it. Everything here shrugs off mortal light:
// until the seraph carries the weapon of the Empyrean's lord, the threshold is as far as anyone gets.
import * as THREE from 'three';
import { HELL_Y, HWORLD, HHALF, HSEG, HGN, HCELL, HCX, HCZ, grid3, groundAtL, fbm, smooth, lerp, clamp, mulberry, TEX } from './core.js';
import { W, colliders, noReflect } from './world.js';
import { terrainDetail, rockGeo } from './env.js';
import { riftZ, riftW } from './earth.js';
import { bakeStatic } from './hero.js';

export const HELL = { enemies: [], marks: [], feathers: [] };
const LP = { u: 0, v: 72 };            // where the fall ends
const AR = { u: 0, v: -128, r: 36 };   // the keeper's arena
const GT = { u: 0, v: -194 };          // the Gate of the Abyss
const lavaV = (u) => -46 + Math.sin(u * 0.028) * 12;
const W2 = (u, v) => [HCX + u, HCZ + v];

export function hellH(u, v) {
  let h = fbm(u * 0.02 + 7, v * 0.02 - 3, 3) * 5 + fbm(u * 0.09, v * 0.09, 2) * 1.4;
  const crack = Math.abs(fbm(u * 0.035 + 31, v * 0.035 - 17, 3));
  h -= 9 * (1 - smooth(0.0, 0.045, crack)) * smooth(26, 50, Math.hypot(u - LP.u, v - LP.v)) * smooth(40, 56, Math.hypot(u - AR.u, v - AR.v));
  const r = Math.hypot(u, (v + 40) * 0.95);
  h += smooth(160, 228, r) * (70 + fbm(u * 0.03, v * 0.03, 2) * 50);
  h += smooth(-176, -200, v) * (80 + fbm(u * 0.05, 1.7, 2) * 20);
  const lv = Math.abs(v - lavaV(u));
  h = lerp(-7, h, smooth(7, 14, lv));
  const pd = Math.abs(u - Math.sin(v * 0.02) * 8);
  if (lv > 15 && v > AR.v && v < LP.v) h = lerp(lerp(h, 1.4, 0.85), h, smooth(4, 10, pd));
  h = lerp(1.5, h, smooth(AR.r - 4, AR.r + 8, Math.hypot(u - AR.u, v - AR.v)));
  h = lerp(2, h, smooth(22, 36, Math.hypot(u - LP.u, v - LP.v)));
  h = lerp(1.5, h, smooth(15, 24, Math.hypot(u - GT.u, (v - GT.v - 8) * 1.25)));
  return h;
}
export function buildHellGrid() {
  for (let iz = 0; iz < HGN; iz++) for (let ix = 0; ix < HGN; ix++) grid3.h[iz * HGN + ix] = hellH(-HHALF + ix * HCELL, -HHALF + iz * HCELL);
}
export const inLava = (x, z) => groundAtL(x, z, 2) < HELL_Y - 0.6;

const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const haze = (m, k) => { m.defines = Object.assign({}, m.defines, { FOG_SCALE: k }); return m; };

export function buildHell(scene) {
  const R = mulberry(666), Y = HELL_Y;
  const root = new THREE.Group(); root.name = 'hell'; scene.add(root); HELL.root = root;
  const gA = (x, z) => groundAtL(x, z, 2);
  // ---- the floor
  const geo = new THREE.PlaneGeometry(HWORLD, HWORLD, HSEG, HSEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, grid3.h[i]);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, c = new THREE.Color();
  const cBas = new THREE.Color('#2c2427'), cAsh = new THREE.Color('#4e4443'), cHot = new THREE.Color('#6e2410'), cWall = new THREE.Color('#1c181b'), cRune = new THREE.Color('#3a2a2a');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getZ(i), h = grid3.h[i], ny = nrm.getY(i), n = fbm(u * 0.05, v * 0.05, 2) * 0.5 + 0.5;
    c.copy(cBas).lerp(cAsh, n * 0.6);
    c.lerp(cHot, smooth(0.5, -3, h));
    c.lerp(cWall, smooth(0.8, 0.5, ny) * 0.8);
    if (Math.hypot(u - AR.u, v - AR.v) < AR.r) c.lerp(cRune, 0.5);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const floor = new THREE.Mesh(geo, terrainDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), { tint: true, cracks: true }));
  floor.position.set(HCX, Y, HCZ); floor.receiveShadow = true; root.add(floor);
  // ---- the sea of fire beneath the cracks
  const lavaM = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec2 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xz; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; varying vec2 vP;
      float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hs(i), hs(i+vec2(1,0)), f.x), mix(hs(i+vec2(0,1)), hs(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vP*0.06; float t = uTime*0.05;
        float n = ns(p + vec2(t, t*0.6))*0.55 + ns(p*2.3 - vec2(t*1.4, -t))*0.3 + ns(p*5.1 + t*2.0)*0.15;
        float crust = smoothstep(0.42, 0.62, n);
        float pulse = 0.85 + 0.15*sin(uTime*1.1 + n*9.0);
        vec3 hot = mix(vec3(1.25, 0.16, 0.03), vec3(2.3, 0.6, 0.1), smoothstep(0.08, 0.4, n)) * pulse;
        vec3 col = mix(hot, vec3(0.06, 0.025, 0.022), crust);
        col += vec3(1.1, 0.3, 0.05) * pow(1.0 - abs(crust*2.0 - 1.0), 6.0) * 0.8; // glowing seams where the crust breaks
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(HWORLD, HWORLD), lavaM); lava.rotation.x = -Math.PI / 2; lava.position.set(HCX, Y - 1.2, HCZ); root.add(noReflect(lava));
  // ---- the sky of hell: a dark vault, and far above it the rift you fell through
  const skyM = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 col = mix(vec3(0.05, 0.012, 0.007), vec3(0.018, 0.005, 0.006), smoothstep(-0.05, 0.35, y));
        col = mix(col, vec3(0.004, 0.002, 0.003), smoothstep(0.3, 0.9, y));
        col += vec3(0.11, 0.025, 0.008)*pow(max(0.0, 1.0 - abs(y + 0.02)*5.0), 3.0); // the far fires along the horizon
        gl_FragColor = vec4(col, 1.0); }`,
    side: THREE.BackSide, depthWrite: true, fog: false, // writes depth: the isle and the cloud sea far above stay hidden behind it
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(950, 32, 16), skyM); sky.renderOrder = -10; sky.frustumCulled = false; root.add(noReflect(sky)); HELL.sky = sky;
  {
    const ptsTop = [], idx = []; let n = 0;
    for (let x = -345; x <= 300; x += 8) { const zc = riftZ(x), w = Math.max(1.5, riftW(x) * 0.7); ptsTop.push(x, Y + 330, zc - w, x, Y + 330, zc + w); if (n) idx.push(n * 2 - 2, n * 2 - 1, n * 2, n * 2 - 1, n * 2 + 1, n * 2); n++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ptsTop, 3)); g.setIndex(idx);
    const slit = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.6), side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.95, depthWrite: false }));
    root.add(noReflect(slit));
  }
  // ---- where the fall ends: the light from above reaches this far, and can carry you back up
  const [lx, lz] = W2(LP.u, LP.v), lg = gA(lx, lz);
  {
    const beamM = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.15, 0.78, 0.42), transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1, 32, 1, true).translate(0, 0.5, 0), beamM); beam.scale.set(1, 330, 1); beam.position.set(lx, lg, lz); root.add(noReflect(beam));
    const rune = new THREE.Mesh(new THREE.RingGeometry(2.6, 6.5, 64), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.3, 1.0, 0.6), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    rune.rotation.x = -Math.PI / 2; rune.position.set(lx, lg + 0.12, lz); root.add(rune);
    W.animated.push((t) => { rune.rotation.z = t * 0.2; beamM.opacity = 0.17 + Math.sin(t * 1.3) * 0.04; });
  }
  HELL.pillar = new THREE.Vector3(lx, lg, lz);
  HELL.landing = new THREE.Vector3(lx - 8, lg + 1, lz + 10);
  // ---- the burning river and its bridge
  {
    const grp = new THREE.Group(), st = new THREE.MeshStandardMaterial({ color: '#2a2224', map: TEX.marble, roughness: 0.85 });
    const v0 = lavaV(0), len = 34;
    const deck = shadowy(new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, len), st)); deck.position.set(HCX, Y + 1.0, HCZ + v0); grp.add(deck);
    for (const s of [-1, 1]) { const rl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, len), st)); rl.position.set(HCX + s * 3, Y + 2.2, HCZ + v0); grp.add(rl); }
    for (const s of [-1, 1]) for (const e of [-1, 1]) { const p = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.6, 6, 1.6), st)); p.position.set(HCX + s * 3, Y + 3, HCZ + v0 + e * len / 2); grp.add(p); }
    root.add(grp); bakeStatic(grp);
    for (let k = -len / 2 + 2; k <= len / 2 - 2; k += 3) colliders.pads.push({ x: HCX, z: HCZ + v0 + k, r: 2.8, top: Y + 1.6, bot: Y - 4 });
    for (const s of [-1, 1]) for (let k = -len / 2; k <= len / 2; k += 3) colliders.solids.push({ x: HCX + s * 3.4, z: HCZ + v0 + k, r: 0.5, y0: Y - 2, y1: Y + 3 });
  }
  // ---- the ribs of something vast, half sunk in the floor
  {
    const bone = new THREE.MeshStandardMaterial({ color: '#5a4a42', roughness: 0.82, map: TEX.marble });
    const grp = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const v = 40 - i * 13, rib = shadowy(new THREE.Mesh(new THREE.TorusGeometry(22 - Math.abs(i - 3) * 2, 1.2 - Math.abs(i - 3) * 0.08, 8, 40, Math.PI * 0.9), bone));
      const [x, z] = W2(-46, v); rib.position.set(x, gA(x, z) - 3, z); rib.rotation.set(0, Math.PI / 2, 0.15); grp.add(rib);
    }
    const spine = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.2, 90, 10), bone)); spine.rotation.x = Math.PI / 2; const [sx, sz] = W2(-46, 1); spine.position.set(sx, gA(sx, sz) - 1, sz); grp.add(spine);
    root.add(grp); bakeStatic(grp);
  }
  // ---- black spires
  {
    const list = [], geoS = rockGeo(91, 2), mat = new THREE.MeshStandardMaterial({ color: '#221c1f', roughness: 0.85, map: TEX.marble });
    const im = new THREE.InstancedMesh(geoS, mat, 70); let n = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let t = 0; t < 600 && n < 70; t++) {
      const u = (R() * 2 - 1) * 200, v = -180 + R() * 290, [x, z] = W2(u, v);
      if (Math.hypot(u - AR.u, v - AR.v) < AR.r + 8 || Math.hypot(u - LP.u, v - LP.v) < 30 || Math.abs(u - Math.sin(v * 0.02) * 8) < 10 || inLava(x, z)) continue;
      const g = gA(x, z), hh = 5 + R() * 18; e.set((R() - 0.5) * 0.3, R() * 6, (R() - 0.5) * 0.3); q.setFromEuler(e);
      im.setMatrixAt(n++, m4.compose(pv.set(x, g + hh * 0.3, z), q, sv.set(1.5 + R() * 2, hh, 1.5 + R() * 2)));
      colliders.solids.push({ x, z, r: 2.4, y0: g - 1, y1: g + hh });
      list.push(0);
    }
    im.count = n; im.castShadow = im.receiveShadow = true; root.add(im);
  }
  // ---- the keeper's arena: obelisks with burning runes
  const [ax, az] = W2(AR.u, AR.v), ag = Y + 1.5;
  {
    const ob = new THREE.MeshStandardMaterial({ color: '#16121a', roughness: 0.4, metalness: 0.4, emissive: '#ff3a12', emissiveMap: TEX.vein, emissiveIntensity: 1.1 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2, x = ax + Math.cos(a) * (AR.r + 4), z = az + Math.sin(a) * (AR.r + 4);
      const o = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.6, 15 + (i % 3) * 3, 2.6), ob)); o.position.set(x, gA(x, z) + 7, z); o.rotation.y = -a; root.add(o);
      colliders.solids.push({ x, z, r: 2, y0: gA(x, z) - 1, y1: gA(x, z) + 16 });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(AR.r - 6, AR.r - 3, 96), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(2.0, 0.45, 0.2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(ax, ag + 0.08, az); root.add(noReflect(ring));
    W.animated.push((t) => { ring.rotation.z = -t * 0.08; ob.emissiveIntensity = 0.9 + Math.sin(t * 1.4) * 0.3; });
  }
  HELL.bossHome = new THREE.Vector3(ax, ag, az + 6);
  HELL.arenaFloor = ag;
  // ---- 冥門 · the Gate of the Abyss, shut
  const [gx, gz] = W2(GT.u, GT.v), gg = gA(gx, gz + 8);
  {
    const iron = haze(new THREE.MeshStandardMaterial({ color: '#141015', roughness: 0.45, metalness: 0.7 }), 0.4);
    const runeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.6, 0.2), fog: false });
    const grp = new THREE.Group();
    for (const s of [-1, 1]) { const p = shadowy(new THREE.Mesh(new THREE.BoxGeometry(9, 54, 9), iron)); p.position.set(gx + s * 17, gg + 27, gz); grp.add(p); }
    const lintel = shadowy(new THREE.Mesh(new THREE.BoxGeometry(46, 9, 11), iron)); lintel.position.set(gx, gg + 56, gz); grp.add(lintel);
    for (const s of [-1, 1]) { const d = shadowy(new THREE.Mesh(new THREE.BoxGeometry(12.5, 46, 2.2), iron)); d.position.set(gx + s * 6.3, gg + 23, gz + 1); grp.add(d); }
    root.add(grp);
    const runes = new THREE.Group(); runes.position.set(gx, gg, gz + 2.3); root.add(runes);
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4 + (i % 3) * 2, 0.2), runeM); b.position.set((i - 4) * 2.6, 10 + (i % 4) * 7, 0); b.rotation.z = (i % 2 ? 1 : -1) * 0.5; runes.add(b); }
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 46, 0.3), runeM); seam.position.set(0, 23, 0); runes.add(seam);
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(26, 48), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.6, 0.3, 0.12), transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    veil.position.set(gx, gg + 24, gz + 4); root.add(noReflect(veil));
    W.animated.push((t) => { const p = 0.75 + Math.sin(t * 1.1) * 0.25; runeM.color.setRGB(2.8 * p, 0.6 * p, 0.2 * p); veil.material.opacity = 0.28 + p * 0.18; });
    colliders.solids.push({ x: gx, z: gz, r: 13, y0: gg - 2, y1: gg + 60 }, { x: gx - 17, z: gz, r: 6, y0: gg - 2, y1: gg + 60 }, { x: gx + 17, z: gz, r: 6, y0: gg - 2, y1: gg + 60 });
  }
  HELL.gate = new THREE.Vector3(gx, gg, gz + 10);
  // ---- embers rising everywhere
  {
    const NE = 900, ep = new Float32Array(NE * 3), es = new Float32Array(NE);
    for (let i = 0; i < NE; i++) { ep[i * 3] = HCX + (R() * 2 - 1) * 210; ep[i * 3 + 1] = Y - 2; ep[i * 3 + 2] = HCZ - 30 + (R() * 2 - 1) * 200; es[i] = R(); }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setAttribute('aSeed', new THREE.BufferAttribute(es, 1));
    const em = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: TEX.glow } },
      vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
        void main(){ vec3 p = position; float k = fract(aSeed*5.17 + uTime*(0.02 + aSeed*0.025)); p.y += k*70.0; p.x += sin(uTime*0.7 + aSeed*40.0)*2.5*k; p.z += cos(uTime*0.6 + aSeed*31.0)*2.0*k;
          vA = smoothstep(0.0, 0.06, k)*(1.0 - smoothstep(0.6, 1.0, k));
          vec4 mv = modelViewMatrix*vec4(p, 1.0); gl_Position = projectionMatrix*mv; gl_PointSize = (1.5 + aSeed*2.5)*(240.0/-mv.z); }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vec3(2.6, 0.95, 0.3)*a*vA, a*vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(eg, em); pts.frustumCulled = false; root.add(noReflect(pts));
    W.animated.push((t) => { em.uniforms.uTime.value = t; lavaM.uniforms.uTime.value = t; });
  }
  // ---- what lives here
  const foe = (u, v, t) => { const [x, z] = W2(u, v); HELL.enemies.push([x, z, t]); };
  foe(-26, 34, 'cinder'); foe(28, 26, 'cinder'); foe(-52, -8, 'demon'); foe(46, -14, 'hellArcher');
  foe(-22, -80, 'cinder'); foe(30, -84, 'demon'); foe(-64, -96, 'hellArcher'); foe(66, -70, 'cinder');
  HELL.feathers.push([lx + 40, lg + 2.5, lz - 30]);
  HELL.marks = [
    { x: lx, z: lz, r: 34, name: '墜落之地', en: 'WHERE THE FALL ENDS' },
    { x: ax, z: az, r: AR.r + 6, name: '守門者之環', en: "THE KEEPER'S RING" },
    { x: gx, z: gz + 6, r: 30, name: '冥門', en: 'THE GATE OF THE ABYSS' },
  ];
  root.visible = false;
}
export function hellRegion(x, z) {
  for (const m of HELL.marks) if (Math.hypot(x - m.x, z - m.z) < m.r) return [m.name, m.en];
  const u = x - HCX, v = z - HCZ;
  if (Math.abs(v - lavaV(u)) < 22) return ['熔河', 'THE BURNING RIVER'];
  return ['地獄 · 冥門前庭', 'THE ABYSSAL THRESHOLD'];
}
export const HELL_MAP = { lavaV, AR, GT, LP };
