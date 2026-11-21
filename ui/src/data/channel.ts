/**
 * 頻道（OPINION 第 2 節、MEDIA 第 1、9 節、UI 6.2 節）。這份假存檔的頻道是「夜班之後」，潘妮當製作。
 */
export interface Show { id: string; name: string; what: string; check: string; time: string; cost: number; path?: '偶像' | '主播'; needs?: string }
export const SHOWS: Show[] = [
  { id: 'live', name: '現場', what: '新聞、街訪、突發', check: '街頭直覺或表演', time: '一個時段', cost: 300 },
  { id: 'feature', name: '專題', what: '調查、紀錄', check: '調查', time: '兩個時段', cost: 800 },
  { id: 'gossip', name: '八卦', what: '名人、談話', check: '交涉或表演', time: '一個時段', cost: 200 },
  { id: 'stream', name: '實況', what: '直播、表演、陪聊', check: '表演或誘惑', time: '一個時段', cost: 100 },
  { id: 'scoop', name: '獨家', what: '一段罪證或把柄', check: '調查或表演', time: '一個時段', cost: 500, path: '主播', needs: '要有主播（聚光燈 1 階起），和一段品質 3 以上、類型是罪證或把柄的素材。' },
]
/** 成人檔（OPINION 2.2 節）。 */
export const TIERS = [
  { id: 'all', name: '全年齡', sub: 1, tip: 1, cred: 0, fame: 0 },
  { id: 'edge', name: '擦邊', sub: 1.3, tip: 1.5, cred: -1, fame: 1 },
  { id: 'adult', name: '成人', sub: 1.6, tip: 2.5, cred: -2, fame: 2 },
] as const

export const GRADES = [
  { id: 'flop', name: '翻車', color: 'var(--warn)', views: 0.2, subs: -0.02, cred: -2 },
  { id: 'ok', name: '普通', color: 'var(--ink-3)', views: 0.5, subs: 0.01, cred: 0 },
  { id: 'good', name: '好', color: 'var(--ram)', views: 1, subs: 0.03, cred: 1 },
  { id: 'hit', name: '爆', color: 'var(--a)', views: 3, subs: 0.1, cred: 2 },
] as const

export interface Equipment { cls: string; grade: '消費級' | '專業級' | '企業級' | null; portable: boolean; bonus: number; itemGrade: 1 | 2 | 3 | 4 | 5 }
export const START_CHANNEL = {
  name: '夜班之後',
  subs: 860,
  cred: 54,
  weight: 1,
  history: [610, 640, 655, 700, 712, 730, 768, 790, 830, 860],
  budget: {
    ownAcc: 1240, ownCash: 300,
    sponsors: [
      { faction: '萬華鏡', paid: 3000, used: 400, terms: '每三集掛一次業配；不接擦邊與成人檔；不能報：賽琳·吳' },
    ],
  },
  staff: [
    { role: '製作', who: 'npc_penny', hired: false, loyalty: 58, wage: 0 },
    { role: '線人', who: null, hired: false, loyalty: 0, wage: 0, how: '牆報徵人，或用一個小人情向阿蓮要人。' },
  ] as Array<{ role: string; who: string | null; hired: boolean; loyalty: number; wage: number; how?: string }>,
  equipment: [
    { cls: '鏡頭', grade: '消費級', portable: true, bonus: 1, itemGrade: 1 },
    { cls: '收音', grade: '專業級', portable: true, bonus: 1, itemGrade: 3 },
    { cls: '燈光', grade: null, portable: false, bonus: 0, itemGrade: 1 },
    { cls: '剪輯機', grade: '消費級', portable: false, bonus: 1, itemGrade: 2 },
    { cls: '串流', grade: '消費級', portable: true, bonus: 1, itemGrade: 1 },
  ] as Equipment[],
  events: [
    { kind: '對手頻道', text: '萬華鏡街頭棚搶先播了七號塔的清查公告。', due: '2 天' },
    { kind: '觀眾', text: '爆料信箱來了一則料：藍鯨的倉管在舊港賭錢。', due: '這週' },
  ],
  episodes: [
    { grade: 'good', show: '現場', tier: '全年齡', mode: '直播', day: 13, change: '訂閱 +24；打賞 38' },
    { grade: 'ok', show: '八卦', tier: '擦邊', mode: '錄播', day: 11, change: '訂閱 +9', adult: true },
    { grade: 'flop', show: '專題', tier: '全年齡', mode: '錄播', day: 8, change: '公信力 −2' },
    { grade: 'hit', show: '實況', tier: '全年齡', mode: '直播', day: 6, change: '訂閱 +71；打賞 210' },
  ] as Array<{ grade: string; show: string; tier: string; mode: string; day: number; change: string; adult?: boolean }>,
}
export type ChannelState = typeof START_CHANNEL

/** 頻道等級：訂閱未滿 1,000 是 1 級（2 格），1,000 起 2 級（3 格），10,000 起 3 級（4 格）。 */
export function channelLevel(subs: number) { return subs >= 10000 ? 3 : subs >= 1000 ? 2 : 1 }
export const staffSlots = (subs: number) => channelLevel(subs) + 1

/**
 * 開一集的預覽（OPINION 2.3 節）：1d20 ＋ 主要基本功 ＋ 設備（最多 +6）＋ 編制 ＋ 片的品質，
 * 對 12 − 推薦權重（沒有媒體型技能時 +3）。回傳四個評價的機率（%）。
 */
export function episodePreview(o: { skill: number; gear: number; staff: number; quality: number; weight: number; mediaSkill: boolean }) {
  const mod = o.skill + Math.min(6, o.gear) + o.staff + o.quality
  const dc = 12 - o.weight + (o.mediaSkill ? 0 : 3)
  const p = (pred: (roll: number) => boolean) => { let n = 0; for (let d = 1; d <= 20; d++) if (pred(d)) n++; return n * 5 }
  const total = (d: number) => d + mod
  return {
    mod, dc,
    odds: {
      flop: p(d => total(d) <= dc - 5),
      ok: p(d => total(d) > dc - 5 && total(d) < dc),
      good: p(d => total(d) >= dc && total(d) < dc + 5),
      hit: p(d => total(d) >= dc + 5),
    },
  }
}
