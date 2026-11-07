import { createGameServer } from './server';
const app=createGameServer();
await app.listen();
console.log(`BURMA STRIKE server listening on ${app.config.host}:${app.config.port}`);
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await app.shutdown();};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
