# M3-ui-deck

- 交給：cpp-ui（sonnet）
- 目標：角色對話框的「內海」分頁接上引擎：甲板、構裝槽、裝與卸、SKIN、腳本、網內的數字；示意世界包開局給主角一副甲板與幾個構裝。
- 規格出處：docs/art/UI.md 8.2 節（分頁）、1.1 節規則 1（物品格）與「做不到的一律灰掉」；CYBERSPACE 4.2、4.3 節；ITEMS 11.9 節「怎麼存、怎麼裝」；dev/adr/0018 第三節；dev/work/M3-deck.md 的「新的格式與鍵」與匯出的 `deckView`。
- 可以改的路徑：`ui/src/dialogs/character/NetTab.vue`、`ui/src/dialogs/CharacterDialog.vue`（只有接線）、`ui/src/lib/`（新增 `deckView.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉假的 `deck` 狀態）、`ui/src/data/demo/`（新增 `net.ts`：示意的甲板、構裝、SKIN、腳本）、`ui/tests/net/`。
- 可以用的介面：`@engine/src/features/deck` 的 `deckView`、`installDraft`、`removeDraft`、`equipDraft`、`skinDraft`、`scriptsDraft`；`Game.commit`；衍生數值（`ram_max`、`ram_regen`、`deck_slots`、`deck_firewall`、`net_guard`）與核心的 `syncCapOf`。
- 不可以做的事：不改 `engine/`；槽數、能不能裝、為什麼不能、RAM 與防護都讀引擎；不從物品的說明文字裡抓數字（現在的 `NetTab` 用正規式抓「構裝槽 4」，拿掉）；義體的分頁不動；商店不賣構裝（內容的事）；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. 左邊：甲板一格（沒有的話是虛線框與「沒有甲板：沒有 RAM、不能在網內戰鬥」）、構裝槽一排（空格是虛線框；被專屬構裝佔掉的槽標出來）、帶著的腳本、SKIN。點槽 → 列出背包裡裝得上的，裝不上的灰掉並寫引擎的原因；裝與卸各走引擎的報告（時間會多 1 分鐘，畫面提示）。
2. 右邊：網內的數字（RAM 上限與每回合回復、防護、防火牆、同步開得到哪一檔與開不了的原因、感載上限、承受層數），全部讀引擎。
3. 戰鬥中、網內的行程進行中打開這一頁：整頁唯讀，頂端一句引擎給的原因。
4. 示意世界包：`ui/src/data/demo/net.ts` 放一副 II 級的入門甲板、三個武器構裝（步槍、近戰、干擾各一）、兩個防護、兩個工具（一個被動）、一支腳本、兩套 SKIN，開新局的 `setup` 把它們給主角並裝好。名字用設計書 ITEMS 第 11 節的示意就好，數字照 M3-deck 的格式自己填合理的。
5. `stores/game.ts` 裡假的甲板狀態與相關的假資料引用拿掉。

## 驗收條件（`ui/tests/net/M3-ui-deck.test.ts`；用引擎真的 `deck`，資料用測試自帶的）

- 沒有甲板的角色：槽是空的、有那一句提示；有甲板的：槽數等於引擎的 `deck_slots` 扣掉被佔的。
- 裝一件：引擎的 `actor.ext.deck.slots` 多了它、時間 +1 分鐘；槽滿時其餘的灰掉，原因和引擎的句子逐字相同。
- 右邊每一個數字等於引擎的衍生數值；換上防護值更高的構裝之後防護跟著變。
- 戰鬥中打開是唯讀的。
- 示意世界包：開新局之後主角有甲板、槽裡有東西、進得了內海戰鬥（用示意包的資料開一場最小的）。
- 掃原始碼：`NetTab.vue` 不 import `stores/game` 的 `deck`、不含 `match(`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M3-deck。排在 M3-ui-netcombat 之後。

## 完成時回報

改了哪些檔、測試結果、UI 8.2 節內海分頁裡因為引擎還沒有而沒顯示的東西（預期：染色、SKIN 的風格與曝露度、牌子的脾氣）。
