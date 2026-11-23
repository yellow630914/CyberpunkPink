// 介面層的種子重播（dev/test-harness.md 第 4 節的介面版）。
// 引擎的 repro（engine/tests/fixtures/repro/）只認得引擎的輸入；這裡的 bug 出在 store 層（useEngine、useGame、useSaves），
// 所以另外一份格式：ui/tests/fixtures/repro/<id>.json（種子＋一串介面的動作＋期望），由這個執行器跑。

import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../src/stores/engine'
import { useGame } from '../../src/stores/game'
import { useSaves } from '../../src/stores/saves'
import { BATTLE_SETUPS } from '@engine/src/testkit'

export type UiStep =
  | { type: 'ai'; useAi: boolean }
  | { type: 'newGame'; seed: number }
  | { type: 'create' }
  | { type: 'act'; text: string }
  | { type: 'reroll' }
  | { type: 'spend'; money: 'acc' | 'cash'; amount: number }
  | { type: 'advance'; minutes: number }
  | { type: 'undo' }
  | { type: 'snapshot'; kind: '戰鬥'; label: string }
  | { type: 'rollback' }
  /** 同時送出兩個自由行動：記下第二個結束時（第一個還在跑）busy 是什麼 */
  | { type: 'actTwice'; text: string }
  /** 把這一局打包，換掉 legacy 裡的幾個欄位，再用 useSaves().loadRaw 讀回來 */
  | { type: 'loadPackedWith'; legacy: Record<string, unknown> }
  /** 打一場一定輸的（BATTLE_SETUPS.hopeless）：輪到我方就投降，結算到等戰敗的三選一 */
  | { type: 'loseBattle' }
  /** 戰敗三選一的「回到這個階段開始時」（useEngine().rewindToStage）：記下回傳的原因 */
  | { type: 'rewindToStage' }
  /** 把人帶到一塊街區（world.arrive；委託的出發要人在中間人那一塊） */
  | { type: 'arrive'; block: string }
  /** 在中間人那裡接他今天的第 index 件委託（預設第 0 件），用現金付 */
  | { type: 'takeJob'; fixer: string; index?: number }
  /** 手上最近接的那件委託出發（引擎的 fixer.go：開委託副本） */
  | { type: 'depart' }
  /** 副本裡選面、選分支（引擎的 commission.chooseFace、chooseBranch；進入這一段時引擎開地圖） */
  | { type: 'enterStage'; face: 'meat' | 'net' | 'opinion'; branch: string }
  /** 在副本的地圖上走 count 步（照 北、南、東、西 的順序挑走得過去的方向；每一步引擎加時間） */
  | { type: 'walk'; count: number }
  /** 戰敗三選一的「重來這場戰鬥」（useEngine().retryBattle）：記下回傳的原因 */
  | { type: 'retryBattle' }

export interface UiRepro {
  id: string
  bug: string
  note: string
  draft?: Record<string, unknown>
  steps: UiStep[]
  /** view 裡的路徑（點分隔）→ 期望的值 */
  expect: Record<string, unknown>
}

export interface UiView {
  time: { day: number; hour: number; minute: number }
  money: { cred: number; cash: number }
  logCount: number
  logTop: string | null
  rollRerolls: number
  reportCount: number
  legacyMoneyKeys: string[]
  busyWhileFirstRunning: boolean | null
  loadResult: string | null | undefined
  /** 最後一次 rewindToStage／retryBattle 的回傳（沒有按過是 undefined） */
  choiceResult: string | null | undefined
  inBattle: boolean
  pendingDefeat: boolean
  /** 委託副本：沒有在副本裡是 null */
  commission: { stage: number; step: string } | null
  /** 手上進行中的委託有幾件 */
  jobs: number
  thrown: string[]
}

function installStorage(): void {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v) },
    removeItem: (k: string) => { mem.delete(k) },
  }
}

export async function runUiRepro(r: UiRepro): Promise<UiView> {
  installStorage()
  setActivePinia(createPinia())
  const g = useGame()
  const e = useEngine()
  const s = useSaves()
  const thrown: string[] = []
  let lastSnap: string | null = null
  let busyWhileFirstRunning: boolean | null = null
  let loadResult: string | null | undefined
  let choiceResult: string | null | undefined

  for (const step of r.steps) {
    try {
      switch (step.type) {
        case 'ai': e.setAi({ useAi: step.useAi }); break
        case 'newGame': e.newGame({ seed: step.seed }); break
        case 'create': {
          const blocks = e.createCharacter(r.draft as never)
          if (blocks.length) throw new Error(`建角被擋：${blocks.map((b) => b.reason).join('；')}`)
          break
        }
        case 'act': await e.act({ kind: 'free', text: step.text }); break
        case 'reroll': await e.reroll(); break
        case 'spend': g.money[step.money] -= step.amount; break
        case 'advance': g.advance(step.minutes); break
        case 'undo': e.undo(); break
        case 'snapshot': lastSnap = g.takeSnapshot(step.kind, step.label).id; break
        case 'rollback': if (lastSnap) g.rollback(lastSnap); break
        case 'actTwice': {
          const first = e.act({ kind: 'free', text: step.text })
          await e.act({ kind: 'free', text: `${step.text}（第二次）` }).catch((x: unknown) => { thrown.push(String(x)) })
          busyWhileFirstRunning = e.busy
          await first
          break
        }
        case 'loadPackedWith': {
          const raw = JSON.parse(s.pack('手動').raw) as { legacy: Record<string, unknown> }
          raw.legacy = { ...raw.legacy, ...step.legacy }
          loadResult = s.loadRaw(JSON.stringify(raw))
          break
        }
        case 'loseBattle': {
          e.startBattle(BATTLE_SETUPS.hopeless())
          for (let i = 0; i < 500 && e.battleOptions()?.waiting !== 'over'; i++) {
            if (e.battleOptions()?.waiting === 'ai') e.battleNext()
            else e.battleAct({ action: 'surrender' })
          }
          await e.finishBattle()
          break
        }
        case 'arrive': {
          const r = await e.world.arrive(step.block)
          if (r.status !== 'applied') throw new Error(`到不了 ${step.block}：${r.reason ?? r.status}`)
          break
        }
        case 'takeJob': {
          const offer = e.fixer.board(step.fixer).offers[step.index ?? 0]
          if (!offer) throw new Error(`${step.fixer} 今天沒有第 ${step.index ?? 0} 件委託。`)
          const r = await e.fixer.accept({ id: offer.id, fixer: step.fixer }, 'cash')
          if (r.status !== 'applied') throw new Error(`接不了：${r.reason ?? r.status}`)
          break
        }
        case 'depart': {
          const job = e.fixer.jobs()[0]
          if (!job) throw new Error('手上沒有委託。')
          const r = await e.fixer.go(job.id)
          if (r.status !== 'applied') throw new Error(`出發不了：${r.reason ?? r.status}`)
          break
        }
        case 'enterStage': {
          const a = await e.commission.chooseFace(step.face)
          if (a.status !== 'applied') throw new Error(`選不了面：${a.reason ?? a.status}`)
          const b = await e.commission.chooseBranch(step.branch)
          if (b.status !== 'applied') throw new Error(`選不了分支：${b.reason ?? b.status}`)
          break
        }
        case 'walk': {
          for (let i = 0; i < step.count; i++) {
            const dirs = (['north', 'south', 'east', 'west'] as const).filter((d) => e.world.grid()?.moves[d] === null)
            if (!dirs.length) break
            e.world.walk(dirs[i % dirs.length]!)
          }
          break
        }
        case 'rewindToStage': choiceResult = e.rewindToStage(); break
        case 'retryBattle': choiceResult = e.retryBattle(); break
      }
    } catch (x) {
      thrown.push(String(x))
    }
  }

  const top = e.log[0]
  return {
    time: { ...e.state.time },
    money: { ...e.money },
    logCount: e.log.length,
    logTop: top?.prose[0] ?? null,
    rollRerolls: (top?.roll as { rerolls?: number } | undefined)?.rerolls ?? 0,
    reportCount: e.state.reports.length,
    legacyMoneyKeys: Object.keys((g.serialize() as { money?: object }).money ?? {}).sort(),
    busyWhileFirstRunning,
    loadResult,
    choiceResult,
    inBattle: e.inBattle,
    pendingDefeat: e.pendingDefeat !== null,
    commission: ((v) => (v ? { stage: v.stage, step: v.step } : null))(e.commission.view()),
    jobs: e.fixer.jobs().length,
    thrown,
  }
}

/** 照點分隔的路徑取值 */
export function at(v: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), v)
}
