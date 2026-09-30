import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateStateFields, migrateStateStoryExperience } from './state-fields.js';

it('migrates stored state and proposal rollback fields without inferring death', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE state_snapshots (id TEXT, tables TEXT); CREATE TABLE proposals (id TEXT, kind TEXT, payload TEXT, status TEXT, committed_snapshot TEXT);');
    const state = { global_state: [{ row_id: 1, cur_time: 'night' }], important_characters: [{ row_id: 1, name: 'Sina', is_absent: '是' }] };
    db.prepare('INSERT INTO state_snapshots VALUES (?, ?)').run('state', JSON.stringify(state));
    const insert = db.prepare("INSERT INTO proposals VALUES (?, 'state', ?, 'pending', ?)");
    insert.run('absence', JSON.stringify({ table: 'important_characters', op: 'updateRow', rowId: 1, cells: { is_absent: '是' } }), JSON.stringify({ before: state, afterId: 'state' }));
    insert.run('time', JSON.stringify({ table: 'global_state', op: 'updateRow', rowId: 1, cells: { cur_time: 'dawn' } }), null);
    migrateStateFields(db); migrateStateFields(db);
    const migrated = JSON.parse((db.prepare('SELECT tables FROM state_snapshots').get() as any).tables);
    expect(migrated.global_state[0].current_time).toBe('night');
    expect(migrated.important_characters[0].is_dead).toBe('');
    const rows = db.prepare('SELECT * FROM proposals').all() as any[];
    expect(rows[0].status).toBe('rejected');
    expect(JSON.parse(rows[0].committed_snapshot)).toEqual({ before: migrated, afterId: 'state' });
    expect(JSON.parse(rows[1].payload)[0].cells).toEqual({ current_time: 'dawn' });
  } finally { db.close(); }
});

it('migrates old protagonist history and pending proposals without changing character history', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE state_snapshots (id TEXT, tables TEXT, version INTEGER); CREATE TABLE proposals (id TEXT, kind TEXT, payload TEXT, status TEXT, committed_snapshot TEXT);');
    const old = { protagonist_info: [{ row_id: 1, past_experience: '过去的剧情' }], important_characters: [{ row_id: 1, name: '同伴', past_experience: '关系史' }] };
    db.prepare('INSERT INTO state_snapshots VALUES (?, ?, 1)').run('s1', JSON.stringify(old));
    db.prepare("INSERT INTO proposals VALUES ('p1', 'state', ?, 'pending', ?)").run(JSON.stringify([{ op: 'updateRow', table: 'protagonist_info', rowId: 1, cells: { past_experience: '成长' } }]), JSON.stringify({ before: old, afterId: null }));
    migrateStateStoryExperience(db); migrateStateStoryExperience(db);
    const row = db.prepare('SELECT * FROM state_snapshots').get() as any;
    const tables = JSON.parse(row.tables);
    expect(row.version).toBe(2);
    expect(tables.protagonist_info[0]).toMatchObject({ past_experience_in_story: '过去的剧情', past_experience_before_story: '' });
    expect(tables.important_characters[0].past_experience).toBe('关系史');
    const proposal = db.prepare('SELECT * FROM proposals').get() as any;
    expect(JSON.parse(proposal.payload)[0].cells).toEqual({ past_experience_in_story: '成长' });
    expect(JSON.parse(proposal.committed_snapshot).before.protagonist_info[0].past_experience_in_story).toBe('过去的剧情');
  } finally { db.close(); }
});
