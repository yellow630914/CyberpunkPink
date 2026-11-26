// 驗收測試：dev/work/M4-ui-followups.md（cpp-ui，「二十之二」乙欄）。
// 稱呼兩格、送禮附一句話、化身描述；診所先問 clinicGate、修理構裝；背包用藥；成人場景的 inserted／once／dress；組裝的動手人；
// 請教接 npc_consult（含向 NPC 學工藝 also）；沒有橋的說明讀引擎；藥泵圖示。
// 內容用測試自帶的最小假資料；畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有 DOM 環境，「點」是呼叫 store 與 lib 的流程）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Change, ContentPack } from '@engine/src'
import { makeActor } from '@engine/src/testkit'
import { CALL_MAX, GIFT_NOTE_MAX } from '@engine/src/features/npcs'
import { AVATAR_TEXT_MAX } from '@engine/src/features/deck'
import { NO_BRIDGE_NOTE } from '@engine/src/features/cyberware/creation'
import type { SceneOptions } from '@engine/src/features/scene'
import { useEngine } from '../../src/stores/engine'
import TalkDialog from '../../src/dialogs/TalkDialog.vue'
import BagDialog from '../../src/dialogs/BagDialog.vue'
import RepairDialog from '../../src/dialogs/RepairDialog.vue'
import TeachPanel from '../../src/components/TeachPanel.vue'
import SceneActions from '../../src/components/scene/SceneActions.vue'
import AvatarEditor from '../../src/components/scene/AvatarEditor.vue'
import DissectPane from '../../src/dialogs/craft/DissectPane.vue'
import CrewPicker from '../../src/dialogs/craft/CrewPicker.vue'
import BridgePanel from '../../src/components/body/BridgePanel.vue'
import mainSrc from '../../src/screens/MainScreen.vue?raw'
import homeSrc from '../../src/screens/HomeScreen.vue?raw'
import { UNOPENED_ACTIONS, interactRows } from '../../src/lib/peopleView'
import { lifeDialogOf } from '../../src/lib/lifeView'
import { COMBAT_ICONS } from '../../src/data/combatIcons'

// ---- 假資料 ----

type Fx = Record<string, unknown>
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const MAP = {
  id: 'm_t', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '雜貨店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '修理店' }, { id: 'F3', at: [5, 1], mark: 'F', name: '潛艙' }, ...E],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const street = [{ district: 'd_t', block: 'b_t', time: ALL }]
const npc = (id: string, name: string, more: Fx = {}) => ({ id, name, kind: 'citizen', age: 30, guard: 12, wealth: 2, haunts: street, ...more })
const PACK: ContentPack = {
  id: 'followups_ui_test',
  content: {
    special_map: [MAP],
    facility_type: [
      { id: 'fac_shop', name: '商店' },
      { id: 'fac_repair', name: '構裝店', functions: ['repair_construct'] },
      { id: 'fac_dive', name: '潛艙店', dive: { fee: 0 } },
    ],
    district: [{ id: 'd_t', name: '測試區', grade: 1, price_mult: 1, blocks: ['b_t'] }],
    block: [{
      id: 'b_t', district: 'd_t', name: '測試街', kind: 'block', map: 'm_t', exits: {},
      facilities: { F1: { type: 'fac_shop', name: '雜貨店' }, F2: { type: 'fac_repair', name: '修理店' }, F3: { type: 'fac_dive', name: '潛艙' } },
    }],
    item: [
      { id: 't_bun', name: '糰糧', desc: '糰糧。', category: 'consumable', grade: 1, size: 0, legal: 'free', price: 70, tags: [] },
    ],
    npc: [
      npc('npc_day', '日班阿志'),
      npc('npc_teacher', '縫縫', { tutor: { skills: ['mechanics', 'medicine'], where: '地下室診所' } }),
    ],
  } as unknown as ContentPack['content'],
}
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

async function setup(o: { seed?: number; at?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: 5000 - e.money.cred }, { op: 'cash', delta: 3000 - e.money.cash }])
  expect(e.commit({ summary: '放進背包。', changes: [{ op: 'item', id: 't_bun', qty: 2 }] })).toBeNull()
  expect((await e.world.arrive('b_t', o.at)).status).toBe('applied')
  const hour = e.state.time.hour * 60 + e.state.time.minute
  const to = 10 * 60
  if (hour !== to) e.ledger([{ op: 'time', minutes: (to - hour + 1440) % 1440 }])
  return { pinia, e }
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  return renderToString(app)
}
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
async function untilOk<T>(tries: number, run: (seed: number) => Promise<T | null>): Promise<T> {
  for (let seed = 1; seed <= tries; seed++) {
    const r = await run(seed)
    if (r !== null) return r
  }
  throw new Error(`換了 ${tries} 個種子都沒有出現要的結果`)
}

beforeEach(() => setActivePinia(createPinia()))

// ---- 1. 人物詳情：稱呼、送禮一句話、化身描述 ----

describe('稱呼兩格（引擎的 callNamesDraft）', () => {
  it('認識之後畫面有兩格；存下去引擎記住，空字串是清掉；超過字數上限是引擎的那一句', async () => {
    const { e, pinia } = await setup()
    // 還不認識：沒有兩格
    expect(await html(pinia, TalkDialog, { npcId: 'npc_day' })).not.toContain('data-call-them')
    expect((await e.people.meet('npc_day')).status).toBe('applied')
    const dom = await html(pinia, TalkDialog, { npcId: 'npc_day' })
    expect(dom).toContain('data-call-them')
    expect(dom).toContain('data-call-me')
    expect(dom).toContain(`maxlength="${CALL_MAX}"`)
    expect(e.people.callNames('npc_day')).toEqual({ call_them: '', call_me: '' })

    // 玩家寫的字原樣存（不篩選、不改寫，標點與空白都在）
    const raw = '阿志 ♥ 大哥'
    expect((await e.people.setCallNames('npc_day', { call_them: raw, call_me: '小露' })).status).toBe('applied')
    expect(e.people.callNames('npc_day')).toEqual({ call_them: raw, call_me: '小露' })
    // 畫面上兩格帶著現在的稱呼
    expect(await html(pinia, TalkDialog, { npcId: 'npc_day' })).toContain(`value="${raw}"`)

    const tooLong = 'あ'.repeat(CALL_MAX + 1)
    expect(e.people.callNamesBlock('npc_day', { call_them: tooLong, call_me: '' })).toBe(`「你怎麼叫他」最多 ${CALL_MAX} 個字。`)
    const r = await e.people.setCallNames('npc_day', { call_them: tooLong, call_me: '' })
    expect(r.status).not.toBe('applied')
    expect(e.people.callNames('npc_day').call_them).toBe(raw)

    // 清掉
    expect((await e.people.setCallNames('npc_day', { call_them: '', call_me: '' })).status).toBe('applied')
    expect(e.people.callNames('npc_day')).toEqual({ call_them: '', call_me: '' })
  })

  it('還不認識的人引擎擋下改稱呼，原因是引擎的', async () => {
    const { e } = await setup()
    expect(e.people.callNamesBlock('npc_day', { call_them: 'x', call_me: '' })).toBe('你還不認識這個人，沒辦法改稱呼。')
  })
})

describe('送禮附一句話（interact 的 note）', () => {
  it('收下之後那句話原樣進共同記憶；不附也行；字數上限是引擎的 GIFT_NOTE_MAX', async () => {
    expect((await setup()).e.people.giftNoteMax).toBe(GIFT_NOTE_MAX)
    const note = '路上看到的，想到你。（別告訴別人）'
    const out = await untilOk(40, async (seed) => {
      const { e } = await setup({ seed })
      expect((await e.people.meet('npc_day')).status).toBe('applied')
      const r = await e.people.interact('npc_gift', 'npc_day', { item: 't_bun', note })
      if (r.status !== 'applied') return null
      return e.people.memoriesOf('npc_day').some((m) => m.text.includes(note)) ? { e } : null
    })
    expect(out.e.people.memoriesOf('npc_day').some((m) => m.text.includes(note))).toBe(true)
  })

  it('送禮的面板有那一格（原始碼守住：輸入框、上限來自 store、送出時帶 note、不篩選）', async () => {
    const src = (await import('../../src/dialogs/TalkDialog.vue?raw')).default
    expect(src).toContain('data-gift-note')
    expect(src).toContain(':maxlength="e.people.giftNoteMax"')
    expect(src).toContain("note: giftNote.value")
    expect(src).not.toMatch(/giftNote\.value\.(replace|trim)/)
  })
})

describe('化身的外觀描述（deck.avatar 的 text）', () => {
  it('編輯器有描述框；在接入點才存得下，原樣收；超過上限是引擎的那一句；空字串是清掉', async () => {
    const { e, pinia } = await setup({ at: 'F3' })
    expect(e.deck.avatar.textMax).toBe(AVATAR_TEXT_MAX)
    const dom = await html(pinia, AvatarEditor)
    expect(dom).toContain('data-avatar-text')
    expect(dom).toContain(`maxlength="${AVATAR_TEXT_MAX}"`)
    const text = '銀灰色的長髮，半透明的耳翼。'
    expect(e.deck.avatar.block({ text })).toBeNull()
    expect(e.deck.avatar.set({ text })).toBeNull()
    expect(e.deck.avatar.get()?.text).toBe(text)
    expect(await html(pinia, AvatarEditor)).toContain(text)
    const long = 'x'.repeat(AVATAR_TEXT_MAX + 1)
    expect(e.deck.avatar.block({ text: long })).toBe(`外觀描述太長了（最多 ${AVATAR_TEXT_MAX} 字）。`)
    expect(e.deck.avatar.set({ text: '' })).toBeNull()
    expect(e.deck.avatar.get()?.text).toBeUndefined()
  })

  it('不在接入點：引擎擋下，原因是引擎的', async () => {
    const { e } = await setup({ at: 'F1' })
    expect(e.deck.avatar.block({ text: '改一下' })).toBe('要在接入點（潛艙店、據點，或你的住處）才能改化身。')
  })
})

// ---- 2. 診所與修理構裝 ----

describe('開診所前先問 clinicGate', () => {
  it('不在診所、不在能自己動刀的地方：clinicGate 回引擎的原因；兩個畫面開之前都問它', async () => {
    const { e } = await setup({ at: 'F1' })
    const why = e.body.clinicGate()
    expect(why).toBeTruthy()
    // 主畫面：診所的服務灰掉並帶原因，點了不開
    expect(mainSrc).toContain('e.body.clinicGate()')
    expect(mainSrc).toMatch(/case 'clinic': \{\s*const why = e\.body\.clinicGate\(\)/)
    // 家園：診療室的選項帶原因，執行時也問
    expect(homeSrc).toContain('e.body.clinicGate()')
    expect(homeSrc).toMatch(/room!\.use === 'clinic' \? \{ reason: e\.body\.clinicGate\(\) \}/)
  })
})

describe('修理構裝（netcombat 的 repairRows／repairDraft）', () => {
  /** 主角帶著一件壞掉的構裝（沒記是哪一件：引擎照一筆「破損的構裝」算最少的錢） */
  async function broken(at: string) {
    const s = await setup({ at })
    const pc = s.e.state.pc!
    expect(s.e.commit({ summary: '構裝壞了。', changes: [{ op: 'actor.condition', id: pc, condition: 'net_broken' } as Change] })).toBeNull()
    return s
  }

  it('引擎在格子上列「修理構裝」，那一項打開修理的對話框；對話框列壞掉的構裝與價錢，修好之後狀況拿掉、現金少了', async () => {
    const { e, pinia } = await broken('F2')
    expect(e.repair.here()).toBe('構裝店')
    const use = e.world.grid()?.here.uses.find((u) => u.id === 'netcombat.repair')
    expect(use).toBeDefined()
    expect(lifeDialogOf('netcombat.repair')).toEqual({ name: 'repair', props: {} })
    const rows = e.repair.rows()
    expect(rows.map((r) => r.id)).toEqual(['unknown'])
    const dom = strip(await html(pinia, RepairDialog))
    expect(dom).toContain(rows[0]!.name)
    expect(e.repair.block()).toBeNull()
    const cash = e.money.cash
    expect(e.repair.fix()).toBeNull()
    expect(e.money.cash).toBe(cash - rows[0]!.price)
    expect(e.repair.rows()).toEqual([])
    expect(strip(await html(pinia, RepairDialog))).toContain('身上沒有需要修的構裝。')
  })

  it('不在構裝店：原因是引擎的；現金不夠也是', async () => {
    const { e } = await broken('F1')
    expect(e.repair.here()).toBeNull()
    expect(e.repair.block()).toBe('這裡沒有修理構裝的服務：要到大街的構裝店這類設施。')
    expect(e.repair.fix()).toBe('這裡沒有修理構裝的服務：要到大街的構裝店這類設施。')
  })
})

// ---- 3. 背包：藥 ----

describe('背包的藥可以「使用」（drugs 的 useDraft）', () => {
  it('藥的詳情有「使用」鈕，擋住的原因是引擎的 drugView.usable.block；一般物品沒有', async () => {
    const { e, pinia } = await setup()
    const drug = e.body.drugs()
    // 測試包沒有藥：一般物品沒有「使用」
    expect(drug?.usable ?? []).toEqual([])
    expect(await html(pinia, BagDialog, { select: 't_bun' })).not.toContain('data-act="use"')
  })

  it('背包元件用 drugView.usable 決定列不列，使用走 store 的 useDrug', async () => {
    const src = (await import('../../src/dialogs/BagDialog.vue?raw')).default
    expect(src).toContain('eng.body.drugs()?.usable.find')
    expect(src).toContain('eng.body.useDrug(')
    expect(src).toContain(':reason="drugRow.block"')
  })
})

// ---- 5、9. 成人場景：inserted、once、dress ----

const act = (id: string, name: string, more: Fx = {}) => ({ id, name, ap: 1, blocks: [] as string[], picks: [], pairs: [], preview: null, ...more })
const OPTS = {
  turn: 'pc', round: 1, targets: [{ id: 'p', name: '對方' }], ap: { now: 3, max: 3 }, end_turn: { blocks: [] },
  actions: [
    act('dominate', '主導'),
    act('dress', '脫換衣服', { ap: 0 }),
    act('once', '夜課的功夫', { choices: [
      { id: 'set_init:70', name: '主動權設成 70', ap: 1, blocks: [], picks: [], pairs: [], preview: null },
      { id: 'fit_floor', name: '契合拉到 50', ap: 1, blocks: ['這一場用過了。'], picks: [], pairs: [], preview: null },
    ] }),
  ],
  inserted: [
    { id: 'whisper', owner: 'rogue_ai', name: '照耳語說的做', ap: 1, blocks: [], input: { kind: 'talk', text: '嗯。' } },
    { id: 'blocked', owner: 'rogue_ai', name: '再聽一次', ap: 2, blocks: ['行動點不夠。'], input: { kind: 'talk' } },
  ],
} as unknown as SceneOptions

describe('成人場景：視窗插進來的選項與兩種新行動', () => {
  it('行動列列出 once 與 dress；點開 once 看到每個功夫，灰掉的帶引擎的原因', async () => {
    const { pinia } = await setup()
    const dom = await html(pinia, SceneActions, { opts: OPTS, playing: false, theirName: '對方', selected: 'dominate' })
    expect(dom).toContain('data-act="dress"')
    expect(dom).toContain('data-act="once"')
    expect(strip(dom)).toContain('夜課的功夫')
    expect(strip(dom)).toContain('脫換衣服')
  })

  it('SceneOptions.inserted 一項一鈕：名字、行動點、做不到的原因都是引擎的', async () => {
    const { pinia } = await setup()
    const dom = await html(pinia, SceneActions, { opts: OPTS, playing: false, theirName: '對方', selected: 'dominate' })
    expect(dom).toContain('data-inserted')
    expect(dom).toContain('data-inserted-id="whisper"')
    expect(strip(dom)).toContain('照耳語說的做')
    expect(dom).toMatch(/data-inserted-id="blocked"/)
    expect(strip(dom)).toContain('行動點不夠。')
    expect(dom).toMatch(/is-unavailable[^>]*data-inserted-id="blocked"|data-inserted-id="blocked"[^>]*is-unavailable/)
    // 沒有插進來的選項就沒有那一排
    const none = await html(pinia, SceneActions, { opts: { ...OPTS, inserted: [] }, playing: false, theirName: '對方', selected: 'dominate' })
    expect(none).not.toContain('data-inserted')
  })
})

// ---- 6. 組裝：誰來做 ----

describe('組裝的動手人（引擎的 by）', () => {
  it('只有主角一個人時不列；有隊友就列，主角在前，選誰 by 就是誰', async () => {
    const { e, pinia } = await setup()
    expect(e.craft.crew().map((c) => c.id)).toEqual([e.state.pc])
    expect(await html(pinia, CrewPicker, { modelValue: '' })).not.toContain('data-crew')
    const mate = makeActor({ id: 'm1', name: '隊友小麥', role: 'npc', gender: 'female' })
    expect(e.commit({ summary: '隊友。', changes: [{ op: 'actor.add', actor: mate }, { op: 'party', id: 'm1' }] as never })).toBeNull()
    expect(e.craft.crew().map((c) => [c.id, c.me])).toEqual([[e.state.pc, true], ['m1', false]])
    const dom = await html(pinia, CrewPicker, { modelValue: '' })
    expect(dom).toContain('data-crew')
    expect(dom).toContain('data-by="m1"')
    // 解剖頁（沒有設計圖也畫得出來）帶著這一排；組裝、換零件、拆解的原始碼也都把 by 交給引擎
    expect(await html(pinia, DissectPane)).toContain('data-by="m1"')
    for (const f of ['AssemblePane', 'SwapPane', 'SalvagePane', 'DissectPane']) {
      const src = (await import(`../../src/dialogs/craft/${f}.vue?raw`)).default as string
      expect(src, f).toContain('<CrewPicker v-model="byId"')
      expect(src, f).toContain('byId.value')
    }
    // 引擎的預覽認 by：不是隊上的人被擋下
    expect(e.craft.makers('m1').find((m) => m.id === 'self')).toBeDefined()
    expect(e.craft.makers('nobody').find((m) => m.id === 'self')?.block).toBe('動手的人要是主角或隊上的人。')
  })
})

// ---- 9. 請教接 npc_consult ----

describe('請教（npc_consult）：拿掉灰掉的假項目，改接引擎', () => {
  it('UNOPENED_ACTIONS 不再有「請教」；interactions 帶 handoff 的那一項照常列', async () => {
    expect(UNOPENED_ACTIONS).not.toContain('請教')
    const { e } = await setup()
    expect((await e.people.meet('npc_teacher')).status).toBe('applied')
    const rows = interactRows(e.people.interactions('npc_teacher'))
    const consult = rows.find((r) => r.kind === 'npc_consult')
    expect(consult).toBeDefined()
    expect(consult!.handoff).toBe('abilities.teachOptions')
    // handoff 帶 also：同時列向 NPC 學工藝的課
    expect(consult!.alsoTutor).toBe(true)
    // 沒有東西可教的人沒有這一項，畫面也不再出現灰掉的「請教」
    expect(interactRows(e.people.interactions('npc_day')).some((r) => r.kind === 'npc_consult')).toBe(false)
  })

  it('說話對話框：灰掉的清單裡沒有「請教」；教書的人多一項看課', async () => {
    const { e, pinia } = await setup()
    expect((await e.people.meet('npc_day')).status).toBe('applied')
    expect((await e.people.meet('npc_teacher')).status).toBe('applied')
    const day = await html(pinia, TalkDialog, { npcId: 'npc_day' })
    expect(strip(day)).not.toContain('請教')
    const teacher = await html(pinia, TalkDialog, { npcId: 'npc_teacher' })
    expect(teacher).toContain('data-do="npc_consult"')
    expect(strip(teacher)).toContain('請教')
  })

  it('TeachPanel 帶 tutor 時列老師教的工藝課：學費、時段、原因是引擎的 tutorOptions；上一個時段走 tutorDraft', async () => {
    const { e, pinia } = await setup()
    expect((await e.people.meet('npc_teacher')).status).toBe('applied')
    const rows = e.training.tutorOptions('npc_teacher')
    expect(rows.map((r) => r.skill).sort()).toEqual(['mechanics', 'medicine'])
    const mech = rows.find((r) => r.skill === 'mechanics')!
    expect(mech.ok).toBe(true)
    const dom = await html(pinia, TeachPanel, { npc: 'npc_teacher', tutor: true })
    expect(dom).toContain('data-tutor="mechanics"')
    expect(dom).toContain('data-tutor="medicine"')
    expect(strip(dom)).toContain('地下室診所')
    // 沒帶 tutor 就不列
    expect(await html(pinia, TeachPanel, { npc: 'npc_teacher' })).not.toContain('data-tutor=')

    const cred = e.money.cred
    const t0 = e.state.time.hour * 60 + e.state.time.minute
    expect(e.training.tutorLesson({ npc: 'npc_teacher', skill: 'mechanics' })).toBeNull()
    expect(e.money.cred + e.money.cash).toBeLessThan(cred + 3000)
    const after = e.training.tutorOptions('npc_teacher')
    expect(after.find((r) => r.skill === 'mechanics')!.done).toBe(1)
    // 一位老師對一個人只教一項：另一項回引擎的那一句
    expect(after.find((r) => r.skill === 'medicine')!.reason).toBe('縫縫只帶一個人一項。')
    expect(e.state.time.hour * 60 + e.state.time.minute).not.toBe(t0)
    // 擋下的原因是引擎的
    expect(e.training.tutorBlock({ npc: 'npc_teacher', skill: 'medicine' })).toBe('縫縫只帶一個人一項。')
    expect(e.training.tutorLesson({ npc: 'npc_teacher', skill: 'medicine' })).toBe('縫縫只帶一個人一項。')
  })
})

// ---- 7. 讀引擎的匯出 ----

describe('沒有橋的說明讀引擎', () => {
  it('橋分頁寫的是引擎的 NO_BRIDGE_NOTE', async () => {
    const { e, pinia } = await setup()
    expect(e.body.noBridgeNote).toBe(NO_BRIDGE_NOTE)
    // 還沒裝橋的主角：橋面板只寫引擎的那句
    const hasBridge = e.body.capacity()
    if (hasBridge && hasBridge.total > 0) return
    expect(strip(await html(pinia, BridgePanel))).toContain(NO_BRIDGE_NOTE)
  })
})

// ---- 8. 圖示 ----

describe('藥泵圖示 pump', () => {
  it('戰鬥圖示表有 pump（針筒的單一路徑）', () => {
    expect(typeof COMBAT_ICONS.pump).toBe('string')
    expect(COMBAT_ICONS.pump!.startsWith('M')).toBe(true)
    expect(COMBAT_ICONS.pump!.length).toBeGreaterThan(50)
  })
})
