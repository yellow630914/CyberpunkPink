// L6 功能 hack：快駭程式變成行動。每一支裝在 deck.slots 裡的程式是一個行動（group: skill、modes: meat、標籤 hack 與 hack:<類>）。
// 兩個戰場都能用（現實 meat、內海 net；內海加追蹤度、現實被發現加敵對值在 trace.ts）。誰有：有 quickhack 標籤、而且 deck.slots 裡有它。跑幾級：主控的樹階對照與甲板的等級取低的，程式沒有那一級就用它有的最高一級。
// 花費：ram 與 ap（支援類 0 點行動點、每回合一次、不必檢定）。檢定與效果清單由 hack.check 與 do 做（run.effects）。

import type { BattleActionDef, BattleInput, BattleOverlay, ItemEntry, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Kernel } from '../../core'
import { BattleBlocked, isRecord, otherSide, overlayAt, unitsOf } from '../../core'
import { CLASS_NAME, OWNER, ROMAN, canHack, cyberCount, deckOf, levelOfTier, runLevel, treeTier } from './deck'
import type { HackClass } from './deck'
import type { QuickhackEntry } from './kinds'

/** 支援類每回合一次（用掉幾次記在單位的 uses，回合開始時核心清掉 turn: 開頭的鍵）。 */
const SUPPORT_USED = 'turn:hack.support'

/** 這支程式現在照哪一級跑：沒有那一級就用它有的最高一級；樹階或甲板不到它最低的一級是 null。 */
export function gradeFor(e: QuickhackEntry, level: number): number | null {
  const ok = e.grades.filter((g) => g <= level)
  return ok.length ? Math.max(...ok) : null
}

/** 這一級的樣子：欄位被 by_grade 蓋掉之後的 ram、ap、do、額外的檢定加值。 */
export function shapeAt(e: QuickhackEntry, grade: number): { ram: number; ap: number; do: Array<Record<string, unknown>>; bonus: number | string } {
  const o = e.by_grade?.[String(grade)]
  const ap = e.class === 'support' ? 0 : (o?.ap ?? e.ap ?? 1)
  return { ram: o?.ram ?? e.ram, ap, do: o?.do ?? e.do, bonus: o?.bonus ?? e.bonus ?? 0 }
}

/** 樹階或甲板不夠跑這支程式：每一條一句原因。 */
function levelBlocks(u: BattleUnit, e: QuickhackEntry): string[] {
  const min = Math.min(...e.grades)
  const deck = deckOf(u)
  if (!deck) return ['沒有甲板，跑不了快駭程式。']
  const tier = treeTier(u)
  if (levelOfTier(tier) < min) return [`${e.name}最低要跑 ${ROMAN[min]} 級，主控的樹階只到 ${tier} 階（跑得動 ${ROMAN[levelOfTier(tier)]} 級）。`]
  if (deck.grade < min) return [`${e.name}最低要跑 ${ROMAN[min]} 級，甲板只有 ${ROMAN[deck.grade]} 級。`]
  return []
}

const hasOp = (list: Array<Record<string, unknown>>, op: string): boolean => list.some((x) => x.op === op)

/** 這一支程式對目標的條件：類別預設的加上 needs 寫的（寫 false 是例外）。 */
function needsOf(e: QuickhackEntry): { bridged: boolean; cyber: boolean; marked: boolean; machine: boolean; explosive: boolean; implantKinds: string[] } {
  const n = e.needs ?? {}
  const all = [e.do, ...Object.values(e.by_grade ?? {}).map((o) => o.do ?? [])].flat()
  return {
    bridged: n.bridged ?? e.class === 'neural',
    cyber: n.cyber ?? e.class === 'cyberware',
    marked: n.marked ?? e.class === 'control',
    machine: n.machine ?? false,
    explosive: n.explosive ?? hasOp(all, 'hack.detonate'),
    implantKinds: all.filter((x) => x.op === 'implant' && typeof x.kind === 'string').map((x) => x.kind as string),
  }
}

/** 一個敵人（或我方的人）不能被這支程式打的原因，一條一個條件。 */
function unitBlocks(view: BattleView, e: QuickhackEntry, t: BattleUnit): string[] {
  const n = needsOf(e)
  const out: string[] = []
  // 機器（無人機、砲塔、機器的單位）只吃裝置與控制類
  if (t.tags.includes('machine') && e.class !== 'device' && e.class !== 'control') out.push(`${t.name}是機器，只吃裝置與控制類的快駭。`)
  if (n.machine && !t.tags.includes('machine')) out.push(`${e.name}只打得到機器，${t.name}不是機器。`)
  if (n.bridged && !t.load) out.push(`${t.name}沒有橋，神經類的快駭對他無效。`)
  if (n.cyber && cyberCount(t) < 1) out.push(`${t.name}身上沒有義體可以打。`)
  if (n.cyber) {
    for (const kind of n.implantKinds) if (cyberCount(t) > 0 && !(t.implants ?? []).some((i) => i.kind === kind)) out.push(`${t.name}身上沒有${kind}類的義體。`)
  }
  if (n.marked && !t.statuses.some((s) => s.id === 'marked')) out.push(`${t.name}身上還沒有標記：${CLASS_NAME[e.class as HackClass]}類的快駭要先標記他。`)
  if (n.explosive && !t.quick.some((q) => q.qty > 0 && isExplosive(view, q.item))) out.push(`${t.name}的快取格裡沒有爆裂物可以引爆。`)
  return out
}

/** 快取格裡的這件道具是不是爆裂物（內容的 tags 有 explosive）。 */
export const isExplosive = (view: Pick<BattleView, 'k'>, item: string): boolean => !!view.k.content.get<ItemEntry>('item', item)?.tags?.includes('explosive')

function overlayBlocks(view: BattleView, u: BattleUnit, e: QuickhackEntry, o: BattleOverlay): string[] {
  const out: string[] = []
  // 無人機與砲塔是機器：只吃裝置與控制類
  if (e.class !== 'device' && e.class !== 'control') out.push(`${o.name}是機器，只吃裝置與控制類的快駭。`)
  // 接管（不是改寫）要把它掛到我方同一格：那一格不能已經掛著別台
  const all = [e.do, ...Object.values(e.by_grade ?? {}).map((x) => x.do ?? [])].flat()
  if (all.some((x) => x.op === 'hack.takeover' && x.mode !== 'rewrite') && overlayAt(view.battle, u.side, o.slot)) out.push(`我方第 ${o.slot} 格已經掛著一台了，接管來的${o.name}沒有地方放。`)
  return out
}

const TARGET_KIND = { foe: 'foe', ally: 'ally', self: 'none', foe_overlay: 'overlay', node: 'node' } as const

function targetsOf(view: BattleView, u: BattleUnit, e: QuickhackEntry): BattleTargetOption[] {
  const b = view.battle
  switch (e.target) {
    case 'foe': return unitsOf(b, otherSide(u.side)).map((t) => ({ target: { unit: t.id }, blocks: unitBlocks(view, e, t) }))
    case 'ally': return unitsOf(b, u.side).filter((t) => t.id !== u.id).map((t) => ({ target: { unit: t.id }, blocks: [] }))
    case 'foe_overlay': return b.overlays.filter((o) => !o.down && o.side !== u.side).map((o) => ({ target: { overlay: o.id }, blocks: overlayBlocks(view, u, e, o) }))
    case 'node': {
      const takes = [e.do, ...Object.values(e.by_grade ?? {}).map((x) => x.do ?? [])].flat().some((x) => x.op === 'hack.node')
      return b.nodes.map((n) => ({ target: { node: n.id }, blocks: takes && n.taken ? [`${n.name}已經拿下了。`] : [] }))
    }
    default: return []
  }
}

/** 一支程式的行動。 */
function programAction(e: QuickhackEntry, order: number): BattleActionDef {
  const id = `hack.${e.id}`
  const shownGrade = (u: BattleUnit): number => gradeFor(e, runLevel(u)) ?? Math.min(...e.grades)
  const def: BattleActionDef = {
    id, owner: OWNER, name: e.name, desc: e.desc, group: 'skill', icon: 'hack', modes: ['meat', 'net'], tags: ['hack', `hack:${e.class}`],
    target: TARGET_KIND[e.target], order,
    has: (_v, u) => canHack(u) && deckOf(u)!.slots.includes(e.id),
    cost: (_v, u) => {
      const s = shapeAt(e, shownGrade(u))
      return { ap: s.ap, ...(s.ram > 0 ? { ram: s.ram } : {}) }
    },
    blocks: (_v, u) => [...levelBlocks(u, e), ...(e.class === 'support' && (u.uses[SUPPORT_USED] ?? 0) >= 1 ? ['支援類的快駭每回合只能用一次。'] : [])],
    run: (run, u, target, input) => runProgram(run, u, e, target, input),
  }
  if (e.target !== 'self') def.targets = (v, u) => targetsOf(v, u, e)
  // 敵方的潛網者：2.4 ＋ 目標的義體數 × 0.3（ENEMIES 4.3 節）。只有對一個敵人用的程式列
  if (e.target === 'foe') def.aiScore = (_v, _u, t) => (t ? 2.4 + cyberCount(t) * 0.3 : null)
  return def
}

function runProgram(run: Parameters<BattleActionDef['run']>[0], u: BattleUnit, e: QuickhackEntry, target: BattleTarget | null, input: BattleInput): void {
  const level = runLevel(u)
  const grade = gradeFor(e, level)
  if (grade === null) throw new BattleBlocked(levelBlocks(u, e))
  const s = shapeAt(e, grade)
  // 這一次的檢定結果從頭記（trace.ts 在行動做完時看）
  if (isRecord(u.ext.hack)) delete u.ext.hack.checks
  if (e.class === 'support') u.uses[SUPPORT_USED] = (u.uses[SUPPORT_USED] ?? 0) + 1
  run.say(`${u.name} 跑${e.name}（${ROMAN[grade]}級）。`, 'skill', { unit: u.id, hack: e.id, grade, class: e.class }, u)
  const t = e.target === 'self' ? ({ unit: u.id } as BattleTarget) : target
  // 對敵人（或敵方的東西、控制節點）的程式先檢定：沒過就沒有效果（RAM 照扣）；支援類與對自己、隊友用的不必檢定
  const roll = e.class !== 'support' && (e.target === 'foe' || e.target === 'foe_overlay' || e.target === 'node')
  const list: Array<Record<string, unknown>> = [
    ...(roll ? [{ op: 'hack.check', class: e.class, grade, ...(s.bonus ? { bonus: s.bonus } : {}), stop: true }] : []),
    ...s.do,
  ]
  const tier = treeTier(u)
  run.effects(list, { user: u, target: t, source: { kind: 'hack', id: e.id, name: e.name }, pick: input.pick ?? {}, n: { tier }, last: {} })
}

/** 內容載入之後：照內容註冊每一支程式的行動。 */
export function registerActions(k: Kernel): void {
  k.content.list<QuickhackEntry>('quickhack').forEach((e, i) => k.battle.action(programAction(e, i)))
}

