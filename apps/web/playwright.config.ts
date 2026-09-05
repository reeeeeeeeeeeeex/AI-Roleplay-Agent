import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30_000,
  expect: { timeout: 10_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4319', channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'), viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node ../../scripts/e2e-server.mjs', url: 'http://127.0.0.1:4319/api/session', reuseExistingServer: false, timeout: 30_000 },
});
