# M1-data-rules

- 交給：cpp-data
- 目標：把現實戰鬥的規則數值（戰場、五種傷害類型、戰鬥中的狀態、武器的類型）、戰鬥中用得到的道具，以及兩張地圖的版面，從設計書轉成資料放進 `CORE_PACK`。
- 規格出處：COMBAT_SYSTEM 第 1.2、2.1、2.5、3、4、5、6、7 節；ENEMIES 1.5 節只看「位階的傷害倍率」那一條；ITEMS 5.2 節的表與「日用品」表；EVENTS 2.4.1 節只看「被壓住」那一列；DATA 9.3 節；COMMISSION_MAPS 第 1、2、8 節。只讀這幾處。
- 可以改的路徑：`engine/data/rules/`（新增 `battle_modes.json`、`damage_types.json`、`battle_statuses.json`、`weapon_classes.json`、`items.json`）、`engine/data/world/maps.json`（新增）、`engine/data/index.ts`、`engine/tests/data/`、`engine/tests/pending/M1-data-rules.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（格式就是 schema，都在核心，已經寫好）：
  - `battle_mode`、`damage_type`、`battle_status`、`weapon_class`：`engine/src/core/battle/rules.ts` 的 `BattleModeEntry`、`DamageTypeEntry`、`BattleStatusEntry`、`WeaponClassEntry` 與各自的 `validate`。核心帶著照設計書寫的預設值（`DEFAULT_MODES`、`DEFAULT_DAMAGE_TYPES`、`DEFAULT_STATUSES`）；資料要逐項寫出來，寫完之後 `modeOf`、`damageTypeOf` 算出來的和預設一樣。
  - `item`：`engine/src/core/content/kinds.ts` 的 `ItemEntry`。
  - `special_map`：`engine/src/core/grid/model.ts` 的 `SpecialMapEntry`、`SheetDef`、`MarkerDef`、`SpotDef`、`ControlDef`、`LinkDef`；格式檢查是 `specialMapProblems`（列數、每列的長度、圖例、標記和版面對不對得上、每一格從入口走不走得到、每張至少兩個遭遇點）。
  - 驗證的方法：`createKernel().content.loadPack(CORE_PACK)` 加 `content.checkRefs()`。
- 不可以做的事：
  - 不改 `engine/src/`、不改 `ui/`、不改 `docs/`。格式不夠用就停下來回報。
  - 不補設計書沒寫的數字；設計書兩處不一樣時停下來回報，不自己挑。
  - 地圖只收這兩張；其餘二十八個模板在 M2。
- 驗收測試：`engine/tests/pending/M1-data-rules.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-data-rules`。通過之後 `git mv` 到 `engine/tests/data/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題（特別是下面「已知的事」第 2 點）。

## 一、每個檔放什麼

`engine/data/index.ts` 的 `CORE_PACK.content` 加六個鍵：`battle_mode`、`damage_type`、`battle_status`、`weapon_class`、`item`、`special_map`；`SOURCES` 各加一行出處。`weapon_class` 引用基本功（`skill`），所以在 `CORE_PACK.content` 裡要排在 `skill` 後面。

### `battle_modes.json`：一筆，`id: "meat"`

照驗收測試「戰場 meat」那一段逐項寫（那一段就是 COMBAT_SYSTEM 的數字）。`net`（內海）不寫，M3 再加。

### `damage_types.json`：五筆（COMBAT_SYSTEM 第 5 節「傷害類型」的表）

| id | name | track | armor | 其他 |
|---|---|---|---|---|
| `physical` | 物理 | `hp` | 1 | |
| `thermal` | 熱能 | `hp` | 0.5 | `on_hit: [{ status: "burning", turns: 2 }]` |
| `em` | 電磁 | `hp` | 0 | `vs: { machine: 2 }`、`on_hit: [{ status: "jammed", turns: 1 }]` |
| `neural` | 神經 | `load` | 0 | `needs_bridge: true` |
| `pleasure` | 快感 | `load` | 0 | `needs_bridge: true`、`sink: 1` |

### `battle_statuses.json`：九筆

| id | name | 欄位 |
|---|---|---|
| `lose_turn` | 失去回合 | `lose_turn: true`、`until: "own_turn_start"`、`turns: 1`、`kind: "control"` |
| `suppressed` | 壓制 | `mods: { hit: -2 }`、`no_move: true`、`until: "own_turn_end"`、`turns: 1`、`kind: "debuff"` |
| `dazed` | 暈眩 | `turn_start: { ap: -2 }`、`once: true`、`until: "battle_end"`、`kind: "wound"`、`cleansed_by: ["wake_up"]` |
| `bleeding` | 流血 | `turn_start: { hp: -2 }`、`until: "battle_end"`、`kind: "wound"`、`cleansed_by: ["first_aid", "stop_bleed"]` |
| `limb_hurt` | 肢體受創 | `mods: { hit: -2 }`、`until: "battle_end"`、`kind: "wound"` |
| `burning` | 燃燒 | `turn_start: { hp_dice: 1 }`、`until: "own_turn_start"`、`turns: 2`、`kind: "debuff"` |
| `jammed` | 失效 | `until: "own_turn_end"`、`turns: 1`、`kind: "debuff"`（義體與智慧武器失效；效果由之後的功能讀這個狀態） |
| `marked` | 標記 | `mods: { hit_against: 2 }`、`until: "source_turn_start"`、`turns: 1`、`kind: "mark"` |
| `pinned_down` | 被壓住 | `turn_start: { ap: -1 }`、`once: true`、`until: "battle_end"`、`kind: "debuff"` |

每一筆的 `desc` 寫成完整的句子（照設計書那一條的原文）。

### `weapon_classes.json`：十筆（COMBAT_SYSTEM 第 5 節的武器表）

欄位照驗收測試「武器的類型」那一段，一列一筆，鍵的順序：`id`、`name`、`dice`、`far`（只有霰彈槍）、`type`、`range`、`mag`（近戰與鞭、霧不寫）、`cover_mult`、`pierce`、`traits`、`attr`、`skill`、`ap`（只有狙擊槍）。名字：近戰、霰彈槍、手槍、衝鋒槍、步槍、狙擊槍、輕機槍、重武器、感官彈槍、電擊鞭與費洛蒙霧（`neural_melee`）。表上寫範圍的（神經武器 2d6～4d6、彈匣 2～3、重武器「7d6 以上」）取驗收測試寫的那個值；快駭不是武器的類型，不收。

### `items.json`：ITEMS 5.2 節

| id | 設計書的名字 | 重點 |
|---|---|---|
| `it_zip_tie` | 束帶 | `category: "consumable"`、`grade: 1`、`legal: "free"`、`price: 10`、`tags: ["restraint"]`；沒有 `use`（它是制伏的條件，不是拿來「用」的） |
| `it_bridge_lock` | 鎖橋器 | `grade: 2`、`legal: "register"`、`price: 260`、`consumable: false`、`tags: ["restraint"]` |
| `it_medgel_1`～`_4` | 急救凝膠 I～IV | `use: { ap: 1, ap_other: 2, target: "ally", modes: ["meat"], effects: [{ op: "heal", amount: 8／12／16／24 }, { op: "cleanse", by: "first_aid" }] }`；價 40／140／430／1,620；合法 自由／自由／許可／違禁 |
| `it_coolant_1`～`_4` | 冷卻劑 I～IV | `use: { ap: 1, target: "self", modes: ["meat"], effects: [{ op: "afterglow", layers: -1（IV 是 -2）}, { op: "vent", amount: 4／8／12／12 }] }`；價 45／150／480／1,800 |
| `it_stop_bleed` | M2 止血針 | II 級；`effects: [{ op: "cleanse", status: "bleeding" }]`、`target: "ally"`、`ap: 1`、`ap_other: 2` |
| `it_wake_up` | 醒腦針「拍醒」 | II 級；`effects: [{ op: "cleanse", status: "dazed" }]`，其餘同上 |
| `it_smoke_1`、`it_smoke_2` | 煙霧彈 I、II | `use: { ap: 1, target: "slot", modes: ["meat"], effects: [{ op: "soft_cover", kind: "smoke", rounds: 2／3 }] }`；III 級是兩格，先不收 |

`size` 一律 0（EQUIPMENT 6.1 節：藥與小東西）；`desc` 照設計書那一列的效果寫成完整的句子。冷卻劑的副作用（敏感度 −20、成癮）先寫在 `desc` 裡，等藥的系統（M4）。投擲物（手榴彈、霧彈、閃光彈）與腳本不在這一張：它們要打兩格，等現實戰鬥的功能做完再開工單。

### `maps.json`：兩筆

- `map_office_small`：DATA 9.3 節的樣本原樣（`sheets` 一張）。DATA 的樣本沒有把 `C1`、`C2` 兩個控制面板列進 `cells`，但版面上有 `C`：照格式檢查要補上（`{ id: "C1", at: [2, 3], mark: "C", name: … }`、`{ id: "C2", at: [5, 7], mark: "C", name: … }`，名字照 COMMISSION_MAPS 第 2 節那張圖的控制區表）。
- `map_club`：COMMISSION_MAPS 第 8 節（1.6 節有完整的樣本），串兩張。
- `need`、`scout`、`patrols`、`controls` 照設計書抄；引擎現在只讀 `layout`、`legend`、`zones`、`cells`、`spots`、`links`，其餘的 M2 才用，但格式先留著。

## 二、已知的事

1. 核心的預設值是照設計書寫的；資料和預設不一樣時，先確認是誰抄錯，不要兩邊各改一半。
2. **DATA 9.3 節的小辦公室樣本**：接待區通往開放座位的門在 (6,4)，它正上方 (6,3) 是掩體的擺設 `O`，照「擺設擋路」這扇門走不過去（開放座位只能從二樓的窗進）。格式檢查不會擋（每一格都從某個入口走得到），照設計書原樣轉；這件事 cpp-architect 已經回報給使用者，不要自己改版面。
3. 俱樂部如果過不了格式檢查（列的長度、標記對不上、有格子走不到），把檢查的訊息原樣回報，不要自己改版面。
