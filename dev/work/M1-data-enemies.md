# M1-data-enemies

- 交給：cpp-data
- 目標：把 ENEMY_ROSTER 裡現實的制式兵種（約 135 筆）轉成 `enemy` 資料，加上十場基準遭遇與一筆通用的戰敗事件，放進 `CORE_PACK`。
- 前置：`dev/work/M1-data-rules.md`、`dev/work/M1-enemies.md`、`dev/work/M1-defeat.md` 都做完了（`enemy`、`encounter`、`defeat_event` 三種內容的格式在那兩個功能裡，`weapon_class` 在資料裡）。
- 規格出處：ENEMY_ROSTER 開頭五段與第一到第五部分（第六部分「輿論戰的對手」、第七部分「具名敵人」、最後的「隨機地圖的兵種」不轉）；ENEMIES 1.6 節（各勢力的等級範圍）、第 3 節的站位表、8.1 節（勢力的預設打法）、第 13 節開頭的點數表。只讀這幾處。
- 可以改的路徑：`engine/data/world/enemies.json`、`engine/data/world/encounters.json`、`engine/data/world/defeat_events.json`（都新增）、`engine/data/index.ts`、`engine/tests/data/`、`engine/tests/pending/M1-data-enemies.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（格式就是 schema）：`dev/work/M1-enemies.md` 第三節的兩張欄位表（實作在 `engine/src/features/enemies/`）；`dev/work/M1-defeat.md` 第二節的 `defeat_event`（實作在 `engine/src/features/defeat/`）。驗證：`new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })` 加 `game.k.content.checkRefs()`；點數用 `encounterPoints`（`engine/src/features/enemies/`）。
- 不可以做的事：
  - 不改 `engine/src/`、`ui/`、`docs/`。格式不夠用（名冊上有的東西沒有欄位可以放）就停下來回報。
  - 不補設計書沒寫的數字，不改寫名冊上的文字。名冊兩處不一樣時停下來回報，不自己挑。
  - 不轉網內的東西（種類是蕾絲、程式、化身、內海的）、不轉具名敵人、不轉「無人機與砲塔」與「敵方的機師」那兩節（和人重疊的敵方單位與機甲之後才有）。
- 驗收測試：`engine/tests/pending/M1-data-enemies.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-data-enemies`。通過之後 `git mv` 到 `engine/tests/data/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、一共幾筆、測試結果、名冊裡轉不進格式的地方（一條一條列）。

## 一、`enemies.json`：一個兵種一筆

名冊的每個兵種是一個四級標題（名字與 id）、一張一列的表、幾個項目。對照：

| 名冊 | 資料 |
|---|---|
| 標題「警備局巡查（`en_hz_patrol`）」 | `id`、`name` |
| 所在的三級標題（緋櫻重工 `hizakura`） | `faction`。第五部分（溺感者、吉祥物）寫 `none` |
| 表的「位階」 | `rank`：雜兵 `minion`、精英 `elite`、首領 `boss` |
| 表的「等級」II～III | `grades: [2, 3]`；只有一級寫兩個一樣的 |
| 表的「種類」 | `kind`：有橋的人 `human`、沒有橋的人 `unbridged`、機器 `machine`、吉祥物 `mascot`。括號裡的補充不轉 |
| 表的「站位」2～3 | `position.prefer: [2, 3]`。`cover_use` 只在名冊寫了的時候放（例：「不換位（cover_use 0）」） |
| 表的「打法」 | `mode` |
| 表的「戰敗」 | 寫「預設」的不放；寫了 id 的放 `defeat`（去掉反引號） |
| 樣子 | `desc`，原文照抄 |
| 數值修正 | `mods`。「照表」不放。生命 ×1.1 → `hp: 1.1`；感載 ×0.8 → `load: 0.8`；護甲 +2 → `armor: 2`；迴避 −1 → `evade: -1`；攻擊 +1 → `attack: 1`；行動點 +1 → `ap: 1`；承受層數 +1 → `layers: 1`；敏感度 40 → `sensitivity: 40`。後面的說明文字不轉 |
| 武器 | `weapons`，一把一筆，照名冊的順序。`class` 用 `weapon_class` 的 id：近戰 `melee`、霰彈槍 `shotgun`、手槍 `pistol`、衝鋒槍 `smg`、步槍 `rifle`、狙擊槍 `sniper`、輕機槍 `lmg`、重武器 `heavy`、感官彈槍（與其他遠距的神經武器）`neural_gun`、電擊鞭與費洛蒙霧（近身的神經武器）`neural_melee`。名冊給了名字就放 `name`；傷害類型和類型的預設不一樣時放 `type`（物理 `physical`、熱能 `thermal`、電磁 `em`、神經 `neural`、快感 `pleasure`）；寫了穿甲、彈匣、距離就放 `pierce`、`mag`、`range`（都是這一把最後的值）；「命中時把目標拉近一格」是 `traits: ['pull']`、「推一格」是 `['push']` |
| AI | `ai: { prefer, focus, flee_below }`，照抄數字；寫「不撤退」的加 `never_flee: true`、`flee_below: 0` |
| 招牌行動 | `signature`：一個一筆 `{ name, text }`，`text` 是冒號後面的原文。這一批只收文字，不做效果 |
| 掉落 | `loot`：一樣東西一筆 `{ text }`，原文 |
| 成人場景 | `adult`：標籤的陣列（「服從、束縛」→ `['服從', '束縛']`）；名冊寫沒有成人場景的放 `null` |

鍵的順序固定：`id`、`name`、`faction`、`rank`、`grades`、`kind`、`mode`、`position`、`mods`、`weapons`、`ai`、`defeat`、`signature`、`loot`、`adult`、`desc`。檔案裡照名冊的順序排。

驗收測試逐項比對的三筆（照上面的規則轉出來就會對）：`en_hz_patrol`、`en_hz_riot`、`en_hz_hk_maid`。

## 二、`encounters.json`：十場基準遭遇

設計書沒有一張「遭遇表」（真正的遭遇跟著委託模板，M2）。這十場是平衡與冒煙測試用的基準：組成照 ENEMIES 第 13 節與平衡模擬（一般遭遇是四個雜兵 4 點，首領戰是一個首領加三個雜兵 8 點），兵種由 cpp-architect 從名冊挑好了，照抄：

| id | name | grade | kind | foes（照這個順序） |
|---|---|---|---|---|
| `enc_base_g1_normal` | 基準遭遇：野良（I 級） | 1 | `normal` | `en_nora_hound` ×2、`en_nora_pickpocket`、`en_nora_courier` |
| `enc_base_g2_normal` | 基準遭遇：緋櫻的巡查（II 級） | 2 | `normal` | `en_hz_patrol` ×4 |
| `enc_base_g2_boss` | 基準首領戰：野良（II 級） | 2 | `boss` | `en_nora_hound` ×2、`en_nora_courier`、`en_nora_packleader` |
| `enc_base_g3_normal` | 基準遭遇：緋櫻的警備局（III 級） | 3 | `normal` | `en_hz_riot` ×2、`en_hz_patrol` ×2 |
| `enc_base_g3_boss` | 基準首領戰：蜜糖會（III 級） | 3 | `boss` | `en_honey_head`、`en_honey_dancer` ×3 |
| `enc_base_g4_normal` | 基準遭遇：鉻娘子（IV 級） | 4 | `normal` | `en_chrome_brawler` ×2、`en_chrome_rider` ×2 |
| `enc_base_g4_boss` | 基準首領戰：緋櫻的家政課（IV 級） | 4 | `boss` | `en_hz_riot` ×3、`en_hz_hk_seat` |
| `enc_base_g5_normal` | 基準遭遇：鉻娘子（V 級） | 5 | `normal` | `en_chrome_brawler` ×2、`en_chrome_pourer` ×2 |
| `enc_base_g5_boss` | 基準首領戰：鉻娘子（V 級） | 5 | `boss` | `en_chrome_brawler` ×2、`en_chrome_pourer`、`en_chrome_officer` |
| `enc_base_g1_light` | 基準的小衝突：野良（I 級） | 1 | `light` | `en_nora_hound`、`en_nora_pickpocket` |

每一筆的 `cover` 都寫 `medium`（平衡模擬的假設）；`foes` 的每一筆是 `{ "enemy": id }`，不寫 `grade`。檔案裡照這張表的順序（冒煙測試拿第一場 I 級的遭遇）。

## 三、`defeat_events.json`：一筆

```json
{ "id": "df_generic", "name": "通用的戰敗", "kind": "generic", "factions": [], "fails_commission": true, "default": true,
  "versions": { "default": { "text": "你們全倒下了。再醒來的時候，對方已經走了。", "effects": [] } } }
```

M1 的戰敗事件只做略過版；二十九種各自的內容與後果在 M2。這一筆是那之前的通用版本，沒有損失。

## 四、`engine/data/index.ts`

`CORE_PACK.content` 加 `enemy`、`encounter`、`defeat_event` 三個鍵（排在 `faction`、`weapon_class` 後面；`encounter` 在 `enemy` 後面）。`SOURCES` 加：`enemy` 寫 `ENEMY_ROSTER 第一到第五部分（現實的制式兵種）；ENEMIES 1.5、1.6 節`；`encounter` 與 `defeat_event` 寫 `dev/work/M1-data-enemies.md（基準，M2 換成委託模板與二十九種戰敗事件）`。

## 五、已知的事

1. 驗收測試檢查：總數在 130～150 之間、二十九個勢力每一個都有、每個兵種的等級範圍落在勢力的範圍裡（ENEMIES 1.6 節）、`mods` 只有規定的那幾個鍵。名冊上有兵種的等級超出勢力的範圍時，照名冊轉，並回報（測試會紅在那一筆，不要改數字讓它過）。
2. 名冊的數值修正如果有上表沒有的寫法（例：「行動點上限 6」「護甲照 IV 級」），不要硬塞進 `mods`：那一筆先照得出來的部分轉，回報裡列出來。
3. 招牌行動的機制（每個兵種一到三個）、掉落表的格式、無人機與砲塔、敵方的機師，之後另外開工單。
