import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep, isAbsolute } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { ImportPreview } from '@new-ai-chat/contracts';

export interface ImportFile { path: string; kind: string; hash: string; bytes: Buffer; value: any }
export interface ImportBundle { preview: ImportPreview; files: ImportFile[] }
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const inside = (root: string, path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };
export function decodeCard(bytes: Buffer): any {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature.');
  const tags = new Map<string, string>();
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG.');
    const data = bytes.subarray(offset + 8, offset + 8 + length); const end = data.indexOf(0);
    if (end > 0 && type === 'tEXt') tags.set(data.toString('latin1', 0, end), data.toString('latin1', end + 1));
    if (end > 0 && type === 'zTXt') tags.set(data.toString('latin1', 0, end), inflateSync(data.subarray(end + 2), { maxOutputLength: 8_000_000 }).toString('utf8'));
    offset += length + 12;
  }
  const encoded = tags.get('ccv3') ?? tags.get('chara');
  if (!encoded) throw new Error('PNG contains no V2/V3 character metadata.');
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}
export async function scanImport(sourcePath: string): Promise<ImportBundle> {
  const root = await realpath(resolve(sourcePath));
  if (!(await stat(root)).isDirectory()) throw new Error('Import source must be a directory.');
  const files: ImportFile[] = []; const warnings: string[] = []; let total = 0;
  async function read(path: string, kind: string) {
    const exact = await realpath(path); if (!inside(root, exact)) { warnings.push(`Skipped external link: ${relative(root, path)}`); return; }
    const size = (await stat(exact)).size; total += size;
    if (size > 32_000_000 || total > 256_000_000) throw new Error('Import exceeds the 32 MB/file or 256 MB/batch limit.');
    const bytes = await readFile(exact); let value: any;
    try {
      value = kind === 'character' && extname(path).toLowerCase() === '.png' ? decodeCard(bytes)
        : kind === 'chat' ? bytes.toString('utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line))
          : kind === 'avatar' ? null : JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
    } catch { warnings.push(`Unreadable or unsupported file: ${relative(root, path)}`); return; }
    files.push({ path: relative(root, exact), kind, hash: hash(bytes), bytes, value });
  }
  async function walk(folder: string, kind: string, extensions: string[], nested = false) {
    let entries; try { entries = await readdir(resolve(root, folder), { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) { warnings.push(`Skipped link: ${folder}/${entry.name}`); continue; }
      const path = resolve(root, folder, entry.name);
      if (entry.isDirectory() && nested) await walk(relative(root, path), kind, extensions, false);
      else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) await read(path, kind);
    }
  }
  await walk('characters', 'character', ['.png', '.json']);
  await walk('worlds', 'lorebook', ['.json']);
  await walk('groups', 'group', ['.json']);
  await walk('chats', 'chat', ['.jsonl'], true);
  await walk('group chats', 'chat', ['.jsonl']);
  await walk('User Avatars', 'avatar', ['.png', '.jpg', '.jpeg', '.webp']);
  try { await read(resolve(root, 'settings.json'), 'settings'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const counts: ImportPreview['counts'] = { characters: 0, personas: 0, lorebooks: 0, conversations: 0, groups: 0, memories: 0, stateSnapshots: 0, plannerRecords: 0 };
  for (const file of files) {
    if (file.kind === 'character') counts.characters++;
    if (file.kind === 'lorebook') counts.lorebooks++;
    if (file.kind === 'group') counts.groups++;
    if (file.kind === 'settings') counts.personas += Object.keys(file.value.power_user?.personas ?? file.value.personas ?? {}).length;
    if (file.kind === 'chat') {
      counts.conversations++;
      for (const record of file.value as any[]) {
        if (typeof record.extra?.memory === 'string') counts.memories++;
        if (record.extra?.protagonist_state) counts.stateSnapshots++;
        if (record.extra?.narrative_agent) counts.plannerRecords++;
      }
    }
  }
  const manifest = files.map(({ path, kind, hash }) => ({ path, kind, hash }));
  warnings.push('Only core lore keyword/secondary-key/constant/order behavior runs in v0.1. Regex, recursion, probability, decorators and executable Tavern macros are preserved as legacy data, not executed.');
  return { preview: { sourcePath: root, sourceHash: hash(JSON.stringify(manifest)), counts, warnings, files: manifest }, files };
}
export const importName = (path: string) => basename(path, extname(path));
