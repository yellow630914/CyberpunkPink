# M4-contract

- 交給：cpp-feature（sonnet）
- 目標：新功能 `contract`，先做主角是契約人的那一面：契約的紀錄、橋權三級、指令的佇列（送達、照做或抗拒、強制、逾期）、滿意、規矩、收入歸屬、身分與光紋、還清與解約的出口。
- 規格出處：LEWD_SYSTEM 第 7 節（7.1～7.4、7.6、7.8；7.5 是下一張、7.7 不做）；LIFE 3.4 節（紙上寫什麼：條文對到哪些欄位）；EVENTS 4.5 節；DOWNTIME 4.2 節最後一條；dev/adr/0019 第八節與 P27～P30。
- 可以改的路徑：`engine/src/features/contract/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-contract.test.ts`。
- 可以用的介面：`k.meters.define`（量表 `satisfaction`：`keyed: 'none'`，因為主角身上一次只有一份管理級的契約；0～100；AI 與玩家要的一律不收，只有內建的來源能動它（`MeterDef.accepts`，做法看 `features/roster` 的忠誠）；效果與條件自動有）；掛點 `time.passed`（`dailyCrossings`、`weeklyCrossings`）、`report.before`（收入歸屬）、`report.after`、`rewind.keep`（不用：佇列跟著快照回去是對的）；內容種類 `event_scope` 的 `contract` 那一筆（`features/director` 定義；只讀 `daily_roll`、`satisfaction_mult`、`queue_max`）；報告上的 `triggers` 與 `where`（導演挑事件用）；`k.activity.active`（委託副本裡期限暫停）；`makeCheck`、`checkParts`；`contentAllowed`（`contract_dom`、`pc_unwilling`、`ntr`）；`actor.ext.identity`（`features/security` 定義的格式：`{ class }`）；效果 `bridge`、`cyber_lock`、量表 `hostility` 的效果、`load` 效果（用登錄表跑，查不到略過）；`k.passives.register`（來源 `contract`）；`deriveRng`。
- 不可以做的事：不寫任何一件指令事件的內容（事件是 `features/director` 的資料，這一張只發觸發點）；牆外的契約不做（留 `oath?` 欄位）；九條脫身的路只做「還清」與效果 `contract_end`；不 import 別的功能；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `state.ext.contract = { mine: Contract | null, held: Record<npc, …>（下一張）, rights: Array<{ holder, level: 'read' | 'limit', source }>, seq }`。
- `Contract`：`id`、`holder`（`{ kind: 'eden' | 'gang' | 'corp' | 'person', faction?, npc?, name, place?: { district?, block?, facility? } }`）、`type`（`debt`、`work`、`private`）、`orders`（紙上勾的指令種類）、`debt?`、`until?`、`relation`（`formal`、`partner`、`play`、`intense`、`lover`）、`rules`（`Array<{ kind: 'zone' | 'curfew' | 'dress' | 'person', value }>`）、`queue: Order[]`、`mark`（`{ covered: boolean }`）、`was_class`（簽之前的身分）、`complied`（照做過幾次）、`report_weekday?`、`oath?`。
- `Order`：`id`、`kind`（`errand`、`modify`、`serve`、`work`、`report`、`lend`）、`from`、`place?`、`issued`、`deadline`、`state`（`sent`、`doing`、`resisted`、`forced`、`done`、`overdue`）、`asked?`（主角主動要求的）。
- 規則 `contract_rule`（`overridable`）：`kind_weights`（每種持約人一組：P27）、`deadline_hours`（`errand` [24, 72]、`modify` 48、`serve` [4, 12]、`work` 照時段、`report` 到那一天結束、`lend` 24）、`resist`（`{ base: 12, manage: 4, docility_div: 10, sink: { 60: 2, 80: 4 }, relation: -4 }`）、`satisfaction`（`{ start: 50, comply: 5, asked: 8, resist: -5, overdue: -10 }`）、`docility_every`（3）、`overdue`（三種處置的權重與數字：鎖一件義體 24 小時、感載加到上限的一半、敵對值 +10）、`income_keep`（0.1）、`debt_monthly`（0.02）、`buyout`（`{ mult: 1.5, talk_at: 80, talk_dc: 16, talk_mult: 1.2 }`）、`crossed_out_mult`（0.5）。
- 效果（內建的來源才收）：`contract_sign`（`{ holder, type, orders?, debt?, days?, relation?, rules? }`）、`contract_end`（`{ how }`）、`order`（`{ kind, place?, hours? }`：直接塞一條指令）、`bridge_right`（`{ holder, level, source }`：讀取或限制級，只記錄）。條件：`contract`（`{ side: 'bound' | 'holder', type?, holder_kind? }`）、`order_pending`（`{ kind? }`）。
- 報告：`contract.sign`、`contract.order`（送達的通知）、`contract.choose`（照做或抗拒）、`contract.arrive`（走到了：帶觸發點 `order` 與 `where: { order, holder, relation }`）、`contract.done`、`contract.overdue`、`contract.pay`、`contract.end`、`contract.rule`（違反規矩）。匯出：`contractOf`、`boundView(k, state)`（契約寫了什麼、規矩、滿意、還欠多少、佇列每一條的期限與逾期會怎樣、抗拒的 DC 與成功率、還清的價錢）、`chooseDraft(k, state, { order, how: 'comply' | 'resist' })`、`arriveBlock`／`arriveDraft(k, state, { order })`、`completeDraft(k, state, { order })`（事件做完之後由事件的結果或呼叫的人收尾）、`askOrderDraft(k, state, { kind })`、`payoffBlock`／`payoffDraft`、`coverMarkDraft`。

## 要做的

1. 簽（效果 `contract_sign`）：主角身上已經有管理級的契約時落空並提醒；否則建立 `mine`、滿意從 `start`、身分改成 `bound`（記下原本的）。`contract_end`：清掉 `mine` 與佇列、身分改回去、滿意的量表歸零。
2. 每天 08:00（`time.passed`）：佇列不到 `queue_max` 時擲要不要下指令：機率＝那種持約人的基本頻率（`person` 的範圍取中間值，資料寫了 `holder.freq` 用它）× 滿意的倍率；要下的話照 `kind_weights` 抽種類（紙上沒勾的權重 × `crossed_out_mult`；`contract_dom` 關掉時只剩 `errand`、`work`、`report`；主僕關係是戀人時不抽 `lend`），期限照 `deadline_hours`，發一份 `contract.order`。每週在 `report_weekday` 那一天自動排一條 `report`（不擲、不佔機率）。
3. 照做或抗拒（EVENTS 4.5 節）：照做 → `doing`。抗拒：定力對 DC＝`base`＋`manage`＋⌊馴化有效值 ÷ `docility_div`⌋＋沉溺的懲罰 −（關係是夥伴或戀人時 4）；成功 → `resisted`、滿意 −5；失敗 → `forced`（`pc_unwilling` 關掉時，被強制的只會是 `errand` 與 `work`，其餘種類失敗時當成功）。主動要求（`askOrderDraft`）的那一條直接是 `doing`、`asked: true`。
4. 走到了：人在 `place`（照 `location` 與腳下的設施比對；沒有 `place` 的指令在哪都算）而且那一條是 `doing` 或 `forced` 時，`arriveDraft` 發 `contract.arrive`：帶觸發點 `order` 與 `where`，事件由導演挑。沒有任何事件接手時（下一份報告不是事件開始），呼叫的人可以直接 `completeDraft`。
5. 做完（`completeDraft`）：那一條 → `done`；滿意 +5（`asked` 的 +8）；`complied` +1，每滿 `docility_every` 次馴化 +1（`bridge` 效果）。佇列裡 `done`、`resisted`、`overdue` 的留最近十條當紀錄。
6. 逾期：`forced` 的過了期限 → `overdue`、滿意 −10、照 `overdue` 的權重抽一種處置並用效果做（鎖義體：`cyber_lock` 帶 `hours: 24`；感載：加到上限的一半；回報位置：持約人那一方的敵對值 +10；查不到效果的那一種重抽）。`sent`、`doing` 的過期只是作廢、滿意 −5。**委託副本進行中不計時**：`time.passed` 時把副本裡過的那一段時間加回每一條的期限。
7. 規矩（P30）：`zone`：一份讓主角走進那一區的報告之後接一份 `contract.rule`（滿意 −5）；`curfew`：每天 05:00 查主角在不在住處（條件 `at_home`，沒有人註冊就不查）。`dress`、`person` 只記錄。
8. 收入歸屬（`report.before`）：佇列裡有 `doing` 或 `forced` 的 `work` 指令時，這一份報告如果是打工結算（`action` 以 `work.` 開頭）而且有往上的錢，把其中（1 − `income_keep`）改成不給（留一成），並在結果加一句；債務契約另外把那九成記成還債（`debt` 減少）。
9. 還清：`payoffDraft` 付 `debt × buyout.mult`（滿意 `talk_at` 以上可以先擲一次交涉，成功改成 `talk_mult`）；付清等於 `contract_end`。債每 30 天加 `debt_monthly`。
10. 光紋：`mark.covered` 由 `coverMarkDraft` 開關（要背包裡有帶 `mark_cover` 標籤的物品）；掃橋與外觀怎麼用是別人的事（`scan.person` 的回答在 M4-security-m4 那一步由這個功能補：這一張先匯出 `scanAnswer(state, actor)`）。
11. 被動效果（來源 `contract`）：目前沒有固定的；留著給之後的條款。

## 驗收條件（`engine/tests/features/M4-contract.test.ts`；測試自帶範圍 `contract` 的資料、一個伊甸園的持約人、一個個人持約人；`cyber_lock`、`hostility` 用測試自己註冊的假效果）

- 效果 `contract_sign`：`mine` 建好、身分是 `bound`、滿意 50；再簽一份落空；AI 給的被擋。`contract_end` 之後身分回到原本的、佇列清空。
- 把骰子固定成一定下：過一個 08:00 佇列多一條、有一份 `contract.order`；佇列三條時不再下；滿意 20 時用的機率是 ×1.5（看探針或把基本頻率設成 0.5 驗兩邊）。`contract_dom` 關掉時抽不到 `serve`。每週那一天多一條 `report`。
- 抗拒：DC 照公式（馴化 40、管理級、沉溺 65、關係 `formal`：12＋4＋4＋2＝22；關係 `lover` 是 18）；成功滿意 −5；失敗變 `forced`；`pc_unwilling` 關掉時 `serve` 抗拒失敗當成功。
- 照做 → 走到 `place` → `arriveDraft` 的報告帶觸發點 `order` 與對的 `where`；不在那裡被擋。`completeDraft` 之後滿意 +5；第三次照做馴化 +1。主動要求的 +8。
- 逾期：`forced` 的過期之後滿意 −10、假的 `cyber_lock` 被叫到（把權重設成只有它）；委託副本（替身活動 `commission`）裡過 100 小時，期限沒有少。
- 收入歸屬：`work` 指令進行中，一份 `work.settle` 給 200 現金的報告實際只進 20、債少 180；沒有指令時照拿。
- 還清：債 10,000 付 15,000 解約；滿意 85、交涉成功付 12,000；錢不夠被擋。
- 走進禁區的報告之後有 `contract.rule`、滿意 −5。
- 回到快照（撤退）：佇列與滿意跟著回去。存檔再讀一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-passive。`cyber_lock`（M4-cyber-lock）、`tuning`（M4-tuning）沒裝也跑得起來。

## 完成時回報

改了哪些檔、測試結果、`work` 的結算報告實際的 `action` 名字（收入歸屬對的是哪一個）、七種指令裡「出借」目前只是一條指令的種類、P27～P30 的數字照表。

- 總指揮補記（2026-11-25，M4-cyber-lock 回報）：契約鎖（`lock.kind: contract`）目前只讀得到、能被 `crackDraft` 破解；契約鎖要不要擋破解、遠端接管，歸這一張。
