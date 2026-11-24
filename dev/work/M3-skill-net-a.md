# M3-skill-net-a

- 交給：cpp-feature（sonnet）
- 目標：槍手、潛網者、改造師、機師四棵樹的內海欄逐條寫成測試用的資料，證明格式寫得出來；補這四棵樹要的鍵；回報寫不出來的。
- 規格出處：SKILL_TREES「槍手：戰鬥直覺」「潛網者：主控」「改造師：手術刀」「機師：編隊」四節的「內海」欄、共鳴表與「預備與日常」裡提到內海的那幾句；CYBERSPACE 第 5 節（每條路數在網內的角色）、6.3 節（瞄準與超頻）、6.5 節（破損與修）；ITEMS 11.7 節；dev/adr/0018 N27、N33；dev/work/M3-abilities-net.md（格式）、M1b-skill-gunner-broker.md、M1b-skill-medic.md、M1b-skill-pilot.md（現實欄當時怎麼寫的）。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M3-skill-net-a.test.ts`、`engine/tests/fixtures/skills/`（測試用的技能資料）。
- 可以用的介面：M3-abilities-net 的格式；netcombat 的效果與標籤（`net.jam`、`net.break`、`net.fix`、`net.ram`、`net.trace`、`net.admin_spend`、`net.pin`、`sync:<檔>`、`admin`）；summons 的放出與指揮（守衛程式）；核心的修正（含 M3 新加的六個）與掛點（`overload` 的 `flash`）；現有的效果（`attack`、`buff`、`status`、`vent`、`shift`、`check`、`cover`……）。
- 不可以做的事：不改核心、不改 `features/netcombat`（缺的效果或修正列在回報，由 cpp-architect 決定加在哪）；不把資料寫進 `engine/data`；構裝體相關的（機師的 6 個）標 `pending`、不做；「預備與日常」只做帶進內海戰鬥與追蹤度起始值的那一半；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. 四棵樹每一個技能的內海欄寫成一筆測試資料（id 照 `sk_<樹>_<名字>`；只寫 `net` 與 `use.net`，現實欄可以留 `null`）。內海欄是「—」的寫 `net: null`。
2. 這幾棵樹會用到、M3-abilities-net 沒有的機制，在 `features/abilities` 裡補（只補通用的鍵，不替單一技能寫程式），已知的：
   - **戰鬥直覺的內海版**：開戰時隨機分配「階數 ÷ 3（進位）」點，只分到命中或迴避，整場不能重分配（現有的 `instinct.ts` 只做現實）。
   - **每場第一次、只在第一回合**：槍手的內海欄大半是「每場 1 次」「第一回合」，確認 `use.net` 的 `per_fight`、`first_round` 走得通。
   - **瞄準過的攻擊與超頻**：要害射擊（命中 +3、要害時破損）與連射控制（花手上全部的 RAM、每多 1 點多 1 顆骰、自帶壓制、標籤 `overclock`）用內海的武器構裝打。
   - **過載的改寫**：死線（第一次過載閃斷只讓 RAM 減半）、逆流（過載時不閃斷、RAM 回滿）：聽 `overload` 的 `flash`。
   - **修與排**：改造師的除錯（排 4 點感載，或 `net.fix` 修好一個破損的槽）；`dissect` 標籤。
   - **管理行動的加強**：我不在家喔（擦痕跡 −10）、改寫地形（一次兩格）、多工（次數 +1、每回合第一個 RAM −1）、根權限：用修正 `admin_uses`、`action_ram`（帶 `admin` 標籤）與自己的 `do`。
   - **靜默**：姿態開著時修正 `trace_round` −2、`trace_admin` −1。
   - **深潛**：姿態，`sync_cap` +1、`sync_shifts` +1。
   - **守衛程式**：機師的招牌在內海叫出一個（走 summons 的放出），指揮時沒有階數的命中加值。
3. 潛網者那一棵的路數 id 和 `features/hack` 預設的 `netrunner` 對一次（dev/status.md 留下的），不一致就在回報裡說、不要自己改 hack。
4. 做一張對照表（放在測試檔旁邊的 `.md` 不行：寫進回報）：每個技能、內海欄的原文、用了哪些鍵、狀態（做了／近似／寫不出來／等 M5、M6）。

## 驗收條件（`engine/tests/features/M3-skill-net-a.test.ts`；內海戰鬥用 netcombat 與 `BATTLE_SETUPS.net`）

- 四棵樹的測試資料全部載得進來（格式檢查過、用到的效果都查得到）。
- 每棵樹挑代表的幾個實際打一次，數字對設計書：
  - 槍手：戰鬥直覺 4 階分 2 點、只在命中與迴避；要害射擊命中 +3、打出要害時目標破損；連射控制花掉全部的 RAM、多的骰數對、淺檔灰掉；死線第一次過載之後 RAM 是原本的一半。
  - 潛網者：主控 3 階每回合三次管理行動、RAM 上限 +3、回復 +1、回填回 3、`deck_slots` +2；破冰無視 2 點防護；迴圈三回合每回合開始 2d6；靜默開著時每回合追蹤度 +1；逆流過載時 RAM 是滿的、沒有 `flash`；多工讓次數 +1；黑冰每點 RAM 一顆骰、每場一次。
  - 改造師：除錯排 4 點感載、或修好一個破損的槽，每場一次；隊上有他時 `dissect` 標籤在。
  - 機師：內海叫得出一個守衛程式、第二個被擋。
- 標 `pending` 的技能裝得上、沒有效果、不出現在圓環上。
- 回報裡的對照表涵蓋四棵樹的每一個技能。
- 現有的技能測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-abilities-net、M3-netadmin、M3-summons-net。和其他改 `features/abilities` 的工單不要同時做。

## 完成時回報

改了哪些檔、測試結果、對照表、缺的效果或修正（逐條：哪個技能要、建議加在哪）、遇到的規格問題。
