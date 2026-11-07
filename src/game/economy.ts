import { findShopItem } from './catalog';
import type { ShopItemId } from './catalog';
import { WEAPONS } from './weapons';
import type { WeaponId } from './weapons';

export type ArmorType = 'light-armor' | 'heavy-armor';
export type EconomyPhase = 'buy' | 'live' | 'ended';
export interface EconomySnapshot {
  readonly credits: number;
  readonly health: number;
  readonly armor: number;
  readonly armorType: ArmorType | null;
  readonly round: number;
  readonly phase: EconomyPhase;
  readonly ownedWeapons: readonly WeaponId[];
  readonly refundable: readonly ShopItemId[];
  readonly equipped: WeaponId;
  readonly primaryId: 'rifle' | 'smg' | 'sniper' | null;
  readonly lastMessage: string;
}
export type EconomyCommand =
  | {type:'buy'; itemId:string}
  | {type:'sell'; itemId:string}
  | {type:'equip'; weaponId:string}
  | {type:'start-round'}
  | {type:'finish-round'; outcome:'win' | 'loss'}
  | {type:'new-round'}
  | {type:'damage'; amount:number}
  | {type:'elimination'; eventId:string};
export interface EconomyResult { readonly ok: boolean; readonly message: string; }
export interface EconomyRules { armorAbsorption?: number; autoFinishOnDeath?: boolean; }
interface Receipt { price:number; previousArmor?: {type:ArmorType | null; points:number}; }

export const STARTING_CREDITS = 800;
export const MAX_CREDITS = 9000;
export const ROUND_WIN_CREDITS = 3000;
export const ROUND_LOSS_CREDITS = 1900;
export const ELIMINATION_CREDITS = 200;
export const DEFAULT_ARMOR_ABSORPTION = .6;
const isWeaponId = (value: unknown): value is WeaponId => typeof value === 'string' && Object.hasOwn(WEAPONS, value);
const isArmor = (id: ShopItemId): id is ArmorType => id === 'light-armor' || id === 'heavy-armor';

/**
 * Validated economy rules for offline Practice and authoritative server rooms.
 * UI receives immutable snapshots and submits validated commands. No money or armor
 * is loaded from localStorage. The browser instance is not a security boundary;
 * private online rooms keep this model on the server and broadcast snapshots.
 */
export class PracticeEconomy {
  #credits = STARTING_CREDITS;
  #health = 100;
  #armor = 0;
  #armorType: ArmorType | null = null;
  #round = 1;
  #phase: EconomyPhase = 'buy';
  #owned = new Set<WeaponId>(['knife']);
  #receipts = new Map<ShopItemId, Receipt>();
  #equipped: WeaponId = 'knife';
  #primary: 'rifle' | 'smg' | 'sniper' | null = null;
  #message = 'Practice economy ready. Buy equipment, then start the round.';
  #eliminations = new Set<string>();
  #absorption: number;
  #autoFinishOnDeath: boolean;

  constructor(rules: EconomyRules = {}) {
    this.#autoFinishOnDeath = rules.autoFinishOnDeath !== false;
    const ratio = rules.armorAbsorption;
    this.#absorption = typeof ratio === 'number' && Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio)) : DEFAULT_ARMOR_ABSORPTION;
  }

  get snapshot(): EconomySnapshot {
    return Object.freeze({
      credits:this.#credits, health:this.#health, armor:this.#armor, armorType:this.#armorType,
      round:this.#round, phase:this.#phase, ownedWeapons:Object.freeze([...this.#owned]),
      refundable:Object.freeze([...this.#receipts.keys()]), equipped:this.#equipped,
      primaryId:this.#primary, lastMessage:this.#message,
    });
  }

  #result(ok: boolean, message: string): EconomyResult {
    this.#message = message;
    return Object.freeze({ok, message});
  }
  #reward(amount: number) { this.#credits = Math.min(MAX_CREDITS, this.#credits + amount); }
  #finish(outcome: 'win' | 'loss'): EconomyResult {
    this.#phase = 'ended';
    const reward = outcome === 'win' ? ROUND_WIN_CREDITS : ROUND_LOSS_CREDITS;
    this.#reward(reward);
    return this.#result(true, `Practice round ${outcome}: +${reward} credits.`);
  }

  execute(command: EconomyCommand): EconomyResult {
    // Validate runtime shape too: UI/transport payloads are not trusted just because TS compiled.
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') return this.#result(false, 'Invalid economy command.');
    switch (command.type) {
      case 'buy': return this.#buy(command.itemId);
      case 'sell': return this.#sell(command.itemId);
      case 'equip': {
        if (!isWeaponId(command.weaponId) || !this.#owned.has(command.weaponId)) return this.#result(false, 'You do not own that weapon.');
        this.#equipped = command.weaponId;
        if (WEAPONS[command.weaponId].slot === 1) this.#primary = command.weaponId as 'rifle' | 'smg' | 'sniper';
        return this.#result(true, `${WEAPONS[command.weaponId].name} equipped.`);
      }
      case 'start-round': {
        if (this.#phase !== 'buy') return this.#result(false, 'The round can only start from the buy phase.');
        this.#phase = 'live'; this.#receipts.clear();
        return this.#result(true, 'Practice round live. Buying and refunds are closed.');
      }
      case 'finish-round': {
        if (this.#phase !== 'live') return this.#result(false, 'Only a live Practice round can finish.');
        if (command.outcome !== 'win' && command.outcome !== 'loss') return this.#result(false, 'Invalid round outcome.');
        return this.#finish(command.outcome);
      }
      case 'new-round': {
        if (this.#phase !== 'ended') return this.#result(false, 'Finish the current round before starting another.');
        this.#round++; this.#phase = 'buy'; this.#health = 100;
        this.#receipts.clear(); this.#eliminations.clear();
        return this.#result(true, `Practice round ${this.#round}: buy phase open.`);
      }
      case 'damage': return this.#damage(command.amount);
      case 'elimination': {
        if (this.#phase !== 'live') return this.#result(false, 'Elimination rewards require a live Practice round.');
        if (typeof command.eventId !== 'string' || !command.eventId.trim() || command.eventId.length > 100) return this.#result(false, 'Invalid elimination event.');
        if (this.#eliminations.has(command.eventId)) return this.#result(false, 'That elimination was already rewarded.');
        this.#eliminations.add(command.eventId); this.#reward(ELIMINATION_CREDITS);
        return this.#result(true, `Practice elimination: +${ELIMINATION_CREDITS} credits.`);
      }
      default: return this.#result(false, 'Invalid economy command.');
    }
  }

  #buy(id: string): EconomyResult {
    if (this.#phase !== 'buy') return this.#result(false, 'Purchases are only available during the buy phase.');
    if (typeof id !== 'string') return this.#result(false, 'Invalid shop item.');
    const item = findShopItem(id);
    if (!item) return this.#result(false, 'Invalid shop item.');
    if (item.weaponId && this.#owned.has(item.weaponId)) return this.#result(false, 'You already own that weapon.');
    if (isArmor(item.id)) {
      if (this.#receipts.has('light-armor') || this.#receipts.has('heavy-armor')) return this.#result(false, 'Refund this phase’s armor before replacing it.');
      if ((item.armorPoints ?? 0) <= this.#armor) return this.#result(false, 'Your equipped armor already provides at least that protection.');
    }
    if (this.#credits < item.price) return this.#result(false, 'Insufficient credits.');
    // Every validation above completes before the purchase mutates money or equipment.
    const receipt: Receipt = {price:item.price};
    if (item.weaponId) {
      this.#owned.add(item.weaponId); this.#equipped = item.weaponId;
      if (WEAPONS[item.weaponId].slot === 1) this.#primary = item.weaponId as 'rifle' | 'smg' | 'sniper';
    } else if (isArmor(item.id)) {
      receipt.previousArmor = {type:this.#armorType, points:this.#armor};
      this.#armorType = item.id; this.#armor = item.armorPoints ?? 0;
    }
    this.#credits -= item.price;
    this.#receipts.set(item.id, receipt);
    return this.#result(true, `${item.name} purchased for ${item.price} credits.`);
  }

  #sell(id: string): EconomyResult {
    if (this.#phase !== 'buy') return this.#result(false, 'Refunds are only available during the same buy phase.');
    if (typeof id !== 'string') return this.#result(false, 'Invalid shop item.');
    const item = findShopItem(id);
    if (!item) return this.#result(false, 'Invalid shop item.');
    const receipt = this.#receipts.get(item.id);
    if (!receipt) return this.#result(false, 'Only purchases from this buy phase can be refunded.');
    if (item.weaponId) {
      this.#owned.delete(item.weaponId);
      if (this.#primary === item.weaponId) {
        this.#primary = (['rifle','smg','sniper'] as const).find(weapon => this.#owned.has(weapon)) ?? null;
      }
      if (this.#equipped === item.weaponId) this.#equipped = this.#owned.has('pistol') ? 'pistol' : 'knife';
    } else if (isArmor(item.id)) {
      const previous = receipt.previousArmor;
      this.#armor = previous?.points ?? 0;
      this.#armorType = this.#armor > 0 ? previous?.type ?? null : null;
    }
    this.#receipts.delete(item.id); this.#reward(receipt.price);
    return this.#result(true, `${item.name} refunded: +${receipt.price} credits.`);
  }

  #damage(amount: number): EconomyResult {
    if (this.#phase !== 'live') return this.#result(false, 'Damage testing requires a live Practice round.');
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return this.#result(false, 'Damage must be a positive finite number.');
    const absorbed = Math.min(this.#armor, amount * this.#absorption);
    this.#armor = Math.max(0, this.#armor - absorbed);
    this.#health = Math.max(0, this.#health - (amount - absorbed));
    if (this.#armor === 0) this.#armorType = null;
    if (this.#health === 0 && this.#autoFinishOnDeath) return this.#finish('loss');
    return this.#result(true, `Practice damage: ${Number((amount-absorbed).toFixed(2))} HP, ${Number(absorbed.toFixed(2))} armor consumed.`);
  }
}
