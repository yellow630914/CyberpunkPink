# M5-live

- 交給：cpp-feature（sonnet）
- 目標：新功能 `live`：直播的容器（熱度、目標、亮點、收播結算）與**活動直播**——掛在進行中的戰鬥、成人場景或委託副本上，宿主結束就收播；直播不回退。時段直播在下一張（M5-live-slot）。
- 規格出處：MEDIA 1.2 節（全部）、第 3 節「副本裡的直播不回退」、第 6 節；DATA 9.2 節（直播目標）、第 11 節（`stream_template`）；COMMISSIONS 2.3 節（直播中不能選潛行、「直播目標」欄位）；UI 6.3 節（面板要什麼）；dev/adr/0020 第三節、第十三節、P21～P26、D3；dev/work/M5-core-seams.md（`deny`）。
- 可以改的路徑：`engine/src/features/live/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-live.test.ts`。
- 可以用的介面：`k.activity.define`（`deny`）、`k.activity.allow`、`k.activity.active`；掛鉤 `report.before`、`activity.end`、`rewind.keep`、`game.new`；核心的 `endActivity`（發 `activity.end`）；掛點 `media.record`；`meterOf`（`subs`、`fame`、`affinity`）；效果 `subs`、`cred`、`hostility`（先問有沒有人註冊）；條件 `channel_open`（先看有沒有人註冊）；衍生數值 `live_goal_extra`、`live_record_quality`（這一張定義，預設 0）與 `exposure`（只讀，先問 `hasStat`）；`state.battle`、`state.reports`、`state.rng.seed`。
- 不可以做的事：不 import 別的功能；不讀副本、場景的 `state.ext`（宿主的資訊只從 `k.activity.active`、`state.battle`、報告的 `action` 與那一拍的 `data` 拿）；不給戰鬥任何加成；彈幕不做（畫面的事）；「增援來得快」不做（P23）；不寫時段直播；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 狀態 `state.ext.live`：`{ session: Session | null, seq: number, log: Settled[] }`。
  - `Session`：`{ id: 'lv…', mode: 'activity' | 'slot', template, host?: { kind: 'battle' | 'scene' | 'commission', id: string }, by: 角色 id, where: 位置, heat, goals: Array<{ id, text, heat, tip, done: boolean }>, highlights: Array<{ event, heat, report: string }>, counts: Record<event, number>, tips: number, secret?: true, house?: House, faction?: string, grade?: number }`。
  - `Settled`（收播的結果，最近二十筆）：`{ id, at, mode, template, heat, subs, tips, goals_done, record?: true, lost?: true }`。
- 內容種類 `stream_template`（`overridable`）：`{ id, name, scope: 'combat' | 'commission' | 'adult', highlights: Array<{ event, heat }>, max_from?: Record<event, number>, goals: { pick: [最少, 最多] } | 'host', risk?: { hostility_mult?: number }, blocks?: string[], start_heat?: 'fame_tier' }`。預設三筆照 MEDIA 1.2 的表（`st_combat`、`st_commission`、`st_adult`）。
- 內容種類 `stream_goal`（內容，不匯入；格式照 DATA 9.2）：`{ id, text, scope: string[], check: { event, count_min?, count_max? }, heat, tip_per_grade, channel? }`。
- 內容種類 `live_rule`（`overridable`）：每條目標的熱度（3）、每點熱度的訂閱與打賞（6、8）、觀看數的式子（5%、最少 20、0.1、熱度算到 20）、級距（1.5、2.5）、成人直播每場行動的上限（10）、同意的親密度（60）。
- **事件的名字**（模板與目標的 `event`；封閉清單，從報告的 `action` 與每一拍的標籤對出來）：`crit`（我方打出要害）、`overload_foe`、`foe_down`（打倒或制伏敵人）、`ally_down`、`battle_won`、`battle_lost`、`stage_done`（`commission.milestone`）、`branch`（`commission.branch`）、`scene_act`（`scene.act`）、`scene_end`。對不出來的（例：「只剩一口氣」）回報，不硬做。
- 活動 `live`（order 40）：`session` 存在就是進行中；`deny: ['undo']`；活動直播時 `allows` 全放行。往 `battle`、`defeat`、`scene`、`event`、`commission`、`face.net`、`netrun`、`opinion`、`face.opinion` 的放行清單各加 `commit:live.`（那個活動沒有人登記就跳過）。
- 效果：這一張不註冊（`heat`、`highlight` 在下一張）。條件：`live_on { mode? }`。
- 報告（kind `broadcast`）：`live.go`（開播）、`live.cut`（提早收播）。收播不出自己的報告：結算併在宿主結束的那一份裡（`activity.end` 回的變更與句子），裡面有一拍 `tag: 'live.end'`。
- 匯出：`livePreview(k, state)`（現在能不能開、原因、哪個模板、目標、風險的句子）、`goLive`、`cutLive`、`liveView(k, state)`（模式、熱度、觀看數與級距、目標與達成、亮點、打賞、風險）、`viewersOf`。

## 要做的

1. **能不能開**（P21）：要開著頻道（有人註冊 `channel_open` 才問）；沒有別的直播在播；有一個「還沒做第一步」的宿主——戰鬥：`state.battle` 在第一輪、除了開打那一步沒有別的步驟；副本與場景：`k.activity.active` 列著它，而且最近一份 `commission.` 或 `scene.` 開頭的報告是 `commission.enter` 或 `scene.start`。同時有副本與戰鬥時宿主是副本（P22）。所在的地方有 `no_rec` 開不了。
2. **目標**：戰鬥與成人照模板的 `pick` 從 `stream_goal` 裡 `scope` 對得上的抽（固定亂數：存檔種子＋宿主的 id；`live_goal_extra` 大於 0 時多抽那麼多個、玩家在 `goLive` 的輸入挑掉同樣多個）；副本用 `commission.enter` 那一拍 `data.stream_goals` 列的 id。`livePreview` 與 `goLive` 抽到的一樣。
3. **起始熱度**：成人模板是主角各區豔名最高那一區的級數，`exposure` 有人定義時每 2 級再 +1；其餘是 0。成人直播的同意照 P24（讀對象的親密度；對象從 `scene.start` 那一拍的 `data` 拿，拿不到當作沒同意並回報）。
4. **亮點**：`report.before` 看每一份草稿，對出事件、照模板加熱度（`max_from` 夾每一種的上限）、記進 `counts` 與 `highlights`，變更接在那一份後面。副本直播期間只照副本的模板算。
5. **敵對值 ×1.5**：模板有 `risk.hostility_mult` 時，同一份草稿裡加在勢力敵對值上的正數，補一筆多出來的五成（進位）。
6. **收播**：宿主的 `activity.end`（種類與 id 對得上）→ 目標逐條照 `counts` 檢查，每條 +熱度與打賞（`tip_per_grade` × 等級）→ 訂閱與打賞照 P25 → 請 media 記一則（`media.record`：`live`、`hq`、宿主輸了帶 `lost`；`live_record_quality` 加在 `hint`）→ 發 `activity.end`（種類 `live`，`result`：`mode`、`template`、`heat`、`viewers`、`subs`、`tips`、`goals_done`、`to_channel`、`host`）→ 記進 `log`、清掉 `session`。`cutLive` 是同一套，出自己的一份報告。
7. **不回退**（`rewind.keep`）：回去之前的 `log` 裡有、快照那一刻沒有的每一筆，把訂閱與打賞的效果、那一則紀錄補回去（各一次）；回去之前還在播的那一場，當場照上面的方式收播（標 `lost`）再補。
8. `house`（內場、迷宮館）只留欄位與結算時的三個參數（觀看數的倍率、打賞的倍率、`to_channel`），第三波才有人給。

## 驗收條件（`engine/tests/features/M5-live.test.ts`；測試用 `makeBattleGame` 的戰鬥、玩具的 `commission` 與 `scene` 活動（照命名發報告）、替身的 `media.record`、自帶五條目標）

- 戰鬥第一輪沒有人動過可以開；有人行動之後開不了，原因的句子對。副本剛進去可以開、選了面之後不行。
- `livePreview` 的目標和 `goLive` 之後的一樣；同一個種子同一場永遠抽到同一組。
- 我方的要害、敵人過載、打倒敵人各 +1；敵人的要害不加；熱度寫在同一份報告的變更裡（回退一步熱度跟著退）。
- 直播中 `Game.undoBlock()` 有原因、`undoSteps` 不動；收播之後可以。
- 戰鬥直播中勢力敵對值 +4 的那一份報告實際是 +6；沒在直播時是 +4。
- 打贏收播：達成「打出兩次要害」+3 熱度與打賞；訂閱 = 熱度 × 6 ＋ 觀看數 ÷ 400；`media.record` 被呼叫一次、帶 `live` 與 `hq`；`activity.end` 種類 `live` 發一次。
- 觀看數：訂閱 100、1,000、10,000 與熱度 0、10、20、25 對 MEDIA 1.2 的式子與三個級距。
- 副本直播：里程碑、分支、戰鬥的結果各 +1；裡面那場戰鬥的要害不另外加；目標是 `stream_goals` 寫的那幾條。
- 副本直播到一半撤退（回到 `entry` 的快照）：訂閱與打賞留著、紀錄一則標 `lost`、`session` 清掉；再做一次撤退不會多算一次。
- 戰鬥直播打輸、選「重來這一場」：上一場的直播已經結算一次，重來的那一場可以再開一場新的。
- 成人模板：起始熱度是豔名的級數；每個行動 +1、最多 +10；對象親密度不到 60 時 `secret` 是 `true`。
- 條件 `live_on` 在直播中成立。把 `media`、`channel` 都拿掉：照樣開得了、收播只有打賞。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-core-seams（`deny`）、M5-media-chain（`media.record`）。M5-commission-opinion 之後副本才真的帶 `stream_goals` 與里程碑那一拍；這一張用玩具活動測。

## 完成時回報

改了哪些檔、測試結果、**事件對不對得出來**（哪幾種現在的標籤與 `action` 不夠，要哪個功能多帶什麼）、`scene.start` 那一拍有沒有對象的 id、P21～P26 對不上的地方。
