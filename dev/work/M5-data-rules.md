# M5-data-rules

- 交給：cpp-data（sonnet）
- 目標：把 M5 各功能寫在程式裡的規則預設（`DEFAULT_…`）落成 `engine/data/rules/` 的資料檔，逐筆和設計書與功能的預設對得上；不匯入任何內容。
- 規格出處：MEDIA 第 1～5、9、13 節的每一張表與算式；OPINION 第 3～5 節；EVENTS 3.3 節（直播那一列）、2.4 節；DOWNTIME 第 4.1b、7 節的每一張表；FIXER 第 7 節；DATA 第 1 節（共通的約定、id 表）、6.3、9.1、9.2、第 11 節；dev/adr/0020 第十三節（內容種類的清單，哪些是規則、哪些是內容）、第十五節（V 編號的暫定值）；dev/adr/0017（規則表可以被取代）；各功能工單的「新的格式與鍵」與它們的完成回報；dev/work/M3-data-rules.md（上一批的做法）。
- 可以改的路徑：`engine/data/rules/`、`engine/data/index.ts`、`engine/tests/data/M5-data-rules.test.ts`（既有的資料測試只在「多了欄位」而要改時改，列在回報）。
- 可以用的介面：每個功能匯出的 `DEFAULT_…` 與檢查函式（測試可以 import 功能來比對；資料檔本身不 import）；`k.content.validate`。
- 不可以做的事：不改 `engine/src/`；不寫內容（議題、公關對手、直播目標、住處、家具、具名的牌、店面的事件都不寫；介面要的示意資料在 `ui/src/data/demo/`）；數字不自己調：設計書有的照設計書，設計書沒有的照功能的預設（那就是 0020 的暫定值），兩邊不一樣時停下來回報；共同的規定見 dev/work/M5-plan.md。

## 要寫的檔（一個內容種類一個檔；檔名照現有的複數寫法）

| 檔 | 內容種類 | 裡面有什麼 | 出處 |
|---|---|---|---|
| `media_rules.json` | `media_rule` | 來源對類型的預設、品質的每一項、紀錄放多久算舊、新鮮度、三次；剪片的時間；上架、賣斷、談判、保命符、偽造的數字 | MEDIA 1.1、第 2、3、5 節；V4～V11 |
| `footage_angles.json` | `footage_angle` | 七種角度：適用的類型、三個修正、進牌庫是哪一種、上架的範本 | MEDIA 第 3 節的兩張表；OPINION 4.3a |
| `channel_rules.json` | `channel_rule` | 新頻道的訂閱、流失、自然成長、額度、超領、等級的門檻；成人檔三段；評價表；廣告與打賞；料的加成；設備的上限；薪水 | MEDIA 4.1～4.6、4.8；V12～V18 |
| `shows.json` | `show` | 六筆：現場、專題、八卦、雜談、公演、獨家 | MEDIA 4.3、4.3a |
| `live_rules.json` | `live_rule` | 收播的換算、觀看數、級距、成人直播；時段直播的四種、難度、結果換熱度、標籤、方向 | MEDIA 1.2、1.3；V24、V25、V27 |
| `stream_templates.json` | `stream_template` | 三筆（戰鬥、副本、成人）；第三波做了的話加迷宮館與簾後館兩筆 | MEDIA 1.2 的表；DATA 第 11 節 |
| `social_rules.json` | `social_rule` | 發文的算式每一項、每週、動態牆的基數與來源對照 | MEDIA 第 13 節 |
| `opinion_rules.json` | `opinion_rule` | 回合、手牌、編輯點、防守、範圍、結果的門檻、等級的加成、拆穿、找上門、收買、外包、後果的表、格子的加成 | OPINION 第 3～6、9 節；V33～V41 |
| `topic_kinds.json` | `topic_kind` | 五種議題的開場與勝利條件；四列預設的分數 | OPINION 3.2、5.1 |
| `pr_actions.json` | `pr_action` | 對手的九種行動 | OPINION 5.2 |
| `opinion_cards.json` | `opinion_card` | 基本牌九張與內幕牌 | OPINION 4.3；V34 |
| `city_cards.json` | `city_card` | 六張城市事件 | OPINION 5.3；V34 |
| `idol_rules.json` | `idol_rule` | 親衛隊的門檻與次數、做過頭、握手會、人氣的漲跌 | MEDIA 第 9 節；V42、V43 |
| `away_rules.json`、`away_jobs.json` | `away_rule`、`away_job` | 第二波：算式、錢的表、出事；五種 | FIXER 第 7 節；V44、V45 |
| `home_rules.json`、`home_mods.json`、`staff_jobs.json`、`shop_kinds.json` | `home_rule`、`home_mod`、`staff_job`、`shop_kind` | 第二波：買斷、押金、搬家、升級、上限、用途、舒適度、套組、同居與訪客的 DC、上門的式子、營收的式子；五種改裝；六種家務；五種店面 | DOWNTIME 第 7 節、4.1b；V46～V51 |
| 既有的檔加欄位 | `commission_rule`、`fixer_rule`、`netcombat_rule`、`event_scope`、`event_rule`、`facility_type`、`rest_rule`、`curtain_rule`、`maze_rule` | 委託的輿論欄位（M5-commission-opinion 的 `DEFAULT_OPINION_RULES`）；中間人的輿論欄位；圍觀的減值；`event_scopes.json` **現在沒有**直播與頻道兩個範圍：加 `live`（`live_mid`）與 `channel`（`episode`、`channel_week`），`home` 那一列現在只有 `home`、`rest`，補 `weekly`；`startable: ['opinion']`；設施的種類加 `edit`、`stage`、`no_rec` 三個欄位的示範值（轉播站 `edit`、舞台與劇場 `stage`）；第二波：`rest_rules.json` 裡住處的三個鍵（`deposit_weeks`、`lock_weeks`、`rent_order`）照 M5-home-base 實際搬的搬到 `home_rules.json`，睡一覺的回復率（`home_rates`）留在 `rest_rules.json`；第三波：`curtain_rules.json` 加 `heat.live`、`live_tips_mult` 與檔期榜的 `board`（M5-live-houses、M5-curtain-board），`maze_rules.json` 加觀看數級距的門檻 | 各工單；EVENTS 3.3；V16、V20、V56、V60 |

- 第二波沒做的話，表裡標「第二波」的檔不寫；第三波沒做的話 `stream_templates.json` 只有三筆。
- `engine/data/index.ts`：把新檔接進規則包；暫定的值（設計書沒有、照 0020 的 V 編號）照 M3 的做法列在一個 `PROVISIONAL_M5` 的清單（檔名、鍵、V 編號），讓平衡的 session 找得到。

## 驗收條件（`engine/tests/data/M5-data-rules.test.ts`）

- 每一個檔載入之後過那個內容種類的檢查（用全部功能的 kernel）。
- 每一個規則的內容種類：資料載入之後讀出來的規則，和功能的 `DEFAULT_…` 逐鍵相等（不相等的要嘛是設計書有明寫而預設寫錯——回報，要嘛是資料寫錯——改資料）。
- 抽查設計書的數字（每一張表至少一格）：七種角度的修正、成人檔三段的倍率、評價表四列、時段直播的難度四段與熱度、發文的五個比例、防守 2 與 3、公關點 = 強度 × 2、舒適度三段、上門式子的三個係數、店面五種的基礎營收與裝潢。
- 五種議題與四列分數：每一列九格、0～3、總分 10～12。
- `pr_actions` 的 id 和 OPINION 5.2 的九種一一對上；`shows` 六筆；`footage_angles` 七筆；`city_cards` 六筆。
- `event_scopes` 有 `channel` 與 `live` 兩列，觸發點的名字是 `episode`、`channel_week`、`live_mid`；`home` 那一列有 `weekly`。
- 規則表裡每一個 `tags`（節目、時段直播的四種、房間的用途、店面的種類）都在核心的 `CONTENT_TAGS` 裡。
- 引用勢力的格子（人偶館的伊甸園與蜜糖會、家務的派遣公司）在 testkit 的 `dataRules`（M4 收尾修正批讓它濾掉查不到的勢力）底下載得起來。
- `PROVISIONAL_M5` 列的每一個鍵在資料裡都找得到。
- 把這一批的規則包拿掉，功能照自己的預設跑，結果相同（挑三個功能各跑一個固定種子的小流程比對）。
- 既有的資料測試全過（改了的列出來）；`npm test`、`npx tsc --noEmit` 全過。

## M4 對帳（2026-11-26）

- **做法照 M4-data-rules**：一個內容種類一個檔、數字等於功能匯出的 `DEFAULT_…`、暫定的格子列進 `PROVISIONAL_M5`（`engine/data/index.ts` 現在有 `PROVISIONAL`、`PROVISIONAL_M3`、`PROVISIONAL_M4` 三張，接在後面）。
- **不要和既有的檔撞名**：`shop_types.json` 是 `trade` 的商店種類（M2），店面五種的檔叫 `shop_kinds.json`；`curtain_rules.json`、`maze_rules.json`、`event_scopes.json`、`rest_rules.json` 是加欄位，不是新檔。
- **0020「M4 對帳」多出來的暫定值**（V56～V66 裡有數字的：內場直播的倍率、內場帶的品質、檔期榜、成人時段直播每小時幾回合、自己的店的階段門檻、契約人的派工）跟著各自的工單寫進規則表，一樣列進 `PROVISIONAL_M5`。
- 多出來的三張工單（M5-contract-link、M5-home-links、M5-curtain-board）如果加了規則的鍵，這一張一起補。

## 依賴

引擎的功能都做完之後（做到哪一波寫到哪一波）。

## 完成時回報

寫了哪些檔、測試結果、資料與功能的預設不一樣的地方各是誰錯、設計書的數字和 0020 的暫定值衝突的地方、`PROVISIONAL_M5` 的清單（給平衡的 session）。
