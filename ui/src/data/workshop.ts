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
