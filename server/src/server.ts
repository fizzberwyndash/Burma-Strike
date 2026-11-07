import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server, createEndpoint, createRouter } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_TYPE } from '../../src/network/protocol';
import { configuredRoom, findRoomByCode } from './BurmaRoom';
import { readConfiguration } from './config';
import type { ServerConfiguration } from './config';
import { TokenBucket } from './validation';

export function createGameServer(overrides:Partial<ServerConfiguration>={}) {
  const config={...readConfiguration(),...overrides};
  const httpServer=createServer();
  const allowed=(origin:string|undefined)=>!origin||config.allowedOrigins.includes(origin);
  const transport=new WebSocketTransport({server:httpServer,maxPayload:4096,pingInterval:3000,pingMaxRetries:2,
    verifyClient:(info,done)=>done(allowed(info.origin),403,'Origin is not allowed')});
  const gameServer=new Server({transport,greet:false,gracefullyShutdown:false});
  gameServer.define(ROOM_TYPE,configuredRoom(config));
  gameServer.router=createRouter({
    health:createEndpoint('/health',{method:'GET'},async()=>({ok:true,service:'burma-strike',protocol:1})),
    lookup:createEndpoint('/api/rooms/:code',{method:'GET'},async ctx=>{
      const code=ctx.params.code.toUpperCase();
      if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){ctx.setStatus(404);return {error:'Invalid room code.'};}
      const room=findRoomByCode(code);
      if(!room){ctx.setStatus(404);return {error:'No private room exists with that code.'};}
      // Lookup never enumerates rooms or exposes usernames / state.
      if(room.stage!=='lobby'){ctx.setStatus(409);return {error:'This match has started. Use your saved connection to rejoin.'};}
      if(room.players.size>=10){ctx.setStatus(409);return {error:'This room is full.'};}
      return {roomId:room.roomId};
    }),
  });
  const buckets=new Map<string,{bucket:TokenBucket;used:number}>();
  const guard=(listeners:((req:IncomingMessage,res:ServerResponse)=>void)[])=>(req:IncomingMessage,res:ServerResponse)=>{
    const origin=req.headers.origin;
    if(!allowed(origin)){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'Origin is not allowed.'}));return;}
    // Colyseus middleware also sets CORS; preserve this exact allowlist on writeHead.
    const writeHead=res.writeHead.bind(res);
    res.writeHead=((...args:Parameters<ServerResponse['writeHead']>)=>{
      res.removeHeader('Access-Control-Allow-Origin');
      if(origin){
        res.setHeader('Access-Control-Allow-Origin',origin);
        // The official SDK uses credentials:'include', including guest requests.
        // An exact allowed origin and ACAC are required on preflight and replies.
        res.setHeader('Access-Control-Allow-Credentials','true');
      }
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
      res.setHeader('Cache-Control','no-store');
      const headers=(typeof args[1]==='string'?(args as unknown[])[2]:args[1]) as Record<string,unknown>|undefined;
      if(headers&&!Array.isArray(headers)){
        for(const key of Object.keys(headers))if(key.toLowerCase()==='access-control-allow-origin')delete headers[key];
      }
      return writeHead(...args);
    }) as ServerResponse['writeHead'];
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const size=Number(req.headers['content-length']??0);
    if(size>4096){res.writeHead(413,{'content-type':'application/json'});res.end(JSON.stringify({error:'Request body is too large.'}));return;}
    const now=Date.now(),ip=req.socket.remoteAddress??'unknown';
    let record=buckets.get(ip);
    if(!record){record={bucket:new TokenBucket(3,30),used:now};buckets.set(ip,record);}
    record.used=now;
    if(!record.bucket.take(now)){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:'Too many room requests. Try again shortly.'}));return;}
    if(buckets.size>1024){for(const [key,value]of buckets)if(now-value.used>60000)buckets.delete(key);}
    // Chunked requests have no declared size. Bound the stream before passing it to the framework.
    let bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096)req.destroy();});
    for(const listener of listeners)listener.call(httpServer,req,res);
  };
  return {
    gameServer,httpServer,config,
    async listen(port=config.port,host=config.host){
      await gameServer.listen(port,host);
      const listeners=httpServer.listeners('request') as ((req:IncomingMessage,res:ServerResponse)=>void)[];
      httpServer.removeAllListeners('request');httpServer.on('request',guard(listeners));
    },
    async shutdown(){await gameServer.gracefullyShutdown(false);buckets.clear();},
  };
}
