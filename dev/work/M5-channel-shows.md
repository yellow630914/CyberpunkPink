# M5-channel-shows

- 交給：cpp-feature（sonnet）
- 目標：`channel` 的後半：節目（四種加公演、獨家，都是資料）、成人檔、開一集（選、付、擲、評價、結算）、業配、編制三種位子、設備、每一集的觸發點。
- 規格出處：MEDIA 4.3 節、4.3a 節、4.4 節、4.5 節、4.6 節、4.7 節（只看「每一集結算時抽一次」）；UI 6.2 節（預覽要給什麼）；dev/adr/0020 第二節、第十三節（`channel.episode`、`Material`）、V14、V15、V17～V20、V55；dev/work/M5-channel.md 的「新的格式與鍵」。
- 可以改的路徑：`engine/src/features/channel/`、`engine/tests/features/M5-channel-shows.test.ts`。
- 可以用的介面：上一張的 `payFromBudget`、狀態、`channel.weekly`；掛點 `media.materials`、`media.spend`（M5-media-chain 宣告的）；核心的檢定；`actor.ext.paths`（只認格式）；效果 `subs`、`credibility`、`reco`、`fame`、`popularity`、`cred`（都先問有沒有人註冊）；條件 `at_home`、`at_facility`、`has_home`；衍生數值 `studio_slots`、`episode_bonus`、`stream_gear_bonus`（這一張定義；`studio_slots` 預設「有住處 1、沒有 0」；`stream_gear_bonus` 是給直播讀的：收音、鏡頭、串流三類各取裝著的最高一件合計、最多 +3，算法和開一集的設備同一套）；`item` 變更；`time` 變更；`state.rules.contentOff`。
- 不可以做的事：不 import 別的功能；不自己算使用次數；直播不是節目（不做「錄播或直播」的選項，V55）；事件的內容不寫；握手會、技能的加值不寫在這裡（留掛點）；草稿不做；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `show`（`overridable`）：`{ id, name, skills: 基本功[], slots: 時段數, cost, accepts: 類型[] | 'any', min_quality, adult_accepts?: 類型[], cred_affected?: boolean, requires?: 條件, tags?: string[]（內容篩選的標籤）, venue?: 'stage', materials: [最少, 最多], material_bonus?: { types, each, max }, on_grade?: Record<'flop' | 'ok' | 'good' | 'hit', 效果[]>, adult_needs_media?: boolean }`。預設六筆照 MEDIA 4.3、4.3a：`live_news` 現場、`feature` 專題、`gossip` 八卦、`talk` 雜談、`concert` 公演、`scoop` 獨家。公演 `materials: [0, 3]`、`venue: 'stage'`、`requires` 是「上鏡的人有偶像的路數 1 階以上」；獨家 `materials: [1, 1]`、`min_quality: 3`、`accepts: ['crime', 'scandal']`、`requires` 是「主播 1 階以上」。
- `channel_rule` 多：成人檔三段的倍率與加減、評價表（觀看、訂閱、公信力）、廣告的單價、打賞的比例、料的加成（看點合計 ÷ 4、最多 +3）、設備的上限（+6）、沒有媒體型技能的 +3、編制的薪水（V15）、線人每週帶回什麼。
- 狀態多：`staff: Partial<Record<'producer' | 'source' | 'pr', { who: 角色 id, hired: boolean, wage: number }>>`、`gear: Array<{ uid, item, cls, grade, portable }>`、`log` 多節目的集數。
- 掛點（這一張宣告、問）：`channel.episode`：`{ state, show, tier, host, staff, where, materials }` → `{ owner, options?: Array<{ id, name, block: string | null }>, bonus?: Array<{ label, value }>, on_grade?: Record<評價, 效果[]>, extra_slots?: number, lines?: string[] } | void`。開一集的輸入可以帶 `options: string[]`（選了哪些加開的）。
- 條件：`channel_staff { role }`。
- 報告：`channel.episode`（kind `broadcast`，帶觸發點 `episode`）、`channel.hire`、`channel.dismiss`、`channel.gear`（裝上、拆下）。
- 匯出：`showOptions(k, state)`（每一種節目開不開得出來、原因）、`episodePreview(k, state, input)`（算式的每一項、難度、四種評價的機率與各自的結果）、`airEpisode`、`seatStaff`、`dismissStaff`、`mountGear`、`unmountGear`、`staffSlots`。

## 要做的

1. **開一集的檢查**：頻道開著；節目的 `requires`；節目的 `tags` 與成人檔那一段的 `tags`（`channel_rule` 的三段各可以寫）經核心的 `tagsAllowed(state.rules, tags)`，被玩家關掉的不列；成人檔另外看 `adult_needs_media`（沒有媒體型技能的人開不出專題與雜談的成人檔）；1～3 件料（公演 0～3），每一件的類型落在 `accepts`（成人檔加 `adult_accepts`）、品質到門檻、還有次數；公演要站在帶 `stage` 欄位的設施上（V20）；製作費付得出來（公演照 `stage.size`）；贊助的 `tiers_off` 擋掉的成人檔不能掛那一家的業配。每一條一個原因。
2. **付與扣**：製作費從預算（`payFromBudget`）；每件料經 `media.spend`（`how: 'episode'`）扣 1，變更併進這一份報告；時間 = 節目的時段數 × 240 分鐘加上掛點回的 `extra_slots`。
3. **擲**：1d20 ＋ 上鏡者在節目兩項基本功裡較高的 ＋ 設備 ＋ 編制 ＋ 料的加成 ＋ `episode_bonus` ＋ 掛點回的加值，對 12 − 推薦權重 ＋（上鏡者沒有主播或偶像的路數 +3）。設備：這一集的節目用得到的每一類取最高的一件（MEDIA 4.6 的「用在」表），便攜的任何地方都算、便攜的專業級以上 −1、棚內的只在自己的住處算而且每類最多算 `studio_slots` 件裡最高的一件，合計最多 +6。編制：帶著製作 +2，那個人的路數是主播或偶像時 +4。
4. **評價與結算**（MEDIA 4.4 的表）：觀看、訂閱（成人檔的倍率只乘漲的，V14）、公信力（只有 `cred_affected` 的節目照表；成人檔的加減；料的平均可信 8 以上 +1、3 以下 −1；業配 −1；放了假料先擲風險，出事就被拆穿公信力 −8）、推薦權重（成人檔 −1，每週最多一次）、豔名（上鏡的是主角才加，記在現在這一區）、廣告進預算的帳戶（自有）、打賞進口袋（主角全拿、夥伴上鏡對半；V18）、節目與掛點的 `on_grade`、效果 `aired`。業配：預算 + 贊助的 `plug_pay`、`eps_since_plug` 歸零；沒掛的那些金主各 +1。
5. **觸發點** `episode`：`where` 帶節目、成人檔、評價、上鏡的人。
6. **編制**：位子數 = 頻道等級 ＋ 1；放的是角色的 id（名冊上的人或任何一個角色）；同一個人只能坐一個位子。薪水掛進上一張的每週結算（從預算扣；扣不到記 `unpaid_weeks`，並在那一份報告的觸發點 `where` 帶 `unpaid: true`）。線人每週帶回一段素材（效果 `footage`，品質 1～2、類型照固定亂數）。條件 `channel_staff`。
7. **設備**：帶 `studio` 欄位的物品從背包裝進頻道、拆回背包。
8. **獨家播完**：結果的 `data` 帶 `scoop: 那一件的 ref`（介面據此提供「直接開戰」，開戰是 opinion 的入口，這裡不呼叫）。

## 驗收條件（`engine/tests/features/M5-channel-shows.test.ts`；測試裝真的 `media`，自帶素材、兩件設備、一個帶 `stage` 的設施、一位偶像路數的夥伴）

- 六種節目各自收什麼料逐條對（專題只收品質 3 以上的罪證；雜談什麼都收；八卦不收戰鬥）；放不進的原因寫出是哪一件、差什麼。
- 沒有料開不了（公演例外）；放三件，三件各少一次；錢不夠時料的次數不變。
- 算式：固定骰子下每一項的值對；沒有媒體型技能難度 +3；製作是主播路數 +4；設備超過 +6 夾住；棚內設備在街上不算。
- 四種評價的訂閱、公信力、觀看、廣告、打賞對表；成人檔三段的倍率與加減對表，翻車的 −2% 不乘。
- 內容篩選：預設的六筆節目與三段成人檔都不帶 `tags`，不受任何開關影響；測試另外放一筆帶 `tags: ['blacktape']` 的節目，關掉那個標籤時 `showOptions` 不列它。沒有媒體型技能開不出專題與雜談的成人檔。
- 公演：不站在舞台上被擋；放兩件日常類的花絮檢定 +2、三件還是 +2；評價「爆」人氣 +6（有人定義 `popularity` 時）。
- 獨家：沒有品質 3 以上的罪證或醜聞時 `showOptions` 把它列成灰的並寫還差什麼；播完的結果帶 `scoop`。
- `channel.episode` 的替身回一個選項與一筆加值：預覽列得出來、選了之後時間多一個時段、`on_grade` 的效果套上。
- 每一集的報告帶 `episode` 觸發點；這一週的計數 +1，週一的流失是 2%。
- 薪水：預算夠就扣；不夠記欠、觸發點帶 `unpaid`。
- `stream_gear_bonus`：只裝消費級的收音是 1；三類都有專業級的便攜版是 3（各 +1）；棚內的在街上不算。
- `episodePreview` 四個機率加起來是 100，和實際擲一萬次的分佈對得上（性質測試，寬鬆的誤差）。
- 把 `media` 拿掉：開一集被擋，原因是「沒有素材庫。」；公演不放料照樣開得出來。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-channel、M5-media-chain（`media.spend`）。和 M5-opinion 可以同時做。

## M4 對帳（2026-11-26）

- **內容篩選只認標籤**（0020「M4 對帳」V63）：核心的封閉清單 `CONTENT_TAGS`（`core/rules/versions.ts`）加上內容載入的題材標籤；LEWD_SYSTEM 第 9 節沒有「成人檔」這個細項，也沒有成人內容的總開關，所以成人檔本身不是一個可以關的東西。放進這一集的料帶的 `Material.tags` 裡有被關掉的標籤時，那一件放不進去（原因：「這段素材的題材被你在內容篩選關掉了。」）。
- `at_home`、`has_home` 現在由 `rest` 註冊（M4；第二波換成 `home`）：`studio_slots` 的預設（有住處 1、沒有 0）用 `has_home` 問，沒有人註冊當 0。
- 設備是 `item` 這種內容（帶 `studio` 欄位），不是設計圖的成品；它不經 `gear`，也不算被動效果。
- 上鏡的人與編制裡的人「在不在、有沒有空」照舊看 `actor.conditions`；M4 多的共用狀況 `recovering`（手術後休養）不擋上鏡（設計書沒寫）。

## 完成時回報

改了哪些檔、測試結果、`show` 的欄位夠不夠表達六種節目（不夠的列出來）、MEDIA 4.6「用在」表做的時候對不上的地方。
