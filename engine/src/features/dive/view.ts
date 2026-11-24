// L6 功能 dive：給畫面的（diveView）。沒有潛入時是「這裡能不能潛入」，潛入中是「在哪個接入點、用什麼甲板、去得了哪裡、登不登得出」。
// 畫面不自己算規則：每個按鈕的 block 是原因（null 是能按），送出去走 enter／go／exit。

import type { GameState, Kernel } from '../../core'
import type { DeckSource, OverKind } from './model'
import { accessName, readDive } from './model'
import type { DiveOptions } from './options'
import { diveOptions } from './options'
import type { SiteRow } from './ops'
import { exitBlock, sites } from './ops'

export interface DiveView {
  diving: boolean
  /** 沒有潛入時：這裡能不能潛入（站在哪種接入點、費用、為什麼不行）；潛入中也附著，blocks 說「已經潛入了」 */
  options: DiveOptions
  /** 潛入中的狀態；沒有潛入是 null */
  dive: {
    /** 接入點的名字與設施種類 */
    name: string
    type: string
    safe: number
    deck: DeckSource
    /** 付了多少：費用不退；押金登出時退（被強制斷線時沒收） */
    paid: { fee: number; deposit: number }
    /** 身體躺在哪（潛入時的位置） */
    body: { district?: string; block?: string; facility?: string }
    /** 被強制斷線了：等手上的事做完會自動登出 */
    over?: OverKind
  } | null
  /** 去得了的地方與去不了的原因（沒有潛入是空的） */
  sites: SiteRow[]
  /** 登出：現在登不登得出（block 是原因）、押金退多少（被強制斷線是 0）、一句提醒 */
  exit: { block: string | null; refund: number; note: string } | null
}

export function diveView(k: Kernel, state: GameState): DiveView {
  const d = readDive(state)
  const options = diveOptions(k, state)
  if (!d) return { diving: false, options, dive: null, sites: [], exit: null }
  const deposit = d.paid?.deposit ?? 0
  const refund = d.over ? 0 : deposit
  return {
    diving: true, options,
    dive: {
      name: accessName(d), type: d.access.type, safe: d.access.safe, deck: d.deck, paid: { fee: d.paid?.fee ?? 0, deposit },
      body: { ...(d.body.location.district ? { district: d.body.location.district } : {}), ...(d.body.location.block ? { block: d.body.location.block } : {}), ...(d.body.location.facility ? { facility: d.body.location.facility } : {}) },
      ...(d.over ? { over: d.over } : {}),
    },
    sites: sites(k, state),
    exit: {
      block: exitBlock(k, state), refund,
      note: d.over && deposit > 0 ? '被強制斷線了：租用甲板的押金沒收了。' : deposit > 0 ? '登出之後租用的甲板收回，押金退回。' : d.deck === 'rental' ? '登出之後租用的甲板收回。' : '登出之後意識回到身體。',
    },
  }
}
