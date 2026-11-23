# M2-commission-gen

- 交給：cpp-feature（sonnet）
- 目標：照類型的模板生成一件具體的委託（副本加簡報加未知清單），回答中間人「今天有哪些委託」。AI 不參與：這是 `commission_gen` 的退路（模板生成）。
- 規格出處：COMMISSIONS 第 7 節（類型表）、7.1 節（每種類型的階段怎麼排、中型與大型多的階段）、7.2 節、第 9 節（生成的組成與詞條）、2.3 節「每個副本要寫的欄位」；FIXER 第 2 節「未知清單」那張表、第 3 節；ENEMIES 第 13 節（一場遭遇的位階組合照等級）；SITES 12.3 節（模板適合哪些類型）；AI_TASKS 3.17 節（第 1、3 步）；dev/adr/0016 第五節。
- 可以改的路徑：`engine/src/features/fixer/`（新增 `gen.ts`）、`engine/tests/features/M2-commission-gen.test.ts`。
- 可以用的介面：`k.hooks.on('fixer.offers')`、`k.content`（`special_map` 的 `fits` 與 `district_weight`、`district`、`faction`、`fixer`）、`k.activity`（查哪些面有人登記玩法）、`deriveRng`、`meterOf`（`rep`、`hostility`）。
- 不可以做的事：不寫任何一種類型的內容（模板是資料，測試自己帶）；不接 AI；生成的結果要通過 `commission` 這個內容種類的檢查（那個功能沒裝時跳過檢查）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `commission_type`：`{ id, name, main, decisive: 目標的寫法, stages: [{ name, faces: [...] }]（小型的三個階段）, extra: [{ name, faces }]（中型與大型插進去的階段）, branches: { stealth?: 基本功, talk?: 基本功 }, brief: 一句帶空格的話, gives: { [面]: [連動的 id] } }`。
- 內容種類 `commission_modifier`（詞條）：`{ id, name, text, effect: { lock_face?: { stage, face }, attached?: [{ enemy, count }], foes_plus?, alert_start?, stage? } }`。
- 內容種類 `commission_link`（常見的連動，COMMISSIONS 第 5 節那張表的機制部分）：`{ id, name, from: 面, to: 面, type, effect }`。
- 規則 `commission_rule` 的另一部分：每一級的報酬範圍、每個信譽階給哪幾種規模、每一級每個階段的遭遇組合（一般的階段與最後一個階段各一組）。

## 要做的

1. `generate(k, state, { fixer, seed })`：
   - 類型：中間人給的那幾種裡，**每個階段都有一個有人登記玩法的面**的才抽（M2 等於主面是現實的）。
   - 等級照主角的 `rep_grade`（±1，不超出 1～5）；規模照信譽階；目標勢力從中間人那一區的勢力裡抽。
   - 階段照模板；中型在第二階段前面插一個（2a）、大型在第二階段前後各插一個（2a、2b），照 COMMISSION_TEMPLATES 的階段表；至少一個階段可選兩個以上的面。
   - 現實面：地圖從 `fits` 含這個類型的模板裡照區的權重抽；分支一定有強攻，模板寫了潛行、交涉的各加一條（`need.basic` 的級數是等級 + 1，最多 5），另加一條要連動的與一條要踩點的；入口從那張圖的 `E` 裡分；遭遇照規則表的組合。
   - 連動 2～4 個，從 `commission_link` 裡挑接得上的（前面的階段給、後面的階段用）。
   - 詞條 1～2 個；帶 `attached` 的詞條寫進那一段遭遇的敵人上（開戰時由 `enemy_pick` 的 `attached` 接）。
   - 未知清單 4～8 項，每一項都指到副本裡真的東西：某個階段可選的面、那條踩點開出來的路、某一段的守備、詞條；「目標」「雇主」類先只給旗標。
   - 報酬在那一級的範圍裡；簡報把模板的空格填上勢力與地點的名字。
2. 同一個 `seed` 生成的結果一模一樣。亂數是 `deriveRng(state.rng, 'commission_gen/<seed>')`。
3. `fixer.offers`：每個中間人每天三件，`seed` 是「中間人加日子加第幾件」。有人註冊 `enemy_pick` 的檢查函式時，挑不到敵人的組合重抽（最多三次，還是不行就少給一件）。
4. `genProblems(k)`：載入之後查模板（最後一個階段只有主面、每個階段至少一個面、`decisive` 寫得出目標）。

## 驗收條件（測試自帶兩種類型、兩張地圖、一個中間人、三個連動、兩個詞條）

- 同一個 `seed` 兩次的結果整筆相等；不同 `seed` 不一樣。
- 生成一百件：每一件都通過 `commission` 的格式檢查；最後一個階段只有主面；每個面都有強攻；至少一個階段有兩個面；等級在 `rep_grade` ±1。
- 只有現實面登記時，主面是內海的類型不會出現；把內海登記成替身之後會出現。
- 中型四個階段、大型五個。
- 連動的 `need.link` 分支要的那個連動，前面一定有某個階段的某個面給它。
- 帶獵犬詞條的那一件，遭遇的 `UnitRef` 上有 `attached`。
- 未知清單每一項的 `reveal` 都指得到副本裡的東西；「路」類的那一項對到的分支是 `scouted` 的那一條。
- `fixer.offers` 同一天一樣、隔天不一樣；信譽升一階之後出現高一級的委託。
- 把生成的一件交給 M2-commission-run 走完三個階段（串起來的一條）。

## 依賴

M2-fixer-pay 之後（同一個資料夾）；最後一條驗收要 M2-commission-run、M2-enemy-encounter。

## 完成時回報

改了哪些檔、測試結果、COMMISSIONS 第 7、9 節裡沒做的（預期：十九種類型裡主面不是現實的、內海與輿論面的參數、同一件事從兩邊接、流竄 AI 發的委託、`commission_gen` 的 AI）。

- 2026-11-23 補（M2-fixer）：生成的委託寫 `commission.block`（中間人那一塊街區，go 會檢查）；回答 `fixer.offers` 掛點（同一天回答一樣的東西）。
