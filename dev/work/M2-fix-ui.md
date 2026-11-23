# M2-fix-ui（cpp-ui，sonnet）

依據：dev/reviews/2026-11-23-M2-ui.md（介面審查）；M2-fix-review 引擎修正批回報裡「ui 要跟著改」的項目（等那批做完再開工）。

## 要修

- **P1（必修）**：`stores/engine.ts` 的佇列不收被引擎擋下的草稿（只留 `i > 0`）；開新局、讀檔、回退、undo、重來戰鬥、回到階段開始都清空佇列；計程車抵達在放行時照當下狀態重做草稿。補測試：被擋的結帳之後不會生效；事件開著時被擋的抵達，選完事件後人不會被搬過去。
- **S1**：事件選項開了戰鬥時全域換到 /combat（照 App.vue 成人場景的做法）。
- **S2**：帳單「剛結算」的判斷不要靠報告 id 往回找（每局從 r1 起算）；改用這一步提交新產生的報告，或引擎的週次。測 App.vue 那段邏輯。
- **S3**：`rulesFromUi` 把 `fastTravel`、`rosterDeath` 交給引擎；測試從設定走一遍。
- **S4**：開局晾衣場的預設動作不要是示範場景；`ui.demo_scene` 只在 `#/scene?scene=` 的示範入口可用，不要每次進去都補道具。
- **S5**：`FixerDialog` 的人情改讀引擎的 favors。
- **S6**：主畫面的小隊讀引擎的隊伍與生命值。
- **S7**：狀態列的敵對值讀引擎的量表。
- **S8**：主畫面「休息」與家園臥室「睡一覺」改走引擎的 rest。
- **S9**：`favorName` 查不到時回 undefined，勢力人情顯示名字。
- **A1～A5**：召集上限讀引擎規則；押金不要在 store 重算；沒有委託時委託條不亮踩點；追蹤度刻度讀引擎；拿掉和引擎矛盾的假待處理事件。
- 引擎修正批回報的 ui 跟改項目（rest 句子、建角名冊、npc 可覆寫後 `demoCoreWithoutPeople` 可以拿掉等）。

## 驗收

- ui 的 npm test 全過、vue-tsc 與 npm run build 通過；每一條有測試（畫面的用 Playwright 看過）。不改 engine/，不 commit。

## 引擎修正批之後要跟著改（M2-fix-review 回報）

- 5 個壞掉的測試（建角後名冊帶出身夥伴）：`src/stores/engine.whitebox.test.ts:163`（改用 action 過濾）、`src/stores/repro.test.ts` 的 `ui-undo-ledger-steps`（logCount 照新數字）、`tests/people/M2-ui-people.test.ts` 招募／名冊滿／成員三條（把出身名冊算進去或用沒有出身名冊的 origin）。
- 拿掉 `demoCoreWithoutPeople`（npc 已可覆寫）；示範局的開局名冊改由建角的出身名冊來（示範局沒有主角時保留現在做法）。
- 「今天聊過了」改讀 `interactions` 每列的 `note`；`knowFactText` 直接 import。
- 睡覺、喘口氣的結果句子已不帶數字，`failText` 的權宜提示可拿掉。
- `trade_rule` 的 `hostility_markup_at`/`hostility_markup` 換成 `hostility_markups`（若 ui 有讀）。
- 車上事件開打或開場景後人在下一站：畫面換到戰鬥／場景並在結束後顯示新的位置。
- 中間人的 `backer`：示意包的兩位中間人補上後台勢力。
