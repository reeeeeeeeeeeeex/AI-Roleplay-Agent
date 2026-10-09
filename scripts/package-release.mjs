import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid release version.');
const name = `AI-Roleplay-Agent-v${version}`;
const output = join(root, 'release');
mkdirSync(output, { recursive: true });
for (const extension of ['zip', 'tar.gz']) if (existsSync(join(output, `${name}.${extension}`))) throw new Error(`Release archive already exists: ${name}.${extension}`);
const temporary = mkdtempSync(join(output, '.stage-'));
const stage = join(temporary, name);
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
try {
  mkdirSync(stage);
  // Export tracked history only: no .git, local databases, credentials, or node_modules.
  run('git', ['archive', '--format=tar', '-o', join(temporary, 'source.tar'), 'HEAD']);
  run('tar', ['-xf', join(temporary, 'source.tar'), '-C', stage]);
  for (const project of ['packages/contracts', 'packages/plugin-sdk', 'packages/agent-runtime', 'apps/server', 'apps/web']) {
    cpSync(join(root, project, 'dist'), join(stage, project, 'dist'), { recursive: true, filter: path => !/\.test\.(?:js(?:\.map)?|d\.ts)$/.test(path) });
  }
  for (const file of ['Start.sh', 'Start.command']) chmodSync(join(stage, file), 0o755);
  // Include upstream notices for the compiled browser/PWA dependencies as well.
  const licenses = new Map();
  for (const manifest of globSync(['node_modules/.pnpm/*/node_modules/*/package.json', 'node_modules/.pnpm/*/node_modules/@*/*/package.json'], { cwd: root })) {
    const folder = dirname(join(root, manifest));
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (licenses.has(key)) continue;
    const files = readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(entry.name));
    if (files.length) licenses.set(key, files.map(file => `${file.name}\n${readFileSync(join(folder, file.name), 'utf8')}`).join('\n'));
  }
  if (!licenses.size) throw new Error('Install dependencies before packaging third-party notices.');
  writeFileSync(join(stage, 'THIRD_PARTY_LICENSES.txt'), [...licenses].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => `${name}\n${'='.repeat(72)}\n${text}`).join('\n\n'));
  run('tar', ['-czf', join(output, `${name}.tar.gz`), '-C', temporary, name]);
  if (process.platform === 'linux') run('zip', ['-qr', join(output, `${name}.zip`), name], temporary);
  else run('tar', ['-a', '-cf', join(output, `${name}.zip`), '-C', temporary, name]);
  console.log(`Release archives: ${output}`);
} finally {
  if (!realpathSync(temporary).startsWith(realpathSync(output) + sep)) throw new Error('Unexpected staging directory.');
  rmSync(temporary, { recursive: true, force: true });
}
