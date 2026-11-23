# M2-director

- 交給：cpp-feature（sonnet）
- 目標：新功能 `director`：唯一的事件導演。讀每一回合報告上的觸發點，照範圍的機率、冷卻、篩選、權重挑事件，照每回合的上限放行或延後。
- 規格出處：EVENTS 第 1 節、2.1、2.2 節（欄位與條件）、第 3 節全部（觸發點、流程、機率與冷卻、排序與上限、類型平衡、佇列）、第 6 節（內容篩選）、第 7 節（設定的樣子）；dev/adr/0016 第二節（`triggers`）、第四節、第六節（`time.passed` 的順序）。
- 可以改的路徑：`engine/src/features/director/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-director.test.ts`。
- 可以用的介面：`k.hooks.on('turn.end' | 'time.passed' | 'report.after')`、`report.triggers`、`k.activity.active`／`start`、`k.conditions`、`k.effects.resolve`、`deriveRng`、`crossings`、`state.rules.contentOff`。
- 不可以做的事：不寫事件視窗裡的選項與檢定（M2-event-run）；不認得任何一個發觸發點的功能（只看 `triggers` 上的字）；不替某一種範圍寫專屬的程式；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `event`（這一張只驗表頭：`id`、`scope`、`triggers`、`where`、`when`、`requires`、`weight`、`weight_mods: [{ if: 條件, mult }]`、`category`、`blocking`、`repeat_days`、`tags`、`adult`；內文的檢查留一個可以再掛的函式給 M2-event-run）。
- 內容種類 `event_scope`（規則）：每個範圍一筆 `{ id, triggers: { 觸發點: 機率 }, cooldown_hours, repeat_days, daily_cap?, priority?, lost: 'drop' | 'defer', defer_hours?, in_commission?, roller?: 'pc' | 'best', dc_plus? }`；另一筆 `event_rule`（每回合 1 件擋住的加 2 則通知、城裡每天 8 件、類型記 6 件、每次 ×0.35）。
- 狀態 `state.ext.director`：每個範圍上次的時間與今天的件數、每件事上次的日子、最近的類型、延後的事件（含到期）、排隊的通知。
- 報告：`event.notice`（不擋的事件，效果當場結算）。

## 要做的

1. `turn.end`：照 EVENTS 3.2 節走一次。亂數用 `deriveRng(state.rng, 'director/<時間的總分鐘>/<觸發點>/<範圍>')`。`where` 的每個鍵對觸發點的 `where` 與 `state.location`（陣列是任一個）；`when` 對時段與星期；`requires` 問 `k.conditions`；帶著玩家關掉的標籤的不抽；`repeat_days` 之內的不抽。篩完一件都沒有：當作沒發生，不吃冷卻。
2. 權重 = `weight` × 成立的 `weight_mods` × 類型平衡。敵對值、豔名這些共通的修正用 `weight_mods` 寫在資料裡，程式不寫死。
3. 排序與上限照 3.4 節：有 `commission` 這種活動在進行時只擲 `in_commission` 的範圍；這一回合已經有活動要開、或有活動進行中，擋住型的全部延後；同一回合好幾個沒有優先序的範圍擲中，隨機留一個。放行擋住型的事件＝`k.activity.start(k, state, 'event', { event: id }, { by: 'director', ext: { scope, trigger } })` 拿到的草稿（沒有人登記 `event` 時改成排隊，不丟錯）。
4. 延後的事件到期作廢、不吃冷卻；下一個可以放行的回合先放延後的。
5. `time.passed`（順序 20）：每天 08:00 的 `daily`、週一 06:00 之後的 `weekly`，當成觸發點走同一條流程；一次跨好幾天最多補 3 次。
6. 對外：`directorView(state)`（延後幾件、今天放行了幾件、每個範圍的冷卻還剩多久），給介面與探針用。

## 驗收條件

- 機率 1 的範圍、一件符合的事件：帶那個觸發點的回合之後，事件視窗的替身活動開起來；機率 0 的不開。
- 同一個種子、同一串動作，放行的事件一模一樣；回退再做一次也一樣。
- 冷卻內第二次觸發不擲；篩完沒有事件時冷卻不動。
- `where`、`when`、`requires`、被關掉的標籤、`repeat_days` 各有一條擋下的例子。
- 類型平衡：最近六件都是同一類時，那一類的候選權重是 0.35 的六次方倍（用兩件事件的抽中比例或直接問權重驗）。
- 一回合三個範圍都擲中擋住型：只放行一件；有優先序的贏；其餘照 `lost` 作廢或延後。
- 城裡一天第 9 件擋住型不放行；副本內的不算在 8 件裡。
- 有 `commission` 的替身活動進行時，街頭的範圍不擲、`in_commission` 的照擲。
- 不擋的事件：當場出一份 `event.notice`、效果套上去；一回合最多兩則，第三則排到下一回合。
- 跨過週一 06:00：`weekly` 觸發一次；一次睡過三天，`daily` 補三次。
- 內容載入：`scope` 查不到、觸發點不在那個範圍的表裡、`requires` 的條件種類沒有人註冊，各自被擋下並寫出是哪一件。

## 依賴

M2-core-activity、M2-core-shell（`crossings`）。和 M2-event-run 同一個資料夾，不要同時做。

## 完成時回報

改了哪些檔、測試結果、EVENTS 第 3 節裡還沒做的（預期：存檔規則的範圍倍率與成人比重、曝露度的修正、鉤子與 AI 提出的事件）。
