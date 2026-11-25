// L6 功能：義體（身上的義體；CYBERWARE 第 1～3 節；CRAFTING 8.1、10.2 節；TRADE 3.4 節；DATA 7.1、3.4 節；dev/adr/0019 第三節與 P1～P6；dev/work/M4-cyberware.md）。
//
// 部位與槽、把一件成品裝上去與拆下來的手術（四種人動刀）、沉溺成本墊高沉溺的下限、義體的效果（被動效果，來源 cyber 與 quirk）、休養與併發症。
// 橋（換橋）、甲板（腦部的義體，deck.ts）、戰鬥（battle.ts、battleDef.ts、pump.ts：義體進戰鬥、開關與修正、藥泵、戰地手術）已經做了；授權鎖、解鎖、修理、小手術（換零件）在 lock.ts、crack.ts、repair.ts、modify.ts（M4-cyber-lock）。生體件的成長不在這裡。
//
// 接上核心的地方：
//   內容  cyber_rule（規則表，overridable；id: default）：槽數、四種人動刀的費用與併發症、休養、自己動刀的條件（model.ts 的 DEFAULT_CYBER_RULES）；
//         設施種類（world 的 facility_type）多讀 clinic: { grade: 'clinic' | 'unlicensed' | 'black' }（載入之後 ready 檢查格式）
//   數值  surgery_sink_pct（動刀的人讓沉溺成本加減百分之幾；基礎 0、夾在 −25～0；別的功能用 provider 或被動效果加）
//   被動  k.passives.register 來源 cyber（沉溺下限＋生效義體的 effects 與板材護甲）、quirk（身上義體帶著的怪癖的 effects）
//   條件  cyber { slot?, bp?, tag?, min? }（身上有幾件符合的，預設至少 1）；用到別人登記的：at_facility（站在哪種診所）、at_home（住處）、ability（自己動刀；沒有人登記就沒有自己動刀）
//   掛點  scene.body（features/scene 宣告）：現實層回答好了的義體的 scene_parts；
//         creation.step（features/creation 宣告）：建角第 6 步的橋與義體（點數、沒有橋、每個部位的槽數）、第 9 步的甲板（creation.ts）；
//         deck.source（features/deck 宣告）：回答腦部那一件甲板的數字（deck.ts；設計圖帶 deck 欄位的，或內容種類 deck 的成品；kind_of: 'deck'）
//   狀態  actor.ext.cyber：{ pieces: CyberPiece[] }（形狀見 model.ts；只經由報告裡的 actor.ext 變更寫）；休養中掛角色狀況 recovering
//         橋（bridge.ts）：衍生數值 bridge_cap_meat／net／social／media（晶片給總量、軟體分四類、加零件的親和；沒有橋是 0；abilities 讀它們）；
//         規則表多 deck_sink_default（成品甲板裝進腦部的沉溺成本，6）、bridge_fee_mult、bridge_recovery_minutes、bridge_swap_sink、cap_min；換橋用效果 sink_floor（有人註冊才給）。
//   戰鬥  loadout 的 implants（現實的戰場；不含橋）、衍生數值 cyber_count（不是橋的件數）、設計圖的 battle 欄位（actions、toggle、scaling、vs、pump；battleDef.ts）註冊成行動與修正、
//         行動 cyber_pump、效果 op implant_install（戰地手術）、戰鬥結束時寫回（battle.ts）；重的重創（狀況 wound_head、wound_limb）讓眼／腦與手臂／腿的一件失效（cyberLive，讀的時候算）；
//         規則表多 pump_doses（藥泵一座幾劑）、set_bonus（原廠全套的套裝加成：牌子 → 被動效果）；設計圖多讀 implant_kind（失效與超頻的種類）
//   授權鎖  成品資料的 lock { kind: 'subscription' | 'contract', holder?, weekly?, owed? }；鎖住是那一件的 off: { why: 'lock' }（有 until 的到時間自己解開）；
//         掛點 bill.collect／bill.settled（訂閱的每週費用；沒付成就鎖、欠的記進 owed）、defeat.gear（三個效果回答 true）、scan.person（掃橋讀到的義體）；
//         效果 cyber_install、cyber_take、cyber_lock、cyber_unlock（內建的來源才收，ai: false）；二手的義體裝上時加殘響、可能種下惡意韌體（效果 malware，有人註冊才）；
//         規則表多 subscription_rate、crack_dc_bonus、crack_hostility、unlock_bonus、used_malware、repair_fee、repair_dc、repair_home_level；條件 cyber 多 tattoo、faction（光紋刺青）
// 報告（kind action）：cyber.install、cyber.remove、cyber.bridge、cyber.pump（戰鬥外替藥泵裝藥）、cyber.pay（補繳）、cyber.crack（破解）、cyber.repair、cyber.modify（小手術）。
// 對外：cyberOf、pieceSink、surgeons、swapBridgeBlock／swapBridgeProblems／swapBridgeDraft／bridgeQuote／bridgeCapacityOf／isBridge、installBlock／installProblems／installDraft／installQuote、removeBlock／removeProblems／removeDraft／removeQuote、cyberView、deckSourceOf／brainDeck／isDeckPiece、loadPumpDraft／pumpView／pumpProblems、battleImplants／cyberLive／defOf、
// lockView／payLockBlock／payLockDraft、crackBlock／crackQuote／crackDraft、repairBlock／repairQuote／repairDraft、modifyBlock／modifyQuote／modifyDraft、readLock／scanAnswer。

import type { Condition, ConditionCtx, ContentEntry, Feature, GameState, Kernel } from '../../core'
import { ContentError, TATTOO_KINDS, isRecord, isSafeInt } from '../../core'
import {
  CLINIC_GRADES, FACILITY_TYPE_KIND, OWNER, PART_IDS, RULE_KIND, baseSlot, cyberOf, isBridge, ruleProblems,
} from './model'
import { answerCreation } from './creation'
import { deckSourceOf, pieceBlueprint } from './deck'
import { BRIDGE_CATS, bridgeCapacityOf, capStatId } from './bridge'
import { recallDrafts, recallProblems } from './recall'
import { cyberPassives, quirkPassives, sceneBody } from './passive'
import { SURGERY_STAT } from './surgery'
import { installBattle, readyBattle } from './battle'
import { installEffects, installLockHooks } from './lock'
import { hackTraceAnswer, hackedAnswer, netTraceAnswer, traceProblems } from './trace'

export { cyberOf, cyberRules, DEFAULT_CYBER_RULES, hasBridge, isBridge, partIdOf, PART_IDS, PART_NAME, SURGEON_KINDS, SURGEON_NAME, isReady, isActive } from './model'
export type { CyberPiece, CyberRules, PartId, Side, SurgeonKind, SurgeonRule, CyberOff } from './model'
export {
  INSTALL_ACTION, REMOVE_ACTION, SURGERY_STAT, clinicHere, installBlock, installDraft, installProblems, installQuote, pieceSink, recoveryOf, removeBlock, removeDraft, removeProblems, removeQuote, selfListed, surgeons,
} from './surgery'
export type { InstallOpts, InstallQuote, RemoveOpts, RemoveQuote, SelfCheck, SurgeonOption } from './surgery'
export {
  BRIDGE_ACTION, BRIDGE_CATS, SINK_FLOOR_EFFECT, bridgeCapacityOf, bridgeOf, bridgeQuote, capStatId, capacityOfProduct, swapBridgeBlock, swapBridgeDraft, swapBridgeProblems,
} from './bridge'
export type { BridgeCapacity, BridgeCat, BridgeOpts, BridgeQuote, CapacityPart } from './bridge'
export { cyberView, viewPiece } from './view'
export type { CyberView, PieceStatus, ViewPart, ViewPiece } from './view'
export { sceneBody } from './passive'
export { INSTALL_OP, PUMP_ACTION, FIELD_ACTION, battleImplants, defOf, pieceKind, pumpCapacity } from './battle'
export { SYNC_BACKLASH, battleProblems, kindOfBlueprint, readBattle } from './battleDef'
export type { BattleAction, BattleDef, BattleMod, BattleScaling, BattleToggle, BattleVs } from './battleDef'
export { PUMP_REPORT, loadPumpDraft, pumpBlock, pumpItemBlock, pumpProblems, pumpView } from './pump'
export type { PumpOpts, PumpView } from './pump'
export { WOUND_HEAD, WOUND_LIMB, cyberLive, woundedUids } from './model'
export { DECK_FULL, brainDeck, deckSourceOf, isDeckPiece } from './deck'
export {
  BROKEN_OFF, GEAR_EFFECTS, INSTALL_EFFECT, LOCK_EFFECT, LOCK_KINDS, LOCK_OFF, SUBSCRIPTION_ORDER, SUBSCRIPTION_PREFIX, TAKE_EFFECT, UNLOCK_EFFECT, isLocked, readLock, scanAnswer, subscriptionLines, weeklyOf,
} from './lock'
export type { CyberLock, LockKind } from './lock'
export { CRACK_ACTION, PAY_ACTION, crackBlock, crackDraft, crackProblems, crackQuote, lockView, payLockBlock, payLockDraft, payLockProblems } from './crack'
export type { CrackOpts, CrackQuote, LockViewItem, PayLockOpts } from './crack'
export { FORGE_ACTION, forgeBlock, forgeDraft, forgeProblems, forgeQuote, isForgeVia } from './forge'
export type { ForgeOpts, ForgeQuote, ForgeVia } from './forge'
export { RECALL_ACTION, overdueTerms, readRecall, recallPenalty } from './recall'
export { REPAIR_ACTION, repairBlock, repairDraft, repairProblems, repairQuote } from './repair'
export type { RepairOpts, RepairQuote } from './repair'
export { MODIFY_ACTION, modifyBlock, modifyDraft, modifyProblems, modifyQuote } from './modify'
export type { ModifyOpts, ModifyQuote } from './modify'
export { usedExtras } from './used'
export type { DeckSourceAnswer } from './deck'

/** 獸化改造的設計圖標籤（條件 beast 看它）。 */
export const BEAST_TAG = 'beast'
const CAT_NAME = { meat: '現實', net: '內海', social: '社交', media: '媒體' } as const
type CyberCondition = Condition & { slot?: string; bp?: string; tag?: string; min?: number; tattoo?: string; faction?: string }
const SLOT_WORDS: readonly string[] = [...PART_IDS, 'arm', 'leg']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
/** 掛點 scene.body 是 features/scene 宣告的：這裡只認名字與格式，不 import（照 features/maze 掛 netrun.round 的做法）。 */
type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export const cyberwareFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 動刀的人讓沉溺成本加減百分之幾：基礎 0，手術刀的樹階等別的功能經 provider 加（負的是減）；夾在 −25～0（CYBERWARE 2.1 節）
    k.stats.defineStat({ id: SURGERY_STAT, owner: OWNER, name: '手術的沉溺成本加減（％）', base: () => 0, min: -25, max: 0 })

    // 橋的四類容量（P8；沒有橋是 0）：abilities 有這幾個數值時讀它們，否則照舊讀 ext.bridge.capacity
    for (const cat of BRIDGE_CATS) {
      k.stats.defineStat({ id: capStatId(cat), owner: OWNER, name: `橋的容量（${CAT_NAME[cat]}）`, base: (state, actor) => bridgeCapacityOf(k, state, actor).split[cat], min: 0 })
    }

    // 身上不是橋的義體件數（休養中、被鎖、重創讓失效的都算；敵人 AI 的 bridged 偏好看它：單位的 cyber）
    k.stats.defineStat({ id: 'cyber_count', owner: OWNER, name: '義體件數（不含橋）', base: (state, actor) => cyberOf(state, actor).filter((p) => !isBridge(p)).length, min: 0 })

    // 被動效果：沉溺的下限與義體的效果（cyber）、帶著的怪癖（quirk）
    k.passives.register(OWNER, 'cyber', (state, actor) => cyberPassives(k, state, actor), '義體')
    k.passives.register(OWNER, 'quirk', (state, actor) => quirkPassives(k, state, actor), '怪癖')

    // 條件 cyber：身上有幾件符合的
    k.conditions.register<CyberCondition>({
      kind: 'cyber', owner: OWNER,
      validate(raw) {
        const p: string[] = []
        if (raw.slot !== undefined && !(isText(raw.slot) && SLOT_WORDS.includes(raw.slot))) p.push(`slot 要是部位的 id（${SLOT_WORDS.join('、')}）`)
        if (raw.bp !== undefined && !isText(raw.bp)) p.push('bp 要是設計圖的 id')
        if (raw.tag !== undefined && !isText(raw.tag)) p.push('tag 要是設計圖 tags 裡的字')
        if (raw.min !== undefined && !(isSafeInt(raw.min) && raw.min >= 1)) p.push('min 要是 1 以上的整數')
        if (raw.tattoo !== undefined && !(typeof raw.tattoo === 'string' && (TATTOO_KINDS as readonly string[]).includes(raw.tattoo))) p.push(`tattoo 只能是 ${TATTOO_KINDS.join('、')}`)
        if (raw.faction !== undefined && !isText(raw.faction)) p.push('faction 要是勢力的 id')
        return p
      },
      test(c, { state, actor }: ConditionCtx) {
        const id = actor ?? state.pc
        if (!id || !state.actors[id]) return false
        const n = cyberOf(state, id).filter((piece) => {
          if (c.slot !== undefined && piece.slot !== c.slot && baseSlot(piece.slot) !== c.slot) return false
          if (c.bp !== undefined && piece.bp !== c.bp) return false
          if (c.tag !== undefined) {
            const tags = (pieceBlueprint(k, piece) as { tags?: unknown } | undefined)?.tags
            if (!Array.isArray(tags) || !tags.includes(c.tag)) return false
          }
          // 光紋刺青（P45）：設計圖的 tattoo { kind, faction? }；tattoo 與 faction 兩個鍵可以單寫或一起寫
          if (c.tattoo !== undefined || c.faction !== undefined) {
            const t = (pieceBlueprint(k, piece) as { tattoo?: { kind?: unknown; faction?: unknown } } | undefined)?.tattoo
            if (!t || (c.tattoo !== undefined && t.kind !== c.tattoo) || (c.faction !== undefined && t.faction !== c.faction)) return false
          }
          return true
        }).length
        return n >= (c.min ?? 1)
      },
    })

    // 條件 beast { who? }：身上有獸化改造（M4-followups-2 第 11 項）：任何一件身上的義體，設計圖的 tags 裡有 beast（獸耳、尾巴、獸爪……的設計圖寫這個標籤）
    k.conditions.register<Condition & { who?: string }>({
      kind: 'beast', owner: OWNER,
      validate: (raw) => (raw.who === undefined || isText(raw.who) ? [] : ['who 要是人的 id']),
      test(c, { state, actor }: ConditionCtx) {
        const id = c.who ?? actor ?? state.pc
        if (!id || !state.actors[id]) return false
        return cyberOf(state, id).some((piece) => {
          const tags = (pieceBlueprint(k, piece) as { tags?: unknown } | undefined)?.tags
          return Array.isArray(tags) && tags.includes(BEAST_TAG)
        })
      },
    })

    // 場景問身體：只在現實層回答（內海用的是化身）
    const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
    // 甲板是腦部的義體（M4-cyber-deck）：回答腦裡那一件的數字；有人掛這個掛點，features/deck 就不再看背包裡的甲板
    on('deck.source', OWNER, (({ state, actor }: { state: GameState; actor: string }) => deckSourceOf(k, state, actor)) as never)
    // 建角的第 6 步（橋與義體）與第 9 步的甲板（M4-creation-body）：features/creation 宣告掛點，這裡只認名字
    on('creation.step', OWNER, ((p: Parameters<typeof answerCreation>[1]) => answerCreation(k, p)) as never)
    on('scene.body', OWNER, (({ state, actor, layer }: { state: GameState; actor: string; layer: string }) => sceneBody(k, state, actor, layer)) as never)

    // 戰鬥（M4-cyber-battle）：loadout 的 implants、開關與修正、藥泵、戰地手術的效果 op、戰鬥結束時寫回
    installBattle(k)

    // 回答別的功能問的：快駭與網內探索的追蹤度（駭入接頭、回報後門）、被駭時讀走什麼（記憶庫）；掛點是 hack、netrun 宣告的，這裡只認名字（M4-core-gaps 第 4、20 項）
    on('hack.trace_mod', OWNER, (({ state, actor, faction }: { state: GameState; actor: string; faction?: string }) => hackTraceAnswer(k, state, actor, faction)) as never)
    on('netrun.trace_mod', OWNER, (({ state, party, faction, when }: { state: GameState; party: string[]; faction?: string; when: 'start' | 'rise' }) => netTraceAnswer(k, state, party, faction, when)) as never)
    on('net.hacked', OWNER, (({ state, party }: { state: GameState; party: string[] }) => hackedAnswer(k, state, party)) as never)

    // 橋每 N 天要回去重刻（M4-followups-2 第 3 項）：站在重刻的地點、離上次隔了一天以上，這一回合結束時重刻一次
    k.hooks.on('turn.end', OWNER, ({ state }) => {
      const drafts = recallDrafts(k, state)
      return drafts.length > 0 ? drafts : undefined
    })

    // 授權鎖（M4-cyber-lock）：四個效果（cyber_install、cyber_take、cyber_lock、cyber_unlock）、每週帳單的訂閱、defeat.gear、scan.person
    installEffects(k)
    installLockHooks(k)
  },

  ready(k) {
    const problems: string[] = []
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { clinic?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.clinic === undefined) continue
        const c = t.clinic
        if (!isRecord(c) || !(CLINIC_GRADES as readonly unknown[]).includes(c.grade)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：clinic 要是 { grade: ${CLINIC_GRADES.join(' | ')} }`)
      }
    }
    // 設計圖的 trace_mod、readable 欄位（M4-core-gaps 第 4、20 項）與橋的 recall（M4-followups-2 第 3 項）
    if (k.content.hasKind('blueprint')) {
      for (const e of k.content.list<ContentEntry & { trace_mod?: unknown; readable?: unknown; bridge?: unknown }>('blueprint')) {
        if (e.trace_mod !== undefined || e.readable !== undefined) problems.push(...traceProblems(e).map((m) => `blueprint/${e.id}：${m}`))
        problems.push(...recallProblems(e).map((m) => `blueprint/${e.id}：${m}`))
      }
    }
    if (problems.length) throw new ContentError(problems)
    // 設計圖的 battle 欄位：查格式、註冊成戰鬥的行動（效果要等所有功能都裝好才查得出有沒有人註冊，所以在這裡）
    readyBattle(k as Kernel)
  },
}

export { OWNER as CYBERWARE_OWNER, RULE_KIND as CYBER_RULE_KIND }
