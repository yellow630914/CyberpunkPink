// L6 功能 cyberware 的戰鬥（工單 M4-cyber-battle；CYBERWARE 第 3、4 節；CRAFTING 5.5 節；COMBAT_SYSTEM 第 6 節；SKILL_TREES 改造師「戰地手術」；ITEMS 4.1 節；
// dev/adr/0015 第三節與 E13；dev/adr/0019 第三節與 P9、P10、P46、P47）。
//
//   loadout        現實的戰場：身上每一件好了、沒有 off 的義體變成一筆 { kind, name, contract? }（不含橋）；重的重創讓失效的那幾件（cyberLive）不列、不生效
//   unit.ready     把這個人身上帶 battle 欄位的義體記在單位上（ext.cyber.have），藥泵裡預裝的藥記在 ext.cyber.pump
//   行動           掃過每一張帶 battle 的設計圖，各註冊成戰鬥的行動（ready 時；has：這個單位身上有那一件而且生效中）：
//                  battle.actions 一次性的行動、battle.toggle 開關、藥泵多一個 0 行動點的行動 cyber_pump
//   開關           ext.cyber.on = { <toggle id>: 檔位 | true }：開著時每個自己的回合開始感載加 upkeep_load（照檔位）、mods 用來源 cyber 生效、過載與被 off_<種類> 打到時關掉
//   修正           一個 k.battle.modifier：開著的開關、battle.scaling（照現在的感載）、battle.vs（對手帶某個標籤）、戰地手術裝上的那一件 effects 裡 mod 類的
//   效果 op        implant_install：相鄰的隊友從使用者的快取格拿一件義體成品裝上，這一場立刻能用；戰鬥結束（onEnd）才寫進角色
//   戰鬥結束       把裝上的那幾件寫進角色（背包少一疊、沉溺成本照自己動刀算、不休養、擲一次義體學決定併發症）、藥泵用掉的劑數寫回那一件
// 戰鬥中不寫角色的狀態；這一場被回退（重來、撤退）就什麼都沒發生。

import type { ActorId, BattleActionDef, BattleEffectCtx, BattlePick, BattleRun, BattleUnit, BattleView, BlueprintEntry, Change, GameState, ItemEntry, Kernel, RollPart, SyncGear } from '../../core'
import {
  BattleBlocked, ContentError, SYNC_GEARS, clone, dcFor, deriveRng, isRecord, isSyncGear, modeOf, passiveProblems, productOf, readProduct, rollCheck, statusRuleOf, syncBlocks, syncRuleOf, unitTag,
} from '../../core'
import type { BattleAction, BattleDef, BattleToggle, FieldData } from './battleDef'
import { SYNC_BACKLASH, battleProblems, kindOfBlueprint, readBattle } from './battleDef'
import type { CyberPiece } from './model'
import { EXT, PART_NAME, blueprintEntry, cyberExtValue, cyberLive, cyberOf, cyberRules, hasBridge, isActive, isBridge, nowOf, partIdOf } from './model'
import type { PartId } from './model'
import { complicationPool, floorWith, pieceSink } from './surgery'

export const OWNER = 'cyberware'
/** 單位的 ext 裡放這個功能的資料的鍵 */
export const UNIT_EXT = 'cyber'
export const PUMP_ACTION = 'cyber_pump'
export const INSTALL_OP = 'implant_install'
/** 戰地手術的報告前綴與擲骰用途 */
export const FIELD_ACTION = 'cyber.field'
const SELF_ATTR = 'tech'

// ---- 單位身上的資料 ----

interface Have { uid: string; bp: string }
export interface FieldPiece {
  uid: string
  bp: string
  slot: PartId
  /** 動刀的人（戰後擲義體學的人） */
  by: ActorId
  data: FieldData
}
interface UnitExt {
  /** 這個人身上帶 battle 欄位的義體（開打時的快照） */
  have?: Have[]
  /** 開著的開關：id → 檔位（levels）或 true */
  on?: Record<string, SyncGear | true>
  /** 藥泵：那一件的 uid → 預裝的藥與剩幾劑 */
  pump?: Record<string, { item: string; qty: number }>
  /** 這一場戰地手術裝上的 */
  field?: FieldPiece[]
}

const extOf = (u: BattleUnit): UnitExt | undefined => (isRecord(u.ext[UNIT_EXT]) ? (u.ext[UNIT_EXT] as UnitExt) : undefined)
function ensureExt(u: BattleUnit): UnitExt {
  if (!isRecord(u.ext[UNIT_EXT])) u.ext[UNIT_EXT] = {}
  return u.ext[UNIT_EXT] as UnitExt
}
/** 這個單位身上帶 battle 欄位、生效中的義體（開打時的，加上戰地手術裝上的）。 */
const haveOf = (u: BattleUnit): Have[] => {
  const e = extOf(u)
  return e ? [...(e.have ?? []), ...(e.field ?? []).map((f) => ({ uid: f.uid, bp: f.bp }))] : []
}
const hasBp = (u: BattleUnit, bp: string): boolean => haveOf(u).some((h) => h.bp === bp)

// ---- 每個 kernel 一份的查表（ready 時填） ----

interface Ctx {
  defs: Map<string, BattleDef | null>
  /** 開關的 id → 它在哪張設計圖上 */
  toggles: Map<string, { bp: string; toggle: BattleToggle }>
}
const CTX = new WeakMap<object, Ctx>()
const ctxOf = (k: object): Ctx => {
  let c = CTX.get(k)
  if (!c) CTX.set(k, (c = { defs: new Map(), toggles: new Map() }))
  return c
}

/** 一張設計圖的 battle 欄位（讀過的整理好；沒有是 undefined）。 */
export function defOf(k: Pick<Kernel, 'content'>, bpId: string): BattleDef | undefined {
  const c = ctxOf(k)
  if (c.defs.has(bpId)) return c.defs.get(bpId) ?? undefined
  const def = readBattle(blueprintEntry(k, bpId)?.battle)
  c.defs.set(bpId, def ?? null)
  return def
}

/** 這一件在戰鬥裡的種類（失效與超頻照它找）。 */
export function pieceKind(k: Pick<Kernel, 'content'>, piece: Pick<CyberPiece, 'bp' | 'kind_of'>): string {
  if (piece.kind_of === 'deck') return 'deck'
  const bp = blueprintEntry(k, piece.bp)
  return bp ? kindOfBlueprint(bp as BlueprintEntry & { implant_kind?: unknown }) : 'generic'
}

/** 授權鎖的種類（M4-cyber-lock 之前就是 ProductData.lock 的 kind）：契約義體改造師的技能看。 */
const isContract = (piece: CyberPiece): boolean => isRecord(piece.lock) && piece.lock.kind === 'contract'

/** loadout 的 implants：身上每一件好了、沒有 off 的義體（重的重創讓失效的不算），不含橋。 */
export function battleImplants(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): Array<{ kind: string; name: string; contract?: boolean }> {
  const now = nowOf(state)
  const out: Array<{ kind: string; name: string; contract?: boolean }> = []
  for (const piece of cyberLive(state, actor)) {
    if (isBridge(piece) || !isActive(piece, now)) continue
    const name = (piece.kind_of === 'deck' ? undefined : blueprintEntry(k, piece.bp)?.name) ?? piece.bp
    out.push({ kind: pieceKind(k, piece), name, ...(isContract(piece) ? { contract: true } : {}) })
  }
  return out
}

// ---- 失效 ----

/** 一種義體失效的狀態 id：規則表有 off_<種類> 用它，沒有退回 off_generic（和 run.implantStatus 同一個規則）。 */
const offStatusId = (k: Pick<Kernel, 'content'>, kind: string): string => (statusRuleOf(k.content, `off_${kind}`) ? `off_${kind}` : 'off_generic')
const isOff = (k: Pick<Kernel, 'content'>, u: BattleUnit, kind: string): boolean => {
  const id = offStatusId(k, kind)
  return u.statuses.some((s) => s.id === id)
}

// ---- 開關 ----

const gearName = (view: Pick<BattleView, 'k'>, gear: SyncGear): string => `${syncRuleOf(view.k.content).gears[gear].name}檔`

/** 這一檔每回合的回灌（感載）：沒有分檔的開關就是那個數字。 */
function upkeepOf(t: BattleToggle, gear: SyncGear | true | undefined): number {
  if (typeof t.upkeep === 'number') return t.upkeep
  return t.upkeep[gear === undefined || gear === true ? 'standard' : gear] ?? 0
}

/** 開這一檔不行的原因：角色看核心的 syncBlocks（同步等級與敏感度）；沒有角色的單位只開得了淺與標準。 */
function gearBlocks(view: BattleView, u: BattleUnit, gear: SyncGear): string[] {
  if (u.actor && view.state.actors[u.actor]) return syncBlocks(view.k, view.state, u.actor, gear)
  return gear === 'shallow' || gear === 'standard' ? [] : [`${gearName(view, gear)}要有同步的資料才開得了，這個單位只開得到標準檔。`]
}

/** 這個單位開著的開關（id、定義、檔位）。 */
function activeToggles(k: Kernel, u: BattleUnit): Array<{ id: string; toggle: BattleToggle; bp: string; gear: SyncGear | true }> {
  const on = extOf(u)?.on
  if (!on) return []
  const out = []
  for (const [id, gear] of Object.entries(on)) {
    const found = ctxOf(k).toggles.get(id)
    if (found) out.push({ id, toggle: found.toggle, bp: found.bp, gear })
  }
  return out
}

/** 關掉一個開關（記一拍）。 */
function closeToggle(run: BattleRun, u: BattleUnit, id: string, why: string): void {
  const ext = extOf(u)
  if (!ext?.on || ext.on[id] === undefined) return
  const name = ctxOf(run.k).toggles.get(id)?.toggle.name ?? id
  delete ext.on[id]
  if (Object.keys(ext.on).length === 0) delete ext.on
  run.say(`${unitTag(u)} 的${name}關掉了（${why}）。`, 'status', { unit: u.id, toggle: id, on: false }, u)
}

/** 開著的開關：這件義體不在了、或被 off_<種類> 打到，就關掉。 */
function settleToggles(run: BattleRun, u: BattleUnit): void {
  for (const t of activeToggles(run.k as Kernel, u)) {
    if (!hasBp(u, t.bp)) closeToggle(run, u, t.id, '義體不在身上')
    else if (isOff(run.k, u, kindOfToggle(run.k as Kernel, t.bp))) closeToggle(run, u, t.id, '義體失效')
  }
}
const kindOfToggle = (k: Pick<Kernel, 'content'>, bp: string): string => {
  const e = blueprintEntry(k, bp)
  return e ? kindOfBlueprint(e as BlueprintEntry & { implant_kind?: unknown }) : 'generic'
}

// ---- 修正 ----

/** 修正的標籤對得上嗎：每個要求的標籤都在問的情境標籤裡；melee 另外認「手上拿的是近戰武器」（攻擊的標籤裡沒有它）。 */
function tagsMatch(want: readonly string[] | undefined, q: { tags: string[]; weapon?: { traits: string[] } }): boolean {
  if (!want) return true
  return want.every((t) => q.tags.includes(t) || (t === 'melee' && !!q.weapon?.traits.includes('melee')))
}

function battleMods(k: Kernel, q: Parameters<Parameters<Kernel['battle']['modifier']>[1]>[0]): RollPart[] {
  if (q.view.mode.layer !== 'meat') return []
  const u = q.unit
  const ext = extOf(u)
  if (!ext) return []
  const out: RollPart[] = []
  // 開著的開關：mods 用來源 cyber（ap_regen 被節奏資源的上限夾）；levels 的另外吃同步表那一檔的檢定加減（命中與自己擲的檢定）
  for (const t of activeToggles(k, u)) {
    if (isOff(k, u, kindOfToggle(k, t.bp))) continue
    for (const m of t.toggle.mods) {
      if (m.mod !== q.kind || (m.layer && m.layer !== q.view.mode.layer) || !tagsMatch(m.tags, q)) continue
      out.push({ label: t.toggle.name, value: m.amount, source: 'cyber' })
    }
    if (t.toggle.levels && t.gear !== true && (q.kind === 'hit' || q.kind === 'save')) {
      const check = syncRuleOf(q.view.k.content).gears[t.gear].check
      if (check) out.push({ label: `${t.toggle.name}（${gearName(q.view, t.gear)}）`, value: check, source: 'sync' })
    }
  }
  // 照現在的感載給（熱驅動）與對手帶某個標籤才有的（駭入接頭）：設計圖在身上、生效中就算
  for (const h of haveOf(u)) {
    const def = defOf(k, h.bp)
    if (!def) continue
    if (def.scaling.length && u.load) {
      for (const s of def.scaling) {
        if (s.mod !== q.kind || !tagsMatch(s.tags, q)) continue
        const n = Math.floor(u.load.now / s.per_load) * s.amount
        if (n) out.push({ label: blueprintEntry(k, h.bp)?.name ?? h.bp, value: n, source: 'cyber' })
      }
    }
    for (const s of def.vs) {
      if (s.mod !== q.kind || !q.other || !s.other_tags.some((t) => q.other!.tags.includes(t)) || !tagsMatch(s.tags, q)) continue
      out.push({ label: blueprintEntry(k, h.bp)?.name ?? h.bp, value: s.amount, source: 'cyber' })
    }
  }
  // 戰地手術裝上的那一件：它 effects 裡 mod 類的（不帶 if 的）這一場生效；屬性、衍生數值那幾種要等戰鬥結束寫進角色
  for (const f of ext.field ?? []) {
    const effects = (blueprintEntry(k, f.bp) as { effects?: unknown } | undefined)?.effects
    if (!Array.isArray(effects)) continue
    for (const e of effects) {
      if (!isRecord(e) || typeof e.mod !== 'string' || e.mod !== q.kind || typeof e.amount !== 'number' || e.if !== undefined) continue
      if (e.layer !== undefined && e.layer !== q.view.mode.layer) continue
      if (!tagsMatch(Array.isArray(e.tags) ? (e.tags as string[]) : undefined, q)) continue
      out.push({ label: blueprintEntry(k, f.bp)?.name ?? f.bp, value: e.amount, source: 'cyber' })
    }
  }
  return out
}

// ---- 行動 ----

const usedKey = (scope: 'turn' | 'battle', id: string): string => (scope === 'turn' ? `turn:cyber.${id}` : `cyber.${id}`)

function oneShot(bp: BlueprintEntry, a: BattleAction): BattleActionDef {
  const limit = a.uses
  return {
    id: a.id, owner: OWNER, name: a.name,
    desc: `${a.name}（${bp.name}）：花 ${a.ap} 點行動點${limit?.turn ? `，每回合最多 ${limit.turn} 次` : ''}${limit?.battle ? `，每場最多 ${limit.battle} 次` : ''}。`,
    group: 'supply', icon: a.icon, modes: ['meat'], target: 'none', order: 40,
    has: (_v, u) => hasBp(u, bp.id),
    cost: () => ({ ap: a.ap }),
    blocks: (_v, u) => {
      const out: string[] = []
      if (limit?.turn !== undefined && (u.uses[usedKey('turn', a.id)] ?? 0) >= limit.turn) out.push(`這個回合已經用過${a.name}了。`)
      if (limit?.battle !== undefined && (u.uses[usedKey('battle', a.id)] ?? 0) >= limit.battle) out.push(`這場戰鬥已經用過${a.name}了。`)
      return out
    },
    run: (run, u, _t, input) => {
      u.uses[usedKey('turn', a.id)] = (u.uses[usedKey('turn', a.id)] ?? 0) + 1
      u.uses[usedKey('battle', a.id)] = (u.uses[usedKey('battle', a.id)] ?? 0) + 1
      run.say(`${unitTag(u)} 啟動${a.name}。`, 'skill', { unit: u.id, action: a.id }, u)
      run.effects(a.do, { user: u, target: { unit: u.id }, source: { kind: 'ability', id: a.id, name: a.name }, pick: input.pick ?? {} })
    },
  }
}

function toggleAction(bp: BlueprintEntry, t: BattleToggle): BattleActionDef {
  const turnKey = usedKey('turn', t.id)
  const offBlock = (view: Pick<BattleView, 'k'>, u: BattleUnit): string[] => (isOff(view.k, u, kindOfBlueprint(bp as BlueprintEntry & { implant_kind?: unknown })) ? [`${t.name}失效中，開不了。`] : [])
  return {
    id: t.id, owner: OWNER, name: t.name,
    desc: `${t.name}（${bp.name}）：開著的時候每個自己的回合開始感載會加${t.levels ? '（照檔位）' : ''}，換來${t.levels ? '那一檔的檢定加成與' : ''}它給的加成。不花行動點，每回合只能切一次；過載時自動關掉。`,
    group: 'tactic', icon: t.icon, modes: ['meat'], target: 'none', order: 41,
    has: (_v, u) => hasBp(u, bp.id),
    cost: () => ({ ap: 0 }),
    blocks: (view, u) => [...((u.uses[turnKey] ?? 0) >= 1 ? [`這個回合已經切換過${t.name}了。`] : []), ...offBlock(view, u)],
    picks: t.levels
      ? (view, u): BattlePick[] => {
        const cur = extOf(u)?.on?.[t.id]
        return [{
          key: 'gear', label: '開哪一檔', kind: 'choice', required: cur === undefined,
          options: SYNC_GEARS.map((g) => ({
            value: g, label: gearName(view, g), blocks: [...(cur === g ? [`已經是${gearName(view, g)}了。`] : []), ...gearBlocks(view, u, g)],
            hint: { upkeep_load: upkeepOf(t, g), check: syncRuleOf(view.k.content).gears[g].check },
          })),
        }]
      }
      : undefined,
    run: (run, u, _t, input) => {
      const ext = ensureExt(u)
      const cur = ext.on?.[t.id]
      const off = offBlock(run, u)
      if (off.length) throw new BattleBlocked(off)
      if (t.levels) {
        const want = input.pick?.gear
        if (want === undefined) {
          if (cur === undefined) throw new BattleBlocked(['要選開哪一檔。'])
          closeToggle(run, u, t.id, '關閉')
        } else {
          if (!isSyncGear(want)) throw new BattleBlocked(['要選淺、標準、深、全其中一檔。'])
          const why = gearBlocks(run, u, want)
          if (why.length) throw new BattleBlocked(why)
          if (cur === want) throw new BattleBlocked([`已經是${gearName(run, want)}了。`])
          ext.on = { ...(ext.on ?? {}), [t.id]: want }
          run.say(`${unitTag(u)} ${cur === undefined ? '啟動' : '換到'}${t.name}（${gearName(run, want)}）。`, 'status', { unit: u.id, toggle: t.id, on: true, gear: want }, u)
        }
      } else if (cur !== undefined) closeToggle(run, u, t.id, '關閉')
      else {
        ext.on = { ...(ext.on ?? {}), [t.id]: true }
        run.say(`${unitTag(u)} 啟動${t.name}。`, 'status', { unit: u.id, toggle: t.id, on: true }, u)
      }
      u.uses[turnKey] = 1
    },
  }
}

// ---- 藥泵 ----

/** 藥泵一座放幾劑：設計圖寫了用設計圖的，沒寫用規則表。 */
export function pumpCapacity(k: Pick<Kernel, 'content'>, bp: string): number {
  return defOf(k, bp)?.pump?.doses ?? cyberRules(k).pump_doses
}

function pumpEntries(u: BattleUnit): Array<{ uid: string; item: string; qty: number }> {
  const pump = extOf(u)?.pump
  return pump ? Object.entries(pump).filter(([, p]) => p.qty > 0).map(([uid, p]) => ({ uid, ...p })) : []
}

const pumpAction: BattleActionDef = {
  id: PUMP_ACTION, owner: OWNER, name: '藥泵', desc: '從身上的藥泵注射一劑預裝的藥：不花行動點，效果照那一種藥。',
  // 圖示借用 item（注射一劑藥，和使用道具同一個意思）；要有專屬的圖，等介面畫了 pump 再換（dev/adr/0014 的表）
  group: 'supply', icon: 'item', modes: ['meat'], target: 'none', order: 42,
  has: (_v, u) => !!extOf(u)?.pump && Object.keys(extOf(u)!.pump!).length > 0,
  cost: () => ({ ap: 0 }),
  blocks: (_v, u) => (pumpEntries(u).length === 0 ? ['藥泵裡沒有藥了。'] : []),
  picks: (view, u): BattlePick[] => {
    const list = pumpEntries(u)
    if (list.length === 0) return []
    return [{
      key: 'pump', label: '哪一座藥泵', kind: 'choice', required: list.length > 1,
      options: list.map((p) => ({ value: p.uid, label: `${view.k.content.get<ItemEntry>('item', p.item)?.name ?? p.item} ×${p.qty}`, blocks: [] as string[] })),
    }]
  },
  run: (run, u, _t, input) => {
    const list = pumpEntries(u)
    if (list.length === 0) throw new BattleBlocked(['藥泵裡沒有藥了。'])
    const want = input.pick?.pump
    const found = want === undefined ? (list.length === 1 ? list[0] : undefined) : list.find((p) => p.uid === want)
    if (!found) throw new BattleBlocked([want === undefined ? '要選哪一座藥泵。' : '沒有這座藥泵，或裡面已經空了。'])
    const entry = run.k.content.get<ItemEntry>('item', found.item)
    if (!entry?.use) throw new BattleBlocked(['這種藥現在注射不了。'])
    extOf(u)!.pump![found.uid]!.qty -= 1
    run.say(`${unitTag(u)} 從藥泵注射了${entry.name}。`, 'item', { unit: u.id, item: found.item, pump: true }, u)
    // 效果照那個物品的 use.effects（和快取格用道具同一份資料）；不經「使用道具」那個行動，所以不花行動點、也不動快取格
    run.effects(entry.use.effects, { user: u, target: { unit: u.id }, source: { kind: 'item', id: found.item, name: entry.name }, pick: {} })
  },
}

// ---- 戰地手術（效果 op implant_install；P47） ----

/** 使用者快取格裡可以裝的義體成品：快取格那一格的 item 是設計圖的 id（義體、大小 2 以下），背包裡有那一疊（帶 uid）、這一場還沒被裝過。 */
function fieldCandidates(run: BattleRun, user: BattleUnit): Array<{ uid: string; bp: BlueprintEntry; data: FieldData }> {
  const used = new Map<string, number>()
  const usedUids = new Set<string>()
  for (const u of Object.values(run.battle.units)) {
    for (const f of extOf(u)?.field ?? []) {
      usedUids.add(f.uid)
      if (f.by === user.actor) used.set(f.bp, (used.get(f.bp) ?? 0) + 1)
    }
  }
  const out: Array<{ uid: string; bp: BlueprintEntry; data: FieldData }> = []
  for (const q of user.quick) {
    if (q.qty <= 0) continue
    const bp = blueprintEntry(run.k, q.item)
    if (!bp || bp.kind !== 'cyberware' || !bp.slot || bp.slot === 'bridge' || bp.deck || (bp.size ?? 0) > 2) continue
    const left = q.qty - (used.get(q.item) ?? 0)
    if (left <= 0) continue
    const stacks = run.state.inventory.filter((s) => s.id === q.item && typeof s.data?.uid === 'string' && !usedUids.has(s.data.uid as string))
    for (const s of stacks.slice(0, left)) out.push({ uid: s.data!.uid as string, bp, data: readProduct(s.data, run.k.content) })
  }
  return out
}

/** 目標身上現在有的義體（開打時的，加上這一場裝上的）擺在哪些部位。 */
function slotsInUse(run: BattleRun, target: BattleUnit): PartId[] {
  const base = target.actor ? cyberOf(run.state, target.actor).map((p) => p.slot) : []
  return [...base, ...(extOf(target)?.field ?? []).map((f) => f.slot)]
}

function installOp(ctx: BattleEffectCtx, effect: Record<string, unknown>): void {
  const { run, user, unit: target } = ctx
  if (!target || run.isStandIn(target)) return
  const k = run.k as Kernel
  const fail = (why: string): never => { throw new BattleBlocked([why]) }
  if (run.mode.layer !== 'meat') fail('戰地手術只在現實的戰場做得了。')
  if (ctx.source.kind !== 'ability') fail('替人裝上義體是技能才做得到的事。')
  if (target.id === user.id) fail('要替相鄰的隊友動刀，不能替自己。')
  if (target.side !== user.side || Math.abs(target.slot - user.slot) > 1) fail('要替相鄰一格的隊友動刀。')
  if (!target.actor || !run.state.actors[target.actor]) fail(`${target.name}不是能裝義體的人。`)
  const actor = target.actor!
  const candidates = fieldCandidates(run, user)
  if (candidates.length === 0) fail('快取格裡沒有可以裝的義體（義體成品、大小 2 以下）。')
  const want = typeof effect.pick === 'string' ? ctx.pick[effect.pick] : ctx.pick.implant
  const chosen = (typeof want === 'string' ? candidates.find((c) => c.uid === want || c.bp.id === want) : undefined) ?? candidates[0]!
  const info = productOf(run.k.content, chosen.bp.id, chosen.data)
  if (!info) fail('這一件認不出來。')
  if (info!.missing.length > 0) fail(`${chosen.bp.name}缺零件，裝不上去。`)
  if (cyberOf(run.state, actor).some((p) => p.uid === chosen.uid)) fail(`${chosen.bp.name}已經裝在他身上了。`)
  if (chosen.bp.needs_bridge !== false && !hasBridge(run.state, actor)) fail(`${target.name}還沒有橋，這件義體接不上。`)
  const rules = cyberRules(k)
  const inUse = slotsInUse(run, target)
  const sides: Array<'l' | 'r' | undefined> = chosen.bp.slot === 'arm' || chosen.bp.slot === 'leg' ? ['l', 'r'] : [undefined]
  const slot = sides.map((s) => partIdOf(chosen.bp.slot, s)).find((s): s is PartId => !!s && inUse.filter((x) => x === s).length < rules.slots[s])
  if (!slot) fail(`${target.name}的${chosen.bp.slot === 'arm' ? '手臂' : chosen.bp.slot === 'leg' ? '腿' : PART_NAME[chosen.bp.slot as PartId] ?? chosen.bp.slot}沒有空槽了。`)
  const ext = ensureExt(target)
  ext.field = [...(ext.field ?? []), { uid: chosen.uid, bp: chosen.bp.id, slot: slot!, by: user.actor ?? '', data: clone(chosen.data) }]
  target.implants = [...(target.implants ?? []), { kind: kindOfBlueprint(chosen.bp as BlueprintEntry & { implant_kind?: unknown }), name: chosen.bp.name }]
  target.cyber = (target.cyber ?? 0) + 1
  run.say(`${unitTag(user)} 替 ${unitTag(target)} 裝上了${chosen.bp.name}，這一場立刻能用。`, 'support', { unit: user.id, target: target.id, implant: chosen.bp.id }, user)
}

// ---- 戰鬥結束：寫回角色 ----

function endChanges(k: Kernel, state: GameState, battle: { units: Record<string, BattleUnit> }): { changes: Change[]; lines: string[] } {
  const changes: Change[] = []
  const lines: string[] = []
  const rules = cyberRules(k)
  const seen = new Set<string>()
  for (const u of Object.values(battle.units)) {
    if (u.side !== 'ally' || !u.actor || seen.has(u.actor) || !state.actors[u.actor]) continue
    const ext = extOf(u)
    if (!ext || (!ext.field?.length && !ext.pump)) continue
    seen.add(u.actor)
    const actor = u.actor
    const patient = state.actors[actor]!
    let pieces = cyberOf(state, actor)
    let touched = false
    // 藥泵：用掉的劑數寫回那一件（全空了就沒有預裝）
    for (const [uid, p] of Object.entries(ext.pump ?? {})) {
      const piece = pieces.find((x) => x.uid === uid)
      if (!piece?.loaded || p.item !== piece.loaded.item || p.qty >= piece.loaded.qty) continue
      const used = piece.loaded.qty - Math.max(0, p.qty)
      lines.push(`用掉：藥泵裡的${k.content.get<ItemEntry>('item', p.item)?.name ?? p.item} ×${used}`)
      pieces = pieces.map((x) => {
        if (x.uid !== uid) return x
        const { loaded: _loaded, ...rest } = x
        void _loaded
        return p.qty > 0 ? { ...rest, loaded: { item: p.item, qty: p.qty } } : rest
      })
      touched = true
    }
    // 戰地手術：背包少一疊、身上多一件（不休養、不收費）；沉溺成本照自己動刀算；戰後擲一次義體學，失敗多一筆併發症
    let sinkAdded = 0
    for (const f of ext.field ?? []) {
      const stack = state.inventory.find((s) => s.data?.uid === f.uid)
      const bp = blueprintEntry(k, f.bp)
      if (!stack || !bp || cyberOf(state, actor).some((p) => p.uid === f.uid)) continue
      const by = f.by && state.actors[f.by] ? f.by : undefined
      let degree: string | undefined
      if (by) {
        const dc = dcFor(rules.self_dc[Math.min(5, Math.max(1, bp.grade)) - 1] ?? rules.self_dc[0] ?? 10, state.rules)
        const roll = rollCheck(k.stats, state, { actor: by, attr: SELF_ATTR, skill: rules.self_skill, dc, purpose: `${FIELD_ACTION}/${f.uid}`, tags: ['surgery'] })
        degree = roll.degree
        changes.push({ op: 'rng', advance: 1 })
      }
      const base = readProduct(stack.data, k.content)
      const parts = Object.keys(base.parts).length > 0 ? base.parts : clone(bp.stock ?? {})
      const quirks = [...(base.quirks ?? [])]
      let quirkName: string | undefined
      if (degree === 'fail' || degree === 'fumble') {
        const pool = complicationPool(k).filter((x) => !quirks.includes(x.id))
        if (pool.length > 0) {
          const pick = deriveRng(state.rng, `${FIELD_ACTION}/${f.uid}/quirk`).pick(pool)
          quirks.push(pick.id)
          quirkName = pick.name
        }
      }
      // 沉溺成本照自己動刀算（動刀的人的手術刀加減看 by）；大成功再 −1
      const sink = Math.max(0, pieceSink(k, state, f.bp, f.data, { via: 'self', ...(by ? { by } : {}) }) - (degree === 'critical' ? 1 : 0))
      const piece: CyberPiece = {
        ...base, uid: f.uid, parts, ...(quirks.length > 0 ? { quirks } : {}), bp: f.bp, kind_of: 'blueprint', slot: f.slot, sink, at: nowOf(state), registered: false,
      }
      pieces = [...pieces, piece]
      sinkAdded += sink
      touched = true
      changes.push({ op: 'item', id: f.bp, qty: -1, data: { uid: f.uid } })
      lines.push(`戰地手術：${patient.name}身上多了${bp.name}${quirkName ? `（留下了併發症：${quirkName}）` : degree === 'fail' || degree === 'fumble' ? '（手術不算乾淨）' : ''}`)
    }
    if (!touched) continue
    changes.push({ op: 'actor.ext', id: actor, key: EXT, value: cyberExtValue(state, actor, pieces) })
    if (sinkAdded > 0) {
      const floor = floorWith(k, state, actor, sinkAdded)
      if (patient.sink < floor) changes.push({ op: 'actor.track', id: actor, track: 'sink', delta: floor - patient.sink })
    }
  }
  return { changes, lines }
}

// ---- 登記 ----

/** 在 feature 的 install 呼叫：掛點、修正、效果 op、藥泵的行動。每一張設計圖自己的行動要等內容載入，在 readyBattle。 */
export function installBattle(kernel: Kernel): void {
  const k = kernel
  ctxOf(k)

  // 帶進現實的戰鬥：身上每一件好了的義體（內海沒有）
  k.battle.loadout(OWNER, (state, actor, mode) => {
    if (!state.actors[actor] || modeOf(k.content, mode)?.layer !== 'meat') return undefined
    const implants = battleImplants(k, state, actor)
    return implants.length ? { implants } : undefined
  })

  // 單位組好：記下這個人身上帶 battle 欄位的義體與藥泵（重的重創讓失效的、休養中的、被鎖的不算）
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (!unit.actor || run.mode.layer !== 'meat' || !run.state.actors[unit.actor]) return
    const now = nowOf(run.state)
    const have: Have[] = []
    const pump: Record<string, { item: string; qty: number }> = {}
    for (const piece of cyberLive(run.state, unit.actor)) {
      if (!isActive(piece, now) || piece.kind_of === 'deck') continue
      const def = defOf(k, piece.bp)
      if (!def) continue
      have.push({ uid: piece.uid, bp: piece.bp })
      if (def.pump) pump[piece.uid] = piece.loaded ? { ...piece.loaded } : { item: '', qty: 0 }
    }
    if (have.length === 0) return
    const ext = ensureExt(unit)
    ext.have = have
    if (Object.keys(pump).length > 0) ext.pump = pump
  })

  k.battle.modifier(OWNER, (q) => battleMods(k, q))

  // 開關：每個自己的回合開始，感載加那一檔的回灌（失去的回合不算）；失效與不在身上的先關掉
  k.battle.on('turn.start', OWNER, ({ run, unit, lost }) => {
    settleToggles(run, unit)
    if (lost) return
    for (const t of activeToggles(k, unit)) {
      const n = upkeepOf(t.toggle, t.gear)
      if (n <= 0 || !unit.load) continue
      // 同步回灌的加減（寫在 load_taken_pct 上、帶 sync_backlash 標籤的修正，例：緋櫻 奉公與套裝的 −10%）：只算帶標籤的那一份
      const pct = run.mods('load_taken_pct', unit, undefined, undefined, [SYNC_BACKLASH]).reduce((s, p) => s + p.value, 0) - run.mods('load_taken_pct', unit).reduce((s, p) => s + p.value, 0)
      run.addLoad(unit, Math.max(0, Math.round((n * (100 + pct)) / 100)), undefined, { exact: true, label: t.toggle.name })
    }
  })
  k.battle.on('turn.end', OWNER, ({ run, unit }) => settleToggles(run, unit))
  // 過載時自動關掉（CYBERWARE 第 4 節：它會讓使用者自己把自己打到過載）
  k.battle.on('overload', OWNER, ({ run, unit }) => {
    for (const t of activeToggles(k, unit)) closeToggle(run, unit, t.id, '過載')
  })

  // 戰地手術：效果 op（只有技能能用）。{ who?, pick? }：pick 是 input.pick 裡放要裝哪一件（設計圖 id 或 uid）的鍵，沒寫看 pick.implant，再沒有就是第一件
  k.battle.effect(INSTALL_OP, OWNER, installOp, {
    problems: (e) => {
      const p: string[] = []
      for (const key of Object.keys(e)) if (!['op', 'who', 'if', 'pick'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：who、if、pick）`)
      if (e.pick !== undefined && !(typeof e.pick === 'string' && e.pick.trim())) p.push('pick 要是 input.pick 裡的鍵')
      return p
    },
  })

  k.battle.action(pumpAction)
  k.battle.onEnd(OWNER, ({ state, battle }) => {
    if (modeOf(k.content, battle.mode)?.layer !== 'meat') return undefined
    const { changes, lines } = endChanges(k, state, battle)
    return changes.length || lines.length ? { changes, lines } : undefined
  })
}

/**
 * 內容載入之後（feature 的 ready）：檢查每一張設計圖的 battle 欄位（查不過的整批擋下，每一條以 blueprint/<id>： 開頭），
 * 再把每一個 battle.actions 與 battle.toggle 註冊成戰鬥的行動。行動的 id 要是新的（不能和別的功能或別張設計圖重複）。
 */
export function readyBattle(k: Kernel): void {
  if (!k.content.hasKind('blueprint')) return
  const problems: string[] = []
  const ids = new Map<string, string>()
  const claim = (bp: string, id: string): void => {
    const old = ids.get(id) ?? k.battle.getAction(id)?.owner
    if (old) problems.push(`blueprint/${bp}：行動 ${id} 已經有人用了（${ids.has(id) ? `設計圖 ${ids.get(id)}` : old}）：每個行動的 id 要不一樣`)
    else ids.set(id, bp)
  }
  const bps = k.content.list<BlueprintEntry>('blueprint').filter((e) => e.battle !== undefined)
  for (const bp of bps) {
    const own = battleProblems(k, bp.battle)
    problems.push(...own.map((m) => `blueprint/${bp.id}：${m}`))
    if (own.length > 0) continue
    const def = readBattle(bp.battle)!
    for (const a of def.actions) claim(bp.id, a.id)
    if (def.toggle) claim(bp.id, def.toggle.id)
  }
  // 規則表的套裝加成是被動效果：格式照被動效果查
  for (const [brand, list] of Object.entries(cyberRules(k).set_bonus)) problems.push(...passiveProblems(k, list, `set_bonus.${brand}`).map((m) => `cyber_rule/default：${m}`))
  if (problems.length > 0) throw new ContentError(problems)
  const c = ctxOf(k)
  for (const bp of bps) {
    const def = readBattle(bp.battle)!
    for (const a of def.actions) k.battle.action(oneShot(bp, a))
    if (def.toggle) {
      c.toggles.set(def.toggle.id, { bp: bp.id, toggle: def.toggle })
      k.battle.action(toggleAction(bp, def.toggle))
    }
  }
}
