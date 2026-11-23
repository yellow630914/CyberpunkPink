# M2-core-fix1

- 交給：cpp-architect 角色（sonnet；**改的是核心與外殼**，順手改了 npcs、trade、roster 的對應用法）
- 目標：補 M2 開工以來功能層繞過去的核心缺口：自由行動的鏈在場上有 NPC 時不再丟錯、報告帶行動的輸入、行動種類自己給退路、核心的 `item` 變更能拿指名的那一件，並把各功能的繞道換成正式的介面。
- 規格出處：dev/adr/0016（第二節、第七節與實作補記）；AI_TASKS 3.1 節（自由行動的鏈）、4.1 節（reward、relate 的退路）、2.5 節（上限）；dev/status.md 的「核心小修待辦」。
- 可以改的路徑：`engine/src/core/`（action、state、types）、`engine/src/shell/`、`engine/src/features/actions|npcs|trade|roster`、對應的測試、dev/adr/0016、dev/invariants.md。
- 不可以做的事：不寫 relate 的 AI 那一半；不改別的功能的內容；不 commit。

## 要做的（驗收測試都已經在；`engine/tests/core/M2-core-fix1.test.ts` 是核心的，功能的在各自的測試檔）

1. **算關係（relate）**：外殼註冊 `relate` 任務，退路什麼都不記；自由行動與戰鬥結束的鏈在 `cast_present` 成立時這一步走退路（狀態 `fallback`），不丟錯，也不向服務商發請求（AI 那一半等關係的記憶有地方存再做）。選「註冊任務」而不是「任務沒註冊就當不在場」：AI_TASKS 4.1 的 relate 本來就是一個任務、退路是「一般的鏈不變」，而且任務鏈列看得到這一步。
2. **報告帶行動的輸入**：`Report.args`（整份 `ActionInput`，型別搬到 L0）。`buildActionReport` 寫它；`report.before`／`report.after` 掛鉤從它讀對象、物品、店。npcs 互動與 roster 招募的 `〔…〕` 文字標記拿掉。
3. **行動種類的退路**：`ActionKindDef.fallback(ctx)`（`ctx` 是 `HintCtx` 加 `hint`）。算回報的退路（AI 關著、用規則代替、AI 試完沒過）改用它，內建的來源（不受 AI 上限管）；沒寫就照舊「參考範圍的一半」。結果進 `narration.results`。npcs 的 6.1 節表改成它；表的結果同時放進給 AI 的參考範圍（`hint`）。
4. **features/actions 的 `check()`**：寫了 `owner` 的那一筆不驗參考範圍（基本功與條件照驗）；npcs 的替身檢查改成在存檔裡放一個 `npc_probe` 角色，`$target` 換成它，量表的鍵也驗得過，不必再把量表的效果濾掉。
5. **`item` 變更**：拿走時 `data: { uid }` 指名那一件（背包裡 `id` 與 `data.uid` 都對得上的那一疊）；找不到、不夠整份不收。trade：`CartLine.uid`、`sellBlock(…, uid?)`、`SellRow.uid`，有記號的成品與零件指名就賣得了。
6. **算回報只照規則**：`ActionKindDef.rewardByRules`（要有 `fallback`；註冊時檢查）。這一步不問 AI，固定走 `fallback`，`degree` 是判定夾過之後的。選這個而不是把 `degree` 放進 `EffectCtx`：放進去只能保證 AI 交的 degree 對，AI 漏交整筆效果還是沒有；殺價的結果完全由表決定，AI 沒有東西可以補。trade 的 bargain 改用它（拿掉 `hint`）。
7. **起手變更**（做第 3 點時發現需要的）：`ActionKindDef.prelude(state, input)`。算回報驗證用的狀態先套上它、報告把它排在最前面。npcs 互動用它「先認識對象」：生成的路人要認識（`meet`，進角色表）之後，親密度的量表才有鍵（M2-npcs 規定「還沒 meet 的生成人沒有量表可以動」，所以不能放寬量表的鍵檢查）。

## 完成時回報

改了哪些檔、測試結果、AI 開著時 npcs 互動的行為變化（見 ADR 0016 補記）、roster 與 trade 沒有動到的地方。
