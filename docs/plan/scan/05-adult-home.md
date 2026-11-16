# 05 成人向／契約／房屋／家庭 區域掃描（ElondiaRPG → 賽博龐克新作）

> 唯讀掃描，未改動 repo。範圍：`src/engine` 的 31 個模組（共 7263 行）＋相關文件。
> 路徑前綴一律是 `/home/user/yellow630914/elondiarpg/`。

## 0. 沒有驗證的事（先講）

| 項目 | 狀況 |
|---|---|
| `docs/FAMILY.md`、`docs/ADULT_EVENTS.md` | 只看了章節標題，內文沒讀；家庭的結論來自程式碼的 import 與註解 |
| `docs/COMPANIONS.md`（主奴規則的正式文件） | 沒讀；契約的結論來自 `slavery.ts`、`bondStyle.ts`、`masterHome.ts` 與 `slavery.json` |
| Vue 元件（`HomePanel.vue`、`ContractDialog.vue`、`OwnedSlavesDialog.vue`、`MasterEventPanel.vue`） | 只 grep 了呼叫的 store 方法與引用的規則，沒逐行讀；「規則寫在引擎外」的清單可能不完整 |
| `combat.ts` 的「慾望戰鬥」（回合制的慾望值） | 不在本區，只從註解知道存在；它是否適合當回合制親密場景的底子沒有評估 |
| `slavery.json` 的 101 件事件的內容 | 只統計了數量與欄位，沒逐件看 |
| 測試 | 沒有執行；只確認了有哪些 spec 檔 |
| 「未使用的匯出」 | 用文字比對（整個 `src`）算的，動態存取（`import * as x` 後 `x.foo`）已算在內，但字串式存取不會被算到 |
| R31 在 ROADMAP 的狀態欄 | 輸出被截斷，只看到「計畫定稿（2026-11-11）」；以程式碼為準（沒有 `staff.ts`） |

---

## 1. 房屋系統（最重要）

### 1.1 現在程式裡有什麼

| 功能 | 狀態 | 位置 |
|---|---|---|
| 待售空地（每座聚落 1～4 塊，從固定地圖依雜湊挑，不存檔） | 有 | `homes.ts` `lotsOf`、`isLotCell`、`overlayLots`、`lotPrice` |
| 買房（一次付清；售價 = 地段價 × 當地物價） | 有 | `homes.ts` `buyHome` |
| 租房、賣房、貸款 | **沒有**（賣房在計畫裡明寫「不做」） | — |
| 房屋類型：4 種地段（小屋／連棟／宅邸／豪宅），差在層數、地下室、每層尺寸、院子、隔間數 | 有，但**買了就固定，不能升級** | `data/rules/homes.json` `districts`；`homes.ts` `generateHome`、`buildFloor` |
| 房間 | 只有**幾何上的隔間**（二分切割＋門），沒有房間的身分、用途、名稱 | `homes.ts` `generateHome`（內部的切割函式） |
| 家具：格子上擺一件，`places`（室內／院子／地下室）＋ `function`（`bed`、`workbench`、`garden`、`training`、`crib`）＋ `comfort` | 有 | `homes.ts` `placeFurniture`、`takeFurniture`、`furnitureIn`、`comfortOf`、`hasBed`、`workbenchFor`、`trainingRoomOf`；型別 `data.ts` `FurnitureSpec`（2373 行） |
| 儲物 | **沒有**（行囊是全隊共用、無上限） | — |
| 住的人：只有「留守的隊員」（不算離隊、不佔隊伍人數、站在一樓固定一格） | 有 | `homes.ts` `stayHome`、`stayAt`、`parkMember`、`unparkMember`、`leaveWithResident`、`residents`；`away.ts` `sendHome`、`awayCompanions` |
| 住的人：非隊員的同居人、家僕、訪客 | **沒有** | — |
| 在家長休：要有床、免費；舒適度 ≥ 6 全隊得到 `well_rested` | 有（單一門檻） | `rest.ts` 140、287、320～322 行；`homes.json` `comfort_rested` |
| 高階工作台（在自己家裡工具階級升級；留守的人也能幫忙做） | 有 | `crafting.ts`（`workbenchFor`、`residentsHere`） |
| 種植（苗圃家具＋種子，天數到了收成；作物記在格子的 `crop`） | 有 | `garden.ts` `plant`、`uproot`、`harvest`、`cropStatus`、`seedsFor` |
| 調教室（家具加值合計上限 3；留守的奴隸每天順從 +1） | 有 | `homes.ts` `trainingRoomOf`；`ownerTraining.ts` `trainingDcMods`；`lewd.ts` `lewdDaily`（366 行附近） |
| 搖籃、住在家裡的嬰兒 | 有（屬家庭系統） | `children.ts` `cribRefusal`、`childrenAtHome` |
| 房屋事件 | **幾乎沒有**：只有「奴隸主動找主角」事件有 `at_home` 條件（16 件裡 2 件）；沒有以房子為範圍的事件導演 | `slaveEvents.ts` `slaveEventFits` |
| 主人的家（主角是奴隸時；另一套、不可擺家具、不存地圖） | 有 | `masterHome.ts`、`homeResolver.ts` |
| 用餐 `meals.ts` | 是**酒館**的菜單，和房屋沒有任何連結（匯入它的只有 `TavernPanel.vue` 與 store）；家僕計畫的「廚師早餐」才會用到用餐狀態 | `meals.ts` `mealMenu`、`eatMeal` |

### 1.2 資料模型

| 資料 | 位置 | 內容 |
|---|---|---|
| `state.homes: Record<id, Home>` | `types.ts` 836 行 `Home` | `id`（`h<n>-<地點>`）、`name`、`location`、`district`、`lot{area,x,y,street}`、`bought`、`price_cc`、`floors[]`（各層的區域 key）、`areas{key→Area}`（整張格子地圖存進存檔）、`master?`、`household?`（後兩個只給主人的家） |
| 家具與作物 | `grid.ts` `Cell.furniture`（物品名）、`Cell.crop`（種子＋播種時間） | 記在格子上，跟著 `Home.areas` 存檔 |
| 留守的人 | `NpcRecord.staying`（房子 id 或 `tavern:<地點>`）、`stayingSince`、`character`（整個角色）、`at` | 存在 `state.npcs` |
| 主人的家 | `state.masterHome`（主人、城市、規格、家裡的人）；`ContractRef.home`、`strict` | 地圖每次即時生成 |
| 規則資料 | `data/rules/homes.json`（`districts`、`by_location`、`noble`、`lots`、`comfort_rested`）；`items.json` 的 `furniture` 類別與 `seed` 欄位；`slavery.json` `master_home` | — |
| 區域 key | `home/<房子 id>/<B1｜F1｜F2…>` | `grid.ts` `getArea` 直接從房子讀 |

### 1.3 三份計畫：做完／沒做

**結論：三份計畫（R30 儲物、R31 家僕、R32 擴充）在程式碼裡完全沒有開始。** 驗證方式：沒有 `storage.ts`、`staff.ts`；全引擎搜不到 `comfort_tiers`、`furniture_sets`、`cohabit`、`Cell.storage`、`aging`、`construction`、`teleport`、`chore`；`FurnitureSpec.function` 仍是原本五種；`homes.json` 沒有 `staff` 段。

| 計畫 | 編號 | 要加的東西 | 資料欄位（計畫） | 狀態 |
|---|---|---|---|---|
| STORAGE（R30，定稿） | S1 | 家具功能 `storage`、5 種箱子、容量以「幾種東西」計、裝著東西不能收起 | `FurnitureSpec.slots/money`、`Cell.storage{items,money_cc}` | 未開始 |
| | S2 | 在家做工藝、播種時把全屋的箱子當行囊的延伸 | `homeStock`、`takeFromHome` | 未開始 |
| | S3 | 保險箱存錢，戰敗與契約的收益歸屬不動到 | `Cell.storage.money_cc` | 未開始 |
| | S4 | 編輯器欄位、給 AI 的一句說明 | — | 未開始 |
| HOUSEHOLD_STAFF（R31，定稿） | H1 | 應徵者（每城每 7 天一批）、雇用／解雇、工錢欠著回家結清、欠 7 天辭職、女僕（舒適 +2）、廚師（長休後用餐狀態） | `NpcRecord.staff{home,job,wage_cc,paidUntil,since}`、`homes.json` `staff` | 未開始 |
| | H2 | 園丁每天收成、重新播種（要 S1） | — | 未開始 |
| | H3 | 管家：上限 +1、從保險箱付工錢（要 S3） | — | 未開始 |
| | H4 | 邀請認識的人當家僕；留守的奴隸分派家務 | `NpcRecord.chore` | 未開始 |
| | H5 | 編輯器、給 AI 的家僕說明 | — | 未開始 |
| | H6 | **家僕事件**（`scope: "home"`，在家走動、長休醒來時觸發；含成人向） | `requires.staff*`、效果 `staff_pause`、`staff_wage` | 未開始（清單仍是草案） |
| HOME_EXPANSION（R32，第一版草案，各項「待確認」） | X1 | 舒適度三段（6／12／20） | `homes.json` `comfort_tiers` | 未開始 |
| | X2 | 擴建：加蓋樓層、挖地下室、擴院子，有工期 | `Home.construction{kind,until}` | 未開始 |
| | X3 | 房間用途（臥室、書房、工坊、酒窖、客房、育嬰室） | `Home.rooms` | 未開始 |
| | X4 | 成套家具 | `furniture.set`、`furniture_sets` | 未開始 |
| | X5 | 熟成桶、酒窖 | `Cell.aging`、物品的 `aging` | 未開始 |
| | X6 | **同居**（親密度 80 以上的人搬進來，要空床，上限 2～3 人） | `NpcRecord.cohabit{home,since}` | 未開始 |
| | X7 | 兩棟自己的房子之間的傳送陣 | 家具功能 `teleport` | 未開始 |
| 計畫明寫不做 | — | 賣房、在家收信、地下室囚室、養魔物幼體、小偷、避風頭、密室；**訪客事件、出租、自家開店只在點子庫（I31）** | — | 不做／只是點子 |

### 1.4 對照新作 HOME 的需求

| 新作需求 | ElondiaRPG 有沒有 | 說明 |
|---|---|---|
| 自己的公寓 | 部分 | 有「買下一棟」，沒有租、沒有月費 |
| 升級 | 沒有 | 只有 X2 的草案；現在地段買了就固定 |
| 家具 | 有 | 這塊最完整，資料驅動（`FurnitureSpec`） |
| 住在這裡的人 | 部分 | 只有留守的隊員；同居（X6）、家僕（R31）都只是計畫 |
| 訪客 | 沒有 | 連計畫都沒有，只在點子庫 |
| 房屋事件 | 沒有 | H6 是草案；可重用的是「主人事件格式」＋事件導演 |

**移植建議**：房屋的「格子地圖」與聚落固定地圖、`grid.ts` 綁得很深（空地從城鎮地圖挑、門是 `link` 格、家具擺在格子上）。公寓不需要逐格地圖時，建議只帶走**資料模型的想法**（家具 = 物品＋功能＋舒適度、住的人記在 NPC 登錄、舒適度影響休息），房間改成具名的房間清單，重寫 `homes.ts`；三份計畫的設計文件（特別是 R31 的工錢／辭職、R30 的容量規則、X6 的同居條件）可以直接當新作的規格草稿。

---

## 2. 契約系統

### 2.1 組成

| 部分 | 怎麼運作 | 位置 |
|---|---|---|
| 契約本體 | 一枚「印記」＝ 一份條款 `MarkTerms`（收益比例、談判／逃離／出城 DC、被找到機率、逃離反噬、服從懲罰、順從累積天數、副作用）。4 個模板（勞役、戰奴、魔導束縛、娼妓），也可自訂（數值夾在 `custom_mark` 的範圍）。功能由數值推得 | `slavery.ts` `termsFromTemplate`、`sanitizeTerms`、`deriveFunctions`、`makeContract`；`types.ts` `ContractRef`（432 行）、`MarkTerms`（510 行）；資料 `slavery.json` `contracts` |
| 契約存在哪 | 角色身上的一個刺青（`tattoos.ts` `contractOf`、`setContract`），不是獨立的狀態表 | `tattoos.ts`（不在本區） |
| 兩個方向 | 主角是被約束的一方（主人以隊長身分入隊）；主角是持有的一方（奴隸是隊員，`bond: 'slave'`） | `party.ts` `enslavePlayer`、`changeMaster`、`freePlayer`、`recapturePlayer`、`isBound`、`isFugitive`；`ownedSlaves.ts` `ownedSlaves`、`isOwnSlave` |
| 數值 | 親密度：`state.relationships[id].affinity`（事件門檻、DC 減免、關係解鎖）。服從懲罰：`ContractRef.obedience`（對主人檢定的減值，受罰會加重，上限 `freedom.obedience_max`）。順從：慾望指標 `submission`（0～100，屈服容易、抵抗變難）。嚴加看管：`ContractRef.strict.points`（出門、出城更難，隨天數衰減） | `party.ts` `punish`；`slavery.ts` `stanceModifiers`；`masterHome.ts` `strictPoints`、`addStrict` |
| 關係風格（bond styles） | 5 種：名實相符（預設）、夥伴、情趣、激烈、戀人。親密度 60 解鎖、掉到 40 以下暫時失效。**只影響敘事與事件權重，不改任何契約數值**。存在 `ContractRef.style` | `bondStyle.ts` `bondOf`、`pcBond`、`bondStatus`、`bondChoiceBlocked`、`setBond`、`bondWeight`、`bondPromptLine`、`bondFocus`；資料 `slavery.json` `bond_styles` |
| 事件（核心） | 共用一個「主人事件格式」`MasterEventDef`：文字、權重、時數、最多 4 個回應（每個可帶檢定、成功／失敗效果、`stance: submit｜resist`、`adult_scene`、`learn`），條件有親密度範圍、對方標籤、`at_home`、`bonds`、`bond_weights`。5 個事件庫：`master` 58 件、`owner`（調教）18 件、`slave`（奴隸主動）16 件、`brothel_work` 9 件、`brothel_train` 9 件。同一時間只有一件等待回應：`state.pendingMasterEvent` | `data.ts` `MasterEventDef`（1608 行）、`MasterEventOption`（1694 行）、`masterEventPool`；`slavery.ts` `maybeMasterEvent`、`eventFits`、`startMasterEvent`、`eventChoices`、`eventRoles`、`answerMasterEvent` |
| 命令與抵抗 | 回應帶 `check{attr,dc,skill}` 就擲 1d20；`stance` 依順從加減；也可以自己輸入回應交給 AI 判定（`setupMasterEvent` → `applyMasterEventResponse`／`masterEventDefaults`） | `slavery.ts` 762～885 行 |
| 許可 | 出城、旅行、走出主人的家都要先過檢定拿「許可」（有期限、可延長一次）；離家天數有上限，逾期會觸發「主人要回家」 | `slavery.ts` `setupPermit`、`applyPermit`、`setupExtend`、`applyExtend`；`masterHome.ts` `allowedDays`、`permitWindow`、`grantPermit`、`homeDeadline`、`overdueChance`、`sendToMasterHome`、`setupLeave`、`applyLeave` |
| 調教（主角是持有方） | 選課程 → 抽一件 `owner` 事件 → 主角擲骰；DC 依對方順從、親密度、調教室修正；成功累積進度、保證學會技能；失敗且親密度低會反彈、可能逃走 | `ownerTraining.ts` `startTraining`、`trainingDcMods`、`afterTraining`、`courseStatus`；資料 `lewd.json` `training` |
| 管理面板的入口 | 被約束方：`ContractDialog.vue` →「主動找主人」`askableEvents`／`askMaster`（事件定義帶 `ask{group,name,desc,lead,hide}`，58 件裡 20 件可主動觸發，分服侍／親近／管教三組，每天一次）、`masterRelease`、`masterTransfer`、`setBond`。持有方：`OwnedSlavesDialog.vue` → `startTraining`、`sendHome`、`releaseSlave`、`setBond`。回應畫面：`MasterEventPanel.vue` → `answerMasterEvent` | `slavery.ts` 558～620 行；`masterTool.ts`；store `stores/game.ts` 1739～1743 行 |
| 自訂內容 | 5 個事件庫都能在編輯器改；內建的可改不可刪 | `masterEventMods.ts` `sanitizeMasterEvent`、`applyMasterEvent`、`restoreMasterEvents` |
| 其他入口 | 開局就是奴隸 `startAsSlave`；刻印 `setupMarking`／`applyMarking`／`chooseMark`；自願為奴 `voluntarySlave.ts` `takeVoluntarySlave`；戰勝後收為奴隸 `captives.ts` `resolveCaptive`；逃亡後 `setupReturn`、`setupSeekMaster`、解除印記 `setupUnmark`／`applyUnmark` | 各檔 |
| `bindRulesMods.ts` | **不是契約**：是拘束具「雙面效應」（檢定減值／戰鬥增益）的設定編輯器 | 歸到成人裝備 |

### 2.2 事件怎麼被觸發

| 觸發點 | 位置 | 備註 |
|---|---|---|
| 每走一步（機率 0.02，冷卻 6 小時） | **`stores/game.ts` `afterMove`（200、202 行）** | 觸發順序寫在 store，不在引擎 |
| 旅途的事件格（出發時就擺好） | `road.ts` 411、416 行 | — |
| 主動找主人 | `slavery.ts` `askMaster` | 每天一次（`state.masterAskDay`） |
| 選課程調教 | `ownerTraining.ts` `startTraining` | — |
| 逾期「主人要回家」 | `maybeMasterEvent` 裡先擲 `overdueChance` | — |

### 2.3 哪些地方假設「持有者跟著主角走」

| 位置 | 假設 |
|---|---|
| `party.ts` `enslavePlayer`、`changeMaster`、`recapturePlayer` | 成立契約時主人（和他的隊員）**以隊長身分入隊**，主角原本的同伴離隊 |
| `slavery.ts` `maybeMasterEvent`（501 行） | 主人必須在 `state.party` 裡、而且不是 `away`，否則沒有事件 |
| `slavery.ts` `askMasterBlocked`（573 行） | 「主人不在身邊」就不能主動找 |
| `bondStyle.ts` `bondStatus` | 對方不在隊伍裡就不能談關係 |
| `slavery.ts` `eventRoles` | `owner`／`slave` 事件要求那位奴隸在隊伍裡 |
| `masterHome.ts` 整個模組 | 離家期限、出門檢定、嚴加看管、被帶回家，全部建立在「主人帶著主角到處走、但有個家要回」上 |
| `slavery.ts` `setupPermit`、`assertMasterAllows`；`road.ts` | 出城、旅行前向**身邊的**主人請求同意 |
| `slavery.json` 的事件 `at_home`（12 件）、`cell: 'brothel'`（經過娼館時主人把主角推進去） | 位置條件以「兩人在同一格」為前提 |
| `masterTool.ts`、`lewd.json` `servitude` | 主人在場是某個慾望流派（隸從派）生效的條件 |
| 收益歸屬 `income_share` | 主角賺的錢當場分給同行的主人 |

### 2.4 持有者留在別處、命令以事件送達時要改什麼

| 要改的 | 做法 |
|---|---|
| 事件的前提 | `maybeMasterEvent`、`askMasterBlocked`、`bondStatus` 拿掉「在隊伍裡」的檢查，改成「契約有效＋聯絡得上」；新增觸發來源（時間排程、地點、訊息） |
| 事件的角色 | `eventRoles` 的 `other` 改從 NPC 登錄取，不從隊伍取；「誰擲骰就用誰的」規則可以保留 |
| 命令的生命週期 | 現在的事件是**當場回應、當場結算**。遠端命令需要新狀態：命令佇列（多件並存，取代單一的 `pendingMasterEvent`）、期限、回報、逾期後果。`masterHome.ts` 的許可／期限／逾期機率／嚴加看管四件套可以**改造成「命令期限＋違約點數」** |
| 抵抗 | `stance: 'resist'` ＋ `stanceModifiers`（順從越高越難抵抗）＋服從懲罰 `obedience` 已經是「抵抗要檢定」的雛形，可以直接沿用，只需把檢定的時機從「當面」改成「收到命令時或期限到時」 |
| 許可制 | 出城／出門的許可在新設定下多半不需要，或改成契約條款的「活動範圍」 |
| 收益歸屬 | 改成定期結算（轉帳），不是當場分 |
| 管理面板 | `askableEvents` 的結構（分組、名稱、說明、做不了的原因）可以原樣當「面板觸發事件」的資料格式；持有方的 `OwnedSlavesDialog` 對應「我持有的契約」 |
| 不用改 | `MasterEventDef` 格式、`answerMasterEvent` 的結算流程、`bondStyle.ts`（改掉「在隊伍裡」後）、`masterEventMods.ts` |

---

## 3. 成人數值與場景

### 3.1 數值模型

| 項目 | 內容 | 位置 |
|---|---|---|
| 四項角色指標 | `lewdness`、`sensitivity`、`endurance`、`submission`，各 0～100，每 20 一段；存在 `Character.lewd`（另有 `lastScene`、`lastClimax`） | `lewd.ts` `LEWD_STATS`、`baseLewd`、`lewdOf`（有效值 = 基本＋裝備＋刺青＋泌乳）、`lewdPower`、`bandName` |
| 曝露名聲 | 第五項 `exposure`，**依地區**記在 `state.exposure`，每天淡掉、會傳到相鄰地區 | `lewd.ts` `exposureAt`、`exposureLevel`、`vacuumSides`；`charm.ts` `spreadExposure` |
| 成長 | 事件型（`lewd.json` `growth`：親密場景、高潮、接客、服從、被剝衣）＋每日型（穿著、上鎖、沒有契約時順從下降、太久沒有場景時回落） | `lewd.ts` `addLewd`、`growLewd`、`noteAdultScene`、`lewdDaily` |
| NPC 的初始值 | 依標籤與 id 固定擲 | `lewd.ts` `npcLewd` |
| 連動 | 稱號 `lewdTitles`、身價 `slaveValueOf`、魅氣濃度（每座聚落 1～4）`charm.ts` `charmLevel`、戰鬥換算（`lewd.json` `combat`，程式在 `combat.ts`） | — |
| 拘束與鎖 | 被別人鎖上的裝備：掙脫檢定、鑰匙、剪鎖、解咒 | `restraints.ts` `setupUnbind`／`applyUnbind`、`openWithKey`、`cutLock`、`uncurse` |
| 外觀 | 體型（`masc`／`fem`／`andro`）決定內容能不能出現；NPC 依規則穿衣 | `look.ts` `characterBody`；`outfits.ts` `npcOutfit` |
| 娼館 | 消費、打工事件、受訓、頭牌等級、提議夥伴去接客 | `brothel.ts`、`brothelLife.ts` |

### 3.2 場景怎麼觸發與結算（程式 vs AI）

**現在沒有可操作的回合制親密場景。** 場景只是報告上的一個旗標 `report.narration.adult_scene`（一句話的場景標籤），結果是 AI 寫的一段敘事。

| 步驟 | 誰決定 | 位置 |
|---|---|---|
| 進不進場景（事件型） | **程式**：事件有 `scene`，回應的 `adult_scene` 是 `always`／`success`／`fail`，依檢定結果決定 | `slavery.ts` `answerMasterEvent`（822 行附近）；`dungeonEvents.ts`、`townEvents.ts`、`defeat.ts`、`landmarks.ts`、`road.ts` 等同樣寫法 |
| 進不進場景（自由輸入的行動） | **AI 判定**：setup 函式用 `adultScene(label, on)` 宣告；`on` 是空陣列時由 AI 決定；沒有宣告時，判定的提示詞也允許 AI 自己填 `adult_scene` | `content.ts` `adultScene`、`AdultScene`；`narrator/judge.ts` 264～281 行 |
| 數值結算 | **程式**：`commitReport` → `noteAdultScene`（場景主角淫亂成長、記日期）；事件的 `effects` 走 `effects.ts` `applyEffects` | `state.ts` 617 行；`lewd.ts` 290 行 |
| 敘事 | **AI**：有 `adult_scene` 的報告走成人場景的寫手與模型來源，其他走一般敘事 | `narrator/compose.ts` 68、83 行；`narrator/prompt.ts` `adultSceneOf` |
| 場景的主角不是玩家 | `narration.adult_actor`（指標記在他身上）、`defeat_victim`、`brothel_work` | 同上 |

新作要做「AI 決定進場、之後回合制操作」時：進場判定（`adultScene` 宣告＋判定回傳 `adult_scene`）可以沿用；回合制本體要新寫。`combat.ts` 的慾望戰鬥是唯一現成的回合制慾望值機制，但不在本區、沒有評估。

### 3.3 性經歷記錄

| 步驟 | 內容 | 位置 |
|---|---|---|
| 資料 | `state.sexRecords: Record<角色 id, SexRecord>`（主角的 key 是 `pc`）：`virgin`、`first{day,with,note}`、`partners`／`times`、`servicePartners`／`serviceTimes`、`forced`、`solo`／`soloLast`、`favorite`、`notes`、`recent[]`（最近 3 次）、`known[]`／`serviceKnown[]`（認人用，有上限） | `types.ts` 309 行 `SexRecord`、`SexEncounter` |
| 初始值 | 還沒有記錄的人依 id 固定擲（不寫進存檔）；固定 NPC 可指定 | `sexRecord.ts` `npcSexSeed`、`sexRecordOf`、`pcExperience`、`seedsVirgin` |
| 何時記 | 帶 `adult_scene` 的報告（戰鬥中只有挑逗的不算）寫完敘事之後，**另外一次 AI 呼叫** | `sexRecord.ts` `intimateReport`；**`stores/game.ts` `recordSex`（561 行）** 在 431、1162、1334、1338 行被呼叫 |
| 提示詞 | 送出候選人名單與各自目前的記錄、報告摘要與時間線、敘事（超過 6000 字時留頭尾）；要求只回 JSON `{"records":[…]}` | `narrator/sexLog.ts` `buildSexLogPrompt`（68 行的小模組）；`sexRecord.ts` `sexCandidates`、`sexRecordText` |
| 驗證與寫入 | 只收名單上的人、次數與對象數有上限、認得的對象不重複算人數、第一次時記初體驗並調整指標 | `sexRecord.ts` `applySexUpdates` → `addEncounter` |
| 防重複 | `state.sexLogged`（最近 50 則報告 id）；等 AI 時讀了別的檔或回退了日誌就丟掉回應 | `sexLogged`、`markSexLogged`；store 的檢查 |
| 其他寫入來源 | NPC 自己的日子（`npcLife.ts` 直接呼叫 `addEncounter`）；玩家手動修改 `editSexRecord` | — |
| 給 AI | 成人場景的判定與敘事附上在場的人的記錄，每人一行 | `sexRecordsNote` |
| 開關 | `setSexRecords`／`sexRecordsOn`（模組層級的變數） | `sexRecord.ts` 17～24 行 |

**照搬時要處理的三個點**：(1) `sexRecord.ts` 9 行 import `maybeConceive`，在 `applySexUpdates` 的 386 行附近呼叫——不帶懷孕就要拿掉或換成空的掛鉤；(2) AI 呼叫的流程（逾時、取消、簡繁轉換、用量統計）寫在 `stores/game.ts`，不在引擎也不在 narrator；(3) `sexLog.ts` 的系統提示詞寫死了遊戲名稱與「奇幻 RPG」，並用 `raceName`。

### 3.4 內容篩選

| 機制 | 位置 |
|---|---|
| 7 個可關的標籤：`ntr`、`non_virgin`、`pc_unwilling`、`male_partner`、`pregnancy`、`lactation`、`monster_brood`（後三個預設關）；`adult` 一律允許 | `content.ts` `CONTENT_TAGS`、`DEFAULT_FILTERS`、`setContentFilters`、`tagsAllowed` |
| 依主角體型：`pcBodyAllowed`、戰敗事件的模式 `defeatAdultAllowed`／`defeatCompanionAllowed`、魔物娘 `monsterGirlsFor` | `content.ts` |
| 實作方式 | **模組層級的可變變數**，由設定的 store 在啟動與變更時寫入；引擎各處呼叫 `tagsAllowed([...])` 讀取。不在 `GameState` 裡，所以不跟存檔走、測試之間會互相影響 |
| 契約事件的用法 | 成人向的主人事件要 `pc_unwilling` 開著，但帶 `bonds` 的專屬事件不受限（`slavery.ts` `adultAllowed`） |

---

## 4. 家庭／懷孕：可分離性

### 4.1 被多少模組匯入（不含測試、不含家庭模組彼此）

| 模組 | 行數 | 外部匯入者 | 誰 |
|---|---|---|---|
| `pregnancy.ts` | 541 | 9 | 引擎：`sexRecord`、`effects`、`rest`、`state`；narrator：`compose`、`judge`、`imageInfo`；UI：`BirthPanel`、`PlacePanel`、`CharacterDialog`；store |
| `pregMarks.ts` | 93 | 10 | 引擎：`lewd`、`lactation`、`perks`、`storyFlags`、`mods`、`sources`、`tattooShop`、`landmarks`；UI：`NurseryPanel`、`CharacterDialog` |
| `children.ts` | 239 | 10 | 引擎：`homes`、`restraints`、`purify`、`town`、`tattooShop`；UI：`HomePanel`、`NurseryPanel`、`PlacePanel`、`UncursePanel`、`PartyCards`；store |
| `brood.ts` | 329 | 9 | 引擎：`combat`、`defeat`、`effects`、`landmarks`、`parasiteEvents`；UI：3 個編輯器、`BroodBirthPanel`、`PlacePanel`；store |
| `pregnancyEvents.ts` | 303 | 4 | 引擎：`rest`；UI：`RoadEventPanel`、`eventQueue`；兩個 store |
| `pregCombat.ts` | 29 | 3 | 引擎：`combat`、`combatRelease`；UI：`CharacterDialog` |
| `familyMods.ts` | 181 | 3 | 引擎：`mods`；UI：`FamilyRulesEditor`；store |
| `lactation.ts`（規則資料放在家庭的 json） | 239 | 6 | 引擎：`combat`、`effects`、`inventory`、`landmarks`；UI：`CharacterDialog`；store |

### 4.2 本區要保留的模組裡的耦合點（不帶家庭時要切的地方）

| 位置 | 耦合 | 切法 |
|---|---|---|
| `sexRecord.ts` 9、386 行附近 | `applySexUpdates` 呼叫 `maybeConceive` | 刪一行；最乾淨的做法是改成可註冊的「記錄後」掛鉤 |
| `lewd.ts` 4、55 行 | `lewdOf` 用 `lactatingNow`（泌乳時敏感 +5）；也 import `familyRules` | 刪掉這一項 |
| `homes.ts` 18 行、`takeFurniture` | 收起搖籃時呼叫 `cribRefusal` | 刪掉；家具功能拿掉 `crib` |
| `restraints.ts` 16 行 | `nurseryRefusal` | 刪掉 |
| `slavery.ts` | 沒有直接匯入家庭；只在娼館場景設 `narration.brothel_work`（給受孕判定看的旗標） | 旗標留著無害 |
| `masterHome.ts` | 生成主人家裡的「子女」（`generateHousehold`）——這是 NPC 生成，不是家庭系統 | 不用切 |
| 內容篩選 | `pregnancy`、`lactation`、`monster_brood` 三個標籤預設就是關的 | 新作直接不列 |

**判斷**：家庭系統對本區的入侵很淺（4 個呼叫點），可以乾淨地不帶。真正麻煩的在本區之外：`combat.ts`、`effects.ts`、`rest.ts`、`state.ts`（每日推進的 `familyTick`）、`perks.ts`、`landmarks.ts`、兩個 narrator 檔。因為預設就是關閉的功能，這些呼叫點大多是「有就加、沒有就算了」的寫法，逐一刪除即可，但數量不少（引擎約 20 處 import）。`pregMarks.ts` 是最黏的一個，因為它同時放了 `familyRules`（規則資料的入口）與泌乳的判斷。

---

## 5. 奇幻設定的假設

| 檔案／函式 | 假設 |
|---|---|
| `slavery.ts` `deriveFunctions`、`sanitizeTerms`；`MarkTerms.spell_cap`；模板 `arcane` | 契約功能「魔力封印」：限制可施放的法術環數（0～9） |
| `slavery.ts` 整體、`tattoos.ts` | 契約 = 刻在身體部位上的**魔法印記**；成立要經過「刻印檢定」（`setupMarking`，DC 含主人等級的一半） |
| `slavery.ts` `unmarkOffers`、`setupUnmark`、`applyUnmark`；`slavery.json` `unmark.services` | 解除印記的三種服務：神殿（要聲望）、刻印師、**施法職業的人**（`def.classes` 比對 `m.class`）；另有「誓約印記」`oathStrength` |
| `slavery.ts` `seekMasterDc` | 用 `lifeTier(level)`（生命層級差）算 DC |
| `slavery.ts` `randomMaster`、`startAsSlave`、`masterCandidates` | 主人有等級（上限 20）、種族、職業；`masterCandidates` 用 `newGame({race:'human', classId:'fighter'})` 建暫時的存檔來擲人 |
| `slavery.json` `prices_cc`、`race_group`、`race_mult`、`class_mult` | 身價依生命層級、種族群（人類／魔族／精靈）、職業（法師、牧師、德魯伊……）；公開的奴隸市場與黑市是世界設定 |
| `slavery.json` `master_tags`、`master_home.tag_days` | 主人的身分標籤：貴族、皇族、神官、主教、商人、旅人…… |
| `slavery.ts` `atSafeSpot`、`safe_spots` | 談判只能在旅店、安全房、神殿 |
| `masterHome.ts` `generateHousehold`、`slavery.json` `household` | 家裡的人：伴侶、子女、僕人（管家、女僕、廚娘、園丁、馬夫、侍從、洗衣婦）、奴隸；規格依聚落規模與貴族區 |
| `homes.ts` `lotsOf`；`homes.json` | 聚落類型（村莊、哨站、要塞、城鎮、港口、城市、王都）、貴族區、王城區塊不賣；貨幣「白鸛」 |
| `homes.ts` `parkMember`、`unparkMember` | 角色有 `race`／`class`／`level`；歸隊時執行「職業武器限制」`enforceClassWeapons` |
| `HOMES.md` 家具表、`garden.ts` 的種子 | 鍛造爐、煉金實驗室、魔法物品店、熒光苔蘚、魔乳果等 |
| `lewd.ts` `lewdOf`、`vacuumSides`、`exposureLevel` | 用 `race` 判斷體型與種族的裝備欄位改名（`gearRules.races[race].relabel`） |
| `lewd.json` `schools`、`combat.faith_resist`、`purify` | 八個「慾望流派」；信仰抵抗；神殿淨身降低指標 |
| `charm.ts` | 「魅氣濃度」是世界的魔法氛圍，依地區／聚落 |
| `restraints.ts` `uncurse`、`cutLock` | 詛咒具要到神殿解咒；鐵匠鋪剪鎖；`syncGear(m, classDef(m.class).weapon)` |
| `brothel.ts` `patronPrice` | 價格依對象的種族 |
| `outfits.ts`、`look.ts` | 服裝規則與體型依種族（`bodyOf(race, gender)`、`raceBaseFor`） |
| `captives.ts` | 打贏「冒險者」後的處置；劫財金額依等級 |
| `narrator/sexLog.ts` | 系統提示詞寫死「奇幻 RPG《埃隆迪亞大陸》」，人物說明帶種族 |
| `sexRecord.ts` `storyVirginIds`、`rescueStoryVirgins`、`STORY_VIRGIN_FIX` | 綁定本作特定的任務資料與一次性的舊存檔修正 |
| 全區 | 檢定是 1d20＋屬性（`str/dex/int/fai/cha`）對 DC；五級成功程度 |

---

## 6. 各模組的結論

| 模組 | 行數 | 結論 | 理由 |
|---|---|---|---|
| `homes.ts` | 571 | **重寫**（保留資料模型的想法） | 和聚落固定地圖、格子、空地雜湊綁死；公寓不需要 |
| `homeResolver.ts` | 16 | 不需要 | 只為了解 `homes` ↔ `masterHome` 的循環 import |
| `masterHome.ts` | 530 | **改規則**（拆開用） | 「主人的家」的地圖與家人不需要；許可／期限／逾期／嚴加看管的機制改造成命令期限與違約 |
| `garden.ts` | 93 | 換皮（可選） | 小而獨立；要不要種東西看設計 |
| `meals.ts` | 76 | 不屬於房屋；換皮 | 酒館菜單；之後家裡的廚房可重用用餐狀態 |
| `slavery.ts` | 1205 | **改規則＋拆檔** | 事件引擎（約 400 行）可沿用；條款保留換皮；刻印、解印、許可、建角主人、逃亡要重寫或刪 |
| `slaveEvents.ts` | 73 | 換皮 | 把「在隊伍裡」改成「聯絡得上」 |
| `ownedSlaves.ts` | 27 | 換皮 | 很小 |
| `ownerTraining.ts` | 131 | 換皮 | 課程制的事件，依賴 `lewd.json` `training` |
| `voluntarySlave.ts` | 77 | 換皮 | 「自願簽約」的入口 |
| `masterTool.ts` | 70 | 改規則 | 概念（被約束方保有主導權）可留；流派條件要重想 |
| `masterEventMods.ts` | 187 | 照搬（有內容編輯器才需要） | 只依賴 `data`、`storyMods` |
| `bondStyle.ts` | 154 | **照搬**（文字換皮） | 純敘事與權重，不動數值；只需改掉「在隊伍裡」 |
| `bindRulesMods.ts` | 175 | 不需要（除非帶拘束具的雙面效應） | 是設定編輯器 |
| `captives.ts` | 186 | 改規則 | 戰後處置的流程可用；「收為奴隸」改成簽約 |
| `lewd.ts` | 437 | **改規則** | 四項指標＋曝露的核心可留；流派、種族、泌乳、合煉的連動要剪 |
| `sexRecord.ts` | 505 | **照搬**（切掉 3 處） | 見 3.3；另把模組層級的開關移進設定 |
| `narrator/sexLog.ts` | 68 | 照搬（改提示詞） | — |
| `charm.ts` | 108 | 換皮 | 「地區風氣」對應街區 |
| `brothel.ts` | 110 | 換皮 | — |
| `brothelLife.ts` | 233 | 換皮 | — |
| `lactation.ts` | 239 | 不需要 | 規則資料在家庭的 json，預設關閉 |
| `look.ts` | 32 | 換皮 | 依賴 `traits` 的種族表 |
| `outfits.ts` | 85 | 換皮（曝露度不在這裡） | 這個檔案只管 NPC 穿什麼；**曝露度在 `lewd.ts` `exposureLevel`、`vacuumSides`** |
| `restraints.ts` | 228 | 改規則 | 鎖與掙脫可留；解咒、神殿要換 |
| `pregnancy.ts`、`pregnancyEvents.ts`、`pregCombat.ts`、`pregMarks.ts`、`children.ts`、`brood.ts`、`familyMods.ts` | 1715 | 不需要（暫不移植） | 見第 4 節 |

---

## 7. 重複、沒用到的匯出、引擎外的規則；降低亂度的建議

### 7.1 觀察

| 類別 | 內容 |
|---|---|
| 重複 | `hoursOf`（遊戲時間換成小時）在引擎裡有 8 份相同的實作：`slavery.ts`、`slaveEvents.ts`、`masterHome.ts`、`deadlines.ts`、`townEvents.ts`、`parasiteEvents.ts`、`pregnancyEvents.ts`、`dungeonEvents.ts` |
| 重複 | FNV 字串雜湊（常數 2166136261）在 8 個檔各寫一份：`homes.ts`、`masterHome.ts`、`lewd.ts`、`sexRecord.ts`、`npcs.ts`、`outfits.ts`、`perks.ts`、`market.ts` |
| 重複 | 「現在有別的事要先處理」的長條件（`combat ‖ pendingAction ‖ standoff ‖ pendingMark ‖ pendingMasterEvent ‖ dungeonEvent ‖ parasiteEvent ‖ leadEvent`）寫了 3 次：`slavery.ts` 499、575 行、`slaveEvents.ts` `busy` |
| 重複 | `eventFits`（`slavery.ts`）與 `slaveEventFits`（`slaveEvents.ts`）是同一組條件（親密度、標籤、`at_home`、關係）的兩份 |
| 重複 | `slavery.ts` 的 `forMaster` 與 `forEvent` 都在做「把效果裡的 master 換成對方」；`forMaster` 只剩 `masterEventDefaults` 一處使用 |
| 重複 | 兩個同名不同義的 `needsConsent`：`brothelLife.ts` 184 行、`lactation.ts` 120 行 |
| 重複 | `slavery.ts` 640～642 行有兩段連在一起的 JSDoc（舊的沒刪） |
| 沒用到 | `restraints.ts` `stuckRestraints`、`pregnancyEvents.ts` `PregnancyTemplate`：整個 `src` 沒有其他引用 |
| 只有測試用 | `slavery.ts`：`masterSpecIdentity`、`permitDc`、`eventFits`、`startMasterEvent`、`masterTagDc`、`markStrength`、`oathStrength`、`unmarkRepOk`；`homes.ts`：`lotsOf`、`homeOnLot`、`lotById`；`brothelLife.ts`：`addRank`、`workEventsFor`、`trainingOptions`、`patronTeaches`；`masterTool.ts` `masterToolReady`；`charm.ts` `neighborRegions`；`ownerTraining.ts` `courseTeaches`；`slaveEvents.ts` `slaveEventFits`（這些在檔案內部有用到，只是匯出只為了測試） |
| 匯出但只在檔內用 | `masterHome.ts`：`masterHomeId`、`permitActive`、`clearPermit`、`overdueDays`；`ownerTraining.ts`：`courseIds`、`courseName`、`courseEvents`；`sexRecord.ts`：`emptySexRecord`、`seedsVirgin`；`brothel.ts` `atBrothel` 等 |
| 引擎外的規則 | `stores/game.ts` `afterMove`（190～206 行）：移動後各種事件的**先後順序與機率來源**（敵對 → 歸隊 → 主人事件 → 奴隸事件 → 城鎮事件 → 寄生物）寫在 store |
| 引擎外的規則 | `stores/game.ts` `recordSex`（561 行起）：性經歷的 AI 流程（何時送、逾時、回應作廢的條件）寫在 store |
| 引擎外的規則 | `ContractDialog.vue` 自己從 `slaveryRules` 組出「出城／出門」檢定的說明文字（134、141 行附近）；`HomePanel.vue` 直接比較 `comfort >= homeRules.comfort_rested`（114 行） |
| 結構 | 內容篩選與「性經歷開關」是模組層級的可變變數（`content.ts`、`sexRecord.ts`），不在 `GameState`／設定物件裡 |
| 結構 | `homeResolver.ts` 存在的唯一理由是 `homes` ↔ `masterHome` 的循環 import |
| 結構 | 契約存在刺青裡（`contractOf` 在 `tattoos.ts`），所以所有契約模組都依賴刺青模組 |
| 命名 | `meals.ts` 與房屋無關；`outfits.ts` 不含曝露度；`bindRulesMods.ts` 不是契約；`pregMarks.ts` 同時放家庭規則入口與泌乳判斷 |

### 7.2 建議（ElondiaRPG 本身）

| # | 位置 | 問題 | 建議 | 風險 | 大小 |
|---|---|---|---|---|---|
| 1 | 8 個檔的 `hoursOf` | 同一個函式 8 份 | 移到 `state.ts` 或新的 `time.ts`，全部改 import | 低（純函式） | S |
| 2 | 8 個檔的 FNV 雜湊 | 同一個演算法 8 份，初始化與混合方式略有不同 | 抽成 `hash.ts`（`hashString`、`seededRng`）；**先確認各份輸出相同**，否則固定生成的結果（空地、NPC 初始值）會變 | 中（改了雜湊會動到既有存檔的固定生成） | S |
| 3 | `slavery.ts` 499、575 行；`slaveEvents.ts` `busy` | 「忙碌」條件 3 份，新增一種待處理事件時容易漏改 | 抽成 `state.ts` 的 `isBusy(state)` | 低 | S |
| 4 | `eventFits`／`slaveEventFits` | 兩份條件判斷會慢慢走岔 | 合成一個 `eventConditionsMet(e, {affinity, tags, atHome, bond})` | 低 | S |
| 5 | `slavery.ts`（1205 行，26 個 import） | 一個檔放了條款、建角主人、許可、刻印、事件引擎、逃亡、解印 | 拆成 `contractTerms.ts`、`masterEventEngine.ts`（`eventRoles`、`answerMasterEvent`、`forEvent`）、`permits.ts`、`unmark.ts`；事件引擎不該依賴「主人」的概念（它已經服務 5 個事件庫） | 中（被 26 個檔匯入；用 re-export 過渡） | L |
| 6 | `forMaster`／`forEvent` | 兩份代換邏輯 | `masterEventDefaults` 改用 `forEvent(…, eventRoles(state), …)`，刪掉 `forMaster` | 低 | S |
| 7 | `stores/game.ts` `afterMove` | 事件優先順序是遊戲規則，卻在 store | 移進引擎（例如 `afterStep(state, result)`），store 只呼叫 | 中（順序一變結果就變，要靠測試守住） | M |
| 8 | `stores/game.ts` `recordSex` | AI 流程的判斷（要不要送、回應能不能寫入）在 store | 把「該不該記」「回應是否仍然有效」移成 `sexRecord.ts` 的純函式；store 只管網路與逾時 | 低 | S |
| 9 | `content.ts`、`sexRecord.ts` 的模組層級開關 | 全域可變狀態，測試會互相影響，SSR／多存檔也不安全 | 收進一個 `ContentSettings` 物件，由呼叫端傳入或掛在 `GameState` 的非存檔區 | 中（`tagsAllowed` 被大量呼叫） | M |
| 10 | `sexRecord.ts` → `pregnancy.ts` | 記錄模組直接依賴懷孕模組 | 改成 `onEncounterRecorded` 掛鉤，由 `pregnancy.ts` 註冊（和 `homeResolver.ts` 同一招） | 低 | S |
| 11 | `homes.ts` → `children.ts`（`cribRefusal`） | 房屋核心依賴家庭 | 改成家具功能的「能不能收起」掛鉤表：`crib`、`garden`（有作物）與計畫中的 `storage`、`aging` 都走同一張表 | 低 | S |
| 12 | `homeResolver.ts`、`Home.master`、`Home.household` | 「主人的家」借用 `Home` 型別，讓每個房屋函式都要區分 `ownHomeOfArea`／`homeOfArea` | 把主人的家做成另一種區域來源（共用樓層生成器即可），`Home` 只表示玩家的房子，循環 import 與 resolver 一起消失 | 中 | M |
| 13 | `pregMarks.ts` | 名稱是「懷孕標記」，實際上是家庭規則的入口＋泌乳判斷，被 10 個外部模組匯入 | 拆成 `familyRules.ts`（資料入口）與泌乳判斷併回 `lactation.ts` | 低 | S |
| 14 | 兩個 `needsConsent` | 同名不同義 | 改名 `needsWorkConsent`／`needsLactationConsent` | 低 | S |
| 15 | 只為測試匯出的函式（約 25 個） | 公開介面看起來比實際大 | 測試改走公開入口，或集中到 `__testing` 匯出 | 低 | S |
| 16 | `restraints.ts` `stuckRestraints`、`pregnancyEvents.ts` `PregnancyTemplate` | 沒有使用者 | 刪除 | 低 | S |
| 17 | `ContractDialog.vue`、`HomePanel.vue` | 元件自己讀規則資料組說明、做門檻比較 | 引擎提供 `permitSummary(state)`、`comfortStatus(home)` 回傳現成的資料 | 低 | S |
| 18 | 檔名 | `meals.ts`、`outfits.ts`、`bindRulesMods.ts` 名實不符 | 改名（`tavernMeals.ts`、`npcOutfits.ts`、`twoFaceRulesMods.ts`） | 低（只是改 import） | S |
| 19 | 房屋的三份計畫 | R30／R31／R32 都要在 `Cell` 與 `NpcRecord` 上加欄位，還各自要「每日推進」 | 開工前先定一個 `homeDaily(state, from, to)` 與一張「家具功能表」（功能 → 可否收起、每日行為、面板區塊），避免三份計畫各自往 `state.ts`、`HomePanel.vue` 塞判斷 | 低（還沒寫） | M |
