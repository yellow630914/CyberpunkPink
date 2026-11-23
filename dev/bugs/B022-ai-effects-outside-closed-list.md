# B022：AI 生成的效果可以直接給 debt、bargain，bill 的新項目也沒有金額上限（EVENTS 2.4 的封閉清單沒有擋）
- 發現者：cpp-tester-whitebox（M2 白箱：對每一種註冊的效果用 `source: 'ai'` 交難看的值）
- 嚴重度：錯誤（AI 回的結果在驗證與夾值之後照樣能把玩家的帳弄壞：一個九十億的帳單項目、或一筆十億本金、週利率 100% 的債；殺價不擲骰就拿到大成功）
- 規格出處：EVENTS 2.4 節「事件只能產生下表的效果。上限只管 AI 自己生成的事件……」與 2.4.1 節「AI 自己生成的事件也只能用這些名稱」；同一張表的 `cred`／`cash` 上限（信譽那一階的委託報酬下限 × 0.5，新手 120）；AI_TASKS 2.5 節（AI 的結果驗證過、夾過才寫入）；GAME_DESIGN 第 3 節（引擎是唯一真相，AI 只交結構化的結果）。
- 實際行為：效果登錄表沒有「AI 可以用哪些」的清單，34 種註冊的效果 AI 都能直接給。用 `source: 'ai'` 試出來：
  - `{ kind: 'debt', to: 'f_corp', amount: 1000000000, rate: 1 }`：沒有錯誤、沒有夾值，變成 `bills.debt`（本金十億、週利率 100%）。`debt` 不在 2.4 的表裡，是併債與事件資料用的內部效果。
  - `{ kind: 'bargain', shop, method: 'haggle', degree: 'critical' }`：沒有錯誤、沒有夾值，直接寫進今天這間店的價錢 ×0.8，店主親密度 +2；不用擲骰。`bargain` 也不在 2.4 的表裡，是殺價擲出結果之後 trade 自己發的效果。
  - `{ kind: 'bill', name, amount: 9000000000, weeks: 520, pay: 'cred' }`：2.4 的表有「`bill`（新項目）」這一列，上限那一欄是空的，引擎照沒有上限處理；對照 `cred` 是夾在 120 的。
  對照：同一批用 `source: 'builtin'` 本來就該照寫的算（內建的事件資料與程式結算要能用這三種）。其餘的效果都有夾（`cash` 一百萬夾成 120、`rep` 夾 ±3、`grace` 夾 7 天、`item` 100 個、`owed`／`owed_to_pc` 大的拿掉、`hp`／`load`／`sink` 夾在不倒下）。
- 重現：engine/tests/whitebox/fixtures/B022-ai-effects-outside-closed-list.json（三筆）；會失敗的測試 engine/tests/pending/B022-ai-effects-outside-closed-list.test.ts（三筆照預期失敗，「內建的照常可以用」會過）。
- 可能的位置（只寫推測，不改）：`engine/src/core/rules/effects.ts` 的 `EffectRegistry`（`EffectDef` 加一個 `ai: false` 之類的旗標，`resolve` 在 `source` 是 `ai`／要夾的玩家要求時，遇到不能用的整批驗證不過）；`engine/src/features/bills/index.ts` 的 `bill` 效果（新項目的 `amount` 加 `budget` 或 `clamp`，上限照 `cred` 的那一格）；`debt` 與 `bargain` 寫旗標。要不要讓 AI 用 `debt` 是設計決定（EVENTS 2.4 沒寫它），由使用者與 cpp-architect 定。
