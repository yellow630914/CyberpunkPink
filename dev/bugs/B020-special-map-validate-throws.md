# B020：special_map 的格式檢查遇到 cells／spots 型別不對的資料時丟 TypeError，而不是回問題清單
- 發現者：cpp-tester-whitebox（M2 白箱：每一筆內容的每個欄位換成壞值再交給 `content.validate`）
- 嚴重度：小問題（只影響資料作者寫壞地圖；玩家的存檔不經過這一條。但載入整包內容時當機、訊息裡沒有寫是哪一張圖，世界編輯器匯入時會很難除錯）
- 規格出處：GAME_DESIGN 第 3 節第 13 條（格式錯誤一律擋下）；`ContentKindDef.validate` 的契約（`engine/src/core/content/registry.ts`：「驗證一筆的格式；回傳錯誤訊息（空的就是合格）」）；DATA 9.3 節（`sheets[]` 的 `cells`、`spots`、`links` 寫法）。
- 實際行為：`special_map` 的 `validate`（`specialMapProblems` → `sheetProblems`）直接對 `def.cells`、`def.spots` 做 `.map`、`.find`，並讀 `m.at[0]`、`s.at[0]`。下面這幾種壞法都是 TypeError（`(def.cells ?? []).map is not a function`、`number 0 is not iterable`、`Cannot read properties of undefined (reading '0')`、`Cannot read properties of null (reading 'at')`）：
  - `sheets[i].cells` 不是陣列（字串、數字、物件、true）
  - `sheets[i].cells[j]` 是 null 或數字
  - `sheets[i].cells[j].at` 沒寫或是 null
  - `sheets[i].spots` 不是陣列；`spots[j]` 是 null；`spots[j].at` 沒寫
  其他 M2 的內容種類（共 60 幾種、每一個欄位換十五種壞值）都只回問題清單，沒有丟例外；`ready` 那一段（跨內容的檢查）也沒有。
- 重現：engine/tests/whitebox/fixtures/B020-special-map-malformed.json（一張合格的小街加八種壞法）；會失敗的測試 engine/tests/pending/B020-special-map-validate-throws.test.ts（八筆照預期失敗，對照「合格的那一張驗得過」會過）。通用的掃描在 engine/tests/features/M2-validators.whitebox.test.ts（`KNOWN_CRASH` 白名單只放這一條；修好之後把白名單清空）。
- 可能的位置（只寫推測，不改）：`engine/src/core/grid/model.ts` 的 `sheetProblems`（第 300～340 行一帶）：進入之前先檢查 `cells`、`spots`、`links` 是陣列、每一筆是物件、`at` 是兩個整數的陣列，不合格就 push 問題後 return。屬於 cpp-architect 的範圍（核心）。
