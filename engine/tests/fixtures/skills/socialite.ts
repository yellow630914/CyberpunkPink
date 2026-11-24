// 名媛：入戲（SKILL_TREES 名媛一節的內海欄；M3-skill-net-b）。id 照 M1b-skill-social 的（sk_socialite_<名字>）。現實欄與輿論欄是 null。
// 內海的名媛：誘惑攻擊是內海版（net.lure：距離 3 以內、傷害 2d6 ＋ mod(魅力)、目標要有人格 needs.persona）、面具是 net.masked（戰鬥結束的報告標 data.masked）。
// 戰鬥外的事（偽裝、被看穿、閘門把你當成誰）沒有可以讀技能的接口，寫不出來。測試規則表要有的狀態：suppressed、drowsy（下回合行動點 −1）。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'socialite', name: '名媛', tree: '名媛：入戲', category: 'social', signature: 'sk_socialite_in_character', domains: { meat: 'weak', net: 'mid', opinion: 'mid' },
  resonance: [
    { tier: 1, cells: 1, text: '誘惑與表演的檢定 +2。', effect: { mods: [{ kind: 'save', value: 2, tags: ['tease'] }] } },
    { tier: 2, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
    { tier: 3, cells: 1, text: '每場戰鬥第一次換位不花行動點（現實與內海）。', effect: { free_move: { per_fight: 1 } } },
    { tier: 4, cells: 1, text: '輿論戰開場的手牌多 1 張。' },
    { tier: 5, cells: 1, text: '誘惑攻擊的命中 +1（現實與內海）。', effect: { mods: [{ kind: 'tease_hit', value: 1 }] } },
  ],
}, 'social')

const s = (id: string) => `sk_socialite_${id}`
const IC = s('in_character')
/** 誘惑攻擊的消耗：2 行、每回合 1 次、同一組（tease）。 */
const TEASE_USE = { net: { ap: 2, per_turn: 1, group: 'tease' } }
const PERSONA_NEED = { persona: true as const }

// ================================ 1 階 ================================
T.skill(IC, '入戲', 1, 'sig', 'passive', 3, 0, undefined,
  '化身戴著面具時，敵對值與豔名不連到本人。誘惑攻擊照用，距離 3 以內，傷害照網內的規則加上魅力的調整值；有人格的蕾絲（粉色的精英與首領）也打得到。誘惑與表演的檢定 +1。', 'approx',
  '新鍵 net.lure（誘惑攻擊的內海版，被動多一個基本行動）、net.masked（面具；戰鬥結束的報告標 data.masked）、needs.persona；「敵對值與豔名不連到本人」要戰鬥結束時「留下痕跡」的變更，這一批沒有來源，只標旗標',
  { net: { masked: true, lure: {}, mods: [{ kind: 'save', value: 1, tags: ['tease'] }] } })

T.skill(s('look_here'), '看這邊♡', 1, 'front', 'active', 1, 1, IC,
  '做一次誘惑攻擊，命中 +1；目標這一回合攻擊過你的話，再 +1。', 'approx', '誘惑攻擊命中 +1；「目標這一回合攻擊過你再 +1」要記「這一回合誰攻擊過我」，沒有',
  { use: TEASE_USE, net: { lure: { hit: 1 } } })

T.skill(s('stand_in'), '替身', 1, 'front', 'reaction', 1, 4, IC,
  '整場任何一回合：你第一次被命中時，這一擊打在誘餌化身上，你不受感載；不能換位。', 'done', '反應 hit／self，react.negate；每場一次；內海欄不寫 then_move（不能換位）',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'hit', who: 'self' }, react: { negate: true } } })

T.gap(s('read_people'), '讀人', 1, 'front', 'prep', 1, 3, IC, { use: { slot: 1 } })

T.skill(s('poke'), '戳戳你', 1, 'back', 'active', 1, 1, s('look_here'),
  '對距離 3 以內一個有橋的化身或蕾絲灌 6 點快感感載，不擲骰。', 'done', 'load 6、type pleasure、exact；每回合 1 次',
  { use: { net: { ap: 1, per_turn: 1 } }, net: { target: 'enemy', range: [1, 3], needs: { bridged: true }, do: [{ op: 'load', amount: 6, type: 'pleasure', exact: true }] } })

T.skill(s('sober'), '我很清醒喔', 1, 'back', 'passive', 2, 1, s('stand_in'),
  '抵抗粉蕾絲的勸降與釘住的檢定 +1。', 'none', '釘住的檢定是釘人的一方擲（pinUnit 的 run.save 沒有 other），被釘的人沒有檢定可以加；粉蕾絲的勸降是效果 net.sync、沒有檢定。要 netcombat 在釘住之前發 check.before',
  { net: { pending: true, text: '抵抗粉蕾絲的勸降與釘住的檢定 +1。（釘住與勸降沒有被擲檢定的一方：缺掛點）' } })

T.skill(s('tell_me'), '跟我說嘛', 1, 'back', 'active', 1, 1, s('read_people'),
  '對距離 3 以內一個化身或有人格的蕾絲擲交涉，難度同左；成功的話它被標記到你的下一回合，加值是 +1。', 'done', '交涉對意志（vs will）；成功掛 buff：hit_against +1，到我方下一回合開始（source_turn_start）',
  {
    use: { net: { ap: 1 } },
    net: {
      target: 'enemy', range: [1, 3], needs: PERSONA_NEED,
      do: [
        { op: 'check', attr: 'charm', skill: 'negotiate', vs: 'will', tags: ['negotiate'], label: '交涉' },
        buff('tell_me', '跟我說嘛', { if: 'ok', who: 'target', until: 'source_turn_start', mods: [{ kind: 'hit_against', value: 1 }] }),
      ],
    },
  })

// ================================ 2 階 ================================
T.skill(s('stay'), '不要走嘛', 2, 'front', 'active', 1, 2, s('look_here'),
  '做一次誘惑攻擊；命中的話，目標被壓制到他下一回合結束（不能換位，攻擊 −2）。', 'done', 'lure.on_ok 加壓制狀態（suppressed）',
  { use: TEASE_USE, net: { lure: { on_ok: [{ op: 'status', status: 'suppressed', until: 'own_turn_end' }] } } })

T.skill(s('disguise'), '偽裝', 2, 'front', 'stance', 1, 2, s('stand_in'),
  '化身冒充一個身分（員工、管理員、某一隻蕾絲）：白蕾絲不拉警報，閘門把你當成那個身分。要看穿你得擲調查，對 10＋你的表演＋入戲的階數。你攻擊之後這個身分就被看穿。', 'none',
  '白蕾絲的警報、閘門把你當成誰、被看穿的調查都在 features/netrun（探索），技能沒有可以讀的姿態接口；這一欄先 pending',
  { use: { net: { ap: 1 } }, net: { pending: true, text: '化身冒充一個身分：白蕾絲不拉警報、閘門把你當成那個身分。（探索中的事，戰鬥裡沒有效果）' } })

T.gap(s('false_identity'), '假身分', 2, 'front', 'active', 1, 2, s('read_people'), { use: { ap: 0 } })
T.gap(s('honey_pot'), '蜜罐', 2, 'back', 'active', 1, 2, s('false_identity'), { use: { ap: 0 } })

T.skill(s('good_actor'), '我演得很像吧', 2, 'back', 'passive', 3, 1.5, s('disguise'),
  '偽裝被看穿的難度 +2；戴著面具時表演 +1。', 'approx', '做了表演 +1（save，tags perform；內海面具整場戴著）；「偽裝被看穿的難度」同偽裝，寫不出來',
  { net: { mods: [{ kind: 'save', value: 1, tags: ['perform'] }] } })

// ================================ 3 階 ================================
T.skill(s('charm_pose'), '媚態', 3, 'front', 'stance', 2, 2.5, s('stay'),
  '開著時，你造成的快感傷害多 1d6。', 'approx', '修正 tease_bonus 1d6（內海欄現在放行 tease_hit、tease_bonus）；只算誘惑攻擊的傷害，戳戳你的 6 點不算',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'tease_bonus', value: '1d6' }] } })

T.skill(s('new_face'), '換臉', 3, 'front', 'active', 2, 3, s('disguise'),
  '換一個身分：你身上的標記與鎖定全部解除；到你的下一回合開始前，敵人不以你為目標，除非你是唯一的目標；這個身分被看穿，效果不跟著失效，照時間跑完。', 'approx',
  '拿掉標記（marked、focused）、掛 buff mask（敵人挑目標時不挑她）到她的下一回合開始；「鎖定」沒有對應的狀態',
  {
    use: { net: { ap: 1, not_first_round: true } },
    net: { target: 'self', do: [{ op: 'unstatus', who: 'self', status: 'marked' }, { op: 'unstatus', who: 'self', status: 'focused' }, { op: 'buff', who: 'self', id: 'new_face', name: '換臉', turns: 1, until: 'own_turn_start', mask: true }] },
  })

T.skill(s('persuade_lace'), '說服蕾絲', 3, 'front', 'active', 2, 6, s('false_identity'),
  '對距離 3 以內一隻有人格的蕾絲擲誘惑或交涉，對 10＋它的等級×2（精英再 +2，首領再 +4，黑蕾絲再 +6）。成功的話它失去下一回合；在戰鬥之外成功，它替你開一道閘門。', 'approx',
  '玩家選誘惑或交涉（choose）；DC 照 base 10、per_grade 2、elite 2、boss 4；黑蕾絲 +6 與戰鬥之外開閘門沒有',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: {
      target: 'enemy', range: [1, 3], needs: { tag: 'persona' },
      picks: [{ key: 'how', label: '用哪一種', kind: 'choice', required: true }],
      choose: [
        { key: 'seduce', label: '誘惑', do: [{ op: 'check', attr: 'charm', skill: 'seduce', vs: { base: 10, per_grade: 2, elite: 2, boss: 4 }, tags: ['persuade'], label: '說服蕾絲' }, { op: 'status', status: 'lose_turn', if: 'ok' }] },
        { key: 'negotiate', label: '交涉', do: [{ op: 'check', attr: 'charm', skill: 'negotiate', vs: { base: 10, per_grade: 2, elite: 2, boss: 4 }, tags: ['persuade'], label: '說服蕾絲' }, { op: 'status', status: 'lose_turn', if: 'ok' }] },
      ],
    },
  })

T.skill(s('swoon'), '銷魂', 3, 'back', 'active', 2, 3, s('charm_pose'),
  '做一次誘惑攻擊，傷害多 1d6；這一下讓目標過載的話，他多疊一層餘韻。', 'done', 'lure.bonus 1d6、on_overload 餘韻 +1',
  { use: TEASE_USE, net: { lure: { bonus: '1d6', on_overload: [{ op: 'afterglow', amount: 1 }] } } })

T.skill(s('second_face'), '第二張臉', 3, 'back', 'passive', 4, 2, s('new_face'),
  '戴著面具時迴避 +1。', 'done', '修正 evade +1（內海面具整場戴著）',
  { net: { mods: [{ kind: 'evade', value: 1 }] } })

// ================================ 4 階 ================================
T.skill(s('dizzy'), '暈乎乎', 4, 'front', 'active', 2, 4, s('swoon'),
  '做一次誘惑攻擊，傷害多 1d6；命中的目標下一回合行動點 −1。', 'done', 'lure.bonus 1d6、on_ok 狀態 drowsy（測試規則表自帶：下個自己的回合開始行動點 −1，一次）',
  { use: TEASE_USE, net: { lure: { bonus: '1d6', on_ok: [{ op: 'status', status: 'drowsy' }] } } })

T.skill(s('deep_in_role'), '入骨', 4, 'front', 'passive', 5, 2.5, s('new_face'),
  '偽裝被看穿的難度 +4；戴著面具時表演、交涉、誘惑的檢定 +2。', 'approx', '做了表演、交涉、誘惑的檢定 +2（save，tags_any）；被看穿的難度寫不出來（同偽裝）',
  { net: { mods: [{ kind: 'save', value: 2, tags_any: ['perform', 'negotiate', 'tease'] }] } })

T.skill(s('stand_in_for'), '頂替', 4, 'front', 'active', 2, 4, s('persuade_lace'),
  '冒充這個子網的管理員：追蹤度 −10；到這場戰鬥結束前，這一層的閘門把你當成管理員，不必破解。被看穿的難度照偽裝。', 'approx', '追蹤度 −10（net.trace）；閘門把你當管理員在 netrun，沒有接口',
  { use: { net: { ap: 2 } }, net: { target: 'none', do: [{ op: 'net.trace', amount: -10 }] } })

T.skill(s('payback'), '欺負人家要賠喔', 4, 'back', 'reaction', 2, 5, s('dizzy'),
  '同左，距離 3 以內。（1 行；現實每場 2 次，內海每回合 1 次）', 'done', '反應 after／self，by 有橋、距離 1～3，效果 tease 落在攻擊的人；每回合 1 次',
  { use: { net: { ap: 1, per_turn: 1 } }, net: { trigger: { on: 'after', who: 'self', by: { needs: { bridged: true }, range: [1, 3] } }, do: [{ op: 'tease', who: 'attacker' }] } })

T.skill(s('thousand_faces'), '千面', 4, 'back', 'prep', 2, 8, s('deep_in_role'),
  '進副本前一個時段，整個副本有效：每一場內海戰鬥，第一次有人想看穿你的偽裝時自動失敗。', 'none', '看穿偽裝的檢定在 netrun（探索），沒有接口；預備只留格式',
  { use: { slot: 1 }, prep: { slot: 1, scope: 'commission', text: '進副本前備好三張面具。' } })

// ================================ 5 階 ================================
T.skill(s('city_fall'), '傾城', 5, 'front', 'active', 3, 10, s('dizzy'),
  '敵方每一個有橋的單位（含蕾絲）受到 2d6＋mod(魅力) 快感傷害，不擲命中。這一場裡被傾城打到過載的敵人，承受層數 −1。', 'approx',
  'damage who foes_bridged（2d6＋mod:charm、pleasure）；「承受層數 −1」要改 layersMax，沒有效果可以叫',
  { use: { net: { ap: 3, per_fight: 1 } }, net: { target: 'none', do: [{ op: 'damage', who: 'foes_bridged', amount: '2d6+mod:charm', type: 'pleasure' }] } })

T.skill(s('curtain_call'), '謝幕', 5, 'front', 'active', 3, 10, s('deep_in_role'),
  '全隊換上假身分：追蹤度 −10；到你的下一回合開始前，敵人攻擊你方任何人命中 −3。', 'done', 'net.trace −10；我方每個人掛 buff：hit_against −3，到我方下一回合開始（source_turn_start）',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: { target: 'none', do: [{ op: 'net.trace', amount: -10 }, buff('curtain_call', '謝幕', { who: 'allies', until: 'source_turn_start', mods: [{ kind: 'hit_against', value: -3 }] })] },
  })

T.skill(s('everyone'), '眾生相', 5, 'front', 'active', 3, 10, s('stand_in_for'),
  '不花行動點與編輯點；每場 1。這場戰鬥裡你的偽裝被看穿時，自動換成下一個身分，最多兩次，不花行動點。每換一次，你身上的標記與干擾全部解除；到你的下一回合開始前，敵人不以你為目標，除非你是他打得到的唯一目標。', 'none',
  '「偽裝被看穿」這件事在戰鬥裡不存在（沒有識破的掛點），寫不出來',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { pending: true, text: '偽裝被看穿時自動換成下一個身分。（戰鬥裡沒有識破這件事）' } })

T.skill(s('silk'), '繞指柔', 5, 'back', 'stance', 3, 3.5, s('city_fall'),
  '開著時，誘惑攻擊每回合可以用 2 次（多一次攻擊）；第二次的傷害少 1d6。', 'approx', '新修正 turn_extra（tags 寫組的名字 tease：每回合次數加 1）；「第二次少 1d6」沒有',
  { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'turn_extra', value: 1, tags: ['tease'] }] } })

T.skill(s('the_real_me'), '這才是真的我', 5, 'back', 'passive', 6, 3, s('curtain_call'),
  '感載上限 +8；偽裝被看穿的那一回合，你過載時不閃斷。', 'approx', 'pool.load max +8；「被看穿那一回合不閃斷」同偽裝，寫不出來',
  { net: { pool: { load: { max: 8 } } } })

export const SOCIALITE: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
