// LUMENFALL · 同伴 · the party
// People met on the road (rescued from the crystal, or met holding a light against the dark) can be hired with bounty
// money. Up to four travel together: one under your hand (主控), the rest fight on their own. Each fights in their own way.
import * as THREE from 'three';
import { SeraphActor } from './seraph.js';
import { clamp, lerp, damp, dampAngle } from './core.js';

// ---------------------------------------------------------------- weapon forms: how each kind of weapon fights
export const FORMS = {
  sword: { name: '劍', en: 'SWORD', play: '均衡的斬擊，四段連擊，蓄力突刺', range: [1.6, 2.6] },
  greatsword: { name: '大劍', en: 'GREATSWORD', play: '慢而重的劈砍，迴旋斬，第四擊砸地', range: [2.0, 3.0] },
  spear: { name: '槍', en: 'LANCE', play: '最長的突刺，旋身橫掃，衝刺突擊', range: [2.4, 3.4] },
  bow: { name: '長弓', en: 'LONGBOW', play: '遠距離射擊；三連散射、穿透箭，蓄力一箭專射傷口', range: [11, 15] },
  hammer: { name: '鐘錘', en: 'BELL-MAUL', play: '最重的打擊，專打暈、打倒地；蓄力砸地震暈周圍', range: [1.8, 2.8] },
  dual: { name: '雙刃', en: 'TWIN BLADES', play: '最快的連斬，一下兩刀；蓄力是十連亂舞', range: [1.3, 2.2] },
  censer: { name: '香爐杖', en: 'CENSER STAFF', play: '揮杖打擊，第四擊放出療癒的光；蓄力為全隊回復', range: [2.4, 4.5] },
  pick: { name: '爆破鎬', en: 'BLASTING PICK', play: '埋炸藥、點燃草地（第二期）', range: [1.6, 2.6] },
  lantern: { name: '提燈', en: 'LANTERN', play: '聖光閃盲、淨化瘴氣（第二期）', range: [5, 8] },
};
// the companions' own attack tables (the three old forms live in main.js)
const ARC_SW = (rev) => ({ t0: 2.2, len: 3.5, rev, tilt: [-0.22, 0, rev ? 0.58 : -0.55] }), ARC_GS = (rev) => ({ t0: 2.5, len: 4.1, rev, tilt: [-0.55, 0, rev ? 0.7 : -0.75] });
const SPIN = { t0: 0, len: 6.2, rev: 0, tilt: [0, 0, 0] }, BIG = { t0: 2.0, len: 3.9, rev: 0, tilt: [-1.0, 0, 0.25] };
export const FORM_ATK = {
  bow: {
    l0: { dur: 0.6, hits: [0.3], dmg: [34, 40], reach: 30, cone: -2, lunge: -1.5, poise: 6, shoot: { n: 1, spd: 48 }, sfx: 'thrust' },
    l1: { dur: 0.55, hits: [0.26], dmg: [34, 40], reach: 30, cone: -2, lunge: -1.5, poise: 6, shoot: { n: 1, spd: 48 }, sfx: 'thrust' },
    l2: { dur: 0.85, hits: [0.36], dmg: [24, 29], reach: 30, cone: -2, lunge: -3, poise: 5, shoot: { n: 3, spd: 44, spread: 0.13 }, sfx: 'thrust' },
    l3: { dur: 1.0, hits: [0.52], dmg: [82, 94], reach: 34, cone: -2, lunge: -2, poise: 22, shoot: { n: 1, spd: 66, pierce: true, big: true }, sfx: 'skill' },
    heavy: { dur: 1.05, hits: [0.5], dmg: [140, 160], reach: 40, cone: -2, lunge: 0, poise: 30, shoot: { n: 1, spd: 78, pierce: true, big: true, wound: 1.6 }, sfx: 'skill' },
    counter: { dur: 0.85, hits: [0.18, 0.32, 0.46], dmg: [48, 56], reach: 30, cone: -2, lunge: -4, poise: 14, shoot: { n: 1, spd: 56 }, sfx: 'skill' },
    focus: { dur: 0.95, hits: [0.45], dmg: [115, 130], reach: 40, cone: -2, lunge: 0, poise: 30, shoot: { n: 1, spd: 80, pierce: true, big: true, wound: 1.8 }, sfx: 'skill' },
  },
  hammer: {
    l0: { dur: 1.0, hits: [0.48], dmg: [84, 96], reach: 3.7, cone: -0.25, lunge: 2.4, poise: 34, heavyHit: true, arc: ARC_GS(0), sfx: 'cleave' },
    l1: { dur: 0.98, hits: [0.46], dmg: [84, 96], reach: 3.7, cone: -0.25, lunge: 2.4, poise: 34, heavyHit: true, arc: ARC_GS(1), sfx: 'cleave' },
    l2: { dur: 1.4, hits: [0.55, 0.85], dmg: [60, 70], reach: 4.2, cone: -2, lunge: 1.4, poise: 26, heavyHit: true, spin: true, arc: SPIN, sfx: 'cleave' },
    l3: { dur: 1.45, hits: [0.74], dmg: [160, 180], reach: 2.4, cone: -2, lunge: 3, poise: 80, slam: 5.0, sfx: 'cleave' },
    heavy: { dur: 1.45, hits: [0.52], dmg: [200, 225], reach: 2.6, cone: -2, lunge: 10, poise: 110, slam: 6.6, sfx: 'cleave' },
    counter: { dur: 1.2, hits: [0.42], dmg: [230, 260], reach: 5.2, cone: -0.45, lunge: 5, poise: 90, heavyHit: true, arc: BIG, sfx: 'skill' },
    focus: { dur: 1.2, hits: [0.46], dmg: [100, 115], reach: 6.5, cone: -2, lunge: 14, poise: 60, heavyHit: true, arc: BIG, sfx: 'skill' },
  },
  dual: {
    l0: { dur: 0.42, hits: [0.12, 0.24], dmg: [17, 21], reach: 2.9, cone: 0.05, lunge: 3.4, poise: 3, arc: ARC_SW(0), sfx: 'slash' },
    l1: { dur: 0.44, hits: [0.1, 0.19, 0.29], dmg: [15, 19], reach: 2.9, cone: 0.05, lunge: 3.4, poise: 3, arc: ARC_SW(1), sfx: 'slash' },
    l2: { dur: 0.7, hits: [0.12, 0.24, 0.36, 0.48], dmg: [15, 18], reach: 3.1, cone: -2, lunge: 2, poise: 3, spin: true, arc: SPIN, sfx: 'swing' },
    l3: { dur: 0.85, hits: [0.12, 0.22, 0.32, 0.42, 0.52, 0.62], dmg: [14, 17], reach: 3.1, cone: 0.1, lunge: 10, poise: 4, sfx: 'slash' },
    heavy: { dur: 1.15, hits: [0.1, 0.19, 0.28, 0.37, 0.46, 0.55, 0.64, 0.73, 0.82, 0.92], dmg: [17, 21], reach: 3.2, cone: -0.2, lunge: 8, poise: 4, sfx: 'slash' },
    counter: { dur: 0.9, hits: [0.18, 0.3, 0.42, 0.54], dmg: [40, 46], reach: 4, cone: -0.45, lunge: 6, poise: 12, arc: BIG, sfx: 'skill' },
    focus: { dur: 0.95, hits: [0.3, 0.42, 0.54], dmg: [42, 48], reach: 6.5, cone: -2, lunge: 14, poise: 12, heavyHit: true, arc: BIG, sfx: 'skill' },
  },
  censer: {
    l0: { dur: 0.62, hits: [0.26], dmg: [30, 36], reach: 3.3, cone: -0.15, lunge: 2.4, poise: 9, arc: ARC_SW(0), sfx: 'swing' },
    l1: { dur: 0.62, hits: [0.26], dmg: [30, 36], reach: 3.3, cone: -0.15, lunge: 2.4, poise: 9, arc: ARC_SW(1), sfx: 'swing' },
    l2: { dur: 0.9, hits: [0.32, 0.52], dmg: [26, 31], reach: 3.6, cone: -2, lunge: 1.4, poise: 9, spin: true, arc: SPIN, sfx: 'swing' },
    l3: { dur: 1.0, hits: [0.5], dmg: [42, 50], reach: 5.5, cone: -2, lunge: 0, poise: 14, pulse: 0.08, sfx: 'skill' },
    heavy: { dur: 1.1, hits: [0.55], dmg: [0, 0], reach: 0, cone: -2, lunge: 0, poise: 0, heal: 0.3, sfx: 'skill' },
    counter: { dur: 0.95, hits: [0.3], dmg: [110, 125], reach: 4.8, cone: -0.45, lunge: 5, poise: 30, arc: BIG, sfx: 'skill' },
    focus: { dur: 0.95, hits: [0.36], dmg: [65, 75], reach: 6.5, cone: -2, lunge: 14, poise: 26, heavyHit: true, arc: BIG, sfx: 'skill' },
  },
};
FORM_ATK.pick = FORM_ATK.hammer; FORM_ATK.lantern = FORM_ATK.censer; // placeholders until their own kits arrive

// ---------------------------------------------------------------- the cast
// look: the same dressing-room terms the hero uses, plus a frame (sex, height, girth); meet: where you first meet them
export const CHARS = {
  lian: { name: '黎恩', en: 'LIAN', rar: '主角', sex: 'm', job: '半天使', role: '全能 · 能滑翔', form: 'sword', weapon: 'sword', wings: true, atk: 1, cost: 0,
    perk: '唯一能用天樞之劍斬傷地獄之物 · 能展翼滑翔', line: '' },
  isera: { name: '伊瑟拉', en: 'ISERA', rar: 'UR', sex: 'f', job: '守望天使', role: '遠程 · 狙擊傷口', form: 'bow', weapon: 'bow', wings: true, atk: 1.15, cost: 2400,
    look: { outfit: 'watcher', hair: 'long', hairCol: '#e8e4da', skin: '#f6e2d4', eye: '#b48a3a', height: 1.08, build: -0.6, cape: 'none', cols: { dress: '#f7f2e8', leather: '#d8b46a', white: '#ece6d9' } },
    meet: { vigils: 3 }, perk: '蓄力一箭對傷口傷害 ×1.6 · 能展翼滑翔', line: '守望者從來沒有離開——我們只是在等一個看得見我們的人。' },
  gareth: { name: '加雷斯', en: 'GARETH', rar: 'SSR', sex: 'm', job: '晨鐘堡最後的騎士', role: '前線 · 破盾', form: 'greatsword', weapon: 'greatsword', atk: 1.05, cost: 1100,
    look: { outfit: 'knight', hair: 'short', hairCol: '#8a8580', skin: '#e2b896', eye: '#3b5a7a', height: 1.12, build: 0.9, beard: true, cape: 'long', capeCol: '#2c3d6b' },
    meet: { captive: 'cRuins' }, perk: '大劍重擊能擊破守衛的盾 · 站在最前面', line: '騎士團沒了，誓言還在。讓我走在你前面。' },
  bran: { name: '布蘭修士', en: 'BROTHER BRAN', rar: 'SSR', sex: 'm', job: '霜脊修道院的鐘守', role: '打暈 · 打倒地', form: 'hammer', weapon: 'hammer', atk: 1.05, cost: 1100,
    look: { outfit: 'watcher', hair: 'none', skin: '#e2b896', eye: '#3d2c22', height: 1.0, build: 1.0, belly: 1, beard: true, cape: 'none', cols: { dress: '#7a5a3e', leather: '#3c2a1c', white: '#5d4a38' }, noPendant: true },
    meet: { beacon: 'bAbbey' }, perk: '削韌最高：最快把首領打暈、打倒地', line: '鐘聲一響，邪物就要退後。我這把錘，就是一口會走路的鐘。' },
  kasha: { name: '卡莎', en: 'KASHA', rar: 'SSR', sex: 'f', job: '守燈人的女兒', role: '中距 · 控制', form: 'spear', weapon: 'keeper', atk: 1, cost: 1000,
    look: { outfit: 'hunter', hair: 'tied', hairCol: '#9a3a1e', skin: '#d9a57e', eye: '#3f6a48', height: 0.92, build: 0.45, cape: 'none', cols: { dress: '#2d4462', leather: '#e8e2d2', white: '#3b3f48' } },
    meet: { beacon: 'bHarbor' }, perk: '用阿爸的魚叉：攻擊距離最長（第二期：擲叉拉怪、鎖住首領）', line: '阿爸說燈塔不能熄。現在換我去點亮別處的燈。' },
  mira: { name: '米菈', en: 'MIRA', rar: 'SR', sex: 'f', job: '麥原獵人', role: '高速輸出', form: 'dual', weapon: 'dual', atk: 0.95, cost: 450,
    look: { outfit: 'hunter', hair: 'tied', hairCol: '#24201f', skin: '#f1dccf', eye: '#3d2c22', height: 0.88, build: -0.55, cape: 'none' },
    meet: { captive: 'cField' }, perk: '出手最快 · 一下兩刀 · 蓄力十連亂舞', line: '我追蹤瘴獸三年了。你飛得比牠們快，我跟得上。' },
  rosa: { name: '蘿絲', en: 'ROSA', rar: 'SR', sex: 'f', job: '低語森林的採藥人', role: '支援 · 回復', form: 'censer', weapon: 'censer', atk: 0.85, cost: 500,
    look: { outfit: 'watcher', hair: 'long', hairCol: '#7a3a24', skin: '#f6e2d4', eye: '#3f6a48', height: 0.97, build: 0.5, belly: 0.55, cape: 'none', cols: { dress: '#7c8a5a', leather: '#5a4630', white: '#e2d9c4' } },
    meet: { captive: 'cWood' }, perk: '主控生命低於一半時，自動為全隊回復', line: '森林叫我不要睡著——原來是要我等你。' },
  dak: { name: '達克', en: 'DAK', rar: 'SR', sex: 'm', job: '裂谷礦工', role: '爆破 · 火', form: 'pick', weapon: 'pick', atk: 1, cost: 450, soon: true,
    look: { outfit: 'hunter', hair: 'short', hairCol: '#4a3a30', skin: '#c99572', eye: '#1e1c22', height: 0.86, build: 1.0, beard: true, cape: 'none', cols: { dress: '#6a5a48', leather: '#3a2e24', white: '#4a4038' } },
    meet: { captive: 'cRift' }, perk: '埋炸藥、點燃草地（第二期加入）', line: '裂谷在叫我的名字？那我就把它炸開，看看是誰在叫。' },
  owen: { name: '歐文', en: 'OWEN', rar: 'SR', sex: 'm', job: '沼澤的提燈人', role: '閃盲 · 淨化', form: 'lantern', weapon: 'lantern', atk: 0.9, cost: 450, soon: true,
    look: { outfit: 'watcher', hair: 'short', hairCol: '#c8c4bc', skin: '#e2b896', eye: '#4d5a70', height: 1.1, build: -0.75, beard: true, cape: 'long', capeCol: '#25242b', cols: { dress: '#3a3a40', leather: '#5a4a38', white: '#2e2d33' } },
    meet: { captive: 'cSwampB' }, perk: '聖光閃盲首領、淨化瘴氣（第二期加入）', line: '我的燈以為再也點不著了。你點著了它——它跟你走。' },
};
export const CHAR_ORDER = ['lian', 'isera', 'gareth', 'bran', 'kasha', 'mira', 'rosa', 'dak', 'owen'];
export const RAR_COL = { UR: '#d9a63c', SSR: '#c99a52', SR: '#8aa0b8', 主角: '#b88a3c' };

// a little bust portrait drawn from the character's own colours and frame (hair, skin, girth)
export function avatarSVG(id, size = 120) {
  const c = CHARS[id], L = Object.assign({ hairCol: '#5b4434', skin: '#f1dccf', outfit: 'belldawn', build: 0, belly: 0 }, c.look || {}, id === 'lian' ? (globalThis.__lfLook || {}) : {});
  const body = (L.cols && L.cols.dress) || { belldawn: '#ece4d2', knight: '#3d4b70', watcher: '#f5f0e6', hunter: '#5b6a48' }[L.outfit] || '#ece4d2';
  const trim = (L.cols && L.cols.leather) || { belldawn: '#6e5038', knight: '#d6dae2', watcher: '#b7955c', hunter: '#4c3a2a' }[L.outfit] || '#6e5038';
  const w = 30 + (L.build || 0) * 9 + (L.belly || 0) * 8, sh = c.sex === 'f' ? w - 4 : w, hr = L.hair || 'short';
  const hair = hr === 'none' ? '' : hr === 'long' ? `<path d="M38 50c0-18 10-28 22-28s22 10 22 28v34c-6 4-10 4-14 0V52H52v32c-4 4-8 4-14 0z" fill="${L.hairCol}"/>`
    : hr === 'tied' ? `<path d="M40 48c0-16 9-24 20-24s20 8 20 24c-4-6-10-9-20-9s-16 3-20 9z" fill="${L.hairCol}"/><circle cx="60" cy="24" r="7" fill="${L.hairCol}"/>`
    : `<path d="M40 50c0-17 9-26 20-26s20 9 20 26c-3-8-10-12-20-12s-17 4-20 12z" fill="${L.hairCol}"/>`;
  const beard = L.beard ? `<path d="M48 58c2 12 7 17 12 17s10-5 12-17c-4 5-8 6-12 6s-8-1-12-6z" fill="${L.hairCol}"/>` : '';
  // inline styles so the reliquary's line-icon styling can't wash the colours out
  const out = `<svg viewBox="0 0 120 120" width="${size}" height="${size}"><path d="M${60 - sh} 120c0-26 ${sh * 0.5} -38 ${sh} -38s${sh} 12 ${sh} 38z" fill="${body}"/><path d="M${60 - sh * 0.45} 86h${sh * 0.9}" stroke="${trim}" stroke-width="5"/>` +
    `<rect x="54" y="66" width="12" height="14" fill="${L.skin}"/><ellipse cx="60" cy="52" rx="${c.sex === 'f' ? 17 : 18}" ry="21" fill="${L.skin}"/>${hair}${beard}` +
    `<circle cx="53.5" cy="53" r="2" fill="#2a2420"/><circle cx="66.5" cy="53" r="2" fill="#2a2420"/></svg>`;
  return out.replace(/ fill="([^"]+)"/g, ' style="fill:$1;stroke:none"').replace(/ stroke="([^"]+)" stroke-width="([^"]+)"/g, ' style="fill:none;stroke:$1;stroke-width:$2"');
}

// ---------------------------------------------------------------- the party in the world
export function createParty(G) {
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const allies = [];
  // arrows (the player's and the companions'): a shaft of light that flies, falls a little, and strikes
  const arrows = [];
  const shaftG = new THREE.CylinderGeometry(0.018, 0.018, 1, 5); shaftG.rotateX(Math.PI / 2);
  const shaftM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.5) });
  for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(shaftG, shaftM); m.visible = false; m.frustumCulled = false; G.scene.add(m); arrows.push({ m, on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), hit: new Set() }); }
  function shoot(from, dir, o) {
    const a = arrows.find((x) => !x.on) || arrows[0];
    a.on = true; a.pos.copy(from); a.vel.copy(dir).normalize().multiplyScalar(o.spd); a.life = 1.4; a.hit.clear();
    a.dmg = o.dmg; a.poise = o.poise; a.pierce = !!o.pierce; a.big = !!o.big; a.wound = o.wound || 1; a.from = o.from || 'p'; a.kind = o.kind || '';
    a.m.visible = true; a.m.scale.set(a.big ? 2.2 : 1.3, a.big ? 2.2 : 1.3, a.big ? 1.6 : 1.1);
  }
  function updateArrows(dt) {
    for (const a of arrows) {
      if (!a.on) continue;
      a.life -= dt; a.vel.y -= 4 * dt;
      const p0 = _w.copy(a.pos); a.pos.addScaledVector(a.vel, dt);
      a.m.position.copy(a.pos); a.m.lookAt(_v.copy(a.pos).add(a.vel));
      if (Math.random() < 0.7) G.emit(G.FX.sparks, { x: a.pos.x, y: a.pos.y, z: a.pos.z, life: 0.25, s: a.big ? 0.9 : 0.5, c: a.big ? [2.4, 1.9, 1.1] : [1.9, 1.8, 1.4] });
      let done = a.life <= 0;
      for (const e of G.enemies()) {
        if (a.hit.has(e)) continue;
        const hy = e.isBoss ? 3.2 : (e.hy || 2) * 0.5, r = (e.r || 0.6) + (a.big ? 0.7 : 0.45);
        // closest approach of this step's segment to the target's core
        const cx = e.pos.x, cy = e.pos.y + hy, cz = e.pos.z, sx = a.pos.x - p0.x, sy = a.pos.y - p0.y, sz = a.pos.z - p0.z, L2 = sx * sx + sy * sy + sz * sz || 1e-6;
        const t = clamp(((cx - p0.x) * sx + (cy - p0.y) * sy + (cz - p0.z) * sz) / L2, 0, 1);
        const qx = p0.x + sx * t - cx, qy = p0.y + sy * t - cy, qz = p0.z + sz * t - cz;
        if (qx * qx + qz * qz > r * r || Math.abs(qy) > hy + 1.2) continue;
        a.hit.add(e);
        G.strike(e, a.dmg * (e.isBoss ? a.wound : 1), a.poise, a.big ? 'crit' : '', p0.clone(), a.from === 'p');
        G.burst(G.FX.sparks, p0.x + sx * t, p0.y + sy * t, p0.z + sz * t, a.big ? 18 : 8, { speed: 4, up: 1, life: 0.4, size: 0.8, c: [2.2, 1.9, 1.3] });
        if (!a.pierce) { done = true; break; }
      }
      if (!done && a.pos.y < G.support(a.pos.x, a.pos.z, a.pos.y + 0.5).h) { done = true; G.burst(G.FX.sparks, a.pos.x, a.pos.y, a.pos.z, 5, { speed: 2, up: 1, life: 0.3, size: 0.6, c: [1.6, 1.5, 1.2] }); }
      if (done) { a.on = false; a.m.visible = false; }
    }
  }
  // a censer's healing light: everyone near the caster (the player is the one who can be hurt)
  function heal(at, k) {
    const P = G.P;
    if (Math.hypot(P.pos.x - at.x, P.pos.z - at.z) < 14) { const before = P.hp; P.hp = Math.min(P.maxHp, P.hp + P.maxHp * k); if (P.hp > before) G.burst(G.FX.sparks, P.pos.x, P.pos.y + 1.2, P.pos.z, 24, { speed: 2, up: 2.6, life: 1, size: 0.9, c: [1.4, 2.0, 1.3] }); }
    G.ring(at, 7, [1.2, 1.9, 1.2]);
    G.burst(G.FX.sparks, at.x, at.y + 1.5, at.z, 40, { speed: 4, up: 3, life: 1.1, size: 1, c: [1.5, 2.1, 1.3] });
  }
  // one blow of a companion's attack (melee arc, arrows, a slam, a pulse of light)
  function allyBlow(a, A, idx) {
    const ch = CHARS[a.id], k = G.allyK() * (ch.atk || 1), fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    const dmg = () => (A.dmg[0] + Math.random() * (A.dmg[1] - A.dmg[0])) * k;
    if (A.shoot) {
      const S = A.shoot, from = _v.set(a.pos.x + fx * 0.5, a.pos.y + 1.45 * a.h, a.pos.z + fz * 0.5).clone();
      const t = a.tgt, ty = t ? t.pos.y + (t.isBoss ? 3 : (t.hy || 2) * 0.5) : from.y;
      const d = t ? _w.set(t.pos.x - from.x, ty - from.y, t.pos.z - from.z) : _w.set(fx, 0, fz);
      const L = d.length() || 1; d.y += L * 0.04; // lob a touch for the fall
      for (let i = 0; i < S.n; i++) { const yaw = (i - (S.n - 1) / 2) * (S.spread || 0); shoot(from, d.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), { spd: S.spd, dmg: dmg(), poise: A.poise, pierce: S.pierce, big: S.big, wound: S.wound, from: 'a' }); }
      G.sfx('thrust'); return;
    }
    if (A.heal) { heal(a.pos, A.heal); G.sfx('purify'); return; }
    if (A.pulse) { heal(a.pos, A.pulse); }
    const reach = A.slam || A.reach, cone = A.slam ? -2 : A.cone;
    let n = 0;
    for (const e of G.enemies()) {
      const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z, d = Math.hypot(dx, dz), er = e.r || 0.6;
      if (d - er > reach || Math.abs(e.pos.y - a.pos.y) > (e.hy || 2.8)) continue;
      if (cone > -1.5 && d > er + 0.8 && (dx * fx + dz * fz) / (d + 1e-5) < cone) continue;
      G.strike(e, dmg(), A.poise * (ch.form === 'hammer' ? 1.15 : 1), A.heavyHit || A.slam ? 'crit' : '', a.pos, false);
      const k2 = (d - er * 0.6) / (d + 1e-5), hy = e.pos.y + Math.min(2.4, (e.hy || 2.2) * 0.55);
      G.impact(a.pos.x + dx * k2, hy, a.pos.z + dz * k2, A.heavyHit || A.slam ? 0.7 : 0.35, (idx % 2 ? -0.5 : 0.5), G.look(ch.form).spark);
      n++;
    }
    if (A.slam) { G.burst(G.FX.smoke, a.pos.x + fx * 1.5, a.pos.y + 0.3, a.pos.z + fz * 1.5, 22, { speed: 6, up: 1.4, life: 1, size: 2.2, c: [0.85, 0.8, 0.7] }); G.ring(_v.set(a.pos.x + fx * 1.5, a.pos.y, a.pos.z + fz * 1.5), A.slam, [2.2, 1.5, 0.7]); G.shake(0.12); }
    if (n) G.sfx(A.heavyHit || A.slam ? 'hit' : 'hit');
  }

  function spawn(id, i) {
    const ch = CHARS[id];
    const actor = new SeraphActor(G.scene, { style: 'warrior', weapon: G.weaponOf(id), noCloth: false });
    actor.setLook(id === 'lian' ? G.prog.look : ch.look);
    const a = { id, actor, i, pos: G.P.pos.clone(), vel: new THREE.Vector3(), yaw: G.P.yaw, phase: 0, speed: 0, atk: {}, cd: 0.5 + i * 0.3, combo: 0, tgt: null, roll: -1, rollDir: new THREE.Vector3(), healCd: 4, h: (id === 'lian' ? G.prog.look.height : ch.look.height) || 1, grounded: true, vy: 0 };
    place(a, true);
    return a;
  }
  function despawn(a) { a.actor.dispose ? a.actor.dispose() : null; a.actor.root.parent && a.actor.root.parent.remove(a.actor.root); a.actor.weaponHolder.parent && a.actor.weaponHolder.parent.remove(a.actor.weaponHolder); for (const c of a.actor.cloths) G.scene.remove(c.mesh); }
  const SLOTS = [[-2.4, -1.3], [2.4, -1.3], [-3.7, 0.4]]; // beside him, never between him and the camera
  function slotPos(i, out) {
    const P = G.P, [sx, sz] = SLOTS[i % 3], c = Math.cos(P.yaw), s = Math.sin(P.yaw);
    return out.set(P.pos.x + sx * c + sz * s, P.pos.y, P.pos.z - sx * s + sz * c);
  }
  function place(a, snap) {
    slotPos(a.i, a.pos); a.pos.y = G.support(a.pos.x, a.pos.z, G.P.pos.y + 3).h; a.vel.set(0, 0, 0); a.vy = 0;
    if (snap) { a.yaw = G.P.yaw; a.actor.resetCloth(); }
  }
  // who the party is: the main is the player; the others walk at their side
  function sync(members, main) {
    const want = members.filter((id) => id !== main);
    for (let k = allies.length - 1; k >= 0; k--) if (!want.includes(allies[k].id)) { despawn(allies[k]); allies.splice(k, 1); }
    want.forEach((id, i) => { let a = allies.find((x) => x.id === id); if (!a) { a = spawn(id, i); allies.push(a); } a.i = i; });
    allies.sort((x, y) => x.i - y.i);
  }
  function startAtk(a, kind) {
    const A = G.atkTable(CHARS[a.id] ? G.formOf(a.id) : 'sword')[kind]; if (!A) return;
    a.atk = { kind, t: 0, dur: A.dur, hitsDone: 0, hit: A.hits[0], sw: 0.1, last: A.hits[A.hits.length - 1], A };
    if (A.lunge > 0 && a.tgt) { const d = Math.hypot(a.tgt.pos.x - a.pos.x, a.tgt.pos.z - a.pos.z) - (a.tgt.r || 0.6); const l = d < 1.6 ? A.lunge * 0.25 : Math.min(A.lunge, 9); a.vel.x = Math.sin(a.yaw) * l; a.vel.z = Math.cos(a.yaw) * l; }
    else if (A.lunge < 0) { a.vel.x = Math.sin(a.yaw) * A.lunge; a.vel.z = Math.cos(a.yaw) * A.lunge; }
    G.sfx(A.sfx === 'cleave' || A.sfx === 'skill' ? A.sfx : 'swing', 0.5);
  }
  function update(dt, active) {
    updateArrows(dt);
    const P = G.P;
    for (const a of allies) {
      if (!active) { a.actor.setVisible(false); continue; }
      // too close to the camera (it swung round): fade them out rather than fill the screen
      const cp = G.camPos(); a.actor.setVisible(!cp || Math.hypot(cp.x - a.pos.x, cp.y - (a.pos.y + 1.2), cp.z - a.pos.z) > 1.9);
      const form = G.formOf(a.id), R = FORMS[form] ? FORMS[form].range : [1.8, 2.6];
      // lost the party (a warp, a long glide, a cliff): rejoin at your side
      const far = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (far > 46 || (P.grounded && Math.abs(a.pos.y - P.pos.y) > 9 && far < 30) || (P.grounded && a.pos.y < P.pos.y - 25)) { place(a, true); G.burst(G.FX.sparks, a.pos.x, a.pos.y + 1, a.pos.z, 12, { speed: 2, up: 2, life: 0.6, size: 0.8, c: [1.8, 1.6, 1.1] }); }
      // a target: what the main has locked, else the nearest beast near the party
      if (a.tgt && (a.tgt.dead || (a.tgt.isBoss && !a.tgt.targetable()) || Math.hypot(a.tgt.pos.x - P.pos.x, a.tgt.pos.z - P.pos.z) > 30)) a.tgt = null;
      if (!a.tgt || (P.lock && a.tgt !== P.lock && !P.lock.dead)) {
        a.tgt = P.lock && !P.lock.dead ? P.lock : null;
        if (!a.tgt) { let bd = 24; for (const e of G.enemies()) { if (e.dormant) continue; const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z); if (d < bd) { bd = d; a.tgt = e; } } }
      }
      // the censer bearer watches the main's health
      a.healCd -= dt;
      if (form === 'censer' && !a.atk.kind && a.healCd <= 0 && P.hp < P.maxHp * 0.5 && Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) < 13) { a.healCd = 14; a.yaw = Math.atan2(P.pos.x - a.pos.x, P.pos.z - a.pos.z); startAtk(a, 'heavy'); G.say(a.id, '撐住！'); }
      // where to stand
      let gx, gz, run = false;
      if (a.tgt) {
        const t = a.tgt, tr = (t.r || 0.6) + (form === 'bow' || form === 'lantern' ? 0 : 0.2);
        const want = tr + lerp(R[0], R[1], (a.i % 3) / 2);
        const ang = Math.atan2(a.pos.x - t.pos.x, a.pos.z - t.pos.z) + (a.i - 1) * 0.02;
        gx = t.pos.x + Math.sin(ang) * want; gz = t.pos.z + Math.cos(ang) * want; run = true;
        // spread out from the other companions around the same target
        for (const b of allies) if (b !== a) { const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz); if (d < 2.2 && d > 1e-3) { gx += (dx / d) * 1.5; gz += (dz / d) * 1.5; } }
      } else { slotPos(a.i, _v); gx = _v.x; gz = _v.z; run = Math.hypot(gx - a.pos.x, gz - a.pos.z) > 5; }
      // a boss winding up close by: roll out of the way now and then
      if (a.roll < 0 && a.tgt && a.tgt.isBoss && a.tgt.threat && a.tgt.threat(a.pos) && Math.random() < 0.5) {
        a.roll = 0; a.atk = {}; _v.set(a.pos.x - a.tgt.pos.x, 0, a.pos.z - a.tgt.pos.z).normalize(); a.rollDir.copy(_v).applyAxisAngle(THREE.Object3D.DEFAULT_UP, (Math.random() - 0.5) * 1.6); a.yaw = Math.atan2(a.rollDir.x, a.rollDir.z);
      }
      if (a.roll >= 0) {
        a.roll += dt / 0.5; const sp = 12 * (a.roll < 0.55 ? 1 : 1 - (a.roll - 0.55) / 0.45 * 0.8);
        a.vel.x = a.rollDir.x * sp; a.vel.z = a.rollDir.z * sp; if (a.roll >= 1) a.roll = -1;
      } else if (a.atk.kind) {
        const A = a.atk.A; a.atk.t += dt;
        a.vel.x = damp(a.vel.x, 0, 7, dt); a.vel.z = damp(a.vel.z, 0, 7, dt);
        if (a.tgt && a.atk.t < a.atk.hit) a.yaw = dampAngle(a.yaw, Math.atan2(a.tgt.pos.x - a.pos.x, a.tgt.pos.z - a.pos.z), 12, dt);
        while (a.atk.hitsDone < A.hits.length && a.atk.t >= A.hits[a.atk.hitsDone]) { allyBlow(a, A, a.atk.hitsDone); a.atk.hitsDone++; }
        if (a.atk.t >= A.dur) {
          a.atk = {};
          // chain the combo, or step back and breathe
          const tg = a.tgt, inR = tg && Math.hypot(tg.pos.x - a.pos.x, tg.pos.z - a.pos.z) - (tg.r || 0.6) < R[1] + 1.2;
          a.combo++;
          if (inR && a.combo < (form === 'dual' ? 4 : form === 'hammer' ? 2 : 3)) startAtk(a, ['l0', 'l1', 'l2', 'l3'][a.combo]);
          else { a.combo = 0; a.cd = (form === 'bow' ? 0.5 : 0.7) + Math.random() * 0.8; }
        }
      } else {
        const dx = gx - a.pos.x, dz = gz - a.pos.z, d = Math.hypot(dx, dz);
        const sp = d < 0.4 ? 0 : run ? Math.min(8.5, 2 + d * 1.6) : Math.min(5.6, d * 1.4);
        a.vel.x = damp(a.vel.x, d > 1e-3 ? (dx / d) * sp : 0, 10, dt); a.vel.z = damp(a.vel.z, d > 1e-3 ? (dz / d) * sp : 0, 10, dt);
        const face = a.tgt ? Math.atan2(a.tgt.pos.x - a.pos.x, a.tgt.pos.z - a.pos.z) : d > 0.6 ? Math.atan2(dx, dz) : P.yaw;
        a.yaw = dampAngle(a.yaw, face, a.tgt ? 10 : 6, dt);
        a.cd -= dt;
        if (a.tgt && a.cd <= 0) {
          const td = Math.hypot(a.tgt.pos.x - a.pos.x, a.tgt.pos.z - a.pos.z) - (a.tgt.r || 0.6);
          if (td < R[1] + 0.9 && td > (form === 'bow' ? 4 : -9)) { a.combo = 0; startAtk(a, Math.random() < 0.22 && form !== 'censer' ? 'heavy' : 'l0'); }
        }
      }
      // move, keep out of walls, stand on the ground
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
      G.pushOut(a.pos, 0.35, a.pos.y);
      const gy = G.support(a.pos.x, a.pos.z, a.pos.y + 1.2).h;
      if (a.pos.y > gy + 0.05) { a.vy -= 26 * dt; a.pos.y = Math.max(gy, a.pos.y + a.vy * dt); a.grounded = a.pos.y <= gy + 0.01; } else { a.pos.y = gy; a.vy = 0; a.grounded = true; }
      a.speed = Math.hypot(a.vel.x, a.vel.z); if (a.grounded) a.phase += dt * (2.2 + a.speed * 1.15);
      // body
      a.actor.root.position.copy(a.pos); a.actor.root.rotation.y = a.yaw;
      a.actor.update(dt, { wpn: form, mode: 'play', speed: a.speed, phase: a.phase, grounded: a.grounded, vy: a.vy, glide: false, dash: 0, atk: a.atk.kind ? a.atk : {}, cast: -1, hurt: -1, charge: -1, lock: !!a.tgt && !a.atk.kind && a.speed < 1, heal: 0,
        roll: a.roll >= 0 ? clamp(a.roll, 0, 1) : -1, rollKind: 'roll', flap: 0, bank: 0, display: 0 });
    }
  }
  return { allies, sync, update, shoot, heal, place, spawn, despawn };
}
