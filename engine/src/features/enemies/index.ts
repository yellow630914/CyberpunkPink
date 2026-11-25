// L6 功能：敵人與遭遇。兩種內容（enemy、encounter）的格式；把一筆敵人資料照「等級與位階的目標表 × 兵種的修正 × 難度 × 強度係數」
// 變成戰鬥裡的單位（來源 enemy）；遭遇的點數與開打的設定；敵人的士氣（撤退與投降）。
// 照勢力、等級、位階挑兵種（來源 enemy_pick）在 pick.ts；打贏之後的俘虜在 capture.ts（M2-enemy-encounter）。
// 掉落的格式與打贏之後的結算在 loot.ts；現實的義體掉落（needs: 'dissect' 的 { blueprint }）要玩家戰後選一個解剖，在 dissect.ts（M4-craft-salvage）。敵方的無人機與砲塔（position.size: 'overlay'）、附屬單位（attached）、機甲的機體（hull，只收格式）
// 與會指揮的敵人的行動 enemy.command（M1b-enemy-units）在 overlays.ts；一台怎麼動在 features/summons。
// 敵人資料多收的欄位（M1b-enemy-moves）：signature（招牌行動：技能的 id 放進 unit.ext.abilities.equipped，技能那一邊本來就認；
// 還沒轉的敘述 { name, text } 收下、不做效果）、traits 與內容種類 enemy_trait（traits.ts）、cyber（變成 implants）、deck（放到 ext.deck）、
// mods.sink（記在 ext.enemies.sink）、angel（angel.ts）、defeat（字串或字串陣列）。蕾絲與網內的敵人還不在這裡。
// 內海面（M3-lace）：同一個來源 enemy 與 enemy_pick 拿到的戰場是內海時，照內海表組單位（stats.ts 的 netUnit）：沒有生命、有防護、RAM、武器構裝（constructs）、
// 固定的同步檔位（sync）、蕾絲的顏色（color 變標籤）、管理行動的次數（admin）；enemy_pick 照層挑網內的兵種（pick.ts）；掉落只有解剖拿得到的構裝與憑證（loot.ts）；
// 偏好深檔的 AI 與白蕾絲的撤走在 lace.ts；規則表 net_enemy_rule（憑證是哪件物品）。蕾絲的行為是招牌行動的資料加 AI 的參數，不替顏色寫程式。
// M4-enemies-m4：雙形象（forms.ts：一場擲一次，名牌與紀錄照目標換字）、縛／疊的效果與解開束縛（bind.ts）、沉溺高的敵人（承受層數在 stats.ts，被推過線在 sunk.ts）。
// 規格：ENEMIES 1.1、1.5、第 2 節、4.4 節、第 5 節、第 9 節、第 13 節；CYBERSPACE 8.7 節；ENEMY_ROSTER 開頭；BALANCE 2.4、7.2；dev/adr/0013（B2、D4～D6）、0015（E10、E11）、0018 第四節與 N18～N20。

import type { BattleUnit, Feature } from '../../core'
import { installCapture } from './capture'
import { enemyPickUnit } from './pick'
import { checkSignatures } from './signature'
import { registerAngel } from './angel'
import { bindWarnings, registerBind } from './bind'
import { installForms } from './forms'
import { installSunk } from './sunk'
import { registerLace } from './lace'
import { registerOverlays } from './overlays'
import { enemyUnit } from './stats'
import { OWNER, netEnemyWarnings, registerKinds } from './kinds'
import { installDissect } from './dissect'
import { installLoot } from './loot'
import { applyTraits, moraleDcBonus, registerTraitKind, runTraitStart } from './traits'

export { DEEP_SYNC_PCT, DEFAULT_SYNC, ENEMY_CURVE, ENCOUNTER_BUDGET, NET_CURVE, WHITE_LEAVES_AT } from './curve'
export { encounterPoints, enemyStats, overlayInit, setupFromEncounter } from './stats'
export type { EnemyStats, NetStats } from './stats'
export { NET_RULE_KIND, credentialItem } from './lace'
export type { NetEnemyRule } from './lace'
export { CASH_RANGE, LOOT_CAP } from './loot'
export type { LootBlueprint, LootConstruct, LootCredential, LootDrop, LootEntry, LootText } from './loot'
export { DISSECT_ACTION, DISSECT_EXT, DISSECT_HOSTILITY, DISSECT_MINUTES, DISSECT_SINK, DISSECT_WINDOW_MINUTES, dissectBlock, dissectDraft, dissectOf, dissectOptions } from './dissect'
export type { DissectOpts, DissectOption, DissectState, DissectTarget } from './dissect'
export { OVERLAY_KINDS } from './kinds'
export { LACE_COLORS, NET_ONLY_KINDS, NET_SYNC_VALUES, enemyMode, netCapable, netEnemyWarnings } from './kinds'
export type { EncounterEntry, EncounterFoe, EnemyAttached, EnemyConstruct, EnemyCyber, EnemyDeck, EnemyEntry, EnemyHull, EnemyOverlay, EnemySignature } from './kinds'
export type { TraitEntry } from './traits'
export { BIND_STATUS, UNBIND, UNBIND_AP, isBound } from './bind'
export { DEFAULT_FORM_B_CHANCE, SINK_EDGE, SINK_LAYER_STEPS, SINK_LINE, sinkLayers } from './curve'
export { GENDER_FILTER_TAG, NEUTRAL_MOVE_NAMES, chooseForm, formBChance, formFor, formKeyFor, formUsable, formViewOf, genderOf, hasForms, neutralMoveName, pickForm, rollFormKey, unitFormView, usableForms } from './forms'
export type { FormKey, FormView, UnitFormView } from './forms'
export { ENEMY_GENDERS } from './kinds'
export type { EnemyForm, EnemyFormMove, EnemyGender, EnemyNeutral } from './kinds'
export { FOE_SUNK_POINT, SUNK, dataSink, sunkUnits } from './sunk'
export { pickCandidates, pickEnemy, pickProblems } from './pick'
export type { PickSpec } from './pick'
export { ASK_DC, CAPTURE_BASE, CAPTURE_EXT, CAPTURE_MAX_OFFER, CAPTURE_PER_SEDUCE, CAPTIVE_TAG, askDc, canTake, captureCause, captureChance, captureKindOk, captureOf, pickEvent, rollCaptures, treatEvent } from './capture'
export type { CaptureCandidate, CaptureState } from './capture'

const MORALE_DC = { minion: 13, elite: 10 } as const

export const enemiesFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    registerTraitKind(k)
    k.battle.unitSource('enemy', OWNER, (ref, ctx) => enemyUnit(k, ctx.state, ref, ctx))
    // 照勢力、等級、位階挑一個兵種（M2-enemy-encounter）
    k.battle.unitSource('enemy_pick', OWNER, (ref, ctx) => enemyPickUnit(k, ctx.state, ref, ctx))
    // 掉落：打贏之後在戰鬥結束時結算（M1b-loot）
    installLoot(k, OWNER)
    // 戰後的解剖：打贏一場現實的戰鬥，把拆得到義體的敵人記下來，之後由玩家選（M4-craft-salvage）
    installDissect(k, OWNER)
    // 俘虜：打贏時被制伏的敵人擲一次，成功的交給事件視窗處置（M2-enemy-encounter）
    installCapture(k, OWNER)
    // 特徵：組好單位時算進去（一定帶著的加上開戰時擲的），開打時做 start；天使急救的倒數
    k.battle.on('unit.ready', OWNER, ({ run, unit }) => applyTraits(run, unit))
    k.battle.on('battle.start', OWNER, ({ run }) => runTraitStart(run))
    registerAngel(k)
    // 雙形象（一場擲一次；名牌與紀錄照目標換字）、成人地城的效果記號（縛、疊）與解開束縛、沉溺高的敵人被推過線（M4-enemies-m4）
    installForms(k)
    registerBind(k)
    installSunk(k)
    // 內海面：規則表 net_enemy_rule、偏好深檔的 AI、白蕾絲追蹤度夠高就撤走（M3-lace）
    registerLace(k)
    // 敵方的無人機與砲塔、附屬單位：開打時掛上去；會指揮的敵人多一個行動 enemy.command（一台怎麼動在 summons）
    registerOverlays(k)

    // 士氣（ENEMIES 4.4 節）：輪到 AI 操縱的敵人，每一步之前。每場只檢定一次
    k.battle.on('ai.step', OWNER, ({ run, unit }) => {
      if (!unit.enemy || unit.control !== 'ai' || unit.out) return
      if (unit.rank === 'boss' || unit.ai?.neverFlee || unit.uses.morale !== undefined) return
      // 契約人不能投降也不能撤退：橋權在公司手上，要公司准（4.4 節）。帶 contract 標籤的單位不檢定士氣
      if (unit.tags.includes('contract')) return
      const units = Object.values(run.battle.units)
      const mine = units.filter((u) => u.side === unit.side)
      const theirs = units.filter((u) => u.side !== unit.side)
      const bossOut = mine.some((u) => u.rank === 'boss' && u.out)
      // 生命比例只有現實才算：內海的單位沒有生命，flee_below 在內海不用（只剩「首領倒下、同伴倒了一半」兩個觸發；M3-lace 定）
      const net = run.mode.layer === 'net'
      const low = run.mode.layer === 'meat' && !!unit.hp && !!unit.ai && unit.hp.now / unit.hp.max < unit.ai.fleeBelow
      // 「同伴倒了一半」的分母是開打時記下的人數（核心在開打時寫進 origin.headcount）：之後叫來的增援不會把它墊高
      const started = run.battle.origin.headcount?.[unit.side] ?? mine.length
      const halfGone = mine.filter((u) => u.out).length * 2 >= started
      const check = unit.rank === 'minion' ? bossOut || halfGone || low : bossOut || low
      if (!check) return
      unit.uses.morale = 1
      // 特徵可以把 DC 加高或降低（老兵 −3、新人 +3）
      const { ok } = run.save(unit, 'resolve', 'composure', MORALE_DC[unit.rank] + moraleDcBonus(unit), '士氣', [], ['morale'])
      if (ok) return
      // 內海沒有投降（蕾絲與程式不被俘虜）：失敗一律是撤退，被踢出網（fled）
      if (net) {
        run.setOut(unit, 'fled')
        return true
      }
      // 被困在第 4 格（站在第 4 格，前面三格沒有還站著的同伴），或對方還站著的人數是自己這一方的兩倍以上就投降，否則撤退（ENEMIES 4.4 節；dev/adr/0013 D4）
      const standing = (list: BattleUnit[]) => list.filter((u) => !u.out).length
      const trapped = unit.slot === 4 && !mine.some((u) => u !== unit && !u.out && u.slot >= 1 && u.slot <= 3)
      run.setOut(unit, trapped || standing(theirs) >= 2 * standing(mine) ? 'surrendered' : 'fled')
      return true
    })
  },
  // 內容載入之後：招牌行動寫技能 id 的，要查得到而且標了 enemy（查不到由引用檢查擋下；這裡擋「查得到但不是招牌行動」的）
  ready(k) {
    checkSignatures(k)
  },
  // 資料檢查的警告（不擋載入）：網內的敵人沒有 constructs（白蕾絲除外）
  warnings(k) {
    return [...netEnemyWarnings(k.content), ...bindWarnings(k)]
  },
}
