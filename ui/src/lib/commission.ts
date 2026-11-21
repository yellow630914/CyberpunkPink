import { d20, type Rng } from './combat/rng'

/**
 * 委託的四拍（FIXER 第 2 節、COMMISSIONS 第 2～6 節、UI.md 第 7 節）：接案（談判、怎麼付）→ 踩點 → 召集（分帳、輔助面）→ 副本（階段、面、分支、連動）。
 * 純函式；假資料在 data/commission.ts。
 */
export type Face = 'm' | 'n' | 'o'
export const FACE_NAME: Record<Face, string> = { m: '現實', n: '內海', o: '輿論' }

/** 怎麼付（FIXER 第 2 節①）：現金晶片全額；匯進帳戶 85% 並讓目標勢力敵對值 +2；三成換人情 70% ＋ 一個小人情（換成人情的部分不抽成） */
export type PayMode = 'cash' | 'acc' | 'fav'
export function payOptions(reward: number) {
  return [
    { id: 'cash' as PayMode, name: '現金晶片', get: reward, cost: '查不到。付房租前要先洗。' },
    { id: 'acc' as PayMode, name: '匯進帳戶', get: Math.round(reward * 0.85), cost: '雇主替你洗，−15%；目標勢力敵對值 +2。' },
    { id: 'fav' as PayMode, name: '三成換人情', get: Math.round(reward * 0.7), cost: '中間人欠你一個小人情；這部分她不抽成。' },
  ]
}

/** 談判：一輪交涉可以把報酬往上推，超過底線中間人會不高興（交涉對 DC 13，成功 +5%、大成功 +10%，最多到底線 ×1.15） */
export function negotiate(cur: number, floor: number, roll: number, mod: number) {
  const tot = roll + mod
  if (roll === 1) return { value: cur, text: `交涉 1d20(${roll}) + ${mod}：自然 1，她不想再談了。`, done: true }
  if (tot >= 18) return { value: Math.min(Math.round(floor * 1.15), Math.round(cur * 1.1)), text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：大成功，報酬 +10%。`, done: false }
  if (tot >= 13) return { value: Math.min(Math.round(floor * 1.15), Math.round(cur * 1.05)), text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：成功，報酬 +5%。`, done: false }
  return { value: cur, text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：她不讓步。`, done: false }
}

/** 分帳（UI 7.3 節）：先扣中間人抽成（換人情的部分不抽）與出場費；剩下在場的人均分，你多拿一份當老闆 */
export function split(o: { reward: number; cut: number; pay: PayMode; fees: number; members: number }) {
  const base = payOptions(o.reward).find(p => p.id === o.pay)!.get
  const cut = o.pay === 'fav' ? 0 : Math.round(base * o.cut)
  const rest = Math.max(0, base - cut - o.fees)
  const shares = o.members + 1
  const mine = Math.round((rest / shares) * 2)
  return { base, cut, fees: o.fees, rest, mine, each: Math.round(rest / shares) }
}

/** 踩點（FIXER 第 2 節②）：擲 d20 ＋ 手段的加值 對 10 ＋ 等級 × 2；第 4 次起每次 +1。超過 5 以上揭開兩項；自然 1 驚動目標 */
export function scoutDc(grade: number, nth: number) { return 10 + grade * 2 + Math.max(0, nth - 3) }
export function scoutRoll(rng: Rng, bonus: number, dc: number) {
  const die = d20(rng), tot = die + bonus
  return { die, tot, dc, reveal: die === 1 ? 0 : tot >= dc + 5 ? 2 : tot >= dc ? 1 : 0, alarm: die === 1 }
}
/** 成功率（%）：1d20 ＋ 加值 ≥ DC，自然 1 一定失敗 */
export function chance(bonus: number, dc: number) {
  let n = 0
  for (let d = 2; d <= 20; d++) if (d + bonus >= dc) n++
  return n * 5
}

/** 輔助面的結算（COMMISSIONS 6.4 節）：1d20 ＋ 基本功 ＋ 分量修正（強 +4、中 +2、弱 0）對 10 ＋ 等級 × 2 */
export const WEIGHT = { 強: 4, 中: 2, 弱: 0 } as const
export function supportRoll(rng: Rng, skill: number, weight: keyof typeof WEIGHT, grade: number) {
  const die = d20(rng), dc = 10 + grade * 2, tot = die + skill + WEIGHT[weight]
  const result: '大成功' | '成功' | '失敗' | '出事' = die === 1 ? '出事' : tot >= dc + 5 ? '大成功' : tot >= dc ? '成功' : '失敗'
  return { die, tot, dc, result }
}

// ======================================================================
// 第四版：連動的完整效果（COMMISSION_TEMPLATES「共用的連動」與各型特有的連動）
// ======================================================================
/** when：用在哪一段。next_m／next_n 是下一個現實／內海階段（用掉就沒了）；later_n 是後面每一個內海階段；decisive 是決定性的一步；opinion 是輿論那一面 */
export interface LinkMod {
  when: 'next_m' | 'next_n' | 'next' | 'later_n' | 'decisive' | 'opinion' | 'note'
  /** 不必探索：這一段的壓力不漲 */
  skip?: boolean
  alertMult?: number
  traceMult?: number
  alertAdd?: number
  traceAdd?: number
  /** 遭遇少幾個敵人 */
  minus?: number
  /** 檢定的 DC 檔位（−1 是低一檔） */
  dc?: number
  /** 輿論：開場聲量、開場佔的格子、多一張「內幕」、對手每回合的公關點 */
  voice?: number
  cells?: number[]
  inside?: boolean
  pr?: number
}
export interface LinkDef { id: string; name: string; kind: '代勞' | '減壓' | '開路' | '→ 輿論' | '麻煩'; effect: string; mod: LinkMod }
const L = (id: string, name: string, kind: LinkDef['kind'], effect: string, mod: LinkMod): LinkDef => ({ id, name, kind, effect, mod })
export const LINKS: Record<string, LinkDef> = Object.fromEntries([
  L('located', '定位目標', '代勞', '下一個現實階段不必探索，直接到遭遇', { when: 'next_m', skip: true }),
  L('cams_off', '關掉監視器', '減壓', '下一個現實階段警戒的上漲減半', { when: 'next_m', alertMult: 0.5 }),
  L('doors_unlocked', '接管控制節點', '代勞', '下一個現實階段不必探索；開門、停砲塔', { when: 'next_m', skip: true }),
  L('shift_rigged', '竄改班表', '減壓', '下一場現實遭遇少一個敵人', { when: 'next_m', minus: 1 }),
  L('power_cut', '切斷電力或網路', '減壓', '後面的內海階段追蹤度的上升減半', { when: 'later_n', traceMult: 0.5 }),
  L('admin_cred', '管理憑證', '開路', '內海階段：閘門不用破解，略過那一層的遭遇', { when: 'next_n', skip: true, minus: 1 }),
  L('staff_cred', '員工憑證', '開路', '下一個階段多一條偽裝成員工的路', { when: 'note' }),
  L('keycard', '門禁卡', '開路', '下一個現實階段多一條「刷卡進去」的分支，不擲', { when: 'note' }),
  L('floor_reached', '到達目標樓層', '代勞', '下一個現實階段不必探索', { when: 'next_m', skip: true }),
  L('guard_turned', '說動一個守衛', '減壓', '下一場現實遭遇少一個敵人', { when: 'next_m', minus: 1 }),
  L('escape_route', '撤離路線', '減壓', '決定性階段的遭遇少一個敵人', { when: 'decisive', minus: 1 }),
  L('inside_mail', '內部消息', '→ 輿論', '牌庫多一張「內幕」（聲量 +4，對手不能下架）', { when: 'opinion', inside: true }),
  L('live_footage', '現場畫面', '→ 輿論', '開場聲量 +3', { when: 'opinion', voice: 3 }),
  L('platform_hacked', '駭進平台', '→ 輿論', '開場就佔著主流那一排的一格', { when: 'opinion', cells: [3] }),
  L('bought_slot', '買來的版面', '→ 輿論', '開場佔著一格', { when: 'opinion', cells: [5] }),
  L('op_minor', '輿論小勝', '減壓', '下一個現實階段有圍觀與記者：警戒每次上漲 +5', { when: 'next_m', alertAdd: 5, minus: 1 }),
  L('op_major', '輿論大勝', '減壓', '下一個現實階段保全綁手綁腳；後面的內海階段追蹤度起始 −15', { when: 'next', minus: 1, traceAdd: -15 }),
  L('op_lost', '輿論敗', '麻煩', '後面的現實階段警戒起始 +15', { when: 'next_m', alertAdd: 15 }),
  L('decoy_news', '假消息調虎離山', '減壓', '下一個現實階段警戒不上升', { when: 'next_m', alertMult: 0 }),
  // ---- 各型特有的 ----
  L('lured_public', '引到公開場合', '開路', '決定性階段的檢定低一檔；增援是市警', { when: 'decisive', dc: -1 }),
  L('close_in', '靠近', '代勞', '決定性階段不必探索', { when: 'decisive', skip: true }),
  L('noticed', '被注意到', '開路', '第 2 階段多一條「他主動邀你」的分支，不擲', { when: 'note' }),
  L('hyped', '話題', '減壓', '決定性階段的誘惑與表演低一檔', { when: 'decisive', dc: -1 }),
  L('rig_ready', '設備就位', '開路', '把柄的品質 +1：決定性的場景目的起始 +20', { when: 'decisive', voice: 20 }),
  L('cell_found', '找到牢房', '代勞', '決定性階段不必探索', { when: 'decisive', skip: true }),
  L('captive_status', '知道她的狀況', '減壓', '決定性階段少一個敵人', { when: 'decisive', minus: 1 }),
  L('wreck_charted', '航圖', '代勞', '第 2 階段不必探索', { when: 'next_n', skip: true }),
  L('item_found', '找到東西', '代勞', '決定性階段直接從守著它的東西前面開始：少一個敵人', { when: 'decisive', minus: 1 }),
  L('leak_located', '找到爆料的人', '代勞', '下一個現實階段不必探索', { when: 'next_m', skip: true }),
  L('leak_contents', '知道他有哪些料', '減壓', '輿論戰開場聲量 +2', { when: 'opinion', voice: 2 }),
  L('source_destroyed', '源頭毀了', '減壓', '對手的公關點每回合 −1', { when: 'opinion', pr: -1 }),
  L('weak_point', '弱點', '開路', '決定性階段打它的弱點：少一個敵人', { when: 'decisive', minus: 1 }),
  L('safety_off', '安全系統關了', '減壓', '決定性階段警戒不漲', { when: 'decisive', alertMult: 0 }),
].map(d => [d.id, d]))

export interface LinkCtx { face: Face; decisive: boolean }
export interface Mods { skip: boolean; alertMult: number; traceMult: number; alertAdd: number; traceAdd: number; minus: number; dc: number; voice: number; cells: number[]; inside: boolean; pr: number; used: string[]; notes: string[] }
/** 這一段用得到哪些連動：照 when 篩、加總效果；回傳要用掉的連動（later_n 與 note 不用掉） */
export function linkMods(links: Array<{ id?: string; used?: boolean }>, ctx: LinkCtx): Mods {
  const m: Mods = { skip: false, alertMult: 1, traceMult: 1, alertAdd: 0, traceAdd: 0, minus: 0, dc: 0, voice: 0, cells: [], inside: false, pr: 0, used: [], notes: [] }
  for (const l of links) {
    const d = l.id ? LINKS[l.id] : undefined
    if (!d || l.used) continue
    const w = d.mod.when
    const hit = w === 'next' || (w === 'next_m' && ctx.face === 'm') || ((w === 'next_n' || w === 'later_n') && ctx.face === 'n') || (w === 'decisive' && ctx.decisive) || (w === 'opinion' && ctx.face === 'o')
    if (!hit) continue
    const x = d.mod
    if (x.skip) m.skip = true
    if (x.alertMult !== undefined) m.alertMult *= x.alertMult
    if (x.traceMult !== undefined) m.traceMult *= x.traceMult
    m.alertAdd += x.alertAdd ?? 0; m.traceAdd += x.traceAdd ?? 0; m.minus += x.minus ?? 0; m.dc += x.dc ?? 0; m.voice += x.voice ?? 0; m.pr += x.pr ?? 0
    if (x.cells) m.cells.push(...x.cells)
    if (x.inside) m.inside = true
    if (w !== 'later_n') m.used.push(l.id!)
    m.notes.push(`${d.name}：${d.effect}`)
  }
  return m
}
/** 一段的壓力：分支寫的上漲，照連動調整（不必探索時不漲） */
export function stagePressure(base: { alert: number; trace: number }, m: Mods) {
  if (m.skip) return { alert: Math.max(0, m.alertAdd), trace: Math.min(0, m.traceAdd) }
  return { alert: Math.round(base.alert * m.alertMult) + (base.alert > 0 ? m.alertAdd : Math.max(0, m.alertAdd)), trace: Math.round(base.trace * m.traceMult) + m.traceAdd }
}
/** 分支檢定的標準 DC（COMMISSION_TEMPLATES）：I 10、II 13、III 16、IV 19、V 22；檔位 ±1 是 ±3，夾在 10～25 */
export const STD_DC: Record<string, number> = { I: 10, II: 13, III: 16, IV: 19, V: 22 }
export function branchDc(grade: string, shift = 0) { return Math.max(10, Math.min(25, (STD_DC[grade] ?? 13) + shift * 3)) }

// ---- 副本直播的目標（COMMISSION_TEMPLATES「直播目標的共用清單」與各型的） ----
export interface JobGoal { id: string; text: string; tip: number }
export const JOB_GOALS: Record<string, JobGoal> = Object.fromEntries([
  { id: 'goal_no_one_down', text: '沒有任何一個隊友倒下。', tip: 150 },
  { id: 'goal_two_crits', text: '整趟打出兩次以上的要害。', tip: 120 },
  { id: 'goal_alert_under_60', text: '整趟警戒沒有到 60。', tip: 180 },
  { id: 'goal_trace_under_30', text: '整趟追蹤度沒有到 30。', tip: 180 },
  { id: 'goal_every_link', text: '每個非決定性的階段都拿到至少一個連動。', tip: 150 },
  { id: 'goal_decisive_fast', text: '決定性的那一場在三回合內結束。', tip: 200 },
  { id: 'goal_op_major', text: '決定性的輿論戰大勝。', tip: 200 },
  { id: 'goal_no_lethal', text: '整趟沒有用實彈打倒任何人。', tip: 150 },
  { id: 'goal_never_suspected', text: '整趟警戒維持在 0。', tip: 180 },
].map(g => [g.id, g]))
export interface JobStats { alertMax: number; traceMax: number; noLink: number; opResult: string | null; decisiveRounds: number | null; downs: number; crits?: number; lethal?: number }
/** 出發時抽：這一型的目標加一個共用的，一到三個 */
export function pickGoals(own: string[], rng: () => number): string[] {
  const common = ['goal_no_one_down', 'goal_every_link', 'goal_two_crits'].filter(x => !own.includes(x))
  const out = own.slice(0, 2)
  out.push(common[Math.floor(rng() * common.length)])
  return [...new Set(out)].slice(0, 3)
}
/** 收尾時檢查：達成的目標每個熱度 +3、打賞照等級 */
export function checkGoal(id: string, s: JobStats): boolean {
  switch (id) {
    case 'goal_no_one_down': return s.downs === 0
    case 'goal_two_crits': return (s.crits ?? 0) >= 2
    case 'goal_alert_under_60': return s.alertMax < 60
    case 'goal_trace_under_30': return s.traceMax < 30
    case 'goal_every_link': return s.noLink === 0
    case 'goal_decisive_fast': return s.decisiveRounds !== null && s.decisiveRounds <= 3
    case 'goal_op_major': return s.opResult === '大勝'
    case 'goal_no_lethal': return (s.lethal ?? 0) === 0
    case 'goal_never_suspected': return s.alertMax === 0
    default: return false
  }
}
export function goalPayout(ids: string[], s: JobStats, grade: number) {
  const done = ids.filter(id => checkGoal(id, s))
  return { done, heat: done.length * 3, tips: done.reduce((a, id) => a + (JOB_GOALS[id]?.tip ?? 0) * grade, 0) }
}
