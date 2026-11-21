import { SlotBattle, COVER_BONUS, COVER_DUR, cover, sameTarget, type BaseUnit, type Cover, type Phase, type Target, type WeaponBase, type Side } from './field'
import { d20, d6, clamp, pick, type Rng } from './rng'
import type { RingAction } from './real'

/**
 * 內海戰鬥（CYBERSPACE 第 5～7 節、NETRUNNING）。照 docs/mockups/net-demo.html 改寫成純邏輯：
 * 只有感載一條；遮蔽換成防火牆；RAM（攻擊與管理行動花它）；同步檔位（淺、標準、深、全）；餘韻（每層檢定 +1、傷害 +10%）；
 * 追蹤度（每回合 +3，30 白蕾絲、60 對方的潛網者、90 定位）；潛網者的管理行動（造牆、拆牆、斷路、標記、擦痕跡）；拔線與投降；彈幕。
 */
export interface NetWeapon extends WeaponBase { cost: number; jam?: boolean }
export const NET_WEAPONS: Record<string, NetWeapon> = {
  pulse: { n: '脈衝槍', dice: 4, r: [3, 7], cost: 1, pen: 2, long: true, cm: 0.5 },
  scatter: { n: '散射炮', dice: 5, far: 3, r: [1, 3], cost: 1, pen: 0, push: true, cm: 1.5 },
  needle: { n: '光針', dice: 3, r: [1, 4], cost: 1, pen: 0, cm: 0.25 },
  stream: { n: '連流', dice: 3, r: [2, 5], cost: 1, pen: 0, cm: 0.5 },
  lance: { n: '長矛', dice: 6, r: [5, 7], cost: 2, pen: 4, long: true, cm: 0.25, snipe: true },
  jam: { n: '干擾針', dice: 3, r: [2, 5], cost: 1, pen: 0, jam: true, cm: 2 },
  blade: { n: '光刃', dice: 3, r: [1, 1], cost: 1, pen: 1, melee: true, cm: 0 },
}
export const NET_COVER_NAMES = ['暴露', '半牆', '防火牆'] as const
/** 同步檔位：檢定的加值、受到的感載的倍率（CORE_RULES 第 5 節） */
export const SYNC = [{ n: '淺', c: -2, m: 0.5 }, { n: '標準', c: 0, m: 1 }, { n: '深', c: 2, m: 1.5 }, { n: '全', c: 4, m: 2.5 }] as const
/** 彈幕：觀眾看到這些事時會刷的字 */
export const DANMAKU: Record<string, string[]> = {
  crit: ['要害ｷﾀ━(ﾟ∀ﾟ)━!', '這發神了', '8888888', '好準'],
  over: ['過載了ww', '草', '臉紅了臉紅了', '尊い……', '再來一發！'],
  fall: ['斷線了', 'GG', '辛苦了～', '下一位'],
  pin: ['釘住了！！', '逮到', '這個可以截圖嗎', '太色了吧'],
  wall: ['牆來了', '管理員大人', '駭客好帥'],
  trace: ['警報響了', '快跑啊', '保全來了ww', '要被抓包了'],
}

export interface NetUnit extends BaseUnit {
  skin: string; av: 'cat' | 'lace' | 'bot'
  ram: number; ramMax: number; rr: number; prot: number; intf: number; xd: number
  sync: number; syncMax: number; admin: number; white: boolean
  ws: string[]
  flash: boolean; mark: boolean; cut: boolean; jam: boolean; unp: boolean; shifted: boolean; adm: number
  /** 難度的傷害係數，只用在敵人 */
  dmgMult: number
}
export interface NetUnitSpec {
  name: string; skin: string; av: NetUnit['av']; lm: number; lay: number; ap: number; ram: number; rr?: number; prot?: number; refl: number
  gun?: number; mel?: number; will?: number; intf?: number; tier?: number; elite?: boolean; xd?: number; sync?: number; sm?: number; admin?: number; white?: boolean; dmg?: number; ws: string[]
}
export interface NetSetup {
  party: NetUnitSpec[]; foes: NetUnitSpec[]; covP?: Cover[]; covE?: Cover[]; trace?: number; view?: number
  /** 第四版：在節點上下載（CYBERSPACE 8.3 節：待在節點上 2～4 回合，期間不能離開；每回合追蹤度 +2）。holder 是守著節點的那個人 */
  download?: { rounds: number; holder: string; what: string; wave?: NetUnitSpec }
  /** 子網是誰的：60 的時候上線的是誰（對方的潛網者或精英蕾絲）、定位之後幾回合斷線（星旗 2，其他 3） */
  owner?: string
}
/** 追蹤度到 60 的增援（CYBERSPACE 6.8 節：對方的潛網者或一隻精英蕾絲）；格子滿了就排隊，空出來再上線 */
export const T60_UNITS: Record<string, NetUnitSpec> = {
  runner: { name: '企業潛網者', skin: '制服型', av: 'cat', lm: 37, lay: 2, ap: 5, ram: 6, rr: 3, prot: 1, refl: 0, gun: 3, will: 3, tier: 2, elite: true, xd: 1, sync: 2, sm: 2, ws: ['pulse'] },
  lace: { name: '粉蕾絲・女僕長', skin: '女僕長', av: 'lace', lm: 37, lay: 2, ap: 5, ram: 6, rr: 3, prot: 1, refl: 0, gun: 3, will: 3, tier: 2, elite: true, xd: 1, sync: 2, sm: 2, ws: ['pulse', 'needle'] },
}

export const NET_ACTIONS: RingAction[] = [
  { k: 'shoot', n: '攻擊', c: 2, g: 'atk', icon: 'shoot', tg: 'foe', ram: '1（長矛 2）', d: '用手上的武器構裝攻擊一個敵人。長矛（狙擊型）一擊 3 點，已經包含瞄準：命中 +3，要害時破損。', w: '手上是近戰構裝、RAM 不夠，或武器被干擾' },
  { k: 'melee', n: '近戰', c: 2, g: 'atk', icon: 'melee', tg: 'melee', ram: '1', d: '打近身（雙方第 1 格）的敵人。', w: '手上不是近戰構裝、RAM 不夠，或近身沒有敵人' },
  { k: 'reload', n: '回填', c: 1, g: 'res', icon: 'reload', ram: '—', d: 'RAM +2（潛網者 +3）。', w: 'RAM 是滿的' },
  { k: 'swap', n: '換構裝', c: 1, g: 'res', icon: 'swap', ram: '0', d: '換成另一個武器構裝。', w: '只有一個武器構裝' },
  { k: 'item', n: '腳本', c: 1, g: 'res', icon: 'item', ram: '0', d: '一次性的冷卻腳本：自己的感載 −2d6。', w: '沒有腳本了' },
  { k: 'move', n: '換位', c: 1, g: 'tac', icon: 'move', tg: 'slot', ram: '0', d: '和相鄰的隊友交換，或移到相鄰的空格。', w: '沒有可以換的格，或被壓制、被斷路' },
  { k: 'cover', n: '打牆', c: 2, g: 'tac', icon: 'cover', tg: 'ecov', ram: '1', d: '不打人，直接打敵方一格的防火牆；倍率加倍。', w: '手上是近戰構裝、RAM 不夠，或敵方沒有牆' },
  { k: 'watch', n: '監視', c: 2, g: 'tac', icon: 'watch', ram: '0（觸發時照扣）', d: '到你的下一回合開始前，第一次有敵人站上暴露的格子，自動攻擊他一次，不另花行動點，RAM 照扣。', w: '已經在監視' },
  { k: 'subdue', n: '釘住', c: 2, g: 'tac', icon: 'subdue', tg: 'sub', ram: '1', d: '把餘韻疊滿的近身敵人釘在線上，讓他退出戰鬥。要過檢定。', w: '沒有可以釘的目標（要在近身、對方餘韻疊滿），或 RAM 不夠' },
]
/** 管理行動（NETRUNNING 第 3 節）：潛網者才有，花 RAM，每回合的次數等於主控的階數；每次追蹤度 +1，介面對 12 失敗再 +5 */
export const NET_ADMIN = [
  { k: 'wall', n: '造牆', c: 2, d: '我方一格的防火牆升一級，耐久補滿。', tg: 'pcov' as const },
  { k: 'breach', n: '拆牆', c: 2, d: '敵方一格的防火牆降一級。', tg: 'ecov' as const },
  { k: 'cut', n: '斷路', c: 2, d: '一個敵人這一回合不能換位。', tg: 'foe' as const },
  { k: 'mark', n: '標記', c: 1, d: '全隊打他 +2，直到他下次過載。', tg: 'foe' as const },
  { k: 'wipe', n: '擦痕跡', c: 1, d: '追蹤度 −5。' },
]

function makeUnit(side: Side, slot: number, o: NetUnitSpec): NetUnit {
  return {
    id: 0, side, slot, name: o.name, role: o.skin, skin: o.skin, av: o.av, load: 0, loadMax: o.lm, layers: 0, layersMax: o.lay,
    ap: o.ap, apMax: o.ap, ram: o.ram, ramMax: o.ram, rr: o.rr ?? 2, prot: o.prot ?? 0, refl: o.refl, gun: o.gun ?? 0, mel: o.mel ?? 0, will: o.will ?? 0, intf: o.intf ?? 0,
    tier: o.tier ?? 1, elite: !!o.elite, xd: o.xd ?? 0, sync: o.sync ?? 1, syncMax: o.sm ?? 1, admin: o.admin ?? 0, white: !!o.white,
    ws: o.ws, wi: 0, aim: false, supp: 0, watch: false, mv: false, unp: false, flash: false, mark: false, cut: false, jam: false, down: false, out: false, shifted: false, adm: 0, ini: 0, dmgMult: o.dmg ?? 1,
  }
}

export class NetBattle extends SlotBattle<NetUnit> {
  readonly coverNames = NET_COVER_NAMES
  readonly wallWord = '防火牆'
  trace: number
  t30 = false
  t60 = false
  /** 被定位後剩幾回合強制斷線；−1 是還沒被定位 */
  loc = -1
  view: number
  /** 新的彈幕（畫面拿去飄，飄完就丟） */
  danmaku: Array<{ id: number; text: string }> = []
  scripts: Record<number, number> = {}
  private dmSeq = 1
  /** 第四版：下載（剩幾回合、誰守著、斷了沒）與排隊的增援、現實的保全有沒有進入警戒 */
  dl: { left: number; total: number; holder: number; what: string; broken: boolean; wave?: NetUnitSpec } | null = null
  queue: NetUnitSpec[] = []
  realAlert = false
  owner: string

  constructor(setup: NetSetup, rng: Rng) {
    super(rng, setup.covP ?? [cover(1), cover(2), cover(2), cover(1)], setup.covE ?? [cover(1), cover(2), cover(1), cover(2)])
    setup.party.forEach((p, i) => this.units.push(makeUnit('P', i + 1, p)))
    setup.foes.forEach((p, i) => this.units.push(makeUnit('E', i + 1, p)))
    this.trace = setup.trace ?? 15
    this.view = setup.view ?? 12480
    this.rollInitiative()
    this.units.filter(u => u.side === 'P').forEach(u => { this.scripts[u.id] = 1 })
    this.owner = setup.owner ?? '藍鯨物流'
    if (setup.download) {
      const h = this.units.find(u => u.side === 'P' && u.name === setup.download!.holder) ?? this.units.find(u => u.side === 'P')!
      this.dl = { left: setup.download.rounds, total: setup.download.rounds, holder: h.id, what: setup.download.what, broken: false, wave: setup.download.wave }
      this.log(`${h.name}守在節點上下載${setup.download.what}：要撐 ${setup.download.rounds} 回合，期間不能離開這一格。`, 'h')
    }
    this.log('潛入完成。第一回合所有人的行動點與 RAM 都從上限開始。', 'h')
  }

  wp(u: NetUnit) { return NET_WEAPONS[u.ws[u.wi]] }
  dm(kind: keyof typeof DANMAKU) {
    if (this.danmaku.length > 7) return
    this.danmaku.push({ id: this.dmSeq++, text: pick(this.rng, DANMAKU[kind]) })
    this.view += Math.floor(200 + this.rng() * 900)
  }
  /** 迴避 = 10 ＋ 反應 ＋ 防火牆（內海沒有餘韻的迴避懲罰） */
  dodge(u: NetUnit) { return 10 + u.refl + COVER_BONUS[this.coverOf(u).l] }
  /** 命中的加值：槍械或格鬥 ＋ 距離 ＋ 瞄準 − 壓制 ＋ 餘韻（內海裡每層 +1）＋ 同步檔位 ＋ 標記 */
  bonus(a: NetUnit, t: NetUnit, w: NetWeapon) { return (w.melee ? a.mel : a.gun) + this.rangeMod(a, t, w) + (a.aim || w.snipe ? 3 : 0) - (a.supp ? 2 : 0) + a.layers + SYNC[a.sync].c + (t.mark ? 2 : 0) }
  hitChance(a: NetUnit, t: NetUnit, w = this.wp(a)) { return clamp((21 - (this.dodge(t) - this.bonus(a, t, w))) * 5, 5, 95) }
  /** 感載 = 骰數扣（防護 − 穿透），乘（1 ＋ 攻擊者餘韻 × 10%）與目標的同步檔位倍率 */
  netLoad(a: NetUnit, t: NetUnit, raw: number, w: NetWeapon) { const base = Math.max(0, raw - Math.max(0, t.prot - w.pen)); return Math.round(base * (1 + 0.1 * a.layers) * SYNC[t.sync].m * (a.side === 'E' ? a.dmgMult : 1)) }

  fall(u: NetUnit, how: string) { u.down = true; this.log(this.tag(u) + how, u.side === 'P' ? 'r' : 'g'); this.compact(u.side); this.check() }
  addLoad(t: NetUnit, n: number) {
    t.load += n
    if (t.load >= t.loadMax) {
      t.load = 0
      t.layers++
      t.mark = false
      if (t.layers > t.layersMax) { this.dm('fall'); this.fall(t, ' 餘韻疊滿後再過載：斷線。') }
      else { t.ram = 0; t.flash = true; this.dm('over'); this.log(`${this.tag(t)} 過載！閃斷：RAM 歸零。餘韻 ${t.layers} 層（檢定 +${t.layers}、傷害 +${t.layers * 10}%）。`, 'h') }
    }
  }
  attack(a: NetUnit, t: NetUnit, o: { burst?: boolean } = {}) {
    const w = this.wp(a), n = o.burst ? a.ram : w.cost
    a.ram -= n
    const r = d20(this.rng), bonus = this.bonus(a, t, w), tot = r + bonus, dg = this.dodge(t), cb = COVER_BONUS[this.coverOf(t).l]
    const aimed = a.aim || !!w.snipe
    a.aim = false
    let dice = (w.far && this.dist(a, t) > 2 ? w.far : w.dice) + (o.burst ? n - 1 : 0) + a.xd
    const hit = r === 20 || (r !== 1 && tot >= dg), crit = hit && tot - dg >= 5
    const msg = `${this.tag(a)}${o.burst ? ` 用${w.n}超頻（RAM ${n}）` : ` 用${w.n}攻擊`} ${this.tag(t)}：d20=${r}${bonus >= 0 ? '+' : ''}${bonus}=${tot} 對迴避 ${dg}，`
    if (!hit) {
      this.log(msg + (r === 1 ? '自然 1，' : '') + (r !== 1 && cb && tot >= dg - cb ? '被防火牆擋下。' : '沒打中。'))
      if (cb && w.cm) { const v = d6(this.rng, dice) * w.cm; this.log(`防火牆受 ${Math.round(v)}（${w.n} ×${w.cm}）。`); this.hurtCover(t.side, t.slot, v) }
    } else {
      if (crit) { dice++; this.dm('crit') }
      const wound = r === 20 || (crit && aimed)
      if (wound && !t.elite && t.side === 'E') dice++
      const raw = d6(this.rng, dice)
      if (cb && w.cm) { this.log(`防火牆受 ${Math.round(raw * w.cm)}（${w.n} ×${w.cm}）。`); this.hurtCover(t.side, t.slot, raw * w.cm) }
      if (w.jam) { t.jam = true; this.log(`${msg}命中：干擾。${this.tag(t)} 的武器構裝停用一回合。`, 'h') }
      else {
        const v = this.netLoad(a, t, raw, w)
        this.log(`${msg}${r === 20 ? '自然 20！' : crit ? '要害！' : '命中，'}感載 ${raw}，扣防護、乘${SYNC[t.sync].n}檔後 +${v}。`)
        if (wound && (t.elite || t.side === 'P') && t.prot > 0) { t.prot = 0; this.log(`${this.tag(t)} 破損：防護構裝失效。`, 'h') }
        this.addLoad(t, v)
        if (!t.down && w.push && t.slot < 4) {
          const b = this.at(t.side, t.slot + 1), os = t.slot
          if (b) b.slot = os
          t.slot = os + 1
          this.log(`${this.tag(t)} 被轟退一格。`)
          this.exposed(t); this.exposed(b); this.compact(t.side)
        }
      }
    }
    if (o.burst && !t.down) {
      const sv = d20(this.rng) + t.will, dc = 10 + n * 2
      if (sv < dc) { t.supp = 1; this.log(`${this.tag(t)} 被壓制（定力 ${sv} 對 ${dc}）：不能換位、攻擊 −2。`, 'h') }
      else this.log(`${this.tag(t)} 撐住了壓制（定力 ${sv} 對 ${dc}）。`)
    }
  }
  check() {
    if (this.end) return
    const p = this.alive('P').length, e = this.alive('E').filter(u => !u.white).length
    if (!p && this.units.filter(u => u.side === 'P').every(u => u.unp)) this.finish('retreat', '全隊拔線：等於撤退。委託副本裡是回退到進副本之前。', '撤退。')
    else if (!p) this.finish('lose', '全隊斷線或被釘住：戰敗。贏的是粉蕾絲，所以正式的遊戲裡這裡會接「被釘在線上」的活捉事件。', '戰敗。')
    else if (!e && !(this.dl && !this.dl.broken && this.dl.left > 0 && this.queue.length)) this.finish('win', `敵人全部斷線或被釘住：勝利。${this.dl && !this.dl.broken && this.dl.left > 0 ? `下載還差 ${this.dl.left} 回合，你們守住了節點，把它跑完。` : ''}餘韻會跟著回到現實（每層全屬性 −2）。`, '勝利。')
  }
  /** 追蹤度到了門檻就上線新的敵人：30 白蕾絲（不打人，每回合追蹤度 +5）、60 對方的潛網者；90 被定位，三回合後強制斷線 */
  spawn(o: NetUnitSpec, queue = false): boolean {
    for (let s = 1; s <= 4; s++) {
      if (!this.at('E', s)) {
        const u = makeUnit('E', s, o)
        u.id = this.units.length
        this.units.push(u)
        this.order.push(u.id)
        return true
      }
    }
    if (queue) { this.queue.push(o); this.log(`${o.name}在線外排隊：前面空出一格就上線。`, 'r'); return true }
    return false
  }
  /** 排隊的增援：前面有空格就上線 */
  drainQueue() {
    while (this.queue.length && [1, 2, 3, 4].some(s => !this.at('E', s))) {
      const o = this.queue.shift()!
      this.spawn(o)
      this.log(`增援上線：${o.name}。`, 'r')
    }
  }
  traceCheck() {
    if (this.end) return
    if (this.trace >= 30 && !this.t30 && this.spawn({ name: '白蕾絲', skin: '警報型', av: 'lace', lm: 22, lay: 1, ap: 0, ram: 0, refl: 0, white: true, ws: ['needle'] })) {
      this.t30 = true; this.dm('trace'); this.log('追蹤度到 30：白蕾絲上線。牠不打人，每回合讓追蹤度 +5。', 'r')
    }
    if (this.trace >= 60 && !this.t60) {
      // 對方的潛網者或一隻精英蕾絲（照子網是誰的）；格子滿了就排隊。現實的保全同時進入警戒（NETRUNNING 第 5 節）
      const o = this.owner === '星旗防務' || this.owner === '天使急救' ? T60_UNITS.lace : T60_UNITS.runner
      this.t60 = true; this.realAlert = true; this.spawn(o, true); this.dm('trace')
      this.log(`追蹤度到 60：確認入侵。${o.name}上線；現實的保全進入警戒。`, 'r')
    }
    if (this.trace >= 90 && this.loc < 0) { this.loc = this.owner === '星旗防務' ? 2 : 3; this.dm('trace'); this.log(`追蹤度到 90：被定位。${this.loc} 回合後全隊強制斷線。`, 'r') }
  }
  beginTurn(): Phase {
    for (let guard = 0; guard < 64; guard++) {
      if (this.end) return 'over'
      const u = this.cur()
      this.aiN = 0
      if (u.down) { this.advance(); if (this.end) return 'over'; continue }
      if (this.round > 1) { u.ap = Math.min(u.apMax, u.ap + 3 + (u.sync === 3 ? 1 : 0)); u.ram = Math.min(u.ramMax, u.ram + u.rr) }
      u.watch = false; u.mv = false; u.shifted = false; u.adm = 0
      if (u.white) { this.trace += 5; this.log('白蕾絲拉警報：追蹤度 +5。', 'r'); this.traceCheck(); return 'skip' }
      this.mode = null
      return u.side === 'E' ? 'enemy' : 'player'
    }
    return 'over'
  }
  advance() {
    const u = this.cur()
    if (u) { if (u.supp > 0) u.supp--; u.cut = false; u.jam = false; u.flash = false }
    this.idx++
    if (this.idx >= this.order.length) {
      this.idx = 0
      this.round++
      this.trace += 3
      this.log(`—— 第 ${this.round} 回合 ——（追蹤度 +3）`, 'h')
      this.downloadTick()
      if (this.end) return
      this.drainQueue()
      if (this.loc > 0) {
        this.loc--
        if (this.loc === 0) { this.finish('located', '被定位：全隊被強制斷線。現實的增援已經在去接入點的路上。', '被定位。'); return }
      }
      this.traceCheck()
    }
  }
  start(): Phase { return this.beginTurn() }
  endTurn(): Phase { if (this.end) return 'over'; this.mode = null; this.advance(); return this.beginTurn() }

  canHit(u: NetUnit, t: NetUnit) { const w = this.wp(u); return !u.jam && u.ram >= w.cost && (!w.melee || this.dist(u, t) === 1) }
  /** 守著節點下載的人不能換位（CYBERSPACE 8.3 節：期間不能離開） */
  canMove(u: NetUnit, to: number) { return !u.cut && !this.holding(u) && this.canMoveBase(u, to) }
  holding(u: NetUnit) { return !!this.dl && !this.dl.broken && this.dl.left > 0 && this.dl.holder === u.id }
  /** 每回合結束：守著的人還在就下載一回合（追蹤度 +2）；每兩回合一波守衛程式；跑完就結束這一場 */
  downloadTick() {
    const d = this.dl
    if (!d || d.broken || d.left <= 0) return
    const h = this.units[d.holder]
    if (h.down) { d.broken = true; this.log(`${h.name}離開了節點：下載中斷。`, 'r'); return }
    d.left--
    this.trace += 2
    this.log(`下載 ${d.total - d.left}／${d.total}：追蹤度 +2。`, 'h')
    if (d.left <= 0) { this.finish('win', `下載完成：${d.what}到手了。${h.name}守住了節點，全隊從後門登出。`, '下載完成。'); return }
    if (d.wave && (d.total - d.left) % 2 === 0) { this.spawn({ ...d.wave }, true); this.log(`下載的流量被察覺：${d.wave.name}趕過來。`, 'r') }
  }
  canPin(a: NetUnit, t: NetUnit) { return a.slot === 1 && t.slot === 1 && !t.down && t.layers >= t.layersMax }
  pin(a: NetUnit, t: NetUnit) {
    a.ram--
    const r = d20(this.rng) + Math.max(a.mel, a.intf) + SYNC[a.sync].c + a.layers, dc = 10 + t.tier * 2
    if (r >= dc) { t.out = true; this.dm('pin'); this.fall(t, ` 被釘在線上，退出戰鬥（${r} 對 ${dc}）。`) }
    else this.log(`${this.tag(a)} 想釘住 ${this.tag(t)}，沒釘牢（${r} 對 ${dc}）。`)
  }
  refill(u: NetUnit) { u.ram = Math.min(u.ramMax, u.ram + (u.admin ? 3 : 2)); this.log(`${this.tag(u)} 回填 RAM。`) }

  // ---- 敵人的 AI ----
  aiStep(): boolean {
    const u = this.cur()
    if (this.end || u.down || this.aiN > 6 || u.ap <= 0) return false
    this.aiN++
    const foes = this.alive('P'), w = this.wp(u)
    let did = false
    const sub = foes.find(t => this.canPin(u, t))
    if (sub && u.ap >= 2 && u.ram >= 1) { u.ap -= 2; this.pin(u, sub); did = true }
    else if (u.jam || u.ram < w.cost) { if (u.ram < u.ramMax && u.ap >= 1) { u.ap--; this.refill(u); did = true } }
    else if (w.melee) {
      const t = foes.find(t => this.dist(u, t) === 1)
      if (t && u.ap >= 2) { u.ap -= 2; this.attack(u, t); did = true }
      else if (!t && u.ws.length > 1 && u.ap >= 1) { u.ap--; u.wi = 1; this.log(`${this.tag(u)} 換成${this.wp(u).n}。`); did = true }
    } else {
      const t = foes.slice().sort((a, b) => this.hitChance(u, b, w) - this.hitChance(u, a, w) || b.layers - a.layers)[0]
      const to = !u.mv && !u.cut && !u.supp && u.ap >= 3 && this.cov.E[u.slot].l === 0 ? [u.slot + 1, u.slot - 1].find(x => x >= 1 && x <= 4 && this.cov.E[x].l > 0 && this.canMove(u, x)) : undefined
      if (u.slot === 1 && u.ws.some(x => NET_WEAPONS[x].melee) && foes.some(f => this.dist(u, f) === 1) && u.ap >= 1) {
        u.ap--; u.wi = u.ws.findIndex(x => NET_WEAPONS[x].melee); this.log(`${this.tag(u)} 換成${this.wp(u).n}。`); did = true
      } else if (to) { u.ap--; u.mv = true; this.move(u, to); did = true }
      else if (t && u.ap >= 3 && u.ram >= 2 && u.sync > 0 && this.rng() < 0.35) { u.ap -= 3; this.attack(u, t, { burst: true }); did = true }
      else if (t && u.ap >= 2) { u.ap -= 2; this.attack(u, t); did = true }
      else if (u.ap === 1 && !u.aim) { u.ap--; u.aim = true; this.log(`${this.tag(u)} 瞄準。`); did = true }
    }
    this.flushWatch()
    return did && !this.end
  }

  // ---- 玩家的行動 ----
  canAtk(u: NetUnit) { return !u.jam && u.ram >= this.wp(u).cost }
  cost(k: string, u = this.cur()) { const a = NET_ACTIONS.find(x => x.k === k); return k === 'shoot' && this.wp(u).snipe ? 3 : a?.c ?? 0 }
  ok(k: string, u: NetUnit): boolean {
    const w = this.wp(u)
    switch (k) {
      case 'shoot': return !w.melee && this.canAtk(u)
      case 'melee': return !!w.melee && this.canAtk(u) && this.alive('E').some(t => this.dist(u, t) === 1)
      case 'move': return this.canMove(u, u.slot - 1) || this.canMove(u, u.slot + 1)
      case 'reload': return u.ram < u.ramMax
      case 'swap': return u.ws.length > 1
      case 'item': return (this.scripts[u.id] ?? 0) > 0
      case 'cover': return !w.melee && this.canAtk(u) && this.cov.E.some(c => c.l > 0)
      case 'watch': return !u.watch
      case 'subdue': return u.ram >= 1 && this.alive('E').some(t => this.canPin(u, t))
      default: return false
    }
  }
  reason(k: string): string | null {
    if (this.end) return '戰鬥已經結束'
    const u = this.cur()
    if (u.side !== 'P') return '現在是敵人的回合'
    const a = NET_ACTIONS.find(x => x.k === k)
    if (!a) return '沒有這個行動'
    if (u.ap < this.cost(k, u)) return '行動點不夠'
    return this.ok(k, u) ? null : a.w
  }
  act(k: string): boolean {
    if (this.reason(k)) return false
    const u = this.cur(), a = NET_ACTIONS.find(x => x.k === k)!
    if (a.tg) { this.mode = this.mode === k ? null : k; return true }
    this.mode = null
    if (k === 'reload') { u.ap--; this.refill(u) }
    else if (k === 'swap') { u.ap--; u.wi = (u.wi + 1) % u.ws.length; this.log(`${u.name} 換成${this.wp(u).n}。`) }
    else if (k === 'watch') { u.ap -= 2; u.watch = true; this.log(`${u.name} 監視：敵人一站上暴露的格子就攻擊。`) }
    else if (k === 'item') { u.ap--; this.scripts[u.id]--; const v = d6(this.rng, 2); u.load = Math.max(0, u.load - v); this.log(`${u.name} 跑了冷卻腳本：感載 −${v}。`, 'g') }
    return true
  }
  /** 換同步檔位：每回合一次，不能超過自己的上限 */
  syncReason(i: number): string | null {
    const u = this.cur()
    if (this.end || u.side !== 'P') return '現在不是你的回合'
    if (u.sync === i) return '已經在這一檔'
    if (u.shifted) return '這一回合已經換過檔'
    if (i > u.syncMax) return `${SYNC[i].n}檔要更高的同步`
    return null
  }
  setSync(i: number): boolean {
    if (this.syncReason(i)) return false
    const u = this.cur()
    u.sync = i
    u.shifted = true
    this.log(`${u.name} 換到${SYNC[i].n}檔：檢定 ${SYNC[i].c >= 0 ? '+' : ''}${SYNC[i].c}、受到的感載 ×${SYNC[i].m}${i === 3 ? '、每回合多回 1 點行動點' : ''}。`)
    return true
  }
  /** 這一回合還能做幾次管理行動：主控的階數（全檔 +1） */
  adminLeft(u = this.cur()) { return u.admin ? u.admin + (u.sync === 3 ? 1 : 0) - u.adm : 0 }
  adminReason(k: string): string | null {
    const u = this.cur(), a = NET_ADMIN.find(x => x.k === k)
    if (!a) return '沒有這個管理行動'
    if (this.end || u.side !== 'P') return '現在不是你的回合'
    if (!u.admin) return '只有潛網者有管理行動'
    if (this.adminLeft(u) < 1) return '這一回合的管理行動用完了'
    if (u.ram < a.c) return 'RAM 不夠'
    if (k === 'wall' && !this.cov.P.slice(1).some(c => c.l < 2)) return '我方的牆都已經是防火牆'
    if (k === 'breach' && !this.cov.E.slice(1).some(c => c.l > 0)) return '敵方沒有牆'
    return null
  }
  /** 管理行動的檢定：介面 ＋ 同步 ＋ 餘韻 對 12；每次追蹤度 +1，失敗再 +5 */
  adminRoll(u: NetUnit) {
    u.adm++
    this.trace += 1
    const r = d20(this.rng) + u.intf + SYNC[u.sync].c + u.layers
    if (r < 12) { this.trace += 5; this.log(`${u.name} 的管理行動失敗（介面 ${r} 對 12）：追蹤度 +5。`, 'r'); this.traceCheck(); return false }
    return true
  }
  /** 按下管理行動：要選目標的進入選目標（mode 是 ad-…），擦痕跡直接做 */
  admin(k: string): boolean {
    if (this.adminReason(k)) return false
    if (k !== 'wipe') { this.mode = this.mode === `ad-${k}` ? null : `ad-${k}`; return true }
    return this.doAdmin('wipe')
  }
  doAdmin(k: string, t?: Target): boolean {
    const u = this.cur(), a = NET_ADMIN.find(x => x.k === k)!
    u.ram -= a.c
    const ok = this.adminRoll(u)
    if (ok) {
      if (k === 'wall' && t?.kind === 'slot') { const c = this.cov.P[t.slot]; c.l = (c.l + 1) as 1 | 2; c.d = COVER_DUR[c.l]; this.dm('wall'); this.log(`${u.name} 造牆：我方第 ${t.slot} 格變成${NET_COVER_NAMES[c.l]}。`, 'g') }
      else if (k === 'breach' && t?.kind === 'slot') { const c = this.cov.E[t.slot]; c.l = (c.l - 1) as 0 | 1; c.d = COVER_DUR[c.l]; this.log(`${u.name} 拆牆：敵方第 ${t.slot} 格變成${NET_COVER_NAMES[c.l]}。`, 'g'); this.compact('E') }
      else if (k === 'cut' && t?.kind === 'unit') { const v = this.units[t.id]; v.cut = true; this.log(`${u.name} 斷路：${this.tag(v)} 這一回合不能換位。`, 'g') }
      else if (k === 'mark' && t?.kind === 'unit') { const v = this.units[t.id]; v.mark = true; this.log(`${u.name} 標記 ${this.tag(v)}：全隊打他 +2。`, 'g') }
      else if (k === 'wipe') { this.trace = Math.max(0, this.trace - 6); /* 檢定本身 +1，淨 −5 */ this.log(`${u.name} 擦痕跡：追蹤度 −5。`, 'g') }
    }
    this.mode = null
    return true
  }
  targets(): Target[] {
    const m = this.mode, u = this.cur()
    if (!m || this.end) return []
    const foes = this.alive('E').sort((a, b) => a.slot - b.slot)
    if (m === 'shoot' || m === 'ad-cut' || m === 'ad-mark') return foes.map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'melee') return foes.filter(t => this.dist(u, t) === 1).map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'subdue') return foes.filter(t => this.canPin(u, t)).map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'move') return [u.slot - 1, u.slot + 1].filter(s => this.canMove(u, s)).map(slot => ({ kind: 'slot', side: 'P', slot }))
    if (m === 'cover' || m === 'ad-breach') return [1, 2, 3, 4].filter(s => this.cov.E[s].l > 0).map(slot => ({ kind: 'slot', side: 'E', slot }))
    if (m === 'ad-wall') return [1, 2, 3, 4].filter(s => this.cov.P[s].l < 2).map(slot => ({ kind: 'slot', side: 'P', slot }))
    return []
  }
  pick(t: Target): boolean {
    if (!this.mode || this.end) return false
    if (!this.targets().some(x => sameTarget(x, t))) return false
    const u = this.cur(), k = this.mode
    if (k.startsWith('ad-')) return this.doAdmin(k.slice(3), t)
    if (t.kind === 'unit') {
      const tu = this.units[t.id]
      if (k === 'shoot') { u.ap -= this.cost('shoot', u); this.attack(u, tu) }
      else if (k === 'melee') { u.ap -= 2; this.attack(u, tu) }
      else if (k === 'subdue') { u.ap -= 2; this.pin(u, tu) }
    } else if (k === 'move') { u.ap--; this.move(u, t.slot) }
    else if (k === 'cover') {
      u.ap -= 2
      const w = this.wp(u)
      u.ram -= w.cost
      const v = Math.round(d6(this.rng, w.dice) * Math.max(1, w.cm * 2))
      this.log(`${u.name} 打敵方第 ${t.slot} 格的防火牆（${v}）。`)
      this.hurtCover('E', t.slot, v)
    }
    this.mode = null
    this.flushWatch()
    return true
  }
  /** 拔線：花 1 點，這個人登出、退出這場戰鬥。全隊都拔線就是撤退 */
  unplug(): boolean {
    const u = this.cur()
    if (this.end || u.side !== 'P' || u.ap < 1) return false
    u.ap--
    u.unp = true
    u.out = true
    if (this.holding(u)) { this.dl!.broken = true; this.log(`${u.name}拔線：下載中斷。`, 'r') }
    this.log(`${u.name} 拔線：登出，退出這場戰鬥。`, 'h')
    this.fall(u, ' 離開了內海。')
    return true
  }
  surrender() {
    if (this.end) return
    this.finish('surrender', '投降：戰鬥結束，算戰敗。之後不再受感載，還站著的人不算倒下。贏的是粉蕾絲，所以正式的遊戲裡這裡直接接「被釘在線上」的活捉事件，和全隊倒下時是同一個。', '投降。')
  }
}
