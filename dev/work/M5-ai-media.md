# M5-ai-media

- 交給：cpp-feature（sonnet；引擎的那一半）與 cpp-ui（sonnet；畫面的那一半，引擎那一半做完再派）　（**第三波**）
- 目標：把 M5-core-ai 的兩個接縫接到媒體的入口上：兩個判讀（時段直播的自訂輸入、剪輯的自由行動）、一個對手的判讀（`pr_move`）、六個文字槽（素材的標題、片的標題與簡介、直播目標的說法、彈幕、貼文與留言、動態牆），加上 M4 留給文字槽的兩格（拍賣的鑑定書與主持人的口白）；畫面把 AI 的結果顯示出來。
- 規格出處：MEDIA 1.1 節（素材的標題）、1.2 節（目標的說法、彈幕）、1.3 節的「自訂輸入」（標籤七種、方向三種、「自訂的修正最多 ±2 檢定、±1 熱度」）、第 3 節最後一條（剪輯的自由行動：只能落在這一組素材選得了的角度裡，對不上的退回紀實）、13.1、13.2 節（AI 寫貼文與留言、數字都是引擎的）；AI_TASKS 3.11、3.21、3.22 節、4.3 節（`pr_move` 的輸入、輸出、驗證、退路）、4.5 節；OPINION 4.4 節；dev/adr/0020 第十一節、V28；dev/work/M5-core-ai.md（兩個接縫的型別與回報裡的最小例子）。
- 可以改的路徑：`engine/src/features/media/`、`live/`、`social/`、`opinion/`、`auction/`（各自只加「宣告」與「怎麼寫回去」）、`engine/tests/features/M5-ai-media.test.ts`；畫面：`ui/src/dialogs/CutDialog.vue`、`LiveDialog.vue`、`SocialDialog.vue`、`ui/src/screens/OpinionScreen.vue`、`ui/src/components/`（直播的彈幕）、`ui/src/stores/engine.ts`、`ui/tests/ai/`。
- 可以用的介面：`k.intents.define`、`k.texts.define`、報告的 `texts`；`Game.readIntent`；各功能現有的入口（`slotStart` 的 `plan`、`cut` 的 `angle`、對手挑行動的那一步）；假的服務商。
- 不可以做的事：四個功能之間不互相 import；AI 的結果不能改任何數字、不能選清單以外的東西（核心已經擋，這裡不要繞過）；AI 關著時的行為和這一張之前逐位元組相同；彈幕與留言不引用報告沒有的資訊（照 AI_TASKS 4.5 的驗證）；共同的規定見 dev/work/M5-plan.md。

## 要做的（引擎）

1. **判讀 `live_plan`**（live）：欄位 `tags`（七種，挑 0～2 個）、`direction`（三種加「不特別」，挑 1 個）；種類不讓 AI 改。退路：沒有標籤、方向「不特別」。入口不變：介面拿 `readIntent('live_plan', text)` 的結果當 `plan` 傳進 `slotStart`。描述越誇張只會更接近「搏出位」，數字照方向查表，天生夾在 ±2 檢定、±1 熱度以內（不用另外夾，驗收確認）。
2. **判讀 `cut_angle`**（media）：欄位 `angle`，清單是「這一組素材選得了的角度」（`angleOptions` 裡沒被擋的；照狀態算）；退路 `documentary`（紀實；紀實也選不了時是清單的第一個）。入口不變：介面拿結果當 `angle` 傳進 `cut`。「成功程度」設計書提了一句、沒有規則：不做，回報。
3. **判讀 `pr_move`**（opinion）：對手的回合裡「挑行動與要佔的格子」那一步。因為戰役的每一步是同步的報告，做法是**預先問**：玩家按「結束回合」之前，介面先 `readIntent('pr_move', '', { war })` 拿到 `{ actions: […], capture: [格子 或 'none'] }`（清單是程式算好的合法行動（付得起、條件成立）與可佔的格子），再傳進 `endTurn` 的輸入 `foe_plan`；`endTurn` 照它做，每一步仍然由程式驗花費與規則，不合的那一步改照性格表。沒給 `foe_plan`（AI 關著）就是現在的性格表。`mimic` 的對手先由程式開放三到四種，清單就是那幾種。公關的一句說法是文字槽 `pr_line`（那一回合的紀錄多一句）。
4. **文字槽**（各功能宣告、在自己的報告上寫 `texts`）：
   - `footage_caption`（media；`media.convert` 的報告）：標題 20 字以內、說明 60 字以內；名字只能是那一則紀錄涉及的人與勢力。
   - `stream_goal`（live；開播的報告）：每個目標一句說法；目標的 id、種類、數字不在可以寫的欄位裡。
   - `stream_chat`（live；有亮點的每一份報告，同一份合成一批）：1～5 句、每句 20 字以內；寫進 `session.chat`（最近十五句，只給畫面，不進結算）。
   - `post_text`（social；`social.post` 的報告）：正文 80 字以內、留言 0～5 句（條數由引擎照愛心的多寡定：每 50 個愛心一句，最多 5）、每句 30 字以內。
   - `feed_text`（social）：動態牆是純函式、不存狀態，所以這一槽寫進一個小的快取 `state.ext.social.feed_text: Record<貼文 id, string>`（最多一百筆，舊的丟掉）；`feedView` 有快取就用、沒有用模板。由介面在打開動態牆時請外殼對「還沒有字的那幾則」跑一次（M5-core-ai 的 `Game.fillTexts(slot, refs)`）。
   - `clip_caption`（media；`media.cut` 的報告）：片的標題 30 字以內、簡介 100 字以內（上限就是 `CLIP_TITLE_MAX`、`CLIP_INTRO_MAX`）。**只在玩家兩格都空著時宣告**；玩家寫過的那一支（`titled`）不寫 `texts`，之後玩家用 `retitle` 改了，還在路上的那一次回來時 `input` 回 `null`（不蓋掉）。
   - 每一槽的 `adult`：`footage_caption`、`clip_caption`、`post_text` 看那一件的 `adult`；`stream_chat`、`stream_goal` 看這一場是不是成人模板或成人種類；其餘不寫。
5. 每一個宣告都要有測試：AI 回了合格的 → 用它的；回了不合格的 → 原本的字、沒有錯誤。
6. **M4 留下的兩格**（改 `features/auction`；M4-plan「第五波留給 M5 的」、M4-plan 第 27 題使用者照建議：鑑定書與口白等文字槽）：`auction_cert`（每件拍品一句鑑定書，60 字以內；現在是資料的 `cert`）與 `auction_patter`（主持人每一回合一句口白，40 字以內；現在是程式的句子）。寫進 auction 自己狀態裡給畫面看的那兩格字；仿品的記號、競標者的預算、底價都不在上下文裡（那些連畫面都不給，`features/auction` 的檔頭有寫），也不在可以寫的欄位裡。規則一個字都不改；`auction` 沒有地方放這兩格字的話回報，不硬塞。

## 要做的（畫面）

1. 時段直播的對話框：描述有字而且 AI 開著時，按「開播」先顯示判出來的標籤與方向（小標，可以改），確認才送；AI 關著照舊是兩個下拉。
2. 剪片：多一個選填的「你想怎麼講這個故事」，AI 開著時判出角度並把那張角度卡標成選中（玩家可以改）。
3. 素材的標題、貼文、留言、目標的說法、對手的那一句：有 AI 寫的就顯示，還沒回來時顯示原本的（不轉圈、不擋操作）。
4. 彈幕：有 `session.chat` 時用它，沒有時用預寫的句子池。
5. 設定的 AI 分頁多列這幾個開關（照引擎的設定鍵）。

## 驗收條件（`engine/tests/features/M5-ai-media.test.ts`、`ui/tests/ai/M5-ui-ai.test.ts`；用假的服務商）

- `live_plan`：假的服務商回 `['funny']`、`bold` → `slotStart` 收到的 `plan` 是它；回清單以外的標籤 → 退路；不論回什麼，檢定的修正在 ±2、熱度的修正在 ±1 以內（性質測試：隨機的回應一千次）。
- `cut_angle`：清單裡沒有的角度（素材類型對不上的）回了也不會被用；全部走退路時是紀實。
- `pr_move`：給了合法的計畫 → 對手照做；計畫裡夾一個付不起的行動 → 那一步改照性格表、其餘照做；沒給計畫 → 和這一張之前的結果逐份相同（固定種子比對）。
- 每一個文字槽各一個：AI 的字寫進去了；超長的沒寫進去；任何一槽寫回之後，素材的品質與次數、熱度、訂閱、追蹤、愛心數都沒變。
- 片的標題：玩家寫了標題的那一支，報告上沒有 `clip_caption` 的代辦；兩格都空著的有，寫回之後 `titled` 還是沒有（之後玩家照樣可以改）。
- 成人的那一件走成人路由、一般的不走（假的服務商記路由）。
- 拍賣：鑑定書與口白換成 AI 的字之後，同一個種子的每一次出價、落槌、仿品的結果和這一張之前逐份相同；`auctionView` 給畫面的東西沒有多出預算或仿品的記號。
- AI 整個關掉跑一遍第一波的冒煙：報告逐份和這一張之前相同。
- 畫面：判出來的標籤可以改；AI 的字回來之前之後畫面都可操作；設定的開關關掉之後不再有請求。
- `npm test`、`npx tsc --noEmit`、分層檢查、`ui` 的 `npm test` 與 `vue-tsc` 全過。

## 依賴

M5-core-ai；第一波的 media、live、social、opinion。

## M4 對帳（2026-11-26）

- 判讀收的玩家文字（時段直播的描述、「你想怎麼講這個故事」）照 M4 的規矩原樣交出去：不篩選、不改寫、不提示；畫面不 `.trim()`、不用 `maxlength` 硬擋（上限與截斷由引擎給）。
- `pr_move` 的「預先問」和 M4 場景每回合的 `scene_turn` 是同一種做法（外殼先問、功能照規則再驗一次、不合的照規則走）：`features/scene` 收 `SceneEnv.moves` 的寫法是現成的範例。
- `design_part`（未登錄零件的名字）不併進文字槽（0020 V67），這一張不碰 `features/unreg`。
- 設定的 AI 分頁現在已經有 `sceneAi`、`partAi` 兩格（M4）；這一張的開關接在它們後面，讀引擎的 `intentOn`、`textOn`。

## 完成時回報

改了哪些檔、測試結果、`pr_move` 用「預先問」的做法順不順（不順的話要核心怎麼改）、剪輯的「成功程度」怎麼處理、AI_TASKS 要補的任務表（給文件代理：新的任務、輸入、輸出、驗證、退路）。
