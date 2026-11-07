# BURMA STRIKE

An original first-person browser FPS built with React, TypeScript, Vite and Babylon.js, with offline Practice and private Colyseus custom matches. **Bagan Old City** is a fictional fortified town with procedural Bagan-inspired architecture, materials, targets, and weapon geometry. No external models, copied maps, paid APIs or account requirement.

## Run locally

Use Node.js 22.12+ and npm for the frontend and Colyseus server.

```sh
cd /workspace/Burma-Strike
npm ci
npm run dev
```

Open `http://localhost:5173` in a current Chrome, Edge, Firefox, or Safari with WebGL enabled. Click **Play Practice**, allow mouse capture, and click the game canvas if the browser asks for another capture gesture.

On Windows PowerShell, use `npm.cmd ci` and `npm.cmd run dev` if script policy blocks `npm.ps1`. Run these commands in the folder containing this project's `package.json` and `src/App.tsx`. Open the exact root URL printed by Vite; if another server owns 5173, Vite may choose a different port. A stock Vite starter page means that server is running a different project or an older copy of the files.

For a production check:

```sh
npm run build
npm run preview
```

Open the address printed by Vite (normally port 4173 for preview).

## Private online custom matches

See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for setup, room codes, 2-player/2v1/5v5 tests, server authority, reconnection, modified files and current limitations. Keep `npm run server:start` (after `npm run server:build`) and `npm run dev` running in separate terminals. Install backend dependencies first with `npm --prefix server ci`. Existing Practice modes work independently of the server. Tactical rooms also include host-controlled friendly fire, server round history, teammate spectating after death and a same-room rematch flow; see the guide for controls and rules.

## Desktop controls

| Action | Control |
| --- | --- |
| Move | W A S D or arrow keys |
| Aim | Mouse, while captured |
| Fire | Left click |
| Reload | R |
| Jump | Space |
| Pause / release mouse | Esc |
| Primary / pistol / knife | 1 / 2 / 3 |
| Open / close buy shop | B |
| Cycle owned Practice primary | N |
| Aim down sights | Hold right mouse button |
| Sprint forward | Hold Shift + W |
| Inspect weapon | V |
| Equip Royal Signal Core | 4 (designated carrier) |
| Plant / defuse / recover | Hold F when eligible |
| Scoreboard | Hold Tab |
| Watch previous / next living teammate after death online | Q / E |

Practice has three 100-HP dummies. Body hits deal 34 damage; headshots deal 100. Dummies respawn after three seconds. Walls, gates, and crates stop bullets and player movement. The SHWE-9 pistol starts with a 12-round magazine and 48 reserve rounds. Reload takes 1.6 seconds. Use **Esc → Reset Range & Resupply** to restore ammunition and scores. In Free Range, health stays at 100 because targets do not attack. Economy Drill provides a real HP/armor damage path through its explicitly labeled local test controls.

Settings adjust aim sensitivity, synthesized sound effects, and the FPS display; they persist in browser storage. Field Guide explains controls inside the menu.

## Tactical arsenal upgrade

The original fortress and Practice targets are retained. You start with the SHWE-9 pistol; slot 1 contains a selectable primary. Press **N** to cycle rifle → SMG → sniper, or choose a primary from the pause menu. Each weapon retains its own magazine, reserve and cooldown. Switching loadouts does not supply free ammo. Slot 4 is reserved and disabled because Practice carries no objective device. Private custom matches use the separate Colyseus server described in [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md).

| Weapon | Magazine / reserve | Fire mode | Body / head damage | Reload |
| --- | --- | --- | --- | --- |
| SHWE-9 pistol | 12 / 48 | Semi-auto | 34 / 100 | 1.6 s |
| MUDON AR rifle | 30 / 90 | Automatic | 34 / 100 | 2.15 s |
| BAGAN-21 SMG | 24 / 96 | Automatic | 25 / 70 | 1.8 s |
| NAGA SCOPE sniper | 5 / 20 | Semi-auto | 100 / 150 | 2.6 s |
| LOTUS EDGE knife | No ammunition | Melee, 2.2 m reach | 50 / 100 | — |

Hold Fire for rifle/SMG automatic fire; click/tap each pistol/sniper shot and knife swing. Firing is blocked during draw, holster, reload, melee recovery and sprint. Inspection yields to a shot or reload. Draw/holster, breathing, walk/sprint sway, recoil recovery, reload gestures, inspection and melee are procedural placeholders. The `WeaponView` adapter in `weapon.ts` can later be implemented with original GLB models and authored animation clips without changing inventory or damage logic.

Hitscan damage resolves first, including a camera/muzzle cover check. Cosmetic streaks travel only to that resolved endpoint, with distinct weapon colors/lengths, brief muzzle flashes and light pulses. Hard impacts spark, sand impacts emit dust, and targets confirm hits. Effect counts are capped, lower on coarse-pointer devices, and expired meshes are disposed. The scope hides the sniper viewmodel so its placeholder optic cannot cover the target.

Settings now include mouse sensitivity **0.05–2.00**, default **0.35**, step **0.01**; ADS multiplier **0.10–1.50**; optional scoped multiplier **0.10–1.50**; separate touch sensitivity **0.10–3.00**; invert Y; horizontal hip-fire FOV **70–110°**; optional restrained head bob; audio and FPS. Changes apply immediately, persist to `burma-strike-settings`, and can be reset. Existing saved Phase 1 sensitivity is preserved until reset. Mouse input uses a constant pixel-to-angle scale, never frame-time multiplication; values are specific to BURMA STRIKE and are not calibrated to Valorant.

Movement uses bounded acceleration/deceleration, normalized strafing, substepped collisions, a short jump buffer/coyote window, and subtle landing feedback. Head bob is off by default. ADS reduces movement speed and narrows FOV; holding ADS takes precedence over sprint.

### Upgrade verification

```sh
npm test
npm run build
```

Tests cover ammo conservation, action exclusivity, per-weapon cooldowns, loadout/resupply behavior, settings migration/boundaries, pixel-based aim scaling, touch independence, held-input release and listener cleanup. Browser integration was additionally checked with Chromium and emulated landscape touch input. Physical phones, Safari/Firefox, controller input and calibrated cross-game sensitivity were not tested.

Manual smoke test: launch Practice; switch 1/2/3; cycle N; hold rifle fire; reload and try firing/switching before completion; hold RMB for ADS; choose sniper and verify scope; inspect with V; knife a nearby dummy; fire into a wall/crate and sand; sprint/jump into cover; pause/resume; change/reset settings and refresh. On mobile, combine joystick + drag aiming + held Fire/ADS, release/cancel touches, switch slots, reload, and rotate the device. Confirm no input remains stuck.


## Buy shop, armor and local economy

Choose **Economy Drill** from the main menu, or press **B** in Free Range and choose **Start Economy Drill**. The original **Play Practice / Free Range** retains its unrestricted arsenal, settings, movement, weapon feedback and target behavior. On mobile use the persistent **Shop** button. **B** toggles the shop; **Esc** closes it and returns to the current game/pause state. The old primary-cycle key is now **N**.

A fresh drill starts in **buy phase**, with **800 credits**, **100 HP**, **0 armor** and the permanent **LOTUS EDGE knife**. Buying SHWE-9 and Light Armor costs exactly the starting budget. The shop is a scrollable catalog with original procedural weapon previews, detailed damage/fire-rate/magazine/range stats, ownership/equipped status, validated purchase buttons and same-phase refund actions.

| Item | Price | Equipment |
| --- | --- | --- |
| SHWE-9 | 350 | Pistol, slot 2 |
| BAGAN-21 | 1100 | SMG, primary slot 1 |
| MUDON AR | 2700 | Rifle, primary slot 1 |
| NAGA SCOPE | 4500 | Sniper, primary slot 1 |
| Light Armor | 450 | 25 armor points |
| Heavy Armor | 1100 | 50 armor points |

Purchases are allowed only in buy phase and immediately equip a purchased gun. Duplicate, unknown and unaffordable items are rejected before credits or ownership change. Refunds return the recorded full price once, only during the **same buy phase**. Starting the round removes refund eligibility; gear carried into another round cannot be sold as a new purchase. Refund a current-phase armor purchase before replacing it. Repairing/upgrading carried armor charges the full new price; refunding that new purchase restores the exact previous armor type and points.

Practice retains an owned armory: several purchased primaries can be owned, with one selected in slot 1. **N** cycles only owned primaries; **1/2/3** equip primary/pistol/knife. Unowned slots are disabled and inventory methods reject unowned weapons. Each gun still retains its separate ammunition and cooldown. Opening the shop clears held movement/fire/ADS and releases pointer lock; closing it requests capture again. Click the visible capture prompt if the browser denies an immediate re-lock.

Press **Start Round** to enter the live phase and enable shooting. Purchases/refunds are locked in live/ended phases; the shop remains available for viewing equipment and local drill controls. Actual dummy eliminations award **+200**, each once per event. **Simulate Win** awards **+3000** and **Simulate Loss** awards **+1900**, once per live round. Credits always cap at **9000**. **Next Round** opens a new buy phase, restores HP and ammunition, carries owned weapons and remaining armor, and clears purchase receipts. These Practice rules carry gear even after a simulated loss; they are not a competitive match/death system. The pause-menu **Reset Drill** action starts over at 800 credits with the knife.

Armor absorption is configurable via `new PracticeEconomy({armorAbsorption: 0.6})`. Default damage resolution is:

```text
absorbed = min(currentArmor, incomingDamage × 0.6)
armorAfter = currentArmor − absorbed
healthAfter = max(0, currentHealth − (incomingDamage − absorbed))
```

In a live drill, open the shop and press **Test 40 Damage**. With Light Armor, HP becomes **84** and armor becomes **1**. A subsequent 40 damage consumes the last armor point and deals **39 HP**. Heavy Armor starts at 50 and becomes **26** after the first 40-damage test. HP and armor display separately in the game HUD and shop. Damage is rejected outside live phase; reaching zero HP finishes the local round as a loss once.

### Authority and online boundaries

Offline Practice is separate from the private-room server in `server/`. Its local `PracticeEconomy` instance never sends or claims online purchases. Credits, HP, armor, ownership and refund receipts are private fields, changed only through validated commands; the React UI gets immutable copied snapshots and has no balance/armor setters. Credits and armor are **not** restored from localStorage. Browser owners can ultimately alter their own offline runtime; this is not an anti-cheat or server-security claim.

`EconomyCommand`, `EconomySnapshot` and the pure rules isolate authority from presentation. The online server runs its own economy instance for each connected identity, validates phase, balances, item IDs, ownership, equip commands and elimination/round IDs, and broadcasts authoritative snapshots. Local damage/outcome controls cannot award online rewards. Guest identities use room connections and reconnect tokens; account authentication is not implemented.

### Economy verification

`npm test` includes economy tests for successful/invalid/duplicate/insufficient purchases, exact refunds and replay rejection, phase boundaries, rewards/credit cap, ownership-restricted switching, armor consumption/depletion/configuration, carried armor repair/refund, new rounds and immutable snapshots. Browser integration additionally exercises these through the actual game HUD, input, target damage and local round controls. Mobile testing uses Chromium emulation; physical devices and other browser engines still require verification.

## Mobile test

Use landscape orientation. The left joystick moves, the right side of the screen accepts drag aiming, and the Fire / Reload / Jump buttons work independently with simultaneous touches. The pause button opens the pause menu. Rotate to landscape if the orientation prompt appears.

The upgraded controls also include held ADS and Sprint, slot buttons, Loadout (cycle the primary), and Inspect. Each action owns an independent pointer; releasing/cancelling Fire or ADS stops it, including when the window loses focus.

For a phone on the same network as your development computer, use that computer's LAN IP with port 5173; Vite binds to `0.0.0.0`. In a hosted cloud workspace, expose/forward the Vite port through your workspace's supported port UI. A phone's `localhost` refers to the phone itself.

## Code layout

- `src/App.tsx`: menus, settings, pause flow, HUD, and game lifecycle.
- `src/game/game.ts`: render loop, movement, collision, shooting, ammunition, and target state.
- `src/game/map.ts`: procedural fortress, collision geometry, site signs, dummies, lighting, and skyline.
- `src/game/input.ts`: desktop events, pointer lock, and touch input state.
- `src/game/weapon.ts`: procedural sidearm, animations, and Web Audio effects.
- `src/game/weapons.ts`: data-driven weapon definitions, inventory, ammunition and action transitions.
- `src/game/effects.ts`: capped tracers, impact sparks/dust and their cleanup.
- `src/game/settings.ts` and `src/components/SettingsPanel.tsx`: validated persistent aim/camera settings and their UI.
- `src/components/TouchControls.tsx`: independent captured pointers for mobile controls.

Unmounting disposes the engine, scene, meshes, materials, textures, audio context, render loop, and input listeners. Gameplay pauses on focus loss; live processes do not need a backend service.

The purchase phase adds `src/game/catalog.ts` (shop metadata), `src/game/economy.ts` (central validated Practice authority), `src/components/BuyMenu.tsx` and `WeaponPreview.tsx` (responsive shop), and `tests/economy.test.mjs`. Existing game/input/inventory/HUD modules integrate those systems; weapon models and the fortress remain unchanged.


## Royal Signal Core — tactical plant / defuse sandbox

Choose **Royal Signal Core** from the main menu. Free Range and Economy Drill remain separate working modes. This new mode is an **offline objective sandbox**, with locally controlled Attackers and Defenders. Other roles are shootable procedural stand-ins, not AI opponents or network players. Pause with Esc to open **Local Objective Sandbox** controls: select a role, travel to A/B for testing, take damage, disconnect a role, or configure the local host's 1v1 / 2v1 format and active site (A only, B only, or both). Applying host configuration resets the match.

| Stage | Duration / behavior |
| --- | --- |
| Buy | 20 seconds, automatically enters combat |
| Combat | 100 seconds before planting |
| Plant | 4 uninterrupted seconds |
| Planted core | 35-second countdown |
| Defuse | 6 uninterrupted seconds |
| Result | Victory banner, score and Next Round / Rematch buttons |
| Transition | 1 second; objective interactions are disabled |

**Controls:** 4 equips the carried device; hold F to plant, defuse or recover a dropped core when eligible. B opens the existing buy shop. Hold Tab for the scoreboard. Weapon inspection moved from F to **V**. Existing 1/2/3 switching, WASD, mouse aiming, fire/reload/jump and mobile controls still work. Mobile adds core equip, a captured hold-to-interact button with a progress circle, and a scoreboard button.

Only the living, connected designated Attacker carrier can plant, and only inside an enabled site with the core equipped. The original site centers are A **(-19, 4.5)** and B **(18, 12)** in fortress XZ coordinates. A carrier lost before planting drops the core; another living Attacker within reach can recover it with F, becoming the new designated carrier, then equip4 and start a fresh hold. Defenders can only defuse a planted core within 2.2 meters.

Release, movement beyond the 0.15-meter stationary allowance, leaving interaction range, damage (including armor-absorbed hits), death, disconnection or holstering cancels the hold. Progress does not resume after cancellation. Opening the shop or pausing also clears held input. Combat timeout wins for Defenders; countdown expiry wins for Attackers; a completed defuse wins for Defenders. Pre-plant team elimination wins for the surviving team. After planting, killing/disconnecting all Attackers does **not** end the countdown or remove the need to defuse. If all Defenders are eliminated after planting, Attackers win. At an exact deadline tie, countdown expiry takes priority over interaction completion.

### Try both sides in one browser

1. Enter Royal Signal Core. Buy equipment during the automatic 20-second buy phase; there is no manual early-start button in this mode.
2. Close the shop, pause with Esc, choose Attacker 1 and **Travel A**, then resume. Wait for combat, equip4, and hold F. Release early to test cancellation, then complete a fresh four-second hold.
3. Pause and choose Defender 1. **Travel A** places you near the planted core without overlapping the Attacker stand-in. Resume and hold F for six seconds to defuse. You can walk there normally instead of using the explicit sandbox travel helper.
4. Test damage or disconnection from the pause panel, fire purchased weapons at opposing stand-ins, or let the countdown expire. The minimap shows active sites, your location and the carried/dropped/planted core. The original 3D core has placement/arming/defuse animation, pulsing light and increasingly frequent countdown beeps.
5. Next Round preserves credits, owned gear and remaining armor, restores HP/ammunition, and starts another timed buy. Rematch resets scores and every local account to 800 credits with its knife. Next Round retains disconnected slots; Rematch explicitly reconnects them. Role inventories/accounts are independent.

Local pause/focus loss freezes this offline sandbox's clock. The shop does not pause it. A production online round must use the server clock continuously even when one client pauses or disconnects. The final result releases pointer lock so its buttons work; use Next Round or Rematch to continue.

### Rule authority and online boundary

`objective.ts` contains a deterministic, rendering-independent round state machine. `ObjectiveSession` is its **local trusted adapter** for collision-resolved positions, armor-aware damage, per-role inventories, economy phase changes and one-time payouts. `ObjectiveView` consumes snapshots only and cannot declare a plant, defuse or win. HUD progress is read from authority snapshots; it is never sent back as completion.

Interaction commands contain an ID, displayed round, monotonic epoch and intent (`interact-start` / `interact-stop`). There is no client `plant-complete`, `defuse-complete`, time-advance or victory command. The authority checks role, carrier, equipment, site/range, alive/connected state and uninterrupted hold, then owns completion and round resolution. IDs are deduplicated with fingerprints, stale epochs/rounds are rejected, and ledgers are bounded without evicting replay protection. NextRound/Rematch require host context supplied by the adapter. Damage and disconnect methods take trusted authoritative observations, never raw client declarations.

**Private online custom rooms now run this authority through `server/src/MatchSimulation.ts` and Colyseus `BurmaRoom`.** The offline sandbox remains isolated. The online server owns clocks, collision validation, damage and rewards; derive actor/host identity from the connection; validate round/epoch on delayed observations; and broadcast read-only snapshots. Never expose the local role-switch, travel, damage or simulated economy controls as authoritative network actions. Local browser owners can ultimately alter their offline runtime; these safeguards do not claim to prevent offline cheating.

### Objective verification

`npm test` now includes 24 objective-rule tests plus adapter tests and all previous gameplay/economy/input tests. They cover plant and cancellation paths, defuse and cancellation, deadline ties/large clock steps, timeout/countdown, pre/postplant elimination, carrier recovery, disconnects, frozen snapshots, stale/duplicate/malformed intents, unauthorized host commands, rematch/transition, duplicate trusted events, bounded ledgers, and armor/economy payout integration. A getter-backed position regression exercises Babylon-like vectors through plant/defuse.

The offline sandbox was checked in desktop Chromium and emulated mobile with natural buy/plant/defuse timings. The current private-room server adds real WebSocket join, host, capacity and reconnect tests; see [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for current online verification. Internet latency/reordering, physical phones, other browser engines and audible sound quality remain untested.

New modules: `src/game/objective.ts`, `objectiveSession.ts`, `objectiveView.ts`, `src/components/ObjectiveHud.tsx`, and `tests/objective*.test.mjs`. Existing game, shop, economy, HUD and input integrate the mode while retaining the earlier Free Range and Economy Drill workflows.

## Bagan Old City, language and atmosphere

The playable map is an original secular fortified town, with terracotta brick and weathered stucco, layered arches, vaulted gates, wooden houses, cloth market awnings, pots, woven baskets, planting and geometric civic decoration. Sandstone paving distinguishes the central courtyard and market court; timber decks identify the eastern passage. Distant heritage-inspired silhouettes are outside the sealed playable perimeter, noninteractive and non-destructible. No real sacred building is used as a combat space.

Three lanes connect the existing Attacker and Defender spawns: **Market Walk → A / Market Court**, **Central Courtyard**, and **Timber Passage → B / Timber Yard**. Their junctions provide alternative rotations and cover. A central wagon screens the direct spawn-to-spawn sightline. Named HUD callouts identify each area. Existing objective site positions and all three practice targets remain compatible with earlier rules. `MAP_ROUTES` in `map.ts` documents the six spawn-to-site/center navigation routes for collision verification.

Open **Settings → Language** to choose English or မြန်မာ. Menus, settings, weapon shop, health/armor, weapon actions, round phases, objective progress/results, scoreboard and local sandbox controls update immediately and remember the selection. Original weapon/brand names and physical key labels retain their identity. The bundled Noto Sans Myanmar regular/bold fonts load locally and include their font license in `src/assets/fonts/LICENSE-Noto.txt`; no font CDN is required. Myanmar translations have automated coverage and browser layout checks, but still need a native Burmese speaker's editorial review.

The **Rooms** panel creates and joins private online rooms when the separate server is running, with translated guest, team, readiness and host controls. Offline stand-ins remain exclusive to the local objective sandbox.

Settings also provide **Auto / Low / Medium / High graphics**, **30 / 60 FPS render targets**, and **adaptive resolution**. Auto chooses Medium for coarse-pointer devices and High for desktop. Low removes shadows and small decorative details; Medium uses 512px shadows, High 1024px. Collision, bullet obstruction, objective sites and route geometry stay identical across tiers. Adaptive resolution reduces pixel count under a sustained render shortfall and cautiously restores it after healthy samples. The FPS HUD displays measured rendering rate, quality and resolution percentage. These are scalable budgets, not a promise of a particular frame rate on untested devices.

Graphics and language changes update the existing Babylon scene instead of recreating it. The 30 FPS option limits rendering while input, movement and objective rules continue on the game loop. A loading progress indicator waits for scene readiness before enabling Practice, Economy Drill or Royal Signal Core.

Enable **Sound effects** for synthesized wind, market wood/cloth ambience, surface-specific sand/stone/wood footsteps, shop chimes and round cues. Audio starts only after a browser-approved user gesture, pauses with gameplay, obeys the sound setting and disposes its nodes/context/listeners. Footsteps use actual collision-resolved horizontal movement, so pushing into a wall or jumping does not produce walking steps. Shop open/close, round start and victory have short UI transitions; reduced-motion preferences suppress decorative transitions.

All new environment art, textures, cloth and equipment visuals are procedural placeholders. Ambience/foley are original synthesized placeholders, not field recordings or voice performances. No authored GLB models, recorded Burmese market sound, music or professional texture assets are included.

### Art and localization checks

`npm test` includes graphics-budget/adaptive-resolution tests and Myanmar dictionary/template/fallback tests, in addition to all existing inventory, input, economy and objective rules. Browser checks cover all six navigation routes and four perimeter walls at every graphics tier, practice-target ray visibility, identical collision geometry, skyline isolation, font loading, language persistence and settings changes without scene recreation. Desktop and landscape touchscreen paths are checked with Chromium emulation. Physical mobile performance, Safari/Firefox rendering, native-language wording and human listening quality still require device/editorial testing.

New modules are `src/i18n.tsx`, `i18nCore.ts`, `locales/common.ts`, `locales/gameplay.ts`, `game/graphics.ts` and `game/environmentAudio.ts`. `App.tsx`, settings/shop/objective/touch components and `styles.css` apply the translated visual theme; `game.ts` and `map.ts` integrate quality, callouts, ambience and original environment geometry. The existing arsenal, input, economy and objective rule modules remain the gameplay authorities.
