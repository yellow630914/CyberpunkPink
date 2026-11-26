# M5-media-cut

- 交給：cpp-feature（sonnet）
- 目標：`media` 的後半：把一到三段素材剪成片（七種角度、三個數字、片自己的使用次數）、重剪、偽造、發布的四種做法（直接上架、賣斷、拿去談判、留著當保命符）。
- 規格出處：MEDIA 1.1 節的發布表、2.1 節（片的次數、重剪）、第 3 節（全部）、第 5 節；OPINION 4.3a 節（片進牌庫是哪一種牌，只看角度那張表）；DATA 第 11 節（`clip` 與 `card`）；dev/adr/0020 第一節、V7～V11、V54；dev/work/M5-media-chain.md 的「新的格式與鍵」。
- 可以改的路徑：`engine/src/features/media/`、`engine/tests/features/M5-media-cut.test.ts`。
- 可以用的介面：上一張的 `spend`、`materialOf`、狀態；核心的檢定（`k.check`／`rollFor` 同等的入口）；效果 `subs`、`credibility`、`popularity`、`fame`、`hostility`、`hostility_floor`、`standing`、`cred`、`cash`、`owed_to_pc`（都先問 `k.effects.has`）；條件 `at_home`、`at_facility`、`channel_staff`（先看有沒有人註冊）；掛點 `defeat.options`（既有，照 `features/defeat` 宣告的格式回答）；衍生數值 `cut_pick`、`forge_bonus`、`forge_quality`、`forge_risk`（這一張定義，預設 0）；`time` 變更。
- 不可以做的事：不 import 別的功能；不寫「帶進輿論戰」的入口（那是 opinion 來問 `media.spend`）；不寫「開一集」「發文」；任何做法都不給街頭信譽；不加 AI 任務（剪輯的自由行動等第三波）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `footage_angle`（`overridable`）：七筆（`documentary` 紀實、`daily` 日常、`fun` 娛樂、`hero` 英雄、`expose` 揭弊、`sensational` 煽情、`smear` 抹黑），每筆 `{ id, name, group: 'neutral' | 'positive' | 'dispute', types: 類型[] | 'any', draw, trust, risk, card: 'line' | 'fuel' | 'decoy' | null, upload: 效果的範本[] }`。預設照 MEDIA 第 3 節的兩張表寫在功能裡。
- `Clip`：`{ id: 'cl…', from: 素材 id[], angle, title, intro, titled?: true（標題或簡介是玩家寫的）, quality, types, involves, celebrity, self, adult, forged, draw, trust, risk, uses, recut?: true, card, made_at, blame?: 勢力 id }`。`card` 照角度：`line` 的數字是可信、`fuel` 的是看點、`decoy` 沒有數字、日常是 `null`。
- `media_rule` 多：剪片花的分鐘（240）、上架的算式（V9）、賣斷與談判的數字（V10）、保命符的門檻（V11）、偽造的 DC 與品質（V7）。
- 報告（kind `broadcast`）：`media.cut`、`media.recut`、`media.forge`、`media.upload`、`media.sell`、`media.deal`。
- 匯出：`angleOptions(k, state, parts)`（七種各自選不選得了、為什麼）、`cutPreview`（三個數字與片的次數）、`cut`、`recut`、`retitle`、`forge`、`upload`、`uploadPreview`（風險是 d20 擲到幾以下出事）、`sell`、`sellPrice`、`deal`、`dealTargets`、`CLIP_TITLE_MAX`（30）、`CLIP_INTRO_MAX`（100）。

## 要做的

1. **剪**：一到三段素材；地點是自己的住處（條件 `at_home`）或帶 `edit` 欄位的設施；花一個時段。每一段的類型都要落在角度的 `types` 裡，不然那個角度灰掉（原因寫出是哪一段、哪一型）。每段來源經 `spend` 扣 1；有一段剩 1 次就整個不能剪（原因）。片的次數 = 來源扣完之後剩最少的。品質 = 來源品質的平均四捨五入；類型、涉及的勢力與人取聯集；有一段是偽造的、或角度是抹黑，片就是假料（`forged`）。三個數字照第 3 節的算式；風險裡勢力的等級照 V8。`cut_pick` 大於 0 時入口收 `pick: 'draw' | 'trust'`，那一項 +1。抹黑要指定 `blame`（把責任導向的另一個勢力）。
2. **重剪**：只改角度（新角度仍要對得上來源的類型）、重算三個數字與 `card`；不動來源、不扣片的次數；每支片一次；要條件 `channel_staff { role: 'producer' }` 成立（沒有人註冊這個條件就是不成立，原因：「要有製作才能重剪。」）。
3. **偽造**（V7）：地點同剪片、花一個時段、擲介面；產生一段 `authentic: 'forged'` 的素材。
4. **直接上架**：對象是片或不剪的素材，經 `spend` 扣 1。結果照 V9 的表從規則與角度的 `upload` 範本算成效果，每一筆先問有沒有人註冊；匿名照 V8。風險：擲一次 d20，擲出風險以下出事。親密類而且 `self` 的豔名 +1 記在現在這一區。
5. **賣斷**：扣光；錢照 V10 進帳戶。**拿去談判**：扣光；對象從涉及的勢力與人裡選；一次檢定照 V10。
6. **留著**：回答 `defeat.options`——贏的那一方的勢力（從 `pending` 讀）對得上一件符合 V11 的料時多一個選項，選了的變更是那一件次數歸零加 `hostility_floor`。`defeat.options` 的格式是 `features/defeat/flow.ts` 的 `DefeatOption[]`，`features/abilities/ransom.ts` 是現成的回答範例。
7. **片的標題與簡介**（使用者 2026-11-25；MEDIA 第 3 節「片的標題與簡介」）：`cut` 的輸入多收選填的 `title`、`intro`；上架之前可以用 `retitle(k, state, clip, { title?, intro? })` 改（報告 `media.retitle`，kind `system`，不花時間）。字數照「字」算（`Array.from`，和外殼的寫法指令同一個算法）：標題最多 `CLIP_TITLE_MAX`、簡介最多 `CLIP_INTRO_MAX`，超過的截掉並在那一份報告的 `lines` 加一句「標題最多 30 字，超過的部分沒有留下。」（簡介同理）。空著就用程式的模板（角度的名字加第一段來源的標題；簡介是一句來源的說明）。玩家寫的原樣存、不篩選、不改寫。它們只用在顯示、`Material.title`／`Material.intro`（發文的留言與正文讀）與上架那一份報告的 `input`，**不影響任何數字**。重剪不動它們。

## 驗收條件（`engine/tests/features/M5-media-cut.test.ts`；測試自帶素材、一個勢力（`grade` 3）、玩具的 `channel_staff` 條件）

- 七種角度的適用類型逐條對：一段戰鬥的素材選得了紀實、娛樂、英雄、煽情、抹黑，選不了日常與揭弊，原因的句子寫出類型。
- 三個數字：每一種角度一組固定輸入對 MEDIA 第 3 節的算式（含名人 +1、偽造 −3 與 +5、可信夾 0～10、風險最少 0）。
- 次數：素材 3 → 用掉一次剩 2 → 剪成片，素材剩 1、片 1；兩段（3、2）剪成片，來源剩 2、1，片是 1；剩 1 次的剪不了。
- 片用掉之後來源的次數不動；重剪不扣、第二次重剪被擋；沒有製作被擋。
- `card`：紀實、英雄、揭弊是 `line`（可信）；煽情、抹黑是 `fuel`（看點）；日常 `null`；娛樂 `decoy`。
- 上架：固定骰子下每一種角度的效果清單對 V9；匿名的那一份訂閱少三成、沒有敵對值、風險少 5；風險擲中而且是假料：公信力 −8。沒有註冊 `subs` 的一局照樣上架得了，只是沒有那一筆。
- 賣斷與談判把次數扣光；談判失敗敵對值 +5；兩者都留下敵對值的下限。
- 保命符：持有對得上的罪證時 `defeat.options` 多一條，選了之後那一件是 0 次；品質 3 的不算。
- 片的標題與簡介：給 31 個字的標題只留 30 個、報告有那一句提醒；空著是模板的字；同一個種子有沒有寫標題，三個數字、上架的每一筆效果都一樣；`retitle` 之後 `Material.title` 跟著變。
- 掃一遍這個功能產生的所有報告，沒有任何一筆 `rep` 的變更或效果。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-media-chain。`at_home` 現在由 `rest` 註冊（M4；第二波換成 `home`，行為不變），`channel_staff` 由 M5-channel-shows 註冊；測試用替身。

## M4 對帳（2026-11-26）

- **敵對值的下限**：效果 `hostility_floor` 是 `features/security/floor.ts` 註冊的，有兩種——不寫 `days` 是永久的（加在量表 `hostility_floor` 上），寫 `days` 是有期限的（只有內建的來源收）。V10、V11 的「下限 +5」用永久的：`{ kind: 'hostility_floor', key: 勢力, amount: 5 }`。戰敗事件的資料裡不寫 `days` 會在載入時被擋（M4-followups），那是事件資料的規定，和這裡發的效果無關。
- **剪片的地點**：`at_home` 不帶 `level_min`（任何一處自己的住處都能剪）；帶 `edit` 欄位的設施用 `at_facility` 問。第二波的轉播站（`at_own_shop { kind: 'relay' }`）由 M5-home-links 接。
- 片的標題與簡介的文字槽（空著時讓 AI 起）在第三波（M5-ai-media）；`titled` 是給它看的：玩家寫過的那一支不被 AI 蓋掉。

## 完成時回報

改了哪些檔、測試結果、V7～V11 的暫定數字實際寫進規則表的樣子（給 M5-data-rules）、`defeat.options` 現有的格式夠不夠表達「選了不進戰敗事件」。
