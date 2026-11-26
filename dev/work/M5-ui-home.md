# M5-ui-home

- 交給：cpp-ui（sonnet）　（**第二波**）
- 目標：家園的畫面接上引擎：家的格子地圖（走路、擺設）、抬頭（住處、升級、搬家）、數字（舒適度、儲物、住戶）、房間、家具、人、安全屋、設施的入口；舊的 `stores/home.ts`、`data/home.ts` 的假資料與 `lib/home.ts` 的規則拿掉。
- 規格出處：docs/art/UI.md 第 12 節（全部）、1.1 節規則 3、「移動與快捷鍵」（家園擺設時方向鍵移動游標、E 放下、R 轉向）、「到了就看得到選單、按 E 才做」；DOWNTIME 第 7 節（讀懂畫面上每個數字）；dev/adr/0020 第十、十二節、V46～V50；dev/work/M5-home-base.md、M5-home-furnish.md、M5-home-people.md 的匯出。
- 可以改的路徑：`ui/src/screens/HomeScreen.vue`、`ui/src/components/GridMap.vue`（只加家具與人的畫法）、`ui/src/lib/`（新增 `homeView.ts`；`home.ts` 只留畫面要的幾何小函式，規則拿掉；`here.ts`、`useWalk.ts` 只加轉接）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/screens/MainScreen.vue`（「回家」的入口改成引擎的）、`ui/src/dialogs/RestDialog.vue`（睡在家的那一段讀引擎）、`ui/src/data/demo/`、`ui/tests/home/`；刪 `ui/src/stores/home.ts`、`ui/src/data/home.ts`；`ui/src/lib/home.test.ts`、`residences.test.ts` 裡測規則的案例刪掉（那些規則現在在引擎，引擎有自己的測試）。
- 可以用的介面：`Game.gridView`、`Game.gridMove`；`@engine/src/features/home` 的 `homeView`、`listings`、`rent`、`leave`、`buy`、`sell`、`setMain`、`upgrade`、`addMod`、`enter`、`exit`、`placeCheck`、`place`、`move`、`rotate`、`pickUp`、`roomsView`、`setRoomUse`、`comfortView`、`stashView`、`stashPut`、`stashTake`、`hereUses`、`peopleView`、`invite`、`inviteChance`、`askLeave`、`bringHome`、`seeOff`、`stayOver`、`hire`、`fire`、`visitChance`；`Game.commit`／`commitNarrated`；共用元件 `GridMap`、`HereOptions`、`ItemSlot`、`Hint`、`ReasonButton`、`Tabs`、`MoneyTag`。
- 不可以做的事：不改 `engine/`；放不放得下、用途、舒適度、儲物的容量、上限都讀引擎，畫面沒有任何一條規則；人怎麼走過去是畫面自己的動畫（引擎只說這個時段在哪一間，V47），不寫回引擎；店面的分頁是 M5-ui-away-shop 的；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **地圖**：`GridMap` 畫引擎的 `gridView`（家的實例）：牆、門、大門；房間是上了淡色的區域，左上角寫房名與現在的用途（讀 `roomsView`）；家具是佔好幾格的方塊（圖示、名字、朝向的那一邊一條粉線）；主角是引擎的位置；住戶、家務、訪客是圓形的標記，放在引擎說的那一間裡（位置由畫面在那一間的空地上挑、平滑地走過去；換時段時走到新的一間）。
2. **走路**：點地板尋路、方向鍵走一格、E 做這一格或旁邊家具的預設行動；被擋下時顯示引擎的原因。站在大門上列「出門」。
3. **擺設**（抬頭的切換）：點家具選取，轉向（R）、移動、收起；從側欄擺新的（背包裡帶 `furniture` 的物品）。拿著家具時游標下是預覽：綠的放得下，紅的直接顯示引擎的原因（「不能擋住門」「整件要放在同一間房裡」「會把路堵死」……不收進「?」）。預覽每移一格問一次 `placeCheck`。方向鍵移動游標、E 放下。
4. **抬頭**：住處名與所在、等級（與上限）、地圖大小、隱蔽、週租；施工中顯示還剩幾天；「升級」（先顯示費用與工期）、「搬家」（選另一處當家）、改裝五種（費用、工期、已經有的打勾）。
5. **數字**：舒適度與它到了哪一段（「?」是 `comfortView` 的拆解與下一段的門檻）、儲物（種，另寫保險箱與裡面的現金）、住戶（幾個／上限、床位）。
6. **側欄三個分頁**：房間（每間：名字、格數、家具幾件／家具位、用途——滿足好幾種時是下拉選單）、家具（背包裡的：佔地、舒適；點了進擺設）、人（主角、住戶與效果、訪客與剩多久、家務與週薪；請住進來先顯示機率、請離開先確認、送走訪客、留下來過夜；雇與辭）。
7. **設施的入口**（`hereUses`）：站到床、箱子、直播桌、工作台、接入艙旁邊，側欄出現它的行動——睡一覺（開現有的休息對話框）、打開箱子（存取的小面板：左邊背包、右邊這個箱子，滿了的原因）、打開頻道、組裝、自己動刀、潛入（後三個是 M3、M4 既有的畫面：M4-ui-craft 的組裝、M4-ui-body 的手術、M3-ui-dive 的潛入；它們在家裡做不做得成由引擎回答——M5-home-links 做完之前，組裝與動刀看的還是住處的等級、潛入要站在潛艙店——做不成就灰掉並顯示引擎的原因）。
8. **安全屋**：最多兩處，每處一列（地點、隱蔽、週租與付哪種錢、能做什麼）；「去那裡」只是提示怎麼走（它在城裡的哪一塊），退租。租新的住處：站在出租的設施上時主畫面的「這裡」列出（讀 `listings`）。
9. **上門的機率**：人的分頁最下面一行「這一週有人找上門的機會」與「?」裡式子的每一項（讀 `visitChance`）。
10. **示意包**：起點的住處（四號塔的一級與二級兩張版面，照 `data/home.ts` 原本的 `TOWER4_LAYOUTS` 改成引擎的 `special_map` 格式）、十來件家具的物品（照原本的 `FURNITURE`）；示意模式的開新局選項：開局擺好的幾件（含一張工作台與一張床）。
11. 手機版：地圖在上，數字與分頁在下；擺設時的按鈕列在地圖正下方。

## 驗收條件（`ui/tests/home/M5-ui-home.test.ts`；用引擎真的 `home`，測試自帶一處二級的家）

- 主畫面站在自己的住處上：「這裡」有「回家」；進去之後 `/home` 畫的格子與位置等於 `gridView`。
- 擺一張床：預覽在牆上是紅的、原因等於 `placeCheck`；放在空地是綠的；放下之後引擎的 `furniture` 多一件、地圖上那幾格走不過去。按 R 佔地對調。
- 用途的下拉選單的選項等於 `roomsView` 的「滿足的用途」。
- 舒適度的數字與段等於 `comfortView`；「?」裡每一項都在。
- 打開箱子：放一種進去，背包少了、箱子多了；滿了的時候放不進、原因對。
- 人的分頁：住戶與上限等於 `peopleView`；標記畫在引擎說的那一間裡（位置落在那一間的格子內）。
- 升級的按鈕先顯示費用與工期；錢不夠是灰的、原因對。
- 出門回到主畫面原本那一格。
- 掃原始碼：`ui/src/stores/home.ts`、`ui/src/data/home.ts` 不存在、沒有任何檔 import 它們；`ui/src/lib/home.ts` 沒有 `validatePlacement`、`deriveRooms`、`comfort(`、`storage(`、`shopWeek`；`HomeScreen.vue` 沒有自己算舒適度或檢查擺放的函式。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-home-base、M5-home-furnish、M5-home-people。排在第一波的介面工單之後。

## M4 對帳（2026-11-26）

- **示意模式**（使用者 2026-11-26；M4-fix-ui 第 2 題）：示意世界包裡「世界上有的東西」（模板、目標、議題、住處的版面、物品）照舊放 `ui/src/data/demo/`；「開局就已經有」的東西是示意捷徑，一律做成開新局的選項，而且只有示意模式開著才出現——不放進一般的新局、不在對話框裡另外給按鈕。照 M4-fix-ui 做好的那一套接（`demo…Changes` 在 `game.new` 給一次）。
- `ui/src/stores/engine.ts` 裡租屋、退租、睡一覺的轉接，import 的路徑在 M5-home-base 已經從 `features/rest` 換成 `features/home`（只換了路徑）；這一張才把畫面接到新的入口（多處、買斷、升級、改裝）。
- 人的分頁裡「契約人」那一種住戶是引擎從契約問來的（M5-contract-link 之後才會有）：這一張照 `peopleView` 給的列，沒有就沒有；請他搬走不在這裡，連到 M4 的契約面板（「他的住處」）。
- 在家能做的事裡，技能配置、自己染色、改化身（M4）只問「人在不在自己的住處」，不靠家具：它們照舊從各自原本的入口開，不列在 `hereUses`。

## 完成時回報

改了哪些檔、測試結果、引擎沒給所以沒顯示的、刪掉的舊測試案例有沒有引擎那一邊沒涵蓋的（列出來給審查）、UI 第 12 節要跟著改的地方。
