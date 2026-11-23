# M2-roster

- 交給：cpp-feature（sonnet）
- 目標：新功能 `roster`：名冊（你認識而且肯接你電話的人）、招募、隊伍與同行、忠誠與可靠度、出場費與分紅的數字、戰鬥的候補。
- 規格出處：FIXER 第 6 節；NPC_SYSTEM 第 10 節（10.0 隊伍、10.1 兩種、10.2 招募的公式、10.4 忠誠、10.5 薪水與分紅、10.6 離隊、10.7 候選人）；COMMISSIONS 6.1 節（召集）；dev/adr/0016 第三節（共用的狀況）、第五節、G4。
- 可以改的路徑：`engine/src/features/roster/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-roster.test.ts`。
- 可以用的介面：核心的 `party`、`actor.add`、`actor.condition` 變更；`k.meters.define`；`k.battle.bench`；`k.actions.register`；`k.hooks.on('time.passed' | 'activity.end')`；`meterOf`（`affinity`、`rep`）；`k.effects.register`；`k.content`（`npc`、`path`）。
- 不可以做的事：輔助面請人的四種辦法與分帳（M2-fixer）；關係線的五段（內容）；派工（M5）；不直接 import `features/npcs`：成員一律是 `state.actors` 裡的角色（要進名冊的人由呼叫的人先變成角色）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 狀態 `state.ext.roster`：`{ members: { [角色 id]: { since, reliability, pay: 'fee' | 'share', fixed?, last_called } }, tagalong: [角色 id], candidates: [...] }`。成員的角色帶 `ext.paths`。
- 量表 `loyalty`（照人、0～100、AI ±10；進名冊時起始 30，救過的 50、介紹的 40）。
- 衍生數值 `roster_cap`（3 ＋ mod(魅力) ＋ 人面階數 × 2；階數讀主角的 `ext.paths` 或技能的衍生數值，讀不到當 0）。
- 衍生數值 `roster_fee`（照人：這個人一件委託的出場費；拿分紅的是 0）。
- 效果 `roster_add`（`{ kind, who }`：進候選）。條件 `in_roster`、`in_party`。
- 行動種類 `npc_recruit`（資料寫 `owner: 'roster'`）。
- 報告：`roster.join`、`roster.leave`、`roster.muster`（定隊伍與同行）、`roster.weekly`。

## 要做的

1. 招募：DC = 16 − ⌊親密度 ÷ 10⌋ ＋ 2 × max(0, 他的主職階數 − 你的信譽階序)；只有行者；名冊滿了給原因；成功進名冊，差一點的「再想想」記下來、下次睡一覺之後才能再問。
2. `muster(k, state, { party, tagalong })`：隊伍含主角最多 4 人、都要是名冊上有空的行者；同行最多 2 位、誰都可以。有空＝不在隊上以外的事裡、身上沒有 `busy`、`injured`、`lying_low`、`arrested`。寫進核心的 `party`。
3. 出場費（`roster_fee`）：主職階數² × 200 ×（1 ± 25%，照人固定）；信譽比他低再 +20%；忠誠 20～39 再 +25%。拿分紅的人是 0；`payOf(state, actor)` 回答他拿的是出場費還是分紅。
4. 忠誠的變化照 10.4 節的表裡這個功能自己看得到的：連兩週沒召集 −2（只有生成的行者）、戰鬥裡倒下 −3（`activity.end` 的戰鬥）。薪水付不出來的 −8 由 M2-bills 接。每週（`time.passed` 順序 14）忠誠 20 以下的人 30% 離開。
5. 候補：登記 `k.battle.bench`，我方叫得到的是名冊上有空、不在這一場裡的人，`ref` 是 `{ from: 'actor', id }`；沒空的也列出來並帶原因。
6. 匯出 `weeklyPay(k, state)`：這一週要付的薪水（只有設了週薪的成員；拿分紅的不在這裡），給 M2-bills 接帳單用。
7. 夥伴的技能（G4）不在這裡做，只保證成員的角色帶著 `ext.paths`。

## 驗收條件

- 容量：魅力 14、沒有人面是 5；滿了之後招募被擋下並有原因。
- 招募的 DC：親密度 30、他 3 階、你是熟面孔 → 16 − 3 + 4 = 17；街坊不能招募。
- `muster`：第五個人被擋；受傷的人被擋並寫出是誰、為什麼；同行第三位被擋；成功之後 `state.party` 就是那幾個人、主角在裡面。
- 出場費：同一個人每次問數字一樣；忠誠 30 時多 25%。
- 連兩週沒被召集的生成行者忠誠 −2；忠誠 15 的人過一週有機會離開（固定骰面驗兩邊）。
- 戰鬥裡 `bench('ally')`：有空的人 `blocks` 是空的，隊上的人不列，被捕的人列著並有原因。
- `roster_add` 之後候選名單有那個人；重複的不重複加。
- 存檔往返名冊不變。

## 依賴

M2-core-meters、M2-core-battle、M2-npcs（測試要用它把人變成角色；程式不 import 它）。帳單的兩個掛點等 M2-bills 宣告之後由那一張接上。

## 完成時回報

改了哪些檔、測試結果、NPC_SYSTEM 第 10 節裡沒做的（預期：關係線、被挖走、主角沉溺到 100 時的離隊、藏著沉溺的檢定、牆報徵人）。
