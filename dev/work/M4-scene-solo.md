# M4-scene-solo

- 交給：cpp-feature（sonnet）
- 目標：成人場景的單人模式：沒有對象的一場（住處紓解、之後的成人時段直播與拍親密素材、流竄 AI 的夢裡只有自己的那種），同一個活動 `scene`、同一套行動點、感載、餘韻與換檔。
- 規格出處：設計書還沒有這一節（使用者 2026-11-24 定進 M4，dev/status.md「待 M4：成人場景的單人模式」的草稿）；以 dev/adr/0019 第九節「單人」、第十六節的表、P38～P40 為準；其餘照 LEWD_SYSTEM 3.5 節（行動點、感載與餘韻、換檔、結束）。
- 可以改的路徑：`engine/src/features/scene/`、`engine/tests/features/M4-scene-solo.test.ts`。
- 可以用的介面：M4-scene-seats 的第二版狀態（`kind: 'solo'`、`pace`）、技能與道具 `scene` 欄位的 `solo`；現有的感載、高潮、換檔、結束與結算。
- 不可以做的事：不做直播、彈幕、素材（M5；這一張只留 `audience` 這個開關與結果裡的記號）；兩個人以上的場景行為不變；不寫任何露骨的文字（每一步只有一句中性的描述）；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `SceneSetup`：`solo: true`（沒有 `with`、`circles`）；`nature` 多一個值 `solo`；`goal` 只收 `footage`（拿素材）或沒有；`audience?: boolean`（有沒有人在看：直播開著；M5 之前沒有人會給 true）。
- 狀態：`kind: 'solo'`、`seats` 只有主角、`pairs` 是空的、`pace`（節奏，0～100，起始照 `fit_start`）、沒有體位（`position` 是空字串）、連接的兩端都是主角。
- 行動：`faster`（加快）、`slower`（放慢）取代主導與迎合；其餘沿用 `tease`、`restrain`、`skill`、`item`、`talk`、`gear`、`stop`、`end_turn`。沒有 `switch`。
- 技能與道具的 `solo`：`ok`、`audience`、`no`。沒寫時：道具 `ok`；技能 `no`。
- 規則 `scene_rule` 多 `solo`：`{ faster: { load: 2, pace: 2 }, slower: { load: 1, pace: 8 }, tease: { load: 1, pace: 4 }, insight_mult: 0.5 }`（`load` 是幾顆 d6）。
- `actor.ext.sex_record` 多一欄 `solo_times`。`scene.end` 的 `result`：`solo: true`、`pace`、`rating`、`audience`、`goal_done`。

## 要做的

1. 開場：`solo: true` 時不需要對象與體位（不另外加篩選的標籤；設定的 `tags` 裡被關掉的照舊不算）。沒有橋的人照舊固定標準檔。
2. 行動（P38）：
   - 加快：2 行動點，自己感載 +2d6，節奏 +2。放慢：2 行動點，自己 +1d6，節奏 +8。挑逗：1 行動點，自己 +1d6、節奏 +4、下一個行動多 1 顆骰。克制：照舊。
   - 技能與道具：只有 `solo` 是 `ok`，或是 `audience` 而且這一場 `audience` 是 true 的才用得出來；其餘灰掉，原因分兩種（「這個要有對象。」「這個要有人在看。」）。建立的連接是「自己的部位接自己的部位」：用出與每回合的數值裡，原本給對方的感載算在自己身上、原本給自己的那一份不算、契合算成節奏。部位照樣一個只能有一條（`double` 的例外照舊）。
   - 說話：`audience` 是 true 才行（對觀眾說；判定照現有的檢定，契合的變化算成節奏）；否則灰掉（「沒有人在聽。」）。
   - 換檔、停下、結束回合照舊。受到的感載照常乘敏感度、餘韻與檔位。
3. 回合：主角行動完就是連接的自動效果與下一回合（沒有別人的步）。強制結束只有兩種：主角餘韻疊滿之後又高潮、被打斷（含 `max_rounds`）。
4. 結算：評價用同一張表（看節奏）；體悟＝那一級的體悟 × `insight_mult`（第一次碰某個標籤照加；沒有「第一次和這個人」「第一次的體位」）；不改任何人的親密度；橋參數那一點照評價的機率；傾向照碰到的標籤；性經歷只加 `solo_times`；沉溺的規則退路是 0；餘韻帶著走；`goal: 'footage'` 時節奏到 `goal_done_at` 算達成，`result.goal_done` 記下（素材本身 M5 給）。
5. 略過：節奏＝略過公式的基底加亂數那兩項（沒有對象的那幾項不算），體悟再打七折。
6. `sceneView`：`kind: 'solo'` 時沒有 `partner`、`pairs` 是空的、有 `pace`；`sceneOptions` 的行動清單換成上面那一組，灰掉的帶原因。

## 驗收條件（`engine/tests/features/M4-scene-solo.test.ts`；測試自帶三個技能（`solo` 各是 `ok`、`audience`、沒寫）、一個建立連接的道具、一種藥）

- `solo: true` 開得起來，`seats` 一個人、沒有體位；同時給 `with` 被擋。
- 加快與放慢各花 2 點、感載與節奏照表（固定骰子）；沒有 `switch`、沒有主動權的任何欄位；送 `dominate` 被擋並有原因。
- `ok` 的技能建立一條自己接自己的連接，下一回合自動生效在自己身上、節奏有加；沒寫 `solo` 的技能灰掉是「這個要有對象。」；`audience` 的在沒有觀眾時灰掉、`audience: true` 的場景用得出來；說話同理。
- 道具的連接可以用；藥照樣用。
- 餘韻疊滿之後又高潮：場景結束、原因是失神。按停下：評價照節奏、體悟是那一級的一半、主角對任何人的親密度沒有變、`solo_times` +1、性經歷的次數與對象人數沒變、沉溺沒變。
- 換檔照舊（深檔的感載倍率生效）。
- `goal: 'footage'`、節奏 70：`result.goal_done` 是 true。
- 一對一與多人的測試不改全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-scene-circles 之後（同一個資料夾）。

## 完成時回報

改了哪些檔、測試結果、做的時候覺得不順的規則（單人的規則是架構先定的，沒有設計書；例如高潮要不要影響節奏、要不要有「對方不玩了」的對應），列出來給使用者看。
