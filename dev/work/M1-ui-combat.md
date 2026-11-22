# M1-ui-combat

- 交給：cpp-ui
- 目標：把現實戰鬥的畫面（`ui/src/screens/CombatScreen.vue`）從第四版 Demo 的規則（`ui/src/lib/combat/real.ts`）換成引擎：store 包住引擎的戰鬥、一個把戰鬥狀態整理成畫面模型的純函式檔、畫面只讀引擎給的東西。手機版面照定案：敵上我下，兩排的第 1 格都在左邊。制伏灰掉時泡泡裡寫出缺的是哪個條件。
- 前置：引擎那邊的 `M1-data-rules`、`M1-combat`、`M1-enemies`、`M1-data-enemies`、`M1-defeat` 都完成（`engine/src/features/index.ts` 的 `FEATURES` 裡有 `combat`、`enemies`、`defeat`；`CORE_PACK` 裡有 `encounter`）。還沒完成就先不要開工。
- 規格出處：COMBAT_SYSTEM 第 10 節（畫面）；docs/art/UI.md 第 17 節第 1 項（手機的戰鬥版面：敵上我下，兩排的第 1 格都在左邊；2026-11-22 定案）；docs/plan/PLAN.md 5.5 節第一項（制伏灰掉要寫出缺哪個條件）。只讀這幾處，加上 `ui/README.md`。
- 可以改的路徑：`ui/src/`、`ui/tests/`、`ui/scripts/`。
- 可以用的介面：引擎的公開介面 `@engine/src`（下面列出會用到的）、`@engine/src/features`（`allFeatures`）、`@engine/data`（`CORE_PACK`）、`@engine/src/features/enemies`（`setupFromEncounter`）、`@engine/src/features/defeat`（`defeatOf`、`acceptDefeat`）。**不要 import 引擎其他的內部路徑；`@engine/src/testkit` 只能在測試裡用。**
  - `Game`（store 已經有一個）：`game.battle`、`game.battleOptions()`、`game.startBattle(setup)`、`game.battleAct(input)`、`game.battleNext({ anyone? })`、`game.finishBattle()`、`game.retryBattle()`（`engine/src/shell/game.ts`，每個方法上面有說明）。
  - 型別：`BattleState`、`BattleUnit`、`BattleCover`、`BattleOptions`、`BattleActionOption`、`BattleTargetOption`、`BattleInput`、`BattleTarget`、`BattleSetup`、`BattleStepResult`、`Report`。常數：`END_TURN`、`MOVE`、`DEFAULT_MODES`、`DEFAULT_NUMBERS`；函式：`coverHpFor(numbers, level, grade)`。
- 不可以做的事：
  - 不改 `engine/`。引擎少了什麼（欄位、給畫面用的摘要、灰掉的原因）就停下來回報給 cpp-architect。
  - 畫面與 `battleView.ts` 裡不寫規則：能不能做、為什麼不能、命中率、花幾點、誰先動，一律讀 `battleOptions()` 與 `state.battle`。灰掉的原因引擎給幾條就顯示幾條，不自己湊字、不自己猜。
  - 不刪 `ui/src/lib/combat/`（內海與輿論的 Demo 還在用 `field.ts`、`rng.ts`；`real.ts` 與它的測試這一批先留著，畫面不再用它）。內海戰鬥、輿論戰的畫面不動。
  - 不做直播的容器（M5）：`LiveWindow`、`Danmaku` 維持原樣，只把事件的來源換掉（第三節）。
- 驗收測試：`ui/tests/pending/M1-ui-combat.test.ts`；必須全部通過。跑法：在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts`。通過之後把它搬到 `ui/src/stores/engine.battle.test.ts`（import 的路徑跟著改），再跑 `npm test` 與 `npx vue-tsc --noEmit`，都要過；原本的測試不能少、不能壞。另外照第四節的清單在瀏覽器裡走一遍（`ui/README.md` 寫了怎麼開）。
- 完成時回報：改了哪些檔、測試結果、第四節的清單每一項的結果、畫面上還讀不到引擎的東西（列出來）。

## 一、store：`ui/src/stores/engine.ts` 加戰鬥

照原本的做法（每次動作之後 `refresh()` 把 `state` 換成新的一份複製）：

```ts
const battle = computed(() => state.value.battle)          // BattleState | null；整份複製，畫面改它不會改到引擎
const inBattle = computed(() => state.value.battle !== null)
function battleOptions(): BattleOptions | null             // game.battleOptions()
function startBattle(setup: BattleSetup): void             // game.startBattle(setup)；之後 refresh()
function startEncounter(id: string): void                  // startBattle(setupFromEncounter(game.k, game.state, id, { allies: game.state.party.map((a) => ({ from: 'actor', id: a })) }))
function battleAct(input: BattleInput): BattleStepResult   // game.battleAct(input)；applied 才 refresh()
function battleNext(o?: { anyone?: boolean }): BattleStepResult
function finishBattle(): Promise<ActOutcome>               // 走原本的 run(() => game.finishBattle())
function retryBattle(): string | null                      // game.retryBattle()；成功（null）就 refresh()
const defeat = computed(() => defeatOf(state.value))       // 等待中的戰敗；沒有是 null
function acceptDefeat(): void                              // game.commit(acceptDefeat(game.k, game.state))；之後 refresh()
```

- `battleAct`、`battleNext` 做不成時回傳引擎給的 `{ status: 'refused', reasons }`，不丟錯、不改狀態。
- 紀錄的每一筆（`EngineLogEntry`，`ui/src/lib/engineView.ts`）多一個欄位 `kind`（報告的 `kind`：`action`、`combat`、`event`……），驗收測試用它找戰鬥的那一筆。戰鬥中每一步的報告在結束時會被引擎收成一份，紀錄照引擎的 `state.reports` 顯示就好，不用自己合併。

## 二、`ui/src/lib/battleView.ts`（純函式，不寫規則）

```ts
export interface SlotPos { side: 'ally' | 'foe'; slot: number; row: number; col: number }
/** 八格在畫面上的位置（row、col 從 1 起算，給 CSS grid 用） */
export function slotLayout(mode: 'desktop' | 'mobile'): SlotPos[]
export function battleView(battle: BattleState, options: BattleOptions): BattleViewModel
export function ringOf(options: BattleOptions): Record<'skill' | 'attack' | 'supply' | 'tactic' | 'system', BattleActionOption[]>
/** 數字鍵 1～9 對到哪個行動：內環（攻擊）、中環（補充與切換）、外環（戰術）照順序，最多九個 */
export function RING_KEYS(options: BattleOptions): string[]
/** 灰掉的原因：行動自己的 blocks 一條一行；沒有的話，每個目標都選不了時把目標的原因（去掉重複的）一條一行；能做回傳 null */
export function disabledReason(a: Pick<BattleActionOption, 'ok' | 'blocks' | 'targets'>): string | null
```

- `slotLayout('desktop')`：一列八格，由左到右是我方第 4、3、2、1 格，敵方第 1、2、3、4 格（`row` 都是 1，`col` 1～8）。
- `slotLayout('mobile')`：兩排。第 1 排是敵方，第 2 排是我方；兩排都是第 1 格在最左邊（`col` 等於 `slot`）。陣列的順序：敵方第 1～4 格，再我方第 1～4 格。
- `battleView` 回傳：

```ts
{ round: number,
  cells: Array<{ side, slot,
    cover: { level: 0 | 1 | 2, name: string, hp: number, max: number, soft?: string },
    unit: null | { id, name, side, rank, hp?: { now, max }, load?: { now, max }, layers, layersMax, ap: { now, max }, weapon: string, mag?: { now, max }, statuses: string[], out?: string, control },
    overlays: Array<{ id, name, kind, hp: { now, max } }> }>,          // 八格，照 slotLayout('desktop') 的順序
  order: Array<{ id, name, side, now: boolean }>,                       // 先攻條：照 battle.order，敵我混排；now 是輪到的那個
  distances: Array<{ id, name, distance }>,                             // 輪到的人到每個還在場上的敵人的距離（他那一邊的對面），照站位；等的不是玩家時是空的
  field: { dark: boolean }, nodes: Array<{ id, name, taken, used }> }
```

  - 遮蔽的名字：`DEFAULT_MODES.meat.coverNames[level]`（暴露、半掩體、掩體）。`max`：`cover.max?.[level - 1] ?? coverHpFor(DEFAULT_NUMBERS, level, battle.grade)`；暴露是 0。
  - `weapon` 是手上那一把的名字（`unit.weapons[unit.wield].name`）。距離是 `自己的 slot + 對方的 slot − 1`。
  - 已經退出的人（`out` 有值）不放進格子，但留在先攻條以外的地方不用顯示。
- `ringOf`：把 `options.actions` 照 `group` 分成五組，組內保持引擎給的順序。`system` 那一組是圓環外面那一列（結束回合、脫離、投降）；`hold: true` 的要長按。

## 三、畫面：`ui/src/screens/CombatScreen.vue`

- 進來的方式：`#/combat?enc=<遭遇的 id>&from=<打完回哪裡>`。沒有在打（`!engine.inBattle`）就 `engine.startEncounter(enc)`；`enc` 沒給或找不到用 `CORE_PACK` 裡第一場 I 級的遭遇。已經在打（重新整理、讀檔回來）就接著打。還沒有主角（`!engine.hasCharacter`）時顯示一句「先建好角色再來」與回建角的按鈕。
- 每一格、先攻條、回合數、距離：讀 `battleView(engine.battle, engine.battleOptions())`。桌面與手機用同一份資料，位置用 `slotLayout`（寬度小於原本樣式切換的那個斷點時用 `mobile`）。
- 行動圓環：`ringOf(options)`。中心是技能（`skill` 那一組；沒有就不顯示中心的清單）。每一格顯示名字與要花的行動點；`ok` 是 `false` 的灰掉，泡泡裡顯示 `disabledReason(a)`（原本的 `ReasonButton`／`Hint` 元件）。數字鍵照 `RING_KEYS`。
- 選了一個要目標的行動之後：把 `a.targets` 標在場上。`blocks` 是空的那些可以點；有原因的那些也標出來（灰框），滑過或點下去顯示那幾條原因。目標的 `hint.chance`（命中率，%）有就顯示在那個人身上；制伏的 `hint.dc` 顯示成「格鬥對 N」。
  - `item`（道具）：先選快取格裡的哪一個（`input.pick.item`），再選目標。`swap`（換武器）有兩把以上時可以直接點，或選哪一把（`pick.weapon`）。射擊時手上的武器有 `sweep` 特性的，多一個「掃射」的開關（`pick.sweep`）。
- 送出：`engine.battleAct({ action, target, pick })`。回來是 `refused` 就把 `reasons` 一條一行顯示在提示列。
- 敵人的回合：`battleOptions().waiting === 'ai'` 時，每隔一小段時間（原本的節奏；`?fast=1` 時不等）呼叫一次 `engine.battleNext()`，直到等的是玩家或 `over`。每一步回來的 `reports[].timeline` 接到戰鬥紀錄上（每一拍的 `text`）。
- 結束：`waiting === 'over'` 時顯示結果（`battle.result.text`）與「結算」的按鈕 → `await engine.finishBattle()`。結算之後：
  - `engine.defeat` 是 `null`（贏了、脫離了）：回到 `from`。
  - `engine.defeat` 有東西（打輸或投降）：顯示它的敘事（紀錄裡最新那一筆的正文）與 `defeat.lines`（會發生什麼，一行一筆），三個按鈕：「接受結果」→ `engine.acceptDefeat()` 之後回到 `from`；「重來這場戰鬥」與「回到這個階段開始時」→ `engine.retryBattle()`，留在這個畫面接著打（副本以外這兩個是同一件事；兩個按鈕都要有）。
- 直播小窗與彈幕：原本是掃紀錄的字串（`liveReact(文字)`）。改成看每一步 `reports[].timeline[]` 的 `tag`：`crit`（要害）、`overload`（過載）、`down`（打倒）、`subdue`（制伏）、`wound`（重創）各推一則彈幕，文字用那一拍的 `text`。其餘不動。
- 拿掉：`RealBattle`、`REAL_ACTIONS`、`applyDifficulty`、`writeBack()`、`g.lastBattle` 的寫入（三條軌的寫回、時間、紀錄都由引擎的結算做）。`useGame()` 在這個畫面裡只剩下還沒搬進引擎的東西；用不到就拿掉。

## 四、在瀏覽器裡走一遍（回報每一項）

1. 建角之後進 `#/combat`：看得到八格、先攻條、回合數；我方是主角一個人。
2. 手機寬度（375px）：敵人在上排、我方在下排，兩排的第 1 格都在左邊；行動圓環按得到，沒有橫向捲動。
3. 射擊一個敵人：行動點與彈匣照扣，紀錄多一行；彈匣空了之後射擊灰掉，泡泡寫「彈匣空了，要先換彈。」
4. 制伏：一開始是灰的，泡泡寫得出缺的條件（沒有束帶；或對方沒有在過載、不在近身……各一句）。
5. 敵人的回合會自己走完；`?fast=1` 時不等。
6. 長按投降：戰鬥結束、算戰敗；結算之後看到戰敗的敘事、會發生什麼與三個按鈕；按「重來這場戰鬥」回到第 1 回合。
7. 打贏一場：結算之後回到來的地方；主畫面的紀錄多一筆戰鬥的報告，生命與感載是打完之後的數字。
8. 戰鬥中重新整理頁面（或存檔再讀檔）：接著同一場打，不會重開。

## 五、已知的事

1. 驗收測試只涵蓋 store 與 `battleView.ts`；畫面靠第四節的清單。畫面裡發現還得自己算規則才顯示得出來的東西，就是引擎少給了，停下來回報。
2. 性別的選項（TS 只有一種，id 是 `trans_f`）已經由 cpp-architect 在這一批順手改好，不在這一張。
3. 技能、無人機、載具、控制節點的行動之後才進引擎（`M1-abilities`、`M1-summons`）；它們進來的時候會出現在 `ringOf` 的 `skill` 與 `tactic` 裡，畫面照同一套顯示，不必為它們寫特例。
