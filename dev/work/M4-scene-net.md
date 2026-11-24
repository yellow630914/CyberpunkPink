# M4-scene-net

- 交給：cpp-feature（sonnet）
- 目標：內海裡的成人場景（化身之間、流竄 AI 的夢）：部位來自化身、風格與曝露度來自 SKIN、感載與餘韻是真的；`deck` 補化身的身體與 SKIN 的兩個數字。
- 規格出處：LEWD_SYSTEM 3.4 節最後一條；CYBERSPACE 4.1、4.3 節、第 10 節；CHARACTER 1.1 節（現實與內海兩份外觀）；DATA 3.4 節、7.4 節；LURE_EVENTS 開頭「夢裡的場景照內海的場景算」；dev/adr/0018 第十節、dev/work/M3-plan.md 使用者裁決第 13 題；dev/adr/0019 第九節與 P41、P42。
- 可以改的路徑：`engine/src/features/scene/`、`engine/src/features/deck/`（化身、SKIN 的風格與曝露度、回答 `scene.body`）、`engine/tests/features/M4-scene-net.test.ts`。
- 可以用的介面：M4-scene-seats 的 `layer`、掛點 `scene.body`；`k.activity.active`（看 `dive`、`netrun`、`face.net` 在不在）、`k.activity.allow`；`features/deck` 的 `extOf`／`extValue`、SKIN 的內容與 `skinDraft`；條件 `at_facility`（接入點的設施種類有 `dive` 欄位）、`at_home`；`k.stats.defineStat`、`k.conditions.register`。
- 不可以做的事：`scene` 與 `deck` 不互相 import；化身的外觀不改任何數值（CYBERSPACE 4.1 節）；不做內海固定區塊的場所、樂園島的主題館；不做「對方到底是誰」的身分揭穿；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `actor.ext.deck.avatar = { gender?: 五個性別值之一, body?: Record<string, string>（外觀的詞條，原樣存）, parts: Array<'extra' | 'tail' | 'tentacle'>, saved?: Array<{ name, gender?, body?, parts }> }`。沒有這一欄的人，化身照現實的那一份（性別照角色的、沒有多的部位）。
- SKIN 的資料多讀：`style?: { tag, value }`、`exposure?`（0～3）。
- 衍生數值（`deck`）：`skin_exposure`、`skin_style_value`。條件：`skin_style`（`{ tag, min? }`）、`skin_exposure`（`{ min?, max? }`）。
- 報告：`deck.avatar`。匯出（`deck`）：`avatarOf(state, actor)`、`avatarBlock`／`avatarDraft(k, state, actor, { gender?, body?, parts?, save?, load? })`。
- 場景：`SceneSetup.layer: 'net'`；`scene.end` 的 `result` 多 `layer`。

## 要做的

1. `deck`：化身。改化身要在接入點（進行中的活動有 `dive`，或腳下的設施種類有 `dive`，或在住處）；不花錢、不花時間；戰鬥中、場景中不能改。`parts` 只收那三種；`saved` 最多存五套（暫定）。`gender` 被拿來決定內海裡的版本與篩選，不寫就是角色自己的。
2. `deck`：回答 `scene.body`（只在 `layer === 'net'`）：化身的 `parts` 對到場景的部位 `extra`、`tail`、`tentacle`；不給敏感度的修正（P42）。`cyberware` 的回答只在 `meat`（它那一邊已經照 `layer` 分；這一張寫一條測試守著兩邊不串）。
3. `deck`：`skin_exposure`、`skin_style_value` 讀穿著的那一套 SKIN；沒穿是 0。條件 `skin_style`、`skin_exposure`。
4. `scene`：`layer: 'net'` 的場景。開得起來的條件：設定明寫 `layer: 'net'`（事件的夢），或開的時候進行中的活動有 `dive`、`netrun`、`face.net`（這時沒寫 `layer` 也當成 `net`）。確認這三種活動進行中 `launch` 一段 `scene` 過得了放行；過不了就在 `scene` 這一邊用 `k.activity.allow` 補，並寫進回報。
5. `scene`：內海的差別只有四處——部位問 `scene.body` 時帶 `layer: 'net'`（現實的義體部位不算）；對象性別的篩選與版本看化身的性別（讀 `actor.ext.deck.avatar.gender`，只認格式）；技能與體位的 `needs` 照寫的條件（要 SKIN 風格的寫 `skin_style`，這是資料的事）；每一拍的 `layer` 標成 `net`。規則、數字、感載、餘韻、換檔、結算全部相同（P41）。
6. 沒有甲板、沒有橋的人開不了內海的場景（原因各一句）；夢（設定明寫 `layer: 'net'` 而且 `dream: true`）不需要甲板。
7. 網內的行程被強制結束（被定位、斷線）時場景跟著被打斷：`scene` 聽 `activity.end`，種類是 `dive`、`netrun`、`face.net` 而自己是 `net` 的場景時走打斷的流程。

## 驗收條件（`engine/tests/features/M4-scene-net.test.ts`；`dive` 用測試的替身活動）

- 改化身：在住處可以、在街上被擋；`parts: ['tail']` 存得進去、亂寫的部位被擋；存一套、載回來一樣。
- `dive` 進行中開一場沒寫 `layer` 的場景：`layer` 是 `net`；主角的部位有 `tail`、沒有測試替身的「現實義體多出來的部位」；現實的同一場反過來。
- 主角是 `female`、化身是 `male`、`male_partner` 沒關：內海裡以主角為對象的篩選看的是 `male`（測試用一個「對象是主角」的反向檢查函式或直接看 `startProblems` 回傳的摘要裡的性別）。
- 穿著一套 `style: { tag: 'maid', value: 2 }` 的 SKIN：條件 `skin_style: { tag: 'maid', min: 2 }` 成立；帶這個 `needs` 的技能在內海用得出來、沒穿時灰掉。`skin_exposure` 等於資料。
- 內海的一場結束：主角的感載歸零、餘韻留著（回到現實還在）、體悟照給、`result.layer` 是 `net`。
- 沒有甲板的人被擋；`dream: true` 的不擋。
- 替身的 `dive` 結束時進行中的內海場景被打斷並結算。
- 現有的場景與 `M3-deck` 的測試不改全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-scene-solo 之後（同一個資料夾）、M4-cyber-deck、M4-creation-body 之後（都碰 `features/deck`）。

## 完成時回報

改了哪些檔、測試結果、三種內海活動的放行是原本就過還是補的、染色（SKIN 的兩個顏色，EQUIPMENT 第 9 節）沒有做。
