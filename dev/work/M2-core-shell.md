# M2-core-shell

- 交給：cpp-architect 角色（sonnet；**改的是核心與外殼**）
- 目標：照 dev/adr/0016 第二、六節，讓功能用一筆變更存快照、用報告上的 `rewind` 回到快照、用一條通用的鏈在結算之後寫正文；加上算「跨過幾個時間點」的工具與 `rest.done` 掛點。
- 規格出處：dev/adr/0016 第二、六節；dev/adr/0011（快照）、0008（回到快照保留紀錄）；SERIES 第 6 節（撤退留下什麼）；AI_TASKS 2.7 節（鏈的樣子，只為了對照）。
- 可以改的路徑：`engine/src/core/state/`（`coreChanges.ts`、`kernel.ts`、`hooks.ts`、`commit.ts`）、`engine/src/core/types/`、`engine/src/core/util/time.ts`、`engine/src/shell/`、`engine/src/testkit/`、`engine/tests/core/`、`engine/tests/whitebox/`（只加）、dev/invariants.md。
- 不可以做的事：不改 `snapshot.add`、`retryBattle`、`rewindToStage` 現有的行為；不替任何功能開專屬的鏈；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 變更 `{ op: 'snapshot.take', kind, label, owner?, data?, replace? }`；`SnapshotSlot.owner?`。
- `Report.rewind?: { kind: string; summary: string }`。
- `StateKernel.serialize?: (state) => string`（外殼在建 `Game` 時注入，內容就是現在 `snapshotText` 的做法）。
- `Game.rewindToKind(kind, summary)`、`Game.commitNarrated(draft, { mode, label?, attach? })`；鏈的 id `narrated`。
- `crossings(from, to, { every, offset })`（L1，回傳跨過的每一個時間點）；掛點 `rest.done`：`[{ state, kind: 'breath' | 'sleep' | 'stage' }, Change[] | void]`。

## 要做的

1. **`snapshot.take`**：存的是「這份報告套用之前」的狀態。它不是報告的第一筆變更時擋下（訊息寫明要放第一筆）；`k.serialize` 沒有注入時擋下。`replace: true` 把同一個 `owner`、同一種的舊快照拿掉。記進紀錄時不留文字。testkit 的狀態工廠與 `makeGame` 預設帶一個序列化函式。
2. **`rewind`**：提交完（`launch` 之後不會再有 `rewind`：同一份報告兩個都寫就擋下）外殼呼叫 `rewindToKind`：回到最近一份這個種類的快照，比它晚的快照一起丟；之後的紀錄留著並標成被收回，`summary` 寫成一筆 `system` 的報告，`rewind.keep` 掛點照舊。找不到那種快照：整步不成立（同 `launch` 的回滾）。
3. **`commitNarrated`**：給定的草稿 → `narrate`（`mode`；草稿帶 `adult` 時走成人路由）→ 套用。放行問 `commit:<草稿的 action>`。AI 關著、或設定關掉寫正文時，結果和 `commit` 一樣。重試、用規則代替照現有的鏈。套用之後照常處理 `launch` 與 `rewind`。
4. **`crossings`** 與兩個常用的包裝（每天 08:00、每週一 06:00；時段規則照 `TimeRules`）。
5. **`rest.done`**：只加型別與一個「跑掛點、收變更」的小函式；發的人是功能。
6. 用一段「像副本」的流程補 `Game.rewindToStage` 的測試：`snapshot.take` 存 `entry`、再存 `stage`、開打、打輸、回到階段。

## 驗收條件（`engine/tests/core/shell-m2.test.ts`）

- 一份報告先存快照再改錢：回到那份快照，錢是改之前的；快照裡不再包快照。
- `replace` 的第二份把第一份換掉；沒寫 `replace` 的兩份都在；不同 `owner` 互不影響。
- 報告帶 `rewind`：提交之後狀態回到那一刻，這份報告與之後的紀錄還在、標成被收回，多一筆 `summary`；`rewind.keep` 回傳的變更套在回去之後的狀態上。
- 找不到快照的 `rewind`：狀態不變、有原因。
- `commitNarrated`：假的服務商開著時報告有正文；關著時沒有，其餘完全一樣；`adult` 的草稿走成人路由（看假服務商收到的請求）；戰鬥中被擋下。
- 入口、階段、開打三份快照都在時打輸：`rewindToStage` 回到階段那一刻（時間、錢），入口那一份還在。
- `crossings`：同一刻不算跨過；一次跨兩週回兩個點；週一 06:00 與每天 08:00 各有一條。
- 存檔往返：帶著 `owner` 的快照存了再讀還在。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；dev/invariants.md 補「`snapshot.take` 存的是報告之前」「帶 `rewind` 的報告自己留在紀錄裡」。

## 依賴

M2-core-activity 做完。做完才能開 M2-commission-run、M2-bills。

## 完成時回報

改了哪些檔、測試結果、ADR 做不到的地方。
