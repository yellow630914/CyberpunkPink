# M5-home-links

- 交給：cpp-feature（sonnet）　（**第二波**；dev/adr/0020 第十四節 D6、D7 說「等 M4 做完再看」的那一張，2026-11-26 M4 對帳時開的）
- 目標：讓 M4 的功能認得 M5 家園的房間用途與箱子——在家組裝與修義體看工作間、自己動刀看診療室、從家裡潛入看接入室、診療室睡一覺算傷口處理過、安穩的家每週多降一點沉溺、在家組裝時箱子算背包的延伸、剪片認自己的轉播站。每一處都是「家園有裝才換成看家具，沒裝照 M4 原樣」。
- 規格出處：DOWNTIME 7.4 節「用途的條件與效果」那張表、7.6 節（安穩）、7.7 節（在家組裝時箱子算背包的延伸）；CRAFTING 第 10 節（工作台）；CYBERWARE 第 2 節（自己動刀的場地）；CYBERSPACE 2.2 節（據點的接入艙：二級以上、身體有鎖、可以多人一起潛）；MEDIA 第 3 節（剪片的地點）；dev/adr/0020 文末「M4 對帳」D6、D7；dev/work/M5-home-furnish.md（條件 `home_use`、`home_has_item`、效果 `home_take`、計數器 `snug:<週>`）、M5-shop.md（條件 `at_own_shop`）。
- 可以改的路徑（每個功能只加下面列的那幾行）：`engine/src/features/craft/`、`engine/src/features/cyberware/`（`surgery.ts`、`repair.ts`、規則表的型別）、`engine/src/features/medical/`（`common.ts`）、`engine/src/features/dive/`、`engine/src/features/rest/`（`ops.ts`）、`engine/src/features/sink/`（`weekly.ts`、`model.ts`）、`engine/src/features/media/`（剪片地點的那一個判斷）、`engine/src/features/home/`（只加回答 `craft.stock`、`home_take` 多收 `uid`）、`engine/tests/features/M5-home-links.test.ts`。
- 可以用的介面：條件 `at_home { use }`、`home_use`、`home_has_item`、`at_own_shop`（都先看 `k.conditions.kinds()`）；效果 `home_take`（先問 `k.effects.has`）；計數器 `snug:<週>`；各功能自己的規則表（加欄位、`overridable`，預設寫在功能裡）。
- 不可以做的事：功能之間不互相 import（全部經條件、效果、計數器與一個新掛點）；**沒有裝家園的局行為和這一張之前逐欄相同**（每個功能既有的測試原樣全過）；不改診所、店家、潛艙店那一半的判斷；不做車庫（機甲在 M6）、遊戲間的契約選項（內容）、玩家社團接訂做；共同的規定見 dev/work/M5-plan.md。

## 共同的寫法

「家園在不在」＝`k.conditions.kinds().includes('home_use')`。在：照下面看家具；不在：M4 原本的判斷一個字都不動。每個功能把這個判斷收在自己的一個小函式裡，不要散在各處。

## 要做的

1. **craft：工作間**（`model.ts` 的「有工作台的地方」「自己組裝的地方」兩個函式）：家園在時，住處那一半從 `at_home { level_min: self_home_level }` 改成 `at_home { use: 'workshop' }`。在工作間裡自己做：組裝難度 −1、換零件（`swap`）花的時間減半。數字放 `craft_rule`（`home_workshop: { dc: -1, swap_time_mult: 0.5 }`）；組裝預覽的難度明細多一行「工作間 −1」。
2. **cyberware：自己修與自己動刀**：`repair.ts` 的「自己修要在有工作台的住處」同樣改成 `at_home { use: 'workshop' }`。`surgery.ts` 自己動刀的地點，家園在時住處那一半改成 `at_home { use: 'surgery' }`（診療室），而且在家只能裝侵入度一般以下的——核心的 `INVASIVENESS` 是 `surface`、`light`、`invasive`、`heavy`、`extreme`，在家收前三種（上限放 `cyber_rule` 的 `home_surgery_max: 'invasive'`）；超過的原因：「家裡的診療室只做得了一般以下的手術。」診所不限。拆除照同一條。
3. **medical：自己動刀**（`common.ts` 的 `atHomeOrClinic`）：家園在時住處那一半看 `at_home { use: 'surgery' }`。
4. **rest：診療室睡一覺算處理過**（`ops.ts` 的 `sleepOptions`）：`home` 那一項的 `treated`，家園在而且 `at_home { use: 'surgery' }` 成立時是 `true`（現在固定是 `false`）；其餘照舊。
5. **dive：從家裡潛入**（`ops.ts` 決定「這裡是不是接入點」的地方）：家園在而且 `at_home { use: 'netpod' }` 成立時，這裡算一個接入點——`access: { type: 'home', safe: 3, name: '家裡的接入艙' }`，不收錢、不租甲板。`dive` 沒有自己的規則表：安全度本來是設施種類的 `dive.safe`（0～3），家裡的這一格先寫成功能裡的一個常數 `HOME_ACCESS_SAFE = 3`（「身體有鎖、有維生」＝最安全的那一級；暫定）。站在帶 `dive` 欄位的設施上照舊優先。
6. **sink：安穩**（`weekly.ts` 的自然下降）：上一週的計數器 `snug:<週>` 大於 0 而且自然下降成立（睡滿 `decay.sleeps` 次、沉溺不到 100）時，多降 `decay.snug`（`sink_rule` 加這一格，預設 1）；一樣走 `sink` 效果（下限會擋）。沒有那個計數器就是 0，行為不變。
7. **media：剪片認轉播站**：剪片與偽造的地點多一個「或條件 `at_own_shop { kind: 'relay' }` 成立」（有人註冊才問）。
8. **在家組裝時箱子算背包的延伸**（D7；一個新掛點）：
   - craft 宣告並問 `craft.stock`：`{ state }` → `{ owner, stacks: ItemStack[]（現在拿得到的每一疊，帶 `data.uid`） } | void`。組裝與換零件挑零件時，背包之外也列這些疊（預覽標出「在家裡的箱子」）；用掉其中一疊時，不寫背包的 `item` 變更，改發效果 `home_take { uid, qty }`（`k.effects.has` 是真的才列這些疊）。
   - home 回答 `craft.stock`：人在自己住處的地圖裡（或站在那個設施上）而且那一處有工作間時，回那一處不在保險箱與暗格的箱子裡的每一疊；其餘不回。`home_take` 多收 `uid`（M5-home-furnish 的版本只收 `item`、`qty`；這一張補）。
   - 這一項做到一半發現 craft 挑零件的地方（`resolvePicks`、`partStatesRecord`）接不上，就停在「列得出來、用不了」並回報，不硬改 craft 的結構。

## 驗收條件（`engine/tests/features/M5-home-links.test.ts`；測試裝全部功能，照 M5-home-furnish 測試的做法自己起一個二級的家，自帶工作台、手術椅、接入艙、一個箱子的家具物品）

- 沒有裝 `home` 的局：craft、cyberware、medical、dive、rest、sink、media 的既有測試原樣全過（這一條是整張工單的底線）。
- 工作間：二級的家沒擺工作台 → 在家組裝被擋（原因對）；擺了 → 做得了、難度比在店裡自己做少 1、換零件的時間是一半；搬走工作台又被擋。自己修義體同理。
- 診療室：沒有手術椅自己動刀被擋；有的話一般以下的裝得上、`heavy` 的被擋並有那一句；診所不受影響。醫療的自己動刀同理。
- 在有診療室的家睡一覺：生命低於一半的人照「處理過」回復（不被卡在一半）；沒有診療室照舊。
- 接入室：站在家裡（有接入艙）可以潛入、不收錢；沒有接入艙不行；`dive.enter` 那一份照樣帶 `login`；登出回到家裡。
- 安穩：上一週 `snug` 是 2、睡滿了 → 沉溺多降 1；沒睡滿不降；下限照擋。
- 剪片：站在自己的轉播站裡剪得了。
- 箱子：家裡的箱子有一個零件、背包沒有 → 在家的工作間組裝列得出來、做完之後箱子少了那一個、背包沒變；人不在家時不列。
- 分層檢查全過（沒有新的功能對功能 import）；`npm test`、`npx tsc --noEmit` 全過。

## 依賴

M5-home-furnish（條件與計數器）、M5-shop（`at_own_shop`）、M5-media-cut。做的時候不要有別的工單在改 `craft`、`cyberware`、`medical`、`dive`、`rest`、`sink`。介面不用另外派工：M5-ui-home 的 `hereUses` 入口開的本來就是那幾個既有的畫面，它們的灰與原因讀引擎。

## 完成時回報

每個功能改了哪幾行、測試結果、第 8 項做到哪裡、接入室「可以多人一起潛」現在的潛入是不是本來就全隊一起（不是的話差什麼）、示意包要不要開局擺一張工作台（不擺的話示意局在家組裝不了）。

## channel-shows 留下的（2026-11-26）
- V17：棚內設備在「住處或轉播站」算。channel 現在只認自己的住處；在 `features/channel/gear.ts` 的 `gearValue` 加轉播站的條件。
