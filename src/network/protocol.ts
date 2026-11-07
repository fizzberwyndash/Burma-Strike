import type { EconomySnapshot } from '../game/economy';
import type { ObjectiveSnapshot, ObjectiveTeam, ObjectiveSiteId } from '../game/objective';
import type { WeaponAction, WeaponId } from '../game/weapons';

export const NETWORK_VERSION = 1;
export const ROOM_TYPE = 'burma_custom';
export interface Point3 { x: number; y: number; z: number }
export interface MatchConfiguration {
  mapId: 'bagan-old-city'; rounds: number; activeSite: 'both' | ObjectiveSiteId;
  /** Omitted by older saved lobby settings; the server defaults to false. */
  friendlyFire?: boolean;
}
export interface OnlineInput {
  seq: number; moveX: number; moveY: number; yaw: number; pitch: number;
  sprint: boolean; ads: boolean; fire: boolean; jump: boolean;
}
export interface OnlineInventory {
  weaponId: WeaponId; primaryId: 'rifle' | 'smg' | 'sniper';
  action: WeaponAction; progress: number; magazine: number; reserve: number;
}
export interface OnlinePlayer {
  id: string; name: string; team: ObjectiveTeam; ready: boolean; connected: boolean;
  position: Point3; yaw: number; pitch: number; moving: boolean; sprinting: boolean; ads: boolean;
  alive: boolean; health: number; armor: number; kills: number; deaths: number;
  lastInput: number; deviceEquipped: boolean; inventory: OnlineInventory; economy: EconomySnapshot;
}
export interface OnlineRoundRecord {
  id: string; round: number; winner: ObjectiveTeam; reason: string;
  plantedSite: ObjectiveSiteId | null;
  scores: { attackers: number; defenders: number };
  /** Server wall-clock timestamp, recorded once when the result resolves. */
  resolvedAt: number;
}
export interface OnlineSnapshot {
  version: typeof NETWORK_VERSION; code: string; hostId: string; serverTime: number;
  stage: 'lobby' | 'match' | 'finished'; config: MatchConfiguration;
  matchId: string; roundHistory: OnlineRoundRecord[];
  players: OnlinePlayer[]; objective: ObjectiveSnapshot | null; message: string;
}
export type OnlineAction =
  | { type: 'ready'; ready: boolean }
  | { type: 'team'; playerId: string; team: ObjectiveTeam }
  | { type: 'configure'; config: MatchConfiguration }
  | { type: 'start' } | { type: 'return-lobby' }
  | { type: 'rematch'; matchId: string }
  | { type: 'equip'; slot: 1 | 2 | 3 | 4 }
  | { type: 'select-primary'; weaponId: 'rifle' | 'smg' | 'sniper' }
  | { type: 'reload' } | { type: 'inspect' }
  | { type: 'buy'; itemId: string } | { type: 'sell'; itemId: string }
  | { type: 'interact'; held: boolean; round: number; epoch: number };
export interface ShotEvent {
  id: number; playerId: string; weaponId: WeaponId; from: Point3; to: Point3;
  normal: Point3; surface: 'hard' | 'sand' | 'target'; victimId: string | null;
  headshot: boolean; killed: boolean;
}
/** The Colyseus schema carries a versioned snapshot string so the existing pure
 * objective/economy snapshots have one shared wire contract and no client setters. */
export interface WireState { snapshotJson: string }
export interface OnlineGameBridge {
  readonly sessionId: string;
  getSnapshot(): OnlineSnapshot | null;
  sendInput(input: OnlineInput): void;
  sendAction(action: OnlineAction): void;
  onShot(callback: (event: ShotEvent) => void): () => void;
}
