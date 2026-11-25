# M4-ui-followups（cpp-ui，sonnet；「二十之二」乙欄）

- 來源：M4-ui-body、M4-ui-creation、M4-ui-craft、M4-followups 回報裡的介面缺口（2026-11-25）。只改 ui/。

## 要做的
1. 人物詳情：稱呼兩格（`callNamesDraft`／`callNamesBlock`）；送禮時附一句話（`note`，200 字）；化身分頁的外觀描述（`avatar.text`，200 字）。玩家的文字原樣送出，不篩選。
2. 診所：MainScreen／HomeScreen 開診所前先問 `clinicGate()`；修理構裝（`repairRows`／`repairDraft`，有 `repair_construct` 的設施才列）。
3. 背包：藥可以「使用」（`useDraft`）。
4. 掃描對話框顯示 `scanView.person`（若 M4-ui-contract 還沒做）。
5. 成人場景：列出 `SceneOptions.inserted`（視窗插進來的選項）。
6. 組裝：「誰來做」可選隊友（引擎有 `by`）；內海 SKIN 染色若引擎已收就接，沒收就照舊。
7. 讀引擎的匯出取代 ui 自己的對照：沒有橋的說明、衍生數值與戰鬥修正的中文名（引擎沒匯出的列出來回報）、外套蓋住的格子（`coveredSlots`，沒有就回報）。
8. 圖示：藥泵 `pump`、各件義體自己的圖示（缺的列清單，先用通用圖示）。

## 驗收
- ui `npm test`、`vue-tsc`、`npm run build` 全過；新功能有測試。不 commit。

9. （M4-training／night-resonance 回報）拿掉 `peopleView.UNOPENED_ACTIONS` 灰掉的「請教」，改接 `npc_consult`（`teachOptions`、`lessonDraft`）；成人場景列出 `once`、`dress` 兩種新行動。
