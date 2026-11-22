# M1-enemies

- 交給：cpp-feature
- 目標：做一個功能 `enemies`：敵人與遭遇兩種內容的格式、把一筆敵人資料照「等級與位階的目標表 × 兵種的修正 × 難度 × 強度係數」變成戰鬥裡的單位、遭遇的點數、照遭遇組出開打的設定，以及敵人的士氣（撤退）。
- 規格出處：ENEMIES 1.1 節、1.5 節只看「現實」那張表與底下「打感載的神經武器」那一條、第 2 節（欄位表）、4.4 節（士氣）、第 13 節（點數、強度係數、對決的修正）；ENEMY_ROSTER 開頭五段（兵種只寫相對於目標表的修正）；BALANCE 2.4、7.2 節。只讀這幾處。
- 可以改的路徑：`engine/src/features/enemies/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `enemies`）、`engine/tests/features/`、`engine/tests/pending/M1-enemies.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import）：
  - 內容種類：`k.content.defineKind({ kind, owner, validate: (e) => string[], refs: (e) => Array<[kind, id]> })`（`engine/src/core/content/registry.ts`；寫法照 `engine/src/core/content/kinds.ts`）。`validate` 回傳的每一條是給資料作者看的錯誤訊息；`refs` 列出這一筆引用了哪些別的內容，`content.checkRefs()` 會找不存在的。
  - 「誰上場」的來源：`k.battle.unitSource('enemy', 'enemies', (ref, ctx) => BattleUnitInit)`（`engine/src/core/battle/registry.ts` 的 `UnitSource`、`UnitSourceCtx`、`BattleUnitInit`）。`ref` 是開打設定裡的那一筆（`{ from: 'enemy', id, grade?, strength? }`）；`ctx.grade` 是場景的等級、`ctx.allyCount` 是我方上場的人數、`ctx.state` 是遊戲狀態。
  - 武器：`weaponFromClass(k.content, classId, { hit, extraDice, name, type, traits, … })`、`gradeDice(grade)`（`engine/src/core/battle/rules.ts`）。
  - 難度的係數：`enemyCoefFor(state.rules, grade, 是不是首領)` 回傳 `{ hp, dmg, load }`（`engine/src/core/state/saveRules.ts`）。
  - 士氣：`k.battle.on('ai.step', 'enemies', ({ run, unit }) => boolean | void)`：輪到 AI 操縱的人、每一步之前呼叫；回傳 `true` 表示這一步已經做完。`run.save`、`run.setOut`（`engine/src/core/battle/run.ts`）。
  - 開打的設定：`BattleSetup`、`UnitRef`（`engine/src/core/battle/setup.ts`）。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；介面不夠用就停下來回報。
  - 不 import 別的功能。
  - 不寫敵人的資料（名冊是 `dev/work/M1-data-enemies.md`，交給 cpp-data）。招牌行動、掉落、特徵、天使急救、蕾絲與網內的敵人不在這一張：欄位先收下、照格式檢查，不做效果。
- 驗收測試：`engine/tests/pending/M1-enemies.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-enemies`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/enemies/index.ts`）

```ts
export const enemiesFeature: Feature
export const ENEMY_CURVE            // 目標表，見第二節
export function enemyStats(k, state, id: string, o: { grade?: number; allies?: number; strength?: number }): EnemyStats
export function encounterPoints(k, foes: Array<{ enemy: string; grade?: number; strength?: number }>, grade: number): number
export function setupFromEncounter(k, state, encounterId: string, o: { allies: UnitRef[] }): BattleSetup
```

`EnemyStats`：`{ grade, rank, hp, load?, armor, evade, attack, ap, layers, sensitivity, dmgMult: { hp, load } }`（沒有橋的沒有 `load`）。

## 二、目標表 `ENEMY_CURVE`（ENEMIES 1.5 節；索引 0 是 I 級）

```ts
{
  attack: [3, 4, 5, 6, 7], evade: [10, 12, 14, 16, 18], armor: [1, 2, 3, 4, 5],
  hp:   { minion: [45, 55, 67, 82, 100], elite: [110, 130, 165, 205, 250], boss: [260, 300, 380, 470, 580] },
  load: { minion: [22, 27, 33, 40, 49],  elite: [37, 45, 55, 67, 82],     boss: [52, 63, 77, 94, 115] },
  layers: { minion: 1, elite: 2, boss: 4 },
  ap: { minion: 4, elite: 5, boss: 6 },            // IV 級以上的精英與首領再 +1
  rankDamage: { minion: 0.4, elite: 0.6, boss: 1 }, // 位階的傷害倍率，只乘在生命的傷害上
  captureDice: { minion: 4, elite: 6, boss: 11 },   // capture 與 neural 的神經武器的骰數（再加等級骰）
  points: { minion: 1, elite: 2.5, boss: 5 },
}
```

和 `engine/src/testkit/battle.ts` 的 `ENEMY_TARGETS` 是同一張表（測試會比對）；功能不可以 import testkit，自己寫一份。

## 三、內容的格式

### `enemy`（一個兵種一筆）

| 欄位 | 必填 | 格式 |
|---|---|---|
| `id`、`name`、`desc` | 是 | `desc` 是外觀，完整的句子 |
| `faction` | 是 | 勢力的 id（引用 `faction`），沒有勢力寫 `none`（不檢查引用） |
| `branch` | | 字串 |
| `rank` | 是 | `minion`、`elite`、`boss`。錯的時候訊息裡要有 `rank` 這個字 |
| `grades` | 是 | `[最低, 最高]`，1～5，最低 ≤ 最高 |
| `kind` | 是 | `human`、`unbridged`、`machine`、`vehicle`、`mech`、`mascot`、`lace`、`program` |
| `position` | 是 | `{ prefer: [1～4 的整數…]（至少一個）, cover_use: 0～1 }` |
| `mode` | 是 | `lethal`、`neural`、`capture` |
| `weapons` | 是 | 至少一把：`{ class（引用 weapon_class）, name?, type?（五種傷害類型）, traits?: string[], pierce?, range?, mag? }` |
| `ai` | 是 | `{ prefer: 'weakest'｜'overloaded'｜'leader'｜'nearest'｜'netrunner', focus: 數字, flee_below: 0～1, floor?, never_flee?, morale? }` |
| `mods` | | 相對於目標表的修正，只收這幾個鍵：`hp`、`load`（倍數，0.5～1.5）；`armor`、`evade`、`attack`、`ap`、`layers`（整數，加減）；`sensitivity`（0～100，直接取代預設的 50） |
| `attrs`、`skills` | | 六屬性與基本功（檢定與豁免用）；沒寫時屬性全是 10、基本功是 `{ composure: 雜兵 0／其餘 2 }` |
| `quick` | | `[{ item, qty }]`；沒寫時 `capture` 的敵人帶 `[{ item: 'it_zip_tie', qty: 2 }]`，其餘是空的 |
| `named`、`base`、`strength` | | 具名敵人：`named: true`；`base` 指一個制式兵種（引用 `enemy`），沒寫的欄位用它的；`strength` 是強度係數 |
| `defeat`、`adult`、`signature`、`loot`、`traits`、`angel` | | 先收下：`defeat` 字串、`adult` 字串陣列或 `null`、`signature` 與 `loot` 陣列、`traits` 字串陣列、`angel` 字串 |

有 `base` 的那一筆：先拿 `base` 的整筆，再用自己寫的欄位蓋上去（淺的合併），之後才檢查必填。

### `encounter`（一場遭遇一筆）

| 欄位 | 必填 | 格式 |
|---|---|---|
| `id`、`name` | 是 | `name` 是地點或場合（「課長室」），會出現在戰報裡 |
| `grade` | 是 | 1～5 |
| `kind` | | `light`、`normal`、`heavy`、`boss`（點數的預算 2／4／5.5／8；沒寫是 `normal`） |
| `cover` | 是 | `dense`、`medium`、`sparse`、`one_sided` |
| `foes` | 是 | 至少一筆：`{ enemy（引用 enemy）, grade?, slot?, strength? }` |
| `escapable` | | 布林值，沒寫是 `true` |
| `faction` | | 勢力的 id（引用 `faction`）；沒寫時用位階最高的那個敵人的勢力（一樣高取前面的；`none` 就不寫） |
| `ambush`、`field`、`nodes` | | 照 `BattleSetup` 同名的欄位 |

## 四、把一筆敵人變成單位（`enemyStats` 與 `enemy` 這個來源）

1. 找不到 → `throw new Error('沒有 <id> 這個敵人')`。
2. **等級**：`ref.grade`（或 `o.grade`）有寫就用它；沒寫用場景的等級，夾在這個兵種的 `grades` 範圍裡（兵種不出現的等級照最近的那一級，不擋）。下面的 `g = 等級 − 1`。
3. **難度的係數** `c = enemyCoefFor(state.rules, 等級, rank === 'boss')`。
4. **強度係數** `s`（雜兵一律 1）：
   - 我方上場 4 人以上（`ctx.allyCount`，`enemyStats` 是 `o.allies ?? 4`）：`ref.strength ?? 資料的 strength ?? (named ? 1.3 : 1)`，生命與傷害都乘 `s`。
   - 我方少於 4 人（對決）：不看上面那一條，改用這張表（生命、傷害各自的倍數）：精英 1 人 ×0.8／×0.8，2、3 人不修正；首領 1 人 ×0.35／×0.5，2 人 ×0.8／×0.8，3 人不修正。
5. 數字（`m` 是 `mods`，沒寫的倍數是 1、加減是 0）：
   - 生命上限 `Math.round(hp[rank][g] * m.hp * c.hp * 生命的強度倍數)`，開場是滿的。
   - 感載上限 `Math.round(load[rank][g] * m.load * c.load)`，開場 0。`kind` 是 `unbridged`、`machine`、`vehicle`、`mascot` 的沒有感載這一條（單位上不寫 `load`），`tags` 加 `'unbridged'`。
   - 護甲 `armor[g] + m.armor`；迴避 `evade[g] + m.evade`；承受層數 `layers[rank] + m.layers`（最少 1）；敏感度 `m.sensitivity ?? 50`。
   - 行動點上限 `ap[rank] + (rank !== 'minion' && 等級 >= 4 ? 1 : 0) + m.ap`，開場是滿的，每回合回 3（`regen: 3`）。
   - 傷害的倍率（照這個順序乘，測試比對的是同一個浮點數）：`dmgMult.hp = rankDamage[rank] * c.dmg * 傷害的強度倍數`；`dmgMult.load = c.dmg * 傷害的強度倍數`。
6. **武器**（每一把）：`weaponFromClass(k.content, w.class, { hit: attack[g] + m.attack, extraDice, name: w.name, type: w.type, traits: w.traits, pierce: w.pierce, range: w.range, mag: w.mag })`。
   - 一般：`extraDice = gradeDice(等級)`。
   - 打感載的神經武器（這一把最後的傷害類型是 `neural` 或 `pleasure`，而且兵種的 `mode` 是 `capture` 或 `neural`）：骰數是 `captureDice[rank] + gradeDice(等級)`，也就是 `extraDice = captureDice[rank] + gradeDice(等級) − 類型的基礎骰`。
7. 單位其餘的欄位：`name`（`ref.name ?? 資料的 name`）、`enemy: id`、`control: 'ai'`、`grade`、`rank`、`attrs`、`skills`、`layers: 0`、`sink: 0`、`pools: {}`、`wield: 0`、`initBonus: attrMod(attrs.reflex)`、`statuses: []`、`quick`、`uses: {}`、`wounds: {}`、`ext: {}`；`tags` 是 `[kind, …(沒有橋的加 'unbridged'), …(資料的 traits)]`；`ai: { focus, floor: ai.floor ?? 1, prefer, mode（兵種的 mode）, fleeBelow: ai.flee_below, neverFlee: ai.never_flee（有寫才放）, prefer_slots: position.prefer, coverUse: position.cover_use }`。

## 五、遭遇

- `encounterPoints(k, foes, grade)`：每個敵人 `points[rank]`；敵人的等級（`f.grade`，沒寫就是遭遇的等級夾進兵種的範圍）比 `grade` 高一級以上 ×1.75；強度係數（`f.strength ?? 資料的 strength ?? (具名的精英與首領 1.3，其餘 1)`）也乘上去。加總。
- `setupFromEncounter(k, state, id, { allies })`：找不到 → `throw new Error('沒有 <id> 這個遭遇')`。回傳
  `{ mode: 'meat', grade, cover, allies, foes, origin: { encounter: id, escapable, place: name, faction? }, ambush?, field?, nodes? }`；
  `foes` 的每一筆是 `{ from: 'enemy', id: f.enemy }`，`grade`、`slot`、`strength` 有寫才放（測試用 `toEqual` 比對，不要多放鍵）。

## 六、士氣（`ai.step`；ENEMIES 4.4 節）

輪到一個 AI 操縱、有 `enemy` 的單位，每一步之前：

- 首領、`ai.neverFlee` 的、`uses.morale` 已經有值的（每場只檢定一次，過了的人這一場不再擲）：什麼都不做，回傳 `undefined`。
- 要不要檢定：
  - 雜兵：同一方有位階是首領的人已經退出（`out` 有值），或同一方退出的人數達到開場人數的一半，或自己的生命比例低於 `ai.fleeBelow`。DC 13。
  - 精英：同一方的首領已經退出，或自己的生命比例低於 `ai.fleeBelow`。DC 10。
- 要檢定：`unit.uses.morale = 1`；`run.save(unit, 'resolve', 'composure', DC, '士氣')`。過了：回傳 `undefined`（照常行動）。沒過：對方還站著的人數是自己這一方的兩倍以上就投降 `run.setOut(unit, 'surrendered')`，否則撤退 `run.setOut(unit, 'fled')`；回傳 `true`。

## 七、已知的事

1. ENEMIES 第 2、15 節的欄位是絕對的數字（`hp`、`armor`、`load_max`……，樣本的數字還是舊的），ENEMY_ROSTER 開頭說兵種只寫相對於目標表的修正。這一張照 ENEMY_ROSTER（`mods`）；cpp-architect 已經把這件事回報給使用者（`dev/adr/0013`）。
2. 「生命比例低於 `flee_below` 也擲一次士氣」「投降的條件是對方人數兩倍以上」是 cpp-architect 的暫定（設計書只寫「照 ElondiaRPG」與「被困在第 4 格、或對方佔優勢很多」）。做的時候如果在設計書裡看到更明確的寫法，停下來回報。
3. 打法會換（`capture` 換成 `lethal`）與警戒、增援在 M2（委託副本），不在這一張。
