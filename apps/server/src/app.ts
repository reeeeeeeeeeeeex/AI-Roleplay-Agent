import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { FakeRuntime, PiAgentRuntime, type AgentRuntime } from '@new-ai-chat/agent-runtime';
import { TrustedPluginRegistry, type PluginRegistry } from '@new-ai-chat/plugin-sdk';
import { createDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { loadConfig, type AppConfig } from './config.js';
import { EventBroker } from './services/events.js';
import { TurnService } from './services/turns.js';
import { RecordService } from './services/records.js';
import { registerRoutes } from './routes.js';
import { seedDemo } from './demo.js';
import { InternalPluginHost } from './services/plugins.js';

const same = (a: string,b: string) => { const left=Buffer.from(a); const right=Buffer.from(b); return left.length===right.length && timingSafeEqual(left,right); };
export async function createApp(config: AppConfig = loadConfig(), runtime?: AgentRuntime, configurePlugins?: (registry: PluginRegistry) => void) {
  const app = Fastify({ bodyLimit: 2_000_000, logger: false });
  const database = createDatabase(config.databasePath); const repository = new Repository(database);
  repository.recoverInterruptedTurns(); mkdirSync(config.assetDir,{recursive:true});
  if(config.fakeModel) seedDemo(repository);
  const gateway = runtime ?? (config.fakeModel ? new FakeRuntime() : new PiAgentRuntime());
  const events = new EventBroker(repository);
  const plugins = new TrustedPluginRegistry();
  configurePlugins?.(plugins);
  const pluginHost = new InternalPluginHost(plugins, repository);
  let records: RecordService;
  const turns = new TurnService(repository,gateway,events,async (chat,signal,trace) => records.automatic(chat,signal,trace),pluginHost);
  records = new RecordService(repository,gateway,(chat,turn,signal) => turns.request(chat,turn,signal));
  app.addHook('onRequest',async (req,reply) => {
    const host = req.headers.host ?? '';
    const hostname = host.startsWith('[') ? host.slice(0,host.indexOf(']')+1) : host.split(':')[0];
    if (!config.pairingToken && !['localhost','127.0.0.1','[::1]'].includes(hostname ?? '')) return reply.code(403).send({error:'Untrusted host.'});
    const origin = req.headers.origin;
    if (origin) {
      const allowed = new Set([`http://${host}`,`https://${host}`, 'http://127.0.0.1:5173','http://localhost:5173']);
      if (!allowed.has(origin)) return reply.code(403).send({error:'Untrusted origin.'});
    }
    reply.header('X-Content-Type-Options','nosniff'); reply.header('Referrer-Policy','no-referrer');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
    if (config.pairingToken && req.url.startsWith('/api/') && !['/api/session','/api/pair'].includes(req.url)) {
      const header=req.headers.authorization?.replace(/^Bearer /u,'') ?? '';
      const cookie=req.headers.cookie?.split(';').map((v)=>v.trim()).find((v)=>v.startsWith('pair='))?.slice(5) ?? '';
      if (!same(header,config.pairingToken) && !same(cookie,config.pairingToken)) return reply.code(401).send({error:'Pair this device first.'});
    }
  });
  app.setErrorHandler((error,req,reply) => {
    const message=repository.redactError(error);
    const code=error instanceof z.ZodError ? 400 : Number((error as { statusCode?: number }).statusCode ?? 400);
    reply.code(code>=400&&code<600?code:500).send({error:message});
  });
  app.get('/api/session',async()=>({requiresPairing:Boolean(config.pairingToken),fakeModel:config.fakeModel,defaultImportPath:config.defaultImportPath}));
  app.get('/api/internal-plugins', async () => pluginHost.metadata());
  app.get('/api/conversations/:id/projections', async req => pluginHost.project(z.object({ id: z.string() }).parse(req.params).id));
  app.post('/api/pair',async(req,reply)=>{
    const { token }=z.object({token:z.string().max(1000)}).parse(req.body);
    if (!config.pairingToken || !same(token,config.pairingToken)) return reply.code(401).send({error:'Invalid pairing token.'});
    reply.header('Set-Cookie',`pair=${config.pairingToken}; HttpOnly; SameSite=Strict; Path=/`); return {paired:true};
  });
  registerRoutes(app,repository,turns,records,config);
  app.get('/api/turns/:id/events',async(req,reply)=>{
    const {id}=z.object({id:z.string()}).parse(req.params); if (!repository.getTurn(id)) return reply.code(404).send({error:'Turn not found.'});
    const after=Number(req.headers['last-event-id'] ?? (req.query as {after?:string}).after ?? 0);
    if (!Number.isSafeInteger(after)||after<0) throw new Error('Invalid event cursor.');
    reply.hijack(); reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const terminal=(type:string)=>['turn.completed','turn.failed','turn.cancelled'].includes(type);
    const send=(event:ReturnType<Repository['addEvent']>)=>{ if (!reply.raw.destroyed) reply.raw.write(`${event.id > 0 ? `id: ${event.id}\n` : ''}data: ${JSON.stringify(event)}\n\n`); };
    const prior=repository.eventsForTurn(id,after); for(const event of prior) send(event);
    const all=repository.eventsForTurn(id); if (all.some((event)=>terminal(event.type))) {reply.raw.end();return;}
    const unsubscribe=events.subscribe(id,(event)=>{ send(event); if(terminal(event.type))reply.raw.end(); });
    const snapshot=events.snapshot(id); if(snapshot) send({id:0,conversationId:repository.getTurn(id)!.conversationId,turnId:id,type:'writer.snapshot',payload:snapshot,createdAt:new Date().toISOString()});
    const heartbeat=setInterval(()=>{ if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n'); },15_000);
    reply.raw.on('close',()=>{clearInterval(heartbeat);unsubscribe();});
  });
  await app.register(fastifyStatic,{root:config.assetDir,prefix:'/api/assets/',decorateReply:false,allowedPath:(path)=>/^[a-f0-9]{64}\.(png|jpe?g|webp)$/u.test(path.replace(/^\//u,''))});
  if(existsSync(config.webDist)) {
    await app.register(fastifyStatic,{root:config.webDist,prefix:'/'});
    app.setNotFoundHandler((req,reply)=> req.url.startsWith('/api/') ? reply.code(404).send({error:'Not found.'}) : reply.sendFile('index.html'));
  }
  app.addHook('onClose',async()=>{await turns.shutdown();database.sqlite.close();});
  return { app,repository,turns,records,events,plugins,config };
}
