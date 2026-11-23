# M2：批次計畫

- 寫的人：cpp-architect（2026-11-23）。設計在 dev/adr/0016；這一份是工單的清單、相依、順序與要使用者先定的事。
- 範圍（MIGRATION 第 6 節 M2 那一列，加上 dev/status.md 標了 M2 的待辦）：委託副本的階段制（只有現實面）；事件導演；城市地圖、交通與現實面的探索；NPC 與關係；名冊與召集；交易與行情；敵對值與掃橋；每週帳單；打工；橋參數；最小的住處；成人場景的最小可操作版；戰敗事件的完整流程。
- 和 M1 第二波一樣：**只做機制，不匯入內容**；工單**沒有預先寫好的驗收測試**，每一張列的是驗收條件，做的人自己寫成測試。

## 每一張都適用的規定

1. 不 commit、不 push（總指揮統一做）。做完跑 `engine/` 的 `npm test`、`npx tsc --noEmit`（介面的跑 `ui/` 的 `npm test` 與 `vue-tsc`）。
2. 內容資料一律用測試自帶的最小假資料，不讀也不改 `engine/data` 的內容類。測試放工單指定的路徑，直接進主套件。
3. 新功能放 `engine/src/features/<功能>/`，只 import `'../../core'`；做完在 `engine/src/features/index.ts` 的 `FEATURES` 加一行（同時在做的兩張都要加時，各加各的那一行）。
4. 讀別的功能的數字只經由 `meterOf`、`k.stats`、`k.conditions`、`k.content` 與核心的狀態；寫只經由變更與效果；**不讀別的功能的 `state.ext`**（dev/adr/0016 第三節）。工單寫「有人註冊才…」的地方，那個功能沒裝時要照樣跑得起來。
5. 報告的 `action` 用自己的前綴（0016 第七節）；改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立時丟錯或回傳原因，原因寫成給玩家看的完整句子、一條一個條件。
6. 規則的數字在功能裡寫一份照設計書的預設（`DEFAULT_…`），並開一種規則的內容種類讓資料蓋掉；資料檔最後由 M2-data-rules 補。設計書沒寫的數字照 0016 第八節（G1～G18），看到設計書有相反的寫法就停下來回報。
7. 核心的四張（M2-core-…）與 M2-smoke 改的是 `coreDirs`：派 cpp-architect 角色、指定 sonnet，派工時明說可以改哪些核心路徑。

## 工單

| # | 工單 | 交給 | 做什麼 | 主要動到 |
|---|---|---|---|---|
| 1 | M2-core-activity | 核心（sonnet） | 活動的登錄表、放行、`launch`、`activity.end`、報告的 `triggers` 與 `adult` | `core/action`、`core/types`、`shell/game.ts` |
| 2 | M2-core-shell | 核心（sonnet） | `snapshot.take`、報告的 `rewind`、`commitNarrated`、`crossings`、`rest.done` | `core/state`、`shell/` |
| 3 | M2-core-meters | 核心（sonnet） | 量表、同名的效果與條件、存檔第 3 版 | `core/state`、`core/rules`、`shell/save.ts` |
| 4 | M2-core-battle | 核心（sonnet） | 候補與 `callIn`、先攻的優勢、到每個敵人的距離 | `core/battle` |
| 5 | M2-director | cpp-feature | 導演：觸發點、機率、冷卻、排序與上限、類型平衡、佇列 | `features/director`（新） |
| 6 | M2-event-run | cpp-feature | 事件視窗的執行器：選項、檢定、結果、多段與版本、內嵌事件 | `features/director` |
| 7 | M2-lewd | cpp-feature | 橋參數、傾向、豔名 | `features/lewd`（新） |
| 8 | M2-security | cpp-feature | 敵對值與好感、分段、消退、收買；掃橋 | `features/security`（新） |
| 9 | M2-npcs | cpp-feature | NPC 的資料、每區的名單、今天在哪、關係條目、登場角色 | `features/npcs`（新） |
| 10 | M2-npc-interact | cpp-feature | 互動選單：聊天、送禮、誘惑、交涉、威嚇、偷竊、讀橋 | `features/npcs` |
| 11 | M2-npc-life | cpp-feature | 共同記憶；NPC 自己的日子；名單的變動 | `features/npcs` |
| 12 | M2-favors | cpp-feature | 人情：欠你的與你欠的、給戰鬥裡人情池的數字 | `features/favors`（新） |
| 13 | M2-roster | cpp-feature | 名冊、招募、隊伍與同行、忠誠、出場費、候補 | `features/roster`（新） |
| 14 | M2-world | cpp-feature | 區、街區、橋接區、設施；在城裡走 | `features/world`（新） |
| 15 | M2-transit | cpp-feature | 公共交通：等車、搭車、每站、計程車 | `features/transit`（新） |
| 16 | M2-explore | cpp-feature | 現實面的探索：監視器、被看到、門鎖、巡邏、標記的用途、警戒 | `features/explore` |
| 17 | M2-enemy-encounter | cpp-feature | 照勢力與位階挑兵種；附屬單位的覆寫（獵犬）；俘虜 | `features/enemies` |
| 18 | M2-commission-run | cpp-feature | 副本本體：進去、階段、面、分支、現實面的一段、里程碑、連動、喘口氣、撤退 | `features/commission`（新） |
| 19 | M2-commission-aux | cpp-feature | 輔助面每個階段的結算、連動當場生效、出事 | `features/commission` |
| 20 | M2-commission-close | cpp-feature | 做完的結算：評價、路線的後果、歷練；戰敗接上委託失敗與回退 | `features/commission` |
| 21 | M2-fixer | cpp-feature | 接案、怎麼付、踩點、出發；街頭信譽 | `features/fixer`（新） |
| 22 | M2-fixer-pay | cpp-feature | 替輔助面請人的四種辦法、借人；入帳與分帳 | `features/fixer` |
| 23 | M2-commission-gen | cpp-feature | 照類型的模板生成一件具體的委託 | `features/fixer` |
| 24 | M2-defeat | cpp-feature | 戰敗事件的完整流程：選哪一件、版本、看不看、接受之後 | `features/defeat` |
| 25 | M2-scene | cpp-feature | 成人場景的最小可操作版 | `features/scene`（新） |
| 26 | M2-trade | cpp-feature | 商店、每天的清單、價格與拆解、購物車與結帳 | `features/trade`（新） |
| 27 | M2-market | cpp-feature | 區與區的價差、貨物、收購遞減、殺價 | `features/trade` |
| 28 | M2-bills | cpp-feature | 每週帳單：收與付、順序、欠繳的下坡 | `features/bills`（新） |
| 29 | M2-rest-housing | cpp-feature | 喘口氣、睡一覺、睡在哪；租房與退租 | `features/rest`（新） |
| 30 | M2-work | cpp-feature | 打工：一班的結算、階段、升階 | `features/work`（新） |
| 31 | M2-abilities-m2 | cpp-feature | 增援；夥伴的技能；名媛開打前的效果；情報網；換配置；人情池 | `features/abilities` |
| 32 | M2-data-rules | cpp-data | M2 的規則表（不含內容）與行動種類 | `engine/data/rules/` |
| 33 | M2-ui-world | cpp-ui | 街區圖與走路、城市地圖、搭車、事件視窗、掃橋 | `ui/` |
| 34 | M2-ui-commission | cpp-ui | 委託的四拍與副本接上引擎；技能配置讀引擎；階段的回退 | `ui/` |
| 35 | M2-ui-battle-after | cpp-ui | 戰敗事件與多出來的選項（被贖回）、戰利品、俘虜 | `ui/` |
| 36 | M2-ui-scene | cpp-ui | 成人場景的畫面接上引擎 | `ui/` |
| 37 | M2-ui-life | cpp-ui | 商店、帳單、打工、休息與住處 | `ui/` |
| 38 | M2-ui-people | cpp-ui | 這裡的人、說話與互動、關係、名冊、人情、換配置 | `ui/` |
| 39 | M2-smoke | 核心（sonnet） | 具名的情境、M2 的冒煙主幹、種子重播、test-harness 與不變式 | `testkit/`、`tests/smoke` |

dev/status.md 標了 M2 的待辦各落在哪一張：橋的換配置（31、38）；副本階段的快照與第二份重現（2、18、34）；名媛開打前的效果與豔名（7、31）；情報網（21、31）；戰利品與戰敗選項的介面（35）；委託頁讀引擎的技能配置（34）；附屬單位（獵犬）接上格式（17、23）；到每個敵人的距離由引擎給（4）；買到的東西進引擎的背包（26、37）；增援（4、13、31）；「每件委託」真正的 id（18、31）；人情的資料（12）；戰敗事件二十九種的分法（24，見下面第 1 項）。

## 相依

```
1 core-activity ─ 2 core-shell ─ 3 core-meters ─┬─ 7 lewd ── 25 scene
        │               │                       ├─ 8 security（要 6）── 15 transit（要 14）
        │               │                       ├─ 9 npcs（要 6）─ 10 ─ 11
        │               │                       ├─ 16 explore
        │               │                       └─ 26 trade ─ 27 market
        │               ├─ 28 bills（要 13）─ 29 rest-housing（要 14）
        │               └─ 18 commission-run（要 6、16、17）─ 19 ─ 20（最後一條要 24）
        ├─ 4 core-battle ─ 13 roster（要 3、9）
        ├─ 5 director ─ 6 event-run ─ 24 defeat、30 work、17 的俘虜
        └─ 14 world
12 favors：沒有依賴
21 fixer（要 3、18）─ 22 fixer-pay ─ 23 commission-gen（要 17）
31 abilities-m2：要 4；讀得到 12、13、21、9 最好
介面：33（要 14、15、6、8）─ 34（要 16～23、13）─ 35（要 24、17）─ 36（要 25）─ 37（要 26～30）─ 38（要 9～13、31）
32 data-rules、39 smoke：引擎的功能都做完之後
```

**不要同時做的**（改同一批檔）：1 與 2（`shell/game.ts`）；2 與 3（`core/state` 與存檔）；5、6；9、10、11；18、19、20；21、22、23；26、27；介面的六張彼此（都改 `stores/engine.ts`）；31 與任何還在改 `features/abilities` 的事。8 會碰 `features/gear`、28 會碰 `features/roster`，各只加一小段。

## 建議的順序（同時最多兩張）

| 步 | 甲 | 乙 |
|---|---|---|
| 一 | 1 core-activity | 12 favors |
| 二 | 2 core-shell | 4 core-battle |
| 三 | 3 core-meters | 5 director |
| 四 | 6 event-run | 7 lewd |
| 五 | 8 security | 9 npcs |
| 六 | 14 world | 10 npc-interact |
| 七 | 15 transit | 11 npc-life |
| 八 | 16 explore | 13 roster |
| 九 | 17 enemy-encounter | 33 ui-world |
| 十 | 18 commission-run | 26 trade |
| 十一 | 19 commission-aux | 27 market |
| 十二 | 20 commission-close | 24 defeat |
| 十三 | 21 fixer | 28 bills |
| 十四 | 22 fixer-pay | 25 scene |
| 十五 | 23 commission-gen | 29 rest-housing |
| 十六 | 30 work | 34 ui-commission |
| 十七 | 31 abilities-m2 | 35 ui-battle-after |
| 十八 | 32 data-rules | 36 ui-scene |
| 十九 | 39 smoke | 37 ui-life |
| 二十 | （審查與白箱的前半） | 38 ui-people |

- 第十二步兩張同時做：20 裡「接受戰敗 → 委託失敗 → 回退」先用測試自己發的 `activity.end` 驗，等 24 回來再補串起來的那一條。
- 第三步做完時核心的介面就定了。第 1～4 張回報「ADR 做不到」的地方，先回到 cpp-architect 改設計，再往下。
- 每一步兩張都回來、主套件全綠之後再開下一步。全部做完：一輪審查與白箱（重點：白名單的放行、`launch` 開不成的回滾、撤退與委託失敗的回退留下什麼、量表的夾值）、探針（導演一回合放行幾件）、邊界（帳單與價格的夾值）。

## 這一批刻意不做的

- **別的面**：內海與輿論的階段本身（M3、M5）。副本的格式三個面都收；沒有登記玩法的面玩家選不了，輔助面照樣擲。
- **委託**：護送「掛著要保護的人」、獵溺（溺感者與鎮溺隊的倒數）、另一隊邊緣行者、背刺檢查、附帶條件的檢查、委託直播的目標、輿論戰的開場表。
- **派工**（M5）：派名冊的人去踩點、去打工、每週的派工。
- **談判**：多輪的談判（AI 給選項）與長期折扣；M2 只有接案時的一輪交涉與怎麼付。
- **城市**：區域狀態（DOWNTIME 第 6 節）、橋接區被封、追逐、自己的車、要地（固定的多層地圖）、光線。
- **交易**：AI 的當日優惠、二手與同人與鑑定（M4）、服務的價錢（M4）、以物易物、黑市的進出與收贓、洗錢。
- **家園**：格子地圖、家具、儲物、住戶、訪客、店面、買斷、假身分租、搬家（M5）。
- **要 M4 的**：義體、調校、惡意韌體、契約、藥與成癮、治療與沉溺的消退、夜課的學習、多人分圈。
- **成人場景**：同步檔位、每回合的 AI（`scene_turn`、`scene_talk`）、`scene_gate`、收尾的五個 AI 任務、直播、內海的場景。
- **事件**：要地、子網與內海、契約指令、流竄 AI、吉祥物這五種範圍只收設定的格式；Agent 模式的鉤子與 AI 提出的事件；存檔規則的範圍倍率與成人比重；事件開頭由 AI 改寫。
- **帳單**：四個快捷的檔位（只有倍率）；鎖義體、簽契約只留觸發點。
- **NPC**：名字與外貌的素材（內容）、AI 寫的部分（`flavor_roster`、`npc_news`、`relate`）、請教、採訪、關係線、網內化身的身分合併。
- **內容**：事件、戰敗事件、委託的類型與詞條、打工、商店、NPC、區與路線、體位與夜課的資料都不匯入。

## 要使用者先定的事（每一項附建議）

1. **二十九種戰敗事件的分法**（ENEMIES 第 6、14 節；PLAN 5.2；0016 G5）。
   建議：清單照 ENEMIES 第 6 節那張表定案（含新的 `tuning`、`fed`、`drained`、`tinkered`、`taken`；DEFEAT_EVENTS 已經照它寫了六十件）。引擎不分種類：`kind` 只是標籤，每一種都用通用的事件格式（多段、選項、檢定、版本、篩選的替代）加封閉的效果清單寫。照「要用到哪些效果」分成五類，決定 M2 做到哪：

   | 類 | 種類 | M2 |
   |---|---|---|
   | 甲 罰與丟（錢、東西、時間、地點、名聲） | `police`、`lesson`、`robbed`、`stranded`、`afterparty`、`exposed`、`ransom`、`triage`、`handed_over` | 都做得出來（`exposed` 的公信力等 M5） |
   | 乙 關押的事件鏈（多段、檢定、被救或贖） | `arrest`、`pow`、`farm`、`debt_work`、`fed`、`pinned` | 做得出來；`pinned` 是內海的戰敗，M3 才會發生 |
   | 丙 身體被改 | `tuning`、`lab`、`chrome`、`stripped`、`unbridged`、`tinkered`、`bridge_lock`、`drained` | 橋參數、暫時的狀態、敵對值下限有；調校、拿走或換上義體、怪癖、容量減半等 M4 |
   | 丁 沉溺與污染 | `communion`、`spread`、`polluted`、`quarantine` | 沉溺與暫時的習慣有；惡意韌體與療程等 M4 |
   | 戊 契約與長線 | `contract`、`taken` | 等 M4（契約）與任務線的內容；M2 只有旗標與時間 |

   在正式內容匯入之前，示意資料照舊只有一筆 `df_generic`。
2. **成人場景最小可操作版做哪些操作**（LEWD_SYSTEM 3.5；0016 G6）。
   建議：一對一（一圈兩個人）；十種行動做九種：主導、迎合、挑逗、克制、說話、切換體位（三個基本體位，其餘吃資料）、道具、技能、停下。**技能只做機制**（連接、持續的數值、部位，吃 DATA 3.1 的 `scene` 欄位），夜課的學習留到 M4；所以 M2 實際玩起來，連接靠說話與道具建立。換檔（同步檔位）留到 M3 和同步原則一起做。
3. **成人場景的 AI 接到哪**（AI_TASKS 3.5～3.8）。
   建議：M2 只接結束後整場的正文（`narrate`，成人路由）。進不進場景照資料（`gate: fixed` 進；`gate: ai` 的照設計書「AI 關閉時當成 fixed」處理），進之前一律有確認框可以略過；對方的行動、說話的判定、沉溺與關係的結算走規則的退路（0016 G11）。`scene_gate`、`scene_turn`、`scene_talk` 與收尾的五個任務和夜課一起排 M4。
4. **M2 的委託做到哪**（COMMISSIONS 第 7 節；MIGRATION「先只有現實面」）。
   建議：只會生成「每個階段都有現實面可選」的委託（主面是現實的那十型）。決定性的一步做四種：打倒目標、拿到東西帶出去（含把人帶出來）、一次動手的檢定、一場有目的的成人場景（蜜罐、接待）。護送的掛人與獵溺延後。輔助面三個面都可以派人（只是擲骰）。
5. **介面接上引擎之後，城市、商店、委託的示意內容從哪來**。引擎不再匯入內容，`engine/data` 沒有區、店、事件與委託；照現在的規則，接完之後畫面是空的。
   建議：介面把自己現有的假資料（`ui/src/data/`）整理成一份「示意世界包」（放 `ui/src/data/demo/`），開新局時經 `Game` 的 `content` 載入，不放進 `engine/data`；正式內容匯入時整包換掉。這件事分在介面的六張工單裡各做各的那一塊；測試不用它（測試照舊自帶最小假資料）。
6. **換技能配置花多久**（0016 G1）：CORE_RULES 6.4 與 DOWNTIME 第 1 節寫一小時，UI 8.3 的示意與 SKILLS 1.7 是「織女 標準：半小時」。
   建議：引擎做成衍生數值，M2 先照 UI 8.3 給半小時；並把 CORE_RULES 6.4 改成「一般一小時、織女 標準半小時」，M4 橋的型號接上後照型號。
7. **談判、互動、打聽**（MIGRATION D 組的 `negotiation`、`interactions`、`askAround`）沒有排進任何一批。
   建議：互動與打聽跟 J（NPC）在 M2 做；多輪的談判等 AI 的 `npc_act`（排 M4 或 M5），M2 接案只有一輪交涉（0016 G18）與怎麼付。
8. **派工的延伸**：FIXER 第 2 節「名冊上的人可以替你踩點」、DOWNTIME 4.3「派別人去打工」都算派工，而派工排在 M5。
   建議：M2 不做，介面上那兩個選項灰掉並寫「還沒有開放。」。
9. **事件的範圍 M2 做哪幾種**（EVENTS 第 4 節）。
   建議：街頭、交通、委託副本內、家園（只有休息與回到住處兩個觸發點）、打工、成人事件（其實是別的範圍裡帶標籤的模板）。要地、子網與內海、契約指令、流竄 AI、吉祥物只收設定。
10. **人在副本裡時跨過週一，帳單怎麼辦**（0016 G3）。建議：延到出副本之後結算。
11. **夥伴會哪些技能**（0016 G4）。建議：路數那棵樹、階數以內的全部，不看容量。
12. **其餘的暫定值**（0016 G7～G18）：先攻擲兩次取高、走一格一分鐘、警戒 100 最後一階段升一級、豔名每 25 點 −1、場景結算的退路值、副本裡可以自由行動、俘虜當場處置、慾求的開戰感載、打工由程式判定、委託的評價與加成、假身分怎麼擲、接案的一輪交涉。建議都先照表，平衡時一起看。
13. **文件要補的兩處**：SERIES 第 6 節「每個階段算幾小時還沒定」改成照 COMMISSIONS 6.2 的 2 小時；EVENTS 第 7 節與 DATA 第 4 節樣本的效果用陣列寫（`["cash", 300]`），引擎收的是物件（`{ kind: 'cash', amount: 300 }`），建議在 DATA 第 4 節註明陣列是簡寫、匯入時轉。
