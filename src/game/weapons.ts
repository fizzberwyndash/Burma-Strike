/** Pure inventory state; meshes and input never own ammunition or damage. */
export type WeaponId = 'pistol' | 'rifle' | 'smg' | 'sniper' | 'knife';
export type WeaponSlot = 1 | 2 | 3 | 4;
export type WeaponAction = 'ready' | 'holstering' | 'drawing' | 'reloading' | 'inspecting' | 'melee';
export interface WeaponDefinition {
  id: WeaponId; name: string; kind: WeaponId; slot: 1 | 2 | 3;
  magazineSize: number; reserveAmmo: number; fireInterval: number; reloadTime: number;
  drawTime: number; holsterTime: number; damage: number; headDamage: number;
  range: number; automatic: boolean; adsFov: number; recoil: number;
  tracerLength: number; tracerLife: number;
}
export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  pistol: { id:'pistol', name:'KITE–12', kind:'pistol', slot:2, magazineSize:12, reserveAmmo:48, fireInterval:.19, reloadTime:1.6, drawTime:.3, holsterTime:.16, damage:34, headDamage:100, range:100, automatic:false, adsFov:72, recoil:1, tracerLength:7, tracerLife:.06 },
  rifle: { id:'rifle', name:'TAMARIND AR', kind:'rifle', slot:1, magazineSize:30, reserveAmmo:90, fireInterval:.105, reloadTime:2.15, drawTime:.4, holsterTime:.2, damage:34, headDamage:100, range:140, automatic:true, adsFov:66, recoil:1.2, tracerLength:10, tracerLife:.055 },
  smg: { id:'smg', name:'SWIFT–24', kind:'smg', slot:1, magazineSize:24, reserveAmmo:96, fireInterval:.075, reloadTime:1.8, drawTime:.32, holsterTime:.16, damage:25, headDamage:70, range:85, automatic:true, adsFov:74, recoil:.7, tracerLength:6, tracerLife:.045 },
  sniper: { id:'sniper', name:'HORNBILL S5', kind:'sniper', slot:1, magazineSize:5, reserveAmmo:20, fireInterval:1.1, reloadTime:2.6, drawTime:.5, holsterTime:.23, damage:100, headDamage:150, range:200, automatic:false, adsFov:28, recoil:2.1, tracerLength:20, tracerLife:.085 },
  knife: { id:'knife', name:'LOTUS EDGE', kind:'knife', slot:3, magazineSize:0, reserveAmmo:0, fireInterval:.55, reloadTime:0, drawTime:.25, holsterTime:.14, damage:50, headDamage:100, range:2.2, automatic:false, adsFov:90, recoil:0, tracerLength:0, tracerLife:0 },
};
export interface WeaponAmmo { magazine: number; reserve: number; }

export class WeaponInventory {
  activeId: WeaponId = 'pistol';
  primaryId: 'rifle' | 'smg' | 'sniper' = 'rifle';
  action: WeaponAction = 'ready';
  private cooldowns: Record<WeaponId, number> = {pistol:0, rifle:0, smg:0, sniper:0, knife:0};
  /** Slot 4 is reserved. Practice does not grant an objective device. */
  readonly objectiveCarried = false;
  readonly ammo = Object.fromEntries(Object.values(WEAPONS).map(w => [w.id, {magazine:w.magazineSize, reserve:w.reserveAmmo}])) as Record<WeaponId, WeaponAmmo>;
  private pending: WeaponId | null = null;
  private remaining = 0;
  private duration = 0;

  get definition() { return WEAPONS[this.activeId]; }
  get cooldown() { return this.cooldowns[this.activeId]; }
  get ammunition() { return this.ammo[this.activeId]; }
  get progress() { return this.duration ? Math.min(1, Math.max(0, 1 - this.remaining / this.duration)) : 1; }
  get busy() { return this.action !== 'ready' && this.action !== 'inspecting'; }

  private begin(action: WeaponAction, duration: number) {
    this.action = action; this.duration = duration; this.remaining = duration;
  }
  draw() { this.begin('drawing', this.definition.drawTime); }
  equipSlot(slot: number) {
    const id = slot === 1 ? this.primaryId : slot === 2 ? 'pistol' : slot === 3 ? 'knife' : null;
    return id ? this.equip(id) : false;
  }
  equip(id: WeaponId) {
    if (id === this.activeId || this.busy) return false;
    this.pending = id;
    this.begin('holstering', this.definition.holsterTime);
    return true;
  }
  selectPrimary(id: 'rifle' | 'smg' | 'sniper') {
    if (this.busy) return false;
    this.primaryId = id;
    // Selecting a loadout equips it but never replenishes its ammunition.
    return id === this.activeId || this.equip(id);
  }
  reload() {
    const {definition:w, ammunition:a} = this;
    if (this.busy || w.kind === 'knife' || a.reserve <= 0 || a.magazine >= w.magazineSize) return false;
    this.begin('reloading', w.reloadTime);
    return true;
  }
  inspect() {
    if (this.busy) return false;
    this.begin('inspecting', 1.6); return true;
  }
  fire() {
    if (this.busy || this.cooldown > .00001) return false;
    const w = this.definition;
    if (w.kind !== 'knife' && this.ammunition.magazine <= 0) return false;
    if (w.kind !== 'knife') this.ammunition.magazine--;
    this.cooldowns[this.activeId] = w.fireInterval;
    if (w.kind === 'knife') this.begin('melee', .42);
    else if (this.action === 'inspecting') this.begin('ready', 0);
    return true;
  }
  /** Returns true on the exact update where the visible weapon must change. */
  update(dt: number) {
    for (const id of Object.keys(this.cooldowns) as WeaponId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    if (this.action === 'ready') return false;
    this.remaining -= dt;
    if (this.remaining > .00001) return false;
    if (this.action === 'holstering' && this.pending) {
      this.activeId = this.pending; this.pending = null; this.draw(); return true;
    }
    if (this.action === 'reloading') {
      const a = this.ammunition;
      const amount = Math.min(this.definition.magazineSize - a.magazine, a.reserve);
      a.magazine += amount; a.reserve -= amount;
    }
    this.begin('ready', 0); return false;
  }
  reset() {
    for (const w of Object.values(WEAPONS)) {
      this.ammo[w.id].magazine = w.magazineSize; this.ammo[w.id].reserve = w.reserveAmmo;
    }
    this.activeId = 'pistol'; this.pending = null;
    for (const id of Object.keys(this.cooldowns) as WeaponId[]) this.cooldowns[id] = 0;
    this.draw();
  }
}
