# M1b-skill-pilot

- 交給：cpp-feature（sonnet）
- 目標：機師這棵樹在現實、不用機甲的那一部分：無人機的效果（讓技能叫無人機做事）、護盾型擋槍、偵察型的不受黑暗、共鳴與被動改無人機的數字，並用假資料證明這棵樹寫得出來。機甲留到 M6。
- 規格出處：SKILL_TREES「機師：編隊」整節的「現實」欄與共鳴表；COMBAT_SYSTEM 9.1 節（無人機）、2.5 節（黑暗、煙霧）；dev/adr/0015 第三節、E6、E12；dev/work/M1-summons.md（現有的無人機，照舊）。
- 可以改的路徑：`engine/src/features/summons/`、`engine/src/features/abilities/`（只加這棵樹要的觸發對象，見下）、`engine/tests/features/M1b-skill-pilot.test.ts`。
- 可以用的介面：`k.battle.effect`、`run.addOverlay`、`run.overlayAttack`、修正 `overlay_hp`、`overlay_armor`、`overlay_evade`、`overlay_cap`、`overlay_backlash`、`see_dark`；`attack.before` 的 `redirect`；M1b-skill-format 的格式（`do`、`mods`、反應、姿態、`buff`、預備）。
- 不可以做的事：不改核心；`summons` 與 `abilities` 不互相 import（技能只經由效果的登錄表叫無人機做事）；不做機甲與「把自律的無人機搶過來」；現有無人機的數字與句子不變。

## 一、`features/summons` 註冊的效果

| op | 欄位 | 做什麼 |
|---|---|---|
| `drone.act` | `which`（`target`：選的那一台；`same_slot`：和做的人同一格的；`all`；`others`：除了被打的那一台）、`max`、`at`（打誰：`target` 或 `pick:<鍵>`）、`hit`、`pierce`、`mark_used`（預設 `true`）、`ignore_used` | 讓這幾台各做一次它的動作，不另外花指揮的行動點。攻擊型以外的種類照它自己的動作 |
| `drone.deploy` | `drone`（`pick` 的鍵，或 `kind` 指定種類的臨時機）、`turns`（幾回合後自己收回）、`over_cap`、`no_backlash` | 放出一台 |
| `drone.move` | `to`（`pick` 的鍵）、`any`（不必相鄰） | 移動選的那一台 |
| `drone.repair` | `amount` | 回復耐久（不超過上限；被擊落的不行） |
| `drone.smoke` | `rounds` | 那一台掛的那一格變成打不破的半掩體 |
| `drone.ram` | `dice`、`type` | 那一台撞上目標：它被擊落（回灌照算），目標受一擊並被往後推一格 |
| `drone.guard` | `until` | 那一台替同一格的人擋下一次攻擊（下一次以那個人為目標的攻擊改打它） |

- 護盾型的「指揮」從現在的「不用指揮」改成 `drone.guard`（到操作者的下一回合開始）。
- 偵察型：和它同一格的同一方的人有 `see_dark`（修正）。
- 放出的上限加 `overlay_cap` 的修正：問的時候標籤是 `[種類]`，支援型（護盾、偵察、醫療）多一個 `support`（多工連結只給支援型）。被擊落的回灌 5 點加 `overlay_backlash`。
- 「誰有無人機」照舊只看 `ext.summons.drones`；「只有裝著編隊的人連得住」由之後把無人機填進去的那一邊決定，這一張不擋。

## 二、`features/abilities` 要補的

- 目標 `own_overlay` 的技能把選的那一台交給效果（`ctx.target` 是 `{ overlay }`）。
- 反應的 `who` 多一種 `with_own_overlay`：被打的隊友那一格（`redirect` 可以放寬到相鄰一格：`reach: 1`）掛著反應的人的一台。
- 反應的 `who: 'own_overlay'`：自己的一台被打之後（敢打我家孩子？）。

## 三、驗收條件（假技能用設計書的名字與數字）

- 共鳴 1、2、5 與「編隊」的階數加值：`mods` 寫 `overlay_hp` +5、`overlay_armor` +1、`overlay_evade` +1、指揮的命中（標籤 `drone`）＋半個樹階（無條件進位）；放出來的那一台數字對。
- 乖孩子去吧（`drone.deploy` 加 `drone.act`）：兩件事一共 1 點、那一次命中 +1、每場一次。
- 掩護飛行：隊友那一格掛著你的一台時，打他的那一擊命中 −2；沒有掛著時不觸發、不扣行動點。
- 多工連結：同步 0 的人第二台只放得出支援型；攻擊型被擋，原因是一句完整的話。
- 再一次嘛：同一台一回合動兩次、第二次命中 +1；飽和攻擊：最多三台各打一次、這幾台之後不能再指揮。
- 雙聯火控：自己射擊一次、同格的那一台跟著打同一個目標。
- 護航編隊（姿態）：最多兩格受惠；修修就好回 10 點；煙煙罩著你持續兩回合；去陪陪他可以不相鄰。
- 撞過去！沒有機甲的那一半：那一台沒了、操作者感載照加、目標受傷並被推一格。
- 攔截與穹頂：那一擊改打無人機（照它的迴避與護甲）；回灌緩衝讓被擊落只 +2。
- 護盾型被指揮之後替同一格的人擋一次；偵察型同一格的人在黑暗裡打人沒有被扣。
- 蜂群：多放兩台臨時的攻擊型、不算進上限、三回合後自己消失、被擊落不加感載。
- 整備（預備）：下一場每一台耐久 +6、護甲 +1。
- 要機甲的（同步衝刺、神經硬化、遠端火力、共鳴駕駛、女武神、人機一體、共鳴 3，以及雙聯火控、撞過去！、突擊姿態、堡壘姿態的機甲那一半）：`when: { hull: true }` 的行動列得出來但灰掉，原因「要在機甲狀態下才能用。」；整個都要機甲的在回報裡列成 `pending`（E12）。

## 依賴

M1b-core-overlay、M1b-ops、M1b-skill-format。和 M1b-enemy-units 都改 `features/summons`，不要同時做（這一張先）。

## 完成時回報

改了哪些檔、測試結果、這棵樹二十七個技能各用了哪些鍵的對照表、遇到的規格問題。
