// 測試用：把背包裡編號 uid 的那一副甲板裝進主角的腦部（M4-cyber-deck：甲板是腦部的義體，背包裡的甲板不能直接 deck.equip）。
// 不經手術（不收費、不休養、不算沉溺），腦裡原本那一副（有的話）整副放回背包；槽上的構裝照舊記在 ext.deck.slots。
// 這是 M3 的測試「一開始就裝著一副甲板」的接法；要測手術本身的是引擎的 M4-cyber-deck。

type Rec = Record<string, unknown>
interface Eng {
  state: { pc: string | null; inventory: Array<{ id: string; data?: Rec }>; actors: Record<string, { ext: Rec }> }
  commit(r: { summary: string; changes: never[] }): string | null
}

export function wearDeck(e: Eng, uid: string): string | null {
  const pc = e.state.pc
  if (!pc) return '還沒有主角。'
  const stack = e.state.inventory.find((s) => s.data?.uid === uid)
  if (!stack) return '背包裡沒有那一副甲板。'
  const raw = e.state.actors[pc]!.ext.cyber as { pieces?: Rec[] } | undefined
  const old = (Array.isArray(raw?.pieces) ? raw!.pieces : []).filter((p) => p.slot === 'brain' && p.kind_of === 'deck')
  const pieces = [...(Array.isArray(raw?.pieces) ? raw!.pieces : []).filter((p) => !old.includes(p)), { uid, bp: stack.id, kind_of: 'deck', slot: 'brain', parts: {}, sink: 0, at: 0 }]
  const changes = [
    ...old.map((p) => ({ op: 'item', id: p.bp, qty: 1, data: { uid: p.uid } })),
    { op: 'item', id: stack.id, qty: -1, data: { uid } },
    { op: 'actor.ext', id: pc, key: 'cyber', value: { ...(raw ?? {}), pieces } },
  ] as never[]
  return e.commit({ summary: '裝上甲板', changes })
}
