# M5-idol

- 交給：cpp-feature（sonnet）
- 目標：新功能 `idol`：人氣（每個人一條的量表）怎麼漲怎麼掉；親衛隊（人氣的四個門檻、每週可以動用幾次、做過頭）；握手會（公演那一集的加開）；輿論戰的開場與一次不花點的水軍。
- 規格出處：MEDIA 第 9 節（9.2、9.3、9.4 的「唱出來」、9.5）、4.3a 節（公演與握手會）、第 10 節（人氣那一列）；OPINION 第 2、6 節（偶像的人氣與親衛隊在戰役層變成什麼）；SKILL_TREES 偶像的「預備與日常」（握握手、唱出來）；CORE_RULES 第 8 節（人氣）；dev/adr/0020 第八節、第十三節、V42、V43；dev/work/M5-channel-shows.md（`channel.episode`）、M5-opinion-desk.md（`opinion.open`、`opinion.passives`）。
- 可以改的路徑：`engine/src/features/idol/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-idol.test.ts`。
- 可以用的介面：`k.meters.define`；掛點 `channel.episode`、`opinion.open`、`opinion.passives`、`media.spend`（直接掛或問，不 import）；掛鉤 `activity.end`（`live`、`opinion`、`face.opinion`）、`time.passed`（順序 11）、`game.new`；`actor.ext.paths`（只認格式）；條件 `ability`（0019 的；有人註冊才用，沒有就看 `actor.ext.paths` 有沒有偶像的路數）；效果 `load`、`hostility`、`cash`、`subs`、`credibility`（先問有沒有人註冊）；`k.effects.register`、`k.conditions.register`；報告的 `triggers`；核心的檢定與固定亂數。
- 不可以做的事：不 import 別的功能；親衛隊不進現實戰鬥的公式（MEDIA 9.3）；聲援、動員、召集、公演、巨蛋是技能，不在這裡重做一次（V42）；簽約與畢業、隊長、和別的親衛隊競爭、握手會的事件內容都不寫；出征（派工）由 M5-away 來加；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 量表 `popularity`（照人、0～100、起始 0、AI ±3）。「這個人是偶像」＝他的路數有偶像 1 階以上；不是偶像的人人氣不會自己動（效果照樣收）。
- 狀態 `state.ext.idol`：`{ guard: Record<角色 id, { used: number（這一週動用了幾次）, went_too_far: number }>, week: Record<角色 id, { shown: boolean }> }`。
- 內容種類 `idol_rule`（`overridable`，id `default`）：四個門檻（20、40、60、80）、每週動用次數（等於級數）、做過頭的骰（1～2；人氣 60 以上而且這一週沒露面是 1～3）、握手會（人氣 +2、打賞 ×1.5、感載 +5、多一個時段）、漲跌的暫定表（V43）、不花點的水軍拆穿的門檻（3）。
- 條件：`guard_tier { who?, min?, max? }`（0～4 級）；量表自動有的 `popularity`。
- 效果：`guard_use { who?, what }`（事件與內容用：動用一次，會擲做過頭）。
- 報告：`idol.guard`（動用：打聽、帶話）、`idol.weekly`（kind `downtime`）、`idol.sing`（唱出來）。
- 匯出：`idolView(k, state, who?)`（人氣、親衛隊的級與樣子、這一週還能動用幾次、能叫他們做什麼與灰掉的原因）、`guardTier`、`useGuard`、`singOut`、`singBlock`。

## 要做的

1. **親衛隊的級**：人氣 20、40、60、80 是 1～4 級。每週可以動用的次數 = 級數，週一歸零。
2. **動用**（`useGuard`；`what` 是 `ask` 打聽、`errand` 帶話排隊）：扣一次；`ask` 的結果是一則線索的效果或這一區的一則傳聞（有人註冊對應的效果才給；沒有就只有一句話）；每次動用擲做過頭：中了，`went_too_far` +1、報告帶觸發點 `guard_trouble`（`where`：誰的親衛隊、在哪一區），並照規則給那一區第一個勢力敵對值 +1。
3. **握手會**（回答 `channel.episode`）：節目是公演、上鏡的人是偶像時回一個選項 `handshake`（握握手這個技能裝著時數字照 SKILL_TREES：收入 +50%、人氣多 +1、承受的感載 −30%）；選了的那一集：多一個時段、人氣 +2、打賞 ×1.5、上鏡的人感載 +5、報告的觸發點多一個 `handshake`。打賞的倍率用 `on_grade` 表達不了時，回報並先只給固定的一筆。
4. **人氣的漲跌**（V43）：直播收播（`activity.end` 的 `live`）熱度 10 以上、開播的人是偶像：+1；輿論戰結算時你佔著同人圈或應援圈（opinion 已經用效果給，這裡不重複）；公演的 +1／+3／+6／−2 是節目資料的 `on_grade`（channel 給，這裡不重複）；每週（週一）這個偶像這一週沒有開過公演、節目或直播（聽到 `live` 的 `activity.end`、或 `channel.episode` 被問到而且他上鏡，就記 `shown`）：−1。
5. **輿論戰**：回答 `opinion.open`——坐編輯台的人裡有偶像而且親衛隊 2 級以上：開場佔應援圈（那一格沒人時）、風向 +1；回答 `opinion.passives`——1 級以上：`free_army`（每場一次不花點的水軍，拆穿的門檻 3；用了扣這一週的動用次數一次，沒有次數就不給）。
6. **唱出來**（MEDIA 9.4；要裝著「唱出來」這個技能、旗標 `idol_signed` 不是真的）：花一個時段與一支片（`media.spend`，`how: 'sing'`）；結果等同一次直接上架，但把公信力的那一項換成人氣（訂閱照算；公信力不動）；唱過的片不再是獨家（media 那一邊在 `how: 'sing'` 時自己標；沒有做的話回報）。上架的算式在 media：這一張拿 `Material` 的看點自己照 `idol_rule` 的一張小表算（訂閱 +看點 × 0.5%、人氣 +看點 ÷ 2 進位，最多 +3），不呼叫 media 的入口。

## 驗收條件（`engine/tests/features/M5-idol.test.ts`；測試自帶一位偶像路數的角色、替身問三個掛點、玩具的 `activity.end`）

- 人氣 19、20、40、60、80 的級數是 0～4；每週次數等於級數、用完被擋（原因的句子對）、週一歸零。
- 做過頭：固定骰子 2 中、3 不中；人氣 60 以上而且這一週沒露面時 3 也中；中了敵對值 +1、帶 `guard_trouble`。
- `channel.episode`：公演而且偶像上鏡才有握手會的選項；選了的回答帶多一個時段與人氣、感載的效果；不是偶像不回。
- 直播收播熱度 10：人氣 +1；熱度 9 不加；開播的不是偶像不加。
- 每週：沒露面 −1；露過面不扣；人氣不低於 0。
- `opinion.open`：2 級以上回「佔應援圈、風向 +1」，1 級不回；`opinion.passives`：1 級以上回 `free_army`，這一週沒有次數時不回。
- 唱出來：沒裝技能、`idol_signed` 是真的、沒有片，各被擋並有原因；成功的那一份片少一次、人氣與訂閱照表、公信力不變。
- AI 的來源給 `popularity +9` 夾到 +3。
- 把 `channel`、`opinion`、`media` 都拿掉：人氣與親衛隊的動用照樣跑。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-channel-shows、M5-opinion-desk（掛點）。和 M5-skill-opinion-b 可以同時做。

## 完成時回報

改了哪些檔、測試結果、握手會的打賞倍率做不做得到、V42、V43 對不上的地方、MEDIA 9.3 表裡沒做的（聲援、動員、出征各自由誰做：技能、技能、M5-away）。
