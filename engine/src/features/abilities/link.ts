// 偶像的應援（共鳴）與曲目（M3-skill-net-b；MEDIA 9.1 節；SKILL_TREES 偶像：應援一節的內海欄；CYBERSPACE 第 5 節）。只在內海戰鬥。
//
// 應援（招牌，內海欄 link: true）：行動 <技能 id>.link，花 1 行動點接上最多「樹階 ＋ 1」名隊友（要有橋；自己不算），之後每回合自動維持（不再花行動點）。
//   資料慣例見 unitdata.ts 的 LinkData：偶像單位 unit.ext.abilities.link = { with, last }；被接上的隊友多一個標籤 linked。
// 分擔（對帳）：被接上的隊友受到感載時，偶像替他承受一半。核心的加感載（run.addLoad）沒有掛點，所以這裡「事後對帳」：每個行動做完、每次攻擊結算完、每個回合的開始與結束、
//   每一輪開頭，比對每個被接上的隊友的感載和上一次對帳時的差，增加的部分一半退給他（run.vent）、偶像用 run.addLoad 承受（吃自己的敏感度與同步檔位的受感載倍率，
//   也就是「分擔時自己承受的越多」；我還可以！的 link_relief 少受幾點；絕唱 link_full 改成全額）。隊友在這一擊裡就過載了的，那一擊的過載來不及攔（缺口：要核心的「受感載之前」掛點）。
// 過載：偶像過載時全部斷開，每個被接上的隊友各吃一次脫鉤衝擊（感載 +10 照原樣不乘敏感度、暈眩一回合）；反應 keep_link（大家不要走）讓這一次不斷開。
// 追蹤度：開著（接著至少一個人）時，每一輪的追蹤度多 +1（修正 trace_round，netcombat 每輪開頭問）。
// 曲目（姿態）：欄的 song 讓淺檔時所有修正的數字減半（mods.ts）、when.sync_min 寫深檔以上那一條；mods 的 who: 'linked' 是「同步中的隊友」。
//   on_link_overload：同步中的隊友讓敵人過載時，那名隊友做這些效果（安可：退還 1 點行動點，全隊每個回合一次）。
//   link_gear（全員同步）：同步中的隊友套用偶像現在的同步檔位（命中與檢定、受到的感載倍率、每回合的行動點）：用「偶像那一檔 − 他自己那一檔」的差補上，等於換成偶像的檔位。
//   效果 link.each：對每一個被接上的隊友各做一串效果；效果 link.dump：絕唱的灌出去。
// 另外兩個小東西放在這裡：no_pin（這個人釘不住：為你而唱）、no_flash（過載不閃斷：護盤）。
// 不 import 別的功能；同步檔位只看單位的 sync:<檔> 標籤與核心的規則表。

import type { BattleActionDef, BattlePick, BattleRun, BattleUnit, BattleView, Kernel, RollPart } from '../../core'
import { BattleBlocked, FLASH, amount, amountProblems, onField, otherSide, syncGearIndex, syncRuleOf, unitTag, unitsOf } from '../../core'
import { colIn, colOf, gearOf, layerOf } from './column'
import { featureTotal } from './mods'
import { bumpUses, costOf, usageBlocks } from './use'
import type { AbilityEntry } from './types'
import { OWNER } from './types'
import { LINKED_TAG, equippedOf, hasAbility, isRec, linkOf, setLink, tierIn } from './unitdata'

/** 脫鉤衝擊：感載 +10、暈眩一回合（NETRUNNING 第 3 節）。 */
export const UNHOOK_LOAD = 10
const DAZED = 'dazed'
/** 安撫給的狀態；帶著它的人花費加 PACIFY_COST 的行動標籤（用武器攻擊、快駭）。 */
export const PACIFIED = 'pacified'
const PACIFY_BLOCKED = ['weapon_attack', 'hack']
const PACIFY_COST = 100

/** 這個偶像現在開著的曲目（姿態；內海欄）。 */
function songOf(view: Pick<BattleView, 'k' | 'mode'>, idol: BattleUnit): { ab: AbilityEntry } | undefined {
  if (!idol.stance) return undefined
  const ab = view.k.content.get<AbilityEntry>('ability', idol.stance)
  return ab && colOf(ab, layerOf(view))?.song ? { ab } : undefined
}

const addTag = (u: BattleUnit): void => void (u.tags.includes(LINKED_TAG) || u.tags.push(LINKED_TAG))
const dropTag = (u: BattleUnit): void => void (u.tags = u.tags.filter((t) => t !== LINKED_TAG))

/** 這個偶像接著的、還站得住的隊友（掉了的、倒下的、退出的隊友從名單拿掉）。 */
function liveMates(run: BattleRun, idol: BattleUnit): BattleUnit[] {
  const link = linkOf(idol)
  if (!link) return []
  const mates = link.with.map((id) => run.battle.units[id]).filter((u): u is BattleUnit => !!u && !u.out && onField(u) && !!u.load)
  if (mates.length !== link.with.length) {
    const keep = new Set(mates.map((m) => m.id))
    for (const id of link.with) if (!keep.has(id)) {
      const gone = run.battle.units[id]
      if (gone) dropTag(gone)
    }
    setLink(idol, { with: mates.map((m) => m.id), last: Object.fromEntries(Object.entries(link.last).filter(([id]) => keep.has(id))) })
  }
  return mates
}

/** 偶像的每個被接上的隊友：感載比上次對帳時多的，一半（絕唱是全部）由偶像承受。 */
function settle(run: BattleRun): void {
  if (run.mode.layer !== 'net' || run.over || settling.has(run)) return
  settling.add(run)
  try {
    for (const idol of unitsOf(run.battle, 'ally')) {
      const link = linkOf(idol)
      if (!link || !link.with.length || idol.out) continue
      const full = !!(idol.stance && songColOf(run, idol)?.link_full)
      for (const mate of liveMates(run, idol)) {
        const now = mate.load!.now
        const cur = linkOf(idol)!
        const was = cur.last[mate.id] ?? now
        cur.last[mate.id] = now
        setLink(idol, cur)
        const d = now - was
        if (d <= 0) continue
        const share = full ? d : Math.floor(d / 2)
        if (share <= 0) continue
        run.vent(mate, share)
        const after = linkOf(idol)!
        after.last[mate.id] = mate.load!.now
        setLink(idol, after)
        const relief = full ? 0 : Math.max(0, featureTotal(run, idol, 'link_relief'))
        const take = Math.max(0, share - relief)
        run.say(`${unitTag(idol)} 替 ${unitTag(mate)} 分擔了 ${share} 點感載${relief && take < share ? `（自己只受 ${take} 點）` : ''}。`, 'skill', { unit: idol.id, target: mate.id, shared: share, taken: take }, idol)
        if (take > 0 && !idol.out) run.addLoad(idol, take, undefined, { label: '分擔' })
        if (idol.out || !linkOf(idol)) break
      }
    }
  } finally {
    settling.delete(run)
  }
}
const settling = new WeakSet<BattleRun>()

function songColOf(view: Pick<BattleView, 'k' | 'mode'>, idol: BattleUnit) {
  const s = songOf(view, idol)
  return s ? colOf(s.ab, layerOf(view)) : undefined
}

/** 斷開所有同步：隊友拿掉 linked 標籤；shock 為 true 時每個人各吃一次脫鉤衝擊。 */
function disconnect(run: BattleRun, idol: BattleUnit, shock: boolean): void {
  const mates = liveMates(run, idol)
  setLink(idol, undefined)
  for (const m of mates) dropTag(m)
  if (!mates.length) return
  run.say(`${unitTag(idol)} 的應援斷了：${mates.map((m) => m.name).join('、')}的同步全部斷開${shock ? '，各吃一次脫鉤衝擊' : ''}。`, 'skill', { unit: idol.id, unlinked: mates.map((m) => m.id), shock }, idol)
  if (!shock) return
  for (const m of mates) {
    if (m.out) continue
    run.addLoad(m, UNHOOK_LOAD, undefined, { exact: true, label: '脫鉤衝擊' })
    if (!m.out && run.k.content.has('battle_status', DAZED)) run.applyStatus(m, DAZED, { by: idol })
  }
}

// ---- 行動：接上隊友 ----

const pickKey = (id: string): string => `link:${id}`

/** 應援的行動：花 1 行動點接上最多「樹階 ＋ 1」名隊友。 */
export function linkAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.link`
  const cap = (u: BattleUnit): number => tierIn(u, ab.path) + 1
  const mates = (v: Pick<BattleView, 'battle'>, u: BattleUnit): BattleUnit[] => unitsOf(v.battle, u.side).filter((t) => t.id !== u.id && !!t.load)
  const room = (u: BattleUnit): number => Math.max(0, cap(u) - (linkOf(u)?.with.length ?? 0))
  return {
    id, owner: OWNER, name: '應援', desc: '把隊友的化身接到自己身上：最多「樹階＋1」名；之後每回合自動維持，替他們分擔一半的感載。你過載時全部斷開，每個人吃一次脫鉤衝擊。開著時追蹤度每輪 +1。',
    group: 'skill', icon: 'skill', modes: ['net'], target: 'none', order,
    has: (v, u) => hasAbility(u, ab.id) && !!colIn(v, u, ab)?.link,
    cost: (v, u) => costOf(v as BattleView, u, ab),
    blocks: (v, u) => {
      const why = [...usageBlocks(v, u, ab)]
      if (!mates(v, u).length) why.push('沒有可以接上的隊友（要有橋的隊友）。')
      else if (room(u) <= 0) why.push(`已經接滿了（最多 ${cap(u)} 名）。`)
      else if (mates(v, u).every((t) => linkOf(u)?.with.includes(t.id))) why.push('每一位隊友都已經接上了。')
      return why
    },
    picks: (v, u): BattlePick[] => mates(v, u).map((t) => ({
      key: pickKey(t.id), label: `接上 ${t.name}`, kind: 'toggle', required: false,
      options: [{ value: true, label: `接上 ${t.name}`, blocks: linkOf(u)?.with.includes(t.id) ? [`${t.name}已經接上了。`] : [] }],
    })),
    run(run, u, _t, input) {
      const have = linkOf(u) ?? { with: [], last: {} }
      const free = mates(run, u).filter((t) => !have.with.includes(t.id))
      const chosen = free.filter((t) => input.pick?.[pickKey(t.id)] === true)
      // 沒有指定就照站位從前面接起（網內沒有距離，全隊都接得到）
      const want = (chosen.length ? chosen : free).sort((a, b) => a.slot - b.slot)
      if (chosen.length > room(u)) throw new BattleBlocked([`最多再接 ${room(u)} 名（樹階＋1 = ${cap(u)} 名）。`])
      const add = want.slice(0, room(u))
      if (!add.length) throw new BattleBlocked(['沒有可以接上的隊友。'])
      bumpUses(u, ab, 'net')
      for (const t of add) {
        addTag(t)
        have.last[t.id] = t.load!.now
      }
      setLink(u, { with: [...have.with, ...add.map((t) => t.id)], last: have.last })
      run.say(`${u.name}：應援，接上了 ${add.map((t) => t.name).join('、')}（${have.with.length + add.length}／${cap(u)}）。`, 'skill', { unit: u.id, ability: ab.id, linked: add.map((t) => t.id) }, u)
    },
  }
}

// ---- 掛點與效果 ----

export function registerLink(k: Kernel): void {
  // 對帳：分擔
  for (const name of ['action.done', 'attack.after', 'turn.start', 'turn.end', 'round.start'] as const) {
    k.battle.on(name, OWNER, ({ run }) => settle(run), 20)
  }

  // 偶像過載：斷開同步（反應 keep_link 擋下）；護盤這類的 no_flash 在這裡先做（不閃斷）
  k.battle.on('overload', OWNER, ({ run, unit, flash }) => {
    if (run.mode.layer !== 'net') return
    if (flash && featureTotal(run, unit, 'no_flash') > 0) {
      const pool = unit.pools[flash.pool]
      if (pool) pool.now = Math.max(pool.now, flash.before)
      run.removeStatus(unit, FLASH, true)
      run.say(`${unitTag(unit)} 過載了，但是沒有閃斷：RAM 還在。`, 'skill', { unit: unit.id, noFlash: true }, unit)
    }
    if (!linkOf(unit)) return
    if (unit.uses.link_keep) {
      delete unit.uses.link_keep
      run.say(`${unitTag(unit)} 過載了，但是同步沒有斷。`, 'skill', { unit: unit.id, kept: true }, unit)
      return
    }
    disconnect(run, unit, true)
  }, 10)

  // 安可：同步中的隊友讓敵人過載，那名隊友做曲目寫的效果（全隊每輪一次）
  k.battle.on('overload', OWNER, ({ run, unit, by }) => {
    if (run.mode.layer !== 'net' || !by || by.side === unit.side) return
    for (const idol of unitsOf(run.battle, by.side)) {
      if (!linkOf(idol)?.with.includes(by.id)) continue
      const s = songOf(run, idol)
      const list = s ? colOf(s.ab, layerOf(run))?.on_link_overload : undefined
      if (!s || !list?.length || idol.uses.link_enc === run.battle.round) continue
      idol.uses.link_enc = run.battle.round
      run.say(`${unitTag(idol)}：${s.ab.name}，${by.name}讓敵人過載了。`, 'skill', { unit: idol.id, ability: s.ab.id, mate: by.id }, idol)
      run.effects(list, { user: idol, target: { unit: by.id }, source: { kind: 'ability', id: s.ab.id, name: s.ab.name }, n: { tier: tierIn(idol, s.ab.path) } })
      return
    }
  }, 11)

  // 偶像或隊友退出：偶像退出整個斷開（不吃脫鉤衝擊：他是倒下，不是過載）
  k.battle.on('out', OWNER, ({ run, unit }) => {
    if (run.mode.layer !== 'net') return
    if (linkOf(unit)) disconnect(run, unit, false)
    dropTag(unit)
  })

  // 開著時每一輪追蹤度多 +1
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.kind !== 'trace_round' || q.view.mode.layer !== 'net' || q.view.battle.units[q.unit.id] !== q.unit) return []
    return linkOf(q.unit)?.with.length ? [{ label: '應援', value: 1, source: 'skill' }] : []
  })

  // 全員同步：同步中的隊友套用偶像現在的檔位（用差補上）
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.view.mode.layer !== 'net' || !q.unit.tags.includes(LINKED_TAG) || q.view.battle.units[q.unit.id] !== q.unit) return []
    if (q.kind !== 'hit' && q.kind !== 'save' && q.kind !== 'load_taken_pct' && q.kind !== 'ap_regen') return []
    const idol = unitsOf(q.view.battle, q.unit.side).find((i) => linkOf(i)?.with.includes(q.unit.id) && songColOf(q.view, i)?.link_gear)
    if (!idol) return []
    const rules = syncRuleOf(q.view.k.content).gears
    const mine = rules[gearOf(q.unit)]
    const theirs = rules[gearOf(idol)]
    if (syncGearIndex(gearOf(q.unit)) === syncGearIndex(gearOf(idol))) return []
    const v = q.kind === 'load_taken_pct' ? theirs.loadPct - mine.loadPct : q.kind === 'ap_regen' ? (theirs.apRegen ?? 0) - (mine.apRegen ?? 0) : theirs.check - mine.check
    return v ? [{ label: '全員同步', value: v, source: 'sync' }] : []
  })

  // 被安撫的人這個回合不攻擊（安撫；狀態 pacified 由規則表給）：攻擊類的行動（用武器攻擊、快駭）花費加上一大筆，AI 付不起就列不出來；還是會移動與用工具
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.kind !== 'action_ap' || q.view.mode.layer !== 'net' || !q.unit.statuses.some((s) => s.id === PACIFIED)) return []
    return q.tags.some((t) => PACIFY_BLOCKED.includes(t)) ? [{ label: '被安撫', value: PACIFY_COST, source: 'status' }] : []
  })

  // 這個人釘不住（為你而唱）
  k.battle.on('out.before', OWNER, ({ run, unit, how, out }) => {
    if (how === 'pinned' && featureTotal(run, unit, 'no_pin') > 0) out.prevent = true
  })

  // 對每一個被接上的隊友各做一串效果
  k.battle.effect('link.each', OWNER, (ctx, e) => {
    for (const mate of liveMates(ctx.run, ctx.user)) {
      ctx.run.effects(e.do as Array<Record<string, unknown>>, { user: ctx.user, target: { unit: mate.id }, source: ctx.source, pick: ctx.pick, n: ctx.n, last: {} })
    }
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'do'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：do）`)
      if (!Array.isArray(e.do) || e.do.length === 0) p.push('do：要是效果的陣列（每個被接上的隊友各做一次）')
      else p.push(...k.battle.effectProblems(e.do).map((m) => `do：${m}`))
      return p
    },
  })

  // 絕唱的灌出去：把做的人現在的感載灌給落在的人（最多 max，深檔以上最多 deep_max），做的人的感載歸零並疊一層餘韻；每場一次
  k.battle.effect('link.dump', OWNER, (ctx, e) => {
    const t = ctx.unit
    const { run, user } = ctx
    if (!t || run.isStandIn(t) || t.side === user.side || !user.load || user.out) return
    if (user.uses.link_dump) return
    const deep = syncGearIndex(gearOf(user)) >= syncGearIndex('deep')
    const cap = Math.round(amount(ctx, (deep && e.deep_max !== undefined ? e.deep_max : e.max) as number | string))
    const n = Math.min(user.load.now, cap)
    user.uses.link_dump = 1
    run.say(`${unitTag(user)} 把自己的感載灌給 ${unitTag(t)}。`, 'skill', { unit: user.id, target: t.id, dump: n }, user)
    if (n > 0) run.addLoad(t, n, user, { exact: true, label: '絕唱' })
    run.vent(user, user.load.now)
    run.effects([{ op: 'afterglow', amount: 1 }], { user, target: { unit: user.id }, source: ctx.source, pick: {}, n: ctx.n, last: {} })
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'max', 'deep_max'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：max、deep_max）`)
      p.push(...(e.max === undefined ? ['max：要寫（最多灌幾點）'] : amountProblems(e.max)))
      if (e.deep_max !== undefined) p.push(...amountProblems(e.deep_max))
      return p
    },
  })
}

/** 裝著的技能裡有沒有應援（畫面與測試用）。 */
export const hasLink = (view: Pick<BattleView, 'k' | 'mode'>, u: BattleUnit): boolean => equippedOf(view, u).some((ab) => !!colIn(view, u, ab)?.link)
export { isRec, otherSide }
