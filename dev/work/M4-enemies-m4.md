# M4-enemies-m4

- 交給：cpp-feature（sonnet）
- 目標：敵人在 M4 的三件事：雙形象（一個敵人兩份名字與外觀，一場戰鬥擲一次）、成人地城的五種效果記號（縛、灌、挑、疊、範）、沉溺高的敵人。
- 規格出處：CYBERSPACE 8.7 節（「兩座的敵人都打感載」的記號表、「雙形象」的表與下面兩條）；ENEMIES 第 5 節（開戰時擲的特徵裡沉溺那一條）、第 6 節（版本的精神）；CYBERWARE 第 6 節「NPC 也會溺感」；CORE_RULES 4.2 節承受層數表最後一列、4.3 節最後第二條；DATA 第 1 節的性別五個值、第 6 節；dev/adr/0019 第十二節與 P61。
- 可以改的路徑：`engine/src/features/enemies/`、`engine/tests/features/M4-enemies-m4.test.ts`。
- 可以用的介面：`features/enemies` 現有的資料格式（`kinds.ts`）、單位的組法（`stats.ts`、`lace.ts`）、招牌行動（技能格式，`enemy: true`）、`unitdata.ts`；`k.battle.effect`（效果的 op；寫法看 `features/combat/ops.ts`、`features/netcombat` 註冊 `net.*` 的地方）、`k.battle.on('overload' | 'out' | 'turn.start')`、`run.applyStatus`、`battle_status` 的資料；`tagsAllowed`（`male_partner` 等五個）；`deriveRng`；角色的性別（`actor.gender`）與 `actor.ext.deck.avatar.gender`（只認格式）。
- 不可以做的事：不寫任何一種敵人的內容（八個夜約四十種是內容）；不改戰鬥的核心；數字兩個形象完全相同（只換名字與描寫）；和 M4-craft-salvage 不要同時做；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 敵人資料多讀：`forms?: { a: Form, b: Form }`，`Form`＝`{ name, look, moves?: Record<招牌行動的 id, { name, text? }>, points_at?: Array<'male' | 'female' | 'femboy' | 'trans_f' | 'futa'>（這個形象的描寫指向哪幾類對象；篩選用）, neutral?: boolean }`；`neutral?: { name, look }`（兩個形象都被篩掉時用的中性外觀）；`culture?: string`（簾後館擲文化用，只是一個標籤）。
- 規則 `enemy_rule`（已有的那一筆）多：`form_b_chance`（0.6）。
- 單位上：`unit.ext.enemies.form`（`'a'`、`'b'`、`'neutral'`：這一場對「女性、偽娘、TS、扶他」那一側用哪一個）；`unit.name` 照舊是資料的 `name`（沒有 `forms` 的敵人不變）。
- 匯出：`formFor(k, state, unit, target?)`（這個敵人對這個目標現在的名字與外觀：目標是 `male` 一律 `a`；其餘用擲到的；沒給目標照主角）、`unitFormView`（給畫面：兩種可能的樣子裡現在顯示哪一個）。
- 戰鬥的效果 op（給招牌行動用）：`bind`（`{ who, mode: 'ap' | 'no_move', by?: 'user' }`）、`overload_extra`（`{ layers?: 1 }`：這一擊把目標灌到過載時多疊一層）。其餘三種記號用現有的效果寫（灌＝多一顆骰的感載攻擊、挑＝感載加一個「下一次命中 −1」的狀態、範＝`who` 是敵方全體）；這一張補齊它們需要的狀態資料格式（狀態本身的資料由 M4-data-rules 放）。

## 要做的

1. 雙形象：有 `forms` 的敵人在開戰時（`unit.ready`）擲一次（`deriveRng`，用途帶戰鬥與單位的 id）：`form_b_chance` 是 B，否則 A；整場固定。篩選（CYBERSPACE 8.7 節的表最後一列）：`points_at` 裡有任何一類對應的篩選標籤（`male_partner`……）被關掉的形象不能用——擲到不能用的換另一個；兩個都不能用就是 `neutral`。
2. 看誰：`formFor` 的目標性別——現實的戰場讀角色的性別；內海的戰場優先讀化身的（`actor.ext.deck.avatar.gender`），沒有才讀角色的；目標不是角色（敵方的單位、掛著的東西）當成主角。範圍攻擊固定看主角。
3. 文字：戰鬥的每一拍裡這個敵人的名字與招牌行動的名字，用「這一拍的目標」對到的形象（`run.say` 之前換名字的方式做的人看 `features/enemies` 現有產生文字的地方；做不到逐拍換時退一步：整場用「對主角的那一個」，並寫進回報）。數值、狀態、標記換形象時都不變。
4. `bind`（P61 的縛）：`ap` 模式是目標每回合回復的行動點 −1；`no_move` 是不能換位。持續到綁他的那個敵人退出戰鬥，或一個隊友花 1 行動點替他解開（這一張註冊一個核心以外的行動 `unbind`：相鄰或同一邊的隊友、1 行動點；兩個戰場都能用）。不是釘住：不影響拔線與結果。
5. `overload_extra`（疊）：掛在這一擊上；這一擊造成過載時多疊一層餘韻（不超過承受層數 +1 的規則：疊滿之後再過載照舊倒下）。
6. 沉溺高的敵人：資料的 `mods.sink` 在 60 以上承受層數 +1、100 以上再 +1（CORE_RULES 4.2 節「重度改造、高沉溺的人比同類高 1～2」）；「把他推過線」（沉溺 80 以上的敵人在這一場被灌倒，或被快感傷害加的沉溺推到 100）：他退出的方式記成 `sunk`、不能俘虜、掉落照常，結束的報告多一句並帶一個觸發點 `foe_sunk`（之後的事是事件）。

## 驗收條件（`engine/tests/features/M4-enemies-m4.test.ts`；測試自帶兩種有 `forms` 的敵人（一種 B 的 `points_at` 是 `['female','femboy','trans_f','futa']`、一種兩個形象都指向會被關掉的類）、兩個招牌行動）

- 沒有 `forms` 的敵人一切照舊（`M1-enemies`、`M3-lace` 的測試不改全過）。
- 固定骰子：0.5 擲到 B、0.7 擲到 A；同一場重讀存檔還是同一個；「重來這場戰鬥」會重擲（種子照戰鬥的 id）。
- `formFor`：目標是 `male` 的隊友一律 A 的名字；目標是 `female` 的主角是擲到的那一個；範圍攻擊的那一拍用主角的。
- 篩選：`female_partner` 關掉而 B 指向它：擲到 B 也用 A（A 不指向被關掉的類時）；兩個都不能用的那一種是 `neutral` 的名字；被關掉的類的字眼不出現在任何一拍的文字裡（掃 timeline）。
- 兩個形象的單位除了名字與 `ext.enemies.form` 以外逐欄相同。
- `bind`（`ap`）：目標下一回合少回 1 點；綁他的敵人倒下之後恢復；隊友用 `unbind` 花 1 點解開。`no_move` 的目標換位被擋並有原因。
- `overload_extra`：同一擊造成過載時餘韻 +2 層；沒有過載的那一擊不加。
- 沉溺 65 的敵人承受層數比資料多 1；沉溺 85 的敵人被灌倒：退出的方式是 `sunk`、俘虜的選項沒有他、報告帶 `foe_sunk`。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-scene-net（化身性別的格式）之後比較好測，沒有硬的依賴。做完才能開 M4-curtain-entry。

## 完成時回報

改了哪些檔、測試結果、名字是逐拍換還是整場一個、「挑」「灌」「範」各用了哪些現有的效果與缺哪些狀態資料（交 M4-data-rules）。
