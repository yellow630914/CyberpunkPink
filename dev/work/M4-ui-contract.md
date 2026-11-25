# M4-ui-contract

- 交給：cpp-ui（sonnet）
- 目標：契約面板的兩面接上引擎（主角是契約人：契約、規矩、滿意、佇列、照做或抗拒、還清；主角是持約人：事件頁與契約頁）；掃橋對話框多的三樣；蠱惑、惡意韌體、調校、請教在畫面上的入口。
- 規格出處：docs/art/UI.md 第 11 節（契約）、3.11 節（掃橋）；LEWD_SYSTEM 7.4、7.5 節；EVENTS 4.5 節；dev/adr/0019 第六、七、八節；dev/work/M4-contract.md、M4-contract-holder.md、M4-security-m4.md、M4-lure.md、M4-malware.md、M4-tuning.md、M4-training.md 的「匯出」。
- 可以改的路徑：`ui/src/dialogs/ContractDialog.vue`、`ui/src/dialogs/ScanDialog.vue`、`ui/src/dialogs/RosterDialog.vue`（從名冊上那個人打開持約人的面板）、`ui/src/dialogs/TalkDialog.vue`（「請教」）、`ui/src/dialogs/character/BridgeTab.vue`（M4-ui-body 留空的調校與惡意韌體兩塊）、`ui/src/dialogs/character/AdultTab.vue`（找過主角的流竄 AI）、`ui/src/lib/`（新增 `contractView.ts`）、`ui/src/data/contracts.ts`（假資料拿掉）、`ui/src/data/profile.ts` 與 `ui/src/data/items2.ts`（只改靜水那幾行的文字）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（新增 `contract.ts`）、`ui/tests/contract/`。
- 可以用的介面：`@engine/src/features/contract` 的 `boundView`、`chooseDraft`、`arriveDraft`、`askOrderDraft`、`payoffDraft`、`coverMarkDraft`、`holderEvents`、`triggerDraft`、`holderContractView`、`adjustDraft`、`releaseDraft`；`features/security` 的 `scanView`；`features/lure` 的 `lureView`；`features/malware` 的 `malwareView`、`cleanDraft`；`features/tuning` 的 `bridgeView` 與裝卸；`features/abilities` 的 `teachOptions`、`lessonDraft`；事件視窗（現有的 `EventDialog`）。
- 不可以做的事：不改 `engine/`；面板不直接改任何數值（LEWD_SYSTEM 7.5 節：只有觸發事件與調整契約兩種入口）；抗拒的 DC、成功率、逾期會怎樣都讀引擎；不寫指令事件的內容（示意包放兩三件最小的）；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 主角是契約人（主畫面多一個「契約」鈕，`boundView` 有東西才出現）：契約寫了什麼（種類、持約人、紙上勾的指令、債或期限）、規矩、滿意、還欠多少與還清的價錢；佇列每一條（種類、期限的倒數、逾期會怎樣）與「照做／抗拒」（抗拒顯示 DC 與成功率）；人在指定的地方時「這裡」多一項去做那一條；「主動要求一條指令」；光紋遮不遮。指令送達時是一則通知。
2. 主角是持約人（從名冊上那個人打開）：事件頁（五種能不能做、原因、今天做過沒）；契約頁（`holderContractView` 的每一欄；能調的每一項各自的控制與擋住的原因；解約要確認）。他抗命時顯示那一份報告。
3. 掃橋對話框：多列讀到的義體（件數；強度夠時逐件與處置）、沉溺（讀到多少、有沒有被看穿）、契約（誰持有、哪一級；被遮住時不列）。
4. 沉溺與蠱惑：蠱惑事件走現有的事件視窗（不必另外做）；成人分頁列出找過主角的流竄 AI（順著幾次、揭開了哪幾格「牠的事」）。
5. M4-ui-body 留空的兩塊：調校（兩個槽、裝卸、靜室）與惡意韌體（清除）。示意包的調校要有一筆靜水，照 0019 P65 的寫法（`{ stat: 'net_load_decay', amount: 2 }` 加 `{ mod: 'decay', amount: 2, layer: 'meat' }`、`flags: ['no_full_sync']`），說明寫「每回合感載消退 +2 點，現實與內海都有效」；`ui/src/data/profile.ts`、`ui/src/data/items2.ts` 裡「每回合感載自然消退加倍」的舊文字跟著改（那兩個檔只改這幾行）。
6. 請教：NPC 對話的選單多「請教」（引擎的 `interactions` 有才列），列出能學的基本功、三種付法與原因、上課的進度；機構的課在設施的「這裡」。
7. 示意世界包（`contract.ts`）：兩個開局選項——「主角是契約人」（一份伊甸園的債務契約、佇列裡三條）與「主角是持約人」（名冊上一個契約人）；三件指令事件、兩件蠱惑事件（一件登入、一件長休）、一個流竄 AI、一位可以教槍械的 NPC。

## 驗收條件（`ui/tests/contract/M4-ui-contract.test.ts`；用引擎真的功能）

- 契約人的面板每一欄等於 `boundView`；按抗拒之後佇列那一條的狀態照引擎；逾期的那一條標成紅的而且寫了處置。
- 持約人：觸發一次之後那一種今天灰掉；把關係改成夥伴在親密度不夠時灰掉、原因逐字相同；面板開關前後引擎的狀態沒有變（深比較）。
- 掃橋：引擎回答有違禁義體時對話框列出它與「鎖定 24 小時」。
- 兩個示意開局各走得到面板。
- 掃原始碼：`ContractDialog.vue` 不 import `data/contracts`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-contract、M4-contract-holder、M4-security-m4、M4-lure、M4-malware、M4-tuning、M4-training。

## 完成時回報

改了哪些檔、測試結果、缺的圖示、UI 第 11 節因為引擎還沒有而沒顯示的（預期：脫身的九條路只有還清、出借的對象）。

- 總指揮補記（2026-11-25，M4-contract-holder 回報）：新局畫面加「持約人開局」選項，`withPeople` 呼叫 `demoHolderChanges`；`ContractDialog.vue` 換成讀 `holderContractView`／`holderEvents`／`adjustDraft`／`releaseDraft`／`triggerDraft`；面板加「身上被裝了什麼」（讀 cyberware 的 `cyberView`）。
