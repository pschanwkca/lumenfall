# LUMENFALL · 光羽之境

A seraphic open-world exploration prototype for mobile (landscape) and desktop — built with three.js, no build step.

## Run locally

Serve the folder with any static server and open `index.html`, e.g.

```
python3 -m http.server 8080
```

three.js r160 and fonts load from CDNs.

## Platforms

- **Mobile** — landscape, touch joystick + action buttons, adaptive resolution, lighter bloom / god rays / lake mirror, optional 30 fps battery saver (Settings)
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

The hero, 黎恩 (Lian), is a young warrior of Belldawn: to everyone a plain human, in truth the son of an angel (Sachiel, once Camael's
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

- The climb is gated by the story: the crater's pillar answers only after Camael's echo wakes it; the sanctum core
  waits until Ophiel lays down his sword; the stairway needs Lv5
- Flight comes in two steps: the father's wings (at the core) only glide; Astraea's wings let you flap upward and air-dash
- The wings only appear while used (glide, flap, air dash, holy ring) and fold away otherwise; no halo until then
- The wings are articulated (arm + hand hinged at the wrist, an instanced fan of primaries). They unfurl in stages on a
  spring (the arm rises, the wrist opens, the primaries fan out, a small overshoot, then one shake-out beat) and fold away
  by sweeping down and breaking into feathers. In flight they ripple, bank into turns and trail light from the tips; each
  flap is a full stroke (raise, hard downstroke with the hand open, wrist drawn in on the recovery)
- Mortal world terrain: 1.28 km with Belldawn Hold, the harbour, the abbey, the fallen keep, the mire, the rift and the colossus
- Jump off any layer to fall to the one below; light pillars carry you back up

## Systems

- Skinned seraph (Mixamo-compatible; upload a GLB in Settings), cloth, combo / charge / perfect dodge / counter
- Dodge is a forward roll on the ground (0.5 s, i-frames for the first 0.34 s, dust per world); locked on with no
  direction it is a quick hop back instead. Attack during the roll to come up out of it swinging. In the air with
  Astraea's wings the dodge is still the air dash
- Four bosses in story order (Camael, Ophiel, Astraea, Abaddon), each granting a power; Abaddon guards hell
- 13 kinds of minion with their own HP, speed and tells: shades, archers, armoured brutes (slam), stalkers (fast, fragile),
  shielded guards (front block, break with a charged hit), healer priests, horned chargers, swollen bombers (explode),
  cinder soldiers, purgatory demons and ash archers. Each world dresses them differently (gilt, silver, bone, obsidian)
- Feather levels, 墮天錄 codex (19 entries in four groups, with lore, weak points and moves), 繁中 / 日本語
- Cloud shadows, god rays, height fog, colour grade, lake reflections

## HUD

Sized after Monster Hunter's hunt HUD so the scene stays the subject:
- Top-left: level disc (its ring is feather progress), a thin HP bar that lengthens as max HP grows, stamina bar under it
- Under that, the quest list on a light wash instead of a card; top-right, menu icons with the minimap below them
- Phone: a compact thumb cluster (attack 64 px, dodge / jump 46, holy ring 44, flask 36, lock 34); the joystick rests
  as a faint ring and the full pad appears under the thumb
- Desktop keeps the same layout one size up, with the key hotbar alone at the bottom
- The tracker shows the main quest only; sub-steps, side quests and feathers fold under 「其他任務」 (tap to open)
- Tap the quest (or press O) for the quest detail, like a hunt's quest info: place and direction, who asked, the story
  so far, how to do it, the steps, side quests, and 「顯示指引」
- An objective marker floats over the target with its distance and pins to the screen side when it is off-screen
  (it fades back while it sits over a HUD panel, so it never covers text)
- Region titles, notices and pickups share one small left-hand feed under the quest list (v2.0.1)
- The guiding light (G, or automatically for a while when the objective changes) is a wisp that flies ahead toward it
- The crater's pillar sleeps (a faint thread of light) until Camael's echo has spoken, so the sky cannot be reached early;
  arriving in the sky early (old saves) points you back down

## The cast, remade (v2.1) · low-poly, flat-shaded

- `js/figure.js` models every playable character the way a low-poly character artist would: superellipse rings
  lofted along each bone (12-sided torso with a sternum line, 8-sided limbs, hands with thumbs, boots with cuffs and straps),
  flat-shaded so each plane catches the light; about 2–3k triangles per character, on the same Mixamo skeleton, so every animation still works
- The head is sixteen sides packed toward the face (a narrow nose, eye sockets, brow, cheekbones, jaw) with a painted face:
  eyes with iris and lash line, brows in the hair colour, lips; the hair is a shell whose edge tucks under the skin along a zigzag fringe
- Clothes are shells over the body: tunic with split skirt and hem trim, belt and buckle, strap, pouch, bracers, pauldrons,
  breastplate, fur collar, robe; beards and a deep hood with a cowl (the dressing room gains 兜帽 · HOOD; 米菈 and 歐文 wear theirs up)
- The townsfolk are low-poly hooded figures in the same hand (cloak in folds, cowl, sleeves, a face in the hood's shadow)
- Cloth (capes, long hair) lays itself out afresh after a teleport instead of trailing across the map

## The party (v2.0, after Monster Hunter Outlanders) · phase 1

- **Party of four**: one under your hand (主控) and up to three companions fighting on their own. 黎恩 is always in the
  party; anyone in it can take control (from the reliquary's 隊伍 tab, out of combat and on the ground): the two
  bodies trade places and each keeps its own weapon. Only 黎恩 and Isera have wings
- **Recruiting**: no gacha. People you meet on the road (the rescued, the keepers of the lights, the watchers) can be
  hired with bounty money (賞金), earned from every beast, boss, rescue, beacon and vigil tower. UR/SSR/SR mark the
  ceiling of their kit, and the price
- **The cast** (every one a different frame, job and way of fighting): 黎恩 (sword, glides) · 伊瑟拉 Isera, UR, tall
  watcher angel, longbow (ranged, wound sniping) · 加雷斯 Gareth, SSR, huge last knight, greatsword (front line) · 布蘭
  Bran, SSR, big bald monk, bell-maul (stun and topple) · 卡莎 Kasha, SSR, short sturdy lamp-keeper's daughter, harpoon
  lance (reach; pull and pin in phase 2) · 米菈 Mira, SR, small hunter, twin blades (fastest flurries) · 蘿絲 Rosa,
  SR, plump herbalist, censer staff (heals the party) · 達克 Dak and 歐文 Owen, SR, arrive in phase 2 (blasting pick,
  lantern)
- **New weapon forms**, each its own move set, pose and feel for the player and for the AI: longbow (arrows that fly,
  drop and pierce; a three-arrow spread; a charged shot that hits wounds ×1.6), bell-maul (the heaviest stagger;
  slams), twin blades (two cuts a press; a ten-hit dance), censer staff (sweeps; a light pulse; a charged party heal)
- **Weapons belong to forms**: chest weapons are swapped between people of the same form (the harpoon and the
  watcher's lance for lance users, the bell-bronze maul for Bran); 黎恩 keeps swords
- **AI companions** follow beside the main (never between him and the camera), pick the locked target or the nearest
  beast, hold their form's range (archers stand off, maul and blades close in), chain combos, roll out of a boss's
  telegraphed blows, and the censer bearer heals the main when they fall under half
- **Dressing room (外觀)** for 黎恩: four outfits (Belldawn traveller, knight's half-plate, watcher's white, hunter's
  leathers), cape style and colour, three hair styles and colours, skin, eyes, height and build, with a live, turnable
  full-body and close-up view. He has a face now (eyes and brows)

## Forage, cooking and fire (v1.9, after Breath of the Wild)

- **Forage**: dawnleaf (meadows), golden wheat (by the town and the mill), wild honey (on top of tall rocks and in tree
  crowns: climb for it), marsh caps (the swamp) and frostberries (the abbey's ridge) glint where they grow; walk over
  them to pick them up (up to 30 of each). They grow back after a few minutes
- **Cooking**: at any lit beacon or the new cooking fire in Belldawn's square, Interact opens the reliquary's 糧食 tab
  with a pot: up to three ingredients. Dawnleaf and wheat heal; honey, caps and berries add a blessing (stamina use
  −35%, attack +15% or damage taken −20%) that lasts longer the more of it is in the pot; a pot of mixed blessings
  becomes a heartier stew. Dawnleaf + wheat + honey is his mother's recipe: full health and a long stamina blessing.
  Eat from the 糧食 tab; the blessing shows as a chip under the stamina bar
- **Fire**: the mortal world's grass burns. Rotwalkers' bursts set it alight; a weapon swung by a fire (a lit beacon,
  the town's fire, a burning meadow) catches for 40 s, sets grass alight where it swings and hits a little harder; the
  fallen seraph's blade lights the grass on its heavy blows. Fire spreads cell by cell, burns beasts and the seraph,
  leaves the ground scorched black (it greens again later) and throws up hot air: glide over it to rise. Water puts
  a burning weapon out
- **Crates and boulders**: crates by the old camps break under a blow and hold ingredients (sometimes a light-dew
  flask); boulders sit on the slopes above where beasts roam: hit one and it rolls downhill, crushing what it meets,
  then breaks apart (another appears later)

## Exploration (v1.8, after Breath of the Wild)

- **Climb anything**: push into any wall, tower, tree, roof, rock or island face and he grabs on. Stick/WASD climbs
  (sideways follows the camera), Jump is a climbing leap (about 2.7 m, costs stamina; held away from the wall it kicks
  off), Dodge lets go. At the top he hauls himself over onto whatever is there (a ledge, a roof, a dome, a tree crown);
  with nothing to stand on he vaults off, wings ready. Stamina drains while moving on a wall and only refills on the
  ground; empty, he slips off. Steep ground (over ~57°) is scrambled up on hands and feet, slowly and on stamina;
  spent, he slides back down
- Buildings collide as real boxes with their roofs (the town's houses, the chapel, the abbey hall) and can be stood on;
  rocks, trees and towers have standable tops; the colossus' robe is walked like a hill, its torso and head climbed.
  Seals that must be broken, braziers and the colossus' blade cannot be climbed
- **Vigil towers (守望塔)**: before the Fall, seraphs kept watch over the mortal world from six high places, each with a
  vigil stone at the top: the field watch, the keeper's lighthouse, the Frostridge belfry, the keep tower, the colossus'
  brow, and the Drowned Spire (a new white spire in the marsh, with stone collars to rest on half way). Wake a stone and
  the map inks in the land around it; the tower becomes a camp to travel to, and a thread of light stands over it. The
  mortal world's map starts as blank parchment except where he fell and the town he grew up in
- **Chests (寶匣)**: five reliquary boxes, most of them where you have to climb, each holding a weapon with its story.
  They fight in one of the three forms with their own edge: 晨鐘騎士劍 (castle throne · counters +35%), 墮天者的斷劍
  (the colossus' shoulder · +25% damage, shorter), 守燈人的魚叉 (lighthouse gallery · +15% reach), 守望者之槍 (Drowned
  Spire's first ledge · focus strikes +35%), 鐘銅巨劍 (abbey cloister · +40% stagger). No durability: each one is kept
- Art fix: house, chapel and abbey roofs were upside-down prisms turned sideways; they are proper gables now. The
  lighthouse halo and beams thin out when you stand on its gallery

## Review pass (v1.7)

- Art: the hero wears a Belldawn-blue half-cape with a gold hem (cloth; folds away when the wings come out) in place of
  two sashes that read as sticks; hell's floor is basalt split by wandering seams of fire; the hell return beam is
  thinner and warm instead of a white wall; the title composition keeps the logo and the hero apart
- UI: stamina bar is cool (celeste) and HP warm; thumb labels larger; the objective marker hides during boss fights;
  boss telegraphs are amber and normally blended so they read on white stone
- Combat: greatsword bosses gain a three-blow chain whose last overhead is delayed (it punishes early rolls; offset or
  clash it); the Arbiter calls four light pillars where you stand
- Story: a five-line prologue before the first words with the father; each boss speaks as the fight begins
  (Abaddon's line foreshadows the key)

## Hunt combat (v1.6, after Monster Hunter Wilds)

- **Weight**: every attack has a readable wind-up, a fast swing on the hit frame and a recovery you commit to. A roll
  pressed during the wind-up is buffered until the blow lands. Damage per hit is higher so fights last as long.
- **Hit feel**: an impact flash and slash streak at the point of contact, hitstop by weight (light 0.065 s, finishers
  0.1 s, charged / counter 0.15 s; greatsword ×1.3), a camera kick on heavy blows, orange numbers on weak spots.
- **Parts**: each boss has halo/head (×1.35, reachable when it is down), wings (from behind), weapon (while buried
  after a slam) and legs. Breaking the wings stops leaps and volleys, the halo stops the ring, the weapon shortens its
  reach; each break gives a flask back. Damage to the legs trips it.
- **Wounds and focus mode**: enough damage on a part opens a glowing wound (×1.25 damage). Hold lock (desktop: C) for
  focus mode: an over-the-shoulder camera and reticle that names the part; attacking a wound is a focus strike that
  bursts it for heavy damage and makes the boss reel.
- **Offset and power clash**: a heavy blow (charged, finisher, counter, focus strike) landing as the boss's own sweep
  lands cancels it and knocks it down; meeting an overhead slam (or guarding one with the shield) starts a power clash —
  mash attack to drive it back and floor it.

## Chapter I pacing (v1.5)

The mortal world's main road is three people on the way to the knight, each pointing to the next:
麥原邊的人 (≈180 m from Belldawn) → 麥原守望塔 (siege, ≈170 m on) → 傾城外的人 (≈460 m, past the sleeping pillar) →
the knight (≈150 m). About 1 km of road in all, one of each kind of task, then the boss. The other four captives and two
beacons are side quests (still worth flasks and max HP). Kindled beacons become camps: travel to them, or home, from the
map when no enemy is near. Hold dodge to sprint (10.8 m/s; stamina 5/s out of a fight, 11/s in one).

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
| 晨鐘騎士劍 Belldawn knight's blade | chest by the keep's throne | sword form, blue steel; counters +35% |
| 墮天者的斷劍 Fallen seraph's blade | chest on the colossus' shoulder | sword form, dark iron with red light; +25% damage, shorter |
| 守燈人的魚叉 Lampkeeper's harpoon | chest on the lighthouse gallery | lance form, longest reach (+15%), a little lighter |
| 守望者之槍 Watcher's lance | chest on the Drowned Spire's ledge | lance form, white; focus strikes +35% |
| 鐘銅巨劍 Bell-bronze greatsword | chest in the abbey cloister | greatsword form, bronze; +40% stagger |

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
