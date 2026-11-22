# M1-data-abilities

- 交給：cpp-data
- 目標：把槍手與掮客兩棵技能樹（各 27 個技能、5 個共鳴）從 SKILL_TREES 轉成 `path` 與 `ability` 資料，放進 `CORE_PACK`。
- 前置：`dev/work/M1-abilities.md` 做完了（兩種內容的格式在 `engine/src/features/abilities/`）。
- 規格出處：SKILL_TREES 開頭的「讀表的方式」、「槍手：戰鬥直覺」整節、「掮客：人面」整節；SKILLS 1.3、1.9、1.10 節。只讀這幾處。
- 可以改的路徑：`engine/data/rules/paths.json`、`engine/data/rules/abilities.json`（都新增）、`engine/data/index.ts`、`engine/tests/data/`、`engine/tests/pending/M1-data-abilities.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（格式就是 schema）：`dev/work/M1-abilities.md` 第二節的兩張欄位表與第四節 `meat` 的鍵（實作在 `engine/src/features/abilities/`）。驗證：`new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })` 加 `game.k.content.checkRefs()`。
- 不可以做的事：
  - 不改 `engine/src/`、`ui/`、`docs/`。格式不夠用就停下來回報。
  - 不改寫設計書的文字、不補數字。`meat` 的機制只寫下面第三節列出來的那十一個；其餘的不要自己編鍵。
  - 只轉這兩棵樹；其餘六棵與夜課之後才轉。
- 驗收測試：`engine/tests/pending/M1-data-abilities.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-data-abilities`。通過之後 `git mv` 到 `engine/tests/data/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、設計書裡轉不進格式的地方（一條一條列）。

## 一、`paths.json`：兩筆，照這個順序

| id | name | tree | category | signature | domains |
|---|---|---|---|---|---|
| `gunner` | 槍手 | 戰鬥直覺 | `meat` | `sk_gunner_instinct` | `{ meat: "strong", net: "weak", opinion: "none" }` |
| `fixer` | 掮客 | 人面 | `social` | `sk_fixer_face` | `{ meat: "strong_support", net: "mid", opinion: "mid" }` |

`resonance`：共鳴表一列一筆 `{ tier, cells: 1, text: 效果那一欄的原文, effect }`。`effect`：槍手 1 階 `{ "initiative": 3 }`、槍手 2 階 `{ "free_move": { "per_fight": 1 } }`；其餘八筆都寫 `{ "pending": true }`。

## 二、`abilities.json`：一個技能一筆

### 對照

| 設計書的表 | 資料 |
|---|---|
| 技能 | `name`（去掉粗體的星號）；`id` 照下面的 id 表 |
| 所在的樹與階 | `path`、`tier`；`category` 和樹一樣；`xp` 是 `tier * 20` |
| 層 | `layer`：招牌 `signature`、前 `front`、後 `back` |
| 種類 | `kind`：主動 `active`（括號裡的「進攻的終極」等不轉）、被動 `passive`、反應 `reaction`、姿態 `stance`、預備 `prep` |
| 容量 | `cap` |
| 前置 | `after`：那個技能的 id；招牌不寫 |
| 消耗 | `use`：「3 行」→ `{ "ap": 3 }`；「每回合 1」→ `per_turn: 1`；「每場 1」「每場 2 次」→ `per_fight`；「—」不寫 `use`。裡面有行動點以外的東西（錢、人情、編輯點、「上回合留下的」、「開打前」、「每件委託 1」）時，把整欄的原文另外放進 `use.note`。「每回合重分配 1 行」（戰鬥直覺）只放 `note`。說明裡寫「只能在戰鬥的第一回合使用」的加 `first_round: true` |
| 份量 | `cells`：「2 格」→ 2、「1.5 格」→ 1.5；「招牌」→ 0 |
| 現實 | `text` 用這一欄的原文；這一欄是「—」時，用表格下方「預備與日常」裡這個技能的那一段，再沒有就用內海、輿論那一欄。`meat`：「—」→ `null`；第三節有寫的照抄；其餘 `{ "pending": true }` |
| 內海、輿論 | `net`、`opinion`：「—」→ `null`；其餘 `{ "pending": true, "text": 那一欄的原文 }` |
| 表格下方的「預備與日常」 | 提到這個技能的：預備的放 `prep: { "text": 原文 }`，日常的放 `daily: { "text": 原文 }`（「另有日常的效果」「日常的部分」都算日常）；沒提到的不寫這兩個鍵 |

鍵的順序固定：`id`、`name`、`path`、`category`、`tier`、`layer`、`after`、`kind`、`cap`、`xp`、`cells`、`use`、`text`、`meat`、`net`、`opinion`、`prep`、`daily`。檔案裡先槍手後掮客，各自照設計書的順序。

### id 表

槍手（前面都加 `sk_gunner_`）：

| 階 | 技能 → id |
|---|---|
| 1 | 戰鬥直覺 `instinct`、要害射擊 `aimed_shot`、掩護射擊 `cover_fire`、連射控制 `burst`、看我的！ `watch_me`、點放 `tap` |
| 2 | 定點射 `point_shot`、壓制姿態 `suppress_stance`、構裝精通 `loadout_mastery`、就是你了 `thats_you`、走開啦 `back_off`、幫槍槍保養 `gun_care` |
| 3 | 穿透 `pierce`、跑位射擊 `run_and_gun`、死線 `deadline`、獵眼 `hunter_eye`、掩護撤退 `covering_retreat` |
| 4 | 獵殺節奏 `kill_rhythm`、彈幕 `barrage`、心流 `flow`、下一個！ `next_one`、不准動喔 `dont_move` |
| 5 | 一槍定局 `one_shot`、火力牆 `fire_wall`、子彈時間 `bullet_time`、人槍合一 `gun_unity`、還給你～ `right_back` |

掮客（前面都加 `sk_fixer_`）：

| 階 | 技能 → id |
|---|---|
| 1 | 人面 `face`、集火 `focus_fire`、小心後面！ `watch_out`、戰前佈置 `prep`、換個位子嘛 `swap`、有我在 `im_here`、代理 `proxy` |
| 2 | 勸降 `talk_down`、擋 `block`、買版面 `buy_space`、再加一點嘛 `a_bit_more`、黑市門路 `black_market` |
| 3 | 收買 `bribe`、保釋 `bail`、情報網 `intel_net`、打他打他！ `hit_him`、派工網 `dispatch_net` |
| 4 | 增援 `reinforce`、布陣 `formation`、大局 `big_picture`、我有認識的人 `i_know_someone`、有話好好說 `lets_talk` |
| 5 | 總攻令 `all_out`、護盤 `hold_the_line`、全城欠我 `city_owes_me`、號令 `command`、人脈 `connections` |

## 三、已經有機制的十一個技能的 `meat`（照抄）

```json
"sk_gunner_instinct":   { "instinct": true }
"sk_gunner_aimed_shot": { "target": "enemy", "attack": { "aimed": true } }
"sk_gunner_burst":      { "target": "enemy", "attack": { "spend": "all", "min_mag": 2, "dice": "spent_minus_1", "suppress": { "dc": "spent", "skill": "composure" } } }
"sk_gunner_cover_fire": { "trigger": "ally_attacked_adjacent", "attack": { "at": "attacker" }, "on_hit": { "hit_against_ally": -2 } }
"sk_gunner_watch_me":   { "target": "enemy", "attack": { "hit": 1 } }
"sk_gunner_point_shot": { "cost": { "ability": "sk_gunner_aimed_shot", "ap": 2 }, "weapon_cost": { "trait": "aimed", "ap": 2 } }
"sk_gunner_thats_you":  { "target": "enemy", "apply": [{ "status": "marked", "until": "source_turn_start" }] }
"sk_fixer_face":        { "give_ap": { "max": "one_plus_half_tier" }, "call": { "options": ["shot", "cover_up", "cover_down"], "per_fight": "half_tier_up", "ap": 1 } }
"sk_fixer_focus_fire":  { "target": "enemy", "apply": [{ "status": "marked", "until": "source_turn_start" }] }
"sk_fixer_watch_out":   { "trigger": "ally_attacked", "evade": 3 }
"sk_fixer_swap":        { "target": "ally", "free_move": { "swap_adjacent_pair": true } }
```

定點射在設計書上的種類是「主動」，但它的效果是「要害射擊只花 2 點」：`kind` 照設計書寫 `active`、`use` 寫 `{ "ap": 2 }`，`meat` 照上面（沒有 `target` 的主動技能不會變成一個行動）。這一點如果功能的格式檢查不收，停下來回報。

## 四、`engine/data/index.ts`

`CORE_PACK.content` 加 `path`、`ability` 兩個鍵（`path` 在前；都排在 `skill`、`battle_status` 後面）。`SOURCES`：兩個都寫 `SKILL_TREES 槍手、掮客；SKILLS 1.3、1.9、1.10 節`。

## 五、已知的事

1. 寫 `pending` 的技能學得到、裝得上，但在戰鬥裡還沒有效果；之後每一批技能的工單會把它們換成真正的鍵。不要為了讓某個技能「有效果」自己編鍵。
2. SKILLS 第 13 節的樣本（`vital_shot`、`gun_instinct`、`use.ap: 2`）是舊的，不要照它；id 照上面的表、數字照 SKILL_TREES。
3. CORE_RULES 6.4 節舉例的容量和 SKILL_TREES 不一樣（要害射擊、人面）；照 SKILL_TREES。
