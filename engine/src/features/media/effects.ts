// L6 功能 media 的效果與條件（EVENTS 2.4 節的 footage；dev/work/M5-media-chain.md「新的格式與鍵」）。
//   效果 footage { type, quality?, title?, involves?, forged?, exclusive?, origin? }：給一段素材（3 次）。內建的照寫；
//                AI 的來源（ctx.level === 'cap'）一件事最多一段、品質不超過所在那一區的等級。素材放進素材庫，不進背包。
//   條件 has_footage { faction?, type?, min_quality?, usable? }：素材庫裡有沒有符合的一段（usable: true 只看還有次數的）。被捕時素材是證據用它問。
//   條件 rec_on：現在真的在錄（錄影開著、隊伍裡有人錄得到、這個地方准錄）。「被發現在錄」是事件的內容，引擎只給條件。
// 效果的格式與條件的說明句（describe）都寫完整的句子；沒有任何一個入口給街頭信譽（V54）。

import type { Condition, ConditionCtx, Effect, EffectStepCtx, Kernel } from '../../core'
import { isRecord, isSafeInt, toMinutes } from '../../core'
import type { Pov } from './pov'
import { POV_KINDS, readPov } from './pov'
import type { FootageInit } from './ops'
import type { MediaType, Origin } from './model'
import { OWNER, ORIGINS, TYPES, TYPE_NAME, isOrigin, isText, isType, mediaRules, readMedia } from './model'
import { isRecording } from './record'

const FOOTAGE = 'footage'
const HAS_FOOTAGE = 'has_footage'
const REC_ON = 'rec_on'
/** 效果沒寫品質時的預設 */
const DEFAULT_QUALITY = 2
const TITLE_MAX = 60

interface FootageEffect extends Effect {
  type: MediaType
  quality?: number
  title?: string
  involves?: { factions?: string[]; people?: string[] }
  forged?: boolean
  exclusive?: boolean
  origin?: Origin
  /** 視角（事件給監視器、別人的 POV 的入口；沒寫是「某人的 POV」，MEDIA 2.2） */
  pov?: Pov
}

interface HasFootage extends Condition { faction?: string; type?: MediaType; min_quality?: number; usable?: boolean }

const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

const idList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

function init(k: Kernel, e: FootageEffect, ctx: EffectStepCtx): FootageInit {
  const rules = mediaRules(k)
  const title = isText(e.title) ? e.title.trim() : `一段${TYPE_NAME[e.type]}的畫面`
  const quality = e.quality ?? DEFAULT_QUALITY
  return {
    title, text: `${title}。`, type: e.type, quality, authentic: e.forged === true ? 'forged' : 'real', exclusive: e.exclusive !== false,
    involves: { factions: [...(e.involves?.factions ?? [])], people: [...(e.involves?.people ?? [])] }, uses: rules.uses, made_at: toMinutes(ctx.state.time),
    origin: e.origin ?? 'event', celebrity: e.type === 'celebrity', self: false, adult: false, ...(e.pov ? { pov: e.pov } : {}),
  }
}

export function installEffects(k: Kernel): void {
  k.effects.register<FootageEffect>({
    kind: FOOTAGE, owner: OWNER,
    validate(raw, ctx) {
      const p = unknownFields(raw, ['type', 'quality', 'title', 'involves', 'forged', 'exclusive', 'origin', 'pov'])
      if (raw.pov !== undefined && readPov(raw.pov) === null) p.push(`pov 要是 { kind, who? }（kind 是 ${POV_KINDS.join('、')} 其中一個）`)
      if (!isType(raw.type)) p.push(`type 要是 ${TYPES.join('、')} 其中一個`)
      if (raw.quality !== undefined && !(isSafeInt(raw.quality) && raw.quality >= 1 && raw.quality <= 5)) p.push('quality 要是 1～5 的整數')
      if (raw.title !== undefined && !(isText(raw.title) && Array.from(raw.title).length <= TITLE_MAX)) p.push(`title 要是 ${TITLE_MAX} 字以內的一句話`)
      if (raw.involves !== undefined) {
        const inv = raw.involves
        if (!isRecord(inv) || (inv.factions !== undefined && !idList(inv.factions)) || (inv.people !== undefined && !idList(inv.people)) || Object.keys(inv).some((f) => f !== 'factions' && f !== 'people')) p.push('involves 要是 { factions?, people? }（各是 id 的陣列）')
        else if (ctx.content.hasKind('faction')) for (const f of (inv.factions as string[] | undefined) ?? []) if (!ctx.content.has('faction', f)) p.push(`involves.factions 查不到勢力 ${f}`)
      }
      for (const key of ['forged', 'exclusive'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') p.push(`${key} 要是 true 或 false`)
      if (raw.origin !== undefined && !isOrigin(raw.origin)) p.push(`origin 要是 ${ORIGINS.join('、')} 其中一個`)
      return p
    },
    // AI 一件事最多給一段（合計上限）；內建的與玩家明說要的照寫
    budget: (e, ctx) => (ctx.level === 'cap' ? { group: FOOTAGE, amount: 1, min: 0, max: 1, resize: () => e, notice: () => '一件事最多給一段素材，多的沒有收。' } : null),
    // AI 給的品質不超過所在那一區的等級
    clamp(e, ctx) {
      if (ctx.level !== 'cap') return { effect: e }
      const quality = e.quality ?? DEFAULT_QUALITY
      if (quality <= ctx.grade) return { effect: e }
      return { effect: { ...e, quality: ctx.grade }, note: { from: quality, to: ctx.grade, limit: ctx.grade, notice: '這一帶拍得到的素材品質有限，品質降到這一區的等級。' } }
    },
    toChanges: (e, ctx) => [{ op: 'media.make', footage: init(k, e, ctx) }],
    describe: (e) => `拿到一段素材：「${isText(e.title) ? e.title.trim() : `一段${TYPE_NAME[e.type]}的畫面`}」。`,
  })

  k.conditions.register<HasFootage>({
    kind: HAS_FOOTAGE, owner: OWNER,
    validate(raw) {
      const p = unknownFields(raw, ['faction', 'type', 'min_quality', 'usable'])
      if (raw.faction !== undefined && !isText(raw.faction)) p.push('faction 要是勢力的 id')
      if (raw.type !== undefined && !isType(raw.type)) p.push(`type 要是 ${TYPES.join('、')} 其中一個`)
      if (raw.min_quality !== undefined && !(isSafeInt(raw.min_quality) && raw.min_quality >= 1 && raw.min_quality <= 5)) p.push('min_quality 要是 1～5 的整數')
      if (raw.usable !== undefined && typeof raw.usable !== 'boolean') p.push('usable 要是 true 或 false')
      return p
    },
    test: (c, ctx: ConditionCtx) => Object.values(readMedia(ctx.state).footage).some((f) =>
      (c.faction === undefined || f.involves.factions.includes(c.faction)) && (c.type === undefined || f.type === c.type)
      && (c.min_quality === undefined || f.quality >= c.min_quality) && (c.usable !== true || f.uses > 0)),
    describe(c) {
      const fac = c.faction !== undefined ? `涉及${isText(k.content.get('faction', c.faction)?.name) ? (k.content.get('faction', c.faction)!.name as string) : c.faction}的` : ''
      const type = c.type !== undefined ? `${TYPE_NAME[c.type]}類的` : ''
      const q = c.min_quality !== undefined ? `（品質 ${c.min_quality} 以上）` : ''
      return `要有一段${fac}${type}素材${q}${c.usable === true ? '，而且還能用' : ''}`
    },
  })

  k.conditions.register<Condition>({
    kind: REC_ON, owner: OWNER,
    validate: (raw) => unknownFields(raw, []),
    test: (_c, ctx: ConditionCtx) => isRecording(k, ctx.state),
    describe: () => '要正在錄影（錄影開著、在場有鏡頭：錄影義體、錄影無人機或架好的攝影機，這個地方准錄）',
  })
}
