# M4-cyberware

- 交給：cpp-feature（sonnet）
- 目標：新功能 `cyberware`：身上的義體。部位與槽、把一件成品裝上去與拆下來的手術（四種人動刀）、沉溺成本墊高下限、義體的效果、休養與併發症。橋、甲板、戰鬥、授權鎖是後面四張。
- 規格出處：CYBERWARE 第 1～3 節；CRAFTING 第 8.1 節（生體件哪裡不同：只看安裝、沉溺成本、拆下來三列）、10.2 節；TRADE 3.4 節（義體安裝、拆義體兩列）；DATA 7.1、3.4 節；dev/adr/0019 第三節與 P1～P6。
- 可以改的路徑：`engine/src/features/cyberware/`（新）、`engine/src/features/index.ts`（**排在 `deckFeature` 前面**）、`engine/tests/features/M4-cyberware.test.ts`。
- 可以用的介面：核心的 `productOf`、`productPrice`、`readProduct`、內容種類 `blueprint`（`kind: 'cyberware'`）、`part`、`quirk`；`k.passives.register`（來源 `cyber`、`quirk`）；衍生數值 `sink_floor`（`features/character` 定義）；條件 `at_facility`（`features/world`）、`at_home`（`features/rest`）、`ability`（M4-abilities-m4 會註冊；沒有人註冊時「自己動刀」不列）；`makeCheck`、`checkParts`、`deriveRng`；核心的 `item`（依 `uid`）、`actor.ext`、`actor.track`、`actor.condition`、`cred`／`cash`、`time` 變更；`k.conditions.register`、`k.stats.defineStat`；掛點 `scene.body`（`features/scene` 在 M4-scene-seats 宣告，用名字掛）。
- 不可以做的事：不 import 別的功能；橋那一槽這一張先擋（「換橋是另一種手術。」，M4-cyber-bridge 打開）；不做授權鎖、二手的殘響與惡意韌體、戰鬥、甲板；不做生體件的成長；身上義體換零件（小手術）留給 M4-craft-salvage 的下一步，這一張不做；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `actor.ext.cyber = { pieces: CyberPiece[] }`。`CyberPiece`＝核心的 `ProductData` 加上：`bp`（設計圖的 id）、`slot`（`bridge`、`brain`、`eye`、`ear_throat`、`torso`、`skin`、`arm_l`、`arm_r`、`leg_l`、`leg_r`、`intimate`）、`sink`（裝上時算定的沉溺成本）、`at`（裝上的時間，分鐘）、`ready_at?`（休養到什麼時候；沒有就是已經好了）、`off?`（`{ why, until? }`：不生效）、`registered?`（正規診所裝的是 true：登記在橋 ID 上；無照、黑診所、自己動刀是 false）。資料壞掉的讀成沒有那一件，不丟錯。
- 規則 `cyber_rule`（`overridable`，id `default`）：`slots`（每個部位幾槽：1、3、2、2、3、2、2、2、2、2、2）、`surgeons`（`clinic`、`unlicensed`、`black`、`self` 各一筆：`fee`（成品價的幾成：0.5、0.3、0.4、0）、`sink_pct`（−10、0、0、0）、`complication`（0、0.10、0.15、0））、`remove_fee_mult`（0.5）、`recovery_minutes`（照侵入度：0、240、1440、2880、5760）、`bio_recovery_mult`（3）、`mixed_sink_mult`（0.5）、`surgery_minutes`（60）、`self_requires`（條件的陣列，預設 `[{ kind: 'ability', daily: 'surgery' }]`）、`self_skill`（`cyberware`）。
- 設施種類多讀 `clinic?: { grade: 'clinic' | 'unlicensed' | 'black' }`。
- 衍生數值：`surgery_sink_pct`（動刀的人讓沉溺成本加減百分之幾；基礎 0，別人加 provider；夾在 −25～0）。
- 條件 `cyber`：`{ slot?, bp?, tag?, min? }`（身上有幾件符合的，預設至少 1；`tag` 對設計圖的 `tags`）。
- 報告：`cyber.install`、`cyber.remove`。匯出：`cyberOf(state, actor)`、`pieceSink(k, state, bpId, data, opts)`、`surgeons(k, state, actor)`（這裡有哪幾種人可以動刀、各自的原因）、`installBlock`／`installDraft(k, state, { actor, uid, side?, via, by?, pay? })`、`removeBlock`／`removeDraft(k, state, { actor, uid, via, by?, pay? })`、`installQuote`（手術費、沉溺成本、休養多久、併發症的機率、自己動刀的 DC 與加值）、`cyberView`（每個部位的每一槽、每一件的名字、等級、成本、狀態、效果的清單）。

## 要做的

1. 裝上：背包裡那一疊要是義體的成品（設計圖 `kind: 'cyberware'`）、必要的零件都在（`productOf().missing` 是空的）、那個部位還有空槽（`arm`、`leg` 要給 `side`）、`needs_bridge` 的要有橋、這裡有那一種人可以動刀、錢夠。原因一條一句。
2. 沉溺成本（P2）：`sink_cost`＋零件 `stats.sink` 的合計；全生體 0；有接面的 ×`mixed_sink_mult` 無條件捨去；再乘（100＋動刀的人的 `sink_pct` 與 `surgery_sink_pct` 取比較好的那個）％，四捨五入，最少 0。
3. 自己或隊友動刀（`via: 'self'`，`by` 是動刀的人，預設是被裝的人自己）：`by` 要通過 `self_requires`，要在住處或診所；擲技術＋義體學對標準 DC（設計圖等級 I～V：10、13、16、19、22）。大成功成本 −1；成功照常；失敗裝上但多一筆併發症（從 `quirk` 裡 `pool` 含 `complication` 的抽）；大失敗沒裝上、東西還在背包、被裝的人沉溺 +1。診所不擲，照機率留併發症。骰子用 `deriveRng`（用途帶 `uid`）。
4. 寫進狀態：背包那一疊拿掉（依 `uid`）、`pieces` 多一件、扣錢、時間加 `surgery_minutes`、`ready_at`＝現在＋休養（生體 ×3），角色掛狀況 `recovering`（`until` 是身上最晚的 `ready_at`）。沉溺低於新的下限就補到下限（一筆 `actor.track`）。
5. 被動效果（來源 `cyber`）：每一件都給 `{ stat: 'sink_floor', amount: sink }`（休養中、`off` 的也給）；已經好了而且沒有 `off` 的再給設計圖的 `effects`、每個零件的 `effects`、板材 `stats.armor` 的合計（一筆 `{ stat: 'armor' }`）。帶著的 `quirk` 的 `effects` 用來源 `quirk`。
6. 拆下：費用是安裝費 × `remove_fee_mult`（自己動刀不收、照樣擲，失敗時一個隨機的零件報廢）；`off.why === 'lock'` 的拆不了（「有授權鎖，要先解鎖。」）；橋這一張不能拆。拆下來的變回背包裡的一疊，`state: 'used'`；全生體的那一件直接沒有了（結果的句子寫明），混裝的只留下機械的零件。下限跟著降，沉溺本身不動。
7. `scene.body`（只在問的 `layer` 是 `meat` 時回答；內海用的是化身）：回答這個人每一件好了的義體的 `scene_parts`（多出來的部位、各部位敏感度的修正；皮膚類寫 `all` 的展開到每個部位）。
8. 規則的數字都從 `cyber_rule` 讀。

## 驗收條件（`engine/tests/features/M4-cyberware.test.ts`；測試自帶義眼（一般、成本 3）、義臂（侵入、成本 6、板材 `stats.armor: 2`、`effects: [{ attr: 'body', amount: 1 }]`）、全生體的獸耳、三種診所的設施、兩筆併發症）

- 正規診所裝義臂：扣成品價的五成、成本是 6 的九成四捨五入（5）、`sink_floor` 是 5、沉溺 0 的人被補到 5、時間 +60 分鐘、`recovering` 掛到一天後。休養中體格與護甲沒有變；時間過了一天之後體格 +1、護甲 +2。
- 黑診所：扣四成；把骰子固定在 0.1 會留下併發症、固定在 0.9 不會。無照同理（門檻 0.10）。
- 自己動刀：沒有人註冊條件 `ability` 時這一項不列；測試註冊一個永遠成立的之後列出來；四種成功程度各一條（成本 −1、照常、多併發症、沒裝上且沉溺 +1 且東西還在）。
- 槽：腦三槽裝第四件被擋；左臂滿了右臂還能裝；`arm` 沒給 `side` 被擋。缺零件的成品被擋並寫出缺哪一種。沒有橋的人裝 `needs_bridge` 的被擋、裝寫了 false 的可以。
- 全生體：成本 0、休養是三倍；拆下來之後東西沒有了。義臂拆下來：背包多一疊 `state: 'used'`、零件一個不少、`sink_floor` 回 0、沉溺還是 5。
- 條件 `cyber`：`{ slot: 'eye' }`、`{ min: 2 }` 的真假對。`scene.body` 的回答含獸耳多出來的部位。
- `actor.ext.cyber` 被改壞（`pieces` 是字串、某一件沒有 `bp`）時讀成沒有，不丟錯；存檔再讀一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-product、M4-core-passive。做完才能開 M4-cyber-bridge、M4-cyber-battle、M4-cyber-lock。

## 完成時回報

改了哪些檔、測試結果、手術費有沒有乘區的倍率（這一張先不乘，列出來）、CYBERWARE 第 3 節那六件雙面效應裡 `effects` 寫不出來的（預期：痛覺編輯器的「生命值顯示變模糊」、記憶庫的「被駭時讀走」、駭入接頭）。
