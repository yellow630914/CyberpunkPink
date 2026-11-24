// 內海欄的測試資料（M3-skill-net-a）：槍手、潛網者、改造師、機師四棵樹，逐條照 SKILL_TREES 的「內海」欄寫成技能格式。
// 只用來證明格式寫得出來：不進 engine/data（正式的資料等 cpp-data）。現實欄一律 null（現實的資料在各自的 M1b 測試裡），輿論欄 null。
// 每個技能一筆 SkillNote：內海欄的原文、做得出來的程度（done 做了、approx 近似、none 寫不出來、wait 等 M5／M6）與一句說明。

export type Rec = Record<string, unknown>
export type Status = 'done' | 'approx' | 'none' | 'wait'

export interface SkillNote {
  id: string
  name: string
  /** 設計書內海欄的原文（「—」是這一欄沒有效果） */
  text: string
  status: Status
  note: string
}

export interface Tree {
  path: Rec
  abilities: Rec[]
  notes: SkillNote[]
}

/** 效果清單裡常用的：buff 一筆。 */
export const buff = (id: string, name: string, o: Rec = {}): Rec => ({ op: 'buff', who: 'self', id, name, turns: 1, until: 'own_turn_end', ...o })

/**
 * 一棵樹的建造器：skill(...) 寫一個技能（net 欄與消耗照 more），notes 同時記下它的原文與狀態。
 * layer：sig 招牌、front 前層、back 後層。內海欄是 null 的（「—」）用 gap。
 */
export function treeOf(path: Rec, category: string) {
  const abilities: Rec[] = []
  const notes: SkillNote[] = []
  const pathId = path.id as string

  const add = (
    id: string, name: string, tier: number, layer: 'sig' | 'front' | 'back', kind: string, cap: number, cells: number, after: string | undefined,
    text: string, status: Status, note: string, more: Rec,
  ): void => {
    abilities.push({
      id, name, path: pathId, category, tier, layer: layer === 'sig' ? 'signature' : layer, kind, cap, xp: tier * 20, cells,
      ...(layer === 'sig' ? {} : { after }),
      text: `${name}。內海：${text}`, meat: null, net: null, opinion: null, ...more,
    })
    notes.push({ id, name, text, status, note })
  }
  return {
    path, abilities, notes,
    /** 內海欄有東西的技能。 */
    skill: add,
    /** 內海欄是「—」：net 是 null。 */
    gap: (id: string, name: string, tier: number, layer: 'sig' | 'front' | 'back', kind: string, cap: number, cells: number, after: string | undefined, more: Rec = {}): void =>
      add(id, name, tier, layer, kind, cap, cells, after, '—', 'done', '內海沒有效果（net: null）', more),
  }
}

export type Builder = ReturnType<typeof treeOf>
