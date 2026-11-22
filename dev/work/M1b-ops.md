# M1b-ops

- 交給：cpp-feature（sonnet）
- 目標：在 `features/combat` 註冊一組通用的效果（`op`），道具、技能、招牌行動、武器的附帶效果、快駭都用這一組；現有的五個道具效果搬到同一張表上。
- 規格出處：SKILLS 1.8 節「現實與內海共用」「只在現實」兩列（效果只能是這張清單上的事）；COMBAT_SYSTEM 第 4 節（傷害類型）、第 6 節（重創的輕與重）；dev/adr/0015 第一節與 E8。只讀這幾處。
- 可以改的路徑：`engine/src/features/combat/`（新增 `ops.ts`）、`engine/tests/features/M1b-ops.test.ts`（新增）。
- 可以用的介面（都從 `'../../core'`）：`k.battle.effect`、`EffectCtx`、`amount`、`amountProblems`、`run.effects`（M1b-core-effects 做的）；`BattleRun` 的基本動作（`attack`、`damage`、`addLoad`、`heal`、`vent`、`applyStatus`、`removeStatus`、`cleanse`、`shift`、`move`、`place`、`raiseCover`、`lowerCover`、`softCover`、`refund`、`save`、`revive`、`setOut`、`implantStatus`、`swapOrder`、`actNext`、`say`）；`weaponFromClass`、`gradeDice`。
- 不可以做的事：不改核心；不 import 別的功能；不寫任何技能或道具的資料；每個 `op` 只做一件事，不看來源是技能還是道具。

## 一、要註冊的 `op`（封閉清單；數量的欄位都收公式）

`ctx.unit` 是這一筆落在誰身上（核心照 `who` 解析好的）；落在掛著的東西上（`ctx.overlay`）時，只有 `strike`、`damage` 有作用，其餘跳過。

| op | 欄位 | 做什麼 |
|---|---|---|
| `attack` | `hit`、`dice`、`damage`、`pierce`、`type`、`aimed`、`spend`（數字或 `'all'`）、`cover_shift`、`cover_mult_min`、`no_cover`、`no_wound`、`auto_crit`、`armor_mult`、`as: { attr, skill }`、`label`、`tags` | 做的人用手上那一把打一次。`as` 是換一組屬性與基本功算命中（改造師用義體學打近戰）：命中加上兩組的差。結果放進 `ctx.last` |
| `strike` | `dice`（公式）、`type`、`hit`（公式）、`range`、`pierce`、`cover_mult`、`natural`、`label`、`traits` | 不用手上的武器的一擊：組一把臨時的武器（投擲物、撞擊、支援射擊）。落在掛著的東西上時走 `attackOverlay` |
| `damage` | `amount`、`type`、`pierce` | 不擲命中，直接照傷害類型打 |
| `load` | `amount`、`type`（`neural` 或 `pleasure`，預設 `neural`）、`exact` | 灌感載；沒有橋的人無效；快感的照核心的規則加沉溺 |
| `heal`、`vent` | `amount` | 回生命、排感載；帶著做的人與標籤（技能的 `['skill']`、道具的照舊） |
| `afterglow` | `amount`（正的加、負的消） | 餘韻的層數 |
| `status` | `status`、`turns`、`until`、`data`、`save: { attr, skill, dc, tags }` | 給狀態；有 `save` 時對象先過檢定，過了就不給 |
| `unstatus` | `status`，或 `kinds: [...]` 加 `count` | 解除指定的狀態，或從這幾種裡解除幾個 |
| `cleanse`、`soft_cover` | 照現在的 | 照現在的 |
| `check` | `attr`、`skill`、`vs`（數字、`'evade'`、`'firewall'`、`'will'`，或 `{ base, per_grade, elite, boss }`）、`bonus`、`tags`、`label`、`stop` | 做的人擲一次檢定，結果放進 `ctx.last.ok`；`stop: true` 而且沒過時後面的效果都不做。`'will'` 是 10 ＋ mod(意志) ＋ 定力；`'firewall'` 照 E5；`'evade'` 含遮蔽 |
| `shift` | `dir`（`push`、`pull`）、`n` | 推或拉 |
| `move` | `to`（`'pick'` 讀 `pick.slot`；`'adjacent'` 讀 `pick.slot` 並要求相鄰） | 對象換到那一格，不花他的行動點 |
| `swap` | `with`（`pick` 的鍵） | 對象和另一名隊友交換位置 |
| `cover` | `levels`（正的升、負的降）、`max` | 目標那一格的遮蔽 |
| `ap` | `amount`、`over_cap` | 對象的行動點加減（預設不超過上限；`over_cap` 可以超過） |
| `mag` | `amount`（數字或 `'full'`）、`over_cap` | 對象手上那一把的彈匣 |
| `pool` | `pool`（`ram`……）、`amount`（數字或 `'full'`） | 對象的一池資源加減；沒有那一池的人跳過 |
| `implant` | `mode`（`off`、`boost`）、`kind`、`turns`、`until` | 讓一件義體失效或超頻；`pick.implant` 有給就照它。結果放進 `ctx.last.ok`（有沒有挑到） |
| `revive` | `hp` | 把倒下的人救回來 |
| `wound` | `mode`（`treat`：輕的解除、重的降成輕的；`clear`：全部清掉）、`part` | 處理重創 |
| `out` | `how`（只收 `surrendered`、`fled`） | 讓對象退出 |
| `field` | `key`、`value` | 場地效果（`dark`） |
| `order` | `with`（`pick` 的鍵）、`act_next` | 先攻對調；`act_next` 時被換到前面的人提前動（E7） |
| `sink` | `amount`、`save: { attr, skill, dc }` | 沉溺加幾點；過了檢定就不加 |

每個 `op` 註冊時一起給格式檢查（`k.battle.effect(op, owner, fn, { problems })`：欄位的型別、不認得的欄位、公式用 `amountProblems`）。道具的 `use.effects` 在 `ready` 改用核心的 `effectProblems` 查；別的來源（技能、招牌行動、武器的附帶效果）由它們自己的功能用同一個函式查。

## 二、驗收條件

每個 `op` 至少一個測試，用測試裡的假道具或直接呼叫 `run.effects`：

- `attack`：`as: { attr: 'tech', skill: 'cyberware' }` 時命中的明細多一項、數字是兩組的差；`spend: 'all'` 把彈匣打光。
- `strike`：`natural` 有給時兩個目標用同一個骰面；落在掛著的東西上時扣它的耐久。
- `load`：對沒有橋的人是 0；`pleasure` 的沉溺 +1。
- `heal`：有人註冊 `heal_dealt` 時多回；`status` 帶 `save` 而且對象過了檢定時沒有給上去。
- `check`：`vs: { base: 10, per_grade: 2, elite: 2 }` 對 III 級精英是 18；`stop: true` 沒過時後面的效果沒有做。
- `shift`、`move`、`swap`、`cover`、`ap`、`mag`、`implant`、`revive`、`wound`、`out`、`field`、`order`、`sink`、`afterglow`、`unstatus` 各自照表上的句子驗一次；`ap` 不帶 `over_cap` 時不超過上限。
- 落在掛著的東西上時，`status`、`heal` 這類不丟錯、沒有作用。
- 現有的五個道具效果行為不變（`tests/features/M1-combat*.test.ts` 照樣全過）。
- 欄位寫錯（不認得的 `type`、公式寫錯）在載入時擋下，訊息裡有那個欄位。

## 依賴

M1b-core-effects、M1b-core-overlay（`implant` 要 `implantStatus`）。做完才能開 M1b-ordnance、M1b-skill-format、M1b-hack、M1b-enemy-moves。

## 完成時回報

改了哪些檔、測試結果、哪些 `op` 的語意在設計書裡找不到依據。
