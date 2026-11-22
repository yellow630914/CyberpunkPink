// L6 功能 combat：投擲物與放在格子上的消耗品（dev/work/M1b-ordnance.md 第三、四節；ITEMS 5.2 節「投擲物的型」）。
// 效果 throw：一顆骰打目標那一格與玩家選的相鄰一格（人與掛在那兩格的東西各自對自己的迴避）；save 的（閃光彈）不造成傷害，兩格裡的人過檢定、沒過的做 on_hit。
// 效果 decoy：在我方一格放一台沒有操作者的立牌（耐久 1）；下一次以那一格的人為目標的攻擊改打它。
// 一件物品的資料只寫 { op: 'throw', ... } 與 use.target: foe_slot、use.ap: 2；不看物品的 id。

import type { AttackOpts, BattleEffectCtx, BattleUnit, BattleWeapon, DamageType, Kernel } from '../../core'
import { BattleBlocked, attrMod, distance, isRecord, unitAt } from '../../core'
import { runOnHit } from './fx'
import { ATTR, F, S, TYPE, adjacentPick, list, num, qty, schema, shape } from './schema'

const OWNER = 'combat'
type Eff = Record<string, unknown>
type Ctx = BattleEffectCtx

/** 投擲物丟得到的距離（ITEMS 5.2 節）：投的人到目標那一格。 */
export const THROW_RANGE: [number, number] = [1, 4]

/** 丟不到的原因（一句完整的話）；丟得到回傳 null。slot 是敵方的第幾格。 */
export function throwBlock(user: { slot: number }, slot: number): string | null {
  const d = distance(user, { slot })
  return d > THROW_RANGE[1] ? `這一格的距離是 ${d}，投擲物只丟得到距離 ${THROW_RANGE[0]}～${THROW_RANGE[1]} 的格子。` : null
}

function throwOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const t = ctx.target
  if (!t || !('slot' in t) || t.side === user.side) throw new BattleBlocked(['這個東西要丟在敵方的一格上。'])
  const far = throwBlock(user, t.slot)
  if (far) throw new BattleBlocked([far])
  const slots = [t.slot, adjacentPick(ctx.pick.also, t.slot)].sort((a, b) => a - b)
  const people = slots.map((s) => unitAt(run.battle, t.side, s)).filter((u): u is BattleUnit => !!u)
  const onHit = Array.isArray(e.on_hit) ? (e.on_hit as Eff[]) : []
  const again = (target: BattleUnit, last: Record<string, unknown>): void => {
    if (onHit.length) run.effects(onHit, { user, target: { unit: target.id }, source: ctx.source, pick: ctx.pick, n: ctx.n, last })
  }

  if (isRecord(e.save)) {
    // 閃光彈：不造成傷害。兩格裡的人各自過檢定，沒過的做 on_hit
    const sv = e.save
    const skill = typeof sv.skill === 'string' ? sv.skill : undefined
    const attr = sv.attr as keyof BattleUnit['attrs']
    ctx.last.ok = true
    for (const p of people) {
      const { ok } = run.save(p, attr, skill, qty(ctx, sv.dc, 10), skill ? run.k.stats.skillName(skill) : run.k.stats.attrName(attr), [], ['throw'], user)
      if (!ok) {
        ctx.last.ok = false
        again(p, { ok: false })
      }
    }
  } else {
    const type = (typeof e.type === 'string' ? e.type : 'physical') as DamageType
    // 一顆骰分別對兩格裡的每個人與掛在那兩格的每一台：1d20 ＋ mod(反應) ＋ 運動（＋ hit）
    const natural = run.d20()
    const w: BattleWeapon = {
      id: 'throw', name: ctx.source.name, class: 'throw', dice: Math.max(1, qty(ctx, e.dice, 1)), flat: 0, type, range: [THROW_RANGE[0], THROW_RANGE[1]], pierce: 0,
      hit: attrMod(user.attrs.reflex ?? 10) + (user.skills.athletics ?? 0) + qty(ctx, e.hit, 0), attr: 'reflex', skill: 'athletics',
      coverMult: typeof e.cover_mult === 'number' ? e.cover_mult : 0, traits: ['throw'],
    }
    const opts: AttackOpts = { weapon: w, spend: 0, natural, label: '投擲', tags: ['throw'], noWound: true }
    let hit = false, crit = false, downed = false, dealt = 0
    const take = (r: { hit: boolean; crit: boolean; downed: boolean; dealt: number }): void => {
      hit ||= r.hit
      crit ||= r.crit
      downed ||= r.downed
      dealt += r.dealt
    }
    for (const p of people) {
      const r = run.attack(user, p, opts)
      take(r)
      runOnHit(run, user, p, w, type, r, onHit)
    }
    for (const o of run.battle.overlays.filter((x) => !x.down && x.side === t.side && slots.includes(x.slot))) take(run.attackOverlay(user, o, opts))
    Object.assign(ctx.last, { hit, crit, downed, dealt })
  }
  // 一綑炸藥：那兩格的遮蔽各降幾級
  if (typeof e.cover === 'number' && e.cover > 0) for (const s of slots) run.lowerCover(t.side, s, e.cover, user)
}

function decoyOp(ctx: Ctx): void {
  const t = ctx.target
  if (!t || !('slot' in t) || t.side !== ctx.user.side) throw new BattleBlocked(['立牌要放在我方的一格上。'])
  // 沒有操作者、耐久 1、永遠暴露；每格最多一台（addOverlay 擋）
  ctx.run.addOverlay({ side: t.side, slot: t.slot, kind: 'decoy', name: ctx.source.name, hp: { now: 1, max: 1 }, armor: 0, evade: 0 }, { text: `${ctx.source.name}立在${t.side === 'ally' ? '我方' : '敵方'}第 ${t.slot} 格。` })
}

export function registerThrow(k: Kernel): void {
  const SAVE = shape({ attr: ATTR, skill: S, dc: F }, ['attr', 'dc'])
  const throwSchema = schema({ dice: F, type: TYPE, hit: F, cover_mult: num(0), on_hit: list((v) => (isRecord(v) ? null : '每一筆要是 { op, ... }')), save: SAVE, cover: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2 ? null : '要是 1 或 2（降幾級）') }, [], [['dice', 'save']])
  k.battle.effect('throw', OWNER, throwOp, {
    problems: (e) => [
      ...throwSchema(e),
      ...(e.save !== undefined && (e.dice !== undefined || e.type !== undefined || e.hit !== undefined) ? ['save：閃光這類的投擲物不造成傷害，不能再寫 dice、type、hit'] : []),
      ...(Array.isArray(e.on_hit) ? k.battle.effectProblems(e.on_hit).map((m) => `on_hit：${m}`) : []),
    ],
  })
  k.battle.effect('decoy', OWNER, decoyOp, { problems: schema({}) })

  // 立牌：下一次以那一格的人為目標的敵方攻擊改打它（照它的迴避與護甲算；耐久 1，被打中就倒下）
  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => {
    if (opts.redirect || run.isStandIn(target)) return
    const decoy = run.battle.overlays.find((o) => o.kind === 'decoy' && !o.down && o.side === target.side && o.slot === target.slot && o.side !== attacker.side)
    if (decoy) opts.redirect = { overlay: decoy.id }
  })
}
