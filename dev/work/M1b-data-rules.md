# M1b-data-rules

- 交給：cpp-data（sonnet）
- 目標：補第二波要用到的**規則表**（不是內容）：戰鬥中的狀態、義體失效與超頻時的數字。名冊、技能、物品的內容不動。
- 規格出處：SKILL_TREES「改造師：手術刀」1 階的「拆解」、2 階的「超頻」兩列（義體失效與超頻各差多少）；ITEMS 5.1 節電磁彈、5.2 節閃光彈兩列；COMBAT_SYSTEM 2.5 節（黑暗）；dev/adr/0015 第三節。
- 可以改的路徑：`engine/data/rules/battle_statuses.json`、`engine/tests/data/M1b-data-rules.test.ts`（新增）。
- 可以用的介面：內容種類 `battle_status` 的格式（`engine/src/core/battle/rules.ts` 的 `BattleStatusRule` 與它的檢查）。
- 不可以做的事：不改 `engine/src/`；不動 `engine/data/world/`、`abilities.json`、`items.json`（內容類是暫定示意資料，不再匯入）；格式放不進去的效果不要硬塞，列出來回報。

## 要加的狀態

| id | 效果（照設計書的數字） |
|---|---|
| `off_limb` | 義肢失效：命中 −2 |
| `off_eye`、`off_smartgun` | 義眼或智慧槍失效：命中 −2 |
| `off_reflex` | 反射加速器失效：下一回合少回 1 點行動點 |
| `off_generic` | 其他種類的義體失效：沒有數字上的效果，只有名字與說明 |
| `boost_limb`、`boost_smartgun` | 超頻：下一次攻擊命中 +2 |
| `boost_subdermal` | 超頻：護甲 +2 |
| `boost_generic` | 其他種類：沒有數字上的效果 |
| `ap_minus_1` | 下一回合少 1 點行動點（閃光彈 I～II、群播、傀儡） |
| `see_dark` | 不受黑暗影響（偵察型無人機同一格的人、紙鶴 II） |
| `untargeted` | 敵人不把他當目標（修正 `ai_target_pct` −100） |

預設都到帶著的人下一回合結束；`boost_eye`（下一次攻擊把目標那一格的遮蔽當成低一級）格式裡沒有對應的修正種類，不加，回報即可。「下一次攻擊」用完就消失如果格式表達不了（只有回合數），照「到他下一回合結束」寫，並在回報裡列出來。

## 驗收條件

- 每一筆載得進來（`loadPack` 沒有錯）、`name` 與 `desc` 是給玩家看的完整句子。
- 帶著 `off_limb` 的單位攻擊的命中明細多一項 −2；帶著 `boost_subdermal` 的護甲多 2；帶著 `ap_minus_1` 的回合開始少 1 點、然後狀態消失。
- `untargeted` 的人不被 AI 挑（M1b-core-effects 做完之後才驗得到；還沒做完就把這一條標成 `it.todo` 並回報）。
- 現有的九個狀態沒有被改動。

## 依賴

`ai_target_pct`、`see_dark` 兩種修正要等 M1b-core-effects；其餘現在就能做。可以和核心的工單同時做。

## 完成時回報

改了哪些檔、測試結果、格式放不進去的效果。
