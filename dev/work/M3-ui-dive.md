# M3-ui-dive

- 交給：cpp-ui（sonnet）　（**第二波**；使用者不要第二波時不做，M3-ui-subnet 灰掉的兩個入口維持灰掉）
- 目標：潛入與登出的畫面：站在接入點上列「潛入」、進去之後選去處、自己去挖的子網與迷宮館的報名與結算、登出；主畫面與家裡原本的假入口換成真的。
- 規格出處：docs/art/UI.md 第 5 節（開頭「潛入之後，地圖區換成子網」）、1.1 節「到了就看得到選單、按 E 才做」；CYBERSPACE 2.2、2.3 節（接入點與誰能進）、8.2 節（報名的表、評價）；dev/adr/0018 第八節；dev/work/M3-dive.md、M3-netrun-dig.md、M3-maze.md 的「新的格式與鍵」與匯出的函式。
- 可以改的路徑：`ui/src/screens/MainScreen.vue`、`HomeScreen.vue`、`SubnetScreen.vue`（只加這幾種行程的抬頭與結算）、`ui/src/dialogs/`（新增 `DiveDialog.vue`）、`ui/src/lib/`（新增 `diveView.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/App.vue`（內海皮照活動）、`ui/src/data/demo/`（潛艙店的設施資料、兩筆去處、迷宮館的小表）、`ui/tests/net/`。
- 可以用的介面：`@engine/src/features/dive` 的 `diveOptions`、`enter`、`sites`、`go`、`exit`、`diveView`；`@engine/src/features/maze` 的 `brackets`、`enter`、`mazeView`；`@engine/src/features/netrun` 的 `netrunView`；`Game.commit`／`launch`。
- 不可以做的事：不改 `engine/`；費用、能不能去、評價都讀引擎；內海固定區塊的畫面不做（沒有內容）；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. **接入點**：站在帶「潛入」的設施上，「這裡」列出潛入（費用、押金、用的是自己的還是租的甲板；做不到的原因是引擎的句子）。主畫面工具列與家裡的假入口拿掉或改成打開同一個選項。
2. **潛入之後**（對話框 `DiveDialog`，內海皮）：列去處（去不了的灰掉並寫原因）、身體在哪、登出。潛入中主畫面現實的操作被引擎擋下時，顯示引擎的那一句。
3. **自己去挖**：子網頁的抬頭多設施類型、這座子網上次離開的日子；離開時的結算列帶走的東西與留下的敵對值（引擎那份報告的資料）。
4. **迷宮館**：報名的三個組別（押金、能用的構裝、獎金；不能報的原因）；館內子網頁的抬頭換成回合數對標準、籌碼、預估的評價（沒有追蹤度條）；結算的畫面列評價、獎金、獎品、押金退了沒有。
5. **登出**：回到主畫面、位置是潛入前的地方、皮換回來。
6. 示意世界包：一間潛艙店（放在示意包現有的一塊街區）、一筆自己去挖的去處（示意包的那個勢力）、一筆迷宮館、迷宮館的小表。

## 驗收條件（`ui/tests/net/M3-ui-dive.test.ts`；用引擎真的 `dive`、`netrun`、`maze`，資料用測試自帶的）

- 站在潛艙店上：選項與費用和 `diveOptions` 一樣；錢不夠時灰掉、原因逐字相同。
- 潛入：畫面套內海皮、對話框列出去處；選自己去挖的那一筆，到了子網頁。
- 從子網的出口離開：回到去處的清單；登出：回到主畫面、現金少了費用、位置沒變。
- 迷宮館：報新手組、走完三層（測試用程式自動走）、結算的評價與獎金等於引擎的 `maze.result`。
- 潛入中按主畫面的「休息」：被擋，顯示引擎的原因。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M3-dive、M3-netrun-dig、M3-maze、M3-ui-subnet。

## 完成時回報

改了哪些檔、測試結果、沒做的入口（投影、固定區塊、接入艙）。
