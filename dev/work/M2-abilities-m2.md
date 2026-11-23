# M2-abilities-m2

- 交給：cpp-feature（sonnet）
- 目標：把 M1 第二波留到 M2 的技能機制補上：增援；夥伴的技能；名媛開打前的效果（偽裝、被識破、讀人、面具與豔名）；情報網；換配置的地點與時間；戰鬥裡的人情池。
- 規格出處：SKILL_TREES 掮客「增援」「情報網」兩列與表後的說明、名媛「入戲」「偽裝」「讀人」「我演得很像吧」「入骨」幾列與表後的說明；SKILLS 1.11 節（預備）；CORE_RULES 6.4 節與 UI 8.3 節（換配置）；dev/adr/0015 E2、E3、E4、E13；dev/adr/0016 第五節、G1、G4、G10；dev/status.md 標了 M2 的技能項目。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/tests/features/M2-abilities.test.ts`。
- 可以用的介面：`view.bench`、`run.callIn`（M2-core-battle）；`k.stats.defineStat`／`addCheckModifier`；核心的 `actor.condition` 變更（`masked`）；`k.effects`（`npc_known`、`scout_reveal`；沒有人註冊就略過那一筆）；`k.conditions`（`at_home`、`at_facility`；沒有人註冊就不限地點）；`k.stats`（`favor_small`、`favor_mid`、`favor_big`；沒有就當 0）；`battle.origin.ext`（`commission`、`pre`）。
- 不可以做的事：不 import 名冊、人情、委託、NPC 的功能；不改示意資料的文字（要讓現有的示意技能用得到新鍵，只動機制欄位並列在回報裡）；M1、M1b 的技能測試原樣全過；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 效果 `{ op: 'call_in', key?, fallback?: 一串效果 }`；技能的 `picks` 多一種 `kind: 'bench'`（選項來自 `view.bench`，沒空的列著並帶原因）。
- 預備多 `prep.effects`（戰鬥外當場結算的效果，走 `k.effects`）與 `prep.target: 'person'`（要選一個人）；`prep()` 的輸入多 `target`、`commission`。
- 姿態多 `meat.out`（戰鬥外也開得了的姿態）：`{ check: { tags, skill, value }, on_start?: 效果 }`。
- 被動多 `out_mods: [{ tags, value }]`（戰鬥外帶這些標籤的檢定加多少）。
- 衍生數值 `loadout_minutes`（G1：30）。報告：`ability.stance`、`ability.loadout`。

## 要做的

1. **增援**：`call_in` 用 `run.callIn` 叫 `pick[key]` 選的那個候補；回傳 `null`（沒有空格）時做 `fallback`。不算叫人的次數。
2. **夥伴的技能**（G4）：有 `ext.paths`、沒有自己的學習紀錄的角色，他每條路數那棵樹、階數以內、不是 `pending` 的技能都算裝著。
3. **偽裝**：戰鬥外開著時，帶 `infiltrate` 標籤、用表演的檢定 +2（`meat.out`）；開打時還開著而且這一場的 `pre.spotted` 不是 true，第一回合的第一次攻擊命中 +2。**被識破**：`pre.spotted` 是 true 時，偽裝與入戲的「第一回合不被當成目標」這一場都不生效。「我演得很像吧」「入骨」是 `out_mods`（`infiltrate` +2、+4）。
4. **面具與豔名**：裝著入戲的角色身上掛著 `masked`，卸下來就拿掉（裝卸的報告裡帶那一筆變更）。
5. **讀人**：預備時選一個人，`prep.effects` 給一筆 `npc_known`（他的一個傾向）；帶進下一場：對那個人（單位的角色或 `ext.npc` 對得上）誘惑攻擊命中 +2；戰鬥外對他的誘惑與交涉檢定 +2。
6. **情報網**：`prep.effects` 給一筆 `scout_reveal`；「每件委託 1 次」照輸入的 `commission` 記次數，沒給就擋下並有原因。原本帶進第一場戰鬥的效果照舊。
7. **換配置**：`applyLoadout(k, state, actor, ids)` 一次換成一整組，報告的時間加 `loadout_minutes`；有 `at_home` 或 `at_facility` 這兩種條件時，要人在自己的住處或調校診所才行；逐一裝卸的入口照同一條規則。
8. **人情池**：開打時三個池的數字讀衍生數值；結束時用掉幾個就發幾筆 `favor.spend`（那個變更有人註冊才發）。
9. 「每件委託」的次數用真的委託 id（`origin.ext.commission`）驗一次。

## 驗收條件

- 增援：有空格時下一輪開頭他站上來、照他自己的資料、由玩家操縱；四格全滿時改做 `fallback`；兩種都不算叫人的次數；候補是空的時行動灰掉並有原因。
- 只有 `ext.paths` 的夥伴上場時帶著那棵樹階數以內的技能；`pending` 的沒有。
- 偽裝開著：`infiltrate` 的表演檢定明細多一條 +2；開打第一次攻擊命中 +2、第二次沒有；`pre.spotted` 時兩個都沒有、入戲的不被當目標也沒有。
- 裝上入戲之後角色身上有 `masked`、卸下之後沒有。
- 讀人：預備花一個時段、`npc_known` 的替身效果收到那個人；下一場對他的誘惑攻擊命中 +2、對別人沒有。
- 情報網：同一件委託第二次被擋；另一件可以；沒給委託被擋。
- 換配置：時間 +30 分鐘；有住處的條件時不在家被擋並有原因；有 `commission` 的替身活動進行時被擋。
- 人情池：衍生數值給 2 個小人情時池是 2；用掉一個，結束的報告裡有一筆 `favor.spend`。
- M1、M1b 的技能測試原樣全過。

## 依賴

M2-core-battle；讀得到名冊的候補（M2-roster）、人情（M2-favors）、`scout_reveal`（M2-fixer）、`npc_known`（M2-npcs）最好，測試用替身。做的時候 `features/abilities` 不能有別的工單在改。

## 完成時回報

改了哪些檔、測試結果、示意資料動了哪幾筆的機制欄位、dev/adr/0015 E13 的清單裡還剩什麼。

- 2026-11-23 補（M2-favors 回報）：戰鬥的人情池改讀 `state.ext.favors`（衍生數值 favor_small/mid/big），結束時用 `favor.spend { dir: "owed_to_pc", size }` 一筆一筆扣；拿掉 `actor.ext.favors` 舊格式（abilities/use.ts、end.ts、wallet.ts）。
