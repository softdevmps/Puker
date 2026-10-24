import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // `host: true` expone el dev server en la red local: así podés abrirlo
    // desde el celular con http://<ip-de-tu-pc>:5173 mientras desarrollás.
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
