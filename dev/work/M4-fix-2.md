# M4-fix-2（M4 收尾的第二批小修正；白箱之後做）

- 引擎（cpp-architect 角色，sonnet）＋介面（cpp-ui，sonnet）兩半；白箱找到的 bug 一起併進來。

## 引擎
1. gear 把穿戴物的 effects 交給被動效果來源 `gear`（0019 第二節；使用者 2026-11-26）。做完再看隨身錄影機要不要開（M5）。
2. 自己動刀、破解、急救的報價帶 `chance`（0～1）。
3. `nightList` 的 `BranchView` 帶 `basis`、隱藏數量、「深」；`SceneView` 帶精簡版多人的 `simple_note`。
4. `@engine/src` 匯出 `DIRECTION_MAX`、`INTERVIEW_SKILLS`、`paramStatId`、`treeTierOf`。
5. 橋參數的效果說明句；內容篩選的名字表（`CONTENT_TAGS` 的名字與一句說明）；特質帶內容標籤，畫面據此把篩選關掉的特質**照樣列出但灰掉**並寫原因（使用者 2026-11-26：保留、disable）。
6. `ActionOption.targeted`；拍賣 `Session.stage` 與 `inspectable`；成品在這裡賣得到多少。
7. engine/data 的 `event_scopes` 的 `contract` 加 `released`、`home`、`daily`。
8. `suggestedKit`：草稿還沒選橋時不要把裝備全部裁掉（只擋要橋的那幾件）。

## 介面
- 接上面的匯出（成功率、夜課 basis 與深、simple_note、拿掉三個深路徑、橋參數效果句、篩選名字表、特質依標籤藏、targeted、拍賣階段、賣價）。
- 戰鬥畫面的生命值也照 `hp_blur` 模糊。
- `data/items.ts`：game.ts 假 store 與 HomeScreen 家具還在用，M5 家園接引擎時拿掉（這批不做）。
- （使用者 2026-11-26）示意模式：正式遊戲預設關；發布給使用者看的介面示意版預設開（建置參數或示意版的設定，例 `VITE_DEMO_DEFAULT=on`）。
- （使用者 2026-11-26）建角特質：被內容篩選關掉的照樣列出、灰掉、寫原因，不能選。

## 白箱的 bug（2026-11-26）：B032～B042 全修，pending 移到 features
- B032 靜修期間沉溺過 100 結算不往下降；B033 沒有橋的人夜課橋參數條件不成立；B034 grace／bill 的夾值看來源（內建與關著且 asked 對得上的不夾）；B035 效果引用的 id 要存在、結果行不寫 id；B036 同一件事同一個傾向標籤只長一點；B037 帳單金額夾在合理上限、不溢位；B038 內容資料的年齡底線在內容覆蓋與沒裝 npcs 時也擋；B040 結束活動的同一份報告推進的時間也算在活動裡（期限暫停）；B041 指定生體不指定類型時只抽有生體版的類型。

## 使用者裁決（2026-11-26，都照建議）
1. B042：落幕時記帳會超過欠款上限，「記帳」灰掉（只能付清或簽檔期）。
2. B039：欠的房租沒補齊時轉成債（併進帳單的債），房間可以解鎖。
3. 沉溺 100 以上照樣加倍（定力、抗拒的懲罰與餘韻正面效果），和 80～99 一致。
4. 場熱剛好 20 算 ×0.1（「19 以下 0」）。
5. 補演評價「不合」：打賞再扣一成（維持現況）。
6. 斷線靜修期間技能失效（橋關著，容量 0）。
7. 拍賣自動跟價可以中途取消（LEWD 6.2 第 6 點）。
8. NPC 喊價「前一手剛被加價」＝緊接的前一手。

## 引擎這一半做完了（2026-11-26，cpp-architect 角色）：介面要接的新匯出

細節與取捨在 dev/adr/0019「實作補記：M4-fix-2」，不變式第 487～507 條。

| 介面那一半的項目 | 引擎給的（路徑從 `engine/src/` 起算） |
|---|---|
| 成功率 | 報價的 `chance`（0～1）：`installQuote`／`removeQuote`／`modifyQuote` 的 `self.chance`（自己動刀）、`crackQuote.chance`、`repairQuote.self.chance`、`forgeQuote.chance`（請夥伴辦；中間人 `null`）、`aidQuote.chance`。算法 `checkPassChance(bonus, dc)`（核心） |
| 夜課 basis 與深 | `nightList(...).branches[].basis`（`{ kind: 'experience'｜'axis', text, times?, partners?, axis?, axis_name?, level?, tiers: [{ tier, need, open }] }`）、`.hidden`（「N 個掛在你沒有的標籤上」的 N）、`.skills[].deep`（標籤深）。UI 8.4 節的「還沒開的階只顯示掛在你有的標籤上的技能、其餘寫「…」」畫面用 `tier` 與 `basis.tiers` 自己判斷 |
| simple_note | `sceneView(...).simple_note`（精簡版遇到多人設定時才有；一句完整的說明）；`sceneOptions(...).actions[].targeted`（多人時只有 `targeted` 的行動才列「對象」那一排） |
| 拿掉三個深路徑 | `@engine/src` 根匯出 `INTERVIEW_SKILLS`、`paramStatId`、`treeTierOf`（和 `bridgeParamEffect`、`NO_BRIDGE_NOTE`、`NO_BRIDGE_ABILITY`）；`DIRECTION_MAX` 本來就從 `@engine/src` 匯出（`shell/ai/sceneChains`） |
| 橋參數效果句 | `bridgeParamEffect(game.k, param)`（根匯出；`lewd` 的 `bridgeOf` 每一項也帶 `effect`） |
| 篩選名字表 | `CONTENT_TAG_INFO`（`{ 標籤: { name, note } }`）與 `contentTagName(tag, fallback?)`（根匯出；`FILTER_ROWS` 裡引擎認得的十二個可以直接讀它，拘束、公開、契約是內容自己的標籤，名字照舊） |
| 特質依標籤灰掉 | `PerkEntry.tags`；`perkFilterBlock(k, state, id)`（`features/creation`；每一個特質列用它：有原因就灰掉並寫這句，不要從清單拿掉）；`perkBlock` 與 `creationBlocks` 已經擋 |
| targeted | 見上 |
| 拍賣階段、賣價 | `sessionOf(...)`（`auction.session(house)`）的 `stage`（`upcoming`／`preview`／`waiting`／`open`）與 `inspectable`；`SESSION_STAGE_NAME` 是名字；`sellHere(k, state, item, uid?)`（`features/trade`）：腳下的店收這一件的價錢（每間店一列，附 `block` 原因） |
| **自動跟價（行為改了）** | 一回合一份報告：`bid({ auto: { max } })` 設上限並走這一回合、`bid({ act: 'auto_next' })` 照上限再走一回合、`bid({ act: 'auto_off' })` 取消；`auctionView().auto`（設著的上限或 `null`）、`bidOptions().auto.current`、`.auto_next`、`.auto_off`。畫面要自己一回合一回合送 `auto_next`（之間可以停下、取消），不再一次送完 |
| 橋關著 | 斷線靜修期間 `k.activity.bridgeClosed(state)` 為真：技能不算數、容量 0（`capacityOf` 的 `max` 都是 0，`holdingOf().equipped` 是空的）。靜修活動的面板可以提一句 |
| 沉溺 100 以上加倍 | `sink_rule` 的 `sunk` 一段 `double: true`；`passives.of` 的 sink 來源多了「溺感邊緣：加倍」那幾筆、`afterglow_double` 標籤（畫面的得失列照 `k.passives.of` 自然會出現） |
| 簾後館記帳 | `pathsOf` 的記帳列在會超過上限時 `can: false`、`why` 是完整的一句（灰掉並寫原因，不必自己算） |
| 欠款轉成債 | 付清當週時累積的欠款併成一筆債：`bill.settle` 報告多一句「欠款併成了一筆 N 的債」，`readBills(...).debts` 多一筆 |
