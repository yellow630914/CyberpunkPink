# M3-ui-commission-net

- 交給：cpp-ui（sonnet）
- 目標：委託的四拍接上內海面：接案與踩點看得到內海的階段、召集可以替內海的輔助面派人（原本就有）、副本頁選得了內海面並進到子網、追蹤度條、隔離區的說明；示意世界包加一件主面是內海的委託與它要的蕾絲。
- 規格出處：docs/art/UI.md 7.1～7.4 節（特別是 7.4 的抬頭「追蹤度（刻度在 30、60、90）」、面卡、分支的小標）；COMMISSIONS 2.2、2.3 節；dev/adr/0018 第九節；dev/work/M3-commission-net.md、M3-fixer-net.md 的「新的格式與鍵」；dev/work/M2-ui-commission.md（現有的做法）。
- 可以改的路徑：`ui/src/screens/CommissionScreen.vue`、`ui/src/components/commission/`、`ui/src/components/StageTrack.vue`、`ui/src/lib/commissionView.ts`、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（`commission.ts` 加內海的類型與一件寫好的副本；`net.ts` 加蕾絲、子網的區與設施）、`ui/tests/commission/`。
- 可以用的介面：`@engine/src/features/commission` 的 `commissionView`（多了 `trace` 與每個面的 `locked`）、選面與選分支；`@engine/src/features/fixer`（簡報的 `main`、要有甲板的提醒、`scoutView`）；`@engine/src/features/netrun` 的 `netrunView`（只用來知道「這一段開起來了」）；M3-ui-subnet 的子網頁。
- 不可以做的事：不改 `engine/`；這一面選不選得了、為什麼不行照引擎回的原因顯示；不自己判斷隔離區；輿論面照舊是引擎說的「還沒有開放」；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. **副本頁**：抬頭加追蹤度條（這件委託有內海的階段才顯示；刻度 30、60、90）。面卡：內海面選得了（引擎有人登記 `face.net`）；隔離區鎖著時變淡並寫引擎的原因。分支列在選了內海面之後，照現有的畫法（強攻、潛行、連動開出來的路）。
2. **進入這一段**：選了分支之後引擎開了 `face.net`，畫面換到子網頁（`App.vue` 照進行中的活動換，不照按鈕）；那一段結束回到副本頁，階段軌往前一格，連動列出來。交回撤退或被定位時照引擎的結果顯示（回到召集頁；委託失敗的訊息）。
3. **里程碑之後的那一行**：內海的階段寫離開時的追蹤度與拿到的東西（引擎那份報告的資料）。
4. **接案與踩點**：簡報標主面是內海（「這是一件要潛進去的委託」）與「要有甲板」的提醒（引擎給的）；踩點的未知清單把內海的階段照面標色。
5. **示意世界包**：加一種主面是內海的類型（竊密，三個階段）與一件寫好的四階段副本（照 COMMISSIONS 第 11 節的樣本：前兩階段可選現實與內海、第三階段現實插資料埠、第四階段內海下載）；目標勢力的四種蕾絲（白、粉雜兵、粉精英、閘門守衛）、子網的區與一種設施類型放 `net.ts`。地圖沿用示意包已經有的。

## 驗收條件（`ui/tests/commission/M3-ui-commission-net.test.ts`；用引擎真的 `commission`、`fixer`、`netrun`、`netcombat`、`deck`、`enemies`，資料用測試自帶的最小一件）

- 副本頁：有內海階段的委託顯示追蹤度條、值等於 `commissionView().trace.value`；純現實的委託不顯示。
- 選內海面、選強攻：畫面到了子網頁；在子網裡通過閘門之後回到副本頁、階段軌往前一格、城裡的時間多 2 小時。
- 隔離區：第四階段在沒拿到連動時內海面是變淡的、原因和引擎的句子逐字相同；第三階段做完之後選得了。
- 在子網裡登出並確認：回到召集頁、時間與錢回到出發之前、紀錄裡那一段標成被收回。
- 沒有登記 `face.net` 的一局（測試把那個功能拿掉）：內海面照舊顯示「這一面還沒有開放。」。
- 示意世界包載得進來（`ui/src/data/demo/demo.test.ts` 加一條）：那件內海的委託從接案走到做完（測試用程式自動走，戰鬥用自動打）。
- 現有的委託介面測試原樣全過；`npm test` 與 `vue-tsc` 全過。

## 依賴

M3-commission-net、M3-fixer-net、M3-ui-subnet、M3-ui-netcombat、M3-ui-deck（示意包的 `net.ts`）。

## 完成時回報

改了哪些檔、測試結果、UI 7.4 節裡內海相關、因為引擎還沒有而沒顯示的東西。
