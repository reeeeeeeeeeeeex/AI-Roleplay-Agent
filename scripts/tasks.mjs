import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const root=resolve(import.meta.dirname,'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const children=new Set();
function run(file,args=[],cwd=root,env={}) {
  return new Promise((done,reject)=>{
    const child=spawn(process.execPath,[resolve(root,file),...args],{cwd,env:{...process.env,...env},stdio:'inherit',windowsHide:true});children.add(child);
    child.once('error',reject);child.once('exit',(code)=>{children.delete(child);code===0?done():reject(new Error(`Command failed (${code}): ${file}`));});
  });
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{for(const child of children)child.kill();});
const task=process.argv[2]??'dev';
try {
  if(task==='build'||task==='typecheck') {
    for(const project of ['packages/contracts','packages/plugin-sdk','packages/agent-runtime','apps/server','apps/web']) {
      await run('node_modules/typescript/bin/tsc',['-p',`${project}/${project==='apps/web'?'tsconfig.app.json':'tsconfig.json'}`,...(task==='typecheck'?['--noEmit']:[])]);
    }
    if(task==='build')await run('apps/web/node_modules/vite/bin/vite.js',['build'],resolve(root,'apps/web'));
  } else if(task==='start')await run('apps/server/dist/index.js',[],resolve(root,'apps/server'));
  else {
    const env=task==='demo'?{FAKE_MODEL:'1',DATABASE_PATH:'./data/demo.db',ASSET_DIR:'./data/demo-assets'}:{};
    await Promise.all([
      run('apps/server/node_modules/tsx/dist/cli.mjs',['--conditions=development','watch','src/index.ts'],resolve(root,'apps/server'),env),
      run('apps/web/node_modules/vite/bin/vite.js',[],resolve(root,'apps/web')),
    ]);
  }
} catch(error) {console.error(error.message);for(const child of children)child.kill();process.exitCode=1;}
