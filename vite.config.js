import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // the packaged app loads dist/index.html over file://
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5183, strictPort: true },
});
