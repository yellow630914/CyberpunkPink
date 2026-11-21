# M0-creation

- 交給：cpp-feature
- 目標：做出「建角」這個功能：檢查建角草稿的每一步（基本資料、出身、屬性、基本功、特質），並把合格的草稿變成一份放進主角的報告。介面現有的建角規則（`ui/src/lib/creation.ts`）搬進引擎的就是這一張。
- 規格出處：CHARACTER 第 1 節（步驟表的第 1～4、7 步）、第 2 節（出身的表與下面三條說明）、5.1、5.3、5.4 節（只看「起始的錢」那一條）、5.6 節；UI 第 14 節裡年齡的那一條。只讀這幾處。
- 可以改的路徑：`engine/src/features/creation/`（新增）、`engine/src/features/index.ts`（加一行）、`engine/tests/features/`、`engine/tests/smoke/`（只為了搬 `M0-smoke-features`）、`engine/tests/pending/M0-creation.test.ts` 與 `engine/tests/pending/M0-smoke-features.test.ts`（只在搬檔時動）。
- 可以用的介面（都從 `engine/src/core` import，寫成 `import { ... } from '../../core'`）：
  - `Feature`、`Kernel`、`GameState`、`Actor`、`ReportDraft`、`AttrId`、`ATTR_IDS`、`SkillId`。
  - 內容：`k.content.get<CreationRuleEntry>('creation_rule', 'default')`、`k.content.get<OriginEntry>('origin', id)`、`k.content.get<PerkEntry>('perk', id)`、`k.content.has('skill', id)`（型別在 `engine/src/core/content/kinds.ts`）。
  - 存檔規則裡可以調的三個數字：`state.rules.startSkillPoints`、`state.rules.startSkillMax`、`state.rules.startPerkPoints`、`state.rules.startMoney`（CHARACTER 5.6 節；以存檔規則為準，不讀 `creation_rule` 裡的同一個數字）。
  - 生命值上限：`k.stats.hasStat('max_hp')` 是 true 才用 `k.stats.stat(狀態, 角色 id, 'max_hp')`。
  - 變更（`engine/src/core/state/coreChanges.ts`，都是核心已經有的）：`actor.add`、`pc`、`cash`、`cred`。角色骨架的格式看 `validateActor`。
  - 年齡的下限：`MIN_AGE`（核心匯出，18）。
  - 複製：`clone`。
- 不可以做的事：
  - 不直接改狀態；不 import 別的功能（特質的價錢直接讀內容，不 import `features/perks`）、`shell/`、`testkit/`、任何套件。
  - 不做第 5 步（生命軌跡）、第 6 步（橋與義體）、第 8 步（技能樹）、第 9 步（裝備）：那些系統還沒搬進來，介面那邊先留著原本的假資料。
  - 需要核心沒有的東西就停下來回報。
- 驗收測試：`engine/tests/pending/M0-creation.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-creation`。通過之後 `git mv engine/tests/pending/M0-creation.test.ts engine/tests/features/M0-creation.test.ts`，再跑 `npm test` 與 `npx tsc --noEmit`，都要過。
  - 另外有一份整合的冒煙測試 `engine/tests/pending/M0-smoke-features.test.ts`，要 M0-data、M0-character、M0-perks 與這一張都完成才會過。四張裡最後完成的那一張負責讓它通過，然後 `git mv` 到 `engine/tests/smoke/m0-features.test.ts`。這一張完成時如果另外三張還沒好，回報裡註明它還在 pending。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 要交的東西

`engine/src/features/creation/index.ts`，匯出下面這些（名字與型別要一模一樣，介面那邊照這個接）。做完在 `engine/src/features/index.ts` 的 `FEATURES` 加上 `creationFeature`。

```ts
export const creationFeature: Feature   // id 是 'creation'；install 裡現在沒有東西要註冊，留空函式

export type CreationStep = 'basics' | 'origin' | 'attrs' | 'skills' | 'perks'
export interface CreationBlock { step: CreationStep; reason: string }

export interface CreationDraft {
  name: string
  gender: string                 // female、male、femboy、trans_f、trans_m、futa（DATA 第 1 節）；這一批不檢查是哪一個，原樣存
  pronoun?: string
  age: number | string
  look?: Record<string, string>  // 外觀的下拉選的結果，原樣存
  lookNote?: string              // 手動補充的外觀
  background?: string
  origin: string                 // 出身的 id
  originChoice?: { favor?: string }   // 好感給哪個勢力（出身的 favor.choose_one 有兩個以上時要選）
  attrPick: Partial<Record<AttrId, number>>    // 六個數字各分給哪一項
  attrBonus: Partial<Record<AttrId, number>>   // 每一項的增減：正的花自由點數，負的是往下壓
  skills: Record<SkillId, number>              // 買的基本功等級（不含出身送的 +1）
  perks: string[]                              // 買的特質與缺陷（不含出身特質）
}

export function ageBlock(raw: string | number): string | null
export function attrTotals(pick, bonus): Record<AttrId, number>
export function attrBudget(k: Kernel, bonus): { total: number; lowered: number; spent: number; left: number }
export function attrBlock(k: Kernel, pick, bonus): string | null
export function skillLeft(k: Kernel, state: GameState, levels: Record<SkillId, number>): number
export function skillBlock(k: Kernel, state: GameState, levels: Record<SkillId, number>): string | null
export function perkSummary(k: Kernel, state: GameState, picked: string[]): { left: number; perks: number; flaws: number }
export function perkBlock(k: Kernel, state: GameState, picked: string[]): string | null
export function creationBlocks(k: Kernel, state: GameState, draft: CreationDraft): CreationBlock[]
export function buildCreationReport(k: Kernel, state: GameState, draft: CreationDraft): ReportDraft
```

回傳 `string | null` 的函式：`null` 是沒問題，字串是擋住的原因，**給玩家看的完整句子**。全部都是純函式，不改傳進來的東西。

`creation_rule/default` 沒有載入時用這組預設值：`attr_array [15,14,13,12,10,8]`、`attr_free 2`、`attr_max 18`、`attr_min 4`、`perk_max 8`、`flaw_max 2`。

### 和介面現有程式的對照（`ui/src/lib/creation.ts` → 引擎）

| 介面現在的函式 | 引擎的 | 差別 |
|---|---|---|
| `ageBlock` | `ageBlock` | 一樣 |
| `attrTotals` | `attrTotals` | 屬性的鍵從中文名改成 id（`body`……） |
| `attrBudget` | `attrBudget(k, bonus)` | 數字從 `creation_rule` 讀 |
| `attrBlock` | `attrBlock(k, pick, bonus)` | 同上 |
| `attrMod` | 核心的 `attrMod` | 已經在核心，不用寫 |
| `basicLeft`、`basicStepBlock` | `skillLeft`、`skillBlock` | 點數與上限從 `state.rules` 讀；檢查的是整份，不是按一下 |
| `traitSummary`、`traitPickBlock`、`traitBlock` | `perkSummary`、`perkBlock` | 吃特質的 id，價錢與是不是缺陷從內容讀 |
| `freeValues`、`attrStepBlock`、`fmtMod` | 不搬 | 只是畫面的下拉選單、± 按鈕與顯示，留在介面 |
| `cyberSummary`、`cyberPickBlock`、`cyberBlock` | 不搬（M4 義體） | |
| `gearPoints`、`gearItemBlock`、`gearSummary`、`gearAddBlock`、`fitKit` | 不搬（M1 裝備） | |
| `styleTags`、`derivedLooks` | 不搬（之後的外觀推導） | |

### 每個函式的規則

**`ageBlock(raw)`**：先 `String(raw).trim()`。不是純數字（`/^\d+$/`）回傳 `年齡要填整數。`；小於 18 回傳 `所有角色都是成年人：年齡要 18 以上。`；大於 200 回傳 `年齡填不到這麼大。`；否則 `null`。

**`attrTotals(pick, bonus)`**：六項屬性各是 `(pick[屬性] ?? 0) + (bonus[屬性] ?? 0)`。

**`attrBudget(k, bonus)`**：`lowered` 是所有負的 `bonus` 的絕對值加總；`spent` 是所有正的加總；`total = attr_free + lowered`；`left = total − spent`。

**`attrBlock(k, pick, bonus)`**，照這個順序檢查，回傳第一個碰到的：

1. 有屬性還沒分配（`pick[屬性] === undefined`）：`還有 N 項屬性沒有分配。`
2. `pick` 的六個值不是剛好把 `attr_array` 的每個數字各用一次：`每個數字只能用一次。`
3. `spent > total`：`自由點數只有 N 點。`（N 是 `total`）
4. `left > 0`：`還有 N 點自由點數沒有用。`（自由點數要剛好用完）
5. 有一項加總超過 `attr_max`：`單項最高 18。`（數字用 `attr_max`）
6. 有一項加總低於 `attr_min`：`單項最低 4。`（數字用 `attr_min`）

`bonus` 裡不是整數的值：回傳 `屬性的增減要是整數。`（放在第 1 步之前）。

**`skillLeft(k, state, levels)`**：`state.rules.startSkillPoints − 所有等級的加總`。

**`skillBlock(k, state, levels)`**，回傳第一個碰到的：

1. 有等級不是 0 以上的整數：`基本功的等級要是 0 以上的整數。`
2. 有 id 不存在（`k.content.has('skill', id)` 是 false；等級是 0 的不檢查）：`沒有「<id>」這項基本功。`
3. 有一項超過 `state.rules.startSkillMax`：`建角時單項最高 N 級。`
4. 加總超過 `state.rules.startSkillPoints`：`基本功的點數只有 N 點。`

點數不必用完。

**`perkSummary(k, state, picked)`**：`perks` 是不是缺陷的個數，`flaws` 是缺陷的個數，`left = state.rules.startPerkPoints + 缺陷的 cost 加總 − 特質的 cost 加總`。內容裡找不到的 id 不算。

**`perkBlock(k, state, picked)`**，回傳第一個碰到的：

1. 有重複的 id：`同一個特質不能選兩次。`
2. 有 id 在內容裡找不到：`沒有「<id>」這個特質。`
3. 有分類是 `origin` 的：`出身特質是出身送的，不能用點數買。`
4. 缺陷超過 `flaw_max`：`缺陷最多 2 個。`
5. 特質（不含缺陷）超過 `perk_max`：`特質最多 8 個。`
6. `left < 0`：`特質點超過了 N 點。`

點數不必用完。

**`creationBlocks(k, state, draft)`**：照 `basics`、`origin`、`attrs`、`skills`、`perks` 的順序，**每一步最多回報一筆**（那一步第一個碰到的問題）；沒有問題的步驟不出現。全部沒問題回傳空陣列。

- `basics`：`state.pc` 不是 `null` → `已經有主角了。`；名字 `trim()` 之後是空的 → `要有名字。`；`gender` 是空的 → `要選性別。`；`ageBlock(draft.age)` 的結果。
- `origin`：出身不存在 → `沒有這個出身。`；`favor.choose_one` 有兩個以上，而 `draft.originChoice?.favor` 沒有寫或不在清單裡 → `要選一個勢力：<清單，用頓號隔開>。`（只有一個可以選的出身不用選，自動用那一個。）
- `attrs`：`attrBlock` 的結果。
- `skills`：`skillBlock` 的結果。
- `perks`：`perkBlock` 的結果。

**`buildCreationReport(k, state, draft)`**：

1. `creationBlocks` 不是空的：`throw new Error(第一筆的 reason)`。
2. 組出主角（`Actor`）：
   - `id: 'pc'`、`role: 'pc'`、`name`（`trim()` 過）、`age`（轉成數字）、`gender`。
   - `attrs`：`attrTotals` 的結果。
   - `skills`：`draft.skills` 裡等級大於 0 的，再加上出身的 `skill_bonus`（可以超過建角的單項上限，例如 3 → 4）。
   - `perks`：`[出身的 perk, ...draft.perks]`。
   - `load: 0`、`afterglow: 0`、`sink: 0`、`conditions: []`。
   - `ext.origin`：`{ id: 出身的 id, favor: 選的那個勢力, favorValue: 出身的 favor.value, status: 出身的 status, home: 出身的 home, roster: 出身的 roster }`。
   - `ext.profile`：`{ pronoun, look, lookNote, background }`（沒有寫的欄位不放）。
   - `hp`：先放 1。如果 `k.stats.hasStat('max_hp')`：把這個角色放進一份複製的狀態（`clone(state)` 之後直接塞進 `actors`），用 `k.stats.stat(複製的狀態, 'pc', 'max_hp')` 算出上限，`hp` 用那個值。
3. 回傳：

```ts
{
  kind: 'system', action: 'creation.commit', location: clone(state.location), actor: 'pc',
  party: [], timeline: [],
  changes: [
    { op: 'actor.add', actor },
    { op: 'pc', id: 'pc' },
    { op: 'cash', delta: state.rules.startMoney },   // startMoney 是 0 就不放這一筆
  ],
  outcome: { result: 'created', summary: `${actor.name}的故事從${出身的 name}開始。` },
}
```

呼叫的人（介面的 store、測試）用 `game.commit(報告草稿)` 提交；這個函式自己不提交。

## 已知的規格問題（照下面的假設做，不用停下來）

1. 起始的錢放在帳戶還是現金晶片，設計書沒有寫。先放現金（`cash`）；驗收測試只驗總數。
2. 出身對起始的錢的加減（CHARACTER 5.4 節「企業出身多、街頭出身少」）沒有數字，這一批不做。
3. 出身給的好感、名冊上的人、起始的身分與住處，對應的系統（勢力、名冊、住處）還沒搬進來，先原樣記在 `ext.origin`，之後的批次再接。
