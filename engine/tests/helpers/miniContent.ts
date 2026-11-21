// 功能的驗收測試共用的一小包內容：不靠 engine/data 的完整資料，功能的測試才不會跟著資料的增減壞掉。
// 格式照 src/core/content/kinds.ts；數字照 CHARACTER 第 1、2、5 節。

import type { ContentPack } from '../../src'

export const MINI_PACK: ContentPack = {
  id: 'mini',
  content: {
    attribute: [
      { id: 'body', name: '體格', desc: '生命值、近戰與重裝。' },
      { id: 'reflex', name: '反應', desc: '槍械命中、迴避、先攻。' },
      { id: 'tech', name: '技術', desc: '組裝與改裝、醫療。' },
      { id: 'intellect', name: '智識', desc: '竄網、RAM、調查。' },
      { id: 'resolve', name: '意志', desc: '感載上限與消退。' },
      { id: 'charm', name: '魅力', desc: '交涉、誘惑、表演。' },
    ],
    skill: [
      { id: 'streetwise', name: '街頭直覺', attr: 'intellect', desc: '被動察覺。' },
      { id: 'negotiate', name: '交涉', attr: 'charm', desc: '談判、殺價、說服。' },
      { id: 'perform', name: '表演', attr: 'charm', desc: '演戲、偽裝、唱歌、直播。' },
      { id: 'mechanics', name: '機械', attr: 'tech', desc: '組裝與修理、陷阱、開鎖。' },
      { id: 'stealth', name: '隱匿', attr: 'reflex', desc: '潛行、藏東西、扒竊。' },
    ],
    perk: [
      { id: 'smooth_talker', name: '能言善道', category: 'social', cost: 2, flaw: false, desc: '交涉的檢定 +2。', checks: { skills: ['negotiate'], bonus: 2 } },
      { id: 'tough', name: '耐打', category: 'body', cost: 2, flaw: false, desc: '生命值上限 +5。', stats: { max_hp: 5 } },
      { id: 'black_market', name: '黑市熟客', category: 'street', cost: 1, flaw: false, desc: '黑市的交易收入多一成五。' },
      { id: 'corp_reader', name: '看得懂合約', category: 'social', cost: 3, flaw: false, desc: '對企業的人的交涉 +2。', checks: { skills: ['negotiate'], tags: ['vs:corp'], bonus: 2 } },
      { id: 'loose_lips', name: '口無遮攔', category: 'social', cost: 2, flaw: true, desc: '交涉的檢定 −2。', checks: { skills: ['negotiate'], bonus: -2 } },
      { id: 'old_wound', name: '舊傷', category: 'body', cost: 2, flaw: true, desc: '生命值上限 −5。', stats: { max_hp: -5 } },
      { id: 'afraid_of_pain', name: '怕痛', category: 'body', cost: 1, flaw: true, desc: '很怕痛。' },
      { id: 'origin_hive', name: '巷子裡的眼睛', category: 'origin', cost: 2, flaw: false, desc: '在蜂巢的街頭直覺 +2。', checks: { skills: ['streetwise'], tags: ['place:hive'], bonus: 2 } },
      { id: 'origin_oldport', name: '黑市的孩子', category: 'origin', cost: 2, flaw: false, desc: '隱匿 +2。', checks: { skills: ['stealth'], bonus: 2 } },
    ],
    origin: [
      { id: 'hive', name: '蜂巢', line: '巨型公寓裡長大的孩子，現在是大人了', skill_bonus: { streetwise: 1 }, status: 'citizen', home: '蜂巢四號塔的單位', favor: { choose_one: ['孤星連', '野良'], value: 25 }, perk: 'origin_hive', roster: ['小麥', '雷'] },
      { id: 'oldport', name: '舊港', line: '碼頭與黑市的人', skill_bonus: { stealth: 1 }, status: 'unregistered', home: '舊港的倉庫隔間', favor: { choose_one: ['胭脂堂'], value: 25 }, perk: 'origin_oldport', roster: ['奈奈', '雷'] },
    ],
    creation_rule: [
      { id: 'default', attr_array: [15, 14, 13, 12, 10, 8], attr_free: 2, attr_max: 18, attr_min: 4, skill_points: 10, skill_max: 3, perk_points: 4, perk_max: 8, flaw_max: 2, min_age: 18, start_money: 1500 },
    ],
  },
}
