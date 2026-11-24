// L6 功能 netcombat：釘住、拔線、投降、倒下與扣線的後果、戰鬥裡的追蹤度（CYBERSPACE 6.3 節的三列、6.7、6.8 節；NETRUNNING 第 3、5 節；dev/adr/0018 第一節、第十節、N12、N15、N17、N22、N32）。
//
//   行動   net_pin（tactic，2 行動點、1 RAM）、net_jack_out（system，1 行動點、長按）、net_surrender（system，0、長按）
//   釘住   目標餘韻疊滿、雙方都在第 1 格；檢定取「智識加介面」與「意志加格鬥」裡加值高的一組，對 n.subdueDc，標籤 pin；成功就 setOut(目標, 'pinned')
//   拔線   setOut(自己, 'jacked_out')；我方全部都是這樣退出時，核心照戰場的 leave 把結果定成 jack_out（不是戰敗）
//   投降   結果 surrender（和現實一樣；之後不再受感載，還站著的人不算倒下）
//   戰後   battle.result 掛點：打輸而贏的那一方有 tether 標籤 → 沒逃掉的我方標成被扣線（beat tag tether、data.tethered）；打贏而有人被釘住 → 自動拆掉（beat tag pin、data.unpinned）
//          k.battle.onEnd：昏過去或被釘住退出的角色給 net_burn（burn_minutes 分鐘；場地 safe 也照給）
//   追蹤度 只在 battle.field.trace 是數字時：每輪開頭（第 2 輪起）加 round（加我方修正 trace_round，最少 0）、敵方在場有 lace:white 再加 white（不疊）；
//          門檻 t1、t2 把 origin.ext.net.reinforce 的人叫進來（run.callIn；一次，沒有空格的留著，之後每輪開頭再試）；t3 開始定位的倒數，降回門檻以下取消，到 0 結束戰鬥（lose）。
// 這個功能不讀量表與地圖：追蹤度只認 battle.field.trace 這個數字。

import type { BattleActionDef, BattleRun, BattleState, BattleTarget, BattleUnit, BattleView, Change, Kernel, UnitRef } from '../../core'
import { BattleBlocked, afterglowFull, attrMod, isRecord, modeOf, otherSide, toMinutes, unitTag, unitsOf } from '../../core'
import { MODES, OWNER, ensureNet, netcombatRules } from './model'

type SubdueDc = { base: number; perGrade: number; elite: number; boss: number }

// ---- 釘住 ----

/** 釘住的 DC：10 ＋ 目標的等級 × 2，精英再 +2、首領再 +4（和現實的制伏同一條，n.subdueDc）。 */
export function pinDc(view: Pick<BattleView, 'n'>, t: BattleUnit): number {
  const d: SubdueDc = view.n.subdueDc
  return d.base + t.grade * d.perGrade + (t.rank === 'elite' ? d.elite : t.rank === 'boss' ? d.boss : 0)
}

/** 釘住在 ENEMIES 4.3 節的行動分（和制伏一樣 4）；站在釘得到人的那一格，位置分也加這麼多（dev/adr/0014）。 */
const PIN_SCORE = 4

/** 這個人從 slot 那一格釘不住 t 的原因，一條一個條件（CYBERSPACE 6.7 節）；空的就是釘得住。畫面的灰掉原因與 AI 的位置分共用。 */
export function pinBlocks(slot: number, t: BattleUnit): string[] {
  const blocks: string[] = []
  if (!afterglowFull(t)) blocks.push(`餘韻要疊滿才釘得住（現在 ${t.layers}／${t.layersMax} 層）。`)
  if (slot !== 1 || t.slot !== 1) blocks.push('要在近身：雙方都站在第 1 格。')
  return blocks
}

/** 釘住的檢定用哪一組：智識加介面，或意志加格鬥，取加值高的（一樣高就用智識）。 */
function pinCheckOf(u: BattleUnit): { attr: 'intellect' | 'resolve'; skill: 'interface' | 'brawl' } {
  const mind = attrMod(u.attrs.intellect ?? 10) + (u.skills.interface ?? 0)
  const will = attrMod(u.attrs.resolve ?? 10) + (u.skills.brawl ?? 0)
  return will > mind ? { attr: 'resolve', skill: 'brawl' } : { attr: 'intellect', skill: 'interface' }
}

/**
 * 釘住一次（行動與效果 net.pin 共用；不花費）：條件不成立回傳 false、什麼都不做；檢定沒過回傳 false（檢定自己記一拍）；
 * 成功就讓目標以 pinned 退出（out.before 掛點可以擋下：技能「不讓你帶走」）；「被釘住了」那一拍（標籤 pin，data 帶 target、by、side）核心的 leave 記，這裡不再另記。回傳目標有沒有真的被釘住。
 */
export function pinUnit(run: BattleRun, user: BattleUnit, t: BattleUnit): boolean {
  if (t.out || run.isStandIn(t) || run.isStandIn(user) || t.side === user.side || pinBlocks(user.slot, t).length) return false
  const { attr, skill } = pinCheckOf(user)
  const { ok } = run.save(user, attr, skill, pinDc(run, t), '釘住', [], ['pin'])
  if (!ok) return false
  if (!run.setOut(t, 'pinned', user)) {
    run.say(`${unitTag(user)} 沒能把${unitTag(t)}釘在線上：有東西擋下了。`, undefined, { unit: user.id, target: t.id }, user)
    return false
  }
  return true
}

const pin: BattleActionDef = {
  id: 'net_pin', owner: OWNER, name: '釘住', desc: '把一個餘韻疊滿、近身的敵人釘在線上，讓他退出戰鬥、登不出去；要先過一次檢定（智識加介面，或意志加格鬥）。',
  group: 'tactic', icon: 'subdue', order: 4, target: 'foe', modes: MODES,
  cost: () => ({ ap: 2, ram: 1 }),
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: pinBlocks(u.slot, t), hint: { dc: pinDc(view, t) } })),
  run: (run, u, target) => {
    if (!target || !('unit' in target)) return
    const t = run.unit(target.unit)
    const why = pinBlocks(u.slot, t)
    if (why.length) throw new BattleBlocked(why)
    pinUnit(run, u, t)
  },
  // 要活的敵人（打法 capture）會靠過來釘人：和制伏一樣 4 分，和別的行動一起抽
  aiScore: (_v, u, t) => (t && u.ai?.mode === 'capture' ? PIN_SCORE : null),
  // AI 挑的目標釘不了、但場上有釘得了的人：改對那個人動手
  aiTarget: (view, u, t) => {
    const ok = unitsOf(view.battle, otherSide(u.side)).filter((x) => pinBlocks(u.slot, x).length === 0)
    const pick = t && ok.some((x) => x.id === t.id) ? t : ok[0]
    return pick ? { unit: pick.id } : t ? { unit: t.id } : null
  },
  // 站在第 1 格才釘得到人：位置分加上釘住的分數，要抓人的敵人才不會先換位走開
  aiSlotScore: (view, u, slot) => (u.ai?.mode === 'capture' && unitsOf(view.battle, otherSide(u.side)).some((t) => pinBlocks(slot, t).length === 0) ? PIN_SCORE : 0),
}

// ---- 拔線與投降 ----

const jackOut: BattleActionDef = {
  id: 'net_jack_out', owner: OWNER, name: '拔線', desc: '自己登出，退出這場戰鬥，沒有代價；全隊都拔線等於撤退。要長按。',
  group: 'system', icon: 'flee', order: 1, target: 'none', hold: true, modes: MODES,
  cost: () => ({ ap: 1 }),
  run: (run, u) => {
    if (!run.setOut(u, 'jacked_out')) run.say(`${unitTag(u)} 想拔線，但是被擋下了。`, undefined, { unit: u.id }, u)
  },
}

const surrender: BattleActionDef = {
  id: 'net_surrender', owner: OWNER, name: '投降', desc: '放下武器認輸，戰鬥立刻結束，算戰敗；不花行動點，一定成功，之後不再受感載。要長按。',
  group: 'system', icon: 'surrender', order: 2, target: 'none', hold: true, modes: MODES,
  cost: () => ({ ap: 0 }),
  run: (run, u) => {
    run.say(`${u.name} 舉起手投降了。`, 'surrender', { unit: u.id }, u)
    run.finish('surrender', '投降：戰鬥結束，算戰敗。')
  },
}

export const OUT_ACTIONS: BattleActionDef[] = [pin, jackOut, surrender]

// ---- 追蹤度 ----

/** 這一場有沒有追蹤度（battle.field.trace 是數字）；沒有就是 undefined，整段不做。 */
export const traceOf = (b: BattleState): number | undefined => (typeof b.field.trace === 'number' && Number.isFinite(b.field.trace) ? b.field.trace : undefined)

const TRACE_MIN = -30
const TRACE_MAX = 100

/** 開戰的人給的 origin.ext.net（reinforce、locate_rounds）。 */
const originNet = (b: BattleState): Record<string, unknown> => (isRecord(b.origin.ext?.net) ? b.origin.ext.net : {})

/** 某個門檻要叫的人：reinforce.t30 或 reinforce.t60，可以是一筆來源或一串。 */
function reinforcements(b: BattleState, key: 't30' | 't60'): UnitRef[] {
  const r = originNet(b).reinforce
  const v = isRecord(r) ? r[key] : undefined
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v]
  return list.filter((x): x is UnitRef => isRecord(x) && typeof x.from === 'string')
}

/** 門檻對應的場地欄位：t30、t60 記「叫過了」；<key>_n 記已經叫進幾個（沒有空格叫不進來的，之後每輪開頭再試）。 */
const doneKey = (key: 't30' | 't60'): string => `${key}_n`

/** 叫還沒叫進來的增援（沒有空格就留著）。回傳這一次叫進了幾個。 */
function callPending(run: BattleRun, key: 't30' | 't60'): number {
  const b = run.battle
  const refs = reinforcements(b, key)
  let n = typeof b.field[doneKey(key)] === 'number' ? (b.field[doneKey(key)] as number) : 0
  let added = 0
  while (n < refs.length && !run.over) {
    if (!run.callIn('foe', refs[n]!)) break
    n += 1
    added += 1
  }
  if (refs.length) b.field[doneKey(key)] = n
  return added
}

/** 定位的倒數幾輪（開戰的人可以改，沒寫照規則表）。 */
function locateRounds(run: BattleRun): number {
  const v = originNet(run.battle).locate_rounds
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : netcombatRules(run.k).trace.locate_rounds
}

/**
 * 開戰時已經在門檻上的：算「這座子網以前到過」，不再叫增援（使用者 2026-11-24：增援只在這一場裡跨過門檻才叫；M3 審查建議 3）。
 * 第一輪開頭做一次：追蹤度已經 ≥ 門檻的，把 field.t30／t60 記成叫過了、已經叫進的人數記成全部（之後每輪補空格也不會叫）。定位的倒數照舊（到了 90 就是到了）。
 */
function markStarting(run: BattleRun): void {
  const b = run.battle
  const v = traceOf(b)
  if (v === undefined) return
  const rules = netcombatRules(run.k).trace
  for (const [key, at] of [['t30', rules.t1], ['t60', rules.t2]] as const) {
    if (v >= at && b.field[key] === undefined) {
      b.field[key] = true
      b.field[doneKey(key)] = reinforcements(b, key).length
    }
  }
}

/** 跨過門檻的事（增援、定位的倒數開始與取消）。每次追蹤度變動之後問一次。 */
function crossings(run: BattleRun): void {
  const b = run.battle
  const v = traceOf(b)
  if (v === undefined || run.over) return
  const rules = netcombatRules(run.k).trace
  for (const [key, at] of [['t30', rules.t1], ['t60', rules.t2]] as const) {
    if (v >= at && b.field[key] !== true) {
      b.field[key] = true
      callPending(run, key)
    }
  }
  const located = b.field.located
  if (v >= rules.t3 && located === undefined) {
    const n = locateRounds(run)
    b.field.located = n
    run.say(`追蹤度到了 ${rules.t3}：已經被定位，現實的增援在路上。${n} 輪之後全隊會被強制斷線，想辦法把追蹤度壓下去。`, 'located', { countdown: n, trace: v })
  } else if (v < rules.t3 && typeof located === 'number') {
    delete b.field.located
    run.say('追蹤度降下來了：定位被甩開了，強制斷線取消。', 'located', { cancelled: true, trace: v })
  }
}

/**
 * 追蹤度加減 amount 點（戰鬥每輪、管理行動、檢定失敗、效果 net.trace 共用），夾在 −30～100；沒有追蹤度的場地不做。
 * 連動讓這一段的上升減半（開戰的人在 origin.ext.net.trace_half 給 true；M3 審查應修 2）：正的量減半（進位），減少的不動。
 * 每次變動記一拍 trace（data 帶新的值 value 與實際加了多少 amount）；跨過門檻的事照上面做。回傳實際加了多少（沒有變動是 0）。
 */
export function addTrace(run: BattleRun, amount: number, o: { by?: BattleUnit; text?: string } = {}): number {
  const b = run.battle
  const from = traceOf(b)
  if (from === undefined || run.over || !Number.isFinite(amount)) return 0
  const halved = Math.round(amount) > 0 && originNet(b).trace_half === true
  const add = halved ? Math.ceil(Math.round(amount) / 2) : Math.round(amount)
  const to = Math.max(TRACE_MIN, Math.min(TRACE_MAX, from + add))
  if (to === from) return 0
  b.field.trace = to
  const diff = to - from
  const text = halved ? `追蹤度 +${diff}（連動讓上升減半，現在 ${to}）。` : (o.text ?? `追蹤度 ${diff > 0 ? '+' : '−'}${Math.abs(diff)}（現在 ${to}）。`)
  run.say(text, 'trace', { value: to, amount: diff, ...(halved ? { halved: true } : {}), ...(o.by ? { by: o.by.id } : {}) }, o.by)
  crossings(run)
  return diff
}

/** 一輪開頭的追蹤度（第 2 輪起）：定位的倒數、沒叫進來的增援、這一輪加的。 */
function roundStart(run: BattleRun, round: number): void {
  const b = run.battle
  if (traceOf(b) === undefined || round < 2) return
  const rules = netcombatRules(run.k).trace
  // 1. 倒數少 1；到 0 就是被定位：全隊被強制斷線，這場算戰敗（走「被定位」的戰敗事件，M3-defeat-net 讀 battle.field.located）
  const left = b.field.located
  if (typeof left === 'number') {
    if (left <= 1) {
      b.field.located = true
      run.say('被定位了：現實的增援趕到接入點，全隊被強制斷線。', 'located', { located: true })
      run.finish('lose', '被定位：全隊被強制斷線，算戰敗。')
      return
    }
    b.field.located = left - 1
    run.say(`定位的倒數：還剩 ${left - 1} 輪。`, 'located', { countdown: left - 1 })
  }
  // 2. 以前沒有空格叫不進來的增援，現在有空格就補
  for (const key of ['t30', 't60'] as const) if (b.field[key] === true) callPending(run, key)
  // 3. 這一輪加的：基本的 round 加我方的修正（最少 0）；敵方在場有白蕾絲再加 white（不疊）
  const mods = unitsOf(b, 'ally').reduce((s, u) => s + run.mods('trace_round', u).reduce((t, p) => t + p.value, 0), 0)
  let amount = Math.max(0, rules.round + mods)
  const white = unitsOf(b, 'foe').some((u) => u.tags.includes('lace:white'))
  if (white) amount += rules.white
  if (amount) addTrace(run, amount, { text: `追蹤度 +${amount}${white ? '（白蕾絲在場）' : ''}。` })
}

// ---- 戰後 ----

/** 這一場以這幾種方式退出的我方角色，戰後給 net_burn（昏過去、被釘住、生命歸零倒下）。 */
const BURN_OUT = ['down', 'burnout', 'pinned']

const nameList = (list: BattleUnit[]): string => list.map((u) => u.name).join('、')

export function installOut(k: Kernel): void {
  for (const def of OUT_ACTIONS) k.battle.action(def)

  k.battle.on('round.start', OWNER, ({ run, round }) => {
    if (run.mode.layer !== 'net') return
    if (round === 1) markStarting(run)
    roundStart(run, round)
  })

  // 分出結果的那一刻：打贏的，被釘住的隊友自動拆掉釘子（N22）；打輸的，贏的那一方有人帶 tether，沒逃掉的人被扣線
  k.battle.on('battle.result', OWNER, ({ run, outcome }) => {
    if (run.mode.layer !== 'net') return
    const allies = Object.values(run.battle.units).filter((u) => u.side === 'ally')
    if (outcome === 'win') {
      const pinned = allies.filter((u) => u.out === 'pinned')
      if (!pinned.length) return
      for (const u of pinned) ensureNet(u).unpinned = true
      run.say(`贏了：${nameList(pinned)}身上的釘子自動拆掉了。`, 'pin', { unpinned: pinned.map((u) => u.id) })
    } else if (outcome === 'lose') {
      const winners = Object.values(run.battle.units).filter((u) => u.side === 'foe' && !u.out)
      // 不扣線：場地 safe（館方的熔斷設定，迷宮館；CYBERSPACE 8.2 節）、或贏的那一方全是沒有主人的野生程式（標籤 wild；ENEMIES 第 9 節「打倒全隊之後放人斷線，不扣線」）
      if (run.battle.field.safe === true || (winners.length > 0 && winners.every((u) => u.tags.includes('wild')))) return
      const caught = allies.filter((u) => u.out !== 'jacked_out')
      const by = winners.some((u) => u.tags.includes('tether')) ? caught : allies.filter((u) => isRecord(u.ext.net) && u.ext.net.tethered === true)
      if (!by.length) return
      for (const u of by) ensureNet(u).tethered = true
      run.say(`${nameList(by)}被扣線了：意識留在網內，出不去。`, 'tether', { tethered: true, units: by.map((u) => u.id) })
    }
  })

  // 戰後：倒下的人（昏過去、被釘住）回到現實一小時內不能再潛入。場地 safe 只管核心的沉溺 +2，這裡照給
  k.battle.onEnd(OWNER, ({ k: kernel, state, battle }) => {
    if (modeOf(kernel.content, battle.mode)?.layer !== 'net') return
    const changes: Change[] = []
    const burned: BattleUnit[] = []
    const pinned: BattleUnit[] = []
    const seen = new Set<string>()
    const until = toMinutes(state.time) + netcombatRules(kernel).burn_minutes
    for (const u of Object.values(battle.units)) {
      if (u.side !== 'ally' || !u.out || !BURN_OUT.includes(u.out)) continue
      if (u.out === 'pinned') pinned.push(u)
      if (!u.actor || seen.has(u.actor) || !state.actors[u.actor]) continue
      seen.add(u.actor)
      const had = state.actors[u.actor]!.conditions.find((c) => c.id === 'net_burn')
      changes.push({ op: 'actor.condition', id: u.actor, condition: 'net_burn', until: Math.max(until, had?.until ?? 0) })
      burned.push(u)
    }
    const lines = [...(pinned.length ? [`被釘住：${nameList(pinned)}`] : []), ...(burned.length ? [`一陣子不能再潛入：${nameList(burned)}`] : [])]
    return changes.length || lines.length ? { changes, lines } : undefined
  })
}
