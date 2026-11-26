# M5-fixer-opinion

- 交給：cpp-feature（sonnet）
- 目標：`features/fixer` 的輿論面：生成帶輿論面的委託（主面是輿論的四型、主面是別的而前面的階段可以選輿論的類型），連同它的 `opinion_setup`、對手的強度、三個結果的連動；踩點與任務板的輿論提示；召集時替輿論面排人。
- 規格出處：COMMISSIONS 第 7 節的表（★、◐、○ 的意思）、7.1 節（輿論的那幾型）、7.2 節、第 9 節（輿論面：議題模板 × 對手的公關強度）；COMMISSION_TEMPLATES「opinion_setup 的骨架」（對手的強度、開場、短戰的 `rounds`、`op_major`／`op_minor`／`op_lost`；只看格式，內容不匯入）；OPINION 3.2、5.1 節；DATA 6.3 節（對手沒有指定強度時怎麼定）、9.1 節；FIXER 第 2 節（踩點）；dev/adr/0020 第六節；dev/work/M3-fixer-net.md（內海面當初怎麼加的，照同一個做法）、M5-commission-opinion.md（副本那一邊的格式）。
- 可以改的路徑：`engine/src/features/fixer/`、`engine/tests/features/M5-fixer-opinion.test.ts`。
- 可以用的介面：現有的生成器（`gen.ts`）、`board`、`scout`、`hire`；M5-commission-opinion 的格式（`opinion_setup`、輿論面的欄位、三個保留的連動鍵、`stream_goals`）；`k.activity.get('face.opinion')`；`k.content`（`topic_kind`、`pr_opponent` 有人定義才讀：`k.content.hasKind`）。
- 不可以做的事：不 import `features/commission`、`features/opinion`；不匯入模板（測試自帶兩種假的類型）；不生成具名的議題與對手的內容（只組骨架）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 類型的模板（內容種類 `commission_type`，現有的）每個階段的面可以列 `opinion`；模板多選填的 `opinion: { topic_kind: 'ignite' | 'smear' | 'douse' | 'whitewash' | 'frame', scores?: 分數列的 id, from_links?: Array<{ link, add_card?, voice?, wind?, cells?, opponent_pr_first_round? }>, base?: { voice?, wind?, cells? }, results?: { major?: LinkDef, minor?: LinkDef, lost?: LinkDef } }`。
- 生成出來的副本多：`opinion_setup`（`topic`：id 照委託的 id 組、`kind`、`rounds`、`scores`、`involves` 填這件委託的目標勢力與目標的人；`opponent`：見下；`base`；`from_links`）、`links` 裡的 `op_major`、`op_minor`、`op_lost`（模板有寫才放）、每個輿論階段的 `faces.opinion`（分支、`rounds`、`gives`）。
- `fixer_rule` 多（另放一組 `DEFAULT_FIXER_OPINION_RULES`，資料檔由 M5-data-rules 補）：對手強度照等級的表（I～II 是 1、III～IV 是 2、V 是 3）、大型 +1、短戰 −1、上下限 1～3；沒有 `topic_kind` 這種內容時用的四列預設分數（OPINION 3.2 的表）。

## 要做的

1. **哪些類型生得出來**：沒有人登記 `face.opinion` 時，主面是輿論的類型不列（和內海面沒登記時同一個做法），別的類型的輿論選項拿掉（那個階段只剩其餘的面；只剩零個面時那個類型這一次不生）。登記了：照模板。
2. **議題**：`kind` 照模板；分數照模板指定的那一列，沒指定就照類型的預設（爆料與抹黑用大眾議題、造勢用偶像或小眾，寫在規則表）；`involves.factions` 是目標勢力（守方的議題是委託人的勢力：讀 M4 寫進去的 `commission.employer`，沒有委託人時退回目標勢力並在回報列出），`involves.types` 照類型（爆料：罪證、醜聞；抹黑：醜聞、親密；滅火與洗白：醜聞）。最後一個階段 `rounds: 6`，前面的 `rounds: 4`。
3. **對手**：有 `pr_opponent` 這種內容而且找得到 `faction` 是目標勢力的那一筆就用它的 id，沒有就寫 `{ id: 'pr_generic', strength }`（opinion 那一邊有通用的公關）。強度照規則：等級的表、大型委託 +1、非決定性的短戰 −1、夾在 1～3。
4. **分支**：輿論面一定有 `assault`（正面打）；模板可以另外寫 `talk`（例：先放風聲，要交涉）與 `linked`（要前面的連動）。不生成 `stealth`。
5. **踩點**：揭開後面的階段時，輿論階段多揭開「對手是誰、強度多少、議題哪幾格值錢」（任務板與踩點結果的句子）；踩點的成果可以是輿論面的 `scouted` 分支。
6. **召集**：輔助面的輿論照舊（`AUX_FACES` 本來就有）；任務板的簡報對主面是輿論的委託寫「這是一件要打輿論戰的委託。」（現有的句子），並提示「可以帶素材或片進去」。
7. **直播目標**：模板有 `stream_goals` 的候選時照種子挑一到三個寫進副本（`stream_goal` 這種內容沒有人定義時不寫）。
8. 生成的副本要過 M5-commission-opinion 的資料檢查（在測試裡把生成的結果丟給它的 `commissionProblems`：這是內容的檢查函式，經由 `k.content.validate('commission', …)` 呼叫，不 import）。

## 驗收條件（`engine/tests/features/M5-fixer-opinion.test.ts`；測試自帶兩種類型：三階段主面是輿論的「爆料」、三階段主面是現實而第一階段可以選輿論的「暗殺」；玩具活動登記成 `face.opinion`）

- 沒登記 `face.opinion`：爆料不出現在可以生的類型裡；暗殺的第一階段沒有輿論面。登記之後兩個都有。
- 爆料生出來的副本：最後一個階段只有輿論面、`rounds` 是 6；`opinion_setup.topic.involves.factions` 是目標勢力；分數是指定的那一列；`links` 有模板寫的 `op_major`。
- 暗殺生出來的副本：第一階段的輿論面 `rounds` 是 4、`gives` 是模板寫的連動。
- 對手的強度：等級 I、III、V 是 1、2、3；大型 +1 夾在 3；短戰 −1 夾在 1；有對得上勢力的 `pr_opponent` 時用它的 id。
- 同一個種子生兩次結果相同；二十個不同的種子生出來的都過 `commission` 的資料檢查。
- 踩點揭開輿論階段時結果的句子有對手與強度。
- M2、M3 的 fixer 測試全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-commission-opinion。做的時候不要有別的工單在改 `features/fixer`。

## M4 對帳（2026-11-26）

- **委託人**：M4-core-part-ai 之後，生成的委託會寫 `commission.employer`（`gen.ts` 的 `pickEmployer`；類型可以寫 `employers`）。它用自己的一顆亂數（`commission_gen/<標籤>/employer`），不動別的抽籤。這一張新增的抽籤（議題的分數列、對手、直播目標）照同一個做法各用自己的用途字串，既有的種子重播才不會變。
- **報酬的附加項**（掛點 `fixer.reward`）不受影響：主面是輿論的委託照樣問一次。要讓報酬多一段素材是內容回答同一個掛點的事，這一張不做。
- `fixer_rule` 的資料檔現在有 M3、M4 兩批的欄位（`engine/data/rules/fixer_rules.json`）：新的 `DEFAULT_FIXER_OPINION_RULES` 另放一組，資料由 M5-data-rules 補。

## 完成時回報

改了哪些檔、測試結果、主面是輿論的四型（抹黑、爆料、滅火、造勢／洗白）各自寫不寫得出來（寫不出來的差什麼）、「同一件事兩邊都有人接」這一條現在的格式夠不夠。
