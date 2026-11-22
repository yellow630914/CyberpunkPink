# M1b-data-gunner-broker（cpp-data）

## 目標

把示意資料 `engine/data/rules/abilities.json` 裡槍手與掮客 `meat: { pending: true }` 的技能照新鍵改寫（使用者 2026-11-22 定案：只動機制欄位，不動 `text`、`name`、容量等，不算匯入新內容）。共 38 個，其中「增援」（`sk_fixer_reinforce`）照 ADR 0015 E13 留 `pending`。

## 依據

- 鍵的寫法：`engine/tests/features/M1b-skill-gunner-broker.test.ts` 裡的假資料（id 與示意資料相同、數字照 SKILL_TREES），照它逐筆搬進示意資料的 `meat`／`use`／`kind`／共鳴的 `effect`。
- 對照表（M1b-skill-gunner-broker 回報）：
  - 槍手：instinct（`meat.instinct:true`，共鳴 5 `mods instinct_points +1`）、tap、suppress_stance（stance）、loadout_mastery、back_off、pierce、run_and_gun、deadline、hunter_eye、covering_retreat、kill_rhythm、barrage（stance）、flow、next_one、dont_move、one_shot、fire_wall、bullet_time、gun_unity、right_back。aimed_shot、cover_fire、burst、watch_me、point_shot、thats_you 不變。gun_care 仍 `prep`、meat null。
  - 掮客：face 共鳴 2、3；im_here、proxy、talk_down、block、black_market、bribe、bail、hit_him、dispatch_net、formation（stance）、big_picture、i_know_someone、lets_talk、all_out、hold_the_line、city_owes_me、command（stance）、connections。focus_fire、watch_out、swap 不變；buy_space、a_bit_more、prep、intel_net 維持 meat null；reinforce 維持 pending。
- 格式：`engine/src/features/abilities/format.ts`。

## 驗收

- 示意資料用 `strict: true` 載入、`checkRefs()` 空陣列。
- 38 個 id 裡除增援外 `meat` 都不是 `pending`；`text` 與改寫前逐字相同（測試比對 git 上一版）。
- 每一筆的 `meat` 與測試假資料的那一筆深度相等（測試可以直接 import 那份假資料，或抽成共用的 fixture）。
- 冒煙：一場用示意資料、槍手裝 suppress_stance 與 next_one 的戰鬥打得完。
- `engine/tests/data/M1-data-abilities.test.ts` 有寫死 pending 數量的斷言跟著改。

## 不做

- 不改 `features/abilities` 的程式；格式不收的停下來回報。
