# CyberpunkPink

> 狀態：**設計階段，尚未動工**。目前只有文件，沒有程式。所有數值都是初稿。

一款成人向（18+）的賽博龐克跑團風格 RPG 網頁遊戲。架構沿用 [ElondiaRPG](https://github.com/yellow630914/ElondiaRPG)：玩家用 UI 操作，**遊戲引擎**負責所有擲骰與數值，每次行動結束後輸出一份**結構化報告**，再交給 **AI 敘事器**寫成小說式的經過（AI 可以關閉）。

和 ElondiaRPG 不同的地方，是系統不照搬，而是依世界觀重新推導：

- **世界觀**：另一條世界線的 2069 年，**緋夜城**。整個故事只發生在這一座城市與它的周邊。這條世界線上，腦機介面是從快感迴路突破的——**多巴胺奇點**。所以義體、網路、媒體、戰爭機器全部長在情慾產業上：防火長城叫「粉牆」，入侵對抗電子叫「蕾絲（LACE）」，戰爭機甲是靠全身神經同步駕駛的「女武神機甲」。本質沒變，只是染了色。
- **三個戰場**：現實的戰鬥（掩體、護甲、義體）、內海的戰鬥（化身、構裝、蕾絲）、輿論戰（媒體人的經營與策略玩法）。委託在**委託副本**裡進行：每件委託有一個主戰場，其餘的戰場起輔助作用。主角沒有職業；夥伴的職能固定。
- **一案一團**：一件委託就是一場跑團——接案、踩點、行動、收尾。
- **成人內容是世界的規則，不是外掛**：神經過載（感載）是和生命值並列的第二條傷害軌，慾望指標就是神經介面的硬體參數。

## 文件

**想一口氣讀完**：跑 `python3 tools/book/build.py`，會在 `docs/book/` 產生一本把所有文件照閱讀順序編在一起的設計書（單一 HTML 檔；`node tools/book/pdf.mjs` 再轉 PDF）。設計書是產物，不進版本控制。

| 目錄 | 內容 |
|---|---|
| [`docs/README.md`](docs/README.md) | **文件地圖**：目錄、從哪裡開始讀、依賴關係 |
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) | 總綱：這是什麼遊戲、設計原則、迴圈、系統地圖 |
| [`docs/DOMAINS.md`](docs/DOMAINS.md) | 三個戰場的索引：哪個系統影響哪裡 |
| [`docs/world/`](docs/world/WORLD.md) | 世界：世界線、企業、幫派、文化、各區、固定 NPC、日常 |
| [`docs/systems/`](docs/systems/CORE_RULES.md) | 規則：核心規則、現實戰鬥、內海、竄網、輿論戰、媒體、委託副本、中間人、成人向 |
| [`docs/gear/`](docs/gear/CRAFTING.md) | 裝備：義體、工藝（設計圖與零件）、身上的裝備 |
| [`docs/art/`](docs/art/ART_STYLE.md) | 美術風格、地圖與示意圖 |
| [`docs/plan/`](docs/plan/ROADMAP.md) | 路線圖、系統盤點、世界觀盤點、ElondiaRPG 遷移清單 |

工具：`python3 tools/book/build.py` 重編設計書；`python3 tools/docs/check.py` 檢查連結與章節引用；`node tools/art/render.mjs` 把圖轉成 PNG。

## 內容聲明

本作是成人向虛構作品。所有登場角色皆為成年人（18 歲以上），這是引擎與內容檢查的硬性規則，不是可關閉的選項。較重口的題材（非自願、契約支配、NTR 等）都可以在「設定 → 內容篩選」關閉，見 [`docs/LEWD_SYSTEM.md`](docs/systems/LEWD_SYSTEM.md) 第 9 節。

## 授權

[MIT](LICENSE)。
