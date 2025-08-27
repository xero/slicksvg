import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import postcss from './postcss.config.js';

export default defineConfig({
  plugins: [viteSingleFile()],
  css: {
    postcss,
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    outDir: 'dist',
    rollupOptions: {
      input: 'src/index.html',
      output: {
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`
      }
    },
  },
  server: {
    port: 8080,
  },
});