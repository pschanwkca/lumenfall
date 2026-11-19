// LUMENFALL · the world: sky, island terrain, grass, mirror lake, ruins, sanctum, shrines, floating isles
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {
  TEX, grid, GN, SEG, CELL, HALF, WORLD, LAKE, TEMPLE, WINGP, SHRINES, SPAWN, PADS, edgeR,
  groundAt, maskAt, mulberry, smooth, lerp, clamp, fbm,
} from './core.js';
import { buildSeraph, SeraphRig, buildWing, makeHeroMats, bakeStatic, getFeatherGeo } from './hero.js';
import { installFog, installCloudShadows, CLOUD, terrainDetail, strataMaterial, rockGeo, leafTexture, canopyGeo, foliageMaterial, NOISE } from './env.js';

export const W = { shrines: [], islands: [], updrafts: [], feathers: [], animated: [] };
export const colliders = { solids: [], pads: [] };
export const COL = {
  hor: new THREE.Color('#ece6d8'),
  mid: new THREE.Color('#b9cde3'),
  zen: new THREE.Color('#5d86c2'),
};
export const FOG_DENSITY = 0.00165;
// 360° landmarks: north = Sanctum & halo, east = Fallen Wing, south = Heaven's Gate + sky falls, west = Elder Tree of Light
export const GATE = { x: 0, z: 196 };
export const ELDER = { x: -192, z: 66 };
export const FALLS = { x: 0, z: 340, y: 92, r: 30, h: 74 };
export const LANDMARKS = [
  { ...GATE, name: '天穹之門', en: "THE HEAVEN'S GATE", r: 30 },
  { ...ELDER, name: '光之古樹', en: 'THE ELDER TREE OF LIGHT', r: 34 },
];
const FORMATIONS = [
  { x: 104, z: 72, kind: 'arch', r: 18, rot: 0.6 },
  { x: -122, z: -38, kind: 'spires', r: 16 },
  { x: 62, z: -58, kind: 'stack', r: 12 },
  { x: -42, z: -104, kind: 'spires', r: 13 },
  { x: 130, z: 140, kind: 'stack', r: 14 },
  { x: -140, z: 140, kind: 'arch', r: 18, rot: 2.2 },
  { x: 40, z: -194, kind: 'spires', r: 14 },
  { x: 204, z: -8, kind: 'stack', r: 14 },
];
// sun sits right behind the great halo when seen from the spawn on the lake
export const HALO_POS = new THREE.Vector3(TEMPLE.x, PADS[0].h + 64, TEMPLE.z - 8);
export const sunDir = HALO_POS.clone().sub(new THREE.Vector3(SPAWN.x, 3, SPAWN.z)).normalize();

const GLSL_NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
float fb(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
`;

// ------------------------------------------------------------------ sky
export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uHor: { value: COL.hor }, uMid: { value: COL.mid }, uZen: { value: COL.zen }, uTime: { value: 0 }, uGlow: { value: 1 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uSun,uHor,uMid,uZen; uniform float uTime,uGlow; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.22, y));
        col = mix(col, uZen, smoothstep(0.16, 0.95, y));
        col = mix(col, vec3(0.6, 0.66, 0.77), smoothstep(0.0, -0.3, y));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0,0.84,0.6)*pow(s, 6.0)*0.2*uGlow;
        col += vec3(1.0,0.93,0.8)*pow(s, 80.0)*0.4*uGlow;
        col += vec3(1.0,0.97,0.9)*smoothstep(0.9991, 0.9996, s)*3.5;
        {
          vec2 hp = normalize(d.xz + vec2(1e-5))*3.4;
          float hb = fb(hp + vec2(y*6.0 + uTime*0.003, -y*4.0));
          float top = 0.05 + (hb - 0.45)*0.5;
          float prof = smoothstep(-0.03, 0.0, y)*(1.0 - smoothstep(top - 0.03, top + 0.01, y));
          float cm = smoothstep(0.44, 0.6, hb)*prof;
          float lit = smoothstep(-0.02, top + 0.02, y);
          vec3 cLit = mix(vec3(1.0,0.99,0.97), vec3(1.0,0.88,0.7), pow(s, 3.0));
          vec3 cSh = mix(vec3(0.74,0.79,0.88), vec3(0.86,0.8,0.78), pow(s, 2.0));
          col = mix(col, mix(cSh, cLit, lit*0.7 + 0.3*hb), cm*0.92);
        }
        if (y > 0.0) {
          vec2 uv = d.xz/(y+0.12)*0.9;
          float c = fb(uv*1.25 + vec2(uTime*0.006, uTime*0.0025));
          float m = smoothstep(0.5, 0.86, c)*smoothstep(0.0, 0.16, y)*(1.0-smoothstep(0.5, 0.95, y));
          vec3 cc = mix(vec3(1.0,0.995,0.985), vec3(1.0,0.92,0.78), pow(s, 4.0));
          col = mix(col, cc, m*0.6);
          float st = pow(n2(d.xz/(y+0.3)*140.0), 40.0)*smoothstep(0.35, 0.9, y);
          col += vec3(st)*0.6;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}

// ------------------------------------------------------------------ helpers
function mat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8 }, o)); }
function additive(color, o = {}) {
  return new THREE.MeshBasicMaterial(Object.assign({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }, o));
}
function beamMaterial(color, opacity, normal = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(vN, vV)), 1.6);
        float fade = smoothstep(0.0, 0.06, vUv.y)*(1.0 - smoothstep(0.35, 1.0, vUv.y));
        float flow = 0.8 + 0.2*sin(vUv.y*40.0 - uTime*3.0 + vUv.x*6.283);
        float a = f*fade*flow*uOpacity;
        ${normal ? 'gl_FragColor = vec4(uColor, a);' : 'gl_FragColor = vec4(uColor*a, 1.0);'} }`,
    transparent: true, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

// ------------------------------------------------------------------ build everything
export function buildWorld(scene, renderer, quality) {
  const R = mulberry(2026);
  installFog(sunDir); installCloudShadows(sunDir);
  W.scene = scene;

  // sky dome
  const skyMat = makeSkyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -1000; sky.frustumCulled = false;
  scene.add(sky);
  W.sky = sky; W.skyMat = skyMat;

  // environment map for metals
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial());
  envSky.material.depthTest = true;
  envScene.add(envSky);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.fog = new THREE.FogExp2(COL.hor.clone(), FOG_DENSITY);

  // lights
  const hemi = new THREE.HemisphereLight('#e6eefa', '#a3a77f', 0.68);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe7c2', 2.35);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
  sun.shadow.camera.layers.enable(2); // rocks & realm (kept out of the lake reflection) still cast shadows
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight('#e9efff', 0.55);
  fill.position.set(-0.35, 0.55, 1).normalize().multiplyScalar(100);
  scene.add(fill);
  W.sun = sun; W.hemi = hemi; W.fill = fill;

  buildTerrain(scene);
  buildCloudSea(scene);
  buildGrass(scene, quality);
  buildWater(scene, quality);
  const marble = new THREE.MeshStandardMaterial({ color: '#f1ede4', map: TEX.marble, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d7b468', metalness: 0.9, roughness: 0.3 });
  const goldGlow = new THREE.MeshStandardMaterial({ color: '#f3d796', emissive: '#ffd27a', emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.3 });
  W.mats = { marble, gold, goldGlow };
  buildTrees(scene, R);
  buildRuins(scene, R, marble, gold);
  buildTemple(scene, marble, gold, goldGlow);
  buildShrines(scene, marble, gold, goldGlow);
  buildFallenWing(scene, R, marble);
  buildIslands(scene, R, marble);
  buildRockFormations(scene, R);
  buildLandmarks(scene, R, marble, gold, goldGlow);
  buildRealm(scene, mulberry(4040), marble, gold, goldGlow);
  buildUpdrafts(scene);
  buildShafts(scene);
  buildDistant(scene, R, marble, gold);
  buildAmbient(scene);
  sanitizeNormals(scene);
  return W;
}

// layer 2: drawn by the main camera but skipped by the lake reflection
export function noReflect(o) { o.traverse((c) => c.layers.set(2)); return o; }

// zero-length normals turn into NaN pixels, and bloom smears NaN across the whole frame
export function sanitizeNormals(root) {
  const seen = new Set();
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || seen.has(g) || !g.attributes || !g.attributes.normal) return;
    seen.add(g);
    const n = g.attributes.normal;
    let fixed = false;
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = Math.hypot(x, y, z);
      if (!(l > 1e-4)) { n.setXYZ(i, 0, 1, 0); fixed = true; }
    }
    if (fixed) n.needsUpdate = true;
  });
}

// ------------------------------------------------------------------ terrain
function buildTerrain(scene) {
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, grid.h[i]);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 3);
  const cGrassLo = new THREE.Color('#58763c'), cGrassHi = new THREE.Color('#93a35a'), cGold = new THREE.Color('#bfa95a');
  const cSand = new THREE.Color('#c9bf9e'), cBed = new THREE.Color('#8ea9ab'), cRock = new THREE.Color('#a39b8c');
  const cCliff = new THREE.Color('#8d877f'), cDeep = new THREE.Color('#5d6070');
  const c = new THREE.Color(), t2 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = grid.h[i], ny = nrm.getY(i);
    const n = fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
    c.copy(cGrassLo).lerp(cGrassHi, clamp(smooth(2, 30, h) * 0.55 + n * 0.55, 0, 1));
    c.lerp(cGold, grid.flower[i] * 0.55);
    c.lerp(cSand, 1 - smooth(0.3, 2.2, h));
    if (h < 0.3) c.copy(cBed).lerp(cSand, smooth(-1.8, 0.3, h));
    c.lerp(cRock, smooth(0.86, 0.62, ny));
    if (h < -4) { t2.copy(cCliff).lerp(cDeep, smooth(-10, -60, h)); c.lerp(t2, smooth(-4, -12, h)); }
    // paved sanctum and shrine pads
    for (const p of PADS) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r0 + 2) c.lerp(cSand, smooth(p.r0 + 2, p.r0 - 2, d) * 0.6); }
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, terrainDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 })));
  m.receiveShadow = true;
  scene.add(m);
  W.terrain = m;

  // height texture for GPU grass (same grid)
  const data = new Uint16Array(GN * GN * 4);
  const H = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < GN * GN; i++) {
    data[i * 4] = H(grid.h[i]); data[i * 4 + 1] = H(grid.mask[i]); data[i * 4 + 2] = H(grid.flower[i]); data[i * 4 + 3] = H(0);
  }
  const tex = new THREE.DataTexture(data, GN, GN, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  W.heightTex = tex;
}

function buildCloudSea(scene) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHor: { value: COL.hor }, uSun: { value: sunDir } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uHor, uSun; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz*0.006;
        float c = fb(p + vec2(uTime*0.004, uTime*0.002));
        float c2 = fb(p*2.7 - vec2(uTime*0.006, 0.0));
        float d = smoothstep(0.3, 0.75, c*0.7 + c2*0.4);
        vec3 lo = vec3(0.62,0.69,0.82), hi = vec3(1.04,1.0,0.95);
        vec3 col = mix(lo, hi, d);
        float dist = length(vW.xz - cameraPosition.xz);
        col = mix(col, uHor, smoothstep(150.0, 1300.0, dist));
        if (!gl_FrontFacing) { if (d < 0.5) discard; col = mix(vec3(0.6, 0.64, 0.72), vec3(0.88, 0.88, 0.9), d); }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sea = new THREE.Mesh(new THREE.CircleGeometry(2600, 64), m);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -46;
  scene.add(sea);
  W.cloudMat = m;
}

// ------------------------------------------------------------------ grass & flowers (GPU, follows the player, wraps)
function tuftGeo(blades, hMin, hMax) {
  const R = mulberry(7);
  const pos = [], uv = [], idx = [];
  let vi = 0;
  for (let b = 0; b < blades; b++) {
    const ox = (R() - 0.5) * 0.42, oz = (R() - 0.5) * 0.42, a = R() * Math.PI * 2;
    const h = hMin + R() * (hMax - hMin), w = 0.026 + R() * 0.02, lean = 0.12 + R() * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[-w, 0, 0], [w, 0, 0], [-w * 0.62, h * 0.5, lean * 0.3 * h], [w * 0.62, h * 0.5, lean * 0.3 * h], [0, h, lean * h]];
    for (const [x, y, z] of pts) {
      pos.push(ox + x * ca + z * sa, y, oz - x * sa + z * ca);
      uv.push(x / w * 0.5 + 0.5, y / hMax);
    }
    idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2, vi + 2, vi + 3, vi + 4);
    vi += 5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function flowerGeo() {
  const pos = [], uv = [], col = [], idx = [];
  const stemH = 0.42;
  const push = (x, y, z, u, v, r, g, b) => { pos.push(x, y, z); uv.push(u, v); col.push(r, g, b); };
  // stem
  push(-0.008, 0, 0, 0, 0, 0.2, 0.32, 0.12); push(0.008, 0, 0, 1, 0, 0.2, 0.32, 0.12);
  push(-0.006, stemH, 0, 0, 1, 0.34, 0.48, 0.2); push(0.006, stemH, 0, 1, 1, 0.34, 0.48, 0.2);
  idx.push(0, 1, 2, 1, 3, 2);
  let vi = 4;
  const c = vi; push(0, stemH + 0.015, 0, 0.5, 1, 1.5, 1.25, 0.7); vi++;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = a0 + 0.38, a2 = a0 - 0.38;
    push(Math.cos(a1) * 0.06, stemH + 0.05, Math.sin(a1) * 0.06, 0.5, 1, 1.35, 1.33, 1.28);
    push(Math.cos(a0) * 0.1, stemH + 0.075, Math.sin(a0) * 0.1, 0.5, 1, 1.4, 1.38, 1.32);
    push(Math.cos(a2) * 0.06, stemH + 0.05, Math.sin(a2) * 0.06, 0.5, 1, 1.35, 1.33, 1.28);
    idx.push(c, vi, vi + 1, c, vi + 1, vi + 2);
    vi += 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function wrapInstanced(base, max, radius, seed) {
  const R = mulberry(seed);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = base.index;
  for (const k in base.attributes) ig.setAttribute(k, base.attributes[k]);
  const off = new Float32Array(max * 3), rnd = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) {
    off[i * 3] = (R() * 2 - 1) * radius; off[i * 3 + 1] = R() * 6.2832; off[i * 3 + 2] = (R() * 2 - 1) * radius;
    rnd[i * 2] = R(); rnd[i * 2 + 1] = 0.55 + R() * 0.65;
  }
  ig.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  ig.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 2));
  ig.instanceCount = max;
  return ig;
}
const GRASS_VS = (flower) => `
  #include <common>
  #include <fog_pars_vertex>
  uniform sampler2D uHeight; uniform vec3 uCenter; uniform vec3 uPlayer; uniform float uTime; uniform float uRadius; uniform float uBaseY; uniform vec3 uGrid; varying float vWheat;
  uniform sampler2D uBurn; uniform float uBurnOn; varying vec2 vBurn;
  attribute vec3 aOff; attribute vec2 aRnd; ${flower ? 'attribute vec3 aCol; varying vec3 vCol;' : ''}
  varying float vH; varying float vVar; varying vec3 vW; varying float vGust; varying float vPatch; varying float vCloud; uniform float uCloudT;
  ${NOISE}
  void main(){
    vec2 rel = mod(aOff.xz - uCenter.xz + uRadius, 2.0*uRadius) - uRadius;
    vec2 wxz = uCenter.xz + rel;
    vec2 huv = ((wxz + uGrid.x) * uGrid.y + 0.5) / uGrid.z; // half-size, cells per metre, grid points
    vec4 hm = texture2D(uHeight, huv);
    float fade = 1.0 - smoothstep(uRadius*0.6, uRadius*0.97, length(rel));
    ${flower ? 'float s = aRnd.y*0.9*fade*step(aRnd.x, hm.b*0.55)*step(0.5, hm.g);' : 'float s = aRnd.y*fade*smoothstep(0.3, 0.75, hm.g);'}
    vWheat = hm.a; ${flower ? '' : 's *= 1.0 + hm.a*0.9;'}
    vBurn = texture2D(uBurn, huv).rg*uBurnOn; // burnt (r) and burning (g): scorched stubble, flame-lit tips
    s *= 1.0 - vBurn.x*${flower ? '1.0' : '0.78'};
    float c = cos(aOff.y), sn = sin(aOff.y);
    vec3 p = position;
    p.xz = mat2(c, -sn, sn, c)*p.xz;
    p *= s;
    float bend = uv.y*uv.y;
    float gw = dot(wxz, vec2(0.83, 0.55));
    float gust = smoothstep(0.55, 1.0, sin(gw*0.11 - uTime*1.7 + sin(wxz.y*0.05)*2.0)*0.5 + 0.5);
    float w = sin(uTime*1.5 + wxz.x*0.17 + wxz.y*0.13)*0.6 + sin(uTime*2.6 + wxz.x*0.45 - wxz.y*0.31)*0.3;
    w += gust*1.6;
    p.x += w*0.2*bend*s; p.z += w*0.13*bend*s;
    vGust = gust; vPatch = en(wxz*0.035)*0.65 + en(wxz*0.09)*0.35;
    { vec2 cp = (wxz - vec2(${(sunDir.x / sunDir.y).toFixed(4)}, ${(sunDir.z / sunDir.y).toFixed(4)}) * hm.r)*0.0052 + vec2(uCloudT*0.011, uCloudT*0.0045);
      float cn = en(cp)*0.55 + en(cp*2.3 + 7.1)*0.3 + en(cp*5.1 - 3.7)*0.15; vCloud = mix(1.0, 0.42, smoothstep(0.47, 0.64, cn)); }
    vec2 d = wxz - uPlayer.xz; float pd = length(d);
    float push = (1.0 - smoothstep(0.2, 1.7, pd))*step(abs(uPlayer.y - hm.r - uBaseY), 1.8);
    p.xz += (d/(pd + 0.001))*push*bend*0.75*s;
    p.y -= push*bend*0.25*s;
    vec3 wp = vec3(wxz.x, hm.r + uBaseY, wxz.y) + p;
    vW = wp; vH = uv.y; vVar = aRnd.x; ${flower ? 'vCol = aCol;' : ''}
    vec4 mvPosition = viewMatrix*vec4(wp, 1.0);
    gl_Position = projectionMatrix*mvPosition;
    #include <fog_vertex>
  }`;
function buildGrass(scene, quality) {
  const radius = 30;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: null }, uCenter: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() },
    uTime: { value: 0 }, uRadius: { value: radius },
    uBase: { value: new THREE.Color('#3f5f2c') }, uTip: { value: new THREE.Color('#b8c770') },
    uGold: { value: new THREE.Color('#e6cf78') }, uSilver: { value: new THREE.Color('#d3e3a9') },
    uSunDir: { value: sunDir }, uLight: { value: 1.25 }, uCloudT: CLOUD, uBaseY: { value: 0 }, uWheat: { value: new THREE.Color('#d8b25a') },
    uGrid: { value: new THREE.Vector3(HALF, SEG / WORLD, GN) },
    uBurn: { value: null }, uBurnOn: { value: 0 },
  }]);
  { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; uniforms.uBurn.value = t; }
  uniforms.uHeight.value = W.heightTex;
  const grassMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GRASS_VS(false),
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uBase, uTip, uGold, uSilver, uSunDir, uWheat; uniform float uLight; uniform float uTime;
      varying float vH; varying float vVar; varying vec3 vW; varying float vGust; varying float vPatch; varying float vCloud; varying float vWheat; varying vec2 vBurn;
      void main(){
        float patchN = vPatch;
        vec3 tip = mix(uTip, uGold, smoothstep(0.72, 1.0, vVar) + smoothstep(0.62, 0.8, patchN)*0.6);
        tip = mix(tip, uSilver, smoothstep(0.28, 0.0, vVar));
        vec3 col = mix(uBase, tip, smoothstep(0.0, 0.95, vH));
        col = mix(col, mix(uWheat*0.55, uWheat*(1.0 + 0.25*vVar), vH), vWheat);
        col *= 0.82 + 0.3*patchN;
        vec3 V = normalize(vW - cameraPosition);
        float back = pow(max(dot(V, uSunDir), 0.0), 4.0);
        col += vec3(1.0, 0.86, 0.55)*back*vH*vH*0.9;
        col += vec3(0.95, 0.95, 0.75)*vGust*vH*vH*0.22;
        col *= uLight*(0.62 + 0.38*vH)*(0.55 + 0.45*vCloud);
        col = mix(col, vec3(0.13, 0.105, 0.09)*(0.7 + 0.6*vH), vBurn.x);
        col += vec3(1.7, 0.62, 0.16)*vBurn.y*smoothstep(0.25, 1.0, vH)*(0.55 + 0.45*sin(uTime*23.0 + vW.x*2.7 + vW.z*1.9));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
    fog: true, side: THREE.DoubleSide,
  });
  const grass = new THREE.Mesh(wrapInstanced(tuftGeo(6, 0.32, 0.78), 15000, radius, 11), grassMat);
  grass.frustumCulled = false; grass.layers.set(1);
  scene.add(grass);

  const fu = THREE.UniformsUtils.clone(uniforms);
  fu.uHeight.value = W.heightTex;
  fu.uCloudT = CLOUD; fu.uBaseY = uniforms.uBaseY; fu.uGrid = uniforms.uGrid; fu.uBurn = uniforms.uBurn; fu.uBurnOn = uniforms.uBurnOn;
  fu.uRadius.value = 34;
  const flowerMat = new THREE.ShaderMaterial({
    uniforms: fu,
    vertexShader: GRASS_VS(true),
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uLight; varying vec3 vCol; varying float vH;
      void main(){ gl_FragColor = vec4(vCol*uLight*0.9, 1.0);
        #include <fog_fragment>
      }`,
    fog: true, side: THREE.DoubleSide,
  });
  const flowers = new THREE.Mesh(wrapInstanced(flowerGeo(), 2600, 34, 23), flowerMat);
  flowers.frustumCulled = false; flowers.layers.set(1);
  scene.add(flowers);
  W.grass = grass; W.flowers = flowers; W.grassMats = [grassMat, flowerMat];
}

// ------------------------------------------------------------------ mirror lake
const WATER_FRAG = (refl) => `
  ${refl ? 'uniform sampler2D tDiffuse; varying vec4 vUv;' : ''}
  uniform float uTime, uFog; uniform vec3 uHor, uZen, uDeep, uSun;
  varying vec3 vW;
  void main(){
    vec2 p = vW.xz;
    float n1 = sin(p.x*0.33 + uTime*0.8)*sin(p.y*0.29 - uTime*0.6);
    float n2 = sin(p.x*1.4 - uTime*1.5 + p.y*0.9)*0.35 + sin(p.y*2.1 + uTime*1.9 - p.x*0.4)*0.2;
    vec2 dist = vec2(n1 + n2, n2 - n1*0.6)*0.006;
    vec3 V = normalize(cameraPosition - vW);
    float fres = 0.16 + 0.84*pow(1.0 - max(V.y, 0.0), 4.0);
    ${refl
      ? 'vec4 uv = vUv; uv.xy += dist*uv.w*1.6; vec3 refl = texture2DProj(tDiffuse, uv).rgb;'
      : 'vec3 R0 = reflect(-V, vec3(0.,1.,0.)); vec3 refl = mix(uHor, uZen, smoothstep(0.0, 0.8, R0.y)); refl += vec3(1.,.92,.75)*pow(max(dot(R0,uSun),0.),40.)*0.8;'}
    refl = min(refl, vec3(1.25));
    vec3 col = mix(uDeep, refl*0.94, 0.25 + 0.7*fres);
    vec3 N = normalize(vec3(dist.x*40.0, 1.0, dist.y*40.0));
    vec3 Rr = reflect(-V, N);
    float sp = pow(max(dot(Rr, uSun), 0.0), 220.0);
    vec2 cp = p*2.2; vec2 id = floor(cp); vec2 lc = fract(cp) - 0.5;
    float rnd = fract(sin(dot(id, vec2(12.9898,78.233)))*43758.5453);
    float dotm = smoothstep(0.09, 0.0, length(lc - (vec2(rnd, fract(rnd*7.31)) - 0.5)*0.6));
    float tw = 0.5 + 0.5*sin(uTime*2.6 + rnd*40.0);
    float glint = dotm*step(0.8, rnd)*tw*pow(max(dot(Rr, uSun), 0.0), 24.0)*(1.0 - smoothstep(0.35, 0.8, V.y));
    col += vec3(1.0, 0.94, 0.8)*(sp*0.8 + glint*3.5);
    float d = length(vW - cameraPosition);
    float f = 1.0 - exp(-uFog*uFog*d*d);
    col = mix(col, uHor, f);
    gl_FragColor = vec4(col, 1.0);
  }`;
function buildWater(scene, quality) {
  const uniforms = {
    color: { value: new THREE.Color(1, 1, 1) }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uTime: { value: 0 }, uFog: { value: FOG_DENSITY }, uHor: { value: COL.hor }, uZen: { value: COL.zen },
    uDeep: { value: new THREE.Color('#6f9fa6') }, uSun: { value: sunDir },
  };
  const geo = new THREE.CircleGeometry(LAKE.r * 1.32, 96);
  const reflector = new Reflector(geo, {
    clipBias: 0.003,
    textureWidth: 512, textureHeight: 256,
    shader: {
      name: 'HolyWater', uniforms,
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
        void main(){ vUv = textureMatrix*vec4(position,1.); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: WATER_FRAG(true),
    },
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.set(LAKE.x, 0, LAKE.z);
  scene.add(reflector);
  const simple = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(uniforms),
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: WATER_FRAG(false),
  }));
  simple.rotation.x = -Math.PI / 2;
  simple.position.copy(reflector.position);
  scene.add(simple);
  W.water = { reflector, simple };
}
export function setWaterQuality(q, w, h) {
  const r = W.water;
  r.reflector.visible = q.refl;
  r.simple.visible = !q.refl;
  if (q.refl) {
    const rt = r.reflector.getRenderTarget();
    rt.setSize(Math.max(256, Math.round(w * q.refScale)), Math.max(128, Math.round(h * q.refScale)));
  }
}

// ------------------------------------------------------------------ trees, rocks, crystals
function placeOK(x, z, minLake = 1.0) {
  const g = groundAt(x, z);
  if (g < 2.2) return false;
  if (Math.hypot(x - TEMPLE.x, z - TEMPLE.z) < 34) return false;
  for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 16) return false;
  if (Math.hypot(x - WINGP.x, z - WINGP.z) < 16) return false;
  if (Math.hypot(x - 176, z + 96) < 30) return false; // warden's arena
  if (Math.hypot(x - GATE.x, z - GATE.z) < 24) return false;
  if (Math.hypot(x - ELDER.x, z - ELDER.z) < 30) return false;
  for (const f of FORMATIONS) if (Math.hypot(x - f.x, z - f.z) < f.r) return false;
  if (Math.hypot(x, z) > edgeR(Math.atan2(z, x)) - 18) return false;
  if (Math.abs(x) < 9 && z < -40 && z > -125) return false; // processional path
  return true;
}
function buildTrees(scene, R) {
  const N = 82;
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.36, 1, 7, 3);
  trunkGeo.translate(0, 0.5, 0);
  const tp = trunkGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 3) * 0.08 * y); }
  trunkGeo.computeVertexNormals();
  // leaf-card canopies: soft volumetric crowns that catch the sun (BotW / MH meadow trees)
  const leafTex = leafTexture(); W.leafTex = leafTex;
  const cGeo = canopyGeo(36, 3);
  const trunkMat = mat('#d9d1c2', { roughness: 0.75 });
  const leafMat = foliageMaterial(leafTex);
  W.canopyGeo = cGeo;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const puffs = new THREE.InstancedMesh(cGeo, leafMat, N * 6);
  const palette = [
    ['#6f9447', 4], ['#86a651', 4], ['#5f8545', 3], ['#a2b45c', 2], ['#d2b552', 1], ['#9fbf6a', 1],
  ].flatMap(([c, w]) => Array(w).fill(new THREE.Color(c)));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tc = new THREE.Color();
  let n = 0, pi = 0, guard = 0;
  W.treeSpots = [];
  while (n < N && guard++ < 5000) {
    const x = (R() * 2 - 1) * 215, z = (R() * 2 - 1) * 215;
    if (!placeOK(x, z)) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 20) continue;
    if (W.treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 9)) continue;
    const g = groundAt(x, z), H = 6 + R() * 7;
    e.set((R() - 0.5) * 0.12, R() * 6.28, (R() - 0.5) * 0.12); q.setFromEuler(e);
    m4.compose(p.set(x, g - 0.3, z), q, s.set(1 + H * 0.05, H, 1 + H * 0.05));
    trunks.setMatrixAt(n, m4);
    const base = palette[Math.floor(R() * palette.length)];
    const pc = 3 + Math.floor(R() * 3), cs = 0.8 + H * 0.06;
    for (let k = 0; k < pc && pi < N * 6; k++) {
      const a = R() * 6.28, rr = k === 0 ? 0 : (1.3 + R() * 1.2) * cs;
      const sz = (k === 0 ? 3.1 : 2.0 + R() * 1.0) * cs;
      e.set((R() - 0.5) * 0.5, R() * 6, (R() - 0.5) * 0.5); q.setFromEuler(e);
      m4.compose(p.set(x + Math.cos(a) * rr, g + H - 0.6 + (k === 0 ? 0.9 : (R() - 0.5) * 1.8), z + Math.sin(a) * rr), q, s.set(sz, sz * (0.85 + R() * 0.2), sz));
      puffs.setMatrixAt(pi, m4);
      tc.copy(base).multiplyScalar(0.88 + R() * 0.24);
      puffs.setColorAt(pi, tc);
      pi++;
    }
    W.treeSpots.push({ x, z, top: g + H });
    colliders.solids.push({ x, z, r: 0.6, y0: g - 1, y1: g + H });
    n++;
  }
  trunks.count = n; puffs.count = pi;
  trunks.castShadow = true; puffs.castShadow = true; trunks.receiveShadow = true; puffs.receiveShadow = true;
  scene.add(trunks, puffs);

  // rocks
  W.rockMat = strataMaterial(0.9);
  const rocks = new THREE.InstancedMesh(rockGeo(5, 2), W.rockMat, 70);
  let rn = 0; guard = 0;
  while (rn < 70 && guard++ < 3000) {
    const x = (R() * 2 - 1) * 220, z = (R() * 2 - 1) * 220;
    if (!placeOK(x, z)) continue;
    const g = groundAt(x, z), sc = 0.6 + R() * 1.8;
    e.set(R(), R() * 6, R()); q.setFromEuler(e);
    m4.compose(p.set(x, g + sc * 0.15, z), q, s.set(sc * (1 + R()), sc * (0.6 + R() * 0.5), sc * (1 + R())));
    rocks.setMatrixAt(rn++, m4);
    if (sc > 1.4) colliders.solids.push({ x, z, r: sc * 1.1, y0: g - 1, y1: g + sc * 0.7 });
  }
  rocks.count = rn; rocks.castShadow = true; rocks.receiveShadow = true;
  scene.add(noReflect(rocks));

  // crystal clusters
  const crystalGeo = new THREE.OctahedronGeometry(1, 0);
  const crystalMat = new THREE.MeshStandardMaterial({ color: '#eef3fb', emissive: '#c8dcff', emissiveIntensity: 0.75, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.88 });
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, 140);
  W.crystalCount = 0; W.crystals = crystals;
  scene.add(noReflect(crystals));
  W.addCrystals = (cx, cz, count, spread, baseY) => {
    for (let k = 0; k < count && W.crystalCount < 140; k++) {
      const a = R() * 6.28, rr = (W.crystalMin || 0) + R() * spread;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const y = baseY ?? groundAt(x, z);
      if (baseY === undefined) colliders.solids.push({ x, z, r: 0.45, y0: y - 1, y1: y + 2.5 });
      const hgt = 0.5 + R() * 1.4;
      e.set((R() - 0.5) * 0.7, R() * 6, (R() - 0.5) * 0.7); q.setFromEuler(e);
      m4.compose(p.set(x, y + hgt * 0.5, z), q, s.set(0.28 + R() * 0.2, hgt, 0.28 + R() * 0.2));
      crystals.setMatrixAt(W.crystalCount++, m4);
    }
    crystals.count = W.crystalCount;
    crystals.instanceMatrix.needsUpdate = true;
  };
}

// ------------------------------------------------------------------ ruins
function columnGeo(H, broken, seed) {
  const R = mulberry(seed);
  const parts = [];
  const b1 = new THREE.BoxGeometry(1.7, 0.4, 1.7); b1.translate(0, 0.2, 0); parts.push(b1);
  const b2 = new THREE.CylinderGeometry(0.76, 0.82, 0.26, 20); b2.translate(0, 0.53, 0); parts.push(b2);
  const shH = broken ? H - 0.66 : H - 1.32;
  const sh = new THREE.CylinderGeometry(0.56, 0.64, shH, 20, broken ? 2 : 1);
  if (broken) {
    const p = sh.attributes.position;
    const jag = (a) => Math.sin(a * 3 + seed) * 0.35 + Math.sin(a * 7 + seed * 2) * 0.18 - 0.2;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > shH / 2 - 0.01) p.setY(i, p.getY(i) + jag(Math.atan2(p.getZ(i), p.getX(i))));
    sh.computeVertexNormals();
  }
  sh.translate(0, 0.66 + shH / 2, 0); parts.push(sh);
  if (!broken) {
    const c1 = new THREE.CylinderGeometry(0.82, 0.6, 0.32, 20); c1.translate(0, H - 0.5, 0);
    const c2 = new THREE.BoxGeometry(1.85, 0.36, 1.85); c2.translate(0, H - 0.18, 0);
    parts.push(c1, c2);
  }
  return mergeGeometries(parts);
}
function buildRuins(scene, R, marble, gold) {
  const clusters = [[-62, -70], [92, -112], [-176, -36], [134, 96], [-84, 150], [44, -92], [-30, 120], [200, 40]];
  const geos = [columnGeo(7, false, 1), columnGeo(4.2, true, 2), columnGeo(2.6, true, 3)];
  const counts = [0, 0, 0];
  const insts = geos.map((g) => new THREE.InstancedMesh(g, marble, 40));
  const segGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.6, 18); segGeo.rotateZ(Math.PI / 2);
  const segs = new THREE.InstancedMesh(segGeo, marble, 50); let sn = 0;
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const blocks = new THREE.InstancedMesh(blockGeo, marble, 40); let bn = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  W.ruinSpots = clusters.map(([x, z]) => ({ x, z }));
  for (const [cx, cz] of clusters) {
    const n = 3 + Math.floor(R() * 3), ang0 = R() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = ang0 + (k / n) * Math.PI * 1.4, rr = 4 + R() * 3;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, g = groundAt(x, z);
      const type = k === 0 ? 0 : R() < 0.5 ? 1 : 2;
      e.set((R() - 0.5) * 0.08, R() * 6, (R() - 0.5) * 0.08); q.setFromEuler(e);
      m4.compose(p.set(x, g - 0.25, z), q, s.set(1, 1, 1));
      insts[type].setMatrixAt(counts[type]++, m4);
      colliders.solids.push({ x, z, r: 0.95, y0: g - 1, y1: g + [7, 4.2, 2.6][type] });
    }
    for (let k = 0; k < 2; k++) {
      const x = cx + (R() - 0.5) * 12, z = cz + (R() - 0.5) * 12, g = groundAt(x, z);
      e.set(0, R() * 6, (R() - 0.5) * 0.2); q.setFromEuler(e);
      m4.compose(p.set(x, g + 0.4, z), q, s.set(1, 1, 1)); segs.setMatrixAt(sn++, m4);
    }
    for (let k = 0; k < 3; k++) {
      const x = cx + (R() - 0.5) * 14, z = cz + (R() - 0.5) * 14, g = groundAt(x, z), sz = 0.6 + R() * 0.9;
      e.set(R() * 0.4, R() * 6, R() * 0.4); q.setFromEuler(e);
      m4.compose(p.set(x, g + sz * 0.3, z), q, s.set(sz * 1.6, sz, sz * 1.1)); blocks.setMatrixAt(bn++, m4);
    }
  }
  insts.forEach((im, i) => { im.count = counts[i]; im.castShadow = im.receiveShadow = true; scene.add(noReflect(im)); });
  segs.count = sn; blocks.count = bn;
  segs.castShadow = blocks.castShadow = segs.receiveShadow = blocks.receiveShadow = true;
  scene.add(noReflect(segs), noReflect(blocks));

  // processional arches toward the sanctum
  const archParts = [];
  for (const sx of [-3.4, 3.4]) { const pl = new THREE.BoxGeometry(1.15, 8, 1.15); pl.translate(sx, 4, 0); archParts.push(pl); const ca = new THREE.BoxGeometry(1.5, 0.4, 1.5); ca.translate(sx, 8.1, 0); archParts.push(ca); const ba = new THREE.BoxGeometry(1.6, 0.5, 1.6); ba.translate(sx, 0.25, 0); archParts.push(ba); }
  const arc = new THREE.TorusGeometry(3.4, 0.55, 4, 28, Math.PI); arc.translate(0, 8.2, 0); archParts.push(arc);
  const archGeo = mergeGeometries(archParts.map((g) => g.toNonIndexed()));
  archGeo.computeVertexNormals();
  W.archSpots = [];
  for (const [x, z] of [[0, -58], [0, -84], [0, -110], [-14, 96]]) {
    const g = groundAt(x, z);
    const a = shadowy(new THREE.Mesh(archGeo, marble));
    a.position.set(x, g - 0.2, z);
    if (z > 0) a.rotation.y = 0.5;
    scene.add(a);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 40), W.mats.goldGlow);
    ring.position.set(0, 10.1, 0); a.add(ring);
    W.animated.push((t) => (ring.rotation.y = t * 0.6));
    for (const sx of [-3.4, 3.4]) {
      const c = Math.cos(a.rotation.y), sn2 = Math.sin(a.rotation.y);
      colliders.solids.push({ x: x + sx * c, z: z - sx * sn2, r: 0.85, y0: g - 1, y1: g + 8.5 });
    }
    W.archSpots.push({ x, z, g });
  }
}

// ------------------------------------------------------------------ sanctum (環光殿) + great halo
function buildTemple(scene, marble, gold, goldGlow) {
  const T = { x: TEMPLE.x, z: TEMPLE.z, y: PADS[0].h };
  const steps = [[20.5, 0.5], [18.5, 1.0], [16.6, 1.5]];
  for (const [r, top] of steps) {
    const st = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.5, 72), marble));
    st.position.set(T.x, T.y + top - 0.25, T.z); st.userData.templeStatic = true;
    scene.add(st);
    colliders.pads.push({ x: T.x, z: T.z, r, top: T.y + top, bot: -999 });
  }
  const floorY = T.y + 1.5;
  const inlay = new THREE.Mesh(new THREE.RingGeometry(9.6, 9.95, 96), gold);
  inlay.rotation.x = -Math.PI / 2; inlay.position.set(T.x, floorY + 0.012, T.z); scene.add(inlay);
  const glyph = new THREE.Mesh(new THREE.RingGeometry(3.6, 9.2, 96), additive(new THREE.Color(0.78, 0.58, 0.28), { map: TEX.rune, opacity: 0.75 }));
  glyph.rotation.x = -Math.PI / 2; glyph.position.set(T.x, floorY + 0.02, T.z); scene.add(glyph);
  W.templeGlyph = glyph;

  // columns
  const colFull = columnGeo(9, false, 11), colBroken = columnGeo(4.8, true, 12);
  const broken = new Set([2, 6, 9]);
  const N = 14, rr = 14;
  const intact = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    const x = T.x + Math.cos(a) * rr, z = T.z + Math.sin(a) * rr;
    const c = shadowy(new THREE.Mesh(broken.has(i) ? colBroken : colFull, marble));
    c.position.set(x, floorY, z); c.rotation.y = -a; c.userData.templeStatic = true;
    scene.add(c);
    colliders.solids.push({ x, z, r: 1.0, y0: floorY - 1, y1: floorY + 9 });
    if (!broken.has(i)) {
      intact.push(i);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 24), gold);
      band.rotation.x = Math.PI / 2; band.position.set(x, floorY + 7.6, z); band.userData.templeStatic = true; scene.add(band);
    } else {
      const seg = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.8, 18), marble));
      seg.rotation.set(0, a, Math.PI / 2); seg.position.set(x + Math.cos(a) * 3.8, floorY + 0.55, z + Math.sin(a) * 3.8);
      seg.userData.templeStatic = true; scene.add(seg);
    }
  }
  for (let i = 0; i < N; i++) { // lintels between intact neighbours
    const j = (i + 1) % N;
    if (broken.has(i) || broken.has(j)) continue;
    const a0 = (i / N) * Math.PI * 2 + Math.PI / N, a1 = (j / N) * Math.PI * 2 + Math.PI / N;
    const am = (a0 + (j === 0 ? a1 + Math.PI * 2 : a1)) / 2;
    const len = 2 * rr * Math.sin(Math.PI / N) + 1.8;
    const l = shadowy(new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 1.5), marble));
    l.position.set(T.x + Math.cos(am) * rr * Math.cos(Math.PI / N), floorY + 9.35, T.z + Math.sin(am) * rr * Math.cos(Math.PI / N));
    l.rotation.y = -am + Math.PI / 2; l.userData.templeStatic = true;
    scene.add(l);
  }

  // altar + sacred core
  for (const [r, h, y] of [[3.4, 0.6, 0], [2.4, 0.6, 0.6]]) {
    const s = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, h, 40), marble));
    s.position.set(T.x, floorY + y + h / 2, T.z); s.userData.templeStatic = true; scene.add(s);
    colliders.pads.push({ x: T.x, z: T.z, r, top: floorY + y + h, bot: -999 });
  }
  const coreMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1d0', emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.92 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), coreMat);
  core.scale.set(1, 1.6, 1);
  core.position.set(T.x, floorY + 3.4, T.z);
  scene.add(core);
  const sockets = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const gm = new THREE.MeshStandardMaterial({ color: '#cfc6b4', emissive: '#ffd98a', emissiveIntensity: 0, roughness: 0.3, metalness: 0.3 });
    const g = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), gm);
    g.position.set(T.x + Math.cos(a) * 1.9, floorY + 1.5, T.z + Math.sin(a) * 1.9);
    scene.add(g); sockets.push(g);
  }
  W.temple = { ...T, floorY, core, coreMat, sockets, altarTop: floorY + 1.2 };
  // bake the static architecture into a handful of meshes
  const arch = new THREE.Group(); scene.add(arch);
  for (const o of [...scene.children]) if (o.isMesh && o.userData.templeStatic) arch.attach(o);
  bakeStatic(arch);
  W.animated.push((t) => { core.rotation.y = t * 0.5; core.position.y = floorY + 3.4 + Math.sin(t * 1.2) * 0.25; sockets.forEach((s, i) => (s.rotation.y = t + i)); });

  // guardian statues — the seraph, carved in marble
  for (const sx of [-1, 1]) {
    const st = buildSeraph({ stone: true, noRibbons: true });
    const rig = new SeraphRig(st);
    for (let k = 0; k < 40; k++) rig.update(0.1, { mode: 'statue', speed: 0, grounded: true, vy: 0, cast: -1, dash: 0, hurt: 0 });
    st.root.scale.setScalar(4.4);
    st.root.position.set(T.x + sx * 8.2, floorY, T.z + 13.5);
    st.root.rotation.y = sx * 0.2;
    st.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    bakeStatic(st.root);
    scene.add(st.root);
    colliders.solids.push({ x: T.x + sx * 8.2, z: T.z + 13.5, r: 1.6, y0: floorY - 1, y1: floorY + 9 });
  }

  // the great halo in the sky
  const halo = new THREE.Group();
  halo.position.copy(HALO_POS);
  halo.lookAt(new THREE.Vector3(SPAWN.x, 3, SPAWN.z));
  const hMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.35), fog: false });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(26, 0.42, 10, 200), hMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(23.2, 0.12, 6, 200), hMat);
  const runes = new THREE.Mesh(new THREE.RingGeometry(27.6, 33.5, 160), additive(new THREE.Color(1.6, 1.25, 0.7), { map: TEX.rune, opacity: 0.85 }));
  const inner = new THREE.Mesh(new THREE.RingGeometry(14, 22.6, 128), additive(new THREE.Color(1.2, 0.95, 0.55), { map: TEX.rune, opacity: 0.35 }));
  halo.add(ring1, ring2, runes, inner);
  const sats = [];
  for (let i = 0; i < 12; i++) {
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), hMat);
    d.scale.set(0.6, 1.4, 0.6);
    halo.add(d); sats.push(d);
  }
  scene.add(halo);
  W.halo = { group: halo, hMat, runes, inner, sats, power: 1 };
  W.animated.push((t) => {
    runes.rotation.z = t * 0.02; inner.rotation.z = -t * 0.035; ring2.rotation.z = t * 0.05;
    sats.forEach((d, i) => { const a = (i / 12) * Math.PI * 2 + t * 0.06; d.position.set(Math.cos(a) * 36.5, Math.sin(a) * 36.5, 0); d.rotation.z = a; });
  });
}

// ------------------------------------------------------------------ shrines
function buildShrines(scene, marble, gold, goldGlow) {
  SHRINES.forEach((def, i) => {
    const pad = PADS[i + 1];
    const y0 = pad.h;
    const grp = new THREE.Group(); grp.position.set(def.x, y0, def.z); scene.add(grp);
    const steps = [[6.2, 0.45], [5.0, 0.9], [3.8, 1.35]];
    for (const [r, top] of steps) {
      const st = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, 0.45, 48), marble));
      st.position.y = top - 0.225; grp.add(st);
      colliders.pads.push({ x: def.x, z: def.z, r, top: y0 + top, bot: -999 });
    }
    const topY = 1.35;
    const spire = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.85, 8, 4, 1), marble));
    spire.rotation.y = Math.PI / 4; spire.position.y = topY + 4; grp.add(spire);
    const tipMat = new THREE.MeshStandardMaterial({ color: '#d9c39a', emissive: '#ffd98a', emissiveIntensity: 0.2, metalness: 0.7, roughness: 0.3 });
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), tipMat); tip.scale.y = 1.7; tip.position.y = topY + 8.8; grp.add(tip);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#cdb27a', emissive: '#ffd27a', emissiveIntensity: 0.0, metalness: 0.85, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.075, 8, 64), ringMat);
    ring.position.y = topY + 5.6; ring.rotation.x = Math.PI / 2 - 0.25; grp.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.04, 6, 48), ringMat);
    ring2.position.y = topY + 5.6; ring2.rotation.x = Math.PI / 2 + 0.35; grp.add(ring2);
    const glyphMat = additive(new THREE.Color(0.75, 0.56, 0.28), { map: TEX.rune, opacity: 0.35 });
    const glyph = new THREE.Mesh(new THREE.RingGeometry(1.2, 3.65, 64), glyphMat);
    glyph.rotation.x = -Math.PI / 2; glyph.position.y = topY + 0.02; grp.add(glyph);
    const stat = new THREE.Group(); grp.add(stat);
    for (const o of [...grp.children]) if (o.isMesh && o.material === marble) stat.attach(o);
    bakeStatic(stat);
    const beamMat = beamMaterial('#f4cf86', 0, true);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 220, 24, 1, true), beamMat);
    beam.position.y = topY + 110; beam.visible = false; grp.add(beam);
    colliders.solids.push({ x: def.x, z: def.z, r: 1.05, y0: y0, y1: y0 + 12 });
    W.crystalMin = 7.6; W.addCrystals(def.x, def.z, 7, 3.2); W.crystalMin = 0;
    W.shrines.push({ def, i, grp, y0, topY: y0 + topY, ring, ring2, ringMat, tipMat, glyph, glyphMat, beam, beamMat, lit: false, power: 0 });
  });
  W.animated.push((t, dt) => {
    for (const s of W.shrines) {
      const sp = s.lit ? 1.2 : 0.18;
      s.ring.rotation.z += dt * sp; s.ring2.rotation.z -= dt * sp * 1.4;
      s.power = lerp(s.power, s.lit ? 1 : 0, 1 - Math.exp(-dt * 1.5));
      s.ringMat.emissiveIntensity = s.power * 2.6;
      s.tipMat.emissiveIntensity = 0.2 + s.power * 3;
      s.glyphMat.opacity = 0.35 + s.power * 0.6;
      s.glyphMat.color.setRGB(0.75 + s.power * 1.2, 0.56 + s.power * 0.95, 0.28 + s.power * 0.5);
      s.beam.visible = s.power > 0.02;
      s.beamMat.uniforms.uOpacity.value = s.power * 0.75;
      s.beamMat.uniforms.uColor.value.setRGB(1.0 + s.power * 0.9, 0.82 + s.power * 0.6, 0.5 + s.power * 0.25);
      s.beamMat.uniforms.uTime.value = t;
    }
  });
}

// ------------------------------------------------------------------ the fallen wing (giant stone wing rising from the hill)
function buildFallenWing(scene, R, marble) {
  const M = makeHeroMats(true);
  const w = buildWing(M.feather, 1);
  w.feathers.forEach((f) => { f.castShadow = true; f.receiveShadow = true; });
  bakeStatic(w.plane);
  const g = groundAt(WINGP.x, WINGP.z);
  const holder = new THREE.Group();
  holder.position.set(WINGP.x, g - 3, WINGP.z);
  holder.rotation.set(0, -0.9, 0);
  w.root.rotation.set(-0.15, 0, 1.05);
  w.root.scale.setScalar(11);
  holder.add(w.root);
  scene.add(holder);
  colliders.solids.push({ x: WINGP.x, z: WINGP.z, r: 3.5, y0: g - 5, y1: g + 18 });
  W.addCrystals(WINGP.x + 6, WINGP.z + 4, 8, 7);
  for (let k = 0; k < 5; k++) { // broken stone feathers scattered at the base
    const sf = new THREE.Mesh(getFeatherGeo(), M.feather);
    const a = R() * 6.28, rr = 6 + R() * 8;
    const x = WINGP.x + Math.cos(a) * rr, z = WINGP.z + Math.sin(a) * rr;
    sf.position.set(x, groundAt(x, z) + 0.2, z);
    sf.rotation.set(-Math.PI / 2 + (R() - 0.5) * 0.4, 0, R() * 6.28);
    sf.scale.set(1.6, 4 + R() * 3, 1);
    sf.castShadow = true;
    scene.add(sf);
  }
}

// ------------------------------------------------------------------ floating isles
function islandMesh(r, h, seed, marble) {
  const R = mulberry(seed);
  const grp = new THREE.Group();
  const cone = new THREE.CylinderGeometry(r * 0.05, r, h, 11, 5);
  cone.rotateX(Math.PI);
  cone.translate(0, -h / 2, 0);
  let geo = cone.toNonIndexed();
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const top = new THREE.Color('#e6dfcf'), bot = new THREE.Color('#6f7a8e'), c = new THREE.Color();
  const jit = new Map();
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i), y = p.getY(i), z0 = p.getZ(i), f = clamp(-y / h, 0, 1);
    const key = `${x0.toFixed(3)},${y.toFixed(3)},${z0.toFixed(3)}`;
    if (!jit.has(key)) jit.set(key, [1 + (R() - 0.5) * 0.35 * (1 - f * 0.5), (R() - 0.5) * h * 0.05]);
    const [k, dy] = jit.get(key);
    if (y < -0.01 && f < 0.98) { p.setX(i, x0 * k); p.setZ(i, z0 * k); p.setY(i, y + dy); }
    c.copy(top).lerp(bot, Math.pow(f, 0.9));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  W.isleRock ||= strataMaterial(0.55, { vertexColors: true });
  const rock = new THREE.Mesh(geo, W.isleRock);
  rock.castShadow = true; rock.receiveShadow = true;
  grp.add(rock);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 0.97, 1.0, 22), new THREE.MeshStandardMaterial({ color: '#7f9c53', roughness: 0.95 }));
  lid.position.y = 0.5; lid.receiveShadow = true; lid.castShadow = true;
  grp.add(lid);
  const fringe = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.35, 6, 40), new THREE.MeshStandardMaterial({ color: '#6a8746', roughness: 1 }));
  fringe.rotation.x = Math.PI / 2; fringe.position.y = 0.95; grp.add(fringe);
  return grp;
}
function buildIslands(scene, R, marble) {
  const defs = [
    { x: 115, z: 40, y: 46, r: 9, h: 16, reach: true },
    { x: -78, z: -2, y: 44, r: 8, h: 15, reach: true },
    { x: -102, z: -64, y: 27, r: 7, h: 12, reach: true },
    { x: 36, z: -22, y: 58, r: 6, h: 11 },
  ];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R() * 0.4, d = 300 + R() * 220;
    defs.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 10 + R() * 80, r: 10 + R() * 20, h: 22 + R() * 30, far: true });
  }
  defs.forEach((d, i) => {
    const g = islandMesh(d.r, d.h, 100 + i, marble);
    g.position.set(d.x, d.y, d.z);
    scene.add(g);
    const isl = { ...d, grp: g, base: d.y, ph: R() * 6.28, top: d.y + 1.0 };
    if (d.far) bakeStatic(g);
    if (!d.far) {
      // a little life on top
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 4.5, 7), mat('#d9d1c2'));
      t.position.set(d.r * 0.3, 3.2, -d.r * 0.2); t.castShadow = true; g.add(t);
      W.isleLeaf ||= foliageMaterial(W.leafTex, { color: '#8fae58' });
      const crown = new THREE.Mesh(W.canopyGeo, W.isleLeaf);
      crown.position.set(d.r * 0.3, 6.2, -d.r * 0.2); crown.scale.setScalar(2.6); crown.castShadow = true; g.add(crown);
      for (let k = 0; k < 4; k++) {
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), W.crystals.material);
        const a = R() * 6.28; cr.position.set(Math.cos(a) * d.r * 0.6, 1.6, Math.sin(a) * d.r * 0.6);
        cr.scale.set(0.3, 1 + R() * 1.2, 0.3); cr.rotation.set(R() - 0.5, 0, R() - 0.5); g.add(cr);
      }
      bakeStatic(g);
      if (d.reach) {
        const pad = { x: d.x, z: d.z, r: d.r * 0.95, top: isl.top, bot: isl.top - 4, isl };
        pad.dyn = () => isl.top;
        colliders.pads.push(pad);
      }
    }
    W.islands.push(isl);
  });
  W.animated.push((t) => {
    for (const s of W.islands) {
      const y = s.base + Math.sin(t * 0.35 + s.ph) * (s.far ? 2 : 0.7);
      s.grp.position.y = y; s.top = y + 1.0;
      s.grp.rotation.y = s.far ? t * 0.01 : 0;
    }
  });
}

// ------------------------------------------------------------------ rock formations (MH-style landmarks between the ruins)
function buildRockFormations(scene, R) {
  const geos = [rockGeo(11, 2), rockGeo(23, 2)];
  const ims = geos.map((g) => new THREE.InstancedMesh(g, W.rockMat, 60));
  const cnt = [0, 0];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const put = (x, y, z, sx, sy, sz, rx = 0, ry = R() * 6.28, rz = 0) => {
    const k = R() < 0.5 ? 0 : 1;
    e.set(rx, ry, rz); q.setFromEuler(e);
    m4.compose(pv.set(x, y, z), q, sv.set(sx, sy, sz));
    ims[k].setMatrixAt(cnt[k]++, m4);
  };
  for (const f of FORMATIONS) {
    const g0 = groundAt(f.x, f.z);
    if (f.kind === 'spires') {
      const n = 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, rr = i === 0 ? 0 : 3 + R() * (f.r * 0.45);
        const x = f.x + Math.cos(a) * rr, z = f.z + Math.sin(a) * rr, g = groundAt(x, z);
        const sx = 2 + R() * 1.6, sy = (i === 0 ? 11 : 5 + R() * 6), sz = 2 + R() * 1.6;
        put(x, g + sy * 0.72, z, sx, sy, sz, (R() - 0.5) * 0.16, R() * 6.28, (R() - 0.5) * 0.16);
        colliders.solids.push({ x, z, r: Math.max(sx, sz) * 0.85, y0: g - 1, y1: g + sy * 1.65 });
      }
    } else if (f.kind === 'arch') {
      const dx = Math.cos(f.rot), dz = Math.sin(f.rot);
      for (const sgn of [-1, 1]) {
        const x = f.x + dx * 7 * sgn, z = f.z + dz * 7 * sgn, g = groundAt(x, z);
        put(x, g + 6, z, 2.8, 9.5, 2.8, -dz * 0.16 * sgn, R() * 6.28, dx * 0.16 * sgn);
        colliders.solids.push({ x, z, r: 2.6, y0: g - 1, y1: g + 15 });
      }
      put(f.x, g0 + 15.5, f.z, 10.5, 2.4, 3.4, 0, -f.rot, 0);
      put(f.x + dx * 2, g0 + 17.2, f.z + dz * 2, 4, 1.6, 2.6, 0, R() * 6.28, 0);
    } else {
      put(f.x, g0 + 1.2, f.z, 5.4, 3.6, 5.0);
      put(f.x + 1.2, g0 + 5.6, f.z - 0.8, 3.6, 2.6, 3.4);
      put(f.x + 0.4, g0 + 8.6, f.z - 0.2, 2.2, 1.9, 2.4);
      for (let i = 0; i < 4; i++) { const a = R() * 6.28, x = f.x + Math.cos(a) * 7.5, z = f.z + Math.sin(a) * 7.5; const sc = 0.8 + R() * 1.4; put(x, groundAt(x, z) + sc * 0.3, z, sc * 1.4, sc, sc * 1.3); }
      colliders.solids.push({ x: f.x, z: f.z, r: 5.2, y0: g0 - 1, y1: g0 + 10.5 });
    }
  }
  ims.forEach((im, k) => { im.count = cnt[k]; im.castShadow = true; im.receiveShadow = true; scene.add(noReflect(im)); });
}

// ------------------------------------------------------------------ 360° landmarks
function buildLandmarks(scene, R, marble, gold, goldGlow) {
  // ---- south: 天穹之門, a colossal ring-gate on the island's lip framing the sky falls beyond
  const gg = groundAt(GATE.x, GATE.z);
  const gate = new THREE.Group(); gate.position.set(GATE.x, gg, GATE.z);
  const col = columnGeo(26, false, 41);
  for (const sx of [-10.5, 10.5]) {
    const c = new THREE.Mesh(col, marble); c.scale.set(1.9, 1, 1.9); c.position.x = sx; gate.add(shadowy(c));
    colliders.solids.push({ x: GATE.x + sx, z: GATE.z, r: 1.9, y0: gg - 2, y1: gg + 27 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(27, 1.6, 3.6), marble); lintel.position.y = 26.6; gate.add(shadowy(lintel));
  const cap = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 4.2), gold); cap.position.y = 27.6; gate.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.2, 0.42, 10, 120), gold); ring.position.y = 14; gate.add(shadowy(ring));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(8.1, 0.11, 6, 120), goldGlow); ring2.position.y = 14; gate.add(ring2);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, L = i % 2 ? 1.2 : 2.6;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.14, L, 0.14), i % 2 ? gold : goldGlow);
    sp.position.set(Math.cos(a) * (9.7 + L / 2), 14 + Math.sin(a) * (9.7 + L / 2), 0); sp.rotation.z = a - Math.PI / 2; gate.add(sp);
  }
  for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(31 - i * 3.5, 0.7, 10 - i * 2.2), marble); st.position.y = -0.45 + i * 0.32; gate.add(shadowy(st)); }
  scene.add(gate); bakeStatic(gate);
  const veil = new THREE.Mesh(new THREE.CircleGeometry(8.0, 64), additive(new THREE.Color(0.5, 0.38, 0.2), { map: TEX.rune, opacity: 0.5 }));
  veil.position.set(GATE.x, gg + 14, GATE.z); scene.add(noReflect(veil));

  // ---- the sky falls: a great isle beyond the edge pouring a river into the cloud sea
  const isl = islandMesh(FALLS.r, FALLS.h, 777, marble);
  isl.position.set(FALLS.x, FALLS.y, FALLS.z);
  W.isleLeaf ||= foliageMaterial(W.leafTex, { color: '#8fae58' });
  for (let i = 0; i < 9; i++) {
    const a = R() * 6.28, rr = 8 + R() * 18, sz = 3 + R() * 3;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, sz * 2, 7), mat('#d9d1c2'));
    tr.position.set(Math.cos(a) * rr, sz, Math.sin(a) * rr + 6); isl.add(tr);
    const cr = new THREE.Mesh(W.canopyGeo, W.isleLeaf); cr.scale.setScalar(sz * 1.15);
    cr.position.set(tr.position.x, sz * 2.1, tr.position.z); isl.add(cr);
  }
  const shrineTop = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.2, 24), marble); shrineTop.position.set(0, 1.2, 6); isl.add(shrineTop);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.4, 16, 8), marble); spire.position.set(0, 9.6, 6); isl.add(spire);
  const spireRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.16, 6, 48), goldGlow); spireRing.position.set(0, 12, 6); spireRing.rotation.x = Math.PI / 2; isl.add(spireRing);
  scene.add(isl); bakeStatic(isl);
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uW: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime, uW; varying vec2 vUv; ${NOISE}
      void main(){
        float x = vUv.x, y = vUv.y;
        float edge = smoothstep(0.0, 0.16, x)*smoothstep(1.0, 0.84, x);
        float s1 = efb(vec2(x*6.0*uW, y*4.0 + uTime*1.1));
        float s2 = en(vec2(x*24.0*uW, y*16.0 + uTime*2.4));
        float body = smoothstep(0.3, 0.72, s1*0.85 + s2*0.35);
        float a = edge*(0.5 + 0.5*body);
        a *= smoothstep(0.0, 0.3, y)*(1.0 - smoothstep(0.985, 1.0, y)*0.6);
        vec3 c = mix(vec3(0.72,0.84,0.93), vec3(1.08,1.07,1.03), body);
        gl_FragColor = vec4(c, a*0.94);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const fallH = FALLS.y + 46 + 1;
  const mkFall = (t0, len, w) => {
    const m = fallMat.clone(); m.uniforms.uW.value = w;
    const f = new THREE.Mesh(new THREE.CylinderGeometry(FALLS.r * 1.03, FALLS.r * 1.03, fallH, 24, 1, true, t0, len), m);
    f.position.set(FALLS.x, FALLS.y + 0.7 - fallH / 2, FALLS.z); f.renderOrder = 2;
    scene.add(noReflect(f)); return m;
  };
  const fm = [mkFall(Math.PI - 0.24, 0.48, 1.0), mkFall(Math.PI + 0.42, 0.14, 0.4), mkFall(Math.PI - 0.6, 0.1, 0.35)];
  const mist = (x, y, z, sx, sy, o) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: '#ffffff', transparent: true, opacity: o, depthWrite: false, fog: false }));
    sp.position.set(x, y, z); sp.scale.set(sx, sy, 1); scene.add(noReflect(sp)); return sp;
  };
  const mists = [mist(0, -38, FALLS.z - FALLS.r, 110, 46, 0.95), mist(-8, -30, FALLS.z - FALLS.r - 6, 70, 30, 0.7), mist(0, FALLS.y - 1, FALLS.z - FALLS.r - 1, 30, 7, 0.55)];

  // ---- west: 光之古樹, the Elder Tree of Light — a white-barked giant with a crown of gold leaves
  const eg = groundAt(ELDER.x, ELDER.z);
  const tree = new THREE.Group(); tree.position.set(ELDER.x, eg - 0.5, ELDER.z);
  const bark = new THREE.MeshStandardMaterial({ color: '#d6cab2', map: TEX.marble, roughness: 0.7 });
  const tg = new THREE.CylinderGeometry(1.7, 3.2, 32, 20, 32); tg.translate(0, 16, 0);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
    const a = Math.atan2(z, x) + y * 0.07, r0 = Math.hypot(x, z);
    const r = r0 * (1 + 0.16 * Math.sin(a * 5 + y * 0.2)) * (1 + 1.5 * Math.exp(-y * 0.42));
    const bend = Math.sin(y * 0.09) * 1.4;
    tp.setXYZ(i, Math.cos(a) * r + bend, y, Math.sin(a) * r);
  }
  tg.computeVertexNormals();
  tree.add(shadowy(new THREE.Mesh(tg, bark)));
  const limb = (ox, oy, oz, len, rad, ax, az) => {
    const g = new THREE.CylinderGeometry(rad * 0.45, rad, len, 10, 4); g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, bark); m.position.set(ox, oy, oz); m.rotation.set(ax, 0, az); tree.add(shadowy(m)); return m;
  };
  for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + R() * 0.4; limb(Math.cos(a) * 3.6, 3.4, Math.sin(a) * 3.6, 7 + R() * 3, 1.5, Math.sin(a) * 1.95, -Math.cos(a) * 1.95); }
  const crowns = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.28 + R() * 0.5, len = 11 + R() * 5, y0 = 21 + R() * 6;
    limb(Math.cos(a) * 1, y0, Math.sin(a) * 1, len, 0.9, Math.sin(a) * 0.95, -Math.cos(a) * 0.95);
    crowns.push([Math.cos(a) * len * 0.8, y0 + len * 0.62, Math.sin(a) * len * 0.8, 6.5 + R() * 2.5]);
  }
  crowns.push([1.4, 36, 0, 10.5], [-3, 33, 4, 8], [3, 32, -4, 8]);
  const elderLeaf = foliageMaterial(W.leafTex, { color: '#f3e4b2', emissive: '#ffd98a', emissiveMap: W.leafTex, emissiveIntensity: 0.32 });
  for (const [x, y, z, sc] of crowns) { const c = new THREE.Mesh(W.canopyGeo, elderLeaf); c.position.set(x, y, z); c.scale.set(sc, sc * 0.82, sc); c.castShadow = true; tree.add(c); }
  const orbGeo = new THREE.IcosahedronGeometry(0.32, 1);
  for (let i = 0; i < 34; i++) {
    const [cx, cy, cz, sc] = crowns[i % crowns.length];
    const a = R() * 6.28, r = sc * (0.4 + R() * 0.5);
    const o = new THREE.Mesh(orbGeo, goldGlow); o.position.set(cx + Math.cos(a) * r, cy - sc * 0.55 - R() * 2.5, cz + Math.sin(a) * r); tree.add(o);
  }
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.8, 40), marble); dais.position.y = 0.2; tree.add(shadowy(dais));
  scene.add(tree); bakeStatic(tree);
  colliders.solids.push({ x: ELDER.x, z: ELDER.z, r: 6.2, y0: eg - 2, y1: eg + 3 }, { x: ELDER.x, z: ELDER.z, r: 3.8, y0: eg - 2, y1: eg + 34 });
  const halo = new THREE.Mesh(new THREE.RingGeometry(5.5, 11, 72), additive(new THREE.Color(0.75, 0.56, 0.26), { map: TEX.rune, opacity: 0.75 }));
  halo.rotation.x = -Math.PI / 2; halo.position.set(ELDER.x, eg + 0.72, ELDER.z); scene.add(halo);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 120, 24, 1, true), beamMaterial('#fff0c8', 0.09, true));
  shaft.position.set(ELDER.x, eg + 60, ELDER.z); scene.add(noReflect(shaft));
  W.elderShaft = shaft;

  W.animated.push((t) => {
    veil.rotation.z = t * 0.08; halo.rotation.z = -t * 0.05;
    for (const m of fm) m.uniforms.uTime.value = t;
    shaft.material.uniforms.uTime.value = t;
    mists[0].material.opacity = 0.85 + Math.sin(t * 0.7) * 0.1;
  });
}

// ------------------------------------------------------------------ organic floating rock
// a wobbly outline (sum of seeded sines), a grassy cap that rolls off at the lip, a short rock skirt
// and an irregular stalactite underside — no two alike, nothing that reads as a perfect disc
export function rfn(r, seed, amp = 1) {
  const R = mulberry(seed);
  const t = [[2, 0.13], [3, 0.1], [4, 0.05], [5, 0.05], [7, 0.03], [11, 0.015]].map(([k, a]) => [k, a * amp * (0.6 + R() * 0.8), R() * 6.283]);
  return (th) => { let v = 1; for (const [k, a, ph] of t) v += a * Math.sin(k * th + ph); return r * v; };
}
function rockBlob(cx, top, cz, rf, rMax, seed, o = {}) {
  const R = mulberry(seed);
  const S = o.seg || Math.max(16, Math.round(rMax * 2.2)), NR = o.rings || Math.max(2, Math.round(rMax / 3.2)), NU = o.under || 6;
  const depth = o.depth ?? rMax * 1.25 + 3, skirt = o.skirt ?? 1.6, grass = o.grass ?? 1;
  const pos = [], col = [], idx = [];
  const cG = new THREE.Color(o.grassCol || '#80a050'), cG2 = new THREE.Color('#a9b865'), cS = new THREE.Color('#d3cab6'), cS2 = new THREE.Color('#b8af9c'), cB = new THREE.Color('#78839a'), c = new THREE.Color();
  const dep = []; for (let k = 0; k < S; k++) dep.push(0.65 + R() * 0.7);
  const push = (x, y, z, cc) => { pos.push(x, y, z); col.push(cc.r, cc.g, cc.b); return pos.length / 3 - 1; };
  const center = push(cx, top + 0.1, cz, c.copy(cG).lerp(cG2, R() * 0.5).lerp(cS, 1 - grass));
  const ring = [];
  for (let i = 1; i <= NR; i++) {
    const f = i / NR, row = [];
    for (let k = 0; k < S; k++) {
      const th = (k / S) * Math.PI * 2, rr = rf(th) * f, x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      const y = top + (1 - f * f) * 0.1 + Math.sin(x * 0.7 + z * 0.5) * 0.05 - (f > 0.8 ? ((f - 0.8) / 0.2) * 0.4 : 0);
      const e = smooth(0.45, 1.0, f) * (0.6 + R() * 0.4);
      c.copy(cG).lerp(cG2, R() * 0.6).lerp(cS, Math.min(1, e * e * 1.2 + (1 - grass)));
      row.push(push(x, y, z, c));
    }
    ring.push(row);
  }
  for (let k = 0; k < S; k++) idx.push(center, ring[0][(k + 1) % S], ring[0][k]);
  for (let i = 1; i < NR; i++) for (let k = 0; k < S; k++) { const a = ring[i - 1][k], b = ring[i - 1][(k + 1) % S], cc = ring[i][k], d = ring[i][(k + 1) % S]; idx.push(a, b, cc, b, d, cc); }
  let prev = ring[NR - 1];
  const layers = [{ f: 1.03, y: -0.45 - skirt * 0.45 }, { f: 0.99, y: -0.45 - skirt }];
  for (let j = 1; j <= NU; j++) { const t = j / NU; layers.push({ f: (1 - Math.pow(t, 0.8)) * 0.93, t }); }
  for (const L of layers) {
    const row = [];
    for (let k = 0; k < S; k++) {
      const th = (k / S) * Math.PI * 2, rr = Math.max(0.05, rf(th) * L.f * (1 + (R() - 0.5) * 0.14));
      const y = top + (L.t ? -0.45 - skirt - depth * L.t * dep[k] : L.y);
      c.copy(cS).lerp(cS2, 0.5).lerp(cB, L.t ? Math.pow(L.t, 0.7) : 0).multiplyScalar(0.9 + R() * 0.18);
      row.push(push(cx + Math.cos(th) * rr, y, cz + Math.sin(th) * rr, c));
    }
    for (let k = 0; k < S; k++) { const a = prev[k], b = prev[(k + 1) % S], cc = row[k], d = row[(k + 1) % S]; idx.push(a, b, cc, b, d, cc); }
    prev = row;
  }
  const tip = push(cx + (R() - 0.5) * rMax * 0.25, top - 0.45 - skirt - depth * 1.12, cz + (R() - 0.5) * rMax * 0.25, cB);
  for (let k = 0; k < S; k++) idx.push(prev[k], prev[(k + 1) % S], tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ 天上神域 · the Empyrean: a realm of floating marble isles above the island
export const REALM = { x: 0, z: -130, y: 320, isles: [], bridges: [], feathers: [], enemies: [], stones: [] };
const REALM_ISLES = [
  { id: 'court', dx: 0, dz: 0, r: 34, top: 320, name: '穹頂聖庭', en: 'THE EMPYREAN COURT' },
  { id: 'garden', dx: -80, dz: 14, r: 17, top: 324, name: '金穗天園', en: 'THE GILDED GARDEN' },
  { id: 'pool', dx: 80, dz: 8, r: 16, top: 318, name: '星輝之池', en: 'THE STARLIT POOL' },
  { id: 'bell', dx: -60, dz: -74, r: 13, top: 332, name: '鳴鐘遺塔', en: 'THE SILENT BELFRY' },
  { id: 'archive', dx: 62, dz: -76, r: 14, top: 328, name: '天書閣', en: 'THE CELESTIAL ARCHIVE' },
  { id: 'arena', dx: 0, dz: -124, r: 26, top: 322, name: '審判之環', en: 'THE RING OF JUDGEMENT' },
  { id: 'summit', dx: 108, dz: -44, r: 8, top: 380, name: '星頂', en: 'THE ZENITH' },
  { id: 'perch', dx: 40, dz: -104, r: 5, top: 352, name: '孤羽石', en: 'THE LONE PERCH' },
  { id: 'vault', dx: -172, dz: -168, r: 9, top: 352, name: '星淵寶庫', en: 'THE STARDEEP VAULT', far: true },
  { id: 'spire', dx: 178, dz: -140, r: 7, top: 342, name: '審判尖塔', en: "THE ARBITER'S SPIRE", far: true },
];
const REALM_BRIDGES = [['court', 'garden'], ['court', 'pool'], ['court', 'arena'], ['garden', 'bell'], ['pool', 'archive']];
function realmCloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying float vSeed; varying float vY;
      void main(){
        vUv = uv;
        vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sc = length(instanceMatrix[0].xyz);
        vSeed = fract(c.x*0.137 + c.z*0.071);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = c + (right*position.x + up*position.y*0.62)*sc;
        vY = position.y;
        gl_Position = projectionMatrix*viewMatrix*vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vY; ${NOISE}
      void main(){
        vec2 q = vUv - 0.5;
        float n = efb(vUv*3.0 + vSeed*17.0 + uTime*0.02);
        float d = length(q*vec2(1.0, 1.25))*2.0 - (n - 0.5)*0.55;
        float a = smoothstep(1.0, 0.35, d);
        if (a < 0.01) discard;
        vec3 col = mix(vec3(0.76, 0.8, 0.9), vec3(1.05, 1.01, 0.95), smoothstep(-0.45, 0.35, vY) );
        gl_FragColor = vec4(col*(0.9 + 0.12*n), a*0.82);
      }`,
    transparent: true, depthWrite: false,
  });
}
function buildRealm(scene, R, marble, gold, goldGlow) {
  const C = REALM;
  marble = new THREE.MeshStandardMaterial({ color: '#ddd3bf', map: TEX.marble, roughness: 0.78, envMapIntensity: 0.7 });
  goldGlow = goldGlow.clone(); goldGlow.emissiveIntensity = 1.0;
  const isles = REALM_ISLES.map((d) => ({ ...d, x: C.x + d.dx, z: C.z + d.dz }));
  C.isles = isles;
  const by = Object.fromEntries(isles.map((i) => [i.id, i]));
  const root = new THREE.Group();
  const anim = new THREE.Group();
  const deco = (m) => { root.add(m); return m; };
  const puffs = [];
  const rockMat = terrainDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  W.realmRock = rockMat;
  C.blobs = [];
  const blob = (x, top, z, r, seed, o = {}) => {
    const rf = rfn(r, seed, o.amp ?? 1);
    const m = new THREE.Mesh(rockBlob(x, top, z, rf, r * 1.35, seed + 7, o), rockMat);
    m.castShadow = m.receiveShadow = true; root.add(m);
    colliders.pads.push({ x, z, r: r * 1.4, rf: (th) => rf(th) * 0.95, top, bot: top - 3 });
    C.blobs.push({ x, z, r, rf, top, small: !!o.small });
    return rf;
  };
  isles.forEach((I, k) => {
    I.lr = I.r * 0.62 + 1.4;
    blob(I.x, I.top, I.z, I.r * 0.8, 500 + k * 13, { depth: I.r * 1.2 + 4, grass: I.id === 'arena' || I.id === 'summit' ? 0.35 : 1 });
    const lobes = I.r > 20 ? 3 : I.r > 9 ? 2 : 1;
    for (let j = 0; j < lobes; j++) {
      const a = R() * 6.28, d = I.r * (0.45 + R() * 0.2), r = I.r * (0.32 + R() * 0.2);
      blob(I.x + Math.cos(a) * d, I.top + (R() < 0.5 ? -1 : 1) * (0.25 + R() * 0.38), I.z + Math.sin(a) * d, r, 600 + k * 31 + j, { depth: r * 1.5 + 3 });
    }
    const np = Math.round(4 + I.r * 0.35);
    for (let i = 0; i < np; i++) {
      const a = R() * 6.28, rr = I.r * (0.4 + R() * 0.75), sc = I.r * (0.7 + R() * 0.6);
      puffs.push([I.x + Math.cos(a) * rr, I.top - 4 - sc * 0.4 - R() * I.r * 0.5, I.z + Math.sin(a) * rr, sc]);
    }
  });
  // ---- court: colonnade, colossal seraph, the halos, the gate home
  const Ct = by.court;
  const col = columnGeo(9, false, 51), colB = columnGeo(4.6, true, 52);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + (R() - 0.5) * 0.35, rr = Ct.r * (0.5 + R() * 0.18);
    if (Math.abs(Math.cos(a)) < 0.2 || Math.abs(Math.sin(a) - 1) < 0.25) continue;
    const x = Ct.x + Math.cos(a) * rr, z = Ct.z + Math.sin(a) * rr;
    const fallen = R() < 0.25, c = deco(shadowy(new THREE.Mesh(fallen || R() < 0.45 ? colB : col, marble)));
    c.scale.setScalar(1.05 + R() * 0.3);
    if (fallen) { c.rotation.set(Math.PI / 2 - 0.08, R() * 6.28, 0, 'YXZ'); c.position.set(x, Ct.top + 0.7, z); }
    else { c.position.set(x, Ct.top - 0.3, z); c.rotation.set((R() - 0.5) * 0.08, R() * 6.28, (R() - 0.5) * 0.08); colliders.solids.push({ x, z, r: 1.15, y0: Ct.top - 1, y1: Ct.top + 12 }); }
  }
  {
    const st = buildSeraph({ stone: true, noRibbons: true });
    const rig = new SeraphRig(st);
    for (let k = 0; k < 40; k++) rig.update(0.1, { mode: 'statue', speed: 0, grounded: true, vy: 0, cast: -1, dash: 0, hurt: 0 });
    st.root.scale.setScalar(7.5);
    st.root.position.set(Ct.x, Ct.top + 2.2, Ct.z - 17);
    st.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bakeStatic(st.root); scene.add(st.root);
    const plinth = deco(shadowy(new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 2.2, 32), marble))); plinth.position.set(Ct.x, Ct.top + 1.1, Ct.z - 17);
    colliders.solids.push({ x: Ct.x, z: Ct.z - 17, r: 5.2, y0: Ct.top - 1, y1: Ct.top + 16 });
  }
  const halos = [];
  [[15, 0.32], [21, 0.22], [27, 0.16]].forEach(([r, t], i) => {
    const h = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 160), i === 1 ? goldGlow : gold);
    h.position.set(Ct.x, Ct.top + 34, Ct.z - 6); anim.add(h); halos.push(h);
  });
  {
    const gz = Ct.z + 20;
    for (const sx of [-4.2, 4.2]) {
      const c = deco(shadowy(new THREE.Mesh(columnGeo(8, false, 61), marble))); c.position.set(Ct.x + sx, Ct.top, gz);
      colliders.solids.push({ x: Ct.x + sx, z: gz, r: 1.0, y0: Ct.top - 1, y1: Ct.top + 9 });
    }
    const ring = deco(new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.2, 8, 72), gold)); ring.position.set(Ct.x, Ct.top + 5.2, gz);
    const veil = new THREE.Mesh(new THREE.CircleGeometry(3.25, 48), additive(new THREE.Color(0.55, 0.42, 0.22), { map: TEX.rune, opacity: 0.8 }));
    veil.position.set(Ct.x, Ct.top + 5.2, gz); anim.add(veil); halos.push(veil);
    C.gate = new THREE.Vector3(Ct.x, Ct.top, gz);
  }
  C.landing = new THREE.Vector3(Ct.x, Ct.top, Ct.z + 8);
  const pave = (cx, cz, top, rad, n) => {
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, rr = Math.sqrt(R()) * rad, w = 1.4 + R() * 2.2, d = 1.2 + R() * 1.8;
      const sl = deco(new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), marble));
      sl.position.set(cx + Math.cos(a) * rr, top - 0.08 + R() * 0.06, cz + Math.sin(a) * rr); sl.rotation.set((R() - 0.5) * 0.05, R() * 6.28, (R() - 0.5) * 0.05); sl.receiveShadow = true;
    }
  };
  pave(Ct.x, Ct.z - 4, Ct.top, 15, 34);
  // ---- garden: golden trees on a meadow lid
  {
    const G0 = by.garden;
    const leaf = foliageMaterial(W.leafTex, { color: '#e8cf72' });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28 + R() * 0.5, rr = 5 + R() * (G0.r - 8), x = G0.x + Math.cos(a) * rr, z = G0.z + Math.sin(a) * rr, H = 4 + R() * 3;
      const t = deco(shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, H, 7), mat('#d9d1c2')))); t.position.set(x, G0.top + H / 2, z);
      const c = deco(new THREE.Mesh(W.canopyGeo, leaf)); c.scale.setScalar(2.2 + R()); c.position.set(x, G0.top + H + 0.6, z); c.castShadow = true;
      colliders.solids.push({ x, z, r: 0.5, y0: G0.top - 1, y1: G0.top + H });
    }
    C.enemies.push([G0.x - 4, G0.top, G0.z + 5, 'guard', G0], [G0.x + 5, G0.top, G0.z - 4, 'melee', G0], [G0.x + 2, G0.top, G0.z + 10, 'archer', G0]);
  }
  // ---- starlit pool: a mirror disc, crystals and a rising wind to the zenith
  {
    const P0 = by.pool;
    const pool = deco(new THREE.Mesh(new THREE.CircleGeometry(P0.r * 0.55, 64), new THREE.MeshStandardMaterial({ color: '#d6ecff', metalness: 1, roughness: 0.06 })));
    pool.rotation.x = -Math.PI / 2; pool.position.set(P0.x, P0.top + 0.04, P0.z);
    const lip = deco(new THREE.Mesh(new THREE.TorusGeometry(P0.r * 0.56, 0.18, 6, 80), goldGlow)); lip.rotation.x = Math.PI / 2; lip.position.set(P0.x, P0.top + 0.08, P0.z);
    W.crystalMin = P0.r * 0.42; W.addCrystals(P0.x, P0.z, 10, P0.r * 0.16, P0.top); W.crystalMin = 0;
    C.enemies.push([P0.x - 6, P0.top, P0.z - 6, 'melee', P0], [P0.x + 6, P0.top, P0.z + 5, 'caster', P0]);
    const S0 = by.summit, dx = S0.x - P0.x, dz = S0.z - P0.z, dd = Math.hypot(dx, dz);
    const ux = P0.x + (dx / dd) * 9, uz = P0.z + (dz / dd) * 9, top = S0.top + 7, h = top - P0.top;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float s = fract(vUv.y*9.0 - uTime*0.5 + sin(vUv.x*25.0)*0.08);
          float streak = smoothstep(0.0, 0.08, s)*(1.0 - smoothstep(0.12, 0.5, s));
          float lines = 0.5 + 0.5*sin(vUv.x*6.283*9.0);
          float fade = smoothstep(0.0, 0.06, vUv.y)*(1.0 - smoothstep(0.75, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(1.25, 0.95, 0.5), streak*(0.4 + 0.6*lines)*fade*0.55); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const colm = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, h, 32, 1, true), m);
    colm.position.set(ux, P0.top + h / 2, uz); scene.add(noReflect(colm));
    const base = new THREE.Mesh(new THREE.RingGeometry(1.5, 4.6, 64), additive(new THREE.Color(0.85, 0.62, 0.3), { map: TEX.rune, opacity: 0.8 }));
    base.rotation.x = -Math.PI / 2; base.position.set(ux, P0.top + 0.1, uz); scene.add(base);
    W.updrafts.push({ x: ux, z: uz, top, g: P0.top, mat: m, base, realm: true });
  }
  // ---- silent belfry: a broken tower with a great golden bell
  {
    const B0 = by.bell, H = 19;
    for (const [sx, sz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const pl = deco(shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.3, H - (sx > 0 && sz > 0 ? 5 : 0), 1.3), marble)));
      pl.position.set(B0.x + sx, B0.top + (H - (sx > 0 && sz > 0 ? 5 : 0)) / 2, B0.z + sz);
      colliders.solids.push({ x: B0.x + sx, z: B0.z + sz, r: 0.9, y0: B0.top - 1, y1: B0.top + H });
    }
    for (const y of [6, 12]) { const b = deco(shadowy(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.6, 7.4), marble))); b.position.set(B0.x, B0.top + y, B0.z); b.scale.set(1, 1, 1); }
    const capg = deco(shadowy(new THREE.Mesh(new THREE.ConeGeometry(5.4, 4, 4), marble))); capg.position.set(B0.x - 0.6, B0.top + H + 1.6, B0.z - 0.6); capg.rotation.set(0.12, Math.PI / 4, 0.06);
    const bellG = new THREE.LatheGeometry([[0, 0], [1.9, 0.1], [1.75, 0.6], [1.25, 1.6], [1.05, 2.6], [0.6, 3.0], [0, 3.05]].map(([x, y]) => new THREE.Vector2(x, y)), 32);
    const bell = deco(shadowy(new THREE.Mesh(bellG, gold))); bell.position.set(B0.x, B0.top + 13.6, B0.z);
    C.enemies.push([B0.x - 7, B0.top, B0.z + 4, 'guard', B0], [B0.x + 6, B0.top, B0.z - 6, 'archer', B0]);
  }
  // ---- celestial archive: standing tablets of light
  {
    const A0 = by.archive;
    const runeMat = additive(new THREE.Color(0.75, 0.56, 0.28), { map: TEX.rune, opacity: 0.85 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28 + 0.2, x = A0.x + Math.cos(a) * 8.6, z = A0.z + Math.sin(a) * 8.6, h = 4.5 + R() * 3.5;
      const tb = deco(shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.8, h, 0.7), marble)));
      tb.position.set(x, A0.top + h / 2 - 0.3, z); tb.rotation.set((R() - 0.5) * 0.12, -a + Math.PI / 2, (R() - 0.5) * 0.1);
      const rn = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), runeMat);
      rn.position.set(x - Math.cos(a) * 0.37, A0.top + h * 0.6, z - Math.sin(a) * 0.37); rn.rotation.y = -a - Math.PI / 2; anim.add(rn);
      colliders.solids.push({ x, z, r: 1.4, y0: A0.top - 1, y1: A0.top + h });
    }
    const lect = deco(shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 1.4, 16), marble))); lect.position.set(A0.x, A0.top + 0.7, A0.z);
    const book = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.0), goldGlow); book.position.set(A0.x, A0.top + 2.1, A0.z); anim.add(book); halos.push(book);
    colliders.solids.push({ x: A0.x, z: A0.z, r: 1.1, y0: A0.top - 1, y1: A0.top + 2.5 });
    C.enemies.push([A0.x - 3, A0.top, A0.z + 3, 'melee', A0], [A0.x + 4, A0.top, A0.z - 2, 'guard', A0], [A0.x, A0.top, A0.z - 6, 'caster', A0]);
  }
  // ---- ring of judgement: the arena
  {
    const J = by.arena;
    for (let i = 0; i < 26; i++) {
      if (R() < 0.22) continue;
      const a = (i / 26) * 6.28 + (R() - 0.5) * 0.08, rr = 12.5 + (R() - 0.5) * 1.2;
      const sl = deco(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 2.6 + R() * 0.6), marble));
      sl.position.set(J.x + Math.cos(a) * rr, J.top - 0.06, J.z + Math.sin(a) * rr); sl.rotation.y = -a; sl.receiveShadow = true;
    }
    pave(J.x, J.z, J.top, 7, 14);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28 + R() * 0.5; if (Math.abs(Math.sin(a) - 1) < 0.35) continue;
      const rr = J.r * (0.64 + R() * 0.1), x = J.x + Math.cos(a) * rr, z = J.z + Math.sin(a) * rr;
      const c = deco(shadowy(new THREE.Mesh(R() < 0.55 ? colB : col, marble))); c.scale.setScalar(1.0 + R() * 0.3);
      c.position.set(x, J.top - 0.4, z); c.rotation.set((R() - 0.5) * 0.18, R() * 6.28, (R() - 0.5) * 0.18);
      colliders.solids.push({ x, z, r: 1.05, y0: J.top - 1, y1: J.top + 11 });
    }
    C.bossHome = new THREE.Vector3(J.x, J.top, J.z - 2);
  }
  // ---- zenith & lone perch
  {
    const S0 = by.summit;
    const ob = deco(shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 6), marble))); ob.position.set(S0.x, S0.top + 4.5, S0.z - 3);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.1, 6, 40), goldGlow); ring.position.set(S0.x, S0.top + 7.2, S0.z - 3); ring.rotation.x = Math.PI / 2; anim.add(ring); halos.push(ring);
    colliders.solids.push({ x: S0.x, z: S0.z - 3, r: 1.0, y0: S0.top - 1, y1: S0.top + 9 });
  }
  // ---- winding causeways of floating stones (instead of straight bridges)
  const causeway = (A, B, k, gapless = true) => {
    const dx = B.x - A.x, dz = B.z - A.z, D = Math.hypot(dx, dz), ux = dx / D, uz = dz / D;
    const sx = A.x + ux * A.r * 0.55, sz = A.z + uz * A.r * 0.55, ex = B.x - ux * B.r * 0.55, ez = B.z - uz * B.r * 0.55;
    const L = Math.hypot(ex - sx, ez - sz), bend = (R() < 0.5 ? -1 : 1) * L * (0.12 + R() * 0.12);
    const mx = (sx + ex) / 2 - uz * bend, mz = (sz + ez) / 2 + ux * bend;
    const at = (t) => [(1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * ex, (1 - t) * (1 - t) * sz + 2 * (1 - t) * t * mz + t * t * ez];
    const n = Math.ceil(L / (gapless ? 2.5 : 6.2));
    for (let i = 1; i < n; i++) {
      const t = i / n, [x, z] = at(t), r = gapless ? 2.2 + R() * 0.9 : 2.3 + R() * 0.5;
      blob(x + (R() - 0.5) * 0.8, lerp(A.top, B.top, t) + (R() - 0.5) * 0.3 + (gapless ? 0 : 0.8), z + (R() - 0.5) * 0.8, r, 900 + k * 97 + i, { small: true, depth: (r * 0.55 + 0.4) * (0.5 + R() * 1.1), skirt: 0.6 + R() * 0.6, seg: 13, rings: 2, under: 3, grass: 0.5 + R() * 0.3, amp: 1.5 });
    }
    const [hx, hz] = at(0.5);
    return { a: A.id, b: B.id, mx: hx, mz: hz, my: (A.top + B.top) / 2 };
  };
  // no paths between the isles — the seraph flies. A few lone stones drift in the gaps as resting perches.
  REALM_BRIDGES.forEach(([a, b]) => {
    const A = by[a], B = by[b];
    const t = 0.5, bend = (R() < 0.5 ? -1 : 1) * 10, dx = B.x - A.x, dz = B.z - A.z, D = Math.hypot(dx, dz);
    C.bridges.push({ a, b, mx: A.x + dx * t - (dz / D) * bend, mz: A.z + dz * t + (dx / D) * bend, my: (A.top + B.top) / 2 + 5 });
  });
  const lone = [[-40, 14, 318], [44, -2, 322], [-30, -40, 327], [30, -96, 335], [-34, -102, 326], [86, -60, 346], [-104, -30, 330], [96, 40, 312]];
  lone.forEach(([dx, dz, top], i) => { const r = 3 + R() * 2.5; blob(C.x + dx, top, C.z + dz, r, 1200 + i * 17, { small: true, depth: r * 1.6 + 2, skirt: 1.0, grass: 0.7, amp: 1.4 }); C.stones.push({ x: C.x + dx, z: C.z + dz, top }); });

  // ---- drifting rocks & cloud nests
  const rocks = new THREE.InstancedMesh(rockGeo(71, 2), W.rockMat, 26);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.28, rr = 70 + R() * 130, y = 285 + R() * 90, sc = 1.5 + R() * 4.5;
    e.set(R(), R() * 6, R()); q.setFromEuler(e);
    rocks.setMatrixAt(i, m4.compose(pv.set(C.x + Math.cos(a) * rr, y, C.z + Math.sin(a) * rr), q, sv.set(sc, sc * 0.7, sc)));
  }
  rocks.castShadow = true; scene.add(noReflect(rocks));
  for (let i = 0; i < 26; i++) { const a = R() * 6.28, rr = 150 + R() * 120; puffs.push([C.x + Math.cos(a) * rr, 250 + R() * 40, C.z + Math.sin(a) * rr, 26 + R() * 30]); }
  const cloudMat = realmCloudMaterial();
  const cl = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, puffs.length);
  puffs.forEach(([x, y, z, s2], i) => cl.setMatrixAt(i, m4.compose(pv.set(x, y, z), q.identity(), sv.set(s2, s2, s2))));
  cl.frustumCulled = false; cl.renderOrder = 4;
  scene.add(noReflect(cl));
  // a cloud deck between the worlds: thick beneath the realm, thinning toward the horizon
  const deckCloud = new THREE.Mesh(new THREE.CircleGeometry(640, 72), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uC: { value: new THREE.Vector2(C.x, C.z) } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform vec2 uC; varying vec3 vW; ${NOISE}
      void main(){
        vec2 p = vW.xz; float d = length(p - uC);
        float n = efb(p*0.011 + vec2(uTime*0.004, uTime*0.002))*0.78 + en(p*0.045 - uTime*0.01)*0.22;
        float cover = mix(0.4, 0.64, smoothstep(110.0, 480.0, d));
        float a = smoothstep(cover, cover + 0.15, n)*(1.0 - smoothstep(400.0, 630.0, d));
        if (a < 0.01) discard;
        vec3 col = gl_FrontFacing ? vec3(1.04, 1.0, 0.95) : vec3(0.8, 0.84, 0.92);
        gl_FragColor = vec4(col*(0.84 + 0.18*n), a*0.88);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  deckCloud.rotation.x = -Math.PI / 2; deckCloud.position.set(C.x, 232, C.z); deckCloud.renderOrder = 3;
  scene.add(noReflect(deckCloud));
  // god rays through the realm
  const shaft = beamMaterial('#fff3d6', 0.06);
  for (const [dx, dz, r] of [[-30, 20, 10], [40, -40, 12], [-70, -60, 9], [90, 20, 8]]) {
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), shaft);
    s2.scale.set(r, 180, r); s2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
    s2.position.set(C.x + dx, 300, C.z + dz).addScaledVector(sunDir, 90); scene.add(noReflect(s2));
  }
  scene.add(root); bakeStatic(root); noReflect(root);
  scene.add(noReflect(anim));
  // feathers of the realm
  const F = C.feathers, lift = 1.6;
  C.extraFeathers = [];
  for (const I of isles.filter((q) => q.far)) {
    const ob = deco(shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.8, 7, 6), marble))); ob.position.set(I.x - 2, I.top + 3.5, I.z - 2);
    const rg = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 6, 36), goldGlow); rg.position.set(I.x - 2, I.top + 6, I.z - 2); rg.rotation.x = Math.PI / 2; anim.add(rg);
    colliders.solids.push({ x: I.x - 2, z: I.z - 2, r: 0.9, y0: I.top - 1, y1: I.top + 7 });
    C.extraFeathers.push([I.x + 2, I.top + 1.6, I.z + 2], [I.x, I.top + 9, I.z]);
  }
  const ring = (I, a, f) => F.push([I.x + Math.cos(a) * I.r * f * 0.78, I.top + lift, I.z + Math.sin(a) * I.r * f * 0.78]);
  ring(by.court, 2.4, 0.55);
  ring(by.garden, 0.5, 0.6); ring(by.garden, 2.6, 0.55); ring(by.garden, 4.4, 0.7);
  ring(by.pool, 1.2, 0.75); F.push([by.pool.x, by.pool.top + 2.2, by.pool.z]);
  F.push([by.bell.x, by.bell.top + lift, by.bell.z]); ring(by.bell, 3.6, 0.7);
  ring(by.archive, 1.0, 0.35); ring(by.archive, 4.0, 0.75);
  ring(by.arena, 0.8, 0.7); ring(by.arena, 3.9, 0.7);
  F.push([by.summit.x + 2, by.summit.top + lift, by.summit.z + 2]); F.push([by.summit.x, by.summit.top + 12, by.summit.z]);
  F.push([by.perch.x, by.perch.top + lift, by.perch.z]);
  for (const B of C.bridges.filter((b) => b.b === 'arena' || b.b === 'bell')) F.push([B.mx, B.my, B.mz]);
  const st2 = C.stones[3]; F.push([st2.x, st2.top + lift, st2.z]);
  W.animated.push((t) => {
    halos[0].rotation.set(Math.PI / 2 + Math.sin(t * 0.2) * 0.12, 0, t * 0.05);
    halos[1].rotation.set(Math.PI / 2 + 0.3, t * 0.07, 0);
    halos[2].rotation.set(Math.PI / 2 - 0.25, -t * 0.04, 0.2);
    halos[3].rotation.z = t * 0.3;
    halos[4].rotation.y = t * 0.6; halos[4].position.y = by.archive.top + 2.1 + Math.sin(t * 1.4) * 0.2;
    halos[5].rotation.z = t * 0.5;
    cloudMat.uniforms.uTime.value = t; deckCloud.material.uniforms.uTime.value = t;
    shaft.uniforms.uTime.value = t;
  });
}

// ------------------------------------------------------------------ updrafts (rising light you can glide on)
function buildUpdrafts(scene) {
  const defs = [{ x: -66, z: 62, top: 64 }, { x: 148, z: 6, top: 68 }];
  for (const d of defs) {
    const g = groundAt(d.x, d.z);
    const h = d.top - g;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float s = fract(vUv.y*6.0 - uTime*0.5 + sin(vUv.x*25.0)*0.08);
          float streak = smoothstep(0.0, 0.08, s)*(1.0 - smoothstep(0.12, 0.5, s));
          float lines = 0.5 + 0.5*sin(vUv.x*6.283*9.0);
          float fade = smoothstep(0.0, 0.1, vUv.y)*(1.0 - smoothstep(0.6, 1.0, vUv.y));
          float a = streak*(0.4 + 0.6*lines)*fade*0.55;
          gl_FragColor = vec4(vec3(1.25, 0.95, 0.5), a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, h, 32, 1, true), m);
    col.position.set(d.x, g + h / 2, d.z);
    scene.add(noReflect(col));
    const base = new THREE.Mesh(new THREE.RingGeometry(1.5, 4.6, 64), additive(new THREE.Color(0.85, 0.62, 0.3), { map: TEX.rune, opacity: 0.8 }));
    base.rotation.x = -Math.PI / 2; base.position.set(d.x, g + 0.08, d.z);
    scene.add(base);
    W.updrafts.push({ ...d, g, mat: m, base });
  }
  W.animated.push((t) => { for (const u of W.updrafts) { u.mat.uniforms.uTime.value = t; u.base.rotation.z = t * 0.2; } });
}

// ------------------------------------------------------------------ god rays
function buildShafts(scene) {
  const m = beamMaterial('#fff3d6', 0.075);
  const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
  const spots = [[-18, -138, 14], [20, -165, 18], [-36, -16, 11], [30, 26, 9], [6, -96, 10], [-70, 70, 12], [96, -60, 14]];
  for (const [x, z, r] of spots) {
    const L = 260;
    const s = new THREE.Mesh(geo, m);
    s.scale.set(r, L, r);
    s.quaternion.copy(q);
    const g = Math.max(0, groundAt(x, z));
    s.position.set(x, g, z).addScaledVector(sunDir, L / 2);
    scene.add(noReflect(s));
  }
  W.shaftMat = m;
}

// ------------------------------------------------------------------ distant scenery
function buildDistant(scene, R, marble, gold) {
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.55 + R() * 0.2, d = 620 + R() * 260;
    const H = 180 + R() * 220;
    const g = new THREE.Group();
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(4 + R() * 3, 9 + R() * 4, H, 12), marble);
    tw.position.y = H / 2; g.add(tw);
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(14 + k * 5, 0.6, 6, 48), gold);
      ring.position.y = H * (0.55 + k * 0.15); ring.rotation.x = Math.PI / 2 + (R() - 0.5) * 0.4; g.add(ring);
    }
    g.position.set(Math.cos(a) * d, -60, Math.sin(a) * d);
    scene.add(g);
  }
}

// ------------------------------------------------------------------ ambient light motes + drifting feathers (follow player)
function buildAmbient(scene) {
  const N = 420, S = 38;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), r = new Float32Array(N);
  const Rr = mulberry(5);
  for (let i = 0; i < N; i++) { p[i * 3] = (Rr() * 2 - 1) * S; p[i * 3 + 1] = Rr() * 30; p[i * 3 + 2] = (Rr() * 2 - 1) * S; r[i] = Rr(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCenter: { value: new THREE.Vector3() }, uTime: { value: 0 }, uTex: { value: TEX.spark }, uPR: { value: 1 }, uAmt: { value: 1 } },
    vertexShader: `uniform vec3 uCenter; uniform float uTime, uPR; attribute float aR; varying float vA;
      void main(){ vec3 o = position;
        vec2 rel = mod(o.xz + vec2(sin(uTime*0.3 + aR*30.)*2.) - uCenter.xz + ${S.toFixed(1)}, ${(S * 2).toFixed(1)}) - ${S.toFixed(1)};
        float y = mod(o.y + uTime*(0.4 + aR*0.6), 30.0) - 6.0 + uCenter.y;
        vec4 mv = viewMatrix*vec4(uCenter.x + rel.x, y, uCenter.z + rel.y, 1.0);
        gl_Position = projectionMatrix*mv;
        float tw = 0.55 + 0.45*sin(uTime*(1.5 + aR*3.) + aR*40.);
        vA = tw*(1.0 - smoothstep(${(S * 0.6).toFixed(1)}, ${S.toFixed(1)}, length(rel)));
        gl_PointSize = min((2.0 + aR*5.0)*uPR*(70.0 / -mv.z), 14.0*uPR); }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uAmt; varying float vA;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(1.0,0.9,0.66)*t.a*vA*1.6*uAmt, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.layers.set(1);
  scene.add(pts);
  W.motes = m;

  // drifting feathers
  const FN = 70;
  const fm = new THREE.MeshStandardMaterial({ map: TEX.feather, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive: '#fff4de', emissiveMap: TEX.feather, emissiveIntensity: 0.6, roughness: 0.9 });
  const fg = new THREE.PlaneGeometry(0.16, 0.5);
  const im = new THREE.InstancedMesh(fg, fm, FN);
  im.frustumCulled = false; im.layers.set(1);
  const data = [];
  for (let i = 0; i < FN; i++) data.push({ x: (Rr() * 2 - 1) * 30, y: Rr() * 22, z: (Rr() * 2 - 1) * 30, ph: Rr() * 6.28, sp: 0.35 + Rr() * 0.5, s: 0.6 + Rr() * 0.8 });
  scene.add(im);
  W.drift = { im, data };
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function updateAmbient(t, dt, center) {
  W.skyMat.uniforms.uTime.value = t;
  W.cloudMat.uniforms.uTime.value = t;
  W.motes.uniforms.uTime.value = t;
  W.motes.uniforms.uCenter.value.copy(center);
  for (const gm of W.grassMats) gm.uniforms.uTime.value = t;
  W.water.reflector.material.uniforms.uTime.value = t;
  W.water.simple.material.uniforms.uTime.value = t;
  W.shaftMat.uniforms.uTime.value = t;
  for (const f of W.animated) f(t, dt);
  const { im, data } = W.drift;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    d.y -= d.sp * dt;
    if (d.y < -4) d.y += 26;
    const rx = (((d.x - center.x + 30) % 60) + 60) % 60 - 30, rz = (((d.z - center.z + 30) % 60) + 60) % 60 - 30;
    const sw = Math.sin(t * 1.3 + d.ph);
    _e.set(sw * 0.9, t * 0.6 + d.ph, Math.cos(t * 1.1 + d.ph) * 0.7);
    _q.setFromEuler(_e);
    _m4.compose(_p.set(center.x + rx + sw * 0.8, center.y + d.y, center.z + rz), _q, _s.setScalar(d.s));
    im.setMatrixAt(i, _m4);
  }
  im.instanceMatrix.needsUpdate = true;
}
