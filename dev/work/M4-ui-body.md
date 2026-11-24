# M4-ui-body

- 交給：cpp-ui（sonnet）
- 目標：角色對話框的「橋與義體」分頁、診所對話框接上引擎：部位圖與每一槽、手術（四種人動刀）、拆下、修理、授權鎖、沉溺的下限與分段、藥與成癮、治療、調校與靜室。舊的 `lib/clinic.ts` 拿掉。
- 規格出處：docs/art/UI.md 第 8 節（角色：義體分頁、沉溺與橋參數的呈現）與診所那一節、1.1 節規則 1 與「做不到的一律灰掉」；CYBERWARE 第 1、2、5 節；DOWNTIME 第 3 節；dev/adr/0019 第二、三、五、六、七節；各引擎工單的「匯出」。
- 可以改的路徑：`ui/src/dialogs/character/BridgeTab.vue`、`ui/src/dialogs/ClinicDialog.vue`、`ui/src/dialogs/CharacterDialog.vue`（只有接線）、`ui/src/components/BodyFigure.vue`、`ui/src/lib/`（新增 `bodyView.ts`；刪 `clinic.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉假的義體與沉溺狀態）、`ui/src/data/demo/`（新增 `body.ts`）、`ui/tests/body/`。
- 可以用的介面：`@engine/src/features/cyberware` 的 `cyberView`、`surgeons`、`installQuote`、`installDraft`、`removeDraft`、`swapBridgeDraft`、`bridgeCapacityOf`、`lockView`、`payLockDraft`、`crackDraft`、`repairDraft`、`modifyDraft`；`features/medical` 的 `medicalView`、`aidDraft`、`clinicQuote`、`clinicHealDraft`、`woundSurgeryDraft`；`features/drugs` 的 `drugView`、`useDraft`、`detoxDraft`、`suppressantDraft`；`features/sink` 的 `sinkView`、`therapyDraft`；`features/tuning` 的 `bridgeView`、`installDraft`、`removeDraft`、`quietDraft`；`features/malware` 的 `malwareView`、`cleanDraft`；`k.passives.parts`（一個數字的組成）；`Game.commit`。M4-tuning、M4-malware 排在這一張後面：它們還沒做完時對應的區塊顯示空的說明，測試只驗已經有的功能，等它們做完由 M4-ui-contract 補上那兩塊。
- 不可以做的事：不改 `engine/`；費用、成本、休養、機率、擋住的原因全部讀引擎，不在元件裡算；不從說明文字抓數字；介面的示意數字（手術費一成）拿掉；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 義體分頁：人形圖上十一個部位，點部位列出它的每一槽（空槽是虛線框、休養中與鎖住的標出來）；每一件點開看組成（設計圖、每個零件）、成本、效果的清單（引擎的被動效果照來源分組）、狀態。右邊是沉溺：現在的值、下限與它的組成（哪一件義體墊了多少、抑制劑、暫時的）、落在哪一段與這一段的得失、別人看到的值。
2. 橋：型號（設計圖的名字）、四類容量與組成、機能的清單、四項橋參數（基本值、有效值、每個來源）；沒有橋的人顯示引擎給的那一組說明。
3. 診所對話框（站在帶 `clinic` 的設施上才開得了；自己動刀的入口在住處）：分頁「安裝／拆下／換零件／修理與解鎖／治療／戒斷／清除韌體」。每一項先顯示引擎的報價（費用、成本、休養、併發症的機率、自己動刀的 DC 與成功率），確認才送；擋住的原因逐字用引擎的。
4. 藥：背包裡的藥可以「使用」（戰鬥外）；角色頁列出生效中的（剩多久）、每一種的成癮值與是不是依賴、戒斷中的與懲罰；抑制劑的開關與反彈的倒數。
5. 治療：急救（選誰來做、對誰）、診所治療、重創的清單與手術。
6. 調校：兩個槽、裝不穩的標示、鎖在誰手上；靜室。惡意韌體：看得到的每一筆與清除的路。
7. 示意世界包（`ui/src/data/demo/body.ts`）：兩座橋（蜂巢通用型與一座偏科的）、六七件義體（義眼、義臂、皮下裝甲、反射加速器、藥泵、一對生體獸耳、一件光紋刺青）與它們的零件、兩筆併發症與兩筆殘響、四種藥與抑制劑、三種診所的設施、兩種調校、一種惡意韌體；數字照設計書的例子填合理的。開局的主角改成「橋與甲板已經裝在身上」（M4-cyber-deck 的回報）。
8. `stores/game.ts` 裡假的義體、沉溺、藥的狀態與 `lib/clinic.ts` 的引用拿掉。

## 驗收條件（`ui/tests/body/M4-ui-body.test.ts`；用引擎真的功能，資料用測試自帶的）

- 部位圖每一槽等於引擎的 `cyberView`；裝一件之後畫面的成本、下限、沉溺和引擎的狀態一致；休養中的那一件有標示而且它的效果不在清單裡。
- 診所：報價的每個數字等於 `installQuote`；黑診所的機率、自己動刀的成功率有顯示；錢不夠時按鈕灰掉、原因和引擎逐字相同；不在診所開不了對話框。
- 橋：四類容量等於引擎的衍生數值；換橋的報價是兩倍。
- 藥：吃一劑之後列表多一筆、時間到了消失；成癮到依賴有標示。
- 沉溺：分段的名字與得失來自引擎；下限的組成加起來等於 `sink_floor`。
- 示意包開新局：主角有橋、甲板在腦部、進得了內海。
- 掃原始碼：`ui/src` 沒有 `lib/clinic`、沒有 `price * 0.1` 這一類的手術費算式。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-cyberware～M4-cyber-lock、M4-medical、M4-drugs、M4-sink。

## 完成時回報

改了哪些檔、測試結果、缺的圖示、UI 第 8 節因為引擎還沒有而沒顯示的東西（預期：生體件的成熟度、套裝加成、殘響的故事）。
