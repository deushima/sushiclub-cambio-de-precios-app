import { cpSync, copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');
const distAssets = join(distDir, 'assets');
const rootAssets = join(repoRoot, 'assets');

if (!existsSync(join(distDir, 'index.html')) || !existsSync(distAssets)) {
  throw new Error('No existe el build de Vite en dist/.');
}

rmSync(rootAssets, { recursive: true, force: true });
copyFileSync(join(distDir, 'index.html'), join(repoRoot, 'index.html'));
cpSync(distAssets, rootAssets, { recursive: true });
writeFileSync(join(repoRoot, '.nojekyll'), '');
