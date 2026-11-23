# M2-defeat

- 交給：cpp-feature（sonnet）
- 目標：把戰敗從略過版補成完整的流程：選哪一件戰敗事件、哪個版本；照存檔規則演或不演；事件本身交給事件視窗跑（多段、選項、檢定、可能接成人場景）；最後才是三選一；接受之後把結果交回給發起那一場的人。
- 規格出處：COMBAT_SYSTEM 8.3、8.4、8.5 節；ENEMIES 第 6 節（表後面的每一條：篩選的分支、版本怎麼抽、機器贏了、不算委託失敗的預設）；DATA 第 5 節；AI_TASKS 3.14 節（只看流程，AI 的兩段正文不接）；UI 4.1 節；dev/adr/0014（三選一由核心擋）、0016 第一、四節與 G5。
- 可以改的路徑：`engine/src/features/defeat/`、`engine/tests/features/M2-defeat.test.ts`。
- 可以用的介面：報告的 `launch`（開一件內嵌的事件）、`activity.end`（聽事件的、發自己的）、`k.activity.allow('defeat', …)`、`defeat.options` 掛點（已經有）、`pickVersion`、`resolveFiltered`、`state.rules`（`defeatView`、`defeatTakeGear`、`defeatMoneyLoss`、`defeatMoneyCap`、`contentOff`）、`battle.origin`。
- 不可以做的事：不替任何一種 `kind` 寫專屬的程式（G5）；不 import `features/director`、`features/commission`；委託失敗之後的回退不在這裡做（這裡只把 `fails_commission` 交出去）；`tests/features/M1-defeat*.test.ts` 與保釋的測試原樣全過；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `defeat_event` 的內文改成事件的格式（`versions` 裡每一版是 `text` 加 `stages`，寫法同 M2-event-run）；表頭照舊（`kind`、`factions`、`fails_commission`、`default`、`tags`、`fallback`、`adult`），多 `angel?: true`（天使急救的那一件）。舊的寫法（每一版只有 `text` 與 `effects`）照樣收，當成只有一段、一個選項。
- 選項的 `flags` 裡 `no_fail`、`fail` 可以蓋掉這一次算不算委託失敗。
- 等待中的戰敗（`state.ext.defeat`）多：`stage: 'ask' | 'playing' | 'played'`、事件做完的結果、算不算失敗。
- `activity.end`（`kind: 'defeat'`）：`outcome` 是 `accept`；`result` 是 `{ battle, event, kind, fails_commission, option }`；`origin` 是那一場戰鬥的 `origin.ext`。
- 報告：`defeat.pending`（已經有）、`defeat.view`、`defeat.skip`、`defeat.accept`、`defeat.option`（已經有）。

## 要做的

1. **選哪一件**，照順序：主角有天使急救的資格（旗標 `angel_member`）而且有 `angel` 的事件；那一場的 `origin.ext.defeat_event`；打贏的那一方裡個別敵人寫的；那個勢力的預設（機器贏了用它所屬的勢力，沒有就用場地的 `origin.faction`）；通用的那一件。用到被關掉的標籤時沿著 `fallback` 找，找不到就用通用的。版本照現在的抽法。
2. **演不演**：`always` 直接開；`skippable` 先問；`never` 不演。別的功能經 `defeat.options` 多給了選項（被贖回）時，不論哪一檔都先問（照常，或選那個選項）。
3. **演**：把選到的那一版組成一件內嵌的事件，用 `launch` 開（`origin.by` 是 `defeat`）。開之前先照存檔規則改寫：扣現金的效果不超過「身上現金 × 比例」與金額上限；`defeatTakeGear` 關著時拿走身上裝備與義體的效果拿掉。事件做完（`activity.end`）記下選了什麼與算不算失敗。
4. **不演**：每一段走第一個選項、有檢定的照擲，效果同樣改寫之後一次結算，列成幾行結果（列在回報裡：這個走法是暫定的）。
5. **三選一**：事件做完或跳過之後才出現；重來與回到階段照舊（事件造成的改變跟著快照回去）。接受＝一份帶 `snapshot.drop` 的 `defeat.accept`，組這一份時發 `activity.end`（`kind: 'defeat'`），把回傳的變更、`launch`、`rewind` 併進去。
6. 同行的人寫進結果的一行（他們跟著主角一起被處置）。投降走同一條。
7. `k.activity.allow('defeat', …)`：`event.start`、`commit:event.`、`scene.start`、`commit:scene.`、`chain:free_action`、`commit:defeat.`。
8. `defeatView(k, state)`：現在在哪一步、哪一件事件與版本、能做的選擇與原因、接受的話會怎樣（委託失敗或繼續、錢與裝備照現在的設定最多被拿多少）。

## 驗收條件

- 選事件的五個順位各一條；被關掉的標籤走 `fallback`；男性主角走 `masc`。
- `always`：打輸之後事件視窗自己開起來，這時候三選一還不能選「接受」（重來可以）；選完事件的選項之後才可以。
- `skippable`：先問；選不看就照「不演」結算。`never`：不開事件，只有結果。
- 兩段的戰敗事件：兩段都選完才算做完；第二段的檢定失敗時那一組效果真的套了。
- 事件寫扣現金 5,000、身上 1,000、比例 0.5、金額上限 300 → 只扣 300。`defeatTakeGear` 關著：拿走裝備的那一筆沒有發生，其餘照常。
- 事件的選項帶 `adult_scene`：用替身登記 `scene` 之後場景開得起來，場景結束才回到三選一。
- 接受：收到 `activity.end`（`kind: 'defeat'`），`result.fails_commission` 照事件的；選項寫了 `no_fail` 時是 false。處理函式回傳的 `rewind` 出現在 `defeat.accept` 上。
- 演完事件之後選「重來這場戰鬥」：事件扣的錢回來了，那幾份報告標成被收回。
- 有被贖回的選項時先問；選了被贖回就不演事件、照那個選項結算。
- 舊格式的 `df_generic` 照樣走得完；M1 的戰敗測試原樣全過。

## 依賴

M2-event-run、M2-core-activity。M2-commission-close 的最後一條驗收等這一張。

## 完成時回報

改了哪些檔、測試結果、ENEMIES 第 6 節與 COMBAT_SYSTEM 8.3 節裡沒做的（預期：版本的比例設定、`handed_over` 轉到雇主的事件、AI 的前後半段正文）。

- 2026-11-23 補：事件 chain 帶出的第二件 origin.by 是 director，不回到原發起的人；戰敗事件要「chain 之後回到戰敗」時讀 result 或另開 launch。
