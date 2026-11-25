// 槍手：戰鬥直覺（SKILL_TREES 槍手一節的內海欄）。id 和 engine/data/rules/abilities.json 的槍手同一組（sk_gunner_<名字>），cpp-data 之後照這份把 net 欄接上去。
// 內海的槍手：戰鬥直覺只剩命中與迴避、整場不能重分配；瞄準過的攻擊與超頻（連射控制）用武器構裝打，花 RAM；其餘多半每場一次或只在第一回合。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_gunner_instinct', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '每場戰鬥開始時，你的先攻 +3。', effect: { initiative: 3 } },
    { tier: 2, cells: 1, text: '每場戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } },
    { tier: 3, cells: 1, text: '你射擊站在暴露格子上的敵人時，命中 +1。', effect: { mods: [{ kind: 'hit', value: 1, when: { other_exposed: true } }] } },
    { tier: 4, cells: 1, text: '你站在掩體或半掩體的格子上時，迴避 +1。', effect: { mods: [{ kind: 'evade', value: 1, when: { in_cover: true } }] } },
    { tier: 5, cells: 1, text: '戰鬥直覺可以分配的點數 +1。', effect: { mods: [{ kind: 'instinct_points', value: 1 }] } },
  ],
}, 'meat')

const g = (id: string) => `sk_gunner_${id}`
const IN = 'sk_gunner_instinct'

// ---- 超頻（連射控制與火力牆共用）：花掉手上全部的 RAM，每多花 1 點傷害骰多 1 顆，自帶壓制（定力對 10＋花掉的 RAM×2）。淺檔不能用 ----
const OVERCLOCK_ATTACK = (suppress: Record<string, unknown> = {}) => ({ spend: 'all', dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure', ...suppress } })

// ================================ 1 階 ================================
T.skill('sk_gunner_instinct', '戰鬥直覺', 1, 'sig', 'passive', 3, 0, undefined,
  '開戰時隨機分配「階數 ÷ 3（無條件進位）」點，只能分到命中或迴避，整場不能重分配。', 'done', '新鍵：net.instinct { div: 3, only: [hit, evade], fixed }；沒有重分配的行動',
  { net: { instinct: { div: 3, only: ['hit', 'evade'], fixed: true } } })

T.skill(g('aimed_shot'), '要害射擊', 1, 'front', 'active', 1, 1, IN,
  '瞄準再用武器構裝攻擊一次（照常花 RAM）：命中 +3，打出要害時造成破損（CYBERSPACE 6.5 節）。', 'done', '新鍵：use.net.weapon_ram（照常花武器構裝的 RAM）；attack.aimed 的重創在內海由 netcombat 的 wound 掛點變成破損',
  { use: { net: { ap: 3, weapon_ram: true } }, net: { target: 'enemy', attack: { aimed: true } } })

T.skill(g('cover_fire'), '掩護射擊', 1, 'front', 'reaction', 1, 2, IN,
  '每場 1 次：同樣的時機下不開槍，只讓那次攻擊的命中 −1。', 'done', '反應 attacked／adjacent，react.hit −1；use.net.per_fight 1',
  { use: { net: { ap: 2, per_fight: 1 } }, net: { trigger: { on: 'attacked', who: 'adjacent' }, react: { hit: -1 } } })

T.skill(g('burst'), '連射控制', 1, 'front', 'active', 1, 1, IN,
  '你可以超頻：花手上全部的 RAM（至少 2），每多花 1 點傷害骰多 1 顆；自帶壓制（定力對 10＋花掉的 RAM×2）。淺檔不能用。', 'done',
  '標籤 overclock（淺檔灰掉）；use.net.ram_all_min 2；花 RAM 的技能內海欄才能寫 attack.spend: all、dice、suppress（攻擊與效果留到行動做完、知道花了多少才做）。「每多花 1 點」照現實的算法：多（花掉的 RAM − 1）顆',
  { use: { net: { ap: 3, ram_all_min: 2 } }, net: { target: 'enemy', tags: ['overclock'], attack: OVERCLOCK_ATTACK() } })

T.skill(g('watch_me'), '看我的！', 1, 'back', 'active', 1, 3, g('aimed_shot'),
  '第一回合你的第一次攻擊命中 +1。', 'done', '只在第一回合用（use.net.first_round），掛一段 buff：命中 +1、when.first_attack',
  { use: { net: { ap: 1, per_fight: 1, first_round: true } }, net: { target: 'none', do: [buff('watch_me', '看我的！', { mods: [{ kind: 'hit', value: 1, when: { first_attack: true, first_round: true } }] })] } })

T.skill(g('tap'), '點放', 1, 'back', 'passive', 2, 1, g('burst'),
  '每場第一次超頻之後，你回 1 點 RAM。', 'done', '新鍵：trigger.tag（這一擊帶 overclock 標籤）；被動技能掛反應，use.net.per_fight 1，效果 net.ram',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'after', who: 'foe_by_self', tag: 'overclock' }, do: [{ op: 'net.ram', who: 'self', amount: 1 }] } })

// ================================ 2 階 ================================
T.skill(g('point_shot'), '定點射', 2, 'front', 'passive', 3, 2, g('aimed_shot'),
  '每場 1 次，要害射擊只花 2 行動點。', 'done', '修正 action_ap（to 2、tags 是行動 id、per_fight 1）',
  { net: { mods: [{ kind: 'action_ap', to: 2, tags: [g('aimed_shot')], per_fight: 1 }] } })

T.skill(g('suppress_stance'), '壓制姿態', 2, 'front', 'stance', 1, 2, g('cover_fire'),
  '只在第一回合：你第一次攻擊命中的目標得到壓制。', 'done', '新鍵：attack.suppress.first_round（auto 的壓制姿態內海也成立）；per_turn 1',
  { use: { net: { ap: 1 } }, net: { attack: { suppress: { auto: true, per_turn: 1, first_round: true } } } })

T.skill(g('loadout_mastery'), '構裝精通', 2, 'front', 'passive', 3, 1.5, g('burst'),
  '每場 1 次，換構裝不花行動點。', 'done', '修正 action_ap（to 0、tags net_swap、per_fight 1）',
  { net: { mods: [{ kind: 'action_ap', to: 0, tags: ['net_swap'], per_fight: 1 }] } })

T.skill(g('thats_you'), '就是你了', 2, 'back', 'active', 1, 2, g('point_shot'),
  '第一回合可以用：被指定的敵人到你的下一回合開始前，全隊打他命中 +1。', 'done', 'buff 掛在敵人身上：修正 hit_against +1，到我方的下一回合開始（source_turn_start）',
  { use: { net: { ap: 1, first_round: true } }, net: { target: 'enemy', do: [buff('thats_you', '就是你了', { who: 'target', until: 'source_turn_start', mods: [{ kind: 'hit_against', value: 1 }] })] } })

T.skill(g('back_off'), '逼退', 2, 'back', 'active', 1, 2, g('suppress_stance'),
  '每場 1 次，攻擊命中時把目標往後推一格。', 'done', 'attack 加 shift（if hit）；每場一次、照常花 RAM',
  { use: { net: { ap: 2, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', do: [{ op: 'attack' }, { op: 'shift', dir: 'push', n: 1, if: 'hit' }] } })

T.gap(g('gun_care'), '擦槍', 2, 'back', 'prep', 1, 1.5, g('loadout_mastery'), { use: { slot: 1 } })

// ================================ 3 階 ================================
T.skill(g('pierce'), '穿透', 3, 'front', 'active', 2, 3, g('point_shot'),
  '每場 1 次，攻擊時把目標那一格的防火牆節點當成低一級來算。', 'done', 'attack.cover_shift 1',
  { use: { net: { ap: 2, per_fight: 1, weapon_ram: true } }, net: { target: 'enemy', do: [{ op: 'attack', cover_shift: 1 }] } })

T.skill(g('run_and_gun'), '跑位射擊', 3, 'front', 'active', 2, 3, g('suppress_stance'),
  '每場 1 次，換位加攻擊一共只花 2 行動點。', 'done', 'move（相鄰一格）＋ attack；每場一次、照常花 RAM',
  {
    use: { net: { ap: 2, per_fight: 1, weapon_ram: true } },
    net: { target: 'enemy', picks: [{ key: 'slot', label: '換到哪一格', kind: 'ally_slot' }], do: [{ op: 'move', who: 'self', to: 'adjacent' }, { op: 'attack' }] },
  })

T.skill(g('deadline'), '死線', 3, 'front', 'reaction', 2, 7, g('loadout_mastery'),
  '你第一次過載時，閃斷只讓 RAM 減半，不歸零。', 'done', '新鍵：react.flash { ram: half }（overload 掛點的 flash 資訊）；每場一次、不花行動點',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { flash: { ram: 'half' } } } })

T.skill(g('hunter_eye'), '獵眼', 3, 'back', 'passive', 4, 2, g('pierce'),
  '每場第一次瞄準過的攻擊命中再 +1。', 'approx', '修正沒有「每場一次」（per_fight 只給 action_ap、action_ram）：寫成「這一場的第一次攻擊、而且是瞄準過的」命中 +1（when.first_attack、tags aimed）',
  { net: { mods: [{ kind: 'hit', value: 1, tags: ['aimed'], when: { first_attack: true } }] } })

T.skill(g('covering_retreat'), '掩護撤退', 3, 'back', 'active', 2, 3, g('run_and_gun'),
  '每場 1 次，讓一名相鄰的隊友換位不花行動點。', 'done', 'move 落在選的隊友身上；每場一次',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: {
      target: 'none', picks: [{ key: 'mate', label: '讓誰換位', kind: 'ally', adjacent: true }, { key: 'slot', label: '換到哪一格', kind: 'ally_slot' }],
      do: [{ op: 'move', who: 'pick:mate', to: 'adjacent' }],
    },
  })

// ================================ 4 階 ================================
T.skill(g('kill_rhythm'), '獵殺節奏', 4, 'front', 'passive', 5, 2.5, g('hunter_eye'),
  '你打出要害時回 1 點 RAM，每場最多 2 次。', 'done', '被動掛反應：after／crit，use.net.per_fight 2，效果 net.ram',
  { use: { net: { ap: 0, per_fight: 2 } }, net: { trigger: { on: 'after', who: 'foe_by_self', if: 'crit' }, do: [{ op: 'net.ram', who: 'self', amount: 1 }] } })

T.skill(g('barrage'), '彈幕', 4, 'front', 'stance', 2, 3, g('run_and_gun'),
  '你超頻自帶的壓制，定力檢定的 DC +1。', 'done', 'alter 連射控制的 attack.suppress.dc_bonus（姿態開著時）',
  { use: { net: { ap: 1 } }, net: { alter: [{ ability: g('burst'), when: { stance: g('barrage') }, set: { 'attack.suppress.dc_bonus': 1 } }, { ability: g('fire_wall'), when: { stance: g('barrage') }, set: { 'attack.suppress.dc_bonus': 1 } }] } })

T.skill(g('flow'), '心流', 4, 'front', 'active', 2, 8, g('deadline'),
  '從這一回合起連續三個回合，戰鬥直覺在網內的點數 +1。', 'done', 'buff 三回合：修正 instinct_points +1；整場不能重分配，多的一點照種子隨機放進還沒到上限的項（命中或迴避）',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { target: 'none', do: [buff('flow', '心流', { turns: 3, mods: [{ kind: 'instinct_points', value: 1 }] })] } })

T.skill(g('next_one'), '下一個！', 4, 'back', 'active', 2, 4, g('kill_rhythm'),
  '每場 1 次：攻擊讓目標倒下時，立刻再攻擊另一個敵人一次，不花行動點（照常花 RAM）。', 'done', 'attack；if downed 再扣一次 RAM（net.ram −1，武器預設 1）、再 attack 選的另一個敵人',
  {
    use: { net: { ap: 2, per_fight: 1, weapon_ram: true } },
    net: {
      target: 'enemy', picks: [{ key: 'next', label: '倒下之後再打誰', kind: 'foe', apart: true, required: false }],
      do: [{ op: 'attack' }, { op: 'net.ram', who: 'self', amount: -1, if: 'downed' }, { op: 'attack', who: 'pick:next', if: 'downed' }],
    },
  })

T.gap(g('dont_move'), '不准動', 4, 'back', 'active', 2, 4, g('barrage'), { use: { ap: 1 } })

// ================================ 5 階 ================================
T.gap(g('one_shot'), '一槍定局', 5, 'front', 'active', 3, 10, g('kill_rhythm'), { use: { ap: 3, per_fight: 1 } })

T.skill(g('fire_wall'), '火力牆', 5, 'front', 'active', 3, 10, g('barrage'),
  '每場 1 次：超頻自帶的壓制同時打到目標和他相鄰的一格。', 'done', '和連射控制同一個超頻，壓制 area: adjacent；每場一次',
  { use: { net: { ap: 3, per_fight: 1, ram_all_min: 2 } }, net: { target: 'enemy', tags: ['overclock'], attack: OVERCLOCK_ATTACK({ area: 'adjacent' }) } })

T.skill(g('bullet_time'), '子彈時間', 5, 'front', 'active', 3, 10, g('flow'),
  '你的下一回合，回復的行動點 +1。', 'done', 'buff：修正 ap_regen +1，到他的下一回合結束',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { target: 'none', do: [buff('bullet_time', '子彈時間', { mods: [{ kind: 'ap_regen', value: 1 }] })] } })

T.skill(g('gun_unity'), '人槍合一', 5, 'back', 'passive', 6, 3, g('one_shot'),
  '你的攻擊命中 +1。', 'done', '修正 hit +1',
  { net: { mods: [{ kind: 'hit', value: 1 }] } })

T.skill(g('right_back'), '原樣奉還', 5, 'back', 'reaction', 3, 6, g('fire_wall'),
  '每場 1 次：同樣的時機下，花 1 行動點與照常的 RAM 朝那個敵人攻擊一次。', 'done', '反應 after／near／miss（沒打中自己或相鄰的隊友），效果 attack 落在攻擊的人；每場一次、照常花 RAM',
  {
    use: { net: { ap: 1, per_fight: 1, weapon_ram: true } },
    net: { trigger: { on: 'after', who: 'near', if: 'miss' }, do: [{ op: 'attack', who: 'attacker' }] },
  })

export const GUNNER: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
