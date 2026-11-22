// L6 功能：戰敗（COMBAT_SYSTEM 8.3、8.4、8.5 節；ENEMIES 第 6 節；DATA 第 5 節；AI_TASKS 3.14 節「略過」那一段；dev/work/M1-defeat.md）。
//
// 戰鬥打輸（全隊倒下）或投降之後：照贏的那一方的勢力選一個戰敗事件與版本，先列出接受的話會發生什麼（M1 只有略過版：
// 一段敘事加上結果），等玩家選「接受結果」才結算。等待中的戰敗放在 state.ext.defeat；「重來」與「回到這個階段開始時」由
// 介面呼叫 Game.retryBattle()，ext 跟著快照回去，這個功能不用做事。
// 二十九種各自的分法與內容、戰敗時拿走義體與裝備、委託失敗的旗標都在 M2。

import type { Change, ContentEntry, Effect, Feature, Kernel, ReportDraft, RulesKernel } from '../../core'
import { clone, deriveRng, effectCtx, pickVersion, resolveFiltered } from '../../core'
import type { GameState, VersionId } from '../../core'

const OWNER = 'defeat'
const KIND = 'defeat_event'
const EXT = 'defeat'
const VERSION_KEYS: readonly VersionId[] = ['default', 'masc', 'yuri']

export interface DefeatVersion { text: string; effects: Effect[] }
export interface DefeatEventEntry extends ContentEntry {
  name: string
  /** 種類的 id（ENEMIES 第 6 節那張表的 id，或 generic） */
  kind: string
  factions: string[]
  fails_commission: boolean
  versions: Partial<Record<VersionId, DefeatVersion>>
  default?: boolean
  tags?: string[]
  fallback?: string
  adult?: boolean
}

export interface PendingDefeat {
  /** 戰敗事件的 id */
  event: string
  version: 'default' | 'masc' | 'yuri'
  /** 贏的那一方的勢力 */
  faction?: string
  outcome: 'lose' | 'surrender'
  fails_commission: boolean
  /** 接受的話會發生什麼，一行一筆（白話） */
  lines: string[]
  choices: ['accept', 'retry', 'stage']
  /** 存檔規則當時的設定 */
  view: 'always' | 'skippable' | 'never'
  /** M1 一律是略過版 */
  skipped: true
  /** 那一場戰鬥的 id */
  battle: string
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function defeatOf(state: GameState): PendingDefeat | null {
  const d = state.ext[EXT]
  return isRec(d) && typeof d.event === 'string' ? (d as unknown as PendingDefeat) : null
}

function entryProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.kind)) p.push('kind 要是種類的 id（字串）')
  if (!(Array.isArray(e.factions) && e.factions.every(isText))) p.push('factions 要是勢力 id 的陣列（可以是空的）')
  if (typeof e.fails_commission !== 'boolean') p.push('fails_commission 要是 true 或 false')
  const v = e.versions
  if (!isRec(v)) p.push('versions 要是物件，鍵只能是 default、masc、yuri')
  else {
    const keys = Object.keys(v)
    if (keys.length === 0) p.push('versions 至少要寫一個版本（default、masc、yuri）')
    for (const key of keys) {
      const at = `versions.${key}`
      if (!(VERSION_KEYS as readonly string[]).includes(key)) { p.push(`versions 的鍵只能是 default、masc、yuri（拿到 ${key}）`); continue }
      const one = v[key]
      if (!isRec(one)) { p.push(`${at} 要是 { text, effects }`); continue }
      if (!isText(one.text)) p.push(`${at}.text 要是一段敘事`)
      if (!(Array.isArray(one.effects) && one.effects.every(isRec))) p.push(`${at}.effects 要是效果（物件）的陣列`)
    }
  }
  if (e.default !== undefined && typeof e.default !== 'boolean') p.push('default 要是 true 或 false')
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isText))) p.push('tags 要是字串的陣列')
  if (e.fallback !== undefined && !isText(e.fallback)) p.push('fallback 要是戰敗事件的 id')
  if (e.adult !== undefined && typeof e.adult !== 'boolean') p.push('adult 要是 true 或 false')
  return p
}

/** 選事件：先看勢力，沒有就用 default；內容篩選把整條 fallback 都關掉時也改用 default。 */
function chooseEntry(k: RulesKernel, state: GameState, faction: string | undefined): DefeatEventEntry | undefined {
  const all = k.content.list<DefeatEventEntry>(KIND)
  const fallbackEntry = all.find((e) => e.default === true)
  const get = (id: string) => k.content.get<DefeatEventEntry>(KIND, id)
  const first = faction === undefined ? undefined : all.find((e) => e.factions.includes(faction))
  if (!first) return fallbackEntry && (resolveFiltered(state.rules, fallbackEntry, get) ?? undefined)
  return resolveFiltered(state.rules, first, get) ?? (fallbackEntry && resolveFiltered(state.rules, fallbackEntry, get))
}

function pick(k: RulesKernel, state: GameState, o: { faction?: string; roll: number }): { entry: DefeatEventEntry; version: VersionId } | undefined {
  const entry = chooseEntry(k, state, o.faction)
  if (!entry) return undefined
  const available = Object.keys(entry.versions) as VersionId[]
  const gender = state.pc ? state.actors[state.pc]?.gender : undefined
  return { entry, version: pickVersion(gender, o.roll, { available }) }
}

export function pickDefeat(k: RulesKernel, state: GameState, o: { faction?: string; roll: number }): { event: string; version: string; fails_commission: boolean } {
  const r = pick(k, state, o)
  if (!r) throw new Error('沒有可用的戰敗事件（沒有勢力對得上的，也沒有標 default 的通用事件）。')
  return { event: r.entry.id, version: r.version, fails_commission: r.entry.fails_commission }
}

/**
 * 戰敗扣多少錢（COMBAT_SYSTEM 8.3 節的第三個設定，dev/adr/0013 D11）：只調 kind 'cash'、amount 是負的那幾筆；
 * 合計最多 min(floor(身上的現金 × defeatMoneyLoss), defeatMoneyCap)，超過的從後面的幾筆往回減，減到 0 的拿掉。其餘的效果原樣。
 */
function adjustMoney(effects: Effect[], state: GameState): Effect[] {
  const limit = Math.min(Math.floor(state.money.cash * state.rules.defeatMoneyLoss), state.rules.defeatMoneyCap ?? Infinity)
  const out: Array<Effect | null> = effects.map((e) => ({ ...e }))
  const isLoss = (e: Effect | null): e is Effect & { amount: number } => !!e && e.kind === 'cash' && typeof e.amount === 'number' && e.amount < 0
  let excess = -out.reduce((sum, e) => sum + (isLoss(e) ? e.amount : 0), 0) - Math.max(0, limit)
  for (let i = out.length - 1; i >= 0 && excess > 0; i--) {
    const e = out[i]!
    if (!isLoss(e)) continue
    const cut = Math.min(-e.amount, excess)
    excess -= cut
    out[i] = -e.amount - cut === 0 ? null : { ...e, amount: e.amount + cut }
  }
  return out.filter((e): e is Effect => e !== null)
}

function settle(k: RulesKernel, state: GameState, entry: DefeatEventEntry, version: VersionId) {
  const v = entry.versions[version] ?? entry.versions.default ?? Object.values(entry.versions)[0]!
  const res = k.effects.resolve(adjustMoney(v.effects, state), effectCtx(k, state, { source: 'builtin' }))
  return { text: v.text, ...res }
}

export function acceptDefeat(k: Kernel, state: GameState): ReportDraft {
  const pending = defeatOf(state)
  if (!pending) throw new Error('沒有等待中的戰敗。')
  const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
  if (!entry) throw new Error(`戰敗事件 ${pending.event} 不在內容裡。`)
  const r = settle(k, state, entry, pending.version)
  if (r.errors.length) throw new Error(`戰敗事件 ${pending.event} 的效果有問題：${r.errors.join('；')}`)
  const changes: Change[] = [...r.changes, { op: 'ext', key: EXT, value: null }, { op: 'snapshot.drop', kind: 'battle' }]
  return {
    kind: 'event', action: 'defeat.accept', location: clone(state.location), party: [], timeline: [],
    changes,
    outcome: { result: 'accepted', summary: pending.fails_commission ? '你接受了這個結果。這一趟的委託算失敗。' : '你接受了這個結果。這一趟的委託還在。' },
    narration: { results: r.lines },
  }
}

export const defeatFeature: Feature = {
  id: OWNER,
  install(k) {
    k.content.defineKind<DefeatEventEntry>({
      kind: KIND, owner: OWNER,
      validate(e) {
        const p = entryProblems(e)
        if (e.default === true) {
          const other = k.content.list<DefeatEventEntry>(KIND).find((x) => x.default === true && x.id !== e.id)
          if (other) p.push(`default: true 整份內容裡最多一筆（${other.id} 已經是了）`)
        }
        return p
      },
      refs: (e) => [
        ...(Array.isArray(e.factions) ? e.factions.map((f) => ['faction', f] as [string, string]) : []),
        ...(e.fallback ? [[KIND, e.fallback] as [string, string]] : []),
      ],
    })

    k.battle.onEnd(OWNER, ({ k: bk, state, battle, outcome }) => {
      if (outcome !== 'lose' && outcome !== 'surrender') return
      const roll = deriveRng(state.rng, `defeat/${battle.id}`).next()
      const faction = battle.origin.faction
      const r = pick(bk, state, { ...(faction !== undefined ? { faction } : {}), roll })
      if (!r) return // 沒有任何可用的戰敗事件：不留等待中的戰敗，玩家還是可以重來
      const s = settle(bk, state, r.entry, r.version)
      const value: PendingDefeat = {
        event: r.entry.id, version: r.version, ...(faction !== undefined ? { faction } : {}), outcome,
        fails_commission: r.entry.fails_commission, lines: s.lines, choices: ['accept', 'retry', 'stage'],
        view: state.rules.defeatView, skipped: true, battle: battle.id,
      }
      return { changes: [{ op: 'ext', key: EXT, value }] }
    })

    k.hooks.on('report.after', OWNER, ({ state, report }) => {
      if (report.action !== 'battle.end') return
      if (report.outcome.result !== 'lose' && report.outcome.result !== 'surrender') return
      const pending = defeatOf(state)
      if (!pending) return
      const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
      const v = entry?.versions[pending.version] ?? entry?.versions.default
      return [{
        kind: 'event', action: 'defeat.pending', location: clone(report.location), party: [], timeline: [],
        changes: [],
        outcome: { result: 'defeat', summary: v?.text ?? '你輸了。' },
        narration: { results: pending.lines },
      }]
    })
  },
  ready(k) {
    const defaults = k.content.list<DefeatEventEntry>(KIND).filter((e) => e.default === true)
    if (defaults.length > 1) throw new Error(`戰敗事件的 default: true 整份內容裡最多一筆（現在有 ${defaults.map((e) => e.id).join('、')}）。`)
  },
}
