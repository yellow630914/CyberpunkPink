import { defineConfig } from 'vitest/config'

// 主套件：核心、測試基礎建設、冒煙、分層檢查。給下游的驗收測試在 tests/pending/，不在這裡跑（見 vitest.pending.config.ts）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/pending/**', 'node_modules/**'],
    testTimeout: 10000,
  },
})
