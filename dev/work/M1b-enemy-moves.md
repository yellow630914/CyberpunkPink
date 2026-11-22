# M1b-enemy-moves

- 交給：cpp-feature（sonnet）
- 目標：敵人的招牌行動（和技能同一套格式與效果）、低血大招、AI 怎麼用它；敵人資料裡名冊轉不進去的欄位的格式與效果：一定帶著的特徵與開戰時擲的特徵、沉溺、義體、甲板、天使急救的會員。內容（名冊）不動。
- 規格出處：ENEMIES 第 2 節（`signature`、`traits`、`angel` 三列）、4.3 節（挑行動的表與底下三條）、4.5 節（低血大招、控制保護）、第 5 節（特徵）、12.1 節只看「溺感邊緣」相關的第一段；ENEMY_ROSTER 開頭第五段（招牌行動的份量）；dev/adr/0015 E10、E11；dev/status.md 最後「名冊轉不進格式」那一條。
- 可以改的路徑：`engine/src/features/abilities/`（技能的 `enemy` 版與 AI 的分數）、`engine/src/features/enemies/`（格式、特徵、天使急救、把資料掛到單位上）、`engine/tests/features/M1b-enemy-moves.test.ts`。
- 可以用的介面：M1b-skill-format 的格式；`BattleActionDef.aiScore`、`aiTarget`；`k.content.defineKind`；掛點 `unit.ready`（有 `run.rand()`）、`out`、`round.start`；單位的 `implants`、`ext`、`tags`；`BattleSetup.origin.ext`。
- 不可以做的事：不改核心；`abilities` 與 `enemies` 不互相 import（敵人只把招牌行動的 id 放到 `unit.ext.abilities.equipped`，技能那一邊本來就認）；不改 `engine/data/world/enemies.json`（現在寫成敘述的招牌行動照樣載得進來）；溺感者的「過線」不做。

## 一、招牌行動＝標了 `enemy` 的技能（`features/abilities`）

- `ability` 多一種：`enemy: true`。不必寫 `path`、`tier`、`layer`、`cap`、`xp`、`after`、`category`；不能學、不能裝進橋（`learnBlock` 回「這不是學得到的技能。」）。`kind`、`use`、`meat`、`text` 照一般的技能；公式的 `tier` 代單位的等級。
- 多一段 `ai`：`{ score, first_rounds?: 加幾分（第一、二回合）, when?: 條件, unlock?: 'low' }`。
  - 註冊成行動時給 `aiScore`：條件（技能自己的 `blocks`、`needs`、`when`）不符回 `null`；否則回 `score`。沒有 `ai` 的技能 AI 不用。
  - `unlock: 'low'`：生命 ≤ 40%，或餘韻疊到承受層數 − 1 才解開；每場一次；解開之後分數 +1。
  - 反應、被動、姿態不用分數：裝著就有（姿態在 AI 的第一個回合自己開）。
- 玩家的技能也可以寫 `ai`（之後 AI 操縱的夥伴用得到），這一張不驗。

## 二、敵人資料多收的欄位（`features/enemies`）

| 欄位 | 格式 | 效果 |
|---|---|---|
| `signature` | 每一筆是字串（技能的 id，要查得到而且標了 `enemy`），或 `{ name, text }`（還沒轉的敘述：收下、不做效果） | 字串的放進 `unit.ext.abilities.equipped` |
| `traits` | 特徵的 id 陣列（引用下面的 `enemy_trait`；查不到的當成純標籤，照舊） | 一定帶著 |
| `cyber` | `[{ kind, name, contract? }]` | 變成單位的 `implants` |
| `deck` | `{ grade, firewall, slots: [...] }` | 原樣放到 `unit.ext.deck`（M1b-hack 讀） |
| `mods.sink` | 0～120 | 記在 `unit.ext.enemies.sink`；80 以上多一個標籤 `sink_edge`。這一張不做別的效果 |
| `angel` | `none`、`silver`、`gold`、`platinum` | 倒下時開始倒數（4、3、2 回合；`round.start` 數）；到了記一拍、標成被帶走（`unit.ext.enemies.taken = true`；E11） |
| `defeat` | 字串或字串陣列 | 只放寬格式 |

## 三、特徵（內容種類 `enemy_trait`，是規則表）

`{ id, name, desc, mods?: { hp_pct, hit, ap, load_cap, layers_max, evade, initiative }, ai?: { flee_below, prefer, never_flee, morale_dc }, start?: [效果…], tags?: [...], roll?: { weight, kinds: ['human'…] } }`

- `mods` 在單位組好時算進去；`start` 在開打時做一次（帶著餘韻：`afterglow` +1）；`tags` 加到單位上（契約人：`contract`）；`morale_dc` 加在士氣的 DC 上。
- 開戰時擲（E10）：有 `roll` 的特徵才會被擲到；每個符合 `kinds` 的敵人擲兩次、各 30%（首領各 50%），擲中就照 `weight` 抽一個、不重複。遭遇寫 `traits: false` 就不擲；`setupFromEncounter` 把它帶進 `origin.ext`。
- 這一張用假資料驗；ENEMIES 第 5 節那十一個特徵哪幾個寫得出來列在回報裡（預期「掛著攝影機」「有人在等他」「天使急救會員」要別的系統）。

## 四、驗收條件

- 一筆假的招牌行動（主動、花 2 點、命中 +1、`ai.score` 3）：AI 的敵人在固定骰面下會用它；條件不符時不在候選裡。
- 低血大招：生命 41% 時不在候選裡，40% 時在、分數多 1，用過之後不再出現。
- 招牌是反應的敵人（相鄰的友軍被攻擊時命中 −2）：玩家打他旁邊的人時觸發、扣他的行動點。
- `learnBlock` 對標了 `enemy` 的技能回那一句；主角裝不上。
- `signature` 寫成 `{ name, text }` 的敵人載得進來、開得了戰；寫了查不到的 id 時載入被擋，訊息裡有那個 id。
- `cyber` 兩件 → 單位有兩件 `implants`、`cyber` 是 2；`deck` 放到了 `ext.deck`。
- 特徵：一定帶著的每場都有；`mods.hp_pct: -40` 的生命只剩六成；`start` 的餘韻開打就有；`traits: false` 的遭遇沒有人擲到；同一個種子兩次開打擲到的一樣。
- `angel: 'gold'` 的敵人倒下三回合後有一拍、被標成被帶走。
- 契約人特徵的人不檢定士氣（現有的規則認 `contract` 標籤）。
- 現有的 `M1-enemies`、`M1-data-enemies` 測試全過（名冊一筆都不用改）。

## 依賴

M1b-core-effects、M1b-core-overlay、M1b-ops、M1b-skill-format。會改 `features/abilities`，和其他改它的工單不要同時做。

## 完成時回報

改了哪些檔、測試結果、十一個特徵與名冊裡招牌行動的寫法（抽十個）哪些寫得出來、哪些還缺鍵。
