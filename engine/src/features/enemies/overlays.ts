// 敵方的無人機與砲塔（ENEMIES 第 10 節；dev/work/M1b-enemy-units.md）：這個功能只負責「把東西掛上去」與「會指揮的敵人多一個行動」；
// 一台怎麼動（每一輪自己動、被打到停機、自律）都在 features/summons，兩邊不互相 import，只透過核心的 BattleOverlay 與效果 drone.act 接起來。
//
//   開打時（battle.start）  origin.ext.enemies.overlays 的每一台（遭遇的 foes 裡 position.size 是 'overlay' 的兵種）掛在指定的一格，
//                          沒有操作者、auto: true；每個單位的 ext.enemies.attached（跟著主人的）掛上去：owner 是主人、autonomous: true
//   行動 enemy.command      身上有附屬單位的 AI 單位，1 點行動點讓他自己還沒動過的一台做一個動作（效果 drone.act），aiScore 2
//
// 約定（和 summons 共用的資料，寫在 BattleOverlay.ext）：stun === 2 是「被電磁打到、這個回合動不了」（command 的目標灰掉）；fixed 是不會移動。

import type { BattleActionDef, BattleOverlay, BattlePick, BattleRun, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Kernel } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, overlayAt, otherSide, targetWeight, unitsOf } from '../../core'
import type { EnemyAttached } from './kinds'
import { OWNER, resolveEnemy } from './kinds'
import { overlayInit } from './stats'
import { isRec, peekEnemy } from './unitdata'

/** 被電磁打到、這個回合動不了（summons 記在 ext.stun 的第二階段）。 */
const STUNNED = 2

const heldBy = (view: BattleView, u: BattleUnit): BattleOverlay[] => view.battle.overlays.filter((o) => o.owner === u.id && o.side === u.side && !o.down).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
const stunned = (o: BattleOverlay): boolean => o.ext?.stun === STUNNED
const blocksOf = (o: BattleOverlay): string[] => (o.used ? ['這一台這一回合動過了。'] : stunned(o) ? ['這一台被電磁打到，這個回合動不了。'] : [])

// ---- 開打時掛上去 ----

/** 這一方的空格裡，先照想要的順序，沒有再挑離 base 最近的；整排都掛滿了回傳 undefined。 */
function freeSlot(run: BattleRun, side: BattleUnit['side'], wanted: readonly number[], base: number): number | undefined {
  const free = (s: number): boolean => s >= 1 && s <= BATTLE_SLOTS && !overlayAt(run.battle, side, s)
  const first = wanted.find(free)
  if (first !== undefined) return first
  return Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).filter(free).sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || a - b)[0]
}

/** 開打時：遭遇帶來的（沒有操作者、auto）與主人帶著的（owner、autonomous）。 */
function hangAll(k: Pick<Kernel, 'content'>, run: BattleRun): void {
  const b = run.battle
  const allyCount = b.origin.headcount?.ally ?? Object.values(b.units).filter((u) => u.side === 'ally').length
  const side = 'foe' as const
  // 遭遇帶來的：沒寫格的照 position.prefer 的第一個空的
  const listed = isRec(b.origin.ext?.enemies) && Array.isArray(b.origin.ext!.enemies.overlays) ? (b.origin.ext!.enemies.overlays as unknown[]) : []
  for (const raw of listed) {
    if (!isRec(raw) || typeof raw.enemy !== 'string') continue
    const e = resolveEnemy(k.content, raw.enemy)
    const grade = typeof raw.grade === 'number' ? raw.grade : b.grade
    const init = overlayInit(k, run.state, raw.enemy, { grade, allyCount })
    const slot = freeSlot(run, side, [...(typeof raw.slot === 'number' ? [raw.slot] : []), ...e.position.prefer], e.position.prefer[0] ?? 1)
    if (slot === undefined) {
      run.say(`${e.name}沒有空的格子可以掛。`, 'overlay', { enemy: raw.enemy, none: true })
      continue
    }
    run.addOverlay({ ...init, side, slot, auto: true })
  }
  // 跟著主人的：主人倒下之後自律（E6）。主人在後方排隊（沒有格）時照他偏好的格
  for (const u of Object.values(b.units).sort((x, y) => x.id.localeCompare(y.id))) {
    const attached = peekEnemy(u).attached
    if (!Array.isArray(attached)) continue
    for (const a of attached as EnemyAttached[]) {
      if (!isRec(a) || typeof a.enemy !== 'string') continue
      const e = resolveEnemy(k.content, a.enemy)
      const home = u.slot >= 1 ? u.slot : (u.ai?.prefer_slots[0] ?? 1)
      const want = typeof a.slot === 'number' ? a.slot : home
      for (let i = 0; i < (a.count ?? 1); i++) {
        const slot = freeSlot(run, u.side, [want], want)
        if (slot === undefined) {
          run.say(`${u.name}的${e.name}沒有空的格子可以掛。`, 'overlay', { enemy: a.enemy, owner: u.id, none: true }, u)
          break
        }
        const init = overlayInit(k, run.state, a.enemy, { grade: u.grade, allyCount })
        run.addOverlay({ ...init, side: u.side, slot, owner: u.id, autonomous: true })
      }
    }
  }
}

// ---- 行動：指揮 ----

/** 這個人手上還沒動過、沒被停住的一台（AI 用）。 */
const nextFree = (view: BattleView, u: BattleUnit): BattleOverlay | undefined => heldBy(view, u).find((o) => !blocksOf(o).length)

/** 一台掛著的東西的替身挑目標用核心的 AI 權重：先看 ai_target_pct，全部被排除時當成沒有。 */
function pickFoe(run: BattleRun, o: BattleOverlay): BattleUnit | undefined {
  const me = run.standIn(o)
  const foes = unitsOf(run.battle, otherSide(o.side))
  return run.pick(foes, (t) => targetWeight(run, me, t)) ?? run.pick(foes, (t) => targetWeight(run, me, t, { ignorePct: true })) ?? foes[0]
}

const command: BattleActionDef = {
  id: 'enemy.command', owner: OWNER, name: '指揮', group: 'skill', icon: 'drone_command', modes: ['meat'], order: 6, target: 'overlay',
  desc: '讓自己的一台無人機做一次它的動作：開火、標記、急救或守著同一格的人。每台每回合一次，只花 1 點行動點。',
  cost: () => ({ ap: 1 }),
  has: (view, u) => u.control === 'ai' && heldBy(view, u).length > 0,
  targets: (view, u): BattleTargetOption[] => heldBy(view, u).map((o) => ({ target: { overlay: o.id }, blocks: blocksOf(o) })),
  // 對誰（pick.at：敵人的單位 id）：沒選就照 AI 的權重挑（敵人 AI 不送 pick）
  picks: (view, u): BattlePick[] => {
    const need: BattleTarget[] = heldBy(view, u).map((o) => ({ overlay: o.id }))
    if (!need.length) return []
    return [{ key: 'at', label: '對誰', kind: 'foe', required: false, options: unitsOf(view.battle, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: [], at: { unit: t.id }, for: need })) }]
  },
  aiScore: (view, u, target) => (target && nextFree(view, u) ? 2 : null),
  aiTarget: (view, u) => {
    const o = nextFree(view, u)
    return o ? { overlay: o.id } : null
  },
  run: (run, u, target, input) => {
    const o = target && 'overlay' in target ? run.battle.overlays.find((x) => x.id === target.overlay) : undefined
    if (!o || o.owner !== u.id || o.down) throw new BattleBlocked(['沒有這一台無人機。'])
    const why = blocksOf(o)
    if (why.length) throw new BattleBlocked(why)
    const chosen = typeof input.pick?.at === 'string' ? run.battle.units[input.pick.at] : undefined
    const foe = chosen && chosen.side !== u.side && chosen.slot >= 1 && !chosen.out ? chosen : pickFoe(run, o)
    // 做的事交給 summons 註冊的 drone.act：用它自己的武器（run.overlayAttack）、記這一台動過了
    run.effects([{ op: 'drone.act', which: 'target', at: 'pick:at' }], {
      user: u, target: { overlay: o.id }, pick: foe ? { at: foe.id } : {}, source: { kind: 'ability', id: 'enemy.command', name: '指揮' }, n: {},
    })
  },
}

export function registerOverlays(k: Kernel): void {
  k.battle.action(command)
  k.battle.on('battle.start', OWNER, ({ run }) => hangAll(k, run))
}
