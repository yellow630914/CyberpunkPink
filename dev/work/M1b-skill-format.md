# M1b-skill-format

- 交給：cpp-feature（sonnet）
- 目標：把技能的格式擴成通用的一套（條件、效果清單、被動的修正、姿態、反應、照戰場分的消耗、錢與人情的池、每件委託的次數、預備），讓剩下的技能都寫得出來；現有的鍵與十一個技能不動。這一張只做通則，每棵樹專屬的東西在後面的工單。
- 規格出處：SKILLS 1.1、1.2 節（欄位與六種種類）、1.8 節（效果的清單）、1.11 節（預備與日常）；dev/adr/0015 第一節與 E1～E4；dev/work/M1-abilities.md 第四節（現有的鍵，照舊）。SKILL_TREES 不用整本讀：驗收條件裡點名的那幾列才看。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M1b-skill-format.test.ts`（新增）。
- 可以用的介面：`run.effects`、`effectProblems`、`amount`（核心）；`k.battle.modifier`、`k.battle.on(...)`（全部的掛點，含 `attack.hit`、`out.before`、`overload`、`attack.after`、`turn.start`）；`k.battle.onEnd`；`picks`（dev/adr/0014）；變更 `actor.ext`、時間的變更（`engine/src/core/state/coreChanges.ts`）。
- 不可以做的事：不改核心；不 import 別的功能（效果一律經由 `run.effects`，不直接呼叫別的功能的函式）；不改 `engine/data/`；不拿掉舊的鍵。

## 一、`use`（消耗）

- 可以照戰場分：`use: { meat: {…}, net: {…}, opinion: {…} }`；直接寫一組就是每個戰場都一樣（E1）。這一張只讀 `meat` 那一組。
- 一組裡的鍵：`ap`、`ram`、`ram_all_min`（花掉手上全部的 RAM，至少要有這麼多；花掉的數字放進公式的 `spent`）、`cash`（公式，例 `'grade*500'`）、`favor`（`small`、`mid`、`big`）、`per_turn`、`per_fight`、`per_commission`、`first_round`、`not_first_round`、`group`（共用每回合次數的一組：同一組的技能合起來算 `per_turn`）、`slot`（幾個時段；只有預備與日常用）。
- **錢與人情是池**（E2）：`unit.ready` 時替有角色的單位建 `pools.cash`（角色的現金）與三種人情的池（讀 `actor.ext.favors`，沒有是 0）；行動的 `cost()` 把 `cash`、`favor_*` 一起回傳，核心照池檢查與扣。`onEnd` 把現金的差額寫成一筆變更，人情的差額寫回 `actor.ext.favors`。
- **每件委託**（E3）：次數記在 `actor.ext.abilities.commission[<鍵>][<技能 id>]`，鍵是 `battle.origin.ext.commission ?? battle.id`；`onEnd` 寫回。

## 二、`meat` 的新鍵

| 鍵 | 意思 |
|---|---|
| `target` | 多幾種：`ally_or_self`、`near`（自己或相鄰一格的隊友）、`downed_near`（相鄰、因生命歸零倒下的隊友）、`foe_slot`、`ally_slot`、`own_overlay`、`foe_overlay` |
| `range` | `[近, 遠]`：目標要在這個距離裡（「距離 2 以內」「近身」是 `[1, 1]`） |
| `needs` | 目標的條件，每一項一句灰掉的原因：`bridged`（有橋）、`cyber`（有義體）、`status`（帶著某個狀態）、`no_rank`（不能是哪幾個位階）、`rank`、`wounded`（重傷）、`afterglow`（疊著餘韻）、`tag` |
| `when` | 自己的條件，每一項一句：`wield`（手上武器的類型）、`mag_min`、`hull`（要或不要在機甲狀態）、`stance`、`slot`（自己站第幾格）、`node_taken` |
| `picks` | 目標以外要選的：`[{ key, label, kind, required }]`，照 0014 宣告（`kind` 是 `foe`、`ally`、`ally_slot`、`foe_slot`、`choice`） |
| `do` | 效果清單（M1b-ops 的 `op`，加上別的功能註冊的）。公式的 `tier` 是這棵樹的階數、`grade` 是場景的等級 |
| `choose` | `[{ key, label, do, when?, needs? }]`：幾種用法挑一種（宣告成一個 `choice`） |
| `mods` | 被動的修正清單，見第三節 |
| `trigger` | 反應，見第四節 |
| `tags`、`pool` | 裝著的人開打時多這些標籤（`drone_link`、`quickhack`）；某一池的上限與每回合回復的加減（`pool: { ram: { max: 3, regen: 1 } }`） |
| `alter` | 改別的技能：`[{ ability, set: {…}, as_pick?: { key, label } }]`；`set` 的鍵是那個技能 `meat` 裡的路徑（`'attack.spend'`），`as_pick` 時變成那個技能多一個可以開的選項 |

`buff` 這個效果由這個功能註冊：`{ op: 'buff', id, turns, until, mods: […], on_end: [效果…] }`——在對象身上掛一段時間的修正，結束時做 `on_end`。任何來源都能用。

## 三、被動、姿態、共鳴：`mods`

每一筆 `{ kind, value, … }`，`kind` 是核心的修正種類（`MOD_KINDS`），`value` 收公式，或 `{ by_tier: [五個數字] }`（照樹階查表）。可以加的限定：

- `tags`（問的時候要帶著這些標籤：`aimed`、`burst`、`drone`、`weapon_attack`、`item`、`subdue`……）；
- `who`：`self`（預設）、`adjacent`、`allies`、`behind`（自己後面那一格的人）——修正落在誰身上；
- `when`：和第二節的 `when` 同一組，再加 `first_round`、`in_cover`（自己那一格有遮蔽）、`other_exposed`（對手站在暴露的格子）、`other_cyber`、`other_status`；
- `per_fight`、`per_turn`：只有前幾次（次數在 `action.done` 記，和定點射同一個做法）；
- `to`：`crit_margin` 專用，「改成超過迴避幾以上就算要害」。

誰吃得到：技能的 `kind` 是 `passive` 的裝著就有；`stance` 的開著才有；共鳴的照階數。

**姿態**：`kind: 'stance'` 的技能註冊一個行動（開關各花 `use.ap`）；同時只能開一個（開另一個時前一個關掉）；`unit.stance` 記著。姿態自己可以帶 `do_on`、`do_off`。

## 四、反應：`trigger`

`{ on, who, if? }`，成立時先扣消耗（行動點用反應的人手上剩的）、記次數、記一拍，再做這個技能的 `react` 與 `do`。

| `on` | 什麼時候 | `who`（誰遇到這件事） | `react` 可以做的 |
|---|---|---|---|
| `attacked` | 擲命中之前 | `self`、`adjacent`、`ally`、`own_overlay` | `evade`、`hit`（這一擊的加減）、`redirect: 'overlay'`（改打反應的人掛在同一格或相鄰一格的一台）、`no_wound` |
| `hit` | 命中確定、還沒算傷害 | 同上 | `negate`、`no_wound`（只在這一擊本來會重創時才觸發：`if: 'wound'`） |
| `after` | 一擊結算完 | 同上 | —（接 `do`；`if`：`miss`、`hit`、`melee`、`bridged`） |
| `hp_half` | 第一次低於一半生命 | `self`、`near` | — |
| `overload` | 過載了 | `self`、`ally`、`foe_by_self`（自己讓敵人過載） | `keep_turn`（不失去下一個回合） |
| `checked` | 別人對他擲檢定之前（快駭、誘惑；看標籤） | `self`、`ally` | `dc`（這一次的 DC 加減） |
| `out_before` | 即將退出 | `self`、`ally` | `prevent`（`how` 的清單；被擋下之後做 `do`） |

反應裡的效果可以用 `who: 'attacker'`、`who: 'victim'`。帶 `reaction` 標籤的攻擊不再觸發反應（照舊）。

## 五、預備（E4）

`kind: 'prep'` 的技能多一段 `prep: { slot, scope: 'next_battle' | 'commission', meat: { mods?, do? } }`。匯出 `prepBlock`、`prep(k, state, actor, id): ReportDraft`（報告 `ability.prep`；時間加 `slot` 個時段；記在 `actor.ext.abilities.prepared`）。下一場現實戰鬥 `unit.ready` 時帶進來：`mods` 整場有效、`do` 在開打時做一次；`next_battle` 的用掉就清。

## 六、驗收條件（每一條用測試自帶的假技能；不讀 `engine/data`）

- 現有的測試全過（`M1-abilities`、`M1-picks`）。
- `use.cash: 'grade*500'`：錢不夠時灰掉、原因寫出要多少與有多少；用了之後戰鬥結束的報告裡有一筆扣現金的變更，金額對。
- `use.favor`：池是 0 時灰掉；`per_commission: 1`：同一個 `origin.ext.commission` 的第二場用不了，換一個鍵又可以。
- `group`：同一組的兩個技能一回合合計只能用一次。
- `needs`、`when`、`range` 每一種各一句原因，句子是完整的中文句子。
- `do`、`choose`、`picks`：一個假技能「打一槍，打倒的話再對另一個選好的敵人打一槍」動得起來，而且宣告的 `picks` 和 `run` 讀的對得上（放進 `M1-picks` 那一類的逐項測試）。
- `mods`：`who: 'adjacent'` 的迴避 +1 只有相鄰的隊友吃到；`when: { in_cover: true }` 只在有遮蔽時算；`per_fight: 2` 的「換武器不花行動點」第三次照原價；`to: 3` 的要害門檻生效。
- 姿態：開著才有修正；開第二個時第一個關掉；開關各扣行動點。
- 反應每一種 `on` 各一個假技能：`attacked` 的 `redirect` 改打無人機；`hit` 的 `negate` 讓那一擊沒有傷害而且只在第一回合；`after` 加 `if: 'miss'` 的反擊；`hp_half` 只觸發一次；`overload` 的 `keep_turn`；`out_before` 的 `prevent` 讓隊友停在生命 1。行動點不夠時不觸發。
- `alter` 加 `as_pick`：被改的技能多一個可以開的選項，開了才照 `set` 算。
- `buff`：三回合的命中 +1，結束時做 `on_end`（感載 +10）。
- 預備：`prep` 的報告讓時間前進一個時段；下一場開打時效果在，再下一場沒有。
- 格式檢查：不認得的鍵、`who`、`on`、公式寫錯，載入時擋下而且訊息裡有那個字。

## 依賴

M1b-core-effects、M1b-ops。做完才能開 M1b-skill-gunner-broker、M1b-skill-pilot、M1b-skill-medic、M1b-skill-social、M1b-enemy-moves。

## 完成時回報

改了哪些檔、測試結果、SKILLS 1.8 節的清單裡這套格式還寫不出來的效果。

- 2026-11-22 補：`features/abilities/battle.ts` 技能的壓制檢定要帶 `resist:suppressed` 標籤（核心工單範圍外，這張補）。
