# 委託模板

> 上層：[COMMISSIONS](../systems/COMMISSIONS.md)（三個面、階段、主面與輔助面、類型、生成）；資料：[DATA](../systems/DATA.md) 第 9 節。L4 的內容，數字待平衡。

十九種委託類型的模板與詞條，加上現實面的地圖模板、輿論的議題模板與委託系列的範例。生成一般委託時，程式拿這些模板套上委託人、目標勢力、地圖、議題與詞條（COMMISSIONS 7.2、9 節）。

這份是 `data/rules/commission_types.json`（十九筆模板）與詞條表的設計稿。模板照 COMMISSIONS（docs/systems/COMMISSIONS.md） 第 7、7.1、7.2 節為準展開；生成時程式拿模板，再套上委託人、目標勢力、現實面的地圖、內海的參數、議題與詞條（COMMISSIONS 第 9 節），做出一件具體的副本（COMMISSIONS 第 11 節的格式）。所有登場的人都是成年人；戰鬥中沒有人會死，敵人被打倒是重傷、失去意識。

## 十九種類型的模板

### 共通的約定

十九種模板都照這一節寫，各類型底下只寫和這一節不同的地方。

#### 階段表怎麼讀

- 每種類型寫一張五列的階段表。**小型**用第 1、2、★ 三列；**中型**用第 1、2a、2、★ 四列；**大型**五列都用。多出來的 2a、2b 插在第二階段的前後，是那一型的變化：多一道門、多一層子網、中途出了狀況（COMMISSIONS 7.1 節）。
- **★** 是決定性的一步，只有主面可選，沒有輔助面。
- 「可選的面」是模板的預設；詞條可以把非決定性、非必經的階段鎖成只有一面（見「詞條」一段的共通規則）。
- 每一面都有**強攻**分支，表上不另寫。表上列的是強攻以外常見的分支，以及做完這一面給的連動（`gives`）。分支的種類照 COMMISSIONS 2.3 節：潛行、交涉、連動開出來的路、踩點開出來的路。
- 副本直播中不能選潛行分支（MEDIA 1.2 節）。

#### 遭遇的寫法

照 ENEMIES 第 13 節的點數（雜兵 1、精英 2.5、首領 5、載具與重型無人機 3、機甲 2.5、小型無人機 0.5）：

| 寫法 | 預算 | 用在 |
|---|---|---|
| 一般 | 3 ＋ 等級 | 一段探索加一場遭遇 |
| 輕 | 一般 − 2 | 這一段主要是檢定，遭遇只是保險 |
| 重 | 一般 ＋ 1.5 | 敵人的主場、或前面強攻過 |
| 首領戰 | 7 ＋ 等級 | 決定性的一步，或大型的中段高潮 |
| 無 | 0 | 這一段只有檢定或場景 |

- 隊伍少於四人時每少一人 −1.5；敵人的等級在副本的等級 ±1 之內；首領只在那個勢力範圍的最高兩級出現（ENEMIES 1.6 節），等級不夠時首領戰改成「兩個精英加兩個雜兵」，點數照算。
- 內海的遭遇用同一套點數，蕾絲照位階算點。
- 警戒到 60：增援（預算的一半）加入下一場遭遇；到 100：目標轉移或逃走，最後一個階段的預算 +2（ENEMIES 第 13 節）。

#### 分支檢定的 DC（本稿補的規則）

模板裡的分支檢定寫「標準 DC」，照副本的等級換成五個 DC 之一：

| 等級 | I | II | III | IV | V |
|---|---|---|---|---|---|
| 標準 DC | 10 | 13 | 16 | 19 | 22 |

- 「低一檔」「高一檔」是往左、往右移一格（最低 10、最高 22）。
- 分支的進入門檻另寫成基本功的級數（例：「隱匿 3 級」），和 COMMISSIONS 第 11 節的 `need` 一樣。
- 輔助面的結算照舊用 COMMISSIONS 6.4 節的公式，不用這張表。

#### 共用的連動

各類型的表直接引用這些 id；類型特有的連動寫在那一型底下。

| id | 名稱 | 種類 | 效果 |
|---|---|---|---|
| `located` | 定位目標 | 代勞 | 下一個現實階段不必探索，直接到遭遇 |
| `cams_off` | 關掉監視器 | 減壓 | 下一個現實階段警戒的上漲減半 |
| `doors_unlocked` | 接管控制節點 | 代勞 | 下一個現實階段不必探索；開門、停砲塔、放下防爆門（NETRUNNING 第 4 節） |
| `shift_rigged` | 竄改班表 | 減壓 | 下一個現實階段遭遇預算 −1.5；警戒 60 的增援延後一個階段 |
| `power_cut` | 切斷電力或網路 | 減壓 | 後面的內海階段蕾絲降一級，追蹤度的上升減半 |
| `airgap_open` | 開啟隔離區 | 開路 | 隔離區打開，內海的決定性階段做得了 |
| `admin_cred` | 管理憑證（活捉主管） | 開路 | 內海階段多一條連動分支：閘門不用破解，略過那一層的遭遇 |
| `staff_cred` | 員工憑證 | 開路 | 下一個階段（現實或內海）多一條偽裝成員工的分支，表演或介面標準 DC 低一檔 |
| `keycard` | 門禁卡 | 開路 | 下一個現實階段多一條「刷卡進去」的分支，不擲 |
| `floor_reached` | 到達目標樓層 | 代勞 | 下一個現實階段不必探索 |
| `guard_turned` | 收買或說動一個守衛 | 減壓 | 下一場現實遭遇少一個精英（換成一個雜兵） |
| `escape_route` | 撤離路線 | 減壓 | 決定性階段的遭遇預算 −2 |
| `inside_mail` | 內部消息 | → 輿論 | 牌庫多一張「內幕」（聲量 +4，對手不能下架） |
| `live_footage` | 現場畫面或實體文件 | → 輿論 | 開場聲量 +3，或牌庫多一張高數字的料（玩家選） |
| `platform_hacked` | 駭進平台 | → 輿論 | 開場就佔著主流那一排的一格（不能是萬華鏡當對手時的中央） |
| `bought_slot` | 買來的版面 | → 輿論 | 開場佔著一格；或對手第一回合少 2 點公關點 |
| `op_minor` | 輿論小勝 | 減壓 | 下一個現實階段有圍觀與記者：敵方不用 `lethal`，人群算半掩，警戒每次上漲 +5 |
| `op_major` | 輿論大勝 | 減壓＋開路 | 下一個現實階段保全被禁止用致命手段，多一條「內應開門」的分支；後面的內海階段追蹤度起始 −15 |
| `op_lost` | 輿論敗 | 麻煩 | 後面的現實階段警戒起始 +15；對手的敵對值 +1 |
| `decoy_news` | 假消息調虎離山 | 減壓 | 下一個現實階段警戒不上升；或警戒 60 的增援去了錯的地方（不來） |

前面打的短輿論戰，結果照 OPINION 第 6 節換成 `op_major`、`op_minor`、`op_lost` 其中之一；平手什麼都不給。

#### 附帶條件

簡報開出的附帶條件從這張表裡挑，每件 0～2 個（小型最多 1 個）。

| id | 名稱 | 怎樣算違反 | 常見於 |
|---|---|---|---|
| `no_kill` | 不准動實彈 | 隊伍用實彈打倒任何人（快感、神經、電磁打倒的不算） | 救援、挖角、獵溺、護送 |
| `no_trace` | 不准留痕跡 | 警戒到 60，或追蹤度到 60，或留下目擊者的旗標 | 竊密、抹除、竄改、暗殺 |
| `no_exposure` | 不准曝光 | 有人拍到隊伍的臉（萬華鏡的狗仔、直播被發現、`exposed` 的戰敗事件），或開了副本直播 | 蜜罐、接待、滅火、心智 |
| `alive` | 要活的、要完好 | 目標的生命掉到 0（被實彈打倒），或目標在戰鬥中受了重傷 | 挖角、救援、獵溺、討債 |
| `intact` | 東西要完整 | 目標物受到範圍攻擊或爆炸的傷害 | 奪取、網內打撈 |
| `no_collateral` | 不准傷到旁人 | 打倒任何不屬於目標勢力的人（平民、賓客、家人） | 破壞、討債、暗殺 |
| `make_it_public` | 要做給人看 | 決定性的一步不是在公開的地圖、或沒有人目擊 | 暗殺、破壞、抹黑 |
| `no_copy` | 不准留副本 | 隊伍私留了這一趟拿到的資料或素材 | 竊密、竄改、網內打撈、滅火 |
| `on_record` | 全程錄下來 | 決定性的一步沒有被錄到（要有錄影義體，或開了副本直播） | 爆料、蜜罐、破壞 |
| `client_rules` | 照客人的規矩 | 成人場景裡做了客人說不要的那一類行動 | 接待 |

- 附帶條件寫在簡報裡，談判時可以拿掉一個，換報酬 −15%。
- 違反附帶條件不會讓委託失敗，只影響報酬與評價（下一節）。

#### 報酬的公式（本稿把 LIFE 1.3 節寫成算式）

```
個人報酬 = 基準[等級] × 規模係數 × 類型係數 × (1 + 0.15 × 做到的附帶條件數 − 0.25 × 違反的附帶條件數)
基準：I 400、II 1,200、III 4,000、IV 13,000、V 40,000（LIFE 1.3 節：一件中型委託的個人收入）
規模係數：小 0.6、中 1.0、大 1.8
全隊報酬 = 個人報酬 × 分紅的份數（LIFE 1.3 節；主角當老闆多拿一份）
```

| 等級 | 小（×0.6） | 中（×1.0） | 大（×1.8） |
|---|---|---|---|
| I | 240 | 400 | 720 |
| II | 720 | 1,200 | 2,160 |
| III | 2,400 | 4,000 | 7,200 |
| IV | 7,800 | 13,000 | 23,400 |
| V | 24,000 | 40,000 | 72,000 |

- 上表是類型係數 1.0、沒有附帶條件時的個人報酬。乘出來的數字四捨五入到十位。
- 歷練點照規模固定給：小 20、中 35、大 60（CORE_RULES 7.1 節），主角與每個一起出門的夥伴各一份。
- 輔助面的人另外付（COMMISSIONS 6.5 節），不從全隊報酬裡扣。
- 預付款、裝備補助在接案時談判（FIXER 第 2 節）；預付款最多三成，撤退與委託失敗時要退。
- 委託人是流竄 AI 時，報酬換成牠那一種的東西（構裝、V 級零件的線索、沉溺相關的物品），數值照同一張表換算。

#### 戰敗的寫法

- `faction_default`：用目標勢力的預設（ENEMIES 8.1 節）；被非人形的機器打倒時，走機器所屬勢力的預設。
- `fails_commission` 預設是 `true`：戰敗 → 戰敗事件 → 委託失敗 → 回退到進副本之前，紀錄、性經歷與記憶保留。`polluted` 與 `robbed` 預設是 `false`，醒在這個階段的開頭（ENEMIES 第 6 節）。
- 輿論戰沒有戰敗事件。決定性的輿論戰打成平手或敗，就是沒做完最後一個階段，委託失敗、回退。
- 戰敗事件照主角的體型走 `default`／`masc`／`yuri` 三版，細項篩選照常。

#### 直播目標的共用清單

副本直播的目標寫在副本裡（MEDIA 1.2 節）。下面是十九種共用的；各類型另有自己的，寫在那一型底下。格式照 DATA 9.2 節。

```json
{ "id": "goal_no_one_down", "text": "沒有任何一個隊友倒下。", "scope": ["combat", "commission"],
  "check": { "event": "ally_down", "count_max": 0 }, "heat": 3, "tip_per_grade": 150 }
{ "id": "goal_two_crits", "text": "整趟打出兩次以上的要害。", "scope": ["combat", "commission"],
  "check": { "event": "crit", "count_min": 2 }, "heat": 3, "tip_per_grade": 120 }
{ "id": "goal_alert_under_60", "text": "整趟警戒沒有到 60。", "scope": ["commission"],
  "check": { "event": "alert_reach", "value": 60, "count_max": 0 }, "heat": 3, "tip_per_grade": 180 }
{ "id": "goal_trace_under_30", "text": "整趟追蹤度沒有到 30。", "scope": ["commission"],
  "check": { "event": "trace_reach", "value": 30, "count_max": 0 }, "heat": 3, "tip_per_grade": 180 }
{ "id": "goal_every_link", "text": "每個非決定性的階段都拿到至少一個連動。", "scope": ["commission"],
  "check": { "event": "stage_without_link", "count_max": 0 }, "heat": 3, "tip_per_grade": 150 }
{ "id": "goal_decisive_fast", "text": "決定性的那一場在三回合內結束。", "scope": ["commission"],
  "check": { "event": "decisive_clear", "round_max": 3 }, "heat": 3, "tip_per_grade": 200 }
{ "id": "goal_op_major", "text": "決定性的輿論戰大勝。", "scope": ["commission"],
  "check": { "event": "opinion_result", "value": "major" }, "heat": 3, "tip_per_grade": 200, "channel": "news" }
{ "id": "goal_no_lethal", "text": "整趟沒有用實彈打倒任何人。", "scope": ["combat", "commission"],
  "check": { "event": "lethal_down", "count_max": 0 }, "heat": 3, "tip_per_grade": 150 }
```

- 每件副本從「這一型的」與「共用的」裡挑一到三個；有輿論階段的才抽 `goal_op_major`。
- 委託人不同意直播的（簡報會說），副本直播算違反 `no_exposure`。

#### opinion_setup 的骨架

有輿論階段的類型，底下寫一份 `opinion_setup` 的骨架（DATA 9.1 節）。生成時把 `involves` 換成這件委託的目標勢力與人，`scores` 照議題的類型挑 OPINION 3.2 節的一列。

- **對手的強度**（本稿補的規則）：目標勢力的公關；等級 I～II 強度 1、III～IV 強度 2、V 強度 3；大型委託 +1（上限 3）；非決定性階段的短輿論戰 −1（最少 1）。對手是幫派時照 OPINION 5.2 節的「幫派」行動表。
- **開場**：照議題的類型（OPINION 5.1 節）；`base` 寫玩家起始的聲量、風向與格子。
- 短輿論戰（非決定性階段）`rounds` 寫 4，只打完就結算，結果換成 `op_major`／`op_minor`／`op_lost`。
- 同一個副本有兩場輿論戰時，前一場的結果也會出現在後一場的 `from_links` 裡。

#### 踩點會開出的路

每一型寫幾條「踩點開出來的路」（`scouted` 分支），格式是：**分支 id**（第幾階段、哪一面）：哪一種手段揭開、走這條路怎樣。生成時從裡面抽兩到四條放進未知清單（FIXER 第 2 節）。

---

### 暗殺（`ct_type_assassinate`）

- **主面**：現實。決定性的一步是在最後一場戰鬥裡打倒目標；戰鬥中沒有人會死，打倒之後的「了結」由一段事件文字交代，不寫過程。暗殺不會開出 `alive` 與 `no_kill`。
- **委託人**：冠冕區的外包窗口（企業的髒活）、舊港的帳房（幫派之間的帳）、對立企業的中層、少數是被害者的家人。
- **目標勢力**：星旗、緋櫻、崑崙、伊甸園、黑泉、胭脂堂、鉻娘子、孤星連。目標本人是那個勢力的主管、軍需官、堂口的人或幹部。
- **常抽的地圖**：宅邸、辦公樓層、俱樂部、停車場、屋頂、公寓、live house、旅館。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找到他 | 現實、內海、輿論 | 現實：跟蹤他的車（隱匿 3 級）、問他的司機（交涉，標準 DC）→ `located`。內海：讀他的行程與私人保全網 → `located`，強攻以外再給 `cams_off`。輿論：放出一個他非去不可的場合（短戰）→ `lured_public` | 一般 |
| 2a | 他的護衛 | 現實、內海 | 現實：收買一名護衛（交涉，或付等級 × 300）→ `guard_turned`。內海：竄改護衛的排班 → `shift_rigged` | 一般 |
| 2 | 靠近他 | 現實、內海 | 現實：偽裝成服務生或司機（表演，標準 DC）、踩點的後門 → `close_in`。內海：接管大樓的控制節點 → `doors_unlocked`；或關掉他身上的求救訊號 → `panic_off` | 一般 |
| 2b | 最後一道門 | 現實、輿論 | 現實：保險室、私人電梯或頂樓的門（機械，標準 DC）→ `floor_reached`。輿論：把記者引到大門口（短戰）→ `press_at_gate` | 一般 |
| ★ | 動手 | 現實 | 見下面 | 首領戰 |

- **類型特有的連動**：`lured_public`（開路：決定性階段的地圖換成公開場所，例如 live house 或宴會廳，多一條「混在人群裡靠近」的分支，隱匿或表演標準 DC 低一檔；但敵方的增援是市警）；`close_in`（代勞：決定性階段不必探索）；`panic_off`（減壓：警戒到 100 時目標不會逃走）；`press_at_gate`（減壓：警戒 60 的增援減半）。
- **決定性的一步**：目標站在首領的位置（小型是精英，中大型是首領；不是戰鬥型的目標，數值照位階、行動照勢力的雜兵），旁邊是護衛。打倒目標就算達成，其餘護衛會撤。踩點開出狙擊位時，可以改成一次動手的檢定：槍械，標準 DC 高一檔；成功即達成，失敗進首領戰而且警戒 +20。
- **附帶條件**：`no_trace`、`no_exposure`、`no_collateral`、`make_it_public`（和 `no_exposure` 互斥）。
- **戰敗**：`faction_default`；`fails_commission: true`。
- **直播目標**：`goal_decisive_fast`、`goal_two_crits`，加上：

```json
{ "id": "goal_target_first", "text": "決定性的那一場，先打倒目標，再打倒其他人。", "scope": ["commission"],
  "check": { "event": "target_down_before_others" }, "heat": 3, "tip_per_grade": 200, "channel": "underground" }
```

- **報酬**：類型係數 1.2。III 級中型：4,000 × 1.2 ＝ 4,800。
- **opinion_setup**（第 1 階段或第 2b 階段選輿論時，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "ignite", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<target>"], "types": ["event", "gossip"] },
             "scores": "大眾議題（企業）或街頭的事（幫派）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["murmur"] },
  "from_links": [
    { "link": "located",       "voice": 2 },
    { "link": "inside_mail",   "add_card": "card_inside_scoop" },
    { "link": "bought_slot",   "cells": ["sakura"] }
  ]
}
```

- **踩點會開出的路**：
  - `servant_door`（第 2 階段、現實）：實地勘查揭開。走僕人門或貨梯，這一場遭遇的位置換成「一邊倒」對調（你們先佔好位置）。
  - `alone_window`（★、現實）：打聽揭開他的作息。他每晚有一段時間一個人，首領戰少一個精英。
  - `sniper_nest`（★、現實）：實地勘查揭開，地圖要有屋頂或對面的樓。開出上面寫的狙擊檢定。
  - `net_backdoor`（第 1 階段、內海）：淺層駭入時預埋。內海那一段不必探索，追蹤度起始 −10。
- **常配的詞條**：`party_tonight`、`target_moved`、`on_alert`、`angel_member`、`vip_visit`、`rain`。

### 破壞（`ct_type_sabotage`）

- **主面**：現實。決定性的一步是毀掉一樣實體的東西：生產線、原型機、離線伺服器、一批貨、一座天線、一輛車。
- **委託人**：對立的企業、野薔薇（毀掉黑泉的東西）、素體教（毀掉和橋有關的設備）、舊港的帳房（毀掉對頭的貨）。
- **目標勢力**：緋櫻、星旗、崑崙、蜜腺、黑泉、織女、鉻娘子、伊甸園。
- **常抽的地圖**：工廠、機房、小型實驗室、倉庫、碼頭貨櫃區、屋頂、賭場。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 摸清楚 | 現實、內海 | 現實：以維修或送貨為名進去看（表演，標準 DC）→ `weak_point`。內海：讀設施的設計圖與維修紀錄 → `weak_point`，強攻以外再給 `safety_off` | 一般 |
| 2a | 弄到工具 | 現實、輿論 | 現實：向同人眾或鉻娘子弄炸藥與工具（交涉，或付等級 × 300）→ `demo_kit`。輿論：散布這座設施有安全疑慮（短戰）→ `inspection_called` | 輕 |
| 2 | 進去 | 現實、內海 | 現實：卸貨口、偽裝成夜班維修工（表演，標準 DC）→ `floor_reached`。內海：關閉安全系統 → `safety_off`；或接管控制節點 → `doors_unlocked` | 一般 |
| 2b | 值夜的人 | 現實、內海 | 現實：處理值班的工程師（交涉或威嚇，標準 DC）→ `guard_turned`。內海：讓監視器播昨晚的畫面 → `cams_off` | 一般 |
| ★ | 毀掉它 | 現實 | 見下面 | 一般 ＋ 1.5（大型首領戰） |

- **類型特有的連動**：`weak_point`（開路：決定性階段多一條「打它的弱點」的分支，見下面）；`safety_off`（減壓：決定性階段砲塔與防爆門停用；毀掉它的時候自動警報不響，警戒不漲）；`demo_kit`（減壓：裝炸藥的檢定低一檔）；`inspection_called`（輿論大勝時才給：決定性階段的預算 −2，現場只剩夜班；小勝只給 `op_minor`）。
- **決定性的一步**：目標物是一個不會動的單位，佔一格，生命是同級精英的兩倍，護甲照等級。兩種做法擇一：
  - 打爛它：在戰鬥中把它的生命打到 0。
  - 裝炸藥：站在相鄰的格子花 2 行動點，過一次機械，標準 DC；成功之後那一回合結束起算，第二回合結束時引爆。引爆前那一格要守住，敵人可以花 2 行動點拆（不擲）。
  - 有 `weak_point` 時，裝炸藥改成不擲，或打它的弱點時傷害 ×2。
- **附帶條件**：`no_kill`、`no_collateral`、`no_trace`（要看起來像意外：有 `weak_point` 或 `safety_off` 才做得到）、`on_record`。
- **戰敗**：`faction_default`；`fails_commission: true`。
- **直播目標**：`goal_no_one_down`、`goal_alert_under_60`，加上：

```json
{ "id": "goal_boom_live", "text": "引爆的那一刻，隊伍裡沒有人在爆炸範圍內，而且畫面拍到了。", "scope": ["commission"],
  "check": { "event": "target_destroyed", "method": "explosive", "ally_in_blast_max": 0 }, "heat": 3, "tip_per_grade": 220 }
```

- **報酬**：類型係數 1.0。附帶條件 `no_trace` 做到時，委託人多付 0.15（已含在公式裡），另外中間人的好感 +。
- **opinion_setup**（第 2a 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "smear", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": [], "types": ["scandal", "safety"] },
             "scores": "大眾議題（企業醜聞）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["wall"] },
  "from_links": [
    { "link": "weak_point",   "add_card": "card_safety_report" },
    { "link": "live_footage", "voice": 3 }
  ]
}
```

- **踩點會開出的路**：
  - `loading_bay`（第 2 階段、現實）：實地勘查揭開卸貨的時間。走卸貨口，那一場遭遇少一半。
  - `old_pipe`（★、現實）：實地勘查揭開，地圖是工廠或老舊的大樓時才有。從管線接近目標物，戰鬥開場時有一名隊員已經站在目標物旁邊。
  - `night_engineer`（第 2b 階段、現實）：打聽揭開。值班的工程師欠錢，交涉分支不擲。
  - `maintenance_log`（第 1 階段、內海）：淺層駭入揭開。第 1 階段的內海直接給 `weak_point` 與 `safety_off` 兩個連動。
- **常配的詞條**：`old_building`、`blackout`、`skeleton_crew`、`mech_present`、`hounds`、`cargo_fragile`（反過來用：易爆）。

### 奪取（實體）（`ct_type_seize`）

- **主面**：現實。決定性的一步是把東西拿到手並帶出來：原型、母帶、晶片、一箱貨、一件義體、一份實體文件。委託人要的是東西本身；要的是裡面的資料時，就是竊密。
- **委託人**：對立的企業、收藏家、同人眾（想拆原型）、舊港的帳房（被扣的貨）、玻璃岸的製作人（母帶）。
- **目標勢力**：任何勢力；最常見的是緋櫻、崑崙、蜜腺、織女、萬華鏡、胭脂堂、拆體客。
- **常抽的地圖**：小型實驗室、倉庫、賭場、片場、宅邸、碼頭貨櫃區、超商、診所、冷庫。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 摸清楚 | 現實、內海 | 現實：找出東西放在哪（調查，標準 DC）→ `vault_located`。內海：讀保險庫的系統 → `vault_code` | 一般 |
| 2a | 弄到鑰匙 | 現實、內海 | 現實：活捉一名主管 → `admin_cred`；或偷一張門禁卡（隱匿 3 級）→ `keycard`。內海：偷員工憑證 → `staff_cred` | 一般 |
| 2 | 進去 | 現實、內海 | 現實：貨梯、通風（運動，標準 DC）→ `floor_reached`。內海：接管控制節點 → `doors_unlocked` | 一般 |
| 2b | 安排撤離 | 現實、內海 | 現實：在外面藏好車（操縱，標準 DC）→ `escape_route`。內海：把追兵的調度改掉 → `shift_rigged` | 輕 |
| ★ | 拿到手並帶出來 | 現實 | 見下面 | 小型：一般 ＋ 1.5；中大型：首領戰 |

- **類型特有的連動**：`vault_located`（代勞：決定性階段不必探索找位置）；`vault_code`（開路：決定性階段多一條「直接開保險庫」的分支，不必檢定）。
- **決定性的一步**：先打開保險庫或貨櫃（機械或介面，標準 DC；失敗警戒 +20，可以再擲），拿到東西之後才開打；戰鬥裡要把拿著東西的人送到地圖的出口格。拿東西的人被打倒時東西掉在那一格，誰撿到算誰的。
- **附帶條件**：`intact`、`no_kill`、`no_trace`、`no_exposure`。
- **戰敗**：`faction_default`；`fails_commission: true`。
- **直播目標**：`goal_no_one_down`，加上：

```json
{ "id": "goal_clean_grab", "text": "拿到東西的那一刻，警戒還在 30 以下。", "scope": ["commission"],
  "check": { "event": "item_secured", "alert_max": 30 }, "heat": 3, "tip_per_grade": 200 }
{ "id": "goal_carrier_untouched", "text": "拿著東西的人在撤出的路上沒有被命中。", "scope": ["commission"],
  "check": { "event": "carrier_hit", "count_max": 0 }, "heat": 3, "tip_per_grade": 160 }
```

- **報酬**：類型係數 1.0。收尾時可以背刺：私吞，或賣給對家（FIXER 第 2 節），對家出價是報酬的 1.3 倍，委託人勢力的敵對值 +5、中間人的關係重挫。
- **opinion_setup**：沒有輿論階段。
- **踩點會開出的路**：
  - `delivery_slot`（第 2 階段、現實）：打聽揭開收貨的時間。混在送貨的人裡進去，不必探索。
  - `twin_case`（★、現實）：打聽或實地勘查揭開「有兩個一樣的箱子」。事先知道真的是哪一個，`cm_th_twin_case` 不會發生。
  - `freight_lift`（第 2a 階段、現實）：實地勘查揭開。貨梯直通，`keycard` 免擲。
  - `bribed_clerk`（★、現實）：收買內線揭開。保管的人替你先把東西拿出來，開保險庫不擲。
- **常配的詞條**：`cargo_heavy`、`cargo_fragile`、`rival_crew`、`higher_bidder`、`shift_change`。

### 挖角／綁架（`ct_type_extract`）

- **主面**：現實。決定性的一步是把人帶出來，送到地圖的出口格。**挖角**是目標本人答應走（多半是想走但走不了的員工或契約人）；**綁架**是目標不答應。簡報會說是哪一種。
- **委託人**：對立的企業（挖研究員、工程師）、四十二番街的媽媽桑（挖人偶館的人）、蜜糖會（帶契約人出來）、偶像的經紀人、櫻町的店長。
- **目標勢力**：緋櫻、蜜腺、崑崙、伊甸園、萬華鏡、夜鶯、織女。目標多半有橋權綁在公司或持約人手上。
- **常抽的地圖**：辦公樓層、人偶館、宅邸、公寓、俱樂部、live house、小型實驗室。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 接觸他 | 現實、輿論 | 現實：在他常去的地方搭上話（交涉或誘惑，標準 DC）→ `target_willing`（挖角）或 `target_routine`（綁架）。輿論：放出他被公司虧待的說法（短戰）→ `target_doubts` | 輕 |
| 2a | 安排去處 | 現實、內海 | 現實：準備安全屋與假身分（交涉，或付等級 × 300）→ `safehouse_ready`。內海：替他做一個假的橋 ID → `fake_id` | 輕 |
| 2 | 處理他的橋權 | 內海、現實 | 內海：進持有橋權的子網，解掉遠端鎖 → `bridge_cleared`。現實：找改造師在他身上裝阻斷器（義體學或醫療，標準 DC）→ `bridge_cleared` | 一般 |
| 2b | 穿過樓層 | 現實、內海 | 現實：員工通道（隱匿 3 級）→ `floor_reached`。內海：接管控制節點 → `doors_unlocked` | 一般 |
| ★ | 把人帶出來 | 現實 | 見下面 | 一般 ＋ 1.5（中大型首領戰） |

- **類型特有的連動**：`target_willing`（開路：決定性階段他自己跟著走，不必制伏，他算一個不打仗的同行）；`target_routine`（代勞：決定性階段不必探索）；`target_doubts`（減壓：決定性階段他不會呼救，制伏或說服的檢定低一檔）；`safehouse_ready`（減壓：警戒 60 的增援不來）；`fake_id`（開路：決定性階段多一條「大方走出正門」的分支，表演標準 DC，成功就不必戰鬥）；`bridge_cleared`（必要：沒有它，`cm_ab_remote_lock` 在決定性階段必定發生，目標被遠端鎖死、失去行動，要一名隊員扛著他，扛的人每回合行動點 −2）。
- **決定性的一步**：綁架要先制伏目標（制伏的 DC 照 ENEMIES 1.4 節），挖角有 `target_willing` 就不必；之後把他帶到出口格。目標有生命，被實彈打倒算違反 `alive`。
- **附帶條件**：`alive`（預設就有）、`no_trace`、`no_exposure`、`no_kill`。
- **戰敗**：`faction_default`（伊甸園是 `contract`、緋櫻是 `arrest`）；`fails_commission: true`。
- **直播目標**：`goal_no_lethal`，加上：

```json
{ "id": "goal_target_unhurt", "text": "被帶出來的人生命沒有掉到一半以下。", "scope": ["commission"],
  "check": { "event": "escortee_hp_below", "ratio": 0.5, "count_max": 0 }, "heat": 3, "tip_per_grade": 180 }
{ "id": "goal_walked_out", "text": "他是自己走出來的（挖角版，有 target_willing）。", "scope": ["commission"],
  "check": { "event": "link_held", "link": "target_willing" }, "heat": 3, "tip_per_grade": 150 }
```

- **報酬**：類型係數 1.1。挖角成功時，目標有一成的機率加入名冊（他欠你一個中人情）。
- **opinion_setup**（第 1 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "smear", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<target>"], "types": ["labor", "scandal"] },
             "scores": "大眾議題（企業醜聞）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["murmur"] },
  "from_links": [ { "link": "bought_slot", "opponent_pr_first_round": -2 } ]
}
```

- **踩點會開出的路**：
  - `back_office`（第 1 階段、現實）：打聽揭開他常去的店。第 1 階段的交涉或誘惑不擲。
  - `clinic_contact`（第 2 階段、現實）：買情報或打聽揭開一位肯做的改造師。現實分支的檢定低一檔。
  - `doll_shift`（第 1 階段、現實）：進人偶館當班揭開。直接拿到 `target_willing`；可能接成一場成人場景（🔞）。
  - `staff_exit`（★、現實）：實地勘查揭開。出口格換成離目標比較近的那一個。
- **常配的詞條**：`target_paranoid`、`ex_acquaintance`、`inside_man`、`party_tonight`、`higher_bidder`。

### 護送（`ct_type_escort`）

- **主面**：現實。決定性的一步是讓被護送的人（或貨）抵達：最後一個階段是終點前的埋伏或關卡，打完時被護送的人站在終點格、沒有倒下。
- **委託人**：要去作證的人、剛逃出人偶館的人（送到蜜糖會）、地下偶像（當保鑣）、走私客（貨）、企業的中層（要換邊）。
- **目標勢力**（來攔的那一方）：伊甸園、胭脂堂、星旗、萬華鏡的狗仔、親衛隊、野薔薇、鉻娘子。
- **常抽的地圖**：地鐵月台與隧道、商店街、排水道、停車場、檢查哨、屋頂（終點）、碼頭貨櫃區。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 出發前的安排 | 現實、內海、輿論 | 現實：挑路線、藏車（街頭直覺或操縱，標準 DC）→ `route_planned`。內海：關掉路線上的監視器 → `route_dark`。輿論：讓全城都知道他今晚要走（短戰）→ `city_watching` | 輕 |
| 2a | 換車 | 現實、內海 | 現實：在地下停車場換車（操縱，標準 DC）→ `trail_lost`。內海：偽造他的位置訊號 → `decoy_signal` | 一般 |
| 2 | 路上 | 現實 | 現實：小路（街頭直覺 3 級）、踩點的路 → 沒有連動，這一段只要走完 | 一般 |
| 2b | 中途的關卡 | 現實、輿論 | 現實：闖過檢查哨，或交涉過關（交涉，標準 DC 高一檔）→ `checkpoint_cleared`。輿論：讓關卡那邊的人知道有人在看（短戰）→ `op_minor` 或 `op_major` | 一般 |
| ★ | 抵達 | 現實 | 見下面 | 小型：一般 ＋ 1.5；中大型：首領戰 |

- **類型特有的連動**：`route_planned`（代勞：第 2 階段不必探索）；`route_dark`（減壓：第 2 階段的遭遇預算 −1.5，警戒的上漲減半）；`city_watching`（大勝：第 2 階段對方不敢動手，那一段改成一次隱匿或操縱的檢定，標準 DC，失敗才開打；小勝：照 `op_minor`）；`trail_lost`（減壓：決定性階段的預算 −2）；`decoy_signal`（減壓：警戒 60 的增援去了錯的地方）；`checkpoint_cleared`（代勞：決定性階段不必探索）。
- **決定性的一步**：被護送的人是一個不打仗的同行，有生命，站在隊伍的後排。終點的埋伏開打後，把他送到終點格並撐到敵人倒下或撤走。**被護送的人倒下等於委託失敗**（本稿補的規則：它不是戰敗，但和戰敗一樣回退）。護送的是貨時，貨佔一格，不會動，由一名隊員帶著。
- **附帶條件**：`no_kill`、`no_exposure`（他的臉不能被拍到）、`intact`（護送貨時）、`no_collateral`。
- **戰敗**：來攔那一方的勢力預設；`fails_commission: true`。
- **直播目標**：`goal_no_one_down`，加上：

```json
{ "id": "goal_escort_clean", "text": "被護送的人整趟沒有被命中。", "scope": ["commission"],
  "check": { "event": "escortee_hit", "count_max": 0 }, "heat": 3, "tip_per_grade": 200 }
{ "id": "goal_city_watching", "text": "第 1 階段讓全城都在看（拿到 city_watching）。", "scope": ["commission"],
  "check": { "event": "link_held", "link": "city_watching" }, "heat": 3, "tip_per_grade": 150, "channel": "news" }
```

- **報酬**：類型係數 0.9。委託人是剛逃出來的人時改成 0.6，另給一個中人情（蜜糖會或那個人）。
- **opinion_setup**（第 1 或第 2b 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "ignite", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<escortee>"], "types": ["crime", "event"] },
             "scores": "街頭的事（對手是幫派）或大眾議題（對手是企業）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 1, "cells": ["relay"] },
  "from_links": [
    { "link": "route_dark",   "voice": 1 },
    { "link": "live_footage", "voice": 3 }
  ]
}
```

- **踩點會開出的路**：
  - `service_tunnel`（第 2 階段、現實）：實地勘查揭開。走地鐵的維修隧道，遭遇預算 −1.5。
  - `ambush_spot`（★、現實）：打聽揭開對方埋伏的位置。決定性那一場的位置對調，你們先佔好位置。
  - `friendly_checkpoint`（第 2b 階段、現實）：收買內線揭開。交涉分支不擲。
  - `spare_car`（第 2a 階段、現實）：買情報揭開。換車不擲。
- **常配的詞條**：`curfew`、`crowded`、`rain`、`double_booked`、`police_sweep`。

### 救援（`ct_type_rescue`）

- **主面**：現實。決定性的一步是把被關的人帶出來，送到地圖的出口格。
- **委託人**：家人、蜜糖會、名冊上的人、被扣線的潛網者的朋友、野薔薇（自己人被抓）。
- **目標勢力**（關人的那一方）：伊甸園、蜜腺、胭脂堂、拆體客、星旗、市警、牆語者、緋櫻。
- **常抽的地圖**：檢查哨、冷庫、小型實驗室、診所、工廠（契約工）、人偶館、倉庫。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找到人 | 現實、內海 | 現實：問最後見過他的人（街頭直覺，標準 DC）→ `cell_found`。內海：讀關押紀錄 → `cell_found`，強攻以外再給 `captive_status` | 一般 |
| 2a | 打聽守備 | 現實、輿論 | 現實：收買一名看守（交涉，或付等級 × 300）→ `guard_turned`。輿論：公開他被關（短戰）→ `op_minor` 或 `op_major` | 輕 |
| 2 | 進去 | 現實、內海 | 現實：後門、通風（運動，標準 DC）、自投羅網（見下面）→ `floor_reached`。內海：關掉門禁 → `doors_unlocked` | 一般 |
| 2b | 牢房那一層 | 現實、內海 | 現實：處理那一層的看守（隱匿 3 級）→ `guard_turned`。內海：竄改看守的排班 → `shift_rigged` | 一般 |
| ★ | 把人帶出來 | 現實 | 見下面 | 小型：一般 ＋ 1.5；中大型：首領戰 |

- **類型特有的連動**：`cell_found`（代勞：決定性階段不必探索）；`captive_status`（知道他的狀況：受傷、被下藥或被扣線，決定性階段可以事先準備，對應的詞條效果減半）。
- **自投羅網**（刻意戰敗的分支）：目標勢力的預設戰敗是 `arrest`、`pow`、`contract` 時，第 2 階段的現實多一條分支：故意被抓。這一場戰敗走那個戰敗事件的「被關進去」那一段，`fails_commission: false`；醒來直接進決定性階段，起始位置在牢房旁邊，身上只剩一件藏好的武器或道具（隱匿 3 級才藏得住），警戒從 0 開始。
- **決定性的一步**：被救的人是一個不打仗的同行，有生命，可能走不動（詞條 `captive_weak`）。把他送到出口格並撐到敵人倒下或撤走。被救的人倒下等於委託失敗。
- **附帶條件**：`alive`、`no_kill`、`no_trace`、`no_collateral`。
- **戰敗**：`faction_default`；`fails_commission: true`（自投羅網那一條除外）。
- **直播目標**：`goal_no_one_down`、`goal_decisive_fast`，加上：

```json
{ "id": "goal_two_out", "text": "多帶了一個人出來（還有一個人）。", "scope": ["commission"],
  "check": { "event": "extra_rescued", "count_min": 1 }, "heat": 3, "tip_per_grade": 200 }
```

- **報酬**：類型係數 0.9。委託人是家人時改成 0.6，另給一個中人情。多帶出來的人（`cm_rs_cellmate`）不加錢，但有兩成的機率加入名冊。
- **opinion_setup**（第 2a 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "smear", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<captive>"], "types": ["crime", "labor"] },
             "scores": "大眾議題（企業）或街頭的事（幫派）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["wall"] },
  "from_links": [
    { "link": "captive_status", "add_card": "card_testimony" },
    { "link": "cell_found",     "voice": 1 }
  ]
}
```

- **踩點會開出的路**：
  - `visiting_hour`（第 2 階段、現實）：打聽揭開探視或送餐的時間。偽裝成送餐的人進去，表演標準 DC 低一檔。
  - `drain_grate`（★、現實）：實地勘查揭開。出口格多一個排水口，離牢房比較近。
  - `soft_guard`（第 2b 階段、現實）：收買內線揭開。直接拿到 `guard_turned`。
  - `transfer_day`（★、現實）：打聽揭開他被移送的日子。決定性階段的地圖換成移送的車與停車場，預算 −2。
- **常配的詞條**：`captive_weak`、`netlocked_captive`、`inside_man`、`target_moved`、`hounds`、`skeleton_crew`。

### 討債／回收（`ct_type_collect`）

- **主面**：現實。決定性的一步是拿到錢，或收回一件義體、一輛車、一份抵押。
- **委託人**：胭脂堂（放債）、伊甸園（契約的欠款）、診所（沒付的義體）、蜂巢的雜貨店老闆娘、車行。
- **目標勢力**：欠債的人多半沒有勢力；敵人是他的靠山或他躲進去的地方：野良、特攻姬、鉻娘子、拆體客、祭典組。他沒有靠山時，敵人照那一區的街頭勢力生成。
- **常抽的地圖**：公寓、商店街、倉庫、賭場、碼頭貨櫃區、超商。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找到人或錢 | 現實、內海 | 現實：問鄰居與常去的店（街頭直覺，標準 DC）→ `debtor_located`。內海：查他的帳 → `stash_found` | 輕 |
| 2a | 他的靠山 | 現實、內海 | 現實：先去找靠山談（交涉，標準 DC）→ `backer_aside`。內海：凍結他的帳戶 → `accounts_frozen` | 一般 |
| 2 | 上門 | 現實 | 現實：讓房東開門（交涉 2 級）、從隔壁戶的陽台過去（運動，標準 DC）→ `cornered` | 一般 |
| 2b | 他跑了 | 現實、內海 | 現實：追（運動或操縱，標準 DC）→ `cornered`。內海：追他的橋 ID 訊號 → `located` | 一般 |
| ★ | 收走 | 現實 | 見下面 | 一般（談成就沒有） |

- **類型特有的連動**：`debtor_located`（代勞：第 2 階段不必探索）；`stash_found`（開路：決定性階段多一條「直接拿藏起來的錢」的分支，不必和他對峙）；`backer_aside`（減壓：決定性階段的預算 −2，靠山的人不來）；`accounts_frozen`（減壓：決定性階段的交涉與威嚇低一檔）；`cornered`（代勞：決定性階段不必探索）。
- **決定性的一步**：先對峙，擇一擲一次：威嚇或交涉，標準 DC。成功就收到，不打；失敗或選強攻，開一場一般遭遇，打贏之後收走。回收義體時要拆：義體學，標準 DC，或把人帶回委託人那裡（他算一個不打仗的同行）。
- **成人的分支**（🔞）：`cm_db_offer_body` 會讓欠債的人提出拿身體抵；接受時進一場成人場景，債由主角自己替他墊上（付委託的報酬那麼多）或回報委託人「收不到」（委託失敗）。篩選關掉時這個事件不出現。
- **附帶條件**：`alive`（他還要繼續還）、`no_kill`、`no_collateral`（他的家人）。
- **戰敗**：靠山的勢力預設；沒有靠山時是那一區街頭勢力的預設（多半是 `robbed`，`fails_commission: false`）；其餘 `true`。
- **直播目標**：`goal_no_lethal`，加上：

```json
{ "id": "goal_no_shot_collect", "text": "決定性的一步沒有開打就收到了。", "scope": ["commission"],
  "check": { "event": "decisive_without_combat" }, "heat": 3, "tip_per_grade": 150, "channel": "underground" }
{ "id": "goal_full_amount", "text": "收到的比欠的多（找到藏起來的錢）。", "scope": ["commission"],
  "check": { "event": "link_used", "link": "stash_found" }, "heat": 3, "tip_per_grade": 120 }
```

- **報酬**：類型係數 0.8；用 `stash_found` 多收到的部分，另抽一成給你（約等於報酬的 0.2）。
- **opinion_setup**：沒有輿論階段。
- **踩點會開出的路**：
  - `payday`（★、現實）：打聽揭開他發薪的日子。決定性階段他身上有錢，交涉低一檔。
  - `side_door`（第 2 階段、現實）：實地勘查揭開。從隔壁戶進去，不必探索。
  - `his_girl`（第 2b 階段、現實）：打聽揭開他會去找誰。他跑了也不必追，直接拿到 `cornered`。
- **常配的詞條**：`family_home`、`target_drunk`、`target_moved`、`crowded`、`police_sweep`。

### 蜜罐（`ct_type_honeypot`）

- **主面**：現實。決定性的一步是取得把柄：一場有目的的成人場景（🔞，`adult_scene`，目的是「錄下來」或「套出話」），或一場套話的對峙。
- **委託人**：對立的企業、玻璃岸的製作人、四十二番街的媽媽桑、舊港的帳房、政敵。
- **目標勢力**：企業的主管與領事（緋櫻、星旗、蜜腺、伊甸園、崑崙、黑泉）、幫派的幹部、名人。
- **常抽的地圖**：俱樂部、旅館、人偶館、宅邸、賭場。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 接近他 | 現實、輿論 | 現實：在他常去的地方讓他看見你（誘惑或表演，標準 DC）→ `noticed`。輿論：先把你捧高，他才會上鉤（短戰）→ `hyped` | 輕 |
| 2a | 他的圈子 | 現實、輿論 | 現實：混進他的派對或包廂（表演，標準 DC）→ `invited`。輿論：讓他的圈子都在談你（短戰）→ `hyped` | 輕 |
| 2 | 獨處 | 現實 | 現實：甩掉保鑣（隱匿或誘惑，標準 DC）、裝好錄影設備（機械或介面，標準 DC）→ `rig_ready` | 輕（只在被識破時開打） |
| 2b | 確認房間 | 現實、內海 | 現實：事先在房間裡裝針孔（機械，標準 DC）→ `rig_ready`。內海：關掉飯店或宅邸的監控 → `cams_off` | 輕 |
| ★ | 取得把柄 | 現實 | 見下面 | 無（被識破時一般） |

- **類型特有的連動**：`noticed`（開路：第 2 階段多一條「他主動邀你」的分支，不擲）；`hyped`（減壓：決定性階段的誘惑與表演低一檔）；`invited`（代勞：第 2 階段不必探索）；`rig_ready`（把柄的品質 +1）。
- **決定性的一步**：成人場景的「目的」是讓他說出某件事或拍下某件事；場景裡每做到一個「目的」的行動，把柄的品質 +1（1～4）。品質 2 以上算達成，3 以上是好評價。成人內容的細項篩選關掉了這一類時改成套話的對峙：擲三次，從誘惑、交涉、表演裡選，每次標準 DC，兩次成功算達成，三次成功品質 3。任何一次大失敗代表被識破，保鑣進場，開一場一般遭遇，打贏之後把柄的品質 −1（最少 1）。
- **附帶條件**：`no_exposure`（你的臉不能出現在把柄裡）、`no_trace`、`on_record`、`no_kill`。
- **戰敗**：`faction_default`；`fails_commission: true`。
- **直播目標**：只有委託人同意、而且對象同意入鏡時才能開；不然就是偷播（MEDIA 1.2 節），被發現的後果照偷播。

```json
{ "id": "goal_leverage_3", "text": "把柄的品質到 3 以上。", "scope": ["commission", "adult"],
  "check": { "event": "leverage_quality", "value_min": 3 }, "heat": 3, "tip_per_grade": 220, "channel": "adult" }
{ "id": "goal_never_suspected", "text": "整趟警戒維持在 0。", "scope": ["commission"],
  "check": { "event": "alert_reach", "value": 1, "count_max": 0 }, "heat": 3, "tip_per_grade": 180, "channel": "gossip" }
```

- **報酬**：類型係數 1.0；把柄品質 4 時 ×1.2。把柄可以私留一份當素材（違反 `no_copy` 時才算背刺）。
- **opinion_setup**（第 1、2a 階段選輿論，短戰；議題是主角自己）：

```json
"opinion_setup": {
  "topic": { "kind": "ignite", "rounds": 4,
             "involves": { "factions": [], "people": ["<pc>"], "types": ["gossip", "beauty"] },
             "scores": "小眾議題（圈子那一排高）" },
  "opponent": { "id": "pr_rival_talent", "strength": 1 },
  "base": { "voice": 2, "wind": 1, "cells": ["tape"] },
  "from_links": [ { "link": "noticed", "voice": 2 } ]
}
```

- **踩點會開出的路**：
  - `regular_seat`（第 1 階段、現實）：打聽揭開他固定的座位與時間。誘惑不擲，直接拿到 `noticed`。
  - `doll_house_night`（第 1 階段、現實）：進人偶館當班揭開他的喜好。決定性階段的第一個「目的」行動自動算數（🔞）。
  - `bodyguard_habit`（第 2 階段、現實）：實地勘查揭開保鑣的習慣。甩掉保鑣不擲。
  - `hotel_staff`（第 2b 階段、現實）：收買內線揭開。直接拿到 `rig_ready`。
- **常配的詞條**：`target_paranoid`、`target_drunk`、`party_tonight`、`ex_acquaintance`、`reporter_on_site`、`vip_visit`。

### 接待（`ct_type_host`）

- **主面**：現實。決定性的一步是取悅：受雇陪一個人一段時間，一場目的是「取悅」的成人場景（🔞，`adult_scene`），結算看契合。
- **委託人**：四十二番街的媽媽桑、人偶館、蜜糖會、冠冕區的外包窗口（招待企業的客人）、流竄 AI（夜后、陛下這些中間人）。
- **目標勢力**：客人所屬的勢力。做得好，那個勢力的好感 +；搞砸了，敵對值 +。
- **常抽的地圖**：旅館、宅邸、人偶館、俱樂部、賭場。戰鬥很少，只在詞條帶來的麻煩裡出現。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 打聽他的喜好 | 現實、內海 | 現實：問他常去的店、問上一個陪他的人（街頭直覺或交涉，標準 DC）→ `taste_known`。內海：讀他的橋或紀錄 → `taste_known` 與 `taste_deep` | 無 |
| 2a | 準備 | 現實、輿論 | 現實：借衣服、做造型、練一段表演（表演，標準 DC）→ `dressed_up`。輿論：替你造勢（短戰）→ `hyped` | 無 |
| 2 | 赴約，打扮與暖場 | 現實、輿論 | 現實：暖場（表演或交涉，標準 DC）→ `warmed_up`。輿論：讓他在來之前就看過你（短戰）→ `hyped` | 無 |
| 2b | 第二攤 | 現實 | 現實：陪他去他想去的地方（`cm_ho_plus_one` 在這裡權重 ×2）→ `warmed_up` | 無 |
| ★ | 取悅 | 現實 | 見下面 | 無 |

- **類型特有的連動**：`taste_known`（開場就知道他的兩個偏好標籤）；`taste_deep`（再多知道一個偏好標籤與一個他不要的）；`dressed_up`、`warmed_up`、`hyped`（各讓契合的起始 +1 檔）。
- **決定性的一步**：成人場景的目的是「取悅」，結算看契合：很滿意（報酬 ×1.3，客人勢力好感 +）、滿意（達成）、不滿意（達成，但報酬 ×0.6、客人勢力好感 −；已確認不算失敗）。篩選關掉時改成陪伴的對峙：擲三次，從表演、交涉、誘惑裡選，每次標準 DC；兩次成功算滿意，三次成功算很滿意。
- **附帶條件**：`client_rules`、`no_exposure`。
- **戰敗**：只在詞條帶來的遭遇裡發生（跟蹤狂、客人的保鑣起疑、另一方來搶人）；用那一方的勢力預設，沒有就是 `lesson`；`fails_commission: true`。
- **直播目標**：只有詞條 `exhibitionist_guest`（客人想被看）時才能開。

```json
{ "id": "goal_perfect_fit", "text": "客人很滿意。", "scope": ["commission", "adult"],
  "check": { "event": "host_result", "value": "delighted" }, "heat": 3, "tip_per_grade": 250, "channel": "adult" }
{ "id": "goal_all_tastes", "text": "場景裡碰到他所有知道的偏好。", "scope": ["commission", "adult"],
  "check": { "event": "taste_hit_all" }, "heat": 3, "tip_per_grade": 180, "channel": "adult" }
```

- **報酬**：類型係數 0.8；很滿意 ×1.3（小費）。客人有兩成的機率指名下一次（變成一件同級的接待委託，不必經過踩點）。
- **opinion_setup**（第 2a、2 階段選輿論，短戰；議題是主角自己）：

```json
"opinion_setup": {
  "topic": { "kind": "ignite", "rounds": 4,
             "involves": { "factions": [], "people": ["<pc>"], "types": ["gossip", "beauty"] },
             "scores": "小眾議題（圈子那一排高）" },
  "opponent": { "id": "pr_rival_talent", "strength": 1 },
  "base": { "voice": 2, "wind": 1, "cells": ["fanclub"] },
  "from_links": [ { "link": "dressed_up", "add_card": "card_lookbook" } ]
}
```

- **踩點會開出的路**：
  - `previous_host`（第 1 階段、現實）：打聽揭開上一個陪他的人。直接拿到 `taste_known`。
  - `his_driver`（第 2 階段、現實）：收買內線揭開他今晚的心情。暖場不擲。
  - `doll_house_record`（第 1 階段、現實）：進人偶館當班揭開。拿到 `taste_deep`（🔞）。
- **常配的詞條**：`guest_plus_one`、`exhibitionist_guest`、`target_drunk`、`stalker`。

### 獵溺（`ct_type_hunt_drowned`）

- **主面**：現實。決定性的一步是搶在鎮溺隊之前制伏一個溺感者並帶走；委託人幾乎都要活的。
- **委託人**：他的家人、蜜腺（研究）、夜宴社、地下層的探員、少數是牆語者。
- **目標勢力**：溺感者（ENEMIES 12.1 節）與來搶人的鎮溺隊（12.2 節）。溺感者身邊常有牆語者的信徒。
- **常抽的地圖**：排水道、公寓、地鐵月台與隧道、倉庫、商店街。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找出他在哪 | 現實、內海 | 現實：問看過他的人（街頭直覺，標準 DC）→ `located`。內海：把他從線上引開 → `lured_offline` | 輕 |
| 2a | 他的同伴 | 現實、內海 | 現實：處理在他身邊的牆語者（交涉或威嚇，標準 DC）→ `flock_scattered`。內海：切斷他們在舊網的聯繫 → `flock_scattered` | 一般 |
| 2 | 搶在鎮溺隊之前 | 現實、輿論 | 現實：先封住他的去路（運動或街頭直覺，標準 DC）→ `cornered`。輿論：放假消息，讓鎮溺隊往別的地方去（短戰）→ `suppress_delayed` | 一般 |
| 2b | 牆的聲音 | 內海、現實 | 內海：在他的橋裡壓住牆的訊號（介面，標準 DC）→ `wall_muted`。現實：找一個他信任的人來（交涉，標準 DC）→ `wall_muted` | 一般 |
| ★ | 制伏並帶走 | 現實 | 見下面 | 小型：一般 ＋ 1.5（他是精英）；中大型：首領戰（他是首領） |

- **類型特有的連動**：`lured_offline`（減壓：決定性階段他的「傳播」範圍 −1 格）；`flock_scattered`（減壓：決定性階段的預算 −2）；`cornered`（代勞：決定性階段不必探索）；`suppress_delayed`（減壓：決定性階段鎮溺隊不出現；小勝時晚兩回合）；`wall_muted`（減壓：制伏他的 DC 低一檔）。
- **決定性的一步**：沒有 `suppress_delayed` 時，鎮溺隊在第 3 回合從後方進場，每三回合補一個班（ENEMIES 12.2 節），所以拖不得。制伏他（DC 照 ENEMIES 1.4 節）並把他送到出口格就算達成；他被鎮溺隊帶走就是委託失敗。
- **附帶條件**：`alive`（預設就有）、`no_kill`、`no_exposure`。
- **戰敗**：贏的那一方決定：溺感者這邊贏了走 `spread`，鎮溺隊贏了走 `quarantine`；兩者都是 `fails_commission: true`。
- **直播目標**：`goal_no_lethal`，加上：

```json
{ "id": "goal_beat_suppress", "text": "鎮溺隊進場之前就把他制伏了。", "scope": ["commission"],
  "check": { "event": "target_subdued_before", "other": "suppress_arrive" }, "heat": 3, "tip_per_grade": 220 }
{ "id": "goal_no_overload", "text": "決定性的那一場沒有隊友過載。", "scope": ["commission"],
  "check": { "event": "ally_overload", "stage": "decisive", "count_max": 0 }, "heat": 3, "tip_per_grade": 160 }
```

- **報酬**：類型係數 1.1。鎮溺隊的敵對值 +2（不管有沒有和他們交手）。
- **opinion_setup**（第 2 階段選輿論，短戰；對手是鎮溺隊的公告）：

```json
"opinion_setup": {
  "topic": { "kind": "ignite", "rounds": 4,
             "involves": { "factions": ["suppress"], "people": [], "types": ["street", "drowned"] },
             "scores": "街頭的事" },
  "opponent": { "id": "pr_suppress", "strength": 1 },
  "base": { "voice": 2, "wind": 0, "cells": ["murmur"] },
  "from_links": [ { "link": "located", "add_card": "card_false_sighting" } ]
}
```

- **踩點會開出的路**：
  - `his_nest`（第 1 階段、現實）：打聽揭開他睡的地方。直接拿到 `located`。
  - `suppress_schedule`（第 2 階段、現實）：淺層駭入或買情報揭開鎮溺隊的調度。直接拿到 `suppress_delayed`。
  - `old_photo`（第 2b 階段、現實）：打聽揭開他以前的生活。找人來的交涉不擲。
- **常配的詞條**：`suppress_nearby`、`wall_whisper`、`rain`、`old_hardware`、`crowded`。

### 竊密（資料）（`ct_type_steal_data`）

- **主面**：內海。決定性的一步是在核心層下載檔案。COMMISSIONS 第 11 節的 `cm_0412` 就是這一型的中型。
- **委託人**：地下層的書店（前貞網局探員）、對立的企業、爆料的記者、牆語者、同人眾。
- **目標勢力**：夜鶯、崑崙、蜜腺、緋櫻、星旗、伊甸園；V 級才有貞網局。
- **常抽的地圖**（現實的階段）：小辦公室、辦公樓層、機房、小型實驗室、超商、診所、人偶館。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 拿到入口 | 現實、內海 | 現實：摸進去偷一張門禁卡（隱匿 3 級）→ `keycard`。內海：進訪客層，借一個員工的登入（誘惑 2 級，或介面標準 DC）→ `staff_cred` | 一般 |
| 2a | 控制層 | 現實、內海 | 現實：刷卡到機房那一層 → `floor_reached`。內海：接管這棟樓的控制節點 → `doors_unlocked`；活捉主管的現實分支 → `admin_cred` | 一般 |
| 2 | 往下一層 | 內海（有隔離區時只有現實，必經） | 內海：有 `staff_cred` 或 `admin_cred` 的連動分支 → `deep_layer`。現實（隔離區）：進機房，插上資料埠 → `airgap_open` | 一般（必經的現實階段：一般 ＋ 1.5） |
| 2b | 檔案庫 | 內海、現實 | 內海：在檔案庫裡找出真的那一份（調查，標準 DC）→ `file_marked`。現實：切斷大樓的備援線路（機械，標準 DC）→ `power_cut` | 一般 |
| ★ | 下載 | 內海 | 見下面 | 首領戰（核心層） |

- **類型特有的連動**：`deep_layer`（代勞：決定性階段直接從核心層的入口開始）；`file_marked`（減壓：下載只要 2 回合；`cm_net_bait_file` 不會發生）。
- **隔離區**：生成時三成有（III 級以上五成，詞條 `airgapped` 也會開出來）。有隔離區時第 2 階段只有現實、是必經的；沒有 `airgap_open`，決定性階段做不了，這是寫在簡報上的。
- **決定性的一步**：核心層的戰鬥；守閘的是首領（蕾絲或值班潛網者）加雜兵。兩種達成方式：打贏這一場；或讓一個人站在資料節點上撐完下載（3 回合，有 `file_marked` 是 2 回合），下載中每回合追蹤度 +5，那個人被打到過載就中斷、要重來。
- **附帶條件**：`no_trace`、`no_copy`、`no_kill`（現實的階段）。
- **戰敗**：`faction_default`（夜鶯是 `pinned`，網內被黑蕾絲打倒是 `polluted`）；`fails_commission: true`，`polluted` 照 ENEMIES 第 6 節是 `false`。
- **直播目標**：`goal_trace_under_30`，加上：

```json
{ "id": "goal_download_clean", "text": "下載途中沒有被中斷過。", "scope": ["commission"],
  "check": { "event": "download_interrupted", "count_max": 0 }, "heat": 3, "tip_per_grade": 180 }
{ "id": "goal_no_white_alarm", "text": "整趟沒有任何一隻白蕾絲拉響警報。", "scope": ["commission"],
  "check": { "event": "lace_alarm", "count_max": 0 }, "heat": 3, "tip_per_grade": 160 }
```

- **報酬**：類型係數 1.0。資料可以私留一份賣掉、當素材、當下一件委託的憑證（違反 `no_copy` 時才算背刺）。
- **opinion_setup**：沒有輿論階段。
- **踩點會開出的路**：
  - `net_backdoor`（第 1 階段、內海）：淺層駭入時預埋。內海那一段不必探索，追蹤度起始 −10。
  - `night_shift_gap`（第 1 階段、現實）：打聽揭開班表。現實那一段遭遇少一半。
  - `sleeping_tech`（第 2 階段、現實，必經的機房）：實地勘查揭開值班的工程師會睡著。`cm_sd_sleeping_tech` 必定發生，而且選項的檢定低一檔。
  - `lace_color`（★、內海）：淺層駭入揭開核心層的蕾絲顏色。決定性那一場你看得到敵方的配置。
- **常配的詞條**：`airgapped`、`subnet_maintenance`、`netvigil_sweep`、`pink_nest`、`old_hardware`、`shift_change`。

### 抹除（`ct_type_erase`）

- **主面**：內海。決定性的一步是在核心層刪掉資料；離線的備份要另外在現實毀掉。
- **委託人**：想從紀錄裡消失的人、被拍的藝人、胭脂堂（毀證）、企業（毀掉內部調查）、名冊上的人。
- **目標勢力**：萬華鏡（片與母帶）、夜鶯（橋的紀錄）、市警（案卷）、伊甸園（契約的紀錄）、貞網局、蜜腺（病歷）。
- **常抽的地圖**（現實的階段）：機房、片場、診所、小辦公室、辦公樓層。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找出備份在哪 | 內海、現實 | 內海：讀備份的排程 → `backup_found`。現實：問管檔案的人（交涉或誘惑，標準 DC）→ `backup_found` | 一般 |
| 2a | 第二份備份 | 內海、現實 | 內海：找出同步到別處的那一份 → `mirror_cut`。現實：在另一個地點毀掉它 → `mirror_cut` | 一般 |
| 2 | 毀掉離線的備份 | 現實、內海 | 現實：進存放的地方，物理毀掉（機械，標準 DC）→ `backup_destroyed`。內海：有 `backup_found` 時，讓備份機自己格式化（介面，標準 DC 高一檔）→ `backup_destroyed` | 一般 |
| 2b | 壓住消息 | 輿論、內海 | 輿論：讓這件事沒人想追（短戰，滅火）→ `story_buried`。內海：把查詢這份資料的紀錄也一起清掉 → `log_wiped` | 一般 |
| ★ | 刪掉核心的資料 | 內海 | 見下面 | 首領戰（核心層） |

- **類型特有的連動**：`backup_found`（代勞：第 2 階段不必探索）；`mirror_cut`（減壓：決定性階段的預算 −2，`cm_er_extra_backup` 不會發生）；`backup_destroyed`（必要，見下面）；`story_buried`（減壓：收尾時目標勢力的敵對值不漲）；`log_wiped`（減壓：決定性階段追蹤度起始 −15）。
- **決定性的一步**：核心層的戰鬥，加上在核心節點做一次刪除：介面，標準 DC，花一回合；失敗可以再擲，每次失敗追蹤度 +10。**沒有 `backup_destroyed` 時**，刪除之後資料會從備份還原：決定性階段多一個精英（還原程式），而且要再刪一次才算達成。
- **附帶條件**：`no_trace`、`no_copy`（不准私留被刪的東西）、`no_exposure`。
- **戰敗**：`faction_default`；`fails_commission: true`（`polluted` 除外）。
- **直播目標**：通常不開（委託人多半要 `no_exposure`）。開的話：

```json
{ "id": "goal_one_pass_delete", "text": "刪除一次就成功，沒有觸發還原。", "scope": ["commission"],
  "check": { "event": "delete_attempts", "count_max": 1 }, "heat": 3, "tip_per_grade": 180 }
```

  加上 `goal_trace_under_30`。
- **報酬**：類型係數 1.0。刪掉的是伊甸園的契約紀錄時，被綁的那個人（若是 NPC）契約失效，他欠你一個大人情。
- **opinion_setup**（第 2b 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "firefight", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<client>"], "types": ["scandal"] },
             "scores": "大眾議題或偶像的醜聞（看委託人是誰）" },
  "opponent": { "id": "pr_tabloid", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["sakura", "nightingale"] },
  "from_links": [
    { "link": "backup_destroyed", "opponent_pr_first_round": -2 },
    { "link": "log_wiped",        "wind": 1 }
  ]
}
```

- **踩點會開出的路**：
  - `archive_clerk`（第 1 階段、現實）：收買內線揭開。直接拿到 `backup_found`。
  - `backup_truck`（第 2 階段、現實）：打聽揭開備份帶被運走的時間。毀掉備份的地圖換成停車場，預算 −2。
  - `retention_bug`（★、內海）：淺層駭入揭開保存程式的漏洞。刪除的檢定低一檔。
- **常配的詞條**：`offline_backup`、`airgapped`、`old_hardware`、`netvigil_sweep`、`reporter_on_site`。

### 竄改（`ct_type_tamper`）

- **主面**：內海。決定性的一步是改掉一份紀錄：契約的條款、前科、票數、人事、帳目。
- **委託人**：想改契約的人、市警裡的人、同人比賽的參賽者、選角落選的藝人、企業的中層。
- **目標勢力**：夜鶯（橋 ID 的登記）、伊甸園（契約）、市警（前科）、萬華鏡（票數與排行）、緋櫻（人事）、胭脂堂（帳）。
- **常抽的地圖**（現實的階段）：小辦公室、辦公樓層、超商、機房。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 拿到權限 | 內海、現實 | 內海：偷管理者的登入（介面，標準 DC）→ `admin_cred`。現實：活捉主管或摸到他的終端 → `admin_cred` | 一般 |
| 2a | 找到原始紀錄 | 內海、現實 | 內海：在檔案庫裡找到它與它的雜湊（調查，標準 DC）→ `original_found`。現實：找到紙本或離線的那一份（隱匿 3 級）→ `original_found` | 一般 |
| 2 | 鋪路，讓改過的版本有人信 | 輿論、內海 | 輿論：先放出改過的版本的說法（短戰）→ `version_believed`。內海：在別的系統裡種下對得上的紀錄 → `cross_refs` | 一般 |
| 2b | 證人 | 現實、輿論 | 現實：找到記得原本版本的人（交涉或威嚇，標準 DC）→ `witness_handled`。輿論：讓他說的話沒人信（短戰）→ `witness_handled` | 輕 |
| ★ | 改掉紀錄 | 內海 | 見下面 | 首領戰（核心層） |

- **類型特有的連動**：`original_found`（代勞：決定性階段不必找，改動的檢定低一檔）；`version_believed`（減壓：收尾時不會被翻案；決定性階段追蹤度起始 −15）；`cross_refs`（減壓：改動的檢定低一檔）；`witness_handled`（`cm_tm_witness` 不會發生）。
- **決定性的一步**：核心層的戰鬥中，在紀錄節點連續過兩次介面，標準 DC（各花一回合）。兩次都成功才算改好；有 `original_found` 與 `cross_refs` 時各低一檔。
- **附帶條件**：`no_trace`、`no_copy`、`no_exposure`。
- **戰敗**：`faction_default`；`fails_commission: true`（`polluted` 除外）。
- **直播目標**：`goal_trace_under_30`、`goal_op_major`（有輿論的才抽），加上：

```json
{ "id": "goal_seamless_edit", "text": "兩次改動都沒有失敗過。", "scope": ["commission"],
  "check": { "event": "edit_check_fail", "count_max": 0 }, "heat": 3, "tip_per_grade": 180 }
```

- **報酬**：類型係數 1.1。
- **opinion_setup**（第 2、2b 階段選輿論，短戰）：

```json
"opinion_setup": {
  "topic": { "kind": "whitewash", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<client>"], "types": ["record"] },
             "scores": "小眾議題或街頭的事（看紀錄屬於誰）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 1, "wind": -3, "cells": ["<opposite_of_opponent>"] },
  "from_links": [
    { "link": "original_found", "add_card": "card_doctored_doc" },
    { "link": "cross_refs",     "wind": 2 }
  ]
}
```

- **踩點會開出的路**：
  - `lazy_admin`（第 1 階段、內海）：淺層駭入揭開管理者重複用的密碼。直接拿到 `admin_cred`。
  - `paper_copy`（第 2a 階段、現實）：打聽揭開紙本放在哪。不必探索。
  - `audit_window`（★、內海）：打聽揭開稽核程式不跑的時段。決定性階段追蹤度起始 −10。
- **常配的詞條**：`subnet_maintenance`、`netvigil_sweep`、`hot_topic`、`lawyers_ready`、`double_booked`。

### 心智（`ct_type_mind`）

- **主面**：內海。決定性的一步是對目標的橋造成指定的精神污染：**讓他忘記**一段事、**讓他崩潰**、或**讓他聽話**（在他的橋裡種一個調校）。簡報會說是哪一種。
- **委託人**：胭脂堂（讓證人忘記）、夜宴社、想讓前任忘掉自己的人、對立企業（讓對方的主管崩潰）、牆語者（讓人往牆那邊走）、流竄 AI。
- **目標勢力**：目標本人所屬的勢力；他的橋由那個勢力的潛網者或蕾絲守。
- **常抽的地圖**（現實的階段）：公寓、俱樂部的感官包廂、潛艙店、宅邸、診所。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 讓他上線 | 現實、輿論 | 現實：讓他待在接得上線的地方（誘惑或交涉，標準 DC）→ `target_online`。輿論：放出一件他一定會上線去看的事（短戰）→ `target_online` | 輕 |
| 2a | 他身邊的人 | 現實、內海 | 現實：支開他的保鑣或伴侶（交涉或誘惑，標準 DC）→ `guard_turned`。內海：關掉他的個人防護的告警 → `panic_off` | 一般 |
| 2 | 進他的橋 | 內海 | 內海：從他常用的感官帶裡藏一個入口（介面 3 級）→ `bridge_entered` | 一般 |
| 2b | 記憶的深處 | 內海 | 內海：找到要動的那一段（調查，標準 DC）→ `memory_marked`；`cm_mi_glimpse` 在這裡權重 ×2 | 一般 |
| ★ | 動手 | 內海 | 見下面 | 首領戰 |

- **類型特有的連動**：`target_online`（必要：沒有它，第 2 階段開不了；第 1 階段兩面都給，所以做完一定有）；`panic_off`（減壓：決定性階段追蹤度到 90 時他不會自己斷線）；`bridge_entered`（代勞：決定性階段直接從他的核心開始）；`memory_marked`（減壓：動手的檢定低一檔）。
- **決定性的一步**：他的化身是首領，守著的構裝是雜兵。先把他的化身釘住（CYBERSPACE 的釘住），再在相鄰的格子做一次介面，標準 DC，花一回合：忘記（刪掉一段記憶）、崩潰（他的沉溺 +20、過載兩次）、聽話（種一個調校，照 CYBERWARE 的調校規則）。失敗時他掙脫一次，要重新釘住。
- **成人的標記**：「聽話」是 🔞 題材，標 `target_unwilling`、`puppet_amnesia`（忘記的版本）或 `contract_dom`（聽話的版本）；篩選關掉時，簡報只會開出「忘記」與「崩潰」。
- **附帶條件**：`no_trace`（他不能知道有人動過）、`no_exposure`。
- **戰敗**：`polluted`（他的防護把你們的橋反寫一段），`fails_commission: false`，醒在這個階段的開頭；他是企業的人、由粉蕾絲守時改用 `pinned`，`true`。
- **直播目標**：只在流竄 AI 當委託人時抽（地下頻道）：

```json
{ "id": "goal_one_pin", "text": "只釘住他一次就完成。", "scope": ["commission"],
  "check": { "event": "pin_attempts", "count_max": 1 }, "heat": 3, "tip_per_grade": 200, "channel": "underground" }
```

  加上 `goal_trace_under_30`。
- **報酬**：類型係數 1.2。做的是「聽話」時，主角的沉溺 +2（碰了別人的橋太深）。
- **opinion_setup**（第 1 階段選輿論，短戰；議題是要讓他上線去看的那件事）：

```json
"opinion_setup": {
  "topic": { "kind": "smear", "rounds": 4,
             "involves": { "factions": ["<target_faction>"], "people": ["<target>"], "types": ["gossip"] },
             "scores": "小眾議題" },
  "opponent": { "id": "pr_<target_faction>", "strength": 1 },
  "base": { "voice": 2, "wind": 0, "cells": ["tape"] },
  "from_links": []
}
```

  這一場只要打完就給 `target_online`；勝負照常換成 `op_major`／`op_minor`／`op_lost`。
- **踩點會開出的路**：
  - `his_capsule`（第 1 階段、現實）：打聽揭開他常去的潛艙店。不必擲就拿到 `target_online`。
  - `favorite_tape`（第 2 階段、內海）：淺層駭入揭開他常看的感官帶。直接拿到 `bridge_entered`。
  - `old_wound`（★、內海）：進人偶館當班或打聽揭開他的心事。動手的檢定低一檔。
- **常配的詞條**：`target_paranoid`、`pink_nest`、`old_hardware`、`target_drunk`、`single_logout`。

### 網內打撈（`ct_type_salvage`）

- **主面**：內海，而且只有內海。決定性的一步是把東西從沉船帶帶出來：大潮崩之前的程式、失落的資料、一個印記。
- **委託人**：地下層的書店、同人眾、收藏家、印記的家屬、流竄 AI。
- **目標勢力**：沒有。敵人是殘留的程式（遺魂）、野生的蕾絲與別的拾荒者；沉船帶沒有追蹤度。
- **壓力**（本稿補的規則）：沉船帶越深，登出的訊號越弱。每過一個階段，那一階段的遭遇預算比前一階段多 1；在決定性階段主動斷線要多花一回合。

| # | 階段 | 可選的面 | 各面：分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 下潛 | 內海 | 強攻；沿著舊的連結走（介面 3 級）；用撈來的航圖（踩點）→ `wreck_charted` | 一般 |
| 2a | 另一艘船的殘骸 | 內海 | 強攻；繞過去（隱匿，標準 DC）；跟拾荒的人談（交涉，標準 DC）→ `scavenger_deal` | 一般 |
| 2 | 找到它 | 內海 | 強攻；聽印記指路（交涉或同步，標準 DC）→ `item_found` | 一般 |
| 2b | 漩渦 | 內海 | 強攻；繞開快感漩渦（定力，標準 DC）；從中間穿過去（不擲，感載 +10，沉溺 +1）→ `shortcut_taken` | 一般 |
| ★ | 帶出來 | 內海 | 見下面 | 首領戰 |

- 這一型是 COMMISSIONS 7.1 節寫明的例外：每個階段只有內海，沒有輔助面；變化來自分支。
- **類型特有的連動**：`wreck_charted`（代勞：第 2 階段不必探索）；`scavenger_deal`（減壓：決定性階段的預算 −2；收尾時分他一件撈到的東西）；`item_found`（代勞：決定性階段直接從守著它的東西前面開始）；`shortcut_taken`（代勞：決定性階段斷線不必多花一回合）。
- **決定性的一步**：守著那樣東西的是首領（遺魂或野生的高階蕾絲）。打贏、或拿到東西後撐到登出點（3 回合）都算達成。
- **附帶條件**：`intact`、`no_copy`；印記類的打撈另有 `imprint_untouched`（不准和印記說話以外的事，本稿新增，違反條件是對印記用了管理行動）。
- **戰敗**：`polluted`，`fails_commission: false`，醒在這個階段的開頭。
- **直播目標**：

```json
{ "id": "goal_talk_to_imprint", "text": "和一個印記說上話。", "scope": ["commission"],
  "check": { "event": "imprint_dialogue", "count_min": 1 }, "heat": 3, "tip_per_grade": 150, "channel": "underground" }
{ "id": "goal_through_vortex", "text": "從漩渦中間穿過去。", "scope": ["commission"],
  "check": { "event": "branch_taken", "branch": "vortex_through" }, "heat": 3, "tip_per_grade": 180 }
```

  加上 `goal_no_one_down`。
- **報酬**：類型係數 0.7；另外撈到一件隨機的構裝，等級是副本的等級到 +1（V 級除外）。
- **opinion_setup**：沒有輿論階段。
- **踩點會開出的路**：沉船帶不能實地勘查，只有三種手段有用：打聽（拾荒的人）、淺層駭入（船的外層）、買情報。
  - `old_chart`（第 1 階段）：買情報或打聽揭開。直接拿到 `wreck_charted`。
  - `known_scavenger`（第 2a 階段）：打聽揭開。談判不擲。
  - `guardian_type`（★）：淺層駭入揭開守著它的是什麼。決定性那一場你看得到敵方的配置。
- **常配的詞條**：`old_hardware`、`single_logout`、`rival_crew`、`pink_nest`、`wall_whisper`。

### 抹黑（`ct_type_smear`）

- **主面**：輿論。決定性的一步是贏下最後一場六回合的輿論戰（議題的類型 `smear`，小勝以上）。COMMISSIONS 第 10 節的抹黑例子就是這一型的小型。
- **委託人**：對立的企業、政敵、玻璃岸的製作人、被害者、另一個主播。
- **目標勢力**：一個人或一個勢力：星旗的領事、緋櫻的主管、伊甸園的樓面、偶像、幫派的老大。
- **常抽的地圖**（現實的階段）：俱樂部、旅館、辦公樓層、宅邸、片場。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找料 | 現實、內海 | 現實：跟拍、偷拍（隱匿 3 級）→ `live_footage`；認識他的秘書（誘惑或交涉，標準 DC）→ `aide_turned`。內海：進他的子網拿郵件 → `inside_mail` | 一般 |
| 2a | 第二份料 | 現實、內海 | 現實：找到被他害過的人（街頭直覺，標準 DC）→ `victim_found`。內海：讀他的帳 → `ledger` | 一般 |
| 2 | 備料，或先放風聲 | 現實、內海、輿論 | 現實：把料拿去給專家看（調查，標準 DC）→ `verified`。內海：駭進平台 → `platform_hacked`。輿論：先放風聲（短戰）→ `op_major`／`op_minor`／`op_lost` | 一般 |
| 2b | 引他出錯 | 現實、輿論 | 現實：在公開場合激他（威嚇或表演，標準 DC）→ `caught_on_mic`。輿論：在他回應之前先定調（短戰）→ 同上 | 輕 |
| ★ | 輿論戰 | 輿論 | 完整的六回合 | 無（「找上門」照 OPINION 第 6 節） |

- **類型特有的連動**：`aide_turned`（對手第一回合少 2 點公關點）；`victim_found`（牌庫多一張「當事人的訪談」說法牌，風向 +2）；`ledger`（牌庫多一張「帳目」料，聲量 +3）；`verified`（牌庫裡所有的料可信，對手的「否認」第一次無效）；`caught_on_mic`（開場風向 +2）。
- **決定性的一步**：六回合的輿論戰，小勝以上算達成；平手或敗就是委託失敗。對手落後 4 分以上時會「找上門」：玩家在編輯台時用數值結算（OPINION 第 6 節）。
- **附帶條件**：`no_exposure`（委託人不能被扯出來）、`make_it_public`（要大勝）、`no_copy`。
- **戰敗**：現實與內海的階段用 `faction_default`；找上門擋不住時，幫派與星旗是主播被抓，進那一方的戰敗事件；`fails_commission: true`。
- **直播目標**：`goal_op_major`，加上：

```json
{ "id": "goal_board_wipe", "text": "把對手的格子清空。", "scope": ["commission"],
  "check": { "event": "opinion_cells_cleared", "side": "opponent" }, "heat": 3, "tip_per_grade": 250, "channel": "news" }
{ "id": "goal_no_fake", "text": "整場沒有打出假料。", "scope": ["commission"],
  "check": { "event": "fake_card_played", "count_max": 0 }, "heat": 3, "tip_per_grade": 150, "channel": "news" }
```

- **報酬**：類型係數 1.0；大勝 ×1.2。目標勢力的敵對值 +3（輿論的階段留下一個公開的敵人）。
- **opinion_setup**（決定性的那一場）：

```json
"opinion_setup": {
  "topic": { "id": "tp_<generated>", "kind": "smear", "rounds": 6,
             "involves": { "factions": ["<target_faction>"], "people": ["<target>"], "types": ["scandal", "crime"] },
             "scores": "大眾議題（企業）／偶像的醜聞（偶像）／街頭的事（幫派），分數集中在目標所在的圈子" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["murmur"] },
  "from_links": [
    { "link": "inside_mail",     "add_card": "card_inside_scoop" },
    { "link": "live_footage",    "voice": 3 },
    { "link": "ledger",          "add_card": "card_ledger" },
    { "link": "victim_found",    "add_card": "card_testimony" },
    { "link": "verified",        "deny_first_null": true },
    { "link": "aide_turned",     "opponent_pr_first_round": -2 },
    { "link": "platform_hacked", "cells": ["nightingale"] },
    { "link": "bought_slot",     "cells": ["sakura"] },
    { "link": "caught_on_mic",   "wind": 2 },
    { "link": "op_major",        "cells": ["tape"], "voice": 2 },
    { "link": "op_minor",        "voice": 2 },
    { "link": "op_lost",         "wind": -2 }
  ]
}
```

- **踩點會開出的路**：
  - `his_haunt`（第 1 階段、現實）：打聽揭開他常去的地方。偷拍不擲。
  - `disgruntled_aide`（第 1 階段、現實）：打聽或收買內線揭開。直接拿到 `aide_turned`。
  - `mail_relay`（第 1 階段、內海）：淺層駭入揭開。內海那一段不必探索。
  - `editor_friend`（第 2 階段、輿論）：買情報揭開一位肯幫忙的編輯。短戰開場多佔一格。
- **常配的詞條**：`opponent_preempt`、`bot_army`、`lawyers_ready`、`hot_topic`、`double_booked`、`idol_involved`。

### 爆料（`ct_type_expose`）

- **主面**：輿論。決定性的一步是贏下最後一場六回合的輿論戰（議題的類型 `ignite`）。沒有證據的爆料，牌庫裡只有基本牌。
- **委託人**：記者、想說出來的內部人、牆報、素體教、萬華鏡（它也收料）。
- **目標勢力**：企業最多（蜜腺、伊甸園、黑泉、緋櫻、天使急救），也有市警與幫派。
- **常抽的地圖**（現實的階段）：小型實驗室、工廠、診所、碼頭貨櫃區、片場、檢查哨。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找證據 | 現實、內海 | 現實：進現場拍下來（隱匿 3 級）→ `live_footage`。內海：拿內部文件 → `inside_mail` | 一般 |
| 2a | 保護消息來源 | 現實、輿論 | 現實：把爆料的人藏好（交涉或街頭直覺，標準 DC）→ `source_safe`。輿論：先替他建立可信度（短戰）→ `source_credible` | 輕 |
| 2 | 查證，或先放風聲 | 現實、內海、輿論 | 現實：帶證據去給專家看（調查，標準 DC）→ `verified`。內海：比對別的系統的紀錄 → `verified`。輿論：先放風聲（短戰）→ 照結果 | 一般 |
| 2b | 第二個來源 | 現實、內海 | 現實：找到第二個肯說的人（交涉，標準 DC）→ `second_source`。內海：找到對得上的帳目或通訊 → `second_source` | 一般 |
| ★ | 輿論戰 | 輿論 | 完整的六回合 | 無 |

- **類型特有的連動**：`source_safe`（`cm_ex_source_scared` 不會發生；收尾時消息來源不會出事）；`source_credible`（開場風向 +1）；`verified`（牌庫裡的料都是真的；對手的「否認」第一次無效）；`second_source`（牌庫多一張說法牌，風向 +2，對手不能下架）。
- **決定性的一步**：六回合，小勝以上算達成。
- **附帶條件**：`on_record`、`no_exposure`（消息來源不能曝光）、`no_copy`（委託人要獨家）。
- **戰敗**：同抹黑。
- **直播目標**：`goal_op_major`，加上：

```json
{ "id": "goal_truth_only", "text": "只用真的料贏下決定性的那一場。", "scope": ["commission"],
  "check": { "event": "opinion_win_with_fake", "count_max": 0 }, "heat": 3, "tip_per_grade": 220, "channel": "news" }
{ "id": "goal_source_safe", "text": "消息來源整趟沒有出事。", "scope": ["commission"],
  "check": { "event": "link_held", "link": "source_safe" }, "heat": 3, "tip_per_grade": 150, "channel": "news" }
```

- **報酬**：類型係數 0.8；這一趟產出的素材歸主角（沒有 `no_copy` 時），公信力 +。
- **opinion_setup**：

```json
"opinion_setup": {
  "topic": { "id": "tp_<generated>", "kind": "ignite", "rounds": 6,
             "involves": { "factions": ["<target_faction>"], "people": [], "types": ["crime", "scandal"] },
             "scores": "大眾議題（企業醜聞）" },
  "opponent": { "id": "pr_<target_faction>", "strength": "照共通規則" },
  "base": { "voice": 1, "wind": 0, "cells": ["relay"] },
  "from_links": [
    { "link": "live_footage",    "voice": 3 },
    { "link": "inside_mail",     "add_card": "card_inside_scoop" },
    { "link": "verified",        "deny_first_null": true },
    { "link": "second_source",   "add_card": "card_second_source" },
    { "link": "source_credible", "wind": 1 },
    { "link": "op_major",        "cells": ["wall"], "voice": 2 },
    { "link": "op_minor",        "voice": 2 },
    { "link": "op_lost",         "wind": -2 }
  ]
}
```

  沒有拿到 `live_footage`、`inside_mail`、`second_source` 任何一個時，牌庫只有基本牌，開場風向 −1。
- **踩點會開出的路**：
  - `night_shipment`（第 1 階段、現實）：打聽揭開出貨的時間。拍現場的那一場遭遇少一半。
  - `whistle_contact`（第 2b 階段、現實）：打聽揭開第二個想說的人。交涉不擲。
  - `lab_archive`（第 1 階段、內海）：淺層駭入揭開。內海那一段不必探索。
- **常配的詞條**：`inside_man`、`reporter_on_site`、`kaleido_interested`、`lawyers_ready`、`hot_topic`。

### 滅火（`ct_type_firefight`）

- **主面**：輿論。決定性的一步是守住：議題的類型 `firefight`，你是公關，開場佔著主流那一排的兩格，對手從街頭的一格打上來；結算時分數比對手高算達成。萬華鏡不會當滅火的對手。
- **委託人**：被拍的藝人、偶像的事務所、企業的公關部、委託人自己（`cm_pr_skeleton`）。
- **目標勢力**（手上有料的那一方）：狗仔、另一個主播、對立的企業、勒索的人、牆報。
- **常抽的地圖**（現實的階段）：片場、旅館、公寓、俱樂部、小辦公室。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 找出對方手上的料 | 現實、內海 | 現實：找到拍的人（街頭直覺，標準 DC）→ `leak_located`。內海：進他的雲端看他有什麼 → `leak_located` 與 `leak_contents` | 一般 |
| 2a | 找到帶子的副本 | 現實、內海 | 現實：找到他藏的那一份（調查，標準 DC）→ `copy_found`。內海：找出同步到別處的那一份 → `copy_found` | 一般 |
| 2 | 毀掉它、買下它，或先帶風向 | 現實、內海、輿論 | 現實：毀掉實體的帶子（機械，標準 DC）或買下它（交涉，付等級 × 500）→ `source_destroyed`。內海：刪掉它 → `source_destroyed`。輿論：先帶風向（短戰）→ 照結果 | 一般 |
| 2b | 處理爆料的人 | 現實、輿論 | 現實：說服他不發（交涉或威嚇，標準 DC 高一檔）→ `leaker_quiet`。輿論：先讓他的可信度掉下去（短戰）→ `leaker_discredited` | 輕 |
| ★ | 輿論戰 | 輿論 | 完整的六回合，守住 | 無 |

- **類型特有的連動**：`leak_located`（代勞：第 2 階段的現實不必探索）；`leak_contents`（你知道他有哪些料：對手的牌你看得到）；`copy_found`（`cm_ff_tape_copy` 不會發生）；`source_destroyed`（對手的公關點每回合 −1）；`leaker_quiet`（對手強度 −1，最少 1）；`leaker_discredited`（對手所有的「料」聲量 −1）。
- **決定性的一步**：六回合守住。開場你佔主流那一排的兩格（緋櫻映畫與夜鶯直播，或萬華鏡與其中一格），對手從街頭打上來。
- **附帶條件**：`no_exposure`（委託人不能和這件事扯上關係）、`no_copy`（不准私留那份料）、`no_kill`。
- **戰敗**：現實與內海的階段用手上有料那一方的勢力預設，狗仔是 `exposed`；`fails_commission: true`。
- **直播目標**：通常不開（違反 `no_exposure`）。委託人是想翻身的偶像、同意直播時：

```json
{ "id": "goal_hold_all", "text": "決定性的那一場沒有丟掉任何一格。", "scope": ["commission"],
  "check": { "event": "opinion_cell_lost", "count_max": 0 }, "heat": 3, "tip_per_grade": 220, "channel": "gossip" }
{ "id": "goal_tape_gone", "text": "每一份帶子都毀掉了。", "scope": ["commission"],
  "check": { "event": "link_count", "link": "source_destroyed", "count_min": 2 }, "heat": 3, "tip_per_grade": 150 }
```

- **報酬**：類型係數 1.1。私留那份料是背刺（委託人的敵對值 +5，料可以當素材）。
- **opinion_setup**：

```json
"opinion_setup": {
  "topic": { "id": "tp_<generated>", "kind": "firefight", "rounds": 6,
             "involves": { "factions": [], "people": ["<client>"], "types": ["scandal", "gossip"] },
             "scores": "偶像的醜聞（委託人是偶像）／大眾議題（企業）" },
  "opponent": { "id": "pr_<leaker>", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["sakura", "nightingale"] },
  "from_links": [
    { "link": "source_destroyed",   "opponent_pr_per_round": -1 },
    { "link": "leaker_quiet",       "opponent_strength": -1 },
    { "link": "leaker_discredited", "opponent_fuel": -1 },
    { "link": "leak_contents",      "reveal_opponent": true },
    { "link": "op_major",           "cells": ["kaleido"] },
    { "link": "op_minor",           "wind": 1 },
    { "link": "op_lost",            "wind": -2 }
  ]
}
```

- **踩點會開出的路**：
  - `paparazzi_car`（第 1 階段、現實）：實地勘查揭開狗仔的車。直接拿到 `leak_located`。
  - `cloud_sync`（第 2a 階段、內海）：淺層駭入揭開。直接拿到 `copy_found`。
  - `leaker_debt`（第 2b 階段、現實）：打聽揭開爆料的人欠錢。說服不擲，但要付等級 × 300。
- **常配的詞條**：`opponent_preempt`、`bot_army`、`idol_involved`、`hot_topic`、`reporter_on_site`。

### 造勢／洗白（`ct_type_promote`）

- **主面**：輿論。決定性的一步是贏下最後一場六回合的輿論戰。**造勢**用 `ignite`（替一個人、一間店、一場活動拉聲量）；**洗白**用 `whitewash`（對手已經佔了三格，你只有它對面的一格，風向 −3，要反超）。簡報會說是哪一種。
- **委託人**：偶像與地下偶像、新開的店、想翻身的主管、親衛隊的團長、被醜聞拖垮的人。
- **目標勢力**（對手）：競爭的事務所或店、萬華鏡（造勢時它常常是對手，從中央開場）、之前爆料的那一方（洗白）。
- **常抽的地圖**（現實的階段）：live house、片場、商店街、俱樂部。

| # | 階段 | 可選的面 | 各面：強攻以外的分支 → 給的連動 | 遭遇 |
|---|---|---|---|---|
| 1 | 備料 | 現實、輿論 | 現實：拍一段好看的素材（表演，標準 DC）→ `good_footage`。輿論：先在圈子裡試水溫（短戰）→ 照結果 | 輕 |
| 2a | 拍新的素材 | 現實、輿論 | 現實：辦一場小活動、讓人看見（表演或交涉，標準 DC）→ `crowd_shot`。輿論：請圈子裡的人轉（短戰）→ 照結果 | 輕 |
| 2 | 鋪路 | 內海、輿論 | 內海：駭進平台，讓推薦演算法先推一輪 → `platform_hacked`。輿論：先打一場小的（短戰）→ 照結果 | 一般 |
| 2b | 找人背書 | 現實、內海 | 現實：找一位有名的人背書（交涉或誘惑，標準 DC 高一檔）→ `endorsement`。內海：清掉對方留下的舊料 → `old_dirt_cleared` | 輕 |
| ★ | 輿論戰 | 輿論 | 完整的六回合 | 無 |

- **類型特有的連動**：`good_footage`（牌庫多一張「英雄」說法牌，風向 +2）；`crowd_shot`（開場聲量 +3）；`endorsement`（開場佔著應援圈或同人圈其中一格）；`old_dirt_cleared`（洗白時開場風向的 −3 改成 −1）。
- **決定性的一步**：造勢是分數比對手高；洗白是分數反超。
- **附帶條件**：`no_exposure`（不能讓人知道是買來的）、`no_copy`、`on_record`。
- **戰敗**：現實與內海的階段用對手的勢力預設，親衛隊是 `exposed` 或 `lesson`；`fails_commission: true`。
- **直播目標**：`goal_op_major`，加上：

```json
{ "id": "goal_take_center", "text": "決定性的那一場結束時佔著萬華鏡那一格。", "scope": ["commission"],
  "check": { "event": "opinion_cell_held_end", "cell": "kaleido" }, "heat": 3, "tip_per_grade": 220 }
{ "id": "goal_wind_up", "text": "決定性的那一場結束時風向在 +3 以上。", "scope": ["commission"],
  "check": { "event": "opinion_wind_end", "value_min": 3 }, "heat": 3, "tip_per_grade": 180 }
```

- **報酬**：造勢的類型係數 0.9，洗白 1.2。委託人是偶像時，主角的人氣也小漲。
- **opinion_setup**：

```json
"opinion_setup": {
  "topic": { "id": "tp_<generated>", "kind": "ignite 或 whitewash", "rounds": 6,
             "involves": { "factions": [], "people": ["<client>"], "types": ["idol", "event"] },
             "scores": "偶像的醜聞那一列（偶像）／小眾議題（店與活動）" },
  "opponent": { "id": "pr_<rival> 或 pr_kaleido", "strength": "照共通規則" },
  "base": { "voice": 2, "wind": 0, "cells": ["wall"] },
  "base_whitewash": { "voice": 1, "wind": -3, "cells": ["<opposite_of_opponent>"] },
  "from_links": [
    { "link": "good_footage",     "add_card": "card_hero_clip" },
    { "link": "crowd_shot",       "voice": 3 },
    { "link": "platform_hacked",  "cells": ["nightingale"] },
    { "link": "endorsement",      "cells": ["fanclub"] },
    { "link": "old_dirt_cleared", "wind": 2 },
    { "link": "op_major",         "cells": ["doujin"], "voice": 2 },
    { "link": "op_minor",         "voice": 2 },
    { "link": "op_lost",          "wind": -2 }
  ]
}
```

- **踩點會開出的路**：
  - `open_stage`（第 2a 階段、現實）：打聽揭開一個今晚空著的舞台。活動不擲。
  - `algo_window`（第 2 階段、內海）：淺層駭入揭開平台推薦的時段。直接拿到 `platform_hacked`。
  - `old_friend`（第 2b 階段、現實）：打聽揭開委託人以前認識的名人。背書的檢定低一檔。
- **常配的詞條**：`slow_news_day`、`hot_topic`、`kaleido_interested`、`idol_involved`、`bot_army`。

---

## 詞條

詞條是一兩個讓這一次不一樣的條件（COMMISSIONS 第 9 節）。同一型委託的模板相同，換了詞條，玩法就不同：哪一面被鎖掉、哪一段多一條路、哪一場多一個精英、輿論戰從哪裡開始。

### 共通規則

- **數量**：小型 1 個；中型 1～2 個（各半）；大型 2 個。
- **抽法**：從「適用」符合這件委託的詞條裡照權重抽；條件寫了區、勢力、等級或地圖的，不符合就不進籤筒。同一件不抽互斥的兩個。第一個抽到「麻煩」時，第二個從「機會」與「兩面」裡抽的權重 ×2。
- **種類**：**麻煩**（讓這一趟更難）、**機會**（多一條路或少一些敵人）、**兩面**（換一種打法，有好有壞）。
- **作用在**：「全程」、「某一面」或「指定的階段」。指定階段的詞條在生成時就決定落在哪一個階段，不能落在決定性的階段，除非那個詞條寫明。
- **鎖面的詞條**：只能鎖非決定性、非必經的階段；鎖完之後副本仍要至少有一個階段可以選兩面以上（網內打撈除外）。做不到時改鎖另一個階段，再做不到就重抽。
- **揭開**：詞條是未知清單的一類，用「打聽」或「以採訪為名」揭開（FIXER 第 2 節）。揭開了，簡報上寫出它與作用的階段。沒揭開的：
  - 麻煩與兩面：照「最壞的時機」，落在玩家第一次選了受影響的那一面的那個階段；鎖面的詞條例外，到那個階段才看到那一面被鎖。
  - 機會：照樣生效，但它開出的分支要在那個階段當場發現：調查或街頭直覺，標準 DC，失敗就看不到這條路。
- **談判**（本稿補的規則）：接案時已經揭開、或踩點後回去找中間人揭穿的麻煩詞條，每一個可以在談判時換報酬 +10%，一件最多 +20%。
- **和事件的關係**：很多詞條讓 EVENTS_CITY「委託副本內」的某件事件權重變高或必定擲到。必定擲到的事件不佔「一個階段最多一件」的名額。

下面的「標準 DC」與「低一檔」照「十九種類型的模板」的共通約定。

### 一、現場（現實面）

#### 今晚有派對（`party_tonight`）
- **種類**：兩面。**作用在**：指定的一個現實階段。
- **效果**：那個階段的地圖滿是賓客，人群算半掩。潛行分支換成「混進賓客」（表演或誘惑，標準 DC 低一檔）。那一場的遭遇預算 −1（保全分散在場內），但現場開槍時警戒 +20，而且違反 `no_collateral` 的機會變大。`cm_party_tonight` 在這個階段必定擲到。
- **適用**：暗殺、挖角、蜜罐、接待、竊密、奪取、抹黑、爆料；地圖是俱樂部、宅邸、辦公樓層、片場、live house、旅館。**權重**：3。

#### 正在換班（`shift_change`）
- **種類**：機會。**作用在**：指定的一個現實階段。
- **效果**：那個階段多一條「換班的空檔」分支（隱匿，標準 DC 低一檔），走這條路不必探索。選強攻的話，兩班的人都在，遭遇預算 +1。`cm_shift_change` 在這個階段權重 ×3。
- **適用**：所有有現實階段的類型；目標勢力是企業、市警、星旗或孤星連。**權重**：3。

#### 下雨（`rain`）
- **種類**：兩面。**作用在**：全程，現實面。
- **效果**：距離 5 以上的射擊命中 −2；隱匿檢定 +2；警戒每次上漲 −5（最少 0）；運動與操縱的檢定高一檔。狙擊位的動手檢定高一檔。
- **適用**：所有有現實階段的類型；地圖在戶外或有戶外段（屋頂、碼頭貨櫃區、停車場、商店街、檢查哨），或護送。**權重**：2。

#### 停電（`blackout`）
- **種類**：兩面。**作用在**：指定的一個階段（現實與內海都受影響）。
- **效果**：那個階段的現實面直接得到 `cams_off` 與 `power_cut` 的效果，門禁與砲塔失效；同一個階段的內海面被鎖掉（子網斷電）。`cm_blackout` 在這個階段必定擲到。
- **適用**：破壞、奪取、救援、竊密、抹除、暗殺。**權重**：1。**互斥**：`subnet_maintenance`。

#### 老舊的大樓（`old_building`）
- **種類**：機會。**作用在**：全程。
- **效果**：每個現實階段多一條「舊管線與防火梯」分支（運動，標準 DC），走這條路警戒不漲。內海的子網少一層（最少 2 層），`power_cut` 的效果加倍（蕾絲降兩級）。`cm_blackout` 權重 ×2。
- **適用**：所有有現實階段的類型；區是蜂巢、舊港、鏽帶、地下層，或地圖是公寓、工廠、倉庫。**權重**：2。

#### 人手不足（`skeleton_crew`）
- **種類**：機會。**作用在**：全程，現實面。
- **效果**：現實的遭遇預算 −1；警戒 60 的增援延後一個階段。
- **適用**：所有有現實階段的類型；目標勢力的等級範圍落在副本等級的下緣時權重 ×2。**權重**：2。**互斥**：`vip_visit`、`on_alert`。

#### 剛出過事（`on_alert`）
- **種類**：麻煩。**作用在**：全程，現實面。
- **效果**：警戒起始 +20；踩點的「實地勘查」難度 +3（FIXER 第 2 節的擲法）。保全的預設打法從 `capture` 換成 `lethal`（企業）。
- **適用**：所有有現實階段的類型；這個目標勢力最近一個月內被玩家做過委託時權重 ×3。**權重**：2。**互斥**：`skeleton_crew`。

#### 新裝的掃橋閘門（`new_scan_gate`）
- **種類**：麻煩。**作用在**：指定的一個現實階段。
- **效果**：那個階段所有偽裝與表演的分支高一檔；`staff_cred` 與 `keycard` 開出來的分支要另外過一次介面，標準 DC。沒有橋的人（素體教的同伴）不受影響。`cm_new_scan_gate` 必定擲到。
- **適用**：竊密、奪取、暗殺、挖角、救援；目標勢力是緋櫻、夜鶯、崑崙、貞網局。**權重**：2。

#### 大人物來訪（`vip_visit`）
- **種類**：麻煩。**作用在**：全程，現實面。
- **效果**：每一場現實遭遇的預算 +1；決定性階段多一個精英（大人物的保鑣）。蜜罐與接待改成兩面：大人物可以換成目標（把柄的品質 +1、接待的報酬 ×1.3），但他的保鑣讓強攻的預算再 +2。
- **適用**：暗殺、蜜罐、接待、挖角、奪取、竊密；等級 III 以上；區是冠冕區、玻璃岸、櫻町。**權重**：1。**互斥**：`skeleton_crew`。

#### 車庫裡有機甲（`mech_present`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：決定性那一場多一台機甲（精英，2.5 點），從第二回合起進場。踩點揭開了的話，可以在前一個現實階段多一條分支「把它弄壞」（機械，標準 DC 高一檔），成功就不出場。`cm_mech_in_garage` 權重 ×3。
- **適用**：暗殺、破壞、奪取、救援、護送；目標勢力是星旗、黑泉、緋櫻、孤星連；等級 III 以上。**權重**：1。

#### 機械獵犬（`hounds`）
- **種類**：麻煩。**作用在**：全程，現實面。
- **效果**：潛行分支高一檔；每一場現實遭遇多兩隻小型無人機（各 0.5 點，用機械獵犬的數值）。對獵犬有效的電磁武器傷害 +2。
- **適用**：所有有現實階段的類型；目標勢力是黑泉、織女、星旗。**權重**：2。

#### 人潮（`crowded`）
- **種類**：兩面。**作用在**：指定的一個現實階段（護送是「路上」那一段）。
- **效果**：那個階段平民在場：不能用打兩格以上的範圍武器（違反 `no_collateral`），人群算半掩，隱匿 +2；敵方也不用 `lethal`。護送與救援時被護送的人更難被鎖定（敵方對他的命中 −2）。
- **適用**：護送、救援、討債、暗殺、獵溺；區有祭典組在活動、或城裡正在辦活動。**權重**：2。

#### 封街與臨檢（`curfew`）
- **種類**：麻煩。**作用在**：指定的一個現實階段。
- **效果**：那個階段的地圖換成檢查哨；多一條「交涉過關」（交涉，標準 DC）與「從排水道繞」（運動，標準 DC 高一檔）的分支。強攻時增援是市警，打倒市警的人收尾時市警的敵對值 +2。`cm_es_roadblock` 必定擲到。
- **適用**：護送、救援、挖角、獵溺；這一區有封街或臨檢加強的區域狀態時權重 ×3。**權重**：1。

#### 市警在掃街（`police_sweep`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：警戒 60 的增援換成市警（不聽目標勢力指揮，雙方都打）；被市警打倒的戰敗事件是 `police`。收尾時要過一次隱匿或交涉，標準 DC，失敗市警的敵對值 +2。
- **適用**：所有有現實階段的類型；區是蜂巢、四十二番街、櫻町（有繳治安費的區）。**權重**：2。

#### 有內應（`inside_man`）
- **種類**：機會。**作用在**：指定的一個現實階段。
- **效果**：那個階段多一條交涉分支「內應開門」，不擲，走這條路不必探索。之後的階段 `cm_insider_cold_feet` 權重 ×2（他可能反悔）。
- **適用**：所有有現實階段的類型。**權重**：2。

#### 另一隊人也在裡面（`rival_crew`）
- **種類**：麻煩。**作用在**：全程，任一面。
- **效果**：`cm_rival_crew` 在第一個階段必定擲到。沒有談好或嚇走時，旗標「對頭在場」：決定性階段多一個精英（另一隊的帶頭的人），他們的人用行者的數值。
- **適用**：暗殺、破壞、奪取、救援、竊密、網內打撈（對頭是別的拾荒者）；等級 II 以上。**權重**：2。**互斥**：`double_booked`。

### 二、目標與相關的人

#### 目標不在預定的位置（`target_moved`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：決定性階段的地圖換成同一區的另一張模板；前面拿到的「決定性階段不必探索」的代勞連動失效，只有 `located` 可以抵消（有 `located` 的話照常生效）。`cm_target_moved` 在決定性的前一個階段必定擲到。
- **適用**：暗殺、挖角、救援、討債、獵溺、蜜罐。**權重**：2。

#### 目標很多疑（`target_paranoid`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：所有對目標的交涉、誘惑、表演分支高一檔；`cm_hp_bodyguard`、`cm_as_double` 權重 ×2。暗殺時有三成的機率最後一場站在首領位置的是替身（打倒替身之後真的目標在第二回合從另一側進場）。
- **適用**：暗殺、蜜罐、接待、挖角、心智。**權重**：2。**互斥**：`target_drunk`。

#### 目標喝醉了（`target_drunk`）
- **種類**：機會。**作用在**：決定性的階段（寫明可以）。
- **效果**：對目標的交涉、誘惑、威嚇低一檔；目標本人的命中 −2、先攻 −3。接待的契合起始 −1 檔（他記不住你，也不那麼挑）。心智的「讓他上線」不擲。
- **適用**：暗殺、蜜罐、接待、挖角、討債、心智。**權重**：2。**互斥**：`target_paranoid`。

#### 他認得你（`ex_acquaintance`）
- **種類**：兩面。**作用在**：全程。
- **效果**：生成時從名冊、豔名或過去的委託裡找一條主角和目標的關係。對目標的交涉與誘惑低一檔；但他的保鑣也看過你的臉，偽裝分支高一檔，`no_exposure` 只要被他本人看到就算違反。
- **適用**：蜜罐、接待、挖角、心智、討債；主角在這一區的豔名 40 以上或名冊上有和目標有關的人。**權重**：1。

#### 目標是天使急救的會員（`angel_member`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：目標被打倒後第 2 回合，天使急救的兩名急救隊員從後方進場，兩回合後連人一起離場。被搶走就是委託失敗（暗殺）或目標被帶走（挖角、救援的反方向）。要在他們離場之前把人帶到出口格，或擋住他們。
- **適用**：暗殺、挖角、獵溺；等級 III 以上。**權重**：1。

#### 被關的人走不動（`captive_weak`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：被救的人每回合只能移動一格，或由一名隊員扛著（扛的人每回合行動點 −2）。有 `captive_status` 時，帶了醫療用品的話，醫療標準 DC 成功就恢復正常。
- **適用**：救援、挖角（綁架）、護送。**權重**：2。

#### 被救的人被扣在線上（`netlocked_captive`）
- **種類**：兩面。**作用在**：全程。
- **效果**：被救的人被粉蕾絲扣線。前面最後一個非決定性的階段改成只有內海、是必經的：要先在網內把他拔出來（`cm_rs_netlocked` 必定擲到）。拔出來之後，決定性階段他能自己走，不必扛。
- **適用**：救援；目標勢力是緋櫻、夜鶯、伊甸園；救援是中型以上。**權重**：1。

#### 欠債的人家裡有人（`family_home`）
- **種類**：兩面。**作用在**：「上門」那一個階段。
- **效果**：那個階段的家裡有他的家人（成年人）。強攻的話自動違反 `no_collateral`；多一條交涉分支（交涉，標準 DC 低一檔），成功就不必打，直接拿到 `cornered`。`cm_db_family` 必定擲到。
- **適用**：討債。**權重**：3。

#### 他帶了朋友（`guest_plus_one`）
- **種類**：兩面。**作用在**：決定性的階段（寫明可以）。
- **效果**：客人多帶了一個人。成人場景變成多人（分圈，最多四對四），隊上要多一個人去陪，或主角一個人應付兩個人（契合起始 −1 檔，報酬 ×1.4）。`cm_ho_plus_one` 必定擲到。
- **適用**：接待、蜜罐。**權重**：2。

#### 客人想被看（`exhibitionist_guest`）
- **種類**：機會。**作用在**：全程。
- **效果**：客人同意、而且希望整趟被直播，副本直播可以開，而且不算偷播；直播目標從接待與共用的清單裡多抽一個。成人直播的豔名上升照常。
- **適用**：接待。**權重**：1。

#### 跟蹤的人（`stalker`）
- **種類**：麻煩。**作用在**：指定的一個非決定性階段。
- **效果**：客人或目標有一個跟蹤他的人。那個階段多一場遭遇：輕（跟蹤的人加兩個他雇來的人，用那一區的街頭勢力）。不處理的話，他會在決定性階段闖進來，場景中斷一次（契合 −1 檔）。
- **適用**：接待、蜜罐、護送（偶像）。**權重**：1。

### 三、內海面

#### 子網在維護（`subnet_maintenance`）
- **種類**：兩面。**作用在**：指定的一個非決定性階段。
- **效果**：那個階段的內海面被鎖掉。之後的內海階段，閘門的檢定低一檔（維護的人留了後門），追蹤度起始 −10。
- **適用**：所有前面的階段有內海可選的類型（主面是內海的，只能鎖第 1 或 2a 階段）。**權重**：2。**互斥**：`blackout`、`netvigil_sweep`。

#### 核心是隔離區（`airgapped`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：決定性階段前的那一個階段改成只有現實、是必經的，要拿到 `airgap_open`（COMMISSIONS 2.2 節）。小型時就是第 2 階段。
- **適用**：竊密、抹除、竄改；等級 II 以上（III 以上權重 ×2）。**權重**：2。

#### 有離線的備份（`offline_backup`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：抹除的「毀掉離線的備份」那一階段鎖成只有現實；竊密與竄改多一個條件：決定性階段完成之前，對方會從離線備份還原一次（多一個精英，見抹除的寫法）。
- **適用**：抹除、竊密、竄改。**權重**：2。

#### 貞網局在掃這一區（`netvigil_sweep`）
- **種類**：麻煩。**作用在**：全程，內海面。
- **效果**：每個內海階段追蹤度起始 +15；追蹤度到 90 的定位改走 `bridge_lock`（貞網局）。`cm_net_patrol` 權重 ×3。
- **適用**：所有有內海階段的類型；區是地下層、內海大街附近，或目標勢力是夜鶯。**權重**：2。**互斥**：`subnet_maintenance`。

#### 蕾絲全是粉的（`pink_nest`）
- **種類**：麻煩。**作用在**：全程，內海面。
- **效果**：內海遭遇裡的蕾絲全換成粉蕾絲；網內戰敗走 `pinned`。`cm_net_pink_offer` 權重 ×3。高階粉蕾絲可以被說服，所以多一條交涉分支（交涉，標準 DC 高一檔）。
- **適用**：所有有內海階段的類型；目標勢力是緋櫻、伊甸園、夜鶯。**權重**：2。

#### 舊硬體（`old_hardware`）
- **種類**：兩面。**作用在**：全程，內海面。
- **效果**：子網多一層；但追蹤度到 30 不會來白蕾絲，追蹤度每次上升 −2。`cm_net_echo` 權重 ×3。
- **適用**：所有有內海階段的類型；區是地下層、舊港、鏽帶，或網內打撈（必定可抽）。**權重**：2。

#### 登出點只有一個（`single_logout`）
- **種類**：麻煩。**作用在**：全程，內海面。
- **效果**：內海階段不能主動斷線撤退，要走到地圖上的登出點；被定位時的倒數從三回合變兩回合。
- **適用**：所有有內海階段的類型。**權重**：1。

#### 牆的聲音（`wall_whisper`）
- **種類**：兩面。**作用在**：全程。
- **效果**：每個階段開始時，隊上沉溺 50 以上的人過一次定力，標準 DC；失敗的人這個階段的檢定 −2，成功的人這個階段同步 +2。獵溺的目標在這個詞條下更危險：決定性那一場他每回合多一次「傳播」。
- **適用**：獵溺、網內打撈、心智；區是地下層深層。**權重**：1。

### 四、輿論面

#### 對手先放話（`opponent_preempt`）
- **種類**：麻煩。**作用在**：決定性的輿論戰（寫明可以），以及之前的每一場短戰。
- **效果**：開場風向 −1；對手第一回合的公關點 +2。`cm_op_preempt` 權重 ×3。
- **適用**：抹黑、爆料、滅火、造勢；對手強度 2 以上。**權重**：2。

#### 對手養了水軍（`bot_army`）
- **種類**：麻煩。**作用在**：每一場輿論戰。
- **效果**：對手每回合多 1 點公關點。玩家打出「說法」牌拆穿它時（風向 +2 的說法牌），這個詞條在那一場失效。`cm_op_bot_flood` 權重 ×3。
- **適用**：抹黑、爆料、滅火、造勢、竄改。**權重**：2。

#### 法務在待命（`lawyers_ready`）
- **種類**：麻煩。**作用在**：每一場輿論戰。
- **效果**：對手的「律師函」只花 1 點；星旗當對手時，律師函讓你 −2 點的效果不變，但第一回合就用。
- **適用**：抹黑、爆料、竄改；對手是企業。**權重**：2。

#### 全城都在談（`hot_topic`）
- **種類**：兩面。**作用在**：每一場輿論戰。
- **效果**：議題的分數萬華鏡 +1、街上的耳語 +1（上限 3）；雙方開場聲量各 +2。大勝的效果加倍（`op_major` 給兩次的效果），敗也一樣（`op_lost` 的警戒 +30）。
- **適用**：抹黑、爆料、滅火、造勢、竄改。**權重**：2。**互斥**：`slow_news_day`。

#### 冷門的消息（`slow_news_day`）
- **種類**：機會。**作用在**：每一場輿論戰。
- **效果**：議題的分數主流那一排各 −1（最少 0）、圈子那一排各 +1；對手強度 −1（最少 1）。
- **適用**：造勢、滅火、抹黑。**權重**：2。**互斥**：`hot_topic`。

#### 萬華鏡也想要這條新聞（`kaleido_interested`）
- **種類**：兩面。**作用在**：決定性的輿論戰。
- **效果**：萬華鏡那一格開場算對手的（對手多一格）；但玩家佔下萬華鏡時聲量 +3，`goal_take_center` 的打賞 ×2。
- **適用**：爆料、造勢、抹黑（滅火不適用：萬華鏡不當滅火的對手）。**權重**：1。

#### 牽涉偶像（`idol_involved`）
- **種類**：兩面。**作用在**：全程。
- **效果**：議題的分數換成「偶像的醜聞」那一列；應援圈開場算對手的。現實面的遭遇多一到兩名親衛隊的雜兵（同擔、打 call 手）。偶像本人表態時，親衛隊全體停手。
- **適用**：抹黑、滅火、造勢、爆料、挖角、護送。**權重**：1。

#### 記者在場（`reporter_on_site`）
- **種類**：兩面。**作用在**：指定的一個現實階段。
- **效果**：那個階段有記者：敵方不用 `lethal`，警戒每次上漲 +5；那個階段自動拍到現場，給 `live_footage`；隊伍有人被拍到臉的機率高，`no_exposure` 這個階段只要開槍就算違反。
- **適用**：所有有現實階段的類型；有輿論階段的類型權重 ×2。**權重**：2。

### 五、委託本身

#### 有人出價更高（`higher_bidder`）
- **種類**：兩面。**作用在**：決定性的前一個階段結束時。
- **效果**：另一方開價要你轉手：接受的話，原委託算失敗、收尾時拿到原報酬的 1.3 倍（委託人勢力敵對值 +5，原中間人的關係重挫）；拒絕的話，出價的那一方派人：決定性階段預算 +2。
- **適用**：奪取、挖角、竊密、網內打撈、抹黑。**權重**：1。

#### 同一件事兩邊都發（`double_booked`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：另一個中間人發了反過來的那一件，接的是另一隊邊緣行者。輿論戰的對手換成「另一個主播」（OPINION 5.2 節）；現實的決定性階段多一隊行者（一個精英加兩個雜兵，照副本的等級）。贏了，那個中間人的關係 −、對方那隊人記住你。
- **適用**：抹黑、滅火、爆料、造勢、暗殺、護送、竄改。**權重**：1。**互斥**：`rival_crew`。

#### 委託人不准直播（`client_no_stream`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：開副本直播就違反 `no_exposure`（沒有這個附帶條件時自動加上）。作為交換，報酬 +10%。
- **適用**：所有類型；蜜罐、抹除、滅火、心智權重 ×2。**權重**：2。

#### 雇主有詐（`client_double_cross`）
- **種類**：麻煩。**作用在**：收尾。
- **效果**：收尾的背刺檢查必定翻臉：少付一半，或把你的位置賣給目標勢力（目標勢力的敵對值 +5）。踩點揭開「雇主」這一類未知時，這個詞條一起揭開，收尾時可以先動手（FIXER 第 2 節：玩家也可以背刺）。`cm_client_extra` 權重 ×2。
- **適用**：所有類型；委託人的性格是貪心或多疑，或中間人是冠冕區的外包窗口時權重 ×3。**權重**：1。

#### 東西很重（`cargo_heavy`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：拿著東西的人每回合行動點 −1，不能走通風、管線、防火梯一類的分支。有 `escape_route` 時改由車接，這個詞條的效果取消。
- **適用**：奪取、討債（回收義體或機器）、護送（貨）。**權重**：2。

#### 東西很脆弱（`cargo_fragile`）
- **種類**：麻煩。**作用在**：決定性的階段（寫明可以）。
- **效果**：自動加上附帶條件 `intact`（不算進附帶條件的上限）。目標物所在那一格被範圍攻擊打到時，擲 d20，10 以下東西壞掉：奪取、護送算違反 `intact`。破壞反過來用：目標物生命減半。
- **適用**：奪取、護送、破壞、網內打撈（資料殘缺）。**權重**：2。

#### 鎮溺隊就在附近（`suppress_nearby`）
- **種類**：麻煩。**作用在**：全程。
- **效果**：獵溺的決定性階段，鎮溺隊在第 2 回合就進場（有 `suppress_delayed` 時改成第 4 回合）。其他類型：任何一個隊友在副本裡沉溺上升到 100，鎮溺隊在下一個現實階段進場，走 `quarantine`。`cm_hd_suppress_early` 權重 ×3。
- **適用**：獵溺（權重 ×3）、救援、網內打撈；區是地下層、四十二番街。**權重**：1。

### 六、詞條一覽

| # | id | 名稱 | 種類 | 作用在 | 權重 | 主要適用 |
|---|---|---|---|---|---|---|
| 1 | `party_tonight` | 今晚有派對 | 兩面 | 一個現實階段 | 3 | 暗殺、蜜罐、接待、竊密等 |
| 2 | `shift_change` | 正在換班 | 機會 | 一個現實階段 | 3 | 有現實階段的 |
| 3 | `rain` | 下雨 | 兩面 | 全程・現實 | 2 | 戶外地圖、護送 |
| 4 | `blackout` | 停電 | 兩面 | 一個階段 | 1 | 破壞、奪取、竊密等 |
| 5 | `old_building` | 老舊的大樓 | 機會 | 全程 | 2 | 舊區、舊地圖 |
| 6 | `skeleton_crew` | 人手不足 | 機會 | 全程・現實 | 2 | 有現實階段的 |
| 7 | `on_alert` | 剛出過事 | 麻煩 | 全程・現實 | 2 | 有現實階段的 |
| 8 | `new_scan_gate` | 新裝的掃橋閘門 | 麻煩 | 一個現實階段 | 2 | 緋櫻、夜鶯、崑崙、貞網局 |
| 9 | `vip_visit` | 大人物來訪 | 麻煩 | 全程・現實 | 1 | III 級以上 |
| 10 | `mech_present` | 車庫裡有機甲 | 麻煩 | 決定性 | 1 | 星旗、黑泉、緋櫻、孤星連 |
| 11 | `hounds` | 機械獵犬 | 麻煩 | 全程・現實 | 2 | 黑泉、織女、星旗 |
| 12 | `crowded` | 人潮 | 兩面 | 一個現實階段 | 2 | 護送、救援、討債等 |
| 13 | `curfew` | 封街與臨檢 | 麻煩 | 一個現實階段 | 1 | 護送、救援、挖角、獵溺 |
| 14 | `police_sweep` | 市警在掃街 | 麻煩 | 全程 | 2 | 繳治安費的區 |
| 15 | `inside_man` | 有內應 | 機會 | 一個現實階段 | 2 | 有現實階段的 |
| 16 | `rival_crew` | 另一隊人也在裡面 | 麻煩 | 全程 | 2 | 暗殺、破壞、奪取等 |
| 17 | `target_moved` | 目標不在預定的位置 | 麻煩 | 決定性 | 2 | 暗殺、挖角、救援等 |
| 18 | `target_paranoid` | 目標很多疑 | 麻煩 | 全程 | 2 | 暗殺、蜜罐、接待等 |
| 19 | `target_drunk` | 目標喝醉了 | 機會 | 決定性 | 2 | 暗殺、蜜罐、接待等 |
| 20 | `ex_acquaintance` | 他認得你 | 兩面 | 全程 | 1 | 蜜罐、接待、挖角等 |
| 21 | `angel_member` | 目標是天使急救的會員 | 麻煩 | 決定性 | 1 | 暗殺、挖角、獵溺 |
| 22 | `captive_weak` | 被關的人走不動 | 麻煩 | 決定性 | 2 | 救援、綁架、護送 |
| 23 | `netlocked_captive` | 被救的人被扣在線上 | 兩面 | 全程 | 1 | 救援 |
| 24 | `family_home` | 欠債的人家裡有人 | 兩面 | 上門 | 3 | 討債 |
| 25 | `guest_plus_one` | 他帶了朋友 | 兩面 | 決定性 | 2 | 接待、蜜罐 |
| 26 | `exhibitionist_guest` | 客人想被看 | 機會 | 全程 | 1 | 接待 |
| 27 | `stalker` | 跟蹤的人 | 麻煩 | 一個階段 | 1 | 接待、蜜罐、護送 |
| 28 | `subnet_maintenance` | 子網在維護 | 兩面 | 一個階段 | 2 | 有內海可選的 |
| 29 | `airgapped` | 核心是隔離區 | 麻煩 | 全程 | 2 | 竊密、抹除、竄改 |
| 30 | `offline_backup` | 有離線的備份 | 麻煩 | 全程 | 2 | 抹除、竊密、竄改 |
| 31 | `netvigil_sweep` | 貞網局在掃這一區 | 麻煩 | 全程・內海 | 2 | 有內海階段的 |
| 32 | `pink_nest` | 蕾絲全是粉的 | 麻煩 | 全程・內海 | 2 | 緋櫻、伊甸園、夜鶯 |
| 33 | `old_hardware` | 舊硬體 | 兩面 | 全程・內海 | 2 | 舊區、網內打撈 |
| 34 | `single_logout` | 登出點只有一個 | 麻煩 | 全程・內海 | 1 | 有內海階段的 |
| 35 | `wall_whisper` | 牆的聲音 | 兩面 | 全程 | 1 | 獵溺、打撈、心智 |
| 36 | `opponent_preempt` | 對手先放話 | 麻煩 | 輿論戰 | 2 | 輿論主面 |
| 37 | `bot_army` | 對手養了水軍 | 麻煩 | 輿論戰 | 2 | 輿論主面、竄改 |
| 38 | `lawyers_ready` | 法務在待命 | 麻煩 | 輿論戰 | 2 | 對手是企業 |
| 39 | `hot_topic` | 全城都在談 | 兩面 | 輿論戰 | 2 | 輿論主面、竄改 |
| 40 | `slow_news_day` | 冷門的消息 | 機會 | 輿論戰 | 2 | 造勢、滅火、抹黑 |
| 41 | `kaleido_interested` | 萬華鏡也想要這條新聞 | 兩面 | 決定性的輿論戰 | 1 | 爆料、造勢、抹黑 |
| 42 | `idol_involved` | 牽涉偶像 | 兩面 | 全程 | 1 | 輿論主面、挖角、護送 |
| 43 | `reporter_on_site` | 記者在場 | 兩面 | 一個現實階段 | 2 | 有現實階段的 |
| 44 | `higher_bidder` | 有人出價更高 | 兩面 | 決定性之前 | 1 | 奪取、挖角、竊密等 |
| 45 | `double_booked` | 同一件事兩邊都發 | 麻煩 | 全程 | 1 | 輿論主面、暗殺、護送 |
| 46 | `client_no_stream` | 委託人不准直播 | 麻煩 | 全程 | 2 | 所有類型 |
| 47 | `client_double_cross` | 雇主有詐 | 麻煩 | 收尾 | 1 | 所有類型 |
| 48 | `cargo_heavy` | 東西很重 | 麻煩 | 決定性 | 2 | 奪取、討債、護送 |
| 49 | `cargo_fragile` | 東西很脆弱 | 麻煩 | 決定性 | 2 | 奪取、護送、破壞、打撈 |
| 50 | `suppress_nearby` | 鎮溺隊就在附近 | 麻煩 | 全程 | 1 | 獵溺 |

---

> L4 的內容草稿。依據：[COMMISSIONS](../../docs/systems/COMMISSIONS.md) 第 7、9 節，[COMBAT_SYSTEM](../../docs/systems/COMBAT_SYSTEM.md) 第 2 節，[SITES](../../docs/world/SITES.md) 第 12 節，[DISTRICTS](../../docs/world/DISTRICTS.md)，[OPINION](../../docs/systems/OPINION.md)，[DATA](../../docs/systems/DATA.md) 9.1 節，[SERIES](../../docs/systems/SERIES.md)，[ENEMY_ROSTER](../../docs/content/ENEMY_ROSTER.md)，[FIXER](../../docs/systems/FIXER.md)。數字都是初稿。

## 現實面的地圖模板

### 共通的寫法

這一段寫三十張手工的模板。SITES 12.3 節原有的二十四張全部收進來，另外補六張各區特有的場地。每張照下面的欄位寫。

| 欄位 | 寫什麼 |
|---|---|
| 對應 | SITES 12.3 節原本的 `map_` id。新補的寫「新」 |
| 區與勢力 | 哪幾區常抽到它（SITES 12.4 節的權重），哪幾個勢力常拿它當據點 |
| 大小 | 單張的格數、一個副本最多串幾張、分成幾個區塊、有幾個遭遇點 |
| 入口 | 每個 `E` 的種類，以及走它要什麼。正門一定是強攻的那條路 |
| 放東西的位置 | `T` 目標點、`D` 資料埠、保險箱、人質、`K` 憑證點、`C` 控制區、`G` 保全崗、`X` 撤離點 |
| 遭遇點 | 每個 `!` 的遮蔽，寫法照 SITES 12.2 節：「我方 4→1｜敵方 1→4」，掩＝掩體、半＝半掩體、暴＝暴露 |
| 適合的委託 | COMMISSIONS 第 7 節的類型 |
| 踩點會揭開 | 照 FIXER 第 2 節的七類（階段、路、守備、蕾絲、目標、雇主、詞條），寫這張圖上具體是什麼 |

**入口的難度**。這一份寫的檢定都用一個基準：**DC 基準＝10＋副本的等級×2**，和踩點、輔助面的難度同一把尺（FIXER 第 2 節、COMMISSIONS 6.4 節）。寫「基準＋3」的是比較難的入口。入口對應 COMMISSIONS 2.3 節的分支：正門是強攻；後門、通風、屋頂多半是潛行；員工門、送貨口多半是交涉或偽裝；寫明「要踩點」的入口是踩點開出來的路，沒揭開就不存在。

**遮蔽的材質**（新加，待確認）。COMBAT 2.1 節的耐久是掩體 30、半掩體 15。這份地圖另外標兩種材質：

| 材質 | 耐久 | 例 |
|---|---|---|
| 一般 | 照表：掩 30、半 15 | 辦公桌、貨箱、車 |
| **易碎** | 減半：掩 15、半 8 | 玻璃隔間、展示櫃、水族箱、紙門 |
| **厚重** | 加倍：掩 60、半 30 | 混凝土柱、機櫃、貨櫃、保險庫門 |

易碎的遮蔽被打壞時，現場的警戒 +5（聲音很大）。厚重的遮蔽讓霰彈與重武器的優勢變小，所以守方愛站在後面。

**遭遇點的編號**。每張圖的遭遇點寫成 ①②③，一個階段用一個。現實面一般的階段是「一段探索加一場遭遇」，最後一個階段是「一場戰鬥或一次動手的檢定」（COMMISSIONS 2.3 節），所以一張圖至少兩個遭遇點，串三張的圖每張兩到三個。

### 小辦公室（`map_office_small`）

- **對應**：`map_office_small`。
- **區與勢力**：櫻町最常見，蜂巢與四十二番街也有。用它的是緋櫻的外包商、萬華鏡的小製作公司、伊甸園的人力仲介、胭脂堂的帳房分號、同人眾的社團事務所。
- **大小**：9×9，一個副本用 1 張。四個區塊：接待區、開放座位、主管室、茶水間與後門。遭遇點 2 個。
- **入口**：
  - 正門：沒有條件。營業時間走正門要擲表演（扮成客戶或送貨員）對 DC 基準，失敗就照強攻算。
  - 後門（茶水間旁的防火門）：機械對 DC 基準，或拿到 `K` 的員工卡。
  - 二樓的窗：運動對 DC 基準＋3，全隊每人都要擲，一人失敗警戒 +10。夜間才開放。
- **放東西的位置**：`T` 主管室的辦公桌、牆上的保險櫃、茶水間後面的檔案間（三選一）；`D` 主管室的終端下方的網路孔；人質放在檔案間。`K` 是接待區的員工外套掛架。`C` 兩區：前半（門禁、攝影機）、後半（燈、保險櫃的電子鎖）。`G` 接待櫃檯、主管室門口。`X` 後門。
- **遭遇點**：
  - ① 開放座位：密（我方 掩 掩 半 半｜敵方 半 半 掩 掩）。隔板是易碎的半掩體，辦公桌是一般的掩體。
  - ② 主管室：一邊倒（我方 半 暴 暴 暴｜敵方 掩 掩 半 半），守方躲在實木辦公桌與保險櫃後面。從後門進來時對調成我方佔好位置。
- **適合的委託**：竊密、抹除、竄改、蜜罐、討債。
- **踩點會揭開**：路（後門的鎖是哪一種、二樓的窗夜裡沒上鎖）；守備（晚上只留一個值班的人）；目標（主管幾點下班、保險櫃的密碼寫在哪裡）；詞條（「今晚有人加班」）。

### 辦公樓層（`map_office_floor`）

- **對應**：`map_office_floor`。
- **區與勢力**：冠冕區最常見，櫻町與玻璃岸其次。緋櫻、星旗、崑崙、黑泉、夜鶯的分部與子公司。
- **大小**：13×9，一個副本最多串 3 張：大廳、目標樓層、頂層。每張四到五個區塊，大廳 2 個遭遇點，目標樓層 3 個，頂層 2 個。
- **入口**：
  - 大廳正門：沒有條件。冠冕區的大廳有掃橋閘門，沒有憑證會被攔，強攻時警戒起始 +20。
  - 貨梯（地下的卸貨區）：交涉對 DC 基準（說服送貨的司機讓你搭上去），或拿到 `K` 的清潔工憑證。接冠冕區的服務層（`map_service_level`）。
  - 樓梯間：隱匿對 DC 基準。每上一層警戒 +5。
  - 通風管：運動對 DC 基準＋3。直接通到目標樓層的茶水間，略過大廳那一張。
- **放東西的位置**：`T` 目標樓層的主管室、會議室、小機房；頂層的董事室。`D` 目標樓層的小機房一個，頂層的董事室一個。保險箱在董事室的書櫃後面。人質關在目標樓層的會議室。`K` 大廳的清潔工置物櫃、目標樓層的更衣室。`C` 每張兩區：門禁與攝影機一區，燈與防爆門一區；頂層多一區砲塔。`G` 大廳櫃檯、電梯口、目標樓層的走廊盡頭、董事室門口。`X` 頂層的浮空車降落點、貨梯。
- **遭遇點**：
  - ① 大廳：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。大理石的接待櫃檯是厚重的掩體，盆栽是半掩體。
  - ② 目標樓層的開放座位：密。隔板易碎。
  - ③ 目標樓層的走廊：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。接管 `C` 可以放下防爆門，替我方第 1 格造一個掩體。
  - ④ 會議室：中。長桌是掩體，玻璃牆易碎。
  - ⑤ 頂層的董事室：一邊倒。書櫃後面是厚重的掩體，砲塔掛在敵方第 3 格上。
- **適合的委託**：竊密、暗殺、挖角、竄改、抹除。
- **踩點會揭開**：階段（第二階段能不能選內海：大樓的控制節點有沒有接外網）；路（貨梯的班表、通風管的入口在哪一層）；守備（頂層有沒有砲塔）；蕾絲（子網幾層、什麼顏色）；目標（董事幾點離開）。

### 機房（`map_server_room`）

- **對應**：`map_server_room`。
- **區與勢力**：冠冕區與地下層。夜鶯、貞網局、織女、萬華鏡；地下層的是沒有接上夜鶯的舊網機房，牆語者看著。
- **大小**：9×9，一個副本用 1 張。三個區塊：前室（安全門與更衣）、機櫃列、核心控制台。遭遇點 2 個。
- **入口**：
  - 安全門：沒有條件，但門是厚重的，強攻要花一整場遭遇打開（或用炸藥）。拿到 `K` 的機房卡可以直接進。
  - 地板下的線槽：隱匿對 DC 基準＋3。只有兩個人進得去，其餘的人留在前室外面等開門。
  - 冷卻管線（要踩點）：運動對 DC 基準。從屋頂的冷卻塔下來，直通核心控制台。
- **放東西的位置**：`T` 核心控制台、離線備份的磁帶櫃、一台指定的機櫃。`D` 兩個：機櫃列中段的維修埠、核心控制台（插核心控制台的直接到隔離區的入口）。沒有保險箱與人質。`K` 前室的防靜電衣櫃。`C` 兩區：門禁與滅火系統一區，燈與冷卻一區（關掉冷卻，三回合後所有人每回合感載 +3，機器也停）。`G` 前室、核心控制台。`X` 安全門。
- **遭遇點**：
  - ① 前室：稀。
  - ② 機櫃列：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。機櫃是厚重的掩體；打壞機櫃會刪掉裡面的東西，竊密的委託打到 `T` 的機櫃算失敗那一步要重來。
- **適合的委託**：竊密、抹除、破壞、竄改（現實的必經階段）。
- **踩點會揭開**：階段（有沒有隔離區）；路（冷卻管線）；守備（機房靜音者幾個）；蕾絲（核心的蕾絲顏色）；詞條（「今晚在維護」，內海那一面選不了）。

### 小型實驗室（`map_lab`）

- **對應**：`map_lab_small`。
- **區與勢力**：玻璃岸最常見，鏽帶與冠冕區其次。蜜腺、崑崙、天使急救、織女的研發部；甜心食品的中央廚房也用這張。
- **大小**：11×9，一個副本最多串 2 張：上層的辦公與分析區、下層的樣本區。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 正門：沒有條件。白天有訪客登記，表演對 DC 基準可以混進去。
  - 貨物口：交涉對 DC 基準，或冒充冷鏈的司機。
  - 通風：運動對 DC 基準。通往下層的樣本區，但那裡的空氣有消毒霧，沒有面罩的人每回合感載 +2。
- **放東西的位置**：`T` 樣本冷庫、實驗體的觀察室、主任的研究室。`D` 分析區一個。人質（實驗體）在觀察室。保險箱是樣本冷庫的密碼櫃。`K` 上層的更衣室（實驗衣與門卡）。`C` 上下各一區：門禁與攝影機；下層多一區消毒霧。`G` 正門、下層的樓梯口、觀察室。`X` 貨物口。
- **遭遇點**：
  - ① 上層的分析區：中。實驗台是掩體，玻璃櫃易碎。
  - ② 上層的走廊：稀。
  - ③ 下層的樣本冷庫：密（我方 掩 掩 半 半｜敵方 半 半 掩 掩）。冷凍櫃是厚重的掩體，打壞了樣本就沒了。
  - ④ 觀察室：一邊倒。強化玻璃後面的守方佔好位置。
- **適合的委託**：奪取、救援、破壞、竊密、還沒好發出的回收。
- **踩點會揭開**：路（貨物口的冷鏈班次）；守備（流形保全有沒有在下層）；目標（實驗體幾號、在哪一間）；雇主（委託人真正要的是樣本還是那個人）。

### 倉庫（`map_warehouse`）

- **對應**：`map_warehouse`。
- **區與勢力**：舊港、蜂巢、鏽帶、地下層的中層。胭脂堂、拆體客、甜心食品的倉儲、黑泉的物料、野薔薇的中繼站。
- **大小**：13×9，一個副本用 1 張。四個區塊：卸貨區、貨架列、二樓的辦公室、後巷。遭遇點 3 個。
- **入口**：
  - 捲門：沒有條件。打開時聲音很大，警戒 +10。
  - 側門：機械對 DC 基準。
  - 屋頂天窗：運動對 DC 基準。落在貨架列上方的走道，可以先看到守備的配置（等於揭開這一場的守備）。
  - 排水溝（要踩點）：只有地下層與舊港的倉庫有。隱匿對 DC 基準。
- **放東西的位置**：`T` 貨架中的指定的貨箱、二樓辦公室的保險箱、卸貨區的一輛貨車。`D` 二樓辦公室的終端。人質綁在二樓辦公室旁的小隔間。`K` 卸貨區的叉車司機的外套。`C` 兩區：捲門與燈一區，攝影機一區（街頭勢力的倉庫這一區沒有連線）。`G` 卸貨區、二樓樓梯口。`X` 捲門、後巷。
- **遭遇點**：
  - ① 卸貨區：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。貨車是厚重的掩體。
  - ② 貨架列：密。貨架可以推倒：花 2 點行動點、機械或運動對 DC 基準，把對方第 2 或第 3 格的遮蔽打成暴露，並讓站在那裡的人失去一點行動點。
  - ③ 二樓辦公室：稀。窗戶易碎，從屋頂進來的人可以從窗戶直接開打（我方埋伏）。
- **適合的委託**：奪取、破壞、討債、救援、蜜糖會的人偶逃亡的中途站。
- **踩點會揭開**：路（側門的鎖、屋頂天窗）；守備（夜班幾個人）；目標（貨箱的編號）；詞條（「今晚有貨要出」：卸貨區多一輛車與兩個人）。

### 冷庫（`map_cold_store`）

- **對應**：`map_cold_store`。
- **區與勢力**：舊港最常見，蜂巢的西棟與地下層的淺層也有。拆體客；胭脂堂偶爾租給別人用。
- **大小**：9×9，一個副本用 1 張。三個區塊：卸貨口、冷凍庫、拆件間。遭遇點 2 個。
- **入口**：
  - 卸貨口：沒有條件。冰桶司機在這裡等貨。
  - 冷凍庫門：從外面的巷子進，機械對 DC 基準。進去之後每回合感載 +1，直到離開冷凍庫。
  - 交貨（要踩點）：扮成來賣貨的人，表演或交涉對 DC 基準。成功就站在拆件間的門口才開打。
- **放東西的位置**：`T` 冰櫃（被拆下來的義體）、手術台（被拆的人）、攤主的帳本。沒有資料埠。人質在手術台或冰櫃旁邊的擔架上。`K` 拆件間的工作服。`C` 一區：燈與冷凍庫的門，常常沒有連線。`G` 卸貨口、拆件間。`X` 卸貨口。
- **遭遇點**：
  - ① 卸貨口：稀。冰桶車可以當成我方第 1 格的掩體（開車進來的話）。
  - ② 拆件間：中。手術台是半掩體；冰櫃是厚重的掩體，裡面的東西打壞了不能回收。
- **適合的委託**：救援、討債與回收、奪取。
- **踩點會揭開**：目標（被拆的人還在不在）；守備（拆件師傅在不在）；詞條（「冷庫明天要搬家」：要在今晚動手）。

### 夜店、俱樂部（`map_club`）

- **對應**：`map_club`。
- **區與勢力**：四十二番街最常見，玻璃岸的俱樂部與櫻町的地下店也用。蜜糖會、伊甸園、萬華鏡的藝人、夜宴社、鉻娘子開的黑店。
- **大小**：13×9，一個副本最多串 2 張：舞池層、VIP 層。每張四個區塊，各 2 個遭遇點。
- **入口**：
  - 正門：要排隊，看門的保鑣挑人。誘惑或表演對 DC 基準就能進去，失敗就只能強攻。強攻時舞池的人群一起散開，警戒 +20。
  - 後門（垃圾場那邊）：隱匿對 DC 基準。
  - 員工通道：拿到 `K` 的工作人員手環，或交涉買通酒保。
  - DJ 的器材口（要踩點）：只有有演出的晚上開。
- **放東西的位置**：`T` VIP 包廂、DJ 台、經理室。`D` 經理室的終端、DJ 台的混音器（它接著舞池音響的橋）。保險箱在經理室。人質被帶進 VIP 層最裡面的包廂。`K` 員工休息室。`C` 兩區：燈光與音響一區（可以讓舞池變成黑暗），門禁與攝影機一區。`G` 正門、VIP 的樓梯、經理室。`X` 後門。
- **遭遇點**：
  - ① 舞池：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。人群算半掩體：雙方第 2、3 格各有一層人群，人群不能被打壞，但對著人群開槍警戒 +10。
  - ② 吧檯：密。酒櫃是易碎的掩體。
  - ③ VIP 走廊：稀。
  - ④ 經理室：一邊倒。
- **適合的委託**：蜜罐、暗殺、挖角、爆料（拍現場）、接待。
- **踩點會揭開**：路（員工通道、器材口）；守備（VIP 層有幾個保鑣）；目標（目標坐哪一間包廂、幾點到）；詞條（「今晚有包場派對」）。

### 人偶館（`map_doll_house`）

- **對應**：`map_doll_house`。
- **區與勢力**：四十二番街最常見，玻璃岸偶爾有。伊甸園的分店與加盟店；蜜糖會保護的獨立館（委託目標是它的時候，委託人多半是伊甸園）。
- **大小**：11×9，一個副本最多串 3 張：大廳與等候室、包廂層、晶片室與經理層。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 正門：沒有條件。當客人進去要付錢（等級×200），之後在大廳裡可以自由走動。
  - 員工門：誘惑或表演對 DC 基準（扮成新來的人偶或客人點的外送），或拿到 `K`。
  - 晶片室的後門：要踩點，機械對 DC 基準＋3。直接進晶片室，略過前面兩張。
- **放東西的位置**：`T` 某一間包廂（人）、晶片室的保管櫃（晶片）、經理室（契約書）。`D` 晶片室的寫入台。保險箱在經理室。人質就是包廂裡的人偶或客人。`K` 員工更衣室的置物櫃。`C` 三區：大廳的門與攝影機、包廂層的門鎖、晶片室的寫入台（拿下它可以讓館裡所有人偶「下班」一個階段）。`G` 大廳櫃檯、包廂層的電梯口、晶片室門口。`X` 員工門。
- **遭遇點**：
  - ① 大廳：密（我方 掩 掩 半 半｜敵方 半 半 掩 掩）。沙發與屏風，屏風易碎。
  - ② 包廂層的走廊：稀。
  - ③ 晶片室：一邊倒。回收員在這裡等。
  - ④ 經理室：中。
- **適合的委託**：救援（人偶逃亡）、蜜罐、挖角、竊密、接待。
- **踩點會揭開**：路（晶片室的後門）；守備（晶片室有沒有回收員）；目標（她在第幾號包廂、晶片在哪一格）；雇主（委託人和這間館有什麼舊帳）。進人偶館當班的踩點只在這張圖上有。

### 診所（`map_clinic`）

- **對應**：`map_clinic`。
- **區與勢力**：四十二番街的刀巷、蜂巢、舊港、玻璃岸。蜜糖會的互助診所、無照改造師、天使急救的分站、蜜腺的門診。
- **大小**：9×9，一個副本用 1 張。三個區塊：候診室、手術室、藥庫與病歷室。遭遇點 2 個。
- **入口**：
  - 正門：沒有條件。掛號就能坐進候診室。
  - 後巷：機械對 DC 基準。後巷的門是收醫療廢棄物與進藥品用的。
  - 救護車位（要踩點）：只有天使急救與蜜腺的診所有。冒充急救隊員要表演對 DC 基準＋3。
- **放東西的位置**：`T` 手術台（人）、藥庫（藥或義體）、病歷終端。`D` 病歷室的終端。保險箱是藥庫的管制櫃。人質在手術室的恢復床上。`K` 手術室外的消毒間（白袍與門卡）。`C` 一區到兩區：門禁、手術室的燈與麻醉機。`G` 掛號櫃檯、手術室門口。`X` 後巷。
- **遭遇點**：
  - ① 候診室：中。椅子一排排的，算半掩體；櫃檯是掩體。
  - ② 手術室：稀。手術燈可以被打壞，打壞之後場地變成黑暗。
- **適合的委託**：奪取、竊密、救援、心智、討債與回收。
- **踩點會揭開**：目標（手術排在幾點）；守備（武裝醫護在不在）；雇主（委託人是不是想搶在手術前把人帶走）；詞條（「今晚有急診」：多兩個平民）。

### 宅邸（`map_mansion`）

- **對應**：`map_mansion`。
- **區與勢力**：玻璃岸最常見，冠冕區的頂層公寓也用它。企業高層、夜宴社、黑泉、星旗的軍官、萬華鏡的明星。
- **大小**：13×9，一個副本最多串 3 張：花園與車庫、一樓的宴會廳、二樓的書房與臥室。每張四個區塊，各 2～3 個遭遇點。
- **入口**：
  - 正門：沒有條件。有宴會的晚上，拿到邀請函或被人帶著就能從正門走進去。
  - 僕人門：表演對 DC 基準（扮成僕人、外燴、女僕公會派來的人），或拿到 `K`。
  - 花園：隱匿對 DC 基準。花園有巡邏的狗或機器狗。
  - 車庫：機械對 DC 基準。車庫的電梯直通二樓。
  - 海蝕洞（要踩點）：只有懸崖邊的玻璃岸宅邸有，通往酒窖。
- **放東西的位置**：`T` 書房、保險室、主臥室、宴會廳。`D` 書房的終端、保險室的門鎖。保險箱在保險室與書房的畫後面。人質在二樓的客房或地下的酒窖。`K` 僕人房的制服與門卡。`C` 三區：花園的感應燈與狗、一樓的門與攝影機、二樓的保險室。`G` 正門、花園的崗亭、二樓樓梯、保險室。`X` 車庫、花園的後門。
- **遭遇點**：
  - ① 花園：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。噴水池是半掩體。
  - ② 車庫：中。車是厚重的掩體。
  - ③ 宴會廳：中。人群算半掩體，規則同俱樂部的舞池。
  - ④ 書房：密。書櫃是掩體。
  - ⑤ 保險室：一邊倒。
- **適合的委託**：暗殺、竊密、蜜罐、挖角、接待、奪取。
- **踩點會揭開**：階段（宴會那一晚第一階段能不能選輿論）；路（僕人門、車庫的電梯、海蝕洞）；守備（狗的數量、私人保全的編制）；目標（主人今晚睡哪一間）；詞條（「今晚有宴會」）。

### 片場、攝影棚（`map_studio`）

- **對應**：`map_studio`。
- **區與勢力**：四十二番街的下城（第七棚那類）、玻璃岸、櫻町。萬華鏡、緋櫻映畫、帶子街的製作公司、伊甸園的錄製間。
- **大小**：11×9，一個副本用 1 張。四個區塊：器材口、棚內、控制室、母帶櫃與化妝間。遭遇點 3 個。
- **入口**：
  - 正門：沒有條件。有拍攝時擠滿工作人員，表演對 DC 基準可以混進去當臨時演員或助理。
  - 器材口：機械對 DC 基準，或推著器材箱走進去（交涉對 DC 基準）。
  - 化妝間的窗（要踩點）：隱匿對 DC 基準。
- **放東西的位置**：`T` 母帶櫃、控制室的剪輯台、棚內的主角。`D` 控制室。保險箱是母帶櫃。人質是被逼著拍的那個人，在化妝間。`K` 化妝間的工作證。`C` 兩區：燈光（棚內可以變黑暗）與攝影機（關掉它，這一場打起來不會被錄成素材）。`G` 正門、控制室。`X` 器材口。
- **遭遇點**：
  - ① 器材口：中。器材箱是掩體。
  - ② 棚內：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。布景是易碎的半掩體。燈架可以推倒，打到人時對方失去一點行動點。
  - ③ 控制室：密。
- **適合的委託**：抹除、奪取（母帶）、爆料、滅火、救援。
- **踩點會揭開**：目標（母帶有幾份、放在哪一格）；路（化妝間的窗）；詞條（「今晚在拍」：棚內多一群平民與一台在錄的攝影機）；雇主（委託人自己有沒有出現在母帶裡）。

### 碼頭貨櫃區（`map_container_yard`）

- **對應**：`map_container_yard`。
- **區與勢力**：舊港最常見；鏽帶的陸運版（貨櫃換成卡車拖板）也用這張。胭脂堂、拆體客、鉻娘子、野薔薇、星旗的補給。
- **大小**：13×9，一個副本最多串 2 張：陸側閘門與堆場、碼頭與船邊。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 陸側閘門：沒有條件。崗亭有人。
  - 碼頭：從水上來，要有船（陸伯或野薔薇借的），或操縱對 DC 基準開走一艘拖船。
  - 水路（要踩點）：游過去，運動對 DC 基準＋3。上岸的人身上的電子用品這個階段不能用。
  - 貨櫃之間的縫：隱匿對 DC 基準。
- **放東西的位置**：`T` 指定的貨櫃、吊車控制室、船上的貨艙。`D` 吊車控制室。保險箱是船長室的鐵櫃。人質關在一個空貨櫃裡。`K` 碼頭工人的休息棚。`C` 兩區：探照燈與閘門、吊車（拿下吊車可以把一個貨櫃吊起來放到敵方第 1 格前面：替我方第 1 格造一個厚重的掩體，或砸掉敵方一格的遮蔽）。`G` 崗亭、吊車下、船邊。`X` 碼頭、陸側閘門。
- **遭遇點**：
  - ① 堆場：密（我方 掩 掩 半 半｜敵方 半 半 掩 掩）。貨櫃是厚重的掩體。
  - ② 崗亭：一邊倒。
  - ③ 吊車下：中。
  - ④ 船邊：稀。
- **適合的委託**：奪取、護送（起點或終點）、破壞、討債、救援。
- **踩點會揭開**：目標（貨櫃的編號、船幾點靠岸）；路（水路、貨櫃之間的縫）；守備（船上有沒有鉻娘子的人）；詞條（「今晚有船」「另一隊人也在等這個貨櫃」）。

### 公寓（`map_apartment`）

- **對應**：`map_apartment`。
- **區與勢力**：蜂巢最常見，櫻町與四十二番街也有。住戶是誰都有可能；管理者常是緋櫻銀行（收租無人機）、孤星連（東側）、或幫派的人。
- **大小**：11×9，一個副本最多串 2 張：樓下的電梯廳與走廊、目標那一層。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 電梯：沒有條件。蜂巢的電梯常常壞，壞的時候只能走樓梯。
  - 樓梯：沒有條件，每上一層要一次隱匿對 DC 基準，失敗警戒 +5。
  - 外牆（晾衣架與冷氣架）：運動對 DC 基準＋3。直接到目標單位的窗外。
  - 隔壁戶：交涉對 DC 基準（說服或付錢給鄰居），從陽台過去。
- **放東西的位置**：`T` 目標的單位；樓下的管理員室。`D` 管理員室的終端，或目標自己的甲板。人質在目標的單位裡。`K` 管理員室的備用鑰匙。`C` 兩區：電梯與走廊燈（街頭勢力管的這一區沒有連線）、收租無人機的充電座。`G` 電梯廳、目標單位門口。`X` 樓梯、外牆。
- **遭遇點**：
  - ① 電梯廳：稀。
  - ② 走廊：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。晾著的衣服算煙霧（打不破的半掩體），在走廊的第 2 格各一。
  - ③ 目標的單位：密。家具是一般的掩體，紙門易碎。
- **適合的委託**：暗殺、討債與回收、挖角、心智、救援。
- **踩點會揭開**：目標（他幾點回家、跟誰住）；路（哪一戶鄰居肯幫忙）；守備（有沒有收租無人機）；詞條（「電梯今天壞了」）。鄰居在這張圖上是平民，城裡的 NPC 不能被攻擊，所以在走廊開槍警戒 +10。

### 停車場（`map_parking`）

- **對應**：`map_parking`。
- **區與勢力**：冠冕區與玻璃岸最常見，四十二番街的上城也有。企業高層的座車、鉻娘子與特攻姬的車隊、星旗的軍車。
- **大小**：13×9，一個副本最多串 2 張：地下一層與地下二層。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 車道：沒有條件。開車進來要過收費亭（交涉或付錢）。
  - 樓梯：沒有條件。
  - 電梯：拿到 `K`。冠冕區的電梯會掃橋。
- **放東西的位置**：`T` 指定的車、收費亭、車旁的目標（上下車的那一刻）。`D` 收費亭的終端。保險箱是運鈔車或座車的後車廂。人質在某輛車的後座。`K` 收費亭的值班外套。`C` 兩區：燈、閘門與攝影機。`G` 收費亭、電梯口。`X` 車道、樓梯。
- **遭遇點**：
  - ① 車道口：稀。收費亭是掩體。
  - ② 停車格之間：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。車是一般的掩體，被打壞時會起火，那一格這一場變成暴露。柱子是厚重的半掩體。
  - ③ 電梯口：稀。
- **適合的委託**：暗殺（上下車）、奪取、護送的起點、綁架。
- **踩點會揭開**：目標（車牌、幾點下樓）；守備（座車有幾個保鑣）；路（哪一層的攝影機壞了）。

### 旅館（`map_hotel`）

- **對應**：`map_hotel`。
- **區與勢力**：四十二番街的旅館坡最常見，玻璃岸有高級的版本。伊甸園、蜜糖會、胭脂堂；也是任何人偷偷見面的地方。
- **大小**：11×9，一個副本最多串 2 張：櫃檯與監控室、客房層。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 正門與無人櫃檯：沒有條件。開一間房（等級×100）。
  - 逃生梯：機械對 DC 基準開外面的門。
  - 清潔車：表演對 DC 基準，扮成打掃的人推車上樓。
- **放東西的位置**：`T` 某一間客房、監控室的錄影。`D` 監控室。保險箱是客房裡的小保險箱。人質在客房裡。`K` 清潔間。`C` 兩區：客房的門鎖、監控與燈。`G` 櫃檯後面、客房層的電梯口。`X` 逃生梯。
- **遭遇點**：
  - ① 監控室：密。
  - ② 客房層的走廊：稀。
  - ③ 客房：中。床與浴室的牆，浴室的玻璃易碎。
- **適合的委託**：蜜罐、暗殺、救援、滅火（搶回錄影）、接待。
- **踩點會揭開**：目標（他訂了哪一間、跟誰）；路（清潔的時間）；詞條（「今晚查房」）。

### 賭場、賭船（`map_casino`）

- **對應**：`map_casino`。
- **區與勢力**：舊港（賭船那一類）最常見，玻璃岸的遊艇與四十二番街的地下賭局也用。胭脂堂、夜宴社、黑泉的人來玩，伊甸園的人來找客人。
- **大小**：13×9，一個副本最多串 2 張：賭廳、金庫與貴賓層。每張四個區塊，各 2 個遭遇點。
- **入口**：
  - 正門（舷梯）：沒有條件。換籌碼（等級×200）就能上船。
  - 碼頭邊的貨門：交涉對 DC 基準，或拿到 `K`。
  - 員工口（廚房）：表演對 DC 基準，扮成侍者或荷官。
  - 錨鏈（要踩點）：只有賭船有，運動對 DC 基準＋3，直通貴賓層的甲板。
- **放東西的位置**：`T` 金庫、貴賓室、監控室、某一張牌桌上的人。`D` 監控室。保險箱就是金庫。人質在貴賓層的艙房。`K` 荷官的更衣室。`C` 三區：賭廳的燈與攝影機、金庫的門、船的引擎（拿下它可以讓船離開碼頭：增援上不來，但自己也要另找路下船）。`G` 舷梯、金庫門口、貴賓層的樓梯。`X` 舷梯、碼頭邊的貨門。
- **遭遇點**：
  - ① 賭廳：中。牌桌是半掩體，吧檯是掩體；人群算半掩體，規則同俱樂部的舞池。
  - ② 監控室：密。
  - ③ 貴賓層的甲板：稀。
  - ④ 金庫：一邊倒。金庫門是厚重的掩體。
- **適合的委託**：奪取、討債、蜜罐、破壞、接待。
- **踩點會揭開**：目標（他坐哪一桌、輸了多少）；守備（荷官裡有幾個是胭脂堂的打仔）；路（錨鏈、廚房）；雇主（委託人欠不欠這艘船錢）。

### 商店街一段（`map_shop_street`）

- **對應**：`map_shop_street`。
- **區與勢力**：櫻町的千本通、蜂巢的天井市場、四十二番街。特攻姬收町費的那幾段、祭典組、甜心食品的加盟店、同人眾的店。
- **大小**：13×9，一個副本用 1 張。四個區塊：街口、攤位、某間店、後巷。遭遇點 3 個。
- **入口**：
  - 街的兩端：沒有條件。
  - 屋頂：運動對 DC 基準，從隔壁的樓梯上去。可以從上面先看到街上的配置。
  - 後巷：沒有條件，但後巷常有特攻姬的人，表演或威嚇對 DC 基準讓他們不吭聲。
- **放東西的位置**：`T` 某一間店（老闆、貨、帳本）、店的倉庫。`D` 那間店的收銀機（多半是白子網，很淺）。保險箱在店的後間。人質在店的倉庫。`K` 攤販的圍裙與攤位證。`C` 一區：街燈與店家的攝影機，一半沒有連線。`G` 街口、那間店的門口。`X` 街的兩端、後巷。
- **遭遇點**：
  - ① 街口：中（我方 掩 半 半 暴｜敵方 暴 半 半 掩）。攤車是半掩體，自動販賣機是掩體。
  - ② 店內：密。貨架易碎。
  - ③ 後巷：稀。垃圾箱是半掩體。
- **適合的委託**：護送、討債、破壞、救援、造勢（拍街頭）。
- **踩點會揭開**：守備（今天是誰收町費）；目標（老闆幾點關店）；詞條（「祭典組今晚封街」：街上多一群醉客，人群算半掩體）。白天有平民，在街上開槍警戒 +10。

### 超商（`map_convenience`）

- **對應**：`map_convenience`。
- **區與勢力**：蜂巢與櫻町最常見，每一區都有。甜心食品的桃子屋；孤星連與野良常在門口。
- **大小**：9×9，一個副本用 1 張。三個區塊：店面、倉庫、店長室。遭遇點 2 個。
- **入口**：
  - 正門：沒有條件，二十四小時開著。
  - 倉庫門（送貨口）：交涉對 DC 基準，或在送貨的時間冒充司機。
  - 屋頂的空調口（要踩點）：運動對 DC 基準。
- **放東西的位置**：`T` 收銀台、伺服器箱（桃子屋的會員資料）、倉庫裡的某一批貨。`D` 店長室的伺服器箱。保險箱是收銀台下的現金箱。人質是店員或客人。`K` 倉庫的制服。`C` 一區：門、攝影機、冷藏櫃的燈。`G` 收銀台、倉庫門。`X` 正門、送貨口。
- **遭遇點**：
  - ① 店面：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。貨架易碎，冷藏櫃是易碎的掩體。
  - ② 倉庫：中。紙箱堆是半掩體。
- **適合的委託**：奪取、竊密、竄改、討債、滅火（找到外流的監視錄影）。
- **踩點會揭開**：守備（損失防治專員幾點巡店）；路（送貨的時間）；目標（伺服器箱在哪一格）。

### 工廠（`map_factory`）

- **對應**：`map_factory`。
- **區與勢力**：鏽帶最常見，蜂巢的機電層與舊港的熔爐附近也有。黑泉的精煉站、崑崙與緋櫻的零件廠、甜心食品的中央廚房、鉻娘子的改裝廠。
- **大小**：13×9，一個副本最多串 2 張：廠房與生產線、控制室與原料槽。每張三個區塊，各 2～3 個遭遇點。
- **入口**：
  - 大門：沒有條件。有卡車進出時，交涉對 DC 基準可以搭上去。
  - 卸貨口：拿到 `K`，或機械對 DC 基準。
  - 管線：運動對 DC 基準＋3。直通控制室上方的維修走道。
- **放東西的位置**：`T` 控制室、生產線上的某樣東西、原料槽。`D` 控制室。保險箱是廠長室的鐵櫃。人質（契約工）在宿舍棚。`K` 工人的更衣間。`C` 兩區：生產線（拿下它可以讓一條輸送帶把一格的人往後推一格）、燈與閘門。`G` 大門、控制室、原料槽。`X` 大門、卸貨口。
- **遭遇點**：
  - ① 廠房：中。機台是厚重的掩體。
  - ② 生產線：稀。輸送帶兩邊是暴露的。
  - ③ 控制室：密。
  - ④ 原料槽：一邊倒。槽是厚重的掩體；打穿原料槽，整場變成蒸氣（每回合所有人感載 +2）。
- **適合的委託**：破壞、奪取、救援（契約工）、竊密。
- **踩點會揭開**：守備（無橋私兵的人數）；路（管線、卡車的時間）；目標（原料槽是哪一座）；雇主（委託人是不是黑泉的對手）。

### 屋頂與天台（`map_rooftop`）

- **對應**：`map_rooftop`。
- **區與勢力**：蜂巢的屋頂村與冠冕區的頂樓最常見。野良、孤星連的狙擊手、企業的浮空車停機坪。
- **大小**：11×9，一個副本用 1 張。三個區塊：樓梯間、水塔與天線、停機坪或繩橋。遭遇點 2 個。
- **入口**：
  - 樓梯間：沒有條件。
  - 鄰樓的繩橋：運動對 DC 基準。野良的好感高時不用擲。
  - 浮空車降落點：要有浮空車，或操縱對 DC 基準開一台。
- **放東西的位置**：`T` 天線、水塔、停機坪上的人或浮空車。`D` 天線陣的維修盒（只有一部分屋頂有）。人質被綁在水塔旁。`K` 樓梯間的維修工具箱。`C` 一區：停機坪的燈與天線。`G` 樓梯間、停機坪。`X` 繩橋、浮空車。
- **遭遇點**：
  - ① 水塔與天線：中。水塔是厚重的掩體；打穿水塔，那一格與相鄰的格子這一場地面濕滑，換位要多花 1 點。
  - ② 停機坪：稀（我方 半 暴 暴 暴｜敵方 暴 暴 暴 半）。夜間戶外，場地是黑暗。
- **適合的委託**：暗殺（狙擊）、護送的終點、破壞、救援。
- **踩點會揭開**：路（繩橋、哪一棟樓的屋頂連過去）；目標（浮空車幾點來）；詞條（「今晚有風」：狙擊命中 −2）。

### 地鐵月台與隧道（`map_subway`）

- **對應**：`map_subway`。
- **區與勢力**：地下層的淺層（廢棄的站）與各區的地鐵站（深夜停駛之後）。野良、牆語者、走私的人、市警的臨檢。
- **大小**：13×9，一個副本最多串 2 張：站廳與月台、隧道。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 站廳：沒有條件。營運中的站進站要掃橋。
  - 隧道的兩端：隱匿對 DC 基準。廢棄的站沒有燈。
  - 通風井（要踩點）：運動對 DC 基準。
- **放東西的位置**：`T` 停在月台的列車、站務室、隧道裡的交易點。`D` 站務室。人質在列車的車廂裡。`K` 站務室的值班外套。`C` 一區：月台的燈、閘門、軌道的號誌（拿下它可以讓一班列車通過，把隧道裡的遭遇切成兩半）。`G` 閘門、月台盡頭。`X` 隧道的一端、站廳。
- **遭遇點**：
  - ① 月台：中。柱子是厚重的半掩體，長椅是半掩體。
  - ② 列車車廂：稀。座椅是半掩體，車窗易碎。
  - ③ 隧道：稀，黑暗。
- **適合的委託**：護送、奪取、救援、獵溺（溺感者躲在廢站裡）。
- **踩點會揭開**：路（通風井、哪一段隧道野良做了記號）；守備（市警今晚會不會臨檢）；詞條（「最後一班車晚了」）。

### 排水道（`map_sewer`）

- **對應**：`map_sewer`。
- **區與勢力**：地下層與舊港。野良、牆語者、拆體客、走私的人；吉祥物偶爾出現。
- **大小**：11×9，一個副本最多串 3 張：入口段、匯流段、蓄洪池。每張兩到三個區塊，各 2 個遭遇點。
- **入口**：
  - 人孔：沒有條件。
  - 排水口：從河邊或海邊進，運動對 DC 基準。
  - 貓道（要踩點）：讀得懂野良的記號才找得到，隱匿對 DC 基準。
- **放東西的位置**：`T` 交易點、藏身處、蓄洪池中央的平台。沒有資料埠（舊網節點的版本除外）。人質在藏身處。`K` 維修工的置物箱。`C` 一區：閘門（拿下它可以讓一段水道淹水：那一場敵方第 3、4 格換位要多花 1 點）。`G` 交易點、藏身處的入口。`X` 人孔、排水口。
- **遭遇點**：
  - ① 匯流段：中。管線是厚重的半掩體。
  - ② 狹道：稀，黑暗。
  - ③ 蓄洪池：一邊倒，守方站在平台上。
- **適合的委託**：護送、救援、奪取（劫交易）、獵溺。
- **踩點會揭開**：路（貓道）；目標（交易幾點、在哪一個平台）；詞條（「下雨了」：水位上升，最後一段的遭遇點 ③ 變成稀）。

### live house、劇場後台（`map_venue`）

- **對應**：`map_venue`。
- **區與勢力**：櫻町最常見（地下二階那一類、緋櫻劇場的小廳），四十二番街的過載也有。緋櫻的戰姬事業部、親衛隊、地下偶像的事務所、萬華鏡的節目組。
- **大小**：11×9，一個副本最多串 2 張：觀眾區與舞台、後台與休息室。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 觀眾入口：買票（等級×50）。有公演的晚上擠滿人。
  - 後台門：表演對 DC 基準（扮成工作人員、樂手、偶像的經紀人），或拿到 `K` 的通行證。
  - 裝卸口：交涉對 DC 基準，或推器材進去。
- **放東西的位置**：`T` 舞台上、休息室、音控台。`D` 音控台。保險箱是事務所的票房箱。人質是休息室裡的偶像。`K` 後台的通行證掛架。`C` 兩區：舞台的燈與煙霧機（可以在任一格放煙霧）、門禁與攝影機。`G` 後台門、休息室門口、音控台。`X` 裝卸口。
- **遭遇點**：
  - ① 觀眾區：中。人群算半掩體，規則同俱樂部的舞池；親衛隊在場時，對偶像動手的那一方警戒 +20。
  - ② 舞台：稀。音箱是掩體。
  - ③ 後台走廊：密。器材箱與衣架。
  - ④ 休息室：中。化妝鏡易碎。
- **適合的委託**：暗殺、挖角、護送（偶像）、造勢、滅火、接待。
- **踩點會揭開**：目標（偶像幾點下台、走哪一條路離開）；守備（親衛隊在後台有幾個人）；雇主（委託人是事務所還是對手）；詞條（「今晚是畢業公演」）。

### 檢查哨、崗哨（`map_checkpoint`）

- **對應**：`map_checkpoint`。
- **區與勢力**：區與區之間的閘門（冠冕門、櫻門、東門、南門）、鏽帶的企業圍牆。市警、緋櫻警備局、星旗、黑泉的私兵、鉻娘子收過路費的崗。
- **大小**：11×9，一個副本用 1 張。三個區塊：道路與閘門、崗亭、拘留室。遭遇點 2 個。
- **入口**：
  - 道路的兩端：沒有條件。有憑證的話直接排隊過去，交涉或表演對 DC 基準讓盤查放過你。
  - 排水涵洞（要踩點）：隱匿對 DC 基準。
- **放東西的位置**：`T` 閘門控制、拘留室、扣押的貨。`D` 崗亭的終端。人質在拘留室。`K` 換班的崗亭。`C` 兩區：閘門與探照燈、掃橋機。`G` 閘門兩側、崗亭。`X` 道路的另一端。
- **遭遇點**：
  - ① 閘門：一邊倒（我方 半 暴 暴 暴｜敵方 掩 掩 半 半）。沙包與水泥塊是厚重的掩體。
  - ② 拘留室：密。
- **適合的委託**：救援（劫囚）、破壞、護送（闖關）。
- **踩點會揭開**：守備（換班的時間、哪一班收錢）；路（排水涵洞）；目標（犯人關在哪一間、什麼時候要被移送）。

### 女僕咖啡廳（`map_maid_cafe`）

- **對應**：新。
- **區與勢力**：櫻町最常見，四十二番街的上城也有。女僕公會的分店、親衛隊愛去的店、甜心食品的聯名店；緋櫻家政課有時借它當見面的地方。
- **大小**：11×9，一個副本用 1 張。四個區塊：店面、廚房、更衣室、店長室。遭遇點 3 個。
- **入口**：
  - 正門：沒有條件。坐下來點餐（等級×50）。
  - 廚房的後門：表演對 DC 基準（扮成送食材的人），或拿到 `K`。
  - 女僕的應徵（要踩點）：誘惑或表演對 DC 基準＋3，穿上制服從更衣室進去。
- **放東西的位置**：`T` 店面的某一桌客人、店長室的帳冊、更衣室的某一個置物櫃。`D` 店長室的點餐系統主機。保險箱在店長室。人質是被客人纏上的女僕或被帶來見面的人。`K` 更衣室。`C` 一區：門、攝影機、店裡的音樂（關掉音樂時，店面的人會發現不對，警戒 +10）。`G` 櫃檯、廚房。`X` 廚房的後門。
- **遭遇點**：
  - ① 店面：中。桌椅是半掩體，甜點櫃是易碎的掩體；客人在的時候算人群。
  - ② 廚房：密。冰箱與爐台是掩體；爐台打壞會起火，那一格這一場變成暴露。
  - ③ 店長室：一邊倒。
- **適合的委託**：蜜罐、接待、挖角、護送（從這裡接人）、竊密。
- **踩點會揭開**：目標（他每週幾來、指名哪一位）；守備（公會的銅章與銀章女僕各幾位：她們是店員也是保全）；雇主（委託人和女僕公會有沒有過節，千早會不會知道）；詞條（「今天是活動日」：店面坐滿親衛隊）。

### 社宅（`map_company_dorm`）

- **對應**：新。
- **區與勢力**：櫻町的社宅群最常見，冠冕區的員工宿舍與鏽帶的契約工宿舍也用。緋櫻、黑泉、崑崙的員工；管理者是公司的總務與警備。
- **大小**：11×9，一個副本最多串 2 張：入口與公共區（食堂、浴場）、宿舍層。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 正門：有門禁與舍監，要拿到 `K` 或表演對 DC 基準（扮成來探望的家人、送貨的人）。
  - 浴場的鍋爐間：機械對 DC 基準。
  - 宿舍層的陽台：運動對 DC 基準＋3。
  - 通勤人潮：早晚的上下班時段，隱匿對 DC 基準混在人群裡走進去。
- **放東西的位置**：`T` 目標的房間、舍監室（入住名冊）、食堂。`D` 舍監室。人質就是目標本人（挖角的委託裡他可能不想走）。`K` 洗衣間的制服與房卡。`C` 兩區：門禁、宿舍層的燈與廣播（拿下廣播可以叫所有人到食堂集合，宿舍層的遭遇少一半）。`G` 正門、宿舍層的電梯口。`X` 鍋爐間、正門。
- **遭遇點**：
  - ① 食堂：中。長桌是半掩體。
  - ② 宿舍層的走廊：稀。
  - ③ 目標的房間：密。
- **適合的委託**：挖角、心智、救援、蜜罐。
- **踩點會揭開**：目標（他的房號、他有沒有室友、他想不想走）；守備（舍監是不是家政課的人）；路（鍋爐間、通勤的時段）。

### 塔的服務層（`map_service_level`）

- **對應**：新。
- **區與勢力**：冠冕區。每棟企業塔的地下三到五層：清潔、廚房、機娘的維修間。緋櫻、星旗、夜鶯、萬華鏡的塔都有一層。
- **大小**：13×9，一個副本最多串 2 張：卸貨與廚房、維修間與貨梯。每張四個區塊，各 2 個遭遇點。常當成辦公樓層的前一張。
- **入口**：
  - 卸貨口：交涉對 DC 基準，或拿到 `K`。
  - 維修井：從地下層的淺層上來，隱匿對 DC 基準。不經過冠冕區的閘門。
  - 員工通道：表演對 DC 基準，扮成清潔工或廚工。
- **放東西的位置**：`T` 機娘的維修間、員工名冊、貨梯控制。`D` 維修間的診斷台。保險箱是廚房的現金櫃。人質是被留在維修間的機娘或被扣下的清潔工。`K` 清潔工的置物櫃（幾乎每個服務層都有，踩點不必找）。`C` 兩區：貨梯、門禁與攝影機。`G` 卸貨口、貨梯口。`X` 維修井、卸貨口。
- **遭遇點**：
  - ① 廚房：密。不鏽鋼工作台是掩體。
  - ② 洗衣間：中。洗衣籠是半掩體，蒸氣口可以在一格放煙霧。
  - ③ 維修間：中。維修台是厚重的掩體；台上的機娘被打到會醒過來。
  - ④ 貨梯口：稀。
- **適合的委託**：竊密、挖角、奪取，以及所有要進冠冕區的塔的委託的第一階段。
- **踩點會揭開**：路（維修井、哪一個清潔班肯收錢）；守備（巡檢無人機的路線）；詞條（「今晚換班」：保全少一半，但新的那一班更警覺）。這裡的清潔工什麼都看得到，打聽的難度 −2。

### 潛艙店（`map_dive_parlor`）

- **對應**：新。
- **區與勢力**：蜂巢的西棟與四十二番街最常見。給沒有甲板的人租潛艙的小店；野良、同人眾、牆語者的信徒常泡在裡面，夜鶯也開連鎖店。
- **大小**：9×9，一個副本用 1 張。三個區塊：櫃檯、潛艙列、店長的機房。遭遇點 2 個。
- **入口**：
  - 正門：沒有條件。租一格潛艙（等級×30）。
  - 後門：機械對 DC 基準。
  - 線路的維修口（要踩點）：介面對 DC 基準，從隔壁的店接過來。
- **放東西的位置**：`T` 某一格潛艙裡的人（他的身體在這裡、意識在網內）、店長的機房。`D` 每一格潛艙都是一個資料埠；店長的機房是主埠。人質就是躺在潛艙裡的人。`K` 櫃檯的備用卡。`C` 一區：潛艙的電源（拔掉一格的電源會讓裡面的人強制斷線，感載 +20）、門與燈。`G` 櫃檯、機房。`X` 正門、後門。
- **遭遇點**：
  - ① 潛艙列：密。潛艙是掩體，但潛艙裡有人，打壞一格會把那個人一起打出來（警戒 +15）。
  - ② 機房：稀。
- **適合的委託**：心智（讓他上線）、救援（把被扣線的人拔出來）、竊密（從這裡進目標的子網）、獵溺。
- **踩點會揭開**：目標（他每天泡哪一格、泡多久）；蕾絲（店的子網連到哪裡）；守備（店長有沒有養打手）。

### 遊艇（`map_yacht`）

- **對應**：新。
- **區與勢力**：玻璃岸的遊艇碼頭與外海。富人、夜宴社、黑泉的高層、伊甸園的私人派對；胭脂堂的走私船也偽裝成這個樣子。
- **大小**：13×9，一個副本最多串 2 張：甲板與酒吧、船艙。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 舷梯：拿到邀請，或被帶上船（誘惑或交涉對 DC 基準）。強攻時船會開走，下一個階段的遭遇在海上。
  - 小艇：從海上靠過去，操縱對 DC 基準。
  - 潛水（要踩點）：運動對 DC 基準＋3，從錨鏈爬上去。
- **放東西的位置**：`T` 主人的艙房、酒吧的貴賓席、船底的貨艙。`D` 駕駛台。保險箱在主人的艙房。人質在貨艙。`K` 船員休息室。`C` 兩區：駕駛台（拿下它可以讓船轉向：所有站在甲板上的人這一回合少 1 點行動點）、甲板的燈與攝影機。`G` 舷梯、駕駛台、艙房門口。`X` 小艇、舷梯。
- **遭遇點**：
  - ① 甲板：稀，夜間是黑暗。救生艇是半掩體。
  - ② 酒吧：中。人群算半掩體。
  - ③ 船艙走廊：稀。
  - ④ 貨艙：密。
- **適合的委託**：蜜罐、暗殺、奪取、接待、救援。
- **踩點會揭開**：目標（船什麼時候出海、他睡在哪一間）；守備（船員裡有幾個是保鑣）；雇主（委託人是不是也在船上）；詞條（「今晚出海」：撤退的路只剩小艇）。

### 驛站與休息站（`map_truck_stop`）

- **對應**：新。
- **區與勢力**：鏽帶。野薔薇的薔薇驛那一類、外環公路的休息站、黑泉的加油站。野薔薇、鉻娘子的公路獵手、黑泉、星旗的補給車隊。
- **大小**：13×9，一個副本最多串 2 張：加油區與停車場、餐廳與修車廠。每張三個區塊，各 2 個遭遇點。
- **入口**：
  - 公路：沒有條件。開車進來。
  - 荒地：隱匿對 DC 基準，從背後的沙丘走過來。
  - 車隊（要踩點）：混進一支要進站的車隊，交涉對 DC 基準。
- **放東西的位置**：`T` 一輛指定的卡車、修車廠的升降台、餐廳的某一桌。`D` 加油機的帳務終端（白子網）。保險箱是收銀台後面的鐵櫃。人質在卡車的貨斗裡。`K` 修車廠的工作服。`C` 一區：加油機的總開關（關掉時加油區的車都開不走）、燈。`G` 加油區、修車廠門口。`X` 公路。
- **遭遇點**：
  - ① 加油區：中。加油機是掩體；加油機打壞會起火，那一格與相鄰的一格這一場每回合熱能傷害 1d6。
  - ② 停車場：稀。卡車是厚重的掩體，但只在第 4 格。
  - ③ 修車廠：密。
- **適合的委託**：護送（起點與中途）、奪取、討債、破壞。
- **踩點會揭開**：目標（車隊幾點進站）；守備（車隊長帶幾個槍手）；路（哪一支車隊肯讓你混進去）；詞條（「沙暴要來了」：戶外的遭遇點命中 −2）。

### 各區常抽的模板（補上新的六張）

SITES 12.4 節的權重表照舊，新的六張加在後面：

| 區 | 常抽的模板（權重高的在前） |
|---|---|
| 蜂巢 | 公寓、超商、商店街、倉庫、屋頂、**潛艙店** |
| 四十二番街 | 俱樂部、人偶館、診所、旅館、片場、**潛艙店** |
| 櫻町 | live house、商店街、小辦公室、超商、公寓、**女僕咖啡廳**、**社宅** |
| 冠冕區 | 辦公樓層、機房、停車場、屋頂、宅邸、**服務層** |
| 舊港 | 碼頭貨櫃區、倉庫、冷庫、賭場、排水道 |
| 玻璃岸 | 宅邸、俱樂部、實驗室、片場、停車場、**遊艇** |
| 鏽帶 | 工廠、倉庫、檢查哨、碼頭貨櫃區（陸運版）、**驛站** |
| 地下層 | 排水道、地鐵、機房（舊網的）、倉庫 |

資料的樣子照 SITES 第 14 節的 `commission_maps`，id 用這一份的 `map_` 前綴，另外加兩欄：`entries` 的每一個寫 `need`（基本功與 DC 的加值，或 `link`、`scouted`、`item`），`spots` 的每一個寫 `cover`（四種配置之一，或八格逐格寫）與 `material`。

```json
{ "id": "map_maid_cafe", "kind": "maid_cafe", "size": [11, 9], "max_maps": 1,
  "entries": [
    { "kind": "front" },
    { "kind": "back", "need": { "any": [ { "basic": "performance", "dc_plus": 0 }, { "item": "K" } ] } },
    { "kind": "staff_join", "need": { "scouted": "maid_hiring", "any": [ { "basic": "seduction", "dc_plus": 3 }, { "basic": "performance", "dc_plus": 3 } ] } }
  ],
  "markers": { "T": 3, "D": 1, "C": 1, "G": 2, "K": 1, "X": 1 },
  "spots": [
    { "id": "floor",   "cover": "medium",     "crowd": true, "material": { "dessert_case": "fragile" } },
    { "id": "kitchen", "cover": "dense",      "hazard": "stove_fire" },
    { "id": "office",  "cover": "one_sided" }
  ],
  "fits": ["honeypot", "entertain", "poach", "escort", "steal_data"],
  "district_weight": { "sakura": 3, "42nd": 1 } }
```

## 輿論的議題模板

### 共通的寫法

每個議題寫七樣：

| 欄位 | 寫什麼 |
|---|---|
| id | `tp_` 開頭 |
| 議題類型（`category`） | 醜聞、犯罪、商品、人物、政策、緋聞、圈子。這是**新加的欄位**：DATA 9.1 節的 `kind` 是開場的類型（OPINION 5.1 節的引爆、抹黑、滅火、洗白、嫁禍），題材另外用 `category` 記，生成時才知道該配哪一種對手與哪幾種片 |
| 開場 | 這個議題最常用的開場類型。同一個議題換一邊接，開場就換（抹黑與滅火是同一件事的兩面，COMMISSIONS 第 7 節） |
| 牽涉 | `involves`：勢力、人的類型、片的類型（MEDIA 第 1 節的六種：戰鬥、醜聞、罪證、親密、名人、日常）。OPINION 4.3a 節靠它判斷片進不進得了牌庫 |
| 分數 | 九個格子各 0～3，照 DATA 9.1 節的鍵與順序：kaleido、sakura、nightingale、tape、doujin、fanclub、wall、whisper、relay。合計 10～12 |
| 常用在 | 哪幾種委託的輿論面 |
| 預設的對手 | 公關的 id（ENEMY_ROSTER 第六節）。強度沒寫的照 DATA 6.3 節：照副本的等級，八家主要企業 +1 |

- 九個格子的位置固定（OPINION 3.1 節）：上排同人圈、帶子街、應援圈；中排緋櫻映畫、萬華鏡、夜鶯直播；下排牆報、街上的耳語、地下轉播站。分數高的格子離開場的位置越遠，那一場越難打。
- **滅火的議題不能以萬華鏡當對手**（OPINION 5.1 節），所以萬華鏡自己出事的議題只有爆料與抹黑兩種開場。
- 「另一個主播」在 ENEMY_ROSTER 沒有 id，這一份暫時叫 `pr_rival_streamer`（DATA 6.3 節的 `mimic`）。
- 一場短的輿論戰（非最後階段，四回合）用同一個議題，分數不變。

### 大眾的議題

#### 義體的召回（`tp_product_recall`）

- **議題類型**：商品。**開場**：引爆（爆料方）；滅火（廠商方）。
- **牽涉**：勢力 織女、崑崙、緋櫻（看是哪一家的產品）；人 工程師、受害的用戶、品管主管；片 罪證、日常。
- **分數**：kaleido 3、sakura 2、nightingale 2、tape 0、doujin 2、fanclub 0、wall 1、whisper 1、relay 1（合計 12）。同人圈的分數高，因為電器街的玩家社團最早發現問題。
- **常用在**：爆料、滅火、竊密之後的第二階段（拿到的品管報告當料）。
- **預設的對手**：`pr_orihime`；產品是崑崙的換 `pr_kunlun`，緋櫻的換 `pr_hizakura`。

#### 人體實驗（`tp_human_trials`）

- **議題類型**：醜聞。**開場**：引爆。
- **牽涉**：勢力 蜜腺、天使急救；人 實驗體、研究主任、療養院的病人家屬；片 罪證、醜聞。
- **分數**：kaleido 3、sakura 2、nightingale 2、tape 1、doujin 0、fanclub 0、wall 1、whisper 1、relay 2（合計 12）。
- **常用在**：爆料、抹黑；救援的第一階段（全城在看，對方不敢把人移走）。
- **預設的對手**：`pr_nectar`。它專打風向，公信力低的玩家幾乎搶不動。

#### 契約農場（`tp_contract_farm`）

- **議題類型**：醜聞。**開場**：引爆。
- **牽涉**：勢力 黑泉、伊甸園（仲介契約）；人 契約工、農場的管理者、逃出來的人；片 罪證、日常。
- **分數**：kaleido 2、sakura 1、nightingale 1、tape 0、doujin 0、fanclub 0、wall 2、whisper 2、relay 3（合計 11）。地下轉播站最高，因為車族的廣播最先播出來。
- **常用在**：爆料、救援（契約工）的第一階段、破壞之後的造勢。
- **預設的對手**：`pr_blackspring`。它搶街頭那一排，耳語與地下轉播站它搶的時候防守 −1。

#### 星旗的領事（`tp_scandal_starbelle`）

- **議題類型**：人物。**開場**：抹黑。
- **牽涉**：勢力 星旗；人 領事、軍需官、領事的秘書；片 醜聞、罪證。這一筆就是 DATA 9.1 節的例子。
- **分數**：kaleido 3、sakura 2、nightingale 1、tape 1、doujin 0、fanclub 0、wall 1、whisper 2、relay 1（合計 11）。
- **常用在**：抹黑、暗殺的第一階段（把他引到公開場合）、竄改的第二階段。
- **預設的對手**：`pr_starbelle`。第一回合就發律師函，落後 2 分就找上門。

#### 只救會員（`tp_angel_members`）

- **議題類型**：醜聞。**開場**：引爆。
- **牽涉**：勢力 天使急救；人 沒有會員資格的傷者、急救隊員、調度員；片 罪證、日常。
- **分數**：kaleido 3、sakura 1、nightingale 1、tape 0、doujin 0、fanclub 0、wall 2、whisper 2、relay 2（合計 11）。
- **常用在**：爆料、抹黑；護送的第一階段（讓救護浮空車不敢中途把人扔下）。
- **預設的對手**：`pr_angel`。

#### 排行榜的手（`tp_kaleido_algorithm`）

- **議題類型**：醜聞。**開場**：引爆或抹黑。萬華鏡不當滅火的對手，所以這個議題沒有滅火的版本；委託人是萬華鏡時，改用造勢（把注意力引到別的地方）。
- **牽涉**：勢力 萬華鏡、夜鶯；人 演算法工程師、被壓下去的創作者、買排行的明星；片 罪證、名人。
- **分數**：kaleido 3、sakura 2、nightingale 2、tape 1、doujin 1、fanclub 1、wall 0、whisper 1、relay 1（合計 12）。
- **常用在**：爆料、抹黑、竄改的第二階段。
- **預設的對手**：`pr_kaleido`。它從正中央的萬華鏡開場，那一格 3 分一開始就在它手上。

### 圈子的議題

#### 偶像的戀愛（`tp_idol_romance`）

- **議題類型**：緋聞。**開場**：引爆（爆料方）；滅火（事務所方）。
- **牽涉**：勢力 緋櫻（戰姬事業部）、親衛隊、地下偶像的事務所；人 公司偶像、地下偶像、她的對象；片 名人、親密。
- **分數**：kaleido 2、sakura 2、nightingale 2、tape 1、doujin 1、fanclub 3、wall 0、whisper 1、relay 0（合計 12）。
- **常用在**：爆料、滅火、蜜罐的第一階段、挖角的第一階段。
- **預設的對手**：`pr_hizakura`；地下偶像的換 `pr_guard`（親衛隊自己會出來護航）。滅火時對手是爆料的那一方，多半是 `pr_rival_streamer`。

#### 畢業之後（`tp_idol_graduation`）

- **議題類型**：人物。**開場**：引爆。
- **牽涉**：勢力 緋櫻（奉公課）、親衛隊；人 畢業的偶像、她的經紀人、還記得她的粉絲；片 名人、罪證。
- **分數**：kaleido 2、sakura 2、nightingale 1、tape 0、doujin 1、fanclub 3、wall 1、whisper 1、relay 1（合計 12）。
- **常用在**：爆料、救援的第一階段、心智的第一階段（讓她上線，粉絲的訊息是門路）。
- **預設的對手**：`pr_hizakura`。家政課的找上門在這個議題上比較早：落後 3 分就來。

#### 帶子外流（`tp_tape_leak`）

- **議題類型**：緋聞。**開場**：滅火（當事人是委託人）；引爆（賣帶子的那一方是委託人）。
- **牽涉**：勢力 帶子街的攤商、蜜糖會、伊甸園；人 被錄的人、錄的人、買斷的人；片 親密、名人。
- **分數**：kaleido 1、sakura 0、nightingale 2、tape 3、doujin 1、fanclub 2、wall 0、whisper 2、relay 0（合計 11）。
- **常用在**：滅火、抹除之後的收尾、蜜罐的後續。
- **預設的對手**：`pr_rival_streamer`；帶子是伊甸園流出來的換 `pr_eden`（它會收買兩次）。

#### 主播互撕（`tp_streamer_feud`）

- **議題類型**：人物。**開場**：抹黑；兩邊各有一個主播接案的時候用引爆。
- **牽涉**：勢力 夜鶯、萬華鏡；人 主播、她的剪輯師、她的金主；片 名人、醜聞。
- **分數**：kaleido 2、sakura 0、nightingale 3、tape 1、doujin 1、fanclub 2、wall 0、whisper 1、relay 1（合計 11）。
- **常用在**：抹黑、造勢、滅火。
- **預設的對手**：`pr_rival_streamer`。這是「同一件事兩邊都有人接」最常見的議題。

#### 中之人（`tp_vtuber_soul`）

- **議題類型**：人物。**開場**：引爆（揭露）；滅火（平台方）。
- **牽涉**：勢力 夜鶯；人 虛擬主播、操作她的人、平台的經紀；片 名人、日常。
- **分數**：kaleido 1、sakura 0、nightingale 3、tape 1、doujin 2、fanclub 3、wall 0、whisper 1、relay 0（合計 11）。
- **常用在**：爆料、滅火、挖角（把中之人連帳號一起帶走）。
- **預設的對手**：`pr_nightingale`。

#### 同人社團的糾紛（`tp_doujin_feud`）

- **議題類型**：圈子。**開場**：抹黑。
- **牽涉**：勢力 同人眾、織女（設計圖的版權）；人 壁社團的社長、被抄的作者、無人機社團；片 日常、醜聞。
- **分數**：kaleido 0、sakura 0、nightingale 2、tape 1、doujin 3、fanclub 2、wall 1、whisper 1、relay 1（合計 11）。這一筆是 OPINION 3.2 節表裡「小眾議題」那一列。
- **常用在**：抹黑、造勢、洗白；低等級的新手輿論委託。
- **預設的對手**：`pr_doujin`。強度多半是 1。

#### 戰鬥帶子造假（`tp_mech_tape_fake`）

- **議題類型**：商品。**開場**：引爆。
- **牽涉**：勢力 緋櫻（機甲的周邊）、帶子街；人 機師、帶子的剪輯師、買帶子的粉絲；片 戰鬥、罪證。
- **分數**：kaleido 2、sakura 2、nightingale 1、tape 3、doujin 1、fanclub 1、wall 0、whisper 1、relay 0（合計 11）。
- **常用在**：爆料、滅火、竄改（讓假的版本被當成真的）。
- **預設的對手**：`pr_hizakura`。

#### 夜宴社的名單（`tp_banquet_party`）

- **議題類型**：醜聞。**開場**：引爆。
- **牽涉**：勢力 夜宴社、黑泉、伊甸園；人 出席的富人與企業高層、被請去的藝人；片 親密、名人。
- **分數**：kaleido 2、sakura 1、nightingale 1、tape 2、doujin 0、fanclub 1、wall 1、whisper 2、relay 1（合計 11）。
- **常用在**：爆料、蜜罐之後的收尾、滅火（名單上的人是委託人）。
- **預設的對手**：`pr_banquet`。

### 街頭的議題

#### 人偶館的違約（`tp_doll_contract`）

- **議題類型**：醜聞。**開場**：引爆。
- **牽涉**：勢力 伊甸園、蜜糖會；人 人偶、樓面經理、常客；片 罪證、親密。
- **分數**：kaleido 1、sakura 1、nightingale 1、tape 3、doujin 0、fanclub 0、wall 2、whisper 3、relay 1（合計 12）。
- **常用在**：爆料、救援（人偶逃亡）的第一階段、洗白（替逃出來的人說話）。
- **預設的對手**：`pr_eden`。

#### 刀巷的併發症（`tp_backalley_clinic`）

- **議題類型**：犯罪。**開場**：引爆。
- **牽涉**：勢力 蜜糖會（互助診所）、天使急救、無照改造師；人 改造師、併發症的病人、賣假零件的人；片 罪證、日常。
- **分數**：kaleido 1、sakura 0、nightingale 1、tape 1、doujin 0、fanclub 0、wall 2、whisper 3、relay 2（合計 10）。
- **常用在**：爆料、滅火、討債與回收的後續。
- **預設的對手**：`pr_honey`；診所是天使急救的分站時換 `pr_angel`。

#### 桃子屋的新口味（`tp_snack_additive`）

- **議題類型**：商品。**開場**：引爆。
- **牽涉**：勢力 甜心食品；人 中央廚房的員工、吃上癮的客人、店長；片 罪證、日常。
- **分數**：kaleido 2、sakura 1、nightingale 2、tape 0、doujin 1、fanclub 1、wall 2、whisper 2、relay 0（合計 11）。
- **常用在**：爆料、竊密之後的收尾；滅火（甜心是委託人）。
- **預設的對手**：`pr_sweetheart`。

#### 收租無人機（`tp_rent_hike`）

- **議題類型**：政策。**開場**：引爆。
- **牽涉**：勢力 緋櫻（緋櫻銀行）、孤星連；人 蜂巢的住戶、樓長、銀行的催收員；片 日常、罪證。
- **分數**：kaleido 1、sakura 1、nightingale 0、tape 0、doujin 0、fanclub 0、wall 3、whisper 3、relay 2（合計 10）。
- **常用在**：爆料、造勢（替住戶發聲）、討債的反面（替被討債的人拖時間）。
- **預設的對手**：`pr_hizakura`。

#### 地盤的界線（`tp_gang_border`）

- **議題類型**：犯罪。**開場**：嫁禍（另外指定一格：耳語）。
- **牽涉**：勢力 特攻姬、鉻娘子、胭脂堂（看是哪一條界線）；人 兩邊的隊長、被波及的店家；片 戰鬥、日常。
- **分數**：kaleido 0、sakura 1、nightingale 0、tape 2、doujin 0、fanclub 0、wall 2、whisper 3、relay 2（合計 10）。這一筆是 OPINION 3.2 節表裡「街頭的事」那一列。
- **常用在**：抹黑、嫁禍、破壞之後的收尾。
- **預設的對手**：`pr_chrome`；委託人是鉻娘子的時候換 `pr_tokko`。幫派不玩公關，第二回合就找上門。

#### 拆體客的冷庫（`tp_chop_shop`）

- **議題類型**：犯罪。**開場**：引爆。
- **牽涉**：勢力 拆體客、市警（收錢的那幾個）；人 被拆的人、冰桶司機、買二手義體的人；片 罪證、戰鬥。
- **分數**：kaleido 1、sakura 0、nightingale 1、tape 1、doujin 0、fanclub 0、wall 3、whisper 3、relay 2（合計 11）。
- **常用在**：爆料、救援的第一階段、討債與回收（找回被拆走的義體）。
- **預設的對手**：`pr_strippers`。

#### 盤查打人（`tp_lonestar_beating`）

- **議題類型**：犯罪。**開場**：引爆；孤星連是委託人時是洗白。
- **牽涉**：勢力 孤星連、野良；人 被打的獸耳居民、巡守隊員、目擊的鄰居；片 戰鬥、罪證。
- **分數**：kaleido 1、sakura 1、nightingale 1、tape 0、doujin 1、fanclub 0、wall 2、whisper 3、relay 1（合計 10）。
- **常用在**：爆料、洗白、護送（替證人開路）。
- **預設的對手**：`pr_lonestar`。

#### 收錢的分局（`tp_police_payoff`）

- **議題類型**：犯罪。**開場**：引爆。
- **牽涉**：勢力 市警、胭脂堂、蜜糖會；人 督察、巡警、付保護費的店家；片 罪證、日常。
- **分數**：kaleido 1、sakura 1、nightingale 0、tape 0、doujin 0、fanclub 0、wall 3、whisper 3、relay 2（合計 10）。
- **常用在**：爆料、抹黑、救援（劫囚）的第一階段。
- **預設的對手**：`pr_police`。

#### 封街（`tp_festival_closure`）

- **議題類型**：政策。**開場**：抹黑；祭典組是委託人時是造勢。
- **牽涉**：勢力 祭典組、特攻姬、同人眾（夜市的攤位）；人 祭典的頭人、被收攤位費的攤販；片 日常、戰鬥。
- **分數**：kaleido 0、sakura 1、nightingale 1、tape 0、doujin 2、fanclub 1、wall 2、whisper 2、relay 1（合計 10）。
- **常用在**：抹黑、造勢、護送（祭典的夜裡）。
- **預設的對手**：`pr_festival`。

### 政策與城市的議題

#### 掃橋閘門的擴大（`tp_scan_gate`）

- **議題類型**：政策。**開場**：引爆（反對方）；滅火（貞網局或理事會一方）。
- **牽涉**：勢力 貞網局、夜鶯、理事會；人 審查官、被攔下的通勤者、溺感者的家屬；片 日常、罪證。
- **分數**：kaleido 3、sakura 1、nightingale 2、tape 0、doujin 1、fanclub 0、wall 1、whisper 1、relay 2（合計 11）。
- **常用在**：爆料、造勢、竄改的第二階段（讓改過的掃描紀錄被當成真的）。
- **預設的對手**：`pr_netvigil`。

#### 溺感者的事件（`tp_drowned_attack`）

- **議題類型**：犯罪。**開場**：洗白（替溺感者說話）；引爆（鎮溺隊過度執法）。
- **牽涉**：勢力 鎮溺隊、牆語者、貞網局；人 溺感者、他的家人、隔離班長；片 戰鬥、罪證。
- **分數**：kaleido 2、sakura 1、nightingale 2、tape 0、doujin 0、fanclub 0、wall 2、whisper 2、relay 2（合計 11）。
- **常用在**：獵溺的第二階段（讓鎮溺隊晚到）、洗白、爆料。
- **預設的對手**：`pr_suppress`。

#### 主管的醜事（`tp_exec_affair`）

- **議題類型**：緋聞。**開場**：抹黑；主管是委託人時是滅火。
- **牽涉**：勢力 照主管的公司（緋櫻、黑泉、崑崙、星旗）、伊甸園；人 企業主管、契約人、他的秘書；片 親密、醜聞。
- **分數**：kaleido 3、sakura 2、nightingale 1、tape 2、doujin 0、fanclub 0、wall 1、whisper 2、relay 0（合計 11）。
- **常用在**：抹黑、蜜罐的後續、滅火、挖角（讓他自己想離開公司）。
- **預設的對手**：主管所屬公司的公關，沒有指定時用 `pr_hizakura`。

#### 新品的造勢（`tp_product_launch`）

- **議題類型**：商品。**開場**：引爆（委託人是廠商，對手是競品）。
- **牽涉**：勢力 織女、崑崙、甜心食品、緋櫻（周邊）；人 代言的偶像、評測的主播、競品的工程師；片 名人、日常。
- **分數**：kaleido 2、sakura 2、nightingale 2、tape 1、doujin 1、fanclub 2、wall 1、whisper 0、relay 0（合計 11）。
- **常用在**：造勢、接待的第二階段（替你造勢，他會更想見你）、抹黑（拆競品的台）。
- **預設的對手**：競品那一家的公關，沒有指定時用 `pr_orihime`。

#### 被冤枉的人（`tp_framed_person`）

- **議題類型**：人物。**開場**：洗白（對手已經佔了三格，你只有它對面的一格，風向 −3）。
- **牽涉**：勢力 栽贓的那一方（市警、企業、幫派）；人 被冤枉的人、真正做事的人、證人；片 罪證、日常。
- **分數**：kaleido 2、sakura 1、nightingale 1、tape 0、doujin 0、fanclub 1、wall 2、whisper 3、relay 1（合計 11）。
- **常用在**：洗白、救援的第一階段、護送（證人）。
- **預設的對手**：栽贓的那一方，沒有指定時用 `pr_police`。

### 議題一覽

| id | 類型 | 開場 | kaleido | sakura | nightingale | tape | doujin | fanclub | wall | whisper | relay | 合計 | 對手 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `tp_product_recall` | 商品 | 引爆 | 3 | 2 | 2 | 0 | 2 | 0 | 1 | 1 | 1 | 12 | `pr_orihime` |
| `tp_human_trials` | 醜聞 | 引爆 | 3 | 2 | 2 | 1 | 0 | 0 | 1 | 1 | 2 | 12 | `pr_nectar` |
| `tp_contract_farm` | 醜聞 | 引爆 | 2 | 1 | 1 | 0 | 0 | 0 | 2 | 2 | 3 | 11 | `pr_blackspring` |
| `tp_scandal_starbelle` | 人物 | 抹黑 | 3 | 2 | 1 | 1 | 0 | 0 | 1 | 2 | 1 | 11 | `pr_starbelle` |
| `tp_angel_members` | 醜聞 | 引爆 | 3 | 1 | 1 | 0 | 0 | 0 | 2 | 2 | 2 | 11 | `pr_angel` |
| `tp_kaleido_algorithm` | 醜聞 | 引爆或抹黑 | 3 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | 1 | 12 | `pr_kaleido` |
| `tp_idol_romance` | 緋聞 | 引爆 | 2 | 2 | 2 | 1 | 1 | 3 | 0 | 1 | 0 | 12 | `pr_hizakura` |
| `tp_idol_graduation` | 人物 | 引爆 | 2 | 2 | 1 | 0 | 1 | 3 | 1 | 1 | 1 | 12 | `pr_hizakura` |
| `tp_tape_leak` | 緋聞 | 滅火 | 1 | 0 | 2 | 3 | 1 | 2 | 0 | 2 | 0 | 11 | `pr_rival_streamer` |
| `tp_streamer_feud` | 人物 | 抹黑 | 2 | 0 | 3 | 1 | 1 | 2 | 0 | 1 | 1 | 11 | `pr_rival_streamer` |
| `tp_vtuber_soul` | 人物 | 引爆 | 1 | 0 | 3 | 1 | 2 | 3 | 0 | 1 | 0 | 11 | `pr_nightingale` |
| `tp_doujin_feud` | 圈子 | 抹黑 | 0 | 0 | 2 | 1 | 3 | 2 | 1 | 1 | 1 | 11 | `pr_doujin` |
| `tp_mech_tape_fake` | 商品 | 引爆 | 2 | 2 | 1 | 3 | 1 | 1 | 0 | 1 | 0 | 11 | `pr_hizakura` |
| `tp_banquet_party` | 醜聞 | 引爆 | 2 | 1 | 1 | 2 | 0 | 1 | 1 | 2 | 1 | 11 | `pr_banquet` |
| `tp_doll_contract` | 醜聞 | 引爆 | 1 | 1 | 1 | 3 | 0 | 0 | 2 | 3 | 1 | 12 | `pr_eden` |
| `tp_backalley_clinic` | 犯罪 | 引爆 | 1 | 0 | 1 | 1 | 0 | 0 | 2 | 3 | 2 | 10 | `pr_honey` |
| `tp_snack_additive` | 商品 | 引爆 | 2 | 1 | 2 | 0 | 1 | 1 | 2 | 2 | 0 | 11 | `pr_sweetheart` |
| `tp_rent_hike` | 政策 | 引爆 | 1 | 1 | 0 | 0 | 0 | 0 | 3 | 3 | 2 | 10 | `pr_hizakura` |
| `tp_gang_border` | 犯罪 | 嫁禍 | 0 | 1 | 0 | 2 | 0 | 0 | 2 | 3 | 2 | 10 | `pr_chrome` |
| `tp_chop_shop` | 犯罪 | 引爆 | 1 | 0 | 1 | 1 | 0 | 0 | 3 | 3 | 2 | 11 | `pr_strippers` |
| `tp_lonestar_beating` | 犯罪 | 引爆 | 1 | 1 | 1 | 0 | 1 | 0 | 2 | 3 | 1 | 10 | `pr_lonestar` |
| `tp_police_payoff` | 犯罪 | 引爆 | 1 | 1 | 0 | 0 | 0 | 0 | 3 | 3 | 2 | 10 | `pr_police` |
| `tp_festival_closure` | 政策 | 抹黑 | 0 | 1 | 1 | 0 | 2 | 1 | 2 | 2 | 1 | 10 | `pr_festival` |
| `tp_scan_gate` | 政策 | 引爆 | 3 | 1 | 2 | 0 | 1 | 0 | 1 | 1 | 2 | 11 | `pr_netvigil` |
| `tp_drowned_attack` | 犯罪 | 洗白 | 2 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 2 | 11 | `pr_suppress` |
| `tp_exec_affair` | 緋聞 | 抹黑 | 3 | 2 | 1 | 2 | 0 | 0 | 1 | 2 | 0 | 11 | `pr_hizakura` |
| `tp_product_launch` | 商品 | 引爆 | 2 | 2 | 2 | 1 | 1 | 2 | 1 | 0 | 0 | 11 | `pr_orihime` |
| `tp_framed_person` | 人物 | 洗白 | 2 | 1 | 1 | 0 | 0 | 1 | 2 | 3 | 1 | 11 | `pr_police` |

### 資料的樣子

DATA 9.1 節的 `topic` 加一欄 `category`，其餘照舊。議題模板存在 `data/rules/topics.json`，副本生成時把整筆抄進 `opinion_setup.topic`，再改 `rounds`。

```json
{ "id": "tp_doll_contract", "category": "scandal", "kind": "ignite", "rounds": 6,
  "involves": { "factions": ["eden", "honey"], "people": ["doll", "floor_manager", "regular"], "types": ["crime", "intimate"] },
  "scores": { "kaleido": 1, "sakura": 1, "nightingale": 1, "tape": 3, "doujin": 0,
              "fanclub": 0, "wall": 2, "murmur": 3, "relay": 1 },
  "fits": ["expose", "rescue", "whitewash"],
  "opponent": { "id": "pr_eden" } }
```

- `category` 的值：`scandal` 醜聞、`crime` 犯罪、`product` 商品、`person` 人物、`policy` 政策、`affair` 緋聞、`circle` 圈子。
- `kind` 的值：`ignite` 引爆、`smear` 抹黑、`firefight` 滅火、`whitewash` 洗白、`frame` 嫁禍。嫁禍另外帶 `must_hold`（指定的那一格）。
- `opponent.strength` 不寫的時候照 DATA 6.3 節。

## 委託系列的範例

### 共通的寫法

照 SERIES 第 10 節「帳本」的寫法：一張成員表（成員、類型、條件、結局的旗標），條件只靠旗標與好感，`done_when` 寫哪些旗標成立算整組結束。系列不決定先後，先後由每個成員自己的條件決定。旗標都在系列的命名空間裡（SERIES 4.1 節），表裡省略 `s:<id>:` 的前綴。

線索過期時也可以寫旗標（`on_expire`），這是**新加的欄位**：SERIES 5.1 節只寫了 `expires`，沒寫過期之後怎樣；不加的話，一條沒人去追的線索會讓整組永遠掛在筆記裡。

每個系列另外附三張小表：委託副本的參數（類型、主面、規模、等級、地圖、議題、目標勢力、戰敗）、線索的參數（在哪、提示、真假、來源、幾天過期）、事件的參數（在哪、發生什麼、選項）。等級照發出的人所在的區（DISTRICTS 的各區等級）。八個系列由八個不同的人發出：七位中間人（陸伯已經有「帳本」，這裡不再用他）與一個流竄 AI。

### 欠條（`iou`）

- **發出的人**：阿蓮（蜂巢）。**等級**：I。
- **一句話**：阿蓮在偷偷把住戶的債買回來，有一張欠條被銀行的外包催收先收走了。
- **筆記的分段**：「收回欠條」（`c_collect`、`l_drone_nest`、`e_hallway`）、「無人機的窩」（`c_drone_nest`）、「把帳攤開」（`c_rent_expose`）。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 收回一張欠條（`c_collect`） | 委託副本（阿蓮發出） | 和阿蓮好感 20 以上 | `collect_done` 或 `collect_failed` |
| 走廊上的無人機（`e_hallway`） | 事件（四號塔） | `collect_done` 或 `collect_failed` | `neighbor_helped` 或 `neighbor_left` |
| 無人機晚上停在哪（`l_drone_nest`） | 線索（牆報，半真） | `collect_done` 或 `neighbor_helped` | 得知：`nest_known`；過期：`nest_lost` |
| 拆掉無人機的窩（`c_drone_nest`） | 委託副本（阿蓮發出） | `nest_known` | `nest_done` 或 `nest_failed` |
| 把調租的帳攤開（`c_rent_expose`） | 委託副本（阿蓮發出） | `nest_done` | `expose_win` 或 `expose_lost` |

`done_when: expose_win、expose_lost、nest_failed、nest_lost 任一成立，或 collect_failed 與 neighbor_left 都成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_collect` | 討債／回收 | 現實 | 小 | I | `map_apartment` | — | 孤星連（外包的催收是退伍兵） | 勢力預設；算委託失敗 |
| `c_drone_nest` | 破壞 | 現實 | 小 | I | `map_rooftop` | — | 緋櫻（緋櫻銀行的收租無人機） | 勢力預設；算委託失敗 |
| `c_rent_expose` | 爆料 | 輿論 | 小 | I | 第一階段 `map_shop_street` | `tp_rent_hike` | 緋櫻 | 不會戰敗（輿論）；輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_drone_nest` | 蜂巢・天井市場 | 收租無人機每天凌晨飛回東側某棟塔的屋頂充電 | 半真：塔是對的，但屋頂上還有孤星連的狙擊位 | 牆報 | 5 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_hallway` | 四號塔的走廊（夜晚） | 收租無人機堵在一戶鄰居的門口，喇叭一直念著欠款的金額 | 擋在門口，威嚇對 DC 13 讓無人機退開（`neighbor_helped`）；替他付一期（等級×300，`neighbor_helped`）；不管（`neighbor_left`，蜂巢的鄰里 −2） |

- `c_rent_expose` 的公關強度指定為 1：這是銀行分行的公關，不是緋櫻本社。
- `c_collect` 失敗也會觸發 `e_hallway`：在走廊幫了鄰居，鄰居會告訴你無人機晚上停在哪，所以失敗的玩家還有一條路接下去。兩次都沒做好（`collect_failed` 加 `neighbor_left`），整組結束。
- `c_rent_expose` 的開場表：有 `neighbor_helped` 時住戶肯出面，牌庫多一張「當事人的訪談」（說法，風向 +2）；有 `collect_done` 時那張欠條是一張料（聲量 +3）。

### 晶片保管櫃（`chip_locker`）

- **發出的人**：夢露（四十二番街）。**等級**：II。
- **一句話**：伊甸園加盟店的一位人偶想走，她要把自己的晶片一起帶走。
- **標籤**：`tendency:contract`；成人的細項照委託自己的設定（救援本身沒有成人場景）。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 帶她出來（`c_doll_escape`） | 委託副本（夢露發出） | 和夢露好感 20 以上 | `escape_done` 或 `escape_failed` |
| 晶片被賣去哪了（`l_chip_stall`） | 線索（夢露給的，真） | `escape_failed` | 得知：`stall_known`；過期：`chip_lost` |
| 把晶片買回來（`c_chip_buyback`） | 委託副本（夢露發出） | `stall_known` | `chip_back` 或 `chip_lost` |
| 回收員上門（`e_collector`） | 事件（半夢的門口） | `escape_done` 或 `chip_back` | `collector_turned`、`collector_beaten` 或 `doll_returned` |
| 讓整條街知道（`c_eden_expose`） | 委託副本（夢露發出） | `collector_turned` 或 `collector_beaten` | `expose_win` 或 `expose_lost` |

`done_when: expose_win、expose_lost、doll_returned、chip_lost 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_doll_escape` | 救援 | 現實 | 中 | II | `map_doll_house` ×2 | — | 伊甸園 | 伊甸園預設（成人向）；算委託失敗並立 `escape_failed`：隊伍沒做到，她自己趁亂跑到半夢，但晶片留在館裡被賣掉 |
| `c_chip_buyback` | 奪取（實體） | 現實 | 小 | II | `map_studio`（帶子街後面的錄製間） | — | 蜜糖會之外的帶子攤商（生成的街頭勢力） | 勢力預設；算委託失敗 |
| `c_eden_expose` | 爆料 | 輿論 | 中 | II | 第一階段 `map_doll_house` | `tp_doll_contract` | 伊甸園 | 輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_chip_stall` | 四十二番街・帶子街 | 她的晶片被一個攤商買走了，三天內會被拷成帶子賣出去 | 真 | 中間人（夢露，不收錢） | 3 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_collector` | 半夢的門口（夜晚） | 伊甸園的回收員帶著兩個契約保全來要人，說她的契約還有兩年 | 交涉對 DC 16 讓回收員相信她已經出城（`collector_turned`）；打（一場遭遇：回收員是精英，兩個雜兵，勝了 `collector_beaten`，伊甸園的敵對值 +1）；把她交出去（`doll_returned`，夢露的好感 −20） |

- `c_eden_expose` 的開場表：有 `collector_turned` 時回收員肯出面作證，牌庫多一張「當事人的訪談」（說法，風向 +2）；有 `collector_beaten` 時開場風向 −1（打人的畫面在伊甸園手上）。
- 伊甸園的對手收買可以用兩次（ENEMY_ROSTER 的 `pr_eden`）。接受收買等於 `expose_lost`。

### 下班的路（`offstage`）

- **發出的人**：白鷺千早（櫻町）。**等級**：II。
- **一句話**：一個地下偶像下班的路上一直被人跟著，後來她的事務所想把她的約賣給緋櫻。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 送她回家（`c_escort_idol`） | 委託副本（千早發出） | 和千早好感 20 以上 | `escort_done` 或 `escort_failed` |
| 跟著她的人（`l_stalker`） | 線索（打聽，半真） | `escort_done` | 得知：`stalker_known` |
| 刪掉他存的照片（`c_erase_photos`） | 委託副本（千早發出） | `stalker_known` | `erase_done` 或 `erase_failed` |
| 留在白手套的信（`e_letter`） | 事件（白手套） | `escort_done` | `sale_known` |
| 在簽約之前帶走她（`c_poach_idol`） | 委託副本（千早發出） | `sale_known` | `poach_done` 或 `poach_failed` |
| 緋櫻放出來的照片（`c_firefight_idol`） | 委託副本（千早發出） | `poach_done` | `fire_out` 或 `fire_lost` |

`done_when: fire_out、fire_lost、poach_failed、escort_failed 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_escort_idol` | 護送 | 現實 | 小 | II | `map_venue` → `map_shop_street` | — | 親衛隊（失控的同擔） | 勢力預設；算委託失敗 |
| `c_erase_photos` | 抹除 | 內海 | 小 | II | 第二階段 `map_dive_parlor`（他泡的潛艙店，離線的備份在他的甲板裡） | — | 生成的個人（白子網） | 勢力預設；算委託失敗 |
| `c_poach_idol` | 挖角／綁架 | 現實 | 中 | II | `map_company_dorm` ×2 | — | 緋櫻（警備局與舍監） | 緋櫻預設（成人向）；算委託失敗 |
| `c_firefight_idol` | 滅火 | 輿論 | 小 | II | 第一階段 `map_studio` | `tp_idol_romance` | 緋櫻 | 輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_stalker` | 櫻町・千本通的地下二階 | 跟著她的人每天散場後會去西棟的一間潛艙店 | 半真：人是對的，但他不是一個人，同擔裡有三個人輪流跟 | 打聽 | 4 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_letter` | 白手套（白天） | 千早把一封信推到你面前。偶像寫說事務所下週要把她的約賣給緋櫻的戰姬事業部，她不想去 | 只有一個選項，讀完立 `sale_known`。千早說「這件事請不要接」，這是她的習慣，接下來的 `c_poach_idol` 她照樣會發 |

- `c_erase_photos` 沒做也能走到 `c_firefight_idol`。做了（`erase_done`）的話，滅火的開場表裡對手的牌少一張「偷拍」，開場風向 +1。
- `c_firefight_idol` 的對手是 `pr_hizakura`，強度照等級是 1、加上主要企業 +1，所以是 2。

### 影印（`photocopy`）

- **發出的人**：久我課長（冠冕區）。**等級**：IV。
- **一句話**：久我要一份別的部門的資料，口氣和交代影印文件一樣；拿到之後，問題變成這份東西該留在誰手上。
- **標籤**：久我的背刺率最高，這個系列的每一件都要擲收尾的背刺檢查（FIXER 第 2 節）。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 一份會議紀錄（`c_copy_data`） | 委託副本（久我發出） | 和久我好感 10 以上 | `copy_done` 或 `copy_failed` |
| 那份紀錄是誰的（`l_real_owner`） | 線索（踩點的雇主類，真） | `copy_done` | 得知：`owner_known` |
| 長椅上的鴿子（`e_bench`） | 事件（空中花園） | `copy_done` | `hush_paid` 或 `kept_copy` |
| 備份也要刪掉（`c_erase_backup`） | 委託副本（久我發出） | `hush_paid` | `erase_done` 或 `erase_failed` |
| 讓那位部長下台（`c_rival_smear`） | 委託副本（久我發出） | `erase_done` | `smear_win` 或 `smear_lost` |
| 家政課的拜訪（`e_visit`） | 事件（主角的據點） | `kept_copy` | `visit_done` |

`done_when: smear_win、smear_lost、erase_failed、visit_done、copy_failed 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_copy_data` | 竊密（資料） | 內海 | 中 | IV | `map_service_level` → `map_office_floor` → `map_server_room`（第三階段必經，有隔離區） | — | 緋櫻（另一個部門） | 緋櫻預設；算委託失敗 |
| `c_erase_backup` | 抹除 | 內海 | 小 | IV | 第二階段 `map_mansion`（部長在冠冕區的頂層公寓，離線的備份在書房） | — | 緋櫻 | 緋櫻預設；算委託失敗 |
| `c_rival_smear` | 抹黑 | 輿論 | 中 | IV | 第一階段 `map_parking`（拍他上車） | `tp_exec_affair` | 緋櫻 | 輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_real_owner` | 冠冕區・服務層 | 會議紀錄是久我上面那位部長的，裡面記著他怎麼把外包的人當成耗材 | 真 | 委託的踩點（雇主類）；`c_copy_data` 做完時沒踩到這一項的，服務層的清潔工打聽得到 | 7 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_bench` | 空中花園的長椅（白天） | 久我一邊餵機械鴿子，一邊請你把手上所有的拷貝都交出來，他多付一份報酬 | 交出來，收錢（`hush_paid`，報酬 +50%）；說都交了，其實留一份（擲表演對 DC 19，成功 `kept_copy`；失敗被看穿，也是 `kept_copy`，但久我會知道） |
| `e_visit` | 主角的據點（深夜） | 家政課的一位女僕與一位執事來拿那份拷貝。久我知道的話他們會早一天到 | 交出來（緋櫻的敵對值 +1）；打（家政課女僕與執事各一，精英；勝了緋櫻的敵對值 +2）。不管哪一種都立 `visit_done` |

- `c_rival_smear` 的開場表：有 `owner_known` 時，玩家知道那份紀錄寫了什麼，牌庫多一張「內幕」（聲量 +4，對手不能下架）。
- 這個系列沒有「好的結局」：`smear_win` 讓久我升職的機會變大，久我的關係線（NPCS）讀這個旗標。
- `e_visit` 是家園事件，照 canon「家會被闖」，不在副本裡，所以戰敗走一般的戰敗事件、不回退。

### 濾鏡（`filter`）

- **發出的人**：薇薇安·柯爾（玻璃岸）。**等級**：III。
- **一句話**：萬華鏡的排行榜有一隻手，薇薇安想讓全城看見那隻手，雖然她每週都換一次想不想回萬華鏡的答案。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 一捲測試帶（`c_test_tape`） | 委託副本（薇薇安發出） | 和薇薇安好感 20 以上 | `tape_done` 或 `tape_failed` |
| 排行的參數（`c_ranking_data`） | 委託副本（薇薇安發出） | `tape_done` | `data_done` 或 `data_failed` |
| 想說話的工程師（`l_engineer`） | 線索（線人，真） | `tape_failed` 或 `data_failed` | 得知：`engineer_known`；過期：`engineer_gone` |
| 送她出城（`c_escort_engineer`） | 委託副本（薇薇安發出） | `engineer_known` | `witness_safe` 或 `witness_lost` |
| 黃金時段（`c_kaleido_expose`） | 委託副本（薇薇安發出） | `data_done` 或 `witness_safe` | `expose_win` 或 `expose_lost` |
| 凌晨三點的電視（`e_rerun`） | 事件（別墅） | `expose_win` 或 `expose_lost` | `vivian_watched` |

`done_when: vivian_watched、witness_lost、engineer_gone 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_test_tape` | 奪取（實體） | 現實 | 小 | III | `map_studio` | — | 萬華鏡 | 萬華鏡預設；算委託失敗 |
| `c_ranking_data` | 竊密（資料） | 內海 | 中 | III | 第一、二階段 `map_mansion`（工程主管的宅邸，書房有資料埠） | — | 萬華鏡 | 萬華鏡預設；算委託失敗 |
| `c_escort_engineer` | 護送 | 現實 | 小 | III | `map_parking` → `map_yacht` | — | 萬華鏡（狗仔與替身保全） | 萬華鏡預設；算委託失敗 |
| `c_kaleido_expose` | 爆料 | 輿論 | 大 | III | 第一階段 `map_studio` | `tp_kaleido_algorithm` | 萬華鏡 | 輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_engineer` | 玻璃岸・遊艇碼頭 | 寫排行參數的工程師想離開，她今晚在一艘遊艇上等人接 | 真 | 線人（薇薇安的） | 2 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_rerun` | 薇薇安的別墅（深夜） | 薇薇安赤腳坐在沙發上，電視重播著這場爆料的新聞，播的人是賽琳·吳 | 陪她看完（她說出這週的答案，`vivian_watched`；好感 +5）；先走（`vivian_watched`） |

- `c_kaleido_expose` 的開場表：有 `data_done` 時牌庫多一張「內幕」；有 `witness_safe` 時多一張「當事人的訪談」，兩樣都有時開場聲量另外 +2。`pr_kaleido` 從中央開場，強度照等級 2，主要企業 +1，是 3。
- `witness_lost` 結束整組：證人被帶回去之後，薇薇安不再提這件事，直到她的關係線讀到這個旗標。

### 空車（`empty_truck`）

- **發出的人**：瑪拉（鏽帶）。**等級**：II～III。
- **一句話**：瑪拉的車隊空著一個座位，那個年輕人偷偷進城裝橋去了；同一段路上，黑泉新設了一道閘門。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 跟車（`c_convoy`） | 委託副本（瑪拉發出） | 和瑪拉好感 20 以上 | `convoy_done` 或 `convoy_failed` |
| 空著的座位（`e_empty_seat`） | 事件（薔薇驛） | `convoy_done` | `runaway_known` |
| 他在哪一間裝橋（`l_clinic`） | 線索（打聽，真） | `runaway_known` | 得知：`clinic_known` |
| 在手術之前（`c_rescue_runaway`） | 委託副本（瑪拉發出） | `clinic_known` | `runaway_back`、`runaway_stayed` 或 `rescue_failed` |
| 新的閘門（`c_gate`） | 委託副本（瑪拉發出） | `convoy_done` | `gate_down` 或 `gate_failed` |

`done_when: gate_down 或 gate_failed 成立`。救人的那一段可以沒做；`runaway_*` 由瑪拉的關係線讀。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_convoy` | 護送 | 現實 | 小 | II | `map_truck_stop` → `map_checkpoint` | — | 鉻娘子（公路的獵手） | 鉻娘子預設；算委託失敗 |
| `c_rescue_runaway` | 救援 | 現實 | 小 | II | `map_clinic`（刀巷） | — | 生成的無照改造師與他的打手 | 勢力預設；算委託失敗 |
| `c_gate` | 破壞 | 現實 | 中 | III | `map_checkpoint`，第二階段可選輿論 | `tp_contract_farm` | 黑泉 | 黑泉預設；算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_clinic` | 四十二番街・過載 | 一個說話帶著鏽帶口音的年輕人問過刀巷哪一間最便宜，手術排在後天晚上 | 真 | 打聽 | 2 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_empty_seat` | 薔薇驛（清晨） | 車隊點名時少了一個二十歲的年輕人。瑪拉沒有說話，一個人去檢查輪胎 | 走過去陪她（好感 +5）；去問其他車手（街頭直覺對 DC 13，成功的話直接得知 `l_clinic`）。兩種都立 `runaway_known` |

- `c_rescue_runaway` 的最後一個階段有一個選擇：年輕人說他不想回去。交涉對 DC 16 說服他（`runaway_back`）；尊重他（`runaway_stayed`，瑪拉不會怪你，好感不變）。強行帶走也算 `runaway_back`，但他對主角的親密度歸零。
- `c_gate` 的第二階段選輿論時打一場四回合的 `tp_contract_farm`：贏了，閘門的守衛被上層禁止開火（大勝的連動）。

### 沒有人認領的節點（`orphan_node`）

- **發出的人**：伊萊莎·瓦爾加（地下層）。**等級**：III。
- **一句話**：伊萊莎要你從沉船帶撈一樣東西上來，它指向中層一個沒有人認領的舊網節點，貞網局也在找它。
- **標籤**：牆。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 沉船帶的箱子（`c_salvage`） | 委託副本（伊萊莎發出） | 和伊萊莎好感 20 以上 | `salvage_done` 或 `salvage_failed` |
| 座標（`l_node`） | 線索（打撈的結果，真） | `salvage_done` | 得知：`node_known` |
| 節點裡的東西（`c_node`） | 委託副本（伊萊莎發出） | `node_known` | `node_done` 或 `node_failed` |
| 霜來買書（`e_frost`） | 事件（書店） | `node_done` | `gave_frost`、`gave_eliza` 或 `kept_node` |
| 貞網局的那一份（`c_vigil_erase`） | 委託副本（伊萊莎發出） | `gave_eliza` | `vigil_erased` 或 `vigil_failed` |

`done_when: gave_frost、kept_node、vigil_erased、vigil_failed、node_failed、salvage_failed 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_salvage` | 網內打撈 | 內海 | 小 | III | 沒有（只有內海） | — | 沒有主；遺魂 | `polluted`；算委託失敗 |
| `c_node` | 竊密（資料） | 內海 | 中 | III | `map_sewer` → `map_server_room`（舊網版，第三階段必經，有隔離區） | — | 牆語者（守著節點） | 牆語者預設；算委託失敗 |
| `c_vigil_erase` | 抹除 | 內海 | 小 | III | 第一階段 `map_service_level`（貞網局的分部借用某棟塔的服務層存放離線的備份） | — | 貞網局 | 貞網局預設；算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_node` | 地下層・中層 | 箱子裡是一串座標，指向排水大廳底下一個沒有接上夜鶯的機房 | 真 | 委託的結果 | 不過期 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_frost` | 探員的書店（白天） | 伊萊莎不在，霜坐在櫃檯後面翻一本書，說她知道你下去過，問你拿到了什麼 | 交給霜（`gave_frost`，貞網局的敵對值 −1，伊萊莎的好感 −15）；說要先給伊萊莎（`gave_eliza`）；說什麼都沒拿到，自己留著（定力對 DC 16，不管成敗都立 `kept_node`；失敗的話霜不相信，貞網局的敵對值 +1） |

- 節點裡的東西是什麼由伊萊莎的關係線與粉牆線決定，這個系列只寫它落到誰手上。
- `kept_node` 讓主角拿到一份「沒有人認領的資料」（素材，類型罪證，品質 4），可以賣、可以當料。

### 替身（`understudy`）

- **發出的人**：Ａ子（流竄 AI，牆外更深的地方）。**等級**：III。
- **一句話**：Ａ子想要一位萬華鏡演員的人設，戴上它的人就會被全城當成她。
- **接觸的條件**：沉溺 100（溺感者），並且在牆外更深的地方見過Ａ子（`rogue:a_ko:met`，第一次見到牠時立的旗標）。報酬是牆外的東西：人格面具、Ａ子的好感，不是錢。
- **標籤**：`rogue:Ａ子`、`tendency:persona`。Ａ子在內容篩選裡被關掉時，整個系列不出現。

| 成員 | 類型 | 條件（靠旗標） | 結局寫的旗標 |
|---|---|---|---|
| 慶功宴（`c_persona_honeypot`） | 委託副本（Ａ子發出） | 沉溺 100，`rogue:a_ko:met` | `mask_taken` 或 `mask_failed` |
| 衣架上的那一套（`e_hanger`） | 事件（牆外更深的地方） | `mask_taken` | `wear_self`、`wear_other` 或 `return_mask` |
| 本人去了哪（`l_original`） | 線索（Ａ子的指引，真） | `return_mask` | 得知：`original_known`；過期：`original_lost` |
| 把本人找回來（`c_rescue_original`） | 委託副本（Ａ子發出） | `original_known` | `original_back` 或 `original_lost` |
| 第一次上鏡（`c_debut`） | 委託副本（Ａ子發出） | `wear_self` 或 `wear_other` | `debut_win` 或 `debut_lost` |

`done_when: debut_win、debut_lost、original_back、original_lost、mask_failed 任一成立`。

| 委託 | 類型 | 主面 | 規模 | 等級 | 地圖 | 議題 | 目標勢力 | 戰敗 |
|---|---|---|---|---|---|---|---|---|
| `c_persona_honeypot` | 蜜罐 | 現實 | 小 | III | `map_club` ×2（萬華鏡包下的 VIP 層） | 第一階段可選輿論：`tp_streamer_feud`（先把她捧高） | 萬華鏡 | 萬華鏡預設（成人向）；算委託失敗 |
| `c_rescue_original` | 救援 | 現實 | 小 | III | `map_hotel`（萬華鏡把本人藏在旅館坡） | — | 萬華鏡（替身保全） | 萬華鏡預設；算委託失敗 |
| `c_debut` | 造勢／洗白 | 輿論 | 小 | III | 第一階段 `map_studio` | `tp_streamer_feud` | 萬華鏡；另一邊可能有 `pr_rival_streamer` | 輸了算委託失敗 |

| 線索 | 在哪 | 提示 | 真假 | 來源 | 過期 |
|---|---|---|---|---|---|
| `l_original` | 四十二番街・旅館坡 | 衣架上原本的主人被萬華鏡關在旅館坡的一間房裡，等新的她上線就會被換掉橋 | 真 | AI 的指引（`ai_hook`） | 3 天 |

| 事件 | 在哪 | 發生什麼 | 選項 |
|---|---|---|---|
| `e_hanger` | 牆外更深的地方 | Ａ子把那套人設掛在衣架上，衣服一件一件換過去，最後停在那位演員的樣子。牠問你這一套要給誰穿 | 自己穿（`wear_self`，得到人格面具「演員」，沉溺 +5）；給名冊上的一位藝人（`wear_other`，那位藝人得到這個面具，親密度 +10）；還給本人（`return_mask`，Ａ子的好感 −10，牠說「也好，換一個人演」） |

- `c_persona_honeypot` 的最後一個階段是一場有目的的成人場景，🔞，標 `rogue:Ａ子`：演員在宴會上被捧高、自己帶主角進包廂，取得把柄的方式是在場景裡讀到她的人設。成人場景被篩掉時，改成一場套話的對峙（誘惑或表演對 DC 19）。
- 戴著面具上鏡被拆穿的話（輿論戰中的水軍或假料被拆穿），反噬掉的是面具，不是公信力（OPINION 第 7 節的藝人假身分）。

### 資料的樣子

以「欠條」為例，照 SERIES 第 12 節：

```json
{
  "id": "iou", "name": "欠條", "kind": "commission_series",
  "issuer": "npc_lian",
  "journal": { "title": "欠條", "summary": "阿蓮在把住戶的債買回來，有一張被搶先收走了。" },
  "sections": [
    { "title": "收回欠條", "members": ["c_collect", "e_hallway", "l_drone_nest"] },
    { "title": "無人機的窩", "members": ["c_drone_nest"] },
    { "title": "把帳攤開", "members": ["c_rent_expose"] }
  ],
  "members": [
    { "type": "commission", "id": "c_collect" },
    { "type": "event", "id": "e_hallway" },
    { "type": "lead", "id": "l_drone_nest", "ai_hook": true },
    { "type": "commission", "id": "c_drone_nest" },
    { "type": "commission", "id": "c_rent_expose" }
  ],
  "done_when": { "any": [ { "flags_any": ["expose_win", "expose_lost", "nest_failed", "nest_lost"] },
                          { "flags_all": ["collect_failed", "neighbor_left"] } ] }
}
```

```json
{ "id": "l_drone_nest", "series": "iou",
  "requires": { "flags_any": ["collect_done", "neighbor_helped"] },
  "where": { "district": "hive", "block": "hive_atrium" },
  "hint": "收租無人機每天凌晨飛回東側某棟塔的屋頂充電",
  "truth": "half", "source": "board", "expires": 5,
  "on_known": { "set_flags": ["nest_known"] },
  "on_expire": { "set_flags": ["nest_lost"] } }
```

- `issuer` 是新加的欄位：發出這個系列的委託的人（中間人的 NPC id，或流竄 AI 的 id）。系列裡的委託副本的 `client` 照它填。
- `done_when` 原本只有 `flags_any`；這裡多了 `any` 與 `flags_all` 的組合，因為有的系列要兩個旗標同時成立才結束。

### 本批的旗標檢查

| 系列 | 寫了卻沒人讀的旗標 | 讀了卻沒人寫的旗標 |
|---|---|---|
| `iou` | `expose_win`、`expose_lost`（給阿蓮的關係線讀） | 沒有 |
| `chip_locker` | `chip_lost`、`doll_returned`（只用來結束整組） | 沒有 |
| `offstage` | `erase_failed`（不影響後面） | 沒有 |
| `photocopy` | `smear_win`、`smear_lost`（給久我的關係線讀） | 沒有 |
| `filter` | `vivian_watched`、`expose_win`、`expose_lost`（給薇薇安的關係線讀） | 沒有 |
| `empty_truck` | `runaway_back`、`runaway_stayed`、`rescue_failed`（給瑪拉的關係線讀） | 沒有 |
| `orphan_node` | `gave_frost`、`kept_node`（給伊萊莎與霜的線讀） | 沒有 |
| `understudy` | `debut_win`、`debut_lost`、`original_back`、`original_lost`（只用來結束整組） | `rogue:a_ko:met`（[LURE_EVENTS](LURE_EVENTS.md) 的「空白的範本」`wa_ako_firstsight` 立） |

---

## 特殊任務專用的議題、牌與直播目標

手寫的委託副本（[QUESTS](QUESTS.md)）用到的專屬項目。它們的完整內容寫在那一件委託裡，這裡只登記，讓資料檢查找得到。

**議題**：一場輿論戰在吵什麼，決定九個格子各值幾分（OPINION 3.2 節）。

| id | 是什麼 | 用在哪條線 |
|---|---|---|
| `tp_graveyard_claim` | 輿論戰的議題（ignite）；九格的分數寫在那件委託的 opinion_setup 裡 | 機師「再開一次」 |
| `tp_penny_pact` | 輿論戰的議題（ignite）；九格的分數寫在那件委託的 opinion_setup 裡 | 潘妮「證據不夠」 |
| `tp_pth_idol_bigstage` | 輿論戰的議題（ignite）；九格的分數寫在那件委託的 opinion_setup 裡 | 偶像「讓歌被聽到」 |
| `tp_pth_streamer_scoop` | 輿論戰的議題（ignite）；九格的分數寫在那件委託的 opinion_setup 裡 | 主播「真的那種」 |
| `tp_viv_journalist` | 輿論戰的議題（ignite）；九格的分數寫在那件委託的 opinion_setup 裡 | 薇薇安·柯爾「回去或毀了它」 |

**牌**：前面的階段拿到的料，進輿論戰的牌庫（OPINION 4.3a 節）。通常比基本牌的數字高，有些對手不能下架。

| id | 是什麼 | 用在哪條線 |
|---|---|---|
| `card_backup_30s` | 「備份的前三十秒」：說法牌，數字 3；沒有查證時，對手可以用「否認」讓它失效一次 | 薇薇安·柯爾「回去或毀了它」 |
| `card_gasoline_cam` | 「後門巷子的監視畫面」：一張高數字的料，只在第 3 階段那一場用得到 | 夢露「第四次」 |
| `card_ledger_page` | 「退伍金只付了一半的那一頁」，一張高數字的料 | 星旗防務：重新徵召 |
| `card_master_30s` | 「母帶的前三十秒」，說法牌，數字 5，對手不能下架 | 薇薇安·柯爾「回去或毀了它」 |
| `card_old_ad` | 「二十年前的那張廣告」，一張高數字的料 | 野良：沒有主人 |
| `card_raid_order` | 「搜查令」：一張高數字的料 | 再守一夜 |
| `card_trace_order` | 「追蹤她的工單」，一張高數字的料 | 潘妮「證據不夠」 |

**直播目標**：開播時定好的目標，達成時加熱度與打賞（DATA 9.2 節）。

| id | 是什麼 | 用在哪條線 |
|---|---|---|
| `goal_face_hidden` | 「整趟沒有拍到他的臉」：熱度 3，每級打賞 160 | 一起掉下去 |
| `goal_first_stand` | 「機甲站起來的那一刻」：機甲醒過來的那一回合沒有隊友倒下，畫面拍到它站起來 | 機師「再開一次」 |
| `goal_last_tile` | 「沒有任何一名鎮溺隊員踏進最後一格」：熱度 3，每級打賞 200，地下頻道 | 再守一夜 |
| `goal_mike_heard` | 「三毛的那一場短輿論戰大勝」：熱度 3，每級打賞 150，新聞頻道 | 野良：沒有主人 |
| `goal_photo_shown` | 「在她倒下之前給她看了照片」：熱度 3，每級打賞 220 | 鉻娘子：更多 |
| `goal_still_smiling` | 「整趟沒有被笑容考核程式提醒過一次」：熱度 3，每級打賞 120，八卦頻道 | 甜心食品：我們很遺憾 |
