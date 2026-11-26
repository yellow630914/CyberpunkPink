# M4-fix-engine（cpp-architect 角色，sonnet；M4 收尾修正批・引擎）

- 可以改：engine/（核心、shell、features、data、testkit、tests）。不改 ui/（介面另有 M4-fix-ui）。
- 依據：dev/reviews/2026-11-26-M4.md（引擎審查：必修 2、應修 6、建議 6）、dev/work/M4-closing-notes.md（引擎相關的每一條）、dev/bugs/B030、B031、使用者 2026-11-25～26 的裁決（下面）。

## 使用者裁決（2026-11-26，都照建議）
1. 場熱量表改名 `stage_heat`（資料、文件、不變式一起改；補一條「再註冊效果 heat 不撞」的測試）。
2. 契約指令：`contract.choose` 在任何活動裡都能回；玩家處於任何獨佔的活動（委託副本、潛入、簾後館一趟、網內行程、拍賣、成人場景）時期限暫停。
3. `work` 指令：期限內打完一班就自動照做（滿意 +5、照做次數 +1），抽成只算那一班。
4. 加演的邀請：只在結算之後同一晚、人還在簾口（簾口在潛入裡時就是潛入中）才接得了；離開或過了這一晚就作廢，報告一句「館方收回了加演的邀請」。
5. 拍賣交不出去：不收錢，改由出價第二高的 NPC 得標（沒有就流標），結果一句「這一件撤拍」；目錄抽籤先排除現在交不出去的拍品；ready 時對拍品的 contract、effects 先驗格式。
6. `sink_resist` 一律最少 1。
7. 任何方式進入內海都發 `login` 觸發點（委託內海面、netrun、簾後館一趟、dive）。
8. 斷線靜修改成進行中的活動（期間關橋、禁止潛入，結束才結算）。
9. 拍賣自動跟價：`bidDraft` 收 `auto: { max }`（LEWD 6.2 第 6 點）。
10. 痛覺編輯器：引擎給旗標（例 `hp_blur` 衍生數值或 cyberView 欄位），介面不再認標籤名。
11. 建角可以買的清單與出身的建議組合搬進引擎（creation 列清單、origin 資料帶 `suggested`）；建角外觀的推導（外露的義體、獸化、風格的句子）搬進引擎（cyberware 與 gear 各回答一段）。

## 要做的
- 審查的必修 2、應修 1～6 全做；建議 1～5 做得到就做（第 6 條是提交習慣，不用改程式）。
- B030、B031（簾後館在潛入裡的簾口）。
- closing-notes 裡引擎的每一條（匯出、區倍率、好感門檻與 testkit 濾勢力、拍賣放行收緊與 once、契約 OrderView 與入口、BattleUnit 的鎖定、curtain 的 tabLine、unreg 的匯出與 days_left、auctionSummary、part_states 的 trade 與 modify、條件說明句欄位、scene 常數讀規則、示意世界包的補演 cast 等）。逐條做，做不到的照實回報。
- 修完把 tests/pending 的 B030、B031 移到 features，`m4-whitelist` 的 `it.fails` 拿掉。

## 驗收
- engine tsc、npm test、test:smoke 全過；test:pending 只剩 B009；ui npm test、vue-tsc 全過（介面若被匯出改名打壞，只修 import 與型別，不做畫面）。
- 每一項至少一條行為測試；不變式接在最後一條之後；ADR 0019 末尾「實作補記：M4 收尾修正批」。不 commit，不留背景工作。
