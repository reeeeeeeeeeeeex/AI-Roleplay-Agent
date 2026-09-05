import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';
import { blankState } from '@new-ai-chat/contracts';
import { scanImport, decodeCard } from './import-scan.js';
import { executeImport } from './importer.js';
let folder:string, source:string, repo:Repository;
const write=(file:string,content:unknown)=>{const path=join(source,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof content==='string'?content:JSON.stringify(content));};
beforeEach(()=>{folder=mkdtempSync(join(tmpdir(),'new-ai-import-'));source=join(folder,'source');mkdirSync(source);repo=new Repository(createDatabase(join(folder,'test.db')));
  write('characters/Sina.json',{spec:'chara_card_v3',data:{name:'Sina',description:'A traveller',extensions:{world:'Coast'}}});
  write('worlds/Coast.json',{entries:{0:{key:['海岸'],content:'There is a lighthouse.',disable:false,position:4,depth:0}}});
  write('settings.json',{power_user:{personas:{'user.png':'Player'},persona_descriptions:{'user.png':{description:'A protagonist'}}},api_key:'DO_NOT_IMPORT_THIS',world_info_settings:{world_info:{globalSelect:['Coast']}}});
  write('chats/Sina/story.jsonl',[
    {user_name:'Player',character_name:'Sina',chat_metadata:{}},
    {is_user:false,name:'Sina',mes:'Greeting'},
    {is_user:true,name:'Player',mes:'Hello'},
    {is_user:false,name:'Sina',mes:'Selected',swipes:['Old','Selected'],swipe_id:1,swipe_info:[{extra:{}},{extra:{memory:'Memory'}}],extra:{memory:'Memory',protagonist_state:{version:1,tables:blankState()},narrative_agent:{version:1,status:'completed'}}},
  ].map((v)=>JSON.stringify(v)).join('\n'));
});
afterEach(()=>{repo.database.sqlite.close();rmSync(folder,{recursive:true,force:true});});
describe('read-only transactional import',()=>{
  it('previews core entities and nested personas',async()=>{const result=await scanImport(source);expect(result.preview.counts).toMatchObject({characters:1,personas:1,lorebooks:1,conversations:1,memories:1,stateSnapshots:1,plannerRecords:1});expect(repo.listCharacters()).toEqual([]);});
  it('imports branches and records without changing the source',async()=>{const before=await scanImport(source);await executeImport(repo,source,before.preview.sourceHash,join(folder,'assets'));const after=await scanImport(source);expect(after.preview.files).toEqual(before.preview.files);const chat=repo.listConversations()[0]!;const branch=repo.getActiveBranch(chat.id);expect(branch.map((m)=>m.content)).toEqual(['Greeting','Hello','Selected']);expect(repo.listMessages(chat.id)).toHaveLength(4);expect(repo.listMemories(chat.id)[0]?.content).toBe('Memory');expect(repo.latestState(chat.id)?.version).toBe(1);expect(repo.listPersonas()).toHaveLength(1);expect(chat.lorebookIds).toHaveLength(1);expect(repo.events(chat.id).some((e)=>e.type==='planner.imported')).toBe(true);expect(JSON.stringify(repo.events(chat.id))).not.toContain('DO_NOT_IMPORT_THIS');expect(repo.listConnections()).toEqual([]);});
  it('is idempotent for an unchanged source hash',async()=>{const preview=(await scanImport(source)).preview;await executeImport(repo,source,preview.sourceHash,join(folder,'assets'));const result=await executeImport(repo,source,preview.sourceHash,join(folder,'assets'));expect(result.alreadyImported).toBe(true);expect(repo.listCharacters()).toHaveLength(1);expect(repo.listConversations()).toHaveLength(1);});
  it('reuses unchanged source files when the directory gains a new file', async () => {
    await executeImport(repo,source,(await scanImport(source)).preview.sourceHash,join(folder,'assets'));
    write('worlds/Another.json', { entries: {} });
    await executeImport(repo,source,(await scanImport(source)).preview.sourceHash,join(folder,'assets'));
    expect(repo.listCharacters()).toHaveLength(1); expect(repo.listConversations()).toHaveLength(1); expect(repo.listPersonas()).toHaveLength(1); expect(repo.listLorebooks()).toHaveLength(2);
  });
  it('rejects a source changed after preview',async()=>{const preview=(await scanImport(source)).preview;write('worlds/New.json',{entries:{}});await expect(executeImport(repo,source,preview.sourceHash,join(folder,'assets'))).rejects.toThrow(/Source changed/);expect(repo.listCharacters()).toEqual([]);});
  it('rolls back all SQL writes when a later import fails',async()=>{const preview=(await scanImport(source)).preview;const original=repo.createConversation.bind(repo);repo.createConversation=()=>{throw new Error('forced write failure');};await expect(executeImport(repo,source,preview.sourceHash,join(folder,'assets'))).rejects.toThrow();expect(repo.listCharacters()).toEqual([]);expect(repo.listLorebooks()).toEqual([]);expect(repo.listPersonas()).toEqual([]);repo.createConversation=original;});
  it.each(['chara','ccv3'])('reads %s PNG metadata', (tag)=>{const content=Buffer.from(JSON.stringify({spec:tag==='ccv3'?'chara_card_v3':'chara_card_v2',data:{name:'PNG card'}})).toString('base64');const payload=Buffer.from(tag+'\0'+content);const chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length,0);chunk.write('tEXt',4);payload.copy(chunk,8);const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk]);expect(decodeCard(bytes).data.name).toBe('PNG card');});
  it('rejects malformed PNG rather than interpreting arbitrary bytes',()=>{expect(()=>decodeCard(Buffer.from('invalid'))).toThrow(/signature/);});
});
describe.skipIf(!process.env.IMPORT_REAL_SOURCE)('actual local corpus acceptance',()=>{
  it('imports the selected corpus into a temporary DB and preserves every source hash',async()=>{const path=process.env.IMPORT_REAL_SOURCE!;const before=await scanImport(path);const result=await executeImport(repo,path,before.preview.sourceHash,join(folder,'actual-assets'));const after=await scanImport(path);expect(after.preview.files).toEqual(before.preview.files);expect(repo.listConversations()).toHaveLength(before.preview.counts.conversations);expect(repo.listPersonas()).toHaveLength(before.preview.counts.personas);console.log(JSON.stringify({counts:result.counts,warnings:result.warnings,sourceUnchanged:true}));},120_000);
});
