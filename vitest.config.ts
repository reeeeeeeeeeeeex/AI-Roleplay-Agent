import { defineConfig } from 'vitest/config';
export default defineConfig({resolve:{conditions:['development']},test:{include:['packages/*/src/**/*.test.ts','apps/server/src/**/*.test.ts'],testTimeout:30_000,hookTimeout:30_000,maxWorkers:2}});
