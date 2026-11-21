# M0-perks

- 交給：cpp-feature
- 目標：做出「特質」這個功能：角色身上的特質與缺陷照資料變成檢定的修正與衍生數值的加減，並提供給特質、拿掉特質的效果與一個條件。
- 規格出處：CHARACTER 4.1、4.3、4.4 節（只看最後「特質的總數上限是 8 個」那一條）、5.2、5.3 節。只讀這幾節。
- 可以改的路徑：`engine/src/features/perks/`（新增）、`engine/src/features/index.ts`（加一行）、`engine/tests/features/`、`engine/tests/pending/M0-perks.test.ts`（只在搬檔時動）。
- 可以用的介面（都從 `engine/src/core` import，寫成 `import { ... } from '../../core'`）：
  - `Feature`、`Kernel`：`engine/src/core/kernel.ts`。
  - 特質的資料：`k.content.get<PerkEntry>('perk', id)`、`k.content.list<PerkEntry>('perk')`。`PerkEntry` 的欄位在 `engine/src/core/content/kinds.ts`（`checks`、`stats`、`flaw`、`category`、`cost`）。
  - 建角的數字：`k.content.get<CreationRuleEntry>('creation_rule', 'default')?.perk_max`，沒有載入時用 8。
  - 檢定修正與衍生數值的來源：`k.stats.addCheckModifier`、`k.stats.addStatProvider('*', owner, fn)`（`engine/src/core/rules/stats.ts`；`'*'` 表示每一個數值都會問你，第三個參數是數值的 id）。
  - 效果：`k.effects.register`（`engine/src/core/rules/effects.ts`）。變更用核心已經有的 `{ op: 'actor.perk', id, perk, remove? }`。
  - 條件：`k.conditions.register`（`engine/src/core/rules/conditions.ts`）。
  - 測試用的內容：`engine/tests/helpers/miniContent.ts` 的 `MINI_PACK`（不要改它）。
- 不可以做的事：
  - 不直接改狀態；不 import 別的功能、`shell/`、`testkit/`、任何套件。
  - 不自己定義 `max_hp` 這些衍生數值（那是「角色」功能的事；這個功能只加來源）。
  - 不做：特質點的預算（那是建角功能的事）、取得特質的機會（三選一、受訓、老師）、自訂特質、收入類的效果。
  - 需要核心沒有的東西就停下來回報。
- 驗收測試：`engine/tests/pending/M0-perks.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-perks`。通過之後 `git mv engine/tests/pending/M0-perks.test.ts engine/tests/features/M0-perks.test.ts`，再跑 `npm test` 與 `npx tsc --noEmit`，都要過。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 要交的東西

`engine/src/features/perks/index.ts` 匯出 `perksFeature: Feature`，`id` 是 `'perks'`。做完在 `engine/src/features/index.ts` 的 `FEATURES` 加上它。

所有的登錄都在 `install(k)` 裡做。處理函式是在檢定當下才去讀內容，所以不需要 `ready`。

### 1. 檢定的修正（`k.stats.addCheckModifier('perks', fn)`）

對角色的每一個特質 id（`state.actors[actor].perks`）：

1. `k.content.get('perk', id)` 找不到：略過（模組拿掉了那個特質），不丟錯。
2. 沒有 `checks`：略過。
3. `checks.skills` 有寫：`ctx.skill` 要在裡面，否則略過。
4. `checks.tags` 有寫：每一個標籤都要在 `ctx.tags` 裡，否則略過。
5. 符合：回傳一筆 `{ label: 特質的 name, value: checks.bonus, source: 'perk' }`。

缺陷是同一套（`bonus` 是負的）。一個角色有好幾個符合的就回傳好幾筆。

### 2. 衍生數值的來源（`k.stats.addStatProvider('*', 'perks', fn)`）

`fn(state, actor, stat)`：對角色的每一個特質，`stats?.[stat]` 是數字就回傳一筆 `{ label: 特質的 name, value: 那個數字, source: 'perk' }`。內容裡找不到的特質略過。

### 3. 效果 `perk`

格式：`{ kind: 'perk', id: <特質 id>, remove?: true }`，落在 `ctx.actor` 身上。

`validate(raw, ctx)` 回傳錯誤訊息的情況：

- 沒有 `id`，或 `ctx.content.get('perk', id)` 找不到（訊息要有「不存在」三個字）。
- 給特質（沒有 `remove`）：角色已經有了；或這個特質不是缺陷、分類也不是 `origin`，而角色身上「不是缺陷、分類不是 `origin`」的特質已經有 `perk_max` 個（訊息要寫出那個數字，例：`特質最多 8 個，要先放掉一個。`）。
- 拿掉（`remove: true`）：角色沒有這個特質。

算上限時，角色身上在內容裡找不到的特質不算。不需要 `clamp`。

`toChanges`：`[{ op: 'actor.perk', id: ctx.actor, perk: effect.id, ...(effect.remove ? { remove: true } : {}) }]`。

`describe`：白話，要有特質的名字。例：`學會：能言善道`、`染上：舊傷`（缺陷）、`放掉：能言善道`。

### 4. 條件 `has_perk`

`{ kind: 'has_perk', perk: <id> }`：`ctx.actor ?? ctx.state.pc` 這個角色有沒有這個特質。`validate`：`perk` 不是字串就回傳一筆錯誤。

## 提醒

- 註冊的 `owner` 一律寫 `'perks'`。
- 同一批效果是對同一個狀態驗的（核心先全部驗完才套），所以「先放掉一個再拿一個」要分兩次給；這是核心的行為，不用處理。
