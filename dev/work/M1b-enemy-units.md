# M1b-enemy-units

- 交給：cpp-feature（sonnet）
- 目標：敵方的無人機與砲塔（和人重疊、掛在格上）、跟著主人的附屬單位、會指揮無人機的敵人（機師兵種），以及沒有操作者的機器每一輪自己動。機甲只收格式（M6）。
- 規格出處：ENEMIES 第 10 節整節、第 3 節站位表的「無人機」那一列、11.4 節只看第一段（敵方機甲誰在開）、第 13 節點數那一段（小型無人機 0.5 點）；COMBAT_SYSTEM 9.1 節；ENEMIES 第 2 節 `position` 那一列（`size: overlay`）；dev/adr/0015 第三節、E6。
- 可以改的路徑：`engine/src/features/enemies/`、`engine/src/features/summons/`（每一輪自己動、砲塔這個種類、被電磁打到停一回合）、`engine/tests/features/M1b-enemy-units.test.ts`。
- 可以用的介面：`run.addOverlay`、`run.overlayAttack`、`BattleOverlay` 的 `owner?`、`weapon`、`auto`、`autonomous`；掛點 `battle.start`、`round.start`、`attack.after`；效果 `drone.act`（M1b-skill-pilot）；`k.battle.action`（`aiScore`）；`targetWeight`（核心的 AI 挑目標）；`weaponFromClass`、`ENEMY_CURVE`（`features/enemies` 自己的）。
- 不可以做的事：不改核心；`enemies` 與 `summons` 不互相 import（敵人只負責把東西掛上去與註冊操作者的行動，「一台怎麼動」都在 `summons`）；不做「把自律的搶過來」；不做機甲；不改名冊的資料。

## 一、敵人資料的格式（`features/enemies`）

- `position.size: 'overlay'`：這個兵種不是一個單位，是掛在格上的一台。另外寫 `overlay: { kind（attack、shield、scout、medic、jammer、turret）, fixed?（砲塔：不會移動） }`。數值照目標表乘修正（生命的修正可以低到 0.5）：耐久 = 生命、護甲、迴避 = 目標表的迴避 + 3 + 修正；武器是它的第一把（命中照目標表）；傷害倍率照位階與難度（放在 `ext.dmgMult`）。
- 遭遇的 `foes` 裡這種兵種：`{ enemy, slot }`（掛在敵方哪一格；沒寫照 `position.prefer` 的第一個空的）。`setupFromEncounter` 把它們放進 `origin.ext.enemies.overlays`，開打時（`battle.start`）用 `run.addOverlay` 掛上去：沒有操作者、`auto: true`。
- 附屬單位：主人的資料寫 `attached: [{ enemy（一個 overlay 的兵種）, count?, slot?（`same` 或第幾格）}]`。開打時掛上去：`owner` 是主人、`autonomous: true`（主人倒下之後自律：E6）。
- 點數：`encounterPoints` 每一台 0.5 點（附屬的不另外算）。
- 會指揮的敵人：身上有附屬單位的 AI 單位多一個行動 `enemy.command`（1 點行動點；目標是他自己還沒動過的一台；做的事是效果 `drone.act`）；`aiScore` 2（和武器攻擊同一個基準），所以他一回合會多出手。
- `kind: 'mech'` 的兵種多收一段 `hull`（照核心 `BattleHull` 的欄位），只檢查格式、不啟動。

## 二、每一台怎麼動（`features/summons`）

- 種類多一個 `turret`：動作是用它自己的武器射擊；不能移動、不能收回。
- **有 `weapon` 的一台**（敵方的、砲塔）射擊時用 `run.overlayAttack`，不用操作者的操縱；沒有 `weapon` 的照舊（我方的無人機用操作者的操縱）。
- **每一輪自己動**（`round.start`）：每一台 `auto`、沒被擊落、沒被停住的各做一次動作。攻擊類的目標用核心的 `targetWeight` 挑（用它的替身當挑的人）；`ext.orphan` 的（主人倒下之後自律）命中 −2、不移動。
- **電磁**：一台被電磁傷害打到而且沒被擊落，停一回合（下一次輪到它不動；記一拍）。機器的單位（佔一格的）被電磁打到失去下一個回合，做在同一個掛點（`attack.after`）。

## 三、驗收條件

- 一場假的遭遇：兩個人加一台 `size: 'overlay'` 的巡邏無人機。開打之後它掛在指定的格上、不佔格、不在先攻的順序裡；每一輪開頭自己打我方一個人一次；被打下來之後不再動。
- 它的數字：耐久是目標表的生命乘修正、迴避是目標表 +3；傷害有乘位階的倍率。
- 砲塔：不能被移動；被電磁打到下一輪不開火、再下一輪照常。
- 附屬單位：主人帶兩台。主人的回合會用 `enemy.command`（固定骰面下選得到）、每台一回合一次；主人倒下之後兩台還在、每一輪自己打、命中的明細多一項 −2。
- 我方的無人機不受影響：主人倒下照舊停機（`M1-summons` 的測試全過）。
- 玩家可以選它當射擊的目標；範圍的投擲物打到它那一格時一起打到（M1b-ordnance 做完才驗得到，還沒做完標 `it.todo`）。
- 點數：兩個雜兵加一台是 2.5 點。
- `kind: 'mech'` 帶 `hull` 的資料載得進來、開打時沒有機體。
- 存檔往返：帶著敵方無人機的戰鬥存了再讀，接著打的結果一樣。

## 依賴

M1b-core-overlay、M1b-skill-pilot（`drone.act`，而且兩張都改 `features/summons`：這一張後做）、M1b-enemy-moves（都改 `features/enemies`：這一張後做）。

## 完成時回報

改了哪些檔、測試結果、ENEMIES 第 10 節那張「兵種在哪裡」的表裡哪幾種這套格式還放不進去。
