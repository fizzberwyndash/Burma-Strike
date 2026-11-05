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
| Cycle Practice primary | B |
| Aim down sights | Hold right mouse button |
| Sprint forward | Hold Shift + W |
| Inspect weapon | F |

Practice has three 100-HP dummies. Body hits deal 34 damage; headshots deal 100. Dummies respawn after three seconds. Walls, gates, and crates stop bullets and player movement. The KITE–12 pistol starts with a 12-round magazine and 48 reserve rounds. Reload takes 1.6 seconds. Use **Esc → Reset Range & Resupply** to restore ammunition and scores. Health stays at 100 because practice targets do not attack.

Settings adjust aim sensitivity, synthesized sound effects, and the FPS display; they persist in browser storage. Field Guide explains controls inside the menu.

## Tactical arsenal upgrade

The original fortress and Practice targets are retained. You start with the KITE–12 pistol; slot 1 contains a selectable primary. Press **B** to cycle rifle → SMG → sniper, or choose a primary from the pause menu. Each weapon retains its own magazine, reserve and cooldown. Switching loadouts does not supply free ammo. Slot 4 is reserved and disabled because Practice carries no objective device. No multiplayer code or service is present in this project.

| Weapon | Magazine / reserve | Fire mode | Body / head damage | Reload |
| --- | --- | --- | --- | --- |
| KITE–12 pistol | 12 / 48 | Semi-auto | 34 / 100 | 1.6 s |
| TAMARIND AR rifle | 30 / 90 | Automatic | 34 / 100 | 2.15 s |
| SWIFT–24 SMG | 24 / 96 | Automatic | 25 / 70 | 1.8 s |
| HORNBILL S5 sniper | 5 / 20 | Semi-auto | 100 / 150 | 2.6 s |
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

Manual smoke test: launch Practice; switch 1/2/3; cycle B; hold rifle fire; reload and try firing/switching before completion; hold RMB for ADS; choose sniper and verify scope; inspect with F; knife a nearby dummy; fire into a wall/crate and sand; sprint/jump into cover; pause/resume; change/reset settings and refresh. On mobile, combine joystick + drag aiming + held Fire/ADS, release/cancel touches, switch slots, reload, and rotate the device. Confirm no input remains stuck.

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
