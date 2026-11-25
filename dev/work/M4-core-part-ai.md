# M4-core-part-ai

- 交給：cpp-architect 角色（sonnet）；派工時明說可以改下面列的外殼路徑　（**第五波**）
- 目標：外殼加 AI 任務 `design_part` 與任務鏈 `part_unreg`：替一件等著交貨的未登錄零件起名字、寫一句說明、把怪癖寫成一件具體的事，引擎驗過才交貨；AI 關著、失敗、被擋時從預設清單給，數字完全相同。
- 規格出處：AI_TASKS 第 1、2 節、3.20 節、4.4 節表裡 `design_part` 那一列；PROMPTS 5.8 節 `design_part`（規則的五條當固定前段的依據；完整的提示詞與注入配方是之後匯入的事）；CRAFTING 11.1 節（AI 那一列與驗證那一列、「AI 關著時」）；dev/adr/0006、0016 第二節；dev/adr/0019 第十七節與 P71、P74；dev/test-harness.md 第 3 節。
- 可以改的路徑：`engine/src/shell/ai/`（新檔 `partTask.ts`、`partChain.ts`；`fakeProvider.ts` 加這個任務的自動回應與對抗的劇本；`settings.ts` 多一個開關與任務的來源）、`engine/src/shell/game.ts`（門面多一個入口）、`engine/src/shell/index.ts`、`engine/tests/core/M4-part-ai.test.ts`、`dev/invariants.md`、`dev/test-harness.md`（第 3 節補一句）、dev/adr/0019（實作補記）。
- 可以用的介面：`TaskDef`、`TaskRegistry`、`runTask`（`shell/ai/tasks.ts`）、`ChainTemplate`、`ChainRegistry`（`shell/ai/chain.ts`；現有的鏈看 `freeAction.ts`、`narrated.ts`）、`Game.commit`、`Game.commitNarrated`、`DEFAULT_TASK_SOURCE`、假的服務商（`goodReply`、`adversarial`）；`features/unreg` 匯出的純函式（外殼可以 import 功能）：`pendingParts`、`readyParts`、`frameView`、`textProblems`、`deliverBlock`、`deliverDraft`。
- 不可以做的事：不改 `features/unreg` 的規則（缺什麼回報給 cpp-architect）；AI 的輸出只有三段文字，任何數字、類型、等級、牌子都不收（多的欄位算驗證失敗）；不在提交之後自動替玩家交貨（交貨是一個明確的入口，由介面或測試呼叫，種子重播才對得上）；不寫完整的提示詞；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 任務 `design_part`（`size: 'M'`、`output: 'json'`、`onExhausted: 'fallback'`、一般路由）：
   - 輸入：`frameView` 的內容（`<frame>`：類型、材質、等級、牌子、每一條屬性、怪癖的種類；`<request>`：玩家的描述，沒有就不放；`<data>`：同類同級的名字樣本）。固定前段放 PROMPTS 5.8 節那五條的最短版本。
   - 輸出的格式（`submit_part`）：`{ name: string, desc: string, quirk: string }`。
   - 驗證：只呼叫 `textProblems`（規則都在功能裡，外殼不另外寫一份）；錯誤原樣當 `errors` 帶回去重試。這個任務的自動重試固定最多 2 次（CRAFTING 11.1 節），不看設定的重試次數。
   - 退路：回 `null`（代表「用預設清單的文字」）。
2. 鏈 `part_unreg`（AI_TASKS 3.20 節的六步；第 1 步的框架在 `pending` 裡已經定好，第 2 步的擲骰這一批沒有，見 0019 P71）：`code`（讀 `frameView`；那一筆不在或 `deliverBlock` 有原因就整條不成立，原因照給）→ `ai`（`design_part`）→ `code`（組 `deliverDraft(k, state, { id, text })`；文字是 `null` 就不帶 `text`）→ 寫正文（`narrate`，短篇；走現有 `narrated` 那一段的做法）→ `apply`。任務鏈列看得到每一步。
3. `Game.unregDeliver(id): Promise<ActResult>`：AI 開著而且 `partAi` 沒關 → 跑這條鏈；否則直接 `commit(deliverDraft(k, state, { id }))`。被進行中的活動擋住時丟 `ActionBlocked`（原因照活動的）；那一筆 `pending` 留著，之後再呼叫。同一筆同時只跑一條；回退或讀檔時丟掉還在跑的（`pending` 還在，再叫一次就好）。
4. 設定：`AiSettings` 多 `partAi: boolean`（預設開）；`DEFAULT_TASK_SOURCE` 加 `design_part`（用主力）。
5. 假的服務商：自動回應（合規：名字「測試件」加流水號的國字、說明與怪癖各一句、沒有數字）；對抗的劇本至少六個：壞 JSON、名字帶數字、名字和內容裡的零件同名、說明超長、多一個 `stats` 欄位、拒絕。
6. dev/invariants.md 加三條：未登錄零件的數字只出自框架，AI 的輸出只有三段文字；AI 關著、失敗、被擋時交到手上的那一件，除了三段文字以外和 AI 成功時逐欄相同；交貨不推進存檔亂數的游標。dev/test-harness.md 第 3 節補 `design_part` 的自動回應。

## 驗收條件（`engine/tests/core/M4-part-ai.test.ts`；資料用 M4-part-unreg 測試的那一組）

- AI 關著：`unregDeliver` 之後背包多一件、名字是預設清單的；任務鏈沒有請求。
- 假服務商自動回應：名字是 AI 給的；`stats`、`affinity`、`price`、`grade`、`quirk` 和 AI 關著的那一次逐欄相同；有一段正文。
- 六個對抗的劇本：每一個都重試不超過 2 次之後走退路，零件照樣交到手上、名字是預設清單的、狀態裡沒有任何來自 AI 的數字；多的 `stats` 欄位沒有進到零件。
- `partAi` 關掉：不發請求。事件視窗開著時呼叫被擋、`pending` 還在；事件結束之後再叫一次成功。
- 訂做的那一筆（`hold: 'order'`）時間沒到時被擋、原因是功能的那一句。
- 交貨前後存檔亂數的游標相同；同一個存檔交貨兩次（讀檔重來）拿到的數字相同。
- 現有的任務鏈、`commitNarrated`、種子重播的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-part-unreg、M4-part-sources。核心的工單彼此不要同時做（M4-smoke）。

## 完成時回報

改了哪些檔、測試結果、`features/unreg` 缺的接口、這個任務一次請求大約多少字（給使用者看成本）、M5 的文字槽（M5-core-ai）做完之後這條鏈要不要改成一格文字槽的建議。

- 總指揮補記（2026-11-25）：順便做二手零件狀態進成品（`ProductData.part_states?`），見 M4-followups「M4-craft-salvage 回報」。
