// L0 型別：時間。以小時計，另有時段與星期（MIGRATION A「時段」、CORE_RULES 7.4 節）。

export interface GameTime {
  /** 第幾天，從 1 開始 */
  day: number
  /** 0～23 */
  hour: number
  /** 0～59 */
  minute: number
}

/** 一天六個時段，各 4 小時，從清晨 3 點起算（CORE_RULES 7.4 節）：清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3。 */
export const SEGMENT_IDS = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late'] as const
export type SegmentId = (typeof SEGMENT_IDS)[number]

/** 0＝週一 … 6＝週日。 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
