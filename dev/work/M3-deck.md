# M3-deck

- 交給：cpp-feature（sonnet）
- 目標：新功能 `deck`：甲板（M3 先當一件成品）、構裝槽、構裝、SKIN、腳本；算出 RAM、槽數、防火牆、防護；把武器構裝與腳本帶進內海戰鬥，並把甲板的樣子放到戰鬥的單位上（兩個戰場都放）。
- 規格出處：CYBERSPACE 4.1～4.3 節、6.1 節（對照表的武器與護甲兩列）、6.3 節開頭的公式；NETRUNNING 第 1 節；ITEMS 11.1 節（等級的加值）、11.9 節「怎麼存、怎麼裝」、5.2 節腳本那一條（一次最多帶甲板等級 ＋1 支）；DATA 7.3、7.4 節；dev/adr/0018 第三節與 N9、N29、N33。
- 可以改的路徑：`engine/src/features/deck/`（新）、`engine/src/features/index.ts`（**排在 `hackFeature` 前面**）、`engine/tests/features/M3-deck.test.ts`。
- 可以用的介面：`k.content.defineKind`、`k.stats.defineStat`／`addStatProvider`（`ram_max` 已經有人定義）、`k.battle.loadout`、`k.battle.on('unit.ready')`、`k.battle.onEnd`、核心的 `item` 變更（背包）、`actor.ext` 的變更、`weaponFromClass`、`battleAttr`、`modeOf`、`k.activity.active`、`time` 變更。
- 不可以做的事：不 import `features/hack`、`features/gear`、`features/abilities`（槽數的加成由它們加 provider；快駭程式只認內容種類 `quickhack` 的 id，沒有人定義那個種類時不收）；不做義體與手術、組裝、掃橋、商店、染色、牌子的脾氣與怪癖（欄位收下不讀）；構裝體只收資料；SKIN 不接風格與曝露度；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 內容種類 `deck`（暫定的成品格式）：`name`、`desc`、`grade`（1～4）、`slots`（構裝槽）、`firewall`、`ram?: { max?, regen? }`、`cooling?`（潛入時每回合感載多消退幾點）、`brand?`、`legal`、`price?`。
- 內容種類 `construct`（DATA 7.3）：`class`（`weapon`、`defense`、`tool`、`hack`、`body`、`unique`）、`series?`、`grade`、`slots`（佔幾槽，預設 1）、`brand?`、`legal`、`price?`；武器：`archetype`（`weapon_class` 的 id）、`type`（`neural`、`pleasure`、`jam`）、`ram`、`dice?`、`range?`、`cover_mult?`、`traits?`；防護：`guard`；工具：`ap`、`ram`、`passive?`、`target?`、`do?`（效果清單，`k.battle.effectProblems` 要過）、`mods?`；駭入程式：`admin?`（原樣收下，M3-netadmin 讀）；共通：`advanced?`、`ultimate?`（`{ do?, mods? }`）、`quirk?`。
- 內容種類 `skin`（DATA 7.4）：照表收，引擎只讀 `name`。
- `actor.ext.deck`：`{ uid?: string, rental?: { deck: string }, slots: string[], skin?: string, scripts: Array<{ item: string; qty: number }> }`（`uid` 是背包裡那一副甲板的 `data.uid`；`rental` 是租來的，蓋過自己的）。
- 衍生數值：`deck_grade`、`deck_slots`、`deck_firewall`、`net_guard`、`ram_regen`（基本 2）；`ram_max` 加一個 provider；`deck_slots_reserved`（被招牌能力的專屬構裝佔掉的槽，別人加 provider，基本 0）。
- 報告：`deck.equip`（裝上或換一副甲板）、`deck.install`、`deck.remove`、`deck.skin`、`deck.scripts`。
- 效果 `deck_rental`（`{ deck: 甲板的 id | null, who? }`；內建的來源才收，`ai: false`）：給一副租來的甲板，或收回。潛艙店與迷宮館的比賽甲板用（M3-dive、M3-maze）。租來的蓋過自己的；租用期間自己裝著的構裝超過租來的槽數時，照槽的順序只算前面幾件。
- 匯出：`deckOf(k, state, actor)`（有沒有甲板、等級、防火牆、槽數、用掉幾槽、裝著的每一件與它的種類）、`installBlock`／`installDraft`、`removeDraft`、`equipDraft`、`skinDraft`、`scriptsDraft`、`deckView`（給畫面：每一格、背包裡裝得上的、為什麼裝不上）。

## 要做的

1. 甲板：背包裡有那一副才裝得上；沒有甲板時槽數是 0、沒有 RAM。換甲板時槽裡裝不下的構裝退回背包（還在背包裡，只是不在槽上）。
2. 構裝槽：構裝與快駭程式共用同一排。裝一件要背包裡有、等級不超過甲板能跑的（不擋，只在 `deckView` 標出「會照甲板的等級跑」）、槽夠（`deck_slots − deck_slots_reserved − 用掉的`）；同一件不能裝兩次。每裝或卸一件花 1 分鐘。**戰鬥中、網內的行程進行中（進行中的活動有 `face.net`、`netrun`、`dive`）不能換**，原因各一句。
3. 腳本：帶 `script` 標籤的道具；帶的總數不超過甲板等級 ＋1；沒有甲板不能帶。
4. 衍生數值：防護取裝著的防護構裝裡最高的一件（N9）；甲板的 `ram` 加在 `ram_max` 與 `ram_regen` 上。
5. 進戰鬥（`loadout`，只在內海）：每個裝著的武器構裝變成一把武器——從原型（`weaponFromClass`）起算，等級照 ITEMS 11.1（II 命中 +1、III 命中 +1 與多 1 顆骰、IV 命中 +2 與多 2 顆骰），沒有彈匣、`pool: { ram }`，傷害類型照 `type`（`jam` 的是神經加特性 `jam`），命中用原型的屬性照戰場代替過的（`battleAttr`）加基本功，固定傷害是 mod(魅力)；腳本當快取格。裝著的構裝各自的 `mods` 經 `k.battle.modifier` 生效（被動的工具）。
6. `unit.ready`（兩個戰場）：有甲板的角色 `unit.ext.deck = { grade, firewall, slots: 裝著的快駭程式 id, constructs: [{ id, class, grade }] }`；沒有甲板的 `pools.ram` 拿掉。
7. 戰鬥結束：用掉的腳本從背包與 `scripts` 扣掉（照 `features/gear` 處理快取格的做法自己寫一份）。
8. SKIN：背包裡有才穿得上；戰鬥中、不在接入點也可以換這一條先不管（接入點是 M3-dive），只擋戰鬥中。
9. 規則的數字（等級的加值、腳本的上限、換一件幾分鐘）放規則的內容種類 `deck_rule`。

## 驗收條件（`engine/tests/features/M3-deck.test.ts`；測試自帶一副 II 級甲板、三個武器構裝（步槍原型 III 級、近戰原型、干擾）、兩個防護、一個被動工具、一支腳本、一套 SKIN；`weapon_class` 用測試自己的三筆）

- 沒有甲板：`deckOf` 說沒有、槽數 0；進內海戰鬥沒有 `pools.ram`、沒有武器；裝構裝被擋，原因是「沒有甲板。」這一類的完整句子。
- 裝上甲板：`deck_slots`、`deck_firewall`、`deck_grade` 等於資料；測試加一個 `deck_slots` 的 provider（+2）與 `deck_slots_reserved`（+1），能用的槽是 資料 +2 −1。
- 裝第五件（四槽）被擋；同一件裝兩次被擋；背包裡沒有的被擋；每裝一件時間 +1 分鐘；卸下之後槽空出來。
- 戰鬥中裝構裝被擋；測試用替身活動（kind `netrun`）進行中時也被擋。
- 內海的 loadout：III 級步槍原型的那一把骰數是原型 +1、命中是 mod(反應) ＋ 槍械 ＋1、`flat` 是 mod(魅力)、`pool.ram` 是資料的、沒有 `mag`、類型神經；近戰原型的那一把命中用意志；干擾的那一把帶 `jam` 特性。現實的 loadout 不含它們。
- 兩個防護構裝（2 與 4）：`net_guard` 是 4。
- 腳本：II 級甲板最多帶 3 支，第 4 支被擋；進內海戰鬥在 `quick`；戰鬥裡用掉一支，結束之後背包與 `scripts` 各少一支。
- `unit.ext.deck` 在現實與內海的戰鬥都有；和 `hackFeature` 一起裝（`deck` 在前）：給主角 `quickhack` 標籤與一支裝在槽裡的快駭程式（測試自己的一筆），現實戰鬥裡他有 RAM、圓環上有那支程式。
- 效果 `deck_rental` 給一副 2 槽的甲板：`deckOf` 用它的數字、四件裝著的只算前兩件；收回之後回到自己的。AI 與玩家要的這個效果被擋。
- `actor.ext.deck` 被改壞（`slots` 不是陣列、`uid` 指到不存在的那一疊）時讀成沒有甲板或空的槽，不丟錯。
- `deck`、`construct`、`skin` 的格式檢查各擋得下三種寫壞的資料；`construct` 的 `do` 用了沒有人註冊的效果被擋。
- 存檔再讀，甲板與槽一樣；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-core-battle（`guard_stat`、`battleAttr`、內海沒有空手）。做完才能開 M3-netcombat、M3-ui-deck。

## 完成時回報

改了哪些檔、測試結果、DATA 7.3 與 ITEMS 第 11 節裡收下但沒有讀的欄位清單、M4 義體接上時要換掉的地方（預期：甲板的來源與裝卸）。
