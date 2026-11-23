# M2-favors

- 交給：cpp-feature（sonnet）
- 目標：新功能 `favors`：人情這第二種貨幣。欠你的與你欠的分開記，有對象與大小；可以用掉、可以被討；戰鬥裡的人情池從這裡來。
- 規格出處：FIXER 第 8 節；EVENTS 2.4 節的 `owed`、`owed_to_pc` 兩列；TRADE 4.4 節（人情的作價，只記數字）；dev/adr/0015 E2（開打時照人情建池、結束時把差額寫回）。
- 可以改的路徑：`engine/src/features/favors/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-favors.test.ts`。
- 可以用的介面：`k.effects.register`、`k.conditions.register`、`k.stats.defineStat`、`k.changes.register`、`k.content`（`npc`、`faction`）。
- 不可以做的事：不寫「拿人情去做什麼」的每一種用途（那是用的那個功能的事：請人、買情報、殺價）；不改 `features/abilities`（人情池接上去是 M2-abilities-m2）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 狀態 `state.ext.favors`：`{ owed_to_pc: [{ id, who, size, at, note? }], owed_by_pc: [...] }`；`who` 是人或勢力的 id，`size` 是 `small`、`mid`、`big`。人情只記在主角名下。
- 變更 `favor.add`、`favor.spend`（指定哪一筆，或「這個對象、這個大小的任一筆」）。
- 效果 `owed_to_pc`（別人欠主角）、`owed`（主角欠別人），欄位 `{ kind, who, size }`；AI 給的只收小與中，大的整筆拿掉並提醒。
- 條件 `has_favor`（`{ who?, size?, dir }`）。衍生數值 `favor_small`、`favor_mid`、`favor_big`（主角名下「欠你的」各有幾個）。
- 報告：`favor.use`、`favor.called`（被討）。

## 要做的

1. `favorsOf(state)`、`spendBlock`／`spend(k, state, { who?, size })`：用掉一個欠你的；找不到給原因。大的可以當中的、中的可以當小的用（用掉的是那一筆整個）。
2. 被討：`call(k, state, id, answer: 'do' | 'refuse')`：拒絕時那一筆留著並給一個 `rep` 的效果（−3；沒有人定義 `rep` 時略過），答應就清掉（要做的那件事是事件的資料）。
3. 作價的對照（小 300、中 1,500；大的不作價）匯出成規則。
4. 內容檢查：效果的 `who` 要是查得到的人或勢力，或 `'$a'` 這類登場角色的代號。

## 驗收條件

- `owed_to_pc` 加一筆小的：清單多一筆、`favor_small` 是 1、`has_favor` 成立。
- 用掉指定對象的小人情：那一筆沒了；沒有時被擋下並有原因；只有中的時可以拿中的當小的用。
- AI 給大的人情被拿掉並提醒；內建的照寫。
- 主角欠人的那一邊分開記，不算進 `favor_*`。
- 被討：拒絕之後那一筆還在；答應之後清掉。
- 沒有主角時三個衍生數值是 0，不丟錯。
- 存檔往返清單不變；回到快照時跟著回去。

## 依賴

沒有（可以最早做）。M2-fixer、M2-roster、M2-market、M2-abilities-m2 會用到。

## 完成時回報

改了哪些檔、測試結果、FIXER 第 8 節裡留給別的功能的用途清單。
