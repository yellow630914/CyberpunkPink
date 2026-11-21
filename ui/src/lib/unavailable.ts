/**
 * 做不到的一律灰掉（UI.md 1.1 節）：給一個原因，回傳要綁在元素上的屬性（class、aria-disabled、title）。
 * 沒有原因（可以選）時回傳空物件。黃框只表示「選中」或「警告」，不用在這裡。
 */
export interface UnavailableAttrs { class?: string; 'aria-disabled'?: 'true'; title?: string }
export function unavailable(reason?: string | null | false): UnavailableAttrs {
  return reason ? { class: 'is-unavailable', 'aria-disabled': 'true', title: reason } : {}
}
