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
- 2026-11-21（lead）：邊界測試的規格問題定案（EVENTS 2.4、AI_TASKS 2.5）：上限一件事合計；總時間合計後夾；格式底線（不溢位、物品一次最多 100、戰鬥外生命最少剩 1）夾值關著也擋。錢的上限照規格（AI 的事件看信譽、內建的看區的等級）；B006「隔著程式」由 cpp-architect 照 AI_TASKS 2.2 的意思解讀。

- 2026-11-22（cpp-architect）：M0 的修正批次（核心與外殼）做完。引擎 34 個檔、542 個測試全過，沒有 `it.fails`；`npx tsc --noEmit` 沒有錯；分層檢查過。
  - 審查 E1、E2、E4（引擎這一側）與屬於引擎的小問題（S3 的引擎那一半、S6、S7、S8、S10、S11）；邊界 B001～B007；白箱 W001～W010。每一份 bug 報告最後一行記了怎麼修、回歸測試在哪。
  - 定案做進引擎：時段從清晨 3 點起算；上限一件事合計、行動的總時間合計後夾、格式的底線；錢的上限分 AI（信譽）與內建（區）；餘韻的夾法；出身的勢力與名冊改用 id（多了 `faction`、`npc` 兩種內容與資料）；`look.private`；`attrStepBlock`、性別六個值、`Game.clock`。
  - 介面回報的四件事：`Game.commit` 的 `attach`（併進最新一樓）、`Game.rewind`（回到快照但保留紀錄）、義體與裝備點數換現金（`startMoney`）、自訂難度的 DC 偏移（引擎本來就收，介面的對照表在工單裡補）。
  - 新的工單：dev/work/M0-fix-data.md（行動種類的資料、建角的三個數字）、dev/work/M0-fix-ui.md（介面照新的介面接；做完之前 ui 有 17 個測試是紅的、typecheck 有 2 個錯）。驗收測試在 `engine/tests/pending/M0-fix-data.test.ts`、`ui/tests/pending/M0-fix-ui.test.ts`。
  - ADR：0007（效果的上限）、0008（提交、重試、回到快照）、0009（幾個解讀與暫定值）。不變式更新到 43 條。
  - 這一批為了讓主套件保持全綠，動了 cpp-architect 範圍以外的幾處：`engine/src/features/`（角色的效果、建角、行動種類，都是照新的核心介面改）、`engine/data/`（`origins.json` 改成 id，新增 `world/factions.json`、`world/npcs.json`）。
- 待 cpp-data：dev/work/M0-fix-data.md。待 cpp-ui：dev/work/M0-fix-ui.md。
- 2026-11-22（lead）：M0 修正批次做完（M0-fix 核心、M0-fix-data、M0-fix-ui、介面這側的 E3／E5／E6／E7）。M0 收尾；建角第 6、8、9 步的規則（`ui/src/lib/creation.ts`）等 M1／M4 搬。
- 2026-11-22（docs）：使用者定案「等使用者決定」的十題，寫回設計書（EVENTS 2.4、LIFE 1.3、AI_TASKS 2.5／3.1／3.5、SERIES 第 6 節、GAME_DESIGN 第 9 節、DATA 第 1 節、CHARACTER 1.1）與 docs/log/DECISIONS.md。待 cpp-architect：引擎跟著改第 1、2、4、6 條：帳戶與現金分開夾（`money` 拆成兩組）、物品每一種各 100 個（`ITEM_MAX_PER_EVENT` 改成每種分開算）、街頭信譽對等級（`rep_grade`：無名、熟面孔 I，之後每階 +1）、`free` 的參考範圍拿掉現金（`engine/data/rules/actions.json`）。其餘六條和引擎現在的做法一致。
- 2026-11-22（lead）：M1 範圍定案：現實戰鬥照 COMBAT_SYSTEM 做完整（所有主動技能、三種無人機與移動收回、載具當掩體、場地與控制節點）；機甲留到 M6（只留接口）；手機戰鬥敵上我下、兩排第 1 格在左；戰敗事件 M1 只做略過版，二十九種的分法留到 M2。
- 2026-11-22（cpp-architect）：M1 開工：核心、測試基礎建設、第一波工單。引擎主套件 41 個檔、632 個測試全過，`npx tsc --noEmit` 沒有錯，冒煙 3 個檔 6 個測試過；ui 38 個檔、373 個測試全過，`vue-tsc` 沒有錯。給下游的驗收測試（引擎 11 個檔、ui 1 個檔）照預期失敗。
  - 核心（L5）：戰鬥引擎 `engine/src/core/battle/`（現實與內海共用：站位、遮蔽、回合、命中、傷害、感載與過載、狀態、監視、增援、和人重疊的東西、機體的接口、敵人 AI 的骨架；戰場、傷害類型、狀態、武器的類型是資料）與格子地圖 `engine/src/core/grid/`（DATA 9.3 的格式、實例、走一步、站上標記的登錄表）。戰鬥的每一步是一份報告；快照放在狀態裡；`Game` 多了 `startBattle`、`battleOptions`、`battleAct`、`battleNext`、`finishBattle`、`retryBattle`、`rewindTo`、`enterMap`、`gridMove`、`gridView`。存檔升到第 2 版（第 1 版的讀得進來）。
  - 另外放進核心的：內容種類 `item`、`weapon_class`、`battle_mode`、`damage_type`、`battle_status`、`special_map`；內容篩選與照性別選版本（`pickVersion`、`resolveFiltered`）；難度的敵人係數（BALANCE 7.2）。
  - 定案做進引擎：帳戶與現金分開夾、物品每一種 100 個、信譽六階對等級（`REP_TIER_GRADE`）、`free` 的參考範圍拿掉現金、性別五個值（拿掉 `trans_m`；ui 的選項與測試也改了）。
  - 測試基礎建設：具名的情境（一般遭遇、精英遭遇、首領戰、要活的、打不贏的）、`makeBattleGame`、`playOut`、`fixDice`、最小的行動表 `TEST_COMBAT`；冒煙 M1 的核心版（一場現實戰鬥打完、戰敗、重來）。
  - 工單十一張（`dev/work/M1-*.md`），各附驗收測試。建議的順序：`M1-data-rules`（cpp-data）→ `M1-combat`、`M1-enemies`、`M1-gear`、`M1-defeat`、`M1-explore`、`M1-abilities`（cpp-feature；彼此不相依，但都要在 `engine/src/features/index.ts` 加一行，同時做要小心那一行）→ `M1-data-enemies`、`M1-data-abilities`（cpp-data）→ `M1-summons`（cpp-feature）→ `M1-ui-combat`（cpp-ui）→ 把 `engine/tests/pending/M1-smoke-features.test.ts` 搬進 `tests/smoke/`。
  - ADR：0007 改寫（錢分開夾、物品每一種 100 個、信譽對照）；新增 0010（戰鬥引擎放在核心）、0011（每一步是一份報告、快照、存檔第 2 版）、0012（格子地圖）、0013（M1 的解讀與暫定值）。不變式更新到 58 條。
  - M1 還沒開工單的（等第一波做完、介面定了再寫）：其餘的技能（槍手與掮客剩下的、機師、改造師含手術刀、潛網者在現實的快駭、名媛）與它們的資料；敵人的招牌行動與掉落、敵方的無人機與砲塔、機師兵種；投擲物、腳本、特殊彈；設計圖、零件、物品目錄的資料與建角第 6 步；裝備與技能的介面。機甲在 M6（核心只有接口）。

- 2026-11-22（cpp-architect）：M1 第一波之後的核心修正做完（派工的 10 項加審查 dev/reviews/2026-11-22-M1a.md 的 E1～E5、S2～S5、S7）。引擎 61 個檔、905 個測試全過，`npx tsc --noEmit` 沒有錯，冒煙 4 個檔 8 個測試過；ui 40 個檔、384 個測試全過，`vue-tsc` 沒有錯。決定寫在 dev/adr/0014，暫定值補在 dev/adr/0013（C6、C12～C14、D4）；不變式改了第 45、46、48、57 條，加了第 59～61 條。
  - **行動的宣告**：`battleOptions` 的每個行動都帶 `icon`（字串的鍵）與 `picks`（目標以外要選的東西：每一項、每個選項、選不了的原因、對哪些目標適用）。核心、現實戰鬥、無人機與控制節點、技能的每個行動都填了；`tests/features/M1-picks.test.ts` 把宣告和行動本身逐一對過，另有一條掃原始碼（讀了 `input.pick` 卻沒宣告的鍵會失敗）。叫人的目標改成列在 `targets` 由核心驗（審查 S8 一起收掉）。
  - **圖示**：對照表在 dev/adr/0014。還沒有圖的鍵：`end`、`surrender`、`drone_deploy`、`drone_command`、`drone_move`、`drone_recall`、`vehicle`、`node`（交 cpp-ui）。
  - **要抓人的敵人**：位置分多一項（行動的 `aiSlotScore`，制伏回 4）；`features/combat` 的 `registerCaptureAi` 拿掉，制伏回到平方加權抽。
  - **AI 偏好 `bridged`**：照單位上的義體數（`cyber`）×1～2，每件 +0.2。義體數來自衍生數值 `cyber_count`，義體的功能（M4）註冊之前主角這一邊都是 0。
  - **行動點**：引擎沒有錯。上限 = 4 ＋ floor((mod(反應) ＋ mod(魅力)) ÷ 2)，第一回合從上限開始，之後每回合回 3、不超過上限（COMBAT_SYSTEM 1.2）。反應與魅力都是 16 的人上限就是 7，第一回合顯示 7／7 是對的。
  - **開打回傳報告**：`Game.startBattle` 本來就回傳；store 的 `startBattle`、`startEncounter` 現在也回傳（第一份是 `battle.start`）。畫面還沒把它放進紀錄（工單）。
  - **假的服務商寫戰鬥正文**：原因是它照自由行動的報告欄位（actor、degree）拼句子，戰鬥結束的報告沒有這兩欄。改成有什麼寫什麼；戰鬥結束的報告多帶結果的名字。
  - **定點射**：改成花費的修正（`action_ap` 帶著手上的武器、原價與行動的標籤 `weapon_attack`）加上行動做完的掛點（`action.done`）記次數；改武器 `ap` 與 `wbase` 的做法拿掉。
  - **士氣**：開打時記下每一方的人數（`origin.headcount`），「同伴倒了一半」照它算；帶 `contract` 標籤的單位不檢定士氣（不投降也不撤退）。
  - **審查的項目**：E1 等著選的戰敗由核心擋（`Game.pendingDefeat`、`Game.blockOf`；開打前的快照在結果定案時丟掉；`retryBattle` 只在還在打或在等三選一時成立）；E2 補位時無人機跟著掛的那一格走，`battleProblems` 查每格最多一台；E4 讀檔照 `battleProblems` 驗進行中的戰鬥，戰場與狀態查不到的不讀；E5 電磁與熱能少一顆傷害骰（傷害類型的 `dice`，規則表也改了）；S2 開不起來的戰整步不成立；S3 戰鬥中 `Game.commit` 只收戰鬥的報告；S4 補上來的人照先攻排進順序；S5 回合開始才過載的失去下一個回合；S7 打到一半重來先把每一步收成一份。
  - 為了對得上動到的功能：`features/combat`（圖示、picks、標籤、制伏的 AI、道具的目標多一條原因）、`features/summons`（圖示、picks、指揮與移動的目標多一條原因）、`features/abilities`（定點射的做法、圖示、picks、叫人的目標）、`features/enemies`（士氣）、`features/defeat`（沒有事件可接受時丟快照）；`ui/src/stores/engine.ts`（回傳報告、被擋下的提交回傳原因、`pendingDefeat`、`blockOf`）。
  - 新的工單：dev/work/M1-ui-combat-picks.md（cpp-ui：照 `picks` 生選單、補圖示、開打的紀錄、戰敗面板的返回、審查 S9），驗收測試 `ui/tests/pending/M1-ui-combat-picks.test.ts`（現在照預期失敗）。
  - **沒有做、列出來的**：
    - 起始裝備（派工第 8 項）：設計書說有（CHARACTER 5.4：12 點裝備點數自己選 I～II 級的東西、每個出身一組建議、另外白給日常服裝、板子、兩個彈匣、化身的 SKIN；沒有白給的武器）。引擎現在做不了：建角第 9 步還在 `ui/src/lib/creation.ts`（假資料），引擎只收「花了幾點」；設計圖、零件、目錄價都還沒有資料，而內容現在不再匯入（project.md）。所以新主角沒有武器（空手）、快取格是空的，維持原狀。要做的話是一批：建角功能收選的東西（點數 = 目錄價 ÷ 250 進位）、裝備功能把它們放進背包並穿上、介面改接引擎，內容用測試自帶的假資料。
    - 契約人的資料：引擎認 `contract` 標籤（敵人資料的 `traits` 會變成標籤），但名冊還沒有任何一筆寫 `traits`（伊甸園的契約保全、契約機師要標）。等名冊第二波。
    - 審查的 S1（叫人的支援射擊不照命中的通則）、S6（重傷的軀幹把整個人的護甲歸零）：功能層，沒有動。S6 要核心配合（單位分開記「那件衣服的護甲」）時再開。

## 等使用者決定

- M1 開工對照出來的事（細節在 dev/adr/0013；每一項引擎現在照哪一邊也寫在那裡）：
  - 設計書兩處對不上：穿甲多出來的算不算傷害（COMBAT_SYSTEM 第 4 節的公式對平衡模擬）；敵人資料寫絕對值還是相對修正（ENEMIES 第 2、15 節對 ENEMY_ROSTER）；技能資料的樣本（SKILLS 第 13 節對 SKILL_TREES）；容量的例子（CORE_RULES 6.4 對 SKILL_TREES）；手術刀在戰鬥裡做什麼（COMBAT_SYSTEM 第 11 節對 SKILL_TREES）；DATA 9.3 節小辦公室樣本的門走不過去；定點射是主動還是被動。
  - 會動到平衡的兩項：重傷的 −2 開始對攻擊生效（平衡模擬沒有算）；首領戰用「一邊倒」的遮蔽時勝率與損耗離目標很遠（用「中」才對得上）。建議交給平衡的 session 重跑。
  - 設計書沒寫、先定的暫定值二十幾項（餘韻的「全屬性 −2」落在哪、打遮蔽的花費、制伏失手時束帶、敵人的士氣、基準遭遇、通用的戰敗事件、叫人的支援射擊、無人機的數字……）。

- ~~效果上限的幾個讀法（dev/adr/0007）~~：2026-11-22 確認：帳戶與現金**各自**有上限、分開算；物品是**每一種**一次最多 100 個，總數不另外限；AI 給的錢拿到與失去都管、內建的只管拿到的（EVENTS 2.4 節）。
- ~~街頭信譽六階怎麼對到 I～V 級~~：2026-11-22 確認：無名、熟面孔 I 級，之後每升一階升一級（LIFE 1.3 節）。
- ~~參考範圍照區的等級、上限照信譽~~：2026-11-22 確認：衝突時以上限為準，參考範圍只是提示（AI_TASKS 2.5 節）。
- ~~`free` 的參考範圍「現金約 20」~~：2026-11-22 確認拿掉現金，退路只給時間與敘述（AI_TASKS 3.1 節）。
- ~~撤退之後再做同樣的事，骰子要不要和上一次一樣~~：2026-11-22 確認不保證；一般回退照舊不換種子（SERIES 第 6 節、GAME_DESIGN 第 9 節）。
- ~~兩個暫定的名字~~：2026-11-22 確認 `intimate_body`（DATA 第 1 節）、`adult_action`（AI_TASKS 3.5 節）。
- ~~殺價、打工、日常直播三種行動~~：2026-11-22 確認等 TRADE、DOWNTIME、MEDIA 搬進來（M2、M5）再收（AI_TASKS 3.1 節表下）。
- ~~性別六個值~~：2026-11-22 確認 TS 分 `trans_f`、`trans_m`（CHARACTER 1.1 節對齊 DATA 第 1 節）。

- ~~回退不換亂數種子~~：2026-11-21 確認照建議（GAME_DESIGN 第 9 節、AI_TASKS 2.4 節）。
- ~~dev/adr/0004 的十三項暫定值~~：2026-11-21 確認都照建議。
- ~~AI 設定的儲存形狀~~：2026-11-21 確認統一存 `cpp-ai-v1`（介面讀到舊鍵轉一次）。
- ~~舊假存檔~~：2026-11-21 確認作廢。
- 草稿兩份（id 表、行動種類表）：2026-11-21 確認定案。
- ~~時段~~：2026-11-21 選 A：名稱不動、全部往前 1 小時（CORE_RULES 7.4 節）。`DEFAULT_TIME_RULES.dawnHour` 已經改成 3（2026-11-22）。


- ~~2026-11-22 技術債：capture 敵人拿遠程武器時，核心 AI 的位置分會先讓他後退，輪不到制伏~~：2026-11-22 做完。位置分多一項（行動的 `aiSlotScore`），`registerCaptureAi` 拿掉（dev/adr/0014）。
- ~~2026-11-22 技術債：契約人不能投降（ENEMIES 4.4）、士氣的開場人數要在開場時記下~~：2026-11-22 做完（`origin.headcount`；帶 `contract` 標籤的不檢定士氣）。名冊還沒有標誰是契約人，等第二波。
- 2026-11-22 名冊轉不進格式、留給第二波（敵人招牌行動、掉落、附屬單位那批）：mods 的「沉溺」、溺感邊緣、一定帶著的特徵（traits）、angel 欄位、position 的重疊（掛在格上的無人機與砲塔）、武器效果敘述（燃燒、義體失效、無視一半護甲、炸膛、卡彈、無聲…）、附屬單位（無人機、獵犬、飛劍、攝影機）、機甲 en_sb_mustang、快駭武器、雙戰敗 id（en_grd_caller）。名冊轉換腳本：tools/data_enemies_gen.py。
- ~~2026-11-22 技術債：核心 AI 還沒有 prefer `bridged` 的算法~~：2026-11-22 做完（每件義體 +0.2、最多 ×2；義體數等 M4 的功能提供，在那之前是 0）。
- 2026-11-22 內容待辦（不是現在）：名冊補寫新兵種，讓每個勢力範圍裡每一級都有雜兵、精英、首領（缺口清單用 tools/data_enemies_gen.py 的資料算，現在約 50 個缺口）。
- 2026-11-22 技能資料轉不進格式、留給技能第二波：消耗「1 時段」、二選一的消耗（收買、大局、有話好好說、總攻令、護盤）、「每件委託」次數、行動點以外的消耗、人面叫人的支援射擊數字沒有欄位；人面 text 帶 Markdown 粗體（介面要處理）。
- 2026-11-22 介面還在算、等引擎給的（交 architect 設計）：到每個敵人的距離（現在借 shoot 的 hint.distance）、「回到這個階段開始時」該由引擎定義哪一份快照算階段開始（store 暫時的 rewindToStage）、手機圓環 hover 放大會蓋住隔壁格。
- 2026-11-22 M2 小工單：橋的換配置照 UI.md 8.3（在據點或調校診所、花半小時），M1 介面先照引擎不限地點。
- 2026-11-22 裝備介面等引擎給的：外套扣上時被蓋住哪幾格（介面暫用 gearView.ts 的 COAT_COVERS）、equip 會佔哪幾格、單件護甲值、曝露度與風格、重量、目錄價、戰鬥外使用道具。商店與組裝搬進引擎前，買到的東西不會進引擎的背包。
- 2026-11-22 技能介面等引擎給的：橋的物品資料（型號、晶片、調校槽）與新角色的預設橋、夜課與體悟、升基本功的動作（概要分頁還用假 store 的 xp，和引擎的歷練點會不一致）、建角第 8 步的學技能規則還在 ui/src/lib/skills.ts（M4 建角搬進引擎）、委託頁讀假的 g.loadout（M2）。
- 2026-11-22 掉落還表達不出來的（ENEMIES 第 7、9、15 節）：牌子與材質隨機、零件等級照敵人等級、憑證、撿整件武器護甲、構裝與解剖掉落、機甲殘件；網內的蕾絲與程式該不該掉現金（M3 決定）。
- 2026-11-22 技術債：features/combat/ops.ts 的 damageOverlay 複製了核心的掛著東西的傷害算法（核心 hpDamage 是私有的）；第二波收尾時核心補 run.damageOverlay(o, raw, type, by, { pierce }) 並改用它。
- 2026-11-22 第二波收尾的核心小工單（M1b-core-closeout，sonnet）累積：`run.damageOverlay` 公開入口；`attack.before` 可設 `opts.cancel`（卡彈與炸膛移回掛點，技能的 attack 也會卡彈）；redirect 結算後的掛點（立牌保證倒下）；`attackOverlay` 也發 `attack.before`（技能打掛著的東西吃得到彈的 fx）；快感沉溺的定力擋（取代 takeBackSink）。功能層：fx 合併的 `armor_mult` 改相乘；使用道具支援 `target: 'foe'`（紙鶴）、`until: next_overload`；智慧武器失效。
- 2026-11-22 技能格式還寫不出來的（SKILLS 1.8）：預備裡要玩家選的東西（預備沒有 pick）、move_ap 等其他修正的每場／每回合第 N 次、被動改遮蔽倍率、重創機率、反應 attacked 的 if、mods.when 的生命比例條件、日常（daily）。
- ~~2026-11-22 第二批核心小修（之後一起派，sonnet）：order 的 act_next 要看「對調之前」有沒有動過（大局，M1b-skill-gunner-broker 留 it.todo）；compact（補位）發 `compacted` 掛點（不准動喔現在用掃描補）。~~（M1b-core-fix2 做完；剩甲板構裝槽的鍵、path id 核對、節點防火牆暫定、hack 圖示）
- 2026-11-22 開打前的指定（戰鬥直覺的分配 preset.instinct、黑市門路指定的隊友 preset.picks）沒有寫入的報告與介面，要一張 abilities＋UI 的小工單。被贖回（保釋）的選項要 UI 用 defeatOptions／chooseDefeatOption 顯示。
- ~~2026-11-22 第二批核心小修（續）：`check.before` 的 unit 是擲骰的人還是被檢定的人要定（快駭用自己的 hack.check 繞過）；技能格式補「你或一名隊友」的 trigger.who、甲板構裝槽的鍵、共鳴改池上限與感載上限、「敵方的每一台」的 who、needs 的「快取格有某標籤的道具」。潛網者樹的 path id 要和 hack 預設的 `netrunner` 核對；控制節點防火牆暫定 ext.firewall 預設 10。接管期間 overlay 的 owner/auto/autonomous 會暫時清掉（enemy-units 要知道）。圓環缺 `hack` 圖示。~~（M1b-core-fix2 做完；剩甲板構裝槽的鍵、path id 核對、節點防火牆暫定、hack 圖示）
- 2026-11-22 待辦：第二波技能工單（改造師、名媛、敵人招牌）做完後，整理一張技能效果統計表給使用者（效果清單、修正與條件清單、八棵樹逐技能的狀態：已做／近似／寫不出來／等後面批次），做成可篩選的 artifact，另在 dev/ 留文字版。

- 2026-11-22 待修：潛網者「管理員」設計書是接管「一台」，現在 foe_overlays 會接管全部；要加「選一台」或第一台的 who。大局選自己再選後面的隊友時，兩人之間沒動過的人會被跳過（ADR 0015 補記）。- 2026-11-22 機師樹（M1b-skill-pilot）：27 個技能裡 6 個與共鳴 3 整個延到 M6，6 個只有機甲那一半延到 M6；寫不出來：堡壘姿態「後面那一格遮蔽高一級」（核心要 who:'behind' 或遮蔽級數修正，跟著姿態開關）。規則表要加狀態 `rooted`（no_move，battle_end）。技能的 picks 要一種以 `ext.summons` 為來源的選項（選放哪一台）。我方無人機 autonomous（E6）排在 M1b-enemy-units。
- 2026-11-22 敵人招牌（M1b-enemy-moves）留下的：特徵缺鍵（不吃壓制、第一回合不先動、戰後倒地、撤退必定成功、特徵給 sink）；招牌缺「叫別的單位各攻擊一次」與耐久補滿；近戰招牌要寫 do:[attack]（名冊匯入時注意）。待修：hack 的 treeTier 對敵人退回單位等級（敵方潛網者）；基準遭遇現在靠 id 前綴 enc_base_ 不擲特徵，改成 encounters.json 寫 traits:false（機制欄位）後拿掉前綴規則。
- 2026-11-22 敵方單位放不進的（ENEMIES 第 10 節）：不戰鬥的 overlay（收租無人機）、佔格單位的「不移動」旗標（展示間蜘蛛砲台）、機械獵犬詞條（匯入時寫 attached）、無人攝影機的被直播效果。
- 2026-11-22 改造師（M1b-skill-medic）留下的核心缺口：performAction 發 action.done 時沒傳 run，行動的 costTags 不在 tags 裡（abilities/mods.ts 有繞道）；until own_turn_end 對自己用會在同一回合結束就數一次（abilities 用 branch.self 繞）；公式缺「上限的一半」（全面翻修）。功能層：拆解對無人機、義眼超頻（boost_eye）、「相鄰、不含自己」的目標、SOURCES.battle_status 補 rooted 出處。
- 2026-11-22 技能效果盤點 artifact：https://claude.ai/artifact/2JCokMDuMapwcEskFvVAww（資料 dev/reports/skill-effects.json）。
- 2026-11-23 核心的 ITEM_CATEGORIES 沒有 drug（藥現在靠 drug 標籤才能進快取格），M4 做藥時補類別。名冊卡彈與炸膛的變體（連射 1d6 卡彈、煙花自傷一半）還沒有格式。匯入正式潛網者資料時七個快駭技能要寫 action_tags ['hack','hack:<類別>']。
- 2026-11-23 world 待跟進（等 M2-core-shell 補 GridCtx.step/last 與 facility 格子種類）：設施只在最後一格觸發、拿掉最短路推算、圖例改用 F。DISTRICTS 1.2 沒做的（橋接區封鎖繞路、追逐、地下層入口與要地、區域狀態、公共交通、日夜人口表）排 M2-transit 或之後。
- 2026-11-23 lewd 留下的：核心 unitFromActor 與角色的 load_cap 讀 ext.bridge 的基本值，義體或藥物加的有效值（bridge_<參數>）不會進戰鬥（M4 定誰負責）；把橋拿掉（unbridged）需要核心明寫「沒有橋」的辦法。LEWD_SYSTEM 第 1 節表上沒有數字的格子（同步深度門檻、義體效率、抵抗修正、開銷）留到 M4。
- ~~2026-11-23 核心 item 依 uid 已做（M2-core-fix1）~~；原：核心 `item` 變更要能依 `data.uid` 拿走特定那一件（沒收、交易同設計圖多把時會拿錯；M2-trade 因此只讓沒有實例資料的那幾疊上架收購，有 `data` 的組裝成品與零件現在賣不了，核心補上之後 `sellBlock` 放開、`SellRow` 多帶 uid）；explore 的進圖要呼叫者自己呼叫 arrive（或 openMap 走掛點）。security 沒做的（降敵對值的其他方式、分段後果、好感效果、義體與沉溺掃描、寄放與拘留）排 M2 後段或 M4。
- 2026-11-23 transit 留下的：存檔規則「沒去過的站也能搭」放在 transit_rule.anywhere（要做成存檔規則得改核心 SaveRules）；介面的改目的地與快轉沒有報告；車上能做的事、渡輪帶貨與人情付費、乘客紀錄、自己的車沒做。
- 2026-11-23 trade 留下的：成品（組裝出來的裝備）沒有目錄價，ITEMS 1.4 節要零件價錢加總與型係數，引擎還沒有，所以買不到也賣不了；類別的行情現在固定 1（`categoryMult`，M2-market 接）；員工價（社員 −10%）、帳戶被凍結只能用現金、洗錢、服務、殺價都沒做；用帳戶買違禁品的敵對值加幾點設計書沒寫，暫定每種 3 點（`trade_rule.dirty_hostility`）。features/index.ts 要加 `tradeFeature`（排在 worldFeature、securityFeature 之後）。
- 2026-11-23 成品（組裝出來的裝備）沒有目錄價：ITEMS 1.4 的零件價加總與型係數，要 gear 提供算價函式（M4 組裝時一起做）。
- 2026-11-23 market 沒做的（TRADE 3～6）：長期折扣、挑毛病與二手、整車出價、以物易物、黑市與收贓、鑑定、服務、區域狀態。
- 2026-11-23 roster 沒做的（NPC_SYSTEM 10）：關係線、被挖走、沉溺 100 離隊、藏沉溺的檢定、牆報徵人、招募的標籤修正、拿掉人時親密度 −5。
- 2026-11-23 npc-life 留下的：「認識的人不會因汰換而死」先放旗標 npcs:protect_known（要成正式存檔規則得核心加欄位）；契約季認旗標 city_event:contract_season（之後城市大事照這個名字）；勢力對頭讀 faction.rivals（資料欄位待定案）；npc_life_rule 的 gig_actions／netrun_bad／bill_bad、roster.risky 區 id 是暫定，委託與帳單報告名定案後對一次。被挖走、關係線、救援委託沒做。
- 2026-11-23 commission-run 留下的：進圖開戰時 origin.by 會被補成 core（認副本戰鬥用 origin.ext.commission＋stage）；M3／M5 登記 face.net／face.opinion 時要自己 allow('commission', 'face.net.')；附帶條件檢查、直播目標、隔離區、中途警戒到 100 不升級沒做。
- 2026-11-23 核心小修待辦（第二批）：defeat 活動的放行要能照階段（三選一等待時不放 chain:free_action，事件開著時才放；COMBAT_SYSTEM 8.4、M1 審查 E1）；事件的 fight 結果在戰敗裡要放行 battle.start（劫囚之類，M2 內容用不到）。
- 2026-11-23 defeat 留下的：roster 要回答 defeat.companions（同行的人）；M4 裝備與義體的「拿走」效果要回答 defeat.gear；多段戰敗事件的現金上限沒有跨段合計；版本比例、handed_over 轉雇主、police 轉 arrest、pinned（M4）、AI 正文沒做。
- 2026-11-23 核心小修待辦（第二批，續）：Game.restoreFrom 回退之後的接續報告（例如 commission.failed）有進 state.reports，但不在 commit 回傳與 notify 的報告裡，介面看不到。
- 2026-11-23 bills 沒做的（DOWNTIME 5）：快捷檔位、鎖義體／換門鎖／討債人／簽契約的後果（只有旗標）、帳戶凍結、洗錢補差額、債的還本金、第 4 週起不併債。defeat.companions 只回名冊成員（街坊同行不算）。
- 2026-11-23 rest 沒做的（DOWNTIME 2、7）：舒適度加成、少於 6 小時算喘口氣、診所病床、處理過的來源、欠繳後立即補繳開鎖、買斷與搬家、安全屋與家園地圖家具住戶（M5）。
- 2026-11-23 work 沒做的（DOWNTIME 4）：自己的店面、派別人打工（M5）、區域狀態修正、AI 判定與小費偷聽、契約人收入歸屬（M4）、公式型時薪（第七棚）。
- 2026-11-23 fixer-pay：出場費只付一次（輔助面付錢與借人召集時預付；隊伍裡的人入帳時從報酬付），撤退在 rewind.keep 退人退錢。沒做：補出場費時選錢種、欠下的寫進帳單、人面的好處、讀名冊 pay 欄位、同行的親密度。
- 2026-11-23 scene 沒做的（LEWD 3.5）：多人分圈、換檔、觸手例外、技能 needs、夜課學習與共鳴、對方性別／NTR 等篩選開關、外部打斷來源、AI 每回合與 scene_gate（只留接口）。精簡版換體位後自動接回是免費的。
