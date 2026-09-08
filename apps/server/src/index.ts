import { createApp } from './app.js';
import { spawn } from 'node:child_process';

const {app,config}=await createApp();
await app.listen({host:config.host,port:config.port});
const hostname=config.host.includes(':') ? `[${config.host}]` : config.host;
const url=`http://${hostname}:${config.port}`;
console.log(`New AI Chat: ${url}${config.fakeModel?' (offline demo)':''}`);
if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
  const browser=spawn('explorer.exe',[url],{detached:true,stdio:'ignore',windowsHide:true});
  browser.unref();
}
for(const event of ['SIGINT','SIGTERM'] as const) process.once(event,()=>{ void app.close(); });
