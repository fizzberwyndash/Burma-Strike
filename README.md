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

Practice has three 100-HP dummies. Body hits deal 34 damage; headshots deal 100. Dummies respawn after three seconds. Walls, gates, and crates stop bullets and player movement. The KITE–12 pistol starts with a 12-round magazine and 48 reserve rounds. Reload takes 1.6 seconds. Use **Esc → Reset Range & Resupply** to restore ammunition and scores. Health stays at 100 because practice targets do not attack.

Settings adjust aim sensitivity, synthesized sound effects, and the FPS display; they persist in browser storage. Field Guide explains controls inside the menu.

## Mobile test

Use landscape orientation. The left joystick moves, the right side of the screen accepts drag aiming, and the Fire / Reload / Jump buttons work independently with simultaneous touches. The pause button opens the pause menu. Rotate to landscape if the orientation prompt appears.

For a phone on the same network as your development computer, use that computer's LAN IP with port 5173; Vite binds to `0.0.0.0`. In a hosted cloud workspace, expose/forward the Vite port through your workspace's supported port UI. A phone's `localhost` refers to the phone itself.

## Code layout

- `src/App.tsx`: menus, settings, pause flow, HUD, and game lifecycle.
- `src/game/game.ts`: render loop, movement, collision, shooting, ammunition, and target state.
- `src/game/map.ts`: procedural fortress, collision geometry, site signs, dummies, lighting, and skyline.
- `src/game/input.ts`: desktop events, pointer lock, and touch input state.
- `src/game/weapon.ts`: procedural sidearm, animations, and Web Audio effects.
- `src/components/TouchControls.tsx`: independent captured pointers for mobile controls.

Unmounting disposes the engine, scene, meshes, materials, textures, audio context, render loop, and input listeners. Gameplay pauses on focus loss; live processes do not need a backend service.
