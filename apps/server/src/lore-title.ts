/** Tavern titles are editing metadata, not model context. */
export function legacyLoreTitle(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const entry = value as Record<string, unknown>;
  for (const key of ['comment', 'name']) {
    if (typeof entry[key] === 'string' && entry[key].trim()) return entry[key];
  }
  return '';
}
