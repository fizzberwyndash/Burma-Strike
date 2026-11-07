/** Pure Royal Signal Core rules. Only a trusted physics / server adapter may call
 * advance, updatePosition, applyDamage and disconnect. Clients send intents;
 * completion and time are never accepted as client commands. */
export type ObjectiveTeam = 'attackers' | 'defenders';
export type ObjectivePhase = 'buy' | 'combat' | 'planted' | 'result' | 'transition';
export type ObjectiveSiteId = 'A' | 'B';
export interface ObjectiveConfig { format: '1v1' | '2v1'; activeSite: 'both' | ObjectiveSiteId }
export interface ObjectivePoint { x: number; y: number; z: number }
/** Trusted roster supplied by the server; never copied from a gameplay packet. */
export interface ObjectiveRosterPlayer { id: string; name: string; team: ObjectiveTeam; position?: ObjectivePoint }
export interface ObjectivePlayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly team: ObjectiveTeam;
  readonly health: number;
  readonly alive: boolean;
  readonly connected: boolean;
  readonly position: Readonly<ObjectivePoint>;
}
export type PlayerSnapshot = ObjectivePlayerSnapshot;
export interface ObjectiveSnapshot {
  readonly round: number;
  /** Monotonic generation, including rematches. Network intents must echo it. */
  readonly epoch: number;
  readonly phase: ObjectivePhase;
  readonly remaining: number;
  readonly players: readonly ObjectivePlayerSnapshot[];
  readonly carrierId: string | null;
  readonly coreState: 'carried' | 'dropped' | 'planted' | 'defused' | 'detonated';
  readonly corePosition: Readonly<ObjectivePoint> | null;
  readonly plantedSite: ObjectiveSiteId | null;
  readonly interaction: Readonly<{ playerId: string; kind: 'plant' | 'defuse'; progress: number }> | null;
  readonly result: Readonly<{ id: string; winner: ObjectiveTeam; reason: string }> | null;
  readonly scores: Readonly<Record<ObjectiveTeam, number>>;
  readonly config: Readonly<ObjectiveConfig>;
  readonly message: string;
}
export interface ObjectiveCommand {
  id: string;
  round: number;
  /** Required monotonic generation prevents stale round-1 intents after rematch. */
  epoch: number;
  type: 'interact-start' | 'interact-stop' | 'next-round' | 'rematch';
}
export interface ObjectiveReply { readonly ok: boolean; readonly message: string }
export const OBJECTIVE_DURATIONS = Object.freeze({ buy: 20, combat: 100, plant: 4, planted: 35, defuse: 6, transition: 1 });
export const OBJECTIVE_SITES: readonly Readonly<{ id: ObjectiveSiteId; position: Readonly<ObjectivePoint>; radius: number }>[] = Object.freeze([
  Object.freeze({ id: 'A' as const, position: Object.freeze({ x: -19, y: 0, z: 4.5 }), radius: 3.3 }),
  Object.freeze({ id: 'B' as const, position: Object.freeze({ x: 18, y: 0, z: 12 }), radius: 3.3 }),
]);

type Player = { id: string; name: string; team: ObjectiveTeam; health: number; alive: boolean; connected: boolean; position: ObjectivePoint };
type Interaction = { playerId: string; kind: 'plant' | 'defuse'; elapsed: number; start: ObjectivePoint; site: ObjectiveSiteId | null };
type Receipt = { fingerprint: string; reply: ObjectiveReply };
const EPSILON = 1e-8;
const MAX_COMMANDS = 512;
const MAX_EVENTS = 2048;
const validPoint = (point: ObjectivePoint): boolean => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
const distance = (a: ObjectivePoint, b: ObjectivePoint): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const horizontalDistance = (a: ObjectivePoint, b: ObjectivePoint): number => Math.hypot(a.x - b.x, a.z - b.z);
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160;
const reply = (ok: boolean, message: string): ObjectiveReply => Object.freeze({ ok, message });

export class LocalObjectiveAuthority {
  private readonly roster?: readonly ObjectiveRosterPlayer[];
  private readonly config: ObjectiveConfig;
  private players: Player[];
  private round = 1;
  private epoch = 1;
  private phase: ObjectivePhase = 'buy';
  private remaining: number = OBJECTIVE_DURATIONS.buy;
  private carrierId: string | null = 'attacker-1';
  private coreState: ObjectiveSnapshot['coreState'] = 'carried';
  private corePosition: ObjectivePoint | null = null;
  private coreEquipped = false;
  private plantedSite: ObjectiveSiteId | null = null;
  private interaction: Interaction | null = null;
  private result: ObjectiveSnapshot['result'] = null;
  private scores: Record<ObjectiveTeam, number> = { attackers: 0, defenders: 0 };
  private message = 'Buy phase — prepare your equipment';
  private resultCounter = 0;
  private commands = new Map<string, Receipt>();
  private events = new Map<string, Receipt>();

  constructor(config: Partial<ObjectiveConfig> = {}, roster?: readonly ObjectiveRosterPlayer[]) {
    if (roster) {
      if (roster.length < 2 || roster.length > 10 || new Set(roster.map(player => player.id)).size !== roster.length ||
          roster.some(player => !validId(player.id) || typeof player.name !== 'string' || !['attackers', 'defenders'].includes(player.team)) ||
          ['attackers', 'defenders'].some(team => !roster.some(player => player.team === team) || roster.filter(player => player.team === team).length > 5)) {
        throw new Error('Invalid authoritative player roster');
      }
      this.roster = roster.map(player => ({ ...player, position: player.position ? { ...player.position } : undefined }));
    }
    this.config = {
      format: config.format === '2v1' ? '2v1' : '1v1',
      activeSite: config.activeSite === 'A' || config.activeSite === 'B' ? config.activeSite : 'both',
    };
    this.players = this.createPlayers();
    this.carrierId = this.players.find(player => player.team === 'attackers')?.id ?? null;
  }

  get snapshot(): ObjectiveSnapshot {
    return Object.freeze({
      round: this.round, epoch: this.epoch, phase: this.phase, remaining: Math.max(0, this.remaining),
      players: Object.freeze(this.players.map(player => Object.freeze({ ...player, position: Object.freeze({ ...player.position }) }))),
      carrierId: this.carrierId, coreState: this.coreState,
      corePosition: this.corePosition ? Object.freeze({ ...this.corePosition }) : null,
      plantedSite: this.plantedSite,
      interaction: this.interaction ? Object.freeze({
        playerId: this.interaction.playerId, kind: this.interaction.kind,
        progress: Math.min(1, this.interaction.elapsed / this.interactionDuration()),
      }) : null,
      result: this.result, scores: Object.freeze({ ...this.scores }), config: Object.freeze({ ...this.config }), message: this.message,
    });
  }

  /** Elapsed time comes from the local simulation or server, never a packet. */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.phase === 'result') return;
    let rest = dt;
    while (rest > 0 && !this.result) {
      this.validateInteraction();
      const untilInteraction = this.interaction ? Math.max(0, this.interactionDuration() - this.interaction.elapsed) : Infinity;
      const step = Math.min(rest, this.remaining, untilInteraction);
      this.remaining = Math.max(0, this.remaining - step);
      if (this.interaction) this.interaction.elapsed += step;
      rest = Math.max(0, rest - step);

      // Countdown expiry has priority over completion at the exact same instant.
      if (this.remaining <= EPSILON) {
        this.expirePhase();
      } else if (this.interaction && this.interaction.elapsed + EPSILON >= this.interactionDuration()) {
        this.completeInteraction();
      } else if (step <= 0) {
        break;
      }
    }
  }

  /** Authoritative collision-resolved player center. Site membership uses XZ. */
  updatePosition(playerId: string, position: ObjectivePoint): void {
    const player = this.player(playerId);
    if (!player || !player.alive || !player.connected || !validPoint(position)) return;
    // Babylon Vector3 exposes x/y/z through prototype getters; spreading it
    // copies its private backing fields instead of the ObjectivePoint contract.
    player.position = { x: position.x, y: position.y, z: position.z };
    if (this.interaction?.playerId === playerId) this.validateInteraction();
  }

  equipCore(playerId: string, equipped: boolean): boolean {
    if (equipped !== true && equipped !== false) return false;
    if (!equipped) {
      if (this.carrierId !== playerId) return false;
      this.coreEquipped = false;
      if (this.interaction?.playerId === playerId) this.cancelInteraction('Device holstered');
      return true;
    }
    const player = this.player(playerId);
    if (!player?.alive || !player.connected || player.team !== 'attackers' || this.carrierId !== playerId ||
      this.coreState !== 'carried' || (this.phase !== 'buy' && this.phase !== 'combat')) return false;
    this.coreEquipped = true;
    return true;
  }

  /** actorId and isHost must be resolved by the transport, never read from payload. */
  dispatch(command: ObjectiveCommand, actorId: string, isHost = false): ObjectiveReply {
    if (!command || !validId(command.id) || !Number.isSafeInteger(command.round) ||
      !['interact-start', 'interact-stop', 'next-round', 'rematch'].includes(command.type)) return reply(false, 'Invalid objective command');
    if (command.round !== this.round) return reply(false, 'Stale round');
    if (command.epoch !== this.epoch) return reply(false, 'Stale round generation');
    const fingerprint = `${actorId}:${command.type}:${isHost ? 'host' : 'player'}`;
    const previous = this.commands.get(command.id);
    if (previous) return previous.fingerprint === fingerprint ? previous.reply : reply(false, 'Command ID belongs to another intent');
    if (this.commands.size >= MAX_COMMANDS) return reply(false, 'Command limit reached for this round');
    // Keep the old ledger reference: a successful transition creates a new ledger.
    const ledger = this.commands;
    let response: ObjectiveReply;
    const player = this.player(actorId);
    if (!player) response = reply(false, 'Unknown player');
    else if (command.type === 'next-round' || command.type === 'rematch') {
      if (!isHost) response = reply(false, 'Only the host can manage rounds');
      else if (command.type === 'next-round' && this.phase !== 'result') response = reply(false, 'The round has not ended');
      else if (this.phase === 'transition') response = reply(false, 'Round transition in progress');
      else {
        this.beginTransition(command.type === 'rematch');
        response = reply(true, command.type === 'rematch' ? 'Rematch starting' : 'Next round starting');
      }
    } else if (command.type === 'interact-stop') {
      if (this.phase === 'result' || this.phase === 'transition') response = reply(false, 'Interactions are disabled');
      else if (this.interaction && this.interaction.playerId !== actorId) response = reply(false, 'Another player is interacting');
      else {
        if (this.interaction) this.cancelInteraction('Interaction released');
        response = reply(true, 'Interaction stopped');
      }
    } else response = this.startInteraction(player);
    ledger.set(command.id, { fingerprint, reply: response });
    return response;
  }

  /** HP damage after armor. Call interrupt as well for a fully absorbed hit. */
  applyDamage(playerId: string, amount: number, eventId: string): ObjectiveReply {
    if (!validId(eventId) || !Number.isFinite(amount) || amount <= 0) return reply(false, 'Invalid damage event');
    return this.event(eventId, `damage:${playerId}:${amount}`, () => {
      const player = this.player(playerId);
      if (!player?.alive || !player.connected || (this.phase !== 'combat' && this.phase !== 'planted')) return reply(false, 'Player cannot take combat damage now');
      this.interrupt(playerId, 'Taking damage cancelled the interaction');
      player.health = Math.max(0, player.health - amount);
      if (player.health === 0) {
        player.alive = false;
        this.dropCore(playerId);
        this.checkElimination();
      }
      return reply(true, player.alive ? 'Damage applied' : 'Player eliminated');
    });
  }

  interrupt(playerId: string, reason = 'Interaction interrupted'): void {
    if (this.interaction?.playerId === playerId) this.cancelInteraction(reason);
  }

  disconnect(playerId: string, eventId: string): ObjectiveReply {
    if (!validId(eventId)) return reply(false, 'Invalid disconnect event');
    return this.event(eventId, `disconnect:${playerId}`, () => {
      const player = this.player(playerId);
      if (!player || !player.connected) return reply(false, 'Player is already disconnected or unknown');
      this.interrupt(playerId, 'Player disconnected');
      player.connected = false;
      player.alive = false;
      player.health = 0;
      this.dropCore(playerId);
      this.checkElimination();
      return reply(true, 'Player disconnected');
    });
  }

  /** A verified Colyseus reconnection restores presence, never revives the current life. */
  reconnect(playerId: string): boolean {
    const player = this.player(playerId);
    if (!player) return false;
    player.connected = true;
    return true;
  }

  private createPlayers(): Player[] {
    if (this.roster) {
      const index = { attackers: 0, defenders: 0 };
      return this.roster.map(player => {
        const slot = index[player.team]++;
        return {
          id: player.id, name: player.name, team: player.team, health: 100, alive: true, connected: true,
          position: player.position ? { ...player.position } : { x: (slot - 2) * 1.5, y: .9, z: player.team === 'attackers' ? -12 : 18 },
        };
      });
    }
    const attacker = (id: string, x: number): Player => ({ id, name: id === 'attacker-1' ? 'Attacker 1' : 'Attacker 2', team: 'attackers', health: 100, alive: true, connected: true, position: { x, y: 1, z: -12 } });
    return [attacker('attacker-1', 0), ...(this.config.format === '2v1' ? [attacker('attacker-2', -2)] : []),
      { id: 'defender-1', name: 'Defender 1', team: 'defenders', health: 100, alive: true, connected: true, position: { x: 0, y: 1, z: 18 } }];
  }

  private player(id: string): Player | undefined { return this.players.find(player => player.id === id); }
  private interactionDuration(): number { return this.interaction?.kind === 'defuse' ? OBJECTIVE_DURATIONS.defuse : OBJECTIVE_DURATIONS.plant; }
  private enabledSite(position: ObjectivePoint): typeof OBJECTIVE_SITES[number] | undefined {
    return OBJECTIVE_SITES.find(site => (this.config.activeSite === 'both' || this.config.activeSite === site.id) &&
      horizontalDistance(position, site.position) <= site.radius && Math.abs(position.y - site.position.y) <= 3);
  }

  private startInteraction(player: Player): ObjectiveReply {
    if (!player.alive || !player.connected) return reply(false, 'Player is not active');
    if (this.interaction) return this.interaction.playerId === player.id ? reply(true, 'Already interacting') : reply(false, 'Another player is interacting');
    if (this.phase === 'combat' && player.team === 'attackers') {
      if (this.coreState === 'dropped' && this.corePosition && distance(player.position, this.corePosition) <= 2.2) {
        this.carrierId = player.id;
        this.coreState = 'carried';
        this.corePosition = null;
        this.coreEquipped = false;
        this.message = 'Royal Signal Core recovered — equip slot 4 to plant';
        return reply(true, this.message);
      }
      if (this.coreState !== 'carried' || this.carrierId !== player.id) return reply(false, 'Only the core carrier can plant');
      if (!this.coreEquipped) return reply(false, 'Equip the Royal Signal Core with slot 4');
      const site = this.enabledSite(player.position);
      if (!site) return reply(false, 'Enter an active A or B site to plant');
      this.interaction = { playerId: player.id, kind: 'plant', elapsed: 0, start: { ...player.position }, site: site.id };
      this.message = `Arming Royal Signal Core at site ${site.id}`;
      return reply(true, this.message);
    }
    if (this.phase === 'planted' && player.team === 'defenders' && this.corePosition && distance(player.position, this.corePosition) <= 2.2) {
      this.interaction = { playerId: player.id, kind: 'defuse', elapsed: 0, start: { ...player.position }, site: this.plantedSite };
      this.message = 'Defusing Royal Signal Core';
      return reply(true, this.message);
    }
    return reply(false, this.phase === 'planted' ? 'Only a nearby defender can defuse' : 'Objective interaction is unavailable');
  }

  private validateInteraction(): void {
    const interaction = this.interaction;
    if (!interaction) return;
    const player = this.player(interaction.playerId);
    const moved = !player || distance(player.position, interaction.start) > .15 + EPSILON;
    const eligible = player?.alive && player.connected && (interaction.kind === 'plant'
      ? this.phase === 'combat' && this.coreState === 'carried' && this.carrierId === player.id && this.coreEquipped && this.enabledSite(player.position)?.id === interaction.site
      : this.phase === 'planted' && this.corePosition && distance(player.position, this.corePosition) <= 2.2);
    if (moved || !eligible) this.cancelInteraction(moved ? 'Movement cancelled the interaction' : 'Interaction no longer available');
  }

  private cancelInteraction(message: string): void { this.interaction = null; this.message = message; }

  private completeInteraction(): void {
    this.validateInteraction();
    const interaction = this.interaction;
    if (!interaction) return;
    const player = this.player(interaction.playerId)!;
    this.interaction = null;
    if (interaction.kind === 'plant') {
      this.phase = 'planted';
      this.remaining = OBJECTIVE_DURATIONS.planted;
      this.coreState = 'planted';
      this.corePosition = { x: player.position.x, y: .2, z: player.position.z };
      this.plantedSite = interaction.site;
      this.carrierId = null;
      this.coreEquipped = false;
      this.message = `Royal Signal Core planted at site ${this.plantedSite}`;
    } else {
      this.coreState = 'defused';
      this.resolve('defenders', 'Royal Signal Core defused');
    }
  }

  private expirePhase(): void {
    if (this.phase === 'buy') {
      this.phase = 'combat'; this.remaining = OBJECTIVE_DURATIONS.combat; this.message = 'Combat — attackers deploy the Royal Signal Core';
      this.checkElimination();
    } else if (this.phase === 'combat') this.resolve('defenders', 'Combat time expired before planting');
    else if (this.phase === 'planted') {
      this.coreState = 'detonated';
      this.resolve('attackers', 'Royal Signal Core activated');
    } else if (this.phase === 'transition') {
      this.phase = 'buy'; this.remaining = OBJECTIVE_DURATIONS.buy; this.message = 'Buy phase — prepare your equipment';
      this.checkElimination();
    }
  }

  private dropCore(playerId: string): void {
    if (this.coreState !== 'carried' || this.carrierId !== playerId) return;
    const position = this.player(playerId)?.position;
    this.coreState = 'dropped';
    this.corePosition = position ? { x: position.x, y: .2, z: position.z } : null;
    this.carrierId = null;
    this.coreEquipped = false;
  }

  private checkElimination(): void {
    if (this.phase === 'result' || this.phase === 'transition') return;
    const attackers = this.players.some(player => player.team === 'attackers' && player.alive && player.connected);
    const defenders = this.players.some(player => player.team === 'defenders' && player.alive && player.connected);
    if (this.phase === 'planted') {
      if (!defenders) this.resolve('attackers', 'All defenders eliminated');
    } else if (!attackers) this.resolve('defenders', 'All attackers eliminated or disconnected');
    else if (!defenders) this.resolve('attackers', 'All defenders eliminated or disconnected');
  }

  private resolve(winner: ObjectiveTeam, reason: string): void {
    if (this.result || this.phase === 'result' || this.phase === 'transition') return;
    this.phase = 'result';
    this.remaining = 0;
    this.interaction = null;
    this.coreEquipped = false;
    this.result = Object.freeze({ id: `${this.round}:${++this.resultCounter}`, winner, reason });
    this.scores[winner] += 1;
    this.message = reason;
  }

  private beginTransition(rematch: boolean): void {
    const connected = new Map(this.players.map(player => [player.id, player.connected]));
    this.round = rematch ? 1 : this.round + 1;
    this.epoch += 1;
    if (rematch) this.scores = { attackers: 0, defenders: 0 };
    this.players = this.createPlayers().map(player => {
      if (!rematch && connected.get(player.id) === false) return { ...player, connected: false, alive: false, health: 0 };
      return player;
    });
    this.carrierId = this.players.find(player => player.team === 'attackers' && player.connected)?.id ?? null;
    this.coreState = this.carrierId ? 'carried' : 'dropped';
    this.corePosition = null;
    this.coreEquipped = false;
    this.plantedSite = null;
    this.interaction = null;
    this.result = null;
    this.phase = 'transition';
    this.remaining = OBJECTIVE_DURATIONS.transition;
    this.message = rematch ? 'Rematch starting' : `Round ${this.round} starting`;
    this.commands = new Map();
    this.events = new Map();
  }

  private event(id: string, fingerprint: string, apply: () => ObjectiveReply): ObjectiveReply {
    const previous = this.events.get(id);
    if (previous) return previous.fingerprint === fingerprint ? previous.reply : reply(false, 'Event ID belongs to another event');
    if (this.events.size >= MAX_EVENTS) return reply(false, 'Event limit reached for this round');
    const response = apply();
    this.events.set(id, { fingerprint, reply: response });
    return response;
  }
}
