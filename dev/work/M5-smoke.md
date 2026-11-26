# M5-smoke

- 交給：cpp-architect 角色（sonnet；**改的是核心的測試基礎建設**，可以改 `engine/src/testkit/`、`engine/tests/smoke/`、`engine/tests/replay/` 或現有種子重播的位置、dev/test-harness.md、dev/invariants.md）
- 目標：M5 的收尾第一步：具名的情境（testkit）、冒煙主幹、種子重播、分層檢查、test-harness 與不變式對一次。斷掉的地方寫 bug 報告，不在這一張修功能。
- 規格出處：dev/test-harness.md（第 1 節狀態工廠與具名的情境、第 4 節種子重播、第 6 節冒煙）；dev/invariants.md；dev/adr/0020（全部，特別是第十三節的接縫與「後果」）；dev/work/M5-plan.md 的「審查與測試的重點」；dev/work/M3-smoke.md（上一批的做法與檔案的位置）。
- 可以改的路徑：`engine/src/testkit/`（新增 `scenariosMedia.ts`、`worldMedia.ts`、`opinionPlay.ts`，`index.ts` 匯出）、`engine/tests/smoke/m5.test.ts`（第二波另一個檔 `m5-home.test.ts`）、種子重播的測試與它的固定檔、dev/test-harness.md、dev/invariants.md、dev/bugs/（斷掉的）。
- 可以用的介面：全部功能的 kernel（`FEATURES`）、`makeGame`、`makeBattleGame`、`playOut`、`fixDice`、M3 的 `netPlay`；M4-smoke 加的：`worldBody.ts`（`bodyWorld()`）、`scenariosBody.ts`（`makeBodyGame`）、`scenePlay.ts`、`curtainPlay.ts`（`playCurtainRun`、`playNetSmart`）、`saveCheck.ts`（`roundTrip`）、`wearDeck`、`M4_ACTION_PREFIXES`、`M4_STEPS` 與重播的 `type: 'm4'`；每個功能匯出的入口；假的服務商。
- 不可以做的事：不改 `engine/src/features/`、`engine/src/core/`（testkit 以外）；不為了讓冒煙過而改斷言——斷了就寫 bug 報告（dev/bugs/<日期>-<id>.md，照 project.md 的格式，附重現的種子）並把那一段標成 `it.fails` 留著；不匯入內容（情境自帶最小的世界）；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **具名的情境**（testkit；每一個是一個回傳 `Game` 的工廠，自帶最小的假資料）：
   - `MEDIA_SETUPS.recorder`：主角裝著一隻能錄影的義眼（世界裡加一張 `effects: [{ stat: 'rec_grade', amount: 3 }]` 的義體設計圖，照 `makeBodyGame` 裝義體的寫法；錄影只認義體）、有一處住處、開了頻道（訂閱 1,200、公信力 55）、隊上一位主播路數 2 階的夥伴。
   - `MEDIA_SETUPS.library`：上面那個加素材庫裡五段素材（六種類型裡的五種、品質 1～5、次數 3、2、1、0 各有）與兩支片（揭弊、煽情）。
   - `MEDIA_SETUPS.idol`：一位偶像路數 3 階的夥伴、人氣 45、一個帶舞台的設施。
   - `OPINION_SETUPS.basic`（一個議題、強度 2 的對手、基本牌）、`.hard`（強度 3 會追擊、會收買、會找上門）、`.commission`（一件三階段主面是輿論的委託，第一階段可以選現實或輿論）。
   - 第二波：`HOME_SETUPS.furnished`（二級的家、六件家具、一位留宿的名冊成員）、`.shop`（三級、開著酒吧、名冊上的人當店長）、`AWAY_SETUPS.out`（兩個人派出去、週日晚上）。
   - `opinionPlay(game, policy)`：照一個簡單的策略把一場輿論戰打完（出得起的牌都出、能佔就佔分數最高的），給冒煙與重播用。
2. **冒煙主幹**（`m5.test.ts`；固定種子、AI 關閉；一條一個 `it`，前一條的結尾是下一條的開頭）：
   - 打一場小戰鬥 → 多一則有錄到的紀錄 → 轉成素材 → 剪成片 → 片與來源的次數對。
   - 用那支片開一集雜談 → 評價與訂閱變了 → 片少一次；用素材發一篇文 → 追蹤變了 → 素材少一次；直接上架一次。
   - 開一場時段直播（閒聊、2 小時）→ 時間過了、收播有訂閱與打賞、多一則紀錄。
   - 在一場戰鬥上開活動直播 → 打贏收播；再一場：開播之後撤退（回到快照）→ 直播的結算留著、只算一次。
   - 自己發起一場輿論戰（帶兩件料）→ 打完 → 聲望與敵對值、訂閱變了。
   - 接一件主面是輿論的委託 → 第一階段選輿論（短戰）→ 第二階段現實 → 最後一階段輿論（贏）→ 入帳。同一件委託另一條：最後一階段打輸 → 三選一各走一次（重來、回到階段開始、接受＝失敗回到入口）。
   - 過一個週一：頻道的每週、社群的每週、帳單都結了一次，互不重複。
   - 第二波（`m5-home.test.ts`）：回家 → 擺一張床 → 睡一覺拿到舒適度的狀況 → 存東西進箱子 → 出門；派一個人去打工 → 過週一 → 收入在帳單裡、他回來了；升到三級開店 → 過週一有營收。
   - 第二波另外兩條：主角持約一個人（M4-smoke 的持約人情境）→ 把他的住處設成據點 → 家裡的住戶有他 → 派他去打工 → 過週一照契約分帳；擺一張工作台 → 在家組裝得了、難度少 1（M5-home-links）。
   - 第三波做了的話：迷宮館一趟開播；簾後館一趟開內場直播（`playCurtainRun`；街上的簾口與潛入裡的簾口各一次）→ 館方的打賞加倍、拿到內場帶、頻道的訂閱沒變；成人時段直播開一場單人場景再收播；過一個週一檔期榜結一次；AI 開著（假的服務商）跑一次時段直播的判讀與素材的標題。
3. **拿掉一個功能**：八個新功能各拿掉一次建 kernel、跑一段不涉及它的主幹，確認沒有丟錯（0020「後果」第一條）。另外把 `contract`、`curtain`、`scene` 各拿掉一次：`away`、`home`、`live` 照樣跑（掛點沒有人答、條件沒有人註冊都當沒有）。
   - **白名單**（`engine/tests/smoke/m5-whitelist.test.ts`，照 `m4-whitelist.test.ts` 的寫法）：時段直播、輿論戰、`face.opinion`、等著三選一時各自放行的 doing 列成預期的清單。M4 的 `allowEverywhere`（`commit:contract.choose`、M5 的 `commit:live.`）是每一種活動都有的，列在共同的那一段，不算哪一個活動「多放行」。
4. **種子重播**：把上面的主幹（第一波的那一條）錄成一份固定檔，重播逐份報告相同；打到一半存檔讀回來（輿論戰進行中、直播進行中、等著三選一時各一次）接著跑，結果和沒有中斷的一樣。
5. **分層檢查**：新功能之間沒有互相 import；`features/` 沒有 import `shell/`；`ui/` 的引擎入口只經由 `@engine/src`。把第十三節掛點表上的每一個掛點名字對一次程式（宣告的那一方有 `declare module`、回答的那一方沒有 import 宣告的那一方）。
6. **dev/test-harness.md**：第 1 節補新的情境與 `opinionPlay`；第 6 節補 M5 的冒煙清單。**dev/invariants.md**：新增一節「媒體、直播、輿論戰、家園（dev/adr/0020）」，至少這幾條並標出哪個測試在驗：
   - 一段素材與它剪出的片，各種用法合計不超過設計書允許的次數；0 次的不能用；用掉與那件事的結果在同一份報告。
   - 發文與動態牆不改街頭信譽、公信力、敵對值；M5 的任何入口都不給街頭信譽。
   - 直播的結算不因回到快照而消失，也不重複。
   - 直播進行中不能回退步數。
   - 熱度：時段直播 0～12；觀看數是基本盤與熱度的函式、不存。
   - 輿論戰：聲量 0～10、風向 −5～+5、防守最少 0、編輯點不累積、佔領要相鄰（除非效果放行）、一方清空立刻結束。
   - `face.opinion` 交回之後副本只處理一次；決定性的沒贏一定先經過三選一（收買與被帶走例外）。
   - 預算付不出來是做不成，不會是負的；公帳超領的代價照額度。
   - 家具只壓在地板上、不擋門、放下之後每格地板都走得到；`furniture` 格只出現在實例的補丁裡。
   - 住處換主人之後 `at_home { level_min }` 的行為不變。
   - 派出去的人身上有 `busy`，結算之後一定拿掉。
   - 義體、藥、裝備給的編輯點合計最多 +1（`ep_bonus` 經核心的 `regenTotal`）；技能與編制給的不限。
   - 內場直播不進頻道（訂閱、公信力、「這一週開過」都不動）；館方的打賞只加倍一次。
   - 單人場景「有沒有人在看」＝開場給的或直播開著；沒有裝 `live` 時行為和 M4 相同。
   - 契約人的住戶只從掛點來，`home` 的狀態裡沒有他們；解約或改住處之後下一次問就不在了。

## M4 對帳（2026-11-26）

- **具名的情境建在 M4 的假世界上**：全部功能的局裡甲板是腦部的義體（要「一開始就有甲板」用 `wearDeck`）、主角有橋與一整套 M4 的身體；`MEDIA_SETUPS`、`OPINION_SETUPS`、`HOME_SETUPS` 用 `makeBodyGame`（或同一個做法）起，不要回到 M3 以前只有幾個功能的局。
- **testkit 自己的 import**：`scenarios.ts`、`steps.ts` 現在從 `features/rest` 拿 `rentDraft`；M5-home-base 會把那兩行換成 `features/home`（派工時放行的）。這一張開工時確認一次，沒換到的補上。
- **簾後館的冒煙**沿用 M4-smoke 的三個決定：規則表每一幕改成一場遭遇、種子挑走得完的（M4 用種子 3）、內海的戰鬥用 `playNetSmart`。
- **中途存讀**用 `roundTrip`：多加直播掛在簾後館一趟上、成人時段直播的場景進行中各一次。
- M4 的 `m4-whitelist.test.ts` 把「`maze` 的清單在簾後館一趟裡也放行」記成預期的；M5 的白名單不要重複驗它。

## 驗收條件

- `engine/tests/smoke/m5.test.ts` 的每一條過，或是有對應的 bug 報告並標成 `it.fails`（報告的 id 寫在測試的名字裡）。M4 的冒煙（`m4-*.test.ts`）在 `home` 接手住處之後原樣全過。
- 報告的前綴：testkit 加 `M5_ACTION_PREFIXES`（M4 的清單加 `media`、`channel`、`live`、`social`、`opinion`、`idol`、`away`、`shop`、`text`），主幹跑完 `prefixProblems` 是空的；重播加 `M5_STEPS` 與 `type: 'm5'`。
- 種子重播與三種中途存檔都過。
- 八個功能各拿掉一次都建得起來。
- 分層檢查全過；掛點表對完（對不上的列在回報）。
- dev/test-harness.md、dev/invariants.md 更新了；不變式每一條都指到一個存在的測試。
- `npm test`、`npx tsc --noEmit` 全過（`it.fails` 的除外）。

## 完成時回報

冒煙哪幾條過、哪幾條斷（各自的 bug 報告）、存檔在主幹跑完之後多大（紀錄的索引與素材庫佔多少；0020「後果」那一條要的數字）、掛點表與程式對不上的地方、給審查與白箱、邊界、探針的建議重點（接在 M5-plan 的清單後面）。
