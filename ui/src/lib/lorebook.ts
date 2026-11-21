/**
 * 世界書（PROMPTS 第 9 節）與生圖（第 10 節）的假資料與純函式；以及「和預設比較」用的逐行差異。
 * 格式照 SillyTavern 的世界書，本遊戲的欄位在 extensions.cpp（這裡攤平成 mode、adult、topics、tasks、districts、layer、gate）。
 */
export type LoreMode = 'constant' | 'keyword' | 'district' | 'layer' | 'off'
export const LORE_MODES: Array<{ id: LoreMode; name: string; when: string }> = [
  { id: 'constant', name: '常駐', when: '每次送，放固定前段' },
  { id: 'keyword', name: '關鍵字', when: '比對文字命中 key 時，放後段' },
  { id: 'district', name: '依區', when: '主角所在的區在 districts 裡時' },
  { id: 'layer', name: '依層', when: '報告有網內節拍或正在潛入時' },
  { id: 'off', name: '停用', when: '不送' },
]
export interface LoreEntry {
  uid: string; comment: string; key: string[]; content: string; order: number; mode: LoreMode
  adult?: boolean; topics?: string[]; tasks?: string[]; districts?: string[]; layer?: 'net' | 'meat'
  gate?: { flags?: string[]; minSink?: number }
  /** 內建的條目：topics 與 gate 只讀 */
  builtin?: boolean
}
export const LORE_DEFAULTS: LoreEntry[] = [
  { uid: 'wb_ave42_mid', comment: '四十二番街・中城段', key: ['四十二番街', '中城段', '過載'], mode: 'district', districts: ['ave42'], order: 10, builtin: true,
    content: '中城段是四十二番街的心臟。霓虹招牌一層疊一層，夜店「過載」的低頻從地板傳上來，人行道上擠滿下班的上班族、找客人的人偶與收保護費的人。這裡的人說話快、算錢更快。' },
  { uid: 'wb_hive', comment: '蜂巢', key: ['蜂巢', '四號塔', '天井市場'], mode: 'district', districts: ['hive'], order: 11, builtin: true,
    content: '蜂巢是一片擠在一起的高樓，走廊連著走廊，天井裡掛滿晾衣繩。樓長收房租，互助會管水電，市警不進來。這裡的人窮，但認得彼此。' },
  { uid: 'wb_monroe', comment: '夢露（公開）', key: ['夢露'], mode: 'keyword', order: 30, builtin: true, tasks: [],
    content: '夢露是四十二番街的中間人，在一間酒吧的後場接案。她說話慢，記性很好，從不在電話裡談價錢。' },
  { uid: 'wb_monroe_secret', comment: '夢露（揭露後）', key: ['夢露'], mode: 'keyword', order: 31, builtin: true, gate: { flags: ['monroe_truth'] },
    content: '夢露年輕時替緋櫻的稽核部做過事，她手上有幾份當年的帳。這件事只有少數人知道。' },
  { uid: 'wb_lace', comment: '蕾絲', key: ['蕾絲', '粉蕾絲', '白蕾絲'], mode: 'layer', layer: 'net', order: 20, builtin: true,
    content: '蕾絲是企業子網的守衛程式，外觀是穿著蕾絲制服的人形。白的拉警報，粉的把入侵者灌到過載、釘在線上，黑的很少見。' },
  { uid: 'wb_city', comment: '緋夜城的氛圍', key: [], mode: 'constant', order: 1, builtin: true,
    content: '緋夜城永遠是夜晚的顏色：雨、霓虹、蜂巢的晾衣繩、冠冕區的玻璃。橋把每個人接上內海，感官是貨幣，帳單是敵人。' },
  { uid: 'wb_adult_base', comment: '成人的敘事傾向', key: [], mode: 'constant', order: 2, adult: true, builtin: true, topics: [],
    content: '在這座城裡，感載就是快感的物理：橋把觸覺放大、把情緒寫進身體。所有角色都是成年人。' },
]
export type BudgetKey = 'city' | 'constant' | 'place' | 'keyword' | 'total' | 'adult'
export const BUDGET_DEFAULTS: Record<BudgetKey, number> = { city: 1500, constant: 3500, place: 2000, keyword: 5000, total: 12000, adult: 2000 }
export const BUDGET_NAMES: Record<BudgetKey, string> = { city: '城市常駐', constant: '其他常駐', place: '依區＋依層', keyword: '關鍵字＋search_lore', total: '合計', adult: '成人常駐（另計）' }

/** 一條條目算在哪一個預算 */
export function budgetOf(e: LoreEntry): BudgetKey | null {
  if (e.mode === 'off') return null
  if (e.mode === 'constant') return e.adult ? 'adult' : e.uid === 'wb_city' ? 'city' : 'constant'
  if (e.mode === 'district' || e.mode === 'layer') return 'place'
  return 'keyword'
}
/**
 * 字數預算（PROMPTS 9.6 節）：每一部分依 order 保留前面的，超出的標「超出預算」；合計另外算（成人常駐不算在合計裡）。
 * 回傳每一部分用了多少、每條的狀態。
 */
export function budgetUse(entries: LoreEntry[], budgets: Record<BudgetKey, number>) {
  const used: Record<BudgetKey, number> = { city: 0, constant: 0, place: 0, keyword: 0, total: 0, adult: 0 }
  const state: Record<string, '送' | '超出預算' | '停用'> = {}
  for (const e of [...entries].sort((a, b) => a.order - b.order)) {
    const b = budgetOf(e)
    if (!b) { state[e.uid] = '停用'; continue }
    const n = e.content.length
    const fitsPart = b === 'city' || used[b] + n <= budgets[b]
    const fitsTotal = b === 'adult' || used.total + n <= budgets.total
    if (fitsPart && fitsTotal) { used[b] += n; if (b !== 'adult') used.total += n; state[e.uid] = '送' }
    else state[e.uid] = '超出預算'
  }
  return { used, state }
}

// ---- 生圖（PROMPTS 第 10 節） ----
export const IMAGE_DEFAULTS = {
  preprocess: '把立繪的資料或一段正文換成生圖的標籤。所有人物都是成年人。只寫看得到的東西：服裝、義體、姿勢、光線、場景。',
  storyboard: '從一段正文挑一到四個畫面，每個畫面一行：誰、在哪、做什麼、鏡頭。交給 submit_storyboard。',
  styles: [{ id: 'neon', name: '賽博龐克・霓虹・深紫黑', tags: 'cyberpunk, neon lights, rain, purple black palette' }, { id: 'manga', name: '漫畫網點', tags: 'manga screentone, ink lines, high contrast' }],
  style: 'neon',
  tagMap: [{ k: '義眼', v: 'cybernetic eye, glowing iris' }, { k: '義臂', v: 'chrome prosthetic arm' }, { k: '獸耳', v: 'animal ears' }, { k: '女僕服', v: 'maid outfit' }, { k: '霓虹龐克', v: 'neon punk fashion' }],
  negative: 'lowres, bad anatomy, extra fingers',
  negativeAdult: 'lowres, bad anatomy',
}
/** 年齡相關的負面標籤鎖住，玩家只能往後加（H5） */
export const LOCKED_NEGATIVE = 'child, loli, shota, underage, young-looking, petite child body'
export const IMAGE_ROUTES = [
  { what: '一般的紀錄、立繪', route: '一般' },
  { what: 'adult_soft 的紀錄', route: '一般：畫到曖昧為止' },
  { what: 'adult_scene 的紀錄', route: '成人（image_adult）；標籤照場景紀錄的體位與連接' },
  { what: '戰敗事件', route: '前半一般，後半有場景時成人' },
]

// ---- 和預設比較 ----
export type DiffLine = { op: ' ' | '+' | '-'; text: string }
/** 逐行差異（最長共同子序列）：預設是 a，現在是 b */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a ? a.split('\n') : [], B = b ? b.split('\n') : []
  const n = A.length, m = B.length
  const L: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: ' ', text: A[i] }); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: A[i++] })
    else out.push({ op: '+', text: B[j++] })
  }
  while (i < n) out.push({ op: '-', text: A[i++] })
  while (j < m) out.push({ op: '+', text: B[j++] })
  return out
}
/** 一條世界書條目和預設的差別：新增、停用、改了哪些欄位 */
export function loreChanges(cur: LoreEntry[], defaults: LoreEntry[] = LORE_DEFAULTS) {
  const out: Array<{ uid: string; name: string; kind: '新增' | '刪除' | '改過'; fields: string[] }> = []
  for (const e of cur) {
    const d = defaults.find(x => x.uid === e.uid)
    if (!d) { out.push({ uid: e.uid, name: e.comment, kind: '新增', fields: [] }); continue }
    const fields = (Object.keys({ ...d, ...e }) as Array<keyof LoreEntry>).filter(k => JSON.stringify(d[k]) !== JSON.stringify(e[k]))
    if (fields.length) out.push({ uid: e.uid, name: e.comment, kind: '改過', fields: fields as string[] })
  }
  for (const d of defaults) if (!cur.some(e => e.uid === d.uid)) out.push({ uid: d.uid, name: d.comment, kind: '刪除', fields: [] })
  return out
}
