import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { END_TURN } from '@engine/src'
import type { BattleActionOption, BattleInput, BattleStepResult, BattleTarget, BattleTargetOption } from '@engine/src'
import type { RingItem } from '../components/combat/ActionRing.vue'
import { COMBAT_ICONS } from '../data/combatIcons'
import type { LiveEvent } from '../data/media'
import { pickFlow, type PickOptionView, type PickView } from './battlePicks'
import { RING_KEYS, battleView, disabledReason, ringOf, slotLayout, type BattleCell, type SlotPos } from './battleView'
import { combatKey, isTyping } from './keys'
import { danmakuOf, liveEventsOf } from './liveEvents'
import { netBattleLeaveTo } from './netrunView'
import { NET_SHIFT, adminPanel, beatText, gearPanel, isAdminAction, netUnitOf, shiftInput, traceBar, traceDelta } from './netView'
import { useAfterBattle } from './useAfterBattle'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'

/**
 * 戰鬥畫面的驅動（現實戰鬥與內海戰鬥共用一組，COMBAT_SYSTEM 第 10 節、dev/adr/0018 第十二節）：
 * 狀態、能不能做、為什麼不能、命中率、花幾點、誰先動，都讀引擎（store 的 battle、battleOptions、netBattle）；這裡只管選行動與目標的流程、
 * 敵人的回合節奏、按鍵、紀錄、結算與換頁。不寫規則，不擲骰。
 * 內海與現實的差別來自引擎給的戰場資料（防火牆的字、卡片上有沒有生命）與 netBattle（檔位、追蹤度、管理行動）；這裡不看網址參數決定是哪一種。
 * 從子網、地下城、委託連過來：#/combat?enc=<遭遇的 id>&from=/dungeon。?fast=1 讓敵人的回合不等（測試用）。
 */
export interface BattleOpts {
  /** 打完回哪一頁 */
  from: () => string
  /** 敵人的回合不等 */
  fast: () => boolean
  /** 網址指定的遭遇 id */
  enc: () => string | undefined
  /** 沒有指定遭遇也開一場預設的（現實戰鬥的深連結）；內海不開 */
  fallback: boolean
  /** 離開這一頁之前要收的東西（直播小窗） */
  beforeLeave?: () => void
}

const RESULT: Record<string, string> = { win: '勝利', lose: '戰敗', fled: '脫離', surrender: '投降', jack_out: '撤退' }
const RING_G = { attack: 'atk', supply: 'res', tactic: 'tac' } as const
const RANK_NAME: Record<string, string> = { minion: '雜兵', elite: '精英', boss: '首領' }

export function useBattle(opts: BattleOpts) {
  const router = useRouter()
  const route = useRoute()
  const engine = useEngine()
  const ui = useUi()
  const afterBattle = useAfterBattle()

  const hint = ref('')
  const skillOpen = ref(false)
  const liveOn = ref(false)
  const live = ref({ on: false, viewers: 0 })
  const liveEvents = ref<LiveEvent[]>([])
  const lines = ref<Array<{ t: string; c: string }>>([])
  const settling = ref(false)
  /** 彈幕層（Board 掛上之後給）；沒有掛上時丟掉 */
  let danmaku: ((text: string, kind?: 'hot') => void) | null = null
  const bindDanmaku = (fn: ((text: string, kind?: 'hot') => void) | null): void => { danmaku = fn }
  /** 追蹤度這一步變了多少（照那一拍的 trace 事件）：n 每次加一，畫面看它跳一下 */
  const traceBump = ref({ n: 0, delta: 0 })

  // ---- 版面：桌面一列八格，手機敵上我下（兩排的第 1 格都在左邊） ----
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 720px)') : null
  const mobile = ref(!!mq?.matches)
  const onMq = (e: MediaQueryListEvent): void => { mobile.value = e.matches }
  const layout = computed(() => slotLayout(mobile.value ? 'mobile' : 'desktop'))

  // ---- 引擎給的東西 ----
  const battle = computed(() => engine.battle)
  const options = computed(() => (engine.battle ? engine.battleOptions() : null))
  const mode = computed(() => (engine.battle ? engine.battleMode() : null))
  /** 戰場在哪一層（引擎的戰場資料）：內海是 net */
  const isNet = computed(() => mode.value?.layer === 'net')
  const nameOf = (kind: string, id: string): string | undefined => (kind === 'battle_status' ? engine.statusName(id) : undefined) ?? engine.contentName(kind, id)
  const view = computed(() => (battle.value && options.value && mode.value ? battleView(battle.value, options.value, mode.value, nameOf) : null))
  const net = computed(() => (isNet.value ? engine.netBattle() : null))
  const netUnit = computed(() => netUnitOf(net.value, options.value))
  const myTurn = computed(() => options.value?.waiting === 'player')
  const over = computed(() => options.value?.waiting === 'over')
  const cur = computed(() => (battle.value && options.value?.current ? battle.value.units[options.value.current] ?? null : null))
  const ring = computed(() => (options.value ? ringOf(options.value) : null))
  const keys = computed(() => (options.value ? RING_KEYS(options.value) : []))
  const place = computed(() => battle.value?.origin.place ?? (isNet.value ? '內海' : '現實戰鬥'))
  const cellOf = (p: SlotPos): BattleCell | undefined => view.value?.cells.find((c) => c.side === p.side && c.slot === p.slot)

  /** 圖示照引擎給的鍵；這張表還沒有圖的鍵退成技能的圖 */
  const iconOf = (a: BattleActionOption): string => (COMBAT_ICONS[a.icon] ? a.icon : 'skill')
  const reasonOf = (a: BattleActionOption): string | null => disabledReason(a) ?? (a.ok ? null : '現在做不到。')
  const ringItems = computed<RingItem[]>(() => {
    const r = ring.value
    if (!r) return []
    return (['attack', 'supply', 'tactic'] as const).flatMap((g) => r[g].map((a): RingItem => ({
      k: a.id, n: a.name, c: a.cost.ap, g: RING_G[g], icon: iconOf(a), d: a.desc, w: '',
      cost: a.cost.ap, reason: reasonOf(a), key: keys.value.indexOf(a.id) + 1, ...(a.cost.ram ? { ram: String(a.cost.ram) } : {}),
    })))
  })
  const actionOf = (id: string): BattleActionOption | undefined => options.value?.actions.find((a) => a.id === id)
  /** 圓環外那一列：結束回合、拔線、投降（換檔畫在同步檔位那一排，不在這裡） */
  const systemActions = computed(() => (ring.value?.system ?? []).filter((a) => a.id !== NET_SHIFT))
  /** 技能清單：管理行動畫在自己的面板，不重複列；花管理行動的技能標出幾次 */
  const skillList = computed(() => (ring.value?.skill ?? []).filter((a) => !isAdminAction(a.id)).map((a) => ({ a, admin: isNet.value ? engine.skillAdminCost(a.id) : 0 })))

  // ---- 內海的三塊 ----
  const gears = computed(() => gearPanel(netUnit.value, actionOf(NET_SHIFT), myTurn.value))
  const trace = computed(() => traceBar(net.value))
  const admin = computed(() => adminPanel(netUnit.value, options.value))
  const inCommission = computed(() => net.value?.commission === true)

  // ---- 開打 ----
  /** 讀檔或重新整理回來接著打：戰鬥紀錄照引擎已經提交的每一步報告重建 */
  function restoreLines(): void {
    const b = engine.battle
    if (!b) return
    const mine = new Set(b.steps)
    after({ status: 'applied', over: false, reports: engine.state.reports.filter((r) => mine.has(r.id)) }, false)
  }
  function startFromRoute(): void {
    if (engine.inBattle && lines.value.length === 0) { restoreLines(); return }
    if (!engine.hasCharacter || engine.inBattle || engine.defeat) return
    const wanted = opts.enc() ?? ''
    const list = engine.encounters()
    const id = list.find((e) => e.id === wanted)?.id ?? (opts.fallback ? list.find((e) => e.grade === 1)?.id ?? list[0]?.id : undefined)
    if (!id) { if (opts.fallback) hint.value = '內容裡沒有任何遭遇。'; return }
    lines.value = []
    liveEvents.value = []
    // 開場的「戰鬥開始」「第 1 回合」「輪到誰」在 battle.start 這份報告的 timeline 裡
    after({ status: 'applied', over: false, reports: engine.startEncounter(id) })
  }
  watch(() => opts.enc(), () => { if (!engine.inBattle && !settling.value) startFromRoute() })

  // ---- 一步的結果：紀錄、直播與彈幕、追蹤度跳一下 ----
  function after(r: BattleStepResult, fresh = true): void {
    const reports = r.reports ?? []
    for (const rep of reports) {
      for (const b of rep.timeline) {
        const good = b.tag === 'crit' || b.tag === 'down' || b.tag === 'subdue' || b.tag === 'overload'
        lines.value.push({ t: beatText(b), c: good ? 'h' : b.tag === 'wound' ? 'r' : '' })
      }
    }
    if (!fresh) return
    const d = traceDelta(reports)
    if (d !== 0) traceBump.value = { n: traceBump.value.n + 1, delta: d }
    const ev = liveEventsOf(reports, engine.battle)
    liveEvents.value.push(...ev)
    // 內海的彈幕只是氣氛，一直放；現實的彈幕跟著直播小窗
    if (live.value.on || isNet.value) for (const x of danmakuOf(ev)) danmaku?.(x.text, x.kind)
  }

  // ---- 敵人的回合：等的是 AI 就每隔一小段時間走一步 ----
  let timer: ReturnType<typeof setTimeout> | null = null
  function scheduleAi(): void {
    if (timer || options.value?.waiting !== 'ai') return
    timer = setTimeout(() => {
      timer = null
      if (options.value?.waiting !== 'ai') return
      const r = engine.battleNext()
      if (r.status === 'refused') { hint.value = (r.reasons ?? []).join('\n'); return }
      after(r)
    }, opts.fast() ? 0 : 650)
  }
  watch(() => engine.battle, () => { resetSel(); scheduleAi() })

  // ---- 選行動、選目標 ----
  const selId = ref<string | null>(null)
  /** 已經選的目標與多選的東西（pick 的鍵 → 值）；能不能送、還缺什麼，一律問 pickFlow（引擎的 pickApplies、pickProblems） */
  const chosenTarget = ref<BattleTarget | null>(null)
  const picked = ref<Record<string, unknown>>({})
  const selAction = computed(() => (selId.value ? actionOf(selId.value) ?? null : null))
  const flow = computed(() => (selAction.value ? pickFlow(selAction.value, { target: chosenTarget.value, pick: picked.value }) : null))
  const tkey = (t: BattleTarget): string => ('unit' in t ? `u:${t.unit}` : 'overlay' in t ? `o:${t.overlay}` : 'node' in t ? `n:${t.node}` : `s:${t.side}:${t.slot}`)
  const tmap = computed(() => new Map((selAction.value?.targets ?? []).map((t) => [tkey(t.target), t])))
  const treason = computed(() => new Map((flow.value?.targets ?? []).map((t) => [tkey(t.target), t.reason])))
  /** 選項有 at（選人、選格）的：場上那個東西也可以直接點 */
  const atMap = computed(() => {
    const m = new Map<string, { p: PickView; o: PickOptionView }>()
    for (const p of flow.value?.picks ?? []) for (const o of p.options) if (o.at) m.set(tkey(o.at), { p, o })
    return m
  })
  const okTargets = computed(() => (selAction.value?.targets ?? []).filter((t) => !treason.value.get(tkey(t.target))))
  const focus = ref(0)
  const focused = computed(() => (okTargets.value.length ? okTargets.value[((focus.value % okTargets.value.length) + okTargets.value.length) % okTargets.value.length]! : null))
  const isFocused = (k: string): boolean => (!!focused.value && tkey(focused.value.target) === k) || (!!chosenTarget.value && tkey(chosenTarget.value) === k)

  /** 場上的一個東西現在能不能點：是目標（可能帶著選不了的原因），或是某個多選項的 at */
  interface Hit { reason: string | null; target?: BattleTargetOption; pick?: { p: PickView; o: PickOptionView } }
  const hit = (...ks: string[]): Hit | undefined => {
    for (const k of ks) { const t = tmap.value.get(k); if (t) return { reason: treason.value.get(k) ?? null, target: t } }
    for (const k of ks) { const a = atMap.value.get(k); if (a) return { reason: a.o.reason, pick: a } }
    return undefined
  }
  const unitHit = (c: BattleCell): Hit | undefined => (c.unit ? hit(`u:${c.unit.id}`, `s:${c.side}:${c.slot}`) : undefined)
  const slotHit = (c: BattleCell): Hit | undefined => hit(`s:${c.side}:${c.slot}`)
  const stateOf = (h: Hit | undefined): string => (!h ? '' : h.reason ? 'tg-no' : 'tg')

  function resetSel(): void { selId.value = null; chosenTarget.value = null; picked.value = {} }
  function submit(input: BattleInput): void {
    const r = engine.battleAct(input)
    if (r.status === 'refused') { hint.value = (r.reasons ?? []).join('\n'); return }
    hint.value = ''
    resetSel()
    skillOpen.value = false
    after(r)
  }
  /** 選齊了就送，還缺什麼就說 */
  function tryFinish(): void {
    const f = flow.value
    if (!f) return
    if (f.ready) submit(f.input)
    else hint.value = f.missing.join('\n')
  }
  function chooseAction(id: string): void {
    const a = actionOf(id)
    if (!a || !myTurn.value) return
    const why = reasonOf(a)
    if (why) { hint.value = `${a.name}：${why}`; return }
    // 再點一次同一個行動：選齊了（或不用選）就照預設送出，沒有就取消
    if (selId.value === id) { if (flow.value?.ready) submit(flow.value.input); else cancel(); return }
    resetSel()
    focus.value = 0
    if (a.target === 'none' && a.picks.length === 0) { submit({ action: a.id }); return }
    selId.value = id
    hint.value = a.target !== 'none' ? '選一個目標（綠框）。Tab 換目標，Enter 確定，Esc 取消。' : flow.value?.ready ? '選一個選項，或再點一次行動照預設送出。' : '選一個選項。'
  }
  function activate(h: Hit | undefined): void {
    if (!selAction.value || !h) return
    if (h.reason) { hint.value = h.reason; return }
    if (h.target) { chosenTarget.value = h.target.target; tryFinish() }
    else if (h.pick) pickOption(h.pick.p, h.pick.o)
  }
  function pickOption(p: PickView, o: PickOptionView): void {
    if (o.reason) { hint.value = o.reason; return }
    const next = { ...picked.value }
    if (p.kind === 'toggle') { if (next[p.key]) delete next[p.key]; else next[p.key] = o.value; picked.value = next; return }
    if (o.selected) { delete next[p.key]; picked.value = next; return }
    next[p.key] = o.value
    picked.value = next
    tryFinish()
  }
  function cancel(): void { resetSel(); hint.value = '' }
  function endTurn(): void {
    const a = actionOf(END_TURN)
    if (!a || !myTurn.value) return
    submit({ action: END_TURN })
  }
  function fire(a: BattleActionOption): void { submit({ action: a.id }) }
  /** 點同步檔位的一檔：輸入照引擎宣告的 picks 組；換不到的原因是引擎的 */
  function shiftTo(gear: string): void {
    const a = actionOf(NET_SHIFT)
    const g = gears.value
    if (!a || !g || !myTurn.value) return
    if (g.locked) { hint.value = g.locked; return }
    const cell = g.cells.find((c) => c.gear === gear)
    if (!cell || cell.current) return
    if (cell.reason) { hint.value = cell.reason; return }
    submit(shiftInput(a, gear))
  }
  /** 目標的提示：命中率（%）、制伏的檢定難度；引擎有給才顯示 */
  function chanceOf(h: Hit | undefined): string {
    const hh = h?.target?.hint
    if (!hh) return ''
    if (typeof hh.chance === 'number') return `${hh.chance}%`
    if (typeof hh.dc === 'number') return `${isNet.value ? '檢定對' : '格鬥對'} ${hh.dc}`
    return ''
  }

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !engine.inBattle) return
    const el = e.target as HTMLElement | null
    if (e.key === ' ' && el?.closest?.('.hold, select')) return
    if (e.key === 'Enter' && !selId.value && el?.closest?.('button, [role="button"], a')) return
    if (e.key === 'Enter' && el?.closest?.('[data-unit], [data-slot], [data-cell]')) return
    const a = combatKey(e, { typing: isTyping(e.target), dialogOpen: ui.stack.length > 0, targeting: !!selId.value })
    if (!a) return
    if (a.type === 'cycle' && !selId.value) return
    e.preventDefault()
    if (!myTurn.value) return
    if (a.type === 'ring') { const id = keys.value[a.i]; if (id) chooseAction(id) }
    else if (a.type === 'end') endTurn()
    else if (a.type === 'cycle') focus.value += a.dir
    else if (a.type === 'confirm') { if (focused.value && !chosenTarget.value) activate({ reason: null, target: focused.value }); else tryFinish() }
    else if (a.type === 'cancel') cancel()
  }

  // ---- 結束與結算 ----
  const resultName = computed(() => { const o = battle.value?.result?.outcome; return o ? RESULT[o] ?? o : '' })
  /** 全隊拔線（引擎的戰場資料 leave.outcome）：不是戰敗，是撤退 */
  const retreat = computed(() => battle.value?.result?.outcome === 'jack_out')
  const lost = computed(() => battle.value?.result?.outcome === 'lose' || battle.value?.result?.outcome === 'surrender')
  function leave(): void {
    opts.beforeLeave?.()
    afterBattle.dismiss()
    const from = opts.from()
    // 內海戰鬥：行程可能在戰鬥裡結束了（拔線、接受戰敗、回到階段開始），照引擎的狀態決定回哪頁
    const to = route.path === '/netcombat'
      ? netBattleLeaveTo(from, { run: !!engine.net.view(), commission: !!engine.commission.view(), jobs: engine.fixer.jobs().length > 0, settle: engine.dive.view().diving && !!engine.dive.lastEnd() })
      : from
    void router.push(to)
  }
  /** 結算：打輸（或投降）留在戰敗面板（引擎在等三選一）；打贏有戰利品或俘虜時開戰利品面板，其餘直接離開 */
  async function settle(direction?: string): Promise<void> {
    if (settling.value) return
    settling.value = true
    const r = await engine.finishBattle(typeof direction === 'string' ? direction : undefined)
    settling.value = false
    for (const n of r.notices ?? []) ui.toast(n)
    if (r.status !== 'applied') { hint.value = r.reason ?? '結算沒有成功。'; return }
    if (engine.pendingDefeat) return
    if (!afterBattle.show()) leave()
  }
  function stage(): void {
    const err = engine.rewindToStage()
    if (err) { hint.value = err; return }
    leave()
  }
  function retry(): void {
    const err = engine.retryBattle()
    if (err) { hint.value = err; return }
    hint.value = ''
    resetSel()
    lines.value = []
    liveEvents.value = []
    // 重來之後是一場新的戰鬥：開場的紀錄照引擎已經提交的報告重建
    restoreLines()
    scheduleAi()
  }

  const pct = (v: number, m: number): string => `${Math.max(0, Math.min(100, m > 0 ? (v / m) * 100 : 0))}%`
  const fieldStyle = (p: SlotPos): Record<string, string> => (mobile.value
    ? { gridColumn: String(p.col), gridRow: p.side === 'foe' ? '1' : '3' }
    : { gridColumn: String(p.col > 4 ? p.col + 1 : p.col), gridRow: '1' })
  const rankLabel = (side: string, r: string): string => (side === 'foe' ? RANK_NAME[r] ?? '' : '')

  onMounted(() => {
    mq?.addEventListener('change', onMq)
    window.addEventListener('keydown', onKey, true)
    startFromRoute()
    scheduleAi()
  })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    mq?.removeEventListener('change', onMq)
    window.removeEventListener('keydown', onKey, true)
  })

  return {
    route, router, engine, afterBattle, hint, skillOpen, liveOn, live, liveEvents, lines, settling, mobile, layout, traceBump, bindDanmaku,
    battle, options, mode, isNet, view, net, netUnit, myTurn, over, cur, ring, keys, place, cellOf,
    iconOf, reasonOf, ringItems, actionOf, systemActions, skillList, gears, trace, admin, inCommission,
    selId, selAction, flow, hit, unitHit, slotHit, stateOf, isFocused, chooseAction, activate, pickOption, cancel, submit, endTurn, fire, shiftTo, chanceOf,
    resultName, retreat, lost, leave, settle, stage, retry, pct, fieldStyle, rankLabel,
  }
}
