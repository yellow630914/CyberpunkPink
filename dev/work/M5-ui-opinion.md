# M5-ui-opinion

- 交給：cpp-ui（sonnet）
- 目標：輿論戰的畫面接上引擎：開戰前的準備（誰坐編輯台、帶哪些料）、棋盤、手牌、技能、對手、收買與三選一、結算；副本頁的輿論面；自己發起一場戰役的入口。舊 Demo 的規則（`lib/combat/opinion.ts` 等）整份拿掉。
- 規格出處：docs/art/UI.md 6.1 節（全部）、1.1 節（戰鬥的鍵：輿論戰的 1～5 出第幾張手牌；空白鍵結束回合）、7.4 節（副本頁）；OPINION 第 10 節、第 3～5 節（讀懂畫面上每個數字是什麼）；dev/adr/0020 第五、六、十二節（「舊示範和設計書不一樣」的表）、V31～V41；dev/work/M5-opinion.md、M5-opinion-desk.md、M5-opinion-face.md 的匯出；dev/work/M3-ui-commission-net.md（副本頁當初怎麼接內海面的）。
- 可以改的路徑：`ui/src/screens/OpinionScreen.vue`、`ui/src/screens/CommissionScreen.vue`（只加輿論面的面卡、準備與結果行）、`ui/src/lib/`（新增 `opinionView.ts`；`commissionView.ts` 只加輿論的欄位）、`ui/src/lib/keys.ts`（輿論戰的鍵照舊，接到新的入口）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/App.vue`、`router.ts`（進行中的輿論戰自動換到這一頁）、`ui/src/data/demo/`、`ui/tests/opinion/`；刪 `ui/src/lib/combat/opinion.ts`、`opinion4.test.ts`、`field.ts`、`rng.ts`（先確認沒有別的檔還在用；`combat.test.ts` 裡輿論的段落一起刪）。
- 可以用的介面：`@engine/src/features/opinion` 的 `opinionView`、`deskOptions`、`bringOptions`、`startWar`、`playCard`、`useMove`、`movesView`、`capture`、`endTurn`、`concede`、`answerBribe`、`retryWar`、`backToStage`、`acceptLoss`、`outsource`、`outsourceChance`、`faceStartPreview`；`@engine/src/features/commission` 的 `chooseBranch`（輸入的 `desk`、`bring`）與 `commissionView`；`Game.commit`／`commitNarrated`；勢力徽記的 sprite（`art/style/emblems-sprite.svg`，UI 6.1）。
- 不可以做的事：不改 `engine/`；防守、能不能佔、牌面的數字、對手做什麼、結果全部讀引擎；不在畫面裡擲任何骰子；直播的頂列是 M5-ui-live 的元件，這裡只放進來；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **開戰前的準備**（一頁或一個對話框，三種入口共用：副本頁選了輿論面的分支、頻道的「直接開戰」、主畫面「自己發起」）：議題（名字、類型、九格的分數）、對手（名字、強度、性格的一句話）、**誰坐編輯台**（從隊伍選一到兩個，每人寫編輯點）、**帶哪些料**（素材庫的每一件：會變成哪一種牌、數字、和議題的關係——全額、減半、只能當燃料、不能進——與「會扣 1 次」；不能進的灰掉並有原因）、開場會是什麼（副本的：每一個拿到的連動換成了什麼，讀 `faceStartPreview`）。副本的那一段另外有一顆「外包」（選名冊上的人、顯示機率）。自己發起：選類型與目標勢力。
2. **棋盤**：3 × 3，萬華鏡在正中央；每格寫名字、這一場的分數、是誰的（你的粉、對手的鏽橘、沒人的）、搶下來要多少聲量；可以佔的亮框、不相鄰的不能點、不能佔的原因在「?」；設防的格子一個小盾；格子的圖示用佔著它的勢力的徽記（沒人的用格子自己的）。點一格佔領。
3. **右欄**：雙方的分數、你的聲量、風向的滑標（一條，偏你那邊的一半是你的顏色）、對手的聲量、每個坐著的人的編輯點；技能（引擎給的招：名字、花費、每場或每回合剩幾次、灰掉的原因；兩個人坐著時先選誰出）；「佔領」「結束回合」（結束回合時可以勾「留幾點給反應」——有需要花點的反應時才出現）；對手的頭像、強度與它上一步做了什麼。
4. **上緣**：議題、六個（或四個）時段（現在的那一格亮著）、這回合的城市事件一行。副本裡多一排階段與這場開場帶進來的連動。
5. **手牌**：三種顏色分料、說法、手段；牌面寫效果的數字與花費；素材變的牌寫來源的標題；假料有一個只有自己看得到的記號與「d20 擲到 6 以下被拆穿」。點牌出牌（要選格子的手段再點一格）。鍵盤 1～5、空白鍵。
6. **紀錄**：每一步雙方做了什麼（讀報告的 `timeline`）。
7. **收買**：對手開價時跳一張卡（價錢、接受會怎樣：戰役算敗、公信力 −5；在委託裡另加一行「這件委託會失敗」），接受或拒絕。**找上門**：一張結果卡（擲了多少、擋住沒有、後果）。
8. **結束**：結果的四級、雙方的分數、後果的每一行（聲望、敵對值、訂閱、公信力、人氣）、帶進來的料各扣了一次的提醒。決定性的一場沒贏：三個按鈕（重來這一場、回到這個階段開始、接受結果），各一句會發生什麼。打完回發起的那一頁（副本頁或主畫面）。
9. **副本頁**：輿論面的面卡（選不了的原因讀引擎）；進行中導到這一頁；每個輿論階段的結果行（大勝、小勝、平手、敗與給了哪個連動）。
10. **示意包**：一個議題（企業醜聞）、兩個公關對手（強度 1 與強度 3 會追擊的）、一件三階段主面是輿論的委託（第一階段可以選現實或輿論）、基本牌用引擎的預設。
11. 手機版照 UI 6.1 節最後一條。

## 驗收條件（`ui/tests/opinion/M5-ui-opinion.test.ts`；用引擎真的 `opinion` 與 `media`；副本的部分用示意包那一件委託）

- 準備：`bringOptions` 說進不了的那一件是灰的、原因一樣；選兩件開戰，兩件各少一次；取消準備不扣。
- 棋盤九格的分數、擁有者、防守等於 `opinionView`；不相鄰的格子點了沒有送出任何報告。
- 出一張料：聲量等於引擎的；編輯點不夠的牌是灰的。按 1 出第一張、空白鍵結束回合。
- 結束回合之後紀錄裡有對手這一回合做的每一步（等於那一份報告的 `timeline`）。
- 收買的卡出現時別的操作都點不了；拒絕之後繼續。
- 打完六回合：結算的每一行等於結束那一份報告的變更；回到發起的那一頁。
- 副本：選輿論面 → 準備 → 開戰 → 打輸決定性的一場 → 三個按鈕都在；選「回到這個階段開始」之後副本頁停在選面。
- 掃原始碼：`ui/src/lib/combat/opinion.ts`、`field.ts`、`rng.ts`、`opinion4.test.ts` 不存在、沒有任何檔 import 它們；`OpinionScreen.vue` 沒有 `d20(`、`Math.random`、自己算防守或分數的函式。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-opinion、M5-opinion-desk、M5-opinion-face、M5-commission-opinion、M5-fixer-opinion。排在 M5-ui-live 之後。

## 完成時回報

改了哪些檔、測試結果、`opinionView` 少給了什麼、刪 `field.ts` 與 `rng.ts` 時還有誰在用、UI 6.1 節要跟著改的地方。
