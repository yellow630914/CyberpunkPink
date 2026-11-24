# M5-live-houses

- 交給：cpp-feature（sonnet）　（**第三波；要等 M4 的簾後館與單人場景做完**）
- 目標：直播接上三個「館」與 M4 留給 M5 的東西：(1) 簾後館的內場直播與內場帶；(2) 迷宮館的直播（觀看數算進評價、館方抽成）；(3) 成人時段直播接 M4 的單人場景；(4) 在內海開播時追蹤度持續上升。
- 規格出處：CYBERSPACE 8.8 節（場熱的表裡「內場直播」那幾列、點單的「返場」、產出的「素材」那一列、「和別的系統」的媒體與直播那一列）、8.2 節（迷宮館的時間與評價、直播）、SITES 13.4 節裡迷宮館那一列（館方抽打賞的兩成）；MEDIA 第 6 節（在內海開播追蹤度持續上升）、1.3 節（成人種類）、11.2 節（內場帶賣進萬華鏡）；dev/adr/0020 第三節、第十四節 D2、D4、D9、V53；dev/adr/0019 第九節（單人）、第十二節與 P57（沒有直播的簾後館留下什麼）；dev/work/M5-live.md、M5-live-slot.md、M3-maze.md。
- 可以改的路徑：`engine/src/features/live/`、`engine/src/features/maze/`（只加評價讀觀看數與抽成）、M4 的 `engine/src/features/curtain/`（只加下面列的四處；先讀它的實作，對不上就停下來回報）、`engine/tests/features/M5-live-houses.test.ts`。
- 可以用的介面：`live` 的 `Session.house`、`goLive`、`liveView`、`activity.end`（種類 `live`）；掛點 `netrun.round`、`netrun.close`、`media.record`；`battle.field.trace`、量表 `trace`；0019 的場景（`kind: 'solo'` 的 `setup`）、簾後館的場熱量表（名字照 D9 的裁決）；條件 `live_on`。
- 不可以做的事：功能之間不互相 import（`live`、`maze`、`curtain`、`scene` 只靠掛點、條件、`activity.end` 與 `launch` 相接）；不匯入簾後館的內容；內場直播不進頻道的訂閱與公信力（CYBERSPACE 8.8）；開工前先確認 0020 第十四節 D2、D4、D9 的假設和 M4 的實作一樣，不一樣的先回報、不要自己猜；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `Session.house`：`{ id: 'maze' | 'curtain' | string, viewers_mult: number, tips_mult: number, to_channel: boolean, cut: number（館方抽打賞的比例）, tags?: string[]（留下的那一則紀錄與素材帶的標籤，例：`house:curtain`） }`。
- 內容種類 `stream_template` 加兩筆預設：`st_maze`（亮點照戰鬥的表，加「過一層」）、`st_curtain`（亮點照戰鬥的表；每場戰鬥結束 +1）；兩筆都帶 `trace_round`（在有追蹤度的地方每個探索回合與戰鬥回合多加的追蹤度，預設 1；迷宮館與簾後館沒有追蹤度，等於不作用，一般子網裡開播才有）。
- 宿主多一種：`netrun`（一趟網內的行程）。開播的時機照 V21：剛進去、還沒走第一步。館的參數從那一趟開始的那一拍的 `data` 拿（`maze.enter`、`curtain` 的進場報告各帶一拍 `data: { house }`；這是資料慣例，由這一張在兩個功能裡各加一行）。

## 要做的

1. **宿主是一趟網內的行程**：`live` 認 `k.activity.active` 裡的 `netrun`；裡面的戰鬥算同一場（照副本直播的做法，V22）；那一趟結束（`activity.end` 的 `netrun`）收播。一般的子網（自己去挖的、委託的內海階段——後者宿主是副本）裡開播：每個探索回合與每個戰鬥回合追蹤度 +`trace_round`（MEDIA 第 6 節）；做法是 `report.before` 看到 `netrun.` 的探索回合報告時補一筆量表的變更、戰鬥裡補 `battle.field.trace`。
2. **迷宮館**（改 `features/maze`）：進場的報告帶 `house`（`to_channel: true`、`viewers_mult: 1`、`tips_mult: 1`、`cut: 0.2`）；結算（它聽 `netrun.close` 的地方）多讀「這一趟有沒有直播、收播時的觀看數的級距」——從同一份結束報告裡 `live.end` 那一拍讀不到（先後順序）時，改成聽 `activity.end` 的 `live` 把級距記進自己的狀態再結算；評價的第三項照 CYBERSPACE 8.2（觀看數的級距：熱或爆各往上修一級的門檻，數字放 `maze_rule`，暫定並回報）。館方抽成：`live` 結算時打賞 ×（1 − `cut`）。
3. **簾後館**（改 `features/curtain`，四處；0019 P57 留下的）：
   - 進場的報告帶 `house`（`to_channel: false`、`viewers_mult: 0.5`、`tips_mult: 2`、`cut: 0`、`tags: ['house:curtain']`）。
   - 場熱：內場直播開著（條件 `live_on` 成立）時每場戰鬥結束 +2。
   - 點單的「返場」：內場直播開著才擲得到（現在是重擲）；完成時請 media 記一則（`media.record`，類型親密、帶館的標籤）。
   - 落幕時的內場帶：照 CYBERSPACE 8.8 的產出表給一段素材（效果 `footage`，類型親密（V53）、品質照那張表、`tags: ['house:curtain']`）。帶這個標籤的素材與片：`media` 的上架在 `tags` 含 `house:` 時多一個選擇「過限幅上萬華鏡（館拿四成：訂閱與打賞的效果 ×0.6）」或「只上內場」（不進訂閱、只給打賞）——這是 `features/media` 的一小段，列在回報由修正工單做，這一張只確保標籤帶得到。
4. **成人時段直播接單人場景**（D2）：`slotStart` 的成人種類改成——開播那一份報告 `launch` 一場 M4 的單人場景（`setup` 照 0019），直播的 `Session` 變成「時段直播而且掛著一場場景」：熱度照場景的行動加（照 `st_adult` 的表，起始熱度照 1.3）、時間照選的時數、場景結束後照常 `slotEnd`。`setup` 照 dev/work/M4-scene-solo.md：`solo: true`、`nature: 'solo'`、`goal: 'footage'`、`audience: true`（有人在看：說話與標了 `audience` 的技能才用得出來）。場景結束（`activity.end` 的 `scene`，`result.solo`）時把它的評價換成熱度的加減（暫定：`rating` 最好的一級 +2、最差的一級 −1，數字放 `live_rule`）。活動直播掛在「已經開始的」單人場景上時 `audience` 改不了：scene 沒有那個入口就回報，這一張不硬改 `features/scene`。單人場景這種 `setup` 不被接受（M4 沒做）時照舊是一次誘惑檢定。
5. `liveView` 多 `house`（名字、觀看數是不是打對折、打賞的倍率）給介面。

## 驗收條件（`engine/tests/features/M5-live-houses.test.ts`；測試裝真的 `netrun`、`maze`、`live`，簾後館與單人場景用 M4 的實作（還沒有的那一段用玩具活動與替身，並在回報標明哪幾條是替身測的））

- 迷宮館一趟開播：三層都算同一場；破關收播；打賞少兩成；評價在觀看數「爆」的時候比沒直播的高一級（門檻照規則）。
- 自己去挖的子網裡開播：每個探索回合追蹤度多 1；迷宮館裡不加（沒有追蹤度）。
- 簾後館：內場直播的觀看數是一般的一半、打賞加倍、收播之後頻道的訂閱沒變、「這一週開過」不算；每場戰鬥結束場熱 +2；返場擲得到；落幕拿到一段帶 `house:curtain` 的親密類素材。
- 成人時段直播：開了一場單人場景、它的 `setup.audience` 是 true、每個行動熱度 +1、場景的評價換成熱度的加減、收播的結算照時段直播的式子；單人場景開不起來時退回一次檢定。
- 把 `live` 拿掉：迷宮館與簾後館的測試原樣全過（評價只看原本的兩項、場熱不加直播那一項）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-live-slot；M4 的簾後館（M4-curtain-*）與單人場景（M4-scene-solo）；D9 的裁決。

## 完成時回報

改了哪些檔、測試結果、D2、D4、D9 和實際的差別、`features/curtain` 與 `features/maze` 各改了哪幾行、帶館標籤的素材上架要 media 補的那一段、哪幾條驗收是用替身測的。
