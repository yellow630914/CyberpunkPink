import type { Npc } from './types'

/** 舊的假人物（契約、頻道、中間人的店還在用）。人與關係的畫面已經是引擎的（M2-ui-people），示意世界包的人在 data/demo/people.ts。 */
export const NPCS: Record<string, Npc> = {
  npc_xiaomai: {
    id: 'npc_xiaomai',
    name: '小麥',
    district: '蜂巢',
    age: 22,
    identity: '蜂巢的信差・名冊上的夥伴',
    tags: ['掮客 3', '名媛 2', '元氣', '天然'],
    relation: '同一棟塔裡一起長大的朋友。',
    affinity: 34,
    stage: '熟',
    loyalty: 72,
    lineStage: 2,
    mood: '心情不錯',
    known: [
      { k: '想要', v: '存錢把那隻顏色不對的右耳換掉。' },
      { k: '怕', v: '被關在室內不能動。' },
      { k: '傾向', v: '？？？', unknown: true },
      { k: '秘密', v: '？？？', unknown: true },
      { k: '沉溺', v: '12・清明' },
      { k: '人情', v: '她欠你 1' },
    ],
    memories: [
      { when: '第 9 天・四號塔・重要', text: '她替你把一封不能經過郵局的信送到了九號塔的封鎖線外面。', weight: 3 },
      { when: '第 3 天・天井市場・日常', text: '你們在阿蓮的店門口分一碗麵，她把蛋留給你。', weight: 1 },
    ],
  },
  npc_lian: {
    id: 'npc_lian', name: '阿蓮', district: '蜂巢', age: 37, identity: '蜂巢的中間人・阿蓮雜貨', tags: ['中間人'], relation: '你欠她一筆。', affinity: 41, stage: '交心', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
  npc_hebo: {
    id: 'npc_hebo', name: '何伯', district: '蜂巢', age: 71, identity: '四號塔的樓長', tags: ['樓長'], relation: '每個月來敲門收房租的人。', affinity: 18, stage: '生', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
  npc_laotie: {
    id: 'npc_laotie', name: '老鐵', district: '舊港', age: 52, identity: '槍店「回火」的店主', tags: ['店主'], relation: '賣過你兩把槍。', affinity: 24, stage: '熟', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
}
