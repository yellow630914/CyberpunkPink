// L6 功能 hack：這個功能註冊的效果與掛點。
//   hack.check     快駭的檢定：1d20 ＋ mod(智識) ＋ 介面 ＋ 等級加值（＋ 技能的加值）對目標的防火牆；控制類對精英 +2、首領 +4；被駭的人那一邊的反應經由 check.before
//   hack.dot       持續型：目標每個回合開始時受感載；同一個目標同時只能掛一個，新的蓋掉舊的
//   hack.takeover  接管一台敵方的無人機或砲塔 turns 回合（或 until: 'battle_end'）：變成我方、由做的人指揮，到期還回去；mode: 'rewrite'：不接管，到期之前它每一輪自己打它原本那一方的人
//   hack.node      拿下一個控制節點
//   hack.detonate  引爆目標快取格裡的一件爆裂物：那一格受一擊、遮蔽降一級、那件道具沒了
// 狀態都記在戰鬥狀態裡（單位的 ext.hack、掛著的東西的 ext.hack），存檔、回退才對得上。

import type { BattleEffectCtx, BattleOverlay, ItemEntry, BattleRun, BattleSide, BattleUnit, Kernel, RollPart } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, amount, onField, overlayAt, unitAt, unitTag } from '../../core'
import { GRADE_CHECK, OWNER, deckOf } from './deck'
import { isExplosive } from './actions'
import { B, F, S, isRecord, oneOf, schema } from './schema'

type Ctx = BattleEffectCtx
type Eff = Record<string, unknown>

/** 公式或數字（不丟錯：壞掉的當預設）。 */
function qty(ctx: Pick<Ctx, 'run' | 'user' | 'n'>, v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  try {
    const n = Math.round(amount(ctx, v as number | string))
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

const sum = (parts: RollPart[]): number => parts.reduce((s, p) => s + p.value, 0)

// ---- 檢定 ----

/** 目標的防火牆（dev/adr/0015 E5）：有甲板用甲板的，沒有的用不含遮蔽與狀態的迴避；再加修正 firewall（問的是目標）。 */
function firewallOf(ctx: Ctx, target: BattleUnit, tags: string[]): number {
  const deck = deckOf(target)
  return (deck ? deck.firewall : target.evade) + sum(ctx.run.mods('firewall', target, ctx.user, undefined, tags))
}

function checkOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const cls = typeof e.class === 'string' ? e.class : undefined
  const tags = ['hack', 'quickhack', ...(cls ? [`hack:${cls}`] : [])]
  const t = ctx.target
  let dc: number
  let victim: BattleUnit | undefined
  if (ctx.overlay) {
    // 無人機與砲塔沒有甲板：用它的迴避（E5）
    dc = run.standIn(ctx.overlay).evade
  } else if (ctx.unit && !run.isStandIn(ctx.unit) && ctx.unit.id !== user.id) {
    victim = ctx.unit
    dc = firewallOf(ctx, victim, tags)
    // 控制類打精英與首領比較難（ITEMS 11.9 節）
    if (cls === 'control') dc += victim.rank === 'boss' ? 4 : victim.rank === 'elite' ? 2 : 0
  } else if (!ctx.unit && t && 'node' in t) {
    // 控制節點沒有甲板：節點自己的 ext.firewall，沒寫是 10（甲板的預設）
    const node = run.battle.nodes.find((n) => n.id === t.node)
    const fw = node?.ext?.firewall
    dc = typeof fw === 'number' ? fw : 10
  } else {
    // 沒有對象（對自己、一格）：沒有東西可以對，不必檢定
    ctx.last.ok = true
    return
  }
  // 被駭的人那一邊的反應（偷看是不行的喔）在這裡改這一次的 DC：掛點的 unit 是被駭的人、other 是丟程式的人。
  // 不把 other 交給 run.save：save 發 check.before 時 unit 是擲骰的人，會讓丟程式的人自己的反應觸發
  const opts = { dc, bonus: 0 }
  if (victim) run.k.battle.emit('check.before', { run, unit: victim, other: user, tags, opts })
  const grade = typeof e.grade === 'number' ? e.grade : 1
  const extra: RollPart[] = [
    { label: '等級加值', value: GRADE_CHECK[grade] ?? 0, source: 'skill' },
    { label: '程式加值', value: qty(ctx, e.bonus, 0), source: 'skill' },
    ...(opts.bonus ? [{ label: '反應', value: opts.bonus, source: 'reaction' }] : []),
  ].filter((p) => p.value !== 0)
  const { ok } = run.save(user, 'intellect', 'interface', opts.dc, '快駭', extra, tags)
  ctx.last.ok = ok
  if (!ok) {
    run.say(`${ctx.source.name}沒有效果（RAM 已經花掉了）。`, undefined, { hack: ctx.source.id, ok: false }, user)
    if (e.stop === true) ctx.last.stop = true
  }
}

// ---- 持續型 ----

interface Dot {
  name: string
  amount: number | string
  turns: number
  by: string
  tier: number
}

export const extOf = (o: { ext?: Record<string, unknown> }): Record<string, unknown> => {
  if (!isRecord(o.ext!.hack)) o.ext!.hack = {}
  return o.ext!.hack as Record<string, unknown>
}
const dotOf = (u: BattleUnit): Dot | undefined => (isRecord(u.ext.hack) && isRecord(u.ext.hack.dot) ? (u.ext.hack.dot as unknown as Dot) : undefined)

function dotOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const u = ctx.unit
  if (!u || run.isStandIn(u) || u.out) return
  if (!u.load) {
    run.say(`${unitTag(u)} 沒有橋，${ctx.source.name}的感載對他無效。`, 'load', { target: u.id, amount: 0 })
    ctx.last.ok = false
    return
  }
  const old = dotOf(u)
  const turns = Math.max(1, qty(ctx, e.turns, 1))
  const dot: Dot = { name: ctx.source.name, amount: e.amount as number | string, turns, by: user.id, tier: ctx.n.tier ?? 0 }
  extOf(u).dot = dot
  run.say(`${unitTag(u)}：${dot.name}${old ? `（蓋掉了${old.name}）` : ''}，之後 ${turns} 個回合開始時各受一次感載。`, 'status', { target: u.id, hack: ctx.source.id, turns, by: user.id }, user)
  ctx.last.ok = true
}

function tickDot(run: BattleRun, u: BattleUnit): void {
  const dot = dotOf(u)
  if (!dot || !u.load || u.out) return
  const by = run.battle.units[dot.by]
  const v = Math.max(0, Math.round(amount({ run, user: by ?? u, n: { tier: dot.tier } }, dot.amount)))
  if (v > 0) run.addLoad(u, v, by, { label: dot.name })
  dot.turns -= 1
  if (dot.turns <= 0 && isRecord(u.ext.hack)) {
    delete u.ext.hack.dot
    run.say(`${unitTag(u)} 的${dot.name}結束了。`, 'status.end', { target: u.id, hack: true })
  }
}

// ---- 接管 ----

/** 被接管（或改寫）的一台身上記的：誰做的、哪一種、還剩幾次做的人的回合結束、原本的樣子。 */
interface Taken {
  by: string
  mode: 'takeover' | 'rewrite'
  /** 還剩幾個做的人的回合結束；null 是到戰鬥結束 */
  left: number | null
  /** 這個回合是做的人自己的回合、才剛接管：這個回合結束不算 */
  fresh: boolean
  from: { side: BattleSide; owner?: string; auto?: boolean; autonomous?: boolean }
}
const takenOf = (o: BattleOverlay): Taken | undefined => (isRecord(o.ext?.hack) && isRecord(o.ext!.hack.taken) ? (o.ext!.hack.taken as unknown as Taken) : undefined)

function takeoverOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const o = ctx.overlay
  if (!o || o.down) return
  if (o.side === user.side) return
  if (takenOf(o)) {
    run.say(`${o.name}已經被接管了。`, 'overlay', { overlay: o.id }, user)
    ctx.last.ok = false
    return
  }
  const mode = e.mode === 'rewrite' ? 'rewrite' : 'takeover'
  const left = e.until === 'battle_end' ? null : Math.max(1, qty(ctx, e.turns, mode === 'rewrite' ? 1 : 2))
  if (mode === 'takeover' && overlayAt(run.battle, user.side, o.slot)) {
    run.say(`我方第 ${o.slot} 格已經掛著一台了，接管不了${o.name}。`, 'overlay', { overlay: o.id }, user)
    ctx.last.ok = false
    return
  }
  const taken: Taken = {
    by: user.id, mode, left, fresh: user.id === run.current()?.id,
    from: { side: o.side, ...(o.owner ? { owner: o.owner } : {}), ...(o.auto ? { auto: true } : {}), ...(o.autonomous ? { autonomous: true } : {}) },
  }
  o.ext = { ...o.ext }
  extOf(o).taken = taken
  // 它原本的操作者與自己動的設定先收起來：到期還回去
  delete o.owner
  delete o.auto
  delete o.autonomous
  if (mode === 'takeover') {
    o.side = user.side
    o.owner = user.id
    o.used = false
    run.say(`${user.name} 接管了${o.name}：它${left === null ? '到戰鬥結束' : ` ${left} 回合`}是我方的，掛在第 ${o.slot} 格。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, taken: true, by: user.id }, user)
  } else {
    run.say(`${user.name} 改寫了${o.name}的敵我名單：${left === null ? '到戰鬥結束' : '到期之前'}它每一輪攻擊它原本的隊友。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, rewrite: true, by: user.id }, user)
  }
  ctx.last.ok = true
}

/** 還回去：原本的那一方、操作者與自己動的設定。那一格被別台佔了就挪到最近的空格，沒有空格就停機。 */
function giveBack(run: BattleRun, o: BattleOverlay): void {
  const t = takenOf(o)
  if (!t) return
  delete (o.ext!.hack as Record<string, unknown>).taken
  o.side = t.from.side
  if (t.from.owner) o.owner = t.from.owner
  else delete o.owner
  if (t.from.auto) o.auto = true
  if (t.from.autonomous) o.autonomous = true
  if (run.battle.overlays.some((x) => x !== o && !x.down && x.side === o.side && x.slot === o.slot)) {
    const free = Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).filter((s) => !overlayAt(run.battle, o.side, s)).sort((a, b) => Math.abs(a - o.slot) - Math.abs(b - o.slot))[0]
    if (free) o.slot = free
    else {
      run.dropOverlay(o, undefined, true)
      return
    }
  }
  run.say(`${o.name}回到${o.side === 'ally' ? '我方' : '敵方'}手上。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, returned: true })
}

// ---- 控制節點、引爆 ----

function nodeOp(ctx: Ctx): void {
  const { run, user } = ctx
  const t = ctx.target
  const node = t && 'node' in t ? run.battle.nodes.find((n) => n.id === t.node) : undefined
  if (!node) throw new BattleBlocked(['要選一個控制節點。'])
  if (node.taken) {
    ctx.last.ok = false
    return
  }
  node.taken = true
  run.say(`${user.name} 拿下了${node.name}。`, 'node', { node: node.id, kind: node.kind, taken: true, by: user.id }, user)
  ctx.last.ok = true
}

function detonateOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const u = ctx.unit
  if (!u || run.isStandIn(u) || u.slot < 1) return
  const slot = u.quick.find((q) => q.qty > 0 && isExplosive(run, q.item))
  if (!slot) {
    run.say(`${unitTag(u)} 的快取格裡沒有爆裂物可以引爆。`, undefined, { target: u.id })
    ctx.last.ok = false
    return
  }
  const name = run.k.content.get<ItemEntry>('item', slot.item)?.name ?? slot.item
  slot.qty -= 1
  if (slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
  run.say(`${user.name} 引爆了${unitTag(u)} 身上的${name}。`, 'item', { unit: user.id, target: u.id, item: slot.item, detonate: true }, user)
  // 那一格受一擊（那一格的人與掛在那一格的東西），遮蔽降一級
  const cell = { side: u.side, slot: u.slot }
  const base = { user, source: ctx.source, pick: ctx.pick, n: ctx.n }
  run.effects([{ op: 'damage', amount: e.dice !== undefined ? e.dice : '2d6', type: typeof e.type === 'string' ? e.type : 'thermal', who: 'area' }], { ...base, target: cell })
  run.effects([{ op: 'cover', levels: -(typeof e.cover === 'number' ? e.cover : 1) }], { ...base, target: cell })
  ctx.last.ok = true
}

// ---- 登錄 ----

export function registerOps(k: Kernel): void {
  k.battle.effect('hack.check', OWNER, checkOp, {
    problems: schema({ class: oneOf(['device', 'cyberware', 'neural', 'control', 'support']), grade: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4 ? null : '要是 1～4 的整數'), bonus: F, stop: B }),
  })
  k.battle.effect('hack.dot', OWNER, dotOp, { problems: schema({ amount: F, turns: F }, ['amount', 'turns']) })
  k.battle.effect('hack.takeover', OWNER, takeoverOp, { problems: schema({ turns: F, until: oneOf(['battle_end']), mode: oneOf(['takeover', 'rewrite']) }) })
  k.battle.effect('hack.node', OWNER, nodeOp, { problems: schema({}) })
  k.battle.effect('hack.detonate', OWNER, detonateOp, { problems: schema({ dice: F, type: S, cover: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2 ? null : '要是 1 或 2（降幾級）') }) })

  // 沒有甲板就沒有 RAM（NETRUNNING 第 1 節）。排在最後：技能給的 RAM（主控的 +3）也算在內，沒有甲板時這一欄沒有效果
  k.battle.on('unit.ready', OWNER, ({ unit }) => {
    if (!deckOf(unit)) delete unit.pools.ram
  }, 100)

  // 持續型：目標每個回合開始時受感載
  k.battle.on('turn.start', OWNER, ({ run, unit }) => tickDot(run, unit))

  // 接管與改寫：做的人的回合結束數一次，到期還回去
  k.battle.on('turn.end', OWNER, ({ run, unit }) => {
    for (const o of run.battle.overlays) {
      const t = takenOf(o)
      if (!t || t.by !== unit.id || t.left === null) continue
      if (t.fresh) {
        t.fresh = false
        continue
      }
      t.left -= 1
      if (t.left <= 0) giveBack(run, o)
    }
  })

  // 改寫：到期之前它每一輪自己打它原本那一方的人，目標由它自己選
  k.battle.on('round.start', OWNER, ({ run }) => {
    for (const o of [...run.battle.overlays]) {
      const t = takenOf(o)
      if (!t || t.mode !== 'rewrite' || o.down || !o.weapon) continue
      const mates = Array.from({ length: BATTLE_SLOTS }, (_, i) => unitAt(run.battle, t.from.side, i + 1)).filter((x): x is BattleUnit => !!x && onField(x))
      const target = run.pick(mates, () => 1)
      if (!target) continue
      run.say(`${o.name}的敵我名單被改寫了，朝${unitTag(target)}開火。`, 'overlay', { overlay: o.id, target: target.id, rewrite: true })
      run.overlayAttack(o, target, { label: '被改寫的射擊' })
      if (run.over) return
    }
  })

  // 做的人倒下了：還沒到期的改寫還回去（接管來的，核心在操作者退出時已經停機）
  k.battle.on('out', OWNER, ({ run, unit }) => {
    for (const o of run.battle.overlays) if (!o.down && takenOf(o)?.by === unit.id) giveBack(run, o)
  })
}
