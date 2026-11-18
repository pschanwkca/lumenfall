// LUMENFALL · game: renderer, player, combat, shades, collectibles, HUD, input, audio, flow
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as C from './core.js';
import { buildWorld, W, colliders, sunDir, updateAmbient, setWaterQuality, HALO_POS, COL, sanitizeNormals, noReflect, LANDMARKS, REALM } from './world.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GradeShader, GodRayShader, CLOUD, hookCloudClock, rockGeo } from './env.js';
import { setLang, tr } from './i18n.js';
import { buildEarthGrid, buildEarth, EARTH, earthRegion } from './earth.js';
import { getFeatherGeo } from './hero.js';
import { SeraphActor } from './seraph.js';
import { createBoss, BOSS_HOME } from './boss.js';

const { clamp, lerp, smooth, damp, dampAngle, angDiff, easeOut, easeInOut, mulberry, groundAt, LAKE, TEMPLE, WINGP, SHRINES, SPAWN, edgeR, TEX, grid, GN } = C;
const $ = (id) => document.getElementById(id);
const DESK = !!window.__DESK; // decided in index.html: desktop = fine pointer + hover
const isTouch = !DESK;
const VIEW = window.__VIEW || { w: innerWidth, h: innerHeight, s: 1 }; // logical stage size (desktop stage is letterboxed to landscape)

// ------------------------------------------------------------------ settings & save
const QUAL = {
  low: { pr: 1.0, bloom: false, refl: false, shadow: false, grass: 6000, flowers: 1200, refScale: 0, samples: 0, mp: 1.3 },
  mid: { pr: 1.35, bloom: true, refl: true, shadow: true, grass: 10000, flowers: 2000, refScale: 0.3, samples: 2, mp: 2.4 },
  high: { pr: 1.8, bloom: true, refl: true, shadow: true, grass: 15000, flowers: 2600, refScale: 0.45, samples: 4, mp: 4.2 },
};
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ quality: isTouch ? 'mid' : 'high', sound: true, autoCam: false, lang: 'zh', sens: 1 }, store.get('lumenfall_settings', {}));
let prog = Object.assign({ f: [], s: [false, false, false, false], end: false, boss: false, boss2: false, boss3: false, realm: false, earth: false, weapon: 'spear', kills: {}, seen: {}, broken: {} }, store.get('lumenfall_progress', {}));
const save = () => store.set('lumenfall_progress', prog);
let Q = QUAL[settings.quality] || QUAL.mid;

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, VIEW.w / VIEW.h, 0.1, 2600);
camera.layers.enable(1); camera.layers.enable(2);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Q.samples }));
composer.addPass(new RenderPass(scene, camera));
const rays = new ShaderPass(GodRayShader);
composer.addPass(rays);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.45);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

// desktop: resolution follows a pixel budget and drops / recovers automatically to hold the frame rate
const dyn = { scale: 1, acc: 0, n: 0, last: 0, on: DESK && !window.__noDyn };
function resize() {
  const V = window.__layoutStage ? window.__layoutStage() : VIEW;
  const w = V.w, h = V.h;
  let pr = Math.min(devicePixelRatio || 1, Q.pr) * (V.s || 1);
  if (DESK) { const px = w * h * pr * pr, cap = (Q.mp || 2.4) * 1e6; if (px > cap) pr *= Math.sqrt(cap / px); pr *= dyn.scale; }
  pr = Math.max(0.5, pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (W.water) setWaterQuality(Q, w * pr, h * pr);
  if (W.motes) W.motes.uniforms.uPR.value = pr;
  layoutMinimap();
  checkRotate();
}
function applyQuality() {
  Q = QUAL[settings.quality] || QUAL.mid;
  bloom.enabled = Q.bloom;
  W.sun.castShadow = Q.shadow;
  { const ms = DESK && settings.quality === 'high' ? 2048 : 1024; const sh = W.sun.shadow; if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); if (sh.map) { sh.map.dispose(); sh.map = null; } } }
  W.grass.geometry.instanceCount = Q.grass;
  W.flowers.geometry.instanceCount = Q.flowers;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { if (rt.samples !== Q.samples) { rt.samples = Q.samples; rt.dispose(); } }
  resize();
}

// ------------------------------------------------------------------ state
let state = 'loading';
let DT_MAX = 0.05;
let time = 0, paused = false;
const clock = new THREE.Clock();
const P = {
  pos: new THREE.Vector3(SPAWN.x, 0, SPAWN.z), vel: new THREE.Vector3(), yaw: Math.PI,
  grounded: true, glide: false, stamina: 100, staminaDelay: 0, hp: 100, maxHp: 100, hpShown: 100,
  dashT: 0, dashCd: 0, dashDir: new THREE.Vector3(), inv: 0, hurtT: 0, lastHurt: -99,
  atk: { idx: -1, t: 0, queued: false, hit: false }, castT: -1, skillCd: 0,
  safe: new THREE.Vector3(SPAWN.x, 0, SPAWN.z), safeT: 0, checkpoint: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),
  phase: 0, onWater: false, stepAcc: 0, idleRipple: 0, speed: 0, lastAirY: 0,
};
const CAM = { yaw: 0, pitch: 0.26, dist: 5.6, lastDrag: -99, look: new THREE.Vector3(), shake: 0, fov: 58, recenter: 0, yawTarget: 0 };
Object.assign(P, { charge: -1, chargeFull: false, atkHeld: false, atkDownT: 0, counterT: 0, perfectCd: 0, spin: 0, flasks: 3, maxFlasks: 3, healT: -1, healed: false, lock: null });
// ---------- light-feather levels: every feather is experience; levels raise HP / attack and unlock the way up
const LV_REQ = [0, 3, 7, 12, 18, 25, 33, 42, 52, 64];
const LV_PERK = { 3: '解鎖「天梯」· 可由環光聖所升往天上神域', 4: '聖瓶上限 +1', 6: '光羽之力 · 攻擊再提升', 8: '熾翼覺醒' };
const lvFor = (n) => { let l = 1; while (l < LV_REQ.length && n >= LV_REQ[l]) l++; return l; };
P.lv = lvFor(prog.f.length); P.lvTarget = P.lv; P.atkMul = 1; P.inRealm = false; P.inEarth = false;
function applyStats(heal) {
  P.maxHp = 100 + (P.lv - 1) * 10 + (prog.boss ? 25 : 0) + (prog.boss2 ? 25 : 0) + (prog.boss3 ? 25 : 0);
  P.atkMul = 1 + (P.lv - 1) * 0.06 + (prog.boss3 ? 0.1 : 0);
  P.maxFlasks = 3 + (P.lv >= 4 ? 1 : 0) + (prog.boss2 ? 1 : 0);
  if (heal) { P.hp = P.maxHp; P.flasks = P.maxFlasks; } else P.hp = Math.min(P.hp, P.maxHp);
}
applyStats(true);
P.atk = { kind: null, t: 0, dur: 0, hitsDone: 0, queued: false, mult: 1, combo: -1 };
let enemyScale = 1, slowT = 0, boss = null;
// light combo (4 hits), charged heavy, perfect-dodge counter
const ATK = {
  l0: { dur: 0.46, hits: [0.09], dmg: [30, 36], reach: 3.2, cone: -0.1, lunge: 3.6, poise: 6, arc: { t0: 2.2, len: 3.5, rev: 0, tilt: [-0.22, 0, -0.55] }, sfx: 'swing' },
  l1: { dur: 0.44, hits: [0.09], dmg: [30, 36], reach: 3.2, cone: -0.1, lunge: 3.6, poise: 6, arc: { t0: 2.2, len: 3.5, rev: 1, tilt: [-0.22, 0, 0.58] }, sfx: 'swing' },
  l2: { dur: 0.62, hits: [0.13, 0.27], dmg: [22, 27], reach: 3.5, cone: -2, lunge: 1.8, poise: 7, spin: true, arc: { t0: 0, len: 6.2, rev: 0, tilt: [0, 0, 0] }, sfx: 'swing' },
  l3: { dur: 0.66, hits: [0.13], dmg: [52, 60], reach: 4.1, cone: 0.5, lunge: 9, poise: 14, thrust: true, sfx: 'thrust' },
  heavy: { dur: 0.72, hits: [0.1, 0.2], dmg: [70, 82], reach: 4.8, cone: 0.45, lunge: 16, poise: 25, thrust: true, sfx: 'thrust' },
  counter: { dur: 0.78, hits: [0.3], dmg: [125, 145], reach: 4.8, cone: -0.45, lunge: 5, poise: 40, arc: { t0: 2.0, len: 3.9, rev: 0, tilt: [-1.0, 0, 0.25] }, sfx: 'skill' },
};
// the Warden's greatsword: slower, heavier, longer reach, breaks guard
const ATK_GS = Object.fromEntries(Object.entries(ATK).map(([k, a]) => [k, { ...a, dur: a.dur * 1.22, hits: a.hits.map((h) => h * 1.22), dmg: a.dmg.map((d) => d * 1.6), reach: a.reach + 0.8, lunge: a.lunge * 0.85, poise: a.poise * 1.8 }]));
const atkT = () => (prog.weapon === 'greatsword' ? ATK_GS : ATK);
// powers granted by the purified
const POWERS = {
  shield: { key: 'boss', glyph: '盾', name: '守衛之盾', en: "WARDEN'S AEGIS", desc: '原地按「閃避」舉盾格擋，時機啱可反擊 · 衝刺可擊碎黑晶封印' },
  wings: { key: 'boss2', glyph: '翼', name: '審判之翼', en: "ARBITER'S WINGS", desc: '空中按「閃避」向前衝刺 · 滑翔更省力，振翼更有力' },
  oath: { key: 'boss3', glyph: '誓', name: '騎士之誓', en: "KNIGHT'S OATH", desc: '蓄滿力的重擊會震地 · 擊碎裂石，震飛周圍敵人' },
};
const has = (k) => !!prog[POWERS[k].key];

const COMBO = ['l0', 'l1', 'l2', 'l3'];

// ------------------------------------------------------------------ audio
const Audio = {
  ctx: null, master: null, nextChord: 0, chordIdx: 0, nextBell: 0,
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = settings.sound ? 0.85 : 0; this.master.connect(c.destination);
    const len = c.sampleRate * 3.2, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    this.rev = c.createConvolver(); this.rev.buffer = buf;
    const wet = c.createGain(); wet.gain.value = 0.55; this.rev.connect(wet).connect(this.master);
    this.dry = c.createGain(); this.dry.gain.value = 0.75; this.dry.connect(this.master);
    this.pad = c.createGain(); this.pad.gain.value = 0.085;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    this.pad.connect(lp); lp.connect(this.dry); lp.connect(this.rev);
    this.nextChord = c.currentTime + 0.1;
    this.nextBell = c.currentTime + 4;
  },
  setOn(on) { if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.15); },
  mtof: (m) => 440 * Math.pow(2, (m - 69) / 12),
  chords: [[48, 55, 59, 62, 64, 71], [45, 52, 55, 59, 62, 67], [41, 48, 52, 57, 60, 67], [43, 50, 55, 57, 62, 69]],
  tick() {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime;
    if (now > this.nextChord - 0.05) {
      const ch = this.chords[this.chordIdx++ % this.chords.length];
      ch.forEach((m, i) => {
        for (const det of [-5, 5]) {
          const o = c.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle';
          o.frequency.value = this.mtof(m); o.detune.value = det;
          const g = c.createGain(); g.gain.value = 0;
          const t0 = this.nextChord, a = i === 0 ? 0.5 : 0.22;
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 3.2); g.gain.setValueAtTime(a, t0 + 7); g.gain.linearRampToValueAtTime(0, t0 + 12);
          o.connect(g).connect(this.pad); o.start(t0); o.stop(t0 + 12.2);
        }
      });
      this.nextChord += 9;
    }
    if (now > this.nextBell) {
      const sc = [72, 74, 76, 79, 81, 84, 86, 88];
      this.bell(this.mtof(sc[Math.floor(Math.random() * sc.length)]), 0.035, 3.5);
      this.nextBell = now + 2.5 + Math.random() * 4;
    }
  },
  bell(f, v = 0.1, dur = 1.6, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + delay;
    for (const [mul, amp] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
      const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v * amp, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / mul ** 0.3);
      o.connect(g); g.connect(this.dry); g.connect(this.rev); o.start(t0); o.stop(t0 + dur + 0.1);
    }
  },
  noise(dur, f0, f1, v, q = 1.2) {
    const c = this.ctx; if (!c) return;
    const n = c.sampleRate * dur, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    const t0 = c.currentTime;
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + dur * 0.25); g.gain.linearRampToValueAtTime(0, t0 + dur);
    s.connect(bp).connect(g); g.connect(this.dry); g.connect(this.rev); s.start(t0);
  },
  thud(f = 90, v = 0.25) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = 'sine'; const t0 = c.currentTime;
    o.frequency.setValueAtTime(f * 2, t0); o.frequency.exponentialRampToValueAtTime(f * 0.5, t0 + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    o.connect(g).connect(this.dry); o.start(t0); o.stop(t0 + 0.35);
  },
  sfx(name) {
    if (!this.ctx || !settings.sound) return;
    const m = (x) => this.mtof(x);
    switch (name) {
      case 'swing': this.noise(0.22, 600, 2600, 0.16, 0.9); break;
      case 'thrust': this.noise(0.18, 900, 3400, 0.18, 1.4); break;
      case 'hit': this.bell(m(88), 0.08, 0.5); this.thud(120, 0.18); break;
      case 'lvup': [60, 67, 72, 76, 79, 84, 88, 91].forEach((x, i) => this.bell(m(x), 0.1, 4, i * 0.075)); this.noise(1.6, 400, 5000, 0.06, 0.6); break;
      case 'pickup': [76, 81, 88].forEach((x, i) => this.bell(m(x), 0.1, 1.8, i * 0.08)); break;
      case 'jump': this.noise(0.25, 300, 900, 0.08); break;
      case 'glide': this.noise(0.5, 250, 1400, 0.12, 0.7); break;
      case 'dash': this.noise(0.2, 1200, 400, 0.15); break;
      case 'skill': this.noise(0.6, 200, 3000, 0.16, 0.6); [64, 71, 76, 83].forEach((x, i) => this.bell(m(x), 0.09, 2.4, 0.3 + i * 0.03)); break;
      case 'hurt': this.thud(70, 0.35); this.noise(0.2, 400, 150, 0.12); break;
      case 'purify': [79, 84, 91].forEach((x, i) => this.bell(m(x), 0.08, 2.2, i * 0.05)); break;
      case 'shrine': [60, 67, 72, 76, 79, 84].forEach((x, i) => this.bell(m(x), 0.1, 4, i * 0.12)); this.noise(1.6, 150, 2400, 0.12, 0.5); break;
      case 'ui': this.bell(m(91), 0.05, 0.6); break;
      case 'land': this.thud(60, 0.12); break;
      case 'charge': this.noise(0.9, 180, 1500, 0.07, 0.8); break;
      case 'perfect': this.noise(0.5, 2400, 500, 0.12, 1); [84, 91, 96].forEach((x, i) => this.bell(m(x), 0.08, 2.5, i * 0.06)); break;
      case 'roar': this.thud(45, 0.5); this.noise(1.6, 120, 600, 0.25, 0.6); break;
      case 'slam': this.thud(50, 0.55); this.noise(0.6, 600, 120, 0.25, 0.6); break;
      case 'boss': [36, 43, 48, 55].forEach((x, i) => this.bell(m(x), 0.12, 5, i * 0.15)); break;
      case 'end': [48, 55, 60, 64, 67, 72, 76, 79, 84].forEach((x, i) => this.bell(m(x), 0.09, 6, i * 0.18)); this.noise(4, 100, 3000, 0.1, 0.4); break;
    }
  },
};

// ------------------------------------------------------------------ hero
let hero, blob;
function buildPlayer() {
  hero = new SeraphActor(scene, {});
  blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);
  P.pos.y = 0;
}

// ------------------------------------------------------------------ fx
const FX = {};
function buildFX() {
  // slash arc
  const arcMat = new THREE.ShaderMaterial({
    uniforms: { uProg: { value: 0 }, uAlpha: { value: 0 }, uT0: { value: 0 }, uLen: { value: 3.14 }, uRev: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uProg, uAlpha, uT0, uLen, uRev; varying vec2 vP;
      void main(){ float a = atan(vP.y, vP.x); float u = mod(a - uT0 + 25.1327, 6.28318)/uLen; if (u > 1.0) discard; if (uRev > 0.5) u = 1.0 - u;
        float r = length(vP); float v = (r - 0.7)/2.0;
        float m = smoothstep(uProg - 0.6, uProg, u)*step(u, uProg);
        float edge = smoothstep(0.12, 0.9, v)*(1.0 - smoothstep(0.93, 1.0, v));
        vec3 col = mix(vec3(0.95, 0.66, 0.26), vec3(2.2, 1.9, 1.35), smoothstep(0.6, 0.96, v));
        gl_FragColor = vec4(col, clamp(m*edge*uAlpha*1.4, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const arc = new THREE.Mesh(new THREE.RingGeometry(0.7, 2.7, 72, 1), arcMat);
  arc.rotation.x = -Math.PI / 2;
  const arcG = new THREE.Group(); const arcTilt = new THREE.Group();
  arcG.add(arcTilt); arcTilt.add(arc); scene.add(arcG); arcG.visible = false;
  FX.arc = { g: arcG, tilt: arcTilt, mat: arcMat, t: 9 };
  // thrust lance streak
  const lance = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.2), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.2, 1.7, 0.95), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  lance.rotation.x = Math.PI / 2;
  const lanceG = new THREE.Group(); lanceG.add(lance); lance.position.z = 2.0; scene.add(lanceG); lanceG.visible = false;
  FX.lance = { g: lanceG, m: lance, t: 9 };
  // skill shockwave
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.0, 96), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.9, 1.4, 0.65), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  wave.rotation.x = -Math.PI / 2; scene.add(wave); wave.visible = false;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 16, 32, 1, true), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.0, 1.6, 0.9), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(pillar); pillar.visible = false;
  FX.wave = { m: wave, p: pillar, t: 9 };
  // ripples
  FX.ripples = [];
  const rg = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 16; i++) {
    const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: TEX.ripple, color: new THREE.Color(1.0, 0.98, 0.92), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; r.visible = false; scene.add(r);
    FX.ripples.push({ m: r, t: 9, max: 1 });
  }
  FX.ri = 0;
  // spark particles
  FX.sparks = makePool(600, true);
  FX.smoke = makePool(320, false);
  // feather burst
  const fm = new THREE.MeshStandardMaterial({ map: TEX.feather, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive: '#fff2d6', emissiveMap: TEX.feather, emissiveIntensity: 0.9 });
  const fim = new THREE.InstancedMesh(getFeatherGeo(), fm, 48);
  fim.frustumCulled = false; fim.count = 48; scene.add(fim);
  FX.feath = { im: fim, list: Array.from({ length: 48 }, () => ({ life: 0 })), i: 0 };
  // hit light
  for (const o of [arcG, lanceG, wave, pillar, FX.sparks.pts, FX.smoke.pts, fim, ...FX.ripples.map((r) => r.m)]) noReflect(o);
  // weapon trail ribbon
  const TN = 22;
  const tg = new THREE.BufferGeometry();
  const tpos = new Float32Array(TN * 2 * 3), ta = new Float32Array(TN * 2), ts = new Float32Array(TN * 2), tidx = [];
  for (let i = 0; i < TN; i++) { ts[i * 2] = 0; ts[i * 2 + 1] = 1; if (i < TN - 1) tidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
  tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3)); tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1)); tg.setAttribute('aS', new THREE.BufferAttribute(ts, 1)); tg.setIndex(tidx);
  const tmat = new THREE.ShaderMaterial({
    vertexShader: `attribute float aA; attribute float aS; varying float vA; varying float vS; void main(){ vA = aA; vS = aS; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying float vA; varying float vS; void main(){ vec3 c = mix(vec3(1.1,0.72,0.3), vec3(2.6,2.2,1.6), smoothstep(0.55, 1.0, vS)); gl_FragColor = vec4(c, vA*smoothstep(0.0, 0.5, vS)*0.95); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const trail = new THREE.Mesh(tg, tmat); trail.frustumCulled = false; scene.add(trail); noReflect(trail);
  FX.trail = { mesh: trail, pos: tpos, a: ta, N: TN, samples: [] };
  FX.flashLight = new THREE.PointLight('#ffe2a8', 0, 14, 2);
  scene.add(FX.flashLight);
}
function makePool(N, additive) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: additive ? TEX.spark : TEX.glow }, uPR: { value: 1 } },
    vertexShader: `attribute vec3 aCol; attribute float aSize; attribute float aAlpha; uniform float uPR; varying vec3 vC; varying float vA;
      void main(){ vC = aCol; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = aSize*uPR*(260.0 / max(-mv.z, 0.5)); }`,
    fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  const parts = Array.from({ length: N }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, g: 0, drag: 1, r: 1, gC: 1, b: 1 }));
  return { g, m, pts, parts, N, i: 0, pos, col, size, alpha };
}
function emit(pool, o) {
  const p = pool.parts[pool.i]; pool.i = (pool.i + 1) % pool.N;
  p.life = p.max = o.life ?? 1; p.x = o.x; p.y = o.y; p.z = o.z;
  p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0; p.s = o.s ?? 1; p.g = o.g ?? 0; p.drag = o.drag ?? 1.5;
  const c = o.c || [1.7, 1.25, 0.6]; p.r = c[0]; p.gC = c[1]; p.b = c[2];
}
function burst(pool, x, y, z, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.6, sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.8);
    emit(pool, { x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + (o.up ?? 1), vz: Math.sin(a) * Math.cos(e) * sp, life: (o.life ?? 0.9) * (0.6 + Math.random() * 0.6), s: (o.size ?? 1) * (0.5 + Math.random()), g: o.g ?? -2, c: o.c, drag: o.drag });
  }
}
function updatePool(pool, dt) {
  const { parts, pos, col, size, alpha } = pool;
  for (let i = 0; i < pool.N; i++) {
    const p = parts[i];
    if (p.life > 0) {
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = clamp(p.life / p.max, 0, 1);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r; col[i * 3 + 1] = p.gC; col[i * 3 + 2] = p.b;
      size[i] = p.s * (0.4 + 0.6 * f); alpha[i] = Math.min(1, f * 2.2);
    } else alpha[i] = 0;
  }
  for (const k of ['position', 'aCol', 'aSize', 'aAlpha']) pool.g.attributes[k].needsUpdate = true;
}
function ripple(x, z, size = 1.4, life = 1.4) {
  const r = FX.ripples[FX.ri++ % FX.ripples.length];
  r.t = 0; r.life = life; r.max = size; r.m.visible = true; r.m.position.set(x, 0.03, z);
}
function featherBurst(x, y, z, n, sp = 3) {
  for (let i = 0; i < n; i++) {
    const f = FX.feath.list[FX.feath.i]; FX.feath.i = (FX.feath.i + 1) % FX.feath.list.length;
    const a = Math.random() * 6.283;
    Object.assign(f, { life: 1.6 + Math.random(), max: 2.4, x, y, z, vx: Math.cos(a) * sp * Math.random(), vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp * Math.random(), ph: Math.random() * 6, s: 0.14 + Math.random() * 0.1 });
  }
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const _tip = new THREE.Vector3(), _base = new THREE.Vector3();
function updateTrail(dt, active) {
  const T = FX.trail;
  for (const sm of T.samples) sm.age += dt;
  if (active) { hero.tipWorld(0, _tip); hero.tipWorld(1, _base); T.samples.unshift({ tip: _tip.clone(), base: _base.clone(), age: 0 }); }
  while (T.samples.length > T.N || (T.samples.length && T.samples[T.samples.length - 1].age > 0.22)) T.samples.pop();
  const last = T.samples[T.samples.length - 1];
  for (let i = 0; i < T.N; i++) {
    const sm = T.samples[i] || last;
    if (!sm) { T.a[i * 2] = T.a[i * 2 + 1] = 0; continue; }
    T.pos.set([sm.base.x, sm.base.y, sm.base.z, sm.tip.x, sm.tip.y, sm.tip.z], i * 6);
    const a = T.samples[i] ? Math.max(0, 1 - sm.age / 0.22) * (1 - i / T.N) : 0;
    T.a[i * 2] = T.a[i * 2 + 1] = a;
  }
  T.mesh.geometry.attributes.position.needsUpdate = true; T.mesh.geometry.attributes.aA.needsUpdate = true;
}
const dnums = [];
function dmgNumber(pos, n, kind) {
  const el = document.createElement('div');
  el.className = 'dn ' + (kind || '');
  el.textContent = n;
  $('dnums').appendChild(el);
  dnums.push({ el, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
  if (dnums.length > 14) { const d = dnums.shift(); d.el.remove(); }
}
function updateDmgNums(dt) {
  for (let i = dnums.length - 1; i >= 0; i--) {
    const d = dnums[i]; d.t += dt;
    if (d.t > 0.9) { d.el.remove(); dnums.splice(i, 1); continue; }
    _v.copy(d.pos).project(camera);
    if (_v.z > 1) { d.el.style.opacity = 0; continue; }
    const x = (_v.x * 0.5 + 0.5) * VIEW.w + d.dx * easeOut(d.t / 0.9), y = (-_v.y * 0.5 + 0.5) * VIEW.h - easeOut(d.t / 0.9) * 46;
    d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${d.t < 0.12 ? 1.5 - d.t * 4 : 1})`;
    d.el.style.opacity = d.t > 0.6 ? (0.9 - d.t) / 0.3 : 1;
  }
}
function bigText(cn, en) {
  const el = $('bigText');
  el.querySelector('.cn').textContent = cn; el.querySelector('.en').textContent = en;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
function updateFX(dt) {
  updatePool(FX.sparks, dt);
  updatePool(FX.smoke, dt);
  const A = FX.arc;
  A.t += dt;
  if (A.t < 0.4) {
    A.mat.uniforms.uProg.value = clamp(A.t / 0.13, 0, 1.6);
    A.mat.uniforms.uAlpha.value = 1 - smooth(0.12, 0.38, A.t);
    A.g.position.set(P.pos.x, P.pos.y + 1.15, P.pos.z);
  } else A.g.visible = false;
  const L = FX.lance; L.t += dt;
  if (L.t < 0.3) { const k = L.t / 0.3; L.m.material.opacity = 1 - k; L.m.scale.set(1 - k * 0.5, 0.7 + easeOut(k) * 0.6, 1); L.g.position.set(P.pos.x, P.pos.y + 1.2, P.pos.z); }
  else L.g.visible = false;
  const Wv = FX.wave; Wv.t += dt;
  if (Wv.t < 0.9) {
    const k = Wv.t / 0.9;
    Wv.m.scale.setScalar(1 + easeOut(k) * 8.5); Wv.m.material.opacity = 1 - k;
    Wv.p.scale.set(1 + k, 1 - k * 0.3, 1 + k); Wv.p.material.opacity = (1 - k) * 0.9;
  } else { Wv.m.visible = false; Wv.p.visible = false; }
  for (const r of FX.ripples) {
    if (!r.m.visible) continue;
    r.t += dt;
    const k = r.t / r.life;
    if (k >= 1) { r.m.visible = false; continue; }
    r.m.scale.setScalar(0.3 + easeOut(k) * r.max * 2);
    r.m.material.opacity = (1 - k) * 0.55;
  }
  const F = FX.feath;
  for (let i = 0; i < F.list.length; i++) {
    const f = F.list[i];
    if (f.life > 0) {
      f.life -= dt;
      f.vx *= 0.97; f.vz *= 0.97; f.vy = f.vy * 0.96 - 1.2 * dt;
      f.x += f.vx * dt + Math.sin(time * 3 + f.ph) * 0.01; f.y += f.vy * dt; f.z += f.vz * dt;
      _e.set(Math.sin(time * 2 + f.ph), time * 2 + f.ph, Math.cos(time * 1.7 + f.ph));
      _q.setFromEuler(_e);
      const sc = f.s * Math.min(1, f.life);
      _m4.compose(_p.set(f.x, f.y, f.z), _q, _s.set(sc, sc * 3.2, sc));
    } else _m4.makeScale(0, 0, 0);
    F.im.setMatrixAt(i, _m4);
  }
  F.im.instanceMatrix.needsUpdate = true;
  FX.flashLight.intensity = damp(FX.flashLight.intensity, 0, 8, dt);
}

// ------------------------------------------------------------------ light feathers (collectibles)
const feathers = [];
let REALM_F0 = 999, EARTH_F0 = 999, EARTH_F1 = 999;
function buildFeathers() {
  const spots = [];
  const g = (x, z, dy = 1.4) => [x, Math.max(0, groundAt(x, z)) + dy, z];
  spots.push(g(0, 28), g(-22, 4), g(24, -14));
  spots.push([-66, 40, 62]);
  spots.push({ isl: 0 }, { isl: 1 }, { isl: 2 });
  spots.push([0, W.temple.floorY + 1.6, -168]);
  spots.push(g(-158, -118, 1.6));
  for (const a of [0.25, 1.35, 2.45, 3.6, 4.75]) { const r = edgeR(a) - 10; spots.push(g(Math.cos(a) * r, Math.sin(a) * r)); }
  spots.push(g(WINGP.x + 5, WINGP.z + 11));
  spots.push(g(0, -71), g(0, -97));
  for (const [x, z] of [[-62, -70], [92, -112], [-176, -36], [134, 96], [-84, 150]]) spots.push(g(x + 2.5, z + 2.5));
  spots.push(g(SHRINES[0].x + 9, SHRINES[0].z + 7), g(SHRINES[2].x - 8, SHRINES[2].z + 7));
  spots.push(g(LANDMARKS[0].x, LANDMARKS[0].z - 5, 1.8), g(LANDMARKS[1].x + 10, LANDMARKS[1].z - 3, 1.8));
  REALM_F0 = spots.length;
  for (const f of REALM.feathers) spots.push(f);
  EARTH_F0 = spots.length;
  for (const f of EARTH.feathers) spots.push(f);
  EARTH_F1 = spots.length;
  for (const f of BREAK_F) spots.push(f);
  for (const f of REALM.extraFeathers) spots.push(f);
  const fMat = new THREE.MeshStandardMaterial({ map: TEX.feather, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: '#fff8e8', emissive: '#ffe6a8', emissiveMap: TEX.feather, emissiveIntensity: 2.4 });
  const glowMat = new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(1.5, 1.1, 0.55), transparent: true, opacity: 0.75, depthWrite: false });
  const beamMat = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.25, 0.95, 0.5), transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  const beamGeo = new THREE.CylinderGeometry(0.2, 0.2, 14, 10, 1, true); beamGeo.translate(0, 7, 0);
  spots.forEach((s, id) => {
    const grp = new THREE.Group();
    const fm = new THREE.Mesh(getFeatherGeo(), fMat); fm.scale.set(0.42, 1.15, 1); fm.position.y = -0.55; fm.rotation.z = 0.25;
    const spin = new THREE.Group(); spin.add(fm); grp.add(spin);
    const gl = new THREE.Sprite(glowMat); gl.scale.setScalar(2.6); grp.add(gl);
    const bm = new THREE.Mesh(beamGeo, beamMat); bm.position.y = -1.2; grp.add(bm);
    noReflect(grp);
    if (s.isl !== undefined) {
      const isl = W.islands[s.isl];
      grp.position.set(-isl.r * 0.25, 2.5, isl.r * 0.25);
      isl.grp.add(grp);
    } else { grp.position.set(s[0], s[1], s[2]); scene.add(grp); }
    const taken = prog.f.includes(id);
    grp.visible = !taken;
    feathers.push({ id, grp, spin, beam: bm, taken, wp: new THREE.Vector3(), ph: id * 1.7 });
  });
}
function updateFeathers(dt) {
  for (const f of feathers) {
    if (f.taken) continue;
    const fd = Math.abs(f.wp.x - P.pos.x) + Math.abs(f.wp.z - P.pos.z);
    f.grp.visible = fd < 260;
    f.beam.visible = Math.hypot(f.wp.x - camera.position.x, f.wp.z - camera.position.z) > 7;
    f.spin.rotation.y = time * 1.4 + f.ph;
    f.spin.position.y = Math.sin(time * 1.8 + f.ph) * 0.18;
    f.grp.getWorldPosition(f.wp);
    if (!f.seen && state === 'play' && Math.hypot(f.wp.x - P.pos.x, f.wp.z - P.pos.z) < 55 && Math.abs(f.wp.y - P.pos.y) < 40) f.seen = true;
    if (state === 'play' && f.wp.distanceToSquared(_v.set(P.pos.x, P.pos.y + 1.0, P.pos.z)) < 2.2 * 2.2) {
      f.taken = true; f.grp.visible = false;
      prog.f.push(f.id); save();
      burst(FX.sparks, f.wp.x, f.wp.y, f.wp.z, 40, { speed: 4, up: 2, life: 1.1, size: 1.1, c: [1.8, 1.5, 1.0] });
      featherBurst(f.wp.x, f.wp.y, f.wp.z, 6, 2);
      Audio.sfx('pickup');
      toast(`<i class="dia"></i>獲得光羽 <b>${prog.f.length}</b> / ${feathers.length}`);
      if (prog.f.length === feathers.length) setTimeout(() => toast('<i class="dia"></i>所有光羽已歸來 · ALL FEATHERS FOUND', true), 900);
      P.hp = Math.min(P.maxHp, P.hp + 10);
      const nl = lvFor(prog.f.length);
      if (nl > P.lvTarget) { P.lvTarget = nl; setTimeout(() => levelUp(nl), 700); }
      updateLvHUD();
      updateQuest(); pulse($('qObj'));
    }
  }
}

// ------------------------------------------------------------------ shades (蝕影)
const shades = [];
let shadeMatBase;
function buildShades() {
  shadeMatBase = new THREE.MeshStandardMaterial({ color: '#1d1b24', roughness: 0.28, metalness: 0.6, emissive: '#ffc766', emissiveMap: TEX.vein, emissiveIntensity: 1.3 });
  const archerBase = new THREE.MeshStandardMaterial({ color: '#221c2c', roughness: 0.3, metalness: 0.6, emissive: '#e7a6ff', emissiveMap: TEX.vein, emissiveIntensity: 1.4 });
  const maskMat = new THREE.MeshStandardMaterial({ map: TEX.mask, roughness: 0.35, metalness: 0.1 });
  const ringMat = new THREE.MeshStandardMaterial({ color: '#8c7444', metalness: 0.9, roughness: 0.4, emissive: '#7a5520', emissiveIntensity: 0.4 });
  const glintMat = new THREE.SpriteMaterial({ map: TEX.spark, color: new THREE.Color(2.6, 1.7, 0.6), transparent: true, depthWrite: false, depthTest: false });
  const aimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 1.4), transparent: true, opacity: 0.5, depthWrite: false });
  const R = mulberry(77);
  const counts = [2, 3, 3, 3];
  const celBase = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.32, metalness: 0.35, emissive: '#a77bff', emissiveMap: TEX.vein, emissiveIntensity: 1.3 });
  const celArcher = celBase.clone(); celArcher.emissive = new THREE.Color('#ff9ad6');
  const beastBase = new THREE.MeshStandardMaterial({ color: '#2b1d1a', roughness: 0.4, metalness: 0.4, emissive: '#ff6a3a', emissiveMap: TEX.vein, emissiveIntensity: 1.4 });
  const beastArcher = beastBase.clone(); beastArcher.emissive = new THREE.Color('#ffae4a');
  const spawn = (x, z, guard, type = 'melee', fy, leash, earth) => {
    const archer = type === 'archer';
    const g = new THREE.Group();
    const mat = (earth ? (archer ? beastArcher : beastBase) : fy !== undefined ? (archer ? celArcher : celBase) : archer ? archerBase : shadeMatBase).clone();
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat);
    body.scale.set(archer ? 0.55 : 0.75, archer ? 1.75 : 1.55, archer ? 0.55 : 0.75); body.position.y = 1.55; body.castShadow = true; g.add(body);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), maskMat);
    mask.rotation.x = Math.PI / 2; mask.position.set(0, 2.05, archer ? 0.17 : 0.22); mask.scale.set(archer ? 0.8 : 1, 0.55, 1.15); g.add(mask);
    const ring = archer ? new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 6, 40, Math.PI * 1.15), ringMat) : new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, 40, Math.PI * 1.55), ringMat);
    if (archer) { ring.position.set(0, 1.6, 0.45); ring.rotation.set(0, 0, Math.PI / 2 - 0.57); }
    else { ring.position.y = 1.5; ring.rotation.x = Math.PI / 2 - 0.3; }
    g.add(ring);
    const glint = new THREE.Sprite(glintMat); glint.position.set(0, 2.25, 0.35); glint.scale.setScalar(0.01); g.add(glint);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), blob.material); sh.rotation.x = -Math.PI / 2; scene.add(sh);
    let aim = null;
    if (archer) { aim = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), aimMat); aim.visible = false; scene.add(aim); noReflect(aim); }
    scene.add(noReflect(g)); noReflect(sh);
    const y = earth ? Math.max(C.EARTH_Y, C.groundAtL(x, z, 1)) : fy ?? Math.max(0, groundAt(x, z));
    g.position.set(x, y, z);
    const hp = archer ? 70 : 100;
    const s = { type, g, body, mat, mask, ring, glint, aim, shards: [], sh, home: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), hp, maxHp: hp, st: 'idle', t: 0, ph: R() * 6, guard, dead: false, hitT: 0, dir: new THREE.Vector3(0, 0, 1), wander: new THREE.Vector3(x, 0, z), wt: 0, cd: 1 + R() * 1.5, r: 0.6, hy: 2.8, emis: archer ? '#e7a6ff' : '#ffc766' };
    if (earth) { s.earth = true; s.emis = archer ? '#ffae4a' : '#ff6a3a'; s.hp = s.maxHp = archer ? 130 : 190; }
    else if (fy !== undefined) { s.floor = fy; s.leash = leash; s.realm = true; s.emis = archer ? '#ff9ad6' : '#a77bff'; s.hp = s.maxHp = archer ? 110 : 160; }
    shades.push(s);
    return s;
  };
  SHRINES.forEach((def, i) => {
    W.shrines[i].guards = [];
    for (let k = 0; k <= counts[i]; k++) {
      const a = (k / (counts[i] + 1)) * Math.PI * 2 + R(), rr = k === counts[i] ? 15 + R() * 3 : 9 + R() * 3;
      const sh = spawn(def.x + Math.cos(a) * rr, def.z + Math.sin(a) * rr, i, k === counts[i] ? 'archer' : 'melee');
      W.shrines[i].guards.push(sh);
      if (prog.s[i]) killShade(sh, true);
    }
    if (prog.s[i]) { W.shrines[i].lit = true; W.shrines[i].power = 1; }
  });
  spawn(-46, -38, -1); spawn(62, 78, -1); spawn(-110, 90, -1); spawn(70, 60, -1, 'archer');
  for (const [x, y, z, type, isle] of REALM.enemies) spawn(x, z, -1, type, y, isle);
  for (const [x, z, type] of EARTH.enemies) spawn(x, z, -1, type, undefined, undefined, true);
  // projectile pool: dark feathers
  const pm = new THREE.MeshStandardMaterial({ map: TEX.feather, color: '#26202e', emissive: '#c78cff', emissiveMap: TEX.feather, emissiveIntensity: 1.6, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(getFeatherGeo(), pm); m.scale.set(0.22, 0.75, 1); m.visible = false;
    const holder = new THREE.Group(); holder.add(m); m.rotation.x = Math.PI / 2; m.position.z = -0.35; scene.add(noReflect(holder));
    projectiles.push({ g: holder, on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, dmg: 12 });
  }
  refreshSockets();
}
const projectiles = [];
function fireProjectile(from, to, speed = 17, dmg = 12) {
  const pr = projectiles.find((p) => !p.on); if (!pr) return;
  pr.on = true; pr.life = 3.2; pr.dmg = dmg;
  pr.pos.copy(from); pr.vel.copy(to).sub(from).normalize().multiplyScalar(speed);
  pr.g.visible = true; pr.g.children[0].visible = true;
  pr.g.position.copy(from); pr.g.lookAt(_v.copy(from).add(pr.vel));
}
function updateProjectiles(dt) {
  for (const pr of projectiles) {
    if (!pr.on) continue;
    pr.life -= dt;
    pr.pos.addScaledVector(pr.vel, dt);
    pr.g.position.copy(pr.pos);
    if (Math.random() < 0.7) emit(FX.smoke, { x: pr.pos.x, y: pr.pos.y, z: pr.pos.z, vx: 0, vy: 0.3, vz: 0, life: 0.6, s: 1.1, c: [0.16, 0.12, 0.22], g: 0, drag: 2 });
    const dy = pr.pos.y - (P.pos.y + 1.0);
    if (state === 'play' && Math.hypot(pr.pos.x - P.pos.x, dy, pr.pos.z - P.pos.z) < 0.8) {
      if (P.inv <= 0) { hurtPlayer(pr.dmg, pr.pos); pr.life = 0; }
    }
    if (pr.life <= 0 || pr.pos.y < groundAt(pr.pos.x, pr.pos.z) - 0.2 || (C.LAYER.cur === 0 && pr.pos.y < 0.05 && Math.hypot(pr.pos.x - LAKE.x, pr.pos.z - LAKE.z) < LAKE.r * 1.2)) {
      pr.on = false; pr.g.visible = false;
      burst(FX.sparks, pr.pos.x, pr.pos.y, pr.pos.z, 8, { speed: 3, life: 0.4, size: 0.7, c: [1.2, 0.8, 1.5] });
    }
  }
}
function killShade(s, silent) {
  s.dead = true; s.st = 'dead'; s.t = silent ? 9 : 0;
  if (!silent) { const k = s.realm ? 'celestial' : s.earth ? 'beast' : 'shade'; prog.kills[k] = (prog.kills[k] || 0) + 1; save(); }
  if (silent) { s.g.visible = false; s.sh.visible = false; }
}
function shadesAlive(i) { return W.shrines[i].guards.filter((s) => !s.dead).length; }
function damageShade(s, dmg, from, kind = 'hit') {
  if (s.dead) return;
  s.hp -= dmg; s.hitT = 0.15;
  const d = _v.copy(s.pos).sub(from); d.y = 0; d.normalize();
  s.vel.addScaledVector(d, 4 + dmg * 0.07);
  s.st = 'hurt'; s.t = 0;
  if (s.aim) s.aim.visible = false;
  burst(FX.sparks, s.pos.x, s.pos.y + 1.6, s.pos.z, 10 + Math.min(30, dmg / 4), { speed: 5, up: 1, life: 0.5, size: 0.8 });
  FX.flashLight.position.set(s.pos.x, s.pos.y + 1.6, s.pos.z); FX.flashLight.intensity = 5 + dmg * 0.05;
  CAM.shake = Math.max(CAM.shake, 0.1 + Math.min(0.25, dmg * 0.002));
  hitstop = Math.max(hitstop, dmg > 60 ? 0.1 : 0.055);
  dmgNumber(_p.set(s.pos.x, s.pos.y + 2.3, s.pos.z), Math.round(dmg), kind);
  Audio.sfx('hit');
  if (s.hp <= 0) {
    killShade(s, false);
    if (P.lock === s) P.lock = null;
    Audio.sfx('purify');
    burst(FX.sparks, s.pos.x, s.pos.y + 1.6, s.pos.z, 60, { speed: 6, up: 3, life: 1.4, size: 1.3, c: [1.9, 1.5, 0.8] });
    featherBurst(s.pos.x, s.pos.y + 1.6, s.pos.z, 8, 3);
    for (let k = 0; k < 18; k++) emit(FX.smoke, { x: s.pos.x, y: s.pos.y + 1.5, z: s.pos.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 1.2, s: 3, c: [0.09, 0.08, 0.12], g: 0.5 });
    toast('<i class="dia"></i>蝕影已淨化 · PURIFIED');
    if (s.guard >= 0 && shadesAlive(s.guard) === 0) setTimeout(() => toast(`<i class="dia"></i>${SHRINES[s.guard].name}的封印已解除`, true), 700);
    updateQuest();
  }
}
function updateShades(dt) {
  for (const s of shades) {
    if (!s.realm && !!s.earth !== (C.LAYER.cur === 1)) { if (!s.dead) { s.g.visible = false; s.sh.visible = false; } continue; }
    const far = Math.abs(s.pos.x - P.pos.x) > 110 || Math.abs(s.pos.z - P.pos.z) > 110 || Math.abs(s.pos.y - P.pos.y) > 60;
    if (!s.dead) { s.g.visible = !far; s.sh.visible = !far; if (far && s.st === 'idle') continue; }
    if (s.dead) {
      if (s.t < 1) {
        s.t += dt;
        const k = s.t;
        s.g.scale.setScalar(Math.max(0.001, 1 - k)); s.g.position.y += dt * 1.5;
        s.mat.emissiveIntensity = 4 * (1 - k); s.sh.visible = k < 0.9;
        if (k >= 1) s.g.visible = false;
      }
      continue;
    }
    s.t += dt; s.hitT -= dt;
    const toP = _v.copy(P.pos).sub(s.pos); toP.y = 0;
    const dist = toP.length();
    const homeD = Math.hypot(s.pos.x - s.home.x, s.pos.z - s.home.z);
    const archer = s.type === 'archer';
    const aggro = state === 'play' && dist < (archer ? 24 : 14) && Math.abs(P.pos.y - s.pos.y) < 7 && homeD < 34;
    let glint = 0;
    if (archer) {
      switch (s.st) {
        case 'idle': if (aggro) { s.st = 'kite'; s.t = 0; } else { s.vel.multiplyScalar(Math.exp(-3 * dt)); } break;
        case 'kite': {
          if (!aggro) { s.st = 'idle'; break; }
          toP.normalize(); s.dir.copy(toP);
          let want = 0; if (dist < 9) want = -3.2; else if (dist > 17) want = 2.6;
          const side = Math.sin(time * 0.7 + s.ph) * 2.2;
          s.vel.x = damp(s.vel.x, toP.x * want - toP.z * side, 3, dt); s.vel.z = damp(s.vel.z, toP.z * want + toP.x * side, 3, dt);
          s.cd -= dt;
          if (s.cd < 0 && dist < 22) { s.st = 'aim'; s.t = 0; }
          break;
        }
        case 'aim': {
          s.vel.multiplyScalar(Math.exp(-8 * dt));
          if (dist > 0.1) s.dir.copy(toP.normalize());
          glint = clamp(s.t / 0.75, 0, 1);
          const from = _p.set(s.pos.x, s.pos.y + 1.7, s.pos.z), to = new THREE.Vector3(P.pos.x, P.pos.y + 1.1, P.pos.z);
          s.aim.visible = true; s.aim.position.copy(from).lerp(to, 0.5); s.aim.lookAt(to); s.aim.scale.set(1 - glint * 0.6, 1 - glint * 0.6, from.distanceTo(to));
          s.aim.material.opacity = 0.2 + glint * 0.5;
          if (s.t > 0.8) {
            s.aim.visible = false;
            const lead = to.clone().addScaledVector(P.vel, 0.25);
            fireProjectile(from.clone(), lead, 17, 12);
            Audio.sfx('dash');
            s.st = 'kite'; s.t = 0; s.cd = 2.1 + Math.random() * 1.3;
          }
          break;
        }
        case 'hurt': s.vel.multiplyScalar(Math.exp(-6 * dt)); if (s.t > 0.45) { s.st = 'kite'; s.t = 0; s.cd = Math.max(s.cd, 0.6); } break;
      }
    } else {
      switch (s.st) {
        case 'idle': {
          if (aggro) { s.st = 'chase'; s.t = 0; break; }
          s.wt -= dt;
          if (s.wt < 0) { s.wt = 2 + Math.random() * 3; const a = Math.random() * 6.28; s.wander.set(s.home.x + Math.cos(a) * 5, 0, s.home.z + Math.sin(a) * 5); }
          const d = _p.set(s.wander.x - s.pos.x, 0, s.wander.z - s.pos.z);
          if (d.length() > 0.5) { d.normalize(); s.vel.x = damp(s.vel.x, d.x * 1.3, 3, dt); s.vel.z = damp(s.vel.z, d.z * 1.3, 3, dt); s.dir.copy(d); }
          break;
        }
        case 'chase': {
          if (!aggro) { s.st = 'idle'; break; }
          toP.normalize(); s.dir.copy(toP);
          s.vel.x = damp(s.vel.x, toP.x * 3.6, 4, dt); s.vel.z = damp(s.vel.z, toP.z * 3.6, 4, dt);
          if (dist < 3.4 && s.t > 0.6) { s.st = 'wind'; s.t = 0; }
          break;
        }
        case 'wind': {
          s.vel.multiplyScalar(Math.exp(-6 * dt));
          if (dist > 0.1) s.dir.copy(toP.normalize());
          s.mat.emissiveIntensity = 1.3 + s.t * 6;
          s.body.position.x = Math.sin(s.t * 70) * 0.04;
          glint = clamp((s.t - 0.25) / 0.3, 0, 1);
          if (s.t > 0.6) { s.st = 'lunge'; s.t = 0; s.vel.copy(s.dir).multiplyScalar(13); s.body.position.x = 0; Audio.sfx('dash'); }
          break;
        }
        case 'lunge': {
          s.vel.multiplyScalar(Math.exp(-2.5 * dt));
          if (dist < 1.25 && Math.abs(P.pos.y - s.pos.y) < 2) hurtPlayer(16, s.pos);
          if (s.t > 0.4) { s.st = 'recover'; s.t = 0; }
          break;
        }
        case 'recover': s.vel.multiplyScalar(Math.exp(-5 * dt)); s.mat.emissiveIntensity = damp(s.mat.emissiveIntensity, 1.3, 6, dt); if (s.t > 0.9) { s.st = aggro ? 'chase' : 'idle'; s.t = 0; } break;
        case 'hurt': s.vel.multiplyScalar(Math.exp(-6 * dt)); if (s.t > 0.4) { s.st = 'chase'; s.t = 0.3; } break;
      }
    }
    s.glint.scale.setScalar(glint > 0 ? (0.4 + glint * 1.1) * (0.85 + Math.sin(time * 40) * 0.15) : 0.001);
    s.pos.addScaledVector(s.vel, dt);
    for (const c of colliders.solids) {
      const dx = s.pos.x - c.x, dz = s.pos.z - c.z, d2 = dx * dx + dz * dz, rr = c.r + 0.6;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); s.pos.x = c.x + (dx / d) * rr; s.pos.z = c.z + (dz / d) * rr; }
    }
    if (s.leash) { const lx = s.pos.x - s.leash.x, lz = s.pos.z - s.leash.z, ld = Math.hypot(lx, lz), lr = (s.leash.lr ?? s.leash.r) - 1.4; if (ld > lr) { s.pos.x = s.leash.x + (lx / ld) * lr; s.pos.z = s.leash.z + (lz / ld) * lr; } }
    const gy = s.floor ?? Math.max(s.earth ? C.EARTH_Y : 0, groundAt(s.pos.x, s.pos.z));
    const padTop = s.floor !== undefined ? -999 : padHeightAt(s.pos.x, s.pos.z, gy + 2);
    s.pos.y = damp(s.pos.y, Math.max(gy, padTop), 8, dt);
    s.g.position.set(s.pos.x, s.pos.y + Math.sin(time * 2 + s.ph) * 0.15, s.pos.z);
    if (s.dir.lengthSq() > 0.01) s.g.rotation.y = dampAngle(s.g.rotation.y, Math.atan2(s.dir.x, s.dir.z), 6, dt);
    s.body.rotation.y += dt * 0.8;
    if (!archer) s.ring.rotation.z += dt * 1.6;
    if (s.hitT > 0) s.mat.emissive.setRGB(3, 3, 3); else s.mat.emissive.set(s.emis);
    s.sh.position.set(s.pos.x, gy + 0.05, s.pos.z);
    if (Math.random() < dt * 14) emit(FX.smoke, { x: s.pos.x + (Math.random() - 0.5) * 0.6, y: s.pos.y + 0.6 + Math.random() * 1.6, z: s.pos.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.4, life: 1.6, s: 1.6 + Math.random() * 1.2, c: [0.1, 0.09, 0.14], g: 0.2, drag: 0.5 });
  }
}
function respawnShades() {
  for (const s of shades) {
    if (s.dead) continue;
    s.hp = s.maxHp; s.pos.copy(s.home); s.vel.set(0, 0, 0); s.st = 'idle';
    if (s.aim) s.aim.visible = false;
  }
  for (const pr of projectiles) { pr.on = false; pr.g.visible = false; }
}

// ------------------------------------------------------------------ 墮天錄 · the codex of the fallen
const CODEX = [
  { id: 'ophiel', key: 'boss', name: '墮光守衛 · 歐菲爾', en: 'OPHIEL, THE FALLEN WARDEN', where: '墮翼之丘', threat: 3, weak: '躍擊落地後的破綻', moves: '橫掃 · 重劈 · 躍擊 · 震地光環', reward: '守衛之盾 · 墮光大劍', col: '#2a2230', acc: '#e3b866',
    lore: ['曾經守護聖所大門的熾天使。大地失去光芒的那天，他第一個拔劍，也第一個墮落。', '淨化之後，他的石像依然面向聖所，像在等待一聲召回。'] },
  { id: 'astraea', key: 'boss2', name: '審判者 · 阿斯特萊亞', en: 'ASTRAEA, THE ARBITER', where: '審判之環', threat: 4, weak: '彈幕結束後的硬直', moves: '審判之槍 · 羽刃彈幕 · 光環', reward: '審判之翼', col: '#24346e', acc: '#d7b468',
    lore: ['以天秤衡量一切的審判者。她判決天界有罪，於是親手熄滅了神域的光。', '她的天秤至今仍向一邊傾斜——沒有人知道，她最後審判的是誰。'] },
  { id: 'camael', key: 'boss3', name: '墮天騎士 · 卡麥爾', en: 'CAMAEL, THE FALLEN KNIGHT', where: '傾城遺跡', threat: 5, weak: '重斬後的長硬直', moves: '重斬 · 躍擊 · 衝擊波 · 灼羽彈幕', reward: '騎士之誓', col: '#5a1820', acc: '#ff8a5a',
    lore: ['曾率領天軍守護人間的騎士長。他守護的城最終傾倒，他亦隨之墮落。', '淨化之後，遺跡的地底仍傳出低沉的心跳……'] },
  { id: 'shade', kill: 'shade', name: '蝕影', en: 'SHADE', where: '光羽之境', threat: 1, weak: '完美閃避後的反擊', moves: '突刺 · 暗羽箭', col: '#26202e', acc: '#ffc766',
    lore: ['光熄滅後，由殘留的影子凝成的守衛。它們守著聖壇，卻不記得為何而守。', '每一隻蝕影的面具上，都刻著同一個名字。'] },
  { id: 'cel', kill: 'celestial', name: '墮化天兵', en: 'FALLEN SENTINEL', where: '天上神域', threat: 2, weak: '突進後的空隙', moves: '突進 · 光矢', col: '#efe9dc', acc: '#a77bff',
    lore: ['神域的守衛，被紫色的裂紋侵蝕。它們仍在巡邏，守護一座已無神明的天庭。', '裂紋的紋路與地獄的法陣如出一轍。'] },
  { id: 'beast', kill: 'beast', name: '瘴獸', en: 'MIASMA BEAST', where: '人間', threat: 2, weak: '聖環 · 重擊', moves: '撲擊 · 灼羽', col: '#2b1d1a', acc: '#ff6a3a',
    lore: ['墜光之後，從大地裂縫湧出的瘴氣所化。它們畏懼光，卻被光羽吸引。', '瘴氣的源頭，似乎在比人間更深的地方。'] },
];
let codexSel = 0;
function codexState(c) {
  if (c.key) return prog[c.key] ? 2 : prog.seen[c.key] ? 1 : 0;
  const n = prog.kills[c.kill] || 0; return n >= 8 ? 2 : n >= 1 ? 1 : 0;
}
function codexEmblem(c, st) {
  const body = st === 0 ? '#b9b2a4' : st === 2 && c.key ? '#f1ece1' : c.col, acc = st === 0 ? '#9a927f' : c.acc;
  const wing = (sx) => `<path transform="translate(60 54) scale(${sx} 1)" d="M6 0 C26 -26 52 -30 58 -14 C46 -12 40 -6 36 2 C44 0 50 4 50 12 C38 8 30 10 24 16 C28 20 28 26 24 30 C16 22 10 14 6 8 Z" fill="${body}" stroke="${acc}" stroke-width="1.2" opacity="${st ? 0.95 : 0.6}"/>`;
  return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="${acc}" stroke-width=".8" stroke-dasharray="2 4"/>${wing(1)}${wing(-1)}
    <ellipse cx="60" cy="28" rx="13" ry="4" fill="none" stroke="${acc}" stroke-width="1.6"/><circle cx="60" cy="40" r="7" fill="${body}" stroke="${acc}" stroke-width="1"/>
    <path d="M60 47 L72 92 L48 92 Z" fill="${body}" stroke="${acc}" stroke-width="1"/>${st === 0 ? `<text x="60" y="76" text-anchor="middle" font-size="26" fill="${acc}" font-family="serif">?</text>` : ''}
    ${st === 2 && c.key ? `<text x="60" y="112" text-anchor="middle" font-size="9" letter-spacing="3" fill="#a88444" font-family="Cinzel,serif">PURIFIED</text>` : ''}</svg>`;
}
function renderCodex() {
  $('codexList').innerHTML = CODEX.map((c, i) => {
    const st = codexState(c);
    const tag = c.key ? (st === 2 ? '已淨化' : st === 1 ? '交戰過' : '未知') : `${prog.kills[c.kill] || 0}`;
    return `<li class="${i === codexSel ? 'sel' : ''} ${st ? '' : 'unk'}" data-i="${i}"><i class="dia"></i><span>${st ? c.name.split(' · ')[0] : '？？？'}</span><em>${tag}</em></li>`;
  }).join('');
  const c = CODEX[codexSel], st = codexState(c);
  const stars = '✦'.repeat(c.threat) + '<i>' + '✦'.repeat(5 - c.threat) + '</i>';
  const lore = c.lore.map((t, i) => (st > i ? `<p>${t}</p>` : `<p class="lock">${i ? (c.key ? '淨化後解鎖' : '討伐 8 隻後解鎖') : c.key ? '交戰後解鎖' : '討伐 1 隻後解鎖'}</p>`)).join('');
  let extra = '';
  if (c.key && st === 2) extra = `<div class="rw"><b>獎勵</b><span>${c.reward}</span></div>`;
  if (c.id === 'ophiel' && st === 2) extra += `<button class="lbtn" id="cxWeapon"><span>${prog.weapon === 'greatsword' ? '改回聖槍' : '裝備墮光大劍'}</span><small>${prog.weapon === 'greatsword' ? 'SPEAR' : 'GREATSWORD'}</small></button>`;
  $('codexDetail').innerHTML = `<div class="em">${codexEmblem(c, st)}</div><div class="tx">
    <h3>${st ? c.name : '？？？'}</h3><small>${st ? c.en : 'UNKNOWN'}</small>
    <dl><dt>出沒</dt><dd>${st ? c.where : '？'}</dd><dt>危險</dt><dd class="st">${stars}</dd><dt>弱點</dt><dd>${st ? c.weak : '？'}</dd><dt>招式</dt><dd>${st ? c.moves : '？'}</dd></dl>
    ${lore}${extra}</div>`;
  const wb = $('cxWeapon');
  if (wb) wb.addEventListener('click', () => { equipWeapon(prog.weapon === 'greatsword' ? 'spear' : 'greatsword'); Audio.sfx('ui'); renderCodex(); });
}
function openCodex() {
  if (state !== 'play') return;
  paused = true; freeMouse(); $('codexOv').classList.remove('hidden'); renderCodex(); Audio.sfx('ui');
}

// ------------------------------------------------------------------ level up
let lvFx = null, lvUpT = 0;
function updateLvHUD() {
  const n = prog.f.length, lv = P.lv, max = lv >= LV_REQ.length;
  const a = LV_REQ[lv - 1], b = max ? a : LV_REQ[lv];
  $('lvB').textContent = lv;
  $('xpF').style.transform = `scaleX(${max ? 1 : clamp((n - a) / (b - a), 0, 1)})`;
  $('xpN').textContent = max ? 'MAX' : `${n} / ${b}`;
  $('lvw').style.setProperty('--p', max ? 1 : clamp((n - a) / (b - a), 0, 1).toFixed(3));
}
function levelUp(to) {
  if (to <= P.lv) return;
  const o = { hp: P.maxHp, atk: Math.round((P.atkMul - 1) * 100), fl: P.maxFlasks };
  const from = P.lv;
  P.lv = to; applyStats(true);
  if (!lvFx) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 1, 32, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.7, 1.35, 0.8), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.0, 96), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(2.2, 1.6, 0.8), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2;
    scene.add(noReflect(beam), noReflect(ring));
    lvFx = { beam, ring, t: -1 };
  }
  lvFx.t = 0; lvFx.beam.visible = lvFx.ring.visible = true;
  featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 26, 4);
  burst(FX.sparks, P.pos.x, P.pos.y + 1.2, P.pos.z, 90, { speed: 7, up: 5, life: 1.6, size: 1.3, c: [1.9, 1.5, 0.9] });
  flashScreen(0.6); hitstop = Math.max(hitstop, 0.14); CAM.shake = Math.max(CAM.shake, 0.3);
  Audio.sfx('lvup');
  $('lvK').textContent = 'LEVEL UP'; $('lvSmall').textContent = 'LEVEL'; $('lvFromRow').style.display = ''; $('lvT').textContent = '光羽之力 · 增強';
  $('lvFrom').textContent = from; $('lvNum').textContent = to;
  const rows = [['生命上限', o.hp, P.maxHp], ['攻擊力', `+${o.atk}%`, `+${Math.round((P.atkMul - 1) * 100)}%`]];
  if (P.maxFlasks > o.fl) rows.push(['聖瓶', o.fl, P.maxFlasks]);
  $('lvStats').innerHTML = rows.map(([k, a, b], i) => `<li style="--d:${0.9 + i * 0.16}s"><span>${k}</span><s>${a}</s><i>→</i><b>${b}</b></li>`).join('');
  const perk = Object.entries(LV_PERK).filter(([l]) => +l > from && +l <= to).map(([, t]) => t).join('　·　');
  $('lvPerk').textContent = perk; $('lvPerk').classList.toggle('hidden', !perk);
  const el = $('lvUp'); el.classList.remove('hidden', 'on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(lvUpT); lvUpT = setTimeout(() => el.classList.add('hidden'), window.__lvHold || 4600);
  updateLvHUD(); updateQuest();
}
function updateLvFx(dt) {
  if (!lvFx || lvFx.t < 0) return;
  lvFx.t += dt;
  const t = lvFx.t, k = clamp(t / 2.4, 0, 1);
  lvFx.beam.position.set(P.pos.x, P.pos.y - 0.3, P.pos.z);
  lvFx.beam.scale.set(1 + k * 0.5, easeOut(clamp(t / 0.35, 0, 1)) * 22, 1 + k * 0.5);
  lvFx.beam.material.opacity = (1 - k) * (1 - k) * 0.55;
  lvFx.ring.position.set(P.pos.x, support(P.pos.x, P.pos.z, P.pos.y + 0.1).h + 0.08, P.pos.z);
  lvFx.ring.scale.setScalar(1 + easeOut(k) * 10); lvFx.ring.material.opacity = (1 - k) * 0.95; lvFx.ring.rotation.z = t * 0.9;
  if (t < 1.5 && Math.random() < dt * 50) emit(FX.sparks, { x: P.pos.x + (Math.random() - 0.5) * 2.6, y: P.pos.y + Math.random() * 2, z: P.pos.z + (Math.random() - 0.5) * 2.6, vy: 5 + Math.random() * 7, life: 1.3, s: 1.1 });
  if (t > 2.4) { lvFx.t = -1; lvFx.beam.visible = lvFx.ring.visible = false; }
}

// ------------------------------------------------------------------ boss
let bosses = [];
function buildBoss() {
  const G = {
    scene, P, prog, state: () => state, hurtPlayer, burst, FX, dmgNumber, Audio, bigText, toast, regionCard, fireProjectile,
    hitstop: (v) => (hitstop = Math.max(hitstop, v)), shake: (v) => (CAM.shake = Math.max(CAM.shake, v)), flash: flashScreen,
    ui: { bar: $('bossBar'), hp: $('bossHp'), hpD: $('bossHpD') },
    onBossDefeated: () => {
      prog.boss = true; save();
      applyStats(true);
      document.body.classList.remove('boss');
      setTimeout(() => toast('<i class="dia"></i>獲得「光之結晶」· 生命上限 +25', true), 1200);
      setTimeout(() => regionCard('墮光守衛已淨化', 'THE WARDEN RESTS'), 2600);
      setTimeout(() => showPower('shield'), 5200);
      setTimeout(() => toast('<i class="dia"></i>獲得武器「墮光大劍」· 可在墮天錄中裝備', true), 11800);
      updateQuest();
    },
  };
  boss = createBoss(G);
  const boss2 = createBoss(G, {
    key: 'boss2', name: '審判者 · 阿斯特萊亞', en: 'ASTRAEA, THE ARBITER', fallen: false, scale: 3.2, weapon: 'spear', maxHp: 3400, tint: '#24346e', emis: '#1a1f36',
    home: REALM.bossHome, floor: REALM.bossHome.y, arenaR: 14, leash: 38,
    onDefeated: () => {
      prog.boss2 = true; save(); applyStats(true);
      document.body.classList.remove('boss');
      setTimeout(() => toast('<i class="dia"></i>獲得「審判之羽」· 生命上限 +25 · 聖瓶 +1', true), 1200);
      setTimeout(() => regionCard('審判者已淨化', 'THE SERAPH RESTS'), 2600);
      setTimeout(() => showPower('wings'), 5200);
      updateQuest();
    },
  });
  const boss3 = createBoss(G, {
    key: 'boss3', name: '墮天騎士 · 卡麥爾', en: 'CAMAEL, THE FALLEN KNIGHT', fallen: true, scale: 3.5, weapon: 'greatsword', maxHp: 4200, tint: '#5a1820', emis: '#ff5a3a',
    home: EARTH.bossHome, floor: EARTH.castleFloor, arenaR: 18, leash: 40,
    onDefeated: () => {
      prog.boss3 = true; save(); applyStats(true);
      document.body.classList.remove('boss');
      setTimeout(() => toast('<i class="dia"></i>獲得「騎士之誓」· 生命上限 +25 · 攻擊 +10%', true), 1200);
      setTimeout(() => regionCard('墮天騎士已淨化', 'THE KNIGHT RESTS'), 2600);
      setTimeout(() => showPower('oath'), 5200);
      updateQuest();
    },
  });
  bosses = [boss, boss2, boss3];
}

// ------------------------------------------------------------------ collision helpers
function padHeightAt(x, z, y) {
  let best = -999;
  for (const p of colliders.pads) {
    const top = p.dyn ? p.dyn() : p.top;
    if (top <= best) continue;
    const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
    if (d2 >= p.r * p.r || y < top - 0.75 || y <= (p.bot ?? -999)) continue;
    if (p.rf) { const rr = p.rf(Math.atan2(dz, dx)); if (d2 >= rr * rr) continue; }
    best = top;
  }
  return best;
}
function support(x, z, y) {
  let h = groundAt(x, z), water = false;
  const wl = waterAt(x, z); if (h < wl) { h = wl; water = true; }
  const ph = padHeightAt(x, z, y);
  if (ph > h) { h = ph; water = false; }
  return { h, water };
}
function pushOut(pos, rad, prevY = pos.y) {
  const py = Math.max(pos.y, prevY);
  for (const c of colliders.solids) {
    if (pos.y > c.y1 || pos.y + 1.7 < c.y0) continue;
    const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + rad, d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr; }
  }
  for (const p of colliders.pads) { // walls of tall steps / island sides
    const top = p.dyn ? p.dyn() : p.top;
    if (py >= top - 0.75 || pos.y + 1.7 < (p.bot ?? -999)) continue;
    const dx = pos.x - p.x, dz = pos.z - p.z, d2 = dx * dx + dz * dz;
    const rr = (p.rf ? p.rf(Math.atan2(dz, dx)) : p.r) + rad;
    if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = p.x + (dx / d) * rr; pos.z = p.z + (dz / d) * rr; }
  }
}

// ------------------------------------------------------------------ player actions
let hitstop = 0;
const move = { x: 0, y: 0 };
function moveWorld(out) {
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw), rx = Math.cos(CAM.yaw), rz = -Math.sin(CAM.yaw);
  out.set(fx * move.y + rx * move.x, 0, fz * move.y + rz * move.x);
  return out;
}
function canAct() { return state === 'play' && !paused; }
function doJump() {
  if (!canAct() || P.castT >= 0) return;
  if (P.grounded) {
    P.vel.y = 9.4; P.grounded = false; Audio.sfx('jump');
    if (P.onWater) ripple(P.pos.x, P.pos.z, 1.8);
  } else if (!P.glide && P.stamina > 4) {
    P.glide = true; P.vel.y = Math.max(P.vel.y, -1.5); Audio.sfx('glide');
    featherBurst(P.pos.x, P.pos.y + 1.3, P.pos.z, 4, 1.5);
  } else if (P.glide) flap();
}
function flap() {
  if (P.flapCd > 0) return;
  if (P.stamina < 8) { P.glide = false; return; }
  P.flapCd = 0.32; P.stamina -= has('wings') ? 6 : 9; P.staminaDelay = 0.9;
  P.vel.y = Math.min(Math.max(P.vel.y, 0) + 7.2, 9.5);
  P.flapT = 0.35;
  P.vel.x += Math.sin(P.yaw) * 2.2; P.vel.z += Math.cos(P.yaw) * 2.2;
  featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 6, 2.2);
  emit(FX.sparks, { x: P.pos.x, y: P.pos.y + 1, z: P.pos.z, vy: -3, life: 0.6, s: 1.4 });
  Audio.sfx('glide');
}
function doDodge() {
  const w = moveWorld(_v);
  const noInput = w.lengthSq() < 0.04;
  if (canAct() && P.glide && (noInput || !has('wings'))) { P.glide = false; P.vel.y = Math.min(P.vel.y, -6); featherBurst(P.pos.x, P.pos.y + 1.3, P.pos.z, 4, 1.5); return; } // fold wings: dive
  if (canAct() && !P.grounded && has('wings')) { airDash(w, noInput); return; }
  if (!canAct() || P.dashCd > 0 || P.stamina < 14 || P.castT >= 0) return;
  if (noInput && !P.lock && P.grounded && has('shield')) { startGuard(); return; }
  if (noInput) w.set(Math.sin(P.yaw), 0, Math.cos(P.yaw)).multiplyScalar(P.lock ? -1 : 1);
  P.dashDir.copy(w.normalize());
  if (!(P.lock && noInput)) P.yaw = Math.atan2(P.dashDir.x, P.dashDir.z);
  P.dashT = 0.2; P.dashCd = 0.45; P.inv = Math.max(P.inv, 0.32);
  P.stamina -= 14; P.staminaDelay = 0.8; P.glide = false;
  P.atk.kind = null; P.charge = -1; P.healT = -1; P.spin = 0;
  featherBurst(P.pos.x, P.pos.y + 1.0, P.pos.z, 6, 2);
  Audio.sfx('dash');
  if (P.perfectCd <= 0 && threatNear()) perfectDodge();
}
function threatNear() {
  for (const s of shades) {
    if (s.dead) continue;
    const d = s.pos.distanceTo(P.pos);
    if ((s.st === 'wind' && s.t > 0.35 && d < 4.2) || (s.st === 'lunge' && s.t < 0.3 && d < 3.5) || (s.st === 'aim' && s.t > 0.6)) return true;
  }
  for (const pr of projectiles) if (pr.on && pr.pos.distanceTo(P.pos) < 5) return true;
  return !!(boss && boss.threat && boss.threat(P.pos));
}
function startGuard() {
  if (P.dashCd > 0 || P.stamina < 8) return;
  P.guardT = 0.6; P.dashCd = 0.5; P.stamina -= 8; P.staminaDelay = 0.8; P.atk.kind = null; P.charge = -1; P.vel.x *= 0.2; P.vel.z *= 0.2;
  if (!FX.aegis) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.15, 6), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(2.0, 1.6, 0.9), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    scene.add(noReflect(m)); FX.aegis = m;
  }
  FX.aegis.visible = true; Audio.sfx('dash');
}
function airDash(w, noInput) {
  if (P.airDashCd > 0 || P.stamina < 12) return;
  if (noInput) w.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  w.normalize(); P.yaw = Math.atan2(w.x, w.z);
  P.vel.x = w.x * 30; P.vel.z = w.z * 30; P.vel.y = Math.max(P.vel.y, 2.5);
  P.airDashCd = 0.55; P.stamina -= 12; P.staminaDelay = 0.9; P.glide = true; P.flapT = 0.3;
  featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 10, 3);
  for (let i = 0; i < 14; i++) emit(FX.sparks, { x: P.pos.x - w.x * i * 0.5, y: P.pos.y + 1.1, z: P.pos.z - w.z * i * 0.5, vx: -w.x * 4, vz: -w.z * 4, life: 0.5, s: 1.2 });
  Audio.sfx('dash');
}
function quake() {
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), cx = P.pos.x + fx * 2.5, cz = P.pos.z + fz * 2.5, gy = support(cx, cz, P.pos.y + 1).h;
  CAM.shake = Math.max(CAM.shake, 0.8); hitstop = Math.max(hitstop, 0.1);
  burst(FX.smoke, cx, gy + 0.4, cz, 40, { speed: 9, up: 2, life: 1.2, size: 2.8, c: [0.9, 0.82, 0.7] });
  burst(FX.sparks, cx, gy + 0.6, cz, 60, { speed: 10, up: 4, life: 1, size: 1.2, c: [2, 1.4, 0.7] });
  const Wv = FX.wave; Wv.t = 0.35; Wv.m.visible = true; Wv.m.position.set(cx, gy + 0.1, cz);
  for (const e of enemyList()) { const d = Math.hypot(e.pos.x - cx, e.pos.z - cz); if (d < 7 + (e.r || 0.6) && Math.abs(e.pos.y - gy) < 4) hitEnemy(e, 90 * P.atkMul, 40, 'crit'); }
  for (const b of breakables) if (!b.broken && b.kind === 'rock' && Math.hypot(b.x - cx, b.z - cz) < 7.5 && Math.abs(b.y - gy) < 6) breakIt(b);
  Audio.sfx('thrust');
}
// ---- seals & cracked rocks: what the purified's powers open up
const breakables = [], BREAK_F = [];
function buildBreakables() {
  const sealMat = new THREE.MeshStandardMaterial({ color: '#1c1624', roughness: 0.25, metalness: 0.6, emissive: '#9a5cff', emissiveMap: TEX.vein, emissiveIntensity: 1.6 });
  const rockMat = new THREE.MeshStandardMaterial({ color: '#7a7066', roughness: 0.9 }); rockMat.emissive = new THREE.Color('#ff8a3a'); rockMat.emissiveMap = TEX.vein; rockMat.emissiveIntensity = 1.3;
  const shard = new THREE.OctahedronGeometry(1, 0);
  const add = (id, kind, x, z, L, feather = true) => {
    const y = C.groundAtL(x, z, L), g = new THREE.Group();
    if (kind === 'seal') {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.28, m = new THREE.Mesh(shard, sealMat); m.scale.set(0.5, 3.4, 0.5); m.position.set(Math.cos(a) * 2.6, 2.4, Math.sin(a) * 2.6); m.rotation.set(Math.sin(a) * -0.38, 0, Math.cos(a) * 0.38); m.castShadow = true; g.add(m); }
      const top = new THREE.Mesh(shard, sealMat); top.scale.set(1.2, 1.6, 1.2); top.position.y = 5.2; g.add(top);
    } else {
      const rg = rockGeo(id.length * 7 + 3, 2), rp = rg.attributes.position, uv = new Float32Array(rp.count * 2);
      for (let i = 0; i < rp.count; i++) { uv[i * 2] = (Math.atan2(rp.getZ(i), rp.getX(i)) / 6.283 + 0.5) * 3; uv[i * 2 + 1] = rp.getY(i) * 1.2 + 0.5; }
      rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const m = new THREE.Mesh(rg, rockMat); m.scale.set(3.4, 2.6, 3.2); m.position.y = 1.6; m.castShadow = m.receiveShadow = true; g.add(m);
    }
    g.position.set(x, y, z); scene.add(g);
    const col = { x, z, r: 3.3, y0: y - 1, y1: y + 6 };
    colliders.solids.push(col);
    const b = { id, kind, x, y, z, g, col, broken: !!prog.broken[id], need: kind === 'seal' ? 'shield' : 'oath', gate: !feather };
    if (b.broken) { g.visible = false; col.y1 = -1e9; }
    if (feather) BREAK_F.push([x, y + 1.4, z]);
    breakables.push(b);
  };
  add('sealElder', 'seal', -178, 80, 0); add('sealNorth', 'seal', -60, -160, 0); add('sealWood', 'seal', -200, 40, 1);
  add('rockLake', 'rock', 40, 110, 0); add('rockPeak', 'rock', 180, 160, 1); add('rockKeep', 'rock', -104, -150, 1, false);
}
function breakIt(b) {
  b.broken = true; prog.broken[b.id] = true; save();
  b.g.visible = false; b.col.y1 = -1e9;
  burst(FX.sparks, b.x, b.y + 2, b.z, 70, { speed: 8, up: 4, life: 1.2, size: 1.2, c: b.kind === 'seal' ? [1.4, 0.9, 2.0] : [2, 1.3, 0.6] });
  burst(FX.smoke, b.x, b.y + 1, b.z, 30, { speed: 6, up: 2, life: 1.3, size: 2.4, c: [0.7, 0.65, 0.6] });
  CAM.shake = Math.max(CAM.shake, 0.4); Audio.sfx('perfect');
  toast(b.gate ? '<i class="dia"></i>裂石崩開 · 地底深處傳來灼熱的氣息……' : b.kind === 'seal' ? '<i class="dia"></i>黑晶封印已碎' : '<i class="dia"></i>裂石崩開', true);
}
let breakHintT = 0;
function updateBreakables(dt) {
  breakHintT -= dt;
  for (const b of breakables) {
    if (b.broken || Math.abs(b.y - P.pos.y) > 6) continue;
    const d = Math.hypot(P.pos.x - b.x, P.pos.z - b.z);
    if (d > 5) continue;
    if (b.kind === 'seal' && P.dashT > 0 && has('shield')) { breakIt(b); continue; }
    if (d < 4.4 && breakHintT <= 0) { breakHintT = 5; toast(has(b.need) ? (b.kind === 'seal' ? '<i class="dia"></i>以盾衝刺擊碎黑晶封印' : '<i class="dia"></i>蓄滿力重擊震碎裂石') : `<i class="dia"></i>需要「${POWERS[b.need].name}」`); }
  }
  if (FX.aegis) {
    FX.aegis.visible = P.guardT > 0;
    if (P.guardT > 0) { FX.aegis.position.set(P.pos.x + Math.sin(P.yaw) * 0.9, P.pos.y + 1.2, P.pos.z + Math.cos(P.yaw) * 0.9); FX.aegis.rotation.set(0, P.yaw, time * 2); FX.aegis.material.opacity = Math.min(1, P.guardT * 3); }
  }
}
function showPower(k) {
  const pw = POWERS[k];
  $('lvK').textContent = 'NEW POWER'; $('lvSmall').textContent = 'POWER'; $('lvNum').textContent = pw.glyph; $('lvFromRow').style.display = 'none';
  $('lvT').textContent = pw.name; $('lvStats').innerHTML = `<li class="en" style="--d:.9s">${pw.en}</li>`;
  $('lvPerk').textContent = pw.desc; $('lvPerk').classList.remove('hidden');
  const el = $('lvUp'); el.classList.remove('hidden', 'on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(lvUpT); lvUpT = setTimeout(() => el.classList.add('hidden'), window.__lvHold || 6200);
  Audio.sfx('lvup'); flashScreen(0.5); featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 20, 4);
}
function equipWeapon(w) { prog.weapon = w; save(); hero.setWeapon(w); }
function perfectDodge() {
  slowT = 0.8; P.inv = Math.max(P.inv, 0.95); P.counterT = 1.8; P.perfectCd = 1.1;
  bigText('完美閃避', 'PERFECT DODGE');
  featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 14, 3.5);
  burst(FX.sparks, P.pos.x, P.pos.y + 1, P.pos.z, 40, { speed: 6, up: 1, life: 0.8, size: 1, c: [1.9, 1.6, 1.0] });
  const Wv = FX.wave; Wv.t = 0.35; Wv.m.visible = true; Wv.m.position.set(P.pos.x, support(P.pos.x, P.pos.z, P.pos.y).h + 0.08, P.pos.z);
  Audio.sfx('perfect');
  const w = $('witch'); w.classList.remove('on'); void w.offsetWidth; w.classList.add('on');
}
function enemyList() {
  const l = [];
  for (const s of shades) if (!s.dead && s.g.visible) l.push(s);
  if (boss && boss.targetable()) l.push(boss);
  return l;
}
function nearestEnemy(maxD, cone, camPref) {
  let best = null, bs = 1e9;
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), cx = -Math.sin(CAM.yaw), cz = -Math.cos(CAM.yaw);
  for (const e of enemyList()) {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz) - (e.r || 0.6);
    if (d > maxD || Math.abs(e.pos.y - P.pos.y) > (e.isBoss ? 8 : 4)) continue;
    const n = d + (e.r || 0.6) + 1e-5;
    if (cone > -1.5 && (dx * fx + dz * fz) / n < cone) continue;
    const score = camPref ? d - 7 * ((dx * cx + dz * cz) / n) : d;
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}
function hitEnemy(e, dmg, poise, kind) { if (e.isBoss) e.damage(dmg, poise, P.pos, kind); else damageShade(e, dmg, P.pos, kind); }
function doHit(A) {
  const fx = Math.sin(P.yaw + P.spin), fz = Math.cos(P.yaw + P.spin);
  for (const e of enemyList()) {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz), er = e.r || 0.6;
    if (d - er > A.reach) continue;
    if (Math.abs(e.pos.y - P.pos.y) > (e.hy || 2.8)) continue;
    if (A.cone > -1.5 && d > er + 0.8 && (dx * fx + dz * fz) / (d + 1e-5) < A.cone) continue;
    const dmg = (A.dmg[0] + Math.random() * (A.dmg[1] - A.dmg[0])) * P.atk.mult * P.atkMul;
    hitEnemy(e, dmg, A.poise * P.atk.mult, P.atk.kind === 'counter' || P.atk.kind === 'heavy' ? 'crit' : '');
  }
}
function startAttack(kind, mult = 1) {
  const A = atkT()[kind];
  P.atk = { kind, t: 0, dur: A.dur, hitsDone: 0, queued: false, mult, combo: COMBO.indexOf(kind), quake: kind === 'heavy' && mult >= 1.6 && has('oath') };
  const tgt = P.lock && !P.lock.dead ? P.lock : nearestEnemy(7, -0.2);
  if (tgt) P.yaw = Math.atan2(tgt.pos.x - P.pos.x, tgt.pos.z - P.pos.z);
  else { const w = moveWorld(_v); if (w.lengthSq() > 0.05) P.yaw = Math.atan2(w.x, w.z); }
  let lunge = A.lunge;
  if (tgt) {
    const gap = Math.hypot(tgt.pos.x - P.pos.x, tgt.pos.z - P.pos.z) - (tgt.r || 0.6);
    if (gap < 1.6) lunge *= 0.25;
    else if ((kind === 'counter' || kind === 'heavy' || kind === 'l3') && gap < 11) lunge = Math.max(lunge, Math.min(60, (gap - 1.2) * 9));
  }
  P.vel.x = Math.sin(P.yaw) * lunge; P.vel.z = Math.cos(P.yaw) * lunge;
  P.spin = 0;
  const Ar = FX.arc;
  if (A.arc) {
    Ar.t = 0; Ar.g.visible = true; Ar.g.rotation.y = P.yaw; Ar.tilt.rotation.set(...A.arc.tilt);
    Ar.mat.uniforms.uT0.value = A.arc.t0; Ar.mat.uniforms.uLen.value = A.arc.len; Ar.mat.uniforms.uRev.value = A.arc.rev;
    Ar.g.scale.setScalar((kind === 'counter' ? 1.45 : kind === 'l2' ? 1.1 : 1) * (prog.weapon === 'greatsword' ? 1.25 : 1));
  }
  if (A.thrust) { const L = FX.lance; L.t = 0; L.g.visible = true; L.g.rotation.y = P.yaw; L.g.scale.setScalar(kind === 'heavy' ? 1.5 + (mult - 1) : 1); }
  Audio.sfx(A.sfx);
  if (kind === 'heavy') { featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 6, 2.5); CAM.shake = Math.max(CAM.shake, 0.12); }
  if (kind === 'counter') { bigText('聖裁', 'JUDGEMENT'); burst(FX.sparks, P.pos.x, P.pos.y + 1.2, P.pos.z, 50, { speed: 7, up: 2, life: 0.9, size: 1.1 }); }
}
function lightAttack() {
  if (!canAct() || P.dashT > 0 || P.castT >= 0 || P.healT >= 0) return;
  if (P.glide) P.glide = false;
  if (P.counterT > 0 && !P.atk.kind) { P.counterT = 0; startAttack('counter'); return; }
  if (!P.atk.kind) startAttack('l0');
  else if (P.atk.combo >= 0 && P.atk.t > 0.12) P.atk.queued = true;
}
function attackDown() { if (!canAct()) return; P.atkHeld = true; P.atkDownT = time; }
function attackUp() {
  if (!P.atkHeld) return;
  P.atkHeld = false;
  if (P.charge >= 0) {
    const k = clamp(P.charge / 0.9, 0, 1); P.charge = -1; P.chargeFull = false;
    if (canAct() && k > 0.15) { startAttack('heavy', 1 + k * 0.8); return; }
  }
  lightAttack();
}
function doLock() {
  if (!canAct()) return;
  if (P.lock) { P.lock = null; Audio.sfx('ui'); return; }
  const t = nearestEnemy(28, -2, true);
  if (t) { P.lock = t; Audio.sfx('ui'); }
  else { CAM.recenter = 0.45; CAM.yawTarget = P.yaw + Math.PI; }
}
function doHeal() {
  if (!canAct() || P.flasks <= 0 || P.healT >= 0 || P.hp >= P.maxHp || P.dashT > 0) return;
  P.flasks--; P.healT = 0; P.healed = false; P.atk.kind = null; P.charge = -1;
  Audio.sfx('ui');
}
function nearestShade(maxD, cone) { return nearestEnemy(maxD, cone ?? -2); }
function startSwing() {}
function doAttack() { lightAttack(); }
function doSkill() {
  if (!canAct() || P.skillCd > 0 || P.castT >= 0 || P.dashT > 0) return;
  P.castT = 0; P.skillCd = 7; P.atk.kind = null; P.charge = -1; P.glide = false;
  P.vel.set(0, P.grounded ? 0 : 2, 0);
  Audio.sfx('skill');
  featherBurst(P.pos.x, P.pos.y + 1.5, P.pos.z, 10, 2.5);
}
function skillImpact() {
  const Wv = FX.wave;
  Wv.t = 0; Wv.m.visible = true; Wv.p.visible = true;
  const gy = support(P.pos.x, P.pos.z, P.pos.y).h;
  Wv.m.position.set(P.pos.x, gy + 0.08, P.pos.z);
  Wv.p.position.set(P.pos.x, gy + 8, P.pos.z);
  burst(FX.sparks, P.pos.x, gy + 0.5, P.pos.z, 80, { speed: 9, up: 1.5, life: 1.0, size: 1.0, c: [1.8, 1.5, 1.0], g: -4 });
  FX.flashLight.position.set(P.pos.x, gy + 2, P.pos.z); FX.flashLight.intensity = 14;
  CAM.shake = 0.4;
  flashScreen(0.35);
  for (const e of enemyList()) if (Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - (e.r || 0.6) < 8) hitEnemy(e, 60 + Math.random() * 10, 30, 'crit');
  if (P.onWater) for (let k = 0; k < 3; k++) ripple(P.pos.x, P.pos.z, 3 + k * 2, 1.6 + k * 0.3);
}
function hurtPlayer(dmg, from) {
  if (P.inv > 0 || state !== 'play') return;
  if (P.guardT > 0) {
    const parry = P.guardT > 0.38; P.guardT = 0.12; P.inv = 0.3;
    const d = _p.copy(P.pos).sub(from); d.y = 0; d.normalize(); P.vel.x = d.x * 4; P.vel.z = d.z * 4;
    burst(FX.sparks, P.pos.x + Math.sin(P.yaw), P.pos.y + 1.2, P.pos.z + Math.cos(P.yaw), 40, { speed: 7, up: 2, life: 0.6, size: 1, c: [2, 1.7, 1] });
    CAM.shake = Math.max(CAM.shake, 0.2); hitstop = Math.max(hitstop, 0.08);
    if (parry) { perfectDodge(); bigText('聖盾', 'PARRY'); } else Audio.sfx('hit');
    return;
  }
  P.hp -= dmg; P.inv = 0.9; P.hurtT = 0.35; P.lastHurt = time;
  const d = _p.copy(P.pos).sub(from); d.y = 0; d.normalize();
  P.vel.x = d.x * 9; P.vel.z = d.z * 9; P.vel.y = 3.5; P.grounded = false; P.glide = false; P.atk.kind = null; P.charge = -1; P.healT = -1; P.spin = 0;
  CAM.shake = 0.35;
  Audio.sfx('hurt');
  const dmgEl = $('dmg'); dmgEl.classList.remove('on'); void dmgEl.offsetWidth; dmgEl.classList.add('on');
  if (P.hp <= 0) { P.hp = 0; die(); }
}

// ------------------------------------------------------------------ player update
function updatePlayer(dt) {
  const wish = moveWorld(new THREE.Vector3());
  const mag = Math.min(1, wish.length());
  if (mag > 0.01) wish.divideScalar(Math.max(1, wish.length()));
  P.flapCd = (P.flapCd || 0) - dt; P.flapT = (P.flapT || 0) - dt; P.guardT = (P.guardT || 0) - dt; P.airDashCd = (P.airDashCd || 0) - dt;
  P.dashCd -= dt; P.inv -= dt; P.hurtT -= dt; P.skillCd -= dt; P.staminaDelay -= dt;

  P.counterT -= dt; P.perfectCd -= dt;
  // attack timeline
  if (P.atk.kind) {
    const A = atkT()[P.atk.kind];
    P.atk.t += dt;
    while (P.atk.hitsDone < A.hits.length && P.atk.t >= A.hits[P.atk.hitsDone]) { doHit(A); P.atk.hitsDone++; if (P.atk.quake && P.atk.hitsDone === 1) quake(); }
    if (A.spin) P.spin = clamp(P.atk.t / (A.dur * 0.62), 0, 1) * Math.PI * 2;
    const canChain = P.atk.queued && P.atk.combo >= 0 && P.atk.combo < 3;
    if (canChain && P.atk.t >= A.dur * 0.7) startAttack(COMBO[P.atk.combo + 1]);
    else if (P.atk.t >= A.dur) { P.atk.kind = null; P.spin = 0; }
  }
  // charging a heavy thrust (hold attack)
  if (P.atkHeld && P.charge < 0 && time - P.atkDownT > 0.26 && !P.atk.kind && P.dashT <= 0 && P.castT < 0 && P.healT < 0 && P.grounded) { P.charge = 0; Audio.sfx('charge'); }
  if (P.charge >= 0) {
    P.charge += dt;
    if (P.charge > 0.9 && !P.chargeFull) { P.chargeFull = true; hero.tipWorld(0, _tip); burst(FX.sparks, _tip.x, _tip.y, _tip.z, 26, { speed: 3, up: 0.5, life: 0.6, size: 1 }); Audio.sfx('pickup'); }
    if (Math.random() < 0.5) { hero.tipWorld(0, _tip); emit(FX.sparks, { x: _tip.x, y: _tip.y, z: _tip.z, vx: (Math.random() - 0.5), vy: 1, vz: (Math.random() - 0.5), life: 0.4, s: 0.6 + (P.chargeFull ? 0.5 : 0) }); }
  }
  // drinking light dew
  if (P.healT >= 0) {
    P.healT += dt;
    if (P.healT > 0.45 && !P.healed) {
      P.healed = true; P.hp = Math.min(P.maxHp, P.hp + 45);
      burst(FX.sparks, P.pos.x, P.pos.y + 1.2, P.pos.z, 30, { speed: 2, up: 2.5, life: 1, size: 0.9, c: [1.5, 1.8, 1.3] });
      Audio.sfx('pickup');
    }
    if (P.healT > 0.95) P.healT = -1;
  }
  // lock-on upkeep
  if (P.lock) {
    const L = P.lock;
    if (L.dead || (L.isBoss && !L.targetable()) || Math.hypot(L.pos.x - P.pos.x, L.pos.z - P.pos.z) > 34) P.lock = nearestEnemy(20, -2, true);
  }
  if (P.castT >= 0) {
    const prev = P.castT; P.castT += dt;
    if (prev < 0.42 && P.castT >= 0.42) skillImpact();
    if (P.castT > 0.8) P.castT = -1;
  }

  // velocity
  const accelG = P.grounded ? 16 : 4.5;
  if (P.dashT > 0) {
    P.dashT -= dt;
    P.vel.x = P.dashDir.x * 24; P.vel.z = P.dashDir.z * 24;
    if (P.grounded) P.vel.y = 0; else P.vel.y = Math.max(P.vel.y, -2);
    if (Math.random() < 0.6) emit(FX.sparks, { x: P.pos.x + (Math.random() - 0.5) * 0.5, y: P.pos.y + 0.4 + Math.random() * 1.3, z: P.pos.z + (Math.random() - 0.5) * 0.5, life: 0.5, s: 0.7, c: [1.5, 1.35, 1.0] });
  } else if (P.castT >= 0) {
    P.vel.x = damp(P.vel.x, 0, 10, dt); P.vel.z = damp(P.vel.z, 0, 10, dt);
  } else if (P.atk.kind) {
    P.vel.x = damp(P.vel.x, wish.x * 1.0, 9, dt); P.vel.z = damp(P.vel.z, wish.z * 1.0, 9, dt);
  } else if (P.charge >= 0 || P.healT >= 0) {
    const sp = P.charge >= 0 ? 1.1 : 1.6;
    P.vel.x = damp(P.vel.x, wish.x * sp, 10, dt); P.vel.z = damp(P.vel.z, wish.z * sp, 10, dt);
    const L = P.lock; if (L) P.yaw = dampAngle(P.yaw, Math.atan2(L.pos.x - P.pos.x, L.pos.z - P.pos.z), 10, dt);
    else if (mag > 0.1) P.yaw = dampAngle(P.yaw, Math.atan2(wish.x, wish.z), 8, dt);
  } else if (P.glide) {
    const tgtYaw = mag > 0.15 ? Math.atan2(wish.x, wish.z) : P.yaw;
    P.yaw = dampAngle(P.yaw, tgtYaw, 2.4, dt);
    const sp = P.flapT > 0 ? 12.5 : 11;
    P.vel.x = damp(P.vel.x, Math.sin(P.yaw) * sp, 3, dt); P.vel.z = damp(P.vel.z, Math.cos(P.yaw) * sp, 3, dt);
    let lift = has('wings') ? -1.6 : -2.3;
    for (const u of W.updrafts) if (Math.hypot(P.pos.x - u.x, P.pos.z - u.z) < 4.2 && P.pos.y < u.top && P.pos.y > (u.g ?? -99) - 3) { lift = 12; if (Math.random() < 0.3) emit(FX.sparks, { x: P.pos.x + (Math.random() - 0.5) * 3, y: P.pos.y - 1, z: P.pos.z + (Math.random() - 0.5) * 3, vy: 8, life: 0.6, s: 0.6 }); }
    P.vel.y = damp(P.vel.y, lift, P.flapT > 0 ? 0.7 : lift > 0 ? 2.5 : 4, dt);
    P.stamina -= (lift > 0 ? 2 : has('wings') ? 4 : 6) * dt; P.staminaDelay = 0.8;
    if (P.stamina <= 0) { P.stamina = 0; P.glide = false; }
  } else {
    const sprint = mag > 0.88;
    const run = sprint ? 7.2 : lerp(1.6, 5.4, mag / 0.88);
    const strafe = P.lock && !sprint && P.grounded;
    P.vel.x = damp(P.vel.x, wish.x * (strafe ? Math.min(run, 4.2) : run), accelG, dt); P.vel.z = damp(P.vel.z, wish.z * (strafe ? Math.min(run, 4.2) : run), accelG, dt);
    if (strafe) P.yaw = dampAngle(P.yaw, Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z), 10, dt);
    else if (mag > 0.1) P.yaw = dampAngle(P.yaw, Math.atan2(wish.x, wish.z), P.grounded ? 12 : 5, dt);
  }
  if (!P.glide && P.dashT <= 0) P.vel.y -= (P.castT >= 0 ? 8 : 26) * dt;
  { // a long free fall becomes a dive: faster, with rushing wind
    const below = P.pos.y - support(P.pos.x, P.pos.z, P.pos.y).h;
    P.diving = !P.glide && !P.grounded && P.vel.y < -30 && below > 45;
    P.vel.y = Math.max(P.vel.y, P.diving ? -78 : -42);
    if (P.diving && Math.random() < dt * 40) emit(FX.sparks, { x: P.pos.x + (Math.random() - 0.5) * 6, y: P.pos.y - 3 - Math.random() * 6, z: P.pos.z + (Math.random() - 0.5) * 6, vy: 40, life: 0.35, s: 1 });
  }

  const prevY = P.pos.y;
  P.pos.addScaledVector(P.vel, dt);
  pushOut(P.pos, 0.35, prevY);

  const sup = support(P.pos.x, P.pos.z, Math.max(P.pos.y, prevY));
  const wasGround = P.grounded;
  if (P.pos.y <= sup.h) {
    if (!wasGround) {
      const fall = P.lastAirY - sup.h;
      if (P.vel.y < -12) { Audio.sfx('land'); burst(FX.sparks, P.pos.x, sup.h + 0.2, P.pos.z, 10, { speed: 3, up: 0.5, life: 0.5, size: 0.7 }); }
      if (P.vel.y < -34) { CAM.shake = Math.max(CAM.shake, 0.55); burst(FX.smoke, P.pos.x, sup.h + 0.3, P.pos.z, 26, { speed: 7, up: 1, life: 1.1, size: 2.6, c: [0.95, 0.9, 0.82] }); featherBurst(P.pos.x, sup.h + 0.6, P.pos.z, 10, 3); ripple(P.pos.x, P.pos.z, 3.4, 2); }
      if (sup.water) { ripple(P.pos.x, P.pos.z, 2.2, 1.6); ripple(P.pos.x, P.pos.z, 1.2, 1.1); }
      if (fall > 0.5) featherBurst(P.pos.x, sup.h + 0.4, P.pos.z, 2, 1.2);
    }
    P.pos.y = sup.h; P.vel.y = 0; P.grounded = true; P.glide = false;
  } else if (wasGround && P.vel.y <= 0 && P.pos.y - sup.h < 0.55) {
    P.pos.y = sup.h; P.vel.y = 0; P.grounded = true;
  } else {
    if (P.grounded) P.lastAirY = P.pos.y;
    P.grounded = false;
    P.lastAirY = Math.max(P.lastAirY, P.pos.y);
  }
  if (P.grounded) P.lastAirY = P.pos.y;
  P.onWater = P.grounded && sup.water;

  // stamina
  if (P.grounded && P.staminaDelay <= 0) P.stamina = Math.min(100, P.stamina + 32 * dt);
  // hp regen when calm
  if (time - P.lastHurt > 8 && P.hp < P.maxHp && !(boss && boss.engaged)) P.hp = Math.min(P.maxHp, P.hp + 3 * dt);

  // locomotion feel
  const hs = Math.hypot(P.vel.x, P.vel.z);
  P.speed = hs;
  if (P.grounded) P.phase += dt * (2.2 + hs * 1.15);
  if (P.onWater && hs > 0.6) {
    P.stepAcc += hs * dt;
    if (P.stepAcc > 1.05) { P.stepAcc = 0; ripple(P.pos.x + Math.sin(P.yaw) * 0.3, P.pos.z + Math.cos(P.yaw) * 0.3, 0.9, 1.3); }
  } else if (P.onWater) {
    P.idleRipple -= dt;
    if (P.idleRipple < 0) { P.idleRipple = 1.8; ripple(P.pos.x, P.pos.z, 1.1, 2.2); }
  }

  // safe spot + falling into the cloud sea
  P.safeT -= dt;
  const r = Math.hypot(P.pos.x, P.pos.z);
  if (P.grounded && P.safeT < 0 && (P.inRealm ? P.pos.y > REALM.y - 20 : P.inEarth || r < edgeR(Math.atan2(P.pos.z, P.pos.x)) - 16)) { P.safe.copy(P.pos); P.safeT = 0.5; }
  if (P.inRealm && P.pos.y < REALM.y - 70) { P.inRealm = false; currentRegion = ''; updateQuest(); } // dropped out of the Empyrean: fall to the isle below
  if (!P.inEarth && P.pos.y < -70) dropToEarth(); // over the island's edge: through the cloud sea to the human world
  if (P.inEarth) {
    const rr = Math.hypot(P.pos.x, P.pos.z);
    if (rr > 262) { P.pos.x *= 262 / rr; P.pos.z *= 262 / rr; }
    if (P.pos.y < C.EARTH_Y - 60) fallRespawn();
  }
}
function dropToEarth() {
  // punch through the cloud sea and keep falling into the world below
  const rr = Math.hypot(P.pos.x, P.pos.z), k = rr > 205 ? 205 / rr : 1;
  P.pos.set(P.pos.x * k, C.EARTH_Y + 175, P.pos.z * k);
  P.vel.y = Math.min(P.vel.y, -40); P.glide = false; P.grounded = false;
  P.inEarth = true; P.inRealm = false;
  syncLayer();
  flashScreen(0.9); CAM.shake = Math.max(CAM.shake, 0.4);
  const first = !prog.earth; prog.earth = true; save();
  regionCard('人間', 'THE MORTAL WORLD');
  if (first) setTimeout(() => toast('<i class="dia"></i>穿過雲海，墜向人間 · 按「展翼」減速滑翔', true), 900);
  updateQuest();
}
function fallRespawn() {
  flashScreen(0.9);
  P.pos.copy(P.safe); P.vel.set(0, 0, 0); P.glide = false; P.grounded = true;
  P.hp = Math.max(1, P.hp - 20); P.lastHurt = time;
  toast(P.inRealm ? '<i class="dia"></i>墜入雲層 · 光羽將你帶回神域' : '<i class="dia"></i>墜入雲海 · 光羽將你帶回大地');
  Audio.sfx('hurt');
}
function die() {
  state = 'dead'; deadT = 0;
  P.atk.kind = null; P.castT = -1; P.glide = false; P.charge = -1; P.lock = null;
  $('hud').classList.add('dim');
  freeMouse(); setTimeout(() => $('deathOv').classList.remove('hidden'), 700);
}
let deadT = 0;
function revive() {
  $('deathOv').classList.add('hidden');
  $('hud').classList.remove('dim');
  flashScreen(1);
  P.pos.copy(P.checkpoint); P.vel.set(0, 0, 0); P.hp = P.maxHp; P.stamina = 100; P.inv = 2; P.lastHurt = time; P.flasks = P.maxFlasks; hero.resetCloth();
  for (const b of bosses) b.reset();
  P.grounded = true; P.glide = false;
  CAM.yaw = P.yaw + Math.PI;
  respawnShades();
  state = 'play';
}

// ------------------------------------------------------------------ interactions
let interactTarget = null;
function updateInteract() {
  let t = null;
  if (state === 'play') {
    for (const s of W.shrines) {
      if (s.lit) continue;
      const d = Math.hypot(P.pos.x - s.def.x, P.pos.z - s.def.z);
      if (d < 7.5 && Math.abs(P.pos.y - s.y0) < 4) { const n = shadesAlive(s.i); t = n ? { kind: 'sealed', s, n } : { kind: 'shrine', s }; }
    }
    const T = W.temple;
    if (!t && !prog.end && Math.hypot(P.pos.x - T.x, P.pos.z - T.z) < 6.5 && P.pos.y > T.floorY - 1) {
      const lit = prog.s.filter(Boolean).length;
      t = lit === 4 ? { kind: 'core' } : { kind: 'coreLocked', n: lit };
    }
    if (!t && prog.end && !P.inRealm && Math.hypot(P.pos.x - T.x, P.pos.z - T.z) < 6.5 && P.pos.y > T.floorY - 1 && P.pos.y < T.floorY + 6) t = P.lv >= 3 ? { kind: 'ascend' } : { kind: 'ascendLocked', n: P.lv };
    if (!t && P.inRealm && Math.hypot(P.pos.x - REALM.gate.x, P.pos.z - REALM.gate.z) < 5 && Math.abs(P.pos.y - REALM.gate.y) < 3) t = { kind: 'descend' };
    if (!t && P.inEarth && Math.hypot(P.pos.x - EARTH.pillar.x, P.pos.z - EARTH.pillar.z) < 6 && Math.abs(P.pos.y - EARTH.pillar.y) < 5) t = { kind: 'rise' };
  }
  if (JSON.stringify(t && { k: t.kind, n: t.n, i: t.s?.i }) !== JSON.stringify(interactTarget && { k: interactTarget.kind, n: interactTarget.n, i: interactTarget.s?.i })) {
    interactTarget = t;
    const el = $('bInteract');
    if (!t) el.classList.add('hidden');
    else {
      el.classList.remove('hidden');
      el.classList.toggle('locked', t.kind === 'sealed' || t.kind === 'coreLocked' || t.kind === 'ascendLocked');
      const L = {
        shrine: ['點亮聖壇', 'KINDLE THE SHRINE'], sealed: [`淨化周圍的蝕影 <em>${t.n}</em>`, 'SEALED BY SHADES'],
        core: ['觸碰聖核', 'TOUCH THE SACRED CORE'], coreLocked: [`聖核沉睡中 <em>${t.n}/4</em>`, 'LIGHT ALL FOUR SHRINES'],
        ascend: ['升往天上神域', 'ASCEND TO THE EMPYREAN'], ascendLocked: [`光羽之力不足 <em>Lv${t.n}/3</em>`, 'REACH LV 3 TO ASCEND'],
        descend: ['返回人間之島', 'RETURN TO THE ISLE'], rise: ['返回天上之島', 'RETURN TO THE ISLE ABOVE'],
      }[t.kind];
      $('intLbl').innerHTML = L[0]; $('intSub').textContent = L[1];
    }
  }
}
function doInteract() {
  if (!canAct() || !interactTarget) return;
  const t = interactTarget;
  if (t.kind === 'shrine') lightShrine(t.s);
  else if (t.kind === 'core') startEnding();
  else if (t.kind === 'ascend') startTrip(true);
  else if (t.kind === 'descend') startTrip(false);
  else if (t.kind === 'rise') startTrip('rise');
  else if (t.kind === 'ascendLocked') { toast(`<i class="dia"></i>需要 Lv3 才能踏上天梯 · 目前 Lv${P.lv}`); Audio.sfx('ui'); }
  else Audio.sfx('ui');
}
// ---- the stairway of light: temple core ⇄ the Empyrean
let trip = null, tripBeam = null;
function startTrip(up) {
  const T = W.temple;
  const rise = up === 'rise';
  const to = rise ? new THREE.Vector3(SPAWN.x, 0, SPAWN.z) : up ? REALM.landing.clone() : new THREE.Vector3(T.x, T.floorY, T.z + 10);
  trip = { up: !!up, rise, from: P.pos.clone(), to, t: 0, dur: rise ? 5.2 : up ? 4.8 : 3.8 };
  state = 'ascend';
  P.vel.set(0, 0, 0); P.atk.kind = null; P.lock = null; P.castT = -1; P.charge = -1; P.dashT = 0;
  $('hud').classList.add('cine'); interactTarget = null; $('bInteract').classList.add('hidden');
  if (!tripBeam) {
    tripBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1, 32, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.2, 1.75, 1.0), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    tripBeam.material.map = TEX.beam; scene.add(noReflect(tripBeam));
  }
  const bottom = up ? trip.from : to, top = up ? to : trip.from;
  tripBeam.position.set(bottom.x, bottom.y, bottom.z); tripBeam.scale.set(1, top.y - bottom.y + 30, 1); tripBeam.visible = true;
  Audio.sfx('end'); flashScreen(0.45); CAM.shake = 0.2;
}
function updateTrip(dt) {
  trip.t += dt;
  const k = clamp(trip.t / trip.dur, 0, 1), e = easeInOut(k);
  P.pos.x = lerp(trip.from.x, trip.to.x, e); P.pos.z = lerp(trip.from.z, trip.to.z, e);
  if (trip.up) P.pos.y = lerp(trip.from.y, trip.to.y + 5, easeInOut(clamp(k / 0.82, 0, 1))) - (k > 0.82 ? 5 * easeInOut((k - 0.82) / 0.18) : 0);
  else P.pos.y = lerp(trip.from.y, trip.to.y, easeInOut(k));
  P.glide = k > 0.05 && k < 0.95; P.grounded = !P.glide; P.vel.y = trip.up ? 4 : -4;
  P.yaw += dt * 1.6 * Math.sin(k * Math.PI);
  tripBeam.material.opacity = Math.sin(k * Math.PI) * 0.75;
  if (Math.random() < dt * 70) { const a = Math.random() * 6.28, r = 2 + Math.random() * 5; emit(FX.sparks, { x: P.pos.x + Math.cos(a) * r, y: P.pos.y + (trip.up ? -4 : 6) + Math.random() * 3, z: P.pos.z + Math.sin(a) * r, vy: trip.up ? -26 : 26, life: 0.45, s: 1.3 }); }
  if (k >= 1) {
    const up = trip.up, rise = trip.rise; trip = null;
    state = 'play'; P.glide = false; P.grounded = true; P.vel.set(0, 0, 0);
    tripBeam.visible = false;
    $('hud').classList.remove('cine');
    flashScreen(0.85); CAM.shake = 0.35;
    burst(FX.sparks, P.pos.x, P.pos.y + 0.5, P.pos.z, 60, { speed: 6, up: 3, life: 1.2, size: 1.2, c: [1.8, 1.4, 0.9] });
    featherBurst(P.pos.x, P.pos.y + 1, P.pos.z, 14, 3);
    P.inRealm = up && !rise; P.inEarth = false; P.safe.copy(P.pos); P.checkpoint.copy(P.pos);
    currentRegion = rise ? '鏡湖' : up ? '天上神域' : '環光聖所';
    if (rise) regionCard('鏡湖', 'THE MIRROR LAKE');
    else if (up) {
      const first = !prog.realm; prog.realm = true; save();
      regionCard('天上神域', 'THE EMPYREAN');
      if (first) { setTimeout(() => toast('<i class="dia"></i>浮島之間沒有路 · 跳起後按「展翼」，滑翔中再按「振翼」向上飛', true), 2600); setTimeout(() => toast('<i class="dia"></i>按「閃避」收翼俯衝 · 審判之環有審判者在等待'), 7600); }
    } else regionCard('人間之島', 'THE ISLE BELOW');
    updateQuest();
  }
}
function lightShrine(s) {
  s.lit = true; prog.s[s.i] = true; save();
  P.castT = 0; P.atk.kind = null; P.flasks = P.maxFlasks;
  P.checkpoint.set(s.def.x, s.y0 + 1.35, s.def.z + 4.5);
  Audio.sfx('shrine');
  setTimeout(() => {
    burst(FX.sparks, s.def.x, s.topY + 5.6, s.def.z, 120, { speed: 10, up: 3, life: 1.6, size: 1.4, c: [1.8, 1.6, 1.1] });
    featherBurst(s.def.x, s.topY + 3, s.def.z, 14, 4);
    flashScreen(0.6);
    CAM.shake = 0.3;
  }, 380);
  refreshSockets();
  const n = prog.s.filter(Boolean).length;
  setTimeout(() => regionCard(s.def.name + ' · 已點亮', `SHRINE KINDLED  ${n} / 4`), 900);
  if (n === 4) setTimeout(() => toast('<i class="dia"></i>四座聖壇俱已點亮 · 前往環光聖所', true), 3600);
  updateQuest(); interactTarget = null; $('bInteract').classList.add('hidden');
}
function refreshSockets() {
  if (!W.temple) return;
  W.temple.sockets.forEach((g, i) => { g.material.emissiveIntensity = prog.s[i] ? 2.4 : 0; g.material.color.set(prog.s[i] ? '#fff2d0' : '#cfc6b4'); });
  const n = prog.s.filter(Boolean).length;
  W.temple.coreMat.emissiveIntensity = 1.2 + n * 0.6;
}

// ------------------------------------------------------------------ ending
let endT = -1, endBeam = null;
function startEnding() {
  state = 'ending'; endT = 0;
  P.castT = 0; P.vel.set(0, 0, 0);
  $('hud').classList.add('cine');
  Audio.sfx('end');
  if (!endBeam) {
    const T = W.temple;
    const from = new THREE.Vector3(T.x, T.floorY + 3.4, T.z);
    const len = from.distanceTo(HALO_POS);
    const m = new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.4, 1.9, 1.1), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const geo = new THREE.CylinderGeometry(0.7, 2.4, len, 24, 1, true); geo.translate(0, len / 2, 0); geo.rotateX(Math.PI); geo.translate(0, len, 0);
    endBeam = new THREE.Mesh(geo, m);
    endBeam.position.copy(from);
    endBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), HALO_POS.clone().sub(from).normalize());
    endBeam.scale.set(1, 0.001, 1);
    scene.add(endBeam);
  }
}
function updateEnding(dt) {
  endT += dt;
  const T = W.temple;
  const k = clamp(endT / 4.5, 0, 1);
  endBeam.scale.y = Math.max(0.001, easeInOut(clamp((endT - 0.6) / 2.2, 0, 1)));
  endBeam.material.opacity = 0.9;
  W.halo.power = 1 + easeInOut(k) * 1.6;
  W.halo.hMat.color.setRGB(2.4 * W.halo.power, 2.0 * W.halo.power, 1.35 * W.halo.power);
  W.skyMat.uniforms.uGlow.value = 1 + k * 0.8;
  W.motes.uniforms.uAmt.value = 1 + k * 1.5;
  if (Math.random() < dt * 30) emit(FX.sparks, { x: T.x + (Math.random() - 0.5) * 6, y: T.floorY + 1 + Math.random() * 3, z: T.z + (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 5, life: 2, s: 1, c: [1.6, 1.4, 1.0], g: 0.5 });
  if (endT > 5.2 && !prog.end) {
    prog.end = true; save();
    flashScreen(1.4);
    freeMouse(); setTimeout(() => $('endOv').classList.remove('hidden'), 500);
  }
}
function finishEnding(toTitle) {
  $('endOv').classList.add('hidden');
  $('hud').classList.remove('cine');
  P.castT = -1;
  updateQuest();
  if (toTitle) goTitle(); else { state = 'play'; regionCard('光羽之境已甦醒', 'THE REALM AWAKENS'); }
}
function cameraEnding(out, look) {
  const T = W.temple;
  const k = easeInOut(clamp(endT / 4.2, 0, 1));
  const start = _p.set(P.pos.x + Math.sin(CAM.yaw) * 7, P.pos.y + 3, P.pos.z + Math.cos(CAM.yaw) * 7);
  out.copy(start).lerp(_v.set(T.x, T.floorY + 6, T.z + 40), k);
  look.set(T.x, T.floorY + 2, T.z).lerp(HALO_POS, k);
}

// ------------------------------------------------------------------ camera
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function playCamera(dt, out, look, instant) {
  const target = _p.set(P.pos.x, P.pos.y + 1.5, P.pos.z);
  const L = state === 'play' ? P.lock : null;
  if (L) { const lp = _v.set(L.pos.x, L.pos.y + (L.isBoss ? 3.2 : 1.5), L.pos.z); target.lerp(lp, L.isBoss ? 0.3 : 0.18); }
  if (instant) CAM.look.copy(target);
  CAM.look.x = damp(CAM.look.x, target.x, 14, dt); CAM.look.z = damp(CAM.look.z, target.z, 14, dt); CAM.look.y = damp(CAM.look.y, target.y, 7, dt);
  const moving = P.speed > 2.5 && state === 'play';
  if (L) {
    const want = Math.atan2(-(L.pos.x - P.pos.x), -(L.pos.z - P.pos.z));
    CAM.yaw = dampAngle(CAM.yaw, want, time - CAM.lastDrag < 0.6 ? 1.5 : 5, dt);
    CAM.pitch = damp(CAM.pitch, L.isBoss ? 0.3 : 0.26, 2.5, dt);
  } else if (CAM.recenter > 0) { CAM.recenter -= dt; CAM.yaw = dampAngle(CAM.yaw, CAM.yawTarget, 12, dt); }
  else if (settings.autoCam && moving && time - CAM.lastDrag > 1.4 && !P.atk.kind) CAM.yaw = dampAngle(CAM.yaw, P.yaw + Math.PI, P.glide ? 1.2 : 0.55, dt);
  else if (P.glide && time - CAM.lastDrag > 2) CAM.yaw = dampAngle(CAM.yaw, P.yaw + Math.PI, 0.6, dt);
  const dTarget = P.glide ? 7.4 : L ? (L.isBoss ? 8.6 : 6.8) : P.atk.kind || nearestEnemy(12, -2) ? 6.6 : 5.6;
  CAM.dist = damp(CAM.dist, dTarget, 2.5, dt);
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  // looking skyward: stay behind and low so the seraph slides to the bottom of frame instead of filling it
  const up = clamp(-CAM.pitch / 1.4, 0, 1);
  const hcp = cp + (Math.max(cp, 0.82) - cp) * up;
  const dist = CAM.dist * (CAM.zoom || 1);
  look.copy(CAM.look);
  CAM.side = damp(CAM.side || 0, L ? (L.isBoss ? 1.6 : 0.9) : 0, 3, dt);
  const rx = Math.cos(CAM.yaw), rz = -Math.sin(CAM.yaw);
  look.x += rx * CAM.side * 0.55; look.z += rz * CAM.side * 0.55;
  out.set(look.x + Math.sin(CAM.yaw) * hcp * dist + rx * CAM.side * 0.45, look.y + sp * dist, look.z + Math.cos(CAM.yaw) * hcp * dist + rz * CAM.side * 0.45);
  // keep pillars, trunks and crystals from hiding the seraph
  let k = 1;
  const dx = out.x - look.x, dz = out.z - look.z, L2 = dx * dx + dz * dz;
  if (L2 > 0.01) {
    for (const c of colliders.solids) {
      const cx = c.x - look.x, cz = c.z - look.z;
      if (Math.abs(cx) > 14 || Math.abs(cz) > 14) continue;
      const t = clamp((cx * dx + cz * dz) / L2, 0, 1);
      const px = dx * t - cx, pz = dz * t - cz, rr = c.r + 0.35;
      if (px * px + pz * pz < rr * rr && t > 0.08) {
        const yAt = look.y + (out.y - look.y) * t;
        if (yAt > c.y0 && yAt < c.y1) k = Math.min(k, Math.max(0.25, t - rr / Math.sqrt(L2)));
      }
    }
  }
  CAM.k = damp(CAM.k ?? 1, k, k < (CAM.k ?? 1) ? 20 : 4, dt);
  out.lerpVectors(look, out, CAM.k);
  if (boss && boss.engaged) {
    const bx = out.x - boss.pos.x, bz = out.z - boss.pos.z, bd = Math.hypot(bx, bz), br = 3.2;
    if (bd < br && out.y < boss.pos.y + 8) { out.x = boss.pos.x + (bx / (bd || 1)) * br; out.z = boss.pos.z + (bz / (bd || 1)) * br; out.y = Math.max(out.y, look.y + 1.5); }
  }
  const g = Math.max(groundAt(out.x, out.z), waterAt(out.x, out.z), padHeightAt(out.x, out.z, out.y));
  if (out.y < g + 0.7) out.y = g + 0.7;
  // keep the requested view direction even when the ground pushes the camera up, so the whole sky can be seen
  if (CAM.pitch < 0.15 && !L) look.set(out.x - Math.sin(CAM.yaw) * cp * 10, out.y - sp * 10, out.z - Math.cos(CAM.yaw) * cp * 10);
}
function titleCamera(out, look) {
  const fwd = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const portrait = VIEW.h > VIEW.w;
  const sway = Math.sin(time * 0.08) * 0.22;
  const back = fwd.clone().multiplyScalar(-1);
  const off = back.clone().multiplyScalar(Math.cos(0.55 + sway)).addScaledVector(right, Math.sin(0.55 + sway));
  const dist = portrait ? 6.6 : 4.6;
  out.set(P.pos.x + off.x * dist, P.pos.y + (portrait ? 1.0 : 0.7), P.pos.z + off.z * dist);
  const shift = portrait ? 0 : -1.25;
  look.set(P.pos.x, P.pos.y + (portrait ? 2.0 : 1.75), P.pos.z).addScaledVector(right, shift).addScaledVector(fwd, 0.0);
}
let transT = 0;
const fromPos = new THREE.Vector3(), fromLook = new THREE.Vector3();
function updateCamera(dt) {
  const out = camPos, look = camLook;
  if (state === 'landing' || state === 'loading') { titleCamera(out, look); CAM.fov = VIEW.h > VIEW.w ? 62 : 46; }
  else if (state === 'trans') {
    transT += dt;
    const k = easeInOut(clamp(transT / 2.4, 0, 1));
    playCamera(dt, out, look, false);
    out.lerpVectors(fromPos, out, k); look.lerpVectors(fromLook, look, k);
    CAM.fov = lerp(VIEW.h > VIEW.w ? 62 : 46, 58, k);
    if (transT > 2.4) { state = 'play'; onEnterPlay(); }
  } else if (state === 'ending') { cameraEnding(out, look); CAM.fov = damp(CAM.fov, 52, 2, dt); }
  else { playCamera(dt, out, look, false); CAM.fov = damp(CAM.fov, P.glide ? 64 : P.dashT > 0 ? 63 : 58, 4, dt); }
  if (CAM.shake > 0) { out.x += (Math.random() - 0.5) * CAM.shake; out.y += (Math.random() - 0.5) * CAM.shake; CAM.shake = Math.max(0, CAM.shake - dt * 1.4); }
  if (window.__camOv) { out.copy(window.__camOv.pos); look.copy(window.__camOv.look); }
  camera.position.copy(out);
  camera.lookAt(look);
  if (Math.abs(camera.fov - CAM.fov) > 0.01) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ HUD
const hud = {};
function toast(html, big) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (big ? ' big' : '');
  el.innerHTML = html;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), big ? 3400 : 2200);
  setTimeout(() => el.remove(), big ? 4100 : 2900);
}
let regionTimer = 0, currentRegion = '';
function regionCard(cn, en) {
  const el = $('region');
  $('regCn').textContent = cn; $('regEn').textContent = en;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(regionTimer);
  regionTimer = setTimeout(() => el.classList.remove('on'), 3600);
}
function regionAt(x, z, y) {
  if (P.inEarth) return earthRegion(x, z);
  if (y > 250) { for (const I of REALM.isles) if (Math.hypot(x - I.x, z - I.z) < I.r + 1.5) return [I.name, I.en]; return ['天上神域', 'THE EMPYREAN']; }
  for (const s of W.islands) if (!s.far && Math.hypot(x - s.x, z - s.z) < s.r + 2 && y > s.top - 3) return ['浮嶼', 'THE DRIFTING ISLES'];
  if (Math.hypot(x - TEMPLE.x, z - TEMPLE.z) < 46) return ['環光聖所', 'SANCTUM OF THE HALO'];
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 0.92) return ['鏡湖', 'THE MIRROR LAKE'];
  if (Math.hypot(x - WINGP.x, z - WINGP.z) < 50) return ['墮翼之丘', 'HILL OF THE FALLEN WING'];
  for (const L of LANDMARKS) if (Math.hypot(x - L.x, z - L.z) < L.r) return [L.name, L.en];
  for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 24) return [s.name, s.en];
  if (Math.hypot(x, z) > edgeR(Math.atan2(z, x)) - 34) return ['天緣', "THE SKY'S EDGE"];
  return ['澄光原野', 'FIELDS OF CLEAR LIGHT'];
}
function updateQuest() {
  const lit = prog.s.filter(Boolean).length, f = prog.f.length;
  let title, rows;
  if (P.inEarth) {
    const ef = prog.f.filter((id) => id >= EARTH_F0 && id < EARTH_F1).length;
    title = '第二章 · 人間';
    rows = [['探索人間，收集光羽', `${ef}/${EARTH.feathers.length}`], prog.boss3 ? ['墮天騎士 · 已淨化', '✓'] : ['挑戰：傾城遺跡的墮天騎士', ''], ['回到墜光坑的光柱，返回天上', '']];
  } else if (prog.end || P.inRealm) {
    title = '第一章 · 天上神域';
    const rf = prog.f.filter((id) => id >= REALM_F0 && id < EARTH_F0).length;
    if (!prog.realm) rows = [[P.lv >= 3 ? '回到環光聖所，踏上天梯' : '收集光羽，升到 Lv3', P.lv >= 3 ? '' : `Lv${P.lv}/3`], ['收集光羽', `${f}/${feathers.length}`]];
    else rows = [['探索神域，收集光羽', `${rf}/${REALM.feathers.length}`], prog.boss2 ? ['審判者 · 已淨化', '✓'] : ['挑戰：審判之環的審判者', ''], ['收集光羽', `${f}/${feathers.length}`]];
    if (!P.inRealm && !prog.earth) rows.push(['從天緣躍下，前往人間', '']);
  }
  else if (lit < 4) { title = '序章 · 光羽降臨'; rows = [['點亮四座聖壇', `${lit}/4`], ['收集光羽', `${f}/${feathers.length}`]]; }
  else { title = '序章 · 環光甦醒'; rows = [['前往環光聖所，觸碰聖核', ''], ['收集光羽', `${f}/${feathers.length}`]]; }
  if (!prog.end) rows.push(prog.boss ? ['墮光守衛 · 已淨化', '✓'] : ['挑戰：墮翼之丘的守衛', '']);
  $('qTitle').textContent = title;
  $('qObj').innerHTML = rows.map(([a, b], i) => `<div class="qrow${i === 0 ? ' main' : ''}"><i class="box"></i><span>${a}</span>${b ? `<b>${b}</b>` : ''}</div>`).join('');
}
function pulse(el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
function flashScreen(a) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = a; void f.offsetWidth; f.style.transition = 'opacity 1.1s ease'; f.style.opacity = 0; }

// minimap
let mapBase = null;
function buildMapBase(L) {
  const N = 480;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const G2 = L ? C.grid2 : grid, base = L ? C.EARTH_Y : 0, ga = (x, z) => C.groundAtL(x, z, L) - base;
  const H = (ix, iz) => G2.h[clamp(iz, 0, GN - 1) * GN + clamp(ix, 0, GN - 1)];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const fx = (px / N) * (GN - 1), fz = (py / N) * (GN - 1);
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const wx = -320 + (px / N) * 640, wz = -320 + (py / N) * 640;
      const h = ga(wx, wz);
      const i = (py * N + px) * 4;
      if (h < -6) { img.data[i + 3] = 0; continue; }
      const sx = H(ix + 1, iz) - H(ix - 1, iz), sz = H(ix, iz + 1) - H(ix, iz - 1);
      const shade = clamp(1 + (-sx * 0.6 - sz * 0.6) * 0.05, 0.82, 1.1);
      let r, gg, b;
      if (h < 0.05 && (L || Math.hypot(wx - LAKE.x, wz - LAKE.z) < LAKE.r * 1.3)) { const d = smooth(0.05, -2, h); r = lerp(214, 186, d); gg = lerp(224, 203, d); b = lerp(226, 214, d); }
      else { const t = clamp(h / (L ? 60 : 36), 0, 1); r = lerp(240, 214, t) * shade; gg = lerp(235, 204, t) * shade; b = lerp(222, 184, t) * shade; }
      const step = 640 / N;
      const c0 = Math.floor(h / 4), c1 = Math.floor(ga(wx + step, wz) / 4), c2 = Math.floor(ga(wx, wz + step) / 4);
      if (h > 0.5 && (c0 !== c1 || c0 !== c2)) { const strong = c0 % 5 === 0; r = lerp(r, 168, strong ? 0.55 : 0.3); gg = lerp(gg, 140, strong ? 0.55 : 0.3); b = lerp(b, 92, strong ? 0.55 : 0.3); }
      if (h < -1.5) { const a = smooth(-6, -1.5, h); img.data[i + 3] = 255 * a; } else img.data[i + 3] = 255;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b;
    }
  }
  g.putImageData(img, 0, 0);
  if (L) return cv;
  // landmarks baked in
  const w2c = (x) => ((x + 320) / 640) * N;
  g.strokeStyle = 'rgba(160,128,70,0.8)'; g.lineWidth = 1.2;
  g.beginPath(); g.arc(w2c(TEMPLE.x), w2c(TEMPLE.z), (20 / 640) * N, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(w2c(TEMPLE.x), w2c(TEMPLE.z), (14 / 640) * N, 0, Math.PI * 2); g.stroke();
  return cv;
}
function buildMinimapBase() { mapBase = buildMapBase(0); mapBase2 = buildMapBase(1); }
function layoutMinimap() {
  const cv = $('mmc'); if (!cv) return;
  const s = cv.clientWidth || 132, pr = Math.min(3, (devicePixelRatio || 1) * (VIEW.s || 1));
  cv.width = s * pr; cv.height = s * pr;
  hud.mmPR = pr; hud.mmS = s;
}
function drawDiamond(g, x, y, r, fill, stroke) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.75, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.75, y); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.4; g.stroke(); } }
function questTarget() {
  if (P.inEarth) return prog.boss3 ? { x: EARTH.pillar.x, z: EARTH.pillar.z, kind: 'core' } : { x: EARTH.bossHome.x, z: EARTH.bossHome.z, kind: 'boss' };
  if (prog.end) {
    if (!P.inRealm) return P.lv >= 3 && !prog.boss2 ? { x: TEMPLE.x, z: TEMPLE.z, kind: 'core' } : null;
    return prog.boss2 ? null : { x: REALM.bossHome.x, z: REALM.bossHome.z, kind: 'boss' };
  }
  const lit = prog.s.filter(Boolean).length;
  if (lit === 4) return { x: TEMPLE.x, z: TEMPLE.z, kind: 'core' };
  let best = null, bd = 1e9;
  SHRINES.forEach((s, i) => { if (prog.s[i]) return; const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z); if (d < bd) { bd = d; best = { x: s.x, z: s.z, kind: 'shrine' }; } });
  return best;
}
function drawRealmBase(g, toS, s, size, labels) {
  g.fillStyle = '#e4dfd3'; g.fillRect(0, 0, size, size);
  const shape = (q, grow) => { g.beginPath(); for (let i = 0; i <= 28; i++) { const th = (i / 28) * Math.PI * 2, r = q.rf(th) * grow, [x, y] = toS(q.x + Math.cos(th) * r, q.z + Math.sin(th) * r); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  g.fillStyle = '#b9a477'; for (const q of REALM.blobs) { shape(q, 1.08); g.fill(); }
  g.fillStyle = '#f7f3e8'; for (const q of REALM.blobs) { shape(q, 1.0); g.fill(); }
  g.fillStyle = 'rgba(150,170,110,0.28)'; for (const q of REALM.blobs) if (!q.small) { shape(q, 0.62); g.fill(); }
  if (labels) for (const I of REALM.isles) { const [x, y] = toS(I.x, I.z); g.fillStyle = '#7d6232'; g.font = `500 ${Math.round(Math.max(11, size / 46))}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.fillText(tr(I.name), x, y + I.r * s + 12); }
}
function drawMap(g, size, cx, cz, range, round) {
  const s = (size / 2) / range;
  const toS = (x, z) => [size / 2 + (x - cx) * s, size / 2 + (z - cz) * s];
  g.save();
  g.clearRect(0, 0, size, size);
  if (round) { g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip(); }
  if (round) { g.fillStyle = '#dcd7cd'; g.fillRect(0, 0, size, size); }
  const sky = P.inRealm, earth = P.inEarth, cl = sky ? 's' : earth ? 'e' : 'i';
  if (sky) drawRealmBase(g, toS, s, size, !round);
  else if (earth) { const [ox, oy] = toS(-320, -320); g.drawImage(mapBase2, ox, oy, 640 * s, 640 * s); for (const m of EARTH.marks) { const [x, y] = toS(m.x, m.z); g.strokeStyle = 'rgba(155,122,60,0.75)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, Math.max(4, m.r * s * 0.3), 0, 6.3); g.stroke(); if (!round) { g.fillStyle = '#7d6232'; g.font = `500 ${Math.round(Math.max(11, size / 46))}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.fillText(tr(m.name), x, y + Math.max(4, m.r * s * 0.3) + 13); } } }
  else { const [ox, oy] = toS(-320, -320); g.drawImage(mapBase, ox, oy, 640 * s, 640 * s); }
  const u = size / 140;
  // updrafts
  for (const d of W.updrafts) { if ((d.realm ? 's' : d.earth ? 'e' : 'i') !== cl) continue; const [x, y] = toS(d.x, d.z); g.strokeStyle = 'rgba(176,140,70,0.9)'; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(x, y, 3.2 * u, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y + 2 * u); g.lineTo(x, y - 2.5 * u); g.lineTo(x - 1.5 * u, y - 1 * u); g.moveTo(x, y - 2.5 * u); g.lineTo(x + 1.5 * u, y - 1 * u); g.stroke(); }
  // landmarks
  if (cl === 'i') for (const L of LANDMARKS) { const [x, y] = toS(L.x, L.z); g.fillStyle = 'rgba(250,246,236,0.95)'; g.strokeStyle = '#9b7a3c'; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(x, y, 3.6 * u, 0, 6.3); g.fill(); g.stroke(); g.beginPath(); g.arc(x, y, 5.4 * u, 0, 6.3); g.stroke(); g.fillStyle = '#c29a4c'; g.beginPath(); g.arc(x, y, 1.4 * u, 0, 6.3); g.fill(); }
  // feathers
  for (const f of feathers) { if (f.taken || !f.seen) continue; f.grp.getWorldPosition(_v); if ((_v.y > 200 ? 's' : _v.y < -350 ? 'e' : 'i') !== cl) continue; const [x, y] = toS(_v.x, _v.z); g.fillStyle = 'rgba(255,253,245,0.95)'; g.strokeStyle = 'rgba(184,146,74,0.9)'; g.lineWidth = 1 * u; g.beginPath(); g.arc(x, y, 1.9 * u, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // shades
  for (const sh of shades) { if (sh.dead || (sh.realm ? 's' : sh.earth ? 'e' : 'i') !== cl || Math.hypot(sh.pos.x - P.pos.x, sh.pos.z - P.pos.z) > 75) continue; const [x, y] = toS(sh.pos.x, sh.pos.z); g.fillStyle = 'rgba(40,34,48,0.9)'; g.beginPath(); g.arc(x, y, 2.2 * u, 0, Math.PI * 2); g.fill(); }
  // shrines
  if (cl === 'i') W.shrines.forEach((sh) => { const [x, y] = toS(sh.def.x, sh.def.z); drawDiamond(g, x, y, 5 * u, sh.lit ? '#e8c776' : 'rgba(250,247,240,0.95)', '#9b7a3c'); if (sh.lit) { g.fillStyle = '#fff8e6'; g.beginPath(); g.arc(x, y, 1.3 * u, 0, 6.3); g.fill(); } });
  // temple star
  if (cl === 'i') { const [x, y] = toS(TEMPLE.x, TEMPLE.z); g.fillStyle = prog.end ? '#f0cf7e' : '#fbf7ee'; g.strokeStyle = '#9b7a3c'; g.lineWidth = 1.2 * u; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 2.6 : 6.4) * u; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }
  // boss
  { const bk = sky ? 'boss2' : earth ? 'boss3' : 'boss', bh = sky ? REALM.bossHome : earth ? EARTH.bossHome : BOSS_HOME; const [x, y] = toS(bh.x, bh.z); g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = prog[bk] ? '#efe9dc' : '#2a2230'; g.strokeStyle = prog[bk] ? '#9b7a3c' : '#e3b866'; g.lineWidth = 1.4 * u; g.fillRect(-4 * u, -4 * u, 8 * u, 8 * u); g.strokeRect(-4 * u, -4 * u, 8 * u, 8 * u); g.restore(); if (!prog[bk]) { g.fillStyle = '#e3b866'; g.beginPath(); g.arc(x, y, 1.4 * u, 0, 6.3); g.fill(); } }
  // quest target
  const qt = questTarget();
  if (qt) {
    let [x, y] = toS(qt.x, qt.z);
    const dx = x - size / 2, dy = y - size / 2, d = Math.hypot(dx, dy), lim = size / 2 - 9 * u;
    const out = round && d > lim;
    if (out) { x = size / 2 + (dx / d) * lim; y = size / 2 + (dy / d) * lim; }
    const pr = 1 + Math.sin(time * 4) * 0.15;
    g.strokeStyle = 'rgba(200,150,60,0.95)'; g.lineWidth = 1.6 * u;
    g.beginPath(); g.arc(x, y, 7.5 * u * pr, 0, Math.PI * 2); g.stroke();
    if (out) { const a = Math.atan2(dy, dx); g.fillStyle = '#c8963c'; g.beginPath(); g.moveTo(x + Math.cos(a) * 11 * u, y + Math.sin(a) * 11 * u); g.lineTo(x + Math.cos(a + 2.5) * 5 * u, y + Math.sin(a + 2.5) * 5 * u); g.lineTo(x + Math.cos(a - 2.5) * 5 * u, y + Math.sin(a - 2.5) * 5 * u); g.closePath(); g.fill(); }
  }
  // player
  {
    const [x, y] = toS(P.pos.x, P.pos.z);
    const ca = Math.atan2(-Math.cos(CAM.yaw), -Math.sin(CAM.yaw));
    const grd = g.createRadialGradient(x, y, 0, x, y, 30 * u);
    grd.addColorStop(0, 'rgba(255,240,200,0.55)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 30 * u, ca - 0.6, ca + 0.6); g.closePath(); g.fill();
    const a = Math.atan2(Math.cos(P.yaw), Math.sin(P.yaw));
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#c99a3e'; g.strokeStyle = '#fffaf0'; g.lineWidth = 1.4 * u;
    g.beginPath(); g.moveTo(7 * u, 0); g.lineTo(-4.5 * u, 4.5 * u); g.lineTo(-2 * u, 0); g.lineTo(-4.5 * u, -4.5 * u); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  g.restore();
}
let mmFrame = 0;
function updateHUD(dt) {
  // hp
  const hpPct = P.hp / P.maxHp;
  P.hpShown = damp(P.hpShown, P.hp, P.hpShown > P.hp ? 2.5 : 20, dt);
  hud.hpf.style.transform = `scaleX(${hpPct})`;
  hud.hpd.style.transform = `scaleX(${P.hpShown / P.maxHp})`;
  const hpTxt = `${Math.ceil(P.hp)} / ${P.maxHp}`;
  if (hud.hpTxt !== hpTxt) { hud.hpn.textContent = hpTxt; hud.hpTxt = hpTxt; }
  hud.hpw.classList.toggle('low', hpPct < 0.3);
  // stamina wheel near the seraph
  const showSt = P.stamina < 99.5 || P.glide;
  hud.stam.classList.toggle('on', showSt);
  if (showSt) {
    _v.set(P.pos.x, P.pos.y + 1.3, P.pos.z).project(camera);
    const x = (_v.x * 0.5 + 0.5) * VIEW.w + 46, y = (-_v.y * 0.5 + 0.5) * VIEW.h - 18;
    hud.stam.style.transform = `translate(${x}px, ${y}px)`;
    hud.stArc.style.strokeDashoffset = (1 - P.stamina / 100) * 113.1;
    hud.stam.classList.toggle('low', P.stamina < 25);
  }
  // skill cooldown
  const cd = clamp(P.skillCd / 7, 0, 1);
  hud.skCd.style.strokeDashoffset = (1 - cd) * 100.53;
  hud.bSkill.classList.toggle('cool', cd > 0);
  hud.skNum.textContent = cd > 0 ? Math.ceil(P.skillCd) : '';
  // jump label
  const jl = P.grounded ? '跳躍' : P.glide ? '振翼' : '展翼';
  if (hud.jl !== jl) { hud.jumpLbl.textContent = jl; hud.jl = jl; hud.bJump.classList.toggle('wing', !P.grounded); }
  // lock-on reticle
  const ret = hud.lockRet;
  if (P.lock && state === 'play') {
    const L = P.lock;
    _v.set(L.pos.x, L.pos.y + (L.isBoss ? 3.8 : 1.75), L.pos.z).project(camera);
    if (_v.z < 1) {
      ret.style.display = 'block';
      ret.style.transform = `translate(${(_v.x * 0.5 + 0.5) * VIEW.w}px, ${(-_v.y * 0.5 + 0.5) * VIEW.h}px)`;
      ret.classList.toggle('boss', !!L.isBoss);
      hud.lockHp.style.transform = `scaleX(${clamp(L.hp / L.maxHp, 0, 1)})`;
    } else ret.style.display = 'none';
  } else ret.style.display = 'none';
  hud.bLock.classList.toggle('on', !!P.lock);
  if (DESK) { const show = ML.can && !ML.failed && state === 'play' && !paused && !mouseLocked(); if (ML.hint !== show) { ML.hint = show; $('plHint').classList.toggle('hidden', !show); } }
  if (hud.healTxt !== P.flasks) { hud.healN.textContent = P.flasks; hud.healTxt = P.flasks; hud.bHeal.classList.toggle('empty', P.flasks <= 0); }
  hud.bAtk.style.setProperty('--c', P.charge >= 0 ? Math.min(1, P.charge / 0.9).toFixed(3) : '0');
  hud.bAtk.classList.toggle('full', P.chargeFull);
  const ctr = P.counterT > 0 && !P.atk.kind;
  if (hud.ctr !== ctr) { hud.ctr = ctr; hud.bAtk.classList.toggle('counter', ctr); hud.atkLbl.textContent = ctr ? '聖裁' : '攻擊'; }
  // minimap
  if ((mmFrame++ & 1) === 0) {
    const g = hud.mmg, pr = hud.mmPR;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    drawMap(g, hud.mmS, P.pos.x, P.pos.z, 80, true);
  }
  // region names
  hud.regAcc = (hud.regAcc || 0) + dt;
  if (hud.regAcc > 0.5) {
    hud.regAcc = 0;
    const [cn, en] = regionAt(P.pos.x, P.pos.z, P.inRealm ? 999 : P.pos.y);
    if (cn !== currentRegion) { currentRegion = cn; regionCard(cn, en); }
  }
}

// full map overlay
function openMap() {
  if (state !== 'play') return;
  paused = true; freeMouse();
  $('mapOv').classList.remove('hidden');
  const cv = $('bigmap');
  const size = Math.min(cv.parentElement.clientWidth, cv.parentElement.clientHeight);
  const pr = Math.min(3, (devicePixelRatio || 1) * (VIEW.s || 1));
  cv.width = size * pr; cv.height = size * pr; cv.style.width = cv.style.height = size + 'px';
  const g = cv.getContext('2d'); g.setTransform(pr, 0, 0, pr, 0, 0);
  if (P.inRealm) drawMap(g, size, REALM.x, REALM.z - 42, 150, false); else if (P.inEarth) drawMap(g, size, 0, 0, 262, false); else drawMap(g, size, 0, -4, 248, false);
  const lit = prog.s.filter(Boolean).length;
  $('mapList').innerHTML = SHRINES.map((s, i) => `<li class="${prog.s[i] ? 'lit' : ''}"><i class="dia"></i><span>${s.name}</span><em>${prog.s[i] ? '已點亮' : shadesAlive(i) ? '封印中' : '待點亮'}</em></li>`).join('') +
    `<li class="${prog.end ? 'lit' : ''}"><i class="star">✦</i><span>環光聖所</span><em>${prog.end ? '已甦醒' : lit === 4 ? '可進入' : `${lit}/4`}</em></li>` +
    `<li><i class="dot"></i><span>光羽</span><em>${prog.f.length}/${feathers.length}</em></li>` +
    `<li class="${prog.boss ? 'lit' : ''}"><i class="dia"></i><span>墮光守衛</span><em>${prog.boss ? '已淨化' : '未挑戰'}</em></li>` +
    (prog.earth ? `<li class="${prog.boss3 ? 'lit' : ''}"><i class="dia"></i><span>墮天騎士</span><em>${prog.boss3 ? '已淨化' : '未挑戰'}</em></li>` : '') +
    (prog.realm ? `<li class="${prog.boss2 ? 'lit' : ''}"><i class="dia"></i><span>審判者</span><em>${prog.boss2 ? '已淨化' : '未挑戰'}</em></li>` : '');
  $('mapHint').textContent = `已發現的光羽會標示在地圖上 · ${feathers.filter((f) => f.seen && !f.taken).length} 根待拾取`;
  Audio.sfx('ui');
}
function closeOverlays() {
  for (const id of ['mapOv', 'setOv', 'howOv', 'codexOv']) $(id).classList.add('hidden');
  paused = false;
}

// ------------------------------------------------------------------ input
const input = { joyId: null, camId: null, last: { x: 0, y: 0 }, base: { x: 0, y: 0 }, joy: { x: 0, y: 0 }, keys: new Set(), mouseMoved: 0, isMouse: false };
// desktop mouse: first click grabs the mouse (pointer lock); if the page is not allowed to lock it, drag-to-look instead
const ML = { can: DESK && 'requestPointerLock' in Element.prototype, failed: false, intent: false, exitAt: -1e9, drag: null, hint: null };
const mouseLocked = () => !!document.pointerLockElement;
function freeMouse() { if (mouseLocked()) { ML.intent = true; document.exitPointerLock(); } }
function lockMouse() {
  const el = $('touch');
  const fail = () => {
    if (mouseLocked()) return;
    if (performance.now() - ML.exitAt > 2500 && !ML.failed) { ML.failed = true; document.documentElement.classList.add('dragcam'); toast('<i class="dia"></i>拖曳滑鼠轉動視角 · 左鍵攻擊 · 右鍵閃避'); }
  };
  try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(fail); } catch (e) { fail(); }
  ML.onFail = fail;
}
function camTurn(dx, dy, k) {
  CAM.yaw -= dx * k; CAM.pitch = clamp(CAM.pitch + dy * k * 0.75, -1.5, 1.5);
  CAM.lastDrag = time;
}
function setupInput() {
  const layer = $('touch');
  const joyBase = $('joyBase'), knob = $('joyKnob');
  const R = 54;
  const placeBase = (x, y) => { joyBase.style.transform = `translate(${x}px, ${y}px)`; };
  const restJoy = () => { const r = $('joy').getBoundingClientRect(); input.base.x = r.left + r.width / 2; input.base.y = r.top + r.height / 2; joyBase.style.transform = ''; knob.style.transform = ''; joyBase.classList.remove('active'); };
  layer.addEventListener('pointerdown', (e) => {
    if (state !== 'play' || paused) return;
    if (e.pointerType === 'mouse' && DESK) return; // handled by the desktop mouse events below
    e.preventDefault();
    if (e.pointerType === 'mouse') { input.camId = e.pointerId; input.isMouse = true; input.mouseMoved = 0; input.last.x = e.clientX; input.last.y = e.clientY; layer.setPointerCapture(e.pointerId); return; }
    if (e.clientX < innerWidth * 0.42 && input.joyId === null) {
      input.joyId = e.pointerId;
      const jr = $('joy').getBoundingClientRect();
      input.base.x = e.clientX; input.base.y = e.clientY;
      placeBase(e.clientX - (jr.left + jr.width / 2), e.clientY - (jr.top + jr.height / 2));
      joyBase.classList.add('active');
    } else if (input.camId === null) {
      input.camId = e.pointerId; input.isMouse = false; input.last.x = e.clientX; input.last.y = e.clientY;
    }
    try { layer.setPointerCapture(e.pointerId); } catch (_) {}
  });
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId === input.joyId) {
      let dx = e.clientX - input.base.x, dy = e.clientY - input.base.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      input.joy.x = dx / R; input.joy.y = -dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === input.camId) {
      const dx = e.clientX - input.last.x, dy = e.clientY - input.last.y;
      input.last.x = e.clientX; input.last.y = e.clientY;
      camTurn(dx, dy, input.isMouse ? 0.0042 : 0.0062);
      input.mouseMoved += Math.abs(dx) + Math.abs(dy);
    }
  });
  const end = (e) => {
    if (e.pointerId === input.joyId) { input.joyId = null; input.joy.x = input.joy.y = 0; restJoy(); }
    if (e.pointerId === input.camId) { if (input.isMouse && input.mouseMoved < 6 && e.type === 'pointerup') lightAttack(); input.camId = null; }
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  if (DESK) {
    const R = document.documentElement;
    layer.addEventListener('mousedown', (e) => {
      if (state !== 'play' || paused) return;
      e.preventDefault();
      if (mouseLocked()) { if (e.button === 0) attackDown(); else if (e.button === 2) doDodge(); else if (e.button === 1) doLock(); return; }
      if (ML.can && !ML.failed) { lockMouse(); return; } // this click only grabs the mouse
      ML.drag = { b: e.button, x: e.clientX, y: e.clientY, moved: 0 };
      if (e.button === 0) attackDown();
      R.classList.add('dragging');
    });
    addEventListener('mousemove', (e) => {
      if (state !== 'play' || paused) return;
      const k = 0.0024 * (settings.sens || 1);
      if (mouseLocked()) { camTurn(e.movementX, e.movementY, k); return; }
      const d = ML.drag; if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.b === 0 && d.moved > 6 && P.atkHeld) { P.atkHeld = false; P.charge = -1; P.chargeFull = false; } // a drag is a look, not a charge
      camTurn(dx, dy, k * 1.6);
    });
    addEventListener('mouseup', (e) => {
      if (mouseLocked()) { if (e.button === 0) attackUp(); return; }
      const d = ML.drag; if (!d || e.button !== d.b) return;
      if (d.b === 0) attackUp(); else if (d.b === 2 && d.moved < 6) doDodge();
      ML.drag = null; R.classList.remove('dragging');
    });
    layer.addEventListener('wheel', (e) => { e.preventDefault(); if (state === 'play' && !paused) CAM.zoom = clamp((CAM.zoom || 1) * Math.exp(e.deltaY * 0.0011), 0.55, 1.9); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const on = mouseLocked();
      R.classList.toggle('locked', on);
      if (on) return;
      ML.exitAt = performance.now();
      if (P.atkHeld) attackUp();
      input.keys.clear();
      if (!ML.intent && state === 'play' && !paused) openSettings(); // Esc / alt-tab out of the mouse = pause
      ML.intent = false;
    });
    document.addEventListener('pointerlockerror', () => ML.onFail && ML.onFail());
    if (!ML.can) R.classList.add('dragcam');
    // fullscreen
    const fsOk = document.fullscreenEnabled && !!R.requestFullscreen;
    const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen(); else R.requestFullscreen().catch(() => toast('<i class="dia"></i>此頁面不允許全螢幕 · 可於瀏覽器直接開啟')); };
    for (const id of ['bFull', 'lbFull']) { const b = $(id); if (!fsOk) b.classList.add('hidden'); else b.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); }); }
    if (!fsOk) document.querySelector('#lbox .hint').textContent = '放大視窗，畫面會更闊';
    document.addEventListener('fullscreenchange', () => { R.classList.toggle('fs', !!document.fullscreenElement); setTimeout(resize, 60); });
  }

  const bind = (id, fn) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('press'); fn(); });
    const up = () => el.classList.remove('press');
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  };
  {
    const el = $('bAtk');
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('press'); try { el.setPointerCapture(e.pointerId); } catch (_) {} attackDown(); });
    const up = (e) => { if (!el.classList.contains('press')) return; el.classList.remove('press'); attackUp(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  bind('bLock', doLock); bind('bHeal', doHeal);
  bind('bSkill', doSkill); bind('bDodge', doDodge); bind('bJump', doJump); bind('bInteract', doInteract);
  bind('bMap', openMap);
  bind('bSet', () => openSettings());
  bind('bSnd', () => toggleSound());

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.code;
    input.keys.add(k);
    if (state === 'landing') {
      const L = $('landing');
      if (DESK && L.classList.contains('menu') && k === 'Enter' && !document.querySelector('.ov:not(.hidden)')) { $('menu').querySelector('.primary').click(); return; }
      if (k === 'Enter' || k === 'Space' || (DESK && !L.classList.contains('menu') && !e.metaKey && !e.ctrlKey)) landingTap();
      return;
    }
    if (k === 'Escape') { if (performance.now() - ML.exitAt < 300) return; if (paused) closeOverlays(); else if (state === 'play') openSettings(); return; }
    if (k === 'KeyH' && state === 'play') { document.documentElement.classList.toggle('nohud'); return; }
    if (paused) return;
    if (k === 'Space') { e.preventDefault(); doJump(); }
    else if (k === 'ShiftLeft' || k === 'ShiftRight') doDodge();
    else if (k === 'KeyJ') attackDown();
    else if (k === 'KeyL' || k === 'Tab') { e.preventDefault(); doLock(); }
    else if (k === 'KeyR') doHeal();
    else if (k === 'KeyK' || k === 'KeyQ') doSkill();
    else if (k === 'KeyE' || k === 'KeyF') doInteract();
    else if (k === 'KeyM') openMap();
    else if (k === 'KeyB' || k === 'KeyC') openCodex();
  });
  addEventListener('keyup', (e) => { input.keys.delete(e.code); if (e.code === 'KeyJ') attackUp(); });
  addEventListener('blur', () => input.keys.clear());
}
function readMove() {
  if (input.joyId !== null) {
    let x = input.joy.x, y = input.joy.y;
    const m = Math.hypot(x, y);
    if (m < 0.12) { x = y = 0; }
    move.x = x; move.y = y;
    return;
  }
  const K = input.keys;
  let x = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
  let y = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
  const m = Math.hypot(x, y) || 1;
  const walk = K.has('AltLeft') || K.has('ControlLeft') || K.has('ControlRight') ? 0.5 : 1;
  move.x = (x / m) * walk; move.y = (y / m) * walk;
}

// ------------------------------------------------------------------ menus
function toggleSound() {
  settings.sound = !settings.sound; store.set('lumenfall_settings', settings);
  Audio.setOn(settings.sound);
  document.body.classList.toggle('muted', !settings.sound);
  syncSettingsUI();
}
function openSettings() {
  if (state === 'play') paused = true;
  freeMouse();
  syncSettingsUI();
  $('setOv').classList.remove('hidden');
  $('setTitle').classList.toggle('hidden', state !== 'play');
  Audio.sfx('ui');
}
function syncSettingsUI() {
  document.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === settings.lang));
  document.querySelectorAll('[data-sens]').forEach((b) => b.classList.toggle('on', +b.dataset.sens === (settings.sens || 1)));
  $('camToggle').classList.toggle('on', settings.autoCam);
  $('camToggle').querySelector('em').textContent = settings.autoCam ? '開啟' : '關閉';
  $('sndToggle').classList.toggle('on', settings.sound);
  $('sndToggle').querySelector('em').textContent = settings.sound ? '開啟' : '關閉';
}
function setupMenus() {
  document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { settings.quality = b.dataset.q; store.set('lumenfall_settings', settings); applyQuality(); syncSettingsUI(); Audio.sfx('ui'); }));
  $('sndToggle').addEventListener('click', toggleSound);
  $('bCodex').addEventListener('click', (e) => { e.stopPropagation(); openCodex(); });
  $('codexList').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; codexSel = +li.dataset.i; renderCodex(); Audio.sfx('ui'); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { settings.lang = b.dataset.lang; store.set('lumenfall_settings', settings); setLang(settings.lang); syncSettingsUI(); Audio.sfx('ui'); }));
  document.querySelectorAll('[data-sens]').forEach((b) => b.addEventListener('click', () => { settings.sens = +b.dataset.sens; store.set('lumenfall_settings', settings); syncSettingsUI(); Audio.sfx('ui'); }));
  $('camToggle').addEventListener('click', () => { settings.autoCam = !settings.autoCam; store.set('lumenfall_settings', settings); syncSettingsUI(); Audio.sfx('ui'); });
  $('glbIn').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    $('glbStat').textContent = '載入中…';
    try {
      const map = await hero.loadGLB(await f.arrayBuffer());
      $('glbStat').textContent = `已換上「${f.name}」· 找到 ${Object.keys(map).length} 條骨`;
      hero.resetCloth();
    } catch (err) { $('glbStat').textContent = '載入失敗：' + (err.message || err); }
    e.target.value = '';
  });
  $('glbReset').addEventListener('click', () => { hero.useDefaultBody(); hero.resetCloth(); $('glbStat').textContent = '已還原預設角色'; });
  $('resetProg').addEventListener('click', () => {
    const b = $('resetProg');
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.querySelector('span').textContent = '再按一次確認重置'; setTimeout(() => { b.classList.remove('confirm'); b.querySelector('span').textContent = '重置旅程進度'; }, 2600); return; }
    store.set('lumenfall_progress', null);
    location.reload();
  });
  $('setTitle').addEventListener('click', () => { closeOverlays(); goTitle(); });
  document.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => {
    if (state !== 'play') { $('devStat').textContent = '請先開始旅程'; return; }
    const k = b.dataset.dev;
    if (k === 'feather') {
      let n = 0;
      for (const f of feathers) { if (f.taken || n >= 3) continue; f.taken = true; f.grp.visible = false; prog.f.push(f.id); n++; }
      save(); const nl = lvFor(prog.f.length); if (nl > P.lvTarget) { P.lvTarget = nl; setTimeout(() => levelUp(nl), 500); }
      updateLvHUD(); updateQuest(); closeOverlays(); return;
    }
    closeOverlays();
    if (k === 'realm') { P.pos.copy(REALM.landing); P.inRealm = true; P.inEarth = false; prog.realm = true; save(); regionCard('天上神域', 'THE EMPYREAN'); }
    else if (k === 'earth') { P.pos.set(EARTH.landing.x, C.groundAtL(EARTH.landing.x, EARTH.landing.z, 1) + 0.5, EARTH.landing.z); P.inEarth = true; P.inRealm = false; prog.earth = true; save(); syncLayer(); regionCard('人間', 'THE MORTAL WORLD'); }
    else { P.pos.set(SPAWN.x, 0, SPAWN.z); P.inRealm = false; P.inEarth = false; syncLayer(); regionCard('鏡湖', 'THE MIRROR LAKE'); }
    P.vel.set(0, 0, 0); P.safe.copy(P.pos); P.checkpoint.copy(P.pos); P.glide = false; flashScreen(0.8); updateQuest();
  }));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { closeOverlays(); Audio.sfx('ui'); }));
  $('reviveBtn').addEventListener('click', revive);
  $('endStay').addEventListener('click', () => finishEnding(false));
  $('endTitle').addEventListener('click', () => finishEnding(true));
  $('landing').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; landingTap(); });
  document.querySelectorAll('#menu button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = b.dataset.act;
    Audio.init(); Audio.sfx('ui');
    if (act === 'start') beginJourney();
    else if (act === 'howto') { $('howOv').classList.remove('hidden'); }
    else if (act === 'settings') openSettings();
  }));
  $('lSnd').addEventListener('click', (e) => { e.stopPropagation(); Audio.init(); toggleSound(); });
}
function landingTap() {
  if (state !== 'landing') return;
  Audio.init();
  const L = $('landing');
  if (!L.classList.contains('menu')) { L.classList.add('menu'); Audio.sfx('ui'); }
}
function beginJourney() {
  if (state !== 'landing') return;
  state = 'trans'; transT = 0;
  fromPos.copy(camera.position); fromLook.copy(camLook);
  CAM.yaw = P.yaw + Math.PI; CAM.pitch = 0.24; CAM.dist = 5.6; CAM.look.set(P.pos.x, P.pos.y + 1.55, P.pos.z);
  $('landing').classList.add('out');
  flashScreen(0.7);
  Audio.sfx('glide');
}
function onEnterPlay() {
  $('landing').classList.add('hidden');
  $('hud').classList.remove('hidden');
  requestAnimationFrame(() => $('hud').classList.add('show'));
  layoutMinimap();
  currentRegion = '';
  updateQuest();
  if (!store.get('lumenfall_seenTip', false)) {
    setTimeout(() => toast(isTouch ? '<i class="dia"></i>左側拖曳移動 · 右側拖曳轉視角' : '<i class="dia"></i>WASD 移動 · 滑鼠轉視角 · 左鍵攻擊 · 右鍵閃避'), 3800);
    setTimeout(() => toast('<i class="dia"></i>空中再按「展翼」即可滑翔'), 6600);
    store.set('lumenfall_seenTip', true);
  }
  checkRotate();
}
function goTitle() {
  state = 'landing'; paused = false; freeMouse(); document.documentElement.classList.remove('nohud');
  $('hud').classList.remove('show'); $('hud').classList.add('hidden');
  const L = $('landing'); L.classList.remove('hidden', 'out'); L.classList.add('menu');
  P.pos.set(SPAWN.x, 0, SPAWN.z); P.vel.set(0, 0, 0); P.yaw = Math.PI; P.glide = false; P.grounded = true; P.hp = P.maxHp; P.atk.kind = null; P.castT = -1; P.lock = null; P.flasks = P.maxFlasks;
  syncMenuLabels();
}
function syncMenuLabels() {
  const started = prog.f.length > 0 || prog.s.some(Boolean);
  $('startCn').textContent = started ? '繼續旅程' : '開始旅程';
  $('startEn').textContent = started ? 'CONTINUE JOURNEY' : 'BEGIN JOURNEY';
}
function checkRotate() {
  const need = isTouch && innerHeight > innerWidth && (state === 'play' || state === 'trans' || state === 'ending' || state === 'dead');
  $('rotate').classList.toggle('hidden', !need);
}

// ------------------------------------------------------------------ title halo UI follows the seraph
function placeTitleHalo() {
  const el = $('haloUI');
  _v.set(P.pos.x, P.pos.y + 1.35, P.pos.z).project(camera);
  const x = (_v.x * 0.5 + 0.5) * VIEW.w, y = (-_v.y * 0.5 + 0.5) * VIEW.h;
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}

// ------------------------------------------------------------------ layers: island (0) / human world (1)
let mapBase2 = null;
function syncLayer() {
  const want = P.pos.y < -350 ? 1 : 0;
  if (C.LAYER.cur === want) return;
  C.LAYER.cur = want;
  for (const gm of W.grassMats) { gm.uniforms.uHeight.value = want ? EARTH.heightTex : W.heightTex; gm.uniforms.uBaseY.value = want ? C.EARTH_Y : 0; }
  currentRegion = '';
}
const waterAt = (x, z) => (C.LAYER.cur ? C.EARTH_Y : Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.3 ? 0 : -999);

// ------------------------------------------------------------------ loop
function sampleDyn() {
  if (!dyn.on || paused || document.hidden || !(state === 'play' || state === 'landing')) { dyn.last = 0; return; }
  const now = performance.now();
  if (dyn.last) { dyn.acc += now - dyn.last; dyn.n++; }
  dyn.last = now;
  if (dyn.acc < 2000) return;
  const ms = dyn.acc / dyn.n; dyn.acc = 0; dyn.n = 0;
  let ns = dyn.scale;
  if (ms > 22) ns = Math.max(0.6, dyn.scale * 0.88); else if (ms < 18 && dyn.scale < 1) ns = Math.min(1, dyn.scale * 1.07);
  if (Math.abs(ns - dyn.scale) > 0.005) { dyn.scale = ns; resize(); }
}
function frame() {
  requestAnimationFrame(frame);
  sampleDyn();
  let dt = Math.min(clock.getDelta(), DT_MAX);
  const realDt = paused ? 0 : dt;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.15; }
  if (paused) dt = 0;
  if (slowT > 0) { slowT -= realDt; enemyScale = damp(enemyScale, 0.2, 25, realDt); } else enemyScale = damp(enemyScale, 1, 5, realDt);
  const edt = dt * enemyScale;
  time += dt;
  syncLayer();
  if (state === 'play' && !paused) { readMove(); updatePlayer(dt); updateInteract(); }
  if (state === 'trans' || state === 'landing') { P.vel.set(0, 0, 0); }
  if (state === 'dead') { deadT += dt; }
  if (state === 'ending') updateEnding(dt);
  if (bosses.length) boss = bosses.find((b) => b.engaged) || bosses.reduce((a, b) => (b.home.distanceToSquared(P.pos) < a.home.distanceToSquared(P.pos) ? b : a));
  if (state === 'play' || state === 'trans' || state === 'ending') { updateShades(edt); updateProjectiles(edt); if (boss) boss.update(edt, dt); }
  if (state === 'ascend') updateTrip(dt);
  if (state === 'play') updateBreakables(dt);
  if (boss && boss.engaged && !prog.seen[boss.cfg.key]) { prog.seen[boss.cfg.key] = true; save(); }
  updateLvFx(dt);
  updateFeathers(dt);
  updateFX(dt);
  // seraph pose
  const mode = state === 'landing' || state === 'loading' ? 'title' : 'play';
  hero.root.position.copy(P.pos);
  hero.root.rotation.y = P.yaw + P.spin;
  hero.setVisible(!(P.inv > 0 && P.hurtT < 0 && state === 'play' && Math.floor(time * 20) % 2 === 0 && P.inv < 0.85 && P.lastHurt > time - 1));
  hero.update(dt, { mode, speed: P.speed, phase: P.phase, grounded: P.grounded, vy: P.vel.y, glide: P.glide, dash: P.dashT, atk: P.atk, cast: P.castT, hurt: P.hurtT, charge: P.charge, lock: !!P.lock, heal: P.healT >= 0 ? 1 : 0 });
  updateTrail(dt, !!(P.atk.kind && P.atk.t < P.atk.dur * 0.75) || (P.dashT > 0 && P.atk.kind));
  updateDmgNums(realDt);
  const gy = support(P.pos.x, P.pos.z, P.pos.y + 0.1).h;
  blob.position.set(P.pos.x, gy + 0.04, P.pos.z);
  const hgt = P.pos.y - gy; blob.scale.setScalar(clamp(1 - hgt * 0.05, 0.35, 1)); blob.material.opacity = clamp(1 - hgt * 0.06, 0.2, 1);

  updateCamera(dt);
  // world follows
  W.sky.position.copy(camera.position);
  CLOUD.value += dt;
  { // god rays: only when the camera looks roughly toward the sun
    camera.getWorldDirection(_v); const face = _v.dot(sunDir);
    const amt = Q.bloom ? smooth(0.35, 0.85, face) * 0.22 : 0;
    rays.enabled = amt > 0.01;
    if (rays.enabled) { _v.copy(camera.position).addScaledVector(sunDir, 800).project(camera); rays.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5); rays.uniforms.uAmt.value = amt; }
  }
  updateAmbient(time, dt, _p.set(P.pos.x, P.pos.y, P.pos.z));
  for (const gm of W.grassMats) { gm.uniforms.uCenter.value.copy(P.pos); gm.uniforms.uPlayer.value.copy(P.pos); }
  renderer.toneMappingExposure = damp(renderer.toneMappingExposure, P.pos.y > 200 ? 0.74 : 0.86, 2, dt);
  { const low = P.pos.y < 170, isle = low && C.LAYER.cur === 0; W.grass.visible = W.flowers.visible = low; if (Q.refl) { W.water.reflector.visible = isle; W.water.simple.visible = !isle; } }
  W.sun.position.copy(P.pos).addScaledVector(sunDir, 120);
  W.sun.target.position.copy(P.pos);
  if (state === 'play' || state === 'ending' || state === 'trans') updateHUD(dt);
  if (state === 'landing' || state === 'trans') placeTitleHalo();
  Audio.tick();
  composer.render(dt);
}

// ------------------------------------------------------------------ boot
const wait = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
function setLoad(p, msg) { $('loadBar').style.transform = `scaleX(${p})`; if (msg) $('loadMsg').textContent = msg; }
async function init() {
  setLoad(0.08, '光正在匯聚…');
  await wait();
  C.makeTextures();
  C.buildGrid(); buildEarthGrid();
  setLoad(0.35, '大地自雲海中升起…');
  await wait();
  buildWorld(scene, renderer, Q);
  buildEarth(scene);
  setLoad(0.65, '聖所的光環正在轉動…');
  await wait();
  buildPlayer();
  buildFX();
  buildShades();
  buildBoss();
  buildBreakables();
  buildFeathers();
  if (prog.weapon === 'greatsword' && prog.boss) hero.setWeapon('greatsword'); else prog.weapon = 'spear';
  buildMinimapBase();
  sanitizeNormals(scene);
  hookCloudClock(scene);
  P.pos.y = 0;
  hud.hpf = $('hpf'); hud.hpd = $('hpd'); hud.hpn = $('hpn'); hud.hpw = $('hpw');
  hud.stam = $('stam'); hud.stArc = $('stArc'); hud.skCd = $('skCd'); hud.bSkill = $('bSkill'); hud.skNum = $('skNum');
  hud.jumpLbl = $('jumpLbl'); hud.bJump = $('bJump');
  hud.lockRet = $('lockRet'); hud.lockHp = $('lockHp'); hud.bLock = $('bLock'); hud.healN = $('healN'); hud.bHeal = $('bHeal'); hud.bAtk = $('bAtk'); hud.atkLbl = $('atkLbl');
  hud.mmg = $('mmc').getContext('2d');
  updateLvHUD();
  setupInput(); setupMenus(); syncMenuLabels();
  setLang(settings.lang);
  document.body.classList.toggle('muted', !settings.sound);
  applyQuality();
  FX.sparks.m.uniforms.uPR.value = FX.smoke.m.uniforms.uPR.value = renderer.getPixelRatio();
  setLoad(0.9, '熾天使甦醒…');
  await wait();
  try { renderer.compile(scene, camera); } catch (e) {}
  setLoad(1);
  state = 'landing';
  clock.getDelta();
  frame();
  setTimeout(() => { $('loader').classList.add('out'); $('landing').classList.add('ready'); }, 250);
  setTimeout(() => $('loader').remove(), 1600);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
document.addEventListener('visibilitychange', () => { if (Audio.ctx) { if (document.hidden) Audio.ctx.suspend(); else Audio.ctx.resume(); } });
init().catch((e) => { console.error(e); $('loadMsg').textContent = '載入失敗：' + e.message; });
window.__LF = { dyn: () => ({ ...dyn, pr: renderer.getPixelRatio() }), levelUp: (n) => levelUp(n), showPower: (k) => showPower(k), breakables, equipWeapon: (w) => equipWeapon(w), calls: () => { renderer.info.autoReset = false; renderer.info.reset(); composer.render(0.016); const r = { ...renderer.info.render }; renderer.info.autoReset = true; return r; }, pause: (b) => (paused = b), FX, slow: () => (DT_MAX = 0.05), act: { attackDown, attackUp, lightAttack, doLock, doHeal, startAttack, perfectDodge, doAttack, doJump, doSkill, doDodge, doInteract, openMap, openSettings, damageShade, regionCard, toast }, fast: () => (DT_MAX = 0.25), THREE, scene, composer, q: (o) => { Object.assign(QUAL[settings.quality], o); applyQuality(); }, P, CAM, W, hero: () => hero, boss: () => boss, state: () => state, prog, shades, feathers, setState: (s) => (state = s), camera, renderer };
