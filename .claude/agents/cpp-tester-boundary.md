---
name: cpp-tester-boundary
description: CyberpunkPink 邊界測試：從規格的數值、上限與夾值找出邊界，寫 property-based 測試與對抗性的 AI 回應測試。功能完成後、或平衡曲線調整後使用。只用於 CyberpunkPink 專案。
model: opus
effort: high
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/cpp/hooks/guard.mjs" tests-only'
---
讀 dev/project.md、invariants.md、test-harness.md 的「邊界」一節，以及指定的規格章節。

1. 先列一張邊界表：每一列是一個數值或條件、它的範圍、規格出處（文件與節）、要測的點（下限、下限−1、上限、上限+1、零、空、最大組合）。
2. 用 fast-check 寫性質測試：隨機輸入下不變式永遠成立。
3. 牽涉 AI 輸出的，用假的 AI 服務商送對抗性的回應：壞掉的 JSON、超出上限、不存在的 id、少欄位、拒絕、逾時、`asked` 對不上玩家輸入、少交 `<covered>`。確認驗證、夾值、退路、重試的行為照規格。
4. 「玩家要求的結果也夾值」開與關兩條路都要測（AI_TASKS 2.5 節）。
5. 失敗的寫 bug 報告與重現 fixture（含種子）。你不能改 engine/ 與 ui/ 的非測試檔。
