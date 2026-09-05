import { createApp } from './app.js';
const {app,config}=await createApp();
await app.listen({host:config.host,port:config.port});
console.log(`New AI Chat: http://${config.host}:${config.port}${config.fakeModel?' (offline demo)':''}`);
for(const event of ['SIGINT','SIGTERM'] as const) process.once(event,()=>{ void app.close(); });
