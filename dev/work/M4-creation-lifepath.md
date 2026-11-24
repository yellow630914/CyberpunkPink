# M4-creation-lifepath

- 交給：cpp-feature（sonnet）
- 目標：建角第 5 步：生命軌跡。八張表的格式、選或擲或跳過、結果只能是規定的那幾種、照內容篩選過濾、提交時變成遊戲裡的東西。
- 規格出處：CHARACTER 第 3 節、5.5 節、第 6 節的 `lifepath_entry` 樣本、第 2 節歡場與櫻町出身的固定傾向與豔名；LEWD_SYSTEM 1.1 節「潛在」；NPC_SYSTEM 第 4 節（生成）只看 4.1 的步驟表；EVENTS 2.4 節（效果的封閉清單）；dev/adr/0019 第十一節。
- 可以改的路徑：`engine/src/features/creation/`、`engine/src/features/npcs/`（回答掛點的一個檔）、`engine/src/features/lewd/`（同）、`engine/tests/features/M4-creation-lifepath.test.ts`。
- 可以用的介面：M4-creation-body 的掛點 `creation.step`（這一張多一個 `step: 'lifepath'`）；`k.effects`（把效果清單照內建的來源變成變更；用法看 `features/director/body.ts`）；`tagsAllowed`、`contentAllowed`；`deriveRng`；`features/npcs` 的生成（`generate.ts`）與放進名單的變更；`features/lewd` 的傾向格式（`stepTendency`、`TendencyRecord`）；`roster` 聽 `creation.commit` 的現有做法（`features/roster/index.ts` 第 267 行附近）。
- 不可以做的事：不寫任何一張表的內容（測試自帶）；不做 AI 把結果寫成背景；個人目標只留旗標（達成階段給歷練點是之後任務線的事）；功能之間不互相 import；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 內容種類 `lifepath_entry`（`creation` 定義）：`table`（`family`、`incident`、`friend`、`enemy`、`ex`、`want`、`sex`、`kink`）、`text`、`texts?`（出身的 id → 換一種說法）、`origins?`（只有這幾個出身看得到；沒寫是都看得到）、`tags?`（內容篩選的標籤）、`weight?`、`result`。
- `result`（每個鍵都選填，其他的鍵擋下）：`effects`（EVENTS 2.4 節的效果清單）、`npc`（`{ role: 'family' | 'friend' | 'enemy' | 'ex', faction_from?: 'origin' | 勢力的 id, affinity?, hostility?, roster?: boolean }`）、`goal`（個人目標的 id：變成旗標 `goal:<id>`）、`tendency`（`Array<{ tag, state?: 'has' | 'latent' }>`）、`axis`（軸 → +幾級）、`sex_record`（`{ times?, partners?, service_times? }`）、`bridge`（參數 → 加減，每項 ±10 以內）。
- `CreationDraft` 多：`lifepath?: Partial<Record<表, 條目的 id | 'skip'>>`、`kinks?: Array<{ tag, latent?: boolean }>`（最多 2 個）。
- 匯出：`lifepathTables(k, state, draft)`（每張表看得到的條目，文字已經照出身換好；整張被篩掉的表不列）、`lifepathRoll(k, state, draft, table)`（照權重與存檔的種子擲一個）、`lifepathBlock`、`lifepathResults(k, state, draft)`（每一條會變成什麼，給總覽頁）。

## 要做的

1. 檢查：每張表最多一條；條目要在那張表、那個出身看得到、沒被篩掉；`friend` 與 `enemy` 各最多一位（表本身就一條，這裡守的是 `result.npc` 的角色）；`kinks` 的標籤要是查得到的傾向標籤、沒被篩掉、最多 2 個。全部可以跳過。
2. 提交：`effects` 用內建的來源變成變更（落在主角身上）；`goal` 變旗標；其餘的經掛點 `creation.step`（`step: 'lifepath'`，`picks` 是每一條的 `result`）交給別的功能：
   - `npcs` 回答 `npc`：照 NPC_SYSTEM 的規則生成一個人（勢力照 `faction_from`：`origin` 是出身給好感的那個勢力），放進名單，照 `role` 設關係（`affinity`、`hostility` 用現有的量表與變更）；`roster: true` 的把 id 寫進主角的 `ext.origin.roster`（`roster` 本來就會在 `creation.commit` 之後把這一欄的人放進名冊）。
   - `lewd` 回答 `tendency`、`axis`、`bridge` 與 `draft.kinks`、以及出身資料上的固定傾向（出身多讀 `tendency?`、`fame?`：歡場、櫻町的那兩列）：寫 `actor.ext.tendency`（`latent` 的標成潛在；直接是「有」的那一軸不另外加點，`axis` 寫了才加級）、`actor.ext.bridge` 的微調（沒有橋的略過）、豔名的量表。
   - `sex_record`：`creation` 自己寫 `actor.ext.sex_record` 的起始值（只寫次數這三欄；格式照 DATA 第 8 節）。
3. 擲：`lifepathRoll` 用 `deriveRng`（用途帶表的名字），同一份存檔同一張表每次擲到的順序固定；「重擲」由呼叫的人換次數。
4. 文字：`texts` 有這個出身的就用它，否則用 `text`。結果不因為文字不同而不同。

## 驗收條件（`engine/tests/features/M4-creation-lifepath.test.ts`；測試自帶每張表兩三條，含一條帶篩選標籤的、一條只有車族看得到的、一條 `effects` 給錢與債的）

- `lifepathTables`：蜂巢出身看不到車族限定的那一條；篩選關掉那個標籤之後那一條不列；`sex` 表的條目全部被篩掉時整張表不列。文字照出身換。
- 選了被篩掉的、選了別張表的條目、`kinks` 三個、`kinks` 用被關掉的標籤，各被擋並有原因。全部 `skip` 過得了。
- 提交（全部功能都裝）：`friend` 那一條生成一個 NPC、親密度是資料寫的、他在名冊上；`enemy` 那一條的人帶敵對；`incident` 那一條的債在帳單裡（或那個功能沒裝時效果被擋下並寫進提醒）；`goal` 的旗標在；`kinks` 一個「有」、一個「潛在」寫進傾向；`sex_record` 的次數是資料的；橋參數被微調而且還在 0～100。
- 歡場出身：扮相那一軸 1 級、那個風格標籤是「有」、四十二番街的豔名 +10（測試的出身資料寫 `tendency`、`fame`）。
- 選了沒有橋的草稿：`bridge` 的微調略過、其他照常。
- 同一個種子 `lifepathRoll` 兩次一樣；只裝 `creation` 的 kernel 提交帶 `npc` 的條目不丟錯（那一條沒有人認得，寫進提醒）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-creation-body。

## 完成時回報

改了哪些檔、測試結果、CHARACTER 5.5 節的八種結果各用了哪個鍵、「那件事」的「沉溺的下限 +5」要寫成效果 `sink_floor`（`sink` 沒裝時落空）。
