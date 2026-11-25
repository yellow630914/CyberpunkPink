// 招牌行動的檢查：signature 寫成字串的，要是標了 enemy 的技能（M1b-enemy-moves 第二節）；附屬單位（attached）要是 overlay 的兵種（M1b-enemy-units）。
// 查不到那個 id 由引用檢查擋下（kinds.ts 的 refs）；寫成 { name, text } 的敘述不查。

import type { Kernel } from '../../core'
import { resolveEnemy } from './kinds'
import type { EnemyEntry } from './kinds'

export function checkSignatures(k: Pick<Kernel, 'content'>): void {
  const problems: string[] = []
  for (const e of k.content.list<EnemyEntry>('enemy')) {
    let merged: EnemyEntry
    try { merged = resolveEnemy(k.content, e.id) } catch { continue }
    // 附屬單位要是 overlay 的兵種（掛在格上的一台）
    for (const a of merged.attached ?? []) {
      let att: EnemyEntry | undefined
      try { att = resolveEnemy(k.content, a.enemy) } catch { continue }
      if (att.position.size !== 'overlay') problems.push(`enemy/${e.id}：附屬單位 ${a.enemy} 不是 overlay 的兵種（position.size 要是 'overlay'）`)
    }
    // 雙形象：每個形象寫的招牌行動（moves 的鍵）要是這個敵人招牌行動裡的技能 id
    const ids = (merged.signature ?? []).filter((x): x is string => typeof x === 'string')
    const moveSets: Array<[string, Record<string, unknown> | undefined]> = [['forms.a', merged.forms?.a.moves], ['forms.b', merged.forms?.b.moves], ['neutral', merged.neutral?.moves]]
    for (const [at, moves] of moveSets) for (const id of Object.keys(moves ?? {})) if (!ids.includes(id)) problems.push(`enemy/${e.id}：${at}.moves 寫了 ${id}，但它不是這個敵人的招牌行動（signature 裡沒有這個技能）`)
    for (const s of merged.signature ?? []) {
      if (typeof s !== 'string') continue
      const ab = k.content.get('ability', s)
      if (ab && ab.enemy !== true) problems.push(`enemy/${e.id}：招牌行動 ${s} 不是敵人的招牌行動（技能要標 enemy: true）`)
    }
  }
  if (problems.length) throw new Error(`敵人的招牌行動檢查沒過（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
}
