import type { Face } from '../lib/commission'
import { STAGES as BLUEWHALE_STAGES, START_UNKNOWNS as BLUEWHALE_UNKNOWNS, BRIEFS, OFFERS, type Branch, type Brief, type Offer, type Stage, type Unknown } from './commission'

/**
 * 委託的模板（COMMISSION_TEMPLATES 的「十九種類型的模板」，第四版從裡面挑七種做成可以從頭玩到尾的資料）：
 * 竊密（藍鯨的帳本，中型四階段）、暗殺、蜜罐、救援、網內打撈、滅火、破壞（小型：第 1、2、★ 三階段）。
 * 每一型：簡報、未知清單（踩點揭開）、階段（面、分支、給的連動、檢定或連到哪個畫面）、直播目標。
 * 連動的效果在 lib/commission.ts 的 LINKS 與 linkMods()。
 */
export interface Template {
  id: string; ct: string
  offer: Offer
  brief: Brief
  unknowns: Unknown[]
  stages: Stage[]
  /** 這一型的直播目標（加上共用的，COMMISSION_TEMPLATES「直播目標的共用清單」） */
  goals: string[]
  /** 委託人同不同意直播（不同意時開播算違反不准曝光） */
  liveOk: boolean
  /** 簡報上的委託地點 */
  site: string
}

const u = (id: string, cat: string, text: string, by: string[], stage?: number): Unknown & { stage?: number } => ({ id, cat, text, by, open: false, ...(stage !== undefined ? { stage } : {}) })
const fight = (id: string, effect: string, extra: Partial<Branch> = {}): Branch => ({ id, tag: '攻', name: '強攻', need: '沒有條件', effect, ...extra })
const check = (id: string, tag: Branch['tag'], name: string, skill: string, gives: string[], effect: string, extra: Partial<Branch> = {}): Branch => ({ id, tag, name, need: `${skill}，標準 DC`, effect, check: { skill }, gives, ...extra })

export const TEMPLATES: Template[] = [
  {
    id: 'bluewhale', ct: 'ct_type_steal_data', offer: OFFERS[0], brief: BRIEFS.bluewhale, unknowns: BLUEWHALE_UNKNOWNS, stages: BLUEWHALE_STAGES,
    goals: ['goal_trace_under_30', 'goal_every_link', 'goal_no_one_down'], liveOk: true, site: '舊港・藍鯨第三倉',
  },
  {
    id: 'assassinate', ct: 'ct_type_assassinate', site: '鏽帶・星旗的試射場',
    offer: { id: 'assassinate', name: '試射場的軍需官', grade: 'II', face: 'm', type: '暗殺', size: '小型・3 階段', cond: '不准留痕跡', reward: 3500, fixer: 'npc_monroe' },
    brief: { target: '星旗的軍需官（開野馬的機師）', place: '鏽帶・星旗的試射場', main: '現實・在最後一場打倒他', cond: '不准留痕跡', says: '他把一批機甲的零件賣給了不該賣的人，雇主要他從帳上消失。他晚上會親自開那台野馬試射。戰鬥裡沒有人會死，打倒之後的事交給雇主。', spotted: '你注意到雇主給的照片是去年的，他最近換了護衛。' },
    unknowns: [u('a_route', '路', '他每晚走同一條路去試射場，司機會在加油站停一次', ['survey', 'ask'], 0), u('a_guard', '守備', '試射場有兩個警衛，其中一個有夜視', ['survey', 'hack'], 1), u('a_mech', '敵人', '他會在第二回合開機甲：野馬，機體 33', ['ask', 'insider'], 2)],
    goals: ['goal_decisive_fast', 'goal_two_crits'], liveOk: false,
    stages: [
      { id: 'a1', name: '找到他', faces: ['m', 'n', 'o'], desc: { m: '跟蹤他的車，或問他的司機。', n: '讀他的行程與私人保全網。', o: '放出一個他非去不可的場合（短的輿論戰）。' },
        branches: {
          m: [check('a1m', '潛', '跟蹤他的車', '隱匿', ['located'], '拿到「定位目標」'), fight('a1mf', '警戒 +15・遭遇：滑道底的拾荒者', { gives: ['located'] })],
          n: [{ id: 'a1n', tag: '潛', name: '讀他的行程', need: '內海戰鬥', effect: '追蹤度 +6・拿到「定位目標」與「關掉監視器」', gives: ['located', 'cams_off'] }],
          o: [{ id: 'a1o', tag: '談', name: '放出一個場合', need: '短的輿論戰（4 回合）', effect: '照結果給輿論的連動', gives: ['lured_public'] }],
        },
        go: { m: { path: '/combat', query: { enc: 'chute' } }, n: { path: '/netcombat', query: { enc: 'patrol' } }, o: { path: '/opinion', query: { topic: 'scandal', foe: 'pr_1', rounds: '4' } } } },
      { id: 'a2', name: '靠近他', faces: ['m', 'n'], desc: { m: '偽裝成服務生或司機，靠近他身邊。', n: '接管試射場的控制節點。' },
        branches: {
          m: [check('a2m', '談', '偽裝成服務生', '表演', ['close_in'], '拿到「靠近」：決定性階段不必探索'), fight('a2mf', '警戒 +20・遭遇：倉庫的保全', { gives: ['close_in'] })],
          n: [{ id: 'a2n', tag: '連', name: '接管控制節點', need: '內海戰鬥', effect: '拿到「接管控制節點」', gives: ['doors_unlocked'] }],
        },
        go: { m: { path: '/combat', query: { enc: 'warehouse' } }, n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'a3', name: '動手', faces: ['m'], key: true, desc: { m: '他開著野馬出來了。打倒他就算達成，護衛會撤。' },
        branches: { m: [fight('a3m', '首領戰：試射場的野馬')] },
        go: { m: { path: '/combat', query: { enc: 'mech' } } } },
    ],
  },
  {
    id: 'honeypot', ct: 'ct_type_honeypot', site: '櫻町・半夢',
    offer: { id: 'honeypot', name: '三樓的常客', grade: 'II', face: 'm', type: '蜜罐', size: '小型・3 階段', cond: '不准曝光', reward: 3000, fixer: 'npc_monroe' },
    brief: { target: '每週四來半夢的企業主管（成年人）', place: '櫻町・半夢', main: '現實・一場有目的的成人場景，套出他說過的話', cond: '不准曝光', says: '他每週四都在半夢的三樓待到天亮，嘴巴很鬆。雇主要的是他說過的一個倉庫名字。琥珀是那裡的人，她可以幫你，也可以不幫。', spotted: '你注意到雇主說的倉庫，和藍鯨的帳本是同一間。' },
    unknowns: [u('h_seat', '目標', '他固定坐在三樓靠窗那一桌，十一點到', ['ask', 'doll'], 0), u('h_guard', '守備', '他的保鑣會在一點去樓下抽菸', ['survey', 'insider'], 1), u('h_amber', '人', '琥珀知道他的事，她要的是一張離開櫻町的車票', ['ask', 'doll'], 2)],
    goals: ['goal_never_suspected'], liveOk: false,
    stages: [
      { id: 'h1', name: '接近他', faces: ['m', 'o'], desc: { m: '在他常去的地方讓他看見你。', o: '先把你捧高，他才會上鉤（短的輿論戰）。' },
        branches: {
          m: [check('h1m', '談', '讓他看見你', '誘惑', ['noticed'], '拿到「被注意到」'), fight('h1mf', '被他的保鑣盯上：遭遇', { tag: '攻', name: '硬來：擋下他的保鑣', go: { path: '/combat', query: { enc: 'chute' } } })],
          o: [{ id: 'h1o', tag: '談', name: '把你捧高', need: '短的輿論戰（4 回合）', effect: '照結果給輿論的連動；小勝以上給「話題」', gives: ['hyped'] }],
        },
        go: { o: { path: '/opinion', query: { topic: 'idol', foe: 'pr_1', rounds: '4' } } } },
      { id: 'h2', name: '獨處', faces: ['m'], desc: { m: '甩掉保鑣，在房間裡裝好錄影設備。' },
        branches: {
          m: [check('h2m', '潛', '甩掉保鑣', '隱匿', ['rig_ready'], '拿到「設備就位」'), { id: 'h2free', tag: '連', name: '他主動邀你上樓', need: '連動：被注意到', effect: '不擲；拿到「設備就位」', via: 'link', link: 'noticed', gives: ['rig_ready'], free: true }, fight('h2mf', '被識破：遭遇', { gives: ['rig_ready'] })],
        },
        go: { m: { path: '/combat', query: { enc: 'chute' } } } },
      { id: 'h3', name: '取得把柄', faces: ['m'], key: true, desc: { m: '一場有目的的成人場景：讓他說出那個倉庫的名字。目的的進度 40 以上算達成。' },
        branches: { m: [{ id: 'h3m', tag: '談', name: '成人場景：套話', need: '成人場景（內容篩選關掉時改成三次檢定）', effect: '目的 40 以上達成' }] },
        go: { m: { path: '/scene', query: { scene: 'amber', gate: '0' } } } },
    ],
  },
  {
    id: 'rescue', ct: 'ct_type_rescue', site: '舊港・藍鯨第三倉',
    offer: { id: 'rescue', name: '把她從片場帶出來', grade: 'II', face: 'm', type: '救援', size: '小型・3 階段', cond: '要活的', reward: 5200, fixer: 'npc_monroe' },
    brief: { ...BRIEFS.studio, place: '舊港・藍鯨第三倉', target: '被扣在倉庫的新人演員（成年人）' },
    unknowns: [u('r_cell', '路', '她被關在第三倉二樓的會計室', ['survey', 'ask'], 0), u('r_status', '人', '她沒受傷，只是被收走了橋的權限', ['hack', 'insider'], 1), u('r_guard', '守備', '會計手上有合約，活著比較有用', ['ask', 'insider'], 2)],
    goals: ['goal_no_lethal', 'goal_no_one_down'], liveOk: true,
    stages: [
      { id: 'r1', name: '找到人', faces: ['m', 'n'], desc: { m: '問最後見過她的人。', n: '讀倉庫的關押紀錄。' },
        branches: {
          m: [check('r1m', '談', '問最後見過她的人', '街頭直覺', ['cell_found'], '拿到「找到牢房」'), fight('r1mf', '警戒 +15・遭遇：滑道底的拾荒者', { gives: ['cell_found'] })],
          n: [{ id: 'r1n', tag: '潛', name: '讀關押紀錄', need: '內海戰鬥', effect: '拿到「找到牢房」與「知道她的狀況」', gives: ['cell_found', 'captive_status'] }],
        },
        go: { m: { path: '/combat', query: { enc: 'chute' } }, n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'r2', name: '進去', faces: ['m', 'n'], desc: { m: '從後門或通風管進去。', n: '關掉倉庫的門禁。' },
        branches: {
          m: [check('r2m', '潛', '從通風管進去', '運動', ['floor_reached'], '拿到「到達目標樓層」'), { id: 'r2bribe', tag: '談', name: '收買一名看守', need: '交涉，標準 DC', effect: '拿到「說動一個守衛」', check: { skill: '交涉' }, gives: ['guard_turned'] }, fight('r2mf', '警戒 +20・遭遇：倉庫的保全', { gives: ['floor_reached'] })],
          n: [{ id: 'r2n', tag: '連', name: '關掉門禁', need: '內海戰鬥', effect: '拿到「接管控制節點」', gives: ['doors_unlocked'] }],
        },
        go: { m: { path: '/combat', query: { enc: 'warehouse' } }, n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'r3', name: '把人帶出來', faces: ['m'], key: true, desc: { m: '會計與保全守著她。要活的：會計要制伏。' },
        branches: { m: [fight('r3m', '遭遇：要活的')] },
        go: { m: { path: '/combat', query: { enc: 'capture' } } } },
    ],
  },
  {
    id: 'salvage', ct: 'ct_type_salvage', site: '內海・沉船帶',
    offer: { id: 'salvage', name: '沉船帶的舊印記', grade: 'II', face: 'n', type: '網內打撈', size: '小型・3 階段', cond: '東西要完整', reward: 3300, fixer: 'npc_monroe' },
    brief: { target: '大潮崩之前的一個印記', place: '內海・沉船帶', main: '內海・把東西帶出來', cond: '東西要完整', says: '地下層的書店要一個印記，主人十年前死在沉船帶。那裡沒有人在追，但越往下越接不到外面。最後一段要有人守著它下載完。', spotted: '你注意到書店老闆說到印記的主人時停了一下，他們認識。' },
    unknowns: [u('s_chart', '路', '舊的航圖還能用，第二段可以不必探索', ['hack', 'buy'], 0), u('s_wreck', '敵人', '另一艘船的殘骸上有野生的蕾絲', ['hack'], 1)],
    goals: ['goal_no_one_down', 'goal_decisive_fast'], liveOk: true,
    stages: [
      { id: 's1', name: '下潛', faces: ['n'], desc: { n: '沿著舊的連結往下走。沉船帶只有內海，沒有輔助面。' },
        branches: { n: [check('sv1', '潛', '沿著舊的連結走', '介面', ['wreck_charted'], '拿到「航圖」'), fight('sv1f', '遭遇：巡邏的守衛程式', { gives: ['wreck_charted'] })] },
        go: { n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 's2', name: '找到它', faces: ['n'], desc: { n: '聽印記指路，找到它沉在哪裡。' },
        branches: { n: [check('sv2', '談', '聽印記指路', '同步', ['item_found'], '拿到「找到東西」'), fight('sv2f', '遭遇：巡邏的守衛程式', { gives: ['item_found'] })] },
        go: { n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 's3', name: '帶出來', faces: ['n'], key: true, desc: { n: '零守著它下載三回合，守衛程式一波一波來。' },
        branches: { n: [fight('sv3', '守住下載（3 回合）')] },
        go: { n: { path: '/netcombat', query: { enc: 'download' } } } },
    ],
  },
  {
    id: 'firefight', ct: 'ct_type_firefight', site: '櫻町・應援圈',
    offer: { id: 'firefight', name: '偶像社團的那段直播', grade: 'II', face: 'o', type: '滅火', size: '小型・3 階段', cond: '不准曝光', reward: 3100, fixer: 'npc_monroe' },
    brief: { ...BRIEFS.idol, place: '櫻町・應援圈' },
    unknowns: [u('f_who', '人', '拍的人是帶子街的一個狗仔，住在千本通', ['ask', 'survey'], 0), u('f_copy', '目標', '帶子只有一份副本，存在他的雲端', ['hack'], 1), u('f_jess', '對手', '第一手的潔絲在爆料的那一邊', ['ask', 'press'], 2)],
    goals: ['goal_op_major'], liveOk: false,
    stages: [
      { id: 'f1', name: '找出對方手上的料', faces: ['m', 'n'], desc: { m: '找到拍的人。', n: '進他的雲端看他有什麼。' },
        branches: {
          m: [check('f1m', '談', '找到拍的人', '街頭直覺', ['leak_located'], '拿到「找到爆料的人」'), fight('f1mf', '警戒 +15・遭遇：滑道底的拾荒者', { gives: ['leak_located'], go: { path: '/combat', query: { enc: 'chute' } } })],
          n: [{ id: 'f1n', tag: '潛', name: '進他的雲端', need: '內海戰鬥', effect: '拿到「找到爆料的人」與「知道他有哪些料」', gives: ['leak_located', 'leak_contents'] }],
        },
        go: { n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'f2', name: '毀掉它、買下它，或先帶風向', faces: ['m', 'n', 'o'], desc: { m: '毀掉實體的帶子。', n: '刪掉雲端那一份。', o: '先帶風向（短的輿論戰）。' },
        branches: {
          m: [check('f2m', '攻', '毀掉帶子', '機械', ['source_destroyed'], '拿到「源頭毀了」'), fight('f2mf', '警戒 +15・遭遇：滑道底的拾荒者', { gives: ['source_destroyed'], go: { path: '/combat', query: { enc: 'chute' } } }), { id: 'f2buy', tag: '談', name: '買下它', need: '付 1,000', effect: '不擲；拿到「源頭毀了」', free: true, cost: 1000, gives: ['source_destroyed'] }],
          n: [{ id: 'f2n', tag: '攻', name: '刪掉它', need: '內海戰鬥', effect: '拿到「源頭毀了」', gives: ['source_destroyed'] }],
          o: [{ id: 'f2o', tag: '談', name: '先帶風向', need: '短的輿論戰（4 回合）', effect: '照結果給輿論的連動' }],
        },
        go: { n: { path: '/netcombat', query: { enc: 'patrol' } }, o: { path: '/opinion', query: { topic: 'tape_leak', foe: 'pr_1', rounds: '4' } } } },
      { id: 'f3', name: '輿論戰', faces: ['o'], key: true, desc: { o: '完整的六回合，守住：你佔著主流那一排的兩格，潔絲從街頭打上來。' },
        branches: { o: [{ id: 'f3o', tag: '談', name: '守住', need: '輿論戰（6 回合）', effect: '分數比對手高算達成' }] },
        go: { o: { path: '/opinion', query: { topic: 'tape_leak', foe: 'pr_jess' } } } },
    ],
  },
  {
    id: 'sabotage', ct: 'ct_type_sabotage', site: '舊港・藍鯨第三倉',
    offer: { id: 'sabotage', name: '第三倉的走私貨', grade: 'II', face: 'm', type: '破壞', size: '小型・3 階段', cond: '不准傷到旁人', reward: 3400, fixer: 'npc_monroe' },
    brief: { target: '一批走私的機甲零件', place: '舊港・藍鯨第三倉', main: '現實・毀掉那批貨', cond: '不准傷到旁人', says: '那批零件明天一早就要上船。毀掉它，別燒到旁邊的倉。值夜的工程師是無辜的，別動他。', spotted: '你注意到貨櫃上的編號是星旗的。' },
    unknowns: [u('b_weak', '目標', '貨櫃的冷卻管是弱點，打它不必炸藥', ['survey', 'hack'], 0), u('b_night', '守備', '值夜的只有兩個保全和一個工程師', ['survey', 'insider'], 1)],
    goals: ['goal_alert_under_60', 'goal_two_crits'], liveOk: true,
    stages: [
      { id: 'b1', name: '摸清楚', faces: ['m', 'n'], desc: { m: '以送貨為名進去看。', n: '讀倉庫的設計圖與維修紀錄。' },
        branches: {
          m: [check('b1m', '談', '以送貨為名進去看', '表演', ['weak_point'], '拿到「弱點」'), fight('b1mf', '警戒 +15・遭遇：滑道底的拾荒者', { gives: ['weak_point'], go: { path: '/combat', query: { enc: 'chute' } } })],
          n: [{ id: 'b1n', tag: '潛', name: '讀設計圖', need: '內海戰鬥', effect: '拿到「弱點」與「安全系統關了」', gives: ['weak_point', 'safety_off'] }],
        },
        go: { n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'b2', name: '進去', faces: ['m', 'n'], desc: { m: '從卸貨口進去。', n: '關掉倉庫的監視器。' },
        branches: {
          m: [check('b2m', '潛', '偽裝成夜班維修工', '表演', ['floor_reached'], '拿到「到達目標樓層」'), fight('b2mf', '警戒 +20・遭遇：倉庫的保全', { gives: ['floor_reached'] })],
          n: [{ id: 'b2n', tag: '潛', name: '讓監視器播昨晚的畫面', need: '內海戰鬥', effect: '拿到「關掉監視器」', gives: ['cams_off'] }],
        },
        go: { m: { path: '/combat', query: { enc: 'warehouse' } }, n: { path: '/netcombat', query: { enc: 'patrol' } } } },
      { id: 'b3', name: '毀掉它', faces: ['m'], key: true, desc: { m: '貨櫃旁邊有保全。打倒他們，再毀掉貨。' },
        branches: { m: [fight('b3m', '遭遇：倉庫的保全')] },
        go: { m: { path: '/combat', query: { enc: 'warehouse' } } } },
    ],
  },
]
export const templateById = (id: string | null | undefined) => TEMPLATES.find(t => t.id === id) ?? TEMPLATES[0]
/** 一階段的「面」揭開了沒：決定性的一步一定知道；有對應的未知、而且還沒揭開時是「？」 */
export function facesKnownOf(t: Template, i: number, unknowns: Array<Unknown & { stage?: number }>) {
  const s = t.stages[i]
  if (s.key) return true
  if (t.id === 'bluewhale') { const id = ['u_stage1', 'u_stage2', 'u_stage3'][i]; return !!unknowns.find(x => x.id === id)?.open }
  const rel = unknowns.filter(x => x.stage === i)
  return !rel.length || rel.some(x => x.open)
}
export type { Face }
