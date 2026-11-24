# M5-opinion

- 交給：cpp-feature（sonnet）
- 目標：新功能 `opinion` 的本體：一場輿論戰的棋盤、回合、牌、佔領、對手、城市事件、四級結果，做成活動 `opinion`。這一張只用基本牌與「任何人」的兩點編輯點；誰坐編輯台、技能、素材進牌庫、後果在下一張（M5-opinion-desk），委託的那一段在 M5-opinion-face。
- 規格出處：OPINION 第 3 節（全部）、4.1、4.2、4.3 節（牌的三種與手段的四張）、4.4 節、5.1 節（議題的類型與四級結果）、5.2 節（對手的行動表與性格表）、5.3 節；DATA 6.3 節（`pr_opponent` 的格式）、9.1 節的 `topic`；ENEMIES 1.5 節裡輿論對手那一段（等級對發稿、否認、反爆料的加成）；UI 6.1 節（畫面要什麼）；dev/adr/0020 第五節、V31～V34、V39。
- 可以改的路徑：`engine/src/features/opinion/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M5-opinion.test.ts`。
- 可以用的介面：`k.activity.define`、核心的 `endActivity`；`k.content.defineKind`；核心的亂數（照種子、游標、用途導出骰子；每擲一次推進游標）；`snapshot.take`（下一張與 face 用）；`ext` 變更；`meterOf`。
- 不可以做的事：不 import 別的功能；不用戰鬥引擎（它不是站位戰鬥）；格子除了分數沒有別的效果（OPINION 3.2）；不加「新鮮度」「曝險」這類戰役內的數字；對手不抽牌；不加 AI 任務（對手照性格表走）；議題與對手的名單不匯入；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 格子的 id（V31）：`doujin`、`tape`、`fanclub`（圈子一排）、`sakura`、`kaleido`、`nightingale`（主流）、`wall`、`whisper`、`relay`（街頭）。`murmur` 是 `whisper` 的別名（載入時轉並提醒）。相鄰是上下左右。對面：`wall`↔`fanclub`、`whisper`↔`tape`、`relay`↔`doujin`。
- 內容種類：
  - `opinion_rule`（`overridable`，id `default`）：回合數（6、短的 4）、開場手牌（3）、每回合抽幾張（2）、手牌上限（5）、基礎編輯點（2）、沒人的格子防守（2）、對手的格子防守的底（3）、聲量與風向的範圍（0～10、−5～+5）、大勝的分數差（4）、戰役等級對料牌與對手行動的加成、水軍與假料拆穿的門檻與反噬（V33）、對手一回合最多掃幾輪（3）。
  - `topic_kind`（`overridable`）：五種（`ignite` 引爆、`smear` 抹黑、`douse` 滅火、`whitewash` 洗白、`frame` 嫁禍），各自的開場（誰佔哪裡、風向）、怎樣算贏、`side: 'attack' | 'defend'`；另外四列預設的分數（OPINION 3.2 的表）。
  - `topic`（內容；格式照 DATA 9.1 的 `topic`）：`{ id, name, kind, rounds, scores: Record<格子, 0～3>, involves: { factions, people, types }, grade?, target_cell?, your_start? }`。活動的 `setup` 可以給 id 或整筆。
  - `pr_opponent`（內容；DATA 6.3）：`{ id, name, faction?, strength, start: 'opposite' | 'center', cell_priority, actions: Array<{ do, when }>, signature?, once?: Array<{ do: 'bribe' | 'visit', when, … }>, mimic?: { open: [最少, 最多] }, capture?: boolean }`。
  - `pr_action`（`overridable`）：對手的行動表九筆（`release` 發稿、`deny` 否認、`mute` 降流、`counter` 反爆料、`lawyer` 律師函、`takedown` 下架、`chase` 追擊、`bribe` 收買、`visit` 找上門），各自的花費、效果、強度條件、每回合或每場幾次。
  - `opinion_card`（`overridable` 的那一半是基本牌）：`{ id, name, kind: 'fuel' | 'line' | 'means', cost, voice?, wind?, means?: 'guard' | 'mute' | 'army' | 'shift', basic?: 張數, inside?: boolean }`。預設基本牌九張（V34）加 `card_inside_scoop`（內幕：料 +4、不能被下架）。
  - `city_card`（`overridable`）：六張（V34），每張 `{ id, name, effect }`，效果是封閉的幾種（雙方聲量、某一排防守、某格或某排這回合不能被佔、某格這一場分數 +1、沒事）。
- 狀態 `state.ext.opinion.war`：`{ id, mode: 'solo' | 'face', topic, foe, grade, round, rounds, turn: 'you' | 'ended', cells: Record<格子, { owner: 'you' | 'foe' | null, guard?: 到第幾回合 }>, voice: { you, foe }, wind, desk: Array<{ actor, ep, ep_max }>, deck, hand, discard, captured: 這回合佔了幾次, captures: 這回合能佔幾次, used: Record<string, number>, city?: id, foe_state: { bribes, visited, ep_penalty? }, pending?: 'bribe' | 'lost', origin, result? }`。
- 活動 `opinion`（order 50）：`setup: { topic, foe, strength?, grade?, desk?, your_start?, rounds? }`；放行 `commit:opinion.`；原因：「輿論戰進行中，要先打完（或認輸）。」
- 報告（kind `broadcast`）：`opinion.start`、`opinion.play`（出一張牌）、`opinion.capture`、`opinion.turn`（結束回合；對手的整個回合與下一回合的城市事件、抽牌都在這一份的 `timeline`）、`opinion.concede`（認輸）、`opinion.end`（結算；發 `activity.end`）。
- 匯出：`opinionView(k, state)`（九格：名字、分數、誰的、搶下來要多少聲量、能不能佔與原因；雙方的分數、聲量、風向、編輯點；手牌每一張能不能出與原因；回合；對手與它上一步；城市事件；結果）、`playCard`、`capture`、`endTurn`、`concede`、`defenseOf`、`scoreOf`、`parseWhen`。

## 要做的

1. **開場**：照議題的類型放格子（V32）、聲量 0、風向 0（洗白 −3）；對手照 `start`；牌庫是基本牌，洗牌、抽三張。
2. **玩家的回合**：回合開始翻一張城市事件、抽兩張（上限 5；牌庫抽完把棄牌洗回去）、編輯點回到上限（不累積；上一回合被寄律師函的少 1）。出牌花編輯點：料加聲量（照戰役等級加）、說法推風向、手段四種（設防：選自己的一格到下回合前不能被搶；降流；水軍：聲量 +3 並擲 d20；轉移焦點）。佔領一次：相鄰、聲量 ≥ 防守、扣掉防守。先後由玩家決定（V32）。
3. **防守**：沒人的 2；你搶對手的 3 − 風向（最少 0）；對手搶你的 3 ＋ 風向（最少 0）；設防的不能搶；城市事件的加減。
4. **對手的回合**（併在 `opinion.turn`）：公關點 = 強度 × 2；照 `actions` 由上往下掃（V39 的文法與規則）；招牌招式是資料的 `signature.effect`（封閉的幾種：某個行動的花費、律師函多扣幾點、你公信力低於多少時說法減半、某幾格它搶的時候防守 −1、收買可以兩次）；`mimic` 的對手每回合照固定亂數從行動表開放三到四種。佔領照權重。`bribe` 與 `visit` 這一張只做到「條件成立時在狀態裡記 `pending` 並停下來」：收買的回應（`opinion.bribe`）與找上門的結算在 M5-opinion-face；這一張的 `solo` 模式遇到 `visit` 先當作沒有這個行動、`bribe` 給接受與拒絕兩個選擇（接受：戰役結束算敗；錢與公信力在下一張接）。
5. **結束**：一方的格子被清空立刻結束；最後一回合對手動完結算。分數 = 自己格子的分數合計；四級結果（OPINION 5.1）；嫁禍另外要佔著指定的那一格。`opinion.end` 的 `activity.end`：`outcome` 是 `major`、`minor`、`draw`、`lost`，`result` 帶 `topic`、`kind`、`side`、`you`、`foe`、`cells`、`rounds`、`grade`、`faction`。
6. **亂數**：洗牌、城市事件、水軍、`mimic`、對手同分時挑哪一格，都用核心的亂數並推進游標；同一個種子、同樣的操作，整場逐份報告相同。

## 驗收條件（`engine/tests/features/M5-opinion.test.ts`；測試自帶一個議題、三個對手（強度 1、強度 3 帶追擊、`center` 開場的）、玩具的寫法把牌塞進手上）

- 相鄰：九格的鄰居逐一對；不相鄰的佔不了，原因的句子對。
- 防守：風向 −2、0、+3 時你搶對手、對手搶你的防守各對；最少 0；佔下來聲量扣掉防守；聲量不夠被擋。
- 聲量夾 0～10、風向夾 −5～+5；編輯點不累積；手牌上限 5；牌庫抽完洗回來。
- 設防的格子對手那一回合搶不了，下一回合可以。
- 水軍：固定骰子擲 5 以下風向 −1；擲 6 沒事。
- 對手：強度 1、2、3 的公關點是 2、4、6；`when` 的每一種寫法各有一個成立與不成立的例子；寫壞的字串在內容載入時被擋並指出是哪一筆；追擊只有強度 3；律師函讓你下一回合少 1 點。
- 萬華鏡式的對手從正中央開場；一般的在你的對面。
- 清空立刻結束；六回合打完照分數差給四級；嫁禍沒佔指定格只算平手以下（照設計：分數高但沒佔著算沒贏）。
- 五種議題的開場各對（滅火你佔兩格、洗白對手佔三格風向 −3）。
- 城市事件六張各自的效果只在那一回合（偶像的畢業公演那一張是整場）。
- `murmur` 當別名收、有提醒。
- 同一個種子打兩次，報告逐份相同；打到一半存檔讀回來接著打，結果和沒有中斷的一樣。
- 進行中走路、休息被擋；`concede` 之後可以。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有。和 M5-channel-shows 可以同時做。

## 完成時回報

改了哪些檔、測試結果、OPINION 5.2 性格表裡哪幾個對手用現在的 `actions`＋`signature` 寫得出來、哪幾個寫不出來（差什麼鍵）、V32、V34、V39 對不上的地方。
