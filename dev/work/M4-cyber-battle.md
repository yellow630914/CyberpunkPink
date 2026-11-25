# M4-cyber-battle

- 交給：cpp-feature（sonnet）
- 目標：義體進戰鬥：單位上的 `implants`、衍生數值 `cyber_count`、設計圖的 `battle` 欄位（反射加速器、熱驅動、冷卻迴路、藥泵都是資料）、戰地手術的「裝上一件義體」、重的重創讓義體失效。
- 規格出處：CYBERWARE 第 3、4 節；CRAFTING 5.5 節「反射加速器是明寫的例外」；COMBAT_SYSTEM 第 6 節重創的表（肢體、頭兩列的「重」）；SKILL_TREES 改造師的「戰地手術」那一列；ITEMS 4.1 節「預裝在藥泵裡的藥不花行動點」；ENEMIES 4.1 節（AI 偏好 `bridged`）；dev/adr/0015 第三節（`implants`、失效與超頻）、E13；dev/adr/0019 第三節與 P9、P10、P46、P47。
- 可以改的路徑：`engine/src/features/cyberware/`、`engine/tests/features/M4-cyber-battle.test.ts`。
- 可以用的介面：`k.battle.loadout`（回傳 `implants`）、`k.battle.action`（行動；宣告 `icon`、`picks`，dev/adr/0014）、`k.battle.modifier`、`k.battle.on('round.start' | 'turn.start' | 'overload' | 'unit.ready')`、`k.battle.onEnd`、`k.battle.effect`（戰鬥的效果 op；寫法看 `features/combat/ops.ts`）、`k.battle.effectProblems`、`run.implantStatus`、`run.performAction`、`syncCapOf`、`syncRuleOf`；功能的第二段 `ready(k)`（內容載入之後照資料註冊行動）；`modeOf`。
- 不可以做的事：不改核心；戰鬥中不寫角色的狀態（裝上去的那一件在戰鬥結束的報告裡才寫進 `actor.ext.cyber`）；每一種義體不另外寫程式（只認 `battle` 欄位的格式）；內海戰鬥不給 `implants`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 設計圖多讀 `implant_kind?`（失效與超頻用的種類：`arm`、`eye`、`reflex`……；沒寫用 `slot`）。
- 設計圖的 `battle`：
  - `actions?: Array<{ id, name, icon, ap, uses?: { turn?, battle? }, do: 效果清單 }>`：一次性的行動（冷卻迴路）。
  - `toggle?: { id, name, icon, levels?: boolean, upkeep_load: number | Record<檔位, number>, mods: Array<{ mod, amount, tags? }> }`：開關（反射加速器）。`levels: true` 時開的時候要選檔（`picks` 列四檔，開不了的帶 `syncBlocks` 的原因），另外吃同步表那一檔的檢定加減。
  - `scaling?: Array<{ mod, per_load, amount, tags? }>`：照現在的感載每 `per_load` 點給 `amount`（熱驅動）。
  - `pump?: true`：藥泵。
- 那一件多的鍵：`loaded?: { item, qty }`（藥泵裡預裝的藥）。
- 衍生數值 `cyber_count`：身上不是橋的義體件數（休養中的也算）。
- 戰鬥的效果 op `implant_install`（`{ who }`，只能由技能用）；單位上的 `ext.cyber`：`{ on?: 開著的 toggle 與檔位, field?: 這場裝上的 }`。
- 報告：`cyber.pump`（戰鬥外替藥泵裝藥）。

## 要做的

1. `loadout`（只在現實的戰場）：每一件好了、沒有 `off` 的義體變成一筆 `{ kind, name, contract? }`（`contract` 看那一件的 `lock.kind`）。`cyber_count` 註冊成衍生數值。
2. 重的重創（P46）：角色身上有狀況 `wound_head` 時，照槽的順序第一件眼或腦的義體當成 `off`；有 `wound_limb` 時第一件手臂或腿的義體當成 `off`。這是讀的時候算的，不寫進狀態；狀況拿掉就恢復。被動效果與 `loadout` 都照這個算。
3. `ready`：掃過每一張帶 `battle` 的設計圖，各註冊成戰鬥的行動（`has`：這個單位的角色身上有那一件而且生效中；`modes` 只有現實）。效果清單用 `effectProblems` 查，查不過的那一張設計圖在載入時擋下。
4. 開關：開著時每個自己的回合開始，自己的感載加 `upkeep_load`（照檔位）；`mods` 用 `source: 'cyber'` 生效（`ap_regen` 會被節奏資源的上限夾，M4-core-passive）；過載時自動關掉。0 行動點、每回合只能切一次。
5. `scaling`：算修正時照單位現在的感載給。
6. 藥泵：戰鬥外 `loadPumpDraft` 把背包裡一種帶 `drug` 欄位的物品裝進去（最多 3 劑，暫定）；戰鬥中多一個 0 行動點的行動，用掉一劑、效果照那個物品的 `use.effects`（交給現有的「使用道具」那條路：`run.performAction` 或直接跑效果清單，做的人看 `features/combat/items.ts` 選一種並寫進回報）。
7. `implant_install`（P47）：目標是相鄰的隊友；從使用者的快取格拿一件義體成品（背包裡 `id` 是義體設計圖、設計圖 `size` 2 以下的那一疊），目標要有空槽。這場戰鬥裡：加進他的 `implants`、他可以用那一件的 `battle` 行動、那一件 `effects` 裡 `mod` 類的生效。戰鬥結束（`onEnd`）才寫進角色：`pieces` 多一件、背包少一疊、沉溺成本照自己動刀算、不休養；另外擲一次義體學（對標準 DC），失敗多一筆併發症。這一場被回退（重來、撤退）就什麼都沒發生。
8. 失效與超頻的對象：核心的 `run.implantStatus` 照 `implants` 的 `kind` 挑；這一張確認開著的 toggle 被 `off_<kind>` 打到時跟著關。

## 驗收條件（`engine/tests/features/M4-cyber-battle.test.ts`；測試自帶反射加速器（toggle、分檔）、熱驅動（scaling）、冷卻迴路（action：排 6 點）、藥泵、一條義臂；戰鬥用 testkit 的 `makeBattleGame`）

- 主角裝兩件義體加一座橋：`cyber_count` 是 2；現實戰鬥的單位 `implants` 兩筆、`cyber` 是 2；內海戰鬥沒有 `implants`。
- 反射加速器開標準檔：下一回合多回 1 點行動點、回合開始感載 +3；同時吃著一種給 `ap_regen` +1 的藥（測試直接掛一個來源 `drug` 的修正）還是只多 1；過載之後它是關的。深檔在同步不到 3 級時灰掉並有原因。
- 熱驅動：感載 0 沒有加成、25 時近戰傷害 +2。
- 冷卻迴路：1 行動點、感載 −6、一回合第二次被擋。
- 藥泵：戰鬥外裝兩劑；戰鬥中用一次不花行動點、劑數少一；打完狀態裡剩一劑。
- `wound_head` 的角色：第一件義眼不生效（它的 `effects` 沒有、`implants` 裡沒有它）；狀況拿掉之後回來。
- `implant_install`：測試用一個假的技能行動跑這個 op。裝上之後這一場用得了那條義臂的行動；打贏之後角色身上多一件、背包少一疊、`sink_floor` 上升；「重來這場戰鬥」之後背包那一疊還在、身上沒有。
- 設計圖的 `battle.actions` 用了沒有人註冊的效果：載入時被擋並指出哪一張。
- 敵人 AI 的 `bridged` 偏好對裝了義體的主角生效（位置分比沒裝的人高；沿用 `M1` 那條測試的寫法）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-deck 之後（同一個資料夾）。

## 完成時回報

改了哪些檔、測試結果、藥泵走了哪一條路、缺圖示的鍵（交 cpp-ui）、CYBERWARE 第 3 節裡要在戰鬥中生效而 `battle` 欄位寫不出來的。

- 總指揮補記（2026-11-25）：給戰鬥回復（`ap_regen`／`ram_regen`）的修正，來源一定要標對（義體 `cyber`、藥 `drug`、裝備 `gear`），才會被節奏資源合計最多 +1 夾住；藥不要用狀態的 `mods` 給回復（來源會變 `status`，不受上限）。見 ADR 0019「實作補記：M4-core-passive」。
