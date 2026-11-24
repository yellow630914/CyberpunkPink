// L6 功能 hack：快駭的追蹤度與敵對值（M3-hack-net；dev/adr/0018 第十一節、E9；NETRUNNING 第 5 節；ITEMS 11.9「追蹤與敵對值」）。
//   內海：我方每用一次快駭（不論成敗），追蹤度加那支程式的 trace，經戰鬥效果 net.trace；沒有人註冊那個效果、或這一場沒有追蹤度（battle.field.trace 不是數字）就不加。
//   現實：不加追蹤度。記下「被發現」的份：
//     - 檢定失敗的當場算：加在做的人身上（unit.ext.hack.found）；
//     - 成功的，記在被打的人身上（unit.ext.hack.noticed），戰鬥結束時他還在場上（沒倒下、沒被制伏、沒逃走）才算；
//     - 對自己人、自己用的支援類不算；打在掛著的東西（無人機、砲塔）或控制節點上的，成功不算（沒有人看見），失敗照算。
//     戰鬥結束（k.battle.onEnd）把這些 trace 加總，給那個勢力的敵對值（效果 hostility，內建的來源）：勢力是 origin.faction，沒有就是所在那一區資料的第一個勢力，
//     都沒有、或沒有人註冊 hostility 就不給；結束的報告多一句（不帶數字）。
//   技能做的快駭（帶 hack 標籤、不是這個功能註冊的行動）同一條：action.done 看標籤，trace 讀技能資料（內容種類 ability）的 trace，沒寫是 0。
// 檢定的結果由 hack.check 記在做的人身上（ext.hack.checks，每個行動做完就清掉），這裡只讀。狀態都在戰鬥狀態裡，存檔與回退才對得上。
// 不 import 別的功能：net.trace 與 hostility 只經登錄表查有沒有。

import type { BattleTarget, BattleUnit, Kernel } from '../../core'
import { effectCtx, isRecord, modeOf } from '../../core'
import { OWNER } from './deck'
import type { QuickhackEntry } from './kinds'

/** 戰鬥效果：追蹤度加減（netcombat 註冊；沒裝就不加）。 */
export const TRACE_EFFECT = 'net.trace'
/** 敵對值的效果種類（量表自動註冊；沒有人定義量表時不給）。 */
export const HOSTILITY_EFFECT = 'hostility'
/** 技能的內容種類（abilities 註冊；沒裝就沒有技能做的快駭）。 */
const ABILITY_KIND = 'ability'

interface CheckNote {
  ok: boolean
}

const hackExt = (u: BattleUnit): Record<string, unknown> => {
  if (!isRecord(u.ext.hack)) u.ext.hack = {}
  return u.ext.hack as Record<string, unknown>
}
const numberAt = (u: BattleUnit, key: 'found' | 'noticed'): number => {
  const v = isRecord(u.ext.hack) ? u.ext.hack[key] : undefined
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** hack.check 做完時記一筆結果（有對象的檢定才記；對自己、一格沒有東西可以對的不記）。行動做完時由 action.done 讀並清掉。 */
export function noteCheck(user: BattleUnit, ok: boolean, _at: BattleTarget): void {
  const ext = hackExt(user)
  const list = Array.isArray(ext.checks) ? (ext.checks as CheckNote[]) : []
  list.push({ ok })
  ext.checks = list
}

/** 這個行動的 trace：這個功能自己的程式讀 quickhack 的 trace；技能做的快駭讀技能資料的 trace（layer 給了先看那一欄的 trace）。沒寫、不是正數是 0。 */
export function traceOfAction(k: Pick<Kernel, 'battle' | 'content'>, action: string, layer?: string): number {
  const def = k.battle.getAction(action)
  let raw: unknown
  if (def?.owner === OWNER) raw = k.content.get<QuickhackEntry>('quickhack', action.slice(`${OWNER}.`.length))?.trace
  else if (k.content.hasKind(ABILITY_KIND)) {
    // 技能的資料：先看這一層的那一欄（meat.trace、net.trace；M3-skill-net-a：兩欄各寫各的），沒寫再看技能本身的 trace
    const ab = k.content.get(ABILITY_KIND, action) as ({ trace?: unknown } & Record<string, unknown>) | undefined
    const col = layer ? ab?.[layer] : undefined
    raw = isRecord(col) && col.trace !== undefined ? col.trace : ab?.trace
  }
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/** 現實戰鬥結束時，這場的勢力：origin.faction，沒有就是所在那一區資料的第一個勢力。'none' 或查不到是 undefined。 */
function factionOf(k: Pick<Kernel, 'content'>, state: { location: { district?: string } }, origin: { faction?: string }): string | undefined {
  if (origin.faction !== undefined) return origin.faction && origin.faction !== 'none' ? origin.faction : undefined
  const d = state.location.district
  if (!d || !k.content.hasKind('district')) return undefined
  const f = (k.content.get('district', d) as { factions?: unknown } | undefined)?.factions
  const first = Array.isArray(f) ? f.find((x): x is string => typeof x === 'string' && x.length > 0) : undefined
  return first
}

export function registerTrace(k: Kernel): void {
  k.battle.on('action.done', OWNER, ({ run, unit, action, tags, target }) => {
    // 這個行動的檢定結果：讀完就清（不是快駭的行動也清，不讓舊的留到下一個行動）
    const ext = isRecord(unit.ext.hack) ? unit.ext.hack : undefined
    const checks = ext && Array.isArray(ext.checks) ? (ext.checks as CheckNote[]) : []
    if (ext) delete ext.checks
    if (!tags.includes('hack') || unit.side !== 'ally') return
    const layer = run.mode.layer
    const trace = traceOfAction(run.k, action, layer)
    if (trace <= 0) return
    if (layer === 'net') {
      // 內海：每用一次（不論成敗）追蹤度加 trace。沒有人註冊 net.trace，或這一場沒有追蹤度，就不加
      if (run.k.battle.getEffect(TRACE_EFFECT) && !run.over) {
        run.effects([{ op: TRACE_EFFECT, amount: trace, who: 'self' }], { user: unit, source: { kind: 'hack', id: action, name: run.k.battle.getAction(action)?.name ?? action }, target: null })
      }
      return
    }
    if (layer !== 'meat') return
    // 現實：檢定失敗當場算
    if (checks.some((c) => !c.ok)) {
      hackExt(unit).found = numberAt(unit, 'found') + trace
      return
    }
    // 成功的記在被打的人身上（對自己人不算）；結束時他還在場上才算
    const t = target && 'unit' in target ? run.battle.units[target.unit] : undefined
    if (t && t.side !== unit.side && !run.isStandIn(t)) hackExt(t).noticed = numberAt(t, 'noticed') + trace
  })

  k.battle.onEnd(OWNER, ({ k: kernel, state, battle }) => {
    if (modeOf(kernel.content, battle.mode)?.layer !== 'meat') return
    let total = 0
    for (const u of Object.values(battle.units)) {
      if (u.side === 'ally') total += numberAt(u, 'found')
      else if (!u.out) total += numberAt(u, 'noticed')
    }
    if (total <= 0 || !kernel.effects.has(HOSTILITY_EFFECT)) return
    const faction = factionOf(kernel, state, battle.origin)
    if (!faction) return
    const res = kernel.effects.resolve([{ kind: HOSTILITY_EFFECT, key: faction, amount: total }], effectCtx(kernel, state, { source: 'builtin' }))
    if (res.errors.length > 0) return
    const name = (kernel.content.hasKind('faction') ? (kernel.content.get('faction', faction) as { name?: unknown } | undefined)?.name : undefined)
    return { changes: res.changes, lines: [`快駭的手法被${typeof name === 'string' && name ? name : '對方'}認出來了，他們對你更不友善了`] }
  })
}
