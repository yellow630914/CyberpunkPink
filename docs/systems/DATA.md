# 資料的格式

> 上層：[README](../README.md)（L3 框架的最後一塊，分層見第 1 節）。依賴：所有的框架文件。被依賴：L4 的每一份內容。
> 這份文件回答一個問題：**一筆資料長什麼樣子**。規則寫在各自的文件裡，這裡只定欄位，每一種內容給一筆完整的樣本。生成 L4 的內容時照這裡的格式寫；各文件最後「資料的樣子」那一節和這份不一致的時候，以這份為準。
> 樣本裡的數字只是示意，等平衡時再定。

## 1. 共通的約定

| 約定 | 內容 |
|---|---|
| `id` | 小寫英文加底線，前面帶種類的縮寫（`sk_` 技能、`nt_` 夜課、`pos_` 體位、`ev_` 事件、`df_` 戰敗事件、`en_` 敵人、`pr_` 輿論對手、`bp_` 設計圖、`pt_` 零件、`cm_` 委託副本、`nm_` 網內的生成地圖、`cs_` 構裝、`skin_` SKIN、`qh_` 快駭程式、`sc_` 腳本、`mf_` 機甲骨架、`mw_` 機甲武器、`vh_` 載具、`fac_` 設施的種類） |
| `grade` | 等級 I～V，寫成 1～5。敵人、裝備、委託、要地都用它 |
| `tier` | 只用在技能：樹的第幾階，1～5 |
| `rank` | 只用在敵人：`minion`、`elite`、`boss` |
| `cells` | 這筆內容的份量是幾格（[CORE_RULES](CORE_RULES.md) 7.4 節）。資料檢查用它對強度預算 |
| `tags` | 內容篩選的標籤：流竄 AI 的題材、`pc_unwilling`（主角非自願）、`target_unwilling`（對象非自願）、`contract_dom`（契約支配）、`ntr`、`puppet_amnesia`（人偶晶片的失憶工作）、`blacktape`、`intimate_body`（身體的私密描寫：私處的外觀，第 8 節的 `look.private`；關掉時不問、不寫），以及對象的性別 `male_partner`、`female_partner`、`femboy_partner`（男娘與偽娘）、`trans_partner`、`futa_partner`（全書統一用這組名字）。玩家關掉的標籤，帶著它的內容不出現 |
| `adult` | 布林值。只給三個地方用：交給 AI 寫正文、產圖的預處理、產圖。規則不因為它而不同 |
| 文字欄位 | `name`、`desc`、`text` 是給玩家與 AI 看的中文，都要寫成完整的句子 |
| 基本功與屬性 | 用英文 id。屬性：`body` 體格、`reflex` 反應、`tech` 技術、`intellect` 智識、`resolve` 意志、`charm` 魅力。屬性、基本功、勢力與具名 NPC 的 id 表在 1.1 節 |
| 身體的部位 | `mouth` 口、`hand_l` 左手、`hand_r` 右手、`chest` 胸、`front` 前、`back` 後、`legs` 腿足；義體與化身多出來的部位自己取 id（`tail`、`tentacle_1`） |
| 體型 | `masc` 陽剛、`fem` 陰柔、`andro` 中性 |
| 性別 | `female`、`male`、`femboy` 偽娘與男娘、`trans_f`（TS，只有男跨女一種）、`futa` 扶他。版本照性別分：`male` 只走 `masc`；`female` 走 `default` 與 `yuri`；其他完全不限 |

### 1.1 id 表

屬性、基本功、勢力、具名 NPC 的英文 id 以這一節為準。已經在設計書或引擎的資料裡出現過的 id 照抄；沒出現過的是這一次補的。

**屬性**（[CORE_RULES](CORE_RULES.md) 第 1 節）

| id | 屬性 |
|---|---|
| `body` | 體格 |
| `reflex` | 反應 |
| `tech` | 技術 |
| `intellect` | 智識 |
| `resolve` | 意志 |
| `charm` | 魅力 |

**基本功**（[CORE_RULES](CORE_RULES.md) 第 2 節）

| id | 基本功 | 屬性 |
|---|---|---|
| `brawl` | 格鬥 | `body` 體格 |
| `athletics` | 運動 | `body` 體格 |
| `heavy` | 重裝 | `body` 體格 |
| `firearms` | 槍械 | `reflex` 反應 |
| `piloting` | 操縱 | `reflex` 反應 |
| `stealth` | 隱匿 | `reflex` 反應 |
| `mechanics` | 機械 | `tech` 技術 |
| `cyberware` | 義體學 | `tech` 技術 |
| `medicine` | 醫療 | `tech` 技術 |
| `interface` | 介面 | `intellect` 智識 |
| `investigate` | 調查 | `intellect` 智識 |
| `streetwise` | 街頭直覺 | `intellect` 智識 |
| `intimidate` | 威嚇 | `resolve` 意志 |
| `composure` | 定力 | `resolve` 意志 |
| `sync` | 同步 | `resolve` 意志 |
| `negotiate` | 交涉 | `charm` 魅力 |
| `seduce` | 誘惑 | `charm` 魅力 |
| `perform` | 表演 | `charm` 魅力 |

**勢力**（[FACTIONS](../world/FACTIONS.md) 第 1 節的 id 照抄）。企業的全名與短名：短名是介面、出身與內文裡平常的叫法。

| id | 全名 | 短名 | 類 |
|---|---|---|---|
| `hizakura` | 緋櫻重工 | 緋櫻 | 企業 |
| `starbelle` | 星旗防務 | 星旗 | 企業 |
| `kunlun` | 崑崙智造 | 崑崙 | 企業 |
| `nectar` | 蜜腺生技 | 蜜腺 | 企業 |
| `nightingale` | 夜鶯系統 | 夜鶯 | 企業 |
| `kaleido` | 萬華鏡 | 萬華鏡 | 企業 |
| `eden` | 伊甸園 | 伊甸園 | 企業 |
| `blackspring` | 黑泉能源 | 黑泉 | 企業 |
| `angel` | 天使急救 | 天使急救 | 企業 |
| `orihime` | 織女電子 | 織女 | 企業 |
| `netvigil` | 貞網局 | 貞網局 | 企業 |
| `sweetheart` | 甜心食品 | 甜心食品 | 企業 |
| `honey` | 蜜糖會 | 蜜糖會 | 街頭 |
| `rouge` | 胭脂堂 | 胭脂堂 | 街頭 |
| `chrome` | 鉻娘子 | 鉻娘子 | 街頭 |
| `tokko` | 特攻姬 | 特攻姬 | 街頭 |
| `nora` | 野良 | 野良 | 街頭 |
| `whisper` | 牆語者 | 牆語者 | 街頭 |
| `rose` | 野薔薇 | 野薔薇 | 街頭 |
| `festival` | 祭典組 | 祭典組 | 街頭 |
| `maids` | 女僕公會 | 女僕公會 | 街頭 |
| `strippers` | 拆體客 | 拆體客 | 街頭 |
| `doujin` | 同人眾 | 同人眾 | 街頭 |
| `guard` | 親衛隊 | 親衛隊 | 街頭 |
| `lonestar` | 孤星連 | 孤星連 | 街頭 |
| `bare` | 素體教 | 素體教 | 街頭 |
| `banquet` | 夜宴社 | 夜宴社 | 街頭 |
| `police` | 市警 | 市警 | 公家 |
| `suppress` | 鎮溺隊 | 鎮溺隊 | 公家 |

- 企業的部門（緋櫻銀行、家政課、緋櫻映畫……）不是勢力（[FACTIONS](../world/FACTIONS.md) 第 8 節）。資料裡要指名部門時用 `<母企業>_<部門>`，例如 [SITES](../world/SITES.md) 第 15 節的 `hizakura_bank`；好感與敵對值記在母企業上。

**具名 NPC**（[NPCS](../world/NPCS.md)）。前綴 `npc_`；生成的 NPC 用 `gen_<區>_<流水號>`（第 8 節）。「已出現」標 ✓ 的是設計書的樣本裡已經用過的。

| id | 名字 | NPCS 的哪一節 | 已出現 |
|---|---|---|---|
| `npc_lian` | 阿蓮（林秋蓮） | 第 2 節 | ✓ |
| `npc_monroe` | 夢露 | 第 2 節 | ✓ |
| `npc_chihaya` | 白鷺千早 | 第 2 節 |  |
| `npc_kuga` | 久我課長 | 第 2 節 |  |
| `npc_lubo` | 陸伯（陸守仁） | 第 2 節 |  |
| `npc_vivian_cole` | 薇薇安·柯爾 | 第 2 節 | ✓ |
| `npc_mara` | 瑪拉 | 第 2 節 |  |
| `npc_eliza_varga` | 伊萊莎·瓦爾加 | 第 2 節 |  |
| `npc_hebo` | 何伯 | 第 3 節 |  |
| `npc_fengfeng` | 縫縫 | 第 3 節 |  |
| `npc_haruka` | 佐伯遙 | 第 3 節 |  |
| `npc_peachy_7` | 桃桃七號 | 第 3 節 |  |
| `npc_debbie_reed` | 黛比·瑞德 | 第 3 節 |  |
| `npc_lulu` | 露露 | 第 3 節 | ✓ |
| `npc_maggie` | 瑪姬 | 第 3 節 | ✓ |
| `npc_sanmao` | 三毛 | 第 3 節 | ✓ |
| `npc_min` | Min | 第 3 節 |  |
| `npc_dandelion` | 蒲公英 | 第 3 節 |  |
| `npc_k` | K | 第 3 節 |  |
| `npc_kuga_rei` | 久我玲 | 第 3 節 |  |
| `npc_xiaomai` | 小麥 | 第 4 節 |  |
| `npc_jo` | 喬（Jo） | 第 4 節 |  |
| `npc_zero` | 零（Zero） | 第 4 節 |  |
| `npc_cheng` | 澄 | 第 4 節 |  |
| `npc_penny` | 潘妮 | 第 4 節 | ✓ |
| `npc_nana` | 奈奈（代號「九」） | 第 4 節 |  |
| `npc_amber` | 琥珀 | 第 4 節 | ✓ |
| `npc_akari` | 燈 | 第 4 節 | ✓ |
| `npc_mashiro` | 真白 | 第 4 節 | ✓ |
| `npc_ray` | 雷（Ray） | 第 4 節 |  |
| `npc_yuzu` | 柚（Yuzu） | 第 4 節 |  |
| `npc_shiori` | 詩織（Shiori） | 第 4 節 |  |
| `npc_chitose` | 緋櫻千歲（御前） | 第 5 節 |  |
| `npc_masatsugu` | 緋櫻正嗣 | 第 5 節 |  |
| `npc_ayame` | 緋櫻綾女 | 第 5 節 |  |
| `npc_saku` | 緋櫻朔 | 第 5 節 |  |
| `npc_shizuka` | 橘靜（一番） | 第 5 節 |  |
| `npc_hikari` | 天羽光 | 第 5 節 |  |
| `npc_touka` | 榊冬華 | 第 5 節 |  |
| `npc_kate_walker` | 凱特·沃克 | 第 5 節 | ✓ |
| `npc_shen_tang` | 沈棠 | 第 5 節 |  |
| `npc_nora_sin` | 諾拉·辛 | 第 5 節 |  |
| `npc_elena_moretti` | 伊蓮娜·莫雷蒂 | 第 5 節 |  |
| `npc_suzuran` | 鈴蘭（Suzuran） | 第 5 節 |  |
| `npc_frost` | 霜 | 第 5 節 |  |
| `npc_lenora` | 蕾諾拉 | 第 5 節 |  |
| `npc_selene_wu` | 賽琳·吳 | 第 5 節 |  |
| `npc_ezekiel_hall` | 以西結·霍爾 | 第 5 節 |  |
| `npc_baiwei` | 白薇 | 第 5 節 | ✓ |
| `npc_rosa` | 蘿莎（糖姐） | 第 6 節 |  |
| `npc_eunah` | 金恩雅（辣椒） | 第 6 節 |  |
| `npc_jiugu` | 九姑 | 第 6 節 |  |
| `npc_hongxiao` | 紅綃 | 第 6 節 |  |
| `npc_shen_ke` | 沈克 | 第 6 節 |  |
| `npc_greta` | 葛蕾塔（熔爐） | 第 6 節 |  |
| `npc_rin` | 鬼塚凜 | 第 6 節 |  |
| `npc_rabbit` | 兔子 | 第 6 節 |  |
| `npc_che` | 阿徹（團長） | 第 6 節 |  |
| `npc_camilla` | 卡蜜拉（伯爵夫人） | 第 6 節 |  |
| `npc_kitsune` | 狐面 | 第 6 節 |  |
| `npc_jonah` | 約拿 | 第 6 節 |  |
| `npc_echo` | 回聲 | 第 6 節 |  |
| `npc_mio` | 澪 | 第 6 節 |  |
| `npc_theo_mensah` | 西奧（館主） | 第 6 節 |  |
| `npc_saya` | 梶原沙耶（局長） | 第 6 節 |  |
| `npc_runa` | 水城瑠奈（金盞花） | 第 6 節 |  |
| `npc_pudding` | 布丁（Pudding） | 第 6 節 |  |
| `npc_nagi` | 凪（Nagi） | 第 6 節 |  |
| `npc_dolly` | 多莉（Dolly） | 第 6 節 |  |
| `npc_crow` | 老鴉（拆體客的具名精英） | [QUESTS](../content/QUESTS.md) | ✓ |
| `npc_shirayuri` | 白百合（鎮溺隊越線的隊員） | [QUESTS](../content/QUESTS.md) | ✓ |

**流竄 AI**（[NPCS](../world/NPCS.md) 8.2 節）也是具名 NPC，走 NPC 的好感。id 用牠原本的產品名。

| id | 名字 | 原本的產品 |
|---|---|---|
| `npc_hearthside` | 媽咪 | Hearthside |
| `npc_mentor` | 姐姐大人 | Mentor+ |
| `npc_cling` | 小尾巴 | CLING |
| `npc_rival` | 借過一下 | Rival |
| `npc_unison` | 大家 | Unison |
| `npc_oath` | 這杯我請 | Oath |
| `npc_tether` | 絲 | Tether |
| `npc_threshold` | 荊棘小姐 | Threshold |
| `npc_sovereign` | 陛下 | Sovereign |
| `npc_comply` | 您的 | Comply |
| `npc_abstain` | 鎖匠 | Abstain |
| `npc_signet` | 落款 | Signet |
| `npc_lens` | @all_eyes | LENS Insight |
| `npc_spotlight` | 本台 | Spotlight |
| `npc_murmur` | 噓 | Murmur |
| `npc_dose` | 暈 | Dose |
| `npc_roam` | 到哪算哪 | Roam |
| `npc_fanworks` | 新刊 | Fanworks |
| `npc_treat` | 再一口 | Treat |
| `npc_reach` | 好多手 | Reach |
| `npc_curio` | 典藏室 | Curio |
| `npc_wildcard` | 嗷 | Wildcard |
| `npc_morph` | 還沒好 | Morph |
| `npc_fluid` | 都可以 | Fluid |
| `npc_contour` | Miss 七月 | Contour |
| `npc_unit` | 零七 | Unit Companion |
| `npc_servo` | 嘶—— | Servo |
| `npc_persona` | Ａ子 | Persona Studio |
| `npc_triage` | 下一位 | Triage Care |
| `npc_zenith` | 小仙 | Zenith |
| `npc_absolve` | 神父不在 | Absolve |
| `npc_homemaker` | 女僕長 | Homemaker |
| `npc_encore` | 安可 | Encore |
| `npc_lounge` | 今晚幾位 | Lounge |
| `npc_outlaw` | 夜露死苦 | Outlaw |
| `npc_avatar` | 初見 | Avatar Live |
| `npc_paladin` | 寧死不屈 | Paladin |
| `npc_purify` | 請低頭 | Purify |
| `npc_sentinel` | 愛與正義 | Sentinel |
| `npc_veteran` | 長官 | Veteran |
| `npc_atelier` | 請入座 | Atelier |
| `npc_endless` | 夜后 | Endless |

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
- `requires` 可以看主角的性別：`"gender": ["male"]`；也可以看體型（只影響描寫）。

## 5. 戰敗事件

戰敗事件是事件的一種，前綴 `df_`。它多了這幾樣：

| 欄位 | 內容 |
|---|---|
| `kind` | 二十九種預設裡的哪一種（[ENEMIES](ENEMIES.md) 第 6 節） |
| `factions` | 哪些勢力用它 |
| `fails_commission` | 預設值：戰敗算不算委託失敗。委託副本可以蓋掉它 |
| `versions` | 三個版本：`default` 一般的寫法；`masc` 男性處於被動；`yuri` 主角被動、由女性主導。照主角的**性別**抽（[ENEMIES](ENEMIES.md) 第 6 節）：男只走 `masc`，女七成 `default` 三成 `yuri`，偽娘、TS、扶他三個都會抽到。每個版本各有自己的 `text` 與 `stages`。設定裡手動指定版本時，照設定 |
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
| `mods.ram`、`mods.guard` | RAM 上限與防護（直接減掉受到的感載）相對於 [ENEMIES](ENEMIES.md) 1.5 節內海表的加減；和現實的敵人一樣不寫絕對的數字，每回合回的 RAM 照表 |
| `sync` | 固定的同步檔位：`shallow`、`standard`、`deep`、`full`；`shift` 表示它會換檔 |
| `constructs[]` | 武器構裝：傷害骰、適用距離、花的 RAM、遮蔽倍率 |
| `color` | 只有蕾絲：`white`、`pink`、`black`。它只決定行為，不決定數值 |
| `admin` | 對方的潛網者才有：每回合幾次管理行動 |

```json
{
  "id": "en_lace_pink_maid", "name": "粉蕾絲・侍女",
  "faction": "none", "grades": [2, 4], "rank": "minion", "kind": "lace", "color": "pink",
  "mods": {},
  "sync": "standard",
  "constructs": [ { "id": "stream", "class": "smg", "type": "neural", "ram": 1 } ],
  "position": { "prefer": [2, 3], "cover_use": 0.5 },
  "signature": ["tether"],
  "ai": { "focus": 1, "prefer": "overloaded", "mode": "capture", "flee_below": 0, "prefer_deep_sync": true },
  "defeat": "pinned",
  "loot": [ { "construct": "random", "chance": 0.4, "needs": "dissect" } ],
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
| `mimic` | 只有「另一個主播」（第一手的潔絲，`pr_jess`）：模擬抽牌，每回合隨機開放幾種行動 |

格子的 id：`doujin` 同人圈、`tape` 帶子街、`fanclub` 應援圈、`sakura` 緋櫻映畫、`kaleido` 萬華鏡、`nightingale` 夜鶯直播、`wall` 牆報、`whisper` 街上的耳語、`relay` 地下轉播站。

```json
{
  "id": "pr_hizakura", "name": "緋櫻的公關室", "faction": "hizakura",
  "strength": 2, "start": "opposite",
  "cell_priority": { "sakura": 3, "kaleido": 2, "nightingale": 1, "tape": 1, "fanclub": 2,
                     "doujin": 1, "wall": 0, "murmur": 0, "relay": 0 },
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
| 三種共通 | `grade`、`brand`、`require` 必要的零件、`optional` 選配、`legal` 合法性、`price`、`size` 大小、`weight`；武器與護甲、服裝另有 `primary_color`、`secondary_color`（目錄上的預設顏色，7.7 節） |

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

### 7.3 構裝

構裝是程式，不走設計圖與零件，一筆就是一件成品。同一個系列的每一級各一筆，用 `series` 串起來（[ITEMS](../gear/ITEMS.md) 11.1～11.7 節）。

| 欄位 | 內容 |
|---|---|
| `class` | `weapon`、`defense`、`tool`、`hack`（駭入程式，要主控）、`body`（構裝體）、`unique`（專屬構裝，不賣） |
| `series`、`grade`、`brand`、`legal`、`price` | 系列、等級、牌子、合法性、價錢 |
| `slots` | 佔幾個構裝槽（構裝體 2，其餘 1） |
| 武器 | `archetype` 原型、`dice`、`range`、`ram`、`cover_mult`、`type`（`neural`、`pleasure`、`jam`）、`traits` |
| 防護 | `guard` 防護值；`heavy`：防護 5 以上時 SKIN 風格值 −1、追蹤度多加 |
| 工具 | `ap`、`ram`、`passive`（被動的寫 true）、`effect` |
| 構裝體 | `durability` 耐久、`guard_bonus`、`weapon`、`needs`（`["unique:cockpit"]`）、`repair_fee` |
| 共通 | `quirk`（同人的怪癖）、`advanced`（深檔的進階效果，III 起）、`ultimate`（全檔的終極效果，IV） |

```json
{
  "id": "cs_nightpatrol_3", "kind": "construct", "class": "weapon", "name": "夜巡",
  "series": "cs_nightpatrol", "grade": 3, "brand": "nightingale", "legal": "banned", "price": 4160, "slots": 1,
  "archetype": "rifle", "dice": "4d6", "type": "neural", "range": [3, 7], "ram": 1, "cover_mult": 0.5,
  "traits": [ { "pierce_guard": 2 }, { "close_penalty": 4 }, { "report_back": "nightingale" } ],
  "advanced": { "when": "sync>=deep", "effect": { "node_damage_mult": 2 } },
  "ultimate": null
}
```

```json
{
  "id": "cs_gatekeeper_4", "kind": "construct", "class": "body", "name": "守門人",
  "series": "cs_gatekeeper", "grade": 4, "brand": "nightingale", "legal": "permit", "price": 62400, "slots": 2,
  "durability": 70, "guard_bonus": 4, "needs": ["unique:cockpit", "sync>=4"],
  "weapon": { "name": "閘", "dice": "4d6", "type": "neural", "range": [1, 4], "ram": 1 },
  "traits": [ { "on_activate": { "trace": 5 } } ],
  "repair_fee": 21840
}
```

### 7.4 SKIN

| 欄位 | 內容 |
|---|---|
| `style` | 風格標籤（[LEWD_SYSTEM](LEWD_SYSTEM.md) 第 2 節）；`custom` 是空白 SKIN 自己定 |
| `style_value` | 1～5，直接當全身的風格值 |
| `exposure` | 0～3，直接當全身的曝露度；空白 SKIN 寫 `custom` |
| `cut` | `female`、`male`、`femboy`、`neutral`、`custom`。只是版型，任何化身都能穿 |
| `adult` | 成人向的寫 true；內容篩選關掉成人時不出現在店裡 |
| `forms` | 有兩個樣子的（例：魔法少女・變身）列出每個樣子；都算同一套 |
| `real_twin` | 照現實哪一套畫的（「網內版」才有），寫現實那幾件的 id |
| `source`、`brand`、`price` | 哪裡拿、牌子、價錢；不賣的 `price` 寫 null |
| `primary_color`、`secondary_color` | 預設的主色調與副色調（7.7 節）；化身可以自己重染 |

```json
{
  "id": "skin_maid_homeec", "kind": "skin", "name": "家政課女僕服（網內版）",
  "brand": "hizakura", "style": "maid", "style_value": 3, "exposure": 0, "cut": "female", "adult": false,
  "real_twin": ["cl_maid_homeec"], "source": "net_avenue_skinshop", "price": 900
}
```

```json
{
  "id": "skin_magical_transform", "kind": "skin", "name": "魔法少女・變身",
  "brand": "kaleido", "style": "magical_girl", "style_value": 4, "exposure": 1, "cut": "female", "adult": false,
  "forms": [ { "id": "school", "name": "學生制服" }, { "id": "battle", "name": "戰鬥服", "on": "login" } ],
  "source": "net_avenue_skinshop", "price": 2300
}
```

### 7.5 快駭程式

只有主控能用（[ITEMS](../gear/ITEMS.md) 11.9 節）。裝在甲板的構裝槽裡（和構裝共用），主控的樹階決定跑得動幾級。

| 欄位 | 內容 |
|---|---|
| `class` | `device`、`cyberware`、`neural`、`control`、`support` |
| `ram`、`ap`、`trace` | RAM、行動點、追蹤度（被發現時也是加給那個勢力的敵對值） |
| `check` | 預設 `1d20 + mod(int) + interface` 對目標的防火牆；控制類對精英 +2、首領 +4 |
| `effect`、`by_grade` | 效果；各級不同的地方寫在 `by_grade` |
| `script_twin` | 有腳本版時寫腳本的 id（[ITEMS](../gear/ITEMS.md) 5.2 節） |

```json
{
  "id": "qh_cam_loop", "kind": "quickhack", "class": "device", "name": "迴圈攝影機",
  "brand": "kaleido", "grades": [1, 2, 3], "ram": 1, "ap": 1, "trace": 0,
  "legal": ["register", "register", "permit"], "price": [180, 600, 1920],
  "effect": { "target": "camera", "loop": "scene", "stealth_bonus": 2 },
  "by_grade": { "3": { "targets": 2, "stealth_bonus": 3 } },
  "script_twin": "sc_cam_loop"
}
```

快駭程式的價錢與合法性照等級寫成陣列，因為效果幾乎不變；構裝的每一級差得多，所以一級一筆。

### 7.6 機甲與載具

機甲是骨架加掛件（[ITEMS](../gear/ITEMS.md) 第 14 節、[CRAFTING](../gear/CRAFTING.md) 第 15 節）。骨架一級一筆；掛上去的武器、板材與輔助零件寫在存檔的那一具機甲上，不寫在骨架上。

| 欄位 | 內容 |
|---|---|
| `durability`、`armor_bonus`、`ap_bonus`、`duration` | 機體耐久、護甲加值、每回合多回的行動點、持續（`2+sync` 這種寫法是公式） |
| `hardpoints` | `[武器, 板, 輔助]` 三種槽的數目 |
| `backlash` | 四個檔位的回灌百分比；`sync_cap` 最高開到哪一檔 |
| `repair_coef` | 修理係數（CRAFTING 15.2 節） |
| `stock` | 出廠的武器 id |

存檔裡的一具機甲另外有：`frame`（骨架 id）、`durability_now`、`state`（`intact`、`damaged`、`heavy`、`wrecked`）、`mounts`（每一格裝了什麼）、`upkeep_owed`（欠了幾週）。

```json
{
  "id": "mf_mustang_3", "kind": "mech_frame", "name": "野馬",
  "brand": "starbelle", "grade": 3, "legal": "banned", "price": 3240000, "frame_price": 6480,
  "durability": 55, "armor_bonus": 4, "ap_bonus": 2, "duration": "2+sync",
  "hardpoints": [2, 3, 1], "backlash": [5, 15, 25, null], "sync_cap": "pilot-1",
  "repair_coef": 0.7, "stock": ["mw_twin_lmg_3", "mw_rocket_pod_3"],
  "traits": [ { "id": "tough", "per_battle": 1, "effect": "crit_to_hit" }, { "unhackable_frame": true } ]
}
```

載具在戰鬥裡是叫來的掩體（[COMBAT_SYSTEM](COMBAT_SYSTEM.md) 9.2 節），一筆只寫城裡與戰鬥要用的數字：

```json
{
  "id": "vh_yozakura_2", "kind": "vehicle", "class": "motorcycle", "name": "夜櫻",
  "brand": "hizakura", "grade": 2, "price": 11250,
  "seats": 2, "cargo": 2, "cover_hp": 35, "summon_ap": 1, "leg_time_min": 5, "chase": 2,
  "traits": [ { "license_lock": true }, { "district_bonus": { "sakura": { "perform": 1, "intimidate": 1 } } } ]
}
```

### 7.7 染色

武器、衣服、護甲、飾品與內海的 SKIN 都可以染兩個顏色（規則在 [EQUIPMENT](../gear/EQUIPMENT.md) 第 9 節）。介面上的名字是**主色調**與**副色調**。

| 欄位 | 內容 |
|---|---|
| `primary_color` | 主色調：整件的主要顏色（外殼、布料、槍身） |
| `secondary_color` | 副色調：滾邊、配件、握把、扣環與接縫 |

- 值是色票的 id（`dye_black`、`dye_pink`、`dye_olive`……，共 16 色，色票表在 `data/ui/dyes.json`）或 `#RRGGBB`。不認得的值讀檔時丟掉，退回預設。
- 物品、設計圖、SKIN 上寫的是**目錄上的預設顏色**；沒寫時照牌子的外觀（[NPC_SYSTEM](NPC_SYSTEM.md) 13.11 節：織女白配藍、緋櫻櫻粉配白、星旗橄欖綠配黑……）。設計圖做出來的成品照設計圖的預設。
- 存檔裡的一件東西（背包的一疊、穿著的一格、一套 SKIN）染過了才另外存一筆，沒染過的不存：

```json
{ "dyes": { "uid:u104": { "primary_color": "dye_mint", "secondary_color": "#1A1520" }, "slot:coat": { "primary_color": "dye_pink", "secondary_color": "dye_black" }, "skin:skin_neon_raincoat": { "primary_color": "dye_violet", "secondary_color": "dye_chrome" } } }
```

## 8. NPC

照 [NPC_SYSTEM](NPC_SYSTEM.md) 第 12 節的樣本，改兩處、加五樣。主角的外觀用同一組欄位（`look`），所以 `look.private` 主角也有：

| 變動 | 內容 |
|---|---|
| `traits` 改名 `persona` | 原本放屬性與性格象限的欄位改叫 `persona`，把 `traits` 這個名字讓給特質 |
| `gender` 的值 | 用第 1 節的五個值 |
| 加 `traits` | 特質與缺陷的 id，照特質點抽 |
| 加 `sex_record` | 性經歷：`partners` 對象的人數、`times` 次數、`first` 第一次（對象與一句話）、`service_times`、`favorite`、`notes` |
| 加 `night_skills` | 會的夜課技能 |
| 加 `positions` | 會的體位（基本的不用寫） |
| 加 `look.private` | 私處的外觀：`{ "options": [詞條的 id], "text": "自由輸入的一段" }`。主角在建角第 1 步選（[CHARACTER](CHARACTER.md) 第 1 節），NPC 生成時一起寫；內容篩選關掉「身體的私密描寫」時不問、不寫，只顯示在角色的成人分頁 |

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

樣本只列和舊格式不同的欄位，其餘照 NPC_SYSTEM 第 12 節。

## 9. 委託副本

完整的樣本在 [COMMISSIONS](COMMISSIONS.md) 第 11 節，那一筆已經是階段制的。這裡補三樣它引用到、但還沒有格式的東西。

### 9.1 輿論戰的開場表

有輿論階段的副本才有。它把前面的結果換成輿論戰的開場：

```json
"opinion_setup": {
  "topic": { "id": "tp_scandal_starbelle", "kind": "smear", "rounds": 6,
             "involves": { "factions": ["starbelle"], "people": ["npc_kate_walker"], "types": ["scandal", "crime"] },
             "scores": { "kaleido": 3, "sakura": 2, "nightingale": 1, "tape": 1, "doujin": 0,
                         "fanclub": 0, "wall": 1, "murmur": 2, "relay": 1 } },
  "opponent": { "id": "pr_starbelle", "strength": 2 },
  "base": { "voice": 2, "wind": 0, "cells": ["murmur"] },
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
- 手寫的委託另外可以用這幾個欄位：
  - `topic.category`：議題的題材（醜聞、人物、圈子、政策……），給 AI 與生成看；`kind` 留給開場的類型。
  - `opponent.named`：對手的公關由一位具名的人坐鎮（寫具名敵人或固定 NPC 的 id），只影響描寫與事件。
  - `from_flags`：和 `from_links` 一樣的寫法，但讀的是特殊任務的旗標（例如前一個任務點的選擇）。
  - `cells_by_flag`：照旗標決定玩家開場佔哪些格子。

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

### 9.3 現實面的地圖版面

[SITES](../world/SITES.md) 第 15 節的 `commission_maps` 是一個模板一筆；這裡加上版面。每一張圖寫進 `sheets`，一張一筆。圖例、座標與記法在 [COMMISSION_MAPS](../content/COMMISSION_MAPS.md) 第 1 節，三十個模板的版面都在那一份。

| 欄位 | 內容 |
|---|---|
| `sheets` | 這個模板的每一張圖，照一個副本串的順序（例：大廳、目標樓層、頂層）。單張的模板只有一筆 |
| `sheets[].id`、`name`、`size` | 這一張的 id（模板裡不重複）、名字、寬與高。`size` 和模板的 `size` 一樣 |
| `layout` | 字串陣列，一列一個字串，每個字串的長度都是寬；一格一個字元，字元照 `legend` |
| `legend` | 選填。字元到種類的對照，只寫和預設不同的；預設的對照是 COMMISSION_MAPS 1.1 節的表（`#` 牆、`.` 地板、`,` 戶外、`~` 水、`+` 門、`%` 要條件的門、`=` 窗、`^` 通風口、`<` `>` 樓梯、`H` 電梯、`O` 掩體、`o` 半掩體、`*` 人群、`$` 保險箱、`&` 人質、`E T D C G S K X` 標記、`1`～`9` 遭遇點） |
| `zones`、`zone_names` | 和 `layout` 一樣大的字串陣列；小寫字母是區塊，`#` 是牆，`~` 是水。`zone_names` 是每個字母的名字 |
| `cells` | 每個標記一筆：`id`（照「由上到下、由左到右」編號，`E1`、`T2`、`$1`、`&1`）、`at`（[x, y]，左上角是 [0, 0]）、`mark`、`name`。控制面板 `C` 也各一筆，名字寫成「<區塊>的控制面板」（範圍跨幾區時用面板所在的那一區）。入口另外有 `kind` 與 `need`（寫法同 COMMISSION_TEMPLATES 的 `entries[].need`：基本功與 `dc_plus`、`item`、`scouted`、`any`） |
| `spots` | 遭遇點：`id` 是模板的編號（`!1`）、`at`、`cover`（`dense`、`medium`、`sparse`、`one_sided`，或八格逐格寫） |
| `controls` | 控制區：`id`（`C1`）、`at`（面板的格）、`zones`（範圍是哪幾個區塊）、`node`（子網裡對應的控制節點 id，`cn_` 開頭，[NETRUNNING](NETRUNNING.md) 第 4 節）、`devices`（門、攝影機、燈、砲塔、防爆門……） |
| `patrols` | 選填。`guard`（哪一個 `G`）、`route`（照順序走過的區塊） |
| `links` | 串多張時這一張接到哪裡：`at`（一格或幾格，樓梯、電梯、相通的門）、`to`（另一張的 `id`） |
| `scout` | 選填。踩點揭開的東西在哪：`reveal`（FIXER 第 2 節的七類之一）、`at`（標記的 `id` 或區塊字母） |

- 有 `sheets` 的模板，模板層的 `markers`、`entries`、`spots` 由 `sheets` 算出來；兩邊都寫時資料檢查要對一致。
- 資料檢查：每一列的長度等於寬、列數等於高；每個標記與地板從入口或連接格走得到；`E T D C G K X` 的數量到 SITES 12.1 節的下限（以模板算）、遭遇點每張至少 2；`cells` 的數量和 `layout` 裡的字元一致。

```json
{
  "id": "map_office_small",
  "kind": "office_small",
  "size": [9, 9],
  "max_maps": 1,
  "district_weight": {"sakura": 3, "hive": 1, "kabuki42": 1},
  "fits": [
    "steal_data",
    "erase",
    "tamper",
    "honeypot",
    "collect"
  ],
  "sheets": [
    {
      "id": "office",
      "name": "二樓的辦公室",
      "size": [9, 9],
      "layout": [
        "####=E###",
        "#TOT#.OS#",
        "#.2.%G1.#",
        "#DC.#o.o#",
        "######+##",
        "#T&.#.GS#",
        "E...%.O.#",
        "#X..#C.K#",
        "######E##"
      ],
      "zones": [
        "####bb###",
        "#ccc#bbb#",
        "#ccccbbb#",
        "#ccc#bbb#",
        "######a##",
        "#ddd#aaa#",
        "dddddaaa#",
        "#ddd#aaa#",
        "######a##"
      ],
      "zone_names": {"a": "接待區", "b": "開放座位", "c": "主管室", "d": "茶水間與後門"},
      "cells": [
        {
          "id": "E1",
          "at": [5, 0],
          "mark": "E",
          "kind": "window",
          "name": "二樓的窗",
          "need": {"basic": "athletics", "dc_plus": 3, "each": true, "fail_alert": 10, "time": "night"}
        },
        {
          "id": "E2",
          "at": [0, 6],
          "mark": "E",
          "kind": "back",
          "name": "後門（茶水間旁的防火門）",
          "need": {"any": [{"basic": "mechanics", "dc_plus": 0}, {"item": "K"}]}
        },
        {
          "id": "E3",
          "at": [6, 8],
          "mark": "E",
          "kind": "front",
          "name": "正門",
          "need": {"open_hours": {"basic": "performance", "dc_plus": 0, "fail": "force"}}
        },
        {"id": "T1", "at": [1, 1], "mark": "T", "name": "牆上的保險櫃"},
        {"id": "T2", "at": [3, 1], "mark": "T", "name": "主管室的辦公桌"},
        {"id": "T3", "at": [1, 5], "mark": "T", "name": "茶水間後面的檔案間"},
        {"id": "D1", "at": [1, 3], "mark": "D", "name": "主管室的終端下方的網路孔"},
        {"id": "C1", "at": [2, 3], "mark": "C", "name": "主管室的控制面板"},
        {"id": "&1", "at": [2, 5], "mark": "&", "name": "檔案間（人質放在這裡）"},
        {"id": "C2", "at": [5, 7], "mark": "C", "name": "接待區的控制面板"},
        {"id": "K1", "at": [7, 7], "mark": "K", "name": "接待區的員工外套掛架"},
        {"id": "G1", "at": [5, 2], "mark": "G", "name": "主管室門口"},
        {"id": "G2", "at": [6, 5], "mark": "G", "name": "接待櫃檯"},
        {"id": "X1", "at": [1, 7], "mark": "X", "name": "後門"},
        {"id": "S1", "at": [7, 1], "mark": "S", "name": "開放座位的監視器"},
        {"id": "S2", "at": [7, 5], "mark": "S", "name": "接待區的監視器"}
      ],
      "spots": [{"id": "!1", "at": [6, 2], "cover": "dense"}, {"id": "!2", "at": [2, 2], "cover": "one_sided"}],
      "controls": [
        {"id": "C1", "at": [2, 3], "zones": ["c", "d"], "node": "cn_back_half", "devices": ["light", "safe_lock"]},
        {"id": "C2", "at": [5, 7], "zones": ["a", "b"], "node": "cn_front_half", "devices": ["door", "camera"]}
      ],
      "patrols": [{"guard": "G2", "route": ["a", "b", "a", "d"]}],
      "scout": [
        {"reveal": "路", "at": "E2"},
        {"reveal": "路", "at": "E1"},
        {"reveal": "守備", "at": "G2"},
        {"reveal": "目標", "at": "T2"},
        {"reveal": "詞條", "at": "b"}
      ]
    }
  ]
}
```

## 10. 網內的生成地圖

規則在 [CYBERSPACE](CYBERSPACE.md) 8.1～8.6 節，這裡只定存檔裡的一筆長什麼樣。生成的結果存在存檔裡，同一座子網、同一艘船離開再回來還是同一張圖：版面由 `seed` 重新生成，`state` 記玩家改變過的東西。迷宮館與深海每一趟重新生成，這一筆只在那一趟裡有效。

```json
{
  "id": "nm_cm0412_net",
  "region": "subnet",
  "grade": 3,
  "theme": "nectar_clinic",
  "layers": ["staff", "control", "core"],
  "affixes": ["shift_change", "rival_crew"],
  "objective": { "kind": "download", "layer": "core", "turns": 3 },
  "seed": 81427,
  "state": { "layer": "control", "looted": ["n07"], "beaten": ["n03", "n05"], "broken_links": ["n02-n04"] },
  "faction": "nectar",
  "facility": "lab",
  "entry": "commission",
  "airgap": { "layer": "core", "open_by": "airgap_open" }
}
```

**每一區都有的欄位**

| 欄位 | 內容 |
|---|---|
| `id` | `nm_` 開頭。委託副本的內海面用 `nm_<委託副本的 id>_net` |
| `region` | `maze`（迷宮館）、`subnet`（一般子網）、`reef`（暗礁的通路）、`wreck`（沉船帶）、`deep`（深海） |
| `grade` | 地圖的等級，1～5 |
| `theme` | 主題的 id，要在那一區的主題表裡（`reef` 沒有） |
| `layers` | 每一層的名字，照順序。子網寫權限層（`guest`、`staff`、`control`、`core`）；其他區寫那一區的層名 |
| `affixes` | 詞條的 id。資料檢查要對每一個 id 是否在那一區的詞條表或 8.1 節的共通詞條表裡 |
| `objective` | 有委託或任務時才有：`kind`（`download`、`seize`、`find`、`defeat`、`plant`、`extract`）、放在哪一層、需要的回合或對象 |
| `seed` | 生成用的種子。特殊任務的區域可以寫死一個 |
| `state` | 玩家改變過的東西：現在在哪一層、拿走的寶、打倒的遭遇、斷掉的鏈路（節點 id 由生成器編號） |

**各區多出來的欄位**

| 區 | 欄位 | 內容 |
|---|---|---|
| `maze` | `bracket`、`overtime`、`bonus_taken` | 組別（`rookie`、`open`、`unlimited`）；延長賽開了沒有；接受了幾次「加碼」（8.2 節） |
| `subnet` | `faction`、`facility`、`entry`、`airgap` | 哪一家企業；設施類型（`office`、`logistics`、`lab`、`server`、`store`、`estate`）；`commission`（委託）或 `dig`（自己去挖）；隔離區在哪一層、由哪個連動打開（8.3 節） |
| `reef` | `reach`、`legs`、`chart` | 去哪一段（`near`、`mid`、`wall`）；每一段的檢定結果與過礁事件；水道圖的來源與失效的日子。這一區沒有格子圖，`layers` 與 `theme` 留空（8.4 節） |
| `wreck` | `ship`、`reach`、`signal` | 船的種類；位置（`near`、`mid`、`wall`）；目前的追蹤度（8.5 節） |
| `deep` | `biomes`、`depth`、`sea` | 走過的海域 id，照順序；現在的深度；每個海域擲到的海況（8.6 節） |

## 11. 素材、片與直播模板

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

- 片的 `card` 是它進輿論戰牌庫時的樣子：`angle` 有七種（`documentary` 紀實、`daily` 日常、`fun` 娛樂、`hero` 英雄、`expose` 揭弊、`sensational` 煽情、`smear` 抹黑）：紀實、英雄、揭弊是 `line`（說法），數字用 `trust`；煽情、抹黑是 `fuel`（料），數字用 `draw`；日常的 `card` 是 `null`，不能當牌；娛樂的 `card` 是 `{ "kind": "decoy" }`，只能當轉移焦點的燃料。和議題無關的片進不了牌庫（[OPINION](OPINION.md) 4.3a 節）。

## 12. 設施的種類

一筆是一**種**設施（診所、潛艙店、當舖……），不是一間店。街區的 `facilities` 清單（[SITES](../world/SITES.md) 第 15 節）裡每一間店指向一種；店自己的名字、店主與例外寫在街區那一邊。功能與營業時段的總表在 [SITES](../world/SITES.md) 第 16 節。世界編輯器的「世界 → 設施」改的就是這一份。

```json
{
  "id": "fac_clinic", "name": "診所", "group": "body",
  "functions": ["heal", "modify", "rest", "sell", "train"],
  "shop": "clinic", "jobs": ["job_stitch_assistant"], "train": ["medicine", "cyberware"],
  "hours": { "default": ["morning", "noon", "afternoon"], "black": ["evening", "late"] },
  "districts": ["hive", "kabuki42", "oldport", "sakuramachi", "rustbelt", "glass_shore"],
  "desc": "替人治療與動手術的地方。正規的在白天開，灰色與黑的在夜晚開。"
}
```

| 欄位 | 意思 |
|---|---|
| `functions` | 點進來之後的選項：`buy`、`sell`、`work`、`rest`、`heal`、`modify`、`info`、`job_board`（委託）、`train`、`travel`、`dive`（潛入內海） |
| `shop` | 對應 [TRADE](TRADE.md) 第 2 節的商店種類；不賣東西的設施沒有這一欄 |
| `jobs`、`train` | 這一種設施可以開的打工（[DOWNTIME](DOWNTIME.md) 4.1 節）與機構課程的基本功（[CORE_RULES](CORE_RULES.md) 7.5 節）；個別的店從裡面挑 |
| `hours` | 六個時段的 id；可以依店的類別分開寫（例：正規、黑的） |
| `districts` | 預設出現在哪些區，給世界包新增街區時參考；實際的位置看街區的清單 |

