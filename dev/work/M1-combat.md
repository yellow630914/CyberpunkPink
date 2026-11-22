# M1-combat

- 交給：cpp-feature
- 目標：把現實戰鬥的行動表（COMBAT_SYSTEM 1.3 節）做成一個功能 `combat`：射擊、近戰、換彈、換武器、道具、打遮蔽、監視、制伏、脫離、投降，加上輕機槍的掃射、重創的部位、敵人 AI 對這些行動的分數。站位、命中、傷害、感載、過載、遮蔽、回合都已經在核心，這一張只註冊行動與掛點。
- 規格出處：COMBAT_SYSTEM 1.3 節（行動表與底下六條說明）、第 5 節只看「彈匣」「輕機槍」「打遮蔽」三處、第 6 節（重創）、第 7 節只看「制伏」那一條、8.5 節（投降）；ENEMIES 4.3 節的分數表；ITEMS 5.2 節只看急救凝膠、冷卻劑、煙霧彈、束帶、鎖橋器五列。docs/plan/PLAN.md 5.5 節第一項（試玩的回饋：制伏灰掉時要寫出缺哪個條件）。只讀這幾處。
- 可以改的路徑：`engine/src/features/combat/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `combat`）、`engine/tests/features/`、`engine/tests/pending/M1-combat.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import；檔案在 `engine/src/core/battle/`）：
  - 註冊行動：`k.battle.action(def)`，`BattleActionDef` 在 `registry.ts`（每個欄位都有註解）。**照抄的範本**：`engine/src/testkit/battle.ts` 的 `TEST_COMBAT`（攻擊、換彈、監視三個最小的行動）。
  - 算這一步用的 `BattleRun`（`run.ts`）：`attack`、`damage`、`addLoad`、`heal`、`vent`、`save`、`applyStatus`、`cleanse`、`removeStatus`、`setOut`、`finish`、`hurtCover`、`softCover`、`d6`、`rand`、`say`、`unit`。只讀的 `BattleView`（行動的 `cost`、`blocks`、`targets`、`aiScore` 拿到的）：`hitChance`、`mods`、`n`（這個戰場的數字：`n.subdueDc`、`n.fleeDc`）。
  - 站位的小工具（`field.ts`）：`wielded`、`distance`、`unitsOf`、`otherSide`、`unitAt`、`coverAt`、`coverLevel`、`losingTurn`、`standing`、`unitTag`。
  - 花費的修正：核心在行動自己算的花費上再加 `action_ap` 這一種修正（技能的減免），畫面、檢查、實際扣的都是修正過的數字；行動的 `cost` 只管自己的基本花費。
  - 掛點：`k.battle.on('wound' | 'attack.after', owner, fn)`（`BattleHookMap`）；戰鬥結束時加一行結果：`k.battle.onEnd(owner, fn)`。
  - 道具效果的登錄表：`k.battle.itemOp(op, owner, fn)`、`k.battle.getItemOp(op)`、`k.battle.itemOpIds()`（`BattleItemOp`）。
  - 做不成的一步：`throw new BattleBlocked([原因, …])`（`step.ts`）。`blocks` 與 `targets` 回傳的原因由核心擋；要看 `input.pick` 才知道的（掃射、選了哪個道具）在 `run` 裡自己丟。這時戰鬥狀態是工作副本，丟了就整步作廢。
  - 內容：`k.content.get('item', id)`（`ItemEntry`，`engine/src/core/content/kinds.ts`）。
  - 功能的寫法：`export const combatFeature: Feature = { id: 'combat', install(k) { … }, ready(k) { … } }`；`ready` 在內容載入之後跑一次。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；介面不夠用就停下來回報。
  - 不 import 別的功能（`features/gear`、`features/abilities`……）。快取格、武器、護甲已經在單位身上（`unit.quick`、`unit.weapons`、`unit.armor`），不必知道它們從哪來。
  - 不做瞄準、連射、側襲、換姿態（它們是技能，另一張工單）；不做快駭、無人機、機甲。
  - 每一句給玩家看的話寫完整的句子，不寫欄位名或內部代號。下面用引號寫出來的字串要一字不差（驗收測試在比對）。
- 驗收測試：`engine/tests/pending/M1-combat.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-combat`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、行動表

每個行動的 `owner` 是 `'combat'`、`modes: ['meat']`。`desc` 寫成一兩句完整的話（給泡泡訊息用，長度要超過 5 個字）。核心已經有 `move`（換位，戰術圈第 1 個）與 `end_turn`（結束回合）。

| id | 名字 | `group` | `order` | `target` | 行動點 | 其他 |
|---|---|---|---|---|---|---|
| `shoot` | 射擊 | `attack` | 1 | `foe` | `wielded(u).ap ?? 2`（狙擊槍 3） | 有 `auto`（監視用） |
| `melee` | 近戰攻擊 | `attack` | 2 | `foe` | 2 | 有 `auto` |
| `reload` | 換彈 | `supply` | 1 | `none` | 1 | |
| `swap` | 換武器 | `supply` | 2 | `none` | 1 | |
| `item` | 使用道具 | `supply` | 3 | `unit` | 1（替別人用時照道具的 `ap_other`） | |
| `hit_cover` | 打遮蔽 | `tactic` | 2 | `foe_slot` | 2 | |
| `watch` | 監視 | `tactic` | 3 | `none` | 2 | |
| `subdue` | 制伏 | `tactic` | 4 | `foe` | 2 | |
| `flee` | 脫離 | `system` | 1 | `none` | 2 | `hold: true` |
| `surrender` | 投降 | `system` | 2 | `none` | 0 | `hold: true` |

### 射擊 `shoot`

- `blocks`：手上的武器帶 `melee` 特性 → `'手上是近戰武器，不能射擊。'`；有彈匣而且是 0 → `'彈匣空了，要先換彈。'`。
- `targets`：敵方每一個在場上的人（照站位）`{ unit }`，每個目標的 `hint` 放 `{ chance: view.hitChance(u, t), distance: distance(u, t) }`；後面再列敵方每一台還沒被擊落的、和人重疊的東西（`battle.overlays` 裡 `side` 是敵方、`down` 是 `false` 的）`{ overlay: id }`。
- `run`：目標是人 → `run.attack(u, target)`；目標是和人重疊的東西 → `run.attackOverlay(u, 那一台)`（它永遠暴露；核心已經做好）。彈匣由這兩個函式扣（預設 1 格）。掃射只能對人。
- **掃射**（`input.pick.sweep === true`；武器要有 `sweep` 特性）：彈匣不到 2 格 → `throw new BattleBlocked(['掃射要彈匣裡有 2 格。'])`；武器沒有這個特性 → `throw new BattleBlocked(['這把武器不能掃射。'])`。`run.attack(u, t, { spend: 2, label: '掃射', tags: ['sweep'] })`；之後不管有沒有打中，目標還在場上就 `run.save(t, 'resolve', 'composure', 14, '定力')`，沒過就 `run.applyStatus(t, 'suppressed', { by: u })`。
- `auto(run, u, t)`（監視觸發時）：手上是近戰武器、或彈匣空了回傳 `false`；否則 `run.attack(u, t, { label: '監視射擊', tags: ['watch'] })`，回傳 `true`。
- `aiScore`：`view.hitChance(u, t) < 35 ? 1 : 2`；目標那一格是掩體（`coverLevel(...) === 2`）而自己的武器是霰彈槍或重武器（`class` 是 `shotgun` 或 `heavy`）再 +0.5。

### 近戰攻擊 `melee`

- `blocks`：手上的武器沒有 `melee` 特性 → `'手上不是近戰武器。'`。
- `targets`：敵方每一個在場上的人；`distance(u, t) !== 1` 的那些 `blocks: ['近戰只能打近身（雙方的第 1 格）。']`。
- `run`：`run.attack(u, target)`。`auto`：不是近身回傳 `false`。`aiScore`：和射擊一樣的基準。近戰不能打和人重疊的東西（它們在飛）。

### 換彈 `reload`、換武器 `swap`

- 換彈 `blocks`：武器沒有彈匣 → `'這把武器不用換彈。'`；彈匣是滿的 → `'彈匣是滿的。'`。`run`：補滿，`run.say(…, 'reload', { unit: u.id }, u)`。`aiScore`：彈匣 0 是 3；只剩 1 格而容量大於 1 是 1；其餘 `null`。換彈種之後才做（特殊彈在 M4）。
- 換武器 `blocks`：`u.weapons.length < 2` → `'只有一把武器。'`。`run`：`input.pick.weapon`（索引）有寫就換到那一把（超出範圍或就是手上這一把 → `BattleBlocked(['沒有這把武器。'])`），沒寫換到下一把（`(u.wield + 1) % u.weapons.length`）；`run.say(…, 'swap', { unit: u.id, weapon: 那一把的 class }, u)`。AI 不用（不寫 `aiScore`）。

### 使用道具 `item`（只能用快取格 `u.quick` 裡的）

- 「能用的道具」：`u.quick` 裡數量大於 0、內容裡那一筆有 `use`、而且 `use.modes` 沒寫或包含這個戰場。束帶與鎖橋器沒有 `use`，不算。
- `blocks`：一個能用的都沒有 → `'快取格裡沒有能用的道具。'`。
- `targets`：
  - 一律列出我方每一個在場上的人（照站位，包含自己）`{ unit }`；和自己隔一格以上的（`Math.abs(t.slot - u.slot) > 1`）`blocks: ['要相鄰才用得到。']`。沒有能用的道具時也照列（目標的清單是空的話，核心會多加一句「沒有可以選的目標。」，驗收測試要的是只有上面那一句）。
  - 有任何一個能用的道具的 `use.target` 是 `slot`：再列我方的四格 `{ side: u.side, slot }`。
- `cost(view, u, input)`：沒有 `input` 時回 `{ ap: 1 }`。有 `input` 時照選的道具：對自己（或對一格）是 `use.ap`，對別人是 `use.ap_other ?? use.ap`。
- `run`：
  - 選哪一個：`input.pick.item`；沒寫而能用的只有一種就用那一種，否則 `BattleBlocked(['要選用哪一個道具。'])`。選的不在快取格、或不是能用的 → `BattleBlocked(['快取格裡沒有這個道具。'])`。
  - 目標對不上道具：`self` 的道具選了別人 → `BattleBlocked(['這個道具只能自己用。'])`；`slot` 的道具選了人、或 `self`／`ally` 的道具選了一格 → `BattleBlocked(['這個道具不是這樣用的。'])`。
  - 照 `use.effects` 的順序，每一筆用 `k.battle.getItemOp(effect.op)` 做；做完那一格 `qty − 1`，變成 0 就從 `u.quick` 拿掉；`run.say(…, 'item', { unit: u.id, item: id, target }, u)`。
- 這個功能註冊五個效果（`k.battle.itemOp`）：

  | op | 欄位 | 做什麼 |
  |---|---|---|
  | `heal` | `amount` | `run.heal(unit, amount)` |
  | `cleanse` | `by` 或 `status` | `by`：`run.cleanse(unit, by)`；`status`：`run.removeStatus(unit, status)` |
  | `afterglow` | `layers`（負的是消掉） | `unit.layers` 加上去，夾在 0 到 `layersMax` |
  | `vent` | `amount` | `run.vent(unit, amount)` |
  | `soft_cover` | `kind`、`rounds` | `run.softCover(target.side, target.slot, kind, rounds)` |

- `ready(k)`：檢查每一筆 `item` 的 `use.effects`，`op` 不在 `k.battle.itemOpIds()` 裡就丟錯，訊息要有道具的 id 與那個 op（例：`item/it_weird：不認得的效果 summon_dragon`）。
- AI 不用道具（這一張不寫 `aiScore`；敵人的治療與冷卻跟著敵人的資料，另一張工單）。

### 打遮蔽 `hit_cover`

- `blocks`：手上是近戰武器 → `'近戰武器打不了遮蔽。'`；彈匣空了 → `'彈匣空了，要先換彈。'`。
- `targets`：敵方四格裡遮蔽不是暴露、也不是打不破的（`cover.level > 0 && !cover.soft`）那幾格 `{ side, slot }`。
- `run`：彈匣 −1；不擲命中；`const rolled = run.d6(w.dice)`；`run.hurtCover(side, slot, rolled * Math.max(1, w.coverMult * 2), u)`。
- AI 不用。

### 監視 `watch`

- `blocks`：`u.watch` 已經有了 → `'已經在監視了。'`。
- `run`：`u.watch = { action: 手上是近戰武器 ? 'melee' : 'shoot' }`；`run.say(…, 'watch', { unit: u.id }, u)`。之後的觸發（第一次有敵人站上暴露的格子、不另花行動點、彈匣照扣、做不到就繼續等、下一回合開始前失效）核心已經做好，會呼叫那個行動的 `auto`。
- `aiScore`：每一個敵人的命中率都低於 35% 時 1.5，其餘 `null`。

### 制伏 `subdue`（灰掉時要寫出缺的是哪個條件；試玩的回饋）

- 束帶或鎖橋器：快取格裡數量大於 0、內容的 `tags` 包含 `restraint` 的道具。
- `blocks`（行動本身）：快取格裡沒有 → `'快取格裡沒有束帶或鎖橋器。'`。
- `targets`：敵方每一個在場上的人；每個人的 `blocks` 照這個順序、缺幾條列幾條：
  1. `!losingTurn(t)` → `'對方沒有在過載、失去回合。'`
  2. `u.slot !== 1 || t.slot !== 1` → `'要在近身：雙方都站在第 1 格。'`
  3. `t.rank !== 'minion' && t.layers < t.layersMax` → `` `精英與首領要餘韻疊滿才制伏得了（現在 ${t.layers}／${t.layersMax} 層）。` ``（斜線是全形的「／」）
- 每個目標的 `hint`：`{ dc }`，`dc = n.subdueDc.base + t.grade * n.subdueDc.perGrade + (精英 n.subdueDc.elite；首領 n.subdueDc.boss)`。
- `run`：`run.save(u, 'body', 'brawl', dc, '制伏')`。過了：用掉一條束帶（有束帶先用束帶；鎖橋器不消耗——看內容的 `consumable !== false`），`run.setOut(t, 'subdued', u)`（核心會記一拍 `subdue`）。沒過：只是這 2 點不退，束帶不消耗。
- `aiScore`：`u.ai?.mode === 'capture'` 時 4，其餘 `null`（條件不符的時候核心本來就不會列）。`aiTarget`：不寫（用 AI 挑好的那個敵人）。

### 脫離 `flee`、投降 `surrender`

- 脫離 `blocks`：`!battle.origin.escapable` → `'副本裡的戰鬥不能脫離，只能撤退。'`。`run`：在我方還站著的人裡挑運動或隱匿最高的那一個（比 `skills.athletics` 與 `skills.stealth`，取大的；一樣高挑站位前面的），用他擲 `run.save(他, 屬性, 那個基本功, dc, '脫離')`；屬性：運動是 `body`、隱匿是 `reflex`；`dc = n.fleeDc.base + 敵方在場上最高的等級 * n.fleeDc.perGrade`。過了：`run.say(…, 'flee', …)` 再 `run.finish('fled', '全隊脫離了這場戰鬥，敵人還在原地。')`。沒過：`run.say(…, 'flee.fail', …)`，沒有別的懲罰。AI 不用（敵人的撤退是士氣，另一張工單）。
- 投降：沒有條件、一定成功。`run.say(…, 'surrender', { unit: u.id }, u)` 再 `run.finish('surrender', '投降：戰鬥結束，算戰敗。')`。不要把我方的人標成倒下（每個人停在那一刻的生命、感載與餘韻）。AI 不用。

## 二、掛點

### 重創 `k.battle.on('wound', 'combat', …)`

核心在「自然 20，或瞄準過的射擊打出要害」而且目標不是雜兵時呼叫（雜兵多扣一顆骰，核心已經做了）。收到 `{ run, attacker, target, aimed, part? }`。

- 部位：有 `part` 就用它（瞄準過的射擊由攻擊者選）；沒有就擲 `run.rand()`：小於 0.25 肢體 `limb`、小於 0.5 頭 `head`、小於 0.75 軀幹 `torso`、其餘橋 `bridge`。
- 輕重：`target.wounds[part]` 還沒有 → 記成 1（輕）。已經有了：我方（`target.side === 'ally'`）而且 `run.state.rules.heavyWounds` 開著 → 記成 2（重）；其餘維持 1（對敵人只算輕的；存檔規則可以關掉重的那一級）。
- 輕的效果（每次都給）：肢體 `run.applyStatus(target, 'limb_hurt')`；頭 `'dazed'`；軀幹 `'bleeding'`；橋 `run.addLoad(target, 10, attacker, { exact: true, label: '橋受創' })`。
- 重的那一級（從 1 變成 2 的那一次再加）：肢體把 `limb_hurt` 的修正改成 −4（`run.applyStatus(target, 'limb_hurt', { data: { hit: -4 } })`：`data` 蓋掉資料裡那一種修正的預設值）；軀幹這一場的護甲歸零（`target.armor = 0`）、生命上限 −5；橋這一場的承受層數 −1（`layersMax` 最少 1）；頭先不加別的（義眼與甲板的損壞要等義體，M4）。
- 記一拍：`run.say(…, 'wound', { target: target.id, part, level: 1 或 2 }, attacker)`。
- 戰後：重的傷勢寫進結果。`k.battle.onEnd('combat', …)` 對每個有 `actor`、`wounds` 裡有 2 的我方單位回傳一行 `` `重傷：${名字}的${部位的名字}（要治療）` `` 與一筆變更 `{ op: 'actor.condition', id: actor, condition: 'wound_limb' | 'wound_head' | 'wound_torso' }`（橋的那一級只影響這一場，不留）。治療、修理與這些傷勢在戰鬥外的效果是 M4，這一張只留下紀錄。

### 「要活的」的條件 `k.battle.onEnd`

`battle.origin.capture`（單位 id 的陣列）有東西、而且結果是 `win` 時加一行：每一個都是 `out === 'subdued'`（或 `'surrendered'`）→ `'要活的：達成'`；否則 `` `要活的：沒有達成（${被打倒的那幾個的名字，用頓號接}被打倒了）` ``。

## 三、已知的事

1. 驗收測試用的是測試自己帶的幾筆道具與狀態（`PACK`），不靠 `CORE_PACK`；正式的資料是 `dev/work/M1-data-rules.md`。兩邊的欄位是同一套。
2. 核心在每一步做完之後自己處理：監視、後方補位、分出勝負。行動的 `run` 不要呼叫 `run.settle()`、`advance()`。
3. 要選目標的行動，`targets` 回傳空陣列時核心會自動加一條 `'沒有可以選的目標。'`。想讓灰掉的原因只有自己寫的那一句，就把目標照列、原因寫在行動的 `blocks` 或每個目標的 `blocks` 上。
4. `BattleView` 是只讀的：`cost`、`blocks`、`targets`、`aiScore` 裡不可以改單位、不可以擲骰。
5. 束帶在制伏失手時不消耗、打遮蔽一律 2 點（狙擊槍也是）、有束帶先用束帶：這三點設計書沒有寫，是 cpp-architect 的暫定（`dev/adr/0013`）。做的時候如果在設計書裡看到相反的寫法，停下來回報。
