import { characterInputSchema, connectionInputSchema, conversationInputSchema } from '@new-ai-chat/contracts';
import type { Repository } from './db/repository.js';
export function seedDemo(repo:Repository) {
  if(repo.listConversations().length)return;
  const sina=repo.createCharacter(characterInputSchema.parse({name:'Sina',description:'一位细心的旅人，正与你整理灯塔里留下的旧信。',personality:'温和、敏锐、珍惜承诺。',scenario:'雨夜过后，你们在灯塔一楼发现一封未署名的信。'}));
  const mara=repo.createCharacter(characterInputSchema.parse({name:'Mara',description:'守塔人，熟悉沿岸每一条航线。',personality:'沉稳、直接。'}));
  const persona=repo.createPersona({name:'旅人',description:'初次来到海岸灯塔的旅人。',avatarPath:null});
  const connection=repo.createConnection(connectionInputSchema.parse({name:'离线演示（不调用 API）',protocol:'openai-chat-completions',baseUrl:'https://example.invalid',model:'offline-demo'}));
  const group=repo.createGroup({name:'灯塔里的来信',memberIds:[sina.id,mara.id],scenario:'海边的旧灯塔，雨刚停。'});
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), connectionId: connection.id });
  repo.createConversation(conversationInputSchema.parse({title:'灯塔来信 · 单聊',kind:'solo',characterId:sina.id,personaId:persona.id}));
  repo.createConversation(conversationInputSchema.parse({title:'灯塔来信 · 群像',kind:'group',groupId:group.id,personaId:persona.id}));
}
