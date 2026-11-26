# M5-ui-channel

- 交給：cpp-ui（sonnet）
- 目標：頻道的對話框接上引擎：三個數字、預算、開一集（選節目、成人檔、放料、上鏡、編制、設備、業配、預覽、開拍）、事件的入口、編制、最近的集數、設備；舊的 `data/channel.ts` 拿掉。
- 規格出處：docs/art/UI.md 6.2 節（照 MEDIA 讀：沒有「錄播或直播」、沒有草稿，V55）、1.1 節；MEDIA 第 4 節（4.1～4.6、4.8）；dev/adr/0020 第二、十二節、V12～V20、V55；dev/work/M5-channel.md、M5-channel-shows.md 的「新的格式與鍵」與匯出。
- 可以改的路徑：`ui/src/dialogs/ChannelDialog.vue`、`ui/src/lib/`（新增 `channelView.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉 `channel` 假狀態）、`ui/src/dialogs/BillsDialog.vue`（只加一段「頻道這一週」，讀引擎）、`ui/src/data/demo/`、`ui/tests/channel/`；刪 `ui/src/data/channel.ts`。
- 可以用的介面：`@engine/src/features/channel` 的 `channelView`、`openChannel`、`fund`、`withdraw`、`withdrawPreview`、`endSponsor`、`showOptions`、`episodePreview`、`airEpisode`、`seatStaff`、`dismissStaff`、`mountGear`、`unmountGear`；`@engine/src/features/media` 的 `mediaView`（挑料用）；`Game.commit`／`commitNarrated`；共用元件 `Dialog`、`Hint`、`ReasonButton`、`ItemSlot`、`MoneyTag`、`TrackBar`。
- 不可以做的事：不改 `engine/`；機率、評價的結果、能不能開、灰掉的原因都讀引擎；直播不從這裡開（只列在最近的集數裡）；事件的內容不做（待處理的事件走現有的事件視窗與「待處理」）；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **還沒有頻道**：一個取名的小表單與「開頻道」。
2. **左欄**：頻道名與等級（編制幾格）、訂閱與公信力兩個大數字、最近十集的訂閱曲線（讀 `log`）、推薦權重七格、離下一級差多少；預算——帳戶與現金兩格、自有與每個金主的公帳一列（撥進來的、可支領額度的條，已拿的那一段斜紋、金主的條件），補貼與拿出來（拿出來先顯示 `withdrawPreview`：會扣哪個勢力多少好感、加多少敵對值，確認才送）。
3. **開一集**（中欄）：節目卡（引擎給幾張就幾張；開不出來的灰掉、寫還差什麼；公演與獨家只有對的路數看得到——照 `showOptions` 有沒有列）；成人檔三段各寫倍率（選不了的灰掉並有原因）；**放料**：三格（公演是零到三格），點開從素材庫挑，放不進的灰掉、原因寫出差的是類型還是品質，每一格顯示看點與「會扣 1 次」；誰上鏡（寫他的主要基本功）；帶哪些編制；用到的設備（每類一格、沒有的變淡、寫加總與上限 +6）；業配（掛哪一家、加多少、公信力 −1）；加開的選項（引擎給的，例：握手會）。
4. **預覽**（中欄下方）：算式一項一項（沒有媒體型技能的 +3 用橘字）、難度、四種評價各自的機率與結果（觀看、訂閱、打賞、廣告）、這一集的其他影響。全部讀 `episodePreview`。
5. **開拍**：送出、顯示結果（評價的色塊、擲了多少、每一項變化）；獨家播完多一顆「直接開戰」（連到輿論戰的準備；M5-ui-opinion 之前先灰掉）。
6. **右欄**：待處理的事件（讀現有的事件佇列裡範圍是 `channel` 的；沒有就不顯示這一塊）；編制三格（是誰、名冊或雇來的、薪水；空的寫怎麼補；換人、請走）；最近的集數（評價的色塊、節目・成人檔、哪一天、主要的變化；成人檔的那集一個粉點；直播收播的那一筆寫「直播」）；設備五類（裝上、拆下，從背包挑帶 `studio` 欄位的物品）。
7. **帳單對話框**多一段「頻道這一週」：撥款、薪水、流失、自然成長（讀引擎最近一份 `channel.weekly` 與 `channelView`）。
8. **示意包**：兩件帶 `studio` 欄位的設備（物品）、一個會給贊助的事件；示意模式的開新局選項：開局已經開好一個頻道（幾百訂閱）、設備裝著、一位坐著製作的夥伴、一份贊助。
9. 手機版照 UI 6.2 節最後一條。

## 驗收條件（`ui/tests/channel/M5-ui-channel.test.ts`；用引擎真的 `channel` 與 `media`）

- 沒有頻道時顯示開頻道；開了之後三個數字等於引擎的量表。
- 節目卡的張數與灰掉的原因等於 `showOptions`；沒有主播路數看不到獨家。
- 放料：一段日常類的素材放不進專題（灰的、原因有「罪證」）；放進雜談之後那一格顯示看點；放三件開拍，三件各少一次。
- 預覽的四個機率等於 `episodePreview`，加起來 100；換一個上鏡的人數字跟著變。
- 錢不夠時「開拍」是灰的、點了說引擎的原因；素材的次數沒變。
- 拿出來超過額度：先看到預覽（好感 −1、敵對值 +1），取消不送。
- 最近的集數多一列、評價的顏色對；直播收播（用引擎的 `live` 或替身的 `activity.end`）也多一列。
- 掃原始碼：`ui/src/data/channel.ts` 不存在、沒有任何檔 import 它；`ChannelDialog.vue` 沒有 `Math.random`、沒有自己算機率或評價的函式；畫面上沒有「實況」「錄播或直播」。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-channel、M5-channel-shows。排在 M5-ui-media 之後（都改 `stores/engine.ts`）。

## M4 對帳（2026-11-26）

- **示意模式**（使用者 2026-11-26；M4-fix-ui 第 2 題）：示意世界包裡「世界上有的東西」（模板、目標、議題、住處的版面、物品）照舊放 `ui/src/data/demo/`；「開局就已經有」的東西是示意捷徑，一律做成開新局的選項，而且只有示意模式開著才出現——不放進一般的新局、不在對話框裡另外給按鈕。照 M4-fix-ui 做好的那一套接（`demo…Changes` 在 `game.new` 給一次）。
- 一般的新局要走「還沒有頻道 → 取名 → 開頻道」那一條，驗收的第一條用它。

## 完成時回報

改了哪些檔、測試結果、引擎沒給所以沒顯示的、UI 6.2 節要跟著改的地方（給文件代理）。
