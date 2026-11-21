// 核心物件（L5 的最上面）：所有的登錄表與掛鉤掛在一個 kernel 上。功能用 install(kernel) 把自己接上。

import { ActionRegistry, FREE_ACTION } from './action/kinds'
import type { ActionKernel } from './action/action'
import { createRulesKernel } from './rules/kernel'

export interface Kernel extends ActionKernel {
  /** 已經裝上的功能的 id */
  features: string[]
}

/** 一個 L6 的功能：只往下 import 核心，用登錄表與掛鉤把自己接上。功能之間不直接 import。 */
export interface Feature {
  id: string
  install(kernel: Kernel): void
}

export function createKernel(features: Feature[] = []): Kernel {
  const base = createRulesKernel()
  const actions = new ActionRegistry(base.probe)
  actions.register(FREE_ACTION)
  const k: Kernel = Object.assign(base, { actions, features: [] as string[] })
  for (const f of features) installFeature(k, f)
  return k
}

export function installFeature(k: Kernel, f: Feature): void {
  if (k.features.includes(f.id)) throw new Error(`功能重複安裝：${f.id}`)
  f.install(k)
  k.features.push(f.id)
  k.probe.emit('core/kernel', 'feature.install', { id: f.id })
}
