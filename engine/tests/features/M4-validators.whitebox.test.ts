// 白箱：M4 新增的內容種類的格式檢查（*Problems）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：GAME_DESIGN 第 3 節（內容與 AI 交的結果先驗格式再寫入，格式錯的擋下、說出是哪一欄）；
// 各內容種類的格式見 dev/work/M4-*.md；LEWD_SYSTEM 3、6、7 節；CYBERWARE 第 5 節；ITEMS 4.1；CRAFTING 第 5 節；DOWNTIME 4.1。
// 做法：每個檢查函式先給一筆合格的（問題是空的），再逐欄壞掉；每一條壞法要擋下，而且那句話提到出問題的欄位。
// 內容一律用測試自帶的最小資料。

import { describe, expect, it } from 'vitest'
import { battleProblems } from '../../src/features/cyberware/battleDef'
import { lockProblems } from '../../src/features/cyberware/lock'
import { entryProblems as lifepathEntryProblems, resultProblems } from '../../src/features/creation/lifepath'
import { houseProblems, lotProblems, bidderProblems, npcRefProblems, facilityProblems } from '../../src/features/auction/model'
import { entryProblems as lureEntryProblems } from '../../src/features/lure/model'
import { entryProblems as malwareEntryProblems } from '../../src/features/malware/model'
import { drugProblems } from '../../src/features/drugs/model'
import { entryProblems as tuningEntryProblems } from '../../src/features/tuning/model'
import { presetProblems } from '../../src/features/unreg/model'
import { jobProblems } from '../../src/features/work/model'
import { nightProblems, tableProblems } from '../../src/features/curtain/model'
import { soloPoseProblems } from '../../src/features/scene/model'
import { nightFieldProblems, resonanceProblems } from '../../src/features/scene/night'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, unknown>
/** 一份合格的，壞掉的欄位疊上去；回傳問題。 */
const bad = (fn: (e: Rec) => string[], base: Rec, patch: Rec): string[] => fn({ ...base, ...patch })
/** 壞法清單：[說明, 疊上去的欄位, 問題要提到的字]；欄位寫 undefined 的是「拿掉那一欄」。 */
type Case = [string, Rec, RegExp]
function table(name: string, fn: (e: Rec) => string[], base: Rec, cases: Case[]): void {
  describe(name, () => {
    it('合格的一筆沒有問題', () => {
      expect(fn(base)).toEqual([])
    })
    for (const [what, patch, re] of cases) {
      it(`${what}：擋下並提到欄位`, () => {
        const p = bad(fn, base, patch)
        expect(p.length, JSON.stringify(patch)).toBeGreaterThan(0)
        expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
      })
    }
  })
}

// ---- 調校（tuning）：ITEMS 4.1／CYBERWARE 第 5 節的怪癖與調校；dev/work/M4-tuning.md ----

table('tuning entryProblems（內容種類 tuning 的格式）', tuningEntryProblems, { name: '靜音', desc: '耳鳴消失。', effects: [] }, [
  ['沒有 name', { name: undefined }, /name/],
  ['沒有 desc', { desc: 3 }, /desc/],
  ['effects 不是陣列', { effects: {} }, /effects/],
  ['requires 不是物件', { requires: 'axis' }, /requires/],
  ['requires 多一個欄位', { requires: { level: 1 } }, /requires 沒有 level/],
  ['requires.tag 是空字串', { requires: { tag: '' } }, /requires\.tag/],
  ['requires.axis 不是物件', { requires: { axis: 3 } }, /requires\.axis 要是/],
  ['requires.axis 的軸不認得', { requires: { axis: { nope: 1 } } }, /軸 nope/],
  ['requires.axis 的等級是 101', { requires: { axis: { body: 101 } } }, /requires\.axis\.body/],
  ['requires.axis 的等級是小數', { requires: { axis: { body: 1.5 } } }, /requires\.axis\.body/],
  ['tags 不是字串陣列', { tags: [1] }, /tags/],
  ['price 是負的', { price: -1 }, /price/],
  ['price 超過 1000000', { price: 1_000_001 }, /price/],
  ['flags 不是陣列', { flags: 'x' }, /flags/],
  ['flags 的開關不在清單裡', { flags: ['no_such_flag'] }, /flags：「no_such_flag」/],
  ['scene 不是物件', { scene: 1 }, /scene 要是/],
  ['scene 多一個欄位', { scene: { tone: 1 } }, /scene 沒有 tone/],
  ['scene.sensitivity 不是物件', { scene: { sensitivity: [] } }, /scene\.sensitivity 要是/],
  ['scene.sensitivity 的值不是有限數字', { scene: { sensitivity: { mouth: Infinity } } }, /scene\.sensitivity\.mouth/],
  ['多一個沒有的欄位', { color: 'red' }, /沒有 color/],
])

// ---- 惡意韌體（malware）：LEWD_SYSTEM 第 6 節／ITEMS；dev/work/M4-malware.md ----

const STAGES_OK = { latent: { effects: [] }, active: { effects: [] }, spread: { effects: [] } }
table('malware entryProblems（內容種類 malware 的格式）', malwareEntryProblems, { name: '低語', desc: '耳邊有聲音。', stages: STAGES_OK }, [
  ['沒有 name', { name: '' }, /name/],
  ['沒有 desc', { desc: undefined }, /desc/],
  ['tags 不是字串陣列', { tags: 'x' }, /tags/],
  ['pool 不是陣列', { pool: 'any' }, /pool 要是/],
  ['pool 裡有不在清單的來源', { pool: ['nowhere'] }, /pool：「nowhere」/],
  ['stages 不是物件', { stages: [] }, /stages 要是/],
  ['stages 多一個階段', { stages: { ...STAGES_OK, late: { effects: [] } } }, /stages 沒有 late/],
  ['少一個階段', { stages: { latent: { effects: [] }, active: { effects: [] } } }, /stages\.spread 要寫/],
  ['階段多一個欄位', { stages: { ...STAGES_OK, latent: { effects: [], speed: 1 } } }, /stages\.latent 沒有 speed/],
  ['階段的 effects 不是陣列', { stages: { ...STAGES_OK, active: { effects: 'x' } } }, /stages\.active\.effects/],
  ['階段的 trigger 是空字串', { stages: { ...STAGES_OK, active: { effects: [], trigger: '' } } }, /stages\.active\.trigger/],
  ['every_days 超過 365', { stages: { ...STAGES_OK, active: { effects: [], trigger: 't', every_days: 366 } } }, /every_days 要是 1～365/],
  ['every_days 沒有 trigger', { stages: { ...STAGES_OK, active: { effects: [], every_days: 3 } } }, /every_days 要和 trigger 一起寫/],
  ['階段的 flags 不是陣列', { stages: { ...STAGES_OK, active: { effects: [], flags: 'x' } } }, /flags 要是開關的陣列/],
  ['階段的 flags 不在清單', { stages: { ...STAGES_OK, active: { effects: [], flags: ['zzz'] } } }, /flags：「zzz」/],
  ['stage_days 只有一個數字', { stage_days: [3] }, /stage_days/],
  ['stage_days 超過 3650', { stage_days: [1, 3651] }, /stage_days/],
  ['clean_dc 不是三個數字', { clean_dc: [1, 2] }, /clean_dc/],
  ['clean_dc 超過 40', { clean_dc: [1, 2, 41] }, /clean_dc/],
  ['on_clean 不是物件的陣列', { on_clean: [1] }, /on_clean/],
  ['多一個欄位', { speed: 3 }, /沒有 speed/],
])

// ---- 流竄 AI 的誘惑（lure）：LEWD_SYSTEM 第 6 節／ENEMIES 第 9 節；dev/work/M4-lure.md ----

const LORE_OK = { a: '一句', b: '二句', c: '三句', d: '四句' }
describe('lure entryProblems（內容種類 rogue_ai 的格式）', () => {
  const base = { name: '媽咪', filter: 'ai:媽咪', lore: LORE_OK }
  it('合格的一筆（lore 的四格名字照內建的）', () => {
    const p = lureEntryProblems({ ...base, lore: {} })
    expect(p.join('|')).toMatch(/lore\./)
    // 四格的名字從錯誤訊息取，再填滿
    const slots = [...new Set(p.map((m) => /lore\.(\S+) 要是一句話/.exec(m)?.[1]).filter((x): x is string => !!x))]
    expect(slots.length).toBe(4)
    const lore = Object.fromEntries(slots.map((s) => [s, '一句話']))
    expect(lureEntryProblems({ ...base, lore })).toEqual([])
    // 之後的案例都用這四格
    const cases: Case[] = [
      ['沒有 name', { name: 5 }, /name/],
      ['tag 是空字串', { tag: '' }, /tag/],
      ['axis 不認得', { axis: 'zzz' }, /axis/],
      ['filter 沒寫', { filter: undefined }, /filter/],
      ['kiss 不是字串', { kiss: 3 }, /kiss/],
      ['whisper 不是物件', { whisper: 'hi' }, /whisper 要是/],
      ['whisper 多一個欄位', { whisper: { label: 'x', free: 'y', loud: 1 } }, /whisper\.loud/],
      ['whisper.label 沒寫', { whisper: { free: 'y' } }, /whisper\.label/],
      ['whisper.free 是空字串', { whisper: { label: 'x', free: '' } }, /whisper\.free/],
      ['whisper.scene 的 kind 不認得', { whisper: { label: 'x', scene: { kind: 'zzz' } } }, /whisper\.scene/],
      ['whisper.replace_chance 大於 1', { whisper: { label: 'x', free: 'y', replace_chance: 1.1 } }, /replace_chance/],
      ['whisper.replace_chance 是 NaN', { whisper: { label: 'x', free: 'y', replace_chance: NaN } }, /replace_chance/],
      ['whisper.why 是空字串', { whisper: { label: 'x', free: 'y', why: '' } }, /whisper\.why/],
      ['whisper 沒有 free 也沒有 scene', { whisper: { label: 'x' } }, /free 或 scene/],
      ['lore 不是物件', { lore: [] }, /lore 要是/],
      ['lore 多一格', { lore: { ...lore, extra: 'x' } }, /lore 沒有 extra/],
      ['多一個欄位', { speed: 1 }, /沒有 speed/],
    ]
    for (const [what, patch, re] of cases) {
      const q = lureEntryProblems({ ...base, lore, ...patch })
      expect(q.length, what).toBeGreaterThan(0)
      expect(q.some((m) => re.test(m)), `${what}：${q.join(' | ')}`).toBe(true)
    }
  })
})

// ---- 藥（drug 欄位）：ITEMS 4.1／DOWNTIME 第 3 節；dev/work/M4-drugs.md ----

const NOOP_CHECK = { passive: (_v: unknown, _p: string) => [] as string[], effects: (_v: unknown, _p: string) => [] as string[] }
describe('drugProblems（物品的 drug 欄位）', () => {
  const run = (raw: unknown, check = NOOP_CHECK) => drugProblems(raw, check)
  const base = { duration: { minutes: 30 } }
  it('合格的一筆沒有問題；不是物件的擋下', () => {
    expect(run(base)).toEqual([])
    expect(run(7)).toEqual(['drug 要是物件'])
    expect(run(null)).toEqual(['drug 要是物件'])
  })
  const cases: Array<[string, unknown, RegExp]> = [
    ['多一個欄位', { ...base, potency: 3 }, /drug\.potency/],
    ['duration 不是物件', { duration: 30 }, /drug\.duration 要是/],
    ['duration 多一個欄位', { duration: { minutes: 30, hours: 1 } }, /drug\.duration\.hours/],
    ['duration.battle 寫 false', { duration: { battle: false } }, /battle 只能寫 true/],
    ['duration.minutes 是 0', { duration: { minutes: 0 } }, /duration\.minutes/],
    ['duration.minutes 超過 525600', { duration: { minutes: 525_601 } }, /duration\.minutes/],
    ['duration 沒寫 minutes 也不是 battle', { duration: {} }, /要寫 minutes，或寫 battle/],
    ['upkeep_load 是 101', { ...base, upkeep_load: 101 }, /upkeep_load/],
    ['instant 不是陣列', { ...base, instant: {} }, /instant 要是效果的陣列/],
    ['instant 裡又寫 drug（吃一劑會繞圈）', { ...base, instant: [{ kind: 'drug' }] }, /不能再寫 drug/],
    ['after 不是物件', { ...base, after: 5 }, /drug\.after 要是/],
    ['after 多一個欄位', { ...base, after: { minutes: 5, effects: [], zzz: 1 } }, /drug\.after\.zzz/],
    ['after.minutes 是 0', { ...base, after: { minutes: 0, effects: [] } }, /after\.minutes/],
    ['after 只有 effects 沒有 minutes', { ...base, after: { effects: [] } }, /after\.effects 要搭配/],
    ['after 只有 minutes 沒有 effects', { ...base, after: { minutes: 5 } }, /after\.minutes 要搭配/],
    ['after 什麼都沒寫', { ...base, after: {} }, /after 要寫 effects/],
    ['addiction 不是物件', { ...base, addiction: 1 }, /drug\.addiction 要是/],
    ['addiction 多一個欄位', { ...base, addiction: { per_dose: 5, withdrawal: { days: 3 }, zzz: 1 } }, /addiction\.zzz/],
    ['addiction.per_dose 是 101', { ...base, addiction: { per_dose: 101, withdrawal: { days: 3 } } }, /per_dose/],
    ['addiction.per_dose 是負的', { ...base, addiction: { per_dose: -1, withdrawal: { days: 3 } } }, /per_dose/],
    ['addiction.withdrawal 沒寫', { ...base, addiction: { per_dose: 5 } }, /withdrawal 要是/],
    ['withdrawal 多一個欄位', { ...base, addiction: { per_dose: 5, withdrawal: { days: 3, zzz: 1 } } }, /withdrawal\.zzz/],
    ['withdrawal.days 是 0', { ...base, addiction: { per_dose: 5, withdrawal: { days: 0 } } }, /withdrawal\.days/],
    ['withdrawal.days 是 366', { ...base, addiction: { per_dose: 5, withdrawal: { days: 366 } } }, /withdrawal\.days/],
    ['suppressant 不是布林', { ...base, suppressant: 1 }, /suppressant 要是 true 或 false/],
    ['needs_bridge 不是布林', { ...base, needs_bridge: 'yes' }, /needs_bridge/],
  ]
  for (const [what, raw, re] of cases) {
    it(`${what}：擋下並提到欄位`, () => {
      const p = run(raw)
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
  it('被動效果與效果的檢查交給呼叫的人：他回的問題原樣帶出來（effects、side、after.effects、withdrawal.effects 各一條路徑）', () => {
    const seen: string[] = []
    const check = { passive: (_v: unknown, path: string) => { seen.push(path); return [`${path}：不合格`] }, effects: (_v: unknown, _p: string) => [] as string[] }
    const p = run({ ...base, effects: [], side: [], after: { minutes: 5, effects: [] }, addiction: { per_dose: 1, withdrawal: { days: 2, effects: [] } } }, check)
    expect(seen).toEqual(['drug.effects', 'drug.side', 'drug.after.effects', 'drug.addiction.withdrawal.effects'])
    expect(p).toHaveLength(4)
  })
})

// ---- 拍賣（auction）：LEWD_SYSTEM 6.2 節；dev/work/M4-auction.md ----

table('auction houseProblems', houseProblems, { name: '槌音', weekday: 3, segment: 'prime', lots: [2, 4], kinds: ['part'], bidders: [1, 3], member: {} }, [
  ['weekday 是 7', { weekday: 7 }, /weekday/],
  ['weekday 是小數', { weekday: 1.5 }, /weekday/],
  ['segment 不認得', { segment: 'zzz' }, /segment/],
  ['lots 最少是 0', { lots: [0, 3] }, /lots/],
  ['lots 反過來', { lots: [4, 2] }, /lots/],
  ['kinds 是空的', { kinds: [] }, /kinds/],
  ['kinds 有不認得的種類', { kinds: ['zzz'] }, /kinds/],
  ['must 不是陣列', { must: 'part' }, /must/],
  ['must 有一種不在 kinds 裡', { must: ['art'] }, /must 的每一種都要在 kinds/],
  ['bidders 反過來', { bidders: [3, 1] }, /bidders/],
  ['member 不是物件', { member: 1 }, /member 要是/],
  ['member.faction 是空字串', { member: { faction: '' } }, /member\.faction/],
  ['member.favor_min 超過 100', { member: { faction: 'f', favor_min: 101 } }, /favor_min 要是 0～100/],
  ['member.favor_min 沒有 faction', { member: { favor_min: 10 } }, /要和 member\.faction 一起寫/],
  ['member.ref 不是布林', { member: { ref: 'yes' } }, /member\.ref/],
])

describe('auction lotProblems／bidderProblems／npcRefProblems／facilityProblems', () => {
  const lot = { kind: 'part', part: 'p1' }
  const cases: Array<[string, Rec, RegExp]> = [
    ['kind 不認得（只回這一條）', { kind: 'zzz' }, /kind 只能是/],
    ['name 是空字串', { ...lot, name: '' }, /name/],
    ['contract 不是物件', { ...lot, contract: 'x' }, /contract 要是/],
    ['effects 的項目沒有 kind', { ...lot, effects: [{}] }, /effects 要是/],
    ['market 是 0', { ...lot, market: 0 }, /market/],
    ['houses 是空陣列', { ...lot, houses: [] }, /houses/],
    ['weight 是 0', { ...lot, weight: 0 }, /weight/],
    ['once 不是布林', { ...lot, once: 1 }, /once/],
    ['needs 的項目不是物件', { ...lot, needs: [1] }, /needs/],
    ['tags 不是字串陣列', { ...lot, tags: [1] }, /tags/],
    ['part 拍品沒寫 part', { kind: 'part' }, /要寫 part/],
    ['義體拍品沒寫 blueprint', { kind: 'cyberware' }, /要寫 blueprint/],
    ['藝品沒寫 item', { kind: 'art', market: 100 }, /要寫 item/],
    ['祕密沒有 item 也沒有 effects', { kind: 'secret', market: 100 }, /要寫 item（物品的 id）或 effects/],
    ['契約拍品沒寫 contract', { kind: 'contract', market: 100 }, /要寫 contract/],
    ['藝品沒寫 market', { kind: 'art', item: 'it' }, /要寫 market/],
  ]
  for (const [what, e, re] of cases) {
    it(`lot：${what}`, () => {
      const p = lotProblems(e)
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
  it('lot：合格的零件拍品沒有問題；祕密有 effects 就可以不寫 item', () => {
    expect(lotProblems(lot)).toEqual([])
    expect(lotProblems({ kind: 'secret', effects: [{ kind: 'x' }], market: 10 })).toEqual([])
  })
  it('bidder：name、npc、interests、weight', () => {
    expect(bidderProblems({ name: '客', interests: ['part'] })).toEqual([])
    expect(bidderProblems({ name: '', npc: '', interests: [], weight: 0 }).length).toBe(4)
  })
  it('auction_ref：true 或拍賣行 id 的非空陣列；設施種類的 auction 要有 house', () => {
    expect(npcRefProblems(true)).toEqual([])
    expect(npcRefProblems(['ah1'])).toEqual([])
    expect(npcRefProblems([])).toHaveLength(1)
    expect(npcRefProblems('ah1')).toHaveLength(1)
    expect(facilityProblems({ house: 'ah1' })).toEqual([])
    expect(facilityProblems({ house: '' })).toHaveLength(1)
    expect(facilityProblems(null)).toHaveLength(1)
  })
})

// ---- 未登錄零件（unreg）：CRAFTING 第 7 節；dev/work/M4-part-unreg.md ----

table('unreg presetProblems（內容種類 unreg_preset）', presetProblems, { type: 'core', name: '舊貨', desc: '一句說明。' }, [
  ['type 沒寫', { type: undefined }, /type/],
  ['grade 是 0', { grade: 0 }, /grade 要是 1～/],
  ['grade 是小數', { grade: 1.5 }, /grade 要是 1～/],
  ['material 不認得', { material: 'zzz' }, /material 只能是/],
  ['name 是空字串', { name: '' }, /name/],
  ['desc 沒寫', { desc: undefined }, /desc/],
  ['quirk_text 不是字串', { quirk_text: 3 }, /quirk_text/],
])

// ---- 打工（work）：DOWNTIME 4.1 節；dev/work/M4-venues.md ----

const STAGE2 = [{ name: '新人', mult: 1 }, { name: '熟手', mult: 1.5, need: { hours: 30, affinity: 0 } }]
describe('work jobProblems：模式、公式、每累計幾小時的升階', () => {
  const base = { name: '酒保', facility: 'bar', wage: 10, pay: 'cash', stages: STAGE2 }
  const cases: Array<[string, Rec, RegExp]> = [
    ['cut 不是物件', { cut: 1 }, /cut 要是/],
    ['cut.house 大於 1', { cut: { house: 1.5 } }, /cut\.house/],
    ['cut.rent 是負的', { cut: { house: 0.5, rent: -1 } }, /cut\.rent/],
    ['wage_formula 不是物件', { wage_formula: 5 }, /wage_formula 要是/],
    ['wage_formula.base 不是數字', { wage_formula: { base: 'x', add: [] } }, /wage_formula\.base/],
    ['wage_formula.add 不是陣列', { wage_formula: { base: 1, add: {} } }, /wage_formula\.add 要是陣列/],
    ['wage_formula.add 的項目不是物件', { wage_formula: { base: 1, add: [3] } }, /add\[0\]：要是/],
    ['wage_formula.add 的 stat 與 meter 都沒寫', { wage_formula: { base: 1, add: [{ div: 2 }] } }, /stat（衍生數值）與 meter/],
    ['wage_formula.add 的 stat 是空字串', { wage_formula: { base: 1, add: [{ stat: '', div: 2 }] } }, /add\[0\]\.stat/],
    ['wage_formula.add 的 meter 是空字串', { wage_formula: { base: 1, add: [{ meter: '', div: 2 }] } }, /add\[0\]\.meter/],
    ['wage_formula.add 的 div 是 0', { wage_formula: { base: 1, add: [{ stat: 's', div: 0 }] } }, /add\[0\]\.div/],
    ['modes 是空物件', { modes: {} }, /modes 要是/],
    ['modes 的項目不是物件', { modes: { a: 3 } }, /modes\.a：要是一個物件/],
    ['mode 沒有 name', { modes: { a: { wage: 1 } } }, /modes\.a：要有 name/],
    ['mode 的 wage 是負的', { modes: { a: { name: 'A', wage: -1 } } }, /modes\.a\.wage/],
    ['mode 的 tags 不是字串陣列', { modes: { a: { name: 'A', wage: 1, tags: [1] } } }, /modes\.a\.tags/],
    ['mode 的 perks 不是效果陣列', { modes: { a: { name: 'A', wage: 1, perks: [{}] } } }, /modes\.a\.perks/],
    ['mode 的 amnesia 不是布林', { modes: { a: { name: 'A', wage: 1, amnesia: 'x' } } }, /modes\.a\.amnesia/],
    ['mode 的 every 不是陣列', { modes: { a: { name: 'A', wage: 1, every: {} } } }, /modes\.a\.every 要是/],
    ['mode 的 every 項目不是物件', { modes: { a: { name: 'A', wage: 1, every: [1] } } }, /every\[0\]：要是/],
    ['every 還在寫 shifts（要改 hours）', { modes: { a: { name: 'A', wage: 1, every: [{ shifts: 3, effects: [{ kind: 'x' }] }] } } }, /shifts：改成 hours/],
    ['every.hours 是 0', { modes: { a: { name: 'A', wage: 1, every: [{ hours: 0, effects: [{ kind: 'x' }] }] } } }, /every\[0\]\.hours/],
    ['every.effects 不是效果陣列', { modes: { a: { name: 'A', wage: 1, every: [{ hours: 4, effects: 3 }] } } }, /every\[0\]\.effects/],
    ['pay 不是 cred 或 cash', { pay: 'gold' }, /pay 要是/],
    ['stages 只有一個階段', { stages: [{ name: 'A', mult: 1 }] }, /stages 要有 2 或/],
    ['stages 的項目不是物件', { stages: [{ name: 'A', mult: 1 }, 3] }, /stages\[1\]：要是一個物件/],
    ['stage 的 mult 超過 20', { stages: [{ name: 'A', mult: 21 }, { name: 'B', mult: 1, need: { hours: 1, affinity: 0 } }] }, /stages\[0\]\.mult/],
    ['第一個階段寫了 need', { stages: [{ name: 'A', mult: 1, need: { hours: 1, affinity: 0 } }, { name: 'B', mult: 1, need: { hours: 1, affinity: 0 } }] }, /第一個階段一開始就是/],
    ['第二個階段沒寫 need', { stages: [{ name: 'A', mult: 1 }, { name: 'B', mult: 1 }] }, /要有 need/],
    ['need 還在寫 shifts', { stages: [{ name: 'A', mult: 1 }, { name: 'B', mult: 1, need: { shifts: 3, affinity: 0 } }] }, /need\.shifts：改成 hours/],
    ['need.hours 是 0', { stages: [{ name: 'A', mult: 1 }, { name: 'B', mult: 1, need: { hours: 0, affinity: 0 } }] }, /need\.hours/],
    ['need.affinity 超過 100', { stages: [{ name: 'A', mult: 1 }, { name: 'B', mult: 1, need: { hours: 1, affinity: 101 } }] }, /need\.affinity/],
    ['need.extra 不是物件', { stages: [{ name: 'A', mult: 1 }, { name: 'B', mult: 1, need: { hours: 1, affinity: 0, extra: 5 } }] }, /need\.extra/],
    ['stage 的 adult 不是布林', { stages: [{ name: 'A', mult: 1, adult: 'x' }, { name: 'B', mult: 1, need: { hours: 1, affinity: 0 } }] }, /adult 要是/],
    ['days.weekday 是 7', { days: { weekday: [7] } }, /days\.weekday/],
    ['days.time 不認得', { days: { time: ['zzz'] } }, /days\.time/],
    ['perks 不是效果陣列', { perks: [{}] }, /perks 要是/],
  ]
  it('合格的一筆沒有問題（modes 的工作可以不寫時薪）', () => {
    expect(jobProblems(base)).toEqual([])
    const { wage: _w, ...noWage } = base
    void _w
    expect(jobProblems({ ...noWage, modes: { a: { name: 'A', wage: 5, every: [{ hours: 30, effects: [{ kind: 'x' }] }] } } })).toEqual([])
  })
  for (const [what, patch, re] of cases) {
    it(`${what}：擋下並提到欄位`, () => {
      const p = jobProblems({ ...base, ...patch })
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
})

// ---- 生命軌跡（creation lifepath）：CHARACTER 5.5 節；dev/work/M4-creation-lifepath.md ----

describe('creation lifepath resultProblems／entryProblems', () => {
  const T = 'family'
  const cases: Array<[string, unknown, RegExp]> = [
    ['result 不是物件', 'x', /result 要是一個物件/],
    ['effects 是空陣列', { effects: [] }, /result\.effects 要是/],
    ['effects 的項目沒有 kind', { effects: [{}] }, /result\.effects\[0\]/],
    ['npc 不是物件', { npc: 1 }, /result\.npc 要是一個物件/],
    ['npc 多一個欄位', { npc: { role: 'friend', zzz: 1 } }, /result\.npc\.zzz/],
    ['npc.role 不認得', { npc: { role: 'zzz' } }, /result\.npc\.role/],
    ['npc.faction_from 是空字串', { npc: { role: 'friend', faction_from: '' } }, /faction_from/],
    ['npc.affinity 超過 100', { npc: { role: 'friend', affinity: 101 } }, /affinity/],
    ['npc.hostility 是 0', { npc: { role: 'friend', hostility: 0 } }, /result\.npc\.hostility/],
    ['npc.roster 不是布林', { npc: { role: 'friend', roster: 1 } }, /roster/],
    ['hostility 超過 100', { npc: { role: 'friend' }, hostility: 101 }, /result\.hostility 要是 1～100/],
    ['hostility 沒有搭配 npc', { hostility: 5 }, /要搭配 result\.npc/],
    ['hostility 兩處都寫', { npc: { role: 'friend', hostility: 5 }, hostility: 5 }, /兩處都寫/],
    ['goal 有大寫', { goal: 'Goal' }, /result\.goal/],
    ['tendency 是空陣列', { tendency: [] }, /result\.tendency 要是/],
    ['tendency 的 state 不認得', { tendency: [{ tag: 't', state: 'deep' }] }, /result\.tendency\[0\]/],
    ['axis 是空物件', { axis: {} }, /result\.axis/],
    ['axis 的級數是 6', { axis: { pain: 6 } }, /result\.axis/],
    ['sex_record 是空物件', { sex_record: {} }, /result\.sex_record 要是/],
    ['sex_record 多一個鍵', { sex_record: { zzz: 1 } }, /sex_record\.zzz/],
    ['sex_record 的值是負的', { sex_record: { times: -1 } }, /sex_record\.times/],
    ['sex_record 的值超過 100000', { sex_record: { times: 100_001 } }, /sex_record\.times/],
    ['bridge 是空物件', { bridge: {} }, /result\.bridge/],
    ['bridge 的值是 0', { bridge: { sensitivity: 0 } }, /result\.bridge/],
    ['不認得的結果', { zzz: 1 }, /result\.zzz：不認得這個結果/],
  ]
  for (const [what, raw, re] of cases) {
    it(`resultProblems ${what}：擋下並提到欄位`, () => {
      const p = resultProblems(raw, T)
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
  it('entryProblems：texts、origins、tags 的格式', () => {
    const base = { table: T, text: '一句', result: { effects: [{ kind: 'x' }] } }
    expect(lifepathEntryProblems(base)).toEqual([])
    const ok = (patch: Rec, re: RegExp) => {
      const p = lifepathEntryProblems({ ...base, ...patch })
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    }
    ok({ texts: { o: '' } }, /texts 要是/)
    ok({ texts: [] }, /texts 要是/)
    ok({ origins: [] }, /origins 要是/)
    ok({ tags: [1] }, /tags 要是/)
    ok({ weight: 0 }, /weight 要是/)
    ok({ text: undefined }, /text/)
    ok({ table: 'zzz' }, /table 要是/)
  })
})

// ---- 簾後館（curtain）的點單、賞箱、獎品表與夜：dev/work/M4-curtain-*.md ----

describe('curtain tableProblems（內容種類 curtain_table）', () => {
  const cases: Array<[string, Rec, RegExp]> = [
    ['kind 不認得', { kind: 'zzz', rows: [{ weight: 1 }] }, /kind 只能是/],
    ['rows 是空的（只回這一條）', { kind: 'order', rows: [] }, /rows 要是至少一列/],
    ['列不是物件', { kind: 'order', rows: [3] }, /rows\[0\] 要是/],
    ['weight 是 0', { kind: 'order', rows: [{ weight: 0, order: 'dance' }] }, /weight/],
    ['name 是空字串', { kind: 'order', rows: [{ weight: 1, name: '', order: 'dance' }] }, /\.name/],
    ['點單的 order 不認得', { kind: 'order', rows: [{ weight: 1, order: 'zzz' }] }, /\.order 要是/],
    ['點單的 style 是空字串', { kind: 'order', rows: [{ weight: 1, order: 'dance', style: '' }] }, /\.style/],
    ['賞箱的 give 不是物件陣列', { kind: 'chest', rows: [{ weight: 1, give: [1] }] }, /\.give 要是一串效果/],
    ['賞箱的 stubs 是負的', { kind: 'chest', rows: [{ weight: 1, stubs: -1 }] }, /\.stubs/],
    ['賞箱的 stubs 區間反過來', { kind: 'chest', rows: [{ weight: 1, stubs: [5, 1] }] }, /\.stubs/],
    ['賞箱的 prize 不是布林', { kind: 'chest', rows: [{ weight: 1, prize: 'yes', give: [{}] }] }, /\.prize 要是布林/],
    ['賞箱什麼都沒給', { kind: 'chest', rows: [{ weight: 1 }] }, /什麼都沒給/],
  ]
  for (const [what, e, re] of cases) {
    it(`${what}：擋下並提到欄位`, () => {
      const p = tableProblems(e)
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
  it('合格的賞箱（只有 prize: true 也算有給）', () => {
    expect(tableProblems({ kind: 'chest', rows: [{ weight: 2, prize: true }, { weight: 1, stubs: [1, 3] }] })).toEqual([])
  })
})

table('curtain nightProblems（內容種類 curtain_night）', nightProblems, { name: '星夜', faction: 'f', tags: ['t'], culture: 'c' }, [
  ['沒有 name', { name: '' }, /name/],
  ['faction 沒寫', { faction: undefined }, /faction/],
  ['tags 是空的', { tags: [] }, /tags/],
  ['needs_filter 是空字串', { needs_filter: '' }, /needs_filter/],
  ['prize 是數字', { prize: 3 }, /prize/],
  ['culture 沒寫', { culture: undefined }, /culture/],
  ['style 是空陣列', { style: [] }, /style/],
])

// ---- 單人姿勢與夜課、共鳴：LEWD_SYSTEM 3.5、第 5 節；NIGHT_LESSONS ----

table('scene soloPoseProblems（內容種類 solo_pose）', soloPoseProblems, { name: '跪', reach: ['hand'], mult: 1 }, [
  ['沒有 name', { name: '' }, /name/],
  ['reach 不是陣列', { reach: 'hand' }, /reach/],
  ['hand_only 不是陣列', { hand_only: 'x' }, /hand_only/],
  ['mult 是 0', { mult: 0 }, /mult/],
  ['mult 是 Infinity', { mult: Infinity }, /mult/],
  ['link_pace 不是物件', { link_pace: 3 }, /link_pace/],
  ['link_pace 的值不是數字', { link_pace: { hand: 'x' } }, /link_pace/],
  ['upkeep 不是物件', { upkeep: 'x' }, /upkeep 要是物件/],
  ['upkeep.load 不是骰', { upkeep: { load: 'abc' } }, /upkeep\.load/],
  ['upkeep.pace 不是數字', { upkeep: { pace: 'x' } }, /upkeep\.pace/],
  ['upkeep.link 不是布林', { upkeep: { link: 1 } }, /upkeep\.link/],
  ['both_links 不是物件', { both_links: 1 }, /both_links 要是/],
  ['both_links.parts 是空陣列', { both_links: { parts: [], load: '1d4' } }, /both_links\.parts/],
  ['both_links.load 不是骰', { both_links: { parts: ['a'], load: 'x' } }, /both_links\.load/],
  ['faster_cut 不是骰', { faster_cut: 'x' }, /faster_cut/],
  ['slower_pace 不是數字', { slower_pace: 'x' }, /slower_pace/],
])

describe('scene nightFieldProblems（night_skill 多讀的欄位）與 resonanceProblems（night_resonance）', () => {
  const ok = (e: Rec, re: RegExp) => {
    const p = nightFieldProblems(e)
    expect(p.some((m) => re.test(m)), JSON.stringify(e) + ' -> ' + p.join(' | ')).toBe(true)
  }
  it('nightFieldProblems 合格的與全部省略的沒有問題', () => {
    expect(nightFieldProblems({})).toEqual([])
    expect(nightFieldProblems({ insight: 2, filters: ['ntr'], requires: { bridge: { tolerance_min: 40 }, experience: { times: 3, favorite: true }, conditions: [{ kind: 'flag', key: 'x' }] }, deep: { on_use: { my_load: '1d6', fit: 2 }, link: { their_load: '0' } } })).toEqual([])
  })
  it('nightFieldProblems 每個欄位的壞法', () => {
    ok({ insight: 0 }, /insight/)
    ok({ insight: 1.5 }, /insight/)
    ok({ filters: 'ntr' }, /filters/)
    ok({ requires: 'x' }, /requires 要是/)
    ok({ requires: { zzz: 1 } }, /requires\.zzz/)
    ok({ requires: { bridge: 'x' } }, /requires\.bridge 要是/)
    ok({ requires: { bridge: { tolerance: 40 } } }, /requires\.bridge\.tolerance/)
    ok({ requires: { bridge: { tolerance_min: 'x' } } }, /requires\.bridge\.tolerance_min/)
    ok({ requires: { experience: 'x' } }, /requires\.experience 要是/)
    ok({ requires: { experience: { zzz: 1 } } }, /requires\.experience\.zzz/)
    ok({ requires: { experience: { times: -1 } } }, /requires\.experience\.times 要是非負整數/)
    ok({ requires: { experience: { favorite: false } } }, /requires\.experience\.favorite 要是 true/)
    ok({ requires: { conditions: [1] } }, /requires\.conditions/)
    ok({ deep: 'x' }, /deep 要是/)
    ok({ deep: { zzz: {} } }, /deep\.zzz/)
    ok({ deep: { on_use: 'x' } }, /deep\.on_use 要是物件/)
    ok({ deep: { on_use: { zzz: 1 } } }, /deep\.on_use\.zzz/)
    ok({ deep: { on_use: { fit: 1.5 } } }, /deep\.on_use\.fit 要是整數/)
    ok({ deep: { on_use: { my_load: 'x' } } }, /deep\.on_use\.my_load 要是骰/)
    ok({ deep: { link: { initiative: 1 } } }, /deep\.link\.initiative/)
  })
  it('resonanceProblems：branch、tier、name、scene 與它的欄位', () => {
    const base = { branch: 'gunner', tier: 1, name: '共鳴', scene: {} }
    const first = resonanceProblems(base)
    // branch 的名字從錯誤訊息取（不寫死十種的名字）
    const branchMsg = resonanceProblems({ ...base, branch: 'zzz' }).find((m) => /branch 要是/.test(m))
    expect(branchMsg).toBeTruthy()
    const branch = /要是 ([^、 ]+)、/.exec(branchMsg!)![1]!
    const good = { ...base, branch }
    expect(resonanceProblems(good)).toEqual([])
    void first
    const bad2 = (patch: Rec, re: RegExp) => {
      const p = resonanceProblems({ ...good, ...patch })
      expect(p.some((m) => re.test(m)), JSON.stringify(patch) + ' -> ' + p.join(' | ')).toBe(true)
    }
    bad2({ tier: 0 }, /tier/)
    bad2({ tier: 6 }, /tier/)
    bad2({ name: '' }, /name/)
    bad2({ desc: '' }, /desc/)
    bad2({ scene: 'x' }, /scene 要是/)
    bad2({ scene: { zzz: 1 } }, /scene\.zzz/)
    bad2({ scene: { rules: 'x' } }, /scene\.rules 要是/)
    bad2({ scene: { rules: { 'nope.path': 1 } } }, /scene\.rules\.nope\.path/)
    bad2({ scene: { free_switch: 0 } }, /scene\.free_switch/)
    bad2({ scene: { first_link_fit: 1.5 } }, /scene\.first_link_fit/)
    bad2({ scene: { reveal: 'zzz' } }, /scene\.reveal/)
    bad2({ scene: { link_bonus: 'x' } }, /scene\.link_bonus/)
  })
})

// ---- 義體：battle 欄位、lock 欄位；CYBERWARE 第 3、5 節；dev/work/M4-cyber-battle.md ----

describe('cyberware lockProblems（cyber_install 的 lock 與契約的紀錄）', () => {
  it('不是物件、kind 不認得、holder 是空字串、weekly 與 owed 是負的或小數', () => {
    expect(lockProblems('x')).toEqual(['lock 要是 { kind, holder?, weekly?, owed? }'])
    expect(lockProblems({ kind: 'zzz' }, 'effects[0].lock').join('|')).toMatch(/effects\[0\]\.lock\.kind 只能是/)
    const kind = /只能是 ([^、]+)、/.exec(lockProblems({ kind: 'zzz' })[0]!)![1]!
    expect(lockProblems({ kind })).toEqual([])
    expect(lockProblems({ kind, holder: '' }).join('|')).toMatch(/holder/)
    expect(lockProblems({ kind, weekly: -1 }).join('|')).toMatch(/weekly/)
    expect(lockProblems({ kind, weekly: 1.5 }).join('|')).toMatch(/weekly/)
    expect(lockProblems({ kind, owed: -5 }).join('|')).toMatch(/owed/)
    expect(lockProblems({ kind, owed: 0, weekly: 0 })).toEqual([])
  })
})

describe('cyberware battleProblems（設計圖的 battle 欄位）', () => {
  const k = makeGame().game.k
  const run = (raw: unknown) => battleProblems(k, raw)
  const act = { id: 'a1', name: '甩開', icon: 'bolt', ap: 1, do: [{ kind: 'damage', amount: '1d4' }] }
  it('不是物件的擋下；多一個欄位的擋下並列出可以寫的', () => {
    expect(run(3)).toEqual(['battle 要是一個物件'])
    expect(run({ zzz: 1 }).join('|')).toMatch(/battle\.zzz：沒有這個欄位/)
  })
  const cases: Array<[string, unknown, RegExp]> = [
    ['actions 不是陣列', { actions: {} }, /battle\.actions 要是陣列/],
    ['action 不是物件', { actions: [1] }, /battle\.actions\[0\] 要是/],
    ['action 沒有 id、name、icon', { actions: [{ ap: 1, do: [] }] }, /actions\[0\]\.id/],
    ['action.jammable 不是布林', { actions: [{ ...act, jammable: 'x' }] }, /jammable/],
    ['action.ap 是 11', { actions: [{ ...act, ap: 11 }] }, /actions\[0\]\.ap 要是 0～10/],
    ['action.uses 不是物件', { actions: [{ ...act, uses: 3 }] }, /uses 要是/],
    ['action.uses.turn 是 0', { actions: [{ ...act, uses: { turn: 0 } }] }, /uses\.turn/],
    ['action.uses 多一個鍵', { actions: [{ ...act, uses: { day: 1 } }] }, /uses\.day/],
    ['action.do 是空的', { actions: [{ ...act, do: [] }] }, /\.do 要是至少一筆/],
    ['toggle 不是物件', { toggle: 3 }, /battle\.toggle 要是/],
    ['toggle 沒寫 upkeep_load', { toggle: { id: 't', name: 'T', icon: 'i' } }, /upkeep_load 要寫/],
    ['toggle.upkeep_load 是 51', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: 51 } }, /upkeep_load 要是 0～50/],
    ['toggle.upkeep_load 的檔位值是 51', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: { deep: 51 } } }, /upkeep_load\.deep/],
    ['toggle.levels 不是布林', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: 0, levels: 1 } }, /levels 要是/],
    ['toggle.levels 是 true 但檔位沒寫齊', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: { deep: 1 }, levels: true } }, /levels 是 true，四檔都要寫/],
    ['toggle.mods 不是陣列', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: 0, mods: 'x' } }, /toggle\.mods 要是陣列/],
    ['toggle.mods 的項目沒有 mod', { toggle: { id: 't', name: 'T', icon: 'i', upkeep_load: 0, mods: [{ amount: 1 }] } }, /toggle\.mods\[0\] 要是/],
    ['scaling 不是陣列', { scaling: {} }, /battle\.scaling 要是陣列/],
    ['scaling 的項目不是物件', { scaling: [1] }, /battle\.scaling\[0\] 要是/],
    ['scaling.mod 不認得', { scaling: [{ mod: 'zzz', per_load: 5, amount: 1 }] }, /battle\.scaling\[0\]\.mod：「zzz」/],
    ['scaling.per_load 是 0', { scaling: [{ mod: 'hit', per_load: 0, amount: 1 }] }, /per_load/],
    ['scaling.amount 是 0', { scaling: [{ mod: 'hit', per_load: 5, amount: 0 }] }, /scaling\[0\]\.amount/],
    ['scaling.tags 不是字串陣列', { scaling: [{ mod: 'hit', per_load: 5, amount: 1, tags: [1] }] }, /scaling\[0\]\.tags/],
    ['vs 不是陣列', { vs: {} }, /battle\.vs 要是陣列/],
    ['vs 的項目不是物件', { vs: [1] }, /battle\.vs\[0\] 要是/],
    ['vs.amount 是 0', { vs: [{ mod: 'hit', amount: 0, other_tags: ['x'] }] }, /vs\[0\]\.amount/],
  ]
  for (const [what, raw, re] of cases) {
    it(`${what}：擋下並提到欄位`, () => {
      const p = run(raw)
      expect(p.some((m) => re.test(m)), p.join(' | ')).toBe(true)
    })
  }
})
