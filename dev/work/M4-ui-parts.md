# M4-ui-parts

- 交給：cpp-ui（sonnet）　（**第五波**）
- 目標：未登錄零件與學工藝在畫面上的入口：委託簡報的報酬欄多的那一樣、等著交貨與交貨、背包與組裝認得內嵌的零件、同人社團的委託台（訂做與取貨）、勢力的固定窗口、NPC「請教」底下的學工藝。
- 規格出處：docs/art/UI.md 1.1 節（規則 1 與「做不到的一律灰掉」）、3.7 節（背包）、7.1 節（接案的報酬欄）、第 9 節（組裝的零件清單）、3.9 節（關係）；CRAFTING 11.1、11.2 節；dev/adr/0019 第十七、十九節；dev/work/M4-part-unreg.md、M4-part-sources.md、M4-core-part-ai.md、M4-craft-teach.md 的「匯出」。
- 可以改的路徑：`ui/src/dialogs/FixerDialog.vue`（報酬欄與結算）、`ui/src/dialogs/BagDialog.vue`、`ui/src/dialogs/CraftDialog.vue`（只有零件清單認得內嵌的零件）、`ui/src/dialogs/PartOrderDialog.vue`（新）、`ui/src/dialogs/RelationsDialog.vue`（勢力那一頁多一個入口）、`ui/src/dialogs/TalkDialog.vue`（學工藝）、`ui/src/lib/`（新增 `partsView.ts`；`here.ts` 多一項）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（新增 `parts.ts`）、`ui/tests/parts/`。
- 可以用的介面：`@engine/src/core` 的 `stackPart`、`partOf`、`productOf`；`@engine/src/features/unreg` 的 `pendingParts`、`readyParts`、`deliverBlock`、`orderOptions`、`orderBlock`／`orderDraft`、`windowOptions`、`windowBlock`／`windowDraft`；`Game.unregDeliver`（M4-core-part-ai；AI 開著時走任務鏈，畫面沿用現有的任務鏈列）；`features/fixer` 的 `BriefView.extra_label`、`PayoutRecord.extra`；`features/abilities` 的 `tutorOptions`、`tutorDraft`；`Game.commit`、`Game.commitNarrated`。
- 不可以做的事：不改 `engine/`；價錢、等級上限、能不能訂、能不能換、怪癖的候選、學費與時段全部讀引擎；不在元件裡組零件的數字或名字；不做 AI 當日優惠與玩家自己的社團；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 接案與結算：簡報的報酬欄在有 `extra_label` 時多一行（現金的數字已經是引擎乘過的，不另外算）；結算頁列出 `PayoutRecord.extra` 的句子。
2. 等著交貨：`stores/engine.ts` 在每一步之後看 `readyParts`，不是空的就逐一呼叫 `Game.unregDeliver`（被活動擋住的留到下一步）；交貨的報告用現有的結果視窗顯示。背包多一個「等著交貨」的小區塊：每一筆的類型、等級、來源，訂做的那幾筆寫還要幾天與「到委託台取貨」。
3. 背包與組裝：`stackPart` 讀得到內嵌零件的那一疊顯示名字、說明、每一條屬性、怪癖（種類的名字加寫出來的那一句）、「未登錄」的標記與來源；組裝對話框的零件清單與成品的詳情認得它（名字與數字都從 `partOf`／`productOf` 來）。
4. 委託台（站在帶 `unreg_desk` 的設施上，「這裡」多一項）：選類型、材質、等級；勾想要的方向並排順序；有兩筆怪癖可以挑時二選一；選填一句描述（80 字）；顯示價錢、幾天、擋住的原因（逐字用引擎的）。進行中的訂單在同一個對話框看得到；時間到了、人在委託台時「取貨」（呼叫 `Game.unregDeliver`）。
5. 勢力的固定窗口：關係對話框勢力那一頁，`windowOptions` 回得出東西的勢力多一個「換一件未登錄零件」：能不能換與原因、選類型與方向、確認要用掉一個大人情。
6. 學工藝：NPC 對話的「請教」裡，`tutorOptions` 有東西時多一段：每一項現在幾級、下一級的學費（引擎乘過區倍率的）、幾個時段、上了幾個、擋住的原因；按一次上一個時段。每堂會加沉溺的老師先寫清楚。
7. 示意世界包（`parts.ts`）：`unreg_rule` 的一張小選項表（外皮、槍管、板材各兩三項）、六筆預設清單、三筆怪癖、一個帶 `unreg_desk` 的攤位、一位教機械的 NPC（`tutor`）、一個開局用效果給到好感 100 與一個大人情的勢力、一位中間人的委託把 `sources.reward.chance` 蓋成 1 的規則表（示意包自己的 `unreg_rule`），讓第一件 III 級委託一定帶零件。文字中性。

## 驗收條件（`ui/tests/parts/M4-ui-parts.test.ts`；用引擎真的功能，AI 關著）

- 示意包的 III 級委託：報酬欄有那一行、現金是六成；做完之後下一步背包多一件未登錄零件、「等著交貨」是空的。
- 背包那一件顯示的每一條屬性等於引擎那一筆 `InlinePart` 的 `stats` 與 `affinity`；組裝對話框的零件清單列得出它，放進槽之後預覽的數字等於 `assemblyPreview`。
- 委託台：不在委託台開不了；錢不夠時按鈕灰掉、原因逐字相同；下單之後對話框有那一張訂單與「還要 3 天」；過三天回來可以取貨。
- 勢力的窗口：條件不成立的勢力不列或灰掉並有原因；換了之後大人情少一個、同一個勢力不能再換。
- 學工藝：學費等於 `tutorOptions` 的數字；上完兩個時段之後那一項是 1 級；2 級之後這一段不見。
- 掃原始碼：`ui/src` 沒有自己算未登錄零件價錢或學費的式子。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-part-unreg、M4-part-sources、M4-core-part-ai、M4-craft-teach、M4-ui-craft。介面的工單彼此不要同時做。

## 完成時回報

改了哪些檔、測試結果、缺的圖示（未登錄的標記、委託台）、AI 開著時交貨那一步在畫面上等多久、UI 設計書沒有寫而這一張自己定的版面（委託台的對話框、等著交貨的區塊）。

- 總指揮補記（2026-11-25，M4-craft-teach 回報）：「請教」的 handoff 多帶 `also: ['abilities.tutorOptions']`，畫面兩邊的選項都要列（只帶 tutor 的 NPC 呼叫 teachOptions 是空的）。

- 總指揮補記（2026-11-25，M4-core-part-ai 回報）：設定頁加 `partAi` 開關（`partAiOf`，預設開）；交貨走 `Game.unregDeliver`；零件標「二手」讀 `productOf(...).parts[i].part.state`；寫正文被拒停在 paused 時提供「用規則代替」。
