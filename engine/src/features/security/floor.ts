// L6 功能 security 的敵對值下限（FACTIONS 6.3 節；EVENTS 2.4 節的兩列 `hostility_floor`；dev/adr/0017 M2 修 bug 批的補記）。
//
// 下限有兩種來源，同一個勢力可以同時有好幾個，**取最高的，不相加**，各自到期各自解除：
//   永久的   量表 hostility_floor（事件效果 { kind: 'hostility_floor', key, amount } 加在它身上；一般事件 AI 一件事最多 +5，內建的照寫的算）
//   有期限的 { kind: 'hostility_floor', key, amount, days }：這個勢力的敵對值至少是 amount，持續 days 天（戰敗與契約事件，例：鎖橋、隔離的 +10）。
//            amount 是下限本身，不是「再加多少」。AI 生成的事件與玩家要的結果不能用（只有內建的事件資料）。記在 state.ext.security_floors.floors
// 量表 hostility 的下限 = max(永久的量表、現在還沒到期的有期限下限)：核心夾值時問 MeterDef.floorOf（到期不用掃，看 state.time 就知道）。
// 有期限的下限到期之後敵對值留在原處，之後照每週消退往下走；抬高的當下，敵對值會被推到下限之上（standingBefore）。

import type { Change, Effect, EffectCtx, EffectDef, GameState, Kernel, MeterDef } from '../../core'
import { effectLevel, isRecord, isSafeInt, meterEffectDef, meterKeyLabel, meterOf, toMinutes } from '../../core'
import { OWNER } from './model'

export const FLOOR_METER = 'hostility_floor'
/** state.ext 的鍵：有期限的下限 { floors: TimedFloor[] }。和 security（每週消退的記號）分開，兩邊各寫各的，不會互相蓋掉 */
export const FLOORS_EXT = 'security_floors'
/** 有期限的下限的變更：security.floor { key（勢力）, value, until（總分鐘） } */
export const FLOOR_CHANGE = 'security.floor'
/** 有期限的下限最長幾天（防呆；一年） */
export const MAX_FLOOR_DAYS = 365

export interface TimedFloor {
  faction: string
  value: number
  /** 到這一分鐘為止（不含）有效 */
  until: number
}

/** 永久的那個量表的定義：AI 一件事最多 +5、不能降（EVENTS 2.4 節）；同名的效果由 registerFloor 自己註冊（多收 days） */
export const FLOOR_DEF: MeterDef = { kind: FLOOR_METER, owner: OWNER, name: '敵對值的下限', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 0, up: 5 }, ownEffect: true }

/** 存檔裡的有期限下限（壞的一筆略過，不讓壞檔擋住遊戲）。 */
export function timedFloors(state: Pick<GameState, 'ext'>): TimedFloor[] {
  const raw = state.ext[FLOORS_EXT]
  const list = isRecord(raw) ? raw.floors : undefined
  if (!Array.isArray(list)) return []
  return list.filter((x): x is TimedFloor => isRecord(x) && typeof x.faction === 'string' && x.faction !== '' && isSafeInt(x.value) && x.value > 0 && isSafeInt(x.until))
    .map((x) => ({ faction: x.faction, value: x.value, until: x.until }))
}

/** 這個勢力在 at（總分鐘，預設現在）還沒到期的有期限下限裡最高的那個（沒有是 0）。 */
export function timedFloorAt(state: Pick<GameState, 'ext' | 'time'>, faction: string, at: number = toMinutes(state.time)): number {
  let top = 0
  for (const f of timedFloors(state)) if (f.faction === faction && f.until > at && f.value > top) top = f.value
  return top
}

/** 這個勢力現在（或 at）的下限：永久的與有期限的取最高的，不相加。 */
export function floorOf(k: Pick<Kernel, 'meters'>, state: GameState, faction: string, at: number = toMinutes(state.time)): number {
  return Math.max(meterOf(k, state, FLOOR_METER, faction), timedFloorAt(state, faction, at))
}

interface FloorEffect extends Effect { key: string; amount: number; days?: number; adjusted?: boolean }

/** 登記效果 hostility_floor（多收 days）與變更 security.floor。要在 k.meters.define(FLOOR_DEF) 之前。 */
export function registerFloor(k: Kernel): void {
  const base = meterEffectDef(FLOOR_DEF, k.meters) as unknown as EffectDef<FloorEffect>
  k.effects.register<FloorEffect>({
    ...base,
    owner: OWNER,
    validate(raw: Record<string, unknown>, ctx: EffectCtx) {
      const p = base.validate(raw, ctx)
      if (raw.days === undefined) return p
      if (!(isSafeInt(raw.days) && raw.days >= 1 && raw.days <= MAX_FLOOR_DAYS)) p.push(`days 要是 1～${MAX_FLOOR_DAYS} 的整數（持續幾天）`)
      else if (effectLevel(raw as Effect, ctx) !== 'builtin') p.push('有期限的下限（days）只有戰敗與契約事件的資料能用；AI 生成的事件與玩家要的結果不能用')
      if (isSafeInt(raw.amount) && !(raw.amount >= 1 && raw.amount <= 100)) p.push('有期限的下限，amount（下限本身）要是 1～100 的整數')
      return p
    },
    // 有期限的：不算進 AI 的合計（AI 不能用）、不照現在的值夾（它是下限本身）；永久的照量表的規矩
    budget: (e, ctx) => (e.days === undefined ? base.budget?.(e, ctx) ?? null : null),
    clamp: (e, ctx) => (e.days === undefined ? base.clamp!(e, ctx) : { effect: e }),
    toChanges: (e, ctx) => (e.days === undefined
      ? base.toChanges(e, ctx)
      : [{ op: FLOOR_CHANGE, key: e.key, value: e.amount, until: toMinutes(ctx.state.time) + e.days * 1440 } as Change]),
    describe: (e, ctx) => {
      if (e.days === undefined) return base.describe(e, ctx)
      const label = meterKeyLabel(FLOOR_DEF, e.key, ctx.state, ctx.content)
      return `${FLOOR_DEF.name}${label ? `（${label}）` : ''}：至少 ${e.amount}，${e.days} 天`
    },
  })

  k.changes.register<Change & { key: string; value: number; until: number }>({
    op: FLOOR_CHANGE, owner: OWNER,
    validate: (_s, c) => [
      ...(typeof c.key === 'string' && c.key ? [] : ['key 要是勢力的 id']),
      ...(isSafeInt(c.value) && c.value >= 1 && c.value <= 100 ? [] : ['value 要是 1～100 的整數']),
      ...(isSafeInt(c.until) && c.until >= 0 ? [] : ['until 要是 0 以上的整數（總分鐘）']),
    ],
    apply(state, c) {
      const now = toMinutes(state.time)
      // 順手把已經到期的拿掉（沒有別的地方會掃）
      state.ext[FLOORS_EXT] = { floors: [...timedFloors(state).filter((f) => f.until > now), { faction: c.key, value: c.value, until: c.until }] }
    },
    describe: (c) => `敵對值（${c.key}）的下限至少 ${c.value}（有期限）`,
  })
}
