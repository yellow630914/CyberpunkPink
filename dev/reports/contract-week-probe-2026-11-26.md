# 探針紀錄：契約人的一週

規格：LEWD_SYSTEM 7.1、7.4、7.6；EVENTS 4.5；DOWNTIME 4.2；dev/adr/0019 第八節與 P27～P30。腳本：engine/tests/probe/contract.probe.test.ts（PROBE_OUT 設了才寫檔）。

## 登錄表與掛鉤

- time.passed：character、netrun、drugs、tuning、malware、contract、curtain、bills、security、sink、roster、npcs、director、sink
- report.before：character、netrun、lewd、security、npcs、npcs、npcs、sink、roster、malware、contract
- report.after：enemies、defeat、netrun、abilities、abilities、event_run、work、sink、roster、commission、fixer、dive、maze、medical、drugs、tuning、contract、lure、arena、curtain

活動登錄表對 contract.choose 的放行：
- battle：不放行 contract.choose
- defeat：不放行 contract.choose
- scene：放行 contract.choose
- event：放行 contract.choose
- scan：放行 contract.choose
- auction：放行 contract.choose
- face.net：放行 contract.choose
- netrun：放行 contract.choose
- retreat：放行 contract.choose
- ride：放行 contract.choose
- dive：放行 contract.choose
- commission：放行 contract.choose

## 每一份報告

| 步驟 | 時間 | action | kind | 結果 | changes | 觸發點 | 滿意與摘要 |
|---|---|---|---|---|---|---|---|
| 簽下債務契約（C$24,000、差事／工作／回報／侍奉、每週一回報） | 第3天 10:00（星期四） | test.effect | system | ok | ext actor.ext meter | — | 滿意 50｜你簽下了一份債務契約，持約人是樂園。後頸多了一段光紋，你的身分成了契約人。 |
| 簽下債務契約（C$24,000、差事／工作／回報／侍奉、每週一回報） | 第3天 10:00（星期四） | contract.sign | downtime | signed | ext | — | 滿意 50｜你簽下了一份債務契約，持約人是樂園。後頸多了一段光紋，你的身分成了契約人。 |
| 走到 08:00（第 1 段） | 第4天 08:00（星期五） | test.wait | action | ok | time | — | 滿意 50｜時間過去了。 |
| 走到 08:00（第 1 段） | 第4天 08:00（星期五） | npc.life | downtime | life | npcs.life.leave | — | 滿意 50｜這幾天名單有 1 處變動。 |
| 走到 08:00（第 2 段） | 第5天 08:00（星期六） | test.wait | action | ok | time | — | 滿意 50｜時間過去了。 |
| 走到 08:00（第 2 段） | 第5天 08:00（星期六） | contract.order | downtime | sent | ext | — | 滿意 50｜樂園的耳語送來了一條指令：出借。 |
| 選「照做」：lend | 第5天 08:00（星期六） | contract.choose | action | comply | ext | — | 滿意 50｜你收下了樂園的出借，答應照做。 |
| 開成人場景（獨佔活動） | 第5天 08:00（星期六） | scene.start | social | start | uid ext npcs.memory.add | — | 滿意 50｜你和ann進入了這一場（兩情相悅）。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.act | social | act | ext npcs.memory.add | — | 滿意 50｜你等著對方。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜ann用口施展「親吻」，接上你的口。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜ann掌握了節奏。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜換成從後面。連接全部重來。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.act | social | act | ext npcs.memory.add | — | 滿意 50｜你等著對方。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext npcs.memory.add | — | 滿意 50｜ann開口說了幾句話。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜ann順著你的節奏迎上來。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.act | social | act | ext npcs.memory.add | — | 滿意 50｜你等著對方。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜ann順著你的節奏迎上來。 |
| 場景裡過三個回合 | 第5天 08:00（星期六） | scene.next | social | next | ext actor.track×2 npcs.memory.add | — | 滿意 50｜ann放慢下來，吊著你。 |
| 停下場景（結算） | 第5天 08:00（星期六） | scene.end | social | stop | ext actor.track×2 meter×2 actor.ext×2 npcs.memory.add | — | 滿意 50｜你停了下來。契合 40，普通。 |
| 拍賣：進場 | 第11天 19:10（星期五） | auction.enter | action | entered | auction.patch | — | 滿意 45｜你進了白槌的會場，這一場用現金晶片付款。武器寄存在門口；會場掃了義體，沒有登記。主持人：第 1 件，藝術品「纏線的小雕像 |
| 拍賣：離場（時間推到時段結束） | 第11天 23:00（星期五） | auction.leave | action | left | auction.patch time | auction_done | 滿意 45｜你離開了拍賣廳，剩下的拍品你都不喊了。義體商人沒有出價。戴手套的收藏家沒有出價。穿灰西裝的掮客沒有出價。不具名的來賓加了 |
| 走一天 | 第12天 23:00（星期六） | test.wait | action | ok | time | — | 滿意 45｜時間過去了。 |
| 走一天 | 第13天 23:00（星期日） | test.wait | action | ok | time | — | 滿意 40｜時間過去了。 |
| 走一天 | 第13天 23:00（星期日） | contract.overdue | downtime | lapsed | ext meter | — | 滿意 40｜樂園交代的差事過了期限，沒有人理它，指令作廢了，樂園的滿意掉了一點。 |
| 走一天 | 第14天 23:00（星期一） | test.wait | action | ok | time | — | 滿意 40｜時間過去了。 |
| 走一天 | 第14天 23:00（星期一） | contract.order | downtime | weekly | ext | — | 滿意 40｜樂園的耳語送來了一條指令：回報。 |
| 走一天 | 第14天 23:00（星期一） | contract.order | downtime | sent | ext | — | 滿意 40｜樂園的耳語送來了一條指令：回報。 |
| 走一天 | 第15天 23:00（星期二） | test.wait | action | ok | time | — | 滿意 30｜時間過去了。 |
| 走一天 | 第15天 23:00（星期二） | contract.overdue | downtime | lapsed | ext meter | — | 滿意 30｜樂園交代的回報過了期限，沒有人理它，指令作廢了，樂園的滿意掉了一點。 |
| 走一天 | 第15天 23:00（星期二） | contract.overdue | downtime | lapsed | ext meter | — | 滿意 30｜樂園交代的回報過了期限，沒有人理它，指令作廢了，樂園的滿意掉了一點。 |

## contract 掛鉤的實際回傳（節錄）

- 簽下債務契約（C$24,000、差事／工作／回報／侍奉、每週一回報） → report.after（contract）→ [{"kind":"downtime","action":"contract.sign","location":{"district":"tw_hive","block":"tw_tower"},"actor":"pc","party":[],"timeline":[{"layer":"meat","actor":"pc","text":"你簽下了一份債務契約，持約人是樂園。後頸多了一段光紋，你的身分成了契約人。","tag":"con
- 走到 08:00（第 2 段） → time.passed（contract）→ [{"kind":"downtime","action":"contract.order","location":{"district":"tw_hive","block":"tw_tower"},"actor":"pc","party":[],"timeline":[{"layer":"meat","actor":"pc","text":"樂園的耳語送來了一條指令：出借。","tag":"contract.order"}],"chan
- 走一天 → time.passed（contract）→ [{"kind":"downtime","action":"contract.overdue","location":{"district":"tw_ward","block":"tw_hall","facility":"F1"},"actor":"pc","party":[],"timeline":[{"layer":"meat","actor":"pc","text":"樂園交代的差事過了期限，沒有人理它，指令作廢了，樂園的滿意掉了
- 走一天 → time.passed（contract）→ [{"kind":"downtime","action":"contract.order","location":{"district":"tw_ward","block":"tw_hall","facility":"F1"},"actor":"pc","party":[],"timeline":[{"layer":"meat","actor":"pc","text":"樂園的耳語送來了一條指令：回報。","tag":"contract
- 走一天 → time.passed（contract）→ [{"kind":"downtime","action":"contract.overdue","location":{"district":"tw_ward","block":"tw_hall","facility":"F1"},"actor":"pc","party":[],"timeline":[{"layer":"meat","actor":"pc","text":"樂園交代的回報過了期限，沒有人理它，指令作廢了，樂園的滿意掉了

## 記下的事

- o2 lend 在第5天 08:00（星期六）送達，期限 24.0 小時後
- 場景一共 0 分鐘；指令期限 7680 → 7680（位移 0 分鐘）
- 這一條（lend）沒有指定的地方（doing），跳過走到。
- 拍賣：進場 → 離場經過 230 分鐘；指令期限 18240 → 18240（位移 0 分鐘）
- 週一回報的指令：2 條（o4:overdue、o5:overdue）
- 記下的事：(1) testkit 的 BODY_START 註解寫「第 3 天是週三」，照星期 = 天數 % 7（第 7 天週一）第 3 天是週四；(2) 契約簽的 orders 只是「契約紙上寫的種類」，沒寫的種類權重減半仍然抽得到（EVENTS 4.5 節「劃掉的種類仍然下得了，但權重減半」，符合）；(3) 回報（report）同時出現在每天的隨機抽（權重）與週一的固定排一條，同一個星期一可能有兩條回報；(4) 成人場景不花遊戲分鐘（探針 0 分鐘），所以場景這一路的期限暫停測不到差別，拍賣才有時間；(5) 指令的逾期只在下一次時間經過時才結算（一次 passTime 跨一天，逾期與新一條指令在同一刻結算）。

## 和規格不一致的地方

（沒有新的）

已開 bug 的不一致（探針照實記下）：
- B040：拍賣經過 230 分鐘，指令期限位移 0 分鐘（規格 EVENTS 4.5：拍賣是獨佔的活動，期限暫停）；離場那份報告推進時間時活動已經結束，time.passed 看到的是離場之後的狀態
