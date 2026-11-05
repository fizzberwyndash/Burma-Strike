import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { WeaponDefinition, WeaponId } from './weapons';
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
  readonly root: TransformNode;
  readonly flash: Mesh;
  readonly slide: TransformNode;
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

export type WeaponAction = 'ready' | 'holstering' | 'drawing' | 'reloading' | 'inspecting' | 'melee';
export interface WeaponViewState {
  speed: number; sprinting: boolean; ads: boolean; action: WeaponAction; progress: number;
  lookX: number; lookY: number; landing: number;
}
/** A GLB-backed implementation can replace this adapter without changing gameplay. */
export interface WeaponView {
  equip(definition: WeaponDefinition): void;
  fire(): void;
  update(dt: number, state: WeaponViewState): void;
  setVisible(visible: boolean): void;
  getMuzzlePosition(): Vector3;
  dispose(): void;
}
interface WeaponModel {
  root: TransformNode; muzzle: TransformNode; flash: Mesh | null;
  bolt?: TransformNode; magazine?: Mesh;
}
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** Procedural weapon adapter. Gameplay controls action priority; this only poses meshes. */
export class ArsenalView implements WeaponView {
  private readonly models = new Map<WeaponId, WeaponModel>();
  private readonly pistol: PistolView;
  private readonly light: PointLight;
  private readonly materials: StandardMaterial[] = [];
  private current: WeaponModel;
  private definition: WeaponDefinition | null = null;
  private visible = true;
  private recoil = 0;
  private flashTime = 0;
  private flashFresh = false;
  private clock = 0;
  private adsAmount = 0;
  private sprintAmount = 0;
  private swayX = 0;
  private swayY = 0;

  constructor(private readonly scene: Scene, camera: Camera) {
    scene.setRenderingAutoClearDepthStencil(2, true, true, true);
    this.pistol = new PistolView(scene, camera);
    const pistolMuzzle = new TransformNode('pistol-muzzle-socket', scene);
    pistolMuzzle.parent = this.pistol.root; pistolMuzzle.position.set(0, .018, .46);
    this.current = {root: this.pistol.root, muzzle: pistolMuzzle, flash: this.pistol.flash, bolt: this.pistol.slide};
    this.models.set('pistol', this.current);
    const metal = this.material('arsenal steel', '#33454b', .65);
    const polymer = this.material('arsenal graphite', '#172329', .18);
    const brass = this.material('arsenal brass', '#bb9456', .65);
    const grip = this.material('arsenal olive grip', '#34493d', .1);
    const dark = this.material('arsenal bore', '#071114', .05);
    const edge = this.material('knife honed steel', '#b2c8cb', .9);
    const flash = this.material('arsenal flash', '#ffd27a', 0);
    flash.emissiveColor = new Color3(1, .57, .12); flash.disableLighting = true;
    for (const id of ['rifle', 'smg', 'sniper', 'knife'] as const) {
      const root = new TransformNode(`${id}-first-person-view`, scene); root.parent = camera;
      const muzzle = new TransformNode(`${id}-muzzle-socket`, scene); muzzle.parent = root;
      const model: WeaponModel = {root, muzzle, flash: null};
      const box = (name: string, dimensions: number[], pos: number[], mat: StandardMaterial, parent: TransformNode = root) => {
        const mesh = MeshBuilder.CreateBox(`${id}-${name}`, {width:dimensions[0],height:dimensions[1],depth:dimensions[2]}, scene);
        mesh.parent = parent; mesh.position.set(pos[0],pos[1],pos[2]); this.finish(mesh, mat); return mesh;
      };
      const tube = (name: string, diameter: number, length: number, pos: number[], mat: StandardMaterial) => {
        const mesh = MeshBuilder.CreateCylinder(`${id}-${name}`,{diameter,height:length,tessellation:12},scene);
        mesh.parent = root; mesh.position.set(pos[0],pos[1],pos[2]); mesh.rotation.x = Math.PI/2; this.finish(mesh,mat); return mesh;
      };
      if (id === 'knife') {
        const blade = box('blade',[.075,.014,.43],[0,.015,.24],edge); blade.rotation.z = -.08;
        const tip = MeshBuilder.CreateCylinder('knife-tapered-tip',{diameterBottom:.075,diameterTop:0,height:.15,tessellation:3},scene);
        tip.parent=root;tip.rotation.x=Math.PI/2;tip.position.set(0,.015,.525);this.finish(tip,edge);
        box('spine',[.018,.02,.37],[-.033,.02,.22],metal);
        box('guard',[.18,.045,.04],[0,0,-.005],brass);
        box('handle',[.072,.065,.2],[0,-.01,-.13],grip);
        for(let i=0;i<6;i++)box(`handle-wrap-${i}`,[.078,.071,.012],[0,-.01,-.21+i*.029],polymer);
        box('pommel',[.08,.07,.025],[0,-.01,-.24],brass);
        const hand=box('gloved-hand',[.13,.16,.16],[0,-.075,-.15],grip);hand.rotation.z=-.2;
        box('sleeve',[.16,.16,.36],[.015,-.16,-.34],polymer);
        muzzle.position.set(0,.015,.59);
      } else {
        const sniper=id==='sniper',smg=id==='smg';
        const receiverLength=smg?.38:sniper?.64:.55;
        box('receiver',[.14,.15,receiverLength],[0,0,.12],metal);
        box('receiver-top',[.1,.022,receiverLength*.9],[0,.089,.12],polymer);
        box('lower-frame',[.12,.1,.36],[0,-.1,.025],polymer);
        const handle=box('pistol-grip',[.1,.23,.13],[0,-.21,-.09],grip);handle.rotation.x=-.25;
        model.magazine=box('magazine',smg?[.085,.29,.105]:[.105,.25,.17],[0,-.2,.13],polymer);
        if(!smg)model.magazine.rotation.x=.12;
        box('magazine-base',[.112,.022,smg?.11:.18],[0,-.134,.015],brass,model.magazine);
        const barrelStart=receiverLength/2+.12;
        const barrelLength=sniper?.58:smg?.17:.36;
        tube('barrel',sniper?.055:.043,barrelLength,[0,.018,barrelStart+barrelLength/2],metal);
        const end=barrelStart+barrelLength;
        tube('muzzle-brake',sniper?.083:.064,.075,[0,.018,end],polymer);
        tube('bore',.035,.078,[0,.018,end+.005],dark);
        box('handguard',[.13,.12,smg?.14:.29],[0,-.01,barrelStart+.04],grip);
        for(let i=0;i<(smg?3:6);i++)box(`rail-slot-${i}`,[.145,.018,.012],[0,.056,barrelStart-.07+i*.037],polymer);
        box('stock-arm',[.055,.055,.25],[0,-.025,-receiverLength/2-.12],metal);
        box('stock',[.12,.19,.14],[0,-.055,-receiverLength/2-.28],polymer);
        model.bolt=new TransformNode(`${id}-bolt`,scene);model.bolt.parent=root;
        box('bolt-block',[.025,.055,.13],[.082,.01,.04],dark,model.bolt);
        box('charging-handle',[.065,.025,.035],[.1,.025,-.035],brass,model.bolt);
        if(sniper){
          box('optic-mount',[.075,.065,.22],[0,.14,.1],polymer);
          tube('scope',.102,.33,[0,.23,.1],metal);
          tube('scope-front-glass',.083,.012,[0,.23,.271],dark);
          tube('scope-rear-ring',.12,.04,[0,.23,-.07],polymer);
          const dial=MeshBuilder.CreateCylinder('sniper-scope-dial',{diameter:.055,height:.06,tessellation:12},scene);dial.parent=root;dial.position.set(0,.305,.1);this.finish(dial,brass);
        }else{
          box('front-sight',[.018,.055,.025],[0,.12,barrelStart+.05],brass);
          box('rear-sight-left',[.018,.035,.035],[-.038,.12,-.09],polymer);
          box('rear-sight-right',[.018,.035,.035],[.038,.12,-.09],polymer);
        }
        box('trigger-guard',[.09,.015,.13],[0,-.19,-.005],metal);
        box('trigger',[.018,.065,.02],[0,-.15,.015],brass);
        const hand=box('trigger-hand',[.145,.17,.17],[.01,-.19,-.11],grip);hand.rotation.x=-.2;
        const forehand=box('support-hand',[.16,.13,.17],[0,-.11,barrelStart-.04],grip);forehand.rotation.z=.16;
        box('sleeve',[.17,.18,.33],[.035,-.32,-.3],polymer);
        muzzle.position.set(0,.018,end+.05);
        const flashMesh=MeshBuilder.CreateSphere(`${id}-muzzle-flash`,{diameter:sniper?.22:smg?.11:.16,segments:5},scene);
        flashMesh.parent=muzzle;flashMesh.scaling.set(.7,.7,1.9);this.finish(flashMesh,flash);flashMesh.setEnabled(false);model.flash=flashMesh;
      }
      root.setEnabled(false);this.models.set(id,model);
    }
    this.light=new PointLight('weapon-muzzle-pulse',Vector3.Zero(),scene);this.light.diffuse=new Color3(1,.55,.15);this.light.range=4;this.light.intensity=0;
    this.light.includedOnlyMeshes=this.models.size ? Array.from(this.models.values()).flatMap(model=>model.root.getChildMeshes()) : [];
  }
  private material(name:string,hex:string,specular:number){const m=new StandardMaterial(name,this.scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor=new Color3(specular,specular,specular);m.specularPower=70;this.materials.push(m);return m;}
  private finish(mesh:Mesh,material:StandardMaterial){mesh.material=material;mesh.isPickable=false;mesh.checkCollisions=false;mesh.renderingGroupId=2;}
  equip(definition:WeaponDefinition){
    this.current.root.setEnabled(false);this.current.flash?.setEnabled(false);
    this.definition=definition;this.current=this.models.get(definition.id)!;
    this.current.root.setEnabled(this.visible);this.recoil=0;this.flashTime=0;this.flashFresh=false;this.light.intensity=0;
  }
  fire(){if(this.definition?.kind==='knife')return;this.recoil=Math.min(1.6,this.recoil+.8);this.flashTime=.045;this.flashFresh=true;this.current.flash?.setEnabled(true);}
  update(dt:number,state:WeaponViewState){
    this.clock+=dt;this.recoil*=Math.exp(-dt*15);if(this.flashFresh)this.flashFresh=false;else this.flashTime=Math.max(0,this.flashTime-dt);
    this.adsAmount+=(Number(state.ads)-this.adsAmount)*(1-Math.exp(-dt*22));
    this.sprintAmount+=(Number(state.sprinting)-this.sprintAmount)*(1-Math.exp(-dt*16));
    this.swayX+=(-Math.max(-.035,Math.min(.035,state.lookX*.45))-this.swayX)*(1-Math.exp(-dt*20));
    this.swayY+=(-Math.max(-.025,Math.min(.025,state.lookY*.45))-this.swayY)*(1-Math.exp(-dt*20));
    const knife=this.definition?.kind==='knife';const sniper=this.definition?.kind==='sniper';
    const root=this.current.root;
    // The HUD supplies the scoped optic; opaque placeholder scope caps must not hide the target.
    root.setEnabled(this.visible && !(sniper && state.ads));
    const motion=Math.min(1,state.speed/5.5);
    const steady=1-this.adsAmount*.85;
    const cycle=this.clock*(state.sprinting?13:10);
    let x=(knife?.3:.29)*(1-this.adsAmount)+Math.sin(cycle)*.009*motion*steady;
    let y=(knife?-.28:-.27)+(.27-(sniper?.23:.11))*this.adsAmount+Math.cos(cycle*2)*.006*motion*steady+Math.sin(this.clock*1.8)*.0017;
    let z=(knife?.52:.55)-this.recoil*.055*(this.definition?.recoil??1);
    let rx=-this.recoil*.14*(this.definition?.recoil??1);
    let ry=this.swayX;let rz=-this.swayX*.6;
    x+=this.sprintAmount*.045;y-=this.sprintAmount*.1;rx+=this.sprintAmount*.22;ry+=this.sprintAmount*.25;rz+=this.sprintAmount*.3;
    y-=Math.min(.06,Math.max(0,state.landing)*.035);rx+=this.swayY;
    const p=ease(state.progress);
    switch(state.action){
      case 'holstering': y-=p*.62;rx+=p*.65;rz-=p*.35;break;
      case 'drawing': y-=(1-p)*.62;rx+=(1-p)*.65;rz-=(1-p)*.35;break;
      case 'reloading': {const r=Math.sin(Math.PI*p);y-=r*.16;rx-=r*.25;ry-=r*.15;rz-=r*.7;break;}
      case 'inspecting': {const r=Math.sin(Math.PI*p);x-=r*.12;y+=r*.055;rx-=r*.16;ry-=r*.65;rz+=r*.55;break;}
      case 'melee': {const windup=ease(Math.min(1,p/.25));const cut=ease(Math.max(0,(p-.25)/.45));const recover=ease(Math.max(0,(p-.7)/.3));x+=windup*.13-cut*.35+recover*.22;y+=windup*.12-cut*.18+recover*.06;z+=cut*.3-recover*.3;rx-=cut*.4-recover*.4;rz+=windup*.35-cut*1.4+recover*1.05;break;}
    }
    root.position.set(x,y,z);root.rotation.set(rx,ry,rz);
    if(this.current.bolt)this.current.bolt.position.z=-this.recoil*.04;
    if(this.current.magazine){const r=state.action==='reloading'?Math.sin(Math.PI*p):0;this.current.magazine.position.y=-.2-r*.25;this.current.magazine.rotation.z=r*.15;}
    this.current.flash?.setEnabled(this.flashTime>0&&this.visible&&state.action==='ready');
    const world=this.getMuzzlePosition();this.light.position.copyFrom(world);this.light.intensity=this.flashTime>0?1.7*(this.flashTime/.045):0;
    if(this.current.flash)this.current.flash.rotation.z=this.clock*51;
  }
  setVisible(visible:boolean){this.visible=visible;this.current.root.setEnabled(visible);if(!visible){this.light.intensity=0;this.current.flash?.setEnabled(false);}}
  getMuzzlePosition(){this.current.root.computeWorldMatrix(true);this.current.muzzle.computeWorldMatrix(true);return this.current.muzzle.getAbsolutePosition().clone();}
  dispose(){this.light.dispose();this.pistol.dispose();for(const [id,model] of this.models)if(id!=='pistol')model.root.dispose(false,false);for(const m of this.materials)m.dispose();this.models.clear();}
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

  fire(kind: WeaponId = 'pistol') {
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
    gain.gain.value = kind === 'sniper' ? .32 : kind === 'smg' ? .15 : .23;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    this.tone(kind === 'sniper' ? 105 : kind === 'smg' ? 195 : 155, kind === 'sniper' ? .23 : .13, .16, 38);
  }

  melee() { this.tone(280, .12, .08, 70); }
  equip() { this.tone(380, .045, .035, 160); }

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
