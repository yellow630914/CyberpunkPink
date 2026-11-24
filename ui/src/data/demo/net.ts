import type { Change, ContentEntry } from '@engine/src'

/**
 * 示意世界包的「內海」部分（M3-ui-deck；dev/adr/0018 第三節、dev/work/M3-deck.md 的格式）：
 * 一副 II 級的入門甲板、三個武器構裝（步槍、近戰、干擾各一）、兩個防護、兩個工具（一個被動）、一支腳本、兩套 SKIN，
 * 與開新局時送給主角並裝好的那份變更（`demoNetChanges`）。名字照 ITEMS 11 節的示意，數字是示意的。
 * 整份是資料：沒有任何規則（槽數、能不能裝、防護取哪一個都是引擎 features/deck 的）。
 * 構裝與 SKIN 的 id 沿用舊資料（`data/items2.ts`）的，畫面查得到圖標與染色；其餘新的。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試不用它（測試自帶最小假資料）。
 */
type Rec = Record<string, unknown>

/** 開局送的甲板在背包裡的編號（`actor.ext.deck.uid` 指向它） */
export const DEMO_DECK_UID = 'D_START'
export const DEMO_DECK = 'dk_nightingale_2'
export const DEMO_SCRIPT = 'it_script_refill'

const deck: Rec[] = [
  { id: DEMO_DECK, name: '夜鶯入門甲板 II', desc: '夜鶯的入門款：四個構裝槽，防火牆 12，記憶體稍微加寬。便宜、耐用、很多人的第一副甲板。', grade: 2, slots: 4, firewall: 12, ram: { max: 2, regen: 1 }, cooling: 1, brand: '夜鶯', legal: 'free', price: 2500 },
]

const weapon = (id: string, name: string, grade: number, o: Rec): Rec => ({ id, class: 'weapon', name, grade, brand: '夜鶯', ram: 1, type: 'neural', ...o })
const construct: Rec[] = [
  weapon('cs_night_rifle', '構裝「夜巡」III', 3, { desc: '步槍原型：穿透防護，近身扣命中。', archetype: 'rifle', legal: 'banned', price: 1800 }),
  weapon('cs_blade2', '構裝「光刃」II', 2, { desc: '近戰原型：只能打近身，無聲。', archetype: 'melee', legal: 'permit', price: 460 }),
  weapon('cs_static2', '構裝「靜電」II', 2, { desc: '干擾：命中時目標一類構裝停用一回合。', archetype: 'pistol', type: 'jam', ram: 2, brand: '織女', legal: 'permit', price: 520 }),
  { id: 'cs_window1', class: 'defense', name: '構裝「客服窗」I', grade: 1, brand: '夜鶯', guard: 2, legal: 'free', price: 230, desc: '穩，沒有懲罰。' },
  { id: 'cs_cool2', class: 'defense', name: '構裝「散熱罩」II', grade: 2, brand: '織女', guard: 3, legal: 'free', price: 450, desc: '防護 3；同時只有最高的那一件算數。' },
  { id: 'cs_probe2', class: 'tool', name: '構裝「探針」II', grade: 2, brand: '夜鶯', ap: 1, ram: 1, target: 'foe', do: [{ op: 'status', status: 'marked' }], legal: 'free', price: 520, desc: '標記一個敵人：打他的命中 +2。' },
  { id: 'cs_refill2', class: 'tool', name: '構裝「回填器」II', grade: 2, brand: '夜鶯', ap: 0, ram: 0, passive: true, mods: { ap_regen: 1 }, legal: 'free', price: 650, desc: '被動：裝著就有效，每回合多回 1 點行動點。佔一個構裝槽。' },
]

const skin: Rec[] = [
  { id: 'it_64cfe6', name: '預設化身', style: '街頭', style_value: 1, exposure: 0, cut: 'neutral', adult: false, price: 0 },
  { id: 'it_d212f6', name: '應援 T', style: '偶像', style_value: 2, exposure: 0, cut: 'neutral', adult: false, price: 130 },
]

const item: Rec[] = [
  {
    id: DEMO_SCRIPT, name: '腳本「回填包」II', desc: 'RAM 立刻回 3 點，不超過上限。一次性，存在甲板裡。', category: 'consumable', grade: 2, size: 0, legal: 'free', price: 90, tags: ['script'],
    use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 3, who: 'self' }] },
  },
]

// 干擾武器要規則表裡有三個停用的狀態（正式的由 M3-data-rules 寫；規則表是可以被取代的內容，之後載入的同 id 會蓋掉這一份）
const battle_status: Rec[] = (['weapon', 'defense', 'tool'] as const).map((s) => ({
  id: `jam_${s}`, name: `${{ weapon: '武器', defense: '防護', tool: '工具' }[s]}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff',
}))

export function netContent(): Record<string, ContentEntry[]> {
  return { deck, construct, skin, item, battle_status } as unknown as Record<string, ContentEntry[]>
}

/**
 * 開新局時送給主角的：一副甲板、各種構裝、兩套 SKIN、兩支腳本；裝好甲板、三個構裝（夜巡、客服窗、探針，留一個空槽）、
 * 穿著應援 T、帶著回填包。只給有主角的局（建角的開新局），跟在建角的報告後面。
 */
export function demoNetChanges(pc = 'pc'): Change[] {
  const give = (id: string, qty = 1, data?: Rec): Change => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as unknown as Change
  return [
    give(DEMO_DECK, 1, { uid: DEMO_DECK_UID }),
    ...construct.map((c) => give(c.id as string)),
    ...skin.map((s) => give(s.id as string)),
    give(DEMO_SCRIPT, 2),
    { op: 'actor.ext', id: pc, key: 'deck', value: { uid: DEMO_DECK_UID, slots: ['cs_night_rifle', 'cs_window1', 'cs_probe2'], skin: 'it_d212f6', scripts: [{ item: DEMO_SCRIPT, qty: 2 }] } } as unknown as Change,
  ]
}
