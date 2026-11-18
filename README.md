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
- Jump off any layer to fall to the one below; light pillars carry you back up

## Systems

- Skinned seraph (Mixamo-compatible; upload a GLB in Settings), cloth, combo / charge / perfect dodge / counter
- Three bosses, each granting a power (Aegis, Wings, Oath) that opens sealed areas; the Warden's greatsword
- Feather levels, 墮天錄 codex, 繁中 / 日本語
- Cloud shadows, god rays, height fog, colour grade, lake reflections

## Code

| File | |
|---|---|
| `index.html` | UI, HUD, overlays, styles |
| `js/main.js` | game loop, player, combat, enemies, quests, UI logic |
| `js/core.js` | math, noise, terrain grids, textures |
| `js/world.js` | island, sky, water, foliage, landmarks, the Empyrean |
| `js/earth.js` | the mortal world: terrain, regions, the rift and the colossus |
| `js/folk.js` | the faceless cloaked folk: instanced bodies, lanterns, poses, lines |
| `js/seraph.js` | character rig, animation, cloth |
| `js/boss.js` | boss AI |
| `js/env.js` | fog, grading, cloud shadows, god rays, foliage & rock shaders |
| `js/hero.js` | statues, static baking helpers |
| `js/i18n.js` | Japanese translation layer |
