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
import { PracticeEconomy } from './economy';
import type { EconomyCommand, EconomySnapshot } from './economy';
import { ObjectiveSession } from './objectiveSession';
import { OBJECTIVE_SITES } from './objective';
import type { ObjectiveConfig, ObjectiveSnapshot, ObjectiveCommand } from './objective';
import { ObjectiveView } from './objectiveView';
import { GraphicsController } from './graphics';
import { EnvironmentAudio } from './environmentAudio';
export type { GameSettings } from './settings';

export type GameMode = 'menu' | 'playing' | 'paused';
export interface HudState {
  ammo: number; reserve: number; health: number; kills: number; shots: number; hits: number;
  fps: number; reloading: boolean; hitAt: number; headshot: boolean; locked: boolean;
  weaponId: WeaponId; weaponName: string; weaponKind: WeaponId | 'objective';
  slot: 1 | 2 | 3 | 4; primaryId: 'rifle' | 'smg' | 'sniper';
  action: WeaponAction; ads: boolean; sprinting: boolean;
  armor: number; armorType: 'light-armor' | 'heavy-armor' | null;
  credits: number; economyMode: boolean; phase: 'buy' | 'live' | 'ended'; round: number;
  economy: EconomySnapshot | null;
  objective: ObjectiveSnapshot | null; controlledId: string; objectiveEquipped: boolean;
  interactHeld: boolean; scoreboard: boolean; canInteract: boolean; interactLabel: string;
  playerPosition: {x:number;y:number;z:number};
  location: string; graphicsQuality: 'low' | 'medium' | 'high'; renderScale: number; targetFps: 30 | 60;
}
export const INITIAL_HUD: HudState = {
  ammo: 12, reserve: 48, health: 100, kills: 0, shots: 0, hits: 0,
  fps: 0, reloading: false, hitAt: 0, headshot: false, locked: false,
  weaponId: 'pistol', weaponName: 'SHWE-9', weaponKind: 'pistol', slot: 2,
  primaryId: 'rifle', action: 'ready', ads: false, sprinting: false,
  armor: 0, armorType: null, credits: 800, economyMode: false, phase: 'buy', round: 1, economy: null,
  objective: null, controlledId: 'attacker-1', objectiveEquipped: false, interactHeld: false,
  scoreboard:false, canInteract:false, interactLabel:'', playerPosition:{x:0,y:1,z:-12},
  location:'ATTACKER SPAWN', graphicsQuality:'high', renderScale:1, targetFps:60,
};

/** Owns the existing Practice scene. Input, inventory and presentation have separate lifetimes. */
export class StrikeGame {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: GameInput;
  inventory = new WeaponInventory();
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
  private economy: PracticeEconomy | null = null;
  private shopOpen = false;
  private objectiveSession: ObjectiveSession | null = null;
  private objectiveView: ObjectiveView;
  private controlledId = 'attacker-1';
  private deviceEquipped = false;
  private objectiveSequence = 0;
  private objectivePhaseKey = '';
  private graphics: GraphicsController;
  private environmentAudio: EnvironmentAudio;

  constructor(
    private canvas: HTMLCanvasElement,
    private onHud: (state: HudState) => void,
    onPause: () => void,
    settings: GameSettings,
    private onShop: (open: boolean) => void = () => {},
    private onLoading: (progress: number, label: string) => void = () => {},
  ) {
    this.onLoading(.1, 'Preparing renderer');
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.graphics = new GraphicsController(this.engine, window.matchMedia('(pointer: coarse)').matches, window.devicePixelRatio);
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.camera = new FreeCamera('player-camera', new Vector3(20, 10, -22), this.scene);
    this.camera.inputs.clear(); // All desktop and touch input belongs to GameInput.
    this.camera.minZ = 0.05;
    this.camera.maxZ = 250;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.onLoading(.45, 'Building Bagan Old City');
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
    this.objectiveView = new ObjectiveView(this.scene, this.camera);
    this.input = new GameInput(canvas, {
      onPause, onShoot: () => this.shoot(), onReload: () => this.reload(), onJump: () => this.jump(),
      onSlot: slot => this.equipSlot(slot), onPrimaryCycle: () => this.cyclePrimary(),
      onInspect: () => this.inspect(), onAds: active => this.setAds(active),
      onShop: () => this.shopOpen ? this.closeShop() : this.openShop(),
      onInteract: held => this.interact(held), onScoreboard: held => this.showScoreboard(held),
    });
    // Register ambience gestures only after the renderer and scene exist.
    // A rejected WebGL startup must not leave document listeners behind.
    this.environmentAudio = new EnvironmentAudio();
    this.configure(settings);
    this.camera.fov = this.settings.fov * Math.PI / 180;
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(this.frame);
    this.onLoading(.8, 'Preparing shaders');
    void this.scene.whenReadyAsync().then(() => {
      if (!this.disposed) this.onLoading(1, 'Ready');
    }).catch(() => { if (!this.disposed) this.onLoading(-1, 'Renderer unavailable'); });
  }

  configure(settings: GameSettings) {
    this.settings = normalizeSettings(settings);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.touchSensitivity = this.settings.touchSensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio.enabled = this.settings.sound;
    this.environmentAudio.configure(this.settings.sound);
    if (this.graphics.configure(this.settings)) this.map.configureQuality(this.graphics.quality);
    this.refreshAim();
    if (this.mode !== 'playing') this.camera.fov = this.settings.fov * Math.PI / 180;
  }

  setMode(mode: GameMode) {
    const previous = this.mode;
    this.mode = mode;
    this.input.shopEnabled = mode === 'playing' && this.objectivePhaseAllowsInput();
    this.input.active = mode === 'playing' && !this.shopOpen && this.objectivePhaseAllowsInput();
    this.weapon.setVisible(mode !== 'menu' && !this.deviceEquipped);
    if (mode === 'playing') {
      if (previous === 'menu') { this.resetPosition(); this.inventory.draw(); this.updateCamera(); }
      if (!this.shopOpen) this.input.requestPointerLock();
    } else {
      this.state.ads = false; this.state.sprinting = false;
      this.velocity.setAll(0); this.jumpBuffer = 0;
      this.input.releasePointerLock();
      if (mode === 'menu') { this.shopOpen = false; this.input.shopOpen = false; this.onShop(false); }
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
    if (this.objectiveSession) { this.rematchObjective(); return; }
    // Free Range retains its original reset. Economy resets are explicit fresh drills,
    // rather than a way to grant purchased equipment or bypass phase validation.
    if (this.economy) { this.startEconomyDrill(); return; }
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
    if (this.mode === 'menu' || this.economy?.snapshot.phase === 'ended') return;
    if (slot === 4) {
      if (!this.objectiveSession || this.inventory.busy) return;
      if (this.objectiveSession.authority.equipCore(this.controlledId, true)) {
        this.deviceEquipped = true; this.input.fireHeld = false; this.input.touchAds(false);
        this.weapon.setVisible(false); this.emitHud();
      }
      return;
    }
    const targetId = slot === 1 ? this.inventory.primaryId : slot === 2 ? 'pistol' : slot === 3 ? 'knife' : null;
    if (!targetId || !this.inventory.owns(targetId)) return;
    if (this.deviceEquipped) {
      this.holsterCore();
      if (this.inventory.activeId === targetId) { this.inventory.draw(); this.emitHud(); return; }
    }
    if (this.inventory.equipSlot(slot)) {
      const id = slot === 1 ? this.inventory.primaryId : slot === 2 ? 'pistol' : 'knife';
      this.economy?.execute({type:'equip', weaponId:id});
      this.beginSwitch();
    }
  }
  selectPrimary(id: 'rifle' | 'smg' | 'sniper') {
    if (!['rifle', 'smg', 'sniper'].includes(id)) return;
    if (this.economy && this.inventory.busy) return;
    if (!this.inventory.owns(id)) return;
    this.holsterCore();
    // A paused loadout picker may replace its choice repeatedly without advancing the world.
    if (this.mode === 'paused' && !this.economy) { this.inventory.update(10); this.inventory.update(10); }
    if (this.inventory.selectPrimary(id)) {
      this.economy?.execute({type:'equip', weaponId:id});
      this.beginSwitch();
      if (this.mode === 'paused' && !this.economy) {
        this.inventory.update(10); this.inventory.update(10);
        this.weapon.equip(this.inventory.definition); this.inventory.draw();
      }
    }
    this.emitHud();
  }
  cyclePrimary() {
    const ids = (['rifle', 'smg', 'sniper'] as const).filter(id => this.inventory.owns(id));
    if (ids.length) this.selectPrimary(ids[(ids.indexOf(this.inventory.primaryId) + 1) % ids.length]);
  }

  /** Unrestricted arsenal from previous phases, independent of the economy drill. */
  startFreePractice() {
    this.clearObjective();
    this.economy = null;
    this.shopOpen = false; this.input.shopOpen = false; this.onShop(false);
    this.inventory.setOwnership(null);
    this.restart();
  }

  startEconomyDrill() {
    this.clearObjective();
    this.economy = new PracticeEconomy();
    this.state = {...INITIAL_HUD};
    this.inventory.reset();
    this.inventory.setOwnership(this.economy.snapshot.ownedWeapons);
    this.weapon.equip(this.inventory.definition);
    this.resetPosition(); this.resetTargets(); this.updateCamera();
    // This may be called from the main menu; setMode('playing') respects the open shop.
    this.shopOpen = true; this.input.shopOpen = true; this.input.active = false;
    this.input.releasePointerLock(); this.onShop(true); this.environmentAudio.shop(true); this.emitHud();
  }

  openShop() {
    if (this.mode === 'menu') return;
    if (!this.shopOpen) this.environmentAudio.shop(true);
    this.shopOpen = true; this.input.shopOpen = true; this.input.active = false;
    this.state.ads = false; this.state.sprinting = false;
    this.velocity.setAll(0); this.jumpBuffer = 0;
    this.input.releasePointerLock(); this.onShop(true); this.emitHud();
  }

  closeShop() {
    if (this.shopOpen) this.environmentAudio.shop(false);
    this.shopOpen = false; this.input.shopOpen = false;
    this.input.active = this.mode === 'playing' && this.objectivePhaseAllowsInput();
    this.onShop(false);
    if (this.input.active) this.input.requestPointerLock();
    this.emitHud();
  }

  private syncEconomyEquipment(refill = false) {
    if (!this.economy) return;
    const snapshot = this.economy.snapshot;
    this.holsterCore();
    // Settle any existing transition before a validated shop command auto-equips.
    if (snapshot.phase === 'buy') { this.inventory.update(10); this.inventory.update(10); }
    if (refill) this.inventory.reset();
    this.inventory.setOwnership(snapshot.ownedWeapons);
    if (snapshot.phase === 'buy') { this.inventory.update(10); this.inventory.update(10); }
    if (snapshot.primaryId) this.inventory.primaryId = snapshot.primaryId;
    this.weapon.equip(this.inventory.definition);
    if (this.inventory.activeId !== snapshot.equipped) {
      this.inventory.equip(snapshot.equipped);
    }
    this.beginSwitch();
  }

  private economyCommand(command: EconomyCommand, equip = false) {
    if (!this.economy) return;
    const result = this.economy.execute(command);
    if (result.ok && equip) this.syncEconomyEquipment();
    this.emitHud();
    return result;
  }

  buyItem(itemId: string) { return this.economyCommand({type:'buy', itemId}, true); }
  sellItem(itemId: string) { return this.economyCommand({type:'sell', itemId}, true); }
  shopEquipWeapon(id: WeaponId) {
    // A live-round shop cannot be used to skip a reload or reset a weapon cooldown.
    if (this.economy?.snapshot.phase === 'live' && this.inventory.busy) return;
    return this.economyCommand({type:'equip', weaponId:id}, true);
  }

  startRound() {
    if (this.objectiveSession) return; // Objective buy phase is timed by its authority.
    if (this.economyCommand({type:'start-round'})?.ok) {
      this.environmentAudio.roundStart();
      this.resetPosition(); this.updateCamera(); this.closeShop();
    }
  }
  finishRound(outcome: 'win' | 'loss') {
    if (this.objectiveSession) return;
    if (this.economyCommand({type:'finish-round', outcome})?.ok) { this.environmentAudio.victory(outcome === 'win'); this.openShop(); }
  }
  newRound() {
    if (this.objectiveSession) { this.nextObjectiveRound(); return; }
    if (!this.economyCommand({type:'new-round'})?.ok) return;
    this.syncEconomyEquipment(true);
    this.resetPosition(); this.resetTargets(); this.updateCamera(); this.openShop();
  }
  /** A real damage path for the explicitly labeled local drill controls. */
  testDamage(amount = 40) {
    if (this.objectiveSession) { this.objectiveTestDamage(amount); return; }
    const result = this.economyCommand({type:'damage', amount});
    if (result?.ok && this.economy?.snapshot.phase === 'ended') this.openShop();
    return result;
  }

  private objectivePhaseAllowsInput() {
    const phase = this.objectiveSession?.snapshot.phase;
    return phase !== 'result' && phase !== 'transition';
  }
  private clearObjective() {
    this.interact(false);
    this.objectiveSession = null; this.deviceEquipped = false; this.objectivePhaseKey = '';
    this.inventory = new WeaponInventory();
    this.objectiveView.update(0, null, this.controlledId, false, false);
    this.state.scoreboard = false;
  }
  startObjectiveSandbox(config: Partial<ObjectiveConfig> = {}) {
    this.interact(false);
    this.objectiveSession = new ObjectiveSession(config);
    this.controlledId = 'attacker-1'; this.deviceEquipped = false; this.objectivePhaseKey = '';
    this.state = {...INITIAL_HUD};
    this.economy = this.objectiveSession.economyFor(this.controlledId);
    this.inventory = this.objectiveSession.inventoryFor(this.controlledId);
    this.resetPosition(); this.objectivePhaseChanged();
    this.shopOpen = true; this.input.shopOpen = true; this.input.active = false;
    this.input.releasePointerLock(); this.onShop(true); this.environmentAudio.shop(true); this.emitHud();
  }
  configureObjective(config: Partial<ObjectiveConfig>) { this.startObjectiveSandbox(config); }

  private objectiveIntent(type: ObjectiveCommand['type'], host = false) {
    if (!this.objectiveSession) return;
    const snapshot = this.objectiveSession.snapshot;
    const result = this.objectiveSession.authority.dispatch({
      id:`local:${snapshot.epoch}:${++this.objectiveSequence}`, epoch:snapshot.epoch, round:snapshot.round, type,
    }, this.controlledId, host);
    this.objectiveSession.sync(); return result;
  }
  interact(held: boolean) {
    if (!this.input) return;
    this.input.interactHeld = held;
    if (!this.objectiveSession) return;
    if (held && (this.mode !== 'playing' || this.shopOpen || !this.objectiveEligibility().eligible)) return;
    if (held) {
      this.input.fireHeld = false; this.input.touchAds(false);
      this.velocity.setAll(0); // Do not let residual deceleration cancel a stationary hold.
      this.objectiveSession.authority.updatePosition(this.controlledId, this.player.position);
    }
    this.objectiveIntent(held ? 'interact-start' : 'interact-stop');
    this.emitHud();
  }
  showScoreboard(held: boolean) {
    this.input.scoreboardHeld = held; this.state.scoreboard = held; this.emitHud();
  }
  nextObjectiveRound() {
    if (this.objectiveIntent('next-round', true)?.ok) this.objectivePhaseChanged();
  }
  rematchObjective() {
    if (this.objectiveIntent('rematch', true)?.ok) this.objectivePhaseChanged();
  }
  controlObjectivePlayer(id: string) {
    const session = this.objectiveSession;
    const player = session?.snapshot.players.find(p => p.id === id);
    if (!session || !player?.connected) return;
    this.interact(false); session.authority.equipCore(this.controlledId, false);
    this.deviceEquipped = false; this.controlledId = id;
    this.economy = session.economyFor(id); this.inventory = session.inventoryFor(id);
    this.player.position.set(player.position.x, player.position.y, player.position.z);
    this.player.computeWorldMatrix(true); this.velocity.setAll(0); this.velocityY = 0;
    this.pitch = 0; this.yaw = player.team === 'attackers' ? 0 : Math.PI;
    this.weapon.equip(this.inventory.definition); this.inventory.draw();
    this.weapon.setVisible(this.mode !== 'menu'); this.updateCamera(); this.emitHud();
  }
  teleportObjectiveSite(id: 'A' | 'B') {
    if (!this.objectiveSession) return;
    const site = OBJECTIVE_SITES.find(s => s.id === id);
    if (!site) return;
    this.interact(false); this.velocity.setAll(0); this.velocityY = 0;
    const s = this.objectiveSession.snapshot;
    const actor = s.players.find(p => p.id === this.controlledId);
    const center = actor?.team === 'defenders' && s.plantedSite === id && s.corePosition ? s.corePosition : site.position;
    const offsets = actor?.team === 'defenders' ? [[0,-1.25],[1.25,0],[-1.25,0],[0,1.25],[0,0]] : [[0,0],[0,-1.25],[1.25,0],[-1.25,0],[0,1.25]];
    const offset = offsets.find(([x,z]) => !s.players.some(p => p.id !== this.controlledId && p.alive && p.connected && Math.hypot(p.position.x-center.x-x,p.position.z-center.z-z) < .9)) ?? offsets[0];
    this.player.position.set(center.x+offset[0], .86, center.z+offset[1]);
    this.player.computeWorldMatrix(true);
    this.objectiveSession.authority.updatePosition(this.controlledId, this.player.position);
    this.updateCamera(); this.emitHud();
  }
  objectiveTestDamage(amount = 20) {
    const s = this.objectiveSession?.snapshot;
    if (!s) return;
    this.objectiveSession!.damage(this.controlledId, amount, `${s.epoch}:${s.round}:test:${++this.objectiveSequence}`);
    this.objectivePhaseChanged(); this.emitHud();
  }
  disconnectObjectivePlayer(id: string) {
    const s = this.objectiveSession?.snapshot;
    if (!s) return;
    this.objectiveSession!.authority.disconnect(id, `${s.epoch}:${s.round}:disconnect:${++this.objectiveSequence}`);
    this.objectiveSession!.sync(); this.objectivePhaseChanged(); this.emitHud();
  }
  private holsterCore() {
    if (!this.deviceEquipped) return;
    this.objectiveSession?.authority.equipCore(this.controlledId, false);
    this.deviceEquipped = false;
    this.weapon.setVisible(this.mode !== 'menu');
  }
  private objectiveEligibility(): {eligible:boolean;label:string} {
    const s = this.objectiveSession?.snapshot;
    const p = s?.players.find(player => player.id === this.controlledId);
    if (!s || !p?.alive || !p.connected || !['combat','planted'].includes(s.phase)) return {eligible:false,label:'OBJECTIVE UNAVAILABLE'};
    if (s.phase === 'planted') {
      const near = !!s.corePosition && Vector3.Distance(this.player.position, new Vector3(s.corePosition.x,s.corePosition.y,s.corePosition.z)) <= 2.2;
      return {eligible:p.team === 'defenders' && near, label:p.team === 'defenders' ? near ? 'DEFUSE ROYAL SIGNAL CORE' : 'APPROACH THE CORE' : 'DEFEND THE ROYAL SIGNAL CORE'};
    }
    if (p.team !== 'attackers') return {eligible:false,label:'PREVENT THE PLANT'};
    if (s.coreState === 'dropped' && s.corePosition) {
      const near = Vector3.Distance(this.player.position, new Vector3(s.corePosition.x,s.corePosition.y,s.corePosition.z)) <= 2.2;
      return {eligible:near,label:near ? 'RECOVER ROYAL SIGNAL CORE' : 'APPROACH THE DROPPED CORE'};
    }
    if (s.carrierId !== this.controlledId) return {eligible:false,label:'ONLY THE DESIGNATED CARRIER CAN PLANT'};
    if (!this.deviceEquipped) return {eligible:false,label:'EQUIP ROYAL SIGNAL CORE · 4'};
    const site = OBJECTIVE_SITES.find(site => (s.config.activeSite === 'both' || s.config.activeSite === site.id) &&
      Math.hypot(this.player.position.x-site.position.x,this.player.position.z-site.position.z) <= site.radius);
    return {eligible:!!site,label:site ? `PLANT AT ${site.id} SITE` : 'ENTER AN ACTIVE A OR B SITE'};
  }
  private objectivePhaseChanged() {
    const session = this.objectiveSession;
    if (!session) return;
    const s = session.snapshot;
    if (s.coreState !== 'carried' || s.carrierId !== this.controlledId) this.holsterCore();
    const key = `${s.epoch}:${s.round}:${s.phase}`;
    if (key === this.objectivePhaseKey) return;
    this.objectivePhaseKey = key;
    this.economy = session.economyFor(this.controlledId);
    this.inventory = session.inventoryFor(this.controlledId);
    if (s.phase === 'buy') {
      this.deviceEquipped = false;
      this.weapon.equip(this.inventory.definition);
      const player = s.players.find(p => p.id === this.controlledId)!;
      this.player.position.set(player.position.x,player.position.y,player.position.z);
      this.velocity.setAll(0); this.velocityY = 0; this.updateCamera();
      for (const target of this.map.targets) target.root.setEnabled(false);
      if (this.mode !== 'menu') this.openShop();
    } else if (s.phase === 'combat') {
      this.environmentAudio.roundStart();
      this.closeShop();
    } else if (s.phase === 'result' || s.phase === 'transition') {
      if (s.phase === 'result' && s.result) {
        const controlled = s.players.find(p => p.id === this.controlledId);
        this.environmentAudio.victory(s.result.winner === controlled?.team);
      }
      this.shopOpen = false; this.input.shopOpen = false; this.onShop(false);
      this.input.active = false; this.input.shopEnabled = false; this.input.releasePointerLock();
      this.state.ads = false; this.state.sprinting = false; this.velocity.setAll(0);
    }
    this.input.shopEnabled = this.mode === 'playing' && this.objectivePhaseAllowsInput();
    this.emitHud();
  }
  private resetTargets() {
    for (const target of this.map.targets) {
      target.health = 100; target.respawnAt = 0; target.root.setEnabled(true);
    }
  }
  private beginSwitch() {
    this.input.fireHeld = false; this.input.touchAds(false); this.state.ads = false;
    this.emitHud();
  }
  inspect() {
    if (this.mode === 'playing' && !this.shopOpen && !this.deviceEquipped && this.inventory.inspect()) {
      this.input.touchAds(false); this.emitHud();
    }
  }
  setAds(active: boolean) {
    this.input.adsHeld = this.mode === 'playing' && !this.shopOpen && !this.deviceEquipped && active;
    this.refreshAim();
  }
  private refreshAim() {
    this.state.ads = this.mode === 'playing' && !this.shopOpen && !this.deviceEquipped && this.input.adsHeld && !this.inventory.busy && this.inventory.definition.kind !== 'knife';
    this.input.aimMultiplier = this.state.ads
      ? this.settings.adsSensitivity * (this.inventory.activeId === 'sniper' ? this.settings.scopedSensitivity : 1) : 1;
  }
  private grounded() {
    const ray = new Ray(this.player.position, Vector3.Down(), 0.91);
    return !!this.scene.pickWithRay(ray, m => m !== this.player && !!m.metadata?.solid)?.hit;
  }
  jump() { if (this.mode === 'playing' && !this.shopOpen) this.jumpBuffer = .12; }
  reload() {
    if (this.mode === 'playing' && !this.shopOpen && !this.deviceEquipped && this.inventory.reload()) {
      this.input.touchAds(false); this.audio.reload(); this.emitHud();
    }
  }

  private pick(ray: Ray): PickingInfo | null {
    return this.scene.pickWithRay(ray, mesh => mesh.isEnabled() && mesh.isPickable &&
      (mesh.metadata?.solid || typeof mesh.metadata?.targetIndex === 'number' || typeof mesh.metadata?.objectiveActorId === 'string'));
  }
  shoot() {
    const objective = this.objectiveSession?.snapshot;
    const actor = objective?.players.find(p => p.id === this.controlledId);
    if (this.mode !== 'playing' || this.shopOpen || this.deviceEquipped || this.state.sprinting ||
      (objective && (!actor?.alive || !actor.connected || objective.interaction?.playerId === this.controlledId)) ||
      (this.economy && this.economy.snapshot.phase !== 'live')) return;
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
      const objectiveActorId = hit.pickedMesh.metadata?.objectiveActorId;
      if (this.objectiveSession && typeof objectiveActorId === 'string') {
        const victim = objective?.players.find(p => p.id === objectiveActorId);
        if (actor && victim?.alive && victim.team !== actor.team) {
          const headshot = !!hit.pickedMesh.metadata?.headshot;
          if (this.objectiveSession.damage(victim.id, headshot ? def.headDamage : def.damage,
            `${objective!.epoch}:${objective!.round}:shot:${++this.objectiveSequence}`, this.controlledId)) {
            this.state.hits++; this.state.hitAt = performance.now(); this.state.headshot = headshot;
            const killed = !this.objectiveSession.snapshot.players.find(p => p.id === victim.id)?.alive;
            if (killed) this.state.kills++;
            this.audio.hit(killed); this.objectivePhaseChanged();
          }
        }
      } else if (!this.objectiveSession && typeof index === 'number') {
        const target = this.map.targets[index];
        if (target.health > 0) {
          const headshot = !!hit.pickedMesh.metadata?.headshot;
          target.health = Math.max(0, target.health - (headshot ? def.headDamage : def.damage));
          this.state.hits++; this.state.hitAt = performance.now(); this.state.headshot = headshot;
          this.audio.hit(target.health === 0);
          if (target.health === 0) {
            this.state.kills++; target.root.setEnabled(false); target.respawnAt = this.time + 3;
            if (this.economy) this.economy.execute({type:'elimination', eventId:`${this.economy.snapshot.round}:${index}:${this.state.kills}`});
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
    const elapsed = Math.max(0, this.engine.getDeltaTime() / 1000);
    const dt = Math.min(elapsed, .25);
    let look = {x:0, y:0};
    let travelSpeed = 0;
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
      const objectivePlayer = this.objectiveSession?.snapshot.players.find(p => p.id === this.controlledId);
      const objectivePhase = this.objectiveSession?.snapshot.phase;
      const movementEnabled = !this.shopOpen && this.economy?.snapshot.phase !== 'ended' &&
        (!this.objectiveSession || (objectivePlayer?.alive && objectivePlayer.connected && (objectivePhase === 'combat' || objectivePhase === 'planted')));
      look = this.input.consumeLook();
      this.yaw += look.x;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + look.y));
      const steps = Math.max(1, Math.ceil(dt / .016));
      const beforeX = this.player.position.x, beforeZ = this.player.position.z;
      if (movementEnabled) for (let i = 0; i < steps; i++) this.move(dt / steps);
      travelSpeed = Math.hypot(this.player.position.x-beforeX, this.player.position.z-beforeZ) / Math.max(.0001, dt);
      if (this.player.position.y < -5) this.restart();
      this.updateCamera();
      if (this.objectiveSession) {
        this.objectiveSession.authority.updatePosition(this.controlledId, this.player.position);
        this.objectiveSession.advance(elapsed); // Trusted local clock; UI progress never completes an action.
        this.objectivePhaseChanged();
      }
      const desiredFov = (this.state.ads ? Math.min(this.settings.fov, this.inventory.definition.adsFov) : this.settings.fov) * Math.PI / 180;
      this.camera.fov += (desiredFov - this.camera.fov) * (1 - Math.exp(-18 * dt));
      if (this.input.fireHeld && this.inventory.definition.automatic) this.shoot();
      for (const target of this.objectiveSession ? [] : this.map.targets) {
        if (target.health <= 0 && this.time >= target.respawnAt) { target.health = 100; target.root.setEnabled(true); }
      }
    }
    const objectiveInteraction = this.objectiveSession?.snapshot.interaction;
    this.weapon.setVisible(this.mode !== 'menu' && !this.deviceEquipped && objectiveInteraction?.playerId !== this.controlledId);
    this.weapon.update(this.mode === 'paused' ? 0 : dt, {
      speed: this.mode === 'playing' ? this.velocity.length() : 0, sprinting: this.state.sprinting,
      ads: this.state.ads, action: this.inventory.action, progress: this.inventory.progress,
      lookX:look.x, lookY:look.y, landing:this.landing,
    });
    this.effects.update(this.mode === 'paused' ? 0 : dt);
    this.objectiveView.update(this.mode === 'paused' ? 0 : dt, this.mode === 'menu' ? null : this.objectiveSession?.snapshot ?? null,
      this.controlledId, this.deviceEquipped, this.settings.sound);
    const environmentActive = this.mode === 'playing' && !this.shopOpen && this.objectivePhaseAllowsInput();
    this.environmentAudio.update(dt, {
      active:environmentActive,
      speed:travelSpeed, sprinting:this.state.sprinting,
      grounded:environmentActive && travelSpeed > .2 && this.grounded(), surface:this.map.surfaceAt(this.player.position), position:this.player.position,
    });
    if (this.graphics.shouldRender(elapsed)) this.scene.render();
    this.hudTimer += dt;
    if (this.hudTimer > .08) { this.emitHud(); this.hudTimer = 0; }
  };

  private emitHud() {
    const w = this.inventory.definition, a = this.inventory.ammunition;
    const objective = this.objectiveSession?.snapshot ?? null;
    const controlled = objective?.players.find(p => p.id === this.controlledId);
    const account = this.economy?.snapshot ?? null;
    // Disconnection is not a damage transaction, so the round authority owns the
    // zero-health presentation for an inactive actor as well as elimination rules.
    const economy = account && controlled ? Object.freeze({...account,health:controlled.health}) : account;
    const eligibility = this.objectiveEligibility();
    Object.assign(this.state, { ammo:a.magazine, reserve:a.reserve, weaponId:w.id, weaponName:w.name,
      weaponKind:w.kind, slot:w.slot, primaryId:this.inventory.primaryId, action:this.inventory.action,
      reloading:this.inventory.action === 'reloading', fps:this.graphics.fps,
      locked:document.pointerLockElement === this.canvas, economy,
      economyMode:!!economy, credits:economy?.credits ?? 800,
      health:economy?.health ?? 100, armor:economy?.armor ?? 0, armorType:economy?.armorType ?? null,
      phase:economy?.phase ?? 'buy', round:objective?.round ?? economy?.round ?? 1,
      objective, controlledId:this.controlledId, objectiveEquipped:this.deviceEquipped,
      interactHeld:this.input.interactHeld, scoreboard:this.state.scoreboard,
      canInteract:eligibility.eligible, interactLabel:eligibility.label,
      playerPosition:{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z},
      location:this.map.locationAt(this.player.position), graphicsQuality:this.graphics.quality,
      renderScale:this.graphics.renderScale, targetFps:this.graphics.targetFps });
    if (this.deviceEquipped) Object.assign(this.state, {weaponName:'ROYAL SIGNAL CORE',weaponKind:'objective',slot:4,ammo:0,reserve:0});
    this.onHud({ ...this.state });
  }
  private readonly resize = () => this.engine.resize();
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop(this.frame);
    window.removeEventListener('resize', this.resize);
    this.input.dispose(); this.effects.dispose(); this.objectiveView.dispose(); this.weapon.dispose(); this.audio.dispose(); this.environmentAudio.dispose();
    this.map.dispose(); this.scene.dispose(); this.engine.dispose();
  }
}
