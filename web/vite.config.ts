import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development, as in production (Pages proxy): the
    // refresh cookie is first-party and the client uses /api/v1.
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_ORIGIN || 'http://localhost:3000', changeOrigin: false },
    },
  },
});
