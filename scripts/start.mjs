import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
let child;
const stop = () => child?.kill('SIGTERM');
async function run(file, args) {
  await new Promise((done, reject) => {
    child = spawn(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      code === 0 ? done() : reject(new Error(`Setup stopped (${signal ?? code}). / 准备过程未完成。`));
    });
  });
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Please install Node.js 24. / 请安装 Node.js 24：https://nodejs.org/');
  const built = ['apps/server', 'packages/contracts', 'packages/plugin-sdk', 'packages/agent-runtime'].every(path => existsSync(resolve(root, path, 'dist/index.js')))
    && existsSync(resolve(root, 'apps/web/dist/index.html'));
  const installed = existsSync(resolve(root, 'node_modules/.modules.yaml'))
    && existsSync(resolve(root, 'apps/server/node_modules/better-sqlite3/package.json'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (!installed || (!built && !existsSync(resolve(root, 'node_modules/typescript/bin/tsc')))) {
    const npmCli = [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), '/usr/share/nodejs/npm/bin/npm-cli.js'].find(existsSync);
    if (!npmCli) throw new Error('npm is missing. Install Node.js 24 with npm. / 请安装包含 npm 的 Node.js 24。');
    const { packageManager } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) throw new Error('Invalid packageManager version.');
    console.log('Preparing dependencies; first launch needs internet. / 正在准备依赖，首次启动需要联网。');
    await run(npmCli, ['exec', '--yes', `--package=${packageManager}`, '--', 'pnpm', 'install', '--frozen-lockfile', ...(built ? ['--prod'] : [])]);
  }
  if (!built) {
    console.log('Building the application. / 正在构建应用。');
    await run(resolve(root, 'scripts/tasks.mjs'), ['build']);
  }
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  process.env.OPEN_BROWSER ??= '1';
  process.chdir(resolve(root, 'apps/server'));
  console.log('Keep this window open. Press Ctrl+C to stop. / 请保持窗口开启，按 Ctrl+C 停止。');
  await import(pathToFileURL(resolve(root, 'apps/server/dist/index.js')).href);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
