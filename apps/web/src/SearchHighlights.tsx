import { useMemo } from 'react';
import { searchText } from './search-text.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export default function SearchHighlights({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => {
    const needle = searchText(query.trim());
    const normalized = searchText(text);
    let found = needle ? normalized.indexOf(needle) : -1;
    if (found < 0) return [];
    // Map normalized matches back to whole original graphemes, including combining accents.
    const offsets: Array<{ start: number; end: number }> = [];
    for (const { segment, index } of graphemes.segment(text)) {
      const span = { start: index, end: index + segment.length };
      for (let i = 0; i < searchText(segment).length; i++) offsets.push(span);
    }
    const matches: Array<{ start: number; end: number }> = [];
    while (found >= 0) {
      const start = offsets[found]!.start;
      const end = offsets[found + needle.length - 1]!.end;
      const last = matches.at(-1);
      if (last && start <= last.end) last.end = end;
      else matches.push({ start, end });
      found = normalized.indexOf(needle, found + needle.length);
    }
    return matches;
  }, [text, query]);
  if (!ranges.length) return null;
  return <div className="search-highlights" aria-hidden="true">
    {ranges.map((range, index) => <span key={range.start}>
      {text.slice(index ? ranges[index - 1]!.end : 0, range.start)}<mark>{text.slice(range.start, range.end)}</mark>
    </span>)}{text.slice(ranges.at(-1)!.end)}
  </div>;
}
