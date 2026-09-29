import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateRetiredOptions, retireProposalOptions } from './retired-options.js';

it('retires legacy options in snapshots, rollbacks and pending proposals without losing other facts', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE state_snapshots (tables TEXT); CREATE TABLE proposals (id TEXT, kind TEXT, payload TEXT, status TEXT, committed_snapshot TEXT);');
    const state = { global_state: [{ row_id: 1, current_location: 'Tower' }], options: [{ option_1: 'old action' }] };
    const retired = { table: 'options', op: 'updateRow', rowId: 1, cells: { option_1: 'old' } };
    const kept = { table: 'global_state', op: 'updateRow', rowId: 1, cells: { current_location: 'Garden' } };
    db.prepare('INSERT INTO state_snapshots VALUES (?)').run(JSON.stringify(state));
    const insert = db.prepare("INSERT INTO proposals VALUES (?, 'state', ?, 'pending', ?)");
    insert.run('retired', JSON.stringify(retired), JSON.stringify({ before: state, afterId: 'checkpoint' }));
    insert.run('mixed', JSON.stringify([retired, kept]), null);
    migrateRetiredOptions(db);
    migrateRetiredOptions(db);
    expect(JSON.parse((db.prepare('SELECT tables FROM state_snapshots').get() as any).tables)).toEqual({ global_state: state.global_state });
    const rows = db.prepare('SELECT * FROM proposals').all() as any[];
    expect(rows[0].status).toBe('rejected');
    expect(JSON.parse(rows[0].committed_snapshot)).toEqual({ before: { global_state: state.global_state }, afterId: 'checkpoint' });
    expect(JSON.parse(rows[1].payload)).toEqual([kept]); expect(rows[1].status).toBe('pending');
    expect(retireProposalOptions({ kind: 'state', payload: [retired, kept], status: 'pending' }).payload).toEqual([kept]);
  } finally { db.close(); }
});
