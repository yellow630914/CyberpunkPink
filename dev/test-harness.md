# 測試基礎建設規格（cpp-architect 在 M0 實作）

## 1. 狀態工廠
- `makeState(overrides)`：用最少的資料建立合法的遊戲狀態，不讀完整的內建世界。
- 預設情境：空房間、一位主角、固定種子。常用情境做成具名的建構函式（一場一般遭遇、一場首領戰、一個委託副本的第一階段、一場成人場景、一場輿論戰）。
- 理由：ElondiaRPG 的測試約 200 個檔靠「真實資料」建狀態，跟著搬得重寫（CODESCAN 2.8）。
- M1 已經有的（`engine/src/testkit/battle.ts`）：
  - 具名的情境 `BATTLE_SETUPS`：`encounter`（一般遭遇：四個雜兵）、`encounterElite`（兩個雜兵加一個精英）、`boss`（首領戰：一個首領加三個雜兵）、`capture`（敵人打感載、要活的）、`hopeless`（一定打輸，測戰敗用）。每一個都可以給等級。單位的數字是設計書的基準（敵人：ENEMIES 1.5 節的目標表；我方：BALANCE 2.2 節同級的主力），不讀資料檔。
  - `makeBattleGame({ battle, features, content, seed, … })`：一局已經開打的遊戲；`playOut(game)`：雙方都由程式選動作，打到分出結果；`fixDice(run, [骰面…])`：把一個 `BattleRun` 的骰釘死（規則的測試一顆一顆驗）。
  - `TEST_COMBAT`：一組最小的行動（攻擊、換彈、監視），讓核心的測試、冒煙、探針不必等現實戰鬥的功能。正式的行動表在 `features/combat`。
  - `engine/tests/helpers/battle.ts`（測試共用）：`arena()` 建一場不經過提交的戰鬥、`duel()` 幾對幾的小場地、`one()`／`foe()` 一個我方或敵方的單位。
- M2 加的（`engine/src/testkit/activity.ts`；dev/adr/0016）：
  - `TEST_ACTIVITY`：玩具活動（種類 `toy`，狀態放 `state.ext.toy`：`{ id, steps, goal, origin }`），給核心與下游的測試當替身，不必等事件、成人場景、委託副本做完。裝在 `makeGame` 的 `features` 裡。放行 `toy.`、`commit:toy.`，其餘全擋（`玩具活動進行中，先把它做完。`，order 20）；要讓它放行別的事用 `game.k.activity.allow('toy', 前綴, 主人)`。
  - 開始：`game.launch('toy', setup, origin?)` 或一份報告的 `launch`；`setup` 是 `{ goal?, refuse?, then? }`（`refuse` 是開不成的原因，一條一句，測 `launch` 開不成的回滾；`then` 是開始的那份報告自己帶的 `launch`，測連開幾層）。走一步 `toyStep(state)`、結束 `toyEnd(k, state, outcome?)` 都回傳報告草稿；`toyEnd` 同時是「活動的主人怎麼用 `endActivity`、`attachActivityEnd` 組結束的那一份報告」的範例（發 `activity.end`，`kind: 'toy'`，`result: { steps, goal }`）。`toyOf(state)` 讀現在的狀態。
- M2 加的（`engine/src/testkit/factory.ts`；dev/work/M2-core-shell.md）：變更 `snapshot.take` 要核心有序列化函式（`k.serialize`）。`makeGame` 建的 `Game` 自己就帶了（外殼注入的 `snapshotText`）；只有核心、沒有外殼的測試用 `makeKernel(features?)`（`createKernel` 加上序列化函式）、`makeStateKernel()`（`createStateKernel` 加上序列化函式，只測 L3 用）或直接拿 `TEST_SERIALIZE`（和 Game 注入的同一個，寫出來的文字可以交給 `unpackSave`、`Game.rewind`）。沒注入時 `snapshot.take` 不合法。
- M2 加的（`engine/src/testkit/meters.ts`；dev/adr/0016 第三節、dev/work/M2-core-meters.md）：核心自己不定義任何一種量表，下游功能的測試要用敵對值、好感、警戒這類數字時不必等管它們的功能做完：`testMeter(覆蓋?)` 回傳一個預設的量表定義（種類 `mood`、名字「心情」、0～100、起始 0、不分對象），`meterFeature(...定義)` 把它們裝上去（`makeGame({ features: [meterFeature(testMeter({ kind: 'favor', keyed: 'faction' }))], content: [METER_CONTENT] })`）。勢力與人的鍵要在內容裡查得到：`METER_CONTENT` 是假的兩個勢力（`f_alpha`、`f_beta`）與一位具名的人（`npc_ann`）；區的鍵要 `district` 這種內容種類（測試自己 `content.defineKind` 一個，或裝世界的功能）。定義之後同名的效果與條件自動有（`k.effects.resolve`、`k.conditions.test`）；讀數字用 `meterOf(k, state, kind, key?)`。範例在 `engine/tests/core/meters.test.ts`；第 2 版的舊檔在 `engine/tests/fixtures/saves/v2-m1.json`（含一份第 2 版的階段快照）。
- M2 加的（`src/testkit/world.ts`、`scenarios.ts`、`steps.ts`、`flow.ts`；dev/work/M2-smoke.md）：**最小的假世界與具名的情境**，所有 M2 功能一起跑的測試用（單一功能的驗收測試照舊各自帶最小假資料，不用它）。
  - `TEST_WORLD`（`testWorld()` 每次回傳新的一份）：一包只給測試用的內容，不放進 `engine/data`，每一種只放驗主幹用得到的最少幾筆：兩個區（蜂巢 `tw_hive`、鏽帶 `tw_rust`，鏽帶走一格 2 分鐘）、三塊街區（市場、塔下、院子）加一塊橋接區（閘門），用出口接成一條線（市場 ─ 塔下 ─ 閘門 ─ 院子）；一條三站的地鐵（`tw_metro`）；一間店（`s_tw_stall`，店主與後台勢力都有）與六樣東西；一份兩階段的工作（`j_tw_porter`，碼頭）；一處住處（`r_tw_unit`，塔下）；兩個勢力；三個固定 NPC（街坊、街坊、中間人本人）與蜂巢的一條生成規則；一個中間人（`fx_tw_broker`，站在市場）、一種委託的類型（`t_tw_hit`，三階段、現實面）加兩個連動、一件寫好的三階段副本（`cm_tw_office`，DATA 9.3 的小辦公室；戰敗事件 `df_tw_pow` 算失敗）；三個假兵種（野良的雜兵、精英、首領：一碰就倒）；兩件街頭事件（`ev_tw_street` 帶檢定、`ev_tw_scene` 選項帶成人場景；兩件都要旗標 `tw_street_a`／`tw_street_b` 才會被導演挑到，平常不打擾主幹）；兩件戰敗事件（通用的、兩段的）；三個基本體位。**不放規則表**（`*_rule`）：每個功能自己帶預設，要資料的規則表走 `makeWorldGame` 預設載入的 `dataRules(features)`。
  - `worldFor(features, pack?)`：拿掉功能之後的世界：沒有人定義的內容種類整個濾掉，引用的東西跟著不見的幾筆也濾掉；回傳 `{ pack, dropped, droppedEntries }`（逐一拿掉每個功能的測試靠它，見第 6 節）。
  - `makeWorldGame({ without?, noRules?, noGear?, base?, … })`：帶著 `TEST_WORLD`、全部功能（`allFeatures()`）、主角的武器（`TEST_GEAR`：骰數特別多的一把槍，假兵種一碰就倒；真的裝備要組裝，冒煙不測那一段）與資料的規則表（`dataRules`）的一局，AI 關著；`without` 拿掉幾個功能。只有工廠的狀態，沒有情境的步驟。
  - `makeCityGame()`：建好角色（`CITY_PC`）、站在起點的街區（塔下的西口）、租了住處；星期日上午 10:00，帳戶 500、現金 300。`makeCommissionGame()`：強主角（`STRONG_PC`）、中間人桌上的第一件委託已經接了（付現金）、名冊上的行者（`makeRunner()`，分紅）已經進隊（隊伍兩個人）、站在市場；還沒出發；回傳多 `job`、`fixer`、`runner`。兩者的種子預設是 7、6（選的是踩點會過的種子）。
  - 小工具：`walkTo(game, 標記 或 [x, y])`（走到版面上的一個標記，走不過去丟錯並寫出原因）、`walkAcross(game)`（穿過這條街，一定經過一個「每走十格」的觸發點）、`passTime(game, 分鐘)`、`passUntil(game, { day, hour })`、`untilIdle(game)`（把引擎開起來的事件視窗選第一個選得了的選項、成人場景按「停下」、戰鬥打到分出結果並結算，一直做到沒有活動；等著選的戰敗不處理）、`fightOut(game)`、`markerAt(game, id)`。
  - 步驟（`steps.ts`，冒煙與種子重播共用）：`playStage(game)`（一個副本階段強攻到底：選面、選分支、走到保全崗、打贏、拿東西走到撤離點）、`engage`、`rideTo`、`surrender`；步驟表 `M2_STEPS` 與 `doStep(game, 名字, 參數)`（`walk`、`pass`、`pass_until`、`flag`、`rent`、`ride`、`buy`、`work`、`sleep`、`until_idle`、`offer`、`scout`、`muster`、`go`、`stage`、`retreat`、`surrender`、`accept_defeat`、`rewind_stage`）。
  - `flow(名字)`：冒煙的「斷在哪一步」。`await f.step('步名', () => …)`，任何一步丟錯（含 `expect` 沒過），訊息開頭寫「冒煙「條」斷在第 n 步「步名」（前面做完：…）：原因」。
  - 兩個陷阱：工廠做的主角沒有橋參數，第一次讀檔會被補上一份（`save.repair`），讀檔前後的狀態就不一樣——`CITY_PC`、`STRONG_PC` 已經帶了；街區之間的出口站著的那一格不算「走進去」，要先離開再走回去。
- 「像副本」的流程（測撤退、委託失敗、`rewindToStage`）：`makeGame({ features: [TEST_COMBAT] })`，先提交一份第一筆是 `{ op: 'snapshot.take', kind: 'entry', owner, label }` 的報告、再提交 `kind: 'stage'`（帶 `replace: true`）的報告，`game.startBattle(BATTLE_SETUPS.hopeless())` → `playOut` → `await game.finishBattle()` 就停在等著選的戰敗；範例在 `engine/tests/core/shell-m2.test.ts` 的「Game.rewindToStage」。帶 `rewind` 的報告、`game.commitNarrated(草稿, { mode })`（`makeGame({ fake: true })` 看服務商收到的請求：`sectionOf(req, 'mode')`、`req.adult`）的範例在同一個檔。

## 2. 探針介面
- 在 L3～L5 開唯讀的觀察點：提交報告前後、每一個掛鉤被呼叫時、登錄表註冊時、任務鏈每一步的狀態變化。
- `probe.start()` / `probe.stop()` 回傳一串事件；正式版建置時不啟用、不影響效能。
- 事件帶時間順序、來源模組、內容的快照。

## 3. 假的 AI 服務商
- 實作和真的服務商同一個介面。
- 劇本模式：照測試給的回應依序回傳。
- 對抗模式：壞掉的 JSON、超出上限的數值、不存在的 id、少欄位、多欄位、拒絕（refusal）、逾時、串流中斷、`asked` 對不上、少交 `<covered>`。
- 記錄每一次收到的請求，讓測試檢查請求裡有沒有 `<results>`、`<previous_error>` 等。

## 4. 種子重播
- 測試失敗時把種子、初始狀態的建構方式與輸入序列存成 `engine/tests/fixtures/repro/<id>.json`。
- 一個共用的測試（`tests/repro/replay.test.ts`）會自動把 repro 資料夾裡的每一份重播兩次（結果的雜湊要一樣、不變式沒有違規），再對照 `expect`（`paths`：狀態裡幾個位置的值，或 `hash`、`throws`），變成回歸測試。
- M2 加的：`setup.named`（`city`、`commission`：具名的情境，見第 1 節；`scenario` 與 `features` 不用寫）與輸入 `{ "type": "m2", "do": "<步驟名>", …參數 }`（步驟表 `M2_STEPS`，見第 1 節）。固定檔有兩份：`m2-city.json`（走到另一區、搭地鐵、買東西、打工、中途存檔讀檔、睡一覺跨週一）與 `m2-commission.json`（踩點、出發、三個階段、中途存檔讀檔、做完入帳）。`expect.paths` 只記時間、錢、`rng.cursor`、位置、隊伍與背包：改了規則、功能多發了一份報告不會讓它紅，骰面或結算變了才會。要重錄：照 `tests/smoke/m2.test.ts` 的流程跑一遍，把這幾個位置的值抄進去。

## 5. 分層檢查腳本
- 掃描 import，違反 CODESCAN 第 3 節的規則就讓測試失敗（L6 之間互相 import、下層 import 上層）。`src/testkit/layers.ts` 的 `checkLayers`，測試在 `tests/core/layers.test.ts`。
- M2 加的（dev/adr/0016 第三節；不變式第 107 條）：`checkExtReads` 掃 `features/` 底下有沒有「讀或寫別的功能的 `state.ext.<鍵>`」（`state.ext.鍵`、`state.ext['鍵']`、`state.ext[常數]`、報告的 `{ op: 'ext', key }`；鍵是誰的看哪個功能寫了 `const EXT = '鍵'`；`actor`、`unit`、地圖實例、`origin` 的 `ext` 不算）。測試用真的原始碼、故意寫的反例，以及「在真的原始碼上加一個違規的檔案」都驗過。同一個檔還守著 M2-plan 的兩條規定：每個功能的資料夾都在 `FEATURES` 裡、各功能的驗收測試不 import `engine/data`。

## 6. 四種測試

### 冒煙（engine/tests/smoke/）
固定種子、AI 關閉。主幹隨批次長大：
- M0：開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退
- M1 加：一場現實戰鬥打完、戰敗事件（略過版）。核心版在 `engine/tests/smoke/m1.test.ts`（測試用的行動表與具名的情境）；功能版在 `engine/tests/pending/M1-smoke-features.test.ts`，M1 的功能工單做完之後搬進 `tests/smoke/`
- M2 加（`engine/tests/smoke/m2.test.ts`、`m2-world.test.ts`、`invariants-doc.test.ts`；固定種子、AI 關著，用 `TEST_WORLD` 與全部功能；每一條是一串有名字的步驟，斷了會寫出斷在第幾步）：
  - 城市：走到另一區 → 搭地鐵 → 進店買東西 → 打工一班 → 睡一覺 → 跨過週一付帳單
  - 事件：走路觸發一件街頭事件 → 選帶檢定的選項 → 效果生效（要旗標；沒有旗標不會被打擾）
  - 場景：帶場景的事件 → 進場景 → 說話、主導、停下 → 結算
  - 委託：看委託 → 接案 → 踩點一次 → 召集 → 進副本 → 三個階段各選面與分支、走地圖、打贏 → 做完入帳（報酬、抽成、分紅對得上）
  - 撤退：走完一個階段 → 撤退 → 時間、錢、背包、旗標回到出發之前，紀錄留著並標成被收回，委託還在手上可以再出發
  - 戰敗：副本裡投降 → 戰敗事件（兩段）演完 → 接受 → 委託失敗、回到進去之前；另一條選「回到這個階段開始時」，再把委託走完
  - 週一在副本裡：記成到期、出副本之後才結算；撤退時跟著回去
  - 存檔讀檔：每一種活動的中途（車上、事件視窗、場景、戰鬥、等著選的戰敗）；整條主幹在城市做完與副本第一階段做完各存一次，最後的狀態和沒有中斷的一樣
  - 整體：整條主幹的每一份報告前綴都在 0016 第七節的清單裡、不變式（`observed`）沒有違規；兩份種子重播的固定檔在、步驟名對得上
  - `m2-world.test.ts`：`TEST_WORLD` 帶全部功能載入（嚴格模式）；`FEATURES` 的每一個功能逐一拿掉，其餘照樣載得起來（引用沒斷）、開新局、自由行動、回退、存檔讀檔、時間過一個週一都照常；每一個功能拿掉時濾掉什麼寫成表，新增功能或內容種類時這張表會紅
  - `invariants-doc.test.ts`：`dev/invariants.md` 的編號連續、每一條有出處與哪裡驗、寫的測試檔存在
- M3 加：潛入內海、一場網內戰鬥
- 之後每一批加一步
整套（`npm run test:smoke`）在一分鐘內跑完：M2 加了之後約 15 秒（多個檔案同時跑；最慢的 `m2.test.ts` 約 12 秒，大部分花在真的戰鬥：每一場打十幾步、每一步一次提交）。主套件整體的時間主要是 `tests/boundary/combat-battle.boundary.test.ts` 與 `tests/whitebox/sweep-m1b.whitebox.test.ts`，不是冒煙。

### 探針（engine/tests/probe/）
每支腳本對一個系統：建情境 → 開探針 → 執行 → 輸出事件串。

### 白箱
`vitest --coverage` 只跑目標模組；目標是分支覆蓋，不是行數。

### 邊界
fast-check 做性質測試；AI 相關的用假服務商的對抗模式。
