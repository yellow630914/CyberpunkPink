# M0-character

- 交給：cpp-feature
- 目標：做出「角色」這個功能：把生命值上限、感載上限、行動點上限、RAM 上限、承受層數的公式，重傷的檢定懲罰，以及三條軌的效果與條件，註冊到核心的登錄表。
- 規格出處：CORE_RULES 第 1 節（有效屬性那一條）、第 3 節（「重傷」那一條）、4.1 節、4.2 節（只看開頭的公式與「主角的基礎是 3 層」那一句）；COMBAT_SYSTEM 第 45 行的行動點公式；CYBERSPACE 第 278 行的 RAM 公式；EVENTS 2.4 節（只看 `hp`、`load`、`afterglow` 與 `sink` 兩列）。只讀這幾處。
- 可以改的路徑：`engine/src/features/character/`（新增）、`engine/src/features/index.ts`（加一行）、`engine/tests/features/`、`engine/tests/pending/M0-character.test.ts`（只在搬檔時動）。
- 可以用的介面（都從 `engine/src/core` import，寫成 `import { ... } from '../../core'`）：
  - `Feature`、`Kernel`：`engine/src/core/kernel.ts`。功能是一個物件 `{ id, install(k) }`。
  - 衍生數值與檢定修正：`k.stats`（`engine/src/core/rules/stats.ts`）的 `defineStat`、`addCheckModifier`、`effectiveAttr`、`stat`。
  - 調整值：`attrMod`（`engine/src/core/rules/check.ts`）。
  - 效果：`k.effects.register`（`engine/src/core/rules/effects.ts` 的 `EffectDef`）。範例看 `engine/src/core/rules/coreEffects.ts` 的 `cred`、`cash`。
  - 條件：`k.conditions.register`（`engine/src/core/rules/conditions.ts` 的 `ConditionDef`）。範例看同一個檔的 `registerCoreConditions`。
  - 變更：效果的 `toChanges` 回傳核心已經有的 `{ op: 'actor.track', id, track: 'hp' | 'load' | 'sink' | 'afterglow', delta }`（`engine/src/core/state/coreChanges.ts`）。**不要註冊新的變更種類。**
  - 測試用的狀態：`makeState`（`engine/src/testkit/factory.ts`）。
- 不可以做的事：
  - 不直接改狀態；不 import 別的功能（`features/` 底下別的資料夾）；不 import `shell/`、`testkit/`、任何套件。
  - 不做這張工單沒列的東西：過載、餘韻的效果與消退、沉溺的分段與它對檢定的加減、感載的敏感度倍率、戰鬥、義體的屬性來源，都是之後的批次。
  - 需要核心沒有的東西（新的變更種類、新的掛點、報告欄位）就停下來回報。
- 驗收測試：`engine/tests/pending/M0-character.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-character`。通過之後 `git mv engine/tests/pending/M0-character.test.ts engine/tests/features/M0-character.test.ts`，再跑 `npm test`（含分層檢查）與 `npx tsc --noEmit`，都要過。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 要交的東西

`engine/src/features/character/index.ts` 匯出 `characterFeature: Feature`，`id` 是 `'character'`。可以拆成幾個檔（`stats.ts`、`effects.ts`……），都放在這個資料夾裡。做完在 `engine/src/features/index.ts` 的 `FEATURES` 加上它（那個檔的註解有寫法）。

### 1. 衍生數值（`k.stats.defineStat`）

| id | 名字 | 公式 | 出處 |
|---|---|---|---|
| `max_hp` | 生命值上限 | `20 + 體格 × 2` | CORE_RULES 4.1 節 |
| `load_cap` | 感載上限 | `20 + floor(耐受 ÷ 2) + mod(意志) × 3` | CORE_RULES 4.2 節 |
| `ap_max` | 行動點上限 | `4 + floor((mod(反應) + mod(魅力)) ÷ 2)` | COMBAT_SYSTEM 第 45 行 |
| `ram_max` | RAM 上限 | `4 + mod(智識)`，最少 4 | CYBERSPACE 第 278 行 |
| `afterglow_cap` | 承受層數 | 3 | CORE_RULES 4.2 節（主角的基礎） |

- 屬性一律用 `stats.effectiveAttr(state, actor, 屬性)`（有效屬性），不要直接讀 `actor.attrs`。
- 耐受是橋參數，橋的系統還沒搬進來：讀 `state.actors[actor].ext.bridge?.tolerance`，不是數字就當 0。
- `ram_max` 的「最少 4」用 `defineStat` 的 `min: 4`。
- `afterglow_cap` 現在每個人都是 3（敵人的層數照位階，是 M1 的事）。

### 2. 重傷（`k.stats.addCheckModifier`）

生命值低於上限的一半（`actor.hp * 2 < max_hp`）：所有檢定 −2。回傳 `[{ label: '重傷', value: -2, source: 'condition' }]`；沒有重傷回傳空陣列。剛好一半不算。

### 3. 三個效果（`k.effects.register`）

三個的格式都是 `{ kind, amount }`，`amount` 是不為 0 的整數（不是的話 `validate` 回傳錯誤訊息）。落在 `ctx.actor` 身上。

| kind | AI 自己給的時候的上限（`clamp`） | 轉成變更時（`toChanges`，不論誰給的都算） |
|---|---|---|
| `hp` | 不會讓人倒下：扣完最少剩 1。原本就只剩 1 以下時不能再扣 | 補的不超過 `max_hp`；扣的不低於 0 |
| `load` | 不會讓人過載：加完最多到 `load_cap − 1` | 退的不低於 0（加的不設上限：過載是戰鬥的事） |
| `sink` | 一次 ±3 | 不低於 0 |

- `clamp` 只處理上限：值沒有被改就回傳 `{ effect }`；被改了回傳 `{ effect: 改過的, note: { from, to, limit, notice } }`。夾到變成 0 的回傳 `{ effect: null, note }`（整筆拿掉）。核心只在該夾的時候才呼叫 `clamp`（內建的事件不夾），這一段不用自己判斷來源。
- `toChanges` 回傳 `[{ op: 'actor.track', id: ctx.actor, track: kind, delta }]`；算出來 `delta` 是 0 就回傳空陣列。
- `describe` 與 `note.notice` 是給玩家看的白話，不可以出現欄位名稱（`amount`、`hp`、`load`、`sink`）。例：`生命：受了一點傷`、`感載：往上衝了一截`、`沉溺：往回拉一點`；被夾的提醒例：`這一下本來會讓你倒下，實際只剩一口氣。`

### 4. 兩個條件（`k.conditions.register`）

| kind | 欄位 | 成立的時候 |
|---|---|---|
| `wounded` | 無 | 這個角色重傷（和第 2 點同一個判斷） |
| `track` | `track`（`hp`、`load`、`sink`、`afterglow` 其中一個）、`min?`、`max?` | 那一條軌的值在範圍內 |

看誰：`ctx.actor ?? ctx.state.pc`。`validate`：`track` 不是那四個之一就回傳一筆錯誤。

## 提醒

- 第 2 點與 `wounded` 的判斷寫成一個函式共用。
- 註冊的 `owner` 一律寫 `'character'`。
