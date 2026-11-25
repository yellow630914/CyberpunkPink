# M4-security-m4

- 交給：cpp-feature（sonnet）
- 目標：掃橋的第四樣：讀這個人身上的義體、沉溺與契約。新掛點 `scan.person`；看穿藏著的沉溺；違禁與沒登記的義體怎麼處理。
- 規格出處：LIFE 2.1 節（四樣裡的最後一樣）、3.1 節（四個等級的表與義體的幾列）、3.2 節（刑罰：只看罰金與義體鎖定）；NPCS 8.3 節「隱藏沉溺」；EQUIPMENT 6.3、6.4 節；LEWD_SYSTEM 7.1 節「掃橋看得到契約」；dev/adr/0019 第十四節的掛點表與 P21；dev/status.md 2026-11-23「security 沒做的」。
- 可以改的路徑：`engine/src/features/security/`、`engine/tests/features/M4-security-m4.test.ts`。
- 可以用的介面：`features/security/scan.ts` 現有的流程（身分 → 敵對值 → 身上的東西）、掛點 `scan.carried` 的宣告方式（照樣宣告 `scan.person`）、內嵌事件的選項；衍生數值 `sink_shown`（`features/sink`；沒有人註冊就當沒有沉溺可讀）；角色的 `sink`；`makeCheck`、`deriveRng`；效果 `cyber_lock`、`cash`、量表 `hostility`（用登錄表跑，查不到略過）；`securityRules`。
- 不可以做的事：不 import `cyberware`、`sink`、`contract`；拘留與寄放不做（違禁的義體用「鎖定加罰金加敵對值」代替，列在回報）；降敵對值的其他方式、分段的後果不在這一張；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 掛點 `scan.person`（這個功能宣告）：`[{ state, actor, strength }, PersonAnswer | void]`。`PersonAnswer` 的每個鍵都選填、好幾個回答合起來：`cyber?: { count, items: Array<{ uid, name, legal, registered }> }`、`contract?: { class: 'bound', holder, level, covered } `、`rights?: Array<{ holder, level }>`、`hide?: number`（藏沉溺的手段有幾種：藥、調校、面具各算一種；誰有誰報）。
- 掃橋的設定（`ScanSetup`）多 `reads?: Array<'cyber' | 'sink' | 'contract'>`；沒寫時照規則表 `readers`（勢力 → 讀哪幾樣）查那個點的勢力；兩邊都沒有就只讀 `cyber`。
- 規則 `security_rule` 多：`readers`（預設空的；內容匯入時填鎮溺隊、貞網局、伊甸園）、`sink_notice`（60：看到的沉溺到這裡才有事）、`sink_see`（`{ per_strength: 3, base: 10, per_hide: 2 }`）、`cyber_fine`（`{ register: 200, permit: 800 }`）、`cyber_lock_hours`（24）、`cyber_hostility`（`{ register: 2, permit: 5, banned: 10 }`）。
- 掃橋的結果（`activity.end` 的 `result`）多：`person: { cyber_found: Array<{ name, legal }>, sink_seen?: number, contract?: …, saw_through?: boolean }`。`scanView` 多這一段。

## 要做的

1. 流程多一步（在「身上的東西」之後）：問 `scan.person`，照 `reads` 處理三樣。強度 0 的點不問。
2. 義體（LIFE 3.1 節）：強度 1 只讀得到件數；強度 2 以上逐件看——合法性是 `free` 的沒事；`register` 而 `registered` 是 false 的：罰金 `cyber_fine.register`、那個勢力敵對值 +2；`permit`（沒有執照：照現有的 `hasLicense` 用名字查）：罰金 800、敵對值 +5；`banned`：那一件鎖 24 小時（效果 `cyber_lock` 帶 `uid` 與 `hours`，查不到效果就只加敵對值）、敵對值 +10、這次沒過。罰金從現金扣、不夠的扣到 0（剩下的不追）。
3. 沉溺（P21）：只有 `reads` 含 `sink` 的點。讀到的是 `sink_shown`；它和真正的沉溺不一樣（有藏）時擲一次看穿：d20 ＋ 強度 × 3 對 10 ＋ mod(意志) ＋ 定力的等級 ＋ `hide` × 2；看穿了就用真正的值。讀到的值在 `sink_notice` 以上：那個勢力敵對值 +3、這一次照常過（鎮溺隊的後續是事件與敵對值的事）；100 以上：這次沒過（只有掉頭）。
4. 契約：`reads` 含 `contract` 的點把回答原樣放進結果（顯示用）；`covered` 是 true 而強度不到 2 時當作沒看到。身分是 `bound` 的人進得去哪裡照現有的 `rankOf`。
5. 內嵌事件的選項與說明多列這三樣讀到了什麼（一樣一句）；假身分蓋不掉義體與沉溺（那是身體上的），只蓋身分與契約。
6. 沒有人回答 `scan.person` 時流程和現在完全一樣。

## 驗收條件（`engine/tests/features/M4-security-m4.test.ts`；`scan.person` 由測試自己掛假的回答；`cyber_lock` 用假效果）

- 沒有人掛 `scan.person`：現有的 `M2-security` 測試不改全過。
- 強度 2 的點、回答裡有一件沒登記的 `register` 義體：扣 200、假量表 +2、照常過；一件 `banned` 的：假的 `cyber_lock` 被叫到（帶那一件的 `uid` 與 24 小時）、敵對值 +10、沒過。強度 1 只有件數、沒有處罰。
- `reads` 沒有 `sink` 的點不讀沉溺。有的點：真正 70、`sink_shown` 50、`hide` 1：固定骰子看穿時敵對值 +3、`saw_through` 是 true；沒看穿時讀到 50、沒事。真正 105 而且看穿：沒過、只剩掉頭。
- 契約：`covered` 而強度 1 時結果裡沒有契約；強度 2 有。
- 規則表 `readers` 寫了某個勢力讀 `sink`：那個勢力的點沒寫 `reads` 也會讀。
- `scanView` 與 `result.person` 有這三樣。`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-lock、M4-sink、M4-contract-holder（它們各自回答；都沒裝也跑得起來）。

## 完成時回報

改了哪些檔、測試結果、LIFE 3.2 節的拘留這一張用什麼代替、藏沉溺的三種手段現在各由誰報 `hide`（預期：`drugs` 的抑制劑與蝶粉、`tuning`、`abilities` 的面具：都還沒報，列成後續）。

- 總指揮補記（2026-11-25）：見 M4-followups「M4-cyberware 回報」段，CYBERWARE 第 3 節有一件雙面效應歸這一張。

- 總指揮補記（2026-11-25）：見 M4-followups「M4-cyberware 回報」段，CYBERWARE 第 3 節有一件雙面效應歸這一張。

- 總指揮補記（2026-11-25，M4-contract 回報）：掛 `scan.person` 時，契約的回答用 contract 匯出的 `scanAnswer(state, actor)`，形狀見 ADR 0019 補記。

- 總指揮補記（2026-11-25，M4-contract-holder 回報）：掛點 `scan.person` 的契約回答用 contract 的 `scanPerson`（平的形狀），不是 `scanAnswer`。
