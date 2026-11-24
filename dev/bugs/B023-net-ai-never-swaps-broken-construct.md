# B023：內海單位的武器構裝破損之後，AI 不會換構裝（net_swap 沒有 aiScore），整場拖成僵局
- 發現者：cpp-architect（M3 冒煙：內海委託第四階段，兩個人的隊伍用 `playOut`（雙方都由 AI 選動作）打一個巡邏的精英蕾絲，打了 19 回合以上，追蹤度一路漲、最後我方倒下）
- 嚴重度：錯誤（只在「AI 替那個單位出手」時才看得到：敵方的蕾絲與潛網者、玩家按「自動戰鬥」的我方化身；玩家自己按「換構裝」是對的）
- 規格出處：CYBERSPACE 6.5 節（破損：自然 20 或瞄準過的攻擊打出要害，「目標的一個構裝槽失效」；重：到登出之後修好為止）、6.3 節行動表（有「換構裝」）；ENEMIES 4.3 節（AI 每一步從能做的行動裡挑分數最高的）。
- 實際行為：`features/netcombat/actions.ts` 的 `net_swap` 沒有 `aiScore`，AI 永遠不會選它。手上那個構裝破損（`unit.ext.net.broken` 有它的 id）之後，`net_attack`／`net_melee` 的 `blocks`（`weaponBlocks`）把攻擊灰掉，單位只剩管理行動、回填與結束回合：身上明明還有沒破損的構裝，卻再也不攻擊。
  - 重現（最小）：`makeNetBattleGame()`（四個有甲板的化身對四隻蕾絲；主角裝了槍、近戰、干擾三個武器構裝），把 `a1` 的槍標成破損（`a1.ext.net.broken = ['cs_tw_gun']`），讓程式替他出手（`game.battleNext({ anyone: true })`，和 `playOut` 同一條路）：輪到他的這一回合只做了造牆與標記，`wield` 還是 0、敵方的感載沒有增加，也沒有換構裝。
  - 整場的樣子：內海委託第四階段的巡邏（一隻精英蕾絲，自然 20 打破了我方主角與隊友的槍），兩個人之後都不再攻擊，只剩造牆、標記與結束回合；敵方每輪追蹤度 +3，第 14 回合隊友倒下，戰鬥拖到 19 回合以上、最後結果是 lose，整場跑了十幾秒。M3 冒煙為了避開它，內海戰鬥的我方改由 `testkit` 的 `playNetOut` 出手（破損了就換構裝）。
  - 現實戰鬥的 `swap`（`features/combat/attack.ts`）也沒有 `aiScore`，但現實的武器不會破損，所以沒有同樣的問題。
- 重現：會失敗的測試 `engine/tests/pending/B023-net-ai-never-swaps-broken-construct.test.ts`（第一條照預期失敗，「沒有破損時 AI 照常攻擊」那一條現在就會過）。這個臭蟲只要 `battleNext({ anyone: true })` 一步就看得到，不需要另外的固定檔。
- 可能的位置（只寫推測，不改）：`engine/src/features/netcombat/actions.ts` 的 `swap`（`net_swap`）加 `aiScore`：手上的構裝破損（`brokenOf(u).includes(wielded(u).id)`）而且有沒破損的別的構裝時給一個比結束回合高的分數（例如 2.5，比攻擊 2 高：破損了先換），沒有這個情形時回傳 null；`aiTarget` 用不到（`target: 'none'`）。`run` 沒寫 `pick.weapon` 時已經會換到「下一個沒有破損的」，不必另外改。
