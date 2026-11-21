# 0002 登錄表掛在 kernel 上，不用模組層級的全域變數

- 日期：2026-11-21　狀態：採用

## 背景
ElondiaRPG 的登錄與設定是模組層級的全域變數（12 個設定經由監看寫進引擎；`state.ts` 同時是最底層的工具與最上層的組裝者），是 86 個模組纏成一團的原因之一，也讓測試之間互相污染。

## 選項
1. 模組層級的登錄表（`registerEffect(...)` 直接寫進一個全域的 Map）。寫起來最短。
2. 每一層有自己的登錄表類別，全部掛在一個 `kernel` 物件上；功能是 `{ id, install(kernel), ready?(kernel) }`。

## 決定
用選項 2。`createKernel(features)` 產生一個核心物件：`content`（L2）、`changes`、`hooks`、`probe`（L3）、`stats`、`effects`、`conditions`（L4）、`actions`（L5）。型別照層疊上去（`StateKernel` → `RulesKernel` → `ActionKernel` → `Kernel`），下層的函式只吃它那一層的型別，所以下層看不到上層的登錄表。

功能分兩段接上：`install` 註冊登錄表與掛鉤（這時內容還沒載入）；`ready` 在內容載入之後呼叫一次（要讀內容才能註冊的東西，例如照資料註冊行動種類）。

## 後果
- 每個測試、每一局各拿各的 kernel，互不影響；探針也是每個 kernel 一個。
- 所有核心的函式第一個參數是 kernel（或它的某一層），多打幾個字。
- 設定（AI 的設定、存檔規則）不放在 kernel 裡：AI 的設定由 `Game` 拿著、明確傳進每一條任務鏈；存檔規則在狀態裡。
- 掛點的清單是型別 `HookMap`；功能要新的掛點先回報給 cpp-architect 加進去。
