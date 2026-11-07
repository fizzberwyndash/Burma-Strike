import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/game/spectator.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { SpectatorController, fallbackSpectatorPose } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`,
);
const player = (id, team = 'attackers', changes = {}) => ({ id, name:id, team, alive:true, connected:true, ...changes });
const self = changes => player('self', 'attackers', {alive:false,...changes});
const state = (players, changes = {}) => ({
  matchId:'match-one', stage:'match', objective:{epoch:1,round:1,phase:'combat'}, players, ...changes,
});

test('a dead player can watch living teammates, never opponents or disconnected/dead allies', () => {
  const view = new SpectatorController();
  const snapshot = state([self(), player('enemy','defenders'), player('dead','attackers',{alive:false}),
    player('offline','attackers',{connected:false}),player('ally')]);
  view.receive(snapshot,'self');
  assert.equal(view.active,true);
  assert.equal(view.targetId,'ally');
  assert.equal(view.targetName,'ally');
  assert.equal(view.fallbackTeam,'attackers');
  assert.equal(view.canCycle,false);
  view.cycle(1);
  assert.equal(view.targetId,'ally');
  assert.equal(snapshot.players[0].alive,false, 'Selection never revives the controlled player.');
});

test('selection is stable across snapshots and wraps only through eligible teammates', () => {
  const view = new SpectatorController();
  view.receive(state([self(),player('charlie'),player('alpha'),player('enemy','defenders'),player('bravo')]),'self');
  assert.equal(view.targetId,'alpha');
  assert.equal(view.canCycle,true);
  view.cycle(-1); assert.equal(view.targetId,'charlie');
  view.cycle(1); assert.equal(view.targetId,'alpha');
  view.cycle(1); assert.equal(view.targetId,'bravo');
  view.receive(state([player('bravo','attackers',{name:'Bravo renamed'}),self(),player('alpha'),player('charlie')]),'self');
  assert.equal(view.targetId,'bravo');
  assert.equal(view.targetName,'Bravo renamed');
  for (const direction of [0,NaN,Infinity,-Infinity]) view.cycle(direction);
  assert.equal(view.targetId,'bravo');
});

test('death, disconnection or removal of a watched ally selects another living teammate', () => {
  const view = new SpectatorController();
  const receive = allies => view.receive(state([self(),...allies,player('enemy','defenders')]),'self');
  receive([player('alpha'),player('bravo'),player('charlie')]);
  receive([player('alpha','attackers',{alive:false}),player('bravo'),player('charlie')]);
  assert.equal(view.targetId,'bravo');
  receive([player('bravo','attackers',{connected:false}),player('charlie')]);
  assert.equal(view.targetId,'charlie');
  receive([]);
  assert.equal(view.active,true);
  assert.equal(view.targetId,null);
  assert.equal(view.targetName,'');
  assert.equal(view.canCycle,false);
  assert.equal(view.fallbackTeam,'attackers');
});

test('a planted core remains observable from a fixed fallback after all attackers die', () => {
  const view = new SpectatorController();
  view.receive(state([self(),player('ally','attackers',{alive:false}),player('defender','defenders')], {
    objective:{epoch:1,round:1,phase:'planted'},
  }),'self');
  assert.equal(view.active,true);
  assert.equal(view.targetId,null);
  assert.equal(view.fallbackTeam,'attackers');
  view.cycle(1);
  assert.equal(view.targetId,null);
});

test('a reconnect does not revive a dead player while own round-start respawn exits spectator mode', () => {
  const view = new SpectatorController();
  view.receive(state([self(),player('ally')]),'self');
  view.receive(state([self({connected:false}),player('ally')]),'self');
  assert.equal(view.active,false);
  view.receive(state([self(),player('ally')]),'self');
  assert.equal(view.active,true);
  assert.equal(view.targetId,'ally');
  view.receive(state([self({alive:true}),player('ally')],{objective:{epoch:2,round:2,phase:'buy'}}),'self');
  assert.equal(view.active,false);
  assert.equal(view.targetId,null);
  assert.equal(view.fallbackTeam,null);
});

test('new rounds, epochs and rematches reset a stale camera preference', () => {
  const view = new SpectatorController();
  const players = [self(),player('alpha'),player('bravo')];
  const selectBravo = () => { view.cycle(1); assert.equal(view.targetId,'bravo'); };
  view.receive(state(players),'self'); selectBravo();
  view.receive(state(players,{objective:{epoch:2,round:2,phase:'combat'}}),'self');
  assert.equal(view.targetId,'alpha'); selectBravo();
  view.receive(state(players,{objective:{epoch:3,round:2,phase:'combat'}}),'self');
  assert.equal(view.targetId,'alpha'); selectBravo();
  view.receive(state(players,{matchId:'match-two'}),'self');
  assert.equal(view.targetId,'alpha');
});

test('lobby, missing identity, reset and living self remove all spectator state', () => {
  const view = new SpectatorController();
  const snapshot = state([self(),player('ally')]);
  for (const next of [state([player('ally')]),state([self(),player('ally')],{stage:'lobby'}),state([self({alive:true}),player('ally')])]) {
    view.receive(snapshot,'self');
    assert.equal(view.active,true);
    view.receive(next,'self');
    assert.equal(view.active,false);
    assert.equal(view.targetId,null);
    assert.equal(view.canCycle,false);
  }
  view.receive(snapshot,'self'); view.reset(); view.reset();
  assert.equal(view.active,false);
  assert.equal(view.targetName,'');
  assert.equal(view.fallbackTeam,null);
});

test('fixed fallback poses stay on the controlled team side and are independently mutable', () => {
  const attackers = fallbackSpectatorPose('attackers');
  const defenders = fallbackSpectatorPose('defenders');
  assert.deepEqual(attackers,{position:{x:0,y:3,z:-14},yaw:0,pitch:.08});
  assert.deepEqual(defenders,{position:{x:0,y:3,z:22},yaw:Math.PI,pitch:.08});
  attackers.position.z = 100;
  assert.equal(fallbackSpectatorPose('attackers').position.z,-14);
  assert.equal(fallbackSpectatorPose(null).position.z,-14);
});
