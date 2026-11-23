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
