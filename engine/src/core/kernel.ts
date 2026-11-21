// 核心物件（L5 的最上面）：所有的登錄表與掛鉤掛在一個 kernel 上。功能用 install(kernel) 把自己接上。

import { ActionRegistry, FREE_ACTION } from './action/kinds'
import type { ActionKernel } from './action/action'
import { createRulesKernel } from './rules/kernel'

export interface Kernel extends ActionKernel {
  /** 已經裝上的功能的 id */
  features: string[]
  /** 還沒跑第二段的功能 */
  pendingReady: Feature[]
}

/** 一個 L6 的功能：只往下 import 核心，用登錄表與掛鉤把自己接上。功能之間不直接 import。 */
export interface Feature {
  id: string
  /** 第一段：註冊登錄表與掛鉤（內容種類、變更、效果、條件、衍生數值、檢定修正、行動種類……）。這時內容還沒載入 */
  install(kernel: Kernel): void
  /** 第二段（可以沒有）：內容載入之後呼叫一次。要讀內容才能註冊的東西放這裡（例：照資料註冊行動種類） */
  ready?(kernel: Kernel): void
}

export function createKernel(features: Feature[] = []): Kernel {
  const base = createRulesKernel()
  const actions = new ActionRegistry(base.probe)
  actions.register(FREE_ACTION)
  const k: Kernel = Object.assign(base, { actions, features: [] as string[], pendingReady: [] as Feature[] })
  for (const f of features) installFeature(k, f)
  return k
}

export function installFeature(k: Kernel, f: Feature): void {
  if (k.features.includes(f.id)) throw new Error(`功能重複安裝：${f.id}`)
  f.install(k)
  k.features.push(f.id)
  if (f.ready) k.pendingReady.push(f)
  k.probe.emit('core/kernel', 'feature.install', { id: f.id })
}

/** 內容載入之後呼叫：跑每個功能的第二段。可以重複呼叫，每個功能只跑一次。 */
export function readyFeatures(k: Kernel): void {
  for (const f of k.pendingReady.splice(0)) {
    f.ready!(k)
    k.probe.emit('core/kernel', 'feature.ready', { id: f.id })
  }
}
