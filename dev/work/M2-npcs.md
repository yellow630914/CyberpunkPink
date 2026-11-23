# M2-npcs

- 交給：cpp-feature（sonnet）
- 目標：新功能 `npcs`：三種 NPC 的資料、每區一份名單與生成、今天誰在哪、主角和每個認識的人的關係條目（個人的親密度）、事件的登場角色。
- 規格出處：NPC_SYSTEM 第 1、2 節、第 3 節（3.1～3.3）、第 4 節（4.1、4.4～4.7；4.2、4.3、4.8 的名字與外貌只留接口）、第 5 節、第 7 節、第 12 節；DATA 第 8 節；dev/adr/0016 第三、七節。
- 可以改的路徑：`engine/src/features/npcs/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-npcs.test.ts`。
- 可以用的介面：核心的內容種類 `npc`（M0 已經有，只驗了最少的欄位）、`k.meters.define`、`k.hooks.on('director.cast')`、核心的 `actor.add`／`actor.ext` 變更、`deriveRng`、`k.content`（`faction`、`district`）。
- 不可以做的事：互動選單（M2-npc-interact）、共同記憶與名單的變動（M2-npc-life）、名冊（M2-roster）；名字與外貌的素材是內容，不要寫進程式；AI 的 `flavor_roster` 不接；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- `npc` 多驗的欄位：`kind`（`citizen` 街坊、`runner` 行者、`staff` 職員）、`faction?`、`guard`（警覺 12～19）、`wealth`（0～5）、`haunts: [{ district, block?, facility?, time?, weekday? }]`、`persona`、`tendencies`、`bridge`、`sink`、`paths`（只有行者）、`flags: ['no_steal', …]`。18 歲以下的在載入時擋下。
- 內容種類 `npc_gen`（規則與素材的接口）：每區一筆 `{ district, citizens, runners, occupations: [[名字, 權重]], factions: [[id, 權重]], names: [池的 id] }`；`name_pool`：`{ id, given: [...], family?: [...] }`。
- 狀態 `state.ext.npcs`：生成的人（整筆）、每區的名單、關係條目（`known` 已知的事、`first`／`last` 見面的時間、`watch` 關注、`relation` 一句話）。
- 量表 `affinity`（照人、−100～100、AI ±8）。條件 `affinity_stage`（`{ npc, min }`，七段：仇、嫌、生、熟、交心、親近、羈絆）、`knows`（認不認識）。
- 效果 `npc_known`（`{ kind, npc, fact }`：把一件事記進已知的事；`fact` 是 `tendency:<標籤>`、`bridge`、`contract`、`secret:<關鍵字>`）、`meet`（建立關係條目）。
- 報告：`npc.meet`、`npc.watch`。

## 要做的

1. `npcOf(k, state, id)`：固定的讀內容加存檔裡的變動，生成的讀存檔；兩種回傳同一個形狀。
2. 名單：第一次走進一區時建立（聽報告的位置有沒有換區；亂數是「存檔種子加區的 id」），人數照那一區 `npc_gen` 的數字，固定 NPC 佔名額。生成一個人照 4.1 節的步驟：身分類、性別（照內容篩選關掉的對象性別調權重）、年紀（18 以上）、勢力、警覺與財富、屬性與性格、傾向（每條軸 0～1 個標籤）、橋參數與沉溺、行者的路數與階數；名字從池裡抽，外貌留空欄位。
3. `npcsHere(k, state)`：現在這個位置（區、街區、設施）與時段、星期對得上 `haunts` 的人；同一天同一個人只會在一個地方（亂數是「id 加日子」）。
4. 關係：`meet` 之後才有條目；親密度只經由量表改；`affinityStage` 給階段的 id 與名字。臨時 NPC 一旦有了條目就升成生成 NPC、進他那一區的名單（`promote`）。
5. 變成角色：`actorOf(k, state, id)` 回傳把這個人放進 `state.actors` 要的變更（屬性、基本功、`ext.bridge`、`ext.tendency`、`ext.paths`），已經在的回傳空的。
6. `director.cast`：指定的固定 NPC、主角認識的人（照條件挑）、照當下的區新生成的人，三種都回答角色的 id 與要先套的變更。

## 驗收條件

- 固定 NPC 的內容載得進來；17 歲的被擋；行者沒有 `paths`、街坊寫了 `paths` 各被擋。
- 第一次進一區之後名單的人數對得上資料；同一個種子兩次生成的人一模一樣；換種子不一樣；每個人都滿 18 歲、勢力來自那一區的表。
- 把某一種對象性別關掉之後，生成的名單裡沒有那一種。
- `npcsHere`：白天只在的人晚上不在；同一天裡不會同時出現在兩個街區；隔天重算。
- `meet` 之後有條目、親密度是 0；量表 +30 之後階段是「熟」；條件 `affinity_stage` 跟著成立。
- `npc_known` 記進去的事查得到，同一件不重複。
- `actorOf`：行者變成角色之後有路數與橋參數；再呼叫一次沒有新的變更。
- `director.cast` 三種各回答得出一個人；新生成的那個人事件結束後還有條目的話留在名單上，沒有就不留。
- 存檔往返：名單、條目、生成的人都在。

## 依賴

M2-core-meters、M2-event-run（`director.cast` 的型別）。同一個資料夾的三張（這一張、M2-npc-interact、M2-npc-life）排成一串。

## 完成時回報

改了哪些檔、測試結果、NPC_SYSTEM 第 2～5 節裡留成接口的（預期：外貌的句子、綽號、AI 寫的部分、內海的常駐者）。
