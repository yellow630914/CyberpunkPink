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
    for (const s of merged.signature ?? []) {
      if (typeof s !== 'string') continue
      const ab = k.content.get('ability', s)
      if (ab && ab.enemy !== true) problems.push(`enemy/${e.id}：招牌行動 ${s} 不是敵人的招牌行動（技能要標 enemy: true）`)
    }
  }
  if (problems.length) throw new Error(`敵人的招牌行動檢查沒過（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
}
