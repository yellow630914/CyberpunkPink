# M4-followups

- 交給：cpp-feature（sonnet）
- 目標：五個既有功能在 dev/status.md 標了 M4 的待辦，各一小段：戰敗（丙丁戊三組的效果接得上、資料檢查）、名冊（沉溺 100、看穿藏著的沉溺）、帳單（鎖義體、簽契約真的發生）、休息（破損、舒適的接口）、打工（沒有動到 M4-venues 的部分）。
- 規格出處：COMBAT_SYSTEM 8.3 節；dev/work/M2-plan.md 使用者定案裡戰敗事件丙、丁、戊三組那張表；NPC_SYSTEM 10.6 節（「他的沉溺到 100」「主角的沉溺到 100」「藏著沉溺的時候」）；DOWNTIME 5.2 節（付不出來）；FIXER 第 4 節（下坡路）；CYBERSPACE 6.5 節破損「下一次休息拿掉」；EVENTS 2.4 節 `hostility_floor`；dev/adr/0017 M2 修 bug 批第 25 項；dev/status.md 的「defeat 留下的」「roster 沒做的」「bills 沒做的」「M3-netcombat 回報」。
- 可以改的路徑：`engine/src/features/defeat/`、`engine/src/features/roster/`、`engine/src/features/bills/`、`engine/src/features/rest/`、`engine/src/features/director/model.ts`（只加一條內文檢查）、`engine/tests/features/M4-followups.test.ts`。
- 可以用的介面：效果 `cyber_take`、`cyber_install`、`cyber_lock`、`tuning`、`malware`、`contract_sign`、`sink_floor`（都用登錄表查：有人註冊才用）；條件 `sunk`；衍生數值 `sink_shown`；掛點 `scan.person`（讀 `hide`）；`features/bills` 現有的旗標與 `bill.settled`；`features/roster` 的名冊、忠誠、離開；`features/defeat` 的事件格式與 `defeat.gear`；`rest.done`；`makeCheck`。
- 不可以做的事：不寫戰敗事件的內容；`handed_over` 轉雇主、`police` 轉 `arrest`、多段的現金上限、版本比例不在這一張；五個功能之間不互相 import；共同的規定見 dev/work/M4-plan.md。

## 要做的

**戰敗（`features/defeat`）**

1. 丙組（身體被改）、丁組（沉溺與污染）、戊組（契約）的戰敗事件用到的效果現在有人註冊了：寫一組測試資料（每組一件），確認載得進來、接受之後效果真的落下（`tuning` 被強制裝上、`cyber_take` 拿走一件、`malware` 種下、`contract_sign` 簽下去）；存檔規則「戰敗時拿走義體與裝備」關著時，`defeat.gear` 回答 true 的那幾筆被拿掉、其餘照常。對應的功能沒裝時那一筆效果照現有的規則在載入時擋下（不是這一張的事，確認訊息指得出是哪一件）。
2. 資料檢查：戰敗事件裡的 `hostility_floor` 一定要寫 `days`（沒寫的整件擋下並指出來）。`features/director/model.ts` 加同一條內文檢查給範圍是 `contract` 的事件。
3. 內海的 `pinned`、`polluted` 這兩種：事件格式不用改；補一條測試，確認贏的那一方是粉蕾絲而資料寫 `defeat: 'pinned'` 時走到那一件，而且裡面的 `malware` 效果（帶 `pool: 'lace'`）落得下去。

**名冊（`features/roster`）**

4. 他的沉溺到 100（每週結帳那一刻檢查名冊上每個人的 `sink`）：離開名冊，原因記 `sunk`，立旗標 `sunk_away:<npc>`（之後以別的身分出現是內容）。
5. 主角的沉溺到 100：看的是別人看到的沉溺（`sink_shown`，沒有人註冊就看真正的）。每週結帳時每個同住或這一週同行過的人各擲一次看穿（主角有藏的時候才擲）：他的調查或街頭直覺取高的，加親密度每 20 點 +1，對 10 ＋ mod(意志) ＋ 定力 ＋ `hide` × 2（`hide` 問 `scan.person`）。看到的值到 100 的那一週：忠誠 70 以下的人離開（原因 `pc_sunk`）；親密度 80 以上而且他自己沉溺 40 以上的人立旗標 `follows_down:<npc>`；其餘留下。只發生一次（旗標 `pc_sunk_done`）。

**帳單（`features/bills`）**

6. 付不出來的後果（DOWNTIME 5.2 節）現在只有旗標：鎖義體那一段改成發效果 `cyber_lock`（鎖一件最貴的？沒有資料可比，改成「照槽順序第一件非橋的」：不給 `uid`、給 `on: true` 與 `why: 'debt'`，讓 `cyberware` 自己挑）；簽契約那一段改成發效果 `contract_sign`（`holder` 是規則表寫的債主，預設伊甸園；`type: 'debt'`；`debt` 是欠的總額）。兩個效果都查不到時照舊只立旗標。補繳之後解鎖（發 `cyber_lock` 帶 `on: false`、`why: 'debt'`）。

**休息（`features/rest`）**

7. ~~喘口氣與睡一覺清 `net_broken`~~：M3 白箱修正批已做（只有睡一覺清，喘口氣不清；CYBERSPACE 6.5 節）。這一項只剩：構裝店的設施資料加 `repair_construct`（匯入時）與介面接「修理構裝」。
8. 睡在診所的病床（`sleep.treated`）時另外發效果 `treated`（有人註冊才發），讓 `medical` 的狀況一致。

**打工（`features/work`）**

9. 派去打工的人是主角持約的契約人、打工的人是契約人：都不在這一張（M5 的派工、`contract` 的 `report.before`）。這一張只把結算報告的 `action` 與錢的那一筆變更的形狀寫進檔頭的註解（`contract` 靠它認），並補一條測試守著那個形狀。

## 驗收條件（`engine/tests/features/M4-followups.test.ts`；需要的功能在各自的測試裡一起裝，另外各有一條「那個功能沒裝」的對照）

- 戰敗：三組各一件事件接受之後，對應的狀態變了；存檔規則關著時 `cyber_take` 那一筆沒發生、同一件事件裡的錢照扣。`hostility_floor` 沒寫 `days` 的戰敗事件載不進來、訊息指出事件的 id；範圍 `contract` 的事件同一條。
- 名冊：一個沉溺 100 的成員過了週一不在名冊、旗標在。主角真正 100、看到的 80、`hide` 1：固定骰子沒看穿時沒有人離開；看穿的那個人（忠誠 60）離開；主角沒有藏時忠誠 60 的離開、忠誠 80 的留下、親密度 85 而且自己沉溺 45 的有 `follows_down` 旗標。第二週不再發生。
- 帳單：走到鎖義體那一步時假的 `cyber_lock` 被叫到（`why: 'debt'`）；補繳之後被叫到 `on: false`；走到簽契約那一步時假的 `contract_sign` 被叫到、`debt` 是欠的總額；兩個效果都沒註冊時行為和現在一樣（`M2-bills` 的測試不改全過）。
- 休息：帶著 `net_broken` 喘口氣之後還在、睡一覺之後沒有了；睡診所的病床時假的 `treated` 效果被叫到。
- 打工：結算報告的形狀那一條。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-lock、M4-sink、M4-contract、M4-malware、M4-tuning、M4-medical。和 M4-venues、M4-sink 不要同時做。

## 完成時回報

改了哪些檔、測試結果、帳單的債主是誰寫在哪個規則、名冊「這一週同行過」怎麼判斷、戰敗三組裡還表達不出來的效果（預期：怪癖、容量減半、`unbridged` 把橋拿掉）。

## 總指揮補記（2026-11-25，M4-core-passive 回報）
- `passiveProblems` 加選填的 `source`：來源是 `cyber`、`drug`、`gear` 時擋掉 `{ stat: 'ram_regen' }`（會繞過節奏資源 +1 上限），原因寫「每回合的 RAM 回復請用修正 `ram_regen`。」。
- `sink_floor` 只擋掉一部分時也提醒一句（「身上的義體讓你只浮到 N。」）。
- `gear_cap` 要不要拿掉、`passiveProblems` 查 `stat` id 是否存在：交 M4-data-rules／M4-smoke 一起看。

## 使用者新增的輸入欄（2026-11-25）
- 稱呼（NPC_SYSTEM 7.0）：`npc` 的人物狀態多 `call_them?`、`call_me?`（最多 12 字），正文與程式句子照用；介面在人物詳情加兩格。
- 送禮附一句話（NPC_SYSTEM 6.3）：送禮的 env 多選填 `note`（最多 200 字），寫進共同記憶；親密度不變。
- 化身外觀描述（CYBERSPACE 4）：`actor.ext.avatar.text`（最多 200 字），進 AI 的角色資料；介面在化身分頁。
- 共同：玩家寫的文字不經我們這端篩選、改寫或提示，原樣交給 AI；不合規的由服務商擋（使用者 2026-11-25）。

## 介面跟改（使用者 2026-11-25：世界的固定規則可改，只擋年齡）
- `ui/src/lib/worldCheck.ts`：拿掉 `FLOOR_WORDS` 的字串比對（血腥、懷孕），只留年齡欄位低於 18 的檢查；測試跟著改。
- `ui/src/dialogs/SettingsDialog.vue`、`ui/src/screens/NewGameScreen.vue` 的「LOCK 不寫血腥，不寫懷孕」那一行改成說明：「這是世界的固定規則，寫在 AI 工坊的任務提示詞裡，預設帶著，可以在 AI 工坊改。」
- `ui/src/screens/WorldEditorScreen.vue` 第 217 行的說明改成「只擋格式錯誤與年齡低於 18 的人物」。
- AI 工坊示意：H5、H16、H17 從鎖住改成可改、可恢復預設（PROMPTS 2.5 節）。

## 總指揮補記（2026-11-25，M4-cyberware 回報）
- 成人場景的七個基本部位 `BASE_SCENE_PARTS` 現在 scene 與 cyberware 各抄一份：搬成核心常數，兩邊改 import。
- CYBERWARE 第 3 節寫不成被動效果的三件，交給對應工單：痛覺編輯器「生命值顯示變模糊」（M4-ui-body 的顯示規則）；記憶庫「被駭時讀走」（M4-security-m4 的掃描掛點）；駭入接頭「不經無線、追蹤度不漲、裝置裡的蕾絲感載 ×1.5」（M4-cyber-battle 的條件式規則）。
- 手術費暫不乘區的物價倍率：M4-data-rules 一起看。

- （使用者 2026-11-25）跪姿：前後兩條連接都在時，這回合自己的感載 +1d4（LEWD 3.5 第九點已改）。scene 的 `solo_kneel` 把 `no_dice_minus` 換成這條規則。

## 總指揮補記（2026-11-25，M4-cyber-bridge 回報）
- 寫不成效果的橋機能，分給：被注視時消退加快、編輯點 +1 → M5；每七天要回聖堂 → 週期帳單（這一張看能不能用 `time.passed` 的每週檢查做）；回報後門（子網追蹤度漲得快、起跳 +5）→ netrun 的按勢力追蹤度修正（這一張）；熔斷器三條（初鳴第一次過載不疊餘韻、野戰無鎖一成多疊 1 層、聖堂自製沒有熔斷器）→ 這一張；內建錄影、授權鎖、忠犬 → M4-cyber-lock、M4-tuning。

## 總指揮補記（2026-11-25，M4-craft 回報）
- 精工：CRAFTING 10.1 寫「由做的人選」，現在自動加在 stats 合計最高的鍵。改成組裝時可以選（`assembleDraft` 收 `polish?: 鍵`，沒給照現在的自動選），介面在 M4-ui-craft 加一個下拉。
- 同人的成功率：設計書寫「成功率高」，現在是一定成功；先照現在，平衡時再看。
- 賣成品照 TRADE 8.3 只算零件（不算組裝的兩成），已照設計書做。
- 拆下來的二手零件放進成品時二手狀態會丟：要保留得在核心 `ProductData` 加每個零件的狀態，M4-craft-salvage 看要不要做。
- 套裝加成與排異的效果沒有人算：交給 M4-craft-salvage 或 M4-cyber-battle（看哪張碰得到），做不到就回報。
- testkit 的報告前綴清單補 `craft`：M4-smoke。

## 總指揮補記（2026-11-25，M4-craft-salvage 回報）
- 二手零件狀態進成品：要核心 `ProductData` 加 `part_states?`，`readProduct`／`productOf`／`productPrice` 跟著讀。歸 M4-core-part-ai（cpp-architect 角色，第 47 張，本來就動核心的零件格式）一起做。
- 排異（CRAFTING 第 6 節，失敗時沉溺成本上升）：確認 M4-cyber-battle 有沒有接；沒有就歸這一張。
- 解剖的數字（一小時、60 分鐘、沉溺 +1、敵對值 +5）是 `enemies/dissect.ts` 的常數：M4-data-rules 搬進規則表。
- testkit 的報告前綴清單補 `craft`（含 salvage、swap）與 `enemies.dissect`：M4-smoke。

## 總指揮補記（2026-11-25，M4-cyber-battle 回報）
- 快取格放行大小 2 以下的義體成品（P47：戰地手術 `implant_install` 要從快取格拿得到）：`gear/quick.ts` 的 `quickBlock`。
- `implant_kind` 沒寫時：設計圖 `slot` 是 `arm`、`leg` 的預設對成 `limb`（`off_limb`）。
- 藥泵的專屬圖示鍵 `pump`：交 cpp-ui 畫，畫好後 `cyber_pump` 改用它，`M1-picks` 的圖示鍵清單補上。
- 熔斷器三條、回報後門：見 M4-core-gaps 第 4 項（回報後門）；熔斷器三條歸這一張。
- 核心的五項見 dev/work/M4-core-gaps.md（第十九步先做）。

## 總指揮補記（2026-11-25，M4-medical 回報）
- 戰鬥裡治重創有兩個 op：`combat` 的 `wound { mode }` 與 `medical` 的 `wound_treat`。統一用 `medical` 的 `wound_treat`；`combat` 的 `wound` 改成轉呼叫同一套邏輯或標成舊的（不能 import 就由資料改用新的），M4-abilities-m4 的技能資料一律寫 `wound_treat`。
- 肢體「接回還是直接換義肢」（TRADE 3.4）：重創手術的選項多一個「換義肢」，接到 cyberware 的安裝（用效果或掛點，不互相 import）。
- 治療與重創手術的價錢乘區的物價倍率：M4-data-rules 一起看（和手術費同一件事）。

## 總指揮補記（2026-11-25，M4-cyber-lock 回報）
- bills 在 `bill.settled` 的行上多帶 `why: 'stopped' | 'grace'`，cyberware 讀到 `stopped` 的訂閱就鎖住（現在 skipped 一律不動，是一個繞法）。
- 第三種解鎖法（請潛網者偽造授權）：出口是效果 `cyber_unlock`，流程做成一件可以請中間人或夥伴辦的事（看 M4-training 的「請教」能不能共用）。

## 總指揮補記（2026-11-25，M4-sink 回報）
- 檢定標籤 `perception`、`resist_lure`、`resist_control` 現在沒有任何檢定帶：社交勸降、控制類快駭、契約指令（M4-contract、M4-lure）發起檢定時要帶。
- 斷線靜修期間關橋、禁止潛入：沒做，這一張補。
- 治療費乘區的倍率：M4-data-rules（和手術、治療同一件）。

## 總指揮補記（2026-11-25，M4-drugs 回報）
- commission 的放行清單加 `commit:drug.`、`commit:medical.`（副本進行中戰鬥外可以吃藥、急救）。
- 療程「蜜糖會好感 30 以上免費」接好感條件。
- 被戰鬥接住的「一場戰鬥」型藥：喘口氣、階段結束、睡覺都會結束（總指揮同意多加睡覺），不另設時間上限。
- ITEMS 4.2 寫不出來的藥效（止痛劑的四段顯示、強效止痛劑收回上限、諦聽與睡蓮對別人用、蝶粉的看到的沉溺、牆灰 10% 種吻、量表加減、搶拍只多第一回合）：能用現有效果寫的寫進資料並測，寫不出來的列給 M4-data-rules。
- `passiveProblems` 收下「`stat: ap_regen／ram_regen` 擋下」：見前面 core-passive 段，同一件事。

## 總指揮補記（2026-11-25，M4-ui-body 回報）
- 引擎匯出：沒有橋的那一組說明（P15：沒感載、沒 RAM、裝不了技能、潛不進去）；衍生數值的中文名（`statName`）與戰鬥修正的中文名（`MOD_NAMES`），介面改讀引擎、拿掉 `ui/src/lib/bodyView.ts` 的對照表。
- 痛覺編輯器的設計圖 `tags` 要寫 `pain_editor`（M4-data-rules）。
- 介面（交 cpp-ui，排進下一張介面工單）：MainScreen／HomeScreen 開診所前先問 `clinicGate()`；背包對話框的藥可以「使用」；藥泵圖示 `pump`、各件義體自己的圖示。

## 總指揮補記（2026-11-25，M4-abilities-m4 回報）
- 容量變小的提醒現在由 abilities 自己接（`ability.capacity`）：拿掉 cyberware 換橋那句「容量比舊橋小」，連同 `M4-cyber-bridge.test.ts` 那條斷言一起改。
- 橋機能「重傷時技能不失效」：COMBAT_SYSTEM 沒有重傷讓技能失效的規則，這句的意思要在匯入那座橋的資料時對設計書（CYBERWARE 7 節）確認；「駕機甲時同步上限 +1」等 M6 的機甲條件。

## 總指揮補記（2026-11-25，M4-ui-craft 回報）
- gear 匯出 `coveredSlots(k, state, actor)`（外套蓋住哪幾格），ui 的 store 改讀它、拿掉用 `styleOf().seen` 推的那段。
- 內海 SKIN 染色：`dyeDraft` 收 SKIN（純外觀、免費），ui 的 `DyeDialog` 拿掉 `where: 'net'` 的舊分支與 `data/items.ts` 的依賴。
- 組裝、換零件、拆解、解剖的「誰來做」：畫面加隊友選擇（引擎有 `by`）。
- 舊假目錄 `ui/src/data/items.ts` 還有 game.ts、deckView.ts、HomeScreen、NewGameScreen、creation.test 在用：之後的介面工單逐步換掉。

## 總指揮補記（2026-11-25，M4-creation-lifepath 回報）
- 設計書優先：生命軌跡條目的 `hostility` 也收 `result` 層（CHARACTER 第 6 節 `took_the_fall` 的寫法），和 `result.npc.hostility` 兩種都認。

## 總指揮補記（2026-11-25，M4-tuning 回報）
- 渴求「餘韻消不掉」：`character` 的每十分鐘消退與 `rest` 的消退讀 `no_load_decay`／餘韻開關，戰鬥外也成立。
- 忠犬：條件「指定的人」（`bound_to`）與事件效果（替他擋傷害、對象死了或背叛）；共鳴「搭檔過載時自己也受一半」；冰后「餘韻沒有正面效果」「親密關係不降低沉溺」：能做的做，做不到的列給內容階段。
- 聚光的「被注視」條件與觀眾人數：M5（直播）。

## 總指揮補記（2026-11-25，M4-ui-creation 回報）
- abilities 的 `creation.step` 答案直接回「會裝上／裝不下」的清單（照 `creationLoadoutDraft` 的真實算法，含容量折扣），ui 改讀它。
- 從 features 的 index 正式匯出 `NO_BRIDGE_NOTE`、`NO_BRIDGE_ABILITY`、`treeTierOf`（或放進 `creationSummary().notes`），ui 改從 index import。
- 外觀推導（外露的義體、獸化、風格：ui 的 `derivedLooks`、`CYBER_LOOK`、`GEAR_STYLE`）搬進引擎：cyberware 與 gear 各回答一段。
- 正式內容的 origin 要帶 `kit_free`（現在示意包在載入前補）。

## 總指揮補記（2026-11-25，M4-malware 回報）
- 竊聽花：commission 讀條件 `malware_leak`，出發時警戒起始值加上去（數字照 CYBERWARE 第 5 節）。
- 妖精的吻擴散階段「替你做決定」「想傳給和你親近的人」：交 M4-lure（蠱惑那張同一類的插選項）。
- 惡意韌體的 `remove` 路花時間、診所價錢乘區倍率與蠕蟲潮 +50%：M4-data-rules 一起看。
