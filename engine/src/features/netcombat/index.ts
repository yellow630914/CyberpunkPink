// L6 功能：內海戰鬥的行動表、同步檔位、干擾與破損（CYBERSPACE 6.1～6.5 節；dev/adr/0018 第一節；工單 M3-netcombat）。
// 戰鬥的引擎在核心（現實與內海共用）；這個功能註冊內海那一組行動（modes: ['net']）與它們用到的掛點、修正、效果：
//
//   行動   net_attack、net_melee（內環）；net_refill、net_swap、net_script（中環）；net_hit_wall、net_watch（外環）；net_shift（換檔）；
//          net_tool:<構裝 id>（每個裝著、不是被動的工具構裝各一個；內容載入之後註冊）；釘住 net_pin、拔線 net_jack_out、投降 net_surrender（out.ts）。管理行動是後面的工單。
//   單位   unit.ready：unit.ext.net = { sync, sync_max, broken }（已經有的欄位不蓋）與標籤 sync:<檔>；會換檔的敵人寫 ext.net.shift（N25）
//   修正   同步檔位（命中與檢定、受到的感載、每回合行動點、管理行動次數）、構裝的進階與終極 mods、破損與干擾造成的數字
//   效果   net.jam、net.break、net.fix、net.sync、net.ram、net.pin、net.tether、net.trace
//   追蹤度 戰鬥裡的追蹤度、增援、定位、扣線與倒下的後果在 out.ts（只認 battle.field.trace 這個數字；規則表的 trace、burn_minutes）
//   規則   內容種類 netcombat_rule（id: default；refill、各行動的行動點、干擾對防火牆的倍率、換檔的次數與會換檔的敵人的分界；可以被後載入的包取代）
//   狀態   jam_weapon、jam_defense、jam_tool（規則表 battle_status 要有，各一回合；正式的由 M3-data-rules 寫）
// 讀的：unit.ext.deck.constructs（features/deck 放的）、內容種類 construct 與 item；不 import 別的功能。
// 報告：戰鬥的每一步照常是 combat 報告；結束時重創的（破損又中一次）寫角色的狀況 net_broken。
// 對外：netBattleView（給畫面）、DEFAULT_NETCOMBAT_RULES、netcombatRules。

import type { Feature } from '../../core'
import { statusRuleOf } from '../../core'
import { installActions } from './actions'
import { installEffects } from './effects'
import { installJam } from './jam'
import { installOut } from './out'
import { CONSTRUCT_KIND, JAM_SLOTS, OWNER, RULE_KIND, jamStatus, ruleProblems } from './model'
import type { ConstructInfo } from './model'
import { SYNC_ACTIONS, installSync } from './sync'
import { installTiers, registerToolActions } from './tools'

export { DEFAULT_NETCOMBAT_RULES, netcombatRules } from './model'
export type { NetActionAp, NetExt, NetcombatRules, TraceRules } from './model'
export { netBattleView } from './view'
export type { NetBattleView, NetGearView, NetUnitView } from './view'
export { breakOne, fixOne, jamUnit } from './jam'
export { gearBlocks, capIndex, setGear } from './sync'
export { addTrace, pinBlocks, pinDc, pinUnit, traceOf } from './out'

export const netcombatFeature: Feature = {
  id: OWNER,
  install(k) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    installActions(k)
    for (const def of SYNC_ACTIONS) k.battle.action(def)
    installSync(k)
    installJam(k)
    installTiers(k)
    installEffects(k)
    installOut(k)
  },
  ready(k) {
    registerToolActions(k)
    // 干擾的武器要有三個停用的狀態：資料沒有就在載入時說清楚，不要等到戰鬥中才丟錯
    if (k.content.hasKind(CONSTRUCT_KIND)) {
      const jam = k.content.list<ConstructInfo>(CONSTRUCT_KIND).find((e) => e.class === 'weapon' && e.type === 'jam')
      const missing = jam ? JAM_SLOTS.map(jamStatus).filter((id) => !statusRuleOf(k.content, id)) : []
      if (jam && missing.length) throw new Error(`構裝「${jam.id}」是干擾的武器，規則表（battle_status）要有 ${missing.join('、')} 這幾個狀態`)
    }
  },
}
