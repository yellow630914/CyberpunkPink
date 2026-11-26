# M5-channel

- 交給：cpp-feature（sonnet）
- 目標：新功能 `channel` 的前半：開頻道、三張長期的量表（訂閱、公信力、推薦權重）、預算（自有資金與公帳、可支領額度）、贊助、每週的結算、`flow_tier` 的來源。節目、編制、設備在下一張（M5-channel-shows）。
- 規格出處：MEDIA 第 4 節開頭、4.1 節、4.2 節、4.7 節（只看觸發的時機）、4.8 節；EVENTS 3.1 節（觸發點）、2.4 節（`credibility`）；SKILL_TREES 聚光燈（導流階）；dev/adr/0020 第二節、第十三節的量表表、V12～V16、V18、V19。
- 可以改的路徑：`engine/src/features/channel/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-channel.test.ts`。
- 可以用的介面：`k.meters.define`；`k.stats.addStatProvider('flow_tier', …)`（`flow_tier` 由 abilities 定義，先問 `hasStat`）；掛鉤 `time.passed`（順序 11）、`activity.end`、`game.new`；`weeklyCrossings`；`cred`、`cash` 變更；效果 `favor`、`hostility`（先問有沒有人註冊）；`k.effects.register`、`k.conditions.register`；報告的 `triggers`。
- 不可以做的事：不 import 別的功能；不走 `bill.collect`（預算不是主角身上的錢，V15）；不寫節目與開一集；事件的內容不寫（只發觸發點）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 量表：`subs`（單一、0 起、沒有上限）、`credibility`（單一、0～100、起始 50、AI ±5）、`reco`（單一、−3～3、起始 0、AI ±1）。`subs` 的 AI 上限是現值的 2%（最少 20），用量表的 `adjust` 或在效果進來時自己夾，做法回報。
- 狀態 `state.ext.channel`：`{ open: boolean, name, since, budget: { own: { cred, cash }, pools: Record<勢力, { cred: number, quota: number }> }, sponsors: Sponsor[], week: { episodes: number, lives: number, adult_reco: boolean }, log: Episode[] }`。
  - `Sponsor`：`{ faction, every_weeks, amount, plug_every?, plug_pay?, no_report?: { faction?: string; npc?: string }, tiers_off?: string[], since, weeks_left_to_pay, eps_since_plug }`。
  - `Episode`（最近十筆；這一張只記直播收播的那種，節目的由下一張加）：`{ at, kind: 'live' | 'show', show?, tier?, grade?, heat?, subs, tips, note }`。
- 內容種類 `channel_rule`（`overridable`，id `default`）：新頻道的訂閱（100）、流失（2%、5%）、推薦權重的每週自然成長（1%）、超領公帳每 500 的代價、額度的比例（20%）、頻道等級的門檻（1,000、10,000）、觸發點的機率不在這裡（那是 `event_scope` 的事）。
- 效果：`aired { what: 'live' | 'show' }`（這一週開過）、`channel_fund { pool: 'own' | 勢力, amount, purse?: 'cred' | 'cash' }`（撥款或罰款；扣到 0 為止）、`sponsor { faction, every_weeks, amount, … }`（帶來一份贊助）。量表自動有的 `subs`、`credibility`、`reco`。
- 條件：`channel_open`、`channel_level { min?, max? }`。
- 報告：`channel.open`、`channel.fund`（補貼）、`channel.withdraw`、`channel.sponsor_end`、`channel.weekly`（kind `downtime`，帶觸發點 `channel_week`）。
- 匯出：`channelView(k, state)`（名字、等級與位子數、三個數字、離下一級差多少、預算的每一格、每個金主的額度與條件、最近的集數）、`openChannel`、`fund`、`withdraw`、`withdrawPreview`（會扣哪個勢力多少好感、加多少敵對值）、`endSponsor`、`payFromBudget(state, amount, { purse? })`（開銷的扣法，回變更或付不出來的原因；下一張用）、`channelLevel`。

## 要做的

1. **開頻道**：取名、不花錢；`subs` 設成 100。沒開的時候 `flow_tier` 的 provider 回 0。
2. **`flow_tier`**：訂閱的位數 −3（一千 1、一萬 2、十萬 3、百萬 4；不到一千是 0），公信力 60 以上 +1。
3. **預算**：補貼（從主角的帳戶或現金投進自有的同一格）；開銷先扣公帳（照金主加入的先後）、再扣自有，只收一種錢的開銷那一格不夠就付不出來；拿出來——自有沒有代價；公帳在額度內沒有代價並扣額度；超過額度的部分每滿 500，那個勢力好感 −1、敵對值 +1。
4. **贊助**：每到期撥款進那個勢力的公帳，額度加撥款的 20%；終止時那個勢力公帳剩的錢收回、額度歸零。`eps_since_plug` 由下一張在每一集加；這一張只留欄位與條件用的查詢。
5. **每週**（週一 06:00；人在委託副本裡時照帳單的做法延到出來之後：問 `k.activity.active` 有沒有 `commission`）：贊助撥款 → 流失（這一週 `episodes + lives` 大於 0 是 2%，否則 5%；V12）→ 自然成長（訂閱 × 推薦權重 × 1%，可以是負的）→ 推薦權重往 0 回一格（V13）→ 清掉這一週的計數 → 一份 `channel.weekly`，帶觸發點 `channel_week`（`where`：這一週開了幾集、訂閱、公信力）。薪水由下一張掛進同一份。沒開頻道什麼都不做。
6. **聽直播的收播**（`activity.end`，`kind === 'live'`）：`result.to_channel !== false` 時 `week.lives` +1、在 `log` 加一筆。訂閱與打賞是直播自己用效果加的，這裡不重算。
7. 效果 `aired` 給節目與別的來源用（同一件事）。

## 驗收條件（`engine/tests/features/M5-channel.test.ts`；測試自帶兩個勢力）

- 開頻道之後訂閱 100、公信力 50、推薦權重 0；沒開時 `channelView` 回「還沒有頻道」而且 `flow_tier` 是 0。
- `flow_tier`：訂閱 999、1,000、10,000、100,000 與公信力 59、60 的組合對表。
- 開銷的順序：公帳 300、自有 500，付 600 → 公帳 0、自有 200；只收現金而現金那一格不夠 → 付不出來、狀態不變。
- 拿出來：額度 400 時拿 300 沒有代價、額度剩 100；再拿 700（超過 600）→ 好感 −1、敵對值 +1；`withdrawPreview` 和實際一樣。
- 贊助：撥款 3,000 → 公帳 +3,000、額度 +600；終止 → 公帳那一格歸零、額度歸零。
- 每週：開過與沒開過的流失各對；推薦權重 +2 的那一週訂閱多 2%、之後變 +1；跨兩個週一結兩次；報告帶 `channel_week`。
- 人在玩具的 `commission` 活動裡跨過週一：先不結，出來之後的下一次 `time.passed` 才結。
- 直播收播（玩具的 `activity.end`）：這一週算開過、`log` 多一筆；`to_channel: false` 的不算。
- AI 的來源給 `credibility +9` 被夾到 +5；給 `subs` 超過上限被夾。
- 只裝這個功能主套件照樣過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有。`flow_tier` 要 abilities 裝著才有（沒有就不加 provider）。

## M4 對帳（2026-11-26）

- 每週結算延後的條件和帳單現在的做法一樣，**只看 `commission`**（`features/bills/settle.ts` 的 `inCommission`）：人在潛入、簾後館的一趟、拍賣、斷線靜修裡跨過週一照常結。M4 沒有改這一條，這裡不自己多擋。
- 贊助帶來的 `favor`、`hostility` 照舊是 security 的量表效果；這一張新註冊的條件（`channel_open`、`channel_level`）如果條件的登錄表已經有「說明句」的欄位（M4 收尾修正批；以 0019 末尾的補記為準），要一起寫。
- 主角是契約人時，契約的收入歸屬只認 `work.` 開頭的報告（`features/contract/time.ts` 的 `isWorkSettle`）：頻道的廣告、打賞、補貼與支領都不會被抽成，這一張不用處理。

## 完成時回報

改了哪些檔、測試結果、`subs` 的 AI 上限怎麼做的、V12～V15 做的時候和設計書對不上的地方。
