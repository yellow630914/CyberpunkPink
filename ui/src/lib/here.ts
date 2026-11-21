/**
 * 到了就看得到選單、按 E 才做（UI.md 1.1 節，第四版）：走到設施、出口、車站、節點、地下城的東西上，
 * 「這裡」立刻列出能做的事，但什麼都不自動執行。E 執行這一格的預設選項：是出口（換地圖）就換地圖，
 * 不是就做標成預設的那一個（沒有標就是第一個）。預設選項在選單裡是黃框、帶 E 的鍵帽；點任何一個選項照樣能做。
 */
export interface HereOption {
  id: string
  name: string
  run: () => void
  /** 做不到的原因（灰掉；E 按下去說原因） */
  reason?: string | null
  /** 換地圖的出口：E 一定先做它 */
  exit?: boolean
  /** 這一格的預設選項（E 做它） */
  auto?: boolean
  /** 次要的說明（價錢、回合數） */
  sub?: string
}

/** 這一格的預設選項：出口優先，再來是標成預設的，都沒有就是第一個。 */
export function defaultOption(opts: HereOption[]): HereOption | null {
  return opts.find(o => o.exit) ?? opts.find(o => o.auto) ?? opts[0] ?? null
}

/** 按 E：做預設選項。回傳要提示的話（沒有選項、或預設的那一個做不到），做了就回傳 null。 */
export function pressE(opts: HereOption[]): string | null {
  const d = defaultOption(opts)
  if (!d) return '腳下沒有可以互動的東西。'
  if (d.reason) return d.reason
  d.run()
  return null
}
