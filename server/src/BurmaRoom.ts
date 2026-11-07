import { randomBytes } from 'node:crypto';
import { Room, ServerError } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import type { SchemaType } from '@colyseus/schema';
import { NETWORK_VERSION } from '../../src/network/protocol';
import type { MatchConfiguration, OnlineAction, OnlinePlayer, OnlineSnapshot } from '../../src/network/protocol';
import type { ObjectiveTeam } from '../../src/game/objective';
import { spawnFor } from '../../src/shared/world';
import { MatchSimulation, lobbyEquipment } from './MatchSimulation';
import { validateAction, validateInput, validateUsername, TokenBucket } from './validation';
import { readConfiguration } from './config';
import type { ServerConfiguration } from './config';

export const BurmaState=schema({snapshotJson:t.string().default('')},'BurmaState');
export type BurmaState=SchemaType<typeof BurmaState>;
export interface LobbyPlayer { id:string;name:string;team:ObjectiveTeam;ready:boolean;connected:boolean;order:number; }
const codes=new Map<string,BurmaRoom>();
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const findRoomByCode=(code:string)=>codes.get(code);
const generateCode=()=>Array.from(randomBytes(6),byte=>alphabet[byte&31]).join('');

export class BurmaRoom extends Room<{state:BurmaState}> {
  state=new BurmaState();
  maxClients=10;
  maxMessagesPerSecond=120;
  protected settings:ServerConfiguration=readConfiguration();
  readonly players=new Map<string,LobbyPlayer>();
  simulation:MatchSimulation|null=null;
  code='';hostId='';
  stage:OnlineSnapshot['stage']='lobby';
  config:MatchConfiguration={mapId:'bagan-old-city',rounds:5,activeSite:'both'};
  private message='Private lobby — invite friends using your room code.';
  private order=0;
  private inputLimits=new Map<string,TokenBucket>();
  private actionLimits=new Map<string,TokenBucket>();
  private violations=new Map<string,number>();
  private publishBudget=0;
  private accumulator=0;

  async onCreate(options:unknown){
    validateUsername((options as Record<string,unknown>|null)?.username);
    if(codes.size>=this.settings.maxRooms)throw new ServerError(503,'This server has reached its private room limit.');
    do{this.code=generateCode();}while(codes.has(this.code));
    codes.set(this.code,this);
    await this.setPrivate(true);
    this.setPatchRate(50);
    this.onMessage('input',(client,payload)=>{
      if(!this.inputLimits.get(client.sessionId)?.take()){this.reject(client,'Input rate limit exceeded.');return;}
      const input=validateInput(payload);
      if(!input){this.reject(client,'Malformed input.');return;}
      if(this.stage==='match')this.simulation?.input(client.sessionId,input);
    });
    this.onMessage('action',(client,payload)=>{
      if(!this.actionLimits.get(client.sessionId)?.take()){this.reject(client,'Action rate limit exceeded.');return;}
      const action=validateAction(payload);
      if(!action){this.reject(client,'Malformed action.');return;}
      this.perform(client,action);
      this.publish();
    });
    this.onMessage('*',(client)=>this.reject(client,'Unknown message type.'));
    this.setTimestep(elapsed=>this.tick(elapsed),1000/60);
    this.publish();
  }
  onAuth(_client:Client,options:unknown){
    if(this.stage!=='lobby')throw new ServerError(409,'This match has already started. Reconnect using your saved seat.');
    validateUsername((options as Record<string,unknown>|null)?.username);
    return true;
  }
  onJoin(client:Client,options:Record<string,unknown>){
    if(this.stage!=='lobby'||this.players.size>=10)throw new ServerError(409,'This room is full or the match has already started.');
    const name=validateUsername(options?.username);
    if([...this.players.values()].some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new ServerError(409,'That display name is already in this room.');
    const attackers=[...this.players.values()].filter(p=>p.team==='attackers').length;
    const defenders=this.players.size-attackers;
    const team:ObjectiveTeam=attackers<=defenders?'attackers':'defenders';
    if((team==='attackers'?attackers:defenders)>=5)throw new ServerError(409,'Both teams are full.');
    this.players.set(client.sessionId,{id:client.sessionId,name,team,ready:false,connected:true,order:++this.order});
    this.inputLimits.set(client.sessionId,new TokenBucket(60,90));this.actionLimits.set(client.sessionId,new TokenBucket(20,25));
    if(!this.hostId)this.hostId=client.sessionId;
    this.message=`${name} joined the private lobby.`;
    this.publish();
  }
  onDrop(client:Client,code:number){
    const player=this.players.get(client.sessionId);
    if(!player)return;
    player.connected=false;player.ready=false;
    this.simulation?.disconnect(player.id);
    const rejected=[1002,1003,1007,1008,1009,4002,4008].includes(code)||(this.violations.get(player.id)??0)>=12;
    this.migrateHost();this.message=rejected?`${player.name} left the room.`:`${player.name} disconnected; their seat is reserved temporarily.`;
    this.publish();
    // Application/protocol violations are permanent removals, not recoverable
    // network drops. Otherwise reconnecting would reset every anti-abuse limit.
    if(rejected)return;
    void this.allowReconnection(client,this.settings.reconnectSeconds).catch(()=>undefined);
  }
  onReconnect(client:Client){
    const player=this.players.get(client.sessionId);
    if(!player)return;
    player.connected=true;player.ready=false;
    this.inputLimits.set(player.id,new TokenBucket(60,90));this.actionLimits.set(player.id,new TokenBucket(20,25));
    this.violations.delete(player.id);
    this.simulation?.reconnect(player.id);this.migrateHost();
    this.message=`${player.name} reconnected.`;this.publish();
  }
  onLeave(client:Client){
    const player=this.players.get(client.sessionId);
    if(!player)return;
    if(player.connected)this.simulation?.disconnect(player.id);
    player.connected=false;player.ready=false;
    if(this.stage==='lobby')this.players.delete(player.id);
    this.inputLimits.delete(player.id);this.actionLimits.delete(player.id);this.violations.delete(player.id);
    this.migrateHost();this.message=`${player.name} left the room.`;this.publish();
  }
  private migrateHost(){
    if(this.players.get(this.hostId)?.connected)return;
    this.hostId=[...this.players.values()].filter(p=>p.connected).sort((a,b)=>a.order-b.order)[0]?.id??'';
  }
  private reject(client:Client,message:string){
    const offenses=(this.violations.get(client.sessionId)??0)+1;this.violations.set(client.sessionId,offenses);
    client.send('error',{message});
    if(offenses>=12)client.leave(4008,'Too many invalid or excessive messages.');
  }
  private fail(client:Client,message:string){client.send('error',{message});}
  private perform(client:Client,action:OnlineAction){
    const player=this.players.get(client.sessionId);
    if(!player?.connected)return;
    const host=client.sessionId===this.hostId;
    if(action.type==='return-lobby'){
      if(!host){this.fail(client,'Only the host can return everyone to the lobby.');return;}
      if(this.stage==='match'){this.fail(client,'Finish the current match before returning to the lobby.');return;}
      this.simulation?.dispose();this.simulation=null;this.stage='lobby';
      for(const p of [...this.players.values()]){if(!p.connected)this.players.delete(p.id);else p.ready=false;}
      void this.unlock();this.message='Returned to the private lobby.';return;
    }
    if(this.stage==='lobby'){
      switch(action.type){
        case 'ready':player.ready=action.ready;return;
        case 'team':{
          if(!host){this.fail(client,'Only the host can switch teams.');return;}
          const target=this.players.get(action.playerId);
          if(!target){this.fail(client,'Unknown player.');return;}
          if(target.team!==action.team&&[...this.players.values()].filter(p=>p.team===action.team).length>=5){this.fail(client,'A team can contain at most five players.');return;}
          target.team=action.team;for(const p of this.players.values())p.ready=false;this.message='Teams updated. Confirm readiness again.';return;
        }
        case 'configure':
          if(!host){this.fail(client,'Only the host can configure the match.');return;}
          this.config={...action.config};for(const p of this.players.values())p.ready=false;this.message='Match settings updated. Confirm readiness again.';return;
        case 'start':{
          if(!host){this.fail(client,'Only the host can start the match.');return;}
          const connected=[...this.players.values()].filter(p=>p.connected);
          if(connected.length<2||!connected.some(p=>p.team==='attackers')||!connected.some(p=>p.team==='defenders')){this.fail(client,'At least two connected players and one player on each team are required.');return;}
          if(connected.some(p=>!p.ready)){this.fail(client,'Every connected player must be ready.');return;}
          // Reserved disconnected seats stay in the trusted roster and cannot gain a fresh life by reconnecting.
          this.simulation=new MatchSimulation([...this.players.values()],this.config);
          for(const p of this.players.values())if(!p.connected)this.simulation.disconnect(p.id);
          this.stage='match';
          void this.lock();this.message=connected.filter(p=>p.team==='attackers').length!==connected.filter(p=>p.team==='defenders').length?'Match started with unbalanced teams.':'Match started.';
          return;
        }
        default:this.fail(client,'Start the match before using gameplay actions.');return;
      }
    }
    if(this.stage!=='match'){this.fail(client,'The match has finished.');return;}
    const response=this.simulation!.action(player.id,action);
    if(!response.ok)this.fail(client,response.message);
  }
  private tick(milliseconds:number){
    const elapsed=Math.max(0,Math.min(.25,milliseconds/1000));
    this.accumulator=Math.min(.25,this.accumulator+elapsed);
    while(this.accumulator>=1/60){
      if(this.stage==='match'){
        this.simulation!.step(1/60);
        if(this.simulation!.finished){this.stage='finished';this.message='Match complete. The host can return everyone to the lobby.';}
      }
      this.accumulator-=1/60;
    }
    for(const shot of this.simulation?.drainShots()??[])this.broadcast('shot',shot);
    this.publishBudget+=elapsed;
    if(this.publishBudget>=.05){this.publishBudget%=.05;this.publish();}
  }
  getSnapshot():OnlineSnapshot {
    const counts={attackers:0,defenders:0};
    const players:OnlinePlayer[]=[...this.players.values()].map(player=>{
      if(this.simulation?.players.has(player.id))return this.simulation.playerSnapshot(player.id,player.ready,player.connected);
      const equipment=lobbyEquipment();
      return {...equipment,id:player.id,name:player.name,team:player.team,ready:player.ready,connected:player.connected,
        position:spawnFor(player.team,counts[player.team]++),yaw:player.team==='attackers'?0:Math.PI,pitch:0,moving:false,sprinting:false,ads:false,
        alive:true,health:100,armor:0,kills:0,deaths:0,lastInput:0,deviceEquipped:false};
    });
    return {version:NETWORK_VERSION,code:this.code,hostId:this.hostId,serverTime:Date.now(),stage:this.stage,config:{...this.config},players,
      objective:this.simulation?.snapshot??null,message:this.message};
  }
  private publish(){this.state.snapshotJson=JSON.stringify(this.getSnapshot());}
  onDispose(){if(codes.get(this.code)===this)codes.delete(this.code);this.simulation?.dispose();this.simulation=null;}
}

export function configuredRoom(settings:ServerConfiguration){
  return class ConfiguredBurmaRoom extends BurmaRoom { protected settings=settings; };
}
