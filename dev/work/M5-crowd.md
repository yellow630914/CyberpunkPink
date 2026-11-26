# M5-crowd

- 交給：cpp-feature（sonnet）
- 目標：**群眾**——偶像的「召集」與主播的「圍觀」在內海戰鬥裡的場地效果（M3 留到 M5 的那一項），連同這兩棵樹的內海欄裡 M3 因為「沒有頻道、沒有人氣」而只能用假數字測的那幾條，換成真的來源再對一次。
- 規格出處：CYBERSPACE 第 5 節（主播、偶像那兩列）、6.9 節的表（「群眾：不是單位，是一格上的效果」）；SKILL_TREES 主播 3 階「圍觀」、偶像 3 階「召集」的內海欄，以及聚光燈、老粉都在、灌流的導流階；MEDIA 4.1 節（導流階）、9.1 節（召集）、9.3 節（人氣 40）；dev/adr/0020 第七節；dev/adr/0018 第一節（`battle.field`、效果的名字）、第十三節；dev/status.md「M3-skill-net-b 回報」。
- 可以改的路徑：`engine/src/features/netcombat/`（群眾的場地效果與它的效果 op）、`engine/tests/fixtures/skills/streamer.ts`、`idol.ts`（只改內海欄裡這幾條）、`engine/tests/features/M5-crowd.test.ts`。
- 可以用的介面：`k.battle` 的效果登錄表（照 `net.jam` 那一批的註冊法）、`BattleRun` 的基本動作（改一格的遮蔽、對一個單位灌感載）、掛點 `round.start`／`turn.end`、`battle.field`；netcombat 自己的釘住檢定；`meterOf`（`popularity`、`subs`、`credibility`）；衍生數值 `flow_tier`。
- 不可以做的事：不改核心；不把群眾做成單位（不佔站位、不能被選為目標、不能被打）；現實的戰鬥不生效（`modes: ['net']`、掛點先看 `run.mode.layer`）；不動 M3 已經過的行為；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `battle.field.crowd`（netcombat 寫、介面讀）：`{ rally?: { side: 'ally' | 'foe', until: 第幾輪結束, load: number, by: 單位 id }, watch?: { by: 單位 id } }`。
- 戰鬥的效果 `net.crowd`：`{ op: 'net.crowd', kind: 'rally', rounds: 2, load: 4, trace?: 5 }` 或 `{ op: 'net.crowd', kind: 'watch', trace?: 10 }`。
- 事件標籤沿用 `admin` 以外的既有清單：群眾進場與離場各記一拍，標籤用 `trace`（有加追蹤度時）或不帶標籤；不加新的 `BATTLE_EVENTS`（要加就回報，那是核心的事）。
- `netcombat_rule` 多：圍觀時釘住檢定的減值（−4）、企業蕾絲的定義（單位標籤 `lace:white`、`lace:pink`、`lace:black` 而且 `origin` 的勢力是企業：先用「帶 `lace:` 標籤而且不帶 `wild`」）。

## 要做的

1. **召集**（`kind: 'rally'`）：到施放者的第二個回合結束為止——我方每一格的遮蔽升一級（暴露 → 半掩體 → 掩體；記下原本的等級，離場時還原，期間被打壞的照打壞之後的算）；每一輪開始時對敵方（用核心的 `hostileSide`：M4 之後被遠端操控的單位「現在要打的那一方」會變）第 1 格的人灌 `load` 點感載（照防護減、照同步檔位的倍率，和一般的感載一樣走核心的結算）；施放的那一刻追蹤度 +5（場地有 `trace` 才加）。同時只能有一場召集，再放一次是重算期限。
2. **圍觀**（`kind: 'watch'`）：到戰鬥結束為止——帶企業蕾絲標籤的單位不能做釘住（它的 AI 改選別的行動；粉蕾絲照白蕾絲的行為：不攻擊、只叫人），其他敵人的釘住檢定 −4；施放的那一刻追蹤度 +10。
3. **人氣與導流階換成真的來源**：召集的條件「人氣 40 以上」讀 `popularity`（沒有人定義當 0，灰掉的原因：「親衛隊還叫不動這麼多人（人氣要 40）。」）；灌流的「傷害加導流階（最多 +3）」、洗版與圍觀與插播的「導流階 1 以上」讀 `flow_tier`（M3 的寫法應該已經是，這一張用真的 `channel` 再測一次）。
4. **M3-skill-net-b 回報的缺口裡，這一張順手收的**：只收「不需要核心新掛點」的那幾條（例：技能的效果 op 在 netcombat 少了一種寫法）。需要核心掛點的（`load.before`、釘住的 `check.before`、追蹤度跨門檻）不做，原樣列回去。做的人先讀 status 那一段與 `engine/tests/features/M3-skill-net-b.test.ts` 裡標成近似或 `it.todo` 的條目，把「這一張收了哪幾條」列在回報。
5. 介面要的資料：`netBattleView`（或同等的畫面資料）多 `crowd`（哪一邊、還剩幾輪、圍觀開著沒有）。

## 驗收條件（`engine/tests/features/M5-crowd.test.ts`；用 testkit 的內海情境，測試裝真的 `channel` 與 `idol`（或用 `testMeter` 的替身）、自帶一隻粉蕾絲與一個會釘住的精英）

- 召集：放了之後我方四格的遮蔽各升一級；下一輪開始敵方第 1 格的人感載 +4（有防護 2 的是 +2）；到施放者的第二個回合結束，遮蔽回到原本；追蹤度 +5；人氣 39 用不了、原因對。
- 召集期間我方一格的掩體被打壞：離場時那一格不會「還原」成比打壞之後更好的。
- 圍觀：粉蕾絲這一場不再釘住任何人（跑十輪都沒有）、不攻擊；精英的釘住檢定少 4（固定骰子比對）；追蹤度 +10；戰鬥結束效果清掉。
- 現實的戰鬥裡放這兩個效果：被擋或不生效（照 M3 對 `modes` 的做法），狀態不變。
- 導流階：真的頻道訂閱 12,000、公信力 65 → 3 階，灌流的傷害 +3；沒有頻道 0 階，洗版灰掉、原因是「還沒有頻道。」。
- 群眾不出現在單位的清單、不能被選為目標。
- 打到一半存檔讀回來，群眾的期限與還原用的遮蔽都在。
- M3 的內海戰鬥與 `M3-skill-net-b` 測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-idol（`popularity`）、M5-channel（`flow_tier`）、M5-skill-opinion-b（同一批技能資料，排在它後面）。

## M4 對帳（2026-11-26）

- M4-core-gaps 在核心的戰鬥多了幾樣，這一張會碰到的：`hostileSide`／`hostiles`（上面那一處）、每層餘韻的讀法 `run.afterglowPer`、狀態的 `until: 'next_attack'`、掛點 `turn.control`。群眾不是單位，`turn.control` 與 `puppet` 都不會挑到它。
- 內海的感載消退現在是衍生數值 `net_load_decay`（基礎 0）；召集灌的感載照一般的結算走，不用自己處理消退。
- 技能改過名（2026-11-25）：這一張提到的「圍觀、召集、灌流、洗版、插播」都是現在的名字（插播的舊名是插播一下喔）。

## 完成時回報

改了哪些檔、測試結果、M3-skill-net-b 的缺口這一張收了哪幾條、還剩哪幾條要核心（給 M5 的審查或修正批）、「企業的蕾絲」怎麼認的。
