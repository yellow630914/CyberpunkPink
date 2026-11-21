/**
 * AI 工坊的假資料（PROMPTS 第 2 節、AI_TASKS 第 4 節、樣稿 docs/mockups/ai-workshop.html）。
 * 這個參考實作不送出任何請求；預覽只把一份請求照順序排出來。
 */
export const TASK_GROUPS: Array<{ name: string; tasks: Array<{ id: string; name: string; model: '大' | '中' | '小'; adult?: boolean; when: string }> }> = [
  { name: '每一回合', tasks: [
    { id: 'judge', name: '判定', model: '中', when: '自由行動擲骰之後；打工、事件的「我要做別的」' },
    { id: 'narrate', name: '寫正文', model: '大', when: '每一條有正文的鏈，排在結果任務之後' },
    { id: 'reward', name: '算回報', model: '小', when: '判定與參考範圍之後、寫正文之前' },
    { id: 'relate', name: '算關係', model: '小', when: '寫正文之前，在場有具名的 NPC 時' },
  ] },
  { name: '成人場景', tasks: [
    { id: 'scene_gate', name: '進不進場景', model: '中', adult: true, when: '互動可能走到成人場景時' },
    { id: 'scene_turn', name: '對方的行動', model: '中', adult: true, when: '成人場景的每一回合' },
    { id: 'scene_talk', name: '說話的判定', model: '小', adult: true, when: '場景裡說話時' },
    { id: 'sex_record', name: '算性經歷', model: '小', adult: true, when: '場景結束之後' },
    { id: 'sink', name: '算沉溺', model: '小', adult: true, when: '場景結束之後' },
    { id: 'tendency', name: '算傾向', model: '小', adult: true, when: '場景結束之後' },
  ] },
  { name: '輿論戰與委託', tasks: [
    { id: 'pr_move', name: '對手的行動', model: '中', when: '輿論戰的對手回合' },
    { id: 'commission_gen', name: '委託的內容', model: '中', when: '中間人推委託時' },
  ] },
  { name: '按需', tasks: [
    { id: 'npc_act', name: '談判的選項', model: '小', when: '談判的每一輪' },
    { id: 'flavor_roster', name: '新的人的細節', model: '小', when: '名冊出現新的人' },
    { id: 'flavor_shop', name: '今天的貨', model: '小', when: '走進一間店，那天第一次' },
    { id: 'npc_news', name: 'NPC 的近況', model: '小', when: '長休醒來' },
    { id: 'design_part', name: '訂做零件', model: '中', when: '向社團訂做零件時' },
  ] },
  { name: '媒體', tasks: [
    { id: 'stream_goal', name: '直播目標的說法', model: '小', when: '開播時' },
    { id: 'stream_chat', name: '彈幕', model: '小', when: '直播中' },
    { id: 'footage_caption', name: '素材的標題', model: '小', when: '做成素材時' },
  ] },
  { name: 'Agent 支線', tasks: [
    { id: 'agent_hook', name: '寫完正文之後', model: '中', when: 'Agent 模式開著時' },
    { id: 'agent_event', name: '走進一個街區', model: '中', when: 'Agent 模式開著時' },
    { id: 'agent_night', name: '長休醒來', model: '中', when: 'Agent 模式開著時' },
    { id: 'agent_commission', name: '接委託時', model: '中', when: 'Agent 模式開著時' },
    { id: 'agent_flavor', name: '進店與見到新的人', model: '小', when: 'Agent 模式開著時' },
  ] },
  { name: '工具類', tasks: [
    { id: 'image_prompt', name: '生成立繪、紀錄插圖', model: '小', when: '要畫圖時' },
    { id: 'storyboard', name: '紀錄插圖的分鏡', model: '小', when: '要畫紀錄插圖時' },
    { id: 'quest_designer', name: '特殊任務生成', model: '大', when: '世界編輯器' },
    { id: 'connection_test', name: '連線測試', model: '小', when: '模型與路由' },
    { id: 'prompt_review', name: '請 AI 看一下', model: '中', when: 'AI 工坊的檢查' },
  ] },
]
export const ALL_TASKS = TASK_GROUPS.flatMap(g => g.tasks)

export const SOURCES = [
  { id: 'main', name: '主力', sub: 'Anthropic・金鑰只存在這台機器', ok: true, tools: true },
  { id: 'small', name: '便宜的小模型', sub: '相容 OpenAI 的服務・本機的伺服器', ok: true, tools: true },
  { id: 'adult', name: '成人路由', sub: '相容 OpenAI 的服務', ok: true, tools: false },
]
/** 任務預設用哪個來源：大與中用主力，小用便宜的小模型；成人的任務走成人路由。 */
export const defaultSource = (t: { model: string; adult?: boolean }) => (t.adult ? 'adult' : t.model === '小' ? 'small' : 'main')

export const CHAINS = [
  '自由行動', '移動', '喘口氣', '交易', '和人說話', '送禮', '打工的一班', '事件的開頭', '事件的「我要做別的」', '戰鬥', '戰敗', '成人場景',
  '成人場景的收尾', '委託的開場', '談判', '收尾', '直播', '輿論戰的對手', '長休', '素材', '訂做', '世界編輯器的生成', '接案',
]

/** 變數字典（PROMPTS 2.9 節）：值由畫面從存檔取，這裡只列名字與說明。 */
export const VARIABLES = [
  { v: '{{city}}', what: '城市名', cache: true },
  { v: '{{language}}', what: '輸出語言', cache: true },
  { v: '{{style}}', what: '文風', cache: true },
  { v: '{{hard_rules}}', what: '硬規則（只讀）', cache: true },
  { v: '{{limits}}', what: '內容界線，由內容篩選產生（只讀）', cache: true },
  { v: '{{time}}', what: '遊戲裡的時間', cache: false },
  { v: '{{place}}', what: '所在的地點', cache: false },
  { v: '{{actor.name}}', what: '主角的名字', cache: false },
  { v: '{{actor.attrs.charm}}', what: '主角的魅力', cache: false },
  { v: '{{cast[0].name}}', what: '在場的第一個人', cache: false },
  { v: '{{cap.cash_max}}', what: '這一次現金的上限', cache: false },
]

export const SETS = [
  { name: '預設組', note: '改過 6 處：寫正文四塊、今天的貨一塊、用語對照一列' },
  { name: '冷一點的主持人', note: '改過 12 處：判定與寫正文的規則、兩種文風的順序' },
  { name: '從 SillyTavern 匯入的預設', note: '匯入 9 個條目與 3 條正則；正則都還停用著' },
]
export const RECENT = ['第 42 樓・自由行動：在露露餐館打聽緋櫻的人', '第 41 樓・移動：走進四十二番街的「井」', '第 39 樓・接委託：中間人的開場', '樣本情境：乞討（蜂巢，成功）', '樣本情境：撬鎖（舊港，大失敗）']

/**
 * 任務鏈的流程圖（AI_TASKS 第 2、3 節）：每一步是程式、AI 任務、等玩家或套用；deps 是依賴（步驟的序號，從 1 起算）。
 * 同一層（依賴都在前面）的步驟並排畫。opt 是可以關掉的那一步對應的設定（點節點切換）；inSettings 標「設定裡也有」。
 */
export type StepKind = 'code' | 'ai' | 'wait' | 'apply'
export interface ChainStep { n: string; kind: StepKind; task?: string; deps: number[]; opt?: string; inSettings?: boolean; note?: string }
export const CHAIN_FLOWS: Record<string, ChainStep[]> = {
  自由行動: [
    { n: '擲骰', kind: 'code', deps: [] },
    { n: '判定', kind: 'ai', task: 'judge', deps: [1], opt: 'judgeFree', inSettings: true },
    { n: '參考範圍', kind: 'code', deps: [2] },
    { n: '新的人', kind: 'ai', task: 'flavor_roster', deps: [2], opt: 'aiRecord.newPeople', note: '帶出新的人時才跑' },
    { n: '算回報', kind: 'ai', task: 'reward', deps: [2, 3] },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [2, 4], note: '在場有具名的 NPC 時' },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [4, 5, 6], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [7] },
  ],
  移動: [
    { n: '移動結算', kind: 'code', deps: [] },
    { n: '事件導演', kind: 'code', deps: [1] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [1, 2], opt: 'narrate', inSettings: true, note: '只在走進新的街區或設施時' },
    { n: '套用', kind: 'apply', deps: [3] },
  ],
  交易: [
    { n: '交易結算', kind: 'code', deps: [] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [1], opt: 'tradeProse' },
    { n: '套用', kind: 'apply', deps: [2] },
  ],
  喘口氣: [
    { n: '休息結算', kind: 'code', deps: [] },
    { n: '套用', kind: 'apply', deps: [1] },
  ],
  長休: [
    { n: '休息結算', kind: 'code', deps: [] },
    { n: '事件導演', kind: 'code', deps: [1] },
    { n: 'NPC 的近況', kind: 'ai', task: 'npc_news', deps: [1], opt: 'aiRecord.npcNews' },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [1, 2, 3], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [4] },
  ],
  戰鬥: [
    { n: '玩家與隊友的行動', kind: 'wait', deps: [] },
    { n: '結算', kind: 'code', deps: [1] },
    { n: '直播', kind: 'code', deps: [2], note: '開著直播時算亮點' },
    { n: '寫正文（每回合）', kind: 'ai', task: 'narrate', deps: [2], opt: 'combatProse', note: '預設不跑：戰鬥結束時整場寫一次' },
    { n: '套用（戰鬥狀態）', kind: 'apply', deps: [3, 4] },
  ],
  輿論戰的對手: [
    { n: '城市事件', kind: 'code', deps: [] },
    { n: '抽牌', kind: 'code', deps: [1] },
    { n: '玩家出牌與技能', kind: 'wait', deps: [2] },
    { n: '累積', kind: 'code', deps: [3] },
    { n: '玩家佔領', kind: 'wait', deps: [4] },
    { n: '對手的行動', kind: 'ai', task: 'pr_move', deps: [5] },
    { n: '驗證並結算對手', kind: 'code', deps: [6] },
    { n: '收買的回應', kind: 'wait', deps: [7] },
    { n: '結束的檢查', kind: 'code', deps: [7, 8] },
    { n: '套用（戰役狀態）', kind: 'apply', deps: [9] },
  ],
  接案: [
    { n: '組骨架', kind: 'code', deps: [] },
    { n: '寫委託的內容', kind: 'ai', task: 'commission_gen', deps: [1] },
    { n: '驗證並建立副本', kind: 'code', deps: [2] },
    { n: '寫中間人的開場', kind: 'ai', task: 'narrate', deps: [3], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [4] },
  ],
  直播: [
    { n: '亮點', kind: 'code', deps: [] },
    { n: '彈幕', kind: 'ai', task: 'stream_chat', deps: [1], opt: 'aiRecord.danmaku' },
    { n: '驗證', kind: 'code', deps: [2] },
    { n: '套用', kind: 'apply', deps: [3] },
  ],
  素材: [
    { n: '素材的數值', kind: 'code', deps: [] },
    { n: '標題與說明', kind: 'ai', task: 'footage_caption', deps: [1], opt: 'aiRecord.footageTitle' },
    { n: '套用', kind: 'apply', deps: [2] },
  ],
  // ---- 第四版補上的 13 條（AI_TASKS 第 3 節） ----
  和人說話: [
    { n: '給選項', kind: 'ai', task: 'npc_act', deps: [] },
    { n: '驗證選項', kind: 'code', deps: [1] },
    { n: '玩家選', kind: 'wait', deps: [2], note: '也可以自己寫，改走自由行動' },
    { n: '擲骰', kind: 'code', deps: [3] },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [4] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [4, 5], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [6] },
  ],
  送禮: [
    { n: '禮物的價值', kind: 'code', deps: [], note: '價值、合不合他的風格（預覽在送之前就看得到）' },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [1] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [1, 2], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [3] },
  ],
  打工的一班: [
    { n: '擲骰', kind: 'code', deps: [], note: '不擲的工作（人偶晶片、片場）略過' },
    { n: '判定', kind: 'ai', task: 'judge', deps: [1], opt: 'judgeWork', inSettings: true },
    { n: '結算', kind: 'code', deps: [2] },
    { n: '事件導演', kind: 'code', deps: [3], note: '每班 15%' },
    { n: '算回報', kind: 'ai', task: 'reward', deps: [2, 3], note: '只有小費、扣錢與偷聽到的情報' },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [2, 3] },
    { n: '升階的檢查', kind: 'code', deps: [3, 6] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [3, 5, 6], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [4, 7, 8] },
  ],
  事件的開頭: [
    { n: '事件放行', kind: 'code', deps: [] },
    { n: '寫開頭', kind: 'ai', task: 'narrate', deps: [1], note: 'event_open；失敗時顯示模板的開頭' },
    { n: '玩家選選項', kind: 'wait', deps: [2] },
    { n: '擲骰', kind: 'code', deps: [3], note: '選項有檢定時' },
    { n: '結算效果', kind: 'code', deps: [4] },
    { n: '進不進場景', kind: 'ai', task: 'scene_gate', deps: [5], note: '結果帶成人場景時才跑' },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [5, 6] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [5, 6, 7], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [8] },
  ],
  '事件的「我要做別的」': [
    { n: '擲骰', kind: 'code', deps: [] },
    { n: '判定', kind: 'ai', task: 'judge', deps: [1], opt: 'judgeEvent', inSettings: true },
    { n: '參考範圍', kind: 'code', deps: [2], note: '上限照 EVENTS 2.4 節' },
    { n: '算回報', kind: 'ai', task: 'reward', deps: [2, 3] },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [2] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [4, 5], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [6] },
  ],
  戰敗: [
    { n: '選戰敗事件', kind: 'code', deps: [] },
    { n: '寫前半段', kind: 'ai', task: 'narrate', deps: [1], note: 'defeat_cliffhanger：停在對方動手之前' },
    { n: '玩家回應', kind: 'wait', deps: [2] },
    { n: '擲骰', kind: 'code', deps: [3] },
    { n: '結算效果', kind: 'code', deps: [4] },
    { n: '進不進場景', kind: 'ai', task: 'scene_gate', deps: [5], note: '這一版有成人走向時' },
    { n: '收尾段', kind: 'code', deps: [5, 6], note: '有場景時引用成人場景的收尾' },
    { n: '套用', kind: 'apply', deps: [7], note: '委託失敗時先寫進紀錄與記憶，再回退' },
  ],
  成人場景: [
    { n: '玩家行動', kind: 'wait', deps: [] },
    { n: '結算玩家的行動', kind: 'code', deps: [1] },
    { n: '說話的判定', kind: 'ai', task: 'scene_talk', deps: [2], note: '用了「說話」時才跑' },
    { n: '對方的行動', kind: 'ai', task: 'scene_turn', deps: [2, 3] },
    { n: '驗證並結算對方', kind: 'code', deps: [4] },
    { n: '連接的自動效果', kind: 'code', deps: [5] },
    { n: '別的圈', kind: 'code', deps: [6] },
    { n: '強制結束與直播', kind: 'code', deps: [7] },
    { n: '套用', kind: 'apply', deps: [8] },
  ],
  成人場景的收尾: [
    { n: '場景的結算', kind: 'code', deps: [] },
    { n: '算回報', kind: 'ai', task: 'reward', deps: [1] },
    { n: '算性經歷', kind: 'ai', task: 'sex_record', deps: [1], opt: 'aiRecord.sexRecord' },
    { n: '算沉溺', kind: 'ai', task: 'sink', deps: [1] },
    { n: '算傾向', kind: 'ai', task: 'tendency', deps: [1] },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [1] },
    { n: '寫正文（成人路由）', kind: 'ai', task: 'narrate', deps: [2, 3, 4, 5, 6], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [7] },
  ],
  委託的開場: [
    { n: '選面與派人', kind: 'wait', deps: [] },
    { n: '輔助面的結算', kind: 'code', deps: [1] },
    { n: '事件導演', kind: 'code', deps: [1], note: '每個階段最多一件' },
    { n: '選分支', kind: 'wait', deps: [2], note: '連動與踩點開出來的路' },
    { n: '玩這一段', kind: 'code', deps: [4], note: '現實、內海或輿論的子鏈' },
    { n: '里程碑與壓力條', kind: 'code', deps: [5] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [2, 6], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [3, 7] },
  ],
  談判: [
    { n: '給選項', kind: 'ai', task: 'npc_act', deps: [] },
    { n: '驗證選項', kind: 'code', deps: [1] },
    { n: '玩家選', kind: 'wait', deps: [2] },
    { n: '擲骰', kind: 'code', deps: [3] },
    { n: '結算', kind: 'code', deps: [4] },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [5] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [5, 6], note: 'deal：話裡的角力', opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [7] },
  ],
  收尾: [
    { n: '戰鬥的結算', kind: 'code', deps: [], note: '勝負、掉落、倒下的人、俘虜' },
    { n: '算關係', kind: 'ai', task: 'relate', deps: [1] },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [1, 2], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [3], note: '全隊倒下時接戰敗' },
  ],
  訂做: [
    { n: '玩家的描述', kind: 'wait', deps: [] },
    { n: '擲骰', kind: 'code', deps: [1] },
    { n: '設計', kind: 'ai', task: 'design_part', deps: [1, 2] },
    { n: '夾值', kind: 'code', deps: [3], note: 'CRAFTING 第 11 節' },
    { n: '寫正文', kind: 'ai', task: 'narrate', deps: [4], opt: 'narrate', inSettings: true },
    { n: '套用', kind: 'apply', deps: [5] },
  ],
  世界編輯器的生成: [
    { n: '玩家的描述', kind: 'wait', deps: [] },
    { n: '組骨架', kind: 'code', deps: [1], note: '照欄位表' },
    { n: '生成內容', kind: 'ai', task: 'quest_designer', deps: [2] },
    { n: '格式與底線的檢查', kind: 'code', deps: [3], note: '和匯入同一套驗證' },
    { n: '玩家確認', kind: 'wait', deps: [4] },
    { n: '套用', kind: 'apply', deps: [5] },
  ],
}
/** 流程圖的版面：每一步的層（依賴都在前一層以前）與在那一層的第幾個 */
export function chainLayout(steps: ChainStep[]) {
  const level: number[] = []
  steps.forEach((s, i) => { level[i] = s.deps.length ? Math.max(...s.deps.map(d => level[d - 1] + 1)) : 0 })
  const rowIn: number[] = []
  const count: Record<number, number> = {}
  steps.forEach((_, i) => { rowIn[i] = count[level[i]] ?? 0; count[level[i]] = rowIn[i] + 1 })
  return { level, rowIn, cols: Math.max(...level) + 1, rows: Math.max(...Object.values(count)) }
}
