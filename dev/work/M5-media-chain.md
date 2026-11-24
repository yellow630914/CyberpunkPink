# M5-media-chain

- 交給：cpp-feature（sonnet）
- 目標：新功能 `media` 的前半：紀錄的索引（哪一件事有錄到）、錄影的開關、把一則紀錄轉成素材、使用次數的池子、給別的功能用的三個掛點、事件給素材的效果。剪、偽造、發布在下一張（M5-media-cut）。
- 規格出處：MEDIA 第 1 節開頭、1.1 節、第 2 節、2.1 節、第 6 節；EVENTS 2.4 節的 `footage`；DATA 第 11 節（`footage` 的樣本）；dev/adr/0020 第一節、第十三節（`Material` 的格式與掛點表）、V1～V6、D1。
- 可以改的路徑：`engine/src/features/media/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-media-chain.test.ts`。
- 可以用的介面：掛鉤 `activity.end`、`report.before`、`rewind.keep`、`game.new`；`k.stats.defineStat`／`addStatProvider`／`stat`；`k.effects.register`、`k.conditions.register`；`k.content.defineKind`；核心的狀態（`party`、`actors`、`inventory`、`location`、`time`、`reports`、`battle`）；`meterOf`（`fame`）；`ext` 變更。
- 不可以做的事：不 import 別的功能；不讀別的功能的 `state.ext`（副本、場景、事件的資訊只從 `activity.end` 的 `origin`／`result` 與報告的那一拍拿）；素材不進背包；不寫剪、偽造、發布；不加 AI 任務（標題用程式的句子）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 狀態 `state.ext.media`：`{ rec: boolean, seq: number, records: Record<id, RecordEntry>, footage: Record<id, Footage>, clips: {}, stage: StagePending | null }`。
  - `RecordEntry`：`{ id: 'rc…', at: 總分鐘, source: { kind: 'battle' | 'stage' | 'event' | 'scene' | 'live' | string; ref?: string; report?: string }, label, by: 角色 id | null, grade: 0～5, type, involves: { factions: string[]; people: string[] }, marks: string[], exclusive: boolean, retracted?: true, made?: 素材 id }`。記號的字彙：`crit`、`boss`、`celebrity`、`hq`、`live`、`lost`、`adult`、`self`。
  - `Footage`：DATA 第 11 節的欄位（`id: 'ft…'`、`from_record?`、`title`、`text`、`type`、`quality`、`authentic: 'real' | 'edited' | 'forged'`、`exclusive`、`involves`）加 `uses`（0～3）、`made_at`（總分鐘）、`origin: 'own' | 'bought' | 'stolen' | 'given' | 'staff' | 'event'`、`celebrity`、`self`、`adult`、`tags?: string[]`。
  - 類型的 id：`battle`、`scandal`、`crime`、`intimate`、`celebrity`、`daily`。
- 內容種類 `media_rule`（`overridable`，id `default`）：來源對類型的預設表、品質算式的每一項、紀錄放多久算舊（7 天）、新鮮度的兩個門檻（3 天、7 天）、使用次數（3）。預設寫在功能裡（`DEFAULT_MEDIA_RULES`）。
- 衍生數值（這個功能定義，預設 0）：`rec_grade`、`footage_quality`、`footage_cap`。義體與裝備照 0019 的被動效果在資料寫 `{ stat: 'rec_grade', amount: 等級 }`，這個功能不用管。只有核心沒有 `k.passives`（M4 還沒做完）時，才替 `rec_grade` 加一個暫代的 provider：這個人是主角、而且背包裡有帶 `rec` 欄位（1～5）的物品，取最高的（D1）。
- 掛點（這個功能宣告並回答，型別用 `declare module '../../core'`；格式照 0020 第十三節）：`media.materials`（`{ state, kinds?: ('footage' | 'clip')[] }` → `Material[]`，只列 `uses > 0` 的）、`media.spend`（`{ state, ref, how, all?: boolean }` → `{ changes, material } | { block }`）、`media.record`（`{ state, source, label, hint? }` → `Change[]`；`hint` 可以帶 `type`、`involves`、`celebrity`、`hq`、`live`、`lost`、`adult`、`self`、`exclusive`）。
- 效果 `footage`：`{ kind: 'footage', type, quality?, title?, involves?, forged?, exclusive?, origin? }`，給一段 3 次的素材。AI 的來源：一件事最多一段、品質不超過所在那一區的等級。
- 條件：`has_footage { faction?, type?, min_quality?, usable? }`、`rec_on`。
- 報告（kind `broadcast`）：`media.rec`（開關錄影）、`media.convert`。
- 匯出：`mediaView(k, state)`（紀錄的清單：能不能轉、不能轉的原因；素材庫；片）、`setRecording`、`convert`、`convertBlock`、`materialOf`、`spend`（掛點的實作，自己的下一張工單也用）。

## 要做的

1. **記一則**：
   - `activity.end` 的 `battle`、`scene`、`event`：`origin.ext.commission` 有值的併進這個階段的暫存（`stage`：累加記號、涉及的人），不出一則；其餘各出一則。戰鬥的記號從這一場的報告數（`state.battle` 的步驟對到 `state.reports` 的每一拍：我方打出 `crit`、打倒首領位階的敵人記 `boss`）。場景記 `adult`、`self`。
   - `report.before` 看到草稿有一拍 `tag: 'commission.milestone'`：照那一拍的 `data`（`id`、`stage`、`face`、`faction`、`record?`）加上暫存出一則，暫存清掉。輿論面的階段不出。
   - `media.record`：別的功能請它記（直播）。
   - 類型照 V4：`media_rule` 的來源預設，`hint.type` 或 `data.record.type` 蓋掉。
2. **有沒有錄到**（V6）：`rec` 開著、隊伍裡 `rec_grade` 最高的人大於 0、所在的地方沒有 `no_rec`（查現在的設施種類與街區的資料、地圖模板的 `no_rec`；`hint` 也可以直接說）。沒錄到的那一則照樣記，`by: null`。
3. **轉成素材**：一則一次；`by` 是 `null`、`retracted`（直播留下的例外）、已經轉過的各有原因。品質照 V5，一項一項從規則表讀；標題與說明用程式的句子（來源的 `label` 加類型）。新素材 `uses: 3`、`exclusive` 照那一則。
4. **用掉一件**（`media.spend`）：`uses` 是 0 回原因；扣 1 或扣光；回扣完之後的 `Material`。`Material` 的看點、可信、風險：素材照「沒有角度的單段片」（看點 = 品質，涉及名人 +1；可信 = 品質 × 2，偽造 −3，夾 0～10；風險 = 2 ＋ 偽造 5）；親密類的看點加主角各區豔名最高那一區的級數（每 30 點一級）；新鮮度照 `made_at`。素材的 `card` 是 `{ kind: 'fuel', value: 看點 }`。
5. **回到快照**（`rewind.keep`）：索引、素材庫、片、流水號用回去之前的；回去之前有、快照那一刻沒有的紀錄標 `retracted`（`marks` 含 `live` 的不標，改加 `lost`）。
6. `game.new`：`rec: true`、空的庫。

## 驗收條件（`engine/tests/features/M5-media-chain.test.ts`；測試自帶：一個會給 `rec_grade` 的 provider、玩具活動發 `activity.end`、假的里程碑報告）

- 副本外打完一場：多一則 `battle` 的紀錄、`by` 是錄影等級最高的人；關掉錄影再打一場：那一則 `by` 是 `null`、轉不了、原因的句子對。
- 帶 `origin.ext.commission` 的兩場戰鬥加一件事件，之後一份帶 `commission.milestone` 那一拍的報告：只多一則 `stage` 的紀錄，記號是兩場的聯集。
- 品質：照 V5 逐項對（錄影等級 I、III、V；有無 `crit`；基本功 2、3、5；超過 7 天；`footage_cap` 0、1、2 的上限 3、4、5）。
- 一則只能轉一次；轉出來的素材 `uses` 是 3、品質之後不隨時間變、新鮮度 3 天內 `new`、7 天內 `ok`、之後 `old`。
- `media.spend`：扣 1、扣光、0 次被擋；回來的變更套用之後次數才少（沒套用時狀態不變）。
- `media.materials` 不列 0 次的；`mediaView` 列（標成用完）。
- 效果 `footage`：內建的照寫；AI 的來源給兩段只收一段、品質超過區的等級被夾。
- `media.record` 帶 `live`、`hq`：那一則 `exclusive` 是 `false`、轉出來的品質 +1。
- 回到快照：快照之後記的兩則一則標 `retracted`、一則（直播的）標 `lost` 還能轉、品質少 1；快照之前轉好的素材與它被扣掉的次數都在。
- `no_rec` 的設施上記的那一則沒錄到。
- 只裝這個功能（沒有 channel、opinion、commission）主套件照樣過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有（核心現有的介面就夠）。M5-commission-opinion 之後才會真的發 `commission.milestone` 那一拍；這一張用假的報告測。

## 完成時回報

改了哪些檔、測試結果、戰鬥的記號從報告數得出來數不出來（數不出來的列出來）、V2～V6 做的時候和設計書對不上的地方。
