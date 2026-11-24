# M3-fixer-net

- 交給：cpp-feature（sonnet）
- 目標：`features/fixer` 的內海面：生成帶內海面的委託（主面是內海的類型、主面是現實而前面的階段可以選內海的類型）；出發時算追蹤度的起始值；踩點的成果用得到內海的階段。
- 規格出處：COMMISSIONS 第 7 節的表（★ 與 ◐ 的意思）、7.1 節（每種類型的階段怎麼排，內海的那幾型）、7.2 節、第 9 節；COMMISSION_TEMPLATES 開頭的「遭遇的寫法」與連動的表（只看格式，內容不匯入）；NETRUNNING 第 5 節（起始值）；FACTIONS 6.1 節（分段的名字）；FIXER 第 2 節（踩點）；dev/adr/0018 第九節最後一條與 N16；dev/work/M2-commission-gen.md、M2-fixer.md（現有的格式）。
- 可以改的路徑：`engine/src/features/fixer/`、`engine/tests/features/M3-fixer-net.test.ts`。
- 可以用的介面：現有的生成器（`gen.ts`）、`go`、`scout`、`board`；M3-commission-net 的格式（內海那一面的欄位、`LinkEffect` 的新鍵、進副本的 `trace_start`）；條件 `hostility_tier`（敵對值的功能登記的，沒有人登記當作沒有敵對）；`k.activity.get('face.net')`。
- 不可以做的事：不 import `features/commission`、`features/netrun`、`features/security`；不匯入模板（測試自帶兩種假的類型）；網內打撈與輿論面不生成；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 類型的模板（內容種類 `commission_type`，現有的）每個階段的面可以列 `net`；模板多選填的：`net: { facility?, objectives?: 決定性一步可以抽的目標種類[], airgap?: 機率, lace?: 'white' | 'pink' | 'black' }`。
- `fixer_rule` 多：`trace_start: { noted: 15, wanted: 30, scout_alarm: 15 }`（N16）、`net_layers`（幾個內海階段各用哪幾層：一個是 `core`，兩個是 `staff`、`core`，三個是 `guest`、`staff`、`core`，四個加 `control`）、`net_branch_skills`（內海的潛行分支看哪幾項基本功，預設 `interface`、`stealth`）。

## 要做的

1. **生成**：模板的階段列了 `net` 時，生成內海那一面——`layer` 照這件委託的內海階段數與順序（`net_layers`）；`encounter` 用和現實面同一套點數（一般 4 點、決定性的一步照首領戰的預算，蕾絲照位階算點）；分支至少一條強攻，再照模板加潛行（看 `net_branch_skills`）與連動開出來的路；`gives` 照模板。主面是內海時最後一個階段的 `objective` 從模板的清單照種子抽（沒寫是下載，`turns` 3）。照 `airgap` 的機率把決定性的那一面加 `locked_by`，並保證前面有一個只開現實的階段給那個連動（COMMISSIONS 第 4 節「必經的階段」）。
2. **沒有人登記 `face.net` 時**：不生成主面是內海的委託；主面是現實的照舊生成（內海的面列著，副本那一邊本來就會說「還沒有開放」）。
3. **出發**（`go`）：算 `trace_start` 給副本——目標勢力的敵對值到「記名」以上是 15、到「通緝」是 30（問條件 `hostility_tier`）；踩點驚動過目標是 15；取最高的。主面是現實、沒有任何內海階段的委託不用算。
4. **踩點**：揭開階段與分支的機制不變，內海的階段與分支照同一套揭開；`scoutView` 的「未知」清單把內海的階段照面標出來。
5. 簡報（`board` 的每一列）多 `main` 是內海時給畫面的一句話與「要有甲板」的提醒（看衍生數值 `deck_grade`，有人定義才看）。

## 驗收條件（`engine/tests/features/M3-fixer-net.test.ts`；測試自帶一個中間人、兩種假的類型（竊密：主面內海、三個階段；奪取：主面現實、前兩個階段可選內海）、兩個勢力與它們的蕾絲；`face.net` 用假活動登記）

- 竊密：生成的副本過得了副本的格式檢查（用副本功能的檢查函式驗，測試可以 import）；最後一個階段只有內海、有 `objective`；內海的階段 `layer` 是 `guest`、`staff`、`core` 裡照順序的幾個；每個內海的面有強攻。
- 同一個種子生成兩次一樣；二十個種子都合格。
- `airgap` 是 1 的模板：決定性的面有 `locked_by`，前面有一個只開現實的階段給那個連動。
- 沒有登記 `face.net`：桌上沒有主面是內海的委託。
- 出發：目標勢力的敵對值 25（記名）→ 副本的 `setup.trace_start` 是 15；100 → 30；踩點驚動過、沒有敵對 → 15；都沒有 → 0。
- 內海階段的遭遇點數不超過預算（對 `encounterPoints` 的算法）。
- 現有的中間人與生成的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-commission-net。做完才能開 M3-ui-commission-net。

## 完成時回報

改了哪些檔、測試結果、COMMISSIONS 7.1 節主面是內海的五型各自生成得出來到哪裡（預期：網內打撈不做、心智用「找人」近似）。
