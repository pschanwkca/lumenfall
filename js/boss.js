// LUMENFALL · boss.js — 墮光守衛 · 歐菲爾 (Ophiel, the Fallen Warden)
// A giant corrupted seraph built on the same skeleton + animation system as the player.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angDiff, easeOut, easeInOut, groundAt, TEX } from './core.js';
import { SeraphActor } from './seraph.js';

export const BOSS_HOME = new THREE.Vector3(176, 0, -96);
const KEYS = ['thL', 'thR', 'knL', 'knR', 'hipY', 'hipX', 'tX', 'tY', 'tZ', 'hX', 'hY', 'sLx', 'sLz', 'eL', 'sRx', 'sRz', 'sRy', 'eR', 'fold', 'flap', 'wScale', 'wLift'];
const BASE = { thL: 0, thR: 0, knL: 0.05, knR: 0.05, hipY: 0.95, hipX: 0, tX: 0.08, tY: 0, tZ: 0, hX: 0.05, hY: 0, sLx: -0.25, sLz: 0.3, eL: -0.6, sRx: -0.45, sRz: -0.35, sRy: 0, eR: -0.45, fold: 0.55, flap: 0, wScale: 0.95, wLift: 0 };

function decalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uAlpha: { value: 0 }, uMode: { value: 0 }, uAng: { value: 1.4 }, uIn: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uFill, uAlpha, uMode, uAng, uIn; varying vec2 vP;
      void main(){
        float m = 0.0, prog = 0.0, edge = 0.0;
        if (uMode < 0.5) { float r = length(vP); m = step(r, 1.0)*step(uIn, r); prog = r; edge = smoothstep(0.93, 1.0, r); }
        else if (uMode < 1.5) { vec2 q = vP*0.5 + 0.5; m = step(abs(vP.x), 1.0)*step(0.0, q.y)*step(q.y, 1.0); prog = q.y; edge = max(smoothstep(0.9, 1.0, abs(vP.x)), smoothstep(0.97, 1.0, q.y)); }
        else { float r = length(vP); float a = abs(atan(vP.x, vP.y)); m = step(r, 1.0)*step(a, uAng); prog = r; edge = max(smoothstep(0.94, 1.0, r), smoothstep(uAng - 0.06, uAng, a)); }
        if (m < 0.5) discard;
        float fill = step(prog, uFill);
        vec3 col = mix(vec3(0.55, 0.08, 0.2), vec3(1.0, 0.35, 0.2), fill);
        col = mix(col, vec3(2.2, 1.6, 0.8), edge);
        gl_FragColor = vec4(col, uAlpha*(0.22 + fill*0.3 + edge*0.6));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
  });
}

// breakable parts, as in a hunt: [name, english, share of max hp, damage taken ×]
const PARTS = { head: ['頭 · 光環', 'HALO', 0.14, 1.35], wings: ['雙翼', 'WINGS', 0.2, 1.0], weapon: ['武器', 'WEAPON', 0.15, 0.75], legs: ['雙腿', 'LEGS', 0.12, 0.9] };
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class Boss {
  constructor(G, cfg = {}) {
    this.G = G;
    this.cfg = cfg = Object.assign({ key: 'boss', name: '墮光守衛 · 歐菲爾', en: 'OPHIEL, THE FALLEN WARDEN', fallen: true, scale: 3.0, weapon: 'greatsword', maxHp: 2600, home: BOSS_HOME, floor: null, arenaR: 0, leash: 62 }, cfg);
    this.gnd = cfg.floor != null ? () => cfg.floor : groundAt;
    this.emisC = new THREE.Color(cfg.emis || '#ffbf5c');
    this.isBoss = true; this.r = 2.0; this.hy = 8;
    this.home = cfg.home.clone(); this.home.y = this.gnd(this.home.x, this.home.z);
    this.actor = new SeraphActor(G.scene, { fallen: cfg.fallen, scale: cfg.scale, weapon: cfg.weapon });
    if (cfg.tint) {
      const tint = new THREE.Color(cfg.tint), done = new Map();
      const conv = (m0) => {
        if (!done.has(m0)) {
          const m = m0.clone();
          if (m.metalness < 0.8 && m.color) m.color.lerp(tint, m.map ? 0.6 : 0.8);
          if (m.emissive && m.metalness < 0.8) m.emissiveIntensity *= 0.25;
          done.set(m0, m);
        }
        return done.get(m0);
      };
      this.actor.root.traverse((o) => {
        if (!(o.isMesh || o.isSprite) || !o.material) return;
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      });
      for (const k in this.actor.M) if (done.has(this.actor.M[k])) this.actor.M[k] = done.get(this.actor.M[k]);
    }
    this.actor.anim.c = Object.assign({}, BASE);
    this.c = Object.assign({}, BASE);
    this.pos = this.home.clone(); this.yaw = Math.PI * 0.75; this.vel = new THREE.Vector3();
    this.maxHp = cfg.maxHp; this.hp = this.maxHp; this.hpShown = this.maxHp;
    this.poise = 100; this.phase = 1;
    this.st = G.prog[cfg.key] ? 'purified' : 'dormant'; this.t = 0; this.cd = 1.2; this.engaged = false; this.dead = !!G.prog[cfg.key];
    this.hitDone = false; this.leapFrom = new THREE.Vector3(); this.leapTo = new THREE.Vector3();
    this.ring = { on: false, r: 0, hit: false, center: new THREE.Vector3() };
    this.volley = 0; this.lastAct = '';
    // parts, wounds and trips
    this.parts = {}; this.tripN = 0; this.tripAcc = 0; this.reachK = 1;
    for (const [k, [cn, en, hpK, mult]] of Object.entries(PARTS)) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(2.6, 0.55, 0.3), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.visible = false; sp.renderOrder = 25; G.scene.add(sp);
      this.parts[k] = { k, cn, en, max: cfg.maxHp * hpK, hp: cfg.maxHp * hpK, mult, broken: false, wAcc: 0, wound: false, scar: 0, spr: sp };
    }
    // telegraph decals
    this.decal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), decalMaterial());
    this.decal.rotation.x = -Math.PI / 2; this.decal.visible = false; this.decal.renderOrder = 3;
    G.scene.add(this.decal);
    const ringMat = new THREE.MeshBasicMaterial({ map: TEX.ripple, color: new THREE.Color(1.6, 0.7, 1.2), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 96), ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.visible = false;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 96, 1, true), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(1.3, 0.55, 1.0), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    wall.position.y = 0.7; this.ringMesh.add(wall); wall.rotation.x = Math.PI / 2;
    G.scene.add(this.ringMesh);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.shadow.rotation.x = -Math.PI / 2; G.scene.add(this.shadow);
    // judgement: pillars of light called down where you stand (the Arbiter's own move)
    this.pillars = [];
    if (cfg.moves && cfg.moves.includes('pillars')) for (let i = 0; i < 4; i++) {
      // amber, normally blended: a telegraph has to read on the realm's white stone as well as on dark ground
      const tm = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: '#d0861c', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      tm.rotation.x = -Math.PI / 2; tm.visible = false; tm.renderOrder = 4;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#b8600f', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      tm.add(fill);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ map: TEX.beam, color: new THREE.Color(2.4, 2.0, 1.3), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beam.visible = false;
      G.scene.add(tm); G.scene.add(beam);
      this.pillars.push({ tm, fill, beam, t: -1, at: new THREE.Vector3(), hit: false });
    }
    for (const o of [this.decal, this.ringMesh, this.shadow]) o.traverse((c) => c.layers.set(2));
    if (this.st === 'purified') this.purify(true);
    this.place();
  }
  targetable() { return this.engaged && !this.dead && this.st !== 'intro'; }
  get invuln() { return ['dormant', 'intro', 'transform', 'dying', 'purified'].includes(this.st); }
  place() {
    this.actor.root.position.copy(this.pos);
    this.actor.root.rotation.y = this.yaw;
    this.shadow.position.set(this.pos.x, this.gnd(this.pos.x, this.pos.z) + 0.06, this.pos.z);
    const air = this.pos.y - this.gnd(this.pos.x, this.pos.z);
    this.shadow.scale.setScalar(clamp(1 - air * 0.06, 0.4, 1));
  }
  reset() {
    if (this.dead) return;
    this.hp = this.maxHp; this.poise = 100; this.phase = 1; this.engaged = false; this.st = 'dormant'; this.t = 0;
    for (const p of Object.values(this.parts)) { p.wound = false; p.wAcc = 0; p.scar = 0; p.spr.visible = false; } // broken parts stay broken
    this.tripN = 0; this.tripAcc = 0;
    this.pos.copy(this.home); this.ring.on = false; this.ringMesh.visible = false; this.decal.visible = false;
    this.G.ui.bar.classList.add('hidden'); this.G.ui.bar.classList.remove('p2'); document.body.classList.remove('boss');
    this.actor.M.skin.emissiveIntensity = 1.5;
  }
  // a hit is about to land on the player (for perfect dodge)
  threat(p) {
    if (!this.engaged || this.dead) return false;
    const tl = this.impactAt - this.t;
    if (this.st === 'ring' && this.ring.on && Math.abs(Math.hypot(p.x - this.ring.center.x, p.z - this.ring.center.z) - this.ring.r) < 2.2) return true;
    if (tl > -0.05 && tl < 0.32 && this.inArea(p, 0.8)) return true;
    for (const pl of this.pillars) if (pl.t > 0.6 && pl.t < 0.92 && Math.hypot(p.x - pl.at.x, p.z - pl.at.z) < 3.2) return true;
    if (this.st === 'combo' && tl > -0.05 && tl < 0.32 && this.local(p).d < 9) return true;
    return false;
  }
  local(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return { f: dx * fx + dz * fz, l: dx * fz - dz * fx, d: Math.hypot(dx, dz) };
  }
  inArea(p, pad = 0) {
    const L = this.local(p);
    if (this.st === 'sweep') return L.d < 8 * this.reachK + pad && L.f > -1.5 && Math.abs(Math.atan2(L.l, L.f)) < 1.45;
    if (this.st === 'slam' || this.st === 'ring') return L.f > -1 && L.f < 10.5 * this.reachK + pad && Math.abs(L.l) < 1.7 + pad;
    if (this.st === 'leap') return Math.hypot(p.x - this.leapTo.x, p.z - this.leapTo.z) < 4.8 + pad;
    return false;
  }
  // where a part is in the world right now
  anchor(k, out) {
    const A = this.actor, b = A.rig && A.rig.b;
    if (k === 'head' && b && b.Head) return b.Head.getWorldPosition(out).setY(out.y + 0.25 * this.cfg.scale);
    if (k === 'legs' && b && b.LeftLeg && b.RightLeg) { b.LeftLeg.getWorldPosition(out); b.RightLeg.getWorldPosition(_a); return out.add(_a).multiplyScalar(0.5); }
    if (k === 'wings' && A.wings && A.wings[0]) return A.wings[0].hand.getWorldPosition(out);
    if (k === 'weapon' && A.weapon) return A.tipWorld(1, out);
    return out.copy(this.pos).setY(this.pos.y + 3);
  }
  // which part a blow from `from` lands on: the aimed one, else the wings from behind, the head when it is down,
  // the weapon while it is buried after a slam, the legs otherwise
  pickPart(from, aim) {
    if (aim && this.parts[aim]) return aim;
    const L = this.local(from);
    if (this.st === 'stagger' && Math.random() < 0.6) return 'head';
    if (L.f < -0.8) return 'wings';
    if ((this.st === 'slam' || this.st === 'ring') && this.t > this.impactAt && this.t < this.impactAt + 1.0 && Math.hypot(this.anchor('weapon', _a).x - from.x, _a.z - from.z) < 4.5) return 'weapon';
    return 'legs';
  }
  damage(dmg, poise, from, kind, info = {}) {
    const G = this.G;
    if (this.invuln || this.dead) { G.dmgNumber(new THREE.Vector3(this.pos.x, this.pos.y + 7, this.pos.z), '—', ''); return null; }
    const part = this.parts[this.pickPart(from, info.aim)];
    const mult = (this.st === 'stagger' ? 1.35 : 1) * part.mult * (part.wound ? 1.25 : 1);
    dmg *= mult;
    this.hp -= dmg; this.poise -= poise * (this.phase === 2 ? 0.75 : 1);
    this.flash = 0.12;
    const at = this.anchor(part.k, _b);
    const hp = new THREE.Vector3(at.x, at.y, at.z).lerp(from, 0.2);
    G.dmgNumber(hp.setY(Math.max(hp.y, this.pos.y + 1.5) + 0.6 + Math.random() * 0.5), Math.round(dmg), kind === 'resist' ? kind : mult >= 1.25 ? 'weak' : kind || '');
    G.burst(G.FX.sparks, hp.x, hp.y, hp.z, 16, { speed: 6, up: 1, life: 0.6, size: 1 });
    G.hitstop(dmg > 80 ? 0.1 : 0.05);
    G.shake(0.12 + Math.min(0.2, dmg * 0.001));
    G.Audio.sfx('hit');
    if (this.hp <= 0) { this.die(); return { part: part.k }; }
    // a part takes its share: break it, open a wound in it, trip on the legs
    if (!part.broken && part.k !== 'legs') { part.hp -= dmg; if (part.hp <= 0) this.breakPart(part); }
    if (part.k === 'legs' && this.st !== 'stagger') {
      this.tripAcc += dmg;
      if (this.tripAcc >= this.maxHp * (0.09 + this.tripN * 0.04)) { this.tripN++; this.tripAcc = 0; this.topple('倒地', 'TOPPLED', 4.2); return { part: part.k }; }
    }
    if (!part.wound && part.scar <= 0 && !info.pop) {
      part.wAcc += dmg;
      if (part.wAcc >= this.maxHp * 0.07) { part.wound = true; part.wAcc = 0; G.onWound && G.onWound(this, part); }
    }
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) { this.go('transform'); return { part: part.k }; }
    if (this.poise <= 0 && this.st !== 'stagger') { this.poise = this.phase === 2 ? 140 : 100; this.topple('破勢', 'POSTURE BROKEN', 3.4); }
    return { part: part.k, mult };
  }
  topple(cn, en, dur) {
    if (this.st === 'dying' || this.st === 'transform') return;
    this.ring.on = false; this.ringMesh.visible = false;
    this.go('stagger'); this.dur = dur; this.G.bigText(cn, en);
  }
  breakPart(part) {
    const G = this.G, A = this.actor, at = this.anchor(part.k, _a);
    part.broken = true;
    G.bigText(`破壞 · ${part.cn}`, `${part.en} BROKEN`); G.shake(0.5); G.hitstop(0.16); G.flash && G.flash(0.3);
    G.burst(G.FX.sparks, at.x, at.y, at.z, 70, { speed: 9, up: 3, life: 1.1, size: 1.3, c: [2.2, 1.4, 0.7] });
    if (part.k === 'head') A.halo.visible = false;
    if (part.k === 'wings') { A.wingK = 0.82; for (const w of A.wings) if (w.primIM) w.primIM.count = 3; G.featherBurst && G.featherBurst(at.x, at.y, at.z, 16, 3); }
    if (part.k === 'weapon') { A.weapon.scale.z = 0.6; this.reachK = 0.72; }
    G.onPartBreak && G.onPartBreak(this, part);
  }
  // a focus strike on an open wound: it bursts, a heavy toll, and the boss reels
  popWound(k, base) {
    const part = this.parts[k];
    if (!part || !part.wound || this.invuln || this.dead) return false;
    part.wound = false; part.scar = 20; part.spr.visible = false;
    const at = this.anchor(k, _b);
    this.G.burst(this.G.FX.sparks, at.x, at.y, at.z, 90, { speed: 10, up: 3, life: 1.0, size: 1.4, c: [2.6, 0.9, 0.4] });
    this.damage(this.maxHp * 0.045 + base * 2.2, 40, this.G.P.pos, 'weak', { aim: k, pop: true });
    this.G.bigText('破傷', 'WOUND DESTROYED'); this.G.hitstop(0.22); this.G.shake(0.6);
    if (!this.dead && !['stagger', 'transform', 'dying', 'clash'].includes(this.st)) this.go('flinch');
    return true;
  }
  // a heavy blow that meets the boss's own at the moment it lands cancels it (offset); blade against blade in an
  // overhead slam locks the two in a power clash instead
  tryOffset() {
    if (!['sweep', 'slam', 'ring', 'combo'].includes(this.st) || this.hitDone) return null;
    const tl = this.impactAt - this.t;
    if (tl < -0.06 || tl > 0.4) return null;
    this.hitDone = true; this.decal.visible = false;
    if (this.st === 'slam' || (this.st === 'combo' && this.hitIdx === 2)) { this.go('clash'); return 'clash'; }
    this.topple('相殺', 'OFFSET', 3.0);
    return 'offset';
  }
  clashEnd(win) {
    if (this.st !== 'clash') return;
    const G = this.G;
    if (win) { this.damage(this.maxHp * 0.06, 60, G.P.pos, 'crit', { aim: 'weapon' }); if (!this.dead) this.topple('力量對抗', 'POWER CLASH', 4.6); }
    else { this.go('idle'); G.hurtPlayer(28, this.pos); }
  }
  go(st) {
    this.st = st; this.t = 0; this.hitDone = false; this.impactAt = 99; this.decal.visible = false; this.segT0 = 0; this.hitIdx = 0;
    const P = this.G.P;
    const sp = this.phase === 2 ? 0.85 : 1;
    switch (st) {
      case 'sweep': this.impactAt = 0.95 * sp; this.dur = this.impactAt + 1.0; this.setDecal(2, 8, 0, 1.45); break;
      case 'slam': this.impactAt = 1.1 * sp; this.dur = this.impactAt + 1.15; this.setDecal(1, 1.7, 5.25, 0); break;
      case 'leap':
        this.impactAt = 0.7 * sp + 0.9; this.dur = this.impactAt + 1.2;
        this.leapFrom.copy(this.pos); this.leapTo.set(P.pos.x, 0, P.pos.z);
        this.leapTo.y = this.gnd(this.leapTo.x, this.leapTo.z);
        break;
      case 'barrage': this.dur = 3.0; this.volley = 0; break;
      case 'ring': this.impactAt = 1.0 * sp; this.dur = this.impactAt + 2.0; this.setDecal(1, 1.7, 5.25, 0); break;
      case 'transform':
        this.dur = 2.4; this.G.Audio.sfx('roar'); this.G.shake(0.5);
        this.G.bigText('覺醒', 'THE WARDEN AWAKENS');
        break;
      case 'stagger': this.dur = 3.4; this.G.Audio.sfx('slam'); break;
      case 'flinch': this.dur = 1.3; this.G.Audio.sfx('roar'); break;
      // a three-blow chain: two sweeps, then an overhead held a beat too long (the delayed blow catches early rolls)
      case 'combo': { const k = this.phase === 2 ? 0.88 : 1; this.comboT = [0.8 * k, 1.42 * k, 2.55 * k]; this.impactAt = this.comboT[0]; this.dur = this.comboT[2] + 1.1; this.setDecal(2, 8, 0, 1.45); break; }
      case 'pillars': this.dur = 3.6; this.volley = 0; this.G.Audio.sfx('glide'); break;
      case 'clash': this.dur = 9; break;
      case 'walk': this.dur = 1.5 + Math.random() * 1.5; break;
      case 'idle': this.dur = 0.6 + Math.random() * 0.5; break;
    }
  }
  setDecal(mode, sx, fwd, ang) {
    const d = this.decal;
    d.visible = true; d.material.uniforms.uMode.value = mode; d.material.uniforms.uAng.value = ang; d.material.uniforms.uFill.value = 0;
    d.userData = { mode, sx, fwd };
  }
  updateDecal() {
    const d = this.decal; if (!d.visible) return;
    const u = d.material.uniforms, { mode, sx, fwd } = d.userData;
    const t0 = this.segT0 || 0, k = clamp((this.t - t0) / Math.max(0.01, this.impactAt - t0), 0, 1);
    u.uFill.value = k; u.uAlpha.value = Math.min(1, (this.t - t0) * 4);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (mode === 2) { d.scale.set(sx, sx, 1); d.position.set(this.pos.x, 0, this.pos.z); d.rotation.set(-Math.PI / 2, 0, this.yaw + Math.PI); }
    else if (mode === 1) { d.scale.set(sx, fwd, 1); d.position.set(this.pos.x + fx * fwd, 0, this.pos.z + fz * fwd); d.rotation.set(-Math.PI / 2, 0, this.yaw + Math.PI); }
    else { d.scale.set(sx, sx, 1); }
    d.position.y = this.gnd(d.position.x, d.position.z) + 0.25;
  }
  purify(silent) {
    // the warden turns back into a white marble statue, kneeling
    this.st = 'purified'; this.dead = true; this.engaged = false;
    const marble = new THREE.MeshStandardMaterial({ color: '#efeae0', map: TEX.marble, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d7b468', metalness: 0.9, roughness: 0.3 });
    const feather = new THREE.MeshStandardMaterial({ color: '#ece8df', map: TEX.feather, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
    const swap = (m) => (m.map === TEX.feather ? feather : m.metalness > 0.8 ? gold : marble);
    this.actor.root.traverse((o) => { if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
    for (const c of this.actor.cloths) c.mesh.material = marble;
    this.pos.copy(this.home);
    const T = Object.assign({}, BASE, { hipY: 0.52, thL: -1.35, knL: 1.45, thR: 0.25, knR: 1.75, hipX: 0.05, tX: 0.32, hX: 0.55, sRx: -0.55, eR: -0.7, sLx: -0.55, sLz: -0.15, eL: -0.75, fold: 0.15, wScale: 1.05, wLift: 0.25 });
    this.c = T;
    if (!silent) { this.G.ui.bar.classList.add('hidden'); document.body.classList.remove('boss'); }
  }
  die() {
    const G = this.G;
    this.hp = 0; this.go('dying'); this.dur = 3.2;
    G.Audio.sfx('boss'); G.shake(0.6);
    G.bigText('淨化', 'WARDEN PURIFIED');
    if (G.P.lock === this) G.P.lock = null;
  }
  pickAction() {
    const P = this.G.P;
    const L = this.local(P.pos);
    const r = Math.random(), p2 = this.phase === 2;
    const fly = !this.parts.wings.broken, halo = !this.parts.head.broken; // broken wings can't carry it; a broken halo can't ring
    if (L.d > 15) return fly && r < (p2 ? 0.55 : 0.4) ? (p2 && r < 0.25 ? 'barrage' : 'leap') : 'walk';
    if (L.d > 8 && (this.cfg.moves || []).includes('pillars') && this.lastAct !== 'pillars' && r < 0.4) return 'pillars';
    if (L.d > 8) return fly && p2 && r < 0.3 ? 'barrage' : fly && r < 0.55 ? 'leap' : 'walk';
    const mv = this.cfg.moves || [];
    if (mv.includes('pillars') && this.lastAct !== 'pillars' && r < 0.3) return 'pillars';
    if (p2 && halo && r < 0.28 && this.lastAct !== 'ring') return 'ring';
    if (mv.includes('combo') && this.lastAct !== 'combo' && Math.random() < 0.38) return 'combo';
    if (Math.abs(Math.atan2(L.l, L.f)) > 1.2) return 'sweep';
    return r < 0.55 ? 'sweep' : 'slam';
  }
  update(edt, dt) {
    const G = this.G, P = G.P, A = this.actor;
    const st = this.st;
    if (st === 'purified') { A.update(dt, { mode: 'boss', speed: 0, grounded: true, vy: 0, spMode: 'down' }, this.c); this.place(); return; }
    this.t += edt;
    this.flash = Math.max(0, (this.flash || 0) - dt);
    const L = this.local(P.pos);
    const toYaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    const p2 = this.phase === 2;
    const T = Object.assign({}, BASE);
    let spMode = 'arm', rate = 6, moveSp = 0, turn = 0;
    const gy = this.gnd(this.pos.x, this.pos.z);

    if (st === 'dormant') {
      Object.assign(T, { hipY: 0.52, thL: -1.35, knL: 1.45, thR: 0.25, knR: 1.75, hipX: 0.05, tX: 0.32, hX: 0.55, sRx: -0.55, eR: -0.7, sLx: -0.55, sLz: -0.15, eL: -0.75, fold: 0.2, wScale: 1.0, wLift: 0.2 });
      spMode = 'down';
      if (G.state() === 'play' && Math.hypot(P.pos.x - this.home.x, P.pos.z - this.home.z) < 24 && Math.abs(P.pos.y - this.home.y) < 10) {
        this.go('intro'); this.engaged = true; G.Audio.sfx('roar'); G.Audio.sfx('boss');
        G.ui.bar.classList.remove('hidden'); document.body.classList.add('boss');
        G.regionCard(this.cfg.name, this.cfg.en); document.getElementById('bossName').textContent = this.cfg.name; document.getElementById('bossEn').textContent = this.cfg.en;
      }
    } else if (st === 'intro') {
      const k = easeInOut(clamp(this.t / 2.2, 0, 1));
      Object.assign(T, { hipY: lerp(0.52, 0.95, k), thL: lerp(-1.35, 0, k), knL: lerp(1.45, 0.05, k), thR: lerp(0.25, 0, k), knR: lerp(1.75, 0.05, k), tX: lerp(0.32, -0.3, k), hX: lerp(0.55, -0.5, k), sLz: lerp(-0.15, 1.1, k), sRz: lerp(-0.35, -1.1, k), fold: lerp(0.2, -0.15, k), wScale: 1.15, wLift: 0.35 * k });
      spMode = 'down'; rate = 4; turn = 0.8;
      if (this.t > 1.2 && this.t - edt <= 1.2) { G.shake(0.6); G.burst(G.FX.smoke, this.pos.x, gy + 1, this.pos.z, 40, { speed: 6, up: 1, life: 1.4, size: 4, c: [0.1, 0.08, 0.12], g: 0.3 }); }
      if (this.cfg.line && this.t > 1.5 && this.t - edt <= 1.5) G.say && G.say(this.cfg.line);
      if (this.t > 2.6) { this.go('idle'); if (!this.cfg.line) G.toast('<i class="dia"></i>按「鎖定」對準守衛 · 留意地面的警示'); }
    } else if (st === 'idle' || st === 'walk') {
      turn = 2.0;
      if (st === 'walk') { moveSp = (p2 ? 3.0 : 2.4) * (L.d > 5 ? 1 : 0); }
      const ph = this.t * 3.2;
      const amp = moveSp > 0 ? 0.6 : 0;
      Object.assign(T, { thL: -Math.sin(ph) * 0.5 * amp, thR: Math.sin(ph) * 0.5 * amp, knL: Math.max(0, Math.sin(ph + 1.3)) * 0.8 * amp + 0.05, knR: Math.max(0, -Math.sin(ph + 1.3)) * 0.8 * amp + 0.05, hipY: 0.95 - Math.abs(Math.cos(ph)) * 0.03 * amp, tX: 0.12, tY: Math.sin(ph) * 0.08 * amp });
      this.cd -= edt;
      if (this.t > this.dur || (st === 'walk' && L.d < 6.5)) {
        if (this.cd <= 0) { const a = this.pickAction(); this.lastAct = a; this.go(a); this.cd = p2 ? 0.25 : 0.6; }
        else this.go(L.d > 6.5 ? 'walk' : 'idle');
      }
    } else if (st === 'sweep') {
      const w = this.impactAt;
      turn = this.t < w * 0.75 ? 1.6 : 0;
      const k = easeOut(clamp((this.t - w) / 0.2, 0, 1)), pre = clamp(this.t / w, 0, 1);
      Object.assign(T, { tY: lerp(lerp(0, -1.1, pre), 1.0, k), sRx: lerp(-1.0, -1.45, k), sRz: lerp(lerp(-0.4, -1.35, pre), 0.25, k), eR: -0.25, sLx: -0.5, sLz: 0.6, thL: -0.45, thR: 0.35, knL: 0.3, knR: 0.35, hipY: 0.88, tX: 0.15 });
      rate = this.t > w ? 26 : 8;
      if (!this.hitDone && this.t >= w) { this.hitDone = true; this.decal.visible = false; G.Audio.sfx('swing'); if (this.inArea(P.pos)) G.hurtPlayer(24, this.pos); G.shake(0.15); }
      if (this.t > this.dur) this.go('idle');
    } else if (st === 'slam' || st === 'ring') {
      const w = this.impactAt;
      turn = this.t < w * 0.7 ? 1.4 : 0;
      const k = easeOut(clamp((this.t - w) / 0.12, 0, 1)), pre = easeInOut(clamp(this.t / w, 0, 1));
      Object.assign(T, { sRx: lerp(lerp(-0.5, -2.9, pre), -1.05, k), sLx: lerp(lerp(-0.3, -2.7, pre), -1.0, k), sRz: -0.15, sLz: 0.15, eR: -0.2, eL: -0.3, tX: lerp(lerp(0.1, -0.3, pre), 0.55, k), hX: lerp(-0.3, 0.3, k), hipY: lerp(0.95, 0.74, k), thL: -0.6 * k, knL: 0.7 * k, thR: 0.35, knR: 0.5 * k, fold: lerp(0.5, 0.0, pre), wScale: 1.1 });
      rate = this.t > w ? 30 : 7;
      if (!this.hitDone && this.t >= w) {
        this.hitDone = true; this.decal.visible = false; G.Audio.sfx('slam'); G.shake(0.55);
        if (st === 'slam' && this.inArea(P.pos)) G.hurtPlayer(30, this.pos);
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        for (let i = 1; i <= 8; i++) { const x = this.pos.x + fx * i * 1.3, z = this.pos.z + fz * i * 1.3; setTimeout(() => G.burst(G.FX.smoke, x, this.gnd(x, z) + 0.3, z, 6, { speed: 3, up: 2, life: 0.9, size: 2.4, c: [0.15, 0.1, 0.16], g: 0.4 }), i * 25); }
        G.burst(G.FX.sparks, this.pos.x + fx * 6, gy + 0.5, this.pos.z + fz * 6, 40, { speed: 7, up: 2, life: 0.8, size: 1.1, c: [1.8, 0.9, 1.4] });
        if (st === 'ring') { this.ring.on = true; this.ring.r = 1; this.ring.hit = false; this.ring.center.set(this.pos.x, gy, this.pos.z); this.decal.visible = false; }
      }
      if (this.ring.on) {
        this.ring.r += edt * 13;
        const rm = this.ringMesh; rm.visible = true; rm.position.set(this.ring.center.x, this.ring.center.y + 0.15, this.ring.center.z); rm.scale.set(this.ring.r, this.ring.r, 1);
        rm.material.opacity = clamp(1 - this.ring.r / 22, 0, 1);
        rm.children[0].scale.set(1, 1, 1);
        const pd = Math.hypot(P.pos.x - this.ring.center.x, P.pos.z - this.ring.center.z);
        if (!this.ring.hit && Math.abs(pd - this.ring.r) < 0.8 && P.pos.y - this.gnd(P.pos.x, P.pos.z) < 1.1) { this.ring.hit = true; G.hurtPlayer(22, this.ring.center); }
        if (this.ring.r > 22) { this.ring.on = false; rm.visible = false; }
      }
      if (this.t > this.dur) { this.ring.on = false; this.ringMesh.visible = false; this.go('idle'); }
    } else if (st === 'leap') {
      const crouch = 0.7 * (p2 ? 0.85 : 1), air = 0.9;
      if (this.t < crouch) {
        turn = 3;
        const k = this.t / crouch;
        Object.assign(T, { hipY: lerp(0.95, 0.68, k), thL: -0.9 * k, thR: -0.9 * k, knL: 1.5 * k, knR: 1.5 * k, tX: 0.45 * k, sRx: -2.4 * k, sLx: -1.2 * k, fold: lerp(0.5, -0.1, k), wScale: 1.15 });
        if (this.t < crouch * 0.7) { this.leapTo.set(P.pos.x, 0, P.pos.z); this.leapTo.y = this.gnd(this.leapTo.x, this.leapTo.z); }
        this.setDecalCircle();
      } else if (this.t < crouch + air) {
        const k = (this.t - crouch) / air;
        this.pos.x = lerp(this.leapFrom.x, this.leapTo.x, easeInOut(k)); this.pos.z = lerp(this.leapFrom.z, this.leapTo.z, easeInOut(k));
        const base = lerp(this.leapFrom.y, this.leapTo.y, k);
        this.pos.y = base + Math.sin(k * Math.PI) * 11;
        Object.assign(T, { hipY: 0.95, thL: -0.6, thR: -0.3, knL: 1.0, knR: 0.8, tX: -0.1, sRx: -2.9, sLx: -2.6, eR: -0.2, fold: -0.15, wScale: 1.25, wLift: 0.3 });
        this.setDecalCircle();
        this.yaw = dampAngle(this.yaw, Math.atan2(this.leapTo.x - this.leapFrom.x, this.leapTo.z - this.leapFrom.z), 6, edt);
      } else {
        if (!this.hitDone) {
          this.hitDone = true; this.pos.y = this.leapTo.y; this.decal.visible = false;
          G.Audio.sfx('slam'); G.shake(0.7);
          if (Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) < 4.8 && P.pos.y - this.pos.y < 2.5) G.hurtPlayer(30, this.pos);
          G.burst(G.FX.smoke, this.pos.x, this.pos.y + 0.5, this.pos.z, 50, { speed: 8, up: 1, life: 1.2, size: 3.5, c: [0.12, 0.09, 0.14], g: 0.2 });
          G.burst(G.FX.sparks, this.pos.x, this.pos.y + 0.5, this.pos.z, 40, { speed: 9, up: 2, life: 0.8, size: 1.1, c: [1.8, 0.9, 1.4] });
        }
        const k = easeOut(clamp((this.t - crouch - air) / 0.15, 0, 1));
        Object.assign(T, { hipY: lerp(0.95, 0.7, k), thL: -0.8, knL: 1.2, thR: 0.3, knR: 1.0, tX: 0.6, sRx: -1.0, sLx: -1.0, hX: 0.3, fold: 0.1 });
        if (this.t > this.dur) this.go('idle');
      }
      rate = 14;
    } else if (st === 'barrage') {
      turn = 2.5;
      const hover = Math.min(1, this.t / 0.5) * (this.t > 2.5 ? Math.max(0, (3 - this.t) / 0.5) : 1);
      this.pos.y = gy + hover * 2.5;
      Object.assign(T, { hipY: 0.95, thL: 0.2, thR: 0.3, knL: 0.3, knR: 0.4, tX: -0.1, hX: -0.15, sLx: -1.5, sLz: 0.5, eL: -0.1, sRx: -0.4, sRz: -0.6, fold: -0.18, wScale: 1.3, wLift: 0.45, flap: Math.sin(this.t * 6) * 0.1 });
      const times = [0.7, 1.3, 1.9];
      if (this.volley < 3 && this.t > times[this.volley]) {
        this.volley++;
        const from = new THREE.Vector3(this.pos.x, this.pos.y + 6, this.pos.z);
        for (let i = -2; i <= 2; i++) {
          const a = toYaw + i * 0.16;
          const to = new THREE.Vector3(this.pos.x + Math.sin(a) * L.d, P.pos.y + 1, this.pos.z + Math.cos(a) * L.d);
          G.fireProjectile(from.clone(), to, 19, 14);
        }
        G.Audio.sfx('glide');
      }
      if (this.t > this.dur) { this.pos.y = gy; this.go('idle'); }
    } else if (st === 'transform') {
      const k = clamp(this.t / 1.0, 0, 1);
      Object.assign(T, { tX: -0.35, hX: -0.65, sLz: 1.25, sRz: -1.25, sLx: -0.3, sRx: -0.3, eL: -0.1, eR: -0.1, fold: -0.2, wScale: 1.35, wLift: 0.5, hipY: 0.95 });
      if (this.t < 1.6 && Math.random() < 0.6) G.burst(G.FX.smoke, this.pos.x, this.pos.y + 4, this.pos.z, 3, { speed: 6, up: 1, life: 1.2, size: 3, c: [0.08, 0.06, 0.1], g: 0.2 });
      A.M.skin.emissiveIntensity = 1.5 + k * 2.2; A.M.dress.emissiveIntensity = 0.9 + k * 1.6;
      if (this.t > this.dur) { this.phase = 2; this.poise = 140; G.ui.bar.classList.add('p2'); this.go('idle'); }
    } else if (st === 'stagger') {
      // down on one knee and a hand, head low enough to reach
      const up = clamp((this.t - (this.dur - 0.7)) / 0.7, 0, 1);
      Object.assign(T, { hipY: lerp(0.5, 0.8, up), thL: -1.3, knL: 1.45, thR: 0.3, knR: 1.75, tX: lerp(0.75, 0.3, up), hX: lerp(0.7, 0.2, up), sRx: -0.3, eR: -0.3, sLx: lerp(-1.2, -0.4, up), sLz: 0.3, eL: -0.1, fold: 0.85, wScale: 0.85 });
      spMode = 'down'; rate = this.t < 0.3 ? 14 : 6;
      if (this.t > this.dur) this.go('idle');
    } else if (st === 'combo') {
      const H = this.comboT, i = this.hitIdx, prev = i ? H[i - 1] : 0;
      turn = this.t < H[Math.min(i, 2)] - 0.3 ? 2.0 : 0.3;
      const k = easeOut(clamp((this.t - prev) / 0.18, 0, 1)) * (i ? 1 : 0), pre = clamp((this.t - prev) / Math.max(0.01, H[Math.min(i, 2)] - prev), 0, 1);
      if (i < 2) { // the two sweeps, right then left
        const sgn = i === 0 ? 1 : -1, w = i === 0 ? 0 : 1;
        Object.assign(T, { tY: lerp(-1.1 * sgn, 1.0 * sgn, w ? easeOut(pre) * 0.0 : 0) , sRz: -0.4, sRx: -1.2, eR: -0.25, sLx: -0.5, sLz: 0.6, thL: -0.45, thR: 0.35, knL: 0.3, knR: 0.35, hipY: 0.88, tX: 0.15 });
        T.tY = i === 0 ? lerp(0, -1.1, pre) : lerp(1.0, -1.15, easeOut(pre));
        if (i === 1) T.sRz = lerp(0.25, -1.35, easeOut(pre));
        else T.sRz = lerp(-0.4, -1.35, pre);
      } else { // overhead: raised early, held, then down
        const up = easeInOut(clamp((this.t - H[1]) / 0.45, 0, 1)), dn = easeOut(clamp((this.t - H[2]) / 0.12, 0, 1));
        Object.assign(T, { sRx: lerp(lerp(-1.0, -2.95, up), -1.05, dn), sLx: lerp(lerp(-0.4, -2.7, up), -1.0, dn), sRz: -0.15, sLz: 0.15, eR: -0.2, eL: -0.3, tX: lerp(lerp(0.1, -0.35, up), 0.55, dn), hX: lerp(-0.3, 0.3, dn), hipY: lerp(0.95, 0.74, dn), thL: -0.6 * dn, knL: 0.7 * dn, thR: 0.35, knR: 0.5 * dn, wScale: 1.1 });
      }
      rate = this.t > H[Math.min(i, 2)] - 0.12 ? 26 : 9;
      if (i < 3 && this.t >= H[i]) {
        const L2 = this.local(P.pos), hitIt = i < 2 ? L2.d < 7.6 * this.reachK && L2.f > -1.5 && Math.abs(Math.atan2(L2.l, L2.f)) < 1.5 : L2.f > -1 && L2.f < 10 * this.reachK && Math.abs(L2.l) < 1.8;
        if (!this.hitDone && hitIt) G.hurtPlayer(i < 2 ? 18 : 28, this.pos);
        G.Audio.sfx(i < 2 ? 'swing' : 'slam'); G.shake(i < 2 ? 0.15 : 0.5);
        if (i === 2) { const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); G.burst(G.FX.sparks, this.pos.x + fx * 5, gy + 0.5, this.pos.z + fz * 5, 40, { speed: 7, up: 2, life: 0.8, size: 1.1, c: [1.8, 0.9, 1.4] }); }
        this.hitIdx = i + 1; this.hitDone = false; this.segT0 = H[i];
        if (i === 0) { this.impactAt = H[1]; this.setDecal(2, 8, 0, 1.45); }
        else if (i === 1) { this.impactAt = H[2]; this.setDecal(1, 1.8, 5.0, 0); }
        else { this.impactAt = 99; this.decal.visible = false; }
      }
      if (this.t > this.dur) this.go('idle');
    } else if (st === 'pillars') {
      // hover, spear raised: four pillars fall where you stand, each a beat after the last
      turn = 2.5;
      const hover = Math.min(1, this.t / 0.5) * (this.t > 3.1 ? Math.max(0, (3.6 - this.t) / 0.5) : 1);
      this.pos.y = gy + hover * 2.2;
      Object.assign(T, { hipY: 0.95, thL: 0.2, thR: 0.3, knL: 0.3, knR: 0.4, tX: -0.15, hX: -0.35, sRx: -2.9, sRz: -0.2, eR: -0.1, sLx: -1.3, sLz: 0.6, eL: -0.2, fold: -0.2, wScale: 1.3, wLift: 0.5, flap: Math.sin(this.t * 5) * 0.1 });
      spMode = 'arm';
      const n = this.pillars.length;
      if (this.volley < n && this.t > 0.55 + this.volley * 0.5) {
        const pl = this.pillars[this.volley++];
        pl.at.set(P.pos.x + P.vel.x * 0.25, 0, P.pos.z + P.vel.z * 0.25); pl.at.y = this.gnd(pl.at.x, pl.at.z);
        pl.t = 0; pl.hit = false; pl.tm.visible = true; pl.tm.position.set(pl.at.x, pl.at.y + 0.2, pl.at.z);
      }
      if (this.t > this.dur) { this.pos.y = gy; this.go('idle'); }
    } else if (st === 'flinch') {
      const k = Math.sin(clamp(this.t / this.dur, 0, 1) * Math.PI);
      Object.assign(T, { tX: -0.45 * k, hX: -0.55 * k, sLz: 0.4 + 0.8 * k, sRz: -0.4 - 0.8 * k, sLx: -0.3, sRx: -0.5, hipY: 0.95 - 0.08 * k, thL: 0.25 * k, knR: 0.4 * k, fold: 0.2, wScale: 1.1, wLift: 0.3 * k });
      rate = 12;
      if (this.t > this.dur) this.go('idle');
    } else if (st === 'clash') {
      // weapons locked: it bears down on you
      Object.assign(T, { sRx: -1.15, sLx: -1.05, sRz: -0.15, sLz: 0.15, eR: -0.3, eL: -0.35, tX: 0.5, hX: 0.25, hipY: 0.8, thL: -0.6, knL: 0.75, thR: 0.45, knR: 0.55, fold: 0.1, wScale: 1.2, wLift: 0.3 });
      rate = 10;
      if (Math.random() < 0.3) { this.anchor('weapon', _a); G.burst(G.FX.sparks, _a.x, _a.y, _a.z, 2, { speed: 4, up: 1, life: 0.4, size: 0.8, c: [2.2, 1.5, 0.7] }); }
    } else if (st === 'dying') {
      const k = clamp(this.t / 2.0, 0, 1);
      Object.assign(T, { hipY: lerp(0.95, 0.52, k), thL: -1.35 * k, knL: 1.45 * k, thR: 0.25, knR: 1.75 * k, tX: 0.32 + 0.2 * k, hX: 0.55 * k, sRx: -0.55, eR: -0.7, sLx: -0.55, sLz: -0.15, eL: -0.75, fold: 0.2, wScale: 1.0 });
      spMode = 'down'; rate = 3;
      if (Math.random() < 0.8) G.burst(G.FX.sparks, this.pos.x + (Math.random() - 0.5) * 3, this.pos.y + Math.random() * 7, this.pos.z + (Math.random() - 0.5) * 3, 2, { speed: 1, up: 3, life: 1.6, size: 1.2, c: [1.9, 1.7, 1.2], g: 0.5 });
      if (this.t > this.dur) {
        G.flash(1.2);
        this.purify(false);
        (this.cfg.onDefeated || G.onBossDefeated)();
      }
    }
    // turning + moving
    if (turn) this.yaw = dampAngle(this.yaw, toYaw, turn, edt);
    if (moveSp) { this.pos.x += Math.sin(this.yaw) * moveSp * edt; this.pos.z += Math.cos(this.yaw) * moveSp * edt; }
    if (st !== 'leap' && st !== 'barrage') this.pos.y = damp(this.pos.y, this.gnd(this.pos.x, this.pos.z), 10, edt);
    // leash
    if (this.engaged && (Math.hypot(P.pos.x - this.home.x, P.pos.z - this.home.z) > this.cfg.leash || P.pos.y < this.home.y - 30)) this.reset();
    if (this.cfg.arenaR) { const hx = this.pos.x - this.home.x, hz = this.pos.z - this.home.z, hd = Math.hypot(hx, hz); if (hd > this.cfg.arenaR) { this.pos.x = this.home.x + hx / hd * this.cfg.arenaR; this.pos.z = this.home.z + hz / hd * this.cfg.arenaR; } }
    // keep the player outside the body
    const pd = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    if (pd < 1.7 && pd > 0.01 && Math.abs(P.pos.y - this.pos.y) < 6) { P.pos.x = this.pos.x + (P.pos.x - this.pos.x) / pd * 1.7; P.pos.z = this.pos.z + (P.pos.z - this.pos.z) / pd * 1.7; }
    for (const pl of this.pillars) {
      if (pl.t < 0) continue;
      pl.t += edt;
      const R = 2.8, lead = 0.9;
      if (pl.t < lead) { const k = pl.t / lead; pl.tm.scale.setScalar(R); pl.fill.scale.setScalar(k); pl.tm.material.opacity = 0.5 + k * 0.5; this.threatAt = pl; }
      else if (!pl.hit) {
        pl.hit = true; pl.tm.visible = false; pl.beam.visible = true; pl.beam.position.copy(pl.at); pl.beam.scale.set(R * 0.75, 40, R * 0.75);
        G.Audio.sfx('slam'); G.shake(0.25);
        G.burst(G.FX.sparks, pl.at.x, pl.at.y + 0.5, pl.at.z, 36, { speed: 6, up: 6, life: 0.9, size: 1.2, c: [2.2, 1.8, 1.1] });
        if (Math.hypot(P.pos.x - pl.at.x, P.pos.z - pl.at.z) < R && P.pos.y - pl.at.y < 6) G.hurtPlayer(20, pl.at);
      } else if (pl.t < lead + 0.35) { pl.beam.material.opacity = 1 - (pl.t - lead) / 0.35; }
      else { pl.beam.visible = false; pl.t = -1; }
    }
    // wounds: a glowing gash on the part, brighter in focus mode; scars heal over time
    for (const p of Object.values(this.parts)) {
      if (p.scar > 0) p.scar -= edt;
      const on = p.wound && this.engaged && !this.dead;
      p.spr.visible = on;
      if (on) {
        this.anchor(p.k, p.spr.position);
        const f = G.P.focus ? 1 : 0, pulse = 0.75 + Math.sin(this.t * 7 + p.max) * 0.25;
        p.spr.scale.setScalar((1.3 + f * 0.8) * pulse * (this.cfg.scale / 3));
        p.spr.material.opacity = (0.55 + f * 0.45) * pulse;
      }
    }
    // pose
    for (const k of KEYS) this.c[k] = damp(this.c[k], T[k], rate, edt);
    this.updateDecal();
    this.place();
    A.M.skin.emissive.setScalar(this.flash > 0 ? 3 : 1).multiply(this.emisC);
    A.update(edt, { mode: 'boss', speed: moveSp, grounded: true, vy: 0, spMode, glide: false }, this.c);
    // boss bar
    this.hpShown = damp(this.hpShown, this.hp, this.hpShown > this.hp ? 2 : 20, dt);
    if (!this.engaged && this.st !== 'dying') return;
    G.ui.hp.style.transform = `scaleX(${clamp(this.hp / this.maxHp, 0, 1)})`;
    G.ui.hpD.style.transform = `scaleX(${clamp(this.hpShown / this.maxHp, 0, 1)})`;
  }
  setDecalCircle() {
    const d = this.decal;
    if (!d.visible) { d.visible = true; d.material.uniforms.uMode.value = 0; d.material.uniforms.uIn.value = 0; d.userData = { mode: 0, sx: 4.8, fwd: 0 }; }
    d.scale.set(4.8, 4.8, 1);
    d.position.set(this.leapTo.x, this.leapTo.y + 0.25, this.leapTo.z);
    d.material.uniforms.uFill.value = clamp(this.t / this.impactAt, 0, 1);
    d.material.uniforms.uAlpha.value = 1;
    d.rotation.set(-Math.PI / 2, 0, 0);
  }
  get pos2() { return this.pos; }
}
export function createBoss(G, cfg) { return new Boss(G, cfg); }
