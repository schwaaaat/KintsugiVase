import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'index.dev.html',
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    open: '/index.dev.html',
  },
  worker: {
    format: 'iife',
    plugins: () => [viteSingleFile()],
  },
});
