# M1-abilities

- 交給：cpp-feature
- 目標：做一個功能 `abilities`：路數與技能兩種內容、學技能（歷練點、前置、樹的階）、裝技能（橋的四類容量）、把裝著的技能帶進現實戰鬥（主動技能變成行動、被動與共鳴變成修正、反應掛在攻擊之前），以及槍手與掮客 1～2 階裡的十一個技能。這是技能的第一批；其餘的技能之後分批做，用的是同一套機制。
- 規格出處：SKILLS 1.1～1.4、1.8、1.9 節；CORE_RULES 6.4 節（橋的容量）；SKILL_TREES「槍手：戰鬥直覺」的共鳴表與 1、2 階兩張表、「掮客：人面」的 1 階那張表（只看下面第五節列出的那幾個技能的「現實」欄）；COMBAT_SYSTEM 第 5 節只看「壓制」、第 6 節只看「瞄準過的射擊」。只讀這幾處。
- 可以改的路徑：`engine/src/features/abilities/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `abilities`）、`engine/tests/features/`、`engine/tests/pending/M1-abilities.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import）：
  - 內容種類：`k.content.defineKind({ kind, owner, validate, refs })`；跨筆的檢查（前置存不存在、同不同一棵樹）放在功能的 `ready(k)`（內容載入之後跑一次），有錯就 `throw`。
  - 戰鬥的登錄表 `k.battle`（`engine/src/core/battle/registry.ts`）：`action(def)`（`BattleActionDef`，`group: 'skill'`、`has` 決定誰有這個行動）、`modifier(owner, fn)`（`ModQuery` → `RollPart[]`；`kind` 有 `hit`、`hit_against`、`evade`、`initiative`、`move_ap`……，見 `engine/src/core/battle/rules.ts` 的 `MOD_KINDS`）、`on('unit.ready' | 'attack.before' | 'moved', owner, fn)`（`unit.ready`：開打時每個單位剛組好、還沒擲先攻的時候各呼叫一次）。
  - 算這一步用的 `BattleRun`（`engine/src/core/battle/run.ts`）：`attack(attacker, target, AttackOpts)`、`save`、`applyStatus(target, id, { by, until })`、`spend`、`canAfford`、`move`、`raiseCover`、`lowerCover`、`say`、`unit`。站位的小工具在 `engine/src/core/battle/field.ts`（`wielded`、`distance`、`unitsOf`、`unitAt`、`otherSide`）。
  - 做不成的一步：`throw new BattleBlocked([原因])`（要看 `input.pick` 才知道的）。
  - 角色的狀態：`actor.ext.abilities`、`actor.ext.bridge`，用變更 `{ op: 'actor.ext', id, key, value }` 寫。
  - 範本：`engine/src/testkit/battle.ts` 的 `TEST_COMBAT`（三個最小的行動）。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；不 import 別的功能（射擊、換彈那些行動在 `features/combat`，這個功能不呼叫它們：技能自己用 `run.attack`）。
  - 不寫技能的資料（兩棵樹的轉寫是 `dev/work/M1-data-abilities.md`）。
  - 不做內海與輿論的那兩欄（`net`、`opinion` 只檢查格式），不做預備與日常。
  - 下面用引號寫出來的字串要一字不差。
- 驗收測試：`engine/tests/pending/M1-abilities.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-abilities`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/abilities/index.ts`）

```ts
export const abilitiesFeature: Feature
export const TREE_XP = [0, 40, 120, 240, 400]      // 一棵樹開到第 N 階，要在這棵樹累計花 TREE_XP[N-1] 點
export interface AbilityState { xp: number; learned: string[]; equipped: string[]; spent: Record<string, number> }
export function abilitiesOf(state, actor): AbilityState           // 沒有的人回傳 { xp: 0, learned: [], equipped: [], spent: {} }
export function treeTier(k, state, actor, path: string): number   // 1～5
export function learnBlock(k, state, actor, id: string): string | null
export function learn(k, state, actor, id: string): ReportDraft   // 不能學就丟錯（訊息是那個原因）
export function capacityOf(k, state, actor): Record<'meat' | 'net' | 'social' | 'media', { used: number; max: number }>
export function equipAbilities(k, state, actor, ids: string[]): ReportDraft   // 整份換掉裝著的清單；不合格就丟錯
```

- 狀態存在 `actor.ext.abilities`（`AbilityState`）。橋的容量讀 `actor.ext.bridge.capacity`（`{ meat, net, social, media }`；沒有的當 0）。
- `learn` 的報告：`kind: 'action'`、`action: 'ability.learn'`，一筆 `actor.ext` 變更（`xp` 減掉、`learned` 加上、`spent[樹]` 加上）。`equipAbilities` 的報告：`action: 'ability.equip'`。兩個都不花時間。

## 二、內容的格式

### `path`（一棵樹一筆）

`id`、`name`（路數：槍手）、`tree`（樹的名字：戰鬥直覺）、`category`（`meat`、`net`、`social`、`media`）、`signature`（招牌技能的 id，引用 `ability`）、`domains`（`{ meat, net, opinion }`，值是 `strong`、`strong_support`、`mid`、`weak`、`none`）、`resonance`（陣列，每一筆 `{ tier: 1～5, cells: 數字, text: 完整的句子, effect?: 物件 }`）。

### `ability`（一個技能一筆）

| 欄位 | 必填 | 格式 |
|---|---|---|
| `id`、`name`、`text` | 是 | `text` 是給玩家看的完整說明 |
| `path` | 是 | 引用 `path` |
| `category` | 是 | 要和那棵樹的 `category` 一樣 |
| `tier` | 是 | 1～5 |
| `layer` | 是 | `signature`、`front`、`back` |
| `kind` | 是 | `active`、`passive`、`reaction`、`stance`、`prep`、`daily` |
| `cap` | 是 | 1～6 的整數 |
| `xp` | 是 | 一定是 `tier * 20`；不是的話錯誤訊息裡要有 `xp` 這個字 |
| `cells` | 是 | 數字（份量） |
| `after` | 招牌以外必填 | 前置技能的 id；要存在、而且在同一棵樹（在 `ready` 檢查，訊息裡要有那個 id） |
| `use` | | `{ ap?, per_turn?, per_fight?, first_round?, note? }`；`note` 是設計書「消耗」那一欄裡放不進前面幾個鍵的原文（錢、人情、編輯點），這一批不讀 |
| `meat`、`net`、`opinion` | 是 | 物件或 `null`。那棵樹的 `domains` 寫 `none` 的那一欄一定要是 `null`（錯誤訊息：`` `${id}：${樹的名字}在輿論沒有效果（domains.opinion 是 none），opinion 要是 null` ``，內海同理） |
| `prep`、`daily` | | 物件或 `null`，只檢查型別 |

`meat` 裡只能用第四節那張表的鍵；出現別的鍵就擋下，訊息裡要有那個鍵的名字。`net`、`opinion` 這一批不檢查裡面的鍵。

要看別筆內容才知道對不對的檢查（`after` 存在而且同一棵樹、`category` 和樹一樣、`domains` 是 `none` 的那一欄是 `null`、樹的 `signature` 存在）都放在 `ready(k)`，有錯就 `throw new Error(訊息)`。

## 三、學與裝

`learnBlock` 照這個順序檢查，回傳第一條：

1. 沒有這個技能 → `'沒有這個技能。'`
2. 已經在 `learned` 裡 → `'已經學會了。'`
3. 樹還沒開到那一階 → `` `${路數的名字}這棵樹還沒開到 ${tier} 階（要在這棵樹累計花 ${TREE_XP[tier-1]} 點，現在 ${spent} 點）。` ``
4. 前置還沒學 → `` `要先學會${前置的名字}。` ``
5. 歷練點不夠 → `` `歷練點不夠（要 ${xp} 點，現在 ${有的} 點）。` ``

`treeTier`：`spent[樹]`（沒有是 0）達到 `TREE_XP[N-1]` 的最大的 N。

`capacityOf`：`used` 是裝著的技能照各自的 `category` 把 `cap` 加起來；`max` 是橋的容量。

`equipAbilities(k, state, actor, ids)` 丟錯的情況：有沒學的 → `` `還沒學會${名字}。` ``（沒有這個技能也算）；某一類裝不下 → `` `${類的名字}的容量不夠（要 ${要的}，橋只有 ${有的}）。` ``（類的名字：`meat` 現實型、`net` 內海型、`social` 社交型、`media` 媒體型）。

## 四、帶進戰鬥

### 單位上的資料

戰鬥裡每個單位的 `unit.ext.abilities` 是 `{ equipped: string[], tiers: Record<樹, 階數> }`。

- `k.battle.on('unit.ready', 'abilities', ({ run, unit }) => …)`：有 `actor` 的單位，照開打那一刻填上：`equipped` 是角色裝著的清單，`tiers` 是 `spent` 裡有的每一棵樹的 `treeTier`（`run.state` 是遊戲狀態）。已經有 `ext.abilities` 的單位（測試直接給的、之後敵人資料給的）不動。
- 同一個掛點裡、填完之後做開場的效果（下面的 `weapon_cost`）。一定要用這個掛點，不要用 `battle.start`：先攻是在 `battle.start` 之前擲的，共鳴的先攻加值要讀得到 `ext.abilities`。

「這個單位裝著某個技能」一律看 `unit.ext.abilities.equipped`；「某棵樹的階數」看 `tiers[樹] ?? 1`。

### `meat` 的鍵（這一批的封閉清單）

| 鍵 | 用在 | 意思 |
|---|---|---|
| `target` | 主動 | `enemy`、`ally`、`self`、`ally_slot`、`enemy_slot`、`none` |
| `attack` | 主動、反應 | 用手上的武器攻擊一次。子鍵：`aimed`（算瞄準過的射擊）、`hit`（命中加多少）、`spend: 'all'`（花掉彈匣裡剩下的全部）、`min_mag`（彈匣至少要有幾格）、`dice: 'spent_minus_1'`（傷害骰多「花掉的格數 − 1」顆）、`suppress: { dc: 'spent' 或數字, skill }`（打完之後目標過檢定，失敗被壓制；`'spent'` 是 10 ＋ 花掉的格數 × 2）、`at: 'attacker'`（反應：打的是正在攻擊的那個敵人） |
| `apply` | 主動 | `[{ status, until? }]`：給目標狀態，`by` 是用技能的人 |
| `free_move` | 主動 | `{ swap_adjacent_pair: true }`：讓選的隊友和他相鄰的另一名隊友交換位置，不花他們的行動點 |
| `cost` | 被動 | `{ ability, ap }`：裝著時，那個技能改花這麼多行動點 |
| `weapon_cost` | 被動 | `{ trait, ap }`：裝著時，帶這個特性的武器射擊一次改花這麼多行動點 |
| `trigger` | 反應 | `ally_attacked`（一名隊友被攻擊、擲命中之前）、`ally_attacked_adjacent`（那名隊友和自己相鄰） |
| `evade` | 反應 | 被攻擊的那名隊友這一次的迴避加多少 |
| `on_hit` | 反應 | `{ hit_against_ally: -2 }`：反應的那一槍命中的話，原本那次攻擊的命中加這麼多 |
| `give_ap` | 被動（招牌） | `{ max: 'one_plus_half_tier' }`：多一個行動「指揮」 |
| `call` | 被動（招牌） | `{ options: [...], per_fight: 'half_tier_up', ap }`：多一個行動「叫人」 |
| `instinct` | 被動（招牌） | `true`：戰鬥直覺的分配。這一批只收下這個鍵，不做效果（之後的工單） |
| `pending` | 任何 | `true`：這個技能在現實有效果，但還沒有做成機制。收下、不註冊行動、不做效果 |

共鳴的 `effect` 只能用：`initiative`（數字）、`free_move: { per_fight: 數字 }`、`pending: true`。

### 主動技能變成行動（在 `ready(k)` 裡照內容註冊）

每一個 `kind: 'active'`、`meat` 裡有 `target` 的技能註冊一個行動（`meat` 是 `null`、是 `pending`、或只有 `cost`／`weapon_cost` 這類被動的鍵的不註冊；定點射已改成被動）：`id` 是技能的 id、`owner: 'abilities'`、`name`、`desc: text`、`group: 'skill'`、`modes: ['meat']`、`order` 是它在內容裡的順序、`has` 是「這個單位裝著它」。

- **花費**：`use.ap`；有別的裝著的被動技能的 `meat.cost.ability` 指向它時，改用那個 `ap`。
- **共同的 `blocks`**：`use.per_fight` 用完了（`unit.uses[技能 id] >= per_fight`）→ `'這一場已經用過了。'`；`use.first_round` 而現在不是第 1 回合 → `'只能在第一回合用。'`；`use.per_turn` 用完了（`unit.uses['turn:' + 技能 id]`）→ `'這一回合已經用過了。'`。用了之後把對應的次數加一（`turn:` 開頭的核心會在這個人的回合開始時清掉）。
- **`attack` 的 `blocks`**：手上是近戰武器 → `'要拿著槍才能用。'`；彈匣空了 → `'彈匣空了，要先換彈。'`；有 `min_mag` 而彈匣（現在的格數，或容量）不到 → `` `彈匣裡要有 ${min_mag} 格以上才能連射。` ``。
- **目標**（`targets`）：`enemy` 是敵方每一個在場上的人；`ally` 是我方每一個在場上的人（不含自己）。
- **做**（`run`）：先記一拍 `run.say(`${名字}：${技能的名字}。`, 'skill', { unit, ability }, unit)`，再照鍵：
  - `attack`：`run.attack(unit, target, { aimed, hit, spend, dice, label: 技能的名字, tags: ['skill'], part: input.pick?.part })`。`hit` 這樣傳，擲骰的明細裡會多一項，名字就是 `label`（技能的名字）。`spend: 'all'` 時 `spend` 是彈匣現在的格數、`dice` 是格數 − 1。打完之後有 `suppress` 而目標還在場上：`run.save(target, 'resolve', suppress.skill, DC, '定力')`，沒過就 `run.applyStatus(target, 'suppressed', { by: unit })`。
  - `apply`：`run.applyStatus(target, status, { by: unit, until })`。
  - `free_move.swap_adjacent_pair`：`input.pick.with` 是另一名隊友的單位 id；兩個人要相鄰（站位差 1），不然 `BattleBlocked(['要選兩名相鄰的隊友。'])`；`run.move(那名隊友, 另一個人的格)`（兩個人交換；不花他們的行動點）。

### 掮客的招牌：兩個行動

裝著 `meat.give_ap` 的技能的單位多一個行動 `<技能 id>.give_ap`：`name: '指揮'`、`group: 'skill'`、`target: 'ally'`、花 1 點。

- 每回合最多讓 `1 + Math.floor(tiers[樹] / 2)` 點（用 `unit.uses['turn:' + 行動 id]` 記）。讓滿了 → `blocks`：`` `這一回合已經讓了 ${上限} 點，不能再讓。` ``
- 目標是我方其他在場上的人；他的行動點已經到上限 → 那個目標的 `blocks`：`'他的行動點已經滿了。'`
- 做：目標的行動點 +1（不超過上限）。記一拍（`'skill'`）。

裝著 `meat.call` 的多一個行動 `<技能 id>.call`：`name: '叫人'`、`group: 'skill'`、`target: 'none'`、花 `call.ap` 點。

- 每場 `Math.ceil(tiers[樹] / 2)` 次（用 `unit.uses[行動 id]` 記）。用完了 → `` `這一場叫人的次數用完了（${次數} 次）。` ``
- `target` 寫 `'none'`，目標放在 `input.target` 與 `input.pick.option`，在 `run` 裡自己檢查：
  - `cover_up`：`input.target` 是我方的一格 → `run.raiseCover(side, slot, 1)`。
  - `cover_down`：`input.target` 是敵方的一格、那一格有遮蔽 → `run.lowerCover(side, slot, 1, unit)`。
  - `shot`：`input.target` 是一個敵人 → 支援射擊一次：命中是 `d20 + 4 + 場景的等級 × 2` 對目標的迴避（`run.evadeOf(target).total`），打中造成 `3 + gradeDice(場景的等級)` 顆 d6 的物理傷害（`run.damage(target, 骰出來的, 'physical', unit)`）。
  - 選項不在 `call.options` 裡、或目標對不上 → `BattleBlocked(['叫人要選一件事：補遮蔽、拆遮蔽，或支援射擊。'])`
- 做完記一拍 `run.say(…, 'support', { unit, option })`。

核心的 `battleAct` 對 `target: 'none'` 的行動不檢查 `input.target`，所以上面這樣寫可以。

### 被動、共鳴與反應

- `cost`、`weapon_cost`、`give_ap`、`call` 不看技能的 `kind`：裝著就生效。
- `cost`：見上面的花費。
- `weapon_cost`：在 `unit.ready` 把這個單位帶那個特性的每一把武器的 `ap` 改成那個數字（射擊的花費讀的是武器的 `ap`）。
- 共鳴：一個單位在某棵樹的階數到了 N，那棵樹 `tier <= N` 的共鳴都生效（要裝著那棵樹的招牌才算）。
  - `initiative`：`k.battle.modifier` 在 `kind === 'initiative'` 時回傳 `{ label: 共鳴的樹名, value }`。
  - `free_move: { per_fight: 1 }`：`kind === 'move_ap'` 時，這一場還沒用過就回傳 `{ label, value: -1 }`；`k.battle.on('moved', …)` 在 `by === 'action'`、而且換位的就是輪到的那個人（`run.current()?.id === unit.id`）時把 `unit.uses.free_move` 加一。
- 反應（`k.battle.on('attack.before', …)`，收到 `{ run, attacker, target, weapon, opts }`）：`opts.tags` 裡有 `reaction` 的攻擊不觸發反應。被攻擊的人那一方、不是他自己、還在場上的人照站位一個一個看，每個反應技能這一次攻擊最多觸發一次：
  - 條件：裝著它；`trigger` 成立（`ally_attacked_adjacent` 要和被攻擊的人站位差 1）；`use.per_turn` 還沒用完；`run.canAfford(反應的人, { ap: use.ap })`。
  - 成立就 `run.spend`、次數加一、記一拍（`'skill'`），然後：有 `evade` → `opts.evade = (opts.evade ?? 0) + evade`。有 `attack`（掩護射擊）→ 手上要是有子彈的槍，不然不觸發；`const r = run.attack(反應的人, attacker, { label: 技能的名字, tags: ['reaction'] })`，`r.hit` 而且有 `on_hit.hit_against_ally` → `opts.hit = (opts.hit ?? 0) + 那個數字`。

## 五、這一批要動得起來的技能

驗收測試自己帶這十一個技能的資料（`PACK`），照 SKILL_TREES 的文字：戰鬥直覺（只收鍵）、要害射擊、連射控制、掩護射擊、看我的！、定點射、就是你了、人面（指揮與叫人）、集火、小心後面！、換個位子嘛，加上槍手 1、2 階的共鳴。掩護射擊驗收測試沒有涵蓋，自己補一個測試。

## 六、已知的事

1. 技能的效果用的是這份工單定的鍵，不是 SKILLS 第 13 節的樣本（那一節的 id、欄位與數字是舊的，和 SKILL_TREES 對不上）；cpp-architect 已經回報（`dev/adr/0013`）。
2. 叫人的「支援射擊」打多痛、命中多少，設計書沒有寫數字；上面的是暫定（`dev/adr/0013`）。換個位子嘛後半句「換到的那一格有遮蔽的人，迴避 +1 到他的下一回合」、連射搭配點放、戰鬥直覺的分配，在下一批。
3. 「集火」「就是你了」之後隊友打那個敵人，擲骰的明細裡的 `{ label: '標記', value: 2 }` 是核心照狀態的資料加的，這個功能只要把狀態給上去。
4. CORE_RULES 6.4 節舉例的容量（要害射擊 2、人面 2）和 SKILL_TREES（1、3）不一樣；資料照 SKILL_TREES，這件事已經回報。
