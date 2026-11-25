// 成人地城的效果記號（M4-enemies-m4；CYBERSPACE 8.7 節「兩座的敵人都打感載」那張記號表；dev/adr/0019 P61）。
//
//   縛  效果 bind { who?, mode: 'ap' | 'no_move', by?: 'user' }：給目標一個束縛的狀態（bind_ap：每回合回復的行動點 −1；bind_move：不能換位）。
//       持續到綁他的那個敵人退出戰鬥（out 掛點把他綁的拿掉），或一個隊友花 1 行動點替他解開（行動 unbind；兩個戰場都能用）。
//       不是釘住：不影響拔線，也不影響戰鬥的結果。狀態本身的資料（battle_status）由 M4-data-rules 放：
//         bind_ap   { name, desc, mods: { ap_regen: -1 }, until: 'battle_end', kind: 'debuff' }
//         bind_move { name, desc, no_move: true, until: 'battle_end', kind: 'debuff' }
//       資料裡沒有那個狀態時這一筆不做事（功能的 warnings 會列出來）；狀態的 until 由效果給（battle_end），資料的寫法不影響它。
//   疊  效果 overload_extra { layers?: 1 }：接在一筆感載的效果（load 這類會寫 ctx.last.overloaded 的）之後；那一筆把目標灌到過載時，多疊 layers 層餘韻，
//       不超過他的承受層數（疊滿之後再過載照舊倒下，那一擊沒有「多疊」可言）。沒有過載、目標已經退出就不做事。
//   灌、挑、範  不另外寫效果：灌是多一顆骰的 load（{ op: 'load', amount: '5d6' }）、挑是 load 加一個 status（標記資料給「下一次命中 −1」）、
//       範是 who 寫 foes（對每個人各一次）。

import type { BattleActionDef, BattleEffectCtx, BattleView, Kernel } from '../../core'
import { BattleBlocked, statusRuleOf, unitTag, unitsOf } from '../../core'
import { OWNER } from './kinds'

type Eff = Record<string, unknown>

/** 縛的兩種：狀態的 id（資料放在 battle_status）。 */
export const BIND_STATUS = { ap: 'bind_ap', no_move: 'bind_move' } as const
export const BIND_MODES = ['ap', 'no_move'] as const
const BIND_IDS: readonly string[] = Object.values(BIND_STATUS)
/** 替隊友解開束縛的行動的 id。 */
export const UNBIND = 'unbind'
/** 解開束縛花的行動點。 */
export const UNBIND_AP = 1

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 共同欄位以外多寫的鍵與欄位型別的檢查（回傳給資料作者看的訊息）。 */
function problemsOf(e: Eff, allowed: string[], check: (e: Eff) => string[]): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (!['op', 'who', 'if', ...allowed].includes(key)) p.push(`${key}：沒有這個欄位（可以寫的：${allowed.join('、')}）`)
  return [...p, ...check(e)]
}

const bindOp = (ctx: BattleEffectCtx, e: Eff): void => {
  const { run, user, unit } = ctx
  if (!unit || unit.out || run.isStandIn(unit)) return
  const id = BIND_STATUS[e.mode as keyof typeof BIND_STATUS]
  if (!id || !statusRuleOf(run.k.content, id)) return
  run.applyStatus(unit, id, { by: user, until: 'battle_end' })
}

/** 多疊的餘韻（不超過承受層數）。 */
function addExtra(run: BattleEffectCtx['run'], unit: BattleEffectCtx['user'], by: BattleEffectCtx['user'] | undefined, want: number): void {
  if (unit.out || run.isStandIn(unit)) return
  const layers = Math.min(unit.layersMax, unit.layers + want)
  const delta = layers - unit.layers
  if (delta <= 0) return
  unit.layers = layers
  run.say(`${unitTag(unit)} 餘韻再疊 ${delta} 層（共 ${unit.layers} 層）。`, 'overload', { target: unit.id, layers: delta, extra: true, ...(by ? { by: by.id } : {}) }, by)
}

/** 放在攻擊前面的 overload_extra：每個 run（一步）裡，誰（單位 id）在這個行動裡造成的過載多疊幾層。 */
const armed = new WeakMap<object, Map<string, number>>()

const overloadExtraOp = (ctx: BattleEffectCtx, e: Eff): void => {
  const { run, user, unit, last } = ctx
  const want = isInt(e.layers) ? e.layers : 1
  if (last.overloaded === true) {
    if (unit) addExtra(run, unit, user, want)
    return
  }
  // 前面沒有會寫 overloaded 的效果：記下來，這個行動裡之後的過載（攻擊把感載灌滿）多疊
  if (last.overloaded === undefined) {
    const m = armed.get(run) ?? new Map<string, number>()
    m.set(user.id, want)
    armed.set(run, m)
  }
}

/** 這個單位身上有沒有束縛。 */
export const isBound = (u: { statuses: ReadonlyArray<{ id: string }> }): boolean => u.statuses.some((s) => BIND_IDS.includes(s.id))

const mates = (view: BattleView, u: { id: string; side: 'ally' | 'foe' }) => unitsOf(view.battle, u.side).filter((x) => x.id !== u.id)

const unbindAction: BattleActionDef = {
  id: UNBIND, owner: OWNER, name: '解開束縛', group: 'tactic', icon: 'skill', modes: ['meat', 'net'], order: 20, target: 'ally',
  desc: `花 ${UNBIND_AP} 點行動點，替一個被綁住的隊友解開束縛（行動點回復與換位恢復）。`,
  cost: () => ({ ap: UNBIND_AP }),
  // 隊友裡有人被綁住才列
  has: (view, u) => mates(view, u).some(isBound),
  targets: (view, u) => mates(view, u).map((t) => ({ target: { unit: t.id }, blocks: isBound(t) ? [] : [`${t.name}沒有被綁住。`] })),
  run(run, u, target) {
    const t = target && 'unit' in target ? run.battle.units[target.unit] : undefined
    if (!t || t.side !== u.side || t.id === u.id || t.out) throw new BattleBlocked(['沒有這個隊友。'])
    if (!isBound(t)) throw new BattleBlocked([`${t.name}沒有被綁住。`])
    run.say(`${unitTag(u)} 替 ${unitTag(t)} 解開了束縛。`, 'status.end', { unit: u.id, target: t.id, unbind: true }, u)
    for (const s of [...t.statuses]) if (BIND_IDS.includes(s.id)) run.removeStatus(t, s.id, true)
  },
}

/** 內容裡有哪些技能用了 bind 效果、但 battle_status 裡沒有對應狀態：資料檢查的警告。 */
export function bindWarnings(k: Pick<Kernel, 'content'>): string[] {
  if (!k.content.hasKind('ability')) return []
  const used = new Set<string>()
  const walk = (v: unknown, ab: string): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, ab))
    if (typeof v !== 'object' || v === null) return
    const r = v as Record<string, unknown>
    if (r.op === 'bind' && typeof r.mode === 'string' && r.mode in BIND_STATUS) used.add(`${ab}:${r.mode}`)
    for (const x of Object.values(r)) walk(x, ab)
  }
  for (const ab of k.content.list<{ id: string }>('ability')) walk(ab, ab.id)
  const out: string[] = []
  for (const key of used) {
    const [ab, mode] = key.split(':') as [string, keyof typeof BIND_STATUS]
    if (!statusRuleOf(k.content, BIND_STATUS[mode])) out.push(`技能 ${ab} 用了 bind（${mode}），但 battle_status 裡沒有 ${BIND_STATUS[mode]}：這一筆效果不會做事。`)
  }
  return out
}

export function registerBind(k: Kernel): void {
  k.battle.effect('bind', OWNER, bindOp, {
    problems: (e) => problemsOf(e, ['mode', 'by'], (x) => [
      ...(BIND_MODES as readonly unknown[]).includes(x.mode) ? [] : [`mode 要寫，只能是 ${BIND_MODES.join('、')}`],
      ...(x.by === undefined || x.by === 'user' ? [] : ["by 只能是 'user'（綁他的是做這個效果的人）"]),
    ]),
  })
  k.battle.effect('overload_extra', OWNER, overloadExtraOp, {
    problems: (e) => problemsOf(e, ['layers'], (x) => (x.layers === undefined || (isInt(x.layers) && x.layers >= 1 && x.layers <= 3) ? [] : ['layers 要是 1～3 的整數'])),
  })
  k.battle.action(unbindAction)
  // 疊：放在攻擊前面記下的，這個行動裡由他造成的過載多疊；行動做完就清掉
  k.battle.on('overload', OWNER, ({ run, unit, by }) => {
    const want = by ? armed.get(run)?.get(by.id) : undefined
    if (by && want && by.side !== unit.side) addExtra(run, unit, by, want)
  })
  k.battle.on('action.done', OWNER, ({ run, unit }) => void armed.get(run)?.delete(unit.id))
  // 綁他的人退出戰鬥（倒下、被制伏、逃走……）：他綁的都鬆開
  k.battle.on('out', OWNER, ({ run, unit }) => {
    for (const holder of Object.values(run.battle.units)) {
      for (const s of [...holder.statuses]) if (s.by === unit.id && BIND_IDS.includes(s.id)) run.removeStatus(holder, s.id, !!holder.out)
    }
  })
}
