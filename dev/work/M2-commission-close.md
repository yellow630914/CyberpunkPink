# M2-commission-close

- 交給：cpp-feature（sonnet）
- 目標：副本做完與做不完的結算：評價、路線留下的後果、歷練點；戰敗被接受之後照戰敗事件的旗標決定委託失敗並回到進去之前，或留在這個階段的開頭繼續。
- 規格出處：COMMISSIONS 2.3 節開頭的表（規模與歷練點）、第 8 節全部；COMBAT_SYSTEM 8.4、8.5 節；SERIES 第 6 節（回退時留下什麼）；ENEMIES 第 6 節最後幾條（不算委託失敗的預設）；FACTIONS 6.2 節「以它為目標的委託，用了現實面」那一列；CORE_RULES 7.1 節；dev/adr/0016 第一、二節。
- 可以改的路徑：`engine/src/features/commission/`、`engine/tests/features/M2-commission-close.test.ts`。
- 可以用的介面：`k.hooks.on('activity.end' | 'rewind.keep')`、`k.effects.resolve`（`hostility`、歷練點的效果）、`meterOf`、報告的 `rewind`。
- 不可以做的事：報酬、付法、分帳、街頭信譽不在這裡（M2-fixer 聽 `activity.end` 自己算；這裡只把評價與 `terms` 交出去）；不 import `features/defeat`；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `activity.end`（`kind: 'commission'`）的 `outcome`：`done`、`failed`；`result`：`{ commission, kind, grade, scale, route, links, alert, rating, xp, terms }`。
- 評價 `rating`：`S`、`A`、`B`、`C`（規則的預設：從 B 起算；每個潛行或交涉成功的階段 +1、拿到三個以上連動 +1、警戒最後在 60 以上 −1、到過 100 再 −1；夾在四級之內）。
- 路線的後果：有階段走了現實 → 目標勢力的敵對值 +5，每個強攻的階段再 +3，最多 +15；全部走潛行或交涉成功 → 不加。
- 狀態多：`failed`（這件委託失敗了）。失敗在回到入口之後要留著，其餘的都回去。

## 要做的

1. `finish` 的那一份：算評價、套路線的後果、給歷練點（小 20、中 35、大 60，不看評價；乘存檔規則的歷練倍率），再發 `activity.end`。
2. 聽 `activity.end`（`kind: 'defeat'`、`outcome: 'accept'`，而且那一場的 `origin` 是這件委託）：
   - `result.fails_commission` 是 true（副本寫了 `defeat_event` 而且它自己有寫的話照副本的）：回傳狀態改成失敗的變更與 `rewind`（`entry`）。回去之後委託的活動結束、`outcome: 'failed'` 的 `activity.end` 在回去之後的那一份報告裡發（`rewind.keep` 把「失敗」與要發的結果帶過去）。
   - 是 false：不回退；人留在這個階段，地圖關掉、回到選分支之前（這個階段的遭遇重新放），委託繼續。
3. 回到入口時留下的：紀錄（核心做）、失敗的記號；性經歷與記憶由各自的功能留。拿到的東西、錢、時間、警戒、連動都回去。
4. 投降和打輸走同一條。
5. `commissionView` 多：預估的評價與現在的路線會留下什麼。

## 驗收條件

- 三個階段都強攻做完：評價 B、目標勢力敵對值 +5 + 9 夾到 15；都潛行成功：評價升兩級、敵對值不加。
- 歷練點：小型 20；歷練倍率 2 時是 40；評價不影響。
- `activity.end` 的 `result` 帶著進來時的 `terms`，原樣不動。
- 測試自己發一個接受戰敗的 `activity.end`（`fails_commission: true`）：狀態回到進去之前（時間、錢、背包），委託不再進行，接著收到 `outcome: 'failed'`；這段紀錄還在並標成被收回。
- `fails_commission: false`：不回退；還在同一個階段、要重新選分支；警戒與拿到的連動留著。
- 副本寫了自訂的 `defeat_event` 而且寫明不算失敗：照副本的。
- 失敗之後再問 `commissionView` 是空的；存檔往返不變。
- 串起來的一條（M2-defeat 做完之後補）：在副本裡真的打輸 → 戰敗事件 → 接受 → 失敗並回到入口。

## 依賴

M2-commission-aux 之後（同一個資料夾）。最後一條驗收要 M2-defeat；兩張同時在做時先用測試自己發的 `activity.end`。

## 完成時回報

改了哪些檔、測試結果、COMMISSIONS 第 8 節裡沒做的（預期：附帶條件、走內海與輿論的後果、戰利品與素材的額外所得、餘波的旗標）。
