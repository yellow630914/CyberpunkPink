# M4-curtain-entry

- 交給：cpp-feature（sonnet）
- 目標：新功能 `curtain`（簾後館）的第一段：邀請函、面談與會員證、三個席次、保證金與每週會費、口味單、檔期主題與每週主打、報名並開一趟。
- 規格出處：CYBERSPACE 8.7 節（比較表與共通的規則）、8.8 節「怎麼進去」「一趟的結構」開頭到報名、「檔期主題」的表與下面一條、「能不能反覆去」、「篩選關掉時」；LEWD_SYSTEM 1.1 節（口味單從軸與標籤挑）；dev/adr/0018 第六、十三節（一趟網內的行程怎麼開）；`engine/src/features/maze/`（照它的接法：檔頭的說明、`ops.ts` 的 `enter`）；dev/adr/0019 第十二節與 P56、P57。
- 可以改的路徑：`engine/src/features/curtain/`（新）、`engine/src/features/index.ts`（**排在 `diveFeature` 後面**，和 `maze` 同一個理由）、`engine/tests/features/M4-curtain-entry.test.ts`。
- 可以用的介面：活動 `netrun`（`launch`；`setup.region` 整筆帶這一區的規則，格式看 `features/netrun/model.ts` 的 `NetRegion` 與 `features/maze/model.ts` 的 `DEFAULT_REGION`）；`k.activity.allow`；掛點 `bill.collect`、`bill.settled`；量表（`k.meters.define`）；`meterOf`（街頭信譽 `rep`、敵對值、角色的沉溺）；`deckOf` 不能 import——有沒有甲板讀衍生數值 `deck_grade`；`tagsAllowed`、`contentAllowed`；`makeCheck`；條件 `at_facility` 或網內去處的格式（`net_site`，`features/dive`）；`deriveRng`；核心的 `cred`／`cash`、`flag`、`counter`、`ext` 變更。
- 不可以做的事：不 import `netrun`、`maze`、`dive`、`deck`；這一張不做一趟裡面的任何節點規則與結算（下一張）；不做介紹人、試鏡、蚌殼市的假邀請函（內容：引擎只有效果 `curtain_invite`）；檔期榜、月榜升席不做（P57）；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 規則 `curtain_rule`（`overridable`，id `default`）：`tiers`（三個席次：`{ id: 'floor' | 'box' | 'vip', name, grade: 2 | 3 | 4, rep_min（街頭信譽的階）, deposit: 300 | 1000 | 3300, fee_weekly: 100 | 300 | 1000, prize: 900 | 3000 | 9800, interview_dc: 13 | 16 | 19 }`）、`invite_days`（3）、`interview_retry_days`（7）、`fee_grace_weeks`（2）、`runs_per_night`（2）、`companion_fee`（100：乘等級）、`refuse`（`{ sink: 80, hostility: 40, factions: [] }`：不收的人）、`taste_min`（3：口味單少於這個數就開純舞台場次）、`feature_bonus`（1.2）、`region`（這一區的生成規則，下一張用；這一張先放預設：9×7、挖 20～28 步）。
- 內容種類 `curtain_night`（八個夜各一筆，是內容；測試自帶）：`name`、`faction`（包場的勢力）、`tags`（對到的傾向與風格標籤）、`needs_filter?`（要開著的篩選標籤，例：契約之夜要 `contract_dom`）、`prize?`、`culture`（這一夜的敵人文化）。
- `state.ext.curtain = { invite?: { until }, member?: { tier, since, paid_until, suspended?: boolean, clears: number }, taste: string[], interview_at?: 時間, week?: { index, feature: 夜的 id, tips: number, runs: Record<日子, number> }, run?: 這一趟（下一張）, tab?: 帳（第三張）, gig?: 檔期（第三張） }`。
- 效果 `curtain_invite`（`{ days? }`，內建的來源才收）。條件 `curtain_member`（`{ tier? }`）。
- 報告：`curtain.interview`、`curtain.taste`、`curtain.enter`。匯出：`curtainOf`、`memberView(k, state)`（邀請函、席次、會費繳到哪、這一週的主打、今晚還能報幾場、每個席次能不能升與原因）、`interviewBlock`／`interviewDraft(k, state, { tier, skill: 'negotiate' | 'perform' })`、`tasteOptions`／`tasteDraft(k, state, tags)`、`nights(k, state)`（口味單與篩選之下這一週抽得到的夜）、`enterBlocks`／`enterDraft(k, state, { tier?, night?, party: 角色的 id[] })`。

## 要做的

1. 邀請函：效果 `curtain_invite` 把 `invite.until` 設到三天後。面談要有沒過期的邀請函、距離上一次失敗滿七天、不在「不收的人」裡（沉溺 80 以上、溺感者、規則表列的勢力敵對值 40 以上、沒有橋或沒有甲板），街頭信譽夠那個席次；擲交涉或表演對那個席次的 DC；過了拿到會員證（從散座起；升席要 `clears` 滿五次、信譽夠、再面談一次，介紹人不檢查）、付保證金不在這裡（報名才付）。
2. 會費：`bill.collect` 每週出一行（那個席次的 `fee_weekly`）；`bill.settled` 付了就把 `paid_until` 往後一週；連續 `fee_grace_weeks` 週沒付：`suspended`（要重新面談，邀請函也要重來）。
3. 口味單：從傾向的四條軸的標籤與風格標籤裡挑（查得到的 `tendency_tag`；被內容篩選關掉的不列）；隨時可以改。
4. 檔期主題：這一週可以抽的夜＝`tags` 和口味單有交集、`tags` 沒有全部被篩選關掉、`needs_filter` 開著的 `curtain_night`。每週一用種子挑一個主打。可以抽的少於 `taste_min` 個題材（口味單裡還開著的標籤數）時 `pure_stage: true`（純舞台場次：下一張把成人場景換成表演檢定）。
5. 報名：會員沒有停權、今晚（照遊戲的日子）還沒滿 `runs_per_night` 場、隊伍 1～4 人、每個人都是會員或付同伴券（`companion_fee` × 等級，從主角的錢扣；同伴沒有打賞）、每個人都有甲板、付保證金。選夜：`night` 給了就要在可以抽的清單裡；沒給就擲（同一個夜一天之內擲到兩次重擲）；選到主打記 `feature: true`。
6. 開一趟：`launch` 活動 `netrun`，`setup` 帶 `region`（`curtain_rule.region` 加上 `safe: true`、沒有追蹤度、四幕的層數）、`grade`（席次的等級）、`faction: 'none'`、`origin: { by: 'curtain', ext: { curtain: { night, tier, feature, pure_stage } } }`；`state.ext.curtain.run` 記下這一趟的 id、保證金、主題、場熱的起點由下一張設。往 `netrun` 的放行清單加 `commit:curtain.`（用 `k.activity.allow`，照 `maze` 的做法）。
7. 沒有人登記活動 `netrun` 時（沒裝 `netrun`）：`enterDraft` 擋下並說明。

## 驗收條件（`engine/tests/features/M4-curtain-entry.test.ts`；測試自帶三筆 `curtain_night`、傾向標籤、`netrun` 用測試的替身活動；`bills` 用假掛點）

- 沒有邀請函面談被擋；效果給了之後可以；過了三天又被擋。面談失敗之後七天內再談被擋。沉溺 85、沒有甲板、信譽不夠，各被擋並有原因。過了之後是散座的會員。
- 會費：`bill.collect` 出一行 100；付了 `paid_until` 往後；兩週沒付之後 `suspended`、報名被擋。
- 口味單：被篩選關掉的標籤不在選項裡；挑了三個之後 `nights` 只列有交集的夜；契約之夜在 `contract_dom` 關掉時不列；口味單只剩兩個開著的標籤時 `pure_stage` 是 true。
- 主打：同一週每次問都是同一個；跨週會重擲。
- 報名：扣保證金 300 與同伴券（II 級一位 200）；同一晚第三場被擋；五個人被擋；選了不在清單的夜被擋；報告的 `launch` 是 `netrun`、`setup.region.safe` 是 true、`origin.ext.curtain` 有夜與席次。
- 條件 `curtain_member: { tier: 'box' }` 對散座不成立。AI 給的 `curtain_invite` 被擋。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-enemies-m4（文化的標籤）。做完才能開 M4-curtain-run。

## 完成時回報

改了哪些檔、測試結果、「不收的人」裡勢力的清單是規則表（內容匯入前是空的）、升席的條件少了哪幾樣（介紹人、月榜）。
