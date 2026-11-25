// L6 功能 enemies：內海面的小東西（M3-lace）——規則表 net_enemy_rule（憑證是哪一件物品）、AI 的偏好（打深檔的人）、白蕾絲的撤走。
// 規格：ENEMIES 第 9 節；dev/adr/0018 第四節、N20。單位怎麼組在 stats.ts，掉落在 loot.ts，挑兵種在 pick.ts。
// 不 import features/netcombat、features/deck：同步檔位只看單位身上的 sync:<檔> 標籤，追蹤度只看 battle.field.trace 這個數字，構裝與憑證只經 k.content。

import type { ContentEntry, ContentRegistry, Kernel, RollPart } from '../../core'
import { isRecord } from '../../core'
import { DEEP_SYNC_PCT, WHITE_LEAVES_AT } from './curve'
import { OWNER } from './kinds'

/** 規則表的內容種類（id: default；後載入的包可以取代，dev/adr/0017）。 */
export const NET_RULE_KIND = 'net_enemy_rule'

export interface NetEnemyRule extends ContentEntry {
  /** 網內的敵人與企業的人掉的「憑證」是哪一件物品（item 的 id）；不寫或內容裡沒有就不掉憑證 */
  credential_item?: string
  /** 雙形象：這一場擲到形象 B 的機率，0～1（M4-enemies-m4；CYBERSPACE 8.7 節，暫定 0.6）。沒寫用 DEFAULT_FORM_B_CHANCE */
  form_b_chance?: number
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (key !== 'id' && key !== 'credential_item' && key !== 'form_b_chance') p.push(`${key}：沒有這個欄位（可以寫的：credential_item、form_b_chance）`)
  if (e.credential_item !== undefined && !isText(e.credential_item)) p.push('credential_item 要是物品的 id')
  if (e.form_b_chance !== undefined && !(typeof e.form_b_chance === 'number' && e.form_b_chance >= 0 && e.form_b_chance <= 1)) p.push('form_b_chance 要是 0～1 的數字（雙形象擲到形象 B 的機率）')
  return p
}

/** 憑證是哪一件物品：規則表有寫、而且內容裡有這個物品才算；否則是 undefined（掉落略過）。 */
export function credentialItem(content: ContentRegistry): string | undefined {
  const id = content.get<NetEnemyRule>(NET_RULE_KIND, 'default')?.credential_item
  return isText(id) && content.has('item', id) ? id : undefined
}

/** 單位身上的 sync:<檔> 標籤（netcombat 維持）；沒有是 undefined。 */
const gearTag = (tags: readonly string[]): string | undefined => tags.find((t) => t.startsWith('sync:'))?.slice(5)

export function registerLace(k: Pick<Kernel, 'content' | 'battle'>): void {
  k.content.defineKind<NetEnemyRule>({
    kind: NET_RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems,
    refs: (e) => (isText(e.credential_item) ? [['item', e.credential_item]] : []),
  })

  // 偏好深檔的敵人（資料的 ai.prefer_deep_sync）：挑目標時，候選人在深檔 +50、全檔 +100（問的是候選人，other 是正在挑的 AI）
  k.battle.modifier(OWNER, (q): RollPart[] => {
    if (q.kind !== 'ai_target_pct' || !q.other || q.view.mode.layer !== 'net') return []
    const ai = q.other.ai
    if (!ai || !isRecord(ai.ext) || ai.ext.preferDeepSync !== true) return []
    const gear = gearTag(q.unit.tags)
    const pct = gear === 'deep' ? DEEP_SYNC_PCT.deep : gear === 'full' ? DEEP_SYNC_PCT.full : 0
    return pct ? [{ label: '偏好深檔的人', value: pct, source: 'ai' }] : []
  })

  // 白蕾絲：戰鬥裡的追蹤度到 60 以上，自己的回合開始就撤走（ENEMIES 第 9 節）
  k.battle.on('turn.start', OWNER, ({ run, unit, lost }) => {
    if (lost || unit.out || run.mode.layer !== 'net' || !unit.tags.includes('lace:white')) return
    const trace = run.battle.field.trace
    if (typeof trace !== 'number' || trace < WHITE_LEAVES_AT) return
    run.say(`${unit.name}看追蹤度夠高了，抽身離開。`, 'field', { unit: unit.id, kind: 'white_leave', trace })
    run.setOut(unit, 'fled')
  })
}
