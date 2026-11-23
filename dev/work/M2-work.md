# M2-work

- 交給：cpp-feature（sonnet）
- 目標：新功能 `work`：打工。一份工作在一個設施上，一班 2、4、8 小時，擲一次、照公式拿錢與附帶的東西；做久了、和雇主熟了可以升階段，雇主會問一次。
- 規格出處：DOWNTIME 第 4 節（4.1 的表只看欄位、4.1a 階段、4.2 結算；4.1b 自己的店面與 4.3 派別人去不做）；EVENTS 3.1 節（`work`）、3.3 節打工那一列；AI_TASKS 3.13 節（只看程式的步驟）；LEWD_SYSTEM 第 9 節；UI 3.12 節；dev/adr/0016 第四節與 G15。
- 可以改的路徑：`engine/src/features/work/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-work.test.ts`。
- 可以用的介面：核心的檢定、`time`、`cred`、`cash` 變更、`k.effects.resolve`（附帶的效果）、`meterOf`（`affinity`、`fame`）、`k.conditions`、報告的 `triggers` 與 `launch`（內嵌的事件）、`activity.end`、`k.grid.usesOf`、`state.rules.contentOff`、`Game.commitNarrated`（測試用）。
- 不可以做的事：不寫任何一份工作的內容（十九份工作是資料）；成人階段的事件與場景是事件的資料，這裡只帶觸發點；契約人的收入歸屬（M4）；區域狀態的修正留一步是 1；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `job`：`{ id, name, facility: 設施的種類或某一間的 id, district?, employer?: npc, check?: { attr, skill, dc }（沒寫就是不擲）, wage, pay: 'cred' | 'cash', days?: { weekday?, time? }, perks?: 效果[]（每一班）, stages: [{ name, mult, perks?, need?: { shifts, affinity, extra?: 條件 }, adult?, tags? }] }`。階段兩個或三個；第一個階段沒有 `need`。
- 狀態 `state.ext.work`：每一份工作做了幾班、現在第幾階段、這一階問過了沒有、上一班的結果。
- 條件 `job_stage`（`{ job, min }`）。
- 報告：`work.shift`（kind `downtime`）、`work.promote`。

## 要做的

1. 一班：`shift(k, state, job, hours)`。能不能做（站在那個設施上、日子與時段對、錢不是問題）；時間照時數；擲一次（沒有 `check` 的當成功）；報酬 = 時數 × 時薪 × 階段的倍率 × 成功程度（1.5、1、0.5、0）；大失敗雇主親密度 −3；每一班的附帶效果（工作的加上這個階段的）經 `k.effects` 結算；班數 +1；帶觸發點 `work`（`where` 有設施、工作、階段）。
2. 階段：做滿班數、雇主的親密度到了、`extra` 成立，而且這一階還沒問過 → 這一班的報告帶 `launch` 一件內嵌的事件（升，或留在原本的階段）；選了升就進下一階段。階段的 `tags` 被玩家關掉、或 `adult` 的階段用到被關掉的題材時不問，這份工作就停在前一個階段。
3. `jobsHere(k, state)`：這個位置能做的工作、每一份現在第幾階段、下一階的條件與進度、預計的錢與成功率、現在不能做的原因。人站在對的設施上時 `usesOf` 列出「打工」。

## 驗收條件（測試自帶一份兩階段、一份三階段的假工作）

- 8 小時、時薪 10、第一階段、成功 → 80；大成功 120、失敗 40、大失敗 0 而且雇主親密度 −3。
- 第二階段倍率 1.5：同樣的一班是 120。
- 付的是工作寫的那一種錢；時間多了 8 小時；報告帶 `work` 觸發點。
- 每一班的附帶效果生效（這一區豔名 +1）。
- 第 5 班做完、雇主親密度 20：跳出升階的事件；選留下之後不再問；選升之後階段是 2。親密度不到不問。
- 三階段的工作第三階段的標籤被關掉：做滿 12 班也不問。
- 不在那個設施上、不是那一天的工作被擋並有原因。
- 有 `commission` 的替身活動進行時被擋。
- 同一個種子結果一樣。

## 依賴

M2-event-run（升階的事件）、M2-npcs（雇主的親密度；沒有時當 0）、M2-world（設施）。

## 完成時回報

改了哪些檔、測試結果、DOWNTIME 第 4 節裡沒做的清單。
