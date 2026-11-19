# 資料的格式

> 上層：[DESIGN_ORDER](../plan/DESIGN_ORDER.md)（L3 框架的最後一塊）。依賴：所有的框架文件。被依賴：L4 的每一份內容。
> 這份文件回答一個問題：**一筆資料長什麼樣子**。規則寫在各自的文件裡，這裡只定欄位，每一種內容給一筆完整的樣本。生成 L4 的內容時照這裡的格式寫；各文件最後「資料的樣子」那一節和這份不一致的時候，以這份為準。
> 樣本裡的數字只是示意，等平衡時再定。

## 1. 共通的約定

| 約定 | 內容 |
|---|---|
| `id` | 小寫英文加底線，前面帶種類的縮寫（`sk_` 技能、`nt_` 夜課、`pos_` 體位、`ev_` 事件、`df_` 戰敗事件、`en_` 敵人、`pr_` 輿論對手、`bp_` 設計圖、`pt_` 零件、`cm_` 委託副本） |
| `grade` | 等級 I～V，寫成 1～5。敵人、裝備、委託、要地都用它 |
| `tier` | 只用在技能：樹的第幾階，1～5 |
| `rank` | 只用在敵人：`minion`、`elite`、`boss` |
| `cells` | 這筆內容的份量是幾格（[CORE_RULES](CORE_RULES.md) 7.4 節）。資料檢查用它對強度預算 |
| `tags` | 內容篩選的標籤：流竄 AI 的題材、`pc_unwilling`（主角非自願）、`target_unwilling`（對象非自願）、`contract_dom`（契約支配）、`ntr`、`puppet_amnesia`（人偶晶片的失憶工作）、`blacktape`，以及對象的性別 `male_partner`、`female_partner`、`femboy_partner`（男娘與偽娘）、`trans_partner`、`futa_partner`（已確認，全書統一用這組名字）。玩家關掉的標籤，帶著它的內容不出現 |
| `adult` | 布林值。只給三個地方用：交給 AI 寫正文、產圖的預處理、產圖。規則不因為它而不同 |
| 文字欄位 | `name`、`desc`、`text` 是給玩家與 AI 看的中文，都要寫成完整的句子 |
| 基本功與屬性 | 用英文 id。屬性：`body` 體格、`reflex` 反應、`tech` 技術、`intellect` 智識、`resolve` 意志、`charm` 魅力。基本功的 id 表在 [CORE_RULES](CORE_RULES.md) 第 2 節 |
| 身體的部位 | `mouth` 口、`hand_l` 左手、`hand_r` 右手、`chest` 胸、`front` 前、`back` 後、`legs` 腿足；義體與化身多出來的部位自己取 id（`tail`、`tentacle_1`） |
| 體型 | `masc` 陽剛、`fem` 陰柔、`andro` 中性 |
| 性別 | `female`、`male`、`femboy` 男娘、`trans_f` 與 `trans_m`（TS）、`futa` 扶他 |

## 2. 技能（八棵樹）

和舊樣本比，多了這些：分層、六種種類、份量、輿論的效果改成新棋盤的寫法、預備與日常的效果另有欄位、共鳴寫在樹上。

| 欄位 | 內容 |
|---|---|
| `path`、`tier`、`layer` | 哪一棵樹、第幾階、前層 `front` 或後層 `back` |
| `after` | 前置的技能。前層的接上一階的任何一個；後層的接同階前層的某一個 |
| `kind` | `active` 主動、`passive` 被動、`reaction` 反應、`stance` 姿態、`prep` 預備、`daily` 日常 |
| `cap`、`xp`、`cells` | 佔的容量、學習的歷練點（階 × 20）、份量 |
| `use` | 消耗：`ap` 行動點、`ram`、`ep` 編輯點、`per_fight` 每場幾次、`time` 花的時段（預備與日常） |
| `meat`、`net`、`opinion` | 三個戰場各自的效果；`null` 是不生效 |
| `prep`、`daily` | 預備與日常的效果，各寫一個物件 |

效果只能用這些鍵（對應 [SKILLS](SKILLS.md) 1.8 節的清單）：

| 戰場 | 可以用的鍵 |
|---|---|
| 現實、內海共用 | `hit`、`evade`、`dice`、`pierce`、`extra_attack`、`free_move`、`ap_refund`、`apply`（狀態）、`cleanse`、`cover`（補、拆、倍率）、`load`、`afterglow`、`initiative`、`counter` |
| 只在現實 | `mag`、`heal`、`wound`、`subdue`、`drone`、`mech`、`give_ap`（掮客讓出行動點）、`call`（叫人） |
| 只在內海 | `ram`、`sync_cap`、`flash`（閃斷）、`admin`、`pin`、`trace`、`program` |
| 輿論 | `voice` 聲量、`wind` 風向、`extra_capture` 多佔一格、`capture_any` 無視相鄰、`shield` 設防、`drain_pr` 扣公關點、`draw` 抽牌、`hand` 開場手牌、`ep` |
| 預備 | `carry`：帶進下一場的效果，寫法和上面相同，另加 `lasts`（幾回合，或整場） |
| 日常 | `income`、`footage_quality`、`roster`、`favor_owed`、`craft`、`surgery`、`time_cut` |

```json
{
  "paths": [
    { "id": "fixer", "name": "掮客", "tree": "人面", "category": "social",
      "signature": "sk_fixer_face",
      "domains": { "meat": "strong_support", "net": "mid", "opinion": "mid" },
      "resonance": [
        { "tier": 1, "cells": 1, "text": "名冊的容量多 1 個人。", "effect": { "roster": 1 } },
        { "tier": 2, "cells": 1, "text": "每場戰鬥第一次讓出行動點不花行動點。", "effect": { "give_ap_free": 1 } }
      ] }
  ],
  "skills": [
    {
      "id": "sk_fixer_focus_fire", "name": "集火", "path": "fixer", "category": "social",
      "tier": 2, "layer": "front", "after": "sk_fixer_face",
      "kind": "active", "cap": 1, "xp": 40, "cells": 2,
      "use": { "ap": 1 },
      "text": "指定一個敵人。到你的下一個回合為止，全隊打他的命中 +2。",
      "meat":    { "target": "enemy", "apply": [{ "status": "marked", "hit": 2, "until": "my_next_turn" }] },
      "net":     { "target": "enemy", "apply": [{ "status": "marked", "hit": 1, "until": "my_next_turn" }] },
      "opinion": null
    },
    {
      "id": "sk_fixer_buy_slot", "name": "買版面", "path": "fixer", "category": "social",
      "tier": 3, "layer": "back", "after": "sk_fixer_buy_voice",
      "kind": "active", "cap": 2, "xp": 60, "cells": 3,
      "use": { "ep": 2, "cash_per_grade": 400, "per_fight": 1 },
      "text": "花錢買下一個格子。這一次佔領不必和自己的格子相鄰。",
      "meat": null, "net": null,
      "opinion": { "capture_any": 1 }
    },
    {
      "id": "sk_fixer_stash", "name": "事先藏好", "path": "fixer", "category": "social",
      "tier": 1, "layer": "back", "after": "sk_fixer_face",
      "kind": "prep", "cap": 1, "xp": 20, "cells": 1,
      "use": { "time": 1, "per_fight": 1 },
      "text": "進副本之前安排好一樣東西。下一場現實戰鬥開始時，我方的一格多一級遮蔽。",
      "meat": null, "net": null, "opinion": null,
      "prep": { "carry": { "cover": { "side": "ally", "raise": 1 } }, "lasts": "fight" }
    }
  ]
}
```

- 載入時檢查：`cells` 要落在那一階、那個種類的預算裡；`domains` 是 `none` 的戰場，效果一定是 `null`；每個技能至少有一個效果不是 `null`。
- 掮客在現實是「強的輔助」，寫成 `strong_support`：效果的對象只能是隊友或敵人身上的狀態，不能是他自己的傷害。

## 3. 夜課、體位與成人道具

### 3.1 夜課的技能

| 欄位 | 內容 |
|---|---|
| `branch` | `common` 共通、`relation` 關係、`sense` 感官、`body` 身體、`costume` 扮相 |
| `tier` | 1～5。開階的條件看分支：共通看性經歷，其餘看那一軸的等級 |
| `tag` | 掛在哪個標籤或風格上。標籤被關掉就不出現；標籤是「深」的時候效果多一格 |
| `requires` | 其他的學習條件：橋參數、性經歷 |
| `insight` | 學習要花的體悟（階 × 10） |
| `scene` | 在成人場景裡的效果（見下） |
| `outside` | 只有少數技能有：延伸到別處的效果，寫法和第 2 節相同，另寫 `cap`（裝進橋要佔的社交容量） |

`scene` 的內容：

| 鍵 | 內容 |
|---|---|
| `ap` | 花的行動點 |
| `my_part`、`their_part` | 用自己的哪些部位（可以列好幾個讓玩家選）、接對方的哪些部位 |
| `on_use` | 用出去的那一下：`my_load`、`their_load`（骰數）、`fit`（契合）、`initiative`（主動權） |
| `link` | 連接持續的時候，每回合自動生效的數值：`my_load`、`their_load`、`fit` |
| `positions` | 只能在哪些體位用；不寫就是都可以 |
| `needs` | 要有的道具、服裝的風格、調校 |
| `match_bonus` | 對方也有這個標籤時多給的契合 |

```json
{
  "id": "nt_rel_leash_3", "name": "牽著走", "branch": "relation", "tier": 3,
  "tag": "支配", "tags": ["支配"], "adult": true,
  "requires": { "bridge": { "docility_max": 60 }, "experience": { "partners": 3 } },
  "insight": 30, "cells": 3,
  "text": "你用一隻手扣住對方的後頸，帶著對方照你的節奏走。",
  "scene": {
    "ap": 2,
    "my_part": ["hand_l", "hand_r"], "their_part": ["back"],
    "on_use": { "their_load": "2d6", "my_load": "1d6", "fit": 4, "initiative": 15 },
    "link":   { "their_load": "1d6", "my_load": 0, "fit": 1 },
    "positions": ["pos_from_behind", "pos_standing"],
    "match_bonus": 12
  },
  "outside": {
    "cap": 2, "kind": "active", "use": { "ap": 2, "per_fight": 1 },
    "meat": { "target": "enemy", "requires_status": "overloaded", "subdue": { "bonus": 4 } },
    "domain_scale": "weak"
  }
}
```

### 3.2 體位

| 欄位 | 內容 |
|---|---|
| `people` | 參與的人數，二到四 |
| `roles` | 這個體位裡的位置，每個位置寫是不是上位 |
| `links` | 哪個位置的哪個部位碰得到哪個位置的哪個部位。不在這張表裡的組合，這個體位建立不了連接 |
| `mult` | 每個位置受到的感載倍率 |
| `initiative_drift` | 上位的人每回合主動權的變化 |
| `tag` | 有這個標籤的人在這個體位契合加得快 |
| `unlocked_by` | 哪個夜課技能開放它；`null` 是每個人都會的基本體位 |

```json
{
  "id": "pos_from_behind", "name": "從後面", "people": 2,
  "roles": [ { "id": "a", "upper": true }, { "id": "b", "upper": false } ],
  "links": [
    { "from": ["a", "front"],  "to": ["b", "front"] },
    { "from": ["a", "front"],  "to": ["b", "back"] },
    { "from": ["a", "hand_l"], "to": ["b", "chest"] },
    { "from": ["a", "hand_r"], "to": ["b", "chest"] },
    { "from": ["a", "hand_l"], "to": ["b", "back"] },
    { "from": ["a", "hand_r"], "to": ["b", "back"] },
    { "from": ["a", "mouth"],  "to": ["b", "back"] }
  ],
  "mult": { "a": 1.0, "b": 1.25 },
  "initiative_drift": 3,
  "tag": "支配", "tags": [], "adult": true,
  "unlocked_by": null,
  "text": "一個人在後面，另一個人背對著他。"
}
```

### 3.3 成人道具

道具是物品（第 7 節），多一個 `scene` 欄位，寫法和夜課技能的 `scene` 相同。會建立連接的道具，它自己算一個部位。

```json
{
  "id": "it_toy_pulse_2", "name": "脈衝環", "kind": "item", "grade": 2, "price": 600,
  "tags": [], "adult": true,
  "scene": {
    "ap": 1, "as_part": "toy", "their_part": ["front", "chest"],
    "on_use": { "their_load": "1d6", "fit": 2 },
    "link":   { "their_load": "1d6", "fit": 0 }
  }
}
```

### 3.4 義體的部位和場景的部位

義體裝在九個部位上（[CYBERWARE](../gear/CYBERWARE.md) 第 1 節）。它們在成人場景裡對應到這些部位：

| 義體的部位 | 場景的部位 | 說明 |
|---|---|---|
| 腦、橋 | — | 不是能接觸的部位。它們改的是橋參數 |
| 眼 | — | 同上；錄影義體在這裡 |
| 耳與喉 | 口 | 聲帶與舌的改造算在口 |
| 手臂 | 左手、右手 | 兩隻分開算 |
| 軀幹 | 胸、後 | |
| 皮膚 | 全部 | 皮膚類的零件替每個部位加同一個修正 |
| 性器 | 前、後 | 加裝的器官另外多一個部位 |
| 腿 | 腿足 | |
| 尾與獸化的附加物 | 自己的 id | 多出一個部位 |
| 觸手的改造 | 觸手 | 多出一個部位；夜課的觸手技能讓它同時接兩條連接 |

場景的部位一共是：口、左手、右手、胸、前、後、腿足，加上改造多出來的加裝、尾、觸手。「前」不分哪一種身體。

設計圖多兩個欄位來寫這件事：

```json
"scene_parts": { "adds": ["tail"], "sensitivity": { "tail": 15, "back": 5 } }
```

`adds` 是多出來的部位，`sensitivity` 是對各部位敏感度的修正。

## 4. 事件

和舊樣本比，多了：成人場景的設定、體型的條件、新加的效果。

`adult_soft`（布林）：軟色情的事件。不進成人場景，正文由 AI 寫成曖昧的內容（碰觸、擁抱、耳語），不寫性行為；產圖也照非成人處理。

`adult_scene` 從一個字串改成一個物件：

| 鍵 | 內容 |
|---|---|
| `when` | `always`、`success`、`fail`：哪一種結果會走向成人場景 |
| `gate` | `ai` 是交給 AI 判定要不要進；`fixed` 是一定進（AI 關閉時所有事件都當成 `fixed`） |
| `nature` | 這一場的性質：`mutual` 兩情相悅、`trade` 交易、`work` 工作、`contract` 契約、`forced` 被迫。它決定開場的主動權與篩選 |
| `role` | 主角在這一場的身分：`guest` 客人、`worker` 工作的人、`holder` 持約人、`bound` 契約人、`none` |
| `goal` | 另外的目的：`none`、`info` 套話、`please` 取悅、`obey` 讓對方聽話、`stall` 拖住、`footage` 拿素材 |
| `circles` | 分圈：每一圈列出參與的人（`$pc` 是主角，`$a`、`$b` 是事件的登場角色） |
| `start_position` | 起始的體位；不寫就由程式照人數與性質挑一個基本的 |

```json
{
  "id": "ev_work_overload_stage2_vip", "scope": "work",
  "triggers": ["work"],
  "where": { "facility": "club_overload" },
  "when": { "time": ["evening", "late"] },
  "requires": { "job_stage": ["club_overload", 2], "fame_district_min": 20 },
  "category": "desire", "weight": 3, "repeat_days": 5,
  "tags": [], "adult": true,
  "cast": [{ "role": "a", "gen": { "kind": "citizen", "occupation": "熟客", "wealth_min": 3 } }],
  "text": "收班之前，領班把你叫到包廂的門口，說裡面有一位客人指名要你再陪一輪。",
  "options": [
    { "text": "進去陪他。",
      "check": ["seduction", "charm", "normal"],
      "outcomes": {
        "success": [["cash", 400], ["fame", "42nd", 3], ["affinity", "$a", 3]],
        "fail":    [["cash", 100], ["affinity", "$a", -1]]
      },
      "adult_scene": { "when": "success", "gate": "ai", "nature": "work", "role": "worker",
                       "goal": "please", "circles": [["$pc", "$a"]] } },
    { "text": "只陪他喝酒。",
      "check": ["negotiation", "charm", "easy"],
      "outcomes": { "success": [["cash", 150]], "fail": [["satisfaction", "employer", -2]] } },
    { "text": "跟領班說你要下班了。",
      "outcomes": { "any": [["affinity", "employer", -2]] } }
  ]
}
```

- 檢定寫成三個值：基本功、屬性、難度。
- 新加的效果：`neighborhood` 鄰里、`satisfaction` 滿意、`bill` 帳單、`grace` 寬限、`insight` 體悟、`link` 連動、`city_event` 城市的大事。
- `requires` 可以看主角的體型：`"body": ["masc"]`。

## 5. 戰敗事件

戰敗事件是事件的一種，前綴 `df_`。它多了這幾樣：

| 欄位 | 內容 |
|---|---|
| `kind` | 二十九種預設裡的哪一種（[ENEMIES](ENEMIES.md) 第 6 節） |
| `factions` | 哪些勢力用它 |
| `fails_commission` | 預設值：戰敗算不算委託失敗。委託副本可以蓋掉它 |
| `versions` | 三個版本：`default` 給陰柔與中性的體型；`masc` 給陽剛的體型（男性處於被動）；`yuri` 給陰柔與中性的體型，主角被動、由女性主導，抽中的機率預設 30%（[ENEMIES](ENEMIES.md) 第 6 節）。每個版本各有自己的 `text` 與 `stages`。設定裡手動指定版本時，照設定 |
| `stages` | 戰敗事件可以有幾段，每一段的寫法和事件的選項相同 |
| `fallback` | 這個版本用到的標籤被關掉時，改走哪一個不含它的版本 |

```json
{
  "id": "df_contract_eden", "scope": "defeat", "kind": "contract",
  "factions": ["eden"], "fails_commission": true,
  "tags": ["contract_dom", "pc_unwilling"], "adult": true,
  "fallback": "df_contract_eden_plain",
  "versions": {
    "default": {
      "text": "你在一間白色的房間裡醒來，手腕上多了一圈伊甸園的識別環，桌上放著一份已經填好你名字的契約。",
      "stages": [
        { "text": "回收員把筆推到你面前，說簽了字今晚就能走。",
          "options": [
            { "text": "簽字。", "outcomes": { "any": [["order", "contract_signed_eden"], ["flag", "bound_eden"]] } },
            { "text": "拖延時間，等隊友來。", "check": ["composure", "resolve", "hard"],
              "outcomes": { "success": [["flag", "rescue_window"]], "fail": [["sink", 2]] },
              "adult_scene": { "when": "fail", "gate": "ai", "nature": "forced", "role": "bound",
                               "goal": "obey", "circles": [["$pc", "$a"]] } },
            { "text": "打電話叫人來贖。", "need": { "roster_or_favor": true },
              "outcomes": { "any": [["cash", -3000], ["owed", "$caller", "medium"]] } }
          ] }
      ]
    },
    "masc": {
      "text": "你在一間白色的房間裡醒來，手腕上多了一圈伊甸園的識別環，兩位女性回收員站在床邊低頭看著你。",
      "stages": [ { "inherit": "default.stages.0",
                    "adult_scene": { "nature": "forced", "role": "bound", "goal": "obey",
                                     "circles": [["$pc", "$a", "$b"]], "start_position": "pos_pinned_under" } } ]
    }
  }
}
```

- `inherit` 表示這一段的選項和另一個版本相同，只換掉寫出來的欄位。
- 資料檢查：每一種 `kind` 至少要有一筆兩個版本都齊全的戰敗事件；成人向的要佔多數。

## 6. 敵人

### 6.1 現實的敵人

照 [ENEMIES](ENEMIES.md) 第 15 節的樣本，補上這些欄位：

| 欄位 | 內容 |
|---|---|
| `weapons[].mag` | 彈匣，單位是格（1～4）；近戰不寫 |
| `weapons[].cover_mult` | 遮蔽倍率 |
| `tendencies`、`night_skills` | 會進成人場景的敵人才寫：傾向與標籤、會的夜課技能。不寫的由程式照他的勢力生成 |
| `gender`、`body` | 性別與體型 |
| `named`、`base` | 具名敵人（[ENEMIES](ENEMIES.md) 2.1 節）：`named: true`，`base` 指一個制式兵種，只寫不同的欄位 |
| `adult` | 這個兵種的成人場景標籤；非人形的機器與吉祥物寫 `null`（不進成人場景，也不能俘虜） |
| `humanoid` | 機器才寫：`true` 是機娘、人偶這類人形的機器，有成人場景、可以俘虜 |

### 6.2 內海的敵人

| 欄位 | 內容 |
|---|---|
| `ram`、`ram_regen` | RAM 的上限與每回合的回復 |
| `guard` | 防護：直接減掉受到的感載 |
| `sync` | 固定的同步檔位：`shallow`、`standard`、`deep`、`full`；`shift` 表示它會換檔 |
| `constructs[]` | 武器構裝：傷害骰、適用距離、花的 RAM、遮蔽倍率 |
| `color` | 只有蕾絲：`white`、`pink`、`black`。它只決定行為，不決定數值 |
| `admin` | 對方的潛網者才有：每回合幾次管理行動 |

```json
{
  "id": "en_lace_pink_maid_g3", "name": "粉蕾絲（女僕型）",
  "faction": "nightingale", "grade": 3, "rank": "elite", "kind": "lace", "color": "pink",
  "attrs": { "reflex": 14, "intellect": 14, "resolve": 14, "charm": 16 },
  "basics": { "firearms": 3, "interface": 3, "melee": 2 },
  "load_max": 30, "layers": 2, "ap": 5, "ram": 6, "ram_regen": 3, "guard": 3, "sync": "deep",
  "constructs": [ { "id": "stream", "dice": "4d6", "type": "neural", "range": [2, 5], "ram": 1, "cover_mult": 0.5 } ],
  "position": { "prefer": [2, 3], "cover_use": 0.5 },
  "signature": ["persuade", "pin"],
  "ai": { "focus": 1, "prefer": "afterglow_full", "mode": "capture" },
  "defeat": "pinned",
  "loot": [ { "construct": "random", "grade": 3, "chance": 0.4, "needs": "dissect" } ],
  "desc": "她穿著女僕服，裙襬的邊緣是一圈會動的粉色蕾絲，說話的時候一直微笑。"
}
```

### 6.3 輿論戰的對手

對手是公關，不是單位。一個勢力一筆，強度在每一場指定。

| 欄位 | 內容 |
|---|---|
| `strength` | 1～3，對應雜兵、精英、首領。每回合的公關點是它 × 2。這個值由委託副本或議題指定；沒有指定時照這場的等級：I～II 是 1，III～IV 是 2，V 是 3，八家主要企業再 +1（最多 3） |
| `start` | 開場的位置：`opposite` 是玩家的對面，`center` 只有萬華鏡 |
| `cell_priority` | 它先搶哪些格子：九個格子各一個權重，再乘上這一場的分數 |
| `actions` | 行動的優先順序，每個寫什麼條件下用 |
| `signature` | 這個勢力的招牌招式 |
| `once` | 每場一次的行動：收買、找上門，各寫觸發的條件 |
| `mimic` | 只有「另一個主播」：模擬抽牌，每回合隨機開放幾種行動 |

格子的 id：`doujin` 同人圈、`tape` 帶子街、`fanclub` 應援圈、`sakura` 緋櫻映畫、`kaleido` 萬華鏡、`nightingale` 夜鶯直播、`wall` 牆報、`whisper` 街上的耳語、`relay` 地下轉播站。

```json
{
  "id": "pr_hizakura", "name": "緋櫻的公關室", "faction": "hizakura",
  "strength": 2, "start": "opposite",
  "cell_priority": { "sakura": 3, "kaleido": 2, "nightingale": 1, "tape": 1, "fanclub": 2,
                     "doujin": 1, "wall": 0, "whisper": 0, "relay": 0 },
  "actions": [
    { "do": "release", "when": "round <= 3" },
    { "do": "chase",   "when": "round >= 4 and can_capture >= 2" },
    { "do": "counter", "when": "wind > 0" },
    { "do": "deny",    "when": "wind > -3" },
    { "do": "release", "when": "always" }
  ],
  "signature": { "id": "prepared_counter", "text": "它的反爆料只花 1 點公關點。", "effect": { "cost": { "counter": 1 } } },
  "once": [
    { "do": "bribe",   "when": "score_gap <= -3", "offer_per_grade": 2000 },
    { "do": "visit",   "when": "score_gap <= -4 and round >= 4", "squad": "en_squad_housekeeping" }
  ],
  "desc": "它前幾個時段只發新聞稿，等你把手上的牌打得差不多了才一次出手。"
}
```

## 7. 裝備

### 7.1 設計圖

武器與護甲的設計圖沒有樣本，這裡補上。設計圖寫的是「型」，不隨等級改變的東西都在這裡。

| 種類 | 設計圖上的欄位 |
|---|---|
| 武器 | `dice` 基礎的傷害骰、`range` 適用距離、`mag` 彈匣格數、`cover_mult` 遮蔽倍率、`type` 傷害類型、`pierce` 基礎穿甲、`traits`（無聲、轟退、近身不扣等）、`skill` 用哪一項基本功 |
| 護甲與服裝 | `armor` 基礎護甲值、`covers` 蓋住哪些穿著的欄位、`weight_class` 重量級、`style` 與 `exposure`（由外皮零件決定時寫 `from_skin`） |
| 義體 | `slot` 部位、`invasiveness` 侵入度、`sink_cost` 沉溺成本、`scene_parts`（3.4 節） |
| 三種共通 | `grade`、`brand`、`require` 必要的零件、`optional` 選配、`legal` 合法性、`price`、`size` 大小、`weight` |

```json
{
  "id": "bp_rifle_starbelle_3", "kind": "weapon", "name": "星旗 M3 步槍",
  "brand": "starbelle", "grade": 3, "legal": "permit", "price": 2400, "size": 3, "weight": 4,
  "skill": "firearms", "dice": "4d6", "type": "physical", "range": [3, 7],
  "mag": 3, "cover_mult": 0.5, "pierce": 2, "traits": ["close_penalty_4"],
  "require": [ { "type": "barrel" }, { "type": "action" }, { "type": "plate" } ],
  "optional": [ { "type": "sensor" }, { "type": "actuator" }, { "type": "chip" }, { "type": "software" } ]
}
```

```json
{
  "id": "bp_maid_armored_hizakura_3", "kind": "armor", "name": "緋櫻裝甲女僕服",
  "brand": "hizakura", "grade": 3, "legal": "permit", "price": 3200, "size": 3, "weight": 3,
  "armor": 1, "covers": ["upper", "lower", "outer"], "weight_class": "medium",
  "style": "from_skin", "exposure": "from_skin",
  "require": [ { "type": "fiber", "grade_min": 3 }, { "type": "skin", "grade_min": 3 }, { "type": "plate" } ],
  "optional": [ { "type": "hidden_slot" } ]
}
```

### 7.2 零件

| 欄位 | 內容 |
|---|---|
| `type`、`material` | 十二種零件之一；`mech` 機械或 `bio` 生體 |
| `grade`、`brand`、`price`、`legal` | 等級、牌子、價錢、合法性 |
| `cells` | 份量。要等於 `stats`、`affinity`、`traits` 加起來的格數，減掉代價 |
| `stats` | 數值。只能用這種零件能帶的那幾項（[CRAFTING](../gear/CRAFTING.md) 5.5 節） |
| `affinity` | 四類的親和 |
| `traits`、`drawback` | 特性與代價 |
| `weight`、`size` | 重量與大小 |
| `state` | `new`、`used`、`doujin`、`living` |

```json
{
  "id": "pt_barrel_longtongue_2", "name": "長舌", "type": "barrel", "material": "mech",
  "brand": "starbelle", "grade": 2, "price": 520, "legal": "register",
  "cells": 1,
  "stats": { "range_far": 1, "pierce": 1 },
  "drawback": { "hit": -1 },
  "weight": 1, "size": 1, "state": "new"
}
```

這一筆的算法：射程 +1 是 1 格，穿甲 +1 是 1 格，準度 −1 退 1 格，合計 1 格，符合 II 級的份量。

## 8. NPC

照 [NPC_SYSTEM](NPC_SYSTEM.md) 第 13 節的樣本，改兩處、加四樣：

| 變動 | 內容 |
|---|---|
| `traits` 改名 `persona` | 原本放屬性與性格象限的欄位改叫 `persona`，把 `traits` 這個名字讓給特質 |
| `gender` 的值 | 用第 1 節的六個值 |
| 加 `traits` | 特質與缺陷的 id，照特質點抽 |
| 加 `sex_record` | 性經歷：`partners` 對象的人數、`times` 次數、`first` 第一次（對象與一句話）、`service_times`、`favorite`、`notes` |
| 加 `night_skills` | 會的夜課技能 |
| 加 `positions` | 會的體位（基本的不用寫） |

```json
{
  "id": "gen_42nd_0012", "name": "米拉", "nick": "薄荷", "kind": "runner",
  "age": 24, "gender": "femboy", "body": "fem",
  "persona": { "attrs": ["小惡魔", "嘴甜"], "quadrants": ["愛熱鬧", "見機行事", "護短", "嗜辣"] },
  "traits": ["trait_smooth_talker", "flaw_light_sleeper"],
  "tendencies": { "axes": { "relation": 2, "sense": 1, "body": 1, "costume": 3 },
                  "tags": { "服從": "has", "暴露": "deep", "歡場": "has" } },
  "bridge": { "sensitivity": 55, "tolerance": 30, "craving": 40, "docility": 45 },
  "sink": 28,
  "sex_record": { "partners": 9, "times": 31, "service_times": 12,
                  "first": { "with": "一位已經離開這座城的學長", "note": "那一次他比對方還緊張。" },
                  "favorite": null, "notes": "他習慣讓對方先開口。" },
  "night_skills": ["nt_common_read_1", "nt_costume_tease_2"],
  "positions": ["pos_lap"],
  "paths": [{ "path": "performer", "slot": "main", "tier": 2 }, { "path": "fixer", "slot": "sub", "tier": 1 }]
}
```

樣本只列和舊格式不同的欄位，其餘照 NPC_SYSTEM 第 13 節。

## 9. 委託副本

完整的樣本在 [COMMISSIONS](COMMISSIONS.md) 第 11 節，那一筆已經是階段制的。這裡補兩樣它引用到、但還沒有格式的東西。

### 9.1 輿論戰的開場表

有輿論階段的副本才有。它把前面的結果換成輿論戰的開場：

```json
"opinion_setup": {
  "topic": { "id": "tp_scandal_starbelle", "kind": "smear", "rounds": 6,
             "involves": { "factions": ["starbelle"], "people": ["npc_kate_walker"], "types": ["scandal", "crime"] },
             "scores": { "kaleido": 3, "sakura": 2, "nightingale": 1, "tape": 1, "doujin": 0,
                         "fanclub": 0, "wall": 1, "whisper": 2, "relay": 1 } },
  "opponent": { "id": "pr_starbelle", "strength": 2 },
  "base": { "voice": 2, "wind": 0, "cells": ["whisper"] },
  "from_links": [
    { "link": "inside_mail",   "add_card": "card_inside_scoop" },
    { "link": "live_footage",  "voice": 3 },
    { "link": "bought_slot",   "cells": ["sakura"] },
    { "link": "caught_lying",  "wind": -2 },
    { "link": "leak_delayed",  "opponent_pr_first_round": -2 }
  ]
}
```

- `from_links` 的每一列對應前面的階段或輔助面給出的一個連動。拿到了就套用，沒拿到就沒有。
- 短的輿論戰（非最後階段）把 `rounds` 寫成 4。

### 9.2 直播目標

直播目標是一張清單裡的 id，戰鬥、成人場景與副本共用同一種格式：

```json
{ "id": "goal_no_one_down", "text": "沒有任何一個隊友倒下。", "scope": ["combat", "commission"],
  "check": { "event": "ally_down", "count_max": 0 }, "heat": 3, "tip_per_grade": 150 }
```

| 欄位 | 內容 |
|---|---|
| `scope` | 可以用在哪些直播：`combat`、`adult`、`commission` |
| `check` | 怎麼算達成：看哪一種引擎事件、最少或最多幾次 |
| `heat`、`tip_per_grade` | 達成時加的熱度與打賞（乘上等級） |
| `channel` | 不寫就是都可以；寫了的話只有那種定位的頻道會抽到（`adult`、`news`、`gossip`、`underground`） |

## 10. 素材、片與直播模板

```json
{
  "footage": { "id": "ft_0412", "from_record": "rec_d41_h22_03", "title": "倉庫裡的十分鐘",
               "text": "畫面拍到星旗的回收隊把三個人押上車。",
               "type": "crime", "quality": 3, "authentic": "real", "exclusive": true,
               "involves": { "factions": ["starbelle"], "people": [] }, "age_weeks": 0 },
  "clip": { "id": "cl_0077", "from": ["ft_0412", "ft_0398"], "angle": "expose",
            "draw": 4, "trust": 3, "risk": 6, "card": { "kind": "line", "value": 3 } },
  "stream_template": { "id": "st_combat", "name": "戰鬥直播",
                       "highlights": [ { "event": "crit", "heat": 1 }, { "event": "overload", "heat": 1 },
                                       { "event": "enemy_down", "heat": 1 }, { "event": "ally_near_down", "heat": 1 } ],
                       "goals": { "pick": [1, 3], "from_scope": "combat" },
                       "risk": { "reinforce_faster": true, "hostility_mult": 1.5 },
                       "blocks": ["stealth_branch"] }
}
```

- 片的 `card` 是它進輿論戰牌庫時的樣子：`angle` 是揭弊或英雄時是 `line`（說法），數字用 `trust`；是煽情或抹黑時是 `fuel`（料），數字用 `draw`。和議題無關的片進不了牌庫（[OPINION](OPINION.md) 4.3a 節）。

## 11. 這份文件補上了什麼

| 檢查時列出的缺口 | 補在哪裡 |
|---|---|
| 技能沒有分層、預備與日常、輿論效果、共鳴、份量的欄位 | 第 2 節 |
| 夜課的技能、體位、成人道具沒有資料樣本 | 第 3 節 |
| 義體的部位和成人場景的部位沒有對應表 | 3.4 節 |
| 事件裡的成人場景只有一個欄位；條件沒有體型 | 第 4 節 |
| 戰敗事件沒有格式，分兩版沒有地方標 | 第 5 節 |
| 敵人缺內海的欄位；輿論對手沒有格式 | 第 6 節 |
| 武器與護甲的設計圖沒有樣本；零件沒有份量等欄位 | 第 7 節 |
| NPC 沒有特質、性經歷、夜課技能；性別的值沒列全 | 第 8 節 |
| 委託副本的輿論開場表與直播目標沒有格式 | 第 9 節 |
| 等級的欄位名不統一 | 第 1 節 |
