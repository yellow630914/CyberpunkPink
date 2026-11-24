// L6 功能 deck：帶進戰鬥。
//   loadout（只在內海）：每個裝著的武器構裝變成一把武器（從 weapon_class 的原型起算，等級照 deck_rule 的加值，沒有彈匣、花 RAM、
//     傷害類型照 type；命中與固定傷害的屬性照戰場代替過的 battleAttr），腳本當快取格。現實的戰鬥不帶它們（現實的槍與快取格是 features/gear 的）。
//   unit.ready（兩個戰場）：有甲板的角色 unit.ext.deck = { grade, firewall, slots: 裝著的快駭程式, constructs }（features/hack 讀）；沒有甲板的人拿掉 RAM 那一池。
//   modifier：裝著的被動工具的 mods（只在內海）。
//   onEnd：內海戰鬥裡用掉的腳本，從背包與 ext.deck.scripts 扣掉（做法照 features/gear 對快取格的：開打時帶的和單位現在的比）。

import type { BattleKernel, BattleUnit, BattleWeapon, Change, ItemEntry, Kernel, RollPart, WeaponClassEntry } from '../../core'
import { attrMod, battleAttr, countItem, isRecord, modeOf, weaponFromClass } from '../../core'
import type { ConstructEntry, DeckRules, ScriptEntry } from './model'
import { CONSTRUCT_KIND, OWNER, deckRules, diceOf, extOf, extValue, gradeBonus } from './model'
import type { DeckInfo, Piece } from './state'
import { deckOf } from './state'

/** 一把武器構裝在這個戰場裡的樣子。 */
export function constructWeapon(k: BattleKernel, state: Parameters<BattleKernel['stats']['effectiveAttr']>[0], actor: string, modeId: string, piece: Piece, rules: DeckRules): BattleWeapon | null {
  const e = k.content.get<ConstructEntry>(CONSTRUCT_KIND, piece.id)
  const mode = modeOf(k.content, modeId)
  if (!e || e.class !== 'weapon' || !e.archetype || !k.content.has('weapon_class', e.archetype)) return null
  const cls = k.content.require<WeaponClassEntry>('weapon_class', e.archetype)
  const bonus = gradeBonus(rules, piece.runsAt)
  // 命中的屬性與固定傷害的屬性照戰場代替過的（內海：體格由意志代替；傷害一律是魅力）
  const hitAttr = battleAttr(mode, cls.attr)
  const flatAttr = battleAttr(mode, 'charm')
  const jam = e.type === 'jam'
  const w = weaponFromClass(k.content, e.archetype, {
    id: e.id, name: e.name,
    hit: attrMod(k.stats.effectiveAttr(state, actor, hitAttr)) + (state.actors[actor]?.skills[cls.skill] ?? 0) + bonus.hit,
    extraDice: bonus.dice,
    flat: attrMod(k.stats.effectiveAttr(state, actor, flatAttr)),
    type: e.type === 'pleasure' ? 'pleasure' : 'neural',
    ...(e.range ? { range: [e.range[0], e.range[1]] as [number, number] } : {}),
    ...(e.traits || jam ? { traits: [...(e.traits ?? []), ...(jam ? ['jam'] : [])] } : {}),
  })
  const base = diceOf(e.dice)
  if (base !== undefined) w.dice = base + bonus.dice
  if (e.cover_mult !== undefined) w.coverMult = e.cover_mult
  // 內海的武器構裝沒有彈匣，每次攻擊從 RAM 花
  delete w.mag
  w.attr = hitAttr
  w.pool = { ram: e.ram ?? 1 }
  return w
}

const modesOf = (k: Kernel, id: string) => modeOf(k.content, id)

/** 開打時帶進內海的腳本：照甲板整理過的那一份（loadout 與戰後結算共用）。 */
const scriptsOf = (info: DeckInfo): ScriptEntry[] => info.scripts.map((s) => ({ ...s }))

export function installBattle(k: Kernel): void {
  k.battle.loadout(OWNER, (state, actor, modeId) => {
    if (!state.actors[actor] || modesOf(k, modeId)?.layer !== 'net') return
    const info = deckOf(k, state, actor)
    if (!info.has) return { weapons: [], quick: [] }
    const rules = deckRules(k)
    const weapons: BattleWeapon[] = []
    for (const p of info.equipped) {
      if (p.kind !== 'construct' || p.class !== 'weapon') continue
      const w = constructWeapon(k, state, actor, modeId, p, rules)
      if (w) weapons.push(w)
    }
    return { weapons, quick: scriptsOf(info) }
  })

  // 單位上的甲板資料（兩個戰場）；沒有甲板的人沒有 RAM（排在後面：技能給的 RAM 也算在內）
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (!unit.actor || !run.state.actors[unit.actor] || unit.ext.deck !== undefined) return
    const info = deckOf(k, run.state, unit.actor)
    if (!info.has) return
    unit.ext.deck = {
      grade: info.grade, firewall: info.firewall,
      slots: info.equipped.filter((p) => p.kind === 'quickhack').map((p) => p.id),
      constructs: info.equipped.filter((p) => p.kind === 'construct').map((p) => ({ id: p.id, class: p.class, grade: p.runsAt })),
    }
  }, -10)
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (unit.actor && run.state.actors[unit.actor] && !isRecord(unit.ext.deck)) delete unit.pools.ram
  }, 100)

  // 被動的工具構裝（裝上就有效）：mods 只在內海算
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.view.mode.layer !== 'net') return []
    const d = q.unit.ext.deck
    if (!isRecord(d) || !Array.isArray(d.constructs)) return []
    const out: RollPart[] = []
    for (const c of d.constructs) {
      const e = isRecord(c) && typeof c.id === 'string' ? q.view.k.content.get<ConstructEntry>(CONSTRUCT_KIND, c.id) : undefined
      const v = e?.class === 'tool' && e.passive === true ? e.mods?.[q.kind] : undefined
      if (e && typeof v === 'number' && v !== 0) out.push({ label: e.name, value: v, source: 'construct' })
    }
    return out
  })

  // 戰後：內海裡用掉的腳本從背包與 ext.deck.scripts 扣掉
  k.battle.onEnd(OWNER, ({ state, battle }) => {
    if (modesOf(k, battle.mode)?.layer !== 'net') return
    const changes: Change[] = []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const u of Object.values(battle.units) as BattleUnit[]) {
      if (u.side !== 'ally' || !u.actor || seen.has(u.actor) || !state.actors[u.actor]) continue
      seen.add(u.actor)
      const start = new Map<string, number>()
      for (const s of deckOf(k, state, u.actor).scripts) start.set(s.item, (start.get(s.item) ?? 0) + s.qty)
      if (!start.size) continue
      const now = new Map<string, number>()
      for (const q of u.quick) now.set(q.item, (now.get(q.item) ?? 0) + q.qty)
      const used = new Map<string, number>()
      for (const [item, qty] of start) if ((now.get(item) ?? 0) < qty) used.set(item, qty - (now.get(item) ?? 0))
      if (!used.size) continue
      const info = deckOf(k, state, u.actor)
      const gone = new Map<string, number>()
      for (const [item, qty] of used) {
        const take = Math.min(qty, countItem(state.inventory, item))
        if (take > 0) changes.push({ op: 'item', id: item, qty: -take })
        gone.set(item, take)
        lines.push(`用掉：${k.content.get<ItemEntry>('item', item)?.name ?? item} ×${qty}`)
      }
      // 帶著的腳本改成剩下的（也要扣掉背包裡已經沒有的）
      const left = new Map(used)
      const rest: ScriptEntry[] = []
      for (const s of extOf(state, u.actor).scripts) {
        const cut = Math.min(left.get(s.item) ?? 0, s.qty)
        left.set(s.item, (left.get(s.item) ?? 0) - cut)
        if (s.qty - cut > 0) rest.push({ item: s.item, qty: s.qty - cut })
      }
      const have = (item: string): number => countItem(state.inventory, item) - (gone.get(item) ?? 0)
      const kept = fitCount(rest, info.scriptLimit, have)
      changes.push({ op: 'actor.ext', id: u.actor, key: 'deck', value: extValue(state, u.actor, { scripts: kept }) })
    }
    return changes.length ? { changes, lines } : undefined
  })
}

/** 腳本照順序留下：放不下上限的、背包裡不夠的去掉（腳本的標籤在存進去時已經查過）。 */
function fitCount(list: readonly ScriptEntry[], limit: number, have: (item: string) => number): ScriptEntry[] {
  const out: ScriptEntry[] = []
  const used = new Map<string, number>()
  let room = limit
  for (const s of list) {
    const q = Math.min(s.qty, room, have(s.item) - (used.get(s.item) ?? 0))
    if (q <= 0) continue
    out.push({ item: s.item, qty: q })
    used.set(s.item, (used.get(s.item) ?? 0) + q)
    room -= q
  }
  return out
}
