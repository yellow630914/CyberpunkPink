# M3-commission-net

- 交給：cpp-feature（sonnet）
- 目標：`features/commission` 接上內海面：開 `face.net` 時給齊它要的東西、收它交回的結果；追蹤度整趟累計；連動多幾種效果（給內海階段的、內海給現實階段的控制區）；隔離區；內海路線的評價與後果；畫面要的追蹤度。
- 規格出處：COMMISSIONS 2.2、2.3 節（內海那幾列、壓力條的表）、第 3～5 節（連動的表）、6.4 節（輔助面失敗的壓力）、第 8 節（路線與後果的「有階段走了內海」）、第 11 節（樣本裡內海的面）；CYBERSPACE 8.1 節「把固定目標放進生成的地圖」前三條；NETRUNNING 第 4 節（控制節點是兩個面的接點）；dev/adr/0018 第七、九、十節與 N13、N14、N15、N34；dev/work/M2-commission-run.md、M2-commission-aux.md、M2-commission-close.md（現有的格式）。
- 可以改的路徑：`engine/src/features/commission/`、`engine/tests/features/M3-commission-net.test.ts`。
- 可以用的介面：現有的 `faceLaunch`、`effectsFor`、`planMeat`、`milestone`、`retreat`、`onDefeatAccepted`、`settleAux`、`settleDone`、`commissionView`；`activity.end`（`kind: 'face.net'`；`outcome` 是 `done`、`retreat`、`located`；`result: { trace, peak, rounds, loot, controls?, goal? }`）；探索認的 `ext.controlled`（`"<圖的 id>:<區塊>"`）。
- 不可以做的事：不 import `features/netrun`（測試用假的 `face.net` 活動當替身）；不寫子網的任何規則；現實面的行為與現有的測試不變；輿論面不碰；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 內海那一面的資料（`FaceDef`，面是 `net` 時檢查）：`layer`（`guest`、`staff`、`control`、`core`，必填）、`encounter?`（位階的組合）、`lace?`（`white`、`pink`、`black`）、`facility?`、`objective?`（`{ kind: 'download' | 'seize' | 'find' | 'defeat' | 'plant' | 'extract', turns? }`）、`controls?: string[]`（這一層的控制節點對到現實的哪幾個控制區）、`locked_by?`（連動的 id：隔離區）。
- `LinkEffect` 多：`trace_start`（−100～100）、`trace_half`、`lace_down`、`gate_open`、`near_core`（給內海的階段）；`controls?: true | string[]`（給現實的階段：這一段開地圖時把這幾個控制區，或全部，寫進 `ext.controlled`）。
- `face.net` 的 `setup` 多：`fx`（這個階段生效的連動效果：原本的 `half`、`minus`、`skip` 與上面五個）、`trace`、`decisive`、`where`（和 `stage` 觸發點同一份）。
- 進副本的 `setup` 多 `trace_start?`（−30～100；中間人算好了給）。
- `Run` 多：`trace`（整趟的追蹤度）、`net_peak`、`net_alerted`（到過 60 的那一次警戒加過了）。
- `commission_rule` 多：`net_alert`（10，N14）、`net_hostility_step`（20：做完時每 20 點追蹤度目標勢力的敵對值 +1，進位、最多 5；N34）、`net_watchers`（管網路的勢力 id，預設空的；有寫就各 +2）。

## 要做的

1. **開這一段**：`faceLaunch` 帶齊上面的鍵；`trace` 是 `Run.trace`（第一次是 `trace_start`）。沒有拿到 `locked_by` 那個連動時，這一面列著但選不了（「隔離區還沒有打開：要先在現實面插上資料埠。」）；最後一個階段只有這一面而且鎖著時，進副本不擋（前面的階段拿得到那個連動才合格：格式檢查要驗「`locked_by` 的連動有某個更早的階段會給」）。
2. **交回 `done`**：`Run.trace` 與 `net_peak` 記下來、這一段算做完（接里程碑照舊：時間、`gives`）。這件委託第一次有內海的階段到過 60：警戒 +`net_alert`，只加一次。
3. **交回 `retreat`**：和玩家按撤退完全一樣（同一份結算、同一個 `rewind`）。**交回 `located`**：和「戰敗被接受而且算失敗」一樣（留失敗的記號、回到進去之前；N15）。
4. **不算失敗的戰敗**（現有的 `continueChanges`）：內海的階段照樣回到選分支之前；`Run.trace` 維持這一段開始前的值。
5. **輔助面**：內海那一面失敗的 +10 加在 `Run.trace` 上（原本的 `aux.pressure.net` 改成讀寫它；舊存檔裡的值讀進來併過去）。
6. **內海給現實的連動**：`controls` 的效果在 `planMeat` 開地圖時寫進 `ext.controlled`（`true` 是那張圖全部的控制區）。內海階段的 `gives` 照舊在里程碑給；另外，面的資料寫了 `controls` 而 `face.net` 交回的 `result.controls` 是空的（沒有接管）時，這一面的 `gives` **不給**（那個連動是「接管了才有」的；沒寫 `controls` 的面不受影響）。
7. **評價與後果**：評價的「壓力條」那兩項對內海照同一個門檻看追蹤度（最後在 60 以上 −1、到過 90 再 −1）；路線的後果照 N34 加目標勢力與 `net_watchers` 的敵對值。
8. **畫面**：`commissionView` 多 `trace: { value, marks: [30, 60, 90], peak }`；內海面的輔助壓力顯示 `Run.trace`；每個面多 `locked`（隔離區的原因）。

## 驗收條件（`engine/tests/features/M3-commission-net.test.ts`；測試自帶一件四階段的假副本，照 COMMISSIONS 第 11 節的樣本：前兩階段現實與內海都可選、第三階段只有現實而且給 `airgap_open`、第四階段只有內海而且 `locked_by: 'airgap_open'`；`face.net` 用測試自己登記的假活動，交回什麼由測試決定）

- 選內海面、選分支：假活動收到的 `setup` 有 `layer`、`encounter`、`fx`、`trace`、`decisive`、`where`，`origin.ext` 有 `commission`、`stage`、`face: 'net'`。
- 拿到 `trace_start: -15` 與 `lace_down` 的連動之後，下一個內海階段的 `fx` 帶著它們；對現實階段不出現。
- 交回 `done`、`result.trace` 42：`Run.trace` 是 42、接了里程碑、時間 +120 分鐘、拿到 `gives`；下一個內海階段的 `setup.trace` 是 42。
- `result.peak` 65：警戒 +10；第二個內海階段再到 70，不再加。
- 交回 `retreat`：時間、錢、背包回到進去之前，委託還在手上；和直接呼叫撤退的結果逐欄相同。交回 `located`：委託失敗、回到進去之前，最後兩份報告是回到快照的那一份與 `commission.failed`。
- 第四階段在沒有 `airgap_open` 時內海面選不了、原因是那一句；第三階段做完之後選得了。`locked_by` 寫了一個沒有任何更早階段會給的連動：格式檢查擋下。
- 內海的面寫了 `controls: ['f1:b']` 與 `gives`：`result.controls` 有東西時里程碑給連動、下一個現實階段的地圖 `ext.controlled` 含 `f1:b`；`result.controls` 是空的時不給。
- 輔助面內海失敗：`Run.trace` +10。
- 做完時 `Run.trace` 45：目標勢力的敵對值多 3；評價在追蹤度最後 60 以上時少一級。
- `commissionView().trace` 的值與刻度對；現有的副本測試原樣全過（放行清單不變：`face.net.start` 與 `commit:netrun.` 是 netrun 自己加的，這裡不加）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netrun、M3-netrun-nodes（約定以 0018 第九節為準；測試不需要它們）。做完才能開 M3-fixer-net、M3-ui-commission-net。

## 完成時回報

改了哪些檔、測試結果、COMMISSIONS 第 5 節那張連動的表裡內海相關的每一列現在怎麼表達（逐列對一次，寫不出來的列出來）。
