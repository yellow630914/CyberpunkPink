# M5-away

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：新功能 `away`：簡化的派工——把名冊上沒帶出門的人派去做一件小事，每週結帳時擲一次、算錢、可能帶回東西或出事。順便把親衛隊的「出征」接上。
- 規格出處：FIXER 第 5、6、7 節、第 4 節（收入那一列）；DOWNTIME 4.3 節、5.1 節（結算的順序）；COMMISSIONS 6.4 節（同一套算法）；NPC_SYSTEM 10.4、10.5 節（可靠度、出場費；只看欄位）；MEDIA 9.3 節（出征）；LEWD_SYSTEM 7.5 節與 DOWNTIME 4.3 節最後一句（契約人照契約的收入分法）；dev/adr/0020 第九節、V44、V45、D5 與文末「M4 對帳」（V62、V65）；dev/adr/0016 第六、七節（`bill.collect`、`bill.settled`、共用的狀況）。
- 可以改的路徑：`engine/src/features/away/`（新）、`engine/src/features/idol/`（只加回答 `away.jobs` 的那一段：出征）、`engine/src/features/fixer/model.ts`（只有踩點清單裡灰著的「派名冊的人去踩點」那一句原因，見「M4 對帳」）、`engine/src/features/index.ts`、`engine/tests/features/M5-away.test.ts`。
- 可以用的介面：掛點 `bill.collect`、`bill.settled`（`features/bills` 宣告的格式：收入是 `kind: 'income'`）；條件 `in_roster`、`in_party`（名冊註冊的）；衍生數值 `roster_fee`、`rep_grade`（先問 `hasStat`）；`actor.conditions`（`busy`、`injured`、`lying_low`、`arrested`）、`actor.skills`、`actor.ext.paths`；`meterOf`（`loyalty`）；`k.content`（`job`：打工的資料，有人定義才讀）；效果 `hostility`、`item`、`owed_to_pc`（先問）；核心的固定亂數（存檔種子＋週次＋角色 id，不推進游標）；報告的 `triggers`。
- 不可以做的事：不 import `features/roster`、`features/work`、`features/fixer`、`features/bills`；不做成一個玩法（沒有地圖、沒有過程，只有派與結）；契約那一邊的條件與分帳不寫在這裡（這一張只宣告、問掛點 `away.terms`，由 M5-contract-link 讓 `contract` 回答）；自由的人去場所工作要「對方答應」，沒有那個機制，照舊灰掉；派工出事的事件內容不寫（只給狀況與觸發點）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `away_job`（`overridable`）：`{ id, name, skills: 基本功[], graded: boolean, pay: 'gig' | 'work' | 'none' | 'collect', brings?: 效果的範本[], needs?: 條件 }`。預設五筆照 FIXER 第 7 節的短清單：`small_gig` 小委託、`work` 打工、`stakeout` 盯梢、`collect` 收帳、`venue` 在場所工作（這一筆帶 `contract: true`：只有主角持約的人可以派——派的時候用 M4 的條件 `{ kind: 'contract', side: 'holder', npc: 那個人 }` 問；沒有人註冊這個條件、或不成立時灰掉，原因：「這種工作要有契約，或對方答應。」）。
- 內容種類 `away_rule`（`overridable`，id `default`）：DC（10 ＋ 等級 × 2）、分量修正（照 `commission_rule` 的 `aux_bonus`：強 +4、中 +2、弱 0；這裡自己存一份預設）、四級結果的錢（全額、全額、一半、0）、錢的表（V44）、可靠度低於多少自然 1～2 都算出事（40）、出事的三種與天數（V45）、每週每人一件。
- 掛點（這一張宣告、問）：`away.jobs`：`{ state, who }` → `Array<{ id, owner, name, skills, grade?: number, pay: number, free?: boolean（不拿出場費）, brings?: 效果[], block?: string }> | void`。
- 掛點（這一張宣告、問）：`away.terms`：`{ state, who }` → `{ owner, label: string, fee_share?: number（0～1：這個人從這一件的收入裡拿幾成，取代出場費）, block?: string（現在不能派他的原因） } | void`。第一個格式合格的回答算數；沒有人回答就是自由的人（照出場費）。
- 狀態 `state.ext.away`：`{ out: Record<角色 id, { job, owner, grade, pay, since, ref? }>, last: Array<{ who, job, roll, total, dc, outcome, money, brought? }> }`。
- 條件：`away_out { who }`。效果：`away_trouble { who }`（事件用：把一個派出去的人標成出事）。
- 報告：`away.assign`、`away.recall`（kind `downtime`）。結算沒有自己的報告：併在每週帳單那一份（`bill.collect` 的收入與 `bill.settled` 回的變更）。
- 匯出：`awayView(k, state)`（名冊上每個人：能不能派、不能的原因、可以派去的每一件事與成功率、預估的錢；已經派出去的與回來的時間；上一週的結果）、`assign`、`recall`、`assignBlock`、`awayChance`。

## 要做的

1. **派**：那個人要在名冊上、不在隊伍裡、身上沒有 `busy`、`injured`、`lying_low`、`arrested`、`recovering`（M4 的手術後休養；暫定，0020 V65）；`away.terms` 回了 `block` 的不能派（例：契約人被借出去了）；一個人一週一件。可以派去的事 = 內建的 `away_job`（`needs` 成立的）加 `away.jobs` 的回答。有等級的事（小委託、收帳）等級由玩家選，不超過主角的級（`rep_grade`，沒有人定義當 1）。打工要指定一份 `job`（那份工作的 `requires` 對那個人成立才行；`job` 這種內容沒有人定義時這一項不列）。派出去：`actor.condition busy`、記進 `out`。
2. **叫回來**（結算之前）：拿掉 `busy`、清掉；這一週不能再派他。
3. **結算**（每週帳單）：
   - `bill.collect`：每個派出去的人擲一次——1d20 ＋ 他在那件事的基本功裡最高的 ＋ 分量修正（他的路數在那件事的戰場是強、中、弱；沒有路數 0）＋ 主角的人面階數（讀主角的 `actor.ext.paths`）對 10 ＋ 等級 × 2（沒有等級的事當 1）。結果：超過 5 以上與成功是全額、失敗一半、自然 1（可靠度低於 40 的是 1～2）是 0。那個人的出場費（`roster_fee`；`free` 的不扣）從錢裡扣、不夠扣到 0；`away.terms` 回了 `fee_share` 的不扣出場費，改成收入 ×（1 − `fee_share`）歸你（捨去），那一筆收入的名字後面加回答的 `label`。每個人回一筆收入的項目（名字寫誰去做了什麼）。骰子用固定亂數，同一週問幾次都一樣。
   - `bill.settled`：同一組骰子再算一次，回變更——每個人拿掉 `busy`；超過 5 以上的帶回一樣東西（那件事的 `brings` 照固定亂數挑一筆：一則線索、一個小人情、一件零件；對應的效果沒有人註冊就沒有）；出事的照 V45 三選一並在那一份報告帶觸發點 `away_trouble`（`where`：誰、做什麼、哪一種）；清掉 `out`、記進 `last`。
   - 人在委託副本裡跨過週一：帳單本來就延後，這裡跟著它（不自己聽 `time.passed`）。
4. **錢的表**（V44）：小委託 = 規則表裡每一級的數字（預設照 EVENTS 2.4 內建事件的區等級上限的四分之一取整：30、90、300、975、3,000）；打工 = 那份工作的時薪 × 8 × 5 的一半（讀 `job` 的資料；M4 之後打工的資料是 `need.hours`、`every[].hours`，舊的 `shifts` 載入時會被擋，測試自帶的 `job` 要用新的寫法；公式型時薪的當 0 並回報）；盯梢沒有錢；收帳 = 等級 × 150。
5. **出征**（改 `features/idol`）：回答 `away.jobs`——問的那個人是偶像本人不回；主角或隊伍裡有偶像而且親衛隊 4 級（人氣 80）時，對「名冊上任何一個人」多回一件 `guard_march`（`free: true`、錢照小委託同級的全額），用了扣親衛隊這一週的動用次數一次（次數用完回 `block`）。MEDIA 9.3 的寫法是「當成一次派工，不必付錢」：這裡做成「這一週多一件不拿出場費的事可以派」，回報這個讀法。
6. `owner` 不是 `away` 的事（別的功能回的）：錢與 `brings` 照回答給的；出事照同一套。

## 驗收條件（`engine/tests/features/M5-away.test.ts`；測試裝真的 `roster`、`bills`（測試可以裝），自帶三個名冊上的人、一份 `job`）

- 能不能派：不在名冊、在隊伍裡、`injured`、這一週已經派過，各被擋並有原因；派出去之後召集他被名冊擋（`busy`）。
- 算式：固定亂數下每一項的值對；四級結果的錢對；出場費扣掉、不夠扣到 0；`free` 的不扣。
- 每週帳單那一份報告：有每個人的一筆收入；`busy` 拿掉了；超過 5 以上的多一樣東西；自然 1 的那個人有對應的狀況、報告帶 `away_trouble`。
- 可靠度 30 的人擲 2 也出事；可靠度 60 的不會。
- 同一週 `billPreview` 問兩次，派工的收入一樣（固定亂數、沒有推進游標）。
- 叫回來：`busy` 拿掉、這一週的帳單沒有他的收入、不能再派。
- 帳單倍率不乘收入（確認現有 `bills` 的行為；不是的話回報）。
- 出征：人氣 80 時名冊上的人多一件 `guard_march`、不扣出場費、扣一次親衛隊的次數；人氣 79 沒有。
- `away.jobs` 的替身回一件帶 `block` 的：列得出來、灰掉、原因對。
- `away.terms` 的替身對某個人回 `{ fee_share: 0.2, label: '契約人' }`：他的出場費不扣、收入的八成歸你；回 `block` 的那個人派不了、原因是回答的句子。條件 `contract` 的替身對他成立時 `venue` 可以派，不成立或沒有人註冊時灰掉。
- 把 `away` 拿掉：名冊、帳單、偶像的測試原樣全過。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-idol（出征；沒有 idol 也跑得起來）。和 M5-home-base 可以同時做。店長算派工由 M5-shop 回答 `away.jobs`。

## M4 對帳（2026-11-26）

- 主角持約的人經 `roster_add { direct: true }` 在名冊上（M4-contract-holder），所以「要在名冊上」這一條對他們本來就成立；契約那一邊的差別只有三件事：不拿出場費而是照契約分帳、可以派去場所工作、被借出去時不能派。前兩件與第三件都經 `away.terms` 與條件 `contract` 進來，這一張不讀 `state.ext.contract`。
- 主角自己是契約人時，契約的收入歸屬只認 `work.` 開頭的報告：派工的收入併在帳單（`bill.`）裡，不會被抽成。
- M4 多的共用狀況：`recovering`、`wound_*`、`fatigued`、`hungover`。只有 `recovering` 擋派工；其餘不擋（設計書沒寫）。
- **盯梢與踩點**：`features/fixer` 的踩點清單裡有一項一直灰著的「派名冊的人去踩點」（`model.ts` 的 `LOCKED_METHODS`，`dispatch`，註解寫著等 M5 的派工）。這一張把它接上：盯梢（`stakeout`）的 `brings` 範本裡放 fixer 的效果 `scout_reveal { count: 1 }`（替手上最近接的那一件委託揭開一項未知；有人註冊才給，沒有接著的委託時那個效果自己不做事）；並把 `dispatch` 那一句原因從「還沒有開放。」改成「到名冊上派他去盯梢，週一帶回來。」（只改那一句；away 沒裝的局這一句會指到不存在的入口——要照有沒有人註冊條件 `away_out` 換句子的話，做法回報，不大改 fixer）。

## 完成時回報

改了哪些檔、測試結果、`bill.collect` 的收入格式夠不夠用、V44 的錢與 DOWNTIME 4.3「自由的人分你一半」怎麼對的、出征的讀法、`away.terms` 的格式給 M5-contract-link 夠不夠用。
