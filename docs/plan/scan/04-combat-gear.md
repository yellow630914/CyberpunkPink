# 04 — 角色成長／戰鬥／裝備與經濟／製作／刺青／寄生物 掃描

範圍：`/home/user/yellow630914/elondiarpg/src/engine` 內 50 個模組（約 14,357 行）。唯讀掃描，未改動該 repo。
路徑省略前綴 `src/engine/`；資料檔在 `data/rules/`。

## 0. 先講結論（和預期不同的地方）

| 發現 | 影響 |
|---|---|
| **戰鬥本來就沒有格子**。`combat.ts` 沒有座標、距離、射程、前後排；目標選取只有 `enemy / ally / self / all_* / random_enemies / ally_or_downed`，敵方選目標靠仇恨值加權。`grid.ts`（1,796 行）是「探索地圖」，戰鬥只用它判斷「這場戰鬥是哪一格觸發的」。 | 不需要「拆掉格子」，而是要「加上 4 個縱深位＋掩體」。新增點集中在 `validTargets` / `pickTargets` / `attackRoll` / AI。 |
| **行動點已經存在**：`ap / apMax / apRegen`，剩餘 AP 可累積，行動成本在 `combat.json` 的 `action_costs`。 | 行動經濟可直接沿用，只改公式來源（現在吃等級）。 |
| **d20 + 調整值 + 熟練 vs DC 已經是現行規則**（`rollParts.ts` 的 `attrParts`、`checks.ts` 的 `computeDegree`）。屬性是 5 項（str/dex/int/fai/cha），熟練由等級推導。 | 改成 6 屬性、熟練不吃等級即可。 |
| **第二條傷害軌已經存在**：「慾望」(`lust / lustMax`) — 有上限、每回合消退、滿了觸發「高潮」（扣最大生命％、停一回合、第三次倒下）、傷害屬性 `lust` 直接打進這條軌、有「生命傷害轉慾望」。結構上就是「負載」。 | 機制骨架可借鑑，但和成人內容（lewd 指標、流派、寄生、懷孕）纏在一起，`combat.ts` 有 329 行提到它，要重寫不要搬。 |
| **「技能攜帶上限」已存在**（`character.ts` 的 `carriedAbilities / setCarried / carryLearned / loadoutUsage`，存檔規則 `skillLoadout`）。 | 很接近「神經植入體容量」，但目前是「個數上限」不是「每個技能佔多少容量」。 |
| **「圖紙」已存在**但語意不同：一個底材（base）一張，只影響自己動手打造的 DC（沒有就 +5）。 | 新遊戲的「藍圖」≈ 這裡的「底材 base」，「零件」≈「材料 material」（目前只有 1 個）。 |
| **沒有負重／容量**。行囊是全隊共用的 `InventoryItem[] { name, qty, quality? }`，**物品以中文顯示名稱當主鍵**。 | 要加負重得新寫；名稱當主鍵是移植風險。 |

---

## 1. 各子系統說明

### 1.1 角色模型與推導值 — `character.ts`（586 行；被 64 個檔引用）
- `Character`（`types.ts`）存基礎值：`race, class, level, xp, attrs, attrPoints, hp, maxHp, slotsUsed, usesPerRest, abilities, loadout, weapon, armor, gear, perks, tattoos, parasites, status…`。
- 有效屬性 `attrsOf(c)` = 基礎 + `attrSources(c)`（誓約印記、裝備，另有 `addAttrProvider` 登記點），夾在 `attributes.json` 的 `score.min~max`。
- 推導：`mod()`、`proficiency(level)`、`maxHpFor(level, attrs)`（str+fai）、`apMaxFor / apRegenFor`（level、dex+cha）、`slotMaxFor(classId, level, attrs)`（法術環表）、`luckyThreshold`（暴擊門檻，dex+cha）、`evadeFloor`、`combatBonuses`（給畫面的來源拆解）、`gearAffinities`（抗性／增傷合併）。
- 建角：`baseAttrs(classId, race)`（職業優先序套陣列 + 種族加值）、`createPlayer`、`createNpc`（依等級自動成長、`generateLoadout`）。
- 資料：`attributes.json`、`combat.json`、`classes.json`、`progression.json`、`equipment.json`。
- 依賴：`gear, perks, traits, outfits, tattoos, parasites, lewd, pcTags, data, rng`（已在大循環內）。

### 1.2 升級與能力選擇 — `character.ts` 後半、`classMods.ts`、`classRebalance.ts`、`upcast.ts`、`fieldCast.ts`、`resources.ts`
- `gainXp()`：`xp ≥ xpToNext(level)`（150 × 等級）→ 等級 +1（上限 20 寫死）、屬性點 +1、`abilityChoices()` 三選一（從 `classAbilities(c.class)` 裡 `learnable()` 的抽）、`levelUpPerkOffer()`。重抽：`rerollAbilityChoices`。
- `learnable()` 三種門檻：技能看 `unlock ≤ level`、法術看 `circle ≤ maxCircle`、戲法看 `maxCantrips(level)`；另有「生命層級」的品質上限 `maxSkillQuality(level)`。
- 技能書：`learnAbility` / `nextBookAbility`（限本職業或 `lewd` 類）。
- `upcast.ts`：升環（骰子字串運算 `timesDice / addDice`）。`fieldCast.ts`：戰鬥外施法（治療、護盾）。`resources.ts`：法術環、生命骰增減。
- `classMods.ts`：內容編輯器的自訂職業（`sanitizeClassMod / applyClassMod`）。`classRebalance.ts`：一次性的存檔遷移（東方職業重分配 NPC）。

### 1.3 特質 perks／traits — `perks.ts`（648）、`perkActions.ts`（218）、`traits.ts`（346）、`schools.ts`（273）
- `PerkDef.effects` 只有 4 種：`{check: CheckFilter, bonus}`、`{combat: Mods}`、`{resist}`、`{offense}`。`perksOf(c)` = 種族特質（依 `race` 自動擁有）+ 自己的 + `customPerks`。
- 檢定加值的總入口：`checkModifiers(c, ctx)` = 特質 + 裝備獨特加值 + 寄生物 + 拘束 + 服裝 + 懷孕…；`matches(filter, ctx)` 比對技能／屬性／情境／行動種類／對象標籤。這一套**相當通用**。
- 強度估算 `perkPower()` + `sanitizePerk()`：給 AI 設計的特質夾上限。機會制：`offerPerks / takeOffer / levelUpPerkOffer`；受訓：`perkActions.ts` 的 `trainOptions / setupTrain / applyTrain`（站在某種店的格子上、花錢花時間、擲檢定）。
- `traits.ts` 不是 perk：是 NPC 的外貌／體型／血統（`rollLook, bodyOf, describeLook`），資料在 `data/world/npc_traits.json`。
- `schools.ts`：慾望流派、拘束的「雙面效應」、服裝的戰鬥加值 — 全是成人向。

### 1.4 戰鬥迴圈 — `combat.ts`（2,690 行；引入 38 個模組）
- **進入**：`startCombat(state, group?, opts)` → `fromCharacter()` / `fromEnemy()` 把角色與怪物攤平成 `Combatant`（快照，戰鬥中不再讀 `Character`）→ `initLust` → 先攻排序（`1d20 + mod(dex) + 特質`，被偷襲方 −100）→ `state.combat`。
- **回合**：`order[] + turn + round`；`beginTurn → startTurn`（回 AP、持續傷害、控制）→ 玩家 `act(state, action)` → `perform()` / `useAbility()` / `useItem()` → `checkEnd` → 沒事可做自動 `endTurn` → `runEnemyTurns`（同步跑完所有敵方回合）。
- **行動**：`CombatAction = attack | ability | defend | struggle | flee | surrender | end_turn | item`。成本在 `combat.json.action_costs`（武器 2、防禦 1、撤退 2、法術依環）。
- **目標**：`validTargets / pickTargets`，純以陣營與存活判斷。
- **命中**：`attackRoll`（d20 + 熟練 + 屬性 + 命中 vs **對方也擲 d20 的迴避**，有下限）；`savingThrow`；暴擊 `luckyThreshold`。
- **傷害**：`rollParts → dealDamage`（增傷 `offenseMult` × 抗性 `defenseMult` → 減傷 dr（裝備的只擋物理）→ 臨時生命 → 特殊狀態）→ `applyHpLoss`。
- **狀態**：`StatusInstance {id, turns, charges, value, source, conc, dice}` + `statuses.json`（115 種；欄位 `mods, resist, control, dot, advantage, luck, on_hit, struggle…`）；`addStatus / inflict / consume / dropConcentration / modsOf / rollFactors`。
- **敵方 AI**：`enemyTurn`（最多 6 步）→ `pickByThreat`（仇恨加權，`monster_traits.json` 的 `ai.focus / prefer`）→ `chooseAction`（替每個可用技能打分數，分數平方加權抽）→ `wantsToFlee`。
- **結束**：`finishCombat(state)`（約 260 行）：經驗、金錢、掉落、圖紙、好感、公會功績、委託推進、圖鑑、劇情、情報、園區集章、戰敗事件…全寫在一個函式裡，組出 `Report`。
- 資料：`combat.json, abilities.json(432), statuses.json(115), enemies.json(704), monster_traits.json, damage_types.json`。

### 1.5 戰敗／俘虜／其他
- `defeat.ts`：戰敗事件（成人向），`rollDefeatEvent → setupDefeatEvent → applyDefeatResponse`。
- `captives.ts`：打贏人形敵人後的處置 `resolveCaptive(execute|release|enslave, deeds)`，連到警戒與聲望（`security, social`）。
- `arena.ts`：鬥技場的開場與結算。`bestiary.ts`：圖鑑（聽說／遭遇／擊敗），只依賴 `data, types`。
- `combatRelease.ts`、`fusion.ts`、`purify.ts`、`counterMods.ts`：成人向或內容編輯器附屬。
- `rollParts.ts`（52 行）：擲骰拆解，全引擎共用（19 處）。

### 1.6 裝備模型 — `gear.ts`（1,229 行；被 74 個檔引用）
- `GearSpec = { base, material, rarity?, enchants?, unique?, attrs?, lewd?, fused?, bind?, lock?, curse? }`；`EquippedGear = { name, spec, locked?, lock? }`。
- `gearStats(spec)`：`base.stats` + `base.scale[k]`（關鍵字 `full/half/up/third/quarter/res` × `material.bonus` 這**一個純量**）+ 材料特性（非武器才有）+ 附魔。`gearName`（材料名＋底材名）、`gearPrice`（底材價 × 材料倍率 × 附魔）、`gearCost`、`gearSellCap`。
- 稀有度：預設 = 材料的稀有度；`rarities[r].enchant_points` 決定附魔點數；`enchantPoints / rollEnchants / sanitizeEnchants`。
- 欄位：`gear.json.slots` 16 個具名 + 8 個 `extra_*`（共 24）；`slot_groups`（ring、piercing 各兩格）；種族 `relabel / blocked`；`slotsFor / baseSlotsFor / baseFits`。
- **另一層類型表**：`equipment.json` 的 `weapons`（骰子、傷害屬性、用哪個屬性）與 `armors`（迴避、減傷）。底材用 `base.weapon / base.armor` 指過去；`syncGear(c)` 把主手、上身換算成 `c.weapon / c.armor` 兩個快取字串（13 個呼叫點）。
- 「分層」：沒有通用的層模型。只有 `underwear_top / underwear_bottom` 兩格 + 底材的 `exposure / vacuum / top_only`（曝露度計算在 `lewd.ts`）。
- 其他：建角挑裝備（`creation*`）、NPC 生成裝備（`generateLoadout`，吃職業模板與等級）、寶箱／掉落（`randomGear`）、AI 生成裝備的驗證（`sanitizeGearSpec / registerGear` → `state.customItems`）。

### 1.7 行囊 — `inventory.ts`（484）、`tools.ts`、`outfits.ts`、`forcedGear.ts`、`restraints.ts`
- 行囊：`state.inventory: InventoryItem[]`，全隊共用，無負重、無格數。
- `useItem()`（戰鬥外消耗品；一個長 if 鏈依 `def.use` 的欄位分支）、`putOn / equipItem / unequipItem`（雙手武器、鎖住的欄位、種族限制）、鎖與鑰匙（`lockGear / useKey / unlockGear`）、存檔規則的強制整理（`enforceExtraSlots / enforceClassWeapons`）。
- `tools.ts`（47 行）：工具模板，「同類取最高加值」— 乾淨、可直接用。
- `outfits.ts`：NPC 依標籤穿衣；`forcedGear.ts / restraints.ts`：主人強制裝備、拘束與脫縛（成人向）。

### 1.8 交易／價格／行情 — `trade.ts`（1,012）、`market.ts`（222）、`shopMods.ts`、`shopNames.ts`、`auction.ts`、`money.ts`
- 每間店每天一份 `Deal[]`（付出 + 得到的效果）；`buyDeal / sellItem`、購物車 `cartQuote / checkoutCart`、殺價 `bargainSetup / applyBargain`（主動行動、擲檢定）、AI 特別商品 `applyAiDeals`。
- 價格鏈可解釋：`buyBreakdown / sellBreakdown → PriceStep[]`（基本價 → 店家加成 → 地點倍率 → 行情 → 折扣 → 聲望 → 身分）。
- `market.ts`：城鎮標籤 + 隨時間輪替的狀態 → 各交易類別的倍率（`categoryMult / marketMult`），用 `seed + time` 決定，無副作用。賣太多會跌價（`glutMult`）。
- `money.ts`（19 行，0 依賴，被 88 處引用）：`formatMoney`。欄位名 `_cc` 是舊幣制殘留。
- 資料：`shops.json, market.json, economy.json, items.json`（2,146 件，其中 **1,502 件是預先展開的裝備**，每件寫死 `gear: {base, material}`）。

### 1.9 製作 — `craft.ts`（482）、`crafting.ts`（189）、`recipes.ts`（177）、`invention.ts`（548）、`blueprints.ts`（67）、`craftLessons.ts`、`garden.ts`、`materialInfo.ts`
- 三條路：**委託／自己打造裝備**（`craft.ts`：`craftPlan → setupCraft/applyCraft`、`setupMake/applyMake`；目標字串 `"底材:材料"`）、**依配方製作**（`recipes.ts`：`recipePlan → setupProduce/applyProduce`）、**自創配方**（`invention.ts`：`inventPlan → setupInvent/applyInvent`，強度上限由同級現成配方推導）。
- 共同模式：`xxxPlan()` 算成本／DC／阻擋原因（一次列完）→ `setupXxx()` 掛成待決的主動行動 → 擲檢定 → `applyXxx(degree)`。
- `crafting.ts`：7 種工藝各有等級與經驗（`skillOf / gainCraftXp`），等級 N 處理第 N 級材料；工具階級（隨身／工坊／工作台）`toolAccess`。**這是「不靠角色等級的技能成長」的現成範例。**
- `blueprints.ts`：`state.blueprints: string[]`（底材 id），`hasBlueprint / grantBlueprint / blueprintDeals`。
- 資料：`crafts.json`、`gear.json.craft`、`items.json` 的 `recipe / forge / seed`。

### 1.10 刺青 — `tattoos.ts`（217）、`tattooShop.ts`、`tattooMods.ts`
- 11 個部位各一個；種類：奴隸印記（掛契約）、誓約印記（屬性加減、總和 0，進 `attrsOf`）、普通刺青、詛咒印記（寄生物）。
- `addTattoo / removeTattoo / tattooAt / freePlaces`；店：`orderTattoo / inkTattoo / washTattoo`。
- 被 53 個檔引用，主要因為 `contractOf()`（奴隸契約存在刺青上）。

### 1.11 寄生物 — `parasites.ts`（457）、`parasiteEvents.ts`、`parasiteMods.ts`
- 只有主角有。三種：寄生裝備（鎖住一個欄位）、淫紋（刺青的一種）、種子／苗床。侵蝕度 0–100 → 4 階段 → 各階段的檢定加減、戰鬥技能、開戰慾望。
- `attachParasite / changeCorruption / tameParasite / detachParasite`；發作事件 `maybeParasiteEvent`（每步、每天、長休後擲機率）。

---

## 2. 奇幻假設清單（最重要）

擴散程度以 grep 命中數估計（不含測試）：
`.level` → engine 244 處／54 檔、元件 105 處／42 檔；`.class | classDef | classes[` → engine 119／33、元件 37／18；法術環相關 → engine 98／18、元件 98／24；`.race` → engine 117／34、元件 60／30；`spec.base / spec.material / gearRules.bases|materials` → engine 163／24、元件 50／13、測試 118／32。

### 2.1 等級

| 檔案 | 函式 | 假設 | 擴散 |
|---|---|---|---|
| character.ts | `proficiency(level)` | 熟練 = 2 + (等級−1)/4 | 高：`rollParts.attrParts`（所有檢定）、`actions.ts`、`town.ts`、`lactation.ts`、`combat.ts` ×4、`DefeatEventPanel.vue` |
| character.ts | `maxHpFor(level, attrs)`、`recalc` | 生命 = 8 + 等級 × (4 + mod(str) + mod(fai)) | 中：建角、換裝、升級、NPC 生成 |
| character.ts | `apMaxFor / apRegenFor` | AP 上限與回復吃等級 | 低：只有 `fromCharacter` |
| character.ts | `gainXp / xpToNext / spendAttrPoint` | 經驗 → 等級（上限 20 寫死）→ 屬性點 + 能力三選一 + 特質機會 | 高：`Report.changes.xp`、`npcLife.ts`、`companions.ts`、畫面 |
| character.ts | `lifeTier / maxSkillQuality / guildRankFor / powerGapAttitude` | 等級 → 生命層級 → 技能品質上限、公會階級、NPC 對主角的態度 | 中：公會、敘事提示 |
| character.ts | `weaponFor` | 武器骰依等級放大（武僧 `scale`） | 低 |
| character.ts | `learnable / nextBookAbility / abilityQuality` | 技能 `unlock` 等級門檻 | 中：`abilities.json` 233 筆有 `unlock` |
| combat.ts | `Combatant.level` | 快照帶等級；31 處使用 | 見下面各列 |
| combat.ts | `lustMaxFor(level)` | 第二條軌的上限 = base + per_level × 等級 | 低（單點） |
| combat.ts | `rollParts`（`p.scale.per`）、`applyValue`、`resolveAuto`（`heal.level / shield.level`） | 傷害／治療／護盾依施放者等級加骰 | 中：`abilities.json` 的資料格式 |
| combat.ts | `cantripTier(level)` | 戲法骰數依等級 | 低 |
| combat.ts | `applyStatuses`（`if_weaker`）、`chooseAction` | 「只對等級比自己低的有效」 | 低 |
| combat.ts | `struggleDc`、`keyForLevel`、`recoverableSlot` | DC／掉落的鑰匙／回復的環數吃等級 | 低 |
| combat.ts | `finishCombat` | 經驗依敵人 `xp` 或 `xp_per_level × 等級`；金錢 `money_per_level × 等級`；掉落機率 `per_level × 等級`；`randomGear(rng, def.level)` | 中 |
| combat.ts | `fromEnemy`、`typicalEnemyHp` | 怪物有 `level`；頭目的第二軌上限用「同等級怪物生命中位數」校正 | 中：`enemies.json` 704 筆都有 `level` |
| gear.ts | `MaterialDef.level`、`rollTier`、`randomGear(rng, level)`、`generateLoadout(classId, level, …)`、`sanitizeGearSpec(limits.maxLevel)` | 材料有「適用等級」；掉落與 NPC 裝備依等級選材料級數 | 中：`trade.ts`（`pc.level + 2`）、`combat.ts`、寶箱 |
| perkActions.ts | `gateBlock`、`trainOptions` | 受訓要角色等級 | 低 |
| perks.ts | `levelUpPerkOffer` | 特定等級給特質機會（`perks.json.levelup`） | 低 |
| captives.ts | `resolveCaptive` | 搶到的錢 = `rob_money_per_level × 等級` | 低 |
| fieldCast.ts | `effectsOf` | 戰鬥外治療／護盾吃等級 | 低 |
| resources.ts | `changeHitDice` | 生命骰總數 = 等級 | 低（連到休息） |
| materialInfo.ts | `tierForMonsterLevel`、`materialTier` | 材料級數從怪物等級／材料 `level` 推 | 低 |
| trade.ts | `applyAiDeals`、每日清單 | AI 商品與隨機裝備上限 = `pc.level + 1/2` | 低 |

> 注意：`crafting.ts` 的工藝等級、`recipes.ts / invention.ts` 的 `recipe.level` 是**工藝等級**，不是角色等級，不在此列 — 這套可以留。

### 2.2 職業

| 檔案 | 函式 | 假設 | 擴散 |
|---|---|---|---|
| character.ts | `baseAttrs(classId, race)`、`baseCharacter`、`createPlayer / createNpc` | 職業決定屬性優先序、起始能力、起始武器防具 | 高：建角流程、`NpcDef.class`、`npcs.ts` |
| character.ts | `slotMaxFor(classId,…)`、`castingAttr(classId)` | 施法者類型（none/half/full）與施法屬性來自職業 | 中 |
| character.ts | `learnable / learnAbility / nextBookAbility / carriedCounted` | 能力池 = `classAbilities(c.class)`；`AbilityDef.classes[]` | 高：`abilities.json` 432 筆都有 `classes` |
| character.ts | `gearAffinities` | `classes[c.class].resist`（武僧卸力） | 低 |
| combat.ts | `fromCharacter` | `classDef(c.class).threat`（起始仇恨與倍率） | 低 |
| combat.ts | `startCombat`（`weaponBlock`） | 存檔規則「職業武器限制」 | 低 |
| gear.ts | `gearRules.classes`（`ClassGearTemplate`）、`startingGear`、`creationSlots / creationCatalog / creationGear`、`generateLoadout`、`classWeaponBlock` | 起始裝備、可挑的底材、NPC 配裝都按職業模板 | 中：`StartGearDialog.vue`、`NewGameView.vue` |
| gear.ts / inventory.ts / restraints.ts / parasiteEvents.ts | `syncGear(c, classDef(c.class).weapon)`（13 處） | 空手時用「職業的徒手武器」 | 中（機械式重複） |
| perks.ts | `learnablePerks`（`requires.classes`）、`rollNpcPerks`（`npc.classes`） | 特質的職業前置、NPC 抽特質的職業權重 | 低 |
| classMods.ts | 全檔 | 自訂職業編輯器 | 自成一格（＋`ClassEditor.vue`） |
| classRebalance.ts | 全檔 | 東方職業的存檔遷移 | 自成一格 |
| defeat.ts | `villainOf` | 讀 NPC 的職業（敘事用） | 低 |
| trade.ts | `applyAiDeals` | AI 設計的「雇傭」商品帶 `class` | 低 |

### 2.3 魔力／法術環／法術學派

| 檔案 | 函式 | 假設 | 擴散 |
|---|---|---|---|
| character.ts | `slotMaxFor / maxCircle / slotsLeft / maxCantrips`；`Character.slotsUsed` | 沒有 MP；用 D&D 式 1–9 環的法術環，表在 `combat.json.spell_slots` | 中 |
| combat.ts | `Combatant.slots / slotMax / castingAttr / concentration`；`abilityApCost`（`spell_by_circle`）、`unusableReason`、`slotFor / castCircle`、`useAbility`（扣環、升環）、`restorableCircle / recoverableSlot`、`spellCap`、`dropConcentration`、`CANTRIP_KEY` | 能力分 `skill / spell / cantrip` 三型；法術扣環、戲法每回合一次、專注 | 中：65 行；AI 的 `targetWeightFor`（`prefer: 'caster'` 看 `slotMax.length`）也吃 |
| upcast.ts | 全檔 | 升環 | 只被 3 處引用 |
| fieldCast.ts | `fieldCastBlock / spend` | 戰鬥外施法扣環 | 低 |
| resources.ts | `spendSlot / restoreSlot / changeSlots` | 事件、委託扣／回法術環 | 低：`effects.ts`、`rest.ts` |
| inventory.ts | `useItem`（`def.use.slot`） | 藥水回法術環 | 低 |
| combat.ts | `useItem`（戰鬥中） | 同上 | 低 |
| contract（`combat.ts` 的 `spellCap`） | — | 奴隸契約限制可施放的環數 | 低 |
| perks.ts / schools.ts | `PerkDef.school`、`schoolsOf / hasSchool` | **「school」不是法術學派**，是成人向的「慾望流派」；法術沒有學派欄位（只有傷害屬性群組 `physical / elemental / divine / arcane`，`damage_types.json`） | — |
| attributes.json | — | `int` = 奧術、`fai` = 神術／專注、`cha` = 吟遊法術；`maxHpFor` 用 fai、`fromEnemy` 把 `castingAttr` 寫死成 `'fai'` | 中：5 屬性 id 寫死在 `GearSpec.attrs`、`Tattoo.attrs` 的型別、`combat.ts` 9 處、`grid.ts` 5 處、`security.ts` 5 處 |

### 2.4 種族

| 檔案 | 函式 | 假設 | 擴散 |
|---|---|---|---|
| character.ts | `baseAttrs`（`attributeRules.races[race].bonus`） | 種族屬性加值 | 低 |
| perks.ts | `racePerks(race)`、`perksOf`、`grantPerk / losePerk`、`learnablePerks`、`fitCreationPerks` | 種族特質自動擁有（不寫進存檔） | 中：45 個檔引用 perks |
| gear.ts | `gearRules.races`（`RaceGear`：`blocked / relabel`）、`slotsFor(spec, race)`、`baseSlotsFor`、`raceUnfitReason`、`raceBaseFor`、`BaseDef.races / wear_as` | 種族封欄位、改欄位名、種族限定底材（人馬族） | 中：`inventory.putOn`、`outfits.ts`、`forcedGear.ts`、`arena.ts` |
| traits.ts | `bodyOf(race, gender)`、`rollLook`、`lookOptions`、`babyName`、`lineageJobs` | 外貌、體型、名字、血統職業表都按種族 | 中：NPC 生成、家庭 |
| genderSwap.ts | `swapNpcGender` | 依種族重擲外貌與內衣 | 低 |
| combat.ts | `initLust`（`kind_resist`）、`fromEnemy`（`def.kind === 'demon'`、id 前綴 `lp_/fg_/pp_` 寫死） | 怪物種類（beast/demon…）決定第二軌抗性；特定地下城前綴寫死 | 低 |

### 2.5 格子位置

| 檔案 | 函式 | 假設 | 擴散 |
|---|---|---|---|
| combat.ts | `CombatState.cell`、`bossCellOf`、`traitBonus`、`finishCombat`（公會功績、情報、集章、`flags["cleared:area:x,y"]`）、`settleNpcFoes`、`advanceQuest` | 戰鬥是「地圖上某一格」觸發的；用 `state.areas[...].cells[y*width+x]` 直接算索引（3 處重複） | 低：共 8 處，全在開戰與結算，**不在回合內** |
| defeat.ts | `applyDefeatResponse → afterDefeat`（grid） | 戰敗後搬回地圖上的安全點 | 低 |
| captives.ts | `resolveCaptive`（`currentArea / getArea`） | 俘虜留在某一格 | 低 |
| arena / fusion / craft / crafting / craftLessons / recipes / invention / tattooShop / restraints / perkActions / trade | `currentCell(state).kind`、`currentArea` | 「站在某種店的格子上」才能用該功能（`CellKind` 就是店種） | 中：這是「地點情境」，不是戰鬥站位。換成「目前所在的場所」的抽象即可 |
| garden.ts、shopMods.ts | `Area / Cell`、`computePlacements` | 家具與自訂商店擺在格子上 | 低 |

**戰鬥內沒有任何格子、距離、射程、站位的程式碼**（已 grep `前排|後排|站位|距離|射程|range|row`，只有一處是職業的敘述文字）。

---

## 3. 戰鬥：哪些和站位無關、哪些要動

### 3.1 可以保留（和站位無關）

| 部分 | 函式 | 備註 |
|---|---|---|
| 先攻與回合順序 | `startCombat` 的排序、`nextTurn / beginTurn / startTurn / endTurn / closeTurn` | 個體先攻、偷襲 −100 |
| 行動經濟 | `Combatant.ap/apMax/apRegen`、`abilityApCost`、`hasAnyAction`、`perform` | AP 可累積；`usedTurn / usedCombat / usedRest` 次數限制 |
| 狀態系統 | `StatusInstance`、`addStatus / inflict / consume / modsOf / rollFactors / controls / hasSpecial`、`startTurn` 的 dot/hot/pulse | 資料驅動（`statuses.json`），最值得搬 |
| 擲骰 | `d20Roll`、`rollLuck`、`attackRoll`、`savingThrow`、`saveDc`、`rollBreakdown` | 要改：迴避是「對方也擲 d20」，新規則是固定 DC |
| 傷害管線 | `rollParts → dealDamage → settleDamageParts → applyHpLoss`、`offenseMult / defenseMult / affinityKeys`、`heal`、`onHitExtras` | 屬性群組、抗性乘算、減傷只擋物理、臨時生命 |
| 仇恨 | `addThreat / accrueThreat / decayThreat / targetWeightFor / pickByThreat / threatShares` | 從時間軸的效果反推仇恨，和站位無關 |
| 第二軌的骨架 | `gainLust / relieveLust / effectiveLustMax / climax`、`dealDamage` 內的型別分流與轉換 | 概念可用，程式要重寫（見 0.） |
| 時間軸／戰報 | `push`、`TimelineEntry / Effect / RollPart`、`rollParts.ts` | `Report` 的組裝在 `finishCombat`，和遊戲其他系統纏得很深 |
| 敵方 AI 的打分框架 | `chooseAction`（治療／淨化／增益／減益／範圍 分類打分）、`wantsToFlee` | 可留骨架，加上「位置」因子 |
| 怪物特徵 | `rollTraits / applyTraits`（`monster_traits.json`） | 通用 |
| 頭目控制保護 | `addStatus` 內 `boss / controlGuard` | 通用 |

### 3.2 要新增或改寫（站位相關 — 目前不存在）

| 要動的點 | 現況 | 換成 4 個縱深位時 |
|---|---|---|
| `Combatant` | 沒有位置欄位 | 加 `slot: 0..3`、`cover` 狀態 |
| `validTargets / pickTargets` | 只看陣營與存活 | 加上「可及的縱深」、掩體遮蔽；`AbilityDef.target` 要多一個射程／縱深的維度 |
| `attackRoll` | 迴避骰 + 防具 + 狀態 | 掩體加 DC／給劣勢（可用現成的 `attacked_disadvantage` 狀態欄位表達） |
| `CombatAction` | 沒有移動 | 加 `move`（換位、進出掩體）與 AP 成本 |
| `enemyTurn / chooseAction / pickByThreat` | 純仇恨 | 加位置權重、AI 自己的移動決策 |
| 範圍技能 | `all_enemies / random_enemies` | 可能要「某一縱深的全部」 |
| `guard`（代為承受）狀態 | 以 `source` 找代承受者 | 可改成「前位掩護後位」 |

### 3.3 和地圖格子的耦合（只在開戰與結算）
`CombatOptions.cell`、`bossCellOf`、`traitBonus`、`finishCombat` 內 4 處、`advanceQuest`、`settleNpcFoes`。新專案用「遭遇來源」的抽象取代即可。

---

## 4. 裝備：通用 vs 綁在「底材 × 材料」

### 4.1 `gear.ts` 分類

| 區塊（行數約略） | 內容 | 性質 |
|---|---|---|
| 欄位（229–285、439–505） | `SLOTS`、`slot_groups`、`EXTRA_SLOTS / setExtraSlotCount / slotOpen`、`baseFits`、`slotsFor`、`slotNameFor` | **通用**，資料驅動。但 `GearSlot` 是 `types.ts` 的字面聯集，且程式寫死 `main_hand / off_hand / body`、`PIECE_SLOTS`、`JEWELRY`、`UNDERWEAR_SLOTS`、`SLOT_CATEGORY`、`CRAFT_SLOT_ORDER` |
| 身上裝備合計（506–537） | `gearBonuses(c)`、`bonusesOff / onlyNegative`、`addMods / addMap` | **通用**：把每件的 `GearStats` 加總。只要 `gearStats` 的輸出形狀不變，這裡不用動 |
| 裝備規則（`inventory.ts` 的 `putOn / freeSlotsFor / lockedGear / assertUnlocked`） | 雙手、鎖住、種族 | **通用**（去掉成人向的鎖種類） |
| 數值核心（286–370） | `gearStats`、`scaled`、`GearStats`、`gearKnown` | **綁死 base × material**：`material.bonus` 是唯一的縮放純量；`material.armor / resist` 只給非武器 |
| 命名與價格（371–432） | `gearName`、`gearPrice`、`gearCost`、`gearSellCap`、`enchantPoints` | **綁死**（名稱 = 材料名 + 底材名；價格 = 兩者相乘） |
| 稀有度與附魔（935–1130） | `rarityPoints / shiftRarity / sanitizeEnchants / rollEnchants / sanitizeGearSpec / registerGear` | 附魔點數制**通用**；`sanitizeGearSpec` 的材料查找**綁死** |
| 建角挑裝備（629–870） | `creation*`、`generateLoadout`、`startingGear` | 綁職業模板 + 材料級數，**重寫** |
| 掉落與打造材料（1131–1211） | `randomGear`、`forgeItems*`、`chestForge*`、`MATERIAL_KINDS`、`MAX_TIER` | **綁死**材料種類（metal/leather/cloth/wood/jewel）與 7 級 |
| 職業武器限制（1213–1229） | `isMainWeapon / classWeaponBlock` | 不需要 |
| 成人向 | `gearLewdOf`、`VacuumSide`、`OutfitKind`、`wear*`、`wearDefaultUnderwear` | 不需要或重做 |

### 4.2 把「1 個材料」推廣成「N 個有類型的零件格」有多難

評估：**中偏大（M–L）**。數值核心本身很小（`gearStats` 約 30 行），難在 `{base, material}` 這一對字串滲透得很廣：

| 滲透點 | 說明 |
|---|---|
| `GearSpec` 型別 | 多處用 `Pick<GearSpec, 'base' | 'material'>` 當函式參數（`gearName / gearCost / gearKnown / gearSellCap`） |
| `items.json` | 1,502 件裝備是**預先展開**的目錄項（每件一組 base+material）。N 個零件會組合爆炸 → 必須改成「實例」而不是目錄項。現成的路：`registerGear()` 把生成的裝備存進 `state.customItems`（AI 打造、掉落已經這樣走） |
| `craft.ts` | 目標字串 `"底材:材料"`（`parseCraftTarget / craftTarget / makeTarget`）、`craftPlan(state, base, material, …)`、`unitsFor(base)`（一種材料要幾份）、DC 與工錢按 `material.tier` 查表、工匠等級 ≥ `tier` |
| `material.kind` ↔ `base.kind` | 「金屬底材只能用金屬材料」這條相容規則散在 `findMaterial`、`rollTier`、`forgeItemsFor`、`blueprints.SHOP_KINDS`、`classMods.PIECE_NAME` |
| 稀有度／級數 | 預設稀有度 = 材料的稀有度；`craftRarity(material, degree)`；商店、寶箱、材料資訊都用「材料級數 1–7」 |
| 其他引擎檔 | `mods.ts` 25 處、`lewd.ts` 6、`inventory.ts` 6、`trade.ts` 4、`outfits.ts` 4、`itemIcons.ts` 4、`materialInfo.ts` 3、`classMods.ts` 3（共 24 檔 163 處） |
| 畫面 | 13 個元件 50 處（`CraftPanel / CraftDialog / StartGearDialog / ShopDialog…`） |
| 測試 | 32 個測試檔 118 處 |

建議的新模型（新專案直接這樣寫，不要從舊的改）：
- `GearSpec = { blueprint: string; parts: Record<PartSlotId, PartId>; rarity?; enchants?; … }`。
- 藍圖定義 `partSlots: { id, type, required }[]`；零件定義 `type` + 直接給 `mods / resist / offense`（或沿用 `scaled()`：藍圖寫「這一格的 bonus 以 full/half 計入哪個數值」）。
- `gearStats(spec)` 的回傳形狀維持 `{ mods, resist, offense, threat, … }` → `gearBonuses`、`gearAffinities`、`fromCharacter`、`combatBonuses` 都不用改。
- 把 `equipment.json`（武器／防具類型）併進藍圖，拿掉 `Character.weapon / armor` 快取與 `syncGear`。
- 名稱、價格、相容性各用一個函式集中（現在 `gearName` 有皮革的特例字串處理）。

10 個服裝欄 + 飾品欄：`gear.json.slots` 加欄位很容易，但「分層」（外層蓋內層、曝露）目前只有內衣兩格的特例，沒有可重用的層模型。

---

## 5. 各模組的判定

圖例：**照搬**＝幾乎不改；**換皮**＝改名詞與資料；**改規則**＝骨架留、公式換；**重寫**＝只當參考；**不需要**。

| 模組 | 行 | 判定 | 說明 |
|---|---:|---|---|
| rollParts.ts | 52 | 照搬 | 擲骰拆解；`attrParts` 的熟練改成不吃等級 |
| checks.ts | 36 | 照搬 | `computeDegree`（五段成功程度）只依賴 `actionRules.degrees` |
| money.ts | 19 | 照搬 | 0 依賴；`_cc` 欄位名可趁機改 |
| tools.ts | 47 | 照搬 | 工具「同類取最高」 |
| bestiary.ts | 110 | 換皮 | 圖鑑，只依賴 data/types |
| market.ts | 222 | 換皮 | 行情倍率，純函式；換類別與標籤資料 |
| shopNames.ts | 84 | 換皮 | 規則生成店名 |
| blueprints.ts | 67 | 改規則 | 概念對得上，但現在是「每個底材一張、只影響 DC」 |
| crafting.ts | 189 | 改規則 | 工藝等級／經驗／工具階級；很適合當「技能不靠角色等級」的範本 |
| recipes.ts | 177 | 改規則 | 配方製作；依賴 `grid / homes / trade` 要換成場所抽象 |
| craftLessons.ts | 65 | 換皮 | 付費學工藝 |
| invention.ts | 548 | 改規則／可延後 | 自創配方 + AI 設計上限；價值高但非核心 |
| craft.ts | 482 | 重寫 | 綁 `"底材:材料"`、材料級數、店種 |
| materialInfo.ts | 216 | 重寫 | 完全建在材料級數與 `forge` 上 |
| garden.ts | 93 | 不需要（或延後） | 房屋苗圃 |
| trade.ts | 1,012 | 改規則 | 交易／購物車／殺價／價格拆解值得留；要拆掉 `grid`、成人向店、`pc.level` 上限、22 個引入 |
| shopMods.ts | 394 | 不需要（內容編輯器） | 除非新專案也要世界編輯器 |
| auction.ts | 115 | 不需要 | 成人向拍賣 |
| inventory.ts | 484 | 改規則 | `putOn / equipItem / unequipItem` 留；`useItem` 的 if 鏈重寫；加負重；去掉鎖／詛咒／寄生 |
| gear.ts | 1,229 | 重寫（保留欄位與合計兩塊） | 見第 4 節 |
| outfits.ts | 85 | 換皮 | NPC 依標籤配服裝，規則式、確定性 |
| itemIcons.ts | 74 | 換皮 | 圖示查找順序 |
| sources.ts | 295 | 不需要（內容編輯器） | 「怎麼拿到」索引 |
| resources.ts | 91 | 重寫 | 法術環、生命骰 |
| character.ts | 586 | 改規則（大改） | 留：`mod`、`attrsOf / attrSources / addAttrProvider`、`combatBonuses` 的拆解形式、攜帶上限那組；丟：等級、職業、法術環、`gainXp`、`createNpc` 的自動成長 |
| perks.ts | 648 | 改規則 | `CheckFilter / matches / checkModifiers / perkCombat / perkPower / sanitizePerk / offer*` 留；種族特質、流派、`levelUpPerkOffer`、建角配額拿掉 |
| perkActions.ts | 218 | 改規則 | 受訓流程可改成「用點數買技能」的場所互動；拆 `grid` |
| traits.ts | 346 | 換皮 | NPC 外貌生成；資料全換 |
| classMods.ts | 264 | 不需要 | 無職業 |
| classRebalance.ts | 130 | 不需要 | 一次性存檔遷移 |
| schools.ts | 273 | 不需要 | 成人向流派（名稱易誤會，不是法術學派） |
| upcast.ts | 88 | 不需要 | 升環。骰子字串運算可抽出來留 |
| fieldCast.ts | 161 | 改規則 | 「戰鬥外使用能力」的流程可留，資源換掉 |
| genderSwap.ts | 93 | 不需要 | |
| combat.ts | 2,690 | 改規則（拆開後大改） | 留：回合流程、AP、狀態、傷害管線、仇恨、AI 打分、時間軸。重寫：`fromCharacter / fromEnemy`、命中（改固定 DC）、第二軌、`finishCombat`。新增：縱深位與掩體 |
| combatRelease.ts | 77 | 不需要 | 成人向說明面板 |
| defeat.ts | 225 | 重寫 | 戰敗事件的「擲骰回應」流程可參考；內容是成人向 |
| captives.ts | 186 | 改規則 | 戰後處置 + 警戒／聲望後果，骨架可用 |
| arena.ts | 127 | 換皮／可延後 | 鬥技場開場與結算 |
| counterMods.ts | 77 | 不需要 | 內容編輯器（談判對策） |
| fusion.ts | 115 | 不需要 | 成人向 |
| purify.ts | 72 | 不需要 | 成人向 |
| forcedGear.ts | 69 | 不需要 | 成人向 |
| restraints.ts | 228 | 不需要 | 成人向（「鎖／鑰匙等級」概念可借） |
| tattoos.ts | 217 | 改規則 | 「部位各一個、帶屬性加減的身體改造」很像義體欄位；契約那半拿掉 |
| tattooShop.ts | 154 | 換皮 | 付費安裝／移除的店 |
| tattooMods.ts | 177 | 不需要 | 內容編輯器 |
| parasites.ts | 457 | 重寫／參考 | 「侵蝕度 → 階段 → 被動效果」可當義體排斥／惡意程式的雛形；現況綁成人內容 |
| parasiteEvents.ts | 254 | 重寫／參考 | 依機率發作 + 擲骰回應 |
| parasiteMods.ts | 239 | 不需要 | 內容編輯器 |

---

## 6. 重複邏輯、沒用到的匯出、引擎外的規則

### 6.1 重複邏輯

| 位置 | 重複什麼 |
|---|---|
| `combat.ts` `parseDice / rollDice`；`upcast.ts` `parse`；`invention.ts` `diceAvg`；`rng.ts` `roll` | 骰子字串解析寫了 4 份（正則幾乎相同） |
| `character.ts` 198、240；`combat.ts` 686、933；`perks.ts` 144；`gear.ts` `addMods` | 「把 `Mods` 加總」的迴圈 6 份 |
| `character.ts` `combatBonuses` vs `combat.ts` `fromCharacter + attackRoll` | 註解自己寫「和 combat.ts 開戰時一樣的算法」— 兩份要手動保持一致 |
| `combat.ts` 2462、2557、`bossCellOf` | `cells[y * width + x]` 手算索引（`grid.ts` 有 `cellAt`） |
| `syncGear(m, classDef(m.class).weapon)` | 13 個呼叫點；換裝後忘了呼叫就會不一致 |
| `character.ts` `xpToNext` vs `crafting.ts` `xpToNext` | 同名不同義（回傳型別也不同） |
| `craft.ts` `setupCraft/applyCraft`、`setupMake/applyMake`；`recipes.ts` `setupProduce/applyProduce`；`invention.ts` `setupInvent/applyInvent`；`perkActions.ts` `setupTrain/applyTrain`；`restraints.ts` `setupUnbind/applyUnbind`；`defeat.ts` | 「plan → setup 待決行動 → 擲骰 → apply(degree)」的流程各寫一次，目標用自訂的字串編碼（`"底材:材料"`、`"id@物品*批數|!buy"`、`"member|offer"`）各自 parse |
| `combat.ts` `useItem` vs `inventory.ts` `useItem` | 戰鬥內外各一份消耗品邏輯（同名） |
| `combat.ts` `struggle / struggleDc` vs `restraints.ts` `unbindDc / applyUnbind` | 戰鬥內外的掙脫各一份 |
| `gear.json` 底材 vs `equipment.json` 武器／防具類型 | 兩層裝備定義，用 `base.weapon / base.armor` 串起來 |

### 6.2 沒用到的匯出
方法：對每個 `export` 名稱在整個 `src/`（`.ts`、`.vue`）做整字比對。**限制：以名稱比對，不是型別解析**；同名的其他識別字會造成漏報，動態存取不會被抓到。

| 類別 | 清單 |
|---|---|
| 完全沒人用（連自己檔內也只有定義） | `gear.ts`：`equipped`、`creationPiece`；`restraints.ts`：`stuckRestraints`；`crafting.ts`：`shopCrafts` |
| 只有測試在用 | `character.ts`：`addAttrProvider`；`perks.ts`：`gearCheckModifiers`、`rollNpcPerks`；`classRebalance.ts`：`EAST_REGIONS`、`planClassRebalance`；`upcast.ts`：`timesDice`、`addDice`；`combat.ts`：`lustMaxFor`、`rollTraits`、`applyTraits`、`combatant`、`usableAbilities`、`keyForLevel`、`addThreat`、`pickByThreat`、`bondShare`、`wantsToFlee`、`chooseAction`；`defeat.ts`：`defeatEventFoes`、`villainOf`、`defeatVictim`、`climaxDcCut`；`arena.ts`：`arenaBlocked`；`gear.ts`：`randomBases`、`EXTRA_SLOT`、`enchantPoints`、`creationItemCost`、`sanitizeEnchants`、`forgeItemFor`；`restraints.ts`：`parseUnbindTarget`、`keyFits`；`trade.ts`：`fixedKeeper`、`glutCount`、`glutMult`、`sellTotalOf`；`market.ts`：`categoryMult`；`shopNames.ts`：`generatedTitle`；`materialInfo.ts`：`tierForMonsterLevel`、`materialRecipes`、`auxLeaning`；`craft.ts`：`craftShopFor`、`craftKindsHere`；`recipes.ts`：`recipeOf`；`blueprints.ts`：`blueprintPrice`；`invention.ts`：`diceForAvg`、`sanitizeDesign`；`tattoos.ts`：`slaveMarkOf`；`parasiteEvents.ts`：`parasiteTemplates`、`parasiteCandidates` |
| 匯出了但只在自己檔內用（可去掉 `export`） | 約 70 個，多為型別（例：`character.ts` 的 `maxSkillQuality / powerGapAttitude / maxCantrips`；`gear.ts` 的 `activeExtraSlots / fitsExtra / RES_CAP / SELL_COST_CAP / findBase / findMaterial / isMainWeapon`；`combat.ts` 的 `isLustAbility / offenseMult / itemHitsEnemies / targetWeightFor`） |

「只有測試在用」多半是為了測試才匯出的內部函式（特別是 `combat.ts` 的 AI 與仇恨），不一定是死碼。

### 6.3 寫在引擎外的規則

| 位置 | 內容 |
|---|---|
| `src/components/DefeatEventPanel.vue:27` | 自己算 `mod(attr) + proficiency(level)`（和 `rollParts.attrParts` 重複） |
| `src/components/PlacePanel.vue:101` | 開鎖加值：`mod + 工具（只有 dex 才算）+ checkBonus`，規則分支寫在元件裡 |
| `src/components/TattooPanel.vue:78` | 價格 `Math.round(base * serviceMult)` 在元件裡算 |
| `src/components/CombatView.vue:430` | 抗性倍率 `Math.max(0, 1 + delta)`（和 `defenseMult` 的規則重複） |
| `src/components/party/CharacterDialog.vue:69`、`PartyCards.vue:121` | 直接讀 `classDef(x.class).caster` 決定顯示 |
| `combat.ts` `fromEnemy` | 地下城 id 前綴 `/^(lp|fg|pp)_/` 與 `kind === 'demon'` 寫死在程式裡（應該是資料） |
| `gear.ts` | `gearPrice` 的「每點附魔 +50%」、`scaled` 的 `0.15`、`SELL_COST_CAP = 10`、`MAX_TIER = 7`、`RES_CAP = 0.5` 是程式常數，不在 `gear.json` |
| `character.ts` `gainXp` | 等級上限 `20` 寫死 |
| `combat.ts` | `COMBAT_MINUTES_PER_ROUND = 1`、`enemyTurn` 最多 6 步、`finishCombat` 的戰敗扣錢 `0.1` 寫死 |

我只看了和本區相關的元件，沒有逐一檢查全部 `.vue`（約 80+ 個）。

---

## 7. 降低 ElondiaRPG 熵的建議（本區）

| # | 位置 | 問題 | 建議 | 風險 | 大小 |
|---|---|---|---|---|---|
| 1 | `combat.ts` `finishCombat`（約 260 行） | 一個函式處理經驗、掉落、好感、公會、委託、圖鑑、劇情、情報、園區、戰敗；是 `combat.ts` 引入 38 個模組的主因 | 拆成 `combatRewards`（純計算）+ 一串 `afterCombat` 掛鉤（各系統自己註冊），`combat.ts` 不再引入 `guild / intel / park / story / materialQuests / expedition` | 中：結算順序會影響報告文字與亂數消耗（測試會對種子） | L |
| 2 | `combat.ts` 內的慾望戰鬥（329 行散在各處） | 第二條軌和主流程交錯（`dealDamage / startTurn / useAbility / chooseAction / initLust`） | 抽成 `combatLust.ts`，主流程只留 4–5 個呼叫點（開戰、受傷分流、回合開始、行動後、結算） | 中：`dealDamage` 內的分流順序敏感 | L |
| 3 | `combat.ts` | 2,690 行單檔 | 依現有的 `// ----` 分段拆檔：`combatSetup / combatStatus / combatDamage / combatAi / combatTurn / combatReport` | 低：純搬移（但會動到循環引入的形狀） | M |
| 4 | `gear.ts` `syncGear` + `Character.weapon / armor` | 快取字串要手動同步（13 處） | 改成推導函式 `weaponOf(c) / armorOf(c)`，拿掉欄位 | 中：存檔相容、`NpcDef` 也有這兩欄 | M |
| 5 | `gear.json` 底材 + `equipment.json` 類型 | 兩層裝備定義 | 把武器骰／防具值併進底材，或至少集中一個 `baseCombat(base)` 存取點 | 中：資料遷移（306 個底材） | M |
| 6 | 骰子解析 4 份 | `combat.ts / upcast.ts / invention.ts / rng.ts` | 在 `rng.ts`（或新 `dice.ts`）放一個 `parseDice`，其他都用它 | 低 | S |
| 7 | `Mods` 加總 6 份 | 見 6.1 | 放一個 `sumMods(...sources)` 在 `data.ts` 旁 | 低 | S |
| 8 | `character.ts` `combatBonuses` vs `combat.ts` | 兩份算法手動保持一致 | 讓 `combatBonuses` 直接呼叫 `fromCharacter` 用的同一組純函式 | 低 | S |
| 9 | 各 `setupX / applyX` 的目標字串 | 每個行動自己編碼與解析字串目標 | 待決行動的 `target` 改成帶型別的物件（或一個共用的編解碼器） | 中：`actions.ts` 與存檔中的待決行動格式 | M |
| 10 | `inventory.ts` `useItem`、`combat.ts` `useItem` | 兩份、同名、各一個長 if 鏈 | 以 `def.use` 的鍵建一張處理表，戰鬥內外共用同一張（各自標註可用場合） | 中 | M |
| 11 | `combat.ts` 三處 `cells[y*width+x]` | 繞過 `grid.cellAt` | 改用 `cellAt` | 低 | S |
| 12 | `combat.ts` `fromEnemy` | id 前綴與 `demon` 寫死 | 改成怪物資料的旗標（例如 `no_young`） | 低 | S |
| 13 | `gear.ts` 的程式常數 | `0.5`、`0.15`、`SELL_COST_CAP`、`MAX_TIER`、`RES_CAP` | 移到 `gear.json` | 低 | S |
| 14 | `gear.ts`（1,229 行） | 混了欄位、數值、建角、掉落、AI 驗證、成人向 | 拆成 `gearSlots / gearStats / gearCreation / gearLoot / gearSanitize` | 低：被 74 個檔引用，可先留一個轉出口的 `gear.ts` | M |
| 15 | `schools.ts` | 名稱讓人以為是法術學派，內容是慾望流派 + 拘束 + 服裝 | 改名（例如 `lustSchools.ts`），把 `bindsOf / outfitCombat` 搬到對應模組 | 低 | S |
| 16 | `xpToNext` 同名兩份 | `character.ts`、`crafting.ts` | `crafting.ts` 的改名 `craftXpToNext` | 低 | S |
| 17 | 沒用到的匯出 | 見 6.2 | 刪掉 4 個完全沒用的；只在檔內用的拿掉 `export` | 低 | S |
| 18 | `classRebalance.ts` | 一次性遷移留在引擎主線 | 搬到遷移專用的資料夾，標上可移除的版本 | 低 | S |
| 19 | 引擎外的規則 | 見 6.3 的 4 個元件 | 在引擎加對應的函式（`checkBonusPreview`、`lockPickBonus`、`inkPriceHere`），元件只顯示 | 低 | S |
| 20 | `InventoryItem.name` 當主鍵 | 物品以顯示名稱識別（`state.customItems[name]`、目錄 `itemDef(name)`） | 引入穩定的 `id`，名稱只當顯示 | 高：存檔、2,146 件目錄、所有 `items_gained/lost` 報告 | L |

---

## 8. 沒有驗證的事項

- 沒有執行測試或型別檢查，也沒有實際跑遊戲；所有結論來自讀程式與 grep。
- `combat.ts` 沒有逐行讀完：`dealDamage` 中段（約 1500–1640）、`applyStatuses`、`useAbility` 後半、`resolveAuto / resolveLust`、`settleLust / settleNpcFoes` 只看了開頭與結構。
- `trade.ts`、`invention.ts`、`parasites.ts`、`parasiteEvents.ts`、`shopMods.ts`、`perks.ts` 後半、`gear.ts` 的建角段只看了匯出清單、檔頭註解與重點函式。
- 文件只看了 `docs/COMBAT_SYSTEM.md` 的章節標題；`PERKS.md / ITEMS.md / CRAFTING.md / TRADE.md / TATTOOS.md / MONSTERS.md` 沒有讀（程式檔頭的註解已指向相同內容）。
- 擴散數字是 grep 命中數（例如 `.level` 也會算到工藝等級、怪物等級），是量級參考不是精確值。
- 「沒用到的匯出」是名稱比對，見 6.2 的限制。
- `deps.json` 的 `rev` 數字（例如 gear 被 74 個檔引用）沒有區分測試與正式碼。
