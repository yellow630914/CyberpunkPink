# M3-netcombat

- 交給：cpp-feature（sonnet）
- 目標：新功能 `netcombat`：內海的行動表（攻擊、近戰、回填、換構裝、腳本、工具構裝、打牆、監視、換檔）、同步檔位在戰鬥裡的效果、干擾與破損。釘住、拔線、投降、追蹤度與管理行動在後面兩張。
- 規格出處：CYBERSPACE 6.1～6.5 節（全部）、4.1 節；CORE_RULES 第 5 節；COMBAT_SYSTEM 1.3 節（行動表的寫法）、第 6 節（重創，只看內海換成破損的那幾句）；ITEMS 11.1、11.4 節（工具構裝怎麼用、進階與終極效果）；dev/adr/0018 第一、二節與 N4、N11、N25；dev/adr/0014（行動的宣告：`icon`、`picks`、`tags`）。
- 可以改的路徑：`engine/src/features/netcombat/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M3-netcombat.test.ts`。
- 可以用的介面：`k.battle.action`／`on`／`modifier`／`effect`、`BattleRun` 的基本動作（`attack`、`addLoad`、`vent`、`applyStatus`、`hurtCover`、`gainSink`、`save`、`spend`）、掛點 `unit.ready`、`turn.start`、`attack.hit`（`out.negate`）、`attack.after`、`wound`、`overload`；核心的 `syncRuleOf`、`syncCapOf`、`syncBlock`；`unit.ext.deck`（M3-deck 放的：`constructs`）；`k.content`（讀 `construct`、`item` 的資料）；`TEST_NET_COMBAT` 只當參考。
- 不可以做的事：不 import `features/deck`、`features/abilities`、`features/enemies`（只認 `unit.ext.deck`、`unit.ext.net`、標籤與內容的格式）；瞄準與超頻不在行動表上（它們是槍手的技能）；不碰追蹤度（下一張）；不寫任何一件具體構裝的效果（都吃資料）；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 行動（都是 `modes: ['net']`；圈與順序照 UI 第 5 節：內環攻擊與近戰、中環回填、換構裝、腳本、外環打牆、監視、（釘住在下一張））：

  | id | 圈 | 行動點 | RAM | 做什麼 |
  |---|---|---|---|---|
  | `net_attack` | attack | 2（武器自己寫的優先：狙擊型 3） | 武器的（1；重型 2） | 用手上的武器構裝打一個敵人；標籤 `weapon_attack`；手上是近戰原型時做不了 |
  | `net_melee` | attack | 2 | 武器的 | 近戰原型，只能打近身；標籤 `weapon_attack` |
  | `net_refill` | supply | 1 | — | RAM +2，加修正 `refill`；滿的時候做不了 |
  | `net_swap` | supply | 1 | 0 | 換手上的武器構裝（`picks` 列每一把） |
  | `net_script` | supply | 1 | 0 | 用快取格裡一支腳本（物品的 `use.do`） |
  | `net_tool:<構裝 id>` | skill | 構裝寫的 | 構裝寫的 | 每個裝著、不是被動的工具構裝各一個行動 |
  | `net_hit_wall` | tactic | 2 | 武器的 | 打敵方一格的防火牆（照現實「打遮蔽」的倍率；N11） |
  | `net_watch` | tactic | 2 | 0 | 監視；觸發的那一擊照扣 RAM，扣不起就繼續等 |
  | `net_shift` | system | 0 | 0 | 換檔：`picks` 列四檔與開不了的原因 |

- `unit.ext.net`：`{ sync, sync_max, broken: string[], admin?: number, tethered?: boolean }`；`unit.tags` 裡維持一個 `sync:<檔>`。
- 狀態（測試自帶資料；正式的由 M3-data-rules 寫）：`jam_weapon`、`jam_defense`、`jam_tool`（各一回合）。
- 效果：`net.jam`（`{ slot?: 'weapon' | 'defense' | 'tool' }`）、`net.break`（破損一個構裝槽）、`net.fix`（修好一個）、`net.sync`（`{ to }`：把目標的檔位改成某一檔，粉蕾絲的勸降用）、`net.ram`（`{ amount }`：加減 RAM）。
- 規則的內容種類 `netcombat_rule`（`refill`、各行動的行動點、干擾對防火牆的倍率……）。
- 匯出：`netBattleView(k, state)`（給畫面：每個我方單位的檔位、上限與每一檔開不了的原因、破損的槽、這一回合換過檔沒有）。

## 要做的

1. **同步檔位**：`unit.ready` 時替內海的單位設 `unit.ext.net`——角色的上限用 `syncCapOf`，起始是標準（上限不到標準就是淺）；敵人已經帶著的（M3-lace 寫的）不蓋。修正：命中與自己擲的檢定照那一檔的 `check`（N4：迴避不算）、受到的感載照 `load_pct`、全檔每回合多回 1 點行動點與 `admin_uses` +1；全檔過載時沉溺 +2（`run.gainSink`）。換檔每回合一次（加修正 `sync_shifts`），上限是 `sync_max` 加修正 `sync_cap`、最高全檔。敵人資料寫 `shift` 的照 N25 在自己回合開始時換。
2. **構裝的進階與終極效果**：資料的 `advanced` 只在深檔以上生效、`ultimate` 只在全檔（`mods` 經修正、`do` 接在那個構裝的效果後面）。
3. **攻擊**：RAM 照手上那一把的 `pool`；沒有武器構裝的人兩個攻擊行動都做不了（原因一句）。AI 的打分照現實的攻擊（基準 2）；RAM 不夠攻擊時回填的分數提高。
4. **干擾**（CYBERSPACE 6.5）：帶 `jam` 特性的武器命中時不加感載（`attack.hit` 的 `out.negate`），目標的一類構裝停用一回合：攻擊者選類別（`picks`：武器、防護、工具；AI 選武器），武器停用是不能做兩個攻擊行動與打牆、防護停用是防護當 0、工具停用是不能用工具構裝與腳本。打牆時倍率再 ×2。
5. **破損**（內海的重創）：聽 `wound`，只在內海做——目標多一個破損的槽：從裝著的構裝裡（`unit.ext.deck.constructs`）停用一件（攻擊者不選，照武器、工具、防護的順序挑還沒破損的第一件；沒有甲板資料的敵人改成「這一場傷害骰少 1 顆」）。輕的到戰鬥結束；本來就有破損再中一次是重的：結束時寫回角色（`actor.ext.deck` 不是這個功能的，改用角色身上的狀況 `net_broken`，直到修好；M3 沒有修理的地方，登出之後下一次休息拿掉）。雜兵不算破損（核心已經改成多 1 顆骰）。
6. **工具構裝與腳本**：照資料的 `target` 與 `do` 註冊行動、宣告 `picks`；被停用或破損的那一件做不了。
7. **監視**：用核心的監視機制（`unit.watch`），觸發時自動做一次 `net_attack`。
8. 每個行動寫齊 `icon`、`picks`、`tags`、`blocks` 的句子（一條一個條件）。

## 驗收條件（`engine/tests/features/M3-netcombat.test.ts`；單位用 `from: 'unit'` 直接給，`unit.ext.deck.constructs` 與武器寫在測試裡；另一組測試和 `deckFeature` 一起裝、用角色進場）

- 內海戰鬥的圓環有表上的九種（工具照裝著的數量），沒有任何現實的行動；現實戰鬥沒有它們。
- 攻擊花 2 行動點與武器寫的 RAM；RAM 不夠時灰掉並有原因；狙擊型的那一把花 3 點。
- 回填 +2；測試給一個 `refill` +1 的修正時 +3；滿的時候做不了。
- 四檔的數字：釘死骰面，同一擊在淺、標準、深、全檔的命中合計差 −2、0、+2、+4；同一份原始感載受到的是 ×0.5、×1、×1.5、×2.5（先扣防護再乘）；全檔的人每回合多回 1 點行動點，過載時沉溺 +2。
- 同步 3 級、敏感度 40 的角色最高到深：全檔那一項灰掉、原因寫出缺的是哪個條件；一回合只能換一次；`sync_cap` +1 的修正讓他開得了全檔。換檔之後標籤從 `sync:standard` 換成 `sync:deep`。
- 干擾：命中之後目標的感載沒有變、帶著選的那一類的停用狀態一回合；武器被停用的人兩個攻擊行動灰掉；防護被停用的人受到的感載不扣防護。
- 破損：自然 20 打精英，他的一件構裝進了 `broken`、那一件的行動灰掉；再中一次，戰鬥結束的報告裡有 `net_broken`。打雜兵沒有破損。
- 進階效果：同一把 III 級構裝在標準檔沒有它的 `advanced.mods`，換到深檔就有。
- 監視：敵人站上暴露的格子時自動攻擊一次、RAM 少了；RAM 是 0 時不攻擊、監視還在。
- `shift` 的敵人：感載到上限六成以上的那個回合開始時是淺檔，否則是深檔。
- 隨機打完二十場（測試的最小蕾絲對四個化身）不丟錯、不變式沒有違規；打到一半存檔再讀，結果一樣。
- 掃原始碼：`run` 會讀的每一個 `input.pick` 的鍵都有宣告（沿用 `tests/features/M1-picks.test.ts` 的做法）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-core-battle、M3-deck（`unit.ext.deck.constructs` 的格式）、M3-mode-audit。同一個資料夾的三張排成一串（這一張、M3-netcombat-out、M3-netadmin）。

## 完成時回報

改了哪些檔、測試結果、CYBERSPACE 6.1～6.5 節裡沒做的、還沒有圖的圖示鍵（交 M3-ui-netcombat）。
