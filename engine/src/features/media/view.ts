// L6 功能 media 給畫面的檢視：紀錄的清單（能不能轉、不能轉的原因）、素材庫、片。純函式，不改狀態。

import type { GameState, Kernel } from '../../core'
import { povText } from './pov'
import type { Pov } from './pov'
import { camRows } from './cams'
import type { CamRow } from './cams'
import { lensInfos } from './lens'
import type { LensInfo } from './model'
import { TYPE_NAME, materialOfClip, materialOfFootage, mediaRules, qualityParts, readMedia, recorderOf } from './model'
import { angleOf } from './angles'
import { recutReady } from './cut'
import type { Footage, Material, Mark, MediaType, RecordEntry } from './model'
import { convertBlock } from './chain'
import { isRecording } from './record'

export interface RecordRow {
  id: string
  /** 記下來的時間（總分鐘） */
  at: number
  label: string
  type: MediaType
  type_name: string
  marks: Mark[]
  by: string | null
  by_name: string | null
  /** 當時的錄影等級（沒錄到是 0） */
  grade: number
  exclusive: boolean
  retracted: boolean
  made: string | null
  /** 視角與給玩家看的一句話（「〇〇的 POV」「跟拍」「無人機跟拍」……）、同一件事的鍵 */
  pov: Pov
  pov_text: string
  event: string
  /** 現在轉得了嗎；轉不了 why 是完整的一句原因 */
  can: boolean
  why: string | null
  /** 現在轉的話品質是多少、上限多少（轉不了是 null） */
  quality: number | null
  cap: number | null
}

export interface FootageRow extends Material {
  /** 用完了（次數是 0）：只剩當紀念，不能再用任何一種用法 */
  spent: boolean
  made_at: number
  origin: Footage['origin']
  authentic: Footage['authentic']
  from_record: string | null
}

export interface ClipRow extends Material {
  /** 用完了（次數是 0）：只剩當紀念 */
  spent: boolean
  made_at: number
  /** 來源素材的 id */
  from: string[]
  angle_name: string
  /** 標題或簡介是玩家寫的 */
  titled: boolean
  recut: boolean
  /** 現在能不能重剪（要換成哪一種角度另外看）；不能的原因是完整的一句 */
  can_recut: boolean
  recut_why: string | null
  /** 抹黑把責任導向的勢力 */
  blame: string | null
}

export interface MediaView {
  /** 錄影的開關 */
  rec: boolean
  /** 現在有沒有真的在錄（開著、有人錄得到、這裡准錄） */
  recording: boolean
  /** 隊伍裡錄影等級最高的人；沒有是 null */
  recorder: { id: string; name: string; grade: number } | null
  /** 現在在場的每一個鏡頭（義體、無人機、攝影機）：一件事結束時各記一則紀錄 */
  lenses: LensInfo[]
  /** 架好的攝影機（拿著、別著、架著） */
  cams: CamRow[]
  /** 新的在前 */
  records: RecordRow[]
  /** 素材庫（用完的也列，標成 spent） */
  footage: FootageRow[]
  /** 片（新的在前） */
  clips: ClipRow[]
}

const seqOf = (id: string): number => Number(id.replace(/^\D+/, '')) || 0

function rowOf(k: Kernel, state: GameState, r: RecordEntry): RecordRow {
  const why = convertBlock(k, state, r.id)
  const q = why === null ? qualityParts(k, state, r) : null
  return {
    id: r.id, at: r.at, label: r.label, type: r.type, type_name: TYPE_NAME[r.type], marks: [...r.marks], by: r.by, by_name: r.by ? state.actors[r.by]?.name ?? r.by : null, grade: r.grade,
    pov: { ...r.pov }, pov_text: povText(state, r.pov), event: r.event, exclusive: r.exclusive, retracted: r.retracted === true, made: r.made ?? null, can: why === null, why, quality: q?.value ?? null, cap: q?.cap ?? null,
  }
}

/** 紀錄、素材庫、片的清單（畫面的「紀錄」與「素材」分頁用）。 */
export function mediaView(k: Kernel, state: GameState): MediaView {
  const m = readMedia(state)
  const rules = mediaRules(k)
  const who = recorderOf(k, state)
  return {
    lenses: lensInfos(k, state), cams: camRows(k, state), rec: m.rec, recording: isRecording(k, state), recorder: who ? { id: who.id, name: state.actors[who.id]?.name ?? who.id, grade: who.grade } : null,
    records: Object.values(m.records).sort((a, b) => b.at - a.at || seqOf(b.id) - seqOf(a.id)).map((r) => rowOf(k, state, r)),
    footage: Object.values(m.footage).sort((a, b) => b.made_at - a.made_at || seqOf(b.id) - seqOf(a.id)).map((f) => ({
      ...materialOfFootage(k, state, f, rules), spent: f.uses <= 0, made_at: f.made_at, origin: f.origin, authentic: f.authentic, from_record: f.from_record ?? null,
    })),
    clips: Object.values(m.clips).sort((a, b) => b.made_at - a.made_at || seqOf(b.id) - seqOf(a.id)).map((c) => {
      const why = recutReady(k, state, c.id)
      return {
        ...materialOfClip(k, state, c, rules), spent: c.uses <= 0, made_at: c.made_at, from: [...c.from], angle_name: angleOf(k, c.angle)?.name ?? c.angle, titled: c.titled === true,
        recut: c.recut === true, can_recut: why === null, recut_why: why, blame: c.blame ?? null,
      }
    }),
  }
}
