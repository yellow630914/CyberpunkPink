# M4-core-passive

- 交給：cpp-architect 角色（sonnet）；派工時明說可以改下面列的核心路徑
- 目標：核心加「被動效果的來源」這張登錄表，並收掉三件戰鬥與數字的舊帳：節奏資源全身合計最多 +1、橋參數的有效值進戰鬥、沒有橋的人；角色多一個衍生數值 `sink_floor`。
- 規格出處：CRAFTING 5.5 節「裝備幾乎不給節奏類的資源」那一條；ITEMS 4.1 節「節奏資源」那一條；LEWD_SYSTEM 第 1 節（橋參數、沒有橋的人）；CORE_RULES 4.2 節開頭的三條公式、4.3 節「沉溺的下限」；CYBERWARE 7.4 節；dev/adr/0019 第二節與 P13～P15；dev/status.md 2026-11-23「lewd 留下的」。
- 可以改的路徑：`engine/src/core/rules/passive.ts`（新）、`engine/src/core/rules/kernel.ts`、`engine/src/core/kernel.ts`、`engine/src/core/rules/index.ts`、`engine/src/core/battle/units.ts`、`engine/src/core/battle/turn.ts`、`engine/src/core/battle/rules.ts`（`MOD_KINDS` 加一種）、`engine/src/core/content/product.ts`（把 `effects` 接上檢查）、`engine/src/features/character/`、`engine/src/features/lewd/`、`engine/src/features/deck/`（只在構裝的修正上加 `source: 'construct'`）、`engine/tests/core/M4-core-passive.test.ts`、`dev/invariants.md`、dev/adr/0019（實作補記）。
- 可以用的介面：`StatRegistry`（`addAttrProvider`、`addStatProvider('*', …)`、`addCheckModifier`、`hasStat`、`stat`）、`k.conditions.test`、`k.battle.modifier`（現有功能怎麼註冊修正看 `features/abilities/mods.ts`）、`k.battle.on('unit.ready')`、`MOD_KINDS`、`RollPart`（有 `source` 欄位）、`syncSensitivityOf`（`core/rules/sync.ts`）。
- 不可以做的事：不寫任何一種來源的內容（義體、藥是別的工單）；不快取（先求對；探針量到慢再說）；不改 `actor.track` 這個變更本身；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `PassiveEffect`（封閉的五種，每一筆剛好是其中一種）：`{ attr, amount }`、`{ stat, amount }`、`{ check: { skills?: string[], tags?: string[] }, amount }`、`{ mod, amount, tags?: string[] }`（`mod` 是 `MOD_KINDS` 之一）、`{ unit_tag }`。共通的選填鍵：`if`（條件的陣列，全部成立才算）、`label`（給玩家看的來源名字，沒寫用登記時給的）。`amount` 是不為 0 的有限數字。
- `PASSIVE_SOURCES`（封閉）：`cyber`、`drug`、`tuning`、`quirk`、`malware`、`sink`、`withdrawal`、`wound`、`contract`、`gear`。
- `k.passives.register(owner, source, fn)`：`fn(state, actor) => Array<PassiveEffect>`。`k.passives.of(state, actor)`：這個人現在身上的每一筆（帶 `source`、`owner`、`label`，`if` 不成立的已經拿掉）。`k.passives.parts(state, actor, 'stat', id)` 這類給畫面列組成用的讀法照需要加。
- `passiveProblems(deps, raw)`：一筆或一串的格式問題（鍵不是五種之一、兩種以上的鍵並存、`amount` 不對、`mod` 不在清單裡、`if` 的條件種類沒有人註冊）。條件種類要等功能都裝上才知道，所以內容檢查放在 `ready` 之後的那一輪（照 `features/director` 的 `directorProblems` 的時機）。
- 戰鬥的修正加一種 `ram_regen`（每回合回復的 RAM）。常數 `TEMPO_SOURCES = ['cyber', 'drug', 'gear', 'construct']`。

## 要做的

1. 登錄表與接線：建 kernel 時核心各掛一次——屬性的 provider、`'*'` 的衍生數值 provider、檢定修正（`check.skills` 對檢定的基本功、`check.tags` 對檢定的標籤，有一邊對上就算）、每一種戰鬥修正（單位有 `actor` 時把這個人身上 `mod` 類的每一筆變成一個 `RollPart`，`source` 是那一筆的來源）、`unit.ready`（把 `unit_tag` 加到單位的標籤）。
2. **防止繞圈**：算某個人的被動效果時，`if` 的條件可能又去讀衍生數值而回到這裡。同一個人正在算的時候再進來，直接回傳「不帶 `if` 的那幾筆」。寫一條測試守著。
3. 節奏資源：`core/battle/turn.ts` 算每回合回復的行動點時，`ap_regen` 的修正裡來源屬於 `TEMPO_SOURCES` 的正值合計最多算 +1（負值照算、其他來源照算）；每回合回 RAM 時加上 `ram_regen` 的修正，同一條夾法。`features/deck` 給構裝修正的那一處補上 `source: 'construct'`。
4. `unitFromActor`：敏感度改讀有效值（`bridge_sensitivity` 有人註冊就讀它）；`a.ext.bridge === null` 的角色不給 `load`、不給 `pools.ram`、加標籤 `unbridged`。
5. `features/character`：`load_cap` 的耐受改讀 `bridge_tolerance`（有人註冊時）；定義衍生數值 `sink_floor`（基礎 0、最少 0）；`sink` 效果往回走的那一邊不低於它（`max(amount, sink_floor − 現在的沉溺)`，已經在下限上的整筆拿掉，提醒寫一句「身上的義體讓你浮不上來，這一筆沒有算。」）。
6. `features/lewd`：`bridge` 效果寫回時保留 `ext.bridge` 裡別人的鍵（只改那一項參數）；四個 `bridge_<參數>` 的定義加 `max: 200`；`bridgeOf` 的 `value` 改成直接讀衍生數值（P14），其餘欄位照舊。
7. `core/content/product.ts`：設計圖、零件、`quirk` 的 `effects` 用 `passiveProblems` 查（在 `ready` 之後的那一輪）。
8. dev/invariants.md 加四條：被動效果只有五種鍵與十種來源；來源拿掉之後每個數字回到原值；節奏資源的夾法；沉溺不低於 `sink_floor`（走 `sink` 效果時）。

## 驗收條件（`engine/tests/core/M4-core-passive.test.ts`；測試自己註冊一個來源 `cyber`，回傳的清單由測試控制）

- 一筆 `{ attr: 'body', amount: 2 }`：有效屬性 +2，拿掉之後回來；`{ stat: 'max_hp', amount: 5 }`、`{ check: { skills: ['perform'] }, amount: 2 }`、`{ mod: 'hit', amount: 1 }`、`{ unit_tag: 'night_vision' }` 各自生效在該生效的地方，`statParts` 與戰鬥的修正看得到 `source: 'cyber'`。
- `if` 不成立的那一筆不算；條件自己會讀衍生數值（測試註冊一個讀 `max_hp` 的條件）時不會無限遞迴，結果穩定。
- `passiveProblems` 擋得下：兩種鍵並存、`amount` 是 0、`mod: 'nope'`、`source` 不在清單（`register` 時丟錯）。
- 節奏資源：`cyber` 與 `drug` 各給 `ap_regen` +1，回合回復只多 1；再加一個來源 `ability` 的 +1（用 `k.battle.modifier` 直接掛）多到 2；`ram_regen` 同一條。
- `ext.bridge` 是 `null` 的角色進現實戰鬥：單位沒有 `load`、沒有 `pools.ram`、有 `unbridged`；神經類的攻擊對他沒有感載可加（照敵人的 `unbridged` 現有的行為）。
- 給主角一筆 `{ stat: 'bridge_sensitivity', amount: 20 }`：戰鬥單位的 `sensitivity`、`syncCapOf` 讀到的、`bridgeOf().sensitivity.value` 是同一個數字；`{ stat: 'bridge_tolerance', amount: 20 }` 讓 `load_cap` +10。
- `bridge` 效果落在一個 `ext.bridge` 裡有別的鍵的角色身上，那個鍵還在。
- `sink_floor` 加一個 provider（8）：`sink −5` 的效果把沉溺 10 的人只降到 8，沉溺 8 的人整筆拿掉並有提醒；往上加不受影響。
- 現有的測試全過（`M2-lewd`、戰鬥、場景的不改）；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-product（`effects` 的檢查接在它的內容上）。兩張不要同時做。

## 完成時回報

改了哪些檔、測試結果、每讀一次衍生數值多花多少（粗略量一下：一場八個人的戰鬥跑十回合前後的時間）、`features/deck` 之外還有誰給的修正該標成節奏資源的來源。
