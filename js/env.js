// LUMENFALL · environment pass: aerial-perspective height fog, colour grade, strata rock, leaf-card foliage
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry } from './core.js';

export const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; };

export const NOISE = `
float eh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float en(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(eh(i),eh(i+vec2(1.,0.)),f.x), mix(eh(i+vec2(0.,1.)),eh(i+vec2(1.,1.)),f.x), f.y); }
float efb(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*en(p); p*=2.03; a*=.5; } return s; }
`;

// ------------------------------------------------------------------ atmosphere
// Replaces three's fog: exp² fog that thickens in the low valleys and thins with altitude,
// tinted warm toward the sun and sky-blue elsewhere (aerial perspective, à la BotW / MH).
export function installFog(sunDir) {
  const S = `vec3(${sunDir.x.toFixed(4)},${sunDir.y.toFixed(4)},${sunDir.z.toFixed(4)})`;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRel;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRel = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRel;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
    float fD = length(vFogRel);
    vec3 fDir = vFogRel / max(fD, 0.001);
    #ifdef FOG_EXP2
      float fy = cameraPosition.y + vFogRel.y * 0.5;
      float dens = fogDensity * mix(0.5, 1.4, exp(-max(fy - 2.0, 0.0) * 0.012));
      float fogFactor = 1.0 - exp(- dens * dens * fD * fD);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    float sunA = pow(max(dot(fDir, ${S}), 0.0), 5.0);
    // daylight layers: warm sun glow + sky-blue overhead. Dark (hell) fog: the glow turns to ember and the sky tint drops out.
    float fogDay = smoothstep(0.03, 0.12, dot(fogColor, vec3(0.2126, 0.7152, 0.0722)));
    vec3 glow = mix(min(fogColor * vec3(3.4, 2.0, 1.3), vec3(1.0)), ${lin('#ffe1b0')}, fogDay);
    vec3 fc = mix(fogColor, glow, sunA * 0.7);
    fc = mix(fc, ${lin('#9fbadc')}, (1.0 - sunA) * smoothstep(0.02, 0.4, fDir.y) * 0.5 * fogDay);
    #ifdef FOG_SCALE
      fogFactor *= FOG_SCALE; // landmarks that should read through the haze
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  }
#endif`;
}

// ------------------------------------------------------------------ colour grade (runs after OutputPass, display space)
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 1 }, uTint: { value: new THREE.Vector3(0, 0, 0) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 c0 = texture2D(tDiffuse, vUv).rgb, c = c0;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.16);                                   // vibrance
      c = mix(c, c*c*(3.0 - 2.0*c), 0.3);                          // filmic S-curve
      c += vec3(-0.02, -0.004, 0.03)*(1.0 - l)*(1.0 - l);          // cool shadows
      c += vec3(0.032, 0.014, -0.028)*l*l;                         // warm highlights
      c += uTint;
      vec2 d = (vUv - 0.5)*vec2(1.0, 0.78);
      c *= mix(0.78, 1.0, smoothstep(0.66, 0.2, length(d)));       // vignette
      gl_FragColor = vec4(mix(c0, clamp(c, 0.0, 1.0), uAmt), 1.0);
    }`,
};

// ------------------------------------------------------------------ world-space detail shaders
function worldVaryings(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      { vec4 wp4 = vec4(transformed, 1.0); vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
        #endif
        vWP = (modelMatrix * wp4).xyz; vWN = normalize(mat3(modelMatrix) * wn); }`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;\n' + NOISE);
}
// stratified rock on steep faces, macro colour breakup on flats
export function terrainDetail(m, o = {}) {
  if (o.tint) m.defines = Object.assign({}, m.defines, { TINT_ROCK: 1 }); // cliffs take on the painted ground's tone (scorched rift walls)
  m.onBeforeCompile = (sh) => {
    worldVaryings(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 vc0 = diffuseColor.rgb;
        float m1 = efb(vWP.xz*0.045), m2 = en(vWP.xz*0.6);
        diffuseColor.rgb *= 0.8 + 0.32*m1 + 0.1*m2;
        float steep = 1.0 - smoothstep(0.48, 0.8, vWN.y);
        float band = 0.5 + 0.5*sin(vWP.y*0.9 + m1*6.0);
        float grit = en(vec2(vWP.x + vWP.z, vWP.y*2.0)*0.35);
        vec3 rk = mix(${lin('#8f8678')}, ${lin('#bdb3a1')}, band*0.7 + grit*0.3) * (0.82 + 0.3*m2);
        #ifdef TINT_ROCK
          rk *= clamp(vc0 / ${lin('#9a9184')}, vec3(0.1), vec3(1.2));
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, rk, steep);
      }`);
  };
  m.customProgramCacheKey = () => 'lf-terrain' + (o.tint ? '-t' : '');
  return m;
}
export function strataMaterial(moss = 0.85, o = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ color: '#ffffff', roughness: 0.92 }, o));
  m.onBeforeCompile = (sh) => {
    worldVaryings(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float wob = en(vWP.xz*0.09);
        float band = 0.5 + 0.5*sin(vWP.y*1.6 + wob*5.0);
        float grit = en(vec2(vWP.x - vWP.z, vWP.y*2.5)*0.7);
        vec3 rk = mix(${lin('#9a9083')}, ${lin('#c9bfad')}, band*0.6 + grit*0.4) * (0.84 + 0.22*grit);
        float top = smoothstep(0.45, 0.85, vWN.y) * smoothstep(0.25, 0.55, en(vWP.xz*0.25 + 3.0)*0.6 + wob*0.4);
        vec3 mossC = mix(${lin('#5e7a3c')}, ${lin('#9aab5c')}, en(vWP.xz*1.3));
        diffuseColor.rgb *= mix(rk, mossC, top*${moss.toFixed(2)});
      }`);
  };
  m.customProgramCacheKey = () => 'lf-strata' + moss + (o.vertexColors ? 'v' : '');
  return m;
}

// chunky, terraced boulder: reads as layered sedimentary stone at any scale
export function rockGeo(seed, detail = 3) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const R = mulberry(seed), p = g.attributes.position;
  const o = [R() * 9, R() * 9, R() * 9, R() * 9];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.2 * Math.sin(x * 2.1 + o[0]) * Math.sin(y * 1.7 + o[1]) + 0.12 * Math.sin(z * 4.3 + x * 3.1 + o[2]) + 0.06 * Math.sin(y * 7 + o[3]);
    let yy = y * n;
    yy = (Math.round(yy * 3.5) / 3.5) * 0.4 + yy * 0.6;
    p.setXYZ(i, x * n, yy, z * n);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ foliage
export function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const R = mulberry(77);
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(R()) * 108, a = R() * Math.PI * 2;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const s = 8 + R() * 10, v = Math.round((150 + R() * 105) * (1 - (r / 108) * 0.3));
    g.save(); g.translate(x, y); g.rotate(a + (R() - 0.5) * 1.4);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.ellipse(0, 0, s * 0.42, s, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// a cluster of crossed leaf cards around a dense core, with normals bent away from the centre
export function canopyGeo(cards = 36, seed = 3) {
  const R = mulberry(seed), parts = [];
  for (let i = 0; i < cards; i++) {
    const u = R() * 2 - 1, th = R() * Math.PI * 2, rr = 0.5 + R() * 0.5, sx = Math.sqrt(1 - u * u);
    const q = new THREE.PlaneGeometry(1.2, 1.2);
    q.rotateZ(R() * 6.28); q.rotateX((R() - 0.5) * Math.PI); q.rotateY(R() * Math.PI);
    q.translate(Math.cos(th) * sx * rr, u * rr * 0.78, Math.sin(th) * sx * rr);
    parts.push(q);
  }
  const core = new THREE.IcosahedronGeometry(0.66, 0);
  const cu = core.attributes.uv;
  for (let i = 0; i < cu.count; i++) cu.setXY(i, 0.5 + (i % 3) * 0.04, 0.5 + (i % 5) * 0.03);
  core.scale(1, 0.8, 1);
  parts.push(core);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i) * 1.25 + 0.15, p.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
export function foliageMaterial(tex, o = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.88 }, o));
  m.onBeforeCompile = (sh) => {
    // keep the bent normals on back faces too, so the canopy shades like one soft volume
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => 'lf-foliage' + (o.emissive ? 'e' : '');
  return m;
}

// ------------------------------------------------------------------ drifting cloud shadows (all lit materials)
// Direct sunlight is dimmed where clouds pass between the sun and the surface; the pattern is projected
// along the sun direction and drifts with the wind, so light and shade sweep slowly across the world.
export const CLOUD = { value: 0 };
export function installCloudShadows(sunDir) {
  const S = `vec3(${sunDir.x.toFixed(4)},${sunDir.y.toFixed(4)},${sunDir.z.toFixed(4)})`;
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + `
uniform float uCloudT;
float lfH(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float lfN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(lfH(i),lfH(i+vec2(1.,0.)),f.x), mix(lfH(i+vec2(0.,1.)),lfH(i+vec2(1.,1.)),f.x), f.y); }
float lfCloud(vec3 wp){
  vec2 p = wp.xz - ${S}.xz / ${S}.y * wp.y;
  p = p*0.0052 + vec2(uCloudT*0.011, uCloudT*0.0045);
  float n = lfN(p)*0.55 + lfN(p*2.3 + 7.1)*0.3 + lfN(p*5.1 - 3.7)*0.15;
  return mix(1.0, 0.42, smoothstep(0.47, 0.64, n));
}
`;
  THREE.ShaderChunk.lights_fragment_end = THREE.ShaderChunk.lights_fragment_end + `
  {
    vec3 cwp = cameraPosition + transpose(mat3(viewMatrix)) * (-vViewPosition);
    float cs = lfCloud(cwp);
    reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;
  }
`;
}
// give every lit material in the scene the shared, ticking cloud clock
export function hookCloudClock(root) {
  const seen = new Set();
  root.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (seen.has(m) || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
      seen.add(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); sh.uniforms.uCloudT = CLOUD; };
    }
  });
}

// ------------------------------------------------------------------ god rays: radial light scattering toward the sun (screen space)
export const GodRayShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.8) }, uAmt: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAmt; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 d = (uSun - vUv) * (0.9 / 22.0);
      vec2 uv = vUv + d * 0.5;
      float w = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 22; i++) {
        uv += d;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
        float l = max(dot(c, vec3(0.3, 0.5, 0.2)) - 1.3, 0.0);
        acc += c * l * w; w *= 0.955;
      }
      float fall = 1.0 - smoothstep(0.05, 0.9, length((vUv - uSun) * vec2(1.6, 1.0)));
      gl_FragColor = vec4(base + acc * (uAmt / 22.0) * fall * vec3(1.0, 0.85, 0.6), 1.0);
    }`,
};
