import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Exercise the real presentation adapters without a GPU, DOM or network. The
// transport/room integration has separate tests using real Colyseus clients.
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'burma-online-presentation-'));
const bundle = join(scratch, 'presentation.mjs');
await build({
  stdin: { resolveDir:root, contents: `
    export { StrikeGame } from './src/game/game';
    export { WeaponInventory } from './src/game/weapons';
    export { RemotePlayers } from './src/game/remotePlayers';
    export { NullEngine } from '@babylonjs/core/Engines/nullEngine';
    export { Scene } from '@babylonjs/core/scene';
  ` },
  bundle:true, platform:'node', format:'esm', outfile:bundle, logLevel:'silent',
});
const { StrikeGame, WeaponInventory, RemotePlayers, NullEngine, Scene } = await import(pathToFileURL(bundle).href);
after(async () => { await rm(scratch, { recursive:true, force:true }); });

function mirrorFixture(weapon, owned, previousWeapon = 'pistol', previouslyConnected = false) {
  const game = Object.create(StrikeGame.prototype);
  const equipped = [];
  const self = {
    id:'human', position:{x:0,y:.86,z:-12}, yaw:0, pitch:0, kills:0,
    lastInput:0, deviceEquipped:false, economy:{ownedWeapons:owned},
    inventory:{primaryId:'rifle',weaponId:weapon,action:'ready',magazine:weapon === 'knife' ? 0 : 12,reserve:48},
  };
  const snapshot = {stage:'match',players:[self],objective:{epoch:1,round:1,phase:'combat'}};
  Object.assign(game, {
    onlineBridge:{getSnapshot:() => snapshot},
    onlineSnapshot:previouslyConnected ? structuredClone(snapshot) : null,
    controlledId:'human', inventory:new WeaponInventory(), remotePlayers:{receive() {}},
    weapon:{equip(definition) { equipped.push(definition.id); }},
    state:{}, onlinePhaseKey:'match:1:1:combat', onlineLastAck:0,
  });
  game.inventory.activeId = previousWeapon;
  return { game, equipped };
}

test('the authoritative starting knife replaces the visible Practice pistol', () => {
  const {game,equipped} = mirrorFixture('knife',['knife']);
  game.syncOnlineSnapshot();
  assert.equal(game.inventory.activeId,'knife');
  assert.deepEqual(equipped,['knife']);
});

test('refunding an equipped primary updates its viewmodel after ownership changes', () => {
  const {game,equipped} = mirrorFixture('knife',['knife'],'rifle',true);
  game.syncOnlineSnapshot();
  assert.equal(game.inventory.activeId,'knife');
  assert.deepEqual(equipped,['knife']);
});

test('ordinary snapshots reuse the current model while a new session refreshes it', () => {
  const existing = mirrorFixture('pistol',['pistol','knife'],'pistol',true);
  existing.game.syncOnlineSnapshot();
  assert.deepEqual(existing.equipped,[]);
  const fresh = mirrorFixture('pistol',['pistol','knife']);
  fresh.game.syncOnlineSnapshot();
  assert.deepEqual(fresh.equipped,['pistol']);
});

function remoteFixture() {
  const engine = new NullEngine();
  const context = new Proxy({}, {
    get(target,key) { return key in target ? target[key] : () => {}; },
    set(target,key,value) { target[key] = value; return true; },
  });
  engine.createCanvas = (width,height) => ({width,height,getContext:() => context});
  const scene = new Scene(engine);
  const view = new RemotePlayers(scene);
  const player = {
    id:'other',name:'Guest',team:'attackers',connected:true,alive:true,
    position:{x:0,y:.86,z:10},yaw:0,pitch:0,moving:false,sprinting:false,
    deviceEquipped:false,inventory:{weaponId:'knife'},
  };
  const receive = (value,round=1,at=1000) => view.receive({players:[value],stage:'match',objective:{epoch:round,round}},'self',at);
  const dispose = () => { view.dispose(); scene.dispose(); engine.dispose(); };
  return {view,scene,player,receive,dispose};
}

test('remote motion interpolates between snapshots and round respawns clear old samples', () => {
  const {view,player,receive,dispose} = remoteFixture();
  try {
    receive(player); view.update(.016,1000);
    const actor = view.actors.get('other');
    assert.equal(actor.root.position.z,10);
    receive({...player,position:{...player.position,z:12}},1,1100);
    view.update(.016,1150);
    assert.ok(actor.root.position.z > 10 && actor.root.position.z < 12);
    receive({...player,position:{...player.position,z:-12}},2,1200);
    view.update(.016,1200);
    assert.equal(actor.root.position.z,-12);
  } finally { dispose(); }
});

test('remote core equipment replaces the weapon and all avatar resources are released', () => {
  const {view,scene,player,receive,dispose} = remoteFixture();
  try {
    receive({...player,deviceEquipped:true}); view.update(.016,1000);
    const actor = view.actors.get('other');
    assert.equal(actor.weaponId,'objective');
    assert.ok(actor.weapon.getChildMeshes().some(mesh => mesh.name.endsWith('-core-case')));
    receive({...player,inventory:{weaponId:'pistol'}},1,1100);
    view.update(.016,1100);
    assert.equal(actor.weaponId,'pistol');
    assert.equal(actor.weapon.getChildMeshes().some(mesh => mesh.name.endsWith('-core-case')),false);
    view.clear();
    assert.equal(scene.meshes.length,0);
    assert.equal(scene.transformNodes.length,0);
    assert.equal(view.actors.size,0);
    view.dispose();
    assert.equal(scene.materials.length,0);
  } finally { dispose(); }
});

test('releasing interaction after a resolved round clears local input without sending an invalid action', () => {
  for (const phase of ['buy','result','transition']) {
    const game = Object.create(StrikeGame.prototype);
    const sent = [];
    Object.assign(game, {
      input:{interactHeld:true}, onlineBridge:{sendAction:action => sent.push(action)},
      onlineSnapshot:{objective:{phase,round:1,epoch:1}}, emitHud() {},
    });
    game.interact(false);
    assert.equal(game.input.interactHeld,false);
    assert.deepEqual(sent,[]);
  }
});
