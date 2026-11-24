# M4-training

- 交給：cpp-feature（sonnet）
- 目標：基本功的 5、6 級要有人教：向人請教（NPC 互動選單的「請教」）與去機構上課。
- 規格出處：CORE_RULES 7.2 節「基本功的規則」、7.5 節（那張十八列的表只當例子，是內容）；NPC_SYSTEM 6.1 節選單裡的「請教」；dev/work/M2-npc-interact.md（「請教（M4）」）。
- 可以改的路徑：`engine/src/features/abilities/`（新檔 `training.ts`）、`engine/src/features/npcs/interact.ts`（選單多一項、問一個條件）、`engine/tests/features/M4-training.test.ts`。
- 可以用的介面：M4-abilities-m4 的 `skillUpDraft`（升到 5、6 級時它會擋；這一張給它一個「已經有人教」的記號）；`actor.skills`；NPC 的基本功（`actor.skills`，生成的與固定的都在角色身上）；量表 `affinity`（`features/npcs`）；旗標（替他做了一件事：`taught:<npc>:<skill>`）；設施種類的欄位；條件 `at_facility`；`features/npcs/interact.ts` 的 `interactions`（選單）與它讀條件的方式；核心的 `time`、`cred`／`cash`、`flag`、`counter` 變更。
- 不可以做的事：`abilities` 與 `npcs` 不互相 import（選單那一項只問條件 `can_teach` 並發一個代辦，或回傳一個讓介面呼叫 `abilities` 的記號；做的人選一種寫進回報）；十八位老師與十八處機構是內容；「替他做一件事」的事件是內容，這一張只認旗標；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 設施種類多讀 `teach?: Array<{ skill, price, slots, needs?: Condition[] }>`（機構：教到 5 級；`slots` 是要上幾個時段）。
- 規則 `ability_rule` 多：`teach`（`{ affinity: 40, tuition: { 5: 1500, 6: 5000 }, slots_per_level: 2, slot_minutes: 240 }`）。
- `actor.ext.abilities` 多一欄 `lessons?: Record<基本功, { level, done, need, from }>`：上到一半的課。
- 條件 `can_teach`（`abilities` 註冊）：`{ npc, skill? }`：那個人有沒有哪一項基本功比主角高、而且是 5 級以上。
- 報告：`ability.lesson`（上一個時段的課）。匯出：`teachOptions(k, state, { npc?, facility? })`（能學哪幾項、到幾級、三種付法各自行不行與原因）、`lessonBlock`／`lessonDraft(k, state, { skill, from: { npc } | { facility }, pay: 'affinity' | 'tuition' | 'favor' })`。

## 要做的

1. 向人請教：那個人那一項的等級要高於主角現在的、而且至少 5；他幾級就教到幾級。條件三選一：親密度 `affinity` 以上（不收錢）；付學費（升到 5 級 1,500、6 級 5,000）；旗標 `taught:<npc>:<skill>` 已經立著（替他做過一件事）。每升一級要上 `slots_per_level` 個時段，一次一個時段（240 分鐘）；人要在那個人現在所在的地方（照 `features/npcs` 判斷他在不在場的現有方式）。
2. 去機構上課：腳下的設施種類有這一項的 `teach`；只教到 5 級；學費在第一個時段付清；`needs` 的條件不成立擋下（原因用條件的名字寫一句）；一次一個時段，上完 `slots` 個才算。
3. 上完最後一個時段：立一個「可以升這一級」的記號，`skillUpDraft` 看到記號就不擋（歷練點照 7.2 節另外花：5 級 50、6 級 60）；升完記號拿掉。上到一半換老師，進度不留（`lessons` 那一項重來）。
4. NPC 的互動選單多「請教」：`can_teach` 成立才列；選了之後交給 `teachOptions`。
5. 機構不教 6 級、基本功最高 6：擋下並各一句。

## 驗收條件（`engine/tests/features/M4-training.test.ts`；測試自帶一個槍械 6 級、親密度 45 的 NPC，一個槍械 5 級、親密度 10 的 NPC，一處教槍械的設施）

- 主角槍械 4：向 6 級的那位請教，靠親密度不收錢；上一個時段時間 +240 分鐘、還不能升；上完兩個之後 `skillUpDraft` 過得了、花 50 歷練點、槍械是 5；再上兩個可以升 6。
- 親密度 10 的那位：靠親密度被擋；付 1,500 可以；他只有 5 級，主角 5 級時他不在可以教的清單裡。
- 立了旗標的那位不收錢也不看親密度。
- 機構：第一個時段扣學費、上完資料寫的時段數之後可以升 5；主角已經 5 級時機構不列；`needs` 不成立被擋。
- 人不在場、不在那個設施，各被擋並有原因。
- NPC 的選單：`can_teach` 成立的人多一項「請教」；沒有東西可教的人沒有。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-abilities-m4（升基本功）。

## 完成時回報

改了哪些檔、測試結果、選單那一項用了哪一種接法、名冊上的人升 5、6 級是不是同一條路（設計書沒有另外寫，照主角的做）。
