# M1b-hack

- 交給：cpp-feature（sonnet）
- 目標：做一個新功能 `hack`：現實戰鬥裡的快駭——甲板與 RAM、快駭程式這種內容與它變成的行動、快駭的檢定、接管與控制節點、持續型的快駭、當成快駭用的腳本；並用假資料證明潛網者這棵樹的「現實」欄寫得出來。內海那一面在 M3。
- 規格出處：NETRUNNING 第 1、2 節；ITEMS 11.9 節（到「等級」那張表為止：誰能用、裝在哪、怎麼用）、5.2 節「怎麼算」裡的「腳本」那一條；DATA 7.5 節（快駭程式的欄位）；COMBAT_SYSTEM 2.4 節最後一條（控制節點）、2.5 節；ENEMIES 4.3 節「快駭」那一列、第 10 節第二段（機器只吃裝置與控制類）；SKILL_TREES「潛網者：主控」整節的「現實」欄；dev/adr/0015 E5、E9。
- 可以改的路徑：`engine/src/features/hack/`（新增）、`engine/src/features/index.ts`（`FEATURES` 加一行）、`engine/src/features/combat/`（只有一處：使用道具認 `use.tag_required`，沒有那個標籤的人這件道具灰掉並寫原因；M1b-skill-medic 已經做了就不用）、`engine/tests/features/M1b-hack.test.ts`。
- 可以用的介面：`k.content.defineKind`；`k.battle.action`（`picks`、`icon: 'hack'`、`costTags`）；`k.battle.effect`、`run.effects`；`check` 效果的 `vs: 'firewall'`；修正 `firewall`、`action_ram`、`action_ap`；掛點 `unit.ready`、`turn.start`、`check.before`；`battle.nodes`、`battle.overlays`、`battle.field`；單位的 `pools.ram`、`implants`、`tags`。
- 不可以做的事：不改核心；不 import 別的功能（誰有主控只看單位的標籤 `quickhack`，由技能的 `tags` 給；技能樹的階數讀 `unit.ext.abilities.tiers`，讀不到當 1）；不做追蹤度、敵對值、視線、攝影機與警報類的程式（E9；M2、M3）；不寫任何一支程式的資料。

## 一、甲板與 RAM

- 單位的 `ext.deck`：`{ grade, firewall, slots: [快駭程式的 id…] }`（測試直接給；敵人資料的 `deck` 由 M1b-enemy-moves 放上來；主角的等 M4 的義體）。
- `unit.ready`：沒有 `ext.deck` 的單位把 `pools.ram` 拿掉（沒有甲板就沒有 RAM）。
- 防火牆（E5）：有甲板用 `deck.firewall`，沒有的用不含遮蔽與狀態的迴避；再加修正 `firewall`。`check` 效果的 `vs: 'firewall'` 如果不是照這個算，這個功能註冊自己的 `hack.check` 來算，並在回報裡說明。

## 二、內容種類 `quickhack`

`id`、`name`、`desc`、`class`（`device`、`cyberware`、`neural`、`control`、`support`）、`grades`（有哪幾級）、`ram`、`ap`、`target`（`foe`、`ally`、`self`、`foe_overlay`、`node`）、`needs`（目標的條件：`bridged`、`cyber`、`marked`、`machine`）、`do`（效果清單）、`by_grade`（各級蓋掉的欄位與檢定的加值）。`trace`、`legal`、`price`、`script_twin` 收下不讀。

每一支裝在 `deck.slots` 裡的程式是一個行動（`group: 'skill'`、`modes: ['meat']`、標籤 `hack`、`hack:<class>`）：

- 誰有：有 `quickhack` 標籤、而且 `deck.slots` 裡有它。
- 跑幾級：主控的樹階對照（1→I、2→II、3→III、4～5→IV）與甲板的等級取低的；程式沒有那一級就用它有的最高一級；樹階不到它最低的那一級，灰掉並寫原因。
- 花費：`ram` 與 `ap`（`support` 類 0 點行動點、每回合一次、不必檢定）。
- 檢定：1d20 ＋ mod(智識) ＋ 介面 ＋ 等級的加值，對防火牆；`control` 類對精英 +2、首領 +4；沒過就沒有效果（RAM 照扣）。標籤帶著 `quickhack`、`hack:<class>`，被駭的人那一邊的反應經由 `check.before`。
- 對象：神經類對沒有橋的人灰掉；義體類要目標有義體；控制類要目標帶著標記；機器（無人機、砲塔、機器的單位）只吃裝置與控制類。每一條一句原因。
- AI：敵人有這個行動時的分數 2.4 ＋ 目標的義體數 × 0.3。

## 三、這個功能註冊的效果

| op | 做什麼 |
|---|---|
| `hack.dot` | 持續型：`{ amount, turns }`，目標每個回合開始時受感載；同一個目標同時只能掛一個，新的蓋掉舊的 |
| `hack.takeover` | 接管一台敵方的無人機或砲塔 `turns` 回合（或 `until: 'battle_end'`）：變成我方、由做的人指揮；到期還回去。`mode: 'rewrite'`：不接管，到期之前它每一輪自己打它原本那一方的人 |
| `hack.node` | 拿下一個控制節點（`taken = true`） |
| `hack.detonate` | 引爆目標快取格裡的一件爆裂物（帶 `explosive` 標籤的道具）：那一格受一擊、遮蔽降一級、那件道具沒了；目標身上沒有就灰掉 |

腳本：道具寫 `use.tag_required: 'quickhack'`，效果用同一批 `op`；不用另外的機制。

## 四、驗收條件

- 沒有甲板的人沒有 RAM 池、圓環上沒有快駭；有甲板沒有 `quickhack` 標籤的人也沒有。
- 一支假的神經類程式：RAM 與行動點扣對；檢定的明細有智識、介面、等級加值；沒過時沒有感載、RAM 照扣；對沒有橋的敵人灰掉。
- 樹階 2、甲板 III 級、程式有 I～IV：跑 II 級的數字。
- 義體類：目標的一件義體失效幾回合；目標沒有義體灰掉。控制類：沒有標記灰掉；對首領 DC +4。支援類：不花行動點、一回合第二次灰掉。
- `hack.dot`：三個回合各扣一次、第二支持續型蓋掉第一支。
- `hack.takeover`：兩回合裡那一台是我方的、可以指揮它打敵人；到期回到原本那一方。`rewrite`：它自己打原本的隊友。
- `hack.node` 之後，控制節點的行動（關燈、防爆門）用得了。`hack.detonate`：敵人快取格少一件、那一格的人受傷、遮蔽降一級。
- 帶 `tag_required` 的假腳本：沒有主控的人灰掉並寫原因。
- 修正 `action_ram` −1、`action_ap`（標籤 `hack`、每回合第一次不花行動點）吃得到（多工、根權限）。
- AI 的敵方潛網者會用快駭（固定骰面下選得到它）。
- 潛網者樹「現實」欄不是「—」的每個技能，用假資料各寫一筆並跑得起來（主控的 RAM 上限 +3、回復 +1 與檢定加值用技能的 `pool` 與 `mods`；破冰是給目標一個讓全隊快駭 +2 的 `buff`；偷看是不行的喔是 `checked` 的反應；逆流、謝謝招待用 `pool` 效果；黑冰用 `ram_all_min` 與 `spentd6`；不讓你帶走是 `out_before`）。回報裡附對照表與寫不出來的。

## 依賴

M1b-core-effects、M1b-core-overlay、M1b-ops、M1b-skill-format（要驗整棵樹）；`hack.takeover` 接管的東西做得了動作要等 M1b-skill-pilot 的 `drone.act`（還沒有的話那一條先標 `it.todo` 並回報）。這一張新增功能、幾乎不碰別人的檔，可以和改 `features/abilities` 的工單同時做。

## 完成時回報

改了哪些檔、測試結果、對照表、遇到的規格問題。
