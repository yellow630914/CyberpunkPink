// L4 規則核心：有效屬性、衍生數值與檢定修正的登錄表。
// 沿用 ElondiaRPG 的 attrsOf 與 addAttrProvider：檢定讀有效屬性（基礎＋義體、藥物、狀態的加減），來源移除時自動回復。
// 核心不知道生命值怎麼算、特質加什麼：功能把公式與來源註冊進來（角色功能註冊 max_hp，特質功能註冊檢定修正）。

import type { ActorId, AttrId, GameState, RollPart, SkillId } from '../types'
import type { ContentRegistry } from '../content/registry'
import type { Probe } from '../state/probe'
import { clamp } from '../util/sanitize'

/** 有效屬性上限 24（CORE_RULES 第 1 節）。 */
export const EFFECTIVE_ATTR_MAX = 24
export const EFFECTIVE_ATTR_MIN = 1

export interface CheckCtx {
  attr: AttrId
  skill?: SkillId
  /** 情境的標籤：social、combat、place:hive、vs_faction:hizakura…… 由發起檢定的功能決定 */
  tags: string[]
  target?: ActorId
}

type AttrProvider = (state: GameState, actor: ActorId, attr: AttrId) => RollPart[]
type StatProvider = (state: GameState, actor: ActorId) => RollPart[]
type CheckModifier = (state: GameState, actor: ActorId, ctx: CheckCtx) => RollPart[]

export interface StatDef {
  /** 例如 max_hp、load_cap、ap_max、ram_max、afterglow_cap */
  id: string
  owner: string
  name: string
  /** 基礎值（公式）。可以用 stats.effectiveAttr 讀有效屬性 */
  base(state: GameState, actor: ActorId, stats: StatRegistry): number
  min?: number
  max?: number
}

const ATTR_NAME_FALLBACK: Record<AttrId, string> = { body: '體格', reflex: '反應', tech: '技術', intellect: '智識', resolve: '意志', charm: '魅力' }

export class StatRegistry {
  private attrProviders: Array<{ owner: string; fn: AttrProvider }> = []
  private stats = new Map<string, StatDef>()
  private statProviders = new Map<string, Array<{ owner: string; fn: StatProvider }>>()
  private modifiers: Array<{ owner: string; fn: CheckModifier }> = []

  constructor(private probe: Probe, private content: ContentRegistry) {}

  private reg(registry: string, id: string, owner: string): void {
    this.probe.emit('core/rules/stats', 'registry.register', { registry, id, owner })
  }

  /** 屬性的來源：義體、藥物、狀態。回傳這個角色這一項屬性的加減。 */
  addAttrProvider(owner: string, fn: AttrProvider): void {
    this.attrProviders.push({ owner, fn })
    this.reg('attrProviders', owner, owner)
  }

  attrParts(state: GameState, actor: ActorId, attr: AttrId): RollPart[] {
    return this.attrProviders.flatMap((p) => p.fn(state, actor, attr)).filter((p) => p.value !== 0)
  }

  /** 有效屬性：基礎加所有來源，夾在 1～24。 */
  effectiveAttr(state: GameState, actor: ActorId, attr: AttrId): number {
    const a = state.actors[actor]
    if (!a) throw new Error(`沒有 ${actor} 這個角色`)
    return clamp(a.attrs[attr] + this.attrParts(state, actor, attr).reduce((s, p) => s + p.value, 0), EFFECTIVE_ATTR_MIN, EFFECTIVE_ATTR_MAX)
  }

  defineStat(def: StatDef): void {
    if (this.stats.has(def.id)) throw new Error(`衍生數值重複註冊：${def.id}（已經由 ${this.stats.get(def.id)!.owner} 註冊）`)
    this.stats.set(def.id, def)
    this.reg('stats', def.id, def.owner)
  }

  hasStat(id: string): boolean {
    return this.stats.has(id)
  }

  /** 衍生數值的來源：特質的「生命值上限 +5」、義體的加值。 */
  addStatProvider(stat: string, owner: string, fn: StatProvider): void {
    const list = this.statProviders.get(stat) ?? []
    list.push({ owner, fn })
    this.statProviders.set(stat, list)
    this.reg('statProviders', stat, owner)
  }

  /** 一個衍生數值的組成：基礎與每個來源。 */
  statParts(state: GameState, actor: ActorId, id: string): RollPart[] {
    const def = this.stats.get(id)
    if (!def) throw new Error(`沒有 ${id} 這個衍生數值（還沒有功能註冊它）`)
    return [{ label: '基礎', value: def.base(state, actor, this), source: 'base' }, ...(this.statProviders.get(id) ?? []).flatMap((p) => p.fn(state, actor)).filter((p) => p.value !== 0)]
  }

  stat(state: GameState, actor: ActorId, id: string): number {
    const def = this.stats.get(id)
    if (!def) throw new Error(`沒有 ${id} 這個衍生數值（還沒有功能註冊它）`)
    const total = this.statParts(state, actor, id).reduce((s, p) => s + p.value, 0)
    return clamp(Math.floor(total), def.min ?? 0, def.max ?? Number.MAX_SAFE_INTEGER)
  }

  /** 檢定的修正：特質、狀態、重傷、餘韻、協力…… 每個功能註冊自己的那一批。 */
  addCheckModifier(owner: string, fn: CheckModifier): void {
    this.modifiers.push({ owner, fn })
    this.reg('checkModifiers', owner, owner)
  }

  checkModifiers(state: GameState, actor: ActorId, ctx: CheckCtx): RollPart[] {
    return this.modifiers.flatMap((m) => m.fn(state, actor, ctx)).filter((p) => p.value !== 0)
  }

  /** 屬性與基本功的中文名：有載入 attribute、skill 的內容就用內容的，沒有就用 id。 */
  attrName(attr: AttrId): string {
    return (this.content.get('attribute', attr)?.name as string | undefined) ?? ATTR_NAME_FALLBACK[attr]
  }

  skillName(skill: SkillId): string {
    return (this.content.get('skill', skill)?.name as string | undefined) ?? skill
  }
}
