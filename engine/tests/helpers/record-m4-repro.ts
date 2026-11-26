// 把 M4 的種子重播固定檔錄一次（engine/tests/fixtures/repro/m4-*.json）：改了假世界（worldBody.ts）或功能之後，狀態摘要（expect.paths）對不上時用它重錄。
// 跑法：暫時把這個檔改名成 record-m4-repro.test.ts，在 engine/ 跑 npx vitest run tests/helpers/record-m4-repro.test.ts，錄完改回來（不改名就不會進主套件）。
// 步驟的種類與參數見 src/testkit/steps.ts 的 M4_STEPS。

import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { pathValue, runRepro } from '../../src/testkit'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'tw_origin', originChoice: { favor: 'f_gang' },
  attrPick: { reflex: 15, tech: 14, body: 13, intellect: 12, resolve: 10, charm: 8 }, attrBonus: { charm: -4, reflex: 3, resolve: 3 },
  skills: { mechanics: 3, firearms: 3, medicine: 2, streetwise: 2 }, perks: ['perk_tw_smooth', 'perk_tw_tough'],
  bridge: 'bp_tw_bridge', cyber: [{ blueprint: 'bp_tw_eye' }], gear: [{ id: 'bp_tw_pistol' }, { id: 'i_tw_medkit', qty: 2 }],
  lifepath: { family: 'lp_tw_fam_tower', incident: 'lp_tw_inc_cash', friend: 'lp_tw_fr_old', enemy: 'lp_tw_en_rival', ex: 'lp_tw_ex_gone', want: 'lp_tw_want_money', sex: 'lp_tw_sex_some', kink: 'lp_tw_kink_rope' },
}
const m4 = (d: string, more: Record<string, unknown> = {}) => ({ type: 'm4' as const, do: d, ...more })
const pass = (minutes: number) => m4('pass', { minutes })
const sceneSkill = (id: string, target: string | undefined, my: string, their: string) => m4('scene_do', { input: { kind: 'skill', id, ...(target ? { target } : {}), pick: { my_part: my, their_part: their } } })

const FIXTURES: Array<{ repro: Repro; paths: string[] }> = [
  {
    paths: ['time', 'money', 'rng.cursor', 'location', 'actors.pc.sink', 'actors.pc.hp', 'actors.pc.perks'],
    repro: {
      id: 'm4-body', seed: 6, note: '基準（不是 bug）：M4 第一波冒煙的身體那一條（簡化）。建角（橋、義眼、手槍、生命軌跡）→ 診所裝一件義臂 → 休養過完 → 存讀 → 吃兩劑雲絲到重度 → 戒斷開始 → 存讀 → 互助診所戒斷療程 → 過完戒斷期。',
      setup: { named: 'body_creation' },
      inputs: [
        m4('create', { draft: DRAFT }), m4('stand', { block: 'tw_clinics', marker: 'F1' }), m4('give_product', { bp: 'bp_tw_arm', uid: 'U1' }), m4('install', { uid: 'U1', via: 'clinic', side: 'l' }),
        pass(5 * 1440), { type: 'save_load' }, m4('give_item', { id: 'it_tw_cloud', qty: 3 }), m4('drug_use', { item: 'it_tw_cloud' }), pass(120), m4('drug_use', { item: 'it_tw_cloud' }),
        pass(4 * 1440), { type: 'save_load' }, m4('stand', { block: 'tw_shops', marker: 'F4' }), m4('detox', { drug: 'it_tw_cloud' }), pass(14 * 1440),
      ],
      expect: {},
    },
  },
  {
    paths: ['time', 'rng.cursor', 'actors.pc.sink', 'actors.pc.ext.bridge', 'actors.pc.ext.scene', 'meters.insight'],
    repro: {
      id: 'm4-scene', seed: 6, note: '基準（不是 bug）：M4 第二波冒煙的成人場景那一條（簡化）。學夜課 → 一對一（用夜課、存讀、結束回合、停下）→ 三人一圈加不展開的圈（換圈、停下）→ 單人（停下）。',
      setup: { named: 'body_scene' },
      inputs: [
        m4('insight', { n: 40 }), m4('night_learn', { id: 'nt_tw_stroke' }), m4('night_learn', { id: 'nt_tw_kiss' }), m4('night_learn', { id: 'nt_tw_slow' }),
        m4('scene_open', { setup: { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' } }), sceneSkill('nt_tw_stroke', 'npc_tw_ann', 'hand_l', 'chest'), { type: 'save_load' },
        m4('scene_end_turn'), m4('scene_stop'),
        m4('scene_open', { setup: { circles: [['pc', 'npc_tw_ann', 'npc_tw_bo'], ['npc_tw_cy', 'npc_tw_di']], nature: 'mutual', mode: 'full' } }),
        sceneSkill('nt_tw_kiss', 'npc_tw_ann', 'mouth', 'mouth'), sceneSkill('nt_tw_stroke', 'npc_tw_bo', 'hand_r', 'chest'), m4('scene_end_turn'), m4('scene_do', { input: { kind: 'move_circle', circle: 'c1' } }), m4('scene_stop'),
        m4('scene_open', { setup: { solo: true, mode: 'full' } }), sceneSkill('nt_tw_slow', undefined, 'hand_l', 'chest'), m4('scene_end_turn'), m4('scene_stop'),
      ],
      expect: {},
    },
  },
  {
    paths: ['time', 'money', 'rng.cursor', 'actors.pc.sink', 'ext.contract', 'flags'],
    repro: {
      id: 'm4-contract', seed: 6, note: '基準（不是 bug）：M4 第三波冒煙的契約（契約人）那一條（簡化）。效果簽下債務契約 → 過幾天收到指令 → 抗拒（定力很低的主角）→ 存讀 → 再過幾天 → 還清。',
      setup: { named: 'body_contract' },
      inputs: [
        m4('effect', { effects: [{ kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand', 'work', 'report'], report_weekday: 0, holder: { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }, rules: [] }] }),
        pass(2 * 1440), m4('contract_choose', { how: 'resist' }), { type: 'save_load' }, pass(3 * 1440), m4('give_money', { cred: 20000 }),
      ],
      expect: {},
    },
  },
  {
    paths: ['time', 'money', 'rng.cursor', 'actors.pc.sink', 'actors.pc.skills', 'actors.pc.ext.abilities', 'inventory'],
    repro: {
      id: 'm4-market', seed: 6, note: '基準（不是 bug）：M4 第五波冒煙的訂做與學工藝（簡化）。委託台訂做一件槍管 → 存讀 → 過三天 → Game.unregDeliver 交貨 → 向 NPC 學義體學到 2 級。',
      setup: { named: 'body_market' },
      inputs: [
        m4('stand', { block: 'tw_shops', marker: 'F2' }), m4('order', { part_type: 'barrel', grade: 2, want: ['barrel_damage'] }), { type: 'save_load' }, pass(3 * 1440), m4('deliver'),
        m4('stand', { block: 'tw_market', marker: 'E1' }), m4('tutor', { npc: 'npc_tw_tutor', skill: 'cyberware' }), m4('tutor', { npc: 'npc_tw_tutor', skill: 'cyberware' }),
        m4('tutor', { npc: 'npc_tw_tutor', skill: 'cyberware' }), m4('tutor', { npc: 'npc_tw_tutor', skill: 'cyberware' }),
      ],
      expect: {},
    },
  },
]

describe('gen', () => {
  it('record', async () => {
    for (const { repro, paths } of FIXTURES) {
      const r = await runRepro(repro, FEATURES)
      if (r.error) throw new Error(`${repro.id}：${r.error}`)
      if (r.violations.length) throw new Error(`${repro.id}：${r.violations.join('；')}`)
      const out: Repro = { ...repro, expect: { paths: Object.fromEntries(paths.map((p) => [p, pathValue(r.test.game.state, p)])) } }
      writeFileSync(`tests/fixtures/repro/${repro.id}.json`, `${JSON.stringify(out, null, 2)}\n`)
      console.log('RECORDED', repro.id, JSON.stringify(out.expect.paths).slice(0, 300))
    }
  })
})
