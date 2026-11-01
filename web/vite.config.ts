import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A new id for every build. The app compares it with /version.json (written
// next to index.html on each deploy) to know when a newer version is live.
const BUILD_ID = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || new Date().toISOString();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  server: {
    port: 5173,
    // Same-origin API in development, as in production (Pages proxy): the
    // refresh cookie is first-party and the client uses /api/v1.
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_ORIGIN || 'http://localhost:3000', changeOrigin: false },
    },
  },
});
