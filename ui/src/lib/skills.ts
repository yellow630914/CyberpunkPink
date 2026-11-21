import type { CapCategory, NightSkillDef, SkillDef, SkillTreeDef, TreeId } from '../data/skillTypes'

/**
 * 技能樹的規則（SKILLS 1.3、1.4、1.10 節；CORE_RULES 6.4、7.2 節）。純函式，引擎可以直接搬。
 * - 學一個技能花「階 × 20」歷練點，算進那棵樹的累計；累計到 40／120／240／400 開 2～5 階。
 * - 要先學會前置；招牌是每棵樹的第一個技能，沒有前置。
 * - 每開一階多一個共鳴，不佔容量。
 * - 學會與裝上是兩回事：裝上看橋的四類容量。
 */
export const TIER_THRESHOLDS = [0, 40, 120, 240, 400] as const

export const skillXp = (s: Pick<SkillDef, 'tier'>) => s.tier * 20
export const nightCost = (s: Pick<NightSkillDef, 'tier'>) => s.tier * 10

/** 在一棵樹累計花了 spent，開到幾階（1～5）。 */
export function tierOpen(spent: number): number {
  let t = 1
  TIER_THRESHOLDS.forEach((need, i) => { if (spent >= need) t = i + 1 })
  return t
}
/** 再花多少開下一階；已經五階回傳 0。 */
export function toNextTier(spent: number): number {
  const t = tierOpen(spent)
  return t >= 5 ? 0 : TIER_THRESHOLDS[t] - spent
}

/** 一棵樹已經學會的技能花了多少歷練點。 */
export function treeSpent(tree: SkillTreeDef, learned: ReadonlySet<string> | readonly string[]): number {
  const set = learned instanceof Set ? learned : new Set(learned)
  return tree.skills.reduce((s, k) => s + (set.has(k.id) ? skillXp(k) : 0), 0)
}

export type SkillState = 'learned' | 'can' | 'need-pre' | 'locked'

/** 技能卡的四種狀態（UI 8.4 節）：學會了、現在能學、前置還沒學、階還沒開。點數夠不夠不改狀態，按鈕另外說。 */
export function skillState(tree: SkillTreeDef, s: SkillDef, learned: ReadonlySet<string>): SkillState {
  if (learned.has(s.id)) return 'learned'
  if (s.tier > tierOpen(treeSpent(tree, learned))) return 'locked'
  if (s.pre && !learned.has(`${tree.id}:${s.pre}`)) return 'need-pre'
  return 'can'
}

/** 學不了的原因；學得了回傳 null。訊息是畫面上直接顯示的完整句子。 */
export function learnBlock(tree: SkillTreeDef, s: SkillDef, learned: ReadonlySet<string>, xp: number): string | null {
  if (learned.has(s.id)) return '已經學會了。'
  const spent = treeSpent(tree, learned)
  const open = tierOpen(spent)
  if (s.tier > open) return `${tree.name}的 ${s.tier} 階要在這棵樹累計花 ${TIER_THRESHOLDS[s.tier - 1]} 點，現在是 ${spent} 點。`
  if (s.pre && !learned.has(`${tree.id}:${s.pre}`)) return `要先學會「${s.pre}」。`
  const cost = skillXp(s)
  if (xp < cost) return `要 ${cost} 歷練點，你有 ${xp} 點。`
  return null
}

/** 學了之後：這棵樹的累計、開到幾階、會開出哪幾個技能（下一階的前層）。 */
export function learnPreview(tree: SkillTreeDef, s: SkillDef, learned: ReadonlySet<string>) {
  const before = treeSpent(tree, learned)
  const after = before + skillXp(s)
  const t0 = tierOpen(before), t1 = tierOpen(after)
  const next = new Set(learned); next.add(s.id)
  const opens = tree.skills.filter(k => !next.has(k.id) && skillState(tree, k, next) === 'can' && skillState(tree, k, learned) !== 'can')
  return { before, after, tierBefore: t0, tierAfter: t1, toNext: toNextTier(after), opens }
}

// ---- 橋的容量（CORE_RULES 6.4、CYBERWARE 第 7 節、UI 8.3 節） ----

export type Capacity = Record<CapCategory, number>
export const CATEGORIES: CapCategory[] = ['現實', '內海', '社交', '媒體']

export interface LoadoutSkill { id: string; category: CapCategory; cap: number; /** 共鳴與只在成人場景用的夜課：不佔容量，不能取消 */ free?: boolean }

export function loadoutUse(skills: LoadoutSkill[]): Capacity {
  const u: Capacity = { 現實: 0, 內海: 0, 社交: 0, 媒體: 0 }
  for (const s of skills) if (!s.free) u[s.category] += s.cap
  return u
}

/** 裝上去會超過哪一類、超多少；裝得下回傳 null。訊息照 UI 8.3 節：「現實不足 2」。 */
export function equipBlock(cap: Capacity, current: LoadoutSkill[], add: LoadoutSkill): string | null {
  if (add.free) return null
  if (current.some(s => s.id === add.id)) return null
  const used = loadoutUse(current)[add.category]
  const over = used + add.cap - cap[add.category]
  return over > 0 ? `${add.category}不足 ${over}` : null
}

/** 換配置只能在據點或調校診所（CORE_RULES 6.4 節）；委託副本裡不能換。 */
export function rearrangeBlock(where: { atHome: boolean; atClinic: boolean; inRun: boolean }): string | null {
  if (where.inRun) return '委託副本裡不能換配置。'
  if (!where.atHome && !where.atClinic) return '換配置要在據點或調校診所。'
  return null
}

export const TREE_ORDER: TreeId[] = ['gun', 'pilot', 'surgeon', 'runner', 'actor', 'broker', 'streamer', 'idol']
export const KIND_SHORT: Record<string, string> = { active: '動', passive: '被', reaction: '反', stance: '姿', prep: '備', daily: '常', pose: '體' }
export const CAT_COLOR: Record<CapCategory, string> = { 現實: 'var(--ink-2)', 內海: 'var(--ram)', 社交: 'var(--ap)', 媒體: 'var(--ep)' }

// ---- 夜課（LEWD_SYSTEM 第 10 節、NIGHT_LESSONS） ----

export interface NightProfile {
  /** 性經歷：次數與對象人數 */
  count: number
  partners: number
  /** 四條軸的等級 0～5 */
  axes: Record<'關係' | '感官' | '身體' | '扮相', number>
  /** 標籤或風格的狀態；沒寫的是「沒有」 */
  tags: Record<string, '有' | '深'>
  /** 被內容篩選關掉的標籤 */
  filtered: ReadonlySet<string>
}

const COMMON_GATES: Array<[number, number]> = [[0, 0], [8, 5], [20, 8], [40, 12], [80, 20]]

/** 夜課一個分支開到幾階：共通看性經歷（次數或人數擇一），其他看那一條軸的等級。 */
export function nightTierOpen(branch: string, p: NightProfile): number {
  if (branch === 'common') {
    let t = 1
    COMMON_GATES.forEach(([n, m], i) => { if (p.count >= n || p.partners >= m) t = i + 1 })
    return t
  }
  const axis = ({ relation: '關係', sense: '感官', body: '身體', look: '扮相' } as const)[branch as 'relation']
  return axis ? p.axes[axis] : 0
}

/** 掛在你沒有的標籤上的技能不顯示；被篩選關掉的整個不出現。 */
export function nightVisible(s: NightSkillDef, p: NightProfile): 'show' | 'hidden-tag' | 'filtered' {
  if (p.filtered.has(s.tag)) return 'filtered'
  if (s.tag === '共通' || s.tag in p.axes) return 'show'
  return p.tags[s.tag] ? 'show' : 'hidden-tag'
}

export function nightLearnBlock(s: NightSkillDef, learned: ReadonlySet<string>, p: NightProfile, insight: number): string | null {
  if (learned.has(s.id)) return '已經學會了。'
  if (s.tier > nightTierOpen(s.branch, p)) return s.branch === 'common' ? `共通的 ${s.tier} 階還沒開：看性經歷的次數或人數。` : `這一條軸要到 ${s.tier} 級才開 ${s.tier} 階。`
  const cost = nightCost(s)
  if (insight < cost) return `要 ${cost} 點體悟，你有 ${insight} 點。體悟從成人場景與成人事件來，不能用歷練點換。`
  return null
}

/** 夜課表裡「學習條件」那一欄：耐受 20、馴化 20、慾求 30、敏感度 40、對象 3 人、次數 20。看不懂的條件不擋。 */
export function nightNeedBlock(need: string, p: NightProfile & { params: Record<string, number> }): string | null {
  if (!need) return null
  const m = need.match(/^(耐受|馴化|慾求|敏感度) (\d+)$/)
  if (m) return p.params[m[1]] >= Number(m[2]) ? null : `要${m[1]} ${m[2]}，你是 ${p.params[m[1]]}。`
  const who = need.match(/^對象 (\d+) 人$/)
  if (who) return p.partners >= Number(who[1]) ? null : `要和 ${who[1]} 個人有過，你是 ${p.partners} 個。`
  const cnt = need.match(/^次數 (\d+)$/)
  if (cnt) return p.count >= Number(cnt[1]) ? null : `性經歷要 ${cnt[1]} 次，你是 ${p.count} 次。`
  return null
}
