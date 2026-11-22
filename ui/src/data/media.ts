/**
 * 媒體（MEDIA 第 1～5 節、mockups/overlays.html 的 #live 與 #cut）：直播面板、紀錄、素材、剪片、發布。假資料與純函式。
 */
export interface LiveGoal { id: string; name: string; kind: 'combat' | 'daily'; check: (lines: string[]) => boolean }
const count = (lines: string[], re: RegExp) => lines.filter(l => re.test(l)).length
/** 直播目標（MEDIA 1.2 節）：開播時從模板的清單抽一到三個，結束時逐條檢查 */
export const LIVE_GOALS: LiveGoal[] = [
  { id: 'crit2', name: '打出兩次要害', kind: 'combat', check: l => count(l, /^(?!敵・).*要害/) >= 2 },
  { id: 'over2', name: '讓敵人過載兩次', kind: 'combat', check: l => count(l, /^敵・.*過載！/) >= 2 },
  { id: 'nodown', name: '不讓任何人倒下（打完才算）', kind: 'combat', check: l => l.some(x => x === '勝利。') && !l.some(x => /^(?!敵・)\S+ (倒下|失血倒下|斷線)/.test(x)) },
  { id: 'down3', name: '打倒三個敵人', kind: 'combat', check: l => count(l, /^敵・.*(被打倒|被制伏|倒下|斷線|被釘在線上)/) >= 3 },
  { id: 'subdue', name: '制伏一個敵人', kind: 'combat', check: l => count(l, /被制伏|被釘在線上/) >= 1 },
  { id: 'talk', name: '陪聊滿一個時段', kind: 'daily', check: () => true },
  { id: 'tip', name: '收到三筆打賞', kind: 'daily', check: () => false },
]
/** 現實戰鬥的直播事件：從引擎報告的每一拍（timeline[].tag）整理出來的（lib/liveEvents.ts）。good：對我方有利（我方打出要害、敵人過載或倒下）。 */
export interface LiveEvent { tag: string; good: boolean; text: string; outcome?: string }
const tagCount = (ev: LiveEvent[], tag: string, good?: boolean) => ev.filter(e => e.tag === tag && (good === undefined || e.good === good)).length
export interface LiveEventGoal { id: string; name: string; check: (ev: LiveEvent[]) => boolean }
/** 戰鬥直播的目標（現實戰鬥的小窗用；檢查的是引擎發出的事件，不掃文字） */
export const COMBAT_LIVE_GOALS: LiveEventGoal[] = [
  { id: 'crit2', name: '打出兩次要害', check: ev => tagCount(ev, 'crit', true) >= 2 },
  { id: 'over2', name: '讓敵人過載兩次', check: ev => tagCount(ev, 'overload', true) >= 2 },
  { id: 'nodown', name: '不讓任何人倒下（打完才算）', check: ev => ev.some(e => e.tag === 'battle.end' && e.outcome === 'win') && tagCount(ev, 'down', false) === 0 },
  { id: 'down3', name: '打倒三個敵人', check: ev => tagCount(ev, 'down', true) + tagCount(ev, 'subdue', true) >= 3 },
  { id: 'subdue', name: '制伏一個敵人', check: ev => tagCount(ev, 'subdue', true) >= 1 },
]
/** 亮點（熱度各 +1）：我方的要害、過載、打倒或制伏敵人 */
export function eventHighlights(ev: LiveEvent[]): string[] {
  const out: string[] = []
  for (const e of ev) {
    if (e.tag === 'crit' && e.good) out.push('打出要害')
    else if (e.tag === 'overload') out.push(e.good ? '敵人過載' : '我方有人過載')
    else if ((e.tag === 'down' || e.tag === 'subdue') && e.good) out.push('打倒一個敵人')
  }
  return out
}
/** 亮點：要害、過載、打倒敵人、有人只剩一口氣（熱度各 +1） */
export function liveHighlights(lines: string[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (/要害/.test(l)) out.push('打出要害')
    else if (/過載！/.test(l)) out.push(l.startsWith('敵・') ? '敵人過載' : '我方有人過載')
    else if (/^敵・.*(被打倒|被制伏|斷線|被釘在線上)/.test(l)) out.push('打倒一個敵人')
  }
  return out
}
/** 收播：熱度換成訂閱與打賞（每點熱度約 6 個訂閱；打賞照觀看數） */
export function liveSettle(heat: number, viewers: number, tips: number) {
  return { subs: Math.max(0, Math.round(heat * 6 + viewers / 400)), tips: tips + heat * 8 }
}
export const LIVE_DANMAKU = [
  { who: '阿豪', text: '這槍好準' }, { who: '夜貓', text: '左邊那個要倒了' }, { who: 'neon_77', text: '主播不要死啊' }, { who: '小葵', text: '打賞 20 給奈奈' },
  { who: '夜貓', text: '敵人在叫增援了吧' }, { who: '路人甲', text: '這是哪一區？' }, { who: 'mika', text: '8888888' }, { who: '阿豪', text: '打賞 20：請喝蜜醇' },
]

/** 戰鬥直播的彈幕：照戰鬥紀錄的一行決定觀眾的反應（沒有反應回 null）。kind：hot 大字、gift 打賞色 */
const REACT: Array<{ re: RegExp; pool: string[]; kind?: 'hot' | 'gift' }> = [
  { re: /自然 20/, pool: ['自然20！！！', '神骰', '截圖截圖', '這發會上精華'], kind: 'hot' },
  { re: /^(?!敵・).*要害/, pool: ['要害ｷﾀ━(ﾟ∀ﾟ)━!', '這槍好準', '8888888', '爆頭啦', '好帥'], kind: 'hot' },
  { re: /^敵・.*要害/, pool: ['痛痛痛', '主播小心！', '這下吃滿了', '找掩護啊'] },
  { re: /^敵・.*過載！/, pool: ['過載了ww', '臉紅了臉紅了', '草', '對面撐不住了', '再來一發！'] },
  { re: /^(?!敵・).*過載！/, pool: ['欸欸欸', '主播臉好紅', '撐住！', '這個表情可以'] },
  { re: /^敵・.*被制伏/, pool: ['壓住了！！', '逮到', '活捉ww', '這個可以截圖嗎'], kind: 'hot' },
  { re: /^敵・.*(被打倒|倒下)/, pool: ['下一個', 'GG', '一個', '漂亮', '收工收工'] },
  { re: /^(?!敵・)\S+ (倒下|失血倒下)/, pool: ['不要啊', '倒了倒了', '醫生！', '主播不要死啊'] },
  { re: /^敵・.*沒打中|^敵・.*被遮蔽擋下/, pool: ['閃得好', '沒中ww', '掩體立大功'] },
  { re: /被壓制/, pool: ['壓到頭都抬不起來', '火力好猛'] },
  { re: /快駭.*拿下了|拿下了。/, pool: ['駭客好帥', '整棟都是我們的了'] },
  { re: /啟動/, pool: ['機甲！！', '大傢伙來了', '這台多少錢'], kind: 'hot' },
  { re: /擊落/, pool: ['打下來了', '無人機掰掰'] },
  { re: /^勝利/, pool: ['GG！', '辛苦了～', '888888', '贏啦'], kind: 'hot' },
]
export function liveReact(line: string, rnd: () => number = Math.random): { text: string; kind?: 'hot' | 'gift' } | null {
  const r = REACT.find(x => x.re.test(line))
  return r ? { text: r.pool[Math.floor(rnd() * r.pool.length)], kind: r.kind } : null
}

// ---- 紀錄、素材、片 ----
export type FootageKind = '戰鬥' | '醜聞' | '罪證' | '親密' | '名人' | '日常'
export interface MediaRecord { id: string; name: string; day: number; kind: FootageKind; recorded: boolean; live?: boolean; converted?: boolean; adult?: boolean }
export interface Footage { id: string; name: string; kind: FootageKind; quality: number; who: string[]; truth: '真的' | '剪過的' | '偽造的'; exclusive: boolean }
export type Angle = '揭弊' | '英雄' | '煽情' | '抹黑'
export interface Cut { id: string; name: string; parts: string[]; angle: Angle; looks: number; cred: number; risk: number; forged: boolean; published?: string }
export const ANGLES: Array<{ id: Angle; card: '說法' | '料'; what: string }> = [
  { id: '揭弊', card: '說法', what: '公信力 +；目標勢力的聲望大跌、敵對值大增' },
  { id: '英雄', card: '說法', what: '街頭信譽 +；把自己或隊友塑造成傳說' },
  { id: '煽情', card: '料', what: '訂閱 +，公信力 −' },
  { id: '抹黑', card: '料', what: '把責任導向另一個勢力' },
]
export const START_MEDIA = {
  recording: true,
  records: [
    { id: 'r1', name: '藍鯨第三倉・第二階段', day: 12, kind: '戰鬥', recorded: true },
    { id: 'r2', name: '碼頭的交貨', day: 11, kind: '罪證', recorded: true, converted: true },
    { id: 'r3', name: '和琥珀在半夢', day: 12, kind: '親密', recorded: false, adult: true },
    { id: 'r4', name: '熔爐的黑拳', day: 5, kind: '日常', recorded: true, converted: true },
  ] as MediaRecord[],
  footage: [
    { id: 'f1', name: '碼頭的交貨', kind: '罪證', quality: 4, who: ['藍鯨物流', '緋櫻系的晶片'], truth: '真的', exclusive: true },
    { id: 'f2', name: '熔爐的黑拳', kind: '日常', quality: 2, who: ['鉻娘子'], truth: '真的', exclusive: false },
  ] as Footage[],
  // 第四版：一支已經剪好的片（揭弊，用碼頭的交貨），輿論戰的牌庫會多一張「片」
  cuts: [{ id: 'c1', name: '碼頭的交貨', parts: ['f1'], angle: '揭弊', looks: 4, cred: 4, risk: 2, forged: false }] as Cut[],
}
export type MediaState = typeof START_MEDIA

/** 素材的品質：紀錄的類型給底，超過一週 −1（MEDIA 1.1 節） */
export function footageQuality(r: MediaRecord, today: number) {
  const base: Record<FootageKind, number> = { 戰鬥: 3, 醜聞: 3, 罪證: 4, 親密: 3, 名人: 3, 日常: 2 }
  return Math.max(1, base[r.kind] - (today - r.day > 7 ? 1 : 0))
}
/**
 * 剪片的三個數字（MEDIA 3 節）：看點、可信、風險。
 * 看點 = 品質合計 ＋（煽情 +2、抹黑 +1）；可信 = 品質平均 × 2 ＋（揭弊、英雄 +2；偽造 −3）；
 * 風險 = 涉及的勢力最高等級（這一版當作 2）＋ 偽造 5 ＋ 抹黑 3；擲 d20 擲出風險以下出事。
 */
export function cutStats(parts: Footage[], angle: Angle, forged: boolean) {
  if (!parts.length) return { looks: 0, cred: 0, risk: 0 }
  const q = parts.reduce((s, f) => s + f.quality, 0)
  const looks = q + (angle === '煽情' ? 2 : angle === '抹黑' ? 1 : 0)
  const cred = Math.max(0, Math.round((q / parts.length) * 2) + (angle === '揭弊' || angle === '英雄' ? 2 : 0) - (forged ? 3 : 0))
  const risk = 2 + (forged ? 5 : 0) + (angle === '抹黑' ? 3 : 0)
  return { looks, cred, risk }
}
/** 發布的做法（MEDIA 第 5 節） */
export const PUBLISH = [
  { id: 'upload', name: '直接上架', what: '照看點與可信算一次：訂閱、公信力、目標勢力的聲望與敵對值。可以匿名：效果七成、不加敵對值' },
  { id: 'card', name: '帶進輿論戰', what: '變成一張牌（揭弊、英雄是說法；煽情、抹黑是料）；和議題有關才進得去' },
  { id: 'episode', name: '開一集', what: '當成錄播的片，品質加在頻道的檢定上' },
  { id: 'sell', name: '賣斷', what: '賣給萬華鏡或緋櫻映畫，拿一筆錢' },
  { id: 'deal', name: '拿去談判', what: '給當事人看，換錢、人情或讓步' },
  { id: 'keep', name: '留著', what: '保命符：被那個勢力抓到時多一條分支' },
] as const
