import { cpSync, copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');
const distAssets = join(distDir, 'assets');
const distFonts = join(distDir, 'fonts');
const rootAssets = join(repoRoot, 'assets');
const rootFonts = join(repoRoot, 'fonts');

if (!existsSync(join(distDir, 'index.html')) || !existsSync(distAssets)) {
  throw new Error('No existe el build de Vite en dist/.');
}

rmSync(rootAssets, { recursive: true, force: true });
rmSync(rootFonts, { recursive: true, force: true });
copyFileSync(join(distDir, 'index.html'), join(repoRoot, 'index.html'));
cpSync(distAssets, rootAssets, { recursive: true });
if (existsSync(distFonts)) {
  cpSync(distFonts, rootFonts, { recursive: true });
}
writeFileSync(join(repoRoot, '.nojekyll'), '');
