# M3-core-battle

- 交給：cpp-architect 角色（sonnet；**改的是核心**，可以改 `engine/src/core/battle/`、`engine/src/core/rules/`、`engine/src/core/types/battle.ts`、`engine/src/core/index.ts`、`engine/src/testkit/`）
- 目標：照 dev/adr/0018 第一、二節補戰場的缺口（屬性的代替、防護讀哪個數值、個人的脫離、閃斷的狀態、新的修正與事件），並把同步原則做成核心規則層的一張表與「開得到哪一檔」。
- 規格出處：dev/adr/0018 第一、二節與 N3、N4、N12；CYBERSPACE 4.1、6.1、6.2、6.4、6.7 節；CORE_RULES 第 5 節；LEWD_SYSTEM 第 1 節的表（敏感度的門檻）；dev/adr/0010、0013 C1。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/rules/`（新增 `sync.ts`）、`engine/src/core/types/battle.ts`、`engine/src/core/index.ts`、`engine/src/testkit/battle.ts`、`engine/tests/core/battle-m3.test.ts`、`engine/tests/core/sync.test.ts`、`engine/tests/helpers/`、dev/invariants.md。
- 可以用的介面：`BattleMode`／`battle_mode`、`DEFAULT_STATUSES`、`BattleRun.overload`、`checkResult`、`unitFromActor`、`k.stats`（`hasStat`、`stat`）、`k.content.defineKind`（`overridable`）。
- 不可以做的事：不寫行動表、不寫同步檔位在戰鬥裡的效果（那是 M3-netcombat；核心只有表與「開得到哪一檔」）；不改現實戰鬥的行為（現有的現實測試原樣全過）；資料檔不動（M3-data-rules）；共同的規定見 dev/work/M3-plan.md。

## 新的型別與鍵

- `BattleMode`（資料 `battle_mode`）多：`attrAs?`（資料 `attr_as`，`{ 屬性: 屬性 }`）、`guardStat?`（`guard_stat`）、`leave?`（`{ out, outcome }`）。核心的預設：現實 `guardStat: 'armor'`；內海 `attrAs: { body: 'resolve' }`、`guardStat: 'net_guard'`、`leave: { out: 'jacked_out', outcome: 'jack_out' }`。
- 核心內建的狀態 `flash`（放在 `DEFAULT_STATUSES`，名字「閃斷」）；`BattleStatusRule` 多 `noRegen?: string[]`（資料 `no_regen`）：帶著它的回合開始時，這幾池不回復。
- `overload` 掛點的 payload 多 `flash?: { pool: string; before: number }`（閃斷歸零的是哪一池、歸零之前有多少）。
- `MOD_KINDS` 加：`admin_uses`、`refill`、`trace_round`、`trace_admin`、`sync_cap`、`sync_shifts`（各自一句註解，意思照 0018 第一節）。
- `BATTLE_EVENTS` 加：`shift`、`jam`、`break`、`pin`、`tether`、`jack_out`、`admin`、`trace`、`located`。
- `run.cutSlot(side, slot, untilRound)`：斷路。記在 `battle.field` 的 `cut:<方>:<格>`（值是到第幾輪結束為止）。
- 場地效果 `safe`（`battle.field.safe` 是 true）：這一場倒下不加沉溺（迷宮館的熔斷保護，CYBERSPACE 8.2）。
- `core/rules/sync.ts`（L4）：`SYNC_GEARS = ['shallow', 'standard', 'deep', 'full']`；內容種類 `sync_rule`（`overridable`，id `default`）：每一檔 `{ name, check, load_pct, need_skill, need_sensitivity, ap_regen?, sink_on_overload? }`，另有 `skill`（看哪一項基本功，預設 `sync`）、`sink_bonus_at`（沉溺到多少上限 +1 級，預設 60）；`syncRuleOf(content)`、`syncCapOf(k, state, actor)`、`syncBlock(k, state, actor, gear)`（開不了的原因，一條一句；開得了是 `null`）、`battleAttr(mode, attr)`（照 `attrAs` 換過的屬性，給組武器的功能用）。

## 要做的

1. **防護讀哪個數值**：`unitFromActor` 的護甲改成「`mode.guardStat` 那個衍生數值（沒有人註冊就是 0）＋ loadout 的 `armor`」。內海不再讀現實的 `armor`。
2. **屬性的代替**：`run.save` 在這個戰場把屬性照 `attrAs` 換過再算；匯出 `battleAttr`。
3. **內海沒有空手**：這個戰場沒有生命那一條時，loadout 沒給武器的角色 `weapons` 是空的（現在會給一把打生命的「空手」）。核心裡用到「手上那一把」的地方都要能接受沒有武器。
4. **閃斷**（N3）：過載而且戰場是 `flash` 時，那一池歸零、給狀態 `flash`（到他下一個自己的回合結束；在自己的回合裡過載的，到這個回合結束），掛點帶 `flash`。回合開始回復各池時，帶著 `noRegen` 狀態的那幾池跳過。掛點裡的處理函式把池補回去的，補的留著。
5. **個人的脫離**（N12）：分出結果時，一方在場與後方都沒有人、而且每個人的 `out` 都是 `mode.leave.out`，結果是 `mode.leave.outcome`；待遇照 `fled`：不是戰敗，不留等著選的戰敗，`activity.end` 的 `outcome` 就是它。只要有一個人不是這樣退出的，照舊是 `lose`。
6. **修正與事件的名字**加進兩張封閉清單；`battle_status` 的 `mods` 驗證跟著認得。
7. **同步原則**：預設的表照 CORE_RULES 第 5 節（淺 −2／×0.5、標準 0／×1、深 +2／×1.5、全 +4／×2.5，全檔每回合多回 1 點行動點、過載時沉溺 +2；深要同步 3 級與敏感度 40、全要 5 級與 70）。`syncCapOf`：兩個條件都夠的最高一檔，沉溺到 `sink_bonus_at` 以上 +1 級，再加衍生數值 `sync_cap_bonus`（沒有人註冊是 0），最高到全檔。敏感度讀衍生數值 `bridge_sensitivity`（有人註冊時），沒有就讀 `actor.ext.bridge.sensitivity`（共用的資料慣例），再沒有當 50。
8. **斷路**：被 `cutSlot` 的那一格在期限內不能換位進出（`move`、`shift`、`place` 與換位的行動都擋，原因一句）、補位（`compact`、`reinforce`、`admitCalled`）跳過它；那一輪結束時自動解除。兩個戰場都能用（現實的「封鎖」之後可以改用它）。
9. **`safe`**：結算時「餘韻疊滿再過載而倒下，沉溺 +2」在 `battle.field.safe` 是 true 的場地不加；其餘照舊。
10. **testkit**：具名的情境 `BATTLE_SETUPS.net`（四個化身對四個雜兵蕾絲，數字照 ENEMIES 1.5 節的內海表與同級的主力；可以給等級）與一組最小的內海行動 `TEST_NET_COMBAT`（攻擊：2 行動點加 1 RAM；回填：1 行動點、RAM +2），讓核心的測試、冒煙與下游功能的測試不必等 M3-netcombat。dev/test-harness.md 補一段。

## 驗收條件（`engine/tests/core/battle-m3.test.ts`、`engine/tests/core/sync.test.ts`）

- 測試註冊一個回傳 4 的 `armor`：這個角色進內海防護是 0；再註冊回傳 2 的 `net_guard`，內海是 2、現實仍是 4。
- 內海裡 `run.save(u, 'body', …)` 用的是意志的調整值；現實不變。
- 內海沒有武器的角色 `weapons` 是空的，`battleOptions` 不丟錯；現實沒有武器的人照舊是空手。
- 閃斷：別人的回合被灌到過載，RAM 歸零、帶 `flash`；他的下一個回合開始時 RAM 還是 0，那個回合結束 `flash` 拿掉，再下一個回合照常回復。`overload` 掛點拿到的 `flash.before` 是歸零前的數字；處理函式把池補滿，回合開始時補的還在。自己的回合裡過載的，這個回合結束就拿掉。現實戰鬥過載照舊失去回合、沒有 `flash`。
- 內海我方四個人都以 `jacked_out` 退出：結果是 `jack_out`，沒有等著選的戰敗，`activity.end` 的 `outcome` 是 `jack_out`。三個人拔線、一個人昏過去：`lose`。現實戰鬥裡有人用同一個字退出不會變成 `jack_out`。
- 六個新的修正種類寫在 `battle_status` 的 `mods` 裡載得進來；不認得的種類照舊被擋。
- 同步：預設的表逐格等於 CORE_RULES 第 5 節；同步 2 級只到標準；3 級、敏感度 39 只到標準，`syncBlock` 的句子寫出敏感度；3 級 40 到深；5 級 70 到全；沉溺 60 的人 +1 級；`sync_cap_bonus` 是 1 再 +1、最高是全；資料的 `sync_rule/default` 蓋得掉預設，格式壞的被擋。
- 斷路：被切的那一格上的人這一輪換不了位、後面的人補不進來（那一格空著時也是），下一輪照常；現實戰鬥也成立。
- `battle.field.safe` 的場地有人昏過去：結束之後他的沉溺沒有 +2；沒有 `safe` 的照舊 +2。
- 帶著 `flash` 的內海戰鬥存檔再讀，接著打的結果和沒有中斷的一樣；`battleProblems` 不把它當壞資料。
- `BATTLE_SETUPS.net` 用 `TEST_NET_COMBAT` 打得完（`playOut`），不變式沒有違規。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有。做完才能開 M3-deck、M3-netcombat、M3-scene-sync。

## 完成時回報

改了哪些檔、測試結果、改到的既有測試（預期：內海閃斷那幾條照 N3 改）、不變式加了哪幾條、ADR 做不到的地方。
