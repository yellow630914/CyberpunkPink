# M5-opinion-face

- 交給：cpp-feature（sonnet）
- 目標：`opinion` 的第三塊：活動 `face.opinion`（委託副本開的那一段）——照副本給的開場表開戰、把結果交回；決定性的一場沒贏時的三選一；收買；找上門（數值結算）；外包給 NPC 記者。
- 規格出處：OPINION 4.5 節、5.1 節、5.2 節（收買、找上門兩列）、第 6 節（全部）、第 7 節（「沒有人」那一列）；COMMISSIONS 2.3 節（輿論面在一個階段裡玩什麼）、第 5 節（連動表裡和輿論有關的列）；DATA 9.1 節（`opinion_setup`）；COMMISSION_TEMPLATES「opinion_setup 的骨架」；COMBAT_SYSTEM 8.4 節（三選一的三個選項是什麼）；dev/adr/0020 第六節、V35～V38；dev/adr/0016 第一、二節（`launch`、`rewind`、`snapshot.take`）；dev/work/M5-opinion.md、M5-opinion-desk.md。
- 可以改的路徑：`engine/src/features/opinion/`、`engine/tests/features/M5-opinion-face.test.ts`。
- 可以用的介面：前兩張的全部；`k.activity.define`、`k.activity.allow('commission', …)`；`snapshot.take`（種類 `opinion`，`replace`）、報告的 `rewind`、掛鉤 `rewind.keep`；`state.party`、`actor.skills`、`actor.ext.paths`；效果 `cash`、`credibility`、`favor`；條件 `live_on`（先看有沒有人註冊）；`k.battle` 不用。
- 不可以做的事：不 import `features/commission`、`features/fixer`、`features/defeat`；不讀副本的 `state.ext`（要的東西都在 `setup`）；找上門不切到戰鬥（V35）；不自己處理「委託失敗」（交回 `lost`，副本接）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 活動 `face.opinion`（order 50；和 `opinion` 同一份狀態，`war.mode: 'face'`）。`setup`（副本給的，0020 第六節）：`commission`、`stage`、`face`、`branch`、`branch_kind`、`grade`、`faction`、`links: string[]`、`route`、`decisive`、`where`、`opinion: { topic, opponent: { id, strength?, named? }, base?: { voice?, wind?, cells? }, from_links?: Array<{ link, add_card?, voice?, wind?, cells?, opponent_pr_first_round? }>, rounds? }`、`open?`（這條分支的開場加減）、`desk?`、`bring?`。
- 這個功能自己往 `commission` 的放行清單加 `face.opinion.start` 與 `commit:opinion.`（副本沒裝就跳過）。
- `war` 多：`face: { commission, stage, decisive }`、`pending: 'bribe' | 'visit' | 'lost' | undefined`、`visit?: { roll, dc, held: boolean }`。
- `opinion_rule` 多：找上門的 DC（12 ＋ 強度 × 2）、擋住時直播中多的那張料（+4）、收買的公信力（−5）與委託人的好感（−5）、外包的 DC（10 ＋ 強度 × 3）與分量修正（媒體型 +4、社交型 +2）。
- 報告：`opinion.bribe`（回應收買：接受或拒絕）、`opinion.visit`（找上門的結算，沒有選擇）、`opinion.retry`（重來這一場：帶 `rewind: { kind: 'opinion' }`）、`opinion.back`（回到這個階段開始：帶 `rewind: { kind: 'stage' }`）、`opinion.accept`（接受結果）、`opinion.outsource`（外包：不開棋盤直接出結果）。
- 匯出：`faceStartPreview(k, state, setup)`（開場會是什麼：每一個拿到的連動換成什麼）、`answerBribe`、`resolveVisit`、`retryWar`、`backToStage`、`acceptLoss`、`outsource`、`outsourceChance`。

## 要做的

1. **開場**：`opinion.base` 加上每一個「`setup.links` 裡有」的 `from_links`（加一張牌：`add_card` 是 `opinion_card` 的 id；聲量；風向；多佔的格子；對手第一回合的公關點），再加分支的 `open`，最後才是 `opinion.open` 掛點的回答。`rounds` 沒寫：`decisive` 是 6、否則 4。誰坐編輯台與帶哪些料由 `setup.desk`、`setup.bring` 給（介面在選分支之前先問好；沒給就是主角一個人、不帶料）。開戰那一份的第一筆變更是 `snapshot.take`（種類 `opinion`、`replace`、`owner` 是委託的 id）。
2. **收買**（`pending: 'bribe'`，V36）：對手用了收買，戰役停在等玩家回應。拒絕：照常往下。接受：錢進帳（對手資料的 `offer_per_grade` × 等級；第二次 ×1.5）、公信力 −5、戰役結束算敗、`result.bribed` 是金額；在委託裡另外委託人的好感 −5（`setup` 有 `employer` 時）。這一張也把 `solo` 模式的收買補完整（錢與公信力）。
3. **找上門**（V35）：對手的 `once` 條件成立（預設落後 4 分以上；資料可以寫 2）而且這一場還沒用過：d20 ＋ 留守的人（隊伍裡沒坐編輯台的）最高的戰鬥基本功（槍械、格鬥）＋（留守的人數 − 1）對 DC；沒有人留守直接擋不住。擋住：照常；這一場正在直播（條件 `live_on` 成立）時牌庫多一張「找上門的直播」（料 +4）。擋不住：對手資料 `capture: true` 的，戰役立刻結束算敗、`result.captured: true`；其餘你下一回合不能行動（編輯點 0、不能佔領）。`solo` 模式同一套。
4. **交回**：
   - 不是決定性的：結束時直接發 `activity.end`（`outcome` 四種之一）。
   - 決定性的而且小勝以上：同上。
   - 決定性的而且平手或敗（V37）：不發 `activity.end`，`war.pending = 'lost'`，等三選一——`retryWar`（回到種類 `opinion` 的快照：帶進牌庫的料扣掉的次數跟著回去，重來時骰子不保證一樣，照 0017 的 `fresh`）、`backToStage`（回到 `stage` 的快照）、`acceptLoss`（這時才發 `activity.end`，`outcome: 'lost'`）。
   - 收買被接受、被帶走：直接發 `lost`，沒有三選一。
   - `result` 多 `decisive`、`bribed?`、`captured?`、`stage`、`commission`。
5. **收買的錢與公信力不回去**（`rewind.keep`）：回去之前的狀態裡這一場是 `bribed` 的，就把那筆錢、公信力與好感的變更套在回去之後的狀態上，各一次。
6. **外包**（OPINION 第 7 節）：選了輿論面但不想自己打時，指定名冊上一個不在隊伍裡的人：d20 ＋ 他表演、調查、交涉裡最高的 ＋ 分量修正對 DC：超過 5 以上大勝、成功小勝、差不到 5 平手、其餘敗；不開棋盤，直接照上面的方式交回（決定性的沒贏一樣給三選一，「重來」等於再擲一次但骰子換了）。那個人要有空（沒有 `busy`、`injured`、`lying_low`、`arrested`）。
7. 輿論面沒有壓力條：這個活動不發 `pressure` 觸發點，也不動警戒與追蹤度。

## 驗收條件（`engine/tests/features/M5-opinion-face.test.ts`；用玩具活動當成副本開這一段（照 0020 第六節的 `setup`），自帶兩個對手（一個 `capture`）、一張內幕牌）

- 開場表：`links` 有 `inside_mail` → 牌庫多一張內幕；有 `live_footage` → 聲量 +3；有 `bought_slot` → 開場佔著那一格；有 `caught_lying` → 風向 −2；沒拿到的不套；`faceStartPreview` 和實際一樣。
- `decisive` 沒寫回合數是 6、非決定性是 4。
- 非決定性：四種結果各自直接交回對應的 `outcome`，沒有三選一。
- 決定性小勝：交回 `minor`。決定性敗：不交回、進行中的活動還在、出牌與佔領與走路都被擋而三選一做得了（契約的 `commit:contract.choose` 是 `allowEverywhere` 放行的，不算在內）；`retryWar` 之後回到開戰前（素材的次數回來）；`backToStage` 之後這個活動不存在；`acceptLoss` 交回 `lost` 一次。
- 收買：拒絕照常；接受拿到錢、公信力 −5、交回 `lost` 帶 `bribed`；之後玩具副本做一次回到入口的 `rewind`：錢與公信力還在、只算一次。
- 找上門：固定骰子擋住與擋不住各一；`capture` 的對手擋不住交回 `lost` 帶 `captured`；另一種下一回合編輯點是 0；沒有人留守直接擋不住；每場只來一次。`live_on` 的替身成立時擋住多一張料。
- 外包：四種結果的門檻對；那個人 `busy` 被擋；`outsourceChance` 和擲一萬次的分佈對得上（寬鬆的誤差）。
- 放行：玩具的 `commission` 活動進行中開得了這一段、出得了牌；別的 `commit:` 照舊被擋。
- 打到一半存檔讀回來接著打，結果一樣；等著三選一時存檔讀回來還在等。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-opinion-desk。和 M5-live-slot 可以同時做。副本那一邊（真的給 `setup`、收 `activity.end`）是 M5-commission-opinion。

## M4 對帳（2026-11-26）

- `setup.employer`：副本本來就給（`features/commission/run.ts` 的 `faceLaunch`：`def.employer` 或 `terms.employer`）。M4 之後連生成的委託也有委託人（`features/fixer/gen.ts` 的 `pickEmployer`），所以收買的「委託人好感 −5」在生成的委託上也會生效。
- 外包的人「有沒有空」：照舊看 `busy`、`injured`、`lying_low`、`arrested`；M4 的 `recovering`（手術後休養）也擋（暫定，0020 V65）。
- 放行：這一張自己往 `commission` 加 `face.opinion.start` 與 `commit:opinion.` 的做法不變（副本是唯一會包住它的活動）。契約的 `commit:contract.choose` 經 `allowEverywhere` 自動放行，等三選一的時候也回得了（驗收條件已經照這個改寫）。
- 這一段不發 `login`（不是進內海）。

## 完成時回報

改了哪些檔、測試結果、`setup` 還缺什麼（給 M5-commission-opinion）、三選一的「重來」用 `rewind` 做有沒有做不到的地方、V35～V38 對不上的地方。

## channel-shows 留下的（2026-11-26）
- 獨家節目播完報告 `data.scoop`：給「直接開輿論戰」的入口。公演簽公司「製作費公司出一半」要的話在 `channel.episode` 加選填 `cost_mult`。

## opinion-desk 留下的（2026-11-26）
- 委託副本（face）只套了議題的 `on_end` 與戰役外的 `out`；V41 那一列與格子加成在這一張對 V38 做，避免敵對值重複。
- defeat 的 `rewriteEffects` 只認 `fight`、`chain`，戰敗事件寫 `start` 會被當效果；一起看。
- 預設規則下 `open_hand` 的加成看不出來（開場 3＋第一回合 2 已頂到手牌上限 5），要不要調 `hand_max` 或抽牌數回報。
