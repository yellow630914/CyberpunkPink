# M4-curtain-run

- 交給：cpp-feature（sonnet）
- 目標：簾後館的一趟：四幕的生成、場熱、點單、賞箱、化妝室、後台的近道、契約的條文、每場遭遇擲文化、結算（獎金、打賞、票根）、加演。
- 規格出處：CYBERSPACE 8.8 節「一趟的結構」「和 8.1 節不一樣的地方」（點單、場熱、打賞、近道、條文、賞箱、化妝室）、「獎品表」、「敵人的文化」開頭三條、「獎勵」的表；8.1 節（生成的十個步驟，只看和迷宮館相同的部分）；8.2 節延長賽的數字（加演照它）；dev/adr/0019 第十二節與 P57、P58；`engine/src/features/maze/`（同一套接法：節點、`netrun.round`、`netrun.close`、戰鬥結束）。
- 可以改的路徑：`engine/src/features/curtain/`、`engine/tests/features/M4-curtain-run.test.ts`。
- 可以用的介面：M4-curtain-entry 的狀態與規則；掛點 `netrun.round`、`netrun.close`（用名字掛）、`k.battle.onEnd`、`k.grid`（`passRule`、`usesOf`、`onEnter`：只在這一區的地圖上作用，先看 `ext.net.region`）；地圖實例的 `ext.net`（只讀格式：`graph`、`foes`、`rested`）；量表（`k.meters.define`：`heat`）；`launch` 活動 `scene`（`nature: 'work'`、`goal: 'please'`、`layer: 'net'`）與聽它的 `activity.end`；`director.cast`（生成演出者的臨時角色；沒有人回答時合演重擲）；`makeCheck`；條件 `skin_style`（`features/deck`；沒有人註冊時換裝的點單重擲）；核心的計數器（票根）、`item`、`cred`／`cash` 變更；`deriveRng`。
- 不可以做的事：不做落幕之後的補演與三條路（下一張）；不做直播、內場帶、檔期榜（P57）；不寫敵人、獎品、點單文字的內容（表是資料，測試自帶）；不 import `netrun`、`maze`、`scene`、`deck`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 量表 `stage_heat`（場熱；原先叫 `heat`，M4 收尾修正批改名，`heat` 留給 M5 的直播熱度；照那一趟的地圖實例；0～100、起始 30；AI 不能給）。
- 規則 `curtain_rule` 多：`acts`（四幕各自：`{ id, name, encounters, orders, chests, boss?: 'headliner' | 'director' | 'host', turns（標準回合數：12、15、15、12）, shortcut?: boolean }`；散座的終幕沒有 `host`）、`heat`（漲跌的每一項：亮點 +2 與每場上限 +10、點單完成 +8、拒絕 −5、倒下每人 −10、超過標準回合每 3 回合 −2、每 3 個探索回合 −1、場景的三級 +10／+5／−5、化妝室 +5、包場 +10；門檻 `sponsor: 70`、`encore: 90`）、`tips`（場熱對獎金的比例：20 以下 0、0.1、0.2、0.35、0.5）、`stub_value`（20）、`encore`（第 5、6 幕：敵人高幾級、獎金 ×2、×4）、`culture_own`（0.6）、`clause`（`{ tips_cut: 0.2, stubs: 5 }`）、`shortcut`（`{ deposit_cut: 0.1, heat: -5 }`）。
- 內容種類 `curtain_table`（點單表、賞箱表、獎品表，各一筆 d6 的表；測試自帶）。
- `state.ext.curtain.run`：`id`、`tier`、`night`、`deposit`、`act`、`orders: Array<{ kind, state: 'open' | 'done' | 'refused' }>`、`pending?`（等著完成的點單：下一場要守的規矩）、`sponsor?: boolean`、`tips_mult`（1；條文與包場會改）、`downed`、`over_turns`。票根是計數器 `curtain:stubs`。
- 節點（用網內的格子種類裡現有的幾種，照 `maze` 的做法在 `ext.net` 的標記上加自己的 `kind`）：`order`（點單）、`chest`（賞箱）、`clause`（條文）、`shortcut`（近道）；層與層之間的休息點是化妝室。
- 報告：`curtain.use`（點單、賞箱、條文、近道）、`curtain.rest`（化妝室）、`curtain.result`（結算）。匯出：`useCurtain(k, state, id, at?)`、`orderChoices`、`restDraft(k, state, { book?: boolean })`、`curtainView`（第幾幕、場熱與三段的說明、這一幕用了幾回合、點單、票根、贊助人在不在）。

## 要做的

1. 生成：每一幕一層，照 `acts` 放遭遇、點單、賞箱、閘門前的層主、近道、條文（0～1）；節點 7～9。照 `maze` 把 `region` 整筆交給 `netrun`（M4-curtain-entry 已經開了那一趟；這一張補每一層的 `spec`）。
2. 每場遭遇擲文化（P58）：`culture_own` 的機率是這一夜的，其餘平均分給別的夜；開戰時敵人從那個文化的資料裡挑（`enemy` 的 `culture` 標籤；挑法照 `maze` 叫 `enemies` 的來源 `enemy_pick` 的方式加一個標籤的篩選）。層主固定是這一夜的文化。
3. 場熱：照規則表每一項加減（戰鬥的亮點在 `battle.onEnd` 數這一場的事件：要害、把對手打到過載、同一回合打倒兩個；每場最多 +10）。到 0：提早落幕（不算戰敗：這一趟以 `done` 結束、已經拿到的獎金與票根照算、沒有打賞）。第一次到 70：`sponsor` 是 true（立旗標 `curtain_sponsor`，線頭是內容）。第一次到 90：可以加演。
4. 點單（d6，`curtain_table`）：走到節點才擲；接受或拒絕。六種：換裝（下一場全隊的 `skin_style` 要對到主題、值 2 以上：開打時檢查）、守規矩（下一場不能超頻、不能換檔：戰鬥結束時看這一場的事件）、指定的收尾（最後一個敵人被神經或快感傷害打倒）、合演（`launch` 一場 `scene`；對象是 `director.cast` 生成的演出者；結算照契合的評價換場熱）、台詞（表演檢定對那一級的 DC，大成功再 +4）、返場（P57：重擲）。完成：場熱 +8、票根 3～8 枚；沒完成當拒絕。`pure_stage` 時合演換成一次表演檢定。
5. 賞箱（d6）、獎品表（首領保證一次、終幕的獎品室一次）：照表給票根、物品（構裝、SKIN 的 id 由表的資料寫）、「下一個點單賞金 ×2」的記號。
6. 近道：潛行的檢定（或 `skin_style` 是員工的風格時 +4）過了跳過一場遭遇（那一場沒有場熱）；失敗保證金扣一成、場熱 −5、不開打。條文：意志或調查對那一級的 DC 看穿就直接過；簽了：這一趟的 `tips_mult` −0.2、票根 +5。
7. 化妝室（層與層之間）：感載歸零、餘韻全消、RAM 回滿、場熱 +5；`sponsor` 在場時可以選包場（花一個探索回合、票根 +10、場熱 +10、之後這一趟的 `tips_mult` −0.1）。
8. 結算（`netrun.close`，`outcome` 是 `done`）：破關獎金（席次的 `prize`；提早落幕的沒有）＋打賞（獎金 × 場熱那一段的比例 × `tips_mult`；主打的夜 × `feature_bonus`；同伴沒有）＋保證金退回；`member.clears` +1；這一週的 `tips` 累加；發 `curtain.result`。全員拔線（`retreat`、`left`）：保證金退一半、票根留著、沒有獎金與打賞。倒下的人不加沉溺（`region.safe`）、不丟東西。
9. 加演：場熱到過 90，或這一趟的點單全部接受而且完成：終幕之後可以選進第 5、6 幕（敵人高一、兩級，獎金 ×2、×4，保證金不加）。
10. 戰敗（全隊倒下）這一張只做到「這一趟以戰敗結束時把狀態交給下一張」：`netrun.close` 的 `outcome` 是 `defeat` 時記下輸在哪一幕、當時的場熱，別的不做。

## 驗收條件（`engine/tests/features/M4-curtain-run.test.ts`；和 `netrunFeature`、`enemiesFeature`、`sceneFeature` 一起裝；測試自帶三張表、兩種文化各兩個敵人、一個層主）

- 任何種子生成的四幕都合格（性質測試：每一幕的遭遇、點單、賞箱數量在範圍裡；散座的終幕沒有主持）。
- 場熱：起始 30；一場戰鬥有三次要害只 +6、十次也只 +10；倒下一個人 −10；拒絕點單 −5；到 0 提早落幕、有獎金之外的票根、沒有打賞。第一次過 70 立旗標、只立一次。
- 六種點單各一條：接受「守規矩」之後那一場換了檔，戰鬥結束時算沒完成；「台詞」大成功 +12；「合演」開了一場 `layer` 是 `net`、`nature` 是 `work` 的場景，場景以合拍結束之後場熱 +10；沒有人回答 `director.cast` 時這一格重擲；擲到「返場」重擲。
- 文化：把機率固定在 0.5 用這一夜的、0.9 用別的夜的；層主永遠是這一夜的。
- 近道成功少一場遭遇；失敗扣一成保證金。條文簽了之後打賞少兩成、票根 +5。
- 化妝室：感載與餘韻清掉、場熱 +5；沒有贊助人時沒有包場的選項。
- 結算：包廂、場熱 65、主打：獎金 3,000 ＋ 打賞 3,000 × 0.35 × 1.2、保證金退回、`clears` +1。全員拔線退一半保證金。
- 加演：場熱到過 90 才列；進了第 5 幕敵人的等級高一級。
- 倒下的人沉溺沒有加。`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-curtain-entry、M4-scene-net（內海的場景）、M4-scene-circles（合演可以是同行的人：兩個人以上）。

## 完成時回報

改了哪些檔、測試結果、動到 `netrun` 的地方（預期：沒有；需要它加東西的列出來，不自己改）、給 M5 的接口（開播時要改哪幾個數字：場熱每場 +2、打賞加倍、返場）。
