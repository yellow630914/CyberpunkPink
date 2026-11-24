# M4-drugs

- 交給：cpp-feature（sonnet）
- 目標：新功能 `drugs`：藥的使用（戰鬥內外）、持續與副作用、成癮與戒斷、治療、抑制劑。
- 規格出處：ITEMS 第 4 節（4.1 的每一條、4.2 的份量表以上；藥的目錄只當例子）；DOWNTIME 3.4、3.5 節；CYBERWARE 第 2 節抑制劑那一條；LIFE 第 6 節；CRAFTING 5.5 節節奏資源那一條；dev/adr/0019 第五節與 P13、P20。
- 可以改的路徑：`engine/src/features/drugs/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-drugs.test.ts`。
- 可以用的介面：內容種類 `item`（類別 `drug`；多讀的欄位在功能的 `ready` 查格式，做法看 `features/scene` 查物品的 `scene` 欄位）；`k.passives.register`（來源 `drug`、`withdrawal`）、`passiveProblems`；`k.effects`（把一串戰鬥外的效果變成變更：`effectCtx` 與登錄表的用法看 `features/director/body.ts`）；`k.battle.effect`（op `drug`）、`k.battle.modifier`、`k.battle.on('turn.start')`、`k.battle.onEnd`、`k.battle.on('battle.start')` 這一類現有的掛點（名字以 `core/battle/registry.ts` 為準）；掛點 `time.passed`、`rest.done`、`bill.collect`、`bill.settled`；`weeklyCrossings`、`toMinutes`；條件 `sunk`（M4-sink 註冊；沒有人註冊當作不成立）、`at_facility`；核心的 `item`、`actor.ext`、`cred`／`cash`、`time` 變更。
- 不可以做的事：不寫任何一種藥的內容；不做藥泵（`cyberware` 的）；不 import 別的功能；戰鬥中不直接改角色的狀態（成癮在戰鬥結束時寫）；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 物品的 `drug` 欄位：
  - `duration`：`{ minutes }`、`{ battle: true, minutes? }`（一場戰鬥；戰鬥外吃的話最多撐 `minutes`）二選一。
  - `effects`：被動效果的清單（藥效中）；`side?`：副作用，同一種格式；`upkeep_load?`：戰鬥中每個自己的回合開始感載加幾點。
  - `instant?`：吃下去當下的一串戰鬥外效果（EVENTS 2.4 節的效果，例：沉溺 +1）；`after?`：`{ minutes?, effects?: 被動效果, instant?: 戰鬥外效果 }`（藥效過後：再持續幾分鐘的被動效果，或當下的一串效果）。
  - `addiction`：`{ per_dose, withdrawal: { days, effects: 被動效果 } }`。
  - `suppressant?: true`（抑制劑的一劑）、`eases_withdrawal?: true`（鎮靜劑：戒斷的懲罰減半）、`needs_bridge?: true`（沒有橋的人吃了沒有效果，成癮照算）。
- `actor.ext.drugs = { active: Array<{ id, until, battle? }>, addiction: Record<藥, { value, last, used_week }>, withdrawal: Record<藥, { until, heavy }>, pending: Array<{ at, drug, kind }>, suppressant?: { until?, rebound_until? , weekly?: boolean } }`。
- 規則 `drug_rule`（`overridable`）：`weekly_decay`（10）、`depend_at`（40）、`depend_days`（7）、`heavy_at`（80）、`heavy_days`（3）、`prebattle_minutes`（10）、`detox`（`{ amount: 40, days: 3, price: 600 }`）、`suppressant`（`{ floor: -10, shown: -20, rebound: 15, rebound_days: 14, price: 資料 }`）。
- 條件：`drug_active`（`{ id }`）、`addicted`（`{ id?, min? }`，預設依賴以上）。效果（內建的來源才收）：`drug`（`{ id }`：當成吃了一劑，不扣物品）、`addiction`（`{ id, amount }`）。戰鬥的效果 op：`drug`（`{ item? }`，沒寫是這次用的那個道具）。
- 報告：`drug.use`、`drug.detox`、`drug.wear_off`（藥效過了、進入戒斷、戒斷結束）。匯出：`useBlock`／`useDraft(k, state, { actor, item })`、`drugView`、`detoxBlock`／`detoxDraft`、`suppressantDraft`（開關「每週帳單付抑制劑」）。

## 要做的

1. 戰鬥外吃一劑：物品少一個；`active` 多一筆（同一種還在的話只把時間重算，ITEMS 4.1 節「不疊加」）；跑 `instant`；成癮加 `per_dose`（最多 100）、記下最後一次與這一週用過。持續「一場戰鬥」的在 `prebattle_minutes` 內開打就撐到那一場結束，否則時間到就沒了。
2. 被動效果（來源 `drug`）：`active` 裡每一種的 `effects` 與 `side`；`needs_bridge` 而這個人沒有橋的不給。`ap_regen`、`ram_regen` 類的由核心夾在全身 +1。
3. 戰鬥中吃（op `drug`，由物品的 `use.effects` 叫）：這一場裡那個單位記下這種藥；它的 `effects` 與 `side` 裡 `mod` 類的用戰鬥的修正生效（屬性與衍生數值類的這一場不算，寫進回報）；`upkeep_load` 每回合加。戰鬥結束時（`onEnd`）把這一場吃的每一種寫進角色：成癮、`instant`、不是「一場戰鬥」型的補上剩餘的時間。這一場被回退就什麼都沒發生。
4. 戰鬥結束、喘口氣（`rest.done` 的 `breath` 與 `stage`）：「一場戰鬥」型的藥效結束，跑 `after`。時間到的也跑 `after`（在 `time.passed` 處理，接一份 `drug.wear_off`）。
5. 成癮（ITEMS 4.1 節）：每個週一，這一週沒用過的 −`weekly_decay`；值在 `depend_at` 以上而距離最後一次滿 `depend_days` 天（`heavy_at` 以上是 `heavy_days`）就進入戒斷：`withdrawal` 記到期的時間（藥自己的 `days`）與是不是重度；戒斷中給來源 `withdrawal` 的效果（重度的每一筆 ×2）；期間再吃一劑，戒斷取消、計時重來；戒斷期過完成癮歸零。身上有一種 `eases_withdrawal` 的藥生效中時，戒斷的每一筆減半（無條件捨去，最少 1）。
6. 戒斷療程：腳下的設施有 `clinic`（或設施種類的 `detox: { free?: true }`）；成癮 −40、時間過三天、收 600（`free` 的不收）。
7. 抑制劑（P20）：`suppressant.weekly` 開著時 `bill.collect` 出一行；`bill.settled` 付了：`until` 設到下一個週一，沒付而上一週有吃：`rebound_until` 設到兩週後。吃一劑 `suppressant: true` 的物品等於付了這一週。生效中給 `{ stat: 'sink_floor', amount: -10 }` 與 `{ stat: 'sink_shown', amount: -20 }`；反彈中給 `sink_floor` +15。條件 `sunk` 成立的人兩個都不給（溺感者無效）。
8. 效果 `drug`、`addiction`：給事件用（被下藥、藥的後遺症）。

## 驗收條件（`engine/tests/features/M4-drugs.test.ts`；測試自帶四種藥：四小時的檢定藥、一場戰鬥的命中藥（帶 `upkeep_load` 與 `after`）、高成癮的藥、抑制劑；`bills` 用測試自己掛的假掛點）

- 吃檢定藥：檢定的組成多一筆、來源是 `drug`；四小時後沒有；效果還在時再吃一劑，時間重算、沒有疊成兩筆、成癮加了兩次。
- 戰鬥藥：開打前五分鐘吃，戰鬥中命中 +1，打完沒有、`after` 的那一下感載有加；開打前二十分鐘吃的進戰鬥時已經沒了。戰鬥中用道具吃：命中 +1、每回合感載加、打完成癮才加；「重來這場戰鬥」之後成癮沒加、物品還在。
- 兩種都給 `ap_regen` +1 的東西（一個來源 `drug`、一個測試掛的 `cyber`）：只多 1。
- 成癮：吃到 45，七天不吃進入戒斷（懲罰生效、`drug.wear_off` 有一份報告），戒斷期過完歸零；85 的三天就戒斷而且懲罰是兩倍；戒斷中再吃一劑懲罰消失、計時重來；每週一沒用過的 −10。鎮靜劑生效時懲罰減半。
- 沒有橋的人吃 `needs_bridge` 的藥：沒有效果、成癮照加。
- 抑制劑：開著而且付了，`sink_floor` −10（配一個 +12 的測試 provider 看得出來）；下一週沒付，`sink_floor` +15、持續兩週；測試註冊一個成立的 `sunk` 之後兩個都沒有。
- 療程：成癮 60 變 20、時間 +3 天、扣 600。
- 效果 `drug` 讓人進入藥效而物品沒少；AI 給的被擋。
- 存檔再讀、回到快照，`actor.ext.drugs` 跟著走；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-passive、M4-core-product（物品類別 `drug`）。

## 完成時回報

改了哪些檔、測試結果、戰鬥中吃的藥哪幾類效果這一場不算、ITEMS 4.2 節目錄裡格式寫不出來的藥（預期：止痛劑的「生命值只看得到四段」、諦聽與睡蓮這類對別人用的、蝶粉的「高一段」、牆灰的 10% 妖精的吻要 `malware` 效果）。
