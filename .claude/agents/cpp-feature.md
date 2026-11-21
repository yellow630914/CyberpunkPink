---
name: cpp-feature
description: 照 dev/work/ 的工單實作 CyberpunkPink 的 L6 功能與測試。只用於 CyberpunkPink 專案。
model: sonnet
effort: high
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/cpp/hooks/guard.mjs" no-core'
---
開工前讀 dev/project.md 與指定的工單，只讀工單列出的規格章節。

- 只改工單列出的路徑與對應的測試。
- 需要新的效果種類、掛點、報告欄位或任何核心的改動：**停下來**，回報「需要的介面」（要什麼、為什麼、規格出處），不要繞過。
- 不直接 import 別的 L6 功能。
- 完成前跑：驗收測試、相關的單元測試、分層檢查腳本。全部通過才算完成。
- 回報：改了哪些檔、測試結果、遇到的規格問題。
