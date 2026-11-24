# M5-social

- 交給：cpp-feature（sonnet）
- 目標：新功能 `social`：社群帳號的追蹤、用素材或片發文（算式照設計書）、每週的轉換與流失、一面只有氛圍數字的動態牆。
- 規格出處：MEDIA 第 13 節（全部）、第 10 節（追蹤那一列）、2.1 節（發文扣一次）、第 2 節（新鮮度、獨家）；SERIES 5.3 節（動態牆不算得知）；LEWD_SYSTEM 第 5 節（豔名的來源，只看發文那一條）；dev/adr/0020 第四節、第十三節、P29、P30、P54。
- 可以改的路徑：`engine/src/features/social/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-social.test.ts`。
- 可以用的介面：`k.meters.define`；掛點 `media.materials`、`media.spend`；`meterOf`（`subs`、`reco`、`credibility`、`popularity`、`fame`、`affinity`）；效果 `fame`、`subs`（先問有沒有人註冊）；掛鉤 `time.passed`（順序 11）、`game.new`；`weeklyCrossings`；`state.reports`、`state.rng.seed`、`state.time`、`state.location`；`time` 變更；`state.rules.contentOff`。
- 不可以做的事：不 import 別的功能；發文不給街頭信譽、不動公信力、不加敵對值、不動親密度（MEDIA 13.1 寫明之後再定）；動態牆不改任何狀態、不給素材、不算得知一條線索；不加 AI 任務（貼文與留言的字用模板）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 量表 `followers`（單一、0 起、沒有上限、起始 0；AI 的上限是現值的 2%，最少 20）。
- 狀態 `state.ext.social`：`{ posts: Post[]（最近三十篇）, seq, week: { posts: number, fame: number } }`。`Post`：`{ id, at, ref, kind: 'footage' | 'clip', title, text, reach, likes, comments, gained, fame?: 區 id }`。
- 內容種類 `social_rule`（`overridable`，id `default`）：發文的分鐘（10）、互動分的每一項與上限（12）、名聲指數與頻道指數的係數、觸及的比例與最少（20%、30）、愛心 10%、留言 15%、新追蹤 20%、豔名每週上限（3）、每週轉訂閱（3%）、沒發文的流失（3%）、動態牆的四個基數（路人 20、熟人 50、名人與名冊上的人 300、城市傳聞 150）、動態牆往回看幾天（3）、來源的對照表。
- 掛點（這一張宣告、問）：`social.feed`：`{ state, since: 總分鐘 }` → `Array<{ id, at, who?: 角色 id, source: 'acquaintance' | 'celebrity' | 'rumor' | 'witness' | 'party', text, adult?: boolean }> | void`。
- 報告：`social.post`（kind `broadcast`）、`social.weekly`（kind `downtime`）。
- 匯出：`postPreview(k, state, ref)`（互動分的每一項、三個指數、觸及、愛心、留言、新追蹤）、`post`、`postBlock`、`socialView(k, state)`（追蹤、這一週發了幾篇、最近的貼文）、`feedView(k, state)`（動態牆）。

## 要做的

1. **發文**：來源只能是素材或片（`media.materials` 查得到、還有次數）；經 `media.spend`（`how: 'post'`）扣 1，變更併進這一份報告；時間 10 分鐘。成人內容照內容篩選（`Material.adult` 而且對應的標籤被關掉時不能發）。
2. **算式**（MEDIA 13.1，一項一項從規則表讀）：互動分 E = 看點 ＋（品質 − 3）＋ 新鮮度（新 2、尚可 1、舊貨 0）＋ 獨家 2 ＋ 涉及名人或勢力 1，夾在 0～12；名聲指數 = 1 ＋ 人氣 ÷ 200 ＋ 豔名級數 × 0.05（豔名取發文所在的區；人氣取主角的，沒有人定義是 0）；頻道指數 = 1 ＋ 推薦權重 × 0.1 ＋（公信力 − 50）÷ 250 ＋ 訂閱每 1,000 人 × 0.02（最多 +0.2）（三張量表沒有人定義時：推薦權重 0、公信力 50、訂閱 0）；觸及 = max(追蹤 × 20%, 30) ×（1 ＋ 0.15 × E）× 名聲指數 × 頻道指數；愛心、留言、新追蹤照比例，都四捨五入成整數。
3. **豔名**：親密類而且畫面裡有你（`Material.self`）時，所在那一區的豔名 +1，每週最多 +3；不在任何一區不加。
4. **每週**（週一 06:00）：追蹤的 3% 轉成訂閱（追蹤不減；`subs` 有人註冊才給）；這一週一篇都沒發，追蹤流失 3%；清計數。
5. **動態牆**（純函式）：往回看三天的 `state.reports`（沒有被收回的），照規則表的對照把幾種報告變成貼文——`npc.life`（那個人主角認識：親密度 30 以上或在名冊上，當「熟人」或「名人與名冊上的人」）、`commission.finish`（路人目擊）、事件視窗結束的那一份（當事人分享；帶 `adult` 的只留一句、不顯示細節）——加上 `social.feed` 的回答。每一則的愛心 = 基數 ×（0.5～1.5，照「存檔種子＋日子＋貼文 id」算的固定亂數），留言 = 愛心 × 10%。貼文的字用模板（來源的摘要一句）。照內容篩選濾。排序新的在前，最多三十則。

## 驗收條件（`engine/tests/features/M5-social.test.ts`；測試裝真的 `media`，自帶素材、玩具的量表定義（`testMeter`）、幾份假的報告）

- 沒有來源發不了；發一篇素材少一次；用片發扣的是片的次數。
- 算式：一組固定輸入逐項對（E 的每一項、夾在 12、兩個指數、觸及最少 30、四個數字的四捨五入）。
- 三張頻道的量表都沒有人定義時頻道指數是 1；有的時候對式子。
- 親密類而且有你：豔名 +1；同一週第四篇不再加；不是親密類不加。
- 發文前後 `rep`、`credibility`、每一個勢力的 `hostility`、每一個人的 `affinity` 都沒變（逐一比）。
- 每週：追蹤 1,000 → 訂閱 +30、追蹤不變；沒發文的一週追蹤 −3%；有發的那一週不流失。
- `feedView`：呼叫前後狀態逐位元組相同；同一個存檔同一天呼叫兩次結果一樣、隔一天愛心數不同；被收回的報告不出現；`adult` 的那一則只有一句；`social.feed` 的替身回的貼文排進去。
- AI 的來源給 `followers` 超過上限被夾。
- 把 `media` 拿掉：`postBlock` 回「沒有素材庫。」，動態牆照樣有。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-media-chain。頻道的量表有沒有都跑得起來。

## 完成時回報

改了哪些檔、測試結果、動態牆從報告認得出哪幾種事（認不出來的列出來：要哪個功能的報告多帶什麼）、MEDIA 第 13 節對不上的地方。
