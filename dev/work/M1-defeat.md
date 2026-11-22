# M1-defeat

- 交給：cpp-feature
- 目標：做一個功能 `defeat`：戰鬥打輸（全隊倒下）或投降之後，照贏的那一方的勢力選一個戰敗事件與版本，先列出會發生什麼（M1 只有略過版：一段敘事加上結果），等玩家選「接受結果」才結算。
- 規格出處：COMBAT_SYSTEM 8.3、8.4、8.5 節；ENEMIES 第 6 節只看表後面的三條（內容篩選的分支、照性別分版本）；DATA 第 5 節（戰敗事件的格式；這一張只用到 `versions` 的 `text` 與 `effects`）；AI_TASKS 3.14 節只看「略過」那一段。二十九種各自的分法與內容在 M2，不在這一張。
- 可以改的路徑：`engine/src/features/defeat/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `defeat`）、`engine/tests/features/`、`engine/tests/pending/M1-defeat.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import）：
  - 內容種類：`k.content.defineKind({ kind, owner, validate, refs })`（寫法照 `engine/src/core/content/kinds.ts`）。
  - 戰鬥結束時加變更：`k.battle.onEnd('defeat', ({ k, state, battle, outcome }) => ({ changes, lines }))`（`engine/src/core/battle/registry.ts`）。這時 `battle` 還在（`battle.origin.faction` 是贏的那一方的勢力，`battle.id`），`outcome` 是 `win`、`lose`、`fled`、`surrender`。
  - 報告套用之後接一份報告：`k.hooks.on('report.after', 'defeat', ({ state, report }) => ReportDraft[] | void)`（`engine/src/core/state/hooks.ts`）。處理函式只讀，不可以改 `state`。
  - 選版本與內容篩選：`pickVersion(gender, roll, { available })`、`resolveFiltered(state.rules, entry, get)`（`engine/src/core/rules/versions.ts`）。
  - 效果：`k.effects.resolve(effects, effectCtx(k, state, { source: 'builtin' }))` 回傳 `{ changes, lines, errors }`（`engine/src/core/rules/effects.ts`、`grades.ts`）；`lines` 是給玩家看的白話（「失去：現金 2,000」「時間：過了 6 小時」），扣的錢不會超過手上有的。
  - 導出的骰子：`deriveRng(state.rng, 用途的字串).next()` 回傳 0～1（`engine/src/core/util/rng.ts`）。
  - 狀態：這個功能的狀態放在 `state.ext.defeat`，用變更 `{ op: 'ext', key: 'defeat', value }` 寫（`value: null` 是清掉）。快照：`{ op: 'snapshot.drop', kind: 'battle' }`。
  - 存檔規則：`state.rules.defeatView`、`defeatMoneyLoss`（0～1）、`defeatMoneyCap`（數字或 `null`）、`contentOff`。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；不 import 別的功能。
  - 不寫戰敗事件的內容（資料在 `dev/work/M1-data-enemies.md`）。
  - 不自己做「重來這場戰鬥」：外殼已經有 `game.retryBattle()`（回到開打之前，`state.ext.defeat` 跟著回去）。不立委託失敗的旗標（委託在 M2）。
- 驗收測試：`engine/tests/pending/M1-defeat.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-defeat`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/defeat/index.ts`）

```ts
export const defeatFeature: Feature
export interface PendingDefeat {
  event: string                    // 戰敗事件的 id
  version: 'default' | 'masc' | 'yuri'
  faction?: string                 // 贏的那一方的勢力
  outcome: 'lose' | 'surrender'
  fails_commission: boolean
  lines: string[]                  // 接受的話會發生什麼，一行一筆（白話）
  choices: ['accept', 'retry', 'stage']
  view: 'always' | 'skippable' | 'never'   // 存檔規則當時的設定
  skipped: true                    // M1 一律是略過版
  battle: string                   // 那一場戰鬥的 id
}
export function defeatOf(state): PendingDefeat | null
export function pickDefeat(k, state, o: { faction?: string; roll: number }): { event: string; version: string; fails_commission: boolean }
export function acceptDefeat(k, state): ReportDraft          // 沒有等待中的戰敗 → throw new Error('沒有等待中的戰敗。')
```

## 二、內容的格式 `defeat_event`

| 欄位 | 必填 | 格式 |
|---|---|---|
| `id`、`name` | 是 | |
| `kind` | 是 | 種類的 id（字串；ENEMIES 第 6 節那張表的 id，或 `generic`） |
| `factions` | 是 | 勢力 id 的陣列（引用 `faction`）；可以是空的 |
| `fails_commission` | 是 | 布林值：接受這個結果算不算委託失敗 |
| `versions` | 是 | 物件，鍵只能是 `default`、`masc`、`yuri`，至少要有一個；每一個是 `{ text: 一段敘事, effects: 效果的陣列 }`。格式錯的訊息裡要有 `versions` 這個字 |
| `default` | | `true`：沒有勢力對得上的時候用這一筆（整份內容裡最多一筆） |
| `tags` | | 內容篩選的標籤（字串陣列） |
| `fallback` | | 這一筆的標籤被關掉時改用哪一筆（引用 `defeat_event`） |
| `adult` | | 布林值 |

`effects` 的每一筆是核心的效果（`{ kind: 'cash', amount: -3000 }`、`{ kind: 'time', hours: 6 }`……）；這裡不驗效果的內容（要有遊戲狀態才驗得了），只驗它是物件的陣列。

## 三、選哪一個事件、哪一個版本 `pickDefeat`

1. 照內容的順序找第一筆 `factions` 包含這個勢力的；沒有（或沒給勢力）就用 `default: true` 的那一筆。
2. 內容篩選：`resolveFiltered(state.rules, 那一筆, (id) => k.content.get('defeat_event', id))`；回傳 `undefined`（整條 `fallback` 都被關掉）就改用 `default: true` 的那一筆。
3. 版本：`pickVersion(主角的 gender, o.roll, { available: Object.keys(那一筆的 versions) })`。

## 四、流程

### 戰鬥結束（`k.battle.onEnd`）

`outcome` 是 `lose` 或 `surrender` 時：

- `roll = deriveRng(state.rng, 'defeat/' + battle.id).next()`；`pickDefeat(k, state, { faction: battle.origin.faction, roll })`。
- 把那一版的 `effects` 先照存檔規則調過（第五節），再 `k.effects.resolve(…)`，拿它的 `lines`（這時還沒有扣）。
- 回傳 `{ changes: [{ op: 'ext', key: 'defeat', value: PendingDefeat }] }`。不回傳 `lines`（戰鬥結束那一份報告的結果不寫戰敗的後果）。

其餘的結果（贏了、脫離了）什麼都不回傳。

### 接在戰鬥結束後面的報告（`report.after`）

`report.action === 'battle.end'`、`report.outcome.result` 是 `lose` 或 `surrender`、而且 `defeatOf(state)` 有東西時，回傳一份草稿：

```ts
{ kind: 'event', action: 'defeat.pending', location: 那一份報告的 location, party: [], timeline: [],
  changes: [],
  outcome: { result: 'defeat', summary: 那一版的 text },
  narration: { results: pending.lines } }
```

### 接受結果 `acceptDefeat(k, state)`

重新照現在的狀態算一次效果（第五節），回傳：

```ts
{ kind: 'event', action: 'defeat.accept', location, party: [], timeline: [],
  changes: [...效果的變更, { op: 'ext', key: 'defeat', value: null }, { op: 'snapshot.drop', kind: 'battle' }],
  outcome: { result: 'accepted', summary },
  narration: { results: 效果的 lines } }
```

`summary`：`fails_commission` 是 `true` 時寫「你接受了這個結果。這一趟的委託算失敗。」，否則寫「你接受了這個結果。這一趟的委託還在。」（測試只看有沒有「委託」兩個字）。

### 另外兩個選擇

「重來這場戰鬥」與「回到這個階段開始時」（副本以外等於重來）都由介面呼叫 `game.retryBattle()`，這個功能不用做事。

## 五、戰敗扣多少錢（COMBAT_SYSTEM 8.3 節的第三個設定）

把效果交給 `resolve` 之前，先調整 `kind: 'cash'`、`amount` 是負的那幾筆：這幾筆加起來最多扣 `Math.min(Math.floor(身上的現金 * state.rules.defeatMoneyLoss), state.rules.defeatMoneyCap ?? Infinity)`；超過的從後面的幾筆往回減，減到 0 的那一筆拿掉。其餘的效果原樣。

例（事件寫扣 3,000）：身上 5,000、預設 → 扣 3,000；身上 1,000 → 扣 1,000；比例 0.5、身上 5,000 → 扣 2,500；比例 0 → 不扣；上限 800 → 扣 800；比例 0.5、上限 800、身上 1,000 → 扣 500。

## 六、已知的事

1. 「戰敗事件要不要看」三種設定在 M1 的結果一樣（都是略過版），設定只是記在 `PendingDefeat.view` 上，之後的批次照它分流。
2. 「戰敗時拿走義體與裝備」、快取格被拿走、天使急救的會員資格、敵人自己指定的戰敗種類、二十九種的預設：都在 M2。
3. 設計書寫的是「身上現金的 0～100%」，所以這一張只調 `cash`；事件扣帳戶（`cred`）的時候不受這個設定影響。這是 cpp-architect 的解讀（`dev/adr/0013`），做的時候如果在設計書裡看到相反的寫法，停下來回報。
