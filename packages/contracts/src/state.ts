import { z } from 'zod';
import type { ProtagonistTables, StateRow, StateTableName } from './index.js';
const stateTableNames = ['global_state', 'protagonist_info', 'important_characters', 'protagonist_skills', 'inventory', 'quests_events'] as const;

// Public data columns retained for interoperable snapshots; executor is implemented independently.
export const stateColumns: Record<StateTableName, string[]> = {
  global_state: ['current_location', 'current_time', 'previous_scene_time', 'elapsed_time'],
  protagonist_info: ['character_name', 'gender_age', 'appearance', 'occupation', 'past_experience', 'personality'],
  important_characters: ['name', 'gender_age', 'brief_introduction', 'appearance', 'key_items', 'is_dead', 'past_experience'],
  protagonist_skills: ['skill_name', 'skill_type', 'skill_level', 'effect_description'],
  inventory: ['item_name', 'quantity', 'description', 'category'],
  quests_events: ['quest_name', 'quest_type', 'issuer', 'detail_description', 'current_progress', 'time_limit', 'reward', 'penalty'],
};
const legacyColumns: Partial<Record<StateTableName, Record<string, string>>> = {
  global_state: { cur_time: 'current_time', prev_scene_time: 'previous_scene_time' },
  protagonist_info: { char_name: 'character_name' }, important_characters: { brief_intro: 'brief_introduction' },
  protagonist_skills: { effect_desc: 'effect_description' }, quests_events: { detail_desc: 'detail_description' },
};
// Only persisted snapshots/imports use aliases; new model operations must use canonical names.
export function normalizeLegacyStateCells(table: string, input: Record<string, unknown>): Record<string, unknown> {
  const cells = { ...input };
  for (const [oldName, name] of Object.entries(legacyColumns[table as StateTableName] ?? {})) {
    if (Object.hasOwn(cells, oldName)) { if (!Object.hasOwn(cells, name)) cells[name] = cells[oldName]; delete cells[oldName]; }
  }
  // Leaving a scene is not evidence of death. Unknown death status stays blank.
  if (table === 'important_characters') delete cells.is_absent;
  return cells;
}
export const stateDeathInstruction = 'is_dead means confirmed death only: 是 = dead, 否 = not dead, empty = unknown. Leaving, absence, disappearance, or being off-screen is not evidence of death.';
export const singletons = new Set<StateTableName>(['global_state', 'protagonist_info']);
const identities: Partial<Record<StateTableName, string[]>> = { important_characters: ['name', 'gender_age'], protagonist_skills: ['skill_name', 'skill_type'], inventory: ['item_name', 'quantity', 'category'], quests_events: ['quest_name', 'quest_type'] };
const cellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const stateOperationSchema = z.object({
  op: z.enum(['updateRow', 'insertRow', 'deleteRow']), table: z.enum(stateTableNames),
  rowId: z.number().int().positive().optional(), cells: z.record(z.string(), cellSchema).optional(),
}).strict();
export type StateOperation = z.infer<typeof stateOperationSchema>;

export function blankState(): ProtagonistTables {
  return Object.fromEntries(stateTableNames.map((table) => [table, singletons.has(table) ? [{ row_id: 1, ...Object.fromEntries(stateColumns[table].map((c) => [c, ''])) }] : []])) as ProtagonistTables;
}
export function normalizeState(input: unknown): ProtagonistTables {
  // Old story archives may contain the retired suggestions table. Never import it as story truth.
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const { options: _retired, ...tables } = input as Record<string, unknown>;
    input = tables;
  }
  const raw = z.record(z.string(), z.array(z.record(z.string(), cellSchema))).parse(input);
  if (Object.keys(raw).some((table) => !stateTableNames.includes(table as StateTableName))) throw new Error('Unknown state table.');
  const result = blankState();
  for (const table of stateTableNames) {
    if (!(table in raw)) continue;
    const source = raw[table]!.map(row => normalizeLegacyStateCells(table, row));
    if (singletons.has(table) && source.length > 1) throw new Error('Singleton table cannot contain multiple rows.');
    const used = new Set<number>();
    // Reserve valid IDs first so repairing an early invalid ID cannot steal a later valid one.
    const reserved = new Set(source.map((r) => Number(r.row_id)).filter((id) => Number.isSafeInteger(id) && id > 0));
    result[table] = source.map((row) => {
      if (Object.keys(row).some((c) => c !== 'row_id' && !stateColumns[table].includes(c))) throw new Error(`Unknown column in ${table}.`);
      let rowId = Number(row.row_id);
      if (!Number.isSafeInteger(rowId) || rowId <= 0 || used.has(rowId)) { rowId = 1; while (reserved.has(rowId) || used.has(rowId)) rowId++; }
      used.add(rowId); return { ...Object.fromEntries(stateColumns[table].map((c) => [c, row[c] ?? ''])), row_id: rowId } as StateRow;
    });
    if (!result[table].length && singletons.has(table)) result[table] = blankState()[table];
  }
  return result;
}
const key = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
export function applyStateOperations(input: ProtagonistTables, operations: unknown, options: { allowImportantCharacterDeletion?: boolean } = {}): { tables: ProtagonistTables; changed: boolean } {
  const parsed = z.array(stateOperationSchema).max(100).parse(operations);
  const tables = structuredClone(input);
  for (const { table, op, rowId, cells } of parsed) {
    if (singletons.has(table) && op !== 'updateRow') throw new Error('Singleton tables are update-only.');
    if (table === 'important_characters' && op === 'deleteRow' && !options.allowImportantCharacterDeletion) throw new Error('Important characters cannot be deleted by the model.');
    if (op !== 'insertRow' && rowId === undefined) throw new Error('A row ID is required.');
    if (op === 'insertRow' && rowId !== undefined) throw new Error('Inserted row IDs are assigned locally.');
    if (op === 'deleteRow' && cells !== undefined) throw new Error('Delete operations cannot supply cells.');
    if (op !== 'deleteRow' && !cells) throw new Error('Cells are required.');
    for (const column of Object.keys(cells ?? {})) if (!stateColumns[table].includes(column)) throw new Error(`Unknown or immutable column: ${column}`);
    const index = tables[table].findIndex((row) => row.row_id === rowId);
    if (op !== 'insertRow' && index < 0) throw new Error('Unknown row.');
    if (op === 'deleteRow') { tables[table].splice(index, 1); continue; }
    const original = op === 'insertRow' ? null : tables[table][index]!;
    const next: StateRow = original ? { ...original, ...cells } : { row_id: Math.max(0, ...tables[table].map((r) => r.row_id)) + 1, ...Object.fromEntries(stateColumns[table].map((c) => [c, ''])), ...(table === 'inventory' ? { quantity: '1' } : {}), ...cells };
    for (const column of identities[table] ?? []) if ((!original || column in cells!) && !key(next[column])) throw new Error(`Missing identity field: ${column}`);
    if (table === 'inventory' && (!original || 'quantity' in cells!)) {
      const quantity = Number(next.quantity); if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer.');
    }
    if (table === 'important_characters' && (!original || 'is_dead' in cells!) && !['是', '否', ''].includes(String(next.is_dead))) throw new Error('is_dead must be 是, 否, or empty (unknown).');
    const uniqueColumn = identities[table]?.[0];
    if (uniqueColumn && (!original || key(next[uniqueColumn]) !== key(original[uniqueColumn])) && tables[table].some((row) => row !== original && key(row[uniqueColumn]) === key(next[uniqueColumn]))) throw new Error('Duplicate identity.');
    if (original) tables[table][index] = next; else tables[table].push(next);
  }
  return { tables, changed: JSON.stringify(tables) !== JSON.stringify(input) };
}
