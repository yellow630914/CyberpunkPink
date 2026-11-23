# B016：AI 給的體悟一件事最多 30 點，規格是 5 點
- 發現者：cpp-tester-boundary（M2 量表 × AI_TASKS 2.5 的邊界測試）
- 嚴重度：錯誤（AI 判定或 AI 生成的事件一次就能給 30 點體悟；學一個技能花「階 × 10」體悟（LEWD_SYSTEM 第 10 節），等於一次送三個第一階的夜課技能）
- 規格出處：EVENTS 2.4 節的上限表：「`insight` | 體悟，一件最多 5 點 | 夜課的經驗」；AI_TASKS 2.5 節（AI 自己生成的、以及設定開著時玩家要求的，照 EVENTS 2.4 夾）。成人場景收尾照契合給的 5～20 點是內建的結算，本來就不受這張表管。
- 實際行為：`features/scene/index.ts` 定義量表時寫 `cap: { down: 20, up: 30 }`（註解「AI 一件事最多給一場最高的量」），AI 給 +6、+30、拆成 3＋3 都照收，沒有夾值的記號。設定關著、asked 對得上的照給 30，內建的照給 30，這兩條是對的。
- 重現：engine/tests/boundary/fixtures/B016-insight-ai-cap.json（種子 6、`makeCityGame`、六筆輸入與期望）；會失敗的測試 engine/tests/pending/B016-insight-ai-cap.test.ts（第 1～3 筆與「量表的定義」照預期失敗，第 0、4、5 筆是對照、會過）。
- 可能的位置（只寫推測，不改）：`engine/src/features/scene/index.ts` 的 `k.meters.define({ kind: 'insight', … cap })`，改成 `up: 5`；往下的上限規格沒寫（體悟不會因事件減少），要不要 0 由 cpp-architect 定，寫進 dev/adr/0016 的量表表。
