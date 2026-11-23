# M2-explore

- 交給：cpp-feature（sonnet）
- 目標：把現實面的探索補完：監視器、被看到、門鎖、巡邏、每一種標記能做的事、警戒；開戰時帶上增援與發起的人給的東西。
- 規格出處：SITES 12.5 節（整張表）、12.1 節（標記）；COMMISSIONS 2.3 節「壓力條」（警戒 60 與 100）；COMMISSION_MAPS 1.1、1.3、1.5 節；DATA 9.3 節（`controls`、`patrols`、`zones`）；dev/adr/0012、0016 第三節（`alert`）、第五節與第七節（地圖實例的 `ext`）。
- 可以改的路徑：`engine/src/features/explore/`、`engine/tests/features/M2-explore.test.ts`。
- 可以用的介面：`k.grid.onEnter`／`onMark`／`passRule('door_locked')`／`usesOf`、`Sheet`（區塊、視線、最短路）、`map.sheet`（`cells`、`movers`）與 `map.ext` 變更、`k.meters.define`、核心的檢定、`k.activity.allow`。
- 不可以做的事：不知道委託是什麼（階段、分支、連動都不在這裡；它們經由地圖實例的 `ext` 進來）；入口的條件不在這裡擲（開地圖的人自己處理）；`tests/features/M1-explore*.test.ts` 要照樣全過；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 量表 `alert`（照地圖的實例、0～100、AI ±20）。
- 地圖實例的 `ext`（開地圖的人填，這個功能讀）：`guards`（已經有）、`reinforce: UnitRef[]`（警戒到 60 之後加進下一場的後方）、`origin`（原樣併進開戰設定的 `origin.ext`）、`stealth`（這一段走潛行而且檢定過了）、`dc_base`（沒寫是 10 ＋ 等級 × 2）、`grade`、`spot`（這一段指定用哪個遭遇點）、`edge`（原樣放進開戰設定的 `edge`）。這個功能自己寫的：`keys`、`controlled`（接管了哪幾區）、`carry`（帶著的人）、`seen_by`。
- 報告：`grid.use`（時間軸的標籤 `mark:<標記>`）、`grid.unlock`。

## 要做的

1. **監視器**：走進有 `S` 的區塊而那一區沒被接管，每走一格警戒 +2。
2. **被看到**：和 `G` 同一區塊、中間沒有牆，就開那個保全崗的遭遇（`pre.spotted` 是 true）；`ext.stealth` 時改成警戒 +5、不開打，同一個 `G` 只算一次。
3. **門鎖**（`door_locked`）：有鑰匙（`keys`）或那一區被接管就放行並把門改成開的；否則擋下，原因寫出兩種辦法。`unlock(k, state, at, how)`：撬（機械對 `dc_base`，失敗警戒 +5）、破門（運動對 `dc_base`，不論成敗警戒 +10）。
4. **巡邏**：玩家每走一格，有路線的 `G` 照路線往下一個區塊走一格（區塊之間走最短路），位置記在 `movers`；被看到與走到它那一格都照它現在的位置算。
5. **標記的用途**（`usesOf` 加 `useHere`）：`T` 拿或動手、`D` 插上、`K` 拿（進 `keys`）、`C` 接管（機械或介面對 `dc_base`；成功後那幾區的監視器與門鎖失效）、`$` 打開（機械對 `dc_base` ＋ 2）、`&` 帶走（進 `carry`）、`X` 離開（已經有）。做過的標記記成用過。每一種都只留下狀態與報告，不知道它對誰有意義。
6. **開戰**：遭遇點先看 `ext.spot`，沒有再照現在的挑法；開戰設定的 `origin.ext` 併上 `ext.origin`；警戒 60 以上時把 `ext.reinforce` 接在敵方後面（整張地圖只加一次）。
7. `k.activity.allow('commission', …)`：`grid.`、`commit:grid.`。

## 驗收條件（用 DATA 9.3 節那張小辦公室當假資料）

- 在有監視器的區塊走三格警戒 +6；接管那一區之後再走不加。
- 走進保全看得到的格子就開打，`origin.ext.pre.spotted` 是 true；`stealth` 時不開打、警戒 +5，再走一格不重複加。
- 上鎖的門：沒鑰匙走不過去並有原因；拿了 `K` 之後走得過去、那一格之後是開的門；撬鎖失敗警戒 +5；破門 +10。
- 巡邏的保全每一步往路線的下一個區塊靠近一格，走完一圈回原位；存檔再讀位置不變。
- 六種標記各做一次：狀態記下來、報告的標籤對、做過的不能再做並有原因。
- `ext.origin` 的鍵出現在開戰設定裡，`ext.edge` 也是；警戒 60 時這一場的後方多了 `reinforce` 的人，下一場不再加。
- `ext.spot` 指定的遭遇點決定遮蔽的配置。
- 警戒不超過 100；效果 `alert` 落在現在這張地圖上。
- M1 的探索測試原樣全過。

## 依賴

M2-core-meters、M2-core-activity。M2-commission-run 要它。

## 完成時回報

改了哪些檔、測試結果、SITES 12.5 節裡沒做的（預期：黑暗的察覺陷阱、「巡邏減半」之外的連動效果）。
