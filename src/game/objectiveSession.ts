import { PracticeEconomy } from './economy';
import { WeaponInventory } from './weapons';
import { LocalObjectiveAuthority } from './objective';
import type { ObjectiveConfig } from './objective';

/** Offline adapter: physics/damage observations are trusted here, never network payloads.
 * A networked game must place this adapter and the rule authority on its server. */
export class ObjectiveSession {
  readonly authority: LocalObjectiveAuthority;
  private economies = new Map<string, PracticeEconomy>();
  private inventories = new Map<string, WeaponInventory>();
  private roundKey = '';
  private epoch = -1;
  private previousRound = 0;
  private awardedResult = '';
  private damageEvents = new Set<string>();

  constructor(config: Partial<ObjectiveConfig> = {}) {
    this.authority = new LocalObjectiveAuthority(config);
    this.sync();
  }
  get snapshot() { return this.authority.snapshot; }
  economyFor(id: string) { return this.economies.get(id)!; }
  inventoryFor(id: string) { return this.inventories.get(id)!; }

  advance(dt: number) { this.authority.advance(dt); this.sync(); }
  sync() {
    const s = this.snapshot;
    const key = `${s.epoch}:${s.round}`;
    if (key !== this.roundKey && s.phase !== 'transition') {
      // Epoch changes on every round; only a reset of the displayed round is a rematch.
      const rematch = this.epoch < 0 || s.round <= this.previousRound;
      for (const p of s.players) {
        let economy = this.economies.get(p.id);
        let inventory = this.inventories.get(p.id);
        if (rematch || !economy || !inventory) {
          economy = new PracticeEconomy({autoFinishOnDeath:false});
          inventory = new WeaponInventory();
          this.economies.set(p.id, economy); this.inventories.set(p.id, inventory);
        } else {
          economy.execute({type:'new-round'});
        }
        inventory.reset(); inventory.setOwnership(economy.snapshot.ownedWeapons);
        inventory.activeId = economy.snapshot.equipped;
        if (economy.snapshot.primaryId) inventory.primaryId = economy.snapshot.primaryId;
        inventory.draw();
      }
      this.epoch = s.epoch; this.previousRound = s.round; this.roundKey = key; this.damageEvents.clear();
    }
    if (s.phase === 'combat' || s.phase === 'planted' || s.phase === 'result') {
      for (const economy of this.economies.values()) {
        if (economy.snapshot.phase === 'buy') economy.execute({type:'start-round'});
      }
    }
    if (s.result && `${s.epoch}:${s.result.id}` !== this.awardedResult) {
      this.awardedResult = `${s.epoch}:${s.result.id}`;
      for (const p of s.players) this.economyFor(p.id).execute({type:'finish-round', outcome:p.team === s.result.winner ? 'win' : 'loss'});
    }
  }
  damage(playerId: string, amount: number, eventId: string, attackerId?: string) {
    const s = this.snapshot;
    const p = s.players.find(player => player.id === playerId);
    if (!p?.alive || !p.connected || !['combat','planted'].includes(s.phase) ||
        !Number.isFinite(amount) || amount <= 0 || !eventId || this.damageEvents.has(eventId) || this.damageEvents.size >= 4096) return false;
    const economy = this.economyFor(playerId);
    const before = economy.snapshot.health;
    const result = economy.execute({type:'damage', amount});
    if (!result.ok) return false;
    this.damageEvents.add(eventId);
    const killer = s.players.find(player => player.id === attackerId);
    if (economy.snapshot.health === 0 && killer?.alive && killer.team !== p.team) {
      this.economyFor(killer.id).execute({type:'elimination', eventId});
    }
    this.authority.interrupt(playerId, 'Damage cancelled interaction.');
    const hpDamage = before - economy.snapshot.health;
    if (hpDamage > 0) this.authority.applyDamage(playerId, hpDamage, eventId);
    this.sync(); return true;
  }
}
