# M2-event-run

- 交給：cpp-feature（sonnet）
- 目標：事件視窗的執行器：活動 `event`。一件事件（資料裡的，或別的功能當場給的）開起來、列出選項、擲檢定、照成功程度結算效果、多段的走到下一段、做完交回給發起的人。
- 規格出處：EVENTS 2.1、2.3、2.4 節（選項、檢定、誰擲、效果是封閉清單）、3.6 節（事件視窗）、3.7 節「自由回應」那一列、第 5 節（只能連一層）、第 6 節；DATA 第 4 節（`adult_scene` 的物件）、第 5 節（戰敗事件多的欄位：`versions`、`stages`、`inherit`、`fallback`）；dev/adr/0016 第四節。
- 可以改的路徑：`engine/src/features/director/`、`engine/tests/features/M2-event-run.test.ts`。
- 可以用的介面：`k.activity.define`／`start`、`activity.end` 的共用函式、`k.effects.resolve`（`source: 'builtin'`）、`k.conditions`、核心的檢定（`makeCheck`、DC 的階梯）、`deriveRng`、`k.hooks`。
- 不可以做的事：效果一律經 `k.effects`，不自己改狀態；不收陣列寫法的效果（0016 第四節）；不寫任何一件事件的內容；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `event` 的內文：`text`、`cast: [{ role, npc? | known? | gen? }]`、`options: [{ id?, text, need?: 條件, show_locked?, check?: [基本功, 屬性?, 難度], outcomes: { critical?, success?, fail?, fumble?, any? }, adult_scene?, flags?: string[], ends? }]`；多段的寫 `stages: [{ text, options } | { inherit }]`；分版本的寫 `versions: { default, masc?, yuri? }`，每個版本自己的 `text` 與 `stages`；`fallback`（用到的標籤被關掉時改走哪一件）。
- 結果裡的每一筆是效果 `{ kind, ... }`，或指示：`{ kind: 'fight', foes, cover?, faction? }`、`{ kind: 'chain', event }`。效果裡的 `'$a'`、`'$b'`、`'$pc'` 換成登場角色的 id。
- 掛點 `director.cast`（這個功能宣告）：`[{ state, event, role, spec }, { actor: string; changes?: Change[] } | void]`。
- 狀態 `state.ext.director.open`（開著的那一件：事件或內嵌的整筆、版本、第幾段、登場角色、發起的人）。
- 報告：`event.open`、`event.choose`、`event.close`（kind 都是 `event`）。`activity.end` 的 `result`：`{ event, option, degree, flags, stage }`。

## 要做的

1. 登記活動 `event`（`order` 30；放行 `commit:event.`、`chain:free_action`）。`start` 收 `{ event }` 或 `{ inline }`，加上選填的 `version`；同時只開一件，已經開著時丟 `ActionBlocked`。內嵌的事件照同一套格式檢查。
2. `eventView(k, state)`：正文、每個選項（看不看得到、選不了的原因、檢定的基本功與 DC、誰擲、成功率）。`need` 不成立的選項不列；寫了 `show_locked` 的列出來並給原因。
3. `chooseOption(k, state, id)`：誰擲照範圍的 `roller`（`best` 是隊上那一項最好的人，另一位有同一項 2 級以上協力 +2）；DC 照難度的階梯加範圍的 `dc_plus`；四級結果缺的往旁邊找（大成功用成功的、大失敗用失敗的）；沒有檢定的用 `any`。效果用事件所在那一區的等級結算。
4. 還有下一段就留在視窗裡換段；最後一段（或選項寫了 `ends`）就收尾：發 `activity.end`、清掉 `open`、把指示變成報告上的 `launch`（`fight` 開戰鬥；`adult_scene` 在成功程度對得上 `when`、而且有人登記 `scene` 時開場景，`setup` 照 DATA 第 4 節的鍵原樣帶；`chain` 開另一件，被帶出來的那一件不能再帶）。
5. 登場角色：開的時候對每個 `cast` 問 `director.cast`；沒有人答的角色用一個只有名字的臨時角色。
6. 自由回應：事件開著時玩家可以直接做自由行動；那一份自由行動的報告套用之後，這件事件以 `option: 'free'` 收尾。
7. 把內文的格式檢查掛進 M2-director 留的位置：效果的種類要有人註冊、指示只能是那兩種、`inherit` 指得到、版本至少有 `default`。

## 驗收條件

- 兩個選項、一個帶檢定：固定骰面下四種成功程度各走到對的那一組效果，錢與量表真的變了；報告的時間軸有那一次擲骰。
- `need` 不成立的選項不在清單裡；`show_locked` 的在、帶原因、選了被擋下。
- 事件開著時走地圖、休息這類別的報告被擋下，句子是事件視窗給的；選完之後不擋。
- 三段的事件走完三段才結束；第二段的選項寫 `ends` 就提早結束。
- `inherit` 的那一段選項和被繼承的一樣；`version: 'masc'` 走那一版的文字。
- 內嵌的事件：別的功能（測試裡的替身）用 `launch` 開一件、做完收到 `activity.end`，`origin` 原樣回來，`result.option` 是選的那一個。
- `fight`：收尾之後戰鬥開起來，`origin.ext.by` 是 `director`。`chain`：帶出第二件；第二件再寫 `chain` 在載入時被擋。
- `adult_scene`：沒有人登記 `scene` 時不開、不丟錯；用替身登記之後，`when: 'success'` 只在成功時開，`setup` 帶著性質、身分、目的與登場角色。
- 自由回應：事件開著時做一次自由行動，之後事件收掉、`result.option` 是 `free`。
- 同一個種子結果一樣；開著事件存檔再讀，選項與結果不變。

## 依賴

M2-director、M2-core-activity。做完才能開 M2-security、M2-defeat、M2-work，以及 M2-enemy-encounter 的俘虜。

## 完成時回報

改了哪些檔、測試結果、DATA 第 4、5 節的欄位裡沒有收的（預期：`adult_soft`、事件開頭由 AI 改寫的那一步、`deadline`）。

- 2026-11-23 補（M2-enemy-encounter 回報）：俘虜的處置是一件內嵌事件 `{ id, scope, text, cast, options }`，選項的 `check: [skill, attr, dc]` 的 DC 是**數字**（問話 10＋等級×2），事件執行器要收數字 DC；收不了的話整場打贏的戰鬥會回滾。驗收要拿 `features/enemies/capture.ts` 的真實事件跑一次。
