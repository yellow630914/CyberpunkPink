import type { Npc } from './types'

/**
 * 舊的假人物（NPC_SYSTEM 第 7、10 節、UI 第 13 節）：只剩舊的假存檔的 `npcs`（契約、頻道、中間人的店還在用）。
 * 名冊、關係、人情已經是引擎的（M2-ui-people）；示意世界包的人在 data/demo/people.ts。所有人都是成年人。
 */
const base = (n: Partial<Npc> & Pick<Npc, 'id' | 'name' | 'district' | 'age' | 'identity'>): Npc => ({
  tags: [], relation: '', affinity: 0, stage: '生', loyalty: 0, lineStage: 1, known: [], memories: [], mood: '平常', ...n,
})

export const MORE_NPCS: Record<string, Npc> = {
  npc_ray: base({ id: 'npc_ray', name: '雷', district: '四十二番街', age: 27, identity: '跑酒吧與賭場的掮客・名冊上的夥伴', group: '夥伴', tags: ['掮客 3', '槍手 2'], relation: '你交情最深的朋友，開場就在名冊上。', affinity: 52, stage: '交心', loyalty: 78, lineStage: 3, favor: 0, want: '把欠賭場的那一筆一次還清，然後離開番街一陣子。', lastJob: '第 11 天・夜櫻的倉庫',
    known: [{ k: '想要', v: '把欠賭場的那一筆一次還清。' }, { k: '秘密', v: '他的人面有一半是從枕邊來的。' }, { k: '傾向', v: '？？？', unknown: true }, { k: '沉溺', v: '24・貪歡之前' }],
    memories: [{ when: '第 11 天・番街下城段・重要', text: '他在倉庫門口替你擋了兩槍，事後只說夾克要你賠。', weight: 3 }] }),
  npc_zero: base({ id: 'npc_zero', name: '零', district: '地下層', age: 24, identity: '牆語者出走的潛網者・名冊上的夥伴', group: '夥伴', faction: '野良', tags: ['潛網者 3', '改造師 1'], relation: '在網裡話很多，在現實幾乎不開口。', affinity: 38, stage: '熟', loyalty: 64, lineStage: 2, favor: 0, want: '找到聖堂裡那個替她焊第一顆增幅器的人。', lastJob: '第 12 天・藍鯨的前台',
    known: [{ k: '想要', v: '找到聖堂裡那個人。' }, { k: '怕', v: '被碰到肩膀。' }, { k: '沉溺', v: '81・溺感' }, { k: '秘密', v: '？？？', unknown: true }],
    memories: [{ when: '第 12 天・藍鯨物流的子網・重要', text: '她在員工層替你擋下一隻白蕾絲，下線後一句話都沒說，把一瓶冷卻劑塞給你。', weight: 3 }] }),
  npc_nana: base({ id: 'npc_nana', name: '奈奈', district: '舊港', age: 23, identity: '胭脂堂的跑腿，代號「九」・名冊上的夥伴', group: '夥伴', faction: '胭脂堂', tags: ['掮客 2', '名媛 1', '槍手 1'], relation: '答應得很快，答應之前已經算好了。', affinity: 29, stage: '熟', loyalty: 71, lineStage: 2, favor: -1, want: '在陸伯退休之前拿到自己的堂口。',
    known: [{ k: '想要', v: '自己的堂口。' }, { k: '人情', v: '你欠她 1' }, { k: '秘密', v: '？？？', unknown: true }] }),
  npc_penny: base({ id: 'npc_penny', name: '潘妮', district: '四十二番街', age: 25, identity: '被開除的實習記者・名冊上的夥伴', group: '夥伴', tags: ['主播 2', '潛網者 1'], relation: '在你的頻道當製作，問題一個接著一個。', affinity: 26, stage: '熟', loyalty: 58, lineStage: 1, want: '讓萬華鏡把那則被撤掉的新聞重新播一次。' }),
  npc_jo: base({ id: 'npc_jo', name: '喬', district: '蜂巢', age: 42, identity: '獨立接委託的退伍兵・名冊上的行者', group: '夥伴', faction: '孤星連（退出）', tags: ['槍手 3', '機師 1'], relation: '話很少，出任務時總是走在最前面。', affinity: 21, stage: '熟', loyalty: 52, lineStage: 1, mood: '被捕了',
    known: [{ k: '現在', v: '昨晚在東側被市警帶走，關在第七分局。' }] }),
  npc_huige: base({ id: 'npc_huige', name: '灰鴿', district: '舊港', age: 31, identity: '拆體客出身的改造師・生成的行者', group: '名冊', faction: '拆體客（退出）', tags: ['改造師 2'], relation: '出場費給得起就來。', affinity: 12, stage: '生', loyalty: 38, lineStage: 1, mood: '在派工' }),
  npc_xiaoqi: base({ id: 'npc_xiaoqi', name: '小契', district: '蜂巢', age: 26, identity: '契約人・你是持約人', group: '名冊', faction: '胭脂堂（債權）', tags: ['名媛 2'], relation: '欠胭脂堂的債，債權轉到你手上。', affinity: 34, stage: '熟', loyalty: 45, lineStage: 1 }),
  npc_monroe: base({ id: 'npc_monroe', name: '夢露', district: '四十二番街', age: 39, identity: '四十二番街的中間人', group: '中間人', tags: ['中間人'], relation: '藍鯨的帳本是她給你的案子。', affinity: 22, stage: '熟', favor: 0 }),
  npc_fengfeng: base({ id: 'npc_fengfeng', name: '縫縫', district: '蜂巢', age: 35, identity: '地下室診所的無照改造師', group: '熟人', tags: ['改造師'], relation: '替你裝過兩件義體，收費公道。', affinity: 27, stage: '熟', favor: 1 }),
}
