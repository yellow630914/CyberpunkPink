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
- 2026-11-23：菁英遭遇（一般遭遇 4 點；III～V 級沒有菁英的組合）的點數與勝率，使用者裁決交給平衡 session，引擎與設計書先不動數字。

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
- 2026-11-22 裝備介面等引擎給的：外套扣上時被蓋住哪幾格（介面暫用 gearView.ts 的 COAT_COVERS）、equip 會佔哪幾格、單件護甲值、曝露度與風格、重量、目錄價、戰鬥外使用道具。（2026-11-23 商店已接引擎，買到的東西會進引擎的背包；組裝仍在介面。）
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
- ~~2026-11-23 核心小修待辦（第二批）：defeat 活動的放行要能照階段（三選一等待時不放 chain:free_action，事件開著時才放；COMBAT_SYSTEM 8.4、M1 審查 E1）；事件的 fight 結果在戰敗裡要放行 battle.start（劫囚之類，M2 內容用不到）。~~（M2-closeout 做完，dev/work/M2-closeout.md、dev/adr/0017）
- 2026-11-23 defeat 留下的：roster 要回答 defeat.companions（同行的人）；M4 裝備與義體的「拿走」效果要回答 defeat.gear；多段戰敗事件的現金上限沒有跨段合計；版本比例、handed_over 轉雇主、police 轉 arrest、pinned（M4）、AI 正文沒做。
- ~~2026-11-23 核心小修待辦（第二批，續）：Game.restoreFrom 回退之後的接續報告（例如 commission.failed）有進 state.reports，但不在 commit 回傳與 notify 的報告裡，介面看不到。~~（M2-closeout 做完，dev/work/M2-closeout.md、dev/adr/0017）
- 2026-11-23 bills 沒做的（DOWNTIME 5）：快捷檔位、鎖義體／換門鎖／討債人／簽契約的後果（只有旗標）、帳戶凍結、洗錢補差額、債的還本金、第 4 週起不併債。defeat.companions 只回名冊成員（街坊同行不算）。
- 2026-11-23 rest 沒做的（DOWNTIME 2、7）：舒適度加成、少於 6 小時算喘口氣、診所病床、處理過的來源、欠繳後立即補繳開鎖、買斷與搬家、安全屋與家園地圖家具住戶（M5）。
- 2026-11-23 work 沒做的（DOWNTIME 4）：自己的店面、派別人打工（M5）、區域狀態修正、AI 判定與小費偷聽、契約人收入歸屬（M4）、公式型時薪（第七棚）。
- 2026-11-23 fixer-pay：出場費只付一次（輔助面付錢與借人召集時預付；隊伍裡的人入帳時從報酬付），撤退在 rewind.keep 退人退錢。沒做：補出場費時選錢種、欠下的寫進帳單、人面的好處、讀名冊 pay 欄位、同行的親密度。
- 2026-11-23 scene 沒做的（LEWD 3.5）：多人分圈、換檔、觸手例外、技能 needs、夜課學習與共鳴、對方性別／NTR 等篩選開關、外部打斷來源、AI 每回合與 scene_gate（只留接口）。精簡版換體位後自動接回是免費的。
- 2026-11-23 abilities-m2 留下的：~~roster 要註冊同行條件 in_tagalong {who}（xp 才分得出同行與留家）~~（M2-closeout 做完）；增援的 fallback「他支援三次」沒有效果可寫；~~被識破時換臉、千面這類戰鬥中戴上的面具要不要一起失效~~（使用者 2026-11-23 裁決：不一起失效，寫在 SKILL_TREES 名媛的預備與日常；引擎照做，被識破只結束偽裝本身）；日常（daily）技能、M3／M5 欄位、M4 的戰地手術裝義體。
- ~~2026-11-23 M2 收尾小修（第二批，ui-world 回報）：導演把「車上」當成別的活動，擋住型 transit_stop／wait 事件在車上一律延後（放行 event.start 的活動不該算）；出口標記用 usesOf 列「過去」；district 內容加地圖位置、治安、風格欄位（示意包先放 map_x/map_y/security/style）；核心 sheetProblems「每張至少 2 個遭遇點」不該套在街區地圖上。~~（M2-closeout 做完，dev/work/M2-closeout.md、dev/adr/0017）
- ~~2026-11-23 M2 收尾小修（資料對設計書，data-rules 回報）：預設值要改成設計書的數字——遭遇組合點數（ENEMIES 13：一般 4、首領戰 8）、報酬範圍（COMMISSION_TEMPLATES 的表）、債的利息胭脂堂收現金（DOWNTIME 5.1）、讀橋防護階企業主管與保全 3（NPC_SYSTEM 6.4）。人情作價 300／1500 與拒絕 −3 沒有出處，維持暫定。scan_level 種類沒人認得（scan_levels.json 未接）。~~（M2-closeout 做完，dev/work/M2-closeout.md、dev/adr/0017；`scan_level` 沒人認得的部分還在）
- 2026-11-23 M2-closeout 做完（十項；dev/work/M2-closeout.md、dev/adr/0017）：戰敗的放行照階段與開戰、回到快照之後的接續報告、街區地圖不要求遭遇點、導演不把車上當別的活動、world 出口 `world.go` 與 district 欄位、roster `in_tagalong`、預設值對設計書、俘虜審問的 scout_reveal、規則表可以被後載入的包取代（示意包與測試的繞法拿掉）。**還沒做的**：介面要接 `world.go`（`MainScreen.runUse` 現在給「畫面還沒有接上引擎」；站在出口上按 E 要呼叫 arrive(exit.to, exit.arrive)，store 的 `world.go()` 還沒有）；劫囚（戰敗事件的 fight 結果）打完之後發起那一場的副本不會收到 defeat 的 activity.end（ADR 0017 第 3 點）；讀橋防護階 3 靠旗標 manager、guard；使用者 2026-11-23 裁決：店長／保全的旗標匯入內容時再標（NPC_SYSTEM 6.4 節），現在不用補。

## M2-ui-commission 回報的缺口（2026-11-23，待 M2 審查一起處理）

- 舊地下城 `ui/lib/dungeon.ts`、`ui/data/dungeon.ts`（SITES 第 11 節垃圾滑道）還在，`refreshFloor` 有亂數洗牌；要搬進引擎或拿掉。
- 踩點驚動條件：設計書「自然 1」，引擎是 fumble（自然 1 或大失敗）。
- `scoutView` 沒給加值與成功率（UI 7.2）。
- UI 7.4：副本直播、附帶條件、輿論壓力條、踩點看到的連動寫 ????、過去階段的輔助紀錄都沒有資料。
- 副本裡 `ui.time`/`ui.money`/`ui.legacy` 被放行表擋。
- 示意包數字：出場費遠大於報酬、委託標題重複、`map_club` 的 `district_weight` 寫 `kabuki42` 對不上示意包 `ave42`。
- `ui/vitest.pending.config.ts` 已無檔案可跑。
- `dev/bugs/2026-11-22-ui-stage-outside-dungeon.md` 第二份重現已改走引擎，進度待補。

## M2-ui-scene 回報（2026-11-23）

- 確認框由畫面判斷（step 0、round 1），引擎沒有確認框概念。
- 正式遊玩沒有給主角夜課技能與體位的來源（夜課學習在 M4），只能靠說話與道具。
- 內容篩選只有 `filterIntimateBody` 轉成 `contentOff`；拘束、公開場合、契約沒接到引擎。
- `foldAdult` 只作用在戰報卡，沒接進紀錄列表。

## M2-ui-life 回報（2026-11-23）

- ~~**要修（引擎）**：`rest.sleep`／`rest.breath` 的 results 句子帶「生命值 +N」，AI 開著時被 H4（數字不寫進文字）擋下，`act` 回 paused。交給 M2 審查後的修正批。~~（M2-fix-review 做完：句子寫成描寫，數字留在變更與 data；dev/adr/0017 補記第 12 項、不變式第 125 條）
- 示意包沒有開局的住處（示範局推到第 14 天會補收房租）；要先去休息租。
- 舊的澡堂、居酒屋等 rest 服務已從「這裡」拿掉。
- 沒做：AI 當日優惠、特別交易、長期折扣、二手狀態、洗錢、派人打工、家園地圖。

## M2-ui-people 回報（2026-11-23，排進 M2 修正批）

- ~~`npc` 不是可覆寫的規則表，示意包要先濾掉核心包同 id 的 9 筆（`demoCoreWithoutPeople`）；考慮讓 npc 可覆寫或補完整 NPC。~~（M2-fix-review 做完：`npc` 後載入的包同 id 整筆取代；介面把 `demoCoreWithoutPeople` 拿掉）
- ~~建角只把出身名冊存成 `pc.ext.origin.roster`，沒有放進名冊。~~（M2-fix-review 做完：roster 在 `creation.commit` 之後把他們放進名冊；介面的建角名冊要照這個）
- engine/data 的路數只有 gunner、fixer。
- 示範局推進十三天後紀錄多一則 downtime，介面測試已改成濾掉。
- 同一天第二次聊天的提示是介面讀 `doneToday` 自己寫的，引擎 `interactions` 沒有說明句。
- `knowFactText` 沒匯出。
- 引擎沒有「正在被討」的人情待處理記錄。
- 示範局沒有引擎主角，名冊容量為 0。

## M2 引擎修正批（2026-11-23，cpp-architect；dev/work/M2-fix-review.md、dev/adr/0017 補記、不變式第 115～127 條）

做完（依 dev/reviews/2026-11-23-M2.md 與使用者「都照建議」的裁決）：
- 必修 1 車上開打或開場景：這一趟車先結束，人在下一站（交通聽事件的 `activity.end`）。應修 1 副本放行表拿掉 `rewind:stage`／`rewind:entry`。應修 2 撤退與失敗回去之後亂數游標往前推（`rewind.fresh`），一般回退不變。應修 3 副本內事件同一件委託不重複、警戒漲過 60 多擲一次 15%（`pressure` 觸發點、`turn.end` 帶 `reports`）。應修 4 成人路由接到服務商（`ADULT_SOURCE_KEY`）。應修 5 委託人勢力好感 +3（評價 S 再 +2）。應修 6 `M2-scene` 的「隨機走一整場」給自己的逾時並寫根因。應修 7 敵對值對委託的後果（找麻煩：守備 +1 個雜兵；追捕：警戒起始 +20；懸賞：後台是它的中間人不接）。
- 設計書裁決：街頭範圍加 `transit_stop` 6%；敵對值物價 20～39 ×1.1、40～59 ×1.2、60 以上不做生意；好感折扣維持 TRADE。
- 建議 1 排序不看語系（`compareText`／`compareNatural`）；建議 2 `CAPTURE_EXT`；建議 3 名冊離開 `< 20`。
- M2-ui-life：rest 的結果句子不帶數字。M2-ui-people：出身名冊進名冊、`npc` 可覆寫、`knowFactText` 匯出、`interactions` 的 `note`。

還沒做、或要使用者決定：
- EVENTS 3.3 範圍冷卻「每個階段最多一件」：階段開始的 30% 與壓力條的 15% 各自擲，同一階段可以出兩件（要知道現在第幾階段才做得了；等有內容需要）。
- 「附帶條件全達成」的好感 +5：附帶條件的檢查還沒有，現在只看評價 S。生成的委託不寫 `employer`（`fixer/gen.ts`），所以委託人好感只有手寫的、帶 `employer` 的副本會加；要不要讓生成器把中間人的 `backer` 當委託人，是設計上的事。
- `fixer` 內容多了選填的 `backer`（後台勢力），engine/data 與 TEST_WORLD 的中間人都還沒寫；正式的中間人資料要加。
- 同類風險已掃過：其他功能的 `narration.results` 沒有「生命值／傷害／感載 ±N」的寫法（效果的 `describe` 本來就寫成描寫），只有 rest 是例外；之後新寫結果句子別帶這種數字。
- 介面要跟著改的（不在這一批）：見 M2 介面修正批；`ui/` 的示意包不用再濾掉核心包同 id 的 npc；睡覺與喘口氣的結果句子變了；建角的名冊會真的進名冊；`interactions` 多了 `note`；`transit` 的車上事件選開打後人在下一站、`rewindToKind('stage'／'entry')` 在副本裡被擋；`trade_rule` 的欄位名換了（`hostility_markups`）。

## M2 修 bug 批（2026-11-23，cpp-architect；dev/work/M2-fix-bugs.md、dev/adr/0017 最後一節第 16～25 項、不變式第 128～136 條）

使用者裁決：B017 不管（接受、不修）；`hostility_floor` 照場合分兩列；街頭信譽改規則；放棄 −5、兩個下限取較高者（文件代理補的）。引擎主套件 194 個檔、5261 個以上的測試全過，`npx tsc --noEmit` 沒有錯，冒煙 7 個檔過；`test:pending` 只剩 B009；ui 的 vue-tsc 與 620 個測試沒動也全過。

做完：
- B016 體悟 AI ±5；B018 警戒只在委託副本裡、key 要是存在的地圖實例；B019 忠誠只有名冊上的人（`MeterDef.accepts`，AI 與玩家要的那一筆整筆拿掉並提醒）；B020 `special_map` 的形狀檢查不丟例外；B021 診所病床算處理過（`facility_type.sleep.treated`）；B022 效果登錄表的 AI 可用清單（`EffectDef.ai: false`：`debt`、`bargain`）、`bill` 新項目總額照 `cred` 的上限；W014 警戒讓目標達成同時跨過門檻時先發 pressure；W015 跨過週一 weekly 只擲一次；B017 改成記現況的一般測試。
- `hostility_floor`：永久的（AI 一件事 +5）與有期限的（`days`，1～365，只有內建的事件資料能寫，下限本身是 `amount`）；同時有好幾個取最高的、不相加、各自到期；每週消退照每個週一的下限算。
- 街頭信譽新規則：同級 +2、高一級以上 +4、S 再 +1、低級不變、失敗 −3、放棄 −5；非委託來源最多加到下一階門檻 −1（量表的 `ceilOf`），委託的結算可以升階；數字在 `fixer_rule`（`rep_same`、`rep_higher`、`rep_lower`、`rep_top`、`rep_failed`、`rep_abandon`）。
- 介面回報的缺口：`features/rest` 匯出 `depositOf`、`residencePools`；`features/transit` 匯出 `taxiArrival`。

還沒做、或要使用者決定（細節見 ADR 第 25 項）：
- 表裡沒寫、但還開著給 AI 的 `perk`、`meet`、`npc_known`、`scout_reveal`。
- `bill.settle` 帶的 `where.overdue` 沒人收（家園的討債事件要它時，要讓導演的 weekly 向帳單問 `where`）。
- 戰敗與契約事件的 `hostility_floor` 一定要寫 `days`：等那兩種資料進來時在資料檢查裡做。
- AI 的體悟往下是 5 還是 0；放棄的 −5 對「還沒出發就放棄」也扣。
- 介面要跟著改的（不在這一批）：`ui/src/stores/engine.ts` 的深匯入 `@engine/src/features/rest/model` 與 `r.rent * weeks`（改 `depositOf`、`residencePools`）、自己重做的 `taxiArrival`（改引擎的）；放棄委託的確認要說「信譽 −5」（`fixerRules(k).rep_abandon`）；睡處的選項多了 `treated`（診所的病床畫面可以標「算傷口處理過」）；`hostilityView` 的 `floor` 現在是永久與有期限取較高的；示意包的診所設施要加 `sleep.treated: true`。

## M2-fix-ui 回報（2026-11-23，留給下一批引擎小修）

- rest 匯出 `depositOf`、`residencePools`（介面現在深匯入 model、押金在 store 重算）。
- transit 匯出 `taxiArrival(k, state, to)`（介面用補足車資的狀態複本權宜重做抵達）。
- 設定 `billMult`、`xpMult`、`defeatView`、`defeatTakeGear` 還沒交給引擎（`rulesFromUi`）。
- App.vue 的戰鬥換頁與帳單 watch 只有原始碼檢查與 Playwright 確認，沒有掛載測試。

## 2026-11-23（lead）：M2 收尾

- M2 全部工單、引擎與介面審查、白箱與邊界、三批修正完成。引擎 194 檔 5261 條、冒煙 98 條、介面 628 條全過；pending 只剩 B009。
- 介面成品 v11、設計書 v180 已發布。
- ~~待使用者：AI 可用效果（perk、meet、npc_known、scout_reveal）、AI 能不能扣體悟、出發前放棄委託扣多少；委託結算畫面要不要加信譽預告。~~（2026-11-24 使用者「都照建議」，見下一段）

## 2026-11-24（M2 最後一小批）

使用者裁決「都照建議」，做完（dev/adr/0017 最後一節第 26～31 項、不變式第 128、131 條改與第 137、138 條新增；設計書 EVENTS 2.4、LIFE 第 9 節、CORE_RULES 8.1、DECISIONS 同步）：
- AI 可用效果：`perk`、`scout_reveal` 標 `ai: false`；`meet`、`npc_known` 保留給 AI。
- 體悟：AI 只能加（0～+5）不能扣；內建的不受影響。
- 放棄委託：出發前 −2（`rep_abandon_early`）、出發後 −5（`rep_abandon`）。「出發後」＝`fixer.go` 記了 `Job.departed`，撤退回到手上也算（進副本的快照在 go 之後存）；`abandonRepOf` 給畫面。
- 結算：`PayoutRecord.rep { from, to }` 記信譽實際的變化；介面副本頁加信譽預告（做完／失敗），結算框（`CommissionScreen` 的 `data-settle`）寫評價、實拿與實際的信譽變化，放棄的確認框照出發前後讀對的數字。
- 還沒做：副本進行中放棄（現在被活動擋掉，只能撤退或失敗）；`bill.settle` 的 `where.overdue`；戰敗與契約事件的 `hostility_floor` 一定要寫 `days`；介面第 25 項列的其餘跟改。


## M3-mode-audit 回報（2026-11-24，留給後面的 M3 工單）

- 內海的 `armor`：`unitFromActor` 兩邊都讀衍生 `armor`，等 M3-core-battle 的 `guard_stat` 改。
- 敵人士氣在內海：生命比例只在現實；內海的觸發（感載比例？）與退出方式（拔線？）設計書沒寫，M3-lace／netcombat 定。
- 武器 fx `on_hit` 在內海暫定兩邊都作用。
- `node.use`（關燈、防爆門）判為只有現實；網內控制節點歸 M3-netrun-nodes。
- 技能 `meat` 欄的被動、資源池在內海也會被讀到，歸 M3-abilities-net 第 1 項；現金與人情資源池在內海要不要建立未定。
- `BattleActionDef.modes` 比對戰場 id 不是 layer，之後有第二個現實戰場要改（核心）。
- 兩條舊測試「內海快取格照帶」已改成不帶（照工單與 ADR 0018）。

## M3-deck 回報（2026-11-24）

- ~~構裝等級高過甲板時照誰~~：2026-11-24 使用者定案照甲板（預設 cap_construct_grade: true）。
- 讀 `deck_slots` 的功能要走 `deckOf`（沒有甲板時衍生數值本身不是 0）。
- 構裝 `traits` 只收字串陣列，DATA 7.3 範例的物件寫法等 netcombat 定。
- M4 義體接上時要換：`state.ts` 的 `rawDeck`、`ops.ts` 的 `equipBlock`／`equipDraft`／`deckStack`。

## M3-core-grid 回報（2026-11-24；程式已在 162f55a 一起提交）

- 網內十三種格子、生成的地圖存在實例（`gen`）、放行規則看從哪一邊來、視野 `sight`、存檔第 4 版（不變式 146～150）。
- 給 M3-core-mapgen：生成的圖寫 `legend: NET_LEGEND`；`cells` 列出每個有標記的格子（id 用 `markersInLayout`）；`sight` 從區的規則表寫進 `SheetDef.sight`。
- 給 M3-netrun：處理完的遭遇節點改成 `floor` 並寫 `used: true`；`net_bridge` 走過改 `wall`；explore 的 `onEnter` 要加 `isNetMapKind` 判斷。
- 給 M3-smoke：testkit 的 `markerByMark`、`markerAt` 要改用 `instanceDef`。
- `Game.enterMap` 仍只收 id；生成的地圖用 `openMap` 加 commit。

## M3-core-mapgen 回報（2026-11-24）

- 生成器 `core/grid/gen.ts`（醉漢走路加修整；單向只把人往出口推、斷橋全斷也走得到）；不變式 151～153。
- 給 M3-netrun：`graph`、`hidden`、`safe_path` 存進實例 `ext.net`；`net_valve` 放行用 `valveAllows`；巡邏路線、層主、遠處遭遇較重、層間出入口都由用的人從 `graph` 自己挑。
- 迷宮館密度實測約 9 個節點（設計書 6～8），由 maze 調 spec。

## M3-netcombat 回報（2026-11-24）

- 內海行動九種、同步檔位、進階與終極、干擾、破損、監視；規則表 `netcombat_rule`。
- 給 M3-data-rules：補 `battle_status` 的 `jam_weapon`、`jam_defense`、`jam_tool`（一回合、own_turn_end、debuff），沒有時有干擾武器會擋。
- `net_broken` 角色狀況沒人清（設計書：下一次休息拿掉）——rest 要補。
- 構裝 `traits` 維持字串陣列；DATA 7.3 範例的物件寫法建議文件改成字串。
- 給 M3-lace：會換檔的敵人 `ext.net.shift = true`；敵人 `weapon.id` 要等於構裝 id。
- 給 M3-netcombat-out：拔線、投降用 system order 1、2；釘住 tactic order 4。
- 給 M3-ui-netcombat：缺圖示 `refill`、`script`、`tool`、`shift`。

## M3-netcombat-out 回報（2026-11-24）

- 釘住、拔線、投降三個行動；追蹤度每輪加、30/60 叫增援、90 倒數被定位；戰後扣線、拆釘子、`net_burn`。
- 追蹤度從 20 起每輪 +3，第 5 輪才跨 30（工單寫第 4 輪，照本文做）。
- 扣線、拆釘子記在戰鬥紀錄拍子（tag `tether`、`pin`，data 帶單位），報告沒有 data 欄位；defeat-net／netrun 從 timeline 讀。
- ~~給核心（之後修正批）：`leave()` 認得 `pinned`（一句「被釘住」與 tag `pin`）。~~ 已做（M3-core-fix-a）：核心記一拍「被釘住了」標籤 `pin`，netcombat 的 `pinUnit` 自己記的那一行拿掉了。
- `net_burn` 靠讀時比對 `until`，核心不自動清。
- 投降不扣線（只有 lose 才扣）——照預設，待審查時一起確認。
- 給 M3-netadmin：管理行動加追蹤度用 `addTrace(run, amount)`。
- 給 M3-netrun：`net.trace` 沒有 ±20 上限，AI 限制歸 trace 量表。

## M3-abilities-net 回報（2026-11-24）

- 技能照戰場 layer 選欄（meat／net）；淺檔時專屬欄不生效、超頻灰掉；管理行動次數 `adminCap`／`adminLeft`；衍生數值 `net_trace_start`、`flow_tier`、`sync_cap_bonus`。
- 內海欄擋掉的鍵清單（叫人、指揮、誘惑、面具、保釋、戰鬥直覺等）見 abilities/format.ts。
- 給 M3-netadmin：`net.admin_spend` 收 `who`、`amount`，不夠丟 BattleBlocked，成功加 `uses['turn:admin']`；七個管理行動在淺檔要不要擋需決定（ITEMS 11.7：專屬構裝淺檔不能用）。
- 給 skill-net-a：超頻「每多 1 RAM 多 1 顆骰」要查 `attack` 效果收不收骰數公式。
- 待決定：共鳴（path.resonance）不分欄，現實共鳴在內海仍生效。
- 開戰時套用的池與標籤看那一刻的 `sync:` 標籤，若 netcombat 還沒寫上，淺檔的專屬欄池會照樣加上（審查時查）。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-netadmin 回報（2026-11-24）

- 七種管理行動（造牆、拆牆、斷路、接管、破解、擦痕跡、標記）、駭入程式的 admin 欄合併規則、後門鑰匙；`netBattleView` 有 admin 次數。
- 暫定：紅點的標記加值用 `amount` 寫總數（不是 +2 之上再加）；同時兩格不限相鄰；接管檢定失敗一律 +1 +5 追蹤度。
- 給 M3-lace：敵方潛網者要 `admin` 標籤、`ext.net.admin`、RAM 池。給 M3-netrun：破解結果 `fled`，拍子 `data.cracked`。給 M3-data-rules：`netcombat_rule.admin`。

## M3-lace 回報（2026-11-24）

- 內海敵人單位（內海表、傷害骰 4/5/6、防火牆 11＋等級）、照層挑兵、偏好深檔 AI、白蕾絲追蹤度 60 撤走、解剖掉落（構裝、憑證），內海不掉現金與物品。
- 暫定：內海士氣只剩首領倒、同伴倒一半，失敗一律撤退；shift 敵人最高深檔；白蕾絲門檻 60 寫成常數（改 netcombat 規則表要同步）。
- 寫不出來：依橋參數挑手段、流形蕾絲中途變色、野生粉蕾絲與迷宮館「不扣線」（需 `wild` 之類欄位，給 defeat-net／maze）、野生白蕾絲警報、閘門守衛打倒等於破解（歸 netrun）。
- 平衡疑慮：會換檔的首領退淺檔後受感載 ×0.5，低一級隊伍打 IV 級黑蕾絲首領要 86 回合——審查／平衡看。（審查：根因是數字；內海感載不消退的新規則 M3 修正批已做，平衡要重跑。）
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-hack-net 回報（2026-11-24）

- 快駭兩個戰場都能用；內海每用一次加程式的 `trace`（只算我方）；現實失敗或被打的人沒倒下時，戰後把 trace 合計成目標勢力敵對值。
- 給 M3-skill-net-a/b：abilities 格式要收 `trace` 鍵（兩欄），否則技能做的快駭讀不到。
- 腳本沒有 `trace` 欄位；誤報 IV、牌子的追蹤加減、跳線沒做。
- ITEMS 11.9 十六支程式缺的效果（誤報增援延後、斷藥、遺忘、誘導、繳械、推檔、白噪等）留給規則資料或後續工單。

## M3-defeat-net 回報（2026-11-24）

- 內海戰敗認得被定位（目標勢力的預設）、白蕾絲不算贏的人、扣線狀態進戰敗畫面；條件 `defeat_net`、`defeat_tethered`。
- 內海戰敗接受後 `activity.end` 的 result 多 `net`、`tethered`、`located`（給 netrun 決定被定位的敵對值 +5）。
- `origin.ext.located_event` 由 netrun 填。
- 野生粉蕾絲、迷宮館「不扣線」要在 netcombat／enemies 加 `wild` 之類欄位（未做）。

## M3-netrun 回報（2026-11-24）

- 子網一趟（開始、生成、探索回合、閘門、休息點、遭遇開戰或潛行繞過、登出、被定位）；放行清單 `NETRUN_ALLOW`；ADR 0018 補記三段。
- 取捨（審查看）：`ext.net.foes` 等照圖分開；探索回合算節點圖上每個節點；守閘門的是離入口最遠的遭遇；~~`fx.trace_half` 只減半效果進來的正數~~（M3 修正批：探索與戰鬥自己寫的上升也減半）；追蹤度量表一趟結束後不清；休息點「不在遭遇前面」生成器不保證。
- 給 M3-commission-net（重要）：`FACE_KINDS` 處理要把 `face.net` 的 `retreat` 改成帶 `rewind: entry`、`located` 照戰敗算失敗。
- 給 M3-netrun-nodes：檔案庫與下載、控制節點、人、陷阱、巡邏、安全點、六種目標都歸它；用途往 `usesOfMarker` 加。

## M3-summons-net 回報（2026-11-24）

- 內海的守衛程式：`net_guard_deploy/command/move/recall`（另開 id，因核心行動名稱是靜態字串）；上限內海基底 1 加 `overlay_cap`；指揮花型號的 RAM；醫療型在內海排感載。
- ~~核心缺口：`run.overlayHurt`／`damageOverlay` 對感載類傷害一律 0，內海打不到守衛程式（測試以 `it.fails` 留著）→ M3-core-fix-a。~~ 已做（M3-core-fix-a）：內海的感載類傷害打在耐久上、無視護甲，現實仍無效；`it.fails` 改成 `it`。
- 給 enemies：敵方 `enemy.command` 只有現實；給 abilities：`kind: drone` 選項要照 `net` 旗標過濾。
- 構裝體（M6）、群眾（M5）沒做。

## 待 M4：成人場景的單人模式（使用者 2026-11-24）

- 自慰／單人場景（直播的成人時段、拍親密素材、住處紓解、流竄 AI 的夢）目前不存在；設計與實作都移到 M4，和多人分圈、夜課一起做。
- 設計時要列出哪些技能與體位在單人模式不能用（使用者提醒）。提案草稿：節奏取代契合、沒有主動權、主導/迎合改加快/放慢、說話只在直播對觀眾、直播時彈幕要求當直播目標。
- 2026-11-24：媒體設計書改了（雜談、七種剪片角度、頻道搬到 MEDIA 第 4 節）。ui 的舊示範（`data/channel.ts`、`data/media.ts`、`dialogs/CutDialog.vue`、`lib/combat/opinion.ts`）還是舊的四種角度與「實況」，M5 換引擎時一起改；engine 沒有寫死。

## M3-ui-netcombat 回報（2026-11-24）

- 內海與現實共用 `BattleBoard.vue`／`useBattle.ts`；同步檔位、追蹤度、管理行動三個面板；舊 Demo 的內海與現實規則刪除。
- 缺正式圖示：refill、script、tool、shift、admin、hack（暫借別的圖，別名在 combatIcons.ts 末尾）。
- 給核心或 netcombat：匯出行動 id 常數（`net_shift`、`adm_` 前綴、`net_attack`）；`BattleActionOption` 給 `admin` 欄；`netBattleView` 只有我方單位（敵方檔位與破損沒有資料）。
- 給 M3-commission-net／ui-commission-net：`tests/commission/M2-ui-commission.test.ts`〈面卡：沒有開放的面〉期望 `face.net` 未開放，現在 netrun 已放行，測試要改。
- 給 M3-ui-subnet：`SubnetScreen`、`stores/subnet.ts` 還送舊的 `/netcombat?enc=`，要接引擎的戰鬥。

## M3-netrun-nodes 回報（2026-11-24）

- 檔案庫與下載、放東西、控制節點、人、閘門破解／憑證／後門鑰匙、擦痕跡、安全點、六種目標、巡邏、陷阱、帶出去才算數。暫定數字都在 `netrun_rule`。
- **要補**：主角的主控階數讀不到（只讀 `actor.ext.paths`）。由 abilities 提供衍生數值 `master_tier`，netrun 的 `masterTier`（checks.ts）改讀它 → 交給 M3-skill-net-a。
- 隱形類構裝讓巡邏擦身而過沒做（要 netcombat／deck 介面）；印記、機關等詞條歸 netrun-dig。
- 給 M3-commission-net：setup 的 `objective`、`controls`；result 的 `goal`、`controls`、`lost`。給 M3-ui-subnet：`netrunView` 新欄位與節點用途 id。

## M3-ui-deck 回報（2026-11-24）

- 內海分頁接引擎 deck；示意包開局送 II 級入門甲板與構裝、腳本、SKIN（`ui/src/data/demo/net.ts`）。
- 示意包暫時補了 `jam_weapon`、`jam_defense`、`jam_tool` 三個 battle_status；M3-data-rules 補進正式規則表時要拿掉。
- 引擎沒給、所以沒顯示：染色、SKIN 風格與曝露度、牌子脾氣、藥與義體對同步的影響、換 SKIN 的地點限制（M3-dive）、換檔次數。

## M3-commission-net 回報（2026-11-24）

- 委託副本的內海面：layer、lace、objective、controls、隔離區（locked_by）、六個新連動鍵、Run.trace、內海評價與後果；face.net 的 retreat 回到進副本之前、located 算失敗並 +5 敵對值。
- 內海規則另放 `DEFAULT_NET_RULES`（M3-data-rules 加進 `commission_rule/default`）。
- **給 M3-fixer-net**：生成的內海面要寫 `layer`，之後把 `netFaceProblems` 的 layer 改回必填。
- 為了不破 M2 的 toEqual 測試而留的權宜（M3 收尾或修正批清掉）：`FaceView.locked` 只在鎖住時出現；`defeat_event`、`employer` 放在 setup 不放 origin.ext；fallout 的 net 欄位只在走內海時出現；舊的 `aux.pressure.net` 仍寫入鏡像。
- 寫不出來：內海竄改班表的「增援延後」。

## M3-fixer-net 回報（2026-11-24）

- 生成委託的內海面（layer、lace、facility、目標、隔離區與鑰匙連動）、出發追蹤度照敵對值（記名 15、通緝 30）與踩點取最高、任務板的內海提示；commission 的 layer 改回必填（ui 的測試 fixture 已補 layer）。
- 規則另放 `DEFAULT_FIXER_NET_RULES`（給 M3-data-rules：補進 fixer_rule/default 並讓 M2-data-rules 測試認這三個欄位）。
- 解讀待確認：還沒登記 face.net 時內海面照 M2 寫法；潛行 need 只能一項基本功（照種子挑）；兩次內海踩點自然 1 的追蹤度仍疊加；~~生成時不檢查內海敵人挑不挑得到~~（M3 修正批：已檢查，挑不到整件重抽）。
- 五型：竊密能做；抹除、竄改、心智只能近似；網內打撈不做。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-skill-net-a 回報（2026-11-24）

- 槍手、潛網者、改造師、機師四棵樹的內海欄（測試資料在 engine/tests/fixtures/skills/）：槍手 23 做 1 近似；潛網者 15 做 9 近似 2 寫不出來；改造師 14 做 4 近似 4 寫不出來；機師 6 做 3 近似 9 等 M6。
- 新鍵：欄的 `instinct`、`action: true`（被動技能在這一欄多一個行動，手術刀用，**待使用者認可**）、`trace`、`use.weapon_ram`、`trigger.tag`、`react.damage`、`react.flash`、`attack.suppress.first_round`、修正 `use_extra`。
- `master_tier` 衍生數值（主角裝著潛網者招牌、照累計歷練點）；netrun 的 masterTier 改讀它。
- 順手修：技能花管理行動送 `net.admin_spend` 用 `n`（原本送 `amount` 會被擋）。
- 缺的效果與修正 13 項（net.cut、技能管理行動的追蹤度、net.unpin、讓人拔線、ram_regen、overloaded、改目標、免疫釘住、牆減傷、破損輕重、net.fix 全部、每場次數、我方／敵方格目標）→ 交 M3 審查或修正批決定。
- 待確認：超頻骰數取「花掉的 RAM − 1」；內海壓制只對花全部 RAM 的技能與壓制姿態放行；SKILL_TREES 沒寫技能快駭的追蹤度數字；共鳴不分欄。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-ui-subnet 回報（2026-11-24）

- 子網畫面重寫接引擎（地圖、迷霧、層、探索回合、追蹤度、目標、化身、這裡、管理行動、登出確認）；刪掉舊的 stores/subnet、data/subnet。
- 給引擎（審查或修正批）：巡邏 `visible` 用曼哈頓距離、`seen` 用視線，不一致；`netrunView` 要給這一層看過的標記（id、名字、種類、處理過沒）、擦痕跡剩餘次數、巡邏名字、選項的 RAM/DC；追蹤度三段說明沒資料。
- 缺正式圖示：機關、印記、休息點、安全點。
- 給 M3-ui-commission-net：委託開了內海面時導到 `/subnet`。
- 可清：ui/stores/game.ts 的 `lastBattle.kind` 'subnet'。
- 2026-11-24 使用者裁決（skill-net-a）：被動技能欄的 `action: true`（手術刀的除錯）認可；超頻骰數取「花掉的 RAM − 1」；內海壓制只對花全部 RAM 的技能與壓制姿態放行；共鳴不分現實與內海（不用分欄）。

## M3-ui-commission-net 回報（2026-11-24）

- 副本頁的追蹤度條、隔離區面卡、回到子網、內海階段的結果行與路線後果；網內行程一開就導到 /subnet；接案與踩點的內海提示。示意包：內海類型 steal_net、寫好的四階段內海委託（阿蓮雜貨後間）、三勢力的蕾絲、子網區、潛艙店「浮標」。
- 給引擎（審查或修正批）：`commission_link` 內容的檢查不認六個內海新鍵；內海階段的 loot 與接管的控制節點只在 activity.end 的 result，建議記進 RouteEntry 或 Run（讀檔後副本頁看不到）；輔助失敗那一行沒資料；lace 指定顏色時閘門守衛也只挑那個顏色。

## M3-skill-net-b 回報（2026-11-24）

- 名媛、掮客、主播、偶像的內海欄（測試資料 engine/tests/fixtures/skills/）；新鍵 lure、masked、command、remote_call、flow、link/song 等；`resonance.net`（只在內海生效的共鳴，媒體型用）。
- 缺的核心掛點（交 M3 審查／修正批）：`load.before`（偶像分擔只能事後對帳）、釘住發 `check.before`、追蹤度跨門檻掛點、戰鬥裡的偽裝被看穿與協力、現金百分比修正。
- 待使用者：應援連結的人怎麼選（現在照站位）；哪些導流技能 0 階灰掉；老粉都在沒頻道也加 1；名媛、掮客的共鳴兩邊都算；內海欄放行 tease_hit、tease_bonus、give_ap_cap。
- 給 M3-data-rules：`focused`、`pacified`、`drowsy` 狀態要補進正式規則表。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。
- 2026-11-24 使用者裁決（skill-net-b，照建議）：應援連結維持自動（從站位前面接）；洗版、圍觀、插播要導流 ≥1，曝光、灌流、直擊 0 階可用；老粉都在沒頻道算不算等 M5 定；名媛、掮客共鳴兩邊都算、媒體型用 resonance.net；內海欄放行 tease_hit、tease_bonus、give_ap_cap。
- 2026-11-24 使用者裁決（駐顏，照建議）：變貌潮 2030 年代、重新包裝 2050～2054 認可；路人性別比例維持兩成；用字維持「扶他」；轉換療程維持「先驗受體」。

## M3-dive 回報（2026-11-24）

- 從接入點潛入（付費、租甲板、訪客）、選去處（net_site）、登出、被強制斷線自動登出；活動 dive 與放行清單；格子用途 dive.enter／dive.exit。
- ~~缺：甲板 cooling 需要衍生數值 `deck_cooling` 給 netrun 的探索回合讀~~（netrun-dig 做了；M3 修正批改成內海感載消退量 `net_load_decay` 的一個來源，戰鬥與探索都算）；`safe` 欄位沒人讀；投影、帶潛、多人一起潛、身體在現實出事都沒做。
- 待確認：潛入中任何網內戰敗被接受都自動登出（認 result.net），但被定位只認 origin.by === 'dive'（迷宮館那一趟被定位要迷宮館自己處理）。（M3 修正批：一般的子網照舊；迷宮館／熔斷場地打輸不走戰敗、不強制登出。）
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-netrun-dig 回報（2026-11-24）

- 自己去挖的子網：設施類型與詞條（net_facility、net_affix）、追蹤度起點、7 天內再進去是同一張圖、留後門、被定位後多雜兵、每探索回合 5 分鐘、離開時的敵對值；衍生數值 `deck_cooling` 讓所有 netrun 探索回合多消退感載。
- 待確認：每探索回合 5 分鐘目前也套到迷宮館（maze 不想吃要在 rounds.ts 的 roundTime 加條件）；「再進去」的細節照代理暫定；`trap_marked` 讓所有陷阱一開始就看得到。
- 詞條與企業脾氣有不少要加鍵（換班、內鬼、維修通道、星旗定位倒數、控制節點多一個等），交修正批或內容匯入。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-maze 回報（2026-11-24）

- 合法迷宮館：三組報名（新手組租比賽甲板）、9×7 三層、機關、寶箱與寶箱怪、警報叫兵、層間休息、回合計數（核心計數器）、評價與獎金結算；打輸只斷線（field.safe 或贏的人全帶 wild 標籤就不扣線）。
- 動到 netrun 的 4 處選填加法：NetRegion.puzzle、handled；layerSpec 放機關；usesOfMarker 略過 handled 標記。
- 接縫建議（審查／修正批）：netrun 加「踩陷阱」與 `netrun.descend` 掛點（現在靠 action 字串）；ext.net.traps 形狀寫進 0018 第十三節；FEATURES 順序 maze 必須在 dive 後（dive 的 afterReport 不冪等）；deck 提供「租用時預裝槽」讓新手組發比賽版構裝。
- 沒做：延長賽、直播、主題 d8、詞條、籌碼物品與兌換（暫用現金計數）；engine/data 沒有 maze_rule/maze_table（寶箱表空的）。
- ~~ADR 0018 待補實作補記~~：M3-smoke 補齊。

## M3-ui-dive 回報（2026-11-24）

- 潛入與登出對話框、去處、迷宮館報名與面板、自己去挖的抬頭、離開結算頁；示意包加潛艙店的潛入、自己去挖的去處與兩種設施、迷宮館的遊戲敵人與寶箱獎品表。
- 給引擎（審查或修正批）：net_site 沒有迷宮館的種類（建議 `kind: 'maze'` 或 sites() 列出迷宮館）；netrunView.dig 缺 `left`（上次離開的日子、剩幾天重整）；離開那份報告的 timeline 應帶 `data: result`（loot、敵對值數字）。
- 平衡疑慮：示意主角（夜巡 III）打 grade 3 的迷宮館遊戲敵人卡在 AP 0 僵局 54 回合以上——審查或平衡看。（審查：示意包的三個遊戲敵人沒有 constructs；M3 修正批多了資料檢查的警告 `Game.contentWarnings()`，示意包要補構裝。）
- ~~潛入中主畫面仍可走格子和做現實的「這裡」（引擎放行 commit:world.），沒擋~~（B024，M3 修正批修好：腳下是現實的街時擋下，原因「先登出」）。

## M3-data-rules 回報（2026-11-24）

- 新增規則表：sync_rules、deck_rules、netcombat_rules、netrun_rules、net_regions（subnet、maze、wreck、deep）、net_facilities（六種）、net_enemy_rules、maze_rules、maze_tables；battle_modes 加 net；battle_statuses 加 7 個；event_scopes 的 net 加 login/logout；commission、fixer 加內海欄位；暫定格子列在 data/index.ts 的 PROVISIONAL_M3。
- 待定：net_facility 每層控制節點數設計書沒寫；深海壓力條是沉溺但 net_region.pressure 只收 trace/none；scene 的 PARTNER_GEAR_DOWN_AT、SINK_CAP 未進資料。
- 全套跑時 M3-maze〈評價照回合數與倒下人數〉一次逾時，單獨跑過——冒煙或修正批查。

## M3-smoke 回報（2026-11-24）

- 冒煙全過（內海戰鬥、內海委託、生成的內海委託、撤退、戰敗、被定位、中途存讀檔、潛入、自己去挖、迷宮館）；逐一拿掉功能全過；兩份重播檔；不變式 156～170；分層檢查多三條。
- ~~bug：B023（內海 AI 武器構裝破損後不換構裝，拖成僵局）、B024（潛入中還能在現實街上走、跨區、買東西）~~：M3 修正批都修好、測試搬進主套件。
- ~~既有待確認實測：中間人生成委託不檢查內海敵人挑不挑得到，兵種表缺首領時整件做不完。~~（M3 修正批：已檢查。）
- 2026-11-24 提醒：M4 開工時，(1) 拍賣行、各區氛圍、零件合成、訂做零件、向 NPC 學工藝這五樣先補規則草案給使用者確認；(2) 建角點數那一張（M4-creation-*）開工前請使用者過一遍；(3) 單人模式不能用的技能表（0019 第十六節）開工前請使用者確認。

## M3 審查的使用者裁決（2026-11-24，排進 M3 修正批）

- 6 題照建議：網內放行所有成人場景（戰敗事件、流竄 AI）；委託內海階段沒有橋或甲板的人自動留在現實當輔助；閃斷那一回合可以回填但不能用花 RAM 的攻擊；迷宮館打輸醒在館方回復室（不強制登出、不沒收潛艙店押金、不走一般戰敗事件，迷宮館押金照沒收）；追蹤度增援只在這一場跨過門檻才叫；內海消退與換檔交給平衡。
- **新規則：內海單位的基礎感載消退是 0**（戰鬥每輪與竄網探索回合，敵我都一樣），有技能或特殊效果的例外：消退量由修正／衍生數值提供，甲板散熱（deck_cooling）是其中一個來源。設計書 CYBERSPACE 第 6 節、ITEMS 甲板散熱同步改。
- 「中間人生成委託時不檢查內海敵人挑不挑得到」升為應修。

## M3 引擎修正批（2026-11-24，cpp-architect；dev/work/M3-fix-review.md、dev/adr/0018「M3 修正批」補記、不變式第 171～184 條）

- 做完：必修 1（netrun／dive 放行成人場景；戰敗事件開場景走得完）、必修 2（迷宮館報名要在潛入中、每個隊員有橋、潛入中有能用的武器構裝）、應修 1～8（預備只加一次、連動減半對探索與戰鬥有效、網內檢定體格換意志、迷宮館結算還原潛艙店的甲板、委託內海階段沒有橋或甲板的人留在現實當輔助、閃斷那一回合花 RAM 的行動灰掉、熔斷場地打輸醒在回復室、netrun 不直接改 `actor.ext.deck`）、新規則（內海基礎感載消退 0、`net_load_decay`）、B023、B024、中間人生成先問內海敵人、建議 1～5、網內的程式或蕾絲沒有構裝的資料警告。
- 內海感載消退量 = 戰場 `decayBase`（0）＋ `net_load_decay`（單位的 `decay`；甲板的散熱 `deck_cooling`、技能欄的 `decay`、之後的藥與狀態）＋ 修正 `decay`，沒有 mod(意志)；現實不變。探索回合 = `netrun_rule.decay`（0）＋ `net_load_decay`。`deck_cooling` 定案：戰鬥與探索都算。
- 還沒做：M3-ui-* 回報給引擎的缺口（net_site 沒有迷宮館的種類、`netrunView.dig` 缺 `left`、離開那份報告的 timeline 帶 `data: result`、`netrunView` 要給這一層看過的標記與擦痕跡剩餘次數與巡邏名字、`commission_link` 的檢查不認六個內海新鍵、內海階段的 loot 與接管的控制節點記進 Run、輔助失敗那一行沒資料）；`deck` 的「租用時預裝槽」；設計書的同步（CYBERSPACE 第 6 節與 8.1 節、CORE_RULES 4.2 節、ITEMS 甲板散熱、BALANCE 第 4 節的 netrun 假設）；平衡要重跑（沒有消退之後的內海戰鬥）。
- 2026-11-24 使用者：M3 的白箱與邊界測試留到明天額度重置之後再開；今天做完介面跟改、重建介面成品就停，不自動進 M4。

## M4 單人模式的使用者回饋（2026-11-24，M4-scene-solo 開工前定案）

- 加 3～5 個單人專屬姿勢（例：雙腿張開、跪著）。草案：張腿仰躺、跪姿、趴伏翹臀、跨坐抱枕（跨坐在枕頭或抱枕上磨蹭）、側躺（側身躺著，一腿屈起，前後都碰得到，最放鬆、節奏較穩）。（「對鏡」只是氛圍，不寫進規則與文件。）
- 考慮成人道具的使用：道具可以當連接的來源接自己的部位（跳蛋、按摩棒、假陽具、吸吮器、自綁的拘束帶等），部分道具給節奏加成。
- 說話類、可以表演給觀眾看的技能，從「不能用」移到「要有觀眾才能用」。草案候選：說悄悄話、我來教你、你說哪裡就哪裡、不可以喔、歡迎回來主人、今晚的客人。
- 2026-11-25 技能改名（41 個）：docs、ui 手寫資料、圖示已改；**engine/ 待改**（白箱跑完後）：engine/data/rules/abilities.json 8 處、engine/src 15 處（多為註解）、engine/tests 159 處（fixtures/skills 與 M1b-skill-*、M3-skill-net-* 等；要分辨是名字比對還是 id）。對照表在 dev/reviews/2026-11-25-skill-names.md。

## 2026-11-25 M3 白箱／邊界／探針（cpp-tester-whitebox）完成
- tsc 0 錯；npm test 243 檔 6739 條全過；pending：B009 + B025～B029。
- M3 新增程式分支覆蓋 90.59% → 92.14%（敘述 96.98%）。邊界 107 條、白箱 66 條、探針 1 條（紀錄 dev/reports/net-commission-probe-2026-11-25.md）。
- 舊白箱檔搬到 engine/tests/features/M3-*；W016 改編 B028。
- bug：B025 迷宮館收 AI 追蹤度、B026 追蹤度 100 開戰不會被定位、B027 RAM 下限吃掉甲板加值、B028 net_broken 沒帶到下一場、B029 餘韻戰鬥外不消退。
- 待使用者裁決：B026 90～99 開戰的時點、B027 讀法、B028 修好時點、B029 要不要現在修；規格小問題（追蹤度範圍、連動減半與上限順序、潛入中換腳本、防火牆 11+等級寫進 ENEMIES）。
- 使用者裁決（2026-11-25）：白箱 bug 與規格問題都照建議。工單 dev/work/M3-fix-whitebox.md；文件代理改 NETRUNNING／ENEMIES／ITEMS／CORE_RULES 對應段。之後：引擎技能改名 → 介面 v13 → M3 收尾。
- 2026-11-25 使用者：M3 修完之後 M4 可以自動開始；M4 要確認的細節現在提。設計書 v195（白箱裁決）。已請 cpp-architect 補拍賣、未登錄零件、學工藝的工單與靜水消退。待使用者過一遍：建角點數（M4-creation-body）。
- 2026-11-25 使用者：外觀選項做第 1（補唇、聲音、腳）、2（臀腿手加多、體型改具體）、4（髮色漸層雙色與街頭色、眼色拆細），另加更多髮型並分短中長；已派文件＋介面代理。
- 2026-11-25 M3 白箱修正批完成：engine 6779 條、smoke 129、pending 只剩 B009、ui 723；invariants 185～193；B025～B029 已修。付錢修構裝要等設施資料（repair_construct），介面未接，記進 M4-followups 第 7 項。
- 2026-11-25 引擎技能改名完成（34 檔 182 處；id 未動）；engine 6779、smoke 129、ui 723。介面示意 v13 發布（https://claude.ai/artifact/68i6kPwEhCgJTxJLPZdg9z）。**M3 收尾。**
- M4 開工（使用者：修完自動開始）。第五波 8 題（M4-plan 第 23～30 題）待使用者裁決，不擋第一～四波。
- 2026-11-25 使用者：M4 第 23～30 題都照建議；文件補寫排在下一個空位。M4 第一步（core-product、scene-seats）進行中。
- 2026-11-25 M4 第一步完成（core-product、scene-seats）：engine 6874、smoke 129、ui 723。場景舊形狀外觀留到 M4-ui-scene 拿掉（已補記工單）。
- 2026-11-25 M4 第二步完成（core-passive、scene-circles）：engine 253 檔 6949 條全過。
- 2026-11-25 使用者：略過場景照現在這樣（不加「一律略過」設定）；略過時允許玩家輸入指令引導經過與正文寫法（LEWD 3.1、AI_TASKS 3.7、M4-core-scene-ai、M4-ui-scene 已補）。
- 2026-11-25 使用者：新增輸入欄做 2（戰鬥與戰敗的寫法指令）、3（稱呼）、4（送禮附一句話）、5（化身外觀描述）、6（片的標題與簡介）；1、7、8 不做。設計書已寫（COMBAT 8.3、NPC_SYSTEM 6.3／7.0、CYBERSPACE 4、MEDIA 剪輯）。標題畫面：主標題 CyberpunkPink、副標題緋夜城（ui 與 mockup 已改）。
- 工單分配：2 → M4-core-scene-ai（外殼的戰鬥／戰敗正文同一套）與 M4-ui-scene 旁的戰鬥畫面；3、4 → M4-followups（人物）；5 → M4-followups（化身）；6 → M5-plan。
- 2026-11-25 使用者：玩家輸入的指令我們這端不篩選、不提示，玩家決定最高；不合規由服務商擋。已改 LEWD 3.1、COMBAT 8.3、NPC_SYSTEM、CYBERSPACE 4、MEDIA 與工單。
- 2026-11-25 使用者：世界的固定規則（成年、不寫血腥、不寫懷孕）放在 AI 工坊任務提示詞（H5、H16、H17），玩家可改；我們只擋內容資料的年齡欄位。已改 PROMPTS、AI_TASKS、GAME_DESIGN、UI；介面跟改記在 M4-followups。
- 2026-11-25 M4 第三步完成（cyberware、scene-solo）：engine 255 檔 7054 條全過。單人模式照 LEWD 3.5 第九點的數字（設計書優先於工單）。待使用者：跪姿『不用減骰』在單人沒有意義，改成什麼。
- 2026-11-25 使用者：傳奇線定案（四條一對一、傳奇階開放、任務→任務→副本、終幕兩段、wall 以 5 為界並放寬範圍 −6～+12、計數器不對稱不修、M6 做引擎），寫進 STORY_QUESTS 第 2 節。內容討論中：每條終幕要有緋夜城傳奇人物。
- 2026-11-25 使用者：傳奇內容草案定（緋夜祭加星旗王牌機師『雷鳥』莫里森；終幕傳奇照常戰鬥、沒碰上時生成同級關尾首領；不死；四條線的結局效果）。寫進 STORY_QUESTS 第 2 節、NPCS 10.1／10.7b。
- 2026-11-25 使用者：白槌之夜擴張的每週上繳跟伊甸園好感掛鉤（80+ 10,000／60～79 7,500／40～59 5,000／20～39 2,500／<20 停發）。
- 2026-11-25 M4 第五步完成（cyber-deck、craft，加 testkit wearDeck 修舊測試）：engine 7197、smoke 133、ui 723 全過。
- 2026-11-25 M4 第六步完成（cyber-battle、craft-salvage）：engine 7274、smoke 133、ui 723 全過。新增工單 M4-core-gaps（第十九步甲欄先做）收核心的五個缺口。待使用者：藥泵每劑都不花行動點（照 EQUIPMENT 4.1、ITEMS 4.1）還是每場一次（ITEMS 藥泵-100 那列）。
- 2026-11-25 使用者：藥泵每劑都不花行動點（ITEMS 藥泵-100 已改）。
- 2026-11-25 M4 第七步完成（cyber-lock、medical）。
- 2026-11-25 M4 第八步完成（drugs、sink）。
- 2026-11-25 M4 第九步完成（abilities-m4、ui-body）：engine 7505、smoke 139、ui 750。
- 2026-11-25 M4 第十步完成（creation-body、ui-craft）：engine 7538、smoke 139、ui 755 全過；bridge legacy 過渡已拿掉。
- 2026-11-25 M4 第十一步完成（creation-lifepath、nightclass）：engine 7620、smoke 141、ui 755。新增工單 M4-night-resonance（第二十步甲欄，補十七個寫不出來的共鳴與幾種學習條件）。
- 2026-11-25 **M4 第一波（身體）完成**（第十二步 ui-creation、tuning）。
- 2026-11-25 介面示意 v14 發布（M4 第一波）。第二波開工。
- 2026-11-25 M4 第十三步完成（scene-net、malware）：engine 7735、smoke 145、ui 752。
- 2026-11-25 M4 第十四步完成（scene-close、contract）：engine 7824、smoke 147、ui 752。待使用者：契約抗拒的沉溺懲罰疊不疊。
- 2026-11-25 使用者：契約抗拒只留 EVENTS 4.5 的沉溺懲罰；刪掉規矩「能不能接別人的指令」。
