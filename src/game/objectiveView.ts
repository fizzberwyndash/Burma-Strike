import type { Camera } from '@babylonjs/core/Cameras/camera';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { OBJECTIVE_SITES } from './objective';
import type { ObjectiveSnapshot } from './objective';

type Actor = { root: TransformNode; head: Mesh; lean: TransformNode; phase: number };
type Device = { root: TransformNode; rotor: TransformNode; lamp: Mesh };

/** Presentation only: the round controller owns all timing, interactions and damage. */
export class ObjectiveView {
  private readonly roots: TransformNode[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly textures: DynamicTexture[] = [];
  private readonly actors = new Map<string, Actor>();
  private readonly sites = new Map<string, TransformNode>();
  private readonly clay: StandardMaterial;
  private readonly brass: StandardMaterial;
  private readonly dark: StandardMaterial;
  private readonly glove: StandardMaterial;
  private readonly teal: StandardMaterial;
  private readonly glow: StandardMaterial;
  private readonly attacker: StandardMaterial;
  private readonly defender: StandardMaterial;
  private readonly carried: Device;
  private readonly world: Device;
  private readonly tool: TransformNode;
  private readonly toolProbe: TransformNode;
  private readonly light: PointLight;
  private readonly outcome: Mesh;
  private readonly outcomeMaterial: StandardMaterial;
  private audio: AudioContext | null = null;
  private readonly tones = new Set<OscillatorNode>();
  private soundEnabled = false;
  private disposed = false;
  private elapsed = 0;
  private equipBlend = 0;
  private beepTimer = 0;
  private wasPlanted = false;
  private outcomeKey = '';
  private outcomeAge = 10;
  private meshSerial = 0;
  private readonly unlockAudio = () => {
    if (!this.soundEnabled || this.disposed) return;
    this.ensureAudio();
    if (this.audio?.state === 'suspended') void this.audio.resume().catch(() => undefined);
  };

  constructor(private readonly scene: Scene, camera: Camera) {
    this.clay = this.material('core terracotta enamel', '#8f4b34');
    this.brass = this.material('core brushed royal brass', '#d3a753', 0.55);
    this.dark = this.material('core charcoal ceramic', '#172529');
    this.glove = this.material('core operator gloves', '#344138');
    this.teal = this.material('core patinated copper', '#387c79');
    this.glow = this.material('core turquoise signal', '#52edcc');
    this.glow.emissiveColor = Color3.FromHexString('#52edcc');
    this.glow.disableLighting = true;
    this.attacker = this.material('objective attacker clothing', '#a6553c');
    this.defender = this.material('objective defender clothing', '#317577');

    this.carried = this.device('held Royal Signal Core');
    this.carried.root.parent = camera;
    this.carried.root.position.set(0.06, -0.32, 0.59);
    this.carried.root.rotation.x = 0.23;
    this.carried.root.getChildMeshes().forEach(mesh => { mesh.renderingGroupId = 2; });
    this.carried.root.setEnabled(false);
    const leftHand = this.box(this.carried.root, [0.13, 0.12, 0.19], [-0.24, -0.05, -0.02], this.glove);
    leftHand.rotation.z = -0.13;
    const rightHand = this.box(this.carried.root, [0.13, 0.12, 0.19], [0.24, -0.05, -0.02], this.glove);
    rightHand.rotation.z = 0.13;
    for (const hand of [leftHand, rightHand]) hand.renderingGroupId = 2;

    this.world = this.device('world Royal Signal Core');
    this.world.root.scaling.setAll(1.3);
    this.world.root.setEnabled(false);
    this.light = new PointLight('Royal Signal Core indicator light', Vector3.Zero(), scene);
    this.light.diffuse = Color3.FromHexString('#57e4c0');
    this.light.range = 4;
    this.light.intensity = 0;

    this.tool = this.root('Royal Signal Core defuse tool');
    this.tool.parent = camera;
    this.tool.position.set(0.26, -0.29, 0.5);
    this.tool.rotation.set(-0.1, -0.16, -0.1);
    this.box(this.tool, [0.12, 0.11, 0.27], [0, 0, 0], this.dark);
    this.box(this.tool, [0.1, 0.018, 0.13], [0, 0.06, 0.03], this.teal);
    this.box(this.tool, [0.14, 0.14, 0.17], [0, -0.08, -0.07], this.glove);
    this.toolProbe = new TransformNode('signal probe animated tip', scene);
    this.toolProbe.parent = this.tool;
    this.box(this.toolProbe, [0.035, 0.035, 0.25], [0, 0.015, 0.24], this.brass);
    this.box(this.toolProbe, [0.048, 0.048, 0.035], [0, 0.015, 0.37], this.glow);
    this.tool.getChildMeshes().forEach(mesh => { mesh.renderingGroupId = 2; });
    this.tool.setEnabled(false);
    scene.setRenderingAutoClearDepthStencil(2, true, true, true);

    this.outcomeMaterial = this.material('signal release fading halo', '#f5bd64');
    this.outcomeMaterial.disableLighting = true;
    this.outcomeMaterial.emissiveColor = Color3.FromHexString('#f5bd64');
    this.outcomeMaterial.alpha = 0;
    this.outcomeMaterial.backFaceCulling = false;
    const haloRoot = this.root('signal release effect');
    this.outcome = this.finish(MeshBuilder.CreateSphere('Royal Signal Core release halo', {
      diameter: 1, segments: 12,
    }, scene), haloRoot, this.outcomeMaterial);
    this.outcome.setEnabled(false);

    for (const site of OBJECTIVE_SITES) this.createSite(site.id, site.position.x, site.position.z, site.radius);
    document.addEventListener('pointerdown', this.unlockAudio, { passive: true });
    document.addEventListener('keydown', this.unlockAudio);
  }

  private root(name: string) {
    const root = new TransformNode(name, this.scene);
    this.roots.push(root);
    return root;
  }

  private material(name: string, hex: string, shine = 0.12) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor.set(shine, shine, shine);
    material.specularPower = 48;
    this.materials.push(material);
    return material;
  }

  private finish(mesh: Mesh, parent: TransformNode, material: StandardMaterial) {
    mesh.parent = parent;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  private box(parent: TransformNode, size: [number, number, number], at: [number, number, number], material: StandardMaterial) {
    const mesh = this.finish(MeshBuilder.CreateBox(`core detail ${this.meshSerial++}`, {
      width: size[0], height: size[1], depth: size[2],
    }, this.scene), parent, material);
    mesh.position.set(...at);
    return mesh;
  }

  private cylinder(parent: TransformNode, diameter: number, height: number, at: [number, number, number], material: StandardMaterial, top = diameter) {
    const mesh = this.finish(MeshBuilder.CreateCylinder(`signal ring ${this.meshSerial++}`, {
      diameterBottom: diameter, diameterTop: top, height, tessellation: 12,
    }, this.scene), parent, material);
    mesh.position.set(...at);
    return mesh;
  }

  private device(name: string): Device {
    const root = this.root(name);
    this.box(root, [0.43, 0.14, 0.45], [0, 0.02, 0], this.dark);
    this.box(root, [0.38, 0.095, 0.4], [0, 0.08, 0], this.clay);
    for (const x of [-0.174, 0.174]) {
      this.box(root, [0.026, 0.13, 0.45], [x, 0.04, 0], this.brass);
      this.box(root, [0.045, 0.024, 0.07], [x, 0.145, -0.14], this.teal);
    }
    for (const z of [-0.19, 0.19]) this.box(root, [0.39, 0.025, 0.025], [0, 0.135, z], this.brass);
    const rotor = new TransformNode(`${name} arming crown`, this.scene);
    rotor.parent = root;
    this.cylinder(rotor, 0.245, 0.035, [0, 0.14, 0.035], this.brass);
    this.cylinder(rotor, 0.185, 0.03, [0, 0.17, 0.035], this.teal);
    const lamp = this.cylinder(root, 0.13, 0.055, [0, 0.185, 0.035], this.glow, 0.052);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const fin = this.box(rotor, [0.026, 0.035, 0.075], [Math.sin(angle) * 0.1, 0.182, 0.035 + Math.cos(angle) * 0.1], this.brass);
      fin.rotation.y = angle;
    }
    this.box(root, [0.12, 0.015, 0.035], [0, 0.142, -0.12], this.dark);
    for (let i = 0; i < 3; i++) this.box(root, [0.016, 0.018, 0.022], [-0.035 + i * 0.035, 0.154, -0.12], this.glow);
    return { root, rotor, lamp };
  }

  private createSite(id: 'A' | 'B', x: number, z: number, radius: number) {
    const root = this.root(`Royal Signal ${id} site markings`);
    root.position.set(x, 0.022, z);
    const floorMaterial = this.material(`site ${id} faded gold inlay`, '#d4b369');
    floorMaterial.emissiveColor = Color3.FromHexString('#b49950').scale(0.25);
    this.finish(MeshBuilder.CreateTorus(`site ${id} interaction boundary`, {
      diameter: radius * 2, thickness: 0.035, tessellation: 48,
    }, this.scene), root, floorMaterial);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const tick = this.box(root, [0.06, 0.012, 0.35], [Math.sin(angle) * (radius - 0.26), 0, Math.cos(angle) * (radius - 0.26)], floorMaterial);
      tick.rotation.y = angle;
    }
    const texture = new DynamicTexture(`original site ${id} floor seal`, { width: 256, height: 256 }, this.scene, false);
    this.textures.push(texture);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, 256, 256);
    context.textAlign = 'center';
    context.fillStyle = '#e9c47c';
    context.font = 'bold 144px sans-serif';
    context.fillText(id, 128, 159);
    context.font = 'bold 21px sans-serif';
    context.fillText('SIGNAL SITE', 128, 204);
    context.strokeStyle = '#d4b369'; context.lineWidth = 3;
    context.strokeRect(34, 20, 188, 210);
    texture.hasAlpha = true;
    texture.update();
    const labelMaterial = this.material(`site ${id} original seal material`, '#ffffff');
    labelMaterial.diffuseTexture = texture;
    labelMaterial.useAlphaFromDiffuseTexture = true;
    labelMaterial.backFaceCulling = false;
    labelMaterial.emissiveColor.set(0.1, 0.08, 0.04);
    const seal = this.finish(MeshBuilder.CreateGround(`site ${id} floor seal`, { width: 1.8, height: 1.8 }, this.scene), root, labelMaterial);
    seal.position.y = 0.008;
    root.setEnabled(false);
    this.sites.set(id, root);
  }

  private createActor(id: string, team: 'attackers' | 'defenders'): Actor {
    const root = this.root(`objective actor ${id}`);
    const lean = new TransformNode(`objective actor ${id} upper body`, this.scene);
    lean.parent = root;
    const clothing = team === 'attackers' ? this.attacker : this.defender;
    const body: Mesh[] = [];
    body.push(this.box(lean, [0.47, 0.58, 0.3], [0, 1.07, 0], clothing));
    body.push(this.box(lean, [0.39, 0.35, 0.035], [0, 1.1, 0.165], this.dark));
    for (const side of [-1, 1]) {
      body.push(this.box(lean, [0.16, 0.57, 0.18], [side * 0.33, 1.03, 0], clothing));
      body.push(this.box(lean, [0.17, 0.17, 0.2], [side * 0.33, 0.71, 0.03], this.glove));
      body.push(this.box(root, [0.18, 0.64, 0.22], [side * 0.14, 0.38, 0], this.dark));
      body.push(this.box(root, [0.2, 0.13, 0.31], [side * 0.14, 0.08, 0.04], this.glove));
      this.box(lean, [0.025, 0.29, 0.015], [side * 0.115, 1.1, 0.19], this.brass);
    }
    const head = this.finish(MeshBuilder.CreateSphere(`objective actor ${id} head`, {
      diameter: 0.32, segments: 8,
    }, this.scene), lean, clothing);
    head.position.set(0, 1.55, 0);
    body.push(head);
    this.box(lean, [0.26, 0.09, 0.075], [0, 1.57, 0.147], this.dark);
    this.box(lean, [0.075, 0.023, 0.01], [0, 1.57, 0.19], this.brass);
    for (const mesh of body) {
      mesh.metadata = { objectiveActorId: id, ...(mesh === head ? { headshot: true } : {}) };
      mesh.isPickable = true;
    }
    // A single collision torso is sufficient; decoration never blocks raycasts.
    body[0].checkCollisions = true;
    const actor = { root, head, lean, phase: this.actors.size * 1.7 };
    this.actors.set(id, actor);
    return actor;
  }

  update(dt: number, snapshot: ObjectiveSnapshot | null, controlledId: string, equipped: boolean, sound: boolean) {
    if (this.disposed) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += step;
    if (this.soundEnabled && (!sound || !snapshot)) this.stopTones();
    this.soundEnabled = sound && snapshot !== null;
    if (!snapshot) {
      this.carried.root.setEnabled(false); this.world.root.setEnabled(false); this.tool.setEnabled(false);
      this.light.intensity = 0; this.outcome.setEnabled(false);
      this.sites.forEach(site => site.setEnabled(false));
      this.actors.forEach(actor => actor.root.setEnabled(false));
      this.wasPlanted = false; this.equipBlend = 0; this.outcomeKey = '';
      return;
    }

    for (const [id, site] of this.sites) site.setEnabled(snapshot.config.activeSite === 'both' || snapshot.config.activeSite === id);
    const controlled = snapshot.players.find(player => player.id === controlledId);
    const activeActors = new Set<string>();
    for (const player of snapshot.players) {
      if (player.id === controlledId || !player.alive || !player.connected) continue;
      activeActors.add(player.id);
      const actor = this.actors.get(player.id) ?? this.createActor(player.id, player.team);
      actor.root.setEnabled(true);
      actor.root.position.set(player.position.x, player.position.y - 0.85, player.position.z);
      if (controlled) actor.root.rotation.y = Math.atan2(controlled.position.x - player.position.x, controlled.position.z - player.position.z);
      actor.lean.position.y = Math.sin(this.elapsed * 2.1 + actor.phase) * 0.008;
      actor.head.rotation.y = Math.sin(this.elapsed * 0.6 + actor.phase) * 0.025;
    }
    for (const [id, actor] of this.actors) if (!activeActors.has(id)) actor.root.setEnabled(false);

    const active = snapshot.phase === 'buy' || snapshot.phase === 'combat' || snapshot.phase === 'planted';
    const interaction = snapshot.interaction?.playerId === controlledId ? snapshot.interaction : null;
    const planting = active && interaction?.kind === 'plant';
    const defusing = active && interaction?.kind === 'defuse';
    const holding = active && equipped && controlled?.alive === true && snapshot.carrierId === controlledId && snapshot.coreState === 'carried';
    const progress = interaction ? Math.max(0, Math.min(1, interaction.progress)) : 0;
    const eased = progress * progress * (3 - 2 * progress);
    this.equipBlend += ((holding ? 1 : 0) - this.equipBlend) * Math.min(1, step * 16);
    this.carried.root.setEnabled(holding || this.equipBlend > 0.02);
    this.carried.root.position.set(0.06 + Math.sin(this.elapsed * 1.7) * 0.002, -0.32 - (1 - this.equipBlend) * 0.35 - (planting ? eased * 0.18 : 0), 0.59 + (planting ? eased * 0.1 : 0));
    this.carried.root.rotation.set(0.23 + (planting ? eased * 0.55 : 0), 0, Math.sin(this.elapsed * 1.8) * 0.008);
    this.carried.rotor.rotation.y = planting ? eased * Math.PI * 2 : 0;
    this.tool.setEnabled(defusing);
    this.tool.position.y = -0.29 + (defusing ? Math.sin(this.elapsed * 11) * 0.008 : 0);
    this.toolProbe.rotation.z = defusing ? Math.sin(this.elapsed * 14) * 0.08 : 0;

    const placed = snapshot.corePosition && (snapshot.coreState === 'planted' || snapshot.coreState === 'dropped' || snapshot.coreState === 'defused');
    this.world.root.setEnabled(Boolean(placed));
    if (snapshot.corePosition) {
      this.world.root.position.set(snapshot.corePosition.x, snapshot.corePosition.y + 0.08, snapshot.corePosition.z);
      this.light.position.copyFrom(this.world.root.position).addInPlaceFromFloats(0, 0.5, 0);
    }
    const planted = snapshot.phase === 'planted' && snapshot.coreState === 'planted';
    const pulseSpeed = snapshot.remaining < 5 ? 18 : snapshot.remaining < 12 ? 10 : 4.5;
    const pulse = 0.45 + (0.5 + Math.sin(this.elapsed * pulseSpeed) * 0.5) * 0.55;
    this.glow.emissiveColor.set(0.14 * pulse, 0.85 * pulse, 0.66 * pulse);
    this.world.lamp.scaling.setAll(planted ? 0.9 + pulse * 0.12 : 1);
    this.world.rotor.rotation.y = planted ? this.elapsed * 0.2 : 0;
    this.light.intensity = planted ? 0.22 + pulse * 0.35 : 0;

    if (planted) {
      if (!this.wasPlanted) this.beepTimer = 0;
      this.beepTimer -= step;
      if (this.beepTimer <= 0) {
        if (sound) this.beep(snapshot.remaining);
        this.beepTimer = snapshot.remaining > 20 ? 1.25 : snapshot.remaining > 10 ? 0.75 : snapshot.remaining > 5 ? 0.4 : 0.19;
      }
    }
    this.wasPlanted = planted;

    if (snapshot.coreState === 'defused' || snapshot.coreState === 'detonated') {
      const key = snapshot.result?.id ?? `${snapshot.epoch}:${snapshot.round}:${snapshot.coreState}`;
      if (this.outcomeKey !== key) {
        this.outcomeKey = key; this.outcomeAge = 0;
        this.outcome.position.copyFrom(this.world.root.position).addInPlaceFromFloats(0, 0.2, 0);
        const color = snapshot.coreState === 'defused' ? '#64e5d2' : '#ffc16b';
        this.outcomeMaterial.emissiveColor = Color3.FromHexString(color);
        if (sound) this.beep(snapshot.coreState === 'defused' ? 40 : 0, 0.22);
      }
    }
    this.outcomeAge += step;
    this.outcome.setEnabled(this.outcomeAge < 0.65);
    if (this.outcomeAge < 0.65) {
      this.outcome.scaling.setAll(0.2 + this.outcomeAge * 5.5);
      this.outcomeMaterial.alpha = Math.max(0, 0.2 * (1 - this.outcomeAge / 0.65));
    }
  }

  private ensureAudio() {
    if (this.audio || typeof AudioContext === 'undefined') return;
    try { this.audio = new AudioContext(); } catch { /* Audio is optional on restricted browsers. */ }
  }

  private beep(remaining: number, duration = 0.065) {
    this.ensureAudio();
    const context = this.audio;
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 680 + Math.max(0, 35 - remaining) * 20;
    envelope.gain.setValueAtTime(0.0001, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(envelope); envelope.connect(context.destination);
    this.tones.add(oscillator);
    oscillator.onended = () => { this.tones.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(); oscillator.stop(context.currentTime + duration + 0.01);
  }

  private stopTones() {
    for (const tone of this.tones) {
      try { tone.stop(); } catch { /* The oscillator may have already ended. */ }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('pointerdown', this.unlockAudio);
    document.removeEventListener('keydown', this.unlockAudio);
    this.stopTones();
    if (this.audio && this.audio.state !== 'closed') void this.audio.close().catch(() => undefined);
    this.audio = null;
    this.light.dispose();
    this.roots.forEach(root => root.dispose());
    this.materials.forEach(material => material.dispose(false, false));
    this.textures.forEach(texture => texture.dispose());
    this.actors.clear(); this.sites.clear(); this.tones.clear();
  }
}
