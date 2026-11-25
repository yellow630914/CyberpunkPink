// L6 功能 curtain 的變更 curtain.patch：改 state.ext.curtain 裡的一小塊，不整筆覆蓋。
//
// 為什麼不用 curtainChange（整筆換掉）：一趟裡好幾個掛點（戰鬥結束、場景結束、netrun 結束）可能在同一份報告裡各改一點，而它們讀到的狀態都是這份報告之前的；
// 整筆覆蓋會讓後面的蓋掉前面的。curtain.patch 在「套用的那一刻」讀現在的狀態再改，所以互相不會蓋掉（和計數器是加法同一個道理）。
// 只有這個功能自己寫它（內建的來源）；報告裡的 changes 記的就是這一筆，要看改了什麼讀 patch 的欄位。
//
//   run.set     淺合併進這一趟（欄位照 RunRecord；值是 undefined 的不收，要拿掉寫 run.unset）
//   run.unset   拿掉這幾個欄位
//   run.inc     數字加減（downed、over_turns、docked、tips_mult；tips_mult 四捨五入到小數 4 位）
//   run.order_add、run.order_set  點單的紀錄：加一筆、改第幾筆的狀態與票根
//   run.booked  用過包場的幕加一個
//   run.clear   這一趟收掉（連同開著的點單）
//   clears      會員在這個席次的破關次數加幾
//   tips        這一週的打賞加幾
//   encore      可以加演的紀錄（null 是拿掉）

import type { Change, GameState, Kernel } from '../../core'
import { clone } from '../../core'
import type { EncoreRec, OrderRec, RunRecord } from './model'
import { EXT, isInt, readCurtain } from './model'

export const PATCH_OP = 'curtain.patch'

export interface RunPatch {
  set?: Partial<RunRecord>
  unset?: Array<keyof RunRecord>
  inc?: Partial<Record<'downed' | 'over_turns' | 'docked' | 'tips_mult', number>>
  order_add?: OrderRec
  order_set?: { index: number; state?: OrderRec['state']; stubs?: number }
  booked?: number
  clear?: true
}

export interface PatchChange extends Change {
  op: typeof PATCH_OP
  run?: RunPatch
  clears?: number
  tips?: number
  encore?: EncoreRec | null
}

/** 一筆 curtain.patch。 */
export const patch = (p: Omit<PatchChange, 'op'>): Change => ({ op: PATCH_OP, ...clone(p) }) as unknown as Change

/** 只改這一趟的一小塊。 */
export const runPatch = (r: RunPatch): Change => patch({ run: r })

const round4 = (n: number): number => Math.round(n * 10000) / 10000

function validate(state: GameState, c: PatchChange): string[] {
  const cur = readCurtain(state)
  const p: string[] = []
  const r: RunPatch | undefined = c.run
  if (r !== undefined) {
    if (!cur.run) p.push('現在沒有簾後館的一趟，改不了。')
    else if (r.order_set && !cur.run.orders?.[r.order_set.index]) p.push(`沒有第 ${r.order_set.index} 筆點單。`)
  }
  if (c.clears !== undefined && !(isInt(c.clears))) p.push('clears 要是整數')
  if (c.clears !== undefined && !cur.member) p.push('還不是會員，破關次數加不上去。')
  if (c.tips !== undefined && !(isInt(c.tips) && c.tips >= 0)) p.push('tips 要是 0 以上的整數')
  if (c.tips !== undefined && !cur.week) p.push('這一週還沒有紀錄，打賞記不上去。')
  return p
}

function apply(state: GameState, c: PatchChange): void {
  const cur = readCurtain(state)
  const r = c.run
  if (r && cur.run) {
    if (r.clear) delete cur.run
    else {
      const run = cur.run
      if (r.set) for (const [key, v] of Object.entries(r.set)) if (v !== undefined) (run as unknown as Record<string, unknown>)[key] = clone(v)
      for (const key of r.unset ?? []) delete (run as unknown as Record<string, unknown>)[key]
      for (const [key, d] of Object.entries(r.inc ?? {})) {
        const now = key === 'tips_mult' ? (run.tips_mult ?? 1) : ((run as unknown as Record<string, number | undefined>)[key] ?? 0)
        ;(run as unknown as Record<string, number>)[key] = key === 'tips_mult' ? round4(now + (d as number)) : now + (d as number)
      }
      if (r.order_add) run.orders = [...(run.orders ?? []), clone(r.order_add)]
      if (r.order_set) {
        const o = run.orders![r.order_set.index]!
        if (r.order_set.state) o.state = r.order_set.state
        if (r.order_set.stubs !== undefined) o.stubs = r.order_set.stubs
      }
      if (r.booked !== undefined) run.booked = [...new Set([...(run.booked ?? []), r.booked])]
    }
  }
  if (c.clears && cur.member) cur.member.clears = Math.max(0, cur.member.clears + c.clears)
  if (c.tips && cur.week) cur.week.tips += c.tips
  if (c.encore !== undefined) {
    if (c.encore === null) delete cur.encore
    else cur.encore = clone(c.encore)
  }
  state.ext[EXT] = clone(cur) as never
}

/** 註冊 curtain.patch（功能的 install 呼叫）。 */
export function registerPatch(k: Kernel, owner: string): void {
  k.changes.register<PatchChange>({
    op: PATCH_OP, owner, validate, apply,
    // 報告卡不顯示（現金、場熱、票根各有自己的變更）
    describe: () => null,
  })
}
