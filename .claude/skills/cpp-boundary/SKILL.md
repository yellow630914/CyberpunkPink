---
name: cpp-boundary
description: CyberpunkPink 邊界測試。從規格的數值、上限、夾值找出邊界，寫性質測試與對抗性 AI 回應測試。使用者說「邊界」「boundary」或調整數值曲線後使用。
argument-hint: "<文件 節，例如 AI_TASKS 2.5>"
context: fork
agent: cpp-tester-boundary
---
對 CyberpunkPink 規格的這一段做邊界測試：$ARGUMENTS
先列邊界表（附規格出處），再寫測試，最後回報結果。
