# M2-fix-review（cpp-architect，sonnet）

依據：dev/reviews/2026-11-23-M2.md（引擎審查）、dev/status.md 的 M2-ui-life／M2-ui-people 兩段。使用者 2026-11-23 裁決：都照建議。

## 要修

1. **必修 1：車上開打或開場景**。使用者定案：戰鬥或場景一開始就結束這一趟車，人在下一站（`transit` 的下一站），沒坐完的票作廢。做法：`ride` 的事件選項要開戰鬥／場景時，先結束 `ride` 活動（`activity.end` 原因 `interrupted`），把位置設到下一站，再開戰鬥或場景。EVENTS 4.10 的追兵上車、癡漢兩種都要能走完。測試：車上事件選開打 → 戰鬥開得起來、打完人在下一站；選場景同理；存讀檔與回退在中途都正確。
2. **應修 1**：副本放行表拿掉 `rewind:stage`、`rewind:entry` 的「隨時可用」。回到階段開始只在戰敗的選項裡；回到入口只能走 `commission.retreat`（退錢與請來的人）。核心 `rewindToKind` 照放行表；測試：副本裡沒打輸 `rewindToKind('stage')` 被擋並有原因。
3. **應修 2**：撤退後再進去不固定骰值（SERIES 第 6 節）。撤退時還原快照但亂數往前推（例如 `deriveRng(state.rng, 'retreat/<委託 id>/<次數>')` 換新的游標或種子分支），一般的回退仍固定骰值。測試：同種子撤退兩次，兩趟第一擲不同；一般回退不變。
4. **應修 3**：副本內事件同一件委託不重複（EVENTS 3.3）；壓力條（警戒）漲過 60 時多擲一次 15%（EVENTS 3.1）。
5. **應修 4**：`shell/ai/settings.ts` 選服務商時讀成人路由的設定，`adult: true` 走成人路由。測試用假服務商驗路由。
6. **應修 5**：完成委託時，雇主勢力好感 +3，評價最高再 +2（共 +5）（FACTIONS 5.2）。
7. **應修 6**：`tests/features/M2-scene.test.ts:1358` 全量跑逾時：加快（縮小迴圈）或給該條明確 timeout，並說明根因。
8. **應修 7（使用者定案放進這批）**：FACTIONS 6.1 敵對值分段對委託的後果：目標勢力敵對值到記名以上時遭遇預算 +1、警戒起始 +20；到中間人不接的那段，那個勢力底下的中間人不給委託（照 FACTIONS 6.1 的分段）。
9. **設計書裁決**（文件由文件代理改，你改資料與程式）：
   - EVENTS 3.3：街頭範圍加 `transit_stop` 6%（`engine/data/rules/event_scopes.json`）。
   - 勢力好感折扣維持 TRADE（6%／10%），不改程式。
   - 敵對值物價：20～39 ×1.1、40～59 ×1.2、60 以上不做生意（`trade_rules.json` 與 trade 的程式）。
10. **建議 1**：`fixer/gen.ts:531`、`enemies/capture.ts:125`、`world/index.ts:101` 的 `localeCompare` 改成字元碼比較。
11. **建議 2**：enemies 的 `CAPTURE_KEY` 改名帶 EXT（或讓第 107 條的掃描認得），存檔相容（舊鍵讀得到）。
12. **建議 3**：名冊離開判斷 `<= 20` 改成 `< 20`（NPC_SYSTEM 10.4）。
13. **M2-ui-life**：`rest.sleep`／`rest.breath` 的 results 句子不要帶數字（H4），數字留在 changes／報告欄位。測試：AI 開著（假服務商回填 results）時睡覺不會 paused。
14. **M2-ui-people**：
    - 建角時把出身的名冊真的放進名冊（`pc.ext.origin.roster` → roster 功能），有測試。
    - `npc` 改成可覆寫（ADR 0017 的 `overridable`），後載入的包同 id 取代整筆；寫進 ADR 0017 補記。
    - `features/npcs` 匯出 `knowFactText`；`interactions` 對當天已聊過的 chat 回一句說明（例如「今天聊過了，不會再加親密度。」）。

## 不做

- 「正在被討」的人情待處理、0016 第七節前綴表補行（文件代理順便補）。
- 不改 ui/（之後介面修正批再接）。

## 驗收

- engine `npx tsc --noEmit` 0 錯、`npm test` 全過（含全量不逾時）、`npm run test:smoke` 全過、pending 只有 B009。
- 每一項至少一個行為測試；invariants.md 有新增的規則就加條目（第 115 條起）。
- 不 commit；回報改了什麼、測試數、做不到或需要使用者決定的。
