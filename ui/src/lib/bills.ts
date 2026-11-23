/**
 * 帳單倍率的四個快捷檔位（設定與建角的存檔規則用）。結算、順序、欠繳與下坡路全是引擎的（features/bills；畫面看 stores/engine.ts 的 bills 與 lib/lifeView.ts）。
 * 這裡只留「檔位的名字對到倍率」：存檔規則的 billMult 才是真的值，引擎自己夾在 0～2。
 */
export type BillPreset = '關閉' | '寬鬆' | '標準' | '嚴苛'
export const PRESET_MULT: Record<BillPreset, number> = { 關閉: 0, 寬鬆: 0.5, 標準: 1, 嚴苛: 1.5 }
