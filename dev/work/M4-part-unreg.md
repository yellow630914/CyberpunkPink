# M4-part-unreg

- 交給：cpp-feature（sonnet）　（**第五波**）
- 目標：新功能 `unreg`：未登錄零件。引擎定框架（哪一格、材質、等級、牌子、屬性的點數預算、怪癖）、預設清單、等著交貨的清單、交貨（驗過才給）、效果 `part_unreg`；拿到手的是一件內嵌的零件，可以裝、可以拆、可以賣。四個來源的入口是下一張（M4-part-sources），AI 起名字是 M4-core-part-ai。
- 規格出處：CRAFTING 11.1 節（「框架由引擎定」那張表、AI 關著時、怪癖的退格；四個來源的表這一張只看「等級上限」那一欄）、5.5 節（每個零件的份量、可以帶的條數、每種零件能帶什麼、帶一個代價多拿半格到一格）、第 2.1 節（十二種）、第 4 節（等級與狀態）；CORE_RULES 7.4 節（一格等於什麼）；AI_TASKS 3.20 節第 1、4、6 步；dev/adr/0019 第十七節與 P66～P68、P74、P75。
- 可以改的路徑：`engine/src/features/unreg/`（新）、`engine/src/features/index.ts`、`engine/src/features/trade/`（只有「單獨一件零件」的價錢與賣出那一小段）、`engine/tests/features/M4-part-unreg.test.ts`。
- 可以用的介面：核心的 `InlinePart`、`PartRef`、`partOf`、`stackPart`、`partStack`、`inlinePartProblems`、`UNREG_STACK_ID`、`productOf`（M4-core-product 的「內嵌的零件」那一段）；內容種類 `part`、`quirk`（`kind: 'quirk'`、`pool` 含 `doujin` 的那幾筆當怪癖的種類）；`deriveRng`（不動存檔亂數的游標）；`k.effects.register`（`ai: false`）、`k.changes.register`；核心的 `item`、`ext` 變更；`contentAllowed`（怪癖的 `tags`）；`features/trade` 在 M4-craft 放開成品那一段的做法（照它接）。
- 不可以做的事：不呼叫 AI、不 import 外殼（名字、說明、怪癖的文字由外殼驗過之後交進 `deliverDraft`）；數字只出自規則表與種子，`request`（玩家的描述）與 AI 的文字改不了任何數字；不做四個來源的入口；不寫預設清單、怪癖、選項表的內容（測試自帶）；不 import `craft`、`gear`、`cyberware`、`fixer`、`trade`（`trade` 那一小段在它自己的資料夾改，只讀核心的 `stackPart`）；V 級一律給不出來；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 規則 `unreg_rule`（`overridable`，id `default`；預設值寫在 `DEFAULT_UNREG_RULES`）：
  - `cells`（每一級的份量：`{ 1: 0.5, 2: 1, 3: 1.5, 4: 2 }`）、`lines`（最多幾條屬性：`{ 1: 1, 2: 2, 3: 2, 4: 3 }`）、`price`（表價：`{ 1: 200, 2: 600, 3: 2000, 4: 8000 }`）、`legal`（`{ 1: 'free', 2: 'free', 3: 'permit', 4: 'banned' }`）、`shape`（`{ weight: 0.2, size: 1 }`）。
  - `types`：`Record<零件類型的 id, { name: string, bio?: boolean }>`（十二種；`bio: false` 的沒有生體版：槍管、機構）。id 沿用 `features/gear` 與現有測試資料在用的寫法。
  - `options`：`Record<零件類型的 id, Option[]>`（CRAFTING 5.5 節「每種零件能帶什麼」）。`Option`＝`{ id, name, put: 'stats' | 'affinity', key, amount（一份給多少，可以是負的，例如重量）, cost（一份幾格，0.5 的倍數）, max（最多幾份）, max_at?: Record<等級, 份數>, grade_min?, material?: 'mech' | 'bio', tags?: string[] }`。預設是空的（數字由 M4-data-rules 填）。
  - `refund`（`{ plain: 0.5, costly: 1 }`：怪癖退幾格——那一筆 `quirk` 的 `stats` 裡有負的數字是 `costly`，其餘 `plain`）。
  - `sources`：`reward`、`order`、`window`、`ask`、`gift` 各一筆，這一張只讀 `grade_cap`（3、3、4、2、4）；其餘的鍵是下一張的。
  - `text`（`{ name: [1, 10], desc: [4, 60], quirk: [4, 80] }`：三段文字的字數範圍）。
- 內容種類 `unreg_preset`（預設清單；是內容）：`{ id, type, grade?, material?, name, desc, quirk_text? }`。
- `state.ext.unreg = { seq: number, pending: Pending[], names: string[], once: string[] }`。
  - `Frame`＝`{ type, material, grade, brand, attrs: Array<{ option, shares }>, stats, affinity, quirk: { id, refund }, budget, used, price, legal, weight, size }`。
  - `Pending`＝`{ id, source, frame: Frame, preset: { name, desc, quirk_text }, hold?: 'order', ready_at?: 分鐘, request?: string, from?: string, at: 分鐘 }`。
- 效果 `part_unreg`（`ai: false`，內建的來源才收）：`{ source?（預設 `gift`）, type?, material?, grade?, brand?, want?: string[], quirk?, from?, request?, hold?, ready_minutes?, once?, once_note? }`。
- 變更 `unreg.pending`（`add`、`remove`）、`unreg.once`、`unreg.name`（記下給過的名字）。報告：`unreg.deliver`。
- 匯出：`unregFeature`、`DEFAULT_UNREG_RULES`、`unregRules`、`unregRuleProblems`、`frameOf(k, state, spec)`、`frameProblems(k, frame)`、`pendingParts(state)`、`readyParts(k, state)`、`frameView(k, state, id)`、`textProblems(k, state, id, text)`、`deliverBlock(k, state, id)`、`deliverDraft(k, state, { id, text? })`。

## 要做的

1. 框架（`frameOf`；純函式，同一個 `spec` 與種子每次一樣）：
   - 等級＝`min(spec.grade ?? 上限, sources[source].grade_cap, 4)`，最少 1。類型沒給就從 `types` 照種子抽；材質沒給是 `mech`，`bio: false` 的類型給了 `bio` 擋下。牌子沒給是 `doujin`。
   - 怪癖：從 `quirk` 內容裡 `kind: 'quirk'`、`pool` 含 `doujin`、`tags` 沒被篩選關掉的抽一筆（`spec.quirk` 有給而且在這個範圍裡就用它）；退格照 `refund`。一件只有一個怪癖；一筆都抽不到時沒有怪癖、不退格。
   - 預算＝`cells[等級]` ＋退格。屬性：這個類型的選項裡 `grade_min`、`material` 對得上的當候選；`want` 指到的（指 `id` 或 `tags`）照 `want` 的順序排前面，其餘照種子洗牌；第一輪每一項放一份（預算夠、條數沒到 `lines[等級]`、份數沒到 `max`／`max_at` 才放），第二輪起從頭每一項再加一份，到一整輪都放不進為止。用不完的預算不補。
   - `stats`、`affinity` 照每一項的 `put`、`key`、`amount × shares` 相加；`price`、`legal`、`weight`、`size` 照規則表。這個類型沒有任何選項時照樣給（屬性是空的）。
2. `frameProblems`（CRAFTING 11.1 節「驗證」那一列的引擎部分）：類型在 `types`、材質對得上、等級 1～4 而且不超過那個來源的上限、每一條屬性都是這個類型的選項而且份數不超過上限、條數不超過 `lines`、`used` 不超過 `budget`、`budget` 等於份量加退格、怪癖查得到而且退格對。每條一句。
3. 預設的文字：建立 `Pending` 時就抽好——`unreg_preset` 裡類型相同、等級相同的優先，其次類型相同的，名字已經在 `names` 裡的略過；都沒有時名字是「無名的<類型名>」加流水號、說明是「一件沒有登記過的<類型名>。」。`quirk_text` 用那一筆的，沒有就用怪癖那一筆 `quirk` 的 `desc`。
4. 效果 `part_unreg`：格式檢查（類型、材質、等級、`want` 是字串的陣列、`request` 80 字以內）；AI 與玩家要來的整筆拿掉；`once` 有給而且已經在 `state.ext.unreg.once` 裡就落空並提醒一句（句子用參數的 `once_note`，沒寫是「這一件已經拿過了。」）。成立時的變更：`unreg.pending` 加一筆（`hold`、`ready_at` 照參數）、`once` 記下。`describe`：「一件未登錄零件：<類型名>，<等級>級，等著交貨。」
5. `readyParts`：沒有 `hold` 的每一筆。`deliverBlock`：查不到那一筆；`hold: 'order'` 而時間還沒到 `ready_at`（「還要等 N 天。」；人在不在委託台由下一張加）。
6. `textProblems`（AI 交來的三段文字，`{ name, desc, quirk }`）：每一段是字串、去掉頭尾空白之後字數在 `text` 的範圍裡；名字沒有空白與標點；三段都不能有阿拉伯數字（半形、全形）；名字不和內容裡任何一筆 `part` 的 `name`、`names` 裡給過的重複；多出來的欄位（例如 `stats`）算一條問題。每條一句，帶欄位的名字（外殼重試時原樣帶回去）。
7. 交貨（`deliverDraft`）：`text` 有給而 `textProblems` 不是空的就丟 `ActionBlocked`（每條一句）；沒給用 `preset`。再跑一次 `frameProblems`（不是空的也丟）。組一筆 `InlinePart`（`unreg: true`、`uid`、`name`、`desc`、框架的每一欄、`state: 'doujin'`、`cells` 是份量無條件進位、`quirk`、`quirk_text`、`from`），`inlinePartProblems` 是空的才給。變更：核心的 `item`（`partStack` 給的那一疊）、`unreg.pending` 拿掉、`unreg.name`。報告 `unreg.deliver`：`outcome` 帶整筆零件；結果的句子寫名字、類型、等級、每一條屬性與怪癖。
8. `frameView`（給外殼組 AI 的請求）：類型與材質的名字、等級、牌子（勢力資料查得到就給名字）、每一條屬性的名字與數字、怪癖種類的名字與 `desc`、`request`、同類同級的名字樣本 3～5 筆（內容的零件與預設清單，照 id 排）。不改狀態。
9. `trade`：背包裡 `stackPart` 讀得到零件的那一疊（內容的零件帶 `data.state`，或內嵌的零件）：類別當 `part`；目錄價是那個零件的 `price`，狀態不是 `new` 的 ×0.5（二手價，0019 P11、P68）；名字、等級、合法性讀那一筆；依 `uid` 賣。內嵌的零件不進任何貨架。原本「沒有實例資料的零件」的行為不變。

## 驗收條件（`engine/tests/features/M4-part-unreg.test.ts`；測試自帶：`unreg_rule` 的一張小表（外皮三個選項：風格、社交親和、防掃描；槍管三個選項；板材的護甲 `max: 2`、`max_at: { 1: 1, 2: 1 }`）、三筆 `quirk`（兩筆沒有 `stats`、一筆 `stats: { hit: -1 }`）、四筆 `unreg_preset`、一張手槍的設計圖與零件、一間收零件的店）

- `frameOf`：同一個種子兩次逐欄相同；II 級抽到沒有 `stats` 的怪癖時預算是 1.5、抽到 `hit: -1` 的是 2；`used` 不超過預算、條數不超過 `lines`；`want: ['社交']` 時社交親和排第一而且份數最多；II 級的板材護甲只有一份、III 級可以兩份；槍管給 `material: 'bio'` 被擋；`grade: 5` 與來源上限 2 而要 4 的都被夾下來。
- 性質測試（fast-check，隨機的類型、等級、`want`、種子）：`frameProblems` 永遠是空的；`stats` 的每個鍵都出自那個類型的選項。
- 效果 `part_unreg`：`pending` 多一筆、框架合格、預設的文字抽到同類同級的那一筆；AI 給的被擋；同一個 `once` 第二次落空並有提醒；沒有任何 `unreg_preset` 時名字是「無名的…」。
- `textProblems`：名字帶數字、名字和內容的零件重名、說明超長、多了 `stats` 欄位，各有一條；合格的是空的。
- `deliverDraft`：不給 `text` 時背包多一疊 `UNREG_STACK_ID`、`stackPart` 讀得到、`state` 是 `doujin`、`pending` 少一筆、`names` 多一個；給合格的 `text` 時名字是它、數字和不給的那一次逐欄相同；給不合格的丟 `ActionBlocked`、狀態沒變。`hold: 'order'` 而時間沒到的被擋。把 `pending` 裡的框架改壞（測試直接改狀態）之後交貨被擋。
- 拿到的零件：用 M4-craft 的 `assembleDraft`（測試同時裝 `craftFeature`、`gearFeature`）裝進手槍，`productOf` 的 `stats` 與 `quirks` 算到它、`legal` 是最嚴的那個；在測試的店裡賣得掉，價錢是表價的一半乘店的收購係數；店的貨架上沒有它。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；`M2-trade` 與 M4-craft 的測試不改全過。

## 依賴

M4-core-product（內嵌的零件）、M4-craft（`trade` 放開成品的那一段先在）。做完才能開 M4-part-sources、M4-core-part-ai。

## 完成時回報

改了哪些檔、測試結果、十二種零件類型實際用的 id、CRAFTING 5.5 節那張「能帶什麼」的表裡用 `Option` 寫不出來的項目（預期：傷害類型、適用距離、連射的壓制、智慧功能、可以被駭這類不是數字的）、`trade` 那一段實際改了哪幾個函式。
