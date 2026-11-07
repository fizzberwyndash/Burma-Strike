import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulation } from '../src/MatchSimulation';
import type { OnlineInput } from '../../src/network/protocol';

const roster = [
  { id: 'attacker', name: 'Attacker', team: 'attackers' as const },
  { id: 'defender', name: 'Defender', team: 'defenders' as const },
];
function advance(simulation: MatchSimulation, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) simulation.step(1 / 60);
}
function create() {
  const simulation = new MatchSimulation(roster, { mapId: 'bagan-old-city', rounds: 3, activeSite: 'both' });
  advance(simulation, .5);
  return simulation;
}
function input(simulation: MatchSimulation, id: string, changes: Partial<OnlineInput> = {}) {
  const player = simulation.players.get(id)!;
  const command = { ...player.input, seq: player.input.seq + 1, ...changes };
  assert.equal(simulation.input(id, command), true);
  simulation.step(1 / 60);
}
function pistol(simulation: MatchSimulation, id: string) {
  assert.equal(simulation.action(id, { type: 'buy', itemId: 'pistol' }).ok, true);
  advance(simulation, .6);
  assert.equal(simulation.getInventory(id).activeId, 'pistol');
}
function combat(simulation: MatchSimulation) {
  simulation.session.advance(20);
  assert.equal(simulation.snapshot.phase, 'combat');
  simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
  simulation.setPosition('defender', { x: 3, y: .86, z: 20 });
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} != ${expected}`);

test('server hitscan consumes armor, confirms kills and pays the elimination and round once', () => {
  const simulation = create();
  try {
    pistol(simulation, 'attacker');
    assert.equal(simulation.action('defender', { type: 'buy', itemId: 'light-armor' }).ok, true);
    combat(simulation);
    input(simulation, 'attacker', { yaw: 0, pitch: Math.atan(.6 / 3), fire: true });
    const bodyShot = simulation.drainShots();
    assert.equal(bodyShot.length, 1);
    assert.equal(bodyShot[0].victimId, 'defender');
    assert.equal(bodyShot[0].headshot, false);
    assert.equal(bodyShot[0].killed, false);
    near(simulation.getEconomy('defender').snapshot.health, 86.4);
    near(simulation.getEconomy('defender').snapshot.armor, 4.6);
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, 11);

    advance(simulation, .21);
    input(simulation, 'attacker', { fire: false });
    input(simulation, 'attacker', { pitch: 0, fire: true });
    const headShot = simulation.drainShots()[0];
    assert.equal(headShot.headshot, true);
    assert.equal(headShot.killed, true);
    assert.equal(simulation.snapshot.result?.winner, 'attackers');
    assert.equal(simulation.players.get('attacker')!.kills, 1);
    assert.equal(simulation.players.get('defender')!.deaths, 1);
    assert.equal(simulation.getEconomy('attacker').snapshot.credits, 3650);
    const credits = simulation.getEconomy('attacker').snapshot.credits;
    advance(simulation, 1);
    assert.equal(simulation.getEconomy('attacker').snapshot.credits, credits);
    assert.equal(simulation.drainShots().length, 0);
  } finally { simulation.dispose(); }
});

test('real wagon triangles stop shots before a player and knife hits obey their range', () => {
  const simulation = create();
  try {
    pistol(simulation, 'attacker');
    combat(simulation);
    simulation.setPosition('attacker', { x: 0, y: .86, z: 10 });
    simulation.setPosition('defender', { x: 0, y: .86, z: 19 });
    input(simulation, 'attacker', { yaw: 0, pitch: 0, fire: true });
    const blocked = simulation.drainShots()[0];
    assert.equal(blocked.victimId, null);
    assert.equal(blocked.surface, 'hard');
    near(blocked.to.z, 15.2);
    assert.equal(simulation.getEconomy('defender').snapshot.health, 100);

    assert.equal(simulation.action('attacker', { type: 'equip', slot: 3 }).ok, true);
    advance(simulation, .6);
    simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
    simulation.setPosition('defender', { x: 3, y: .86, z: 20 });
    input(simulation, 'attacker', { fire: false });
    input(simulation, 'attacker', { fire: true, pitch: .2 });
    const tooFar = simulation.drainShots()[0];
    assert.equal(tooFar.weaponId, 'knife');
    assert.equal(tooFar.victimId, null);
    assert.equal(simulation.getEconomy('defender').snapshot.health, 100);
    advance(simulation, .6);
    simulation.setPosition('defender', { x: 3, y: .86, z: 18.5 });
    input(simulation, 'attacker', { fire: false });
    input(simulation, 'attacker', { fire: true, pitch: .35 });
    assert.equal(simulation.drainShots()[0].victimId, 'defender');
    assert.equal(simulation.getEconomy('defender').snapshot.health, 50);
  } finally { simulation.dispose(); }
});

test('semi-auto holds, rapid edges, reload and switching obey server ammunition and timing', () => {
  const simulation = create();
  try {
    pistol(simulation, 'attacker');
    combat(simulation);
    input(simulation, 'attacker', { yaw: Math.PI / 2, fire: true });
    advance(simulation, .8);
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, 11, 'holding a semi-auto trigger fires once');
    simulation.drainShots();
    for (let i = 0; i < 10; i++) {
      input(simulation, 'attacker', { fire: false });
      input(simulation, 'attacker', { fire: true });
    }
    const rapidShots = simulation.drainShots().length;
    assert.ok(rapidShots >= 1 && rapidShots <= 2, `fire interval limits rapid edges, received ${rapidShots}`);
    const before = { ...simulation.getInventory('attacker').ammunition };
    assert.equal(simulation.action('attacker', { type: 'reload' }).ok, true);
    input(simulation, 'attacker', { fire: false });
    input(simulation, 'attacker', { fire: true });
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 3 }).ok, false);
    advance(simulation, 1.4);
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, before.magazine);
    assert.equal(simulation.drainShots().length, 0);
    advance(simulation, .25);
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, 12);
    assert.equal(simulation.getInventory('attacker').ammunition.reserve, before.reserve - (12 - before.magazine));
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 1 }).ok, false, 'an unowned primary cannot equip');
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 3 }).ok, true);
    input(simulation, 'attacker', { fire: false });
    input(simulation, 'attacker', { fire: true });
    assert.equal(simulation.drainShots().length, 0, 'holster/draw blocks fire');
    advance(simulation, .5);
    assert.equal(simulation.getInventory('attacker').activeId, 'knife');
  } finally { simulation.dispose(); }
});

test('reconnection acknowledges the latest received input without reviving a lost life', () => {
  const simulation = create();
  try {
    assert.equal(simulation.input('attacker', { seq: 500, moveX: 1, moveY: 0, yaw: 0, pitch: 0, sprint: false, ads: false, fire: false, jump: false }), true);
    simulation.disconnect('attacker');
    simulation.reconnect('attacker');
    const state = simulation.playerSnapshot('attacker', false, true);
    assert.equal(state.lastInput, 500);
    assert.equal(state.alive, false);
    assert.equal(simulation.input('attacker', { ...simulation.players.get('attacker')!.input, seq: 501 }), true);
    assert.equal(simulation.input('attacker', { ...simulation.players.get('attacker')!.input, seq: 1 }), false);
  } finally { simulation.dispose(); }
});

test('a malicious peer cannot exhaust shared objective receipts or block another player defusing', () => {
  const simulation = new MatchSimulation([...roster,
    { id: 'abuser', name: 'OtherAttacker', team: 'attackers' },
  ], { mapId: 'bagan-old-city', rounds: 3, activeSite: 'A' });
  try {
    advance(simulation, .5);
    combat(simulation);
    simulation.setPosition('attacker', { x: -19, y: .86, z: 4.5 });
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 4 }).ok, true);
    const intent = (held: boolean) => ({ type: 'interact' as const, held, round: simulation.snapshot.round, epoch: simulation.snapshot.epoch });
    const hold = (id: string, seconds: number) => {
      for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
        if (frame % 10 === 0) {
          const player = simulation.players.get(id)!;
          simulation.input(id, { ...player.input, seq: player.input.seq + 1, moveX: 0, moveY: 0 });
        }
        simulation.step(1 / 60);
      }
    };
    assert.equal(simulation.action('attacker', intent(true)).ok, true);
    hold('attacker', 4.1);
    assert.equal(simulation.snapshot.phase, 'planted');
    for (let i = 0; i < 600; i++) assert.equal(simulation.action('abuser', intent(true)).ok, false);
    assert.equal(simulation.action('abuser', intent(true)).message, 'Device interaction limit reached for this round.');
    assert.equal(simulation.action('abuser', intent(false)).ok, true, 'release remains available at the budget');
    simulation.setPosition('defender', { x: -19, y: .86, z: 3.5 });
    assert.equal(simulation.action('defender', intent(true)).ok, true);
    assert.equal(simulation.action('defender', { ...intent(false), epoch: simulation.snapshot.epoch - 1 }).ok, false);
    assert.equal(simulation.snapshot.interaction?.playerId, 'defender', 'a stale release cannot cancel the new generation');
    hold('defender', 6.1);
    assert.equal(simulation.snapshot.result?.winner, 'defenders');
    assert.equal(simulation.snapshot.coreState, 'defused');
    advance(simulation, 7.2);
    assert.equal(simulation.snapshot.round, 2);
    assert.notEqual(simulation.action('abuser', intent(true)).message, 'Device interaction limit reached for this round.');
  } finally { simulation.dispose(); }
});
