// 自己發起一場戰役（OPINION 第 8 節；dev/adr/0020 V34）：只給議題的類型與目標勢力（{ kind, faction, people?, types? }），
// 從預設的分數表組一個議題（開場時隨機挑一列），等級照那個勢力的 grade；沒指定對手就找 pr_opponent 裡 faction 對得上的，沒有就用規則表的通用公關（強度照等級）。
// 沒有委託人、沒有報酬——得到的是訂閱、公信力，以及對世界的改變（後果在 after.ts）。

import type { Kernel } from '../../core'
import { ActionBlocked, isRecord, isSafeInt } from '../../core'
import type { OpponentEntry, TopicEntry } from './model'
import { KIND_IDS, OPPONENT_KIND, isCellKey, opinionRules, opponentProblems, topicKinds } from './model'

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }

/** 勢力的等級（資料的 grade：1～5 或 I～V）；沒寫是 null。 */
export function factionGrade(k: Pick<Kernel, 'content'>, faction: string): number | null {
  const g = k.content.hasKind('faction') ? (k.content.get<{ id: string; grade?: unknown }>('faction', faction)?.grade) : undefined
  if (typeof g === 'string' && Object.hasOwn(ROMAN, g)) return ROMAN[g]!
  return isSafeInt(g) && g >= 1 && g <= 5 ? g : null
}

/** setup.topic 是不是「只給類型與勢力」的寫法。 */
export const isSelfTopic = (raw: unknown): raw is Record<string, unknown> =>
  isRecord(raw) && typeof raw.faction === 'string' && raw.name === undefined && raw.scores === undefined && raw.involves === undefined

/** 從類型與勢力組一個議題（分數留空：開場時從預設的分數表挑一列）。 */
export function selfTopic(k: Kernel, raw: Record<string, unknown>): TopicEntry {
  const kind = raw.kind
  if (typeof kind !== 'string' || !(KIND_IDS as readonly string[]).includes(kind)) throw new ActionBlocked(`自己發起的議題要寫類型（${KIND_IDS.join('、')} 其中一個）。`)
  const faction = raw.faction as string
  if (faction.trim() === '') throw new ActionBlocked('自己發起的議題要寫目標勢力。')
  const strs = (v: unknown, what: string): string[] => {
    if (v === undefined) return []
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x !== '')) throw new ActionBlocked(`${what}要是字串的陣列。`)
    return [...(v as string[])]
  }
  if (kind === 'frame' && !isCellKey(raw.target_cell)) throw new ActionBlocked('嫁禍要指定一格（target_cell）。')
  const kindName = topicKinds(k).find((e) => e.id === kind && e.layout !== undefined)?.name ?? kind
  const name = k.content.hasKind('faction') ? (k.content.get<{ id: string; name?: string }>('faction', faction)?.name ?? faction) : faction
  const grade = raw.grade !== undefined ? (raw.grade as number) : (factionGrade(k, faction) ?? 1)
  if (!isSafeInt(grade) || grade < 1 || grade > 5) throw new ActionBlocked('戰役的等級要是 1～5 的整數。')
  return {
    id: `self_${kind}_${faction}`, name: `${kindName}：${name}`, kind: kind as TopicEntry['kind'], scores: {}, grade,
    involves: { factions: [faction], people: strs(raw.people, 'people'), types: strs(raw.types, 'types') },
    ...(raw.target_cell !== undefined ? { target_cell: raw.target_cell as string } : {}),
  }
}

/** 沒給對手時：pr_opponent 裡 faction 對得上的第一筆，沒有就是規則表的通用公關（強度照等級）。 */
export function foeFor(k: Kernel, faction: string | undefined, grade: number): OpponentEntry {
  if (faction !== undefined && k.content.hasKind(OPPONENT_KIND)) {
    const found = k.content.list<OpponentEntry>(OPPONENT_KIND).find((e) => e.faction === faction)
    if (found) return found
  }
  const g = opinionRules(k).generic
  const generic: Record<string, unknown> = {
    id: 'pr_generic', name: '通用公關', ...(faction !== undefined ? { faction } : {}), strength: g.strength[grade - 1] ?? 1, start: 'opposite', cell_priority: {}, actions: g.actions.map((a) => ({ ...a })),
  }
  const problems = opponentProblems(generic)
  if (problems.length > 0) throw new ActionBlocked(`通用公關的資料不合格：${problems.join('；')}。`)
  return generic as unknown as OpponentEntry
}
