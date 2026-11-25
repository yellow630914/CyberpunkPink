import type { ContentEntry } from '@engine/src'
import { SHOPS } from '../shops'
import { ITEMS } from '../items'
import { DISTRICTS, blockSpec } from '../districts'
import type { ItemDef, Legality, TradeCategory } from '../types'
import { blockIdOf, markerOfFacility } from './world'

/**
 * 示意世界包的「過日子」部分（M2-ui-life；dev/work/M2-plan.md 使用者定案第 5 項）：把 ui/src/data/shops.ts 的三間店與它們的貨、
 * 幾份打工、三處住處整理成引擎的內容（item、shop_type、shop、job、residence；格式見 features/trade、work、rest）。
 * 整份是資料轉換：沒有價錢、報酬、回復量的算式（那些全是引擎的）。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試不用它（測試自帶最小假資料）。
 */
type Rec = Record<string, unknown>

const LEGAL: Record<Legality, string> = { 自由: 'free', 登記: 'register', 許可: 'permit', 違禁: 'banned' }
/** 貿易類別（舊資料用中文名）對到引擎 trade_rules 的類別 id */
const TRADE: Record<TradeCategory, string> = {
  食物: 'food', 日用: 'daily', 藥: 'medicine', 彈藥: 'ammo', 武器: 'weapon', 護甲與服裝: 'apparel', 機械義體與零件: 'mech', 生體件: 'bio', 電子: 'electronics',
  燃料: 'fuel', 奢侈品: 'luxury', 素材與帶子: 'material', 家具: 'furniture',
}
const CATEGORY: Record<string, string> = { consumable: 'consumable', drug: 'consumable', tool: 'tool', weapon: 'weapon', armor: 'armor', part: 'part', cyberware: 'part', furniture: 'misc' }

function itemOf(d: ItemDef, shop: string): Rec {
  const statsText = (d.stats ?? []).map(([k, v]) => `${k}：${v}`).join('；')
  return {
    id: d.id, name: d.name, desc: d.note ?? (statsText || `${d.type}。`), category: CATEGORY[d.kind] ?? 'misc', grade: d.grade, size: 0, legal: LEGAL[d.legality], price: Math.round(d.price),
    trade_category: TRADE[d.trade], tags: [`stock_${shop}`, ...(d.kind === 'drug' ? ['medical'] : [])],
  }
}

/** 設施在舊資料裡的位置：區、街區 id、版面上的標記（找不到會丟錯，示意包不該有指不到的店） */
function locate(facilityId: string): { district: string; block: string; marker: string } {
  for (const d of DISTRICTS) for (const name of d.blocks) {
    if (!blockSpec(d.id, name).facilities.some(f => f.id === facilityId)) continue
    const block = blockIdOf(d.id, name)
    const marker = markerOfFacility(block, facilityId)
    if (marker) return { district: d.id, block, marker }
  }
  throw new Error(`示意包：找不到設施 ${facilityId}。`)
}

/** 每間店的資料：後台勢力（引擎的勢力 id）、店主（引擎的 NPC id）、店的種類名字、收不收現金 */
const SHOP_META: Record<string, { owner?: string; backer?: string; typeName: string; cash: boolean | 'only'; scan: boolean; temper: number | null; grade: number }> = {
  alian: { owner: 'npc_lian', typeName: '雜貨店', cash: true, scan: false, temper: -1, grade: 2 },
  gunshop: { backer: 'chrome', typeName: '槍店', cash: true, scan: true, temper: 0, grade: 3 },
  cybershop: { backer: 'honey', typeName: '義體店', cash: true, scan: true, temper: 1, grade: 3 },
}

function shopContent(): { item: Rec[]; shop_type: Rec[]; shop: Rec[] } {
  const item: Rec[] = []
  const seen = new Set<string>()
  const shop_type: Rec[] = []
  const shop: Rec[] = []
  for (const s of Object.values(SHOPS)) {
    const meta = SHOP_META[s.id]!
    const at = locate(s.id)
    for (const st of s.stock) {
      const d = ITEMS[st.def]
      if (!d || seen.has(d.id)) continue
      seen.add(d.id)
      item.push(itemOf(d, s.id))
    }
    shop_type.push({
      id: `demo_${s.id}`, name: meta.typeName, catalog: [`stock_${s.id}`], buys: [`stock_${s.id}`, 'misc'], grade_max: meta.grade, cash: meta.cash, scan_registered: meta.scan,
      shop_mult: s.shopMult, temper: meta.temper,
    })
    shop.push({
      id: s.id, type: `demo_${s.id}`, name: s.name, district: at.district, block: at.block, facility: at.marker,
      ...(meta.owner ? { owner: meta.owner } : {}), ...(meta.backer ? { backer: meta.backer } : {}),
      fixed: s.stock.filter(x => x.special).map(x => x.def),
    })
  }
  return { item, shop_type, shop }
}

/** 打工（DOWNTIME 第 4 節）：兩份，一份在阿蓮雜貨（有雇主、三個階段），一份在麵攤（沒有雇主、兩個階段） */
function jobContent(): Rec[] {
  const market = locate('alian')
  const noodle = locate('noodle')
  return [
    {
      id: 'job_alian_counter', name: '阿蓮雜貨的店員', facility: `${market.block}/${market.marker}`, district: market.district, employer: 'npc_lian',
      check: { attr: 'charm', skill: 'negotiate', dc: 10 }, wage: 12, pay: 'cash',
      stages: [
        { name: '店員', mult: 1 },
        { name: '顧櫃檯', mult: 1.3, need: { hours: 30, affinity: 0 } },
        { name: '代店長', mult: 1.6, need: { hours: 72, affinity: 20 } },
      ],
    },
    {
      id: 'job_noodle_helper', name: '麵攤幫工', facility: `${noodle.block}/${noodle.marker}`, district: noodle.district,
      check: { attr: 'body', skill: 'athletics', dc: 9 }, wage: 9, pay: 'cash',
      stages: [
        { name: '洗碗', mult: 1 },
        { name: '掌勺', mult: 1.4, need: { hours: 30, affinity: 0 } },
      ],
    },
  ]
}

/**
 * 住處（DOWNTIME 7.2 節）：四號塔的單位、舊港的貨櫃屋（只收現金）、旅館坡的膠囊房。
 * 沒有寫 start（開局就租著）：示範的局開在第 14 天（stores/game.ts 把時間往前推 13 天），開局就有租約的話會補收兩週房租，帳戶與紀錄就不是舊假存檔的樣子了；要住進去先租。
 */
function residenceContent(): Rec[] {
  const home = locate('myhome')
  return [
    { id: 'res_hive_unit', name: '四號塔的單位（7 樓）', district: home.district, block: home.block, facility: home.marker, level: 1, rent: 150, cash_ok: true },
    { id: 'res_oldport_container', name: '舊港的貨櫃屋', district: 'oldport', block: blockIdOf('oldport', '貨櫃城'), level: 0, rent: 120, cash_ok: 'only' },
    { id: 'res_ave42_capsule', name: '旅館坡的膠囊房', district: 'ave42', block: blockIdOf('ave42', '旅館坡'), level: 2, rent: 260 },
  ]
}

export function lifeContent(): Record<string, ContentEntry[]> {
  const { item, shop_type, shop } = shopContent()
  return { item, shop_type, shop, job: jobContent(), residence: residenceContent() } as unknown as Record<string, ContentEntry[]>
}
