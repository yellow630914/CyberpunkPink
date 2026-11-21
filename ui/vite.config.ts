import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './'：建出來的 dist/ 放在任何路徑底下都能用（路由用 hash，不需要伺服器改寫）。
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 800 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
