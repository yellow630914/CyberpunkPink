# M4-gear-m4

- 交給：cpp-feature（sonnet）
- 目標：裝備在 M1 留到 M4 的幾件事：品質與瑕疵進數字、重量、曝露度與風格（看得到的那幾件、外套的兩種穿法）、染色；回答 `defeat.gear`。
- 規格出處：EQUIPMENT 第 5 節（外層蓋住內層）、第 7 節（重量）、第 9 節（染色）；LEWD_SYSTEM 第 2 節（曝露度與風格，不含那張流竄 AI 的表）；DATA 7.1 節的 `style`、`exposure`、7.7 節；CRAFTING 3.3 節「外皮決定風格與曝露度」；dev/adr/0019 第一節。曝露度的算法照 ElondiaRPG（`/home/user/yellow630914/elondiarpg` 的 `src/engine/lewd.ts`，只參考做法）。
- 可以改的路徑：`engine/src/features/gear/`、`engine/tests/features/M4-gear-m4.test.ts`。
- 可以用的介面：核心的 `productOf`（一件成品合計的 `stats`：零件、`drawback`、`quirk`、精工的 `bonus` 都在裡面）、`k.stats.defineStat`、`k.conditions.register`、`k.battle.modifier`、掛點 `defeat.gear`（`features/defeat/flow.ts` 宣告，用名字掛）、`actor.ext` 的變更、核心的 `time`、`cash` 變更。
- 不可以做的事：不做組裝與拆解（M4-craft）；不 import `features/deck`（SKIN 的風格與染色是 M4-scene-net 與它自己的事）；各區對風格與曝露度的反應是區的資料與事件的事，這一張只給數字與條件；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 設計圖（護甲與服裝）多讀：`style`（`{ tag, value }` 或字串 `from_skin`）、`exposure`（0～3 或 `from_skin`）、`long?`（長外套）。外皮零件多讀 `stats.style`、`stats.exposure` 與 `style_tag`（零件上的一個字串）。`from_skin` 就是讀那一件裝著的外皮。
- 衍生數值：`exposure`（0～3）、`style_value`（看得到的那幾件的風格值合計）、`carry_load`（身上的總重量）、`carry_cap`（負重的上限）。
- 條件：`exposure`（`{ min?, max? }`）、`style`（`{ tag, min? }`：看得到的那幾件裡這個標籤的風格值合計，沒寫 `min` 是至少 1）。
- `styleOf(k, state, actor)`：`{ tags: Array<[標籤, 值]>, main: 標籤 | null, unified: boolean（看得到的四件以上都是同一個標籤）, exposure, seen: 看得到的每一件, threat: 看得到的護甲與武器有幾件 }`。
- 規則 `gear_rule`（`overridable`）：`carry_base`、`carry_per_body`、`over_evade`、`over_move_ap`、染色的價錢與時間。
- 報告：`gear.dye`。染過的顏色放在那一件的 `ProductData.dye`；沒有實例資料的一疊（飾品）先不能染，回一句原因。

## 要做的

1. `weaponOf`、`armorOf` 改用 `productOf` 的 `stats`（數字和現在一樣，另外吃得到 `quirk`、`drawback`、`bonus`）。
2. 看得到的那幾件（EQUIPMENT 第 5 節）：頭、面、外套、沒被扣上的外套蓋住的上身與下身、手、鞋、頸與腿的飾品、主武器。外套扣上時上身、護甲不算。
3. 曝露度：照 ElondiaRPG 的算法（上身、下身、內衣、真空），加外套：扣上的外套讓上半身算 0，長外套讓全身最多 1。
4. 風格：看得到的每一件的標籤與值；`unified` 成立時 `style_value` 多 2（暫定，寫在規則表）。
5. 重量：`carry_load`＝身上穿的、帶的、快取格的重量合計；`carry_cap`＝`carry_base`（6）＋體格（暫定；義體的致動器之後用被動效果加這個衍生數值）。超過時經 `k.passives`（來源 `gear`）給迴避 −2、帶 `stealth` 標籤的檢定 −2、戰鬥的修正 `move_ap` +1。
6. 染色：`dyeBlock`／`dyeDraft(k, state, { uid, primary_color?, secondary_color?, by: 'shop' | 'self' })`。店家每個顏色 20（現金）、10 分鐘，要在設施種類帶 `dye` 欄位的地方；自己染每個顏色一份帶 `dye` 標籤的物品、10 分鐘、要在住處。顏色的值是 `dye_` 開頭的 id 或 `#RRGGBB`，其餘擋下。換回預設（兩個都給 `null`）不要錢。
7. `defeat.gear`：這個功能自己還沒有「拿走裝備」的效果，先註冊一個 `gear_take`（`{ group?, slot?, uid? }`，內建的來源才收：那一件從身上與背包拿走），並對它回答 true。

## 驗收條件（`engine/tests/features/M4-gear-m4.test.ts`；測試自帶上衣、下身、長外套、內衣、一件帶 `flaw` 的槍、三種外皮）

- 帶一筆 `quirk`（`stats: { hit: -1 }`）的槍，`weaponOf` 的命中少 1；現有的 `M1-gear` 測試不改全過。
- 外套敞開與扣上：`styleOf().seen` 少了上身；曝露度從 2 變 0；長外套扣上最多 1。
- 四件同一個風格：`unified` 是 true、`style_value` 多 2；條件 `style: { tag, min: 3 }` 成立，換掉一件之後不成立。
- 超重：迴避 −2、換位多 1 點；脫掉重甲之後回來。
- 染色：店家染兩個顏色扣 40、時間 +10 分鐘；不在有 `dye` 的設施被擋並有原因；亂寫的顏色被擋；染過的那一件存檔再讀顏色還在。
- `gear_take` 拿走穿著的那一件；`defeat.gear` 對它回答 true；AI 與玩家要的這個效果被擋。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-product、M4-core-passive。

## 完成時回報

改了哪些檔、測試結果、曝露度照 ElondiaRPG 搬了哪幾條、暫定的三個數字（負重、一致的加成、超重的懲罰）、EQUIPMENT 第 5 節的「威脅感」目前只給了件數（交涉與威嚇的加減沒有數字，列出來）。
