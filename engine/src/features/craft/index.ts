// L6 功能：組裝（CRAFTING 第 3.4、4、6 節與 10.1、10.2 節；TRADE 3.4 節；dev/adr/0019 第四節與 P16；dev/work/M4-craft.md）。
//
// 會做的設計圖、組裝的預覽（難度的每一項、做的人的加值與成功率、成品的數字與價錢）、組裝的檢定與四級結果、誰來做（自己、店家、同人社團、原廠）、超規。
// 組出來的成品是背包裡的一疊（id 是設計圖、data 是核心的 ProductData），gear 讀得到、trade 買得到賣得掉。
// 不做：拆解、換零件、畫設計圖（M4-craft-salvage）；義體的安裝（cyberware）；訂做零件、零件的合成、生體件的培養（CRAFTING 第 8.3 節；不做或等第五波）。
// CRAFTING 第 6 節的套裝加成與排異目前只做了資料面：成品的牌子數、原廠全套（fullSet）有算、難度的「牌子數 −1」有加；套裝加成的效果（緋櫻的同步回灌 −10% 之類）與排異（失敗時沉溺成本上升）沒有人算。
//
// 接上核心的地方：
//   內容  craft_rule（規則表，overridable；id: default；DEFAULT_CRAFT_RULES）；設施種類（world 的 facility_type）多讀 craft: { by: 'shop' | 'doujin' | 'factory', brand? }（載入之後 ready 檢查格式）；
//         物品（類別 blueprint）多讀 teaches：設計圖的 id（ready 檢查查得到）
//   效果  blueprint { id }：學會一張設計圖（內建的來源才收，ai: false）
//   條件  用到別人登記的：at_facility（站的設施帶 craft）、at_home（level_min：住處的等級）、ability（daily: 'workshop'：工坊 +2、超規的修正減半；沒有人登記就沒有這個加成）
//   狀態  state.ext.craft = { known: string[] }（只經由報告裡的 ext 變更寫）
// 報告（kind action）：craft.assemble、craft.learn。
// 對外：knownBlueprints、craftOf、isKnown、learnBlock／learnProblems／learnDraft、makers、assemblyPreview、assembleBlock／assembleProblems／assembleDraft、craftRules、DEFAULT_CRAFT_RULES。

import type { ContentEntry, Feature, Kernel } from '../../core'
import { ContentError } from '../../core'
import { installBlueprintEffect, licenceProblems } from './learn'
import { FACILITY_TYPE_KIND, OWNER, RULE_KIND, facilityCraftProblems, ruleProblems } from './model'

export { assembleBlock, assembleDraft, assembleProblems, fineBonus, quirkPool, PRODUCT_UID_PREFIX } from './assemble'
export type { AssembleOpts } from './assemble'
export { BLUEPRINT_EFFECT, craftHere, craftOf, craftRules, DEFAULT_CRAFT_RULES, isKnown, knownBlueprints, ASSEMBLE_ACTION, LEARN_ACTION, MAKER_KINDS, MAKER_NAME } from './model'
export type { CraftFacility, CraftRules, CraftState, LicenceItem, MakerKind, MakerRule, Pool } from './model'
export { learnBlock, learnDraft, learnProblems } from './learn'
export type { LearnOpts } from './learn'
export { assemblyPreview, makers, oddsOf, planAssembly } from './preview'
export type {
  AssemblyPreview, CheckPreview, Difficulty, DifficultyLine, MakerOption, Odds, PickView, PreviewOpts, ProductResult, SlotView,
} from './preview'

export const craftFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    installBlueprintEffect(k)
  },

  ready(k) {
    const problems: string[] = []
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { craft?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.craft !== undefined) problems.push(...facilityCraftProblems(t.craft).map((m) => `${FACILITY_TYPE_KIND}/${t.id}：${m}`))
      }
    }
    problems.push(...licenceProblems(k))
    if (problems.length) throw new ContentError(problems)
  },
}

export { OWNER as CRAFT_OWNER, RULE_KIND as CRAFT_RULE_KIND }
