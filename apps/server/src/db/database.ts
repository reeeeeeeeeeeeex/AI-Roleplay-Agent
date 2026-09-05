import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { migrateDatabase } from './migration.js';

export interface AppDatabase { sqlite: Database.Database; db: BetterSQLite3Database<typeof schema>; path: string }

export function createDatabase(path = process.env.DATABASE_PATH ?? './data/new-ai-chat.db'): AppDatabase {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const sqlite = new Database(absolutePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  migrateDatabase(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, path: absolutePath };
}
