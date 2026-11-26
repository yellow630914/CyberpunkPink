/**
 * 建角在介面端留著的純文字：調整值的正負號。
 * 點數、能不能選、擋住的原因、買得到什麼、建議組合、外觀裡推出來的三樣（外露的義體、獸化、風格）一律問引擎（stores/engine.ts 的 creation；features/creation）。
 */

/** 調整值帶正負號（−2、+0、+3）。 */
export const fmtMod = (m: number) => (m < 0 ? `−${-m}` : `+${m}`)
