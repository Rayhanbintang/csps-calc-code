import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022', sourcemap: false },
  // WSL reading /mnt/c gets no file events, so the dev server polls for edits.
  server: {
    port: 5173,
    watch: { usePolling: true, interval: 300 },
    // cmd/devapi serves the Go functions locally.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
