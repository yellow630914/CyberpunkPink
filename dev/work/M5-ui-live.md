# M5-ui-live

- 交給：cpp-ui（sonnet）
- 目標：直播的畫面接上引擎：疊在戰鬥、成人場景、委託副本上的頂列與目標小窗（活動直播），和主畫面開的時段直播對話框；觀看數、熱度、目標、亮點、打賞都讀引擎，彈幕留在畫面當氣氛；舊的 `LivePanel` 假邏輯拿掉。
- 規格出處：docs/art/UI.md 1.1 節「怎麼分」那一條（直播是通用的容器：頂部單獨一行、彈幕飄過、目標的浮動小窗、手機版）、6.3 節（照 MEDIA 讀：沒有「日常」模板，V55）；MEDIA 1.2、1.3 節；EVENTS 4.11 節；dev/adr/0020 第三、十二節、V21～V28；dev/work/M5-live.md、M5-live-slot.md 的匯出；dev/work/M5-core-seams.md（`Game.undoBlock`）。
- 可以改的路徑：`ui/src/components/LivePanel.vue`、`ui/src/components/combat/LiveWindow.vue`、`ui/src/dialogs/LiveDialog.vue`、`ui/src/components/combat/BattleBoard.vue`、`ui/src/screens/AdultSceneScreen.vue`、`CommissionScreen.vue`、`MainScreen.vue`（只加頂列與入口）、`ui/src/lib/`（新增 `liveView.ts`；`liveEvents.ts` 只留彈幕用的對照）、`ui/src/lib/useBattle.ts`（拿掉自己算亮點的部分）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`、`ui/tests/live/`；刪 M5-ui-media 暫放的 `ui/src/lib/liveLegacy.ts` 與 `data/media.ts` 剩下的部分。
- 可以用的介面：`@engine/src/features/live` 的 `livePreview`、`goLive`、`cutLive`、`liveView`、`slotOptions`、`slotPreview`、`slotStart`、`slotEnd`、`SLOT_TAGS`、`SLOT_DIRECTIONS`；`Game.commit`／`commitNarrated`、`Game.undoBlock`；報告每一拍的事件標籤（彈幕用）。
- 不可以做的事：不改 `engine/`；熱度、觀看數的中心值、目標有沒有達成、訂閱與打賞都讀引擎，畫面不算；彈幕與 ±5% 的起伏只是氣氛，不影響任何數字、不寫回引擎；直播中不提供回退的按鈕；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **開播的入口**（活動直播）：戰鬥畫面、成人場景、副本頁在 `livePreview` 說可以開的時候顯示一顆「開播」；點開是一張小卡——模板的名字、這一場的目標（一到三條，開播時就定好）、風險一行（例：敵對值增加 ×1.5；副本直播：不能走潛行的路線）——確認才送 `goLive`。不能開時按鈕灰掉、原因用引擎的句子（例：「這一場已經開打了，來不及開播。」）。有多抽的目標要挑掉時（`live_goal_extra`）在這張卡上挑。
2. **頂列**（直播中，五個畫面共用一個元件）：「● LIVE」、觀看數（引擎的中心值，畫面每幾秒在 ±5% 裡起伏、不累加）、熱度、最近的亮點、這一場的打賞；級距（冷清、熱、爆）換一個顏色。戰鬥裡在先攻條的上一行。
3. **目標小窗**：每條目標、達成的打勾與加了多少熱度；可以縮成一條、拖標題列移動、拉右下角改大小；手機上固定在底部、開播後自動縮成一條。偷播（`secret`）時小窗上一個小標。
4. **彈幕**：照每一份新報告的事件標籤放預寫的句子（現有的 `danmakuOf` 與句子池留著，搬到 `lib/liveView.ts`），從右往左飄、不擋點擊。句子池不進引擎。
5. **收播**：宿主結束時引擎已經結算；畫面顯示一張結算卡（熱度、達成幾條目標、訂閱 +多少、打賞多少、「留下了一則紀錄」連到素材對話框）。提早收播一顆按鈕（`cutLive`，先確認）。
6. **時段直播**（主畫面工具列的「直播」→ 對話框）：四種的卡（不能開的灰掉並有原因）、時長 1～3 小時、選填的描述（一兩句話；下面一行小字：「AI 開著時會照描述挑標籤與方向；現在照你選的。」——第三波之前標籤與方向是兩個選填的下拉）、預覽（檢定的每一項、難度、四種結果的機率與熱度、上限 12）；「開播」送 `slotStart`；之後對話框變成進行中的樣子（頂列、熱度、「播到一半」），有直播事件時現有的事件視窗會疊上來；「收播」送 `slotEnd`、顯示結算卡。進行中關不掉對話框（引擎擋住別的事），Esc 說原因。
7. **回退的按鈕**：直播中工具列與選單的回退灰掉，原因讀 `Game.undoBlock()`。
8. `useBattle.ts` 與 `LivePanel.vue` 裡照紀錄文字或標籤自己算熱度、目標、訂閱的函式全部拿掉。
9. **示意包**：三個模板用引擎的預設；五條直播目標（照 `data/media.ts` 原本那五條的意思，改成引擎的 `stream_goal` 格式）。

## 驗收條件（`ui/tests/live/M5-ui-live.test.ts`；用引擎真的 `live`，戰鬥用 testkit 的情境）

- 戰鬥剛開始：有「開播」；卡片上的目標等於 `livePreview`；確認之後頂列出現、引擎有進行中的直播。打過一手之後另一場戰鬥沒開播：按鈕是灰的、原因是引擎的句子。
- 打出要害：頂列的熱度等於 `liveView().heat`；畫面沒有自己加。
- 觀看數顯示的值落在引擎中心值的 ±5% 內；等十次更新之後的平均不偏離中心值超過 5%。
- 打完：結算卡的訂閱與打賞等於引擎那一拍 `live.end` 的 `data`。
- 時段直播：四種的灰與原因等於 `slotOptions`；開播之後主畫面走路被擋（顯示引擎的原因）；收播之後時間過了選的時數。
- 直播中回退的按鈕灰掉、原因對；收播後恢復。
- 掃原始碼：`LivePanel.vue`、`useBattle.ts` 沒有 `liveHighlights`、`liveSettle`、`setInterval(` 裡改觀看數累加的寫法；`ui/src/data/media.ts` 與 `lib/liveLegacy.ts` 不存在；`ui/src` 沒有「日常直播」四個字。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-live、M5-live-slot、M5-core-seams。排在 M5-ui-channel 之後。

## 完成時回報

改了哪些檔、測試結果、成人場景與副本頁接上去時引擎少給了什麼、UI 6.3 節要跟著改的地方。
