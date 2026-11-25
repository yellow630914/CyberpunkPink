// L6 功能：拍賣行（LEWD_SYSTEM 6.2 節「進場」「一場拍賣」「成交」前半；dev/adr/0019 第十八節與 P76、P77、P79、P81、P83、P84；dev/work/M4-auction.md）。
//
// 一家拍賣行是內容的一筆（白槌、伊甸園樂園 2F 只賣契約的那一場，都用同一種格式）；每週的目錄與競標者由程式照「拍賣行＋場次」抽（不存，同一場問幾次都一樣）；
// 會員看好感（每次現算）或推薦函（存）；停權是一個到期的時間；預展可以檢定看貨（一件一次，不必是會員）。這一張只做到預展；進場與競價是下一張（M4-auction-bid）。
// 鑑定書用拍品資料的一句、主持人的口白用程式的句子，不叫 AI（P84）。寄存武器與掃描義體不做機制（P82）。
//
// 接上核心的地方：
//   內容  auction_house（開槌的星期與時段、幾件、賣哪幾種、會員怎麼算）、auction_lot（拍品池）、auction_bidder（競標者）、auction_rule（規則表，overridable，id: default；DEFAULT_AUCTION_RULES）
//         讀核心的 part、blueprint、item、npc、faction、skill；npc 多讀選填的 auction_ref（true，或拍賣行 id 的陣列）；facility_type（world）多讀選填的 auction: { house }
//   變更  auction.patch（改 state.ext.auction 的一小塊：member、banned、looked、sold、done、run；在套用的那一刻讀現在的狀態）
//   效果  auction_ref { house, by? }（直接給推薦函）、auction_ban { house, days? }（停權，沒寫天數用 ban_days；已經停著的取比較晚的那個）；都是 ai: false，只有內建的來源收
//   條件  auction_member { house }
//   狀態  state.ext.auction = { member, banned, looked, sold, done, run? }（形狀見 model.ts；只經由 auction.patch 寫）
// 讀別人的（不 import）：量表 favor、affinity（meterOf，查不到當 0）；條件 has_favor 與變更 favor.spend（features/favors；沒有人註冊時「用人情換推薦」不列）；
//   條件 at_facility 的設施種類欄位（照 features/rest 讀 sleep 的做法）；k.effects.has('contract_hold')（沒有人註冊時契約不進目錄）；內容篩選 contract_dom。
// 報告（kind action）：auction.ref、auction.inspect。
// 對外：auctionFeature、DEFAULT_AUCTION_RULES、auctionRules、housesHere、sessionOf、catalogOf、catalogView、memberOf、refOptions、refBlock／refDraft、inspectOptions、inspectBlock／inspectDraft。

import type { Change, Condition, Effect, EffectCtx, EffectStepCtx, Feature, GameState, Kernel } from '../../core'
import { ContentError, isRecord, isSafeInt, toMinutes } from '../../core'
import type { BidderEntry, HouseEntry, LookResult, LotEntry, MemberRecord } from './model'
import {
  BAN_EFFECT, BIDDER_KIND, DAY_MINUTES, FACILITY_TYPE_KIND, HOUSE_KIND, LOOK_RESULTS, LOT_KIND, MEMBER_CONDITION, OWNER, PATCH_OP, REF_EFFECT, RULE_KIND,
  auctionOf, auctionRuleProblems, auctionRules, bidderProblems, facilityProblems, houseProblems, isText, lotProblems, npcRefProblems, writeAuction,
} from './model'
import { memberOf } from './member'

export { DEFAULT_AUCTION_RULES, auctionOf, auctionRules, auctionRuleProblems, kindName, lotKey, KIND_NAME, LOT_KINDS, DEFAULT_CERT } from './model'
export type { AuctionRules, AuctionState, BidderEntry, HouseEntry, LookResult, LotEntry, LotKind, MemberRecord } from './model'
export { housesHere, inPreview, sessionAt, sessionOf } from './session'
export type { HouseHere, Session } from './session'
export { LOOK_TEXT, catalogOf, catalogView, lotName, marketOf } from './catalog'
export type { Catalog, CatalogBidder, CatalogLot, CatalogLotView, CatalogView } from './catalog'
export { memberOf, refBlock, refDraft, refNpcs, refOptions, refProblems } from './member'
export type { Membership, RefInput, RefOption, RefPay, RefPayOption } from './member'
export { inspectBlock, inspectDraft, inspectOptions, inspectProblems } from './inspect'
export type { InspectInput, InspectOption } from './inspect'
export { INSPECT_ACTION as AUCTION_INSPECT_ACTION, REF_ACTION as AUCTION_REF_ACTION } from './model'

type PatchChange = Change & {
  member?: Record<string, MemberRecord | null>
  banned?: Record<string, number | null>
  looked?: Record<string, LookResult>
  sold?: string[]
  done?: Record<string, number>
  run?: Record<string, unknown> | null
}

interface RefEffect extends Effect { house: string; by?: string }
interface BanEffect extends Effect { house: string; days?: number }

function patchProblems(c: PatchChange): string[] {
  const p: string[] = []
  if (c.member !== undefined) {
    if (!isRecord(c.member)) p.push('member 要是「拍賣行 → { by?, at } 或 null」')
    else for (const [h, m] of Object.entries(c.member)) if (m !== null && !(isRecord(m) && isSafeInt(m.at) && (m.by === undefined || isText(m.by)))) p.push(`member.${h} 要是 { by?, at } 或 null`)
  }
  if (c.banned !== undefined) {
    if (!isRecord(c.banned)) p.push('banned 要是「拍賣行 → 分鐘 或 null」')
    else for (const [h, n] of Object.entries(c.banned)) if (n !== null && !isSafeInt(n)) p.push(`banned.${h} 要是整數（分鐘）或 null`)
  }
  if (c.looked !== undefined) {
    if (!isRecord(c.looked)) p.push('looked 要是「鍵 → 結果」')
    else for (const [key, r] of Object.entries(c.looked)) if (!(LOOK_RESULTS as readonly unknown[]).includes(r)) p.push(`looked.${key} 要是 ${LOOK_RESULTS.join('、')} 之一`)
  }
  if (c.sold !== undefined && !(Array.isArray(c.sold) && c.sold.every(isText))) p.push('sold 要是拍品 id 的陣列')
  if (c.done !== undefined) {
    if (!isRecord(c.done)) p.push('done 要是「拍賣行 → 場次」')
    else for (const [h, n] of Object.entries(c.done)) if (!isSafeInt(n)) p.push(`done.${h} 要是整數（開槌日的天數）`)
  }
  if (c.run !== undefined && c.run !== null && !isRecord(c.run)) p.push('run 要是物件或 null')
  return p
}

export const auctionFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind<HouseEntry>({
      kind: HOUSE_KIND, owner: OWNER, validate: houseProblems,
      refs: (e) => (e.member?.faction !== undefined ? [['faction', e.member.faction]] : []),
    })
    k.content.defineKind<LotEntry>({
      kind: LOT_KIND, owner: OWNER, validate: lotProblems,
      refs: (e) => [
        ...(e.part !== undefined ? [['part', e.part] as [string, string]] : []), ...(e.blueprint !== undefined ? [['blueprint', e.blueprint] as [string, string]] : []),
        ...(e.item !== undefined ? [['item', e.item] as [string, string]] : []), ...(e.npc !== undefined ? [['npc', e.npc] as [string, string]] : []),
      ],
    })
    k.content.defineKind<BidderEntry>({
      kind: BIDDER_KIND, owner: OWNER, validate: bidderProblems,
      refs: (e) => (e.npc !== undefined ? [['npc', e.npc]] : []),
    })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: auctionRuleProblems })

    // ---- 變更 ----
    k.changes.register<PatchChange>({
      op: PATCH_OP, owner: OWNER,
      validate: (_s, c) => patchProblems(c),
      apply(s, c) {
        const a = auctionOf(s)
        for (const [h, m] of Object.entries(c.member ?? {})) {
          if (m === null) delete a.member[h]
          else a.member[h] = { at: m.at, ...(m.by !== undefined ? { by: m.by } : {}) }
        }
        for (const [h, n] of Object.entries(c.banned ?? {})) {
          if (n === null) delete a.banned[h]
          else a.banned[h] = n
        }
        Object.assign(a.looked, c.looked ?? {})
        for (const id of c.sold ?? []) if (!a.sold.includes(id)) a.sold.push(id)
        Object.assign(a.done, c.done ?? {})
        if (c.run === null) delete a.run
        else if (c.run !== undefined) a.run = structuredClone(c.run)
        writeAuction(s, a)
      },
    })

    // ---- 效果 ----
    k.effects.register<RefEffect>({
      kind: REF_EFFECT, owner: OWNER, ai: false,
      validate(raw: Record<string, unknown>, _ctx: EffectCtx) {
        const p: string[] = []
        if (!(isText(raw.house) && k.content.hasKind(HOUSE_KIND) && k.content.has(HOUSE_KIND, raw.house))) p.push('house 要是查得到的拍賣行 id。')
        if (raw.by !== undefined && !isText(raw.by)) p.push('by 要是寫推薦函的人的 id。')
        return p
      },
      toChanges: (e, ctx: EffectStepCtx): Change[] => [{ op: PATCH_OP, member: { [e.house]: { at: toMinutes(ctx.state.time), ...(e.by !== undefined ? { by: e.by } : {}) } } }],
      describe: (e) => `拿到${k.content.get<HouseEntry>(HOUSE_KIND, e.house)?.name ?? e.house}的推薦函。`,
    })
    k.effects.register<BanEffect>({
      kind: BAN_EFFECT, owner: OWNER, ai: false,
      validate(raw: Record<string, unknown>, _ctx: EffectCtx) {
        const p: string[] = []
        if (!(isText(raw.house) && k.content.hasKind(HOUSE_KIND) && k.content.has(HOUSE_KIND, raw.house))) p.push('house 要是查得到的拍賣行 id。')
        if (raw.days !== undefined && !(isSafeInt(raw.days) && raw.days >= 1 && raw.days <= 3650)) p.push('days 要是 1～3650 的整數。')
        return p
      },
      toChanges(e, ctx: EffectStepCtx): Change[] {
        const days = e.days ?? auctionRules(k).ban_days
        const until = toMinutes(ctx.state.time) + days * DAY_MINUTES
        const cur = auctionOf(ctx.state).banned[e.house]
        return [{ op: PATCH_OP, banned: { [e.house]: cur !== undefined && cur > until ? cur : until } }]
      },
      describe: (e) => `${k.content.get<HouseEntry>(HOUSE_KIND, e.house)?.name ?? e.house}停了你的會員資格。`,
    })

    // ---- 條件 ----
    k.conditions.register<Condition & { house: string }>({
      kind: MEMBER_CONDITION, owner: OWNER,
      validate: (raw) => (isText(raw.house) ? [] : ['house 要是拍賣行的 id']),
      test: (c, { state }) => !!state.pc && memberOf(k, state as GameState, c.house).member,
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const rules = auctionRules(k)
    const problems: string[] = []
    const houses = new Set(k.content.hasKind(HOUSE_KIND) ? k.content.list<HouseEntry>(HOUSE_KIND).map((h) => h.id) : [])
    for (const l of k.content.hasKind(LOT_KIND) ? k.content.list<LotEntry>(LOT_KIND) : []) {
      const at = `${LOT_KIND}/${l.id}`
      for (const h of l.houses ?? []) if (!houses.has(h)) problems.push(`${at}：houses 的拍賣行 ${h} 查不到`)
      if (l.kind === 'part' && l.part !== undefined) {
        const part = k.content.get('part', l.part)
        if (part && !rules.grades.includes(part.grade as number)) problems.push(`${at}：零件 ${l.part} 是 ${String(part.grade)} 級，不在上拍的等級（${rules.grades.join('、')}）裡；V 級不上拍`)
      }
      if (l.kind === 'cyberware' && l.blueprint !== undefined) {
        const bp = k.content.get('blueprint', l.blueprint)
        if (bp) {
          if (bp.kind !== 'cyberware') problems.push(`${at}：設計圖 ${l.blueprint} 不是義體（kind: cyberware）`)
          if (!rules.grades.includes(bp.grade as number)) problems.push(`${at}：義體設計圖 ${l.blueprint} 是 ${String(bp.grade)} 級，不在上拍的等級（${rules.grades.join('、')}）裡；V 級不上拍`)
          if (!isRecord(bp.stock) || Object.keys(bp.stock).length === 0) problems.push(`${at}：義體設計圖 ${l.blueprint} 沒有原廠組合（stock），定不了市價`)
        }
      }
      for (const [i, c] of (l.needs ?? []).entries()) problems.push(...k.conditions.validate(c, `needs[${i}]`).map((m) => `${at}：${m}`))
    }
    for (const n of k.content.list('npc')) {
      if (n.auction_ref === undefined) continue
      const bad = npcRefProblems(n.auction_ref)
      for (const m of bad) problems.push(`npc/${n.id}：${m}`)
      if (bad.length === 0 && Array.isArray(n.auction_ref)) for (const h of n.auction_ref as string[]) if (!houses.has(h)) problems.push(`npc/${n.id}：auction_ref 的拍賣行 ${h} 查不到`)
    }
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list(FACILITY_TYPE_KIND)) {
        if (t.auction === undefined) continue
        const bad = facilityProblems(t.auction)
        for (const m of bad) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：${m}`)
        if (bad.length === 0 && !houses.has((t.auction as { house: string }).house)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：auction.house 的拍賣行 ${(t.auction as { house: string }).house} 查不到`)
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
