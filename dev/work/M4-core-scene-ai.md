# M4-core-scene-ai

- 交給：cpp-architect 角色（sonnet）；派工時明說可以改下面列的外殼路徑
- 目標：外殼加成人場景的六個 AI 任務（`scene_gate`、`scene_turn`、`scene_talk`、`sex_record`、`sink`、`tendency`；`relate` 已經有）與兩條任務鏈（可能進場景的行動、場景的一回合），收尾段接上。每一個任務的退路就是功能現在的規則：AI 關著時行為不變。
- 規格出處：AI_TASKS 第 1、2 節、3.5～3.8 節、4.2 節；LEWD_SYSTEM 3.1、3.3、3.4 節；PROMPTS 第 7 節（成人路由；提示詞的文字這一張只放最短的固定前段）；dev/adr/0006、0016 第二節；dev/adr/0019 第十三節；dev/invariants.md 第 33、35 條。
- 可以改的路徑：`engine/src/shell/ai/`（新檔 `sceneTasks.ts`、`sceneChains.ts`；`fakeProvider.ts` 加這六個任務的自動回應與對抗的劇本；`settings.ts` 的成人來源對照）、`engine/src/shell/game.ts`（門面多幾個入口）、`engine/src/shell/index.ts`、`engine/tests/shell/M4-scene-ai.test.ts`（或照現有外殼測試放的資料夾）、`dev/invariants.md`、dev/adr/0019（實作補記）。
- 可以用的介面：`TaskDef`、`TaskRegistry`、`runTask`（`shell/ai/tasks.ts`）、`ChainTemplate`／`ChainDef`／`ChainRegistry`（`shell/ai/chain.ts`；現有的鏈看 `freeAction.ts`、`narrated.ts`）、`ADULT_SOURCE_KEY`、假的服務商；`Game.commit`、`Game.commitNarrated`；`features/scene` 匯出的純函式（外殼可以 import 功能：`startProblems`、`sceneStart`、`sceneAct`、`sceneNext`、`sceneOptions`、`sceneView`、`sceneOf`，與 M4-scene-seats、M4-scene-close 的 `SceneEnv.moves`、`talk`、`closing`）。
- 不可以做的事：不改 `features/scene` 的規則（缺什麼回報給 cpp-architect）；AI 不決定任何數字以外的東西（開場的主動權、契合、感載、體悟都是功能算的）；不寫完整的提示詞（PROMPTS 匯入是之後的事）；任務的輸入裡不放被內容篩選關掉的性質、目的、標籤、行動；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 六個任務（AI_TASKS 4.2 節的表逐欄照做：輸入、輸出的格式、驗證、退路、模型大小都是「小」、全部走成人路由）：
   - `scene_gate`：輸出 `{ enter: boolean, nature?, goal?, reason, circles? }`。驗證：性質與目的在輸入給的清單裡；「被迫」只在輸入標了本來就是被迫時；分圈每圈最多四人、每個人只在一圈、主角一定在。退路：輸入帶「明寫的場景設定」就照它進，否則不進。
   - `scene_turn`：輸出 `{ moves: SceneInput[], line: string }`（一句 60 字以內）。驗證只做格式（行動的種類在清單裡、不能是 `stop`、`line` 的長度）；合不合規由功能在 `env.moves` 驗。退路：空的 `moves`（功能照規則走）、`line` 用功能那一步的中性描述。
   - `scene_talk`：輸出 `{ fit, goal?, agree?, reason }`。驗證與夾值：契合 −5～+10、目的 0～+20（留提醒）。退路：不給（功能照檢定）。
   - `sex_record`：輸出每一對一筆 `{ with, kind?, note }`。驗證：`with` 是在場的人、`note` 80 字以內。退路：空的。
   - `sink`：輸出 `{ kind, amount, reason }`。夾在 −4～+4；`forced` 要和性質一致。退路：不給。
   - `tendency`：輸出標籤的陣列。只能是輸入列出的。退路：輸入列出的全部。
2. 鏈 `adult_action`（AI_TASKS 3.5 節）：擲骰 → `judge` → 結算上限 → `scene_gate` → （進）建立場景並交給畫面；（不進）收尾只跑算回報與 `relate` 再寫正文。玩家在 `scene_gate` 之後可以選略過（走 `sceneSkip`）。
3. 鏈 `scene_round`（3.6 節）：玩家的行動已經由畫面交進來 →（用了說話）`scene_talk` → 同圈每個由程式控制的人各一次 `scene_turn`（依序；後一個人的輸入帶前一個人結算後的狀態）→ 把結果放進 `env` 呼叫 `sceneAct`／`sceneNext` → 套用。別的圈不跑 AI。
4. 收尾段（3.8 節）：場景結束時（玩家按停下、強制結束、略過），`reward`（有目的或交易時）、`sex_record`、`sink`、`tendency`、`relate` 同時跑，結果放進 `env.closing` 呼叫結束的那個純函式，再把定案的草稿交給 `commitNarrated`（成人路由）。五個裡任何一個失敗都走退路，不擋住結束。
5. `Game` 的入口：`sceneBegin(setup | 從鏈來的)`、`sceneStep(input)`、`sceneFinish()`；AI 關著（設定沒有 key、或設定關掉場景的 AI）時這三個入口直接呼叫功能的純函式，結果和現在介面直接呼叫的一樣。多一個設定 `sceneAi: 'off' | 'closing' | 'full'`（`closing` 只跑 `scene_gate` 與收尾，不跑每回合的兩個；預設 `closing`）。
6. 假的服務商：六個任務的自動回應（合規）與對抗的劇本各至少一個：`scene_turn` 交 `stop`、交別圈的人當對象；`sink` 交 +9；`scene_gate` 交清單外的性質；`tendency` 交沒碰到的標籤；`scene_talk` 交 +50。
7. dev/invariants.md 第 33、35 條改成「在這裡驗」，並加一條：場景的 AI 任務全部失敗時，場景照規則走完、結果和 AI 關著時相同。

## 驗收條件

- AI 關著：`sceneBegin`、`sceneStep`、`sceneFinish` 走完一場一對一，每一份報告和直接呼叫功能的逐欄相同。
- `closing` 模式、假服務商自動回應：`scene_gate` 決定進、帶性質；場景中沒有任何 `scene_turn`／`scene_talk` 的請求；結束時五個收尾任務各一個請求、彼此不依賴（探針看得到同時排進去）、正文在它們之後；`env.closing` 的值進了結算。
- `full` 模式、三個人的一圈：每回合兩個 `scene_turn`（各一個人）；第二個的輸入帶第一個人做完之後的感載。
- 對抗的六個劇本：每一個都被驗證擋下或被功能丟掉，自動重試之後走退路，場景沒有卡住；沉溺沒有超過 ±4；被篩選關掉的性質不會出現在任何一個請求的輸入裡（掃請求的文字）。
- 任務鏈列（`ChainRun` 的紀錄）看得到每一步的狀態；`scene_gate` 之後選略過走得通。
- 存檔在場景中途讀回來，`sceneStep` 接得下去。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；現有的外殼測試不改全過。

## 依賴

M4-scene-close。核心的工單彼此不要同時做。

## 完成時回報

改了哪些檔、測試結果、`features/scene` 缺的接口（要 cpp-architect 補的）、一場十回合的三人場景在 `full` 模式會發幾個請求（給使用者看成本）。
