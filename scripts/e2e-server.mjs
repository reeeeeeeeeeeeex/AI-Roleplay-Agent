import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../apps/server/dist/app.js';

const folder = mkdtempSync(join(tmpdir(), 'new-ai-chat-e2e-'));
const server = await createApp({ host: '127.0.0.1', port: 4319, databasePath: join(folder, 'test.db'), assetDir: join(folder, 'assets'), webDist: resolve(import.meta.dirname, '../apps/web/dist'), pairingToken: null, defaultImportPath: folder, fakeModel: true });
await server.listen();
console.log('Offline E2E server ready at http://127.0.0.1:4319');
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return; closing = true;
  await server.app.close();
  // This exact path was created above; it never contains user data.
  rmSync(folder, { recursive: true, force: true });
  process.exit(0);
});
