# M4-abilities-m4

- 交給：cpp-feature（sonnet）
- 目標：技能在 M4 的部分：條件 `ability`、日常技能（手術、解剖、工坊、解鎖匠）的格式、技能給衍生數值的鍵（手術刀的沉溺減免）、夜課延伸的技能裝進橋、橋的機能要的三個數字、花歷練點升基本功（0～4 級）與洗點。
- 規格出處：SKILLS 1.2、1.3、1.11 節（日常）；SKILL_TREES 改造師「預備與日常」那一段；CORE_RULES 6.4 節、7.2 節；LEWD_SYSTEM 10.1、10.4 節；DATA 3.1 節的 `outside`；CYBERWARE 7.1 節（奉公、深水、蜜腺原型的機能）；dev/adr/0019 第三、十節；dev/adr/0015 E13。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M4-abilities-m4.test.ts`、`engine/tests/fixtures/skills/`（把改造師樹測試資料裡留著 `pending` 的日常與戰地手術改成新鍵）。
- 可以用的介面：`features/abilities` 現有的格式（`format.ts`）、`learn.ts`、`loadout.ts`、`capacityFor`；衍生數值 `surgery_sink_pct`（`cyberware` 定義，這裡加 provider）；內容種類 `night_skill`（`scene` 定義，只讀格式）與 `actor.ext.scene.skills`（誰學會了哪些夜課）；核心的 `actor.skill` 變更（基本功等級加減）；條件 `at_facility`、`at_home`；戰鬥的效果 op `implant_install`（`cyberware`）、`wound_treat`（`medical`）：資料裡直接寫，查不到的照現有的規則在載入時擋下。
- 不可以做的事：不 import `scene`、`cyberware`、`medical`、`craft`；日常技能「做什麼」不在這裡（手術在 `cyberware` 與 `medical`、解剖在 `enemies`、工坊在 `craft`），這一張只讓別人問得到「這個人有沒有」；5、6 級的請教與上課是 M4-training；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 技能資料多的鍵：`daily?: string`（這個技能帶哪一種日常：`surgery`、`dissect`、`workshop`、`unlock`……字串不限）；`stats?: Array<{ stat, amount?, per_tier?, min?, max? }>`（裝著時給那個衍生數值加減；`per_tier` 乘這棵樹的階）。
- 條件 `ability`：`{ id?, daily?, who?, equipped? }`。`id`：學會了那個技能（`equipped: true` 時要裝著）；`daily`：裝著一個帶這種日常的技能。看誰：`who ?? ctx.actor ?? 主角`。
- 衍生數值（`abilities` 定義、別人加）：`cap_discount_<類>`（那一類的被動技能少佔幾點，最少佔 1）、`cap_flex`（四類之間可以挪用幾點）、`ram_discount_<類>`（那一類的主動技能少花幾點 RAM，最少 1）。
- 夜課延伸的技能：`night_skill` 有 `outside` 的那幾筆，在這個功能裡的 id 是 `night:<夜課的 id>`；類別固定是 `social`、佔 `outside.cap`、效果照 `outside`（和八棵樹同一種寫法，強度不另外縮：`domain_scale` 只收下）。
- 報告：`ability.skill_up`、`ability.respec`。匯出：`skillUpBlock`／`skillUpDraft(k, state, actor, skill)`、`respecQuote`、`respecBlock`／`respecDraft(k, state, actor, { path? })`。
- 規則 `ability_rule` 多：`skill_xp_per_level`（10）、`skill_free_max`（4）、`respec_price_per_xp`（10）、`respec_minutes`（1440）。

## 要做的

1. 條件 `ability` 與 `daily` 鍵。格式檢查：`daily` 的技能可以沒有任何戰鬥的欄位。裝著帶 `daily: 'dissect'` 的技能的人進戰鬥時照舊有標籤 `dissect`（M3 已經靠 `net.tags` 給內海的；現實的戰場補上）。
2. `stats` 鍵：裝著時經 `k.stats.addStatProvider` 生效。改造師測試資料的「手術刀」寫成 `{ stat: 'surgery_sink_pct', per_tier: -5, min: -25 }`。
3. 夜課延伸：`learnedOutside(state, actor)` 列出這個人學會而且有 `outside` 的夜課；它們可以用現有的裝卸入口裝進橋（容量夠才行、被內容篩選關掉標籤的不列）；裝著才生效。`night_skill` 這個內容種類沒有人定義時整段不作用。
4. 橋的三個數字：算容量時，那一類每個被動技能佔 `max(1, cap − cap_discount_<類>)`；四類合計超出的部分在 `cap_flex` 以內算裝得下（`capacityOf` 多回傳 `flex: { used, max }`）；主動技能的 RAM 花費照 `ram_discount_<類>` 減（最少 1；掛在現有算花費的那一處）。
5. 升基本功（CORE_RULES 7.2 節）：升到 N 級花 N × 10 歷練點；直接升只到 `skill_free_max`（4）級，再上去回一句「5 級與 6 級要有人教。」（M4-training 接）；最高 6。名冊上的人照同一條。
6. 洗點：要在調校診所（`ability_rule.loadout_facility_types` 的設施）；洗掉一棵樹（或全部）學會的技能：退回那些歷練點、樹的累計跟著扣、裝著的卸下、付每點 10、時間過一天。基本功不能退。夜課不在這裡洗。
7. 改造師的測試資料：「戰地手術」的現實欄加上二選一的另一半（`implant_install`）；日常的四個標上 `daily`。只動機制欄位。

## 驗收條件（`engine/tests/features/M4-abilities-m4.test.ts`）

- 條件 `ability`：學會但沒裝的 `{ id }` 成立、`{ id, equipped: true }` 不成立；`{ daily: 'surgery' }` 只在裝著的時候成立；`who` 指到名冊上的人看的是他。
- 裝著手術刀（樹開到 3 階）：`surgery_sink_pct` 是 −15；6 階也只到 −25（測試自己定義這個衍生數值）。
- 夜課延伸：測試自己定義 `night_skill` 與兩筆資料（一筆有 `outside`）；主角 `ext.scene.skills` 有它時可以裝、佔社交 2 點、它的被動修正生效；卸下之後沒有；標籤被篩選關掉時不列。沒有人定義 `night_skill` 的 kernel 現有的測試不改全過。
- `cap_discount_meat` 是 1：一個佔 3 的現實被動只佔 2、佔 1 的還是 1。`cap_flex` 是 3：現實超出 2、其餘沒超，算裝得下；超出 4 被擋。`ram_discount_net` 是 1：2 RAM 的技能花 1、1 RAM 的還是 1。
- 升基本功：0 升 1 花 10、3 升 4 花 40；歷練點不夠被擋；4 升 5 被擋並是那一句。
- 洗點：洗掉一棵花了 120 點的樹，歷練點 +120、扣 1,200、時間 +1 天、那棵樹的階回到 1、裝著的卸下；不在調校診所被擋。
- 改造師樹的測試資料載得進來（和 `cyberwareFeature`、`medicalFeature` 一起裝時 `implant_install`、`wound_treat` 查得到）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-bridge（`learn.ts` 讀容量的那一段先改好）、M4-cyber-battle、M4-medical（兩個 op）、M4-craft（工坊的條件有人問）。

## 完成時回報

改了哪些檔、測試結果、M4-cyber-bridge 回報的橋機能裡這一張還是寫不出來的（預期：回灌 −10%、重傷時技能不失效、面具切換不花行動、被注視時消退加快）、SKILLS 1.8 節還寫不出來的清單有沒有少幾條。

## 總指揮補記（2026-11-25，M4-cyber-bridge 回報）
- 換橋後容量變小時，現在由 cyberware 粗略提醒一次（不讀 ext.abilities）。這一張在 abilities 加掛點（例如 `ability.capacity_changed`），裝著的技能超過新容量時由 abilities 自己提醒一句，cyberware 那句拿掉。
- 橋的機能要 abilities 加鍵：現實型被動技能容量 −1（最低 1）；內海型主動技能 RAM 消耗 −1（最低 1）；四類之間挪用 3 點容量；重傷時技能不失效；人格面具切換不花行動；馴化的負面效果減半；回灌 −10%；同步檔位的特定來源加成（例：駕機甲 +1）。做得到的做，做不到的回報。

- 總指揮補記（2026-11-25）：戰鬥中治重創的技能一律寫 `medical` 的 `wound_treat`（見 M4-followups「M4-medical 回報」）。
