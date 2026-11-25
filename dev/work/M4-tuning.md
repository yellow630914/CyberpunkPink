# M4-tuning

- 交給：cpp-feature（sonnet）
- 目標：新功能 `tuning`：調校（裝在橋的兩個調校槽裡的韌體設定檔）、在調校診所裝卸、強制安裝與鎖、靜室（付錢調一項橋參數）、給畫面的橋參數總覽。
- 規格出處：LEWD_SYSTEM 第 1 節「怎麼變」、第 4 節、第 6 節表裡「調校診所」那一列；CYBERWARE 第 1 節（橋 1 ＋調校槽 2）；MIGRATION N 組的 `schools`、`purify`；`ui/src/lib/clinic.ts` 的 `TUNE_FEE`；dev/adr/0019 第七節與 P48、P49、P65。
- 可以改的路徑：`engine/src/features/tuning/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-tuning.test.ts`。
- 可以用的介面：`k.passives.register`（來源 `tuning`）、`passiveProblems`；衍生數值 `bridge_<參數>`、條件 `has_bridge`（`features/lewd`）；效果 `bridge`、`sink`（用登錄表跑，查不到略過）；`actor.ext.tendency`（只認格式：調校的條件看軸與標籤）；條件 `at_facility`；掛點 `scene.body`（用名字掛）；設施種類的欄位；核心的 `actor.ext`、`cred`／`cash`、`time` 變更；`k.effects.register`、`k.conditions.register`。
- 不可以做的事：不寫七種調校的內容（測試自帶兩三種）；調校用久了的進階效果是特質（內容）；原型版的調校只收資料；不 import `lewd`、`cyberware`、`scene`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 內容種類 `tuning`：`name`、`desc`、`effects`（被動效果的清單，正反兩面都寫在這裡）、`requires?`（`{ axis?: Record<軸, 最低等級>, tag?: 傾向標籤 }`）、`tags?`（篩選的標籤）、`price?`、`flags?`（寫不成被動效果的幾個開關，封閉清單：`no_load_decay` 感載不自然消退、`sink_weekly` 每週沉溺 +1、`sink_resist` 沉溺每次上升 −1、`no_full_sync` 開不了全檔、`afterglow_double` 餘韻的正面效果加倍、`hp_to_load` 受到的生命傷害有兩成改成感載）、`scene?`（`{ sensitivity?: Record<部位, 數字> }`）。
- **靜水不用開關**（使用者 2026-11-24／25；0019 P65）：它是「每回合感載消退 +N 點」，現實與內海都有效，寫成兩筆被動效果——`{ stat: 'net_load_decay', amount: 2 }`（內海：戰鬥每輪與探索回合）與 `{ mod: 'decay', amount: 2, layer: 'meat' }`（現實的戰鬥）；原型版是另一筆調校的資料，兩個數字都是 4。反面是 `flags: ['no_full_sync']`。原本的 `decay_double`（自然消退加倍）拿掉：內海的基礎消退是 0，加倍在內海什麼都不是。
- `actor.ext.tuning = { slots: [id | null, id | null], locked: Record<調校的 id, { by, until? }> }`。
- 設施種類多讀 `tuning?: { install?: boolean, quiet_room?: boolean }`。
- 規則 `tuning_rule`（`overridable`）：`slots`（2）、`install`（`{ price: 300, minutes: 60 }`）、`remove`（`{ price: 150, minutes: 60 }`）、`quiet`（`{ step: 5, price: 500, per_week: 1, sink_up: 1, minutes: 120 }`）。
- 條件 `tuning`（`{ id }`：裝著）。效果（內建的來源才收）：`tuning`（`{ id, locked_by?, days? }`：強制裝上；沒有空槽時擠掉沒上鎖的第一個）、`tuning_remove`（`{ id }`）。
- 報告：`tuning.install`、`tuning.remove`、`tuning.quiet`。匯出：`tuningOf`、`installBlock`／`installDraft`、`removeBlock`／`removeDraft`、`quietBlock`／`quietDraft(k, state, { actor, param, dir: 1 | -1 })`、`bridgeView(k, state, actor)`（四項的基本值、有效值、每個來源各加多少；調校槽；鎖）。

## 要做的

1. 裝：要有橋、在 `tuning.install` 的設施、有空槽、沒裝過同一個、`requires` 成立（不成立照樣可以裝，但 `bridgeView` 標「裝不穩」而且 `effects` 裡正的那幾筆不算；LEWD_SYSTEM 1.1 節「才裝得穩」），付錢、花時間。被篩選關掉標籤的不列。
2. 拆：付錢、花時間；上鎖的拆不了（「這個調校的鑰匙在<誰>手上。」），過了 `until` 的鎖自己失效。
3. 效果：裝著的每一個的 `effects`（來源 `tuning`）。`flags` 各自接到現有的地方：`sink_weekly`（`time.passed` 每週一走 `sink` 效果 +1）、`no_full_sync`（一筆 `{ stat: 'sync_cap_bonus', amount: -1 }`，而且這個人最高到深檔：做的人看核心 `syncCapOf` 讀哪個數字，夾不到就回報）、`no_load_decay`（戰鬥的修正 `decay`：只在現實的戰場把自然消退的 2 ＋ mod(意志) 抵掉，內海的 `net_load_decay` 不動——內海本來就不自然消退；戰鬥外的消退是休息的事，回報）、其餘三個先只存、列在回報（要核心或別的功能配合）。
4. `scene.body`：裝著的調校的 `scene.sensitivity` 加到部位的修正。
5. 強制安裝：效果 `tuning` 直接裝上並上鎖（契約的「改造」指令、戰敗事件、惡意韌體用）；`tuning_remove` 無視鎖。
6. 靜室：在 `quiet_room` 的設施，一次把一項橋參數 ±5（用 `bridge` 效果，內建的來源，照它的 0～100 夾）、每週一次、收錢、花時間；往上調的那一次沉溺 +1。
7. 沒有橋的人：三個動作都擋（「沒有橋就沒有調校槽。」）。換橋（`cyberware`）之後調校要重裝：聽 `report.after`，看到 `cyber.bridge` 這份報告就把沒上鎖的槽清空（上鎖的留著），接一份 `tuning.remove` 說明。

## 驗收條件（`engine/tests/features/M4-tuning.test.ts`；測試自帶四種調校：一個只有 `effects`（定力 +4、`afterglow_cap` −1）、一個帶 `requires` 與 `flags: ['sink_weekly']`、一個帶 `scene.sensitivity`、一個照靜水寫的（上面那兩筆被動效果加 `flags: ['no_full_sync']`））

- 裝一個：扣 300、時間 +1 小時、檢定與衍生數值照 `effects`；第三個被擋；同一個裝兩次被擋；不在調校診所被擋；沒有橋被擋。
- `requires` 不成立：裝得上、正的那一筆不算、負的照算、`bridgeView` 有「裝不穩」。
- 拆：扣 150、效果消失；上鎖的被擋並寫出誰；鎖過期之後拆得了。
- 效果 `tuning` 在兩槽都滿時擠掉沒上鎖的那個、自己是上鎖的；AI 給的被擋。
- `sink_weekly`：過一個週一沉溺 +1。
- 靜水（測試同時裝 `deckFeature`）：裝著的人在現實的戰鬥每回合比沒裝多消退 2 點；在內海的戰鬥每回合消退 2 點（沒有甲板散熱時；不是 4）；衍生數值 `net_load_decay` 多 2（`netrun` 的探索回合讀的就是它）；開不了全檔。拆掉之後三個數字都回來。把兩筆的數字換成 4 的那一筆（原型）各是 4。資料寫 `flags: ['decay_double']` 被格式檢查擋下。
- 靜室：敏感度 30 調到 35、扣 500、沉溺 +1；往下調沉溺不變；同一週第二次被擋；已經 100 的往上被擋（`bridge` 效果的夾法）。
- `bridgeView`：測試再掛一個來源 `cyber` 的 +10，總覽列出基本值、兩個來源各自的量與有效值。
- 測試發一份 `action: 'cyber.bridge'` 的報告：沒上鎖的調校被清掉、上鎖的還在。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-passive。`scene.body` 與 `cyber.bridge` 都是用名字接，那兩個功能沒裝也跑得起來。

## 完成時回報

改了哪些檔、測試結果、LEWD_SYSTEM 第 4 節七種調校逐一寫成資料時哪幾條寫不出來（預期：痛覺轉譯的兩成改感載、聚光的「觀眾越多越高」、忠犬的「替他擋傷害」與對象死了、共鳴的「搭檔過載時自己也受一半」、渴求的「感載越高檢定越高」；靜水應該整筆寫得出來）、三個只存不做的 `flags` 各要誰配合。
