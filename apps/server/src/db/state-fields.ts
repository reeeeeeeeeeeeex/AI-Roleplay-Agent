import type Database from 'better-sqlite3';
import { normalizeLegacyStateCells, normalizeState } from '@new-ai-chat/contracts';

export function normalizeLegacyStateProposal<T extends { kind: string; payload: unknown; status: string }>(proposal: T): T {
  if (proposal.kind !== 'state') return proposal;
  const operations = Array.isArray(proposal.payload) ? proposal.payload : [proposal.payload];
  const payload = operations.flatMap(operation => {
    if (!operation || typeof operation !== 'object' || typeof operation.table !== 'string' || !operation.cells || typeof operation.cells !== 'object' || Array.isArray(operation.cells)) return [operation];
    const cells = normalizeLegacyStateCells(operation.table, operation.cells);
    return Object.keys(operation.cells).length && !Object.keys(cells).length ? [] : [{ ...operation, cells }];
  });
  return { ...proposal, payload, status: !payload.length && proposal.status === 'pending' ? 'rejected' : proposal.status };
}

export function migrateStateFields(database: Database.Database): void {
  if (database.prepare("SELECT 1 FROM app_settings WHERE key = 'stateFullColumnNames'").get()) return;
  database.transaction(() => {
    const updateState = database.prepare('UPDATE state_snapshots SET tables = ? WHERE id = ?');
    for (const row of database.prepare('SELECT id, tables FROM state_snapshots').all() as Array<{ id: string; tables: string }>) {
      updateState.run(JSON.stringify(normalizeState(JSON.parse(row.tables))), row.id);
    }
    const updateProposal = database.prepare('UPDATE proposals SET payload = ?, status = ?, committed_snapshot = ? WHERE id = ?');
    for (const row of database.prepare('SELECT id, kind, payload, status, committed_snapshot FROM proposals').all() as Array<{ id: string; kind: string; payload: string; status: string; committed_snapshot: string | null }>) {
      const proposal = normalizeLegacyStateProposal({ ...row, payload: JSON.parse(row.payload) });
      const checkpoint = row.committed_snapshot ? JSON.parse(row.committed_snapshot) : null;
      if (checkpoint?.before) checkpoint.before = normalizeState(checkpoint.before);
      updateProposal.run(JSON.stringify(proposal.payload), proposal.status, checkpoint ? JSON.stringify(checkpoint) : null, row.id);
    }
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('stateFullColumnNames', 'true')").run();
  })();
}

export function migrateStateStoryExperience(database: Database.Database): void {
  if (database.prepare("SELECT 1 FROM app_settings WHERE key = 'stateStoryExperienceV2'").get()) return;
  database.transaction(() => {
    const updateState = database.prepare('UPDATE state_snapshots SET tables = ?, version = 2 WHERE id = ?');
    for (const row of database.prepare('SELECT id, tables FROM state_snapshots').all() as Array<{ id: string; tables: string }>) {
      updateState.run(JSON.stringify(normalizeState(JSON.parse(row.tables))), row.id);
    }
    const updateProposal = database.prepare('UPDATE proposals SET payload = ?, status = ?, committed_snapshot = ? WHERE id = ?');
    for (const row of database.prepare('SELECT id, kind, payload, status, committed_snapshot FROM proposals').all() as Array<{ id: string; kind: string; payload: string; status: string; committed_snapshot: string | null }>) {
      const proposal = normalizeLegacyStateProposal({ ...row, payload: JSON.parse(row.payload) });
      const checkpoint = row.committed_snapshot ? JSON.parse(row.committed_snapshot) : null;
      if (checkpoint?.before) checkpoint.before = normalizeState(checkpoint.before);
      updateProposal.run(JSON.stringify(proposal.payload), proposal.status, checkpoint ? JSON.stringify(checkpoint) : null, row.id);
    }
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('stateStoryExperienceV2', 'true')").run();
  })();
}
