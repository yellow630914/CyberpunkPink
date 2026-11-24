// L6 功能 netcombat：同步檔位在戰鬥裡的效果（CYBERSPACE 6.4 節；CORE_RULES 第 5 節；dev/adr/0018 第二節、N4、N25）。
// 四檔的表、「這個人開得到哪一檔」都在核心（rules/sync.ts：syncRuleOf、syncCapOf、syncBlocks）；這裡只管它們在內海戰鬥裡落成什麼：
//   unit.ready  設 unit.ext.net（{ sync, sync_max, broken }，已經有的欄位不蓋）與 sync:<檔> 標籤；
//   修正        命中與自己擲的檢定照那一檔的 check（迴避不算）、受到的感載照 load_pct、全檔每回合多回行動點、管理行動次數 +1；
//   overload    全檔過載時沉溺 +2；
//   換檔        行動 net_shift（每回合一次，修正 sync_shifts；上限是 sync_max 加修正 sync_cap，最高全檔）；
//   turn.start  會換檔的敵人（ext.net.shift）自己的回合開始時換（N25：感載到上限的六成以上退淺檔，否則開深檔）。

import type { BattleActionDef, BattlePick, BattleRun, BattleUnit, BattleView, Kernel, RollPart, SyncGear } from '../../core'
import { BattleBlocked, SYNC_GEARS, clamp, isRecord, isSyncGear, syncBlocks, syncCapOf, syncRuleOf, unitTag } from '../../core'
import { MODES, OWNER, gearAt, gearIdx, gearOf, netOf, netcombatRules, setGearTag, sum } from './model'

const SHIFTED = 'turn:shift'

/** 這個檔位的名字（「深」→「深檔」）。 */
export const gearName = (view: Pick<BattleView, 'k'>, gear: SyncGear): string => `${syncRuleOf(view.k.content).gears[gear].name}檔`

/** 這個人現在換得到的最高一檔的順位：sync_max 加修正 sync_cap，夾在淺～全。 */
export function capIndex(view: BattleView, u: BattleUnit): number {
  const n = netOf(u)
  const max: SyncGear = n && isSyncGear(n.sync_max) ? n.sync_max : 'standard'
  return clamp(gearIdx(max) + sum(view.mods('sync_cap', u)), 0, SYNC_GEARS.length - 1)
}

/** 每回合可以換幾次檔：規則表的基本次數加修正 sync_shifts。 */
export const shiftLimit = (view: BattleView, u: BattleUnit): number => Math.max(0, netcombatRules(view.k).sync_shifts + sum(view.mods('sync_shifts', u)))

/** 這一回合用掉幾次換檔（記在 uses['turn:shift']，自己的回合開始時核心清掉）。 */
export const shiftsUsed = (u: BattleUnit): number => u.uses[SHIFTED] ?? 0

/** 這一回合還能換幾次檔。 */
export const shiftsLeft = (view: BattleView, u: BattleUnit): number => Math.max(0, shiftLimit(view, u) - shiftsUsed(u))

/** 換到這一檔不行的原因，一條一個條件（缺的是同步幾級、敏感度多少，現在是多少）；空的就是換得到。 */
export function gearBlocks(view: BattleView, u: BattleUnit, gear: SyncGear): string[] {
  const n = netOf(u)
  if (!n) return ['沒有同步檔位可以換。']
  const rule = syncRuleOf(view.k.content)
  const name = `${rule.gears[gear].name}檔`
  if (gear === n.sync) return [`已經是${name}了。`]
  const cap = capIndex(view, u)
  if (gearIdx(gear) <= cap) return []
  if (u.actor && view.state.actors[u.actor]) {
    const why = syncBlocks(view.k, view.state, u.actor, gear)
    if (why.length) return why
  }
  return [`${name}現在開不了（目前最高到${rule.gears[gearAt(cap)].name}檔）。`]
}

/** 把單位的檔位改成這一檔（換檔、勸降共用；不檢查上限與次數）。沒有 ext.net 或本來就是這一檔回傳 false。 */
export function setGear(run: BattleRun, u: BattleUnit, gear: SyncGear, o: { by?: BattleUnit; text?: string } = {}): boolean {
  const n = netOf(u)
  if (!n || n.sync === gear) return false
  const from = n.sync
  n.sync = gear
  setGearTag(u, gear)
  run.say(o.text ?? `${unitTag(u)} 換到${gearName(run, gear)}。`, 'shift', { unit: u.id, from, to: gear, ...(o.by ? { by: o.by.id } : {}) }, u)
  return true
}

const shift: BattleActionDef = {
  id: 'net_shift', owner: OWNER, name: '換檔', desc: '換同步檔位：淺、標準、深、全。不花行動點，每回合一次，只能在自己的回合換；換了之後維持到下次換。',
  group: 'system', icon: 'shift', order: 5, target: 'none', modes: MODES,
  cost: () => ({ ap: 0 }),
  blocks: (view, u) => {
    if (!netOf(u)) return ['沒有同步檔位可以換。']
    return shiftsLeft(view, u) <= 0 ? ['這個回合已經換過檔了。'] : []
  },
  picks: (view, u): BattlePick[] => {
    const rule = syncRuleOf(view.k.content)
    return [{
      key: 'gear', label: '換到哪一檔', kind: 'choice', required: true,
      options: SYNC_GEARS.map((g) => ({ value: g, label: `${rule.gears[g].name}檔`, blocks: gearBlocks(view, u, g), hint: { check: rule.gears[g].check, load_pct: rule.gears[g].loadPct } })),
    }]
  },
  run: (run, u, _t, input) => {
    const want = input.pick?.gear
    if (!isSyncGear(want)) throw new BattleBlocked(['要選換到哪一檔。'])
    const why = gearBlocks(run, u, want)
    if (why.length) throw new BattleBlocked(why)
    if (shiftsLeft(run, u) <= 0) throw new BattleBlocked(['這個回合已經換過檔了。'])
    u.uses[SHIFTED] = (u.uses[SHIFTED] ?? 0) + 1
    setGear(run, u, want)
  },
}

export const SYNC_ACTIONS: BattleActionDef[] = [shift]

export function installSync(k: Kernel): void {
  // 單位組好：ext.net 與標籤。已經有的欄位不蓋（敵人的資料帶著；技能的功能可能先寫了 admin）
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (run.mode.layer !== 'net') return
    const cur: Record<string, unknown> = isRecord(unit.ext.net) ? { ...unit.ext.net } : {}
    // 上限：已經寫了的不蓋；角色看同步等級與敏感度（核心的 syncCapOf）；沒有角色的單位最高就是它現在的檔位（沒寫是標準）
    let max: SyncGear
    if (isSyncGear(cur.sync_max)) max = cur.sync_max
    else if (unit.actor && run.state.actors[unit.actor]) max = syncCapOf(run.k, run.state, unit.actor)
    else max = isSyncGear(cur.sync) ? cur.sync : 'standard'
    // 會換檔的敵人（資料寫 shift）：記成旗標，先開深檔
    const shifts = cur.shift === true || cur.sync === 'shift'
    // 起始是標準，上限不到標準就是淺（會換檔的：深檔，上限不到就是上限）
    let sync: SyncGear
    if (isSyncGear(cur.sync)) sync = cur.sync
    else sync = gearAt(Math.min(gearIdx(shifts ? 'deep' : 'standard'), gearIdx(max)))
    const broken = Array.isArray(cur.broken) ? cur.broken.filter((x): x is string => typeof x === 'string') : []
    unit.ext.net = { ...cur, sync, sync_max: max, broken, ...(shifts ? { shift: true } : {}) }
    setGearTag(unit, sync)
  })

  // 修正：命中與自己擲的檢定（N4：迴避不算）、受到的感載、每回合的行動點、管理行動的次數
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.view.mode.layer !== 'net') return []
    const gear = gearOf(q.unit)
    if (!gear) return []
    const rule = syncRuleOf(q.view.k.content).gears[gear]
    const label = `${rule.name}檔`
    switch (q.kind) {
      case 'hit':
      case 'save': return rule.check ? [{ label, value: rule.check, source: 'sync' }] : []
      case 'load_taken_pct': return rule.loadPct !== 100 ? [{ label, value: rule.loadPct - 100, source: 'sync' }] : []
      case 'ap_regen': return rule.apRegen ? [{ label, value: rule.apRegen, source: 'sync' }] : []
      case 'admin_uses': return gear === 'full' ? [{ label, value: netcombatRules(q.view.k).admin_full, source: 'sync' }] : []
      default: return []
    }
  })

  // 全檔過載時沉溺 +2（資料的 sink_on_overload）
  k.battle.on('overload', OWNER, ({ run, unit, by }) => {
    if (run.mode.layer !== 'net') return
    const gear = gearOf(unit)
    const n = gear ? syncRuleOf(run.k.content).gears[gear].sinkOnOverload : undefined
    if (n) run.gainSink(unit, n, by ? { by } : {})
  })

  // 會換檔的敵人（N25）：自己的回合開始時，感載到上限的六成以上退淺檔，否則開深檔（不超過它的上限）
  k.battle.on('turn.start', OWNER, ({ run, unit, lost }) => {
    if (lost || run.mode.layer !== 'net') return
    const n = netOf(unit)
    if (!n?.shift || !unit.load) return
    const hot = unit.load.now >= unit.load.max * netcombatRules(run.k).shift_split
    const cap = isSyncGear(n.sync_max) ? gearIdx(n.sync_max) : gearIdx('standard')
    setGear(run, unit, gearAt(Math.min(gearIdx(hot ? 'shallow' : 'deep'), cap)))
  })
}
