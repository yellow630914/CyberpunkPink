# M5-defeat-entry

- 交給：cpp-architect（這一張動 `features/defeat` 的接點與 opinion 的一個呼叫點；寫成工單是給之後要接第二個、第三個入口的人看的）
- 目標：給 `features/defeat` 一個不從戰鬥來的入口——呼叫的人說「誰被帶走、被哪個勢力、在哪裡、為什麼」，戰敗功能照打輸之後同樣的規則抽事件、演（或不演）、三選一、接受之後把結果交回給發起的人。第一個用戶是輿論戰：找上門擋不住、對手 `capture`（幫派、星旗）時，先開戰敗事件，不再直接交回 `lost`。
- 規格出處：COMBAT_SYSTEM 8.3、8.4 節（誰贏了就走誰的戰敗事件；三選一；委託失敗是旗標）；DEFEAT_EVENTS 開頭（共用的約定：登場角色、`fails_commission`、篩選、fallback）；OPINION 第 6 節「找上門」（幫派與星旗是主播被抓，進戰敗事件）；dev/adr/0020「實作補記」：M5-opinion-face 第 6 點、M5-commission-opinion 第 3、4 點；使用者 2026-11-27 裁決（見 dev/status.md）：被帶走要先開戰敗事件；收買與被帶走在任何階段都算委託失敗。
- 可以改的路徑：`engine/src/features/defeat/`；opinion 的呼叫點（`engine/src/features/opinion/visit.ts`、`model.ts` 一個常數）；commission 的一行資料（`engine/src/features/commission/run.ts` 的 `faceLaunch`：輿論面的 `origin.ext` 帶 `defeat_event`）；`engine/tests/features/M5-defeat-entry.test.ts`；`engine/tests/features/M5-commission-opinion.test.ts` 裡那一條 `origin` 的 `toEqual`（跟著多一個鍵）。
- 可以用的介面：活動登錄表（`k.activity.define`、`allowEverywhere`、報告的 `launch`）；`features/defeat` 現有的 `pick`、`settleSkipped`、`inlineEvent`、`rewriteEffects`、`defeatView`；核心的 `endActivity`、`attachActivityEnd`、`deriveRng`；報告的 `rewind`。
- 不可以做的事：不改核心（`engine/src/core`、`engine/src/shell`）；opinion 不 import `features/defeat`、defeat 不 import `features/opinion`、`features/commission`（只經活動的種類字串 `defeat.entry` 與 `activity.end` 溝通）；不在 defeat 裡替 opinion 寫專屬的程式；不改既有的戰鬥流程（`onBattleEnd`、`afterBattleEnd` 的行為逐位元組不變）；內海的戰敗（`net`、`tethered`、`located`）不走這個入口；不碰 `features/media`、`features/live`、`features/gear`（另一張 M5-media-pov 在改）。

## 設計

### 入口是一種活動：`defeat.entry`

別的功能只要在報告上帶一個 `launch`（這是現有的跨功能做法，和 commission 開 `face.opinion` 一樣），不必 import 戰敗：

```ts
{ kind: 'defeat.entry', setup: DefeatEntrySetup, origin: <發起的人的 origin> }
```

`origin` 就是之後 `activity.end`（kind `defeat`）交回的對象：副本的 `{ by: 'commission', ref, ext: { commission, stage, … } }` 照舊，副本現成的 `onDefeatAccepted` 認得，不必改。戰敗功能也匯出同一個東西的純函式（`enterDefeat(k, state, setup, origin)`，回報告草稿）與組 `launch` 的小工具（`defeatEntryLaunch`），給測試與外殼用。

### `DefeatEntrySetup`

| 欄位 | 意思 |
|---|---|
| `reason`（必填） | 為什麼進戰敗，給 `defeat.options` 掛點、報告與畫面看的標籤。例：`opinion_captured`。不影響抽哪一件 |
| `who` | 被帶走的人（角色 id）；沒給是主角。必須在狀態裡。**事件的效果仍以主角為對象**（和戰鬥打輸一樣），`who` 只用在報告那一拍與畫面 |
| `faction` | 贏的那一方的勢力（等於戰鬥的「誰贏了」）。沒給時用 `foes` 裡第一個有勢力的 |
| `foes` | 贏的那一方裡個別敵人（敵人內容的 id）：用它們資料裡寫的 `defeat`（字串或陣列，好幾個時照骰值挑一個）。通常不用給 |
| `event` | 發起的人自訂的戰敗事件（`defeat_event` 內容的 id）。沒給就看 `origin.ext.defeat_event`——和戰鬥同一個慣例（`originEventOf`） |
| `where` | 在哪裡（地點的 id 或名字），記在等待中的戰敗與報告那一拍，不影響抽哪一件 |
| `text` | 報告那一拍的開頭一句；沒給是「你被帶走了。」（`who` 不是主角時用他的名字） |
| `fails_commission` | **只有沒有任何事件可演時**才用（預設 `true`）：有事件就看事件自己的 `fails_commission` |
| `retry` | 「重來這一場」要回到哪一種快照（例：輿論面是 `opinion`）。沒給就沒有「重來」 |

### 抽事件：和戰鬥完全同一套

`pick`（`choose.ts`）一字不改：天使急救（旗標 `angel_member`）→ `setup.event` 或 `origin.ext.defeat_event` → `foes` 寫的 → `faction` 的預設 → 通用的（`default: true`）；用到被篩選關掉的標籤沿著 `fallback` 找；版本照主角的性別與骰值。骰值是 `deriveRng(state.rng, 'defeat/<入口 id>')`（同一個狀態同一個結果；不推游標）。

### 沒有戰鬥的那幾拍，用什麼預設

| 戰鬥裡有的 | 入口怎麼辦 |
|---|---|
| 生命、感載、餘韻、沉溺 | **不動**。被帶走不是「全隊倒下」，沒有倒下的一步，也就沒有「最少剩 1」、沉溺 +2 要結算（本來也沒有人是 0）。事件自己寫的效果照常 |
| 戰場狀態（`battle.field`：熔斷、被定位、遮蔽） | 沒有。**入口一律演事件**（沒有熔斷場地的例外）；內海的欄位（`net`、`tethered`、`located`）不帶、交回的結果也不帶 |
| 開打前的快照（戰鬥結束時留著等三選一） | 沒有。「等著三選一」改由活動 `defeat.entry` 擋（它的 `active` 是等待中的戰敗有 `entry` 欄位而且現在沒有戰鬥）；放行的清單和核心的 `defeat` 一樣（事件視窗、場景、事件帶出來的戰鬥） |
| `battle` 欄位（那一場的 id） | 合成：`entry:<reason>:<報告數>`。事件視窗的 `origin.ref`、`activity.end` 的 `result.battle` 都用它 |
| `outcome` | `lose`（被帶走不是自願的）。保釋的「被贖回」只對戰鬥那一場記的贖金，入口不會出現；`defeat.options` 掛點照問（保命符 `media_keep` 看 `pending.faction`，所以給了 `faction` 就會出現） |
| 誰贏了（`winnersOf`） | 由 `setup.faction`、`foes` 給 |
| 戰鬥結束的報告（`battle.end`）與「寫法指令」文字欄 | 沒有（沒有 `battle_end` 鏈）。入口自己發一份 `defeat.pending`；寫法指令要由介面另外問，這一張不做 |
| 存檔規則 | 全部照用：`defeatView`（一律看／可以跳過／不看）、`defeatTakeGear`（拿走義體裝備）、`defeatMoneyLoss`／`Cap`（扣錢上限）、同行的人（`defeat.companions`） |

### 三選一

- **接受**：和戰鬥那一場同一份 `defeat.accept`（演過就不再結算、沒演走「不演」結算），發 `activity.end`（kind `defeat`、outcome `accept`），`result` 多 `entry: { reason, who, where? }`。不帶 `snapshot.drop`（沒有戰鬥的快照）。
- **重來**（`retryDefeat`，報告 `defeat.retry`）：帶 `rewind: { kind: setup.retry, fresh: true }`。找不到那種快照（或沒給 `retry`）選不了，原因是完整的一句。回去之後由發起的人或介面接（輿論面：呼叫副本的 `replay`，和 `opinion.retry` 一樣）。
- **回到這個階段開始時**（`stageDefeat`，報告 `defeat.stage`）：帶 `rewind: { kind: 'stage' }`；沒有 `stage` 快照就退而用 `retry` 那一種（等於重來）；兩個都沒有選不了。
- 事件視窗、場景開著時，重來與回到階段也放行（回到快照時整個狀態換掉，開著的視窗一起沒有）；接受不放行（和戰鬥一樣，要先演完）。
- `defeatView` 多 `entry: { reason, who, where } | null`；`retry`、`stage` 兩個選項的 `can`／`why` 看上面的規則。**介面分流**：`view.entry !== null` 時，重來與回到階段走 `retryDefeat`／`stageDefeat` 的報告，不能呼叫 `Game.retryBattle()`／`rewindToStage()`（那兩個看的是戰鬥的快照）。

### 沒有事件可演時的退路

`pick` 找不到任何可用的事件（沒有勢力對得上、也沒有標 `default` 的通用事件）：**不留等待中的戰敗**，入口當場當成「接受了結果」——同一份報告發 `activity.end`（kind `defeat`、outcome `accept`，`result.event` 是 `null`、`option` 是 `none`、`fails_commission` 取 `setup.fails_commission` 預設 `true`），發起的人照常處理（副本：失敗回到入口）。這比戰鬥那一場的退路（只丟快照、什麼都不發生）更保守：戰鬥那一場是自己在打，入口是發起的人已經認定「被帶走了」，不能讓這件事消失。

### 接 opinion（幾行）

`features/opinion/visit.ts`：找上門擋不住、對手 `capture: true` 時，只要世界裡有人登記了活動 `defeat.entry`（`k.activity.get('defeat.entry')`；沒有就和以前一樣交回 `lost` 帶 `captured`）：

- `face` 模式：戰役清掉、**不發 face.opinion 的 `activity.end`**（結算的交回由戰敗的接受接手；副本聽 `activity.end` 的 kind `defeat` 已經會失敗回到入口），報告帶 `launch: [{ kind: 'defeat.entry', setup, origin: war.origin }]`。`setup`：`reason: 'opinion_captured'`、`who` 是主角、`faction` 是對手的勢力、`where` 是現在所在的區、`retry: 'opinion'`。
- `solo` 模式：設計書沒有另外寫（OPINION 第 6 節：「幫派與星旗是主播被抓（進戰敗事件）」沒分模式），走同一個入口；照舊結算（`closeDraft`，標準結果列的敗與議題的 `on_end` 照給），同一份報告多帶 `launch`；沒有 `opinion` 快照所以沒有「重來」，三選一只剩接受（與「回到階段」的退路也沒有）。
- 副本的自訂戰敗事件：commission 的 `faceLaunch` 在輿論面的 `origin.ext` 多帶 `defeat_event`（副本有寫才帶；和戰鬥、內海面同一個慣例），入口讀 `origin.ext.defeat_event`。
- 收買（voluntary）不走這個入口。

## 驗收條件（`engine/tests/features/M5-defeat-entry.test.ts`）

- 抽事件與戰鬥同一套：天使急救優先、`setup.event`、`origin.ext.defeat_event`、`foes` 寫的、勢力的預設、通用的；`foes` 沒給 `faction` 用敵人的勢力；被篩選關掉的事件沿 `fallback`；男性主角走 `masc`；同一個狀態同一個結果。
- 三種演法：一律看（同一步事件視窗自己開）、可以跳過（先問，看或不看）、不看（只列出結果）；別的功能經 `defeat.options` 多給選項時先問；事件開不起來時改成只列出結果。
- 沒有戰鬥的預設：生命、感載、餘韻、沉溺進出入口前後不變；`ext.defeat` 帶 `entry`、`battle` 是合成的 id、`outcome` 是 `lose`；不留任何 `battle` 快照。
- 活動 `defeat.entry` 等三選一時擋住自由行動與別的報告（原因是完整的一句）、事件視窗與事件帶出來的戰鬥放行；存檔再讀回來還在等。
- 接受：演過不再結算、沒演走「不演」結算；`activity.end`（kind `defeat`）發一次，`origin` 是 launch 給的、`result.entry` 對；存檔規則（扣錢上限、拿走裝備）照用。
- 重來與回到階段：報告帶對的 `rewind`；沒有快照時選不了、原因對；事件視窗開著時放行。
- 沒有事件可演：當場發 `activity.end`（`fails_commission` 預設 `true`，可以蓋掉）、不留等待中的戰敗。
- 壞的 setup（沒有 `reason`、`who` 不在狀態裡、型別不對、已經有等待中的戰敗）整步不成立、原因是完整的一句。
- opinion：`face` 模式 `capture` 的對手擋不住——報告 `opinion.visit` 之後接 `defeat.pending`（事件視窗開起來）、戰役已清掉；接受之後副本失敗回到入口（`commission.failed`）、`activity.end` 的 `defeat` 對；沒有裝戰敗時行為和以前一模一樣（既有的 `M5-opinion-face` 測試不改）；`solo` 一樣先開事件；副本自訂的戰敗事件被抽到；重來、回到階段、存讀。
- `npx tsc --noEmit`、分層檢查（`tests/core/layers.test.ts`）、既有的 `M1-defeat`、`M2-defeat`、`M5-opinion-face`、`M5-commission-opinion` 全過。

## 完成時回報

改了哪些檔、測試數字、紅燈、要裁決的（見下面「留給使用者」）。

## 留給使用者（寫在這裡，做完要回報有沒有照）

- 被帶走的事件若自己寫 `fails_commission: false`（例如「劫囚成功」），委託就不失敗，回到選分支之前：這照 COMBAT_SYSTEM 8.4 與 DEFEAT_EVENTS 的寫法。使用者 11-27 說的「被帶走在任何階段都算委託失敗」是對「沒有事件可演」與一般的事件（`fails_commission: true`）成立。要連事件都蓋掉（一律失敗），需要多一個 `force_fail` 欄位。
- 戰敗的「寫法指令」文字欄（COMBAT_SYSTEM 8.3）入口沒有：沒有 `battle_end` 鏈。要的話由介面在事件視窗開起來之前另外問。
- 內海的戰敗（被扣線、被定位）仍走戰鬥那一條；入口不帶 `net` 欄位。
