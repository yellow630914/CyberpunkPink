// L6 功能：夜課的學習（LEWD_SYSTEM 第 10 節；NIGHT_LESSONS；DATA 3.1、3.2 節；dev/adr/0019 第十節、P31、P32；dev/work/M4-nightclass.md）。
// 技能與體位的資料歸 scene（內容種類 night_skill、position）；誰學會了什麼寫在 actor.ext.scene（skills、positions）。這個功能只管「開到幾階、看得到哪些、學不學得了、花體悟」：
// 共通看性經歷（actor.ext.sex_record）、其餘四個分支看傾向的軸（actor.ext.tendency）、學習條件看橋參數、性經歷與一串條件。
// 共鳴、標籤是「深」的加成、NPC 會哪些夜課都在 scene（它用衍生數值 night_tier_<分支> 決定共鳴生不生效）。
//
// 接上核心的地方：
//   內容  night_rule（規則表，overridable；id: default）：common_gates（共通每一階要的次數或對象的人數）、insight_per_tier、axis_of（分支 → 軸）
//   數值  衍生數值 night_tier_common、night_tier_relation、night_tier_sense、night_tier_body、night_tier_costume（0～5；任何角色都算得出來）
//   條件  night_skill（{ id }：學會了）、night_tier（{ branch, min }）；看 ctx.actor ?? 主角
//   效果  night_skill（{ id }，只有內建的來源能用：直接學會，不花體悟、不看條件；AI 給不出來）
//   變更  nightclass.learn（{ id, skill, positions }：技能與開放的體位記進 actor.ext.scene）
//   報告  nightclass.learn（學習；不花遊戲時間）
// 讀的：k.content（night_skill、position）、k.stats（bridge_<參數>、night_tier_*）、k.conditions（requires.conditions）、k.meters（insight）、k.activity（戰鬥與場景進行中學不了）。
// 對外：nightTier、nightList、learnProblems、learnBlock、learnDraft、insightOf、nightRules。
//
// 沒有做：技能的任何內容（不匯入）；歷練點換體悟（不能）；延伸的技能裝進橋（features/abilities）；對方的夜課不存（scene 場景開始時推）。

import type { Condition, ConditionCtx, Effect, EffectStepCtx, Feature, Kernel, Change } from '../../core'
import { ContentError, isRecord } from '../../core'
import { learnedOf, BRANCHES, BRANCH_NAME, LEARN_OP, OWNER, RULE_KIND, SKILL_KIND, TIER_MAX, TIER_STAT, computeTier, isBranch, isText, nightRules, readyProblems, ruleProblems, skillOf, unlockedPositions } from './model'
import { nightTier } from './learn'

export { learnBlock, learnDraft, learnProblems, insightOf, nightList, nightTier } from './learn'
export type { BranchView, LearnStatus, LearnView, NightListView } from './learn'
export { DEFAULT_NIGHT_RULES, LEARN_ACTION as NIGHT_LEARN_ACTION, nightRules, computeTier } from './model'
export type { NightRules } from './model'

interface LearnChange extends Change { id: string; skill: string; positions: string[] }
interface NightSkillEffect extends Effect { id: string }
interface NightSkillCondition extends Condition { id: string }
interface NightTierCondition extends Condition { branch: string; min: number }
interface AvatarCondition extends Condition { part?: string; layer?: string; who?: string }

/** 內海的活動：進行中就是人在內海（和 scene 的 NET_ACTIVITIES 同一份名單；兩個功能不互相 import）。 */
const NET_ACTIVITIES: readonly string[] = ['dive', 'netrun', 'face.net']

const whose = (ctx: ConditionCtx): string | undefined => ctx.actor ?? ctx.state.pc ?? undefined

export const nightclassFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 五個衍生數值：任何角色（含生成的 NPC）都算得出來
    for (const branch of BRANCHES) {
      k.stats.defineStat({
        id: TIER_STAT(branch), owner: OWNER, name: `夜課${BRANCH_NAME[branch]}開到幾階`, min: 0, max: TIER_MAX,
        base: (state, actor) => computeTier(nightRules(k), state.actors[actor], branch),
      })
    }

    // 條件
    k.conditions.register<NightSkillCondition>({
      kind: 'night_skill', owner: OWNER,
      validate: (raw) => (isText(raw.id) ? [] : ['id 要是夜課技能的 id']),
      test: (c, ctx) => {
        const who = whose(ctx)
        return who !== undefined && learnedOf(ctx.state.actors[who]).includes(c.id)
      },
    })
    k.conditions.register<NightTierCondition>({
      kind: 'night_tier', owner: OWNER,
      validate: (raw) => [
        ...(isBranch(raw.branch) ? [] : [`branch 要是 ${BRANCHES.join('、')} 其中一個`]),
        ...(typeof raw.min === 'number' && Number.isInteger(raw.min) && raw.min >= 0 && raw.min <= TIER_MAX ? [] : [`min 要是 0～${TIER_MAX} 的整數`]),
      ],
      test: (c, ctx) => {
        const who = whose(ctx)
        return who !== undefined && !!ctx.state.actors[who] && isBranch(c.branch) && nightTier(k, ctx.state, who, c.branch) >= c.min
      },
    })

    // 條件 avatar { part?, layer?, who? }（M4-night-resonance）：讀化身（actor.ext.deck.avatar，deck 寫）的部位與現在人在哪一層。
    // 學習條件用：「內海化身多出的觸手」＝{ part: 'tentacle' }、「在內海用化身」＝{ layer: 'net' }。part 是化身多出來的部位（extra、tail、tentacle）；
    // layer 'net' 是現在內海的活動（dive、netrun、face.net）進行中而且有化身，'meat' 是不在內海；兩個都寫要都成立；都不寫是有沒有化身
    k.conditions.register<AvatarCondition>({
      kind: 'avatar', owner: OWNER,
      validate(raw) {
        const p: string[] = []
        for (const key of Object.keys(raw)) if (!['kind', 'part', 'layer', 'who', 'text'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：part、layer、who、text）`)
        if (raw.part !== undefined && !isText(raw.part)) p.push('part 要是部位的 id（extra、tail、tentacle）')
        if (raw.layer !== undefined && raw.layer !== 'net' && raw.layer !== 'meat') p.push("layer 要是 'net' 或 'meat'")
        if (raw.who !== undefined && !isText(raw.who)) p.push('who 要是角色的 id')
        return p
      },
      test(c, ctx) {
        const who = c.who ?? whose(ctx)
        const a = who !== undefined ? ctx.state.actors[who] : undefined
        const deck = a && isRecord(a.ext.deck) ? a.ext.deck : null
        const avatar = deck && isRecord(deck.avatar) ? deck.avatar : null
        const inNet = k.activity.active(ctx.state).some((x) => NET_ACTIVITIES.includes(x.kind))
        if (c.layer === 'meat') return !inNet
        if (!avatar) return false
        if (c.part !== undefined && !(Array.isArray(avatar.parts) && avatar.parts.includes(c.part))) return false
        return c.layer !== 'net' || inNet
      },
    })

    // 變更：技能與開放的體位記進 actor.ext.scene（scene 在讀；其餘的鍵原樣留著）
    k.changes.register<LearnChange>({
      op: LEARN_OP, owner: OWNER,
      validate(s, c) {
        const p: string[] = []
        if (typeof c.id !== 'string' || !s.actors[c.id]) p.push(`沒有 ${String(c.id)} 這個角色`)
        if (!isText(c.skill)) p.push('skill 要是夜課技能的 id')
        if (!Array.isArray(c.positions) || !c.positions.every(isText)) p.push('positions 要是體位 id 的陣列')
        return p
      },
      apply(s, c) {
        const a = s.actors[c.id]!
        const raw = isRecord(a.ext.scene) ? { ...(a.ext.scene as Record<string, unknown>) } : {}
        const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : [])
        const skills = list(raw.skills)
        if (!skills.includes(c.skill)) skills.push(c.skill)
        const positions = list(raw.positions)
        for (const p of c.positions) if (!positions.includes(p)) positions.push(p)
        a.ext.scene = { ...raw, skills, positions }
      },
      describe: (c, s) => `${s.actors[c.id]?.name ?? c.id}多會了一個夜課技能`,
    })

    // 效果 night_skill：直接學會（事件與任務直接教一招）；不花體悟、不看條件，只有內建的來源能用
    k.effects.register<NightSkillEffect>({
      kind: 'night_skill', owner: OWNER, ai: false,
      validate(raw, ctx) {
        if (!isText(raw.id)) return ['id 要是夜課技能的 id']
        return ctx.content.has(SKILL_KIND, raw.id) ? [] : [`查不到夜課技能 ${raw.id}`]
      },
      toChanges(e, ctx: EffectStepCtx): Change[] {
        if (learnedOf(ctx.state.actors[ctx.actor]).includes(e.id)) return []
        return [{ op: LEARN_OP, id: ctx.actor, skill: e.id, positions: unlockedPositions(k, e.id) } as LearnChange]
      },
      describe(e, ctx) {
        const name = (ctx.content.get(SKILL_KIND, e.id)?.name as string | undefined) ?? e.id
        return learnedOf(ctx.state.actors[ctx.actor]).includes(e.id) ? `夜課「${name}」已經會了` : `學會了夜課「${name}」`
      },
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems = readyProblems(k)
    for (const e of k.content.list(SKILL_KIND)) {
      const s = skillOf(k, e.id)
      if (!s) continue
      for (const r of s.requires.conditions) {
        // 條件的種類沒有人註冊不是格式問題（當作不成立，P31）；格式本身交給各種類自己的 validate
        const def = k.conditions.kinds().includes(r.kind)
        if (def) {
          const bad = k.conditions.validate(r, 'requires.conditions')
          if (bad.length > 0) problems.push(`${SKILL_KIND}/${e.id}：${bad.join('；')}`)
        }
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
