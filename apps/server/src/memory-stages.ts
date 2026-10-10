import type { MemoryEntry } from '@new-ai-chat/contracts';

// Legacy imports are cumulative snapshots. Only unambiguous, consecutive headers
// can be interpreted as stages; keep all other text intact as one record.
export function splitMemoryStages(content: string) {
  const headers = [...content.matchAll(/^\s*\[Stage\s+(\d+)\]\s*[:：][ \t]*/gim)];
  if (!headers.length || content.slice(0, headers[0]!.index).trim()
    || headers.some((header, index) => Number(header[1]) !== index + 1)) return null;
  return headers.map((header, index) => {
    const start = header.index + header[0].length;
    const end = headers[index + 1]?.index ?? content.length;
    return { stage: index + 1, content: content.slice(start, end).trim(), start, end };
  });
}

export type MemoryStage = MemoryEntry & { snapshotId?: string };

// Input and output are newest-first. Database IDs, checkpoints and old snapshot
// numbers remain untouched, so forks, deletion and archives keep their provenance.
export function projectMemoryStages(memories: MemoryEntry[]): MemoryStage[] {
  let stages: MemoryStage[] = [];
  let number: number | undefined;
  for (const entry of [...memories].reverse()) {
    if (entry.source === 'imported') {
      const parts = splitMemoryStages(entry.content);
      stages = parts ? parts.map(part => ({ ...entry, id: `${entry.id}:stage:${part.stage}`, snapshotId: entry.id,
        stage: part.stage, content: part.content, coverage: null })) : [entry];
      number = parts?.at(-1)?.stage;
    } else {
      if (entry.source === 'manual') stages = [];
      stages.push(number === undefined ? entry : { ...entry, stage: ++number });
    }
  }
  return stages.reverse();
}
