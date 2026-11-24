# M5-core-ai

- 交給：cpp-architect 角色（sonnet；**改的是核心與外殼**，可以改 `engine/src/core/action/`、`engine/src/core/kernel.ts`、`engine/src/core/types/report.ts`、`engine/src/shell/`）　（**第三波**）
- 目標：兩個通用的接縫，讓功能不碰外殼也能用 AI 做兩件事：**判讀**（把玩家的一段文字判成功能宣告的封閉清單裡的值）與**文字槽**（把功能狀態裡一段程式寫的字，在背景換成 AI 寫的）。這一張只做機制與外殼的通用任務；哪些入口用它在下一張（M5-ai-media）。
- 規格出處：dev/adr/0020 第十一節；AI_TASKS 第 1 節（原則：AI 只交結構化的結果、程式驗證）、2.4～2.6 節（重試、驗證與夾值、逾時與退路）、3.21、3.22 節、4.3 節（`pr_move`）、4.5 節（`stream_goal`、`stream_chat`、`footage_caption`：輸入、輸出、驗證、退路的寫法）、第 8 節；MEDIA 1.3 節（自訂輸入：「判定只能落在封閉的清單裡」「AI 寫彈幕與開場白，不給任何數字」）、第 3 節最後一條（剪輯的自由行動）、13.1 節；dev/adr/0006（AI 任務的管線）、0016 第二節（報告上的代辦）；dev/test-harness.md 第 3 節（假的服務商）。
- 可以改的路徑：`engine/src/core/action/`（新增 `intents.ts`、`texts.ts`）、`engine/src/core/kernel.ts`、`engine/src/core/index.ts`、`engine/src/core/types/report.ts`（`Report.texts`）、`engine/src/shell/game.ts`、`engine/src/shell/ai/`（新增任務、設定的鍵、假的服務商認得這兩種任務）、`engine/tests/core/ai-m5.test.ts`、dev/invariants.md、dev/test-harness.md。
- 可以用的介面：`TaskRegistry`、`runTask`、`ProviderHub`、`AiSettings`、假的服務商（劇本、自動、十種對抗）；`Game.commit`（不進回退步數的提交照 `turn: false` 的做法）；`ActivityRegistry` 的寫法當登錄表的範本。
- 不可以做的事：不替任何功能宣告判讀或文字槽（那是下一張）；兩個接縫都不能改任何數字——判讀只回「清單裡的值」，文字槽只回字串；AI 關著、逾時、被拒絕、驗證不過，一律走功能給的退路，玩家看不出差別以外的任何異常；不讓背景的任務擋住玩家的操作或改變亂數的游標；共同的規定見 dev/work/M5-plan.md。

## 新的型別與鍵

- **判讀**（`k.intents`，L5）：
  ```ts
  interface IntentDef {
    id: string; owner: string
    describe: string                                   // 給 AI 的一句說明：這是在判什麼
    fields(state, ctx): Record<string, { name: string; from: Array<{ id: string; name: string; hint?: string }>; min: number; max: number }>
    fallback(state, ctx): Record<string, string[]>     // AI 不可用時的值
  }
  k.intents.define(def); k.intents.get(id); k.intents.list()
  k.intents.check(def, state, ctx, raw): { picks: Record<string, string[]>; problems: string[] }   // 純函式：每個值都要在那一欄的清單裡、數量在 min～max
  ```
  外殼：`Game.readIntent(id, text, ctx?): Promise<{ picks: Record<string, string[]>; source: 'ai' | 'fallback'; problems?: string[] }>`。不改狀態、不提交任何東西；功能的入口照常收 `picks`（例：時段直播的 `plan`）。
- **文字槽**（`k.texts`，L5）：
  ```ts
  interface TextSlotDef {
    id: string; owner: string
    describe: string
    limits: Record<string, { max: number; lines?: [number, number] }>     // 每一欄的字數上限；lines 是「幾句」的範圍（彈幕）
    input(state, ref): { context: Record<string, unknown>; names: string[] } | null   // null：這一格已經不在了，不用寫
    apply(state, ref, out: Record<string, string | string[]>): Change[]   // 只能回改自己那一格文字的變更
  }
  ```
  報告的代辦：`Report.texts?: Array<{ slot: string; ref: string }>`（功能在自己的草稿上寫）。另有一個不經報告的入口 `Game.fillTexts(slot, refs)`（給「純函式的畫面」用：畫面打開時請外殼替還沒有字的那幾格跑一次；規矩和報告的代辦一樣）。外殼在那一份提交成功之後，AI 開著而且這一槽沒有被設定關掉時，背景跑通用的任務；回來之後呼叫 `apply` 拿變更，用一份 `system` 的報告（`action: 'text.fill'`）提交：不進回退步數、不推進亂數、不帶觸發點、不算一個回合。那一刻被活動擋下或那一格不在了（`input` 回 `null`）就丟掉。
- 外殼的兩個通用任務（`shell/ai/`）：`intent`（輸入：說明、每一欄的清單與數量、玩家的文字；輸出：`{ picks }`；驗證用 `k.intents.check`；重試帶錯誤一次；退路是 `fallback`）、`text`（輸入：說明、上下文、每一欄的上限、可以出現的名字；輸出：每一欄的字串或字串陣列；驗證：長度、句數、不含清單以外的具名角色——照 AI_TASKS 4.5 的寫法；退路是不寫回，原本的字留著）。
- 設定：`AiSettings` 多 `intents: Record<id, boolean>`、`texts: Record<id, boolean>`（沒寫當開）；現有的 `bg_stream_goal`、`bg_stream_chat`、`bg_footage_caption` 當成同名文字槽（`stream_goal`、`stream_chat`、`footage_caption`）的開關。任務的來源照 `DEFAULT_TASK_SOURCE` 加兩筆（都用便宜的小模型）。

## 要做的

1. 兩張登錄表掛在 kernel 上（`createKernel`），重複的 id 丟錯，探針記 `registry.register`。
2. `Game.readIntent`：AI 關著或這個判讀被關掉 → 直接回 `fallback`；開著 → 跑任務，結果經 `check`；有問題重試一次、還有就退路。逾時與拒絕照現有管線。它是唯讀的：呼叫前後狀態逐位元組相同。
3. 文字槽的背景執行：同一槽同一格同時只跑一個（後來的蓋掉排隊的）；`apply` 回來的變更由外殼再驗一次——**只收 `ext`、`actor.ext`、`narration` 這三種變更，而且不能動任何數字的欄位**（做法：套用前後，把狀態裡所有的數字與布林攤平比對，除了流水號以外一個都不能變；變了整份丟掉並記探針）。回退與讀檔時丟掉還在跑的。
4. 種子重播：背景的填字不影響重播（重播時 AI 是假的服務商的固定劇本；`text.fill` 的報告在比對時照 `system` 類的規則處理：dev/test-harness.md 第 4 節補一句）。
5. 假的服務商認得 `intent` 與 `text` 兩種任務（自動模式：`intent` 回每一欄清單的第一個、`text` 回固定的字）；十種對抗各至少一個測試：壞 JSON、清單以外的值、超過數量、超長、多的欄位、拒絕、逾時、夾帶數字欄位（文字槽）。
6. dev/invariants.md 加：判讀唯讀、只回清單裡的值；文字槽的提交不改任何數字、不進回退、不推亂數；兩者 AI 關著時行為與退路一致。

## 驗收條件（`engine/tests/core/ai-m5.test.ts`；用玩具功能宣告一個判讀（兩欄）與一個文字槽）

- 判讀：假的服務商回清單裡的值 → `source: 'ai'`；回清單以外的值 → 重試一次、再錯走退路、`problems` 有那一條；AI 關著直接退路；呼叫前後狀態相同。
- 清單照狀態算：同一個判讀在兩個狀態下收的值不一樣。
- 文字槽：提交帶 `texts` 的報告 → 之後多一份 `text.fill`、那一格的字換了；回退步數的堆疊沒有多一步；亂數的游標沒變；`reports` 裡它是 `system`。
- `apply` 偷改一個數字（玩具功能故意寫壞）→ 整份丟掉、狀態沒變、探針有紀錄。
- `Game.fillTexts` 對兩格各跑一次、各一份 `text.fill`；同一格連叫兩次只跑一次。
- AI 關著：沒有 `text.fill`、原本的字留著。背景任務還沒回來就讀檔：回來之後什麼都不發生。
- 超長的字被擋（不是截斷）並走退路；名字不在清單裡被擋。
- 設定把這一槽關掉：不發請求。
- 十種對抗至少八種有測試。
- 現有的任務鏈、`commitNarrated`、種子重播的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 完成時回報

改了哪些檔、測試結果、「不能動數字」的檢查實際怎麼做的與它的成本、ADR 做不到的地方、給 M5-ai-media 的用法（一個判讀與一個文字槽的最小例子）。
