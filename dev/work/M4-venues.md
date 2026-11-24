# M4-venues

- 交給：cpp-feature（sonnet）
- 目標：兩個場所的玩法：人偶館打工的兩種模式（戴晶片、清醒）與分帳；新功能 `arena`：感官擂台（一對一、只有神經傷害、先過載的輸、可以押自己）。
- 規格出處：LEWD_SYSTEM 第 6 節的表（人偶館、感官擂台兩列）、6.1 節（一班、錢怎麼分；四家店的表只當資料的例子）；DOWNTIME 4.1 節半夢那一列與表下第一、二條、4.2 節；EVENTS 4.7 節「擂台的邀約」那一列；CORE_RULES 4.2 節（過載）；dev/adr/0019 P62、P63。
- 可以改的路徑：`engine/src/features/work/`、`engine/src/features/arena/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-venues.test.ts`。
- 可以用的介面：`features/work` 現有的工作格式（檔頭的說明）、`shift.ts` 的結算、階段；`contentAllowed`（`puppet_amnesia`）；效果 `bridge`、`sink`、量表 `fame`（用登錄表跑）；`Game.startBattle` 走的那一條 `launch`（報告的代辦：`{ kind: 'battle', setup, origin }`，寫法看 `features/commission/run.ts` 開戰的地方）、`k.battle.on('overload')`、`run.finish`、單位的來源 `enemy` 與 `actor`、`weaponFromClass`；掛點 `activity.end`（收戰鬥的結果）；條件 `at_facility`；設施種類的欄位；核心的 `cred`／`cash` 變更。
- 不可以做的事：不寫任何一家店、一個對手的內容；人偶館的事件（客人、留念的帶子）是事件資料；擂台場邊的下注、線上版、轉播不做；`work` 與 `arena` 不互相 import；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 工作（`job`）多讀：
  - `modes?: Record<模式的 id, { name, wage, check?: 同 job.check | false, tags?: string[], perks?: 效果[], amnesia?: boolean, every?: Array<{ shifts, effects: 效果[] }> }>`：有 `modes` 的工作上班前要選一種；`tags` 被篩選關掉的模式不列。
  - `cut?: { house: 0～1, rent?: 每班的租金 }`（店家抽幾成、晶片的租金；`wage` 寫的是客人付給店家的每小時時）。沒寫 `cut` 的工作 `wage` 照舊是自己拿到的。
  - `wage_formula?: { base, add: Array<{ stat?: 衍生數值, meter?: 量表, div }> }`（公式型的時薪：第七棚）。
- 打工的狀態多記每份工作每種模式做了幾班；`amnesia` 的那一班，結算報告的 `outcome` 多 `amnesia: true`、結果的句子只有兩句（賺了多少、一句模糊的殘留），時間照過。
- `arena`：設施種類多讀 `arena?: { grades: number[], stake_max?: number }`；規則 `arena_rule`（`overridable`）：`weapon`（`{ class: weapon_class 的 id, dice, type: 'neural' }`）、`odds`（`{ base: 1, per_cap_diff: 0.02, min: 0.5, max: 3 }`）、`fee`（報名費，0）。
- 報告：`arena.enter`、`arena.result`。匯出：`arenaOptions(k, state)`（這裡能不能打、對手的清單由呼叫的人給）、`enterBlock`／`enterDraft(k, state, { foe: 敵人的 id 或角色的 id, stake })`、`arenaView`。

## 要做的

1. `work`：模式。有 `modes` 的工作，`shift` 的入口多收 `mode`（沒給而有 `modes` 時擋下並列出可以選的）；時薪、檢定、附帶的效果照那個模式的；`every` 是「每做滿幾班」給一次的效果（P63：戴晶片每 3 班馴化 +1、每 5 班沉溺 +1，這是資料）。階段的倍率照舊乘。
2. `work`：分帳。有 `cut` 時這一班拿到的＝時數 × 時薪 ×（1 − `house`）− `rent`（最少 0），再乘階段與成功程度（LEWD_SYSTEM 6.1 節的算法：一班 6 小時 × 150 × 四成 − 120 ＝ 240 這種）。契約人再被拿走九成是 `contract` 用 `report.before` 做的，這裡不管。
3. `work`：公式型的時薪。`wage_formula` 有寫就用它（每一項查得到才加；查不到當 0），無條件捨去。
4. `work`：`amnesia`。這一班的報告不帶打工事件的觸發點以外的細節；共同記憶之類聽 `report.after` 的功能看得到 `outcome.amnesia`（它們要不要略過是它們的事，列在回報）。
5. `arena`：報名。腳下的設施有 `arena`；押的錢不超過 `stake_max` 與身上的現金；主角要有橋（沒有感載的人上不了）。開一場現實戰場的一對一：我方只有主角、敵方一個人；雙方的武器都換成 `arena_rule.weapon` 那一把（開戰的設定裡給單位、不讀角色自己的裝備；做的人看 `core/battle/setup.ts` 怎麼直接給單位）；快取格清空；`origin` 是 `{ by: 'arena', ext: { arena: { stake, odds } } }`。
6. `arena`：勝負。任何一方第一次過載（`overload` 掛點）這一場就結束：對方過載是贏、主角過載是輸。**不走戰敗的三選一**：做的人先看 `features/defeat/flow.ts` 認哪個記號可以略過（例如 `origin.ext` 的鍵）；沒有的話用不算輸的結果收尾（輸贏記在 `battle.field.arena`），並寫進回報。餘韻那一層照規則留著（輸的人身上多一層）。
7. `arena`：結算（聽 `activity.end`，種類是 `battle`、`origin.by === 'arena'`）：贏了拿押的錢 × 賠率（賠率照雙方感載上限的差：對手比你高越多賠越多，夾在 `min`～`max`），輸了押的錢沒了；發一份 `arena.result`，帶一個觸發點 `arena_result` 與 `where: { won }`（輸的一方的後續是事件的事）。這一區的豔名 +1（有量表才加）。

## 驗收條件（`engine/tests/features/M4-venues.test.ts`；測試自帶一份有兩種模式的人偶館工作（照半夢的數字）、一份照琉璃宮的 `cut`、一份公式型時薪的工作、一個擂台的設施、一個對手）

- 人偶館：沒給 `mode` 被擋並列出兩種；戴晶片不擲、時薪 30；清醒擲魅力＋誘惑對 14、時薪 18；`puppet_amnesia` 關掉時只列清醒。戴晶片做第三班的那一份報告馴化 +1、第五班沉溺 +1（和 `lewdFeature` 一起裝）。戴晶片那一班的 `outcome.amnesia` 是 true、結果只有兩句。
- `cut`：6 小時、150、`house: 0.6`、`rent: 120`：拿到 240；租金比收入高時拿 0 不倒貼。
- 公式：基底 10、敏感度 60 ÷ 5、豔名 20 ÷ 5：時薪 26。
- 現有的 `M2-work` 測試不改全過。
- 擂台：不在擂台的設施被擋；沒有橋被擋；押的超過現金被擋。開打之後雙方手上只有那一把神經武器、沒有快取格；把對手打到過載（testkit 的 `playOut` 或固定骰子）：戰鬥結束、有 `arena.result`、錢是押的 × 賠率；主角先過載：錢沒了、**沒有進等著選的戰敗**（`Game.pendingDefeat` 是空的）、身上多一層餘韻。
- `arena.result` 的報告帶觸發點與 `where.won`。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-passive（沒有硬的介面依賴；排在契約之後，分帳的測試可以和 `contractFeature` 一起裝驗一次「九成被拿走」）。和 M4-followups 不要同時做（都碰 `features/work`）。

## 完成時回報

改了哪些檔、測試結果、擂台不走戰敗用的是哪一種做法、`amnesia` 的報告哪些功能應該略過（共同記憶、性經歷）但這一張沒有動。
