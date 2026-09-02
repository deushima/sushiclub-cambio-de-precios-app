import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : isWindows ? 'pnpm.cmd' : 'pnpm';
const args = pnpmCli ? [pnpmCli, 'exec', 'vite', 'build'] : ['exec', 'vite', 'build'];
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = spawnSync(command, args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    BUILD_TARGET: 'desktop',
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
