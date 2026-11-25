# M4-data-rules

- 交給：cpp-data（sonnet）
- 目標：M4 的規則表進 `engine/data/rules/`（只有規則，不含內容），並把測試與示意包裡暫時補的拿掉。
- 規格出處：各工單「新的格式與鍵」裡每一種 `*_rule` 的預設值（以功能的 `DEFAULT_…` 為準）；dev/adr/0019 第十四節的內容種類清單與第十五節的暫定值；dev/work/M3-data-rules.md（照它的做法與 `engine/data/index.ts` 的 `PROVISIONAL_M3`）。
- 可以改的路徑：`engine/data/rules/`、`engine/data/index.ts`、`engine/tests/data/M4-data-rules.test.ts`。
- 可以用的介面：每個功能匯出的 `DEFAULT_…` 與它的 `ruleProblems`；`loadCore`（或現在載入 `engine/data` 的那個入口）；現有的資料測試（`engine/tests/data/`）。
- 不可以做的事：不放任何內容（設計圖、零件、藥、調校、惡意韌體、夜課、體位、流竄 AI、事件、敵人、八個夜、未登錄零件的預設清單、拍賣行與拍品、教工藝的 NPC 都不放）；不改功能的程式；數字和功能的預設不一樣時以設計書為準並回報，設計書沒寫的照功能的預設並列進 `PROVISIONAL_M4`；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 新的規則表各一個檔（id 都是 `default`）：`cyber_rules.json`、`craft_rules.json`、`medical_rules.json`、`drug_rules.json`、`sink_rules.json`、`lure_rules.json`、`malware_rules.json`、`tuning_rules.json`、`contract_rules.json`、`night_rules.json`、`arena_rules.json`、`curtain_rules.json`、`gear_rules.json`；第五波的 `unreg_rules.json`、`auction_rules.json`。
   - `unreg_rules.json` 的 `options`（每種零件能帶什麼）是這一張要填的規則：照 CRAFTING 5.5 節那張「能帶的數值」的表一種零件一組，每一項的 `amount` 與 `cost` 照 CORE_RULES 7.4 節「一格等於」換算（命中 +1、迴避 +1、護甲 +1、一類檢定 +2、傷害半顆骰、RAM 上限 +1、感載上限 +4 各算一格；親和沒有寫，先當每 +1 半格）；`stats` 的鍵用 `features/gear` 與 `features/cyberware` 實際在讀的名字（查不到對應鍵的項目不放，列進回報）；板材與纖維的護甲照 5.5 節寫 `max_at`（I、II 級一份）。整張表列進 `PROVISIONAL_M4`（對 0019 P66）。`types` 的十二種、有沒有生體版、用在哪幾種成品（`kinds`）照 CRAFTING 2.1、2.2 節的兩張表。預設清單（`unreg_preset`）與怪癖是內容，不放。
   - `auction_rules.json` 照功能的預設；`cred_dirty.factions` 留空。拍賣行、拍品、競標者是內容，不放。
2. 既有的檔補欄位：`scene_rules.json`（多人、單人、結算的新數字；M3-data-rules 回報的 `PARTNER_GEAR_DOWN_AT`、`SINK_CAP` 如果功能已經改成讀規則就一起放）、`ability_rules.json`（升基本功、洗點、請教、學工藝的 `tutor`）、`creation.json`（點數的算法、可以買的類別）、`security_rules.json`（`readers` 留空、看穿與處罰的數字）、`net_enemy_rules.json` 或敵人的規則（`form_b_chance`）、`work_rules.json`（如果 M4-venues 加了規則）。
3. `event_scopes.json`：`rogue_ai` 的觸發點（`login` 0.15、`enter_floor` 0.10、`rest` 0.15；P22）；`contract` 加觸發點 `order`、`holder_order`（機率 1：有人發就挑）；`adult` 加 `arena_result`、`foe_sunk`、`impulse`（機率先給 1、0.5、0.3，列進暫定）。第五波：拍賣結束的觸發點 `auction_done` 放在現有的街頭那一個範圍（機率先給 0.3，列進暫定；沒有對應的範圍就不放並回報）。
4. `battle_statuses.json`：M4-enemies-m4 回報的幾個狀態（縛的兩種、挑的「下一次命中 −1」）、義體失效與超頻缺的種類（M4-cyber-battle 回報的 `off_<kind>`、`boost_<kind>`）。
5. `facility_types.json`：照設計書給既有的設施種類補 M4 的欄位——`clinic`（`clinic.grade: 'clinic'`，並新增無照與黑診所兩種種類如果清單裡沒有）、`tuning_clinic`（`tuning: { install: true, quiet_room: true }`）、`sanatorium`（`therapy: { kind: 'counsel' }`）、`mission`（`therapy: { kind: 'retreat', favor: … }`）、`aid_clinic`（`detox: { free: true }`）、`gun_shop`、`cyber_shop`、`apparel_shop`（`craft: { by: 'shop' }`、`dye: true`）、`fan_stall`（`craft: { by: 'doujin' }`）、`maker_direct`（`craft: { by: 'factory' }`）、`arena`（`arena: { grades: [1, 2, 3] }`）、`fan_stall` 與網內的委託台那一種（`unreg_desk: { faction: 同人眾的勢力 id }`；攤位只在週六開的寫 `weekdays`）。這些是規則（哪一種設施能做什麼），不是內容。拍賣行的設施種類要指到一家具體的拍賣行（`auction: { house }`），那是內容，不放。
6. `items.json` 的類別：現有帶 `drug` 標籤的示意藥改成類別 `drug`（只改類別，不加 `drug` 欄位的內容）。
7. `engine/data/index.ts`：`PROVISIONAL_M4` 列出每一格暫定的數字與它對到 0019 的哪一個 P 編號。
8. 清掉暫時補的：功能測試與 `ui/src/data/demo/` 裡為了跑起來而自己塞的規則表（各工單回報裡列的），改成用正式的；只列出要清的清單交給總指揮，`ui/` 不在這一張的路徑裡。

## 驗收條件（`engine/tests/data/M4-data-rules.test.ts`）

- 每一個新的規則檔載得進來、`ruleProblems` 是空的、每一格等於功能的 `DEFAULT_…`（不一樣的要在 `PROVISIONAL_M4` 或回報裡有理由）。
- `unreg_rules.json`：十二種零件類型都有名字；每一種有選項的類型，隨機的等級與種子跑 `frameOf` 一百次，`frameProblems` 都是空的、每一級都抽得到至少一條屬性（抽不到的類型列進回報）；`stats` 的每個鍵在 `features/gear` 或 `features/cyberware` 讀得到（用功能匯出的鍵清單比，沒有清單就在回報裡逐條列）。
- 帶著全部功能的 kernel 載 `engine/data` 沒有任何內容檢查的錯；`event_scopes` 的新觸發點在各自範圍的表裡。
- `facility_types` 每一種新欄位通過對應功能的格式檢查（用功能匯出的檢查函式，或直接跑一次「站在那種設施上，選項列得出來」）。
- 兩個戰場共用的門檻這類「兩邊各有一份」的數字照 M3 的做法比對一致（這一批的：`cyber_rule` 與 `medical_rule` 讀同一個 `clinic.grade` 的三個值；`contract_rule.resist` 與 `event_scopes.contract` 的機率不重複定義）。
- 現有的資料測試不改全過；`npm test`、`npx tsc --noEmit` 全過。

## 依賴

引擎的功能工單（1～35、44～46、48～50）都做完之後。

## 完成時回報

改了哪些檔、測試結果、`PROVISIONAL_M4` 的清單、和設計書不一樣而照設計書改的數字、要清掉的暫時資料清單、`unreg_rules.json` 的選項表（一種零件一行，給使用者與平衡看）與放不進去的項目。
- M4-data-rules：scene_rule 補 cost.move_circle、cost.call、multi_dice_minus、other_circle 四鍵，並拿掉 tests/data/M2-data-rules.test.ts 對這四鍵的排除（M4-scene-circles 回報）。
