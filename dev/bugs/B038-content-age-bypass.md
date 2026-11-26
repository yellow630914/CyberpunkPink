# B038：內容資料的年齡底線繞得過去（內容的覆蓋、沒裝 npcs 功能時的匯入）
- 發現者：cpp-tester-boundary（AI_TASKS 2.5 的邊界：年齡）
- 嚴重度：錯誤（世界的固定規則；使用者 2026-11-25 定案「一律擋下」）
- 規格出處：AI_TASKS 2.5 節第二條（「每一種情況都照擋的是格式錯誤，以及內容資料裡的年齡：新的人、匯入與世界編輯器的人物，年齡欄位低於 18 一律擋下」）；GAME_DESIGN 第 3 節第 13 條（不論開關，內容底線一律擋）。
- 實際行為：
  - 擋得住的（對照，邊界測試裡有）：提交（報告任何深度的 `age` 低於 18 整份不收）、讀檔（整筆不讀）、整包匯入（npcs 功能的 ready 檢查：17 擋、18 收）。
  - 繞得過去的：
    1. 內容的覆蓋 `k.content.applyOverlays([{ id, content: { npc: { set: [{ ...npc_tw_friend, age: 16 }] } } }])`：只跑內容種類自己的 `validate`（核心的 `npc` 只驗 id 與 name）與 `checkRefs`，16 歲照收，之後 `k.content.get('npc', …).age` 是 16。之後 AI 的 `meet` 帶出這個人時 reward 的驗證不過（`actor.add` 擋年齡），提交沒有壞，但內容已經進去了。
    2. 沒裝 npcs 功能時整包匯入 `{ id: 'npc_tw_young', name: '小孩', age: 12 }`：照收（年齡的檢查只在 npcs 的 `npcEntryProblems`）。
- 重現：`engine/tests/features/fixtures/B038-content-age-bypass.json`；會失敗的測試：`engine/tests/features/B038-content-age-bypass.test.ts`（兩條）。
- 可能的位置（只寫推測，不改）：`core/content/kinds.ts` 的 `npc` 種類的 `validate` 可以自己驗 `age`（有寫就要是 18 以上的整數）；或 `core/content/registry.ts` 的 `load`／`applyOverlays` 對每一筆跑一次和 `underageAt`（`core/state/coreChanges.ts`）同一條的掃描，所有內容種類都適用。覆蓋現在沒有人呼叫（shell 與 ui 都沒有），世界編輯器接上之前修就不會漏。
- 狀態：已修（M4-fix-2，2026-11-26）。年齡的底線進內容登錄表：`core/util/age.ts`（L1）放 `MIN_AGE` 與 `underageAt`（`core/state/coreChanges.ts` 照舊匯出），`ContentRegistry.validate` 對每一筆內容（任何種類、任何深度的 `age` 欄位）跑同一條掃描，低於 18 整批不收；載入、整包匯入（沒裝 npcs 也一樣）、覆蓋（`applyOverlays`）都走這裡。測試：`engine/tests/features/B038-content-age-bypass.test.ts`。
