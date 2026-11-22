# M1b-core-effects

- 交給：cpp-feature（sonnet；**這一張改的是核心**，派工時要明說可以改 `engine/src/core/battle/` 與 `engine/src/core/types/battle.ts`）
- 目標：照 dev/adr/0015 第一、二節，把道具效果的登錄表升成通用的效果登錄表，並加上攻擊與退出的攔截點、救回來、回復的來源、檢定的標籤、AI 挑目標的權重、先攻對調。
- 規格出處：dev/adr/0015 第一、二節（設計）；dev/adr/0010、0014（現有的登錄表與掛點）。設計書不用讀。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`、`engine/src/features/combat/`（只為了改用新名字與補標籤）、`engine/src/features/enemies/`（士氣補標籤）、`engine/tests/core/`、dev/invariants.md（加一條：效果的 `op` 都查得到）。
- 可以用的介面：`BattleRegistry`（`registry.ts`）、`BattleRun`（`run.ts`）、`targetWeight`（`ai.ts`）、`MOD_KINDS`（`rules.ts`）、`BATTLE_EVENTS`（`types/battle.ts`）。
- 不可以做的事：不改現有掛點與基本動作的行為（主套件要照樣全過）；不在核心裡註冊任何效果（核心只有登錄與解析）；不動 `engine/src/shell/`；不 commit。

## 要做的

1. **登錄表**：`effect(op, owner, fn)`、`effectIds()`、`getEffect(op)`；`itemOp`、`itemOpIds` 留成別名。型別 `EffectCtx`、`EffectSource`、`BattleEffectOp` 照 ADR 第一節（`ctx.item` 留著：來源是道具時等於 `source.id`，現有的道具效果不用改）。
2. **`run.effects(list, ctx)`**：照順序；解析 `who`（清單照 ADR；`area` 對那兩格上的人各呼叫一次，再對掛著、沒被擊落的每一台各呼叫一次並帶 `ctx.overlay`）；解析 `if`；每筆做完把 `ctx.last` 留給下一筆。`who` 或 `if` 不在清單裡丟錯。
3. **公式**：`amount(ctx, expr)`、`amountProblems(expr)`，文法照 ADR。骰子用 `run.roll`。
4. **`AttackOpts`**：`natural`、`armorMult`、`redirect`。`AttackResult` 多 `redirected?`、`negated?`。
5. **掛點** `attack.hit`、`out.before`（`setOut` 改成回傳 `boolean`）。
6. **`run.revive(unit, hp)`**；`BATTLE_EVENTS` 加 `revive`。
7. **`run.heal(target, amount, by?, tags?)`、`run.vent(…)`**；`MOD_KINDS` 加 `heal_dealt`、`vent_dealt`、`ai_target_pct`、`see_dark`。`features/combat` 的道具效果呼叫時帶 `by`（用的人）與標籤 `['item', …物品的 tags]`。
8. **`run.save(…, extra?, tags?)`**；現有的呼叫補標籤（制伏 `subdue`、抵抗壓制 `resist:suppressed`、士氣 `morale`、脫離 `flee`）。
9. **AI**：`targetWeight` 乘上 `ai_target_pct`；黑暗的兩處改成也看 `see_dark`。
10. **`run.swapOrder(a, b)`、`run.actNext(u)`**。

## 驗收條件（自己寫成測試，放 `engine/tests/core/battle-m1b-effects.test.ts`；用 `engine/src/testkit` 的情境與 `TEST_COMBAT`，效果用測試裡臨時註冊的）

- 同一個 `op` 註冊兩次丟錯；`itemOp` 註冊的，`getEffect` 查得到。
- `run.effects`：`who` 清單裡每一種都落在對的人身上（`area` 含掛著的東西、不含被擊落的）；`if: 'hit'` 在上一筆沒中時跳過；不認得的 `who` 丟錯。
- 公式：`'2d6+skill:medicine'`、`'tier*2'`、`'half_tier_up'`、`'1d6+1'` 算得對；`amountProblems('2d6+foo')` 回傳一條帶 `foo` 的訊息。
- `natural: 20` 的攻擊一定命中且不另外擲命中骰（戰鬥的擲骰次數只多傷害那幾顆）；`armorMult: 2` 時護甲 2 的目標少受 2 點。
- `attack.before` 設了 `redirect`：原本的目標生命不變、那一台扣耐久、結果 `redirected` 是 `true`；彈匣只扣一次。
- `attack.hit` 設 `negate`：目標不受傷、遮蔽照樣受傷、`attack.after` 照樣發；設 `wound = false`：自然 20 不發 `wound` 掛點。
- `out.before` 擋下生命歸零：那個人還在場上、生命 1、沒有「倒下」的那一拍、戰鬥沒有結束；擋下 `subdued` 也成立。
- `revive`：倒下的人回到最後面的空格、生命是給的數字、行動點 0；沒有空格時進後方最前面；對 `burnout`、`subdued` 的人回傳 `false`。
- 有人註冊 `heal_dealt` +4 時，帶 `by` 的回復多 4，不帶的不多；道具的急救帶得到。
- `save` 的標籤傳到修正：只對 `subdue` 加值的修正不影響士氣檢定。
- `ai_target_pct` −100 的人不被挑；場上只剩他時照樣被挑。`see_dark` 的人打黑暗裡的目標沒有 +2。
- `swapOrder` 之後兩個人的順位對調、現在輪到的人不變；`actNext` 對已經動過的人回傳 `false`。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；種子重播的固定檔沒有變（新欄位都不預設生效）。

## 依賴

沒有。做完才能開 M1b-core-overlay 與 M1b-ops。

## 完成時回報

改了哪些檔、測試結果、ADR 寫得不夠清楚或做不到的地方（不要自己改設計，停下來回報）。
