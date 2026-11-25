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
