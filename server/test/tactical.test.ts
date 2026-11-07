import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulation } from '../src/MatchSimulation';
import type { MatchConfiguration, OnlineInput } from '../../src/network/protocol';
import type { ObjectiveRosterPlayer } from '../../src/game/objective';

const roster: ObjectiveRosterPlayer[] = [
  { id: 'attacker', name: 'Carrier', team: 'attackers' },
  { id: 'ally', name: 'Attacker Two', team: 'attackers' },
  { id: 'defender', name: 'Defender', team: 'defenders' },
  { id: 'defender-two', name: 'Defender Two', team: 'defenders' },
];
const site = { x: -19, y: .86, z: 4.5 };
function create(options: Partial<MatchConfiguration> = {}, players = roster) {
  const simulation = new MatchSimulation(players, { mapId: 'bagan-old-city', rounds: 3, activeSite: 'A', ...options });
  advance(simulation, .5);
  return simulation;
}
function advance(simulation: MatchSimulation, seconds: number) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) simulation.step(1 / 60);
}
function send(simulation: MatchSimulation, id: string, changes: Partial<OnlineInput> = {}) {
  const player = simulation.players.get(id)!;
  return simulation.input(id, { ...player.input, seq: player.input.seq + 1, ...changes });
}
function hold(simulation: MatchSimulation, id: string, seconds: number) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    if (frame % 6 === 0) send(simulation, id, { moveX: 0, moveY: 0, fire: false, jump: false });
    simulation.step(1 / 60);
  }
}
function intent(simulation: MatchSimulation, id: string, held: boolean) {
  const { round, epoch } = simulation.snapshot;
  return simulation.action(id, { type: 'interact', held, round, epoch });
}
function combat(simulation: MatchSimulation) {
  simulation.session.advance(20);
  assert.equal(simulation.snapshot.phase, 'combat');
}
function pistol(simulation: MatchSimulation, id: string) {
  assert.equal(simulation.action(id, { type: 'buy', itemId: 'pistol' }).ok, true);
  advance(simulation, .6);
  assert.equal(simulation.getInventory(id).activeId, 'pistol');
}
function plant(simulation: MatchSimulation) {
  simulation.setPosition('attacker', site);
  send(simulation, 'attacker', { moveX: 0, moveY: 0, fire: false });
  assert.equal(simulation.action('attacker', { type: 'equip', slot: 4 }).ok, true);
  assert.equal(intent(simulation, 'attacker', true).ok, true);
  hold(simulation, 'attacker', 4.1);
  assert.equal(simulation.snapshot.phase, 'planted');
}
function actor(simulation: MatchSimulation, id: string) {
  return simulation.snapshot.players.find(player => player.id === id)!;
}
function winner(simulation: MatchSimulation) {
  return simulation.snapshot.result?.winner;
}

test('dead players cannot move, fire, buy, reload, equip or interact while teammates keep combat live', () => {
  const simulation = create();
  try {
    pistol(simulation, 'attacker');
    combat(simulation);
    simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
    assert.equal(simulation.session.damage('attacker', 1000, 'dead-controls', 'defender'), true);
    assert.equal(simulation.snapshot.phase, 'combat');
    const position = { ...simulation.players.get('attacker')!.position };
    const ammo = { ...simulation.getInventory('attacker').ammunition };
    const credits = simulation.getEconomy('attacker').snapshot.credits;
    for (const action of [
      { type: 'buy' as const, itemId: 'light-armor' },
      { type: 'reload' as const },
      { type: 'equip' as const, slot: 4 as const },
      { type: 'equip' as const, slot: 3 as const },
      { type: 'inspect' as const },
    ]) assert.equal(simulation.action('attacker', action).ok, false);
    assert.equal(intent(simulation, 'attacker', true).ok, false);
    for (let frame = 0; frame < 90; frame++) {
      send(simulation, 'attacker', { moveY: 1, sprint: true, fire: true, jump: true });
      simulation.step(1 / 60);
    }
    assert.deepEqual(simulation.players.get('attacker')!.position, position);
    assert.deepEqual(simulation.getInventory('attacker').ammunition, ammo);
    assert.equal(simulation.getEconomy('attacker').snapshot.credits, credits);
    assert.equal(simulation.drainShots().length, 0);
    assert.equal(actor(simulation, 'attacker').alive, false);
  } finally { simulation.dispose(); }
});

test('reconnecting a dead player restores presence but respawn and resupply happen only at the next round', () => {
  const simulation = create();
  try {
    pistol(simulation, 'attacker');
    combat(simulation);
    simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
    simulation.disconnect('attacker');
    simulation.reconnect('attacker');
    advance(simulation, .5);
    assert.equal(actor(simulation, 'attacker').connected, true);
    assert.equal(actor(simulation, 'attacker').alive, false);
    assert.equal(simulation.playerSnapshot('attacker', false, true).health, 0);
    assert.equal(simulation.snapshot.phase, 'combat');
    simulation.session.damage('ally', 1000, 'last-attacker-eliminated', 'defender');
    assert.equal(winner(simulation), 'defenders');
    advance(simulation, 6.1);
    assert.equal(simulation.snapshot.phase, 'transition');
    assert.equal(actor(simulation, 'attacker').alive, false, 'the transition cannot revive a player');
    assert.equal(simulation.playerSnapshot('attacker', false, true).alive, false);
    assert.equal(simulation.playerSnapshot('attacker', false, true).health, 0);
    advance(simulation, 1.2);
    assert.equal(simulation.snapshot.round, 2);
    assert.equal(simulation.snapshot.phase, 'buy');
    assert.equal(actor(simulation, 'attacker').alive, true);
    assert.equal(simulation.playerSnapshot('attacker', false, true).health, 100);
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, 12);
    assert.equal(simulation.getInventory('attacker').ammunition.reserve, 48);
    assert.equal(simulation.players.get('attacker')!.position.z, -12);
  } finally { simulation.dispose(); }
});

test('only the designated living Attacker can plant and only a Defender can defuse', () => {
  const simulation = create();
  try {
    combat(simulation);
    for (const [id, offset] of [['attacker', 0], ['ally', -1], ['defender', 1]] as const) {
      simulation.setPosition(id, { ...site, z: site.z + offset });
    }
    assert.equal(simulation.action('defender', { type: 'equip', slot: 4 }).ok, false);
    assert.equal(simulation.action('ally', { type: 'equip', slot: 4 }).ok, false);
    assert.equal(intent(simulation, 'defender', true).ok, false);
    assert.equal(intent(simulation, 'ally', true).ok, false);
    plant(simulation);
    assert.equal(intent(simulation, 'attacker', true).ok, false);
    assert.equal(intent(simulation, 'ally', true).ok, false);
    assert.equal(intent(simulation, 'defender', true).ok, true);
    hold(simulation, 'defender', 6.1);
    assert.equal(simulation.snapshot.coreState, 'defused');
    assert.equal(winner(simulation), 'defenders');
  } finally { simulation.dispose(); }
});

test('release, authoritative damage and actual movement cancel an unfinished plant rather than banking progress', () => {
  const simulation = create();
  try {
    combat(simulation);
    simulation.setPosition('attacker', site);
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 4 }).ok, true);
    assert.equal(intent(simulation, 'attacker', true).ok, true);
    hold(simulation, 'attacker', 1);
    assert.ok(simulation.snapshot.interaction!.progress > .2);
    assert.equal(intent(simulation, 'attacker', false).ok, true);
    assert.equal(simulation.snapshot.interaction, null);
    assert.equal(intent(simulation, 'attacker', true).ok, true);
    assert.equal(simulation.snapshot.interaction!.progress, 0);
    hold(simulation, 'attacker', .5);
    assert.equal(simulation.session.damage('attacker', 10, 'plant-damage', 'defender'), true);
    assert.equal(simulation.snapshot.interaction, null);
    assert.equal(intent(simulation, 'attacker', true).ok, true);
    send(simulation, 'attacker', { moveY: 1 });
    advance(simulation, .25);
    assert.equal(simulation.snapshot.interaction, null);
    assert.equal(simulation.snapshot.coreState, 'carried');
    assert.equal(simulation.snapshot.phase, 'combat');
  } finally { simulation.dispose(); }
});

for (const finish of ['defuse', 'countdown'] as const) test(`a planted core survives all Attacker eliminations until ${finish}`, () => {
  const players = [roster[0], roster[2]];
  const simulation = create({}, players);
  try {
    combat(simulation);
    plant(simulation);
    assert.equal(simulation.session.damage('attacker', 1000, `postplant-${finish}`, 'defender'), true);
    assert.equal(simulation.snapshot.phase, 'planted');
    assert.equal(simulation.snapshot.result, null);
    if (finish === 'defuse') {
      simulation.setPosition('defender', { ...site, z: site.z - 1 });
      assert.equal(intent(simulation, 'defender', true).ok, true);
      hold(simulation, 'defender', 6.1);
      assert.equal(simulation.snapshot.coreState, 'defused');
      assert.equal(winner(simulation), 'defenders');
    } else {
      advance(simulation, 35.1);
      assert.equal(simulation.snapshot.coreState, 'detonated');
      assert.equal(winner(simulation), 'attackers');
    }
  } finally { simulation.dispose(); }
});

for (const friendlyFire of [false, true]) test(`friendly fire ${friendlyFire ? 'enabled' : 'disabled'} uses server rules and never rewards a team kill`, () => {
  const simulation = create({ friendlyFire });
  try {
    pistol(simulation, 'attacker');
    combat(simulation);
    simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
    simulation.setPosition('ally', { x: 3, y: .86, z: 20 });
    simulation.setPosition('defender', { x: 3, y: .86, z: 23 });
    const credits = simulation.getEconomy('attacker').snapshot.credits;
    send(simulation, 'attacker', { yaw: 0, pitch: 0, fire: true });
    simulation.step(1 / 60);
    const shot = simulation.drainShots()[0];
    assert.ok(shot);
    assert.equal(shot.victimId, friendlyFire ? 'ally' : null);
    assert.equal(actor(simulation, 'ally').health, friendlyFire ? 0 : 100);
    assert.equal(actor(simulation, 'ally').alive, !friendlyFire);
    assert.equal(actor(simulation, 'defender').health, 100, 'teammate geometry still blocks the bullet');
    assert.equal(simulation.getInventory('attacker').ammunition.magazine, 11);
    assert.equal(simulation.getEconomy('attacker').snapshot.credits, credits);
    assert.equal(simulation.players.get('attacker')!.kills, 0);
    assert.equal(simulation.players.get('ally')!.deaths, friendlyFire ? 1 : 0);
  } finally { simulation.dispose(); }
});

test('round history records results exactly once, survives new rounds and returns isolated nested copies', () => {
  const simulation = create();
  try {
    combat(simulation);
    simulation.session.advance(100);
    simulation.step(1 / 60);
    const original = simulation.roundHistory;
    assert.equal(original.length, 1);
    assert.equal(original[0].round, 1);
    assert.equal(original[0].winner, 'defenders');
    assert.equal(original[0].reason, simulation.snapshot.result!.reason);
    assert.equal(original[0].plantedSite, null);
    assert.deepEqual(original[0].scores, { attackers: 0, defenders: 1 });
    assert.ok(Number.isFinite(original[0].resolvedAt) && original[0].resolvedAt > 0);
    assert.ok(original[0].id);
    Reflect.set(original[0], 'reason', 'client changed this copy');
    Reflect.set(original[0].scores, 'defenders', 9999);
    assert.equal(simulation.roundHistory[0].reason, simulation.snapshot.result!.reason);
    assert.equal(simulation.roundHistory[0].scores.defenders, 1);
    advance(simulation, 1);
    assert.equal(simulation.roundHistory.length, 1);
    advance(simulation, 6.2);
    assert.equal(simulation.snapshot.round, 2);
    assert.equal(simulation.roundHistory.length, 1);
    simulation.session.advance(120);
    simulation.step(1 / 60);
    assert.equal(simulation.roundHistory.length, 2);
    assert.equal(simulation.roundHistory[1].round, 2);
    assert.equal(simulation.roundHistory[1].scores.defenders, 2);
    assert.notEqual(simulation.roundHistory[1].id, simulation.roundHistory[0].id);
  } finally { simulation.dispose(); }
});

test('configured thirty-round matches retain one server history entry per round and stop without duplicate results', () => {
  const simulation = create({ rounds: 30 });
  try {
    for (let round = 1; round <= 30; round++) {
      simulation.session.advance(120);
      simulation.step(1 / 60);
      assert.equal(simulation.roundHistory.length, round);
      assert.equal(simulation.roundHistory.at(-1)!.round, round);
      if (round < 30) {
        advance(simulation, 7.2);
        assert.equal(simulation.snapshot.round, round + 1);
      }
    }
    advance(simulation, 10);
    assert.equal(simulation.finished, true);
    assert.equal(simulation.roundHistory.length, 30);
    assert.equal(new Set(simulation.roundHistory.map(record => record.id)).size, 30);
  } finally { simulation.dispose(); }
});

test('expired controls stop movement and cancel an objective hold without a client release packet', () => {
  const simulation = create();
  try {
    combat(simulation);
    simulation.setPosition('attacker', { x: 3, y: .86, z: 17 });
    send(simulation, 'attacker', { moveY: 1 });
    advance(simulation, .2);
    assert.ok(simulation.players.get('attacker')!.position.z > 17);
    advance(simulation, 1);
    const stopped = { ...simulation.players.get('attacker')!.position };
    advance(simulation, .5);
    assert.ok(Math.abs(simulation.players.get('attacker')!.position.x - stopped.x) < 1e-6);
    assert.ok(Math.abs(simulation.players.get('attacker')!.position.z - stopped.z) < 1e-6);
    assert.ok(stopped.z < 20, 'a lost input stream cannot sustain full-speed movement');
    simulation.setPosition('attacker', site);
    send(simulation, 'attacker', { moveX: 0, moveY: 0, fire: false });
    assert.equal(simulation.action('attacker', { type: 'equip', slot: 4 }).ok, true);
    assert.equal(intent(simulation, 'attacker', true).ok, true);
    advance(simulation, .35);
    assert.equal(simulation.snapshot.interaction, null);
    assert.equal(simulation.snapshot.coreState, 'carried');
  } finally { simulation.dispose(); }
});

test('a result-phase disconnect cannot reappear alive during the next transition', () => {
  const simulation = create();
  try {
    combat(simulation);
    simulation.session.advance(100);
    simulation.step(1 / 60);
    assert.equal(simulation.snapshot.phase, 'result');
    assert.equal(actor(simulation, 'attacker').alive, true);
    simulation.disconnect('attacker');
    simulation.reconnect('attacker');
    assert.equal(actor(simulation, 'attacker').alive, false);
    advance(simulation, 6.1);
    assert.equal(simulation.snapshot.phase, 'transition');
    assert.equal(actor(simulation, 'attacker').alive, false);
    assert.equal(simulation.playerSnapshot('attacker', false, true).health, 0);
    advance(simulation, 1.2);
    assert.equal(simulation.snapshot.phase, 'buy');
    assert.equal(actor(simulation, 'attacker').alive, true);
  } finally { simulation.dispose(); }
});
