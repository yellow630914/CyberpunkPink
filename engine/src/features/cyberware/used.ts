// L6 功能 cyberware 的二手貨（CYBERWARE 第 5 節「二手貨」；dev/adr/0019 P11、P12；dev/work/M4-cyber-lock.md 第 4 條）。
// 裝上一件 state: 'used' 的義體時（installDraft 的同一份報告）：
//   殘響  身上（成品資料與內嵌零件）還沒有 echo 類的 quirk，就從 pool 含 used 的 quirk 抽一筆加上去；
//   惡意韌體  效果登錄表查得到 malware 時，照規則表 used_malware 的機率給一筆 { kind: 'malware', pool: 'used', piece: uid }（M4-malware 的效果；沒裝就略過）。
// 骰子用成品的 uid 當種子（和存檔的亂數游標無關）：同一個 uid 拆下來再裝回去，抽到的還是同一筆；兩種骰子都不推進游標。

import type { ActorId, Change, GameState, Kernel, ProductData, QuirkEntry } from '../../core'
import { Rng, effectCtx, hash32, productOf } from '../../core'
import { cyberRules } from './model'

export const MALWARE_EFFECT = 'malware'
export const USED_POOL = 'used'

/** 抽殘響的池：quirk 裡 pool 有 used、而且適用義體的（照內容載入的順序）。 */
export function echoPool(k: Pick<Kernel, 'content'>): QuirkEntry[] {
  if (!k.content.hasKind('quirk')) return []
  return k.content.list<QuirkEntry>('quirk').filter((q) => Array.isArray(q.pool) && q.pool.includes(USED_POOL) && (!q.applies || q.applies.includes('cyberware')))
}

export interface UsedExtras {
  /** 多加的 quirk（沒有就是 undefined） */
  quirk?: QuirkEntry
  /** 給惡意韌體的變更（沒有就是空的）；惡意韌體是潛伏的，不另外寫一句 */
  changes: Change[]
  malware: boolean
}

/**
 * 一件二手的義體裝上時多出來的東西。data 是裝上去的那一筆成品資料（已經帶著手術併發症的 quirks）；不是二手的回傳空的。
 * 純函式：同一個狀態同一件結果一樣。
 */
export function usedExtras(k: Kernel, state: GameState, actor: ActorId, bpId: string, data: ProductData): UsedExtras {
  const none: UsedExtras = { changes: [], malware: false }
  if (data.state !== 'used') return none
  const rules = cyberRules(k)
  const out: UsedExtras = { changes: [], malware: false }

  const info = productOf(k.content, bpId, data)
  const has = new Set<string>([...(data.quirks ?? []), ...(info?.quirks ?? []).map((q) => q.id)])
  const hasEcho = (info?.quirks ?? []).some((q) => q.kind === 'echo') || (data.quirks ?? []).some((id) => k.content.get<QuirkEntry>('quirk', id)?.kind === 'echo')
  if (!hasEcho) {
    const pool = echoPool(k).filter((q) => !has.has(q.id))
    if (pool.length > 0) out.quirk = new Rng(hash32(state.rng.seed, 'cyber.echo', data.uid)).pick(pool)
  }

  if (rules.used_malware > 0 && k.effects.has(MALWARE_EFFECT)) {
    const hit = new Rng(hash32(state.rng.seed, 'cyber.used_malware', data.uid)).next() < rules.used_malware
    if (hit) {
      const fx = [{ kind: MALWARE_EFFECT, pool: USED_POOL, piece: data.uid }]
      const ctx = effectCtx(k, state, { source: 'builtin', actor })
      if (k.effects.validate(fx, ctx).length === 0) {
        const res = k.effects.resolve(fx, ctx)
        if (res.errors.length === 0) {
          out.changes.push(...res.changes)
          out.malware = true
        }
      }
    }
  }
  return out
}
