import { ref } from 'vue'
import type { AutoInput, BidInput } from '@engine/src/features/auction'

/**
 * 拍賣的自動跟價（LEWD_SYSTEM 6.2 第 6 點）：引擎一回合一份報告。這裡替玩家逐回合送 { act: 'auto_next' }，每回合之間等一下讓畫面更新、隨時可以取消（{ act: 'auto_off' }）。
 * 何時停全看引擎的答案：這一手被擋、引擎把上限拿掉（view.auto 變 null：落槌或上限到了）、換了一件、整場結束（view 是 null）。
 * 沒有規則：不判斷要不要跟、跟多少，那是引擎的 autoChoice。
 */
export interface AutoDeps {
  bid: (input: BidInput | AutoInput) => Promise<{ status: string; reason?: string }>
  /** 引擎的 auctionView：只讀 auto（設著的上限或 null）與 lot_no；整場結束是 null */
  view: () => { auto: number | null; lot_no: number } | null
  /** 每回合之間讓畫面更新的毫秒數 */
  delay: number
  /** 這一手被擋或取消不成時的原因 */
  onBlocked?: (reason: string) => void
}

export function createAutoBid(deps: AutoDeps) {
  const looping = ref(false)
  let cancelled = false
  let disposed = false
  let wake: (() => void) | null = null
  const sleep = (ms: number) => new Promise<void>((res) => {
    const t = setTimeout(() => { wake = null; res() }, ms)
    wake = () => { clearTimeout(t); wake = null; res() }
  })

  async function off(): Promise<void> {
    const cur = deps.view()
    if (!cur || cur.auto === null) return
    const r = await deps.bid({ act: 'auto_off' })
    if (r.status !== 'applied') deps.onBlocked?.(r.reason ?? '現在取消不了。')
  }

  /** 設上限並開始（max 給了就先送 { auto: { max } }），沒給就照引擎已經設著的上限繼續（auto_next）；一直送到引擎說停 */
  async function run(max?: number): Promise<void> {
    if (looping.value) return
    looping.value = true
    cancelled = false
    const lot = deps.view()?.lot_no
    try {
      let input: BidInput | AutoInput = max !== undefined ? { auto: { max } } : { act: 'auto_next' }
      for (;;) {
        const r = await deps.bid(input)
        if (r.status !== 'applied') { deps.onBlocked?.(r.reason ?? '現在不能自動跟價。'); break }
        const cur = deps.view()
        if (!cur || cur.auto === null || cur.lot_no !== lot || cancelled || disposed) break
        await sleep(deps.delay)
        if (cancelled || disposed) break
        input = { act: 'auto_next' }
      }
    } finally {
      looping.value = false
      if (cancelled && !disposed) { cancelled = false; await off() }
    }
  }

  /** 取消：在跑就停在這一回合之後送 auto_off（不再多走一回合）；沒在跑（例如重新打開會場）直接送 */
  async function cancel(): Promise<void> {
    if (looping.value) { cancelled = true; wake?.(); return }
    await off()
  }

  /** 畫面關掉：迴圈停下來，不送 auto_off（上限留在引擎裡，下次回來可以「照上限繼續」或取消） */
  function dispose(): void { disposed = true; wake?.() }

  return { looping, run, cancel, dispose }
}
