import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Ray } from '@babylonjs/core/Culling/ray';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { buildMap } from './map';
import { GameInput } from './input';
import { GameAudio, PistolView } from './weapon';

export type GameMode = 'menu' | 'playing' | 'paused';
export interface GameSettings { sensitivity: number; sound: boolean; showFps: boolean; }
export interface HudState {
  ammo: number; reserve: number; health: number; kills: number; shots: number; hits: number;
  fps: number; reloading: boolean; hitAt: number; headshot: boolean; locked: boolean;
}
export const INITIAL_HUD: HudState = {
  ammo: 12, reserve: 48, health: 100, kills: 0, shots: 0, hits: 0,
  fps: 0, reloading: false, hitAt: 0, headshot: false, locked: false,
};

/** Scene lifetime, collision-based movement and authoritative local practice state. */
export class StrikeGame {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: GameInput;
  private camera: FreeCamera;
  private player: Mesh;
  private map: ReturnType<typeof buildMap>;
  private weapon: PistolView;
  private audio = new GameAudio();
  private mode: GameMode = 'menu';
  private state = { ...INITIAL_HUD };
  private velocityY = 0;
  private yaw = 0;
  private pitch = 0;
  private reloadRemaining = 0;
  private shotCooldown = 0;
  private time = 0;
  private hudTimer = 0;
  private disposed = false;
  private impacts: Array<{mesh: Mesh; life: number}> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private onHud: (state: HudState) => void,
    onPause: () => void,
    settings: GameSettings,
  ) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.camera = new FreeCamera('player-camera', new Vector3(20, 10, -22), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 250;
    this.camera.fov = 1.05;
    this.map = buildMap(this.scene);
    this.player = MeshBuilder.CreateBox('player-collider', { width: 0.64, height: 1.7, depth: 0.64 }, this.scene);
    this.player.isVisible = false;
    this.player.isPickable = false;
    this.player.ellipsoid = new Vector3(0.32, 0.85, 0.32);
    this.player.position.copyFrom(this.map.spawn).subtractInPlace(new Vector3(0, 0.75, 0));
    this.weapon = new PistolView(this.scene, this.camera);
    this.weapon.setVisible(false);
    this.input = new GameInput(canvas, {
      onPause, onShoot: () => this.shoot(), onReload: () => this.reload(), onJump: () => this.jump(),
    });
    this.configure(settings);
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(this.frame);
  }

  configure(settings: GameSettings) {
    if (this.input) this.input.sensitivity = settings.sensitivity;
    this.audio.enabled = settings.sound;
  }

  setMode(mode: GameMode) {
    const previous = this.mode;
    this.mode = mode;
    this.input.active = mode === 'playing';
    this.weapon.setVisible(mode !== 'menu');
    if (mode === 'playing') {
      if (previous === 'menu') {
        this.yaw = 0; this.pitch = 0; this.velocityY = 0;
        this.player.position.copyFrom(this.map.spawn).subtractInPlace(new Vector3(0, 0.75, 0));
        this.updateCamera();
      }
      this.input.requestPointerLock();
    } else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  restart() {
    this.state = { ...INITIAL_HUD };
    this.reloadRemaining = 0;
    this.shotCooldown = 0;
    this.yaw = 0; this.pitch = 0; this.velocityY = 0;
    this.player.position.copyFrom(this.map.spawn).subtractInPlace(new Vector3(0, 0.75, 0));
    for (const target of this.map.targets) {
      target.health = 100; target.respawnAt = 0; target.root.setEnabled(true);
    }
    this.updateCamera();
    this.emitHud();
  }

  private grounded() {
    const ray = new Ray(this.player.position, Vector3.Down(), 0.93);
    return !!this.scene.pickWithRay(ray, m => m !== this.player && !!m.metadata?.solid)?.hit;
  }

  jump() {
    if (this.mode === 'playing' && this.grounded()) this.velocityY = 6.5;
  }

  reload() {
    if (this.mode !== 'playing' || this.reloadRemaining > 0 || this.state.ammo === 12 || this.state.reserve <= 0) return;
    this.reloadRemaining = 1.6;
    this.state.reloading = true;
    this.audio.reload();
    this.emitHud();
  }

  shoot() {
    if (this.mode !== 'playing' || this.shotCooldown > 0 || this.reloadRemaining > 0) return;
    if (this.state.ammo <= 0) { this.reload(); return; }
    this.shotCooldown = 0.19;
    this.state.ammo--;
    this.state.shots++;
    this.weapon.fire();
    this.audio.fire();
    const ray = this.camera.getForwardRay(100);
    // A single closest hit means a wall or crate always stops the bullet.
    const hit = this.scene.pickWithRay(ray, mesh => mesh.isEnabled() && mesh.isPickable &&
      (mesh.metadata?.solid || typeof mesh.metadata?.targetIndex === 'number'));
    if (hit?.hit && hit.pickedMesh) {
      const index = hit.pickedMesh.metadata?.targetIndex;
      if (typeof index === 'number') {
        const target = this.map.targets[index];
        if (target.health > 0) {
          const headshot = !!hit.pickedMesh.metadata?.headshot;
          target.health = Math.max(0, target.health - (headshot ? 100 : 34));
          this.state.hits++;
          this.state.hitAt = performance.now();
          this.state.headshot = headshot;
          this.audio.hit(target.health === 0);
          if (target.health === 0) {
            this.state.kills++;
            target.root.setEnabled(false);
            target.respawnAt = this.time + 3;
          }
        }
      }
      if (hit.pickedPoint) this.impact(hit.pickedPoint, typeof index === 'number');
    }
    this.emitHud();
  }

  private impact(point: Vector3, target: boolean) {
    const mesh = MeshBuilder.CreateSphere('shot-impact', { diameter: target ? 0.1 : 0.065, segments: 4 }, this.scene);
    mesh.position.copyFrom(point);
    mesh.isPickable = false;
    const material = new StandardMaterial('impact-material', this.scene);
    material.emissiveColor = target ? new Color3(1, 0.65, 0.2) : new Color3(1, 0.87, 0.55);
    mesh.material = material;
    this.impacts.push({mesh, life: 0.15});
  }

  private updateCamera() {
    this.camera.position.copyFrom(this.player.position).addInPlace(new Vector3(0, 0.75, 0));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private readonly frame = () => {
    if (this.disposed) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.04);
    if (this.mode !== 'paused') this.time += dt;
    this.map.animate(this.time);
    let moving = false;
    if (this.mode === 'menu') {
      this.camera.position.set(19 + Math.sin(this.time * 0.07) * 1.5, 9.5, -21);
      this.camera.setTarget(new Vector3(-1, 3, 9));
    } else if (this.mode === 'playing') {
      this.input.update();
      const look = this.input.consumeLook();
      this.yaw += look.x;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + look.y));
      const { moveX: x, moveY: z } = this.input;
      moving = Math.abs(x) + Math.abs(z) > 0;
      const onGround = this.grounded();
      if (onGround && this.velocityY < 0) this.velocityY = 0;
      this.velocityY -= 20 * dt;
      const displacement = new Vector3(
        (Math.sin(this.yaw) * z + Math.cos(this.yaw) * x) * 5.5 * dt,
        this.velocityY * dt,
        (Math.cos(this.yaw) * z - Math.sin(this.yaw) * x) * 5.5 * dt,
      );
      this.player.moveWithCollisions(displacement);
      if (this.player.position.y < -5) this.restart();
      this.updateCamera();
      this.shotCooldown = Math.max(0, this.shotCooldown - dt);
      if (this.reloadRemaining > 0) {
        this.reloadRemaining -= dt;
        if (this.reloadRemaining <= 0) {
          const amount = Math.min(12 - this.state.ammo, this.state.reserve);
          this.state.ammo += amount;
          this.state.reserve -= amount;
          this.state.reloading = false;
          this.emitHud();
        }
      }
      for (const target of this.map.targets) {
        if (target.health <= 0 && this.time >= target.respawnAt) {
          target.health = 100; target.root.setEnabled(true);
        }
      }
    }
    this.weapon.update(this.mode === 'paused' ? 0 : dt, moving, this.state.reloading);
    this.impacts = this.impacts.filter(impact => {
      impact.life -= dt;
      if (impact.life <= 0) { impact.mesh.dispose(false, true); return false; }
      return true;
    });
    this.scene.render();
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) { this.emitHud(); this.hudTimer = 0; }
  };

  private emitHud() {
    this.state.fps = Math.round(this.engine.getFps());
    this.state.locked = document.pointerLockElement === this.canvas;
    this.onHud({ ...this.state });
  }

  private readonly resize = () => this.engine.resize();

  dispose() {
    this.disposed = true;
    this.engine.stopRenderLoop(this.frame);
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.weapon.dispose();
    this.audio.dispose();
    this.map.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
