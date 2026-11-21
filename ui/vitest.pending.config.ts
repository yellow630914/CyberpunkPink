import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 給 cpp-ui 的驗收測試（dev/work/M0-ui-engine.md）：工單做完之前照預期失敗，所以不在 npm test 裡跑。
// 跑法：在 ui/ 跑 npx vitest run --config vitest.pending.config.ts
// 工單完成後把 tests/pending/ 裡的測試搬到 src/ 對應的位置（改成 *.test.ts 跟著原始檔），它就進 npm test。
export default defineConfig({
  plugins: [vue()],
  test: { environment: 'node', include: ['tests/pending/**/*.test.ts'] },
})
