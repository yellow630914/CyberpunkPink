# M4-ui-scene

- 交給：cpp-ui（sonnet）
- 目標：成人場景的畫面接上新的引擎：多人（一圈三四個人、別的圈一行字、換圈與叫人）、單人、內海皮、開場的確認框用引擎給的摘要；角色的成人分頁加夜課的學習。
- 規格出處：docs/art/UI.md 第 10 節（成人場景）、8.5 節（夜課）、1.1 節；LEWD_SYSTEM 3.5 節第七、八點；dev/adr/0019 第九、十、十六節；dev/work/M4-scene-seats.md、M4-scene-circles.md、M4-scene-solo.md、M4-scene-net.md、M4-nightclass.md、M4-core-scene-ai.md 的格式與匯出；dev/status.md「M2-ui-scene 回報」。
- 可以改的路徑：`ui/src/screens/AdultSceneScreen.vue`、`ui/src/components/scene/`、`ui/src/lib/scene/sceneView.ts`、`ui/src/dialogs/character/AdultTab.vue`、`ui/src/dialogs/SettingsDialog.vue`（場景的 AI 模式一個選項、內容篩選補齊）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/scene.ts`、`ui/tests/scene/`。
- 可以用的介面：`Game.sceneBegin`、`sceneStep`、`sceneFinish`（M4-core-scene-ai；它還沒做完時用功能的 `sceneStart`、`sceneAct`、`sceneNext` 直接走，做完之後換過去只改 store 的一處）；`features/scene` 的 `sceneView`、`sceneOptions`、`scenePreview`、`startProblems`（開場的摘要）；`features/nightclass` 的 `nightList`、`learnBlock`、`learnDraft`；`features/deck` 的 `avatarOf`、`avatarDraft`；量表 `insight`。
- 不可以做的事：不改 `engine/`；畫面不自己判斷第幾步、誰有主動權、哪個行動灰掉（都讀引擎）；不寫任何露骨的文字（每一步顯示引擎給的那一句）；彈幕與直播的面板不做（M5）；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 確認框：用 `startProblems` 回傳的摘要（誰、性質、身分、目的、會碰到的標籤、是不是單人、在哪一層）；可以略過。拿掉畫面自己判斷「第 0 步、第 1 回合」的那一段。
2. 多人：主角這一圈每個人一張卡（感載、餘韻、檔位、和主角的契合與主動權、退出了沒有）；行動要選對象時多一步；「誰可以切換體位」照引擎；別的圈在旁邊各一行字；換圈與叫人過來是兩個行動（灰掉帶原因）。精簡版遇到多人設定時顯示引擎給的那一句說明（只展開一個對象）。
3. 單人：沒有對象的卡；契合的條換成節奏；行動的清單是引擎給的那一組（加快、放慢……）；「這個要有對象」「這個要有人在看」「沒有人在聽」照引擎的原因灰掉。
4. 內海皮：`layer` 是 `net` 時用內海的配色與化身的樣子（讀 `avatarOf`）；角色的內海分頁加「化身」的編輯（部位、存幾套）。
5. 結算頁：每個對象各一列（契合、評價、親密度的變化）；沉溺、橋參數、傾向、性經歷、體悟的變化讀 `scene.end` 的結果；單人只有節奏那一列。`foldAdult` 接進紀錄列表（dev/status.md）。
6. 夜課（成人分頁）：五個分支各自開到幾階與原因、看得到的技能（狀態：學會了／能學／階沒開／條件不夠）、體悟、學習的按鈕；共鳴的清單；被篩選關掉的不出現。
7. 設定：場景的 AI 模式（關、只有進場與收尾、每回合都問）；內容篩選補上引擎認得而畫面還沒有的幾項（對象的五種類型、NTR、契約支配、對象非自願、人偶晶片的失憶、黑帶）：每一項直接對到引擎的 `contentOff`。
8. 示意世界包：補兩三個體位（含一個三人的）、七八個夜課技能（各分支、含一個 `solo: 'ok'`、一個 `audience`）、兩筆共鳴、一個可以開三人場景的示意事件、一個「在住處獨處」的入口（開一場單人）。

## 驗收條件（`ui/tests/scene/M4-ui-scene.test.ts`；用引擎真的功能）

- 一對一的場景畫面和這一批之前一樣走得完（現有的 `ui/tests/scene` 測試不改或只改欄位的名字，改了哪些寫在回報）。
- 三個人的一圈：兩張對象卡、各自的契合；主角沒有主動權時「切換體位」灰掉、原因和引擎逐字相同；換圈之後卡片換了。
- 單人：沒有對象卡、有節奏；行動清單沒有主導與迎合；灰掉的技能有引擎的原因。
- 內海的場景套內海皮；化身多一個部位之後場景裡選得到。
- 夜課：體悟不夠的按鈕灰掉；學了之後引擎的 `actor.ext.scene.skills` 多一筆、場景裡用得出來。
- 關掉「TS 對象」之後對象是那一類的示意事件開不了場景、原因是引擎的。
- 掃原始碼：`AdultSceneScreen.vue` 沒有 `step === 0` 這類自己判斷確認框的寫法。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-scene-seats～M4-scene-close、M4-nightclass；M4-core-scene-ai 做完之後接它的三個入口。

## 完成時回報

改了哪些檔、測試結果、缺的圖示、UI 第 10 節因為引擎還沒有而沒顯示的（預期：直播的面板、觀眾）。

## 總指揮補記（2026-11-25，M4-scene-seats 回報）
- `features/scene/legacy.ts` 的外觀（`sceneOf` 回 Proxy，`turn`／`roles`／`links[].by`／`lines[].who` 是 `'pc'`／`'partner'`）在 M4-scene-circles 照留（多人時外觀的舊名字只對主角與第一個對象）。
- 這一張把介面換成第二版（`seats`、`pairs`、`circles`、`by_id`／`to_id`、`startProblems().summary`）之後，同一張把外觀拿掉：`sceneOf` 改回 `sceneRawOf`，M2-scene、M3-scene-sync 與 ui 的場景測試改讀角色 id，`smoke/m2` 改回 `structuredClone`。
