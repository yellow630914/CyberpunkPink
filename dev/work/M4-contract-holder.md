# M4-contract-holder

- 交給：cpp-feature（sonnet）
- 目標：主角是持約人的那一面：持有的契約、面板的兩頁（現在能對他做的事、契約上寫了什麼與能調的）、主動觸發事件、他的抗拒、解約；並回答掃橋。
- 規格出處：LEWD_SYSTEM 7.2、7.3、7.5 節；EVENTS 4.5 節最後三條（主角是持約人）；NPC_SYSTEM 10.7 節「買下的契約」那一列；LIFE 3.4 節三種常見的契約；UI 第 11 節（面板的樣子，只當欄位的參考）；dev/adr/0019 第八節；dev/adr/0020 第十四節 D5（M5 要的：誰是主角持約的人、住處設在哪）。
- 可以改的路徑：`engine/src/features/contract/`、`engine/tests/features/M4-contract-holder.test.ts`。
- 可以用的介面：M4-contract 的 `Contract` 格式、規則表、抗拒的 DC；量表 `affinity`、`loyalty`（`features/npcs`、`features/roster`；用 `meterOf` 讀，查不到當 0）；效果 `roster_add`（把人放進名冊，有人註冊才用）；`actor.ext.bridge`、`actor.ext.tendency`（只認格式，給面板顯示）；掛點 `scan.person`（用名字掛）；報告上的 `triggers` 與 `where`；`contentAllowed`。
- 不可以做的事：面板不直接改任何人的參數（參數只因為事件而變）；事件的內容是資料；派他去打工是派工（M5），這一張只記「工作的安排」這一欄；不 import `roster`、`npcs`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `state.ext.contract.held: Record<npc 的 id, Held>`。`Held`＝`Contract` 的欄位（`holder` 是主角）加上：`home`（`'own'` 他自己的住處、`'base'` 住在主角的據點）、`job?`（工作的安排：一句話或一份工作的 id）、`split`（收入他拿幾成，預設 0.1）、`lent?`（`{ to, until }`）、`triggered`（`Record<事件的種類, 上一次的日子>`）、`origin`（來歷的一句話）。滿意不用（那是他對主角的事）；看的是親密度與忠誠。
- 效果（內建的來源才收）：`contract_hold`（`{ npc, type, debt?, days?, orders?, origin? }`：主角成為他的持約人）、`contract_release`（`{ npc, stay?: boolean }`）。條件 `contract`（M4-contract 定義）的 `side: 'holder'` 加 `npc?`。
- 持約人可以觸發的事（封閉的五種，對到指令的種類）：`errand` 派差事、`modify` 送去改造、`serve` 叫來侍奉、`work` 安排工作、`talk` 談一談。
- 報告：`contract.hold`、`contract.trigger`（帶觸發點 `holder_order` 與 `where: { order, npc, relation }`）、`contract.adjust`、`contract.release`、`contract.refuse`（他抗命）。匯出：`heldOf(state)`、`heldPeople(state)`（給 M5：每個人的 id 與 `home`）、`holderEvents(k, state, npc)`（五種各自能不能做與原因）、`triggerBlock`／`triggerDraft(k, state, { npc, kind })`、`holderContractView(k, state, npc)`（橋權的級別、來歷、剩下的債、他的橋參數、傾向、馴化、親密度與忠誠、規矩、住處、工作、分帳、關係、能調哪些）、`adjustBlock`／`adjustDraft(k, state, { npc, patch })`、`releaseDraft`。

## 要做的

1. `contract_hold`：那個人要是已經在場的角色（NPC）；建立 `held[npc]`、他的身分改成 `bound`（`actor.ext.identity`）、有人註冊 `roster_add` 就把他放進名冊（7.5 節：進入名冊，不強制同行）。已經持有的落空。
2. 現在能做的事（`holderEvents`）：照他的狀態列五種，各自的原因一句：`contract_dom` 關掉時 `modify`、`serve` 不列；同一個人同一種一天一次（EVENTS 4.5 節；`triggered`）；紙上沒勾的種類照樣能做（LIFE 3.4 節：橋不會替他擋），但標出「紙上劃掉了」；出借中不能觸發。
3. 觸發（`triggerDraft`）：他先擲抗拒——親密度低於 20 或這一種在紙上被劃掉時才擲：他的定力對同一條 DC 公式（用他的馴化；關係是夥伴或戀人 −4）。抗命成功：發 `contract.refuse`（主角對他的親密度 −2、他的忠誠 −5，量表查不到略過），這一次不成立但照樣算今天用過。否則發 `contract.trigger`，帶觸發點與 `where`，事件由導演從範圍 `contract` 挑。
4. 調整（`adjustDraft`；每一項各自的規則）：規矩（加、拿掉）；住處（`base` 要主角有住處：條件 `at_home` 有人註冊才檢查「有沒有住處」，沒有就都可以）；工作的安排；`split`（0～1）；主僕關係（`formal` 以外的要他對主角的親密度 60 以上，7.3 節；掉到 40 以下時每天 08:00 自動退回 `formal` 並發一份 `contract.adjust`）；出借（`lover` 時擋下；`ntr` 關掉而親密度 60 以上時擋下）。
5. 解約（`releaseDraft` 與效果 `contract_release`）：`held` 拿掉、他的身分改回 `citizen`、記一個旗標 `released:<npc>`（「遊戲會記得」）；`stay` 時他留在名冊（什麼都不做），否則發一個觸發點 `released` 讓名冊或事件決定他走不走。
6. 他的馴化慢慢變：每一次 `contract.trigger` 沒有被抗命，他的 `complied` +1，每滿 `docility_every` 次他的馴化 +1（`bridge` 效果，落在他身上）。
7. `scan.person`：回答主角的 `{ contract: { class: 'bound', holder: 名字, level: 'manage', covered } }`（主角是契約人時）與 `rights` 的清單；被掃的是 NPC 而他在 `held` 裡時回答他的。M4-contract 匯出的 `scanAnswer` 在這裡掛上。
8. 兩種面板的資料都不含任何會改狀態的東西；`holderContractView` 的「能調哪些」列出每一項現在的值與擋住的原因。

## 驗收條件（`engine/tests/features/M4-contract-holder.test.ts`；測試自帶兩個 NPC、範圍 `contract` 的資料；`affinity`、`loyalty`、`roster_add` 用測試註冊的假量表與假效果）

- `contract_hold`：`held` 有他、他的身分是 `bound`、假的 `roster_add` 被叫到；第二次落空。
- `holderEvents`：五種都列；`contract_dom` 關掉剩三種；觸發過 `errand` 之後今天的 `errand` 灰掉、明天又可以。
- 觸發：親密度 50 不擲、直接有 `contract.trigger`，帶觸發點 `holder_order` 與 `where`；親密度 10 時擲，固定骰子讓他成功：有 `contract.refuse`、忠誠 −5、沒有觸發點。三次沒被抗命之後他的馴化 +1。
- 調整：親密度 65 把關係改成 `partner` 可以、45 被擋；之後親密度掉到 35、過一個 08:00 自動退回 `formal`。`lover` 時出借被擋。`split` 寫 1.5 被擋。
- 解約：`held` 沒有他、身分是 `citizen`、旗標在；`stay: false` 的那一份報告帶觸發點 `released`。
- `heldPeople` 回傳他的 id 與 `home`。`scanAnswer`：主角是契約人時 `class` 是 `bound`；光紋遮著時 `covered` 是 true。
- 面板的兩個函式跑過之後狀態一個字都沒變（深比較）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-contract。

## 完成時回報

改了哪些檔、測試結果、「他主動找你」目前只有哪些觸發點（預期：沒有另外做，照範圍 `contract` 的 `daily`、`home` 由事件資料的條件挑）、給 M5 的 `heldPeople` 的形狀。
