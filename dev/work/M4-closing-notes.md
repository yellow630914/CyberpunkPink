# M4 收尾修正批要接的（總指揮彙整，2026-11-25 起）

- （M4-ui-contract）contract 的 `OrderView` 加 `closed`、`outcome`（了結的逾期那一條與處置），`contract.overdue` 報告帶指令編號；ui 拿掉用正文比對種類的做法。
- （M4-ui-contract）`boundView` 給「走過去（設目的地）」與「提出談判」的入口；契約人的其他脫身路（LEWD 第 7 節，九條只做了還清）。
- （M4-ui-contract）確認引擎在登入與長休醒來時真的發 `login`、`rest` 觸發點（冒煙走一遍）。
- （M4-ui-contract）`loadout_facility_types: ['tuning_clinic']` 與調校診所設施對齊。
- （M4-ui-curtain）核心 `BattleUnit` 加「現在鎖定誰」，ui 的 `BattleBoard.lockOf` 改讀它（名牌跟著鎖定的目標換形象）。
- （M4-ui-curtain）curtain 從 index 匯出 `tabLine`，或 `memberView` 帶 tab、gig、tapes；ui 拿掉深路徑 import。
- （M4-ui-curtain）示意局的補演對象要有街上人物的生成規則（npcs 的 `castGen`）；示意局的邀請函與信譽來源（內容）。
- （M4-auction-bid）`once` 的拍品被 NPC 買走也記進 `sold`（世界上只有一件）；拍賣進行中的放行只列 `auction.bid`、`auction.leave`、`auction.close`；`ReportOutcome` 的拍賣欄位改成正式型別（不用轉型）。
- （M4-followups-2）斷線靜修改成進行中的活動，期間關橋、禁止潛入（等使用者同意）。
- （M4-craft-teach）條件登錄表給條件一個說明句欄位，擋住的原因能寫成自然的句子（例：牆語者要你在回聲的好感 20 以上）。
- （M4-core-part-ai）trade 的 `productSellBase` 走 `fittedPrice`（帶二手零件的成品照實際狀態算）；cyberware 的 `modify.ts` 小手術換零件同步 `part_states`（`setPartState`）。
- （M4-ui-followups）引擎匯出：`statName`／`MOD_NAMES`（ui 拿掉 bodyView、craftView 的對照表）；gear 的 `coveredSlots`；features/index 匯出 `NO_BRIDGE_NOTE`、`NO_BRIDGE_ABILITY`；`ChoiceOption` 加 `input`（ui 拿掉 `onceInput` 拆字串）；`dyeDraft` 收 SKIN（ui 拿掉 `where: 'net'` 分支與 `data/items.ts`）；`cyber_pump` 圖示改 `pump`。
- （M4-ui-followups）`ui/tests/craft/M4-ui-craft.test.ts` 的「三種做的地方」：data-rules 加了帶 craft 的設施種類後要對齊（改成看示意包的設施，或改期望）。
- 美術：示意包 11 件義體設計圖沒有自己的圖示（現在用部位圖）。
- （M4-data-rules）乘區的物價倍率：medical 診所治療、sink 心理治療、drugs 戒斷療程（設計書寫了要乘），功能加規則欄位並乘上。
- （M4-data-rules）勢力好感門檻：`therapy.favor`（素體教 20）、`detox.favor`（蜜糖會 30）、`unreg_desk.faction`（同人眾）——testkit 的 `dataRules` 要能濾掉引用不到的勢力，資料才放得進去。
- （M4-data-rules）scene 的 `PARTNER_GEAR_DOWN_AT`、`SINK_CAP` 改讀規則；示意包與各功能測試自帶的規則表改用 engine/data 的正式版。
- （使用者 2026-11-26 同意）斷線靜修改成進行中的活動（像打工）：期間關橋、禁止潛入，結束才結算；sink 的 therapy 與活動登錄表。
