# M4-scene-seats

- 交給：cpp-feature（sonnet）
- 目標：成人場景的狀態從寫死的兩個人改成「座位」，一對一的行為完全不變；同一張把後面幾張要的接口開好：AI 給的行動與說話結果從 `SceneEnv` 進來、技能的 `needs`、觸手的例外、部位的敏感度、限回合的場景、對象性別與 NTR 的篩選。
- 規格出處：LEWD_SYSTEM 3.2～3.5 節（第七點多人是下一張）、第 9 節（可關閉的細項）；DATA 3.1～3.4 節、第 4 節的 `adult_scene`；AI_TASKS 3.6 節、4.2 節（`scene_turn`、`scene_talk` 的驗證那一欄）；dev/adr/0019 第九節與 P31、P64；dev/adr/0016 G6、G11；dev/status.md「M2-scene 沒做的」「M2-ui-scene 回報」。
- 可以改的路徑：`engine/src/features/scene/`、`engine/tests/features/M4-scene-seats.test.ts`。
- 可以用的介面：`features/scene` 現有的一切（`model.ts` 的 `SceneState`、`play.ts` 的 `Play`、`end.ts`、`view.ts`）；`k.conditions.test`、`k.conditions.kinds`；`tagsAllowed`、`CONTENT_TAGS`（`male_partner`、`female_partner`、`femboy_partner`、`trans_partner`、`futa_partner`、`ntr`）；`k.hooks.run`（新掛點 `scene.body`，這一張宣告）；`syncCapOf` 等同步的函式。
- 不可以做的事：**不改任何規則的數字與一對一的結果**（現有的 `M2-scene*`、`M3-scene-sync` 測試一個字不改全過，「隨機走一整場」保留它自己的逾時）；不做三個人以上的回合（下一張）；不呼叫 AI；不升存檔版本；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `SceneState` 第二版（`v: 2`）：
  - `kind`（`pair`、`group`、`solo`；這一張只會有 `pair`）、`layer`（`meat`、`net`；這一張只會有 `meat`）、`pc`。
  - `seats: Seat[]`（第一個是主角）：`{ id, ap, gear, max_gear, shifted, sink_gain, climax, received, teased, restrained, out? }`。
  - `pairs: Record<對象的 id, { fit, init, first }>`：主角對這一圈每個人。
  - `links`：每一條的 `by`、`to` 都是角色的 id；多一個 `double?: true`。
  - `roles: Record<角色的 id, 體位裡的位置>`、`turn`（現在輪到誰的 id）、`lines` 的 `who` 是角色的 id。
  - `circles: []`、`pace?`、`max_rounds?`：先放著。
- 讀舊的：`sceneOf` 讀到沒有 `v` 的（`pc`／`partner` 那一種）就地轉成第二版再回傳；寫回去的一律是第二版。
- `SceneInput` 多選填的 `target`（對誰；一對一時沒給就是對方）。
- `SceneEnv` 多：`moves?: Record<角色的 id, SceneInput[]>`（外殼從 `scene_turn` 拿到的、這個人這一步的一串行動）、`talk?: { fit: number, goal?: number, agree?: boolean }`（`scene_talk` 的結果）、`gears?: Record<角色的 id, SyncGear>`（取代 `partner_gear`，舊的鍵照收）。
- 夜課技能與道具的 `scene` 多讀：`needs?: Condition[]`、`double?: true`（這個技能讓同一個部位再接一條）、`solo?`（M4-scene-solo 讀）。
- 掛點 `scene.body`（這個功能宣告）：`[{ state, actor, layer }, { parts?: string[], sensitivity?: Record<部位, number>, tags?: Record<部位, string[]> } | void]`，好幾個回答合起來（部位取聯集、修正相加）。
- `SceneSetup` 多：`max_rounds?`（到了就強制結束，原因是「被外面的事打斷」）、`layer?`。
- `sceneView`：一對一的場景原本的欄位（`pc`、`partner`……）照舊，多 `seats`、`pairs`、`circles`、`kind`、`layer`。

## 要做的

1. 把 `Record<Who, …>` 全部換成照角色 id 的座位與配對；`Play` 裡用 `Who` 的地方改成收角色的 id。一對一時「對方」就是 `seats[1]`。做完先確認舊測試全過，再做下面的。
2. `env.moves`：輪到某個由程式控制的人時，有給他的就照順序一個一個驗（行動點夠、有主動權才能切換體位、部位空著或照連接的規則中斷、要標籤的技能有標籤、體位他會；不能是 `stop`）。第一個不合規的連同後面的全部丟掉，這個人剩下的行動點照現有的規則走；報告的 `data` 記下丟掉了幾個與第一個的原因。沒給就全照規則。
3. `env.talk`：這一步是說話時有給就用它（契合夾在 −5～+10、目的的進度夾在 0～+20），沒給照現有的檢定。
4. `needs`：用出技能或道具之前每個條件用 `k.conditions.test`（看的人是用的那個人）。不成立的灰掉，原因寫條件的說明；條件的種類沒有人註冊時當作不成立，原因是「這個條件現在還判斷不了。」（P31）。
5. 觸手的例外：帶 `double: true` 的技能建立連接時，自己的那個部位已經有一條 `double` 以外的連接也不中斷，同一個部位最多兩條（LEWD_SYSTEM 3.5 節第四點）。
6. 部位：一個人有哪些部位＝基本的七個＋`actor.ext.scene.parts`（照舊）＋`scene.body` 回答的。受到的感載用「這個人敏感度的有效值＋被接的那個部位的修正」（P64）；沒有人回答 `scene.body` 時和現在一樣。
7. `max_rounds`：回合數到了，這一步結束時走現有的打斷流程。
8. 篩選：對象的性別對到的那一個標籤（`male` 對 `male_partner`、`female` 對 `female_partner`、`femboy` 對 `femboy_partner`、`trans_f` 對 `trans_partner`、`futa` 對 `futa_partner`）被關掉時，`startProblems` 多一條原因；`setup.tags` 含 `ntr` 而 `ntr` 被關掉時同樣開不起來。
9. 確認框的資料：`startProblems` 的結果多回傳一份開場的摘要（誰、性質、身分、目的、會碰到的標籤），畫面的確認框用它，不必自己判斷第 0 步。

## 驗收條件（`engine/tests/features/M4-scene-seats.test.ts`；沿用 M2-scene 測試的假體位與假對象）

- 現有的場景測試不改全過。
- 一份舊形狀的進行中場景（從 M2 的測試抄一份狀態）放進存檔：`sceneOf` 回傳第二版；接著 `sceneAct`、`sceneNext` 走到結束，結果和同一個種子用舊程式走的逐欄相同（測試裡先用「全新開一場、走同樣的輸入」當對照）。
- `env.moves` 給對方三個行動、第二個不合規（沒有主動權卻切換體位）：第一個生效、後兩個沒有、報告的 `data` 有丟掉的數目與原因；給 `stop` 被丟掉。
- `env.talk` 給契合 +30：只加 10；沒給時照檢定。
- 技能帶 `needs: [{ kind: 'has_item', … }]`：沒有那件物品時灰掉並有原因、有的時候用得出來；條件種類亂寫時是那一句。
- `double` 的技能：同一個部位同時有兩條連接；一般的技能照舊換掉原本那一條。
- 測試掛一個 `scene.body`：對方多一個部位 `tail`、`back` 的修正 +20：體位允許時 `tail` 可以被選；接他 `back` 的那一下受到的感載比接 `chest` 的多（固定骰子）。
- `max_rounds: 2` 的場景在第二回合結束時收掉，原因是打斷。
- 對象是 `futa` 而 `futa_partner` 被關掉：開不起來並有原因。
- `sceneView` 一對一時 `partner` 欄位還在，並多 `seats`、`pairs`。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；`ui/` 的 `vue-tsc` 沒有因為型別改名而壞（壞了的話在 `sceneView` 補回舊的名字，不改 `ui/`）。

## 完成時回報

改了哪些檔、測試結果、`Who` 這個型別還留在哪裡、介面之後要跟著改的欄位清單。
