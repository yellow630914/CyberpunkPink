# M3-abilities-net

- 交給：cpp-feature（sonnet）
- 目標：技能格式的內海欄：`net` 用和 `meat` 同一套封閉清單，照戰場選欄；加上內海才有的幾個鍵（管理行動的消耗與基數、構裝槽、同步檔位的條件、招牌的專屬構裝）。這一張只做格式與機制，八棵樹逐條寫是後面兩張。
- 規格出處：SKILLS 1.7、1.8 節（效果清單與禁止的三樣）、第 13 節（資料的樣子）；SKILL_TREES 開頭「讀表的方式」與潛網者那一棵（當成格式要寫得出來的例子）；CYBERSPACE 第 5 節、6.3 節（瞄準與超頻是槍手的技能）、6.4 節（淺檔不能超頻、不能用專屬構裝）；ITEMS 11.7 節；dev/adr/0015 E1（消耗照戰場分）；dev/adr/0018 第一節與 N33；dev/work/M1b-skill-format.md（現有的格式）。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M3-abilities-net.test.ts`。
- 可以用的介面：現有的技能格式與 `format.ts` 的檢查；`BattleActionDef.modes`；`run.mode.layer`；單位的標籤 `sync:<檔>`、`admin`；效果 `net.admin_spend`、`net.trace`、`net.jam`、`net.break`、`net.fix`、`net.sync`、`net.ram`（netcombat 註冊的；沒有裝時用到它們的技能載入就被擋，這是對的）；`k.stats.addStatProvider`（`deck_slots`、`deck_slots_reserved`、`sync_cap_bonus`；沒有人定義的衍生數值就不加）；`k.stats.defineStat`。
- 不可以做的事：不 import `features/netcombat`、`features/deck`；不動 `meat` 欄現有的行為（現實的技能測試原樣全過）；不寫任何一棵樹的資料到 `engine/data`；輿論欄不碰；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- `AbilityEntry.net`：型別從 `Record<string, unknown> | null` 改成和 `meat` 同一個（`MeatDef | null`），檢查用同一套，訊息的前綴寫 `net.`。
- 行動的 `modes`：`meat` 欄有主動的效果就含現實、`net` 欄有就含內海；兩欄都有的技能是同一個行動，執行時照戰場選欄與選 `use`。
- `use` 多 `admin?: number`（花幾次管理行動；結算時走效果 `net.admin_spend`）。
- 欄裡多（兩欄都可以寫，內海用得到）：`slots?: number`（構裝槽加減）、`admin?: 'tier' | number`（管理行動的基數）、`sync_cap?: number`（同步檔位的上限加幾級）、`unique?: true`（這一欄是招牌的專屬構裝：佔一個槽、淺檔不生效）；`tags` 可以寫 `overclock`（帶這個標籤的行動淺檔做不了）。
- `when`（條件）多 `sync_min`、`sync_max`（`shallow`、`standard`、`deep`、`full`；看單位的 `sync:<檔>` 標籤，沒有標籤的單位當標準）。
- `prep.net?: { mods?, do?, trace_start?: number }`（預備帶進內海的；`trace_start` 是這件委託的內海階段追蹤度起始值的加減）。
- 衍生數值 `net_trace_start`（這個功能定義；基本 0：預備好而且綁在這件委託上的技能的 `trace_start` 合計）。

## 要做的

1. 把「這一欄」抽成一個函式（照戰場的 `layer`）：被動的修正、資源池、標籤、反應、姿態、主動的行動、AI 的條件全部經過它。現實的行為不變。
2. 行動的花費照戰場選 `use.net` 或 `use.meat`（E1 已經有照戰場分的寫法，補上執行）；`admin` 的消耗不夠時行動灰掉，原因寫出這一回合剩幾次。
3. 單位組好時（`unit.ready`，內海）：`admin` 寫成 `unit.ext.net.admin`（`'tier'` 是那棵樹的階數；**和別人寫的合併，不整個蓋掉** `unit.ext.net`）。
4. 戰鬥外也算的三個：`slots` 與 `unique` 經 provider 加到 `deck_slots`、`deck_slots_reserved`（讀角色裝著的技能；`unique` 每一個 +1）；`sync_cap` 加到 `sync_cap_bonus`（姿態的只在戰鬥裡用修正 `sync_cap`）。
5. 淺檔：帶 `unique` 的那一欄整欄不生效（被動的修正不算、行動灰掉並寫原因）；帶 `overclock` 標籤的行動灰掉。
6. 預備：`prep.net` 的 `mods`、`do` 照現有 `prep.meat` 的做法帶進下一場內海戰鬥；`trace_start` 經 `net_trace_start` 給開那一趟的人讀。現實的預備在內海不帶（現在的行為）不變。
7. 夥伴與敵人的招牌行動（`enemy: true`）照同一條路選欄：只寫了 `meat` 的招牌在內海沒有，寫了 `net` 的才有。

## 驗收條件（`engine/tests/features/M3-abilities-net.test.ts`；測試自帶八個假技能，照 SKILL_TREES 潛網者的幾種寫法各一個：兩欄都有的主動（內海 2 行動點 2 RAM、現實 1 行動點 2 RAM）、只有內海的主動（1 次管理行動加 1 RAM）、內海的被動（RAM 上限 +1、構裝槽 +1）、招牌（`unique`、`admin: 'tier'`、`tags: ['admin']`）、反應、姿態（`sync_cap: 1`）、`overclock` 的主動、預備（`trace_start: -15`）；內海的行動用 `TEST_NET_COMBAT`，`net.admin_spend` 用測試的替身效果）

- 兩欄都有的那個技能：現實戰鬥花 1 行動點、內海花 2，各做各欄的效果；只有內海欄的技能現實的圓環上沒有。
- `net` 欄寫了清單以外的鍵、用了沒有註冊的效果：載入被擋，訊息以 `net.` 開頭。
- 花管理行動的技能：替身效果被叫到一次；替身回報「沒有次數了」時行動灰掉並有原因。
- 招牌裝著：內海的單位有 `admin` 標籤、`ext.net.admin` 等於樹階，而且測試先放在 `ext.net` 的 `sync` 還在；`deck_slots_reserved` 是 1（測試定義這個衍生數值）；被動的那個讓 `deck_slots` +1。
- 把單位的標籤換成 `sync:shallow`：招牌的修正不算、它的行動灰掉並寫「淺檔」；`overclock` 的行動灰掉；換回標準都恢復。
- `when: { sync_min: 'deep' }` 的修正只在 `sync:deep` 與 `sync:full` 時算。
- 姿態開著時修正 `sync_cap` 是 +1。
- 預備好那個預備並綁到委託甲：`net_trace_start` 是 −15；沒綁、或綁的是別件，是 0。
- 現實的技能測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat（`sync:<檔>` 標籤與 `net.*` 效果的名字）。做完才能開 M3-skill-net-a。

## 完成時回報

改了哪些檔、測試結果、`meat` 的封閉清單裡哪些鍵在內海沒有意義而擋掉了（列出來）、SKILLS 1.8 節的效果清單裡內海還寫不出來的。
