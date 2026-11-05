import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the pure gameplay modules in memory: runs on Node 20+ without a test framework.
async function sourceModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { WeaponInventory, WEAPONS } = await sourceModule('../src/game/weapons.ts');
const { normalizeSettings, DEFAULT_SETTINGS } = await sourceModule('../src/game/settings.ts');
const finish = inventory => { for (let i=0; i<160; i++) inventory.update(.02); };

test('switching has holster and draw gates and preserves each gun ammunition', () => {
  const inv = new WeaponInventory();
  assert.equal(inv.fire(), true);
  assert.equal(inv.ammunition.magazine, 11);
  assert.equal(inv.equipSlot(1), true);
  assert.equal(inv.action, 'holstering');
  assert.equal(inv.fire(), false);
  assert.equal(inv.reload(), false);
  inv.update(WEAPONS.pistol.holsterTime);
  assert.equal(inv.activeId, 'rifle');
  assert.equal(inv.action, 'drawing');
  assert.equal(inv.fire(), false);
  finish(inv);
  assert.equal(inv.fire(), true);
  assert.equal(inv.ammunition.magazine, 29);
  inv.equipSlot(2); finish(inv);
  assert.equal(inv.ammunition.magazine, 11);
});

test('reload is atomic, blocks firing/switching, conserves ammunition and handles low reserve', () => {
  const inv = new WeaponInventory();
  inv.fire(); inv.update(.2); inv.fire();
  const total = inv.ammunition.magazine + inv.ammunition.reserve;
  assert.equal(inv.reload(), true);
  inv.update(.8);
  assert.equal(inv.ammunition.magazine, 10);
  assert.equal(inv.fire(), false);
  assert.equal(inv.equipSlot(3), false);
  inv.update(.8);
  assert.equal(inv.ammunition.magazine, 12);
  assert.equal(inv.ammunition.magazine+inv.ammunition.reserve, total);
  inv.ammunition.magazine=0; inv.ammunition.reserve=1;
  inv.reload(); finish(inv);
  assert.deepEqual(inv.ammunition, {magazine:1,reserve:0});
  assert.equal(inv.reload(), false);
});

test('cooldowns persist per weapon and the knife uses no ammunition', () => {
  const inv = new WeaponInventory(); inv.selectPrimary('sniper'); finish(inv);
  assert.equal(inv.fire(), true); assert.equal(inv.fire(), false);
  inv.equipSlot(3); inv.update(.23); inv.update(.25);
  assert.equal(inv.activeId, 'knife');
  assert.equal(inv.fire(), true); // A sniper cooldown must not delay the knife.
  assert.equal(inv.ammunition.magazine, 0);
  assert.equal(inv.reload(), false);
  assert.equal(inv.fire(), false);
});

test('practice loadout switching never grants free ammo, and resupply resets all weapons', () => {
  const inv = new WeaponInventory(); inv.selectPrimary('smg'); finish(inv);
  for(let i=0;i<24;i++){assert.equal(inv.fire(),true); inv.update(.075);}
  assert.equal(inv.fire(),false);
  inv.selectPrimary('rifle');finish(inv); inv.selectPrimary('smg');finish(inv);
  assert.equal(inv.ammunition.magazine,0);
  inv.reset();finish(inv);
  for(const w of Object.values(WEAPONS)) assert.deepEqual(inv.ammo[w.id], {magazine:w.magazineSize,reserve:w.reserveAmmo});
  assert.equal(inv.activeId,'pistol');
  assert.equal(inv.equipSlot(4),false);
});

test('inspection yields to firing while draw/reload/melee remain exclusive', () => {
  const inv = new WeaponInventory(); assert.equal(inv.inspect(),true);
  assert.equal(inv.fire(),true); assert.equal(inv.action,'ready');
  inv.reload(); assert.equal(inv.inspect(),false);
  finish(inv); inv.equipSlot(3);finish(inv);inv.fire();
  assert.equal(inv.inspect(),false); assert.equal(inv.equipSlot(2),false);
});

test('settings preserve Phase 1 choices, clamp boundaries and reject corrupt storage', () => {
  assert.deepEqual(normalizeSettings(null),DEFAULT_SETTINGS);
  const old=normalizeSettings({sensitivity:1.6,sound:false});
  assert.equal(old.sensitivity,1.6);assert.equal(old.sound,false);assert.equal(old.adsSensitivity,1);
  const limits=normalizeSettings({sensitivity:.01,adsSensitivity:2,scopedSensitivity:0,touchSensitivity:Infinity,fov:1000,invertY:true});
  assert.equal(limits.sensitivity,.05);assert.equal(limits.adsSensitivity,1.5);assert.equal(limits.scopedSensitivity,.1);
  assert.equal(limits.touchSensitivity,1);assert.equal(limits.fov,110);assert.equal(limits.invertY,true);
  assert.equal(normalizeSettings({sensitivity:NaN}).sensitivity,.35);
});
