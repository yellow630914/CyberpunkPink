# M4-followups-2（cpp-architect 角色，sonnet；第二十步之後的「二十之二」甲欄）

- 來源：M4-followups 回報裡沒做的（2026-11-25）。可以改核心、shell 與各功能；不碰 ui/（介面另有 M4-ui-followups）。
- 詳細出處都在 dev/work/M4-followups.md 對應的「總指揮補記」段。

## 要做的
1. 核心：`passiveProblems` 收 `source`，cyber／drug／gear 擋 `{ stat: ram_regen }`；`sink_floor` 只擋一部分時提醒一句；`BASE_SCENE_PARTS` 搬進核心，scene 與 cyberware 改 import；戰鬥外吃的藥經 `k.passives` 進戰鬥的那份，斷藥時暫停。
2. shell：稱呼（`callNamesOf`）、化身描述（`avatar.text`）進 AI 的角色資料。
3. 熔斷器三條（初鳴第一次過載不疊餘韻、野戰無鎖一成多疊 1 層、聖堂自製沒有熔斷器）；橋「每七天回聖堂」（每週檢查）。
4. craft：同人成功率照設計書「高」（暫定 DC −4，不是一定成功）；排異（CRAFTING 第 6 節，失敗時沉溺成本上升）。
5. medical：`combat` 的 `wound` op 轉呼叫 medical 的同一套；重創手術多「換義肢」選項（接 cyberware 的安裝）。
6. sink 與檢定標籤：社交勸降、控制類快駭帶 `resist_control`、`perception` 該帶的地方帶上；斷線靜修期間關橋、禁止潛入。
7. 其他功能：療程「蜜糖會好感 30 以上免費」；ITEMS 4.2 寫得出來的藥效寫進示意資料並測（寫不出來的列給內容）；abilities 的 `ability.capacity` 接手換橋提醒、拿掉 cyberware 那句；`flirt` 等 `adult_action` 行動註冊進核心；director 的 `adult_scene.gate: ai` 走 `scene_gate`；敵人中性外觀的招式名自動換、別人打敵人的拍名照目標的形象；`outcome.amnesia` 的下游略過（共同記憶、性經歷、傾向與沉溺累計、正文）；`scan.person` 的 abilities 面具答 `hide`；第三種解鎖法（請人偽造授權，用 `cyber_unlock`）；跪姿 `solo_kneel` 的「前後兩條都在時自己感載 +1d4」；持約人取得契約時 `roster_add` 直接成為成員；生命軌跡 `hostility` 也收 `result` 層；夜課的 `ext.body` 由 npcs 的 `buildActor` 寫。
8. 收尾：`engine/src/testkit/world.ts` 示意工作改成 `need.hours`（M4-followups 已改，確認測試守著）。

## 驗收
- 每一項至少一條行為測試；做不到的照實回報。engine tsc、npm test、test:smoke 全過；ui npm test、vue-tsc 全過。不 commit。

9. （M4-curtain-fall 回報）效果 `curtain_gig`（從事件直接簽檔期）、贊助人名片／委託線頭的效果，給 8.8 節貴賓席競標包場與接簽檔期的戰敗事件用。
