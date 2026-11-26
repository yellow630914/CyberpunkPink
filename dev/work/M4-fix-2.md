# M4-fix-2（M4 收尾的第二批小修正；白箱之後做）

- 引擎（cpp-architect 角色，sonnet）＋介面（cpp-ui，sonnet）兩半；白箱找到的 bug 一起併進來。

## 引擎
1. gear 把穿戴物的 effects 交給被動效果來源 `gear`（0019 第二節；使用者 2026-11-26）。做完再看隨身錄影機要不要開（M5）。
2. 自己動刀、破解、急救的報價帶 `chance`（0～1）。
3. `nightList` 的 `BranchView` 帶 `basis`、隱藏數量、「深」；`SceneView` 帶精簡版多人的 `simple_note`。
4. `@engine/src` 匯出 `DIRECTION_MAX`、`INTERVIEW_SKILLS`、`paramStatId`、`treeTierOf`。
5. 橋參數的效果說明句；內容篩選的名字表（`CONTENT_TAGS` 的名字與一句說明）；特質帶內容標籤（篩選關掉的特質不列）。
6. `ActionOption.targeted`；拍賣 `Session.stage` 與 `inspectable`；成品在這裡賣得到多少。
7. engine/data 的 `event_scopes` 的 `contract` 加 `released`、`home`、`daily`。
8. `suggestedKit`：草稿還沒選橋時不要把裝備全部裁掉（只擋要橋的那幾件）。

## 介面
- 接上面的匯出（成功率、夜課 basis 與深、simple_note、拿掉三個深路徑、橋參數效果句、篩選名字表、特質依標籤藏、targeted、拍賣階段、賣價）。
- 戰鬥畫面的生命值也照 `hp_blur` 模糊。
- `data/items.ts`：game.ts 假 store 與 HomeScreen 家具還在用，M5 家園接引擎時拿掉（這批不做）。
