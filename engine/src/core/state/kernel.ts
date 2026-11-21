// L3 狀態核心：這一層的核心物件。登錄表與掛鉤都掛在一個 kernel 上，不用模組層級的全域變數
// （ElondiaRPG 有 12 個設定經由監看寫進引擎的全域變數；這裡每個測試、每個存檔各拿各的 kernel）。dev/adr/0002。

import { registerCoreKinds } from '../content/kinds'
import { ContentRegistry } from '../content/registry'
import type { TimeRules } from '../util/time'
import { DEFAULT_TIME_RULES } from '../util/time'
import { ChangeRegistry } from './changes'
import { registerCoreChanges } from './coreChanges'
import { HookBus } from './hooks'
import { Probe } from './probe'

export interface StateKernel {
  probe: Probe
  content: ContentRegistry
  changes: ChangeRegistry
  hooks: HookBus
  timeRules: TimeRules
  /** 嚴格模式：每次提交都檢查掛鉤有沒有偷改狀態（要多複製一次狀態）。測試一律開，正式版關。 */
  strict: boolean
}

export function createStateKernel(): StateKernel {
  const probe = new Probe()
  const content = new ContentRegistry()
  registerCoreKinds(content)
  content.onChange((e) => probe.emit('core/content/registry', e.type === 'kind' ? 'registry.register' : 'content.load', { registry: 'content', id: e.kind, owner: e.owner, count: e.count }))
  const changes = new ChangeRegistry(probe)
  registerCoreChanges(changes)
  return { probe, content, changes, hooks: new HookBus(probe), timeRules: { ...DEFAULT_TIME_RULES }, strict: false }
}
