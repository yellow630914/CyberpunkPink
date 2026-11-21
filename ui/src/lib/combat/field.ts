import { d20, type Rng } from './rng'

/**
 * 兩排四格的戰場（COMBAT_SYSTEM 第 2、3、10 節）：現實與內海共用的部分。
 * 站位、距離、遮蔽（現實是掩體，內海是防火牆）、補位、監視、換位、先攻、紀錄。純邏輯，畫面只讀狀態、呼叫方法。
 * 照 docs/mockups/combat-demo.html 與 net-demo.html 的原型改寫。
 */
export type Side = 'P' | 'E'
export interface Cover { l: 0 | 1 | 2; d: number }
/** 遮蔽的迴避加值與耐久：暴露 0、半掩體 +2（15）、掩體 +4（30） */
export const COVER_BONUS = [0, 2, 4] as const
export const COVER_DUR = [0, 15, 30] as const

export interface WeaponBase {
  n: string
  dice: number
  /** 有效距離 [近, 遠]：超出每格 −2 */
  r: [number, number]
  pen: number
  /** 長槍：站在第 1 格時 −4 */
  long?: boolean
  /** 遠距離（2 格以上）改用的骰數 */
  far?: number
  /** 命中時把對方推後一格 */
  push?: boolean
  /** 打在遮蔽上的倍率 */
  cm: number
  /** 狙擊：已經包含瞄準 */
  snipe?: boolean
  melee?: boolean
}

export interface BaseUnit {
  id: number; side: Side; slot: number; name: string; role: string
  load: number; loadMax: number; layers: number; layersMax: number
  ap: number; apMax: number; refl: number; gun: number; mel: number; will: number; tier: number; elite: boolean
  wi: number; aim: boolean; supp: number; watch: boolean; mv: boolean; down: boolean; out: boolean; ini: number
}
export interface LogLine { t: string; c?: 'h' | 'r' | 'g' }
export type EndResult = 'win' | 'lose' | 'fled' | 'surrender' | 'retreat' | 'located'
export interface BattleEnd { result: EndResult; text: string }
/** 一回合輪到誰：玩家、敵人、跳過（過載中、拉警報的白蕾絲），或已經結束 */
export type Phase = 'player' | 'enemy' | 'skip' | 'over'
export type Target = { kind: 'unit'; id: number } | { kind: 'slot'; side: Side; slot: number }

/** 兩個目標是不是同一個 */
export function sameTarget(a: Target, b: Target) {
  if (a.kind === 'unit') return b.kind === 'unit' && a.id === b.id
  return b.kind === 'slot' && a.side === b.side && a.slot === b.slot
}
export const emptyCover = (): Cover => ({ l: 0, d: 0 })
export const cover = (l: 0 | 1 | 2): Cover => ({ l, d: COVER_DUR[l] })

export abstract class SlotBattle<U extends BaseUnit> {
  round = 1
  idx = 0
  units: U[] = []
  order: number[] = []
  /** 索引 1～4 是格子；0 不用 */
  cov: { P: Cover[]; E: Cover[] }
  /** 站上暴露格子的人（監視用），等這個動作結算完再處理 */
  exq: number[] = []
  lines: LogLine[] = []
  end: BattleEnd | null = null
  /** 正在選目標的行動 */
  mode: string | null = null
  aiN = 0
  abstract readonly coverNames: readonly string[]
  abstract readonly wallWord: string

  constructor(public rng: Rng, covP: Cover[], covE: Cover[]) {
    this.cov = { P: [emptyCover(), ...covP.map(c => ({ ...c }))], E: [emptyCover(), ...covE.map(c => ({ ...c }))] }
  }

  // ---- 查詢 ----
  cur(): U { return this.units[this.order[this.idx]] }
  alive(side: Side) { return this.units.filter(u => u.side === side && !u.down) }
  at(side: Side, slot: number) { return this.units.find(u => u.side === side && u.slot === slot && !u.down) }
  /** 距離：雙方的格數相加減 1（雙方第 1 格是近身，距離 1） */
  dist(a: { slot: number }, b: { slot: number }) { return a.slot + b.slot - 1 }
  tag(u: U) { return (u.side === 'P' ? '' : '敵・') + u.name }
  sideWord(s: Side) { return s === 'P' ? '我方' : '敵方' }
  log(t: string, c?: LogLine['c']) { this.lines.push({ t, c }) }
  /** 距離修正：比有效距離近或遠，每格 −2；長槍在第 1 格 −4 */
  rangeMod(a: U, t: U, w: WeaponBase) {
    const d = this.dist(a, t)
    let m = 0
    if (d < w.r[0]) m = -2 * (w.r[0] - d)
    if (d > w.r[1]) m = -2 * (d - w.r[1])
    if (w.long && a.slot === 1) m -= 4
    return m
  }
  coverOf(u: { side: Side; slot: number }) { return this.cov[u.side][u.slot] }

  // ---- 先攻 ----
  rollInitiative() {
    this.units.forEach((u, i) => { u.id = i; u.ini = d20(this.rng) + u.refl })
    this.order = this.units.slice().sort((a, b) => b.ini - a.ini).map(u => u.id)
  }

  // ---- 遮蔽與站位 ----
  /** 前面的格子空著而且沒有遮蔽時，後排連同遮蔽往前補位 */
  compact(side: Side) {
    let moved = true
    while (moved) {
      moved = false
      for (let s = 1; s <= 3; s++) {
        if (!this.at(side, s) && this.cov[side][s].l === 0) {
          const back = this.units.filter(u => u.side === side && !u.down && u.slot > s)
          if (back.length) {
            back.forEach(u => u.slot--)
            const c = this.cov[side]
            for (let k = s; k < 4; k++) c[k] = c[k + 1]
            c[4] = emptyCover()
            this.log(`${this.sideWord(side)}後排連同${this.wallWord}往前補位。`)
            back.forEach(u => this.exposed(u))
            moved = true
            break
          }
        }
      }
    }
  }
  /** 遮蔽受傷：沒人站的格子耐久減半（傷害加倍）；打穿一級就降一級 */
  hurtCover(side: Side, slot: number, dmg: number) {
    const c = this.cov[side][slot]
    dmg = Math.round(dmg)
    if (c.l === 0 || dmg <= 0) return
    if (!this.at(side, slot)) dmg *= 2
    c.d -= dmg
    while (c.l > 0 && c.d <= 0) {
      c.l = (c.l - 1) as 0 | 1
      c.d += COVER_DUR[c.l]
      if (c.l === 0) { c.d = 0; this.exposed(this.at(side, slot)) }
      this.log(`${this.sideWord(side)}第 ${slot} 格的${this.wallWord}被打成${this.coverNames[c.l]}。`, 'h')
    }
    this.compact(side)
  }
  /** 有人站上暴露的格子：記下來給監視 */
  exposed(t: U | undefined) { if (t && !t.down && this.cov[t.side][t.slot].l === 0) this.exq.push(t.id) }
  /** 換位：和相鄰的隊友交換，或移到相鄰的空格 */
  move(u: U, to: number) {
    const o = this.at(u.side, to)
    const from = u.slot
    if (o) o.slot = from
    u.slot = to
    this.log(this.tag(u) + (o ? ` 和 ${o.name} 換位。` : ` 移到第 ${to} 格。`))
    this.exposed(u); this.exposed(o)
    this.compact(u.side)
  }
  /** 能不能換到那一格：被壓制不行；往後退而且前面要空著時，原本那一格要有遮蔽 */
  canMoveBase(u: U, to: number) {
    if (to < 1 || to > 4 || u.supp) return false
    if (this.at(u.side, to)) return true
    if (to > u.slot) return this.cov[u.side][u.slot].l > 0
    return true
  }
  abstract canMove(u: U, to: number): boolean
  abstract canHit(u: U, t: U): boolean
  abstract attack(a: U, t: U, o?: { burst?: boolean }): void
  /** 監視：每個站上暴露格子的人，找一個在監視而且打得到他的敵人，自動開一槍 */
  flushWatch() {
    let g = 0
    while (this.exq.length && !this.end && g++ < 24) {
      const t = this.units[this.exq.shift()!]
      if (!t || t.down || this.cov[t.side][t.slot].l !== 0) continue
      const u = this.units.find(x => x.side !== t.side && !x.down && x.watch && this.canHit(x, t))
      if (!u) continue
      u.watch = false
      this.log(`${this.tag(u)} 監視觸發：${this.tag(t)} 站上了暴露的格子。`, 'h')
      this.attack(u, t)
    }
    this.exq.length = 0
  }

  // ---- 回合 ----
  /** 結束這個人的回合，輪到下一個 */
  abstract endTurn(): Phase
  /** 這一輪剩下誰（先攻條） */
  orderView() {
    return this.order.map((id, i) => ({ u: this.units[id], now: i === this.idx && !this.end })).filter(x => !x.u.down)
  }
  finish(result: EndResult, text: string, line: string) {
    if (this.end) return
    this.end = { result, text }
    this.mode = null
    this.log(line, 'h')
  }
}
