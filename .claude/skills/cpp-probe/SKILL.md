---
name: cpp-probe
description: CyberpunkPink 探針測試。追蹤一個系統在執行時的 report、changes、掛鉤與任務鏈，找出和規格不一致的地方。使用者說「探針」「probe」或要追查某個系統的實際行為時使用。
argument-hint: "<系統> [情境]"
context: fork
agent: cpp-tester-probe
---
對 CyberpunkPink 的這個系統下探針：$ARGUMENTS
照 dev/test-harness.md 的「探針」一節，紀錄寫到 dev/probes/。
