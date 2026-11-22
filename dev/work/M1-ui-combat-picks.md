# M1-ui-combat-picks

- 交給：cpp-ui
- 目標：戰鬥畫面照引擎給的宣告（`picks`、`icon`）生選單與圖示，不再認得個別的行動；順便把開打的紀錄、戰敗面板的返回、幾樣還在畫面裡算的規則收掉。
- 規格出處：COMBAT_SYSTEM 第 10 節（畫面只問引擎；每一格用圖示；詳情用泡泡訊息）；dev/adr/0014（行動的宣告、等著選的戰敗）；審查 dev/reviews/2026-11-22-M1a.md 的 E1（介面那一半）、E3（介面那一半）、S9。
- 可以改的路徑：`ui/src/lib/battlePicks.ts`（新增）、`ui/src/lib/battleView.ts`、`ui/src/screens/CombatScreen.vue`、`ui/src/components/combat/`、`ui/src/data/combatIcons.ts`、`ui/src/stores/engine.ts`（只加轉接的函式，不寫規則）、`ui/src/styles/battle.css`、`ui/tests/pending/M1-ui-combat-picks.test.ts`（做完搬到 `ui/src/lib/battlePicks.test.ts`）。
- 可以用的介面（都從 `@engine/src` import；型別在 `engine/src/core/battle/registry.ts`、`step.ts`）：
  - `BattleActionOption`：每個行動多了 `icon: string`（一定有）與 `picks: BattlePick[]`（沒有要多選的是空陣列）。
  - `BattlePick`：`{ key, label, kind, required, options }`；`BattlePickOption`：`{ value, label, blocks, at?, for?, hint? }`。意思寫在 `registry.ts` 的註解與 dev/adr/0014「要多選的東西」。
  - `pickApplies(option, target)`：這個選項對這個目標適不適用（看 `for`）。`pickProblems(picks, target, chosen)`：照宣告還缺什麼、哪裡不對，一條一句。**用這兩個，不要自己重寫判斷。**
  - store 已經有的：`startBattle(setup)`、`startEncounter(id)` 現在回傳 `Report[]`（第一份是 `battle.start`）；`pendingDefeat`（引擎判斷的「在等玩家三選一」）；`blockOf(doing)`；`commit(...)`、`ledger(...)` 被擋下時回傳原因（字串），沒被擋回傳 `null`。
- 不可以做的事：不在畫面或 `lib` 裡判斷「這個行動要選什麼」「這個選項能不能選」；不照行動的 id 寫特例（道具、武器、掃射現在的三段特例要拿掉）；不改 `engine/`。

## 一、`ui/src/lib/battlePicks.ts`（純函式）

```ts
import type { BattleActionOption, BattleInput, BattleTarget } from '@engine/src'

export interface PickChoice { target: BattleTarget | null; pick: Record<string, unknown> }
export interface PickOptionView { value: string | number | boolean; label: string; reason: string | null; selected: boolean; at?: BattleTarget }
export interface PickView { key: string; label: string; kind: string; required: boolean; options: PickOptionView[] }
export interface PickFlow {
  picks: PickView[]
  targets: Array<{ target: BattleTarget; reason: string | null }>
  missing: string[]
  ready: boolean
  input: BattleInput
}
export function pickFlow(action: BattleActionOption, choice: PickChoice): PickFlow
```

- `picks`：照 `action.picks` 的順序。每一項只列對 `choice.target` 適用的選項（`pickApplies`；還沒選目標時列全部）；一個適用的選項都沒有的那一項整項不列。選項的 `reason` 是 `blocks` 用換行接起來（空的是 `null`）；`selected` 是 `choice.pick[key] === value`；有 `at` 就帶著。
- `targets`：照 `action.targets` 的順序。`reason`：目標自己的 `blocks`（換行接起來）優先；沒有的話，如果已經選的某個選項帶 `for` 而這個目標不在裡面，是 `` `這個目標用不上選的「${選項的 label}」。` ``；都沒有是 `null`。
- `missing`：行動要選目標（`action.target !== 'none'`）而還沒選，第一句是 `'要選一個目標。'`；後面接 `pickProblems(action.picks, choice.target, choice.pick)`。
- `ready`：`missing` 是空的。
- `input`：`{ action: action.id }`，有目標加 `target`；`pick` 只放宣告裡有的鍵、而且有值的（開關是 `false` 的不放）；一個都沒有就不帶 `pick`。

## 二、`CombatScreen.vue`

1. 選了一個行動之後：`picks` 不是空的就在側欄列出來，每一項一個 `[data-pick="<key>"]`，每個選項一個按鈕 `[data-pick-option="<value>"]`；灰掉的用現有的 `is-unavailable`，原因放 `title` 並在點的時候寫進提示列。選人、選格的那幾種（選項有 `at`）除了按鈕，也可以直接點場上的那個人或那一格（和選目標同一套外框）。
2. 目標的外框照 `pickFlow(...).targets` 的 `reason`：`null` 是綠框，有原因是灰框（原因在 `title`）。
3. `ready` 才送出（`engine.battleAct(flow.input)`）。不用選目標、也沒有一定要選的東西的行動（結束回合、換彈、監視）點一下就送，和現在一樣。有不一定要選的東西的（換武器）：點行動先打開選項，再點一次行動（或 Enter）照預設送出。
4. 拿掉：`pickItem`、`pickSweep`、`canSweep`、`quick`、`swapTo`、`pickPayload`、`ID_ICON`、三段寫死的 `v-if="selAction?.id === 'item'"`／`'swap'`／`canSweep`。
5. 圖示：`iconOf(a)` 是 `COMBAT_ICONS[a.icon] ? a.icon : 'skill'`。技能清單的每一列也畫圖示。
6. 戰鬥紀錄：`engine.startEncounter(id)` 回傳的報告交給 `after(...)`（開場的「戰鬥開始」「第 1 回合」「輪到誰」要在紀錄裡）；重來之後用 `restoreLines()` 重建。
7. 戰敗面板（審查 E1）：`engine.pendingDefeat` 有東西時，上面的 `StatusBar` 不給返回（或返回還是回到這個面板）；面板只在 `engine.pendingDefeat` 有東西時顯示「重來這場戰鬥」「回到這個階段開始時」。
8. 舊系統呼叫 `engine.commit`、`engine.ledger` 的地方：回傳字串（被擋下的原因）時不要當成成功，至少把原因寫到提示（哪些地方會在戰鬥中呼叫到，先 grep `ledger(` 與 `engine.commit(`）。

## 三、圖示（`ui/src/data/combatIcons.ts`）

引擎現在用到、而這張表還沒有的鍵：`end`（結束回合）、`surrender`（投降）、`drone_deploy`、`drone_command`、`drone_move`、`drone_recall`（無人機的放出、指揮、移動、收回）、`vehicle`（叫車）、`node`（控制節點）。照現在這張表的做法從 game-icons.net（CC BY 3.0）各挑一個 512 × 512 的單一路徑補上，檔頭的出處照寫。完整的對照在 dev/adr/0014。

## 四、順便收掉還在畫面裡算的規則（審查 S9）

- `battleView.ts` 的遮蔽上限與名字現在用 `DEFAULT_NUMBERS`、`DEFAULT_MODES`：資料改了數字之後會和引擎對不上。改成由 store 給這個戰場的東西（store 加一個轉接：`battleMode()` 回傳 `modeOf(game.k.content, battle.mode)`；上限用 `coverHpFor(mode.numbers, level, battle.grade)`，名字用 `mode.coverNames`）。
- 距離：射擊的每個目標在 `targets[].hint.distance` 已經有了；「距離：」那一列改讀它（沒有射擊這個行動時才不顯示）。

## 驗收測試

- `ui/tests/pending/M1-ui-combat-picks.test.ts`：必須全部通過（在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts M1-ui-combat-picks`）。現在失敗的原因：`ui/src/lib/battlePicks.ts` 還不存在；八個圖示的鍵還沒有圖。
- `ui/` 的 `npm test` 與 `npx vue-tsc --noEmit` 照樣全過。

## 完成時回報

改了哪些檔、測試結果；畫面上實際試過的行動（至少：用道具、換武器、掃射、放出與指揮無人機、防爆門、叫人、換個位子嘛）；遇到的規格問題（宣告表達不了的選法、引擎給的句子不夠用的地方）。
