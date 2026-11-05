import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/game/objective.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { LocalObjectiveAuthority, OBJECTIVE_SITES, OBJECTIVE_DURATIONS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
let nextId = 0;
const attacker = 'attacker-1';
const defender = 'defender-1';
const atSite = (site = 'A') => ({ ...OBJECTIVE_SITES.find(candidate => candidate.id === site).position, y: .85 });
function intent(game, type, actorId = attacker, isHost = false, extra = {}) {
  const { round, epoch } = game.snapshot;
  return game.dispatch({ id: `intent-${++nextId}`, round, epoch, type, ...extra }, actorId, isHost);
}
function combat(config) {
  const game = new LocalObjectiveAuthority(config);
  game.advance(OBJECTIVE_DURATIONS.buy);
  assert.equal(game.snapshot.phase, 'combat');
  return game;
}
function startPlant(game, site = 'A', actorId = attacker) {
  game.updatePosition(actorId, atSite(site));
  assert.equal(game.equipCore(actorId, true), true);
  assert.equal(intent(game, 'interact-start', actorId).ok, true);
}
function planted(config) {
  const game = combat(config);
  startPlant(game);
  game.advance(4);
  assert.equal(game.snapshot.phase, 'planted');
  return game;
}
function startDefuse(game) {
  game.updatePosition(defender, { ...game.snapshot.corePosition, y: .85 });
  assert.equal(intent(game, 'interact-start', defender).ok, true);
}
function health(game, player = attacker) { return game.snapshot.players.find(candidate => candidate.id === player).health; }

test('initial state has isolated teams, exact timings, safe sites and immutable snapshots', () => {
  const game = new LocalObjectiveAuthority();
  const first = game.snapshot;
  assert.equal(first.phase, 'buy');
  assert.equal(first.remaining, 20);
  assert.equal(first.carrierId, attacker);
  assert.equal(first.players.length, 2);
  assert.equal(new LocalObjectiveAuthority({ format: '2v1' }).snapshot.players.length, 3);
  assert.deepEqual(first.scores, { attackers: 0, defenders: 0 });
  for (const value of [first, first.players, first.players[0], first.players[0].position, first.scores, first.config, OBJECTIVE_SITES, OBJECTIVE_SITES[0].position]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { first.players[0].health = 0; }, TypeError);
  assert.throws(() => { first.scores.attackers = 20; }, TypeError);
  game.advance(20);
  assert.equal(first.phase, 'buy');
  assert.equal(game.snapshot.remaining, 100);
  assert.deepEqual(OBJECTIVE_DURATIONS, { buy: 20, combat: 100, plant: 4, planted: 35, defuse: 6, transition: 1 });
});

test('only the equipped carrier inside the enabled site can start planting in combat', () => {
  const game = new LocalObjectiveAuthority({ format: '2v1', activeSite: 'B' });
  game.updatePosition(attacker, atSite('B'));
  game.equipCore(attacker, true);
  assert.equal(intent(game, 'interact-start').ok, false);
  game.advance(20);
  game.updatePosition('attacker-2', atSite('B'));
  assert.equal(game.equipCore('attacker-2', true), false);
  assert.equal(intent(game, 'interact-start', 'attacker-2').ok, false);
  game.updatePosition(defender, atSite('B'));
  assert.equal(game.equipCore(defender, true), false);
  assert.equal(intent(game, 'interact-start', defender).ok, false);
  game.updatePosition(attacker, atSite('A'));
  assert.equal(intent(game, 'interact-start').ok, false);
  game.updatePosition(attacker, atSite('B'));
  game.equipCore(attacker, false);
  assert.equal(intent(game, 'interact-start').ok, false);
  game.equipCore(attacker, true);
  assert.equal(intent(game, 'interact-start').ok, true);
  game.advance(4);
  assert.equal(game.snapshot.plantedSite, 'B');
});

test('plant advances through real uninterrupted authority time, not repeated messages', () => {
  const game = combat();
  startPlant(game);
  game.advance(2);
  assert.equal(game.snapshot.interaction.progress, .5);
  assert.equal(intent(game, 'interact-start').ok, true);
  assert.equal(game.snapshot.interaction.progress, .5);
  game.advance(1.99);
  assert.equal(game.snapshot.phase, 'combat');
  game.advance(.01);
  assert.equal(game.snapshot.phase, 'planted');
  assert.equal(game.snapshot.remaining, 35);
  assert.equal(game.snapshot.coreState, 'planted');
  assert.equal(game.snapshot.carrierId, null);
  assert.equal(game.snapshot.plantedSite, 'A');
  assert.equal(game.snapshot.corePosition.y, .2);
  assert.equal(game.snapshot.interaction, null);
  assert.equal(game.equipCore(attacker, true), false);
});

test('release, damage, absorbed hits and holstering cancel and reset plant progress', () => {
  const game = combat();
  startPlant(game);
  game.advance(3);
  assert.equal(intent(game, 'interact-stop').ok, true);
  assert.equal(game.snapshot.interaction, null);
  game.advance(5);
  assert.equal(game.snapshot.phase, 'combat');
  intent(game, 'interact-start'); game.advance(2);
  assert.equal(game.applyDamage(attacker, 1, 'plant-hit').ok, true);
  assert.equal(game.snapshot.interaction, null);
  intent(game, 'interact-start'); game.advance(2);
  game.interrupt(attacker, 'Armor absorbed the hit');
  assert.equal(game.snapshot.interaction, null);
  assert.equal(health(game), 99);
  intent(game, 'interact-start'); game.advance(2);
  game.equipCore(attacker, false);
  assert.equal(game.snapshot.interaction, null);
  assert.equal(intent(game, 'interact-start').ok, false);
  game.equipCore(attacker, true);
  intent(game, 'interact-start'); game.advance(3.99);
  assert.equal(game.snapshot.phase, 'combat');
  game.advance(.01);
  assert.equal(game.snapshot.phase, 'planted');
});

test('movement threshold, vertical jumps and site range cancel planting without frame dependence', () => {
  const game = combat();
  startPlant(game);
  const center = atSite();
  game.updatePosition(attacker, { ...center, x: center.x + .15 });
  assert.notEqual(game.snapshot.interaction, null);
  game.updatePosition(attacker, { ...center, x: center.x + .151 });
  assert.equal(game.snapshot.interaction, null);
  game.updatePosition(attacker, center); intent(game, 'interact-start');
  game.updatePosition(attacker, { ...center, y: center.y + .2 });
  assert.equal(game.snapshot.interaction, null);
  game.updatePosition(attacker, { ...center, x: center.x + 3.25 }); intent(game, 'interact-start');
  game.updatePosition(attacker, { ...center, x: center.x + 3.35 });
  assert.equal(game.snapshot.interaction, null);
  game.updatePosition(attacker, { x: NaN, y: 0, z: 0 });
  assert.equal(Number.isFinite(game.snapshot.players[0].position.x), true);
});

test('trusted physics accepts getter-backed vector coordinates without copying backing fields', () => {
  class PhysicsVector {
    constructor(x, y, z) { this._x = x; this._y = y; this._z = z; }
    get x() { return this._x; }
    get y() { return this._y; }
    get z() { return this._z; }
  }
  const game = combat();
  const position = atSite();
  const vector = new PhysicsVector(position.x, position.y, position.z);
  game.updatePosition(attacker, vector);
  assert.deepEqual(game.snapshot.players[0].position, position);
  assert.equal(Object.values(game.snapshot.players[0].position).every(Number.isFinite), true);
  vector._x += 5;
  assert.deepEqual(game.snapshot.players[0].position, position); // Authority retains its own copy.
  assert.equal(game.equipCore(attacker, true), true);
  assert.equal(intent(game, 'interact-start').ok, true);
  game.advance(4);
  assert.equal(game.snapshot.phase, 'planted');
  game.updatePosition(defender, new PhysicsVector(position.x, position.y, position.z));
  assert.equal(intent(game, 'interact-start', defender).ok, true);
  game.advance(6);
  assert.equal(game.snapshot.coreState, 'defused');
});

test('defender must stay nearby for six seconds, and release/damage/movement cancel defuse', () => {
  const game = planted();
  assert.equal(intent(game, 'interact-start').ok, false);
  assert.equal(intent(game, 'interact-start', defender).ok, false);
  startDefuse(game); game.advance(3);
  assert.equal(game.snapshot.interaction.progress, .5);
  intent(game, 'interact-stop', defender);
  assert.equal(game.snapshot.interaction, null);
  startDefuse(game); game.advance(1);
  game.applyDamage(defender, 1, 'defuse-hit');
  assert.equal(game.snapshot.interaction, null);
  startDefuse(game);
  game.updatePosition(defender, { ...game.snapshot.corePosition, y: 1.1 });
  assert.equal(game.snapshot.interaction, null);
  startDefuse(game); game.advance(6);
  assert.equal(game.snapshot.phase, 'result');
  assert.equal(game.snapshot.coreState, 'defused');
  assert.equal(game.snapshot.result.winner, 'defenders');
  assert.equal(game.snapshot.scores.defenders, 1);
  assert.equal(game.snapshot.interaction, null);
});

test('one actor cannot cancel or replace another actor interaction', () => {
  const game = combat({ format: '2v1' });
  startPlant(game);
  game.advance(1);
  assert.equal(intent(game, 'interact-stop', defender).ok, false);
  assert.equal(intent(game, 'interact-start', 'attacker-2').ok, false);
  assert.equal(game.snapshot.interaction.playerId, attacker);
  assert.equal(game.snapshot.interaction.progress, .25);
  game.interrupt(defender);
  assert.equal(game.snapshot.interaction.playerId, attacker);
});

test('combat timeout wins for defenders and exact plant/deadline ties favor timeout', () => {
  const game = combat();
  game.advance(96);
  startPlant(game);
  game.advance(4);
  assert.equal(game.snapshot.phase, 'result');
  assert.equal(game.snapshot.result.winner, 'defenders');
  assert.equal(game.snapshot.coreState, 'carried');
  assert.match(game.snapshot.result.reason, /time expired/);
  const earlier = combat();
  earlier.advance(95.99); startPlant(earlier); earlier.advance(4);
  assert.equal(earlier.snapshot.phase, 'planted');
});

test('planted expiry wins for attackers and exact defuse/deadline ties favor detonation', () => {
  const game = planted();
  game.advance(29);
  startDefuse(game);
  game.advance(6);
  assert.equal(game.snapshot.coreState, 'detonated');
  assert.equal(game.snapshot.result.winner, 'attackers');
  assert.equal(game.snapshot.interaction, null);
  const earlier = planted(); earlier.advance(28.99); startDefuse(earlier); earlier.advance(6);
  assert.equal(earlier.snapshot.coreState, 'defused');
});

test('large delta processes phase boundaries chronologically, including plant then countdown', () => {
  const game = new LocalObjectiveAuthority();
  game.advance(25);
  assert.equal(game.snapshot.phase, 'combat');
  assert.equal(game.snapshot.remaining, 95);
  startPlant(game);
  game.advance(40);
  assert.equal(game.snapshot.result.winner, 'attackers');
  assert.equal(game.snapshot.coreState, 'detonated');
  const timeout = new LocalObjectiveAuthority(); timeout.advance(99999);
  assert.equal(timeout.snapshot.result.winner, 'defenders');
  assert.equal(timeout.snapshot.scores.defenders, 1);
  for (const dt of [NaN, Infinity, -1, 0]) timeout.advance(dt);
  assert.equal(timeout.snapshot.scores.defenders, 1);
});

test('combat elimination ends once, and late damage/countdowns cannot resolve twice', () => {
  const game = combat();
  assert.equal(game.applyDamage(defender, 100, 'last-defender').ok, true);
  const result = game.snapshot.result;
  assert.equal(result.winner, 'attackers');
  assert.equal(game.applyDamage(attacker, 100, 'late').ok, false);
  assert.equal(game.applyDamage(defender, 100, 'last-defender').ok, true);
  game.advance(200);
  assert.deepEqual(game.snapshot.result, result);
  assert.deepEqual(game.snapshot.scores, { attackers: 1, defenders: 0 });
  const attackersLose = combat(); attackersLose.applyDamage(attacker, 1000, 'last-attacker');
  assert.equal(attackersLose.snapshot.result.winner, 'defenders');
});

test('after planting attackers may all die but the core still requires defuse or countdown', () => {
  const game = planted();
  game.applyDamage(attacker, 100, 'attacker-after-plant');
  assert.equal(game.snapshot.phase, 'planted');
  assert.equal(game.snapshot.result, null);
  startDefuse(game); game.advance(6);
  assert.equal(game.snapshot.result.winner, 'defenders');
  const expiry = planted(); expiry.applyDamage(attacker, 100, 'attacker-dead'); expiry.advance(35);
  assert.equal(expiry.snapshot.result.winner, 'attackers');
  const noDefenders = planted(); noDefenders.applyDamage(defender, 100, 'defender-dead');
  assert.equal(noDefenders.snapshot.result.winner, 'attackers');
});

test('carrier death drops core; surviving attacker recovers then equips before planting', () => {
  const game = combat({ format: '2v1' });
  startPlant(game); game.advance(2);
  game.applyDamage(attacker, 100, 'carrier-killed');
  assert.equal(game.snapshot.phase, 'combat');
  assert.equal(game.snapshot.interaction, null);
  assert.equal(game.snapshot.coreState, 'dropped');
  assert.equal(game.snapshot.carrierId, null);
  assert.equal(intent(game, 'interact-start', 'attacker-2').ok, false);
  game.updatePosition('attacker-2', { ...game.snapshot.corePosition, y: .85 });
  assert.equal(intent(game, 'interact-start', defender).ok, false);
  assert.equal(intent(game, 'interact-start', 'attacker-2').ok, true);
  assert.equal(game.snapshot.carrierId, 'attacker-2');
  assert.equal(game.snapshot.coreState, 'carried');
  assert.equal(game.snapshot.interaction, null);
  assert.equal(intent(game, 'interact-start', 'attacker-2').ok, false);
  assert.equal(game.equipCore('attacker-2', true), true);
  intent(game, 'interact-start', 'attacker-2'); game.advance(4);
  assert.equal(game.snapshot.phase, 'planted');
});

test('disconnects cancel interactions, preserve planted threat and end empty-team buy phases', () => {
  const game = combat({ format: '2v1' });
  startPlant(game); game.advance(1);
  assert.equal(game.disconnect(attacker, 'carrier-left').ok, true);
  assert.equal(game.snapshot.interaction, null);
  assert.equal(game.snapshot.coreState, 'dropped');
  assert.equal(game.snapshot.phase, 'combat');
  assert.equal(game.disconnect('attacker-2', 'second-left').ok, true);
  assert.equal(game.snapshot.result.winner, 'defenders');
  const afterPlant = planted(); afterPlant.disconnect(attacker, 'left-after-plant');
  assert.equal(afterPlant.snapshot.phase, 'planted');
  startDefuse(afterPlant); afterPlant.disconnect(defender, 'defuser-left');
  assert.equal(afterPlant.snapshot.result.winner, 'attackers');
  const buy = new LocalObjectiveAuthority(); buy.disconnect(defender, 'left-buy');
  assert.equal(buy.snapshot.phase, 'result');
  assert.equal(buy.snapshot.result.winner, 'attackers');
});

test('only host advances rounds; transitions disable objectives and preserve score and disconnects', () => {
  const game = combat();
  assert.equal(intent(game, 'next-round', attacker, true).ok, false);
  game.disconnect(defender, 'leave');
  assert.equal(intent(game, 'next-round').ok, false);
  assert.equal(intent(game, 'next-round', attacker, true).ok, true);
  assert.equal(game.snapshot.round, 2);
  assert.equal(game.snapshot.epoch, 2);
  assert.equal(game.snapshot.phase, 'transition');
  assert.equal(game.snapshot.result, null);
  assert.equal(intent(game, 'interact-start').ok, false);
  assert.equal(intent(game, 'interact-stop').ok, false);
  assert.equal(game.equipCore(attacker, true), false);
  assert.equal(game.applyDamage(attacker, 100, 'transition-damage').ok, false);
  game.advance(1);
  assert.equal(game.snapshot.phase, 'result'); // A missing team never leaves a stuck buy/combat round.
  assert.equal(game.snapshot.players.find(player => player.id === defender).connected, false);
  assert.equal(game.snapshot.scores.attackers, 2);
});

test('next round resets health/device and rematch resets scores and reconnects all participants', () => {
  const game = combat({ format: '2v1', activeSite: 'B' });
  game.applyDamage(attacker, 30, 'wounded'); game.applyDamage(defender, 100, 'winner');
  intent(game, 'next-round', attacker, true);
  game.advance(1);
  assert.equal(game.snapshot.phase, 'buy');
  assert.equal(game.snapshot.remaining, 20);
  assert.equal(health(game), 100);
  assert.equal(game.snapshot.carrierId, attacker);
  assert.equal(game.snapshot.coreState, 'carried');
  assert.deepEqual(game.snapshot.config, { format: '2v1', activeSite: 'B' });
  game.disconnect('attacker-2', 'second-disconnect');
  assert.equal(intent(game, 'rematch', attacker, false).ok, false);
  assert.equal(intent(game, 'rematch', attacker, true).ok, true);
  assert.equal(game.snapshot.phase, 'transition');
  assert.equal(game.snapshot.round, 1);
  assert.equal(game.snapshot.epoch, 3);
  assert.deepEqual(game.snapshot.scores, { attackers: 0, defenders: 0 });
  assert.equal(game.snapshot.players.every(player => player.connected && player.alive && player.health === 100), true);
  game.advance(30);
  assert.equal(game.snapshot.phase, 'combat');
  assert.equal(game.snapshot.remaining, 91);
});

test('duplicate intents do not restart progress; reused IDs and stale rounds/generations are rejected', () => {
  const game = combat();
  game.updatePosition(attacker, atSite()); game.equipCore(attacker, true);
  const command = { id: 'replayed-hold', round: 1, epoch: 1, type: 'interact-start' };
  const response = game.dispatch(command, attacker);
  game.advance(2);
  assert.deepEqual(game.dispatch(command, attacker), response);
  assert.equal(game.snapshot.interaction.progress, .5);
  assert.equal(game.dispatch(command, defender).ok, false);
  assert.equal(game.dispatch({ ...command, type: 'interact-stop' }, attacker).ok, false);
  intent(game, 'rematch', attacker, true);
  assert.equal(game.dispatch(command, attacker).ok, false);
  assert.equal(game.dispatch({ ...command, id: 'old-unobserved-message' }, attacker).ok, false);
  assert.equal(game.dispatch({ ...command, id: 'missing-epoch', epoch: undefined }, attacker).ok, false);
  game.advance(121); // transition + buy + combat expiry
  intent(game, 'next-round', attacker, true);
  assert.equal(game.dispatch({ ...command, epoch: game.snapshot.epoch }, attacker).ok, false);
});

test('duplicate damage and disconnect events are idempotent and conflicting IDs fail', () => {
  const game = combat({ format: '2v1' });
  assert.equal(game.applyDamage(attacker, 25, 'hit-1').ok, true);
  assert.equal(game.applyDamage(attacker, 25, 'hit-1').ok, true);
  assert.equal(health(game), 75);
  assert.equal(game.applyDamage(attacker, 10, 'hit-1').ok, false);
  assert.equal(game.applyDamage(defender, 25, 'hit-1').ok, false);
  assert.equal(game.disconnect(attacker, 'disconnect-1').ok, true);
  assert.equal(game.disconnect(attacker, 'disconnect-1').ok, true);
  assert.equal(game.disconnect(defender, 'disconnect-1').ok, false);
  assert.equal(game.snapshot.phase, 'combat');
});

test('replayed next-round/rematch packets cannot restart a transition or reset scores again', () => {
  const game = combat();
  game.advance(100);
  const next = { id: 'next-once', round: 1, epoch: 1, type: 'next-round' };
  assert.equal(game.dispatch(next, attacker, true).ok, true);
  game.advance(.5);
  assert.equal(game.dispatch(next, attacker, true).ok, false);
  assert.equal(game.snapshot.round, 2);
  assert.equal(game.snapshot.remaining, .5);
  game.advance(.5);
  const rematch = { id: 'rematch-once', round: 2, epoch: 2, type: 'rematch' };
  assert.equal(game.dispatch(rematch, attacker, true).ok, true);
  game.advance(.5);
  assert.equal(game.dispatch(rematch, attacker, true).ok, false);
  assert.equal(game.snapshot.epoch, 3);
  assert.equal(game.snapshot.remaining, .5);
  assert.deepEqual(game.snapshot.scores, { attackers: 0, defenders: 0 });
});

test('both teams absent at transition completion resolves deterministically for defenders', () => {
  const game = combat();
  game.advance(100);
  intent(game, 'next-round', attacker, true);
  game.disconnect(attacker, 'all-left-a');
  game.disconnect(defender, 'all-left-d');
  assert.equal(game.snapshot.phase, 'transition');
  game.advance(1);
  assert.equal(game.snapshot.result.winner, 'defenders');
  assert.equal(game.snapshot.scores.defenders, 2);
});

test('invalid payloads cannot set time, completion, team, credits or damage', () => {
  const game = combat();
  const initial = game.snapshot;
  for (const command of [null, {}, { id: '', round: 1, epoch: 1, type: 'interact-start' },
    { id: 'forged-complete', round: 1, epoch: 1, type: 'plant-complete', progress: 1, time: 0 },
    { id: 'forged-round', round: 1.5, epoch: 1, type: 'interact-start' },
    { id: 'forged-clock', round: 1, epoch: 1, type: 'advance', dt: 100 }]) {
    assert.equal(game.dispatch(command, attacker, false).ok, false);
  }
  assert.equal(intent(game, 'interact-start', 'not-a-player').ok, false);
  for (const amount of [NaN, Infinity, -10, 0]) assert.equal(game.applyDamage(attacker, amount, 'bad').ok, false);
  game.updatePosition(attacker, { x: Infinity, y: 0, z: 0 });
  for (const dt of [NaN, Infinity, -5, 0]) game.advance(dt);
  assert.equal(game.snapshot.remaining, initial.remaining);
  assert.equal(health(game), 100);
  assert.deepEqual(game.snapshot.players[0].position, initial.players[0].position);
});

test('bounded intent ledger refuses overflow rather than evicting replay protection', () => {
  const game = combat();
  const original = { id: 'first-id', round: 1, epoch: 1, type: 'interact-stop' };
  assert.equal(game.dispatch(original, attacker).ok, true);
  for (let i = 1; i < 512; i++) assert.equal(game.dispatch({ ...original, id: `ledger-${i}` }, attacker).ok, true);
  assert.equal(game.dispatch({ ...original, id: 'overflow' }, attacker).ok, false);
  assert.equal(game.dispatch(original, attacker).ok, true);
  assert.equal(game.dispatch({ ...original, type: 'rematch' }, attacker, true).ok, false);
});

test('small fixed ticks and a single authority step produce the same objective outcome', () => {
  const fixed = combat(); const batched = combat();
  startPlant(fixed); startPlant(batched);
  for (let i = 0; i < 2437; i++) fixed.advance(.016);
  batched.advance(2437 * .016);
  assert.equal(fixed.snapshot.phase, batched.snapshot.phase);
  assert.equal(fixed.snapshot.coreState, batched.snapshot.coreState);
  assert.equal(fixed.snapshot.result, null);
  assert.ok(Math.abs(fixed.snapshot.remaining - batched.snapshot.remaining) < 1e-7);
  fixed.advance(1); batched.advance(1);
  assert.deepEqual(fixed.snapshot.result, batched.snapshot.result);
});
