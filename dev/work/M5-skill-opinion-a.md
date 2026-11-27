# M5-skill-opinion-a

- 交給：cpp-feature（sonnet）
- 目標：主播（聚光燈）與偶像（應援）兩棵樹的輿論欄、日常與預備：逐條寫成測試用的資料，在真的輿論戰裡各打一次確認效果，寫不出來的列出來。和 M3-skill-net-a／b 同一個做法。
- 規格出處：SKILL_TREES「主播：聚光燈」「偶像：應援」兩節（每一階的表的「輿論」欄、共鳴、「預備與日常」）與「補充規則」第 1、4、6 條；OPINION 4.3b 節、第 7 節；MEDIA 9.3、9.5 節；dev/adr/0020 第五、七、八節、V42；dev/work/M5-opinion-desk.md（封閉清單）、M5-abilities-opinion.md（欄的格式）。
- 可以改的路徑：`engine/tests/fixtures/skills/streamer.ts`、`idol.ts`、`index.ts`（測試用的技能資料）、`engine/tests/features/M5-skill-opinion-a.test.ts`；`engine/src/features/abilities/` 只在「格式少一個鍵」時改，而且要在回報裡列出加了什麼。
- 可以用的介面：M5-abilities-opinion 的欄格式；真的 `opinion`（測試可以裝它）與它的三張封閉清單；`meterOf`（`popularity`、`credibility`）；testkit。
- 不可以做的事：不改 `features/opinion`（清單少鍵就回報，不自己加）；不把資料寫進 `engine/data`（技能的正式資料等匯入）；不改現實與內海欄；技能的數字照 SKILL_TREES，不自己調；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **主播**（27 個技能加 5 個共鳴）：有輿論欄的逐條寫。對照表（設計書的寫法 → 清單的鍵）先列在測試檔開頭的註解裡，例：
   - 曝光「聲量 +3」→ `voice 3`；我查查看「風向 +1，並抽 1 張牌」→ `wind 1`、`draw 1`；現場連線 → `link_voice 5`（`else`：表演對 13，成功 5、失敗 2）、每場 1。
   - 剪接手（2026-11-25 改名之前叫剪剪貼貼）→ 被動 `fuel_first 1`；留一手 → 反應 `on: foe.mute` 與 `foe.takedown`、`negate`、`wind 1`、每場 1；主持、帶節奏 → 姿態（`line_first`、`foe_release`）。
   - 獨家 → `card_mod { kind: 'fuel', mult: 2, cap: 4, scope: 'next' }`；追擊 → `capture_extra { n: 1, def: -2 }`、每回合 1；頭條、號外、全網聯播（`ep` 的 `scope: 'war'` 與 `free_adjacency`）、定調、還不能下播（`on: foe.capture_last`、`negate`、`wind 2`）。
   - 爆料王 → `ep_cap 1`；老粉都在、流量密碼、今天也第一名 → `open_voice`、`fuel_first2`、`open_hand`。
   - 聚光燈本身：`forged_ok`（能把假料放進牌庫）。共鳴 1、3、4、5 → `open_hand`、`def_first_empty`、`draw_extra`、`cred_line_at`。
2. **偶像**（27 個技能加 5 個共鳴）：表態（`wind 2`，並用 `mark` 加反應 `on: foe.counter` → `out` 人氣 −1）、聲援（聲量 +2；人氣 40 以上 +3：`need` 或兩筆帶條件的效果，照清單做得到的寫法）、動員（`guard` 兩格加 `roll` d20 1～2 → `out` 敵對值 +1）、聽我唱、大家都在喔、一句話（`wind_first`；表態掉的人氣減半）、召集（人氣 40 以上：`need`）、公演（三格裡是你的都設防）、我來擋！（反應 `on: foe.capture`、`negate`、`wind 1`、從沒用完的編輯點扣）、巨蛋（人氣 60：`take` 三格、`foe_def_zero`）、C 位是我的、畢業公演、為你而唱、傳說、大家不要走（`on: cell.lost`、`retake`）。共鳴 2、4 → `def_cell`（應援圈、一次）、`open_hand`。
3. **日常與預備**：開台囉～（`daily.stat`：`live_goal_extra: 1`、`live_record_quality: 1`）、假料工坊（`forge_bonus: 2`、`forge_quality: 1`、`forge_risk: -3`）、握握手與唱出來（這兩個是別的功能的入口：資料寫 `daily: { kind: 'handshake' }`、`daily: { kind: 'sing' }`，實際的效果由 M5-idol 與介面接；這一張只確認 M4 的條件 `ability { daily: 'handshake' }`、`{ daily: 'sing' }` 對裝著的人成立、沒裝的不成立）。
4. **每一條都在真的戰役裡用一次**：開一場測試用的輿論戰（固定種子、固定的對手），用那一招或讓那個被動生效，斷言聲量、風向、格子、手牌、編輯點的變化和 SKILL_TREES 寫的一樣。
5. **寫不出來的**：照「差什麼鍵、差什麼觸發點、差什麼掛點」分三類列在回報。先猜得到的幾條：表態「這一場之後對手每用一次反爆料人氣 −1」（跨到戰役之後）、一句話「表態害你掉的人氣減半」、聲援照人氣分兩段、還不能下播與大家不要走的時機。寫不出來的那一條資料標 `pending` 並在 `desc` 留原文。

## 驗收條件（`engine/tests/features/M5-skill-opinion-a.test.ts`）

- 兩棵樹每一個有輿論欄的技能各有一個測試（做得出來的）：數字對 SKILL_TREES。
- 編輯點：聚光燈、應援的樹階 1～5 是 3、3、4、4、5；加爆料王（或傳說）上限 +1。
- 「每棵樹只有一個終極動禁止項」：全網聯播是主播這棵樹唯一讓每回合編輯點 +1 的；資料的檢查抓得到第二個（放一個壞例子）。
- 人氣門檻：人氣 39 用不了召集（原因的句子對）、40 可以；巨蛋要 60。
- 日常：裝著開台囉～時 `live_goal_extra` 是 1；裝著假料工坊時三個數字對。
- 全部測試資料過 `opinion.check`；`pending` 的條數和回報裡列的一樣。
- M3 的 `M3-skill-net-b` 測試（同一批資料的內海欄）原樣全過；`npm test`、`npx tsc --noEmit` 全過。

## 依賴

M5-abilities-opinion、M5-opinion-desk。人氣要 `popularity` 這張量表（M5-idol 定義；這一張的測試用 `testMeter` 的替身）。

## M4 對帳（2026-11-26）

- **技能的名字以 SKILL_TREES 現在的為準**：2026-11-25 改過一批（對照表 dev/reviews/2026-11-25-skill-names.md）。這兩棵樹改的是：剪剪貼貼 → 剪接手、插播一下喔 → 插播、反彈反彈 → 倒打一耙、聽我唱～ → 聽我唱；開台囉～沒有改。引擎的技能 id 沒有動，測試資料的 `name` 已經是新的。
- 橋「聚光」的「編輯點 +1」是義體的被動效果 `{ stat: 'ep_bonus', amount: 1 }`，不是技能：和「爆料王」的 `ep_cap` 是兩回事，測試「編輯點的上限」時不要把它算進去。
- 人氣的量表 `popularity` 還是 M5-idol 定義；M4 沒有碰。

## 完成時回報

每棵樹：做了幾條、近似幾條（近似在哪）、寫不出來幾條（照三類）；`features/abilities` 加了哪些鍵；要 opinion 那一邊加的鍵與觸發點（給 M5 的審查或修正批）。

## abilities-opinion 留下的（2026-11-27）
- fixtures/skills 裡的技能沒有任何輿論欄（全是 null），這一張要從零寫。
- opinion 這邊缺的介面（寫到才補）：效果 `stance { id }` 與 `War.stances`（切換姿態的招；姿態類被動照它篩）；`OpReact` 的 `need`／`out`（反應花錢或人情）；`OpMove.limit` 放寬成可同時有 `per_turn` 與 `per_war`。
