# M4-medical

- 交給：cpp-feature（sonnet）
- 目標：新功能 `medical`：急救、診所治療、重的重創在戰鬥外的效果與手術、戰地手術處理重創；「傷口處理過」。
- 規格出處：DOWNTIME 第 2.2 節（重傷限制）、3.1 節（治療的表與下面三條）；COMBAT_SYSTEM 第 6 節（重創的表）；CORE_RULES 4.1 節；SKILL_TREES 改造師「戰地手術」「全面翻修」那兩列與日常的「手術」第二項；dev/adr/0013 D3；dev/adr/0019 第五節與 P46。
- 可以改的路徑：`engine/src/features/medical/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-medical.test.ts`。
- 可以用的介面：角色身上的狀況 `wound_limb`、`wound_head`、`wound_torso`（`features/combat/wounds.ts` 在戰鬥結束時給）、`treated`（`features/rest` 在讀：先看 `features/rest/model.ts` 第 242 行附近怎麼判斷）；`k.passives.register`（來源 `wound`）；衍生數值 `max_hp`、`armor_body`；條件 `at_facility`、`ability`（`daily: 'surgery'`）；設施種類的 `clinic.grade`（和 `cyberware` 讀同一欄）；`makeCheck`、`checkParts`；核心的 `actor.track`（往上補血）、`actor.condition`、`cred`／`cash`、`time` 變更；戰鬥的效果登錄（`k.battle.registerEffect`，寫法看 `features/combat/ops.ts`）與單位上的 `wounds`（`features/combat/wounds.ts`）；`k.effects.register`。
- 不可以做的事：不做義體的修理（`cyberware` 的）；不做沉溺的治療（M4-sink）、成癮的治療（M4-drugs）、天使急救；戰鬥裡現有的急救道具與技能不動；不 import 別的功能；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 規則 `medical_rule`（`overridable`）：`aid`（`{ minutes: 10, dc: 13, kit_bonus: 2 }`）、`heal_price`（每點：`clinic` 8、`unlicensed` 4、`black` 5）、`heal_minutes_per_10`（60）、`wound_price`（1200）、`wound_recovery_minutes`（4320）、`wound_effects`（每種重創的被動效果，預設照 P46：`wound_limb`：體格與反應的檢定 −4；`wound_torso`：`max_hp` −5、`armor_body` −99；`wound_head`：沒有數字（義體失效是 `cyberware` 讀狀況做的））、`recovery_effects`（手術後休養：體格與反應的檢定 −2）、`treated_minutes`（1440）。
- 角色的狀況（共用的字彙）：`treated`（傷口處理過）、`aided`（這一次受傷已經急救過）、`wound_recovering`（重創手術後休養中）。
- 效果：`wound_heal`（`{ part?: 'limb' | 'head' | 'torso' }`，沒寫是全部）、`treated`（掛上 `treated`）。兩個都只有內建的來源能用。
- 戰鬥的效果 op：`wound_treat`（`{ who, all?: boolean }`）。
- 報告：`medical.aid`、`medical.heal`、`medical.surgery`。匯出：`aidBlock`／`aidDraft(k, state, { by, target })`、`clinicQuote`、`clinicHealDraft(k, state, { target, pay? })`、`woundsOf(state, actor)`、`woundSurgeryBlock`／`woundSurgeryDraft(k, state, { target, part, via: 'clinic' | 'self', by? })`、`medicalView`。

## 要做的

1. 急救（戰鬥外）：不在戰鬥中、對象生命不到上限、身上沒有 `aided`。做的人擲技術＋醫療對 13，背包裡有帶 `medkit` 標籤的物品 +2（不消耗）。成功回 1d6＋醫療等級並掛 `treated` 與 `aided`；大成功回兩倍；失敗只掛 `aided`；大失敗 −1d4（最少剩 1）也掛 `aided`。時間 +10 分鐘。
2. `aided` 什麼時候拿掉：對象再受傷的時候。掛 `report.after`：一份報告裡有那個人生命往下的 `actor.track`，就接一筆把 `aided` 與 `treated` 拿掉的變更（戰鬥結束的那一份也算）。
3. 診所治療：腳下的設施有 `clinic`。回到滿；錢＝缺的點數 × 那一種診所的單價；時間＝每 10 點一小時（進位）；掛 `treated`。錢不夠時治得起幾點就治幾點（至少 1 點才成立）。
4. 重的重創在戰鬥外（來源 `wound`）：身上有哪一種 `wound_*` 就給規則表那一組效果；`wound_recovering` 給 `recovery_effects`。
5. 重創的手術：診所收 `wound_price`、把那一種狀況拿掉、掛 `wound_recovering`（三天）。自己或隊友動刀（條件 `ability`，`daily: 'surgery'`；沒有人註冊就不列）：不收錢、花一個時段（240 分鐘）、要在住處或診所、效果相同。
6. `wound_treat`（戰地手術、全面翻修的現實欄用）：對象在這一場的重創，輕的直接解除（照 `features/combat/wounds.ts` 解除狀態的方式）、重的降成輕的；`all: true` 是全部清掉。只在現實的戰場。
7. 效果 `wound_heal`、`treated`：給事件用（診所的病床、帶傷來躲的人）。

## 驗收條件（`engine/tests/features/M4-medical.test.ts`；測試自帶三種診所的設施與一個醫療包）

- 急救四種成功程度各一條（固定骰子）；有醫療包時檢定的組成多一筆 +2；急救過的人第二次被擋並有原因；他再挨一下（測試提交一份扣血的報告）之後又可以急救、`treated` 也沒了。
- `treated` 之後睡一覺回得過一半（和 `restFeature` 一起裝，抽 `M2-rest` 重傷限制那一條的寫法）。
- 診所：缺 14 點在正規診所扣 112、時間 +2 小時、回滿；無照扣 56；錢只夠 5 點時回 5 點。
- `wound_torso` 的角色：`max_hp` 少 5、`armor_body` 是 0；`wound_limb`：運動的檢定組成多一筆 −4。手術之後狀況沒了、三天內檢定 −2、三天後沒有。
- 自己動刀：沒有人註冊 `ability` 時不列；註冊之後不扣錢、時間 +240 分鐘。
- `wound_treat`：戰鬥裡給一個單位一個輕的肢體重創與一個重的軀幹重創（照 `M1-combat` 測試製造重創的方式），跑一次之後輕的沒了、重的變輕；`all` 全清。內海的戰場用不出來。
- 效果 `wound_heal`、`treated` AI 給的被擋。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-passive。

## 完成時回報

改了哪些檔、測試結果、治療的價錢還沒有乘區的倍率、「肢體接回還是直接換義肢」的選擇（TRADE 3.4 節）沒有做、`treated` 的期限是暫定的一天。
