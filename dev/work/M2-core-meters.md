# M2-core-meters

- 交給：cpp-architect 角色（sonnet；**改的是核心**）
- 目標：照 dev/adr/0016 第三節，在核心加「量表」：照對象分開記的有範圍的數字，定義一種就自動有同名的效果與條件；存檔升到第 3 版。
- 規格出處：dev/adr/0016 第三節；dev/adr/0007（效果的三級上限、一件事合計）；EVENTS 2.4 節那張表裡 `hostility`、`favor`、`affinity`、`loyalty`、`fame`、`rep`、`alert` 幾列（只為了對照上限的寫法）。
- 可以改的路徑：`engine/src/core/state/`（新增 `meters.ts`；`coreChanges.ts`、`blank.ts`、`kernel.ts`）、`engine/src/core/rules/`（`kernel.ts`、新增接上效果與條件的那一段）、`engine/src/core/types/state.ts`、`engine/src/shell/save.ts`、`engine/src/testkit/`、`engine/tests/core/`、`engine/tests/fixtures/saves/`（加一份第 2 版的舊檔）、dev/invariants.md。
- 不可以做的事：核心自己不定義任何一種量表；不改現有效果的上限算法；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `GameState.meters: Record<string, Record<string, number>>`；`STATE_VERSION = 3`。
- `k.meters.define({ kind, owner, name, min, max, start, keyed, cap?, floor?, adjust? })`、`k.meters.get(kind)`、`meterOf(k, state, kind, key?)`。
- 變更 `{ op: 'meter', kind, key, delta }` 或 `{ op: 'meter', kind, key, set }`。
- 自動註冊的效果 `{ kind: <量表>, key?, amount }`（和現有的 `cash`、`cred` 一樣用 `amount`）與條件 `{ kind: <量表>, key?, min?, max? }`。

## 要做的

1. 狀態與變更：沒寫過的鍵讀出來是 `start`（沒有人定義的種類讀出來是 0）；變更套用時夾在 `min`～`max`，有 `floor` 時不低於那張量表同一個鍵的值；量表的種類沒有人定義時擋下，訊息寫出種類；鍵要是非空字串。
2. `key` 省略時照 `keyed`：`district` 用 `state.location.district`、`map` 用 `state.maps.at?.map`、`none` 用 `_`；`faction`、`npc` 一定要寫，沒寫是格式錯誤。`keyed` 是 `faction`、`npc`、`district` 時，鍵在內容裡查得到才收（`npc` 另收存檔裡的角色 id）。
3. 定義時自動註冊效果與條件；名字和現有的效果或條件撞到就丟錯。效果的上限：內建的照寫；AI 的一件事合計不超過 `cap`（分組是「種類加鍵」）；被夾時給白話的提醒（用量表的 `name`，不出現欄位名）。`adjust` 在夾值之前套。
4. 存檔：第 2 版讀進來補一張空的表；讀檔時表裡有沒人定義的種類照樣留著（那個功能這一局沒裝），不擋。
5. 探針：定義時發 `registry.register`。

## 驗收條件（`engine/tests/core/meters.test.ts`）

- 定義一張 0～100、起始 0 的量表：`+30` 再 `+90` 停在 100；`set: -5` 停在 0；沒寫過的鍵是起始值。
- 每個鍵各記各的；`keyed: 'district'` 省略鍵時記在現在這一區。
- 有 `floor`：下限那張是 30 時，往下扣只會停在 30。
- 同名的效果經 `k.effects.resolve`：內建的照寫；AI 的兩筆 +8 在上限 10 時合計只給 10，並有一筆提醒；`adjust` 回傳兩倍時先加倍再夾。
- 同名的條件：`{ kind, key, min: 40 }` 在 39 不成立、40 成立。
- 沒有人定義的種類：變更被擋下、狀態不變；效果的格式檢查說沒有這種效果；`meterOf` 回傳 0、不丟錯。
- 第 2 版的舊檔讀得進來、`meters` 是空的；第 3 版存了再讀，數字一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；dev/invariants.md 補「量表只經由 `meter` 變更改」「讀別的功能的數字只經由 `meterOf`」。

## 依賴

M2-core-shell 做完（都動 `core/state` 與存檔，不要同時做）。做完才能開 M2-lewd、M2-security、M2-npcs、M2-explore。

## 完成時回報

改了哪些檔、測試結果、ADR 做不到的地方。
