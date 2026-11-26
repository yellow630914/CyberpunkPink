// L6 功能：裝備。身上的四層（穿著 10 格、飾品 5 格、攜帶 3 格、快取格）、穿脫的規則、全身的護甲、
// 一把組好的武器的數字、藏匿量與掃描，並把武器與快取格帶進戰鬥。
// 規格：EQUIPMENT 第 1～4、6 節；COMBAT_SYSTEM 第 4、5 節。設計圖與零件兩種內容的格式在核心（M4-core-product，core/content/product.ts）。組裝與拆解是 M4-craft。
// dev/work/M1-gear.md；暫定值見 dev/adr/0013（D9：護甲捨去；D10：通用飾品格固定 3 格；D10 的「沒有重量的懲罰」在 M4 做了）。
//
// M4-gear-m4（dev/work/M4-gear-m4.md；dev/adr/0019 第一、二節）接上核心的地方：
//   數字  武器與護甲讀核心 productOf 的 stats（零件、drawback、帶著的怪癖、精工的 bonus 都在裡面；沒有這些時和 M1 一樣）
//   內容  gear_rule（規則表，overridable，id: default；rules.ts）：負重、超重的懲罰、風格一致的加成、曝露度的兩個定值、染色的價錢與時間；
//         設計圖（護甲與服裝）多讀 style、exposure、long；外皮零件多讀 style_tag 與 stats.style、stats.exposure；設施種類多讀 dye（店家代染）；物品（飾品）多讀 style
//   數值  exposure（0～3）、style_value、carry_load、carry_cap（look.ts、weight.ts；義體的致動器之後用被動效果加 carry_cap）
//   條件  exposure { min?, max? }、style { tag, min? }（看得到的那幾件裡這個標籤的風格值合計，沒寫 min 是至少 1）；用到別人登記的：at_facility、at_home
//   被動  k.passives.register 來源 gear：超重時迴避 −2、stealth 檢定 −2、換位 +1 點（現實的戰場）
//   掛點  creation.step（features/creation 宣告）：建角第 9 步的物品與武器、護甲（點數、等級、類別、出身）與出身白給的 kit_free（creation.ts）
//   效果  gear_take（拿走身上的裝備；內建的來源才收，ai: false）；掛點 defeat.gear 對它回答 true
//   變更  gear.dye（染色）；報告 gear.dye（dyeDraft）
// 對外：styleOf、carryLoadOf、carryCapBase、overweight、dyeBlock、dyeDraft、dyeOf、gearRules。

import type { Condition, ConditionCtx, ContentEntry, Feature, Kernel } from '../../core'
import { ContentError, isRecord, isSafeInt } from '../../core'
import { installBattle } from './battle'
import { installChanges } from './changes'
import { answerCreation, catalogAnswer, lookAnswer } from './creation'
import { isColor } from './dye'
import { exposureSpec, styleOf, styleSpec, styleTagValue, styleValueOf } from './look'
import { OWNER, blueprintOf, stackOf } from './model'
import { armorOf, bodyArmorOf, scanFinds } from './numbers'
import { RULE_KIND, ruleProblems } from './rules'
import { installTake } from './take'
import { CAP_STAT, LOAD_STAT, carryCapBase, carryLoadOf, weightPassives } from './weight'

export { equip, equipBlock, unequip } from './equip'
export { QUICK_CATEGORIES, quickBlock } from './quick'
export type { BlueprintEntry, Gear, PartEntry } from './model'
export { ACCESSORY_SLOTS, CARRY_SLOTS, QUICK_BASE, QUICK_MAX, WEAR_SLOTS, gearOf, quickCapacity } from './model'
export { armorOf, bodyArmorOf, concealment, pieceArmor, scanFinds, weaponOf } from './numbers'
export { DEFAULT_GEAR_RULES, RULE_KIND as GEAR_RULE_KIND, gearRules } from './rules'
export type { GearRules } from './rules'
export { coveredSlots, exposureSpec, pieceLook, styleOf, styleSpec, styleTagValue, styleValueOf } from './look'
export type { SeenKind, SeenPiece, StyleInfo } from './look'
export { CAP_STAT, LOAD_STAT, carryCapBase, carryLoadOf, overweight, weightPassives } from './weight'
export { DYE_ACTION, DYE_TAG, dyeBlock, dyeDraft, dyeOf, dyeProblems, dyeShopHere, isColor } from './dye'
export type { DyeBy, DyeColors, DyeOpts } from './dye'
export { TAKE_KIND } from './take'

type ExposureCondition = Condition & { min?: number; max?: number }
type StyleCondition = Condition & { tag: string; min?: number }
type Rec = Record<string, unknown>
/** 掛點 creation.step 是 features/creation 宣告的：這裡只認名字與格式，不 import。 */
type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void
const level = (v: unknown): boolean => isSafeInt(v) && v >= 0 && v <= 3

export const gearFeature: Feature = {
  id: OWNER,
  install(k) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    installChanges(k)
    installTake(k)
    // 戰鬥的單位與報告讀同一個數字：全身的護甲（義體上的板材值在 M4 加進來）
    k.stats.defineStat({ id: 'armor', owner: OWNER, name: '護甲值', base: (state, actor) => (state.actors[actor] ? armorOf(k, state, actor) : 0) })
    // 全身的護甲裡身上那一件的份：軀幹的重創只讓這一份失效，頭盔與（M4 之後）義體上的板材不受影響
    k.stats.defineStat({ id: 'armor_body', owner: OWNER, name: '身上那件護甲', base: (state, actor) => (state.actors[actor] ? bodyArmorOf(k, state, actor) : 0) })
    // 別人看到的樣子與負重（看得到的那幾件：外套扣上時上身與護甲不算）
    k.stats.defineStat({ id: 'exposure', owner: OWNER, name: '曝露度', base: (state, actor) => (state.actors[actor] ? styleOf(k, state, actor).exposure : 0), max: 3 })
    k.stats.defineStat({ id: 'style_value', owner: OWNER, name: '風格值', base: (state, actor) => (state.actors[actor] ? styleValueOf(k, state, actor) : 0) })
    k.stats.defineStat({ id: LOAD_STAT, owner: OWNER, name: '身上的重量', base: (state, actor) => carryLoadOf(k, state, actor) })
    k.stats.defineStat({ id: CAP_STAT, owner: OWNER, name: '負重的上限', base: (state, actor) => carryCapBase(k, state, actor) })
    // 超重（來源 gear）：迴避、潛行、換位
    k.passives.register(OWNER, 'gear', (state, actor) => weightPassives(k, state, actor), '裝備')
    k.conditions.register<ExposureCondition>({
      kind: 'exposure', owner: OWNER,
      validate(raw) {
        const p: string[] = []
        if (raw.min === undefined && raw.max === undefined) p.push('min 與 max 至少要寫一個')
        for (const f of ['min', 'max'] as const) if (raw[f] !== undefined && !level(raw[f])) p.push(`${f} 要是 0～3 的整數`)
        if (level(raw.min) && level(raw.max) && (raw.min as number) > (raw.max as number)) p.push('min 不能大於 max')
        return p
      },
      test(c, { state, actor, stats }: ConditionCtx) {
        const id = actor ?? state.pc
        if (!id || !state.actors[id]) return false
        const v = stats.stat(state, id, 'exposure')
        return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)
      },
    })
    k.conditions.register<StyleCondition>({
      kind: 'style', owner: OWNER,
      validate(raw) {
        const p: string[] = []
        if (typeof raw.tag !== 'string' || !raw.tag.trim()) p.push('要有 tag（風格標籤）')
        if (raw.min !== undefined && !(isSafeInt(raw.min) && raw.min >= 1)) p.push('min 要是 1 以上的整數')
        return p
      },
      test(c, { state, actor }: ConditionCtx) {
        const id = actor ?? state.pc
        if (!id || !state.actors[id]) return false
        return styleTagValue(k, state, id, c.tag) >= (c.min ?? 1)
      },
    })
    installBattle(k)
    // 建角的第 9 步（M4-creation-body）：物品與武器、護甲的設計圖（掛點 creation.step 由 features/creation 宣告，這裡只認名字）
    ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('creation.step', OWNER, ((p: Parameters<typeof answerCreation>[1]) => answerCreation(k, p)) as never)
    // 建角的目錄（物品與武器、護甲）與外觀（穿著的風格）：features/creation 宣告掛點，這裡只認名字（M4 收尾修正批）
    ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('creation.catalog', OWNER, ((p: Parameters<typeof catalogAnswer>[1]) => catalogAnswer(k, p)) as never)
    ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('creation.look', OWNER, ((p: Parameters<typeof lookAnswer>[1]) => lookAnswer(k, p)) as never)
    // 掃橋（EQUIPMENT 6.3 節）：身上攜帶格裡這一級掃得到的武器（掛點 scan.carried 由 security 宣告；兩邊不互相 import）
    k.hooks.on('scan.carried', OWNER, ({ state, actor, strength }) => {
      const out: Array<{ item: string; name: string; legal: string; uid: string }> = []
      for (const uid of scanFinds(k, state, actor, strength)) {
        const stack = stackOf(state, uid)
        const bp = blueprintOf(k, stack)
        if (stack && bp) out.push({ item: stack.id, name: bp.name, legal: bp.legal, uid })
      }
      return out.length > 0 ? out : undefined
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    const colorProblems = (at: string, e: Rec): void => {
      for (const f of ['primary_color', 'secondary_color']) if (e[f] !== undefined && !isColor(e[f])) problems.push(`${at}：${f} 要是色票的 id（dye_ 開頭）或 #RRGGBB`)
    }
    for (const e of k.content.list<ContentEntry & Rec>('blueprint')) {
      const at = `blueprint/${e.id}`
      if (e.style !== undefined && styleSpec(e.style) === null) problems.push(`${at}：style 要是 { tag, value } 或 "from_skin"`)
      if (e.exposure !== undefined && exposureSpec(e.exposure) === null) problems.push(`${at}：exposure 要是 0～3 的整數或 "from_skin"`)
      if (e.long !== undefined && typeof e.long !== 'boolean') problems.push(`${at}：long 要是 true 或 false`)
      colorProblems(at, e)
    }
    for (const e of k.content.list<ContentEntry & Rec>('part')) {
      if (e.style_tag !== undefined && !(typeof e.style_tag === 'string' && e.style_tag.trim())) problems.push(`part/${e.id}：style_tag 要是風格標籤（字串）`)
    }
    for (const e of k.content.list<ContentEntry & Rec>('item')) {
      if (e.style !== undefined && (styleSpec(e.style) === null || e.style === 'from_skin')) problems.push(`item/${e.id}：style 要是 { tag, value }`)
    }
    if (k.content.hasKind('facility_type')) {
      for (const e of k.content.list<ContentEntry & Rec>('facility_type')) {
        if (e.dye !== undefined && !(e.dye === true || e.dye === false || isRecord(e.dye))) problems.push(`facility_type/${e.id}：dye 要是 true（店家代染）`)
      }
    }
    if (problems.length) throw new ContentError(problems)
  },
}
