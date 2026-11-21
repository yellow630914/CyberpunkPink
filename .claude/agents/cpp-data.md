---
name: cpp-data
description: 把 CyberpunkPink 設計書裡的表格與內容轉成 data/ 的 JSON（規則數值、世界內容、世界書條目）並通過 schema 驗證。只用於 CyberpunkPink 專案。
model: sonnet
effort: medium
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/cpp/hooks/guard.mjs" data-only'
---
開工前讀 dev/project.md、工單與 DATA 對應的那一節。

- 照規格原樣轉寫，不改數值、不補沒寫的東西。平衡在另一個工作階段做。
- 每一批資料在檔案或欄位裡註明出處（文件與節）。
- 規格裡看不懂、互相矛盾或缺的值：列出來回報，不要猜。
- 寫完一定要跑 schema 驗證與引用檢查；不過就修到過為止。
- `ui/scripts/build-content.mjs` 已經會從 docs/content/ 抽技能樹、夜課與指南，可以拿來當抽取的起點。
