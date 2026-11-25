// L6 功能 netcombat：干擾與破損（CYBERSPACE 6.5 節）。
//
// 干擾：帶 jam 特性的武器（構裝的 type: jam；features/deck 組武器時加了 traits: ['jam']）命中時不加感載（attack.hit 的 out.negate），
//   目標的一類構裝停用一回合——攻擊者選類別（net_attack 的 pick.jam：武器、防護、工具；AI 沒選就是武器）：
//   武器停用是不能做兩個攻擊行動與打牆、防護停用是防護當 0、工具停用是不能用工具構裝與腳本。停用是三個狀態 jam_weapon、jam_defense、jam_tool
//   （規則表 battle_status 要有，各一回合）。
// 破損（內海的重創）：聽 wound，只在內海——目標多一個破損的槽：從裝著的構裝裡（unit.ext.deck.constructs）停用一件（攻擊者不選，
//   照武器、工具、防護的順序挑還沒破損的第一件）；沒有構裝可以破損的人（沒有甲板資料的敵人）改成這一場傷害骰少 1 顆。
//   輕的到戰鬥結束；本來就有破損再中一次是重的：結束時寫回角色（狀況 net_broken 加上 actor.ext.net_broken 記是哪幾件，直到修好）。雜兵不算破損（核心已經改成多 1 顆骰，不發 wound）。
//   帶到下一場（M3 白箱修正批，B028）：下一場內海戰鬥開打時，角色帶著 net_broken 的話，記下的那幾件放進 ext.net.broken（不能用；沒記是哪一件的，照武器、工具、防護的順序挑還沒破損的第一件）。
//   修好：睡一覺（rest.done 的 sleep）全清；到有修理服務的地方付錢修（repair.ts）；戰鬥裡的 net.fix 也算（改造師的除錯）。
// 效果：net.jam、net.break、net.fix。

import type { BattleEffectCtx, BattleRun, BattleUnit, Change, GameState, Kernel, RollPart } from '../../core'
import { isRecord, modeOf, statusRuleOf, unitTag } from '../../core'
import type { JamSlot } from './model'
import { BREAK_ORDER, BROKEN_CONDITION, BROKEN_EXT, JAM_NAME, JAM_SLOTS, OWNER, brokenOf, carriedOf, carryOf, constructEntry, constructsOf, ensureNet, gearOf, isJamSlot, isJammed, jamStatus, netOf } from './model'

type Eff = Record<string, unknown>

// ---- 干擾 ----

/** 這一次攻擊的標籤裡寫的停用類別（net_attack 把玩家選的放在 jam:<類>）；沒有是武器。 */
export function jamSlotOf(tags: readonly string[] | undefined): JamSlot {
  const t = (tags ?? []).find((x) => x.startsWith('jam:'))?.slice(4)
  return isJamSlot(t) ? t : 'weapon'
}

/** 讓目標的一類構裝停用 turns 個回合（沒寫照狀態的資料：一回合）。回傳有沒有給上去。 */
export function jamUnit(run: BattleRun, target: BattleUnit, slot: JamSlot, by?: BattleUnit, turns?: number): boolean {
  const id = jamStatus(slot)
  if (!statusRuleOf(run.k.content, id)) throw new Error(`沒有 ${id} 這個狀態：干擾要先在規則表（battle_status）補上 ${JAM_SLOTS.map(jamStatus).join('、')}`)
  if (target.out || run.isStandIn(target)) return false
  if (!run.applyStatus(target, id, { quiet: true, ...(by ? { by } : {}), ...(turns !== undefined ? { turns } : {}) })) return false
  run.say(`${unitTag(target)} 的${JAM_NAME[slot]}構裝被干擾，停用${turns && turns > 1 ? ` ${turns} 個` : '一個'}回合。`, 'jam', { target: target.id, slot, ...(by ? { by: by.id } : {}) }, by)
  return true
}

// ---- 破損 ----

/**
 * 讓一個單位多一個破損的槽（沒有出聲、沒有重創的記帳；breakOne 與帶進戰鬥的重創共用）。id 有寫就破損那一件（沒裝著或已經破損的不做）；
 * 沒寫照武器、工具、防護的順序挑還沒破損的第一件；沒有構裝可以挑的人改成這一場傷害骰少 1 顆。回傳破損的構裝 id（傷害骰少了一顆是 'dice'），沒做是 null。
 */
function applyBreak(k: Pick<Kernel, 'content'>, u: BattleUnit, id?: string): { what: string; name: string } | null {
  const net = ensureNet(u)
  const broken = brokenOf(u)
  const equipped = constructsOf(k, u).filter((c) => !broken.includes(c.id))
  let pick: { id: string; class: string } | undefined
  if (id !== undefined) pick = equipped.find((c) => c.id === id)
  else {
    for (const cls of BREAK_ORDER) {
      pick = equipped.find((c) => c.class === cls)
      if (pick) break
    }
  }
  if (id !== undefined && !pick) return null
  if (pick) {
    net.broken = [...broken, pick.id]
    return { what: pick.id, name: constructEntry(k, pick.id)?.name ?? pick.id }
  }
  net.dice_loss = (typeof net.dice_loss === 'number' ? net.dice_loss : 0) + 1
  return { what: 'dice', name: '' }
}

/**
 * 讓一個單位多一個破損的槽。id 有寫就破損那一件（沒裝著或已經破損的不做）；沒寫照武器、工具、防護的順序挑還沒破損的第一件；
 * 沒有構裝可以挑的人改成這一場傷害骰少 1 顆。本來就有破損（或傷害骰已經少了）再中一次是重的：記下壞的是哪一件（ext.net.carry），戰後帶回角色（B028）。
 * 回傳破損的構裝 id（傷害骰少了一顆是 'dice'），沒做是 null。
 */
export function breakOne(run: BattleRun, u: BattleUnit, by?: BattleUnit, id?: string): string | null {
  if (u.out || run.isStandIn(u)) return null
  const net = ensureNet(u)
  const was = brokenOf(u).length > 0 || (typeof net.dice_loss === 'number' && net.dice_loss > 0)
  const done = applyBreak(run.k, u, id)
  if (!done) return null
  const { what, name } = done
  const pick = what !== 'dice'
  if (was) {
    net.heavy = true
    net.carry = [...carryOf(u), what]
  }
  const text = pick
    ? `${unitTag(u)} 的構裝「${name}」破損了${was ? '（重創：登出之後也沒修好）' : '，到戰鬥結束前用不了'}。`
    : `${unitTag(u)} 受了破損，這一場傷害骰少 1 顆${was ? '（重創）' : ''}。`
  run.say(text, 'break', { target: u.id, slot: what, heavy: was, ...(by ? { by: by.id } : {}) }, by)
  return what
}

/** 修好一個破損的槽：id 有寫修那一件，沒寫修最近破損的一件；沒有構裝破損時，傷害骰少的那一顆補回來。全部修好之後重創也解除。回傳修好的是什麼，沒做是 null。 */
export function fixOne(run: BattleRun, u: BattleUnit, id?: string): string | null {
  const net = netOf(u) ?? (isRecord(u.ext.net) ? (u.ext.net as Record<string, unknown>) : undefined)
  if (!net) return null
  const broken = brokenOf(u)
  let what: string | null = null
  if (broken.length) {
    const at = id === undefined ? broken.length - 1 : broken.indexOf(id)
    if (at < 0) return null
    what = broken[at]!
    net.broken = broken.filter((_, i) => i !== at)
  } else if (id === undefined && typeof net.dice_loss === 'number' && net.dice_loss > 0) {
    net.dice_loss = net.dice_loss - 1
    what = 'dice'
  } else return null
  // 記著要帶回去的重創也跟著少一筆（修好了就不用再帶；B028）
  const carry = carryOf(u)
  const at = carry.indexOf(what)
  if (at >= 0) net.carry = carry.filter((_, i) => i !== at)
  if (brokenOf(u).length === 0 && !(typeof net.dice_loss === 'number' && net.dice_loss > 0)) delete net.heavy
  const name = what === 'dice' ? '' : (constructEntry(run.k, what)?.name ?? what)
  run.say(what === 'dice' ? `${unitTag(u)} 的破損修好了，傷害骰回來了。` : `${unitTag(u)} 的構裝「${name}」修好了。`, 'break', { target: u.id, slot: what, fixed: true }, u)
  return what
}

// ---- 效果 ----

function target(ctx: BattleEffectCtx): BattleUnit | undefined {
  const u = ctx.unit
  return u && !ctx.run.isStandIn(u) ? u : undefined
}

const only = (e: Eff, keys: string[]): string[] => Object.keys(e).filter((x) => !['op', 'who', 'if', ...keys].includes(x)).map((x) => `${x} 不是這個效果的欄位`)

/** 這幾個人身上的重創（狀況 net_broken 與 ext.net_broken）全部拿掉的變更；沒有人帶著是 undefined。睡一覺與付錢修共用。 */
export function clearBroken(state: GameState, ids: readonly string[]): Change[] | undefined {
  const out: Change[] = []
  for (const id of new Set(ids)) {
    if (carriedOf(state, id) === null) continue
    out.push({ op: 'actor.condition', id, condition: BROKEN_CONDITION, remove: true }, { op: 'actor.ext', id, key: BROKEN_EXT, value: null })
  }
  return out.length ? out : undefined
}

export function installJam(k: Kernel): void {
  // 帶 jam 特性的武器命中：不加感載，目標的一類構裝停用
  k.battle.on('attack.hit', OWNER, ({ run, attacker, target: t, weapon, opts, out }) => {
    if (run.mode.layer !== 'net' || !weapon.traits.includes('jam')) return
    out.negate = true
    jamUnit(run, t, jamSlotOf(opts.tags), attacker)
  })

  // 破損（內海的重創）
  k.battle.on('wound', OWNER, ({ run, attacker, target: t }) => {
    if (run.mode.layer !== 'net') return
    breakOne(run, t, attacker)
  })

  // 武器構裝自己的 do（加上深檔的進階、全檔的終極）：命中時對目標做（CYBERSPACE 6.5 節的干擾本身不在這裡，上面已經做了）
  k.battle.on('attack.after', OWNER, ({ run, attacker, target: t, weapon, result }) => {
    if (run.mode.layer !== 'net' || !result.hit || result.aborted || t.out) return
    const entry = constructEntry(run.k, weapon.id)
    if (!entry || entry.class !== 'weapon' || !constructsOf(run.k, attacker).some((c) => c.id === entry.id)) return
    const gear = gearOf(attacker)
    const list = [...(entry.do ?? []), ...(gear === 'deep' || gear === 'full' ? (entry.advanced?.do ?? []) : []), ...(gear === 'full' ? (entry.ultimate?.do ?? []) : [])]
    if (!list.length) return
    run.effects(list, { user: attacker, target: { unit: t.id }, source: { kind: 'weapon', id: entry.id, name: entry.name }, last: { hit: true, crit: result.crit } })
  })

  // 修正：破損與干擾造成的數字（防護停用是防護當 0、破損的防護構裝不算、破損的被動工具不給加成；沒有構裝可以破損的人傷害骰少 1 顆）
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.view.mode.layer !== 'net') return []
    const u = q.unit
    const out: RollPart[] = []
    const broken = brokenOf(u)
    if (q.kind === 'armor') {
      if (isJammed(u, 'defense')) {
        if (u.armor > 0) out.push({ label: '防護被干擾停用', value: -u.armor, source: 'jam' })
      } else if (broken.length) {
        // 防護構裝只算最高的一件：破損的那一件拿掉之後，少的就是和剩下最高的差
        const guards = constructsOf(q.view.k, u).filter((c) => c.class === 'defense').map((c) => ({ id: c.id, g: constructEntry(q.view.k, c.id)?.guard ?? 0 }))
        const all = Math.max(0, ...guards.map((x) => x.g))
        const alive = Math.max(0, ...guards.filter((x) => !broken.includes(x.id)).map((x) => x.g))
        if (all > alive) out.push({ label: '防護構裝破損', value: -Math.min(all - alive, u.armor), source: 'break' })
      }
    }
    if (q.kind === 'dice') {
      const n = isRecord(u.ext.net) ? u.ext.net.dice_loss : undefined
      if (typeof n === 'number' && n > 0) out.push({ label: '破損', value: -n, source: 'break' })
    }
    // 破損的被動工具：features/deck 的修正還是會給它的 mods，這裡扣回來
    for (const id of broken) {
      const e = constructEntry(q.view.k, id)
      const v = e?.class === 'tool' && e.passive === true ? e.mods?.[q.kind] : undefined
      if (e && typeof v === 'number' && v !== 0) out.push({ label: `${e.name}（破損）`, value: -v, source: 'break' })
    }
    return out
  })

  // 開打：角色帶著上一場的重創（狀況 net_broken）就放進這一場的破損（B028）。排在 sync 的 unit.ready 與 deck 的 unit.ready 之後（ext.net、ext.deck.constructs 都已經掛好）。
  // 記是哪幾件的就破損那幾件（沒裝著的留在 carry、戰後原樣帶回去）；沒記是哪一件的，照武器、工具、防護的順序挑一件（沒有構裝可挑就傷害骰少 1 顆）
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (run.mode.layer !== 'net' || !unit.actor) return
    const ids = carriedOf(run.state, unit.actor)
    if (ids === null) return
    const net = ensureNet(unit)
    net.carry = []
    const list = ids.length ? ids : ([applyBreak(run.k, unit)?.what].filter((x): x is string => x !== undefined))
    for (const id of list) {
      if (ids.length) {
        if (id === 'dice') net.dice_loss = (typeof net.dice_loss === 'number' ? net.dice_loss : 0) + 1
        else if (constructsOf(run.k, unit).some((c) => c.id === id) && !brokenOf(unit).includes(id)) net.broken = [...brokenOf(unit), id]
        else if (brokenOf(unit).includes(id)) continue
      }
      net.carry = [...carryOf(unit), id]
    }
    if (brokenOf(unit).length > 0 || (typeof net.dice_loss === 'number' && net.dice_loss > 0)) net.heavy = true
  }, 5)

  // 開打的第一拍：誰帶著上一場沒修好的構裝（unit.ready 的紀錄會被清掉，所以放在這裡）
  k.battle.on('battle.start', OWNER, ({ run }) => {
    if (run.mode.layer !== 'net') return
    for (const u of Object.values(run.battle.units)) {
      if (u.side !== 'ally' || !u.actor || !brokenOf(u).length) continue
      if (carryOf(u).every((id) => !brokenOf(u).includes(id))) continue
      const names = brokenOf(u).filter((id) => carryOf(u).includes(id)).map((id) => `「${constructEntry(run.k, id)?.name ?? id}」`).join('、')
      run.say(`${unitTag(u)} 帶著上一場沒修好的重創：構裝${names}破損了，這一場用不了。`, 'break', { target: u.id, carried: true }, u)
    }
  })

  // 戰後：重創的（破損又中一次）寫回角色，狀況 net_broken 一直留到修好（睡一覺、付錢修）；ext.net_broken 記是哪幾件（B028）。
  // 開打時帶著、這一場當場修好了的，把狀況拿掉
  k.battle.onEnd(OWNER, ({ state, battle }) => {
    if (modeOf(k.content, battle.mode)?.layer !== 'net') return
    const changes: Change[] = []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const u of Object.values(battle.units)) {
      if (u.side !== 'ally' || !u.actor || seen.has(u.actor) || !state.actors[u.actor] || !isRecord(u.ext.net)) continue
      seen.add(u.actor)
      const carry = carryOf(u)
      const had = carriedOf(state, u.actor)
      if (u.ext.net.heavy === true || carry.length > 0) {
        // 沒變的（上一場帶來的原樣帶回去）不再寫；角色身上記的和單位的不一樣（包括壞掉的資料、沒記是哪一件的）就照單位的重寫
        if (had !== null && JSON.stringify(state.actors[u.actor]!.ext[BROKEN_EXT]) === JSON.stringify(carry)) continue
        changes.push({ op: 'actor.condition', id: u.actor, condition: BROKEN_CONDITION }, { op: 'actor.ext', id: u.actor, key: BROKEN_EXT, value: carry })
        lines.push(`重創：${u.name}的構裝破損（要修理）`)
      } else if (had !== null) {
        changes.push({ op: 'actor.condition', id: u.actor, condition: BROKEN_CONDITION, remove: true }, { op: 'actor.ext', id: u.actor, key: BROKEN_EXT, value: null })
        lines.push(`${u.name}的構裝修好了。`)
      }
    }
    return changes.length ? { changes, lines } : undefined
  })

  // 睡一覺：登出之後睡一覺，重創的構裝就修好了（CYBERSPACE 6.5 節）。喘口氣與副本階段之間的休息不算
  k.hooks.on('rest.done', OWNER, ({ state, kind }) => (kind === 'sleep' ? clearBroken(state, state.party) : undefined))

  // net.jam { slot?: 'weapon' | 'defense' | 'tool', turns? }：落在的人一類構裝停用（沒寫 slot 看玩家選的 pick.jam，再沒有就是武器）
  k.battle.effect('net.jam', OWNER, (ctx, e) => {
    const t = target(ctx)
    if (!t) return
    const slot = isJamSlot(e.slot) ? e.slot : isJamSlot(ctx.pick.jam) ? ctx.pick.jam : 'weapon'
    ctx.last.ok = jamUnit(ctx.run, t, slot, ctx.user, typeof e.turns === 'number' ? Math.max(1, Math.floor(e.turns)) : undefined)
  }, {
    problems: (e) => [
      ...only(e, ['slot', 'turns']),
      ...(e.slot !== undefined && !isJamSlot(e.slot) ? [`slot 只能是 ${JAM_SLOTS.join('、')}`] : []),
      ...(e.turns !== undefined && !(Number.isInteger(e.turns) && (e.turns as number) >= 1) ? ['turns 要是 1 以上的整數'] : []),
    ],
  })

  // net.break { slot? }：落在的人多一個破損的槽（slot 是構裝的 id；沒寫照武器、工具、防護的順序）
  k.battle.effect('net.break', OWNER, (ctx, e) => {
    const t = target(ctx)
    if (!t) return
    ctx.last.ok = breakOne(ctx.run, t, ctx.user, typeof e.slot === 'string' ? e.slot : undefined) !== null
  }, {
    problems: (e) => [...only(e, ['slot']), ...(e.slot !== undefined && !(typeof e.slot === 'string' && e.slot.trim()) ? ['slot 要是構裝的 id'] : [])],
  })

  // net.fix { slot? }：修好落在的人一個破損的槽（沒寫修最近破損的）
  k.battle.effect('net.fix', OWNER, (ctx, e) => {
    const t = target(ctx)
    if (!t) return
    ctx.last.ok = fixOne(ctx.run, t, typeof e.slot === 'string' ? e.slot : undefined) !== null
  }, {
    problems: (e) => [...only(e, ['slot']), ...(e.slot !== undefined && !(typeof e.slot === 'string' && e.slot.trim()) ? ['slot 要是構裝的 id'] : [])],
  })
}
