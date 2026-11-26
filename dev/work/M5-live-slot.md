# M5-live-slot

- 交給：cpp-feature（sonnet）
- 目標：`live` 的另一種開法：**時段直播**——不掛在任何活動上，佔 1～3 小時，地點是玩家所在的地方，擲一次表演檢定，期間可能有一件直播事件，收播結算。它取代舊文件的「日常直播」。
- 規格出處：MEDIA 1.3 節（全部）、1.2 節的觀看數與收播換算、4.6 節（設備）；EVENTS 3.1 節（`live_mid`）、3.3 節（直播那一列）、4.11 節、2.4 節（`heat`、`highlight`）；AI_TASKS 3.1 節表下（`stream_daily` 先不收）；dev/adr/0020 第三節、第十一節、V25、V27、V28、D2；dev/work/M5-live.md 的「新的格式與鍵」。
- 可以改的路徑：`engine/src/features/live/`、`engine/tests/features/M5-live-slot.test.ts`。
- 可以用的介面：上一張的容器（`Session`、收播的結算、`media.record`、`activity.end`）；核心的檢定；`meterOf`（`subs`、`fame`、`popularity`）；`k.effects.register`；報告的 `triggers`；`time` 變更；`isStreetMapKind`、`state.maps`；掛點 `media.materials` 不用（直播不吃素材）；頻道的設備：衍生數值 `stream_gear_bonus`（channel 定義，M5-channel-shows；先問 `hasStat`，沒有人定義是 0）；效果 `fame`、`aired`。
- 不可以做的事：不 import 別的功能；不把它做成行動種類（不進 `actions.json`、不走 `free_action`）；不加 AI 任務（自訂的描述不判讀：`plan` 由呼叫的人給，沒給用預設）；成人種類不開場景（D2）；熱度不超過 12；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `live_rule` 多一張時段直播的表：四種（`chat` 閒聊：表演或交涉；`talent` 才藝：表演；`stroll` 逛街：街頭直覺或表演；`adult` 成人：誘惑）各自的基本功、起始熱度用哪一個（人氣級或豔名級）、限制；難度四段（訂閱不到 1,000 是 10、1,000 起 13、一萬起 16、十萬起 19）；結果換熱度（差 5 以上失敗 0、失敗 1、成功 3、超過 5 以上 6）；每多一小時 +1；上限 12；標籤七種（`funny`、`gentle`、`provoke`、`tech`、`nostalgia`、`edge`、`late`）；方向三種（`steady`：檢定 +1、熱度不超過 6；`bold`：檢定 −1、成功時熱度再 +1；`niche`：起始熱度 −1、訂閱 ×1.2）；自訂的修正最多 ±2 檢定、±1 熱度。
- 入口的輸入：`{ kind, hours: 1 | 2 | 3, text?: string, plan?: { tags?: string[]（最多 2）, direction?: string } }`。`text` 原樣放進報告的 `input`。
- `Session`（`mode: 'slot'`）多：`kind`、`hours`、`plan`、`roll`、`cap`（這一場熱度的上限）、`half_done: boolean`。
- 活動 `live` 在時段直播時只放行：`commit:live.`、`event.start`、`commit:event.`、`chain:free_action`（事件的「我要做別的」），以及直播事件可能帶出來的戰鬥與場景——照 `features/dive` 的 `DIVE_ALLOW` 同一組（`battle.`、`commit:battle.`、`chain:battle_end`、`battle.retry`、`commit:defeat.`、`scene.start`、`commit:scene.`）。原因：「直播中，先收播才能做別的事。」（契約的 `commit:contract.choose` 是 M4 用 `allowEverywhere` 放行的，自動有，不用列。）
- 效果：`heat { amount }`（EVENTS 2.4 節的名字。D9 已經定了：M4 的場熱量表是 `stage_heat`，`heat` 留給這裡；`live_heat` 這個名字不用）（±3；只在時段直播進行中收，其餘整筆拿掉並提醒；加完夾在 0～這一場的上限）、`highlight { amount? }`（只在直播中：熱度 +1～+3，活動直播也收）。
- 報告（kind `broadcast`）：`live.start`（擲骰、推進一半的時間、帶觸發點 `live_mid`）、`live.end`（推進另一半、結算；裡面有一拍 `tag: 'live.end'`）。
- 匯出：`slotOptions(k, state)`（四種各自能不能開、原因、難度、起始熱度）、`slotPreview(k, state, input)`（檢定的每一項與四種結果的機率、熱度）、`slotStart`、`slotEnd`、`SLOT_TAGS`、`SLOT_DIRECTIONS`。

## 要做的

1. **能不能開**：頻道開著（有人註冊才問）；沒有任何活動進行中（`k.activity.active` 是空的：M4 之後這包含臨檢、拍賣、搭車、斷線靜修、潛入）；所在的地方沒有 `no_rec`；逛街要站在城市的街區地圖上（`isStreetMapKind`）；四種各自可以在規則表寫 `tags`，經核心的 `tagsAllowed` 篩（預設都不帶：沒有「成人直播」這個內容篩選的細項，0020 V63）。
2. **起始熱度**：人氣級 = 人氣 ÷ 20 捨去（沒有人定義 `popularity` 是 0）＋ 訂閱的位數 − 3（最少 0）；成人種類把人氣級換成豔名的級數（這一區的豔名每 30 點一級）。`niche` −1（最少 0）。
3. **檢定**：1d20 ＋ 那一種的基本功裡較高的 ＋ 方向的修正 ＋ 設備（`stream_gear_bonus`，最多 +3）對訂閱定的難度。熱度 = 起始 ＋ 結果 ＋（時長 − 1）＋ 方向的加減，夾在 0～上限（12；`steady` 是 6）。
4. **`live.start`**：時間推進時長的一半；觸發點 `live_mid` 的 `where` 帶種類、標籤、區、設施的種類。導演擲不擲、開不開事件是它的事；事件給熱度的效果由這一張收。
5. **`live.end`**（沒有事件視窗開著時才做得了）：時間推進另一半；訂閱與打賞照 V25（`niche` 訂閱 ×1.2）；成人種類主角這一區的豔名 +1；請 media 記一則（類型：成人種類親密、其餘日常；`live`、`hq`）；效果 `aired`；發 `activity.end`（種類 `live`）。
6. 回到快照與上一張同一套（時段直播通常不在副本裡，照樣要對）。

## 驗收條件（`engine/tests/features/M5-live-slot.test.ts`；測試自帶玩具的事件活動（給熱度的效果）、替身的 `media.record`）

- 四種的基本功、起始熱度逐條對（人氣 45、訂閱 12,000 → 人氣級 2 ＋ 1；成人種類豔名 65 → 2）。
- 難度四段；四種結果換的熱度；3 小時 +2；總數超過 12 夾在 12；`steady` 夾在 6；`bold` 成功多 1、檢定 −1；`niche` 起始 −1、訂閱 ×1.2。
- `plan` 給了清單以外的標籤或三個標籤被擋，原因的句子對；沒給 `plan` 是預設（不加不減）。
- `live.start` 之後時間過了一半、帶 `live_mid`；這時走路、休息、開一集都被擋，原因對；`live.end` 之後時間過完。
- 事件給熱度的效果 +3：熱度加上去、不超過上限；直播沒開的時候給這個效果整筆拿掉並有提醒；AI 的來源給 +9 夾到 +3。
- 逛街不在街區地圖上開不了；`no_rec` 的地方開不了；有任何一個活動進行中（用玩具活動）開不了、原因是那個活動的句子；把成人種類在規則表加上 `tags: ['intimate_body']` 再關掉那個標籤時不列，預設不受任何開關影響。
- 同一個 kernel 裝著 `curtain`（量表 `stage_heat`）與這個功能：效果 `heat` 註冊得起來、不撞名。
- 直播事件的選項開一場戰鬥（玩具事件）：打得了、打完回到直播、收播照常。
- 收播：訂閱與打賞對式子；`media.record` 一次；`activity.end` 種類 `live` 一次；週內算開過（`aired` 有人註冊時）。
- `text` 出現在 `live.start` 的 `input`，不影響任何數字（同一個種子有無 `text` 結果相同）。
- `slotPreview` 的機率加起來 100。
- 掃 `engine/data/rules/actions.json` 與行動的登錄表：沒有 `stream_daily`。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-live。直播事件的內容不匯入（測試用玩具事件）。成人種類接單人場景是 M5-live-houses（第三波）。

## M4 對帳（2026-11-26）

- D9 定了（見上）；D2 的接法在 M5-live-houses，流程是「開播 → 可能有一件事件 → 另一份報告開場景 → 場景結束 → 收播」（0020 V66），這一張的成人種類照舊是一次誘惑檢定。
- 直播的事件範圍在 EVENTS 3.3 節有（觸發點 `live_mid`），但 `engine/data/rules/event_scopes.json` 現在還沒有那一列（由 M5-data-rules 補，範圍的 id 用 `live`）；這一張的測試自帶那一筆範圍。事件裡 `gate: ai` 的成人場景走外殼的 `narrated_gate` 這條鏈，問放行時用的是 `commit:event.*`，上面的清單已經涵蓋。
- 主角是契約人時，指令的期限在時段直播中自動暫停（contract 認任何活動）。

## 完成時回報

改了哪些檔、測試結果、V27、V28 對不上的地方。
