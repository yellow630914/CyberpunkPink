// L2 內容：內容登錄表。每個領域（屬性、基本功、出身、特質、物品、行動種類……）是一個 kind，各自有驗證。
// 取代 ElondiaRPG 那個 2,706 行的 data.ts：核心只認得「一筆內容有 id」，其餘由註冊 kind 的人定義。
// 格式錯誤一律擋下：欄位不對、id 重複、引用不存在的東西（GAME_DESIGN 第 3 節第 13 條）。
// 覆蓋（模組、世界包）照「快照 → 還原 → 套用」：每次都從乾淨的基底重新套，不會越疊越髒。

import { isId, isRecord } from '../util/sanitize'
import { clone } from '../util/clone'

export interface ContentEntry {
  id: string
  [field: string]: unknown
}

export interface ContentKindDef<T extends ContentEntry = ContentEntry> {
  kind: string
  /** 誰註冊的（core 或功能 id），探針與錯誤訊息用 */
  owner: string
  /** 驗證一筆的格式；回傳錯誤訊息（空的就是合格）。id 的格式與重複由登錄表檢查，這裡不用管。 */
  validate(entry: Record<string, unknown>): string[]
  /** 這一筆引用了哪些別的內容：[kind, id]。checkRefs 用它找出引用不存在的東西。 */
  refs?(entry: T): Array<[kind: string, id: string]>
}

export class ContentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`內容的格式錯誤（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
    this.name = 'ContentError'
  }
}

/** 一份覆蓋：每個 kind 可以新增或取代幾筆、拿掉幾筆。 */
export interface ContentOverlay {
  id: string
  content: Record<string, { set?: ContentEntry[]; remove?: string[] }>
}

/** 世界包：一批內容，鍵是 kind。 */
export interface ContentPack {
  id: string
  version?: number
  content: Record<string, ContentEntry[]>
}

type Store = Map<string, ContentEntry>

export class ContentRegistry {
  private kinds = new Map<string, ContentKindDef>()
  private stores = new Map<string, Store>()
  private base: Map<string, Store> | null = null
  private listeners: Array<(event: { type: 'kind' | 'load'; kind: string; owner: string; count?: number }) => void> = []

  onChange(fn: (event: { type: 'kind' | 'load'; kind: string; owner: string; count?: number }) => void): void {
    this.listeners.push(fn)
  }

  defineKind<T extends ContentEntry>(def: ContentKindDef<T>): void {
    if (this.kinds.has(def.kind)) throw new Error(`內容種類重複註冊：${def.kind}（已經由 ${this.kinds.get(def.kind)!.owner} 註冊）`)
    this.kinds.set(def.kind, def as unknown as ContentKindDef)
    this.stores.set(def.kind, new Map())
    for (const fn of this.listeners) fn({ type: 'kind', kind: def.kind, owner: def.owner })
  }

  hasKind(kind: string): boolean {
    return this.kinds.has(kind)
  }

  kindIds(): string[] {
    return [...this.kinds.keys()]
  }

  /** 驗證一批內容，不寫入。回傳錯誤訊息。 */
  validate(kind: string, entries: unknown): string[] {
    const def = this.kinds.get(kind)
    if (!def) return [`${kind}：沒有這個內容種類`]
    if (!Array.isArray(entries)) return [`${kind}：要是一個陣列`]
    const problems: string[] = []
    const seen = new Set<string>()
    entries.forEach((e, i) => {
      const at = `${kind}[${i}]`
      if (!isRecord(e)) return void problems.push(`${at}：要是一個物件`)
      if (!isId(e.id)) return void problems.push(`${at}.id：要是小寫英文、數字與底線（拿到 ${JSON.stringify(e.id)}）`)
      if (seen.has(e.id)) problems.push(`${at}.id：${e.id} 重複`)
      seen.add(e.id)
      for (const p of def.validate(e)) problems.push(`${kind}/${e.id}：${p}`)
    })
    return problems
  }

  /** 載入一批內容。有任何格式錯誤或 id 已經存在就整批不收，丟出 ContentError。 */
  load(kind: string, entries: unknown, opts: { replace?: boolean } = {}): void {
    const problems = this.validate(kind, entries)
    const store = this.stores.get(kind)
    if (store && !opts.replace && Array.isArray(entries)) {
      for (const e of entries) if (isRecord(e) && typeof e.id === 'string' && store.has(e.id)) problems.push(`${kind}/${e.id}：id 重複（已經載入過）`)
    }
    if (problems.length) throw new ContentError(problems)
    for (const e of entries as ContentEntry[]) store!.set(e.id, clone(e))
    for (const fn of this.listeners) fn({ type: 'load', kind, owner: this.kinds.get(kind)!.owner, count: (entries as unknown[]).length })
  }

  loadPack(pack: ContentPack): void {
    const problems: string[] = []
    for (const [kind, entries] of Object.entries(pack.content)) problems.push(...this.validate(kind, entries))
    if (problems.length) throw new ContentError(problems)
    for (const [kind, entries] of Object.entries(pack.content)) this.load(kind, entries)
  }

  get<T extends ContentEntry = ContentEntry>(kind: string, id: string): T | undefined {
    return this.stores.get(kind)?.get(id) as T | undefined
  }

  /** 一定要有；沒有就丟錯（引用不存在的東西）。 */
  require<T extends ContentEntry = ContentEntry>(kind: string, id: string): T {
    const e = this.get<T>(kind, id)
    if (!e) throw new Error(`引用了不存在的內容：${kind}/${id}`)
    return e
  }

  has(kind: string, id: string): boolean {
    return !!this.stores.get(kind)?.has(id)
  }

  list<T extends ContentEntry = ContentEntry>(kind: string): T[] {
    return [...(this.stores.get(kind)?.values() ?? [])] as T[]
  }

  /** 引用檢查：每一筆的 refs 都要找得到。回傳問題的清單（空的就是全部找得到）。 */
  checkRefs(): string[] {
    const problems: string[] = []
    for (const [kind, def] of this.kinds) {
      if (!def.refs) continue
      for (const e of this.stores.get(kind)!.values()) {
        for (const [k, id] of def.refs(e)) if (!this.has(k, id)) problems.push(`${kind}/${e.id}：引用了不存在的 ${k}/${id}`)
      }
    }
    return problems
  }

  // ---- 覆蓋：快照 → 還原 → 套用 ----

  /** 把現在的內容記成基底。第一次套覆蓋時自動做。 */
  snapshotBase(): void {
    this.base = new Map([...this.stores].map(([k, s]) => [k, new Map([...s].map(([id, e]) => [id, clone(e)]))]))
  }

  /** 還原到基底（沒有基底就不動）。 */
  restoreBase(): void {
    if (!this.base) return
    for (const [k, s] of this.base) this.stores.set(k, new Map([...s].map(([id, e]) => [id, clone(e)])))
  }

  /**
   * 套用一組覆蓋：先還原到基底，再照順序套。任何一份有格式錯誤或引用斷掉，整組不套（還原回基底）並丟出 ContentError。
   */
  applyOverlays(overlays: ContentOverlay[]): void {
    if (!this.base) this.snapshotBase()
    this.restoreBase()
    const problems: string[] = []
    for (const ov of overlays) {
      for (const [kind, patch] of Object.entries(ov.content)) {
        const store = this.stores.get(kind)
        if (!store) {
          problems.push(`覆蓋 ${ov.id}：沒有 ${kind} 這個內容種類`)
          continue
        }
        const errs = this.validate(kind, patch.set ?? [])
        if (errs.length) {
          problems.push(...errs.map((e) => `覆蓋 ${ov.id}：${e}`))
          continue
        }
        for (const e of patch.set ?? []) store.set(e.id, clone(e))
        for (const id of patch.remove ?? []) store.delete(id)
      }
    }
    problems.push(...this.checkRefs())
    if (problems.length) {
      this.restoreBase()
      throw new ContentError(problems)
    }
  }
}
