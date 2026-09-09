import type Database from 'better-sqlite3';

const migration = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS imported_files (kind TEXT NOT NULL, source_hash TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(kind, source_hash));

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL,
  base_url TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '{}', temperature_milli INTEGER NOT NULL DEFAULT 800,
  max_tokens INTEGER NOT NULL DEFAULT 2048, reasoning TEXT NOT NULL DEFAULT 'off',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '', scenario TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '', example_dialogue TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '', post_history_instructions TEXT NOT NULL DEFAULT '',
  avatar_path TEXT, legacy_payload TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  avatar_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lorebooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lore_entries (
  id TEXT PRIMARY KEY, lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  keys TEXT NOT NULL DEFAULT '[]', secondary_keys TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, constant INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100, position TEXT NOT NULL DEFAULT 'depth', depth INTEGER NOT NULL DEFAULT 0,
  legacy_payload TEXT
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, member_ids TEXT NOT NULL DEFAULT '[]',
  scenario TEXT NOT NULL DEFAULT '', legacy_payload TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  lorebook_ids TEXT NOT NULL DEFAULT '[]', planner_enabled INTEGER NOT NULL DEFAULT 0,
  generation_mode TEXT NOT NULL DEFAULT 'writer-agent',
  agency_mode TEXT NOT NULL DEFAULT 'protected', narrator_name TEXT NOT NULL DEFAULT '旁白',
  narrator_avatar_path TEXT, narrator_style TEXT NOT NULL DEFAULT '', head_message_id TEXT,
  memory_turn_interval INTEGER NOT NULL DEFAULT 10, state_turn_interval INTEGER NOT NULL DEFAULT 0,
  completed_turns INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id TEXT, story_turn_id TEXT, role TEXT NOT NULL, author_kind TEXT NOT NULL,
  speaker TEXT, content TEXT NOT NULL, provider_state TEXT, generation_info TEXT, legacy_payload TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages(parent_id);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  story_turn_id TEXT NOT NULL, status TEXT NOT NULL, trigger TEXT NOT NULL, plan TEXT, error TEXT,
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_events_turn_idx ON session_events(turn_id, id);
CREATE TABLE IF NOT EXISTS turn_traces (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL, phase TEXT NOT NULL, request_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running', model TEXT NOT NULL DEFAULT '', speaker TEXT, request TEXT,
  response TEXT, tools TEXT NOT NULL DEFAULT '[]', thinking TEXT, usage TEXT, timing TEXT, error TEXT,
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS turn_traces_turn_idx ON turn_traces(turn_id, request_index);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL, story_turn_id TEXT, content TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state_snapshots (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  story_turn_id TEXT, version INTEGER NOT NULL DEFAULT 1, tables TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  story_turn_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending',
  committed_snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
  report TEXT, created_at TEXT NOT NULL
);
`;

export function migrateDatabase(database: Database.Database): void {
  database.exec(migration);
  // Additive migrations also support databases created by earlier v0.1 builds.
  for (const [table, column, definition] of [
    ['connections', 'context_window', 'INTEGER NOT NULL DEFAULT 128000'],
    ['connections', 'history_message_limit', 'INTEGER NOT NULL DEFAULT 0'],
    ['conversations', 'scenario', "TEXT NOT NULL DEFAULT ''"],
    ['conversations', 'generation_mode', "TEXT NOT NULL DEFAULT 'writer-agent'"],
    ['personas', 'legacy_payload', 'TEXT'],
    ['lorebooks', 'legacy_payload', 'TEXT'],
    ['proposals', 'origin_head', 'TEXT'],
    ['messages', 'generation_info', 'TEXT'],
    ['turn_traces', 'speaker', 'TEXT'],
    ['turn_traces', 'timing', 'TEXT'],
  ]) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  database.exec(`CREATE TABLE IF NOT EXISTS turn_traces (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL, phase TEXT NOT NULL, request_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running', model TEXT NOT NULL DEFAULT '', speaker TEXT, request TEXT,
    response TEXT, tools TEXT NOT NULL DEFAULT '[]', thinking TEXT, usage TEXT, timing TEXT, error TEXT,
    created_at TEXT NOT NULL, completed_at TEXT
  ); CREATE INDEX IF NOT EXISTS turn_traces_turn_idx ON turn_traces(turn_id, request_index);`);
}
