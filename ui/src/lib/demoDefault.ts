/**
 * 示意模式的預設值（建置參數 VITE_DEMO_DEFAULT）：正式遊戲沒設，預設關；介面示意版用 `npm run build:preview`（.env.preview 設成 on），預設開。
 * 只是開新局畫面上開關的起始位置，玩家照樣可以切；開著時才有的捷徑（契約開局、簾後館邀請函、拍賣行常客的交情）由引擎照選項建立。
 */
export const demoDefaultOf = (v: string | undefined): boolean => v !== undefined && ['on', '1', 'true'].includes(v.trim().toLowerCase())
/** 現在這一版建置的預設（每次讀 import.meta.env，測試可以用 vi.stubEnv 改） */
export const demoDefault = (): boolean => demoDefaultOf(import.meta.env.VITE_DEMO_DEFAULT)
