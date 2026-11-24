# M3-mode-audit

- 交給：cpp-feature（sonnet）
- 目標：既有功能的戰鬥掛點、修正、結算照戰場分清楚：只在現實成立的先看戰場，兩邊都成立的不動。做完之後，帶著全部功能開一場內海戰鬥不會出現現實才有的東西。
- 規格出處：dev/adr/0018 第一節最後一條與背景的「現在就會出錯的事」；CYBERSPACE 6.1 節的對照表（哪些是相同、哪些換掉）；COMBAT_SYSTEM 第 6 節（重創，內海是破損）、第 7 節（制伏，內海是釘住）。
- 可以改的路徑：`engine/src/features/combat/`、`gear/`、`enemies/`、`summons/`、`abilities/`、`lewd/`（各只加戰場的判斷，不改現實的行為）、`engine/tests/features/M3-mode-audit.test.ts`。
- 可以用的介面：`run.mode`（`layer`、`tracks`）、`view.mode`、`modeOf(k.content, id)`、`BattleActionDef.modes`、`k.battle.loadout` 的第三個參數（戰場的 id）。
- 不可以做的事：不寫任何內海的規則（破損、釘住、構裝都是後面的工單）；不改核心；現實的測試原樣全過，一條都不能改；地圖那一邊（`features/explore` 在網內地圖上不作用）不在這一張，在 M3-netrun；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. 把 `engine/src/features/` 裡每一處 `k.battle.on(`、`k.battle.modifier(`、`k.battle.onEnd(`、`k.battle.loadout(`、`k.battle.unitSource(`、`k.battle.action(` 列成一張表（哪個功能、哪個掛點或行動、做什麼），逐一判斷：**兩邊都成立**（狀態、buff、反應的時機、遮蔽、監視的機制、和人重疊的東西的規則）還是**只有現實**（彈匣與換彈、重創的部位、束帶與制伏、脫離、士氣裡的生命比例、天使急救、槍械與護甲的 loadout、快取格、慾求的開戰感載以外和生命有關的東西）。
2. 只有現實的：行動確認寫了 `modes: ['meat']`；掛點與修正的開頭加「不是現實就不做」（看 `layer`，不要比對戰場的 id：之後可能有第二個現實的戰場）。已經用 `battle.mode !== 'meat'` 寫的改成看 `layer`。
3. 已知要改的（不限於這些）：`combat` 的重創（`registerWounds`）；`combat` 的武器附帶效果裡和彈匣有關的（卡彈、炸膛）；`gear` 的 loadout 在內海不回快取格（腳本由甲板的功能給）、戰後用掉快取格的結算只看現實；`enemies` 的士氣在沒有生命的單位上不算生命比例也不丟錯、天使急救只在現實、`capture` 的敵人白給的束帶只在現實。
4. `enemies` 的單位來源在內海照舊組出現實的單位（那是 M3-lace 的事）；這一張只保證它的掛點在內海不出錯。

## 驗收條件（`engine/tests/features/M3-mode-audit.test.ts`；用 `allFeatures()`，內海的單位用 `from: 'unit'` 直接給、沒有生命那一條；行動用測試自己註冊的最小兩個：花 RAM 的攻擊與回填）

- 內海戰鬥的 `battleOptions`：沒有射擊、近戰攻擊、換彈、換武器、打遮蔽、使用道具、制伏、脫離、叫車與任何一個只寫了現實的技能行動；有結束回合、換位與測試的兩個。
- 釘死骰面打出自然 20：沒有擲身體的部位，目標身上沒有 `limb_hurt`、`dazed`、`bleeding`，`wounds` 是空的。
- 角色帶著槍、護甲與快取格進內海：武器不含那把槍、`quick` 是空的；同一個角色進現實戰鬥照舊都有。
- 內海的敵人（`ai` 的 `fleeBelow` 是 0.5、沒有生命）被打到快倒：士氣的掛點不丟錯；沒有天使急救的倒數。
- 隨機打完十場內海戰鬥（十個種子）不丟錯，不變式（`observed`）沒有違規。
- 回報裡有第 1 步的那張表（至少：功能、掛點、判斷、怎麼處理）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；沒有改到任何既有的測試。

## 依賴

沒有（測試自己組內海的單位，不必等 M3-core-battle）。要在 M3-netcombat 之前做完。

## 完成時回報

改了哪些檔、那張表、判斷不了的項目（設計書沒說內海適不適用的，逐條列出來問，不要自己決定）。
