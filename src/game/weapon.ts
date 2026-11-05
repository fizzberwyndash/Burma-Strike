import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** An original, entirely procedural sidearm. All dimensions are in world metres. */
export class PistolView {
  private readonly root: TransformNode;
  private readonly flash: Mesh;
  private readonly slide: TransformNode;
  private readonly base = new Vector3(0.29, -0.27, 0.55);
  private recoil = 0;
  private reloadAmount = 0;
  private time = 0;

  constructor(scene: Scene, camera: Camera) {
    this.root = new TransformNode('sidearm-view', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(this.base);
    scene.setRenderingAutoClearDepthStencil(2, true, true, true);

    const material = (name: string, color: string, specular = 0.3) => {
      const result = new StandardMaterial(name, scene);
      result.diffuseColor = Color3.FromHexString(color);
      result.specularColor = new Color3(specular, specular, specular);
      result.specularPower = 70;
      return result;
    };
    const steel = material('sidearm-blued-steel', '#29373b', 0.75);
    const frame = material('sidearm-graphite-frame', '#172227');
    const brass = material('sidearm-aged-brass', '#b88b4a', 0.7);
    const rubber = material('sidearm-grip', '#101b1c', 0.08);
    const black = material('sidearm-bore', '#050909', 0);
    const glove = material('sidearm-glove', '#303c36', 0.1);

    const finish = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode = this.root) => {
      mesh.parent = parent;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.renderingGroupId = 2;
      return mesh;
    };
    const box = (name: string, size: [number, number, number], at: [number, number, number], mat: StandardMaterial, parent?: TransformNode) => {
      const mesh = finish(MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene), mat, parent);
      mesh.position.set(...at);
      return mesh;
    };
    const cylinder = (name: string, diameter: number, depth: number, at: [number, number, number], mat: StandardMaterial, parent?: TransformNode) => {
      const mesh = finish(MeshBuilder.CreateCylinder(name, { diameter, height: depth, tessellation: 16 }, scene), mat, parent);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(...at);
      return mesh;
    };

    this.slide = new TransformNode('sidearm-reciprocating-slide', scene);
    this.slide.parent = this.root;
    box('sidearm-slide', [0.115, 0.115, 0.46], [0, 0.025, 0.12], steel, this.slide);
    box('sidearm-top-ridge', [0.085, 0.016, 0.40], [0, 0.09, 0.12], frame, this.slide);
    box('sidearm-ejection-port', [0.005, 0.048, 0.074], [0.06, 0.04, 0.1], black, this.slide);
    for (let i = 0; i < 6; i++) {
      box(`sidearm-slide-serration-${i}`, [0.12, 0.045, 0.006], [0, 0.028, -0.075 + i * 0.013], frame, this.slide);
    }
    cylinder('sidearm-barrel-sleeve', 0.069, 0.035, [0, 0.018, 0.36], brass, this.slide);
    cylinder('sidearm-dark-muzzle', 0.047, 0.037, [0, 0.018, 0.368], black, this.slide);
    box('sidearm-front-sight', [0.018, 0.024, 0.025], [0, 0.111, 0.29], brass, this.slide);
    box('sidearm-rear-sight-left', [0.016, 0.026, 0.028], [-0.038, 0.112, -0.078], black, this.slide);
    box('sidearm-rear-sight-right', [0.016, 0.026, 0.028], [0.038, 0.112, -0.078], black, this.slide);
    box('sidearm-lower-frame', [0.098, 0.064, 0.34], [0, -0.06, 0.09], frame);
    const grip = box('sidearm-pistol-grip', [0.105, 0.25, 0.12], [0, -0.16, -0.045], rubber);
    grip.rotation.x = -0.2;
    box('sidearm-grip-heel', [0.113, 0.025, 0.13], [0, -0.287, -0.021], brass);
    for (let i = 0; i < 5; i++) {
      box(`sidearm-grip-ridge-${i}`, [0.11, 0.009, 0.1], [0, -0.11 - i * 0.032, -0.035], frame);
    }
    box('sidearm-trigger-guard-bottom', [0.08, 0.016, 0.15], [0, -0.15, 0.12], steel);
    box('sidearm-trigger-guard-front', [0.08, 0.09, 0.016], [0, -0.1, 0.2], steel);
    const trigger = box('sidearm-trigger', [0.012, 0.065, 0.018], [0, -0.1, 0.10], brass);
    trigger.rotation.x = -0.3;
    cylinder('sidearm-brass-pin', 0.022, 0.115, [0, -0.05, -0.06], brass).rotation.set(0, 0, Math.PI / 2);

    // The glove and sleeve anchor the weapon naturally at the lower edge of view.
    const hand = box('sidearm-gloved-hand', [0.15, 0.18, 0.16], [0.008, -0.18, -0.11], glove);
    hand.rotation.x = -0.25;
    const sleeve = box('sidearm-sleeve', [0.165, 0.18, 0.38], [0.035, -0.29, -0.29], frame);
    sleeve.rotation.x = -0.32;

    const flashMaterial = material('sidearm-muzzle-flash', '#ffc066', 0);
    flashMaterial.emissiveColor = new Color3(1, 0.65, 0.2);
    flashMaterial.disableLighting = true;
    this.flash = finish(MeshBuilder.CreateSphere('sidearm-muzzle-flash', { diameter: 0.14, segments: 6 }, scene), flashMaterial);
    this.flash.position.set(0, 0.018, 0.46);
    this.flash.scaling.set(0.65, 0.65, 1.7);
    this.flash.setEnabled(false);
  }

  fire() {
    this.recoil = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number, moving: boolean, reloading: boolean) {
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt * 6.8);
    this.reloadAmount += ((reloading ? 1 : 0) - this.reloadAmount) * Math.min(1, dt * 11);
    const bob = moving ? 1 : 0.12;
    this.root.position.set(
      this.base.x + Math.sin(this.time * 9) * 0.007 * bob,
      this.base.y + Math.cos(this.time * 18) * 0.005 * bob - this.reloadAmount * 0.21,
      this.base.z - this.recoil * 0.055,
    );
    this.root.rotation.set(-this.recoil * 0.17 - this.reloadAmount * 0.35, this.reloadAmount * -0.25, this.reloadAmount * -0.72);
    this.slide.position.z = -this.recoil * 0.045;
    this.flash.setEnabled(this.recoil > 0.77 && !reloading);
  }

  setVisible(visible: boolean) { this.root.setEnabled(visible); }
  dispose() { this.root.dispose(false, true); }
}

/** Short synthesized effects; no downloaded audio or automatic browser playback. */
export class GameAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private disposed = false;

  private audio(): AudioContext | null {
    if (!this.enabled || this.disposed) return null;
    try {
      if (!this.context) {
        const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Audio) return null;
        this.context = new Audio();
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      return this.context;
    } catch { return null; }
  }

  private tone(frequency: number, duration: number, volume: number, endFrequency = frequency, delay = 0) {
    const context = this.audio();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(10, endFrequency), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  fire() {
    const context = this.audio();
    if (!context) return;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.09), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.013));
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass'; filter.frequency.value = 4200;
    gain.gain.value = 0.23;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    this.tone(155, 0.13, 0.19, 38);
  }

  reload() {
    this.tone(700, 0.045, 0.07, 180);
    this.tone(390, 0.07, 0.08, 100, 0.55);
    this.tone(950, 0.05, 0.06, 260, 1.05);
  }

  hit(kill: boolean) {
    this.tone(kill ? 990 : 650, 0.07, 0.075, kill ? 1400 : 780);
    if (kill) this.tone(1480, 0.12, 0.06, 1700, 0.07);
  }

  dispose() {
    this.disposed = true;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
