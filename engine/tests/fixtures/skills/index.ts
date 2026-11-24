// 內海欄的測試資料：槍手、潛網者、改造師、機師（M3-skill-net-a）。每棵樹 27 個技能與 5 個共鳴；現實欄與輿論欄是 null。
// NET_TREES 是四棵樹；netPack 把它們組成一份內容包（path 與 ability 兩種內容種類）。

import type { Tree } from './util'
import { GUNNER } from './gunner'
import { MEDIC } from './medic'
import { NETRUNNER } from './netrunner'
import { PILOT } from './pilot'

export type { SkillNote, Status, Tree } from './util'
export { GUNNER, MEDIC, NETRUNNER, PILOT }

export const NET_TREES: Record<string, Tree> = { gunner: GUNNER, netrunner: NETRUNNER, medic: MEDIC, pilot: PILOT }

/** 內容包：每棵樹的路數與技能（深拷貝：測試改它不會動到這份資料）。 */
export function netPack(trees: Tree[] = Object.values(NET_TREES), id = 'skill_net_a'): { id: string; content: { path: unknown[]; ability: unknown[] } } {
  return structuredClone({ id, content: { path: trees.map((t) => t.path), ability: trees.flatMap((t) => t.abilities) } })
}
