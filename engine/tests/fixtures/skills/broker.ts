// 掮客：人面（SKILL_TREES 掮客一節的內海欄；M3-skill-net-b）。路數 id 是 fixer、技能 id 同 engine/data/rules/abilities.json（sk_fixer_<名字>）。現實欄與輿論欄是 null。
// 內海的掮客：指揮每回合最多讓 1 點（net.command）、叫人改成遠端叫名冊上帶 netrunner 路數的人（net.remote_call：快駭一個敵人、補我方一格防火牆、排感載；每場 1 次）。
// 測試規則表要有的狀態：focused（被集火：全隊打他命中 +1，到給的人下個回合開始）、suppressed。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_fixer_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' },
  resonance: [
    { tier: 1, cells: 1, text: '名冊的容量多 1 個人。' },
    { tier: 2, cells: 1, text: '每場戰鬥第一次叫人不花行動點。', effect: { mods: [{ kind: 'action_ap', value: -1, tags_any: ['sk_fixer_face.call', 'sk_fixer_face.remote_call'], per_fight: 1 }] } },
    { tier: 3, cells: 1, text: '和你相鄰的隊友迴避 +1（現實與內海）。', effect: { mods: [{ kind: 'evade', value: 1, who: 'adjacent' }] } },
    { tier: 4, cells: 1, text: '輿論戰開場的手牌多 1 張。' },
    { tier: 5, cells: 1, text: '輔助面與派工的擲骰 +2。' },
  ],
}, 'social')

const f = (id: string) => `sk_fixer_${id}`
const FA = 'sk_fixer_face'
const FACE_MARK = { op: 'status', status: 'focused', until: 'source_turn_start' }
const TALK_VS = { base: 10, per_grade: 2, elite: 2, boss: 4 }

// ================================ 1 階 ================================
T.skill(FA, '人面', 1, 'sig', 'passive', 3, 0, undefined,
  '指揮照用，每回合最多讓 1 點。叫人改成遠端叫名冊上一名潛網者：對一個敵人丟一次快駭（照他的程式），或替我方一格補一級防火牆；每場 1 次。', 'approx',
  '新鍵 net.command { max: 1 }（行動 <id>.command）、net.remote_call（行動 <id>.remote_call；pick runner 只列名冊上帶 netrunner 路數的人）；「照他的程式」寫不出來：他的甲板在名冊的資料裡，這裡用他的路數階數當檢定加值、固定 2d6 感載',
  { net: { command: { max: 1 }, remote_call: { options: ['hack', 'wall'], per_fight: 1, ap: 1, path: 'netrunner' } } })

T.skill(f('focus_fire'), '集火', 1, 'front', 'active', 1, 1, FA,
  '同左，加值是 +1。', 'done', '狀態 focused（命中 +1，到我方下一回合開始）落在目標',
  { use: { net: { ap: 1 } }, net: { target: 'enemy', do: [FACE_MARK] } })

T.skill(f('watch_out'), '小心後面！', 1, 'front', 'reaction', 1, 2, FA,
  '同左，迴避 +2。（1 行，上回合留下的；每回合 1）', 'done', '反應 attacked／ally（新格式），react.evade 2；每回合 1 次',
  { use: { net: { ap: 1, per_turn: 1 } }, net: { trigger: { on: 'attacked', who: 'ally' }, react: { evade: 2 } } })

T.gap(f('prep'), '戰前佈置', 1, 'front', 'prep', 1, 3, FA, { use: { per_fight: 1 } })

T.skill(f('swap'), '換位子', 1, 'back', 'active', 1, 1, f('focus_fire'),
  '讓兩名相鄰的隊友交換位置，不花他們的行動點。', 'done', 'free_move.swap_adjacent_pair',
  { use: { net: { ap: 1 } }, net: { target: 'ally', free_move: { swap_adjacent_pair: true } } })

T.skill(f('im_here'), '有我在', 1, 'back', 'passive', 2, 1, f('watch_out'),
  '和你相鄰的隊友抵抗壓制的定力檢定 +1。', 'done', '修正 save +1、who adjacent、tags resist:suppressed',
  { net: { mods: [{ kind: 'save', value: 1, who: 'adjacent', tags: ['resist:suppressed'] }] } })

T.skill(f('proxy'), '代理', 1, 'back', 'active', 1, 1, f('prep'),
  '三選一。花等級×300 C$ 當場買一份憑證：這一層的一道閘門不必破解。花等級×400 C$ 租一個守衛程式掛在我方一格 3 回合：同一格的隊友迴避 +2。花等級×200 C$ 讓一名隊友回填 RAM，不花他的行動點。', 'approx',
  '做了租守衛程式（近似成我方那一格的人迴避 +2、3 回合的 buff）與回填 RAM（net.ram +3）；買憑證要 netrun 的閘門，沒有接口；三種價錢不同，choose 的選項沒有各自的花費，統一用等級×300',
  {
    use: { net: { ap: 1, cash: 'grade*300' } },
    net: {
      target: 'ally_or_self', picks: [{ key: 'how', label: '買什麼', kind: 'choice', required: true }],
      choose: [
        { key: 'guard', label: '租守衛程式', do: [buff('proxy_guard', '租來的守衛程式', { who: 'target', turns: 3, until: 'source_turn_start', mods: [{ kind: 'evade', value: 2 }] })] },
        { key: 'refill', label: '回填 RAM', do: [{ op: 'net.ram', amount: 3 }] },
      ],
    },
  })

// ================================ 2 階 ================================
T.skill(f('talk_down'), '勸降', 2, 'front', 'active', 1, 2, f('focus_fire'),
  '對一個化身或有人格的蕾絲喊話，難度同左。成功的話它被壓制到它的下一回合結束。', 'done', '交涉對 10＋等級×2（精英 +2、首領 +4）；成功 suppressed',
  {
    use: { net: { ap: 2 } },
    net: { target: 'enemy', needs: { persona: true }, do: [{ op: 'check', attr: 'charm', skill: 'negotiate', vs: TALK_VS, tags: ['negotiate'], label: '勸降' }, { op: 'status', status: 'suppressed', until: 'own_turn_end', if: 'ok' }] },
  })

T.skill(f('block'), '擋', 2, 'front', 'reaction', 1, 3, f('watch_out'),
  '子網的追蹤度跨過 90（定位）時觸發：追蹤度 −10。（1 個小人情，或 1 編；每場 2 次）', 'none', '追蹤度跨過門檻沒有掛點（netcombat 只在自己的 crossings 裡做事、不發事件）：要 netcombat 發「追蹤度跨過門檻」的掛點，或核心的 trace 事件',
  { use: { net: { favor: 'small', per_fight: 2 } }, net: { pending: true, text: '子網的追蹤度跨過 90（定位）時觸發：追蹤度 −10。（缺追蹤度跨過門檻的掛點）' } })

T.gap(f('buy_space'), '買版面', 2, 'front', 'active', 1, 2, f('proxy'), { use: { per_turn: 1 } })
T.gap(f('a_bit_more'), '加碼', 2, 'back', 'active', 1, 2, f('buy_space'), { use: { per_turn: 1 } })

T.skill(f('black_market'), '黑市門路', 2, 'back', 'passive', 3, 1.5, f('buy_space'),
  '代理租來的守衛程式多留 1 回合；代理的價錢 −20%。', 'none', '代理的價錢要花費的修正（現金的百分比修正），沒有這種修正；「多留 1 回合」要 alter 到 buff 的 turns（效果清單裡的數字不能被 alter 指到）',
  { net: { pending: true, text: '代理租來的守衛程式多留 1 回合；代理的價錢 −20%。（缺現金的修正）' } })

// ================================ 3 階 ================================
T.skill(f('bribe'), '收買', 3, 'front', 'active', 2, 6, f('talk_down'),
  '一個守衛程式或一隻雜兵蕾絲失去下一回合。', 'approx', '做了雜兵蕾絲（目標 enemy、needs rank minion、tag lace）；守衛程式要另一種目標（foe_overlay），一個技能只有一種目標',
  { use: { net: { ap: 2, cash: 'grade*500', per_fight: 1 } }, net: { target: 'enemy', needs: { rank: ['minion'], tag: 'lace' }, do: [{ op: 'status', status: 'lose_turn' }] } })

T.skill(f('bail'), '保釋', 3, 'front', 'reaction', 2, 7, f('block'),
  '一名隊友被釘住時觸發：釘子拆掉，他回到戰鬥。', 'done', '反應 out_before／ally，react.prevent how pinned；1 個中人情、每場 1 次',
  { use: { net: { ap: 0, favor: 'mid', per_fight: 1 } }, net: { trigger: { on: 'out_before', who: 'ally' }, react: { prevent: { how: ['pinned'] } } } })

T.gap(f('intel_net'), '情報網', 3, 'front', 'prep', 2, 6, f('black_market'), { use: { per_commission: 1 } })

T.skill(f('hit_him'), '打他打他！', 3, 'back', 'active', 2, 3, f('bribe'),
  '指定一個敵人，到你的下一回合為止：全隊打他命中 +1，傷害多 1d3。', 'done', '目標掛狀態 focused（命中 +1）；我方每個人掛 buff：damage_roll 1d3（對帶 focused 的）',
  {
    use: { net: { ap: 1 } },
    net: {
      target: 'enemy',
      do: [FACE_MARK, buff('hit_him', '打他打他！', { who: 'allies', until: 'source_turn_start', mods: [{ kind: 'damage_roll', value: '1d3', when: { other_status: 'focused' } }] })],
    },
  })

T.skill(f('dispatch_net'), '派工網', 3, 'back', 'passive', 4, 2, f('intel_net'),
  '叫人的每場次數 +1。', 'done', '新修正 remote_uses +1（內海欄擋掉現實的 call_uses）',
  { net: { mods: [{ kind: 'remote_uses', value: 1 }] } })

// ================================ 4 階 ================================
T.skill(f('reinforce'), '增援', 4, 'front', 'active', 2, 8, f('hit_him'),
  '遠端叫進一名名冊上的潛網者，進到我方一個空格，當我方的化身打 3 回合。', 'approx', 'pick bench 加 path: netrunner（只列帶那條路數的人）＋ call_in；「打 3 回合」之後離場沒有（叫進來的人打到戰鬥結束）',
  { use: { net: { ap: 2, per_fight: 1 } }, net: { picks: [{ key: 'bench', label: '叫進哪一位', kind: 'bench', path: 'netrunner' }], do: [{ op: 'call_in' }] } })

T.skill(f('formation'), '布陣', 4, 'front', 'stance', 2, 3, f('bail'),
  '開著時，和你相鄰的隊友迴避 +1。', 'done', '修正 evade +1、who adjacent',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'evade', value: 1, who: 'adjacent' }] } })

T.skill(f('big_picture'), '大局', 4, 'front', 'active', 2, 4, f('intel_net'),
  '把我方兩個人的先攻對調。', 'done', 'order（和選的隊友對調先攻順位）',
  { use: { net: { ap: 1 } }, net: { target: 'ally_or_self', picks: [{ key: 'with', label: '和誰對調', kind: 'ally', apart: true }], do: [{ op: 'order', with: 'with', act_next: true }] } })

T.skill(f('i_know_someone'), '我有認識的人', 4, 'back', 'passive', 5, 2.5, f('formation'),
  '叫人的選項多一種：替一名隊友排 8 點感載。', 'done', 'alter 人面的 remote_call.options 多 vent、remote_call.vent 8',
  { net: { alter: [{ ability: FA, set: { 'remote_call.options': ['hack', 'wall', 'vent'], 'remote_call.vent': 8 } }] } })

T.skill(f('lets_talk'), '有話好好說', 4, 'back', 'active', 2, 4, f('big_picture'),
  '對一個化身或有人格的蕾絲喊話，難度同左。成功的話它被壓制到它的下一回合結束。', 'done', '同勸降（難度 10＋等級×2、精英 +2、首領 +4）',
  {
    use: { net: { ap: 2 } },
    net: { target: 'enemy', needs: { persona: true }, do: [{ op: 'check', attr: 'charm', skill: 'negotiate', vs: TALK_VS, tags: ['negotiate'], label: '有話好好說' }, { op: 'status', status: 'suppressed', until: 'own_turn_end', if: 'ok' }] },
  })

// ================================ 5 階 ================================
T.skill(f('all_out'), '總攻令', 5, 'front', 'active', 3, 10, f('reinforce'),
  '你的每一名隊友拿回 1 點行動點。', 'done', 'ap who others +1', { use: { net: { ap: 2, per_fight: 1 } }, net: { target: 'none', do: [{ op: 'ap', who: 'others', amount: 1 }] } })

T.skill(f('hold_the_line'), '護盤', 5, 'front', 'active', 3, 10, f('formation'),
  '你的每一名隊友排 8 點感載；到你的下一回合開始前，你們過載時不閃斷。', 'done', 'vent who others 8；全隊 buff：新修正 no_flash（過載不閃斷：RAM 補回、閃斷拿掉）',
  {
    use: { net: { ap: 1, per_fight: 1 } },
    net: { target: 'none', do: [{ op: 'vent', who: 'others', amount: 8 }, buff('hold_the_line', '護盤', { who: 'allies', until: 'source_turn_start', mods: [{ kind: 'no_flash', value: 1 }] })] },
  })

T.skill(f('city_owes_me'), '全城欠我', 5, 'front', 'active', 3, 10, f('big_picture'),
  '這一層所有的閘門當成你持有憑證；追蹤度 −15。', 'approx', 'net.trace −15；閘門當成持有憑證在 netrun，沒有接口',
  { use: { net: { ap: 0, favor: 'big', per_commission: 1 } }, net: { target: 'none', do: [{ op: 'net.trace', amount: -15 }] } })

T.skill(f('command'), '號令', 5, 'back', 'stance', 3, 3.5, f('all_out'),
  '開著時，拿到你行動點的隊友這一回合命中 +1。', 'done', 'on_give_ap：buff hit +1（指揮的內海版 .command 會做它）',
  { use: { net: { ap: 1 } }, net: { on_give_ap: [buff('command', '號令', { who: 'target', mods: [{ kind: 'hit', value: 1 }] })] } })

T.skill(f('connections'), '人脈', 5, 'back', 'passive', 6, 3, f('city_owes_me'),
  '叫人的每場次數 +1。', 'done', '修正 remote_uses +1', { net: { mods: [{ kind: 'remote_uses', value: 1 }] } })

export const BROKER: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
