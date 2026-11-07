import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Room } from '@colyseus/sdk';
import { createGameServer } from '../src/server';
import { ROOM_TYPE } from '../../src/network/protocol';
import type { OnlineAction, OnlineInput, OnlineSnapshot, WireState } from '../../src/network/protocol';

type Peer = { client: Client; room: Room<any, WireState>; errors: string[] };
let server: ReturnType<typeof createGameServer>;
let endpoint = '';
let httpEndpoint = '';
const peers = new Set<Peer>();

async function until<T>(read: () => T | null | false | undefined, label: string, timeout = 8000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}
function state(peer: Peer): OnlineSnapshot | null {
  const json = peer.room.state?.snapshotJson;
  return json ? JSON.parse(json) as OnlineSnapshot : null;
}
const snapshot = (peer: Peer, check: (value: OnlineSnapshot) => boolean = () => true, timeout?: number) =>
  until(() => { const value = state(peer); return value && check(value) ? value : null; }, 'authoritative room snapshot', timeout);
const actor = (peer: Peer) => state(peer)!.players.find(player => player.id === peer.room.sessionId)!;
const action = (peer: Peer, value: OnlineAction | unknown) => peer.room.send('action', value);
async function rejected(peer: Peer, value: unknown): Promise<string> {
  const before = peer.errors.length;
  action(peer, value);
  return until(() => peer.errors.length > before && peer.errors.at(-1), 'action rejection');
}
function track(client: Client, room: Room<any, WireState>): Peer {
  room.reconnection.maxEnqueuedMessages = 0;
  const peer = { client, room, errors: [] as string[] };
  room.onMessage('error', (error: { message: string }) => peer.errors.push(error.message));
  room.onMessage('shot', () => undefined);
  room.onError((_code, message) => peer.errors.push(message ?? 'connection error'));
  peers.add(peer);
  return peer;
}
async function create(username = 'Host'): Promise<Peer> {
  const client = new Client(endpoint);
  const peer = track(client, await client.create<WireState>(ROOM_TYPE, { username }));
  await snapshot(peer, value => value.players.length === 1);
  return peer;
}
async function join(host: Peer, username: string): Promise<Peer> {
  const code = state(host)!.code;
  const lookup = await fetch(`${httpEndpoint}/api/rooms/${code}`);
  assert.equal(lookup.status, 200);
  const { roomId } = await lookup.json() as { roomId: string };
  const client = new Client(endpoint);
  const peer = track(client, await client.joinById<WireState>(roomId, { username }));
  await snapshot(peer, value => value.players.some(player => player.id === peer.room.sessionId));
  return peer;
}
async function group(count: number): Promise<Peer[]> {
  const host = await create(`Host${count}`);
  const result = [host];
  for (let i = 1; i < count; i++) result.push(await join(host, `Guest${i}`));
  await snapshot(host, value => value.players.length === count);
  return result;
}
async function readyAndStart(group: Peer[]): Promise<OnlineSnapshot> {
  for (const peer of group) action(peer, { type: 'ready', ready: true });
  await snapshot(group[0], value => value.players.every(player => player.ready));
  action(group[0], { type: 'start' });
  return snapshot(group[0], value => value.stage === 'match' && value.objective?.phase === 'buy' && value.players.every(player => player.inventory.action === 'ready'));
}

// Each scenario owns its server/IP rate-limit budget; a preceding attack test
// must not exhaust the normal ten-player lobby's legitimate request allowance.
beforeEach(async () => {
  server = createGameServer({ host: '127.0.0.1', reconnectSeconds: 2, maxRooms: 100 });
  await server.listen(0, '127.0.0.1');
  const port = (server.httpServer.address() as AddressInfo).port;
  endpoint = `ws://127.0.0.1:${port}`;
  httpEndpoint = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  for (const peer of [...peers]) {
    await peer.room.leave().catch(() => undefined);
    peers.delete(peer);
  }
  await server?.shutdown();
});

test('two independent clients share a private six-character room and cannot discover it through public joining', async () => {
  const [host, guest] = await group(2);
  const hostState = await snapshot(host, value => value.players.length === 2);
  const guestState = await snapshot(guest, value => value.players.length === 2);
  assert.match(hostState.code, /^[A-Z2-9]{6}$/);
  assert.equal(hostState.code, guestState.code);
  assert.equal(hostState.hostId, host.room.sessionId);
  assert.notEqual(host.room.sessionId, guest.room.sessionId);
  assert.equal(hostState.players.filter(player => player.team === 'attackers').length, 1);
  assert.equal(hostState.players.filter(player => player.team === 'defenders').length, 1);
  assert.equal((await fetch(`${httpEndpoint}/api/rooms/INVALID`)).status, 404);
  assert.equal((await fetch(`${httpEndpoint}/api/rooms/ZZZZZZ`)).status, 404);
  await assert.rejects(new Client(endpoint).join(ROOM_TYPE, { username: 'NoPublicMatch' }));
  const another = await create('OtherHost');
  assert.notEqual(state(another)!.code, hostState.code);
});

test('malformed names and prohibited origins cannot enter a lobby', async () => {
  for (const username of ['', '<script>', 'x'.repeat(21), null]) {
    await assert.rejects(new Client(endpoint).create(ROOM_TYPE, { username }));
  }
  const host = await create('မြန်မာ');
  await assert.rejects(new Client(endpoint).joinById(host.room.roomId, { username: '<img>' }));
  assert.equal(state(host)!.players.length, 1);
  const response = await fetch(`${httpEndpoint}/api/rooms/${state(host)!.code}`, { headers: { Origin: 'https://untrusted.example.test' } });
  assert.equal(response.status, 403);
});

test('credentialed browser preflight and HTTP replies use the exact allowed origin', async () => {
  const origin = 'http://localhost:5173';
  const preflight = await fetch(`${httpEndpoint}/matchmake/create/${ROOM_TYPE}`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-methods')!, /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers')!, /content-type/i);
  const response = await fetch(`${httpEndpoint}/matchmake/create/${ROOM_TYPE}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '' }),
  });
  assert.equal(response.ok, false);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.get('vary'), 'Origin');
});

test('repeated malformed network actions permanently remove the abusive seat', async () => {
  const [host, guest] = await group(2);
  const token = guest.room.reconnectionToken;
  guest.room.reconnection.enabled = false;
  for (let i = 0; i < 12; i++) action(guest, { type: 'damage', amount: 100 });
  await snapshot(host, value => value.players.length === 1 && value.players[0].id === host.room.sessionId);
  assert.ok(guest.errors.some(message => message === 'Malformed action.'));
  await assert.rejects(new Client(endpoint).reconnect(token));
  assert.equal(state(host)!.players[0].health, 100);
});

test('start requires two humans, both teams, all ready and host authority; an uneven 2v1 is allowed', async () => {
  const host = await create();
  action(host, { type: 'ready', ready: true });
  await snapshot(host, value => value.players[0].ready);
  await rejected(host, { type: 'start' });
  const guest = await join(host, 'Defender');
  await rejected(guest, { type: 'start' });
  await rejected(guest, { type: 'team', playerId: host.room.sessionId, team: 'defenders' });
  await rejected(guest, { type: 'configure', config: { mapId: 'bagan-old-city', rounds: 1, activeSite: 'A' } });
  await rejected(host, { type: 'start' });
  action(host, { type: 'team', playerId: guest.room.sessionId, team: 'attackers' });
  await snapshot(host, value => value.players.every(player => player.team === 'attackers'));
  action(host, { type: 'ready', ready: true }); action(guest, { type: 'ready', ready: true });
  await snapshot(host, value => value.players.every(player => player.ready));
  await rejected(host, { type: 'start' });
  action(host, { type: 'team', playerId: guest.room.sessionId, team: 'defenders' });
  await snapshot(host, value => value.players.find(player => player.id === guest.room.sessionId)?.team === 'defenders');
  const third = await join(host, 'AttackerTwo');
  action(host, { type: 'configure', config: { mapId: 'bagan-old-city', rounds: 1, activeSite: 'A' } });
  await snapshot(host, value => value.config.rounds === 1 && value.config.activeSite === 'A');
  const started = await readyAndStart([host, guest, third]);
  assert.equal(started.players.filter(player => player.team === 'attackers').length, 2);
  assert.equal(started.players.filter(player => player.team === 'defenders').length, 1);
  assert.equal(started.objective!.players.length, 3);
  assert.equal(started.objective!.config.activeSite, 'A');
  await assert.rejects(new Client(endpoint).joinById(host.room.roomId, { username: 'LateGuest' }));
});

test('ten independent clients start 5v5; an eleventh and a sixth teammate are rejected', async () => {
  const clients = await group(10);
  const host = clients[0];
  const full = state(host)!;
  assert.equal(full.players.filter(player => player.team === 'attackers').length, 5);
  assert.equal(full.players.filter(player => player.team === 'defenders').length, 5);
  await assert.rejects(new Client(endpoint).joinById(host.room.roomId, { username: 'Eleventh' }));
  const defender = full.players.find(player => player.team === 'defenders')!;
  await rejected(host, { type: 'team', playerId: defender.id, team: 'attackers' });
  await delay(60);
  assert.equal(state(host)!.players.filter(player => player.team === 'attackers').length, 5);
  const started = await readyAndStart(clients);
  assert.equal(started.objective!.players.length, 10);
  for (const client of clients) {
    const seen = await snapshot(client, value => value.stage === 'match' && value.players.length === 10);
    assert.equal(new Set(seen.players.map(player => player.id)).size, 10);
    assert.equal(seen.objective!.players.filter(player => player.team === 'attackers').length, 5);
  }
});

test('ten live clients observe the same bounded movement during natural combat', { timeout: 45000 }, async () => {
  const clients = await group(10);
  const host = clients[0];
  const hostId = host.room.sessionId;
  await readyAndStart(clients);
  // Observe the real buy deadline. No authority time or position setters are used.
  await snapshot(host, value => value.objective?.phase === 'combat', 24000);
  for (const peer of clients) await snapshot(peer, value => value.objective?.phase === 'combat');
  const before = { ...actor(host).position };
  const sequences = new Map(clients.map(peer => [peer, actor(peer).lastInput]));
  const sendErrors: string[] = [];
  function sendInputs(moving: boolean) {
    for (const peer of clients) {
      const seq = sequences.get(peer)! + 1;
      sequences.set(peer, seq);
      const input: OnlineInput = {
        seq, moveX: 0, moveY: moving && peer === host ? 1 : 0,
        yaw: actor(peer).team === 'attackers' ? 0 : Math.PI, pitch: 0,
        sprint: false, ads: false, fire: false, jump: false,
      };
      try { peer.room.send('input', input); }
      catch (error) { sendErrors.push(String(error)); }
    }
  }
  const began = performance.now();
  sendInputs(true);
  const timer = setInterval(() => sendInputs(true), 50);
  try { await delay(1100); }
  finally { clearInterval(timer); }
  const elapsed = (performance.now() - began) / 1000;
  sendInputs(false);
  const stoppedSequence = sequences.get(host)!;
  await snapshot(host, () => actor(host).lastInput >= stoppedSequence);
  await delay(250); // Allow the server's ordinary deceleration and state patches.
  assert.deepEqual(sendErrors, []);
  const authoritative = { ...actor(host).position };
  const distance = Math.hypot(authoritative.x - before.x, authoritative.z - before.z);
  assert.ok(authoritative.z > before.z + 3, 'valid combat inputs move the host forward');
  assert.ok(Math.abs(authoritative.x - before.x) < .02, 'forward input does not invent strafing');
  assert.ok(distance <= elapsed * 5.5 + .5, `movement ${distance} exceeds the elapsed-time speed bound`);
  for (const peer of clients) {
    const seen = await snapshot(peer, value => {
      const player = value.players.find(item => item.id === hostId);
      return !!player && player.lastInput >= stoppedSequence && player.position.z > before.z + 3;
    });
    const visibleHost = seen.players.find(player => player.id === hostId)!;
    assert.ok(Math.hypot(visibleHost.position.x - authoritative.x, visibleHost.position.z - authoritative.z) < .15,
      'every peer receives the same server-resolved host position');
    assert.equal(seen.players.length, 10);
    assert.ok(seen.players.every(player => player.connected && player.alive));
    assert.deepEqual(peer.errors, []);
  }
});

test('unexpected host disconnection migrates authority and permits token-based reconnection to the same player', async () => {
  const [host, guest] = await group(2);
  const id = host.room.sessionId;
  const token = host.room.reconnectionToken;
  host.room.reconnection.enabled = false;
  // 4000 is Colyseus CONSENTED and intentionally releases the seat immediately.
  host.room.connection.close(4005, 'integration disconnect');
  await snapshot(guest, value => value.hostId === guest.room.sessionId && value.players.some(player => player.id === id && !player.connected));
  const reconnectClient = new Client(endpoint);
  const restored = track(reconnectClient, await reconnectClient.reconnect<WireState>(token));
  const restoredState = await snapshot(restored, value => value.players.some(player => player.id === id && player.connected));
  assert.equal(restored.room.sessionId, id);
  assert.equal(restoredState.players.length, 2);
  assert.equal(restoredState.hostId, guest.room.sessionId);
  assert.notEqual(restored.room.reconnectionToken, token);
  await guest.room.leave(); peers.delete(guest);
  await snapshot(restored, value => value.hostId === id && value.players.length === 1);
});

test('expired reconnection seats are released and host-only commands remain protected', async () => {
  const [host, guest] = await group(2);
  const droppedId = guest.room.sessionId;
  const token = guest.room.reconnectionToken;
  guest.room.reconnection.enabled = false;
  guest.room.connection.close(4005, 'expire seat');
  await snapshot(host, value => value.players.some(player => player.id === droppedId && !player.connected));
  await snapshot(host, value => !value.players.some(player => player.id === droppedId), 6000);
  await assert.rejects(new Client(endpoint).reconnect(token));
  const replacement = await join(host, 'Replacement');
  assert.notEqual(replacement.room.sessionId, droppedId);
  await rejected(replacement, { type: 'team', playerId: host.room.sessionId, team: 'defenders' });
});

test('network economy, stale input and client damage/money declarations remain server validated', { timeout: 45000 }, async () => {
  const clients = await group(2);
  const [host, guest] = clients;
  await readyAndStart(clients);
  await rejected(host, { type: 'buy', itemId: 'rifle' });
  action(host, { type: 'buy', itemId: 'pistol' });
  await snapshot(host, () => actor(host).economy.credits === 450 && actor(host).inventory.action === 'ready');
  action(host, { type: 'buy', itemId: 'light-armor' });
  await snapshot(host, () => actor(host).economy.credits === 0 && actor(host).armor === 25);
  await rejected(host, { type: 'buy', itemId: 'pistol' });
  action(host, { type: 'sell', itemId: 'light-armor' });
  await snapshot(host, () => actor(host).economy.credits === 450 && actor(host).armor === 0);
  action(host, { type: 'buy', itemId: 'light-armor' });
  await snapshot(host, () => actor(host).economy.credits === 0 && actor(host).armor === 25);
  await rejected(host, { type: 'credits', amount: 9000 });
  await rejected(host, { type: 'damage', targetId: guest.room.sessionId, amount: 100 });
  await rejected(host, { type: 'buy', itemId: 'sniper', price: 0 });
  assert.equal(actor(guest).health, 100);
  const invalid: OnlineInput & { position: { x: number; y: number; z: number } } = {
    seq: 100, moveX: 0, moveY: 0, yaw: 0, pitch: 0, sprint: false, ads: false, fire: false, jump: false,
    position: { x: 900, y: 50, z: 900 },
  };
  const errorCount = host.errors.length;
  host.room.send('input', invalid);
  await until(() => host.errors.length > errorCount, 'reject authoritative position payload');
  assert.notEqual(actor(host).lastInput, 100);
  const before = { ...actor(host).position };
  let seq = 1;
  const movement: OnlineInput = { seq, moveX: 1, moveY: 0, yaw: 0, pitch: 0, sprint: false, ads: false, fire: false, jump: false };
  const start = Date.now();
  while (Date.now() - start < 1000) { host.room.send('input', { ...movement, seq: seq++ }); await delay(34); }
  await snapshot(host, () => actor(host).lastInput === seq - 1);
  const moved = { ...actor(host).position };
  assert.ok(Math.hypot(moved.x - before.x, moved.z - before.z) <= 6.2, 'server bounds movement speed');
  assert.ok(Math.hypot(moved.x - before.x, moved.z - before.z) > 1, 'valid controls actually move the actor');
  host.room.send('input', { ...movement, seq: seq - 2, moveX: -1 });
  await delay(100);
  assert.equal(actor(host).lastInput, seq - 1, 'stale sequence cannot replace newest controls');
  await delay(550);
  const stopped = { ...actor(host).position };
  await delay(350);
  assert.ok(Math.hypot(actor(host).position.x - stopped.x, actor(host).position.z - stopped.z) < .2, 'stale held input times out');
  await snapshot(host, value => value.objective?.phase === 'combat', 24000);
  await rejected(host, { type: 'sell', itemId: 'pistol' });
  await rejected(host, { type: 'buy', itemId: 'light-armor' });
  assert.equal(actor(host).economy.credits, 0);
  assert.equal(actor(host).health, 100);
  assert.equal(actor(host).armor, 25);
});
