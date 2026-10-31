import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // changeOrigin:false keeps Host = localhost:5173 so the API's origin check matches, like production.
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
});
