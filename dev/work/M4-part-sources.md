# M4-part-sources

- 交給：cpp-feature（sonnet）　（**第五波**）
- 目標：未登錄零件的四個來源接上：委託的報酬（中間人的新掛點 `fixer.reward`：簡報的報酬欄多一樣東西、結算時給）、同人社團的委託台付錢訂做、勢力的固定窗口、口頭要到。
- 規格出處：CRAFTING 11.1 節「四個來源」那張表與表下兩條；FIXER 第 2 節①「報酬的另一種類型」那一條、第 8 節（人情的那一條）；COMMISSIONS 第 8 節「報酬裡的未登錄零件」；FACTIONS 5.1 節最後一段、第 7 節同人眾那一列；SITES 13.5 節「同人社團的委託台」那一列（只看「訂做要等 3 天」）；dev/adr/0019 第十七節與 P69～P73。
- 可以改的路徑：`engine/src/features/unreg/`、`engine/src/features/fixer/`（`model.ts`、`gen.ts`、`board.ts`、`pay.ts`：掛點與 `extra`）、`engine/tests/features/M4-part-sources.test.ts`。
- 可以用的介面：M4-part-unreg 的效果 `part_unreg`、`frameOf`、`pendingParts`、`deliverBlock`、規則表；`features/fixer` 現有的 `Offer`、`Terms`、`offersFor`（用游標固定在 0 的狀態生成）、`offerSeed`、`briefOf`、`boardRow`、`accept`、`payoutDraft` 與它的 `effectChanges`（有人註冊才跑、格式不合略過）、`RATING_KEYS`；內容種類 `commission_type`、`faction`（只讀選填的 `part_types`、`brand`、`leader`）；量表 `favor`（`features/security`；用 `meterOf` 讀，查不到當 0）；條件 `has_favor` 與變更 `favor.spend`（`features/favors`；用登錄表問，沒有人註冊時勢力的窗口整個不列）；條件 `at_facility` 與設施種類的欄位（照 `features/rest` 讀 `sleep` 的做法）；核心的 `cash`、`time`、`ext` 變更；`deriveRng`；`weekdayOf`。
- 不可以做的事：`fixer` 與 `unreg` 不互相 import（`fixer` 只宣告掛點、存下回答、結算時跑回答裡的效果，不知道回答的是誰）；不寫任何一件委託、一個攤位、一個「可以要」的事件的內容；AI 的當日優惠（`flavor_shop`）裡的未登錄零件不做；玩家自己的社團接訂做不做；不改報酬的三種付法；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 掛點 `fixer.reward`（`features/fixer` 宣告，寫法照 `scan.carried`）：
  `[{ state, phase: 'offer' | 'payout', fixer: 中間人的 id, commission: { id, kind, grade, employer?: 勢力的 id }, seed: string, rating?: Rating }, RewardExtra | void]`。
  `RewardExtra`＝`{ by: string, label: string, cash_pct?: number, effects: Effect[] }`（`label` 是報酬欄多的那一句；`cash_pct` 只有 `offer` 看，0～1；`effects` 在結算時用內建的來源跑）。
- `Offer` 多選填的 `extra?: RewardExtra`；`Terms` 多選填的 `extra?`（接的時候抄過來）；`BriefView`／`BoardRow` 多 `extra_label?`；`PayoutRecord` 多 `extra?: string[]`（結算時那幾個效果的句子）。
- `unreg_rule.sources` 這一張讀的鍵：
  - `reward`：`{ grade_cap: 3, grade_min: 3, chance: 0.1, cash_pct: 0.6, s_chance: 0.1667, top_rating: 'S', types?: string[] }`（`s_chance` 是六分之一：簡報沒寫而評價最高的那幾趟補上去之後，合起來約每四件一件；P69）。
  - `order`：`{ grade_cap: 3, price_mult: 1.5, days: 3, max_open: 1, quirk_pick_favor: 60 }`。
  - `window`：`{ grade_cap: 4, favor: 100, size: 'big' }`。
  - `ask`：`{ grade_cap: 2 }`。
- 設施種類多讀 `unreg_desk?: { faction?: 勢力的 id, brand?: string, weekdays?: number[] }`（同人社團的委託台；`faction` 是看哪個勢力的好感，`weekdays` 沒寫是每天）。
- 報告：`unreg.order`、`unreg.window`。匯出：`orderOptions(k, state)`、`orderBlock`／`orderDraft(k, state, { type, material?, grade, want?: string[], quirk?, request? })`、`windowOptions(k, state)`、`windowBlock`／`windowDraft(k, state, { faction, type, material?, want?: string[] })`。

## 要做的

1. `fixer`：掛點。`offersFor` 每生成一件就問一次 `phase: 'offer'`（傳進去的是那個游標固定的狀態與那一件的 `seed`）；第一個回答的算，其餘不看。有回答：`offer.extra` 存下、`offer.reward` 乘 `cash_pct`（沒寫是 1；照現有的做法四捨五入到十位，不低於 0）。經 `fixer.offers` 由別的功能給的委託不問（它們可以自己帶 `extra`）；`offerProblems` 多查 `extra` 的格式。
2. `fixer`：簡報與接案。`briefOf`、`boardRow` 帶 `extra_label`；交涉加價加在乘過之後的數字上；`accept` 把 `extra` 抄進 `terms`，接案的那一句多「，另外有<label>」。三種付法照舊只算現金的那一部分。
3. `fixer`：結算（`payoutDraft` 的 `done`）。`terms.extra` 有：用現有的 `effectChanges` 逐個跑它的 `effects`，變更與句子併進那一份報告（沒有人註冊的效果略過，並多一句「<label>這一次沒有給成。」）。沒有 `extra`：問一次 `phase: 'payout'`（帶這一趟的評價），有回答就跑它的 `effects`、句子開頭加「雇主多給了一樣東西：」，不扣現金。`failed` 與撤退都不給。評價的加成、抽成、分紅都不算這一樣東西。
4. `unreg`：回答 `fixer.reward`。
   - `offer`：委託的等級在 `grade_min` 以上，而且用 `deriveRng`（鍵：`unreg`、`reward`、那一件的 `seed`）擲中 `chance`。回答 `{ by: 'unreg', label: '一件未登錄零件（<類型名>，<等級>級）', cash_pct, effects: [{ kind: 'part_unreg', source: 'reward', type, grade, brand, from: '委託的報酬' }] }`。等級＝`min(委託的等級, grade_cap)`；類型從那種委託（`commission_type` 的那一筆）的 `part_types` 照種子抽，沒寫從 `sources.reward.types`、再沒有從全部的類型抽；牌子是委託人勢力資料的 `brand`，沒有就是 `doujin`。
   - `payout`：評價等於 `top_rating`（`unreg` 不 import `fixer`，所以最高那一檔的名字寫在規則表）而且擲中 `s_chance`（鍵多一段 `payout`）：回答同一種效果，沒有 `cash_pct`。
5. `unreg`：訂做。站在帶 `unreg_desk` 的設施上（`weekdays` 有寫時今天要在裡面）。`orderOptions` 列出：可以選的類型與材質、等級（1 到 `grade_cap`）、每一級的價錢（`price[等級] × price_mult`）、要等幾天、那個類型可以指定的方向（選項的 `name` 與 `tags`）、怪癖的候選（`faction` 的好感在 `quirk_pick_favor` 以上時照種子給兩筆讓玩家挑一筆，否則不給挑；種子是設施、類型與今天是第幾天，同一天問幾次都一樣）、擋住的原因。`orderDraft`：進行中的訂單（`hold: 'order'` 的 `pending`）不到 `max_open`；現金晶片夠；`quirk` 有給時要是候選之一。變更：扣現金、`pending` 多一筆（`source: 'order'`、`hold: 'order'`、`ready_at` 是現在加 `days` 天、牌子是 `unreg_desk.brand` 沒寫就 `doujin`、`request` 存下）。時間加 10 分鐘。
6. `unreg`：取貨。`deliverBlock` 對 `hold: 'order'` 的那一筆多一條：腳下不是帶 `unreg_desk` 的設施時「要到同人社團的委託台取貨。」（現實的攤位與網內的委託台都算，條件是同一個）。其餘照 M4-part-unreg 的 `deliverDraft`。
7. `unreg`：勢力的固定窗口。`windowOptions` 對每個勢力回答能不能換與原因：好感到 `favor`（100）；條件 `has_favor`（`dir: 'owed_to_pc'`、`size` 是 `big`、`who` 是那個勢力的 id 或它資料裡的 `leader`）成立；`once` 裡沒有 `window:<勢力>`。`windowDraft`：變更 `favor.spend`（那一筆大人情）、`pending` 多一筆（`source: 'window'`、等級是 `grade_cap`、牌子是那個勢力的 `brand` 沒有就用勢力的 id、類型與方向照玩家給的）、`once` 記下。不看人在哪裡。沒有人註冊 `has_favor` 時 `windowOptions` 回空的。
8. `unreg`：口頭要到。效果 `part_unreg` 的 `source: 'ask'` 一定要帶 `who`（在場的角色的 id；沒帶擋下），`once` 自動是 `ask:<who>`、提醒是「<名字>已經送過你一件了。」；等級不超過 `ask.grade_cap` 與主角所在那一區的等級。事件的選項怎麼寫是內容。

## 驗收條件（`engine/tests/features/M4-part-sources.test.ts`；測試自帶：兩個勢力（一個有 `brand` 與 `leader`）、一位 III 級的中間人與委託的模板（一種寫了 `part_types`）、一個帶 `unreg_desk` 的設施、M4-part-unreg 測試的那張小規則表；`favors`、`security`、`fixer`、`commission` 一起裝）

- 掛點：沒有人回答時 `offersFor` 的結果和這一張之前逐欄相同（拿現有的 M2-fixer 測試原樣跑）。把 `chance` 設成 1：III 級的委託 `extra_label` 有那一句、`reward` 是原本的六成；II 級的沒有。同一天問兩次結果相同（中間擲幾次骰都一樣）。
- 接案之後 `terms.extra` 在；交涉成功加的是六成之後的數字；選「匯進帳戶」到手的是六成的 85%。
- 結算：做完的那一份 `fixer.payout` 讓 `pending` 多一筆 `source: 'reward'`、等級不超過委託的等級也不超過 3、類型在 `part_types` 裡、牌子是委託人的；失敗的那一份沒有。`chance` 是 0、`s_chance` 是 1：評價 S 的那一趟結算多一筆而且現金沒有少；評價 A 的沒有。
- 訂做：不在委託台被擋；II 級扣 900 現金（600 × 1.5）、`pending` 多一筆 `hold: 'order'`；第二張訂單被擋；`want: ['社交']` 的框架裡有社交親和；好感 60 以上有兩筆怪癖可以挑、挑了候選以外的被擋；三天內取貨被擋並寫還要幾天；滿三天、人不在委託台被擋；回到委託台 `deliverDraft` 成功。
- 勢力的窗口：好感 99 被擋；沒有大人情被擋；都成立：`pending` 多一筆 IV 級、牌子是那個勢力的、大人情少一個；同一個勢力第二次被擋。人情記在 `leader` 名下時也成立。
- 口頭要到：效果帶 `who` 給得出來（II 級以下）；同一個人第二次落空並有那一句；沒帶 `who` 被擋；AI 給的被擋。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；M2 與 M3 的 `fixer` 測試不改全過。

## 依賴

M4-part-unreg。這一批沒有別的工單改 `features/fixer`。

## 完成時回報

改了哪些檔、測試結果、`fixer.reward` 實際的形狀（給之後要當報酬的功能看）、委託的類型資料裡 `part_types` 該怎麼填的建議（給內容）、訂做付的是哪一種錢與理由。
