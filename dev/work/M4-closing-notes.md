# M4 收尾修正批要接的（總指揮彙整，2026-11-25 起）

- （M4-ui-contract）contract 的 `OrderView` 加 `closed`、`outcome`（了結的逾期那一條與處置），`contract.overdue` 報告帶指令編號；ui 拿掉用正文比對種類的做法。
- （M4-ui-contract）`boundView` 給「走過去（設目的地）」與「提出談判」的入口；契約人的其他脫身路（LEWD 第 7 節，九條只做了還清）。
- （M4-ui-contract）確認引擎在登入與長休醒來時真的發 `login`、`rest` 觸發點（冒煙走一遍）。
- （M4-ui-contract）`loadout_facility_types: ['tuning_clinic']` 與調校診所設施對齊。
