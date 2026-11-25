# M4-craft

- 交給：cpp-feature（sonnet）
- 目標：新功能 `craft`：會做的設計圖、組裝的預覽、組裝的檢定與四級結果、誰來做、超規；組出來的成品在交易裡買得到、賣得掉。
- 規格出處：CRAFTING 第 1、3.4、4、6 節，第 10.1、10.2 節，第 11 節第一條；TRADE 3.4 節（組裝工錢、同人社團代工）；ITEMS 1.4 節；SKILL_TREES 改造師的「工坊」（只看日常那一段）；dev/adr/0019 第四節與 P16；dev/status.md 2026-11-23「trade 留下的」「成品沒有目錄價」。
- 可以改的路徑：`engine/src/features/craft/`（新）、`engine/src/features/index.ts`、`engine/src/features/trade/`（成品的價錢與 `sellBlock`）、`engine/src/features/rest/index.ts`（條件 `at_home` 多收 `level_min`）、`engine/tests/features/M4-craft.test.ts`。
- 可以用的介面：核心的 `productOf`、`slotProblems`、`productPrice`、`readProduct`、內容種類 `blueprint`、`part`、`quirk`、`item`（類別 `blueprint` 的一件是授權書）；`makeCheck`、`checkParts`、`dcFor`、`deriveRng`；核心的 `item`（依 `uid`）、`ext`、`cred`／`cash`、`time` 變更；條件 `at_facility`、`at_home`、`ability`（`daily: 'workshop'`）；`k.effects.register`。
- 不可以做的事：不做拆解、換零件、畫設計圖（M4-craft-salvage）；不做義體的安裝（組好的義體是背包裡的一疊，裝上去是 `cyberware` 的事）；不做訂做零件、零件的合成、套裝加成、生體件的培養與等待；不 import 別的功能（`trade` 與 `rest` 的那一小段在它們自己的資料夾裡改，功能之間不互相 import）；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `state.ext.craft = { known: string[] }`：會做的設計圖的 id。
- 物品（類別 `blueprint`）多讀 `teaches`（設計圖的 id）：用掉就學會。
- 設施種類多讀 `craft?: { by: 'shop' | 'doujin' | 'factory', brand? }`（原廠只做自己牌子的全套）。
- 規則 `craft_rule`（`overridable`）：`dc`（I～V：10、13、16、19、22）、`brand_step`（1）、`seam_step`（1）、`overspec_step`（3）、`bridge_step`（3）、`minutes`（240：一個時段）、`makers`（`self`：不收錢、要檢定；`shop`：工錢＝設計圖等級 ×100、一定成功、不做超規、會登記；`doujin`：等級 ×60、一定成功、願意超規、`quirk_chance` 0.25；`factory`：等級 ×150（暫定）、一定成功而且是精工、只收全套）、`self_home_level`（2）。
- 效果 `blueprint`（`{ id }`，內建的來源才收）：學會一張設計圖。
- 報告：`craft.assemble`、`craft.learn`。匯出：`knownBlueprints`、`learnDraft`（用掉授權書）、`makers(k, state)`（這裡有誰可以做）、`assemblyPreview(k, state, { blueprint, parts, by, maker })`、`assembleBlock`／`assembleDraft`。

## 要做的

1. `parts` 是「零件類型 → 背包裡的零件」：沒有實例資料的那一疊給零件的 id，有的給 `uid`。同一種要兩個（`count`）時給陣列。背包裡的那一疊是哪個零件一律用核心的 `stackPart` 讀：帶 `uid` 的那一疊可能是內嵌的零件（未登錄零件，0019 第十七節），放進成品的是 `data.part` 那一整筆，不是 id（M4-plan 規定 10）。
2. 預覽：每個槽的問題（`slotProblems`）、缺的必要槽、難度的每一項（P16：等級的 DC、牌子數 −1、接面數、超規每件 3、橋 +3）、做的人的加值與成功率、成品的等級與合法性、價錢、重量、`stats` 的合計；義體另外給設計圖的 `sink_cost`。預覽不改狀態、不擲骰。
3. 誰來做：`self`（`by` 是主角或隊上的人；要在 `at_home`（`level_min` 是 `self_home_level`）或帶 `craft` 的設施；檢定是技術加上義體用義體學、武器與護甲用機械、全生體用醫療；條件 `ability`（`daily: 'workshop'`）成立時 +2、超規的修正減半）；店家、同人、原廠看腳下的設施。不做超規的遇到超規擋下，只收全套的遇到混牌擋下，原因各一句。
4. 結果（自己做才擲）：大成功是精工（`quality: 'fine'`，`bonus` 加在 `stats` 合計最高的那一個鍵上 +1；義體改成 `bonus: { sink: -1 }`）；成功照規格；失敗是 `flawed` 加一筆 `quirk`（`pool` 含 `flaw`、`applies` 對得上的）；大失敗燒掉一個零件（有超規的燒超規的那一個，否則照種子抽），成品沒有、其餘零件還在。同人代工照 `quirk_chance` 多一筆 `pool` 含 `doujin` 的 `quirk`、`state: 'doujin'`。
5. 寫進狀態：零件拿掉、多一疊成品（`id` 是設計圖、`data` 是 `ProductData`，`uid` 用核心現有的編號方式）、扣工錢、時間加 `minutes`。要會做那張設計圖（`known`）；店家與原廠做的不必自己會（他們有圖），同人代工要自己有圖。
6. `rest` 的條件 `at_home`：多收選填的 `level_min`（住處的等級不到就不成立）。只加這一個鍵。
7. `trade`：有實例資料的成品（`stack.data.parts`）的單價用 `productPrice`，放開 `sellBlock` 對它們的限制（賣出時依 `uid`）；店家的貨架可以放「設計圖加原廠組合」的成品（資料寫設計圖的 id，價錢用 `productPrice` 配 `stock`），買到的那一疊帶完整的 `ProductData`。類別的行情用設計圖的 `kind` 對到現有的類別。

## 驗收條件（`engine/tests/features/M4-craft.test.ts`；測試自帶一張 II 級的手槍、一張 II 級的義臂、十來個零件（兩個牌子、一個 III 級、兩個生體）、三種設施、三筆 `quirk`）

- 沒學過的設計圖自己做被擋；用掉授權書之後 `known` 有它、授權書少一張；效果 `blueprint` 也學得會，AI 給的被擋。
- 預覽：同牌全套的難度是 13；多一個牌子 14；一個超規 17；兩個接面的義臂 15。成功率和 `makeCheck` 的門檻對得上。少一個必要的零件時 `assembleDraft` 被擋並寫出缺哪一種。
- 四種成功程度（固定骰子）：精工的 `bonus` 在對的鍵上、價錢是 1.1 倍；失敗的帶一筆 `flaw`；大失敗少一個零件、沒有成品、時間照過。
- 店家：扣 200、一定成功、遇到超規被擋；同人：扣 120、超規照做、機率設成 1 時多一筆怪癖而且 `state` 是 `doujin`；原廠遇到混牌被擋。
- 內嵌的零件：背包裡放一疊 `UNREG_STACK_ID`（測試自己組一筆合格的 `InlinePart`），拿它組手槍：預覽與成品的 `stats` 算到它、那一疊沒有了、成品的 `parts` 裡是那一整筆。
- 組出來的手槍：`features/gear` 的 `weaponOf` 讀得到（測試同時裝 `gear`）；在測試的店裡賣得掉、價錢照 `productPrice` 乘店的收購係數；店裡買一件原廠的成品，背包多一疊帶 `parts` 的。
- `at_home` 帶 `level_min: 2`：一級的住處不成立、二級的成立；不帶的行為和以前一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；`M2-trade` 的測試不改全過。

## 依賴

M4-core-product。做完才能開 M4-craft-salvage、M4-ui-craft。

## 完成時回報

改了哪些檔、測試結果、原廠的工錢與同人的怪癖機率是暫定的、CRAFTING 第 6 節的套裝加成與排異目前只做了哪些。
