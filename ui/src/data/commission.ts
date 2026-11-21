import type { Face, PayMode, JobStats } from '../lib/commission'

/**
 * 委託的假資料（mockups/commission.html、COMMISSION_TEMPLATES 的竊密與滅火）：夢露手上的案子、藍鯨物流的帳本（竊密・中型・四階段）。
 */
export interface Offer { id: string; name: string; grade: string; face: Face | null; type: string; size: string; cond: string; reward: number; need?: string; fixer: string }
export const OFFERS: Offer[] = [
  { id: 'bluewhale', name: '藍鯨物流的帳本', grade: 'II', face: 'n', type: '竊密', size: '中型・4 階段', cond: '不准死人', reward: 6800, fixer: 'monroe' },
  { id: 'studio', name: '把她從片場帶出來', grade: 'II', face: 'm', type: '挖角', size: '小型・3 階段', cond: '要活的', reward: 5200, fixer: 'monroe' },
  { id: 'idol', name: '偶像社團的那段直播', grade: 'I', face: 'o', type: '滅火', size: '小型・3 階段', cond: '不准曝光', reward: 3100, fixer: 'monroe' },
  { id: 'erase', name: '夢露說你還不夠格', grade: 'III', face: null, type: '抹除', size: '？', cond: '？', reward: 0, need: '街頭信譽 50 以上', fixer: 'monroe' },
]

export interface Brief { target: string; place: string; main: string; cond: string; says: string; spotted: string }
export const BRIEFS: Record<string, Brief> = {
  bluewhale: { target: '一份加密的內帳', place: '舊港・第三倉辦公層', main: '內海・下載檔案', cond: '不准死人', says: '藍鯨這陣子帳目亂得很，有人想在他們發現之前先看一眼。東西在第三倉樓上的機房，聽說那間機房沒接外網，你大概得先進樓。別殺人，雇主特別交代過，屍體會讓警察比你先翻到帳本。', spotted: '街頭直覺 17：你注意到一個破綻，雇主說自己是同業，付的訂金卻是緋櫻系的晶片。' },
  studio: { target: '片場的新人（成年的演員）', place: '四十二番街・第七棚', main: '現實・帶人出來', cond: '要活的', says: '她想走，片場不放人。帶她出來，別讓她受傷。片場的保全有一個會計，知道合約放在哪裡，活著比較有用。', spotted: '你注意到片場的保全換班時間和簡報說的不一樣。' },
  idol: { target: '一段流出的直播', place: '櫻町・應援圈', main: '輿論・把話題壓下去', cond: '不准曝光', says: '那段直播已經在帶子街流傳了。第一手的潔絲也接了同一件事，她在爆料的那一邊。', spotted: '你注意到流出的那一段剪得太乾淨，像是有人事先準備好的。' },
}

/** 談判的四格（UI 7.1 節）：value 是現在的數字，floor 是對方大概的底線（滑標上的白線） */
export const DEAL = { reward: { value: 7400, floor: 7400, max: 9000 }, prepay: 0.3, gear: 400, cut: 0.15 }

/** 未知清單（FIXER 第 2 節②） */
export interface Unknown { id: string; cat: string; text: string; by: string[]; open: boolean; fresh?: boolean; /** 揭開哪一個階段的面 */ stage?: number }
export const START_UNKNOWNS: Unknown[] = [
  { id: 'u_stage1', cat: '階段', text: '第一階段可以選：現實、內海、輿論', by: ['survey'], open: true },
  { id: 'u_stage2', cat: '階段', text: '第二階段可以選：現實、內海', by: ['hack'], open: true },
  { id: 'u_lace', cat: '蕾絲', text: '子網三層，粉蕾絲；最底下一層不在網上', by: ['hack'], open: true },
  { id: 'u_stage3', cat: '階段', text: '第三階段是檔案庫：內海、現實', by: ['survey', 'hack'], open: false },
  { id: 'u_guard', cat: '守備', text: '辦公層四個保全，一個小隊長；夜班 2 點換班', by: ['survey', 'hack', 'insider'], open: false },
  { id: 'u_route', cat: '路', text: '貨梯直通機房那一層，鑰匙在保全室', by: ['survey', 'insider'], open: false },
  { id: 'u_client', cat: '雇主', text: '雇主是緋櫻重工的稽核部，不是同業', by: ['ask', 'doll'], open: false },
]
/** 踩點的手段（UI 7.2 節） */
export interface Means { id: string; name: string; bonus: number; skill: string; reveals: string; need?: string; price?: number }
export const MEANS: Means[] = [
  { id: 'survey', name: '實地勘查', bonus: 5, skill: '隱匿或調查', reveals: '路、守備、階段' },
  { id: 'ask', name: '打聽', bonus: 6, skill: '街頭直覺或交涉', reveals: '目標、雇主、詞條' },
  { id: 'hack', name: '淺層駭入', bonus: 3, skill: '介面', reveals: '蕾絲、階段、守備；可以預埋後門' },
  { id: 'insider', name: '收買或色誘內線', bonus: 7, skill: '交涉或誘惑', reveals: '路、守備；成功另多一個入口' },
  { id: 'press', name: '以採訪為名', bonus: 2, skill: '表演', reveals: '目標、詞條' },
  { id: 'doll', name: '進人偶館當班', bonus: 0, skill: '誘惑', reveals: '目標、雇主', need: '要名媛；隊上沒有名媛，可以派名冊的人去' },
  { id: 'buy', name: '買情報', bonus: 0, skill: '不擲骰', reveals: '指定一項，直接揭開', price: 600 },
]

/** 副本的階段（COMMISSION_TEMPLATES 竊密）：每個階段的面、各面的分支、會給的連動，以及「進入這一段」連到哪個畫面 */
export interface Branch {
  id: string; tag: '攻' | '潛' | '談' | '連'; name: string; need: string; effect: string; reason?: string; link?: string; via?: 'link' | 'scout'
  /** 第四版：只有檢定、不開打的分支（基本功對標準 DC，COMMISSION_TEMPLATES「分支檢定的 DC」） */
  check?: { skill: string; shift?: number }
  /** 不擲、直接成功（連動開出來的路、付錢） */
  free?: boolean
  /** 要付的錢（現金） */
  cost?: number
  /** 做完這一面給的連動（lib/commission.ts 的 LINKS） */
  gives?: string[]
  /** 這條路連到的畫面（沒寫用階段的） */
  go?: { path: string; query: Record<string, string> }
}
export interface Stage {
  id: string; name: string; faces: Face[]; key?: boolean; hidden?: boolean
  desc: Partial<Record<Face, string>>
  branches: Partial<Record<Face, Branch[]>>
  /** 進入這一段：連到哪個畫面 */
  go: Partial<Record<Face, { path: string; query: Record<string, string> }>>
}
export const STAGES: Stage[] = [
  {
    id: 's1', name: '拿到入口', faces: ['m', 'n', 'o'],
    desc: { m: '從貨梯上到辦公層，偷一張門禁卡。', n: '進訪客層，借一個員工的登入。', o: '在牆報放一則假的停電公告，讓夜班提早下班。' },
    branches: {
      m: [{ id: 'b1m', tag: '攻', name: '強攻：打倒門口的保全', need: '沒有條件', effect: '警戒 +15・遭遇：倉庫的保全', gives: ['keycard'] }, { id: 'b1m2', tag: '潛', name: '潛行：摸進保全室偷門禁卡', need: '隱匿，標準 DC', effect: '警戒 +5・拿到門禁卡', check: { skill: '隱匿' }, gives: ['keycard'] }],
      n: [{ id: 'b1n', tag: '潛', name: '潛行：混進訪客層', need: '介面 3 以上', effect: '追蹤度 +6・拿到員工憑證', gives: ['staff_cred'] }],
      o: [{ id: 'b1o', tag: '談', name: '放話：停電公告', need: '短的輿論戰（4 回合）', effect: '輿論戰（小）・照結果給輿論的連動；小勝以上再給「假消息調虎離山」', gives: ['decoy_news'] }],
    },
    go: { m: { path: '/combat', query: { enc: 'warehouse' } }, n: { path: '/netcombat', query: { enc: 'patrol' } }, o: { path: '/opinion', query: { topic: 'street', foe: 'pr_1', rounds: '4' } } },
  },
  {
    id: 's2', name: '往下一層', faces: ['m', 'n'],
    desc: { m: '刷卡到機房那一層，找到機房的門。', n: '子網的第二層：員工層到管理層。身體留在第三倉的接入點，奈奈守著。' },
    branches: {
      n: [
        { id: 'b2n1', tag: '攻', name: '強攻：硬破閘門', need: '沒有條件。管理層的守門程式會全部醒來', effect: '追蹤度 +20・遭遇：兩個雜兵＋一個精英' },
        { id: 'b2n2', tag: '潛', name: '潛行：混進排程流量', need: '介面 4 以上；直播中不能選', effect: '追蹤度 +8・不留紀錄' },
        { id: 'b2n3', tag: '談', name: '交涉：買通值班的網管', need: '交涉，或花 800', effect: '追蹤度 +4・遭遇少一個雜兵' },
        { id: 'b2n4', tag: '連', name: '用員工憑證直接登入', need: '連動：員工憑證', effect: '追蹤度 +0・不擲，直接過這一段', via: 'link', link: 'staff_cred', free: true },
      ],
      m: [{ id: 'b2m', tag: '攻', name: '強攻：從樓梯間打上去', need: '沒有條件', effect: '警戒 +20・遭遇：倉庫的保全', gives: ['floor_reached'] }, { id: 'b2mk', tag: '連', name: '刷卡進去', need: '連動：門禁卡', effect: '不擲；拿到「到達目標樓層」', via: 'link', link: 'keycard', free: true, gives: ['floor_reached'] }],
    },
    go: { n: { path: '/subnet', query: {} }, m: { path: '/combat', query: { enc: 'warehouse' } } },
  },
  {
    id: 's3', name: '檔案庫', faces: ['n', 'm'], hidden: true,
    desc: { n: '在檔案庫裡找出真的那一份。', m: '切斷大樓的備援線路。' },
    branches: {
      n: [{ id: 'b3n', tag: '攻', name: '強攻：守衛程式', need: '沒有條件', effect: '追蹤度 +10・遭遇：巡邏的守衛程式' }],
      m: [{ id: 'b3m', tag: '攻', name: '要活的：帶走會計', need: '沒有條件', effect: '遭遇：要活的', gives: ['admin_cred'] }],
    },
    go: { n: { path: '/netcombat', query: { enc: 'patrol' } }, m: { path: '/combat', query: { enc: 'capture' } } },
  },
  {
    id: 's4', name: '下載', faces: ['n'], key: true,
    desc: { n: '核心層的戰鬥：守閘的是女僕長帶著粉蕾絲。打贏，或讓一個人撐完 3 回合的下載。' },
    branches: { n: [{ id: 'b4n', tag: '攻', name: '決定性的一步：核心層', need: '沒有條件', effect: '首領戰（核心層）' }] },
    go: { n: { path: '/netcombat', query: { enc: 'bluewhale' } } },
  },
]
export const LINK_KIND = { 代勞: 'var(--ram)', 減壓: 'var(--ep)', 開路: 'var(--ap)', '→ 輿論': 'var(--sink)', 麻煩: 'var(--warn)', 失敗: 'var(--ink-3)' } as const
export interface LinkGot { kind: keyof typeof LINK_KIND; name: string; from: string; effect: string; /** 第四版：連動的 id（lib/commission.ts 的 LINKS）與用掉了沒 */ id?: string; used?: boolean }

export interface JobState {
  offer: string | null
  step: 'take' | 'scout' | 'call' | 'run' | 'done'
  reward: number
  pay: PayMode
  talks: number
  unknowns: Unknown[]
  scouts: number
  lastScout: string | null
  alarm: number
  party: string[]
  support: Partial<Record<Face, { who: string; skill: number; weight: '強' | '中' | '弱'; how: string } | null>>
  stage: number
  /** 每個階段：選了哪一面、哪一條路、結果 */
  done: Array<{ stage: string; face: Face; branch: string; result: string }>
  face: Face | null
  branch: string | null
  rolled: boolean
  links: LinkGot[]
  pressure: { alert: number; trace: number }
  breathe: boolean
  live: boolean
  /** 進入這一段之後在等戰鬥回來 */
  waiting: boolean
  /** 第四版：副本直播的目標（出發時抽）與整趟的統計（警戒、追蹤度的最高值；沒拿到連動的階段；決定性那一場的結果） */
  goals?: string[]
  stats?: JobStats
}
export const START_JOB: JobState = {
  offer: null, step: 'take', reward: DEAL.reward.value, pay: 'cash', talks: 0,
  unknowns: START_UNKNOWNS, scouts: 2, lastScout: '上一次：淺層駭入　1d20 17 ＋ 介面 3 ＝ 20，對 14，超過 5 以上，揭開兩項：第二階段的面、蕾絲。', alarm: 0,
  party: ['me', 'zero', 'nana'],
  support: { m: { who: '喬', skill: 3, weight: '強', how: '付錢' }, n: null, o: { who: '潘妮', skill: 2, weight: '強', how: '付錢' } },
  stage: 0, done: [], face: null, branch: null, rolled: false, links: [], pressure: { alert: 18, trace: 34 }, breathe: true, live: false, waiting: false,
}
/** 召集的人（名冊的一部分）：出場費、職能、強在哪個面 */
export const CREW: Record<string, { name: string; role: string; strong: string; fee: number; fav?: boolean }> = {
  me: { name: '你', role: '槍手／掮客', strong: '現實', fee: 0 },
  zero: { name: '零', role: '潛網者', strong: '內海・強', fee: 0 },
  nana: { name: '奈奈', role: '掮客', strong: '現實・強', fee: 0 },
  joe: { name: '喬', role: '戰鬥型', strong: '現實・強', fee: 450 },
  penny: { name: '潘妮', role: '記者', strong: '輿論・強', fee: 0, fav: true },
}
