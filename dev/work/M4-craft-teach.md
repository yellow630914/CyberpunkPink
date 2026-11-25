# M4-craft-teach

- 交給：cpp-feature（sonnet）　（**第五波**）
- 目標：向 NPC 學工藝：工藝基本功（機械、義體學、醫療）還在 0 或 1 級的人，付學費、花時段，跟著資料標了「教工藝」的 NPC 學到最高 2 級，不花歷練點。
- 規格出處：CRAFTING 11.2 節（整節；三位老師的那張表只當資料的例子，是內容）；CORE_RULES 第 2 節（工藝基本功是哪三項）、7.2 節「基本功的規則」、7.5 節「向人請教」（時段與「在他行程裡那個時段所在的地方」的意思；11.2 節引的「7.4 節」指的是這裡）；NPC_SYSTEM 6.1 節選單裡的「請教」；dev/work/M4-training.md（同一個檔、同一個選單項）；dev/adr/0019 第十九節與 P85。
- 可以改的路徑：`engine/src/features/abilities/training.ts`（M4-training 的檔，加一段）、`engine/src/features/abilities/`（規則表的讀法與匯出）、`engine/src/features/npcs/interact.ts`（「請教」那一項多問一個條件）、`engine/tests/features/M4-craft-teach.test.ts`。
- 可以用的介面：M4-training 的 `lessons`（上到一半的課）、它判斷「老師在不在場」的做法、「請教」選單項的接法（照它回報裡寫的那一種）；`actor.skills` 與核心的 `actor.skill` 變更；內容種類 `npc`（只讀選填的 `tutor`）、`district`（`price_mult`）；`k.conditions.test`（`tutor.needs`）；效果 `sink`（用登錄表跑，查不到略過）；核心的 `cash`、`cred`、`time` 變更；`k.conditions.register`。
- 不可以做的事：不寫三位老師的內容；不花、不退歷練點；不能教到 3 級以上，也不能教工藝以外的基本功；5、6 級的請教與機構的課（M4-training）行為不變；`abilities` 與 `npcs` 不互相 import；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- NPC 的資料（`npc`）多讀 `tutor?: { skills: 基本功的 id[], needs?: Condition[], sink?: number, where?: string }`（教哪幾項；條件，例如某個勢力的好感 20 以上；每上一個時段沉溺加多少；一句「在哪裡上課」給畫面）。
- 規則 `ability_rule` 多 `tutor`：`{ skills: ['mechanics', 'cyberware', 'medicine'], max_level: 2, steps: { 1: { price: 300, slots: 2 }, 2: { price: 800, slots: 4 } }, slot_minutes: 240, district_price: true }`。
- `actor.ext.abilities` 多 `tutored?: Record<npc 的 id, 基本功的 id>`（這位老師教過這個人哪一項）；上到一半的課沿用 `lessons`（`from: { tutor: npc 的 id }`、`level` 是要升到的那一級）。
- 條件 `can_tutor`（`abilities` 註冊）：`{ npc, skill? }`——那個人的資料有 `tutor`，而且至少有一項是主角現在學得了的。
- 報告：`ability.tutor`（上一個時段的課；最後一個時段的那一份同時升級）。匯出：`tutorOptions(k, state, { npc, who? })`、`tutorBlock`／`tutorDraft(k, state, { npc, skill, who?, pay: 'cash' | 'cred' })`。

## 要做的

1. 誰學得了（`tutorOptions` 對老師教的每一項各回答一次）：這一項在規則的 `skills` 與老師的 `tutor.skills` 裡；學的人（`who`，沒給是主角；名冊上的人照同一條）那一項現在是 0 或 1 級——2 級以上回「已經 2 級以上，這條路走不了；再上去要自己花歷練點練。」；這位老師教過這個人別的一項（`tutored`）時，另一項回「<老師>只帶一個人一項。」；`tutor.needs` 不成立時回條件的那一句；老師不在場回 M4-training 同樣的那一句。每一項同時回下一級的學費（已經乘過區倍率）、要幾個時段、上了幾個。
2. 上一個時段（`tutorDraft`）：這一級的第一個時段付清學費——`steps[下一級].price`，`district_price` 開著時乘主角所在那一區的 `price_mult`（沒有就是 1），四捨五入；錢不夠擋下。時間加 `slot_minutes`。`tutor.sink` 有寫：每一個時段走一次 `sink` 效果（內建的來源）。`lessons` 記進度；`tutored` 在第一個時段就記下。
3. 上完這一級的最後一個時段：那一項基本功 +1（核心的 `actor.skill` 變更，不動歷練點）、`lessons` 那一項清掉。0 → 1 與 1 → 2 是兩段，各付各的學費；到 2 級之後這條路就關了。
4. 上到一半換老師：進度不留（照 M4-training 的做法，`lessons` 那一項重來；學費不退）。上到一半那一項已經因為別的原因到了這一級（例如花歷練點升了）：這一段作廢，回一句說明。
5. NPC 的互動選單：「請教」在 `can_teach`（M4-training）或 `can_tutor` 任一個成立時列出；選了之後兩邊的選項都給（接法照 M4-training 用的那一種）。
6. 和 5、6 級的請教互不干擾：`lessons` 同一項同時只有一段課；規則 `tutor.max_level` 改成別的數字時也不會超過 `skill_free_max`。

## 驗收條件（`engine/tests/features/M4-craft-teach.test.ts`；測試自帶：一位教義體學與醫療的 NPC、一位教機械的、一位教義體學但要某個勢力好感 20 而且 `sink: 1` 的；兩個區（倍率 1 與 3）；`favor` 用假量表、沉溺用 `characterFeature` 的）

- 義體學 0 級：`tutorOptions` 列出義體學與醫療，學費 300、2 個時段。上第一個時段：扣 300、時間 +240 分鐘、還是 0 級；第二個時段：不再扣錢、義體學是 1、歷練點一點都沒動。接著 1 → 2：扣 800、四個時段之後是 2。之後這一項回「已經 2 級以上…」。
- 同一位老師再學醫療被擋（「…只帶一個人一項。」）；換另一位教醫療的可以。
- 一開始就 2 級的人整個不列這一項；3 級也一樣。
- 倍率 3 的那一區：0 → 1 的學費是 900。錢不夠被擋。
- 要好感的那一位：好感 19 被擋並是條件的那一句；20 可以；每上一個時段沉溺 +1（上完 0 → 1 是 +2）。
- 老師不在場被擋。上到一半換老師，進度從頭、錢不退。
- 「請教」的選單：只帶 `tutor` 的人也列出來；主角三項工藝都 2 級以上時，他沒有別的可教就不列。
- 5、6 級的請教（M4-training 的測試）不改全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-training（同一個檔與同一個選單項）、M4-abilities-m4。和任何還在改 `features/abilities`、`features/npcs` 的工單不要同時做。

## 完成時回報

改了哪些檔、測試結果、名冊上的人走這條路有沒有問題、CRAFTING 11.2 節「縫縫每次選一項」和「一個老師一個人最多一項」照 P85 的讀法做了之後有沒有對不上的地方。
