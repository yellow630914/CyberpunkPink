# 0001 engine/ 的目錄與分層

- 日期：2026-11-21　狀態：採用

## 背景
CODESCAN 第 3 節定了 L0～L7 八層與一條規則（L6 的功能之間不直接 import）。使用者決定引擎放 `engine/`、純 TypeScript、不依賴 Vue；`ui/` 的 store 包住它。要決定每一層放哪個資料夾、誰能改、ui 怎麼讀到引擎。

## 選項
1. 照層號開資料夾（`l0/`、`l1/`……）。好查層，但看不出內容。
2. 照內容命名，由分層檢查把資料夾對到層號。
3. engine 做成一個要先編譯的套件，ui 用 npm 相依。

## 決定
- 用選項 2：`core/types`（L0）、`core/util`（L1）、`core/content`（L2）、`core/state`（L3）、`core/rules`（L4）、`core/action` 與 `core/kernel.ts`（L5）、`features/<功能>`（L6）、`shell`（L7）。對照表在 `engine/src/testkit/layers.ts` 的 `layerOf` 與 `.claude/cpp/project.json` 的 `layers`。
- L7 的 `shell/`（任務鏈、AI 任務、服務商介面、存檔、回退、遊戲的門面）與 `testkit/`（測試基礎建設）歸 cpp-architect，列進 `coreDirs`；功能的作者不能改。
- `features/index.ts` 是功能的總表（`FEATURES`），是唯一可以同時 import 好幾個功能的檔，分層檢查把它算在外殼；歸 cpp-feature 維護（每做完一個功能加一行）。
- 不用選項 3：ui 直接 import `engine/` 的原始碼（Vite 別名 `@engine`），沒有編譯步驟。
- 引擎不 import 任何套件（含 `node:`）也不碰瀏覽器的全域物件，由分層檢查在測試時擋住。型別檢查的 `lib` 仍然含 `DOM`，因為 `AbortController`、`setTimeout` 的型別在那裡，而且 ui 會用它自己的設定再檢查一次引擎的原始碼。

## 後果
- 新的層或新的頂層資料夾要改 `layerOf`；放錯地方的檔會被「不在任何一層」這條擋下。
- ui 的型別檢查會連引擎的原始碼一起檢查，所以引擎的 `tsconfig` 開了和 ui 一樣的 `noUnusedLocals`、`noUnusedParameters`。
- 真的服務商之後要用 `fetch` 與各家的 SDK：到時候在 `shell/ai/` 開一個例外的資料夾，並改分層檢查的套件規則（另開 ADR）。
