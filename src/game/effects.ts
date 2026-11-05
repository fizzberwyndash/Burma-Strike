import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { WeaponDefinition, WeaponId } from './weapons';

interface Tracer { mesh: Mesh; start: Vector3; direction: Vector3; distance: number; length: number; age: number; life: number; fresh: boolean; }
interface Particle { mesh: Mesh; velocity: Vector3; age: number; life: number; dust: boolean; fresh: boolean; }
/** Cosmetic effects consume the resolved raycast endpoint; they never determine damage. */
export class ShotEffects {
  private tracers: Tracer[] = [];
  private particles: Particle[] = [];
  private materials: StandardMaterial[] = [];
  private readonly tracerMaterials: Record<string, StandardMaterial>;
  private readonly dust: StandardMaterial;
  private readonly spark: StandardMaterial;
  private readonly target: StandardMaterial;
  private readonly lowDetail = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  constructor(private readonly scene: Scene) {
    this.tracerMaterials = {
      pistol: this.material('pistol tracer amber', new Color3(1,.65,.19), true),
      rifle: this.material('rifle tracer gold', new Color3(1,.78,.25), true),
      smg: this.material('smg tracer orange', new Color3(1,.5,.12), true),
      sniper: this.material('sniper tracer ivory', new Color3(1,.91,.62), true),
    };
    this.spark=this.material('hard surface sparks',new Color3(1,.63,.2),true);
    this.target=this.material('target hit glint',new Color3(.9,1,.78),true);
    this.dust=this.material('sand impact dust',new Color3(.65,.49,.29),false);
    this.dust.alpha=.65;this.dust.disableLighting=true;this.dust.emissiveColor=new Color3(.65,.49,.29);
  }
  private material(name:string,color:Color3,emissive:boolean){
    const material=new StandardMaterial(name,this.scene);material.diffuseColor=color;material.specularColor=Color3.Black();
    if(emissive){material.emissiveColor=color.scale(1.5);material.disableLighting=true;}
    this.materials.push(material);return material;
  }
  shot(start:Vector3,end:Vector3,definition:WeaponDefinition){
    if(definition.kind==='knife')return;
    const delta=end.subtract(start);const distance=delta.length();if(distance<.04)return;
    const direction=delta.scale(1/distance);
    const thickness=definition.kind==='sniper'?.018:definition.kind==='smg'?.008:.012;
    const mesh=MeshBuilder.CreateBox('cosmetic-bullet-streak',{width:thickness,height:thickness,depth:1},this.scene);
    mesh.isPickable=false;mesh.checkCollisions=false;mesh.material=this.tracerMaterials[definition.kind]??this.tracerMaterials.pistol;
    mesh.rotationQuaternion=Quaternion.FromLookDirectionLH(direction,Math.abs(direction.y)>.99?Vector3.Right():Vector3.Up());
    const tracer={mesh,start:start.clone(),direction,distance,length:Math.min(distance,definition.tracerLength),age:0,fresh:true,life:Math.max(.04,Math.min(.09,definition.tracerLife))};
    this.poseTracer(tracer);this.tracers.push(tracer);
    if(this.tracers.length>20)this.tracers.shift()!.mesh.dispose();
  }
  private poseTracer(tracer:Tracer){
    const rear=Math.min(tracer.distance,tracer.age/tracer.life*tracer.distance);
    const length=Math.min(tracer.length,tracer.distance-rear);
    tracer.mesh.scaling.z=Math.max(.001,length);
    tracer.mesh.position.copyFrom(tracer.start).addInPlace(tracer.direction.scale(rear+length/2));
  }
  impact(point:Vector3,normal:Vector3,surface:'sand'|'hard'|'target',kind:WeaponId){
    const dust=surface==='sand';const count=this.lowDetail?(dust?3:3):(dust?6:kind==='sniper'?8:5);
    for(let i=0;i<count;i++){
      const size=dust?.07+Math.random()*.09:.012+Math.random()*.017;
      const mesh=dust?MeshBuilder.CreateSphere('sand-puff',{diameter:size,segments:4},this.scene):MeshBuilder.CreateBox('impact-spark',{width:size,height:size,depth:size*3},this.scene);
      mesh.material=dust?this.dust:surface==='target'?this.target:this.spark;
      mesh.isPickable=false;mesh.checkCollisions=false;
      mesh.position.copyFrom(point).addInPlace(normal.scale(.025));
      const direction=normal.add(new Vector3((Math.random()-.5)*1.3,Math.random()*.6,(Math.random()-.5)*1.3)).normalize();
      const velocity=direction.scale(dust?.3+Math.random()*.4:1.2+Math.random()*1.8);
      this.particles.push({mesh,velocity,age:0,life:dust?.32+Math.random()*.2:.08+Math.random()*.12,dust,fresh:true});
    }
    while(this.particles.length>(this.lowDetail?48:96))this.particles.shift()!.mesh.dispose();
  }
  update(dt:number){
    this.tracers=this.tracers.filter(tracer=>{if(tracer.fresh){tracer.fresh=false;return true;}tracer.age+=dt;if(tracer.age>=tracer.life){tracer.mesh.dispose();return false;}this.poseTracer(tracer);return true;});
    this.particles=this.particles.filter(particle=>{
      if(particle.fresh){particle.fresh=false;return true;}
      particle.age+=dt;if(particle.age>=particle.life){particle.mesh.dispose();return false;}
      particle.velocity.y+=(particle.dust?.5:-5)*dt;
      particle.mesh.position.addInPlace(particle.velocity.scale(dt));
      particle.mesh.visibility=1-particle.age/particle.life;
      if(particle.dust)particle.mesh.scaling.setAll(1+particle.age*4);
      return true;
    });
  }
  dispose(){for(const tracer of this.tracers)tracer.mesh.dispose();for(const particle of this.particles)particle.mesh.dispose();this.tracers=[];this.particles=[];for(const material of this.materials)material.dispose();this.materials=[];}
}
