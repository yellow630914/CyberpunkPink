// L6 功能 netrun：其餘的節點（第二張 M3-netrun-nodes）：檔案庫與下載、控制節點、人、閘門的破解、擦痕跡、安全點，與六種目標的進度。
// 規格：CYBERSPACE 8.1 節（節點表、「把固定目標放進生成的地圖」的表、帶出去才算數）、8.3 節（檔案庫、追蹤度在生成的子網裡）、6.6 節（管理行動）；
// NETRUNNING 第 4 節（節點種類）；ITEMS 11.4 節（後門鑰匙）；dev/adr/0018 N7（下載是探索回合）、N23（探索中的管理行動）。
//
//   下載與放東西  站在目標的檔案庫上每按一次「繼續」過一個探索回合（下載每回合追蹤度 +2、放東西不加）；離開那一格進度歸零（walk.ts）；做滿 turns 次完成。
//   檔案庫        不是目標的：開一次擲一次 archive_table（照權重），效果經 k.effects.resolve（內建的來源）；拿到的記進 loot；同一個第二次灰掉。
//   控制節點      接管：主控的檢定（智識加介面，加階數的一半進位，對地圖的 DC），或用掉一把後門鑰匙；記 taken，result.controls 列出來。
//   人            交涉（對地圖的 DC；成功給一張憑證）；有主控的人可以快駭（一次介面的檢定，成功同樣給憑證，不論成敗追蹤度 +1）；憑證過閘門不必打守著它的遭遇。
//   閘門          破解（主控的檢定對閘門的 DC；成功閘門開了，守著它的遭遇還在）、憑證、後門鑰匙。
//   擦痕跡        主控；每一層最多主控階數次；追蹤度 −5，每次 +1，失敗 +5。
//   安全點        登出（自己的那一趟：東西全部帶走；委託的階段仍是撤退，N13）；帶出來拿到之後從這裡離開算完成。
// 管理行動不花 RAM（脫離戰鬥立刻回滿，N23）；探索回合只有下載、放東西、休息算（N5）。

import type { Change, GameState, GridUse, Grade, Kernel, MarkerDef, ReportDraft } from '../../core'
import { ActionBlocked, deriveRng, effectCtx, isRecord, pointKey } from '../../core'
import { bestTier, checkBeat, keysIn, mastersOf, passed, pickAdmin, pickOf, rollPicked, spendKey } from './checks'
import { closeDraft, logoutBlock } from './close'
import { draft, runRegion, traceDelta } from './common'
import type { LootEntry, NetExt, NetRun } from './model'
import { ACT_FACE, TRACE, nodeAt } from './model'
import { advanceRound, newOut, patrolFight, workChanges, workOf } from './rounds'
import type { Out, Work } from './rounds'
import { netrunRules } from './rules'
import { partyOf } from './start'

const BUSY = '正在戰鬥，先把這一場打完。'

// ---- 小工具 ----

/** 這個標記是不是這一趟目標的那一個節點。 */
export const isGoalNode = (run: NetRun, sheetId: string, marker: Pick<MarkerDef, 'id'>): boolean => run.goal.at?.sheet === sheetId && run.goal.at.id === marker.id

/** 追蹤度加減（這一區沒有追蹤度就沒有）。 */
export function traceChanges(k: Kernel, run: NetRun, delta: number): Change[] {
  const d = traceDelta(run, delta)
  return d !== 0 && runRegion(k, run).pressure === 'trace' && k.meters.has(TRACE) ? [{ op: 'meter', kind: TRACE, key: run.map, delta: d }] : []
}

const usedHere = (net: NetExt, sheetId: string, id: string): boolean => (net.used[sheetId] ?? []).includes(id)

function markUsed(w: Work, sheetId: string, marker: MarkerDef, out: Out): void {
  w.net.used[sheetId] = [...(w.net.used[sheetId] ?? []), marker.id]
  w.netDirty = true
  out.changes.push({ op: 'map.sheet', map: w.run.map, sheet: sheetId, cells: { [pointKey(marker.at[0], marker.at[1])]: { used: true } } })
}

/** 組報告：基本的變更在前，這一段累積的變更與工作用的一份（run、ext.net）在後。 */
function report(state: GameState, w: Work, out: Out, result: string, summary: string, base: Change[] = []): ReportDraft {
  const lines = out.lines.filter(Boolean)
  return draft(state, w.run, 'netrun.use', result, [summary, ...lines].join(''), [...base, ...out.changes, ...workChanges(state, w)], {
    ...(out.beats.length ? { timeline: out.beats } : {}), ...(out.launch.length ? { launch: out.launch } : {}),
  })
}

const rngStep: Change = { op: 'rng', advance: 1 }

// ---- 給了什麼（檔案庫與目標） ----

/** 效果裡寫成「五個數字」的（照等級 I～V）換成這一級的那一個。 */
export function scaleByGrade(v: unknown, grade: number): unknown {
  if (Array.isArray(v) && v.length === 5 && v.every((n) => typeof n === 'number')) return v[grade - 1]
  if (Array.isArray(v)) return v.map((x) => scaleByGrade(x, grade))
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, scaleByGrade(x, grade)]))
  return v
}

/** 套用效果之後的變更裡，哪些是「拿到的東西」（物品、帳戶、現金的增加）：一筆變更一件。 */
function lootOf(k: Kernel, changes: readonly Change[], from: string, goal = false): LootEntry[] {
  const out: LootEntry[] = []
  for (const c of changes) {
    if (c.op === 'item' && typeof c.id === 'string' && typeof c.qty === 'number' && c.qty > 0) out.push({ kind: 'item', id: c.id, qty: c.qty, name: String(k.content.get('item', c.id)?.name ?? c.id), from, ...(goal ? { goal: true as const } : {}) })
    else if ((c.op === 'cred' || c.op === 'cash') && typeof c.delta === 'number' && c.delta > 0) out.push({ kind: c.op, qty: c.delta, name: c.op === 'cred' ? '帳戶的餘額' : '現金', from, ...(goal ? { goal: true as const } : {}) })
  }
  return out
}

/** 給東西：效果經 k.effects.resolve（內建的來源）。格式有錯整批不收（回傳 null 與原因）。 */
function give(k: Kernel, state: GameState, run: NetRun, effects: unknown[], from: string, goal = false): { changes: Change[]; lines: string[]; loot: LootEntry[] } | { problem: string } {
  const res = k.effects.resolve(scaleByGrade(effects, run.grade), effectCtx(k, state, { source: 'builtin', grade: run.grade as Grade }))
  if (res.errors.length) return { problem: res.errors[0]! }
  return { changes: res.changes, lines: res.lines, loot: lootOf(k, res.changes, from, goal) }
}

// ---- 檔案庫 ----

const goalKind = (run: NetRun, sheetId: string, marker: MarkerDef): string | undefined => (isGoalNode(run, sheetId, marker) ? run.goal.kind : undefined)

function archiveUses(state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): GridUse[] {
  const busy = state.battle ? BUSY : null
  const goal = goalKind(run, sheetId, marker)
  if (goal === 'download' || goal === 'plant') {
    const turns = run.goal.turns ?? 1
    const done = run.goal.done === true
    const name = goal === 'download' ? '繼續下載' : '繼續上傳'
    return [{ id: goal, name: `${name}（${run.goal.progress ?? 0}／${turns}）`, block: busy ?? (done ? '已經做完了。' : null) }]
  }
  if (goal === 'extract') return [{ id: 'loot', name: '拿走目標', block: busy ?? (run.goal.got ? '已經拿到了，帶著它走到出口或安全點。' : null) }]
  return [{ id: 'loot', name: '開檔案庫', block: busy ?? (usedHere(net, sheetId, marker.id) ? '這個檔案庫已經打開過了，裡面空了。' : null) }]
}

/** 下載與放東西：每按一次「繼續」過一個探索回合。 */
function progressDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef, kind: 'download' | 'plant'): ReportDraft {
  const rules = netrunRules(k)
  const w = workOf(run, net)
  const out = newOut()
  const turns = w.run.goal.turns ?? (kind === 'download' ? rules.download_turns : rules.plant_turns)
  const progress = (w.run.goal.progress ?? 0) + 1
  const done = progress >= turns
  w.run.goal = { ...w.run.goal, turns, progress, ...(done ? { done: true } : {}) }
  w.runDirty = true
  const extra = kind === 'download' ? traceChanges(k, w.run, rules.download_trace) : []
  advanceRound(k, state, w, out)
  if (!done) {
    const node = nodeAt(w.net, sheetId, marker.at)
    if (node) patrolFight(k, state, w, out, node.id)
  }
  const verb = kind === 'download' ? '下載' : '上傳'
  const summary = done ? `${verb}完成了（${progress}／${turns}）。` : `繼續${verb}（${progress}／${turns}）。離開這一格的話進度會歸零。`
  return report(state, w, out, kind, `${summary}${extra.length ? `追蹤度 +${rules.download_trace}。` : ''}`, extra)
}

/** 開檔案庫：目標的（帶出來）給目標；其餘的擲一次表。 */
function lootDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): ReportDraft {
  const w = workOf(run, net)
  const out = newOut()
  const from = `${sheetId}/${marker.id}`
  const changes: Change[] = []
  let summary: string
  if (goalKind(w.run, sheetId, marker) === 'extract') {
    const item = typeof w.run.goal.item === 'string' && k.content.has('item', w.run.goal.item) ? w.run.goal.item : undefined
    const got = item ? give(k, state, w.run, [{ kind: 'item', id: item, qty: 1 }], from, true) : { changes: [], lines: [], loot: [{ kind: 'item', ...(typeof w.run.goal.item === 'string' ? { id: w.run.goal.item } : {}), qty: 1, name: typeof w.run.goal.item === 'string' ? w.run.goal.item : '要帶出去的東西', goal: true as const, from } satisfies LootEntry] }
    if ('problem' in got) throw new ActionBlocked(`目標的東西給不出來：${got.problem}`)
    changes.push(...got.changes)
    w.run.loot = [...w.run.loot, ...got.loot]
    w.run.goal = { ...w.run.goal, got: true }
    summary = '拿到了要帶出去的東西。倒下的話這一件一定會丟，快走到出口或安全點。'
  } else {
    const rows = runRegion(k, w.run).archive_table ?? []
    // 熱點與多一層（自己去挖的詞條）：這個檔案庫多擲幾次，每一次各給一份
    const times = 1 + (w.net.dig?.rolls[sheetId]?.[marker.id] ?? 0)
    const parts: string[] = []
    for (let n = 0; n < times && rows.length; n++) {
      const row = deriveRng(state.rng, `netrun/${w.run.id}/archive/${sheetId}/${marker.id}${n > 0 ? `/${n}` : ''}`).weighted(rows, (r) => r.weight)
      const got = give(k, state, w.run, row.give, from)
      if ('problem' in got) {
        parts.push(`「${row.name}」壞掉了，什麼都沒拿到。`)
        continue
      }
      changes.push(...got.changes)
      w.run.loot = [...w.run.loot, ...got.loot]
      parts.push(`開了檔案庫：${row.name}。${got.lines.join('；')}${got.lines.length ? '。' : ''}`)
    }
    summary = parts.length ? parts.join('') : '檔案庫是空的。'
  }
  w.runDirty = true
  markUsed(w, sheetId, marker, out)
  return report(state, w, out, 'loot', summary, changes)
}

// ---- 控制節點 ----

function controlUses(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): GridUse[] {
  const busy = state.battle ? BUSY : null
  const taken = net.controls[sheetId]?.[marker.id]?.taken === true
  const takenWhy = '這個控制節點已經接管了。'
  const out: GridUse[] = []
  if (mastersOf(k, state).length) out.push({ id: 'seize', name: '接管', block: busy ?? (taken ? takenWhy : null) })
  if (keysIn(k, state, run.grade).length) out.push({ id: 'seize_key', name: '用後門鑰匙接管', block: busy ?? (taken ? takenWhy : null) })
  return out
}

/** 接管：拿到了記 taken；接管的是目標的那一個就完成。 */
function seizeDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef, withKey: boolean): ReportDraft {
  const rules = netrunRules(k)
  const w = workOf(run, net)
  const out = newOut()
  const base: Change[] = []
  let ok: boolean
  if (withKey) {
    const key = keysIn(k, state, run.grade)[0]
    if (!key) throw new ActionBlocked('沒有可以用的後門鑰匙（要帶著和這座網同一級的後門鑰匙）。')
    base.push(...spendKey(k, state, key.id))
    ok = true
    out.lines.push('用掉了一把後門鑰匙，不必檢定。')
  } else {
    const pick = pickAdmin(k, state)
    if (!pick) throw new ActionBlocked('隊上沒有人有主控，接管不了：要有主控，或用後門鑰匙。')
    const roll = rollPicked(k, state, pick, w.net.dc, `netrun/${w.run.id}/seize/${sheetId}/${marker.id}`, ['netrun', 'admin', 'seize'])
    ok = passed(roll)
    out.beats.push(checkBeat(k, state, pick, roll, '接管'))
    base.push(rngStep, ...traceChanges(k, w.run, rules.admin_trace + (ok ? 0 : rules.fail_trace)))
    out.lines.push(ok ? `追蹤度 +${rules.admin_trace}。` : `接管失敗：追蹤度 +${rules.admin_trace + rules.fail_trace}。`)
  }
  if (!ok) return report(state, w, out, 'seize_fail', `你們沒能接管「${marker.name}」。`, base)
  w.net.controls[sheetId] = { ...(w.net.controls[sheetId] ?? {}), [marker.id]: { ...(w.net.controls[sheetId]?.[marker.id] ?? {}), taken: true } }
  w.netDirty = true
  if (isGoalNode(w.run, sheetId, marker) && w.run.goal.kind === 'seize') {
    w.run.goal = { ...w.run.goal, done: true }
    w.runDirty = true
  }
  return report(state, w, out, 'seize', `接管了「${marker.name}」。`, base)
}

// ---- 人 ----

function personUses(k: Kernel, state: GameState, net: NetExt, sheetId: string, marker: MarkerDef): GridUse[] {
  const busy = state.battle ? BUSY : null
  const gave = usedHere(net, sheetId, marker.id) ? '他已經給過憑證了。' : null
  const out: GridUse[] = [{ id: 'talk', name: '交涉', block: busy ?? gave }]
  if (mastersOf(k, state).length) out.push({ id: 'hack_person', name: '快駭', block: busy ?? gave })
  return out
}

/** 交涉與對人快駭：成功給一張憑證；是「找人」的目標就完成。 */
function personDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef, hack: boolean): ReportDraft {
  const rules = netrunRules(k)
  const w = workOf(run, net)
  const out = newOut()
  const pick = hack ? pickOf(k, state, mastersOf(k, state).map((m) => m.id), rules.hack_skills) : pickOf(k, state, partyOf(state), rules.talk_skills)
  if (!pick) throw new ActionBlocked(hack ? '隊上沒有人有主控，對人快駭不了。' : '隊上沒有人可以交涉。')
  const roll = rollPicked(k, state, pick, w.net.dc, `netrun/${w.run.id}/${hack ? 'hack' : 'talk'}/${sheetId}/${marker.id}`, ['netrun', hack ? 'hack' : 'talk'])
  const ok = passed(roll)
  out.beats.push(checkBeat(k, state, pick, roll, hack ? '對他快駭' : '和他交涉'))
  // 快駭不論成敗 +1；交涉失敗 +失敗的數字
  const trace = hack ? rules.admin_trace : ok ? 0 : rules.fail_trace
  const base: Change[] = [rngStep, ...traceChanges(k, w.run, trace)]
  if (trace > 0) out.lines.push(`追蹤度 +${trace}。`)
  if (!ok) return report(state, w, out, hack ? 'hack_fail' : 'talk_fail', hack ? `快駭「${marker.name}」沒成功。` : `「${marker.name}」不理你們。`, base)
  w.net.keys = [...w.net.keys, `${sheetId}/${marker.id}`]
  w.netDirty = true
  markUsed(w, sheetId, marker, out)
  if (isGoalNode(w.run, sheetId, marker) && w.run.goal.kind === 'find') {
    w.run.goal = { ...w.run.goal, done: true }
    w.runDirty = true
  }
  return report(state, w, out, hack ? 'hack' : 'talk', hack ? `從「${marker.name}」的橋拿到了一張憑證。` : `「${marker.name}」給了你們一張憑證。`, base)
}

// ---- 閘門的破解、憑證、後門鑰匙 ----

/** 閘門前多出來的事（閘門已經開了就沒有）。 */
export function gateExtras(k: Kernel, state: GameState, run: NetRun, net: NetExt, opened: boolean): GridUse[] {
  if (opened) return []
  const busy = state.battle ? BUSY : null
  const out: GridUse[] = []
  if (mastersOf(k, state).length) out.push({ id: 'crack', name: '破解閘門', block: busy })
  if (net.keys.length) out.push({ id: 'cred', name: '用憑證過閘門', block: busy })
  if (keysIn(k, state, run.grade).length) out.push({ id: 'crack_key', name: '用後門鑰匙開閘門', block: busy })
  return out
}

/** 開閘門：破解（檢定對閘門的 DC，到 30 之後 +2）、憑證（用掉一張）、後門鑰匙（用掉一把）。守著它的遭遇還在，只是可以不打直接通過。 */
export function gateDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, how: 'crack' | 'cred' | 'crack_key', dc: number): ReportDraft {
  const rules = netrunRules(k)
  const w = workOf(run, net)
  const out = newOut()
  const base: Change[] = []
  let ok = true
  let summary: string
  if (how === 'crack') {
    const pick = pickAdmin(k, state)
    if (!pick) throw new ActionBlocked('隊上沒有人有主控，破解不了閘門：要有主控、憑證或後門鑰匙。')
    const roll = rollPicked(k, state, pick, dc, `netrun/${w.run.id}/crack/${sheetId}`, ['netrun', 'admin', 'crack'])
    ok = passed(roll)
    out.beats.push(checkBeat(k, state, pick, roll, '破解閘門'))
    base.push(rngStep, ...traceChanges(k, w.run, rules.admin_trace + (ok ? 0 : rules.fail_trace)))
    out.lines.push(ok ? `追蹤度 +${rules.admin_trace}。` : `追蹤度 +${rules.admin_trace + rules.fail_trace}。`)
    summary = ok ? '閘門破開了。守著它的遭遇還在，可以不打直接通過。' : '閘門沒破開。'
  } else if (how === 'cred') {
    if (!w.net.keys.length) throw new ActionBlocked('手上沒有憑證。')
    w.net.keys = w.net.keys.slice(1)
    w.netDirty = true
    summary = '用一張憑證開了閘門，不必打守著它的遭遇（拿不到它的掉落）。'
  } else {
    const key = keysIn(k, state, run.grade)[0]
    if (!key) throw new ActionBlocked('沒有可以用的後門鑰匙（要帶著和這座網同一級的後門鑰匙）。')
    base.push(...spendKey(k, state, key.id))
    summary = '用掉一把後門鑰匙開了閘門，不必檢定。'
  }
  if (ok && !w.net.opened.includes(sheetId)) {
    w.net.opened = [...w.net.opened, sheetId]
    w.netDirty = true
  }
  return report(state, w, out, ok ? how : 'crack_fail', summary, base)
}

// ---- 擦痕跡（探索中的管理行動；任何一格都可以做） ----

/** 擦痕跡現在行不行：原因（一句）；行是 null。沒有主控的隊伍沒有這一項（回傳 undefined）。 */
export function wipeUse(k: Kernel, state: GameState, run: NetRun, net: NetExt): GridUse | undefined {
  const tier = bestTier(k, state)
  if (tier < 1) return undefined
  const sheetId = run.layers[run.layer]!
  const done = net.wiped[sheetId] ?? 0
  const rules = netrunRules(k)
  const block = state.battle ? BUSY
    : runRegion(k, run).pressure !== 'trace' ? '這一區沒有追蹤度，沒有痕跡可以擦。'
    : done >= tier ? `這一層已經擦了 ${done} 次：主控 ${tier} 階，一層最多擦 ${tier} 次。`
    : null
  return { id: 'wipe', name: `擦痕跡（−${rules.wipe}）`, block }
}

export function wipeDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt): ReportDraft {
  const use = wipeUse(k, state, run, net)
  if (!use) throw new ActionBlocked('隊上沒有人有主控，擦不了痕跡。')
  if (use.block) throw new ActionBlocked(use.block)
  const rules = netrunRules(k)
  const sheetId = run.layers[run.layer]!
  const w = workOf(run, net)
  const out = newOut()
  const pick = pickAdmin(k, state)!
  const roll = rollPicked(k, state, pick, w.net.dc, `netrun/${w.run.id}/wipe/${sheetId}/${w.net.wiped[sheetId] ?? 0}`, ['netrun', 'admin', 'wipe'])
  const ok = passed(roll)
  out.beats.push(checkBeat(k, state, pick, roll, '擦痕跡'))
  w.net.wiped[sheetId] = (w.net.wiped[sheetId] ?? 0) + 1
  w.netDirty = true
  const delta = (ok ? -rules.wipe : 0) + rules.admin_trace + (ok ? 0 : rules.fail_trace)
  out.lines.push(ok ? `追蹤度 ${delta >= 0 ? '+' : ''}${delta}（擦掉 ${rules.wipe}，管理行動 +${rules.admin_trace}）。` : `追蹤度 +${delta}。`)
  return report(state, w, out, ok ? 'wipe' : 'wipe_fail', ok ? '擦掉了一部分痕跡。' : '痕跡沒擦掉，反而留了更多。', [rngStep, ...traceChanges(k, w.run, delta)])
}

// ---- 安全點 ----

function safeUses(state: GameState, run: NetRun): GridUse[] {
  const complete = run.goal.kind === 'extract' && run.goal.got === true
  return [{ id: 'safe_logout', name: complete ? '帶著東西從安全點離開' : '從安全點登出', block: logoutBlock(state) }]
}

/** 從安全點登出：帶出來拿到了就完成（done，goal true）；否則和一般登出一樣（自己去的是 left，委託的階段是撤退）。 */
function safeLogoutDraft(k: Kernel, state: GameState, run: NetRun): ReportDraft {
  const block = logoutBlock(state)
  if (block) throw new ActionBlocked(block)
  if (run.goal.kind === 'extract' && run.goal.got === true) return closeDraft(k, state, { ...run, goal: { ...run.goal, done: true } }, 'done', 'netrun.end')
  return closeDraft(k, state, run, run.kind === ACT_FACE ? 'retreat' : 'left', 'netrun.logout')
}

// ---- 對外 ----

/** 標記 a、c、p、b 現在能做的事；別的標記是 null（閘門、休息點、遭遇節點在 uses.ts）。 */
export function nodeUsesOf(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): GridUse[] | null {
  switch (marker.mark) {
    case 'a': return archiveUses(state, run, net, sheetId, marker)
    case 'c': return controlUses(k, state, run, net, sheetId, marker)
    case 'p': return personUses(k, state, net, sheetId, marker)
    case 'b': return safeUses(state, run)
    default: return null
  }
}

/** 做標記 a、c、p、b 上的事；不是這裡的事是 null。 */
export function doNodeUse(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef, id: string): ReportDraft | null {
  switch (id) {
    case 'download': return progressDraft(k, state, run, net, sheetId, marker, 'download')
    case 'plant': return progressDraft(k, state, run, net, sheetId, marker, 'plant')
    case 'loot': return lootDraft(k, state, run, net, sheetId, marker)
    case 'seize': return seizeDraft(k, state, run, net, sheetId, marker, false)
    case 'seize_key': return seizeDraft(k, state, run, net, sheetId, marker, true)
    case 'talk': return personDraft(k, state, run, net, sheetId, marker, false)
    case 'hack_person': return personDraft(k, state, run, net, sheetId, marker, true)
    case 'safe_logout': return safeLogoutDraft(k, state, run)
    default: return null
  }
}
