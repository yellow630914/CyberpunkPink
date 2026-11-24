// L6 功能 deck：內容種類 deck（甲板，暫定的成品格式）、construct（構裝，DATA 7.3 節）、skin（DATA 7.4 節，引擎只讀 name）、deck_rule（規則的數字，可以被後載入的包取代）。

import type { Kernel } from '../../core'
import type { ConstructEntry, DeckEntry, SkinEntry } from './model'
import { CONSTRUCT_KIND, DECK_KIND, OWNER, RULE_KIND, SKIN_KIND, constructProblems, deckProblems, ruleProblems, skinProblems } from './model'

export function installKinds(k: Kernel): void {
  k.content.defineKind<DeckEntry>({ kind: DECK_KIND, owner: OWNER, validate: deckProblems })
  k.content.defineKind<ConstructEntry>({
    kind: CONSTRUCT_KIND, owner: OWNER,
    validate: (e) => constructProblems(k, e),
    refs: (e) => (e.class === 'weapon' && e.archetype ? [['weapon_class', e.archetype]] : []),
  })
  k.content.defineKind<SkinEntry>({ kind: SKIN_KIND, owner: OWNER, validate: skinProblems })
  k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
}
