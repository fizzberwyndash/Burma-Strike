import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { OnlinePlayer, OnlineSnapshot } from '../network/protocol';

interface Sample { at: number; x: number; y: number; z: number; yaw: number; pitch: number }
interface RemoteActor {
  root: TransformNode; upper: TransformNode; legs: TransformNode[]; weapon: TransformNode;
  flash: Mesh; label: Mesh; labelTexture: DynamicTexture; labelMaterial: StandardMaterial;
  cloth: Mesh[]; samples: Sample[]; player: OnlinePlayer; weaponId: string; flashTime: number;
}
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
const lerpAngle = (a: number, b: number, amount: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * amount;

/** Interpolated human avatars consume server snapshots only. Their meshes never
 * determine hits, damage, or movement; those decisions remain on the server. */
export class RemotePlayers {
  private readonly actors = new Map<string, RemoteActor>();
  private readonly materials: StandardMaterial[] = [];
  private readonly attacker: StandardMaterial;
  private readonly defender: StandardMaterial;
  private readonly dark: StandardMaterial;
  private readonly bronze: StandardMaterial;
  private readonly flashMaterial: StandardMaterial;
  private readonly coreGlow: StandardMaterial;
  private roundKey = '';
  private watchedId: string | null = null;
  private matchVisible = false;
  private phase = 0;
  private disposed = false;

  constructor(private readonly scene: Scene) {
    const material = (name: string, color: string) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.FromHexString(color); m.specularColor.setAll(.1);
      this.materials.push(m); return m;
    };
    this.attacker = material('online attacker terracotta uniform', '#b05c43');
    this.defender = material('online defender turquoise uniform', '#348c91');
    this.dark = material('online operator charcoal equipment', '#263231');
    this.bronze = material('online operator bronze details', '#c7a764');
    this.flashMaterial = material('online weapon muzzle glow', '#ffcf75');
    this.flashMaterial.disableLighting = true; this.flashMaterial.emissiveColor.set(1, .7, .2);
    this.coreGlow = material('online carried core signal', '#57e4c0');
    this.coreGlow.disableLighting = true; this.coreGlow.emissiveColor.set(.22, .9, .7);
  }

  receive(snapshot: OnlineSnapshot, controlledId: string, now: number) {
    if (this.disposed) return;
    const roundKey = `${snapshot.matchId ?? ''}:${snapshot.objective?.epoch}:${snapshot.objective?.round}`;
    const newRound = roundKey !== this.roundKey;
    this.roundKey = roundKey;
    this.matchVisible = snapshot.stage !== 'lobby';
    const present = new Set<string>();
    for (const player of snapshot.players) {
      if (player.id === controlledId) continue;
      present.add(player.id);
      const actor = this.actors.get(player.id) ?? this.create(player);
      // Respawn and reconnection are discontinuities, rather than ordinary
      // movement samples. Do not interpolate a body across the entire town.
      if (newRound || (!actor.player.alive && player.alive) || (!actor.player.connected && player.connected)) actor.samples.length = 0;
      actor.player = player;
      actor.samples.push({ at: now, ...player.position, yaw: player.yaw, pitch: player.pitch });
      while (actor.samples.length > 10) actor.samples.shift();
      actor.root.setEnabled(player.connected && this.matchVisible && player.id !== this.watchedId);
      const cloth = player.team === 'attackers' ? this.attacker : this.defender;
      actor.cloth.forEach(mesh => { mesh.material = cloth; });
      const weaponId = player.deviceEquipped ? 'objective' : player.inventory.weaponId;
      if (actor.weaponId !== weaponId) this.equip(actor, weaponId);
      actor.label.setEnabled(player.alive);
    }
    for (const [id, actor] of this.actors) if (!present.has(id)) { this.remove(actor); this.actors.delete(id); }
  }

  update(dt: number, now: number) {
    if (this.disposed) return;
    this.phase += dt;
    const renderAt = now - 100;
    for (const actor of this.actors.values()) {
      const samples = actor.samples;
      while (samples.length > 2 && samples[1].at <= renderAt) samples.shift();
      const a = samples[0], b = samples[1] ?? a;
      if (!a) continue;
      const alpha = b.at > a.at ? Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at))) : 1;
      actor.root.position.set(lerp(a.x, b.x, alpha), lerp(a.y, b.y, alpha) - .85, lerp(a.z, b.z, alpha));
      actor.root.rotation.set(0, lerpAngle(a.yaw, b.yaw, alpha), actor.player.alive ? 0 : Math.PI / 2);
      if (!actor.player.alive) actor.root.position.y = .24;
      actor.upper.rotation.x = lerp(a.pitch, b.pitch, alpha) * .55;
      const swing = actor.player.alive && actor.player.moving ? Math.sin(this.phase * (actor.player.sprinting ? 14 : 10)) * .46 : 0;
      actor.legs[0].rotation.x = swing; actor.legs[1].rotation.x = -swing;
      actor.upper.position.y = actor.player.moving ? Math.abs(Math.sin(this.phase * 10)) * .018 : 0;
      actor.flashTime = Math.max(0, actor.flashTime - dt);
      actor.flash.setEnabled(actor.flashTime > 0 && actor.player.alive && actor.weaponId !== 'knife' && actor.weaponId !== 'objective');
    }
  }

  shot(playerId: string) { const actor = this.actors.get(playerId); if (actor) actor.flashTime = .06; }

  /** First-person teammate view uses the already interpolated presentation pose.
   * The caller must select an eligible teammate from its authoritative snapshot. */
  getSpectatorPose(playerId: string): { position: {x:number;y:number;z:number}; yaw: number; pitch: number } | null {
    const actor = this.actors.get(playerId);
    if (!actor?.player.alive || !actor.player.connected) return null;
    return {
      position: { x:actor.root.position.x, y:actor.root.position.y + 1.6, z:actor.root.position.z },
      yaw:actor.root.rotation.y, pitch:actor.upper.rotation.x / .55,
    };
  }

  /** Hide only the followed avatar in this local scene so its head/vest cannot
   * cover the camera. This never changes an authoritative player or hitbox. */
  setSpectatedPlayer(playerId: string | null): void {
    this.watchedId = playerId;
    for (const [id, actor] of this.actors) actor.root.setEnabled(actor.player.connected && this.matchVisible && id !== playerId);
  }

  private create(player: OnlinePlayer): RemoteActor {
    const root = new TransformNode(`remote-player:${player.id}`, this.scene);
    root.metadata = { remotePlayerId: player.id };
    root.position.set(player.position.x, player.position.y - .85, player.position.z);
    const upper = new TransformNode(`remote-upper:${player.id}`, this.scene); upper.parent = root;
    const cloth: Mesh[] = [];
    const clothing = player.team === 'attackers' ? this.attacker : this.defender;
    const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, mat: StandardMaterial, parent: TransformNode = upper) => {
      const mesh = MeshBuilder.CreateBox(`remote-${player.id}-${name}`, { width, height, depth }, this.scene);
      mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = mat;
      mesh.isPickable = false; mesh.checkCollisions = false; mesh.metadata = { remotePlayerId: player.id };
      if (mat === clothing) cloth.push(mesh); return mesh;
    };
    box('torso', .47, .58, .3, 0, 1.07, 0, clothing);
    box('vest', .39, .35, .06, 0, 1.1, .17, this.dark);
    box('belt', .45, .08, .32, 0, .77, 0, this.bronze);
    const legs: TransformNode[] = [];
    for (const side of [-1, 1]) {
      box(`arm-${side}`, .15, .45, .17, side * .30, 1.05, .09, clothing).rotation.x = -.5;
      box(`hand-${side}`, .16, .13, .18, side * .24, .91, .30, this.dark);
      const leg = new TransformNode(`remote-${player.id}-leg-${side}`, this.scene); leg.parent = root; leg.position.set(side * .14, .68, 0);
      box(`leg-${side}`, .18, .57, .22, 0, -.28, 0, this.dark, leg);
      box(`boot-${side}`, .2, .14, .3, 0, -.59, .04, this.dark, leg); legs.push(leg);
    }
    const head = MeshBuilder.CreateSphere(`remote-${player.id}-head`, { diameter: .32, segments: 8 }, this.scene);
    head.parent = upper; head.position.set(0, 1.55, 0); head.material = clothing;
    head.isPickable = false; head.checkCollisions = false; head.metadata = { remotePlayerId: player.id }; cloth.push(head);
    box('visor', .26, .09, .075, 0, 1.57, .147, this.dark);
    box('visor-seal', .075, .023, .015, 0, 1.57, .19, this.bronze);
    const weapon = new TransformNode(`remote-${player.id}-weapon`, this.scene); weapon.parent = upper; weapon.position.set(.15, .98, .27);
    const flash = MeshBuilder.CreateSphere(`remote-${player.id}-muzzle-flash`, { diameter: .16, segments: 5 }, this.scene);
    flash.parent = weapon; flash.material = this.flashMaterial; flash.scaling.z = 1.8;
    flash.isPickable = false; flash.setEnabled(false);
    const labelTexture = new DynamicTexture(`remote-${player.id}-name`, { width: 512, height: 128 }, this.scene, false);
    const context = labelTexture.getContext() as CanvasRenderingContext2D; context.clearRect(0, 0, 512, 128);
    context.fillStyle = '#17211ddd'; context.fillRect(8, 20, 496, 88);
    context.fillStyle = '#f3ead8'; context.font = 'bold 36px "Noto Sans Myanmar", sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(player.name, 256, 64, 470); labelTexture.hasAlpha = true; labelTexture.update();
    const labelMaterial = new StandardMaterial(`remote-${player.id}-name-material`, this.scene);
    labelMaterial.diffuseTexture = labelTexture; labelMaterial.emissiveColor.set(.7, .7, .7); labelMaterial.useAlphaFromDiffuseTexture = true; labelMaterial.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(`remote-${player.id}-nameplate`, { width: 1.65, height: .41 }, this.scene);
    label.parent = root; label.position.y = 2.08; label.billboardMode = Mesh.BILLBOARDMODE_ALL; label.material = labelMaterial; label.isPickable = false;
    const actor: RemoteActor = { root, upper, legs, weapon, flash, label, labelTexture, labelMaterial, cloth, samples: [], player, weaponId: '', flashTime: 0 };
    this.actors.set(player.id, actor); this.equip(actor, player.inventory.weaponId); return actor;
  }

  private equip(actor: RemoteActor, id: string) {
    for (const mesh of actor.weapon.getChildMeshes()) if (mesh !== actor.flash) mesh.dispose(false, false);
    actor.weaponId = id;
    if (id === 'objective') {
      const part = (name: string, size: number[], position: number[], material: StandardMaterial) => {
        const mesh = MeshBuilder.CreateBox(`remote-${actor.player.id}-core-${name}`, { width:size[0], height:size[1], depth:size[2] }, this.scene);
        mesh.parent = actor.weapon; mesh.position.set(position[0],position[1],position[2]); mesh.material = material;
        mesh.isPickable = false; mesh.checkCollisions = false;
      };
      part('case', [.3,.19,.25], [0,.02,.13], this.dark);
      part('royal-band', [.32,.035,.27], [0,.04,.13], this.bronze);
      part('signal', [.075,.035,.075], [0,.13,.13], this.coreGlow);
      actor.flash.setEnabled(false);
      return;
    }
    const knife = id === 'knife', pistol = id === 'pistol';
    const mesh = MeshBuilder.CreateBox(`remote-${actor.player.id}-${id}`, { width: knife ? .04 : .095, height: knife ? .015 : .11, depth: knife ? .39 : pistol ? .26 : id === 'sniper' ? .88 : .61 }, this.scene);
    mesh.parent = actor.weapon; mesh.material = knife ? this.bronze : this.dark;
    mesh.position.z = knife ? .14 : pistol ? .1 : .24; mesh.isPickable = false; mesh.checkCollisions = false;
    actor.flash.position.z = pistol ? .25 : id === 'sniper' ? .72 : .59;
  }
  private remove(actor: RemoteActor) { actor.root.dispose(false, false); actor.labelMaterial.dispose(false, false); actor.labelTexture.dispose(); }
  clear() { for (const actor of this.actors.values()) this.remove(actor); this.actors.clear(); this.roundKey = ''; this.watchedId = null; this.matchVisible = false; }
  dispose() { if (this.disposed) return; this.disposed = true; this.clear(); for (const material of this.materials) material.dispose(); }
}
