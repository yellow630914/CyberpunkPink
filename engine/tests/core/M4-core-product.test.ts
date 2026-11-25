// 驗收測試：dev/work/M4-core-product.md（設計圖、零件、成品的格式進核心；productOf、slotProblems、productPrice；內嵌的零件；物品類別 drug）。
// 規格：CRAFTING 第 1～6、14 節；DATA 7.1、7.2、3.4 節；ITEMS 1.3、1.4 節；CYBERWARE 第 1、2 節；dev/adr/0019 第一節與第十七節。
// 內容用測試自帶的最小資料：一把武器、一件護甲、一條義臂、十來個零件、兩筆怪癖。不裝任何功能的 kernel 就載得進。

import { describe, expect, it } from 'vitest'
import type { BlueprintEntry, InlinePart, ItemStack, Kernel, PartEntry } from '../../src/core'
import { ContentError, ITEM_CATEGORIES, UNREG_STACK_ID, createKernel, inlinePartProblems, partOf, partStack, partsOf, productOf, productPrice, readProduct, slotProblems, stackPart } from '../../src/core'

const part = (id: string, type: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})

const PARTS = [
  part('pt_plate1', 'plate', { grade: 1, price: 100, stats: { armor: 1 }, weight: 1 }),
  part('pt_plate2', 'plate', { grade: 2, price: 200, stats: { armor: 1 }, weight: 2 }),
  part('pt_plate3', 'plate', { grade: 3, price: 300, stats: { armor: 2 }, weight: 3, legal: 'permit' }),
  part('pt_plate_star', 'plate', { grade: 2, price: 200, brand: 'star', stats: { armor: 1 } }),
  part('pt_plate_ban', 'plate', { grade: 2, price: 200, legal: 'banned', stats: { armor: 1 } }),
  part('pt_act', 'actuator', { grade: 2, price: 200, stats: { power: 2, hit: 1 }, drawback: { hit: -1, sink: -1 }, weight: 2 }),
  part('pt_neuron', 'neuron', { grade: 2, price: 300, stats: { sync: 1 }, weight: 0.5 }),
  part('pt_neuron_star', 'neuron', { grade: 2, price: 300, brand: 'star', stats: { sync: 1 } }),
  part('pt_neuron_bio', 'neuron', { grade: 2, price: 300, material: 'bio', legal: 'banned', stats: { sync: 2 }, affinity: { net: 1 } }),
  part('pt_skin', 'skin', { grade: 2, price: 100, stats: { style: 1 }, affinity: { social: 1, media: 1 } }),
  part('pt_skin_bio', 'skin', { grade: 2, price: 100, material: 'bio', stats: { style: 2 }, affinity: { social: 2 }, traits: ['scan_proof'] }),
  part('pt_chip5', 'chip', { grade: 5, price: 1000 }),
  part('pt_barrel', 'barrel', { grade: 2, price: 200, stats: { pierce: 1 } }),
  part('pt_action', 'action', { grade: 2, price: 100, stats: {} }),
  part('pt_fiber', 'fiber', { grade: 1, price: 50, stats: { armor: 1 }, weight: 0.5 }),
]

const QUIRKS = [
  { id: 'q_bad', name: '卡', desc: '偶爾卡一下。', kind: 'flaw', stats: { hit: -1, armor: 1 }, pool: ['used', 'flaw'] },
  { id: 'q_nice', name: '手感', desc: '握起來特別順。', kind: 'quirk', applies: ['weapon', 'cyberware'], stats: { style: 1 }, effects: [{ stat: 'sync', amount: 1 }], pool: ['doujin'] },
]

const bp = (id: string, kind: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, kind, name: id, desc: '一張設計圖。', brand: 'hz', grade: 2, legal: 'register', price: 900, size: 1, weight: 2, require: [], optional: [], ...over,
})

const BLUEPRINTS = [
  bp('bp_pistol', 'weapon', { class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }, { type: 'plate' }] }),
  bp('bp_vest', 'armor', { armor: 1, covers: ['upper'], weight_class: 'light', require: [{ type: 'fiber' }, { type: 'plate', count: 2 }] }),
  // 義臂：板材、致動器、神經元必要，外皮選配；神經元與外皮兩種材質都收，板材與致動器只收機械；神經元只認自家牌子
  bp('bp_arm', 'cyberware', {
    slot: 'arm', invasiveness: 'invasive', sink_cost: 6, size: undefined, weight: undefined, picky: ['neuron'],
    require: [{ type: 'plate', material: 'mech', grade_min: 1 }, { type: 'actuator', material: 'mech' }, { type: 'neuron', material: 'any', grade_min: 2 }],
    optional: [{ type: 'skin', material: 'any' }],
    stock: { plate: 'pt_plate2', actuator: 'pt_act', neuron: 'pt_neuron' },
    price_mult: 1.5,
  }),
  bp('bp_plain', 'weapon', { class: 'pistol', carry: 'main', require: [{ type: 'plate' }], optional: [{ type: 'skin' }] }),
]

function kernel(): Kernel {
  const k = createKernel()
  k.content.load('blueprint', BLUEPRINTS.map((e) => JSON.parse(JSON.stringify(e))))
  k.content.load('part', PARTS)
  k.content.load('quirk', QUIRKS)
  return k
}

const inline = (uid: string, over: Record<string, unknown> = {}): InlinePart => {
  const { id: _id, ...rest } = part('x', 'plate', { name: '無名的板材', brand: 'none', grade: 2, price: 600, legal: 'free', stats: { armor: 2 }, ...over })
  return { ...rest, unreg: true, uid, desc: '街上流傳的一塊板子。', ...over } as unknown as InlinePart
}

const arm = (parts: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ uid: 'a1', parts, ...extra })

describe('三種內容載得進（不裝任何功能的 kernel）', () => {
  it('設計圖、零件、怪癖都收；義體的設計圖可以不寫 size 與 weight', () => {
    const k = kernel()
    expect(k.content.list('blueprint')).toHaveLength(4)
    expect(k.content.list('part')).toHaveLength(PARTS.length)
    expect(k.content.list('quirk')).toHaveLength(2)
    // 這個 kernel 沒有武器類（weapon_class），只看原廠組合引用的零件都在
    expect(k.content.checkRefs().filter((p) => !p.includes('weapon_class'))).toEqual([])
    expect(k.content.get('blueprint', 'bp_arm')).not.toHaveProperty('size')
  })

  const problems = (kind: string, e: Record<string, unknown>) => createKernel().content.validate(kind, [e]).join('\n')
  const ARM = BLUEPRINTS[2]!
  const edit = (field: string, value: unknown) => {
    const e: Record<string, unknown> = { ...ARM, [field]: value }
    if (value === undefined) delete e[field]
    return problems('blueprint', e)
  }

  it('義體：缺 slot、侵入度寫錯、沉溺成本是負的各被擋下，訊息指出欄位', () => {
    expect(problems('blueprint', ARM)).toBe('')
    expect(edit('slot', undefined)).toMatch(/slot（部位）只能是 bridge、brain、eye、ear_throat、torso、skin、arm、leg、intimate/)
    expect(edit('slot', 'arm_l')).toMatch(/slot（部位）/)
    expect(edit('invasiveness', 'deep')).toMatch(/invasiveness（侵入度）只能是 surface、light、invasive、heavy、extreme/)
    expect(edit('invasiveness', undefined)).toMatch(/invasiveness/)
    expect(edit('sink_cost', -1)).toMatch(/sink_cost（沉溺成本）要是 0 以上的整數/)
    expect(edit('sink_cost', 1.5)).toMatch(/sink_cost/)
    expect(edit('sink_cost', undefined)).toMatch(/sink_cost/)
  })

  it.each([
    ['needs_bridge', 'yes', /needs_bridge 要是布林值/],
    ['effects', {}, /effects 要是陣列/],
    ['battle', 3, /battle 要是一個物件/],
    ['scene_parts', { adds: 'tail' }, /scene_parts\.adds/],
    ['scene_parts', { sensitivity: { tail: 1.5 } }, /scene_parts\.sensitivity/],
    ['deck', { slots: 40, firewall: 1 }, /deck\.slots/],
    ['deck', { slots: 2, firewall: -1 }, /deck\.firewall/],
    ['deck', { slots: 2, firewall: 1, ram: { max: -1 } }, /deck\.ram\.max/],
    ['deck', { slots: 2, firewall: 1, cooling: 'x' }, /deck\.cooling/],
    ['bridge', { tuning_slots: -1 }, /bridge\.tuning_slots/],
    ['lock', 'owned', /lock 只能是 subscription、contract/],
    ['upkeep_weekly', -5, /upkeep_weekly/],
    ['creation_points', 1.5, /creation_points/],
    ['tattoo', { kind: 'cute' }, /tattoo/],
    ['tattoo', { kind: 'gang', faction: '' }, /tattoo\.faction/],
  ] as const)('義體的選填欄位 %s 寫成 %j 被擋下', (field, value, re) => {
    expect(edit(field, value as unknown)).toMatch(re)
  })

  it('義體的選填欄位寫對收得進來（甲板、橋、掛著授權鎖、刺青、場景部位）', () => {
    const ok = {
      ...ARM, needs_bridge: false, effects: [{ stat: 'sync', amount: 1 }], battle: { actions: [] }, scene_parts: { adds: ['tail'], sensitivity: { tail: 15, back: -5 } },
      deck: { slots: 3, firewall: 5, ram: { max: 2, regen: 0 }, cooling: 1 }, bridge: { tuning_slots: 2 }, lock: 'subscription', upkeep_weekly: 40, creation_points: 3,
      tattoo: { kind: 'gang', faction: 'f_corp' },
    }
    expect(problems('blueprint', ok)).toBe('')
  })

  it('槽的欄位：material、count；挑剔、原廠組合、型係數', () => {
    expect(edit('require', [{ type: 'plate', material: 'wood' }])).toMatch(/require\[0\]\.material 只能是 mech、bio、any/)
    expect(edit('require', [{ type: 'plate', count: 0 }])).toMatch(/require\[0\]\.count 要是 1 以上的整數/)
    expect(edit('require', [{ type: 'plate', count: 2.5 }])).toMatch(/count/)
    expect(edit('optional', [{ grade_min: 2 }])).toMatch(/optional\[0\] 要有 type/)
    expect(edit('picky', 'neuron')).toMatch(/picky 要是零件類型的陣列/)
    expect(edit('price_mult', 0)).toMatch(/price_mult（型係數）要是大於 0 的數字/)
    expect(edit('price_mult', -1)).toMatch(/price_mult/)
    expect(edit('stock', 'pt_plate1')).toMatch(/stock 要是「零件類型 → 零件 id 或陣列」/)
    expect(edit('stock', { plate: 3 })).toMatch(/stock\.plate 要是零件的 id 或 id 的陣列/)
    expect(edit('stock', { plate: [] })).toMatch(/stock\.plate/)
    expect(edit('stock', { tail: 'pt_x' })).toMatch(/stock\.tail：這張設計圖沒有 tail 這個槽/)
  })

  it('原廠組合引用的零件要查得到（引用檢查）', () => {
    const k = createKernel()
    k.content.load('blueprint', [{ ...BLUEPRINTS[2]!, stock: { plate: ['pt_nope'] } }])
    expect(k.content.checkRefs()).toEqual(['blueprint/bp_arm：引用了不存在的 part/pt_nope'])
  })

  it('武器與護甲的舊規則照舊（義體以外 size 與 weight 一定要寫）', () => {
    const W = BLUEPRINTS[0]!
    expect(problems('blueprint', { ...W, size: undefined })).toMatch(/size 要是 0～4/)
    expect(problems('blueprint', { ...W, weight: undefined })).toMatch(/weight 要是 0 以上的數字/)
    expect(problems('blueprint', { ...W, kind: 'toy' })).toMatch(/kind 只能是 weapon、armor、cyberware/)
    expect(problems('blueprint', { ...W, class: undefined })).toMatch(/武器要寫 class/)
  })

  it('零件多的欄位：親和、代價、效果、橋', () => {
    const P = PARTS[0]!
    const edit = (f: string, v: unknown) => problems('part', { ...P, [f]: v })
    expect(problems('part', { ...P, affinity: { net: 1, social: -1 }, drawback: { hit: -1 }, effects: [], bridge: { capacity: 10, split: { meat: 8, net: 0 } } })).toBe('')
    expect(edit('affinity', { vibes: 1 })).toMatch(/affinity 要是「meat、net、social、media → 整數」/)
    expect(edit('affinity', { net: 1.5 })).toMatch(/affinity/)
    expect(edit('drawback', { hit: 1 })).toMatch(/drawback 要是「數字的名字 → 負的數字」/)
    expect(edit('drawback', { hit: 0 })).toMatch(/drawback/)
    expect(edit('effects', 'x')).toMatch(/effects 要是陣列/)
    expect(edit('bridge', { capacity: 1.5 })).toMatch(/bridge\.capacity 要是整數/)
    expect(edit('bridge', { split: { meat: -1 } })).toMatch(/bridge\.split/)
    expect(edit('bridge', { split: { cat: 1 } })).toMatch(/bridge\.split/)
    expect(edit('bridge', 3)).toMatch(/bridge 要是/)
    // 原本的檢查照舊
    expect(edit('material', 'wood')).toMatch(/material 只能是 mech、bio/)
    expect(edit('state', 'broken')).toMatch(/state 只能是 new、used、doujin、living/)
  })

  it('怪癖：kind 寫錯被擋；applies、pool、stats、tags 的格式', () => {
    const Q = QUIRKS[0]!
    const edit = (f: string, v: unknown) => problems('quirk', { ...Q, [f]: v })
    expect(problems('quirk', Q)).toBe('')
    expect(edit('kind', 'curse')).toMatch(/kind 只能是 echo、quirk、flaw、complication/)
    expect(edit('kind', undefined)).toMatch(/kind 只能是/)
    expect(edit('name', '')).toMatch(/要有 name/)
    expect(edit('desc', undefined)).toMatch(/要有 desc/)
    expect(edit('applies', ['mech'])).toMatch(/applies/)
    expect(edit('applies', [])).toMatch(/applies/)
    expect(edit('pool', ['junk'])).toMatch(/pool/)
    expect(edit('stats', { hit: 'x' })).toMatch(/stats/)
    expect(edit('effects', {})).toMatch(/effects 要是陣列/)
    expect(edit('tags', [1])).toMatch(/tags/)
    expect(problems('quirk', { ...Q, kind: 'echo', applies: ['weapon', 'armor', 'cyberware'], pool: [], tags: ['t'], effects: [] })).toBe('')
  })

  it('重複載入同一種：設計圖與零件整批照舊擋 id 重複；三種都不是規則表', () => {
    const k = kernel()
    expect(() => k.content.load('part', [PARTS[0]!])).toThrow(ContentError)
    for (const kind of ['blueprint', 'part', 'quirk']) expect(k.content.isOverridable(kind)).toBe(false)
  })

  it('物品類別多了 drug（排在 consumable 後面），物品收得進來', () => {
    const i = ITEM_CATEGORIES.indexOf('consumable')
    expect(ITEM_CATEGORIES[i + 1]).toBe('drug')
    const k = createKernel()
    expect(k.content.validate('item', [{ id: 'it_pill', name: '藥', desc: '一顆藥。', category: 'drug', grade: 1, size: 0, legal: 'register' }])).toEqual([])
    expect(k.content.validate('item', [{ id: 'it_pill', name: '藥', desc: '一顆藥。', category: 'candy', grade: 1, size: 0, legal: 'register' }].map((e) => e))[0]).toMatch(/category 只能是.*consumable、drug、ammo/)
  })
})

describe('productOf：一件成品合起來是什麼', () => {
  const mech = { plate: 'pt_plate2', actuator: 'pt_act', neuron: 'pt_neuron' }

  it('全機械的義臂：allBio false、seams 0、沒有缺的槽；等級與重量；牌子只有一個是原廠全套', () => {
    const k = kernel()
    const p = productOf(k.content, 'bp_arm', arm(mech))!
    expect(p.bp.id).toBe('bp_arm')
    expect(p.parts.map((x) => [x.type, x.part.id])).toEqual([['plate', 'pt_plate2'], ['actuator', 'pt_act'], ['neuron', 'pt_neuron']])
    expect(p.missing).toEqual([])
    expect(p.allBio).toBe(false)
    expect(p.seams).toBe(0)
    expect(p.grade).toBe(2)
    expect(p.brands).toEqual(['hz'])
    // 設計圖沒寫 weight 當 0；零件 2 + 2 + 0.5
    expect(p.weight).toBe(4.5)
    expect(p.legal).toBe('register')
  })

  it('神經元與外皮換成生體件之後接面是 2；全部生體的 allBio 是 true、legal 是 free', () => {
    const k = kernel()
    const mixed = productOf(k.content, 'bp_arm', arm({ plate: 'pt_plate2', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' }))!
    expect(mixed.seams).toBe(2)
    expect(mixed.allBio).toBe(false)
    // 生體的神經元是 banned：混裝的成品照最嚴的算
    expect(mixed.legal).toBe('banned')
    const bioBp = bp('bp_ear', 'cyberware', { slot: 'ear_throat', invasiveness: 'light', sink_cost: 0, legal: 'permit', require: [{ type: 'neuron' }, { type: 'skin' }] })
    k.content.load('blueprint', [bioBp])
    const bio = productOf(k.content, 'bp_ear', arm({ neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' }))!
    expect(bio.allBio).toBe(true)
    expect(bio.seams).toBe(0)
    expect(bio.legal).toBe('free') // 設計圖是 permit、神經元是 banned，全生體一律自由
  })

  it('接面是兩種材質裡比較少的那一種的件數', () => {
    const k = kernel()
    const one = productOf(k.content, 'bp_arm', arm({ plate: 'pt_plate2', actuator: 'pt_act', neuron: 'pt_neuron_bio' }))!
    expect(one.seams).toBe(1)
    const three = productOf(k.content, 'bp_arm', arm({ plate: 'pt_plate2', actuator: 'pt_act', neuron: ['pt_neuron_bio'], skin: ['pt_skin_bio', 'pt_skin_bio'] }))!
    expect(three.seams).toBe(2)
  })

  it('裝了一個 banned 的零件之後 legal 是 banned；合法性是設計圖與零件裡最嚴的', () => {
    const k = kernel()
    expect(productOf(k.content, 'bp_arm', arm({ ...mech, plate: 'pt_plate_ban' }))!.legal).toBe('banned')
    expect(productOf(k.content, 'bp_arm', arm({ ...mech, plate: 'pt_plate3' }))!.legal).toBe('permit')
    // 設計圖自己是 register，零件都是 free：取設計圖的
    expect(productOf(k.content, 'bp_arm', arm({ ...mech, plate: 'pt_plate1' }))!.legal).toBe('register')
  })

  it('stats 逐鍵相加：零件的 stats、drawback 的負值、怪癖的值、bonus；親和與牌子', () => {
    const k = kernel()
    const p = productOf(k.content, 'bp_arm', arm({ ...mech, skin: 'pt_skin' }, { quirks: ['q_bad', 'q_nice', 'q_ghost'], bonus: { power: 1 } }))!
    // armor：板材 1 + 怪癖 q_bad 1；hit：致動器 +1 − 1（drawback）+ q_bad −1；power：2 + bonus 1；sink：drawback −1；style：外皮 1 + q_nice 1
    expect(p.stats).toEqual({ armor: 2, power: 3, hit: -1, sink: -1, sync: 1, style: 2 })
    expect(p.quirks.map((q) => q.id)).toEqual(['q_bad', 'q_nice'])
    expect(p.affinity).toEqual({ social: 1, media: 1 })
    const star = productOf(k.content, 'bp_arm', arm({ ...mech, plate: 'pt_plate_star' }))!
    expect(star.brands).toEqual(['hz', 'star'])
    const all = productOf(k.content, 'bp_arm', arm({ ...mech, neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' }))!
    expect(all.affinity).toEqual({ net: 1, social: 2 })
  })

  it('少一個必要的零件時 missing 列出它；要兩個的缺一個也列；選配的空著不算', () => {
    const k = kernel()
    expect(productOf(k.content, 'bp_arm', arm({ plate: 'pt_plate2', actuator: 'pt_act' }))!.missing).toEqual(['neuron'])
    const noStock = kernel()
    noStock.content.load('blueprint', [bp('bp_bare', 'weapon', { class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'plate' }] })])
    expect(productOf(noStock.content, 'bp_bare', { uid: 'u' })!.missing).toEqual(['barrel', 'plate'])
    // 護甲要兩塊板材（count 2）
    expect(productOf(k.content, 'bp_vest', { uid: 'v', parts: { fiber: 'pt_fiber', plate: 'pt_plate1' } })!.missing).toEqual(['plate'])
    expect(productOf(k.content, 'bp_vest', { uid: 'v', parts: { fiber: 'pt_fiber', plate: ['pt_plate1', 'pt_plate2'] } })!.missing).toEqual([])
    // 查不到的零件 id 略過，那個槽算缺
    expect(productOf(k.content, 'bp_arm', arm({ ...mech, neuron: 'pt_ghost' }))!.missing).toEqual(['neuron'])
    expect(productOf(k.content, 'bp_arm', arm({ ...mech, neuron: 'pt_ghost' }))!.parts).toHaveLength(2)
  })

  it('data 沒有 parts（或是空的）而設計圖有 stock 時用 stock；有 parts 就不用', () => {
    const k = kernel()
    const stock = productOf(k.content, 'bp_arm', undefined)!
    expect(stock.parts.map((x) => x.part.id)).toEqual(['pt_plate2', 'pt_act', 'pt_neuron'])
    expect(stock.missing).toEqual([])
    expect(productOf(k.content, 'bp_arm', { uid: 'x', parts: {} })!.parts).toHaveLength(3)
    expect(productOf(k.content, 'bp_arm', { uid: 'x', parts: 'oops' })!.parts).toHaveLength(3)
    expect(productOf(k.content, 'bp_arm', arm({ plate: 'pt_plate1' }))!.parts.map((x) => x.part.id)).toEqual(['pt_plate1'])
  })

  it('查不到設計圖回 undefined；壞掉的資料不丟錯；不改傳進來的資料', () => {
    const k = kernel()
    expect(productOf(k.content, 'bp_ghost', arm({}))).toBeUndefined()
    expect(() => productOf(k.content, 'bp_arm', 12)).not.toThrow()
    expect(() => productOf(k.content, 'bp_arm', { uid: 5, parts: { plate: 7, actuator: [null, { name: 'x' }] }, quirks: [1, 'q_bad'], bonus: { power: 'x', hit: 2 } })).not.toThrow()
    const data = arm(mech, { quirks: ['q_bad'], bonus: { power: 1 } })
    const before = JSON.stringify(data)
    productOf(k.content, 'bp_arm', data)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('回傳的 stats 與 affinity 是複本：改它不會改到內容', () => {
    const k = kernel()
    const p = productOf(k.content, 'bp_arm', arm(mech))!
    p.stats.armor = 99
    expect(k.content.get<PartEntry>('part', 'pt_plate2')!.stats.armor).toBe(1)
    expect(productOf(k.content, 'bp_arm', arm(mech))!.stats.armor).toBe(1)
  })
})

describe('slotProblems：一個零件放不放得進一個槽', () => {
  const bpArm = (k: Kernel) => k.content.get<BlueprintEntry>('blueprint', 'bp_arm')!

  it('合格的零件：沒有問題、不超規', () => {
    const k = kernel()
    expect(slotProblems(k.content, bpArm(k), 'plate', 'pt_plate2')).toEqual({ problems: [], overspec: false })
    expect(slotProblems(k.content, 'bp_arm', 'plate', 'pt_plate1')).toEqual({ problems: [], overspec: false })
    expect(slotProblems(k.content, bpArm(k), 'neuron', 'pt_neuron_bio')).toEqual({ problems: [], overspec: false }) // 神經元兩種材質都收
  })

  it('類型不對、材質不對、等級不夠、高兩級、挑剔的牌子不對各有一句', () => {
    const k = kernel()
    const bpA = bpArm(k)
    expect(slotProblems(k.content, bpA, 'plate', 'pt_act').problems).toEqual(['這個槽要的是板材，不是致動器。'])
    expect(slotProblems(k.content, bpA, 'plate', 'pt_neuron_bio').problems).toEqual(['這個槽要的是板材，不是機械神經元。', '這個槽只收機械的零件，生體的放不進去。'])
    expect(slotProblems(k.content, bpA, 'actuator', 'pt_act').problems).toEqual([])
    const bioPlate = { ...part('pt_plate_bio', 'plate', { material: 'bio' }) }
    k.content.load('part', [bioPlate])
    expect(slotProblems(k.content, bpA, 'plate', 'pt_plate_bio').problems).toEqual(['這個槽只收機械的零件，生體的放不進去。'])
    const bioOnly = bp('bp_bioonly', 'cyberware', { slot: 'skin', invasiveness: 'surface', sink_cost: 0, require: [{ type: 'skin', material: 'bio' }] })
    k.content.load('blueprint', [bioOnly])
    expect(slotProblems(k.content, 'bp_bioonly', 'skin', 'pt_skin').problems).toEqual(['這個槽只收生體的零件，機械的放不進去。'])
    expect(slotProblems(k.content, 'bp_bioonly', 'skin', 'pt_skin_bio').problems).toEqual([])
    // 等級不夠：神經元的槽 grade_min 2
    k.content.load('part', [part('pt_neuron1', 'neuron', { grade: 1 })])
    expect(slotProblems(k.content, bpA, 'neuron', 'pt_neuron1').problems).toEqual(['這個槽的機械神經元至少要 II 級。'])
    // 高兩級以上
    expect(slotProblems(k.content, bpA, 'plate', 'pt_plate3').overspec).toBe(true) // 設計圖 II 級、零件 III 級：高一級
    expect(slotProblems(k.content, bpA, 'plate', 'pt_plate3').problems).toEqual([])
    k.content.load('part', [part('pt_plate4', 'plate', { grade: 4 })])
    expect(slotProblems(k.content, bpA, 'plate', 'pt_plate4')).toEqual({ problems: ['比設計圖高兩級以上，塞不進去。'], overspec: false })
    // 挑剔：神經元只認設計圖自己的牌子
    expect(slotProblems(k.content, bpA, 'neuron', 'pt_neuron_star').problems).toEqual(['這張設計圖只認自家的機械神經元，要先破解。'])
    expect(slotProblems(k.content, bpA, 'neuron', 'pt_neuron').problems).toEqual([])
    // 板材不挑牌子
    expect(slotProblems(k.content, bpA, 'plate', 'pt_plate_star').problems).toEqual([])
  })

  it('剛好高一級：沒有問題、overspec 是 true；有別的問題時不算超規', () => {
    const k = kernel()
    const r = slotProblems(k.content, bpArm(k), 'plate', 'pt_plate3')
    expect(r).toEqual({ problems: [], overspec: true })
    k.content.load('part', [part('pt_plate3_bio', 'plate', { grade: 3, material: 'bio' })])
    const bad = slotProblems(k.content, bpArm(k), 'plate', 'pt_plate3_bio')
    expect(bad.problems).toHaveLength(1)
    expect(bad.overspec).toBe(false)
  })

  it('一個零件同時有幾個問題：一條一個條件', () => {
    const k = kernel()
    k.content.load('part', [part('pt_bad_neuron', 'neuron', { grade: 4, brand: 'star', material: 'bio' }), part('pt_bad_plate', 'plate', { grade: 4, brand: 'star', material: 'bio' })])
    const r = slotProblems(k.content, 'bp_arm', 'plate', 'pt_bad_plate')
    expect(r.problems).toEqual(['這個槽只收機械的零件，生體的放不進去。', '比設計圖高兩級以上，塞不進去。'])
    const n = slotProblems(k.content, 'bp_arm', 'neuron', 'pt_bad_neuron')
    expect(n.problems).toEqual(['比設計圖高兩級以上，塞不進去。', '這張設計圖只認自家的機械神經元，要先破解。'])
  })

  it('槽不存在、查不到零件、查不到設計圖：各一句，不丟錯', () => {
    const k = kernel()
    expect(slotProblems(k.content, 'bp_arm', 'barrel', 'pt_barrel').problems).toEqual(['這張設計圖沒有槍管的槽。'])
    expect(slotProblems(k.content, 'bp_arm', 'plate', 'pt_ghost').problems).toEqual(['找不到這個零件。'])
    expect(slotProblems(k.content, 'bp_ghost', 'plate', 'pt_plate1').problems).toEqual(['找不到這張設計圖。'])
    expect(slotProblems(k.content, 'bp_arm', 'plate', 42).problems).toEqual(['找不到這個零件。'])
  })

  it('選配的槽也查；設計圖沒寫 material 就是什麼都收', () => {
    const k = kernel()
    expect(slotProblems(k.content, 'bp_plain', 'skin', 'pt_skin_bio').problems).toEqual([])
    expect(slotProblems(k.content, 'bp_plain', 'skin', 'pt_plate1').problems).toEqual(['這個槽要的是外皮，不是板材。'])
  })
})

describe('productPrice：成品的目錄價', () => {
  const priced = (mult: number | undefined) => {
    const k = createKernel()
    k.content.load('blueprint', [bp('bp_p', 'weapon', { class: 'pistol', carry: 'side', price_mult: mult, require: [{ type: 'plate' }, { type: 'barrel' }, { type: 'action' }] })].map((e) => (mult === undefined ? (delete e.price_mult, e) : e)))
    k.content.load('part', [part('p100', 'plate', { price: 100 }), part('p200', 'barrel', { price: 200 }), part('p300', 'action', { price: 300 })])
    return k
  }
  const full = { uid: 'g1', parts: { plate: 'p100', barrel: 'p200', action: 'p300' } }

  it('三個零件 100、200、300，型係數 1.5：1,080；二手 540；沒寫型係數是 720', () => {
    const k = priced(1.5)
    expect(productPrice(k.content, 'bp_p', full)).toBe(1080)
    expect(productPrice(k.content, 'bp_p', { ...full, state: 'used' })).toBe(540)
    expect(productPrice(priced(undefined).content, 'bp_p', full)).toBe(720)
  })

  it('品質：精工 ×1.1、帶瑕疵 ×0.8（暫定）；二手再疊上去；四捨五入到整數', () => {
    const k = priced(1.5)
    expect(productPrice(k.content, 'bp_p', { ...full, quality: 'fine' })).toBe(1188)
    expect(productPrice(k.content, 'bp_p', { ...full, quality: 'flawed' })).toBe(864)
    expect(productPrice(k.content, 'bp_p', { ...full, quality: 'standard' })).toBe(1080)
    expect(productPrice(k.content, 'bp_p', { ...full, quality: 'fine', state: 'used' })).toBe(594)
    // 100 × 1.2 = 120，× 0.8 = 96；單一零件 33 × 1.2 = 39.6 → 40
    const k2 = priced(undefined)
    k2.content.load('part', [part('p33', 'plate', { price: 33 })])
    expect(productPrice(k2.content, 'bp_p', { uid: 'x', parts: { plate: 'p33' } })).toBe(40)
  })

  it('沒有零件是 0；零件查不到的不算；查不到設計圖是 0；同人與活的狀態不打折', () => {
    const k = priced(1.5)
    expect(productPrice(k.content, 'bp_p', { uid: 'e', parts: {} })).toBe(0)
    expect(productPrice(k.content, 'bp_p', undefined)).toBe(0)
    expect(productPrice(k.content, 'bp_p', { uid: 'e', parts: { plate: 'ghost' } })).toBe(0)
    expect(productPrice(k.content, 'bp_p', { uid: 'e', parts: { plate: ['p100', 'ghost'] } })).toBe(180)
    expect(productPrice(k.content, 'bp_ghost', full)).toBe(0)
    expect(productPrice(k.content, 'bp_p', { ...full, state: 'doujin' })).toBe(1080)
    expect(productPrice(k.content, 'bp_p', { ...full, state: 'living' })).toBe(1080)
  })

  it('設計圖有 stock 而 data 沒有零件時，價錢就是原廠組合的價錢（目錄上的成品）', () => {
    const k = kernel()
    // 板材 200 + 致動器 200 + 神經元 300 = 700，× 1.2 × 1.5 = 1,260
    expect(productPrice(k.content, 'bp_arm', undefined)).toBe(1260)
    expect(productPrice(k.content, 'bp_arm', { uid: 'a', parts: { plate: 'pt_plate1' } })).toBe(180)
  })
})

describe('readProduct：把壞掉的資料整理成合格的', () => {
  it('合格的資料原樣讀回，回傳新的物件', () => {
    const raw = {
      uid: 'a1', parts: { plate: 'pt_plate2', skin: ['pt_skin', 'pt_skin_bio'] }, quality: 'fine', bonus: { power: 1 }, quirks: ['q_bad'], state: 'used',
      lock: { kind: 'subscription', owed: 3 }, dye: { primary_color: '#ff0000', secondary_color: '#00ff00' },
    }
    const r = readProduct(raw)
    expect(r).toEqual(raw)
    expect(r).not.toBe(raw)
    expect(r.parts).not.toBe(raw.parts)
    r.lock!.owed = 9
    expect(raw.lock.owed).toBe(3)
  })

  it('壞掉的資料不丟錯：parts 是字串、quirks 混了數字、不認得的鍵與值都丟掉', () => {
    expect(readProduct({ uid: 'a', parts: 'oops', quirks: [1, 'q_bad', null, 'q_bad', ''], extra: 1, quality: 'perfect', state: 'broken', bonus: { power: 'x', hit: 2, nan: NaN }, lock: 'x', dye: { primary_color: 5 } }))
      .toEqual({ uid: 'a', parts: {}, quirks: ['q_bad'], bonus: { hit: 2 } })
    for (const junk of [undefined, null, 5, 'x', [], [1], true]) expect(readProduct(junk)).toEqual({ uid: '', parts: {} })
    expect(readProduct({ uid: 7, parts: { plate: 7, skin: [null, {}, 'pt_skin', 3], barrel: [] } }).parts).toEqual({ skin: ['pt_skin'] })
    expect(readProduct({ uid: 'a', parts: JSON.parse('{"__proto__": "x", "plate": "p"}') }).parts).toEqual({ plate: 'p' })
  })
})

describe('內嵌的零件（未登錄零件；dev/adr/0019 第十七節）', () => {
  it('inlinePartProblems：合格的收；part 的欄位、unreg、uid、desc、quirk、bridge 各有一句', () => {
    const k = kernel()
    const ok = inline('u1')
    expect(inlinePartProblems(k.content, ok)).toEqual([])
    expect(inlinePartProblems(k.content, { ...ok, quirk: 'q_nice', quirk_text: '很順手。', from: '委託' })).toEqual([])
    const bad = (over: Record<string, unknown>) => inlinePartProblems(k.content, { ...ok, ...over }).join('\n')
    expect(bad({ unreg: false })).toMatch(/unreg 要是 true/)
    expect(bad({ unreg: undefined })).toMatch(/unreg 要是 true/)
    expect(bad({ uid: undefined })).toMatch(/要有 uid/)
    expect(bad({ uid: '' })).toMatch(/要有 uid/)
    expect(bad({ desc: 5 })).toMatch(/desc 要是字串/)
    expect(bad({ quirk: 'q_ghost' })).toMatch(/quirk q_ghost 查不到/)
    expect(bad({ quirk_text: 3 })).toMatch(/quirk_text/)
    expect(bad({ grade: 9 })).toMatch(/grade 要是 1～5/)
    expect(bad({ material: 'wood' })).toMatch(/material 只能是/)
    expect(bad({ bridge: { capacity: 10 } })).toMatch(/不能帶 bridge/)
    expect(inlinePartProblems(k.content, 'pt_plate1')).toEqual(['內嵌的零件要是一個物件'])
    expect(inlinePartProblems(k.content, null)).toHaveLength(1)
  })

  it('partOf：字串查內容；內嵌的整理成 PartEntry（id 是 unreg:<uid>），是複本；不合格的與查不到的是 undefined', () => {
    const k = kernel()
    expect(partOf(k.content, 'pt_plate1')?.id).toBe('pt_plate1')
    expect(partOf(k.content, 'pt_ghost')).toBeUndefined()
    const src = inline('u1', { id: 'sneaky' })
    const p = partOf(k.content, src)!
    expect(p.id).toBe('unreg:u1')
    expect(p).toMatchObject({ name: '無名的板材', type: 'plate', grade: 2, price: 600, unreg: true, uid: 'u1', stats: { armor: 2 } })
    p.stats.armor = 99
    expect(src.stats.armor).toBe(2)
    expect(partOf(k.content, { ...src, uid: undefined })).toBeUndefined()
    expect(partOf(k.content, { ...src, bridge: { capacity: 1 } })).toBeUndefined()
    expect(partOf(k.content, { ...src, quirk: 'q_ghost' })).toBeUndefined()
    for (const junk of [undefined, null, 3, [], {}]) expect(partOf(k.content, junk)).toBeUndefined()
  })

  it('一件成品的一個槽放一筆內嵌零件：stats、affinity、legal、quirks 都算到它，price 算進價錢', () => {
    const k = kernel()
    const un = inline('u1', { price: 600, legal: 'banned', stats: { armor: 2, style: 1 }, drawback: { hit: -1 }, affinity: { net: 2 }, quirk: 'q_nice', quirk_text: '很順手。', weight: 3 })
    const data = arm({ plate: un, actuator: 'pt_act', neuron: 'pt_neuron' }, { quirks: ['q_bad'] })
    const p = productOf(k.content, 'bp_arm', data)!
    expect(p.parts.map((x) => x.part.id)).toEqual(['unreg:u1', 'pt_act', 'pt_neuron'])
    expect(p.missing).toEqual([])
    expect(p.legal).toBe('banned')
    expect(p.affinity).toEqual({ net: 2 })
    // armor：內嵌 2 + 怪癖 q_bad 1；style：內嵌 1 + q_nice 1；hit：內嵌 −1 + 致動器 +1 −1 + q_bad −1
    expect(p.stats).toEqual({ armor: 3, style: 2, hit: -2, power: 2, sink: -1, sync: 1 })
    expect(p.quirks.map((q) => q.id)).toEqual(['q_bad', 'q_nice']) // 自己的 quirks 在前，內嵌零件的怪癖算進來；它的效果也在
    expect(p.quirks[1]!.effects).toEqual([{ stat: 'sync', amount: 1 }])
    expect(p.weight).toBe(3 + 2 + 0.5)
    // 價錢：(600 + 200 + 300) × 1.2 × 1.5
    expect(productPrice(k.content, 'bp_arm', data)).toBe(1980)
    // 同一個怪癖兩邊都有，只算一次
    expect(productOf(k.content, 'bp_arm', arm({ plate: un }, { quirks: ['q_nice'] }))!.quirks).toHaveLength(1)
    expect(productOf(k.content, 'bp_arm', arm({ plate: un }, { quirks: ['q_nice'] }))!.stats.style).toBe(2)
  })

  it('slotProblems 對它照樣查類型、材質、等級；等級高一級是超規', () => {
    const k = kernel()
    expect(slotProblems(k.content, 'bp_arm', 'plate', inline('u1')).problems).toEqual([])
    expect(slotProblems(k.content, 'bp_arm', 'actuator', inline('u1')).problems).toEqual(['這個槽要的是致動器，不是板材。'])
    expect(slotProblems(k.content, 'bp_arm', 'plate', inline('u1', { material: 'bio' })).problems).toEqual(['這個槽只收機械的零件，生體的放不進去。'])
    expect(slotProblems(k.content, 'bp_arm', 'plate', inline('u1', { grade: 3 }))).toEqual({ problems: [], overspec: true })
    expect(slotProblems(k.content, 'bp_arm', 'plate', inline('u1', { grade: 4 })).problems).toEqual(['比設計圖高兩級以上，塞不進去。'])
    expect(slotProblems(k.content, 'bp_arm', 'neuron', inline('u1', { type: 'neuron', brand: 'star' })).problems).toEqual(['這張設計圖只認自家的機械神經元，要先破解。'])
    expect(slotProblems(k.content, 'bp_arm', 'plate', { ...inline('u1'), uid: undefined }).problems).toEqual(['找不到這個零件。'])
  })

  it('readProduct 讀回來還在；少了 uid 的那一筆被丟掉；帶 bridge 的被丟掉；多的欄位丟掉', () => {
    const k = kernel()
    const un = inline('u1')
    const r = readProduct({ uid: 'a', parts: { plate: un, neuron: [inline('u2', { type: 'neuron' }), { ...inline('u3'), uid: undefined }, { ...inline('u4'), bridge: { capacity: 3 } }], skin: { ...inline('u5'), uid: undefined } } }, k.content)
    expect(r.parts.plate).toEqual(un)
    expect((r.parts.plate as InlinePart).uid).toBe('u1')
    expect(r.parts.neuron).toHaveLength(1)
    expect((r.parts.neuron as InlinePart[])[0]!.uid).toBe('u2')
    expect(r.parts).not.toHaveProperty('skin')
    expect(readProduct({ uid: 'a', parts: { plate: { ...un, id: 'x', junk: 1 } } }).parts.plate).toEqual(un)
    // 讀回來的是複本
    ;(r.parts.plate as InlinePart).stats.armor = 99
    expect(un.stats.armor).toBe(2)
    // 有給 content 時 quirk 要查得到；沒給只查格式
    const ghost = inline('u6', { quirk: 'q_ghost' })
    expect(readProduct({ uid: 'a', parts: { plate: ghost } }, k.content).parts).toEqual({})
    expect(readProduct({ uid: 'a', parts: { plate: ghost } }).parts.plate).toEqual(ghost)
    expect(partsOf(k.content, { parts: { plate: ghost } })).toEqual([])
  })

  it('stackPart 對三種疊各回對的那一筆；partStack 與 stackPart 來回一次不變', () => {
    const k = kernel()
    // 內容的零件
    const plain: ItemStack = { id: 'pt_plate1', qty: 1 }
    expect(stackPart(k.content, plain)).toBe(k.content.get('part', 'pt_plate1'))
    expect(stackPart(k.content, plain)!.state).toBe('new')
    // 帶 data.state 的零件（拆下來的二手件）：狀態換成它，其餘不變，不改內容
    const used: ItemStack = { id: 'pt_plate1', qty: 1, data: { state: 'used' } }
    const u = stackPart(k.content, used)!
    expect(u).toMatchObject({ id: 'pt_plate1', state: 'used', price: 100, stats: { armor: 1 } })
    expect(k.content.get<PartEntry>('part', 'pt_plate1')!.state).toBe('new')
    expect(stackPart(k.content, { id: 'pt_plate1', qty: 1, data: { state: 'cursed' } })!.state).toBe('new')
    // 內嵌的零件
    const un = inline('u1')
    const st: ItemStack = { id: UNREG_STACK_ID, qty: 1, data: { uid: 'u1', part: un } }
    expect(stackPart(k.content, st)).toEqual(partOf(k.content, un))
    expect(stackPart(k.content, st)!.id).toBe('unreg:u1')
    // 都不是
    expect(stackPart(k.content, { id: UNREG_STACK_ID, qty: 1, data: { uid: 'u1', part: { ...un, uid: undefined } } })).toBeUndefined()
    expect(stackPart(k.content, { id: UNREG_STACK_ID, qty: 1 })).toBeUndefined()
    expect(stackPart(k.content, { id: 'it_stim', qty: 1 })).toBeUndefined()
    expect(stackPart(k.content, undefined)).toBeUndefined()
    // 內嵌的 data.part 壞了、stack.id 剛好是內容的零件：照 stack.id 查
    expect(stackPart(k.content, { id: 'pt_plate1', qty: 1, data: { part: { nope: 1 } } })!.id).toBe('pt_plate1')

    // 來回
    expect(partStack('pt_plate1')).toEqual({ id: 'pt_plate1', qty: 1 })
    const back = partStack(un)
    expect(back).toEqual({ id: UNREG_STACK_ID, qty: 1, data: { uid: 'u1', part: un } })
    expect(stackPart(k.content, back)).toEqual(partOf(k.content, un))
    expect(stackPart(k.content, partStack('pt_plate1'))).toEqual(partOf(k.content, 'pt_plate1'))
    // 複本：改了放回背包的那一疊，原本的零件不變
    ;(back.data!.part as InlinePart).stats.armor = 99
    expect(un.stats.armor).toBe(2)
    // 拆下來再裝回去：成品算出來一樣
    const data = arm({ plate: un, actuator: 'pt_act', neuron: 'pt_neuron' })
    const refBack = stackPart(k.content, partStack(un))!
    expect(refBack.stats).toEqual(partOf(k.content, un)!.stats)
    expect(productOf(k.content, 'bp_arm', data)!.stats).toEqual(productOf(k.content, 'bp_arm', arm({ plate: (partStack(un).data as { part: InlinePart }).part, actuator: 'pt_act', neuron: 'pt_neuron' }))!.stats)
  })

  it('帶 bridge 的內嵌零件被擋下；partsOf 不認得壞的引用', () => {
    const k = kernel()
    expect(inlinePartProblems(k.content, { ...inline('u1'), bridge: { capacity: 10, split: { meat: 8 } } }).join('')).toMatch(/bridge/)
    expect(partsOf(k.content, { parts: { plate: ['pt_plate1', 'pt_ghost', 3, null, { ...inline('u1'), bridge: {} }] } }).map((x) => x.part.id)).toEqual(['pt_plate1'])
    expect(partsOf(k.content, { parts: 'oops' })).toEqual([])
    expect(partsOf(k.content, undefined)).toEqual([])
  })
})
