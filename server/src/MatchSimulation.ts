import { randomUUID } from 'node:crypto';
import { ObjectiveSession } from '../../src/game/objectiveSession';
import { PracticeEconomy } from '../../src/game/economy';
import { WeaponInventory, WEAPONS } from '../../src/game/weapons';
import { WorldCollision, rayPlayerHit, spawnFor, PLAYER_EYE_HEIGHT } from '../../src/shared/world';
import type { Vec3 } from '../../src/shared/world';
import type { ObjectivePlayerSnapshot, ObjectiveRosterPlayer, ObjectiveSnapshot, ObjectiveTeam } from '../../src/game/objective';
import type { MatchConfiguration, OnlineAction, OnlineInput, OnlinePlayer, OnlineRoundRecord, ShotEvent } from '../../src/network/protocol';

export interface CombatPlayer {
  id: string; name: string; team: ObjectiveTeam; position: Vec3; velocity: Vec3;
  yaw: number; pitch: number; input: OnlineInput; lastPacket: number; consumedInput: number;
  firePressed: boolean; jumpPressed: boolean; deviceEquipped: boolean;
  moving: boolean; sprinting: boolean; ads: boolean; kills: number; deaths: number;
}
const idle = (): OnlineInput => ({seq:0,moveX:0,moveY:0,yaw:0,pitch:0,sprint:false,ads:false,fire:false,jump:false});
const point = (value: Vec3) => ({x:value.x,y:value.y,z:value.z});

/** Only server code can advance this adapter. Transport accepts actions, never observations. */
export class MatchSimulation {
  readonly session: ObjectiveSession;
  readonly players = new Map<string, CombatPlayer>();
  readonly world: WorldCollision;
  private now = 0;
  private roundKey = '';
  private shotSequence = 0;
  private commandSequence = 0;
  private objectiveStarts = new Map<string, number>();
  private resultAge = 0;
  private shots: ShotEvent[] = [];
  private readonly history: OnlineRoundRecord[] = [];
  private readonly transitionLives = new Map<string, ObjectivePlayerSnapshot>();
  finished = false;

  constructor(roster: readonly ObjectiveRosterPlayer[], readonly config: MatchConfiguration, world?: WorldCollision, readonly matchId = randomUUID()) {
    this.world = world ?? new WorldCollision();
    const count = {attackers:0,defenders:0};
    const authoritativeRoster = roster.map(player => ({...player,position:spawnFor(player.team,count[player.team]++)}));
    this.session = new ObjectiveSession({activeSite:config.activeSite}, authoritativeRoster);
    for (const p of authoritativeRoster) this.players.set(p.id, {
      id:p.id,name:p.name,team:p.team,position:point(p.position),velocity:{x:0,y:0,z:0},yaw:p.team==='attackers'?0:Math.PI,pitch:0,
      input:idle(),lastPacket:-Infinity,consumedInput:0,firePressed:false,jumpPressed:false,deviceEquipped:false,
      moving:false,sprinting:false,ads:false,kills:0,deaths:0,
    });
    this.syncRound();
  }
  get snapshot(): ObjectiveSnapshot {
    const snapshot=this.session.snapshot;
    if(snapshot.phase!=='transition')return snapshot;
    // The shared rule machine prepares its next roster during transition. Keep
    // previous lives visible until the server actually enters the buy phase.
    return {...snapshot,players:snapshot.players.map(player=>{
      const previous=this.transitionLives.get(player.id);
      return previous?{...player,alive:previous.alive&&player.connected,health:player.connected?previous.health:0,
        position:{...previous.position}}:player;
    })};
  }
  /** Defensive copies keep presentation and callers from changing prior results. */
  get roundHistory(): OnlineRoundRecord[] {
    this.recordResult();
    return this.history.map(record => ({ ...record, scores: { ...record.scores } }));
  }
  getEconomy(id: string) { return this.session.economyFor(id); }
  getInventory(id: string) { return this.session.inventoryFor(id); }
  input(id: string, input: OnlineInput): boolean {
    const player = this.players.get(id);
    if (!player || input.seq <= player.input.seq) return false;
    player.firePressed ||= input.fire && !player.input.fire;
    player.jumpPressed ||= input.jump && !player.input.jump;
    player.input = {...input}; player.lastPacket = this.now;
    return true;
  }
  clearInput(id: string) {
    const player = this.players.get(id);
    if (!player) return;
    player.consumedInput=player.input.seq;
    player.input = {...idle(),seq:player.input.seq,yaw:player.yaw,pitch:player.pitch};
    player.firePressed=false;player.jumpPressed=false;player.velocity={x:0,y:0,z:0};
    player.moving=false;player.sprinting=false;player.ads=false;
    this.session.authority.interrupt(id,'Interaction released');
  }
  disconnect(id: string) {
    this.clearInput(id);
    this.session.authority.disconnect(id,`disconnect:${this.snapshot.epoch}:${++this.commandSequence}`);
    this.session.sync();
    const snapshot=this.session.snapshot;
    if(snapshot.phase==='result'||snapshot.phase==='transition'){
      // Presence can change after the result was recorded. Keep the projected
      // life dead through transition instead of reviving its earlier cache.
      const disconnected=snapshot.players.find(player=>player.id===id);
      if(disconnected)this.transitionLives.set(id,{...disconnected,
        position:point(this.players.get(id)?.position??disconnected.position)});
    }
    this.recordResult();
  }
  reconnect(id: string) { this.clearInput(id);const player=this.players.get(id);if(player)player.lastPacket=-Infinity;this.session.authority.reconnect(id); }

  action(id: string, action: OnlineAction): {ok:boolean;message:string} {
    const player=this.players.get(id), actor=this.snapshot.players.find(p=>p.id===id);
    if (!player || !actor?.connected || !actor.alive || this.finished || ['result','transition'].includes(this.snapshot.phase)) return {ok:false,message:'Player cannot act in the current round.'};
    const inventory=this.getInventory(id), economy=this.getEconomy(id);
    const unavailable = () => ({ok:false,message:'Weapon action is unavailable.'});
    switch(action.type) {
      case 'buy': case 'sell': {
        if(this.snapshot.phase!=='buy')return {ok:false,message:'Purchases and refunds require the buy phase.'};
        if(inventory.busy)return {ok:false,message:'Wait until the weapon action completes.'};
        const response=economy.execute({type:action.type,itemId:action.itemId});
        if(response.ok){
          inventory.setOwnership(economy.snapshot.ownedWeapons);
          if(economy.snapshot.primaryId)inventory.primaryId=economy.snapshot.primaryId;
          if(action.type==='buy' && economy.snapshot.equipped!==inventory.activeId)inventory.equip(economy.snapshot.equipped);
          this.session.authority.equipCore(id,false);player.deviceEquipped=false;
        }
        return response;
      }
      case 'equip': {
        if(inventory.busy)return unavailable();
        if(action.slot===4){
          const ok=this.session.authority.equipCore(id,true);
          if(ok){player.deviceEquipped=true;player.firePressed=false;player.ads=false;}
          return {ok,message:ok?'Royal Signal Core equipped.':'The objective device is not carried.'};
        }
        this.session.authority.equipCore(id,false);player.deviceEquipped=false;
        const target=action.slot===1?inventory.primaryId:action.slot===2?'pistol':'knife';
        if(!inventory.owns(target))return {ok:false,message:'You do not own that weapon.'};
        if(inventory.activeId===target)return {ok:true,message:'Weapon already equipped.'};
        const ok=inventory.equipSlot(action.slot);
        if(ok)economy.execute({type:'equip',weaponId:target});
        return {ok,message:ok?'Weapon switching.':'Weapon action is unavailable.'};
      }
      case 'select-primary': {
        if(!inventory.owns(action.weaponId) || inventory.busy)return unavailable();
        this.session.authority.equipCore(id,false);player.deviceEquipped=false;
        const ok=inventory.selectPrimary(action.weaponId);
        if(ok)economy.execute({type:'equip',weaponId:action.weaponId});
        return {ok,message:ok?'Primary weapon selected.':'Weapon action is unavailable.'};
      }
      case 'reload': return !player.deviceEquipped && inventory.reload()?{ok:true,message:'Reloading.'}:unavailable();
      case 'inspect': return !player.deviceEquipped && inventory.inspect()?{ok:true,message:'Inspecting weapon.'}:unavailable();
      case 'interact': {
        // The offline authority's receipt ledger is bounded per round. Online
        // peers must not exhaust that shared ledger and deny another team's
        // defuse: ten seats may contribute at most 320 start receipts together.
        const snapshot=this.snapshot;
        if(action.round!==snapshot.round)return {ok:false,message:'Stale round'};
        if(action.epoch!==snapshot.epoch)return {ok:false,message:'Stale round generation'};
        if(!action.held){
          this.session.authority.interrupt(id,'Interaction released');
          return {ok:true,message:'Interaction stopped'};
        }
        const starts=this.objectiveStarts.get(id)??0;
        if(starts>=32)return {ok:false,message:'Device interaction limit reached for this round.'};
        this.objectiveStarts.set(id,starts+1);
        if(action.held && this.snapshot.interaction?.playerId!==id){if(Math.hypot(player.input.moveX,player.input.moveY)<.001){player.velocity.x=0;player.velocity.z=0;}player.firePressed=false;}
        return this.session.authority.dispatch({id:`${id}:${++this.commandSequence}`,type:'interact-start',round:action.round,epoch:action.epoch},id);
      }
      default:return {ok:false,message:'This action is only available in the lobby.'};
    }
  }
  /** Trusted server observation; intentionally absent from the network action union. */
  setPosition(id:string, position:Vec3) {
    const player=this.players.get(id);
    if(!player || ![position.x,position.y,position.z].every(Number.isFinite))return;
    player.position=point(position);player.velocity={x:0,y:0,z:0};
    this.session.authority.updatePosition(id,player.position);
  }
  step(dt:number) {
    if(!Number.isFinite(dt)||dt<=0||this.finished)return;
    // A fixed server step controls physics. A delayed event loop cannot manufacture speed.
    const step=Math.min(dt,.05);this.now+=step;
    this.syncRound();
    const before=this.snapshot;
    this.recordResult();
    if(before.phase==='result'){
      this.resultAge+=step;
      if(before.round>=this.config.rounds){this.finished=true;return;}
      if(this.resultAge>=6){
        const host=before.players[0];
        this.session.authority.dispatch({id:`server-next:${before.epoch}`,type:'next-round',round:before.round,epoch:before.epoch},host.id,true);
        this.resultAge=0;
      }
    }else{
      this.resultAge=0;
      for(const player of this.players.values())this.stepPlayer(player,step);
      this.session.advance(step);
    }
    this.session.sync();this.recordResult();this.syncRound();
  }
  private recordResult() {
    const snapshot=this.snapshot;
    if(!snapshot.result)return;
    const id=`${this.matchId}:${snapshot.epoch}:${snapshot.result.id}`;
    if(this.history.some(record=>record.id===id))return;
    this.transitionLives.clear();
    for(const player of snapshot.players)this.transitionLives.set(player.id,{...player,position:{...player.position}});
    this.history.push({id,round:snapshot.round,winner:snapshot.result.winner,reason:snapshot.result.reason,
      plantedSite:snapshot.plantedSite,scores:{...snapshot.scores},resolvedAt:Date.now()});
    if(this.history.length>30)this.history.shift();
  }
  private syncRound() {
    const s=this.snapshot,key=`${s.epoch}:${s.round}`;
    if(key===this.roundKey || s.phase==='transition')return;
    this.roundKey=key;
    this.objectiveStarts.clear();
    for(const actor of s.players){
      const player=this.players.get(actor.id)!;
      player.position=point(actor.position);player.velocity={x:0,y:0,z:0};
      player.yaw=player.team==='attackers'?0:Math.PI;player.pitch=0;player.deviceEquipped=false;
      this.clearInput(actor.id);
    }
  }
  private stepPlayer(player:CombatPlayer,dt:number) {
    const actor=this.snapshot.players.find(p=>p.id===player.id)!;
    const inventory=this.getInventory(player.id);
    inventory.update(dt);
    if(!actor.alive||!actor.connected||['result','transition'].includes(this.snapshot.phase)){
      this.clearInput(player.id);return;
    }
    const fresh=this.now-player.lastPacket<=.3;
    if(!fresh){
      player.input={...idle(),seq:player.input.seq,yaw:player.yaw,pitch:player.pitch};
      player.firePressed=false;player.jumpPressed=false;
      this.session.authority.interrupt(player.id,'Interaction released');
    }
    const input=player.input;
    player.yaw=input.yaw;player.pitch=input.pitch;player.consumedInput=input.seq;
    player.ads=input.ads&&!player.deviceEquipped&&!inventory.busy&&inventory.definition.kind!=='knife';
    player.sprinting=input.sprint&&input.moveY>.1&&!player.ads&&!inventory.busy;
    const speed=player.sprinting?7.8:player.ads?3.2:5.5;
    const desired={x:(Math.sin(player.yaw)*input.moveY+Math.cos(player.yaw)*input.moveX)*speed,
      z:(Math.cos(player.yaw)*input.moveY-Math.sin(player.yaw)*input.moveX)*speed};
    const grounded=this.world.grounded(player.position);
    const dx=desired.x-player.velocity.x,dz=desired.z-player.velocity.z;
    const amount=Math.hypot(dx,dz),limit=(grounded?(Math.hypot(desired.x,desired.z)>.1?32:40):9)*dt;
    const ratio=amount>limit?limit/amount:1;
    player.velocity.x+=dx*ratio;player.velocity.z+=dz*ratio;
    if(player.jumpPressed&&grounded)player.velocity.y=6.5;
    else if(grounded&&player.velocity.y<0)player.velocity.y=0;
    player.jumpPressed=false;
    player.velocity.y=Math.max(-25,player.velocity.y-20*dt);
    const before=player.position;
    player.position=this.world.move(before,{x:player.velocity.x*dt,y:player.velocity.y*dt,z:player.velocity.z*dt});
    player.moving=Math.hypot(before.x-player.position.x,before.z-player.position.z)>.0005;
    this.session.authority.updatePosition(player.id,player.position);
    const s=this.snapshot;
    if(player.deviceEquipped&&(s.carrierId!==player.id||s.coreState!=='carried'))player.deviceEquipped=false;
    const canFire=['combat','planted'].includes(s.phase)&&!player.deviceEquipped&&!player.sprinting&&s.interaction?.playerId!==player.id;
    const trigger=inventory.definition.automatic?(input.fire||player.firePressed):player.firePressed;
    player.firePressed=false;
    if(canFire&&trigger&&inventory.fire())this.fire(player);
  }
  private fire(player:CombatPlayer) {
    const weapon=this.getInventory(player.id).definition;
    const origin={x:player.position.x,y:player.position.y+PLAYER_EYE_HEIGHT,z:player.position.z};
    const cosine=Math.cos(player.pitch);
    const direction={x:Math.sin(player.yaw)*cosine,y:-Math.sin(player.pitch),z:Math.cos(player.yaw)*cosine};
    const wall=this.world.trace(origin,direction,weapon.range);
    let distance=wall?.distance??weapon.range;
    let victim:CombatPlayer|null=null,headshot=false;
    for(const other of this.players.values()){
      const actor=this.snapshot.players.find(p=>p.id===other.id);
      if(other.id===player.id||!actor?.alive||!actor.connected)continue;
      const hit=rayPlayerHit(origin,direction,distance,other.position);
      if(hit&&hit.distance<distance){distance=hit.distance;victim=other;headshot=hit.headshot;}
    }
    let killed=false,damagedVictim:string|null=null;
    const id=++this.shotSequence;
    if(victim&&(victim.team!==player.team||this.config.friendlyFire===true)){
      const healthBefore=this.getEconomy(victim.id).snapshot.health;
      if(this.session.damage(victim.id,headshot?weapon.headDamage:weapon.damage,`shot:${this.snapshot.epoch}:${id}`,player.id)){
        damagedVictim=victim.id;
        killed=healthBefore>0&&!this.snapshot.players.find(p=>p.id===victim!.id)!.alive;
        if(killed){if(victim.team!==player.team)player.kills++;victim.deaths++;this.clearInput(victim.id);}
      }
    }
    this.shots.push({id,playerId:player.id,weaponId:weapon.id,from:origin,
      to:{x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance},
      normal:victim?{x:-direction.x,y:-direction.y,z:-direction.z}:wall?.normal??{x:0,y:1,z:0},
      surface:victim?'target':wall?.surface??'hard',victimId:damagedVictim,headshot:!!damagedVictim&&headshot,killed});
    if(this.shots.length>64)this.shots.shift();
  }
  drainShots(){const shots=this.shots;this.shots=[];return shots;}
  playerSnapshot(id:string,ready:boolean,connected:boolean):OnlinePlayer {
    const player=this.players.get(id)!,actor=this.snapshot.players.find(p=>p.id===id)!;
    const inventory=this.getInventory(id),economy=this.getEconomy(id).snapshot;
    return {id,name:player.name,team:player.team,ready,connected,position:point(player.position),yaw:player.yaw,pitch:player.pitch,
      moving:player.moving,sprinting:player.sprinting,ads:player.ads,alive:actor.alive&&connected,health:actor.alive?economy.health:0,armor:economy.armor,
      kills:player.kills,deaths:player.deaths,lastInput:player.consumedInput,deviceEquipped:player.deviceEquipped,
      inventory:{weaponId:inventory.activeId,primaryId:inventory.primaryId,action:inventory.action,progress:inventory.progress,magazine:inventory.ammunition.magazine,reserve:inventory.ammunition.reserve},
      economy:actor.alive?economy:{...economy,health:0}};
  }
  dispose(){this.world.dispose();this.shots=[];}
}

export function lobbyEquipment() {
  const economy=new PracticeEconomy(), inventory=new WeaponInventory();
  inventory.setOwnership(economy.snapshot.ownedWeapons);
  return {economy:economy.snapshot,inventory:{weaponId:inventory.activeId,primaryId:inventory.primaryId,action:'ready' as const,progress:1,magazine:0,reserve:0}};
}
