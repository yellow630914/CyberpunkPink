// L6 craft 的組裝（CRAFTING 10.1 節；TRADE 3.4 節；dev/adr/0019 第四節與 P16；dev/work/M4-craft.md）。
// 改狀態的入口是匯出一個純函式、回傳報告草稿：assembleDraft 不成立丟 ActionBlocked（原因一條一句，assembleProblems 列全部、assembleBlock 回第一條）。
//
// 四種人（規則表 craft_rule.makers）：
//   self     自己或隊友：不收錢、要擲技術檢定（義體用義體學、武器與護甲用機械、全生體用醫療）。四級結果：
//              大成功 精工（quality: fine；bonus 加在 stats 合計最高的那一個鍵 +1，義體改成 bonus: { sink: -1 }）；成功 照規格；
//              失敗 能用但帶瑕疵（quality: flawed、多一筆 quirk，pool 含 flaw、applies 對得上的）；大失敗 燒掉一個零件（有超規的燒超規的，否則照種子抽），成品沒有、其餘零件還在
//   shop     店家：工錢設計圖等級 ×100、一定成功、不做超規、會登記
//   doujin   同人社團：工錢等級 ×60、一定成功、願意超規；照 quirk_chance 多一筆 pool 含 doujin 的 quirk，有的話成品 state 是 doujin（TRADE 3.4：「成品可能多一個怪癖」）
//   factory  原廠：工錢等級 ×150（暫定）、一定成功而且是精工、只收自己牌子的全套
// 骰子一律用 deriveRng（用途帶新成品的 uid）：重新讀檔重擲、結果不變；擲過骰的報告多一筆 { op: 'rng', advance: 1 }，同一組零件失手之後再試才會換新的骰面。
// 寫進狀態：用掉的零件拿掉（沒有實例資料的照 id、有的照 uid）、多一疊成品（id 是設計圖、data 是 ProductData、uid 用核心的流水號 pr<N>）、扣工錢、時間加 minutes。
// 零件放進成品：registered 的是 id；未登錄零件（背包那一疊的 data.part）是那一整筆，不改內容（M4-plan 規定 10）。

import type { ActorId, Change, CheckRoll, GameState, Kernel, ProductData, QuirkEntry, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, clone, deriveRng, rollCheck } from '../../core'
import type { Picked, PreviewOpts } from './preview'
import { planAssembly } from './preview'
import { ASSEMBLE_ACTION, MAKER_NAME, nameOf } from './model'

/** 新成品的 uid 前綴（核心的流水號 seq.uid ＋ 1）。 */
export const PRODUCT_UID_PREFIX = 'pr'

export type AssembleOpts = PreviewOpts

/** 組裝現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const assembleProblems = (k: Kernel, state: GameState, o: AssembleOpts): string[] => planAssembly(k, state, o).preview.problems
/** 組裝現在行不行：第一條原因；行是 null。 */
export const assembleBlock = (k: Kernel, state: GameState, o: AssembleOpts): string | null => planAssembly(k, state, o).preview.block

/** 某一種怪癖的池：quirk 裡 pool 有這一池、而且 applies 對得上這張設計圖的種類（照內容載入的順序）。 */
export function quirkPool(k: Kernel, pool: 'flaw' | 'doujin', kind: string): QuirkEntry[] {
  if (!k.content.hasKind('quirk')) return []
  return k.content.list<QuirkEntry>('quirk').filter((q) => Array.isArray(q.pool) && q.pool.includes(pool) && (!q.applies || (q.applies as string[]).includes(kind)))
}

/**
 * 精工的 bonus：義體是沉溺成本 −1；武器與護甲是玩家指名的那一個鍵 +1（polish，要是 stats 裡有的鍵），沒指名就是 stats 合計最高的那一個鍵
 * （一樣高的取前面那個；沒有任何鍵就沒有）。
 */
export function fineBonus(kind: string, stats: Record<string, number>, polish?: string): Record<string, number> | undefined {
  if (kind === 'cyberware') return { sink: -1 }
  if (polish !== undefined && Object.hasOwn(stats, polish)) return { [polish]: 1 }
  let best: string | undefined
  for (const [key, v] of Object.entries(stats)) if (best === undefined || v > stats[best]!) best = key
  return best === undefined ? undefined : { [best]: 1 }
}

/** 這些零件從背包拿走的變更：沒有實例資料的照 id 合併成一筆，有的照 uid 各一筆。 */
function takeChanges(picks: readonly Picked[]): Change[] {
  const plain = new Map<string, number>()
  const out: Change[] = []
  for (const p of picks) {
    if (p.plain) plain.set(p.stack.id, (plain.get(p.stack.id) ?? 0) + 1)
    else out.push({ op: 'item', id: p.stack.id, qty: -1, data: { uid: p.stack.data!.uid } })
  }
  return [...[...plain].map(([id, qty]): Change => ({ op: 'item', id, qty: -qty })), ...out]
}

/**
 * 組一件。不成立丟 ActionBlocked（assembleProblems 的第一條）。
 * 報告 craft.assemble：outcome.result 是 fine、standard、flawed、burned（大失敗）或 doujin（同人多了怪癖）。
 */
export function assembleDraft(k: Kernel, state: GameState, o: AssembleOpts): ReportDraft {
  const plan = planAssembly(k, state, o)
  const pv = plan.preview
  if (pv.problems.length > 0 || !plan.bp || !plan.data || !plan.info) throw new ActionBlocked(pv.problems[0] ?? '現在組不了。')
  const { bp, rules, maker, by, picks, info, polish } = plan
  const mr = rules.makers[maker]
  const uid = `${PRODUCT_UID_PREFIX}${state.seq.uid + 1}`
  const purpose = `${ASSEMBLE_ACTION}/${uid}`

  let roll: CheckRoll | undefined
  let rolled = false
  let degree: 'critical' | 'success' | 'fail' | 'fumble' = 'success'
  if (mr.check) {
    const c = pv.check!
    roll = rollCheck(k.stats, state, {
      actor: by, attr: c.attr, skill: c.skill, dc: c.dc, purpose, tags: ['craft', bp.kind],
      ...(c.workshop ? { situation: [{ label: '工坊', value: rules.workshop_bonus, source: 'situation' }] } : {}),
    })
    rolled = true
    degree = roll.degree
  } else if (mr.fine) degree = 'critical'

  const changes: Change[] = []
  const lines: string[] = []
  const who = mr.check ? nameOf(state, by) : MAKER_NAME[maker]
  const data: Record<string, unknown> = { bp: bp.id, maker, by, uid, degree, minutes: pv.minutes }
  let result: string

  if (degree === 'fumble') {
    // 燒掉一個零件：有超規的燒超規的那一個，否則照種子抽；成品沒有、其餘零件還在
    const over = picks.filter((p) => p.overspec)
    const pool = over.length > 0 ? over : picks
    const burned = deriveRng(state.rng, `${purpose}/burn`).pick(pool)
    changes.push(...takeChanges([burned]), { op: 'time', minutes: pv.minutes })
    lines.push(`${who}組${bp.name}的時候失了手，${burned.part.name}燒壞了，成品沒有做成，其餘的零件還在。`)
    Object.assign(data, { burned: burned.part.id })
    result = 'burned'
  } else {
    const product: ProductData = { ...clone(plan.data), uid, quality: degree === 'critical' ? 'fine' : degree === 'fail' ? 'flawed' : 'standard', state: 'new' }
    const quirks: string[] = []
    let quirkName: string | undefined
    result = product.quality!
    if (degree === 'critical') {
      const bonus = fineBonus(bp.kind, info.stats, polish)
      if (bonus) product.bonus = bonus
      lines.push(`${who}把${bp.name}組成了精工，每個接點都咬得很準。`)
    } else if (degree === 'fail') {
      const pool = quirkPool(k, 'flaw', bp.kind)
      if (pool.length > 0) {
        const pick = deriveRng(state.rng, `${purpose}/flaw`).pick(pool)
        quirks.push(pick.id)
        quirkName = pick.name
      }
      lines.push(`${who}把${bp.name}組出來了，不過能用歸能用，有個地方沒有咬準。`)
    } else {
      lines.push(`${who}把${bp.name}組好了，和規格一樣。`)
    }
    if (mr.quirk_chance > 0) {
      rolled = true
      if (deriveRng(state.rng, `${purpose}/doujin`).chance(mr.quirk_chance)) {
        const pool = quirkPool(k, 'doujin', bp.kind).filter((q) => !quirks.includes(q.id))
        if (pool.length > 0) {
          const pick = deriveRng(state.rng, `${purpose}/doujin_quirk`).pick(pool)
          quirks.push(pick.id)
          quirkName = pick.name
          product.state = 'doujin'
          result = 'doujin'
          lines.push('社團照自己的習慣動了點手腳，成品多了一點脾氣。')
        }
      }
    }
    if (quirks.length > 0) product.quirks = quirks
    changes.push(...takeChanges(picks), { op: 'item', id: bp.id, qty: 1, data: product as unknown as Record<string, unknown> }, { op: 'uid', advance: 1 }, { op: 'time', minutes: pv.minutes })
    Object.assign(data, { quality: product.quality, ...(product.bonus ? { bonus: product.bonus } : {}), ...(quirks.length > 0 ? { quirks, quirk: quirkName ?? null } : {}), state: product.state })
  }
  if (pv.fee > 0 && pv.pay) changes.push({ op: pv.pay, delta: -pv.fee })
  if (rolled) changes.push({ op: 'rng', advance: 1 })
  Object.assign(data, { fee: pv.fee })

  const actor: ActorId = state.pc ?? by
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: mr.check ? by : actor, text: lines[0]!, tag: ASSEMBLE_ACTION, data }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'craft.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor, text, tag: 'craft.note' })
  return {
    kind: 'action', action: ASSEMBLE_ACTION, location: clone(state.location), actor: mr.check ? by : actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') },
    narration: { results: lines },
  }
}
