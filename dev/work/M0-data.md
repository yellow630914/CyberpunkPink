# M0-data

- 交給：cpp-data
- 目標：把 M0 要用的規則數值（屬性、基本功、出身、特質、建角的數字、錢的上限）從設計書轉成 `engine/data/rules/` 的 JSON，組成一包 `CORE_PACK`，通過核心的格式驗證與引用檢查。
- 規格出處：CORE_RULES 第 1、2 節；DATA 第 1 節；CHARACTER 第 2、4、5.1～5.3、6 節；EVENTS 2.4 節（只看 `cred`、`cash` 那一列）。只讀這幾節。
- 可以改的路徑：`engine/data/`（新增 `engine/data/rules/*.json` 與 `engine/data/index.ts`）、`engine/tests/data/`、`engine/tests/pending/M0-data.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面：
  - 每一種資料的格式（等於 schema）：`engine/src/core/content/kinds.ts`。裡面每個 kind 的 `validate` 就是欄位的規定，型別是 `AttributeEntry`、`SkillEntry`、`PerkEntry`、`OriginEntry`、`CreationRuleEntry`。
  - 驗證的方法：`createKernel().content.loadPack(CORE_PACK)`（格式與重複的 id）加 `content.checkRefs()`（引用）。見 `engine/src/core/content/registry.ts`。
  - 包的型別：`ContentPack`（`{ id, content: { <kind>: Entry[] } }`）。
- 不可以做的事：
  - 不改數值、不補設計書沒寫的東西（下面明說「借用」的除外）。
  - 不改 `engine/src/`。格式不夠用（例如某個特質的效果寫不進 `checks` 或 `stats`）就停下來回報需要的欄位，不要自己加欄位。
  - 不替勢力與 NPC 取英文 id：設計書還沒有那張表，`favor.choose_one` 與 `roster` 照設計書的中文名字寫。
- 驗收測試：`engine/tests/pending/M0-data.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-data`。通過之後 `git mv engine/tests/pending/M0-data.test.ts engine/tests/data/M0-data.test.ts`，再跑 `npm test` 與 `npx tsc --noEmit`，兩個都要過。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題（缺的值、互相矛盾的地方）。

## 要交的檔案

| 檔案 | kind | 內容 | 出處 |
|---|---|---|---|
| `engine/data/rules/attributes.json` | `attribute` | 六筆，順序 `body`、`reflex`、`tech`、`intellect`、`resolve`、`charm` | CORE_RULES 第 1 節的表；id 照 DATA 第 1 節 |
| `engine/data/rules/skills.json` | `skill` | 十八筆，照 CORE_RULES 第 2 節的表由上到下 | CORE_RULES 第 2 節 |
| `engine/data/rules/perks.json` | `perk` | 見下面「特質」 | CHARACTER 第 4、5.2、5.3、6 節 |
| `engine/data/rules/origins.json` | `origin` | 七筆，照 CHARACTER 第 2 節的表由上到下 | CHARACTER 第 2 節 |
| `engine/data/rules/creation.json` | `creation_rule` | 一筆，id 是 `default` | CHARACTER 5.1、5.3、5.4、5.6 節 |
| `engine/data/rules/effect_caps.json` | `effect_cap` | 一筆，id 是 `money`，`by_grade` 是 `{ "1": 120, "2": 360, "3": 1200, "4": 3900, "5": 12000 }` | EVENTS 2.4 節 `cred`、`cash` 那一列 |
| `engine/data/index.ts` | — | 把上面六個檔 import 進來，組成 `CORE_PACK` 與 `SOURCES` | — |

每個 JSON 檔是一個陣列（一筆一個物件）。JSON 不能寫註解，出處寫在 `engine/data/index.ts` 的 `SOURCES`：

```ts
import type { ContentPack } from '../src'
import attributes from './rules/attributes.json'
// ……其餘五個
export const CORE_PACK: ContentPack = { id: 'core', content: { attribute: attributes, skill: skills, perk: perks, origin: origins, creation_rule: creation, effect_cap: effectCaps } }
/** 每一種資料的出處（文件與節） */
export const SOURCES: Record<string, string> = { attribute: 'CORE_RULES 第 1 節；DATA 第 1 節', /* …… */ }
```

`content` 的鍵的順序照上面寫（`perk` 要在 `origin` 前面沒有關係，引用檢查是全部載完才做）。

## 屬性

`{ "id", "name", "desc" }`。`desc` 照 CORE_RULES 第 1 節表格「影響」那一欄原樣抄（拿掉粗體的星號）。

## 基本功

`{ "id", "name", "attr", "desc" }`。`desc` 照 CORE_RULES 第 2 節表格「管什麼」那一欄原樣抄。id 用下表（設計書說 id 表在 CORE_RULES 第 2 節，但那一節只有中文名；這張表是暫定的，見「已知的規格問題」第 1 點）：

| 屬性 | 基本功 → id |
|---|---|
| body 體格 | 格鬥 `brawl`、運動 `athletics`、重裝 `heavy` |
| reflex 反應 | 槍械 `firearms`、操縱 `piloting`、隱匿 `stealth` |
| tech 技術 | 機械 `mechanics`、義體學 `cyberware`、醫療 `medicine` |
| intellect 智識 | 介面 `interface`、調查 `investigate`、街頭直覺 `streetwise` |
| resolve 意志 | 威嚇 `intimidate`、定力 `composure`、同步 `sync` |
| charm 魅力 | 交涉 `negotiate`、誘惑 `seduce`、表演 `perform` |

## 出身

格式照 `OriginEntry`：`{ "id", "name", "line", "skill_bonus", "status", "home", "favor", "perk", "roster" }`。

- `id`：蜂巢 `hive`、企業 `corp`、車族 `nomad`、歡場 `pleasure`、舊港 `oldport`、櫻町 `sakura`、地下層 `under`。
- `line`：表格「一句話」那一欄。`home`：「起始住處」那一欄。
- `skill_bonus`：「基本功 +1」那一欄，寫成 `{ "<基本功 id>": 1 }`。
- `status`：市民（含「市民（曾是社員）」）寫 `citizen`，無籍寫 `unregistered`。
- `favor`：`{ "choose_one": [...], "value": 25 }`。「選一」的把每一個都列出來；企業出身列十二家企業（CHARACTER 沒有列名字的話，照 FACTIONS 找十二家企業的名字，只為了這一欄去查那一張表，`ui/src/data/creation.ts` 的 `CORPS` 有一份可以對照；兩邊對不上或找不到十二家就回報，不要湊）。只有一個的也寫成一個元素的陣列。
- `roster`：「開場就在名冊上」那一欄，兩個名字。
- `perk`：`origin_<id>`（例：`origin_hive`）。
- 歡場與櫻町的「固定的傾向與豔名」、`lifepath_extra`：這一批不轉（傾向、豔名、生命軌跡的系統還沒搬進來）。回報裡提一句就好。

## 特質

格式照 `PerkEntry`：`{ "id", "name", "category", "cost", "flaw", "desc" }`，加上 `checks`（一類檢定的加值）或 `stats`（衍生數值的加減）其中適用的，以及 `adult`、`provisional`。

- `category` 只能是：`street` 街頭、`social` 社交、`body` 身體、`bridge` 橋與神經、`craft` 技藝、`net` 網路、`media` 媒體、`desire` 慾望、`origin` 出身。缺陷的 `category` 照它的內容歸到上面其中一類，再標 `"flaw": true`。
- `cost`：特質的價錢或缺陷退的點數，1～3（CHARACTER 5.3 節：5.2 節的一格是 2 點）。
- `checks`：`{ "skills": ["<基本功 id>"], "bonus": 2 }`；只在某個情境才有的加上 `"tags": [...]`（標籤照下表）。缺陷的 `bonus` 是負的。
- `stats`：`{ "<數值 id>": <數字> }`。數值 id：生命值上限 `max_hp`（一格 ±5）、感載上限 `load_cap`（±4）、RAM 上限 `ram_max`（±1）、先攻 `initiative`（±3）、現實的命中 `hit`（±1）、迴避 `evade`（±1）。
- 效果寫不進 `checks` 或 `stats` 的（收入 +15%、成癮檢定、睡眠、開場欠人情……）：只寫 `desc`，不寫效果欄位。這些等對應的系統搬進來才會生效。
- `desc` 是完整的句子，把效果說清楚。

情境的標籤（只用這幾個）：`place:<出身的 id>`（在那一區，例 `place:hive`）、`vs:corp`（對企業的人）、`vs:police`（對市警）。

**設計書裡有的只有一筆**：CHARACTER 第 6 節的樣本「能言善道」→ `{ "id": "smooth_talker", "name": "能言善道", "category": "social", "cost": 2, "flaw": false, "desc": "…", "checks": { "skills": ["negotiate"], "bonus": 2 } }`（樣本裡的 `train` 不轉，受訓的系統還沒搬）。這一筆不標 `provisional`。

**其餘的清單設計書還沒有生成**（CHARACTER 開頭寫明特質的實際清單是內容層的事）。為了讓 M0 能建角，先借用介面的示意資料 `ui/src/data/creation.ts`：`TRAITS` 裡除了「能言善道」以外的 15 個特質與 6 個缺陷，加上 `ORIGINS[].trait` 的 7 個出身特質，共 28 筆，**每一筆都標 `"provisional": true`**。名字、價錢（`cost`）與效果照那個檔原樣；`adult: true` 的照標。id 用下表：

| 名字 | id | 效果怎麼寫 |
|---|---|---|
| 人面廣 | `well_connected` | `checks` 街頭直覺 +2 |
| 嗅得到麻煩 | `smells_trouble` | `stats` `initiative` 3 |
| 黑市熟客 | `black_market_regular` | 只寫 `desc` |
| 看起來可靠 | `looks_reliable` | 只寫 `desc`（對兩類對象的所有社交檢定，現在的格式寫不進去） |
| 撒謊不眨眼 | `straight_faced_liar` | `checks` 表演 +2 |
| 耐打 | `tough` | `stats` `max_hp` 5 |
| 手穩 | `steady_hands` | `stats` `hit` 1 |
| 酒量好 | `holds_liquor` | 只寫 `desc` |
| 天生耐受高 | `high_tolerance` | `stats` `load_cap` 4 |
| 同步體質 | `sync_native` | `checks` 同步 +2 |
| 巧手 | `deft_hands` | `checks` 機械 +2 |
| 舊網的孩子 | `old_net_kid` | `checks` 介面 +2 |
| 上鏡 | `photogenic` | 只寫 `desc` |
| 聲音好聽 | `good_voice` | 只寫 `desc`（唱歌與直播才有，現在沒有這個標籤） |
| 敏感體質 | `sensitive_body` | 只寫 `desc`；`adult: true` |
| 怕痛（缺陷） | `afraid_of_pain` | 只寫 `desc` |
| 口無遮攔（缺陷） | `loose_lips` | `checks` 交涉 −2 |
| 舊傷（缺陷） | `old_wound` | `stats` `max_hp` −5 |
| 認床（缺陷） | `picky_sleeper` | 只寫 `desc` |
| 對粉蕾絲沒抵抗力（缺陷） | `weak_to_pink_lace` | 只寫 `desc`；`adult: true` |
| 欠著人情（缺陷） | `owes_a_favor` | 只寫 `desc` |
| 巷子裡的眼睛（蜂巢） | `origin_hive` | `checks` 街頭直覺 +2，`tags: ["place:hive"]` |
| 看得懂合約（企業） | `origin_corp` | 只寫 `desc`（對企業的人的所有社交檢定） |
| 方向盤長在手上（車族） | `origin_nomad` | `checks` 操縱 +2 |
| 看人臉色（歡場） | `origin_pleasure` | 只寫 `desc` |
| 黑市熟客（舊港） | `origin_oldport` | 只寫 `desc` |
| 後台的人（櫻町） | `origin_sakura` | `checks` 表演 +2，`tags: ["place:sakura"]` |
| 沒有登記的臉（地下層） | `origin_under` | 只寫 `desc` |

出身特質的 `category` 是 `origin`，`cost` 寫 2。缺陷的分類：怕痛、舊傷、認床是 `body`；口無遮攔、欠著人情是 `social`；對粉蕾絲沒抵抗力是 `desire`。

## 建角的數字

`creation.json` 一筆（CHARACTER 5.1、5.3、5.4、5.6 節）：

```json
[{ "id": "default", "attr_array": [15, 14, 13, 12, 10, 8], "attr_free": 2, "attr_max": 18, "attr_min": 4,
   "skill_points": 10, "skill_max": 3, "perk_points": 4, "perk_max": 8, "flaw_max": 2, "min_age": 18, "start_money": 1500 }]
```

寫之前照那幾節對一次，數字不一樣以設計書為準並回報。義體點數、裝備點數、起始歷練點這一批不轉（那幾個系統還沒搬）。

## 已知的規格問題（照下面的假設做，不用停下來）

1. DATA 第 1 節說基本功的 id 表在 CORE_RULES 第 2 節，但那一節只有中文名。設計書別處出現過的 id：`streetwise`、`negotiate`（CHARACTER 第 6 節）、`composure`（DATA 第 5 節的樣本）。上面的表照介面的圖標名補齊，定力用 `composure`（不用 `resolve`，那是意志的 id）。使用者確認前是暫定的。
2. 勢力與 NPC 沒有英文 id 的表。`favor.choose_one` 與 `roster` 先寫中文名。
3. 出身特質的內容設計書沒有寫，先借介面的示意資料並標 `provisional`。
4. 出身對起始的錢的加減（「企業出身多、街頭出身少」）設計書沒有數字，這一批不轉。
