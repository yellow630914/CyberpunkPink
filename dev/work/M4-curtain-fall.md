# M4-curtain-fall

- 交給：cpp-feature（sonnet）
- 目標：簾後館打輸之後：落幕的結算、補演（可以喊停）、之後的三條路（付清、記帳、簽檔期）、母帶外流；戰敗事件的種類 `stage`。
- 規格出處：CYBERSPACE 8.8 節「打輸會怎樣」（四步、母帶那一條）、「預定要寫的」（只看種類與代價，內文是內容）、「和別的系統」的契約與沉溺兩列、「篩選關掉時」的表；8.7 節「戰敗接成人事件」那一條；LEWD_SYSTEM 3.4 節（場景的結算）、6.1 節（六四分）；COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0019 第十二節與 P59、P60。
- 可以改的路徑：`engine/src/features/curtain/`、`engine/src/features/defeat/`（只加種類 `stage` 要的一小段）、`engine/tests/features/M4-curtain-fall.test.ts`。
- 可以用的介面：M4-curtain-run 留下的（輸在哪一幕、當時的場熱）；`features/defeat` 的戰敗事件格式（`DefeatEventEntry`、`defeat.options`、三選一）、`origin.ext.defeat_event`（開戰的人指定戰敗事件，內海已經在用）；`launch` 活動 `scene` 與 `activity.end`；`director.cast`；掛點 `bill.collect`、`bill.settled`、`time.passed`；量表 `fame`、`hostility` 的效果（查不到略過）；`contentAllowed`（`contract_dom`、`blacktape`、`pc_unwilling`）；`deriveRng`；核心的 `flag`、`cred`／`cash`、`counter` 變更。
- 不可以做的事：不寫五件戰敗事件的內文（測試自帶一件最小的）；場內契約不是橋權、不進 `features/contract`；不扣線、不釘住、不加沉溺、不拿走東西；內場帶與黑帶的流通是 M5；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 戰敗事件的種類 `stage`（`defeat` 的資料多收這個值；格式不變）。這個功能在開每一場戰鬥時把 `origin.ext.defeat_event` 指到「這一幕的那一件」（規則表 `fall.events`：幕 → 戰敗事件的 id；`_plain` 的版本另一欄）。
- 規則 `curtain_rule` 多 `fall`：`tips_mult`（0.5：落幕時打賞減半）、`replay`（契合的評價換回打賞：難忘與合拍把減掉的補回來再 +0.1、普通不補、不合再 −0.1）、`sink_range`（[−2, 2]）、`fine_mult`（0.5：設備費與違約金是保證金的一半）、`tab`（`{ weekly: 0.1, cap_mult: 2 }`）、`gig`（`{ weeks: 4, shows_per_week: 1, split: 0.4, miss_hostility: 10, faction: 規則表寫的勢力 }`）、`tape`（`{ base: 0.15, raided: 0.15, in_debt: 0.15, backstage: 0.1, cap: 0.45, fame: 5, buyback_mult: 2 }`）、`events`。
- `state.ext.curtain`：`tab?: { owed, since }`、`gig?: { until, shows: Record<週, number>, missed }`、`fall?: { act, heat, tips, stage: 'replay' | 'choose', called_off?: boolean }`、`tapes: Array<{ id, leaked: boolean, bought?: boolean }>`。
- 報告：`curtain.fall`（落幕的結算）、`curtain.replay`（補演做完或喊停）、`curtain.settle`（三條路選了哪一條）、`curtain.tape`（外流、買回）。匯出：`fallView`（現在在哪一步、三條路各自的數字與能不能選）、`callOffDraft`（喊停）、`settleBlock`／`settleDraft(k, state, { how: 'pay' | 'tab' | 'gig' })`、`buybackDraft(k, state, { tape })`、`payTabDraft`。

## 要做的

1. 落幕（全隊倒下，這一趟以戰敗結束）：戰敗事件走現有的流程，種類 `stage`。這個功能在戰敗被接受時（聽 `activity.end`，認 `origin.by === 'curtain'`）：結算打賞＝照當時場熱的那一段 × `tips_mult`；保證金沒收；`fall` 進到 `replay`。「重來這場戰鬥」「回到這個階段開始時」照核心現有的（不是這個功能的事；確認這一趟的狀態跟著快照回去）。
2. 補演：戰敗事件的主線帶一場 `adult_scene`（`gate: fixed`、`nature: work`、`goal: please`、`layer: net`），對象由事件的 `cast` 生成（P59）。開場前玩家可以喊停（`callOffDraft`）：補演不演、這一場的打賞歸零、其他不扣。演完（聽 `scene` 的 `activity.end`）：照契合的評價用 `replay` 的表調整打賞；沉溺的變化夾在 `sink_range`（這一場的結算如果給了超過的，補一筆把它拉回來；往下走 `sink` 效果）。
3. 篩選（8.8 節的表）：`pc_unwilling` 不影響（本來就能喊停）；對象的性別與類型找不到可用的（事件的版本都被篩掉）或 `pure_stage`：改用規則表 `events` 的 `_plain` 那一件（沒有場景，打賞與場熱照算）。
4. 之後的三條路（`fall.stage === 'choose'`；一定要選一條才能再報名）：
   - 付清：設備費與違約金＝保證金 × `fine_mult`，當場付（不夠就不能選）。
   - 記帳：欠著，記進 `tab.owed`；每週 `bill.collect` 出一行利息（欠的 × 10%）；`owed` 到保證金 × `cap_mult` 就不能再報名（`enterBlocks` 多一條原因），直到還清（`payTabDraft`）。只是錢，不連到契約。
   - 簽檔期（`contract_dom` 關掉時不列）：四週，每週至少上一場（照樣報名、照樣走一趟；這四週裡打賞與獎金只拿四成）；哪一週沒上，`missed` +1、規則表寫的那個勢力敵對值 +10。到期自動結束。
5. 母帶：每次落幕擲一次外流（`base`；帳上有欠款 +、輸在第二幕 +、旗標 `curtain_raided` 立著 +；最多 `cap`）。外流：立旗標 `curtain_tape:<id>`、每一區的豔名 +5（有量表才加；區的清單用查得到的 `district`）、`tapes` 記一筆 `leaked`。`blacktape` 關掉時：照樣擲，擲到的結果改成「館方保管」（不加豔名、不立旗標），只能買回。買回（`buybackDraft`）：保證金 × `buyback_mult`，那一筆標成 `bought`、旗標拿掉。
6. `enterBlocks`（M4-curtain-entry 的）在這一張補三條：`fall` 還沒選路、欠款到上限、（簽了檔期時不擋，反而每週要上）。
7. 提早落幕（場熱到 0）、全員拔線都不是戰敗：不走這一張的任何一步。

## 驗收條件（`engine/tests/features/M4-curtain-fall.test.ts`；測試自帶一件種類 `stage` 的戰敗事件（主線一場場景）、它的 `_plain` 版本；和 `defeatFeature`、`sceneFeature`、`directorFeature` 一起裝；`bills`、量表用假的）

- 全隊倒下、接受結果：`fall.tips` 是當時場熱那一段的一半、保證金沒有退、主角的沉溺沒變、背包沒少東西、`fall.stage` 是 `replay`。
- 喊停：沒有場景、`fall.tips` 是 0、進到 `choose`。不喊停：開了一場 `nature` 是 `work`、`goal` 是 `please`、`layer` 是 `net` 的場景；以合拍結束之後打賞補回來再多一成；這一場結算給沉溺 +4 時實際只 +2。
- 版本全被篩掉時走 `_plain`：沒有場景、打賞照算。
- 三條路：付清扣保證金的一半；記帳之後 `bill.collect` 每週出一行 10% 的利息，欠到兩倍時報名被擋，還清之後可以；簽檔期在 `contract_dom` 關掉時不列，簽了之後這一趟的結算只拿四成，某一週沒上場假量表 +10，四週後 `gig` 沒了。沒選路之前報名被擋。
- 母帶：把骰子固定成外流：旗標在、每一區的假豔名 +5；`blacktape` 關掉時沒有旗標、沒有豔名、`tapes` 有一筆可以買回；買回扣保證金的兩倍。機率在欠款、第二幕、臨檢都成立時是 0.45 不是 0.55。
- 「重來這場戰鬥」之後 `fall` 不存在、這一趟還在那一場開打前。
- 提早落幕與全員拔線不產生 `fall`。`M1-defeat`、`M3-defeat-net` 的測試不改全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-curtain-run、M4-scene-close。

## 完成時回報

改了哪些檔、測試結果、`defeat` 加了什麼、簽檔期「四成」是怎麼套在結算上的、8.8 節「預定要寫的」五件戰敗事件各自要的效果引擎都有沒有（缺的列出來）。
