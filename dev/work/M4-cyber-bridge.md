# M4-cyber-bridge

- 交給：cpp-feature（sonnet）
- 目標：橋是 `bridge` 那一槽的一件義體：四類容量從零件算出來並變成衍生數值、橋的機能是被動效果、換橋的手術、沒有橋的人。`abilities` 改讀新的容量。
- 規格出處：CYBERWARE 第 7 節（7.1～7.4）；CRAFTING 第 7 節、8.7 節；CORE_RULES 6.4 節（技能與橋的容量）；ITEMS 3.1 節「邊緣橋的十個型號怎麼組出來」那張表（只當對照）；TRADE 3.4 節換橋那一列；dev/adr/0019 第三節與 P7、P8、P15。
- 可以改的路徑：`engine/src/features/cyberware/`、`engine/src/features/abilities/learn.ts`（只改 `bridgeCapacity` 讀哪裡）、`engine/tests/features/M4-cyber-bridge.test.ts`。
- 可以用的介面：M4-cyberware 的 `installDraft`、`pieceSink`、`cyberOf`；零件的 `bridge`（`capacity`、`split`）與 `affinity`；衍生數值 `bridge_<參數>`、`loadout_minutes`、`loadout_anywhere`、`ram_max`、`sync_cap_bonus`（都用被動效果加）；效果 `sink_floor`（M4-sink 註冊；沒有人註冊時換橋那一筆暫時的沉溺略過）；`actor.ext.bridge`（四項參數，`lewd` 的；這一張只在「沒有橋」與「重新有橋」時寫整個鍵）。
- 不可以做的事：不改橋參數的規則（`lewd` 的）；不做調校槽（M4-tuning）；拼裝橋的隨機容量與怪癖不做；生體橋「沒有熔斷器」只收資料；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 衍生數值（`cyberware` 定義）：`bridge_cap_meat`、`bridge_cap_net`、`bridge_cap_social`、`bridge_cap_media`。沒有橋是 0。
- `bridgeCapacityOf(k, state, actor)`：`{ total, split: Record<四類, number>, from: 每一類的組成 }`。
- 報告：`cyber.bridge`（換橋）。匯出：`swapBridgeBlock`／`swapBridgeDraft(k, state, { actor, uid, via, by?, pay?, keep?: boolean })`、`bridgeQuote`。
- 規則 `cyber_rule` 多：`bridge_fee_mult`（2）、`bridge_recovery_minutes`（4320）、`bridge_swap_sink`（`{ amount: 5, days: 7 }`）、`cap_min`（8）。

## 要做的

1. 容量（P8）：橋那一件的晶片（好幾個時取 `bridge.capacity` 最高的）給總量；軟體的 `bridge.split` 給四類的份數。照份數分、無條件捨去，剩下的點數照小數部分由大到小補（一樣大照 `meat`、`net`、`social`、`media` 的順序）；任何一類不到 `cap_min` 的補到 `cap_min`，差額從最多的那一類扣（扣到它也只剩 `cap_min` 就換次多的）；最後每一類加上所有零件 `affinity` 那一類的值。沒有軟體（或沒有 `split`）當四類等分。
2. `abilities` 的 `bridgeCapacity`：`k.stats.hasStat('bridge_cap_meat')` 時四類都讀衍生數值；否則照舊讀 `ext.bridge.capacity`（現有的測試不改）。函式要多收 `k`，呼叫的地方跟著改。
3. 換橋：一次手術拆舊的、裝新的。費用是安裝費 × `bridge_fee_mult`；休養 `bridge_recovery_minutes`；沉溺成本照新的那一件；另外給一筆暫時的沉溺（效果 `sink_floor`：`amount`、`days`，有人註冊才給）。舊的那一座 `keep` 時回到背包（`state: 'used'`），否則沒有了。休養期間橋本身照樣生效（不然整段時間沒有技能），只有機能的 `effects` 等好了才算。
4. 從沒有橋到有橋：`ext.bridge` 是 `null` 的人裝第一座橋，這一張把 `ext.bridge` 寫成四項都是規則的預設值（`lewd` 的 `default_bridge`，讀內容種類 `lewd_rule` 的那一欄，查不到用 30）。拆到沒有橋不開放（設計書沒有這條路；`removeDraft` 對橋一律擋）。
5. 橋的機能：都是設計圖或零件的 `effects`，這一張不寫程式，只用測試資料驗幾條寫得出來：耐受 +15（`{ stat: 'bridge_tolerance' }`）、RAM +2（`{ stat: 'ram_max' }`）、換配置半小時（`{ stat: 'loadout_minutes', amount: -30 }`，基礎改回 60 是資料的事）、同步檔位上限 +1（`{ stat: 'sync_cap_bonus' }`）、敏感度 −15。
6. `cyber_count` 不含橋（這個衍生數值在 M4-cyber-battle 定義；這一張只確保橋的 `slot` 判斷有一個共用的函式 `isBridge`）。

## 驗收條件（`engine/tests/features/M4-cyber-bridge.test.ts`；測試自帶三顆晶片（40、52、54）、三套軟體（均衡 1：1：1：1、偏現實 20：15：10：10、偏內海 8：28：8：8）、一個現實 +1 的神經元）

- 52 配均衡：13、13、13、13。54 配偏現實加現實 +1 的神經元：20、15、10、10 合計 55（ITEMS 3.1 節緋櫻 奉公的數字）。52 配偏內海：8、28、8、8。40 配一套會把某一類分到 5 的軟體：那一類是 8、合計還是 40。
- `capacityOf`（`abilities`）在裝了 `cyberware` 的 kernel 讀到上面的數字；只裝 `abilities` 的 kernel 照舊讀 `ext.bridge.capacity`，現有的 `M1-abilities` 測試不改全過。
- 換橋：扣的是安裝費的兩倍；舊橋 `keep` 時在背包、`state: 'used'`；`sink_floor` 換成新橋的成本；`ext.bridge` 的四項參數沒有變；裝著的技能超過新容量時不自動卸（`capacityOf` 的 `used` 大於 `max`，由 `abilities` 現有的規則擋下一次裝），結果的句子提醒一次。
- 沒有橋的人：四類容量都是 0；裝上第一座之後 `ext.bridge` 有四項預設值、容量是算出來的。
- 帶 `{ stat: 'bridge_tolerance', amount: 15 }` 的橋：好了之後 `load_cap` 多 7；休養期間沒有，但容量有。
- `removeDraft` 對橋被擋並有原因。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyberware。和 M4-abilities-m4 不要同時做。

## 完成時回報

改了哪些檔、測試結果、CYBERWARE 7.1、7.5 節的機能與代價裡用 `effects` 寫不出來的清單（預期：「被動技能容量 −1」「主動技能 RAM −1」「四類之間挪用 3 點」「回灌 −10%」「重傷時技能不失效」「人格面具切換不花行動」「被注視時感載消退加快」「每七天要回聖堂」「回報後門」；哪幾條要 `abilities` 加鍵交給 M4-abilities-m4）。
