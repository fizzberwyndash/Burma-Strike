import type { WeaponId } from './weapons';

export type ShopItemId = WeaponId | 'light-armor' | 'heavy-armor';
export type ShopCategory = 'Pistols' | 'SMGs' | 'Rifles' | 'Snipers' | 'Armor';
export interface ShopItem {
  readonly id: ShopItemId;
  readonly name: string;
  readonly category: ShopCategory;
  readonly price: number;
  readonly weaponId?: WeaponId;
  readonly armorPoints?: number;
  readonly description: string;
}

/** Purchase metadata is separate from weapon stats and their procedural visual models. */
export const SHOP_ITEMS: readonly ShopItem[] = Object.freeze([
  {id:'pistol', name:'SHWE-9', category:'Pistols', price:350, weaponId:'pistol', description:'A precise and dependable semi-automatic sidearm.'},
  {id:'smg', name:'BAGAN-21', category:'SMGs', price:1100, weaponId:'smg', description:'A compact automatic weapon built for close courtyards.'},
  {id:'rifle', name:'MUDON AR', category:'Rifles', price:2700, weaponId:'rifle', description:'A versatile automatic rifle for measured bursts.'},
  {id:'sniper', name:'NAGA SCOPE', category:'Snipers', price:4500, weaponId:'sniper', description:'A deliberate long-range rifle with a magnified optic.'},
  {id:'light-armor', name:'Light Armor', category:'Armor', price:450, armorPoints:25, description:'25 armor points. Absorbs a configured share of incoming damage.'},
  {id:'heavy-armor', name:'Heavy Armor', category:'Armor', price:1100, armorPoints:50, description:'50 armor points for sustained protection in the field.'},
].map(item => Object.freeze(item as ShopItem)));

export function findShopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find(item => item.id === id);
}
