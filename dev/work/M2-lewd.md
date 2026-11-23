# M2-lewd

- 交給：cpp-feature（sonnet）
- 目標：新功能 `lewd`：四項橋參數、傾向（四條軸與標籤）、每區的豔名，以及它們接到主玩法的那幾處。
- 規格出處：LEWD_SYSTEM 第 1 節、1.1 節、第 5 節、第 9 節；CORE_RULES 4.2 節（敏感度與感載、耐受與上限）；DATA 第 8 節（`bridge`、`tendencies` 的樣子）；dev/adr/0016 第三節、G10、G14。分段、有效值、超過 100 的遞減參考 ElondiaRPG 的 `src/engine/lewd.ts`（只參考做法）。
- 可以改的路徑：`engine/src/features/lewd/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-lewd.test.ts`。
- 可以用的介面：`k.meters.define`、`k.effects.register`、`k.conditions.register`、`k.stats.addStatProvider`／`addCheckModifier`、`k.battle.on('unit.ready')`、核心的 `actor.ext` 變更。
- 不可以做的事：調校、服裝的曝露度與風格、契約、場所（M4）；設計書沒有寫數字的效果不要自己編（列在回報裡）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `actor.ext.bridge: { sensitivity, tolerance, craving, docility }`（各 0～100；核心與角色的功能已經在讀前兩項，鍵名不能改）。沒有橋的人這一欄是 `null`。
- `actor.ext.tendency: { axes: { relation, sense, body, costume }, tags: { [標籤]: 'latent' | 'has' | 'deep' } }`。
- 內容種類 `tendency_tag`：`{ id, name, axis }`（標籤屬於哪一條軸；清單是內容，測試自己帶）。
- 效果 `bridge`（`{ kind, param, amount }`；AI 的一件事最多一項 +1）、`tendency`（`{ kind, tag }`：沒有的變成有，那一軸累積一點；潛在的第一次碰到直接變成有、那一軸多一點）。條件 `bridge`（`{ param, min?, max? }`）、`tendency_tag`、`tendency_axis`、`has_bridge`。
- 量表 `fame`（照區、0～100、AI 的上限 ±5）。
- 共用的狀況 id `masked`（戴著人格面具；M2-abilities-m2 會掛在人身上，這裡只讀）。

## 要做的

1. `bridgeOf(k, state, actor)`：四項的有效值與所在的那一段。
2. 接到主玩法（只做設計書有數字的）：耐受每 40 點承受層數 +1（`afterglow_cap` 的來源；感載上限的那一半角色的功能已經算了，不要重複）；慾求高於 60 的人開戰時帶著感載（G14）；豔名的「被認出來」（G10：帶 `infiltrate` 標籤的檢定，身上有 `masked` 時不算）。
3. 軸的累積：每條軸 0～5 級，累積的點數到門檻升級（門檻做成規則，預設每級 10 點）；「有」變成「深」只能由效果明寫（`{ kind: 'tendency', tag, to: 'deep' }`，AI 給的不收）。
4. 玩家在內容篩選關掉的標籤：不會長、`tendency` 效果落在它上面整筆拿掉並提醒。
5. 開新局：主角沒有 `bridge` 時補上建角給的值或預設（四項各 30）；`save.loaded` 同樣補。

## 驗收條件

- `bridge` 效果：內建的照寫；AI 一件事給兩項各 +3，只留一項 +1 並有提醒；加到超過 100 夾住。
- 耐受 40、80 的人承受層數各是 4、5；感載上限沒有被加兩次（和角色功能的公式比）。
- 慾求 60 的人開戰感載是 0；慾求 80 的人是 5；不超過上限的一半。
- `tendency`：沒有 → 有；潛在 → 有而且軸多一點；點數到門檻軸升一級、最多 5；「深」只有寫了 `to` 的內建效果做得到。
- 被關掉的標籤不長。
- 豔名 50 的區裡，帶 `infiltrate` 的檢定多一筆 −2；身上有 `masked` 時沒有這一筆；別的檢定沒有。
- 條件四種各有成立與不成立的例子。
- 沒有橋的人：`bridge` 效果落空並提醒、`has_bridge` 不成立。
- 存檔往返數字不變。

## 依賴

M2-core-meters。做完才能開 M2-scene；M2-npc-interact、M2-work 會用到豔名與傾向的條件。

## 完成時回報

改了哪些檔、測試結果、LEWD_SYSTEM 第 1 節那張表裡因為沒有數字而沒做的格子（預期：敏感度的感知、慾求讓消退變慢、馴化對控制類的豁免）。
