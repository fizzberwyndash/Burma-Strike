import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Resolve the pure TS module graph in memory; no browser, server or third-party runner required.
const compiled = new Map();
async function sourceUrl(url) {
  if (compiled.has(url.href)) return compiled.get(url.href);
  let { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
    const dependency = new URL(`${match[2].replace(/\.ts$/, '')}.ts`, url);
    const replacement = await sourceUrl(dependency);
    outputText = outputText.replace(match[0], `from ${JSON.stringify(replacement)}`);
  }
  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  compiled.set(url.href, dataUrl);
  return dataUrl;
}
const { PracticeEconomy } = await import(await sourceUrl(new URL('../src/game/economy.ts', import.meta.url)));
const { WeaponInventory } = await import(await sourceUrl(new URL('../src/game/weapons.ts', import.meta.url)));
const command = (economy, action) => economy.execute(action);
const buy = (economy, itemId) => command(economy, { type: 'buy', itemId });
const sell = (economy, itemId) => command(economy, { type: 'sell', itemId });
const start = economy => command(economy, { type: 'start-round' });
const end = (economy, outcome = 'win') => command(economy, { type: 'finish-round', outcome });
const next = economy => command(economy, { type: 'new-round' });
const damage = (economy, amount) => command(economy, { type: 'damage', amount });
const finishAnimation = inventory => { for (let i = 0; i < 160; i++) inventory.update(.02); };

// These are observable economy invariants, not assertions about implementation fields.
test('a fresh local drill starts with 800 credits and knife-only ownership', () => {
  const economy = new PracticeEconomy();
  const state = economy.snapshot;
  assert.equal(state.credits, 800);
  assert.equal(state.health, 100);
  assert.equal(state.armor, 0);
  assert.equal(state.armorType, null);
  assert.equal(state.round, 1);
  assert.equal(state.phase, 'buy');
  assert.deepEqual(state.ownedWeapons, ['knife']);
  assert.equal(state.equipped, 'knife');
  assert.equal(state.primaryId, null);
  assert.deepEqual(state.refundable, []);
});

test('a successful pistol and light armor purchase spends the exact starting budget', () => {
  const economy = new PracticeEconomy();
  assert.equal(buy(economy, 'pistol').ok, true);
  assert.equal(economy.snapshot.credits, 450);
  assert.equal(economy.snapshot.equipped, 'pistol');
  assert.ok(economy.snapshot.ownedWeapons.includes('pistol'));
  assert.equal(buy(economy, 'light-armor').ok, true);
  assert.equal(economy.snapshot.credits, 0);
  assert.equal(economy.snapshot.armor, 25);
  assert.equal(economy.snapshot.armorType, 'light-armor');
  assert.deepEqual([...economy.snapshot.refundable].sort(), ['light-armor', 'pistol']);
});

test('insufficient credit, duplicate and invalid purchases do not change equipment or balances', () => {
  const economy = new PracticeEconomy();
  assert.equal(buy(economy, 'rifle').ok, false);
  assert.equal(economy.snapshot.credits, 800);
  assert.equal(buy(economy, 'pistol').ok, true);
  assert.equal(buy(economy, 'pistol').ok, false);
  assert.equal(buy(economy, 'knife').ok, false);
  assert.equal(buy(economy, 'not-a-weapon').ok, false);
  assert.equal(buy(economy, '__proto__').ok, false);
  assert.equal(economy.snapshot.credits, 450);
  assert.equal(economy.snapshot.equipped, 'pistol');
});

test('same-phase refunds restore exact credits once and select an owned fallback weapon', () => {
  const economy = new PracticeEconomy();
  buy(economy, 'pistol'); buy(economy, 'light-armor');
  assert.equal(sell(economy, 'pistol').ok, true);
  assert.equal(economy.snapshot.credits, 350);
  assert.equal(economy.snapshot.equipped, 'knife');
  assert.ok(!economy.snapshot.ownedWeapons.includes('pistol'));
  assert.equal(sell(economy, 'pistol').ok, false);
  assert.equal(sell(economy, 'light-armor').ok, true);
  assert.equal(economy.snapshot.credits, 800);
  assert.equal(economy.snapshot.armor, 0);
  assert.equal(economy.snapshot.armorType, null);
  assert.deepEqual(economy.snapshot.refundable, []);
});

test('buy phase closure prevents purchases and refunds even after another round starts', () => {
  const economy = new PracticeEconomy();
  buy(economy, 'pistol'); start(economy);
  assert.equal(economy.snapshot.phase, 'live');
  assert.equal(buy(economy, 'light-armor').ok, false);
  assert.equal(sell(economy, 'pistol').ok, false);
  assert.deepEqual(economy.snapshot.refundable, []);
  assert.equal(end(economy).ok, true);
  assert.equal(next(economy).ok, true);
  assert.equal(economy.snapshot.round, 2);
  assert.equal(economy.snapshot.phase, 'buy');
  assert.ok(economy.snapshot.ownedWeapons.includes('pistol'));
  assert.equal(sell(economy, 'pistol').ok, false);
});

test('round and elimination rewards are awarded once, validate phase and stop at 9000', () => {
  const economy = new PracticeEconomy();
  assert.equal(end(economy).ok, false);
  assert.equal(command(economy, { type: 'elimination', eventId: 'target-1' }).ok, false);
  start(economy);
  assert.equal(command(economy, { type: 'elimination', eventId: 'target-1' }).ok, true);
  assert.equal(economy.snapshot.credits, 1000);
  assert.equal(command(economy, { type: 'elimination', eventId: 'target-1' }).ok, false);
  assert.equal(end(economy, 'win').ok, true);
  assert.equal(economy.snapshot.credits, 4000);
  assert.equal(end(economy, 'win').ok, false);
  assert.equal(economy.snapshot.credits, 4000);
  next(economy); start(economy);
  assert.equal(command(economy, { type: 'elimination', eventId: 'target-1' }).ok, true);
  assert.equal(end(economy, 'loss').ok, true);
  assert.equal(economy.snapshot.credits, 6100);
  next(economy); start(economy); end(economy, 'win');
  assert.equal(economy.snapshot.credits, 9000);
  next(economy); start(economy); end(economy, 'win');
  assert.equal(economy.snapshot.credits, 9000);
});

test('light armor is consumed before depletion redirects remaining damage to HP', () => {
  const economy = new PracticeEconomy();
  buy(economy, 'light-armor');
  assert.equal(damage(economy, 40).ok, false);
  start(economy);
  assert.equal(damage(economy, 40).ok, true);
  assert.equal(economy.snapshot.armor, 1);
  assert.equal(economy.snapshot.health, 84);
  assert.equal(damage(economy, 10).ok, true);
  assert.equal(economy.snapshot.armor, 0);
  assert.equal(economy.snapshot.armorType, null);
  assert.equal(economy.snapshot.health, 75);
});

test('heavy armor grants 50 points and consumes its configured share of real damage', () => {
  const economy = new PracticeEconomy();
  start(economy); end(economy); next(economy);
  assert.equal(buy(economy, 'heavy-armor').ok, true);
  assert.equal(economy.snapshot.armor, 50);
  assert.equal(economy.snapshot.armorType, 'heavy-armor');
  assert.equal(buy(economy, 'light-armor').ok, false);
  start(economy); damage(economy, 40);
  assert.equal(economy.snapshot.armor, 26);
  assert.equal(economy.snapshot.health, 84);
});

test('configurable absorption, invalid damage and death cannot produce negative HP or repeat rewards', () => {
  const economy = new PracticeEconomy({ armorAbsorption: .5 });
  buy(economy, 'light-armor'); start(economy);
  for (const invalid of [-5, 0, NaN, Infinity, '20']) assert.equal(damage(economy, invalid).ok, false);
  assert.equal(economy.snapshot.health, 100);
  assert.equal(economy.snapshot.armor, 25);
  damage(economy, 20);
  assert.equal(economy.snapshot.armor, 15);
  assert.equal(economy.snapshot.health, 90);
  assert.equal(damage(economy, 1000).ok, true);
  assert.equal(economy.snapshot.health, 0);
  assert.equal(economy.snapshot.armor, 0);
  assert.equal(economy.snapshot.phase, 'ended');
  assert.equal(economy.snapshot.credits, 2250);
  assert.equal(damage(economy, 100).ok, false);
  assert.equal(end(economy, 'loss').ok, false);
  assert.equal(economy.snapshot.credits, 2250);
  next(economy);
  assert.equal(economy.snapshot.health, 100);
  assert.equal(economy.snapshot.round, 2);
});

test('upgrading carried armor and refunding restores its exact previously damaged state', () => {
  const economy = new PracticeEconomy();
  buy(economy, 'light-armor'); start(economy); damage(economy, 20); end(economy); next(economy);
  assert.equal(economy.snapshot.armor, 13);
  const creditsBefore = economy.snapshot.credits;
  assert.equal(buy(economy, 'heavy-armor').ok, true);
  assert.equal(economy.snapshot.armor, 50);
  assert.equal(economy.snapshot.credits, creditsBefore - 1100);
  assert.equal(buy(economy, 'heavy-armor').ok, false);
  assert.equal(buy(economy, 'light-armor').ok, false);
  assert.equal(sell(economy, 'heavy-armor').ok, true);
  assert.equal(economy.snapshot.credits, creditsBefore);
  assert.equal(economy.snapshot.armor, 13);
  assert.equal(economy.snapshot.armorType, 'light-armor');
  assert.equal(buy(economy, 'light-armor').ok, true);
  assert.equal(economy.snapshot.armor, 25);
});

test('multiple owned primaries retain purchase history and equip only owned weapons', () => {
  const economy = new PracticeEconomy();
  start(economy); end(economy); next(economy);
  assert.equal(buy(economy, 'rifle').ok, true);
  assert.equal(economy.snapshot.equipped, 'rifle');
  assert.equal(economy.snapshot.primaryId, 'rifle');
  assert.equal(buy(economy, 'smg').ok, true);
  assert.equal(economy.snapshot.credits, 0);
  assert.equal(economy.snapshot.primaryId, 'smg');
  assert.ok(economy.snapshot.ownedWeapons.includes('rifle'));
  assert.equal(command(economy, { type: 'equip', weaponId: 'rifle' }).ok, true);
  assert.equal(economy.snapshot.equipped, 'rifle');
  assert.equal(command(economy, { type: 'equip', weaponId: 'sniper' }).ok, false);
  assert.equal(sell(economy, 'rifle').ok, true);
  assert.ok(economy.snapshot.ownedWeapons.includes(economy.snapshot.equipped));
});

test('runtime-invalid commands reject cleanly and snapshots cannot mutate authoritative local state', () => {
  const economy = new PracticeEconomy();
  for (const invalid of [null, undefined, {}, { type: 'credit', amount: 9000 }, { type: 'buy', itemId: 2 }, { type: 'equip', weaponId: '__proto__' }, { type: 'finish-round', outcome: 'draw' }]) {
    assert.doesNotThrow(() => { assert.equal(command(economy, invalid).ok, false); });
  }
  const state = economy.snapshot;
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.ownedWeapons));
  assert.ok(Object.isFrozen(state.refundable));
  assert.throws(() => { state.credits = 9000; }, TypeError);
  assert.throws(() => { state.armor = 50; }, TypeError);
  assert.throws(() => { state.ownedWeapons.push('sniper'); }, TypeError);
  assert.equal(economy.snapshot.credits, 800);
  assert.equal(economy.snapshot.armor, 0);
});

test('inventory ownership restriction prevents unpurchased equips while Free Range keeps its arsenal', () => {
  const inventory = new WeaponInventory();
  assert.equal(inventory.owns('rifle'), true);
  inventory.setOwnership(['knife']);
  assert.equal(inventory.activeId, 'knife');
  assert.equal(inventory.equipSlot(2), false);
  assert.equal(inventory.selectPrimary('rifle'), false);
  inventory.setOwnership(['knife', 'pistol', 'smg']);
  assert.equal(inventory.equipSlot(2), true); finishAnimation(inventory);
  assert.equal(inventory.activeId, 'pistol');
  assert.equal(inventory.selectPrimary('smg'), true);
  inventory.setOwnership(['knife']); // Removing a pending purchase must cancel its equip.
  finishAnimation(inventory);
  assert.equal(inventory.activeId, 'knife');
  assert.equal(inventory.owns('smg'), false);
  inventory.setOwnership(null);
  assert.equal(inventory.selectPrimary('sniper'), true); finishAnimation(inventory);
  assert.equal(inventory.activeId, 'sniper');
});
