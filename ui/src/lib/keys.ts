/**
 * 全域快捷鍵（UI.md 1.1 節）：純函式，把一次按鍵翻成一個動作。由 App 的全域監聽器分派。
 * - 方向鍵與 WASD 走一格、E 互動：不必先點地圖，只要這一頁有可以走的地圖、沒有對話框開著、不是在打字。
 * - 字母開對話框；Esc 關最上面的對話框，沒有對話框時開系統選單；F5／Ctrl+S 快速存檔、F9 快速讀檔。
 */
export type DialogKey = 'bag' | 'character' | 'skills' | 'memo' | 'pending' | 'roster' | 'relations' | 'craft' | 'channel' | 'contract' | 'bills' | 'saves' | 'settings'
export type KeyAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'interact' }
  | { type: 'dialog'; name: DialogKey }
  | { type: 'city' }
  | { type: 'home' }
  | { type: 'escape' }
  | { type: 'quicksave' }
  | { type: 'quickload' }

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean }
export interface KeyContext {
  /** 焦點在輸入框、下拉或可編輯的區塊裡 */
  typing: boolean
  /** 有對話框開著 */
  dialogOpen: boolean
  /** 這一頁有可以走的格子地圖（主畫面的街區、家園、子網、地下城） */
  canMove: boolean
  /** 在遊戲裡的畫面（主畫面、家園、子網、地下城）：字母快捷鍵只在這些畫面有用 */
  inGame: boolean
  /** 在主畫面（城市地圖只從主畫面開） */
  onMain: boolean
}

const MOVES: Record<string, [number, number]> = {
  arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
}
/** 字母 → 對話框。顯示在工具列的提示與設定的快捷鍵表（SHORTCUTS）裡。 */
export const DIALOG_KEYS: Record<string, DialogKey> = {
  b: 'bag', c: 'character', k: 'skills', j: 'memo', n: 'pending', r: 'roster', l: 'relations', g: 'craft', v: 'channel', t: 'contract', y: 'bills',
}

export function keyAction(e: KeyLike, ctx: KeyContext): KeyAction | null {
  const k = e.key.toLowerCase()
  const mod = !!(e.ctrlKey || e.metaKey)
  if (k === 'escape') return { type: 'escape' }
  if ((mod && k === 's') || k === 'f5') return ctx.inGame ? { type: 'quicksave' } : null
  if (k === 'f9') return ctx.inGame ? { type: 'quickload' } : null
  if (ctx.typing || ctx.dialogOpen || mod || e.altKey) return null
  const mv = MOVES[k]
  if (mv) return ctx.canMove ? { type: 'move', dx: mv[0], dy: mv[1] } : null
  if (k === 'e') return ctx.canMove ? { type: 'interact' } : null
  if (!ctx.inGame || e.repeat) return null
  if (k === 'm') return ctx.onMain ? { type: 'city' } : null
  if (k === 'h') return { type: 'home' }
  const d = DIALOG_KEYS[k]
  return d ? { type: 'dialog', name: d } : null
}

/**
 * 戰鬥畫面的鍵（現實戰鬥、內海戰鬥、輿論戰）：1～9 按行動圓環的格（輿論戰是手牌），空白鍵結束回合，
 * Tab／Shift+Tab 換目標，Enter 對選中的目標執行，Esc 取消選目標（沒在選目標時交給全域的 Esc）。
 */
export type CombatKey = { type: 'ring'; i: number } | { type: 'end' } | { type: 'cycle'; dir: 1 | -1 } | { type: 'confirm' } | { type: 'cancel' }
export function combatKey(e: KeyLike, ctx: { typing: boolean; dialogOpen: boolean; targeting: boolean }): CombatKey | null {
  if (ctx.typing || ctx.dialogOpen || e.ctrlKey || e.metaKey || e.altKey) return null
  const k = e.key
  if (/^[1-9]$/.test(k)) return e.repeat ? null : { type: 'ring', i: Number(k) - 1 }
  if (k === ' ' || k === 'Spacebar') return e.repeat ? null : { type: 'end' }
  if (k === 'Tab') return { type: 'cycle', dir: e.shiftKey ? -1 : 1 }
  if (k === 'Enter') return ctx.targeting ? { type: 'confirm' } : null
  if (k === 'Escape') return ctx.targeting ? { type: 'cancel' } : null
  return null
}

/** 目標是不是在打字（輸入框、下拉、多行、可編輯）。 */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** 設定的「顯示」分頁列出的快捷鍵（也是工具列提示的來源）。 */
export const SHORTCUTS: Array<{ keys: string[]; name: string }> = [
  { keys: ['↑', '↓', '←', '→'], name: '走一格（也可以用 W A S D）' },
  { keys: ['E'], name: '和腳下的東西互動' },
  { keys: ['M'], name: '城市地圖（主畫面）' },
  { keys: ['C'], name: '角色與義體' },
  { keys: ['B'], name: '背包' },
  { keys: ['K'], name: '技能樹' },
  { keys: ['R'], name: '名冊' },
  { keys: ['L'], name: '關係' },
  { keys: ['J'], name: '備忘錄' },
  { keys: ['N'], name: '待處理' },
  { keys: ['G'], name: '組裝' },
  { keys: ['V'], name: '頻道' },
  { keys: ['T'], name: '契約' },
  { keys: ['Y'], name: '每週帳單' },
  { keys: ['H'], name: '家園' },
  { keys: ['F5', 'Ctrl+S'], name: '快速存檔（存進自動格）' },
  { keys: ['F9'], name: '快速讀檔（讀最新的自動格）' },
  { keys: ['Esc'], name: '關掉最上面的對話框；沒有對話框時打開選單' },
  { keys: ['1～9'], name: '戰鬥：行動圓環的第 1～9 格（內環攻擊、中環補充、外環戰術）；輿論戰：第 1～5 張手牌' },
  { keys: ['Space'], name: '戰鬥：結束回合' },
  { keys: ['Tab', 'Shift+Tab'], name: '戰鬥：換目標（選目標的時候）' },
  { keys: ['Enter'], name: '戰鬥：對選中的目標執行' },
  { keys: ['Esc'], name: '戰鬥：取消選目標' },
]
/** 對話框 → 顯示用的鍵（工具列的提示）。 */
export const KEY_OF: Record<string, string> = { ...Object.fromEntries(Object.entries(DIALOG_KEYS).map(([k, d]) => [d, k.toUpperCase()])), home: 'H', city: 'M' }
