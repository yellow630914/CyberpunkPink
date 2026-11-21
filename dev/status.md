# 進度（cpp-lead 維護）

## 現在
- 批次：M0（MIGRATION 第 6 節）。範圍：A 全部；D 的 `actions`、`effects`；敘事與狀態；B 的 `character`、`perks`；測試基礎建設（dev/test-harness.md）；接上 ui/ 的主畫面與建角。
- AI：照任務拆開，先接假的服務商；設定裡填了 key 才走真的。

## 決定
- 2026-11-21：引擎放 `engine/`，純 TypeScript、不依賴 Vue；`ui/` 的 store 包住引擎。
- 2026-11-21：ElondiaRPG 唯讀當參考（/home/user/yellow630914/elondiarpg）。
- 2026-11-21：工作流裝在 repo（.claude/ 與 dev/），不裝在 ~/.claude/（雲端容器會回收）。
- 2026-11-21（給 M1）：戰鬥以第四版的 `ui/src/lib/combat/` 當底搬進引擎，搬的時候逐條對照 COMBAT_SYSTEM（第四版只抽查過）；ElondiaRPG 只參考骨架。
- 2026-11-21：「破壞」「滅火」兩件委託打不贏的問題交給平衡的 session（分支 claude/balance-commissions），引擎不先動數字。

## 紀錄
- 2026-11-21（cpp-architect）：M0 的核心與測試基礎建設做完。
  - `engine/` 的骨架與建置（vitest、typescript、fast-check）；分層照 CODESCAN 第 3 節，對照在 `.claude/cpp/project.json` 的 `layers`。
  - L0～L5：型別、亂數、時間與時段、錢、清理函式、內容登錄表與覆蓋、變更的登錄表與提交報告（掛鉤版）、探針、檢定、衍生數值與檢定修正、效果與條件的登錄表、存檔規則、行動的三段式、回合流程。
  - L7：AI 任務的管線（排隊、逾時、重試帶錯誤、退路）、任務鏈的引擎、自由行動的鏈（judge、reward、narrate、polish）、假的服務商（劇本、自動、十種對抗）、AI 設定（`cpp-ai-v1` 的形狀）、存檔與讀檔（遷移的掛點）、回退、遊戲的門面 `Game`。
  - 測試基礎建設：狀態工廠、探針與不變式檢查、種子重播、分層檢查。主套件 13 個檔、124 個測試全過；冒煙主幹（核心版）在 `engine/tests/smoke/m0.test.ts`。
  - 工單六張（`dev/work/M0-*.md`），各附驗收測試（`engine/tests/pending/`、`ui/tests/pending/`），現在照預期失敗。建議的順序：M0-data → M0-character、M0-perks（可以同時）→ M0-creation → M0-actions（隨時可以）→ M0-ui-engine。
  - ADR 六份（`dev/adr/0001`～`0006`）；不變式改寫成 35 條並標出哪裡驗。
  - 還沒做的（不在這一批的範圍或刻意延後）：真的服務商、Agent 模式與工具調用、`relate` 與 `flavor_roster` 兩個任務、報告的 JSON Schema（`engine/schemas/`，現在只有 TypeScript 的型別）、繁簡轉換、紀錄封存、世界包的匯入匯出畫面、戰鬥等具名情境的狀態工廠。

- 2026-11-21（lead）：M0-data、M0-actions、M0-character、M0-perks、M0-creation 做完；引擎主套件 20 個檔、198 個測試全過，M0 的冒煙（功能版）通過。
- 待 cpp-architect 下次處理：`CreationDraft` 加私處外觀的正式欄位（CHARACTER 第 1 步；目前只能塞在 `look` 的鍵裡；欄位名定為 `look.private`，DATA 第 8 節）；基本功單項上限調到 6 時出身 +1 夾在 6（2026-11-21 使用者確認，寫在 CHARACTER 第 1 節第 4 步）。
- 2026-11-21（docs）：ADR 0003 第 6 點與 ADR 0004 的十三項照建議定案寫回設計書；id 表（DATA 1.1 節）與行動種類表（AI_TASKS 3.1 節）是草稿，等使用者看。各項的狀態在 ADR 0004 的表。
- 2026-11-21（lead）：M0-ui-engine 做完：介面的建角（第 1～4、7 步）、主畫面的時間、錢、紀錄、自由行動、存讀檔、AI 設定（`cpp-ai-v1`）接上引擎；舊假存檔作廢（新鍵 `cpp-engine-saves-v1`）。ui 31 個檔、234 個測試全過。
- 待 cpp-architect（M0-ui-engine 回報的，要搬進引擎的規則）：屬性 ± 按鈕的 `attrStepBlock`；起始的錢的組成（出身加減、橋與義體點數換錢、裝備點數）；自訂特質；性別 TS 拆成 trans_f／trans_m；`g.money` 透支要換成 store 動作處理；`g.weekday`／`g.billIn` 改用引擎的 `weekdayOf`。
- 2026-11-21（lead）：使用者定案 id 表（DATA 1.1）、行動種類表（AI_TASKS 3.1）、餘韻的夾法（一次 +1、不能疊滿）、EVENTS 的時段改用六時段。待 cpp-architect／cpp-data：`engine/data/rules/actions.json` 照 AI_TASKS 3.1 建；出身的 `favor`、`roster` 改收 id；`afterglow` 的夾值；ui 假資料的 NPC id 改成 `npc_lian`、`npc_ray`、`npc_jo`。時段名稱與時間還沒定（見等使用者決定）。

## 等使用者決定

- ~~回退不換亂數種子~~：2026-11-21 確認照建議（GAME_DESIGN 第 9 節、AI_TASKS 2.4 節）。
- ~~dev/adr/0004 的十三項暫定值~~：2026-11-21 確認都照建議。
- ~~AI 設定的儲存形狀~~：2026-11-21 確認統一存 `cpp-ai-v1`（介面讀到舊鍵轉一次）。
- ~~舊假存檔~~：2026-11-21 確認作廢。
- 草稿兩份（id 表、行動種類表）：2026-11-21 確認定案。
- 時段的名稱與時間：等使用者在兩案中選（A：名稱不動、全部往前 1 小時，清晨 3–7…黃金時段 19–23、深夜 23–3；B：中午改名，要重寫 NPCS 的行程）。

