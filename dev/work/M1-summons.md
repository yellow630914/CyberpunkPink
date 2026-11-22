# M1-summons

- 交給：cpp-feature
- 目標：做一個功能 `summons`：機師的無人機（放出、指揮、移動、收回；攻擊、護盾、偵察、醫療、干擾五種）、把載具叫進來當掩體、用拿下的控制節點改變戰場（關燈、放下防爆門）。機甲不在這一張（M6；核心只留了接口）。
- 前置：`dev/work/M1-data-rules.md`、`dev/work/M1-combat.md` 做完了（驗收測試用 `allFeatures()`，裡面要有射擊這個行動）。
- 規格出處：COMBAT_SYSTEM 9.1 節（無人機）、9.2 節（載具）、2.4 節最後一條（控制節點）、2.5 節（黑暗）；ENEMIES 第 3 節站位表的「無人機」那一列（迴避 +3）。只讀這幾處。
- 可以改的路徑：`engine/src/features/summons/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `summons`）、`engine/tests/features/`、`engine/tests/pending/M1-summons.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import；檔案在 `engine/src/core/battle/`）：
  - 行動：`k.battle.action(def)`（`registry.ts`；`has` 決定誰有這個行動，`target` 可以是 `ally_slot`、`overlay`、`node`）。範本：`engine/src/testkit/battle.ts` 的 `TEST_COMBAT`。
  - 和人重疊的東西：`battle.overlays`（`BattleOverlay`，`engine/src/core/types/battle.ts`）；直接往陣列加、改、拿掉（行動的 `run` 拿到的是工作副本）。被打的那一段核心已經做好（`run.attackOverlay`；射擊可以選它當目標）；被擊落時核心呼叫掛點 `k.battle.on('overlay.down', owner, ({ run, overlay, by }) => …)`。操作者倒下時核心會讓他的每一台停機（不呼叫這個掛點）。
  - 控制節點：`battle.nodes`（`BattleNode`：`id`、`kind`、`name`、`taken`、`used`）。場地效果：`battle.field`（`dark: true` 時核心已經會讓全場迴避 +2）。
  - 修正：`k.battle.modifier(owner, (q) => RollPart[])`（`q.kind === 'evade'` 時 `q.unit` 是被打的人）。
  - 單位剛組好：`k.battle.on('unit.ready', owner, ({ run, unit }) => …)`。
  - `BattleRun`（`run.ts`）：`attack(attacker, target, { weapon, spend: 0, label, tags })`、`applyStatus`、`heal`、`cleanse`、`addLoad(target, 5, by, { exact: true, label })`、`raiseCover(side, slot, levels, max?)`、`say`、`unit`。`gradeDice(grade)`、`attrMod`。
  - 做不成的一步（要看 `input.pick` 才知道的）：`throw new BattleBlocked([原因])`。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；不 import 別的功能（機師有哪些無人機讀單位上的 `ext.summons`；裝備的功能之後會把它填上）。
  - 不做機甲、不做敵方的無人機與砲塔、不做接管砲塔、不做機師技能樹裡的技能（那是技能的另一批）。
  - 下面用引號寫出來的字串要一字不差。
- 驗收測試：`engine/tests/pending/M1-summons.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-summons`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/summons/index.ts`）

```ts
export const summonsFeature: Feature
/** 同步幾級連得住幾台；索引是同步的級數 0～6 */
export const DRONE_CAP_BY_SYNC = [1, 1, 2, 2, 3, 3, 4]
/** 無人機的生命與護甲，索引 0 是 I 級 */
export const DRONE_STATS = [{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }]
```

單位上的資料 `unit.ext.summons`：

```ts
{ drones?: Array<{ kind: 'attack' | 'shield' | 'scout' | 'medic' | 'jammer'; grade: 1 | 2 | 3 | 4; name?: string; item?: string }>,
  vehicle?: { name: string; hp: [半掩體的耐久, 掩體的耐久] } }
```

這一張只讀它（測試直接給）。沒有 `ext.summons` 的人沒有下面這些行動。

## 二、無人機的四個行動（都花 1 點、`group: 'skill'`、`modes: ['meat']`、`owner: 'summons'`）

`has`：四個行動都是「單位的 `ext.summons.drones` 有東西」（還沒放出任何一台時，指揮、移動、收回照樣列在圓環上，只是灰的）。

| id | 名字 | `target` | 做什麼 |
|---|---|---|---|
| `drone.deploy` | 放出 | `ally_slot` | 把 `input.pick.drone`（`ext.summons.drones` 的索引）放到我方的一格 |
| `drone.command` | 指揮 | `overlay` | 讓一台做一次它的動作 |
| `drone.move` | 移動 | `overlay` | 把一台換到相鄰的格（`input.pick.slot`） |
| `drone.recall` | 收回 | `overlay` | 把一台收回來（從 `battle.overlays` 拿掉；之後可以再放出） |

### 放出

- `blocks`：場上他的無人機（沒被擊落的）已經達到 `DRONE_CAP_BY_SYNC[同步]`（同步是 `unit.skills.sync ?? 0`，夾在 0～6）→ `` `同步 ${級數} 級只連得住 ${台數} 台。` ``；每一台都放出去了或被擊落了 → `'沒有可以放的無人機了。'`。
- `targets`：我方四格；那一格已經掛著一台沒被擊落的 → `blocks: ['這一格已經掛著一台了。']`。空格也可以掛。
- `run`：`input.pick.drone` 不是有效的索引、已經放出去了、或這一場被擊落過 → `BattleBlocked(['沒有這一台無人機。'])`。放出去的那一台：

```ts
{ id: `o${battle.seq += 1}`, side: unit.side, slot, owner: unit.id, kind, name: 名字（沒寫就用「攻擊無人機」「護盾無人機」「偵察無人機」「醫療無人機」「干擾無人機」）,
  hp: { now: DRONE_STATS[grade - 1].hp, max: 同一個數字 }, armor: DRONE_STATS[grade - 1].armor,
  evade: 這個戰場的 n.evadeBase + 3, used: false, down: false, ext: { drone: 那個索引, grade } }
```

  記一拍 `run.say(…, 'overlay', { overlay: id, kind, slot }, unit)`。用 `unit.uses` 或 `ext.drone` 記哪幾台放出去了、哪幾台被擊落了。

### 指揮（每台每回合一次）

- `targets`：他的每一台沒被擊落的 `{ overlay: id }`；`used` 是 `true` 的 → `blocks: ['這一台這一回合動過了。']`。
- 做完把那一台的 `used` 設成 `true`；輪到操作者的回合開始時（`k.battle.on('turn.start', …)`）把他的每一台的 `used` 清回 `false`。
- 照種類：
  - **攻擊型**：`input.pick.at` 是一個敵人的單位 id（沒給或不在場上 → `BattleBlocked(['要選一個敵人。'])`）。`run.attack(操作者, 目標, { weapon, spend: 0, label: '無人機射擊', tags: ['drone'] })`，`weapon` 是一把臨時的武器：`{ id: 'drone', name: 無人機的名字, class: 'drone', dice: 2 + gradeDice(grade), flat: 0, type: 'physical', range: [1, 7], pierce: 0, hit: attrMod(操作者的反應) + (操作者的 skills.piloting ?? 0), attr: 'reflex', skill: 'piloting', coverMult: 0.25, traits: [] }`。
  - **干擾型**：同上，但 `type: 'em'`。
  - **偵察型**：`input.pick.at` 是一個敵人 → `run.applyStatus(目標, 'marked', { by: 操作者, until: 'source_turn_start' })`。
  - **護盾型**：指揮它沒有另外的動作（它的好處是被動的，見下面）→ `BattleBlocked(['護盾無人機不用指揮：它替同一格的人擋著。'])`。設計書寫的「替同一格的人擋下一次攻擊」之後跟著機師的技能做。
  - **醫療型**：和它同一格的隊友回 `2d6` 生命、止血（`run.heal`、`run.cleanse(那個人, 'first_aid')`）；那一格沒有人 → `BattleBlocked(['那一格沒有人。'])`。

### 移動、收回

- 移動的 `targets` 和指揮一樣列（不看 `used`）。`input.pick.slot` 要和現在的格相鄰、而且那一格沒有掛著別台，不然 `BattleBlocked(['只能換到相鄰、沒有掛著別台的格。'])`。
- 收回：從 `battle.overlays` 拿掉，記一拍。

### 被動的好處與被擊落

- 護盾型：`k.battle.modifier` 在 `q.kind === 'evade'` 時，`q.unit` 那一格掛著同一方、沒被擊落的護盾型 → `[{ label: '護盾無人機', value: 2, source: 'overlay' }]`。
- 偵察型「同格的人不受黑暗影響」這一批先不做（核心的黑暗是加在被打的人的迴避上，要動到核心；已經記下來）。
- `k.battle.on('overlay.down', …)`：操作者還在場上 → `run.addLoad(操作者, 5, by, { exact: true, label: '無人機被擊落' })`；記下這一台這一場不能再放。

## 三、載具 `vehicle.call`

`name: '叫車'`、`group: 'skill'`、`target: 'ally_slot'`、花 2 點。`has`：`ext.summons.vehicle` 有東西。

- `blocks`：這一場已經叫過（`unit.uses['vehicle.call']`）→ `'這一場已經把車叫進來了。'`
- `targets`：我方四格。
- `run`：`run.raiseCover(unit.side, slot, 2, vehicle.hp)`（那一格變成掩體，耐久用載具自己的）；`unit.uses['vehicle.call'] = 1`；記一拍。

## 四、控制節點 `node.use`

`name: '控制節點'`、`group: 'tactic'`、`order: 9`、`target: 'node'`、花 1 點。`has`：`battle.nodes.length > 0`（每個人都有）。

- `blocks`：沒有任何一個 `taken` → `'還沒有拿下任何控制節點。'`
- `targets`：每一個節點都列 `{ node: id }`；還沒拿下的 → `blocks: ['這個節點還沒有拿下。']`；用掉的 → `blocks: ['這個節點已經用掉了。']`。
- `run`，照 `kind`：
  - `light`：`battle.field.dark` 開著就關、關著就開（關掉是 `delete`）；可以一直用，`used` 不動。記一拍 `'field'`。
  - `door`：`input.pick.slot`（我方的 1～4 格；沒給 → `BattleBlocked(['要選放在哪一格。'])`）→ `run.raiseCover(unit.side, slot, 2)`；`used = true`。記一拍 `'node'`。
  - 其他種類 → `BattleBlocked(['這個節點現在用不了。'])`。

誰來「拿下」節點（潛網者的快駭）在 M3；這一張只做拿下之後的用法（測試直接把 `taken` 設成 `true`）。

## 五、已知的事

1. 設計書沒有寫的數字，這一張用的是 cpp-architect 的暫定（`dev/adr/0013`）：攻擊型的骰數（「比手槍低一級」先當 2d6 加等級骰）、無人機的射程不扣距離、無人機的迴避是 10 ＋ 3、叫車 2 點、用控制節點 1 點、醫療型回 2d6。
2. 「從快取格放一台」：無人機是快取格裡的物品，這一張先讀 `ext.summons.drones`；物品與裝備那一邊怎麼把它填上，等無人機的資料轉寫時另外開工單。
3. 要選目標的行動，`targets` 回傳空陣列時核心會自動加一條 `'沒有可以選的目標。'`：所以控制節點要把每一個節點都列出來（沒拿下的帶著原因）。
