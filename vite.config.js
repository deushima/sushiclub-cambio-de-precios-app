import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/sushiclub-cambio-de-precios-app/',
  plugins: [react()],
});
