// L6 功能：橋參數、傾向、豔名（LEWD_SYSTEM 第 1、1.1、5、9 節；CORE_RULES 4.2 節；DATA 第 8 節；dev/adr/0016 第三節、G10、G14；dev/work/M2-lewd.md）。
//
// 橋參數是硬體（敏感度、耐受、慾求、馴化，各 0～100，存在 actor.ext.bridge；沒有橋的人是 null）；傾向是這個人喜歡什麼（actor.ext.tendency：
// 四條軸有等級、標籤只有沒有／潛在／有／深）；豔名是每一區各自記的量表。這個功能沒有自己的報告：改狀態都走效果與核心的 actor.ext 變更。
//
// 接上核心的地方：
//   內容  tendency_tag（{ id, name, axis }，清單是內容）、lewd_rule（id: default，蓋掉內建的規則數字）
//   效果  bridge（{ param, amount }；AI 的一件事最多一項 +1（−1 同）、超過 0～100 夾住、沒有橋的人落空並提醒）
//         tendency（{ tag, to? }；沒有／潛在 → 有，那一軸累積一點；有或深 → 那一軸累積一點；點數到門檻軸升一級；to: 'deep' 只有內建的收，AI 與玩家要的整筆拿掉；
//                   玩家在內容篩選關掉的標籤整筆拿掉並提醒）
//   條件  bridge（{ param, min?, max? }，看有效值）、has_bridge、tendency_tag（{ tag, state? }，預設有或深）、tendency_axis（{ axis, min?, max? }）；看誰：ctx.actor ?? 主角
//   量表  fame（豔名：照區、0～100、AI 的上限 ±5）
//   衍生  bridge_sensitivity、bridge_tolerance、bridge_craving、bridge_docility：基礎是 ext.bridge 的值，義體、藥物之後用 addStatProvider 加上去（讀有效值請用 bridgeOf）
//         afterglow_cap 加一個 provider：耐受的效力每 40 點 +1 層。感載上限那一半（耐受 ÷ 2）角色的功能已經算了，這裡不碰
//   檢定  修正：帶 infiltrate 標籤的檢定，主角在這一區的豔名每 25 點 −1，身上有 masked 時沒有（ADR G10）
//   戰鬥  unit.ready：有橋的人慾求高於 60，開戰帶著（慾求 − 60）÷ 4 點感載，最多到感載上限的一半（ADR G14）
//   掛鉤  report.before：報告裡新增主角而沒有 bridge 這一欄，補預設值；save.loaded：讀進來的主角沒有 bridge 這一欄也補（有欄位而是 null 的是沒有橋，不動）

import type { Change, Condition, Effect, Feature, Kernel } from '../../core'
import { contentAllowed, isSafeInt, meterOf } from '../../core'
import type { Axis, BridgeParam, TagEntry, TagState } from './model'
import {
  AXES, AXIS_NAME, BRIDGE_PARAMS, INFILTRATE_TAG, MASKED, OWNER, PARAM_NAME, RULE_KIND, TAG_KIND, baseBridge, bridgeOf, hasCondition, isAxis, isParam, lewdRules,
  paramStatId, readBridge, ruleProblems, stepTendency, tagProblems, tagStateOf, tendencyOf,
} from './model'

export {
  AXES, AXIS_NAME, BRIDGE_PARAMS, DEFAULT_LEWD_RULES, INFILTRATE_TAG, MASKED, PARAM_NAME, RULE_KIND, TAG_KIND, TAG_STATES,
  baseBridge, bridgeOf, emptyTendency, hasCondition, hasTag, lewdRules, powerOf, readBridge, stepTendency, tagStateOf, tendencyOf,
} from './model'
export type { Axis, BridgeParam, BridgeParamView, BridgeRecord, BridgeView, LewdRules, TagEntry, TagState, TendencyRecord, TendencyStep } from './model'

interface BridgeEffect extends Effect { param: BridgeParam; amount: number }
interface TendencyEffect extends Effect { tag: string; to?: 'deep' }

const signed = (n: number): string => (n > 0 ? `+${n}` : `−${-n}`)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const rangeOk = (raw: Record<string, unknown>): string[] => (['min', 'max'] as const).filter((f) => raw[f] !== undefined && typeof raw[f] !== 'number').map((f) => `${f} 要是數字`)
const inRange = (v: number, c: { min?: number; max?: number }): boolean => (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)

export const lewdFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: TAG_KIND, owner: OWNER, validate: tagProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })

    // ---- 豔名（LEWD_SYSTEM 第 5 節）：照區、0～100、AI 一件事最多 ±5 ----
    k.meters.define({ kind: 'fame', owner: OWNER, name: '豔名', min: 0, max: 100, start: 0, keyed: 'district', cap: { down: 5, up: 5 } })

    // ---- 衍生數值 ----
    for (const p of BRIDGE_PARAMS) {
      k.stats.defineStat({
        id: paramStatId(p), owner: OWNER, name: PARAM_NAME[p],
        base: (state, actor) => readBridge(state.actors[actor]?.ext.bridge, lewdRules(k))?.[p] ?? 0,
      })
    }
    // 耐受每 40 點承受層數 +1（CORE_RULES 4.2 節）；機制用效力（超過 100 的部分遞減）。感載上限那一半角色的功能已經算了
    k.stats.addStatProvider('afterglow_cap', OWNER, (state, actor) => {
      const v = bridgeOf(k, state, actor)
      const layers = v ? Math.floor(v.tolerance.power / lewdRules(k).tolerance_per_layer) : 0
      return layers > 0 ? [{ label: '耐受', value: layers, source: 'bridge' }] : []
    })

    // ---- 豔名「被認出來」（ADR G10）：帶 infiltrate 標籤的檢定，這一區的豔名每 25 點 −1；戴著面具不算 ----
    k.stats.addCheckModifier(OWNER, (state, actor, ctx) => {
      if (actor !== state.pc || !ctx.tags.includes(INFILTRATE_TAG) || hasCondition(state, state.actors[actor], MASKED)) return []
      const r = lewdRules(k)
      const penalty = Math.floor(meterOf(k, state, 'fame') / r.fame_step) * r.fame_penalty
      return penalty > 0 ? [{ label: '被認出來', value: -penalty, source: 'fame' }] : []
    })

    // ---- 慾求高於 60 開戰就帶著感載（ADR G14）：不超過感載上限的一半。取「至少這麼多」而不是再加，連打幾場不會越堆越高 ----
    k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
      if (!unit.actor || !unit.load) return
      const v = bridgeOf(k, run.state, unit.actor)
      if (!v) return
      const r = lewdRules(k)
      const carried = Math.min(Math.floor((v.craving.power - r.craving_threshold) / r.craving_divisor), Math.floor(unit.load.max / 2))
      if (carried > unit.load.now) unit.load.now = carried
    })

    // ---- 效果：bridge ----
    k.effects.register<BridgeEffect>({
      kind: 'bridge', owner: OWNER,
      validate: (raw) => [
        ...(isParam(raw.param) ? [] : [`param 要是 ${BRIDGE_PARAMS.join('、')} 其中一個`]),
        ...(isSafeInt(raw.amount) ? [] : ['amount 要是整數']),
      ],
      // AI 的一件事最多一項 +1（往下同樣最多 −1）：同一個方向的所有筆加起來才比，超過的從最後幾筆往回扣
      budget(e, ctx) {
        if (ctx.level !== 'cap' || e.amount === 0) return null
        return {
          group: e.amount > 0 ? 'bridge:up' : 'bridge:down', amount: e.amount,
          min: e.amount > 0 ? -Infinity : -1, max: e.amount > 0 ? 1 : Infinity,
          resize: (to) => ({ ...e, amount: to }),
          notice: (to) => (to === 0 ? '一件事最多只收一項橋參數的變化（一點），這一筆沒有算。' : `一件事最多只收一項橋參數的變化（一點），這一筆只算了 ${Math.abs(to)} 點。`),
        }
      },
      // 沒有橋的人落空；加減之後夾在 0～100（到頭的不提醒，整筆拿掉）
      clamp(e, ctx) {
        const base = baseBridge(k, ctx.state, ctx.actor)
        if (!base) return { effect: null, note: { from: e.amount, to: 0, notice: '這個人沒有橋，橋參數的變化沒有地方落，所以沒有算。' } }
        const to = Math.max(0, Math.min(100, base[e.param] + e.amount)) - base[e.param]
        return { effect: to === 0 ? null : to === e.amount ? e : { ...e, amount: to } }
      },
      toChanges: (e, ctx): Change[] => {
        const base = baseBridge(k, ctx.state, ctx.actor)!
        return [{ op: 'actor.ext', id: ctx.actor, key: 'bridge', value: { ...base, [e.param]: base[e.param] + e.amount } }]
      },
      describe: (e) => `橋參數：${PARAM_NAME[e.param]} ${signed(e.amount)}`,
    })

    // ---- 效果：tendency ----
    const tagName = (tag: string): string => k.content.get<TagEntry>(TAG_KIND, tag)?.name ?? tag
    k.effects.register<TendencyEffect>({
      kind: 'tendency', owner: OWNER,
      validate: (raw, ctx) => [
        ...(isText(raw.tag) ? (ctx.content.has(TAG_KIND, raw.tag) ? [] : [`tag：查不到 ${raw.tag} 這個傾向標籤`]) : ['tag 要是傾向標籤的 id']),
        ...(raw.to === undefined || raw.to === 'deep' ? [] : ["to 只能是 'deep'（沒寫就是一般的累積）"]),
      ],
      clamp(e, ctx) {
        const drop = (notice: string) => ({ effect: null, note: { from: e.tag, to: null, limit: 'tendency', notice } })
        // 內容篩選關掉的標籤不會長（LEWD_SYSTEM 1.1、第 9 節）
        if (!contentAllowed(ctx.state.rules, e.tag)) return drop(`「${tagName(e.tag)}」這個題材被你的內容篩選關掉了，所以沒有算。`)
        const rules = lewdRules(k)
        const t = tendencyOf(ctx.state, ctx.actor, rules)
        const axis = k.content.require<TagEntry>(TAG_KIND, e.tag).axis
        if (e.to === 'deep') {
          // 「有」變成「深」只能由內建的事件明寫（AI 給的、玩家要求的都不收）
          if (ctx.level !== 'builtin') return drop(`傾向變成「深」只能由事件寫明，「${tagName(e.tag)}」這一筆沒有算。`)
          const st = tagStateOf(t, e.tag)
          if (st === 'deep') return { effect: null }
          if (st !== 'has') return drop(`你還沒有「${tagName(e.tag)}」這個傾向，沒辦法直接變成「深」，所以沒有算。`)
        }
        return { effect: stepTendency(t, e.tag, axis, rules, e.to) ? e : null }
      },
      toChanges(e, ctx): Change[] {
        const rules = lewdRules(k)
        const axis = k.content.require<TagEntry>(TAG_KIND, e.tag).axis
        const step = stepTendency(tendencyOf(ctx.state, ctx.actor, rules), e.tag, axis, rules, e.to)!
        return [{ op: 'actor.ext', id: ctx.actor, key: 'tendency', value: step.next }]
      },
      describe(e, ctx) {
        const rules = lewdRules(k)
        const axis = k.content.require<TagEntry>(TAG_KIND, e.tag).axis
        const step = stepTendency(tendencyOf(ctx.state, ctx.actor, rules), e.tag, axis, rules, e.to)!
        const name = tagName(e.tag)
        const head = step.did === 'deep' ? `傾向：「${name}」變成了「深」` : step.did === 'new' ? `傾向：多了「${name}」` : step.did === 'reveal' ? `傾向：「${name}」被揭開了` : `傾向：${AXIS_NAME[axis]}累積了一點（${name}）`
        return step.levelUp === null ? head : `${head}，${AXIS_NAME[axis]}升到 ${step.levelUp} 級`
      },
    })

    // ---- 條件（看誰：ctx.actor ?? 主角）----
    const whose = (ctx: { state: { pc: string | null }; actor?: string }) => ctx.actor ?? ctx.state.pc ?? ''
    k.conditions.register<Condition & { param: BridgeParam; min?: number; max?: number }>({
      kind: 'bridge', owner: OWNER,
      validate: (raw) => [...(isParam(raw.param) ? [] : [`param 要是 ${BRIDGE_PARAMS.join('、')} 其中一個`]), ...rangeOk(raw)],
      // 看有效值；沒有橋的人不成立
      test: (c, ctx) => {
        const v = bridgeOf(k, ctx.state, whose(ctx))
        return !!v && inRange(v[c.param].value, c)
      },
    })
    k.conditions.register({ kind: 'has_bridge', owner: OWNER, validate: () => [], test: (_c, ctx) => baseBridge(k, ctx.state, whose(ctx)) !== null })
    k.conditions.register<Condition & { tag: string; state?: TagState | 'none' }>({
      kind: 'tendency_tag', owner: OWNER,
      validate: (raw) => [
        ...(isText(raw.tag) ? [] : ['tag 要是傾向標籤的 id']),
        ...(raw.state === undefined || ['latent', 'has', 'deep', 'none'].includes(raw.state as string) ? [] : ["state 要是 'latent'、'has'、'deep'、'none' 其中一個（沒寫是有或深）"]),
      ],
      test: (c, ctx) => {
        const st = tagStateOf(tendencyOf(ctx.state, whose(ctx), lewdRules(k)), c.tag)
        return c.state === undefined ? st === 'has' || st === 'deep' : c.state === 'none' ? st === null : st === c.state
      },
    })
    k.conditions.register<Condition & { axis: Axis; min?: number; max?: number }>({
      kind: 'tendency_axis', owner: OWNER,
      validate: (raw) => [...(isAxis(raw.axis) ? [] : [`axis 要是 ${AXES.join('、')} 其中一個`]), ...rangeOk(raw)],
      test: (c, ctx) => inRange(tendencyOf(ctx.state, whose(ctx), lewdRules(k)).axes[c.axis], c),
    })

    const defaultBridge = (): Record<BridgeParam, number> => {
      const v = lewdRules(k).default_bridge
      return { sensitivity: v, tolerance: v, craving: v, docility: v }
    }

    // ---- 開新局、讀檔：主角沒有 bridge 這一欄就補預設（建角給的值已經寫在欄位裡；null 是沒有橋，不動）----
    k.hooks.on('report.before', OWNER, ({ draft }) => {
      const out: Change[] = []
      for (const c of draft.changes) {
        const a = c.op === 'actor.add' ? (c.actor as { id: string; role: string; ext: Record<string, unknown> }) : null
        if (a && a.role === 'pc' && a.ext?.bridge === undefined) out.push({ op: 'actor.ext', id: a.id, key: 'bridge', value: defaultBridge() })
      }
      return out.length ? out : undefined
    })
    k.hooks.on('save.loaded', OWNER, ({ state }) => {
      const pc = state.pc ? state.actors[state.pc] : undefined
      return pc && pc.ext.bridge === undefined ? [{ op: 'actor.ext', id: pc.id, key: 'bridge', value: defaultBridge() }] : undefined
    })
  },
}
