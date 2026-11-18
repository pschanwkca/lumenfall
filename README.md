# LUMENFALL · 光羽之境

A seraphic open-world exploration prototype for mobile (landscape) and desktop — built with three.js, no build step.

## Run locally

Serve the folder with any static server and open `index.html`, e.g.

```
python3 -m http.server 8080
```

three.js r160 and fonts load from CDNs.

## Platforms

- **Mobile** — landscape, touch joystick + action buttons
- **Desktop** — always a landscape stage (letterboxed in tall windows), its own keyboard & mouse HUD, pointer-lock mouse look (drag-to-look fallback), adaptive resolution
- Force a layout with `?ui=desk` or `?ui=touch`

| Desktop | |
|---|---|
| WASD / mouse | move / look (click to grab the mouse, Esc to pause) |
| Left click | attack, hold to charge |
| Right click / Shift | dodge (air: dive) |
| Space | jump, glide, flap |
| Q · R · Tab / middle click | holy ring · heal · lock on |
| E · M · B · H | interact · map · codex · hide HUD |
| Wheel | camera distance |

## World

The hero is a young warrior of Belldawn: to everyone a plain human, in truth the son of an angel (Sachiel, once Camael's
lieutenant, who fled the list of angels whose light was to be fed to the seal) and a human lamp-keeper (Elin).
He sets out with an unpolished holy sword and his father's reliquary. Everything is open from the start; monsters grow
with the story: weakest by Belldawn's gate, stronger the farther out, then the isle, the Empyrean and hell.

| Chapter | Where | Boss | What you get |
|---|---|---|---|
| Prologue | 晨鐘堡 Belldawn (start) | — | 未打磨的聖劍, 聖匣 (from the father) |
| I | 人間 the mortal world | 卡麥爾 Camael (傾城遺跡) | 騎士之誓; the crater's light pillar takes you up |
| II | 光羽之境 the isle | 歐菲爾 Ophiel (墮翼之丘) | 天使之翼 + the sword polished (at the core), 墮光大劍, 守衛之盾 |
| III | 天上神域 the Empyrean | 阿斯特萊亞 Astraea | 審判之翼, 審判之槍 |
| IV | 墮天巨像 · 地獄前庭 | 亞巴頓 Abaddon | 天樞之劍 (three seals on the colossus) |

- The wings only appear while used (glide, flap, air dash, holy ring) and fold away otherwise; no halo until then
- Mortal world terrain: 1.28 km with Belldawn Hold, the harbour, the abbey, the fallen keep, the mire, the rift and the colossus
- Jump off any layer to fall to the one below; light pillars carry you back up

## Systems

- Skinned seraph (Mixamo-compatible; upload a GLB in Settings), cloth, combo / charge / perfect dodge / counter
- Four bosses in story order (Camael, Ophiel, Astraea, Abaddon), each granting a power; Abaddon guards hell
- 13 kinds of minion with their own HP, speed and tells: shades, archers, armoured brutes (slam), stalkers (fast, fragile),
  shielded guards (front block, break with a charged hit), healer priests, horned chargers, swollen bombers (explode),
  cinder soldiers, purgatory demons and ash archers. Each world dresses them differently (gilt, silver, bone, obsidian)
- Feather levels, 墮天錄 codex (19 entries in four groups, with lore, weak points and moves), 繁中 / 日本語
- Cloud shadows, god rays, height fog, colour grade, lake reflections

## Story and guidance

The full story (two parts, the turning point, both endings) lives in a separate doc. In game, the system only says where to go;
when you get there a voice, an echo or an inscription tells you what to do:

- A distant voice wakes you; each shrine you light plays a memory of the warden who guarded the cradle
- Steles at the Sanctum (the empty cradle), the Empyrean Court (the empty throne) and the Stardeep Vault (the scratched-out line)
- Echoes at the statues of the purified: Astraea, Camael, Abaddon
- Ophiel's greatsword stays planted before his statue; you draw it yourself
- The colossus over the rift holds a sword with three seals (shield, wings, oath); with all three lit, the Lord of the Empyrean
  gives you 天樞之劍, the only blade that truly cuts what lives in hell
- Every clue lands in the 聖匣 under 線索

## 聖匣 · The Reliquary (I)

The small casket of light the seraph carries. Four tabs: weapons (equip here), powers, collection (feathers per world,
people, beacons, codex) and clues. Locked slots show where to look.

## Weapons

| Weapon | Found | Feel |
|---|---|---|
| 未打磨的聖劍 → 聖劍 | from the father; polished at the sanctum core | balanced slashes; dull grey, then gold |
| 審判之槍 Spear of judgement | Astraea's echo | two quick long thrusts, spin sweep, lunge; white-gold light |
| 墮光大劍 Ophiel's greatsword | before Ophiel's statue | two-handed cleaves, slow spin, overhead slam that hits everything around the impact; molten orange light, heavy hit-stop |
| 天樞之劍 Tianshu | the colossus, all three seals | quick slashes; needed to hurt anything in hell; silver-blue light |

## Test mode

Settings → 測試模式, or **F2** (also <code>`</code>) on desktop. A red **TEST** chip stays on the HUD while it is on; tap it to reopen the panel.

- Jump straight to each chapter's key places and bosses: the isle (lake, shrine, sanctum, Ophiel), the Empyrean (entrance, Astraea),
  the mortal world (crater, Belldawn Hold, a sealed captive, a beacon, Camael, the rift) and hell (landing, bridge, Abaddon, the gate)
- Toggles: invincible, one-hit kills, all powers, the Empyrean lord's weapon, coordinates + FPS readout
- One-shot cheats: feathers +3, jump to Lv 8, full heal, clear nearby enemies, unlock the codex, swap greatsword / spear
- Everything in test mode is saved to its own slot (`lumenfall_progress_test`); "離開測試模式" reloads your real save untouched,
  "全新進度重新開始" starts the test slot from zero (bosses alive again)

## Quest tracker

Chapter title (tap to fold), then one story objective with distance to its marker, then this world's tasks (ticked when done)
and its feathers. Folded by default on phones so it never covers the move stick.

## Code

| File | |
|---|---|
| `index.html` | UI, HUD, overlays, styles |
| `js/main.js` | game loop, player, combat, enemies, quests, UI logic |
| `js/core.js` | math, noise, terrain grids, textures |
| `js/world.js` | island, sky, water, foliage, landmarks, the Empyrean |
| `js/earth.js` | the mortal world: terrain, regions, the rift and the colossus |
| `js/hell.js` | the abyss forecourt: lava, the bridge, the Keeper's Ring and the sealed gate |
| `js/folk.js` | the faceless cloaked folk: instanced bodies, lanterns, poses, lines |
| `js/seraph.js` | character rig, animation, cloth |
| `js/boss.js` | boss AI |
| `js/env.js` | fog, grading, cloud shadows, god rays, foliage & rock shaders |
| `js/hero.js` | statues, static baking helpers |
| `js/i18n.js` | Japanese translation layer |
