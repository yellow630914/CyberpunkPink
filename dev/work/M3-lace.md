# M3-lace

- 交給：cpp-feature（sonnet）
- 目標：`features/enemies` 的內海面：照內海的目標表把敵人資料組成內海的單位（沒有生命、防護、RAM、武器構裝、固定的同步檔位、蕾絲的顏色、管理行動的次數）；`enemy_pick` 在內海照勢力與位階挑網內的兵種；掉落只有解剖拿得到的構裝與憑證。
- 規格出處：ENEMIES 1.2 節、1.5 節的「內海」表、第 2 節（`mods` 的 `guard` 與 `ram`）、第 9 節（全部）、第 15 節最後一個樣本；DATA 6.2 節；CYBERSPACE 6.2 節（感載基準、攻擊骰）、6.4 節最後一條（敵人的檔位）；dev/adr/0018 第四節與 N18、N19、N20。
- 可以改的路徑：`engine/src/features/enemies/`、`engine/tests/features/M3-lace.test.ts`、`engine/src/testkit/battle.ts`（只有內海目標表那一份要和這裡比對時；改 testkit 要在派工時明說）。
- 可以用的介面：`k.battle.unitSource`（`ctx.mode`）、`modeOf`、`weaponFromClass`、`gradeDice`、`enemyCoefFor`、`k.battle.modifier`（`ai_target_pct`）、`k.battle.on('turn.start')`、`run.setOut`、`battle.field.trace`、現有的掉落（`loot.ts`）與戰利品的流程、`k.content`（讀 `construct`、`item`，有人定義才讀）。
- 不可以做的事：不 import `features/netcombat`、`features/deck`；不替蕾絲的顏色寫行為的程式（行為是招牌行動的資料加 AI 的參數；這一張只把資料變成單位與標籤）；不匯入名冊；現實的單位怎麼組一行都不動；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 內海的目標表（放 `curve.ts`，和現實那張並列）：攻擊 +3～+7、防護 1～5、感載上限同現實那一欄、RAM 雜兵 4／4／5／5／6、精英 6／6／7／7／8、首領 8／8／9／9／10、每回合回 2／2／2／3／3、防火牆（迴避）11 ＋ 等級（N19）、傷害骰雜兵 4、精英 5、首領 6 再加等級骰（N18）。
- `enemy` 的欄位（只在內海用）：`constructs?: [{ id, class, name?, type?, ram?, range?, traits? }]`（`class` 是 `weapon_class` 的 id）、`sync?`（`shallow`、`standard`、`deep`、`full`、`shift`；沒寫：雜兵標準、精英深、首領 `shift`）、`color?`（`white`、`pink`、`black`，只有 `kind: 'lace'`）、`admin?`（每回合幾次管理行動）、`persona?`（有人格）；`mods` 多 `guard`（加減）、`ram`（加減）；`loot` 的項目多兩種：`{ construct: id | 'random', chance, needs? }`、`{ credential: true, chance, needs? }`，`needs` 只收 `'dissect'`。
- `enemy_pick` 的 `UnitRef` 多選填的 `color`、`layer`（原樣放到 `ext.enemies`，不影響數字）。
- 單位上：`tags` 多 `lace`、`lace:<色>`、`program`、`tether`（粉色的蕾絲與帶 `admin` 的人）、`admin`與 `netrunner`（`admin` 大於 0）、`persona`；`ext.net = { sync, sync_max, admin? }`；`ext.deck = { grade, firewall, slots: [], constructs }`（讓破損與駭入程式的讀法和角色一樣）。

## 要做的

1. 來源 `enemy`、`enemy_pick` 拿到的戰場是內海時走內海的組法：沒有 `hp`、`armor` 是防護、`load` 照表乘修正與難度、`pools.ram`、武器來自 `constructs`（距離、遮蔽倍率、特性照原型；骰數照位階的表加等級骰；沒有彈匣、`pool: { ram }`、預設神經）、`evade` 是防火牆、`dmgMult` 的感載照難度與強度係數（不吃位階的倍率）。白蕾絲可以沒有 `constructs`（不攻擊）。
2. 放錯戰場的兵種整步不成立（丟錯，訊息寫出兵種與戰場）：沒有 `constructs` 也不是 `lace`／`program` 的兵種進內海；`lace`／`program` 進現實。
3. `enemy_pick` 在內海：候選是那個勢力、位階對、等級範圍含這一級、`kind` 是 `lace`、`program` 或寫了 `constructs` 的兵種；`color` 有寫只挑那個顏色；那個勢力沒有就退到 `faction: 'none'` 的；都沒有丟錯。現實照舊不挑 `lace`、`program`。
4. AI 的參數：資料的 `ai.prefer_deep_sync` 變成修正 `ai_target_pct`（候選人在深檔 +50、全檔 +100；看標籤 `sync:<檔>`）；白蕾絲在 `battle.field.trace` 到 60 以上時，自己的回合開始就撤走（ENEMIES 第 9 節）。
5. 掉落（N20）：內海的戰鬥結束時，現金與零件的項目不擲；`needs: 'dissect'` 的項目要我方這一場有人帶 `dissect` 標籤而且沒有倒下才擲；`construct: 'random'` 從內容的 `construct` 裡挑等級不超過這個敵人、類別是武器、防護或工具的一件（沒有人定義 `construct` 就略過）；憑證是一件物品（規則 `credential_item`，內容裡沒有就略過）。
6. 遭遇的點數（`encounterPoints`）內海照同一套（COMMISSION_TEMPLATES：蕾絲照位階算點）。
7. 內海的目標表和 `engine/src/testkit/battle.ts` 的那一份（M3-core-battle 寫的 `BATTLE_SETUPS.net` 用的）比對一致。

## 驗收條件（`engine/tests/features/M3-lace.test.ts`；測試自帶六筆假兵種：白、粉雜兵、粉精英、黑、閘門守衛（首領）、企業潛網者，與三個 `weapon_class`）

- III 級的粉雜兵（`mods: { load: 0.9, guard: 1 }`）：沒有 `hp`、感載上限是 33 × 0.9 四捨五入、防護 4、RAM 5、每回合回 2、迴避 14、武器 4 ＋ 1 顆骰、沒有彈匣、`pool.ram` 是資料的。
- 精英預設深檔、首領預設 `shift`、雜兵標準；資料寫了就照資料。
- 標籤：粉的有 `lace`、`lace:pink`、`tether`；白的沒有武器；企業潛網者（`admin: 2`）有 `admin`、`netrunner`，`ext.net.admin` 是 2。
- 現實的兵種放進內海戰鬥、蕾絲放進現實戰鬥：開不起來，原因寫出是哪一個兵種。
- `enemy_pick`：內海、勢力甲、精英 → 挑到勢力甲的粉精英；`color: 'black'` 只挑黑的；勢力乙沒有網內的兵種 → 挑到 `none` 的；現實的 `enemy_pick` 永遠挑不到蕾絲（既有測試原樣通過）。
- 難度的係數乘在感載上限與造成的感載上（對 `enemyCoefFor` 的數字）；位階的傷害倍率在內海是 1。
- 追蹤度 60 時白蕾絲在自己的回合開始撤走；59 時不撤。
- 掉落：內海打贏，寫了現金的兵種沒有掉現金；`needs: 'dissect'` 的構裝在隊上沒有 `dissect` 標籤時不掉，有的時候照機率（固定種子）掉。
- 用 `TEST_NET_COMBAT`（或 netcombat，有裝的話）把四個化身對這六種各打完一場，不丟錯、不變式沒有違規。
- 現實的敵人測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-core-battle、M3-netcombat-out（招牌行動用的 `net.*` 效果已經註冊，測試的資料才載得進來）。做完才能開 M3-netrun。

## 完成時回報

改了哪些檔、測試結果、ENEMIES 第 9 節那張表裡現在的格式寫不出來的行為（預期：高階粉蕾絲「依橋參數挑手段」、流形蕾絲中途變色）。
