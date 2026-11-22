// L7 外殼：存檔與讀檔（做法照搬 ElondiaRPG 的 stores/saves 與介面第四版的 lib/save.ts）。純函式，不碰 localStorage：
// 存到哪裡（格子、檔案）是 ui 的事，這裡只管一份存檔的文字怎麼打包、怎麼讀回來。
//
// - 存檔是一份 JSON：{ format, version, meta, state }。格式版本從 1 開始（MIGRATION「敘事、狀態與介面」）。
// - 讀檔：解析 → 認格式 → 照遷移步驟表一版一版升上來 → 補缺的欄位 → 檢查結構 → 年齡的底線。
// - 有低於 18 的年齡，整筆拒絕，不自動改成 18。
// - 讀檔修復（ElondiaRPG 寫在狀態層的 load 裡）改成 save.loaded 掛鉤，由 Game.load 在讀完之後跑。

import type { GameState } from '../core/types'
import { STATE_VERSION } from '../core/types'
import { blankState } from '../core/state/blank'
import { battleProblems, underageAt, validateActor } from '../core/state/coreChanges'
import { sanitizeRules } from '../core/state/saveRules'
import { clone } from '../core/util/clone'
import { isRecord } from '../core/util/sanitize'
import { formatTime, isValidTime } from '../core/util/time'

/** 引擎的存檔格式。和介面第四版的假存檔（cyberpunkpink-save，版本 1～4）分開，兩邊不會互相誤讀（dev/adr/0005）。 */
export const SAVE_FORMAT = 'cyberpunkpink-engine-save'
export const SAVE_VERSION = STATE_VERSION

export interface SaveMeta {
  label: string
  day: number
  time: string
  place: string
  /** 存檔的時刻（由外面給；引擎不看時鐘） */
  savedAt: string
  kind: 'manual' | 'auto' | 'snapshot'
  /** 主角的摘要：名字與出身（取代 ElondiaRPG 存檔摘要裡的種族、職業、等級）。origin 是出身的 id，originName 是給玩家看的名字 */
  pc?: { name: string; origin?: string; originName?: string }
}

export interface SaveFile {
  format: string
  version: number
  meta: SaveMeta
  state: GameState
}

/** 一步遷移：把 from 版的狀態升到 from + 1 版。 */
export interface Migration {
  from: number
  note: string
  run(state: Record<string, unknown>): Record<string, unknown>
}

/**
 * 遷移步驟表。狀態的形狀一改：STATE_VERSION 加一，在這裡加一步，
 * 並在 engine/tests/fixtures/saves/ 留一份舊版的存檔當回歸測試（v1-m0.json 是第 1 版）。
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    note: 'M1：多了 battle（進行中的戰鬥）、maps（格子地圖）與 snapshots（快照）；存檔規則多了敵人的係數、戰敗扣錢的金額上限、重創要不要留傷勢。'
      + '第 1 版的「戰敗最多扣多少錢」預設寫成 0（當時沒有地方可以改它），照 COMBAT_SYSTEM 8.3 節的預設改成 1（最多 100%）。',
    run: (state) => {
      const rules = isRecord(state.rules) ? { ...state.rules } : {}
      if (rules.defeatMoneyLoss === 0 || rules.defeatMoneyLoss === undefined) rules.defeatMoneyLoss = 1
      return { ...state, rules, battle: state.battle ?? null, maps: isRecord(state.maps) ? state.maps : { instances: {}, at: null, seq: 0 }, snapshots: Array.isArray(state.snapshots) ? state.snapshots : [] }
    },
  },
]

/**
 * 角色的出身放在 actor.ext.origin：一個物件，至少有 id（出身的 id；建角寫的還有 favor、status、home、roster），
 * 舊的寫法只放 id 的字串也收。這是核心與功能之間約定的形狀：存檔摘要、之後讀出身的功能都照這個讀。
 */
export function originIdOf(actor: { ext: Record<string, unknown> } | undefined): string | undefined {
  const o = actor?.ext.origin
  if (typeof o === 'string') return o || undefined
  return isRecord(o) && typeof o.id === 'string' && o.id ? o.id : undefined
}

/** 存檔的摘要。originName 是「出身的 id → 給玩家看的名字」（Game.save 用內容查；沒給就只放 id）。 */
export function saveMeta(state: GameState, kind: SaveMeta['kind'], savedAt: string, label?: string, originName?: (id: string) => string | undefined): SaveMeta {
  const pc = state.pc ? state.actors[state.pc] : undefined
  const place = [state.location.district, state.location.block, state.location.facility].filter(Boolean).join(' · ')
  const origin = originIdOf(pc)
  const name = origin ? originName?.(origin) : undefined
  return {
    label: label ?? `${pc?.name ?? '還沒建角'}・${formatTime(state.time)}`, day: state.time.day, time: formatTime(state.time), place, savedAt, kind,
    ...(pc ? { pc: { name: pc.name, ...(origin ? { origin } : {}), ...(name ? { originName: name } : {}) } } : {}),
  }
}

export function packSave(state: GameState, meta: SaveMeta): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, meta, state } satisfies SaveFile)
}

export type Unpacked = { ok: true; file: SaveFile; fromVersion: number } | { ok: false; error: string }

/** 狀態的結構檢查。回傳問題的清單。 */
export function validateState(s: unknown): string[] {
  if (!isRecord(s)) return ['狀態要是一個物件']
  const p: string[] = []
  const int = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v)
  if (!isRecord(s.rng) || !int(s.rng.seed) || !int(s.rng.cursor)) p.push('rng：要有整數的 seed 與 cursor')
  if (!isValidTime(s.time)) p.push('time：不是合法的時間')
  if (!isRecord(s.money) || !int(s.money.cred) || !int(s.money.cash) || (s.money.cred as number) < 0 || (s.money.cash as number) < 0) p.push('money：帳戶與現金要是 0 以上的整數')
  if (!isRecord(s.actors)) p.push('actors：要是一個物件')
  else for (const [id, a] of Object.entries(s.actors)) {
    for (const e of validateActor(a)) p.push(`actors.${id}：${e}`)
    if (isRecord(a) && a.id !== id) p.push(`actors.${id}：id 和鍵不一樣`)
  }
  if (s.pc !== null && !(typeof s.pc === 'string' && isRecord(s.actors) && s.pc in s.actors)) p.push('pc：主角不在 actors 裡')
  if (!Array.isArray(s.party) || (isRecord(s.actors) && s.party.some((id) => !(String(id) in (s.actors as object))))) p.push('party：隊伍裡有不存在的角色')
  if (!Array.isArray(s.inventory) || s.inventory.some((x) => !isRecord(x) || typeof x.id !== 'string' || !int(x.qty) || (x.qty as number) <= 0)) p.push('inventory：每一疊要有 id 與正整數的 qty')
  for (const k of ['flags', 'counters', 'ext', 'location', 'seq'] as const) if (!isRecord(s[k])) p.push(`${k}：要是一個物件`)
  for (const k of ['reports', 'chains'] as const) if (!Array.isArray(s[k])) p.push(`${k}：要是一個陣列`)
  // 進行中的戰鬥：和提交時同一套檢查（輪到誰指得到人、一格一個單位、每格最多一台無人機……）。
  // 壞掉的戰鬥讀進來會卡死：每一步都丟錯，又因為「正在戰鬥」什麼別的都不能做
  if (s.battle !== null && s.battle !== undefined) for (const e of battleProblems(s.battle)) p.push(`battle：${e}`)
  if (!isRecord(s.maps) || !isRecord(s.maps.instances) || !(s.maps.at === null || isRecord(s.maps.at))) p.push('maps：要有 instances 與 at')
  if (!Array.isArray(s.snapshots) || s.snapshots.some((x) => !isRecord(x) || typeof x.id !== 'string' || typeof x.kind !== 'string' || typeof x.raw !== 'string')) p.push('snapshots：每一份要有 id、kind 與 raw')
  return p
}

export interface UnpackOpts {
  /** 遷移步驟表與現在的版本；測試用。正式的程式不用給 */
  migrations?: Migration[]
  version?: number
}

export function unpackSave(raw: string, opts: UnpackOpts = {}): Unpacked {
  const current = opts.version ?? SAVE_VERSION
  const migrations = opts.migrations ?? MIGRATIONS
  let d: unknown
  try {
    d = JSON.parse(raw)
  } catch {
    return { ok: false, error: '這不是存檔：JSON 讀不出來。' }
  }
  if (!isRecord(d) || d.format !== SAVE_FORMAT) return { ok: false, error: '這不是存檔：缺了格式標記。' }
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) return { ok: false, error: '存檔的版本號不對。' }
  if (d.version > current) return { ok: false, error: `存檔格式 ${d.version} 比這個版本新，讀不了。` }
  if (!isRecord(d.state)) return { ok: false, error: '存檔裡沒有狀態。' }

  const fromVersion = d.version
  let state = clone(d.state) as Record<string, unknown>
  for (let v = fromVersion; v < current; v++) {
    const step = migrations.find((m) => m.from === v)
    if (!step) return { ok: false, error: `沒有從第 ${v} 版升上來的遷移步驟。` }
    state = step.run(state)
  }
  // 補缺的欄位（新版多出來、舊存檔沒有的），存檔規則另外清一次
  const blank = blankState(0) as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(blank)) if (state[k] === undefined) state[k] = v
  state.version = current
  state.rules = sanitizeRules(state.rules)
  state.seq = { ...(blank.seq as object), ...(isRecord(state.seq) ? state.seq : {}) }

  const problems = validateState(state)
  if (problems.length) return { ok: false, error: `存檔壞了（${problems.slice(0, 3).join('；')}）。` }
  const young = underageAt(state)
  if (young.length) return { ok: false, error: `存檔裡有低於 18 的年齡（${young.slice(0, 3).join('、')}）：所有角色都是成年人，整筆不讀。` }
  const meta = isRecord(d.meta) ? (d.meta as unknown as SaveMeta) : saveMeta(state as unknown as GameState, 'manual', '')
  return { ok: true, fromVersion, file: { format: SAVE_FORMAT, version: current, meta, state: state as unknown as GameState } }
}
