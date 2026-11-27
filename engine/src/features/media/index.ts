// L6 功能：媒體的一條鏈——紀錄、素材、使用次數（M5-media-chain），剪、重剪、偽造、發布（M5-media-cut）
// （MEDIA 1.1 節、第 2、2.1、3、5 節；EVENTS 2.4 節的 footage；DATA 第 11 節；dev/adr/0020 第一節、第十三節、V1～V11、V54；dev/work/M5-media-chain.md、M5-media-cut.md）。
//
// 接上核心的地方：
//   內容  media_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_MEDIA_RULES）、footage_angle（剪輯的角度，overridable；angles.ts 的 DEFAULT_ANGLES 七筆）
//   衍生數值  cut_pick（剪的時候讓看點或可信 +1）、forge_bonus（偽造擲骰加值）、forge_quality（偽造的品質加成）、forge_risk（假料上架的風險加減，負的才有用）：只定義，預設 0
//   衍生數值  rec_grade（錄影等級）、footage_quality、footage_cap：只定義，預設 0。**不加任何 provider、不讀背包**：錄影是義體的事
//             （義體設計圖、零件、怪癖的 effects 寫 { stat: 'rec_grade', amount }，k.passives 的來源 cyber、quirk 就加上去；V64、使用者 2026-11-26 第 28 題）
//   變更  media.rec、media.add、media.stage、media.make、media.use、media.clip、media.recut、media.retitle（ops.ts）
//   效果  footage；條件  has_footage、rec_on（effects.ts）
//   掛鉤  activity.end（battle、scene、event 結束時記一則）、report.before（commission.milestone 那一拍出階段的那一則）、
//         rewind.keep（回到快照）、game.new（空的庫、錄影開著）
//         defeat.options（既有的掛點，留著當保命符：publish.ts 的 keepOptions）
//   掛點  media.materials、media.spend、media.record（這個功能宣告並回答；格式在 model.ts 的 declare module；素材與片都答）
//   狀態  state.ext.media：形狀見 model.ts 的 MediaState；只經由 media.* 變更（與回到快照時的 ext 變更）寫
// 報告（kind broadcast）：media.rec（開關錄影）、media.convert（轉成素材）、media.cut、media.recut、media.forge、media.upload、media.sell、media.deal；media.retitle（kind system，不花時間）。
// 對外：mediaView、setRecording、recordingBlock、convertDraft、convertBlock、materialOf、materialsOf、spend（掛點 media.spend 的實作）；
//       angleOptions、cutPreview、cut、recut、retitle、forge、upload、uploadPreview、sell、sellPrice、deal、dealTargets（cut.ts、publish.ts）。
//
// 不碰別的功能：不讀別的功能的 state.ext；副本、場景、事件的資訊只從 activity.end 的 origin 與 result、報告的那一拍、核心的狀態拿。

import type { Feature, Kernel } from '../../core'
import { modeOf } from '../../core'
import { ANGLE_KIND, blankMedia, CAP_STAT, DRONE_REC_STAT, CUT_PICK_STAT, EXT, FORGE_BONUS_STAT, FORGE_QUALITY_STAT, FORGE_RISK_STAT, OWNER, QUALITY_STAT, REC_STAT, RULE_KIND, mediaValue, ruleProblems } from './model'
import { angleProblems } from './angles'
import { keepOptions } from './publish'
import { installOps } from './ops'
import { installEffects } from './effects'
import { onActivityEnd, onMilestone, onRecord, onRewind } from './record'
import { materialsOf, spend } from './chain'
import { lensInfos, lensesOf } from './lens'
import { mediaRules } from './model'

export { camBlock, camRows, dropCamera, setCamera } from './cams'
export type { CamInput, CamPlan, CamRow } from './cams'
export { camItem, defaultLens, downedDrones, lensInfos, lensesOf } from './lens'
export type { Lens } from './lens'
export { POV_KINDS, isPovKind, legacyPov, multiAngle, povKey, povParts, povSelf, povText, readPov } from './pov'
export type { Pov, PovKind } from './pov'
export { CAM_ACTION as MEDIA_CAM_ACTION, CAM_KINDS as MEDIA_CAM_KINDS, CAM_NAME as MEDIA_CAM_NAME, DRONE_REC_STAT as MEDIA_DRONE_REC_STAT } from './model'
export type { Cam, CamKind, LensInfo } from './model'

export { convertBlock, convertDraft, materialOf, materialsOf, recordingBlock, setRecording, spend } from './chain'
export { mediaView } from './view'
export type { ClipRow, FootageRow, MediaView, RecordRow } from './view'
export { DEFAULT_ANGLES, angleOf, anglesOf } from './angles'
export type { AngleEntry, AngleGroup, CardKind, UploadTemplate } from './angles'
export { angleOptions, clipNumbers, cut, cutBlock, cutPreview, editPlace, forge, forgeBlock, forgeQuote, partsOf, recut, recutBlock, retitle, retitleBlock } from './cut'
export type { AngleOption, CutDetail, CutInput, CutPreview, EditPlace, ForgeInput, ForgeQuote, Numbers, Part, RecutInput } from './cut'
export { deal, dealBlock, dealTargets, keepMaterial, sell, sellBlock, sellPrice, upload, uploadBlock, uploadPreview } from './publish'
export type { DealOpts, DealSkill, DealTarget, UploadOpts, UploadPreview } from './publish'
export { battleMarks, hintOf, isRecording, lensStatus, noRecHere, recStatus, recordInits } from './record'
export type { RecLens, RecordInput, RecordOpts } from './record'
export {
  ANGLE_KIND as MEDIA_ANGLE_KIND, AUTHENTIC, CAP_STAT as MEDIA_CAP_STAT, CLIP_INTRO_MAX, CLIP_TITLE_MAX, CONVERT_ACTION as MEDIA_CONVERT_ACTION, CUT_ACTION as MEDIA_CUT_ACTION, CUT_PICK_STAT as MEDIA_CUT_PICK_STAT,
  DEAL_ACTION as MEDIA_DEAL_ACTION, FORGE_ACTION as MEDIA_FORGE_ACTION, FORGE_BONUS_STAT as MEDIA_FORGE_BONUS_STAT, FORGE_QUALITY_STAT as MEDIA_FORGE_QUALITY_STAT, FORGE_RISK_STAT as MEDIA_FORGE_RISK_STAT,
  RECUT_ACTION as MEDIA_RECUT_ACTION, RETITLE_ACTION as MEDIA_RETITLE_ACTION, SELL_ACTION as MEDIA_SELL_ACTION, UPLOAD_ACTION as MEDIA_UPLOAD_ACTION, materialOfClip, partyMin, DEFAULT_MEDIA_RULES, EXT as MEDIA_EXT, FRESH, MARKS as MEDIA_MARKS, MISSES, OWNER as MEDIA_OWNER, ORIGINS as MEDIA_ORIGINS,
  QUALITY_STAT as MEDIA_QUALITY_STAT, REC_ACTION as MEDIA_REC_ACTION, REC_STAT as MEDIA_REC_STAT, RULE_KIND as MEDIA_RULE_KIND, TYPES as MEDIA_TYPES, TYPE_NAME as MEDIA_TYPE_NAME,
  blankMedia, freshOf, materialOfFootage, mediaRules, partyMax, qualityParts, readMedia, recorderOf,
} from './model'
export type {
  Authentic, CardInfo, Clip, Footage, Fresh, Involves, Mark as MediaMark, Material, MediaRules, MediaState, MediaType, Miss, Origin as FootageOrigin, RecordEntry, RecordHint, RecordSource, SpendAnswer, StagePending,
} from './model'

export const mediaFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: ANGLE_KIND, owner: OWNER, overridable: true, validate: angleProblems })
    // 三個衍生數值只定義、預設 0（不加任何 provider）：義體與零件的被動效果加它們
    k.stats.defineStat({ id: REC_STAT, owner: OWNER, name: '錄影等級', base: () => 0, min: 0, max: 5 })
    k.stats.defineStat({ id: QUALITY_STAT, owner: OWNER, name: '剪輯的功夫', base: () => 0, min: 0, max: 3 })
    k.stats.defineStat({ id: CAP_STAT, owner: OWNER, name: '素材品質的上限加成', base: () => 0, min: 0, max: 2 })
    // 隊上帶著的錄影無人機（感測器帶內建錄影）的等級：只定義、預設 0，由裝備或組裝成品的效果 { stat: 'drone_rec' } 給（M5-media-pov；組裝成品還沒有無人機這一類，見實作補記）
    k.stats.defineStat({ id: DRONE_REC_STAT, owner: OWNER, name: '錄影無人機的等級', base: () => 0, min: 0, max: 5 })
    // 剪與偽造的衍生數值：技能（假料工坊、聚光燈）的日常寫它們；只定義、預設 0，不加任何 provider
    k.stats.defineStat({ id: CUT_PICK_STAT, owner: OWNER, name: '剪輯的巧思', base: () => 0, min: 0, max: 1 })
    k.stats.defineStat({ id: FORGE_BONUS_STAT, owner: OWNER, name: '偽造的手藝', base: () => 0, min: 0, max: 5 })
    k.stats.defineStat({ id: FORGE_QUALITY_STAT, owner: OWNER, name: '偽造的品質加成', base: () => 0, min: 0, max: 2 })
    k.stats.defineStat({ id: FORGE_RISK_STAT, owner: OWNER, name: '假料的風險加減', base: () => 0, min: -5, max: 5 })
    installOps(k)
    installEffects(k)

    k.hooks.on('game.new', OWNER, () => [{ op: 'ext', key: EXT, value: mediaValue(blankMedia()) }])
    k.hooks.on('activity.end', OWNER, (p) => onActivityEnd(k, p))
    k.hooks.on('report.before', OWNER, ({ state, draft }) => onMilestone(k, state, draft))
    k.hooks.on('rewind.keep', OWNER, ({ current, restored }) => onRewind(current, restored))
    k.hooks.on('media.materials', OWNER, ({ state, kinds }) => materialsOf(k, state, kinds))
    k.hooks.on('media.spend', OWNER, ({ state, ref, how, all }) => spend(k, state, { ref, how, ...(all !== undefined ? { all } : {}) }))
    k.hooks.on('media.record', OWNER, (p) => onRecord(k, p))
    k.hooks.on('media.cameras', OWNER, ({ state }) => lensInfos(k, state))
    // 手持攝影機：拿的人手上一直是它，戰鬥中每回合先給鏡頭 cam.hand_ap 點行動點（少回那麼多；放下就不錄）
    k.battle.loadout(OWNER, (state, actor, mode) => {
      if (modeOf(k.content, mode)?.layer !== 'meat') return
      return lensesOf(k, state).some((l) => l.hand === true && l.by === actor) ? { tags: ['holding_camera'] } : undefined
    })
    k.battle.modifier(OWNER, (q) => (q.kind === 'ap_regen' && q.unit.tags.includes('holding_camera') ? [{ label: '手持攝影機', value: -mediaRules(q.view.k).cam.hand_ap, source: 'media' }] : []))
    // 留著當保命符：被贏的那一方的勢力俘虜時，手上有對得上的罪證就多一個選項（V11）
    k.hooks.on('defeat.options', OWNER, ({ state, pending }) => keepOptions(k, state, pending.faction))
  },
}
