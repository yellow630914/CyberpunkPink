# M0-fix-data

- 交給：cpp-data
- 目標：照 AI_TASKS 3.1 節（已定案）的行動種類表建 `engine/data/rules/actions.json`，放進 `CORE_PACK`；`creation.json` 補三個欄位（CHARACTER 5.4 節）。
- 規格出處：AI_TASKS 3.1 節的「行動種類表」與表上面的欄位說明；CHARACTER 5.4 節（只看「起始的義體點數」「起始的裝備點數」「沒花完的點數」三句）。只讀這兩處。
- 可以改的路徑：`engine/data/rules/actions.json`（新增）、`engine/data/rules/creation.json`、`engine/data/index.ts`、`engine/tests/data/`、`engine/tests/pending/M0-fix-data.test.ts`（只在搬檔時動，內容不改）。
- 可以用的介面：
  - 行動種類的格式（等於 schema）：`engine/src/core/content/kinds.ts` 的 `ActionKindEntry` 與 `action_kind` 的 `validate`。
  - 建角的數字的格式：同一個檔的 `CreationRuleEntry`（這一批加了三個選填的欄位）。
  - 驗證的方法：`createKernel().content.loadPack(CORE_PACK)` 加 `content.checkRefs()`；再用 `new Game({ features: allFeatures(), content: [CORE_PACK] })` 確認行動種類的功能收得下（它會檢查參考範圍裡每一筆效果）。
- 不可以做的事：
  - 不改 `engine/src/`、不改 `ui/`。格式不夠用就停下來回報。
  - 不補設計書沒寫的數字，不自己把「一則情報」「親密度 +2」這類寫成效果（引擎現在套不了，見下面「參考範圍」）。
  - 不動 `engine/data/world/`（勢力與 NPC 的 id 表）與 `origins.json`（這一批已經改成 id）。
- 驗收測試：`engine/tests/pending/M0-fix-data.test.ts`；必須全部通過。跑法：在 `engine/` 跑 `npx vitest run --config vitest.pending.config.ts M0-fix-data`。通過之後 `git mv engine/tests/pending/M0-fix-data.test.ts engine/tests/data/M0-fix-data.test.ts`，再跑 `npm test` 與 `npx tsc --noEmit`，兩個都要過。
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題；另外在 `ui/` 跑一次 `npm test`，把因為這份資料而變紅的測試列出來（不要改 `ui/`，見「已知的事」第 2 點）。

## 一、`engine/data/rules/actions.json`

一個陣列，十九筆，順序照表格由上到下。表格有二十二種，其中三種**不寫**：`bargain`（殺價）、`work`（打工的一班）、`stream_daily`（日常直播）。它們的屬性、基本功或 DC 寫的是「照某個系統」，現在的格式寫不進去，等那三個系統搬進來再加。

每一筆的欄位：

| 欄位 | 怎麼填 |
|---|---|
| `id` | 表格的 id |
| `name` | 表格「名稱」那一格**括號前面**的字。例：`搜刮（翻垃圾、拆廢品）` → `搜刮`；`搜索、查證` 沒有括號，整格照抄 |
| `desc` | 表格「名稱」那一格整格原文（含括號） |
| `attr` | 表格的屬性 |
| `skill` | 表格的基本功。`free` 的「判定選」不寫這個欄位；`escape` 的「`athletics`（開車時 `piloting`）」寫 `athletics` |
| `dc` | 表格的 DC 換成檔位的 id：13 → `"normal"`，16 → `"hard"` |
| `minutes`、`max_minutes` | 表格「時間」那一格的兩個數字（平常／最多） |
| `chain` | 只有 `flirt` 寫：`"adult_action"`（表格「鏈」寫 3.5 節）。其餘十八種不寫這個欄位 |
| `hint` | 見下面「參考範圍」。沒有的不寫這個欄位 |
| `hint_note` | 見下面。十九筆都要有 |

欄位的順序照上表。不寫 `tags`、`requires`、`blocked_text`、`hint_by_grade`。

十九筆的 id、屬性、基本功、DC、時間（對照用，和表格不一樣時以設計書為準並回報）：

| id | name | attr | skill | dc | minutes | max_minutes |
|---|---|---|---|---|---|---|
| `free` | 自由行動 | `intellect` | （不寫） | `normal` | 30 | 240 |
| `beg` | 乞討 | `charm` | `perform` | `normal` | 60 | 240 |
| `rumor` | 打聽 | `intellect` | `streetwise` | `normal` | 60 | 240 |
| `search` | 搜索、查證 | `intellect` | `investigate` | `normal` | 30 | 120 |
| `scavenge` | 搜刮 | `intellect` | `investigate` | `normal` | 60 | 240 |
| `tail` | 跟蹤 | `reflex` | `stealth` | `hard` | 60 | 240 |
| `pickpocket` | 扒竊 | `reflex` | `stealth` | `hard` | 15 | 60 |
| `sneak` | 潛入 | `reflex` | `stealth` | `hard` | 30 | 120 |
| `lockpick` | 撬鎖 | `tech` | `mechanics` | `normal` | 15 | 60 |
| `hack` | 駭入一台裝置 | `intellect` | `interface` | `hard` | 30 | 120 |
| `climb` | 攀爬、破門 | `body` | `athletics` | `normal` | 15 | 60 |
| `escape` | 甩掉追的人 | `reflex` | `athletics` | `hard` | 15 | 60 |
| `persuade` | 說服、拜託 | `charm` | `negotiate` | `normal` | 30 | 120 |
| `deceive` | 唬人、混進去 | `charm` | `perform` | `hard` | 15 | 60 |
| `threaten` | 威脅、逼問 | `resolve` | `intimidate` | `normal` | 15 | 60 |
| `busk` | 街頭表演 | `charm` | `perform` | `normal` | 60 | 240 |
| `repair` | 修理 | `tech` | `mechanics` | `normal` | 60 | 240 |
| `first_aid` | 急救 | `tech` | `medicine` | `normal` | 10 | 30 |
| `flirt` | 誘惑、搭訕 | `charm` | `seduce` | `normal` | 30 | 120 |

### 參考範圍

表格「參考範圍（I 級）」那一格用「／」分成三段：成功、勉強成功、失敗。

**`hint_note`（十九筆都寫）**：三段的原文照抄，鍵是 `success`、`narrow`、`fail`。例（`free`）：

```json
"hint_note": { "success": "現金約 20 或一則傳聞", "narrow": "現金約 10", "fail": "沒有" }
```

原文裡的 Markdown 記號拿掉：連結只留文字（`[DOWNTIME](…)` → `DOWNTIME`），反引號拿掉。所以 `first_aid` 的三段是「照 DOWNTIME 3.1 節：回 1d6 + 醫療等級、算處理過」「同成功」「沒處理好；大失敗 −1d4」。其餘的字（全形標點、「−」號、引號）一個都不改。

**`hint`（只有六筆寫）**：引擎現在只套得了現金與生命值，所以只把這兩樣寫成效果；其餘的（情報、物品、親密度、狀態、敵對值、豔名）只留在 `hint_note`，等那些系統搬進來再改寫。照下表原樣寫，表裡沒有的鍵不寫：

| id | `success` | `narrow` | `critical` | `fail` | `fumble` |
|---|---|---|---|---|---|
| `free` | `[{ "kind": "cash", "amount": 20 }]` | `[{ "kind": "cash", "amount": 10 }]` | `[{ "kind": "cash", "amount": 30 }]` | | |
| `beg` | 現金 20 | 現金 10 | 現金 30 | | |
| `pickpocket` | 現金 30 | 現金 15 | 現金 45 | | |
| `busk` | 現金 25 | 現金 10 | 現金 38 | | |
| `climb` | | `[{ "kind": "hp", "amount": -2 }]` | | 生命值 −2 | 生命值 −2 |
| `escape` | | 生命值 −2 | | | |

- 大成功（`critical`）是成功那一格的現金乘 1.5，四捨五入到整數（25 × 1.5 = 37.5 → 38）。表格上面的說明：「大成功照成功再多約一半」。
- `climb` 的失敗是「生命值 −1d4」：參考範圍只能寫固定的數字，先寫 −2；大失敗照失敗。原文留在 `hint_note`。
- 其餘十三筆不寫 `hint`。

## 二、`engine/data/rules/creation.json`

`default` 那一筆加三個欄位（放在 `start_money` 後面），其餘不動：

```json
"gear_points": 12,
"cyber_point_cash": 500,
"gear_point_cash": 150
```

出處：CHARACTER 5.4 節（起始的裝備點數 12 點；沒花完的義體點數每點換 C$500；沒花完的裝備點數每點換 C$150）。

## 三、`engine/data/index.ts`

- import `./rules/actions.json`，在 `CORE_PACK.content` 加 `action_kind: actions`（放在 `effect_cap` 後面）。
- `SOURCES` 加一行 `action_kind: 'AI_TASKS 3.1 節的行動種類表（殺價、打工、日常直播等那三個系統搬進來再加）'`；`creation_rule` 那一行不用改。

## 已知的事

1. 資料裡的 `free` 會取代核心內建的自由行動（`engine/src/core/action/kinds.ts` 的 `FREE_ACTION`）：屬性、DC、時間一樣，多了參考範圍。`flirt` 寫了別的鏈，行動種類的功能先不把它註冊成可以做的行動（那一條鏈還沒搬進來）；這兩件事引擎已經做好，驗收測試會驗。
2. `free` 有了參考範圍之後，AI 關閉時成功的自由行動會拿到參考範圍的一半（現金 10 或 5）。`ui/` 的測試裡假設「自由行動不改錢」的地方會變紅：列出來回報就好，由 cpp-ui 接。這條規則本身（任何成功的自由行動都給錢）已經回報給設計書那邊確認。
3. `chain` 的 id `adult_action` 是暫定的名字（dev/adr/0009 第 6 項）。
