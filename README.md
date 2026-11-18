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

- **天上神域 The Empyrean** — floating isles above the island; reached from the Sanctum (Lv 3) or by flight
- **光羽之境 The Isle** — the prologue island: shrines, Mirror Lake, Heaven's Gate, Elder Tree
- **人間 The Mortal World** — beneath the cloud sea, 1.28 km ringed by mountains and opening onto the eastern sea:
  - 晨鐘堡 Belldawn Hold (walled town that fills with people and light), 燈塔港 lighthouse harbour, 霜脊修道院 mountain abbey,
    麥原守望塔 field watch, 傾城遺跡 the fallen keep, 瘴氣沼澤 the miasma mire, 低語森林 the whispering wood, 墜光坑 the crater of fallen light
  - 墮天裂谷 the rift, with the 墮天巨像 fallen colossus kneeling over it — the sealed way down to hell
  - Six people sealed in miasma crystal (clear the guards, purify, they walk home) and three beacons to defend through waves of beasts
  - Chunked terrain with two levels of detail, distance culling for scenery
- **地獄 The Abyss** — beneath the rift, only the forecourt is open for now (one way in: drop into the rift):
  - 墜落之地 the landing, with a light pillar back to the mortal world; 熔河 the burning river and its rib-bone bridge
  - 守門者之環 the Keeper's Ring, held by **冥門守衛 · 亞巴頓 Abaddon**, and behind it the sealed 冥門 Abyssal Gate
  - Everything here shrugs off ordinary light: until the 神域之主 gives you their weapon (after the story), hell monsters and
    Abaddon take ~8% damage and hit you three times as hard. Beatable by a very patient player, not a place to farm
- Each world has its own air: isle (pale gold), Empyrean (cool, high), mortal world (warm haze that turns green in the mire,
  icy at the abbey, rust-red at the rift, salt-blue at the coast), hell (ember dark)
- Jump off any layer to fall to the one below; light pillars carry you back up

## Systems

- Skinned seraph (Mixamo-compatible; upload a GLB in Settings), cloth, combo / charge / perfect dodge / counter
- Three bosses, each granting a power (Aegis, Wings, Oath) that opens sealed areas; the Warden's greatsword; Abaddon guards hell
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
| 聖槍 Holy lance | from the start | two quick long thrusts, spin sweep, lunge; white-gold light |
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
