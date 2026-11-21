# M0-actions

- 交給：cpp-feature
- 目標：做出「行動種類」這個功能：把資料裡的每一筆 `action_kind`（乞討、打聽、撬鎖……）註冊成核心的行動種類，包含能不能做的條件與照成功程度、照這一區等級的參考範圍。
- 規格出處：AI_TASKS 3.1 節（整節，重點是第 3 步「參考範圍」與下面乞討的例子）、2.5 節第 4 個黑點（參考範圍是預設、不是上限）；CORE_RULES 第 3 節（DC 的階梯與成功程度）。只讀這幾處。
- 可以改的路徑：`engine/src/features/actions/`（新增）、`engine/src/features/index.ts`（加一行）、`engine/tests/features/`、`engine/tests/pending/M0-actions.test.ts`（只在搬檔時動）。
- 可以用的介面（都從 `engine/src/core` import，寫成 `import { ... } from '../../core'`）：
  - `Feature`、`Kernel`：`engine/src/core/kernel.ts`。這個功能要用第二段 `ready(k)`：內容載入之後才呼叫。
  - 行動種類：`k.actions.register(def)`，`ActionKindDef`、`HintCtx` 在 `engine/src/core/action/kinds.ts`。
  - 資料：`k.content.list<ActionKindEntry>('action_kind')`；`ActionKindEntry`、`ActionHint` 的欄位在 `engine/src/core/content/kinds.ts`。
  - 條件：`k.conditions.validate(cond)`（格式）、`k.conditions.test(cond, { state, stats: k.stats, timeRules: k.timeRules })`。
  - 效果的格式檢查：`k.effects.validate(list, ctx, path)`；`ctx` 用 `{ state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content }`（`blankState` 從核心 import）。
  - 複製：`clone`。
- 不可以做的事：
  - 不直接改狀態；不 import 別的功能、`shell/`、`testkit/`、任何套件。
  - 不寫行動的資料檔（`engine/data/rules/actions.json`）：設計書還沒有行動種類與參考範圍的表（見下面「已知的規格問題」），這一張只做機制，用測試自己帶的資料驗。
  - 不動核心內建的 `free`。不做協力、踩點、談判這些有自己流程的行動。
  - 需要核心沒有的東西就停下來回報。
- 驗收測試：`engine/tests/pending/M0-actions.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-actions`。通過之後 `git mv engine/tests/pending/M0-actions.test.ts engine/tests/features/M0-actions.test.ts`，再跑 `npm test` 與 `npx tsc --noEmit`，都要過。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 要交的東西

`engine/src/features/actions/index.ts` 匯出 `actionsFeature: Feature`，`id` 是 `'actions'`。做完在 `engine/src/features/index.ts` 的 `FEATURES` 加上它。

```ts
export const actionsFeature: Feature = {
  id: 'actions',
  install() {},          // 內容還沒載入，這一段沒有東西要註冊
  ready(k) { /* 讀 action_kind，檢查，註冊 */ },
}
```

### `ready(k)` 做的事

對 `k.content.list<ActionKindEntry>('action_kind')` 的每一筆 `e`，先檢查，再註冊。**任何一筆檢查不過就丟 `Error`，訊息要寫出是哪一筆行動（`e.id`）與原因**：

1. `e.skill` 有寫，而 `k.content.has('skill', e.skill)` 是 false：`行動 <id>：沒有 <skill> 這項基本功`。
2. `e.requires` 有寫：`k.conditions.validate(e.requires, 'requires')` 回傳的問題不是空的 → 把問題接在訊息裡（核心的訊息裡已經有條件種類的名字）。
3. `e.hint` 與 `e.hint_by_grade` 的每一級、每一個成功程度的效果清單：`k.effects.validate(清單, ctx, 'hint.<鍵>')` 回傳的問題不是空的 → 把問題接在訊息裡。
4. 註冊：`k.actions.register({...})`。和已經有的行動同名（例如 `free`）時核心會丟錯，不用自己擋。

註冊的內容：

| `ActionKindDef` 的欄位 | 來源 |
|---|---|
| `id`、`name`、`attr`、`skill`、`dc`、`minutes`、`tags` | 照資料（`skill`、`tags` 沒寫就不放） |
| `maxMinutes` | `e.max_minutes` |
| `owner` | `'actions'` |
| `reportKind` | `'action'` |
| `block(state, input)` | 沒有 `requires`：不放這個欄位。有：條件成立回傳 `null`，不成立回傳 `e.blocked_text` |
| `hint(ctx)` | 見下面；資料裡 `hint` 與 `hint_by_grade` 都沒寫：不放這個欄位 |

### 參考範圍 `hint(ctx)`

`ctx` 有 `degree`（`critical`、`success`、`fail`、`fumble`）、`narrow`（成功而且差距不到 3）、`grade`（這一區的等級 1～5）。

1. **選表**：`hint` 是 I 級的表，`hint_by_grade` 的鍵 `"2"`～`"5"` 是其他等級的表。用「不超過 `ctx.grade`、最近的那一級」的表：從 `ctx.grade` 往下找到第一個有表的等級（I 級就是 `hint`）。都沒有就回傳 `[]`。
2. **選成功程度**：
   - `critical` → 表的 `critical`；
   - `success` 而且 `narrow` → 表的 `narrow`，沒寫就用表的 `success`；
   - `success` → 表的 `success`；
   - `fail` → 表的 `fail`；`fumble` → 表的 `fumble`。
   - 那一份沒寫就回傳 `[]`。**不往別的等級的表找。**
3. 回傳的是**複製**的（`clone`），呼叫的人改它不會改到內容。

例（驗收測試用的乞討）：I 級的表 `critical` 現金 40、`success` 現金 20、`narrow` 現金 10；III 級的表只有 `success` 現金 200。在 II 級的區成功拿 20 的參考值（用 I 級的表），在 III、IV、V 級的區成功拿 200，在 III 級的區大成功是 `[]`（III 級的表沒寫 `critical`）。

## 已知的規格問題

設計書目前沒有「有哪些行動種類、每一種用什麼屬性與基本功、DC 是哪一檔、花多久、參考範圍是多少」的表；AI_TASKS 3.1 節只有乞討一個例子（蜂巢、成功：現金約 20、一件 I 級的消耗品）。所以這一張只做機制。表補上之後另外開一張給 cpp-data 的工單轉成 `engine/data/rules/actions.json`。
