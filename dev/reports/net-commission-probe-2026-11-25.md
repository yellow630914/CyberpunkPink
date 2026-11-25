# 探針紀錄：內海委託整條（2026-11-25）

腳本：`engine/tests/probe/net-commission.probe.test.ts`；情境：`makeNetCommissionGame()`（種子 6、寫好的四階段內海副本 cm_tw_net、隊伍主角加一位行者）；AI 關閉。

## 報告表（每一份提交的報告）

| # | 步驟 | action | kind | 結果 | 分鐘 | changes | 追蹤度 | 步驟結束時進行中的活動 |
|---|---|---|---|---|---|---|---|---|
| 1 | 出發 | fixer.go | gig | go | 0 | fixer.depart | — | commission |
| 2 | 出發 | commission.enter | gig | entered | 0 | snapshot.take ext | — | commission |
| 3 | 第一階段選面與分支 | commission.face | gig | face | 0 | snapshot.take ext | — | face.net+commission |
| 4 | 第一階段選面與分支 | commission.branch | gig | chosen | 0 | ext | — | face.net+commission |
| 5 | 第一階段選面與分支 | netrun.enter | netrun | entered | 0 | uid map.open map.sheet map.at meter ext npcs.memory.add | m2:=0 | face.net+commission |
| 6 | 第一階段走到遭遇旁邊 | grid.move | action | moved | 0 | map.sheet×2 map.ext×7 ext×5 map.at | — | face.net+commission |
| 7 | 第一階段的戰鬥 | netrun.use | netrun | fight | 0 | npcs.memory.add | — | face.net+commission |
| 8 | 第一階段的戰鬥 | battle.end | netrun | win | 0 | snapshot.drop meter map.sheet map.ext ext battle rng chain npcs.memory.add | m2:=1 | face.net+commission |
| 9 | 第一階段過閘門 | grid.move | action | moved | 0 | map.sheet ext map.at | — | commission |
| 10 | 第一階段過閘門 | netrun.use | netrun | pass | 0 | ext npcs.memory.add | — | commission |
| 11 | 第一階段過閘門 | netrun.end | netrun | done | 0 | ext×2 map.at map.close npcs.memory.add | — | commission |
| 12 | 第一階段過閘門 | commission.milestone | gig | milestone | 120 | time ext | — | commission |
| 13 | 第二階段（現實） | commission.face | gig | face | 0 | snapshot.take ext | — | commission |
| 14 | 第二階段（現實） | commission.branch | gig | chosen | 0 | map.open map.sheet map.at meter ext | — | commission |
| 15 | 第二階段（現實） | grid.arrive | action | spotted | 0 | map.ext | — | commission |
| 16 | 第二階段（現實） | battle.end | combat | win | 0 | snapshot.drop cash map.sheet ext battle rng chain npcs.memory.add | — | commission |
| 17 | 第二階段（現實） | commission.milestone | gig | milestone | 120 | time map.at map.close ext | — | commission |
| 18 | 第三階段（現實） | commission.face | gig | face | 0 | snapshot.take ext | — | commission |
| 19 | 第三階段（現實） | commission.branch | gig | chosen | 0 | map.open map.sheet map.at meter ext | — | commission |
| 20 | 第三階段（現實） | grid.arrive | action | spotted | 0 | map.ext | — | commission |
| 21 | 第三階段（現實） | battle.end | combat | win | 0 | snapshot.drop cash map.sheet ext battle rng chain npcs.memory.add | — | commission |
| 22 | 第三階段（現實） | grid.move | action | moved | 0 | map.sheet map.at | — | commission |
| 23 | 第三階段（現實） | grid.move | action | moved | 0 | map.sheet map.at | — | commission |
| 24 | 第三階段（現實） | grid.use | action | done | 0 | map.sheet | — | commission |
| 25 | 第三階段（現實） | grid.move | action | moved | 0 | map.sheet map.at | — | commission |
| 26 | 第三階段（現實） | commission.milestone | gig | milestone | 120 | time map.at map.close ext | — | commission |
| 27 | 第四階段選面與分支 | commission.face | gig | face | 0 | snapshot.take ext | — | face.net+commission |
| 28 | 第四階段選面與分支 | commission.branch | gig | chosen | 0 | ext | — | face.net+commission |
| 29 | 第四階段選面與分支 | netrun.enter | netrun | entered | 0 | uid map.open map.sheet map.at meter ext npcs.memory.add | m5:=1 | face.net+commission |
| 30 | 第四階段下載 | grid.move | action | moved | 0 | map.sheet×2 map.ext×3 ext×2 map.at | — | — |
| 31 | 第四階段下載 | netrun.use | netrun | fight | 0 | npcs.memory.add | — | — |
| 32 | 第四階段下載 | battle.end | netrun | win | 0 | snapshot.drop meter map.sheet map.ext ext battle rng chain npcs.memory.add | m5:=1 | — |
| 33 | 第四階段下載 | grid.move | action | moved | 0 | map.sheet ext×4 map.at | — | — |
| 34 | 第四階段下載 | netrun.use | netrun | download | 0 | meter ext npcs.memory.add | m5:+2 | — |
| 35 | 第四階段下載 | netrun.trace | netrun | trace | 0 | ext npcs.memory.add | — | — |
| 36 | 第四階段下載 | netrun.use | netrun | download | 0 | meter ext npcs.memory.add | m5:+2 | — |
| 37 | 第四階段下載 | netrun.end | netrun | done | 0 | ext×2 map.at map.close npcs.memory.add | — | — |
| 38 | 第四階段下載 | commission.milestone | gig | decisive | 120 | time ext | — | — |
| 39 | 第四階段下載 | commission.finish | gig | done | 0 | ext×2 snapshot.drop×2 meter actor.ext×2 fixer.status fixer.pend | — | — |
| 40 | 第四階段下載 | fixer.payout | gig | paid | 0 | cash meter×4 fixer.settle | — | — |

## 人在網內（face.net 進行中）時，各種事被擋或放行（Game.blockOf）

| doing | 結果 |
|---|---|
| commit:trade.checkout | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:rest.sleep | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:transit.taxi | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:work.start | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:fixer.accept | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:roster.hire | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:deck.equip | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:deck.install | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:deck.remove | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:deck.scripts | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:deck.skin | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:abilities.learn | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:scene.start | 放行 |
| commit:grid.move | 放行 |
| commit:netrun.use | 放行 |
| commit:dive.exit | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |
| commit:maze.enter | 擋：正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。 |

## 活動結束的掛鉤（activity.end，依序）

- battle → win
- face.net → done（trace 1）
- battle → win
- battle → win
- battle → win
- face.net → done（trace 5）
- commission → done（trace 5）

## 探針事件的種類與次數

| 來源 type | 次數 |
|---|---|
| core/state/hooks hook.call | 1044 |
| core/battle/registry hook.call | 550 |
| core/state/commit report.before | 56 |
| core/state/commit report.after | 56 |
| shell/ai/chain chain.step | 32 |
| core/rules/effects effects.resolve | 6 |

## 前 30 個探針事件

```
000 core/state/hooks hook.call report.before
001 core/state/hooks hook.call report.before
002 core/state/hooks hook.call report.before
003 core/state/hooks hook.call report.before
004 core/state/hooks hook.call report.before
005 core/state/hooks hook.call report.before
006 core/state/hooks hook.call report.after
007 core/state/hooks hook.call report.after
008 core/state/hooks hook.call report.after
009 core/state/hooks hook.call report.after
010 core/state/hooks hook.call report.after
011 core/state/hooks hook.call report.after
012 core/state/hooks hook.call report.after
013 core/state/hooks hook.call report.after
014 core/state/hooks hook.call report.after
015 core/state/hooks hook.call report.after
016 core/state/hooks hook.call turn.end
017 core/state/hooks hook.call report.before
018 core/state/hooks hook.call report.before
019 core/state/hooks hook.call report.before
020 core/state/hooks hook.call report.before
021 core/state/hooks hook.call report.before
022 core/state/hooks hook.call report.before
023 core/state/hooks hook.call report.after
024 core/state/hooks hook.call report.after
025 core/state/hooks hook.call report.after
026 core/state/hooks hook.call report.after
027 core/state/hooks hook.call report.after
028 core/state/hooks hook.call report.after
029 core/state/hooks hook.call report.after
```

## 對規格的檢查

全部通過的檢查（腳本裡的 expect）：出發的報告序列；活動登錄表在每一步的組合（commission／face.net／battle）；追蹤度起點 0 且探索中不漲；戰鬥寫回量表的追蹤度 = 3 × 過的回合數 + 管理行動 1（CYBERSPACE 6.8）；內海階段交回的 result.trace 對上量表；現實階段不動追蹤度；第四階段起點等於前面累計；下載兩次；入帳一次、報酬扣掉抽成等於可分的錢；整條做完沒有進行中的活動與快照；沒有被收回的報告；不變式沒有違規；報告前綴在清單裡。

## 記下的事（和規格不完全一致，或規格沒寫清楚）

- 整條共 40 份報告，其中 1 份是 netrun.trace（追蹤度升了、沒跨門檻，只更新 peak，內容只有「追蹤度 N。」）；狀態裡一共有 56 份報告（含接案、加入隊友之前的）
- 整趟的最後追蹤度 5；目標勢力的敵對值 12（內海那一份 1，其餘是現實面的強攻）
- 潛入中（dive）放行換 SKIN（commit:deck.skin）、不放行換腳本（commit:deck.scripts）；但 deck 自己的 skinBlock 與 scriptsBlock 寫法一樣（只擋戰鬥中，註解寫「接入點的限制是 M3-dive 的事」）。規格（ITEMS 11.9：「戰鬥中與潛入中都不能換」寫的是程式與構裝；腳本沒寫）沒有明說潛入中能不能換腳本，待確認
- 委託的 netR.net_watchers（夜鶯與貞網局那一份敵對值）在規則表是空的（ADR 0018 N34：勢力資料匯入之前是空的），所以 NETRUNNING 5 與 COMMISSIONS 8 寫的「夜鶯與貞網局的敵對值上升」現在不會發生；這是已知的，不是新問題
