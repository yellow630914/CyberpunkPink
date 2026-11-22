# M1-gear

- 交給：cpp-feature
- 目標：做一個功能 `gear`：設計圖與零件兩種內容、身上的四層（穿著 10 格、飾品 5 格、攜帶 3 格、快取格）、穿脫的規則、全身的護甲、一把組好的武器的數字、藏匿量與掃描，並把武器、快取格帶進戰鬥。
- 規格出處：EQUIPMENT 第 1～4 節、第 6 節（6.1、6.3）；COMBAT_SYSTEM 第 4 節只看「全身的護甲怎麼算」那一條、第 5 節只看「槍管的等級骰」；DATA 7.1、7.2 節（設計圖與零件的格式）。組裝的檢定、品質、拆解、染色、重量的懲罰是 M4，不在這一張。只讀這幾處。
- 可以改的路徑：`engine/src/features/gear/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `gear`）、`engine/tests/features/`、`engine/tests/pending/M1-gear.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import）：
  - 內容種類：`k.content.defineKind({ kind, owner, validate, refs })`（寫法照 `engine/src/core/content/kinds.ts`）。核心已經有 `item`（`ItemEntry`）與 `weapon_class`（`WeaponClassEntry`，`engine/src/core/battle/rules.ts`）。
  - 變更：`k.changes.register({ op, owner, validate: (state, c) => string[], apply: (state, c) => void, describe? })`（`engine/src/core/state/changes.ts`；寫法照 `engine/src/core/state/coreChanges.ts`）。`validate` 回傳的訊息會變成提交時丟出的錯。
  - 衍生數值：`k.stats`（`engine/src/core/rules/stats.ts`；寫法照 `engine/src/features/character/`）。註冊一個 `armor`。
  - 帶進戰鬥：`k.battle.loadout('gear', (state, actor, mode) => Loadout)`（`engine/src/core/battle/registry.ts`）；戰鬥結束時：`k.battle.onEnd('gear', fn)`。
  - 武器：`weaponFromClass(k.content, classId, build)`、`gradeDice(grade)`（`engine/src/core/battle/rules.ts`）；`attrMod`、`k.stats.effectiveAttr(state, actor, attr)`。
  - 型別：`ItemStack`（`{ id, qty, data? }`）、`ReportDraft`、`BattleWeapon`。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；不 import 別的功能（測試可以裝 `characterFeature`，功能本身不可以 import 它）。
  - 不寫資料（設計圖、零件、物品的轉寫是之後的資料工單）。
  - 給玩家看的句子寫完整，不寫欄位名。下面用引號寫出來的字串要一字不差。
- 驗收測試：`engine/tests/pending/M1-gear.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-gear`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/gear/index.ts`）

```ts
export const gearFeature: Feature
export const WEAR_SLOTS = ['head', 'face', 'upper', 'lower', 'outer', 'armor', 'hands', 'shoes', 'underwear_top', 'underwear_bottom'] as const
export const ACCESSORY_SLOTS = ['neck', 'leg', 'any1', 'any2', 'any3'] as const
export const CARRY_SLOTS = ['main', 'side', 'melee'] as const
export const QUICK_BASE = 2
export const QUICK_MAX = 8
export function gearOf(state, actor): Gear                         // 沒穿過東西的人回傳 { worn: {}, acc: {}, carry: {}, quick: [], coat: 'open' }
export function equipBlock(k, state, actor, what: string, slot?: string): string | null   // 不能穿的原因；可以是 null
export function equip(k, state, actor, what: string, slot?: string): ReportDraft          // 不能穿就丟錯（訊息是那個原因）
export function unequip(k, state, actor, what: string): ReportDraft
export function armorOf(k, state, actor): number
export function weaponOf(k, state, actor, uid: string): BattleWeapon
export function concealment(k, state, actor): { capacity: number; hidden: string[]; shown: string[] }
export function scanFinds(k, state, actor, strength: number): string[]
```

`Gear`（存在 `actor.ext.gear`，用核心的 `actor.ext` 變更或自己註冊的變更寫入）：

```ts
{ worn: Partial<Record<穿著格, uid>>, acc: Partial<Record<飾品格, 物品 id>>, carry: Partial<Record<攜帶格, uid>>, quick: Array<{ item: string; qty: number }>, coat: 'open' | 'closed' }
```

## 二、東西怎麼表示

- **組好的成品**（武器、衣服、護甲）是背包裡的一格：`{ id: 設計圖的 id, qty: 1, data: { uid, parts } }`。`uid` 是這一件的編號（字串）；`parts` 是「零件的類型 → 零件的 id，或 id 的陣列」（同一類型裝了好幾個時是陣列，例：`{ fiber: 'pt_fiber_2', plate: ['pt_plate_3', 'pt_plate_1'] }`）。`what` 給的是 `uid`。
- **飾品與快取格的東西**是一般的物品（內容種類 `item`），`what` 給的是物品的 id。
- 穿上、帶上之後東西**還在背包裡**，`Gear` 只記哪一格放的是哪一件。脫下只是把那一格清掉。

## 三、內容的格式

### `blueprint`（DATA 7.1 節）

共同的欄位：`id`、`kind`（`weapon`、`armor`）、`name`、`desc`、`brand`、`grade`（1～5）、`legal`（核心的 `LEGALITIES`）、`price`、`size`（0～4）、`weight`、`require`（`[{ type }]`，必要的零件類型）、`optional`（`[{ type }]`）。

- `kind: 'weapon'`：`class`（引用 `weapon_class`）、`carry`（`main`、`side`、`melee`：帶在哪一格）。
- `kind: 'armor'`：`armor`（設計圖的基礎，0 或 1）、`covers`（佔哪幾個穿著格，至少一個；連身類寫 `['upper', 'lower']`）、`weight_class`（`light`、`medium`、`heavy`）、`conceal?`（藏匿量）、`quick?`（多給幾格快取格）。

### `part`（DATA 7.2 節）

`id`、`name`、`type`（零件的類型：`barrel`、`action`、`plate`、`fiber`、`blade`、`sensor`……字串）、`material`、`brand`、`grade`（1～5）、`price`、`legal`、`cells`、`stats`（「數字的名字 → 數字」，這一張用到 `damage`、`range_far`、`mag`、`armor`、`hit`、`pierce`）、`weight`、`size`、`state`、`traits?`（字串陣列；這一張用到 `scan_proof`）。

### `item` 上這個功能讀的欄位

`category: 'accessory'` 的是飾品；`tags` 裡的 `acc:neck`、`acc:leg` 決定它放頸或腿，其餘的放通用格。`quick`（數字）：戴著時多給幾格快取格；`conceal`（數字）：戴著時藏匿量加多少。核心的 `item` 格式不擋這兩個多出來的欄位。

## 四、穿脫的規則（`equipBlock` 回傳的字串）

照這個順序檢查，回傳第一條：

1. 背包裡沒有這個 `uid`（或這個物品 id）→ `'背包裡沒有這一件。'`
2. 武器：`slot` 有寫而且不是設計圖的 `carry` → `` `${武器類型的名字}要帶在${那一格的名字}那一格。` ``（格的名字：主武器、副武器、近戰；例：`'手槍要帶在副武器那一格。'`）。沒寫 `slot` 就放進 `carry` 那一格（原本那一格的換下來）。
3. 衣服與護甲：放進 `covers` 的每一格，那幾格原本的東西整件換下來（連身類同時佔上身與下身；原本佔著其中一格的那一件，它佔的每一格都清掉）。
   - 要穿的是 `weight_class: 'heavy'` 而外套格有東西 → `'穿重甲的時候不能再穿外套，先把外套脫掉。'`
   - 要穿的東西佔外套格（`covers` 包含 `outer`）而身上有重甲 → `'穿著重甲，不能再穿外套。'`
4. 飾品：`acc:neck` 放 `neck`、`acc:leg` 放 `leg`（原本的換下來）；其餘放第一個空的通用格（`any1`、`any2`、`any3`），三格都滿 → `'通用的飾品格滿了（3 格）。'`。同一種飾品可以戴好幾個，但不能超過背包裡的數量。

`equip`、`unequip` 回傳的報告：`kind: 'action'`、`action: 'gear.equip'`／`'gear.unequip'`，`outcome.summary` 是一句話（「帶上手槍。」「脫下戰術背心。」）；不花時間。`unequip` 的 `what` 不在身上就丟錯。

### 兩個變更（測試直接用）

- `{ op: 'gear.quick', id: 角色, items: [{ item, qty }] }`：整份換掉快取格。檢查（照這個順序，第一條不過就只回那一條）：`qty` 的總和不能超過格數，超過的訊息是 `` `快取格只有 ${格數} 格。` ``；每一筆的物品背包裡要有那麼多個。格數 ＝ `QUICK_BASE` ＋ 身上每一件設計圖的 `quick` ＋ 戴著的每一個飾品的 `quick`，最多 `QUICK_MAX`。一格一件。
- `{ op: 'gear.coat', id: 角色, coat: 'open' | 'closed' }`：外套敞開或扣上。

穿脫用的變更自己定（建議 `{ op: 'gear.slot', id, group: 'worn' | 'acc' | 'carry', slot, item: string | null }`）。

## 五、數字

### 護甲 `armorOf`，同時註冊成衍生數值 `armor`

- 一件 ＝ 設計圖的 `armor` ＋ 纖維（`fiber` 類零件的 `stats.armor` 加總）＋ 最好的一塊板材（`plate` 類裡 `stats.armor` 最大的）＋ 其他每塊板材的一半。
- 全身 ＝ 身上最高的那一件（不疊；佔頭的那一件不算在這裡）＋ 頭盔（佔 `head` 的那一件，它的值大於 0 就 +1，最多 +1）。最後無條件捨去成整數。
- 義體上的板材值在 M4。
- 戰鬥的單位讀的是衍生數值 `armor`，所以 **`loadout` 不要再回傳 `armor`**（會算兩次）。

### 武器 `weaponOf(k, state, actor, uid)`

用 `weaponFromClass(k.content, 設計圖的 class, build)`，`build` 是：

| 欄位 | 怎麼算 |
|---|---|
| `id`、`item` | 都是 `uid` |
| `name` | 設計圖的 `name` |
| `hit` | `attrMod(那個類型的 attr 的有效值)` ＋ 角色那個類型的基本功（`actor.skills[類型的 skill] ?? 0`）＋ 所有零件的 `stats.hit` |
| `extraDice` | 決定傷害的零件（槍是 `barrel`，近戰是 `blade`）的 `gradeDice(零件的 grade)`：III 級 +1、IV 級 +2、V 級 +3 |
| `flat` | 所有零件的 `stats.damage` 加總；近戰（類型有 `melee` 特性）再加 `attrMod(體格)` |
| `pierce` | 所有零件的 `stats.pierce` 加總（`weaponFromClass` 會加在類型的穿甲上） |
| `range` | `[類型的近, 類型的遠 + 所有零件的 stats.range_far]` |
| `mag` | 類型有彈匣時：類型的彈匣 ＋ 所有零件的 `stats.mag` |

找不到這一件、或它不是武器 → 丟錯。

### 帶進戰鬥 `k.battle.loadout`

回傳 `{ weapons, quick }`：`weapons` 照主武器、副武器、近戰的順序（有帶的才放）；`quick` 是快取格的複本。什麼都沒帶就回傳空的（核心會給空手）。

### 戰鬥結束 `k.battle.onEnd`

每個有 `actor` 的我方單位：`unit.quick` 比開打時（角色的快取格）少掉的，回傳 `{ op: 'item', id: 物品, qty: -用掉的數量 }` 與一筆 `gear.quick` 把角色的快取格改成剩下的；每種用掉的東西一行 `` `用掉：${物品的名字} ×${數量}` ``。這一段驗收測試沒有涵蓋，自己補一個測試（用 `engine/src/testkit` 的 `makeBattleGame`、`TEST_COMBAT`，直接改 `game.state.battle.units.a1.quick` 再結束戰鬥）。

## 六、藏匿與掃描（EQUIPMENT 第 6 節）

- `concealment`：
  - 藏匿量 ＝ 身上每一件設計圖的 `conceal` 裡最大的那個（佔外套格的那一件在 `coat: 'open'` 時先減半、無條件捨去），一件都沒有就是 1；再加戴著的每一個飾品的 `conceal`。
  - 要藏的是攜帶格裡的武器。照設計圖的 `size` 由小到大（一樣大照 `uid` 的字串順序）一件一件放：加起來不超過藏匿量的進 `hidden`，放不下的進 `shown`。兩個陣列都照 `uid` 的字串順序排。
- `scanFinds(k, state, actor, strength)`：看的是攜帶格裡的武器本身，回傳掃得到的 `uid`（照字串順序）。強度 0 不掃；1 只掃 `size` 2 以上的；2 以上掃全部。一件東西的**每一個**零件都帶 `scan_proof` 才掃不到；只要有一個掃得到的零件，整件就掃得到。

## 七、已知的事

1. 護甲「其他每塊板材的一半」加起來不是整數時怎麼進位、重量的懲罰（EQUIPMENT 第 7 節只寫了有懲罰）、存檔規則多給的通用飾品格：設計書沒有寫數字，這一張先照上面（無條件捨去、沒有懲罰、固定 3 格），cpp-architect 已經回報（`dev/adr/0013`）。
2. COMBAT_SYSTEM 第 4 節的公式寫 `max(0, 傷害 − 護甲值 + 穿甲)`；核心照「穿甲只抵銷護甲」算（和平衡模擬一致），這件事也已經回報，不在這一張處理。
