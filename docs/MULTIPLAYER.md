# Private online custom rooms

BURMA STRIKE retains Free Range, Economy Drill and the offline Royal Signal Core sandbox. Private online matches use the separate Colyseus server in `server/`; the browser never hosts authoritative gameplay.

## Install and start

Use Node.js **22.12 or newer**. From the project root:

```sh
npm ci
npm --prefix server ci
npm run server:build
npm run server:start
```

Keep that terminal running. In a second terminal, from the same project root:

```sh
npm run dev -- --port 5173 --strictPort
```

Open `http://localhost:5173/`. On Windows PowerShell, replace `npm` with `npm.cmd` if execution policy blocks `npm.ps1`. Start commands must run in the updated repository folder containing `package.json`; starting an older Vite project will show its old content.

For server development, use `npm run server:dev` instead of build/start. The server's dev and production commands both support `server/.env`. Copy `server/.env.example` to `server/.env` before changing configuration. Restart the server after changing environment values. The default server binds `0.0.0.0:2567` and allows frontend origins `http://localhost:5173`, `http://127.0.0.1:5173` and their port 4173 preview equivalents.

The frontend normally connects to `ws://<frontend-hostname>:2567` (or `wss://` on HTTPS). To change this, copy root `.env.example` to `.env`, set `VITE_SERVER_URL`, and restart Vite or rebuild the frontend. An invalid online endpoint displays a room error while offline Practice remains usable.

For a phone or another computer on the same LAN, open `http://<development-computer-LAN-IP>:5173/`, add that exact frontend origin to server `ALLOWED_ORIGINS`, and allow inbound TCP 5173/2567 through your own firewall. A phone's localhost refers to the phone. For a cloud workspace, forward both ports or provide a WebSocket reverse proxy. An HTTPS public frontend requires a valid TLS/WSS endpoint; deployment/TLS provisioning is not included here.

## Two-player test

1. Open the game in two independent browser windows/profiles, or two devices. Choose **Create Custom Room**, enter a guest name, and create a private lobby in the first client.
2. Copy the six-character code. In the other client choose **Join Custom Room**, enter the code and a different name, and join.
3. Both clients must show the same two connected human players. The host can move a player between teams; each team must have at least one human and may contain at most five reserved seats.
4. Choose Bagan Old City, 1–30 total rounds, and A only/B only/both sites. Apply changes before readying. Team/configuration changes clear readiness.
5. Both players press **I Am Ready**. The host presses **Start Match**. Both enter the same 3D map and see interpolated human avatars, not practice stand-ins.
6. Buy a SHWE-9 and/or armor with the 800 starting credits. The server's 20-second buy phase enters combat automatically. Move through the courtyard and verify that the other client sees movement, aim, weapons and shots. B opens the server-validated shop; 1/2/3 switch owned equipment,4 equips the carried core, F interacts and Tab opens the scoreboard.
7. Esc pauses that client's controls; the online clock continues. **Room / Lobby** opens room information; the host can return everyone to the lobby after the configured rounds finish. Leaving a live match does not pause it.

## Three-player and ten-player tests

Repeat joining in a third independent client. Default balancing assigns 2 Attackers and 1 Defender. The lobby warns about the imbalance but permits the ready host to start. Try A-only for this custom composition. Any uneven composition is allowed if both teams contain humans and neither exceeds five seats.

For 5v5, join ten distinct guest clients before starting. The server rejects an eleventh reservation and any team switch that would create a sixth teammate. All connected players must ready; then the host starts. Each client should render nine remote avatars. Only Bagan Old City currently exists; the map selector intentionally lists that one real map.

Mobile uses the existing landscape joystick, right-side drag aim, independent Fire/ADS/Reload/Jump controls, weapon slots, shop and contextual objective hold button. The lobby scrolls, preserves safe-area padding and exposes large tap targets.

## Authority and reconnection

The server accepts bounded movement/aim inputs and allowlisted actions. It advances movement at 60 Hz, applies acceleration/gravity/collision, and rejects client-declared positions, health, damage, credits or ownership. Input sequence numbers prevent old input replay; inactive input expires. Weapon ownership, draw/holster/reload, ammunition, rate of fire, ray hit/range, armor absorption, purchases, refunds, rewards and round results use shared rules on the server. Teammates obstruct shots but do not take friendly damage.

`worldGeometry.json` contains the actual transformed solid triangles extracted from `buildMap`. Server collision and ray occlusion use Babylon's CPU collision/picking against those exact triangles; decorative skyline and dummies are excluded. Run `npm run world:generate` after map geometry changes; `npm run world:check` and tests detect stale data.

Colyseus schemas replicate a versioned snapshot at 20 Hz. The frontend predicts its own movement, reconciles acknowledged positions, keeps local mouse aiming immediate, and buffers remote positions for roughly 100 ms interpolation. Shot streaks/hit confirmations use resolved server events. Client animation and cosmetic recoil cannot award damage.

A dropped connection reserves its seat for 30 seconds by default (configurable 5–120 seconds). Automatic reconnect is enabled; reloading can use **Rejoin Previous Room** from that tab's recent saved token. Tokens are scoped to the server and kept in sessionStorage, never shared through room codes or printed to logs. No stale movement/fire/purchase messages are buffered across reconnect. A reconnect preserves identity/equipment; disconnect counts as an elimination in the current live round and reconnect does not grant a new life. Players return alive next round. The oldest connected player becomes host when the host drops/leaves. A returning former host does not steal host control.

Rooms are private and excluded from public joining/listing. Code lookup reveals only a room ID, and rooms lock against new joins after a match starts. HTTP lookups/matchmaking and per-client action/input streams are rate-limited; message shapes, bounds and payload size are checked. Allowed browser origins are explicit, including credentialed SDK preflights. Guest names support 2–20 Unicode letters/marks/numbers plus spaces, underscores and hyphens; they are display labels, not authenticated accounts.

## Checks and implementation

```sh
npm test
npm run world:check
npm run build
npm run server:test
npm run server:build
```

Server tests open real local HTTP/WebSocket connections on ephemeral ports; an execution sandbox may require local-network permission. The browser check script uses Python Playwright plus Chromium against running frontend/backend servers:

```sh
python -m pip install playwright
python -m playwright install chromium
python scripts/test-multiplayer-browser.py --players 2,3,10
```

Set `BURMA_CHROMIUM_PATH` if your Chromium executable is installed outside Playwright. The script tests independent browser contexts, real UI joins/readiness, one shared code, remote avatars, keyboard movement on every peer and scoreboard membership in that order. Output JSON and screenshots go to `/tmp/burma-multiplayer-browser` by default; use `--output` to change it. The many-client harness limits expensive drawing to 1 Hz and uses the Low resolution budget on software-rendered CI; simulation, normal inputs, UI and WebSockets remain active. It activates each observer before reading the rendered scene and waits for authoritative movement acknowledgements. These checks establish synchronization rather than a hardware frame-rate benchmark.

Install Playwright/browser tooling separately if absent; these tools are not needed to play. The mixed desktop/touch scenarios can run independently within the real round timers:

```sh
python scripts/test-multiplayer-interactions.py --section combat
python scripts/test-multiplayer-interactions.py --section objective
```

The combat section exercises purchases, shooting/armor, reloads, switching, ADS and simultaneous touch controls. The objective section walks both players through the actual map, tests planting/defusing and cancellation, then verifies leaving restores local Practice. Neither script sets authoritative positions, damage, money or round time.

### Local verification

Frontend build, all 10 frontend test files, current collision generation, backend build and all 21 backend tests pass. Backend tests use real HTTP/WebSocket connections and include ten clients sending 20 Hz controls, authoritative movement/speed bounds, purchases, armor, weapons, private joins, capacity/team limits, host migration, disconnections and reconnection expiry.

Independent Chromium browser checks passed in sequence for two players, three players (2v1) and ten players (5v5). The ten-browser check confirmed nine remote avatars per client, host movement received by every peer and ten scoreboard entries, with no page exceptions. The mixed desktop/landscape-touch checks confirmed server damage (100 HP/25 armor to 87 HP/5 armor), reload/switch/ADS, simultaneous movement/aim/fire, jumping, four-second planting, six-second defusing and interruption. The isolated objective scenario also restored Practice to 12 pistol rounds, three dummies and zero remote avatars after leaving. These were local software-rendered/emulated tests; physical-device and public-internet performance remain untested.

Main implementation files:

- `server/src/server.ts`, `index.ts`, `config.ts`: Colyseus startup, origins, HTTP lookup/health, environment and shutdown.
- `server/src/BurmaRoom.ts`, `validation.ts`, `MatchSimulation.ts`: room membership/host/ready/team limits, validation/rate limits and authoritative matches.
- `src/network/protocol.ts`, `client.ts`: shared wire types, SDK connections and reconnect lifecycle.
- `src/shared/world.ts`, `worldGeometry.json`, `scripts/generate-world.mjs`: exact server collision and raycasting.
- `src/game/game.ts`, `remotePlayers.ts`, `objectiveView.ts`: responsive local view and interpolated remote presentation.
- `src/game/objective.ts`, `objectiveSession.ts`: backwards-compatible human rosters using the existing tested objective/economy rules.
- `src/App.tsx`, `components/RoomPanel.tsx`, `ObjectiveHud.tsx`, `BuyMenu.tsx`, `styles.css`, `locales/multiplayer.ts`: English/Myanmar lobby, shop/scoreboard and online/offline UI boundaries.
- `server/test/*.test.ts`, `tests/network-client.test.mjs`, `online-presentation.test.mjs`, `world.test.mjs`: network, authority, lifecycle and presentation regression coverage.

Version pins use the current compatible Colyseus 0.18 line: core 0.18.27, WebSocket transport 0.18.4, Schema 5.0.45 and SDK 0.18.9. APIs were checked against the official documentation source at commit 619b4c595aa8b148812d64e9d09d079ac4784e09 and published package typings: [Room lifecycle](https://docs.colyseus.io/room/lifecycle), [reconnection](https://docs.colyseus.io/room/reconnection), [visibility](https://docs.colyseus.io/matchmaker/visibility), [Schema](https://docs.colyseus.io/state/schema), [official source](https://github.com/colyseus/colyseus-docs).

## Current limits

This is a single-process, in-memory custom-room server. Server restart loses rooms, scores and reconnect reservations. There is no account authentication, database, public matchmaking, voice chat, spectators, mid-match new-player joining, region routing, Redis/multiworker coordination, ranked progression, automatic side swap or deployment automation. There is no server rewind/lag compensation or interest-management anti-wallhack system; all player positions are replicated for avatar rendering. A room code is an invitation mechanism, not a password/account security boundary.

The server foundations validate game rules; they do not claim comprehensive anti-cheat. Hardware/network latency tuning, internet-hosted sessions, physical mobile performance, non-Chromium browsers and native Burmese wording need further testing. No FPS guarantee is made from headless software rendering. No paid API is required.
