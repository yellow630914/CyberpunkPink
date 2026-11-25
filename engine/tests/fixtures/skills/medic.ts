// 改造師：手術刀（SKILL_TREES 改造師一節的內海欄）。id 照 M1b-skill-medic 的（sk_medic_<名字>）。
// 內海的改造師只剩「除錯」（招牌：被動技能在內海欄多一個行動，新鍵 net.action）與每場一兩次的小招：近身的構裝攻擊加干擾（net.jam）、排感載、修破損（net.fix）；
// 打完之後解剖倒下的蕾絲（解剖的 net 欄給標籤 dissect，M3-lace 的掉落 needs: dissect 看它）。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'medic', name: '改造師', tree: '改造師：手術刀', category: 'meat', signature: 'sk_medic_scalpel', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '你用的醫療道具效果多 4 點：回的生命值多 4，或排掉的感載多 4。', effect: { mods: [{ kind: 'heal_dealt', value: 4, tags: ['medical'] }, { kind: 'vent_dealt', value: 4, tags: ['medical'] }] } },
    { tier: 2, cells: 1, text: '每場戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } },
    { tier: 3, cells: 1, text: '醫療檢定 +2。', effect: { mods: [{ kind: 'save', value: 2, tags: ['medicine'] }] } },
    { tier: 4, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
    { tier: 5, cells: 1, text: '生命上限 +5。', effect: { hp_max: 5 } },
  ],
}, 'meat')

const m = (id: string) => `sk_medic_${id}`
const SC = 'sk_medic_scalpel'
type Rec = Record<string, unknown>

/** 近身的構裝攻擊：手上要是近戰構裝、雙方都在第 1 格。 */
const MELEE: Rec = { when: { wield: 'melee' }, range: [1, 1] }
/** 干擾哪一類構裝（玩家選）：武器、防護、工具；命中才停用。turns 是停用幾個回合。 */
const JAM_PICK = [{ key: 'jam', label: '停用哪一類構裝', kind: 'choice', required: true }]
const jamChoose = (turns?: number): Rec[] => [
  { key: 'weapon', label: '武器構裝' }, { key: 'defense', label: '防護構裝' }, { key: 'tool', label: '工具構裝' },
].map((c) => ({ ...c, do: [{ op: 'net.jam', if: 'hit', ...(turns ? { turns } : {}) }] }))
/** 停用兩個構裝（拆光）：三種搭配選一種。 */
const jamTwo: Rec[] = [['weapon', 'defense', '武器與防護'], ['weapon', 'tool', '武器與工具'], ['defense', 'tool', '防護與工具']].map(([a, b, label]) => ({
  key: `${a}_${b}`, label: `${label}構裝`, do: [{ op: 'net.jam', slot: a, if: 'hit' }, { op: 'net.jam', slot: b, if: 'hit' }],
}))
/** 修好一名隊友所有破損的構裝槽：net.fix 一次修一個，這裡連做幾次（沒有破損的就跳過）。 */
const FIX_ALL: Rec[] = Array.from({ length: 8 }, () => ({ op: 'net.fix' }))
const JAMS = ['jam_weapon', 'jam_defense', 'jam_tool']

// ================================ 1 階 ================================
T.skill(SC, '手術刀', 1, 'sig', 'passive', 3, 0, undefined,
  '除錯：每場一次，花 1 行動點，替一名隊友排 4 點感載，或修好他一個破損的構裝槽。', 'done',
  '新鍵：net.action（被動技能在這一欄多一個主動的行動）；用法 choose：vent 4 或 net.fix；use.net.per_fight 1（名醫用修正 use_extra 加一次）',
  {
    use: { net: { ap: 1, per_fight: 1 } },
    net: {
      action: true, target: 'near',
      choose: [{ key: 'vent', label: '排 4 點感載', do: [{ op: 'vent', amount: 4 }] }, { key: 'fix', label: '修好一個破損的構裝槽', do: [{ op: 'net.fix' }] }],
    },
  })

T.skill(m('first_aid'), '戰場急救', 1, 'front', 'active', 1, 1, SC,
  '每場一次，花 1 行動點，解除相鄰隊友身上的干擾。', 'done', '三個干擾狀態 jam_weapon／jam_defense／jam_tool 各 unstatus 一次（對象是自己或相鄰：target near，比設計書多了自己）',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { target: 'near', do: JAMS.map((status) => ({ op: 'unstatus', status })) } })

T.skill(m('dismantle'), '拆解', 1, 'front', 'active', 1, 1, SC,
  '每場一次，近身的構裝攻擊命中時，目標一個構裝停用一回合（干擾）。', 'done', '近戰構裝攻擊（when.wield melee、range 1–1）＋ net.jam（類別是玩家選的）；每場一次、照常花 RAM',
  { use: { net: { ap: 2, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', ...MELEE, picks: JAM_PICK, do: [{ op: 'attack' }], choose: jamChoose() } })

T.skill(m('cool_down'), '冷卻處理', 1, 'front', 'active', 1, 1, SC,
  '每場一次，花 1 行動點，替一名隊友消一層餘韻，讓他離倒下遠一步。', 'done', 'afterglow −1；target near',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { target: 'near', do: [{ op: 'afterglow', amount: -1 }] } })

T.skill(m('suture'), '縫合手', 1, 'back', 'passive', 2, 1, m('first_aid'),
  '你的除錯排感載時多排 2 點。', 'approx', '修正 vent_dealt +2（tags skill）：技能做的排感載都吃得到，不只除錯（排隊領藥、全面翻修也多排 2 點）',
  { net: { mods: [{ kind: 'vent_dealt', value: 2, tags: ['skill'] }] } })

T.gap(m('painless'), '止痛針', 1, 'back', 'reaction', 1, 4, m('first_aid'), { use: { ap: 0, per_fight: 1 } })
T.gap(m('surgery'), '手術', 1, 'back', 'daily', 1, 0, m('dismantle'), { use: { slot: 1 }, daily: { text: '自己動刀安裝、拆卸、修理義體（M4）。' } })

// ================================ 2 階 ================================
T.skill(m('overclock'), '超頻', 2, 'front', 'active', 1, 2, m('cool_down'),
  '每場一次，一名隊友下一次構裝攻擊命中 +1。', 'approx', 'buff：命中 +1，到他的回合結束（沒有「下一次攻擊就用掉」，持續到他的下一個回合結束）',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { target: 'near', do: [buff('medic_overclock', '超頻', { mods: [{ kind: 'hit', value: 1 }] })] } })

T.skill(m('pull_back'), '拉回來', 2, 'front', 'active', 1, 4, m('first_aid'),
  '每場一次，花 2 行動點，替近身一格被釘住的隊友拆掉釘子，他回到戰鬥。', 'none', '沒有「拆掉釘子、回到戰鬥」的效果（缺：net.unpin；revive 只收倒下的人、目標 downed_near 也不列被釘住的）',
  { use: { net: { ap: 2, per_fight: 1 } }, net: { pending: true, text: '每場一次，花 2 行動點，替近身一格被釘住的隊友拆掉釘子，他回到戰鬥。' } })

T.skill(m('find_gap'), '找縫', 2, 'front', 'active', 1, 2, m('dismantle'),
  '每場一次，近身的構裝攻擊無視 1 點防護。', 'done', '近戰構裝攻擊 attack.pierce 1',
  { use: { net: { ap: 2, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', ...MELEE, do: [{ op: 'attack', pierce: 1 }] } })

T.skill(m('dismantle_fun'), '拆解癖', 2, 'back', 'passive', 3, 1.5, m('find_gap'),
  '第一回合近身的構裝攻擊命中 +1。', 'done', '修正 hit +1（when first_round、wield melee）',
  { net: { mods: [{ kind: 'hit', value: 1, when: { first_round: true, wield: 'melee' } }] } })

T.gap(m('rounds'), '巡房', 2, 'back', 'stance', 1, 2, m('pull_back'), { use: { ap: 1 } })

// ================================ 3 階 ================================
T.skill(m('take_off'), '卸下', 3, 'front', 'active', 2, 6, m('find_gap'),
  '每場一次，近身的構裝攻擊命中時，目標一個構裝停用兩回合。', 'done', '同拆解，net.jam turns 2',
  { use: { net: { ap: 3, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', ...MELEE, picks: JAM_PICK, do: [{ op: 'attack' }], choose: jamChoose(2) } })

T.skill(m('line_up'), '排隊領藥', 3, 'front', 'active', 2, 3, m('rounds'),
  '每場一次，花 2 行動點，你與相鄰兩格的隊友各排 4 點感載。', 'done', 'vent 4 落在 near（自己與相鄰）',
  { use: { net: { ap: 2, per_fight: 1 } }, net: { target: 'none', do: [{ op: 'vent', who: 'near', amount: 4 }] } })

T.skill(m('flash_freeze'), '急凍', 3, 'front', 'reaction', 2, 7, m('overclock'),
  '每場一次，隊友過載時他的 RAM 不歸零（不閃斷）。不花行動點。', 'done', 'react.flash { ram: before, end }（overload 掛點）；who ally',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'overload', who: 'ally' }, react: { flash: { ram: 'before', end: true } } } })

T.skill(m('dissection'), '解剖', 3, 'back', 'daily', 2, 0, m('take_off'),
  '被打倒的蕾絲二選一：取得它的一個構裝（和蕾絲同等級），或一份憑證，這次潛入的下一道閘門不必破解（戰後 1 小時；每場戰鬥只能解剖一次）。', 'approx',
  '只做了標籤 dissect（M3-lace 的掉落 needs: dissect 看它）；日常的「戰後解剖」是 netrun 與戰後流程的事，技能這邊沒有日常的行動',
  { use: { slot: 1 }, daily: { text: '現實：戰後 1 小時，從被打倒的敵人身上拆下義體（M4）。內海：被打倒的蕾絲二選一，構裝或憑證。' }, net: { tags: ['dissect'] } })

T.skill(m('locksmith'), '解鎖匠', 3, 'back', 'passive', 4, 2, m('take_off'),
  '第一回合對蕾絲的近身構裝攻擊命中 +1。', 'approx', '修正 hit +1（when first_round、wield melee）；「對蕾絲」沒有條件可以寫（對手標籤不在 when 裡），內海的敵人幾乎都是蕾絲',
  { net: { mods: [{ kind: 'hit', value: 1, when: { first_round: true, wield: 'melee' } }] } })

// ================================ 4 階 ================================
T.skill(m('short_circuit'), '短路', 4, 'front', 'active', 2, 4, m('take_off'),
  '每場一次，近身的構裝攻擊命中時目標暈眩。', 'done', '近戰構裝攻擊 ＋ status dazed（if hit）',
  { use: { net: { ap: 2, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', ...MELEE, do: [{ op: 'attack' }, { op: 'status', status: 'dazed', if: 'hit' }] } })

T.skill(m('field_surgery'), '戰地手術', 4, 'front', 'active', 2, 4, m('line_up'),
  '每場一次，花 3 行動點，修好一名隊友所有破損的構裝槽。', 'approx', 'net.fix 連做 8 次（一次修一個，沒有破損就跳過）；net.fix 沒有「全部」的寫法',
  { use: { net: { ap: 3, per_fight: 1 } }, net: { target: 'near', do: FIX_ALL } })

T.skill(m('not_sleep_yet'), '還不准睡', 4, 'front', 'reaction', 2, 9, m('flash_freeze'),
  '每場一次，隊友在網內倒下時，他一定斷線回到現實，不會被扣線。不花行動點。', 'none', '反應擋得下倒下（out_before），但沒有「讓他拔線退出」的效果（缺：net.jack_out）；擋下之後留在戰鬥裡不是設計書要的',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { pending: true, text: '每場一次，隊友在網內倒下時，他一定斷線回到現實，不會被扣線。不花行動點。' } })

T.skill(m('chief_surgeon'), '主刀', 4, 'back', 'passive', 5, 2.5, m('field_surgery'),
  '相鄰隊友的破損一律算輕的。', 'none', '破損的輕重在 netcombat 的 breakOne 裡（本來就有破損再中一次是重的），沒有修正可以問（現實的 wound_grade 內海不問）',
  { net: { pending: true, text: '相鄰隊友的破損一律算輕的。' } })

T.gap(m('workshop'), '工坊', 4, 'back', 'daily', 2, 0, m('short_circuit'), { use: { slot: 1 }, daily: { text: '組裝義體、武器、護甲時檢定 +2（M4）。' } })

// ================================ 5 階 ================================
T.skill(m('strip_all'), '拆光', 5, 'front', 'active', 3, 10, m('short_circuit'),
  '每場一次，近身的構裝攻擊命中時，目標兩個構裝停用一回合。', 'done', '近戰構裝攻擊 ＋ net.jam 兩次（三種搭配選一種）',
  { use: { net: { ap: 3, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', ...MELEE, picks: JAM_PICK, do: [{ op: 'attack' }], choose: jamTwo } })

T.skill(m('overhaul'), '全面翻修', 5, 'front', 'active', 3, 10, m('field_surgery'),
  '每場一次，花 2 行動點，一名隊友排 8 點感載並消一層餘韻。', 'done', 'vent 8 ＋ afterglow −1',
  { use: { net: { ap: 2, per_fight: 1 } }, net: { target: 'near', do: [{ op: 'vent', amount: 8 }, { op: 'afterglow', amount: -1 }] } })

T.skill(m('extreme_overclock'), '極限超頻', 5, 'front', 'active', 3, 10, m('not_sleep_yet'),
  '每場一次，一名隊友兩回合內每回合多回 1 RAM。', 'none', '沒有「每回合多回 RAM」的修正或效果（缺：修正 ram_regen；buff 只能掛數字修正）',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { pending: true, text: '每場一次，一名隊友兩回合內每回合多回 1 RAM。' } })

T.skill(m('famed_doctor'), '名醫', 5, 'back', 'passive', 6, 3, m('overhaul'),
  '除錯每場可以用兩次。', 'done', '新鍵：修正 use_extra（tags 是技能 id，讓 per_fight 加一次）',
  { net: { mods: [{ kind: 'use_extra', value: 1, tags: [SC] }] } })

T.gap(m('hands_off'), '別碰我', 5, 'back', 'reaction', 3, 6, m('strip_all'), { use: { ap: 1, per_turn: 1 } })

export const MEDIC: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
