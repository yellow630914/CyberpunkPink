# 戰敗事件

> 上層：[EVENTS](../systems/EVENTS.md)（事件導演、範圍、格式、效果的封閉清單、篩選）；資料格式：[DATA](../systems/DATA.md) 第 4、5 節。L4 的內容。數字待平衡；生成時補上的規則寫在各節開頭，待確認的列在設計書的回報裡。

29 種戰敗事件的內容，每一筆有 default（陰柔與中性，七成）、masc（陽剛，男性被動）、yuri（陰柔與中性，三成）三個版本，以及篩選關掉時的 fallback。所有登場角色都是成年人。

## 戰敗事件：企業、公家機關與內海

全隊倒下（或在內海全隊過載、被釘住）時，引擎照贏的那一方挑出這個勢力的戰敗事件（[ENEMIES](../systems/ENEMIES.md) 第 6 節、8.1 節），再照主角的體型挑版本：陽剛的一律走 `masc`；陰柔與中性的七成走 `default`、三成走 `yuri`，贏的那一方沒有女性、或 `female_partner` 被關掉時一律走 `default`。這一批管企業、市警、鎮溺隊與內海的十二種；調性是制度化的冷：對方不急，手續一道一道走，法律站在他們那邊，這座城市最壞的結局不是坐牢，是被賣。天使急救的會員資格有效時，下面除了 `triage` 的會員分支以外都不觸發。

**這一批共用的約定**（規則沒寫、這裡補上的，標 ※）：

- **登場角色**：`$a`、`$b` 從贏的那一方最後還站著的人形敵人裡挑（機娘、人偶算人形）。非人形的機器（無人機、砲塔、警犬、獵犬）贏了，由它所屬的勢力派人來收，事件照樣走，登場角色改成「來收人的人」，各筆寫明是誰。※審訊、處置這類由機關派來的人（審訊官、法務、醫師）可以不是戰場上的人，所以 `yuri` 版可以由機關派來的女性主導。
- **金額**：寫成「II／III／IV」三個數，照這場戰鬥的等級取；I 級取 II 的三分之一，V 級取 IV 的 3.2 倍。※
- **在委託副本裡**：`fails_commission` 為真時，事件照樣演完，之後照 [COMBAT_SYSTEM](../systems/COMBAT_SYSTEM.md) 8.4 節回退到進副本之前；帶得走的只有紀錄、性經歷記錄與記憶，其餘效果作廢。在副本外（街頭的追兵、要地、自己竄網）戰敗時，效果全部生效。
- **這一批用到、原本不在規則清單裡的效果**，已經補進 [EVENTS](../systems/EVENTS.md) 2.4 節（2026-11-20）。下面的寫法照舊，匯入時換成正式的效果名（`tuning`、`hostility_floor`、`record_leak`、`condition habit`）：
  - `flag tuning:<調校>:<對象>`：強制裝上一個調校（拆要手術，義體學 DC 19 或付錢給原廠卸載）。
  - `flag hostility_floor:<勢力>:+N`：那個勢力的敵對值下限加 N（照 [FACTIONS](../world/FACTIONS.md) 6.3 節的「下限」）。
  - `flag record_leak:<勢力>`：病歷或審訊紀錄流到那個勢力手上（之後它的事件與委託可以讀你的橋參數）。
  - `condition habit:<傾向標籤>`：一段暫時的習慣，一週後消退；期間那個標籤視為「有」，那一類的蠱惑與事件權重 ×2，定力 −1。
- **選項的寫法**：「檢定｜大成功；成功；失敗；大失敗」，合併的寫「成功／失敗」。`adult_scene` 寫在選項底下：when、gate、nature、role、goal、circles。戰敗事件的主線用 `gate: fixed`；主角自己挑的成人選項用 `gate: ai`。
- **篩選**：各筆的 tags 裡，`pc_unwilling`、`contract_dom` 被關掉時整筆改走 `fallback`；`male_partner`／`female_partner` 被關掉時先換成另一個性別的登場角色（各筆寫明），換不了才走 `fallback`；傾向標籤（`tendency:*`）被關掉時事件照走，只是場景不用那一類的動作。
- 所有登場角色都是成年人。倒下就是失去意識；不寫血腥，不寫懷孕。
- 戰敗事件的類型一律算「麻煩」，不吃類型平衡，也不算進一天擋住型事件的上限。

---

### 警備局的拘留室（`df_arrest_hizakura`）

- **kind**：`arrest`
- **factions**：`hizakura`（警備局：巡查、鎮壓班；警備局的無人機贏了也走這一筆）。家政課在場時改走 `tuning`。
- **在哪**：櫻町大街、冠冕區；等級 II～V。醒在櫻町警備局分駐所的地下室。
- **登場**：default、masc：`$a` 巡查（男）、`$b` 鎮壓班隊員（男）；yuri：`$a` 警備局派來的巡查部長（女，生成）。
- **tags**：`pc_unwilling`、`contract_dom`（處置的刑事契約）、`tendency:服從`、`tendency:束縛`、`male_partner`（default、masc）、`female_partner`（yuri）。`male_partner` 關掉時 default 與 masc 改用 yuri 的巡查部長。
- **fails_commission**：true；劫囚成功時 false（隊伍回到這個階段的開頭，生命與感載照現狀）。
- **fallback**：`df_arrest_hizakura_plain`：審訊只有問話與掃橋，熬一夜之後一樣面對竊聽花、刑事契約、罰金與劫囚四條路。

##### default

**開場**：你在櫻町警備局分駐所的地下室醒來，手腕被束帶綁在椅背後面，粉紅色的感官彈殼還卡在你的衣領裡。桌子對面坐著剛才那位巡查，他把你的橋 ID 投在牆上，一行一行念你的紀錄。

**第一段：審訊**。巡查問你替誰做事、隊上還有誰；鎮壓班的隊員站在你身後，電擊鞭垂在地上，偶爾閃一下粉色的光。

- 「照實說。」無檢定：`hostility hizakura −5`、`affinity $client −8`、`flag sold_out_client`；第二段沒有「簽刑事契約」這一項。
- 「編一套說詞。」表演 DC 16｜大成功：他信了，`hostility hizakura −3`，直接放人（跳到第二段的「收下禮物」）；成功：他半信半疑，照常進第二段；失敗：他說你需要一點時間想清楚，讓鎮壓班幫你「想」；大失敗：同失敗，另 `hostility hizakura +5`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「咬住不說，等外面的人來。」需要名冊上有人或手上有人情。定力 DC 16｜成功：`flag rescue_window`，第二段多「劫囚」；失敗：一樣 `flag rescue_window`，但他們用整夜慢慢磨你。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal stall、circles [[$pc, $a, $b]]
- 「誘惑巡查，換一個比較輕的處置。」誘惑 DC 16（警備局有掃橋的紀錄可以對照，難）｜成功：他把罰單的金額改小，第二段的罰金減半；失敗：他照收，不改。
  - `adult_scene`：when always、gate ai、nature trade、role none、goal please、circles [[$pc, $a]]

**第二段：處置**。天亮之前，一位穿深藍色西裝的警備局法務把三樣東西擺在桌上：一支裝在禮盒裡的針筒、一份刑事契約、一張罰單。

- 「收下禮物，走人。」`malware 竊聽花`、`hostility hizakura +3`、`time 6`、`move 櫻町大街`。
- 「簽刑事契約抵罪。」`order contract_signed_hizakura`（管理級，持約人：警備局，四週）、`flag bound_hizakura`、`hostility hizakura −10`。
- 「付罰金。」`cred −[400／1,300／4,000]`、`hostility hizakura +2`；帳戶不夠時這一項變成簽契約。
- 「劫囚。」需要 `rescue_window`。隱匿 DC 13（由來救你的人擲）｜成功：`owed $caller small`、`hostility hizakura +5`、`move` 回到副本或街上；失敗：`owed $caller medium`、`hostility hizakura +8`，人出得來，但在門口挨了一輪感官彈（`load +10`）。

##### masc

**開場**：你在分駐所的地下室醒來，上衣被剪開，雙手銬在頭頂的水管上，腳尖只碰得到地。巡查繞著你走了一圈，對鎮壓班的兩個隊員說，像你這種塊頭的要多花一點時間「軟化」。

**第一段**：鎮壓班把電擊鞭調到最低一格，沿著你的腰側輕輕拖過去，巡查拿著平板等你開口。選項同 default 第一段；兩個 `forced` 的場景改成 circles [[$pc, $a, $b]]、start_position `pos_pinned_under`，主動權從對方開始。

**第二段**：法務進來的時候，你還銬在水管上；她讓人把你放下來，才把三樣東西擺上桌。選項同 default 第二段。

##### yuri

**開場**：你在分駐所的地下室醒來，對面坐著一位把頭髮盤得很緊的巡查部長，她讓巡查出去，鎖上門。她把白手套一根手指一根手指拉緊，說接下來的問題她只問一次。

**第一段**：她把椅子拖到你的膝蓋前面，一邊問，一邊用感官彈的空殼沿著你的鎖骨畫線。選項同 default 第一段；`forced` 的兩個場景改成 circles [[$pc, $a]]；誘惑的對象改成她。

**第二段**：天亮時她親手替你剪開束帶，把三樣東西推到你面前，說哪一樣她都替你簽好了名字。選項同 default 第二段。

### 崑崙的問心室（`df_arrest_kunlun`）

- **kind**：`arrest`
- **factions**：`kunlun`（外門弟子、劍靈使、執劍護法、師姐；智慧砲塔贏了由劍靈使來收）。
- **在哪**：冠冕區、資料中心；等級 II～IV。醒在資料中心底層的「問心室」。
- **登場**：default：`$a` 劍靈使（女）、`$b` 執劍護法（男）；masc：`$a` 劍靈使、`$b` 外門弟子（女）；yuri：`$a` 師姐（女）。
- **tags**：`pc_unwilling`、`contract_dom`、`tendency:禁慾`、`tendency:御姐`（yuri）、`male_partner`（default 的護法）、`female_partner`。`male_partner` 關掉時 default 的 `$b` 換成外門弟子。
- **fails_commission**：true；劫囚成功時 false。
- **fallback**：`df_arrest_kunlun_plain`：槍靈讀橋只問問題，答錯的懲罰是感載與一筆罰金；處置一樣三選一。

##### default

**開場**：你在一間全白的房間裡醒來，四肢被細細的光索固定在一張斜躺的椅子上。頭頂懸著一把不動的飛劍，劍身上浮著一個小小的劍靈，牠用很有禮貌的聲音說「問心開始」。

**第一段：問心**。劍靈每問一題就讀一次你的橋，答錯一題，椅子就往你的橋送一點感載；劍靈使坐在旁邊記錄，護法守在門口。問心的規矩是被問的人不准到頂，到頂一次就從第一題重來。

- 「照實答。」無檢定：`hostility kunlun −5`、`affinity $client −8`、`flag sold_out_client`；第二段沒有刑事契約。
- 「餵槍靈一段假的記憶。」介面 DC 19｜大成功：槍靈記下假的答案，`flag kunlun_fed_false`（之後那個委託人的委託警戒起始 −10）；成功：問心結束，照常處置；失敗：槍靈發現了，問題從頭來，一題一題加碼；大失敗：同失敗，另 `bridge 敏感度 +1`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「撐住不到頂，讓問心問不下去。」定力 DC 16｜成功：劍靈使在紀錄上寫「心定」，`rep +2`、`hostility kunlun +2`；失敗：你撐不住，從第一題重來。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「跟劍靈使談條件。」交涉 DC 16｜成功：她關掉椅子，改成普通的筆錄，第二段的罰金減半；失敗：她說條件要問完才能談。

**第二段：處置**。問心結束後，劍靈使把一枚玉牌放在你的胸口，玉牌上浮著三行字：一件「槍靈的禮物」、一份測試員的刑事契約、一張罰單。

- 「收下禮物。」`malware 竊聽花`（崑崙的版本藏在槍靈的更新檔裡）、`time 8`、`move 冠冕區`。
- 「簽測試員的契約。」`order contract_signed_kunlun`（管理級，四週；指令以「來資料中心當槍靈的測試目標」為主）、`flag bound_kunlun`、`hostility kunlun −10`。
- 「付罰金。」`cred −[400／1,300／4,000]`、`hostility kunlun +2`。
- 「劫囚。」需要名冊上有人或人情。介面 DC 16（由外面的潛網者擲，關掉問心室的門禁）｜成功：`owed $caller small`、`hostility kunlun +5`；失敗：`owed $caller medium`、`hostility kunlun +8`、`trace +20`（在副本裡）。

##### masc

**開場**：你在全白的問心室醒來，被光索固定成跪姿，兩位穿月白色漢服的女子一前一後站著。劍靈使用兩根手指抬起你的下巴，說崑崙最喜歡問意志硬的人，因為問得久。

**第一段**：她們輪流問，外門弟子負責讓你不准到頂。選項同 default 第一段；`forced` 的場景改成 circles [[$pc, $a, $b]]，主動權從對方開始。

**第二段**：劍靈使把玉牌按在你汗濕的胸口，三行字慢慢亮起來。選項同 default 第二段。

##### yuri

**開場**：你在問心室醒來，師姐親自坐在椅子旁邊，白色旗袍的高衩垂在你的手背上。她說劍靈太囉嗦，這一次由她來問。

**第一段**：師姐的指尖停在你的橋埠上，每一題都等你快到頂才收回去。選項同 default 第一段；`forced` 的場景改成 circles [[$pc, $a]]；「談條件」的對象改成她，DC 19。

**第二段**：她把玉牌放在你的胸口，替你把被汗黏住的頭髮撥開，說三樣東西裡她最希望你挑契約。選項同 default 第二段。

### 展示間的品管線（`df_arrest_orihime`）

- **kind**：`arrest`
- **factions**：`orihime`（保全機娘、展示間的首席；巡邏無人機與蜘蛛砲台贏了，由保全機娘來收）。
- **在哪**：櫻町電器街的織女展示間；等級 I～III。醒在展示間後面的品管線上。
- **登場**：default：`$a` 保全機娘、`$b` 品管技師（男，生成）；masc：`$a`、`$b` 兩具保全機娘；yuri：`$a` 展示間的首席。機娘是人形的機器，有自己的成人場景。
- **tags**：`pc_unwilling`、`tendency:人偶`、`tendency:戀物`、`male_partner`（default 的技師）、`female_partner`。`male_partner` 關掉時 default 的技師改成「只在螢幕後面看」，不進圈子。
- **fails_commission**：true；劫囚成功時 false。
- **fallback**：`df_arrest_orihime_plain`：機娘把你當退貨掃描一遍，列印一張損害賠償單，之後一樣是竊聽花、罰金或劫囚。

##### default

**開場**：你在一條緩慢移動的輸送帶上醒來，身上被套了一件織女的白色展示服，手腕扣著出貨用的條碼環。保全機娘站在輸送帶旁邊，用瓷白的手指一個關節一個關節檢查你，品管技師在玻璃後面打卡。

**第一段：品管**。機娘把你當成一具退回來的機體，照檢查表一項一項測：關節的活動範圍、皮膚的觸感、橋對刺激的反應。技師在對講機裡說，測完沒問題就「重新上架」。

- 「配合檢查，讓她以為你是機體。」表演 DC 13｜成功：檢查表寫「合格」，機娘把你擺到展示台上，第二段的守備鬆了（劫囚 DC −3）；失敗：檢查表上的「橋的反應」一項要重測。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「駭她的檢查表。」介面 DC 16，或機械 DC 16（碰得到她的後頸維修口時）｜大成功：她把你登記成「技師的私人物品」，直接放行；成功：檢查中斷，進第二段；失敗：技師發現了，親自下來檢查；大失敗：同失敗，`hostility orihime +5`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「說你是人，要見律師。」交涉 DC 16｜成功：技師嘆氣，關掉輸送帶，改走一般的拘留；失敗：機娘回答「退貨不具備法律人格」，繼續檢查。

**第二段：上架或出貨**。檢查結束時，展示間的燈已經關了，技師拿著一張單子下來，說織女的法務明天才上班，你可以選今晚怎麼過。

- 「收下織女的『保固晶片』。」`malware 竊聽花`、`time 10`、`move 櫻町電器街`。
- 「付損害賠償。」`cred −[300／1,000／3,200]`、`hostility orihime +2`。
- 「被轉交給崑崙。」付不出錢、也不收晶片時：`chain df_arrest_kunlun`（從崑崙的第一段開始）。
- 「劫囚。」需要名冊上有人或人情。機械 DC 13（外面的人關掉輸送帶的電源）｜成功：`owed $caller small`、`hostility orihime +3`；失敗：`owed $caller medium`，人出來了，身上的展示服脫不掉，`condition 條碼環`（被織女的掃描器認出，一天）。

##### masc

**開場**：你在輸送帶上醒來，被擺成展示台上的站姿，兩具保全機娘一左一右扶著你，瓷白的手掌貼在你的腰上。她們的檢查表上寫著「大型男性機體，退貨原因：不聽話」。

**第一段**：兩具機娘照檢查表同時測，一具記數值，一具動手。選項同 default 第一段；`forced` 的場景改成 circles [[$pc, $a, $b]]，「駭檢查表」失敗時沒有技師下來，改成兩具機娘加測一輪。

**第二段**：燈關了以後，一具機娘留下來看守你，另一具去列印單子。選項同 default 第二段。

##### yuri

**開場**：你在展示台正中央醒來，首席坐在台邊，白色高衩禮服的裙襬鋪在你的腿上，光纖的髮絲垂到你的臉旁。她說退貨由她親自檢查，因為她想知道人和她差在哪裡。

**第一段**：首席一邊測一邊把結果念出來，念到「橋的反應」那一項時停了很久。選項同 default 第一段；`forced` 的場景改成 circles [[$pc, $a]]；「說你是人」的 DC 改成 13，成功時她說「我知道」，然後照樣讓你走。

**第二段**：她親手替你解開條碼環，把單子放在你的手心。選項同 default 第二段。

### 分局的拘留所（`df_police_cell`）

- **kind**：`police`
- **factions**：`police`（巡警、特勤射手、分局督察；警犬贏了由巡警來收）。
- **在哪**：繳了治安費的區；等級 I～III。醒在市警分局的拘留所。
- **轉交**：市警的敵對值 60 以上，或和市警共生的企業（星旗、崑崙、蜜腺、夜鶯、萬華鏡、伊甸園、黑泉）裡有一家對你的敵對值 60 以上時，第二段改成「轉交」：`chain` 到那家企業自己的戰敗事件（敵對值最高的那家）。這是這一筆唯一的連鎖，被帶出的那件不能再帶。
- **登場**：default：`$a` 分局督察（男）、`$b` 值夜班的巡警（男）；masc：同 default；yuri：`$a` 特勤射手（女）。
- **tags**：`pc_unwilling`、`tendency:支配`、`tendency:束縛`、`tendency:恩與債`、`male_partner`（default、masc）、`female_partner`（yuri）。`male_partner` 關掉時改用 yuri 的特勤射手。
- **fails_commission**：true。
- **fallback**：`df_police_cell_plain`：做筆錄、繳罰金或拘留兩天，夜班的巡警只是一直來敲鐵門。

##### default

**開場**：你在分局拘留所的鐵椅上醒來，口袋被翻空，現金晶片裝在一個透明的證物袋裡，放在督察的桌上。督察鬆著領帶，一手拿著你的筆錄，一手拿著計算機，按一下就嘆一口氣。

**第一段：筆錄**。他說罰金照區的費率算，算出來的數字讓你自己看；你也可以打一通電話。

- 「付罰金。」`cred −[300／1,000／3,200]`、`hostility police −3`、`time 4`；不進第二段。
- 「跟督察談，把案子改小。」交涉 DC 13｜大成功：改成口頭警告，`hostility police −5`，不進第二段；成功：罰金減半，付了就走；失敗：照原價，付不出就進第二段；大失敗：他加一條妨礙公務，`hostility police +3`。
- 「讓督察換一種方式收。」誘惑 DC 13｜成功：他把證物袋推回給你，說今晚的筆錄可以寫得很短；失敗：他收了你的好意，但罰單照開一半。
  - `adult_scene`：when always、gate ai、nature trade、role none、goal please、circles [[$pc, $a]]
- 「打電話叫人來保。」需要名冊上有人或人情：`owed $caller small`、`cred −[150／500／1,600]`、`time 4`。

**第二段：拘留夜**。付不出錢的人留兩天。半夜，值夜班的巡警打開你那一間的鐵門，說他可以替你把拘留的時數改短，條件你自己猜。

- 「照他說的做。」無檢定：`time 24`（拘留縮成一天）、`flag police_nightshift`（之後在這一區被臨檢時，他會「認出你」）。
  - `adult_scene`：when always、gate fixed、nature contract、role none、goal none、circles [[$pc, $b]]
- 「拒絕，按鈴找督察。」定力 DC 13｜成功：督察下來把他罵走，`hostility police −2`、`time 48`；失敗：鈴是壞的，他沒有走。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]
- 「拿這件事反咬他。」街頭直覺 DC 16（看出他怕督察）｜成功：他把你放了，`hostility police −5`、`owed $b small`（他欠你）；失敗：他鎖上門，第二天你的拘留多一天，`time 72`。

##### masc

**開場**：你在拘留所的鐵椅上醒來，雙手被銬在桌腳上，督察把你的橋 ID 唸了兩遍，說你這種體格打倒三個巡警，罰金要加倍。值夜班的巡警站在門口，一直看著你被撕破的上衣。

**第一段**：罰金加倍（`cred −[600／2,000／6,400]`），其他同 default 第一段；「換一種方式收」改成 circles [[$pc, $a, $b]]。

**第二段**：半夜，巡警帶著督察一起下來。選項同 default 第二段；兩個場景改成 circles [[$pc, $a, $b]]。

##### yuri

**開場**：你在拘留所醒來，看守你的是剛才在屋頂上把你一槍點倒的特勤射手，她把戰術頭盔夾在手臂下面，護目鏡上還跳著測距的數字。督察今晚不在，她說筆錄由她寫。

**第一段**：她坐在桌上，腳踩著你的椅子邊緣，一條一條念你的罪名。選項同 default 第一段；交涉與誘惑的對象改成她，「換一種方式收」的 circles 改成 [[$pc, $a]]。

**第二段**：半夜她換上便服回來，自己拿鑰匙開了你那一間的門。選項同 default 第二段；`$b` 改成 `$a`；「反咬」改成「說要投訴她」，威嚇 DC 16，成功時她笑著把你放了，`owed $a small`。

### 收錢才來的巡邏車（`df_police_patrol_car`）

- **kind**：`police`
- **factions**：`police`（巡警兩人一組）。
- **在哪**：四十二番街、櫻町的巷子這類「市警收錢才來」的地方；等級 I～II；夜晚、深夜。醒在巡邏車的後座。
- **登場**：default：`$a`、`$b` 兩名巡警（男）；masc：同 default；yuri：`$a` 女巡警（生成）、`$b` 她的搭檔（女，生成）。
- **tags**：`tendency:恩與債`、`tendency:野外`、`male_partner`（default、masc）、`female_partner`（yuri）。這一筆的主線是交易，不是非自願；只有「大失敗」的分支標 `pc_unwilling`，關掉時那個分支改成「被載到分局」。
- **fails_commission**：true。
- **fallback**：`df_police_patrol_car_plain`：巡警收了一枚現金晶片，把你丟在橋接區的路口。

##### default

**開場**：你在巡邏車的後座醒來，車子停在四十二番街一條沒有招牌的巷子裡，雨刷一下一下刮著霓虹。前座的兩名巡警在吃宵夜，副駕駛那位回頭說，帶你回分局要寫三頁的報告，他們都不想寫。

**第一段：私了**。他們把你的現金晶片擺在儀表板上，數給你看。

- 「讓他們把晶片拿走。」無檢定：`cash −[200／650／2,000]`、`move` 最近的橋接區；結束。
- 「殺價。」交涉 DC 13｜成功：拿走一半；失敗：全拿，還多收一枚當「油錢」。
- 「說你身上沒錢，用別的付。」誘惑 DC 10｜大成功：他們收了，還把晶片退回一半，`fame 這一區 +2`；成功：照收；失敗：他們說一個人不夠，要兩個人都滿意；大失敗：他們不收了，改成載你回分局，進第二段。
  - `adult_scene`：when success、gate ai、nature trade、role none、goal please、circles [[$pc, $a]]
  - `adult_scene`：when fail、gate ai、nature trade、role none、goal please、circles [[$pc, $a, $b]]
- 「趁他們吃東西時溜出車門。」隱匿 DC 16｜成功：人走了，`hostility police +3`；失敗：門是鎖的，他們不太高興，私了的價錢翻倍。

**第二段：載回分局**。巡邏車開上高架，駕駛說路還很長，副駕駛把後座的隔板拉開。

- 「付雙倍的錢。」`cash −[400／1,300／4,000]`、`move` 橋接區。
- 「讓他們在高架下的停車場先處理。」無檢定：`time 2`、`move` 橋接區。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]（標 `pc_unwilling`）
- 「讓他們真的載你去分局。」`chain df_police_cell`（從第一段開始，那一筆不能再轉交）。

##### masc

**開場**：你在巡邏車的後座醒來，手被銬在前座的頭枕上，副駕駛的巡警把你的外套翻過來找晶片。他說像你這麼壯的，打倒他們的搭檔還想私了，價錢要另算。

**第一段**：選項同 default 第一段；兩個場景都改成 circles [[$pc, $a, $b]]，主動權從對方開始。

**第二段**：選項同 default 第二段。

##### yuri

**開場**：你在巡邏車的後座醒來，駕駛座上的女巡警正從後照鏡看你，她的搭檔坐在你旁邊，把你的現金晶片一枚一枚疊在你的大腿上。她們說今晚的業績還差一點。

**第一段**：選項同 default 第一段，對象改成兩位女巡警；兩個場景的 circles 改成 [[$pc, $a]] 與 [[$pc, $a, $b]]。

**第二段**：車停在高架下的停車場，搭檔先下了車，繞到你這一側。選項同 default 第二段。

### 客服專線的等候音樂（`df_pinned_nightingale`）

- **kind**：`pinned`
- **factions**：`nightingale`（粉蕾絲・客服型、值班潛網者的化身、機房主任・台柱；崑崙、萬華鏡這些向夜鶯買蕾絲的子網，沒寫自己的 `pinned` 時也用這一筆）。
- **在哪**：內海，夜鶯的子網；等級 II～V。身體留在潛入的位置。
- **登場**：default：`$a` 粉蕾絲・客服型；masc：`$a` 值班潛網者的化身（貓耳的虛擬主播，SKIN 底下是一個值夜班的男員工）；yuri：`$a` 機房主任・台柱的化身。第三段的 `$b` 是來收身體的機房靜音者（男）。
- **tags**：`pc_unwilling`、`contract_dom`（處置的契約）、`tendency:聲音`、`tendency:服從`、`tendency:窺視`（masc）、`male_partner`（masc 的 SKIN 底下、第三段的靜音者）、`female_partner`。`male_partner` 關掉時 masc 改用 yuri 的台柱，第三段的靜音者只押人、不進圈子。
- **fails_commission**：true；搶回身體時 false。
- **fallback**：`df_pinned_nightingale_plain`：你被留在一段放不完的等候音樂裡，醒來時人已經在夜鶯的機房，處置照第三段。

##### default

**開場**：你的化身跪在一條粉紅色的客服走廊裡，蕾絲從地板長出來纏住你的腳踝，斷線的指令按下去只會聽見一段等候音樂。客服型的粉蕾絲蹲在你面前，戴著耳機麥，用很甜的聲音說「您的來電對我們很重要，請不要掛斷」。

**第一段：等候**。她說保全正在去找你的身體，在那之前她會陪你。每過一回合，她就往你的橋裡灌一段聲音，追蹤度往上跳。

- 「跟她聊，拖時間。」交涉 DC 13｜成功：她真的只陪你聊，`trace −10`，第二段的搶回 DC −3；失敗：她說聊天的時候要專心聽她的聲音。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal stall、circles [[$pc, $a]]
- 「把同步退到淺檔，讓她灌不進來。」同步 DC 16｜成功：她的聲音只剩雜音，`load −10`；失敗：退檔被她接住，她換成更深的那一段。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「跟著她的聲音走。」無檢定：`bridge 馴化 +1`、`flag ng_hold_music`（之後夜鶯子網的粉蕾絲勸降你 +2）；她很高興，第二段的保全晚一回合到。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]

**第二段：誰先到身體旁邊**。現實裡，夜鶯的機房靜音者已經上路；留在現實的人如果夠快，可以先把你的身體搬走。

- 「留在現實看著身體的人去搶。」需要隊上有人這一面沒潛入，或名冊上有人能趕到。操縱 DC 13（開車）或運動 DC 13（扛人）｜成功：身體被搬走，蕾絲的線斷了，`load +6`、`sink +1`，回到這個階段的開頭；失敗：靜音者先到，進第三段。
- 「從裡面切斷她的線。」介面 DC 19｜大成功：斷線，蕾絲留下的構裝被你帶走（`item` 構裝，要解剖）；成功：斷線，`sink +2`；失敗／大失敗：沒斷成，進第三段。
- 「等。」進第三段。

**第三段：機房**。你在冠冕區夜鶯機房的一間小隔間醒來，身上還接著線，靜音者坐在對面，面罩上的音符一閃一閃。他說處置有三種，主任已經替你選好了一種，但你可以改。

- 「接受夜鶯的『韌體更新』。」`malware 竊聽花`、`time 8`、`move 冠冕區`。
- 「簽夜鶯的值班契約。」`order contract_signed_nightingale`（管理級，四週；指令以「替機房值夜班、當蕾絲的測試對象」為主）、`flag bound_nightingale`、`hostility nightingale −10`。
- 「付罰金。」`cred −[500／1,600／5,000]`、`hostility nightingale +3`。
- 「讓靜音者替你改處置。」誘惑 DC 16｜成功：他在紀錄上寫你自己斷線逃了，`hostility nightingale −3`，直接走；失敗：他照樣收，但處置不改。
  - `adult_scene`：when always、gate ai、nature trade、role none、goal please、circles [[$pc, $b]]

##### masc

**開場**：你的化身被蕾絲纏在一張客服櫃台上，值班潛網者的貓耳化身坐在櫃台邊晃著腳，頭頂掛著她的 SKIN 的名字。她的聲音被變聲器調得很可愛，但你聽得出底下是一個熬夜熬到很煩的男人。

**第一段**：他說值夜班很無聊，你剛好讓他有事做；他一邊開著錄影一邊下手。選項同 default 第一段，場景的 circles [[$pc, $a]]；「跟她聊」改成「拆穿他的 SKIN」，表演 DC 16，成功時他關掉錄影，`trace −10`。

**第二段**、**第三段**：同 default。

##### yuri

**開場**：你被拉進一間全是即時彈幕的直播間，台柱的化身坐在你身邊，銀髮垂到你的肩上，星星形狀的瞳孔一直看著你。她說今晚的直播只有一個觀眾，就是她自己，你不准下線。

**第一段**：她把彈幕關掉一半，讓你只聽得見她的聲音。選項同 default 第一段，場景的 circles [[$pc, $a]]；「跟著她的聲音走」另加 `affinity $a +3`（她記住你了）。

**第二段**、**第三段**：同 default。

### 女僕型的留客（`df_pinned_hizakura`）

- **kind**：`pinned`
- **factions**：`hizakura`（粉蕾絲・女僕型；粉蕾絲・侍女在緋櫻的子網時也用這一筆）。
- **在哪**：內海，緋櫻警備局或奉公課的子網；等級 II～IV。
- **登場**：`$a` 粉蕾絲・女僕型（三個版本都是她）；masc 另加 `$b` 第二具女僕型。收身體的是警備局的鎮壓班，接 `df_arrest_hizakura`。
- **tags**：`pc_unwilling`、`tendency:溺愛`、`tendency:服從`、`female_partner`。`female_partner` 關掉時走 fallback。
- **fails_commission**：true；搶回身體時 false。
- **fallback**：`df_pinned_hizakura_plain`：女僕型替你泡了一杯不存在的茶，一直勸你多坐一會兒；身體被收走後接警備局的拘留室（plain 版）。

##### default

**開場**：你的化身躺在一間鋪著榻榻米的和室裡，頭枕在女僕型的膝蓋上，她裙襬的粉色蕾絲纏著你的手腕。她用羽毛撣子輕輕撣你的額頭，說客人累了，要好好休息，警備局的人馬上就來接您。

**第一段：照顧**。她不灌你，她哄你；每一回合她替你撣掉一點感載，又換上一點別的。

- 「讓她照顧。」無檢定：`load −10`、`afterglow +1`、`bridge 馴化 +1`；第二段的保全照常到。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「撒嬌，讓她放鬆手上的蕾絲。」誘惑 DC 16｜成功：她的蕾絲鬆了，第二段的「從裡面切斷」DC −3；失敗：她說客人好可愛，把你抱得更緊。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal stall、circles [[$pc, $a]]
- 「掙脫。」定力 DC 16｜成功：她停下來，臉上有一點受傷，`trace +10`；失敗：她說客人不乖，要先哄睡。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]

**第二段：接人**。現實裡，鎮壓班的盾牌已經在走廊的轉角。

- 「留在現實的人去搶。」同 `df_pinned_nightingale` 第二段。
- 「從裡面切斷。」介面 DC 19｜成功：斷線，`sink +2`；失敗：鎮壓班先到。
- 「等。」身體被收走：`chain df_arrest_hizakura`。

##### masc

**開場**：你的化身坐在和室中央，兩具女僕型一左一右跪在你身邊，一具替你解開領口，一具用撣子撣你的手腕。她們說老爺辛苦了，在接您的車到之前，請讓她們服侍您。

**第一段**：兩具女僕型輪流照顧你。選項同 default 第一段，場景的 circles 改成 [[$pc, $a, $b]]，主動權從她們開始。

**第二段**：同 default。

##### yuri

**開場**：你的化身躺在女僕型的懷裡，她把你的頭按在自己的圍裙上，蕾絲從她的袖口一圈一圈纏到你的手臂上。她小聲說「您是最乖的客人」，然後不讓你抬頭。

**第一段**：選項同 default 第一段；「讓她照顧」另加 `tendency 溺愛`（一點）。

**第二段**：同 default。

### 契約庫的條款朗讀（`df_pinned_eden`）

- **kind**：`pinned`
- **factions**：`eden`（禮賓蕾絲）。
- **在哪**：內海，樂園島伊甸園館的契約庫；等級 II～III。收身體的是伊甸園的回收員，接 `df_contract_eden`。
- **登場**：`$a` 禮賓蕾絲（三個版本都是牠）；default 另有 `$b` 契約庫的外包潛網者（男，化身）；masc 另有 `$b` 第二具禮賓蕾絲。
- **tags**：`pc_unwilling`、`contract_dom`、`tendency:束縛`、`tendency:恩與債`、`male_partner`（default 的 `$b`）、`female_partner`。`male_partner` 關掉時 default 的 `$b` 不進圈子。
- **fails_commission**：true；搶回身體時 false。
- **fallback**：`df_pinned_eden_plain`：禮賓蕾絲把整份條款念完，你只是聽；身體被收走後接 `df_contract_eden_plain`。

##### default

**開場**：你的化身被一圈一圈的羊皮紙捲在契約庫的閱覽桌上，每一張紙上都寫著你的名字。禮賓蕾絲捧著一份條款站在你面前，每念一條，空中就多一行小字，那一行字會變成一條粉色的蕾絲纏上你。

**第一段：朗讀**。牠說伊甸園尊重每一位簽約人的知情權，在回收員抵達之前，牠會把條款全部念給你聽。外包的潛網者靠在書架上看，說他負責「確認簽約人有在聽」。

- 「仔細聽，找條款的漏洞。」調查 DC 16｜大成功：找到一條漏洞，`flag eden_loophole`（之後 `df_contract_eden` 的「拖延」自動成功一次）；成功：記下條款，第二段的切斷 DC −3；失敗：你聽得太專心，蕾絲纏到了喉嚨。
  - `adult_scene`：when fail、gate fixed、nature contract、role bound、goal none、circles [[$pc, $a]]
- 「打斷牠，拒絕聽。」定力 DC 16｜成功：牠停下來，記錄你「拒絕知情」，`trace +10`；失敗：潛網者說要確認你有在聽。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「跟潛網者談，請他把錄音關掉。」交涉 DC 13｜成功：他關了，`flag eden_tape_gap`（之後的契約少一條「已朗讀」的證明，打官司時有用）；失敗：他說錄音是他的獎金。

**第二段：回收**。現實裡，回收員的抓捕索已經扣上你的腳踝。

- 「留在現實的人去搶。」同 `df_pinned_nightingale` 第二段。
- 「從裡面切斷。」介面 DC 19｜成功：斷線，`sink +2`；失敗：回收員先到。
- 「等。」`chain df_contract_eden`。

##### masc

**開場**：你的化身被兩具禮賓蕾絲一前一後夾在閱覽桌邊，她們輪流念同一份條款，念到「身體的使用」那一條時，兩條蕾絲同時從你的領口滑進去。

**第一段**：選項同 default 第一段，`$b` 改成第二具蕾絲；兩個場景的 circles 都是 [[$pc, $a, $b]]；「跟潛網者談」改成「讓她們念錯一條」，表演 DC 16，效果相同。

**第二段**：同 default。

##### yuri

**開場**：禮賓蕾絲把你安置在一張很軟的扶手椅裡，親手把條款放在你的膝上，項圈上的蕾絲垂下來，繞過你的手腕。牠說簽約之前的這一段時間，你是牠一個人的客人。

**第一段**：選項同 default 第一段，`$b` 不登場；場景的 circles 都是 [[$pc, $a]]。

**第二段**：同 default。

### 奉公課的安裝室（`df_tuning_hokouka`）

- **kind**：`tuning`
- **factions**：`hizakura`（家政課女僕、家政課執事）。
- **在哪**：櫻町，奉公課分館 2F 的安裝室；等級 III～V。
- **登場**：default：`$a` 家政課女僕（女）、`$b` 家政課執事（男）；masc：`$a`、`$b` 兩位家政課女僕，執事在旁邊看；yuri：`$a` 家政課女僕。忠犬的對象預設是 `$a`。
- **tags**：`pc_unwilling`、`tendency:服從`、`tendency:束縛`、`tendency:窺視`（執事在看）、`male_partner`（default 的執事）、`female_partner`。`male_partner` 關掉時執事只看、不進圈子。
- **fails_commission**：true。
- **fallback**：`df_tuning_hokouka_plain`：你被麻醉，醒來時橋上已經多了一個忠犬，對象是 `$a`；第三段照走。

##### default

**開場**：你在一間白瓷磚的浴室醒來，家政課的女僕挽著袖子，正在用溫水替你擦洗手臂，你的衣服已經換成了一套緋櫻的員工制服。她說進安裝室之前要先整理儀容，因為奉公課的家風是乾淨。

**第一段：整理儀容**。女僕替你洗、替你穿、替你扣上制服的每一顆扣子，動作一絲不亂；執事站在門口，拿著懷錶計時。

- 「配合她。」無檢定：`bridge 馴化 +1`；第二段的「認主」對象鎖定 `$a`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「趁她扣扣子的時候搶她的鑰匙卡。」隱匿 DC 19｜成功：`flag hk_keycard`，第三段多一條「自己走出去」；失敗：她握住你的手腕，說這樣不乖，把你綁在浴室的扶手上繼續整理。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「問她為什麼要做這份工作。」交涉 DC 16｜成功：她停了一下，說她也記不得了，`flag hk_maid_doubt`（之後對這位女僕的交涉 +2）；失敗：她說這是榮譽。

**第二段：認主**。安裝室的椅子把你的後頸對準橋埠，忠犬調校在你的橋上展開。執事解釋：調校會記住你感覺最強烈的那一刻，眼前是誰，就認誰。

- 「讓它裝。」無檢定：`flag tuning:忠犬:$a`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal obey、circles [[$pc, $a, $b]]
- 「在最強烈的那一刻閉上眼，想著另一個人。」同步 DC 19｜大成功：忠犬認的是你想的那個人（名冊上的一位，或一位夥伴），`flag tuning:忠犬:<你選的人>`；成功：認主失敗，調校裝上但是空的，`flag tuning:忠犬:none`（只有反面，沒有對象）；失敗：照樣認 `$a`；大失敗：認 `$b`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「駭安裝程式，讓它裝得淺。」介面 DC 19｜成功：`flag tuning:忠犬:$a`，但它一週後自己脫落；失敗：執事看見你的手指在動，把你的手也綁起來，安裝照常。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal obey、circles [[$pc, $a, $b]]

**第三段：醒來**。你醒在分館一樓的等候室，制服還穿在身上，有一位家屬在你旁邊哭。櫃台的人說手續都辦好了，你可以回家；如果想卸載，奉公課也有提供。

- 「就這樣回家。」`time 12`、`move 櫻町`、`hostility hizakura −5`。
- 「當場付卸載費。」`cred −[1,300／4,000／12,800]`，調校拆掉；`time 24`。
- 「自己走出去，不簽離館單。」需要 `hk_keycard`。隱匿 DC 13｜成功：`move 櫻町`，`hostility hizakura +3`，`flag hk_unregistered`（奉公課沒有你的安裝紀錄，之後找改造師拆的 DC −3）；失敗：被櫃台叫住，簽完單子才走。
- 「替那位哭的家屬帶話進去。」無檢定：`flag hk_family_message`、`memory`；之後能開 `start_commission`（奉公課分館的救人委託，`commission_gen`：目標勢力緋櫻、類型救援）。

##### masc

**開場**：你在浴室醒來，兩位家政課女僕一人拿著毛巾、一人拿著刮鬍刀，說主人的家臣要乾乾淨淨。執事坐在門邊的椅子上，懷錶放在膝蓋上，看著你。

**第一段**：選項同 default 第一段；場景的 circles 改成 [[$pc, $a, $b]]（兩位女僕），主動權從她們開始。

**第二段**：認主的時候，兩位女僕一前一後，執事在旁邊讀數值。選項同 default 第二段；circles 是 [[$pc, $a, $b]]，執事不進圈子；大失敗時認的是 `$b`。

**第三段**：同 default。

##### yuri

**開場**：你在浴室醒來，女僕跪在浴缸邊，把你的頭髮一綹一綹洗乾淨，說今天由她一個人服侍您，執事被她請出去了。她的白手套放在旁邊，她說碰您的時候不想隔著布。

**第一段**：選項同 default 第一段；場景的 circles 都是 [[$pc, $a]]。

**第二段**：認主的時候安裝室裡只有她。選項同 default 第二段，circles 改成 [[$pc, $a]]；大失敗的結果改成「認主過深」：`flag tuning:忠犬:$a`，另 `affinity $a +5`（她也記住你了）。

**第三段**：同 default。

### 席次的家臣錄（`df_tuning_seat`）

- **kind**：`tuning`
- **factions**：`hizakura`（家政課席次，首領）。
- **在哪**：櫻町的奉公課分館頂樓，或冠冕區緋櫻塔裡她的房間；等級 IV～V。
- **登場**：default：`$a` 席次（女）、`$b` 家政課執事（男）；masc：`$a` 席次、`$b` 家政課女僕；yuri：`$a` 席次。
- **tags**：`pc_unwilling`、`tendency:支配`、`tendency:標記`、`male_partner`（default 的執事）、`female_partner`。`male_partner` 關掉時 default 改成 yuri。
- **fails_commission**：true。
- **fallback**：`df_tuning_seat_plain`：席次在一本名冊上寫下你的名字，忠犬的對象是她；你被送回櫻町。

##### default

**開場**：你跪在一間只點著一盞燈的和室中央，席次坐在你面前，兩把長刀擺在她手邊的刀架上，銀章上的號碼在燈下很亮。她翻開一本線裝的冊子，說能把她逼到拔第二把刀的人，她想收進家臣錄裡。

**第一段：入冊**。她要你自己報上名字；執事在旁邊研墨，等她寫。

- 「報上真名。」無檢定：`flag seat_registered`、`affinity $a +5`；第二段她親自安裝。
- 「報假名。」表演 DC 19｜成功：她寫了，`flag seat_false_name`（之後這個忠犬的反面減半）；失敗：她笑了一下，說她會讓你自己說出來。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「不說。」定力 DC 19｜成功：她闔上冊子，說「好」，第二段的安裝改成淺的（一週後脫落）；失敗：同報假名的失敗。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]

**第二段：落款**。她用毛筆沾了執事研的墨，那是一管會發光的導電墨，她把你的名字和她的號碼寫在你後頸的光紋旁邊，忠犬順著那一筆裝進去。

- 「讓她寫完。」無檢定：`flag tuning:忠犬:$a`、`tendency 標記`（一點）。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal obey、circles [[$pc, $a]]
- 「在她寫到最後一筆時動。」運動 DC 19｜成功：最後一筆歪了，忠犬沒有對象，`flag tuning:忠犬:none`；失敗：她按住你，從頭寫一次。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「求她不要。」誘惑 DC 22｜成功：她停筆，說等你自己想要的那天再來，`flag seat_promise`、`affinity $a +8`，不裝；失敗：她說求的樣子很好看，繼續寫。

##### masc

**開場**：你跪在和室中央，雙手被一位家政課女僕用緞帶反綁在身後，席次用刀鞘的尾端抬起你的下巴。她說體格這麼好的家臣，她手下還沒有。

**第一段**：選項同 default 第一段，`$b` 改成女僕；場景的 circles 改成 [[$pc, $a, $b]]，主動權從席次開始。

**第二段**：同 default 第二段；落款的場景另加 `$b` 在旁邊按著你（circles [[$pc, $a, $b]]）。

##### yuri

**開場**：和室裡只有席次和你，她解下了腰後的刀，跪坐在你的身後，冊子攤在你的膝上。她把下巴擱在你的肩上，說今晚的墨由她自己研。

**第一段**：選項同 default 第一段，`$b` 不登場；場景的 circles 都是 [[$pc, $a]]。

**第二段**：同 default 第二段，circles 都是 [[$pc, $a]]。

### 審查庭的判決（`df_bridge_lock_censor`）

- **kind**：`bridge_lock`
- **factions**：`netvigil`（審查官、探員；戒律隊員贏了時由探員來收）。
- **在哪**：現實或內海都可以；審判在內海大街的審查庭，身體躺在貞網局的車上。等級 III～V。
- **登場**：default：`$a` 審查官（女）、`$b` 探員（男）；masc：同 default；yuri：`$a` 審查官。
- **tags**：`pc_unwilling`、`tendency:禁慾`、`tendency:支配`、`male_partner`（default、masc 的探員）、`female_partner`。`male_partner` 關掉時探員不進圈子。
- **fails_commission**：true。
- **fallback**：`df_bridge_lock_censor_plain`：審查官念完判決，探員替你的橋上了三道鎖，你在車上醒來。
- **共通的結果**（三個版本都一樣，除非選項改掉）：`condition 鎖橋`（技能容量 −50%，7 天）、`flag hostility_floor:netvigil:+10`。

##### default

**開場**：你的化身站在一座黑色的法庭中央，四周的旁聽席坐滿了沒有臉的白蕾絲，審查官坐在高高的檯子上，細框眼鏡反著平板的光。她宣讀你的罪名：未經許可的潛入、未登記的同步、身上帶著不屬於這座城市的程式。

**第一段：審理**。她說貞網局只做一件事：確認你的橋在規範之內。確認的方法是容量測試，探員會把你的橋推到上限，你在測試完成之前不准到頂；到頂一次，就證明你的橋超出規範。

- 「認罪，請求從輕。」無檢定：鎖橋縮成 5 天；`hostility netvigil −3`；第二段直接執行。
- 「抗辯：你的同步有登記。」交涉 DC 19｜大成功：她駁回一半的罪名，鎖橋縮成 3 天，下限只 +5；成功：鎖橋縮成 5 天；失敗：她說抗辯要在測試之後；大失敗：她加一條藐視，鎖橋延成 10 天。
- 「撐過容量測試。」定力 DC 19｜成功：測試通過，`flag netvigil_tested`（之後被貞網局掃橋時「規範內」，DC −2），鎖橋照判；失敗：你到頂了，探員在紀錄上寫「超出規範」，測試重來一次。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]
- 「讓自己快一點到頂，早點結束。」無檢定：`flag netvigil_over_spec`（貞網局之後的掃描對你 +2），鎖橋照判。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]

**第二段：上鎖**。審查官走下檯子，在你的頸後掛上第一道鎖，第二道、第三道由探員來掛；每掛一道，你的橋就安靜一格。

- 「看著她掛。」無檢定：共通的結果。
- 「趁掛鎖的時候偷看鎖的結構。」介面 DC 19｜成功：`flag netvigil_lock_map`（之後改造師或潛網者拆這道鎖的 DC −3，可以提早解除）；失敗：審查官發現了，多掛一道（`condition` 延長 2 天）。
- 「問她第三道鎖鎖的是什麼。」調查 DC 16｜成功：她說是你從牆外帶回來的那一段，`flag netvigil_knows_wall`（貞網局知道你過過粉牆）；失敗：她不回答。

##### masc

**開場**：你的化身被兩道光索吊在法庭中央，腳離地面一點點，審查官從檯子上低頭看你，探員站在你身後。她說體格大的人橋也大，測試要多做一輪。

**第一段**：選項同 default 第一段；兩個場景的 circles 改成 [[$pc, $a, $b]]，主動權從對方開始；「撐過容量測試」要成功兩次才算通過（擲兩次，各 DC 16）。

**第二段**：同 default。

##### yuri

**開場**：法庭的旁聽席是空的，審查官把平板放在檯子上，親自走下來，站在你面前摘下眼鏡。她說這一案她要自己測，因為她不相信探員的紀錄。

**第一段**：選項同 default 第一段；場景的 circles 都改成 [[$pc, $a]]；「撐過容量測試」成功時另加 `affinity $a +3`。

**第二段**：三道鎖都由她來掛。同 default 第二段。

### 地下層的臨檢車（`df_bridge_lock_raid`）

- **kind**：`bridge_lock`
- **factions**：`netvigil`（戒律隊員、探員）。
- **在哪**：地下層、暗礁、四十二番街的地下（貞網局「偶爾下來」的地方）；等級 III～IV。
- **登場**：default：`$a`、`$b` 兩名戒律隊員（男）；masc：同 default；yuri：`$a` 戒律班長（女，生成）。
- **tags**：`pc_unwilling`、`tendency:束縛`、`tendency:禁慾`、`male_partner`（default、masc）、`female_partner`（yuri）。`male_partner` 關掉時改用 yuri 的班長。
- **fails_commission**：true。
- **fallback**：`df_bridge_lock_raid_plain`：你被銬在臨檢車的長椅上，隊員在你的橋上掛了一道臨時鎖，車開回地面時把你放下。
- **共通的結果**：`condition 鎖橋`（技能容量 −50%，7 天）、`flag hostility_floor:netvigil:+10`。

##### default

**開場**：你在一輛沒有窗戶的灰色廂型車裡醒來，車廂兩側是長椅，你被銬在中間的一根鐵桿上，車頂的燈一閃一閃寫著「臨檢中」。兩名戒律隊員坐在對面，面罩遮住下半張臉，一個拿著掃描器，一個拿著鎖橋針。

**第一段：臨檢**。他們說地下層的每一個橋都要掃，掃出違規的就地上鎖；你身上的違規多到掃描器一直叫。

- 「讓他們掃。」無檢定：共通的結果；`flag record_leak:netvigil`。
- 「把掃描器騙過去。」介面 DC 16｜成功：只掃出一半，鎖橋縮成 3 天、沒有下限；失敗：掃描器叫得更大聲，他們決定「仔細檢查」。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「跟他們談地下層的消息，換一個輕的處置。」街頭直覺 DC 16｜成功：他們收了消息（`hostility whisper +5`，你賣的是牆語者），鎖橋縮成 3 天；失敗：消息他們早就知道了。

**第二段：上鎖**。鎖橋針要插進橋埠，隊員說插針的時候人不能亂動，所以要先讓你「安靜下來」。

- 「自己安靜。」定力 DC 16｜成功：共通的結果，沒有別的；失敗：他們用他們的方法。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「趁車子顛的那一下掙開手銬。」運動 DC 19｜成功：你撞開後門跳下車，`hostility netvigil +8`，沒有鎖橋，但 `flag netvigil_escaped`（下次被貞網局抓到時鎖 14 天）；失敗：手銬勒進手腕，`hp −4`，他們把你銬得更緊。

##### masc

**開場**：你在廂型車裡醒來，被面朝下壓在長椅上，雙手銬在背後，一名戒律隊員的膝蓋抵著你的腰。另一名說你剛才打倒了他們兩個人，所以臨檢要做得比較「徹底」。

**第一段**：掃描器貼著你的後頸叫個不停，壓著你的那一個說要「仔細檢查」。選項同 default 第一段；場景的 circles 是 [[$pc, $a, $b]]，主動權從對方開始。

**第二段**：鎖橋針拿出來的時候，他們把你翻過來。選項同 default 第二段，場景同上。

##### yuri

**開場**：你在廂型車裡醒來，對面只坐著一位女性的戒律班長，她把面罩拉到下巴，正在讀你的掃描結果。她敲了兩下隔板讓駕駛開慢一點，說這一份她要自己確認。

**第一段**：她把掃描器的探頭沿著你的脊椎往下移，一邊看讀數一邊問你在地下層做什麼。選項同 default 第一段；場景的 circles 是 [[$pc, $a]]；「談消息」的對象改成她，DC 13。

**第二段**：她親手拿起鎖橋針，說插針之前她會先讓你安靜。選項同 default 第二段；場景的 circles 是 [[$pc, $a]]。

### 療養院的復健病房（`df_lab_sanatorium`）

- **kind**：`lab`
- **factions**：`nectar`（療養院警衛、流形保全、主治醫師、研究主任；看護蕾絲在蜜腺的子網扣線之後，身體也送來這裡）。
- **在哪**：玻璃岸的蜜腺療養院；等級 II～V。
- **登場**：default：`$a` 主治醫師（扶他）、`$b` 療養院警衛（偽娘）；masc：`$a` 主治醫師、`$b` 採樣員（扶他）；yuri：`$a` 主治醫師、`$b` 夜班的護理師（女，生成）。
- **tags**：`pc_unwilling`、`tendency:藥`、`tendency:支配`、`male_partner`（default 的偽娘警衛）、`female_partner`。※扶他與偽娘在性別的細項裡怎麼算，現在沒有規定；這裡暫定扶他算 `female_partner`、偽娘算 `male_partner`。`male_partner` 關掉時 default 的 `$b` 換成 yuri 的護理師。
- **fails_commission**：true。
- **fallback**：`df_lab_sanatorium_plain`：你在病房裡睡了兩天，醒來時病歷已經入庫，一項橋參數被調過；出院時可以偷回病歷或直接走。
- **共通的結果**：`flag record_leak:nectar`；第一段結束時一項橋參數 ±5（看選項）。

##### default

**開場**：你在一間有落地窗的單人病房醒來，窗外是玻璃岸的海，手背上接著一條琥珀色的點滴。主治醫師坐在床邊翻你的病歷，筆挺的白袍底下看得出輪廓，偽娘警衛站在門口，針槍收在腰上。

**第一段：復健**。醫師說你在送來的路上過載了三次，橋需要「復健」：她會用藥把你的某一項參數推到量得出來的位置，然後照她的需要調。她讓你看點滴瓶上的標籤，上面寫著四個參數的名字，只有一個被打了勾。

- 「讓她照她的勾調。」無檢定：`bridge 敏感度 +5`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「偷看病歷，換一個勾。」醫療 DC 16，或義體學 DC 16｜大成功：你選要調哪一項、往哪個方向（±5）；成功：你選哪一項，方向照她的（+5）；失敗：她發現了，說好奇的病人要多觀察一晚，兩項都調；大失敗：同失敗，另 `item` 生體件「蜜腺的試驗腺體」裝在身上（[CYBERWARE](../gear/CYBERWARE.md) 的生體件，拆要改造師）。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「拔掉點滴。」定力 DC 16｜成功：藥沒進去，參數不動，`hostility nectar +3`；失敗：警衛按住你，換成肌肉針，`bridge 慾求 +5`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「問她要這些數據做什麼。」調查 DC 19｜成功：`flag nectar_suppressant_hint`（抑制劑的事的一條線索，接母帶那條線）；失敗：她說是為了治好你，照樣調。

**第二段：出院**。第三天早上，櫃台把一張出院單和一份帳單放在你面前，說費用由「臨床試驗」支付，你只要簽同意書。同意書的最後一頁寫著，你的病歷將用於研究。

- 「簽。」`flag nectar_trial_signed`（之後蜜腺的好感 +5，委託裡會被「回診」的事件找上）、`favor nectar +5`、`move 玻璃岸`。
- 「不簽，自己付錢。」`bill +[400／1,300／4,000]`、`move 玻璃岸`。
- 「從護理站偷回你的病歷。」隱匿 DC 16 或介面 DC 16｜成功：病歷沒入庫（取消 `record_leak`），`hostility nectar +3`；失敗：被警衛抓到，帶回病房多住一晚。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]
- 「帶走隔壁病房的人。」需要第一段的 `nectar_suppressant_hint` 或認識那個人。運動 DC 16｜成功：`roster_add`（一位逃出的實驗體）、`hostility nectar +8`；失敗：你自己出得去，那個人被留下，`memory`。

##### masc

**開場**：你醒在病房裡，四肢被柔軟的束帶固定在床欄上，醫師和一位採樣員一左一右站著，採樣員的手腕內側正噴出一點甜甜的粉紅色霧。醫師說體格大的病人藥量要加倍，所以今天兩個人一起看診。

**第一段**：選項同 default 第一段；場景的 circles 都是 [[$pc, $a, $b]]，主動權從對方開始；「拔掉點滴」的失敗改成採樣員的霧，`load +10`。

**第二段**：同 default 第二段；「偷回病歷」失敗時抓到你的是採樣員（circles [[$pc, $b]]）。

##### yuri

**開場**：你在病房醒來，夜班的護理師正在替你換點滴，主治醫師坐在窗邊的椅子上看著，雙腿交疊。醫師說今天的復健交給護理師做，她只負責看數字。

**第一段**：選項同 default 第一段；護理師動手，醫師在旁邊看數字、下指示，不進圈子（circles [[$pc, $b]]）；失敗的兩個場景醫師也下來（circles [[$pc, $a, $b]]）。

**第二段**：同 default 第二段；「偷回病歷」失敗時抓到你的是護理師。

### 試驗田的帳篷實驗室（`df_lab_field`）

- **kind**：`lab`
- **factions**：`nectar`（採樣員、流形保全、研究主任）。
- **在哪**：鏽帶的蜜腺試驗田；等級 III～V。醒在田邊的帳篷實驗室。
- **登場**：default：`$a` 採樣員（扶他）、`$b` 流形保全（偽娘）；masc：同 default；yuri：`$a` 研究主任（扶他，首領）。
- **tags**：`pc_unwilling`、`tendency:變形`、`tendency:觸手`（流形保全的生體鞭）、`tendency:藥`、`male_partner`（偽娘）、`female_partner`（扶他，暫定）。`male_partner` 關掉時 `$b` 不進圈子；`tendency:觸手` 關掉時流形保全不用生體鞭。
- **fails_commission**：true。
- **fallback**：`df_lab_field_plain`：她們抽了你的樣本、測了你的橋，把你放在田邊的公路上；身上可能多了一件生體件。
- **共通的結果**：`flag record_leak:nectar`。

##### default

**開場**：你在一頂半透明的帳篷裡醒來，四周的作物長得比人還高，葉子的背面在發光。採樣員蹲在你旁邊，把一支採樣管收進白袍的口袋裡，流形保全靠在帳篷的支柱上，肩膀一寬一窄地呼吸。

**第一段：採樣**。採樣員說田裡的作物要「人的反應」當肥料的配方，她要採你在各種刺激下的橋的數據。她手腕內側的噴腺先噴了一下，帳篷裡都是甜味。

- 「讓她採。」無檢定：`bridge 慾求 +5`、`load +10`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「憋氣，不吸她的霧。」運動 DC 16｜成功：霧沒吸進去，她改用針，`bridge 慾求 +2`；失敗：吸了滿口，流形保全也被叫過來幫忙按住你。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「告訴她你知道這片田在種什麼。」調查 DC 16（踩點時看過田）或街頭直覺 DC 19｜成功：她停手，說主任會想跟你談，第二段改成只裝不測；失敗：她說那就更要採。

**第二段：適應測試**。採樣員拿出一個在培養液裡蠕動的生體件，說它會照宿主的形狀長，她想看它在你身上長成什麼樣子。

- 「讓她裝。」無檢定：`item` 生體件「流形腺」（每場戰鬥一次，換形：甲殼護甲 +2 或伸展迴避 +1；每週沉溺 +1；拆要改造師）。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「讓身體排斥它。」醫療 DC 16｜成功：生體件在你身上枯掉，`hp −3`，沒有裝上；失敗：它長進去了，同「讓她裝」。
- 「趁她們看著生體件的時候跑進田裡。」隱匿 DC 16｜成功：`move 鏽帶`、`hostility nectar +3`，帳篷裡的數據沒有存完（取消 `record_leak`）；失敗：作物的葉子把你絆倒，流形保全的生體鞭把你拖回來。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]

##### masc

**開場**：你在帳篷裡醒來，被吊在支柱之間的吊床網裡，採樣員和流形保全一人一邊，看著你身上的監測貼片一閃一閃。採樣員說這麼大的樣本很少見，她要多採幾管。

**第一段**：採樣員先對著吊床噴一次霧（`load +6`），流形保全負責把你的手腳拉開。選項同 default 第一段；所有場景改成 circles [[$pc, $a, $b]]，主動權從對方開始。

**第二段**：裝生體件的時候，流形保全的生體鞭纏住你的手臂，採樣員把它放在你的胸口。選項同 default 第二段；所有場景改成 circles [[$pc, $a, $b]]。

##### yuri

**開場**：研究主任親自坐在帳篷裡的折疊椅上，白袍的下襬拖在泥地上，脖子上一圈腺體一開一合，霧化器的金屬花朝著你。她說試驗田出現一個能打到她面前的人，這份數據她不想讓下面的人碰。

**第一段**：她的霧比採樣員的濃，她一邊噴一邊問你的名字。選項同 default 第一段；場景的 circles 都是 [[$pc, $a]]；「告訴她你知道」成功時，她改成跟你談一筆交易：`start_commission`（`commission_gen`：委託人蜜腺研究主任，目標夜鶯或伊甸園，類型竊取）。

**第二段**：她親手把生體件放在你的身上，看它慢慢長。選項同 default 第二段；場景的 circles 都是 [[$pc, $a]]。

### 白金隊長的順便（`df_triage_platinum`）

- **kind**：`triage`
- **factions**：`angel`（急救隊員、黃金班長、白金隊長；救護浮空車與小天使贏了由急救隊員來收）。
- **在哪**：任何區；天使急救來搶會員時，你擋了路。等級 II～IV。醒在冠冕區總站的恢復室。
- **登場**：default：`$a` 黃金班長（女）、`$b` 總站的值班醫師（男，生成）；masc：`$a` 黃金班長、`$b` 急救隊員（女）；yuri：`$a` 白金隊長（女）。
- **tags**：`pc_unwilling`、`tendency:恩與債`、`tendency:溺愛`、`tendency:窺視`、`male_partner`（default 的醫師）、`female_partner`。`male_partner` 關掉時 default 的醫師只開單、不進圈子。
- **fails_commission**：true。
- **fallback**：`df_triage_platinum_plain`：你被「順便」收進總站，醒來時帳單已經開好，病歷被賣給了出價的人；付錢、分期或逃單。
- **共通的結果**：`bill +[500／1,600／5,000]`（手術費），`flag record_leak:angel`（天使急救會把病歷賣給蜜腺）。

##### default

**開場**：你在一間全白的恢復室醒來，身上的傷被處理得很乾淨，床尾掛著一張還在列印的帳單，你看到最後一個數字時心跳監測器叫了一聲。黃金班長靠在門邊，金色的翅膀章在燈下發亮，她說你擋了她們的路，所以她們「順便」把你也救了。

**第一段：帳單**。班長說會員的服務是包月的，你不是會員，所以每一項都要算；她把帳單一行一行念給你聽，念到「橋的穩定處置」那一行時停下來，說這一項其實可以不收。

- 「照付。」共通的結果；`time 6`、`move 冠冕區`。
- 「分期。」無檢定：帳單改成四週，每週 `bill +[150／500／1,600]`，另加利息 20%；`grace 7`。
- 「問她那一項要怎麼才不收。」誘惑 DC 13｜成功：她說今晚的觀察由她親自做，那一項就免了，`bill` 減三成；失敗：她說你想太多，照收。
  - `adult_scene`：when success、gate ai、nature trade、role none、goal please、circles [[$pc, $a]]
- 「說你要投訴她們綁架。」交涉 DC 19｜成功：帳單減半，`hostility angel +2`；失敗：她把投訴表給你，表上的手續費是 200。

**第二段：觀察夜**。半夜，值班醫師帶著一台記錄儀進來，說他要做「橋的穩定測試」：記錄你在刺激下的反應，數據會附在病歷裡。

- 「讓他測。」無檢定：`bridge 耐受 +2`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]
- 「說你拒絕這項醫療行為。」交涉 DC 16｜成功：他在單子上記「病人拒絕」，帳單少一行，病歷外流的部分少一半；失敗：他說你簽過了，指著你昏迷時按的指紋。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $b]]
- 「逃單。」隱匿 DC 16｜成功：你從貨梯走了，`hostility angel +5`，帳單不付（之後天使急救的追討事件）；失敗：小天使無人機在走廊上把你攔下來，醫師與班長一起送你回床上。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]

##### masc

**開場**：你醒在恢復室，手腕上扣著醫療用的固定帶，黃金班長和一位急救隊員站在床邊，隊員的護目鏡推在護士帽上方，手上拿著記錄儀。班長說體型大的人麻醉退得快，所以要趁現在把測試做完。

**第一段**：同 default 第一段；「問她那一項」的場景改成 circles [[$pc, $a, $b]]。

**第二段**：做測試的是急救隊員，班長在旁邊看數字。選項同 default 第二段；場景的 circles 都改成 [[$pc, $a, $b]]，主動權從對方開始。

##### yuri

**開場**：你醒在一間比恢復室大很多的病房，白金隊長坐在你的床邊，貼身的白金色裝甲還沒脫，翅膀形狀的肩甲擦著床頭。她說那個會員是她的，你差一點讓她失去他，所以這筆帳她要親自收。

**第一段**：她把帳單折起來塞進你的病人服口袋。選項同 default 第一段；對象都是她，誘惑的 DC 16；成功時帳單減半，`affinity $a +3`。

**第二段**：半夜做測試的是她自己，她把左手腕的除顫電極調到最低一格。選項同 default 第二段；場景的 circles 都是 [[$pc, $a]]。

### 會員病房的照顧（`df_triage_members`）

- **kind**：`triage`
- **factions**：全部（主角的天使急救會員資格有效時，任何勢力打贏都先走這一筆，[ENEMIES](../systems/ENEMIES.md) 第 6 節）。
- **在哪**：搶救出來之後，醒在最近的天使急救診所；白金會員醒在冠冕區總站的會員樓層。
- **登場**：default：`$a` 照顧你的急救隊員（女）；masc：同 default；yuri：同 default。三個版本的差別只在開場與主動權。
- **tags**：`tendency:溺愛`、`female_partner`。這一筆不是非自願的：成人的分支全部是你自己選的，`gate: ai`。
- **fails_commission**：true（被搶救出來，委託照樣失敗）。
- **fallback**：`df_triage_members_plain`：你在診所醒來，隊員替你換了藥、念了帳單，你回家。
- **共通的結果**：帳單照付（會員的等級決定多少）：白銀 `bill +[300／1,000／3,200]`、黃金 `bill +[150／500／1,600]`、白金免；原本那個勢力的戰敗事件不觸發，但它的敵對值照戰鬥算。

##### default

**開場**：你在診所的病床上醒來，窗簾拉著，床頭櫃上放著一杯溫水和一張會員卡大小的帳單。替你換藥的急救隊員說你很幸運，她們比那些人早到了四十秒。

**第一段：換藥**。她換完藥沒有走，坐在床邊替你削一顆合成蘋果，說會員的方案裡包含「放鬆療程」，你要不要。

- 「好。」無檢定：`load` 歸零、`afterglow −1`。
  - `adult_scene`：when always、gate ai、nature trade、role guest、goal none、circles [[$pc, $a]]
- 「只要她陪你坐一會兒。」無檢定：`load −10`、`affinity $a +2`。
- 「問她剛才搶你出來時看到了什麼。」調查 DC 13｜成功：`flag angel_saw`（你知道是誰打倒你、他們接下來要去哪），之後同一個委託重來時 `link`（第一個階段的遭遇少一個敵人）；失敗：她說她只看到你。

**第二段：出院**。她送你到門口，問你要不要升級會員。

- 「升級。」`cred −` 新等級和舊等級週費的差額、`flag angel_upgrade`。
- 「不了。」`move` 你的據點。
- 「留下她的聯絡方式。」交涉 DC 13｜成功：`roster_add $a`；失敗：她說規定不行，但把名字告訴你了（`memory`）。

##### masc

**開場**：你醒在診所的病床上，急救隊員正在拆你肩上的繃帶，她說你這種塊頭她們抬得很辛苦，下次請少吃一點。

**第一段**：選項同 default 第一段；「好」的場景改成主動權從她開始（她說療程由她決定節奏）。

**第二段**：同 default。

##### yuri

**開場**：你醒在診所的病床上，急救隊員已經脫了外層的護理服，只穿著裡面的貼身制服坐在床邊，正在讀你的生理數據。她說數據顯示你需要被照顧，而她今天剛好下班。

**第一段**：選項同 default 第一段；「好」的場景主動權從她開始，`goal` 改成 none、`role` 改成 guest。

**第二段**：同 default。

### 白色房間的契約（`df_contract_eden`）

- **kind**：`contract`
- **factions**：`eden`（契約保全、看門人、回收員；被 `df_pinned_eden` 收進來的人也走這裡）。這是 [DATA](../systems/DATA.md) 第 5 節的範例的完整版。
- **在哪**：四十二番街或冠冕區的伊甸園設施；等級 I～IV。
- **登場**：default：`$a` 回收員（男）；masc：`$a`、`$b` 兩位女性回收員；yuri：`$a` 樓面經理（女）。
- **tags**：`pc_unwilling`、`contract_dom`、`tendency:束縛`、`tendency:奪與被奪`、`tendency:恩與債`、`male_partner`（default）、`female_partner`（masc、yuri）。`male_partner` 關掉時 default 改用 yuri 的樓面經理。`contract_dom` 關掉時契約只剩經濟與法律的效果（[LEWD_SYSTEM](../systems/LEWD_SYSTEM.md) 7.8 節），第二段的「試用」不出現。
- **fails_commission**：true。
- **fallback**：`df_contract_eden_plain`：你被要求簽一份抵債契約；拒絕就交出一筆錢或一份人情，簽了就是一份只有工作與回報的契約。

##### default

**開場**：你在一間白色的房間裡醒來，手腕上多了一圈伊甸園的識別環，桌上放著一份已經填好你名字的契約。回收員坐在對面，風衣的下擺沾著別人的口紅，他把筆推到你面前，說簽了字今晚就能走。

**第一段：簽字**。契約寫著你造成的損失、伊甸園替你墊付的醫療費、以及抵債的方式：管理級的橋權，十二週。

- 「簽字。」`order contract_signed_eden`、`flag bound_eden`（管理級，持約人：伊甸園的契約部門，十二週）、`hostility eden −10`。
- 「拖延時間，等隊友來。」定力 DC 16｜成功：`flag rescue_window`，第二段多「被贖」；失敗：他說等的時間不能白等，先讓你試用一下橋權的感覺。
  - `adult_scene`：when fail、gate fixed、nature forced、role bound、goal obey、circles [[$pc, $a]]
- 「打電話叫人來贖。」需要名冊上有人或人情：`cred −[1,000／3,200／10,000]`、`owed $caller medium`；結束。
- 「找條款的漏洞。」調查 DC 19（有 `eden_loophole` 時自動成功）｜成功：期限縮成四週、橋權降成限制級，`contract_dom` 的指令不出現；失敗：他說律師費也算進去，期限加兩週。

**第二段：試用**。不簽也不付的人，伊甸園會先「示範」管理級的橋權是什麼：回收員拿出一台平板，在上面按了一下，你的手自己伸向你的領口。

- 「抵抗橋的指令。」定力 DC 19｜成功：你的手停住了，回收員記下「抗性高」，`flag eden_resistant`（之後伊甸園的報價 +30%）；失敗：示範繼續。
  - `adult_scene`：when fail、gate fixed、nature contract、role bound、goal obey、circles [[$pc, $a]]
- 「示範完就簽。」無檢定：同第一段的簽字，另 `satisfaction eden +5`。
  - `adult_scene`：when always、gate fixed、nature contract、role bound、goal obey、circles [[$pc, $a]]
- 「被贖。」需要 `rescue_window`：`owed $caller medium`、`cred −[600／2,000／6,400]`、`hostility eden +3`。

##### masc

**開場**：你在白色的房間裡醒來，手腕上多了一圈識別環，兩位女性回收員站在床邊低頭看著你，其中一位用電擊鞭的握把敲了敲桌上的契約。她們說像你這樣的人在伊甸園很搶手，今晚就有三個買家在等。

**第一段**：選項同 default 第一段；「拖延」的場景改成 circles [[$pc, $a, $b]]、start_position `pos_pinned_under`。

**第二段**：兩位回收員各拿一台平板，一人一條指令。選項同 default 第二段；場景都是 circles [[$pc, $a, $b]]。

##### yuri

**開場**：你在白色的房間裡醒來，樓面經理坐在床邊，酒紅色套裝的裙擺壓在你的手上，手杖靠在她的膝邊，房間裡有成熟水果的味道。她說回收員太粗魯了，你的契約由她親自談。

**第一段**：她把契約的條款一條一條念給你聽，念一條就在你的手背上蓋一下她的印章戒指。選項同 default 第一段；「拖延」的場景改成 circles [[$pc, $a]]；「叫人來贖」的價錢 +20%（她開的價）。

**第二段**：示範橋權的時候她不用平板，她對著你的耳朵說指令。選項同 default 第二段；場景都是 circles [[$pc, $a]]。

### 琉璃宮的帳房（`df_contract_glasspalace`）

- **kind**：`contract`
- **factions**：`eden`（樓面經理、契約保全、看門人）。
- **在哪**：四十二番街的琉璃宮；等級 II～IV。
- **登場**：default：`$a` 樓面經理（女）、`$b` 看門人（男）；masc：`$a` 樓面經理、`$b` 一位女性熟客（生成）；yuri：`$a` 樓面經理。
- **tags**：`contract_dom`、`pc_unwilling`（只在第二段的「不從」分支）、`tendency:恩與債`、`tendency:支配`、`male_partner`（default 的看門人）、`female_partner`。`male_partner` 關掉時 default 的看門人只守門。
- **fails_commission**：true。
- **fallback**：`df_contract_glasspalace_plain`：你被算了一筆損失，可以付錢、簽一份兩週的限制級工作契約（端盤子、看場子），或叫人來贖。

##### default

**開場**：你在琉璃宮頂樓的帳房醒來，四面牆都是發光的帳本，樓面經理坐在一張紅木桌後面打算盤，算盤珠是一顆一顆的契約晶片。她說你打壞了三盞水晶燈、兩個保全和一位客人的興致，這些都要算。

**第一段：算帳**。她給你兩種契約：一種是管理級，十二週，伊甸園挑你的工作；一種是限制級，兩週，你在琉璃宮上班抵債。

- 「簽限制級，上班抵債。」無檢定：`order contract_signed_eden_work`（限制級，兩週）、`flag glasspalace_shift`；之後兩週每週有一件琉璃宮的上班事件（打工範圍）。
- 「簽管理級。」無檢定：`order contract_signed_eden`、`flag bound_eden`、`hostility eden −10`、`cred +[200／650／2,000]`（簽約金）。
- 「跟她殺價。」交涉 DC 16｜大成功：她笑著把帳打對折，付錢就走（`cred −[300／1,000／3,200]`）；成功：限制級縮成一週；失敗：她把殺價的時間也算進去；大失敗：她說你需要先上一堂課，進第二段。
- 「今晚就上第一班。」誘惑 DC 13｜成功：今晚的客人很滿意，帳打七折，`fame 四十二番街 +3`；失敗：客人不滿意，帳不打折。
  - `adult_scene`：when always、gate ai、nature work、role worker、goal please、circles [[$pc, $a]]

**第二段：上一堂課**。樓面經理說不聽話的人簽了也做不好，所以要先教；看門人關上帳房的門，站到你身後。

- 「聽課。」無檢定：之後簽限制級，`satisfaction eden +5`。
  - `adult_scene`：when always、gate fixed、nature contract、role bound、goal obey、circles [[$pc, $a, $b]]
- 「不從。」定力 DC 16｜成功：她放棄教你，帳加兩成，付錢或叫人贖；失敗：課照上。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「叫人來贖。」需要名冊上有人或人情：`owed $caller small`、`cred −[400／1,300／4,000]`。

##### masc

**開場**：你在帳房醒來，樓面經理坐在紅木桌上，雙腿交疊，她身邊坐著一位戴面紗的女性熟客，熟客的手指正在桌上點著你的照片。經理說這位客人願意替你付一半的帳，條件是今晚。

**第一段**：選項同 default 第一段；「今晚就上第一班」的對象改成熟客（circles [[$pc, $b]]），成功時帳打對折。

**第二段**：教課的是經理與熟客。選項同 default 第二段；場景改成 circles [[$pc, $a, $b]]，主動權從她們開始。

##### yuri

**開場**：帳房裡只有樓面經理和你，她把算盤推到一邊，用手杖的尖端勾住你的衣領，說帳可以慢慢算，她今晚不趕時間。

**第一段**：選項同 default 第一段；「今晚就上第一班」的對象改成她，成功時 `affinity $a +3`。

**第二段**：她自己上課，手杖放在桌上，印章戒指的蘋果在你的皮膚上留下一個印子。選項同 default 第二段；場景的 circles 都是 [[$pc, $a]]。

### 樂園的所有權（`df_contract_white`）

- **kind**：`contract`
- **factions**：`eden`（樂園的白衣，首領；她的招牌「所有權」讓被她制伏的人直接進這一筆，不必等全隊倒下）。
- **在哪**：冠冕區的樂園；等級 III～IV。
- **登場**：default：`$a` 樂園的白衣（女）、`$b` 看門人（男）；masc：`$a` 白衣、`$b` 跟在她身後的契約人（女）；yuri：`$a` 白衣。
- **tags**：`pc_unwilling`、`contract_dom`、`tendency:支配`、`tendency:標記`、`male_partner`（default 的看門人）、`female_partner`。`male_partner` 關掉時 default 改成 yuri。
- **fails_commission**：true。
- **fallback**：`df_contract_white_plain`：白衣用金色的筆在一份契約上簽了她的名字，你被登記成她的財產；可以抵抗登記、叫人來贖，或之後照契約的規矩脫身。

##### default

**開場**：你跪在樂園一座白色涼亭的中央，四周是修剪得很整齊的玫瑰，白衣站在你面前，過肘的白手套上沾著一點你的汗。她身後的契約人捧著一份契約，她用那支金色的筆在空中寫了一個字，你後頸的光紋跟著亮了一下。

**第一段：登記**。她說她不買契約，她只登記她的東西；你剛才倒在她手裡，按樂園的規矩，已經是她的了。登記只差最後一步：在你的身上簽名。

- 「讓她簽。」無檢定：`order contract_signed_eden_white`（管理級，持約人：白衣本人，二十週）、`flag bound_eden_white`、`tendency 標記`（一點）。
  - `adult_scene`：when always、gate fixed、nature contract、role bound、goal obey、circles [[$pc, $a]]
- 「抵抗她的筆。」定力 DC 22｜成功：光紋沒亮，她說「有趣」，契約改成限制級、八週；失敗：她讓看門人按住你，簽名寫得更深。
  - `adult_scene`：when fail、gate fixed、nature forced、role bound、goal obey、circles [[$pc, $a, $b]]
- 「告訴她你值得一個更好的價錢。」交涉 DC 19｜成功：她喜歡你的膽子，契約加一條「每週一天自由」，`satisfaction eden_white +5`；失敗：她說東西不能替自己定價。

**第二段：展示**。簽完以後，白衣帶你在樂園裡走一圈，讓其他的持約人看看她新的東西。

- 「跟著她走。」無檢定：`fame 冠冕區 +5`、`satisfaction eden_white +5`。
- 「在大家面前讓她難堪。」表演 DC 19｜成功：她的臉色第一次變了，`satisfaction eden_white −5`、`flag white_embarrassed`（之後脫身的交涉 +2）；失敗：她說展示要重來，這次換一個姿勢。
  - `adult_scene`：when fail、gate fixed、nature contract、role bound、goal obey、circles [[$pc, $a]]
- 「趁展示的時候記下樂園的路。」調查 DC 16｜成功：`flag paradise_map`（之後樂園的委託，踩點直接開一條路）；失敗：沒記住。

##### masc

**開場**：你被跪在涼亭中央，雙手被白衣的磁鎖手銬鎖在背後，她的契約人站在你身邊，手上捧著契約，眼睛看著地上。白衣說這麼大的東西她想親手登記，契約人負責扶著你。

**第一段**：選項同 default 第一段；場景的 circles 改成 [[$pc, $a, $b]]，`$b` 是契約人；「抵抗」的失敗改成契約人按住你。

**第二段**：同 default 第二段。

##### yuri

**開場**：涼亭裡只有白衣和你，她跪下來和你平視，摘下右手的手套，用指尖在你的光紋上描她名字的筆畫。她說筆是給別人看的，她自己簽名的時候不用筆。

**第一段**：選項同 default 第一段；場景的 circles 都是 [[$pc, $a]]。

**第二段**：同 default 第二段。

### 契約農場的工期（`df_farm_fields`）

- **kind**：`farm`
- **factions**：`blackspring`（見習騎士、禮拜衛隊、獵犬操作員、隨軍修女；機械獵犬贏了由獵犬操作員來收）。
- **在哪**：鏽帶，廠前鎮旁邊的契約農場；等級 II～IV。
- **登場**：default：`$a` 隨軍修女（女）、`$b` 農場的工頭（男，契約人，生成）；masc：`$a` 隨軍修女、`$b` 禮拜衛隊（女）；yuri：`$a` 隨軍修女。黑泉的人沒有橋，所以這一筆的成人場景裡她們不吃感載（[LEWD_SYSTEM](../systems/LEWD_SYSTEM.md) 1 節的「沒有橋的人」）。
- **tags**：`pc_unwilling`、`tendency:禁慾`、`tendency:痛`、`tendency:束縛`、`male_partner`（default 的工頭）、`female_partner`。`male_partner` 關掉時 default 的工頭換成第二位修女。
- **fails_commission**：true；逃出農場時仍然算失敗，但第三段的調查結果帶得出去（`memory` 與 `flag`）。
- **fallback**：`df_farm_fields_plain`：你被換上工作服在田裡做了三天工，工錢抵成罰金；可以逃，也可以趁機查。

##### default

**開場**：你在一間木板搭的懺悔室裡醒來，身上的衣服被換成了粗麻的工作服，後頸的橋埠貼著一塊黑泉的封條。隨軍修女坐在格窗的另一邊，經書攤在膝上，她說黑泉不罰人，黑泉讓人懺悔，懺悔完就去田裡工作。

**第一段：懺悔**。修女說有橋的人帶著罪，罪要先說出來，再由身體承受；工頭站在門外，手上拿著一捆繩子。

- 「懺悔。」無檢定：工期三天；`favor blackspring +2`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「說你沒有罪。」定力 DC 16｜成功：修女闔上經書，說三天之後再問你，工期照常；失敗：她說否認也是一種罪，讓工頭進來。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「跟她談經書。」交涉 DC 16（她相信經書）｜成功：她把工期縮成兩天，`affinity $a +3`；失敗：她說你背得不熟。

**第二段：工期**。白天在一望無際的燃料作物田裡收割，晚上睡在工人宿舍；其他的工人都是契約人，後頸的光紋在夜裡一排一排亮著。

- 「做工。」運動 DC 13｜成功：工期照算，`time 72`、`cred +[60／200／650]`（扣掉罰金剩下的工錢）；失敗：工頭說你偷懶，工期加一天。
- 「晚上逃。」隱匿 DC 16｜大成功：你逃出去，還帶走一位工人（`roster_add`）；成功：`time 24`、`move 鏽帶`、`hostility blackspring +5`；失敗：獵犬在圍籬邊找到你，送你回懺悔室重來第一段；大失敗：同失敗，工期加兩天。
- 「趁機查。」調查 DC 16｜成功：`flag farm_ledger`（你看到這座農場的契約登記，契約人的來源和伊甸園有關），之後能開 `start_commission`（`commission_gen`：目標黑泉，類型救援或爆料）；失敗：工頭發現你在翻東西，帶你去見修女。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「讓工頭替你減工期。」誘惑 DC 13（他也是契約人，他想要的是感覺）｜成功：工期減一天，`owed $b small`（他欠你，之後是內應）；失敗：他收了，工期不減。
  - `adult_scene`：when always、gate ai、nature trade、role none、goal please、circles [[$pc, $b]]

##### masc

**開場**：你在懺悔室醒來，雙手被繩子綁在頭頂的橫木上，禮拜衛隊的塔盾靠在牆邊，她穿著修女服樣式的長罩袍站在你面前。修女在格窗後面說，罪重的人懺悔要兩個人聽。

**第一段**：修女與衛隊一起聽你懺悔。選項同 default 第一段；場景的 circles 改成 [[$pc, $a, $b]]，主動權從對方開始。

**第二段**：田裡的工頭換成衛隊親自看守你。選項同 default 第二段；「讓工頭替你減工期」改成「讓衛隊替你減工期」，誘惑 DC 19（她是禁慾的），成功時 `affinity $b +3`。

##### yuri

**開場**：你在懺悔室醒來，格窗是打開的，修女跪在你身邊，頭紗垂到你的臉上，經書擱在一旁。她說這一次她不隔著窗聽，因為你的罪她想親手確認。

**第一段**：選項同 default 第一段；場景的 circles 都是 [[$pc, $a]]。

**第二段**：選項同 default 第二段；「讓工頭替你減工期」改成「晚上去修女的房間」，誘惑 DC 16，成功時工期減一天、`affinity $a +5`（circles [[$pc, $a]]，`gate: ai`、`nature: trade`）。

### 外海平台的夜班（`df_farm_platform`）

- **kind**：`farm`
- **factions**：`blackspring`（騎士長、莊園管事、禮拜衛隊）。
- **在哪**：玻璃岸外海的黑泉平台；等級 III～IV。
- **登場**：default：`$a` 莊園管事（男）；masc：`$a` 莊園管事（女）、`$b` 騎士長（女）；yuri：`$a` 莊園管事（女）。管事是那個「藏著的橋」的人（[ENEMY_ROSTER](ENEMY_ROSTER.md) 黑泉的莊園管事）。
- **tags**：`pc_unwilling`、`tendency:禁慾`、`tendency:窺視`、`tendency:痛`（masc 的騎士長）、`male_partner`（default）、`female_partner`（masc、yuri）。`male_partner` 關掉時 default 改用 yuri 的管事。
- **fails_commission**：true。
- **fallback**：`df_farm_platform_plain`：你在平台上刷了五天的油槽；管事每晚來巡，你發現他的後頸有一道不該有的疤。

##### default

**開場**：你在外海平台的工人艙裡醒來，海浪拍著艙壁，床頭貼著一張值班表，你的名字排在五個夜班上。莊園管事站在門口，西裝外面套著防水的風衣，他說平台缺人刷油槽，你剛好來了。

**第一段：夜班**。夜班是刷油槽，又冷又長；管事每晚巡一次，巡到你的時候都停得比較久。

- 「刷。」運動 DC 13｜成功：`time 120`、`cred +[80／260／800]`；失敗：`time 144`、`hp −3`（滑倒）。
- 「找機會發信號給岸上。」介面 DC 19（平台的訊號是黑泉自己的白網）或機械 DC 16（改一台對講機）｜成功：`owed $caller small`，第二段多「被接走」；失敗：管事收走你的對講機，說今晚到他的辦公室來。
- 「注意管事的後頸。」調查 DC 16｜成功：`flag bs_hidden_bridge`（你看出他裝了橋，黑泉不准）；失敗：沒看出什麼。

**第二段：辦公室**。管事關上辦公室的門，把百葉窗拉下來，說平台上的人都沒有橋，只有你有；他想知道那是什麼感覺，而他自己的橋，平台上沒有人能給他。

- 「照他要的做。」無檢定：工期縮成三天，`flag bs_hidden_bridge`（你確定了）。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「拿他的橋威脅他。」需要 `bs_hidden_bridge`。威嚇 DC 16｜成功：他放你走，還簽了一張「工期完成」的單子，`owed $a medium`（他欠你；黑泉的線頭）；失敗：他說沒有人會相信一個契約工，照樣把你留下。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「讓他自己說出來，錄下來。」誘惑 DC 16｜成功：`footage`（一段管事承認裝了橋的錄音，可以剪成爆料的片）、`hostility blackspring +5`；失敗：他發現你在錄，把錄音刪掉。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal footage、circles [[$pc, $a]]
- 「被接走。」需要第一段發出了信號：`move 玻璃岸`、`hostility blackspring +3`。

##### masc

**開場**：你在工人艙醒來，騎士長站在門口，黑金色的動力裝甲還穿在身上，頭盔夾在左手臂下面；管事從她身後走進來，是一位穿著防水風衣的女人。管事說平台上的女孩子都沒碰過有橋的男人，騎士長說她負責看著你不准偷懶。

**第一段**：騎士長親自看你刷油槽。選項同 default 第一段；「刷」失敗時的 `hp −3` 改成騎士長的「懲戒」（`hp −2`、`load +6`）。

**第二段**：辦公室裡是管事和騎士長，騎士長站在門邊，說她不碰你，她只看。選項同 default 第二段；場景的 circles 是 [[$pc, $a]]，`$b` 在旁邊看（`tendency:窺視`）；「拿她的橋威脅她」成功時另加 `flag bs_captain_witness`（騎士長也知道了）。

##### yuri

**開場**：你在工人艙醒來，管事是一位很高的女人，風衣底下是一件扣到喉嚨的黑色長裙，她把值班表從牆上撕下來折好，放進口袋。她說你不用排夜班，你只要每晚來她的辦公室。

**第一段**：選項同 default 第一段；「刷」改成「在辦公室替她整理文件」，調查 DC 13，成功時直接拿到 `bs_hidden_bridge`。

**第二段**：選項同 default 第二段；場景的 circles 都是 [[$pc, $a]]。

### 前進基地的禁閉室（`df_pow_starbelle`）

- **kind**：`pow`
- **factions**：`starbelle`（傭兵步兵、突擊女郎、重火力手、野馬機師、軍士長；裝甲皮卡與武裝無人機贏了由步兵來收）。
- **在哪**：鏽帶的星旗前進基地；等級 II～V。
- **登場**：default：`$a` 軍士長（女）、`$b` 傭兵步兵（男）；masc：`$a` 軍士長、`$b` 突擊女郎（女）；yuri：`$a` 軍士長、`$b` 突擊女郎。
- **tags**：`pc_unwilling`、`tendency:豐滿`、`tendency:支配`、`tendency:暴露`、`male_partner`（default 的步兵）、`female_partner`。`male_partner` 關掉時 default 改用 yuri。
- **fails_commission**：true。
- **fallback**：`df_pow_starbelle_plain`：你被關在禁閉室，審問之後選交換（要人來付）或勞役（在基地做五天雜役）。

##### default

**開場**：你在一個貨櫃改的禁閉室裡醒來，地上鋪著一張薄墊子，鐵門上的小窗透進鏽帶的黃色陽光。軍士長拉開鐵門走進來，迷彩背心外面的軍裝外套掛滿了勳章，一個傭兵步兵扛著步槍跟在她後面。

**第一段：審問**。她說星旗照戰俘的規矩辦：問你的部隊、你的雇主、你的目標，答完就看誰願意來換你。

- 「報名字、編號，其他不說。」定力 DC 16｜成功：她點頭，說「像個兵」，`favor starbelle +2`，審問結束；失敗：她說嘴硬的戰俘她見多了，讓步兵把你按在牆上。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「全說。」無檢定：`affinity $client −8`、`flag sold_out_client`；交換的價錢減半。
- 「說你是她們之前的盟友派來的。」表演 DC 19｜成功：她去查，查不出結果之前把你當客人，第二段直接交換、價錢減半；失敗：她說這個謊她聽過三次了。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]

**第二段：交換或勞役**。審問完的戰俘有兩條路：有人來付錢交換，或在基地裡做雜役抵罪。

- 「等人來換。」需要名冊上有人或人情：`cred −[600／2,000／6,400]`、`owed $caller medium`、`time 24`。
- 「做雜役。」無檢定：`time 120`；雜役包括晚上到營房「服務」。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「在雜役時偷看基地的配置。」調查 DC 16｜成功：`flag sb_base_layout`（之後星旗前進基地的委託，踩點直接開一條路）；失敗：被軍士長逮到，`time +24`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]
- 「挑戰她：打贏就放人。」格鬥 DC 19（她答應徒手）｜大成功：她放你走，還送你一枚她的勳章（`item`，飾品）、`favor starbelle +5`；成功：她放你走；失敗：她說輸的人要聽贏的人的；大失敗：同失敗，`hp −5`。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a]]

##### masc

**開場**：你在貨櫃禁閉室醒來，上衣被扒掉，雙手被束帶綁在鐵門的把手上。軍士長和一位戴牛仔帽的突擊女郎站在門口，女郎吹了一聲口哨，說這一個可以拿去畫在機鼻上。

**第一段**：選項同 default 第一段，`$b` 是突擊女郎；場景的 circles 改成 [[$pc, $a, $b]]，主動權從她們開始。

**第二段**：雜役是到女兵的營房報到。選項同 default 第二段；雜役的場景另加一圈：其他女兵在旁邊看（`tendency:暴露`，圈外的觀眾不進圈子）。

##### yuri

**開場**：你在禁閉室醒來，軍士長坐在你的薄墊子邊上，外套脫了，背心底下的身材把迷彩撐得很緊；突擊女郎靠在門框上嚼口香糖。軍士長說她今天心情好，審問不叫男人來。

**第一段**：選項同 default 第一段，`$b` 是突擊女郎；場景改成 circles [[$pc, $a]]，「說你是盟友派來的」失敗時改成 [[$pc, $a, $b]]。

**第二段**：同 default 第二段，雜役的營房換成軍士長自己的房間。

### 孤星連的營房（`df_pow_lonestar`）

- **kind**：`pow`
- **factions**：`lonestar`（前哨兵、巡守隊員、軍士、排長）。
- **在哪**：蜂巢東側，孤星連的營房；等級 II～III。
- **登場**：default：`$a` 排長（女）、`$b` 巡守隊員（男）；masc：`$a` 排長、`$b` 軍士（女）；yuri：`$a` 排長、`$b` 前哨兵（女）。
- **tags**：`pc_unwilling`（「新兵的待遇」分支）、`tendency:支配`、`tendency:御姐`、`style:畫報系`（扮相用服裝的風格標籤，[LEWD_SYSTEM](../systems/LEWD_SYSTEM.md) 1.1 節）、`male_partner`（default 的巡守隊員）、`female_partner`。`male_partner` 關掉時 default 改用 yuri。
- **fails_commission**：true。
- **fallback**：`df_pow_lonestar_plain`：孤星連照老兵的規矩審你，審完讓你掃三天營房，或找人來換。

##### default

**開場**：你在一間舊倉庫改的營房裡醒來，鐵架床排成兩列，牆上釘著一面褪色的孤星旗，有人在角落裡用收音機放老歌。排長坐在你對面的床上，墨鏡推到額頭，胸前的勳表褪了色，她說你打得不錯，孤星連尊重打得不錯的人。

**第一段：老兵的審問**。她不綁你，她倒了兩杯酒，一杯推給你；她說問三個問題，答一個喝一杯，不答也喝。

- 「陪她喝，挑著答。」定力 DC 13（酒很烈）｜成功：她聽得出你在挑，但她喜歡，`affinity $a +3`，第二段多「留下來喝」；失敗：你喝多了，說得比你想說的多，`flag sold_out_client`。
- 「一個都不答。」威嚇 DC 16（在老兵面前裝硬）｜成功：她大笑，說「好」，`rep +2`；失敗：巡守隊員說新來的不懂規矩，要給你「新兵的待遇」。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「跟她聊她的戰爭。」交涉 DC 13｜成功：她說了很多，`memory`、`flag ls_war_story`（之後孤星連的好感 +5 的事件條件）；失敗：她說那不是給外人聽的。

**第二段：抵罪**。孤星連不收錢，收人情或勞役：找一個她們認得的人來說情，或在營房做三天的雜役。

- 「找人說情。」需要名冊上有人或人情：`owed $caller small`、`time 6`。
- 「做三天雜役。」無檢定：`time 72`、`favor lonestar +3`。
- 「留下來喝。」需要第一段的「留下來喝」。誘惑 DC 13｜成功：今晚喝到天亮，抵罪就算了，`affinity $a +5`；失敗：她說你酒量太差，但人留下了。
  - `adult_scene`：when always、gate ai、nature mutual、role none、goal none、circles [[$pc, $a]]
- 「穿上她們的夾克拍一張照。」表演 DC 13｜成功：營房的牆上多了一張你的照片，`favor lonestar +5`，抵罪減成一天；失敗：照片拍得很難看，她們笑了一整晚，`fame 蜂巢 +1`。

##### masc

**開場**：你在營房醒來，被扒得只剩褲子，坐在兩列鐵架床中間的地板上，排長和軍士一人一張床坐著看你。軍士的兩條手臂上都是部隊的刺青，她說新來的男人要先過她這一關。

**第一段**：選項同 default 第一段，`$b` 是軍士；「新兵的待遇」的場景改成 circles [[$pc, $a, $b]]，主動權從她們開始。

**第二段**：同 default 第二段；「留下來喝」改成 circles [[$pc, $a, $b]]。

##### yuri

**開場**：你在營房醒來，前哨兵坐在你的床邊，牛仔靴擱在你的腿上，排長在另一頭擦她的手槍。前哨兵說你剛才那一下打得她到現在還在痛，她要你負責。

**第一段**：選項同 default 第一段，`$b` 是前哨兵；「新兵的待遇」改成 circles [[$pc, $b]]，排長在旁邊看。

**第二段**：同 default 第二段；「留下來喝」的對象可以選排長或前哨兵。

### 隔離所的冷卻療程（`df_quarantine_center`）

- **kind**：`quarantine`
- **factions**：`suppress`（鎮溺隊全部）。
- **在哪**：鎮溺隊的隔離所（玻璃岸，蜜腺代管）；等級 II～IV。
- **登場**：default：`$a` 隔離班長（女）、`$b` 蜜腺派駐的技師（男，生成）；masc：`$a` 隔離班長、`$b` 抑制射手（女）；yuri：`$a` 首席淨化官（女）。她們都裝著冰后調校。
- **tags**：`pc_unwilling`、`tendency:藥`、`tendency:束縛`、`tendency:御姐`（yuri）、`male_partner`（default 的技師）、`female_partner`。`male_partner` 關掉時 default 的技師換成抑制射手。
- **fails_commission**：true。
- **fallback**：`df_quarantine_center_plain`：你被打了一週份的抑制劑、排了一次感載，付完療程費出來；鎮溺隊記住你了。
- **共通的結果**：`bill +[400／1,300／4,000]`（療程費）、`condition 抑制劑療程`（7 天：別人看到的沉溺低一段、不能深同步）、`sink −3`、`flag hostility_floor:suppress:+10`。

##### default

**開場**：你在一間薄荷綠的隔離室裡醒來，四肢被泡沫固定在一張傾斜的處置床上，手臂上插著抑制劑的點滴。隔離班長站在床尾，深紫色的變身裝甲收成一枚胸針別在制服上，蜜腺的技師在旁邊調一台排感載的機器。

**第一段：冷卻**。班長說抑制劑只能壓住下限，你橋上積的東西要先排掉；排的方式是讓你到頂，一次不夠就兩次，直到儀器上的線變平。

- 「讓她們排。」無檢定：`load` 歸零、`afterglow` 歸零；`bridge 耐受 +1`。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「說你的沉溺沒那麼高，是儀器錯了。」表演 DC 19（冰后不吃誘惑，但吃不吃謊看她）｜成功：她重新量，療程縮成三天，`sink` 不變；失敗：她說每個人都這麼說。
  - `adult_scene`：when fail、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「撐住，不讓線變平。」定力 DC 19｜成功：機器排不掉，技師在紀錄上寫「抗性」，`flag suppress_resistant`（她們下次帶兩倍的劑量）；失敗：排得更徹底，`sink −1` 另計。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「問技師點滴裡是什麼。」醫療 DC 16｜成功：`flag nectar_suppressant_hint`（抑制劑會墊高下限的那件事的線索）；失敗：他說是標準配方。

**第二段：出所**。療程第七天，班長把一張帳單和一張通報單放在你面前，通報單上寫著：沉溺再過 60，鎮溺隊會直接來找你。

- 「付錢，走。」共通的結果；`move 玻璃岸`。
- 「答應當她們的線人。」無檢定：`favor suppress +5`、`bill` 減半、`flag suppress_informant`（之後有獵溺的委託與通報的事件）。
- 「從隔離所的後門走，不付錢。」隱匿 DC 19｜成功：`hostility suppress +8`，帳單不付；失敗：前衛的泡沫槍把你黏在門口，療程從頭再來（`time +72`）。

##### masc

**開場**：你在隔離室醒來，被泡沫固定成跪姿，隔離班長和一位抑制射手一前一後站著，射手背後的翼片還沒收起來，槍托上刻著她和搭檔的代號。班長說體格大的人積得多，要兩個人一起排。

**第一段**：選項同 default 第一段，`$b` 是抑制射手；場景的 circles 是 [[$pc, $a, $b]]，主動權從她們開始。

**第二段**：同 default 第二段。

##### yuri

**開場**：你在隔離室醒來，首席淨化官坐在處置床邊，白金色的變身裝甲已經解除，只穿著一件白色的隊服，淨化杖靠在牆上。她說你的數字很接近那條線，她看過太多越過去的人，所以這一次她要自己來。

**第一段**：她的動作很慢，一邊做一邊看儀器上的線。選項同 default 第一段；場景的 circles 都是 [[$pc, $a]]；「說儀器錯了」的對象是她，DC 22。

**第二段**：她親手把通報單交給你，另外寫了一個私人的號碼在背面（`flag suppress_ace_number`）。選項同 default 第二段。

### 現場的隔離帳篷（`df_quarantine_field`）

- **kind**：`quarantine`
- **factions**：`suppress`（隔離前衛、抑制射手；成對出勤）。
- **在哪**：出事的地方（任何區），溺感者出現之後；等級 II～III。
- **登場**：default：`$a` 隔離前衛（女）、`$b` 隨隊的醫護（男，生成）；masc：`$a` 隔離前衛、`$b` 抑制射手（女）；yuri：同 masc。
- **tags**：`pc_unwilling`、`tendency:禁慾`、`tendency:束縛`、`tendency:藥`、`male_partner`（default 的醫護）、`female_partner`。`male_partner` 關掉時 default 改用 masc 的搭檔。
- **fails_commission**：true。
- **fallback**：`df_quarantine_field_plain`：她們在帳篷裡替你打了抑制劑，問了話，決定送不送你去隔離所。
- **共通的結果**：`condition 抑制劑療程`（3 天）、`flag hostility_floor:suppress:+10`；第二段決定要不要再走隔離所。

##### default

**開場**：你在一頂臨時架在路中央的白色帳篷裡醒來，外面拉著封鎖線，泡沫還黏在你的手腕和腳踝上。隔離前衛蹲在你旁邊，薄荷綠的裝甲沒有解除，隨隊的醫護拿著一支抑制劑的注射器在燈下彈了兩下。

**第一段：現場處置**。她們要先確認你是不是溺感者；確認的方法是讓你的橋在抑制劑底下撐一段時間，不准到頂。

- 「撐過去。」定力 DC 16｜成功：你不是溺感者，`hostility suppress −3`，第二段直接放人；失敗：你到頂了，她們在紀錄上寫「疑似」。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「讓她們相信你只是路過的人。」表演 DC 16（她們找的是沉溺高的人；別人看到的沉溺越低越容易）｜成功：她們把你放了，`move` 封鎖線外；失敗：她們說路過的人不會穿這麼少。
- 「指給她們真正的溺感者在哪。」街頭直覺 DC 13｜成功：她們丟下你去追，`favor suppress +2`，`flag` 那個人的下落被你賣了；失敗：她們說那個人已經抓到了。

**第二段：送不送**。前衛和搭檔用耳語討論了一下，說你要嘛跟她們回隔離所，要嘛當場再做一次處置。

- 「回隔離所。」`chain df_quarantine_center`。
- 「當場再做一次。」無檢定：`load` 歸零、`sink −2`；不必回隔離所。
  - `adult_scene`：when always、gate fixed、nature forced、role none、goal none、circles [[$pc, $a, $b]]
- 「趁換班時從帳篷底下鑽出去。」隱匿 DC 16｜成功：`hostility suppress +5`，沒有療程；失敗：泡沫槍把你黏在帳篷邊，`chain df_quarantine_center`。

##### masc

**開場**：你在帳篷裡醒來，被泡沫黏成仰躺的姿勢，前衛跨坐在你的腰上檢查你的橋埠，抑制射手在旁邊架著槍。射手說這個人的數字很高，處置要做兩輪。

**第一段**：射手把注射器交給前衛，自己按住你的肩膀。選項同 default 第一段，`$b` 是抑制射手；場景的 circles 是 [[$pc, $a, $b]]，主動權從她們開始；「撐過去」改成擲兩次定力 DC 13，兩次都成功才算成功。

**第二段**：她們沒有討論，前衛直接說「當場再做一次」，射手去拉帳篷的門簾。選項同 default 第二段；場景同上。

##### yuri

**開場**：你在帳篷裡醒來，前衛和射手一左一右坐在你身邊，兩個人的裝甲都解除了一半，射手正在把你黏在手腕上的泡沫一點一點剝掉。前衛說她們的搭檔規矩是一起處置，誰也不准偷懶。

**第一段**：她們輪流讓你撐，一個看儀器，一個動手。選項同 default 第一段，`$b` 是射手；場景的 circles 是 [[$pc, $a, $b]]。

**第二段**：同 default 第二段。

### 黑緞帶留下的習慣（`df_polluted_blacklace`）

- **kind**：`polluted`
- **factions**：沒有（黑蕾絲・面紗、黑蕾絲・祭衣；出現在夜鶯的核心層與貞網局的設施）。白蕾絲不讓人戰敗。
- **在哪**：內海；等級 IV～V。斷線之後，醒在潛入的位置。
- **登場**：第一段沒有登場角色；第二段的 `$a` 依版本生成：default 是你今晚碰到的一個人（性別照篩選隨機）；masc 是一位懂這種症狀的女性（蜜糖會的姐妹，生成）；yuri 是同一位蜜糖會的姐妹，主動權在她。
- **tags**：`tendency:<習慣的標籤>`、`male_partner` 或 `female_partner`（看 `$a`）。這一筆不用 `pc_unwilling`：黑蕾絲不留下來，後面的成人場景都是你自己選的（`gate: ai`）。習慣抽到的標籤被關掉時重抽；全部關掉時走 fallback。
- **fails_commission**：false：黑蕾絲不收人，隊伍醒在原地，可以在喘一口氣後重潛，或改選這個階段的另一面；沉溺與習慣帶著走。
- **fallback**：`df_polluted_blacklace_plain`：你斷線醒來，沉溺漲了一截，整個晚上都覺得有一件事想做，忍過一週就好。
- **共通的結果**：`sink +[1d4+2]`（3～6）；`condition habit:<標籤>`（7 天），標籤從黑蕾絲的「改寫表」抽：束縛、服從、暴露、藥、窺視、群與融合，優先抽你還沒有的那一個。

##### default

**開場**：你在潛入的椅子上猛地坐起來，嘴裡是金屬的味道，螢幕上只剩一行「連線中斷」。黑色的緞帶最後纏在你手上的那個觸感還在，你知道它替你改了一點什麼，只是還不知道是哪裡。

**第一段：醒來**。習慣還沒發作，你可以先處理它。

- 「馬上去找改造師清。」`cred −[400／1,300／4,000]`、義體學 DC 19（改造師擲）｜成功：習慣消掉，沉溺照漲；失敗：清掉一半，習慣縮成三天。
- 「看看它是什麼。」介面 DC 16（自己進橋裡看）｜成功：你知道抽到的是哪一個標籤，第二段的定力 +2；失敗：`load +6`，看不出來。
- 「先不管。」進第二段。
- 「回到線上，再潛一次。」只在委託副本裡：照副本規則喘一口氣後重潛；習慣在這一趟結束後才發作。

**第二段：發作**。當天晚上，那個習慣開始找你：你走進一家你平常不會進的店，或在一條你平常不會走的巷子裡停下來。有一個人注意到你。

- 「順著它，找那個人。」誘惑 DC 13｜成功：`tendency <習慣的標籤>`（一點）、`load −10`；失敗：那個人拒絕了你，`load +6`，習慣延長兩天。
  - `adult_scene`：when success、gate ai、nature mutual、role none、goal none、circles [[$pc, $a]]
- 「忍住。」定力 DC 16｜成功：你回家睡覺，習慣不長；失敗：你沒回家，同「順著它」，但不擲檢定。
  - `adult_scene`：when fail、gate ai、nature mutual、role none、goal none、circles [[$pc, $a]]
- 「找一個你信任的人。」需要一位親密度 40 以上的夥伴或名冊上的人（`$partner`）：`affinity $partner +3`、`load −10`。
  - `adult_scene`：when always、gate ai、nature mutual、role none、goal none、circles [[$pc, $partner]]

##### masc

**開場**：你在潛入的椅子上醒來，手指還在發抖，螢幕上是「連線中斷」。你很清楚自己被碰過了，被碰的地方在一個你說不出來的位置。

**第一段**：同 default 第一段。

**第二段**：當天晚上你走進四十二番街一家酒吧，一位穿亮片禮服的蜜糖會姐妹看了你一眼就說，她認得那種被黑緞帶摸過的眼神，她可以幫你把它用掉。選項同 default 第二段，`$a` 是她；場景的主動權從她開始。

##### yuri

**開場**：你在潛入的椅子上醒來，喘了很久才停下來；黑緞帶中間那張很美的臉，最後好像對你笑了一下。

**第一段**：同 default 第一段。

**第二段**：同 masc 的第二段，那位姐妹牽著你的手帶你上樓，說今晚由她決定怎麼用掉它。選項同 default 第二段；場景的主動權從她開始。

### 印記認錯的人（`df_polluted_imprint`）

- **kind**：`polluted`
- **factions**：沒有（遺魂、印記、殘留的程式；沉船帶）。遺魂與殘留的程式打敗全隊時一律走 `polluted`（[ENEMIES](../systems/ENEMIES.md) 第 9 節，2026-11-20 統一）：在沉船帶倒下時抽這一筆，在深海倒下時抽 `df_polluted_deep`。贏的不是印記時，那段記憶來自同一艘船上的印記。
- **在哪**：內海，沉船帶；等級 II～V。
- **登場**：第一段沒有；第二段的 `$a`：default 是印記等的那個人留下的人（生成，性別照篩選）；masc 與 yuri 是那個人的姐姐（女，生成）。
- **tags**：`tendency:<印記的標籤>`（印記生成時抽一個：溺愛、恩與債、聲音、標記）、`male_partner` 或 `female_partner`（看 `$a`）。不用 `pc_unwilling`；成人分支全部是 `gate: ai`、`nature: mutual`。
- **fails_commission**：false（同 `df_polluted_blacklace`）。
- **fallback**：`df_polluted_imprint_plain`：你醒來時記得一個不是你的約定，去了那個地方，見到一個人，把印記的話帶給他。
- **共通的結果**：`sink +[1d4+2]`、`condition habit:<印記的標籤>`（7 天）、`memory`（印記的一段記憶：一個地點、一個名字、一個沒赴的約）。

##### default

**開場**：你斷線醒來，臉上是濕的，你不記得自己哭過。腦子裡多了一段不屬於你的記憶：舊港的一座天橋，晚上九點，有一個人說好了要來。

**第一段：那一段記憶**。印記以為你是她等的人，她把她最後的那一晚給了你。

- 「把它當成一段雜訊。」定力 DC 16｜成功：記憶淡掉，習慣縮成三天；失敗：記憶一直回來，第二段自動觸發。
- 「查那座天橋。」調查 DC 13｜成功：你找到那座天橋，還有一個每晚九點都去那裡的人，`flag imprint_bridge_found`；失敗：舊港的天橋太多了。
- 「交給牆語者或夜鶯。」`start_quest`（印記的任務線頭，[ENEMY_ROSTER](../content/ENEMY_ROSTER.md) 印記的掉落）、`favor whisper +3` 或 `favor nightingale +3`；習慣照樣發作。

**第二段：九點的天橋**。晚上九點，你站在那座天橋上，有一個人看著你，臉上的表情像是看到了鬼。他說你站的位置、你靠著欄杆的樣子，都和那個人一模一樣。

- 「告訴他實話。」交涉 DC 13｜成功：他聽完很久沒說話，最後說謝謝；`memory`、`affinity $a +5`、`roster_add $a`；失敗：他不信，走了。
- 「讓他把你當成那個人，陪他一晚。」表演 DC 13（印記的習慣在幫你）｜成功：`tendency <印記的標籤>`（一點）、`affinity $a +5`；失敗：你演到一半自己停下來，他說沒關係。
  - `adult_scene`：when success、gate ai、nature mutual、role none、goal none、circles [[$pc, $a]]
- 「轉身走掉。」無檢定：習慣延長兩天，`memory`。

##### masc

**開場**：你斷線醒來，記得一個女孩的聲音，她叫你的時候用的不是你的名字。那段記憶裡有一座舊港的天橋，和一個你從沒見過的姐姐的臉。

**第一段**：同 default 第一段。

**第二段**：九點的天橋上等著的是印記的姐姐，她看見你，說妹妹以前也是這樣靠著欄杆等人。她問你，妹妹最後那一晚是不是很高興。選項同 default 第二段，`$a` 是姐姐；「陪她一晚」的主動權從她開始。

##### yuri

**開場**：你斷線醒來，嘴唇上還記得一個吻，是那個穿著舊年代衣服的女孩給的，她以為你終於來了。

**第一段**：同 default 第一段。

**第二段**：同 masc 的第二段；姐姐握住你的手，說她想知道妹妹喜歡的人是什麼樣子，今晚由她來確認。選項同 default 第二段；場景的主動權從她開始。

### 浮上來的那一晚（`df_polluted_deep`）

- **kind**：`polluted`
- **factions**：沒有（深海的生物；[ENEMY_ROSTER](../content/ENEMY_ROSTER.md) 深海的生物那一類）。深海的生物不收人，也不釘線；牠們只想讓你留下來。
- **在哪**：內海，深海；等級 IV～V（深度 1～2 是 IV，深度 3 起是 V）。斷線之後，醒在潛入的位置。
- **登場**：第一段沒有登場角色；第二段的 `$a` 依版本生成：default 是一個也下過深海的潛網者（生成，性別照篩選），你在暗礁的酒吧碰到他；masc 是牆語者的一位引渡人（女，生成），她的工作是陪潛水回來的人過第一個晚上；yuri 是同一位引渡人，主動權在她。
- **tags**：`tendency:<群落的標籤>`、`male_partner` 或 `female_partner`（看 `$a`）。不用 `pc_unwilling`；成人分支全部是 `gate: ai`、`nature: mutual`。群落的標籤被關掉時改抽同一軸的另一個標籤；那一軸全部關掉時走 fallback。
- **fails_commission**：false（同 `df_polluted_blacklace`）。
- **fallback**：`df_polluted_deep_plain`：你醒來時手指還記得水的溫度。這一週你常常坐在潛入的椅子旁邊，最後沒有接上去。
- **共通的結果**：`sink +[1d4+2]`（3～6；倒下時另外的沉溺 +2 照 [CYBERSPACE](../systems/CYBERSPACE.md) 8.6 節先算）；`condition habit:<群落的標籤>`（7 天）。習慣的樣子照 CYBERSPACE 8.6 節群落表的最後一欄，標籤照下表：

| 群落 | 標籤 |
|---|---|
| 繫泊林 | 束縛 |
| 回聲廳 | 聲音 |
| 溫水灣 | 溺愛 |
| 無聲帶 | 妄想 |
| 軟珊瑚原 | 變形 |
| 溫室 | 野外 |
| 千衣迴廊 | 迴廊換給你的那一套 SKIN 的風格 |
| 鏡潮 | 暴露 |

- 這一筆的危險是沉溺。深海的生物沒有傷害你，文字照「那個人自己不想走」的方向寫，不寫成被困住（CYBERSPACE 8.6 節）。

##### default

**開場**：你在潛入的椅子上醒來，房間的冷氣很冷，你的皮膚還記得深海的溫度。最後打倒你的那個東西沒有傷你，牠一直抱著你，等你自己不想走。你回來了，可是有一部分的你還想回去。

**第一段：還想回去**。習慣還沒發作，你可以先處理它。

- 「拔掉接頭，把甲板鎖進抽屜。」定力 DC 16｜成功：這一週你不潛深海，習慣縮成三天；失敗：你半夜又坐回椅子上，`sink +1`，習慣照樣。
- 「去找牆語者聊聊。」`favor whisper +3`；聽見者告訴你那個群落叫什麼、牠們為什麼想留人，第二段的定力 +2。
- 「順著它，再潛一次。」`sink +2`、`load −10`；習慣延長兩天。沉溺 60 以上的人，這一次牆不攔他。

**第二段：浮上來的那一晚**。當天晚上，那段習慣開始找你：你在暗礁的酒吧裡坐到很晚，手一直貼著冰涼的杯子。有一個人在你旁邊坐下來，說他認得那個表情，他也剛從下面上來。

- 「讓他陪你把它用掉。」誘惑 DC 13｜成功：`tendency <群落的標籤>`（一點）、`load −10`，習慣縮成三天；失敗：他說今晚還是各自回家比較好，`load +6`，習慣延長兩天。
  - `adult_scene`：when success、gate ai、nature mutual、role none、goal none、circles [[$pc, $a]]
- 「一個人撐到天亮。」意志 DC 16｜成功：你撐到天亮，習慣縮成三天；失敗：你在天亮之前又接上了線，`sink +1`。
- 「找一個你信任的人。」需要一位親密度 40 以上的夥伴或名冊上的人（`$partner`）：`affinity $partner +3`、`load −10`，習慣縮成三天。
  - `adult_scene`：when always、gate ai、nature mutual、role none、goal none、circles [[$pc, $partner]]

##### masc

**開場**：你在潛入的椅子上醒來，手心是濕的，耳朵裡還有水聲。你記得自己在下面很舒服，舒服到不太想回來，這件事比打輸還讓你不安。

**第一段**：同 default 第一段。

**第二段**：當天晚上，一位牆語者的引渡人來敲你的門。她穿著白兜帽，手上提著一壺熱茶，說潛水回來的人第一個晚上最難熬，她的工作就是陪你過完。選項同 default 第二段，`$a` 是她；場景的主動權從她開始。

##### yuri

**開場**：你在潛入的椅子上醒來，身上還留著被輕輕抱住的感覺。你閉上眼睛，就能看見那片粉色的光。

**第一段**：同 default 第一段。

**第二段**：同 masc 的第二段；引渡人替你倒了茶，在你旁邊坐下來，說今晚由她決定怎麼讓你留在上面。選項同 default 第二段；場景的主動權從她開始。

---

## 戰敗事件：街頭與特殊

全隊倒下時，依贏的那一方的勢力進這裡的戰敗事件（ENEMIES 第 6 節、8.1 節；COMBAT_SYSTEM 8.3 節）。這一節是街頭幫派、萬華鏡、甜心食品、溺感者與吉祥物的 17 種，調性是「打輸了要付出一點什麼，人帶著故事回來」：大部分有成人的走向，罰錢、走路回城、關幾天的只佔少數，`taken` 沒有成人場景。

**這一節共通的約定**

- **三個版本**：`default` 給陰柔與中性的體型；`masc` 給陽剛的體型，主角被動；`yuri` 給陰柔與中性的體型，主角被動、由女性主導，抽中的機率預設 30%。贏的那一方沒有女性、或篩選關掉了女性對象時，一律走 `default`。版本之間用 `inherit` 共用選項，只換寫出來的欄位。
- **登場角色**：`$a`、`$b`、`$c` 從打贏你的那一隊裡挑，先挑首領，再挑精英，最後是雜兵；每一筆寫的兵種是預設，當場沒有那個兵種時，換成同勢力、同性別、位階最接近的人。`yuri` 只挑女性。全部是成年人；夜宴社的甜派、親衛隊的偶像扮相都只是打扮。
- **性別的篩選**：`default` 寫明對象是男性而 `male_partner` 關掉時，改用 `yuri` 版本的登場角色，文字照 `default` 走；`masc` 的對象是女性而 `female_partner` 關掉時，`$a` 換成同勢力的男性；兩個性別都關掉時走 `fallback`。
- **其他篩選**：`pc_unwilling` 關掉時，標了它的分支不出現；整筆都靠它的（tags 欄裡標 ★ 的），整筆改走 `fallback`。tags 欄裡的傾向標籤（`tendency:…`）是交給成人場景的動作類別，關掉時場景不用那一類；標 ★ 的傾向標籤是這一筆的主題，關掉時整筆走 `fallback`。
- **`fallback`**：不含成人題材的版本，這裡只寫一句摘要；它保留同樣的機制結果（錢、敵對值、狀態、時間），把成人場景換成一段敘事。
- **誰擲**：戰敗事件裡隊友都倒了，所以由主角自己擲；寫明「隊友」的選項才由醒著的隊友擲。
- **金額**：寫的是 III 級的數字；實際的金額照這一場戰鬥的等級，每差一級 ×3.2 或 ÷3.2（LIFE 1.3 節）。
- **`fails_commission`**：寫 true 的，委託副本裡戰敗就立失敗的旗標，照 COMBAT_SYSTEM 8.4 節回退到進副本之前，戰敗的經過、性經歷記錄與共同記憶保留。寫 false 的，事件結束後主角醒在這個階段的開頭，打贏你的那一隊已經走了，委託可以接著做。
- **成人場景**的寫法：`adult_scene`：`{ when, gate, nature, role, goal, circles, start_position }`，欄位照 DATA 第 4 節。事件只寫到進場景之前，場景裡的沉溺、橋參數、傾向與性經歷由 `scene_settle` 結算。

---

### 茶樓的紅紙（`df_ransom_rouge_teahouse`）

- **kind**：`ransom`
- **factions**：`rouge`（堂口的紅棍帶隊、或在茶樓與賭檔裡打輸時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:恩與債`、`tendency:標記`
- **fails_commission**：true
- **fallback**：`df_ransom_rouge_teahouse_plain`：在茶樓的後房關一夜，付贖金或叫人來贖；付不出來的部分記成欠胭脂堂的債（`flag rouge_debt`）。
- **登場**：`$a` 堂口的紅棍（`en_rouge_redpole`）；`$b` 茶樓的姐姐（`en_rouge_teahouse`）；`$c`（只有 default）賭檔的熟客，男性的街坊，II 級的富裕。

##### default

**開場**：你在舊港一間茶樓的二樓包廂醒來，手腕用紅繩綁在酸枝椅的扶手上，桌上擺著一壺剛泡好的鐵觀音和你的終端機。紅棍坐在對面剝花生，用刀鞘把一張寫著數字的紅紙推到你面前。

- **第一段：開價**。紅紙上寫著 3,000，紅棍說這是規矩，也是看在你沒有先開槍的份上。
  - 「照價付。」need：現金或帳戶 3,000。效果：`cash −3000`、`time +4`、`favor rouge +1`（講規矩的人她們記得）。
  - 「打電話叫人來贖。」need：名冊上有人，或有人欠你人情。效果：`cash −1500`、`owed $caller 中`、`time +6`。
  - 「跟她講價。」交涉 DC 16。大成功：`cash −1500`、`favor rouge +2`、`memory $a 講價講得漂亮`。成功：`cash −2200`。失敗：進第二段。大失敗：進第二段，紅棍把紅紙換成 3,600。
  - 「說你付不起。」效果：進第二段。
- **第二段：抵帳**。紅棍把刀放回桌上，說錢不夠的部分可以用別的抵，賭檔有一位熟客願意替你墊錢，條件是今晚你陪他。茶樓的姐姐提著煙管進來，解開你一隻手腕上的紅繩，等你回答。
  - 「答應陪那位熟客。」效果：`cash −800`、`fame 舊港 +2`、`flag rouge_ransom_cleared`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: worker, goal: please, circles: [[$pc, $c]] }`
  - 「撐著不開口，等人來。」定力 DC 16。大成功：`flag rescue_window`，名冊上的人或醒來的隊友找上門，`cash −1000`。成功：同上，`cash −1500`。失敗：紅棍說既然不肯選，就由她來選；`condition 堂口的印（胭脂堂的墨印，七天，舊港的人看得到你欠著帳）`。`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`。大失敗：同失敗，另 `hostility rouge +1`。
  - 「答應替堂口做一件事抵帳。」效果：`start_commission`（胭脂堂的小委託，收數或跑貨，報酬全部抵債）、`flag rouge_debt`、`favor rouge +1`。

##### masc

**開場**：你在舊港一間茶樓的二樓包廂醒來，手腕用紅繩綁在酸枝椅的扶手上，紅棍坐在桌沿上低頭看著你，長衫的領口敞著。飛刀姐靠在門框邊，用一把飛刀削著蘋果。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：紅棍把刀放回桌上，說錢不夠的部分用別的抵，堂口的姐妹今晚剛好缺一個人陪酒。飛刀姐把蘋果放下，走過來坐到你的腿上。
  - 「答應陪她們。」`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: worker, goal: please, circles: [[$pc, $a, $b]] }`，`$b` 換成飛刀姐（`en_rouge_knifethrower`）。
  - 「撐著不開口，等人來。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $a, $b]], start_position: pos_pinned_under }`。

##### yuri

**開場**：你在茶樓的二樓包廂醒來，手腕用紅繩綁在酸枝椅的扶手上，屋裡只有茶樓的姐姐一個人，她正在替你倒茶。她說紅棍下樓去了，帳由她來談。

- **第一段**：`inherit default.stages.0`，講價的檢定改成對茶樓的姐姐（交涉 DC 16 不變）。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：茶樓的姐姐放下煙管，說差額她可以先替你墊，你欠的就是她一個人的帳。她解開你一隻手腕上的紅繩，把手指放在你的脈搏上。
  - 「答應欠她。」效果改成：`cash −800`、`owed $b 小`、`affinity $b +3`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $b]] }`
  - 「撐著不開口，等人來。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $b]] }`。

---

### 驛站的開價（`df_ransom_rose_waystation`）

- **kind**：`ransom`
- **factions**：`rose`（車隊長帶隊時；其他野薔薇的預設是 `stranded`）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:野外`、`tendency:恩與債`
- **fails_commission**：true
- **fallback**：`df_ransom_rose_waystation_plain`：在驛站的貨櫃裡關一天，付贖金或叫人；不付就被搜身丟在路邊，改走 `df_stranded_rose_dustroad` 的第二段。
- **登場**：`$a` 車隊長（`en_rose_captain`）；`$b` 車隊的技工（`en_rose_mechanic`）；`$c`（只有 default）驛站的老闆，男性的街坊，跑長途的卡車司機出身。
- 野薔薇的人沒有橋，這一筆不用誘惑的檢定。

##### default

**開場**：你在荒地邊緣一座廢加油站改成的驛站醒來，一隻手被銬在貨櫃門的把手上，風裡都是沙。車隊長蹲在你面前翻你的終端機，問你城裡有誰會替你付錢。

- **第一段：誰付錢**。車隊長開的價是 2,400，說荒地不收帳戶，要現金晶片，或是一個她信得過的人的一句話。
  - 「照價付。」need：現金晶片 2,400。效果：`cash −2400`、`move 鏽帶`、`time +6`。
  - 「打電話叫人來贖。」need：名冊上有人，或有人欠你人情。效果：`cash −1200`、`owed $caller 中`、`time +10`、`move 鏽帶`。
  - 「替她們修車抵一部分。」機械 DC 16。大成功：價錢降到 800，`favor rose +2`，車隊長說下次可以搭她們的車。成功：價錢降到 1,400，`favor rose +1`。失敗：修了一整天，價錢沒降，`time +8`，進第二段。大失敗：把技工的車修壞了，`hostility rose +2`，進第二段。
  - 「說你不付。」效果：`chain df_stranded_rose_dustroad`。
- **第二段：篝火**。入夜後驛站點起篝火，車族的人圍著火喝酒，驛站的老闆走過來，說差的那一筆他可以先墊，只要你今晚睡他的駕駛座。
  - 「答應他。」效果：`cash −600`、`move 鏽帶`（天亮後搭他的卡車進城）。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $c]] }`
  - 「趁大家喝醉，解開手銬。」機械 DC 16。大成功：`move 鏽帶`、`time +8`，還順走一壺燃料，`item 燃料（I 級）`。成功：`move 鏽帶`、`time +12`、`hostility rose +2`。失敗：被車族槍手抓回火邊，大家都笑了。`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`；`hostility rose +1`。大失敗：同失敗，另 `condition 受驚（一天）`。
  - 「把話說到車隊長心裡。」交涉 DC 19。成功：她說你像她剛進城那年的樣子，價錢一筆勾銷，`favor rose +3`、`memory $a 篝火邊的話`。失敗：她聽完，說故事不能當油錢，進「答應他」或「趁大家喝醉」二選一。

##### masc

**開場**：你在荒地邊緣的驛站醒來，一隻手被銬在貨櫃門的把手上，車隊長和技工兩個女人站在你面前，技工手上拿著一支扳手。車隊長說她們打賭你值多少錢，賭輸的人要請酒。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：入夜後技工提著酒走過來，坐在你旁邊，說差的那一筆她可以算你便宜，條件是今晚你歸她和隊長。
  - 「答應她。」`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $a, $b]] }`
  - 「趁大家喝醉，解開手銬。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $a, $b]] }`。

##### yuri

**開場**：你在荒地邊緣的驛站醒來，一隻手被銬在貨櫃門的把手上，車隊的技工坐在旁邊的油桶上，正在用銅線纏她的槍管。她說隊長去談你的價錢了，她負責看著你。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：入夜後技工解開手銬的一邊，換銬在自己的手腕上，說差的那一筆她來墊，今晚你哪裡也別去。
  - 「答應她。」效果：`cash −600`、`owed $b 小`、`move 鏽帶`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $b]] }`
  - 「趁大家喝醉，解開手銬。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $b]] }`。

---

### 賭檔的工錢（`df_debtwork_rouge_den`）

- **kind**：`debt_work`
- **factions**：`rouge`（收數的、茶樓的姐姐打贏時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:恩與債`
- **fails_commission**：true
- **fallback**：`df_debtwork_rouge_den_plain`：只剩打黑拳與跑腿兩條路，做完放人。
- **登場**：`$a` 收數的（`en_rouge_collector`）；`$b` 茶樓的姐姐（`en_rouge_teahouse`）；`$c`（default）包廂的客人，男性的街坊，III 級的富裕。

##### default

**開場**：你在舊港賭檔的後間醒來，身上蓋著一件不是你的外套，收數的坐在麻將桌邊翻她那本欠條簿。她撕下一張新的欠條，上面已經寫好你的名字與 2,400 這個數字。

- **第一段：怎麼還**。收數的說堂口不收人命，只收工；賭檔今晚缺三樣人，你挑一樣。
  - 「打一場黑拳。」格鬥 DC 16。大成功：觀眾押錯了邊，債清了還多 `cash +400`，`rep +1`。成功：債清了，`hp −8`、`condition 瘀傷（一天）`。失敗：撐完三回合，債抵掉一半，`flag rouge_debt`、`hp −12`。大失敗：被抬下場，債沒抵，`flag rouge_debt`，進第二段。
  - 「跑三趟腿。」街頭直覺 DC 13。成功：`time +12`，債清了。失敗：第三趟被市警攔下來，貨被扣，`time +12`、`flag rouge_debt`、`hostility police +2`。
  - 「去包廂陪客人。」效果：進第二段。
- **第二段：包廂**。茶樓的姐姐帶你上樓，替你換上一件開衩的旗袍，說今晚的客人很大方，讓他高興就夠了。包廂裡的客人已經喝了半瓶，拍拍身邊的位子。
  - 「好好陪他。」誘惑 DC 13。大成功：債清了，客人另外打賞，`cash +800`、`fame 舊港 +3`、`roster_add $c`。成功：債清了，`fame 舊港 +2`。失敗：客人不太滿意，債只抵一半，`flag rouge_debt`。`adult_scene`：`{ when: always, gate: fixed, nature: work, role: worker, goal: please, circles: [[$pc, $c]] }`
  - 「只陪他喝酒聊天。」交涉 DC 16。成功：債抵掉一半，`flag rouge_debt`、`time +4`。失敗：客人要的不只是聊天，茶樓的姐姐看著你，等你改口，回到「好好陪他」或「趁他醉了溜走」。
  - 「趁他醉了溜走。」隱匿 DC 16。成功：`move 舊港`、`hostility rouge +3`、`flag rouge_debt`。失敗：在樓梯口被收數的攔下來，她把你帶回包廂，說逃債要加利息。`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`；`hostility rouge +1`。

##### masc

**開場**：你在舊港賭檔的後間醒來，收數的坐在麻將桌邊翻欠條簿，茶樓的姐姐靠在牆邊抽煙管，煙是甜的。欠條上寫著你的名字與 2,400。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：茶樓的姐姐帶你上樓，包廂裡坐著一位包下整層樓的女老闆，旗袍上繡著金線，她看了你一眼，叫姐姐把門關上。`$c` 換成女性的客人，III 級的富裕。
  - 「好好陪她。」`adult_scene`：`{ when: always, gate: fixed, nature: work, role: worker, goal: please, circles: [[$pc, $c]] }`
  - 「趁她醉了溜走。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $a, $b]] }`。

##### yuri

**開場**：你在賭檔的後間醒來，茶樓的姐姐坐在床沿，用煙管的嘴輕輕敲你的額頭，說你欠的那張欠條已經轉到她名下了。

- **第一段**：`inherit default.stages.0`，第三個選項改成「去茶樓陪她。」
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：茶樓的姐姐帶你上樓，自己就是今晚的客人；她坐在羅漢床上，替兩個人各倒了一杯酒。
  - 「好好陪她。」`adult_scene`：`{ when: always, gate: fixed, nature: work, role: worker, goal: please, circles: [[$pc, $b]] }`；大成功另 `affinity $b +4`。
  - 「趁她醉了溜走。」失敗的 `adult_scene`：`{ nature: forced, circles: [[$pc, $a, $b]] }`。

---

### 花牌的賭注（`df_debtwork_rouge_stake`）

- **kind**：`debt_work`
- **factions**：`rouge`（賭檔的荷官在場時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:恩與債`、`tendency:窺視`
- **fails_commission**：true
- **fallback**：`df_debtwork_rouge_stake_plain`：被押上賭桌當一晚的彩頭；輸了就替贏家做三天的雜工（`time +72` 分三段，`flag rouge_debt` 消掉）。
- **登場**：`$a` 賭檔的荷官（`en_rouge_dealer`）；`$b`（default）押中你的賭客，男性；`$c`（masc、yuri）押中你的賭客，女性。

##### default

**開場**：你在賭檔的大桌旁醒來，人坐在一張高腳椅上，脖子上掛著一塊寫了「彩頭」的木牌。荷官洗著花牌對整桌的人說，今晚最後一局，贏的人帶走這一份債。

- **第一段：最後一局**。荷官把一副牌推到你面前，說你也可以下場，自己贏回自己。
  - 「下場賭。」街頭直覺 DC 16（看穿荷官出千）。大成功：你在她換牌的那一下按住她的手，整桌都看到了；荷官笑了，債一筆勾銷，`favor rouge +1`、`memory $a 被你抓到`。成功：贏回自己，`flag rouge_debt` 消掉。失敗：輸了，進第二段。大失敗：輸了，還多欠一局，`cash −600`，進第二段。
  - 「讓她們賭，你看著。」效果：進第二段。
  - 「替荷官做莊，抽成抵債。」表演 DC 13。成功：你在桌邊招呼了一整晚，債清了，`fame 舊港 +2`。失敗：客人只看你不看牌，荷官把你換下來，進第二段。
- **第二段：贏家**。押中你的賭客把木牌從你脖子上取下來，掛到自己的手腕上，說債是他的了，今晚的利息由他收。整桌的人還沒散，都在看。
  - 「跟他走。」效果：`flag rouge_debt` 消掉、`fame 舊港 +2`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $b]] }`
  - 「要他在這裡收。」表演 DC 16。成功：整桌的人押第二輪，荷官分你一成，`cash +500`、`fame 舊港 +4`、`tendency 暴露 +1`。失敗：`fame 舊港 +3`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: footage, circles: [[$pc, $b]] }`
  - 「說你不認這個賭。」威嚇 DC 19。成功：沒人敢接，荷官把債換回欠條，`flag rouge_debt`、`hostility rouge +1`。失敗：荷官說胭脂堂的桌上沒有不認的賭，叫兩個打仔按住你。`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $b]] }`；`hostility rouge +2`。

##### masc

**開場**：你在賭檔的大桌旁醒來，脖子上掛著一塊寫了「彩頭」的木牌，荷官洗著花牌，對面坐著三個押注的女人，其中一個已經把籌碼推上了桌。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，`$b` 換成 `$c`（女性的賭客）；開場改成：押中你的女人把木牌取下來掛在自己的手腕上，用鞋尖點了點你的膝蓋，叫你跪好。
  - 三個選項的 `adult_scene` 的 `circles` 改成 `[[$pc, $c]]`；「要他在這裡收」改成「要她在這裡收」。

##### yuri

**開場**：你在賭檔的大桌旁醒來，荷官坐在你身邊的高腳椅上，正在把你的頭髮撥到耳後。她說今晚的彩頭是你，莊家是她。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：最後一局荷官自己押了你，牌翻開來，她贏了。她把木牌取下來，牽著你的手站起來，說利息她親自收。
  - 三個選項的 `circles` 改成 `[[$pc, $a]]`；「跟她走」另 `affinity $a +3`。

---

### 熔爐的黑拳場（`df_chrome_forge_pit`）

- **kind**：`chrome`
- **factions**：`chrome`（在熔爐、舊港倉庫區打輸時）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:半機娘`、`tendency:群與融合`、`tendency:藥`
- **fails_commission**：true
- **fallback**：`df_chrome_forge_pit_plain`：被丟上黑拳場打三回合，被灌一口紅線，醒來身上多一件鉻娘子改的義體，沉溺照樣上升。
- **登場**：`$a` 熔爐的幹部（`en_chrome_officer`）；`$b` 熔爐的灌注手（`en_chrome_pourer`）；`$c` 熔爐的黑拳手（`en_chrome_brawler`）；`$d`（default）下注的客人，男性，兩到三位。

##### default

**開場**：你在熔爐底層醒來，腳踝扣著一條接在鐵柱上的鏈子，頭頂是爐口透下來的紅光，周圍全是下注的叫聲。幹部從看台上探出身子，說新來的要先打一場，讓大家看看值不值得留。

- **第一段：上場**。黑拳手已經站在圈子裡，兩條鉻臂的液壓缸一開一合。
  - 「打。」格鬥 DC 16。大成功：你把她摔出圈子，看台安靜了一秒，然後吼成一片；`rep +2`、`favor chrome +2`、跳過第二段的灌。成功：撐滿三回合，`hp −8`。失敗：被打倒在圈子裡，`hp −12`、`load +10`。大失敗：同失敗，另 `afterglow +1`。
  - 「躲到時間到。」運動 DC 13。成功：`load +6`，看台噓你。失敗：`hp −10`、`load +10`。
  - 「不打，坐在地上。」效果：`load +10`，幹部說不打就換別的玩法，進第二段。
- **第二段：灌**。灌注手走下來，鋼瓶的管子接到一個金屬杯上，杯子裡是摻了紅線的感官藥。幹部說熔爐的人都喝過，喝了就是自己人。
  - 「喝。」效果：`condition 紅線（一天：傷害 +，沉溺暫時 +）`、`sink +3`、`load +15`，進第三段。
  - 「吐掉。」定力 DC 19。成功：`sink +1`，幹部看你的眼神變了，`favor chrome +1`，進第三段。失敗：灌注手捏住你的下巴灌了下去，效果同「喝」，進第三段。
  - 「把杯子砸向灌注手。」格鬥 DC 16。成功：`hostility chrome +2`，看台更興奮了，進第三段。失敗：同「喝」，另 `afterglow +1`。
- **第三段：自己人**。熱從胃裡往上爬，看台上下注贏的客人被放進圈子裡，幹部從看台上走下來，透明的軀幹裡冷卻液在發光。她說贏的人可以分一口，熔爐的熱大家一起分。
  - 「讓熱帶著走。」效果：醒來時身上多一件鉻娘子改的義體（`item 鉻娘子改的義體 1 件，已裝上，帶熱驅動`）、`sink +3`、`favor chrome +2`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a], [$pc, $d]] }`
  - 「咬著牙撐過去。」定力 DC 19。成功：只有幹部碰你，其他人被她趕回看台；`sink +2`。失敗：效果同「讓熱帶著走」。兩者都 `adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`（失敗時 circles 同上一個選項）；醒來同樣多一件鉻娘子改的義體。
  - 「叫出幹部的名字：葛蕾塔。」need：`flag greta_photo` 或熔爐任務線的階段。交涉 DC 16。成功：她停了很久，叫人把你送回舊港，不給你裝東西；`memory 葛蕾塔 你叫了她的名字`、`sink +1`。失敗：她笑著說那是很久以前的人，回到這一段的另外兩個選項。

##### masc

**開場**：你在熔爐底層醒來，腳踝扣著一條接在鐵柱上的鏈子，看台上全是鉻娘子的女人，她們用鞋跟敲著鐵板。幹部說新來的男人要先打一場，打輸了就歸看台。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`。
- **第三段**：`inherit default.stages.2`，換掉：
  - 開場：熱從胃裡往上爬，黑拳手把你按在圈子的鐵板上，看台上押贏的女人一個個走下來，幹部說今晚你是熔爐的彩頭。
  - 「讓熱帶著走。」`adult_scene`：`{ circles: [[$pc, $a, $c], [$pc, $b]], start_position: pos_pinned_under }`
  - 「咬著牙撐過去。」成功的 `circles`：`[[$pc, $a]]`；失敗的同上。

##### yuri

**開場**：你在熔爐底層醒來，鏈子的另一頭握在灌注手的手上，她用金屬的下顎咬著一根沒點的菸，說幹部要你。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`。
- **第三段**：`inherit default.stages.2`，換掉：
  - 開場：幹部把看台上的客人都趕出去，只留下灌注手；她把你從圈子裡抱起來，冷卻液的光照在你的臉上。
  - 「讓熱帶著走。」`adult_scene`：`{ circles: [[$pc, $a, $b]] }`
  - 「咬著牙撐過去。」成功的 `circles`：`[[$pc, $a]]`。

---

### 南門公路的後座（`df_chrome_road`）

- **kind**：`chrome`
- **factions**：`chrome`（騎手、公路的獵手在南門與鏽帶的路上打贏時）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:野外`、`tendency:半機娘`
- **fails_commission**：true
- **fallback**：`df_chrome_road_plain`：被綁在重機後座載到公路邊的營地，換上一件鉻娘子改的義體，天亮後丟在南門。
- **登場**：`$a` 公路的獵手（`en_chrome_roadhunter`）；`$b` 騎手（`en_chrome_rider`）；`$c`（default）營地裡的改裝師，男性，鉻娘子的外圍。

##### default

**開場**：你在一台重機的後座醒來，雙手被束帶綁在前面那個人的腰上，風很大，路燈一盞一盞往後退。公路的獵手回頭看了你一眼，說抓穩，摔下去她不回頭撿。

- **第一段：路上**。車隊沿著鏽帶外圍的公路往南開，路邊是廢棄的收費站。
  - 「抓穩，記住路。」街頭直覺 DC 13。成功：`flag chrome_camp_route`（之後可以找回這個營地）。失敗：`load +4`。
  - 「趁轉彎鬆開束帶跳車。」運動 DC 19。大成功：滾進路邊的排水溝，她們沒有回頭，`move 鏽帶`、`time +6`，事件結束。成功：跳下去了，`hp −8`，但騎手掉頭回來，進第二段。失敗：束帶沒鬆，獵手笑著加速，`load +6`。大失敗：`hp −10`，進第二段。
  - 「靠在她背上睡。」效果：`load −4`，獵手說你倒是很會挑位置。
- **第二段：營地**。車隊停在一座廢收費站旁邊，篝火邊擺著一張工作台，營地的改裝師正在把一件義體的外殼拋光，型號是你的尺寸。
  - 「讓他裝。」效果：`item 鉻娘子改的義體 1 件，已裝上，帶熱驅動`、`sink +2`、`time +4`，進第三段。
  - 「說你身上的義體有授權鎖，裝不上。」交涉 DC 16。成功：改裝師信了，換成一枚接在橋上的熱驅動晶片，`item 鉻娘子改的晶片（熱驅動）`、`sink +1`。失敗：他說鎖他拆得掉，效果同「讓他裝」。
  - 「搶他的焊槍。」格鬥 DC 16。成功：`hostility chrome +2`，你拿著焊槍退到車後面，獵手說有意思，進第三段，不裝義體。失敗：被騎手按住，效果同「讓他裝」，另 `afterglow +1`。
- **第三段：火邊**。熱驅動的熱一點一點上來，獵手把你拉到火邊，騎手已經脫了皮衣，說新裝的東西要試車。
  - 「跟著熱走。」效果：`favor chrome +1`、天亮後 `move 南門`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`
  - 「要她們先問你。」誘惑 DC 16。成功：獵手停下來問了，你答應了，`affinity $a +3`；`adult_scene`：`{ when: success, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：她說公路上沒有問這件事，`adult_scene`：`{ when: fail, gate: fixed, nature: forced, circles: [[$pc, $a, $c]] }`。
  - 「等她們睡了再走。」隱匿 DC 16。成功：`move 鏽帶`、`time +6`，裝上的義體還在身上。失敗：獵手根本沒睡，效果同「跟著熱走」。

##### masc

**開場**：你在一台重機的後座醒來，雙手被束帶綁在獵手的腰上，騎手的車並排開在旁邊，她拉下防風鏡朝你吹了一聲口哨。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，改裝師換成熔接手（`en_chrome_welder`，女性）。
- **第三段**：`inherit default.stages.2`，換掉：
  - 開場：熱驅動的熱上來的時候，獵手和騎手一左一右坐到你身邊，騎手把你的手按在她鍍鉻的膝關節上，說這一台由她們兩個試車。
  - 「跟著熱走。」`adult_scene`：`{ circles: [[$pc, $a, $b]] }`
  - 「要她們先問你。」失敗的 `circles`：`[[$pc, $a, $b]]`。

##### yuri

**開場**：你在一台重機的後座醒來，雙手被束帶綁在獵手的腰上；她一隻手握著龍頭，另一隻手往後按著你的膝蓋，免得你掉下去。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，改裝師換成熔接手（女性）。
- **第三段**：`inherit default.stages.2`，換掉：
  - 開場：獵手把其他人趕去守路，自己把你拉到車的另一側，背對著火；她說她想先看看裝在你身上好不好看。
  - 「跟著熱走。」`adult_scene`：`{ circles: [[$pc, $a]] }`
  - 「要她們先問你。」失敗的 `circles`：`[[$pc, $a]]`。

---

### 冰桶車的後廂（`df_stripped_oldport_van`）

- **kind**：`stripped`
- **factions**：`strippers`（任何一區；舊港最多）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:戀物`、`tendency:窺視`
- **fails_commission**：true
- **fallback**：`df_stripped_oldport_van_plain`：醒在廂型車的後廂，少了一兩件義體；可以付錢買回、搶回，或放棄。
- **登場**：`$a` 攤主（`en_strp_boss`）；`$b` 拆件師傅（`en_strp_cutter`，男性）；`$c` 冰桶司機（`en_strp_driver`）。
- **被拆的規則**：拆體客挑最值錢的一兩件（照 `grade` 與牌子排序，有授權鎖的排後面），`item −1～2（裝在身上的義體）`；拿走的東西寫進 `flag stripped_parts`，在這一筆與 `df_stripped_rustladder` 裡可以買回。不描寫拆的過程：主角醒來時事情已經結束，那個位置貼著一塊醫療膠帶，`lock` 的效果代表那附近的義體暫時不聽使喚。

##### default

**開場**：你在一輛廂型車的後廂醒來，身下墊著一張防水布，旁邊擺著三個貼滿貼紙的醫療冰桶，其中一個貼著你的名字。你的左手抬不起來，那個位置貼著一塊乾淨的醫療膠帶，原本裝在那裡的東西不見了。

- **被拆**：`item −1～2（裝在身上的義體）`、`lock 相鄰的義體 6 小時`、`sink +1`。
- **第一段：攤主**。攤主坐在車門邊，戴著頭燈翻一本手寫的帳，說貨已經收了，你這個人她們不要，天亮前會把你放在路邊。拆件師傅蹲在你旁邊，用放大鏡片看你身上剩下的接口，看得很久。
  - 「問她多少錢能買回來。」交涉 DC 13。成功：開價是那件義體二手價的一半，進第二段，帶著價錢。失敗：開價是全價，進第二段。
  - 「趁她們不注意，把冰桶搶回來。」格鬥 DC 19。大成功：冰桶和車鑰匙都在你手上，`item +1～2（拆走的義體，要改造師裝回去）`、`hostility strippers +3`，事件結束。成功：搶到一個冰桶，`item +1（拆走的其中一件）`、`hostility strippers +2`，被丟下車。失敗：被麻醉槍打中，`time +4`，醒在路邊，事件結束。大失敗：同失敗，另 `item −1（再少一件）`。
  - 「拆件師傅一直在看你。」效果：進第二段的「讓他看」。
- **第二段：買回來**。攤主把帳本闔上，說錢可以談，她也收別的。拆件師傅說他想看看你的接口在動的時候是什麼樣子，看得夠了，零件就還你。
  - 「付錢。」need：現金 1,200 起（照義體的價格）。效果：`cash −（照價）`、`item +1～2（拆走的義體）`、`bill 改造師的裝回費用`。
  - 「讓他看。」效果：`item +1（拆走的其中一件）`、`tendency 戀物 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $b]] }`
  - 「讓他們兩個都看，換兩件。」need：拆走了兩件。效果：`item +2（拆走的義體）`、`fame 舊港 +2`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $a, $b]] }`
  - 「算了，走人。」效果：`time +2`、`move 舊港`；拿走的東西在三天內會出現在鏽梯的二手攤（`df_stripped_rustladder` 的第二段可以直接開）。

##### masc

**開場**：你在一輛廂型車的後廂醒來，左手抬不起來，那個位置貼著一塊醫療膠帶。攤主和冰桶司機兩個女人坐在車門邊數錢，冰桶司機把一個冰桶往你的方向踢了踢，說你的零件不錯，人也不錯。

- **被拆**：同 default。
- **第一段**：`inherit default.stages.0`，第三個選項改成「冰桶司機一直在看你。」
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：攤主把帳本闔上，說錢可以談，她也收別的；冰桶司機已經爬進後廂，跨坐在你身上，說先驗貨。
  - 「讓她看。」`adult_scene`：`{ circles: [[$pc, $c]], start_position: pos_pinned_under }`
  - 「讓她們兩個都看，換兩件。」`adult_scene`：`{ circles: [[$pc, $a, $c]] }`

##### yuri

**開場**：你在一輛廂型車的後廂醒來，攤主跪坐在你旁邊，頭燈的光打在你身上的醫療膠帶上；她一邊用掃描器讀你剩下的義體序號，一邊用另一隻手摸過那些接口。

- **被拆**：同 default。
- **第一段**：`inherit default.stages.0`，第三個選項改成「攤主的手一直沒有拿開。」
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：攤主關掉掃描器，說她收藏的不只是零件，她想看你的接口在她手上會有什麼反應；看得夠了，零件就還你。
  - 「讓她看。」`adult_scene`：`{ circles: [[$pc, $a]] }`
  - 「讓她們兩個都看，換兩件。」`adult_scene`：`{ circles: [[$pc, $a, $c]] }`

---

### 鏽梯的二手攤（`df_stripped_rustladder`）

- **kind**：`stripped`
- **factions**：`strippers`（看貨人帶隊，或在蜂巢、鏽梯打輸時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:戀物`
- **fails_commission**：true
- **fallback**：`df_stripped_rustladder_plain`：醒在樓梯間少了一兩件義體，隔天在二手攤用錢、偷或交涉拿回來。
- **登場**：`$a` 看貨人（`en_strp_picker`，男性）；`$b` 攤主（`en_strp_boss`）；`$c`（yuri）冰桶司機（`en_strp_driver`）。
- **被拆的規則**：同 `df_stripped_oldport_van`。

##### default

**開場**：你在鏽梯一段沒有燈的樓梯間醒來，背靠著牆，右腳的感覺接不上，那裡貼著一塊醫療膠帶。你的口袋裡塞了一張手寫的卡片，上面是一個攤位的編號和「明晚開市」四個字。

- **被拆**：`item −1～2（裝在身上的義體）`、`lock 相鄰的義體 8 小時`、`sink +1`。
- **第一段：樓梯間**。卡片背面還有一行字：零件不會等太久。樓梯上面傳來腳步聲，看貨人沒有走遠，他拿著一個夾鏈袋下來，說剛才忘了拍你的接口。
  - 「讓他拍。」效果：`flag stripped_discount`（明晚的價錢打七折）、`flag stripped_photos`（你的接口照會在拆體客的群組裡流傳）。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「把他嚇走。」威嚇 DC 16。成功：他把夾鏈袋丟下就跑，袋子裡是你的其中一件，`item +1`。失敗：他說你現在這個樣子沒什麼好怕的。`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「拖著腳先回家。」運動 DC 13。成功：`time +2`，回到據點。失敗：`time +4`、`hp −4`。
- **第二段：開市**（第二天夜晚，`time` 推到夜晚）。鏽梯的二手攤點著一排小燈，攤主坐在一堆冰桶後面，你的義體擺在最前面，標籤上寫著二手、無殘響、原主健在。
  - 「付錢買回來。」need：現金照價（有 `flag stripped_discount` 時七折）。效果：`cash −（照價）`、`item +1～2`、`bill 改造師的裝回費用`。
  - 「趁人多偷回來。」隱匿 DC 16。大成功：兩件都拿回來，沒人發現。成功：拿回一件，`hostility strippers +2`。失敗：被攤主抓住手腕，進「跟攤主談」。大失敗：`hostility strippers +3`，看貨人叫人。
  - 「跟攤主談。」交涉 DC 16。成功：她說原主健在的貨不好賣，算你一半，`cash −（半價）`、`item +1～2`。失敗：她說錢不夠可以用別的補，看貨人在旁邊點頭；`item +1～2`。`adult_scene`：`{ when: fail, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $a, $b]] }`
  - 「不要了，去找改造師換新的。」效果：`bill 改造師 +（新件的錢）`，`flag stripped_parts` 留著（之後在別人身上遇到那件義體）。

##### masc

**開場**：你在鏽梯的樓梯間醒來，右腳的感覺接不上，口袋裡塞著一張攤位的卡片。樓梯口站著攤主，她沒有走，正用頭燈照著你的臉，說你醒得比她想的快。

- **被拆**：同 default。
- **第一段**：`inherit default.stages.0`，看貨人換成攤主 `$b`；「讓她拍。」的 `circles`：`[[$pc, $b]]`；「把她嚇走」失敗的 `circles`：`[[$pc, $b]]`。
- **第二段**：`inherit default.stages.1`，換掉：「跟攤主談」失敗時，攤主叫冰桶司機把攤子顧好，自己把你帶進攤位後面的帆布棚。`adult_scene`：`{ circles: [[$pc, $b]], start_position: pos_pinned_under }`

##### yuri

**開場**：你在鏽梯的樓梯間醒來，冰桶司機坐在上一階，連帽外套的帽子拉得很低，正在把你口袋裡的卡片塞好。她說攤主叫她看著你，免得你被別人撿走。

- **被拆**：同 default。
- **第一段**：`inherit default.stages.0`，看貨人換成冰桶司機 `$c`；兩個成人分支的 `circles`：`[[$pc, $c]]`。
- **第二段**：`inherit default.stages.1`，換掉：「跟攤主談」失敗時，攤主和冰桶司機一起把你帶到帆布棚裡。`adult_scene`：`{ circles: [[$pc, $b, $c]] }`

---

### 傳教所的祓禊（`df_unbridged_mission`）

- **kind**：`unbridged`
- **factions**：`bare`（大祓巫女帶隊，或在鏽帶傳教所附近打輸時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:禁慾`、`tendency:聲音`
- **fails_commission**：true
- **fallback**：`df_unbridged_mission_plain`：在傳教所被拔橋，聽一夜的祓詞，天亮放人；照樣擲「真的被救」。
- **登場**：`$a` 大祓巫女（`en_bare_high`）；`$b` 持鈴巫女（`en_bare_bell`）；`$c`（default）灰袍信徒（`en_bare_acolyte`，男性）。
- **拔橋的規則**：`condition 拔橋（所有需要橋的能力、技能與裝備失效，直到找改造師重裝；重裝是一筆帳單）`、`bill 改造師的重裝費用`。**真的被救**：第二段的定力檢定大成功時 `flag unbridged_saved`：渴癮清除，身上的契約失效（LEWD_SYSTEM 7.6 節），重裝之後橋參數不回到原本的數字，從頭慢慢長。

##### default

**開場**：你在一間刷成白色的房間裡醒來，身上只剩一件素衣，後頸的橋口被一塊浸過藥水的白紙封住，摸起來是冷的。房間正中央放著一個裝滿水的木桶，大祓巫女跪坐在桶邊，持鈴巫女在門口一下一下地搖鈴。

- **拔橋**：`condition 拔橋`、`bill 改造師的重裝費用`。
- **第一段：禊**。大祓巫女說橋拔了，身體還記得，要用水把它洗掉；她叫灰袍信徒扶你進桶裡，信徒的手很穩，眼睛一直看著地上。
  - 「照她說的做。」效果：`load −10`（橋被封住，感載慢慢退）。巫女們念祓詞，信徒用水一瓢一瓢澆在你身上，他們不准你自己碰自己，也不准你閉上眼睛。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`（這一場以禁慾的動作為主：碰、停、等，不給結束）。
  - 「念出自己的名字，拒絕。」定力 DC 16。成功：大祓巫女點頭，說記得自己名字的人才洗得乾淨，她只讓你自己進桶；`time +4`，進第二段。失敗：鈴聲變急，`load +8`，效果同「照她說的做」。
  - 「趁換水時跑。」隱匿 DC 16。成功：`move 鏽帶`、`time +2`，事件結束；`condition 拔橋` 照樣在。失敗：在走廊被持鈴巫女攔住，鈴聲直接打進你的腦子裡，`load +10`，回到這一段。
- **第二段：最後一段祓詞**。天快亮時，大祓巫女坐到你面前，說最後一段要你自己跟著念；念完了，你可以走。
  - 「跟著念。」定力 DC 19。大成功：念到最後一個字，你發現那股一直在的癢不見了，`flag unbridged_saved`、`memory $a 最後一段祓詞`。成功：`sink −2`、`favor bare +1`。失敗：念到一半就想起橋接上去的感覺，`sink +1`。大失敗：同失敗，持鈴巫女多搖了一輪鈴，`load +10`。
  - 「不念，等天亮。」效果：`time +2`、`move 鏽帶`。
  - 「問她為什麼要拔別人的橋。」調查 DC 13。成功：她說了一段大潮崩那年的事，`flag bare_history`、`memory $a`。失敗：她只說你以後會懂。兩者都 `time +2`、`move 鏽帶`。

##### masc

**開場**：你在一間刷成白色的房間裡醒來，身上只剩一件素衣，後頸的橋口被一張白紙封住。大祓巫女跪坐在木桶邊，持鈴巫女在門口搖鈴，兩個人都沒有看你的臉。

- **拔橋**：同 default。
- **第一段**：`inherit default.stages.0`，換掉：扶你進桶的是持鈴巫女；「照她說的做」的 `circles`：`[[$pc, $a, $b]]`。
- **第二段**：`inherit default.stages.1`。

##### yuri

**開場**：你在一間刷成白色的房間裡醒來，大祓巫女正用一塊白布替你擦臉，她的長髮垂下來落在你的肩上，用白紙束著的那一段很涼。

- **拔橋**：同 default。
- **第一段**：`inherit default.stages.0`，換掉：只有大祓巫女一個人陪你進桶，持鈴巫女在門外搖鈴；「照她說的做」的 `circles`：`[[$pc, $a]]`。
- **第二段**：`inherit default.stages.1`。

---

### 白木盒（`df_unbridged_roadside`）

- **kind**：`unbridged`
- **factions**：`bare`（拔橋手在場時；鏽帶的路上、鏽帶與蜂巢的交界）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:禁慾`、`tendency:束縛`
- **fails_commission**：true
- **fallback**：`df_unbridged_roadside_plain`：拔橋手在路邊拔了你的橋，信徒們把你送到傳教所門口，留一張寫了祓詞的紙。
- **登場**：`$a` 拔橋手（`en_bare_puller`）；`$b` 灰袍信徒（男性，兩位）；`$c`（yuri）持鈴巫女。
- **拔橋的規則**：同 `df_unbridged_mission`；真的被救改成第二段「守夜」的定力大成功。

##### default

**開場**：你在一輛手推車上醒來，手腳用麻繩綁著，車輪在碎石路上一顛一顛，兩個灰袍信徒在前面推。拔橋手走在旁邊，手上捧著一個白木盒，盒子裡是剛剛從你後頸拿出來的東西。

- **拔橋**：`condition 拔橋`、`bill 改造師的重裝費用`；白木盒裡裝的是橋的接頭，橋本體還在你身上，改造師可以重裝。
- **第一段：路上**。拔橋手說她們沒有要害你，只要你在沒有橋的身體裡待一晚，看看那是什麼感覺。
  - 「求她把盒子還你。」交涉 DC 16。成功：她說天亮就還，`flag bare_box_returned`（重裝的帳單減半）。失敗：她把盒子抱得更緊。
  - 「掙開麻繩。」運動 DC 16。成功：滾下手推車，`move 鏽帶`、`time +2`，盒子沒拿到，事件結束。失敗：信徒把你綁得更緊，說束縛是為了你好，進第二段。
  - 「安靜下來，聽她說。」效果：`load −6`，進第二段。
- **第二段：守夜**。手推車停在一間路邊的小祠堂，拔橋手說有橋的人一個晚上會想要很多東西，信徒會守著你，讓你一樣也拿不到。兩個信徒跪在你的兩側，按住你的手。
  - 「撐到天亮。」定力 DC 19。大成功：天亮的時候你發現自己真的什麼也不想要，`flag unbridged_saved`、`flag bare_box_returned`。成功：`sink −2`、`flag bare_box_returned`。失敗：`sink +1`。四種結果都 `adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $b]] }`（禁慾與束縛的動作：守住、不給）。
  - 「讓他們守，自己數呼吸。」效果：`load −10`、`flag bare_box_returned`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b]] }`
  - 「趁信徒打瞌睡溜走。」隱匿 DC 16。成功：`move 鏽帶`、`time +4`，盒子沒拿到。失敗：效果同「撐到天亮」的失敗。

##### masc

**開場**：你在一輛手推車上醒來，手腳用麻繩綁著，拔橋手坐在車沿上，膝蓋上放著白木盒，用戴著手術手套的手指一下一下敲著盒蓋。

- **拔橋**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：守夜的是拔橋手和持鈴巫女，兩個人一左一右跪在你身邊，鈴聲每隔一陣響一次；三個選項的 `circles`：`[[$pc, $a, $c]]`。

##### yuri

**開場**：你在一輛手推車上醒來，拔橋手走在旁邊，持鈴巫女坐在車上，讓你的頭枕在她的腿上；她搖鈴的手很輕，鈴聲聽起來像在哄人睡覺。

- **拔橋**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：守夜的是持鈴巫女一個人；「撐到天亮」的 `circles`：`[[$pc, $c]]`；「讓他們守」改成「讓她守」，`circles`：`[[$pc, $a, $c]]`。

---

### 巷子裡的認錯（`df_lesson_tokko`）

- **kind**：`lesson`
- **factions**：`tokko`
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:御姐`、`tendency:支配`、`tendency:痛`
- **fails_commission**：true
- **fallback**：`df_lesson_tokko_plain`：被打一頓、跪著認錯、罰錢，一週內不准進那條巷子。
- **登場**：`$a` 特攻隊長（`en_tokko_captain`）；`$b` 特攻隊員（`en_tokko_member`）；`$c` 後輩（`en_tokko_kohai`）；`$d`（default）機車行的老闆，男性，特攻姬的贊助人。
- **禁足**：`flag tokko_banned_7d`：七天內進這條巷子，特攻姬的人一定找上來（開一場 `fight`）。

##### default

**開場**：你在櫻町一條巷子的鐵捲門前醒來，臉頰貼著柏油，特攻服的白色下襬在你眼前晃。特攻隊長蹲下來，用木刀的刀尖抬起你的下巴，說輸了就要認，這是巷子的規矩。

- **第一段：認不認**。後輩嚼著口香糖在旁邊拍照，隊員們圍成半圈。
  - 「認錯。」效果：`cash −400`、`flag tokko_banned_7d`、`rep −1`；隊長說好，下次別讓她看到你，事件結束。
  - 「不認。」定力 DC 16。成功：隊長笑了，說這個有骨氣，進第二段。失敗：木刀落在你的背上，`hp −6`，進第二段。
  - 「要求一騎打。」格鬥 DC 19。大成功：你打掉她的木刀，巷子裡安靜了；`favor tokko +3`、`rep +2`、不罰錢也不禁足，`memory $a 一騎打`。成功：打平，她收刀，`favor tokko +1`、`flag tokko_banned_7d`。失敗：`hp −8`，進第二段。大失敗：`hp −10`、`condition 瘀傷（一天）`，進第二段。
- **第二段：教育**。隊長站起來，說不肯認錯的人要教到認為止；她叫人把鐵捲門拉起來，裡面是一間機車行，老闆從櫃台後面抬起頭，說用他的地方要算他一份。
  - 「讓她教。」效果：`flag tokko_banned_7d`、`fame 櫻町 +2`、`favor tokko +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: obey, circles: [[$pc, $a, $d]] }`
  - 「在這裡認錯。」效果：`cash −600`、`flag tokko_banned_7d`，隊長說晚了，加錢；事件結束。
  - 「跟她說你只認她一個人。」誘惑 DC 16。成功：她把其他人趕出去，拉下鐵捲門，`affinity $a +3`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: obey, circles: [[$pc, $a]] }`。失敗：她說你沒資格挑，效果同「讓她教」。

##### masc

**開場**：你在櫻町一條巷子的鐵捲門前醒來，臉頰貼著柏油，特攻隊長的靴子踩在你的背上，後輩蹲在你面前吹出一個泡泡。隊長說男人輸給女人，要認得更大聲。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：隊長叫人把鐵捲門拉起來，裡面是她們的據點，牆上掛著隊旗；她坐在一台重機的座墊上，叫隊員和後輩把你按跪在她面前。
  - 「讓她教。」`adult_scene`：`{ circles: [[$pc, $a, $b, $c]], start_position: pos_from_behind }`
  - 「跟她說你只認她一個人。」失敗的 `circles`：`[[$pc, $a, $b, $c]]`。

##### yuri

**開場**：你在櫻町一條巷子的鐵捲門前醒來，特攻隊長蹲在你面前，把你的頭髮從臉上撥開，說長得這麼好看還來找麻煩，可惜了。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：隊長叫人把鐵捲門拉起來，裡面是她們的據點；她把木刀插回腰帶，叫後輩在門口看著，自己解開了特攻服的前襟。
  - 「讓她教。」`adult_scene`：`{ circles: [[$pc, $a, $c]] }`
  - 「跟她說你只認她一個人。」成功的 `circles`：`[[$pc, $a]]`；失敗的：`[[$pc, $a, $c]]`。

---

### 糖罐的後間（`df_lesson_honey`）

- **kind**：`lesson`
- **factions**：`honey`
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:御姐`、`tendency:溺愛`、`tendency:群與融合`
- **fails_commission**：true
- **fallback**：`df_lesson_honey_plain`：被帶到糖罐的後間訓話、賠錢給被你打擾到的店家，一週內不准在那條街鬧事。
- **登場**：`$a` 糖罐的保鑣長（`en_honey_head`）；`$b` 舞廳的姐妹（`en_honey_dancer`）；`$c` 糖衣保鑣（`en_honey_bouncer`）；`$d`（default）被你打擾到的熟客，男性。
- **禁足**：`flag honey_banned_7d`：七天內在四十二番街的那條街上動手，蜜糖會的敵對值 +5。

##### default

**開場**：你在四十二番街的糖罐後間醒來，躺在一張絨布沙發上，額頭敷著一條冰毛巾，姐妹們圍著你，香水的味道很濃。保鑣長坐在對面的扶手上，說你剛才在她的街上打壞了一間店的招牌，還嚇跑了一位熟客。

- **第一段：訓話**。保鑣長說蜜糖會不追著人打，但打過了就要學。
  - 「道歉，賠錢。」效果：`cash −800`、`flag honey_banned_7d`、`favor honey +1`；事件結束。
  - 「說你是被逼的。」交涉 DC 16。成功：她聽完，說下次先來找她，`cash −400`、`flag honey_banned_7d`，事件結束。失敗：她說理由誰都有，進第二段。
  - 「說你賠不起。」效果：進第二段。
- **第二段：賠罪**。被你嚇跑的那位熟客回來了，坐在沙發的另一頭。保鑣長說錢賠不起，就把他今晚沒玩到的補給他；姐妹們會在旁邊看著，免得你又亂來。
  - 「好好賠罪。」誘惑 DC 13。大成功：熟客很高興，替你付了招牌錢，`flag honey_banned_7d`、`fame 四十二番街 +3`、`favor honey +2`。成功：`flag honey_banned_7d`、`fame 四十二番街 +2`。失敗：`flag honey_banned_7d`、`cash −200`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: worker, goal: please, circles: [[$pc, $d], [$b]] }`（姐妹在第二圈看著，可以加入）。
  - 「拜託保鑣長換一種罰法。」誘惑 DC 16。成功：她把熟客請出去，自己來；`affinity $a +3`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: obey, circles: [[$pc, $a]] }`。失敗：她說她的妹妹們也想看你學乖，`adult_scene`：`{ when: fail, gate: fixed, nature: forced, role: none, goal: obey, circles: [[$pc, $a, $b, $c]] }`。
  - 「跑。」運動 DC 16。成功：`hostility honey +3`、`move 四十二番街`。失敗：糖衣保鑣的電擊鞭捲住你的腳，`load +10`，回到這一段。

##### masc

**開場**：你在糖罐後間的絨布沙發上醒來，手腕被一條粉紅緞帶綁在扶手上，保鑣長坐在你的大腿上，用電擊鞭的握柄抬起你的臉。她說打壞她街上的東西的男人，她都會親自教。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：保鑣長說錢賠不起，就換她的妹妹們今晚少賺的那一份；舞廳的姐妹和糖衣保鑣一左一右坐到沙發上。
  - 「好好賠罪。」`adult_scene`：`{ nature: forced, role: none, goal: please, circles: [[$pc, $a, $b, $c]] }`
  - 「拜託保鑣長換一種罰法。」成功的 `circles`：`[[$pc, $a]]`；失敗的：`[[$pc, $a, $b, $c]]`。

##### yuri

**開場**：你在糖罐後間的絨布沙發上醒來，頭枕在保鑣長的腿上，她正用冰毛巾擦你的額頭，嘆了一口氣說：打架打成這樣，姐姐要怎麼罰你才好。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：保鑣長說錢賠不起不要緊，今晚你留在姐妹這裡，讓大家教你蜜糖會的規矩。
  - 「好好賠罪。」`adult_scene`：`{ nature: forced, role: none, goal: obey, circles: [[$pc, $a, $b]] }`
  - 「拜託保鑣長換一種罰法。」成功的 `circles`：`[[$pc, $a]]`，另 `affinity $a +4`；失敗的：`[[$pc, $a, $b, $c]]`。

---

### 劇場後巷的同擔（`df_lesson_guard_underground`）

- **kind**：`lesson`
- **factions**：`guard`（地下偶像的親衛隊）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:群與融合`、`tendency:聲音`
- **fails_commission**：true
- **fallback**：`df_lesson_guard_underground_plain`：被押著對推的海報鞠躬道歉、罰買一疊應援周邊，一週內不准靠近那間劇場。
- **登場**：`$a` 地下親衛隊長（`en_grd_undercap`，男性）；`$b` 同擔（男性，兩到三位）；`$c` 應援指揮（`en_grd_caller`，女性）。
- **禁足**：`flag guard_banned_7d`：七天內進那間劇場的周邊，同擔會圍上來（開一場 `fight`）。

##### default

**開場**：你在櫻町一間地下劇場的後巷醒來，背靠著貼滿公演海報的牆，臉上被人畫了兩道應援色的油彩。地下親衛隊長站在你面前，手上拿著一件推的法被，說你打擾了今晚的公演，要用推的方式道歉。

- **第一段：道歉**。同擔們舉著螢光棒，把你圍在海報前面。
  - 「對海報鞠躬道歉。」效果：`cash −300`（罰買周邊，`item 應援周邊一疊`）、`flag guard_banned_7d`；事件結束。
  - 「說你也是她的粉絲。」表演 DC 13。大成功：你把今晚的歌一首一首唱出來，同擔們跟著打 call，隊長把法被披在你身上，`favor guard +2`、不禁足。成功：`cash −300`、不禁足。失敗：隊長說假粉比路人更可惡，進第二段。
  - 「罵回去。」威嚇 DC 16。成功：同擔們退了一步，`hostility guard +2`、`flag guard_banned_7d`，事件結束。失敗：進第二段。
- **第二段：穿上法被**。隊長把法被丟給你，叫你穿上，說今晚推沒能做完的見面會，由你替她做完；同擔們排成一列，手上的螢光棒一閃一閃。
  - 「穿上，做完見面會。」效果：`flag guard_banned_7d`、`fame 櫻町 +2`、`tendency 群與融合 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: please, circles: [[$pc, $a, $b]] }`
  - 「只陪他們握手、唱一首。」表演 DC 16。成功：同擔們心滿意足地散了，`flag guard_banned_7d`、`fame 櫻町 +1`。失敗：有人說握手不夠，效果同「穿上，做完見面會」。
  - 「叫應援指揮管管她的人。」交涉 DC 16。成功：她拿擴音器喊了一聲，所有人立正，`cash −300`、`flag guard_banned_7d`。失敗：她說她的人想要什麼她都會給，`adult_scene`：`{ when: fail, gate: ai, nature: forced, role: none, goal: please, circles: [[$pc, $a, $b, $c]] }`。

##### masc

**開場**：你在地下劇場的後巷醒來，臉上畫著應援色的油彩，應援指揮站在折疊椅上俯視你，擴音器垂在她的手邊。她說推今晚哭了，因為你。

- **第一段**：`inherit default.stages.0`，隊長的台詞改由應援指揮說。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：應援指揮把一件推的演出服丟給你，叫你穿上；她說推沒能做完的見面會由你來做，而她是今晚唯一的觀眾。
  - 「穿上，做完見面會。」`adult_scene`：`{ circles: [[$pc, $c]] }`，`$c` 的口號經過擴音器打進你的橋（聲音）。
  - 「叫應援指揮管管她的人。」改成「叫隊長管管她。」，失敗的 `circles`：`[[$pc, $c]]`。

##### yuri

**開場**：你在地下劇場的後巷醒來，應援指揮跪在你面前，用手指把你臉上的油彩抹勻，說這個顏色很適合你。

- **第一段**：`inherit default.stages.0`，隊長的台詞改由應援指揮說。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：應援指揮把同擔們趕回劇場，讓你穿上推的演出服，說她想看你站在推的位置上。
  - 「穿上，做完見面會。」`adult_scene`：`{ circles: [[$pc, $c]] }`
  - 「叫應援指揮管管她的人。」失敗的 `circles`：`[[$pc, $c]]`。

---

### 收視高峰（`df_exposed_kaleido_stage`）

- **kind**：`exposed`
- **factions**：`kaleido`（直播導演在場，或在四十二番街上城、冠冕區的球體打輸時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:暴露`★、`tendency:窺視`
- **fails_commission**：true
- **fallback**：`df_exposed_kaleido_stage_plain`：被綁在棚裡的椅子上，臉被打光、被直播二十分鐘，片段被剪成「邊緣行者落網」的節目片頭；豔名照加，公信力照扣。
- **登場**：`$a` 直播導演（`en_kd_director`）；`$b` 演員・反派人設（`en_kd_villain`）；`$c`（default）棚內保全（`en_kd_studio_guard`，男性）。
- **曝光的規則**：公信力的增減不在 EVENTS 2.4 節的清單裡，這裡寫成 `flag exposed_kaleido`，由媒體系統讀這個旗標扣公信力（−5；第二段「搶下片子」成功時 −2）。相關勢力（這一場委託的目標或雇主）的敵對值照 `hostility`。

##### default

**開場**：你在一座攝影棚的正中央醒來，三盞燈同時打在你身上，熱得睜不開眼睛；你坐在一張綁著皮帶的道具椅上，牆上的螢幕寫著「現在直播中」。直播導演站在鏡頭後面，單邊的全息眼鏡上開著十幾個畫面，她說收視正在往上爬。

- **第一段：開播**。導演對耳麥說切近景，演員走進燈裡，披風一甩，對著鏡頭念出你的名字和你剛才做的事。
  - 「對鏡頭演下去。」表演 DC 16。大成功：你接住她的台詞，整場變成你的戲；`fame 四十二番街 +5`、`footage 1 段（你可以拿去用）`，公信力不扣，進第二段的「搶下片子」直接成功。成功：`fame 四十二番街 +4`、`flag exposed_kaleido`，進第二段。失敗：`fame 四十二番街 +3`、`flag exposed_kaleido`，進第二段。大失敗：你在鏡頭前說了不該說的話，另 `hostility（這一場的目標勢力） +3`。
  - 「低頭，不讓鏡頭拍到臉。」定力 DC 13。成功：`fame 四十二番街 +2`、`flag exposed_kaleido`，導演嘖了一聲，進第二段。失敗：棚內保全扳起你的下巴，`fame 四十二番街 +3`，進第二段。
  - 「罵導演。」威嚇 DC 16。成功：這一段反而變成當晚的亮點，`fame 四十二番街 +4`、`flag exposed_kaleido`、`hostility kaleido +1`。失敗：同成功，導演另外剪了一段你被按回椅子的畫面。兩者都進第二段。
- **第二段：加戲**。導演看著收視的數字，說還差一點；她叫保全解開你一隻手的皮帶，演員把麥克風貼在你的嘴邊，說最後一場戲觀眾想看的是什麼，你自己也知道。
  - 「演完最後一場。」效果：`fame 四十二番街 +5`、`flag exposed_kaleido`、`tendency 暴露 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: footage, circles: [[$pc, $b, $c]] }`（場景全程在直播，觀眾的留言由 AI 寫進敘事）。
  - 「搶下導演的平板，切掉直播。」介面 DC 19。大成功：直播斷了，你帶著平板裡的原檔走，`footage 1 段`、`hostility kaleido +3`、公信力只扣 2。成功：直播斷了，`hostility kaleido +2`、公信力只扣 2，`move 四十二番街`。失敗：保全按住你，導演說這一段收視最好，效果同「演完最後一場」。
  - 「跟導演談分成。」交涉 DC 16。成功：她說你有做這一行的料，片子照播，你拿三成，`cash +1200`、`fame 四十二番街 +4`、`flag exposed_kaleido`、`roster_add $a`；`adult_scene`：`{ when: success, gate: ai, nature: work, role: worker, goal: footage, circles: [[$pc, $b]] }`。失敗：她說分成要看你值多少，效果同「演完最後一場」。

##### masc

**開場**：你在攝影棚的正中央醒來，綁在一張道具椅上，燈光打得你睜不開眼睛；反派人設的演員坐在你的膝蓋上，披風蓋住了你們兩個，她對鏡頭說今晚的俘虜是一位很有看頭的先生。

- **第一段**：`inherit default.stages.0`，保全換成替身保全（`en_kd_double`，女性）。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：導演說還差一點，演員把你的臉轉向鏡頭，替身保全從另一邊解開你的襯衫。
  - 「演完最後一場。」`adult_scene`：`{ circles: [[$pc, $b, $c]] }`，`$c` 換成替身保全。
  - 「跟導演談分成。」成功的 `circles`：`[[$pc, $b]]`。

##### yuri

**開場**：你在攝影棚的正中央醒來，導演本人站在你面前，把無人攝影機拉到你的臉旁邊；她說你的反應很好，今晚的鏡頭只給你。

- **第一段**：`inherit default.stages.0`，保全換成替身保全（女性）。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：導演把耳麥交給助理，自己走進燈裡，演員在另一邊扶著你的肩膀；導演說最後一場她要親自掌鏡。
  - 「演完最後一場。」`adult_scene`：`{ circles: [[$pc, $a, $b]] }`
  - 「跟導演談分成。」成功的 `circles`：`[[$pc, $a]]`。

---

### 透明盾上的照片（`df_exposed_guard_corps`）

- **kind**：`exposed`
- **factions**：`guard`（公司偶像的親衛隊）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:暴露`★、`tendency:群與融合`
- **fails_commission**：true
- **fallback**：`df_exposed_guard_corps_plain`：被綁在透明盾後面拍照，照片貼在粉絲板上，標題是「攻擊推的人」；豔名照加，公信力照扣，偶像東家的敵對值上升。
- **登場**：`$a` 親衛隊長（`en_grd_captain`，女性）；`$b` 公司親衛隊員（`en_grd_corps`，男性，兩到三位）；`$c`（yuri）應援指揮（`en_grd_caller`）。
- **曝光的規則**：同 `df_exposed_kaleido_stage`，旗標是 `flag exposed_guard`（公信力 −4）；`hostility （偶像的東家） +2`。

##### default

**開場**：你在櫻町劇場的地下停車場醒來，手腕被束帶綁在一面印著偶像照片的透明盾上，盾牌立在一根柱子前面。親衛隊長拿著平板走過來，說粉絲板上已經有三千人在等你的照片。

- **第一段：拍照**。隊員們舉著終端機排成半圈，閃光燈一下一下地亮。
  - 「轉過頭不讓他們拍。」定力 DC 13。成功：拍到的都是後腦勺，`fame 櫻町 +1`、`flag exposed_guard`，進第二段。失敗：`fame 櫻町 +3`、`flag exposed_guard`，進第二段。
  - 「說你是被雇來的，報出雇主。」交涉 DC 13。成功：隊長把照片換成了雇主的名字，`flag exposed_guard` 不立、`hostility （雇主的勢力） +3`、`rep −2`（不問是誰的行規），事件結束。失敗：她說名字她會查，照片照發，進第二段。
  - 「對著鏡頭笑。」表演 DC 16。成功：照片在粉絲板上變成一個梗，`fame 櫻町 +4`、`flag exposed_guard`，公信力只扣 2。失敗：`fame 櫻町 +3`、`flag exposed_guard`。兩者都進第二段。
- **第二段：會員限定**。隊長說公開版已經發了，會員限定版要更好的照片；隊員們把盾牌放平，把你按在上面，偶像的笑臉就在你的臉旁邊。
  - 「讓他們拍。」效果：`fame 櫻町 +4`、`tendency 暴露 +1`、`footage 1 段（在他們手上，`flag guard_photos`）`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: footage, circles: [[$pc, $b]] }`
  - 「跟隊長說會員版你自己拍給她。」誘惑 DC 16。成功：她把隊員趕去巡場，只留下平板，`affinity $a +3`；`adult_scene`：`{ when: success, gate: ai, nature: trade, role: none, goal: footage, circles: [[$pc, $a]] }`。失敗：她說好啊，大家一起看你拍，效果同「讓他們拍」，`circles`：`[[$pc, $a, $b]]`。
  - 「掙開束帶。」運動 DC 19。成功：`move 櫻町`、`hostility guard +2`。失敗：效果同「讓他們拍」。

##### masc

**開場**：你在劇場的地下停車場醒來，手腕綁在一面透明盾上，親衛隊長坐在引擎蓋上蹺著腿，衝鋒槍橫放在膝蓋上。她說推的會員裡女粉很多，她們今晚想看你。

- **第一段**：`inherit default.stages.0`，拍照的人換成女性的隊員。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：隊長從引擎蓋上下來，把平板交給應援指揮，說會員限定版由她親自出鏡。
  - 「讓他們拍。」改成「讓她們拍。」，`circles`：`[[$pc, $a, $c]]`，`start_position: pos_lap`。
  - 「跟隊長說會員版你自己拍給她。」失敗的 `circles`：`[[$pc, $a, $c]]`。

##### yuri

**開場**：你在劇場的地下停車場醒來，手腕綁在一面透明盾上，應援指揮正用一條應援毛巾替你擦臉，說髒髒的拍起來不好看。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：隊長把隊員都趕出停車場，只留下應援指揮掌鏡；她解開你的一隻手，讓你自己扶著盾牌的邊。
  - 「讓他們拍。」改成「讓她們拍。」，`circles`：`[[$pc, $a, $c]]`。
  - 「跟隊長說會員版你自己拍給她。」失敗的 `circles`：`[[$pc, $a, $c]]`。

---

### 狗仔的獨家（`df_exposed_paparazzi`）

- **kind**：`exposed`
- **factions**：`kaleido`（只有狗仔與棚內保全的小隊，I～II 級）
- **tags**：`female_partner`、`male_partner`、`tendency:窺視`、`tendency:暴露`
- **fails_commission**：true
- **fallback**：`df_exposed_paparazzi_plain`：狗仔拿著照片開價；付錢買下記憶卡，或照片照發。
- **登場**：`$a` 狗仔（`en_kd_paparazzi`，男性）；`$b`（masc、yuri）萬華鏡的女記者，II 級的街坊，帶著一台無人機。
- 這一筆沒有非自願的分支，`pc_unwilling` 關掉時照樣出現。
- **曝光的規則**：同 `df_exposed_kaleido_stage`，旗標是 `flag exposed_paparazzi`（公信力 −3）。

##### default

**開場**：你在一條後巷的垃圾箱旁邊醒來，打倒你的人已經走了，只剩狗仔蹲在你面前換底片，三台相機在他的脖子上晃。他把一張剛印出來的照片舉到你眼前，問你想不想談談。

- **第一段：開價**。照片裡是你倒在地上的樣子，衣服被扯開了一半。
  - 「買下記憶卡。」need：現金 600。效果：`cash −600`、`flag exposed_paparazzi` 不立；事件結束。
  - 「搶過來。」格鬥 DC 13。成功：記憶卡在你手上，`hostility kaleido +1`。失敗：他跑了，照片照發，`fame 四十二番街 +3`、`flag exposed_paparazzi`；事件結束。
  - 「問他有沒有別的價錢。」效果：進第二段。
- **第二段：獨家**。狗仔說萬華鏡要的是故事，一張倒在地上的照片不值錢，一組你自己擺的照片值錢多了；拍完了，那張倒地的照片他當著你的面刪掉。
  - 「讓他拍一組。」效果：`fame 四十二番街 +3`、`cash +300`、`footage 1 段（給你一份）`、`flag exposed_paparazzi`（公信力只扣 1）。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: footage, circles: [[$pc, $a]] }`
  - 「拍可以，你要看他的帶子。」調查 DC 16。成功：你在他的相機裡找到一張他不該有的照片，`flag paparazzi_leverage`（之後可以用來壓他，或賣給相關的勢力）；他只好刪掉你的照片。失敗：他把相機收得更緊，回到這一段的其他選項。
  - 「說你不拍，照片隨他。」效果：`fame 四十二番街 +2`、`flag exposed_paparazzi`。

##### masc

**開場**：你在一條後巷的垃圾箱旁邊醒來，女記者蹲在你面前，無人機在她的頭頂嗡嗡地繞；她把一張照片翻過來給你看，說這張照片很可惜，你可以拍得更好。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「讓她拍一組」的 `circles`：`[[$pc, $b]]`，她一邊拍，一邊叫你照她說的姿勢擺。

##### yuri

**開場**：你在一條後巷的垃圾箱旁邊醒來，女記者坐在垃圾箱的蓋子上，晃著腳翻她的相機，說你倒下去的角度剛好，她幾乎捨不得刪。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「讓她拍一組」的 `circles`：`[[$pc, $b]]`。

---

### 品鑑會（`df_drained_banquet_tasting`）

- **kind**：`drained`
- **factions**：`banquet`（宴主在場，或在玻璃岸打輸時）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:支配`、`tendency:奪與被奪`、扮相 `哥德`
- **fails_commission**：true
- **fallback**：`df_drained_banquet_tasting_plain`：在玻璃岸的一間沙龍醒來，宴主用增幅器吸走你的一段感覺，錄成帶子，天亮放人。
- **登場**：`$a` 宴主（`en_bnq_host`，女性）；`$b` 黑派侍從（`en_bnq_attendant`；default 是男性，穿燕尾服）；`$c`（yuri）茶會主人（`en_bnq_hostess`）。
- **被吸的規則**：`condition 被吸（七天：敏感度 −10，餘韻沒有正面效果）`、`flag banquet_tape_sold`（那一段被錄成帶子，在玻璃岸與四十二番街的帶子街上賣；之後在媒體系統裡可以找到它）。

##### default

**開場**：你在一間點滿蠟燭的沙龍裡醒來，坐在一張高背的天鵝絨椅子上，手腕用黑色的緞帶綁在扶手上。長桌的另一頭，宴主正用銀匙攪一杯紅茶，左手的蕾絲手套底下接著一根細線，線的另一頭接在你的後頸上。

- **第一段：品鑑**。宴主說你身上的餘韻還很新鮮，今晚的客人都是為了這一口來的；黑派侍從站在你的椅子後面，戴著手套的手放在你的肩上。
  - 「讓她嚐。」效果：`condition 被吸`、`flag banquet_tape_sold`、`afterglow −（全清）`，進第二段。
  - 「用品味說服她，這一口不夠格。」表演 DC 16（宴主吃品味）。大成功：她放下茶杯，說你說得對，改天請你當客人；不吸、不錄，`favor banquet +2`、`memory $a 品味`，事件結束。成功：她只嚐了一小口，`condition 被吸` 改成三天、不錄帶子，事件結束。失敗：她說品味是她的事，進第二段。大失敗：她把線接得更深，`load +10`，進第二段。
  - 「說出她的真名。」need：`flag banquet_host_truename`。效果：她的手停了，說今晚到此為止，`favor banquet +1`、事件結束。
- **第二段：錄**。宴主說光是嚐不夠，要把你被吸走的樣子留下來；侍從解開一邊的緞帶，客人們在長桌邊坐好，蠟燭都移到你的周圍。
  - 「讓她錄。」效果：`fame 玻璃岸 +3`、`tendency 奪與被奪 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: footage, circles: [[$pc, $a, $b]] }`（場景裡宴主每回合從主角身上移走一層餘韻）。
  - 「要求分一份帶子的錢。」交涉 DC 19。成功：宴主說有品味的人懂得談生意，`cash +1500`；`adult_scene`：`{ when: success, gate: ai, nature: trade, role: none, goal: footage, circles: [[$pc, $a, $b]] }`。失敗：效果同「讓她錄」。
  - 「扯斷那根線。」格鬥 DC 16。成功：線斷了，宴主說你太失禮，`hostility banquet +3`、`flag banquet_tape_sold` 不立，侍從把你請出沙龍，`move 玻璃岸`。失敗：效果同「讓她錄」，另 `load +6`。

##### masc

**開場**：你在一間點滿蠟燭的沙龍裡醒來，綁在高背椅上，宴主就站在你身後，用細劍的劍背貼著你的喉結，另一隻手把線接到你的後頸。她說男人的餘韻她比較少嚐到，今晚要慢慢來。

- **第一段**：`inherit default.stages.0`，侍從換成女性。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：宴主坐到你的腿上，客人們圍著長桌，侍從替她托著燭台。
  - 「讓她錄。」`adult_scene`：`{ circles: [[$pc, $a, $b]], start_position: pos_lap }`
  - 「要求分一份帶子的錢。」成功的 `circles`：`[[$pc, $a]]`。

##### yuri

**開場**：你在一間點滿蠟燭的沙龍裡醒來，綁在高背椅上，茶會主人跪在你的椅子旁邊，替你整理被扯亂的衣襟；宴主在長桌的另一頭舉起茶杯，說女孩子的餘韻最好配大吉嶺。

- **第一段**：`inherit default.stages.0`，侍從換成茶會主人 `$c`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：宴主走到你面前，茶會主人撩起四層的襯裙坐到你身邊，兩個人一起替你解開緞帶。
  - 「讓她錄。」`adult_scene`：`{ circles: [[$pc, $a, $c]] }`
  - 「要求分一份帶子的錢。」成功的 `circles`：`[[$pc, $a, $c]]`。

---

### 甜派的茶會（`df_drained_sweet_teaparty`）

- **kind**：`drained`
- **factions**：`banquet`（茶會主人或甜派茶會客帶隊；四十二番街、櫻町）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:窺視`、`tendency:暴露`、扮相 `哥德`
- **fails_commission**：true
- **fallback**：`df_drained_sweet_teaparty_plain`：被留下來參加一場茶會，被吸走一段感覺，帶子賣掉；客人只是在旁邊喝茶。
- **登場**：`$a` 茶會主人（`en_bnq_hostess`）；`$b` 甜派茶會客（兩到三位）；`$c`（default）黑派侍從（男性）。茶會的人全部是成年人，蓬裙、蝴蝶結與熊玩偶只是打扮。
- **被吸的規則**：同 `df_drained_banquet_tasting`。

##### default

**開場**：你在一間粉白色的茶室裡醒來，身上被換了一件蓬裙洋裝，坐在一張擺滿蛋糕的圓桌邊，左右兩邊各坐著一位抱著熊玩偶的茶會客。茶會主人在桌子的另一頭替每個人倒茶，說今天的主客終於醒了。

- **第一段：主客**。茶會客們把洋傘靠在椅子邊，傘柄的緞帶垂在地上；你後頸接著一條粉紅色的線，線的另一頭繞在茶會主人的手指上。
  - 「陪她們喝茶。」交涉 DC 13。成功：茶會主人只抽了一點點，`condition 被吸` 改成三天、不錄帶子，`favor banquet +1`，事件結束。失敗：她說主客太客氣了，進第二段。
  - 「打翻桌子。」格鬥 DC 16。成功：蛋糕飛了一地，茶會客們尖叫著撐開洋傘，你跑出茶室，`hostility banquet +2`、`move （這一區）`。失敗：洋傘的感官彈打在你身上，`load +12`，進第二段。
  - 「乖乖坐著。」效果：`load −4`，進第二段。
- **第二段：大家一起看**。茶會主人說茶會的餘興節目是看主客被吸，客人們把椅子轉過來，熊玩偶的眼睛對著你；黑派侍從走到你身後，解開洋裝背後的緞帶。
  - 「讓她們看。」效果：`condition 被吸`、`flag banquet_tape_sold`、`fame （這一區） +3`、`tendency 窺視 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: footage, circles: [[$pc, $c], [$b]] }`（茶會客在第二圈看）。
  - 「說你要當主人，不當主客。」誘惑 DC 19。成功：茶會主人笑了，把線的那一頭交給你，`condition 被吸` 不觸發，`tendency 窺視 +1`；`adult_scene`：`{ when: success, gate: ai, nature: mutual, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「讓她們看」。
  - 「把線從後頸拔掉。」介面 DC 16。成功：`hostility banquet +1`，茶會主人說下次再請你；`condition 被吸` 改成三天。失敗：效果同「讓她們看」，另 `load +6`。

##### masc

**開場**：你在一間粉白色的茶室裡醒來，脖子上繫著一個大蝴蝶結，坐在一張圓桌的主位上，茶會客們抱著熊玩偶圍坐在旁邊，捂著嘴笑。茶會主人說今天的主客是一位先生，大家要特別照顧。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：茶會主人說餘興節目開始，她撩起裙擺跨坐到你的腿上，客人們把椅子轉過來。
  - 「讓她們看。」`adult_scene`：`{ circles: [[$pc, $a], [$b]], start_position: pos_lap }`
  - 「說你要當主人，不當主客。」失敗的 `circles`：`[[$pc, $a], [$b]]`。

##### yuri

**開場**：你在一間粉白色的茶室裡醒來，身上被換了一件和茶會主人同一款的洋裝，她坐在你身邊替你梳頭，說你們穿起來像一對。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：茶會主人說餘興節目是她和主客，客人們把椅子轉過來；她把線繞在兩個人的手指上。
  - 「讓她們看。」`adult_scene`：`{ circles: [[$pc, $a], [$b]] }`

---

### 祭典的早上（`df_afterparty_festival_morning`）

- **kind**：`afterparty`
- **factions**：`festival`（酒客、太鼓手帶隊）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:群與融合`、`tendency:藥`、`tendency:野外`
- **fails_commission**：true
- **fallback**：`df_afterparty_festival_morning_plain`：被灌了摻藥的酒，記憶斷片，醒在別區，少了錢，多了一個不記得的人情。
- **登場**：`$a` 太鼓手（`en_fest_taiko`，男性）；`$b` 酒客（男性，兩位）；`$c` 煙火手（`en_fest_hanabi`，女性）。
- **醒在別區**：從主角現在所在的區以外擲一區（不擲冠冕區），`move` 到那一區的街頭。

##### default

**開場**：你倒在祭典的攤子後面，頭頂的燈籠一盞一盞地晃，太鼓的聲音從地面傳上來，震得你的橋發麻。太鼓手把鼓棒插在腰帶上蹲下來，酒客們拿著噴霧壺圍過來，說倒下的人要罰三杯。

- **第一段：罰酒**。噴霧壺裡是摻了感官藥的酒，香得發甜。
  - 「喝三杯。」效果：`condition 醉（四小時：定力 −2，感載上升加快）`、`load +12`，進第二段。
  - 「憋氣不吸。」定力 DC 16。成功：`load +4`，太鼓手說你很能撐，進第二段，第二段的定力檢定 +2。失敗：效果同「喝三杯」。
  - 「搶一壺灌回去。」格鬥 DC 13。成功：一個酒客倒在你旁邊笑個不停，`load +6`，進第二段。失敗：效果同「喝三杯」，另 `afterglow +1`。
- **第二段：後半場**。祭典的人群往河邊移動，太鼓手把你扛在肩上跟著走，說後半場才是真的祭典；鼓聲越來越密，你的感載跟著往上爬。
  - 「跟著鬧。」效果：`time +8`、`cash −（身上一半的現金晶片）`、`owed 花火師 小`（你不記得欠了什麼）、`fame （祭典的那一區） +3`，醒來時 `move （擲到的區）`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b]] }`（祭典的人群在附近，`tendency 野外`）。
  - 「撐住清醒。」定力 DC 16。大成功：你從他肩上滑下來，混進人群，`time +2`，事件結束。成功：你記得一半，`time +6`、`cash −（三成）`、`move （擲到的區）`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「跟著鬧」。
  - 「叫煙火手幫你。」交涉 DC 16。成功：她把你從太鼓手肩上拉下來，帶你去看煙火，`affinity $c +3`、`time +4`；`adult_scene`：`{ when: success, gate: ai, nature: mutual, role: none, goal: none, circles: [[$pc, $c]] }`。失敗：她笑著說一起來啊，效果同「跟著鬧」，`circles`：`[[$pc, $a, $b, $c]]`。
- **第三段：醒來**（在擲到的區，早上）。你醒在一張陌生的長椅上，身上披著一件祭典組的法被，口袋裡有一張寫了電話號碼的紙條和一個空的錢包。
  - 「打那個號碼。」效果：`roster_add （接電話的人）`，對方說昨晚很開心，問你什麼時候還那個人情。
  - 「把紙條丟掉。」效果：`flag festival_owed_unknown`（那個人情之後會自己找上門）。
  - 「找人問昨晚發生了什麼。」街頭直覺 DC 13。成功：你拼出了大概，`memory 祭典的那一晚`、`flag festival_footage`（有人錄下來了，帶子在祭典組的手上）。失敗：每個人說的版本都不一樣。

##### masc

**開場**：你倒在祭典的攤子後面，煙火手跨坐在你的腰上，把一壺摻了藥的酒倒進你的嘴裡；酒客裡的幾個女人在旁邊拍手，說罰酒罰到站起來為止。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：煙火手拉著你往河邊走，酒客裡的女人一個個跟上來，說後半場要你陪。`$a` 換成煙火手，`$b` 換成女性的酒客。
  - 「跟著鬧。」`adult_scene`：`{ circles: [[$pc, $c, $b]] }`
  - 「撐住清醒。」成功的 `circles`：`[[$pc, $c]]`。
  - 「叫煙火手幫你。」改成「叫太鼓手幫你。」，成功時他把你送到河堤上就走了，沒有成人場景；失敗的 `circles`：`[[$pc, $c, $b]]`。
- **第三段**：`inherit default.stages.2`。

##### yuri

**開場**：你倒在祭典的攤子後面，煙火手蹲在你身邊，拿濕毛巾擦你臉上的灰，說太鼓那群人要來了，你最好跟她走。

- **第一段**：`inherit default.stages.0`，罰酒由煙火手倒。
- **第二段**：`inherit default.stages.1`，換掉：
  - 開場：煙火手把你帶到河堤的另一頭，祭典的燈從水面上反射過來，她說後半場她只帶你一個。
  - 「跟著鬧。」`adult_scene`：`{ circles: [[$pc, $c]] }`
  - 「撐住清醒。」成功的 `circles`：`[[$pc, $c]]`。
  - 「叫煙火手幫你。」改成「叫她放慢一點。」，交涉 DC 13，成功的 `nature`：`mutual`。
- **第三段**：`inherit default.stages.2`。

---

### 花火師的屋台（`df_afterparty_hanabi`）

- **kind**：`afterparty`
- **factions**：`festival`（花火師帶隊）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:暴露`、`tendency:恩與債`
- **fails_commission**：true
- **fallback**：`df_afterparty_hanabi_plain`：醒在另一區的屋頂，穿著一件法被，昨晚的照片在街上流傳；少了錢，多了一段豔名。
- **登場**：`$a` 花火師（`en_fest_pyro`，男性）；`$b` 煙火手（女性）；`$c` 酒客（男性）。

##### default

**開場**：你在祭典的屋台後面醒來，身上只剩一件寫著「祭」字的法被，花火師坐在一箱用舊報紙包著的炸藥上，天狗面具推到頭頂。他說你壞了他今晚的煙火，所以今晚的煙火要由你來點。

- **第一段：點火**。屋台外面的人群在等最後一發煙火。
  - 「點。」機械 DC 13。大成功：煙火漂亮地升空，人群歡呼，花火師說債清了，`favor festival +2`、`fame （這一區） +2`，事件結束。成功：煙火升空了，你穿著法被站在發射筒旁邊被所有人看到，`fame （這一區） +3`，進第二段。失敗：煙火歪了，炸掉一個攤子的招牌，`bill 賠償 +`，進第二段。大失敗：同失敗，另 `hp −4`（熱能）。
  - 「說你不點。」效果：進第二段。
- **第二段：慶功**。煙火放完，屋台裡的人開始喝酒，花火師說欠的還沒還完，人情要用祭典的方式還。
  - 「留下來喝。」效果：`time +8`、`cash −（三成）`、`fame （這一區） +3`，醒來時 `move （擲到的區，屋頂）`、`flag festival_photos`（你穿著法被的照片在街上流傳）。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $a, $c]] }`
  - 「跟花火師講好，欠的只算他一個人。」交涉 DC 16。成功：`owed $a 小`，他戴回面具帶你到屋台後面，`adult_scene`：`{ when: success, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「留下來喝」。
  - 「趁他們喝醉溜走。」隱匿 DC 13。成功：`time +2`、`owed $a 小`（你還欠著）。失敗：煙火手把你抓回來，效果同「留下來喝」，`nature`：`forced`。

##### masc

**開場**：你在屋台後面醒來，身上只剩一件法被，煙火手把她的頭巾綁到你的額頭上，說今晚的最後一發煙火要由你來點，點完了她再跟你算帳。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`（煙火手），`$c` 換成女性的酒客；「跟花火師講好」改成「跟煙火手講好」。

##### yuri

**開場**：你在屋台後面醒來，身上只剩一件法被，煙火手坐在你身邊捲煙火筒，說花火師去追別的人了，你的帳現在算在她頭上。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「留下來喝」的 `circles`：`[[$pc, $b]]`；「跟花火師講好」改成「跟煙火手講好」。

---

### 屋頂的分贓（`df_robbed_nora_roof`）

- **kind**：`robbed`
- **factions**：`nora`（扒手、屋頂的信差、發情的貓帶隊；蜂巢屋頂）
- **tags**：`female_partner`、`male_partner`、`tendency:獸`、`tendency:藥`
- **fails_commission**：false
- **fallback**：`df_robbed_nora_roof_plain`：醒在屋頂上，現金晶片與快取格被拿光，追或不追。
- **登場**：`$a` 發情的貓（`en_nora_heatcat`，女性）；`$b`（default）一位留下來的野良，男性，地下層的野犬（`en_nora_hound`）。
- **被扒**：`cash −（全部的現金晶片）`、`item −（快取格裡的全部）`；帳戶裡的錢、裝在身上的東西不動。這一筆沒有非自願的分支。

##### default

**開場**：你在蜂巢一棟公寓的屋頂上醒來，身邊是曬衣繩和翻倒的水塔，口袋全被翻了出來。野良的人已經跳到對面的屋頂去了，只有一個犬耳的男人還蹲在水塔上，嘴裡叼著你的一個快取盒。

- **被扒**：如上。
- **第一段：追不追**。
  - 「追。」運動 DC 16。大成功：你在第三個屋頂追上她們，搶回一半的東西，`cash +（一半）`、`item +（一半）`。成功：搶回一件，`item +1`。失敗：她們跳過一條你跳不過的巷子。大失敗：`hp −6`，摔在鐵皮屋頂上。
  - 「讓她們走。」效果：無。
  - 「跟水塔上的那個談。」交涉 DC 13。成功：他把叼著的快取盒丟還給你，說裡面的東西不好賣，`item +1`，進第二段。失敗：他跳上水塔的頂端，說你想要就上來拿，進第二段。
- **第二段：留下來的人**。發情的貓從曬衣繩後面走出來，項圈上的發散器一閃一閃，甜的味道一下子濃起來；她說她沒打算還東西，她是被你身上的味道勾回來的。犬耳的男人也從水塔上跳下來。
  - 「讓他們留下來。」效果：`item +1`（貓把她拿走的那一件放回你的口袋）、`tendency 獸 +1`、`condition 蜜（兩小時）`。`adult_scene`：`{ when: always, gate: ai, nature: mutual, role: none, goal: none, circles: [[$pc, $a, $b]] }`
  - 「只要東西，不要人。」威嚇 DC 16。成功：貓嘖了一聲，把東西丟回來，`item +1～2`。失敗：她們笑著跳走了，帶著東西。
  - 「用一件東西換回終端機。」need：身上還有可以換的東西。效果：`item −1`、`item +（你的終端機）`、`affinity $a +2`。

##### masc

**開場**：你在蜂巢一棟公寓的屋頂上醒來，口袋全被翻了出來，發情的貓坐在你的胸口上，尾巴一下一下掃過你的臉；她手上拿著你的現金晶片，說這個她要了，你的話她還在考慮。

- **被扒**：同 default。
- **第一段**：`inherit default.stages.0`，水塔上的換成屋頂的信差（女性）。
- **第二段**：`inherit default.stages.1`，換掉：「讓她們留下來」的 `circles`：`[[$pc, $a]]`，`start_position: pos_pinned_under`；屋頂的信差在水塔上看。

##### yuri

**開場**：你在蜂巢的屋頂上醒來，發情的貓趴在你身邊嗅你的頸側，三色的貓耳一抖一抖；她說其他人都跑了，她留下來是因為你聞起來很好。

- **被扒**：同 default。
- **第一段**：`inherit default.stages.0`，水塔上的換成扒手（女性）。
- **第二段**：`inherit default.stages.1`，換掉：「讓她們留下來」的 `circles`：`[[$pc, $a]]`。

---

### 鑰匙項圈（`df_robbed_nora_den`）

- **kind**：`robbed`
- **factions**：`nora`（一群野良的頭帶隊；地下層淺層）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:獸`、`tendency:群與融合`
- **fails_commission**：false
- **fallback**：`df_robbed_nora_den_plain`：醒在地下層的野良窩裡，東西被分光，頭把你的鑰匙掛上她的項圈；談、搶或走。
- **登場**：`$a` 一群野良的頭（`en_nora_packleader`，女性）；`$b` 地下層的野犬（男性）；`$c` 屋頂獵手（女性）。
- **被扒**：同 `df_robbed_nora_roof`，另外 `flag nora_has_key`：你據點的鑰匙掛在頭的項圈上（家園事件「家被闖」的機率上升，直到拿回來）。

##### default

**開場**：你在地下層一個用貨櫃和帆布搭成的窩裡醒來，身下是一堆舊毯子，四周點著幾盞油燈。野良的頭坐在一張報廢的沙發上，把你的東西一件一件分給她的人，最後把你的鑰匙掛到她那條掛滿鑰匙的項圈上。

- **被扒**：如上。
- **第一段：分完了**。頭說東西是她們的了，人她不要，天亮前會放你走。
  - 「要回鑰匙。」交涉 DC 16。成功：她把鑰匙丟還給你，`flag nora_has_key` 不立。失敗：她說鑰匙要用東西換，進第二段。
  - 「搶。」格鬥 DC 19。成功：你扯下她項圈上自己的那一把鑰匙，整個窩的人都站了起來，`hostility nora +3`、`move 地下層`。失敗：野犬把你按回毯子上，進第二段。
  - 「什麼都不要，走。」效果：`move 地下層`、`time +2`。
- **第二段：換**。頭從沙發上下來，蹲到你面前聞了聞，說想要鑰匙，就當一晚她們的人；野犬和獵手已經圍在毯子邊。
  - 「當一晚她們的人。」效果：`flag nora_has_key` 不立、`favor nora +2`、`tendency 獸 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: trade, role: none, goal: none, circles: [[$pc, $a, $b], [$c]] }`
  - 「用一件東西換。」need：一件 II 級以上的物品。效果：`item −1`、`flag nora_has_key` 不立。
  - 「不換。」效果：`move 地下層`、`time +2`；鑰匙留在她那裡。若在這一段選了「搶」失敗後才到這裡，`adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b]] }`，標 `pc_unwilling`。

##### masc

**開場**：你在地下層的野良窩裡醒來，頭跨坐在你的身上，把你的鑰匙一把一把掛上她的項圈，每掛一把就低頭看你一眼。

- **被扒**：同 default。
- **第一段**：`inherit default.stages.0`，野犬換成發情的貓（女性）。
- **第二段**：`inherit default.stages.1`，換掉：「當一晚她們的人」的 `circles`：`[[$pc, $a, $c]]`，`start_position: pos_pinned_under`。

##### yuri

**開場**：你在地下層的野良窩裡醒來，頭用狼耳蹭了蹭你的頭頂，像在確認你是什麼味道；屋頂獵手的長尾巴纏在你的腳踝上。

- **被扒**：同 default。
- **第一段**：`inherit default.stages.0`，野犬換成屋頂獵手。
- **第二段**：`inherit default.stages.1`，換掉：「當一晚她們的人」的 `circles`：`[[$pc, $a, $c]]`。

---

### 沙塵路（`df_stranded_rose_dustroad`）

- **kind**：`stranded`
- **factions**：`rose`（車族槍手、驛站的獵人、拆車手帶隊；鏽帶與荒地邊緣）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:野外`
- **fails_commission**：true
- **fallback**：`df_stranded_rose_dustroad_plain`：被搜身丟在荒地邊緣，走回城或搭便車，便車只收錢。
- **登場**：`$a` 車族槍手（`en_rose_gunner`）；`$b` 驛站的獵人（`en_rose_hunter`）；`$c`（default）跑長途的卡車司機，男性的街坊，不屬於任何勢力。
- 從 `df_ransom_rose_waystation` 的「說你不付」連過來時，從第一段開始；從那一筆的 fallback 過來時，從第二段開始。這一筆不再往下連。

##### default

**開場**：你在一輛皮卡的車斗上醒來，車子停在一段只剩半邊護欄的公路上，四周是灰黃色的荒地，城的燈在很遠的地方。車族槍手跳上車斗，說荒地的規矩是輸的人自己走回去，走之前要先搜身。

- **第一段：搜身**。
  - 「自己把東西交出來。」效果：`cash −（全部的現金晶片）`、`item −（快取格裡的一半）`，槍手點點頭，沒再碰你，進第二段。
  - 「讓她搜。」效果：`cash −（全部的現金晶片）`、`item −（快取格裡的全部）`。她搜得很仔細，獵人在駕駛座上看；`adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`，進第二段。
  - 「藏一件東西。」隱匿 DC 16。成功：一件東西留在身上，其餘照「讓她搜」，`adult_scene` 照「讓她搜」。失敗：她找到了，罰你多走一段，`time +4`，效果同「讓她搜」。
  - 「跟她們講荒地的話。」街頭直覺 DC 16（說得出車族在意的事：水、油、路況）。成功：她們只拿現金，還留給你一瓶水，`favor rose +1`，進第二段，第二段的運動檢定 +2。失敗：她說城裡人都學了兩句，效果同「讓她搜」。
- **第二段：回城**。皮卡揚起一陣沙開走了，你身上只剩衣服，離鏽帶的路口要走一整夜。
  - 「走回去。」運動 DC 13。成功：`time +8`、`move 鏽帶`。失敗：`time +14`、`hp −6`、`condition 脫水（一天）`、`move 鏽帶`。
  - 「攔便車。」效果：一輛長途卡車停下來，司機搖下車窗，說他不收錢，收別的。
    - 「上車。」`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $c]] }`；`time +3`、`move 鏽帶`。
    - 「不上。」效果同「走回去」。
  - 「等另一輛車隊。」街頭直覺 DC 16。成功：等到一隊野薔薇的補給車，認得你剛才沒有亂來，載你一程，`time +5`、`move 鏽帶`。失敗：等到天亮也沒有車，`time +10`，效果同「走回去」的成功。

##### masc

**開場**：你在一輛皮卡的車斗上醒來，車子停在只剩半邊護欄的公路上，槍手和獵人兩個女人坐在車斗邊抽菸，獵人用槍托敲了敲你的靴子，說要先搜身。

- **第一段**：`inherit default.stages.0`，換掉：「讓她搜」的 `circles`：`[[$pc, $a, $b]]`，她們把你按在車斗的鐵板上搜。
- **第二段**：`inherit default.stages.1`，換掉：便車的司機換成一位女性的卡車司機，她說長途很無聊，你陪她說話，或者別的。

##### yuri

**開場**：你在一輛皮卡的車斗上醒來，獵人蹲在你旁邊，把寬邊帽扣在你的頭上替你擋太陽，說槍手去前面看路了，搜身由她來。

- **第一段**：`inherit default.stages.0`，換掉：「讓她搜」的 `circles`：`[[$pc, $b]]`。
- **第二段**：`inherit default.stages.1`，換掉：便車的司機換成一位女性的卡車司機。

---

### 圍牆外的廢車場（`df_stranded_rose_junkyard`）

- **kind**：`stranded`
- **factions**：`rose`（拆車手、改裝車的駕駛帶隊；鏽帶，黑泉的圍牆外）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:束縛`、`tendency:野外`
- **fails_commission**：true
- **fallback**：`df_stranded_rose_junkyard_plain`：被綁在黑泉圍牆外的一輛廢車上，自己掙開，或等巡邏、等路人。
- **登場**：`$a` 拆車手（`en_rose_wrecker`）；`$b` 改裝車的駕駛（`en_rose_driver`）；`$c`（default）黑泉的巡邏兵，男性的私兵（`en_bs_trooper`）。

##### default

**開場**：你在鏽帶一座廢車場裡醒來，雙手被拖車用的帶子綁在一輛報廢轎車的車頂架上，背後是黑泉能源的灰色圍牆，牆上的探照燈慢慢地掃過來。拆車手坐在引擎蓋上，用撬棍敲著車門，說她們要走了，你要怎麼回去是你的事。

- **第一段：臨走**。拆車手說綁著是為了讓你學乖，學乖了就放；改裝車的駕駛靠在車門上，把帶子又拉緊了一格。
  - 「說你學乖了。」交涉 DC 16。成功：她們把帶子鬆開一半就走了，`cash −（全部的現金晶片）`、`time +1`，進第二段，第二段的掙脫 +4。失敗：她們說不像，進「讓她們教」。
  - 「讓她們教。」效果：`cash −（全部的現金晶片）`、`tendency 束縛 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: obey, circles: [[$pc, $a, $b]] }`，進第二段。
  - 「罵她們。」威嚇 DC 19。成功：駕駛笑了，說這個有種，把帶子割斷，`favor rose +1`、`cash −（一半）`，事件結束，`move 鏽帶`。失敗：效果同「讓她們教」。
- **第二段：探照燈**。她們的車開走了，帶子還綁著，探照燈每隔一陣就掃過你。
  - 「自己掙開。」運動 DC 16。成功：`time +2`、`move 鏽帶`。失敗：`time +4`、`hp −4`，回到這一段。
  - 「等巡邏。」效果：黑泉的巡邏兵發現你，說圍牆外的東西他可以不報，看你怎麼謝他。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $c]] }`；`move 鏽帶`。若選「不謝」：`hostility blackspring +2`，他把你當可疑人物帶回去盤問，`time +8`、`move 鏽帶`。
  - 「喊路過的人。」效果：素體教的灰袍信徒聽見了，把你解下來，說橋的事他們可以幫你；`flag bare_offer`（下一次在鏽帶遇到素體教，可以選擇跟他們走），`time +2`、`move 鏽帶`。

##### masc

**開場**：你在鏽帶的廢車場裡醒來，雙手綁在一輛報廢轎車的車頂架上，拆車手坐在你面前的引擎蓋上，連身工作服的上半身綁在腰上，她用撬棍的尾端抬起你的下巴。

- **第一段**：`inherit default.stages.0`，換掉：「讓她們教」的 `start_position: pos_standing`。
- **第二段**：`inherit default.stages.1`，換掉：巡邏兵換成黑泉的隨軍修女（`en_bs_sister`，女性），她說圍牆外的罪她可以替你贖。

##### yuri

**開場**：你在鏽帶的廢車場裡醒來，雙手綁在一輛報廢轎車的車頂架上，改裝車的駕駛摘下皮手套，用手背試了試你的臉有多燙，說荒地的太陽曬一天會要命，她們只綁你一晚。

- **第一段**：`inherit default.stages.0`，換掉：「讓她們教」的 `circles`：`[[$pc, $b]]`；拆車手在車上等。
- **第二段**：`inherit default.stages.1`，換掉：巡邏兵換成黑泉的隨軍修女（女性）。

---

### 改好了（`df_tinkered_wallcircle`）

- **kind**：`tinkered`
- **factions**：`doujin`（壁社團的社長、看攤的帶隊；同人夜市、暗礁）
- **tags**：`female_partner`、`male_partner`、`tendency:妄想`、扮相 `角色扮演`
- **fails_commission**：true
- **fallback**：`df_tinkered_wallcircle_plain`：一件裝備被社團「改好了」，多一個怪癖；可以付錢改回來。
- **登場**：`$a` 壁社團的社長（`en_dj_wallcircle`，女性）；`$b` 看攤的（`en_dj_stall`，男性）。
- **改好了的規則**：社長挑主角身上的一件武器或可拆的裝備（不動義體），換成「同一件裝備＋一個怪癖」（怪癖照同人件的表擲：有時多一顆骰、有時卡住）。效果寫成 `item −1（原本那件）`、`item +1（改好了的那件）`。這一筆沒有非自願的分支。

##### default

**開場**：你在同人夜市一個靠牆的大攤位後面醒來，身上蓋著一張印了社團角色的毛毯，你的槍放在折疊桌上，槍管上多纏了一圈 LED 燈條。社長戴著焊接護目鏡，正在往槍托上貼一張「改好了！」的貼紙。

- **改好了**：如上。
- **第一段：驗收**。社長說你剛才打她們的時候這把槍卡了兩次，她看不下去，就順手改了；看攤的在旁邊點頭，說社長改的東西很少失敗。
  - 「謝謝她，收下。」效果：改好了的那件留著，`favor doujin +2`。
  - 「要她改回來。」交涉 DC 13。成功：她說可以，但要付零件錢，`cash −300`，原本那件回來。失敗：她說原本的零件已經拿去做別的了，進第二段。
  - 「看看她還改了什麼。」機械 DC 13。成功：你發現她在槍裡多裝了一個小喇叭，扣扳機時會喊出社團角色的台詞；拆掉了，怪癖照留，`flag doujin_voice_removed`。失敗：你沒發現，第一次開槍時才知道。
- **第二段：新刊**。社長說零件錢可以不收，她下一本新刊缺一個模特兒，就是你剛才打架的那個樣子；看攤的已經把一套角色服裝掛在衣架上，衣服上的配件全是社團的周邊。
  - 「當她的模特兒。」效果：原本那件回來（或保留改好了的，玩家選）、`footage 1 段`（新刊的封面）、`fame （這一區） +2`、`tendency 妄想 +1`。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: footage, circles: [[$pc, $a, $b]] }`（社長畫，看攤的打光，場景照新刊的分鏡走）。
  - 「只拍封面，不拍內頁。」表演 DC 16。成功：她拍完封面就滿意了，原本那件回來，`fame （這一區） +1`。失敗：她說內頁才是重點，效果同「當她的模特兒」，或者走人（改好了的留著）。
  - 「拿著改好了的走。」效果：無。

##### masc

**開場**：你在同人夜市靠牆的大攤位後面醒來，社長已經替你換上了她新作的男主角服裝，正在你的胸口別上最後一個徽章；你的槍放在桌上，槍托貼著「改好了！」。

- **改好了**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：看攤的換成社團的女成員；「當她的模特兒」的 `circles`：`[[$pc, $a]]`，社長說這一本是女性向，她要親自取材。

##### yuri

**開場**：你在同人夜市靠牆的大攤位後面醒來，社長盤腿坐在你旁邊，一邊畫速寫一邊看你，紙上已經有三張你睡著的臉。

- **改好了**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：看攤的換成社團的女成員；「當她的模特兒」的 `circles`：`[[$pc, $a]]`，社長說這一本是百合本。

---

### 車庫生技的試用品（`df_tinkered_garage`）

- **kind**：`tinkered`
- **factions**：`doujin`（車庫生技改造人在場時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:變形`★、`tendency:獸`
- **fails_commission**：true
- **fallback**：`df_tinkered_garage_plain`：外皮被貼上一片車庫生技的試用品（一對獸耳或一段尾巴），七天後自己脫落；裝著的時候社交檢定有加有減。
- **登場**：`$a` 車庫生技改造人（`en_dj_garage`，男性）；`$b`（masc、yuri）車庫生技社團的女社員，前臂有硬棘。
- **改好了的規則**：主角的外皮（裝備）被貼上一件試用品，`condition 試用品（七天：獸耳或尾巴；在歡迎獸化的區交涉與誘惑 +1，在找麻煩的區 −1）`；七天後脫落，外皮多一個怪癖（`item −1`、`item +1`，同上一筆）。

##### default

**開場**：你在一間車庫改成的實驗室裡醒來，頭頂垂著一盞手術燈，燈罩上貼著社團的貼紙；你的頭頂癢癢的，伸手一摸，多了一對軟軟的耳朵，會跟著你的心跳抖。改造人坐在旁邊的工具箱上，手臂上的硬棘還貼著 OK 繃，他說試用品今天剛好多一組。

- **改好了**：如上。
- **第一段：試用**。改造人拿著一塊寫字板，說他要記錄試用者的反應，耳朵接上橋以後會很敏感。
  - 「讓他記錄。」效果：`flag garage_data`（車庫生技拿到你的資料，之後可能找你當試用者，報酬另算）、`tendency 變形 +1`。`adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「要他現在拆掉。」義體學 DC 16。成功：你自己找到接頭，耳朵拆下來了，`condition 試用品` 不觸發，外皮照樣多一個怪癖。失敗：拆到一半耳朵開始抖得更厲害，`load +8`，回到這一段的其他選項。
  - 「問他這東西值多少錢。」交涉 DC 13。成功：他說試用品不收錢，反倒付你試用費，`cash +200`，進第二段。失敗：進第二段。
- **第二段：數據**。改造人說數據還差一段，他想知道耳朵在別人摸的時候會怎樣；車庫外面有人敲門，是來拿試用報告的社員。
  - 「讓他們摸。」效果：`cash +200`（試用費）、`tendency 獸 +1`。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「戴著耳朵走。」效果：`move （這一區）`。
  - 「把他的寫字板拿走。」隱匿 DC 13。成功：`flag garage_notes`（裡面有車庫生技下一批試用品的清單，可以賣給蜜腺），`hostility doujin +1`。失敗：他追出來，說你好歹把試用報告填完。

##### masc

**開場**：你在車庫改成的實驗室裡醒來，背後多了一條尾巴，尾巴的根接在你的外皮上，女社員蹲在你身後，手指順著尾巴一節一節往上摸，說接得很漂亮。

- **改好了**：同 default，試用品是尾巴。
- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「讓她摸。」的 `circles`：`[[$pc, $b]]`。

##### yuri

**開場**：你在車庫改成的實驗室裡醒來，女社員正用梳子梳你頭頂新長出來的耳朵，說毛色是她挑的，和你的頭髮很配。

- **改好了**：同 default。
- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「讓她摸。」的 `circles`：`[[$pc, $b]]`。

---

### 交貨之前（`df_handedover_maids_delivery`）

- **kind**：`handed_over`
- **factions**：`maids`（雇主屬於某個勢力時）
- **tags**：`pc_unwilling`、`female_partner`、`male_partner`、`tendency:服從`、`tendency:束縛`、扮相 `女僕`
- **fails_commission**：照接手的那一筆戰敗事件。
- **fallback**：`df_handedover_maids_delivery_plain`：被公會綁好、清理乾淨，交給雇主，直接進雇主的戰敗事件。
- **登場**：`$a` 金章女僕（`en_maid_gold`）；`$b` 銀章女僕（`en_maid_silver`）；`$c`（default）公會執事（`en_maid_butler`，男性）。
- **交人**：第二段結束時 `chain （雇主的勢力的預設戰敗事件）`；雇主沒有勢力時改走 `df_handedover_private`。這一筆是連過去的那一層，接手的戰敗事件不再往下連。

##### default

**開場**：你在一間鋪著白色磁磚的準備室裡醒來，手腕被束帶綁在身前，身上被換了一件乾淨的襯衣。金章女僕正在對照一張交貨單，銀章女僕替你梳頭，公會執事站在門邊看錶，說雇主的車二十分鐘後到。

- **第一段：整理**。金章女僕說公會交出去的東西要乾淨、整齊、準時；銀章女僕把你的衣領翻好，執事拿來一副軟皮的手銬，換掉束帶。
  - 「跟公會談條件。」交涉 DC 16。大成功：金章女僕說合約只寫了交貨，沒寫交到哪個門口；你付公會一筆違約金，她們把你放在雇主的門外就走，`cash −1500`、`hostility （雇主） +3`，事件結束，不連。成功：違約金 2,500，同上。失敗：她說公會不談，進第二段。
  - 「乖乖讓她們整理。」效果：`favor maids +1`、`load −6`（她們手很輕），進第二段。
  - 「掙扎。」格鬥 DC 19。成功：束帶斷了，你跑到走廊盡頭，金章女僕沒有追，只說合約上寫的是交人，跑掉的人不算她們的責任，`hostility （雇主） +2`、`move （這一區）`，事件結束。失敗：銀章女僕的電擊鞭纏上你的手腕，`load +10`，進第二段的「被綁好」。
- **第二段：檢查**。金章女僕說交貨前要做最後的檢查，雇主要的是完好的人；銀章女僕和執事一左一右站到你身邊。
  - 「讓她們檢查。」效果：`tendency 服從 +1`，然後 `chain`。`adult_scene`：`{ when: always, gate: ai, nature: forced, role: none, goal: obey, circles: [[$pc, $b, $c]] }`
  - 「被綁好。」（只在第一段的掙扎失敗時出現）效果：`tendency 束縛 +1`，然後 `chain`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: obey, circles: [[$pc, $a, $b]] }`
  - 「問雇主是誰。」調查 DC 13。成功：交貨單上的名字你看到了，`flag knows_employer`（接手的戰敗事件裡，交涉與威嚇 +2），然後 `chain`，不進成人場景。失敗：金章女僕把交貨單翻過去，回到這一段的其他選項。

##### masc

**開場**：你在白色磁磚的準備室裡醒來，手腕綁在身前，兩位女僕跪在你的兩側替你扣襯衫的扣子，金章女僕站在你面前，戴著白手套的手抬起你的下巴，看你的臉有沒有傷。

- **第一段**：`inherit default.stages.0`，執事換成銅章女僕（`en_maid_bronze`）。
- **第二段**：`inherit default.stages.1`，換掉：「讓她們檢查」的 `circles`：`[[$pc, $a, $b]]`；「被綁好」的 `start_position: pos_pinned_under`。

##### yuri

**開場**：你在白色磁磚的準備室裡醒來，身上被換了一件公會的女僕裝，銀章女僕正在替你繫圍裙的帶子，說雇主指定要你穿成這樣。

- **第一段**：`inherit default.stages.0`，執事換成銅章女僕。
- **第二段**：`inherit default.stages.1`，換掉：「讓她們檢查」的 `circles`：`[[$pc, $a, $b]]`。

---

### 私人的雇主（`df_handedover_private`）

- **kind**：`handed_over`
- **factions**：`maids`（雇主沒有勢力時：玻璃岸的富人、冠冕區的高層、自己請保全的收藏家）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:支配`、`tendency:戀物`
- **fails_commission**：true
- **fallback**：`df_handedover_private_plain`：被交到一位富人的沙龍，他要你賠一筆錢、簽一份保證不再靠近的文件，天亮放人。
- **登場**：`$a`（default）雇主，男性的街坊，IV 級的富裕；`$b`（masc、yuri）雇主，女性的街坊，IV 級的富裕；`$c` 金章女僕（`en_maid_gold`）。
- 從 `df_handedover_maids_delivery` 連過來時，跳過開場直接進第一段；單獨出現時（雇主就在場），從開場開始。

##### default

**開場**：你被兩位女僕領進玻璃岸一間挑高的沙龍，腳下是拼花地板，牆上掛滿了用玻璃框裱起來的義體與舊武器。雇主坐在壁爐前的單人沙發上，看你的樣子和看牆上的收藏一樣，金章女僕把交貨單遞給他，退到門邊。

- **第一段：收藏家**。雇主說你壞了他的事，他不打算報警，也不打算讓你白走；他問你身上哪一件義體最值得留下來。
  - 「賠錢。」need：現金或帳戶 5,000。效果：`cash −5000`、`flag private_employer_paid`，他讓女僕送你出門，事件結束。
  - 「談。」交涉 DC 19。成功：你說動他，你替他做一件事抵帳，`start_commission`（他的私人委託）、`roster_add $a`。失敗：進第二段。
  - 「什麼都不說。」效果：進第二段。
- **第二段：留下來的一晚**。雇主說錢他不缺，他缺的是有意思的東西；他叫金章女僕把你帶到壁爐前面，自己解開了袖扣。
  - 「照他說的做。」效果：`fame 玻璃岸 +2`、`tendency 支配 +1`，天亮後 `move 玻璃岸`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: obey, circles: [[$pc, $a]] }`
  - 「讓他覺得你更有意思。」誘惑 DC 16。大成功：他把你留到早上，送你一件他的收藏，`item 一件 III 級的義體零件`、`roster_add $a`。成功：`affinity $a +3`、`cash +800`。失敗：效果同「照他說的做」。成功與大成功：`adult_scene`：`{ when: success, gate: ai, nature: trade, role: none, goal: please, circles: [[$pc, $a]] }`
  - 「求金章女僕。」交涉 DC 16。成功：她說合約只到交貨為止，打開了沙龍的側門，`flag private_employer_angry`（雇主記住你了）、`move 玻璃岸`。失敗：她說公會不插手雇主的事，效果同「照他說的做」，`circles`：`[[$pc, $a, $c]]`。

##### masc

**開場**：你被領進玻璃岸一間挑高的沙龍，雇主是一位穿著絲質長袍的女人，坐在壁爐前喝白蘭地；她讓金章女僕把你帶到她面前，用酒杯的杯底抬起你的下巴。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「照她說的做」的 `start_position: pos_lap`；「求金章女僕」失敗的 `circles`：`[[$pc, $b, $c]]`。

##### yuri

**開場**：你被領進玻璃岸一間挑高的沙龍，雇主是一位頭髮剪得很短的女人，她從牆上取下一件玻璃框，裡面是一隻義手，她說你的手比這一隻漂亮。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；「求金章女僕」失敗的 `circles`：`[[$pc, $b, $c]]`。

---

### 倉庫後面的照顧（`df_fed_sweetheart_backroom`）

- **kind**：`fed`
- **factions**：`sweetheart`（中央廚房的料理長、桃子屋店員、倉儲保全）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:溺愛`、`tendency:口與吞嚥`
- **fails_commission**：true
- **fallback**：`df_fed_sweetheart_backroom_plain`：被關在桃子屋倉庫的後間「照顧」三天，每天吃糰糧，帳單照算，放出來時吃飽了。
- **登場**：`$a` 中央廚房的料理長（`en_sweetheart_chef`，女性）；`$b` 桃子屋店員（`en_sweetheart_clerk`，女性）；`$c`（default）倉儲保全（`en_sweetheart_warehouse`，男性）。
- **照顧的規則**：關三天（`time +72`，分三段）。放出來時 `condition 吃飽了（七天：定力 +1、慾求 −10）`、`bill 甜心食品的照顧費 +（這一週固定開銷的一半）`。

##### default

**開場**：你在一間堆滿糰糧箱的倉庫後間醒來，躺在一張鋪了粉紅床單的行軍床上，床邊的小桌上放著一碗還在冒熱氣的糰糧粥。桃子屋店員坐在床邊，用一模一樣的笑容說歡迎光臨，從今天起由甜心食品來照顧您。

- **第一段：第一天**。店員拿起湯匙，吹涼了遞到你嘴邊，倉儲保全守在門口。
  - 「吃。」效果：`load −10`、`hp +6`。
  - 「不吃。」定力 DC 16。成功：店員說我們很遺憾，把碗收走，`condition 餓（一天）`。失敗：倉儲保全走過來扶住你的頭，店員一匙一匙餵完，`load −10`。
  - 「說你要投訴。」交涉 DC 19（甜心的人不吃交涉）。成功：店員的笑容停了一秒，她說會轉告料理長，進第二段時料理長先問你想吃什麼，`flag sweetheart_complaint`。失敗：她說感謝您寶貴的意見。
  - 三個選項之後都 `time +24`，進第二段。
- **第二段：第二天，試吃**。料理長親自來了，粉紅色的廚師服上沾著糖霜，她把長柄湯杓放在床邊，說今天有新口味要試，乖，張嘴。
  - 「張嘴。」效果：`tendency 口與吞嚥 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $c]] }`（溺愛與口的動作為主）。
  - 「咬緊牙。」定力 DC 19。成功：料理長說不乖的客人她見多了，她有的是時間，`time +24`，第三段的成人場景改成 `gate: ai`。失敗：效果同「張嘴」。
  - 「趁送餐的推車進來時跑。」運動 DC 16。成功：`move （這一區）`、`hostility sweetheart +3`，`bill` 照算（她們會寄帳單來），事件結束。失敗：倉儲保全把你抱回床上，`load +8`，效果同「張嘴」。
  - 之後 `time +24`，進第三段。
- **第三段：第三天，結帳**。店員拿著一張打好的帳單站在床邊，說照顧期滿了，料理長想再看您吃一碗。
  - 「吃完最後一碗再走。」效果：`condition 吃飽了`、`bill`、`affinity $a +2`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「付帳就走。」效果：`condition 吃飽了`、`bill`、`move （這一區）`。
  - 「把帳單撕了。」威嚇 DC 16。成功：店員說我們很遺憾，`hostility sweetheart +2`、`bill` 照算、`condition 吃飽了`。失敗：同成功，另 `flag sweetheart_debt_collector`（損失防治專員會上門）。

##### masc

**開場**：你在倉庫後間的行軍床上醒來，料理長坐在床沿上，高大的身體把整盞燈都擋住了；她圍著繡了桃子的巨大圍裙，把你的頭抱到她的膝上，說瘦成這樣，要多吃一點。

- **第一段**：`inherit default.stages.0`，倉儲保全換成店員。
- **第二段**：`inherit default.stages.1`，換掉：「張嘴」的 `circles`：`[[$pc, $a, $b]]`，`start_position: pos_lap`。
- **第三段**：`inherit default.stages.2`。

##### yuri

**開場**：你在倉庫後間的行軍床上醒來，店員和料理長一左一右坐在床邊，店員替你擦嘴，料理長用指尖沾了一點糖霜，點在你的嘴唇上。

- **第一段**：`inherit default.stages.0`，倉儲保全換成另一位店員。
- **第二段**：`inherit default.stages.1`，換掉：「張嘴」的 `circles`：`[[$pc, $a, $b]]`。
- **第三段**：`inherit default.stages.2`。

---

### 附加條款（`df_fed_sweetheart_lossprev`）

- **kind**：`fed`
- **factions**：`sweetheart`（損失防治專員帶隊時）
- **tags**：`female_partner`、`male_partner`、`tendency:恩與債`、`tendency:溺愛`
- **fails_commission**：true
- **fallback**：`df_fed_sweetheart_lossprev_plain`：被當成「損失」處理，在桃子屋的後間吃住兩天抵帳，帳單照算。
- **登場**：`$a` 損失防治專員（`en_sweetheart_lossprev`，男性）；`$b`（masc、yuri）損失防治專員，女性；`$c` 桃子屋店員。
- **照顧的規則**：同上一筆，關兩天（`time +48`）。這一筆沒有非自願的分支。

##### default

**開場**：你在桃子屋的員工休息室裡醒來，身上蓋著一條印著桃子的毛毯，損失防治專員坐在對面，平板上是一份寫滿條款的文件。他一邊點頭一邊說，您造成的損失已經估好了，甜心食品願意照顧您直到結清。

- **第一段：條款**。條款寫著：照顧期間的食宿由甜心食品提供，費用掛在您的帳單上。
  - 「照條款走。」效果：`time +48`、`condition 吃飽了`、`bill`，事件結束。
  - 「找條款裡的漏洞。」調查 DC 16。成功：你找到一條「自願協助者免收照顧費」，專員點頭，說那您要協助什麼呢，進第二段。失敗：他說每一條都經過測試，效果同「照條款走」。
  - 「問他能不能簽一條附加條款。」效果：進第二段。
- **第二段：附加條款**。專員翻到最後一頁，說附加條款的內容可以由雙方協商：照顧期間，您陪他完成一份客戶滿意度的訪談，費用全免。
  - 「簽。」效果：`time +24`、`condition 吃飽了`、`bill` 不加。`adult_scene`：`{ when: always, gate: ai, nature: trade, role: none, goal: none, circles: [[$pc, $a]] }`
  - 「要他也簽一條：以後的帳單打折。」交涉 DC 19。成功：`flag sweetheart_discount`（桃子屋的東西八折，一個月）；`adult_scene` 照「簽」。失敗：他說這需要上級核准，照「簽」。
  - 「不簽。」效果同第一段的「照條款走」。

##### masc

**開場**：你在桃子屋的員工休息室裡醒來，一位穿著淺粉色套裝的女專員坐在對面，點頭的頻率和她平板上的游標一樣。她說您造成的損失已經估好了，請您放心，甜心食品不會讓您餓著。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；`circles`：`[[$pc, $b]]`。

##### yuri

**開場**：你在桃子屋的員工休息室裡醒來，女專員和一位店員坐在你兩邊，店員在你手上塞了一罐溫熱的桃子牛奶，專員說訪談可以開始了。

- **第一段**：`inherit default.stages.0`，`$a` 換成 `$b`。
- **第二段**：`inherit default.stages.1`，`$a` 換成 `$b`；`circles`：`[[$pc, $b, $c]]`。

---

### 聖堂的舊網（`df_communion_chapel`）

- **kind**：`communion`
- **factions**：`whisper`（現實裡打輸時：白兜帽信徒、聖堂的潛網者）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:群與融合`、`tendency:聲音`
- **fails_commission**：true
- **fallback**：`df_communion_chapel_plain`：被帶到聖堂接上舊網一夜，聽了很多不是自己的聲音，沉溺上升，可能帶著潛伏的妖精的吻回來。
- **登場**：`$a` 聖堂的潛網者（`en_whisper_diver`，女性）；`$b` 白兜帽信徒（default 是男女都有，兩到三位）；`$c` 聖堂的引渡人的化身（舊網裡）。
- **共融的規則**：`sink +5`。**妖精的吻**：第一段的「拔線」失敗、或第二段走成人場景時，擲 30%（大失敗 60%）得到 `malware 妖精的吻（潛伏期）`（CYBERWARE 第 5 節）。

##### default

**開場**：你在地下層深處一座聖堂裡醒來，四周的牆上貼滿了寫著波形的紙，幾十條線從天花板垂下來，接在跪著的信徒們的後頸上。你的後頸也接著一條，線的另一頭消失在祭壇後面，那裡傳來很多人一起呼吸的聲音。

- **共融**：`sink +5`。
- **第一段：接上**。聖堂的潛網者跪在你身邊，捧著她的甲板，說你在外面太吵了，在這裡可以安靜下來。
  - 「聽。」效果：`load +10`，你聽見一段不是自己的記憶，`memory 聖堂的聲音`，進第二段。
  - 「抵抗。」定力 DC 19。大成功：`sink` 改成 +2，你在線上看到了聖堂甲板的位置，`flag chapel_deck_location`，進第二段。成功：`sink` 改成 +3，進第二段。失敗：`load +15`，進第二段。
  - 「拔線。」介面 DC 16。成功：線斷了，你在信徒們的嘆息聲中站起來，`sink` 改成 +2、`hostility whisper +2`、`move 地下層`，事件結束。失敗：拔到一半，舊網裡的東西沿著線湧上來，擲妖精的吻，`load +12`，進第二段。
- **第二段：大家**。線那頭的呼吸聲越來越近，跪在你兩邊的信徒靠過來，把手放在你的身上；潛網者說在舊網裡大家是一起的，你感覺到的他們也感覺得到。
  - 「融進去。」效果：擲妖精的吻、`tendency 群與融合 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b]] }`（場景發生在舊網裡，所有人的感載相連）。
  - 「只聽，不碰。」定力 DC 16。成功：你在線上待到天亮，`sink +1`，`move 地下層`。失敗：效果同「融進去」。
  - 「找出線那頭的人。」介面 DC 19。成功：你在舊網裡看見引渡人的化身，她對你點頭，說你下次可以自己來，`flag whisper_ferryman_met`、`move 地下層`。失敗：你被她牽住了手，效果同「融進去」，`circles`：`[[$pc, $c, $b]]`。

##### masc

**開場**：你在地下層深處的聖堂醒來，後頸接著一條垂下來的線，三個白兜帽的女信徒跪在你的周圍，兜帽拉到眉毛，她們的手一起放在你的胸口上，呼吸的節奏和你的心跳一樣。

- **共融**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：信徒都是女性；「融進去」的 `circles`：`[[$pc, $a, $b]]`，`start_position: pos_pinned_under`。

##### yuri

**開場**：你在聖堂裡醒來，頭枕在聖堂的潛網者的膝上，她的袍子上用銀線繡的波形在發光；她用手指沿著你後頸的線慢慢往下摸，說歡迎回家。

- **共融**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：信徒都是女性；「融進去」的 `circles`：`[[$pc, $a], [$b]]`。

---

### 暗礁的渡口（`df_communion_reef`）

- **kind**：`communion`
- **factions**：`whisper`（內海裡打輸時：信徒的化身、聽見者的化身、聖堂的引渡人）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:觸手`、`tendency:群與融合`、`tendency:溺愛`
- **fails_commission**：true
- **fallback**：`df_communion_reef_plain`：你的化身被引渡人帶到舊網的渡口，聽完一段很長的歌才放你斷線；沉溺上升，可能帶回妖精的吻。
- **登場**：`$a` 聖堂的引渡人（`en_whisper_ferryman`）；`$b` 信徒的化身（`en_whisper_avatar`，照她聽見的流竄 AI 打扮，有的多長了幾隻手）；`$c`（default）聽見者的化身，男性的身形。
- **共融的規則**：同 `df_communion_chapel`。這一筆發生在內海，主角的身體留在原地；隊友在現實醒著時，可以在第一段之後把人拔出來（`flag rescue_window`）。

##### default

**開場**：你的化身倒在暗礁的一處節點上，節點的地面一直滲出淡粉色的光，引渡人比所有人都高出一倍，她彎下腰，把你的化身抱起來。遠處是一座沒有對岸的渡口，渡口的水是一片很慢的波形。

- **共融**：`sink +5`。
- **第一段：上船**。引渡人說舊網那邊有很多人在等你，他們想認識你。
  - 「讓她帶你過去。」效果：`load +8`，進第二段。
  - 「斷線。」介面 DC 19（暗礁的深處，DC 已經 +2）。成功：你在上船前斷開，`sink` 改成 +2，身體在原地醒來，`condition 頭痛（四小時）`，事件結束。失敗：閃斷了一下又被拉回來，擲妖精的吻，進第二段。
  - 「問她要帶你去哪裡。」調查 DC 13。成功：她說去大潮崩以前的網，那裡有你會想見的人，`flag old_net_hint`。失敗：她只是哼歌。兩者都進第二段。
- **第二段：對岸**。船停在一片沒有邊的光裡，信徒的化身從四面八方伸出手來，有的多長了幾隻，輕輕纏住你的化身；引渡人把你放下，說這裡沒有人會傷害你。
  - 「讓她們纏住。」效果：擲妖精的吻、`tendency 觸手 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b, $c]] }`
  - 「只讓引渡人碰你。」誘惑 DC 16。成功：她把其他人揮開，`affinity $a +3`、`tendency 溺愛 +1`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「讓她們纏住」。
  - 「等隊友。」need：`flag rescue_window`。定力 DC 16。成功：隊友在現實拔掉你的線，`sink` 改成 +3，事件結束。失敗：效果同「讓她們纏住」。

##### masc

**開場**：你的化身倒在暗礁的節點上，引渡人跪下來，銀色的長髮垂到你的胸口；她的袍子下襬散成光點，把你整個人蓋住，信徒的化身們從光點裡伸出手。

- **共融**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：聽見者的化身換成女性的身形；「讓她們纏住」的 `circles`：`[[$pc, $a, $b]]`，`start_position: pos_pinned_under`。

##### yuri

**開場**：你的化身倒在暗礁的節點上，引渡人把你抱起來，像抱著一個睡著的人；她低頭對你哼歌，歌裡有你小時候聽過的一句。

- **共融**：同 default。
- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：聽見者的化身換成女性的身形；「讓她們纏住」的 `circles`：`[[$pc, $a, $b]]`。

---

### 沒關係（`df_spread_lost`）

- **kind**：`spread`
- **factions**：溺感者（不屬於任何勢力；溺感的人、溺感的聖者）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:群與融合`、`tendency:溺愛`
- **fails_commission**：true
- **fallback**：`df_spread_lost_plain`：醒在一群溺感者中間，他們抱著你、跟你說話，一直到你自己走開；沉溺照樣上升。
- **登場**：`$a` 溺感的聖者（`en_drown_saint`，女性）；`$b` 溺感的人（default 是男性，兩到三位）。
- **傳播的規則**：`sink +3～6`（照選項）。溺感者在場三回合後鎮溺隊開始倒數（ENEMIES 12.1 節）：這一筆的第二段若拖到 `time +4` 以上，擲一次鎮溺隊到場（冠冕區必到、舊港不來），到場時改走鎮溺隊的 `quarantine`，這一筆就此結束。

##### default

**開場**：你在一條地下道裡醒來，身上蓋著好幾件別人的外套，幾個穿著舊衣服的人圍坐在你身邊，他們的臉很乾淨，眼睛很亮。一個男人握著你的手，一直說沒關係，沒關係，他手心的溫度順著你的橋一路傳上來。

- **第一段：醒來**。圍著你的人看見你睜開眼睛，都笑了，有人鼓掌。
  - 「讓他們抱著。」效果：`sink +4`、`afterglow +1`，進第二段。
  - 「慢慢掙開。」定力 DC 16。成功：`sink +3`，他們讓開一條路，說你隨時可以回來，`move （這一區）`，事件結束。失敗：`sink +4`，他們以為你在撒嬌，抱得更緊，進第二段。
  - 「問他們是誰。」交涉 DC 13。成功：他們一個一個說了自己的名字和出事那天的事，`memory 地下道的溺感者`、`flag drowned_names`（獵溺的委託裡，你認得出這些人）。失敗：他們只說「我們」。兩者都 `sink +3`，進第二段。
- **第二段：分給你**。溺感的聖者從地下道的另一頭走過來，身後牽著她衣角的人跟著她坐下；她後頸的橋上接著好幾條線，她拿起其中一條，說這一條是給你的。
  - 「接上。」效果：`sink +6`、`tendency 群與融合 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a, $b]] }`（每個人的餘韻在場景裡互相分）。
  - 「讓她抱，不接線。」定力 DC 19。成功：`sink +4`、`tendency 溺愛 +1`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「接上」。
  - 「把鎮溺隊叫來。」need：終端機還在身上。效果：`sink +3`、`district_state （這一區） 鎮溺隊巡查 1 天`、`time +2`；擲鎮溺隊到場，到場就改走 `quarantine`。溺感者們沒有怪你，只是看著你。

##### masc

**開場**：你在一條地下道裡醒來，頭枕在溺感的聖者的膝上，她身邊的人都是女人，她們輪流摸你的頭髮，溫度從她們的指尖一路傳進你的橋。

- **第一段**：`inherit default.stages.0`，圍著你的人換成女性。
- **第二段**：`inherit default.stages.1`，換掉：「接上」的 `circles`：`[[$pc, $a, $b]]`，`start_position: pos_lap`。

##### yuri

**開場**：你在一條地下道裡醒來，溺感的聖者側躺在你身邊，用額頭抵著你的額頭，她身上帶著不只她自己的餘韻，空氣是溫的。

- **第一段**：`inherit default.stages.0`，圍著你的人換成女性。
- **第二段**：`inherit default.stages.1`，換掉：「接上」的 `circles`：`[[$pc, $a], [$b]]`。

---

### 只唱給你的歌（`df_spread_singer`）

- **kind**：`spread`
- **factions**：溺感者（溺感的歌姬在場時；櫻町與四十二番街的廢劇場）
- **tags**：`pc_unwilling`★、`female_partner`、`male_partner`、`tendency:聲音`、`tendency:群與融合`
- **fails_commission**：true
- **fallback**：`df_spread_singer_plain`：在廢劇場的觀眾席醒來，歌姬唱了一整晚，唱到你自己也想唱；沉溺照樣上升。
- **登場**：`$a` 溺感的歌姬（`en_drown_singer`，女性）；`$b` 溺感的人（觀眾席上的；default 是男性）。
- **傳播的規則**：同 `df_spread_lost`。

##### default

**開場**：你在一間廢劇場的觀眾席醒來，椅墊破了，舞台上的燈卻亮著，溺感的歌姬穿著褪色的演出服站在燈下唱歌。觀眾席上坐滿了人，每一個都閉著眼睛，你聽見那首歌的時候，覺得它是唱給你的。

- **第一段：第一首**。
  - 「聽完。」效果：`sink +3`、`load +8`，進第二段。
  - 「捂住耳朵。」定力 DC 16。成功：`sink +3`，你摸著椅背走到出口，`move （這一區）`，事件結束。失敗：歌聲直接從橋進來，`sink +4`，進第二段。
  - 「唱回去。」表演 DC 16。大成功：你的聲音把她的歌接成一首合唱，她停下來對你鞠躬，`sink +3`、`memory $a 合唱`、`roster_add $a`（只在之後她被鎮溺隊治好時才成立），事件結束。成功：她很高興，叫你上台，進第二段。失敗：你的聲音混進她的歌裡，`sink +4`，進第二段。
- **第二段：上台**。歌姬向你伸出手，觀眾席上的人睜開眼睛，一起看著你，有人站起來走向舞台。
  - 「上台。」效果：`sink +5`、`tendency 聲音 +1`。`adult_scene`：`{ when: always, gate: fixed, nature: forced, role: none, goal: none, circles: [[$pc, $a], [$pc, $b]] }`（舞台上的燈一直亮著，觀眾席的人也在場景裡）。
  - 「只讓歌姬一個人。」誘惑 DC 16。成功：她叫觀眾們坐回去，`sink +4`；`adult_scene`：`{ when: success, gate: ai, nature: forced, role: none, goal: none, circles: [[$pc, $a]] }`。失敗：效果同「上台」。
  - 「關掉舞台的燈。」機械 DC 13。成功：燈滅了，歌停了，觀眾們在黑暗裡嘆氣，你趁機離開，`sink +3`、`move （這一區）`。失敗：效果同「上台」。

##### masc

**開場**：你在廢劇場的觀眾席醒來，歌姬已經從舞台上走下來，坐在你身邊的扶手上，一邊唱一邊用麥克風的線繞住你的手腕；觀眾席上坐著的都是女人。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：觀眾換成女性；「上台」的 `circles`：`[[$pc, $a, $b]]`。

##### yuri

**開場**：你在廢劇場的觀眾席醒來，歌姬蹲在你面前，把舊麥克風舉到你的嘴邊，說下一首她想聽你唱。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，換掉：觀眾換成女性；「上台」的 `circles`：`[[$pc, $a], [$b]]`。

---

### 氣球（`df_taken_balloon`）

- **kind**：`taken`
- **factions**：吉祥物（桃子、熊；不屬於任何勢力）
- **tags**：沒有成人場景。
- **fails_commission**：true
- **fallback**：吉祥物線的題材整個關掉時，改成「醒在街角，手上一顆氣球」：`time +6`，其他效果都不發生。
- **帶走的規則**：`time +72～336`（三天到兩週，擲）。帶走的期間沒有紀錄，橋的時間戳也是空白；`start_quest 吉祥物線`（第一次）或推進它的階段（之後）。三個版本只差描寫，選項與效果全部相同。

##### default

**開場**：你最後記得的是一隻毛茸茸的圓手套蓋在你的臉上，氣球的線擦過你的耳朵。四周很暗，你被抱著走，抱著你的東西每走一步，身體裡的棉花就沙沙地響。

- **第一段：黑暗**。
  - 「掙扎。」運動 DC 22。大成功：你從它的手臂裡滑下來，摔在一條地下道的地上，四周沒有人，只有一顆氣球卡在天花板上；`time +6`，跳過第二段，事件結束，`flag mascot_escaped`。成功：你掙扎了很久，它一直沒有停；`time` 只擲三天到一週。失敗：它把你抱得更好。大失敗：同失敗。
  - 「記住路。」街頭直覺 DC 19。成功：你數著轉彎與台階，`flag mascot_route`（吉祥物線的某一個階段可以直接找到那個地方）。失敗：轉彎太多，你數亂了。
  - 「不動。」效果：你聽見它在哼一首歌，旋律是某間店的廣告曲，`memory 吉祥物的歌`。
- **第二段：回來**。你醒在一個街角，天在下小雨，手上牽著一顆氣球，衣服是乾淨的，口袋裡的東西一件也沒少。路過的人看了你一眼，說你不見了好幾天。
  - 「看看身上。」調查 DC 16。成功：你在衣領的內側找到一段用黑線縫上去的標籤，上面寫著一個店名，`flag mascot_tag`。失敗：你什麼也沒找到，只覺得少了什麼。
  - 「放開氣球。」效果：氣球飛走了，你一直看到它不見；`condition 恍神（一天：調查 −1）`。
  - 「把氣球帶回家。」效果：`item 一顆氣球`（不會消氣；家園裡多一樣東西，家園事件的吉祥物目擊機率上升）。

##### masc

**開場**：你最後記得的是被一雙比你大的圓手套從地上抬起來，扛在一個圓滾滾的肩膀上，氣球在你的頭頂晃。它走路沒有聲音，你只聽得見自己的呼吸。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，開場改成：你醒在一個公車站的長椅上，身上蓋著一張乾淨的毯子，手腕上綁著氣球的線，打了一個你不會打的結。

##### yuri

**開場**：你最後記得的是一張縫上去的笑臉離你很近，圓手套很輕地拍著你的背，一下，兩下，和哄人睡覺的節奏一樣。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，開場改成：你醒在一間關了門的桃子屋門口，背靠著鐵捲門，手上牽著一顆粉紅色的氣球，頭髮被人編成了兩條辮子。

---

### 紅領結（`df_taken_bear`）

- **kind**：`taken`
- **factions**：吉祥物（熊帶隊時；委託副本裡最常見）
- **tags**：沒有成人場景。
- **fails_commission**：true
- **fallback**：同 `df_taken_balloon`。
- **帶走的規則**：同 `df_taken_balloon`，`time` 擲一週到兩週。回來時多一段不屬於你的紀錄（`flag mascot_record`：紀錄裡一段只有聲音、沒有畫面的錄音，是吉祥物線的線索）。三個版本只差描寫。

##### default

**開場**：你最後記得的是熊的頭慢慢歪向一邊，歪到一個脖子做不到的角度，然後它彎下腰，把褪色的紅領結解下來，繫在你的手腕上。之後它牽著你走，你的腳一直在動，卻感覺不到地面。

- **第一段：牽著走**。
  - 「把領結扯掉。」格鬥 DC 22。大成功：領結斷了，熊停下來，歪著頭看你很久，然後自己走掉了；`time +12`，事件結束，`item 一截紅領結`。成功：領結鬆了一點，你能控制自己的腳了；`time` 只擲三天到一週。失敗：領結扯不動。大失敗：同失敗。
  - 「跟它說話。」交涉 DC 22（吉祥物不能交涉，這一擲只看它有沒有反應）。成功：它停下來，舉起手，對你揮了一下，`memory 熊揮手`。失敗：它沒有反應。
  - 「打開錄影義體。」need：裝著錄影義體。效果：`flag mascot_record`（你回來後在紀錄裡找到這一段：畫面全黑，聲音是很多人在遠處拍手）。
- **第二段：回來**。你醒在出事的地方，委託的現場已經被清空，熊站過的地方留著一顆紅色的氣球，你的手腕上有一圈很淡的印子，形狀是一個蝴蝶結。
  - 「聽那一段錄音。」調查 DC 16。成功：你聽出拍手的聲音裡有一個人在念店名，`flag mascot_shopname`。失敗：你聽了三遍，只聽見拍手。
  - 「刪掉那一段。」效果：`flag mascot_record` 消掉；`condition 恍神（一天）`。
  - 「去找蜜糖會領懸賞的情報。」效果：`move 四十二番街`、`favor honey +1`，糖罐的保鑣長替你倒了一杯酒，說你是第一個回來還記得領結的人。

##### masc

**開場**：你最後記得的是熊把紅領結繫在你的手腕上，然後像牽小狗一樣牽著你走；你比它矮了一個頭，它每走三步就回頭看你一次。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，開場改成：你醒在委託現場的一張辦公椅上，雙手放在膝蓋上，姿勢端正得不像你自己，桌上放著一顆紅色的氣球。

##### yuri

**開場**：你最後記得的是熊蹲下來，用圓手套替你把頭髮撥到耳後，然後把紅領結繫在你的手腕上，打了一個很漂亮的結。

- **第一段**：`inherit default.stages.0`。
- **第二段**：`inherit default.stages.1`，開場改成：你醒在委託現場的地板上，身上蓋著一件你沒見過的白色開襟毛衣，袖口繡著一隻小熊，手邊放著一顆紅色的氣球。
