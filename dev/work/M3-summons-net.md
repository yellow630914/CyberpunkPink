# M3-summons-net

- 交給：cpp-feature（sonnet）
- 目標：`features/summons` 的內海面：守衛程式——和人重疊、不佔格、每格一台、指揮花 1 點行動點，規則和無人機相同，只是名字與數字照資料；機師在內海只能叫出一個、不看同步。
- 規格出處：CYBERSPACE 6.9 節（表的第一列）；COMBAT_SYSTEM 9.1 節（無人機的規則，對照用）；SKILL_TREES 機師的招牌「編隊」的內海欄；ENEMIES 第 10 節（敵方的守衛程式「照同一條」）；dev/adr/0018 N27；dev/adr/0015 第三節（和人重疊的東西）。
- 可以改的路徑：`engine/src/features/summons/`、`engine/tests/features/M3-summons-net.test.ts`。
- 可以用的介面：現有的放出、指揮、移動、收回與自律；`run.addOverlay`、`run.overlayAttack`；修正 `overlay_cap`、`overlay_hp`；`run.mode.layer`；單位的 `pools.ram`。
- 不可以做的事：構裝體不做（和機甲一起，M6）；群眾不做（M5）；不 import `features/netcombat`、`features/abilities`；現實的無人機與載具行為不變；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. 放出、指揮、移動、收回的行動 `modes` 加內海；載具（叫車）仍然只有現實。內海裡畫面上的字照戰場換（行動的名字與說明多一份內海的：「守衛程式」）。
2. 型號的資料（現有的無人機內容種類）多 `net?: true`：內海只列帶這個旗標的型號，現實只列沒帶的。守衛程式的耐久是它自己的一條（核心的 `overlay.hp`），在內海受到的傷害照內海的規則（神經與快感打得到它）。
3. 數量：內海裡每個操作者同時連得住的上限是 1（不看同步），再加修正 `overlay_cap`。
4. 攻擊型的守衛程式開火花不花 RAM：照資料（型號的 `ram`，沒寫是 0）；指揮照舊花操作者 1 點行動點。
5. 被擊落的回灌（操作者受的感載）在內海照同一個數字。接管來的（快駭或管理行動的 `hack.takeover`）照現有的規則，內海不另寫。

## 驗收條件（`engine/tests/features/M3-summons-net.test.ts`；測試自帶兩個型號：一個現實的無人機、一個 `net: true` 的守衛程式）

- 內海戰鬥：放出的選項只有守衛程式；放第二台被擋並有原因；給 `overlay_cap` +1 的修正之後放得了。
- 現實戰鬥：選項只有無人機，數量照舊看同步。
- 指揮守衛程式攻擊一次：操作者少 1 點行動點、目標的感載上升；型號寫 `ram: 1` 時操作者的 RAM 少 1、不夠時灰掉。
- 守衛程式被神經傷害打掉：操作者受回灌的感載、那一格空出來。
- 操作者昏過去：守衛程式進入自律（命中 −2、不移動），和現實一樣。
- 內海戰鬥的圓環上沒有叫車。
- 現有的無人機測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat（內海的戰鬥跑得起來）。做完才能開 M3-skill-net-a（機師那一棵）。

## 完成時回報

改了哪些檔、測試結果、CYBERSPACE 6.9 節沒做的兩列（構裝體、群眾）各自缺什麼。
