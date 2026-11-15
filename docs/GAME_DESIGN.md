# CyberpunkPink 遊戲設計（總綱）

> 狀態：設計階段，尚未動工。這份是入口：這是什麼遊戲、設計原則、遊戲迴圈，以及每個系統寫在哪。規則本身在各系統文件；文件怎麼分類見 [README](README.md)。

## 1. 一句話

玩家是緋夜城的邊緣行者：接委託、改造身體、潛進網路、操弄輿論，在帳單和企業之間活下去。引擎算數字，AI 寫經過。

## 2. 這是什麼樣的遊戲

- **成人向的賽博龐克跑團風格 RPG**，網頁遊戲，架構沿用 [ElondiaRPG](https://github.com/yellow630914/ElondiaRPG)：玩家用介面操作，引擎負責所有擲骰與數值，每次行動後輸出一份報告，交給 AI 寫成小說式的經過。AI 可以關閉。
- **世界**：另一條世界線的 2069 年，緋夜城。腦機介面是從快感迴路突破的，所以義體、網路、媒體、戰爭機器都長在情慾產業上。主流文化是日本的御宅文化。故事只發生在這一座城市（[world/](world/WORLD.md)）。
- **三個戰場**：現實的戰鬥、內海（網路空間）的戰鬥、輿論戰（第 5 節）。
- **主食是委託副本**：獨立於城市地圖的一組地圖，每件委託有一個主戰場，其餘的戰場起輔助作用（第 6 節）。
- **主角沒有職業**：技能想學什麼學什麼，限制在邊緣橋的容量。夥伴的職能固定（第 7 節）。
- **裝備是組裝的**：義體、武器、護甲都由底材與零件構成（[gear/](gear/CRAFTING.md)）。

## 3. 設計原則

**架構**（沿用 ElondiaRPG）

1. **引擎是唯一真相。** 擲骰、傷害、金錢、名聲都由引擎決定並寫進報告。AI 只描寫，不改數字、不新增物品。
2. **AI 可以判定，但後果由程式夾住。** 自由行動擲骰後由 AI 決定成功程度，後果只能是封閉清單裡的效果，數值夾在上限內。
3. **報告即事件紀錄。** 每個動作產生一份報告，`changes` 套用到狀態。
4. **AI 失敗不影響遊戲。** AI 關閉時用報告顯示簡易戰報，遊戲完整可玩。
5. **世界書是設定來源，不是執行邏輯。**

**這款遊戲自己的**

6. **染色不換骨。** 每個情色化的概念，底下都要有一個和原概念等價的功能。粉牆仍然是擋住失控 AI 的牆；蕾絲仍然是防禦程式。判斷一個設定能不能用的方法：把色情的部分拿掉，它還是一個成立的賽博龐克設定嗎？
7. **同步越深，力量越大，回灌越重。** 這個世界的神經介面走快感迴路，所以「接得多深」是共用的風險旋鈕：網內的同步深度、機甲的同步率、加速義體的檔位，都是同一個取捨（[CORE_RULES](systems/CORE_RULES.md) 第 5 節）。
8. **三個戰場。** 現實、內海、輿論。每個技能只在它的戰場裡生效；戰場之間只走幾條明確的通道互相影響（[DOMAINS](DOMAINS.md)）。
9. **一案一團。** 遊戲的基本單位是一件委託，有固定的四拍：接案、踩點、行動、收尾（[FIXER](systems/FIXER.md) 第 2 節）。
10. **一座城市，兩個世界。** 現實的緋夜城幾乎全是固定地圖，給的是熟悉；內海大量隨機生成，給的是未知。沒有世界地圖，沒有別的城市可以去。
11. **機械是買的，生體是養的；什麼都不是搓出來的。** 工藝是組裝，不是製造（[CRAFTING](gear/CRAFTING.md)）。
12. **帳單是敵人。** 房租、義體訂閱、藥、債每週到期。高科技、低生活要用數字感受到。

## 4. 遊戲迴圈

```
            ┌──────────────── 每週結帳：房租、義體訂閱、債、藥 ────────────────┐
            ▼                                                              │
  城市（街區：診所、黑市、夜店、人偶館、中間人的店、自己的據點）                 │
     ├─ 生活：組裝與改造、買賣、治療、經營關係、打工、經營頻道                   │
     ├─ 特殊任務與事件（在城市的地圖上，用劇情旗標）                            │
     └─ 接案（中間人、牆報）                                                  │
           └─▶ 踩點（打聽、勘查、預先駭入、收買）                              │
                 └─▶ 召集同伴、配技能                                         │
                       └─▶ 行動（委託副本：主面＋輔助面）                      │
                             └─▶ 收尾（報酬、熱度、素材、餘波）────────────────┘
```

- 時間以**小時**推進。城市裡走路穿過一個區只要幾十分鐘；壓力來自期限與每週帳單，不是路程。

## 5. 三個戰場

| 戰場 | 是什麼 | 規則 |
|---|---|---|
| **現實** | 街上與樓裡的槍戰、潛入、交涉。**只有這裡能殺人** | [COMBAT_SYSTEM](systems/COMBAT_SYSTEM.md) |
| **內海** | 網路空間。化身對化身、對蕾絲。最重只能造成精神污染 | [CYBERSPACE](systems/CYBERSPACE.md)、[NETRUNNING](systems/NETRUNNING.md) |
| **輿論** | 編輯台上的議題戰役，媒體型的獨立玩法 | [OPINION](systems/OPINION.md) |

八條路數分四類，每類在三個戰場各有一個等級：

| 類 | 路數 | 現實 | 內海 | 輿論 |
|---|---|---|---|---|
| 戰鬥型 | 槍手、機師、改造師 | 強 | 弱 | 無 |
| 竄網型 | 潛網者 | 中 | 強 | 無 |
| 社交型 | 伶人、掮客 | 弱 | 中 | 中 |
| 媒體型 | 主播、偶像 | 無 | 中 | 強 |

定義在 [CORE_RULES](systems/CORE_RULES.md) 6.1 節；每個系統影響哪個戰場的索引在 [DOMAINS](DOMAINS.md)。

## 6. 三種內容形式

| 形式 | 是什麼 | 規則 |
|---|---|---|
| **委託副本** | 一件委託的行動階段：獨立於城市地圖的一組地圖，最多三個面（現實、內海、輿論），各有一條領域指標。**每件委託有一個主面，目標只能在主面完成，其餘的面輔助** | [COMMISSIONS](systems/COMMISSIONS.md) |
| **特殊任務** | 人工編寫的任務鏈，發生在城市的地圖上。用傳統的劇情旗標，沒有主面的限制 | [FIXER](systems/FIXER.md) 第 3 節 |
| **事件** | 走在路上、待在某處時發生的一件事 | （待寫） |

## 7. 主角與夥伴

| | 主角 | 夥伴 |
|---|---|---|
| 職業 | 沒有 | 固定的一到三條路數（主職 5 階、副職 3 階、第三職 2 階） |
| 學技能 | 沒有限制 | 只在自己的路數裡升階 |
| 限制在哪 | **邊緣橋的容量**：現實、內海、社交、媒體四類各自計算；每個技能佔的容量不同，有主動有被動 | 職能與階數 |
| 怎麼決定打法 | 裝哪一座橋、這一趟裝哪些技能 | 召集誰 |

規則在 [CORE_RULES](systems/CORE_RULES.md) 6.2～6.4 節；橋的型號在 [CYBERWARE](gear/CYBERWARE.md) 第 7 節。一件委託最多召集 6 人（含主角）。

## 8. 系統地圖

| 系統 | 文件 |
|---|---|
| **世界** | |
| 世界線、歷史、用語對照 | [world/WORLD](world/WORLD.md) |
| 企業 | [world/CORPORATIONS](world/CORPORATIONS.md) |
| 幫派與街頭組織 | [world/GANGS](world/GANGS.md) |
| 御宅文化、獸化、女僕、偶像、街頭用語 | [world/CULTURE](world/CULTURE.md) |
| 八個區、地圖規模、要地、橋接區、交通 | [world/DISTRICTS](world/DISTRICTS.md) |
| 固定 NPC、夥伴、主線骨架 | [world/NPCS](world/NPCS.md) |
| 錢、身分、法律、等級、牌子、藥、通訊、曆、行規 | [world/LIFE](world/LIFE.md) |
| **規則** | |
| 屬性、基本功、檢定、三條軌、同步、路數、技能與容量、成長、名聲 | [systems/CORE_RULES](systems/CORE_RULES.md) |
| 現實戰鬥、戰敗、女武神機甲 | [systems/COMBAT_SYSTEM](systems/COMBAT_SYSTEM.md) |
| 內海：分區、化身、構裝、網內戰鬥、精神污染 | [systems/CYBERSPACE](systems/CYBERSPACE.md) |
| 竄網：快駭、蕾絲、追蹤度、粉牆 | [systems/NETRUNNING](systems/NETRUNNING.md) |
| 輿論戰：頻道經營與議題戰役 | [systems/OPINION](systems/OPINION.md) |
| 媒體的基礎：素材、觀眾、公信力、直播；偶像 | [systems/MEDIA](systems/MEDIA.md) |
| 委託副本 | [systems/COMMISSIONS](systems/COMMISSIONS.md) |
| 中間人、一案四拍、每週帳單、名冊、人情、據點 | [systems/FIXER](systems/FIXER.md) |
| 成人向：橋參數、調校、豔名、場所、契約、內容篩選 | [systems/LEWD_SYSTEM](systems/LEWD_SYSTEM.md) |
| **裝備** | |
| 義體：部位、人性成本、授權鎖、惡意韌體、溺感症、橋的型號 | [gear/CYBERWARE](gear/CYBERWARE.md) |
| 工藝：底材與零件、等級、機械與生體、組裝 | [gear/CRAFTING](gear/CRAFTING.md) |
| 身上的裝備：欄位、外套、藏匿、快取格 | [gear/EQUIPMENT](gear/EQUIPMENT.md) |
| **其他** | |
| 三個戰場的索引 | [DOMAINS](DOMAINS.md) |
| 美術風格、地圖與樣式的圖 | [art/ART_STYLE](art/ART_STYLE.md) |
| 路線圖、系統盤點、世界觀盤點、ElondiaRPG 遷移清單 | [plan/](plan/ROADMAP.md) |

## 9. 報告

格式沿用 ElondiaRPG 的 `report.schema.json`，改動：

| 欄位 | 改動 |
|---|---|
| `kind` | `gig`（案子的階段結算）／`combat`／`netrun`／`action`／`event`／`broadcast`（發布與直播）／`deal`（交易與談判）／`social`／`downtime`（生活、改造、治療） |
| `time` | 第幾天、幾點（以小時計） |
| `location` | 區、街區、設施、場景格；竄網時另有 `subnet`（子網 id 與層） |
| `party` | 快照改成 `hp`、`load`（感載）、`humanity` 各一組 `[前, 後, 上限]` |
| `timeline` | 竄網的節拍標 `layer: "net"`，和現實（`meat`）的節拍照時間順序排在一起 |
| `changes` | 新增 `cred`、`fame`（豔名）、`heat`（依勢力）、`favors`（人情）、`footage`（素材）、`audience`、`cyberware`、`humanity_cap` |
| `narration` | 新增 `stream`（這一幕正在直播：觀眾數、彈幕的氣氛） |

## 10. AI 敘事管線

和 ElondiaRPG 相同：挑世界書條目 → 組提示詞（不變的在前，可快取）→ 呼叫模型。差異只有兩點：

- **雙層場景**：竄網與現實同時發生時，提示詞要求把兩邊交錯著寫（一段網內、一段現實），靠 `timeline` 的 `layer` 判斷。
- **主持人口吻**：判定請求（自由行動）的規則加一條——像跑團主持人一樣給出「是，而且／是，但是／不，但是／不，而且」四種走向，對應大成功、成功、失敗、大失敗，並在 `twist` 寫出代價或轉機。

## 11. 預定的專案結構

```
data/worldbook/   世界書（SillyTavern 格式）
data/world/       區、設施、固定 NPC、勢力
data/rules/       各系統的規則數值
schemas/          報告格式
docs/             設計文件（地圖見 docs/README.md）
src/engine/       遊戲引擎（純 TypeScript）
src/narrator/     世界書挑選、提示詞、AI 服務
src/stores/       狀態與存檔
src/components/   Vue 介面
```

技術選型沿用 ElondiaRPG（Vue 3、Pinia、Vite、Vitest）。要直接從 ElondiaRPG 分支出來改，還是開新專案把模組一個個搬過來，見 [plan/ROADMAP](plan/ROADMAP.md) 的待決定第 1 項。
