/** 待處理（UI 3.3 節）：引擎的 pendingEvents() 回傳 {id, kind, blocking, ref, due}。這裡是它的假資料。每週帳單已經是引擎的（features/bills），待處理裡沒有假帳單。 */
export interface PendingItem { id: string; kind: '帳單' | '人情' | '名冊' | '頻道' | '委託' | '戰敗' | '契約'; title: string; body: string; due?: string; blocking?: boolean; action?: { label: string; dialog?: string; props?: Record<string, unknown>; route?: string } }
export const PENDING: PendingItem[] = [
  { id: 'p_scoop', kind: '頻道', title: '萬華鏡搶先播了清查公告', body: '對手頻道搶了七號塔的料。可以回應，或當作沒看到。', due: '2 天', action: { label: '打開頻道', dialog: 'channel' } },
]
