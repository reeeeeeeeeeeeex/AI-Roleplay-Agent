import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { characterInputSchema, conversationInputSchema, lorebookInputSchema, normalizeState } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import { scanImport, importName, type ImportFile } from './import-scan.js';

const string = (value: unknown) => typeof value === 'string' ? value : '';
function loreInput(name: string, source: any) {
  return lorebookInputSchema.parse({ name, legacyPayload: source, entries: Object.values(source.entries ?? {}).map((entry: any) => ({
    keys: entry.key ?? entry.keys ?? [], secondaryKeys: entry.selective === false ? [] : entry.keysecondary ?? entry.secondary_keys ?? [],
    content: string(entry.content), enabled: entry.disable !== true && entry.enabled !== false, constant: Boolean(entry.constant),
    order: Number.isFinite(entry.order) ? entry.order : entry.insertion_order ?? 100,
    position: entry.position === 0 || entry.position === 'before_char' ? 'before' : entry.position === 1 || entry.position === 'after_char' ? 'after' : 'depth', depth: entry.depth ?? 0, legacyPayload: entry,
  })) });
}
export async function executeImport(repository: Repository, sourcePath: string, expectedHash: string, assetDir: string) {
  const bundle = await scanImport(sourcePath);
  if (bundle.preview.sourceHash !== expectedHash) throw new Error('Source changed after preview. Scan it again.');
  if (repository.hasImport(expectedHash)) return { ...bundle.preview, alreadyImported: true };
  const assets = new Map<string, string>();
  await mkdir(assetDir, { recursive: true });
  for (const file of bundle.files.filter((f) => f.kind === 'avatar' || (f.kind === 'character' && extname(f.path).toLowerCase() === '.png'))) {
    const name = `${file.hash}${extname(file.path).toLowerCase()}`;
    try { await writeFile(join(assetDir, name), file.bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    assets.set(file.path, `/api/assets/${name}`);
  }
  return repository.database.sqlite.transaction(() => {
    const chars = new Map<string, string>(); const worlds = new Map<string, string>(); const groups = new Map<string, string>();
    const bindings = new Map<string, string[]>(); const personaNames = new Map<string, string>();
    const settings = bundle.files.find((f) => f.kind === 'settings')?.value ?? {};
    const personaSettings = settings.power_user ?? settings;
    for (const file of bundle.files.filter((f) => f.kind === 'lorebook')) {
      const known = repository.importedEntity('lorebook', file.hash);
      const book = known && repository.getLorebook(known) || repository.createLorebook(loreInput(importName(file.path), file.value));
      repository.recordImportedEntity('lorebook', file.hash, book.id); worlds.set(importName(file.path), book.id);
    }
    for (const file of bundle.files.filter((f) => f.kind === 'character')) {
      const card = file.value.data ?? file.value;
      const known = repository.importedEntity('character', file.hash);
      const character = known && repository.getCharacter(known) || repository.createCharacter(characterInputSchema.parse({ name: string(card.name) || importName(file.path),
        description: string(card.description), personality: string(card.personality), scenario: string(card.scenario), firstMessage: string(card.first_mes),
        exampleDialogue: string(card.mes_example), systemPrompt: string(card.system_prompt), postHistoryInstructions: string(card.post_history_instructions),
        avatarPath: assets.get(file.path) ?? null, legacyPayload: file.value }));
      repository.recordImportedEntity('character', file.hash, character.id);
      chars.set(basename(file.path), character.id); chars.set(importName(file.path), character.id); chars.set(character.name, character.id);
      const assigned: string[] = [];
      if (card.character_book?.entries) {
        const embedded = repository.importedEntity('embedded-lore', file.hash);
        const book = embedded && repository.getLorebook(embedded) || repository.createLorebook(loreInput(`${character.name} · 内置世界书`, card.character_book));
        repository.recordImportedEntity('embedded-lore', file.hash, book.id); assigned.push(book.id);
      }
      const world = worlds.get(card.extensions?.world); if (world) assigned.push(world);
      bindings.set(character.id, assigned);
    }
    for (const [avatar, name] of Object.entries(personaSettings.personas ?? {})) {
      const description = personaSettings.persona_descriptions?.[avatar];
      const assetFile = bundle.files.find((f) => f.kind === 'avatar' && basename(f.path) === avatar);
      const input = { name: string(name) || importName(avatar), description: string(description?.description ?? description), avatarPath: assetFile ? assets.get(assetFile.path) ?? null : null, legacyPayload: { avatar, name, description } };
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const known = repository.importedEntity('persona', fingerprint);
      const persona = known && repository.getPersona(known) || repository.createPersona(input);
      repository.recordImportedEntity('persona', fingerprint, persona.id);
      personaNames.set(persona.name, persona.id);
    }
    const resolveCharacter = (name: string) => {
      const known = chars.get(name) ?? chars.get(importName(name)); if (known) return known;
      const character = repository.createCharacter(characterInputSchema.parse({ name: name || 'Imported character' }));
      chars.set(name, character.id); bundle.preview.warnings.push(`Created placeholder for missing character: ${name}`); return character.id;
    };
    for (const file of bundle.files.filter((f) => f.kind === 'group')) {
      const known = repository.importedEntity('group', file.hash);
      const group = known && repository.getGroup(known) || repository.createGroup({ name: string(file.value.name) || importName(file.path), memberIds: (file.value.members ?? []).map((name: string) => resolveCharacter(name)), scenario: string(file.value.scenario) }, file.value);
      repository.recordImportedEntity('group', file.hash, group.id);
      groups.set(importName(file.path), group.id);
      for (const name of [file.value.chat_id, ...(file.value.chats ?? [])].filter(Boolean)) groups.set(name, group.id);
    }
    const globalWorlds = (settings.world_info_settings?.world_info?.globalSelect ?? settings.world_info?.globalSelect ?? []).flatMap((name: string) => worlds.get(name) ? [worlds.get(name)!] : []);
    for (const file of bundle.files.filter((f) => f.kind === 'chat')) {
      const known = repository.importedEntity('chat', file.hash);
      if (known && repository.getConversation(known)) continue;
      const records = file.value as any[];
      const header = records[0]?.mes === undefined ? records[0] ?? {} : {};
      const isGroup = dirname(file.path).replaceAll('\\', '/') === 'group chats';
      let groupId = isGroup ? groups.get(importName(file.path)) : null;
      const characterId = isGroup ? null : resolveCharacter(basename(dirname(file.path)));
      if (isGroup && !groupId) {
        const members = [...new Set(records.filter((r) => !r.is_user && r.name).map((r) => resolveCharacter(r.name)))];
        groupId = repository.createGroup({ name: importName(file.path), memberIds: members, scenario: '' }).id;
      }
      const chat = repository.createConversation(conversationInputSchema.parse({ title: importName(file.path), kind: isGroup ? 'group' : 'solo', characterId, groupId: groupId ?? null,
        personaId: personaNames.get(header.user_name) ?? null, lorebookIds: [...new Set([...globalWorlds, ...(characterId ? bindings.get(characterId) ?? [] : [])])],
        scenario: string(header.chat_metadata?.scenario) }));
      repository.addEvent(chat.id, null, 'legacy.chat', { ...header, sourceFile: file.path });
      let parent: string | null = null; let story = randomUUID(); let userSeen = false;
      for (const record of records.filter((r) => typeof r.mes === 'string')) {
        if (record.is_user) { story = randomUUID(); userSeen = true; }
        const turnId = String(record.extra?.story_turn_id ?? record.extra?.gen_id ?? story);
        const swipes: string[] = !record.is_user && Array.isArray(record.swipes) && record.swipes.length ? record.swipes : [record.mes];
        const selected = Math.min(Math.max(Number(record.swipe_id) || 0, 0), swipes.length - 1);
        let selectedId: string | null = null;
        for (const [index, content] of swipes.entries()) {
          const extra = index === selected ? record.extra ?? {} : record.swipe_info?.[index]?.extra ?? {};
          const speaker = record.is_user || record.is_system ? null : { kind: 'character' as const, characterId: characterId ?? resolveCharacter(record.original_avatar ?? record.name ?? 'Unknown') };
          const message = repository.createMessage({ conversationId: chat.id, parentId: parent, storyTurnId: userSeen ? turnId : null,
            role: record.is_user ? 'user' : record.is_system ? 'system' : 'assistant', authorKind: record.is_user ? 'protagonist' : record.is_system ? 'system' : 'character',
            speaker, content, providerState: null, legacyPayload: { ...record, extra } });
          repository.setHead(chat.id, message.id);
          if (typeof extra.memory === 'string') repository.createMemory({ conversationId: chat.id, stage: repository.listMemories(chat.id, 1)[0]?.stage ? repository.listMemories(chat.id, 1)[0]!.stage + 1 : 1, storyTurnId: userSeen ? turnId : null, content: extra.memory, source: 'imported' });
          if (extra.protagonist_state?.tables) {
            try { repository.createState(chat.id, userSeen ? turnId : null, normalizeState(extra.protagonist_state.tables)); }
            catch { bundle.preview.warnings.push(`State preserved as legacy data; needs repair: ${file.path}`); }
          }
          if (extra.narrative_agent) repository.addEvent(chat.id, null, 'planner.imported', { messageId: message.id, record: extra.narrative_agent, history: extra.narrative_agent_history ?? [] });
          if (index === selected) selectedId = message.id;
        }
        parent = selectedId; repository.setHead(chat.id, parent);
        if (userSeen && !record.is_user && !record.is_system) repository.addEvent(chat.id, null, 'story.settled', { storyTurnId: turnId, head: parent });
      }
      repository.recordImportedEntity('chat', file.hash, chat.id);
    }
    const report = { ...bundle.preview, alreadyImported: false };
    repository.recordImport(sourcePath, expectedHash, report); return report;
  })();
}
