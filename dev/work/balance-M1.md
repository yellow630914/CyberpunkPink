# balance-M1：M1 開工後的平衡重跑

這一份是給一個新的工作階段的完整提示，貼上去就能開工，不需要前面的對話。

## 你是誰、在哪裡做

- 專案是 CyberpunkPink（`/home/user/CyberpunkPink`）。設計書在 `docs/`，用繁體中文寫；寫回去的文字照 `docs/README.md` 的維護規則與 [NPCS](../../docs/world/NPCS.md) 1.3 節的文字規則（數字直接寫、不寫沒頭沒尾的短句）。
- **開一條自己的分支**（例如 `balance/M1`），從目前的主線切出去，所有的改動與提交都在這條分支上；做完回報，不要合併。
- **不碰 `engine/` 與 `ui/`**：別的工作階段正在那裡寫程式。引擎的資料（`engine/data/`）裡要跟著改的數字，列在回報裡，由主線交給引擎那邊改。
- 可以改的：`tools/balance/sim.py`、`docs/systems/BALANCE.md`、`docs/systems/ENEMIES.md`（1.5 節的目標表與第 13 節）、`docs/systems/COMBAT_SYSTEM.md`（第 5 節的武器表）、`docs/systems/CORE_RULES.md`（只在數字本身要改時）、`docs/plan/PLAN.md`（5.1 節）、`docs/log/DECISIONS.md`。

## 先讀

1. `docs/plan/PLAN.md` 5.1 節：交給平衡的事，其中兩項是這一次的重點（重傷的 −2、首領戰的遮蔽）。
2. `dev/adr/0013-M1-開工的解讀與暫定值.md`：A5（重傷的 −2）、B1（穿甲只抵銷護甲）、C1（餘韻落成命中、迴避、豁免各 −1）、C9（首領戰的遮蔽）、D7（十場基準遭遇）。這些都已經由使用者採用、寫進設計書。
3. `docs/systems/BALANCE.md` 第 1 節（方法）、第 2 節（曲線）、第 3 節（允許的誤差）、第 4 節（模擬的結果，格式照這裡）。
4. `docs/systems/ENEMIES.md` 1.5 節（目標表與位階的傷害倍率）、第 13 節（點數、損耗的目標、首領戰的遮蔽、基準遭遇）。
5. `docs/systems/CORE_RULES.md` 4.1 節（重傷）、4.2 節（餘韻）；`docs/systems/COMBAT_SYSTEM.md` 第 3～5 節（命中、護甲、武器表）。
6. `tools/balance/sim.py`；跑法 `python3 tools/balance/sim.py all --trials 2000 --seed 7`（BALANCE 第 4 節用的種子）。
7. 只讀、不改：`engine/data/world/encounters.json`（十場基準遭遇）、`engine/data/world/enemies.json`（名冊轉成的資料）、`engine/data/rules/weapon_classes.json`。

## 要做的事

先在不改任何東西的情況下跑一次 `all`，把輸出存在 scratchpad 當對照。

1. **重傷的 −2 也扣命中。** 規則是：生命值低於一半時所有檢定 −2，戰鬥裡命中與豁免都扣，迴避不扣（CORE_RULES 4.1 節）。`sim.py` 的 `attack()` 沒有這一項。替主角與敵人都加上，重跑 `encounter`、`capture`、`grade`、`duel`、`key`、`legend`、`mech`、`cross`。
2. **餘韻的 −1。** 每一層餘韻讓命中、迴避、豁免各 −1（CORE_RULES 4.2 節）。確認 `capture` 這一類的模擬有沒有算；沒有就加上再重跑。
3. **穿甲只抵銷護甲**（COMBAT_SYSTEM 第 4 節）：`attack()` 已經是 `max(0, 護甲 − 穿甲)`，確認其他地方（`swing()`、名冊的檢查）也一致。
4. **首領戰的遮蔽。** 引擎用具名的情境自動對打的結果：「一邊倒」勝率 69～88%、掉 60～77% 的生命；「中」勝率 90～95%、掉 45～56%；現在具名的首領戰用「中」。`sim.py` 的遮蔽是固定的比例（`COVER`）或遭遇點的配置（`d.cov`）。把首領戰用「中」與「一邊倒」各跑一次，提出建議：維持「中」、一邊倒的首領戰減點數、或改配置。
5. **暫定的武器數字**（COMBAT_SYSTEM 第 5 節，標了 ※ 的）：感官彈槍 3d6、彈匣 2；電擊鞭與費洛蒙霧 2d6；重武器 7d6。照 BALANCE 2.3、2.7 節看這幾個數字放在主角手上合不合理；要改的話寫回表上，拿掉 ※。
6. **十場基準遭遇**（ENEMIES 第 13 節、`engine/data/world/encounters.json`）：每一場用模擬器的組合重現（兵種的修正照 `enemies.json` 的 `mods`），確認一般遭遇、首領戰、小衝突各落在目標裡。

## 目標（普通難度、同級四人）

- 一般遭遇（4 點）：掉 10～15% 的生命，勝率 100%。
- 首領戰（8 點）：掉 30～50% 的生命，勝率 90% 以上。
- `capture`：一般遭遇每人過載 0.5 次以下、沒有人倒下；首領戰每人過載 1～2 次、平均倒下 0.5 人以下、勝率 90% 以上。
- 對決：勝率 80% 以上、掉 50～70%。
- 誤差照 BALANCE 第 3 節。

重傷的 −2 加上之後，數字多半會變兇。先調**曲線**（ENEMIES 1.5 節的目標表、位階的傷害倍率、預算），不要一個兵種一個兵種地補；改了曲線，內容表（名冊）因為只寫相對的修正，不用動。

## 做完

- 結果照 BALANCE 第 4 節的格式寫回去；改過的數字寫回原本的那一節（現在式，不留「原本是」）。
- `docs/log/DECISIONS.md` 對應的檔案底下每一項加一條「2026-11-xx｜決定了什麼（原本 → 現在）」。
- `docs/plan/PLAN.md` 5.1 節：解決了的拿掉，沒解決的寫目前的假設。
- `python3 tools/docs/check.py` 要 0 個問題。
- 在自己的分支上提交，回報：改了哪些檔與哪幾節、重跑前後的主要數字、引擎的資料要跟著改的地方（`engine/data/` 的哪個檔、哪個欄位、改成多少）、還沒解決的事。
