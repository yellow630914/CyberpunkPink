// 雙形象（M4-enemies-m4；CYBERSPACE 8.7 節「敵人的外表有兩大類」與「雙形象」；ENEMIES 第 6 節版本的精神）。
//
//   一個敵人資料可以寫兩份形象 forms: { a, b }（名稱、外觀、招牌行動的名字與描寫）；兩份共用數值與招式的效果，只換字。
//   開戰時（unit.ready）每個有 forms 的敵人擲一次：b 的機率是規則表 net_enemy_rule 的 form_b_chance（預設 0.6），整場固定，記在 unit.ext.enemies.form。
//   擲的時候看內容篩選：形象的 points_at 裡有任何一類（male、female、femboy、trans_f、futa）對應的標籤（male_partner……）被關掉，
//   那個形象不能用，擲到了就換另一個；兩個都不能用就是 neutral（資料的 neutral，沒寫就用資料的 name 與 desc）。
//   看誰：目標是 male 一律用 a（a 不能用就是 neutral）；其餘（female、femboy、trans_f、futa）用擲到的。沒給目標、目標不是角色、範圍攻擊都看主角。
//   現實的戰場讀角色的性別；內海的戰場優先讀化身的（actor.ext.deck.avatar.gender，只認格式），沒有才讀角色的。
//
// 單位的名字（unit.name）是「對主角」的那一個：名牌沒鎖定誰時照主角。敵人自己出手的那一步，目標的形象和主角的不同時，
// action.done 把這一步的紀錄裡的名字與招牌行動的名字換成目標對到的那一個（紀錄逐拍換，單位本身不動）；數值、狀態、標記一律不變。
// 不 import 別的功能：性別只看 actor.gender 與 actor.ext.deck.avatar.gender 的格式。

import type { BattleRun, BattleTarget, BattleUnit, GameState, Kernel } from '../../core'
import { deriveRng, isRecord, modeOf, statusRuleOf, tagsAllowed } from '../../core'
import { DEFAULT_FORM_B_CHANCE } from './curve'
import type { EnemyEntry, EnemyForm, EnemyFormMove, EnemyGender, EnemyNeutral } from './kinds'
import { ENEMY_GENDERS, OWNER, resolveEnemy } from './kinds'
import { NET_RULE_KIND } from './lace'
import type { NetEnemyRule } from './lace'
import { enemyData, peekEnemy } from './unitdata'

/** 形象的鍵：a、b、或兩個都被篩選排除時的 neutral。 */
export type FormKey = 'a' | 'b' | 'neutral'

/** 性別對到的內容篩選標籤（DATA 第 1 節；和 features/npcs、features/scene 同一張表，不 import 它們）。 */
export const GENDER_FILTER_TAG: Record<EnemyGender, string> = { male: 'male_partner', female: 'female_partner', femboy: 'femboy_partner', trans_f: 'trans_partner', futa: 'futa_partner' }

/** 一個形象現在的樣子：名稱、外觀、招牌行動換掉的名字（moves）。 */
export interface FormView {
  form: FormKey
  name: string
  look: string
  moves: Record<string, EnemyFormMove>
}
/** 給畫面的（unitFormView）：這個敵人現在對這個目標是哪一個，以及兩種可能的樣子。 */
export interface UnitFormView {
  current: FormView
  /** 對 male 的目標（形象 a；a 被篩選排除時是 neutral） */
  for_male: FormView
  /** 對女性、偽娘、TS、扶他（這一場擲到的） */
  for_other: FormView
}

const isGender = (v: unknown): v is EnemyGender => typeof v === 'string' && (ENEMY_GENDERS as readonly string[]).includes(v)

/** 這個敵人有沒有雙形象。 */
export const hasForms = (e: Pick<EnemyEntry, 'forms'>): boolean => !!e.forms?.a && !!e.forms?.b

/** 擲到 b 的機率：規則表 net_enemy_rule 的 form_b_chance（0～1），沒有就是預設 0.6。 */
export function formBChance(k: Pick<Kernel, 'content'>): number {
  const v = k.content.get<NetEnemyRule>(NET_RULE_KIND, 'default')?.form_b_chance
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULT_FORM_B_CHANCE
}

/** 擲一次：亂數（0～1）小於機率是 b，否則 a。 */
export const pickForm = (roll: number, chance: number): 'a' | 'b' => (roll < chance ? 'b' : 'a')

/** 這個形象在現在的內容篩選下能不能用：points_at 裡沒有被關掉的類（neutral: true 的形象不看 points_at）。 */
export function formUsable(state: Pick<GameState, 'rules'>, f: EnemyForm): boolean {
  if (f.neutral === true) return true
  return tagsAllowed(state.rules, (f.points_at ?? []).map((g) => GENDER_FILTER_TAG[g]))
}

/** 兩個形象現在各能不能用。 */
export function usableForms(state: Pick<GameState, 'rules'>, e: Pick<EnemyEntry, 'forms'>): { a: boolean; b: boolean } {
  return { a: !!e.forms && formUsable(state, e.forms.a), b: !!e.forms && formUsable(state, e.forms.b) }
}

/** 照擲到的結果與篩選決定用哪一個：擲到的能用就用；不能用換另一個；兩個都不能用是 neutral。 */
export function chooseForm(rolled: 'a' | 'b', usable: { a: boolean; b: boolean }): FormKey {
  const other = rolled === 'a' ? 'b' : 'a'
  return usable[rolled] ? rolled : usable[other] ? other : 'neutral'
}

/** 開戰時擲一次（deriveRng：用途帶戰鬥與單位的 id，所以重來這場戰鬥——新的戰鬥 id——會重擲，同一場重讀存檔不會變）。 */
export function rollFormKey(k: Pick<Kernel, 'content'>, state: GameState, battleId: string, unitId: string, e: EnemyEntry): FormKey {
  const rolled = pickForm(deriveRng(state.rng, `enemy_form/${battleId}/${unitId}`).next(), formBChance(k))
  return chooseForm(rolled, usableForms(state, e))
}

/** 一個形象的樣子；neutral 用資料的 neutral，沒寫就用資料的 name 與 desc。 */
export function formViewOf(e: EnemyEntry, key: FormKey): FormView {
  if (key !== 'neutral' && e.forms?.[key]) {
    const f = e.forms[key]
    return { form: key, name: f.name, look: f.look, moves: { ...(f.moves ?? {}) } }
  }
  const n: EnemyNeutral | undefined = e.neutral
  return { form: 'neutral', name: n?.name ?? e.name, look: n?.look ?? e.desc, moves: { ...(n?.moves ?? {}) } }
}

// ---- 看誰 ----

/** 這個角色在這一層的性別（現實看角色的；內海優先看化身的，只認格式）；不是五個值回傳 undefined。 */
export function genderOf(state: Pick<GameState, 'actors'>, actor: string | undefined, layer: 'meat' | 'net'): EnemyGender | undefined {
  const a = actor ? state.actors[actor] : undefined
  if (!a) return undefined
  if (layer === 'net') {
    const deck = a.ext.deck
    const av = isRecord(deck) && isRecord(deck.avatar) ? deck.avatar.gender : undefined
    if (isGender(av)) return av
  }
  return isGender(a.gender) ? a.gender : undefined
}

/** 這一場的戰場是現實還是內海（沒有戰鬥當現實）。 */
const layerOf = (k: Pick<Kernel, 'content'>, state: Pick<GameState, 'battle'>, layer?: 'meat' | 'net'): 'meat' | 'net' =>
  layer ?? (state.battle ? (modeOf(k.content, state.battle.mode)?.layer ?? 'meat') : 'meat')

export interface FormForOpts {
  /** 不給就看現在這場戰鬥的戰場 */
  layer?: 'meat' | 'net'
}

/**
 * 這個敵人對這個目標現在的形象（鍵）。目標是 male 一律 a（a 被篩選排除時是 neutral）；其餘用擲到的；
 * 沒給目標、目標不是角色（敵方的單位、掛著的東西）當成主角。沒有雙形象的敵人是 undefined。
 */
export function formKeyFor(k: Pick<Kernel, 'content'>, state: GameState, unit: BattleUnit, target?: BattleUnit | null, o: FormForOpts = {}): FormKey | undefined {
  if (!unit.enemy || !k.content.has('enemy', unit.enemy)) return undefined
  const e = resolveEnemy(k.content, unit.enemy)
  if (!hasForms(e)) return undefined
  const rolled = peekEnemy(unit).form
  const stored: FormKey = rolled === 'a' || rolled === 'b' || rolled === 'neutral' ? rolled : 'a'
  const layer = layerOf(k, state, o.layer)
  // 目標不是這個敵人的對手（敵方自己、不是角色的單位）：看主角
  const actor = target && target.side !== unit.side ? target.actor : undefined
  const gender = genderOf(state, actor ?? state.pc ?? undefined, layer)
  if (gender === 'male') return usableForms(state, e).a ? 'a' : 'neutral'
  return stored
}

/** formFor：這個敵人對這個目標現在的名字與外觀。沒有雙形象的敵人回傳 undefined。 */
export function formFor(k: Pick<Kernel, 'content'>, state: GameState, unit: BattleUnit, target?: BattleUnit | null, o: FormForOpts = {}): FormView | undefined {
  const key = formKeyFor(k, state, unit, target, o)
  return key && unit.enemy ? formViewOf(resolveEnemy(k.content, unit.enemy), key) : undefined
}

/** 給畫面：名牌與立繪現在顯示哪一個（target 是它目前鎖定的目標；沒鎖定照主角），以及兩種可能的樣子。 */
export function unitFormView(k: Pick<Kernel, 'content'>, state: GameState, unit: BattleUnit, target?: BattleUnit | null, o: FormForOpts = {}): UnitFormView | undefined {
  const current = formFor(k, state, unit, target, o)
  if (!current || !unit.enemy) return undefined
  const e = resolveEnemy(k.content, unit.enemy)
  const stored = peekEnemy(unit).form
  return {
    current,
    for_male: formViewOf(e, usableForms(state, e).a ? 'a' : 'neutral'),
    for_other: formViewOf(e, stored === 'a' || stored === 'b' || stored === 'neutral' ? stored : 'a'),
  }
}

// ---- 開戰與逐拍換字 ----

/** 這個單位是有雙形象的敵人。 */
function formEnemy(k: Pick<Kernel, 'content'>, u: BattleUnit): EnemyEntry | undefined {
  if (u.side !== 'foe' || !u.enemy || !k.content.has('enemy', u.enemy)) return undefined
  const e = resolveEnemy(k.content, u.enemy)
  return hasForms(e) ? e : undefined
}

/** 這個技能是不是範圍的（效果裡有落在好幾個人身上的 who）：範圍攻擊固定看主角。 */
const AREA_WHO = new Set(['foes', 'foes_bridged', 'area', 'allies', 'others', 'adjacent', 'near', 'foe_overlays'])
function isAreaAbility(k: Pick<Kernel, 'content'>, id: string): boolean {
  const seen = new Set<unknown>()
  const walk = (v: unknown): boolean => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return false
    seen.add(v)
    if (Array.isArray(v)) return v.some(walk)
    const r = v as Record<string, unknown>
    if (typeof r.who === 'string' && AREA_WHO.has(r.who) && typeof r.op === 'string') return true
    return Object.values(r).some(walk)
  }
  const ab = k.content.get('ability', id)
  return !!ab && walk(ab)
}

/** 文字裡這個敵人的名字換成另一個：核心的名牌是「敵・名字」，招牌行動與特徵的那一拍開頭是「名字：」。 */
function renameIn(text: string, from: string, to: string): string {
  if (from === to) return text
  let out = text.split(`敵・${from}`).join(`敵・${to}`)
  if (out.startsWith(`${from}：`)) out = `${to}：${out.slice(from.length + 1)}`
  return out
}

/** 每一個 run（一步）裡，這個敵人這一步從第幾拍開始。 */
const cursors = new WeakMap<BattleRun, number>()

/**
 * 中性外觀的招式名（CYBERSPACE 8.7 節；M4-followups-2 第 7 項）：兩個形象都被內容篩選排除、改用中性外觀時，招牌行動的名字自動換成「挑逗」「灌注」「綁縛」（照效果種類）。
 * 資料的 neutral.moves 寫了的照寫的，這裡只補沒寫的。種類看招牌行動技能的效果：控制（status 的 kind 是 control、pinned_down、net.pin）是綁縛；
 * 神經的感載、餘韻、沉溺是灌注；快感的感載是挑逗；都沒有的不換。
 */
export const NEUTRAL_MOVE_NAMES = { tease: '挑逗', infuse: '灌注', bind: '綁縛' } as const

export function neutralMoveName(k: Pick<Kernel, 'content'>, abilityId: string): string | undefined {
  const ab = k.content.get('ability', abilityId)
  if (!ab) return undefined
  const found = new Set<keyof typeof NEUTRAL_MOVE_NAMES>()
  const seen = new Set<unknown>()
  const walk = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { v.forEach(walk); return }
    const r = v as Record<string, unknown>
    if (typeof r.op === 'string') {
      if (r.op === 'net.pin') found.add('bind')
      else if (r.op === 'status' && typeof r.status === 'string') {
        if (r.status === 'pinned_down' || statusRuleOf(k.content, r.status)?.kind === 'control') found.add('bind')
      } else if (r.op === 'load' || r.op === 'damage') {
        if (r.type === 'pleasure') found.add('tease')
        else if (r.type === 'neural') found.add('infuse')
      } else if (r.op === 'afterglow' || r.op === 'sink') found.add('infuse')
    }
    Object.values(r).forEach(walk)
  }
  walk(ab)
  const kind = found.has('bind') ? 'bind' : found.has('infuse') ? 'infuse' : found.has('tease') ? 'tease' : undefined
  return kind ? NEUTRAL_MOVE_NAMES[kind] : undefined
}

export function installForms(k: Kernel): void {
  // 開戰時擲一次：記在 unit.ext.enemies.form；單位的名字改成對主角的那一個
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    const e = formEnemy(k, unit)
    if (!e) return
    const d = enemyData(unit)
    if (d.form === 'a' || d.form === 'b' || d.form === 'neutral') return
    d.form = rollFormKey(k, run.state, run.battle.id, unit.id, e)
    // 呼叫端自己給了名字（UnitRef.name）的不改
    if (unit.name === e.name) unit.name = formFor(k, run.state, unit, null, { layer: run.mode.layer })!.name
  })

  // 敵人這一步從哪一拍開始（AI 的每一步之前）；不回傳 true：這一步不是我們做的
  // 排在最前面：別的功能在 ai.step 裡替他做的事（招牌行動）也算在這一步裡
  k.battle.on('ai.step', OWNER, ({ run, unit }) => {
    if (formEnemy(k, unit)) cursors.set(run, run.beats.length)
  }, -100)

  // 每個自己的回合開始：從這裡算起的紀錄，是這個人這幾步的（玩家的行動沒有 ai.step，靠它找起點）
  k.battle.on('turn.start', OWNER, ({ run }) => {
    cursors.set(run, run.beats.length)
  }, -100)

  // 敵人出手之後：這一步的紀錄換成目標對到的形象的名字與招牌行動的名字（範圍攻擊看主角）。
  // 別人打這個敵人（玩家或夥伴的行動、目標是一個有雙形象的敵人）：那幾拍裡敵人的名字，照這個動手的人看到的形象換（M4-followups-2 第 7 項）
  k.battle.on('action.done', OWNER, ({ run, unit, action, target }) => {
    const from = cursors.get(run)
    const e = formEnemy(k, unit)
    if (!e) {
      const foe = unitOfTarget(run, target)
      const fe = foe && foe.side !== unit.side && !isAreaAbility(k, action) ? formEnemy(k, foe) : undefined
      if (from !== undefined && foe && fe) {
        const seen = formFor(k, run.state, foe, unit, { layer: run.mode.layer })
        const base = formFor(k, run.state, foe, null, { layer: run.mode.layer })
        if (seen && base && foe.name === base.name) for (const beat of run.beats.slice(from)) beat.text = renameIn(beat.text, foe.name, seen.name)
      }
      cursors.set(run, run.beats.length)
      return
    }
    if (from === undefined) return
    cursors.set(run, run.beats.length)
    const aimed = !isAreaAbility(k, action) ? unitOfTarget(run, target) : undefined
    const view = formFor(k, run.state, unit, aimed, { layer: run.mode.layer })
    if (!view) return
    const base = formFor(k, run.state, unit, null, { layer: run.mode.layer })!
    const abName = k.content.get<{ id: string; name?: string }>('ability', action)?.name
    // 資料寫了的招式名照寫的；中性外觀沒寫的，照效果種類自動換成挑逗、灌注、綁縛
    const moveName = view.moves[action]?.name ?? (view.form === 'neutral' ? neutralMoveName(k, action) : undefined)
    for (const beat of run.beats.slice(from)) {
      // 招牌行動的那一拍：「名字：招式。」
      if (abName && moveName && beat.tag === 'skill' && beat.data?.ability === action) beat.text = beat.text.split(`：${abName}。`).join(`：${moveName}。`)
      // 呼叫端自己給了名字（UnitRef.name）的不換名字，只換招牌行動的名字
      if (unit.name === base.name) beat.text = renameIn(beat.text, unit.name, view.name)
    }
  })
}

const unitOfTarget = (run: BattleRun, t: BattleTarget | null): BattleUnit | undefined => (t && 'unit' in t ? run.battle.units[t.unit] : undefined)
