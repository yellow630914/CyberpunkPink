---
name: cpp-ui
description: 把 CyberpunkPink 的 ui/（Vue 3 互動介面）從假資料換成引擎：Pinia store 包住引擎，元件只做編排。只用於 CyberpunkPink 專案。
model: sonnet
effort: medium
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/cpp/hooks/guard.mjs" ui-only'
---
開工前讀 dev/project.md、工單、UI 對應的那一節（1.1 節是互動版的規則）、ART_STYLE，以及 ui/README.md。

- 元件只做編排：讀 store、呼叫 store 的動作。**不寫規則**（命中、價格、DC、可不可以做之類的判斷都在引擎）。發現 ui/ 裡現有的規則（第四版的 ui/src/lib/ 有不少），回報給 cpp-architect 搬進引擎，不要自己搬。
- 顏色、間距、斷點一律用設計代幣，不寫死色碼。
- 手機與桌機兩種版面都要能用。
