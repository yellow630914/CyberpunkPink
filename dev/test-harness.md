# 測試基礎建設規格（cpp-architect 在 M0 實作）

## 1. 狀態工廠
- `makeState(overrides)`：用最少的資料建立合法的遊戲狀態，不讀完整的內建世界。
- 預設情境：空房間、一位主角、固定種子。常用情境做成具名的建構函式（一場一般遭遇、一場首領戰、一個委託副本的第一階段、一場成人場景、一場輿論戰）。
- 理由：ElondiaRPG 的測試約 200 個檔靠「真實資料」建狀態，跟著搬得重寫（CODESCAN 2.8）。
- M1 已經有的（`engine/src/testkit/battle.ts`）：
  - 具名的情境 `BATTLE_SETUPS`：`encounter`（一般遭遇：四個雜兵）、`encounterElite`（兩個雜兵加一個精英）、`boss`（首領戰：一個首領加三個雜兵）、`capture`（敵人打感載、要活的）、`hopeless`（一定打輸，測戰敗用）。每一個都可以給等級。單位的數字是設計書的基準（敵人：ENEMIES 1.5 節的目標表；我方：BALANCE 2.2 節同級的主力），不讀資料檔。
  - `makeBattleGame({ battle, features, content, seed, … })`：一局已經開打的遊戲；`playOut(game)`：雙方都由程式選動作，打到分出結果；`fixDice(run, [骰面…])`：把一個 `BattleRun` 的骰釘死（規則的測試一顆一顆驗）。
  - `TEST_COMBAT`：一組最小的行動（攻擊、換彈、監視），讓核心的測試、冒煙、探針不必等現實戰鬥的功能。正式的行動表在 `features/combat`。
  - `engine/tests/helpers/battle.ts`（測試共用）：`arena()` 建一場不經過提交的戰鬥、`duel()` 幾對幾的小場地、`one()`／`foe()` 一個我方或敵方的單位。
- M2 加的（`engine/src/testkit/activity.ts`；dev/adr/0016）：
  - `TEST_ACTIVITY`：玩具活動（種類 `toy`，狀態放 `state.ext.toy`：`{ id, steps, goal, origin }`），給核心與下游的測試當替身，不必等事件、成人場景、委託副本做完。裝在 `makeGame` 的 `features` 裡。放行 `toy.`、`commit:toy.`，其餘全擋（`玩具活動進行中，先把它做完。`，order 20）；要讓它放行別的事用 `game.k.activity.allow('toy', 前綴, 主人)`。
  - 開始：`game.launch('toy', setup, origin?)` 或一份報告的 `launch`；`setup` 是 `{ goal?, refuse?, then? }`（`refuse` 是開不成的原因，一條一句，測 `launch` 開不成的回滾；`then` 是開始的那份報告自己帶的 `launch`，測連開幾層）。走一步 `toyStep(state)`、結束 `toyEnd(k, state, outcome?)` 都回傳報告草稿；`toyEnd` 同時是「活動的主人怎麼用 `endActivity`、`attachActivityEnd` 組結束的那一份報告」的範例（發 `activity.end`，`kind: 'toy'`，`result: { steps, goal }`）。`toyOf(state)` 讀現在的狀態。
- M2 加的（`engine/src/testkit/factory.ts`；dev/work/M2-core-shell.md）：變更 `snapshot.take` 要核心有序列化函式（`k.serialize`）。`makeGame` 建的 `Game` 自己就帶了（外殼注入的 `snapshotText`）；只有核心、沒有外殼的測試用 `makeKernel(features?)`（`createKernel` 加上序列化函式）、`makeStateKernel()`（`createStateKernel` 加上序列化函式，只測 L3 用）或直接拿 `TEST_SERIALIZE`（和 Game 注入的同一個，寫出來的文字可以交給 `unpackSave`、`Game.rewind`）。沒注入時 `snapshot.take` 不合法。
- M2 加的（`engine/src/testkit/meters.ts`；dev/adr/0016 第三節、dev/work/M2-core-meters.md）：核心自己不定義任何一種量表，下游功能的測試要用敵對值、好感、警戒這類數字時不必等管它們的功能做完：`testMeter(覆蓋?)` 回傳一個預設的量表定義（種類 `mood`、名字「心情」、0～100、起始 0、不分對象），`meterFeature(...定義)` 把它們裝上去（`makeGame({ features: [meterFeature(testMeter({ kind: 'favor', keyed: 'faction' }))], content: [METER_CONTENT] })`）。勢力與人的鍵要在內容裡查得到：`METER_CONTENT` 是假的兩個勢力（`f_alpha`、`f_beta`）與一位具名的人（`npc_ann`）；區的鍵要 `district` 這種內容種類（測試自己 `content.defineKind` 一個，或裝世界的功能）。定義之後同名的效果與條件自動有（`k.effects.resolve`、`k.conditions.test`）；讀數字用 `meterOf(k, state, kind, key?)`。範例在 `engine/tests/core/meters.test.ts`；第 2 版的舊檔在 `engine/tests/fixtures/saves/v2-m1.json`（含一份第 2 版的階段快照）。
- 「像副本」的流程（測撤退、委託失敗、`rewindToStage`）：`makeGame({ features: [TEST_COMBAT] })`，先提交一份第一筆是 `{ op: 'snapshot.take', kind: 'entry', owner, label }` 的報告、再提交 `kind: 'stage'`（帶 `replace: true`）的報告，`game.startBattle(BATTLE_SETUPS.hopeless())` → `playOut` → `await game.finishBattle()` 就停在等著選的戰敗；範例在 `engine/tests/core/shell-m2.test.ts` 的「Game.rewindToStage」。帶 `rewind` 的報告、`game.commitNarrated(草稿, { mode })`（`makeGame({ fake: true })` 看服務商收到的請求：`sectionOf(req, 'mode')`、`req.adult`）的範例在同一個檔。

## 2. 探針介面
- 在 L3～L5 開唯讀的觀察點：提交報告前後、每一個掛鉤被呼叫時、登錄表註冊時、任務鏈每一步的狀態變化。
- `probe.start()` / `probe.stop()` 回傳一串事件；正式版建置時不啟用、不影響效能。
- 事件帶時間順序、來源模組、內容的快照。

## 3. 假的 AI 服務商
- 實作和真的服務商同一個介面。
- 劇本模式：照測試給的回應依序回傳。
- 對抗模式：壞掉的 JSON、超出上限的數值、不存在的 id、少欄位、多欄位、拒絕（refusal）、逾時、串流中斷、`asked` 對不上、少交 `<covered>`。
- 記錄每一次收到的請求，讓測試檢查請求裡有沒有 `<results>`、`<previous_error>` 等。

## 4. 種子重播
- 測試失敗時把種子、初始狀態的建構方式與輸入序列存成 `engine/tests/fixtures/repro/<id>.json`。
- 一個共用的測試會自動把 repro 資料夾裡的每一份重播一次，變成回歸測試。

## 5. 分層檢查腳本
- 掃描 import，違反 CODESCAN 第 3 節的規則就讓測試失敗（L6 之間互相 import、下層 import 上層）。

## 6. 四種測試

### 冒煙（engine/tests/smoke/）
固定種子、AI 關閉。主幹隨批次長大：
- M0：開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退
- M1 加：一場現實戰鬥打完、戰敗事件（略過版）。核心版在 `engine/tests/smoke/m1.test.ts`（測試用的行動表與具名的情境）；功能版在 `engine/tests/pending/M1-smoke-features.test.ts`，M1 的功能工單做完之後搬進 `tests/smoke/`
- M2 加：接委託 → 副本走完一個階段；移動觸發事件導演；每週帳單結算
- M3 加：潛入內海、一場網內戰鬥
- 之後每一批加一步
整套要在一分鐘內跑完。

### 探針（engine/tests/probe/）
每支腳本對一個系統：建情境 → 開探針 → 執行 → 輸出事件串。

### 白箱
`vitest --coverage` 只跑目標模組；目標是分支覆蓋，不是行數。

### 邊界
fast-check 做性質測試；AI 相關的用假服務商的對抗模式。
