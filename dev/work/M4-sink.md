# M4-sink

- 交給：cpp-feature（sonnet）
- 目標：新功能 `sink`：沉溺分段的得失、每週的自然下降與每週的事、治療（心理治療、斷線靜修）、暫時或永久的下限加減、別人看到的沉溺、100 以上的規則。
- 規格出處：CORE_RULES 4.3 節（「流竄 AI：50 過牆」那一段以後只看條件，不做）；DOWNTIME 3.2、3.3 節；CYBERWARE 第 6 節（只當背景）；NPCS 8.3 節「隱藏沉溺」；dev/adr/0019 第六節與 P17～P21。
- 可以改的路徑：`engine/src/features/sink/`（新）、`engine/src/features/index.ts`（**排在 `rosterFeature` 前面**）、`engine/src/features/rest/ops.ts`（睡一覺的報告多一筆計數器）、`engine/tests/features/M4-sink.test.ts`。
- 可以用的介面：角色的 `sink`（核心的軌）與 `sink` 效果（`features/character`；往下降一律用它，`sink_floor` 在 M4-core-passive 定義）；`k.passives.register`（來源 `sink`）；`k.stats.defineStat`；掛點 `time.passed`、`weeklyCrossings`、`dailyCrossings`；核心的計數器（`counter` 變更、`state.counters`）；報告上的 `triggers`（事件導演讀，`features/director`）；量表 `hostility` 的效果（`features/security`，查不到略過）；條件 `at_facility`；`k.conditions.register`、`k.effects.register`。
- 不可以做的事：過牆、群落、流竄 AI 的委託、溺感者的傳播不做（只留條件 `sunk`）；夥伴離隊在 `roster`（M4-followups）；抑制劑在 `drugs`；不 import 別的功能；`rest` 只加計數器那一筆；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 規則 `sink_rule`（`overridable`）：
  - `bands`：由低到高的每一段 `{ min, id, name, effects: 被動效果, weekly?: { trigger?: string, hostility?: number } }`。預設照 CORE_RULES 4.3 節的表：20 微醺（帶 `perception` 標籤的檢定 +1、帶 `resist_lure` 標籤的 −1）；40 貪歡（`afterglow_cap` +1、戰鬥修正 `load_dealt_pct` +10、定力 −1；每週觸發點 `impulse`）；60 迷醉（定力再 −1、帶 `resist_control` 標籤的 −2；每週敵對值 +1）；80 溺感邊緣（`double: true`：前面每一段裡檢定類的加減再算一次，P18）；100 溺感（`afterglow_cap` 再 +2）。同步上限的 +1 核心已經算了，這裡不重複。
  - `over_step`（25：超過 100 之後每滿這麼多 `afterglow_cap` 再 +1）、`decay`（`{ amount: 2, sleeps: 4 }`）、`watchers`（每週加敵對值的勢力 id，預設空的）、`therapy`（`counsel`：`{ amount: 5, minutes: 240, price: 1000, per_week: 1 }`；`retreat`：`{ amount: 6, days: 3 }`）、`hide_step`（20：一段是幾點）、`afterglow_carry`（`{ hours: 6, amount: 1 }`）。
- `actor.ext.sink = { floor_mods: Array<{ amount, until?, why? }>, therapy_week?: number }`。
- 衍生數值 `sink_shown`（別人看到的沉溺）：基礎是真正的沉溺；別人加負的 provider（每一段 −20）；最少 0。
- 條件 `sunk`（沉溺 100 以上；看誰照 `ctx.actor ?? 主角`）。效果 `sink_floor`（`{ amount, days? }`，內建的來源才收）：暫時或永久的下限加減。
- 設施種類多讀 `therapy?: { kind: 'counsel' | 'retreat', free?: boolean, favor?: { faction, min } }`。
- 報告：`sink.week`（每週的那一份）、`sink.therapy`。匯出：`sinkView(k, state, actor)`（現在的值、下限與組成、哪一段、得失的清單、看到的沉溺、這一週睡了幾次）、`bandOf`、`therapyBlock`／`therapyDraft`。

## 要做的

1. 分段的效果（來源 `sink`）：照真正的沉溺落在哪幾段，把每一段的 `effects` 都給（往上累加，不是只給最高的那一段）。
2. `floor_mods`：每一筆沒過期的給 `{ stat: 'sink_floor', amount }`；過期的在下一次寫的時候清掉。給下限加了正值而沉溺不到新的下限時，同一份報告補上去。
3. 每週一 06:00（`time.passed` 加 `weeklyCrossings`；一次跨好幾週各算一次、最多補三次）：主角上一週的 `sleeps:<週>` 滿 `decay.sleeps` 而且沉溺不到 100 時，沉溺 −`decay.amount`（走 `sink` 效果，下限會擋）；所在那一段有 `weekly.hostility` 時替 `watchers` 的每個勢力加敵對值；有 `weekly.trigger` 時那一份報告帶那個觸發點。沒有任何事發生就不出報告。
4. `rest`：睡一覺的那一份報告多一筆 `{ op: 'counter', key: 'sleeps:<週的編號>', delta: 1 }`（週的編號用核心算週一的那個函式；只加這一筆）。
5. 治療：心理治療要在 `therapy.kind === 'counsel'` 的設施、每週一次、花時間與錢；斷線靜修要在 `retreat` 的設施、一次過三天、不收錢（設施寫了 `favor` 時那個勢力的好感要夠，查不到好感的量表當作不夠）。沉溺 100 以上兩種都擋下（「你已經不想回去了。」）。
6. 長時間帶著餘韻（DOWNTIME 3.2 節）：`time.passed` 時主角身上有餘韻而且這一段時間裡餘韻沒有消過（用一個「餘韻從什麼時候開始帶著」的時間記在 `actor.ext.sink`，餘韻是 0 就清掉），每滿 6 小時沉溺 +1。
7. `sink_shown` 與 `sinkView`；條件 `sunk`。

## 驗收條件（`engine/tests/features/M4-sink.test.ts`）

- 沉溺 0、25、45、65、85、105、130 的人：定力的檢定修正、`afterglow_cap`、`load_dealt_pct` 各是對的數字（85 的定力是 −4；105 的 `afterglow_cap` 是基礎 +3；130 是 +4）。
- 每週：上一週睡了四次的人週一沉溺 −2；睡三次的不降；下限是 10、沉溺 11 的人只降到 10；沉溺 100 的不降。65 的人週一那份報告替規則表列的兩個假勢力各 +1；45 的人那份報告帶觸發點 `impulse`。一次跨三週補三次。
- 睡一覺之後計數器多 1（和 `restFeature` 一起裝）。
- 效果 `sink_floor`：`{ amount: 5, days: 7 }` 讓下限 +5、沉溺不到的補上；七天後下限回來、沉溺留著。永久的那一種一直在。AI 給的被擋。
- 心理治療：扣 1,000、時間 +4 小時、沉溺 −5；同一週第二次被擋；沉溺 100 被擋。靜修：過三天、−6。
- `sink_shown`：測試加一個 −20 的 provider，真正 65 的人看到的是 45，分段的效果還是照 65。
- 帶著一層餘韻過 13 小時：沉溺 +2；中間餘韻消過的重新算。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；`M2-rest` 的測試不改全過。

## 依賴

M4-core-passive。和 M4-followups 不要同時做（都碰 `features/rest`）。

## 完成時回報

改了哪些檔、測試結果、分段表裡沒有做的（聽得懂遺魂、深海溫和、自由行動時 AI 把衝動寫進結果、清明的人怕你）、檢定的標籤 `perception`、`resist_lure`、`resist_control` 現在有哪些檢定真的帶著。
