# M4-fix-ui（cpp-ui，sonnet；M4 收尾修正批・介面；接在 M4-fix-engine 之後）

- 只改 ui/。依據：dev/reviews/2026-11-26-M4-ui.md（必修 1、應修 10、建議 8）、dev/work/M4-closing-notes.md 裡介面的每一條、M4-fix-engine 新增的匯出。

## 使用者裁決（2026-11-26，都照建議）
1. 建角可以買的清單與出身建議組合改讀引擎（M4-fix-engine 搬了）。
2. 示意捷徑（領邀請函、契約人／持約人開局等）一律做成開新局的選項，加一個「示意模式」開關，關著時都不出現。
3. 寫法指令超過 200 字不在瀏覽器硬擋：字數變紅照樣送出，由引擎截斷並顯示它的提醒；上限讀引擎常數。
4. 痛覺編輯器的模糊讀引擎的旗標。
5. 建角外觀的推導改讀引擎。
6. 夜課以 UI.md 第 10 節為準（文件已改 8.4 節）。

## 要做的
- 必修 1、應修 1～10 全做；建議做得到就做。
- closing-notes 裡介面的每一條（拍賣自動跟價「自動跟到 C$___」、拿掉自算的 onceInput／partPaused／天數、PART_TYPE_NAMES、statName／MOD_NAMES 對照表、coveredSlots、SKIN 染色、鎖定目標的名牌、帳與母帶改讀 tabLine 等）。
- 拍賣測試的逾時。

## 驗收
- ui npm test、vue-tsc、npm run build 全過；不 commit，不留背景工作。
