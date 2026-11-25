// L6 功能 npcs 的建角（M4-creation-lifepath；CHARACTER 第 3 節、5.5 節；NPC_SYSTEM 4.1 節；dev/adr/0019 第十一節）。
//
// 掛點 creation.step 的 lifepath（第 5 步，features/creation 宣告；這裡只認名字與格式，不 import）：回答 picks 裡帶 npc 的那幾條。
//   npc: { role, faction_from?, affinity?, hostility?, roster? }
//   生成一個人（照 NPC_SYSTEM 4.1 節的步驟；名字由程式產生；勢力照 faction_from：'origin' 是出身給好感的那個勢力，payload.favor），
//   提交時：存進生成人的資料、變成角色、認識（建關係條目）、進名單（升格）、記一句關係、親密度照資料寫的。
//   hostility：帶著敵對值——所屬勢力的敵對值加這麼多（那個量表是別的功能定義的，沒裝或這個人沒有勢力時寫進提醒）；生成的人也記一個旗標 lifepath:<role>。
//   roster: true：把這個人的 id 交給 creation 寫進主角的 ext.origin.roster（roster 在 creation.commit 之後把那一欄的人放進名冊）。
// 這個功能只用 notes 說明沒做成的事，不擋草稿（內容的格式在載入時已經查過）。

import type { Actor, Change, GameState, Kernel, OriginEntry } from '../../core'
import { clone, isRecord } from '../../core'
import { generateNpc, takenNames } from './generate'
import type { Npc } from './model'
import { AFFINITY } from './model'

interface Payload { state: GameState; draft: { origin?: string }; step: string; picks: unknown[]; favor?: string }
interface Answer { took: number[]; changes?: Change[]; roster?: string[]; notes?: string[] }

const ROLES = { family: '家人', friend: '朋友', enemy: '仇人', ex: '舊情人' } as const
type Role = keyof typeof ROLES
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** 生成的人的 id：每張表最多一位，所以用表的名字。 */
export const lifepathNpcId = (table: string): string => `gen_lp_${table}`

/** 這個人住在哪一區：出身的住處是一個街區或一區的 id 就用它，查不到用現在站的那一區，再沒有就是空的（不進任何一區的名單）。 */
function homeDistrict(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'location'>, originId: string | undefined): string {
  const home = originId === undefined ? undefined : k.content.get<OriginEntry>('origin', originId)?.home
  if (isText(home)) {
    const block = k.content.get('block', home)
    if (block && isText(block.district)) return block.district
    if (k.content.has('district', home)) return home
  }
  return state.location.district ?? ''
}

export function answerCreation(k: Kernel, p: Payload, deps: { buildActor: (n: Npc) => Actor }): Answer | void {
  if (p.step !== 'lifepath') return
  const took: number[] = []
  const changes: Change[] = []
  const roster: string[] = []
  const notes: string[] = []
  const taken = takenNames(k, p.state)
  const names = new Set<string>()
  const district = homeDistrict(k, p.state, p.draft.origin)

  p.picks.forEach((pick, index) => {
    if (!isRecord(pick) || !isRecord(pick.npc)) return
    took.push(index)
    const spec = pick.npc
    const text = isText(pick.text) ? pick.text : '生命軌跡的一條'
    const role = spec.role as Role
    if (!Object.hasOwn(ROLES, role)) {
      notes.push(`「${text}」的人物角色不認得，沒有生成。`)
      return
    }
    const table = isText(pick.table) ? pick.table : role

    // 勢力：'origin' 是出身給好感的那一個；寫明的要查得到
    let faction: string | undefined
    if (spec.faction_from === 'origin') faction = p.favor
    else if (isText(spec.faction_from)) faction = spec.faction_from
    if (faction !== undefined && !k.content.has('faction', faction)) {
      notes.push(`「${text}」的人物所屬的勢力查不到，這個人沒有勢力。`)
      faction = undefined
    }

    const id = lifepathNpcId(table)
    const npc = generateNpc(k, p.state, district, `lifepath:${table}`, { id, kind: 'citizen', ...(faction !== undefined ? { faction } : {}), taken })
    if (!npc) {
      notes.push(`「${text}」的人物沒有生成：內容篩選把可以生成的性別都關掉了。`)
      return
    }
    // 這一區沒有名字池時生成的名字都是同一個通用的稱呼：同一批裡不重複，加編號
    if (names.has(npc.name)) npc.name = `${npc.name}${names.size + 1}`
    names.add(npc.name)
    npc.flags = [...npc.flags, `lifepath:${role}`]

    const at: { district?: string; block?: string } = {}
    if (p.state.location.district !== undefined) at.district = p.state.location.district
    if (p.state.location.block !== undefined) at.block = p.state.location.block
    changes.push(
      { op: 'npcs.gen', npc: clone(npc) },
      { op: 'actor.add', actor: deps.buildActor(npc) },
      { op: 'npcs.meet', npc: id, time: clone(p.state.time), at },
      { op: 'npcs.promote', npc: id },
      { op: 'npcs.relation', npc: id, text: ROLES[role] },
    )
    if (isInt(spec.affinity) && spec.affinity !== 0) changes.push({ op: 'meter', kind: AFFINITY, key: id, delta: spec.affinity })
    if (isInt(spec.hostility) && spec.hostility > 0) {
      if (faction === undefined) notes.push(`「${text}」的${ROLES[role]}沒有所屬的勢力，敵對值沒有地方記。`)
      else if (!k.meters.has('hostility')) notes.push(`「${text}」的${ROLES[role]}帶著敵對值，但這一局沒有記敵對值的功能，沒有算。`)
      else changes.push({ op: 'meter', kind: 'hostility', key: faction, delta: spec.hostility })
    }
    if (spec.roster === true) roster.push(id)
  })

  return took.length > 0 ? { took, changes, roster, notes } : undefined
}

export type LifepathAnswerer = typeof answerCreation
