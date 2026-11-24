# M4-lure

- 交給：cpp-feature（sonnet）
- 目標：新功能 `lure`：流竄 AI 的蠱惑裡導演不知道的那一段——誰可以來、順著牠／拒絕／問牠是誰各自留下什麼、累計與「牠的事」。蠱惑事件本身是事件的資料，照舊由導演從範圍 `rogue_ai` 挑。
- 規格出處：EVENTS 4.8 節（「蠱惑」那一列與下面的條列；「過牆之後」「中間人的委託」不做）；LURE_EVENTS 開頭到「一、蠱惑」的共通規則（事件本身不匯入）；CORE_RULES 4.3 節「流竄 AI」的表前兩列；NPCS 8.3 節「接觸的順序」第 1 點；LEWD_SYSTEM 1.1 節用途表第一列、第 9 節每一個流竄 AI 的題材；dev/adr/0019 第六節與 P22～P24。
- 可以改的路徑：`engine/src/features/lure/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-lure.test.ts`。
- 可以用的介面：`actor.ext.tendency`（只認格式：標籤的狀態、軸的等級）；角色的 `sink`；`tagsAllowed`；`k.conditions.register`、`k.effects.register`；效果 `sink`、`tendency`、`flag`、`malware`（用登錄表跑，查不到略過）；旗標與計數器的變更；`deriveRng`；事件的資料怎麼用條件與效果看 `features/director/body.ts`（這一張的測試會自帶兩件事件，和 `directorFeature`、`eventRunFeature` 一起裝）。
- 不可以做的事：不寫任何一個流竄 AI 與事件的內容；不發觸發點（登入、進子網的一層、長休醒來都已經有人發；機率是範圍的資料）；過牆、群落、任務線、親密度是 M6；不 import 別的功能；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 內容種類 `rogue_ai`：`name`（自稱）、`tag?`（對應的傾向標籤或風格；夜后沒有）、`axis?`、`filter`（篩選的標籤，例 `ai:媽咪`）、`lore`（剛好四格：`origin`、`want`、`ties`、`home` 各一句）、`kiss?`（牠的吻是哪一筆 `malware`）。
- `state.ext.lure = Record<流竄 AI 的 id, { follow: number, refused: number, asked: number, lore: string[], last?: 時間 }>`。
- 規則 `lure_rule`（`overridable`）：`open_sink`（65：超過這個數字沒有標籤的也會來）、`clue_at`（3）、`kiss_from`（5）、`kiss_chance`（0.2）、`service_sink`（65）。
- 條件：
  - `lure_open`（`{ ai }`）：這個流竄 AI 現在可以來——牠的 `filter` 與 `tag` 都沒被關掉，而且（主角有牠的標籤，或主角的沉溺超過 `open_sink`）。
  - `lure_mode`（`{ ai, mode: 'first' | 'gated' | 'service' }`）：`first`＝主角沒有牠的標籤（這一次會得到）；`gated`＝有標籤而且沉溺不超過 `service_sink`；`service`＝有標籤而且超過。事件資料用它挑三個版本（P24）。
  - `lure_count`（`{ ai, follow_min?, follow_max? }`）。
- 效果 `lure`（`{ ai, choice: 'follow' | 'refuse' | 'ask' }`，內建的來源才收）。
- 報告：沒有自己的（都是事件結果裡的效果）。匯出：`lureOf(state)`、`lureView(k, state)`（每個找過主角的流竄 AI：順著幾次、揭開了哪幾格、有沒有牠的吻；沒找過的不列）、`candidates(k, state)`（現在 `lure_open` 成立的每一個與牠的權重，給除錯與畫面）。

## 要做的

1. 條件三個。主角藏著沉溺不影響：看的是真正的沉溺（角色身上的軌），不是 `sink_shown`。
2. 效果 `lure`：
   - `follow`：`follow` +1。主角沒有牠的標籤而牠有 `tag` 時，補一筆 `tendency` 效果（得到那個標籤）。第 `clue_at` 次時立旗標 `lure_clue:<ai>`（「一則指向粉牆的線索」：線索的內容是之後的事，旗標先立）。第 `kiss_from` 次起，牠有 `kiss` 而且效果登錄表有 `malware` 時，照 `kiss_chance` 給一筆 `{ kind: 'malware', id: kiss }`。
   - `refuse`：`refused` +1。沒有別的（成功或失敗的沉溺是事件自己寫的）。
   - `ask`：`asked` +1，照固定的順序揭開下一格還沒揭開的 `lore`（立旗標 `ai_lore:<ai>:<格>`）；四格都揭開之後再問沒有新的東西。
   - 沉溺的變化不在這個效果裡：事件的每個選項自己寫 `sink`（EVENTS 4.8 節「每個選項都寫明沉溺的變化」）。
3. 沉溺 100 以上「拒絕的選項不出現」：事件資料用條件 `sunk`（M4-sink）寫在選項上；這一張寫一條測試確認兩個功能一起裝時那個選項真的不列。
4. `candidates`：權重照 LURE_EVENTS：3 ×（1＋那一軸的等級 × 0.2），標籤是「深」再 ×1.5（P23）；這只是給畫面與測試對照，實際的抽選是導演照事件的 `weight` 與 `where`。事件資料上要寫的條件（`lure_open`、`lure_mode`）在回報裡給一個範例。
5. 回到快照（撤退、重來）時 `state.ext.lure` 跟著回去（什麼都不用做；寫一條測試）。

## 驗收條件（`engine/tests/features/M4-lure.test.ts`；測試自帶兩個流竄 AI（一個有標籤「溺愛」與 `kiss`、一個的 `filter` 被關掉）、一筆假的 `malware` 效果、兩件測試用的事件（範圍 `rogue_ai`，一件掛 `rest`、一件掛 `login`））

- `lure_open`：主角有「溺愛」時成立；沒有而且沉溺 60 不成立；沒有而且沉溺 70 成立；`filter` 被關掉的那一個永遠不成立；「溺愛」這個標籤被關掉時也不成立。
- `lure_mode`：沒有標籤、沉溺 70 是 `first`；有標籤、沉溺 30 是 `gated`；有標籤、沉溺 70 是 `service`。
- `follow`：沒有標籤的那一次之後主角有了那個標籤（和 `lewdFeature` 一起裝）；第三次之後旗標 `lure_clue:<ai>` 在；第五次把機率固定成中，假的 `malware` 被叫到、id 是 `kiss`；第四次不會。
- `ask` 四次依序揭開四格、旗標各一個；第五次沒有新的旗標。
- 和導演一起：把範圍的機率設成 1，睡一覺的報告之後那件 `rest` 的事件開了（它的 `requires` 是 `lure_open`）；選「順著牠」的選項之後 `follow` 是 1、沉溺照事件寫的加。沉溺 100、和 `sinkFeature` 一起裝時，寫了「`sunk` 不成立才列」的拒絕選項不列。
- `lureView` 只列找過主角的；`candidates` 的權重對（軸 2 級、標籤是深：3 × 1.4 × 1.5）。
- AI 給的 `lure` 效果被擋。回到快照之後 `follow` 回去。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有硬的依賴（`sink`、`malware`、`lewd` 沒裝也跑得起來，對應的那幾步略過）。排在 M4-malware、M4-sink 之後，測試才能一起裝。

## 完成時回報

改了哪些檔、測試結果、給內容作者的事件寫法範例（三個版本怎麼用 `lure_mode` 分、三個固定選項各寫哪些效果）、範圍 `rogue_ai` 要的觸發點與機率（交 M4-data-rules）。
