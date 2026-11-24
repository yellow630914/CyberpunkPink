# M4-nightclass

- 交給：cpp-feature（sonnet）
- 目標：新功能 `nightclass`：夜課的開階、看得到哪些、學習（花體悟）、體位技能；並在 `scene` 這一邊補三樣跟著夜課走的東西：共鳴、標籤是「深」的加成、NPC 會哪些夜課。
- 規格出處：LEWD_SYSTEM 第 10 節；NIGHT_LESSONS 開頭的「寫法的約定」、共通的開階表與共鳴表、「補充規則」（技能的表只當格式的例子）；DATA 3.1、3.2 節；`ui/src/lib/skills.ts` 第 104～150 行（現在介面的規則，只當參考）；dev/adr/0019 第十節與 P31、P32。
- 可以改的路徑：`engine/src/features/nightclass/`（新）、`engine/src/features/scene/`（共鳴、深、NPC 會哪些：三處）、`engine/src/features/index.ts`、`engine/tests/features/M4-nightclass.test.ts`。
- 可以用的介面：內容種類 `night_skill`、`position`（`scene` 定義；`nightclass` 只讀格式）；`actor.ext.scene`（`skills`、`positions`：`scene` 在讀，這一張寫）、`actor.ext.sex_record`、`actor.ext.tendency`（只認格式）；量表 `insight`（`scene` 定義；花掉用量表的變更或同名的效果，做法看 `core/state/meters.ts`）；衍生數值 `bridge_<參數>`；`k.conditions.test`；`tagsAllowed`；`k.stats.defineStat`；`deriveRng`。
- 不可以做的事：`nightclass` 不 import `scene`、`lewd`、`abilities`（延伸的技能裝進橋是 M4-abilities-m4）；不寫任何技能的內容；不能用歷練點換體悟；`scene` 那三處不改既有的數字；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `night_skill` 多讀（`scene` 的格式檢查跟著收）：`branch`（`common`、`relation`、`sense`、`body`、`costume`）、`tier`（1～5）、`insight`（沒寫是階 × 10）、`requires?`（`{ bridge?: Record<'<參數>_min' | '<參數>_max', 數字>, experience?: { times?, partners?, service_times?, favorite?: true }, conditions?: Condition[] }`）、`filters?`（額外跟著的篩選標籤：`ntr`、`target_unwilling`）、`deep?`（`{ on_use?, link? }`：標籤是「深」時蓋掉 `scene` 裡對應的數字）。
- 內容種類 `night_resonance`（`scene` 定義）：`branch`、`tier`、`name`、`desc`、`scene`：`{ rules?: Record<規則的路徑, 加減>, free_switch?: 整數, first_link_fit?: 整數, end_fit?: 整數, reveal?: 'axis' | 'tag' }`。
- 規則 `night_rule`（`nightclass` 定義，`overridable`）：`common_gates`（`[[0,0],[8,5],[20,8],[40,12],[80,20]]`：每一階要的次數或人數）、`insight_per_tier`（10）、`axis_of`（分支 → 軸）。
- 衍生數值：`night_tier_common`、`night_tier_relation`、`night_tier_sense`、`night_tier_body`、`night_tier_costume`（0～5；任何角色都算得出來）。
- 條件：`night_skill`（`{ id }`：學會了）、`night_tier`（`{ branch, min }`）。效果 `night_skill`（`{ id }`，內建的來源才收：直接學會，不花體悟、不看條件）。
- 報告：`nightclass.learn`。匯出：`nightTier`、`nightList(k, state, actor)`（每個分支開到幾階、看得到的每個技能：狀態是學會了／現在能學／階還沒開／條件不夠，原因各一句、要花多少）、`learnBlock`／`learnDraft(k, state, actor, id)`。

## 要做的

1. 開階：共通看性經歷（次數或對象的人數擇一，單人的次數不算）；其餘四支＝那一條軸的等級。
2. 看得到哪些：掛的標籤（`tag`、`filters`）被內容篩選關掉的整個不列；掛在一個標籤上（不是共通、不是只掛軸）而這個人沒有那個標籤（不是「有」也不是「深」）的不列。
3. 學習：階開了、`requires` 都過（橋參數看有效值；`conditions` 用 `k.conditions.test`，沒有人註冊的種類當作不成立並寫「這個條件現在還判斷不了。」）、體悟夠。學會：扣體悟、`actor.ext.scene.skills` 多一筆；這個技能開放的體位（`position` 裡 `unlocked_by` 是它的每一筆）加進 `actor.ext.scene.positions`。名冊上的人照同一條（體悟是全隊共用的那一個量表）。
4. `scene`：共鳴。場景開始時，每個參與者每個分支開到第幾階（讀 `night_tier_*`；沒有人註冊當 0），那一支 `tier` 不超過它的每一筆 `night_resonance` 生效：`rules` 加在這個人自己用的那幾個規則數字上（例：`climax_init_self: 5`）、`free_switch`、`first_link_fit`、`end_fit`、`reveal`（開場的摘要多給對象最高的那一條軸或一個標籤）。單人的場景裡跟對象有關的四種鍵不生效。
5. `scene`：「深」。用出一個掛在標籤上的技能時，用的人那個標籤是「深」而且資料有 `deep`，用 `deep` 裡寫的數字蓋掉。
6. `scene`：NPC 會哪些（P32）。對方的 `actor.ext.scene` 沒有寫 `skills` 時，場景開始當下推：每個分支、他開到的每一階，各抽一個他看得到（照第 2 點）的技能；體位是基本的加上這些技能開放的。種子是他的 id（同一個人每次一樣）。寫了的（固定 NPC）照寫的。
7. 效果 `night_skill`：給事件與任務（直接教一招）。

## 驗收條件（`engine/tests/features/M4-nightclass.test.ts`；測試自帶八個技能（共通 1、2 階各一、一個體位技能、掛「支配」的 3 階一個帶 `deep`、帶 `requires` 三種的各一、一個帶 `filters: ['ntr']`）、兩筆共鳴、兩個體位）

- 性經歷 0 次：共通 1 階；8 次或 5 人：2 階；單人的次數不算。關係那一軸 3 級：關係 3 階。五個衍生數值對一個生成的 NPC 也算得出來。
- `nightList`：沒有「支配」標籤的人看不到那一招；有的人看得到；`ntr` 關掉時那一招不列。
- 學習：體悟 10 學 1 階的扣 10；體悟不夠、階沒開、耐受不到、對象人數不到、條件不成立，各被擋並有原因；學了體位技能之後 `ext.scene.positions` 多了它開放的體位，場景裡換得出來（和 `sceneFeature` 一起裝）。學過的再學被擋。
- 共鳴：共通開到 2 階的人，這一場第一次切換體位不花行動點、第二次照花；另一筆把 `climax_init_self` 改成 −10 的生效在他身上、不在對方身上。
- 「深」：同一招，標籤是「有」時契合 +4、是「深」時照 `deep` 寫的 +7。
- NPC：沒寫 `skills` 的對象在場景裡會用推出來的技能（`sceneView` 看得到他會哪些）；同一個人開兩場推出來的一樣；寫死的照寫的。
- 效果 `night_skill` 直接學會而且不扣體悟；AI 給的被擋。
- 只裝 `scene` 不裝 `nightclass`：現有的場景測試不改全過。`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-scene-seats（技能的 `needs` 與第二版的狀態）。這一張進行中 `features/scene` 不要有別的工單。

## 完成時回報

改了哪些檔、測試結果、NIGHT_LESSONS 二十五個共鳴裡 `night_resonance` 的五種鍵寫不出來的（只看共通那五個以外能不能照表格的「效果」欄推；其餘分支的表請列出寫不出來的句型）、學習條件裡寫不成條件的（例：「性經歷裡有身體和外表的性別不同的對象」）。
