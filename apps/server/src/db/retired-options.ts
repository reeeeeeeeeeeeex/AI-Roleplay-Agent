import type Database from 'better-sqlite3';

// Import compatibility only: new state operations still reject the retired table.
export function retireProposalOptions<T extends { kind: string; payload: unknown; status: string }>(proposal: T): T {
  if (proposal.kind !== 'state') return proposal;
  const operations = Array.isArray(proposal.payload) ? proposal.payload : [proposal.payload];
  const kept = operations.filter(op => !(op && typeof op === 'object' && op.table === 'options'));
  if (kept.length === operations.length) return proposal;
  return { ...proposal, payload: kept, status: !kept.length && proposal.status === 'pending' ? 'rejected' : proposal.status };
}

export function migrateRetiredOptions(database: Database.Database): void {
  if (database.prepare("SELECT 1 FROM app_settings WHERE key = 'retiredStateOptions'").get()) return;
  database.transaction(() => {
    database.exec(`UPDATE state_snapshots SET tables = json_remove(tables, '$.options') WHERE json_valid(tables);
      UPDATE proposals SET committed_snapshot = json_remove(committed_snapshot, '$.before.options') WHERE json_valid(committed_snapshot);`);
    const rows = database.prepare("SELECT id, payload, status FROM proposals WHERE kind = 'state'").all() as Array<{ id: string; payload: string; status: string }>;
    const update = database.prepare('UPDATE proposals SET payload = ?, status = ? WHERE id = ?');
    for (const row of rows) {
      const proposal = { ...row, kind: 'state', payload: JSON.parse(row.payload) as unknown };
      const clean = retireProposalOptions(proposal);
      if (clean !== proposal) update.run(JSON.stringify(clean.payload), clean.status, row.id);
    }
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('retiredStateOptions', 'true')").run();
  })();
}
