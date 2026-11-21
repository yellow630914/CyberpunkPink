---
name: cpp-smoke
description: CyberpunkPink 冒煙測試。固定種子、AI 關閉跑主幹流程，回報哪一步斷掉。使用者說「冒煙」「smoke」或一批改完要快速確認時使用。
argument-hint: "[範圍，可省略]"
context: fork
agent: cpp-tester-smoke
---
跑 CyberpunkPink 的冒煙測試。範圍：$ARGUMENTS（沒填就跑全部主幹）。
照 dev/test-harness.md 的「冒煙」一節，回報過或不過的表。
