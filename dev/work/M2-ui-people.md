# M2-ui-people

- 交給：cpp-ui（sonnet）
- 目標：和人有關的畫面接上引擎：「這裡的人」、和 NPC 說話與互動、關係、名冊與招募、人情；另外把橋分頁的換配置照引擎的地點與時間。
- 規格出處：docs/art/UI.md 3.1 節（這裡的人）、3.5 節、3.9 節（關係與對話畫面）、8.3 節最下面一行（換配置）、第 13 節（名冊）；dev/work/M2-npcs.md、M2-npc-interact.md、M2-npc-life.md、M2-roster.md、M2-favors.md、M2-abilities-m2.md 的「新的格式與鍵」與「對外」。
- 可以改的路徑：`ui/src/dialogs/`（`TalkDialog.vue`、`RelationsDialog.vue`、`RosterDialog.vue`、`CharacterDialog.vue` 與 `character/` 裡橋的分頁）、`ui/src/screens/MainScreen.vue`（「這裡的人」那一塊）、`ui/src/components/MoneyTag.vue`（人情）、`ui/src/lib/`（新增 `peopleView.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉假的 `roster`）、`ui/src/data/demo/`、`ui/tests/`。
- 可以用的介面：`@engine/src/features/npcs`（`npcsHere`、`npcOf`、`interactions`、`interactInput`、`recall`、關注）、`@engine/src/features/roster`（名冊、容量、招募、`muster`、出場費）、`@engine/src/features/favors`（`favorsOf`、用掉、被討）、`@engine/src/features/abilities`（`applyLoadout`、能不能換與原因）、`Game.act`、store 的 `blockOf`。
- 不可以做的事：不改 `engine/`；DC、成功率、親密度的階段、容量都問引擎；關係線、傳訊息、送禮以外的邀約、採訪、請教先灰掉並寫「還沒有開放。」；AI 寫的「和你的關係一句」沒有時留空；共同的規定見 dev/work/M2-plan.md。

## 要做的

1. **這裡的人**：引擎的 `npcsHere`；點一個人開對話畫面。
2. **對話畫面**：左邊是親密度與階段、忠誠（名冊上的人）、已知的事（沒揭開的寫問號）；中間是紀錄與互動選單（每一種的 DC、成功率、不能做的原因照 `interactions`；送禮選背包裡的東西；「我要做別的」）；右邊是共同記憶（`recall`）。互動送出去走主動行動。
3. **關係**：名單（篩選、親密度條以 0 為中線、階段的名字、人情）、詳情、關注的開關、記憶可以改寫、釘選、刪除。
4. **名冊**：成員（路數與階數、出場費或分紅、忠誠、現在的狀況）、容量、候選人、招募（DC 與成功率）、把人拿掉。
5. **錢與人情**：錢包旁列出欠你的與你欠的（你欠的用橘字）；被討的時候是一則待處理。
6. **換配置**：橋分頁最下面一行寫現在能不能換、要花多久（引擎的原因與分鐘數）；按套用一次送出整組；委託裡整頁唯讀並寫原因。
7. **示意世界包**（M2-plan 第 5 項）：把 `ui/src/data/npcs.ts`、`roster.ts` 的示意人物整理成引擎的內容（固定 NPC 用 `engine/data` 已經有的 id，其餘是每區的生成規則與名字的池）。

## 驗收條件（測試自帶兩個固定 NPC、一個區的生成規則）

- 走進一區之後「這裡的人」和引擎的 `npcsHere` 一樣；晚上才在的人白天不在。
- 聊天成功之後親密度的數字與階段跟著變；同一天第二次聊天畫面提示不再加親密度（引擎的句子）。
- 威嚇對中間人是灰的並有原因；送禮選了東西之後背包少一件。
- 已知的事：讀橋成功之後那一格從問號變成內容。
- 招募：名冊滿了按鈕是灰的、原因是引擎的；成功之後名冊多一個人、容量的數字對。
- 人情：事件給了一個小人情之後錢包旁多一筆；用掉之後少一筆。
- 換配置：不在住處時套用是灰的並有原因；在住處套用之後時間多了引擎說的分鐘數（測試掃原始碼：畫面裡沒有寫死的「半小時」數字）。
- 這幾個元件與 `peopleView.ts` 裡沒有 DC 與親密度門檻的算式；不 import `ui/src/data/npcs`、`roster`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M2-npcs、M2-npc-interact、M2-npc-life、M2-roster、M2-favors、M2-abilities-m2。介面的六張裡排最後。

## 完成時回報

改了哪些檔、測試結果、UI 那幾節裡因為引擎還沒有而沒顯示的東西、刪掉的舊程式清單。
