# M2-commission-run

- 交給：cpp-feature（sonnet）
- 目標：新功能 `commission`：委託副本本體，一種活動。拿到一件具體的副本就能進去：每個階段選面、選分支、玩那一段（M2 只有現實面：探索加遭遇）、拿里程碑與連動；警戒整趟累計；階段之間喘口氣；撤退回到進去之前。
- 規格出處：COMMISSIONS 第 2 節（2.1、2.3 全部）、第 3、4、5 節、6.2 節、第 11 節（資料的樣子）；SERIES 第 6 節；SITES 12.5 節開頭（DC 基準與警戒的門檻）；UI 7.4 節（玩家看到什麼）；dev/adr/0016 第一、二、五、六節與 G2、G9、G12。
- 可以改的路徑：`engine/src/features/commission/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-commission-run.test.ts`。
- 可以用的介面：`k.activity.define`／`allow`、`activity.end`、`snapshot.take`、報告的 `rewind`／`triggers`、核心的 `map.open`（帶 `ext`）與 `map.close`、`meterOf`／`meter`（`alert`）、來源 `enemy_pick`、`rest.done`、核心的檢定、`k.content`（`special_map`、`faction`）、`k.hooks.on('report.after' | 'rewind.keep')`。
- 不可以做的事：不 import `features/explore`、`features/enemies`（只經由地圖實例的 `ext` 與 `UnitRef`）；錢、信譽、接案與踩點不在這裡（M2-fixer）；輔助面的擲骰（M2-commission-aux）與做完之後的結算（M2-commission-close）先留接口；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `commission`（一件具體的副本，照 COMMISSIONS 第 11 節）：`kind`、`main`、`scale`、`grade`、`target_faction`、`district`、`conditions?`、`defeat_event?`、`stages: [{ name?, faces: { meat?: {...}, net?: {...}, opinion?: {...} } }]`、`links: { [id]: { type: 'skip' | 'ease' | 'open', name, effect } }`、`modifiers?`。現實面那一格：`map`、`sheet?`、`branches: [{ id, kind: 'assault' | 'stealth' | 'talk' | 'linked' | 'scouted', entry: 入口的標記, need? }]`、`encounter: [位階…]`、`post?`（放在哪個保全崗）、`goal?`、`gives?`。
- `need`：`{ basic, level }`（基本功到幾級才看得到，選了擲 DC 基準）、`{ link }`、`{ scouted }`、`{ cash }`。`goal`：`{ kind: 'fight' }`（預設：打贏這一段的遭遇）、`{ kind: 'reach' | 'take', at }`、`{ kind: 'check', at, basic }`、`{ kind: 'scene', with, goal }`；`take` 還要走到撤離點。
- 連動的 `effect`：`{ stage?, encounter_half?, foes_minus?, skip_explore?, alert_frozen?, alert_start? }`（開路的那一種不用寫效果，靠分支的 `need.link`）。
- 活動 `commission`（`order` 90）。`setup`：`{ def: id 或整筆, scouted?: { stages: number[], branches: string[], guards: number[] }, alert_start?, aux?, terms? }`；`terms` 原樣帶到結束。
- 狀態 `state.ext.commission`：副本整筆、第幾階段、走到哪一步、選的面與分支、拿到的連動、走過的路線、警戒、喘過氣沒有、地圖的實例。
- 報告：`commission.enter`、`.face`、`.branch`、`.milestone`、`.breathe`、`.retreat`、`.finish`。

## 要做的

1. 進去：第一筆變更是 `snapshot.take`（`entry`，`owner` 是這件委託）；之後放行清單以外的事都被擋（清單寫在驗收條件裡）。
2. 每個階段：`face`（第一筆是 `snapshot.take` 的 `stage`、`replace`；帶觸發點 `stage`，`where` 有類型、面、目標勢力、詞條）→ `branch` → 玩這一段 → `milestone`（時間 +120 分鐘，G2）。最後一個階段只有主面。**面的玩法**：現實面內建在這個功能裡；別的面看有沒有人登記活動 `face.net`、`face.opinion`（M3、M5；選了就 `launch` 它、等它的 `activity.end`）。沒有登記的面列出來但選不了（「這一面還沒有開放。」）；一個可選的面都沒有的副本在 `start` 就擋下。
3. 分支：每個面一定有強攻；`need` 不成立的列出來並給原因，沒踩到的 `scouted` 分支不列；潛行與交涉選了之後擲一次（DC 基準 = 10 ＋ 等級 × 2，檢定帶 `infiltrate` 標籤），過了這一段是潛行的（地圖的 `ext.stealth`），沒過警戒 +10、照強攻走。
4. 現實面的一段：照分支的入口開地圖；遭遇的每個位階變成一筆 `enemy_pick`（勢力是目標勢力、等級是副本的等級；`seed` 用委託、階段與第幾個）放在 `post`；`ext.origin` 帶 `by`、`commission`、`stage`、`face`、`defeat_event`；`ext.reinforce` 是兩個雜兵；這個階段的守備沒有踩到（`setup.scouted.guards` 沒有這一段）時 `ext.edge` 是 `foe`（G7）。連動的效果在這裡套（少一半、少幾個、直接站到遭遇點、警戒不漲）。
5. 里程碑：`report.after` 看這一段的目標達成了沒有（遭遇打贏了、標記用過了、人在撤離點、場景的目的達成），達成就接一份 `milestone`：給這一面的 `gives`、把這張地圖的警戒收回狀態、關地圖。警戒到 100：最後一個階段的遭遇等級 +1（G9）。
6. 喘口氣：兩個階段之間可以做一次，發 `rest.done`（`stage`），不花時間。
7. 撤退：一份帶 `rewind`（`entry`）的報告；戰鬥中不能撤退。
8. 做完最後一個階段：`finish` 發 `activity.end`（`kind: 'commission'`、`outcome: 'done'`，`result` 帶路線、連動、警戒、規模、等級與 `terms`），清掉狀態與入口、階段的快照。
9. 對外：`commissionView(k, state)`（階段軌、每個面開不開與原因、每條分支與原因、拿到的連動、警戒、能不能喘口氣）。

## 驗收條件（測試自帶一件三階段的假副本、DATA 9.3 的小辦公室、三個假兵種）

- 進去之後交易、休息、接別的委託這類報告（用替身的 `trade.`、`rest.`、`fixer.` 前綴）被擋下並有原因；放行的只有：`commit:commission.`、`grid.`、`commit:grid.`、`battle.`、`commit:battle.`、`chain:battle_end`、`battle.retry`、`event.start`、`commit:event.`、`scene.start`、`commit:scene.`、`commit:defeat.`、`commit:capture.`、`commit:gear.`、`chain:free_action`、`rewind:stage`、`rewind:entry`。
- 三個階段走完：每個階段時間 +120 分鐘；路線記下每個階段的面與分支；`finish` 之後不再擋。
- 只有現實面登記時，內海的面列著但選不了、原因是那一句。
- 強攻永遠在；`need.basic` 不夠的分支有原因；`need.link` 在拿到那個連動之後才選得了。
- 潛行檢定過了：地圖的 `ext.stealth` 是 true；沒過警戒 +10。
- 遭遇的敵人是目標勢力的、位階對；守備沒踩到的階段地圖的 `ext.edge` 是 `foe`，踩到的沒有；拿到「少一半」的連動之後下一段的敵人是一半（無條件進位）。
- 打贏遭遇之後自動有里程碑、拿到 `gives`；`take` 的目標要拿了東西再走到撤離點才算。
- 警戒跨階段累計；到 100 時最後階段的敵人高一級。
- 每個階段開始有一份 `stage` 快照而且只有最新的一份；在第二階段打輸選「回到這個階段開始時」，回到第二階段剛選面之前、委託還在進行。
- 撤退：時間、錢、背包、警戒都回到進去之前，紀錄留著並標成被收回，委託的活動結束。
- 喘口氣每兩個階段之間只能一次；`rest.done` 的處理函式（測試裡掛一個）被叫到。
- 打到一半存檔再讀，接著走完的結果和沒有中斷的一樣。

## 依賴

M2-core-activity、M2-core-shell、M2-explore、M2-enemy-encounter（`enemy_pick`）、M2-event-run（副本內的事件）。同一個資料夾的三張排成一串。

## 完成時回報

改了哪些檔、測試結果、COMMISSIONS 第 2～5 節裡沒做的（預期：附帶條件的檢查、輿論戰的開場表、直播目標、隔離區）。

- 2026-11-23 補：戰鬥的 `origin.ext` 加 `employer`（委託人的勢力 id），俘虜「交出去」的好感要它。

- 2026-11-23 補（M2-explore）：進副本地圖時，`enterMap` 之後呼叫 explore 的 `arrive(k, state)`，有回傳報告就一起提交（入口就被保全看到時開打或潛行警戒 +5）。
