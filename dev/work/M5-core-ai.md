# M5-core-ai

- 交給：cpp-architect 角色（sonnet；**改的是核心與外殼**，可以改 `engine/src/core/action/`、`engine/src/core/kernel.ts`、`engine/src/core/types/report.ts`、`engine/src/shell/`）　（**第三波**）
- 目標：兩個通用的接縫，讓功能不碰外殼也能用 AI 做兩件事：**判讀**（把玩家的一段文字判成功能宣告的封閉清單裡的值）與**文字槽**（把功能狀態裡一段程式寫的字，在背景換成 AI 寫的）。這一張只做機制與外殼的通用任務；哪些入口用它在下一張（M5-ai-media）。
- 規格出處：dev/adr/0020 第十一節；AI_TASKS 第 1 節（原則：AI 只交結構化的結果、程式驗證）、2.4～2.6 節（重試、驗證與夾值、逾時與退路）、3.21、3.22 節、4.3 節（`pr_move`）、4.5 節（`stream_goal`、`stream_chat`、`footage_caption`：輸入、輸出、驗證、退路的寫法）、第 8 節；MEDIA 1.3 節（自訂輸入：「判定只能落在封閉的清單裡」「AI 寫彈幕與開場白，不給任何數字」）、第 3 節最後一條（剪輯的自由行動）、13.1 節；dev/adr/0006（AI 任務的管線）、0016 第二節（報告上的代辦）；dev/test-harness.md 第 3 節（假的服務商）。
- 可以改的路徑：`engine/src/core/action/`（新增 `intents.ts`、`texts.ts`）、`engine/src/core/kernel.ts`、`engine/src/core/index.ts`、`engine/src/core/types/report.ts`（`Report.texts`）、`engine/src/shell/game.ts`、`engine/src/shell/ai/`（新增任務、設定的鍵、假的服務商認得這兩種任務）、`engine/tests/core/ai-m5.test.ts`、dev/invariants.md、dev/test-harness.md。
- 可以用的介面：`TaskRegistry`、`runTask`、`ProviderHub`、`AiSettings`、假的服務商（劇本、自動、十種對抗）；M4 在外殼加的幾樣（`shell/ai/tasks.ts`、`sceneTasks.ts`、`people.ts`）：`TaskDef.adult`、`TaskDef.retries`、`RunTaskOpts.softFail`、`TaskCtx.adult`、每個任務固定前段的 `worldRulesText()`、組人物資料的 `personFor`／`callsFor`；`Game.commit`（不進回退步數的提交照 `turn: false` 的做法）；`ActivityRegistry` 的寫法當登錄表的範本。
- 不可以做的事：不替任何功能宣告判讀或文字槽（那是下一張）；兩個接縫都不能改任何數字——判讀只回「清單裡的值」，文字槽只回字串；AI 關著、逾時、被拒絕、驗證不過，一律走功能給的退路，玩家看不出差別以外的任何異常；不讓背景的任務擋住玩家的操作或改變亂數的游標；共同的規定見 dev/work/M5-plan.md。

## 新的型別與鍵

- **判讀**（`k.intents`，L5）：
  ```ts
  interface IntentDef {
    id: string; owner: string
    describe: string                                   // 給 AI 的一句說明：這是在判什麼
    fields(state, ctx): Record<string, { name: string; from: Array<{ id: string; name: string; hint?: string }>; min: number; max: number }>
    fallback(state, ctx): Record<string, string[]>     // AI 不可用時的值
    adult?(state, ctx): boolean                        // 這一次要不要走成人路由（沒寫是 false）
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
    adult?(state, ref): boolean                                           // 這一格要不要走成人路由（例：親密類素材的標題、成人直播的彈幕）
    apply(state, ref, out: Record<string, string | string[]>): Change[]   // 只能回改自己那一格文字的變更
  }
  ```
  報告的代辦：`Report.texts?: Array<{ slot: string; ref: string }>`（功能在自己的草稿上寫）。另有一個不經報告的入口 `Game.fillTexts(slot, refs)`（給「純函式的畫面」用：畫面打開時請外殼替還沒有字的那幾格跑一次；規矩和報告的代辦一樣）。外殼在那一份提交成功之後，AI 開著而且這一槽沒有被設定關掉時，背景跑通用的任務；回來之後呼叫 `apply` 拿變更，用一份 `system` 的報告（`action: 'text.fill'`）提交：不進回退步數、不推進亂數、不帶觸發點、不算一個回合。那一刻被活動擋下或那一格不在了（`input` 回 `null`）就丟掉。
- 外殼的兩個通用任務（`shell/ai/`）：`intent`（輸入：說明、每一欄的清單與數量、玩家的文字——**原樣**放進一個標籤（例 `<request>`），不篩選、不改寫、不加提示，和 M4 的寫法指令、訂做的描述同一條規矩；輸出：`{ picks }`；驗證用 `k.intents.check`；`retries: 1`（重試帶錯誤一次）；退路是 `fallback`）、`text`（輸入：說明、上下文、每一欄的上限、可以出現的名字；輸出：每一欄的字串或字串陣列；驗證：長度、句數、不含清單以外的具名角色——照 AI_TASKS 4.5 的寫法；退路是不寫回，原本的字留著）。
- 設定：`AiSettings` 多兩個**選填**欄位 `intents?: Record<id, boolean>`、`texts?: Record<id, boolean>`，不放進 `DEFAULT_AI_SETTINGS`（`tests/core/settings.test.ts` 把預設物件的鍵鎖在 cpp-ai-v1 的形狀上；和 M4 的 `sceneAi`、`partAi` 同一個處理），用 `intentOn(settings, id)`、`textOn(settings, id)` 讀（沒寫當開），`sanitizeAiSettings` 收布林與 0／1、壞值當沒寫。現有的 `bg_stream_goal`、`bg_stream_chat`、`bg_footage_caption` 當成同名文字槽（`stream_goal`、`stream_chat`、`footage_caption`）的開關。任務的來源照 `DEFAULT_TASK_SOURCE` 加兩筆（都用便宜的小模型）；`adult` 回 `true` 的那一次走成人路由（`TaskCtx.adult`），沒有成人來源時走退路。

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
- 被服務商拒絕：判讀回退路、文字槽不寫回，都不停下來等玩家、不留 `paused` 的鏈（一般任務被拒絕是停下來，這兩種用 `softFail`）。
- `adult` 回 `true` 的文字槽走成人來源（假的服務商記下它被叫的是哪一條路由）；沒有成人來源時不發請求。
- 預設的設定物件的鍵和這一張之前一樣（`tests/core/settings.test.ts` 原樣全過）；存檔裡沒有 `intents`、`texts` 的舊設定讀進來當全開。
- 現有的任務鏈、`commitNarrated`、種子重播的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## M4 對帳（2026-11-26）

M4 的三張外殼工單（M4-core-scene-ai、M4-followups-2、M4-core-part-ai）先做完了，這一張要照它們留下的慣例寫：

- **失敗不擋人**：兩個通用任務都是「`onExhausted: 'fallback'` 加 `softFail`」——逾時、格式錯、驗證錯用盡重試走退路，被服務商拒絕也走退路。背景的文字槽連任務鏈列都不佔（它不是一條前景的鏈）。
- **固定前段**：`system` 的最後接 `worldRulesText()`（世界的固定規則 H5、H16、H17；玩家之後在 AI 工坊改的是那個常數，這一張不加設定）。`shell/ai/sceneTasks.ts` 那個常數上面的註解寫「AI 工坊（M5）」是舊的：AI 工坊接上引擎在 M7（MIGRATION 第 6 節），順手把那一行註解改掉。
- **玩家的字原樣交出去**：判讀收的文字、文字槽的上下文裡玩家自己寫的字（片的標題與簡介、稱呼、化身描述）都不篩選、不改寫、不提示；不合服務商規範的由服務商擋，擋了就是上面的退路。
- **人物的資料**：文字槽的上下文要提到人時，用 `shell/ai/people.ts` 的 `personFor`（它已經帶稱呼與化身描述），`names`（可以出現的名字）含稱呼。
- **SillyTavern 預設**（PROMPTS 2.6，2026-11-26 寫進設計書）只套寫正文，不套這兩種任務。
- **`design_part` 不併**（0020 V67）：M4 的交貨是一條前景的鏈（名字在交貨那一刻就寫進成品），使用者 2026-11-26 定了「AI 交貨時不鎖畫面、維持任務鏈列」；改成背景的文字槽會讓零件的名字在收下之後才變。這一張只要確保文字槽的格式做得到「一格多欄、各欄各驗」（`limits` 的每一欄各自過或不過；有一欄不過時整格不寫回），之後真要併不用再改核心。
- **M4 留下、等這一張的兩格文字**（拍賣的鑑定書與主持人的口白，M4-plan「第五波留給 M5 的」）：宣告在 M5-ai-media 的第 6 項，這一張不做。
- `Report.texts` 是報告上新的一種代辦：和 0016 的 `launch`、`rewind`、`triggers` 一樣由外殼在提交之後處理，功能只寫資料；`commit` 的 `turn: false`（不進回退步數）沿用現有的寫法。

## 完成時回報

改了哪些檔、測試結果、「不能動數字」的檢查實際怎麼做的與它的成本、ADR 做不到的地方、給 M5-ai-media 的用法（一個判讀與一個文字槽的最小例子）。

## media-chain 留下的（2026-11-26，順手做）
- `ReportRewind`／`rewind.keep` 加選填 `reason`（撤退 `retreat`、失敗 `fail`），各自填。媒體現在讀報告文字分辨撤退（`features/media/record.ts` 的 `onRewind`），改完換成讀 `reason`，一行。

## live 留下的（2026-11-26，核心的小補，順手做）
- `ActivityEndReturn` 多選填 `beats?: TimelineBeat[]`，`endActivity` 併進結束報告的 timeline（宿主結束時收播要有 `live.end` 那一拍）。
- `undoSteps(n)` n > 1 時每一步都問 `denied`（現在只問現在的狀態，一次回退多步能越過直播中）。
- `RecordHint` 多 `quality?: number`，media 的 `qualityParts` 多一項（live 的 `live_record_quality` 才有效果）。
- （opinion-face）media 的 `rewind.keep`（`features/media/record.ts` 的 `onRewind`）用 `...now` 保留素材庫，重來一場時用掉的次數回不來；把快照那一刻已存在的素材與片的 `uses` 換回 `before` 的。
