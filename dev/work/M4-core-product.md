# M4-core-product

- 交給：cpp-architect 角色（sonnet）；派工時明說可以改下面列的核心路徑
- 目標：設計圖、零件、成品的格式搬進核心，並給三個純函式（一件成品合起來是什麼、一個零件放不放得進一個槽、成品的價錢）；物品類別加 `drug`。`features/gear` 改成從核心 import，行為不變。
- 規格出處：CRAFTING 第 1～6 節（三層、十二種零件、材質、設計圖的規則、等級與狀態、牌子與相容）、第 14 節（資料的樣子）；DATA 7.1、7.2、3.4 節；ITEMS 1.3、1.4 節（價錢）；CYBERWARE 第 1、2 節（部位、侵入度）；dev/adr/0019 第一節與 P1、P2、P11。
- 可以改的路徑：`engine/src/core/content/`（新檔 `product.ts`，並在 `kinds.ts` 的 `ITEM_CATEGORIES` 加一項）、`engine/src/core/rules/product.ts`（新）、`engine/src/core/content/index.ts`、`engine/src/core/rules/index.ts`、`engine/src/core/kernel.ts`（建 kernel 時註冊這三種內容）、`engine/src/features/gear/`（只改 import 與拿掉自己註冊的兩種內容）、`engine/tests/core/M4-core-product.test.ts`、`dev/invariants.md`、dev/adr/0019（實作補記）。
- 可以用的介面：`ContentRegistry.defineKind`、`LEGALITIES`、`isRecord`；現有的格式檢查在 `engine/src/features/gear/kinds.ts`（`blueprintProblems`、`partProblems`）與型別在 `features/gear/model.ts`（`BlueprintEntry`、`PartEntry`、`partsOf`、`blueprintOf`、`stackOf`），整段搬過來再擴充。
- 不可以做的事：不解釋 `stats` 的鍵（武器與護甲的由 `gear` 讀、義體的由 `cyberware` 讀）；不做組裝的檢定、手術、沉溺；`effects` 的內容這一張只查「是陣列」（`passiveProblems` 在 M4-core-passive 接上）；不改 `engine/data` 的內容；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 內容種類 `blueprint`（owner `core`）。`kind`：`weapon`、`armor`、`cyberware`。現有的欄位照舊。`require`、`optional` 的每一項多兩個選填的鍵：`material`（`mech`、`bio`、`any`，沒寫是 `any`）、`count`（同一種零件要幾個，沒寫是 1）。三種共通多的選填欄位：`picky`（零件類型的陣列：這幾類只認設計圖自己牌子的）、`stock`（原廠組合：零件類型 → 零件 id 或陣列）、`price_mult`（型係數，大於 0，沒寫是 1）。
- `kind: 'cyberware'` 多的欄位：`slot`（`bridge`、`brain`、`eye`、`ear_throat`、`torso`、`skin`、`arm`、`leg`、`intimate`；`arm`、`leg` 裝的時候才分左右）、`invasiveness`（`surface`、`light`、`invasive`、`heavy`、`extreme`）、`sink_cost`（0 以上的整數）、`needs_bridge?`（沒寫是 true）、`effects?`、`battle?`、`scene_parts?`（`{ adds?: string[], sensitivity?: Record<部位, 整數> }`）、`deck?`（`{ slots, firewall, ram?: { max?, regen? }, cooling? }`）、`bridge?`（`{ tuning_slots?: 整數 }`）、`lock?`（`subscription`、`contract`）、`upkeep_weekly?`、`creation_points?`、`tattoo?`（`{ kind: 'deco' | 'gang', faction? }`）。義體不寫 `size`、`weight` 也可以（當 0）。
- 內容種類 `part`（owner `core`）：現有的欄位照舊，多選填的 `affinity`（`meat`、`net`、`social`、`media` → 整數）、`drawback`（鍵 → 負的數字，算進 `stats` 的合計）、`effects`、`bridge`（`{ capacity?: 整數, split?: Record<四類, 0 以上的整數> }`）。
- 內容種類 `quirk`（owner `core`）：`name`、`desc`、`kind`（`echo` 殘響、`quirk` 怪癖、`flaw` 瑕疵、`complication` 併發症）、`applies?`（`weapon`、`armor`、`cyberware` 的陣列，沒寫是都可以）、`pool?`（從哪些池抽得到：`used`、`doujin`、`flaw`、`complication`）、`stats?`、`effects?`、`tags?`。
- 型別 `ProductData`：`{ uid: string, parts: Record<類型, 零件 id | 零件 id[]>, quality?: 'fine' | 'standard' | 'flawed', bonus?: Record<鍵, 數字>（精工多的那一項）, quirks?: string[], state?: 'new' | 'used' | 'doujin' | 'living', lock?: Record<string, unknown>, dye?: { primary_color?, secondary_color? } }`。`readProduct(raw)`：把壞掉的資料整理成合格的（不認得的鍵丟掉，回傳新的物件）。

## 要做的

1. 把兩種內容的定義、型別、`partsOf`、`blueprintOf`、`stackOf` 搬進核心並照上面擴充；`gear` 改 import，自己不再 `defineKind`。`gear` 的 `blueprintOf` 對 `kind: 'cyberware'` 的設計圖照舊回傳（它本來就只用 `weapon`、`armor` 的）。
2. `productOf(content, bpId, data)`：回傳 `{ bp, parts: Array<{ type, part }>, missing: string[]（缺的必要槽，寫零件類型的名字）, grade, legal, brands: string[], seams: number, allBio: boolean, weight, stats, affinity, quirks }`。
   - `stats`＝每個零件的 `stats` 與 `drawback`、每個 `quirk` 的 `stats`、`data.bonus` 逐鍵相加。
   - `legal`：設計圖與每個零件裡最嚴的（`free` < `register` < `permit` < `banned`）；全生體一律 `free`。
   - `allBio`：裝著的零件至少一個，而且全部是 `bio`。`seams`（機械接生體的接面）：兩種材質都有時＝比較少的那一種的件數，否則 0。
   - `data` 沒有 `parts`（或是空的）而設計圖有 `stock` 時，用 `stock`。查不到的零件 id 略過並算進 `missing`。
3. `slotProblems(content, bp, type, partId)`：回傳 `{ problems: string[], overspec: boolean }`。問題各一句：不是這個槽要的類型；材質不收；等級低於 `grade_min`；等級比設計圖高兩級以上（「比設計圖高兩級以上，塞不進去。」）；設計圖 `picky` 這一類而牌子不同（「這張設計圖只認自家的<類型>，要先破解。」）。剛好高一級：沒有問題、`overspec: true`。
4. `productPrice(content, bpId, data)`：零件的 `price` 合計 × 1.2 × `price_mult`，四捨五入到整數；`state: 'used'` 再 ×0.5；`quality: 'fine'` ×1.1、`flawed` ×0.8（暫定，寫進回報）。沒有零件的回 0。
5. `ITEM_CATEGORIES` 加 `drug`（排在 `consumable` 後面）。
6. dev/invariants.md 加兩條：成品的資料只有 `ProductData` 這一種形狀（背包與身上相同）；`productPrice` 是成品唯一的目錄價來源。

## 驗收條件（`engine/tests/core/M4-core-product.test.ts`；測試自帶一張武器、一張護甲、一張義臂（板材、致動器、神經元必要，外皮選配，神經元與外皮收 `bio`）、六七個零件、兩筆 `quirk`）

- 不裝任何功能的 kernel 載得進三種內容；`kind: 'cyberware'` 缺 `slot`、`invasiveness` 寫錯、`sink_cost` 是負的各被擋下，訊息指出欄位；`quirk` 的 `kind` 寫錯被擋。
- `productOf`：全機械的義臂 `allBio` false、`seams` 0；神經元與外皮換成生體件之後 `seams` 2；全部生體的那一張 `allBio` true、`legal` 是 `free`；裝了一個 `banned` 的零件之後 `legal` 是 `banned`。`stats` 含 `drawback` 的負值與 `quirk` 的值與 `bonus`。少一個必要的零件時 `missing` 列出它。
- `slotProblems`：類型不對、材質不對、高兩級、`picky` 的牌子不對各有一句；高一級 `overspec` 是 true、沒有問題。
- `productPrice`：三個零件 100、200、300、`price_mult` 1.5 的是 1,080；二手是 540；沒有零件是 0。
- `readProduct` 吃壞掉的資料（`parts` 是字串、`quirks` 混了數字）不丟錯。
- 現有的 `engine/tests/features/M1-gear*.test.ts`、交易與戰鬥的測試**一個字不改**全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 完成時回報

改了哪些檔、測試結果、`gear` 裡還留著哪些自己的型別、暫定的兩個品質係數、DATA 7.1 與 7.2 節裡收下但沒有檢查的欄位清單。
