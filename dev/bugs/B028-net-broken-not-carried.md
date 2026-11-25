# B028：重的破損寫回角色之後，下一場內海戰鬥沒有人讀它（構裝在戰後立刻「修好」）
- 發現者：cpp-tester-whitebox
- 嚴重度：錯誤
- 規格出處：CYBERSPACE 6.5 節「破損」——目標的一個構裝槽失效。輕：到這場戰鬥結束。**重（對方本來就有破損時再中一次）：到登出之後修好為止**，改造師的「除錯」可以當場修。dev/work/M3-netcombat.md 第 5 項：重的「結束時寫回角色（改用角色身上的狀況 `net_broken`，直到修好）」。
- 實際行為：
  - 戰鬥結束時 `features/netcombat/jam.ts` 的 `battle.onEnd` 對 `ext.net.heavy === true` 的我方角色寫 `{ op: 'actor.condition', condition: 'net_broken' }`（`tests/features/M3-netcombat.test.ts`「再中一次（重）」與「破損：自然 20 兩次之後」驗過會寫）。
  - 但整個引擎沒有任何地方讀 `net_broken`（`grep -rn net_broken engine/src` 只有寫的那一行與註解）。下一場內海戰鬥開打時，`unit.ready`（netcombat 的 `installSync` 與 deck 的 `unit.ready`）組出來的單位 `ext.net.broken` 是空的、沒有 `dice_loss`：重的破損在戰後就沒有任何作用，和輕的一樣。
  - 狀況本身沒有記是哪一件構裝破損（`actor.condition` 只有 id），就算之後有人讀，也不知道要停用哪一件。
  - 已經知道、不在這份報告裡的：`net_broken` 沒有人清（dev/work/M4-followups.md 第 7 項，休息時拿掉）。這份報告講的是「留著的這段期間它沒有效果」。
- 重現：`engine/tests/whitebox/fixtures/B028-net-broken-not-carried.json`（`makeNetBattleGame({ noBattle: true })`，主角帶 `net_broken` 開一場內海戰鬥）。
  會失敗的測試：`engine/tests/pending/B028-net-broken-not-carried.test.ts` 的第一條（沒有 `net_broken` 的對照那一條會過）。
- 可能的位置（只寫推測，不改）：
  - `features/netcombat/jam.ts`：戰後寫回時把破損的那一件一起記下（例：`net_broken` 帶資料，或改成 netcombat 自己的 `actor.ext.net_broken: string[]`；`actor.ext.deck` 不是 netcombat 的，不能直接寫——不變式第 180 條同樣的理由）。
  - `features/netcombat/sync.ts` 的 `unit.ready`（現在組 `ext.net.broken` 的地方，`broken` 只從 `cur.broken` 來）：角色帶著重的破損時，把記下的那一件放進 `broken` 並設 `heavy`（再中一次照舊是重的）；記不出是哪一件的，照「武器、工具、防護的順序挑還沒破損的第一件」（和 `breakOne` 同一個挑法）。
  - 什麼時候算「登出之後修好」要 cpp-architect 定：dive 登出時、netrun 收尾時，還是照 M4-followups 第 7 項等休息；三者會影響同一次潛入裡連打幾場時的行為。
- 狀態：已修（2026-11-25，M3 白箱修正批；使用者裁決：睡一覺清掉、或付錢修）。重創寫回時記是哪一件（`actor.ext.net_broken`），下一場內海戰鬥開打帶進來；修好：睡一覺（`rest.done`）、付錢修（`netcombat/repair.ts`，資料還沒有哪一種設施寫 `repair_construct`）、戰鬥裡 `net.fix`。回歸測試 `engine/tests/features/B028-net-broken-not-carried.test.ts`、`M3-fix-whitebox.test.ts`；不變式第 188、189 條；dev/adr/0018 M3 白箱修正批。
