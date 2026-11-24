# M5-abilities-opinion

- 交給：cpp-feature（sonnet）
- 目標：`features/abilities` 的輿論面與日常：技能資料的 `opinion` 欄變成輿論戰裡的招、被動與反應（回答 `opinion.moves`、`opinion.passives`、`opinion.open`）；`daily` 欄變成別的功能讀的衍生數值；導流階「老粉都在」的定案。逐條的技能資料在後兩張（M5-skill-opinion-a／b）。
- 規格出處：SKILLS 1.5 節（種類）、1.8 節（禁止的三樣）、第 13 節（資料格式）；SKILL_TREES 的讀表方式與「補充規則」第 1、4、6 條；DATA 第 2 節（`opinion` 欄與日常的鍵）；OPINION 4.3、4.3b 節、第 7 節；MEDIA 第 2 節、第 3 節（假料工坊動到的數字）、1.2 節（開台囉～動到的東西）；dev/adr/0020 第五、七節、第十三節（`OpMove`、`OpPassive`、`OpOpen`、衍生數值的表）；dev/work/M5-opinion-desk.md（三張封閉清單，以它的回報為準）、M3-abilities-net.md（內海欄當初怎麼加的，照同一個做法）。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M5-abilities-opinion.test.ts`。
- 可以用的介面：掛點 `opinion.moves`、`opinion.passives`、`opinion.open`、`opinion.check`（opinion 宣告的；直接 `k.hooks.on`／`k.hooks.run`，不 import）；`k.stats.addStatProvider`（對 `footage_quality`、`footage_cap`、`cut_pick`、`forge_bonus`、`forge_quality`、`forge_risk`、`live_goal_extra`、`live_record_quality`、`episode_bonus`、`flow_tier`；每一個先問 `hasStat`）；`meterOf`（`popularity`、`credibility`、`subs`）；現有的技能格式、裝備與容量、`use` 照戰場分的寫法（`use.opinion`）。
- 不可以做的事：不 import 別的功能；不寫棋盤的規則（效果由 opinion 解譯，這裡只翻譯格式）；不逐條寫技能（後兩張）；現實與內海欄的行為不變；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `opinion` 欄（原本只收「物件或 null」）現在的形狀：
  - 主動：`{ effects: OpEffect[], need?: 條件 }`；花費與次數寫在 `use.opinion`：`{ edit: n, per_turn?: n, per_war?: n, cash?: n, favor?: 'small' | 'mid' }`（`per_fight` 在輿論欄讀成每場）。
  - 被動、共鳴：`{ mods: Array<{ kind, amount, … }> }`。
  - 反應：`{ on: 觸發點, effects: OpEffect[] }`，花費照 `use.opinion`（`edit` 是從沒用完的編輯點扣）。
  - 姿態：`{ mods: […] }`，加 `stance: true`（開著才算；編輯台上換姿態不花編輯點、每回合一次：做成一個花 0 點、每回合一次的招，效果是切換）。
  - 預備（帶進下一場）：`{ open: { voice?, wind?, cells?, hand?, foe_pr_first?, cards? } }`。
- `daily` 欄（原本只收物件）的鍵：`stat: Record<衍生數值 id, 加值>`（例：`{ footage_quality: 1 }`）加 `tier_min?`（樹階到了才算）。其餘的鍵（`income`、`roster`……DATA 第 2 節列的）照舊只收格式。
- 內容的檢查（`ready`）：每個技能的 `opinion` 欄經 `opinion.check` 驗（沒有人回答就不驗）；`use.opinion` 的鍵；`daily.stat` 的 id 要是上面那十個裡的。

## 要做的

1. **`opinion.moves`**：坐在編輯台的每個人，他裝著的（主角）或路數樹階以內的（夥伴，0016 G4）技能裡種類是主動、而且 `opinion` 欄不是 `null` 的，各回一筆 `OpMove`（`id` 是技能的 id、`actor`、`cost` 是 `use.opinion.edit`、`limit`、`need`、`effects`）。`pending` 的不回。花錢或花人情的（掮客）把花費翻成 `need` 與一筆 `out` 的效果（由 opinion 在結算時套），做法照 M5-opinion-desk 回報的清單。
2. **`opinion.passives`**：被動、共鳴、反應、開著的姿態各回一筆 `OpPassive`。招牌（聚光燈、應援、入戲、人面）本身不回編輯點（那是 opinion 照路數算的），只回它另外寫的東西（例：聚光燈的 `forged_ok`）。
3. **`opinion.open`**：預備類技能帶進這一場的東西（預備的機制照舊：花時段或不花、帶進下一場；用過就沒了）。
4. **日常**：技能裝著（主角）或樹階以內（夥伴，只算隊伍裡的人）時，`daily.stat` 的每一項對那個人的衍生數值加值。聚光燈的兩條日常寫成資料：`{ stat: { footage_quality: 1, footage_cap: 樹階（最多 2） } }` 與樹階 3 以上的 `cut_pick: 1`（V5）。
5. **「老粉都在」**：`flow_tier` 的 +1 只在這個人的 `flow_tier` 基礎值大於 0（有頻道而且訂閱一千以上）時才加（決定清單第 20 項；SKILL_TREES 聚光燈「沒有頻道是 0」）。現在的寫法如果是無條件 +1，改掉並補一個測試。
6. 輿論欄的強弱：技能樹的 `domains.opinion` 是 `none` 的樹（槍手、機師、改造師、潛網者），資料寫了 `opinion` 欄也不回（並在檢查時提醒）。

## 驗收條件（`engine/tests/features/M5-abilities-opinion.test.ts`；測試自帶六個假的技能（主動、被動、反應、姿態、預備、日常各一）、替身回答 `opinion.check`、一個問掛點的小函式（不裝 opinion））

- 主動的那一個：問 `opinion.moves` 得到一筆，`cost`、`limit`、`effects` 和資料一樣；沒裝著的不回；`pending` 的不回；夥伴照路數與樹階回。
- 被動與反應各得到一筆 `OpPassive`；姿態沒開不回、開了才回；切換姿態的那一招花 0 點、每回合一次。
- 預備：用了之後問 `opinion.open` 有一筆，再問一次（下一場）沒有。
- `opinion.check` 的替身回一條問題：內容載入時整批擋下並寫出是哪個技能；沒有人回答 `opinion.check` 時照樣載入。
- 日常：裝著聚光燈的人 `footage_quality` 是 1、樹階 2 的 `footage_cap` 是 2、樹階 3 的 `cut_pick` 是 1；衍生數值沒有人定義時不丟錯。
- 「老粉都在」：`flow_tier` 的基礎是 0 時裝著它還是 0；基礎是 1 時是 2。
- `domains.opinion` 是 `none` 的樹不回任何東西。
- 現有的 abilities 測試（現實與內海）原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-opinion-desk（掛點與封閉清單）、M5-live-slot 與 M5-channel-shows（日常要加值的衍生數值由它們定義；沒有也跑得起來）。做的時候不要有別的工單在改 `features/abilities`。

## 完成時回報

改了哪些檔、測試結果、`opinion` 欄的格式有沒有和 opinion 那一邊對不上的鍵、既有的技能測試資料（`engine/tests/fixtures/skills/`）裡已經寫了 `opinion` 欄的有幾條、能不能直接用。
