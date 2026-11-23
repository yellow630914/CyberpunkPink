# M2-fixer

- 交給：cpp-feature（sonnet）
- 目標：新功能 `fixer`：委託的前兩拍與出發。中間人手上的委託、簡報、怎麼付、那一輪交涉、接案；未知清單與踩點；走到地點、帶著踩到的東西進副本。另外：街頭信譽這張量表。
- 規格出處：FIXER 第 1 節、第 2 節的①接案與②踩點（含「踩點的規則」整段）、③的開頭；COMMISSIONS 2.3 節「分支」的表（踩點開出來的路）、第 4 節最後兩條（簡報說什麼）；LIFE 1.1 節（兩種錢）；CORE_RULES 第 8 節（信譽六階）；UI 7.1、7.2 節；dev/adr/0016 第一、三節與 G18。
- 可以改的路徑：`engine/src/features/fixer/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-fixer.test.ts`。
- 可以用的介面：`k.meters.define`、`k.stats.defineStat`（`rep_grade`，用核心的 `gradeOfRepTier`、`repTierOf`）、報告的 `launch`（開 `commission`）、`activity.end`、核心的檢定、`time` 變更、`k.effects`（`hostility`、`owed_to_pc`、`cash`、`cred`；沒有人註冊的那一種付法就不列）、條件 `in_block`（有人註冊才檢查）、`deriveRng`、`Game.commitNarrated`（測試用）。
- 不可以做的事：召集裡請人的辦法、入帳與分帳（M2-fixer-pay）；生成委託（M2-commission-gen；這一張的委託由掛點給）；多輪的談判；派人去踩點、進人偶館當班；不 import `features/commission`；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `fixer`：`{ id, npc, district, block?, kinds: [委託的類型], cut, min_rep? }`。
- 掛點 `fixer.offers`（這個功能宣告）：`[{ state, fixer, day }, Offer[] | void]`。`Offer` 是 `{ id, commission: 一件具體的副本, title, brief, reward, unknowns: [{ id, cat, text, reveal }], min_rep? }`；`cat` 是階段、路、守備、蕾絲、目標、雇主、詞條；`reveal` 寫揭開之後給副本什麼（`{ stage }`、`{ branch }`、`{ guards: 階段 }`、`{ modifier }`、`{ flag }`）。
- 量表 `rep`（單一、0～100、AI ±3）；衍生數值 `rep_grade`。
- 狀態 `state.ext.fixer`：每個中間人今天的委託、手上的委託（`terms: { reward, pay, cut }`、未知清單哪幾項揭開了、踩了幾次、警戒的起始加值、交涉過沒有）。
- 效果 `scout_reveal`（`{ kind, job?, cat?, count? }`：替手上的一件委託揭開未知；沒寫 `job` 就是最近接的那一件）。
- 報告：`fixer.accept`、`fixer.haggle`、`fixer.scout`、`fixer.buy_intel`、`fixer.go`、`fixer.drop`（kind 用 `gig`）。

## 要做的

1. `board(k, state, fixer)`：問掛點拿今天的委託（同一天問幾次都一樣）；信譽不夠的列出來並帶門檻。簡報只看得到最後一個階段，其餘的階段在「階段」類的未知揭開之前是問號。
2. 接案：`accept(k, state, offer, { pay })`。付法三種照 FIXER ①的表，每一種回傳到手的數字與代價（`payOptions`）；匯進帳戶的在入帳時加目標勢力敵對值 +2，換人情的拿七成加一個小人情（大型是中）。
3. 那一輪交涉（G18），每件一次。
4. 踩點：`scout(k, state, job, method)`。五種手段各自擲哪一項、揭得開哪幾類照「手段與它能揭開什麼」那張表；DC = 10 ＋ 等級 × 2，第 4 次起每次 +1；一次花一個時段；最多踩「階段數」次。結果照表：超過 5 以上揭開兩項（或一項加一條踩點開出來的路）、成功一項、失敗沒有、自然 1 警戒的起始 +15。揭開哪一項由程式在那個手段揭得開的類裡照順序挑。
5. 買情報：不擲，指定一項，價錢是等級 × 300（現金），或用掉一個人情（效果有人註冊才列）。
6. `scoutedOf(job)`：把揭開的東西整理成副本要的 `scouted`（哪幾個階段的面看得到、哪幾條路開了、哪幾段的守備知道了）與警戒的起始值。
7. 出發：`go(k, state, job)` 的報告帶 `launch` 一個 `commission`（`setup` 帶副本、`scouted`、`alert_start`、`terms`；`origin` 是 `{ by: 'fixer', ref: job }`）。有條件 `in_block` 時要人在委託的那一塊街區。
8. 聽 `activity.end`（`kind: 'commission'`、`origin.by` 是自己）：這一張只把手上那一件標成做完或失敗（錢在 M2-fixer-pay）。撤退不用處理：狀態跟著快照回到出發之前。

## 驗收條件（委託用測試掛在 `fixer.offers` 上的兩件假副本）

- 同一天 `board` 兩次一樣；信譽不夠的那一件有門檻的原因、接不了。
- 三種付法的數字：報酬 1,000 → 1,000、850、700；沒有人註冊 `owed_to_pc` 時沒有第三種。
- 交涉成功報酬 +5%、大成功 +10%；第二次被擋下。
- 踩點一次時間 +4 小時；小型踩第 4 次被擋；固定骰面下四種結果各一條；第 4 次的 DC 多 1（用中型驗）。
- 實地勘查不會揭開「雇主」類；買情報揭開指定的那一項、錢少了等級 × 300。
- 揭開「階段」之後簡報那一階段不再是問號；揭開「路」之後 `scoutedOf` 多一條分支；自然 1 之後警戒的起始是 15。
- `scout_reveal` 效果揭開一項，不花時間、不算次數。
- `go`：副本的替身活動收到的 `setup` 帶著 `scouted`、`alert_start` 與 `terms`；不在那一塊街區時被擋（有 `in_block` 的時候）。
- 副本回報做完之後手上那一件是做完的；撤退（回到快照）之後還在手上、踩過的點還在。
- `rep` 35 時 `rep_grade` 是 2。

## 依賴

M2-core-meters、M2-core-activity、M2-commission-run（測試可以先用替身）。同一個資料夾的三張（這一張、M2-fixer-pay、M2-commission-gen）排成一串。

## 完成時回報

改了哪些檔、測試結果、FIXER 第 2 節裡沒做的（預期：簡報有假與當場看出破綻、預付款與裝備補助、不經中間人的委託、背刺檢查）。
