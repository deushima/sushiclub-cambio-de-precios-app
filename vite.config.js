import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDesktopBuild = process.env.BUILD_TARGET === 'desktop';

export default defineConfig({
  root: 'src',
  base: isDesktopBuild ? './' : '/sushiclub-cambio-de-precios-app/',
  plugins: [react()],
  build: {
    outDir: isDesktopBuild ? '../dist-desktop' : '../dist',
    emptyOutDir: true,
  },
});
