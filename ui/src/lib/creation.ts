import { BRAND_LOOK, BEAST_LINES } from '../data/creation'

/**
 * 建角在介面端留著的純文字：調整值的正負號、外觀裡推出來的三樣（外露的義體、獸化、風格；NPC_SYSTEM 13.11 節的模板）。
 * 點數、能不能選、擋住的原因、換多少現金一律問引擎（stores/engine.ts 的 creation；features/creation）；這裡沒有任何規則。
 * 外觀的推導目前還在介面（要不要搬進引擎請 cpp-architect 決定）。
 */

/** 調整值帶正負號（−2、+0、+3）。 */
export const fmtMod = (m: number) => (m < 0 ? `−${-m}` : `+${m}`)

// ---- 外觀裡推出來的三樣（第四版）：外露的義體、獸化、風格 ----
/** 一件物品的風格標籤：「街頭 +1」→ 街頭 1、「櫻町系」→ 櫻町系 1、「+1」沒有標籤。 */
export function styleTags(item: { stats?: Array<[string, string]> }): Array<[string, number]> {
  const out: Array<[string, number]> = []
  for (const [k, v] of item.stats ?? []) {
    if (k !== '風格') continue
    const m = /^(.*?)\s*\+?(\d+)?$/.exec(v.trim())
    const tag = (m?.[1] ?? '').replace(/\+$/, '').trim()
    if (tag) out.push([tag, Number(m?.[2] ?? 1)])
  }
  return out
}
/** 推導外觀要的義體資料：名字與牌子是引擎設計圖的；看得見的部位與獸化零件是示意包的（data/demo/creation.ts 的 CYBER_LOOK） */
export interface LookCyber {
  name: string
  brand: string
  bridge?: boolean
  visible?: { at: string; line?: string }
  beast?: { school: 'mech' | 'bio'; part: 'ears' | 'tail' }
}
export interface DerivedLooks {
  cyber: string[]
  beast: string[]
  style: { tags: Array<[string, number]>; main: string | null; line: string }
}
const brandKey = (brand: string) => (brand.includes('二手') ? '二手' : brand.includes('同人') ? '同人' : brand)
/**
 * 從裝的義體、獸化零件與穿著推出外觀（NPC_SYSTEM 13.11 節的模板）。
 * baseStyle：出身白給的那一套日常服裝的風格（CHARACTER 5.4 節）；line：獸化的系。
 */
export function derivedLooks(o: { cyber: LookCyber[]; gear: Array<{ name: string; stats?: Array<[string, string]>; kind?: string }>; pronoun: string; baseStyle: string; line: string }): DerivedLooks {
  const he = o.pronoun === '自訂' ? '你' : o.pronoun
  const what = (c: LookCyber) => { const b = c.brand.replace('（二手）', '').split('／')[0]; const n = c.name.includes(b) ? c.name : `${b}的${c.name}`; return c.bridge ? `${n}的橋接口` : n }
  const cyber = o.cyber.filter(c => c.visible).map(c => `${he}的${c.visible!.at}是${what(c)}，${c.visible!.line ?? BRAND_LOOK[brandKey(c.brand)] ?? '外殼沒有什麼特別'}。`)
  const L = BEAST_LINES[o.line] ?? BEAST_LINES['貓']
  const look = (school: 'mech' | 'bio') => (school === 'mech' ? '外殼是霧面的黑色，耳根有一圈金屬的接縫' : '毛是真的，摸得到底下的軟骨')
  const beast: string[] = []
  for (const c of o.cyber.filter(x => x.beast)) {
    if (c.beast!.part === 'ears') beast.push(`${he}的頭上有一對${o.line}耳，${look(c.beast!.school)}，${he}${L.mood}的時候耳朵會${L.move}。`)
    else beast.push(`${he}的身後拖著一條${o.line}尾，${c.beast!.school === 'mech' ? '外殼是霧面的黑色，尾根有一圈金屬的接縫' : '毛是真的，摸得到底下的骨節'}。`)
  }
  const sum = new Map<string, number>([[o.baseStyle, 1]])
  for (const it of o.gear) for (const [t, n] of styleTags(it)) sum.set(t, (sum.get(t) ?? 0) + n)
  const tags = [...sum.entries()].sort((a, b) => b[1] - a[1])
  const worn = o.gear.filter(g => g.kind === 'clothing' || g.kind === 'armor' || g.kind === 'accessory').map(g => g.name)
  const line = `${he}今天穿著出身那一區的${o.baseStyle}日常服裝${worn.length ? `，外面加上${worn.join('、')}` : ''}。`
  return { cyber, beast, style: { tags, main: tags[0]?.[0] ?? null, line } }
}
