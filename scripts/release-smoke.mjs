import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `AI-Roleplay-Agent-v${version}`;
const archive = join(root, 'release', `${name}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
const temporary = mkdtempSync(join(tmpdir(), 'ai roleplay release-'));
let child, exited, port;
try {
  execFileSync('tar', ['-xf', archive, '-C', temporary]);
  const folder = join(temporary, name);
  assert.ok(!existsSync(join(folder, 'node_modules')));
  assert.ok(!existsSync(join(folder, '.git')));
  assert.ok(!existsSync(join(folder, '.env')));
  assert.ok(!existsSync(join(folder, 'apps/server/data')));
  assert.ok(readFileSync(join(folder, 'THIRD_PARTY_LICENSES.txt'), 'utf8').includes('react@'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  port = probe.address().port;
  await new Promise(done => probe.close(done));
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'sh';
  const args = process.platform === 'win32' ? ['/d', '/c', 'Start.cmd'] : [join(folder, process.platform === 'darwin' ? 'Start.command' : 'Start.sh')];
  child = spawn(command, args, {
    cwd: folder, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, OPEN_BROWSER: '0', FAKE_MODEL: '1', PORT: String(port), HOST: '127.0.0.1', PAIRING_TOKEN: '', DATABASE_PATH: join(temporary, 'check.db'), ASSET_DIR: join(temporary, 'assets'), WEB_DIST: join(folder, 'apps/web/dist') },
  });
  exited = once(child, 'exit');
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Clean release must install and start without a global pnpm');
  const html = await (await fetch(base)).text();
  assert.equal(html, readFileSync(join(folder, 'apps/web/dist/index.html'), 'utf8'));
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(base + asset)).status, 200);
  assert.ok((await (await fetch(`${base}/sw.js`)).text()).includes(asset.replace(/^\//, '')));
  assert.equal((await (await fetch(`${base}/api/session`)).json()).fakeModel, true);
  assert.equal(typeof (await (await fetch(`${base}/api/settings/general`)).json()).manualInput, 'boolean');
  assert.ok(existsSync(join(temporary, 'check.db')), 'SQLite must work on this platform');
  console.log(`Release smoke passed: ${process.platform}/${process.arch}, Node ${process.versions.node}, port ${port}`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    // This PID was created above solely for this isolated release check.
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
    await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); })]);
    await exited;
  }
  if (port) {
    const listening = await new Promise(done => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); done(true); });
      socket.once('error', () => done(false));
    });
    assert.equal(listening, false, 'Release check must release its port');
  }
  if (!realpathSync(temporary).startsWith(realpathSync(tmpdir()) + sep)) throw new Error('Unexpected test directory.');
  rmSync(temporary, { recursive: true, force: true });
  console.log('Release check server stopped; temporary data removed.');
}
