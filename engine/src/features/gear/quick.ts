// 快取格放得進什麼（EQUIPMENT 第 2 節表、4.1 節：藥、彈匣、手榴彈、工具；每格一件小東西；加上大小 2 以下的義體成品，戰地手術用）。規則只在這裡：
// gear.quick 的 validate 查它，介面（背包、角色的裝備分頁）也問它，不再自己留一張表。

import type { BlueprintEntry, ItemEntry, Kernel } from '../../core'

/** 能放進快取格的物品大類：消耗品（含手榴彈、急救品）、藥、彈藥（彈匣）、工具。 */
export const QUICK_CATEGORIES: readonly string[] = ['consumable', 'drug', 'ammo', 'tool']

/** 這件東西不能放進快取格的原因；可以放回傳 null。item 是背包裡的物品編號（目錄上的一件東西；組好的成品與設計圖、零件都不行）。 */
export function quickBlock(k: Pick<Kernel, 'content'>, item: string): string | null {
  const entry = k.content.get<ItemEntry>('item', item)
  // 義體成品（P47：戰地手術 implant_install 要從快取格拿得到）：設計圖是義體、不是橋、不是甲板、大小 2 以下的才放得進來
  if (!entry) {
    const bp = k.content.get<BlueprintEntry & { deck?: unknown; size?: number }>('blueprint', item)
    if (bp && bp.kind === 'cyberware' && bp.slot && bp.slot !== 'bridge' && !bp.deck && (bp.size ?? 0) <= 2) return null
  }
  if (!entry) return '這一件不能放進快取格（快取格只放藥、彈匣、手榴彈與工具）。'
  // 藥（ITEMS 第 4 節）：category 是 drug，或帶 drug 標籤的消耗品
  if (QUICK_CATEGORIES.includes(entry.category) || entry.tags?.includes('drug')) return null
  return '這一件不能放進快取格（快取格只放藥、彈匣、手榴彈與工具）。'
}
