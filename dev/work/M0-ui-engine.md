# M0-ui-engine

- 交給：cpp-ui
- 目標：做一個包住引擎的 Pinia store（`useEngine`），把建角畫面的規則與主畫面的自由行動、紀錄、時間、錢、存檔與回退從假資料換成引擎。
- 規格出處：UI 1.1 節（互動版的規則）、第 14 節（建角畫面；只看第 1～4、7 步與年齡那一條）、第 6 節裡紀錄（報告卡）那一列；AI_TASKS 5.1 節（任務鏈列的狀態，只為了知道每一步有哪些狀態）。只讀這幾處，加上 `ui/README.md`。
- 前置：引擎那邊的 M0-data、M0-character、M0-perks、M0-creation 四張都完成（`engine/src/features/index.ts` 的 `FEATURES` 裡有 `character`、`perks`、`creation`，`engine/data/index.ts` 有 `CORE_PACK`）。還沒完成就先不要開工。
- 可以改的路徑：`ui/src/`、`ui/scripts/`、`ui/tests/`、`ui/vite.config.ts`、`ui/tsconfig.json`、`ui/vitest.pending.config.ts`。
- 可以用的介面：引擎的公開介面 `engine/src/index.ts`（下面列出會用到的）、功能的總表 `engine/src/features/index.ts`、資料 `engine/data/index.ts`。**只 import 這三個檔與 `engine/src/features/creation`（建角的函式與型別），不要 import 引擎其他的內部路徑。**
- 不可以做的事：
  - 不改 `engine/`。引擎少了什麼（欄位、動作、給畫面用的摘要）就停下來回報給 cpp-architect。
  - 元件裡不寫規則：擲骰、DC、點數算不算得過、能不能做，一律問 store（store 問引擎）。
  - 這一批沒有搬進引擎的系統（地圖與移動、背包、義體、技能樹、NPC、委託、戰鬥、家園……）維持原本的假資料與 `useGame`，不要動它們的規則。
  - 不把金鑰或設定寫進引擎：引擎只收設定物件。
- 驗收測試：`ui/tests/pending/M0-engine-store.test.ts`；必須全部通過。跑法：在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts`。通過之後把它搬到 `ui/src/stores/engine.test.ts`（import 的路徑跟著改），再跑 `npm test` 與 `npm run typecheck`，都要過；原本的測試不能少、不能壞。
- 完成時回報：改了哪些檔、測試結果、哪些畫面還在用假資料、發現的寫在元件或 `ui/src/lib/` 裡的規則（列出來，不要自己搬）。

## 一、建置：讓 ui 讀得到 engine

引擎在 `ui/` 外面（`../engine`），純 TypeScript，沒有編譯步驟，ui 直接 import 原始碼。

1. `ui/vite.config.ts`：加上別名與開發伺服器的許可。

   ```ts
   import { fileURLToPath } from 'node:url'
   // defineConfig 裡：
   resolve: { alias: { '@engine': fileURLToPath(new URL('../engine', import.meta.url)) } },
   server: { fs: { allow: ['..'] } },
   ```

   `ui/vitest.pending.config.ts` 也加同樣的 `resolve.alias`。
2. `ui/tsconfig.json`：`compilerOptions` 加 `"paths": { "@engine/*": ["../engine/*"] }`，`include` 加 `"tests/**/*.ts"`。
3. 之後一律寫 `import { Game } from '@engine/src'`、`import { CORE_PACK } from '@engine/data'`、`import { allFeatures } from '@engine/src/features'`。
4. 跑 `npm run typecheck` 與 `npm run build` 確認過得了。引擎的原始碼會被 ui 的型別檢查一起檢查；它在引擎那邊已經用同樣嚴格的設定檢查過，照理不會有錯。有錯就回報，不要改引擎。

## 二、`ui/src/lib/engineView.ts`（純函式，有測試）

```ts
import type { Report, Change } from '@engine/src'

/** 介面的設定（stores/settings.ts 的 Settings，只用到下面這些欄位）轉成引擎的 AI 設定（cpp-ai-v1 的形狀，開關是 0／1） */
export function aiSettingsFromUi(s: Partial<UiAiFields>): Record<string, unknown>

/** 一份報告轉成紀錄的一則（LogView 吃的樣子） */
export function logEntryOf(report: Report, describe?: (changes: Change[]) => string[]): EngineLogEntry
```

**`aiSettingsFromUi` 的對照**（左邊是 `ui/src/stores/settings.ts` 的欄位，右邊是引擎的鍵；布林一律轉成 1／0；左邊沒給的欄位就不輸出右邊的鍵，引擎會用預設值）：

| 介面 | 引擎 |
|---|---|
| `useAi` | `ai` |
| `judgeFree`、`judgeShift`、`judgeEvent` | `judge_free`、`judge_work`、`judge_other` |
| `clampRequested` | `clamp_asked` |
| `narrate` | `narrate` |
| `tradeProse` | `trade_text` |
| `combatProse` | `combat_text`：`'每回合一小段'` 是 1，其他是 0 |
| `polish`（一個布林） | `polish`：`{ free: 1 }` 或 `{ free: 0 }`（之後有別的鏈再加鍵） |
| `agentMode`、`onlyQuery` | `agent`、`query_only` |
| `hooks.agent_hook`、`agent_event`、`agent_night`、`agent_commission`、`agent_flavor` | `hook_text`、`hook_block`、`hook_night`、`hook_comm`、`hook_shop` |
| `hookLimits.hook`、`hookLimits.event` | `lim_hook`、`lim_event` |
| `hookLimits.other` | `lim_visit`、`lim_night`、`lim_comm`、`lim_shop`（四個都是同一個值） |
| `retries` | `retry`：`{ '*': retries }` |
| `chainRow` | `chainbar`：`'出錯時展開'` 0、`'一直展開'` 1、`'隱藏'` 2 |
| `taskSource` | `src`（原樣） |

**`logEntryOf` 的輸出**：

```ts
export interface EngineLogEntry {
  id: string                 // report.id
  time: string               // 「第 14 天 17:05」：用引擎的 formatTime(report.time.start)
  place: string              // location 的 district、block、facility 有的用「 · 」接起來；都沒有是空字串
  prose: string[]            // 有 narration.text：照空行（\n\n）切成段落；沒有：[outcome.summary]
  roll?: { skill: string; die: number; mod: number; dc: number; result: '大成功' | '成功' | '失敗' | '大失敗' }
  changes: Array<{ text: string; kind?: 'plus' | 'minus' }>
  notices: string[]          // report.clamps 的每一筆 notice（被夾值時給玩家看的提醒）
}
```

- `roll`：取 `report.timeline` 裡第一個有 `roll` 的節拍。`skill` 是 `parts` 裡 `source === 'skill'` 那一項的 `label`，沒有就用 `source === 'attr'` 那一項的；`die` 是 `natural`；`mod` 是所有 `parts` 的 `value` 加總；`dc` 是 `dc`；`result` 用引擎匯出的 `DEGREE_NAME[roll.degree]`。沒有任何節拍有 `roll` 就不放這個欄位。
- `changes`：`describe(report.changes)` 回傳的每一行是一筆。`describe` 沒給時，用一個新建的核心來描述：`createKernel().changes.describe(blankState(0), changes)`（`createKernel`、`blankState` 從引擎 import；建一次存在模組裡重複用）。行裡有 `+` 的 `kind` 是 `'plus'`，有 `−`（U+2212）的是 `'minus'`，都沒有就不放 `kind`。時間、亂數這些沒有描述的變更不會出現。
- store 呼叫時把 `describe` 傳成 `(c) => game.k.changes.describe(game.state, c)`，功能自己註冊的變更才描述得出來。

## 三、`ui/src/stores/engine.ts`（Pinia store，有測試）

`export const useEngine = defineStore('engine', () => { ... })`。裡面建一個 `Game`：

```ts
const game = new Game({ features: allFeatures(), content: [CORE_PACK], fakeProvider: new FakeProvider(), ai: aiSettingsFromUi(...) })
```

- 沒有金鑰時引擎會用假的服務商（M0 還沒有接真的服務商）；`setAi({ useAi: false })` 時每一步走規則。
- `Game` 的 `state` 是一個普通物件，不是響應式的。用 `game.subscribe(...)` 在每次變化後把畫面要的東西更新到 store 的 `ref`（建議 `shallowRef` 放一份 `structuredClone(game.state)`，或一個遞增的版本號讓 `computed` 重算）。**不要把 `game.state` 直接包成 `reactive`**（引擎會整份換掉內容）。
- store 匯出（驗收測試用的就是這些名字）：

| 名字 | 型別 | 說明 |
|---|---|---|
| `state` | `GameState`（唯讀的投影） | 引擎的狀態 |
| `hasCharacter` | `boolean` | `state.pc !== null` |
| `pc` | `Actor \| null` | 主角 |
| `money` | `{ cred: number; cash: number }` | |
| `timeLabel` | `string` | `HH:MM` |
| `log` | `EngineLogEntry[]` | `state.reports` 每一份轉一則，**最新的排最前面**；`action` 是 `game.new` 的那一份不顯示 |
| `busy` | `boolean` | 任務鏈在跑的時候是 true |
| `chainSteps` | `StepRecord[]` | 最新一條任務鏈的每一步（`game.lastRun?.steps`，沒有就是空陣列）；給任務鏈列用 |
| `canUndo` | `boolean` | `game.undo.size > 0` |
| `newGame(opts: { seed: number; rules?: object })` | | `game.newGame(opts)` |
| `createCharacter(draft: CreationDraft)` | `CreationBlock[]` | 先 `creationBlocks`；不是空的就原樣回傳，狀態不動；空的就 `game.commit(buildCreationReport(...))` 並回傳 `[]` |
| `creation` | 物件 | 建角畫面要的東西，見下面 |
| `act(input: ActionInput)` | `Promise<{ status: ActStatus \| 'busy'; reason?: string }>` | `game.act(input)`。`status` 用引擎的 `ActStatus`：`applied` 套用了；`refused` 行動被擋下（附 `reason`，狀態不變）；`paused` 鏈停下來等玩家重試、重擲或改用規則（任務鏈列展開那一步）；`cancelled`。**沒有 `blocked` 這個狀態**（2026-11-22 改名，審查 E4：原本行動被擋下與鏈停下來共用 `blocked`，畫面分不出來） |
| `retryStep(id)`、`useRules(id)`、`reroll()` | 同上 | 對應 `game.retryStep`、`game.useRules`、`game.reroll`。請求不成立時引擎丟錯（狀態不變）；哪一步能按哪個按鈕先問 `game.stepActions(id)` |
| `setAi(uiSettings)` | | `game.setAiSettings(aiSettingsFromUi(uiSettings))` |
| `save()` | `string` | `game.save('manual', new Date().toISOString())` |
| `load(raw: string)` | `string \| null` | `game.load(raw)`：錯誤訊息或 null |
| `undo()` | `boolean` | `game.undoSteps(1)` |

`creation` 物件（全部轉呼叫 `@engine/src/features/creation` 的函式，把 `game.k`、`game.state` 帶進去）：

| 名字 | 對應 |
|---|---|
| `ageBlock(raw)` | `ageBlock` |
| `attrTotals(pick, bonus)`、`attrBudget(bonus)`、`attrBlock(pick, bonus)` | 同名的函式 |
| `skillLeft(levels)`、`skillBlock(levels)` | 同名的函式 |
| `perkSummary(picked)`、`perkBlock(picked)` | 同名的函式 |
| `blocks(draft)` | `creationBlocks` |
| `attributes`、`skills`、`origins`、`perks` | `game.k.content.list('attribute' \| 'skill' \| 'origin' \| 'perk')` |

## 四、建角畫面（`ui/src/screens/NewGameScreen.vue`）

第 1～4 步與第 7 步改用引擎；第 5、6、8、9 步維持原本的假資料與 `ui/src/lib/creation.ts`。

| 現在用的（`ui/src/lib/creation.ts`、`ui/src/data/creation.ts`） | 換成 |
|---|---|
| `ageBlock` | `e.creation.ageBlock` |
| `attrTotals`、`attrBudget`、`attrBlock` | `e.creation.` 同名的 |
| `ATTRS`（中文名當鍵）、`BASIC_SKILLS`、`ORIGINS`、`TRAITS` | `e.creation.attributes`、`skills`、`origins`、`perks`（鍵改成引擎的 id，顯示用 `name`；基本功的圖標 `ic-bs_<id>` 有一個例外：定力的 id 是 `composure`，圖標還是 `ic-bs_resolve`） |
| `basicLeft`、`basicStepBlock` | `e.creation.skillLeft`、`skillBlock`（按 ± 之前先算出按下去之後的那一份，問 `skillBlock`） |
| `traitSummary`、`traitPickBlock`、`traitBlock` | `e.creation.perkSummary`、`perkBlock`（同上：先算出選了之後的那一份再問） |
| `freeValues`、`attrStepBlock`、`fmtMod` | 留著（只是下拉選單與顯示）；`attrStepBlock` 裡「能不能再加」的判斷改成問 `e.creation.attrBlock` 與 `attrBudget` |
| `attrMod` | 引擎匯出的 `attrMod` |
| `start()` | 先 `e.newGame({ seed, rules })`，再 `e.createCharacter(draft)`；回傳的不是空陣列就跳到那一步並顯示 `reason`。成功之後照原本的方式把其餘假資料寫進 `useGame`（義體、裝備、技能樹……），讓還沒搬的畫面照常能用 |

種子用 `Date.now() % 2147483647` 之類的整數就好。存檔規則（`rules`）從設定頁現有的值帶：難度 `'故事' | '簡單' | '普通' | '困難' | '傳奇' | '自訂'` 對到 `story`、`easy`、`normal`、`hard`、`legend`、`custom`；`traitPoints` 對到 `startPerkPoints`。

## 五、主畫面（`ui/src/screens/MainScreen.vue`）與 `useGame`

引擎現在是這幾樣的真相：**紀錄、時間、兩種錢、主角的名字／屬性／基本功／特質、存檔讀檔與回退**。其餘的還在 `useGame`。

1. `freeAction()`（第 141 行附近）現在自己擲骰、自己定 DC，這是寫在元件裡的規則：整段換成 `await e.act({ kind: 'free', text })`。屬性與基本功先不讓玩家選（引擎的預設是智識、不帶基本功）；判定開著時由 AI 選。
2. 紀錄：`LogView` 的 `entries` 改成吃 `e.log`。`LogView` 的 `changes`、`roll` 欄位和 `EngineLogEntry` 相容；多的 `notices` 顯示在報告卡下面，一行一句。
3. `useGame` 裡會動到時間、錢、紀錄的三個入口改成轉給引擎，讓兩邊不會各走各的：
   - `g.advance(分鐘)` → `e.commit({ changes: [{ op: 'time', minutes }] }, 摘要)`
   - `g.addLog({ prose, changes })` → 同一次 `e.commit`，`prose` 接成摘要
   - 直接改 `money.acc`、`money.cash` 的地方 → `{ op: 'cred', delta }`、`{ op: 'cash', delta }`
   - 做法：在 store 加一個 `commit(parts: { summary: string; changes?: Change[] })`，裡面 `game.commit({ kind: 'system', action: 'ui.legacy', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary } })`。`useGame` 的 `day`、`minutes`、`money`、`log` 改成從 `useEngine` 算出來的 `computed`。
   - 這一步牽動 `useGame` 的存檔（`serialize`／`hydrate`）：引擎的那幾樣不再放進假存檔，存檔改成 `{ engine: e.save(), legacy: g.serialize() }` 兩份包在一起。
   - **如果這一步牽動的檔案超過十個，或原本的測試開始壞，停下來回報，先交前四節。**
4. 狀態列的時間與錢讀 `e.timeLabel`、`e.money`。
5. 設定頁的 AI 開關改了之後呼叫 `e.setAi(settings)`。
6. 任務鏈列（`ui/src/components/ChainFlow.vue`）有現成的畫面：把 `e.chainSteps` 餵給它；每一步的三個按鈕接 `e.retryStep`、`e.useRules`，擲骰那一步的「重擲」接 `e.reroll`。資料的樣子對不上就寫一個轉換的純函式放在 `engineView.ts`。

## 2026-11-22 的修正

這一張已經做完。之後引擎改了幾個介面（行動的結果改名、提交可以併進最新一樓、開新局與建角一起提交、出身的勢力改用 id、撤退保留紀錄……），要改的地方與新的驗收測試在 dev/work/M0-fix-ui.md；上面第三節的表已經照新的名字改了 `act` 那兩列，其餘以 M0-fix-ui 為準。

## 已知的事

- 介面的設定存在 `cpp-ui-settings-v1`（駝峰式的欄位），不是設計書示意頁用的 `cpp-ai-v1`。這一張用 `aiSettingsFromUi` 轉，不改儲存的鍵。要不要把儲存的形狀也統一，等使用者決定。
- 引擎的存檔格式（`cyberpunkpink-engine-save`）和介面的假存檔（`cyberpunkpink-save`）不同，互相讀不了；這是刻意的。
