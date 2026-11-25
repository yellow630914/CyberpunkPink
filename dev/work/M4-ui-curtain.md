# M4-ui-curtain

- 交給：cpp-ui（sonnet）
- 目標：簾後館的畫面：會員與面談、口味單、報名、一趟裡的面板（第幾幕、場熱、點單、票根、化妝室）、結算、落幕之後的三條路；敵人名牌的雙形象。
- 規格出處：docs/art/UI.md 第 5 節（子網的畫面：沿用）、迷宮館的面板（M3-ui-dive 做的那一組當底）；CYBERSPACE 8.8 節；dev/adr/0019 第十二節；dev/work/M4-curtain-entry.md、M4-curtain-run.md、M4-curtain-fall.md、M4-enemies-m4.md 的「匯出」。
- 可以改的路徑：`ui/src/dialogs/DiveDialog.vue`（去處多一種）、`ui/src/screens/SubnetScreen.vue` 與子網的元件（簾後館的面板）、`ui/src/components/combat/`（名牌讀形象）、`ui/src/lib/`（新增 `curtainView.ts`）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（新增 `curtain.ts`）、`ui/tests/curtain/`。
- 可以用的介面：`@engine/src/features/curtain` 的 `memberView`、`interviewDraft`、`tasteOptions`／`tasteDraft`、`nights`、`enterBlocks`／`enterDraft`、`curtainView`、`useCurtain`、`orderChoices`、`restDraft`、`fallView`、`callOffDraft`、`settleDraft`、`buybackDraft`、`payTabDraft`；`features/enemies` 的 `unitFormView`；子網與戰鬥現有的畫面（M3）；場景的畫面（M4-ui-scene）。
- 不可以做的事：不改 `engine/`；場熱、打賞、能不能報名、三條路的數字都讀引擎；不寫點單與敵人的內容（示意包放最小的一組，文字中性、不露骨）；直播的面板不做（M5）；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 入口：潛入之後的去處多「簾後館」（示意包的 `net_site`）；沒有會員證時是面談的畫面（邀請函剩幾天、席次與檢定的 DC、不收的原因）；有的時候是會員頁（席次、會費繳到哪、這一週的主打、今晚還能報幾場、口味單）。
2. 報名：選席次與夜（或擲）、隊伍、保證金與同伴券；擋住的原因用引擎的。
3. 一趟裡（沿用子網的畫面）：頂端一條場熱（0、70、90 三個刻度與說明）、第幾幕與這一幕用了幾回合、票根；站在點單、賞箱、條文、近道旁邊時「這裡」列出引擎的用途；點單要先看內容再選接受或拒絕；化妝室的對話框（包場的選項有才列）。
4. 戰鬥：敵人的名牌與立繪的鍵讀 `unitFormView`（鎖定的目標換了就跟著換）。
5. 結算頁：獎金、打賞（場熱那一段、乘了什麼）、票根、保證金。落幕：先是補演的確認（可以喊停），之後是三條路（每一條的數字、選不了的原因）；母帶外流是一則通知，會員頁列出可以買回的。
6. 示意世界包（`curtain.ts`）：兩個夜（不同的文化）、每個文化兩種雙形象的敵人與一個層主、三張表（點單、賞箱、獎品）、一件 `stage` 的戰敗事件與它的 `_plain` 版本；開局可以用一個效果直接給邀請函。

## 驗收條件（`ui/tests/curtain/M4-ui-curtain.test.ts`；用引擎真的功能，`netrun` 走真的）

- 沒有邀請函時面談的按鈕灰掉、原因逐字相同；面談過了之後出現會員頁。
- 報名之後導到子網的畫面、場熱是 30；拒絕一張點單之後是 25。
- 對 `male` 的隊友顯示 A 的名字、對 `female` 的主角顯示擲到的那一個（固定種子）。
- 全隊倒下、接受結果：出現補演的確認；喊停之後是三條路；選記帳之後會員頁有欠款。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-curtain-entry、M4-curtain-run、M4-curtain-fall、M4-enemies-m4、M4-ui-scene。

## 完成時回報

改了哪些檔、測試結果、缺的圖示（點單、賞箱、條文、化妝室）、給 M5 的畫面接口（直播的面板要放在哪）。

- 總指揮補記（2026-11-25，M4-curtain-fall 回報）：遭遇的開戰與潛行繞過改讀 `netrunView`（`curtainView.near` 不列遭遇）；補演讀 `fallView`（step、replay.can_start／can_call_off、三條路 paths），開演 `replayDraft`、喊停 `callOffDraft`、結清 `settleDraft({ how })`；母帶 `buybackDraft`；簾口 `doorBlock`。
