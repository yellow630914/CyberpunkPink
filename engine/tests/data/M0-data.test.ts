// 驗收測試：dev/work/M0-data.md（交給 cpp-data）。
// 工單完成前這個檔會失敗（engine/data/index.ts 還不存在）。跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-data
// 完成後：git mv engine/tests/pending/M0-data.test.ts engine/tests/data/M0-data.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import type { AttributeEntry, CreationRuleEntry, FactionEntry, NpcEntry, OriginEntry, PerkEntry, SkillEntry } from '../../src'
import { ATTR_IDS, MONEY_CAP_BY_GRADE, createKernel } from '../../src'
import { CORE_PACK } from '../../data'

function loaded() {
  const k = createKernel()
  k.content.loadPack(CORE_PACK)
  return k.content
}

/** 十八項基本功：名字 → [id, 屬性]（CORE_RULES 第 2 節的表；id 見工單的對照表） */
const SKILLS: Record<string, [string, string]> = {
  格鬥: ['brawl', 'body'], 運動: ['athletics', 'body'], 重裝: ['heavy', 'body'],
  槍械: ['firearms', 'reflex'], 操縱: ['piloting', 'reflex'], 隱匿: ['stealth', 'reflex'],
  機械: ['mechanics', 'tech'], 義體學: ['cyberware', 'tech'], 醫療: ['medicine', 'tech'],
  介面: ['interface', 'intellect'], 調查: ['investigate', 'intellect'], 街頭直覺: ['streetwise', 'intellect'],
  威嚇: ['intimidate', 'resolve'], 定力: ['composure', 'resolve'], 同步: ['sync', 'resolve'],
  交涉: ['negotiate', 'charm'], 誘惑: ['seduce', 'charm'], 表演: ['perform', 'charm'],
}

describe('M0-data：整包內容載得進去', () => {
  it('格式都對、沒有重複的 id、引用都找得到', () => {
    const content = loaded()
    expect(content.checkRefs()).toEqual([])
  })

  it('包的 id 是 core', () => {
    expect(CORE_PACK.id).toBe('core')
    expect(Object.keys(CORE_PACK.content).sort()).toEqual(expect.arrayContaining(['attribute', 'creation_rule', 'effect_cap', 'origin', 'perk', 'skill']))
  })
})

describe('M0-data：屬性與基本功（CORE_RULES 第 1、2 節；DATA 第 1 節）', () => {
  it('六屬性：id 照 DATA 第 1 節，名字照 CORE_RULES 第 1 節', () => {
    const attrs = loaded().list<AttributeEntry>('attribute')
    expect(attrs.map((a) => a.id)).toEqual([...ATTR_IDS])
    expect(Object.fromEntries(attrs.map((a) => [a.id, a.name]))).toEqual({ body: '體格', reflex: '反應', tech: '技術', intellect: '智識', resolve: '意志', charm: '魅力' })
  })

  it('十八項基本功，每項屬性三項，名字、id 與屬性都對', () => {
    const skills = loaded().list<SkillEntry>('skill')
    expect(skills).toHaveLength(18)
    for (const attr of ATTR_IDS) expect(skills.filter((s) => s.attr === attr), attr).toHaveLength(3)
    expect(Object.fromEntries(skills.map((s) => [s.name, [s.id, s.attr]]))).toEqual(SKILLS)
    for (const s of skills) expect(s.desc.length, s.id).toBeGreaterThan(3)
  })

  it('基本功照 CORE_RULES 第 2 節的表的順序排', () => {
    expect(loaded().list<SkillEntry>('skill').map((s) => s.name)).toEqual(Object.keys(SKILLS))
  })
})

describe('M0-data：出身（CHARACTER 第 2 節）', () => {
  const origins = () => Object.fromEntries(loaded().list<OriginEntry>('origin').map((o) => [o.id, o]))

  it('七個出身，照表的順序', () => {
    expect(loaded().list<OriginEntry>('origin').map((o) => [o.id, o.name])).toEqual([['hive', '蜂巢'], ['corp', '企業'], ['nomad', '車族'], ['pleasure', '歡場'], ['oldport', '舊港'], ['sakura', '櫻町'], ['under', '地下層']])
  })

  it('每個出身給一項基本功 +1', () => {
    const o = origins()
    expect(Object.fromEntries(Object.entries(o).map(([id, x]) => [id, x.skill_bonus]))).toEqual({
      hive: { streetwise: 1 }, corp: { negotiate: 1 }, nomad: { piloting: 1 }, pleasure: { seduce: 1 }, oldport: { stealth: 1 }, sakura: { perform: 1 }, under: { mechanics: 1 },
    })
  })

  it('起始身分：蜂巢、企業、歡場、櫻町是市民；車族、舊港、地下層是無籍', () => {
    const o = origins()
    expect(Object.entries(o).filter(([, x]) => x.status === 'citizen').map(([id]) => id).sort()).toEqual(['corp', 'hive', 'pleasure', 'sakura'])
    expect(Object.entries(o).filter(([, x]) => x.status === 'unregistered').map(([id]) => id).sort()).toEqual(['nomad', 'oldport', 'under'])
  })

  it('好感 25 的勢力：選一的照表列出來（DATA 1.1 節的勢力 id）；企業是十二家選一', () => {
    const o = origins()
    const content = loaded()
    const short = (ids: string[]) => ids.map((id) => content.get<FactionEntry>('faction', id)?.short)
    for (const x of Object.values(o)) expect(x.favor.value, x.id).toBe(25)
    expect(o.hive!.favor.choose_one).toEqual(['lonestar', 'nora'])
    expect(short(o.hive!.favor.choose_one)).toEqual(['孤星連', '野良'])
    expect(o.corp!.favor.choose_one).toHaveLength(12)
    expect(o.corp!.favor.choose_one.every((id) => content.get<FactionEntry>('faction', id)?.class === 'corp')).toBe(true)
    expect(short(o.nomad!.favor.choose_one)).toEqual(['野薔薇'])
    expect(short(o.pleasure!.favor.choose_one)).toEqual(['蜜糖會'])
    expect(short(o.oldport!.favor.choose_one)).toEqual(['胭脂堂'])
    expect(short(o.sakura!.favor.choose_one)).toEqual(['特攻姬', '女僕公會'])
    expect(short(o.under!.favor.choose_one)).toEqual(['野良', '牆語者'])
  })

  it('開場就在名冊上：出身的那一位加上雷（DATA 1.1 節的 NPC id）', () => {
    const o = origins()
    const content = loaded()
    expect(Object.fromEntries(Object.entries(o).map(([id, x]) => [id, x.roster]))).toEqual({
      hive: ['npc_xiaomai', 'npc_ray'], corp: ['npc_penny', 'npc_ray'], nomad: ['npc_mashiro', 'npc_ray'], pleasure: ['npc_amber', 'npc_ray'],
      oldport: ['npc_nana', 'npc_ray'], sakura: ['npc_akari', 'npc_ray'], under: ['npc_zero', 'npc_ray'],
    })
    expect(Object.fromEntries(Object.entries(o).map(([id, x]) => [id, x.roster.map((n) => content.get<NpcEntry>('npc', n)?.name)]))).toEqual({
      hive: ['小麥', '雷'], corp: ['潘妮', '雷'], nomad: ['真白', '雷'], pleasure: ['琥珀', '雷'], oldport: ['奈奈', '雷'], sakura: ['燈', '雷'], under: ['零', '雷'],
    })
  })

  it('id 表（DATA 1.1 節）：勢力二十九個（企業十二、街頭十五、公家二）；具名 NPC 與流竄 AI 的 id 都以 npc_ 開頭、不重複', () => {
    const content = loaded()
    const factions = content.list<FactionEntry>('faction')
    expect(factions).toHaveLength(29)
    expect(factions.filter((f) => f.class === 'corp')).toHaveLength(12)
    expect(factions.filter((f) => f.class === 'street')).toHaveLength(15)
    expect(factions.filter((f) => f.class === 'public').map((f) => f.id).sort()).toEqual(['police', 'suppress'])
    expect(content.get<FactionEntry>('faction', 'hizakura')).toMatchObject({ name: '緋櫻重工', short: '緋櫻' })
    const npcs = content.list<NpcEntry>('npc')
    expect(npcs.every((n) => n.id.startsWith('npc_'))).toBe(true)
    expect(new Set(npcs.map((n) => n.id)).size).toBe(npcs.length)
    expect(npcs.filter((n) => n.rogue_ai === true)).toHaveLength(42)
    expect(content.get<NpcEntry>('npc', 'npc_lian')?.name).toBe('阿蓮')
    expect(content.get<NpcEntry>('npc', 'npc_jo')?.name).toBe('喬')
    expect(content.get<NpcEntry>('npc', 'npc_hearthside')?.name).toBe('媽咪')
  })

  it('每個出身有一個出身特質，id 是 origin_<出身>，分類是 origin', () => {
    const content = loaded()
    for (const o of content.list<OriginEntry>('origin')) {
      expect(o.perk).toBe(`origin_${o.id}`)
      expect(content.require<PerkEntry>('perk', o.perk).category).toBe('origin')
    }
  })
})

describe('M0-data：特質（CHARACTER 第 4、5.2、5.3、6 節）', () => {
  it('設計書的樣本「能言善道」照原樣：交涉 +2，不是缺陷', () => {
    const p = loaded().require<PerkEntry>('perk', 'smooth_talker')
    expect(p).toMatchObject({ name: '能言善道', category: 'social', cost: 2, flaw: false, checks: { skills: ['negotiate'], bonus: 2 } })
    expect(p.provisional).toBeUndefined()
  })

  it('設計書沒有的清單先借介面的示意資料：每一筆都標 provisional', () => {
    const perks = loaded().list<PerkEntry>('perk')
    const borrowed = perks.filter((p) => p.id !== 'smooth_talker')
    expect(borrowed.length).toBeGreaterThanOrEqual(7 + 15 + 6 - 1)
    for (const p of borrowed) expect(p.provisional, p.id).toBe(true)
  })

  it('價錢 1～3；缺陷只有壞處、特質只有好處；一格的份量照 5.2 節的表', () => {
    const perks = loaded().list<PerkEntry>('perk')
    expect(perks.filter((p) => p.flaw).length).toBeGreaterThanOrEqual(6)
    for (const p of perks) {
      expect(p.cost, p.id).toBeGreaterThanOrEqual(1)
      expect(p.cost, p.id).toBeLessThanOrEqual(3)
      if (p.checks) expect(Math.sign(p.checks.bonus), p.id).toBe(p.flaw ? -1 : 1)
      if (p.checks) expect(Math.abs(p.checks.bonus), p.id).toBeLessThanOrEqual(2)
      for (const [stat, v] of Object.entries(p.stats ?? {})) {
        expect(Math.sign(v), p.id).toBe(p.flaw ? -1 : 1)
        if (stat === 'max_hp') expect(Math.abs(v), p.id).toBe(5)
        if (stat === 'load_cap') expect(Math.abs(v), p.id).toBe(4)
        if (stat === 'ram_max') expect(Math.abs(v), p.id).toBe(1)
      }
    }
    expect(loaded().require<PerkEntry>('perk', 'tough')).toMatchObject({ name: '耐打', stats: { max_hp: 5 }, cost: 2 })
    expect(loaded().require<PerkEntry>('perk', 'old_wound')).toMatchObject({ name: '舊傷', stats: { max_hp: -5 }, flaw: true })
  })
})

describe('M0-data：建角的數字與上限（CHARACTER 第 5 節；EVENTS 2.4 節）', () => {
  it('建角的數字', () => {
    expect(loaded().require<CreationRuleEntry>('creation_rule', 'default')).toMatchObject({
      attr_array: [15, 14, 13, 12, 10, 8], attr_free: 2, attr_max: 18, attr_min: 4,
      skill_points: 10, skill_max: 3, perk_points: 4, perk_max: 8, flaw_max: 2, min_age: 18, start_money: 1500,
    })
  })

  it('錢的上限照等級，和核心的預設值一樣', () => {
    const cap = loaded().require('effect_cap', 'money').by_grade as Record<string, number>
    expect(cap).toEqual({ '1': 120, '2': 360, '3': 1200, '4': 3900, '5': 12000 })
    expect(Object.values(cap)).toEqual(Object.values(MONEY_CAP_BY_GRADE))
  })

  it('每一個資料檔都註明出處', async () => {
    const { SOURCES } = await import('../../data')
    for (const kind of ['attribute', 'skill', 'origin', 'perk', 'creation_rule', 'effect_cap']) expect(SOURCES[kind], kind).toMatch(/第 .+ 節/)
  })
})
