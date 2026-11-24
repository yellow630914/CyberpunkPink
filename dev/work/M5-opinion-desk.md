# M5-opinion-desk

- 交給：cpp-feature（sonnet）
- 目標：`opinion` 接上別的功能的那一半：誰坐編輯台與編輯點；招、被動、開場三個掛點與它們的封閉清單；素材與片進牌庫；豔名在棋盤上的用處；戰役的後果；自己發起一場戰役；事件執行器多一種指示 `start`（讓事件能開輿論戰）。
- 規格出處：OPINION 第 1、2 節、4.3a、4.3b、4.3c 節、4.5 節（一般的輿論戰那一列）、第 7 節、第 8 節、第 9 節；MEDIA 4.5 節（編制在戰役層）、4.6 節（串流那一列）、4.7 節（鬧大了開一場輿論戰）；SKILL_TREES 的「補充規則」第 1、4 條（輿論戰的格、編輯點的上限）；EVENTS 2.4 節（指示）；dev/adr/0020 第五節、第十三節（`OpMove`、`OpPassive`、`OpOpen`、`Material`）、V33、V34、V40、V41；dev/work/M5-opinion.md。
- 可以改的路徑：`engine/src/features/opinion/`、`engine/src/features/director/body.ts`（只加指示 `start` 與它的檢查）、`engine/tests/features/M5-opinion-desk.test.ts`。
- 可以用的介面：上一張的狀態與入口；掛點 `media.materials`、`media.spend`；`actor.ext.paths`（只認格式）；`meterOf`（`credibility`、`fame`、`subs`）；`k.meters.define`（`standing`）；效果 `hostility`、`standing`（自己的）、`cash`；`k.conditions.test`；`k.activity.start`（指示用）；核心的檢定。
- 不可以做的事：不 import 別的功能；招與被動的效果不進 `k.effects`（它們只改戰役的狀態）；不替任何一棵技能樹寫資料（那是 M5-skill-opinion-a／b）；`start` 以外不動 director；不寫委託的那一段；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 量表 `standing`（勢力、0～100、起始 50、AI ±5；V41）。
- 掛點（這一張宣告，型別照 0020 第十三節）：
  - `opinion.moves`：`{ state, war, desk: 角色 id[] }` → `OpMove[] | void`。
  - `opinion.passives`：`{ state, war, desk }` → `OpPassive[] | void`。開戰時問一次，存在 `war.passives`（戰役中途不再問，免得中途換裝備改變規則）。
  - `opinion.open`：`{ state, topic, foe, desk }` → `OpOpen[] | void`。
  - `opinion.check`：`{ what: 'move' | 'passive' | 'open', data }` → `string[] | void`（這一張自己回答：格式的問題清單）。
- **效果的封閉清單**（`OP_EFFECTS`；招與反應的 `effects` 只能寫這些）：`voice { amount }`、`foe_voice { amount }`、`wind { amount }`、`draw { n, then_discard?: n }`、`guard { cells: 'pick' | 'all' | 格子[] | n, rounds?: n }`、`capture_extra { n, def?: n, any?: boolean }`（這回合多佔幾格；`def` 是這幾次佔領的防守加減；`any` 不必相鄰）、`def_mod { amount, scope: 'next' | 'turn' | 'war', vs?: 'empty' | 'foe', cells?: 格子[], first_each_turn?: boolean }`、`card_mod { kind: 'fuel' | 'line', amount?: n, mult?: n, cap?: n, scope: 'next' | 'turn' }`、`ep { amount, scope: 'now' | 'war' }`、`foe_pr { amount, scope: 'next' }`、`take { cells: 格子[], if: 'empty' | 'any', foe_def_zero?: boolean }`、`free_adjacency { scope: 'war' }`、`negate`（只能寫在反應裡：讓觸發它的那一步無效）、`reverse`（只能寫在反應裡：把那一次的風向反過來）、`retake`（反應：被搶走的那一格回來）、`link_voice { amount, else: { skill, dc, pass, fail } }`（在委託副本裡而且有拿到的連動時聲量 +amount；不在時擲一次）、`roll { skill, dc, pass: 效果[], fail: 效果[] }`、`mark { key }`（記一個旗標給反應看）、`out { effect }`（戰役外的效果，走 `k.effects`：例如人氣 −1、敵對值 +1；結算時一起套）。
- **修正的封閉清單**（`OP_MODS`；被動的 `mods`）：`ep`、`ep_cap`、`open_hand`、`open_voice`、`open_wind`、`fuel_first`（每回合第一張料 +n）、`fuel_first2`（前兩張）、`line_first`（每回合第一張說法多推 n）、`wind_first`（每回合第一次往你這邊推風向時多推 n）、`cred_line_at`（說法 +1 的公信力門檻改成 n）、`def_own`（對手搶你的格子防守 +n）、`def_first_empty`（每場第一次佔沒人的格子防守當作 n）、`def_cell`（`{ cell, amount, once?: boolean }`）、`draw_extra`（每回合多抽 n 再棄 n）、`foe_release`（對手發稿的聲量改成 n）、`shield`（`{ what: 'lawyer' | 'takedown' | 'mute', n }`：每場抵銷幾次）、`forged_ok`（可以把假料放進牌庫）、`free_army`（每場一次不花點的水軍，拆穿的門檻改成 n）。
- **反應的觸發點**（`OP_TRIGGERS`）：`foe.release`、`foe.deny`、`foe.counter`、`foe.mute`、`foe.lawyer`、`foe.takedown`、`foe.capture`（對手要搶你的格子的那一刻）、`foe.capture_last`（要搶你最後一格）、`cell.lost`、`turn.start`。有 `cost` 的反應從這回合沒用完的編輯點扣（玩家在自己的回合結束前決定要不要預留：`endTurn` 的輸入 `reserve`）；沒有 `cost` 的自動發動。
- `war` 多：`passives`、`moves_used`、`marks`、`out: 效果[]`（戰役外的效果先存著）、`brought: Array<{ ref, card }>`。
- 事件的指示（改 `features/director/body.ts`）：`{ kind: 'start', activity, setup }`，和 `fight`、`chain` 一樣一組最多一個、不能和 `adult_scene` 放在同一個選項；`activity` 要是登記過的活動，而且列在 `event_rule` 的 `startable`（預設 `['opinion']`）。
- 報告：`opinion.move`（用一招）；`opinion.start` 的輸入多 `desk`、`bring`。
- 匯出：`deskOptions(k, state)`（隊伍裡誰可以坐、各自的編輯點）、`bringOptions(k, state, topic)`（素材庫裡每一件進牌庫會是什麼牌、和議題的關係、不能進的原因）、`startWar(k, state, { topic | { kind, faction, people? }, foe?, desk, bring, your_start? })`、`useMove`、`movesView`、`OP_EFFECTS`、`OP_MODS`、`OP_TRIGGERS`。

## 要做的

1. **編輯台**：一到兩個人（要在隊伍裡）。每個人的編輯點照 OPINION 4.3b 讀 `actor.ext.paths`（主播、偶像：2 ＋ 階數的一半進位；名媛、掮客：捨去；其餘 2），加被動的 `ep`，上限加 `ep_cap`（每棵樹最多一個、最多 +1 由資料的檢查守，這裡只夾在基礎 +3 以內）。被動帶 `source`（`cyber`、`drug`、`gear`）的，這三種來源給的 `ep` 合計最多算 +1（0020 第十四節 D8；技能與編制給的不限）。出牌與用招由一個人付（V40）。
2. **進牌庫**：`bring` 的每一件經 `media.spend`（`how: 'deck'`）扣 1，變更併進 `opinion.start`；照 `Material.card` 與和議題的關係（拍到議題的勢力或人：全額；只有類型相同：減半進位；無關：只能當轉移焦點的燃料；`card` 是 `null` 的不能進）變成牌，數字照 V33。假料要被動裡有 `forged_ok` 才進得去；打出去擲 d20。親密類的看點 `Material` 已經加過豔名，這裡不再加。自己發起而且訂閱一萬以上時採訪 +1（V34）。
3. **公信力**：60 以上（或 `cred_line_at` 改的門檻）每張說法 +1，低於 30 −1（最少 0）；沒有人定義 `credibility` 當 50。
4. **豔名**（OPINION 4.3c）：帶子街、應援圈、夜鶯直播三格，你去佔時主角各區豔名最高的那一區每 30 點防守 −1、最多 −2、最少 0；豔名 60 以上對手的反爆料多推 1。
5. **招、被動、反應**：照封閉清單解譯；寫了清單以外的鍵，`opinion.check` 回問題（開戰時遇到沒驗過的壞資料，那一筆略過並在紀錄裡提醒，不丟錯）。每場、每回合的次數記在 `moves_used`。
6. **開場**：`opinion.open` 的每一筆加上去（格子要是沒人的才佔；手牌、聲量、風向照夾）；每一筆的 `line` 進開場的紀錄。
7. **後果**（`opinion.end`，V41）：照結果與 `side` 給目標勢力的 `standing` 與敵對值；你佔著的格子的那一組加成用效果給（`subs`、`popularity`、`cash`、`credibility`，有人註冊才給）；`war.out` 存著的戰役外效果這時一起套；議題的資料可以寫 `on_end: Record<結果, 效果[]>`（內容用）。`activity.end` 的 `result` 多 `brought`、`bribed`、`desk`。這一份走 `commitNarrated`（由介面呼叫；功能只回草稿）。
8. **自己發起**：`topic` 可以只給類型與目標勢力（從 `topic_kind` 的預設分數列組一個議題，等級照那個勢力的 `grade`）；對手沒給時找 `pr_opponent` 裡 `faction` 對得上的，沒有就用規則表的通用公關（強度照等級）。沒有委託人、沒有報酬。
9. **指示 `start`**：事件的選項寫了它，執行器把它變成 `launch`；活動沒登記或不在 `startable` 裡，內容載入時擋下。

## 驗收條件（`engine/tests/features/M5-opinion-desk.test.ts`；測試裝真的 `media`，自帶替身回答三個掛點、帶路數的角色、幾件素材與片）

- 兩筆 `source: 'gear'` 與 `source: 'cyber'` 的被動各給 `ep` +1：只多 1 點；再加一筆沒有 `source` 的 +1：一共多 2 點。
- 編輯點：主播 1、2、3 階是 3、3、4；偶像同；名媛與掮客 3 階是 3；沒有路數是 2；被動 `ep` +1 之後各多 1；兩個人各有各的池，一張 2 點的牌不能兩人各付 1。
- 進牌庫：揭弊的片（可信 7）是風向 2、花 2 點的說法；煽情的片（看點 5）是聲量 3、花 2 點的料；日常的進不了並有原因；娛樂的是燃料；只有類型相同的減半；無關的只能當燃料；每一件各少一次；開戰不成立時次數不變。
- 假料：沒有 `forged_ok` 進不了；有的話牌面 +1，固定骰子擲 6：無效、風向 −2、結算時公信力 −8。
- 公信力 60、29 對說法的加減；豔名 30、60、90 對三格的防守（最多 −2、最少 0）。
- 封閉清單：每一種效果一個最小的例子（`capture_extra` 多佔一格照付聲量；`def_mod` 只管下一次；`card_mod` 的 `mult` 加倍而且有上限；`negate` 讓對手的降流無效；`retake` 把格子拿回來；`guard` 兩格；`foe_pr` 讓對手下一回合少點；`free_adjacency`；`link_voice` 不在副本裡走檢定）。
- 反應：有 `cost` 的只有預留了編輯點才發動；每回合一次的第二次不發動。
- `opinion.check`：寫了清單以外的效果、修正、觸發點各回一條問題，句子寫出是哪個鍵。
- 開場：替身回「佔應援圈、風向 +1」→ 開場就是那樣；那一格已經有人時不佔。
- 後果：大勝、小勝、平手、敗的 `standing` 與敵對值對 V41；守方的議題加在被保護的一方；格子的加成對；`out` 的效果在結算時才套。
- 自己發起：只給類型與勢力開得起來；找不到對手用通用公關。
- 事件的指示 `start`：玩具事件選了之後開了一場輿論戰；`activity` 寫沒登記的被擋。director 既有的測試原樣全過。
- 把 `media` 拿掉：`bringOptions` 是空的、只用基本牌照樣打得完。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-opinion、M5-media-cut（片的 `card`）。和 M5-live 可以同時做。

## 完成時回報

改了哪些檔、測試結果、三張封閉清單實際的鍵（給 M5-abilities-opinion 照著接；和這裡列的不一樣的地方要寫明）、V33、V40、V41 對不上的地方。
