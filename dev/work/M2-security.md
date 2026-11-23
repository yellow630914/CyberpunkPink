# M2-security

- 交給：cpp-feature（sonnet）
- 目標：新功能 `security`：每個勢力一條敵對值與一條好感（分段、怎麼漲、怎麼降、下限）；掃橋這一個統一的動作。
- 規格出處：FACTIONS 第 6 節全部（分段、怎麼漲、怎麼降、下限）；CORE_RULES 第 8 節；LIFE 2.1 節（掃橋看的四樣）、2.2、2.3 節（三種人、假身分）；EQUIPMENT 6.3、6.4 節（掃描強度、被發現之後）；UI 3.11 節（玩家看到什麼）；dev/adr/0016 第三、四、七節。
- 可以改的路徑：`engine/src/features/security/`（新）、`engine/src/features/gear/`（只加一個 `scan.carried` 的處理函式，內容用它現有的 `scanFinds`）、`engine/src/features/index.ts`、`engine/tests/features/M2-security.test.ts`。
- 可以用的介面：`k.meters.define`（含 `floor`、`adjust`）、`k.activity.define`／`start`、`activity.end`、`k.hooks.on('time.passed' | 'report.after')`、`crossings`、`k.content`（`faction`、`district`、`item`）。
- 不可以做的事：分段的後果裡屬於別人的不在這裡做（追兵事件是事件的資料、委託的警戒起始是 commission 讀量表、物價是交易自己讀量表）；不做沉溺與契約的那一步、不做刑罰與拘留；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 量表 `hostility`（0～100、AI ±10、`floor: 'hostility_floor'`、`adjust` 照區的倍率）、`hostility_floor`、`favor`（0～100、AI ±5）。
- 內容多讀的欄位：`faction.bribe`（收不收錢）、`district.hostility_mult`（照勢力或 `*`）、`item.legal`（已經有）；假身分是帶 `fake_id` 標籤的物品，`grade` 1～3 是一次性、淺層、深層。
- `actor.ext.identity: { class: 'member' | 'citizen' | 'unregistered' | 'bound' }`（預設 `citizen`）。
- 掛點 `scan.carried`（這個功能宣告）：`[{ state, actor, strength }, Array<{ item, name, legal }> | void]`。
- 活動 `scan`：`setup` 是 `{ point, name, strength: 0～3, faction?, need_class? }`；`activity.end` 的 `result` 是 `{ passed, how }`。
- 報告：`scan.pass`、`security.bribe`、`security.decay`。

## 要做的

1. `hostilityTier(k, state, faction)`：六段的 id 與名字；條件 `hostility_tier`（`{ faction, min }`）。
2. 消退（`time.passed` 順序 12，每週一）：每週 −5；那一週沒有新的敵對值再 −5（合計 −10）；不低於下限。「那一週有沒有新的」由 `report.after` 看報告裡的 `meter` 變更記下來。
3. 收買：`bribeBlock`／`bribe(k, state, faction, points)`，價錢照 FACTIONS 6.3（每降 1 點 50 × 敵對值 ÷ 20 進位，一次最多 20），不收錢的勢力給原因。
4. **掃橋**：`start` 照順序看身分、那個勢力的敵對值、身上會被掃到的東西（問 `scan.carried`）。強度 0、或什麼都沒掃到而且沒被認出來：直接一份 `scan.pass`，並發 `activity.end`（`passed: true`）。其餘的開一件內嵌的事件（M2-event-run）讓玩家選：照常過、用假身分（身上有才列）、掉頭。事件做完之後把結果換成 `scan` 的 `activity.end` 交回原本發起的人。
5. 結果：通緝（100）一律攔；記名以上假身分的檢定 +2 難度；違禁的東西被掃到：沒收、那個勢力敵對值上升；許可類沒有執照同樣沒收。假身分的檢定與數字設計書沒有寫的部分先做成規則的預設並列在回報裡（建議：假身分的等級不低於強度就過；低一級擲表演對 13 ＋ 強度 × 2；更低不能用）。
6. 一次性的假身分用掉就沒了。
7. 對外：`scanView(k, state)`（掃橋的事件開著時：這個點的名字與強度、四步各自是過、注意還是不適用與原因、身上會被掃到的每一樣東西），給介面畫掃橋的框；`hostilityView(k, state)`（現在有敵對值的勢力、哪一段、下限）。

## 驗收條件

- 敵對值 +5 在倍率 2 的區變成 +10；AI 的一件事合計不超過 10。
- 分段：19、20、40、60、80、100 各落在對的那一段。
- 一週沒有新的敵對值：−10；有：−5；下限 30 時停在 30。兩週一次跨過補兩次。
- 收買：敵對值 45 降 10 點的價錢對得上公式；不收錢的勢力被擋下並有原因；現金不夠被擋下。
- 強度 0 的點：不跳事件，直接通過，發起的替身收到 `passed: true`。
- 強度 2、身上有一把掃得到的違禁武器：跳出事件；選照常過 → 武器沒了、敵對值上升、`passed` 照規則；選掉頭 → 什麼都沒變、`passed: false`。
- 身上沒有假身分時沒有那個選項；有淺層的對強度 2 自動過、對強度 3 要擲。
- 通緝的勢力的檢查哨：三個選項裡只有掉頭走得通。
- `need_class: 'member'` 的點，市民被攔下並有原因。
- 同一個種子結果一樣；掃橋的事件開著時存檔再讀照樣走得完。

## 依賴

M2-core-meters、M2-event-run。做完才能開 M2-transit；M2-market、M2-fixer、M2-commission-close 會讀這裡的量表。

## 完成時回報

改了哪些檔、測試結果、FACTIONS 第 6 節與 LIFE 2.1 節裡沒做的（預期：躲風頭再 −10、人情與抵帳委託、沉溺與契約的掃描、先寄放）。
