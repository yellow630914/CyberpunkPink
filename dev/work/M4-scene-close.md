# M4-scene-close

- 交給：cpp-feature（sonnet）
- 目標：成人場景的結算補齊：沉溺的規則退路、橋參數那一點落在哪一項、傾向照這一場碰到的加、性經歷補欄位、「難忘」讓標籤變深；`sceneEnd` 收 AI 收尾任務的結果。
- 規格出處：LEWD_SYSTEM 3.4 節、3.5 節第六點、1.1 節「怎麼長」；CORE_RULES 4.3 節「親密關係怎麼影響沉溺」；AI_TASKS 3.7、3.8 節、4.2 節（`sex_record`、`sink`、`tendency` 三列的驗證與退路）；DATA 第 8 節的 `sex_record`；dev/adr/0016 G11；dev/adr/0019 第九節與 P43、P44；dev/invariants.md 第 33 條。
- 可以改的路徑：`engine/src/features/scene/`（主要是 `end.ts`）、`engine/tests/features/M4-scene-close.test.ts`、`dev/invariants.md` 不改（核心的事；要改的寫在回報）。
- 可以用的介面：現有的 `endDraft`（`end.ts`）、`ratingOf`、`recordScene`；效果 `sink`（往下一定走它）、`bridge`、`tendency`、`affinity`（沒有人註冊的略過，現有的做法）；量表 `affinity`（讀親密度：`meterOf`）；`SceneEnv`。
- 不可以做的事：不呼叫 AI（外殼把結果放進 `env.closing`）；不改評價表與體悟的數字；多人每一對的結算在 M4-scene-circles 已經做了，這一張不重做；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `SceneEnv.closing?`：`{ sink?: { kind: 'anchor' | 'trade' | 'forced' | 'other', amount: number }, tendency?: string[], sex_record?: Array<{ with: string, note?: string, kind?: string }>, relate?: Record<對象的 id, number> }`。
- `actor.ext.sex_record` 多：`kinds: Record<性質, 次數>`、`favorite?: 角色的 id`、`notes?: Record<對象的 id, 一句話>`（最多留 20 筆）。
- 規則 `scene_rule` 多：`sink`（`{ anchor: -2, forced: 2, anchor_affinity: 60 }`）、`deep_chance`（0.25）、`tendency_per_axis`（1）、`relate_range`（每一級評價允許的親密度範圍：`poor` [−2, 0]、`fair` [0, 3]、`fit` [3, 6]、`unforgettable` [6, 10]）。
- `scene.end` 的 `result` 多：`sink`（實際的變化）、`touched`（這一場碰到的標籤）、`bridge_gain?`（哪一項）。

## 要做的

1. 沉溺（P43）：沒有 `env.closing.sink` 時照退路——性質是兩情相悅而且主角對（平均的）對象親密度 60 以上：−2；交易、工作、契約：0；被迫：+2；俘虜與其餘：0；單人：0。有的話用它的 `amount`，但 `kind: 'forced'` 只在這一場的性質是被迫時才收（否則當 `other`、照退路）。再加上全檔過載累積的那一份，**合計夾在 −4～+4**；往下走 `sink` 效果（下限會擋）。
2. 橋參數（P44）：機率照現有的評價表。落在哪一項：這一場主角開過深檔以上是敏感度；主角高潮兩次以上是耐受；性質是工作或契約而且主角的迎合次數多於主導是馴化；其餘是慾求。前面的條件優先。一場最多一項 +1（現有的 `bridge` 效果會夾）。
3. 傾向：這一場碰到的標籤＝設定的 `tags`、用過的技能與道具的標籤、進過的體位的標籤、開場時穿著的風格（條件 `style`／`skin_style` 查得到的那幾個由呼叫的人放進 `setup.tags`，這一張不自己查）。沒有 `env.closing.tendency` 時全部記；有的話只收是這份清單子集的。每條軸最多記 `tendency_per_axis` 個（照碰到的順序），各發一筆 `tendency` 效果。
4. 「難忘」：評價是最高那一級時，碰到的標籤裡主角已經是「有」的，照 `deep_chance` 挑一個變成「深」（`tendency` 效果帶 `to: 'deep'`，內建的來源）；一場最多一個。
5. 性經歷：每一對各記一筆（已有），補上這一場性質的 `kinds` 次數；`favorite` 重新算（次數最多的那個人，一樣多取主角對他親密度高的；量表查不到就只看次數）；`env.closing.sex_record` 給的那一句話存進 `notes`（對象要是這一場在場的人，其餘丟掉）。
6. 關係：有 `env.closing.relate` 時用它的數字、夾在那一級評價的 `relate_range` 裡；沒有就照現有的固定值。
7. 夾住的每一處都留一筆提醒（照效果登錄表現有的 `ClampNote` 做法），讓外殼的任務鏈列看得到。

## 驗收條件（`engine/tests/features/M4-scene-close.test.ts`）

- 沉溺：兩情相悅、親密度 70：−2（主角沉溺 1 時只降到 0；`sink_floor` 是 5、沉溺 5 時不降）；交易 0；被迫 +2；`env.closing.sink` 給 +9 只算 +4；給 `forced` 而這一場是交易的照退路；全檔過載兩次加上被迫的 +2 合計還是 +4。
- 橋參數（把機率固定成一定中）：開過深檔的是敏感度；高潮兩次的是耐受；工作而且迎合多的是馴化；其餘慾求；一場只有一項。
- 傾向：碰到同一條軸的三個標籤只記一個；`env.closing.tendency` 給了一個沒碰到的被丟掉；被篩選關掉的不記。
- 難忘而且主角有那個標籤（機率固定成中）：它變成「深」；不是難忘的不會。
- 性經歷：`kinds.trade` +1；兩個對象各一筆；`favorite` 是次數多的那個；`notes` 只收在場的人。
- `env.closing.relate` 給 +20、評價是合拍：只加 6。
- 不給 `env.closing` 時，除了沉溺改照退路之外，現有的結算測試（`M2-scene`）只需要改沉溺那幾個期望值；改了哪幾條寫在回報。`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-scene-net 之後（同一個資料夾）。做完才能開 M4-core-scene-ai。

## 完成時回報

改了哪些檔、測試結果、因為行為改變而改了既有測試的地方（逐條）、dev/invariants.md 第 33 條現在在哪裡驗。
