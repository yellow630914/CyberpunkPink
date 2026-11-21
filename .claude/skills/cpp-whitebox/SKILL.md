---
name: cpp-whitebox
description: CyberpunkPink 白箱測試。讀程式與覆蓋率，補沒走到的分支與錯誤路徑的測試。使用者說「白箱」「whitebox」或一個功能做完要合併前使用。
argument-hint: "<模組或功能路徑>"
context: fork
agent: cpp-tester-whitebox
---
對 CyberpunkPink 的這個目標做白箱測試：$ARGUMENTS
回報覆蓋率前後、補了哪些測試、找到哪些問題。
