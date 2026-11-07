import type { MatchConfiguration, OnlineAction, OnlineInput } from '../../src/network/protocol';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateUsername(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Use 2–20 letters, numbers, spaces, underscores or hyphens for your name.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...name].length < 2 || [...name].length > 20 || !/^[\p{L}\p{M}\p{N} _-]+$/u.test(name)) {
    throw new Error('Use 2–20 letters, numbers, spaces, underscores or hyphens for your name.');
  }
  return name;
}
export function validateConfiguration(value: unknown): MatchConfiguration | null {
  if (!record(value) || !keys(value, ['mapId', 'rounds', 'activeSite','friendlyFire']) || value.mapId !== 'bagan-old-city' ||
      !Number.isInteger(value.rounds) || !finite(value.rounds, 1, 30) || !['both','A','B'].includes(value.activeSite as string) ||
      (value.friendlyFire!==undefined&&typeof value.friendlyFire!=='boolean')) return null;
  return { mapId: 'bagan-old-city', rounds: value.rounds, activeSite: value.activeSite as MatchConfiguration['activeSite'],
    ...(value.friendlyFire===undefined?{}:{friendlyFire:value.friendlyFire}) };
}
export function validateInput(value: unknown): OnlineInput | null {
  if (!record(value) || !keys(value, ['seq','moveX','moveY','yaw','pitch','sprint','ads','fire','jump']) ||
      !Number.isSafeInteger(value.seq) || !finite(value.seq, 0, 2147483647) ||
      !finite(value.moveX, -1, 1) || !finite(value.moveY, -1, 1) || !finite(value.yaw, -100000, 100000) || !finite(value.pitch, -1.45, 1.45) ||
      ['sprint','ads','fire','jump'].some(key => typeof value[key] !== 'boolean')) return null;
  const length = Math.max(1, Math.hypot(value.moveX, value.moveY));
  return { seq: value.seq, moveX: value.moveX / length, moveY: value.moveY / length,
    yaw: Math.atan2(Math.sin(value.yaw), Math.cos(value.yaw)), pitch: value.pitch,
    sprint: value.sprint as boolean, ads: value.ads as boolean, fire: value.fire as boolean, jump: value.jump as boolean };
}
export function validateAction(value: unknown): OnlineAction | null {
  if (!record(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'ready': return keys(value, ['type','ready']) && typeof value.ready === 'boolean' ? {type:'ready', ready:value.ready} : null;
    case 'team': return keys(value, ['type','playerId','team']) && typeof value.playerId === 'string' && value.playerId.length <= 128 && ['attackers','defenders'].includes(value.team as string)
      ? {type:'team',playerId:value.playerId,team:value.team as 'attackers'|'defenders'} : null;
    case 'configure': { const config = validateConfiguration(value.config); return keys(value,['type','config']) && config ? {type:'configure',config} : null; }
    case 'start': case 'return-lobby': case 'reload': case 'inspect': return keys(value,['type']) ? {type:value.type} : null;
    case 'rematch': return keys(value,['type','matchId'])&&typeof value.matchId==='string'&&value.matchId.length>=1&&value.matchId.length<=128
      ? {type:'rematch',matchId:value.matchId} : null;
    case 'equip': return keys(value,['type','slot']) && [1,2,3,4].includes(value.slot as number) ? {type:'equip',slot:value.slot as 1|2|3|4} : null;
    case 'select-primary': return keys(value,['type','weaponId']) && ['rifle','smg','sniper'].includes(value.weaponId as string)
      ? {type:'select-primary',weaponId:value.weaponId as 'rifle'|'smg'|'sniper'} : null;
    case 'buy': case 'sell': return keys(value,['type','itemId']) && typeof value.itemId === 'string' && value.itemId.length <= 32
      ? {type:value.type,itemId:value.itemId} : null;
    case 'interact': return keys(value,['type','held','round','epoch']) && typeof value.held === 'boolean' &&
      Number.isSafeInteger(value.round) && finite(value.round,1,2147483647) && Number.isSafeInteger(value.epoch) && finite(value.epoch,1,2147483647)
      ? {type:'interact',held:value.held,round:value.round,epoch:value.epoch} : null;
    default: return null;
  }
}
export class TokenBucket {
  private tokens: number;
  private time: number;
  constructor(private rate: number, private capacity: number, now = Date.now()) { this.tokens = capacity; this.time = now; }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.time) * this.rate / 1000);
    this.time = now;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}
