# 探針紀錄：簾後館一趟到落幕

規格：CYBERSPACE 8.7、8.8 節；LEWD_SYSTEM 3.4 節；FIXER 第 4 節；dev/adr/0019 第十二節。腳本：engine/tests/probe/curtain.probe.test.ts（PROBE_OUT 設了才寫檔）。

## 登錄表與掛鉤

- time.passed：character、netrun、drugs、tuning、malware、contract、curtain、bills、security、sink、roster、npcs、director、sink
- bill.collect：cyberware、roster、rest、drugs、curtain
- report.after：enemies、defeat、netrun、abilities、abilities、event_run、work、sink、roster、commission、fixer、dive、maze、medical、drugs、tuning、contract、lure、arena、curtain
- activity.end：enemies、defeat、netrun、transit、work、security、npcs、roster、commission、fixer、scene、dive、arena、curtain

## 每一份報告

| 步驟 | action | kind | 結果 | 花的分鐘 | changes | 觸發點 | 沉溺、錢與摘要 |
|---|---|---|---|---|---|---|---|
| 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口 | test.rep | system | ok | 66 | meter | — | 沉溺 0→6｜cred 20000、cash 2000｜測試給的街頭信譽。 |
| 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口 | test.effect | system | ok | 66 | ext | — | 沉溺 0→6｜cred 20000、cash 2000｜簾後館的邀請函：3 天內有效 |
| 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口 | curtain.interview | action | joined | 66 | rng time ext npcs.memory.add | — | 沉溺 0→6｜cred 20000、cash 2000｜面談過了：你領到了簾後館的會員證，從散座坐起。 |
| 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口 | curtain.taste | action | set | 66 | ext | — | 沉溺 0→6｜cred 20000、cash 2000｜口味單：支配、服從、溺愛。 |
| 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口 | world.arrive | action | arrived | 66 | map.open map.sheet map.at world.visit location npcs.roster | enter_block | 沉溺 0→6｜cred 20000、cash 2000｜到了大廳。 |
| 報名（蜜糖之夜） | curtain.enter | netrun | entered | 0 | uid cash ext npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你在簾後館報名了蜜糖之夜，坐散座，付了保證金 C$300。這是這一週的主打：打賞加成 ×1.2。 |
| 報名（蜜糖之夜） | netrun.enter | netrun | entered | 0 | uid map.open map.sheet map.at ext npcs.memory.add | login | 沉溺 6→6｜cred 20000、cash 1700｜你潛進了「簾後館」：序幕・迎賓廳（共 4 層）。 |
| 報名（蜜糖之夜） | curtain.stage | netrun | stage | 0 | curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜簾後館的一晚開始了。場熱 30。 |
| 走完序幕與第一幕（兩層）到第二幕 | grid.move | action | moved | 40 | map.sheet counter×4 time×2 ext×5 map.at | enter_floor | 沉溺 6→6｜cred 20000、cash 1700｜走了 5 格。 |
| 走完序幕與第一幕（兩層）到第二幕 | netrun.use | netrun | fight | 40 | npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你對「遭遇」開戰。 |
| 走完序幕與第一幕（兩層）到第二幕 | battle.start | combat | step | 40 | uid battle snapshot.drop snapshot.add | — | 沉溺 6→6｜cred 20000、cash 1700｜戰鬥開始（序幕・迎賓廳・遭遇）。—— 第 1 回合 ——輪到 測試主角。 |
| 走完序幕與第一幕（兩層）到第二幕 | battle.end | netrun | win | 40 | snapshot.drop map.sheet map.ext ext counter meter battle rng chain npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜序幕・迎賓廳・遭遇：和蜜糖護士、甜點師打了 4 回合，勝利。敵人全部倒下或退出：勝利。「遭遇」處理掉 |
| 走完序幕與第一幕（兩層）到第二幕 | grid.move | action | moved | 40 | map.sheet counter×4 meter time×2 ext×4 map.at | — | 沉溺 6→6｜cred 20000、cash 1700｜走了 4 格。 |
| 走完序幕與第一幕（兩層）到第二幕 | netrun.descend | netrun | descend | 40 | map.sheet map.at ext npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜穿過閘門，到了第一幕・舞台。追蹤度沒有歸零。 |
| 走完序幕與第一幕（兩層）到第二幕 | curtain.rest | netrun | rest | 40 | meter curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜層與層之間是館方的化妝室：感載歸零、餘韻全消，RAM 回滿。場熱 +5。 |
| 走完序幕與第一幕（兩層）到第二幕 | grid.move | action | moved | 40 | map.sheet counter×4 time×2 ext×6 meter map.at | enter_floor | 沉溺 6→6｜cred 20000、cash 1700｜走了 6 格。 |
| 走完序幕與第一幕（兩層）到第二幕 | netrun.use | netrun | fight | 40 | npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你對「遭遇」開戰。 |
| 走完序幕與第一幕（兩層）到第二幕 | battle.start | combat | step | 40 | uid battle snapshot.drop snapshot.add | — | 沉溺 6→6｜cred 20000、cash 1700｜戰鬥開始（第一幕・舞台・遭遇）。—— 第 1 回合 ——輪到 測試主角。 |
| 走完序幕與第一幕（兩層）到第二幕 | battle.end | netrun | win | 40 | snapshot.drop map.sheet map.ext ext counter meter battle rng chain npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜第一幕・舞台・遭遇：和老教授、蜜糖護士、黏人的大叔打了 6 回合，勝利。敵人全部倒下或退出：勝利。「 |
| 走完序幕與第一幕（兩層）到第二幕 | grid.move | action | moved | 40 | map.sheet counter×4 time×2 ext×6 map.at | — | 沉溺 6→6｜cred 20000、cash 1700｜走了 6 格。 |
| 走完序幕與第一幕（兩層）到第二幕 | netrun.descend | netrun | descend | 40 | map.sheet map.at ext npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜穿過閘門，到了第二幕・後台。追蹤度沒有歸零。 |
| 走完序幕與第一幕（兩層）到第二幕 | curtain.rest | netrun | rest | 40 | meter curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜層與層之間是館方的化妝室：感載歸零、餘韻全消，RAM 回滿。場熱 +5。 |
| 第二幕開戰、全隊投降 | netrun.use | netrun | fight | 25 | npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你對「遭遇」開戰。 |
| 第二幕開戰、全隊投降 | battle.start | combat | step | 25 | uid battle snapshot.drop snapshot.add | — | 沉溺 6→6｜cred 20000、cash 1700｜戰鬥開始（第二幕・後台・遭遇）。—— 第 1 回合 ——輪到 測試主角。 |
| 第二幕開戰、全隊投降 | battle.end | netrun | surrender | 25 | snapshot.mark ext×2 counter battle rng chain npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜第二幕・後台・遭遇：和老教授、甜點師打了 1 回合，投降。投降：戰鬥結束，算戰敗。 |
| 第二幕開戰、全隊投降 | defeat.pending | event | defeat | 25 | npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜落幕了。館方派了補演。 |
| 接受結果（落幕） | defeat.accept | event | accepted | 0 | curtain.patch×2 counter×6 ext×2 map.at map.close snapshot.drop npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你接受了這個結果。這一趟的委託還在。 |
| 接受結果（落幕） | curtain.fall | netrun | replay | 0 | rng curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜全隊倒下了，在「第二幕・後台」落幕。場熱 56（打賞 ×0.2），打賞減半：C$108。保證金 C$ |
| 補演：館方派戰敗事件，開場景 | curtain.replay | netrun | start | 0 | npcs.gen actor.add curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜補演開場了：和tmp_6_a一起演給觀眾看。結算照契合的評價換回打賞。 |
| 補演：館方派戰敗事件，開場景 | scene.start | social | start | 0 | uid ext npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1700｜你和李小芬進入了這一場（工作，簾後館・補演）。 |
| 補演：停下（結算） | scene.end | social | stop | 0 | ext meter×2 actor.ext×2 npcs.sweep cash curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1786｜你停了下來。契合 20，不合。 |
| 補演：停下（結算） | curtain.replay | netrun | done | 0 | curtain.patch npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1786｜補演做完了：打賞 C$86。接下來選一條路處理設備費與違約金。 |
| 選「記帳」 | curtain.settle | netrun | tab | 0 | curtain.patch×2 npcs.memory.add | — | 沉溺 6→6｜cred 20000、cash 1786｜你把設備費與違約金 C$150 記了帳：每週的帳單會多一行利息，欠到保證金的 2 倍就不能再報名。 |
| 過一週（週一的帳單） | test.wait | action | ok | 11520 | time | — | 沉溺 6→6｜cred 19885、cash 1786｜時間過去了。 |
| 過一週（週一的帳單） | bill.settle | downtime | paid | 11520 | cred×2 ext×2 | weekly | 沉溺 6→6｜cred 19885、cash 1786｜第 1 週帳單：付了 115。 |
| 過一週（週一的帳單） | npc.life | downtime | life | 11520 | npcs.life.join npcs.life.leave | — | 沉溺 6→6｜cred 19885、cash 1786｜這幾天名單有 2 處變動。 |

## curtain 掛鉤的實際回傳（節錄）

- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → netrun.foe_ref（curtain）→ {"from":"enemy_pick","culture":"tw_honey_house","grade":2,"faction":"none"}
- 報名（蜜糖之夜） → report.after（curtain）→ [{"kind":"netrun","action":"curtain.stage","location":{"district":"tw_ward","block":"tw_hall","facility":"F4"},"actor":"pc","party":[],"timeline":[{"layer":"net","actor":"pc","text":"簾後館的一晚開始了。場熱 30。"
- 走完序幕與第一幕（兩層）到第二幕 → netrun.round（curtain）→ [{"op":"counter","key":"curtain:q1:r0","delta":1},{"op":"counter","key":"curtain:q1:x0","delta":1}]
- 走完序幕與第一幕（兩層）到第二幕 → netrun.round（curtain）→ [{"op":"counter","key":"curtain:q1:r0","delta":1},{"op":"counter","key":"curtain:q1:x0","delta":1}]
- 走完序幕與第一幕（兩層）到第二幕 → battle:battle.start（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:action.done（curtain）→ false
- 走完序幕與第一幕（兩層）到第二幕 → battle:attack.after（curtain）→ false

## 探針事件（每一步前 12 筆，不含掛鉤呼叫）

- 前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口：033 core/state/commit report.before r3；034 core/state/commit report.after r3；086 core/state/commit report.before r4；087 core/state/commit report.after r4；139 core/state/commit report.before r5；140 core/state/commit report.after r5；192 core/state/commit report.before r6；193 core/state/commit report.after r6；245 core/state/commit report.before r7；246 core/state/commit report.after r7；298 core/state/commit report.before r8；299 core/state/commit report.after r8
- 報名（蜜糖之夜）：112 core/state/commit report.before r16；113 core/state/commit report.after r16；114 core/state/commit report.before r17；115 core/state/commit report.after r17；116 core/state/commit report.before r18；117 core/state/commit report.after r18
- 走完序幕與第一幕（兩層）到第二幕：052 core/state/commit report.before r19；053 core/state/commit report.after r19；209 core/state/commit report.before r20；210 core/state/commit report.after r20；211 core/state/commit report.before r21；212 core/state/commit report.after r21；284 core/state/commit report.before r22；285 core/state/commit report.after r22；345 core/state/commit report.before r23；346 core/state/commit report.after r23；418 core/state/commit report.before r24；419 core/state/commit report.after r24
- 第二幕開戰、全隊投降：058 core/state/commit report.before r108；059 core/state/commit report.after r108；215 core/state/commit report.before r109；216 core/state/commit report.after r109；217 core/state/commit report.before r110；218 core/state/commit report.after r110；266 core/state/commit report.before r111；267 core/state/commit report.after r111；268 shell/ai/chain chain.step settle running；269 core/rules/effects effects.resolve；288 shell/ai/chain chain.step settle done；289 shell/ai/chain chain.step relate skipped
- 接受結果（落幕）：000 core/rules/effects effects.resolve；083 core/state/commit report.before r114；084 core/state/commit report.after r114；085 core/state/commit report.before r115；086 core/state/commit report.after r115
- 補演：館方派戰敗事件，開場景：073 core/state/commit report.before r116；074 core/state/commit report.after r116；075 core/state/commit report.before r117；076 core/state/commit report.after r117
- 補演：停下（結算）：006 core/rules/effects effects.resolve；085 core/state/commit report.before r118；086 core/state/commit report.after r118；087 core/state/commit report.before r119；088 core/state/commit report.after r119
- 選「記帳」：033 core/state/commit report.before r120；034 core/state/commit report.after r120
- 過一週（週一的帳單）：119 core/state/commit report.before r121；120 core/state/commit report.after r121；121 core/state/commit report.before r122；122 core/state/commit report.after r122；123 core/state/commit report.before r123；124 core/state/commit report.after r123

## 記下的事

- 保證金：散座 300；報名實際扣 300
- 落幕：輸在第 3 幕（第二幕・後台），場熱 56，打賞 108（整份 216），保證金 300，設備費與違約金 150
- 規格沒寫「不合」的評價怎麼算：好的補回減掉的一半再加一點（rules.fall.replay.bonus），這裡的實作另外在不合時再扣一成（penalty）。見回報的規格問題。
- 補演結果：{"fit":20,"band":"poor","sink":0,"kept":0,"from":108,"to":86,"reported":true}
- 補演前後主角沉溺 6 → 6（+0）
- 評價 poor：打賞 108 → 86（整份 216）
- 路：pay：可以｜設備費與違約金 C$150，當場付清。
- 路：tab：可以｜欠 C$150，每週利息 10% 列進每週帳單；欠到保證金的 2 倍就不能再報名，直到還清。只是錢，不連到契約。
- 路：gig：可以｜場內契約 4 週，每週至少上 1 場，這段時間打賞與獎金你只拿 40%；沒上場的那一週勢力敵對值 +10。不入伊甸園的登記庫，不受法律保護。
- 母帶：[]；外流機率（第 3 幕輸、沒欠款）0.25
- 外流的骰面（落幕前導出）0.6732、機率 0.25 → 預期不外流；實際母帶 0 支
- 記帳：欠 150，上限 600，每週利息 15
- 週帳單的簾後館那一行：{"id":"curtain_tab","owner":"curtain","name":"簾後館的欠款利息","kind":"due","amount":15,"order":6,"pay":"either"}
- 規格沒寫清楚（要使用者或架構師定）：(1) 場熱剛好 20：「20 以下 0」與「20～39 ×0.1」兩邊都包含 20，現況 20 算 ×0.1；(2)「不合」的補演評價規格沒寫，現況再扣一成打賞（rules.fall.replay.penalty）；(3) 記帳欠款「上限是保證金的兩倍」現況是報名的閘門（欠到上限就不能報名），沒有夾住欠款：欠 599 的人再落幕記帳會欠到 749，超過上限。

## 和規格不一致的地方

（沒有新的）

已開 bug 的不一致（探針照實記下）：
（沒有）
