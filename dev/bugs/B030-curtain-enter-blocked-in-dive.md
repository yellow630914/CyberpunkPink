# B030：站在暗礁的簾口（潛入裡的網內街區）報名簾後館，被潛入的活動擋下
- 發現者：cpp-architect 角色（M4-smoke，簾後館那一條主幹）
- 嚴重度：阻斷（示意包與冒煙的假世界都把簾口放在「潛入之後選去處才站得到」的網內街區；照那條路走，簾後館一場也報不了名）
- 規格出處：CYBERSPACE 8.8 節「怎麼進去」第 2 點（簾口是暗礁的一個節點，要站在簾口報名）；dev/adr/0019 第十二節與第十四節（設施種類的欄位 `curtain_door`）；dev/work/M4-curtain-entry.md 第 6 點（「往 `netrun` 的放行清單加 `commit:curtain.`」只寫了 netrun，沒有寫潛入）。
- 實際行為：
  - 潛艙店潛入（`dive.enter`）→ 選去處 `net_site`（`kind: 'block'`，簾口所在的街區）→ 人站在簾口設施上，`doorBlock` 認得（站對地方了）。
  - 這時 `enterBlocks` 回傳 `['你的意識在網內，身體躺在潛艙店。先登出。']`，`enterDraft` 丟 `ActionBlocked`。原因：活動 `dive`（`features/dive/index.ts` 的 `DIVE_ALLOW`）只放行 `commit:dive.`、`commit:netrun.`、`commit:maze.` 等；簾後館只對活動 `netrun` 加了 `commit:curtain.`（`features/curtain/index.ts` 第 219 行：`k.activity.allow(ACT_NETRUN, 'commit:curtain.', OWNER)`），沒有對 `dive` 加。迷宮館（`commit:maze.`）是寫死在 `DIVE_ALLOW` 裡的，簾後館沒有對應的一行。
  - 面談（`curtain.interview`）、口味單（`curtain.taste`）在現實做，不受影響；只有「站在簾口報名」這一步被擋。
- 重現：`engine/tests/pending/B030-curtain-enter-in-dive.test.ts`（目前會失敗：`enterBlocks` 有潛入擋下的那一句）。冒煙 `engine/tests/smoke/m4-curtain.test.ts` 改走大廳 F4 的「街上的簾口」（不經過潛入，兩種簾口都在 `worldBody.ts`）才走得完；修好之後再補一條潛入的主幹。
- 可能的位置（只寫推測，不改）：`features/curtain/index.ts` 的 install 多一行 `k.activity.allow('dive', 'commit:curtain.', OWNER)`（`dive` 要先定義：curtain 在 `FEATURES` 裡排在 dive 後面，M4-curtain-entry 本來就要求）；或 `DIVE_ALLOW` 加 `commit:curtain.`（和 `commit:maze.` 一樣；但 dive 不該認得簾後館，前者比較合分層）。要不要同時放行 `commit:curtain.` 的其他動作（點單、賞箱、化妝室都是一趟 `netrun` 裡面的，已經在 netrun 的清單裡；潛入的活動本身會在 `curtain.enter` 開 `netrun` 之後被擋在後面，見 B031）要一起想。
