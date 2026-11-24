# M3-core-mapgen

- 交給：cpp-architect 角色（sonnet；**改的是核心**，可以改 `engine/src/core/grid/`）
- 目標：格子地圖的生成器：一個純函式，照一份 `spec` 與一串亂數挖出一張圖、放好節點，回傳版面、節點的圖與沒畫在版面上的東西；附一個檢查函式。不認得任何一區。
- 規格出處：dev/adr/0018 第五節最後一條；CYBERSPACE 8.1 節「生成的順序」第 2～8、10 步與「每一層的密度」的表（只當成 `spec` 要表達得出來的範圍，不寫進程式）；CODESCAN 2.2 節（生成器要補的：入口出口可設定、純佈局與依存檔佈置分開、用種子重現、節點之間的拓樸）；UI 1.1 節規則 4（一層 11 × 9，迷宮館 9 × 7）。ElondiaRPG 的 `generateSide`（`/home/user/yellow630914/elondiarpg`）只當參考。
- 可以改的路徑：`engine/src/core/grid/gen.ts`（新）、`engine/src/core/grid/index.ts`、`engine/tests/core/mapgen.test.ts`、dev/invariants.md。
- 可以用的介面：M3-core-grid 的 `NET_LEGEND`、`CELL_TRAITS`、`Sheet`、`sheetProblems`；`core/util/rng.ts` 的雜湊與導出亂數。
- 不可以做的事：不讀內容、不讀遊戲狀態、不用遊戲的亂數游標（亂數只來自傳進來的 `rand`）；不寫「子網」「迷宮館」「蕾絲」這些字；共同的規定見 dev/work/M3-plan.md。

## 新的型別與鍵

```ts
interface GenPlace {
  kind: CellKind                 // 放哪一種格子（要在 CELL_TRAITS 裡）
  count: [number, number]        // 最少、最多
  where: 'far_half' | 'dead_end' | 'mid_path' | 'link' | 'any'
  name?: string                  // 標記的名字；好幾個時後面加編號
  trap?: boolean                 // 陷阱：不能佔住入口到出口那條保證的路
  hidden?: boolean               // 不畫在版面上（那一格是地板），位置回在 hidden
  apart?: number                 // 和入口至少隔幾個節點
}
interface GenSpec {
  id: string; name: string; size: [number, number]
  carve: [number, number]        // 挖幾步（決定節點的多寡）
  exit?: { kind: CellKind; name: string }   // 放在照鏈路算離入口最遠的節點
  places: GenPlace[]             // 照順序放；先寫的先挑位置
  oneway?: number; fragile?: number          // 鏈路裡單向的、走過就斷的比例（0～1）
  sight?: number
}
interface GenResult {
  sheet: SheetDef
  graph: { nodes: Array<{ id: string; at: [number, number]; kind: string; depth: number }>
           edges: Array<{ a: string; b: string; cells: Array<[number, number]>; oneway?: 'ab' | 'ba'; fragile?: boolean }> }
  hidden: Array<{ kind: string; at: [number, number] }>
  safe_path: Array<[number, number]>          // 入口到出口、不經過任何陷阱的一條路
}
generateSheet(spec: GenSpec, rand: () => number): GenResult
genProblems(spec: GenSpec, result: GenResult): string[]
seedRand(seed: number, purpose: string): () => number
```

## 要做的

1. **挖結構**：從一邊的入口往外挖，步數在 `carve` 的範圍裡抽；挖出來的格子分成節點（放得下東西的位置：路口、死路的盡頭、房間）與鏈路（節點之間的走道）。四方向相連；邊框留牆。演算法自己選（醉漢走路加修整、房間加走廊都可以），只要驗收的性質成立。
2. **入口與出口**：入口是 `entry`（`E`）；有 `exit` 時放在照鏈路算離入口最遠的節點。
3. **放東西**：`far_half` 是離入口最遠的那一半節點；`dead_end` 是死路的盡頭（不夠時退到 `far_half`）；`mid_path` 是保證的那條路上、一半左右的位置；`link` 是鏈路上的格子；`any` 是任何空的節點。`trap` 的不放在保證的路上；`hidden` 的不改版面。同一個節點只放一樣。數量在 `count` 裡抽；位置不夠時先減到最少，連最少都放不下就重挖（最多重挖 20 次，還是不行丟錯，訊息寫出是哪一種放不下）。
4. **單向與會斷的鏈路**：照比例挑鏈路，各放一格 `net_valve` 或 `net_bridge` 在那一段的中間；挑完之後入口仍然到得了出口、每個節點仍然從入口到得了。
5. **圖**：每個節點的 `id` 是它那一格的標記 id（沒有標記的節點用 `n<編號>`），`depth` 是照鏈路從入口算的步數；每一段鏈路記兩端與經過的格子。
6. **檢查**（`genProblems`）：`sheetProblems` 是空的；每個節點走得到；`safe_path` 真的從入口到出口而且不經過 `trap` 的格子與 `hidden` 裡標成陷阱的位置；每一種的數量在範圍內。`generateSheet` 回傳之前自己跑一次，不合格當成放不下、重挖。

## 驗收條件（`engine/tests/core/mapgen.test.ts`；性質測試用 fast-check）

- 同一份 `spec`、同一個種子生成兩次，結果逐字一樣；換種子不一樣。
- 任意種子（至少兩百個）、三種尺寸（9 × 7、11 × 9、13 × 9）、兩份測試自己寫的 `spec`（一份照一般子網的密度：`carve` 30～40、兩種陷阱各 0～1、檔案庫 1～2、休息點 1、遭遇 1～3；一份照迷宮館：18～24）：`genProblems` 都是空的。
- `far_half` 的東西 `depth` 不小於所有節點 `depth` 的中位數；`dead_end` 的在只有一個鄰居的節點上（有那麼多死路時）；`mid_path` 的在 `safe_path` 上；出口的 `depth` 是最大的。
- `trap: true` 的格子都不在 `safe_path` 上；`hidden: true` 的不在版面上、那一格是地板。
- `oneway: 0.5` 時每一張圖入口都到得了出口；`net_valve` 那一段的方向記在 `graph`，照方向走得通。
- `edges` 的 `cells` 是連續的、兩端接著節點；`depth` 和用 `Sheet.findPath` 算的一致。
- 放不下的 `spec`（9 × 7 要放二十個遭遇）丟錯，訊息寫出是哪一種。
- 一張 11 × 9 的圖生成在 50 毫秒以內（平常幾毫秒）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-core-grid。做完才能開 M3-netrun。

## 完成時回報

改了哪些檔、測試結果、選了哪一種挖法與理由、`spec` 表達不出來的 CYBERSPACE 8.1 的規則（預期：巡邏的路線由用的人從 `graph` 自己挑；詞條改生成結果由用的人在 `spec` 上先改好）。
