// L6 功能 netcombat：管理行動（CYBERSPACE 6.6 節；NETRUNNING 第 3 節；ITEMS 11.4 節的「後門鑰匙」、11.5 節的駭入程式；dev/adr/0018 第一節、N10、N31；工單 M3-netadmin）。
//
//   行動   adm_wall 造牆、adm_breach 拆牆、adm_cut 斷路、adm_seize 接管、adm_crack 破解、adm_wipe 擦痕跡、adm_mark 標記
//          都是 modes: ['net']、技能那一圈、標籤 admin 與 admin:<名字>；有 admin 標籤的人才有（has）；行動點 0，只花 RAM。
//   次數   每回合 = unit.ext.net.admin（基數）加修正 admin_uses（全檔另外 +1，sync.ts 給）；用掉的記在 unit.uses['turn:admin']（回合開始核心清）。
//          匯出 adminLeft、spendAdmin；spendAdmin 也登記成效果 net.admin_spend（技能「1 次管理行動」的消耗，不能 import 的功能用）。
//   檢定   智識加介面，標籤 admin、admin:<名字>。造牆、拆牆、斷路、破解、擦痕跡對地圖的 DC（origin.ext.net.dc；沒有就照場景等級 10、13、16、19、22）；
//          標記與接管對目標的防火牆（核心 check 效果的 vs: { firewall: true, elite, boss }）。失敗：RAM 照花、沒有效果。
//   追蹤度 我方每做一次 +1（修正 trace_admin，最少 0），檢定失敗再 +5（規則表 admin.trace、admin.fail_trace；駭入程式的 fail_trace 可以加重）；
//          敵方做的、沒有追蹤度的場地都不加。
//   破解   成功就全隊脫身：結果 fled，那一拍（tag admin）的 data.cracked 是 true（N31）。「成功」另外做成效果 net.crack：
//          工具構裝「後門鑰匙」這一類（資料的 do 寫 { op: 'net.crack' }）沒有主控也做得到，用完那一件從這一場消失。
//   標記   unit.ext.net.marked = { by, side, bonus }：標記的那一方打他，命中加 bonus；他過載就拿掉。
//   駭入程式 裝著的構裝的 admin 欄位（{ <名字>: { ram?, bonus?, levels?, slots?, turns?, amount?, targets?, fail_trace? } }）改對應行動的數字；
//          數字也可以寫成陣列，照構裝的等級挑（第 1 級用第 1 個）；ram 取最低、bonus 加總、其他取最大；淺檔與破損的構裝不算（ITEMS 11.7）。
//   敵方潛網者 aiScore：自己那一格沒有遮蔽時造牆、目標站在遮蔽後面時拆牆、其餘標記一個敵人；次數照 admin 基數。
// 不 import 別的功能；接管用快駭功能註冊的 hack.takeover（k.battle.getEffect 查不到就灰掉）。

import type { BattleActionDef, BattleInput, BattlePick, BattleRun, BattleSide, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Kernel, RollPart } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, coverHpFor, isRecord, otherSide, unitTag, unitsOf } from '../../core'
import type { AdminName, AdminNumbers, ConstructInfo } from './model'
import { MODES, OWNER, brokenOf, constructEntry, constructsOf, ensureNet, gearOf, netcombatRules } from './model'
import { addTrace, traceOf } from './out'

/** 用掉幾次管理行動記在這裡（turn: 開頭的，每個自己的回合開始時核心清掉）。 */
export const ADMIN_USED = 'turn:admin'
/** 沒有 origin.ext.net.dc 時照場景的等級（N10）。 */
export const DEFAULT_ADMIN_DC = [10, 13, 16, 19, 22]

const NAME: Record<AdminName, string> = { wall: '造牆', breach: '拆牆', cut: '斷路', seize: '接管', crack: '破解', wipe: '擦痕跡', mark: '標記' }
const TAKEOVER = 'hack.takeover'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const sumOf = (parts: readonly RollPart[]): number => parts.reduce((s, p) => s + p.value, 0)

// ---- 次數 ----

/** 這個人做管理行動的資格：標籤 admin（技能或敵人的資料給）。 */
export const isAdmin = (u: BattleUnit): boolean => u.tags.includes('admin')

/** 每回合的次數：unit.ext.net.admin（基數）加修正 admin_uses（全檔另外 +1），最少 0。 */
export function adminLimit(view: BattleView, u: BattleUnit): number {
  const base = isRecord(u.ext.net) && typeof u.ext.net.admin === 'number' && Number.isFinite(u.ext.net.admin) ? Math.floor(u.ext.net.admin) : 0
  return Math.max(0, base + sumOf(view.mods('admin_uses', u)))
}

/** 這一回合用掉幾次。 */
export const adminUsed = (u: BattleUnit): number => u.uses[ADMIN_USED] ?? 0

/** 這一回合還剩幾次。 */
export const adminLeft = (view: BattleView, u: BattleUnit): number => Math.max(0, adminLimit(view, u) - adminUsed(u))

const noLeft = (view: BattleView, u: BattleUnit): string => `這一回合只能做 ${adminLimit(view, u)} 次管理行動，已經做了 ${adminUsed(u)} 次。`

/**
 * 花掉 n 次管理行動（七個行動與技能「1 次管理行動」共用）。不夠就丟 BattleBlocked（原因寫幾次、用了幾次）。回傳還剩幾次。
 * 只動計數，不動 RAM（RAM 由行動的花費付）。
 */
export function spendAdmin(run: BattleRun, u: BattleUnit, n = 1): number {
  const want = Math.max(0, Math.floor(n))
  if (want > adminLeft(run, u)) throw new BattleBlocked([noLeft(run, u)])
  u.uses[ADMIN_USED] = adminUsed(u) + want
  return adminLeft(run, u)
}

// ---- 數字：規則表加駭入程式 ----

interface HackProgram {
  name: string
  grade: number
  admin: Record<string, unknown>
}

/** 裝著而且算數的駭入程式：淺檔不算（駭入程式跟著主控走，ITEMS 11.7）、破損的不算。 */
function programsOf(view: BattleView, u: BattleUnit): HackProgram[] {
  if (gearOf(u) === 'shallow') return []
  const broken = brokenOf(u)
  const out: HackProgram[] = []
  for (const c of constructsOf(view.k, u)) {
    if (broken.includes(c.id)) continue
    const e: ConstructInfo | undefined = constructEntry(view.k, c.id)
    if (e && isRecord(e.admin)) out.push({ name: e.name, grade: c.grade, admin: e.admin })
  }
  return out
}

/** 駭入程式裡的一個數字：數字照原樣，陣列照構裝的等級挑（第 1 級用第 1 個，超過就用最後一個）。 */
function pickNum(v: unknown, grade: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (Array.isArray(v) && v.length) {
    const x = v[Math.max(0, Math.min(v.length - 1, Math.floor(grade) - 1))]
    return typeof x === 'number' && Number.isFinite(x) ? x : undefined
  }
  return undefined
}

/** 一個管理行動現在的數字（規則表的預設、裝著的駭入程式改過之後）。 */
export interface AdminCalc extends Required<AdminNumbers> {
  /** 駭入程式給的檢定加值，一件一項（檢定的明細看得到是誰給的） */
  bonus: RollPart[]
  /** 檢定失敗時追蹤度加幾點 */
  failTrace: number
}

export function adminCalc(view: BattleView, u: BattleUnit, name: AdminName): AdminCalc {
  const rules = netcombatRules(view.k).admin
  const base = rules[name]
  const out: AdminCalc = { ram: base.ram, levels: base.levels ?? 1, slots: base.slots ?? 1, turns: base.turns ?? 1, amount: base.amount ?? 0, targets: base.targets ?? 1, bonus: [], failTrace: rules.fail_trace }
  for (const p of programsOf(view, u)) {
    const d = p.admin[name]
    if (!isRecord(d)) continue
    const ram = pickNum(d.ram, p.grade)
    if (ram !== undefined) out.ram = Math.min(out.ram, Math.max(0, Math.round(ram)))
    const bonus = pickNum(d.bonus, p.grade)
    if (bonus) out.bonus.push({ label: p.name, value: Math.round(bonus), source: 'construct' })
    for (const key of ['levels', 'slots', 'turns', 'targets'] as const) {
      const v = pickNum(d[key], p.grade)
      if (v !== undefined) out[key] = Math.max(out[key], Math.max(1, Math.round(v)))
    }
    const amount = pickNum(d.amount, p.grade)
    if (amount !== undefined) out.amount = Math.max(out.amount, Math.abs(Math.round(amount)))
    const fail = pickNum(d.fail_trace, p.grade)
    if (fail !== undefined) out.failTrace = Math.max(out.failTrace, Math.max(0, Math.round(fail)))
  }
  out.levels = Math.min(2, out.levels)
  out.slots = Math.min(BATTLE_SLOTS, out.slots)
  return out
}

/** 對地圖的 DC（N10）：開戰的人給的 origin.ext.net.dc；沒有照場景的等級 10、13、16、19、22。 */
export function adminDc(view: Pick<BattleView, 'battle'>): number {
  const net = view.battle.origin.ext?.net
  const v = isRecord(net) ? net.dc : undefined
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  return DEFAULT_ADMIN_DC[Math.max(1, Math.min(DEFAULT_ADMIN_DC.length, view.battle.grade)) - 1]!
}

// ---- 共用的小東西 ----

const SOURCE = (name: AdminName) => ({ kind: 'ability' as const, id: `adm_${name}`, name: NAME[name] })
const tagsOf = (name: AdminName): string[] => ['admin', `admin:${name}`]

const cell = (side: BattleSide, slot: number): BattleTarget => ({ side, slot })
const slotsOf = (): number[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1)

/** 這個行動現在的共同條件（次數、這個行動自己的前提），一條一個條件。 */
function adminBlocks(view: BattleView, u: BattleUnit, name: AdminName): string[] {
  const out: string[] = []
  if (adminLeft(view, u) <= 0) out.push(noLeft(view, u))
  if (name === 'seize') {
    if (!view.k.battle.getEffect(TAKEOVER)) out.push('沒有裝快駭的功能，接管不了敵方掛著的東西。')
    else if (!view.battle.overlays.some((o) => !o.down && o.side !== u.side)) out.push('敵方沒有掛著的守衛程式可以接管。')
  }
  if (name === 'wipe' && traceOf(view.battle) === undefined) out.push('這個地方沒有追蹤度，沒有痕跡可以擦。')
  return out
}

/** 開始做：再檢查一次條件、花掉一次、算出這一次的數字。 */
function start(run: BattleRun, u: BattleUnit, name: AdminName): AdminCalc {
  const why = adminBlocks(run, u, name)
  if (why.length) throw new BattleBlocked(why)
  spendAdmin(run, u, 1)
  return adminCalc(run, u, name)
}

/** 擲對地圖 DC 的檢定（智識加介面）。 */
function rollDc(run: BattleRun, u: BattleUnit, name: AdminName, n: AdminCalc): boolean {
  return run.save(u, 'intellect', 'interface', adminDc(run), NAME[name], n.bonus, tagsOf(name)).ok
}

/** 擲對目標防火牆的檢定（走核心 check 效果：有甲板用甲板的、沒有的用迴避；精英再 +2、首領再 +4）。落在掛著的東西上它的防火牆是它的迴避。 */
function rollFirewall(run: BattleRun, u: BattleUnit, name: AdminName, n: AdminCalc, target: BattleTarget): boolean {
  const last = run.effects(
    [{ op: 'check', attr: 'intellect', skill: 'interface', vs: { firewall: true, elite: 2, boss: 4 }, tags: tagsOf(name), label: NAME[name], bonus: n.bonus.map((p) => ({ label: p.label, value: p.value })) }],
    { user: u, target, source: SOURCE(name) },
  )
  return last.ok === true
}

/** 追蹤度：我方每做一次 +1（加修正 trace_admin，最少 0），失敗再 +failTrace；敵方做的不加。沒有追蹤度的場地 addTrace 自己不做。 */
function charge(run: BattleRun, u: BattleUnit, n: AdminCalc, ok: boolean): void {
  if (u.side !== 'ally' || traceOf(run.battle) === undefined) return
  const base = Math.max(0, netcombatRules(run.k).admin.trace + sumOf(run.mods('trace_admin', u)))
  if (base) addTrace(run, base, { by: u, text: `追蹤度 +${base}（管理行動）。` })
  if (!ok && n.failTrace) addTrace(run, n.failTrace, { by: u, text: `追蹤度 +${n.failTrace}（檢定失敗）。` })
}

/** 結果的一拍（tag admin）：成功寫 text，失敗統一一句。 */
function report(run: BattleRun, u: BattleUnit, name: AdminName, ok: boolean, text: string, data: Record<string, unknown> = {}): void {
  run.say(ok ? text : `${unitTag(u)} 的${NAME[name]}失敗了：沒有效果（RAM 已經花掉了）。`, 'admin', { unit: u.id, admin: name, ok, ...data }, u)
}

/** 另外要動的格子：玩家選的（pick 的值是格子），不夠的補離主要那一格最近的（同樣近先小號）；prefer 是比較值得動的格子（拆牆：有遮蔽的）。 */
function extraSlots(main: number, count: number, chosen: readonly unknown[], prefer: (slot: number) => boolean = () => true): number[] {
  const out: number[] = []
  for (const c of chosen) if (out.length < count - 1 && isInt(c) && c >= 1 && c <= BATTLE_SLOTS && c !== main && !out.includes(c)) out.push(c)
  const rest = slotsOf().filter((s) => s !== main && !out.includes(s)).sort((a, b) => Math.abs(a - main) - Math.abs(b - main) || a - b)
  for (const s of [...rest.filter(prefer), ...rest.filter((x) => !prefer(x))]) if (out.length < count - 1) out.push(s)
  return out
}

/** 一格的遮蔽（暴露 0、半掩體 1、掩體 2）；打不破的（煙霧、人群）另外標。 */
const coverCell = (view: Pick<BattleView, 'battle'>, side: BattleSide, slot: number) => view.battle.cover[side][slot - 1]

function slotPick(label: string, side: BattleSide): BattlePick {
  return { key: 'also', label, kind: 'foe_slot', required: false, options: slotsOf().map((s) => ({ value: s, label: `第 ${s} 格`, blocks: [] as string[], at: cell(side, s) })) }
}

const targetSlot = (target: BattleTarget | null, side: BattleSide): number | undefined => (target && 'slot' in target && target.side === side ? target.slot : undefined)

// ---- 破解與標記的效果 ----

/**
 * 破解成功（行動 adm_crack 與工具構裝「後門鑰匙」的 net.crack 共用）：全隊立刻脫身，結果 fled。
 * 那一拍（tag admin）的 data 帶 cracked: true，在地圖上的那一趟靠它知道這一場算過了（N31）。
 */
function crackNow(run: BattleRun, u: BattleUnit, from: string): void {
  if (run.over) return
  run.say(`${unitTag(u)} 開出一條離開的路：全隊從這場戰鬥脫身。`, 'admin', { unit: u.id, admin: 'crack', ok: true, cracked: true, outcome: 'fled', ...(from ? { from } : {}) }, u)
  run.finish('fled', '破解成功：全隊從這場戰鬥脫身，敵人還在原地。')
}

/** 標記的資料：標記的那一方（side）打他命中加 bonus；他過載就拿掉。 */
export interface Mark {
  by: string
  side: BattleSide
  bonus: number
}

export function markOf(u: BattleUnit): Mark | undefined {
  const m = isRecord(u.ext.net) ? u.ext.net.marked : undefined
  return isRecord(m) && typeof m.by === 'string' && typeof m.bonus === 'number' && (m.side === 'ally' || m.side === 'foe') ? (m as unknown as Mark) : undefined
}

function mark(run: BattleRun, by: BattleUnit, t: BattleUnit, bonus: number): void {
  ensureNet(t).marked = { by: by.id, side: by.side, bonus } satisfies Mark
  run.say(`${unitTag(t)} 被標記了：${by.side === 'ally' ? '我方' : '敵方'}全隊打他命中 +${bonus}，直到他過載。`, 'admin', { unit: by.id, admin: 'mark', ok: true, target: t.id, bonus }, by)
}

// ---- 七個行動 ----

interface AdminDef {
  name: AdminName
  desc: string
  order: number
  target: BattleActionDef['target']
  targets?: BattleActionDef['targets']
  picks?: BattleActionDef['picks']
  run: (run: BattleRun, u: BattleUnit, target: BattleTarget | null, input: BattleInput, n: AdminCalc) => void
  aiScore?: BattleActionDef['aiScore']
  aiTarget?: BattleActionDef['aiTarget']
}

function adminAction(d: AdminDef): BattleActionDef {
  const { name } = d
  return {
    id: `adm_${name}`, owner: OWNER, name: NAME[name], desc: d.desc, group: 'skill', icon: 'admin', tags: tagsOf(name), modes: MODES,
    target: d.target, order: 20 + d.order,
    has: (_v, u) => isAdmin(u),
    cost: (view, u) => {
      const ram = adminCalc(view, u, name).ram
      return { ap: 0, ...(ram > 0 ? { ram } : {}) }
    },
    blocks: (view, u) => adminBlocks(view, u, name),
    ...(d.targets ? { targets: d.targets } : {}),
    ...(d.picks ? { picks: d.picks } : {}),
    run: (run, u, target, input) => d.run(run, u, target, input, start(run, u, name)),
    ...(d.aiScore ? { aiScore: d.aiScore } : {}),
    ...(d.aiTarget ? { aiTarget: d.aiTarget } : {}),
  }
}

/** 造牆：我方一格的遮蔽升 levels 級、耐久補滿（amount 是耐久多幾 %：泥瓦匠 IV 級）。 */
const wall = adminAction({
  name: 'wall', order: 0, target: 'ally_slot',
  desc: '在我方一格造牆：那一格的遮蔽升一級（暴露→半掩體→掩體），耐久補滿。要過一次檢定（智識加介面，對這張地圖的 DC）；花 2 RAM，不花行動點；追蹤度 +1。',
  targets: (view, u) => slotsOf().map((slot) => {
    const c = coverCell(view, u.side, slot)
    const full = !!c && c.level === 2 && c.hp >= (c.max?.[1] ?? coverHpFor(view.n, 2, view.battle.grade))
    return { target: cell(u.side, slot), blocks: full ? ['這一格已經是掩體，耐久也是滿的。'] : [], hint: { dc: adminDc(view), level: c?.level ?? 0 } }
  }),
  run: (run, u, target, _input, n) => {
    const slot = targetSlot(target, u.side)
    if (slot === undefined) throw new BattleBlocked(['造牆要選我方的一格。'])
    const ok = rollDc(run, u, 'wall', n)
    charge(run, u, n, ok)
    if (ok) {
      const g = run.battle.grade
      const max: [number, number] | undefined = n.amount > 0 ? [Math.round(coverHpFor(run.n, 1, g) * (1 + n.amount / 100)), Math.round(coverHpFor(run.n, 2, g) * (1 + n.amount / 100))] : undefined
      run.raiseCover(u.side, slot, n.levels, max)
    }
    report(run, u, 'wall', ok, `${unitTag(u)} 在我方第 ${slot} 格造了牆。`, { side: u.side, slot })
  },
  // 自己那一格沒有遮蔽時造牆
  aiTarget: (_v, u) => cell(u.side, u.slot),
  aiScore: (view, u) => (view.coverOf(u) === 0 ? 3 : null),
})

/** 拆牆：敵方一格（slots 格）的遮蔽降 levels 級，不必過耐久。 */
const breach = adminAction({
  name: 'breach', order: 1, target: 'foe_slot',
  desc: '把敵方一格的遮蔽降一級（掩體→半掩體→暴露），不必打穿耐久。要過一次檢定（智識加介面，對這張地圖的 DC）；花 2 RAM，不花行動點；追蹤度 +1。',
  targets: (view, u) => {
    const foe = otherSide(u.side)
    return slotsOf().map((slot) => {
      const c = coverCell(view, foe, slot)
      const blocks = !c || c.level === 0 ? ['那一格已經是暴露的，沒有牆可以拆。'] : c.soft ? ['那一格的遮蔽是打不破的（煙霧、人群），拆不了。'] : []
      return { target: cell(foe, slot), blocks, hint: { dc: adminDc(view), level: c?.level ?? 0 } }
    })
  },
  picks: (view, u): BattlePick[] => (adminCalc(view, u, 'breach').slots > 1 ? [slotPick('另一格（同時拆）', otherSide(u.side))] : []),
  run: (run, u, target, input, n) => {
    const foe = otherSide(u.side)
    const slot = targetSlot(target, foe)
    if (slot === undefined) throw new BattleBlocked(['拆牆要選敵方的一格。'])
    const ok = rollDc(run, u, 'breach', n)
    charge(run, u, n, ok)
    if (ok) {
      const has = (s: number): boolean => {
        const c = coverCell(run, foe, s)
        return !!c && c.level > 0 && !c.soft
      }
      const hit = [slot, ...extraSlots(slot, n.slots, [input.pick?.also], has)].filter(has)
      for (const s of hit) run.lowerCover(foe, s, n.levels, u)
    }
    report(run, u, 'breach', ok, `${unitTag(u)} 拆了敵方第 ${slot} 格的牆。`, { side: foe, slot })
  },
  // 目標站在遮蔽後面時拆牆
  aiTarget: (_v, _u, t) => (t ? cell(t.side, t.slot) : null),
  aiScore: (view, _u, t) => (t && view.coverOf(t) > 0 ? 2.5 : null),
})

/** 斷路：敵方一格（slots 格）這一輪結束前（turns 輪）不能換位進出、補位跳過。 */
const cut = adminAction({
  name: 'cut', order: 2, target: 'foe_slot',
  desc: '把敵方一格斷路：這一輪結束前，站在那一格的人換不了位，後面的人也補不進來。要過一次檢定（智識加介面，對這張地圖的 DC）；花 2 RAM，不花行動點；追蹤度 +1。',
  targets: (view, u) => slotsOf().map((slot) => ({ target: cell(otherSide(u.side), slot), blocks: [], hint: { dc: adminDc(view) } })),
  picks: (view, u): BattlePick[] => (adminCalc(view, u, 'cut').slots > 1 ? [slotPick('另一格（同時斷）', otherSide(u.side))] : []),
  run: (run, u, target, input, n) => {
    const foe = otherSide(u.side)
    const slot = targetSlot(target, foe)
    if (slot === undefined) throw new BattleBlocked(['斷路要選敵方的一格。'])
    const ok = rollDc(run, u, 'cut', n)
    charge(run, u, n, ok)
    if (ok) for (const s of [slot, ...extraSlots(slot, n.slots, [input.pick?.also])]) run.cutSlot(foe, s, run.battle.round + n.turns - 1, u)
    report(run, u, 'cut', ok, `${unitTag(u)} 把敵方第 ${slot} 格斷了路。`, { side: foe, slot })
  },
})

/** 接管：敵方掛著的一台 turns 回合聽我方的（hack.takeover，快駭功能註冊的）。對它的防火牆（它的迴避）。 */
const seize = adminAction({
  name: 'seize', order: 3, target: 'overlay',
  desc: '接管敵方掛著的一台（守衛程式、無人機、砲塔）：要過一次檢定（智識加介面，對它的防火牆）；成功的話它一回合是我方的，掛在我方同一格（那一格要是空的）。花 3 RAM，不花行動點；追蹤度 +1。',
  targets: (view, u) => view.battle.overlays.filter((o) => !o.down && o.side !== u.side).map((o): BattleTargetOption => ({
    target: { overlay: o.id },
    blocks: view.battle.overlays.some((x) => !x.down && x.side === u.side && x.slot === o.slot) ? [`我方第 ${o.slot} 格已經掛著一台了，接管來的${o.name}沒有地方放。`] : [],
    hint: { kind: o.kind, slot: o.slot },
  })),
  run: (run, u, target, _input, n) => {
    if (!target || !('overlay' in target)) throw new BattleBlocked(['接管要選敵方掛著的一台。'])
    const o = run.battle.overlays.find((x) => x.id === target.overlay && !x.down && x.side !== u.side)
    if (!o) throw new BattleBlocked(['那一台已經不在了，或者是我方的。'])
    const ok = rollFirewall(run, u, 'seize', n, target)
    charge(run, u, n, ok)
    let done = false
    if (ok) done = run.effects([{ op: TAKEOVER, turns: n.turns }], { user: u, target, source: SOURCE('seize') }).ok === true
    if (!ok) report(run, u, 'seize', false, '')
    else if (!done) run.say(`${unitTag(u)} 接管不了${o.name}。`, 'admin', { unit: u.id, admin: 'seize', ok: false, overlay: o.id }, u)
  },
})

/** 破解：成功就全隊脫身（N31）。 */
const crack = adminAction({
  name: 'crack', order: 4, target: 'none',
  desc: '在戰鬥中開出一條離開的路：要過一次檢定（智識加介面，對這張地圖的 DC）；成功的話全隊立刻脫身，結果是脫離（不必再檢定）。花 2 RAM，不花行動點；追蹤度 +1。',
  run: (run, u, _t, _i, n) => {
    const ok = rollDc(run, u, 'crack', n)
    charge(run, u, n, ok)
    if (ok) crackNow(run, u, 'admin')
    else report(run, u, 'crack', false, '')
  },
})

/** 擦痕跡：追蹤度減 amount 點。 */
const wipe = adminAction({
  name: 'wipe', order: 5, target: 'none',
  desc: '把追蹤度壓下去 5 點。要過一次檢定（智識加介面，對這張地圖的 DC）；花 1 RAM，不花行動點；自己也要追蹤度 +1。',
  run: (run, u, _t, _i, n) => {
    const ok = rollDc(run, u, 'wipe', n)
    charge(run, u, n, ok)
    if (ok) addTrace(run, -n.amount, { by: u, text: `${unitTag(u)} 擦掉了痕跡：追蹤度 −${n.amount}。` })
    report(run, u, 'wipe', ok, `${unitTag(u)} 擦痕跡：追蹤度 −${n.amount}。`, { amount: -n.amount })
  },
})

/** 標記：一個敵人（targets 個）被全隊攻擊時命中 +amount，直到他下次過載。對主要那個目標的防火牆擲一次。 */
const markAction = adminAction({
  name: 'mark', order: 6, target: 'foe',
  desc: '標記一個敵人：我方全隊打他的命中 +2，直到他下次過載。要過一次檢定（智識加介面，對他的防火牆）；花 1 RAM，不花行動點；追蹤度 +1。',
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({
    target: { unit: t.id } as BattleTarget,
    blocks: markOf(t)?.side === u.side ? [`${t.name}已經被標記了，要等他過載。`] : [],
    hint: { bonus: adminCalc(view, u, 'mark').amount },
  })),
  picks: (view, u): BattlePick[] => {
    const count = adminCalc(view, u, 'mark').targets
    return Array.from({ length: Math.max(0, count - 1) }, (_, i): BattlePick => ({
      key: `also_${i + 1}`, label: `另一個要標記的敵人（第 ${i + 2} 個）`, kind: 'foe', required: false,
      options: unitsOf(view.battle, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: markOf(t)?.side === u.side ? [`${t.name}已經被標記了。`] : [], at: { unit: t.id } as BattleTarget })),
    }))
  },
  run: (run, u, target, input, n) => {
    if (!target || !('unit' in target)) throw new BattleBlocked(['標記要選一個敵人。'])
    const t = run.unit(target.unit)
    if (t.side === u.side || t.out) throw new BattleBlocked(['標記要選場上的一個敵人。'])
    const ok = rollFirewall(run, u, 'mark', n, target)
    charge(run, u, n, ok)
    if (ok) {
      mark(run, u, t, n.amount)
      // 多標的幾個：玩家選的優先，不夠的照格子順序補；已經被標記的跳過
      const chosen = Array.from({ length: Math.max(0, n.targets - 1) }, (_, i) => input.pick?.[`also_${i + 1}`])
      const more: BattleUnit[] = []
      for (const id of chosen) {
        const x = typeof id === 'string' ? run.battle.units[id] : undefined
        if (x && x.side !== u.side && !x.out && x.id !== t.id && !more.includes(x) && markOf(x)?.side !== u.side) more.push(x)
      }
      for (const x of unitsOf(run.battle, otherSide(u.side))) if (more.length < n.targets - 1 && x.id !== t.id && !more.includes(x) && markOf(x)?.side !== u.side) more.push(x)
      for (const x of more) mark(run, u, x, n.amount)
    } else report(run, u, 'mark', false, '')
  },
  // 標記正在被集火的人：被打得最重的那一個（生命或感載損失的比例最高），沒有人受傷就是 AI 挑的那個
  aiTarget: (view, u, t) => {
    const foes = unitsOf(view.battle, otherSide(u.side)).filter((x) => markOf(x)?.side !== u.side)
    const loss = (x: BattleUnit): number => Math.max(x.hp ? 1 - x.hp.now / Math.max(1, x.hp.max) : 0, x.load ? x.load.now / Math.max(1, x.load.max) : 0)
    const hurt = [...foes].sort((a, b) => loss(b) - loss(a))[0]
    const pick = hurt && loss(hurt) > 0 ? hurt : t && foes.some((x) => x.id === t.id) ? t : foes[0]
    return pick ? { unit: pick.id } : null
  },
  aiScore: (view, u) => (unitsOf(view.battle, otherSide(u.side)).some((x) => markOf(x)?.side !== u.side) ? 1.5 : null),
})

export const ADMIN_ACTIONS: BattleActionDef[] = [wall, breach, cut, seize, crack, wipe, markAction]

// ---- 安裝 ----

export function installAdmin(k: Kernel): void {
  for (const def of ADMIN_ACTIONS) k.battle.action(def)

  // 標記：標記的那一方打他命中 +bonus
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.kind !== 'hit' || !q.other || q.view.mode.layer !== 'net') return []
    const m = markOf(q.other)
    return m && m.side === q.unit.side ? [{ label: '標記', value: m.bonus, source: 'mark' }] : []
  })

  // 他過載之後標記沒了
  k.battle.on('overload', OWNER, ({ run, unit }) => {
    if (run.mode.layer !== 'net' || !markOf(unit)) return
    delete (unit.ext.net as Record<string, unknown>).marked
    run.say(`${unitTag(unit)} 過載了：身上的標記沒了。`, 'admin', { unit: unit.id, admin: 'mark', cleared: true })
  })

  // net.crack：破解成功（行動與工具構裝「後門鑰匙」共用）。工具來的（source.kind 是 hack）用完那一件從這一場消失。
  k.battle.effect('net.crack', OWNER, (ctx) => {
    const u = ctx.user
    if (ctx.run.over) return
    if (ctx.source.kind === 'hack') {
      const deck = u.ext.deck
      if (isRecord(deck) && Array.isArray(deck.constructs)) deck.constructs = deck.constructs.filter((c) => !(isRecord(c) && c.id === ctx.source.id))
    }
    crackNow(ctx.run, u, ctx.source.id)
    ctx.last.ok = true
  }, { problems: (e) => Object.keys(e).filter((x) => !['op', 'who', 'if'].includes(x)).map((x) => `${x} 不是這個效果的欄位`) })

  // net.admin_spend { n? }：做的人花掉 n 次（沒寫 1 次）管理行動；這一回合的次數不夠時這一步做不成
  k.battle.effect('net.admin_spend', OWNER, (ctx, e) => {
    spendAdmin(ctx.run, ctx.user, typeof e.n === 'number' ? e.n : 1)
    ctx.last.ok = true
  }, {
    problems: (e) => [
      ...Object.keys(e).filter((x) => !['op', 'who', 'if', 'n'].includes(x)).map((x) => `${x} 不是這個效果的欄位`),
      ...(e.n !== undefined && !(isInt(e.n) && e.n >= 0) ? ['n 要是 0 以上的整數'] : []),
    ],
  })
}

