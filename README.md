# BURMA STRIKE

An original, single-player first-person browser practice range built with React, TypeScript, Vite, and Babylon.js. The fictional Aeyar Fortress uses procedural Bagan-inspired architecture, materials, targets, and weapon geometry. No external models, copied maps, accounts, or multiplayer services.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
cd /workspace/Burma-Strike
npm ci
npm run dev
```

Open `http://localhost:5173` in a current Chrome, Edge, Firefox, or Safari with WebGL enabled. Click **Play Practice**, allow mouse capture, and click the game canvas if the browser asks for another capture gesture.

For a production check:

```sh
npm run build
npm run preview
```

Open the address printed by Vite (normally port 4173 for preview).

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
| Inspect weapon | F |

Practice has three 100-HP dummies. Body hits deal 34 damage; headshots deal 100. Dummies respawn after three seconds. Walls, gates, and crates stop bullets and player movement. The SHWE-9 pistol starts with a 12-round magazine and 48 reserve rounds. Reload takes 1.6 seconds. Use **Esc → Reset Range & Resupply** to restore ammunition and scores. In Free Range, health stays at 100 because targets do not attack. Economy Drill provides a real HP/armor damage path through its explicitly labeled local test controls.

Settings adjust aim sensitivity, synthesized sound effects, and the FPS display; they persist in browser storage. Field Guide explains controls inside the menu.

## Tactical arsenal upgrade

The original fortress and Practice targets are retained. You start with the SHWE-9 pistol; slot 1 contains a selectable primary. Press **N** to cycle rifle → SMG → sniper, or choose a primary from the pause menu. Each weapon retains its own magazine, reserve and cooldown. Switching loadouts does not supply free ammo. Slot 4 is reserved and disabled because Practice carries no objective device. No multiplayer code or service is present in this project.

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

Manual smoke test: launch Practice; switch 1/2/3; cycle N; hold rifle fire; reload and try firing/switching before completion; hold RMB for ADS; choose sniper and verify scope; inspect with F; knife a nearby dummy; fire into a wall/crate and sand; sprint/jump into cover; pause/resume; change/reset settings and refresh. On mobile, combine joystick + drag aiming + held Fire/ADS, release/cancel touches, switch slots, reload, and rotate the device. Confirm no input remains stuck.


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

There is **no multiplayer server** in this repository. `PracticeEconomy` is explicitly local-only and never sends or claims real online purchases. Credits, HP, armor, ownership and refund receipts are private fields, changed only through validated commands; the React UI gets immutable copied snapshots and has no balance/armor setters. Credits and armor are **not** restored from localStorage. Browser owners can ultimately alter their own offline runtime; this is not an anti-cheat or server-security claim.

`EconomyCommand`, `EconomySnapshot` and the pure rules isolate the authority from presentation. Any future online implementation must execute these rules on the authenticated server, validate phase, balances, item IDs, ownership, equip commands and authoritative elimination/round IDs, and broadcast server snapshots. Local simulation commands and the damage/outcome buttons must never be accepted as authoritative network rewards.

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
