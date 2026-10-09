const prefix = 'story-draft:';

export function readComposerDrafts(): Record<string, string> {
  let drafts: Record<string, string> = {};
  try {
    drafts = Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('story-drafts') ?? '{}'))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { /* Existing in-memory editing remains available without storage. */ }
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) drafts[key.slice(prefix.length)] = value;
    }
  } catch { /* Preserve any drafts already read. */ }
  return drafts;
}

export function saveComposerDrafts(drafts: Record<string, string>, saved: Record<string, string>): void {
  for (const [key, value] of Object.entries(drafts)) {
    if (saved[key] === value) continue;
    // Separate keys keep other windows' stories intact. Empty values mask legacy drafts after sending.
    localStorage.setItem(`${prefix}${key}`, value);
    saved[key] = value;
  }
}
