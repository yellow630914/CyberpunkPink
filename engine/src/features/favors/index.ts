// L6 功能：人情（FIXER 第 8 節；EVENTS 2.4 節的 owed、owed_to_pc；TRADE 4.4 節；dev/adr/0015 E2；dev/work/M2-favors.md）。
//
// 第二種貨幣：欠你的與你欠的分開記，有對象（人或勢力）與大小（小、中、大），只記在主角名下，放在 state.ext.favors。
// 這個功能只管「記帳」：加、用掉、被討、作價。拿人情去做什麼（請人、買情報、殺價）是用的那個功能的事，它們呼叫 spend()／
// 把 favor.spend 併進自己的報告；戰鬥裡的人情池（favor_small／favor_mid／favor_big）由 abilities 讀下面的衍生數值建池、結束時寫回。
//
// 接上核心的地方：
//   變更  favor.add、favor.spend
//   效果  owed_to_pc（別人欠主角）、owed（主角欠別人）：{ kind, who, size, note? }。AI 給的只收小與中，大的整筆拿掉並提醒；一件事最多一個
//   條件  has_favor：{ who?, size?, dir }（dir 是 owed_to_pc 或 owed_by_pc；size 要剛好是那一種大小）
//   衍生  favor_small、favor_mid、favor_big：主角名下「欠你的」各有幾個（不是主角、或沒有主角時是 0）
//   內容  favor_rule（id: default）：作價與拒絕被討的信譽，蓋掉內建的預設
// 報告：favor.use（spend）、favor.called（call）。

import type { Change, Condition, Effect, EffectCtx, Feature, GameState, Kernel } from '../../core'
import { isSafeInt } from '../../core'
import type { Favor, FavorDir, FavorSize } from './model'
import { DIRS, EXT, FAVOR_RULE_KIND, OWNER, SIZES, SIZE_NAME, favorCount, favorRuleProblems, favorsOf, isDir, isSize, nameOf, whoProblem, isCastRef } from './model'

export { DEFAULT_FAVOR_RULES, call, favorCount, favorPrice, favorRules, favorsOf, spend, spendBlock, SIZES, SIZE_NAME, DIRS } from './model'
export type { Favor, FavorDir, FavorRules, FavorSize, FavorsState, SpendQuery } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const NOTE_MAX = 80

interface FavorEffect extends Effect { who: string; size: FavorSize; note?: string }
interface AddChange extends Change { dir: FavorDir; who: string; size: FavorSize; note?: string; at?: { day: number; hour: number; minute: number } }
interface SpendChange extends Change { dir?: FavorDir; id?: string; who?: string; size?: FavorSize }

/** favor.spend 要用掉的那一筆：指定了 id 就是那一筆；否則是這個大小（加上對象）最早記下的一筆。 */
function target(state: GameState, c: SpendChange): { dir: FavorDir; favor?: Favor } {
  const dir = c.dir ?? 'owed_to_pc'
  const list = favorsOf(state)[dir]
  if (c.id !== undefined) return { dir, favor: list.find((f) => f.id === c.id) }
  return { dir, favor: list.find((f) => f.size === c.size && (c.who === undefined || f.who === c.who)) }
}

function effectDef(kind: 'owed_to_pc' | 'owed', dir: FavorDir) {
  const group = `favor:${kind}`
  const describe = (e: FavorEffect, ctx: EffectCtx) => {
    const who = nameOf(ctx, ctx.state, e.who)
    return kind === 'owed_to_pc' ? `人情：${who}欠你一個${SIZE_NAME[e.size]}人情` : `人情：你欠${who}一個${SIZE_NAME[e.size]}人情`
  }
  return {
    kind, owner: OWNER,
    validate(raw: Record<string, unknown>, ctx: EffectCtx): string[] {
      const p: string[] = []
      const w = whoProblem(ctx.content, ctx.state, raw.who)
      if (w) p.push(w)
      if (!isSize(raw.size)) p.push(`size 只能是 ${SIZES.join('、')}`)
      if (raw.note !== undefined && !(isText(raw.note) && raw.note.length <= NOTE_MAX)) p.push(`note 要是一句話（${NOTE_MAX} 字以內）`)
      return p
    },
    // EVENTS 2.4 節：一件事最多一個小或中人情（只有 AI 給的才算；大的由 clamp 整筆拿掉）
    budget(e: FavorEffect, ctx: { level: string }) {
      if (ctx.level !== 'cap' || e.size === 'big') return null
      return { group, amount: 1, min: -Infinity, max: 1, resize: () => e, notice: () => '一件事最多只收一個人情，多的沒有算。' }
    },
    clamp(e: FavorEffect, ctx: { level: string }) {
      if (ctx.level === 'cap' && e.size === 'big') {
        return { effect: null, note: { from: 'big', to: null, limit: 'mid', notice: '人情只收小與中的，大人情不能這樣就記下，所以沒有算。' } }
      }
      return { effect: e }
    },
    toChanges: (e: FavorEffect): Change[] => [{ op: 'favor.add', dir, who: e.who, size: e.size, ...(e.note !== undefined ? { note: e.note } : {}) }],
    describe,
  }
}

export const favorsFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: FAVOR_RULE_KIND, owner: OWNER, validate: favorRuleProblems })

    k.changes.register<AddChange>({
      op: 'favor.add', owner: OWNER,
      validate(state, c) {
        const p: string[] = []
        if (!state.pc) p.push('還沒有主角，人情沒有地方記（人情只記在主角名下）')
        if (!isDir(c.dir)) p.push(`dir 只能是 ${DIRS.join('、')}`)
        if (!isText(c.who)) p.push('who 要是人或勢力的 id')
        else if (isCastRef(c.who)) p.push(`who：登場角色的代號 ${c.who} 還沒有換成真的人`)
        if (!isSize(c.size)) p.push(`size 只能是 ${SIZES.join('、')}`)
        if (c.note !== undefined && !(isText(c.note) && c.note.length <= NOTE_MAX)) p.push(`note 要是一句話（${NOTE_MAX} 字以內）`)
        if (c.at !== undefined && !(c.at && isSafeInt(c.at.day) && isSafeInt(c.at.hour) && isSafeInt(c.at.minute))) p.push('at 要是 { day, hour, minute }')
        return p
      },
      apply(state, c) {
        const f = favorsOf(state)
        f.seq += 1
        f[c.dir].push({ id: `fv_${f.seq}`, who: c.who, size: c.size, at: c.at ? { ...c.at } : { ...state.time }, ...(c.note !== undefined ? { note: c.note } : {}) })
        state.ext[EXT] = f
      },
      describe: (c, state) => (c.dir === 'owed_to_pc' ? `人情：記下${state.actors[c.who]?.name ?? c.who}欠你一個${SIZE_NAME[c.size]}人情` : `人情：記下你欠${state.actors[c.who]?.name ?? c.who}一個${SIZE_NAME[c.size]}人情`),
    })

    k.changes.register<SpendChange>({
      op: 'favor.spend', owner: OWNER,
      validate(state, c) {
        const p: string[] = []
        if (c.dir !== undefined && !isDir(c.dir)) p.push(`dir 只能是 ${DIRS.join('、')}`)
        if (c.id === undefined && !isSize(c.size)) p.push('要指定哪一筆（id），或這個大小（size）加上對象（who，可以不寫）')
        if (p.length) return p
        if (!target(state, c).favor) p.push(c.id !== undefined ? `沒有 ${c.id} 這一筆人情` : `沒有這個大小${c.who ? '、這個對象' : ''}的人情可以用掉`)
        return p
      },
      apply(state, c) {
        const { dir, favor } = target(state, c)
        const f = favorsOf(state)
        f[dir] = f[dir].filter((x) => x.id !== favor!.id)
        state.ext[EXT] = f
      },
      describe(c, state) {
        const { dir, favor } = target(state, c)
        if (!favor) return null
        const who = state.actors[favor.who]?.name ?? favor.who
        return dir === 'owed_to_pc' ? `人情：用掉${who}欠你的一個${SIZE_NAME[favor.size]}人情` : `人情：還清你欠${who}的一個${SIZE_NAME[favor.size]}人情`
      },
    })

    k.effects.register<FavorEffect>(effectDef('owed_to_pc', 'owed_to_pc'))
    k.effects.register<FavorEffect>(effectDef('owed', 'owed_by_pc'))

    k.conditions.register<Condition & { who?: string; size?: FavorSize; dir: FavorDir }>({
      kind: 'has_favor', owner: OWNER,
      validate: (raw) => [
        ...(isDir(raw.dir) ? [] : [`dir 只能是 ${DIRS.join('、')}`]),
        ...(raw.who === undefined || isText(raw.who) ? [] : ['who 要是人或勢力的 id']),
        ...(raw.size === undefined || isSize(raw.size) ? [] : [`size 只能是 ${SIZES.join('、')}`]),
      ],
      test: (c, { state }) => !!state.pc && favorsOf(state)[c.dir].some((f) => (c.who === undefined || f.who === c.who) && (c.size === undefined || f.size === c.size)),
    })

    const names: Record<FavorSize, string> = { small: '小人情', mid: '中人情', big: '大人情' }
    for (const size of SIZES) {
      k.stats.defineStat({
        id: `favor_${size}`, owner: OWNER, name: `${names[size]}（欠你的）`,
        base: (state, actor) => (actor === state.pc ? favorCount(state, size) : 0),
      })
    }
  },
}
