# M4-core-gaps（cpp-architect 角色，sonnet；排在第十九步甲欄，和 M4-followups 同一步、先做這張）

- 交給：cpp-architect 角色（sonnet）；可以改核心的戰鬥（`core/battle`）與 testkit。
- 來源：M4-cyber-battle、M4-cyber-bridge、M4-craft-salvage 回報裡要動核心才做得到的事（2026-11-25）。

## 要做的
1. 重傷 −2 寫死在 `run.mods`：改成讀單位標籤（例如 `ignore_wound_penalty`），讓痛覺編輯器可以用被動效果給這個標籤。
2. `run.implantStatus`（特殊效果打壞義體）：讀單位標籤（例如 `implant_hardened`），皮下裝甲給這個標籤就不會被打壞。
3. 戰鬥中途出現的重的重創（`wound_head`／`wound_limb`）：`combat/wounds.ts` 的空位接上 cyberware 的 `woundedUids`（讀的時候算，不寫狀態），義眼與腦裡的甲板在這一場當下失效。
4. 駭入接頭「不經無線、追蹤度不漲」：在 hack 的追蹤度計算前問一個掛點（例如 `hack.trace_mod`），cyberware 回答；netrun 的子網追蹤度同理（也接回報後門：按勢力的追蹤度修正、起跳 +5）。
5. 「斷藥」狀態的約定：定一個狀態 id（例如 `pump_jam`），掛上時藥泵與冷卻迴路兩回合不能用；cyberware 讀它。
6. `ProductData.part_states?`（二手零件狀態）若 M4-core-part-ai 還沒做，這張不做，留給它。

## 驗收
- 每一項至少一條行為測試；`npx tsc --noEmit`、`npm test`、`test:smoke` 全過；ui `npm test`、`vue-tsc` 全過。不 commit。
7. （M4-medical 回報）被動效果的 `check` 多一個依屬性比對的欄位（例 `attrs: ['body','reflex']`），讓重創「體格與反應的檢定 −4／−2」對直接用屬性的檢定也生效；medical 的預設效果改用它。
8. （M4-sink 回報）沉溺 80～99「餘韻的正面效果加倍」：核心戰鬥規則讀每層餘韻的數字時，問一個被動效果或標籤（例 `afterglow_double`），sink 在 80～99 給。
9. （M4-creation-body 回報）核心 `CreationRuleEntry` 補 `cyber_point_price`、`cyber_install_mult`、`gear_point_price`、`gear_grade_max`、`gear_kinds` 的格式檢查；設計圖與物品的 `available`、出身的 `kit_free` 進核心內容驗證。
