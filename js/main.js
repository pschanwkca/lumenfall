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
import { buildEarthGrid, buildEarth, EARTH, earthRegion, earthCull, inRift, SEA_NORTH, EP as EARTH_EP, riftZ } from './earth.js';
import { createFolk, FOLK_PAL } from './folk.js';
import { buildHellGrid, buildHell, HELL, hellRegion, inLava, HELL_MAP } from './hell.js';
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
// test mode plays on its own save slot, so jumping around never touches the real journey
const TEST = Object.assign({ on: false, god: false, oneHit: false, powers: false, coords: false }, store.get('lumenfall_test', {}));
const progKey = () => (TEST.on ? 'lumenfall_progress_test' : 'lumenfall_progress');
let prog = Object.assign({ f: [], s: [false, false, false, false], end: false, boss: false, boss2: false, boss3: false, realm: false, earth: false, weapon: 'spear', kills: {}, seen: {}, broken: {}, rescued: {}, beacons: {} }, store.get(progKey(), {}));
if (!prog.rescued) prog.rescued = {}; if (!prog.beacons) prog.beacons = {};
// weapons are found in the world now; a journey that already beat Ophiel keeps the greatsword it was given
if (!prog.weapons) prog.weapons = { spear: true, greatsword: !!prog.boss };
if (prog.hellBlade) prog.weapons.tianshu = true;
if (!prog.talk) prog.talk = {}; if (!prog.clues) prog.clues = {};
const holyBlade = () => !!prog.hellBlade && prog.weapon === 'tianshu';
const nRescued = () => Object.keys(prog.rescued).length, nBeacons = () => Object.keys(prog.beacons).length;
const save = () => store.set(progKey(), prog);
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
  P.maxHp = 100 + (P.lv - 1) * 10 + (prog.boss ? 25 : 0) + (prog.boss2 ? 25 : 0) + (prog.boss3 ? 25 : 0) + nBeacons() * 10; // each kindled beacon: +10
  P.atkMul = 1 + (P.lv - 1) * 0.06 + (prog.boss3 ? 0.1 : 0);
  P.maxFlasks = 3 + (P.lv >= 4 ? 1 : 0) + (prog.boss2 ? 1 : 0) + (nRescued() >= 3 ? 1 : 0) + (nRescued() >= 6 ? 1 : 0); // the people's gratitude
  if (heal) { P.hp = P.maxHp; P.flasks = P.maxFlasks; } else P.hp = Math.min(P.hp, P.maxHp);
}
applyStats(true);
P.atk = { kind: null, t: 0, dur: 0, hitsDone: 0, queued: false, mult: 1, combo: -1 };
let enemyScale = 1, slowT = 0, boss = null;
// light combo (4 hits), charged heavy, perfect-dodge counter
const ATK = {
  // the holy lance pierces: two quick thrusts with long reach, a sweeping spin, then a lunging drive
  l0: { dur: 0.4, hits: [0.09], dmg: [28, 34], reach: 3.8, cone: 0.35, lunge: 4.4, poise: 6, thrust: true, lanceS: 0.72, sfx: 'thrust' },
  l1: { dur: 0.42, hits: [0.1], dmg: [28, 34], reach: 3.8, cone: 0.35, lunge: 4.4, poise: 6, thrust: true, lanceS: 0.72, sfx: 'thrust' },
  l2: { dur: 0.62, hits: [0.13, 0.27], dmg: [22, 27], reach: 3.5, cone: -2, lunge: 1.8, poise: 7, spin: true, arc: { t0: 0, len: 6.2, rev: 0, tilt: [0, 0, 0] }, sfx: 'swing' },
  l3: { dur: 0.66, hits: [0.13], dmg: [52, 60], reach: 4.1, cone: 0.5, lunge: 9, poise: 14, thrust: true, sfx: 'thrust' },
  heavy: { dur: 0.72, hits: [0.1, 0.2], dmg: [70, 82], reach: 4.8, cone: 0.45, lunge: 16, poise: 25, thrust: true, sfx: 'thrust' },
  counter: { dur: 0.78, hits: [0.3], dmg: [125, 145], reach: 4.8, cone: -0.45, lunge: 5, poise: 40, arc: { t0: 2.0, len: 3.9, rev: 0, tilt: [-1.0, 0, 0.25] }, sfx: 'skill' },
};
// the Warden's greatsword: wide two-handed cleaves, a slow spin, and an overhead slam that cracks the ground
const ATK_GS = {
  l0: { dur: 0.7, hits: [0.27], dmg: [52, 60], reach: 4.3, cone: -0.35, lunge: 2.6, poise: 16, heavyHit: true, arc: { t0: 2.5, len: 4.1, rev: 0, tilt: [-0.55, 0, -0.75] }, sfx: 'cleave' },
  l1: { dur: 0.68, hits: [0.26], dmg: [52, 60], reach: 4.3, cone: -0.35, lunge: 2.6, poise: 16, heavyHit: true, arc: { t0: 2.5, len: 4.1, rev: 1, tilt: [-0.45, 0, 0.7] }, sfx: 'cleave' },
  l2: { dur: 0.95, hits: [0.25, 0.47], dmg: [38, 44], reach: 4.7, cone: -2, lunge: 1.2, poise: 14, heavyHit: true, spin: true, arc: { t0: 0, len: 6.2, rev: 0, tilt: [0, 0, 0] }, sfx: 'cleave' },
  l3: { dur: 1.0, hits: [0.42], dmg: [96, 110], reach: 2.2, cone: -2, lunge: 3.5, poise: 42, slam: 4.6, sfx: 'cleave' },
  heavy: { dur: 1.05, hits: [0.38], dmg: [130, 150], reach: 2.4, cone: -2, lunge: 12, poise: 60, slam: 6.2, sfx: 'cleave' },
  counter: { dur: 0.95, hits: [0.38], dmg: [190, 215], reach: 5.4, cone: -0.45, lunge: 5, poise: 60, heavyHit: true, arc: { t0: 2.0, len: 3.9, rev: 0, tilt: [-1.0, 0, 0.25] }, sfx: 'skill' },
};
// 天樞 · the Lord's sword: quick sweeping slashes, the only blade that truly cuts what lives in hell
const ATK_TS = {
  l0: { dur: 0.42, hits: [0.09], dmg: [34, 40], reach: 3.4, cone: -0.1, lunge: 3.8, poise: 8, arc: { t0: 2.2, len: 3.5, rev: 0, tilt: [-0.22, 0, -0.55] }, sfx: 'slash' },
  l1: { dur: 0.4, hits: [0.09], dmg: [34, 40], reach: 3.4, cone: -0.1, lunge: 3.8, poise: 8, arc: { t0: 2.2, len: 3.5, rev: 1, tilt: [-0.22, 0, 0.58] }, sfx: 'slash' },
  l2: { ...ATK.l2, dmg: [26, 32], poise: 9, sfx: 'slash' },
  l3: { ...ATK.l3, dmg: [62, 70], poise: 18 },
  heavy: { ...ATK.heavy, dmg: [84, 96] },
  counter: { ...ATK.counter, dmg: [150, 170] },
};
const atkT = () => (prog.weapon === 'greatsword' ? ATK_GS : prog.weapon === 'tianshu' ? ATK_TS : ATK);
// how each weapon looks and lands: slash light, trail, thrust streak, impact sparks, hit-stop
const WLOOK = {
  spear: { a: [0.95, 0.66, 0.26], b: [2.2, 1.9, 1.35], lance: [2.2, 1.7, 0.95], spark: [1.9, 1.6, 1.0], stop: 0.035, shake: 0.06 },
  greatsword: { a: [1.4, 0.42, 0.06], b: [2.8, 1.55, 0.45], lance: [2.6, 1.2, 0.4], spark: [2.6, 1.3, 0.35], stop: 0.075, shake: 0.24 },
  tianshu: { a: [0.42, 0.68, 1.35], b: [1.9, 2.25, 2.7], lance: [1.4, 1.8, 2.6], spark: [1.5, 1.9, 2.7], stop: 0.045, shake: 0.1 },
};
const wlook = () => WLOOK[prog.weapon] || WLOOK.spear;
function applyWeaponLook() {
  const L = wlook();
  if (FX.arc) { FX.arc.mat.uniforms.uA.value.set(...L.a); FX.arc.mat.uniforms.uB.value.set(...L.b); }
  if (FX.trail) { FX.trail.mesh.material.uniforms.uA.value.set(...L.a); FX.trail.mesh.material.uniforms.uB.value.set(...L.b); }
  if (FX.lance) FX.lance.m.material.color.setRGB(...L.lance);
}
// powers granted by the purified
const POWERS = {
  shield: { key: 'boss', glyph: '盾', name: '守衛之盾', en: "WARDEN'S AEGIS", desc: '原地按「閃避」舉盾格擋，時機啱可反擊 · 衝刺可擊碎黑晶封印' },
  wings: { key: 'boss2', glyph: '翼', name: '審判之翼', en: "ARBITER'S WINGS", desc: '空中按「閃避」向前衝刺 · 滑翔更省力，振翼更有力' },
  oath: { key: 'boss3', glyph: '誓', name: '騎士之誓', en: "KNIGHT'S OATH", desc: '蓄滿力的重擊會震地 · 擊碎裂石，震飛周圍敵人' },
};
const has = (k) => TEST.powers || !!prog[POWERS[k].key];

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
      case 'cleave': this.noise(0.42, 240, 1200, 0.22, 0.7); this.thud(64, 0.1); break;
      case 'slash': this.noise(0.2, 1500, 4600, 0.15, 1.7); this.bell(m(96), 0.025, 0.5); break;
      case 'hitHeavy': this.thud(55, 0.42); this.noise(0.3, 500, 140, 0.18, 0.8); break;
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
    uniforms: { uProg: { value: 0 }, uAlpha: { value: 0 }, uT0: { value: 0 }, uLen: { value: 3.14 }, uRev: { value: 0 }, uA: { value: new THREE.Vector3(0.95, 0.66, 0.26) }, uB: { value: new THREE.Vector3(2.2, 1.9, 1.35) } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uProg, uAlpha, uT0, uLen, uRev; uniform vec3 uA, uB; varying vec2 vP;
      void main(){ float a = atan(vP.y, vP.x); float u = mod(a - uT0 + 25.1327, 6.28318)/uLen; if (u > 1.0) discard; if (uRev > 0.5) u = 1.0 - u;
        float r = length(vP); float v = (r - 0.7)/2.0;
        float m = smoothstep(uProg - 0.6, uProg, u)*step(u, uProg);
        float edge = smoothstep(0.12, 0.9, v)*(1.0 - smoothstep(0.93, 1.0, v));
        vec3 col = mix(uA, uB, smoothstep(0.6, 0.96, v));
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
    uniforms: { uA: { value: new THREE.Vector3(1.1, 0.72, 0.3) }, uB: { value: new THREE.Vector3(2.6, 2.2, 1.6) } },
    vertexShader: `attribute float aA; attribute float aS; varying float vA; varying float vS; void main(){ vA = aA; vS = aS; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uA, uB; varying float vA; varying float vS; void main(){ vec3 c = mix(uA * 1.15, uB * 1.15, smoothstep(0.55, 1.0, vS)); gl_FragColor = vec4(c, vA*smoothstep(0.0, 0.5, vS)*0.95); }`,
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
    Wv.m.scale.setScalar(1 + easeOut(k) * (Wv.r || 8.5)); Wv.m.material.opacity = 1 - k;
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
let REALM_F0 = 999, EARTH_F0 = 999, EARTH_F1 = 999, EARTH_F2 = 999;
const FLAY = []; // which world each feather belongs to
const fCount = (L) => ({ got: prog.f.filter((id) => FLAY[id] === L).length, all: FLAY.filter((l) => l === L).length });
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
  const mark = (L) => { while (FLAY.length < spots.length) FLAY.push(L); };
  mark('isle');
  REALM_F0 = spots.length;
  for (const f of REALM.feathers) spots.push(f);
  mark('realm');
  EARTH_F0 = spots.length;
  for (const f of EARTH.feathers) spots.push(f);
  mark('earth');
  EARTH_F1 = spots.length;
  for (const f of BREAK_F) spots.push(f);
  mark('isle');
  for (const f of REALM.extraFeathers) spots.push(f);
  mark('realm');
  EARTH_F2 = spots.length;
  for (const f of EARTH.moreFeathers) spots.push(f);
  mark('earth');
  for (const f of HELL.feathers) spots.push(f);
  mark('hell');
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
  const hellBase = new THREE.MeshStandardMaterial({ color: '#160d0d', roughness: 0.35, metalness: 0.5, emissive: '#ff3a12', emissiveMap: TEX.vein, emissiveIntensity: 1.5 });
  const hellArch = hellBase.clone(); hellArch.emissive = new THREE.Color('#ff8a2a');
  const octa = new THREE.OctahedronGeometry(0.55, 0), cone = new THREE.ConeGeometry(0.12, 0.9, 6);
  const warnMat = new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(2.2, 0.5, 0.25), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const warnGeo = new THREE.RingGeometry(0.75, 1, 48); warnGeo.rotateX(-Math.PI / 2);
  // each world dresses its creatures differently: gilt shades, silvered seraphic husks, bone-masked beasts, obsidian demons
  const ringBy = {
    isle: ringMat,
    realm: new THREE.MeshStandardMaterial({ color: '#dfe3ee', metalness: 0.85, roughness: 0.3, emissive: '#8f7cff', emissiveIntensity: 0.35 }),
    earth: new THREE.MeshStandardMaterial({ color: '#4a3a2e', metalness: 0.7, roughness: 0.55, emissive: '#5a2408', emissiveIntensity: 0.5 }),
    hell: new THREE.MeshStandardMaterial({ color: '#241010', metalness: 0.8, roughness: 0.35, emissive: '#ff3a12', emissiveIntensity: 0.65 }),
  };
  const maskBy = {
    isle: maskMat,
    realm: new THREE.MeshStandardMaterial({ map: TEX.mask, color: '#f3dca0', roughness: 0.25, metalness: 0.55 }),
    earth: new THREE.MeshStandardMaterial({ map: TEX.mask, color: '#b9a688', roughness: 0.75, metalness: 0.0 }),
    hell: new THREE.MeshStandardMaterial({ map: TEX.mask, color: '#3a2420', roughness: 0.3, metalness: 0.6, emissive: '#7a1404', emissiveIntensity: 0.8 }),
  };
  const spawn = (x, z, guard, type = 'melee', fy, leash, earth, hell) => {
    const T = EN[type] || EN.melee, archer = !!T.archer;
    const lay = hell ? 'hell' : earth ? 'earth' : fy !== undefined ? 'realm' : 'isle';
    const g = new THREE.Group(), rM = ringBy[lay], mM = maskBy[lay];
    const baseM = hell ? (archer ? hellArch : hellBase) : earth ? (archer ? beastArcher : beastBase) : fy !== undefined ? (archer ? celArcher : celBase) : archer ? archerBase : shadeMatBase;
    const mat = baseM.clone();
    if (T.emis) mat.emissive = new THREE.Color(T.emis);
    const bombBody = T.bomb;
    const body = new THREE.Mesh(bombBody ? new THREE.SphereGeometry(0.62, 14, 10) : octa, mat);
    const bs = bombBody ? [0.95, 1.0, 0.95] : T.slam ? [1.05, 1.5, 1.05] : T.double ? [0.46, 1.75, 0.46] : T.charge ? [0.95, 1.35, 1.25] : archer ? [0.55, 1.75, 0.55] : [0.75, 1.55, 0.75];
    body.scale.set(bs[0], bs[1], bs[2]); body.position.y = bombBody ? 1.15 : 1.55; body.castShadow = true; g.add(body);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mM);
    mask.rotation.x = Math.PI / 2; mask.position.set(0, bombBody ? 1.55 : 2.05, archer ? 0.17 : bombBody ? 0.5 : 0.22); mask.scale.set(archer ? 0.8 : 1, 0.55, 1.15); g.add(mask);
    const ring = archer ? new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 6, 40, Math.PI * 1.15), rM) : new THREE.Mesh(new THREE.TorusGeometry(0.62, T.slam ? 0.06 : 0.03, 6, 40, Math.PI * 1.55), rM);
    if (archer) { ring.position.set(0, 1.6, 0.45); ring.rotation.set(0, 0, Math.PI / 2 - 0.57); }
    else { ring.position.y = bombBody ? 1.1 : 1.5; ring.rotation.x = Math.PI / 2 - 0.3; }
    g.add(ring);
    // what sets each kind apart at a glance
    if (T.slam) for (const sx of [-1, 1]) { const pl = new THREE.Mesh(octa, mat); pl.scale.set(0.55, 0.38, 0.55); pl.position.set(sx * 0.66, 2.0, 0); pl.castShadow = true; g.add(pl); }
    if (T.double) for (const sx of [-1, 1]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.15, 0.32), rM); bl.position.set(sx * 0.36, 1.55, 0.05); bl.rotation.z = sx * 0.5; g.add(bl); }
    if (T.charge || type === 'demon') for (const sx of [-1, 1]) { const h = new THREE.Mesh(cone, rM); h.scale.setScalar(type === 'demon' ? 1.6 : 1.3); h.position.set(sx * 0.26, 2.2, 0.15); h.rotation.set(-0.9, 0, sx * -0.35); g.add(h); }
    let shield = null;
    if (T.shield) { shield = new THREE.Group(); const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.08, 6), rM); disc.rotation.x = Math.PI / 2; shield.add(disc); const rn = new THREE.Mesh(new THREE.CircleGeometry(0.5, 6), new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.6, 1.3, 2.2), transparent: true, depthWrite: false })); rn.position.z = 0.05; shield.add(rn); shield.position.set(0, 1.45, 0.62); g.add(shield); }
    if (T.caster) { const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.2, 1.6) })); orb.position.set(0, 2.85, 0); g.add(orb); const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 32), rM); halo.rotation.x = Math.PI / 2; halo.position.set(0, 2.45, 0); g.add(halo); }
    const glint = new THREE.Sprite(glintMat); glint.position.set(0, 2.25, 0.35); glint.scale.setScalar(0.01); g.add(glint);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), blob.material); sh.rotation.x = -Math.PI / 2; scene.add(sh);
    let aim = null;
    if (archer) { aim = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), aimMat); aim.visible = false; scene.add(aim); noReflect(aim); }
    let warn = null;
    if (T.slam) { warn = new THREE.Mesh(warnGeo, warnMat.clone()); warn.visible = false; warn.renderOrder = 3; scene.add(noReflect(warn)); }
    scene.add(noReflect(g)); noReflect(sh);
    const y = hell ? C.groundAtL(x, z, 2) : earth ? Math.max(C.EARTH_Y, C.groundAtL(x, z, 1)) : fy ?? Math.max(0, groundAt(x, z));
    const sc = T.s || 1;
    g.position.set(x, y, z); g.scale.setScalar(sc); sh.scale.setScalar(sc);
    const hp = Math.round(T.hp * LAYER_HP[lay] * (0.92 + R() * 0.16));
    const s = { type: archer ? 'archer' : 'melee', kind: type, T, sc, lay, g, body, bodyScale: body.scale.clone(), mat, mask, ring, glint, aim, warn, shield, shards: [], sh, home: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), hp, maxHp: hp, st: 'idle', t: 0, ph: R() * 6, guard, dead: false, hitT: 0, dir: new THREE.Vector3(0, 0, 1), wander: new THREE.Vector3(x, 0, z), wt: 0, cd: 1 + R() * 1.5, r: 0.6 * sc, hy: 2.8 * sc, emis: T.emis || (archer ? '#e7a6ff' : '#ffc766') };
    if (hell) { s.hell = true; s.emis = T.emis || (archer ? '#ff8a2a' : '#ff3a12'); }
    else if (earth) { s.earth = true; s.emis = T.emis || (archer ? '#ffae4a' : '#ff6a3a'); }
    else if (fy !== undefined) { s.floor = fy; s.leash = leash; s.realm = true; s.emis = T.emis || (archer ? '#ff9ad6' : '#a77bff'); }
    s.kill = KILL_KEY[lay][type] || (lay === 'isle' ? 'shade' : lay === 'realm' ? 'celestial' : lay === 'earth' ? 'beast' : 'hellCinder');
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
  spawn(40, -124, -1, 'brute'); spawn(-152, -58, -1, 'brute'); spawn(104, 36, -1, 'stalker'); spawn(-86, -26, -1, 'stalker'); spawn(152, -140, -1, 'stalker'); spawn(-30, 120, -1, 'stalker');
  for (const [x, y, z, type, isle] of REALM.enemies) spawn(x, z, -1, type, y, isle);
  for (const [x, z, type] of EARTH.enemies) spawn(x, z, -1, type, undefined, undefined, true);
  for (const [x, z, type] of HELL.enemies) spawn(x, z, -1, type, undefined, undefined, false, true);
  spawnShade = spawn;
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
  if (!silent) { const k = s.kill || 'shade'; prog.kills[k] = (prog.kills[k] || 0) + 1; save(); }
  if (s.warn) s.warn.visible = false;
  if (silent) { s.g.visible = false; s.sh.visible = false; }
}
function explodeShade(s, siege) {
  // the rotwalker bursts: everything close is caught in the miasma
  const pd = Math.hypot(P.pos.x - s.pos.x, P.pos.z - s.pos.z);
  if (pd < 4.2 && Math.abs(P.pos.y - s.pos.y) < 3) hurtPlayer(s.T.dmg, s.pos);
  if (siege && Math.hypot(siege.x - s.pos.x, siege.z - s.pos.z) < 5.5) { siege.hp -= 22; folkFlinch(siege); }
  burst(FX.smoke, s.pos.x, s.pos.y + 1, s.pos.z, 50, { speed: 8, up: 2, life: 1.4, size: 3.4, c: [0.4, 0.5, 0.25], g: 0.2 });
  burst(FX.sparks, s.pos.x, s.pos.y + 1, s.pos.z, 40, { speed: 9, up: 3, life: 0.8, size: 1.2, c: [1.6, 2.0, 0.6] });
  CAM.shake = Math.max(CAM.shake, 0.4); Audio.sfx('slam');
  s.body.scale.copy(s.bodyScale);
  killShade(s, false); s.t = 0.6;
  if (P.lock === s) P.lock = null;
}
function shadesAlive(i) { return W.shrines[i].guards.filter((s) => !s.dead).length; }
function damageShade(s, dmg, from, kind = 'hit') {
  if (s.dead) return;
  const d = _v.copy(s.pos).sub(from); d.y = 0; d.normalize();
  // a raised shield turns aside blows from the front; a heavy blow or a counter breaks it
  if (s.T.shield && !(s.guardBreak > 0) && -d.dot(s.dir) > 0.3 && s.st !== 'hurt') {
    if (kind === 'crit') { s.guardBreak = 3.2; dmgNumber(_p.set(s.pos.x, s.pos.y + 2.6, s.pos.z), '破盾', 'crit'); burst(FX.sparks, s.pos.x, s.pos.y + 1.5, s.pos.z, 40, { speed: 7, up: 2, life: 0.7, size: 1.1, c: [1.4, 1.2, 2.2] }); }
    else { dmg *= 0.15; kind = 'block'; burst(FX.sparks, s.pos.x + s.dir.x * 0.6, s.pos.y + 1.5, s.pos.z + s.dir.z * 0.6, 14, { speed: 5, up: 1, life: 0.4, size: 0.8, c: [1.4, 1.2, 2.2] }); }
  }
  s.hp -= dmg; s.hitT = 0.15;
  s.vel.addScaledVector(d, (4 + dmg * 0.07) / (s.sc || 1));
  // the heavy ones only flinch once enough blows land
  const heavy = s.T.poise;
  if (s.st !== 'fuse' && s.st !== 'charge' && (!heavy || (s.poiseAcc = (s.poiseAcc || 0) + (kind === 'crit' ? 3 : 1)) >= heavy)) { s.poiseAcc = 0; s.st = 'hurt'; s.t = 0; s.combo = 0; }
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
    toast(`<i class="dia"></i>${KILL_NAME[s.kill] || '蝕影'}已淨化 · PURIFIED`);
    if (s.guard >= 0 && shadesAlive(s.guard) === 0) setTimeout(() => toast(`<i class="dia"></i>${SHRINES[s.guard].name}的封印已解除`, true), 700);
    updateQuest();
  }
}
let spawnShade = null;
// the roster: per-kind stats and behaviour (hp is the island baseline; deeper layers scale it)
const EN = {
  melee: { hp: 100, spd: 3.6, wind: 0.6, lunge: 13, dmg: 16 },
  archer: { hp: 70, archer: true, dmg: 12 },
  brute: { hp: 280, s: 1.45, spd: 2.3, wind: 1.05, slam: 3.6, dmg: 28, poise: 4, emis: '#ff9a3a' },
  stalker: { hp: 55, s: 0.82, spd: 5.8, wind: 0.32, lunge: 15, dmg: 11, double: true, emis: '#fff0a0' },
  guard: { hp: 190, s: 1.18, spd: 2.8, wind: 0.8, lunge: 11, dmg: 20, shield: true, poise: 3, emis: '#c9a4ff' },
  caster: { hp: 80, archer: true, caster: true, dmg: 14, emis: '#8affc8' },
  charger: { hp: 240, s: 1.5, spd: 3.0, wind: 0.85, charge: 21, dmg: 26, poise: 4, emis: '#ff4a26' },
  bomber: { hp: 45, s: 0.95, spd: 4.6, bomb: true, dmg: 34, emis: '#b4ff5a' },
  demon: { hp: 520, s: 1.75, spd: 2.8, wind: 0.95, slam: 4.2, dmg: 34, poise: 5 },
  cinder: { hp: 200, spd: 5.2, wind: 0.42, lunge: 15, dmg: 22, double: true, emis: '#ffb04a' },
  hellArcher: { hp: 170, archer: true, dmg: 22 },
};
const LAYER_HP = { isle: 1, realm: 1.6, earth: 1.9, hell: 1 };
const KILL_KEY = {
  isle: { melee: 'shade', archer: 'shadeArcher', brute: 'shadeBrute', stalker: 'shadeStalker' },
  realm: { melee: 'celestial', archer: 'celArcher', guard: 'celGuard', caster: 'celCaster' },
  earth: { melee: 'beast', archer: 'beastArcher', charger: 'beastCharger', bomber: 'beastBomber' },
  hell: { cinder: 'hellCinder', demon: 'hellDemon', hellArcher: 'hellArcher', melee: 'hellCinder' },
};
function updateShades(dt) {
  for (const s of shades) {
    if (s.dormant) continue;
    if ((s.hell ? 2 : s.earth ? 1 : 0) !== C.LAYER.cur) { if (!s.dead) { s.g.visible = false; s.sh.visible = false; } continue; }
    const far = Math.abs(s.pos.x - P.pos.x) > 110 || Math.abs(s.pos.z - P.pos.z) > 110 || Math.abs(s.pos.y - P.pos.y) > 60;
    if (!s.dead) { s.g.visible = !far; s.sh.visible = !far; if (far && s.st === 'idle') continue; }
    if (s.dead) {
      if (s.t < 1) {
        s.t += dt;
        const k = s.t;
        s.g.scale.setScalar(Math.max(0.001, (1 - k) * (s.sc || 1))); s.g.position.y += dt * 1.5;
        s.mat.emissiveIntensity = 4 * (1 - k); s.sh.visible = k < 0.9;
        if (k >= 1) s.g.visible = false;
      }
      continue;
    }
    s.t += dt; s.hitT -= dt;
    const toP = _v.copy(P.pos).sub(s.pos); toP.y = 0;
    let dist = toP.length();
    const homeD = Math.hypot(s.pos.x - s.home.x, s.pos.z - s.home.z);
    const archer = s.type === 'archer';
    // a siege beast goes for the beacon unless the seraph is right in its face
    const siege = !archer && s.siege && s.siege.st === 'siege' && !(dist < 7 && Math.abs(P.pos.y - s.pos.y) < 4) ? s.siege : null;
    if (siege) { toP.set(siege.x - s.pos.x, 0, siege.z - s.pos.z); dist = Math.max(0, toP.length() - 1.6); }
    const aggro = !!siege || (state === 'play' && dist < (archer ? 24 : 14) && Math.abs(P.pos.y - s.pos.y) < 7 && (homeD < 34 || !!s.siege));
    let glint = 0;
    if (s.guardBreak > 0) s.guardBreak -= dt;
    if (s.T.caster && s.st !== 'hurt') { // the priest mends whoever stands near
      s.healCd = (s.healCd ?? 3) - dt;
      if (s.healCd <= 0) {
        s.healCd = 6;
        for (const o of shades) if (o !== s && !o.dead && !o.dormant && o.hp < o.maxHp && Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z) < 12) {
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.3);
          burst(FX.sparks, o.pos.x, o.pos.y + 1.6, o.pos.z, 24, { speed: 3, up: 3, life: 1, size: 1, c: [1.2, 2.0, 1.4] });
        }
        burst(FX.sparks, s.pos.x, s.pos.y + 2.6, s.pos.z, 18, { speed: 2, up: 2, life: 0.9, size: 1, c: [1.2, 2.0, 1.4] });
      }
    }
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
            if (s.T.caster) fireProjectile(from.clone(), to.clone(), 9.5, s.T.dmg); else fireProjectile(from.clone(), lead, 17, s.T.dmg);
            Audio.sfx('dash');
            s.st = 'kite'; s.t = 0; s.cd = (s.T.caster ? 2.8 : 2.1) + Math.random() * 1.3;
          }
          break;
        }
        case 'hurt': s.vel.multiplyScalar(Math.exp(-6 * dt)); if (s.t > 0.45) { s.st = 'kite'; s.t = 0; s.cd = Math.max(s.cd, 0.6); } break;
      }
    } else {
      const T = s.T, sc = s.sc;
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
          s.vel.x = damp(s.vel.x, toP.x * T.spd, 4, dt); s.vel.z = damp(s.vel.z, toP.z * T.spd, 4, dt);
          if (T.bomb) { if (dist < 2.6) { s.st = 'fuse'; s.t = 0; Audio.sfx('ui'); } break; }
          if (T.charge && !siege && dist > 6 && dist < 18 && s.t > 1.2) { s.st = 'wind'; s.t = 0; break; }
          if (dist < (T.slam ? T.slam * 0.85 : 3.4) && s.t > 0.6) { s.st = 'wind'; s.t = 0; }
          break;
        }
        case 'wind': {
          s.vel.multiplyScalar(Math.exp(-6 * dt));
          if (dist > 0.1 && (!T.charge || s.t < T.wind * 0.7)) s.dir.copy(toP.normalize());
          const k = clamp(s.t / T.wind, 0, 1);
          s.mat.emissiveIntensity = 1.3 + k * 4;
          s.body.position.x = Math.sin(s.t * 70) * 0.04;
          glint = clamp((k - 0.4) / 0.5, 0, 1);
          if (s.warn) { s.warn.visible = true; s.warn.position.set(s.pos.x, s.pos.y + 0.08, s.pos.z); s.warn.scale.setScalar(T.slam * (0.35 + k * 0.65)); s.warn.material.opacity = 0.25 + k * 0.55; }
          if (s.t > T.wind) {
            s.body.position.x = 0;
            if (T.slam) { // a blow that shakes the ground around it
              if (s.warn) s.warn.visible = false;
              const pd = Math.hypot(P.pos.x - s.pos.x, P.pos.z - s.pos.z);
              if (pd < T.slam && Math.abs(P.pos.y - s.pos.y) < 2.5) hurtPlayer(T.dmg, s.pos);
              if (siege && dist < T.slam) { siege.hp -= 16; folkFlinch(siege); }
              burst(FX.smoke, s.pos.x, s.pos.y + 0.4, s.pos.z, 30, { speed: 7, up: 1, life: 1, size: 2.6, c: [0.2, 0.15, 0.18], g: 0.3 });
              burst(FX.sparks, s.pos.x, s.pos.y + 0.4, s.pos.z, 30, { speed: 8, up: 2, life: 0.7, size: 1.1, c: [2, 0.9, 0.4] });
              CAM.shake = Math.max(CAM.shake, 0.35); Audio.sfx('slam');
              s.st = 'recover'; s.t = -0.6;
            } else if (T.charge) { s.st = 'charge'; s.t = 0; s.bit = false; s.vel.copy(s.dir).multiplyScalar(T.charge); Audio.sfx('dash'); }
            else { s.st = 'lunge'; s.t = 0; s.bit = false; s.vel.copy(s.dir).multiplyScalar(T.lunge); Audio.sfx('dash'); }
          }
          break;
        }
        case 'lunge': {
          s.vel.multiplyScalar(Math.exp(-2.5 * dt));
          if (siege) { if (!s.bit && dist < 1.4) { s.bit = true; siege.hp -= 11; burst(FX.sparks, siege.x, siege.y + 2, siege.z, 14, { speed: 4, up: 2, life: 0.6, size: 1, c: [2, 0.6, 0.3] }); folkFlinch(siege); } }
          else if (!s.bit && dist < 1.25 * sc && Math.abs(P.pos.y - s.pos.y) < 2) { s.bit = true; hurtPlayer(T.dmg, s.pos); }
          if (s.t > 0.4) {
            if (T.double && !s.combo) { s.combo = 1; s.st = 'wind'; s.t = T.wind * 0.45; } // and again, at once
            else { s.combo = 0; s.st = 'recover'; s.t = 0; }
          }
          break;
        }
        case 'charge': { // a long straight rush: sidestep it and it runs on past
          if (siege) { if (!s.bit && dist < 1.8) { s.bit = true; siege.hp -= 18; folkFlinch(siege); } }
          else if (!s.bit && Math.hypot(P.pos.x - s.pos.x, P.pos.z - s.pos.z) < 1.8 * sc && Math.abs(P.pos.y - s.pos.y) < 2.2) { s.bit = true; hurtPlayer(T.dmg, s.pos); }
          if (Math.random() < dt * 30) emit(FX.smoke, { x: s.pos.x, y: s.pos.y + 0.3, z: s.pos.z, vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5), life: 0.8, s: 2, c: [0.35, 0.28, 0.24], g: 0.3 });
          if (s.t > 0.95) { s.vel.multiplyScalar(0.25); s.st = 'recover'; s.t = -0.7; } // winded
          break;
        }
        case 'fuse': { // swells, flashes, bursts
          s.vel.multiplyScalar(Math.exp(-6 * dt));
          const k = clamp(s.t / 1.1, 0, 1);
          s.body.scale.copy(s.bodyScale).multiplyScalar(1 + k * 0.55 + Math.sin(s.t * 40) * 0.04 * k);
          s.mat.emissiveIntensity = 1.4 + k * 6;
          glint = k;
          if (s.t > 1.1) { explodeShade(s, siege); continue; }
          break;
        }
        case 'recover': s.vel.multiplyScalar(Math.exp(-5 * dt)); s.mat.emissiveIntensity = damp(s.mat.emissiveIntensity, 1.3, 6, dt); if (s.warn) s.warn.visible = false; if (s.t > 0.9) { s.st = aggro ? 'chase' : 'idle'; s.t = 0; } break;
        case 'hurt': s.vel.multiplyScalar(Math.exp(-6 * dt)); if (s.warn) s.warn.visible = false; if (s.t > 0.4) { s.st = 'chase'; s.t = 0.3; } break;
      }
    }
    s.glint.scale.setScalar(glint > 0 ? (0.4 + glint * 1.1) * (0.85 + Math.sin(time * 40) * 0.15) : 0.001);
    s.pos.addScaledVector(s.vel, dt);
    for (const c of colliders.solids) {
      const dx = s.pos.x - c.x, dz = s.pos.z - c.z, d2 = dx * dx + dz * dz, rr = c.r + 0.6;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); s.pos.x = c.x + (dx / d) * rr; s.pos.z = c.z + (dz / d) * rr; }
    }
    if (s.leash) { const lx = s.pos.x - s.leash.x, lz = s.pos.z - s.leash.z, ld = Math.hypot(lx, lz), lr = (s.leash.lr ?? s.leash.r) - 1.4; if (ld > lr) { s.pos.x = s.leash.x + (lx / ld) * lr; s.pos.z = s.leash.z + (lz / ld) * lr; } }
    const gy = s.floor ?? (s.hell ? groundAt(s.pos.x, s.pos.z) : Math.max(s.earth ? C.EARTH_Y : 0, groundAt(s.pos.x, s.pos.z)));
    const padTop = s.floor !== undefined ? -1e9 : padHeightAt(s.pos.x, s.pos.z, gy + 2);
    s.pos.y = damp(s.pos.y, Math.max(gy, padTop), 8, dt);
    s.g.position.set(s.pos.x, s.pos.y + Math.sin(time * 2 + s.ph) * 0.15 * (s.T.bomb ? 0.3 : 1) + (s.st === 'wind' && s.T.slam ? clamp(s.t / s.T.wind, 0, 1) * 0.6 * s.sc : 0), s.pos.z); // heavy ones rear up before the blow
    if (s.shield) s.shield.rotation.x = damp(s.shield.rotation.x, s.guardBreak > 0 ? 1.1 : 0, 8, dt);
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
  { id: 'ophiel', key: 'boss', grp: '首領', shape: 'angel', name: '墮光守衛 · 歐菲爾', en: 'OPHIEL, THE FALLEN WARDEN', where: '墮翼之丘', threat: 3, weak: '躍擊落地後的破綻', moves: '橫掃 · 重劈 · 躍擊 · 震地光環', reward: '守衛之盾 · 墮光大劍', col: '#2a2230', acc: '#e3b866',
    lore: ['曾經守護聖所大門的熾天使。大地失去光芒的那天，他第一個拔劍，也第一個墮落。', '淨化之後，他的石像依然面向聖所，像在等待一聲召回。'] },
  { id: 'astraea', key: 'boss2', grp: '首領', shape: 'angel', name: '審判者 · 阿斯特萊亞', en: 'ASTRAEA, THE ARBITER', where: '審判之環', threat: 4, weak: '彈幕結束後的硬直', moves: '審判之槍 · 羽刃彈幕 · 光環', reward: '審判之翼', col: '#24346e', acc: '#d7b468',
    lore: ['以天秤衡量一切的審判者。她判決天界有罪，於是親手熄滅了神域的光。', '她的天秤至今仍向一邊傾斜——沒有人知道，她最後審判的是誰。'] },
  { id: 'camael', key: 'boss3', grp: '首領', shape: 'angel', name: '墮天騎士 · 卡麥爾', en: 'CAMAEL, THE FALLEN KNIGHT', where: '傾城遺跡', threat: 5, weak: '重斬後的長硬直', moves: '重斬 · 躍擊 · 衝擊波 · 灼羽彈幕', reward: '騎士之誓', col: '#5a1820', acc: '#ff8a5a',
    lore: ['曾率領天軍守護人間的騎士長。他守護的城最終傾倒，他亦隨之墮落。', '淨化之後，遺跡的地底仍傳出低沉的心跳……'] },
  { id: 'abaddon', key: 'boss4', grp: '首領', shape: 'angel', name: '冥門守衛 · 亞巴頓', en: 'ABADDON, KEEPER OF THE ABYSS', where: '冥門', threat: 5, weak: '唯有神域之主的武器能真正傷及他', moves: '冥焰重斬 · 躍擊 · 衝擊環 · 灰燼彈幕', reward: '？？？', col: '#140808', acc: '#ff5a2a',
    lore: ['冥門的守門者。據說他曾是神域最初的光，因為不肯低頭而被投入深淵。', '他守著的不是地獄的入口——而是不讓門後的東西出去。'] },
  // 光羽之境
  { id: 'shade', kill: 'shade', grp: '光羽之境', shape: 'shade', name: '蝕影', en: 'SHADE', where: '光羽之境', threat: 1, weak: '完美閃避後的反擊', moves: '突刺', col: '#26202e', acc: '#ffc766',
    lore: ['光熄滅後，由殘留的影子凝成的守衛。它們守著聖壇，卻不記得為何而守。', '每一隻蝕影的面具上，都刻著同一個名字。'] },
  { id: 'shadeArcher', kill: 'shadeArcher', grp: '光羽之境', shape: 'archer', name: '蝕影射手', en: 'SHADE ARCHER', where: '光羽之境', threat: 1, weak: '拉近距離 · 瞄準時閃避', moves: '保持距離 · 暗羽箭', col: '#221c2c', acc: '#e7a6ff',
    lore: ['總是站在光照不到的地方。它的箭由墮落的羽毛磨成。', '射出的每一根暗羽，都曾經屬於某個天使。'] },
  { id: 'shadeBrute', kill: 'shadeBrute', grp: '光羽之境', shape: 'brute', name: '重甲蝕影', en: 'IRONCLAD SHADE', where: '光羽之境 · 原野', threat: 3, weak: '重砸後的長硬直 · 從背後攻擊', moves: '蓄力重砸 · 震地', col: '#2a2024', acc: '#ff9a3a',
    lore: ['好幾個影子擠進同一副鎧甲裡，所以它走得很慢，打得很重。', '鎧甲裡偶爾傳出不同的聲音，在爭論該往哪裡走。'] },
  { id: 'shadeStalker', kill: 'shadeStalker', grp: '光羽之境', shape: 'stalker', name: '疾影', en: 'SWIFT SHADE', where: '光羽之境 · 原野', threat: 2, weak: '血量很低 · 一擊即散', moves: '連續突刺', col: '#24202a', acc: '#fff0a0',
    lore: ['影子之中最輕的一種。它不守護任何東西，只是追逐光。', '傳說疾影是孩子們的影子——在光熄滅時跑得太快，沒能跟上。'] },
  // 天上神域
  { id: 'cel', kill: 'celestial', grp: '天上神域', shape: 'shade', name: '墮化天兵', en: 'FALLEN SENTINEL', where: '天上神域', threat: 2, weak: '突進後的空隙', moves: '突進', col: '#efe9dc', acc: '#a77bff',
    lore: ['神域的守衛，被紫色的裂紋侵蝕。它們仍在巡邏，守護一座已無神明的天庭。', '裂紋的紋路與地獄的法陣如出一轍。'] },
  { id: 'celArcher', kill: 'celArcher', grp: '天上神域', shape: 'archer', name: '墮化弓兵', en: 'FALLEN BOWMAN', where: '天上神域', threat: 2, weak: '拉近距離', moves: '光矢', col: '#efe9dc', acc: '#ff9ad6',
    lore: ['曾在天庭的城垛上守望。如今它們瞄準一切會發光的東西。', '它們的弓弦是用審判者的天秤鏈改成的。'] },
  { id: 'celGuard', kill: 'celGuard', grp: '天上神域', shape: 'guard', name: '審判衛士', en: "THE ARBITER'S GUARD", where: '天上神域', threat: 3, weak: '盾只擋正面 · 繞到背後或用重擊破盾', moves: '舉盾 · 盾擊', col: '#e8e2d4', acc: '#c9a4ff',
    lore: ['審判者的親衛。它們的盾上刻著判決，從來不曾放下。', '盾的背面刻著另一行字，被刮得看不清了。'] },
  { id: 'celCaster', kill: 'celCaster', grp: '天上神域', shape: 'caster', name: '光羽祭司', en: 'FEATHER PRIEST', where: '天上神域', threat: 3, weak: '優先擊倒 · 否則同伴會不斷回復', moves: '光羽彈 · 治癒同伴', col: '#ece6da', acc: '#8affc8',
    lore: ['為墮化的天兵祈禱的祭司。它不知道自己的禱告已經沒有人在聽。', '它治癒同伴的光，是神域僅存的溫柔。'] },
  // 人間
  { id: 'beast', kill: 'beast', grp: '人間', shape: 'beast', name: '瘴獸', en: 'MIASMA BEAST', where: '人間', threat: 2, weak: '聖環 · 重擊', moves: '撲擊', col: '#2b1d1a', acc: '#ff6a3a',
    lore: ['墜光之後，從大地裂縫湧出的瘴氣所化。它們畏懼光，卻被光羽吸引。', '瘴氣的源頭，似乎在比人間更深的地方。'] },
  { id: 'beastArcher', kill: 'beastArcher', grp: '人間', shape: 'archer', name: '灼羽瘴獸', en: 'EMBER-QUILL', where: '人間', threat: 2, weak: '拉近距離', moves: '灼羽', col: '#2b1d1a', acc: '#ffae4a',
    lore: ['背上長滿燒焦羽毛的瘴獸。它把羽毛當作箭射出。', '沒有人知道，那些羽毛是從哪裡來的。'] },
  { id: 'beastCharger', kill: 'beastCharger', grp: '人間', shape: 'charger', name: '巨角瘴獸', en: 'GREATHORN', where: '人間 · 原野與裂谷', threat: 3, weak: '衝鋒時側身閃避 · 衝完會喘氣', moves: '低頭蓄勢 · 直線衝鋒', col: '#2b1a16', acc: '#ff4a26',
    lore: ['曾經是牧場裡的牛。瘴氣讓牠的角長得比牠的記憶還長。', '牠衝向的方向，總是村子。'] },
  { id: 'beastBomber', kill: 'beastBomber', grp: '人間', shape: 'bomber', name: '腐行者', en: 'ROTWALKER', where: '人間 · 沼澤', threat: 2, weak: '在牠膨脹前擊倒 · 或者遠離', moves: '膨脹 · 瘴氣爆裂', col: '#2a2a1a', acc: '#b4ff5a',
    lore: ['瘴氣在一個軀殼裡積得太滿，就會變成腐行者。', '牠們會走向人群，然後……把自己交出去。'] },
  // 地獄
  { id: 'hellCinder', kill: 'hellCinder', grp: '地獄', shape: 'stalker', name: '灰燼兵', en: 'CINDER HUSK', where: '冥門前庭', threat: 4, weak: '凡光無效 · 需要神域之主的武器', moves: '連續突刺', col: '#160d0d', acc: '#ffb04a',
    lore: ['燒剩的軀殼，裡面只剩火。它們不累，也不會停。', '灰燼兵胸口的餘火，形狀像一根羽毛。'] },
  { id: 'hellDemon', kill: 'hellDemon', grp: '地獄', shape: 'demon', name: '煉獄魔', en: 'INFERNAL', where: '冥門前庭', threat: 5, weak: '凡光無效 · 需要神域之主的武器', moves: '蓄力重砸 · 震地', col: '#140a0a', acc: '#ff3a12',
    lore: ['地獄的看守。牠的角是熔岩冷卻後的樣子。', '煉獄魔從不離開冥門前庭，像是被某種誓約綁住。'] },
  { id: 'hellArcher', kill: 'hellArcher', grp: '地獄', shape: 'archer', name: '灰燼射手', en: 'ASH ARCHER', where: '冥門前庭', threat: 4, weak: '凡光無效 · 需要神域之主的武器', moves: '熔羽箭', col: '#160d0d', acc: '#ff8a2a',
    lore: ['用燒紅的羽毛作箭。被射中的地方，會一直發燙。', '它們瞄準的不是你，而是你身上的光。'] },
];
const KILL_NAME = Object.fromEntries(CODEX.filter((c) => c.kill).map((c) => [c.kill, c.name]));
let codexSel = 0;
function codexState(c) {
  if (c.key) return prog[c.key] ? 2 : prog.seen[c.key] ? 1 : 0;
  const n = prog.kills[c.kill] || 0; return n >= 8 ? 2 : n >= 1 ? 1 : 0;
}
function codexEmblem(c, st) {
  const body = st === 0 ? '#b9b2a4' : st === 2 && c.key ? '#f1ece1' : c.col, acc = st === 0 ? '#9a927f' : c.acc;
  if (c.shape && c.shape !== 'angel') {
    const S = (d, extra = '') => `<path d="${d}" fill="${body}" stroke="${acc}" stroke-width="1.2" ${extra}/>`;
    const mask = (y) => `<path d="M48 ${y} Q60 ${y - 9} 72 ${y} Q60 ${y + 5} 48 ${y}Z" fill="#efe6d4" stroke="${acc}" stroke-width=".8"/>`;
    const shapes = {
      shade: S('M60 24 L76 62 L60 100 L44 62 Z') + mask(40),
      archer: S('M60 22 L70 62 L60 102 L50 62 Z') + mask(38) + `<path d="M84 34 Q100 62 84 90" fill="none" stroke="${acc}" stroke-width="1.6"/><path d="M84 34 L84 90" stroke="${acc}" stroke-width=".6"/>`,
      brute: S('M60 26 L84 50 L80 92 L40 92 L36 50 Z') + S('M30 44 L42 38 L46 52 L34 56 Z') + S('M90 44 L78 38 L74 52 L86 56 Z') + mask(42),
      stalker: S('M60 20 L67 62 L60 104 L53 62 Z') + `<path d="M48 44 L36 80 M72 44 L84 80" stroke="${acc}" stroke-width="2"/>` + mask(36),
      guard: S('M60 24 L76 62 L60 100 L44 62 Z') + mask(40) + `<path d="M60 52 L76 60 L76 78 L60 88 L44 78 L44 60 Z" fill="${body}" stroke="${acc}" stroke-width="1.6"/><circle cx="60" cy="70" r="5" fill="none" stroke="${acc}" stroke-width="1"/>`,
      caster: S('M60 34 L74 66 L60 100 L46 66 Z') + mask(48) + `<circle cx="60" cy="20" r="6" fill="${acc}" opacity=".85"/><ellipse cx="60" cy="34" rx="11" ry="3" fill="none" stroke="${acc}" stroke-width="1.2"/>`,
      beast: S('M60 28 L80 62 L60 98 L40 62 Z') + mask(42) + `<path d="M52 36 L46 24 M68 36 L74 24" stroke="${acc}" stroke-width="2"/>`,
      charger: S('M60 34 L88 62 L74 96 L46 96 L32 62 Z') + mask(48) + `<path d="M50 42 Q30 30 28 14 M70 42 Q90 30 92 14" fill="none" stroke="${acc}" stroke-width="3"/>`,
      bomber: `<circle cx="60" cy="68" r="28" fill="${body}" stroke="${acc}" stroke-width="1.2"/><circle cx="50" cy="62" r="4" fill="${acc}" opacity=".7"/><circle cx="70" cy="76" r="5" fill="${acc}" opacity=".6"/><circle cx="64" cy="56" r="3" fill="${acc}" opacity=".8"/>` + mask(46),
      demon: S('M60 28 L88 54 L82 96 L38 96 L32 54 Z') + mask(44) + `<path d="M48 36 Q28 30 24 8 M72 36 Q92 30 96 8" fill="none" stroke="${acc}" stroke-width="4"/>`,
    };
    return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="${acc}" stroke-width=".8" stroke-dasharray="2 4"/>${st ? shapes[c.shape] || shapes.shade : `<g opacity=".55">${shapes[c.shape] || shapes.shade}</g><text x="60" y="76" text-anchor="middle" font-size="26" fill="${acc}" font-family="serif">?</text>`}</svg>`;
  }
  const wing = (sx) => `<path transform="translate(60 54) scale(${sx} 1)" d="M6 0 C26 -26 52 -30 58 -14 C46 -12 40 -6 36 2 C44 0 50 4 50 12 C38 8 30 10 24 16 C28 20 28 26 24 30 C16 22 10 14 6 8 Z" fill="${body}" stroke="${acc}" stroke-width="1.2" opacity="${st ? 0.95 : 0.6}"/>`;
  return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="${acc}" stroke-width=".8" stroke-dasharray="2 4"/>${wing(1)}${wing(-1)}
    <ellipse cx="60" cy="28" rx="13" ry="4" fill="none" stroke="${acc}" stroke-width="1.6"/><circle cx="60" cy="40" r="7" fill="${body}" stroke="${acc}" stroke-width="1"/>
    <path d="M60 47 L72 92 L48 92 Z" fill="${body}" stroke="${acc}" stroke-width="1"/>${st === 0 ? `<text x="60" y="76" text-anchor="middle" font-size="26" fill="${acc}" font-family="serif">?</text>` : ''}
    ${st === 2 && c.key ? `<text x="60" y="112" text-anchor="middle" font-size="9" letter-spacing="3" fill="#a88444" font-family="Cinzel,serif">PURIFIED</text>` : ''}</svg>`;
}
function renderCodex() {
  let lastG = '';
  $('codexList').innerHTML = CODEX.map((c, i) => {
    const st = codexState(c);
    const tag = c.key ? (st === 2 ? '已淨化' : st === 1 ? '交戰過' : '未知') : `${prog.kills[c.kill] || 0}`;
    const head = c.grp !== lastG ? `<li class="grp">${c.grp}</li>` : ''; lastG = c.grp;
    return `${head}<li class="${i === codexSel ? 'sel' : ''} ${st ? '' : 'unk'}" data-i="${i}"><i class="dia"></i><span>${st ? c.name.split(' · ')[0] : '？？？'}</span><em>${tag}</em></li>`;
  }).join('');
  const c = CODEX[codexSel], st = codexState(c);
  const stars = '✦'.repeat(c.threat) + '<i>' + '✦'.repeat(5 - c.threat) + '</i>';
  const lore = c.lore.map((t, i) => (st > i ? `<p>${t}</p>` : `<p class="lock">${i ? (c.key ? '淨化後解鎖' : '討伐 8 隻後解鎖') : c.key ? '交戰後解鎖' : '討伐 1 隻後解鎖'}</p>`)).join('');
  let extra = '';
  if (c.key && st === 2) extra = `<div class="rw"><b>獎勵</b><span>${c.reward}</span></div>`;
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
      setTimeout(() => toast('<i class="dia"></i>石像前，插著一把大劍……', true), 11800);
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
  const boss4 = createBoss(G, {
    key: 'boss4', name: '冥門守衛 · 亞巴頓', en: 'ABADDON, KEEPER OF THE ABYSS', fallen: true, scale: 4.3, weapon: 'greatsword', maxHp: 4600, tint: '#140808', emis: '#ff3a12', hell: true,
    home: HELL.bossHome, floor: HELL.arenaFloor, arenaR: 30, leash: 44,
    onDefeated: () => {
      prog.boss4 = true; save(); applyStats(true);
      document.body.classList.remove('boss');
      setTimeout(() => toast('<i class="dia"></i>冥門守衛倒下了 · 但冥門依然緊閉', true), 1400);
      setTimeout(() => regionCard('冥門守衛已淨化', 'THE KEEPER RESTS'), 2800);
      updateQuest();
    },
  });
  bosses = [boss, boss2, boss3, boss4];
}

// ------------------------------------------------------------------ collision helpers
function padHeightAt(x, z, y) {
  let best = -1e9;
  for (const p of colliders.pads) {
    const top = p.dyn ? p.dyn() : p.top;
    if (top <= best) continue;
    const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
    if (d2 >= p.r * p.r || y < top - 0.75 || y <= (p.bot ?? -1e9)) continue;
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
    if (py >= top - 0.75 || pos.y + 1.7 < (p.bot ?? -1e9)) continue;
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
  const Wv = FX.wave; Wv.t = 0.35; Wv.r = 0; Wv.m.visible = true; Wv.m.position.set(cx, gy + 0.1, cz);
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
    g.position.set(x, y, z); (L ? EARTH.root : scene).add(g);
    const col = { x, z, r: 3.3, y0: y - 1, y1: y + 6 };
    colliders.solids.push(col);
    const b = { id, kind, x, y, z, g, col, broken: !!prog.broken[id], need: kind === 'seal' ? 'shield' : 'oath', gate: !feather };
    if (b.broken) { g.visible = false; col.y1 = -1e9; }
    if (feather) BREAK_F.push([x, y + 1.4, z]);
    breakables.push(b);
  };
  add('sealElder', 'seal', -178, 80, 0); add('sealNorth', 'seal', -60, -160, 0); add('sealWood', 'seal', -170, 205, 1);
  add('rockLake', 'rock', 40, 110, 0); add('rockPeak', 'rock', 238, -150, 1); add('rockKeep', 'rock', EARTH.keepGate.x, EARTH.keepGate.z, 1, false);
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
function equipWeapon(w) { if (!prog.weapons[w]) return; prog.weapon = w; save(); hero.setWeapon(w); applyWeaponLook(); updateQuest(); }
function perfectDodge() {
  slowT = 0.8; P.inv = Math.max(P.inv, 0.95); P.counterT = 1.8; P.perfectCd = 1.1;
  bigText('完美閃避', 'PERFECT DODGE');
  featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 14, 3.5);
  burst(FX.sparks, P.pos.x, P.pos.y + 1, P.pos.z, 40, { speed: 6, up: 1, life: 0.8, size: 1, c: [1.9, 1.6, 1.0] });
  const Wv = FX.wave; Wv.t = 0.35; Wv.r = 0; Wv.m.visible = true; Wv.m.position.set(P.pos.x, support(P.pos.x, P.pos.z, P.pos.y).h + 0.08, P.pos.z);
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
function hitEnemy(e, dmg, poise, kind) {
  // nothing of hell is harmed by mortal light until the seraph carries the Empyrean lord's weapon
  if ((e.hell || (e.isBoss && e.cfg.hell)) && !holyBlade()) { dmg *= 0.08; poise *= 0.15; kind = 'resist'; resistHint(); }
  if (TEST.oneHit) { dmg *= e.isBoss ? 12 : 60; poise *= 4; }
  if (e.isBoss) e.damage(dmg, poise, P.pos, kind); else damageShade(e, dmg, P.pos, kind);
}
function doHit(A) {
  if (A.slam) { slam(A); return; }
  const fx = Math.sin(P.yaw + P.spin), fz = Math.cos(P.yaw + P.spin), L = wlook();
  let n = 0;
  for (const e of enemyList()) {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz), er = e.r || 0.6;
    if (d - er > A.reach) continue;
    if (Math.abs(e.pos.y - P.pos.y) > (e.hy || 2.8)) continue;
    if (A.cone > -1.5 && d > er + 0.8 && (dx * fx + dz * fz) / (d + 1e-5) < A.cone) continue;
    const dmg = (A.dmg[0] + Math.random() * (A.dmg[1] - A.dmg[0])) * P.atk.mult * P.atkMul;
    hitEnemy(e, dmg, A.poise * P.atk.mult, P.atk.kind === 'counter' || P.atk.kind === 'heavy' ? 'crit' : '');
    burst(FX.sparks, e.pos.x, e.pos.y + 1.3 * (e.sc || 1), e.pos.z, A.heavyHit ? 26 : 12, { speed: A.heavyHit ? 7 : 5, up: 1.5, life: 0.5, size: A.heavyHit ? 1.3 : 0.9, c: L.spark });
    n++;
  }
  if (n) { hitstop = Math.max(hitstop, L.stop); CAM.shake = Math.max(CAM.shake, L.shake); if (A.heavyHit) Audio.sfx('hitHeavy'); }
}
// the greatsword comes down: everything around the point of impact is struck
function slam(A) {
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), R = A.slam * (0.85 + (P.atk.mult - 1) * 0.4);
  const cx = P.pos.x + fx * 2.2, cz = P.pos.z + fz * 2.2, gy = support(cx, cz, P.pos.y + 1).h, L = wlook();
  CAM.shake = Math.max(CAM.shake, 0.55); hitstop = Math.max(hitstop, 0.09);
  burst(FX.smoke, cx, gy + 0.4, cz, 34, { speed: R * 1.4, up: 1.6, life: 1.0, size: 2.4, c: [0.85, 0.74, 0.62] });
  burst(FX.sparks, cx, gy + 0.5, cz, 70, { speed: R * 1.8, up: 4, life: 0.9, size: 1.2, c: L.spark });
  const Wv = FX.wave; Wv.t = 0.42; Wv.m.visible = true; Wv.m.position.set(cx, gy + 0.12, cz); Wv.r = R;
  for (const e of enemyList()) {
    const d = Math.hypot(e.pos.x - cx, e.pos.z - cz);
    if (d - (e.r || 0.6) > R || Math.abs(e.pos.y - gy) > 4) continue;
    const dmg = (A.dmg[0] + Math.random() * (A.dmg[1] - A.dmg[0])) * P.atk.mult * P.atkMul * (d < R * 0.5 ? 1 : 0.7);
    hitEnemy(e, dmg, A.poise * P.atk.mult, 'crit');
  }
  for (const b of breakables) if (!b.broken && b.kind === 'rock' && P.atk.kind === 'heavy' && P.atk.mult >= 1.6 && Math.hypot(b.x - cx, b.z - cz) < R + 1.5 && Math.abs(b.y - gy) < 6) breakIt(b);
  Audio.sfx('slam');
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
    Ar.g.scale.setScalar((kind === 'counter' ? 1.45 : kind === 'l2' ? 1.1 : 1) * (prog.weapon === 'greatsword' ? 1.4 : 1));
  }
  if (A.thrust) { const L = FX.lance; L.t = 0; L.g.visible = true; L.g.rotation.y = P.yaw; L.g.scale.setScalar(kind === 'heavy' ? 1.5 + (mult - 1) : A.lanceS || 1); }
  if (A.slam) { featherBurst(P.pos.x, P.pos.y + 2.2, P.pos.z, 4, 1.5); CAM.shake = Math.max(CAM.shake, 0.06); }
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
  Wv.t = 0; Wv.r = 0; Wv.m.visible = true; Wv.p.visible = true;
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
  if (P.inv > 0 || state !== 'play' || TEST.god) return;
  if (P.guardT > 0) {
    const parry = P.guardT > 0.38; P.guardT = 0.12; P.inv = 0.3;
    const d = _p.copy(P.pos).sub(from); d.y = 0; d.normalize(); P.vel.x = d.x * 4; P.vel.z = d.z * 4;
    burst(FX.sparks, P.pos.x + Math.sin(P.yaw), P.pos.y + 1.2, P.pos.z + Math.cos(P.yaw), 40, { speed: 7, up: 2, life: 0.6, size: 1, c: [2, 1.7, 1] });
    CAM.shake = Math.max(CAM.shake, 0.2); hitstop = Math.max(hitstop, 0.08);
    if (parry) { perfectDodge(); bigText('聖盾', 'PARRY'); } else Audio.sfx('hit');
    return;
  }
  if (P.inHell && !holyBlade()) dmg *= 3;
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
  if (P.grounded && P.safeT < 0 && (P.inRealm ? P.pos.y > REALM.y - 20 : P.inHell ? !inLava(P.pos.x, P.pos.z) && P.pos.y > C.HELL_Y - 0.4 : P.inEarth ? !inRift(P.pos.x, P.pos.z, 3) && P.pos.y > C.EARTH_Y - 6 : r < edgeR(Math.atan2(P.pos.z, P.pos.x)) - 16)) { P.safe.copy(P.pos); P.safeT = 0.5; }
  if (P.inRealm && P.pos.y < REALM.y - 70) { P.inRealm = false; currentRegion = ''; updateQuest(); } // dropped out of the Empyrean: fall to the isle below
  if (!P.inEarth && !P.inHell && P.pos.y < -70) dropToEarth(); // over the island's edge: through the cloud sea to the human world
  if (P.inEarth) {
    const rr = Math.hypot(P.pos.x, P.pos.z);
    if (rr > 600) { P.pos.x *= 600 / rr; P.pos.z *= 600 / rr; }
    if (P.pos.y < C.EARTH_Y - 110 && inRift(P.pos.x, P.pos.z, 10)) dropToHell(); // the rift goes all the way down
    else if (P.pos.y < C.EARTH_Y - 60 && !inRift(P.pos.x, P.pos.z, 10)) fallRespawn();
  }
  if (P.inHell) {
    const hx = P.pos.x - C.HCX, hz = P.pos.z - (C.HCZ - 40), hr = Math.hypot(hx, hz);
    if (hr > 222) { P.pos.x = C.HCX + (hx / hr) * 222; P.pos.z = C.HCZ - 40 + (hz / hr) * 222; }
    if (P.pos.y < C.HELL_Y - 0.9 && inLava(P.pos.x, P.pos.z)) lavaBurn();
    else if (P.pos.y < C.HELL_Y - 60) fallRespawn();
  }
}
function dropToEarth() {
  // punch through the cloud sea and keep falling into the world below
  const rr = Math.hypot(P.pos.x, P.pos.z), k = rr > 205 ? 205 / rr : 1;
  P.pos.set(P.pos.x * k, C.EARTH_Y + 175, P.pos.z * k);
  P.vel.y = Math.min(P.vel.y, -40); P.glide = false; P.grounded = false;
  P.inEarth = true; P.inRealm = false;
  syncLayer();
  P.checkpoint.copy(EARTH.landing); // the light pillar is where a fallen seraph wakes in this world
  flashScreen(0.9); CAM.shake = Math.max(CAM.shake, 0.4);
  const first = !prog.earth; prog.earth = true; save();
  regionCard('人間', 'THE MORTAL WORLD');
  if (first) setTimeout(() => toast('<i class="dia"></i>穿過雲海，墜向人間 · 按「展翼」減速滑翔', true), 900);
  updateQuest();
}
function dropToHell() {
  // through the rift, past the dark, into the fire
  const hx = clamp(P.pos.x, C.HCX - 110, C.HCX + 110);
  P.pos.set(hx, C.HELL_Y + 150, HELL.pillar.z - 6);
  P.vel.y = Math.min(P.vel.y, -34); P.glide = false; P.grounded = false;
  P.inEarth = false; P.inRealm = false; P.inHell = true;
  syncLayer(); currentRegion = '';
  P.checkpoint.copy(HELL.landing);
  flashScreen(0.6); CAM.shake = Math.max(CAM.shake, 0.6);
  const first = !prog.hell; prog.hell = true; save();
  regionCard('地獄 · 冥門前庭', 'THE ABYSSAL THRESHOLD');
  if (first) {
    setTimeout(() => toast('<i class="dia"></i>墜入裂谷深處 · 這裡的一切都不受凡光所傷', true), 1800);
    setTimeout(() => toast('<i class="dia"></i>在地獄受到的傷害大幅增加 · 墜落之地的光柱可以返回人間', true), 5200);
  }
  updateQuest();
}
function lavaBurn() {
  flashScreen(0.5); CAM.shake = Math.max(CAM.shake, 0.4);
  P.pos.copy(P.safe); P.pos.y += 0.5; P.vel.set(0, 0, 0); P.glide = false; P.grounded = true;
  P.hp = Math.max(1, P.hp - 25); P.lastHurt = time;
  burst(FX.sparks, P.pos.x, P.pos.y + 1, P.pos.z, 40, { speed: 6, up: 3, life: 1, size: 1.1, c: [2.4, 0.8, 0.2] });
  toast('<i class="dia"></i>熔焰灼身 · 被推回地面');
  Audio.sfx('hurt');
}
let resistHintT = -99;
function resistHint() {
  if (time - resistHintT < 25) return; resistHintT = time;
  toast(prog.hellBlade ? '<i class="dia"></i>凡光無法傷及地獄之物……在聖匣裡換上天樞之劍' : '<i class="dia"></i>凡光無法傷及地獄之物……需要神域之主的武器', true);
}
function riftRepel() {
  // the seal holds: the dark throws the seraph back up to the rim (no harm done — the way down isn't open yet)
  flashScreen(0.7); CAM.shake = Math.max(CAM.shake, 0.5);
  P.pos.copy(P.safe); P.pos.y += 1; P.vel.set(0, 0, 0); P.glide = false; P.grounded = true;
  burst(FX.sparks, P.pos.x, P.pos.y + 1, P.pos.z, 40, { speed: 6, up: 3, life: 1, size: 1.1, c: [2, 0.55, 0.25] });
  toast('<i class="dia"></i>深淵被封印 · 一股力量將你推回地面', true);
  Audio.sfx('hurt');
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
  P.inEarth = P.checkpoint.y < -350 && P.checkpoint.y > -1200; P.inHell = P.checkpoint.y < -1200; P.inRealm = P.checkpoint.y > 200; syncLayer(); currentRegion = ''; updateQuest();
  for (const b of beacons) if (b.st === 'siege') endSiege(b, 'calm');
  for (const b of bosses) b.reset();
  P.grounded = true; P.glide = false;
  CAM.yaw = P.yaw + Math.PI;
  respawnShades();
  state = 'play';
}


// ------------------------------------------------------------------ the people of the mortal world
// Captives sealed in miasma crystal (clear the guards, then purify), beacons whose keepers must be defended
// against waves of beasts (then kindle the flame), and Belldawn Hold, which fills with people and light as they come home.
let folk = null;
const captives = [], beacons = [];
const HOME_LINES = ['謝謝你。我把燈帶回來了。', '回到這裡，才知道自己還活著。', '我會守住這盞燈，直到天亮。', '他們說天使都墮落了。你不一樣。', '晨鐘響的時候，我會為你祈禱。', '我要把這件事告訴所有人。'];
function say(line) { toast(`<span class="say">「${line}」</span>`); }
function lampsLit() { return 5 + nRescued() * 2 + nBeacons() * 2; }
function addResident(i) {
  const T = EARTH.town, sl = T.slots[i % T.slots.length], ring = Math.floor(i / T.slots.length);
  const x = T.x + sl[0] * (1 + ring * 0.6), z = T.z + sl[1] * (1 + ring * 0.6);
  return folk.add({ x, z, yaw: Math.atan2(T.x - x, T.z - z), st: i % 3 === 1 ? 'pray' : 'idle', line: HOME_LINES[i % HOME_LINES.length] });
}
function makeCrystal(x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const m = new THREE.MeshStandardMaterial({ color: '#2b2133', emissive: '#ff5a3a', emissiveMap: TEX.vein, emissiveIntensity: 1.3, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.82 });
  const geo = new THREE.OctahedronGeometry(1, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, top = i >= 7, sh = new THREE.Mesh(geo, m);
    if (top) { sh.position.set((i - 7.5) * 0.5, 2.4, 0); sh.scale.set(0.35, 1.3, 0.35); sh.rotation.z = (i - 7.5) * 0.9; }
    else { sh.position.set(Math.cos(a) * 1.05, 1.2, Math.sin(a) * 1.05); sh.scale.set(0.32, 1.4 + (i % 3) * 0.35, 0.32); sh.rotation.set(Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32); }
    sh.castShadow = true; g.add(sh);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(1.4, 0.3, 0.2), transparent: true, opacity: 0.6, depthWrite: false })); glow.scale.setScalar(5); glow.position.y = 1.2; g.add(glow);
  EARTH.root.add(noReflect(g));
  return g;
}
function buildFolk() {
  folk = createFolk(EARTH.root, { ground: (x, z) => C.groundAtL(x, z, 1), max: 96 });
  const T = EARTH.town, R = mulberry(4242);
  // the townsfolk of Belldawn
  const toCrater = Math.atan2(EARTH.pillar.x - T.x, EARTH.pillar.z - T.z), gx = Math.sin(toCrater), gz = Math.cos(toCrater);
  [
    { x: T.x + 3, z: T.z + 2.5, st: 'idle', line: '晨鐘每天早上都會響。就算沒有人聽見，也要響。', col: '#bfae8e' },
    { x: T.x - 6, z: T.z - 16, st: 'pray', line: '騎士長走了以後，這口鐘就是我們的盾。', kind: 'monk' },
    { x: T.x + 13, z: T.z + 5, st: 'idle', line: '孩子問我，天使是不是忘記了我們。', col: '#b9a0a0' },
    { x: T.x + 14.2, z: T.z + 6.4, st: 'idle', scale: 0.6, lantern: false, line: '你的翅膀……可以借我摸一下嗎？', col: '#e1c48e' },
    { x: T.x + gx * 58 + gz * 4, z: T.z + gz * 58 - gx * 4, st: 'guard', yaw: toCrater, line: '城外的燈一盞一盞熄了。你……是來點燈的嗎？' },
    { x: T.x + gx * 58 - gz * 4, z: T.z + gz * 58 + gx * 4, st: 'guard', yaw: toCrater },
  ].forEach((o) => folk.add(o));
  for (let i = 0; i < nRescued(); i++) addResident(i);
  // captives in their crystal
  for (const cd of EARTH.captives) {
    const c = Object.assign({}, cd, { guards: [], done: !!prog.rescued[cd.id] });
    c.crystal = makeCrystal(c.x, c.y, c.z);
    c.person = folk.add({ x: c.x, z: c.z, st: 'sealed', lit: false, yaw: R() * 6.28 });
    for (const [dx, dz, type] of cd.guards) { const sh = spawnShade(c.x + dx, c.z + dz, -1, type || 'melee', undefined, undefined, true); sh.site = c; c.guards.push(sh); if (c.done) killShade(sh, true); }
    if (c.done) { c.crystal.visible = false; c.person.on = false; }
    captives.push(c);
  }
  // beacons and their keepers
  for (const bd of EARTH.beacons) {
    const b = Object.assign(bd, { st: prog.beacons[bd.id] ? 'lit' : 'calm', hp: 100, wave: 0, beasts: [], keepers: [], gap: 0, cool: 0 });
    for (let i = 0; i < b.folk; i++) {
      const a = (i / b.folk) * Math.PI * 2 + 0.4, x = b.x + Math.cos(a) * 3.6, z = b.z + Math.sin(a) * 3.6;
      b.keepers.push(folk.add({ x, z, yaw: Math.atan2(Math.cos(a), Math.sin(a)), kind: b.monks ? 'monk' : b.id === 'bHarbor' ? 'fisher' : 'villager', st: b.st === 'lit' ? (i % 2 ? 'idle' : 'pray') : 'guard', line: b.st === 'lit' ? b.line : i === 0 ? '……牠們又來了。燈火撐不了多久。' : null }));
    }
    for (let i = 0; i < 4; i++) {
      const sh = spawnShade(b.x, b.z, -1, ['melee', 'melee', 'bomber', 'charger'][i], undefined, undefined, true);
      sh.siege = b; killShade(sh, true); sh.dormant = true; sh.home.set(b.x, b.y, b.z); b.beasts.push(sh);
    }
    beacons.push(b);
  }
  EARTH.lamps.set(lampsLit());
}
function folkFlinch(b) { for (const p of b.keepers) if (p.st === 'guard') p.set('cower'); }
function wake(sh, x, z) {
  sh.dead = false; sh.dormant = false; sh.hp = sh.maxHp; sh.t = 0; sh.st = 'chase'; sh.combo = 0;
  sh.pos.set(x, C.groundAtL(x, z, 1), z); sh.vel.set(0, 0, 0); sh.g.scale.setScalar(sh.sc || 1); sh.body.scale.copy(sh.bodyScale); sh.g.visible = true; sh.sh.visible = true; sh.mat.emissiveIntensity = 1.3;
  burst(FX.smoke, x, sh.pos.y + 1, z, 22, { speed: 4, up: 2, life: 1.1, size: 2.2, c: [0.35, 0.25, 0.3] });
}
function sleepBeast(sh) {
  if (!sh.dead) burst(FX.smoke, sh.pos.x, sh.pos.y + 1, sh.pos.z, 16, { speed: 3, up: 2, life: 1, size: 2, c: [0.35, 0.25, 0.3] });
  sh.dead = true; sh.dormant = true; sh.st = 'dead'; sh.t = 9; sh.g.visible = false; sh.sh.visible = false; if (sh.aim) sh.aim.visible = false;
}
function spawnWave(b) {
  const n = b.waves[b.wave], a0 = Math.atan2(b.x - P.pos.x, b.z - P.pos.z);
  for (let i = 0; i < n; i++) {
    const sh = b.beasts[n >= 4 ? i : Math.min(i, 2)], a = a0 + (i - (n - 1) / 2) * 0.7, r = 24;
    wake(sh, b.x + Math.sin(a) * r, b.z + Math.cos(a) * r);
  }
  toast(`<i class="dia"></i>${b.name} · 第 <b>${b.wave + 1}</b>/${b.waves.length} 波`);
}
function startSiege(b) {
  b.st = 'siege'; b.hp = 100; b.wave = 0; b.gap = 2.2;
  for (const p of b.keepers) p.set('guard');
  toast(`<i class="dia"></i>瘴獸逼近${b.name} · 守住燈火`, true);
  Audio.sfx('ui');
  spawnWave(b);
}
function endSiege(b, st) {
  b.st = st; b.cool = 6;
  for (const sh of b.beasts) if (!sh.dormant) sleepBeast(sh);
  for (const p of b.keepers) p.set(st === 'fallen' ? 'cower' : 'guard');
}
function kindle(b) {
  b.st = 'lit'; prog.beacons[b.id] = true; save();
  applyStats(false); P.hp = Math.min(P.maxHp, P.hp + 10);
  P.checkpoint.set(b.x, b.y + 0.5, b.z + 5);
  b.keepers.forEach((p, i) => { p.line = i === 0 ? b.line : null; p.set('cheer'); });
  burst(FX.sparks, b.x, b.y + 2.4, b.z, 80, { speed: 7, up: 5, life: 1.4, size: 1.3, c: [2.2, 1.5, 0.7] });
  flashScreen(0.4); Audio.sfx('perfect');
  bigText('燈火重燃', 'THE LIGHT HOLDS');
  setTimeout(() => toast(`<i class="dia"></i>${b.name} 成為據點 · 生命上限 +10`, true), 1200);
  EARTH.lamps.set(lampsLit()); updateQuest();
}
function rescue(c) {
  c.done = true; prog.rescued[c.id] = true; save();
  c.crystal.visible = false;
  burst(FX.sparks, c.x, c.y + 1.5, c.z, 90, { speed: 7, up: 4, life: 1.3, size: 1.2, c: [1.9, 1.4, 0.8] });
  burst(FX.smoke, c.x, c.y + 1, c.z, 30, { speed: 5, up: 2, life: 1.2, size: 2.2, c: [0.45, 0.32, 0.4] });
  flashScreen(0.35); CAM.shake = Math.max(CAM.shake, 0.25); Audio.sfx('perfect');
  const p = c.person, T = EARTH.town;
  p.lit = true; p.yaw = Math.atan2(P.pos.x - p.x, P.pos.z - p.z);
  p.set('bow', () => { say(c.line); setTimeout(() => { const a = Math.atan2(T.x - p.x, T.z - p.z); p.dest = { x: p.x + Math.sin(a) * 30, z: p.z + Math.cos(a) * 30 }; p.set('leave'); }, 1800); });
  const before = P.maxFlasks;
  applyStats(false); P.flasks = Math.min(P.maxFlasks, P.flasks + 1);
  const n = nRescued();
  toast(`<i class="dia"></i>救出被困的人 <b>${n}</b>/${captives.length} · 他們會回到晨鐘堡 · 光露 +1`, true);
  if (P.maxFlasks > before) setTimeout(() => toast('<i class="dia"></i>人們的感謝 · 聖瓶上限 +1', true), 2200);
  addResident(n - 1); EARTH.lamps.set(lampsLit()); updateQuest();
}
function updateFolk(dt) {
  if (!folk) return;
  for (const b of beacons) {
    b.setPower(b.st === 'lit' ? 1 : b.st === 'siege' ? 0.2 + 0.4 * Math.max(0, b.hp) / 100 : b.st === 'won' ? 0.55 : 0.12, time);
    if (state !== 'play' || !P.inEarth) continue;
    const d = Math.hypot(P.pos.x - b.x, P.pos.z - b.z), near = d < 40 && Math.abs(P.pos.y - b.y) < 24;
    if (b.st === 'calm' && near) startSiege(b);
    else if (b.st === 'siege') {
      if (d > 95) { endSiege(b, 'calm'); continue; }
      if (b.hp <= 0) { endSiege(b, 'fallen'); toast(`<i class="dia"></i>${b.name}的燈火熄滅了……離開再回來可以再試`, true); Audio.sfx('hurt'); continue; }
      const alive = b.beasts.some((sh) => !sh.dormant && !sh.dead);
      if (!alive) {
        b.gap -= dt;
        if (b.gap <= 0) {
          if (b.wave + 1 < b.waves.length) { b.wave++; b.gap = 2.2; spawnWave(b); }
          else { b.st = 'won'; for (const p of b.keepers) p.set('cheer'); toast(`<i class="dia"></i>守住了 · 點亮${b.name}的燈火`, true); Audio.sfx('glide'); }
        }
      }
      for (const p of b.keepers) if (p.st === 'cower' && p.t > 1.6) p.set('guard');
    } else if (b.st === 'fallen') { b.cool -= dt; if (b.cool <= 0 && d > 45) { b.st = 'calm'; for (const p of b.keepers) p.set('guard'); } }
  }
  folk.update(dt, time, camera.position, P.pos, P.inEarth && state === 'play' ? say : null);
  // the siege bar
  const sb = beacons.find((b) => b.st === 'siege');
  if (sb !== hud.siegeB) { hud.siegeB = sb; $('siegeBar').classList.toggle('hidden', !sb); document.body.classList.toggle('siege', !!sb); if (sb) { $('siegeName').textContent = `守住${sb.name}的燈火`; $('siegeEn').textContent = `DEFEND ${sb.en}`; } }
  if (sb) { $('siegeHp').style.transform = `scaleX(${clamp(sb.hp / 100, 0, 1)})`; $('siegeWave').textContent = `${sb.wave + 1} / ${sb.waves.length}`; }
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
    if (!t && P.inHell) {
      if (Math.hypot(P.pos.x - HELL.pillar.x, P.pos.z - HELL.pillar.z) < 6 && Math.abs(P.pos.y - HELL.pillar.y) < 5) t = { kind: 'riseHell' };
      else if (Math.hypot(P.pos.x - HELL.gate.x, P.pos.z - HELL.gate.z) < 12 && Math.abs(P.pos.y - HELL.gate.y) < 8) t = { kind: 'hellGate' };
    }
    if (!t) t = storyTarget();
    if (!t && P.inEarth) {
      for (const c of captives) if (!c.done && Math.hypot(P.pos.x - c.x, P.pos.z - c.z) < 4.8 && Math.abs(P.pos.y - c.y) < 4) { const n = c.guards.filter((g) => !g.dead).length; t = n ? { kind: 'crystalSealed', n, c } : { kind: 'purify', c }; }
      for (const b of beacons) if (b.st === 'won' && Math.hypot(P.pos.x - b.x, P.pos.z - b.z) < 6 && Math.abs(P.pos.y - b.y) < 4) t = { kind: 'kindle', b };
    }
  }
  const key = (o) => JSON.stringify(o && { k: o.kind, n: o.n, i: o.s?.i ?? o.c?.id ?? o.b?.id ?? o.k });
  if (key(t) !== key(interactTarget)) {
    interactTarget = t;
    const el = $('bInteract');
    if (!t) el.classList.add('hidden');
    else {
      el.classList.remove('hidden');
      el.classList.toggle('locked', t.kind === 'sealed' || t.kind === 'coreLocked' || t.kind === 'ascendLocked' || t.kind === 'crystalSealed' || t.kind === 'hellGate');
      const L = {
        shrine: ['點亮聖壇', 'KINDLE THE SHRINE'], sealed: [`淨化周圍的蝕影 <em>${t.n}</em>`, 'SEALED BY SHADES'],
        core: ['觸碰聖核', 'TOUCH THE SACRED CORE'], coreLocked: [`聖核沉睡中 <em>${t.n}/4</em>`, 'LIGHT ALL FOUR SHRINES'],
        ascend: ['升往天上神域', 'ASCEND TO THE EMPYREAN'], ascendLocked: [`光羽之力不足 <em>Lv${t.n}/3</em>`, 'REACH LV 3 TO ASCEND'],
        descend: ['返回人間之島', 'RETURN TO THE ISLE'], rise: ['返回天上之島', 'RETURN TO THE ISLE ABOVE'],
        riseHell: ['返回人間', 'RETURN TO THE MORTAL WORLD'], hellGate: [prog.boss4 ? '查看冥門' : '冥門被封印', 'THE GATE OF THE ABYSS'],
        purify: ['淨化蝕晶', 'PURIFY THE CRYSTAL'], crystalSealed: [`擊退看守的瘴獸 <em>${t.n}</em>`, 'GUARDED BY BEASTS'], kindle: ['點亮燈火', 'KINDLE THE BEACON'],
        story: t.sp && (typeof t.sp.label === 'function' ? t.sp.label() : t.sp.label),
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
  else if (t.kind === 'riseHell') startTrip('riseHell');
  else if (t.kind === 'hellGate') talk('gate');
  else if (t.kind === 'story') runSpot(t.sp);
  else if (t.kind === 'purify') { rescue(t.c); interactTarget = null; $('bInteract').classList.add('hidden'); }
  else if (t.kind === 'kindle') { kindle(t.b); interactTarget = null; $('bInteract').classList.add('hidden'); }
  else if (t.kind === 'ascendLocked') { toast(`<i class="dia"></i>需要 Lv3 才能踏上天梯 · 目前 Lv${P.lv}`); Audio.sfx('ui'); }
  else Audio.sfx('ui');
}
// ---- the stairway of light: temple core ⇄ the Empyrean
let trip = null, tripBeam = null;
function startTrip(up) {
  const T = W.temple;
  const rise = up === 'rise', fromHell = up === 'riseHell';
  const to = fromHell ? EARTH.riftRim.clone() : rise ? new THREE.Vector3(SPAWN.x, 0, SPAWN.z) : up ? REALM.landing.clone() : new THREE.Vector3(T.x, T.floorY, T.z + 10);
  trip = { up: !!up, rise, fromHell, from: P.pos.clone(), to, t: 0, dur: rise || fromHell ? 5.2 : up ? 4.8 : 3.8 };
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
    const up = trip.up, rise = trip.rise, fromHell = trip.fromHell; trip = null;
    state = 'play'; P.glide = false; P.grounded = true; P.vel.set(0, 0, 0);
    tripBeam.visible = false;
    $('hud').classList.remove('cine');
    flashScreen(0.85); CAM.shake = 0.35;
    burst(FX.sparks, P.pos.x, P.pos.y + 0.5, P.pos.z, 60, { speed: 6, up: 3, life: 1.2, size: 1.2, c: [1.8, 1.4, 0.9] });
    featherBurst(P.pos.x, P.pos.y + 1, P.pos.z, 14, 3);
    P.inRealm = up && !rise && !fromHell; P.inEarth = !!fromHell; P.inHell = false; P.safe.copy(P.pos); P.checkpoint.copy(P.pos);
    currentRegion = fromHell ? '墮天裂谷' : rise ? '鏡湖' : up ? '天上神域' : '環光聖所';
    if (fromHell) regionCard('墮天裂谷', 'THE RIFT OF THE FALLEN');
    else if (rise) regionCard('鏡湖', 'THE MIRROR LAKE');
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
  const mem = 'mem' + (n - 1);
  setTimeout(() => { if (state === 'play' && !prog.talk[mem]) talk(mem, () => { if (n === 4) toast('<i class="dia"></i>四座聖壇俱已點亮 · 前往環光聖所', true); }); }, 2300);
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
  if (P.inHell) return hellRegion(x, z);
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
// ---------- quest tracker: one clear story objective (with distance), then this world's tasks, then its feathers
let QS = null, qHtml = '', qDistT = 0, qDistS = '';
const qT = (x, z, kind = 'core') => ({ x, z, kind });
function nearestOpen() {
  let best = null, bd = 1e9;
  for (const c of captives) if (!c.done) { const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z); if (d < bd) { bd = d; best = qT(c.x, c.z, 'shrine'); } }
  for (const b of beacons) if (b.st !== 'lit') { const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z); if (d < bd) { bd = d; best = qT(b.x, b.z, 'shrine'); } }
  return best;
}
function nearestShrine() {
  let best = null, bd = 1e9;
  SHRINES.forEach((s, i) => { if (prog.s[i]) return; const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z); if (d < bd) { bd = d; best = qT(s.x, s.z, 'shrine'); } });
  return best;
}
function questState() {
  const task = (t, done, n = '') => ({ k: 'task', t, done: !!done, n: done ? '' : n });
  const feathersRow = (L) => { const c = fCount(L); return c.all ? { k: 'col', t: '收集光羽', n: `${c.got}/${c.all}`, done: c.got >= c.all } : null; };
  const at = (v, kind = 'core') => () => qT(v.x, v.z, kind);
  // Ophiel and his greatsword are optional, but the colossus will ask for his seal later
  const ophielRow = () => (!prog.boss ? { ...task('挑戰墮翼之丘的守衛', false, '支線'), side: true } : !prog.weapons.greatsword ? { ...task('拔出歐菲爾的大劍', false, '支線'), side: true } : null);
  let ch, en, main, rows = [];
  if (P.inHell) {
    ch = '第三章 · 地獄'; en = 'CHAPTER III';
    if (!prog.boss4) {
      main = { t: '擊倒冥門守衛 · 亞巴頓', tag: holyBlade() ? '' : '極度危險', tgt: at(HELL.bossHome, 'boss') };
      rows.push(task('取得神域之主的武器', prog.hellBlade, '未取得'));
      if (prog.hellBlade) rows.push(task('在聖匣裡換上天樞之劍', prog.weapon === 'tianshu'));
    } else if (!prog.talk.abaddon) main = { t: '聆聽亞巴頓的殘響', tgt: at(HELL.bossHome) };
    else if (!prog.talk.gate) main = { t: '前往冥門', tgt: at(HELL.gate) };
    else main = { t: '冥門依然緊閉 · 待續' };
    rows.push({ k: 'hint', t: '墜落之地的光柱可返回人間' });
  } else if (P.inEarth) {
    ch = '第二章 · 人間'; en = 'CHAPTER II';
    const r = nRescued(), b = nBeacons(), R = captives.length, B = beacons.length, left = r < R || b < B;
    if (left) main = { t: '解救受困的人 · 守住燈火', n: `${r + b}/${R + B}`, tgt: nearestOpen };
    else if (!prog.boss3) main = { t: '挑戰傾城遺跡的墮天騎士', tgt: at(EARTH.bossHome, 'boss') };
    else if (!prog.talk.camael) main = { t: '聆聽墮天騎士的殘響', tgt: at(EARTH.bossHome) };
    else if (!prog.hellBlade && !prog.talk.seals) main = { t: '前往墮天巨像', tgt: at(EARTH.riftRim) };
    else if (!prog.hellBlade && nSeals() < 3) main = { t: '讓巨像的三個紋章亮起', n: `${nSeals()}/3` };
    else if (!prog.hellBlade) main = { t: '回到墮天巨像', tgt: at(EARTH.riftRim) };
    else main = { t: prog.hell ? '再次墜入墮天裂谷' : '墜入墮天裂谷的深處', tgt: at(EARTH.colossus) };
    if (main.t === '讓巨像的三個紋章亮起') {
      rows.push(task('盾 · 墮翼之丘的守衛', prog.boss), task('翼 · 審判之環的審判者', prog.boss2), task('誓 · 傾城遺跡的騎士', prog.boss3));
    } else {
      rows.push(task('解救被蝕晶封住的人', r >= R, `${r}/${R}`), task('守住人們的燈火', b >= B, `${b}/${B}`));
      if (left) rows.push(task('挑戰墮天騎士', prog.boss3, '未挑戰'));
    }
    rows.push(feathersRow('earth'));
  } else if (P.inRealm) {
    ch = '第一章 · 天上神域'; en = 'CHAPTER I';
    if (!prog.boss2) main = { t: '挑戰審判之環的審判者', tgt: at(REALM.bossHome, 'boss') };
    else if (!prog.talk.astraea) main = { t: '聆聽審判者的殘響', tgt: at(REALM.bossHome) };
    else main = { t: prog.earth ? '從天緣躍下，返回人間' : '從天緣躍下，前往人間' };
    rows.push(feathersRow('realm'));
  } else if (!prog.end) {
    ch = '序章 · 光羽降臨'; en = 'PROLOGUE';
    const lit = prog.s.filter(Boolean).length;
    main = lit < 4 ? { t: '點亮四座聖壇', n: `${lit}/4`, tgt: nearestShrine } : { t: '前往環光聖所，觸碰聖核', tgt: () => qT(TEMPLE.x, TEMPLE.z) };
    rows.push(ophielRow(), feathersRow('isle'));
  } else {
    // the isle after the prologue is the hub: the tracker follows the story's next step
    if (!prog.realm || !prog.boss2) {
      ch = '第一章 · 天上神域'; en = 'CHAPTER I';
      main = P.lv < 3 && !prog.realm ? { t: '收集光羽，升到 Lv3', n: `Lv ${P.lv}/3` } : { t: prog.realm ? '經環光聖所的天梯，返回神域' : '回到環光聖所，踏上天梯', tgt: () => qT(TEMPLE.x, TEMPLE.z) };
    } else if (!prog.hell) { ch = '第二章 · 人間'; en = 'CHAPTER II'; main = { t: prog.earth ? '從天緣躍下，返回人間' : '從天緣躍下，前往人間' }; }
    else { ch = '第三章 · 地獄'; en = 'CHAPTER III'; main = { t: '經人間的墮天裂谷，返回地獄' }; }
    if (prog.boss && !prog.weapons.greatsword) main = { t: '拔出歐菲爾的大劍', tgt: () => qT(swordPlanted.position.x, swordPlanted.position.z) };
    else rows.push(ophielRow());
    rows.push(feathersRow('isle'));
  }
  return { ch, en, main, rows: rows.filter(Boolean) };
}
function updateQuest() {
  QS = questState();
  const { ch, en, main, rows } = QS;
  const row = (r) => r.k === 'hint'
    ? `<div class="qrow hint"><i class="up"></i><span>${r.t}</span></div>`
    : `<div class="qrow ${r.k}${r.done ? ' done' : ''}${r.side ? ' side' : ''}"><i class="${r.k === 'col' ? 'fe' : 'box'}"></i><span>${r.t}</span>${r.n ? `<b>${r.n}</b>` : ''}</div>`;
  const meta = main.tag || main.tgt ? `<div class="meta">${main.tag ? `<em class="qtag">${main.tag}</em>` : ''}${main.tgt ? '<em class="qd" id="qDist"></em>' : ''}</div>` : '';
  const html = `<div class="qmain"><i class="qm"></i><span class="t">${main.t}</span>${main.n ? `<b>${main.n}</b>` : ''}${meta}</div>` +
    (rows.length ? `<div class="qlist">${rows.map(row).join('')}</div>` : '');
  $('qTitle').textContent = ch; $('qEn').textContent = en;
  if (html !== qHtml) { qHtml = html; qDistS = ''; $('qObj').innerHTML = html; }
}
let qTick = 0;
function updateQuestDist(dt) {
  if ((qDistT -= dt) > 0) return; qDistT = 0.25;
  if (++qTick % 4 === 0) updateQuest(); // picks up layer changes and counts without every caller remembering to
  const el = $('qDist'); if (!el) return;
  const t = questTarget(); if (!t) { if (qDistS) { el.textContent = ''; qDistS = ''; } return; }
  const d = Math.hypot(t.x - P.pos.x, t.z - P.pos.z);
  const s = d < 8 ? '' : d < 1000 ? `${Math.round(d / 5) * 5}m` : `${(d / 1000).toFixed(1)}km`;
  if (s !== qDistS) { qDistS = s; el.textContent = s; }
}
function pulse(el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
function flashScreen(a) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = a; void f.offsetWidth; f.style.transition = 'opacity 1.1s ease'; f.style.opacity = 0; }

// minimap
let mapBase = null;
function buildMapBase(L) {
  if (L === 2) return buildHellMapBase();
  const N = L ? 640 : 480, EXT = L ? C.EWORLD : 640, HX = EXT / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const G2 = L ? C.grid2 : grid, base = L ? C.EARTH_Y : 0, ga = (x, z) => C.groundAtL(x, z, L) - base, GNn = L ? C.EGN : GN;
  const H = (ix, iz) => G2.h[clamp(iz, 0, GNn - 1) * GNn + clamp(ix, 0, GNn - 1)];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const fx = (px / N) * (GNn - 1), fz = (py / N) * (GNn - 1);
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const wx = -HX + (px / N) * EXT, wz = -HX + (py / N) * EXT;
      const h = ga(wx, wz);
      const i = (py * N + px) * 4;
      if (L && inRift(wx, wz, 2) && h < -2) { const d = smooth(-2, -60, h); img.data[i] = lerp(120, 70, d); img.data[i + 1] = lerp(84, 30, d); img.data[i + 2] = lerp(74, 26, d); img.data[i + 3] = 255; continue; }
      if (L && h < 0.05) { const d = smooth(0.05, -10, h); img.data[i] = lerp(214, 176, d); img.data[i + 1] = lerp(224, 198, d); img.data[i + 2] = lerp(226, 212, d); img.data[i + 3] = 255; continue; }
      if (h < -6) { img.data[i + 3] = 0; continue; }
      const sx = H(ix + 1, iz) - H(ix - 1, iz), sz = H(ix, iz + 1) - H(ix, iz - 1);
      const shade = clamp(1 + (-sx * 0.6 - sz * 0.6) * 0.05, 0.82, 1.1);
      let r, gg, b;
      if (h < 0.05 && (L || Math.hypot(wx - LAKE.x, wz - LAKE.z) < LAKE.r * 1.3)) { const d = smooth(0.05, -2, h); r = lerp(214, 186, d); gg = lerp(224, 203, d); b = lerp(226, 214, d); }
      else { const t = clamp(h / (L ? 90 : 36), 0, 1); r = lerp(240, 214, t) * shade; gg = lerp(235, 204, t) * shade; b = lerp(222, 184, t) * shade; }
      const step = EXT / N;
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
function buildMinimapBase() { mapBase = buildMapBase(0); mapBase2 = buildMapBase(1); mapBase3 = buildMapBase(2); }
let mapBase3 = null;
function buildHellMapBase() {
  // hell on the map: charred parchment, fire where the floor gives way
  const N = 360, EXT = C.HWORLD, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), img = g.createImageData(N, N), ga = (x, z) => C.groundAtL(x, z, 2) - C.HELL_Y, step = EXT / N;
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const wx = C.HCX - EXT / 2 + px * step, wz = C.HCZ - EXT / 2 + py * step, h = ga(wx, wz), i = (py * N + px) * 4;
    let r, gg, b;
    if (h < -0.6) { const k = smooth(-0.6, -6, h); r = lerp(214, 240, k); gg = lerp(110, 140, k); b = lerp(70, 60, k); }
    else { const t = clamp(h / 70, 0, 1), sx = ga(wx + step, wz) - h, sz = ga(wx, wz + step) - h, sh = clamp(1 + (-sx - sz) * 0.04, 0.8, 1.12); r = lerp(92, 52, t) * sh; gg = lerp(78, 44, t) * sh; b = lerp(74, 46, t) * sh; }
    const c0 = Math.floor(h / 4), c1 = Math.floor(ga(wx + step, wz) / 4), c2 = Math.floor(ga(wx, wz + step) / 4);
    if (h > 0.5 && (c0 !== c1 || c0 !== c2)) { r = lerp(r, 170, 0.35); gg = lerp(gg, 120, 0.35); b = lerp(b, 90, 0.35); }
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function layoutMinimap() {
  const cv = $('mmc'); if (!cv) return;
  const s = cv.clientWidth || 132, pr = Math.min(3, (devicePixelRatio || 1) * (VIEW.s || 1));
  cv.width = s * pr; cv.height = s * pr;
  hud.mmPR = pr; hud.mmS = s;
}
function drawDiamond(g, x, y, r, fill, stroke) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.75, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.75, y); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.4; g.stroke(); } }
function questTarget() {
  if (!QS) QS = questState();
  return QS.main.tgt ? QS.main.tgt() : null;
}
function drawRealmBase(g, toS, s, size, labels) {
  g.fillStyle = '#e4dfd3'; g.fillRect(0, 0, size, size);
  const shape = (q, grow) => { g.beginPath(); for (let i = 0; i <= 28; i++) { const th = (i / 28) * Math.PI * 2, r = q.rf(th) * grow, [x, y] = toS(q.x + Math.cos(th) * r, q.z + Math.sin(th) * r); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  g.fillStyle = '#b9a477'; for (const q of REALM.blobs) { shape(q, 1.08); g.fill(); }
  g.fillStyle = '#f7f3e8'; for (const q of REALM.blobs) { shape(q, 1.0); g.fill(); }
  g.fillStyle = 'rgba(150,170,110,0.28)'; for (const q of REALM.blobs) if (!q.small) { shape(q, 0.62); g.fill(); }
  if (labels) for (const I of REALM.isles) { const [x, y] = toS(I.x, I.z); g.fillStyle = '#7d6232'; g.font = `500 ${Math.round(Math.max(11, size / 46))}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.fillText(tr(I.name), x, y + I.r * s + 12); }
}
function drawEarthPOI(g, toS, s, size) {
  const u = size / 140;
  // the colossus over the rift
  { const [x, y] = toS(EARTH.colossus.x, EARTH.colossus.z); g.strokeStyle = 'rgba(150,50,36,0.9)'; g.lineWidth = 1.4 * u; g.beginPath(); g.arc(x, y, 6 * u, 0, 6.3); g.stroke(); g.beginPath(); g.arc(x, y, 3 * u, 0, 6.3); g.fillStyle = '#5a2620'; g.fill(); }
  for (const c of captives) { const [x, y] = toS(c.x, c.z); g.save(); g.translate(x, y); g.fillStyle = c.done ? '#f0d48a' : '#3a2a40'; g.strokeStyle = c.done ? '#9b7a3c' : '#e07a5a'; g.lineWidth = 1 * u; g.beginPath(); g.moveTo(0, -4 * u); g.lineTo(2.6 * u, 0); g.lineTo(0, 4 * u); g.lineTo(-2.6 * u, 0); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  for (const b of beacons) { const [x, y] = toS(b.x, b.z); g.fillStyle = b.st === 'lit' ? '#f2c76a' : '#fbf7ee'; g.strokeStyle = '#9b7a3c'; g.lineWidth = 1.1 * u; g.beginPath(); g.moveTo(x, y - 4.6 * u); g.quadraticCurveTo(x + 3.4 * u, y, x, y + 3 * u); g.quadraticCurveTo(x - 3.4 * u, y, x, y - 4.6 * u); g.fill(); g.stroke(); }
}
function drawMap(g, size, cx, cz, range, round) {
  const s = (size / 2) / range;
  const toS = (x, z) => [size / 2 + (x - cx) * s, size / 2 + (z - cz) * s];
  g.save();
  g.clearRect(0, 0, size, size);
  if (round) { g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip(); }
  if (round) { g.fillStyle = '#dcd7cd'; g.fillRect(0, 0, size, size); }
  const sky = P.inRealm, earth = P.inEarth, hell = P.inHell, cl = sky ? 's' : hell ? 'h' : earth ? 'e' : 'i';
  if (sky) drawRealmBase(g, toS, s, size, !round);
  else if (hell) {
    const [ox, oy] = toS(C.HCX - C.HHALF, C.HCZ - C.HHALF); g.drawImage(mapBase3, ox, oy, C.HWORLD * s, C.HWORLD * s);
    const u = size / 140;
    { const [x, y] = toS(HELL.gate.x, HELL.gate.z - 10); g.fillStyle = '#1a1214'; g.strokeStyle = '#ff7a4a'; g.lineWidth = 1.3 * u; g.fillRect(x - 6 * u, y - 7 * u, 12 * u, 9 * u); g.strokeRect(x - 6 * u, y - 7 * u, 12 * u, 9 * u); }
    if (!round) for (const m of HELL.marks) { const [x, y] = toS(m.x, m.z); g.fillStyle = '#f3dccb'; g.font = `500 ${Math.round(Math.max(11, size / 46))}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.fillText(tr(m.name), x, y + 18 * u); }
  }
  else if (earth) { const [ox, oy] = toS(-C.EHALF, -C.EHALF); g.drawImage(mapBase2, ox, oy, C.EWORLD * s, C.EWORLD * s); drawEarthPOI(g, toS, s, size); for (const m of EARTH.marks) { const [x, y] = toS(m.x, m.z); g.strokeStyle = 'rgba(155,122,60,0.75)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, Math.max(4, m.r * s * 0.3), 0, 6.3); g.stroke(); if (!round) { g.fillStyle = '#7d6232'; g.font = `500 ${Math.round(Math.max(11, size / 46))}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.fillText(tr(m.name), x, y + Math.max(4, m.r * s * 0.3) + 13); } } }
  else { const [ox, oy] = toS(-320, -320); g.drawImage(mapBase, ox, oy, 640 * s, 640 * s); }
  const u = size / 140;
  // updrafts
  for (const d of W.updrafts) { if ((d.realm ? 's' : d.earth ? 'e' : 'i') !== cl) continue; const [x, y] = toS(d.x, d.z); g.strokeStyle = 'rgba(176,140,70,0.9)'; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(x, y, 3.2 * u, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y + 2 * u); g.lineTo(x, y - 2.5 * u); g.lineTo(x - 1.5 * u, y - 1 * u); g.moveTo(x, y - 2.5 * u); g.lineTo(x + 1.5 * u, y - 1 * u); g.stroke(); }
  // landmarks
  if (cl === 'i') for (const L of LANDMARKS) { const [x, y] = toS(L.x, L.z); g.fillStyle = 'rgba(250,246,236,0.95)'; g.strokeStyle = '#9b7a3c'; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(x, y, 3.6 * u, 0, 6.3); g.fill(); g.stroke(); g.beginPath(); g.arc(x, y, 5.4 * u, 0, 6.3); g.stroke(); g.fillStyle = '#c29a4c'; g.beginPath(); g.arc(x, y, 1.4 * u, 0, 6.3); g.fill(); }
  // feathers
  for (const f of feathers) { if (f.taken || !f.seen) continue; f.grp.getWorldPosition(_v); if ((_v.y > 200 ? 's' : _v.y < -1200 ? 'h' : _v.y < -350 ? 'e' : 'i') !== cl) continue; const [x, y] = toS(_v.x, _v.z); g.fillStyle = 'rgba(255,253,245,0.95)'; g.strokeStyle = 'rgba(184,146,74,0.9)'; g.lineWidth = 1 * u; g.beginPath(); g.arc(x, y, 1.9 * u, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // shades
  for (const sh of shades) { if (sh.dead || (sh.realm ? 's' : sh.hell ? 'h' : sh.earth ? 'e' : 'i') !== cl || Math.hypot(sh.pos.x - P.pos.x, sh.pos.z - P.pos.z) > 75) continue; const [x, y] = toS(sh.pos.x, sh.pos.z); g.fillStyle = 'rgba(40,34,48,0.9)'; g.beginPath(); g.arc(x, y, 2.2 * u, 0, Math.PI * 2); g.fill(); }
  // shrines
  if (cl === 'i') W.shrines.forEach((sh) => { const [x, y] = toS(sh.def.x, sh.def.z); drawDiamond(g, x, y, 5 * u, sh.lit ? '#e8c776' : 'rgba(250,247,240,0.95)', '#9b7a3c'); if (sh.lit) { g.fillStyle = '#fff8e6'; g.beginPath(); g.arc(x, y, 1.3 * u, 0, 6.3); g.fill(); } });
  // temple star
  if (cl === 'i') { const [x, y] = toS(TEMPLE.x, TEMPLE.z); g.fillStyle = prog.end ? '#f0cf7e' : '#fbf7ee'; g.strokeStyle = '#9b7a3c'; g.lineWidth = 1.2 * u; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 2.6 : 6.4) * u; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }
  // boss
  { const bk = sky ? 'boss2' : hell ? 'boss4' : earth ? 'boss3' : 'boss', bh = sky ? REALM.bossHome : hell ? HELL.bossHome : earth ? EARTH.bossHome : BOSS_HOME; const [x, y] = toS(bh.x, bh.z); g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = prog[bk] ? '#efe9dc' : '#2a2230'; g.strokeStyle = prog[bk] ? '#9b7a3c' : '#e3b866'; g.lineWidth = 1.4 * u; g.fillRect(-4 * u, -4 * u, 8 * u, 8 * u); g.strokeRect(-4 * u, -4 * u, 8 * u, 8 * u); g.restore(); if (!prog[bk]) { g.fillStyle = '#e3b866'; g.beginPath(); g.arc(x, y, 1.4 * u, 0, 6.3); g.fill(); } }
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
  if (P.inRealm) drawMap(g, size, REALM.x, REALM.z - 42, 150, false); else if (P.inHell) drawMap(g, size, C.HCX, C.HCZ - 55, 200, false); else if (P.inEarth) drawMap(g, size, 40, -10, 590, false); else drawMap(g, size, 0, -4, 248, false);
  const lit = prog.s.filter(Boolean).length;
  $('mapList').innerHTML = SHRINES.map((s, i) => `<li class="${prog.s[i] ? 'lit' : ''}"><i class="dia"></i><span>${s.name}</span><em>${prog.s[i] ? '已點亮' : shadesAlive(i) ? '封印中' : '待點亮'}</em></li>`).join('') +
    `<li class="${prog.end ? 'lit' : ''}"><i class="star">✦</i><span>環光聖所</span><em>${prog.end ? '已甦醒' : lit === 4 ? '可進入' : `${lit}/4`}</em></li>` +
    `<li><i class="dot"></i><span>光羽</span><em>${prog.f.length}/${feathers.length}</em></li>` +
    `<li class="${prog.boss ? 'lit' : ''}"><i class="dia"></i><span>墮光守衛</span><em>${prog.boss ? '已淨化' : '未挑戰'}</em></li>` +
    (prog.earth ? `<li class="${prog.boss3 ? 'lit' : ''}"><i class="dia"></i><span>墮天騎士</span><em>${prog.boss3 ? '已淨化' : '未挑戰'}</em></li>` : '') +
    (prog.realm ? `<li class="${prog.boss2 ? 'lit' : ''}"><i class="dia"></i><span>審判者</span><em>${prog.boss2 ? '已淨化' : '未挑戰'}</em></li>` : '');
  if (P.inEarth) {
    const lit = beacons.filter((b) => b.st === 'lit').length;
    $('mapList').innerHTML = `<li class="${nRescued() === captives.length ? 'lit' : ''}"><i class="dia"></i><span>被困的人</span><em>${nRescued()}/${captives.length} 已救出</em></li>` +
      beacons.map((b) => `<li class="${b.st === 'lit' ? 'lit' : ''}"><i class="dia"></i><span>${b.name}</span><em>${b.st === 'lit' ? '燈火長明' : b.st === 'won' ? '可點燈' : '待守護'}</em></li>`).join('') +
      `<li class="${prog.boss3 ? 'lit' : ''}"><i class="dia"></i><span>墮天騎士</span><em>${prog.boss3 ? '已淨化' : '未挑戰'}</em></li>` +
      `<li><i class="star">✦</i><span>墮天巨像</span><em>封印中</em></li>` +
      `<li><i class="dot"></i><span>晨鐘堡居民</span><em>${4 + nRescued()} 人 · 燈 ${Math.min(EARTH.lamps.n, lampsLit())}</em></li>`;
    void lit;
  }
  if (P.inHell) $('mapList').innerHTML = `<li class="${prog.boss4 ? 'lit' : ''}"><i class="dia"></i><span>冥門守衛</span><em>${prog.boss4 ? '已淨化' : '極度危險'}</em></li><li><i class="star">✦</i><span>冥門</span><em>封印中</em></li><li><i class="dot"></i><span>墜落之地</span><em>光柱 · 返回人間</em></li>`;
  $('mapTitle').innerHTML = P.inHell ? '地獄<small>THE ABYSS</small>' : P.inEarth ? '人間地圖<small>THE MORTAL WORLD</small>' : P.inRealm ? '天上神域<small>THE EMPYREAN</small>' : '聖域地圖<small>THE REALM</small>';
  $('mapHint').textContent = `已發現的光羽會標示在地圖上 · ${feathers.filter((f) => f.seen && !f.taken).length} 根待拾取`;
  Audio.sfx('ui');
}
function closeOverlays() {
  for (const id of ['mapOv', 'setOv', 'howOv', 'codexOv', 'testOv', 'bagOv']) $(id).classList.add('hidden');
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
    if (DLG) { if (['KeyE', 'KeyF', 'Space', 'Enter', 'KeyJ', 'NumpadEnter'].includes(k)) { e.preventDefault(); dlgNext(); } return; }
    if (k === 'KeyI' && state === 'play') { if (!$('bagOv').classList.contains('hidden')) closeOverlays(); else openBag(); return; }
    if (k === 'F2' || k === 'Backquote') { e.preventDefault(); if (!$('testOv').classList.contains('hidden')) closeOverlays(); else openTest(); return; }
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
  $('codexList').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li || li.dataset.i === undefined) return; codexSel = +li.dataset.i; renderCodex(); Audio.sfx('ui'); });
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
  // on a phone held sideways the full list would sit over the move stick, so it starts folded (tap the title to open)
  if (settings.qMin === undefined) settings.qMin = isTouch && innerHeight < 500;
  $('quest').classList.toggle('min', !!settings.qMin);
  $('qHead').addEventListener('click', (e) => { e.stopPropagation(); settings.qMin = !settings.qMin; store.set('lumenfall_settings', settings); $('quest').classList.toggle('min', settings.qMin); Audio.sfx('ui'); });
  initTestMode();
  initBag();
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
// ------------------------------------------------------------------ story: dialogue, clues, story spots
// The marker says where to go; when you get there, a voice, an echo or an inscription tells you what to do.
const STORY = {
  intro: { who: ['遙遠的聲音', 'A DISTANT VOICE'], lines: ['你醒了。', '這片大地太暗了——點亮四座聖壇。'] },
  mem0: { who: ['光的記憶', 'A MEMORY OF LIGHT'], lines: ['……一位手持大劍的守衛，擋在聖所的門前。', '他身後的光，一天比一天微弱。'], clue: ['光的記憶 · 一', '一位手持大劍的守衛，擋在聖所的門前。他身後的光，一天比一天微弱。'] },
  mem1: { who: ['光的記憶', 'A MEMORY OF LIGHT'], lines: ['影子從四面八方湧來。', '守衛一步也沒有退。'], clue: ['光的記憶 · 二', '影子從四面八方湧來，守衛一步也沒有退。'] },
  mem2: { who: ['光的記憶', 'A MEMORY OF LIGHT'], lines: ['「搖籃不能熄。」', '他把自己的光，按進了聖核。'], clue: ['光的記憶 · 三', '「搖籃不能熄。」他把自己的光，按進了聖核。'] },
  mem3: { who: ['光的記憶', 'A MEMORY OF LIGHT'], lines: ['光一點一點回到聖核……', '守衛的劍，卻再也沒有舉起來。', '——去環光聖所吧。'], clue: ['光的記憶 · 四', '光回到了聖核，守衛的劍卻再也沒有舉起來。他後來去了哪裡？'] },
  stele: { who: ['環光聖所 · 石刻', 'THE SANCTUM'], lines: ['石刻：「天梯為攜三重光者而開。」', '（三重光……也許是指光羽的力量。）'], clue: ['天梯的石刻', '「天梯為攜三重光者而開。」——收集光羽，升到 Lv3。'] },
  cradle: { who: ['環光聖所 · 聖核', 'THE SACRED CORE'], lines: ['聖核的中心是空的，只留下一個人形的凹痕。', '……你就是從這裡出生的。', '這裡曾經是新天使誕生的搖籃。你是最後一個。'], clue: ['空的搖籃', '聖核的中心是空的，只留下一個人形的凹痕。你是搖籃裡最後一個天使。'] },
  ophiel: { who: ['歐菲爾的殘響', 'ECHO OF OPHIEL'], lines: ['……你身上，有我的光。', '這把劍已經守不住任何東西了。', '帶走它，去守你要守的。'], clue: ['墮光守衛的大劍', '歐菲爾把自己的光給了搖籃。他的大劍，留給了從搖籃出生的你。'] },
  throne: { who: ['穹頂聖庭 · 空玉座', 'THE EMPTY THRONE'], lines: ['玉座上只有灰塵。', '扶手上刻著一行字：「吾在下方。」'], clue: ['空玉座', '神域之主的玉座是空的。扶手上刻著：「吾在下方。」'] },
  vault: { who: ['星淵寶庫 · 刻文', 'THE STARDEEP VAULT'], lines: ['審判衛士盾背上被刮掉的那一行，在這裡完整地刻著——', '「封印以光為食。」'], clue: ['被刮掉的那一行', '「封印以光為食。」——刻在星淵寶庫，也曾刻在每一面審判衛士的盾背上。'] },
  astraea: { who: ['阿斯特萊亞的殘響', 'ECHO OF ASTRAEA'], lines: ['我判了祂有罪。', '然後，判了我自己。', '祂不在這裡。去下面找祂——在那道裂縫的上方。'], clue: ['審判者最後的判決', '阿斯特萊亞判了神域之主有罪，然後判了自己。「去下面找祂——在那道裂縫的上方。」'] },
  camael: { who: ['卡麥爾的殘響', 'ECHO OF CAMAEL'], lines: ['我守的城，建在鎖鏈上。', '那心跳……不是我的。', '別讓祂一個人跪著。'], clue: ['騎士長的遺言', '「我守的城，建在鎖鏈上。那心跳不是我的。別讓祂一個人跪著。」'] },
  seals: { who: ['墮天巨像', 'THE FALLEN COLOSSUS'], lines: () => ['巨像雙手握著一把劍，劍柄上有三個紋章：盾、翼、誓。', ...SEALS.filter((q) => !prog[q.key]).map((q) => q.dark), SEALS.every((q) => prog[q.key]) ? '三個紋章都在發光。' : '也許要讓三個紋章都亮起來。'], clue: ['巨像的三個紋章', '巨像手中的劍柄上有三個紋章：盾、翼、誓。分別由墮翼之丘的守衛、天上的審判者、傾城遺跡的騎士守著。'] },
  colossus: { who: ['神域之主', 'THE LORD OF THE EMPYREAN'], lines: ['（盾、翼、誓——三個紋章逐一亮起。）', '……你終於來了。', '門後面，是一切瘴氣的源頭。', '拿我的劍去。打開它，結束這一切。', '（巨像的手鬆開了。一把劍落在你面前。）'], clue: ['天樞之劍', '神域之主交給你的劍。「天樞」——天的樞紐。只有它能真正傷及地獄之物。'] },
  colossusAfter: { who: ['墮天巨像', 'THE FALLEN COLOSSUS'], lines: ['巨像一動也不動。', '胸口多了一道細細的裂縫，正微微發光。', '「……不要回頭。」'] },
  abaddon: { who: ['亞巴頓的殘響', 'ECHO OF ABADDON'], lines: ['天樞……祂終於把它交出來了。', '你知道打開這扇門，會發生什麼嗎？', '……不，你不知道。祂沒有告訴你。', '去吧。我守了一千年，就是在等一個敢打開它的人。'], clue: ['守門者的話', '「你知道打開這扇門會發生什麼嗎？……祂沒有告訴你。」'] },
  gate: { who: ['冥門', 'THE ABYSSAL GATE'], lines: () => (prog.boss4 ? ['門上的鎖孔，正好是一把劍的形狀。', '——第一部 · 完。', '第二部「人間煉獄」製作中。'] : ['冥門紋絲不動。門後傳來低沉的心跳……', prog.hellBlade ? '門前的守衛還在。' : '凡光打不開它。需要神域之主的武器。']) },
};
const SEALS = [
  { key: 'boss', g: '盾', dark: '「盾」是暗的。墮翼之丘的守衛，也許還守著它。' },
  { key: 'boss2', g: '翼', dark: '「翼」是暗的。天上的審判者，也許還握著它。' },
  { key: 'boss3', g: '誓', dark: '「誓」是暗的。傾城遺跡的騎士，還沒有安息。' },
];
const nSeals = () => SEALS.filter((q) => prog[q.key]).length;
// ---- the dialogue box
let DLG = null;
function talk(id, done) {
  const S = STORY[id]; if (!S) { done && done(); return; }
  const lines = (typeof S.lines === 'function' ? S.lines() : S.lines).filter(Boolean).map((l) => tr(l));
  DLG = { id, lines, i: 0, n: 0, done, t0: performance.now() };
  if (state === 'play') paused = true;
  freeMouse(); interactTarget = null; $('bInteract').classList.add('hidden');
  $('dlgWho').textContent = tr(S.who[0]); $('dlgEn').textContent = S.who[1];
  $('dlg').classList.remove('hidden'); $('hud').classList.add('cine');
  dlgShow(); Audio.sfx('ui');
}
function dlgShow() { const D = DLG; D.n = 0; D.lineT = performance.now(); $('dlgText').textContent = ''; $('dlg').classList.remove('full'); }
function dlgTick() {
  const D = DLG; if (!D) return;
  const L = D.lines[D.i], n = Math.min(L.length, Math.floor((performance.now() - D.lineT) / 34));
  if (n !== D.n) { D.n = n; $('dlgText').textContent = L.slice(0, n); }
  if (n >= L.length) $('dlg').classList.add('full');
}
function dlgNext() {
  const D = DLG; if (!D || performance.now() - D.t0 < 250) return;
  const L = D.lines[D.i];
  if (D.n < L.length) { D.lineT = -1e9; dlgTick(); return; } // first tap finishes the line
  if (++D.i < D.lines.length) { dlgShow(); Audio.sfx('ui'); return; }
  dlgClose();
}
function dlgClose() {
  const D = DLG; if (!D) return; DLG = null;
  $('dlg').classList.add('hidden'); $('hud').classList.remove('cine');
  if (state === 'play') paused = false;
  const S = STORY[D.id];
  if (!prog.talk[D.id]) { prog.talk[D.id] = true; if (S.clue && !prog.clues[D.id]) { prog.clues[D.id] = Date.now(); setTimeout(() => toast('<i class="dia"></i>新的線索 · 已收進聖匣', false), 300); } save(); }
  updateQuest();
  if (D.done) D.done();
}
// ---- places that speak: steles, echoes of the purified, the colossus
const STORY_SPOTS = [];
let swordPlanted = null;
function buildStory() {
  const marble = new THREE.MeshStandardMaterial({ color: '#efe9de', map: TEX.marble, roughness: 0.55 });
  const runeM = new THREE.MeshBasicMaterial({ map: TEX.rune, color: new THREE.Color(1.8, 1.4, 0.7), transparent: true, depthWrite: false });
  const stele = (x, z, y, yaw, parent = scene) => {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 0.34), marble); slab.position.y = 1.15; slab.castShadow = slab.receiveShadow = true; g.add(slab);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.22, 0.5), marble); cap.position.y = 2.38; g.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 0.7), marble); base.position.y = 0.12; g.add(base);
    const rn = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), runeM); rn.position.set(0, 1.45, 0.18); g.add(rn);
    g.position.set(x, y, z); g.rotation.y = yaw; parent.add(g); return g;
  };
  const isle = (id) => REALM.isles.find((i) => i.id === id);
  const T = W.temple, court = isle('court'), vault = isle('vault');
  // the sanctum: a stele by the door, readable before and after the core wakes
  { const x = T.x + 7, z = T.z + 15; stele(x, z, Math.max(0, groundAt(x, z)), Math.PI); STORY_SPOTS.push({ L: 'isle', x, z, y: () => Math.max(0, groundAt(x, z)), r: 4.2, key: () => (prog.end ? 'cradle' : 'stele'), label: ['閱讀石刻', 'READ THE INSCRIPTION'] }); }
  // the empty throne and the vault's inscription, up in the Empyrean
  if (court) { const x = court.x + 6, z = court.z - 8; stele(x, z, court.top, 0); STORY_SPOTS.push({ L: 'realm', x, z, y: () => court.top, r: 4.5, key: () => 'throne', label: ['查看空玉座', 'THE EMPTY THRONE'] }); }
  if (vault) { const x = vault.x, z = vault.z; stele(x, z, vault.top, Math.PI / 4); STORY_SPOTS.push({ L: 'realm', x, z, y: () => vault.top, r: 4.5, key: () => 'vault', label: ['閱讀刻文', 'READ THE INSCRIPTION'] }); }
  // echoes of the purified, at their statues
  const echo = (L, home, key, flag) => STORY_SPOTS.push({ L, x: home.x, z: home.z, y: () => home.y, r: 8, show: () => prog[flag], key: () => key, label: ['聆聽殘響', 'LISTEN TO THE ECHO'] });
  echo('realm', REALM.bossHome, 'astraea', 'boss2');
  echo('earth', EARTH.bossHome, 'camael', 'boss3');
  echo('hell', HELL.bossHome, 'abaddon', 'boss4');
  // Ophiel's greatsword, planted before his statue once he rests
  {
    const keep = hero.tipLocal, gsw = hero.buildGreatsword(); hero.tipLocal = keep;
    const dx = -BOSS_HOME.x, dz = -BOSS_HOME.z, dl = Math.hypot(dx, dz), x = BOSS_HOME.x + (dx / dl) * 4.2, z = BOSS_HOME.z + (dz / dl) * 4.2, gy = Math.max(0, groundAt(x, z));
    const g = new THREE.Group(); gsw.scale.multiplyScalar(2.1); gsw.rotation.set(Math.PI / 2 - 0.08, 0, 0.12); g.add(gsw);
    g.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(gsw); g.position.set(x, gy - bb.min.y - 0.45, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(1.6, 1.15, 0.55), transparent: true, opacity: 0.7, depthWrite: false })); glow.scale.setScalar(4); glow.position.y = (bb.max.y - bb.min.y) * 0.75; g.add(glow);
    scene.add(g); g.visible = false; swordPlanted = g;
    STORY_SPOTS.push({ L: 'isle', x, z, y: () => gy, r: 4, show: () => prog.boss && !prog.weapons.greatsword, key: () => 'ophiel', label: ['拔出墮光大劍', 'DRAW THE GREATSWORD'], run: drawGreatsword, always: true });
  }
  // the colossus over the rift
  { const R = EARTH.riftRim; STORY_SPOTS.push({ L: 'earth', x: R.x, z: R.z, y: () => R.y, r: 9, key: () => (prog.hellBlade ? 'colossusAfter' : nSeals() === 3 ? 'colossus' : 'seals'), label: () => (prog.hellBlade ? ['仰望巨像', 'THE FALLEN COLOSSUS'] : ['觸碰巨像的劍', "TOUCH THE COLOSSUS' SWORD"]), run: touchColossus, always: true }); }
  // a soft gold mark over every place that still has something to say
  const mk = new THREE.SpriteMaterial({ map: TEX.spark, color: new THREE.Color(2.4, 1.8, 0.9), transparent: true, depthWrite: false, depthTest: true });
  for (const sp of STORY_SPOTS) { sp.mark = new THREE.Sprite(mk); sp.mark.scale.setScalar(1.6); noReflect(sp.mark); (sp.L === 'earth' ? EARTH.root : sp.L === 'hell' ? HELL.root : scene).add(sp.mark); }
}
const spotLayer = (L) => (L === 'hell' ? 2 : L === 'earth' ? 1 : 0);
const spotOn = (sp) => (!sp.show || sp.show()) && spotLayer(sp.L) === C.LAYER.cur && (sp.L !== 'realm' || P.inRealm) && (sp.L !== 'isle' || !P.inRealm);
function updateStory() {
  if (swordPlanted) swordPlanted.visible = !!prog.boss && !prog.weapons.greatsword;
  for (const sp of STORY_SPOTS) {
    const fresh = spotOn(sp) && (!prog.talk[sp.key()] || (sp.key() === 'colossus' && !prog.hellBlade));
    sp.mark.visible = fresh;
    if (fresh) { sp.mark.position.set(sp.x, sp.y() + 3.6 + Math.sin(time * 2 + sp.x) * 0.25, sp.z); sp.mark.material.opacity = 0.75 + Math.sin(time * 3) * 0.25; }
  }
  if (DLG) dlgTick();
}
function storyTarget() {
  for (const sp of STORY_SPOTS) {
    if (!spotOn(sp)) continue;
    if (Math.hypot(P.pos.x - sp.x, P.pos.z - sp.z) < sp.r && Math.abs(P.pos.y - sp.y()) < 6) return { kind: 'story', sp, k: sp.key() };
  }
  return null;
}
function runSpot(sp) { if (sp.run) sp.run(); else talk(sp.key()); }
function drawGreatsword() {
  talk('ophiel', () => {
    prog.weapons.greatsword = true; save();
    burst(FX.sparks, swordPlanted.position.x, swordPlanted.position.y + 2, swordPlanted.position.z, 90, { speed: 7, up: 4, life: 1.2, size: 1.2, c: [2.4, 1.4, 0.5] });
    flashScreen(0.5); CAM.shake = Math.max(CAM.shake, 0.3);
    showWeapon('greatsword');
    setTimeout(() => toast('<i class="dia"></i>打開聖匣，可以換上墮光大劍', true), 2600);
    updateQuest();
  });
}
function touchColossus() {
  if (prog.hellBlade) { talk('colossusAfter'); return; }
  if (nSeals() < 3) { prog.talk.colossus = false; talk('seals'); return; }
  talk('colossus', () => {
    prog.hellBlade = true; prog.weapons.tianshu = true; save();
    const s = EARTH.colossus.sword;
    flashScreen(1); CAM.shake = Math.max(CAM.shake, 0.9); Audio.sfx('roar');
    burst(FX.sparks, P.pos.x, P.pos.y + 2, P.pos.z, 120, { speed: 9, up: 5, life: 1.4, size: 1.3, c: [1.5, 1.9, 2.7] });
    if (s) burst(FX.sparks, s.x, s.y, s.z, 160, { speed: 14, up: 4, life: 1.8, size: 2, c: [2.2, 2.3, 2.6] });
    equipWeapon('tianshu');
    showWeapon('tianshu');
    setTimeout(() => talk('colossusAfter'), 6800);
  });
}
function showWeapon(w) {
  const I = WEAPON_INFO[w];
  $('lvK').textContent = 'NEW WEAPON'; $('lvSmall').textContent = 'WEAPON'; $('lvNum').textContent = I.glyph; $('lvFromRow').style.display = 'none';
  $('lvT').textContent = I.name; $('lvStats').innerHTML = `<li class="en" style="--d:.9s">${I.en}</li>`;
  $('lvPerk').textContent = I.short; $('lvPerk').classList.remove('hidden');
  const el = $('lvUp'); el.classList.remove('hidden', 'on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(lvUpT); lvUpT = setTimeout(() => el.classList.add('hidden'), window.__lvHold || 6200);
  Audio.sfx('lvup'); featherBurst(P.pos.x, P.pos.y + 1.2, P.pos.z, 20, 4);
}

// ------------------------------------------------------------------ the reliquary (聖匣): the small light-casket the seraph carries
const WEAPON_INFO = {
  spear: { glyph: '槍', name: '聖槍', en: 'THE HOLY LANCE', stats: [3, 3, 3], how: '醒來時就握在手中',
    moves: '突刺 · 突刺 · 旋身橫掃 · 衝刺突擊', short: '刺擊快、距離長',
    desc: '你醒來時就握在手中的槍。兩下快速突刺，距離最長；第三擊旋身橫掃，可以應付圍攻。' },
  greatsword: { glyph: '劍', name: '墮光大劍', en: "OPHIEL'S GREATSWORD", stats: [5, 1, 4], how: '墮翼之丘 · 歐菲爾的石像前',
    moves: '斜劈 · 回劈 · 迴旋斬 · 砸地', short: '雙手重劈 · 第四擊砸向地面',
    desc: '歐菲爾守護搖籃時用的大劍。出手慢，但每一下都很重；第四擊和蓄力重擊會砸向地面，震傷周圍所有敵人，也能擊破守衛的盾。' },
  tianshu: { glyph: '樞', name: '天樞之劍', en: 'TIANSHU · PIVOT OF HEAVEN', stats: [4, 4, 3], how: '墮天巨像 · 集齊盾、翼、誓三道紋章',
    moves: '斬擊 · 斬擊 · 迴旋斬 · 突擊', short: '唯一能真正傷及地獄之物',
    desc: '神域之主交給你的劍。「天樞」——天的樞紐。只有它能真正傷及地獄之物；在地獄裡不拿著它，敵人幾乎打不動，你也會受到三倍傷害。' },
};
const POWER_HOW = { shield: '墮翼之丘 · 墮光守衛', wings: '審判之環 · 審判者', oath: '傾城遺跡 · 墮天騎士' };
const POWER_GIFT = { shield: '光之結晶 · 生命上限 +25', wings: '審判之羽 · 生命上限 +25 · 聖瓶 +1', oath: '騎士之誓 · 生命上限 +25 · 攻擊 +10%' };
const BAG = { tab: 'weapons', sel: 0 };
const ICON = {
  spear: '<path d="M18 102 92 28"/><path d="M92 28c4-10 12-16 18-18c-2 6-8 14-18 18z" class="f"/><circle cx="84" cy="36" r="5"/><path d="M26 94l-6-6"/>',
  greatsword: '<path d="M30 90 96 24l4 14-52 52z" class="f"/><path d="M96 24l8-4-4 8"/><path d="M26 74l20 20"/><path d="M18 102l14-14"/>',
  tianshu: '<path d="M26 94 94 26l3 6-65 65z" class="f"/><path d="M94 26l9-5-5 9"/><path d="M24 80c6 0 12 6 12 12M40 72c-6 0-12-6-12-12"/><path d="M16 104l10-10"/><circle cx="16" cy="104" r="3"/>',
  feather: '<path d="M30 98C40 60 64 32 98 22c-4 30-26 60-62 70z" class="f"/><path d="M30 98 86 38"/>',
  person: '<circle cx="60" cy="34" r="12"/><path d="M38 100c0-26 10-42 22-42s22 16 22 42z" class="f"/>',
  flame: '<path d="M60 100c-20 0-30-14-26-30c4-14 16-18 18-38c12 12 26 26 26 44c0 14-8 24-18 24z" class="f"/><path d="M60 100c-8 0-12-6-10-14c2-6 8-8 10-16c6 6 10 12 10 20c0 6-4 10-10 10z"/>',
  book: '<path d="M24 26h50a12 12 0 0 1 12 12v58H36a12 12 0 0 1-12-12z" class="f"/><path d="M24 84a12 12 0 0 1 12-12h50"/>',
  scroll: '<path d="M32 28h52v60a10 10 0 0 1-10 10H34" class="f"/><path d="M32 28a8 8 0 0 0-8 8v4h16v-4a8 8 0 0 0-8-8zM42 48h30M42 60h30M42 72h20"/>',
};
const glyphIcon = (g) => `<circle cx="60" cy="60" r="34" class="f"/><text x="60" y="72" text-anchor="middle">${g}</text>`;
function bagItems() {
  if (BAG.tab === 'weapons') return ['spear', 'greatsword', 'tianshu'].map((w) => {
    const I = WEAPON_INFO[w], own = !!prog.weapons[w];
    return { own, icon: ICON[w], name: own ? I.name : '？？？', en: own ? I.en : 'UNKNOWN', badge: prog.weapon === w ? '裝備中' : '', w,
      body: own ? `<p>${I.desc}</p><dl><dt>招式</dt><dd>${I.moves}</dd><dt>取得</dt><dd>${I.how}</dd></dl>${statBars(I.stats)}` : `<p class="hint">線索：${I.how}</p>` };
  });
  if (BAG.tab === 'powers') return Object.keys(POWERS).map((k) => {
    const pw = POWERS[k], own = !!prog[pw.key] || TEST.powers;
    return { own, icon: glyphIcon(pw.glyph), name: own ? pw.name : '？？？', en: own ? pw.en : 'UNKNOWN',
      body: own ? `<p>${pw.desc}</p><dl><dt>信物</dt><dd>${POWER_GIFT[k]}</dd><dt>來自</dt><dd>${POWER_HOW[k]}</dd></dl>` : `<p class="hint">線索：${POWER_HOW[k]}</p>` };
  });
  if (BAG.tab === 'collect') {
    const rows = [['isle', '光羽 · 光羽之境', 'FEATHERS · THE ISLE'], ['realm', '光羽 · 天上神域', 'FEATHERS · THE EMPYREAN'], ['earth', '光羽 · 人間', 'FEATHERS · THE MORTAL WORLD'], ['hell', '光羽 · 地獄', 'FEATHERS · THE ABYSS']].map(([L, n, en]) => {
      const c = fCount(L); return { own: true, icon: ICON.feather, name: n, en, n: `${c.got}/${c.all}`, k: c.all ? c.got / c.all : 0, body: `<p>散落各地的光羽。每一根都曾經屬於某位天使。</p>${meter(c.got, c.all)}` };
    });
    const seen = CODEX.filter((c) => codexState(c) > 0).length;
    rows.push({ own: true, icon: ICON.person, name: '救出的人', en: 'THE RESCUED', n: `${nRescued()}/${captives.length}`, k: nRescued() / Math.max(1, captives.length), body: `<p>被蝕晶封住的人。救出的人會回到晨鐘堡，點亮更多燈火。</p>${meter(nRescued(), captives.length)}` });
    rows.push({ own: true, icon: ICON.flame, name: '守住的燈火', en: 'BEACONS HELD', n: `${nBeacons()}/${beacons.length}`, k: nBeacons() / Math.max(1, beacons.length), body: `<p>人們最後的燈火。每守住一座，生命上限 +10。</p>${meter(nBeacons(), beacons.length)}` });
    rows.push({ own: true, icon: ICON.book, name: '墮天錄', en: 'CODEX OF THE FALLEN', n: `${seen}/${CODEX.length}`, k: seen / CODEX.length, body: `<p>遇過的敵人與首領。按 B 打開墮天錄。</p>${meter(seen, CODEX.length)}` });
    return rows;
  }
  const ids = Object.keys(STORY).filter((id) => STORY[id].clue && prog.clues[id]);
  if (!ids.length) return [{ own: false, icon: ICON.scroll, name: '還沒有線索', en: 'NO CLUES YET', body: '<p class="hint">石刻、殘響和人們說的話，會記在這裡。</p>' }];
  return ids.map((id) => ({ own: true, icon: ICON.scroll, name: STORY[id].clue[0], en: STORY[id].who[1], body: `<p>${STORY[id].clue[1]}</p><dl><dt>來自</dt><dd>${STORY[id].who[0]}</dd></dl>` }));
}
const meter = (a, b) => `<div class="meter"><i style="width:${b ? (a / b) * 100 : 0}%"></i></div>`;
const statBars = (s) => `<div class="stats">${['攻擊', '速度', '範圍'].map((k, i) => `<div><span>${k}</span><b>${'<i class="on"></i>'.repeat(s[i])}${'<i></i>'.repeat(5 - s[i])}</b></div>`).join('')}</div>`;
function renderBag() {
  document.querySelectorAll('#bagTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === BAG.tab));
  const items = bagItems(); BAG.sel = Math.min(BAG.sel, items.length - 1);
  $('bagGrid').innerHTML = items.map((it, i) => `<button class="slot${it.own ? '' : ' lock'}${i === BAG.sel ? ' sel' : ''}" data-i="${i}">
      <svg viewBox="0 0 120 120">${it.icon}</svg>${it.badge ? `<em>${it.badge}</em>` : ''}${it.n ? `<b>${it.n}</b>` : ''}${it.k !== undefined ? `<i class="bar" style="--k:${it.k}"></i>` : ''}</button>`).join('') + '<i class="slot empty"></i>'.repeat(Math.max(8, Math.ceil(items.length / 4) * 4) - items.length);
  const it = items[BAG.sel];
  const act = BAG.tab === 'weapons' && it.own ? (prog.weapon === it.w ? '<button class="lbtn on" disabled><span>裝備中</span><small>EQUIPPED</small></button>' : '<button class="lbtn" id="bagEquip"><span>裝備</span><small>EQUIP</small></button>') : '';
  $('bagDetail').innerHTML = `<div class="bigi${it.own ? '' : ' lock'}"><svg viewBox="0 0 120 120">${it.icon}</svg></div><h3>${it.name}</h3><small>${it.en}</small>${it.body}${act}`;
  const eq = $('bagEquip'); if (eq) eq.addEventListener('click', () => { equipWeapon(it.w); Audio.sfx('pickup'); renderBag(); });
  document.querySelectorAll('#bagGrid button.slot').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    if (i === BAG.sel && BAG.tab === 'weapons' && items[i].own && prog.weapon !== items[i].w) { equipWeapon(items[i].w); Audio.sfx('pickup'); }
    else Audio.sfx('ui');
    BAG.sel = i; renderBag();
  }));
}
function openBag(tab) {
  if (state !== 'play') return;
  if (tab) { BAG.tab = tab; BAG.sel = 0; }
  paused = true; freeMouse(); closeOverlays(); paused = true;
  $('bagOv').classList.remove('hidden'); renderBag(); Audio.sfx('ui');
}
function initBag() {
  $('bBag').addEventListener('click', (e) => { e.stopPropagation(); openBag(); });
  document.querySelectorAll('#bagTabs button').forEach((b) => b.addEventListener('click', () => { BAG.tab = b.dataset.tab; BAG.sel = 0; Audio.sfx('ui'); renderBag(); }));
  $('dlg').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); dlgNext(); });
}

// ------------------------------------------------------------------ test mode
// Jump straight to each chapter's key places and bosses. Everything done here lands in its own save slot.
let pendingWarp = null;
const WARPS = {
  spawn: () => ['isle', SPAWN.x, SPAWN.z, '鏡湖', 'THE MIRROR LAKE', { x: LAKE.x, z: LAKE.z }],
  shrine: () => { const s = SHRINES[Math.max(0, prog.s.findIndex((v) => !v))]; return ['isle', s.x + 7, s.z + 7, '聖壇', 'THE SHRINE', s]; },
  temple: () => ['isle', TEMPLE.x, TEMPLE.z + 34, '環光聖所', 'THE SANCTUM', TEMPLE],
  boss1: () => ['isle', BOSS_HOME.x - 16, BOSS_HOME.z + 16, '墮翼之丘', 'HILL OF FALLEN WINGS', BOSS_HOME],
  realm: () => ['realm', REALM.landing.x, REALM.landing.z, '天上神域', 'THE EMPYREAN', null, REALM.landing.y],
  boss2: () => ['realm', REALM.bossHome.x, REALM.bossHome.z + 18, '審判之環', 'THE RING OF JUDGEMENT', REALM.bossHome, REALM.bossHome.y],
  earth: () => ['earth', EARTH.landing.x, EARTH.landing.z, '墜光坑', 'THE CRATER OF FALLEN LIGHT', EARTH.pillar],
  town: () => ['earth', EARTH.town.x, EARTH.town.z + 30, '晨鐘堡', 'BELLDAWN HOLD', EARTH.town],
  captive: () => { const c = captives.find((o) => !o.done) || captives[0]; return ['earth', c.x + 12, c.z + 12, '受困的人', 'THE SEALED', c]; },
  beacon: () => { const b = beacons.find((o) => o.st !== 'lit') || beacons[0]; return ['earth', b.x + 9, b.z + 9, '烽火台', 'THE BEACON', b]; },
  boss3: () => ['earth', EARTH.bossHome.x + 14, EARTH.bossHome.z + 22, '傾城遺跡', 'THE FALLEN KEEP', EARTH.bossHome],
  rift: () => ['earth', EARTH.riftRim.x, EARTH.riftRim.z, '墮天裂谷', 'THE RIFT', EARTH.colossus],
  hell: () => ['hell', HELL.landing.x, HELL.landing.z, '墜落之地', 'THE LANDING', { x: C.HCX, z: C.HCZ - 128 }],
  bridge: () => ['hell', C.HCX, C.HCZ + HELL_MAP.lavaV(0) + 26, '熔河', 'THE BURNING RIVER', { x: C.HCX, z: C.HCZ - 128 }],
  boss4: () => ['hell', HELL.bossHome.x, HELL.bossHome.z + 40, '守門者之環', "THE KEEPER'S RING", HELL.bossHome],
  gate: () => ['hell', HELL.gate.x, HELL.gate.z + 10, '冥門', 'THE ABYSSAL GATE', HELL.gate],
};
function enterTest() {
  if (TEST.on) return;
  TEST.on = true; store.set('lumenfall_test', TEST);
  save(); // copies the journey so far into the test slot; the real save stays exactly as it was
  syncTestUI();
}
function warpTo(id) {
  const w = WARPS[id] && WARPS[id](); if (!w) return;
  enterTest();
  if (state === 'landing') { pendingWarp = id; closeOverlays(); beginJourney(); return; }
  if (state === 'dead') revive();
  if (state !== 'play') return;
  closeOverlays();
  const [L, x, z, cn, en, look, yHint] = w, li = L === 'hell' ? 2 : L === 'earth' ? 1 : 0;
  P.inRealm = L === 'realm'; P.inEarth = L === 'earth'; P.inHell = L === 'hell';
  const y0 = yHint !== undefined ? yHint + 2 : Math.max(li ? -1e9 : 0, C.groundAtL(x, z, li)) + 1.5;
  P.pos.set(x, y0, z); syncLayer();
  const h = support(x, z, y0 + 1).h; if (h > -1e8) P.pos.y = h + 0.3;
  if (L !== 'isle') prog.end = true;
  if (L === 'realm') prog.realm = true;
  if (li) prog.earth = true;
  if (L === 'hell') prog.hell = true;
  save();
  if (look) P.yaw = Math.atan2(look.x - x, look.z - z);
  CAM.yaw = P.yaw + Math.PI; CAM.pitch = 0.22;
  P.vel.set(0, 0, 0); P.safe.copy(P.pos); P.checkpoint.copy(P.pos); P.glide = false; P.lock = null;
  flashScreen(0.8); regionCard(cn, en); updateQuest();
}
function takeFeathers(n) {
  let k = 0;
  for (const f of feathers) { if (f.taken || k >= n) continue; f.taken = true; f.grp.visible = false; prog.f.push(f.id); k++; }
  save(); const nl = lvFor(prog.f.length); if (nl > P.lvTarget) { P.lvTarget = nl; setTimeout(() => levelUp(nl), 400); }
  updateLvHUD(); updateQuest();
}
const CHEATS = {
  feather: () => { takeFeathers(3); closeOverlays(); },
  lv: () => { takeFeathers(Math.max(0, LV_REQ[7] - prog.f.length)); closeOverlays(); },
  heal: () => { applyStats(true); toast('<i class="dia"></i>生命與聖瓶已補滿'); },
  clear: () => { let n = 0; for (const s of shades) if (!s.dead && s.g.position.distanceTo(P.pos) < 45) { killShade(s); n++; } toast(`<i class="dia"></i>附近敵人已清除 · ${n}`); },
  codex: () => { for (const k of new Set(Object.values(KILL_KEY))) prog.kills[k] = Math.max(prog.kills[k] || 0, 8); for (const b of bosses) prog.seen[b.cfg.key] = true; save(); toast('<i class="dia"></i>圖鑑已全部解鎖'); },
  gs: () => { const order = ['spear', 'greatsword', 'tianshu'], w = order[(order.indexOf(prog.weapon) + 1) % 3]; prog.weapons[w] = true; if (w === 'tianshu') prog.hellBlade = true; equipWeapon(w); toast(`<i class="dia"></i>${WEAPON_INFO[w].name}`); },
};
function syncTestUI() {
  const st = $('testStat');
  st.classList.toggle('on', TEST.on);
  st.querySelector('span').textContent = TEST.on ? '測試中 · 進度另外儲存，離開後回到正式存檔' : '未開啟 · 按任何一項即自動開啟，並複製目前進度';
  document.querySelectorAll('#testOv [data-tog]').forEach((b) => b.classList.toggle('on', b.dataset.tog === 'hellBlade' ? !!prog.hellBlade : !!TEST[b.dataset.tog]));
  document.querySelectorAll('#testOv [data-boss]').forEach((b) => b.classList.toggle('done', !!prog[b.dataset.boss]));
  $('testExit').classList.toggle('hidden', !TEST.on);
  $('testChip').classList.toggle('hidden', !TEST.on);
  if (!TEST.coords) $('testInfo').textContent = '';
}
function openTest() {
  if (state === 'play') paused = true;
  freeMouse(); closeOverlays(); if (state === 'play') paused = true;
  syncTestUI(); $('testOv').classList.remove('hidden'); Audio.sfx('ui');
}
let testInfoT = 0, fpsAvg = 60;
function updateTestInfo(dt) {
  if (!TEST.on || !TEST.coords) return;
  if (dt > 0) fpsAvg = lerp(fpsAvg, 1 / dt, 0.05);
  if ((testInfoT -= dt) > 0) return; testInfoT = 0.25;
  const L = ['光羽之境', '人間', '地獄'][C.LAYER.cur] + (P.inRealm ? ' · 神域' : '');
  $('testInfo').textContent = `${L} · ${P.pos.x.toFixed(0)}, ${P.pos.y.toFixed(0)}, ${P.pos.z.toFixed(0)} · ${Math.round(fpsAvg)} FPS`;
}
function initTestMode() {
  $('openTest').addEventListener('click', () => openTest());
  $('testChip').addEventListener('click', (e) => { e.stopPropagation(); openTest(); });
  document.querySelectorAll('#testOv [data-warp]').forEach((b) => b.addEventListener('click', () => { Audio.sfx('ui'); warpTo(b.dataset.warp); }));
  document.querySelectorAll('#testOv [data-tog]').forEach((b) => b.addEventListener('click', () => {
    enterTest(); const k = b.dataset.tog;
    if (k === 'hellBlade') { prog.hellBlade = !prog.hellBlade; prog.weapons.tianshu = prog.hellBlade; equipWeapon(prog.hellBlade ? 'tianshu' : 'spear'); save(); updateQuest(); } else { TEST[k] = !TEST[k]; store.set('lumenfall_test', TEST); }
    Audio.sfx('ui'); syncTestUI();
  }));
  document.querySelectorAll('#testOv [data-cheat]').forEach((b) => b.addEventListener('click', () => {
    if (state !== 'play') { $('testStat').querySelector('span').textContent = '請先開始旅程，或者先選一個地點跳過去'; return; }
    enterTest(); CHEATS[b.dataset.cheat](); Audio.sfx('ui'); syncTestUI();
  }));
  $('testExit').addEventListener('click', () => { TEST.on = false; TEST.god = TEST.oneHit = TEST.powers = false; store.set('lumenfall_test', TEST); location.reload(); });
  $('testFresh').addEventListener('click', () => {
    const b = $('testFresh');
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.querySelector('span').textContent = '再按一次確認'; setTimeout(() => { b.classList.remove('confirm'); b.querySelector('span').textContent = '全新進度重新開始'; }, 2600); return; }
    TEST.on = true; store.set('lumenfall_test', TEST); store.set('lumenfall_progress_test', null); location.reload();
  });
  syncTestUI();
}
function onEnterPlay() {
  if (pendingWarp) { const w = pendingWarp; pendingWarp = null; setTimeout(() => warpTo(w), 80); }
  $('landing').classList.add('hidden');
  $('hud').classList.remove('hidden');
  requestAnimationFrame(() => $('hud').classList.add('show'));
  layoutMinimap();
  currentRegion = '';
  updateQuest();
  if (!prog.talk.intro && !prog.end && !pendingWarp) setTimeout(() => { if (state === 'play' && !DLG) talk('intro'); }, 1400);
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
  const want = P.pos.y < -1200 ? 2 : P.pos.y < -350 ? 1 : 0;
  if (C.LAYER.cur === want) return;
  C.LAYER.cur = want;
  for (const gm of W.grassMats) {
    gm.uniforms.uHeight.value = want ? EARTH.heightTex : W.heightTex; gm.uniforms.uBaseY.value = want ? C.EARTH_Y : 0;
    if (gm.uniforms.uGrid) gm.uniforms.uGrid.value.set(want ? C.EHALF : C.HALF, want ? C.ESEG / C.EWORLD : C.SEG / C.WORLD, want ? C.EGN : C.GN);
  }
  if (EARTH.root) EARTH.root.visible = want === 1;
  if (ATM) setTimeout(() => updateAtmos(0, true), 0);
  if (HELL.root) HELL.root.visible = want === 2;
  W.sky.visible = want !== 2;
  if (W.motes) W.motes.visible = want !== 2;
  if (W.drift) W.drift.im.visible = want !== 2;
  currentRegion = '';
}
const waterAt = (x, z) => (C.LAYER.cur === 2 ? -1e9 : C.LAYER.cur ? (z < SEA_NORTH ? -1e9 : C.EARTH_Y) : Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.3 ? 0 : -1e9); // -1e9: no water here


// ------------------------------------------------------------------ atmosphere: every layer, and every corner of the mortal world, has its own light
// A palette = sky (horizon/mid/zenith), fog, sun, sky/ground fill, colour grade, exposure, grass. The isle's own look is captured at load;
// the rest are written relative to it, and the live palette eases toward whatever the seraph is standing in.
const PAL = {};
let ATM = null;
const palKeys = ['hor', 'mid', 'zen', 'fog', 'sun', 'hs', 'hg', 'gB', 'gT'];
function mkPal(base, o) {
  const p = { dens: o.dens ?? base.dens, sunI: o.sunI ?? base.sunI, hI: o.hI ?? base.hI, exp: o.exp ?? base.exp, tint: new THREE.Vector3(...(o.tint || [base.tint.x, base.tint.y, base.tint.z])) };
  for (const k of palKeys) p[k] = o[k] ? new THREE.Color(o[k]) : base[k].clone();
  return p;
}
function copyPal(d, a) { for (const k of palKeys) d[k].copy(a[k]); d.dens = a.dens; d.sunI = a.sunI; d.hI = a.hI; d.exp = a.exp; d.tint.copy(a.tint); return d; }
function lerpPal(d, b, t) { if (t <= 0.001) return d; for (const k of palKeys) d[k].lerp(b[k], t); d.dens += (b.dens - d.dens) * t; d.sunI += (b.sunI - d.sunI) * t; d.hI += (b.hI - d.hI) * t; d.exp += (b.exp - d.exp) * t; d.tint.lerp(b.tint, t); return d; }
function captureAtmos() {
  const gm = W.grassMats[0].uniforms;
  const isle = { hor: COL.hor.clone(), mid: COL.mid.clone(), zen: COL.zen.clone(), fog: scene.fog.color.clone(), dens: scene.fog.density, sun: W.sun.color.clone(), sunI: W.sun.intensity,
    hs: W.hemi.color.clone(), hg: W.hemi.groundColor.clone(), hI: W.hemi.intensity, tint: new THREE.Vector3(), exp: 0.86, gB: gm.uBase.value.clone(), gT: gm.uTip.value.clone() };
  PAL.isle = isle;
  PAL.realm = mkPal(isle, { exp: 0.74 });
  // the mortal world: warmer, earthier, a low golden haze
  PAL.earth = mkPal(isle, { hor: '#ead9b9', mid: '#c5cdc9', zen: '#6b8db8', fog: '#e0d2b6', dens: 0.0019, sun: '#ffd29a', sunI: 2.55, hs: '#dfe3e2', hg: '#8a7a50', hI: 0.62, tint: [0.02, 0.006, -0.022], exp: 0.88, gB: '#36532a', gT: '#a6b65a' });
  PAL.swamp = mkPal(isle, { hor: '#aab39a', mid: '#98a291', zen: '#5d6f6c', fog: '#959c86', dens: 0.0042, sun: '#d6d3a8', sunI: 1.55, hs: '#b8c0a8', hg: '#4c4a32', hI: 0.55, tint: [-0.012, 0.012, -0.02], exp: 0.84, gB: '#2c3f24', gT: '#7d8a48' });
  PAL.frost = mkPal(isle, { hor: '#e7eef3', mid: '#c9d9e7', zen: '#5f8cc4', fog: '#e2eaf0', dens: 0.0024, sun: '#f6f3ea', sunI: 2.6, hs: '#eef2f6', hg: '#9aa0a8', tint: [-0.02, 0.0, 0.03], exp: 0.86, gB: '#3e5a40', gT: '#b7c79a' });
  PAL.rift = mkPal(isle, { hor: '#d9b29a', mid: '#ad8f86', zen: '#5c4a5e', fog: '#be9682', dens: 0.0028, sun: '#ffae7a', sunI: 2.0, hs: '#d8b8a8', hg: '#5a3a2c', hI: 0.55, tint: [0.035, -0.01, -0.025], exp: 0.86, gB: '#3e4a2a', gT: '#a09a58' });
  PAL.coast = mkPal(isle, { hor: '#e3ecec', mid: '#bad3df', zen: '#578bc6', fog: '#d9e5e7', dens: 0.0016, sun: '#fff1d6', sunI: 2.6, tint: [-0.01, 0.0, 0.018], exp: 0.88 });
  PAL.hell = mkPal(isle, { hor: '#5a1a10', mid: '#2a0c0a', zen: '#0a0405', fog: '#3a140d', dens: 0.0052, sun: '#ff7a3a', sunI: 1.15, hs: '#5a1e12', hg: '#ff5a20', hI: 0.5, tint: [0.05, -0.015, -0.03], exp: 1.0 });
  ATM = { cur: mkPal(isle, {}), tgt: mkPal(isle, {}) };
}
function atmosTarget() {
  const t = ATM.tgt, L = C.LAYER.cur;
  if (L === 2) return copyPal(t, PAL.hell);
  if (L === 0) return copyPal(t, P.pos.y > 200 ? PAL.realm : PAL.isle);
  const x = P.pos.x, z = P.pos.z;
  copyPal(t, PAL.earth);
  lerpPal(t, PAL.coast, smooth(360, 470, x) * (1 - smooth(200, 330, Math.abs(z - 130))));
  lerpPal(t, PAL.frost, 1 - smooth(110, 240, Math.hypot(x - 350, z + 360)));
  lerpPal(t, PAL.swamp, 1 - smooth(0.7, 1.25, Math.hypot(x - EARTH_EP.swamp.x, z - EARTH_EP.swamp.z) / EARTH_EP.swamp.r));
  lerpPal(t, PAL.rift, (1 - smooth(40, 150, Math.abs(z - riftZ(x)))) * smooth(-400, -330, x) * (1 - smooth(290, 350, x)));
  return t;
}
function updateAtmos(dt, snap) {
  if (!ATM) return;
  const tgt = atmosTarget(), c = ATM.cur;
  if (snap) copyPal(c, tgt); else lerpPal(c, tgt, 1 - Math.exp(-dt * 1.4));
  COL.hor.copy(c.hor); COL.mid.copy(c.mid); COL.zen.copy(c.zen);
  scene.fog.color.copy(c.fog); scene.fog.density = c.dens;
  W.sun.color.copy(c.sun); W.sun.intensity = c.sunI;
  W.hemi.color.copy(c.hs); W.hemi.groundColor.copy(c.hg); W.hemi.intensity = c.hI;
  grade.uniforms.uTint.value.copy(c.tint);
  renderer.toneMappingExposure = c.exp;
  for (const gm of W.grassMats) { if (gm.uniforms.uBase) gm.uniforms.uBase.value.copy(c.gB); if (gm.uniforms.uTip) gm.uniforms.uTip.value.copy(c.gT); }
}
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
  if (C.LAYER.cur === 1) { earthCull(camera.position); updateFolk(dt); }
  if (boss && boss.engaged && !prog.seen[boss.cfg.key]) { prog.seen[boss.cfg.key] = true; save(); }
  updateLvFx(dt);
  if (state === 'play') updateQuestDist(realDt);
  updateTestInfo(realDt);
  updateStory();
  updateFeathers(dt);
  updateFX(dt);
  // seraph pose
  const mode = state === 'landing' || state === 'loading' ? 'title' : 'play';
  hero.root.position.copy(P.pos);
  hero.root.rotation.y = P.yaw + P.spin;
  hero.setVisible(!(P.inv > 0 && P.hurtT < 0 && state === 'play' && Math.floor(time * 20) % 2 === 0 && P.inv < 0.85 && P.lastHurt > time - 1));
  hero.update(dt, { wpn: prog.weapon, mode, speed: P.speed, phase: P.phase, grounded: P.grounded, vy: P.vel.y, glide: P.glide, dash: P.dashT, atk: P.atk, cast: P.castT, hurt: P.hurtT, charge: P.charge, lock: !!P.lock, heal: P.healT >= 0 ? 1 : 0 });
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
    const amt = Q.bloom && C.LAYER.cur !== 2 ? smooth(0.35, 0.85, face) * 0.22 : 0;
    rays.enabled = amt > 0.01;
    if (rays.enabled) { _v.copy(camera.position).addScaledVector(sunDir, 800).project(camera); rays.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5); rays.uniforms.uAmt.value = amt; }
  }
  updateAmbient(time, dt, _p.set(P.pos.x, P.pos.y, P.pos.z));
  for (const gm of W.grassMats) { gm.uniforms.uCenter.value.copy(P.pos); gm.uniforms.uPlayer.value.copy(P.pos); }
  updateAtmos(dt, false);
  if (C.LAYER.cur === 2 && HELL.sky) HELL.sky.position.copy(camera.position);
  { const low = P.pos.y < 170, isle = low && C.LAYER.cur === 0; W.grass.visible = W.flowers.visible = low && C.LAYER.cur !== 2; if (Q.refl) { W.water.reflector.visible = isle; W.water.simple.visible = !isle; } }
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
  C.buildGrid(); buildEarthGrid(); buildHellGrid();
  setLoad(0.35, '大地自雲海中升起…');
  await wait();
  buildWorld(scene, renderer, Q);
  buildEarth(scene);
  buildHell(scene);
  setLoad(0.65, '聖所的光環正在轉動…');
  await wait();
  buildPlayer();
  buildFX();
  EARTH.root.visible = false;
  buildShades();
  buildFolk();
  buildBoss();
  buildBreakables();
  buildFeathers();
  buildStory();
  if (prog.weapon !== 'spear' && prog.weapons[prog.weapon]) hero.setWeapon(prog.weapon); else prog.weapon = 'spear';
  applyWeaponLook();
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
  // compile every shader up front (the human world too), asynchronously where the browser allows it,
  // so the page stays responsive here and dropping into the world below doesn't hitch
  EARTH.root.visible = HELL.root.visible = true;
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { try { renderer.compile(scene, camera); } catch (_) {} }
  EARTH.root.visible = HELL.root.visible = false;
  captureAtmos();
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
window.__LF = { talk: (id) => talk(id), dlg: () => DLG, dlgNext: () => dlgNext(), bag: (t) => openBag(t), spots: () => STORY_SPOTS, warp: (id) => warpTo(id), test: TEST, quest: () => QS, layer: () => C.LAYER.cur, hell: () => HELL, sites: () => ({ captives, beacons, folk }), kill: (sh) => killShade(sh), interact: () => doInteract(), dyn: () => ({ ...dyn, pr: renderer.getPixelRatio() }), levelUp: (n) => levelUp(n), showPower: (k) => showPower(k), breakables, equipWeapon: (w) => equipWeapon(w), calls: () => { renderer.info.autoReset = false; renderer.info.reset(); composer.render(0.016); const r = { ...renderer.info.render }; renderer.info.autoReset = true; return r; }, pause: (b) => (paused = b), FX, slow: () => (DT_MAX = 0.05), act: { attackDown, attackUp, lightAttack, doLock, doHeal, startAttack, perfectDodge, doAttack, doJump, doSkill, doDodge, doInteract, openMap, openSettings, damageShade, regionCard, toast }, fast: () => (DT_MAX = 0.25), THREE, scene, composer, q: (o) => { Object.assign(QUAL[settings.quality], o); applyQuality(); }, P, CAM, W, hero: () => hero, boss: () => boss, state: () => state, prog, shades, feathers, setState: (s) => (state = s), camera, renderer };
