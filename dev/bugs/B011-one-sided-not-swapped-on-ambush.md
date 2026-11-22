# B011：「一邊倒」的遮蔽配置在我方埋伏時沒有對調
- 發現者：cpp-tester-whitebox
- 嚴重度：小問題（現在要同時用 `cover: 'one_sided'` 與 `ambush: 'ally'` 才會碰到；委託模板與要地是 M2，那時才會有「一邊倒」的遭遇點被我方埋伏）
- 規格出處：SITES 12.2 節表「一邊倒……守方（敵人）佔好位置的遭遇點；從後門進來或我方埋伏時對調」，表下「埋伏與被埋伏照 COMBAT_SYSTEM 2.1 節再調一級」；COMMISSION_MAPS 1.3 節同；COMBAT_SYSTEM 2.1 節「從另一個入口進場時，兩邊對調」。dev/adr 沒有把這一條定成別的做法。
- 實際行為：`setupBattle`（`engine/src/core/battle/setup.ts`）不管誰埋伏，一律取 `COVER_LAYOUTS.one_sided`（我方 半 暴 暴 暴、敵方 掩 掩 半 半），再做埋伏的調整。我方埋伏時變成我方 [2,0,0,1]、敵方 [1,1,0,0]（索引 0 是第 1 格；0 暴露、1 半掩體、2 掩體）：敵方還佔著半掩體，埋伏的我方反而幾乎暴露。
- 重現：`setupBattle(k, state, { …, cover: 'one_sided', ambush: 'ally' })`。期望先對調（我方 [2,2,1,1]、敵方 [0,0,0,1]），再埋伏（我方第一個不是掩體的格升成掩體、敵方降一級）：我方 [2,2,2,1]、敵方 [0,0,0,0]。
  會失敗的測試：`engine/tests/pending/B011-one-sided-ambush-swap.test.ts`（第一個失敗；第二個對照——沒有人埋伏、敵方埋伏——會過）。
- 可能的位置（只寫推測，不改）：`setupBattle` 在算 `levels` 之前，`setup.cover === 'one_sided'` 而且 `setup.ambush === 'ally'` 時把 `layout.ally` 與 `layout.foe` 對調。「從後門進來」要等 M2 的遭遇點知道是從哪個入口進來，另外處理。
