# M1b-skill-medic

- 交給：cpp-feature（sonnet）
- 目標：改造師這棵樹在現實的機制：用醫療道具的減免、治療加值、拆解與超頻（讓義體失效或超頻）、救回來、擋下倒下與過載的後果、處理重創；用假資料證明這棵樹寫得出來。
- 規格出處：SKILL_TREES「改造師：手術刀」整節的「現實」欄與共鳴表（「預備與日常」那一段只看、不做）；COMBAT_SYSTEM 第 6 節（重創）、第 11 節的「改造師」那一列；ITEMS 5.2 節急救凝膠與冷卻劑兩列（道具的行動點）；dev/adr/0015 第二、三節、E13；dev/adr/0013 B5（手術刀照 SKILL_TREES）。
- 可以改的路徑：`engine/src/features/abilities/`、`engine/src/features/combat/`（只有兩處：擲重創的級數時問修正 `wound_grade`；使用道具認 `use.tag_required`）、`engine/tests/features/M1b-skill-medic.test.ts`。
- 可以用的介面：M1b-skill-format 的格式；M1b-ops 的效果（`heal`、`vent`、`afterglow`、`implant`、`revive`、`wound`、`check`、`attack` 的 `as`、`status`、`shift`、`buff`）；修正 `heal_dealt`、`vent_dealt`、`action_ap`（標籤裡有 `item:medical`）、`wound_grade`；`out.before`、`overload` 的反應。
- 不可以做的事：不改核心；不做日常的部分（手術、解剖、工坊、解鎖匠的日常、手術刀的沉溺減免：M4）；不做「替他裝上快取格裡的一件義體」（E13）；主角這一邊在 M4 之前沒有義體，測試直接在單位上給 `implants`。

## 一、這棵樹要補的鍵

| 鍵 | 意思 |
|---|---|
| `mods` 的 `to` 用在 `action_ap` | 「改成只花 N 點」（手術刀：`{ kind: 'action_ap', to: 1, tags: ['item:medical'] }`）；對象限自己或相鄰用 `when: { target_near: true }` |
| 技能的 `action_tags` | 這個技能的行動多帶的標籤（治療類的寫 `heal`），巡房、名醫的「每回合第一次治療」靠它認 |
| `implant` 效果的 `take` | 到戰鬥結束都失效，並把那一件標成被卸下（`implants[i].gone`）；變成戰利品是 M4 的事，這一張只標記並在結束的報告多一行 |
| `needs.implant_off` | 目標身上已經有一件被干擾的義體（找縫：無視 4 點） |
| `mods` 的 `when.other_contract` | 對手有契約義體（`implants` 裡有 `contract`） |

其餘都是通則：戰場急救（`heal` `'2d6+skill:medicine'` 加 `cleanse`）、拆解（`check` 義體學對迴避、`stop`，再 `implant`）、呼呼不燙了（`choose`：排 8 點或消一層）、不痛不痛（`hp_half` 的反應，`who: 'near'`）、拉回來（`revive`）、找縫（`attack` 的 `as` 加 `pierce`）、短路（`attack` 改電磁，命中而且目標有義體才暈眩）、排好隊喔（`who: 'near'`）、急凍（`overload` 的 `keep_turn`）、還不准睡（`out_before` 的 `prevent`）、戰地手術（`wound` 的 `treat`）、全面翻修、極限超頻（`buff`：每回合回復 +1、命中 +1，結束時餘韻 +1）、手手拿開（`after` 的反應，`if: 'melee'`）、主刀（`wound_grade` −1，`who: 'adjacent'`）。

## 二、驗收條件

- 手術刀：用帶 `medical` 標籤的假道具替相鄰的隊友急救只花 1 點（原本 2）、回的生命多「樹階」點；替不相鄰的人用照原價。
- 縫合手、主刀、名醫疊加：一次戰場急救多回 12 點；道具的急救也多。
- 拆解：檢定沒過什麼都不發生；過了，目標多一個 `off_<種類>` 的狀態到他下一回合結束；目標沒有義體時這個技能灰掉、原因是一句完整的話；對掛著的無人機有效（它下一次不能動作）這一條如果做不到列在回報裡。
- 超頻：隊友得到 `boost_<種類>`，結束時感載 +4。
- 拉回來：相鄰、生命歸零倒下的隊友回到場上、生命是 2d6＋醫療；餘韻疊滿昏過去的人選不了、原因寫出來；每場一次。
- 急凍：隊友過載時照樣多一層餘韻、但下一回合照常行動；行動點不夠不觸發。
- 還不准睡：隊友停在生命 1、留在場上；每場一次。
- 戰地手術：重的重創變輕的、輕的解除。卸下：那一件到戰鬥結束都失效、結束的報告多一行。
- 巡房（姿態）開著時每回合第一次對相鄰隊友治療不花行動點，第二次照原價。
- 極限超頻：三回合每回合多回 1 點行動點，結束時多一層餘韻。
- 沒有 `medical` 標籤的道具吃不到手術刀的減免。
- 回報裡附這棵樹二十七個技能的鍵對照表；寫不出來的列原因。

## 依賴

M1b-core-overlay（`implants`）、M1b-ops、M1b-skill-format、M1b-data-rules（`off_*`、`boost_*` 的狀態；測試可以自帶）。和其他改 `features/abilities` 的工單不要同時做。

## 完成時回報

改了哪些檔、測試結果、對照表、遇到的規格問題。
