import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [viteSingleFile()],
  css: {
    postcss: './postcss.config.js',
  },
  build: {
    minify: 'terser',
    outDir: 'dist',
    rollupOptions: {
      input: 'src/index.html',
      output: {
        entryFileNames: `index.js`,
        chunkFileNames: `index.js`,
        assetFileNames: `index.[ext]`
      }
    },
  },
})