# M4-cyber-deck

- 交給：cpp-feature（sonnet）
- 目標：甲板改成腦部的義體。`deck` 的來源換成掛點 `deck.source`，`cyberware` 回答；M3 的成品甲板與舊存檔照樣能用。
- 規格出處：CYBERWARE 第 1 節（腦：甲板）、第 2 節（侵入：甲板）；CRAFTING 3.1 節甲板那一列；CYBERSPACE 4.2 節最後一條；dev/adr/0018 第三節；dev/adr/0019 第三節「甲板是腦部的義體」與 P50、P51；dev/status.md「M3-deck 回報」。
- 可以改的路徑：`engine/src/features/deck/`（`state.ts` 的 `rawDeck`、`ops.ts` 的 `equipBlock`／`equipDraft`／`deckStack`、`kinds.ts` 的 `deck` 格式多一欄、`index.ts`）、`engine/src/features/cyberware/`（回答掛點、收 `deck` 這種成品、讀檔搬家）、`engine/tests/features/M4-cyber-deck.test.ts`。
- 可以用的介面：`k.hooks.run`／`k.hooks.on`／`k.hooks.owners`（`core/state/hooks.ts`；掛點的型別用 `declare module '../../core'` 補，寫法看 `features/security/scan.ts`）；M4-cyberware 的 `installDraft`、`pieceSink`、`cyberOf`；`save.loaded` 掛點；`deckOf`、`DeckEntry`。
- 不可以做的事：兩個功能不互相 import（`cyberware` 只認內容種類 `deck` 的格式）；租來的甲板（效果 `deck_rental`）照舊蓋過一切、不經手術；不改構裝、腳本、SKIN 的任何規則；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 掛點 `deck.source`（`deck` 宣告）：`[{ state, actor }, DeckSource | void]`，`DeckSource`＝`{ uid, name, grade, slots, firewall, ram?: { max?, regen? }, cooling?, ready: boolean }`。好幾個人回答時用第一個。
- `RawDeck.source` 多一個值 `implant`。
- 內容種類 `deck` 多選填的 `sink_cost`（沒寫照 `cyber_rule.deck_sink_default`，6）、`invasiveness`（沒寫是 `invasive`）。
- `CyberPiece` 的 `bp` 可以是內容種類 `deck` 的 id：這時 `kind_of: 'deck'`（沒有零件、數字照那一筆）；一般的（設計圖帶 `deck` 欄位）是 `kind_of: 'blueprint'`。

## 要做的

1. `rawDeck` 的順序：租來的 → `deck.source` 的回答（`source: 'implant'`）→ 背包裡 `ext.deck.uid` 那一副（**只在 `k.hooks.owners('deck.source')` 是空的時候**）。`ready` 是 false（休養中）的回答當成沒有甲板。
2. 有人掛 `deck.source` 時：`equipBlock` 一律回「甲板是腦部的義體，要動手術才裝得上。」；`deckView` 不再列「背包裡可以裝上的甲板」。沒有人掛時 M3 的行為完全不變（`M3-deck` 的測試不改全過）。
3. `cyberware` 回答：腦部槽裡第一件「設計圖有 `deck` 欄位」或「`kind_of: 'deck'`」而且沒有 `off` 的。數字：設計圖的 `deck` 加上零件 `stats` 裡 `slots`、`firewall`、`ram_max`、`ram_regen`、`cooling` 的合計；等級是設計圖的等級。成品甲板直接照那一筆。
4. `cyberware` 的 `installDraft` 收內容種類 `deck` 的那一疊：部位固定是 `brain`，成本照 `sink_cost` 或預設，手術費用成品的 `price`（那一筆自己寫的）當成品價。腦裡已經有一副甲板時擋下（「腦裡已經有一副甲板，要先拆掉。」）。
5. 舊存檔（`save.loaded`，`cyberware` 掛）：主角與名冊上每個人，`ext.deck.uid` 指到背包裡一副 `deck` 成品而腦裡沒有甲板時，把那一疊搬進腦部的槽：不收費、不休養、`sink` 照算、沉溺不到新下限的補上；`ext.deck.uid` 清掉（其餘的鍵不動）。腦部沒有空槽的不搬、留在背包。這一步只在有人掛 `deck.source` 時做。
6. 拆掉甲板（`cyberware` 的 `removeDraft`）：進行中的活動有 `face.net`、`netrun`、`dive` 時擋下；拆掉之後槽裡的構裝還記在 `ext.deck.slots`（`deckOf` 會讀成沒有甲板、全部不生效），再裝一副就回來。
7. `deck` 的衍生數值（`deck_grade`、`deck_slots`、`deck_firewall`、`deck_cooling`、`ram_max` 與 `ram_regen` 的 provider）不用改：它們都經過 `rawDeck`。確認一次並寫進測試。

## 驗收條件（`engine/tests/features/M4-cyber-deck.test.ts`；測試自帶一副 M3 格式的成品甲板、一張帶 `deck` 欄位的腦部設計圖與兩顆晶片）

- 只裝 `deck`：行為和 M3 一樣（抽 `M3-deck` 的三條驗一次）。
- 兩個都裝：背包裡的成品甲板 `equipDraft` 被擋並是那一句；經診所裝進腦部之後 `deckOf` 的等級、槽數、防火牆等於資料，`sink_floor` 多 6；休養中 `deckOf().has` 是 false，好了之後是 true。
- 設計圖組的那一件：槽數是設計圖的加晶片 `stats.slots` 的合計。
- 租來的甲板蓋過腦裡的；收回之後回到腦裡的。
- 舊存檔：一份「背包裡裝著一副甲板、四個構裝在槽上」的狀態跑 `save.loaded` 之後，甲板在腦部、構裝還在槽上生效、沉溺被補到下限；再跑一次不會多搬一副。腦部三槽都滿的那個人不搬。
- 在 `netrun` 進行中（測試用替身活動）拆甲板被擋。
- 進內海戰鬥：武器構裝照樣帶得進去、`unit.ext.deck` 照樣有（和 `hackFeature` 一起裝）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-bridge 之後（同一個資料夾）。做完才能開 M4-scene-net、M4-creation-body。

## 完成時回報

改了哪些檔、測試結果、介面（`ui/src/data/demo/net.ts` 開局送的甲板、內海分頁的「裝上甲板」）要跟著改的地方。
