import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterInputSchema, conversationInputSchema, lorebookInputSchema } from '@new-ai-chat/contracts';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migration.js';
import { Repository } from '../db/repository.js';
import { executeImport } from './importer.js';
import { scanImport } from './import-scan.js';
import { exportStory, importStory, readStoryArchive } from './story-archive.js';

let folder: string, repo: Repository;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'lorebook-test-')); repo = new Repository(createDatabase(join(folder, 'test.db'))); });
afterEach(() => { repo.database.sqlite.close(); rmSync(folder, { recursive: true, force: true }); });

it('recovers legacy lore titles once and imports Tavern titles without losing entry data', async () => {
  const legacy = { comment: '海边灯塔', name: '后备名称', key: ['灯塔'], content: '守塔人在此居住。', position: 4, depth: 3, probability: 75 };
  const book = repo.createLorebook(lorebookInputSchema.parse({ name: '旧世界书', entries: [{ keys: legacy.key, content: legacy.content, depth: legacy.depth, legacyPayload: legacy }] }));
  // Simulate the schema shipped before entry titles existed.
  repo.database.sqlite.exec('ALTER TABLE lore_entries DROP COLUMN title');
  migrateDatabase(repo.database.sqlite);
  const migrated = repo.getLorebook(book.id)!;
  expect(migrated.entries[0]).toMatchObject({ title: legacy.comment, keys: legacy.key, content: legacy.content, position: 'depth', depth: 3, legacyPayload: legacy });
  repo.updateLorebook(book.id, lorebookInputSchema.parse({ ...migrated, entries: [{ ...migrated.entries[0], title: '' }] }));
  migrateDatabase(repo.database.sqlite);
  expect(repo.getLorebook(book.id)!.entries[0]!.title).toBe('');

  const source = join(folder, 'source'); mkdirSync(join(source, 'worlds'), { recursive: true });
  const importedEntry = { ...legacy, comment: '', name: '港口' };
  writeFileSync(join(source, 'worlds', 'Coast.json'), JSON.stringify({ entries: { 0: importedEntry } }));
  const preview = await scanImport(source);
  await executeImport(repo, source, preview.preview.sourceHash, join(folder, 'assets'));
  expect(repo.listLorebooks().find(item => item.name === 'Coast')!.entries[0]).toMatchObject({ title: '港口', keys: legacy.key, depth: 3, legacyPayload: importedEntry });
});

it('round-trips lore titles in native stories and accepts older archives without titles', () => {
  const book = repo.createLorebook(lorebookInputSchema.parse({ name: '灯塔世界', entries: [{ title: '灯塔', keys: ['海岸'], content: '灯塔临海。', constant: true }] }));
  const character = repo.createCharacter(characterInputSchema.parse({ name: '旅人' }));
  const chat = repo.createConversation(conversationInputSchema.parse({ title: '旅途', kind: 'solo', characterId: character.id, lorebookIds: [book.id] }));
  const archive = readStoryArchive(exportStory(repo, chat.id, join(folder, 'assets'), 'native'));
  expect(archive.lorebooks[0]!.entries[0]!.title).toBe('灯塔');
  const copy = importStory(repo, archive, join(folder, 'assets'));
  expect(repo.getLorebook(copy.lorebookIds[0]!)!.entries[0]).toMatchObject({ title: '灯塔', content: '灯塔临海。', keys: ['海岸'], constant: true });
  const old = JSON.parse(JSON.stringify(archive)); delete old.lorebooks[0].entries[0].title;
  const oldCopy = importStory(repo, old, join(folder, 'assets'));
  expect(repo.getLorebook(oldCopy.lorebookIds[0]!)!.entries[0]!.title).toBe('');
});
