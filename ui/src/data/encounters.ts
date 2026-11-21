import type { RealSetup, RealUnitSpec } from '../lib/combat/real'
import type { NetSetup, NetUnitSpec } from '../lib/combat/net'
import { cover } from '../lib/combat/field'

/**
 * 遭遇（假資料）：從子網、地下城、委託連到戰鬥畫面時用哪一組。
 * 數字照 Demo（BALANCE 第 2 節的 I 級：雜兵 45 生命、感載 22、1 層；精英 110、37、2 層；ENEMIES 1.5 節）。
 */
export const REAL_PARTY: RealUnitSpec[] = [
  { name: '奈奈', role: '前鋒', hp: 50, armor: 3, lm: 36, lay: 3, ap: 5, refl: 1, gun: 3, mel: 5, will: 2, kit: 1, ws: ['shotgun', 'knife'] },
  { name: '零', role: '灌手', hp: 44, armor: 2, lm: 40, lay: 3, ap: 6, refl: 2, gun: 4, will: 3, ws: ['stun', 'pistol'] },
  { name: '你', role: '槍手', hp: 46, armor: 2, lm: 38, lay: 3, ap: 5, refl: 3, gun: 5, will: 1, kit: 1, ws: ['rifle', 'pistol'] },
  { name: '喬', role: '狙擊手', hp: 44, armor: 2, lm: 38, lay: 3, ap: 5, refl: 2, gun: 5, will: 2, ws: ['sniper', 'pistol'] },
]
const mook = (name: string, ws: string[], o: Partial<RealUnitSpec> = {}): RealUnitSpec => ({ name, role: '雜兵', hp: 45, armor: 1, lm: 22, lay: 1, ap: 4, refl: 0, gun: 3, mel: 3, will: 1, ws, ...o })
const elite = (name: string, ws: string[], o: Partial<RealUnitSpec> = {}): RealUnitSpec => ({ name, role: '精英', hp: 110, armor: 1, lm: 37, lay: 2, ap: 5, refl: 0, gun: 3, will: 3, tier: 2, elite: true, ws, ...o })

export interface RealEncounter { id: string; name: string; place: string; setup: RealSetup; from: string }
export const REAL_ENCOUNTERS: RealEncounter[] = [
  { id: 'warehouse', name: '倉庫的保全', place: '舊港・藍鯨第三倉', from: '/', setup: { party: REAL_PARTY, foes: [mook('打手', ['knife', 'pistol'], { will: 0 }), mook('保全', ['stun', 'pistol']), mook('保全', ['smg']), elite('小隊長', ['rifle', 'pistol'])] } },
  { id: 'chute', name: '滑道底的拾荒者', place: '蜂巢・垃圾滑道', from: '/dungeon', setup: { party: REAL_PARTY, foes: [mook('拾荒者', ['knife', 'pistol']), mook('拾荒者', ['pistol']), mook('拾荒者', ['smg'])], covE: [cover(1), cover(1), cover(2), cover(0)] } },
  { id: 'capture', name: '要活的：第三倉的會計', place: '舊港・藍鯨第三倉', from: '/', setup: { party: REAL_PARTY, foes: [mook('保全', ['knife', 'pistol']), elite('會計', ['pistol'], { gun: 2 }), mook('保全', ['smg'])], capture: 1 } },
]

export const NET_PARTY: NetUnitSpec[] = [
  { name: '奈奈', skin: '特攻服', av: 'cat', lm: 38, lay: 3, ap: 5, ram: 4, prot: 3, refl: 1, gun: 3, mel: 5, will: 2, intf: 1, sm: 2, tier: 2, ws: ['scatter', 'blade'] },
  { name: '零', skin: '魔法少女', av: 'cat', lm: 40, lay: 3, ap: 6, ram: 8, rr: 3, prot: 2, refl: 2, gun: 4, will: 3, intf: 6, sm: 3, admin: 2, tier: 2, ws: ['needle', 'jam'] },
  { name: '你', skin: '畫報女郎', av: 'cat', lm: 38, lay: 3, ap: 5, ram: 4, prot: 2, refl: 3, gun: 5, will: 1, sm: 2, tier: 2, ws: ['pulse', 'needle'] },
  { name: '喬', skin: '哥德羅莉', av: 'cat', lm: 38, lay: 3, ap: 5, ram: 5, prot: 2, refl: 2, gun: 5, will: 2, intf: 1, sm: 2, tier: 2, ws: ['lance', 'needle'] },
]
const lace = (name: string, skin: string, o: Partial<NetUnitSpec> = {}): NetUnitSpec => ({ name, skin, av: 'lace', lm: 22, lay: 1, ap: 4, ram: 4, prot: 1, refl: 0, gun: 3, mel: 3, will: 1, xd: 1, ws: ['stream'], ...o })
export interface NetEncounter { id: string; name: string; place: string; setup: NetSetup; from: string }
export const NET_ENCOUNTERS: NetEncounter[] = [
  { id: 'bluewhale', name: '粉蕾絲的巡邏', place: '子網・藍鯨物流', from: '/subnet', setup: { party: NET_PARTY, trace: 15, foes: [lace('守衛程式', '吉祥物型', { av: 'bot', will: 0, ws: ['blade', 'needle'] }), lace('粉蕾絲', '女僕型'), lace('粉蕾絲', '女僕型'), lace('粉蕾絲', '女僕長', { lm: 37, lay: 2, ap: 5, ram: 6, rr: 3, will: 3, tier: 2, elite: true, sync: 2, sm: 2, ws: ['pulse', 'needle'] })] } },
  { id: 'patrol', name: '巡邏的守衛程式', place: '子網・藍鯨物流', from: '/subnet', setup: { party: NET_PARTY, trace: 20, foes: [lace('守衛程式', '吉祥物型', { av: 'bot', ws: ['blade', 'needle'] }), lace('守衛程式', '吉祥物型', { av: 'bot', ws: ['needle'] })] } },
]
