// L6 功能 curtain 給戰敗事件與事件資料用的三個效果（M4-followups-2 第 9 項；CYBERSPACE 8.8 節「預定要寫的」df_stage_vip：貴賓席的贊助人競標包場、接簽檔期的邀約；獎品表第 6 項「贊助人的名片」）。
// 都是只有內建的來源能用（ai: false）：誰給名片、誰開簽約，是內容的事，AI 與玩家要的結果不能自己給。
//   curtain_gig { weeks? }             從事件直接簽檔期（和落幕之後選「簽檔期」同一條路，fall.ts 的 settleDraft）：四週（規則表 fall.gig.weeks；weeks 可以改成 1～12），
//                                      每週至少上 shows_per_week 場、期間打賞與獎金只拿 split 成。contract_dom 被內容篩選關掉、已經簽著的是落空（不丟錯，結果寫原因）。
//                                      簽了之後，落幕等著選路的那一筆（fall）就算選過了：拿掉，不再另外收設備費與違約金。
//   curtain_patron { npc, affinity? }  贊助人的名片：那位贊助人的親密度 +affinity（預設 10，有人註冊效果 affinity 才加）、一條委託線頭（旗標 curtain_lead:<npc>，只給旗標，線頭本身是內容）。
//   curtain_lead { patron }            只給委託線頭（旗標 curtain_lead:<patron>）：事件不給名片、只給一條線時用。
// 旗標名字照 curtain_sponsor、curtain_tape 的寫法（FLAG_LEAD_PREFIX）。

import type { Change, Effect, EffectCtx, Kernel } from '../../core'
import { contentAllowed, effectCtx } from '../../core'
import { OWNER, curtainRules, isInt, isText, nowOf, readCurtain, weekMinutes } from './model'
import { patch } from './patch'

export const GIG_EFFECT = 'curtain_gig'
export const PATRON_EFFECT = 'curtain_patron'
export const LEAD_EFFECT = 'curtain_lead'
/** 委託線頭的旗標：curtain_lead:<贊助人的 id>。 */
export const FLAG_LEAD_PREFIX = 'curtain_lead:'
/** 名片給的親密度（CYBERSPACE 8.8 節獎品表第 6 項：好感 +10）。 */
export const PATRON_AFFINITY = 10
const AFFINITY_EFFECT = 'affinity'

interface GigEffect extends Effect { weeks?: number }
interface PatronEffect extends Effect { npc: string; affinity?: number }
interface LeadEffect extends Effect { patron: string }

const extra = (raw: Record<string, unknown>, allowed: string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

/** 簽檔期要套的變更；簽不成回傳原因（沒有變更）。 */
function gigPlan(k: Kernel, ctx: Pick<EffectCtx, 'state'>, weeks?: number): { changes: Change[]; line: string } | { why: string } {
  const state = ctx.state
  if (!contentAllowed(state.rules, 'contract_dom')) return { why: '簽檔期的場內契約用到被你的內容篩選關掉的題材，這一份邀約沒有生效。' }
  const cur = readCurtain(state)
  if (cur.gig && nowOf(state) < cur.gig.until) return { why: '你已經簽著檔期了，這一份邀約沒有再算一次。' }
  const g = curtainRules(k).fall.gig
  const w = weeks ?? g.weeks
  const now = nowOf(state)
  const changes: Change[] = [patch({ gig: { start: now, until: now + w * weekMinutes(k), shows: {}, missed: 0, checked: 0 } })]
  // 落幕之後等著選路的那一筆算選過了（簽檔期就是那三條路的其中一條）
  if (cur.fall) changes.push(patch({ fall: null }))
  return { changes, line: `你簽了 ${w} 週的檔期：每週至少上 ${g.shows_per_week} 場，這段時間打賞與獎金你只拿 ${Math.round(g.split * 100)}%。` }
}

export function registerFallEffects(k: Kernel): void {
  k.effects.register<GigEffect>({
    kind: GIG_EFFECT, owner: OWNER, ai: false,
    validate: (raw) => [...(raw.weeks === undefined || (isInt(raw.weeks) && raw.weeks >= 1 && raw.weeks <= 12) ? [] : ['weeks 要是 1～12 的整數（沒寫是規則表 fall.gig.weeks）']), ...extra(raw, ['weeks'])],
    toChanges: (e, ctx) => {
      const p = gigPlan(k, ctx, e.weeks)
      return 'why' in p ? [] : p.changes
    },
    describe: (e, ctx) => {
      const p = gigPlan(k, ctx, e.weeks)
      return 'why' in p ? p.why : p.line
    },
  })

  k.effects.register<PatronEffect>({
    kind: PATRON_EFFECT, owner: OWNER, ai: false,
    validate: (raw) => [
      ...(isText(raw.npc) ? [] : ['npc 要是贊助人（角色）的 id']),
      ...(raw.affinity === undefined || (isInt(raw.affinity) && raw.affinity >= 1 && raw.affinity <= 30) ? [] : ['affinity 要是 1～30 的整數（沒寫是 10）']),
      ...extra(raw, ['npc', 'affinity']),
    ],
    toChanges: (e, ctx) => {
      const out: Change[] = [{ op: 'flag', key: `${FLAG_LEAD_PREFIX}${e.npc}`, value: true }]
      if (k.effects.has(AFFINITY_EFFECT)) {
        const res = k.effects.resolve([{ kind: AFFINITY_EFFECT, key: e.npc, amount: e.affinity ?? PATRON_AFFINITY }], effectCtx(k, ctx.state, { source: 'builtin', actor: ctx.actor }))
        if (res.errors.length === 0) out.push(...res.changes)
      }
      return out
    },
    describe: (e, ctx) => `贊助人的名片：${ctx.state.actors[e.npc]?.name ?? e.npc}給了你一條委託線頭，好感 +${e.affinity ?? PATRON_AFFINITY}`,
  })

  k.effects.register<LeadEffect>({
    kind: LEAD_EFFECT, owner: OWNER, ai: false,
    validate: (raw) => [...(isText(raw.patron) ? [] : ['patron 要是贊助人的 id']), ...extra(raw, ['patron'])],
    toChanges: (e) => [{ op: 'flag', key: `${FLAG_LEAD_PREFIX}${e.patron}`, value: true }],
    describe: (e, ctx) => `一條委託線頭：${ctx.state.actors[e.patron]?.name ?? e.patron}`,
  })
}
