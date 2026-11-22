# M1b-core-overlay

- 交給：cpp-feature（sonnet；**這一張改的是核心**，派工時要明說可以改 `engine/src/core/battle/` 與 `engine/src/core/types/battle.ts`）
- 目標：照 dev/adr/0015 第三節，讓和人重疊的東西可以沒有操作者、自己開火，加上每一輪開頭的掛點與義體在戰鬥裡的樣子。
- 規格出處：dev/adr/0015 第三節與 E6；COMBAT_SYSTEM 9.1 節、ENEMIES 第 10 節「共用的規則」（只為了對照，數字不在這一張）。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`、`engine/src/features/summons/`（改用 `addOverlay`、放出的上限問 `overlay_cap`、自己放的無人機照舊在操作者退出時停機）、`engine/tests/core/`、dev/invariants.md。
- 不可以做的事：不改無人機現有的數字與句子（`tests/features/M1-summons.test.ts` 要照樣全過）；不寫敵方無人機的行為（那是 M1b-enemy-units）；不 commit。

## 要做的

1. 掛點 `round.start`：`{ run, round }`。
2. `BattleOverlay`：`owner?`、`weapon?`、`auto?`、`autonomous?`。操作者退出時：`autonomous` 的改成沒有操作者、`auto = true`、`ext.orphan = true`、不發 `overlay.down`；其餘照舊停機。`battleProblems` 跟著放寬（`owner` 可以沒有；有的話要查得到）。
3. `run.addOverlay(init)`：那一格已經掛著一台沒被擊落的丟 `BattleBlocked(['這一格已經掛著一台了。'])`；有操作者時耐久（現在與上限）、護甲、迴避各加 `overlay_hp`、`overlay_armor`、`overlay_evade` 的修正（問的是操作者，標籤 `[kind]`）；記一拍 `overlay`。`MOD_KINDS` 加這三個與 `overlay_cap`、`overlay_backlash`（`features/summons` 問：放出的上限、被擊落時操作者受的感載 5 點的加減，最少 0）。
4. `run.overlayAttack(o, target, opts)` 與替身（照 ADR）。`run.attack` 的目標是替身時改走 `attackOverlay`；`applyStatus`、`shift`、`place` 對替身回傳 `false`、不丟錯。`attackOverlay` 做完發 `attack.after`。
5. 義體：`BattleUnit.implants?`；`UnitSource` 回傳的單位與 `Loadout` 都可以帶；`cyber` 沒寫時用件數。`run.implantStatus(...)` 照 ADR；狀態查不到（連 `_generic` 都沒有）丟錯，訊息裡寫出要哪一個狀態 id。`battleProblems` 驗 `implants` 的形狀。

## 驗收條件（`engine/tests/core/battle-m1b-overlay.test.ts`）

- `round.start` 每一輪發一次、第一輪也發、發的時候還沒有人行動。
- 沒有操作者的一台：開得了戰、讀得了檔、打得到、被擊落時不找操作者。
- `autonomous` 的一台在操作者倒下之後還在、`auto` 是 `true`、`owner` 沒有；不是 `autonomous` 的停機（和現在一樣）。
- `addOverlay`：同一格第二台被擋；有人註冊 `overlay_hp` +5 時放出來的耐久多 5，沒有操作者的不問。
- `overlayAttack`：命中用那一台自己的武器、傷害乘 `ext.dmgMult`；`attack.before`／`attack.after` 拿到的攻擊者帶 `ext.overlay`；反應用 `run.attack` 打回去時扣的是那一台的耐久。
- `implantStatus('off')`：有兩件義體的人連續兩次各挑到不同的一件；指定 `kind` 而他沒有那一種時回傳 `null`、沒有記拍；沒有義體的人回傳 `null`。
- 存檔往返：帶著沒有操作者的一台與 `implants` 的戰鬥存了再讀，接著打的結果和沒有中斷的一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M1b-core-effects 做完（兩張都改 `run.ts`，不要同時做）。做完才能開 M1b-skill-pilot、M1b-enemy-units、M1b-hack。

## 完成時回報

改了哪些檔、測試結果、做不到或 ADR 沒寫清楚的地方。
