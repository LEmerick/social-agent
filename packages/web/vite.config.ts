import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Le serveur de jeu (`@ai-reality/play`, `pnpm play:server`) écoute sur 4317 ; Vite lui relaie `/api`.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4317' } },
});
