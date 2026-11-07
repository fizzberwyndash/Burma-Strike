import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const storage = new Map();
const documentEvents = new Map();
globalThis.sessionStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
globalThis.window = {
  location: { protocol: 'http:', hostname: 'localhost' },
  addEventListener: (name, callback) => documentEvents.set(callback, name),
  removeEventListener: (_name, callback) => documentEvents.delete(callback),
};
const api = { calls: [], next: [] };
globalThis.__burmaNetworkTest = api;
async function clientModule(environment = {}) {
const { outputFiles } = await build({
  entryPoints: [new URL('../src/network/client.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': JSON.stringify(environment) },
  plugins: [{
    name: 'controlled-sdk',
    setup(build) {
      build.onResolve({ filter: /^@colyseus\/sdk$/ }, () => ({ path: 'sdk', namespace: 'controlled-sdk' }));
      build.onLoad({ filter: /.*/, namespace: 'controlled-sdk' }, () => ({ contents: `
        export class Room {}
        export class Client {
          constructor(endpoint) { this.endpoint = endpoint; }
          create(...args) { return this.open('create', args); }
          joinById(...args) { return this.open('joinById', args); }
          reconnect(...args) { return this.open('reconnect', args); }
          open(method, args) {
            const api = globalThis.__burmaNetworkTest;
            api.calls.push({ method, args, endpoint: this.endpoint });
            return Promise.resolve(api.next.shift());
          }
        }
      ` }));
    },
  }],
});
return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const { OnlineClient, normalizeGuestName, normalizeRoomCode, resolveServerUrl } = await clientModule();
const signal = () => {
  const callbacks = new Set();
  const subscribe = callback => { callbacks.add(callback); };
  subscribe.emit = (...args) => { for (const callback of callbacks) callback(...args); };
  subscribe.clear = () => callbacks.clear();
  return subscribe;
};
function room() {
  const handlers = new Map();
  const result = {
    sessionId: 'human-1', reconnectionToken: 'room:reserved-token',
    state: { snapshotJson: '' }, sent: [], left: 0, removed: 0,
    reconnection: { enabled: true, maxEnqueuedMessages: 20, enqueuedMessages: [{ data: new Uint8Array([1]) }] },
    onStateChange: signal(), onDrop: signal(), onReconnect: signal(), onLeave: signal(), onError: signal(),
    onMessage(name, callback) { handlers.set(name, callback); },
    message(name, payload) { handlers.get(name)?.(payload); },
    send(name, payload) { this.sent.push({ name, payload }); },
    async leave() { this.left++; this.onLeave.emit(4000, 'left'); },
    removeAllListeners() {
      this.removed++; handlers.clear();
      for (const name of ['onStateChange', 'onDrop', 'onReconnect', 'onLeave', 'onError']) this[name].clear();
    },
  };
  return result;
}
const validState = { version: 1, code: 'ABC234', stage: 'lobby', players: [] };
beforeEach(() => { storage.clear(); documentEvents.clear(); api.calls.length = 0; api.next.length = 0; });

test('names, private codes and server endpoints normalize consistently and reject invalid configuration', () => {
  assert.equal(normalizeGuestName('  Aye   Chan  '), 'Aye Chan');
  assert.equal(normalizeGuestName('မြန်မာ ၂'), 'မြန်မာ ၂');
  assert.equal(normalizeGuestName('Jose\u0301'), 'José');
  for (const value of ['', 'a', 'x'.repeat(21), '<script>', 'guest🙂']) assert.throws(() => normalizeGuestName(value));
  assert.equal(normalizeRoomCode(' ab23cd '), 'AB23CD');
  for (const value of ['', 'ABCDE', 'ABCDEFG', '../ABC', 'AB CDE']) assert.throws(() => normalizeRoomCode(value));
  const http = { protocol: 'http:', hostname: '192.168.1.5' };
  const https = { protocol: 'https:', hostname: 'play.example.test' };
  assert.equal(resolveServerUrl(undefined, http), 'ws://192.168.1.5:2567');
  assert.equal(resolveServerUrl(undefined, https), 'wss://play.example.test:2567');
  assert.equal(resolveServerUrl('https://games.example.test/', https), 'wss://games.example.test');
  for (const value of ['javascript:alert(1)', 'ws://user:password@example.test', 'wss://example.test?token=secret', 'wss://example.test#fragment']) {
    assert.throws(() => resolveServerUrl(value, http));
  }
  assert.throws(() => resolveServerUrl('ws://example.test', https));
});

test('invalid guest input is rejected before attempting any matchmaking request', async () => {
  const client = new OnlineClient();
  await client.create('<script>');
  assert.equal(client.getState().status, 'error');
  assert.match(client.getState().error, /2–20/);
  await client.join('INVALID', 'Valid Name');
  assert.match(client.getState().error, /six-character/);
  assert.equal(api.calls.length, 0);
  client.dispose();
  assert.equal(documentEvents.size, 0);
});

test('dropped connections cannot send or replay stale gameplay actions', async () => {
  const fakeRoom = room(); api.next.push(fakeRoom);
  const client = new OnlineClient();
  const statuses = []; const stop = client.subscribe(state => statuses.push(state.status));
  let shots = 0; const stopShots = client.onShot(() => shots++);
  await client.create('Aye Chan');
  assert.deepEqual(api.calls[0].args, ['burma_custom', { username: 'Aye Chan' }]);
  assert.equal(fakeRoom.reconnection.maxEnqueuedMessages, 0);
  assert.equal(fakeRoom.reconnection.enqueuedMessages.length, 0);
  fakeRoom.state.snapshotJson = JSON.stringify(validState); fakeRoom.onStateChange.emit(fakeRoom.state);
  assert.equal(client.getSnapshot().code, 'ABC234');
  client.sendAction({ type: 'ready', ready: true });
  client.sendInput({ seq: 1 });
  fakeRoom.message('shot', { id: 1 });
  assert.equal(shots, 1); assert.equal(fakeRoom.sent.length, 2);
  fakeRoom.reconnection.enqueuedMessages.push({ data: new Uint8Array([2]) });
  fakeRoom.onDrop.emit();
  assert.equal(client.getState().status, 'reconnecting');
  assert.equal(fakeRoom.reconnection.enqueuedMessages.length, 0);
  client.sendInput({ seq: 2 }); client.sendAction({ type: 'reload' }); fakeRoom.message('shot', { id: 2 });
  assert.equal(fakeRoom.sent.length, 2); assert.equal(shots, 1);
  fakeRoom.reconnectionToken = 'room:new-token'; fakeRoom.onReconnect.emit();
  assert.equal(client.getState().status, 'connected');
  assert.equal(JSON.parse(storage.get('burma-strike-reconnect-v1')).token, 'room:new-token');
  assert.deepEqual(statuses.slice(0, 3), ['disconnected', 'connecting', 'connected']);
  stop(); stopShots();
  await client.leave();
  assert.equal(fakeRoom.reconnection.enabled, false);
  assert.equal(fakeRoom.left, 1); assert.equal(fakeRoom.removed, 1);
  assert.equal(storage.size, 0);
  client.dispose(); assert.equal(documentEvents.size, 0);
});

test('a reload can rejoin a recent reserved seat, but stale and other-server seats are ignored', async () => {
  const token = { endpoint: 'ws://localhost:2567', token: 'room:reload-token', savedAt: Date.now() };
  storage.set('burma-strike-reconnect-v1', JSON.stringify(token));
  const restoredRoom = room(); api.next.push(restoredRoom);
  const client = new OnlineClient();
  assert.equal(client.getState().reconnectAvailable, true);
  await client.reconnect();
  assert.equal(api.calls[0].method, 'reconnect');
  assert.deepEqual(api.calls[0].args, ['room:reload-token']);
  assert.equal(client.sessionId, restoredRoom.sessionId);
  await client.leave(); client.dispose();
  storage.set('burma-strike-reconnect-v1', JSON.stringify({ ...token, savedAt: Date.now() - 121000 }));
  const expired = new OnlineClient(); assert.equal(expired.getState().reconnectAvailable, false); expired.dispose();
  storage.set('burma-strike-reconnect-v1', JSON.stringify({ ...token, endpoint: 'wss://other.example.test' }));
  const other = new OnlineClient(); assert.equal(other.getState().reconnectAvailable, false); other.dispose();
});

test('cancelling an in-flight join leaves its late socket instead of reviving a departed session', async () => {
  let resolve; api.next.push(new Promise(done => { resolve = done; }));
  const client = new OnlineClient();
  const pending = client.create('Valid Name');
  assert.equal(client.getState().status, 'connecting');
  await client.leave();
  const lateRoom = room(); resolve(lateRoom); await pending;
  assert.equal(lateRoom.left, 1);
  assert.equal(client.getState().status, 'disconnected');
  assert.equal(client.sessionId, '');
  client.dispose(); assert.equal(documentEvents.size, 0);
});

test('malformed or incompatible snapshots cannot overwrite the last usable game state', async () => {
  const fakeRoom = room(); api.next.push(fakeRoom);
  const client = new OnlineClient(); await client.create('Valid Name');
  fakeRoom.onStateChange.emit({ snapshotJson: JSON.stringify(validState) });
  for (const state of [{ ...validState, version: 999 }, { ...validState, players: Array(11).fill({}) }, { ...validState, stage: 'unknown' }]) {
    fakeRoom.onStateChange.emit({ snapshotJson: JSON.stringify(state) });
    assert.equal(client.getSnapshot().code, validState.code);
    assert.equal(client.getSnapshot().stage, 'lobby');
  }
  fakeRoom.onStateChange.emit({ snapshotJson: '{invalid json' });
  assert.match(client.getState().error, /incompatible/);
  assert.equal(client.getSnapshot().code, validState.code);
  await client.leave(); client.dispose();
});


test('invalid online configuration can be reported without crashing module loading or offline Practice', async () => {
  const configured = await clientModule({ VITE_SERVER_URL: 'javascript:alert(1)' });
  assert.equal(configured.DEFAULT_SERVER_URL, 'ws://localhost:2567');
  assert.throws(() => new configured.OnlineClient(), /Invalid multiplayer server URL/);
  assert.equal(documentEvents.size, 0);
});

test('network failures have a useful message and lost sockets still clean up on leave', async () => {
  api.next.push(Promise.reject(new TypeError('Failed to fetch')));
  const client = new OnlineClient();
  await client.create('Guest Name');
  assert.equal(client.getState().error, 'Could not connect to the multiplayer server.');
  const lost = room(); api.next.push(lost);
  await client.create('Guest Name');
  lost.leave = async () => { throw new Error('already disconnected'); };
  await client.leave();
  assert.equal(client.getState().status, 'disconnected');
  assert.equal(lost.removed, 1);
  client.dispose(); assert.equal(documentEvents.size, 0);
});
