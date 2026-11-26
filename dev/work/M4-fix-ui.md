# M4-fix-ui（cpp-ui，sonnet；M4 收尾修正批・介面；接在 M4-fix-engine 之後）

- 只改 ui/。依據：dev/reviews/2026-11-26-M4-ui.md（必修 1、應修 10、建議 8）、dev/work/M4-closing-notes.md 裡介面的每一條、M4-fix-engine 新增的匯出。

## 使用者裁決（2026-11-26，都照建議）
1. 建角可以買的清單與出身建議組合改讀引擎（M4-fix-engine 搬了）。
2. 示意捷徑（領邀請函、契約人／持約人開局等）一律做成開新局的選項，加一個「示意模式」開關，關著時都不出現。
3. 寫法指令超過 200 字不在瀏覽器硬擋：字數變紅照樣送出，由引擎截斷並顯示它的提醒；上限讀引擎常數。
4. 痛覺編輯器的模糊讀引擎的旗標。
5. 建角外觀的推導改讀引擎。
6. 夜課以 UI.md 第 10 節為準（文件已改 8.4 節）。

## 要做的
- 必修 1、應修 1～10 全做；建議做得到就做。
- closing-notes 裡介面的每一條（拍賣自動跟價「自動跟到 C$___」、拿掉自算的 onceInput／partPaused／天數、PART_TYPE_NAMES、statName／MOD_NAMES 對照表、coveredSlots、SKIN 染色、鎖定目標的名牌、帳與母帶改讀 tabLine 等）。
- 拍賣測試的逾時。

## 驗收
- ui npm test、vue-tsc、npm run build 全過；不 commit，不留背景工作。

## M4-fix-engine 新增的匯出與行為改變（2026-11-26，接手回報）
- **斷線靜修變成活動 `retreat`**：`therapyDraft`（kind retreat）只是開始；畫面加「待下去」與「提早離開」：`retreatView`、`retreatOf`、`retreatStayBlock`／`retreatStayDraft`、`retreatLeaveBlock`／`retreatLeaveDraft`（features/sink），報告 `sink.retreat`（stay、last_day、left、done），時間到自動結算。
- **契約**：`OrderView` 多 `closed`、`outcome{result,text}`、`goto{district,block,facility,name,here}`（走過去）；`contract.overdue` 第一拍 data 是 `{order, kind, penalty}`，不要比對正文；談判入口在 `boundView.payoff`（can_talk、talk_price、talk_dc、talk_chance）。
- **簾後館**：`curtainTabLine`（取代深路徑 `fall.tabLine`）、`accountView`、報告 `curtain.encore_void`、`encoreStale`；場熱量表用匯出名 `CURTAIN_HEAT`（值是 `stage_heat`）。
- **拍賣**：`auctionSummary`、`auctionOutcome`；`bidDraft({ auto: { max } })`、`bidOptions().auto`（「自動跟到 C$___」）；進行中只放行 bid、leave、close，其餘按鈕灰掉並寫 `blockOf` 的原因。
- **未登錄零件**：`pendingView`（days_left、waiting、block）、`REQUEST_MAX`、`Game.unregPaused()`；`partTypeName` 從 `@engine/src`。
- **名字與核心**：`statName`、`modName`、`MOD_NAMES`、`STAT_NAMES`（拿掉 bodyView、craftView 的對照表）；`BattleUnit.lock` 與 `lockedTarget`（名牌跟著鎖定目標換形象）；`k.conditions.explain`；`areaPriceMult`。
- **身體與建角**：`hp_blur`（`HP_BLUR_STAT`、`cyberView.hp_blur`，不再認 pain_editor）；`creationCatalog`、`suggestedKit`、`creationLook`、`lookTexts`、`GEAR_GROUPS`、`DEFAULT_*_LINE(S)`；origin 的 `suggested`；`NO_BRIDGE_NOTE`、`NO_BRIDGE_ABILITY` 從 features/index。
- **gear**：`coveredSlots`；`dyeDraft`／`dyeBlock`／`dyeOf` 的 uid 可以是 SKIN id（拿掉 `where:'net'` 分支與 `data/items.ts`）。
- **場景**：`ChoiceOption.input` 直接送。
