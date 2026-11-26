// L6 功能 media 的剪輯角度（MEDIA 第 3 節的兩張表；DATA 第 11 節；OPINION 4.3a 節只看「進輿論戰」那一欄；dev/adr/0020 V9）。
// 內容種類 footage_angle（overridable）：一筆一種角度，預設七筆寫在這裡（DEFAULT_ANGLES），資料用同一個 id 蓋掉整筆、或加新的。
//   { id, name, group: 'neutral' | 'positive' | 'dispute', types: 類型[] | 'any', draw, trust, risk, card: 'line' | 'fuel' | 'decoy' | null, upload: 範本[] }
//   draw、trust、risk 是三個修正（MEDIA 第 3 節的表）；card 是進牌庫時的樣子；upload 是「直接上架」時除了基本的訂閱與公信力之外多出來的效果。
// 上架的範本（UploadTemplate）：
//   { kind, amount?, pct?, to?, when?, anon? }
//   kind  效果種類（subs、credibility、popularity、fame、standing、hostility……；那一種這一局沒有人註冊就略過那一筆）
//   amount  固定的量；pct  只給 subs 用：訂閱再加現有訂閱的幾個百分點（併進基本的那一筆，一起算最少多少人）
//   to  'targets' 涉及的每一個勢力、'blame' 抹黑指定的那個勢力（勢力量表的鍵）；沒寫就是主角自己的那一份
//   when  'self_intimate' 片是親密類而且畫面裡有主角才算
//   anon  'drop' 匿名上架時整筆拿掉（目標勢力的敵對值不算在你頭上）

import type { ContentEntry, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { MediaType } from './model'
import { ANGLE_KIND, TYPES, isText, isType } from './model'

export const GROUPS = ['neutral', 'positive', 'dispute'] as const
export type AngleGroup = (typeof GROUPS)[number]
export const CARD_KINDS = ['line', 'fuel', 'decoy'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export interface UploadTemplate {
  kind: string
  amount?: number
  pct?: number
  to?: 'targets' | 'blame'
  when?: 'self_intimate'
  anon?: 'drop'
}

export interface AngleEntry {
  id: string
  name: string
  group: AngleGroup
  types: MediaType[] | 'any'
  draw: number
  trust: number
  risk: number
  card: CardKind | null
  upload: UploadTemplate[]
}

/** 七種角度的預設（MEDIA 第 3 節兩張表；V9 的上架範本）。 */
export const DEFAULT_ANGLES: AngleEntry[] = [
  { id: 'documentary', name: '紀實', group: 'neutral', types: 'any', draw: 0, trust: 2, risk: 0, card: 'line', upload: [{ kind: 'credibility', amount: 1 }] },
  { id: 'daily', name: '日常', group: 'neutral', types: ['daily', 'celebrity', 'intimate'], draw: -1, trust: 1, risk: -1, card: null, upload: [{ kind: 'popularity', amount: 1 }] },
  { id: 'fun', name: '娛樂', group: 'neutral', types: 'any', draw: 2, trust: -2, risk: 0, card: 'decoy', upload: [{ kind: 'subs', pct: 1 }] },
  { id: 'hero', name: '英雄', group: 'positive', types: ['battle', 'celebrity'], draw: 1, trust: 0, risk: 0, card: 'line', upload: [{ kind: 'subs', pct: 1 }, { kind: 'popularity', amount: 1 }] },
  {
    id: 'expose', name: '揭弊', group: 'dispute', types: ['crime', 'scandal'], draw: 0, trust: 1, risk: 1, card: 'line',
    upload: [{ kind: 'credibility', amount: 1 }, { kind: 'standing', amount: -3, to: 'targets' }, { kind: 'hostility', amount: 5, to: 'targets', anon: 'drop' }],
  },
  {
    id: 'sensational', name: '煽情', group: 'dispute', types: ['intimate', 'scandal', 'battle'], draw: 2, trust: -1, risk: 1, card: 'fuel',
    upload: [{ kind: 'subs', pct: 2 }, { kind: 'credibility', amount: -1 }, { kind: 'fame', amount: 1, when: 'self_intimate' }],
  },
  { id: 'smear', name: '抹黑', group: 'dispute', types: 'any', draw: 1, trust: -1, risk: 3, card: 'fuel', upload: [{ kind: 'standing', amount: -3, to: 'blame' }] },
]

const small = (v: unknown, lo: number, hi: number): v is number => isSafeInt(v) && v >= lo && v <= hi

function templateProblems(t: unknown, at: string): string[] {
  if (!isRecord(t)) return [`${at} 要是 { kind, ... }`]
  const p: string[] = []
  for (const f of Object.keys(t)) if (!['kind', 'amount', 'pct', 'to', 'when', 'anon'].includes(f)) p.push(`${at}.${f}：沒有這個欄位`)
  if (!isText(t.kind)) p.push(`${at}.kind 要是效果的種類`)
  if (t.amount !== undefined && !small(t.amount, -100, 100)) p.push(`${at}.amount 要是 −100～100 的整數`)
  if (t.pct !== undefined && !(typeof t.pct === 'number' && Number.isFinite(t.pct) && t.pct >= 0 && t.pct <= 100)) p.push(`${at}.pct 要是 0～100 的數字`)
  if (t.pct !== undefined && t.kind !== 'subs') p.push(`${at}.pct 只有 subs 可以用`)
  if (t.amount === undefined && t.pct === undefined) p.push(`${at} 要寫 amount 或 pct`)
  if (t.to !== undefined && t.to !== 'targets' && t.to !== 'blame') p.push(`${at}.to 要是 targets 或 blame`)
  if (t.when !== undefined && t.when !== 'self_intimate') p.push(`${at}.when 要是 self_intimate`)
  if (t.anon !== undefined && t.anon !== 'drop') p.push(`${at}.anon 要是 drop`)
  return p
}

export function angleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是給玩家看的名字')
  if (!(GROUPS as readonly unknown[]).includes(e.group)) p.push(`group 要是 ${GROUPS.join('、')} 其中一個`)
  if (e.types !== 'any' && !(Array.isArray(e.types) && e.types.length > 0 && e.types.every(isType))) p.push(`types 要是 'any'，或 ${TYPES.join('、')} 的陣列`)
  for (const f of ['draw', 'trust', 'risk'] as const) if (!small(e[f], -10, 10)) p.push(`${f} 要是 −10～10 的整數（角度的修正）`)
  if (e.card !== null && !(CARD_KINDS as readonly unknown[]).includes(e.card)) p.push(`card 要是 ${CARD_KINDS.join('、')}，或 null（不能當牌）`)
  if (!Array.isArray(e.upload)) p.push('upload 要是陣列（可以是空的）')
  else e.upload.forEach((t, i) => p.push(...templateProblems(t, `upload[${i}]`)))
  return p
}

const cleanTemplate = (t: Record<string, unknown>): UploadTemplate => ({
  kind: t.kind as string,
  ...(t.amount !== undefined ? { amount: t.amount as number } : {}), ...(t.pct !== undefined ? { pct: t.pct as number } : {}),
  ...(t.to === 'targets' || t.to === 'blame' ? { to: t.to } : {}), ...(t.when === 'self_intimate' ? { when: t.when } : {}), ...(t.anon === 'drop' ? { anon: 'drop' as const } : {}),
})

const copyOf = (a: AngleEntry): AngleEntry => ({ ...a, types: a.types === 'any' ? 'any' : [...a.types], upload: a.upload.map((t) => ({ ...t })) })

/** 現在有哪些角度：預設七筆，資料同 id 的整筆蓋掉、不同 id 的加在後面（格式不合的忽略）。 */
export function anglesOf(k: Pick<Kernel, 'content'>): AngleEntry[] {
  const out = new Map<string, AngleEntry>(DEFAULT_ANGLES.map((a) => [a.id, copyOf(a)]))
  if (k.content.hasKind(ANGLE_KIND)) {
    for (const e of k.content.list<ContentEntry & Record<string, unknown>>(ANGLE_KIND)) {
      if (angleProblems(e).length > 0) continue
      out.set(e.id, {
        id: e.id, name: e.name as string, group: e.group as AngleGroup, types: e.types === 'any' ? 'any' : [...(e.types as MediaType[])],
        draw: e.draw as number, trust: e.trust as number, risk: e.risk as number, card: e.card as CardKind | null, upload: (e.upload as Array<Record<string, unknown>>).map(cleanTemplate),
      })
    }
  }
  return [...out.values()]
}

export const angleOf = (k: Pick<Kernel, 'content'>, id: string): AngleEntry | undefined => anglesOf(k).find((a) => a.id === id)

/** 這個類型這個角度收不收。 */
export const angleTakes = (a: AngleEntry, type: MediaType): boolean => a.types === 'any' || a.types.includes(type)
