# M4-night-resonance（cpp-feature，sonnet；第二十步甲欄，接在 M4-training 之後）

- 來源：M4-nightclass 回報（2026-11-25）。NIGHT_LESSONS 二十五個共鳴裡十七個寫不出來，夜課學習條件有幾種句型也寫不出來。
- 可以改：`features/scene`（night.ts、play.ts、model.ts、end.ts）、`features/nightclass`、對應測試。

## 要做的
1. 共鳴多三種鍵（在 `night.ts` 的格式與 `RESONANCE_RULES` 白名單）：
   - `per_round: [{ if, effect }]`：條件式的每回合效果。`if` 收 `bind_link`（有束縛連接）、`contract_partner`（有契約對象在場）、`init_extreme`（主動權 ≥80 或 ≤20）、`watched`（有人在看）、`style_match`（對方標籤與服裝風格一致）；`effect` 收 `fit`、`init`、`load`（自己或對方）。
   - `link_bonus: [{ part | extra_part, fit }]` 與 `keep_extra_links: true`：依連接部位（口、多出來的部位）加契合；切換體位時多出來部位的連接不重置。
   - `once: { kind, ... }`：每場或每回合一次的特殊動作（主動權設成 70／30、每回合第一次挑逗不花行動點、高潮不疊餘韻、脫換衣服不花行動點、契合拉到 50）。
   - `opening: { init?, fit?, if? }`：開場數值（`openingInit` 讀共鳴；扮相 1 階穿著符合傾向風格 +5）。
   - 感官 1 階「挑逗時對方感載 +1」、4 階「克制時自己感載另外少 1d3」改成精確寫法（`tease_flat`、`restrain_dice`）。
   - 身體 2 階（感載上限 +4）、扮相 4 階（曝露度加成）：用被動效果來源 `night`（`k.passives`）給，不走 scene 規則。
2. 學習條件：
   - 「性經歷裡的對象」類（三種以上不同身體、身體與外表性別不同）：`sex_record` 多記每個對象的 `body` 與 `look_gender`（M4-scene-close 寫紀錄時一起寫，這張先讀，沒有就當不成立）。
   - 「豔名在任一區 20 以上」：量表條件多 `key: 'any'`。
   - 「對方……」的條件（對方有義體、豐滿詞條、獸化、固定的伴）：不是學習條件，改成技能在場景裡的 `needs`；夜課資料照這個寫，NIGHT_LESSONS 對應的句子由文件代理改寫。
   - 「內海化身多出的觸手」「在內海用化身」：條件 `avatar` 讀化身的部位與所在層。
3. 「只掛軸」的技能：`tag` 是軸的 id 或 `common` 時當只掛軸（總指揮確認照 nightclass 的做法，但只認 id，不認中文名）。

## 驗收
- 二十五個共鳴每一個都有一筆測試資料、一條行為測試；寫不出來的列清單回報。
- engine tsc、npm test、test:smoke 全過；ui npm test、vue-tsc 全過。不 commit。

- 總指揮補記（2026-11-25，M4-scene-close 回報）：`features/npcs` 的 `buildActor` 補 `ext.body: n.body`，性經歷的 `looks[對象].body` 才讀得到（這張讀它）。
