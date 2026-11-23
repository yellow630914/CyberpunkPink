# M1b-review-core

- 交給：cpp-architect（核心，M1b 審查與白箱的核心修正；sonnet）
- 目標：把審查 dev/reviews/2026-11-23-M1b.md 與白箱 W011～W013、B015 裡屬於核心的部分修掉，並替功能那一側列出需要的介面。
- 規格出處：dev/adr/0015（含所有實作補記）、COMBAT_SYSTEM 1.2、9.1 節；SKILL_TREES 不准動喔、跑位射擊、迴圈；dev/invariants.md。
- 可以改的路徑：`engine/src/core/`、`engine/src/shell/`、`engine/tests/`（核心與測試基礎建設；功能的測試只動 B015、W011 搬家與不變式相關的幾處）、`dev/adr/0015`、`dev/invariants.md`。
- 不可以做的事：不動 `engine/src/features/`、`ui/`（另一個代理在做 `dev/work/M1b-review-features.md`）；不 commit。

## 項目（決定與理由在 ADR 0015「實作補記（M1b-review-core）」）

| 編號 | 做什麼 |
|---|---|
| E1 | `attack()`、`attackOverlay()` 在 `attack.before` 之後問新的 `run.gone(attacker)`：替身被打下來或收走，這一擊 `aborted` |
| W011、B015 | 失去回合的人也發 `turn.start`、`turn.end`，帶 `lost: true`（計時照數，處理函式要做事的自己看 `lost`） |
| W012 | `leave` 在發 `out` 之前，把別人身上算「他的回合」的狀態（`source_turn_*`）拿掉；功能的計時聽 `out` |
| W013、S9 | `revive` 清姿態，發新掛點 `revive`；功能在那裡清 buff 與持續型快駭 |
| E3 | `BATTLE_EVENTS` 加 `angel`、`tease`、`trait`；掃原始碼的測試 |
| S1 | `stop` 在這一筆的每個落點都做完之後才看 |
| S11 | 核心多 `noteAttack(last, result)`：`aborted` 時 `last.hit` 是 `undefined` |
| S6、S7、S8、S10 | 核心的介面夠用（`overload`＋`out.before`、`gainSink`、`overlayOfStandIn`＋`damageOverlay`、`poolName`）；改的是功能，列在回報 |

## 驗收

- `engine/tests/core/battle-m1b-review-core.test.ts`（每一項至少一個測試）；B015 與 W011 的測試從 `tests/pending/` 搬進 `tests/features/`；W012、W013 的功能那一半留在 `tests/pending/W011-W013-ability-timers.test.ts`，等功能那側做完再搬。
- 既有測試全過；動到的兩個（`stop` 的期望）列在回報。
- `npx tsc --noEmit`、`npm test`、冒煙、`test:pending`（只有 B009 可以紅）、分層檢查。

## 完成時回報

改了哪些檔、測試結果、既有測試動了哪幾處與原因、功能那一側需要做的事。
