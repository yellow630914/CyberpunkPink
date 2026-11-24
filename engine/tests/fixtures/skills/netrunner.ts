// 潛網者：主控（SKILL_TREES 潛網者一節的內海欄）。路數 id 是 netrunner（和 features/hack 的 DEFAULT_TREE、features/netrun 規則表的 master_path 預設對過，一致）；
// 招牌 sk_netrunner_master 是專屬構裝：管理行動的基數是樹階、標籤 admin、構裝槽 +2（佔一個槽）、RAM 上限 +3 回復 +1、回填 +1、管理行動的檢定 +⌈樹階÷2⌉。
// 技能做的管理行動（use.net.admin）：自己做一次檢定（對地圖的 DC：7 + 3 × 等級，和 netcombat 的七個管理行動一樣是 10、13、16、19、22）；
// 追蹤度 +1 寫死在效果裡（netcombat 沒有給技能用的「管理行動的追蹤度」效果：吃不到修正 trace_admin，要靠 cpp-architect 補）。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'netrunner', name: '潛網者', tree: '主控', category: 'net', signature: 'sk_netrunner_master', domains: { meat: 'mid', net: 'strong', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '介面檢定 +2（快駭與管理行動都用介面）。', effect: { mods: [{ kind: 'save', value: 2, tags_any: ['admin', 'hack'] }] } },
    { tier: 2, cells: 1, text: '每場網內戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } },
    { tier: 3, cells: 1, text: 'RAM 上限 +1。', effect: { pool: { ram: { max: 1 } } } },
    { tier: 4, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
    { tier: 5, cells: 1, text: '釘住的檢定 +2。', effect: { mods: [{ kind: 'save', value: 2, tags: ['pin'] }] } },
  ],
}, 'net')

const n = (id: string) => `sk_netrunner_${id}`
const MA = 'sk_netrunner_master'
/** 管理行動的檢定（對地圖的 DC）：7 + 3 × 等級。tags 帶 admin 與那個行動的名字，主控、值機、根權限的檢定加值才吃得到。 */
const ADMIN_CHECK = (name: string, label: string): Rec => ({ op: 'check', attr: 'intellect', skill: 'interface', vs: { base: 7, per_grade: 3 }, tags: ['admin', `admin:${name}`], label, stop: true })
/** 這一個管理行動加的追蹤度（技能做的：寫死 1）。 */
const ADMIN_TRACE: Rec = { op: 'net.trace', amount: 1 }
type Rec = Record<string, unknown>

// ================================ 1 階 ================================
T.skill(MA, '主控', 1, 'sig', 'passive', 3, 0, undefined,
  '管理行動：每回合的次數＝樹階；能用駭入程式；構裝槽 +2；RAM 上限 +3、每回合 RAM 回復 +1；回填回 3 RAM；管理行動的檢定 +⌈樹階÷2⌉。', 'done',
  '專屬構裝（unique：佔一個槽、淺檔不生效）：admin: tier、標籤 admin、slots 2、pool.ram max +3 regen +1、修正 refill +1、save +half_tier_up（tags admin）。「能用駭入程式」由標籤 admin 加甲板給（netcombat 的 programsOf）',
  {
    net: {
      unique: true, admin: 'tier', tags: ['admin'], slots: 2, pool: { ram: { max: 3, regen: 1 } },
      mods: [{ kind: 'refill', value: 1 }, { kind: 'save', value: 'half_tier_up', tags: ['admin'] }],
    },
  })

T.skill(n('break_ice'), '破冰', 1, 'front', 'active', 1, 1, MA,
  '用手上的武器構裝打一次攻擊，這一擊無視 2 點防護；打防火牆節點時遮蔽倍率 ×2。', 'approx', 'attack.pierce 2；遮蔽倍率 ×2 寫成 cover_mult_min 1（武器預設遮蔽倍率 0.5 的兩倍；武器自己是別的倍率時不對）',
  { use: { net: { ap: 2, ram: 2 } }, net: { target: 'enemy', do: [{ op: 'attack', pierce: 2, cover_mult_min: 1 }] } })

T.skill(n('no_peeking'), '偷看是不行的喔', 1, 'front', 'reaction', 1, 2, MA,
  '你被程式、蕾絲或潛網者攻擊時：這一下的感載 −4；對方沒打中的話，你立刻回打一次 1d6＋魅力調整值的感載。', 'approx',
  '新鍵：react.damage（attacked 的傷害加減）寫了「感載 −4」；「沒打中就回打」要同一個反應做兩個時機（attacked 與 after），一個技能只有一個 trigger：沒做',
  { use: { net: { ram: 1, per_turn: 1 } }, net: { trigger: { on: 'attacked', who: 'self' }, react: { damage: -4 } } })

T.skill(n('seize'), '接管', 1, 'front', 'active', 1, 1, MA,
  '接管的管理行動加強：接管來的守衛程式 3 回合是我方的（原本一回合），照守衛程式的規則掛在我方一格，由你花 1 行動點指揮。', 'done',
  '1 次管理行動＋3 RAM；對防火牆的檢定（標籤 admin、admin:seize）＋ hack.takeover turns 3；追蹤度 +1',
  {
    use: { net: { admin: 1, ram: 3 } },
    net: {
      target: 'foe_overlay',
      do: [ADMIN_TRACE, { op: 'check', attr: 'intellect', skill: 'interface', vs: { firewall: true, elite: 2, boss: 4 }, tags: ['admin', 'admin:seize'], label: '接管', stop: true }, { op: 'hack.takeover', turns: 3 }],
    },
  })

T.skill(n('loop'), '迴圈', 1, 'back', 'active', 1, 1, n('break_ice'),
  '持續型的攻擊：目標每回合開始時受 2d6 感載，共 3 回合。', 'done', '快駭（action_tags hack）：hack.check（神經）＋ hack.dot 2d6、3 回合；同一個目標同時只有一個持續型',
  { use: { net: { ap: 2, ram: 3 } }, net: { target: 'enemy', action_tags: ['hack'], do: [{ op: 'hack.check', class: 'neural', stop: true }, { op: 'hack.dot', amount: '2d6', turns: 3 }] } })

T.skill(n('not_home'), '我不在家喔', 1, 'back', 'active', 1, 1, n('no_peeking'),
  '擦痕跡的管理行動加強：追蹤度 −10（原本 −5）。', 'done', '1 次管理行動＋1 RAM；檢定（admin:wipe）成功才 net.trace −10；追蹤度 +1',
  { use: { net: { admin: 1, ram: 1 } }, net: { target: 'none', do: [ADMIN_TRACE, ADMIN_CHECK('wipe', '擦痕跡'), { op: 'net.trace', amount: -10 }] } })

T.skill(n('bandwidth'), '頻寬', 1, 'back', 'passive', 2, 1.5, n('seize'),
  'RAM 上限 +1；構裝槽 +1。', 'done', 'pool.ram max +1、slots 1',
  { net: { pool: { ram: { max: 1 } }, slots: 1 } })

// ================================ 2 階 ================================
T.skill(n('overheat'), '過熱', 2, 'front', 'active', 1, 2, n('loop'),
  '用武器構裝打一次攻擊；命中時另外讓目標一個構裝停用一回合（干擾，由你選類別）。', 'done', 'attack ＋ net.jam（類別是玩家選的 pick.jam：choose 三種，停用的狀態是 jam_weapon／jam_defense／jam_tool）',
  {
    use: { net: { ap: 2, ram: 2 } },
    net: {
      target: 'enemy', picks: [{ key: 'jam', label: '停用哪一類構裝', kind: 'choice', required: true }], do: [{ op: 'attack' }],
      choose: [
        { key: 'weapon', label: '武器構裝', do: [{ op: 'net.jam', if: 'hit' }] },
        { key: 'defense', label: '防護構裝', do: [{ op: 'net.jam', if: 'hit' }] },
        { key: 'tool', label: '工具構裝', do: [{ op: 'net.jam', if: 'hit' }] },
      ],
    },
  })

T.skill(n('silence'), '靜默', 2, 'front', 'stance', 1, 2, n('not_home'),
  '開著時，網內戰鬥每回合加的追蹤度從 +3 改成 +1；管理行動不加追蹤度（檢定失敗照加 +5）。', 'done', '修正 trace_round −2、trace_admin −1（netcombat 問的）',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'trace_round', value: -2 }, { kind: 'trace_admin', value: -1 }] } })

T.skill(n('rewrite_terrain'), '改寫地形', 2, 'front', 'active', 1, 2, n('seize'),
  '造牆或拆牆一次做相鄰的兩格；或斷路持續到對方的下一回合結束。', 'approx',
  '只做了「拆牆一次兩格」：檢定（admin:breach）成功就 cover −1 落在 area（目標那一格加玩家選的另一格）。「造牆」要目標是我方的一格（技能的目標一次只有一種）、「斷路」沒有效果可以叫（缺 net.cut）',
  {
    use: { net: { admin: 1, ram: 2 } },
    net: {
      target: 'enemy_slot', picks: [{ key: 'also', label: '另一格（同時拆）', kind: 'foe_slot', required: false }],
      do: [ADMIN_TRACE, ADMIN_CHECK('breach', '拆牆'), { op: 'cover', who: 'area', levels: -1 }],
    },
  })

T.skill(n('stare'), '盯～', 2, 'back', 'passive', 3, 1.5, n('overheat'),
  '武器構裝與神經快駭的命中 +1；目標正在閃斷時，再 +1。', 'done', '修正 hit +1；when.other_status flash 再 +1',
  { net: { mods: [{ kind: 'hit', value: 1 }, { kind: 'hit', value: 1, when: { other_status: 'flash' } }] } })

T.skill(n('backflow'), '逆流', 2, 'back', 'reaction', 1, 5, n('silence'),
  '你過載時不閃斷，RAM 反而回滿。不花行動點。', 'done', 'react.flash { ram: full, end }；每場一次',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { flash: { ram: 'full', end: true } } } })

// ================================ 3 階 ================================
T.skill(n('inject'), '灌頂', 3, 'front', 'active', 2, 3, n('overheat'),
  '一次攻擊造成 4d6 感載；目標這一回合已經過載過的話，再 +1d6。', 'approx', '快駭：hack.check（神經）＋ load 4d6；「這一回合已經過載」寫成「現在帶著閃斷」（branch needs.status flash，過載之後才有）',
  {
    use: { net: { ap: 2, ram: 4 } },
    net: { target: 'enemy', action_tags: ['hack'], do: [{ op: 'hack.check', class: 'neural', stop: true }, { op: 'load', amount: '4d6' }, { op: 'branch', needs: { status: 'flash' }, do: [{ op: 'load', amount: '1d6' }] }] },
  })

T.gap(n('backdoor'), '後門', 3, 'front', 'prep', 2, 3, n('silence'), {
  use: { slot: 1 }, prep: { slot: 1, scope: 'commission', net: { trace_start: -15 } },
})

T.skill(n('lockdown'), '封鎖', 3, 'front', 'active', 2, 6, n('rewrite_terrain'),
  '敵方整排這一回合不能換位、不能補位，而且每一格的遮蔽降一級。', 'approx', '做了「每一格的遮蔽降一級」（cover who: foes −1）；「不能換位、不能補位」要斷路（缺 net.cut）',
  { use: { net: { admin: 1, ram: 4, per_fight: 1 } }, net: { target: 'none', do: [ADMIN_TRACE, ADMIN_CHECK('cut', '封鎖'), { op: 'cover', who: 'foes', levels: -1 }] } })

T.skill(n('thanks'), '謝謝招待', 3, 'back', 'passive', 4, 2, n('inject'),
  '你的攻擊讓目標過載時，你回 2 RAM，每回合一次。', 'done', '被動掛反應：overload／foe_by_self，use.net.per_turn 1，效果 net.ram +2',
  { use: { net: { ap: 0, per_turn: 1 } }, net: { trigger: { on: 'overload', who: 'foe_by_self' }, do: [{ op: 'net.ram', who: 'self', amount: 2 }] } })

T.skill(n('watch_duty'), '值機', 3, 'back', 'stance', 2, 2.5, n('lockdown'),
  '開著時，管理行動的檢定 +2；你造出來的牆（防火牆節點）受到的傷害減半。', 'approx', '做了「管理行動的檢定 +2」（save，tags admin）；「自己造的牆受傷減半」沒有對應的修正（缺：遮蔽耐久的傷害倍率）',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'save', value: 2, tags: ['admin'] }] } })

// ================================ 4 階 ================================
T.skill(n('puppet'), '傀儡', 4, 'front', 'active', 2, 4, n('inject'),
  '有標記的化身或蕾絲，他下一回合的第一次攻擊由你指定目標，可以是他自己的隊友。', 'none', '沒有「指定敵人下一次攻擊的目標」的效果（缺：攻擊目標改寫）；標記（unit.ext.net.marked）也不能當 needs 的條件',
  { use: { net: { ap: 2, ram: 5 } }, net: { pending: true, text: '有標記的化身或蕾絲，他下一回合的第一次攻擊由你指定目標，可以是他自己的隊友。' } })

T.skill(n('wrong_person'), '看錯人囉', 4, 'front', 'active', 2, 4, n('backdoor'),
  '一名隊友（含自己）掛上一層鏡像：他下一次被攻擊時，對方擲兩次命中取低的；那一下沒打中的話，他立刻反擊一次（照他手上的武器構裝，不花行動點與 RAM）。', 'none',
  '沒有「擲兩次取低」的修正或反應（缺：命中的劣勢）；反擊要在被攻擊之後做（attacked 與 after 兩個時機）',
  { use: { net: { ap: 2, ram: 3 } }, net: { pending: true, text: '鏡像：下一次被攻擊時對方擲兩次命中取低的；沒打中就反擊一次。' } })

T.skill(n('multitask'), '多工', 4, 'front', 'passive', 5, 3, n('watch_duty'),
  '管理行動每回合的次數 +1；每回合第一個管理行動的 RAM −1（最低 1）。', 'done', '修正 admin_uses +1、action_ram −1（tags admin、per_turn 1）',
  { net: { mods: [{ kind: 'admin_uses', value: 1 }, { kind: 'action_ram', value: -1, tags: ['admin'], per_turn: 1 }] } })

T.skill(n('broadcast'), '群播', 4, 'back', 'active', 2, 8, n('puppet'),
  '敵方整排的化身與蕾絲，下一回合各少 1 點行動點，並各受 4 點感載。', 'done', 'load 4 落在 foes；buff 落在 foes：修正 ap_regen −1，到他們的回合結束；每場一次',
  { use: { net: { ap: 2, ram: 6, per_fight: 1 } }, net: { target: 'none', action_tags: ['hack'], do: [{ op: 'load', who: 'foes', amount: 4 }, buff('broadcast', '群播', { who: 'foes', mods: [{ kind: 'ap_regen', value: -1 }] })] } })

T.skill(n('not_taking'), '不讓你帶走', 4, 'back', 'reaction', 2, 9, n('wrong_person'),
  '任何一格的隊友即將被釘住時，這次釘住自動失敗，動手的人受到一次 2d6＋魅力調整值的感載反擊。', 'done', '反應 out_before／self_or_ally，react.prevent how pinned；do 對攻擊的人 load；每場一次',
  { use: { net: { ram: 1, per_fight: 1 } }, net: { trigger: { on: 'out_before', who: 'self_or_ally' }, react: { prevent: { how: ['pinned'] } }, do: [{ op: 'load', who: 'attacker', amount: '2d6+mod:charm' }] } })

// ================================ 5 階 ================================
T.skill(n('black_ice'), '黑冰', 5, 'front', 'active', 3, 10, n('puppet'),
  '進攻的終極。一次攻擊，每花 1 點 RAM 擲一顆傷害骰；目標因為這一擊過載的話，他失去下一個回合，而且閃斷持續兩回合。', 'approx',
  '花全部 RAM（至少 5）：傷害骰多（花掉的 RAM − 1）顆（和超頻同一個算法）；「因為這一擊過載」攻擊沒有回報，寫成「這一擊之後帶著閃斷」（branch needs.status flash）',
  {
    use: { net: { ap: 2, ram_all_min: 5, per_fight: 1 } },
    net: {
      target: 'enemy', attack: { spend: 'all', dice: 'spent_minus_1' },
      do: [{ op: 'branch', needs: { status: 'flash' }, do: [{ op: 'status', status: 'lose_turn' }, { op: 'status', status: 'flash', turns: 2 }] }],
    },
  })

T.skill(n('backup'), '備份', 5, 'front', 'active', 3, 10, n('not_taking'),
  '防守的終極。我方整排每人排 8 點感載；到戰鬥結束，我方的人不會被釘住，倒下時也不會被扣線。', 'approx', '做了「每人排 8 點感載」；「不會被釘住、不會被扣線」要整場的保護（缺：免疫釘住與扣線的效果）',
  { use: { net: { admin: 1, ram: 6, per_fight: 1 } }, net: { target: 'none', do: [ADMIN_TRACE, { op: 'vent', who: 'allies', amount: 8 }] } })

T.skill(n('sysadmin'), '管理員', 5, 'front', 'active', 3, 10, n('multitask'),
  '改變規則的終極。接管這一場的地形：敵方整排的遮蔽降成暴露、我方整排的遮蔽升一級，場上所有的守衛程式 2 回合是我方的，追蹤度 −20。', 'done',
  '1 次管理行動＋全部 RAM（至少 6）：cover foes −2、cover allies +1、hack.takeover 落在每一個敵方守衛程式（foe_overlays）、net.trace −20',
  {
    use: { net: { admin: 1, ram_all_min: 6, per_fight: 1 } },
    net: { target: 'none', do: [ADMIN_TRACE, { op: 'cover', who: 'foes', levels: -2 }, { op: 'cover', who: 'allies', levels: 1 }, { op: 'hack.takeover', who: 'foe_overlays', turns: 2 }, { op: 'net.trace', amount: -20 }] },
  })

T.skill(n('root'), '根權限', 5, 'back', 'passive', 6, 3, n('sysadmin'),
  '管理行動的 RAM 一律 −1（最低 1），檢定 +2。', 'done', '修正 action_ram −1、save +2（tags admin）',
  { net: { mods: [{ kind: 'action_ram', value: -1, tags: ['admin'] }, { kind: 'save', value: 2, tags: ['admin'] }] } })

T.skill(n('deep_dive'), '深潛', 5, 'back', 'stance', 3, 3.5, n('black_ice'),
  '開著時，你的同步檔位上限 +1 級（最高「全」），換檔每回合可以兩次（仍然只在自己的回合）。', 'done', '修正 sync_cap +1、sync_shifts +1（netcombat 問的）',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'sync_cap', value: 1 }, { kind: 'sync_shifts', value: 1 }] } })

export const NETRUNNER: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
