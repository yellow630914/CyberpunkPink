# M1-explore

- 交給：cpp-feature
- 目標：做一個功能 `explore`：在格子地圖上走到保全站的那一格就開打（用那一區的遭遇點決定遮蔽與場地效果）、打贏了那個保全崗清掉、站在撤離點可以離開。格子地圖本身（版面、位置、看過的格子、走一步）已經在核心。
- 規格出處：COMBAT_SYSTEM 第 10 節只看「探索用格子，走到敵人那一格就開打」那一段；COMMISSION_MAPS 1.3、1.5 節（圖例、遭遇點、`G` 是開場時保全站的位置）；SITES 12.5 節只看「用哪個遭遇點」那一列。監視器、巡邏、門鎖、資料埠、憑證是 M2，不在這一張。
- 可以改的路徑：`engine/src/features/explore/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行 `explore`）、`engine/tests/features/`、`engine/tests/pending/M1-explore.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面（都從 `'../../core'` import；檔案在 `engine/src/core/grid/`）：
  - 站上帶某種標記的格子：`k.grid.onMark('G', 'explore', (ctx, marker) => GridEffect | void)`（`registry.ts`）。`ctx` 是 `{ k, state, sheet, map, at }`：`at` 是 `{ map（實例的 id）, sheet, x, y }`，`sheet` 是 `Sheet`（`model.ts`：`zoneAt(x, y)`、`findPath(from, to)`、`def.spots`）。回傳 `{ battle: BattleSetup, stop: true }` 就是「走到這一格為止，這一步提交之後開打」。
  - 這一格能做的事：`k.grid.usesOf('explore', (ctx, marker) => GridUse[])`；畫面用 `game.gridView().here.uses` 讀。
  - 現在站的地方：`gridHere(k, state)`（`walk.ts`）回傳 `ctx` 加上 `instance`（這份地圖的實例，`instance.ext` 是發起的功能放的東西）與 `sheetState`（`cells['x,y']?.used`）。清掉一份實例：`closeMap(state, id)` 回傳變更。
  - 變更：`{ op: 'map.ext', map, value }`（整份換掉實例的 `ext`）、`{ op: 'map.sheet', map, sheet, cells: { 'x,y': { used: true } } }`、`{ op: 'map.at', to: null }`。
  - 戰鬥結束時加變更：`k.battle.onEnd('explore', ({ state, battle, outcome }) => ({ changes }))`（`engine/src/core/battle/registry.ts`）。開打的設定：`BattleSetup`、`UnitRef`（`engine/src/core/battle/setup.ts`）。
- 不可以做的事：
  - 不改 `engine/src/core/`、`engine/src/shell/`、`engine/src/testkit/`；不 import 別的功能（保全崗放誰，由發起的功能用 `placeGuards` 交進來，這個功能不知道敵人的資料）。
  - 不做巡邏的移動、警戒、監視器、門鎖。
- 驗收測試：`engine/tests/pending/M1-explore.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M1-explore`。通過之後 `git mv` 到 `engine/tests/features/`，再跑 `npm test` 與 `npx tsc --noEmit`。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題。

## 一、要匯出的東西（`engine/src/features/explore/index.ts`）

```ts
export interface GuardPost { foes: UnitRef[]; faction?: string }
/** 把每個保全崗放誰寫在這份地圖的實例上。回傳變更（呼叫的人放進自己的報告）。鍵是標記的 id（G1、G2）。 */
export function placeGuards(state, mapInstanceId: string, guards: Record<string, GuardPost>): Change[]
export const exploreFeature: Feature & { useHere(k, state, id: string): ReportDraft }
```

- `placeGuards`：回傳 `[{ op: 'map.ext', map: mapInstanceId, value: { ...實例原本的 ext, guards } }]`。沒有這份實例就丟錯。
- `exploreFeature.useHere(k, state, id)`：做「這一格能做的事」裡的那一件，回傳報告草稿；這一格沒有這件事就丟錯。

## 二、走進保全崗（`onMark('G')`）

1. 這份實例的 `ext.guards[marker.id]` 沒有東西，或這一格已經用過（`sheetState.cells['x,y']?.used`）→ 什麼都不回傳（只是一格地板）。
2. 遭遇點：這張圖的 `def.spots` 裡，和保全崗在同一個區塊的（`sheet.zoneAt` 一樣）那幾個；好幾個時用走路最近的（`sheet.findPath(保全崗, 遭遇點)` 的長度最短；一樣近取 `spots` 裡前面的；走不到的排最後）。同一區沒有遭遇點時用整張圖裡走路最近的；整張圖都沒有就用 `{ cover: 'medium' }`。
3. 回傳

```ts
{ stop: true, battle: {
    mode: 'meat',
    allies: state.party.map((id) => ({ from: 'actor', id })),
    foes: 那個保全崗的 foes,
    cover: 遭遇點的 cover,
    field: Object.fromEntries((遭遇點的 field ?? []).map((f) => [f, true])),
    origin: { escapable: true, place: marker.name, faction: 那個保全崗的 faction（有才放）,
              ext: { map: ctx.at.map, sheet: ctx.at.sheet, guard: marker.id, spot: 遭遇點的 id（有才放）, at: [x, y] } },
} }
```

場景的等級不寫（核心用主角所在那一區的）。

## 三、打贏了（`k.battle.onEnd`）

`outcome === 'win'` 而且 `battle.origin.ext?.guard` 有值：回傳 `{ changes: [{ op: 'map.sheet', map, sheet, cells: { 'x,y': { used: true } } }] }`（`x,y` 是 `origin.ext.at`）。那份實例已經不在了（被清掉）就什麼都不回傳。其餘的結果（輸了、脫離了）不動：保全還在那一格。

## 四、撤離點

- `usesOf`：`marker.mark === 'X'` → `[{ id: 'leave', name: '離開', block: null }]`；其餘的標記回傳空陣列。
- `useHere(k, state, 'leave')`：站的那一格要是 `X`（用 `gridHere` 與 `sheet.markerAt`）。回傳

```ts
{ kind: 'action', action: 'grid.leave', location: 現在的 location, party: [], timeline: [],
  changes: closeMap(state, 實例的 id),
  outcome: { result: 'left', summary: `你從${marker.name}離開。` } }
```

## 五、已知的事

1. 走到保全那一格之後人就站在那一格上；輸了或脫離之後還站在那裡，再走進去（先離開再回來）會再打一次。脫離之後保全會不會追、警戒怎麼變，是 M2 的事。
2. 副本裡的戰鬥不能脫離（`escapable: false`）由發起的功能決定；這一張一律寫 `true`，M2 的委託副本開打時自己蓋掉（到時候 `GuardPost` 會多一個欄位）。
