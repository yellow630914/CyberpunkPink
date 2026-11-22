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


- 2026-11-22 技術債：capture 敵人拿遠程武器時，核心 AI 的位置分會先讓他後退，輪不到制伏。M1-combat 先在 `ai.step`（order 10）替他制伏（features/combat/tactics.ts `registerCaptureAi`）。正本應該是核心位置分考慮「有可制伏的目標」，交 cpp-architect 在 M1 收尾時改。
- 2026-11-22 技術債：契約人不能投降（ENEMIES 4.4）、士氣的開場人數要在開場時記下（M2 增援），留給敵人招牌行動那批。
- 2026-11-22 名冊轉不進格式、留給第二波（敵人招牌行動、掉落、附屬單位那批）：mods 的「沉溺」、溺感邊緣、一定帶著的特徵（traits）、angel 欄位、position 的重疊（掛在格上的無人機與砲塔）、武器效果敘述（燃燒、義體失效、無視一半護甲、炸膛、卡彈、無聲…）、附屬單位（無人機、獵犬、飛劍、攝影機）、機甲 en_sb_mustang、快駭武器、雙戰敗 id（en_grd_caller）。名冊轉換腳本：tools/data_enemies_gen.py。
