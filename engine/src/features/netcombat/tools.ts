// L6 功能 netcombat：工具構裝變成行動（CYBERSPACE 6.3 節的「工具構裝」那一列；ITEMS 11.4 節）。
// 每個裝著、不是被動的工具構裝是一個行動 net_tool:<構裝 id>（技能那一圈、modes: ['net']）：行動點與 RAM 照構裝寫的，
// 對誰用看構裝的 target，效果是構裝的 do（深檔以上接上 advanced.do、全檔再接上 ultimate.do；do 的 op 都是效果登錄表上的，這個功能不寫任何一件具體構裝的效果）。
// 被干擾停用（工具）或破損的那一件做不了。行動照內容載入之後有哪些工具構裝註冊（和快駭程式變成行動同一個做法），誰有看 unit.ext.deck.constructs。

import type { BattleActionDef, BattleInput, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Kernel, RollPart } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, otherSide, unitsOf } from '../../core'
import type { ConstructInfo } from './model'
import { CONSTRUCT_KIND, MODES, OWNER, brokenOf, constructEntry, constructsOf, gearOf, isJammed } from './model'

const TARGET_KIND = { none: 'none', self: 'none', foe: 'foe', ally: 'ally', unit: 'unit', foe_slot: 'foe_slot', ally_slot: 'ally_slot', overlay: 'overlay', node: 'node', mixed: 'mixed' } as const
type ToolTarget = keyof typeof TARGET_KIND

const kindOf = (e: ConstructInfo): ToolTarget => (e.target && e.target in TARGET_KIND ? (e.target as ToolTarget) : 'none')

const cells = (side: 'ally' | 'foe'): BattleTargetOption[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ target: { side, slot: i + 1 } as BattleTarget, blocks: [] as string[] }))
const people = (list: BattleUnit[]): BattleTargetOption[] => list.map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: [] as string[] }))

/** 這個工具構裝可以選的目標（行動的 target 種類決定；一格、一台、一個節點照場上現有的）。 */
function toolTargets(view: BattleView, u: BattleUnit, kind: ToolTarget): BattleTargetOption[] {
  const b = view.battle
  const foe = otherSide(u.side)
  switch (kind) {
    case 'foe': return people(unitsOf(b, foe))
    case 'ally': return people(unitsOf(b, u.side).filter((t) => t.id !== u.id))
    case 'unit': return people([...unitsOf(b, u.side), ...unitsOf(b, foe)])
    case 'foe_slot': return cells(foe)
    case 'ally_slot': return cells(u.side)
    case 'overlay': return b.overlays.filter((o) => !o.down && o.side !== u.side).map((o) => ({ target: { overlay: o.id } as BattleTarget, blocks: [] as string[] }))
    case 'node': return b.nodes.map((n) => ({ target: { node: n.id } as BattleTarget, blocks: [] as string[] }))
    case 'mixed': return [...people(unitsOf(b, foe)), ...people(unitsOf(b, u.side).filter((t) => t.id !== u.id)), ...cells(foe), ...cells(u.side)]
    default: return []
  }
}

/** 這個工具構裝現在用不了的原因，一條一個條件。 */
function toolBlocks(u: BattleUnit, e: ConstructInfo): string[] {
  return [
    ...(isJammed(u, 'tool') ? ['工具被干擾停用了，這個回合用不了工具構裝。'] : []),
    ...(brokenOf(u).includes(e.id) ? [`構裝「${e.name}」破損了，戰鬥結束前用不了。`] : []),
  ]
}

/** 這個構裝在這個人現在的檔位會跑的效果：do，深檔以上接 advanced.do、全檔再接 ultimate.do。 */
export function toolEffects(e: ConstructInfo, u: BattleUnit): Array<Record<string, unknown>> {
  const gear = gearOf(u)
  return [...(e.do ?? []), ...(gear === 'deep' || gear === 'full' ? (e.advanced?.do ?? []) : []), ...(gear === 'full' ? (e.ultimate?.do ?? []) : [])]
}

function toolAction(e: ConstructInfo, order: number): BattleActionDef {
  const kind = kindOf(e)
  const def: BattleActionDef = {
    id: `net_tool:${e.id}`, owner: OWNER, name: e.name, desc: e.desc ?? `${e.name}。`, group: 'skill', icon: 'tool', tags: ['net_tool'], modes: MODES,
    target: TARGET_KIND[kind], order,
    has: (view, u) => constructsOf(view.k, u).some((c) => c.id === e.id),
    cost: () => ({ ap: e.ap ?? 1, ...((e.ram ?? 0) > 0 ? { ram: e.ram! } : {}) }),
    blocks: (_v, u) => toolBlocks(u, e),
    run: (run, u, target: BattleTarget | null, input: BattleInput) => {
      const why = toolBlocks(u, e)
      if (why.length) throw new BattleBlocked(why)
      const t = kind === 'self' ? ({ unit: u.id } as BattleTarget) : target
      run.say(`${u.name} 使用構裝「${e.name}」。`, 'skill', { unit: u.id, construct: e.id }, u)
      run.effects(toolEffects(e, u), { user: u, target: t, source: { kind: 'hack', id: e.id, name: e.name }, pick: input.pick ?? {} })
    },
  }
  if (kind !== 'none' && kind !== 'self') {
    def.targets = (view, u) => toolTargets(view, u, kind)
  }
  return def
}

/** 內容載入之後：照內容註冊每一個工具構裝的行動（被動的不註冊：裝上就有效，它的 mods 是 features/deck 與這個功能的修正）。 */
export function registerToolActions(k: Kernel): void {
  if (!k.content.hasKind(CONSTRUCT_KIND)) return
  let i = 0
  for (const e of k.content.list<ConstructInfo>(CONSTRUCT_KIND)) {
    if (e.class !== 'tool' || e.passive === true) continue
    k.battle.action(toolAction(e, i++))
  }
}

/**
 * 構裝的進階與終極效果（ITEMS 11.1 節）：資料的 advanced 只在深檔以上生效、ultimate 只在全檔；mods 在這裡經修正給（破損的構裝不給），
 * do 接在那個構裝自己的效果後面（工具構裝的行動 toolEffects；武器構裝命中時，在 jam.ts 的 attack.after）。
 */
export function installTiers(k: Kernel): void {
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.view.mode.layer !== 'net') return []
    const gear = gearOf(q.unit)
    if (gear !== 'deep' && gear !== 'full') return []
    const broken = brokenOf(q.unit)
    const out: RollPart[] = []
    for (const c of constructsOf(q.view.k, q.unit)) {
      if (broken.includes(c.id)) continue
      const e = constructEntry(q.view.k, c.id)
      if (!e) continue
      const adv = e.advanced?.mods?.[q.kind]
      if (typeof adv === 'number' && adv !== 0) out.push({ label: `${e.name}（進階）`, value: adv, source: 'construct' })
      const ult = gear === 'full' ? e.ultimate?.mods?.[q.kind] : undefined
      if (typeof ult === 'number' && ult !== 0) out.push({ label: `${e.name}（終極）`, value: ult, source: 'construct' })
    }
    return out
  })
}
