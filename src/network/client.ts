import { Client, Room } from '@colyseus/sdk';
import { NETWORK_VERSION, ROOM_TYPE } from './protocol';
import type { OnlineAction, OnlineGameBridge, OnlineInput, OnlineSnapshot, ShotEvent, WireState } from './protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface ConnectionState {
  status: ConnectionStatus; snapshot: OnlineSnapshot | null; sessionId: string;
  error: string; reconnectAvailable: boolean;
}
type ResumeSeat = { endpoint: string; token: string; savedAt: number };
const RESUME_KEY = 'burma-strike-reconnect-v1';

export function normalizeGuestName(value: string): string {
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...name].length < 2 || [...name].length > 20 || !/^[\p{L}\p{M}\p{N} _-]+$/u.test(name)) {
    throw new Error('Use 2–20 letters, numbers, spaces, underscores or hyphens for your name.');
  }
  return name;
}
export function normalizeRoomCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Enter a six-character room code.');
  return code;
}
export function resolveServerUrl(configured: string | undefined, location: Pick<Location, 'protocol' | 'hostname'>): string {
  const url = new URL(configured?.trim() || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname || 'localhost'}:2567`);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid multiplayer server URL.');
  }
  if (location.protocol === 'https:' && (url.protocol === 'http:' || url.protocol === 'ws:')) {
    throw new Error('An HTTPS game requires a secure WSS multiplayer server.');
  }
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}
const browserLocation = typeof window === 'undefined' ? { protocol: 'http:', hostname: 'localhost' } : window.location;
let serverConfigurationError = '';
export const DEFAULT_SERVER_URL = (() => {
  try { return resolveServerUrl(import.meta.env?.VITE_SERVER_URL, browserLocation); }
  catch (error) {
    // A bad online endpoint must never prevent offline Practice from mounting.
    serverConfigurationError = error instanceof Error ? error.message : 'Invalid multiplayer server URL.';
    return resolveServerUrl(undefined, browserLocation);
  }
})();

/** A connection owns no gameplay authority. Only validated server snapshots may
 * update balances, damage, ownership, hit confirmation or objective completion. */
export class OnlineClient implements OnlineGameBridge {
  private readonly sdk: Client;
  private room: Room<unknown, WireState> | null = null;
  private connection: ConnectionState;
  private listeners = new Set<(state: ConnectionState) => void>();
  private shots = new Set<(event: ShotEvent) => void>();
  private generation = 0;
  private disposed = false;
  private abandoning = false;
  private readonly pageHide = () => this.rememberSeat();

  constructor(readonly endpoint = DEFAULT_SERVER_URL) {
    if (serverConfigurationError && endpoint === DEFAULT_SERVER_URL) throw new Error(serverConfigurationError);
    this.sdk = new Client(endpoint);
    this.connection = { status: 'disconnected', snapshot: null, sessionId: '', error: '', reconnectAvailable: !!this.readSeat() };
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.pageHide);
  }

  get sessionId(): string { return this.connection.sessionId; }
  getSnapshot(): OnlineSnapshot | null { return this.connection.snapshot; }
  getState(): ConnectionState { return this.connection; }
  subscribe(callback: (state: ConnectionState) => void): () => void {
    this.listeners.add(callback); callback(this.connection);
    return () => { this.listeners.delete(callback); };
  }
  onShot(callback: (event: ShotEvent) => void): () => void {
    this.shots.add(callback); return () => { this.shots.delete(callback); };
  }
  private publish(update: Partial<ConnectionState>) {
    if (this.disposed) return;
    this.connection = { ...this.connection, ...update };
    for (const listener of this.listeners) listener(this.connection);
  }

  async create(username: string): Promise<void> {
    let name: string;
    try { name = normalizeGuestName(username); }
    catch (error) { this.fail(error); return; }
    await this.connect(() => this.sdk.create<WireState>(ROOM_TYPE, { username: name }));
  }
  async join(code: string, username: string): Promise<void> {
    let name: string, normalized: string;
    try { name = normalizeGuestName(username); normalized = normalizeRoomCode(code); }
    catch (error) { this.fail(error); return; }
    await this.connect(async () => {
      const url = new URL(this.endpoint.replace(/^ws/, 'http') + `/api/rooms/${normalized}`);
      const result = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
      const body: unknown = await result.json();
      if (!result.ok || !body || typeof body !== 'object' || !('roomId' in body) || typeof body.roomId !== 'string') {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Room not found or no longer available.';
        throw new Error(message);
      }
      return this.sdk.joinById<WireState>(body.roomId, { username: name });
    });
  }
  async reconnect(): Promise<void> {
    const saved = this.readSeat();
    if (!saved) { this.fail(new Error('No recent session is available to reconnect.')); return; }
    if (this.room && this.connection.status === 'reconnecting') return;
    await this.connect(() => this.sdk.reconnect<WireState>(saved.token), true);
  }
  private async connect(open: () => Promise<Room<unknown, WireState>>, restoring = false): Promise<void> {
    if (this.disposed || ['connecting', 'connected', 'reconnecting'].includes(this.connection.status)) return;
    const generation = ++this.generation;
    this.publish({ status: restoring ? 'reconnecting' : 'connecting', error: '', snapshot: null, sessionId: '' });
    try {
      const room = await open();
      if (this.disposed || generation !== this.generation) { void room.leave(); return; }
      this.bind(room);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      if (restoring) this.forgetSeat();
      this.fail(error);
    }
  }
  private bind(room: Room<unknown, WireState>) {
    this.room = room;
    this.abandoning = false;
    // Never replay pre-disconnect shots, movement, purchases or interactions.
    room.reconnection.maxEnqueuedMessages = 0;
    room.reconnection.enqueuedMessages.length = 0;
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 15;
    room.reconnection.minDelay = 200;
    room.reconnection.maxDelay = 2000;
    this.publish({ status: 'connected', sessionId: room.sessionId, error: '', reconnectAvailable: true });
    this.rememberSeat();
    room.onStateChange(state => this.acceptSnapshot(state.snapshotJson));
    room.onMessage<ShotEvent>('shot', event => {
      if (this.connection.status !== 'connected' || !event || !Number.isFinite(event.id)) return;
      for (const callback of this.shots) callback(event);
    });
    room.onMessage<{ message: string }>('error', payload => {
      this.publish({ error: typeof payload?.message === 'string' ? payload.message.slice(0, 300) : 'The server rejected that action.' });
    });
    room.onError((_code, message) => this.publish({ error: (message || 'The multiplayer connection failed.').slice(0, 300) }));
    room.onDrop(() => {
      room.reconnection.enqueuedMessages.length = 0;
      this.rememberSeat();
      this.publish({ status: 'reconnecting', error: 'Connection lost. Reconnecting…', reconnectAvailable: true });
    });
    room.onReconnect(() => {
      room.reconnection.enqueuedMessages.length = 0;
      this.rememberSeat();
      this.publish({ status: 'connected', error: '', reconnectAvailable: true });
      this.acceptSnapshot(room.state.snapshotJson);
    });
    room.onLeave((_code, reason) => {
      if (this.room !== room) return;
      this.room = null;
      if (this.abandoning) return;
      this.publish({ status: 'disconnected', snapshot: null, sessionId: '',
        error: reason || 'Disconnected from the room. Rejoin if your seat is still reserved.', reconnectAvailable: !!this.readSeat() });
    });
    this.acceptSnapshot(room.state?.snapshotJson);
  }
  private acceptSnapshot(json: string | undefined) {
    if (!json || json.length > 512000) return;
    try {
      const snapshot = JSON.parse(json) as OnlineSnapshot;
      if (snapshot.version !== NETWORK_VERSION || !Array.isArray(snapshot.players) || snapshot.players.length > 10 ||
          !['lobby', 'match', 'finished'].includes(snapshot.stage) || typeof snapshot.code !== 'string') return;
      this.publish({ snapshot });
    } catch { this.publish({ error: 'The server sent an incompatible game state.' }); }
  }
  sendInput(input: OnlineInput): void {
    if (this.room && this.connection.status === 'connected') this.room.send('input', input);
  }
  sendAction(action: OnlineAction): void {
    if (this.room && this.connection.status === 'connected') {
      this.publish({ error: '' });
      this.room.send('action', action);
    }
  }
  private readSeat(): ResumeSeat | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null') as ResumeSeat | null;
      return saved && saved.endpoint === this.endpoint && typeof saved.token === 'string' &&
        Date.now() - saved.savedAt < 120000 ? saved : null;
    } catch { return null; }
  }
  private rememberSeat() {
    if (!this.room?.reconnectionToken) return;
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ endpoint: this.endpoint, token: this.room.reconnectionToken, savedAt: Date.now() })); }
    catch { /* Live automatic reconnection works without browser storage. */ }
  }
  private forgetSeat() {
    try { sessionStorage.removeItem(RESUME_KEY); } catch { /* Optional storage. */ }
  }
  private fail(error: unknown) {
    const raw = error instanceof Error ? error.message : 'Could not connect to the multiplayer server.';
    const message = /^(Failed to fetch|fetch failed|NetworkError)/i.test(raw) ? 'Could not connect to the multiplayer server.' : raw;
    this.publish({ status: this.room ? this.connection.status : 'error', error: message.slice(0, 300), reconnectAvailable: !!this.readSeat() });
  }
  async leave(): Promise<void> {
    ++this.generation;
    this.abandoning = true;
    const room = this.room; this.room = null;
    this.forgetSeat();
    this.publish({ status: 'disconnected', snapshot: null, sessionId: '', error: '', reconnectAvailable: false });
    if (room) {
      room.reconnection.enabled = false;
      try { await room.leave(); } catch { /* An already lost socket still releases local resources. */ }
      finally { room.removeAllListeners(); }
    }
  }
  dispose(): void {
    if (this.disposed) return;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pageHide);
    // A probe mount (React StrictMode) has not joined a room. Disposing it must
    // not erase the reserved seat read by the real mount after a browser reload.
    if (this.room) void this.leave();
    else ++this.generation;
    this.disposed = true;
    this.listeners.clear(); this.shots.clear();
  }
}
