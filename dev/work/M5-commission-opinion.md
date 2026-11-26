# M5-commission-opinion

- 交給：cpp-feature（sonnet）
- 目標：委託副本的輿論面，副本這一邊：開 `face.opinion` 時給什麼、交回來收什麼、決定性與否、收買與被帶走、輿論面的資料檢查；另外補兩個給別的功能讀的資料慣例（進副本與里程碑那一拍的 `data`）與「直播中不能走潛行」。
- 規格出處：COMMISSIONS 2.1、2.3 節、第 3、4、5 節、6.4 節（輿論面沒有壓力條）、7.1 節（主面是輿論的四型）、第 8 節、第 11 節（`stream_goals`、`opinion_opening`）；DATA 9.1 節；COMMISSION_TEMPLATES「opinion_setup 的骨架」；OPINION 第 6 節；MEDIA 1.2 節（副本直播的風險與目標）；dev/adr/0020 第六節、第十三節（資料慣例）、V36～V38；dev/work/M5-opinion-face.md（`setup` 與 `activity.end` 的 `result`）、M3-commission-net.md（內海面當初怎麼接的，照同一個做法）。
- 可以改的路徑：`engine/src/features/commission/`、`engine/tests/features/M5-commission-opinion.test.ts`（既有的 `M2-commission-*`、`M3-commission-net` 測試只在行為真的改了的地方改，並在回報裡列出）。
- 可以用的介面：現有的 `faceLaunch`、`activity.end` 的處理、`Run`、`LinkDef`、里程碑與失敗的流程（`close.ts` 的 `onDefeatAccepted`、`netEnd` 是範本）；條件 `live_on`（先看 `k.conditions.kinds()`）；量表 `alert`、效果 `hostility`、`favor`。
- 不可以做的事：不 import `features/opinion`、`features/live`、`features/media`；不在副本裡寫任何棋盤的規則；不改現實面與內海面的行為；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `CommissionEntry.opinion_setup?`：DATA 9.1 的整塊（`topic`、`opponent`、`base`、`from_links`）；`from_flags`、`cells_by_flag`、`opponent.named`、`topic.category` 只收格式、原樣帶過去。
- `CommissionEntry.stream_goals?: string[]`（COMMISSIONS 第 11 節）。
- 輿論面的資料（`FaceDef`，都選填）：`rounds`、`opponent`（蓋掉 `opinion_setup.opponent` 的欄位）、`gives`（小勝以上才給）、分支的 `open: { voice?, wind?, cells? }`。輿論面的分支種類只有 `assault`、`talk`、`linked`、`scouted`（寫 `stealth` 在檢查時擋下）。
- 副本的 `links` 可以有三個保留的鍵：`op_major`、`op_minor`、`op_lost`（一般的 `LinkDef`）。
- `commission_rule` 多（和 `DEFAULT_NET_RULES` 一樣另放一組 `DEFAULT_OPINION_RULES`，資料檔由 M5-data-rules 補）：輿論階段打輸的警戒（+10）與敵對值（+3）、收買的委託人好感（−5，opinion 那一邊已經扣，這裡不重複，只留欄位給評價）。
- `Run` 多：`opinion: Array<{ stage, outcome, you, foe }>`（每一場輿論階段的結果；評價與後果用）。
- 報告的一拍（資料慣例）：`commission.enter` 那一份加一拍 `tag: 'commission.enter'`、`data: { id, grade, faction, stream_goals }`；里程碑那一份加一拍 `tag: 'commission.milestone'`、`data: { id, stage, face, faction, grade, record? }`（`record` 是那個階段的資料寫的 `record`，給紀錄用的類型與涉及的人）。
- `chooseBranch` 的輸入多 `desk?`、`bring?`（選了輿論面時原樣放進 `setup`）。

## 要做的

1. **開這一段**：`faceLaunch` 對輿論面多給 `opinion`（副本的 `opinion_setup` 蓋上這一面的 `rounds`、`opponent`；一樣東西都沒有時整步不成立，原因：「這件委託沒有寫輿論戰的設定。」——資料檢查先擋，這裡是保險）、`route`、`decisive`、`where`、`employer`、分支的 `open`、`desk`、`bring`。同一個副本有兩場輿論戰時，前一場的結果（`op_major`、`op_minor`、`op_lost`）已經在 `links` 裡，後一場的 `from_links` 自然讀得到。
2. **交回**（`activity.end`，`kind === 'face.opinion'`；照 `netEnd` 的寫法另開一個 `opinionEnd`）：
   - 記進 `Run.opinion`。
   - 不是最後一個階段（V38）：`major` 給 `op_major`（副本有寫才給）與這一面的 `gives`；`minor` 給 `op_minor` 與 `gives`；`draw` 什麼都不給；`lost` 給 `op_lost`（有寫才給）、警戒 +10、目標勢力敵對值 +3。四種都把這個階段標成做完，接里程碑。
   - 最後一個階段：`major`、`minor` 標成做完（接里程碑與 `finish`）；`lost`（opinion 已經處理過三選一，交回來的就是被接受的）照「戰敗被接受而且算失敗」的同一條路：留失敗的記號、回到入口。`result.captured` 是 `true` 時，先開戰敗事件（副本自訂的 `defeat_event`，沒有就是目標勢力預設的）再走那條路——做法照現有戰敗的流程，做不到就回報、先只回到入口。
3. **評價與後果**：有階段走了輿論而且贏了，算一個「交涉成功的階段」那樣 +1（G16 的寫法）；路線的後果加一條「有階段走了輿論：一個公開的敵人」——目標勢力敵對值照規則另加（預設 +3，一件委託一次）。`commissionView` 多每一場輿論階段的結果。
4. **資料檢查**：有任何一個階段開了輿論面而副本沒有 `opinion_setup`（或它缺 `topic`、`opponent`）就不收；主面是輿論的委託最後一個階段只有輿論面；輿論面的分支種類；`from_links` 指到的連動要存在於 `links` 或是那三個保留的鍵；`stream_goals` 是字串的陣列。
5. **資料慣例的兩拍**：照上面的格式加；既有的 `toEqual` 測試會因為多一拍而要改，改的地方列在回報裡。
6. **直播中不能走潛行**：分支是 `stealth` 而且條件 `live_on` 有人註冊並且成立時，那條分支選不了，原因：「正在直播，沒辦法悄悄進去。」
7. 輔助面照舊（輿論面的輔助只是一次擲骰，拿到的是這一面的 `gives`；失敗不加壓力）。

## 驗收條件（`engine/tests/features/M5-commission-opinion.test.ts`；用玩具活動登記成 `face.opinion`，照 M5-opinion-face 的格式發 `activity.end`；自帶一件三階段、主面是輿論的委託與一件第一階段可以選輿論的現實委託）

- 沒有人登記 `face.opinion` 時輿論面照舊選不了；登記之後選得了。
- 開這一段時玩具活動收到的 `setup` 有 `opinion`（面的 `rounds` 蓋掉了副本的）、`route`、`decisive`、`links`、分支的 `open`、`desk`、`bring`。
- 非決定性的四種結果：`links` 多了哪些、警戒與敵對值各對；四種都進了下一個階段；階段只結算一次（交回兩次同樣的 `activity.end` 不會多給）。
- 兩場輿論戰：第一場大勝之後，第二場收到的 `links` 有 `op_major`。
- 決定性：`minor` 之後委託做完入帳；`lost` 之後回到入口、留失敗的記號、發一次 `commission.failed`；`lost` 帶 `bribed` 也一樣（錢是 opinion 的事，這裡只看流程走完）。
- 進副本的那一份有 `commission.enter` 那一拍、`data.stream_goals` 對；里程碑那一份有 `commission.milestone` 那一拍、`face` 與 `stage` 對。
- `live_on` 的替身成立：潛行分支灰掉、原因對；不成立或沒有人註冊：照舊。
- 資料檢查的每一條各一個壞例子。
- 評價：輿論階段贏了 +1；後果有「公開的敵人」那一筆。
- M2、M3 的副本測試全過（改了的地方列出來，只能是「多了一拍」這一類）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-opinion-face（`setup` 與 `result` 的格式定了）。做的時候不要有別的工單在改 `features/commission`。

## M4 對帳（2026-11-26）

- M4 沒有改這一張要照著寫的三個地方，名字都在：`features/commission/run.ts` 的 `faceLaunch`、`close.ts` 的 `netEnd` 與 `onDefeatAccepted`、`model.ts` 的 `DEFAULT_NET_RULES`、`commissionProblems`。`setup.employer` 已經在給（生成的委託 M4 之後也有委託人）。
- 內海面開始時 M4 多發一個觸發點 `login`（`features/netrun/common.ts`）；輿論面不發。
- 主角是契約人時，契約的指令期限在副本裡暫停（`contract.pause`）是 contract 自己聽 `time.passed` 做的，這一張不用管；它的報告前綴是 `contract.`，不要被「同一個階段不處理兩遍」的測試誤認成副本的報告。
- `fixer.reward`（M4 的報酬附加項）是 fixer 與 unreg 之間的事，結算流程沒有因此改。

## 完成時回報

改了哪些檔、測試結果、改了哪些既有測試與為什麼、被帶走（`captured`）接不接得上戰敗事件、M3 留下的權宜（`defeat_event`、`employer` 放 `setup` 不放 `origin.ext` 等）這一張有沒有順手動到。

## live 留下的（2026-11-26）
- `commission.enter` 要帶那一拍的 `id`、`grade`、`faction`、`stream_goals`（副本直播的目標、等級、勢力讀它；現在真的副本沒帶）。
- V26：副本直播期間每個階段的紀錄不算獨家——media 在 `commission.milestone` 記那一則時問 `live_on`。
