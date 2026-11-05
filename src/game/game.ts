import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { buildMap } from './map';
import { GameInput } from './input';
import { ArsenalView, GameAudio } from './weapon';
import { ShotEffects } from './effects';
import { WeaponInventory } from './weapons';
import type { WeaponId, WeaponAction } from './weapons';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import type { GameSettings } from './settings';
export type { GameSettings } from './settings';

export type GameMode = 'menu' | 'playing' | 'paused';
export interface HudState {
  ammo: number; reserve: number; health: number; kills: number; shots: number; hits: number;
  fps: number; reloading: boolean; hitAt: number; headshot: boolean; locked: boolean;
  weaponId: WeaponId; weaponName: string; weaponKind: WeaponId | 'objective';
  slot: 1 | 2 | 3 | 4; primaryId: 'rifle' | 'smg' | 'sniper';
  action: WeaponAction; ads: boolean; sprinting: boolean;
}
export const INITIAL_HUD: HudState = {
  ammo: 12, reserve: 48, health: 100, kills: 0, shots: 0, hits: 0,
  fps: 0, reloading: false, hitAt: 0, headshot: false, locked: false,
  weaponId: 'pistol', weaponName: 'KITE–12', weaponKind: 'pistol', slot: 2,
  primaryId: 'rifle', action: 'ready', ads: false, sprinting: false,
};

/** Owns the existing Practice scene. Input, inventory and presentation have separate lifetimes. */
export class StrikeGame {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: GameInput;
  readonly inventory = new WeaponInventory();
  private camera: FreeCamera;
  private player: Mesh;
  private map: ReturnType<typeof buildMap>;
  private weapon: ArsenalView;
  private effects: ShotEffects;
  private audio = new GameAudio();
  private mode: GameMode = 'menu';
  private state = { ...INITIAL_HUD };
  private settings = { ...DEFAULT_SETTINGS };
  private velocityY = 0;
  private velocity = Vector3.Zero();
  private yaw = 0;
  private pitch = 0;
  private time = 0;
  private hudTimer = 0;
  private landing = 0;
  private gait = 0;
  private jumpBuffer = 0;
  private coyote = 0;
  private disposed = false;

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
    this.camera.inputs.clear(); // All desktop and touch input belongs to GameInput.
    this.camera.minZ = 0.05;
    this.camera.maxZ = 250;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.map = buildMap(this.scene);
    this.player = MeshBuilder.CreateBox('player-collider', { width: 0.64, height: 1.7, depth: 0.64 }, this.scene);
    this.player.isVisible = false;
    this.player.isPickable = false;
    this.player.ellipsoid = new Vector3(0.32, 0.85, 0.32);
    this.resetPosition();
    this.weapon = new ArsenalView(this.scene, this.camera);
    this.weapon.equip(this.inventory.definition);
    this.weapon.setVisible(false);
    this.effects = new ShotEffects(this.scene);
    this.input = new GameInput(canvas, {
      onPause, onShoot: () => this.shoot(), onReload: () => this.reload(), onJump: () => this.jump(),
      onSlot: slot => this.equipSlot(slot), onPrimaryCycle: () => this.cyclePrimary(),
      onInspect: () => this.inspect(), onAds: active => this.setAds(active),
    });
    this.configure(settings);
    this.camera.fov = this.settings.fov * Math.PI / 180;
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(this.frame);
  }

  configure(settings: GameSettings) {
    this.settings = normalizeSettings(settings);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.touchSensitivity = this.settings.touchSensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio.enabled = this.settings.sound;
    this.refreshAim();
    if (this.mode !== 'playing') this.camera.fov = this.settings.fov * Math.PI / 180;
  }

  setMode(mode: GameMode) {
    const previous = this.mode;
    this.mode = mode;
    this.input.active = mode === 'playing';
    this.weapon.setVisible(mode !== 'menu');
    if (mode === 'playing') {
      if (previous === 'menu') { this.resetPosition(); this.inventory.draw(); this.updateCamera(); }
      this.input.requestPointerLock();
    } else {
      this.state.ads = false; this.state.sprinting = false;
      this.velocity.setAll(0); this.jumpBuffer = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    this.emitHud();
  }

  private resetPosition() {
    this.yaw = 0; this.pitch = 0; this.velocityY = 0;
    this.velocity.setAll(0); this.landing = 0; this.coyote = 0; this.jumpBuffer = 0;
    this.player.position.copyFrom(this.map.spawn).subtractInPlace(new Vector3(0, 0.75, 0));
    this.player.computeWorldMatrix(true);
  }

  restart() {
    this.state = { ...INITIAL_HUD };
    this.input.touchTrigger(false); this.input.touchAds(false);
    this.inventory.reset();
    this.weapon.equip(this.inventory.definition);
    this.resetPosition();
    for (const target of this.map.targets) {
      target.health = 100; target.respawnAt = 0; target.root.setEnabled(true);
    }
    this.updateCamera(); this.emitHud();
  }

  equipSlot(slot: number) {
    if (this.mode === 'menu') return;
    if (this.inventory.equipSlot(slot)) this.beginSwitch();
  }
  selectPrimary(id: 'rifle' | 'smg' | 'sniper') {
    if (!['rifle', 'smg', 'sniper'].includes(id)) return;
    // A paused loadout picker may replace its choice repeatedly without advancing the world.
    if (this.mode === 'paused') { this.inventory.update(10); this.inventory.update(10); }
    if (this.inventory.selectPrimary(id)) {
      this.beginSwitch();
      if (this.mode === 'paused') {
        this.inventory.update(10); this.inventory.update(10);
        this.weapon.equip(this.inventory.definition); this.inventory.draw();
      }
    }
    this.emitHud();
  }
  cyclePrimary() {
    const ids = ['rifle', 'smg', 'sniper'] as const;
    this.selectPrimary(ids[(ids.indexOf(this.inventory.primaryId) + 1) % ids.length]);
  }
  private beginSwitch() {
    this.input.fireHeld = false; this.input.touchAds(false); this.state.ads = false;
    this.emitHud();
  }
  inspect() {
    if (this.mode === 'playing' && this.inventory.inspect()) {
      this.input.touchAds(false); this.emitHud();
    }
  }
  setAds(active: boolean) {
    this.input.adsHeld = this.mode === 'playing' && active;
    this.refreshAim();
  }
  private refreshAim() {
    this.state.ads = this.mode === 'playing' && this.input.adsHeld && !this.inventory.busy && this.inventory.definition.kind !== 'knife';
    this.input.aimMultiplier = this.state.ads
      ? this.settings.adsSensitivity * (this.inventory.activeId === 'sniper' ? this.settings.scopedSensitivity : 1) : 1;
  }
  private grounded() {
    const ray = new Ray(this.player.position, Vector3.Down(), 0.91);
    return !!this.scene.pickWithRay(ray, m => m !== this.player && !!m.metadata?.solid)?.hit;
  }
  jump() { if (this.mode === 'playing') this.jumpBuffer = .12; }
  reload() {
    if (this.mode === 'playing' && this.inventory.reload()) {
      this.input.touchAds(false); this.audio.reload(); this.emitHud();
    }
  }

  private pick(ray: Ray): PickingInfo | null {
    return this.scene.pickWithRay(ray, mesh => mesh.isEnabled() && mesh.isPickable &&
      (mesh.metadata?.solid || typeof mesh.metadata?.targetIndex === 'number'));
  }
  shoot() {
    if (this.mode !== 'playing' || this.state.sprinting) return;
    const def = this.inventory.definition;
    if (!this.inventory.fire()) {
      if (!this.inventory.busy && def.kind !== 'knife' && this.inventory.ammunition.magazine === 0) this.reload();
      return;
    }
    this.state.shots++;
    this.weapon.fire();
    if (def.kind === 'knife') this.audio.melee(); else this.audio.fire(def.kind);
    this.camera.getViewMatrix();
    this.camera.computeWorldMatrix();
    const ray = this.camera.getForwardRay(def.range);
    let hit = this.pick(ray);
    let end = hit?.hit && hit.pickedPoint ? hit.pickedPoint.clone() : ray.origin.add(ray.direction.scale(def.range));
    if (def.kind !== 'knife') {
      let start = this.weapon.getMuzzlePosition();
      // If the animated muzzle protrudes into cover, stop at that cover from the camera side.
      const toMuzzle = start.subtract(ray.origin);
      const close = this.pick(new Ray(ray.origin, toMuzzle.normalizeToNew(), toMuzzle.length()));
      if (close?.hit && close.pickedMesh?.metadata?.solid && close.pickedPoint) {
        hit = close; end = close.pickedPoint.clone(); start = ray.origin.clone();
      } else {
        // The cosmetic muzzle-to-hit segment has its own cover test, preserving wall occlusion.
        const travel = end.subtract(start);
        const obstruction = this.pick(new Ray(start, travel.normalizeToNew(), travel.length()));
        if (obstruction?.hit && obstruction.pickedPoint && obstruction.distance < travel.length() - .04) {
          hit = obstruction; end = obstruction.pickedPoint.clone();
        }
      }
      this.effects.shot(start, end, def);
    }
    if (hit?.hit && hit.pickedMesh && hit.pickedPoint) {
      const index = hit.pickedMesh.metadata?.targetIndex;
      if (typeof index === 'number') {
        const target = this.map.targets[index];
        if (target.health > 0) {
          const headshot = !!hit.pickedMesh.metadata?.headshot;
          target.health = Math.max(0, target.health - (headshot ? def.headDamage : def.damage));
          this.state.hits++; this.state.hitAt = performance.now(); this.state.headshot = headshot;
          this.audio.hit(target.health === 0);
          if (target.health === 0) {
            this.state.kills++; target.root.setEnabled(false); target.respawnAt = this.time + 3;
          }
        }
      }
      const normal = hit.getNormal(true) ?? Vector3.Up();
      const surface = typeof index === 'number' ? 'target' : hit.pickedMesh.name === 'courtyard ground' ? 'sand' : 'hard';
      this.effects.impact(hit.pickedPoint, normal, surface, def.kind);
    }
    this.emitHud();
  }

  private updateCamera() {
    const bob = this.settings.headBob && this.grounded() ? Math.sin(this.gait * 2) * .012 * Math.min(1, this.velocity.length() / 5) : 0;
    this.camera.position.copyFrom(this.player.position).addInPlace(new Vector3(0, .75 + bob - this.landing, 0));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private move(dt: number) {
    const {moveX:x, moveY:z} = this.input;
    const onGround = this.grounded();
    this.coyote = onGround ? .09 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocityY = 6.5; this.jumpBuffer = 0; this.coyote = 0;
    } else if (onGround && this.velocityY < 0) {
      if (this.velocityY < -3) this.landing = Math.min(.055, -this.velocityY * .006);
      this.velocityY = 0;
    }
    this.state.sprinting = this.input.sprinting && z > .1 && !this.input.adsHeld && !this.inventory.busy;
    const speed = this.state.sprinting ? 7.8 : this.state.ads ? 3.2 : 5.5;
    const desired = new Vector3((Math.sin(this.yaw)*z + Math.cos(this.yaw)*x)*speed, 0,
      (Math.cos(this.yaw)*z - Math.sin(this.yaw)*x)*speed);
    const change = desired.subtract(this.velocity);
    const maxChange = (onGround ? (desired.lengthSquared() > .01 ? 32 : 40) : 9) * dt;
    this.velocity.addInPlace(change.length() > maxChange ? change.normalize().scale(maxChange) : change);
    this.velocityY = Math.max(-25, this.velocityY - 20 * dt);
    this.player.computeWorldMatrix(true);
    this.player.moveWithCollisions(new Vector3(this.velocity.x * dt, this.velocityY * dt, this.velocity.z * dt));
    this.gait += this.velocity.length() * dt * 1.45;
    this.landing *= Math.exp(-14 * dt);
  }

  private readonly frame = () => {
    if (this.disposed) return;
    // Substep collision movement on slower devices; never scale mouse pixel deltas by dt.
    const dt = Math.min(this.engine.getDeltaTime() / 1000, .25);
    let look = {x:0, y:0};
    if (this.mode !== 'paused') this.time += dt;
    this.map.animate(this.time);
    if (this.mode === 'menu') {
      this.camera.position.set(19 + Math.sin(this.time * .07) * 1.5, 9.5, -21);
      this.camera.setTarget(new Vector3(-1, 3, 9));
    } else if (this.mode === 'playing') {
      const previousAction = this.inventory.action;
      if (this.inventory.update(dt)) this.weapon.equip(this.inventory.definition);
      if (previousAction !== this.inventory.action) this.emitHud();
      this.input.update(); this.refreshAim();
      look = this.input.consumeLook();
      this.yaw += look.x;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + look.y));
      const steps = Math.max(1, Math.ceil(dt / .016));
      for (let i = 0; i < steps; i++) this.move(dt / steps);
      if (this.player.position.y < -5) this.restart();
      this.updateCamera();
      const desiredFov = (this.state.ads ? Math.min(this.settings.fov, this.inventory.definition.adsFov) : this.settings.fov) * Math.PI / 180;
      this.camera.fov += (desiredFov - this.camera.fov) * (1 - Math.exp(-18 * dt));
      if (this.input.fireHeld && this.inventory.definition.automatic) this.shoot();
      for (const target of this.map.targets) {
        if (target.health <= 0 && this.time >= target.respawnAt) { target.health = 100; target.root.setEnabled(true); }
      }
    }
    this.weapon.update(this.mode === 'paused' ? 0 : dt, {
      speed: this.mode === 'playing' ? this.velocity.length() : 0, sprinting: this.state.sprinting,
      ads: this.state.ads, action: this.inventory.action, progress: this.inventory.progress,
      lookX:look.x, lookY:look.y, landing:this.landing,
    });
    this.effects.update(this.mode === 'paused' ? 0 : dt);
    this.scene.render();
    this.hudTimer += dt;
    if (this.hudTimer > .08) { this.emitHud(); this.hudTimer = 0; }
  };

  private emitHud() {
    const w = this.inventory.definition, a = this.inventory.ammunition;
    Object.assign(this.state, { ammo:a.magazine, reserve:a.reserve, weaponId:w.id, weaponName:w.name,
      weaponKind:w.kind, slot:w.slot, primaryId:this.inventory.primaryId, action:this.inventory.action,
      reloading:this.inventory.action === 'reloading', fps:Math.round(this.engine.getFps()),
      locked:document.pointerLockElement === this.canvas });
    this.onHud({ ...this.state });
  }
  private readonly resize = () => this.engine.resize();
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop(this.frame);
    window.removeEventListener('resize', this.resize);
    this.input.dispose(); this.effects.dispose(); this.weapon.dispose(); this.audio.dispose();
    this.map.dispose(); this.scene.dispose(); this.engine.dispose();
  }
}
