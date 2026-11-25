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
- M3 加的（`engine/src/testkit/battle.ts`；dev/adr/0018 第一節、dev/work/M3-core-battle.md）：內海的戰鬥不必等 `features/netcombat`：
  - 具名的情境 `BATTLE_SETUPS.net(grade?)`：同級的四個化身對四個雜兵蕾絲，戰場 `net`，遮蔽（防火牆）是「中」。數字照 ENEMIES 1.5 節的內海表（`NET_TARGETS`：攻擊加值、防護、RAM 雜／精／首、每回合回 RAM；感載上限與現實同）與同級的主力：沒有生命，化身的防護是主力的護甲、RAM 5、每回合回 2，蕾絲的迴避（防火牆）是 11 ＋ 等級（N19），武器構裝是神經傷害、每次攻擊花 1 RAM、沒有彈匣，傷害骰位階定骰數（雜兵 4、精英 5、首領 6，再加等級骰；N18）。單位也單獨匯出：`netAvatar(i, grade?, overrides?)`（我方的化身）、`laceUnit(rank?, grade?, overrides?)`（敵方的蕾絲）、`netWeapon(hit, dice, overrides?)`。
  - `TEST_NET_COMBAT`：一組最小的內海行動，只在內海戰場（`modes: ['net']`）：攻擊（`test.net.attack`，2 行動點加 1 RAM，帶 `weapon_attack` 標籤；沒有攻擊構裝時灰掉，原因「手上沒有攻擊構裝。」）、回填（`test.net.refill`，1 行動點，RAM +2，吃 `refill` 的修正）。id 在 `TEST_NET_ACTIONS`。AI 的分數：攻擊 2（命中率低於 35% 時 1），回填在 RAM 不夠打一下時 3。`makeBattleGame` 看到內海的情境又沒給 `features` 時自動裝它（現實的情境裝 `TEST_COMBAT`）；測試要自己組內海的小場地時，用 `engine/tests/helpers/battle.ts` 的 `netDuel(allies, foes, more?)`（化身對蕾絲，遮蔽逐格給）加 `netArena(setup, prepare?)`（不經過提交的一場內海戰鬥，裝 `TEST_NET_COMBAT`）；範例是 `engine/tests/core/battle-m3.test.ts`。正式的行動表在 `features/netcombat`；裝了它就不要再裝這一組。
  - 閃斷、斷路、個人的脫離、`safe` 的場地、同步原則的表有哪些條件、怎麼驗，看 `dev/invariants.md` 第 139～145 條；`engine/tests/core/sync.test.ts` 是同步原則的範例（`makeKernel()` ＋ `makeState({ pc: { skills: { sync }, ext: { bridge: { sensitivity } } } })`，衍生數值用 `k.stats.defineStat` 臨時註冊）。
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
- M3 加的（`src/testkit/worldNet.ts`、`scenariosNet.ts`、`netPlay.ts`；dev/work/M3-smoke.md）：**假世界多了內海的幾筆**，加上內海的具名情境與小工具。單一功能的驗收測試照舊各自帶最小假資料，不用它。
  - 內容（`worldNet.ts` 的 `netContent()`，`testWorld()` 把它併進 `TEST_WORLD`；每一種只放驗主幹用得到的最少幾筆）：甲板兩副（`dk_tw_ii` II 級六槽；`dk_tw_rent` 租用的 I 級）、構裝七個（`cs_tw_gun`、`cs_tw_blade`、`cs_tw_jam`、`cs_tw_guard`、`cs_tw_probe`，加新手組的兩件比賽版 `cs_tw_gun_rent`、`cs_tw_blade_rent`）、一支腳本（`it_tw_script`：回填包）、一支快駭程式（`qh_tw_zap`）、野良幫（`f_gang`，蜂巢的那個勢力）的四種蕾絲（`en_tw_white`、`en_tw_pink_m`、`en_tw_pink_e`、`en_tw_gate` 粉蕾絲的首領當閘門守衛；`mods.load` 壓到 0.5、攻擊與防火牆壓低：一碰就倒）、一區小一點的子網（`tw_subnet`，9 × 7；委託的階段一場遭遇、一個陷阱、一個休息點、沒有巡邏；自己去挖只有守閘門那一場）、一種設施類型（`nf_tw_office`，兩層）、主面是內海的委託類型 `t_tw_steal`（`airgap: 1`）與一件寫好的四階段副本 `cm_tw_net`（前兩階段現實與內海都可選、第三階段現實拿到 `tw_airgap`、第四階段內海下載兩次而且是隔離區；現實面用 `tw_room`，內海面都寫 `lace: pink`）、一件 `pinned` 的戰敗事件 `df_tw_pinned`（算委託失敗；蕾絲自己寫 `defeat`，所以副本不必指定）。第二波：潛艙店（塔下的 F3，`fac_tw_pod`，帶 `dive`）、兩筆去處（`ns_tw_dig` 要有甲板、`ns_tw_guest` 訪客也進得去）、迷宮館的小表（`maze_rule` 新手組一種、館方發 `dk_tw_rent` 與比賽版構裝、每層只有守閘門的那一場；`maze_table` 兩筆固定給籌碼）。另一位中間人 `fx_tw_netbroker`（站在市場，門路是 `t_tw_steal`）；`TEST_NET_OFFER`（testkit 的功能，回答 `fixer.offers`）讓他桌上多一件寫好的 `cm_tw_net`。**假世界現在有兩份「規則表」例外**：三個 `jam_*` 的 `battle_status`（干擾的構裝載入時要，資料也有同樣三筆）與 `maze_rule`（新手組要能用假世界的構裝；資料的 `kit` 是空的）。
  - `worldFor` 多兩種濾法（M3）：格式不合的筆（例：構裝工具的效果 `load` 是 `combat` 註冊的）與第二段（`ready`）檢查不過的筆（例：腳本的效果 `net.ram` 是 `netcombat` 註冊的）整筆濾掉並記在 `droppedEntries`。**改假世界要看 `worldFor(worldFeatures())` 的 `droppedEntries` 是空的**（`m2-world.test.ts`「沒有拿掉任何功能時濾掉的是空的」守著）：內容寫壞（例如蕾絲首領寫了 `kind: 'program'` 又寫 `color`）會被當成「這個功能被拿掉」濾掉，不會丟錯。
  - 具名的情境（`scenariosNet.ts`）：`makeNetBattleGame({ foes?, color?, noBattle? })`（四個有甲板的化身：主角 `NET_PC` 加三個隊友，對四隻粉蕾絲，遮蔽「中」，已經開打；主角第一個輪到；種子 5）、`makeNetCommissionGame({ offer? })`（接了掮客桌上寫好的四階段內海委託、付現金；隊伍是主角加名冊上的行者，兩個人都有甲板；站在市場；還沒出發；種子 6；`offer: 'generated'` 是接桌上照類型生成的第一件）、`makeDiveGame({ noDeck? })`（站在潛艙店 F3、有自己的甲板、現金 500；種子 4；`noDeck` 是沒有甲板的人，租用）。三者都帶 `TEST_NET_ADMIN`（有 `actor.ext.test_admin` 的角色開戰時 `unit.ext.net.admin` 是那個數字並加 `admin`、`netrunner` 標籤：管理行動的真正來源是技能樹的內海欄，那一段有 abilities 自己的測試；冒煙只要戰鬥裡有人做得了管理行動）。`equipParty(game, ids)` 走真正的 deck 報告（`deck.install`、`deck.scripts`）給隊上的人裝構裝（第一個人全套，其他人槍加防護），穿甲板用 `wearDeck`（見下一條）；`netInventory(n)` 是背包要有的東西。
  - **`wearDeck(k, state, actor, uid)`、`unwearDeck(k, state, actor)`**（`src/testkit/wearDeck.ts`；M4-cyber-deck 之後；dev/adr/0019「實作補記：M4-cyber-deck」）：回傳報告草稿，讓測試「一開始就穿著（或拿掉）一副甲板」。沒有人掛 `deck.source`（沒裝 `cyberware` 的局）走 `equipDraft`（來源 `own`、報告 `deck.equip`，M3 的樣子）；有人掛（全部功能的局）直接把背包裡那一疊放進腦部（`actor.ext.cyber` 多一件 `kind_of: 'deck'`、`slot: 'brain'`，報告 `test.wear_deck`；不經手術：不收費、不花時間、不休養、不要診所與橋），沉溺成本照 `pieceSink`（內容那一筆的 `sink_cost`，沒寫是規則表 `deck_sink_default`）記在那一件上並把角色的沉溺補到新的下限，來源是 `implant`。**全部功能的局裡不要再直接呼叫 `equipDraft`**（一律回 `IMPLANT_ONLY`）；要測「背包甲板的裝上、換副、卸下」本身（`equipDraft`、`equipBlock`、`deckView().decks`）就用不含 `cyberware` 的局（`makeNetBattleGame({ without: ['cyberware'] })` 或自己 `createKernel` 不放它），要測手術就用真的 `cyberware` 的 `installDraft`（`tests/features/M4-cyber-deck.test.ts`）。斷言甲板來源時：全部功能的局是 `implant`，沒裝 `cyberware` 的局是 `own`。
  - 小工具：`netWalkTo(game, 節點的 id | 'entry' | [x, y])`、`netWalkCell`（路上踩到陷阱停在半路會接著走；戰鬥開了交給呼叫的人）、`netWalkRounds(game, n)`（在入口與旁邊一格之間來回走 n 個探索回合，被定位倒數用）、`netUse(game, 做什麼, 節點?)`（`fight`、`sneak`、`descend`、`pass`、`download`、`rest`……）、`standBeside`、`netMarkers`；`playNetStage(game, { branch?, noFace?, stopAt?: 'foe' | 'gate', layers?, allowLoss?, checkpoint? })`（一個內海階段強攻到底：選面、選分支、走到遭遇旁邊開戰、打贏、通過閘門；目標是下載的走到目標上做滿；`stopAt` 走到就停、`layers` 只走幾層、`checkpoint('download')` 在第一次下載之後叫）、`playMaze(game)`（迷宮館三層：機關、遭遇、寶箱、閘門，擋路的先處理）、`refitForRookie(game)`（把構裝換成新手組的比賽版；**潛入中不能換構裝，要在潛入之前**）、`mazeSignUp`、`diveIn`；`prefixProblems(game)` 與 `M3_ACTION_PREFIXES`（報告的前綴清單）。
  - **內海戰鬥的我方由 `playNetOut` 出手**（`netPlay.ts`）：有攻擊構裝就打、手上的破損了就換、RAM 不夠就回填、其餘結束回合；敵方照常 AI。`fightOut`／`untilIdle` 遇到內海的戰鬥自動走它。原因是 `playOut`（雙方都 AI）讓我方化身自己打時，構裝破損之後 AI 不會換（`net_swap` 沒有 `aiScore`，dev/bugs/B023），整場會拖成僵局。
  - `TEST_GEAR`（主角的現實武器）現在只在現實的戰場給（`mode === 'net'` 不給）：內海的武器是甲板上的構裝。
  - 範圍：內海的戰鬥在核心的測試用 `BATTLE_SETUPS.net`、`TEST_NET_COMBAT`（上面 M3 加的那一段）；只有要所有 M3 功能一起跑才用這裡的情境。
- 「像副本」的流程（測撤退、委託失敗、`rewindToStage`）：`makeGame({ features: [TEST_COMBAT] })`，先提交一份第一筆是 `{ op: 'snapshot.take', kind: 'entry', owner, label }` 的報告、再提交 `kind: 'stage'`（帶 `replace: true`）的報告，`game.startBattle(BATTLE_SETUPS.hopeless())` → `playOut` → `await game.finishBattle()` 就停在等著選的戰敗；範例在 `engine/tests/core/shell-m2.test.ts` 的「Game.rewindToStage」。帶 `rewind` 的報告、`game.commitNarrated(草稿, { mode })`（`makeGame({ fake: true })` 看服務商收到的請求：`sectionOf(req, 'mode')`、`req.adult`）的範例在同一個檔。

## 2. 探針介面
- 在 L3～L5 開唯讀的觀察點：提交報告前後、每一個掛鉤被呼叫時、登錄表註冊時、任務鏈每一步的狀態變化。
- `probe.start()` / `probe.stop()` 回傳一串事件；正式版建置時不啟用、不影響效能。
- 事件帶時間順序、來源模組、內容的快照。

## 3. 假的 AI 服務商
- 實作和真的服務商同一個介面。
- 劇本模式：照測試給的回應依序回傳。
- 對抗模式：壞掉的 JSON、超出上限的數值、不存在的 id、少欄位、多欄位、拒絕（refusal）、逾時、串流中斷、`asked` 對不上、少交 `<covered>`。
- 自動模式的任務（M4-core-scene-ai 加的六個成人場景任務與 `relate`、`reward` 的場景收尾形式）：`goodReply` 照請求的 `<input>` 回合規的結果。成人場景的對抗劇本不放進 `ADVERSARIAL_MODES`（那一組會被每個任務的測試逐個跑），另外放 `SCENE_ADVERSARIES`（`turn_stop`、`turn_other_circle`、`sink_over`、`gate_bad_nature`、`tendency_untouched`、`talk_over`）：`sceneAdversary(名字)` 是一份壞的回應，`sceneScript(名字)` 排成幾份（自動重試也拿到同一份壞的），用法 `new FakeProvider({ byTask: { sink: sceneScript('sink_over') } })`。
- 記錄每一次收到的請求，讓測試檢查請求裡有沒有 `<results>`、`<previous_error>` 等。

## 4. 種子重播
- 測試失敗時把種子、初始狀態的建構方式與輸入序列存成 `engine/tests/fixtures/repro/<id>.json`。
- 一個共用的測試（`tests/repro/replay.test.ts`）會自動把 repro 資料夾裡的每一份重播兩次（結果的雜湊要一樣、不變式沒有違規），再對照 `expect`（`paths`：狀態裡幾個位置的值，或 `hash`、`throws`），變成回歸測試。
- M2 加的：`setup.named`（`city`、`commission`：具名的情境，見第 1 節；`scenario` 與 `features` 不用寫）與輸入 `{ "type": "m2", "do": "<步驟名>", …參數 }`（步驟表 `M2_STEPS`，見第 1 節）。固定檔有兩份：`m2-city.json`（走到另一區、搭地鐵、買東西、打工、中途存檔讀檔、睡一覺跨週一）與 `m2-commission.json`（踩點、出發、三個階段、中途存檔讀檔、做完入帳）。`expect.paths` 只記時間、錢、`rng.cursor`、位置、隊伍與背包：改了規則、功能多發了一份報告不會讓它紅，骰面或結算變了才會。要重錄：照 `tests/smoke/m2.test.ts` 的流程跑一遍，把這幾個位置的值抄進去。
- M3 加的：輸入 `{ "type": "m3", "do": "<步驟名>", …參數 }`（步驟表 `M3_STEPS` ＝ `M2_STEPS` 加六個：`net_stage { branch?, no_face?, layers?, stop_at?: 'foe' | 'gate', save_at?: 'download' }`、`net_walk { to }`、`net_use { what, at? }`、`net_logout`、`dive { op: 'enter' | 'go' | 'exit', site? }`、`maze { op: 'refit' | 'enter' | 'play', bracket?, seed? }`；細節在 `src/testkit/steps.ts`），`setup.named` 多 `net_commission`（`makeNetCommissionGame`）與 `dive`（`makeDiveGame`）。固定檔兩份：`m3-net-commission.json`（出發、第一階段內海走到遭遇旁邊、`net_walk` 退回入口、再走一次、存檔讀檔、開戰、`until_idle` 打完、通過閘門、兩個現實階段、第四階段內海下載到一半存檔讀檔、入帳；`expect.paths` 是時間、錢、`rng.cursor`、位置、隊伍、背包）與 `m3-dive.json`（換比賽版構裝、潛入、自己去挖走完一層登出、再進去、存檔讀檔、迷宮館報名、存檔讀檔、走完三層、登出）。要重錄：改了假世界的內容（骰面、數字會變）之後 `tests/repro/replay.test.ts` 會紅，失敗訊息裡有新的值，確認是預期的改動就抄進 `expect.paths`。給下游的失敗重現（B024）放 `tests/pending/fixtures/`，不放 `tests/fixtures/repro/`（後者每次主套件都重播，會讓主套件變紅）。

## 5. 分層檢查腳本
- 掃描 import，違反 CODESCAN 第 3 節的規則就讓測試失敗（L6 之間互相 import、下層 import 上層）。`src/testkit/layers.ts` 的 `checkLayers`，測試在 `tests/core/layers.test.ts`。
- M2 加的（dev/adr/0016 第三節；不變式第 107 條）：`checkExtReads` 掃 `features/` 底下有沒有「讀或寫別的功能的 `state.ext.<鍵>`」（`state.ext.鍵`、`state.ext['鍵']`、`state.ext[常數]`、報告的 `{ op: 'ext', key }`；鍵是誰的看哪個功能寫了 `const EXT = '鍵'`；`actor`、`unit`、地圖實例、`origin` 的 `ext` 不算）。測試用真的原始碼、故意寫的反例，以及「在真的原始碼上加一個違規的檔案」都驗過。同一個檔還守著 M2-plan 的兩條規定：每個功能的資料夾都在 `FEATURES` 裡、各功能的驗收測試不 import `engine/data`。
- M3 加的（`src/testkit/layers.ts`；測試在 `tests/core/layers.test.ts`「M3 每一張都適用的規定」；dev/work/M3-plan.md 規定第 2、3、6、7 條）：`checkCoreOnlyImports(files, 功能的名字)`（`deck`、`netcombat`、`netrun`、`dive`、`maze` 只 import 自己的檔案與核心）；`scanActionDefs` 與 `checkActionModes`（`features/` 底下每一個戰鬥行動的定義都寫了 `modes`：掃物件字面最外層同時有 `owner`、`group`、`run` 的；核心自己的兩個行動在 `core/battle`，不在範圍）；`checkGridWorldGuards(files, 功能的名字)`（`netrun`、`maze`、`explore` 的 `k.grid` 處理函式前 600 個字裡先看是哪個世界的地圖：`isNetMapKind`、`inRun`、`hereOf`、`isMazeInstance`；只是轉給同一個功能裡別的函式的，看那個函式）。三個檢查都用真的原始碼、故意寫的反例、「在真的原始碼上加一個違規的檔案」驗過，也驗過「寫錯功能名字會紅」（不會變成什麼都沒掃）。`checkExtReads` 掃得到的鍵多了 `netrun`、`dive`、`maze`（三個功能的 `const EXT`），別的功能讀或寫它們抓得到。同一個檔還守著 M3 規則表與區的內容種類都是 `overridable`、M3 各功能的驗收測試不 import `engine/data`。

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
- M3 加（`engine/tests/smoke/m3.test.ts`；`m2-world.test.ts` 補 M3 的拿掉；固定種子、AI 關著，用 `TEST_WORLD`——內海的幾筆在 `worldNet.ts`——與全部功能；每一條是一串有名字的步驟，斷了會寫出斷在第幾步）：
  - 內海戰鬥：開打 → 換檔 → 攻擊到一隻過載（閃斷）→ 回填 → 管理行動造牆 → 釘住 → 打贏；另一條全員拔線（`jack_out`）
  - 委託（內海）：接案（掮客桌上寫好的四階段）→ 出發 → 第一階段選內海、走子網、打一場（主角用一次管理行動：追蹤度 +1）、通過閘門 → 第二階段選現實 → 第三階段現實拿到開路的連動 → 第四階段內海下載（隔離區）→ 做完入帳；追蹤度整趟累計對得上（第一段交回的＝副本記的＝第四段開始時的量表值；做完的 `result.trace` ＝第四段交回的）。另一條：掮客桌上照類型生成的內海委託（竊密、小型、三階段、最後是隔離區）從接案走到入帳
  - 撤退：內海階段探索中登出 → 一份 `netrun.logout` 加 `rewind`，回到進副本之前、地圖實例沒了、委託還在手上可以再出發
  - 戰敗：內海階段投降 → `pinned` 的戰敗事件 → 接受 → 委託失敗、回到進去之前、只有 `defeat` 與 `commission` 發 `activity.end`；另一條選「回到這個階段開始時」，改選現實面走完
  - 被定位：追蹤度推到 90、走三個探索回合 → `netrun.located`、委託失敗、敵對值 +5
  - 存檔讀檔：子網走到一半、內海戰鬥打到一半、下載到一半各存一次，最後的狀態（雜湊）和沒有中斷的一遍一模一樣；戰敗的三選一與被定位的倒數也存得下
  - 潛入（第二波）：潛艙店潛入 → 自己去挖走完一層登出 → 再進去是同一張圖 → 迷宮館報新手組走完三層結算 → 登出回到現實；另一條沒有甲板的人租一副（費用加押金，登出退押金）
  - 整體：報告的前綴（`M3_ACTION_PREFIXES`：M2 的加 `deck`、`netrun`、`dive`、`maze`）、不變式（`observed`）沒有違規；兩份種子重播的固定檔在、步驟名對得上
  - `m2-world.test.ts`（M3 補的）：`TEST_WORLD` 帶全部功能（含內海的幾筆）嚴格載入；逐一拿掉每一個功能的表 `DROPS` 補上 `combat`、`netcombat`、`netrun`、`deck`、`hack`、`dive`、`maze`；另有三條：拿掉 `netrun`（現實的委託照樣跑、內海的委託進不去並寫原因）、拿掉 `deck`（沒有人有 RAM、現實的快駭回到沒有甲板的樣子）、拿掉 `netcombat`（內海戰鬥只剩移動與結束回合）
  - 起頭的 `vi.setConfig({ testTimeout: 60_000 })`：走完一整趟委託要打七八場真的內海戰鬥（約 2～5 秒），機器忙的時候（別的測試同時在跑）會慢好幾倍，預設的十秒不夠（M3-maze 的〈評價〉那一條就是這樣逾時過：一個測試走三趟迷宮館，單獨跑 7 秒多；已拆成三個測試並加了逾時）
- 之後每一批加一步
整套（`npm run test:smoke`）在一分鐘內跑完：M2 加了之後約 15 秒（多個檔案同時跑；最慢的 `m2.test.ts` 約 12 秒，大部分花在真的戰鬥：每一場打十幾步、每一步一次提交）；M3 加了之後約 19 秒（`m3.test.ts` 單獨約 16 秒；最慢的三條是生成的內海委託約 5 秒、內海委託中途三次存檔讀檔約 4 秒、`m2.test.ts` 的整條主幹約 4 秒）。主套件整體的時間主要是 `tests/boundary/combat-battle.boundary.test.ts` 與 `tests/whitebox/sweep-m1b.whitebox.test.ts`，不是冒煙。

### 探針（engine/tests/probe/）
每支腳本對一個系統：建情境 → 開探針 → 執行 → 輸出事件串。

### 白箱
`vitest --coverage` 只跑目標模組；目標是分支覆蓋，不是行數。

### 邊界
fast-check 做性質測試；AI 相關的用假服務商的對抗模式。
