import { createApp } from './app.js';
import { spawn } from 'node:child_process';

const {app,config}=await createApp();
await app.listen({host:config.host,port:config.port});
const hostname=config.host.includes(':') ? `[${config.host}]` : config.host;
const url=`http://${hostname}:${config.port}`;
console.log(`AI Roleplay Agent: ${url}${config.fakeModel?' (offline demo)':''}`);
if (process.env.OPEN_BROWSER === '1') {
  const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
  const browser=spawn(command,[url],{detached:true,stdio:'ignore',windowsHide:true});
  browser.once('error',()=>console.log(`Open / 请打开: ${url}`));
  browser.unref();
}
for(const event of ['SIGINT','SIGTERM'] as const) process.once(event,()=>{ void app.close(); });
