# M5-live-houses

- 交給：cpp-feature（sonnet；引擎的那一半）與 cpp-ui（sonnet；畫面的那一半，引擎那一半做完再派）　（**第三波**；M4 的簾後館與單人場景已經做完，這一張照 2026-11-26 的實作寫：0020 文末「M4 對帳」）
- 目標：直播接上三個「館」與 M4 留給 M5 的東西：(1) 簾後館的內場直播與內場帶；(2) 迷宮館的直播（觀看數算進評價、館方抽成）；(3) 成人時段直播接 M4 的單人場景；(4) 在內海開播時追蹤度持續上升。
- 規格出處：CYBERSPACE 8.8 節（場熱的表裡「內場直播」那幾列、點單的「返場」、產出的「素材」那一列、「和別的系統」的媒體與直播那一列）、8.2 節（迷宮館的時間與評價、直播）、SITES 13.4 節裡迷宮館那一列（館方抽打賞的兩成）；MEDIA 第 6 節（在內海開播追蹤度持續上升）、1.3 節（成人種類）、11.2 節（內場帶賣進萬華鏡）；dev/adr/0020 第三節、第十四節 D2、D4、D9、V53 與文末「M4 對帳」（D2、D4、V56、V66）；dev/adr/0019 第九節（單人）、第十二節與 P57（沒有直播的簾後館留下什麼）；`engine/src/features/curtain/heat.ts` 的檔頭（M4-curtain-run 留下的三個接點）；dev/work/M5-live.md、M5-live-slot.md、M3-maze.md。
- 可以改的路徑：
  - 引擎：`engine/src/features/live/`、`engine/src/features/maze/`（只加進場那一拍、評價讀觀看數的級距）、`engine/src/features/curtain/`（只加下面列的六處）、`engine/src/features/media/`（只加帶館標籤的素材上架的那一段）、`engine/tests/features/M5-live-houses.test.ts`。
  - 畫面：簾後館的面板（M4-ui-curtain 做的 `ui/src/components/curtain/` 與 `dialogs/CurtainDialog.vue`）、迷宮館與簾後館一趟的畫面（`ui/src/screens/SubnetScreen.vue`）、`ui/src/dialogs/LiveDialog.vue`、`ui/src/screens/AdultSceneScreen.vue`（只放頂列）、`ui/src/dialogs/CutDialog.vue`（帶館標籤的素材上架多兩個選擇）、`ui/src/stores/engine.ts`（只加轉接）、`ui/tests/live/M5-ui-live-houses.test.ts`。
- 可以用的介面：`live` 的 `Session.house`、`goLive`、`liveView`、`activity.end`（種類 `live`）、條件 `live_on`；掛點 `netrun.round`、`netrun.close`、`media.record`；`battle.field.trace`、量表 `trace`；M4 的場景（活動 `scene`，`setup.solo`、`audience`、`goal: 'footage'`、`max_rounds`）；簾後館的場熱量表 `stage_heat`（鍵是那一趟的地圖實例；只有內建的來源能動）、它的 `runPatch`（`curtain.patch`）。
- 不可以做的事：功能之間不互相 import（`live`、`maze`、`curtain`、`scene`、`media` 只靠掛點、條件、`activity.end`、報告的一拍與 `launch` 相接）；不匯入簾後館的內容；內場直播不進頻道的訂閱與公信力（CYBERSPACE 8.8）；不動 M4 簾後館沒有直播時的行為（沒有裝 `live` 的局，M4 的測試原樣全過）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `Session.house`：`{ id: 'maze' | 'curtain' | string, viewers_mult: number, tips_mult: number, to_channel: boolean, cut: number（館方抽打賞的比例）, tags?: string[]（留下的那一則紀錄與素材帶的標籤，例：`house:curtain`） }`。
- 館的參數怎麼到 `live`（資料慣例，不 import）：那一趟進場的報告（`maze.enter`、`curtain.enter`）多一拍 `tag: 'live.house'`、`data: { house }`；`live` 開播時從最近一份帶這一拍的報告讀（那一趟的 `netrun.enter` 之前的那一份）。沒有這一拍就是一般的子網，沒有 `house`。`house.to_channel` 是 `false` 的館（內場直播是館方的機位）開播時不要求玩家開著頻道；其餘照 M5-live 的條件。
- 內容種類 `stream_template` 加兩筆預設：`st_maze`（亮點照戰鬥的表，加「過一層」）、`st_curtain`（亮點照戰鬥的表；每場戰鬥結束 +1）；兩筆都帶 `trace_round`（在有追蹤度的地方每個探索回合與戰鬥回合多加的追蹤度，預設 1；迷宮館與簾後館沒有追蹤度，等於不作用，一般子網裡開播才有）。
- 宿主多一種：`netrun`（一趟網內的行程）。它可能包在潛入（`dive`）裡面（簾口與迷宮館的入口都可以放在潛入之後的網內街區），`live` 認的是 `netrun`，外面那一層不管；放行 M5-live 已經用 `allowEverywhere`，不用再加。開播的時機照 V21：最近一份 `netrun.` 開頭的報告是 `netrun.enter`（進場帶出來的 `login` 事件、簾後館自己的 `curtain.stage` 都不是 `netrun.` 開頭，不影響）。
- 條件 `live_on` 多收 `tier_min?: 'hot' | 'boom'`（觀看數的級距至少是熱或爆；MEDIA 1.2 的三段）。和 `viewers_min` 一樣只讀量表與自己的狀態。
- `live_rule` 多：成人時段直播接場景時每小時幾個回合（`adult_rounds_per_hour`，暫定 4）、場景評價換熱度的加減（最好的一級 +2、最差的一級 −1，暫定）。
- `curtain_rule` 多：`heat.live`（內場直播開著時每場戰鬥結束的場熱，2）、`live_tips_mult`（開過內場直播的那一趟打賞的倍率，2）。
- `RunRecord`（`features/curtain/model.ts`）多 `live?: true`（這一趟開過內場直播）。
- 報告：`live.scene`（成人時段直播開場景的那一份，見下）。

## 要做的（引擎）

1. **宿主是一趟網內的行程**：`live` 認 `k.activity.active` 裡的 `netrun`；裡面的戰鬥與場景算同一場（照副本直播的做法，V22）；那一趟結束（`activity.end` 的 `netrun`）收播。一般的子網（自己去挖的；委託的內海階段宿主是副本）裡開播：每個探索回合與每個戰鬥回合追蹤度 +`trace_round`（MEDIA 第 6 節）；做法是 `report.before` 看到 `netrun.` 的探索回合報告時補一筆量表的變更、戰鬥裡補 `battle.field.trace`。
2. **迷宮館**（改 `features/maze`）：
   - `maze.enter` 多那一拍，`house` 是 `{ id: 'maze', to_channel: true, viewers_mult: 1, tips_mult: 1, cut: 0.2 }`。
   - 評價（它聽 `netrun.close` 結算的地方）：`netrun.close` 被問的那一刻直播還開著（`activity.end` 在它後面才發），所以直接問條件 `live_on { tier_min: 'hot' }`、`{ tier_min: 'boom' }`（有人註冊才問）；評價的第三項照 CYBERSPACE 8.2（熱或爆各往上修一級的門檻，數字放 `maze_rule`，暫定並回報）。
   - 館方抽成在 `live` 那一邊：結算時打賞 ×（1 − `cut`）。
3. **簾後館**（改 `features/curtain`；M4-curtain-run 在 `heat.ts` 檔頭列的三處，加上進場那一拍、記下開過內場直播、內場帶，一共六處）：
   - **進場**（`enter.ts` 的 `curtain.enter`）：多那一拍，`house` 是 `{ id: 'curtain', to_channel: false, viewers_mult: 0.5, tips_mult: 0, cut: 0, tags: ['house:curtain'] }`。`tips_mult: 0`：內場直播收播時，直播自己的那一筆「熱度換打賞」不給——內場的打賞只有館方照場熱算的那一筆，加倍加在那裡（V56）。
   - **記下開過內場直播**：在它已經掛著的 `netrun.round` 與 `battle.ts` 的 `onBattleEnd` 裡，條件 `live_on` 有人註冊而且成立、而 `run.live` 還不是 `true` 時，補一筆 `runPatch({ set: { live: true } })`。之後提早收播也還算開過。
   - **場熱**（`battle.ts` 的 `onBattleEnd`）：`live_on` 成立時每場戰鬥結束再 +`rules.heat.live`，多一行「內場直播開著，場熱 +2。」（數字照規則）。
   - **打賞加倍**：`settle.ts` 的 `closeRun` 與 `fall.ts` 算落幕打賞的那一行，本來就乘 `run.tips_mult`；`run.live` 是 `true` 時再乘 `rules.live_tips_mult`，結算的句子多一段「內場直播 ×2」。這一週的打賞（`week.tips`）記的是乘完的。
   - **返場**（`orders.ts` 的 `usable` 與 `orderText`）：現在擲到 `encore` 一律重擲。改成 `live_on` 成立時收下（句子照 CYBERSPACE 8.8：「返場：把剛打完的層主的一段錄下來。」），接受之後當場完成：場熱照點單表那一列、請 media 記一則（掛點 `media.record`：類型親密、`live`、帶館的標籤；沒有人回答就只有場熱）；`live_on` 不成立照舊重擲。
   - **內場帶**（`closeRun` 與落幕的結算）：破關或落幕時給一段素材（效果 `footage`，有人註冊才給）：類型親密（V53）、`tags: ['house:curtain']`、品質照結算時場熱的那一段（`heatBand` 的 0～4 對到 1～5，暫定）。提早離場不給。它和落幕擲的「母帶」（`tapes`：外流、買回）是兩件事，母帶的規則不動。
4. **帶館標籤的素材怎麼上架**（改 `features/media` 的上架）：素材或片的 `tags` 有 `house:` 開頭的標籤時，`upload` 多收 `via: 'house' | 'public'`——`house`（只上內場：不給訂閱與公信力、只有打賞那一項）或 `public`（過限幅上萬華鏡：照一般的上架算，訂閱與打賞的效果 ×0.6，館拿四成）；沒選時擋下，原因：「這段帶子是館方的，選一個上架的地方。」`uploadPreview` 兩種都給。
5. **成人時段直播接單人場景**（D2、V66）：`slotStart` 的成人種類，在 `scene` 這種活動有人登記時改走三步——
   - `live.start`：照舊（檢查、推進一半的時間、帶觸發點 `live_mid`），但不擲誘惑檢定；`Session` 記 `scene: 'pending'`。這時活動 `live` 多放行 `scene.start` 與 `commit:scene.`（M5-live-slot 的清單本來就有）。
   - 事件視窗（如果有）處理完之後，玩家做 `slotScene(k, state)`：報告 `live.scene`，`launch` 一場單人場景——`setup: { solo: true, nature: 'solo', goal: 'footage', audience: true, max_rounds: 時數 × adult_rounds_per_hour }`（在內海就照 scene 自己的規則是內海的場景）。場景開不起來（`startProblems` 有原因：沒有橋、內容篩選……）時這一步丟 `ActionBlocked`，玩家可以改用 `slotEnd` 直接收播（那一場熱度只有起始值）。
   - 場景進行中：熱度照 `st_adult` 的表（每個行動 +1、最多 +10；起始熱度照 MEDIA 1.3）。場景結束（`activity.end` 的 `scene`，`result.solo`）時把評價換成熱度的加減，`Session.scene` 改成 `'done'`；之後照常 `slotEnd`（推進另一半時間、結算）。場景還沒結束時 `slotEnd` 被擋：「表演還沒結束。」
   - `scene` 沒有人登記（或 `Session.scene` 的做法被關掉）時，照 M5-live-slot 的一次誘惑檢定。
   - 活動直播掛在「已經開始的」場景上：M5-live 第 9 項已經讓場景經條件 `live_on` 知道有人在看，這一張不用再處理。
6. `liveView` 多 `house`（名字、觀看數是不是打對折、打賞給不給、館方抽幾成）與 `scene`（`pending`、`on`、`done`）給介面。

## 要做的（畫面；引擎那一半做完再派）

1. **迷宮館與簾後館**：進場之後、還沒走第一步時，畫面上一顆「開播」（簾後館寫「開內場直播」），點開的小卡用 M5-ui-live 的那一張，多一行館的條件（迷宮館：館方抽兩成打賞；簾後館：只有會員看得到、不進頻道、館方的打賞加倍）。直播中頂列用 M5-ui-live 的元件，內場直播多一個「內場」小標、打賞那一格顯示「算在館方的打賞裡」。
2. **簾後館的面板**（M4-ui-curtain）：場熱的說明多「內場直播開著，每場戰鬥 +2」那一行（開著才亮）；點單出現「返場」；結算卡的打賞多「內場直播 ×2」與「拿到一段內場帶」（連到素材對話框）。
3. **素材對話框**：帶館標籤的素材與片多一個小標「館方授權」，上架時先選「只上內場」或「過限幅上萬華鏡（館拿四成）」，兩種的預覽都讀引擎。
4. **時段直播的成人種類**：開播之後對話框多一顆「開始表演」（`slotScene`；事件視窗開著時先處理事件），之後換到場景畫面（單人），頂列照樣在；場景結束回到對話框按「收播」。場景開不起來時顯示引擎的原因，並讓玩家直接收播。
5. 示意包：迷宮館與簾後館沿用 M3、M4 的示意資料，不加新的捷徑。

## 驗收條件

引擎（`engine/tests/features/M5-live-houses.test.ts`；裝真的 `netrun`、`maze`、`curtain`、`scene`、`live`、`media`，簾後館用 M4 冒煙的做法：testkit 的 `bodyWorld()`、`curtainPlay.ts` 的 `playCurtainRun`，規則表每一幕改成一場遭遇）：

- 迷宮館一趟開播：三層都算同一場；破關收播；打賞少兩成；評價在觀看數「爆」的時候比沒直播的高一級（門檻照規則）。
- 自己去挖的子網裡開播：每個探索回合追蹤度多 1；迷宮館裡不加（沒有追蹤度）。
- 簾後館，走街上的簾口與潛入裡的簾口各一次：都開得了播、收得了播（外面那一層 `dive` 不擋）；沒有開頻道的主角也開得了內場直播，迷宮館的直播照舊要頻道。
- 簾後館開播的一趟：觀看數是一般的一半；收播之後頻道的訂閱沒變、「這一週開過」不算、直播自己沒有給打賞；每場戰鬥結束場熱多 2；館方的打賞是沒開播時的兩倍（同一個種子比對）；落幕的那一筆也是兩倍；返場擲得到、接了之後多一則帶 `house:curtain` 的紀錄；破關拿到一段帶 `house:curtain` 的親密類素材、品質對場熱的段。
- 開播之後馬上提早收播：`run.live` 還是 `true`、打賞照樣加倍；之後的戰鬥場熱不再多 2。
- 帶館標籤的素材上架：沒選 `via` 被擋；`house` 只有打賞；`public` 的訂閱與打賞是一般的六成。
- 成人時段直播：`live.start` 之後 `slotScene` 開了一場單人場景、它的 `audience` 是 true、說話做得了、每個行動熱度 +1、`max_rounds` 是時數 × 4；場景結束把評價換成熱度的加減；場景還沒結束 `slotEnd` 被擋；收播的結算照時段直播的式子。把 `scene` 拿掉：退回一次檢定，和 M5-live-slot 的結果相同。
- 把 `live` 拿掉：迷宮館與簾後館的 M3、M4 測試原樣全過（評價只看原本的兩項、場熱不加直播那一項、返場照舊重擲、打賞不加倍）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

畫面（`ui/tests/live/M5-ui-live-houses.test.ts`；用引擎真的功能）：

- 迷宮館剛進場有「開播」、走了一步之後是灰的；簾後館的卡片有「不進頻道」那一行。
- 內場直播中頂列有「內場」小標；結算卡的打賞等於引擎那一份結算的數字。
- 帶館標籤的素材上架要先選地方；兩種預覽等於 `uploadPreview`。
- 成人種類：開播 → 開始表演 → 場景畫面 → 收播，每一步的數字讀引擎。
- `ui` 的 `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-live-slot、M5-ui-live（頂列的元件）、M5-media-cut（上架）。M4 的簾後館（含收尾修正批的 B030、B031：潛入裡的簾口）與單人場景。和 M5-curtain-board 不要同時做（都改 `features/curtain`）。

## 完成時回報

改了哪些檔、測試結果、`features/curtain`、`features/maze`、`features/media` 各改了哪幾行、V56（打賞加倍加在哪）做的時候有沒有和設計書對不上的地方、內場帶的品質與返場的做法（設計書只有一句）、成人時段直播三步的流程順不順。
