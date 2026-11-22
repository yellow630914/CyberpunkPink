# 技能效果清單

產生日期：2026-11-22。唯讀盤點，沒有改任何程式。資料版本在 `dev/reports/skill-effects.json`，這份是同一份內容的表格版。

## 一、總覽

| 項目 | 數量 |
|---|---|
| 效果（`k.battle.effect` 登錄的 op） | 46 |
| 修正種類 | 40（核心 MOD_KINDS 29、技能功能自己認的 11） |
| 反應的觸發（trigger.on） | 9（新寫法 7、舊字串寫法 2） |
| 條件（when／needs／range／效果的 if） | 37 |
| 消耗與次數的鍵（use） | 13 |
| 落點（效果的 who、技能的 target） | 27（效果的 who 15、技能的 target 12） |
| 技能格式的其他鍵（meat 的頂層鍵、pick 種類、預備、日常、共鳴） | 39 |

### 八棵樹的技能狀態

| 樹 | 完成 | 近似 | 寫不出來 | 等後面批次 | 無現實效果 | 合計 |
|---|---|---|---|---|---|---|
| 槍手 | 25 | 1 | 1 | 0 | 0 | 27 |
| 機師 | 15 | 6 | 0 | 6 | 0 | 27 |
| 改造師 | 17 | 7 | 0 | 3 | 0 | 27 |
| 潛網者 | 17 | 8 | 0 | 0 | 2 | 27 |
| 名媛 | 18 | 3 | 0 | 2 | 4 | 27 |
| 掮客 | 19 | 3 | 2 | 1 | 2 | 27 |
| 主播 | 0 | 0 | 0 | 0 | 27 | 27 |
| 偶像 | 0 | 0 | 0 | 0 | 27 | 27 |
| **合計** | **111** | **28** | **3** | **12** | **62** | **216** |

### 八棵樹的共鳴狀態（每棵 5 階）

| 樹 | 完成 | 近似 | 寫不出來 | 等後面批次 | 無現實效果 | 合計 |
|---|---|---|---|---|---|---|
| 槍手 | 3 | 0 | 2 | 0 | 0 | 5 |
| 機師 | 4 | 0 | 0 | 1 | 0 | 5 |
| 改造師 | 4 | 1 | 0 | 0 | 0 | 5 |
| 潛網者 | 3 | 0 | 0 | 0 | 2 | 5 |
| 名媛 | 4 | 0 | 0 | 0 | 1 | 5 |
| 掮客 | 2 | 0 | 0 | 2 | 1 | 5 |
| 主播 | 0 | 0 | 0 | 0 | 5 | 5 |
| 偶像 | 0 | 0 | 0 | 0 | 5 | 5 |
| **合計** | **20** | **1** | **2** | **3** | **14** | **40** |

## 二、讀法與判斷規則

- 狀態：**完成**是現實欄照設計書寫成；**近似**是寫成了但比設計書寬或窄（原因寫在說明）；**寫不出來**是現在的格式與引擎表達不了（或資料還沒補）；**等後面批次**是標了 `pending`、要等 M2／M3／M4／M6；**無現實效果**是設計書現實欄是「—」，或這棵樹（主播、偶像）在現實沒有效果。
- 近似的技能若有一半在等後面的批次，`later` 欄也會寫那一批（例如機師有機甲那一半的技能寫 M6）。
- 判斷的依據：技能的資料是各棵樹的驗收測試裡的假資料（槍手與掮客另有 `engine/data/rules/abilities.json`，已照測試改寫）；哪些近似、哪些寫不出來照測試註解、`dev/status.md` 與 ADR 0015 的實作補記對過設計書 `docs/content/SKILL_TREES.md` 逐條確認。哪一批：ADR 0015 E12（機甲）→ M6、E13（名冊、義體系統、滲透與豔名）→ M2／M4、追蹤度（E9）→ M3、日常 → M4。
- 預備與日常技能的表格現實欄多半是「—」，但它們的效果寫在表格下方的預備與日常段，所以狀態看的是預備與日常段的效果有沒有寫成：寫成了的算完成或近似（整備、後門、千面），沒寫成的算寫不出來（幫槍槍保養、戰前佈置、情報網）或等後面批次（讀人、改造師的三個日常）。真正沒有任何現實效果的才算「無現實效果」。
- 技能 id 來自測試的假資料（潛網者的 `sk_ctrl` 這類最終要由資料改寫）；沒有資料可查的技能（潛網者現實欄是「—」的兩個、主播與偶像的 54 個）用 `sk_<樹>_t<階>_<序>` 當暫代 id，JSON 裡標 `idPlaceholder: true`。
- 技能的 `keys` 是這個技能用到的格式鍵：效果的 op 直接寫名字；其他加前綴（`mod.`、`trigger.`、`when.`、`needs.`、`use.`、`who.`、`if.`、`target.`、`pick.`、`react.`、`meat.`），對得上下面各張表的第一欄。`usedBy` 只統計八棵樹的技能（共鳴另記在 `usedByResonance`）；標「其他來源」的效果是被道具、招牌行動、快駭程式用。
- 所有效果都另外接受共同的 `who`（落點）與 `if`（看上一筆的結果）兩個欄位，下表的參數不重複列。

## 三、效果（46 個）

| op | 擁有者 | 參數 | 說明 | 使用的技能 |
|---|---|---|---|---|
| `attack` | combat | hit、dice、damage、pierce、type、aimed、spend、cover_shift、cover_mult_min、no_cover、no_wound、auto_crit、armor_mult、as、label、tags | 用手上的武器對目標攻擊一次，走一般的命中、傷害、要害與重創流程，並把結果記進上一筆的結果供後面的效果用。可以臨時加命中、骰數、固定傷害與穿甲，改傷害類型，當成瞄準過的射擊，指定花掉幾格彈匣（all 是全部），調整遮蔽對這一擊的影響，或改用另一組屬性與基本功擲命中。 | 走開啦、穿透、跑位射擊、死線、掩護撤退、下一個！、不准動喔、一槍定局、還給你～、找縫、短路 |
| `strike` | combat | dice、type、hit、range、pierce、cover_mult、natural、label、traits | 用一把臨時的武器打一擊，不吃彈匣也不看手上的武器，名字用來源的名字（手雷、撞擊）；落在掛著的東西上時也能打。natural 可以讓同一串效果的每個落點共用同一個骰面。 | （其他來源）手雷、撞擊這類道具與招牌行動（M1b-ops 的測試）使用；八棵樹的技能沒有用到。 |
| `damage` | combat | amount、type、pierce | 對目標造成一筆直接傷害，不擲命中；打在掛著的東西上時照核心的算法扣它的耐久。 | （其他來源）誘惑攻擊與引爆在內部呼叫它，敵人招牌與道具也用；八棵樹的技能沒有直接寫它。 |
| `load` | combat | amount、type、exact | 替有橋的目標增加感載（神經或快感），沒有橋的人無效；快感類型會依傷害類型的資料加沉溺，exact 表示不吃百分比修正。 | 子彈時間、超頻、過熱、灌頂、黑冰、戳戳你 |
| `heal` | combat | amount | 替目標回復生命值，數量可以寫公式；做的人的 heal_dealt 修正會加進來。 | 戰場急救、不痛不痛、排好隊喔、戰地手術、全面翻修 |
| `vent` | combat | amount | 替目標排掉感載，數量可以寫公式；做的人的 vent_dealt 修正會加進來。 | 呼呼不燙了、護盤 |
| `afterglow` | combat | amount、layers | 增減目標的餘韻層數，最少 0、最多到他的承受層數上限。 | 呼呼不燙了、全面翻修、極限超頻、銷魂 |
| `status` | combat | status、turns、until、data、save | 替目標加上一個戰鬥狀態，可指定回合數、結束時機與數值；寫了 save 時目標先擲豁免，過了就不加。 | 掩護撤退、堡壘姿態、短路、拆光、傀儡、跟我說嘛、暈乎乎、眾生相、勸降、收買、打他打他！、有話好好說…（共 13 個） |
| `unstatus` | combat | status、kinds、count | 拿掉目標身上指定的狀態，或依種類（控制、減益、增益、重創、標記）拿掉指定數量。 | 堡壘姿態、備份 |
| `cleanse` | combat | by、status | 以某種解除方式（例如急救）或指定的狀態 id，解掉目標身上的狀態。 | 戰場急救、不痛不痛 |
| `soft_cover` | combat | kind、rounds、also | 在目標那一格放上一種臨時的軟遮蔽（煙霧之類），可限定回合數；also 為真時連玩家選的相鄰一格也放。 | （其他來源）煙霧彈等道具（engine/data/rules/items.json）使用；八棵樹的技能沒有用到。 |
| `check` | combat | attr、skill、vs、bonus、tags、label、stop | 做的人擲 1d20＋屬性修正＋基本功＋加值，對目標的防火牆、迴避、意志或固定難度；對別人擲時先發 check.before 讓對方的反應改難度，結果寫進上一筆的 ok，stop 為真且失敗時中止後面的效果。 | 拆解、卸下、拆光、手手拿開、跟我說嘛、勸降、有話好好說 |
| `shift` | combat | dir、n | 把目標往後推或往前拉幾格，遇到邊界或擋住就停。 | 走開啦、手手拿開、傀儡 |
| `move` | combat | to | 讓目標換到玩家選的那一格（pick.slot）；to 為 adjacent 時只能換到相鄰的格。 | 跑位射擊、掩護撤退 |
| `swap` | combat | with | 讓目標和玩家選的另一名隊友對調位置。 | （其他來源）目前只有 M1b-ops 的測試使用；八棵樹的技能沒有用到（換個位子嘛走舊的 free_move 寫法）。 |
| `cover` | combat | levels、max | 替目標所在的那一格升或降遮蔽等級；正數升（可限制最高級），負數降。 | 改寫地形、封鎖、管理員 |
| `ap` | combat | amount、over_cap | 增減目標的行動點，預設不超過上限，over_cap 可以超過，減不會低於 0。 | 獵殺節奏、傀儡、群播、總攻令 |
| `mag` | combat | amount、over_cap | 增減目標手上武器的彈匣格數；amount 為 full 時補滿，over_cap 可以超過容量。 | 代理、黑市門路 |
| `pool` | combat | pool、amount | 增減目標的某個資源池（RAM、現金、人情等），amount 為 full 時補滿。 | 逆流、謝謝招待 |
| `implant` | combat | mode、kind、turns、until、take | 讓目標的一件義體失效（off）或超頻（boost），可指定種類、持續時間；take 讓它到戰鬥結束都失效並記成被卸下。 | 拆解、超頻、卸下、拆光、手手拿開、過熱 |
| `revive` | combat | hp | 讓因生命歸零倒下的目標以指定生命值回到場上。 | 拉回來 |
| `wound` | combat | mode、part | 處理重創：treat 是輕的解除、重的降成輕的，clear 是全部清掉，可指定部位。 | 戰地手術、全面翻修 |
| `out` | combat | how | 讓目標退出這場戰鬥（投降或逃走）。 | 勸降 |
| `field` | combat | key、value | 開關全場的場地旗標（目前只有 dark：全場黑暗，迴避 +2）。 | 封鎖、管理員 |
| `order` | combat | with、act_next | 把目標和玩家選的隊友的先攻順位對調；act_next 讓被換到前面、這一輪還沒動過的人馬上輪到並拿回 1 點行動點。 | 大局 |
| `sink` | combat | amount、save | 替目標增加沉溺；寫了 save 時目標先擲定力豁免，過了就整筆擋掉。 | 灌頂 |
| `throw` | combat | dice、type、hit、cover_mult、on_hit、save、cover | 投擲物：一顆骰同時打目標那一格與玩家選的相鄰一格，格上的人與掛著的東西各自對自己的迴避；寫 save 的（閃光彈）不造成傷害，兩格的人過檢定、沒過的做 on_hit；cover 可以讓那兩格遮蔽各降幾級。 | （其他來源）投擲物道具（手雷、閃光彈、炸藥）使用；八棵樹的技能沒有用到。 |
| `decoy` | combat | — | 在我方一格放一台沒有操作者、耐久 1 的立牌，下一次以那一格的人為目標的敵方攻擊改打它。 | （其他來源）立牌道具使用；八棵樹的技能沒有用到。 |
| `hack.check` | hack | class、grade、bonus、stop | 快駭的檢定：包裝核心的 check，1d20＋智識＋介面＋等級加值＋程式加值，對目標的防火牆（控制類打精英 +2、首領 +4）；沒過時記一句「沒有效果（RAM 已經花掉了）」。 | 破冰、接管、迴圈、過熱、改寫地形、灌頂、傀儡、黑冰 |
| `hack.dot` | hack | amount、turns | 持續型快駭：目標之後每個回合開始時受一次感載；同一個目標同時只掛一個，新的蓋掉舊的。 | 迴圈 |
| `hack.takeover` | hack | turns、until、mode | 接管敵方一台無人機或砲塔指定回合（或到戰鬥結束），變成我方、由做的人指揮；mode 為 rewrite 時只改寫敵我名單，到期前它每輪攻擊原本的隊友；到期後還回去。 | 接管、管理員 |
| `hack.node` | hack | — | 拿下一個控制節點。 | （其他來源）快駭程式（拿下控制節點）使用；八棵樹的技能沒有用到。 |
| `hack.detonate` | hack | dice、type、cover | 引爆目標快取格裡的一件爆裂物：那一格受一擊（預設熱能 2d6）、遮蔽降級，那件道具消失。 | 改寫地形 |
| `buff` | abilities | id、name、turns、until、mods、on_end、mask | 替目標掛一段限時的修正（mods），到期時做 on_end；同一個 id 再掛是重算時間；mask 讓它同時算戴著面具。 | 死線、心流、火力牆、子彈時間、去陪陪他、穹頂、不痛不痛、超頻、極限超頻、破冰、看錯人囉、備份…（共 20 個） |
| `ward` | abilities | slot、until、on、do | 守著敵方的一格：到期之前站在那一格的人第一次換位、補位或攻擊時，守著的人立刻做 do（通常是朝他開一槍），用過就沒了。 | 不准動喔 |
| `tease` | abilities | hit、bonus、on_ok、on_overload、targets | 誘惑攻擊：魅力與誘惑對目標的意志與定力一次檢定，過了造成 2d6 快感傷害（不看護甲與遮蔽），再做 on_ok；讓目標過載時再做 on_overload；targets 為 2 時多選第二個目標。 | 欺負人家要賠喔 |
| `branch` | abilities | needs、when、do、else | 看這一筆落在的人（needs）與做的人（when）符不符合條件，符合做 do、不符合做 else。 | 找縫、短路、全面翻修、勸降、全城欠我 |
| `cover_temp` | abilities | levels、until | 替這個人所在的那一格暫時升遮蔽等級（最高到掩體），到期時把升上去的拿回來。 | 跑位射擊 |
| `drone.act` | summons | which、max、at、hit、pierce、mark_used、ignore_used | 讓指定的幾台無人機各動作一次，不另外花指揮的行動點；可指定打誰與命中、穿甲加成。 | 乖孩子去吧、再一次嘛、雙聯火控、飽和攻擊、精準導引、蜂群、敢打我家孩子？ |
| `drone.deploy` | summons | drone、kind、grade、turns、over_cap、no_backlash | 放出一台無人機（單位上的第幾台，或臨時的一台），可指定持續回合、是否超過同步上限、被擊落時是否不回灌感載。 | 乖孩子去吧、蜂群 |
| `drone.move` | summons | to、any | 把選的那一台無人機移到指定的格；any 為真時不必相鄰。 | 去陪陪他、修修就好 |
| `drone.repair` | summons | amount | 讓一台還沒被擊落的無人機回復耐久。 | 修修就好 |
| `drone.smoke` | summons | rounds | 讓無人機掛的那一格變成打不破的半掩體，持續指定回合。 | 煙煙罩著你 |
| `drone.ram` | summons | dice、type | 讓一台無人機撞上目標：無人機被擊落，目標受傷害並被往後推。 | 撞過去！ |
| `drone.guard` | summons | which、max、until | 讓幾台無人機替同一格的人擋下一次攻擊（那一擊改打無人機）。 | 穹頂 |
| `drone.escort` | summons | evade、max、off | 姿態用：開著時和無人機同一格的隊友迴避加成，最多幾格受惠；off 為真時收起。 | 護航編隊 |

## 四、修正種類（40 種）

| kind | 來源 | 說明 | 使用的技能 |
|---|---|---|---|
| `hit` | 核心 | 自己攻擊的命中加減；問的時候帶武器與標籤，所以可以只對某一類攻擊生效（例如瞄準過的、無人機的）。 | 死線、獵眼、人槍合一、編隊、突擊姿態、手術刀、不痛不痛、拆拆好好玩、解鎖匠、極限超頻、不要走嘛、偽裝…（共 14 個）；共鳴：pilot:4 |
| `hit_against` | 核心 | 別人打他時，攻擊者的命中加減（標記是 +2）。 | — |
| `evade` | 核心 | 迴避加減。 | 火力牆、去陪陪他、突擊姿態、穹頂、靜默、看錯人囉、備份、入骨、這才是真的我、布陣、護盤、號令；共鳴：fixer:3 |
| `dice` | 核心 | 傷害骰的顆數加減。 | 突擊姿態 |
| `damage` | 核心 | 固定傷害加減。 | — |
| `pierce` | 核心 | 穿甲加減。 | 人槍合一 |
| `armor` | 核心 | 護甲加減。 | 堡壘姿態 |
| `crit_margin` | 核心 | 要害門檻（超過迴避幾以上算要害），負的是更容易；資料可以用 to 直接指定門檻。 | 獵眼、人槍合一 |
| `save` | 核心 | 豁免與戰鬥裡各種檢定的加減，可用標籤限定是哪一種檢定（hack、tease、subdue、resist:suppressed 等）。 | 死線、不痛不痛、拆拆好好玩、解鎖匠、主控、盯～、值機、有我在；共鳴：medic:3、netrunner:1、socialite:1 |
| `initiative` | 核心 | 先攻加減。 | — |
| `ap_regen` | 核心 | 每回合回復的行動點加減；設計書限制只有終極技能可以動它。 | 子彈時間、極限超頻 |
| `load_dealt_pct` | 核心 | 自己造成的感載的百分比加減。 | — |
| `load_taken_pct` | 核心 | 自己受到的感載的百分比加減（同步檔位的 ×0.5 是 −50）。 | — |
| `decay` | 核心 | 感載每回合自然消退的加減。 | — |
| `move_ap` | 核心 | 換位花的行動點加減（負的是減免）。 | — |
| `action_ap` | 核心 | 任何行動花的行動點加減（最少 0）；問的時候帶行動 id、群組與行動宣告的標籤，可以每場或每回合只算前幾次，資料也可以用 to 指定改成只花幾點。 | 構裝精通、手術刀、巡房、名醫、後門、多工；共鳴：fixer:2 |
| `action_ram` | 核心 | 行動花的 RAM 加減，只在行動本來就花 RAM 時算，最少 1。 | 根權限 |
| `heal_dealt` | 核心 | 自己造成的生命回復多幾點；問的時候 other 是被回復的人、標籤是治療的標籤。 | 手術刀、縫合手、主刀、名醫；共鳴：medic:1 |
| `vent_dealt` | 核心 | 自己造成的排感載多幾點，問法同 heal_dealt。 | —；共鳴：medic:1 |
| `ai_target_pct` | 核心 | 敵人 AI 挑目標時，候選人的權重加減幾個百分點；−100 就是不挑他，候選全部都是 0 時當成沒有這個修正（面具、謝幕）。 | 謝幕 |
| `see_dark` | 核心 | 大於 0 的人攻擊時不吃黑暗，和夜視標籤並存。 | — |
| `firewall` | 核心 | 目標的防火牆加減，問的是被擲檢定的那一方（破冰是 −2、我很清醒喔是 +2）。 | 破冰、我很清醒喔 |
| `wound_grade` | 核心 | 重創級數加減，−1 是重的改成輕的；由 features/combat 擲部位時問。 | 主刀 |
| `overlay_hp` | 核心 | 放出一台和人重疊的東西時，它的耐久（現在與上限）加減；問的是操作者，標籤是種類。 | 整備；共鳴：pilot:1 |
| `overlay_armor` | 核心 | 和人重疊的東西的護甲加減。 | 整備；共鳴：pilot:2 |
| `overlay_evade` | 核心 | 和人重疊的東西的迴避加減。 | —；共鳴：pilot:5 |
| `overlay_cap` | 核心 | 同時連得住幾台和人重疊的東西加減幾台；標籤 support 表示只限支援型；由 features/summons 問。 | 多工連結 |
| `overlay_backlash` | 核心 | 自己放的一台被擊落時，操作者受的感載（基本 5 點）加減幾點，最少 0；由 features/summons 問。 | 回灌緩衝 |
| `cover_level` | 核心 | 站在這一格的人吃到的遮蔽多（負的是少）幾級，最高到掩體；多出來的級數打不破，修正消失就沒了；who 為 behind 時是「自己後面那一格」（堡壘姿態）。 | 堡壘姿態 |
| `instinct_points` | 技能功能 | 戰鬥直覺可以分配的點數加減（共鳴 5、心流）；features/abilities 自己認的修正。 | 心流；共鳴：gunner:5 |
| `instinct_cap` | 技能功能 | 戰鬥直覺每一項的點數上限加減（心流）；features/abilities 自己認的修正。 | 心流 |
| `instinct_free` | 技能功能 | 大於 0 時，戰鬥直覺的重分配不花行動點（心流）。 | 心流 |
| `call_uses` | 技能功能 | 叫人每場的次數加減（派工網、人脈）。 | 派工網、人脈 |
| `call_hit` | 技能功能 | 叫人的支援射擊的命中加減（人脈）。 | 人脈 |
| `aim_all` | 技能功能 | 大於 0 時，這個人的每一次射擊都算瞄準過的（子彈時間）。 | 子彈時間 |
| `no_wound` | 技能功能 | 大於 0 時，打在他身上的重創改成一般的命中（擋、護盤、第二張臉）。 | 第二張臉、護盤 |
| `damage_roll` | 技能功能 | 造成的傷害多一個公式，可以擲骰，在命中確定之後才算一次（打他打他！的 1d3）。 | 打他打他！ |
| `give_ap_cap` | 技能功能 | 指揮每回合能讓出的行動點上限加減（號令）。 | 號令 |
| `tease_hit` | 技能功能 | 誘惑攻擊的命中加減（繞指柔、共鳴 5）。 | 繞指柔；共鳴：socialite:5 |
| `tease_bonus` | 技能功能 | 誘惑攻擊的傷害加減，公式可以擲骰，在傷害要算的那一刻才問（媚態、繞指柔）。 | 媚態、繞指柔 |

## 五、反應的觸發（9 種）

| on | 掛點 | 誰（who） | 說明 | 使用的技能 |
|---|---|---|---|---|
| `attacked` | attack.before | self、adjacent、ally、self_or_ally、own_overlay、with_own_overlay | 有人攻擊（擲命中之前）時觸發；react 可以改這一擊的迴避、命中、讓重創變一般命中，或改打自己的無人機（redirect）。 | 掩護飛行、攔截 |
| `hit` | attack.hit | self、adjacent、ally、self_or_ally、own_overlay、with_own_overlay、foe_by_self | 命中已確定、傷害還沒算時觸發（if 可限 wound 或 crit）；react 可以讓這一擊無效（negate）、讓重創變一般命中、改穿甲，或讓被打的人事後換位（then_move）。 | 獵殺節奏、替身、擋 |
| `after` | attack.after | self、adjacent、near、ally、self_or_ally、own_overlay、with_own_overlay、foe_by_self | 一次攻擊結算完之後觸發（if 可限 miss、hit、crit、melee、bridged）；沒有 react，只做 do 的效果（反擊、還給你～）。 | 還給你～、敢打我家孩子？、手手拿開、欺負人家要賠喔 |
| `hp_half` | hp_half 掃描 | self、near | 某人第一次生命低於一半時觸發（每人每場一次）；只做 do 的效果（死線、不痛不痛）。 | 死線、不痛不痛 |
| `overload` | overload | self、ally、self_or_ally、foe_by_self | 某人過載時觸發；react.keep_turn 可以讓他不失去下一個回合（急凍），也可以做 do（逆流、謝謝招待）。 | 急凍、逆流、謝謝招待 |
| `checked` | check.before | self、ally、self_or_ally | 有人對他擲檢定、擲骰之前觸發（if 是檢定的標籤，例如 hack）；react.dc 加這一次的難度（偷看是不行的喔）。 | 偷看是不行的喔 |
| `out_before` | out.before | self、ally、self_or_ally | 有人即將退出（倒下、餘韻疊滿過載、被制伏）時觸發；react.prevent 可以擋下指定的方式（保釋、還不准睡、不讓你帶走）。 | 還不准睡、不讓你帶走、保釋 |
| `ally_attacked` | attack.before（舊寫法） | — | 舊的字串寫法：隊友被攻擊、擲命中之前觸發（小心後面！）；可以加迴避或朝攻擊者開一槍。 | 小心後面！ |
| `ally_attacked_adjacent` | attack.before（舊寫法） | — | 舊的字串寫法：只有和自己相鄰的隊友被攻擊時觸發（掩護射擊）。 | 掩護射擊 |

trigger.who 的意思：

| who | 意思 |
|---|---|
| `self` | 被打、過載、被檢定、要退出的是自己。 |
| `adjacent` | 是和自己相鄰、而且不是自己的隊友。 |
| `near` | 是自己或相鄰的隊友（距離不超過 1 格）。 |
| `ally` | 是自己以外的任何隊友。 |
| `self_or_ally` | 是自己或任何一名隊友。 |
| `own_overlay` | 被打的是自己放出的無人機（替身）。 |
| `with_own_overlay` | 被打的人（自己或隊友）那一格掛著自己的一台無人機（reach 可放寬到相鄰）。 |
| `foe_by_self` | 事情是自己造成的（自己打中的、讓敵人過載的）。 |

react 能改的東西（依 on 分）：

| 鍵 | 可用的 on | 說明 | 使用的技能 |
|---|---|---|---|
| `evade` | attacked | 這一擊對被打的人的迴避加減。 | — |
| `hit` | attacked | 這一擊的命中加減。 | 掩護飛行 |
| `redirect` | attacked | 改打自己的一台無人機（overlay），照無人機的迴避與護甲算。 | 攔截 |
| `reach` | attacked | 擋槍的無人機和被打的人可以差幾格（0～3）。 | 攔截 |
| `no_wound` | attacked / hit | 把這一擊的重創改成一般的命中。 | 擋 |
| `negate` | hit | 這一擊不造成傷害、不重創、不推拉（遮蔽照樣受傷）。 | 替身 |
| `pierce` | hit | 這一擊的穿甲加減（獵殺節奏）。 | 獵殺節奏 |
| `then_move` | hit | 這一擊結算完之後，被打的人換到相鄰的一格（替身），要和 negate 一起寫。 | 替身 |
| `keep_turn` | overload | 過載的人不失去下一個回合。 | 急凍 |
| `dc` | checked | 這一次檢定的難度加減。 | 偷看是不行的喔 |
| `prevent` | out_before | 擋下指定方式的退出（down、burnout、subdued）。 | 還不准睡、不讓你帶走、保釋 |

## 六、條件（37 個）

| 鍵 | 說明 | 使用的技能數 |
|---|---|---|
| `when.wield` | 手上要拿著某類武器（class 或特性）。 | 6 |
| `when.mag_min` | 彈匣裡要有至少幾格。 | 0 |
| `when.hull` | true 要在機甲狀態，false 不能在機甲狀態（機甲是 M6，現在永遠不成立）。 | 1 |
| `when.stance` | 要先開著某個姿態。 | 1 |
| `when.slot` | 自己要站在指定的格。 | 0 |
| `when.node_taken` | 要先拿下一個控制節點（或指定種類的節點）。 | 3 |
| `when.wounded` | 自己是重傷（生命低於一半）。 | 2 |
| `when.first_round` | 只在第一回合有效；只有 mods 的 when 能寫，技能本身要限第一回合用 use.first_round。 | 6 |
| `when.in_cover` | 自己所在的格有效遮蔽至少 1 級（含堡壘姿態的 cover_level）。僅限 mods 的 when。 | 0 |
| `when.other_exposed` | 對手站在暴露的格子。僅限 mods 的 when。 | 0 |
| `when.other_cyber` | 對手有義體。僅限 mods 的 when。 | 2 |
| `when.other_status` | 對手帶著指定的狀態。僅限 mods 的 when。 | 1 |
| `when.other_contract` | 對手有契約義體（授權鎖）。僅限 mods 的 when。 | 1 |
| `when.target_near` | 對象是自己或相鄰一格的隊友；問花費時沒有對象，當成成立。僅限 mods 的 when。 | 2 |
| `when.first_attack` | 這一場自己還沒發動過任何攻擊。僅限 mods 的 when。 | 1 |
| `needs.bridged` | 目標要有橋（true）或不能有橋（false）。 | 9 |
| `needs.cyber` | 目標要有義體（true）或不能有義體（false）。 | 5 |
| `needs.status` | 目標要帶著指定的狀態（其中任何一個）。 | 1 |
| `needs.no_rank` | 不能對指定位階（雜兵、精英、首領）的目標用。 | 2 |
| `needs.rank` | 只能對指定位階的目標用。 | 3 |
| `needs.wounded` | 目標要是重傷。 | 2 |
| `needs.afterglow` | 目標要疊著至少幾層餘韻。 | 2 |
| `needs.tag` | 目標要帶著指定的標籤。 | 0 |
| `needs.cache_tag` | 目標的快取格裡要有帶指定標籤的道具（引爆要有爆裂物）。 | 1 |
| `needs.implant_off` | 目標身上已經有一件被干擾的義體。 | 1 |
| `needs.any` | 幾組條件成立任何一組就算（「重傷，或疊著餘韻」）。 | 1 |
| `range` | meat.range（與 picks、trigger.by 的 range）：[近, 遠] 的距離限制，不在範圍裡灰掉並說明現在的距離。 | 9 |
| `trigger.by` | 反應的 trigger.by：做這件事的人（攻擊者、讓他過載的人）要符合 needs，並且在 range 的距離內。 | 1 |
| `if.hit` | 效果的 if：上一筆攻擊命中了才做。 | 3 |
| `if.miss` | 效果的 if：上一筆攻擊沒命中才做。 | 0 |
| `if.crit` | 效果的 if：上一筆攻擊打出要害才做。 | 0 |
| `if.downed` | 效果的 if：上一筆讓目標倒下了才做。 | 1 |
| `if.overloaded` | 效果的 if：上一筆讓目標過載了才做。 | 0 |
| `if.ok` | 效果的 if：上一筆檢定成功才做。 | 8 |
| `if.fail` | 效果的 if：上一筆檢定失敗才做。 | 0 |
| `if.first_round` | 效果的 if：只在第一回合做。 | 2 |
| `if.not_first_round` | 效果的 if：不是第一回合才做。 | 1 |

## 七、消耗與次數（use，13 個鍵）

| 鍵 | 說明 | 使用的技能數 |
|---|---|---|
| `use.ap` | 消耗的行動點（沒寫行動點也沒寫別的池時預設 1）。 | 111 |
| `use.ram` | 消耗的 RAM。 | 14 |
| `use.ram_all_min` | 花掉手上全部的 RAM，至少要有這麼多；花掉的數字是公式裡的 spent。 | 1 |
| `use.cash` | 消耗的現金（公式，例如 grade*500）；戰鬥結束時差額寫回。 | 2 |
| `use.favor` | 消耗一個人情（small、mid、big）。 | 3 |
| `use.per_turn` | 每回合最多幾次（可與 group 合併成一組）。 | 21 |
| `use.per_fight` | 每場最多幾次。 | 40 |
| `use.per_commission` | 每件委託最多幾次（次數記在角色身上）。 | 1 |
| `use.first_round` | 只能在第一回合用。 | 7 |
| `use.not_first_round` | 第一回合不能用。 | 1 |
| `use.group` | 共用每回合次數的一組（誘惑攻擊與看這邊♡共用）。 | 4 |
| `use.slot` | 預備與日常花幾個時段。 | 7 |
| `use.note` | 給人看的說明文字，不參與計算。 | 0 |

## 八、落點（27 個）

| who／target | 範圍 | 說明 | 使用的技能數 |
|---|---|---|---|
| `target` | 效果的 who | 這一筆落在玩家選的目標（預設）。 | 1 |
| `self` | 效果的 who | 落在做的人自己。 | 13 |
| `allies` | 效果的 who | 我方在場的每個人，逐人各做一次。 | 6 |
| `others` | 效果的 who | 我方在場、扣掉自己的每個人。 | 0 |
| `adjacent` | 效果的 who | 和做的人站位差 1 的隊友。 | 0 |
| `near` | 效果的 who | 自己加上相鄰的隊友。 | 1 |
| `foes` | 效果的 who | 敵方在場的每個人。 | 1 |
| `foes_bridged` | 效果的 who | 敵方有橋的每個人。 | 1 |
| `foe_overlays` | 效果的 who | 敵方每一台沒被擊落的掛著的東西，逐台各做一次。 | 0 |
| `foe_overlay` | 效果的 who | 敵方沒被擊落的一台掛著的東西：玩家選的（pick.overlay），沒選就是被瞄準的或最前面的一台。 | 1 |
| `slot` | 效果的 who | 目標那一格上的人。 | 1 |
| `area` | 效果的 who | 目標那一格加玩家選的相鄰一格上的每個人與每一台掛著的東西。 | 0 |
| `attacker` | 效果的 who | 反應裡正在攻擊的人。 | 4 |
| `victim` | 效果的 who | 反應裡被打的人。 | 0 |
| `pick` | 效果的 who | pick:<鍵>：玩家在 picks 裡選的那個單位。 | 5 |
| `enemy` | 技能的 target | 技能的目標是一個敵人。 | 34 |
| `ally` | 技能的 target | 技能的目標是一名隊友（不含自己）。 | 3 |
| `self` | 技能的 target | 技能的目標是自己。 | 1 |
| `ally_slot` | 技能的 target | 技能的目標是我方的一格。 | 1 |
| `enemy_slot` | 技能的 target | 技能的目標是敵方的一格。 | 0 |
| `none` | 技能的 target | 技能沒有目標。 | 6 |
| `ally_or_self` | 技能的 target | 技能的目標是自己或一名隊友。 | 2 |
| `near` | 技能的 target | 技能的目標是自己或相鄰一格的隊友。 | 6 |
| `downed_near` | 技能的 target | 技能的目標是相鄰一格因生命歸零倒下的隊友。 | 1 |
| `foe_slot` | 技能的 target | 技能的目標是敵方的一格（守著、投擲用）。 | 1 |
| `own_overlay` | 技能的 target | 技能的目標是自己放出的一台無人機。 | 6 |
| `foe_overlay` | 技能的 target | 技能的目標是敵方掛著的一台東西（接管）。 | 1 |

## 九、技能格式的其他鍵（39 個）

| 鍵 | 說明 | 使用的技能數 |
|---|---|---|
| `meat.target` | 技能的目標種類：enemy、ally、self、ally_slot、enemy_slot、none、ally_or_self、near、downed_near、foe_slot、own_overlay、foe_overlay。 | 0 |
| `meat.attack` | 舊寫法的攻擊：aimed、hit、spend、min_mag、dice、suppress、at、free_mag（連射、壓制、看我的！）。 | 7 |
| `meat.apply` | 舊寫法：對目標加上一個或幾個狀態（標記）。 | 2 |
| `meat.free_move` | 舊寫法：兩名相鄰隊友不花行動點對調位置（換個位子嘛）。 | 1 |
| `meat.cost` | 舊寫法：某個技能的行動點改成幾點，可限每回合幾次（定點射）。 | 1 |
| `meat.weapon_cost` | 舊寫法：帶某個武器特性的攻擊行動點改成幾點（定點射）。 | 1 |
| `meat.evade` | 舊寫法：隊友被攻擊時替他加迴避（小心後面！）。 | 1 |
| `meat.on_hit` | 舊寫法：反擊命中時，原本那一擊的命中再加減（掩護射擊）。 | 1 |
| `meat.give_ap` | 指揮：把自己的行動點讓給隊友，每回合最多 1＋階數一半點（人面）。 | 1 |
| `meat.call` | 叫人：叫一個沒上場的人做支援射擊、補或拆遮蔽、回復、排感載（人面）。 | 1 |
| `meat.instinct` | 戰鬥直覺：開戰分配點數、每回合可重分配。 | 1 |
| `meat.pending` | 這個技能現實的效果還沒寫（等後面的批次），格式檢查放行但不註冊成行動。 | 9 |
| `meat.picks` | 除了目標以外要玩家選的東西（foe、ally、ally_slot、foe_slot、choice、drone、foe_overlay）。 | 17 |
| `meat.choose` | 玩家二選一或三選一的用法，每個用法有自己的 do、when、needs。 | 8 |
| `meat.do` | 效果清單，每筆是 { op, who?, if?, ... }，由效果的登錄表執行。 | 0 |
| `meat.mods` | 被動、姿態的修正清單，每筆是 { kind, value, tags?, who?, when?, per_fight?, per_turn?, ... }。 | 0 |
| `meat.trigger` | 反應的觸發：{ on, who, if?, by? }，或舊的字串寫法。 | 0 |
| `meat.react` | 反應能改的東西（evade、hit、redirect、no_wound、negate、keep_turn、dc、prevent……）。 | 0 |
| `meat.do_on` | 姿態開啟時做的效果。 | 2 |
| `meat.do_off` | 姿態關閉時做的效果。 | 2 |
| `meat.tags` | 這個技能的行動多帶的標籤（例如 drone_link、quickhack）。 | 2 |
| `meat.action_tags` | 這個技能的行動多帶的花費標籤（治療類寫 heal），花費修正與 action.done 都認得。 | 4 |
| `meat.pool` | 開戰時資源池上限與回復的加減（RAM、感載）。 | 3 |
| `meat.alter` | 改寫另一個技能的 meat（點放、彈幕、我有認識的人），可以加成玩家選的選項。 | 3 |
| `meat.ransom` | 保釋：全隊倒下的戰敗事件多一個「被贖回」，付指定的現金。 | 1 |
| `meat.on_start` | 開戰時做一次的效果（黑市門路）。 | 1 |
| `meat.on_give_ap` | 姿態開著時，指揮把行動點讓給隊友之後對他做的效果（號令）。 | 1 |
| `meat.mask` | 入戲：戴著面具到第 rounds 回合為止，AI 挑目標時不挑她。 | 1 |
| `meat.tease` | 誘惑攻擊：這個技能的行動就是一次誘惑攻擊，可帶 hit、bonus、on_ok、on_overload、targets。 | 6 |
| `prep` | 預備（kind: prep）：{ slot, scope: next_battle\|commission, meat: { mods?, do? } }，下一場現實戰鬥帶進去。 | 7 |
| `daily` | 日常（kind: daily）：戰鬥外的效果，只有說明文字；格式還寫不出來，等 M4。 | 7 |
| `resonance.effect` | 共鳴的效果（封閉清單）：initiative、free_move、mods、pool、load_max、hp_max、pending。 | 0 |
| `pick.foe` | picks 的種類：玩家要選一個敵人。 | 6 |
| `pick.ally` | picks 的種類：玩家要選一名隊友。 | 2 |
| `pick.ally_slot` | picks 的種類：玩家要選我方的一格。 | 4 |
| `pick.foe_slot` | picks 的種類：玩家要選敵方的一格。 | 0 |
| `pick.choice` | picks 的種類：玩家要在幾個用法裡選一個。 | 6 |
| `pick.drone` | picks 的種類：玩家要選單位上的哪一台無人機。 | 1 |
| `pick.foe_overlay` | picks 的種類：玩家要選敵方掛著的哪一台東西。 | 1 |

## 十、八棵樹逐技能

### 槍手（槍手：戰鬥直覺）

技能：完成 25、近似 1、寫不出來 1、等後面批次 0、無現實效果 0。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 每場戰鬥開始時，你的先攻 +3。 | 完成 | effect.initiative +3，開戰時先攻 +3。 |
| 2 | 每場戰鬥你第一次換位不花行動點。 | 完成 | effect.free_move，每場第一次換位不花行動點。 |
| 3 | 你射擊站在暴露格子上的敵人時，命中 +1。 | 寫不出來 | 資料仍標 pending；格式現在寫得出來（mods 的 hit +1、when.other_exposed），只是還沒補進資料與測試。 |
| 4 | 你站在掩體或半掩體的格子上時，迴避 +1。 | 寫不出來 | 資料仍標 pending；格式現在寫得出來（mods 的 evade +1、when.in_cover），只是還沒補進資料與測試。 |
| 5 | 戰鬥直覺可以分配的點數 +1。 | 完成 | effect.mods instinct_points +1。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 戰鬥直覺 | `sk_gunner_instinct` | signature | 完成 | `meat.instinct` | 招牌（meat.instinct）：開戰分配點數、戰鬥中每回合花 1 行動點重分配；引擎讀 preset.instinct，但開打前的指定還沒有報告與介面寫入。 |
| 1 | 要害射擊 | `sk_gunner_aimed_shot` | active | 完成 | `meat.attack`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 掩護射擊 | `sk_gunner_cover_fire` | reaction | 完成 | `meat.attack`、`meat.on_hit`、`trigger.ally_attacked_adjacent` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 連射控制 | `sk_gunner_burst` | active | 完成 | `meat.attack`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 看我的！ | `sk_gunner_watch_me` | active | 完成 | `meat.attack`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 點放 | `sk_gunner_tap` | passive | 完成 | `meat.alter` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：點放：連射時可以只花彈匣 2 格，傷害照 2 格算，壓制的 DC 照花掉 3 格算（16）。 |
| 2 | 定點射 | `sk_gunner_point_shot` | passive | 完成 | `meat.cost`、`meat.weapon_cost` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 壓制姿態 | `sk_gunner_suppress_stance` | stance | 完成 | `meat.attack` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 構裝精通 | `sk_gunner_loadout_mastery` | passive | 完成 | `mod.action_ap` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 就是你了 | `sk_gunner_thats_you` | active | 完成 | `meat.apply`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 走開啦 | `sk_gunner_back_off` | active | 完成 | `attack`、`if.hit`、`shift`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 幫槍槍保養 | `sk_gunner_gun_care` | prep | 寫不出來 | `prep` | 預備的效果（主武器彈匣容量 +1、最多 4 格）寫不出來：資料只有說明文字、沒有 prep.meat，格式也沒有改彈匣容量上限的修正；表格現實欄是「—」，效果寫在預備段。 |
| 3 | 穿透 | `sk_gunner_pierce` | active | 完成 | `attack`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 跑位射擊 | `sk_gunner_run_and_gun` | active | 完成 | `attack`、`cover_temp`、`meat.picks`、`move`、`pick.ally_slot`、`target.enemy`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 死線 | `sk_gunner_deadline` | reaction | 完成 | `attack`、`buff`、`mod.hit`、`mod.save`、`trigger.hp_half`、`when.wounded`、`who.attacker`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 獵眼 | `sk_gunner_hunter_eye` | passive | 完成 | `mod.crit_margin`、`mod.hit` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 掩護撤退 | `sk_gunner_covering_retreat` | active | 完成 | `attack`、`if.hit`、`meat.picks`、`move`、`pick.ally`、`pick.ally_slot`、`status`、`target.enemy`、`who.pick` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 獵殺節奏 | `sk_gunner_kill_rhythm` | passive | 完成 | `ap`、`react.pierce`、`trigger.hit`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 彈幕 | `sk_gunner_barrage` | stance | 近似 | `meat.alter`、`when.stance` | 只用 alter 改連射控制的壓制（相鄰一格、DC +2），輕機槍的掃射不吃彈幕，比設計書窄。 |
| 4 | 心流 | `sk_gunner_flow` | active | 完成 | `buff`、`mod.instinct_cap`、`mod.instinct_free`、`mod.instinct_points`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 下一個！ | `sk_gunner_next_one` | active | 完成 | `attack`、`if.downed`、`meat.picks`、`pick.foe`、`target.enemy`、`who.pick` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 不准動喔 | `sk_gunner_dont_move` | active | 完成 | `attack`、`target.foe_slot`、`ward` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：不准動喔：守著敵方的一格，站在那一格上的人第一次換位、補位或攻擊時，立刻朝他射一槍。 |
| 5 | 一槍定局 | `sk_gunner_one_shot` | active | 完成 | `attack`、`range`、`target.enemy`、`when.wield` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 火力牆 | `sk_gunner_fire_wall` | active | 完成 | `buff`、`meat.attack`、`mod.evade`、`target.enemy`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 子彈時間 | `sk_gunner_bullet_time` | active | 完成 | `buff`、`load`、`mod.aim_all`、`mod.ap_regen`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 人槍合一 | `sk_gunner_gun_unity` | passive | 完成 | `mod.crit_margin`、`mod.hit`、`mod.pierce` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 還給你～ | `sk_gunner_right_back` | reaction | 完成 | `attack`、`trigger.after`、`who.attacker` | 照設計書的現實欄寫成，沒有已知的差異。 |

### 機師（機師：編隊）

技能：完成 15、近似 6、寫不出來 0、等後面批次 6、無現實效果 0。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 你的無人機耐久 +5。 | 完成 | effect.mods overlay_hp +5，無人機耐久 +5。 |
| 2 | 你的無人機護甲 +1。 | 完成 | effect.mods overlay_armor +1，無人機護甲 +1。 |
| 3 | 你的機甲的機體耐久 +5。 | 等後面批次（M6） | 機甲的機體耐久 +5，要機甲，effect 標 pending，等 M6。 |
| 4 | 你指揮無人機時，命中 +1。 | 完成 | effect.mods hit +1（標籤 drone），指揮無人機時命中 +1。 |
| 5 | 你的無人機迴避 +1。 | 完成 | effect.mods overlay_evade +1，無人機迴避 +1。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 編隊 | `sk_pilot_formation` | signature | 近似（M6） | `meat.tags`、`mod.hit` | 無人機的連結與指揮（mods hit、tags drone_link）與叫載具當掩體都做了；啟動機甲與回灌要機甲，留到 M6。 |
| 1 | 乖孩子去吧 | `sk_pilot_good_kid` | active | 完成 | `drone.act`、`drone.deploy`、`meat.picks`、`pick.drone`、`pick.foe`、`target.ally_slot` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 掩護飛行 | `sk_pilot_cover_flight` | reaction | 完成 | `react.hit`、`trigger.attacked` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 多工連結 | `sk_pilot_multitask` | passive | 完成 | `mod.overlay_cap` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 再一次嘛 | `sk_pilot_one_more` | active | 完成 | `drone.act`、`meat.picks`、`pick.foe`、`target.own_overlay` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 去陪陪他 | `sk_pilot_accompany` | active | 完成 | `buff`、`drone.move`、`meat.picks`、`mod.evade`、`pick.ally_slot`、`target.own_overlay`、`who.slot` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 雙聯火控 | `sk_pilot_dual_fire` | active | 近似（M6） | `drone.act`、`meat.attack`、`target.enemy` | 射擊加同一格無人機同時射擊已做；機甲狀態下兩件武器一起開火、命中各 −1 要機甲，留到 M6。 |
| 2 | 護航編隊 | `sk_pilot_escort` | stance | 完成 | `drone.escort`、`meat.do_off`、`meat.do_on` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 回灌緩衝 | `sk_pilot_feedback_buffer` | passive | 近似（M6） | `mod.overlay_backlash` | 無人機被擊落時感載少 3 點（overlay_backlash −3）已做；機甲回灌 20% 降到 15% 要機甲，留到 M6。 |
| 2 | 修修就好 | `sk_pilot_quick_repair` | active | 完成 | `drone.move`、`drone.repair`、`meat.picks`、`pick.ally_slot`、`target.own_overlay` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 撞過去！ | `sk_pilot_ram_in` | active | 近似（M6） | `drone.ram`、`meat.picks`、`pick.foe`、`target.own_overlay`、`who.pick` | 沒有機甲時讓無人機撞上目標（drone.ram）已做；機甲在第 1 格近戰、遮蔽傷害加倍要機甲，留到 M6。 |
| 3 | 突擊姿態 | `sk_pilot_assault` | stance | 近似（M6） | `mod.dice`、`mod.evade`、`mod.hit`、`when.hull`、`when.wield` | 命中 +1、迴避 −1 已做；機甲狀態下近戰多一顆骰已寫成 when.hull，現在沒有機甲所以永遠不生效，等 M6。 |
| 3 | 堡壘姿態 | `sk_pilot_bastion` | stance | 完成 | `meat.do_off`、`meat.do_on`、`mod.armor`、`mod.cover_level`、`status`、`unstatus` | 護甲 +1、不能自己換位（rooted 狀態）、後面那一格遮蔽高一級（cover_level，who: behind）都已寫出；測試資料裡的舊註解說「後面那一格」寫不出來，已被 M1b-core-fix3 補上。 |
| 3 | 同步衝刺 | `sk_pilot_sync_dash` | active | 等後面批次（M6） | `meat.pending` | 整個效果都要機甲，meat 標 pending，等 M6。 |
| 3 | 飽和攻擊 | `sk_pilot_saturation` | active | 完成 | `drone.act`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 煙煙罩著你 | `sk_pilot_smoke_cover` | active | 完成 | `drone.smoke`、`target.own_overlay` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 神經硬化 | `sk_pilot_neural_hardening` | passive | 等後面批次（M6） | `meat.pending` | 機甲狀態下感載上限 +8，meat 標 pending，等 M6。 |
| 4 | 遠端火力 | `sk_pilot_remote_fire` | active | 等後面批次（M6） | `meat.pending` | 要待命中的機甲遠端開火，meat 標 pending，等 M6。 |
| 4 | 攔截 | `sk_pilot_intercept` | reaction | 完成 | `react.reach`、`react.redirect`、`trigger.attacked` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 共鳴駕駛 | `sk_pilot_resonant_pilot` | passive | 等後面批次（M6） | `meat.pending` | 要機甲與副駕同步，meat 標 pending，等 M6。 |
| 4 | 精準導引 | `sk_pilot_precision` | active | 完成 | `drone.act`、`meat.picks`、`pick.foe`、`target.own_overlay` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 整備 | `sk_pilot_overhaul` | prep | 近似（M6） | `mod.overlay_armor`、`mod.overlay_hp`、`prep` | 預備：每台無人機耐久 +6、護甲 +1 已做（overlay_hp、overlay_armor）；機體耐久 +10 要機甲，留到 M6。 |
| 5 | 蜂群 | `sk_pilot_swarm` | active | 完成 | `drone.act`、`drone.deploy`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 穹頂 | `sk_pilot_dome` | active | 完成 | `buff`、`drone.guard`、`mod.evade`、`target.none`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 女武神 | `sk_pilot_valkyrie` | active | 等後面批次（M6） | `meat.pending` | 要機甲與同步檔位，meat 標 pending，等 M6。 |
| 5 | 敢打我家孩子？ | `sk_pilot_defend_kids` | reaction | 完成 | `drone.act`、`trigger.after`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：who: self：被打的那一台可能就在這一擊被擊落了（核心不對已經擊落的做效果），所以不落在它身上；「其餘的」是照 ctx.target 排除那一台。 |
| 5 | 人機一體 | `sk_pilot_man_machine` | passive | 等後面批次（M6） | `meat.pending` | 機甲持續時間與命中加成，meat 標 pending，等 M6。 |

### 改造師（改造師：手術刀）

技能：完成 17、近似 7、寫不出來 0、等後面批次 3、無現實效果 0。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 你用的醫療道具（急救凝膠、冷卻劑）效果多 4 點：回的生命值多 4，或排掉的感載多 4。 | 完成 | effect.mods heal_dealt、vent_dealt 各 +4（標籤 medical）。 |
| 2 | 每場戰鬥你第一次換位不花行動點。 | 完成 | effect.free_move，每場第一次換位不花行動點。 |
| 3 | 醫療檢定 +2。 | 近似（M4） | 戰鬥裡沒有醫療檢定，寫成帶 medicine 標籤的 save +2，等 M4 的醫療檢定帶上標籤才生效。 |
| 4 | 感載上限 +4。 | 完成 | effect.load_max +4，感載上限 +4（有橋的人才加）。 |
| 5 | 生命上限 +5。 | 完成 | effect.hp_max +5，生命上限 +5。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 手術刀 | `sk_medic_scalpel` | signature | 近似（M4） | `mod.action_ap`、`mod.heal_dealt`、`mod.hit`、`when.other_cyber`、`when.target_near`、`when.wield` | 急救只花 1 點、回復加樹階、義體學代替格鬥都已做；日常的「自己動刀安裝義體沉溺成本減免」要義體系統，留到 M4。 |
| 1 | 戰場急救 | `sk_medic_first_aid` | active | 完成 | `cleanse`、`heal`、`meat.action_tags`、`target.near` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 拆解 | `sk_medic_dismantle` | active | 近似 | `check`、`if.ok`、`implant`、`needs.cyber`、`range`、`target.enemy` | 對有義體的目標近戰檢定、讓一件義體失效已做；設計書說對無人機與機器一樣有效，目前拆解對無人機沒有效果。 |
| 1 | 呼呼不燙了 | `sk_medic_cool_down` | active | 完成 | `afterglow`、`meat.choose`、`needs.afterglow`、`needs.bridged`、`target.near`、`vent` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 縫合手 | `sk_medic_suture` | passive | 完成 | `mod.heal_dealt` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 不痛不痛 | `sk_medic_painless` | reaction | 完成 | `buff`、`cleanse`、`heal`、`mod.hit`、`mod.save`、`trigger.hp_half`、`when.wounded` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：自己或相鄰的隊友第一次進入重傷：回 2d6、止血，到他下一回合結束前不吃重傷的 −2（重傷還在的時候命中與檢定各 +2）。 |
| 1 | 手術 | `sk_medic_surgery` | daily | 等後面批次（M4） | `daily` | 日常（自己動刀安裝、拆卸、修理義體），格式還寫不出日常，等 M4 的義體系統。 |
| 2 | 超頻 | `sk_medic_overclock` | active | 近似 | `buff`、`if.ok`、`implant`、`load`、`needs.cyber`、`target.near` | 義肢、智慧槍的下一次攻擊 +2、皮下裝甲護甲 +2、結束時感載 +4 都已做；義眼「下一次攻擊把遮蔽當低一級」還沒有（缺 boost_eye）。 |
| 2 | 拉回來 | `sk_medic_pull_back` | active | 完成 | `revive`、`target.downed_near` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 找縫 | `sk_medic_find_gap` | active | 完成 | `attack`、`branch`、`needs.implant_off`、`range`、`target.enemy`、`when.wield` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 拆拆好好玩 | `sk_medic_dismantle_fun` | passive | 完成 | `mod.hit`、`mod.save` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：拆解、找縫、卸下、短路、拆光的命中 +1（帶 dismantle 標籤的攻擊與檢定）；你動手制伏時格鬥檢定 +1。 |
| 2 | 巡房 | `sk_medic_rounds` | stance | 完成 | `mod.action_ap`、`when.target_near` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：開著時，每回合第一次對相鄰隊友用急救（道具）或戰場急救不花行動點。 |
| 3 | 卸下 | `sk_medic_take_off` | active | 完成 | `check`、`if.ok`、`implant`、`needs.cyber`、`range`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 排好隊喔 | `sk_medic_line_up` | active | 完成 | `heal`、`meat.action_tags`、`target.none`、`who.near` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：排好隊喔治療的都是隊友：action_tags 多帶 other，名醫的「治療隊友」才認得。 |
| 3 | 急凍 | `sk_medic_flash_freeze` | reaction | 近似（M6） | `react.keep_turn`、`trigger.overload` | 過載的隊友不失去下一回合（react.keep_turn）已做；設計書另說機甲與加速義體的同步不斷開，機甲同步等 M6，加速義體同步目前沒有對應機制。 |
| 3 | 解剖 | `sk_medic_dissection` | daily | 等後面批次（M4） | `daily` | 日常（戰後從倒下的敵人身上拆下義體或零件），格式寫不出日常，等 M4。 |
| 3 | 解鎖匠 | `sk_medic_locksmith` | passive | 近似（M4） | `mod.hit`、`mod.save`、`when.other_contract`、`when.other_cyber`、`when.wield` | 戰鬥裡對有義體的敵人近戰命中 +1、拆解類打契約義體再 +2 已做；日常的「解授權鎖檢定 +2」留到 M4。 |
| 4 | 短路 | `sk_medic_short_circuit` | active | 完成 | `attack`、`branch`、`if.hit`、`needs.cyber`、`range`、`status`、`target.enemy`、`when.wield` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 戰地手術 | `sk_medic_field_surgery` | active | 近似（M4） | `heal`、`meat.action_tags`、`meat.choose`、`target.near`、`wound` | 處理一個重創並回 2d6 已做；「替他裝上快取格裡的一件義體」要義體系統，留到 M4。 |
| 4 | 還不准睡 | `sk_medic_not_sleep_yet` | reaction | 完成 | `react.prevent`、`trigger.out_before` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 主刀 | `sk_medic_chief_surgeon` | passive | 完成 | `mod.heal_dealt`、`mod.wound_grade` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：回復多 4 點；相鄰一格的隊友受到重創時，重的那一級改成輕的（wound_grade −1，落在被打的人身上）。 |
| 4 | 工坊 | `sk_medic_workshop` | daily | 等後面批次（M4） | `daily` | 日常（組裝義體、武器、護甲檢定 +2），格式寫不出日常，等 M4。 |
| 5 | 拆光 | `sk_medic_strip_all` | active | 完成 | `check`、`if.ok`、`implant`、`needs.cyber`、`range`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 全面翻修 | `sk_medic_overhaul` | active | 近似 | `afterglow`、`branch`、`heal`、`meat.action_tags`、`needs.wounded`、`target.near`、`wound` | 「生命至少回到上限的一半」寫成連續幾次有條件的回復直到不是重傷為止（近似）；清掉所有重創、消兩層餘韻都照設計書。 |
| 5 | 極限超頻 | `sk_medic_extreme_overclock` | active | 完成 | `afterglow`、`buff`、`mod.ap_regen`、`mod.hit`、`target.near` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：全身的義體超頻 3 回合：每回合回復的行動點 +1、命中 +1，結束時一層餘韻（只用 buff，不給 boost_ 狀態：狀態的 +2 會和這裡的 +1 疊成 +3）。 |
| 5 | 名醫 | `sk_medic_famed_doctor` | passive | 完成 | `mod.action_ap`、`mod.heal_dealt` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：回復多 4 點；每回合第一次治療隊友（急救、戰場急救、排好隊喔、戰地手術）退還 1 點行動點。 |
| 5 | 手手拿開 | `sk_medic_hands_off` | reaction | 完成 | `check`、`if.ok`、`implant`、`shift`、`trigger.after`、`who.attacker` | 照設計書的現實欄寫成，沒有已知的差異。 |

### 潛網者（潛網者：主控）

技能：完成 17、近似 8、寫不出來 0、等後面批次 0、無現實效果 2。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 介面檢定 +2（快駭與管理行動都用介面）。 | 完成 | effect.mods save +2（標籤 hack），快駭的介面檢定 +2。 |
| 2 | 每場網內戰鬥你第一次換位不花行動點。 | 無現實效果 | 設計書寫的是網內戰鬥的第一次換位，現實沒有效果（測試資料沒有這一階）。 |
| 3 | RAM 上限 +1。 | 完成 | effect.pool ram.max +1，RAM 上限 +1。 |
| 4 | 感載上限 +4。 | 完成 | effect.load_max +4，感載上限 +4。 |
| 5 | 釘住的檢定 +2。 | 無現實效果 | 釘住的檢定是內海的蕾絲機制，現實沒有效果（測試資料沒有這一階）。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 主控 | `sk_ctrl` | signature | 完成 | `meat.pool`、`meat.tags`、`mod.save` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 破冰 | `sk_ice` | active | 完成 | `buff`、`hack.check`、`mod.firewall`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 偷看是不行的喔 | `sk_peek` | reaction | 完成 | `react.dc`、`trigger.checked` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：「你或一名隊友被快駭」：trigger.who 的 self_or_ally（M1b-core-fix2）。 |
| 1 | 接管 | `sk_take` | active | 完成 | `hack.check`、`hack.takeover`、`meat.choose`、`meat.picks`、`pick.choice`、`target.foe_overlay` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 迴圈 | `sk_loop` | active | 完成 | `hack.check`、`hack.dot`、`needs.bridged`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 我不在家喔 | `sk_netrunner_t1_6`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只在內海用，現實沒有效果（測試也不寫）。 |
| 1 | 頻寬 | `sk_band` | passive | 近似 | `meat.pool` | RAM 上限 +1 已做；「構裝槽 +1」在甲板上（deck.slots），技能格式沒有改甲板的鍵，寫不出來。 |
| 2 | 過熱 | `sk_heat` | active | 完成 | `hack.check`、`implant`、`load`、`needs.bridged`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 靜默 | `sk_silent` | stance | 近似（M3） | `mod.evade` | 迴避 +1 已做；「快駭追蹤各少 1」要追蹤度（ADR 0015 E9，M2、M3），這一波不做。 |
| 2 | 改寫地形 | `sk_rewrite` | active | 近似 | `cover`、`hack.check`、`hack.detonate`、`meat.choose`、`meat.picks`、`needs.cache_tag`、`pick.choice`、`target.enemy`、`when.node_taken`、`who.self` | 引爆、撤掉敵方掩體、放防爆門都已做；防爆門補的一級遮蔽只能落在自己那一格（choose 的每個用法吃同一個目標），不能選我方的任一格。 |
| 2 | 盯～ | `sk_focus` | passive | 完成 | `mod.save` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 逆流 | `sk_backflow` | reaction | 完成 | `pool`、`trigger.overload`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 灌頂 | `sk_inflow` | active | 近似 | `hack.check`、`load`、`meat.choose`、`meat.picks`、`needs.bridged`、`pick.choice`、`sink`、`target.enemy` | 神經版與快感版的感載、沉溺 +2 已做；快感版「定力檢定成功可以擋掉其中 1 點」寫不出來（sink 的 save 是成功就整筆擋掉），「要隊友先灌」的收尾限制也沒有寫。 |
| 3 | 後門 | `sk_backdoor` | prep | 完成 | `mod.action_ap`、`prep`、`when.first_round` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 封鎖 | `sk_lockdown` | active | 近似 | `cover`、`field`、`meat.choose`、`meat.picks`、`pick.choice`、`target.none`、`when.node_taken`、`who.self` | 關燈已做；「有節點時另外放一道防爆門」不能依節點自動加做，改寫成「關燈」與「關燈並放下防爆門」兩種用法讓玩家挑，且防爆門落在自己那一格。 |
| 3 | 謝謝招待 | `sk_thanks` | passive | 近似 | `pool`、`trigger.overload`、`who.self` | 設計書是「你的神經快駭讓目標過載時回 1 RAM」；overload 的反應分不出是不是神經快駭，所以寫成任何你讓敵人過載的都算，比設計書寬。 |
| 3 | 值機 | `sk_mutex` | stance | 完成 | `mod.save` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 傀儡 | `sk_puppet` | active | 近似 | `ap`、`hack.check`、`meat.choose`、`meat.picks`、`needs.status`、`pick.choice`、`shift`、`status`、`target.enemy` | 「動一下」只寫了推一格（沒有讓玩家選拉）、少 1 點行動點，「定住」用 pinned 狀態；比設計書少了推拉二選一。 |
| 4 | 看錯人囉 | `sk_mirror` | active | 完成 | `buff`、`mod.evade`、`target.ally_or_self` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 多工 | `sk_multi` | passive | 近似 | `mod.action_ap` | 每回合第一個快駭不花行動點已做；「構裝槽 +1」同頻寬，寫不出來。 |
| 4 | 群播 | `sk_cast` | active | 完成 | `ap`、`target.none`、`who.foes_bridged` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 不讓你帶走 | `sk_noleave` | reaction | 完成 | `react.prevent`、`trigger.out_before` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 黑冰 | `sk_black` | active | 完成 | `hack.check`、`load`、`needs.bridged`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 備份 | `sk_backup` | active | 完成 | `buff`、`mod.evade`、`target.none`、`unstatus`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 管理員 | `sk_admin` | active | 完成 | `cover`、`field`、`hack.takeover`、`meat.picks`、`pick.foe_overlay`、`target.none`、`when.node_taken`、`who.foe_overlay`、`who.foes` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：不用先選一台：關燈與降遮蔽照做，接管落在敵方的一台（who: foe_overlay，M1b-core-fix3；樹上寫「一台」）：玩家選的（pick.overlay）、沒選就是最前面的一台。 picks 的 kind: 'foe_overlay' 讓玩家選得到是哪一台（不必選：required false）。 |
| 5 | 根權限 | `sk_root` | passive | 完成 | `mod.action_ram` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 深潛 | `sk_netrunner_t5_27`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，這個姿態只在內海有效，現實沒有效果。 |

### 名媛（名媛：入戲）

技能：完成 18、近似 3、寫不出來 0、等後面批次 2、無現實效果 4。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 誘惑與表演的檢定 +2。 | 完成 | effect.mods save +2（標籤 tease）；戰鬥裡只有誘惑攻擊的檢定，表演檢定現實沒有。 |
| 2 | 感載上限 +4。 | 完成 | effect.load_max +4，感載上限 +4。 |
| 3 | 每場戰鬥第一次換位不花行動點（現實與內海）。 | 完成 | effect.free_move，每場第一次換位不花行動點。 |
| 4 | 輿論戰開場的手牌多 1 張。 | 無現實效果 | 輿論戰開場手牌，現實沒有效果。 |
| 5 | 誘惑攻擊的命中 +1（現實與內海）。 | 完成 | effect.mods tease_hit +1，誘惑攻擊命中 +1。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 入戲 | `sk_socialite_in_character` | signature | 近似（M2） | `meat.mask`、`meat.tease` | 面具（第一回合敵人不以她為目標）與誘惑攻擊都已做；「面具抵消豔名被認出來的懲罰」要豔名系統，留到 M2。 |
| 1 | 看這邊♡ | `sk_socialite_look_here` | active | 完成 | `meat.tease` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 替身 | `sk_socialite_stand_in` | reaction | 完成 | `react.negate`、`react.then_move`、`trigger.hit` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：替身（反應）：只在第一回合，第一次被命中時這一擊打在全息替身上，不受傷害，換到相鄰的一格。 |
| 1 | 讀人 | `sk_socialite_read_people` | prep | 等後面批次（M2） | `meat.pending`、`prep` | 預備：效果是對「他」的誘惑攻擊與檢定加成，要知道「他」是誰（名冊與傾向），meat 標 pending，等 M2。 |
| 1 | 戳戳你 | `sk_socialite_poke` | active | 完成 | `if.first_round`、`if.not_first_round`、`load`、`needs.bridged`、`range`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：戳戳你：對距離 2 以內有橋的敵人灌 4 點快感感載，不擲骰；第一回合 8 點。 |
| 1 | 我很清醒喔 | `sk_socialite_sober` | passive | 完成 | `mod.firewall` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：我很清醒喔：抵抗控制類快駭的檢定 +2。 |
| 1 | 跟我說嘛 | `sk_socialite_tell_me` | active | 完成 | `check`、`if.ok`、`needs.bridged`、`range`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：跟我說嘛：只在第一回合，距離 2 以內有橋的敵人，交涉對 10＋他的 mod(意志)＋定力；過了標記到她的下一回合（全隊打他命中 +2）。 |
| 2 | 不要走嘛 | `sk_socialite_stay` | active | 完成 | `buff`、`meat.tease`、`mod.hit` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：不要走嘛：誘惑攻擊；命中的話，到目標下一回合結束前，他攻擊她的命中 −2（掛在目標身上、只對她有效）。 |
| 2 | 偽裝 | `sk_socialite_disguise` | stance | 近似（M2） | `mod.hit`、`when.first_attack`、`when.first_round` | 開著時第一回合第一次攻擊命中 +2 已做；「戰鬥之前的滲透」（過門禁與盤問，表演 +2）是 M2 的滲透系統，沒有寫。 |
| 2 | 假身分 | `sk_socialite_false_identity` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只有輿論欄。 |
| 2 | 蜜罐 | `sk_socialite_honey_pot` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只有輿論欄。 |
| 2 | 我演得很像吧 | `sk_socialite_good_actor` | passive | 等後面批次（M2） | `meat.pending` | 現實效果是「開打前被識破的難度 +2」，屬於開打前的滲透，meat 標 pending，等 M2。 |
| 3 | 媚態 | `sk_socialite_charm_pose` | stance | 完成 | `mod.tease_bonus` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：媚態（姿態）：誘惑攻擊的傷害多 1d3。 |
| 3 | 換臉 | `sk_socialite_new_face` | active | 完成 | `buff`、`target.self`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：換臉：第一回合不能用；入戲的「不被當成目標」重新生效，到她的下一回合開始為止。 |
| 3 | 說服蕾絲 | `sk_socialite_persuade_lace` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只在內海與輿論有效。 |
| 3 | 銷魂 | `sk_socialite_swoon` | active | 完成 | `afterglow`、`meat.tease` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：銷魂：誘惑攻擊；這一下讓目標過載的話，他多疊一層餘韻。 |
| 3 | 第二張臉 | `sk_socialite_second_face` | passive | 完成 | `mod.no_wound`、`when.first_round` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：第二張臉：第一回合裡，打在她身上的重創改成一般的命中。 |
| 4 | 暈乎乎 | `sk_socialite_dizzy` | active | 完成 | `if.first_round`、`meat.tease`、`status` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：暈乎乎：誘惑攻擊，傷害多 1d6；第一回合用時，命中的目標同時暈眩。 |
| 4 | 入骨 | `sk_socialite_deep_in_role` | passive | 近似（M2） | `mod.evade`、`when.first_round` | 第一回合迴避 +2 已做；「開打前被識破的難度 +4」是 M2 的滲透系統，沒有寫。 |
| 4 | 頂替 | `sk_socialite_stand_in_for` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只在內海與輿論有效。 |
| 4 | 欺負人家要賠喔 | `sk_socialite_payback` | reaction | 完成 | `needs.bridged`、`range`、`tease`、`trigger.after`、`trigger.by`、`who.attacker` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：欺負人家要賠喔：被距離 2 以內有橋的敵人攻擊之後，對他做一次誘惑攻擊當反擊（不算每回合那一次、每場 2 次）。 |
| 4 | 千面 | `sk_socialite_thousand_faces` | prep | 完成 | `buff`、`prep`、`who.self` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：千面（預備，整個副本有效）：這個副本裡的每一場現實戰鬥，入戲的「第一回合不被當成目標」延長到第二回合。 |
| 5 | 傾城 | `sk_socialite_city_fall` | active | 完成 | `meat.tease` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：傾城：只在第一回合，距離 2 以內兩名有橋的目標各做一次誘惑攻擊，傷害各多 1d6。 |
| 5 | 謝幕 | `sk_socialite_curtain_call` | active | 完成 | `buff`、`mod.ai_target_pct`、`target.ally`、`when.first_round`、`who.self`、`who.target` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：謝幕：只在第一回合，她和一名隊友在這一回合不會被敵人當成目標。 |
| 5 | 眾生相 | `sk_socialite_everyone` | active | 完成 | `needs.bridged`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：眾生相：不花行動點；只在第一回合，一名有橋的敵人把她當成他的上司，他失去這一回合（首領照控制保護）。 |
| 5 | 繞指柔 | `sk_socialite_silk` | stance | 完成 | `mod.tease_bonus`、`mod.tease_hit` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：繞指柔（姿態）：誘惑攻擊命中 +1，傷害多 1d3。 |
| 5 | 這才是真的我 | `sk_socialite_the_real_me` | passive | 完成 | `meat.pool`、`mod.evade`、`when.first_round` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：這才是真的我：感載上限 +8（pool 的 load 就是感載上限）；第一回合迴避 +1。 |

### 掮客（掮客：人面）

技能：完成 19、近似 3、寫不出來 2、等後面批次 1、無現實效果 2。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 名冊的容量多 1 個人。 | 等後面批次（M2） | 名冊的容量多 1 個人，要名冊（M2），資料標 pending。 |
| 2 | 每場戰鬥第一次叫人不花行動點。 | 完成 | effect.mods action_ap −1（標籤 sk_fixer_face.call，每場 1 次），第一次叫人不花行動點。 |
| 3 | 和你相鄰的隊友迴避 +1（現實與內海）。 | 完成 | effect.mods evade +1（who adjacent），相鄰的隊友迴避 +1。 |
| 4 | 輿論戰開場的手牌多 1 張。 | 無現實效果 | 輿論戰開場手牌，現實沒有效果（資料目前標 pending）。 |
| 5 | 輔助面與派工的擲骰 +2。 | 等後面批次（M2） | 輔助面與派工的擲骰屬委託與名冊系統（M2），資料標 pending。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 人面 | `sk_fixer_face` | signature | 近似（M2） | `daily`、`meat.call`、`meat.give_ap` | 指揮（讓行動點）與叫人（三選一）已做；叫人的支援射擊用暫定的固定數字，不是名冊上那個人的資料，戰後的出場費與人情也沒有記，要等名冊（M2）。 |
| 1 | 集火 | `sk_fixer_focus_fire` | active | 完成 | `meat.apply`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 小心後面！ | `sk_fixer_watch_out` | reaction | 完成 | `meat.evade`、`trigger.ally_attacked` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 戰前佈置 | `sk_fixer_prep` | prep | 寫不出來 | `prep` | 預備三選一（藏貨、安排人、打點）要玩家選，但預備沒有 pick，寫不出來；資料只有說明文字，內海的兩選一版屬 M3。 |
| 1 | 換個位子嘛 | `sk_fixer_swap` | active | 近似 | `meat.free_move`、`target.ally` | 兩名相鄰隊友對調位置已做；「換到的那一格有遮蔽的人迴避 +1 到他的下一回合」沒有寫。 |
| 1 | 有我在 | `sk_fixer_im_here` | passive | 完成 | `mod.save` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 1 | 代理 | `sk_fixer_proxy` | active | 完成 | `mag`、`target.ally` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 勸降 | `sk_fixer_talk_down` | active | 完成 | `branch`、`check`、`if.ok`、`needs.afterglow`、`needs.any`、`needs.no_rank`、`needs.rank`、`needs.wounded`、`out`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 擋 | `sk_fixer_block` | reaction | 完成 | `react.no_wound`、`trigger.hit` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 2 | 買版面 | `sk_fixer_buy_space` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只有輿論欄。 |
| 2 | 再加一點嘛 | `sk_fixer_a_bit_more` | active | 無現實效果 | — | 設計書現實欄是「—」，這個技能只有輿論欄。 |
| 2 | 黑市門路 | `sk_fixer_black_market` | passive | 完成 | `daily`、`mag`、`meat.on_start`、`who.pick` | 開戰時指定的隊友彈匣多一格（可超過容量）；指定的隊友由 preset.picks 讀，但開打前的指定還沒有報告與介面寫入。 |
| 3 | 收買 | `sk_fixer_bribe` | active | 完成 | `needs.no_rank`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 保釋 | `sk_fixer_bail` | reaction | 完成 | `meat.ransom`、`react.prevent`、`trigger.out_before` | 照設計書的現實欄寫成，沒有已知的差異。測試資料的註解：保釋：隊友被制伏時，制伏解除；全隊倒下時，戰敗事件多一個「被贖回」（付等級×1,000 C$）。 |
| 3 | 情報網 | `sk_fixer_intel_net` | prep | 寫不出來 | `prep` | 預備的現實效果（全隊先攻 +3、指定一名敵人開場被標記）要玩家指定敵人，預備沒有 pick，寫不出來；踩點多揭開一項未知屬 M2；資料只有說明文字。 |
| 3 | 打他打他！ | `sk_fixer_hit_him` | active | 完成 | `buff`、`mod.damage_roll`、`status`、`target.enemy`、`when.other_status`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 3 | 派工網 | `sk_fixer_dispatch_net` | passive | 完成 | `daily`、`mod.call_uses` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 增援 | `sk_fixer_reinforce` | active | 等後面批次（M2） | `meat.pending` | 名冊上的人進場當我方單位要名冊（M2，ADR 0015 E13），meat 標 pending。 |
| 4 | 布陣 | `sk_fixer_formation` | stance | 完成 | `mod.evade` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 大局 | `sk_fixer_big_picture` | active | 近似 | `meat.picks`、`order`、`pick.ally`、`target.ally_or_self` | 先攻對調、被換到前面還沒動過的人馬上行動並拿回 1 點已做；選自己再選後面的隊友時，兩人之間還沒動過的人會被跳過一輪（ADR 0015 補記的沒處理的邊角）。 |
| 4 | 我有認識的人 | `sk_fixer_i_know_someone` | passive | 完成 | `meat.alter` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 4 | 有話好好說 | `sk_fixer_lets_talk` | active | 完成 | `check`、`if.ok`、`needs.rank`、`status`、`target.enemy` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 總攻令 | `sk_fixer_all_out` | active | 完成 | `ap`、`buff`、`mod.hit`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 護盤 | `sk_fixer_hold_the_line` | active | 完成 | `buff`、`mod.evade`、`mod.no_wound`、`vent`、`who.allies` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 全城欠我 | `sk_fixer_city_owes_me` | active | 完成 | `branch`、`meat.choose`、`meat.picks`、`needs.rank`、`pick.choice`、`pick.foe`、`status`、`who.pick` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 號令 | `sk_fixer_command` | stance | 完成 | `buff`、`meat.on_give_ap`、`mod.evade`、`mod.give_ap_cap`、`mod.hit` | 照設計書的現實欄寫成，沒有已知的差異。 |
| 5 | 人脈 | `sk_fixer_connections` | passive | 完成 | `daily`、`mod.call_hit`、`mod.call_uses` | 照設計書的現實欄寫成，沒有已知的差異。 |

### 主播（主播：聚光燈）

技能：完成 0、近似 0、寫不出來 0、等後面批次 0、無現實效果 27。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 輿論戰的開場手牌 +1。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 2 | 每場內海戰鬥第一次用曝光時，不花 RAM。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 3 | 每場輿論戰第一次佔沒人的格子時，那一格的防守當作 1。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 4 | 輿論戰每回合抽牌時多抽 1 張，再從手上棄掉 1 張。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 5 | 公信力 50 以上，「說法」牌的效果就 +1（原本要 60）。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 聚光燈 | `sk_streamer_t1_1`＊ | signature | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 曝光 | `sk_streamer_t1_2`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 我查查看 | `sk_streamer_t1_3`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 現場連線 | `sk_streamer_t1_4`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 剪剪貼貼 | `sk_streamer_t1_5`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 留一手 | `sk_streamer_t1_6`＊ | reaction | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 開台囉～ | `sk_streamer_t1_7`＊ | daily | 無現實效果 | — | 這是日常技能，設計書現實欄是「—」，效果只在戰鬥外的媒體日常與輿論裡，現實戰鬥沒有效果。 |
| 2 | 灌流 | `sk_streamer_t2_8`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 主持 | `sk_streamer_t2_9`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 洗版 | `sk_streamer_t2_10`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 獨家 | `sk_streamer_t2_11`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 老粉都在 | `sk_streamer_t2_12`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 爆料王 | `sk_streamer_t3_13`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 帶節奏 | `sk_streamer_t3_14`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 圍觀 | `sk_streamer_t3_15`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 追擊 | `sk_streamer_t3_16`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 假料工坊 | `sk_streamer_t3_17`＊ | daily | 無現實效果 | — | 這是日常技能，設計書現實欄是「—」，效果只在戰鬥外的媒體日常與輿論裡，現實戰鬥沒有效果。 |
| 4 | 頭條 | `sk_streamer_t4_18`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 反彈反彈 | `sk_streamer_t4_19`＊ | reaction | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 插播一下喔 | `sk_streamer_t4_20`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 流量密碼 | `sk_streamer_t4_21`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 直擊 | `sk_streamer_t4_22`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 號外 | `sk_streamer_t5_23`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 定調 | `sk_streamer_t5_24`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 全網聯播 | `sk_streamer_t5_25`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 今天也第一名 | `sk_streamer_t5_26`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 還不能下播 | `sk_streamer_t5_27`＊ | reaction | 無現實效果 | — | 設計書現實欄是「—」，主播在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |

### 偶像（偶像：應援）

技能：完成 0、近似 0、寫不出來 0、等後面批次 0、無現實效果 27。

**共鳴**

| 階 | 設計書 | 狀態 | 說明 |
|---|---|---|---|
| 1 | 每場內海戰鬥第一次用應援接上隊友時，不花行動點。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 2 | 每場輿論戰第一次佔應援圈時，防守 −1（最少 0）。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 3 | 感載上限 +4。 | 無現實效果 | 感載上限 +4 是橋的數值；這棵樹在現實是 none，格式檢查會擋下它現實的共鳴效果（load_max），所以現實戰鬥沒有效果。 |
| 4 | 輿論戰的開場手牌 +1。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |
| 5 | 同步檔位的上限 +1 級（照 CORE_RULES 第 5 節，最高是全檔）。 | 無現實效果 | 主播與偶像在現實沒有任何效果，格式檢查也不收這兩棵樹現實的共鳴效果。 |

**技能**

| 階 | 技能 | id | 種類 | 狀態 | 用到的鍵 | 說明 |
|---|---|---|---|---|---|---|
| 1 | 應援 | `sk_idol_t1_1`＊ | signature | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 進行曲 | `sk_idol_t1_2`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 表態 | `sk_idol_t1_3`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 聲援 | `sk_idol_t1_4`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 搖籃曲 | `sk_idol_t1_5`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 我還可以！ | `sk_idol_t1_6`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 1 | 握握手 | `sk_idol_t1_7`＊ | daily | 無現實效果 | — | 這是日常技能，設計書現實欄是「—」，效果只在戰鬥外的媒體日常與輿論裡，現實戰鬥沒有效果。 |
| 2 | 安可 | `sk_idol_t2_8`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 動員 | `sk_idol_t2_9`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 聽我唱～ | `sk_idol_t2_10`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 安撫 | `sk_idol_t2_11`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 2 | 大家都在喔 | `sk_idol_t2_12`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 合唱 | `sk_idol_t3_13`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 一句話 | `sk_idol_t3_14`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 召集 | `sk_idol_t3_15`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 公演 | `sk_idol_t3_16`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 3 | 唱出來 | `sk_idol_t3_17`＊ | daily | 無現實效果 | — | 這是日常技能，設計書現實欄是「—」，效果只在戰鬥外的媒體日常與輿論裡，現實戰鬥沒有效果。 |
| 4 | 絕唱 | `sk_idol_t4_18`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 我來擋！ | `sk_idol_t4_19`＊ | reaction | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 巨蛋 | `sk_idol_t4_20`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | 休息一下下 | `sk_idol_t4_21`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 4 | C 位是我的 | `sk_idol_t4_22`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 畢業公演 | `sk_idol_t5_23`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 為你而唱 | `sk_idol_t5_24`＊ | active | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 全員同步 | `sk_idol_t5_25`＊ | stance | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 傳說 | `sk_idol_t5_26`＊ | passive | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |
| 5 | 大家不要走 | `sk_idol_t5_27`＊ | reaction | 無現實效果 | — | 設計書現實欄是「—」，偶像在現實的戰鬥沒有任何效果，這個技能的 meat 必須是 null，只學得到、裝得上。 |

＊ 暫代 id（沒有資料可查）。
