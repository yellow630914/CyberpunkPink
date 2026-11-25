# M4-creation-body

- 交給：cpp-feature（sonnet）
- 目標：建角第 6、8、9 步的規則搬進引擎：掛點 `creation.step`（每個功能檢查草稿裡屬於自己的那一部分）、義體點數與裝備點數從選的東西算、沒有橋的建角、白給的東西；`cyberware`、`abilities`、`gear`、`deck` 各回答一段。
- 規格出處：CHARACTER 第 1 節（第 6、8、9 步）、2.1 節、5.4 節、5.6 節；CYBERWARE 7.5 節「建角」那一欄；LEWD_SYSTEM 第 1 節最後一條（沒有橋）；SKILLS 1.3 節；`ui/src/lib/creation.ts`（第 84～153 行：現在的規則，搬完由 M4-ui-creation 刪）與 `ui/src/lib/skills.ts`；dev/adr/0019 第十一節與 P52～P55。
- 可以改的路徑：`engine/src/features/creation/`、`engine/src/features/cyberware/`（一個檔 `creation.ts`）、`engine/src/features/abilities/`（同）、`engine/src/features/gear/`（同）、`engine/src/features/deck/`（同）、`engine/tests/features/M4-creation-body.test.ts`。這一張進行中，上面四個功能的資料夾不要有別的工單。
- 可以用的介面：`features/creation/index.ts` 現有的 `CreationDraft`、`creationLimits`、每一步的 `…Block`、`commit`（報告 `creation.commit`）；掛點的宣告方式（`declare module '../../core'`，看 `features/security/scan.ts`）；核心的 `productOf`、`productPrice`、設計圖的 `stock`、`creation_points`；`state.rules.startXp`、`startCyberPoints`；各功能自己的東西：`cyberware` 的 `pieceSink` 與槽數、`abilities` 的 `learnBlock` 那一套（對一份暫時的 `AbilityState` 逐一檢查）與 `applyLoadout`、`gear` 的穿戴、`deck` 的槽。
- 不可以做的事：`creation` 不 import 別的功能，別的功能也不 import `creation`（掛點用名字）；不做生命軌跡（M4-creation-lifepath）；不做快速開始的預設角色與建議組合（內容）；不改第 1～4、7 步；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 掛點 `creation.step`（`creation` 宣告）：`[{ state, draft, step: 'cyber' | 'abilities' | 'gear', picks: unknown[] }, StepAnswer | void]`。`StepAnswer`＝`{ took: number[]（它認得的是 picks 裡第幾個）, blocks?: string[], points?: number, changes?: Change[], notes?: string[] }`。好幾個功能回答時合起來；沒有任何人認得的那一個 pick 是一條擋住的原因（「沒有功能認得這一件：<id>。」）。
- `CreationDraft` 多：`bridge?: 設計圖的 id | null`（`null` 是選了「沒有橋」；沒寫是還沒選）、`cyber?: Array<{ blueprint, side? }>`、`abilities?: string[]`（照學的順序）、`gear?: Array<{ id, qty? }>`（物品、設計圖、甲板、構裝、SKIN 的 id）。舊的 `cyberSpent`、`gearSpent` 留著：沒給選的東西時照舊用它們（現有的測試不改）。
- 設計圖與物品多讀 `available?: { origins?: string[], faction?: string }`（哪些出身買得到；`faction` 對企業出身選的那一家）。出身的資料多讀 `kit_free?: Array<{ id, qty? }>`。
- 規則 `creation_rule` 多：`cyber_point_price`（500）、`cyber_install_mult`（1.5：成品價加安裝費）、`gear_point_price`（250）、`gear_grade_max`（2）、`gear_kinds`（可以用裝備點數買的類別）。
- 使用者 2026-11-25：`engine/data/rules/creation.json` 的 `gear_point_cash` 由 150 改成 250（CHARACTER 5.4 節已改），連帶 `ui/src/lib/creation.ts` 的註解與相關測試。
- `creationSummary` 多回傳 `owned`：主角建好時身上已經有的東西（出身的 `kit_free`、日常服裝、這一份草稿已選的義體與裝備），每一件寫 id、名字、類別、部位或穿戴的位置，畫面在第 6 步與第 9 步顯示，避免重複挑。
- 匯出：`cyberStepBlock`、`abilitiesStepBlock`、`gearStepBlock`（各回 `CreationBlock | null`）、`creationSummary(k, state, draft)`（三種點數各花了多少、剩多少、換多少現金、沉溺的起點、四類容量、每一步的提醒）。

## 要做的

1. `creation`：三個新的步驟各問一次掛點，把 `blocks` 變成那一步擋住的原因、`points` 加總後和上限比（義體 `startCyberPoints`、裝備 `gear_points`、技能的歷練點由 `abilities` 自己比）；沒花完的義體與裝備點數照現有的規則換現金；`commit` 把每個回答的 `changes` 接在放進主角的那一筆後面。
2. `cyberware` 回答 `cyber`（`picks` 是 `draft.bridge` 與 `draft.cyber` 合起來）：
   - 一定要選橋或明寫沒有橋（P53）；橋最多一座；`available` 不合的擋下（「企業出身、而且是<那一家>才選得到。」）；每個部位不超過槽數；沒有橋時不能選 `needs_bridge` 的。
   - 一件的點數：`creation_points`，沒寫照（`productPrice` 配 `stock`）× `cyber_install_mult` ÷ `cyber_point_price` 進位、最少 1（P52）。
   - `changes`：`actor.ext.cyber`（每一件用 `stock` 的零件、不休養、沉溺成本照設計圖與零件算、不打折）；主角的沉溺設到下限；沒有橋時 `actor.ext.bridge` 寫成 `null`。
3. `abilities` 回答 `abilities`：照順序對一份從 0 開始的技能狀態逐一跑 `learnBlock` 的規則（階、前置、歷練點 `startXp`）；選了沒有橋時一個都不能學（「沒有橋就裝不了技能。」）；`changes` 是 `actor.ext.abilities`（學會的、每棵樹的累計、剩下的歷練點）。另外聽 `report.after`：`creation.commit` 之後接一份 `ability.loadout`，照學的順序裝到容量滿為止（P54）。
4. `gear` 回答 `gear` 裡它認得的（物品與武器、護甲的設計圖）：等級不超過 `gear_grade_max`、類別在 `gear_kinds`（藥、成人道具（物品帶 `adult: true`）、義體不行）、`available`；一件的點數＝價錢 ÷ `gear_point_price` 進位、最少 1（設計圖用 `productPrice` 配 `stock`）；`changes` 是把東西放進背包（設計圖的成品帶完整的 `ProductData`）。出身的 `kit_free` 也由它給（不花點數；認不得的 id 留給別人）。
5. `deck` 回答 `gear` 裡的構裝、SKIN、快駭程式（放進背包）；`cyberware` 回答 `gear` 裡的甲板（成品甲板或帶 `deck` 欄位的設計圖：點數照裝備的算法，直接裝進腦部、沉溺的下限照加；沒有橋時擋下）。
6. `creationLimits` 多回傳新規則的數字；`creationSummary` 給畫面。

## 驗收條件（`engine/tests/features/M4-creation-body.test.ts`；測試自帶兩座橋（一座 `creation_points: 3`、一座沒寫、成品價 1,200）、一隻義眼、一條義臂、三個技能（一個有前置）、一把槍、一件防彈衣、一副甲板、兩個構裝）

- 只裝 `creation` 的 kernel：`draft.cyber` 有東西時每一件都是「沒有功能認得這一件」；沒給選的東西、只給 `cyberSpent` 的舊草稿行為不變（`M0-creation` 的測試不改全過）。
- 全部功能都裝：選一座 3 點的橋加一隻義眼，`creationSummary` 的義體點數是 3 加義眼算出來的；超過 10 點被擋並寫出超過幾點；沒選橋被擋；選兩座橋被擋；企業限定的橋在蜂巢出身被擋。沒寫點數、成品價 1,200 的那一座是 4 點。
- 沒有橋：`bridge: null` 過得了；這時選義眼（要橋）被擋、選 `needs_bridge: false` 的義臂可以、學技能被擋；提交之後主角的 `ext.bridge` 是 `null`、四類容量是 0。
- 提交之後：主角身上有選的義體、沉溺等於下限、沒有 `recovering`；歷練點是 200 減花掉的；緊接著有一份 `ability.loadout` 把學的裝上（容量不夠的最後一個沒裝）；背包有槍（帶零件）、防彈衣、構裝；甲板在腦部；沒花完的義體點數每點換 500、裝備點數每點換 250（使用者 2026-11-25）。
- III 級的槍、藥、帶 `adult` 的物品用裝備點數買被擋，原因各一句。出身的 `kit_free` 進了背包、不算點數。
- 技能的前置沒學先學後面的被擋；歷練點超過被擋。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-gear-m4、M4-cyber-deck、M4-abilities-m4。做完才能開 M4-creation-lifepath、M4-ui-creation。

## 完成時回報

改了哪些檔、測試結果、`ui/src/lib/creation.ts` 裡還沒有對應引擎函式的（預期只剩外觀的 `derivedLooks`）、橋參數的初值這一張沒有另外的規則（照 `lewd` 的預設，生命軌跡會微調）。

- 總指揮補記（2026-11-25，M4-cyber-bridge 回報）：`cyberware/bridge.ts` 有一段過渡——身上沒有橋那一件、但 `ext.bridge.capacity` 是物件的人照舊讀那四個數字（`bridgeCapacityOf().legacy`）。這一張讓建角給橋那一件之後，把過渡拿掉，ui 的完整遊戲主角改成身上裝著一座橋。
