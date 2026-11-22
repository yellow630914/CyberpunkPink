# M1 第二波：批次計畫

- 寫的人：cpp-architect（2026-11-22）。設計在 dev/adr/0015；這一份是工單的清單、相依與順序。
- 範圍：只做**機制**（格式、效果的鍵、掛點、畫面），不匯入內容。`engine/data/` 的內容類（名冊、技能、物品）維持原樣；規則表（戰鬥中的狀態）照常補。
- 這一波的工單**沒有預先寫好的驗收測試**：每一張列的是「驗收條件」，做的人自己寫成測試，內容資料一律用測試自帶的最小假資料（不讀 `engine/data` 的內容類），放在工單指定的路徑，直接進主套件。
- 每一張都不 commit（總指揮統一做）；做完跑 `npm test`、`npx tsc --noEmit`（介面的跑 `ui/` 的 `npm test` 與 `vue-tsc`）。

## 工單

| # | 工單 | 交給 | 做什麼 | 主要動到 |
|---|---|---|---|---|
| 1 | M1b-core-effects | cpp-feature（核心） | 效果的登錄表、公式、攻擊與退出的攔截點、救回來、回復的來源、檢定的標籤與掛點、AI 挑目標的權重、先攻對調、花費的標籤 | `core/battle`、`core/types` |
| 2 | M1b-core-overlay | cpp-feature（核心） | 每一輪開頭的掛點；沒有操作者的無人機與砲塔、自己開火；義體在戰鬥裡的清單與失效、超頻 | `core/battle`、`core/types`、`features/summons` |
| 3 | M1b-data-rules | cpp-data | 規則表：義體失效與超頻、少一點行動點、不受黑暗、不被當成目標這幾個狀態 | `engine/data/rules/battle_statuses.json` |
| 4 | M1b-ops | cpp-feature | 通用的效果二十幾個（攻擊、傷害、感載、回復、狀態、推拉、遮蔽、行動點、彈匣、義體、救回來、重創……） | `features/combat` |
| 5 | M1b-ordnance | cpp-feature | 武器的附帶效果（燃燒、義體失效、卡彈、炸膛）、特殊彈、投擲物、立牌與紙鶴 | `features/combat` |
| 6 | M1b-skill-format | cpp-feature | 技能格式的通則：條件、效果清單、被動的修正、姿態、反應、照戰場分的消耗、錢與人情、每件委託、預備（1 時段） | `features/abilities` |
| 7 | M1b-skill-gunner-broker | cpp-feature | 槍手與掮客現在標 `pending` 的技能要的專屬機制（戰鬥直覺的分配、守著一格、範圍壓制、被贖回……） | `features/abilities`、`features/defeat` |
| 8 | M1b-skill-pilot | cpp-feature | 機師：技能叫無人機做事的效果、擋槍、改無人機數字的被動（不含機甲） | `features/summons`、`features/abilities` |
| 9 | M1b-skill-medic | cpp-feature | 改造師：手術刀、治療加值、拆解與超頻、拉回來、擋下倒下與過載 | `features/abilities`、`features/combat` |
| 10 | M1b-hack | cpp-feature | 新功能 `hack`：甲板與 RAM、快駭程式、快駭的檢定、接管、控制節點、腳本；潛網者的現實面 | `features/hack`（新） |
| 11 | M1b-skill-social | cpp-feature | 名媛：面具、誘惑攻擊、替身；主播與偶像只有「學得到、裝得上、現實沒有效果」的檢查 | `features/abilities` |
| 12 | M1b-enemy-moves | cpp-feature | 敵人的招牌行動（和技能同一套）、低血大招、AI 的分數；特徵、沉溺、義體、甲板、天使急救的格式與效果 | `features/abilities`、`features/enemies` |
| 13 | M1b-enemy-units | cpp-feature | 敵方的無人機與砲塔、附屬單位、會指揮的敵人；沒有操作者的每一輪自己動；機甲只收格式 | `features/enemies`、`features/summons` |
| 14 | M1b-loot | cpp-feature | 掉落的格式與打贏之後的結算 | `features/enemies` |
| 15 | M1b-ui-gear | cpp-ui | 「裝備」分頁與背包讀引擎 | `ui/` |
| 16 | M1b-ui-skills | cpp-ui | 技能樹與「橋」分頁讀引擎 | `ui/` |

全部用 sonnet。第 1、2 張改的是核心（`coreDirs`）：設計已經寫死在 dev/adr/0015，派工時要明說這一張可以改核心。

## 相依

```
1 core-effects ─┬─ 2 core-overlay ─┬─ 8 pilot ── 13 enemy-units
                │                  ├─ 10 hack
                │                  └─ 9 medic（義體）
                ├─ 3 data-rules（其中兩個狀態）
                └─ 4 ops ─┬─ 5 ordnance
                          └─ 6 skill-format ─┬─ 7 gunner-broker
                                             ├─ 8 pilot
                                             ├─ 9 medic
                                             ├─ 10 hack（驗整棵樹）
                                             ├─ 11 social
                                             └─ 12 enemy-moves ── 13 enemy-units
14 loot：只靠現有的敵人功能（「被帶走」的標記在 12；測試可以直接給）
15、16：只靠已經做完的 gear、abilities
```

**不要同時做的**（會改同一批檔）：1 與 2（`run.ts`）；4、5、9 當中碰 `features/combat` 的兩張；6、7、8、9、11、12（都改 `features/abilities`，排成一串）；8 與 13（`features/summons`）；12、13、14（`features/enemies`）；15 與 16（`CharacterDialog.vue`、`stores/engine.ts`）。

## 建議的順序（同時最多兩張）

| 步 | 甲 | 乙 |
|---|---|---|
| 一 | 1 core-effects | 15 ui-gear |
| 二 | 2 core-overlay | 3 data-rules |
| 三 | 4 ops | 16 ui-skills |
| 四 | 6 skill-format | 5 ordnance |
| 五 | 7 skill-gunner-broker | 10 hack |
| 六 | 8 skill-pilot | 14 loot |
| 七 | 12 enemy-moves | （空著；可以排這一波前半的審查或白箱） |
| 八 | 9 skill-medic | 13 enemy-units |
| 九 | 11 skill-social | 收尾：10 的接管（等 8 的 `drone.act`）、13 的範圍投擲、16 的預備按鈕這幾條留下的 `it.todo` |

每一步兩張都回來、主套件全綠之後再開下一步。第二步做完時核心的介面就定了：這時候如果第 1、2 張回報「ADR 做不到」的地方，先回到 cpp-architect 改設計，再往下。

做完之後：一輪審查與白箱（重點是 `run.effects`、替身、`out.before` 與 `revive` 對戰鬥結束判定的影響）、冒煙補一條「帶著技能、特殊彈、敵方無人機打完一場」、種子重播的固定檔重錄。

## 這一波刻意不做的

- **機甲**（M6）：機師樹裡整個效果都要機甲的技能留 `pending`；敵人的機甲只收格式（dev/adr/0015 E12）。
- **要 M2 的**：名冊的人進場（增援）、開打前的滲透與被識破（偽裝、讀人、假身分）、豔名、追蹤度與敵對值、俘虜的處置、警戒與增援、「每件委託」真正的委託 id、人情的資料。
- **要 M4 的**：主角自己的義體與甲板（在那之前只有測試與敵人資料給得出來）、拆下來的義體變成戰利品、授權鎖與殘響、藥的成癮、手術與解剖。
- **內容**：名冊兩百多個招牌行動的敘述、掉落的敘述、六棵技能樹的資料、物品目錄，都等潤色後經世界編輯器匯入。現有的示意資料裡槍手與掮客的三十八個 `pending` 這一波也不改（見下面第 8 點）。
- 溺感者的過線、「把自律的無人機搶過來」、義眼超頻（遮蔽當成低一級）的狀態。

## 要使用者決定的

細節與每一項引擎先照哪一邊在 dev/adr/0015 第四節（E1～E13）。最要緊的：

1. **設計書兩處對不上（E6）**：操作者倒下時，COMBAT_SYSTEM 9.1 說無人機全部停機，ENEMIES 第 10 節說進入自律模式（命中 −2、不移動、機師可以搶過來），而且 ENEMIES 說兩處「是同一條」。先照：我方停機、敵方自律。
2. **二選一的消耗怎麼讀（E1）**：「2 行，或 1 編」先讀成照戰場（現實花行動點、輿論花編輯點），不是玩家當場選。
3. **現實裡目標的防火牆（E5）**：設計書只有甲板的數字（10）與網內敵人的（等於迴避）。先照：有甲板用甲板的，沒有的用不含遮蔽的迴避。
4. **開戰時擲特徵的機率（E10）**：「基準 30%，要地與首領更高」沒有數字；而且隨機的特徵會動到平衡的基準。先照：擲兩次各 30%（首領 50%），基準遭遇不擲。
5. **「八棵樹的現實面都算 M1」和「機甲在 M6」**（MIGRATION 第 6 節）：機師樹有六個技能（同步衝刺、神經硬化、遠端火力、共鳴駕駛、女武神、人機一體）與第 3 階的共鳴整個效果都要機甲，另外四個技能有一半要機甲，M1 做不出來。確認這些留到 M6 可以接受。
6. **大局「馬上行動」（E7）**、**護盾型無人機「擋下一次攻擊」怎麼觸發**（COMBAT_SYSTEM 9.1 沒寫；先照：指揮它一次，替同一格的人擋下一次）、**只有裝著編隊的人連得住無人機**（現在引擎是有無人機就能用，先不擋）。
7. **橋的換配置**：UI.md 8.3 寫「在據點或調校診所，花半小時」，引擎現在不限地點、不花時間（M1 第一波定的）。介面這一波照引擎；要照設計書的話是 M2（有據點之後）的一張小工單。
8. **示意資料要不要跟著換鍵**：機制做完之後，`engine/data/rules/abilities.json` 裡槍手與掮客的三十八個技能還是 `pending`（內容不再匯入）。要讓這兩棵樹在遊戲裡真的動起來，得讓 cpp-data 把這份示意資料照新的鍵改寫一次；算不算「匯入新內容」請決定。
9. **核心的工單交給 sonnet**：dev/project.md 寫核心只有 cpp-architect 能改，新的分工又寫「照說明改程式一律派 cpp-feature」。第 1、2 張照後者開；派工時要明說，並確認守門的設定不會擋。
