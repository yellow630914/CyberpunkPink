# M1b-review-features

- 交給：cpp-feature（功能面）＋ cpp-ui（介面面）
- 目標：處理 M1b 審查（dev/reviews/2026-11-23-M1b.md）與白箱（W012、W013）裡屬於功能與介面的項目；核心的部分由另一個代理做，這一張只回報需要的介面。
- 規格出處：ITEMS 第 2.9、2.10 節（卡彈、炸膛）與 ENEMY_ROSTER（同）；FIXER 第 8 節（人情只記在主角名下）；EQUIPMENT 第 2、4.1 節（快取格放什麼）；SKILL_TREES 機師「敢打我家孩子？」、潛網者開頭（破冰等本身也是快駭）、蜂群；ENEMIES 第 7 節（掉落件數）；dev/adr/0015（含所有實作補記，E6 自律、`revive` 狀態清空）；SKILLS 1.2 節。
- 可以改的路徑：`engine/src/features/`、`engine/data/`（只動機制欄位）、`ui/src/`、對應的測試（`engine/tests/features/`、`ui/` 底下的測試）、`dev/reports/skill-effects.*`、`dev/adr/0015`（只加一行）。
- 不可以做的事：不改 `engine/src/core`、`engine/src/shell`；功能之間不直接 import；需要核心的新介面就停下來回報。

## 項目

| 編號 | 做什麼 |
|---|---|
| E2 | 現金與人情是隊伍共用的一份：每個有角色的單位照舊各帶一份池，但每次花費（行動、反應）之後同步成同一個數字，結束時只算一次差額；人情只記在主角名下（FIXER 8） |
| E4 | 卡彈與炸膛照設計書：命中骰自然 1 才發生；卡彈＝那一擊照常結算（失手），之後彈匣清空、要換彈；炸膛＝開槍的人自己受 N 顆 d6 物理。fx 格式改成 `on_use: { jam: 'natural1', backfire: { dice } }` |
| E5 | 「敢打我家孩子？」攻擊者是替身（砲塔、沒有操作者的無人機）時不觸發（SKILL_TREES 寫的是「敵人…朝他射擊」，不是機器），不花行動點與次數 |
| E6 | 快取格放什麼的規則搬進 `features/gear`（`quickBlock`），`gear.quick` 的 validate 用它；介面改問引擎 |
| W013 | 倒下時清掉自己的 buff、持續型快駭、姿態（救回來時是乾淨的）；核心沒有 `revive` 掛點，先聽 `out` |
| W012 | 臨時遮蔽、source_* 的 buff 在給的人退出時結束（聽 `out`） |
| 小項 | 見下面各條 |

小項：花掉全部 RAM 的 `spent` 照實際花費（不用模組層級的 WeakMap）；潛網者樹的技能帶 `hack` 標籤；接管到期時原操作者已退出照自律規則；改寫敵我名單的那一台開火時當成對面的；`sink` 效果走 `run.gainSink`；buff 的 `next_overload` 在過載時結束；共鳴「生效中」問引擎；技能卡的消耗認得照戰場分的 `use`；`M1b-skill-pilot` 的空斷言；蜂群「不灌感載」的註解與程式一致；精英掉落至少 1 件、首領至少 2 件。

## 驗收

每一項都有測試（`engine/tests/features/M1b-review-features.test.ts`、`ui/` 的測試）；既有測試維持綠色，改過的列在回報裡；引擎 tsc、`npm test`、冒煙、分層檢查，與 ui 的 `npm test`、`vue-tsc`、build 全過。
