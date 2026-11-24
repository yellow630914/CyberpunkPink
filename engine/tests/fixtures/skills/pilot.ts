// 機師：編隊（SKILL_TREES 機師一節的內海欄）。id 照 M1b-skill-pilot 的（sk_pilot_<名字>）。
// 內海的機師：守衛程式（無人機的網內版，features/summons 的 net_guard_*，不看同步、同時只連得住 1 個加 overlay_cap）與構裝體（機甲的網內版，M6）。
// 守衛程式從哪來是單位的 ext.summons.drones（型號帶 net: true），招牌只給標籤；要構裝體的技能標 pending，等 M6。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'pilot', name: '機師', tree: '機師：編隊', category: 'meat', signature: 'sk_pilot_formation', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '你的無人機耐久 +5。', effect: { mods: [{ kind: 'overlay_hp', value: 5 }] } },
    { tier: 2, cells: 1, text: '你的無人機護甲 +1。', effect: { mods: [{ kind: 'overlay_armor', value: 1 }] } },
    { tier: 3, cells: 1, text: '你的機甲的機體耐久 +5。（要機甲，M6）', effect: { pending: true } },
    { tier: 4, cells: 1, text: '你指揮無人機時，命中 +1。', effect: { mods: [{ kind: 'hit', value: 1, tags: ['drone'] }] } },
    { tier: 5, cells: 1, text: '你的無人機迴避 +1。', effect: { mods: [{ kind: 'overlay_evade', value: 1 }] } },
  ],
}, 'meat')

const p = (id: string) => `sk_pilot_${id}`
const FO = 'sk_pilot_formation'
const HULL = (text: string): Record<string, unknown> => ({ pending: true, text })

const DRONE_PICK = { key: 'drone', label: '放出哪一個', kind: 'drone', required: true }
const AT = { key: 'at', label: '打誰', kind: 'foe', required: false }

// ================================ 1 階 ================================
T.skill(FO, '編隊', 1, 'sig', 'passive', 3, 0, undefined,
  '你能叫出一個守衛程式（不看同步，只有一個），每場能啟動一次構裝體，規則和現實的無人機與機甲相同；指揮守衛程式時沒有階數的命中加值。', 'approx',
  '做了標籤 drone_link（守衛程式本身由 features/summons 的 net_guard_* 與單位的 ext.summons.drones 給，同時 1 個、不看同步）；內海欄沒有階數的命中加值（不寫那一筆修正）；「每場能啟動一次構裝體」等 M6',
  { net: { tags: ['drone_link'] } })

T.skill(p('good_kid'), '乖孩子去吧', 1, 'front', 'active', 1, 3, FO,
  '叫出守衛程式的那一回合，它的第一次動作命中 +1。', 'done', '放出（drone.deploy）＋立刻指揮一次（drone.act，hit +1），一共 1 行動點；每場一次',
  {
    use: { net: { ap: 1, per_fight: 1 } },
    net: { target: 'ally_slot', picks: [AT, DRONE_PICK], do: [{ op: 'drone.deploy', drone: 'drone' }, { op: 'drone.act', which: 'target', at: 'pick:at', hit: 1 }] },
  })

T.skill(p('cover_flight'), '掩護飛行', 1, 'front', 'reaction', 1, 2, FO,
  '每場 1 次：和守衛程式同一格的隊友被攻擊時，那次攻擊的命中 −1。', 'done', '反應 attacked／with_own_overlay，react.hit −1；每場一次',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { trigger: { on: 'attacked', who: 'with_own_overlay' }, react: { hit: -1 } } })

T.gap(p('multitask'), '多工連結', 1, 'front', 'passive', 2, 1, FO)
T.gap(p('one_more'), '再一次嘛', 1, 'back', 'active', 1, 1, p('good_kid'), { use: { ap: 2 } })

T.skill(p('accompany'), '去陪陪他', 1, 'back', 'active', 1, 1, p('cover_flight'),
  '每場 1 次，把守衛程式移到我方任何一格。', 'done', 'drone.move（any）；每場一次',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { target: 'own_overlay', picks: [{ key: 'to', label: '移到哪一格', kind: 'ally_slot', required: true }], do: [{ op: 'drone.move', to: 'to', any: true }] } })

// ================================ 2 階 ================================
T.gap(p('dual_fire'), '雙聯火控', 2, 'front', 'active', 1, 2, p('one_more'), { use: { ap: 2 } })

T.skill(p('escort'), '護航編隊', 2, 'front', 'stance', 1, 2, p('accompany'),
  '只在第一回合：和守衛程式同一格的隊友迴避 +1。', 'approx', '姿態：drone.escort evade +1；開得了的條件是第一回合（use.net.first_round），開了就一直有效（沒有「第二回合起自己關掉」的寫法）',
  { use: { net: { ap: 1, first_round: true } }, net: { do_on: [{ op: 'drone.escort', evade: 1, max: 2 }], do_off: [{ op: 'drone.escort', off: true }] } })

T.skill(p('feedback_buffer'), '回灌緩衝', 2, 'front', 'passive', 3, 1.5, p('multitask'),
  '構裝體受到攻擊時，溢到你身上的感載每次 −2。', 'wait', '要構裝體（M6）', { net: HULL('構裝體受到攻擊時，溢到你身上的感載每次 −2。') })

T.gap(p('quick_repair'), '修修就好', 2, 'back', 'active', 1, 2, p('escort'), { use: { ap: 1 } })

T.skill(p('ram_in'), '撞過去！', 2, 'back', 'active', 1, 2, p('feedback_buffer'),
  '每場 1 次：構裝體狀態下近戰攻擊命中時，把目標往後推一格。', 'wait', '要構裝體（M6）', { use: { net: { ap: 2, per_fight: 1 } }, net: HULL('每場 1 次：構裝體狀態下近戰攻擊命中時，把目標往後推一格。') })

// ================================ 3 階 ================================
T.skill(p('assault'), '突擊姿態', 3, 'front', 'stance', 2, 2.5, p('dual_fire'),
  '構裝體狀態下，你的命中 +1。', 'wait', '要構裝體（M6）', { use: { net: { ap: 1 } }, net: HULL('構裝體狀態下，你的命中 +1。') })

T.skill(p('bastion'), '堡壘姿態', 3, 'front', 'stance', 2, 2.5, p('escort'),
  '構裝體狀態下，它後面那一格的隊友防護 +1。', 'wait', '要構裝體（M6）', { use: { net: { ap: 1 } }, net: HULL('構裝體狀態下，它後面那一格的隊友防護 +1。') })

T.skill(p('sync_dash'), '同步衝刺', 3, 'front', 'active', 2, 6, p('ram_in'),
  '構裝體狀態下，立刻得到 1 點行動點。', 'wait', '要構裝體（M6）', { use: { net: { ap: 0, per_fight: 1 } }, net: HULL('構裝體狀態下，立刻得到 1 點行動點。') })

T.gap(p('saturation'), '飽和攻擊', 3, 'back', 'active', 2, 3, p('assault'), { use: { ap: 2, per_turn: 1 } })

T.skill(p('smoke_cover'), '煙煙罩著你', 3, 'back', 'active', 2, 3, p('bastion'),
  '每場 1 次：守衛程式掛的那一格，防火牆節點升一級，持續 2 回合。', 'approx', 'drone.smoke 2 回合：現實的煙霧是「打不破的半掩體」，防火牆節點「升一級」寫成同一個東西（掛在那一格的半掩體）',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { target: 'own_overlay', do: [{ op: 'drone.smoke', rounds: 2 }] } })

T.skill(p('neural_hardening'), '神經硬化', 3, 'back', 'passive', 4, 2, p('sync_dash'),
  '構裝體狀態下，構裝體的感載上限 +4。', 'wait', '要構裝體（M6）', { net: HULL('構裝體狀態下，構裝體的感載上限 +4。') })

// ================================ 4 階 ================================
T.gap(p('remote_fire'), '遠端火力', 4, 'front', 'active', 2, 8, p('saturation'), { use: { ap: 2, per_fight: 1 } })

T.skill(p('intercept'), '攔截', 4, 'front', 'reaction', 2, 5, p('bastion'),
  '每場 1 次：守衛程式替同一格的隊友挨下一次攻擊。', 'done', '反應 attacked／with_own_overlay，react.redirect overlay（reach 0：同一格）；每場一次',
  { use: { net: { ap: 1, per_fight: 1 } }, net: { trigger: { on: 'attacked', who: 'with_own_overlay' }, react: { redirect: 'overlay', reach: 0 } } })

T.skill(p('resonant_pilot'), '共鳴駕駛', 4, 'front', 'passive', 5, 2.5, p('neural_hardening'),
  '構裝體受到攻擊時，溢出的感載可以分一半給相鄰的一名隊友。', 'wait', '要構裝體（M6）', { net: HULL('構裝體受到攻擊時，溢出的感載可以分一半給相鄰的一名隊友。') })

T.gap(p('precision'), '精準導引', 4, 'back', 'active', 2, 4, p('remote_fire'), { use: { ap: 1 } })
T.gap(p('overhaul'), '整備', 4, 'back', 'prep', 2, 2.5, p('intercept'), { use: { slot: 1 } })

// ================================ 5 階 ================================
T.skill(p('swarm'), '蜂群', 5, 'front', 'active', 3, 10, p('remote_fire'),
  '每場 1 次：多叫出一個守衛程式，持續 2 回合。', 'done', 'drone.deploy 一個臨時的攻擊型（turns 2、不算進上限、被擊落不灌感載）；每場一次',
  { use: { net: { ap: 3, per_fight: 1 } }, net: { target: 'none', do: [{ op: 'drone.deploy', kind: 'attack', turns: 2, over_cap: true, no_backlash: true }] } })

T.skill(p('dome'), '穹頂', 5, 'front', 'active', 3, 10, p('intercept'),
  '每場 1 次：到你的下一回合開始前，我方每一格的迴避 +1。', 'done', 'buff 落在 allies：evade +1，到我的下一回合開始；每場一次',
  { use: { net: { ap: 3, per_fight: 1 } }, net: { target: 'none', do: [buff('dome', '穹頂', { who: 'allies', until: 'source_turn_start', mods: [{ kind: 'evade', value: 1 }] })] } })

T.skill(p('valkyrie'), '女武神', 5, 'front', 'active', 3, 10, p('resonant_pilot'),
  '構裝體狀態下才能用：你的下一回合，回復的行動點 +1。', 'wait', '要構裝體（M6）', { use: { net: { ap: 0, per_fight: 1 } }, net: HULL('構裝體狀態下才能用：你的下一回合，回復的行動點 +1。') })

T.gap(p('defend_kids'), '敢打我家孩子？', 5, 'back', 'reaction', 3, 6, p('swarm'), { use: { ap: 1, per_turn: 1 } })

T.skill(p('man_machine'), '人機一體', 5, 'back', 'passive', 6, 3, p('valkyrie'),
  '構裝體的持續時間 +1 回合。', 'wait', '要構裝體（M6）', { net: HULL('構裝體的持續時間 +1 回合。') })

export const PILOT: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
