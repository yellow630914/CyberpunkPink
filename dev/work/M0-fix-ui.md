# M0-fix-ui

- 交給：cpp-ui
- 目標：引擎在 M0 的修正批次（2026-11-22）改了幾個介面（行動的結果、提交的選項、開新局、建角、撤退、時鐘），把 `useEngine`、`engineView` 與用到它們的畫面照新的介面接上，並把因此變紅的既有測試改對。
- 規格出處：AI_TASKS 2.4 節（「已經套用」那一列）、5.1 節、5.5 節第 1 條；SERIES 第 6 節；CHARACTER 第 1 節第 1 步、5.4 節；DATA 第 1 節（性別那一列）、1.1 節（勢力與 NPC 的 id）、第 8 節（`look.private`）；CORE_RULES 7.4 節（時段與星期）。只讀這幾處。背景在 dev/adr/0008、0009。
- 可以改的路徑：`ui/src/`、`ui/tests/`。
- 可以用的介面：引擎的公開介面 `engine/src/index.ts`、功能的總表 `engine/src/features/index.ts`、資料 `engine/data/index.ts`、`engine/src/features/creation`（建角的函式與型別）。只 import 這四處。下面每一節列出會用到的名字。
- 不可以做的事：
  - 不改 `engine/`。引擎少了什麼就停下來回報給 cpp-architect。
  - 元件與 store 裡不寫規則：能不能按、算多少錢、星期幾，一律問引擎。這一張就是把 store 裡自己算的幾處換掉。
  - 這一批沒有搬進引擎的系統（背包、義體、技能樹、委託……）維持原本的假資料，不動它們的規則。
  - 審查 E3、E5、E6、E7 與 `dev/bugs/2026-11-21-ui-*.md` 已經修過的部分不要重做；這一張只接引擎新的介面。
- 驗收測試：
  1. `ui/tests/pending/M0-fix-ui.test.ts`：必須全部通過。跑法：在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts M0-fix-ui`。
  2. `ui/tests/pending/M0-ui-engine-bugs.test.ts`（`ui-undo-ledger-steps`）：第一節做完、重現資料的 `favor` 改成 id 之後要通過。
  3. 兩份都通過之後搬進 `ui/src/stores/`（`M0-fix-ui.test.ts` → `engine.fix.test.ts`；`ui-undo-ledger-steps` 併進 `repro.test.ts`），再跑 `npm test` 與 `npm run typecheck`，都要過。
- 完成時回報：改了哪些檔、測試結果、哪些畫面還在自己算規則（列出來，不要自己搬）、遇到的規格問題。

## 現在的樣子

引擎改完之後，`ui/` 的 `npm test` 有 17 個測試變紅、`npm run typecheck` 有 2 個錯。原因只有四種，改法在下面各節：

| 原因 | 在哪 | 改法 |
|---|---|---|
| 出身的勢力改用 id，測試與重現資料還寫中文名（`favor: '孤星連'`） | `src/stores/engine.test.ts`、`engine.whitebox.test.ts`、`repro.test.ts` 用的 `DRAFT`；`tests/fixtures/repro/*.json` 的 `draft` | 第三節第 2 點 |
| 被擋下的行動，引擎回傳 `refused`（不再丟 `ActionBlocked`） | `engine.whitebox.test.ts`「被擋下的行動……回傳 blocked 與原因」 | 第一節 |
| `CreationStep` 多了 `cyber`、`gear` 兩步 | `NewGameScreen.vue` 的 `BLOCK_STEP`（型別錯誤） | 第三節第 5 點 |
| 建角改成跟開新局一起提交之後不留回退 | 「createCharacter：成功時……留一步回退」 | 第三節第 1 點 |

## 一、行動的結果：三個字，不再有 `blocked`（審查 E4）

引擎的 `Game.act`、`retryStep`、`useRules`、`reroll` 回傳 `ActResult`：

```ts
import type { ActStatus, StepActions } from '@engine/src'
// ActStatus = 'idle' | 'running' | 'paused' | 'applied' | 'cancelled' | 'refused'
// ActResult = { status: ActStatus; run; reports; reason?: string }
```

| `status` | 意思 | 畫面怎麼做 |
|---|---|---|
| `applied` | 套用了 | 照常 |
| `refused` | 行動本身被擋下（還沒有主角、條件不符）。有 `reason`。狀態不變、不留回退 | toast `reason`，把字放回輸入框 |
| `paused` | 鏈跑到一半有一步失敗，停下來等玩家重試、重擲或改用規則。狀態還沒改 | **不要** toast「做不了」，**不要**把字放回輸入框：任務鏈列已經展開失敗的那一步，玩家在那裡處理 |
| `cancelled` | 被取消（回退、讀檔、關掉 AI） | 不用做事 |

要改的地方：

1. `ui/src/stores/engine.ts`
   - `ActOutcome` 的型別改成 `{ status: ActStatus | 'busy'; reason?: string }`（不要再用 `string`：以後比對 `'blocked'` 會直接是型別錯誤）。
   - `run()`：引擎回傳的結果有 `reason` 就一起帶出去（`{ status, reason }`），沒有就只有 `{ status }`。`catch (e instanceof ActionBlocked)` 那一段拿掉（引擎不再丟它）；其他的錯誤照樣丟。
2. `ui/src/screens/MainScreen.vue` 第 151 行附近：`r.status === 'blocked'` 改成 `r.status === 'refused'`。`paused` 不進這個分支。
3. 既有測試裡比對 `'blocked'` 的地方照上表改（被擋下的行動 → `refused`；鏈停下來 → `paused`）。

### 任務鏈列的按鈕問引擎（審查 S8）

`ChainBar.vue` 現在自己判斷哪一步顯示「重試」「用規則」「重擲」。改成問引擎：

```ts
// store 加一個
const stepActions = (stepId: string): StepActions => game.stepActions(stepId)
// StepActions = { retry: string | null; useRules: string | null; reroll: string | null }   null 是可以按，字串是不能按的原因
```

- 按鈕顯示的條件：那一項是 `null`。不是 `null` 的不顯示（或用 `unavailable(原因)` 顯示成不能按，照 `ui/` 既有的做法）。
- 這樣「鏈套用之後又記了帳」的時候三個按鈕都會消失：引擎這時只准回退（AI_TASKS 2.4 節：只有最新一樓可以在套用之後重試；重試會把之後的帳一起抹掉，審查 E2）。
- 注意：自由行動套用之後，只要再呼叫一次 `e.commit` 或 `e.ledger`（哪怕只是補一則舊系統的紀錄），那條鏈就不能再重試。自由行動之後如果還有舊系統要補記的東西，檢查一下是不是真的需要。

## 二、沒有正文的帳併進最新一樓（AI_TASKS 5.5 節；`ui-undo-ledger-steps`、審查 S3）

引擎的 `Game.commit(draft, opts)` 多了選項：

```ts
game.commit(draft, { attach: true })   // 併進最新一樓：不另留一步回退；回退一步時跟著前面那一步一起收回
game.commit(draft, { label: '名字' })  // 留一步回退（預設），label 是回退選單上的名字
```

要改的地方（`ui/src/stores/engine.ts`）：

- `commit(parts, opts?: { attach?: boolean })`：把 `opts` 傳給 `game.commit`。
- `ledger(changes)`：用 `{ attach: true }`。錢與時間的帳不是玩家的一步。
- `useGame` 的 `advance()`（`ui.time`）也用 `attach`。`addLog()`（`ui.legacy`，舊系統寫的一則紀錄）維持留一步回退。這樣「休息」是一步（紀錄那一則），時間跟著它一起回去（審查 S3）。順序要是先 `addLog` 再 `advance`，或把兩者合成一次 `e.commit`（時間的變更放進同一份報告）；合成一次最好。
- 任務鏈還在跑的時候引擎不收提交（丟「上一條任務鏈還在跑。」）。`busy` 的時候不要呼叫 `e.commit`／`e.ledger`。

## 三、開新局與建角

`@engine/src/features/creation` 新的匯出：`attrStepBlock`、`creationLimits`、`originView`、`startMoney`、`genderBlock`、`lookBlock`，型別 `CreationLimits`、`CreationLook`、`LookPrivate`、`NamedId`。`CreationStep` 多了 `'cyber'`（第 6 步）與 `'gear'`（第 9 步）。

1. **開新局與建角一起提交（審查 S11）**。引擎的 `game.newGame({ seed, rules, setup })`：`setup(state)` 回傳開局接著要提交的報告；任何一步丟錯，原本那一局完全不動；開局不留回退。store 的 `newGame` 改成：

   ```ts
   function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft }): CreationBlock[]
   ```

   - 有 `draft`：先用「只有這份 `rules` 的空狀態」問 `creationBlocks`（和現在 `cstate()` 的做法一樣）；有問題就原樣回傳，什麼都不動。沒問題才 `game.newGame({ seed, rules, setup: (state) => buildCreationReport(game.k, state, draft) })`，回傳 `[]`。
   - 沒有 `draft`：照舊，回傳 `[]`。
   - `NewGameScreen.vue` 的 `start()` 改成一次 `e.newGame({ seed, rules, draft })`，不再先 `e.newGame` 再 `e.createCharacter`。
   - `createCharacter` 可以留著（既有的測試在用）；「留一步回退」那一個測試改成驗 `newGame({ draft })` 之後 `canUndo` 是 false。
2. **出身的勢力與名冊是 id（DATA 1.1 節）**。`OriginEntry.favor.choose_one` 現在是勢力的 id（`lonestar`、`nora`、`hizakura`……），`roster` 是 NPC 的 id（`npc_xiaomai`、`npc_ray`……）。
   - 畫面顯示名字用 `originView(game.k, originId)`：`{ favor: [{ id, name }], favorValue, roster: [{ id, name }] }`（`name` 是勢力的短名、NPC 的名字）。store 加 `creation.originView(id)`。
   - `NewGameScreen.vue` 的下拉選單：`<option :value="f.id">{{ f.name }}</option>`；`favor` 這個 ref 存 id，預設值不要寫死 `'孤星連'`（用選到的出身的第一個）。「開場認識」那一行用 `roster` 的 `name` 接起來。
   - 草稿的 `originChoice.favor` 交 id。測試與 `tests/fixtures/repro/*.json` 的 `draft` 裡 `'孤星連'` 改成 `'lonestar'`（對照：野良 `nora`、胭脂堂 `rouge`、緋櫻 `hizakura`；全表在 `engine/data/world/factions.json`）。
   - 內容裡多了兩種：`game.k.content.list('faction')`（id、`name` 全名、`short` 短名、`class`）與 `list('npc')`（id、`name`）。介面假資料的 NPC 已經改成 id 表的 id，要名字時可以從這裡拿。
3. **屬性的 ± 按鈕（審查 S6）**。store 的 `creation.attrStepBlock` 現在自己比上下限與自由點數。整段換成引擎的：

   ```ts
   attrStepBlock: (pick, bonus, attr, delta) => attrStepBlock(game.k, pick, bonus, attr, delta)
   ```

   訊息和原本的一樣（`先選這一項的數字。`、`單項最高 18。`、`最低 4（調整值 -3）。`、`自由點數用完了：先把別的屬性往下壓，一點換一點。`）。
4. **建角的數字（審查 S7）**。`creation.limits` 整段換成 `creationLimits(game.k, cstate())`。它多了 `cyberPoints`、`gearPoints`、`cyberPointCash`、`gearPointCash`；`attrArray` 在資料沒載入時也是六個數字（引擎的預設），store 不用自己留預設值。
5. **起始的錢由引擎算（CHARACTER 5.4 節）**。草稿多兩個選填的欄位：`cyberSpent`（第 6 步花掉的義體點數）、`gearSpent`（第 9 步花掉的裝備點數）。義體與裝備的目錄還在介面的假資料裡，所以「花了幾點」由畫面加總之後交進草稿；引擎檢查有沒有超過點數（超過擋在 `cyber`／`gear` 那一步），並把沒花完的換成現金（義體每點 500、裝備每點 150，全部放現金，每個出身一樣）。
   - `NewGameScreen.vue`：草稿帶上 `cyberSpent`、`gearSpent`；畫面上「起始的錢」那一行用 `e.creation.startMoney(draft)`（store 加這個，轉呼叫 `startMoney(game.k, cstate(), draft)`，回傳 `{ base, cyber, gear, total }`）。畫面與 `useGame` 不再自己加錢。
   - `BLOCK_STEP` 補上 `cyber: 6`、`gear: 9`（對到畫面的第 6、9 步）。
6. **性別六個值（DATA 第 1 節；審查 S11）**。`engineView.ts` 的 `GENDER_ID`（一個「TS」對到 `trans_f`）換成：

   ```ts
   export const GENDER_OPTIONS: ReadonlyArray<{ id: GenderId; name: string }>   // 六個，順序照引擎的 GENDER_IDS：female、male、femboy、trans_f、trans_m、futa
   ```

   `GenderId`、`GENDER_IDS` 從 `@engine/src` 拿。畫面的性別下拉選單用它（`trans_f`、`trans_m` 各一個選項；名字由介面定，例如「TS（女）」「TS（男）」）。引擎不收六個值以外的字（擋在第 1 步：「沒有這個性別。」）。
7. **私處的外觀是 `look.private`（DATA 第 8 節）**。現在的做法是在 `look` 裡放 `private`（字串）與 `privateNote` 兩個鍵。改成正式的形狀：

   ```ts
   look: { ...其他部位, private: { options: string[]; text: string } }   // options 是選的詞條，text 是自由輸入的一段
   ```

   - `NewGameScreen.vue` 的 `draft`：`basic.privates`（選的）放進 `options`（選「（不寫）」就是空陣列），`basic.privatesNote` 放進 `text`。不用再自己看內容篩選決定放不放：引擎看存檔規則（下一點）。
   - 讀的時候：`pc.ext.profile.look.private`（角色的成人分頁）。`g.character.privates` 那一份可以改成從這裡投影。
8. **內容篩選與自訂難度帶進引擎的存檔規則（審查 S4）**。`rulesFromUi` 多收兩樣：

   ```ts
   rulesFromUi(s: { difficulty?; traitPoints?; customDiff?: { dc: number }; filterIntimateBody?: boolean })
   ```

   - `difficulty` 是「自訂」而且有 `customDiff`：輸出 `dcOffset: customDiff.dc`（引擎會夾在 −4～+4）。不是自訂就不輸出 `dcOffset`（預設難度的偏移由引擎照難度給）。
   - `filterIntimateBody === false`：輸出 `contentOff: ['intimate_body']`。開著就不輸出這一格（或輸出空陣列）。引擎的規則：`state.rules.contentOff` 是玩家關掉的標籤；關掉「身體的私密描寫」時建角不寫 `look.private`。
   - 呼叫 `rulesFromUi(st.s)` 的地方不用改（`st.s` 本來就有這兩個欄位）。

## 四、撤退回到快照，但紀錄留著（SERIES 第 6 節）

引擎的新介面：

```ts
game.rewind(raw: string, opts: { summary: string }): string | null   // 錯誤訊息，或 null
```

- `raw` 是之前用 `game.save()` 記的快照（`takeSnapshot` 已經在記 `engine: eng.save()`）。
- 做的事：狀態回到快照那一刻（時間、錢、旗標、亂數的位置）；快照之後的報告**留在紀錄裡**並標 `retracted: true`（內容一個字不少，擲骰行還在）；最後多一份報告，`summary` 是交代這件事的那一段話；回退的堆疊清空。
- 失敗（不是存檔、不是這一局更早的狀態）回傳錯誤訊息，狀態不變。

要改的地方：

1. store 加 `rewind(raw: string, summary: string): string | null`（呼叫 `game.rewind` 之後 `refresh()`）。
2. `ui/src/stores/game.ts` 的 `rollback()`：現在是 `eng.load(s.engine)` 之後把少掉的紀錄一則一則用 `eng.commit` 補回去（擲骰行補不回來）。整段換成 `eng.rewind(s.engine, note.prose[0])`；後面那一次 `addLog(note)` 拿掉（引擎已經寫了那一則）。
3. `engineView.ts` 的 `EngineLogEntry` 加 `retracted?: boolean`：`report.retracted` 是 true 時才放。`LogView.vue` 把被收回的那幾則顯示得不一樣（例如淡一點、加一個「已收回」的小標），不要藏起來。
4. 順手補上（引擎這一批才有的）：判定的轉折。報告的 `timeline` 那一拍多了 `twist`；`logEntryOf` 把它放進 `entry.roll.twist`（`EngineLogEntry.roll` 已經有這個欄位，UI 第 3.2 節）。

## 五、時鐘問引擎

`ui/src/stores/game.ts` 第 128～132 行自己算星期與離收租日幾天（註解寫了「之後換成引擎的」）。換成：

```ts
// store 加一個 computed
const clock = computed(() => { void state.value; return game.clock() })
// game.clock() → { weekday: 0～6（0 是週一，日曆的星期）; segment: 'dawn' | 'morning' | 'noon' | 'afternoon' | 'prime' | 'late'; segmentWeekday; daysToMonday }
```

- `g.weekday` 用 `clock.weekday`；`g.billIn` 用 `clock.daysToMonday`（今天就是週一時是 0；畫面要顯示成「7 天後」還是「今天」照原本的寫法決定，那是顯示）。
- 時段（清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3）要用的話拿 `clock.segment`，不要自己從小時算。`segmentWeekday` 是「這個時段算在星期幾」：深夜跨過午夜算前一天，排班表、事件用它。

## 已知的事

- 存檔的摘要（`JSON.parse(e.save()).meta.pc`）現在有出身：`{ name, origin: 出身的 id, originName: 出身的名字 }`。讀檔對話框要顯示出身的話從這裡拿。
- `engine/data/rules/actions.json`（行動種類的資料）由 cpp-data 另外做（dev/work/M0-fix-data.md）。它進來之後 `free` 有參考範圍，AI 關閉時成功的自由行動會拿到一點現金；假設「自由行動不改錢」的測試到時候會變紅，照實際的數字改。
- 引擎的回退現在不會被失敗的動作吃掉步數，步數不是正整數回 false；`e.undo()` 不用改。
