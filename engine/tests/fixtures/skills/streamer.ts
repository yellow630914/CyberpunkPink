// 主播：聚光燈（SKILL_TREES 主播一節的內海欄；M3-skill-net-b）。現實欄與輿論欄是 null（媒體型，現實沒有效果）。
// 導流階是衍生數值 flow_tier（abilities 定義，M5 的媒體功能加 provider 之前是 0）。灌流的傷害讀它（net.flow { cap: 3 }：公式的 tier 是導流階）；
// 洗版、圍觀、插播的 when.flow_min 1：沒有頻道（導流階 0）時灰掉，原因「還沒有頻道。」；曝光、灌流、直擊 0 階照用（數字照 0 階算）。
// 共鳴只在內海生效的寫在 resonance.net（媒體型現實沒有效果，resonance.effect 寫了會被擋）。測試規則表要有的狀態：focused、marked、jam_*。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'streamer', name: '主播', tree: '主播：聚光燈', category: 'media', signature: 'sk_streamer_spotlight', domains: { meat: 'none', net: 'mid', opinion: 'strong' },
  resonance: [
    { tier: 1, cells: 1, text: '輿論戰的開場手牌 +1。' },
    { tier: 2, cells: 1, text: '每場內海戰鬥第一次用曝光時，不花 RAM。', net: { mods: [{ kind: 'ram_free', value: 1, tags: ['sk_streamer_expose'], per_fight: 1 }] } },
    { tier: 3, cells: 1, text: '每場輿論戰第一次佔沒人的格子時，那一格的防守當作 1。' },
    { tier: 4, cells: 1, text: '輿論戰每回合抽牌時多抽 1 張，再從手上棄掉 1 張。' },
    { tier: 5, cells: 1, text: '公信力 50 以上，「說法」牌的效果就 +1（原本要 60）。' },
  ],
}, 'media')

const s = (id: string) => `sk_streamer_${id}`
const SP = s('spotlight')
const MARK = { op: 'status', status: 'focused', until: 'source_turn_start' }

// ================================ 1 階 ================================
T.skill(SP, '聚光燈', 1, 'sig', 'passive', 3, 0, undefined,
  '能用本樹的導流技能（曝光、灌流、洗版、圍觀、插播、直擊）。導流階照 MEDIA 4.1 節算：訂閱的位數減 3，公信力 60 以上再 +1，沒有頻道是 0。', 'wait',
  '導流階的數字來源是頻道的訂閱與公信力（M5）：衍生數值 flow_tier 現在是 0，媒體的功能之後加 provider；這一欄只給標籤 flow',
  { net: { tags: ['flow'] } })

T.skill(s('expose'), '曝光', 1, 'front', 'active', 1, 1, SP,
  '標記一個敵人到你的下個回合，全隊打他命中 +1。隱形的敵人被標記之後，也可以被選為目標。', 'approx', '目標掛狀態 focused（命中 +1，到我方下個回合開始）；內海沒有隱形的敵人，後半句沒有東西可寫',
  { use: { net: { ap: 1, ram: 1 } }, net: { target: 'enemy', do: [MARK] } })

T.skill(s('check_it'), '我查查看', 1, 'front', 'active', 1, 1, SP,
  '解除一名隊友身上的標記或干擾。', 'done', 'cleanse：標記（marked、focused）與三種干擾（jam_weapon、jam_defense、jam_tool）',
  {
    use: { net: { ap: 1 } },
    net: { target: 'ally_or_self', do: ['marked', 'focused', 'jam_weapon', 'jam_defense', 'jam_tool'].map((status) => ({ op: 'cleanse', status })) },
  })

T.gap(s('live_link'), '現場連線', 1, 'front', 'active', 1, 3, SP, { use: { ap: 0, per_fight: 1 } })
T.gap(s('edit_paste'), '剪接手', 1, 'back', 'passive', 2, 1, s('expose'))
T.gap(s('hold_back'), '留一手', 1, 'back', 'reaction', 1, 4, s('check_it'), { use: { ap: 0, per_fight: 1 } })
T.gap(s('go_live'), '開台囉～', 1, 'back', 'daily', 1, 1, s('live_link'))

// ================================ 2 階 ================================
T.skill(s('flood'), '灌流', 2, 'front', 'active', 1, 2, s('expose'),
  '用手上的武器構裝攻擊一個化身，傷害加上導流階（最多 +3）。也可以改打一個節點：命中時那個節點被干擾一回合。', 'approx',
  'net.flow { cap: 3 }：attack 的 damage 公式 tier 讀導流階（0 階加 0）；改打節點沒有（攻擊的目標是人，一個技能只有一種目標）',
  { use: { net: { ap: 2, ram: 2 } }, net: { target: 'enemy', flow: { cap: 3 }, do: [{ op: 'attack', damage: 'tier' }] } })

T.gap(s('host'), '主持', 2, 'front', 'stance', 1, 2, s('check_it'), { use: { ap: 1 } })

T.skill(s('spam'), '洗版', 2, 'front', 'active', 1, 2, s('live_link'),
  '用雜訊蓋住隊伍的痕跡，追蹤度 −10。（內海 1 行＋1 RAM，每場 2）', 'done', 'net.trace −10；新條件 when.flow_min 1（沒有頻道灰掉）',
  { use: { net: { ap: 1, ram: 1, per_fight: 2 } }, net: { target: 'none', when: { flow_min: 1 }, do: [{ op: 'net.trace', amount: -10 }] } })

T.gap(s('exclusive'), '獨家', 2, 'back', 'active', 1, 2, s('flood'), { use: { ap: 0 } })

T.skill(s('old_fans'), '老粉都在', 2, 'back', 'passive', 3, 1.5, s('host'),
  '導流階 +1（灌流的上限仍是 +3）。', 'done', '新鍵 net.flow_bonus 1（衍生數值 flow_tier 的 provider）；沒有頻道時也加（M5 要決定沒有頻道算不算）',
  { net: { flow_bonus: 1 } })

// ================================ 3 階 ================================
T.gap(s('scoop_king'), '爆料王', 3, 'front', 'passive', 4, 2, s('exclusive'))
T.gap(s('lead_rhythm'), '帶節奏', 3, 'front', 'stance', 2, 2.5, s('host'), { use: { ap: 1 } })

T.skill(s('bystanders'), '圍觀', 3, 'front', 'active', 2, 6, s('spam'),
  '把這場戰鬥變成全城在看的事，到戰鬥結束為止：企業的蕾絲不能釘住人（粉蕾絲改照白蕾絲的行為），其他敵人的釘住檢定 −4。代價是追蹤度立刻 +10。', 'approx',
  '追蹤度 +10；敵人掛 buff（到戰鬥結束）：釘住的檢定 save −4（tags pin），蕾絲再 −26 近似「不能釘」（自然 20 還是過）；「粉蕾絲改照白蕾絲的行為」沒有',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: {
      target: 'none', when: { flow_min: 1 },
      do: [
        { op: 'net.trace', amount: 10 },
        buff('bystanders', '圍觀', { who: 'foes', until: 'battle_end', mods: [{ kind: 'save', value: -4, tags: ['pin'] }] }),
        { op: 'branch', who: 'foes', needs: { tag: 'lace' }, do: [buff('bystanders_lace', '圍觀（蕾絲）', { who: 'target', until: 'battle_end', mods: [{ kind: 'save', value: -26, tags: ['pin'] }] })] },
      ],
    },
  })

T.gap(s('chase'), '追擊', 3, 'back', 'active', 2, 3, s('bystanders'), { use: { per_turn: 1 } })
T.gap(s('fake_workshop'), '假料工坊', 3, 'back', 'daily', 2, 2, s('scoop_king'))

// ================================ 4 階 ================================
T.gap(s('headline'), '頭條', 4, 'front', 'active', 2, 4, s('chase'), { use: { per_turn: 1 } })
T.gap(s('rebound'), '倒打一耙', 4, 'front', 'reaction', 2, 5, s('lead_rhythm'), { use: { per_turn: 1 } })

T.skill(s('cut_in'), '插播', 4, 'front', 'active', 2, 8, s('bystanders'),
  '敵方整排都被標記到你的下個回合，全隊打他們命中 +1；追蹤度 −5。（內海 2 行＋2 RAM，每場 1）', 'done', '敵方每個人掛 focused；net.trace −5；when.flow_min 1',
  { use: { net: { ap: 2, ram: 2, per_fight: 1 } }, net: { target: 'none', when: { flow_min: 1 }, do: [{ ...MARK, who: 'foes' }, { op: 'net.trace', amount: -5 }] } })

T.gap(s('traffic_code'), '流量密碼', 4, 'back', 'passive', 5, 2.5, s('headline'))

T.skill(s('strike'), '直擊', 4, 'back', 'active', 2, 4, s('cut_in'),
  '用手上的武器構裝攻擊一個被標記的敵人，傷害骰多 1 顆，無視 2 點防護。（內海 2 行＋1 RAM）', 'done', '目標要帶 marked 或 focused；attack dice +1、pierce 2',
  { use: { net: { ap: 2, ram: 1 } }, net: { target: 'enemy', needs: { status: ['marked', 'focused'] }, do: [{ op: 'attack', dice: 1, pierce: 2 }] } })

// ================================ 5 階 ================================
T.gap(s('extra'), '號外', 5, 'front', 'active', 3, 10, s('headline'), { use: { per_fight: 1 } })

T.skill(s('fix_tone'), '定調', 5, 'front', 'active', 3, 10, s('rebound'),
  '這一回合全隊用灌流、曝光、直擊不花 RAM。（內海 2 行，每場 1）', 'done', '全隊掛 buff（到我方下個回合開始）：新修正 ram_free（花掉的 RAM 做完退回來）',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: {
      target: 'none',
      do: [buff('fix_tone', '定調', { who: 'allies', until: 'source_turn_start', mods: [{ kind: 'ram_free', value: 1, tags_any: [s('flood'), s('expose'), s('strike')] }] })],
    },
  })

T.gap(s('network_broadcast'), '全網聯播', 5, 'front', 'active', 3, 10, s('cut_in'), { use: { per_fight: 1 } })
T.gap(s('number_one'), '今天也第一名', 5, 'back', 'passive', 6, 3, s('extra'))

T.skill(s('cant_stop'), '還不能下播', 5, 'back', 'reaction', 3, 11, s('fix_tone'),
  '你過載時不閃斷：RAM 不歸零，反而回滿。（每場 1）', 'done', '反應 overload／self：react.flash { ram: full, end }',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { flash: { ram: 'full', end: true } } } })

export const STREAMER: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
