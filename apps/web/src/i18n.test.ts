import { expect, test } from 'vitest';
import { english } from './i18n-messages.js';
import { diagnosticMessages } from '../../../packages/contracts/src/diagnostic-messages.js';

test('language catalogues preserve every interpolation parameter', () => {
  const slots = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort();
  const mismatches = Object.entries(english).filter(([zh, en]) => !en.trim() || JSON.stringify(slots(zh)) !== JSON.stringify(slots(en))).map(([key]) => key);
  const diagnostics = Object.entries(diagnosticMessages).filter(([, entry]) => JSON.stringify(slots(entry.original)) !== JSON.stringify(slots(entry.zh)) || JSON.stringify(slots(entry.zh)) !== JSON.stringify(slots(entry.en))).map(([key]) => key);
  expect([...mismatches, ...diagnostics]).toEqual([]);
});
