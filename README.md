# LUMENFALL · 光羽之境

A seraphic open-world exploration prototype for mobile (landscape) — built with three.js, no build step.

## Run locally

Serve the folder with any static server and open `index.html`, e.g.

```
python3 -m http.server 8080
```

three.js r160 and fonts load from CDNs.

## World

- **天上神域 The Empyrean** — floating isles above the island; reached from the Sanctum (Lv 3) or by flight
- **光羽之境 The Isle** — the prologue island: shrines, Mirror Lake, Heaven's Gate, Elder Tree
- **人間 The Mortal World** — beneath the cloud sea: village, fields, river, ruined keep, crater of fallen light
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
| `js/earth.js` | the mortal world |
| `js/seraph.js` | character rig, animation, cloth |
| `js/boss.js` | boss AI |
| `js/env.js` | fog, grading, cloud shadows, god rays, foliage & rock shaders |
| `js/hero.js` | statues, static baking helpers |
| `js/i18n.js` | Japanese translation layer |
