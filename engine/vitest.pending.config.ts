import { defineConfig } from 'vitest/config'

// 給下游的驗收測試：工單做完之前照預期失敗。跑法：npm run test:pending（或後面接檔名只跑一張工單的）。
// 工單完成後把測試檔從 tests/pending/ 搬到 tests/features/（或 tests/data/），它就進主套件。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pending/**/*.test.ts'],
    testTimeout: 10000,
  },
})
