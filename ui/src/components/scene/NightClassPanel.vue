<script setup lang="ts">
import { computed } from 'vue'
import type { LearnStatus, LearnView } from '@engine/src/features/nightclass'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { hiddenLine, nightEntries } from '../../lib/nightView'

/**
 * 夜課（角色的成人分頁，UI 8.4 節夜課那一段、LEWD_SYSTEM 第 10 節）：五個分支各自開到幾階與原因、看得到的技能（學會了、能學、階沒開、條件不夠）、體悟、學習的按鈕、共鳴的清單。
 * 開階、看得到哪些（標籤被內容篩選關掉的整個不出現）、學得了學不了與原因、花多少體悟全是引擎 features/nightclass 的答案（stores/engine.ts 的 night 只轉接）；這裡只編排。
 * 體悟從成人場景與成人事件來，不能用歷練點換。
 */
const e = useEngine()
const ui = useUi()
const list = computed(() => e.night.list())
const res = computed(() => e.night.resonances())
const STATUS: Record<LearnStatus, string> = { learned: '學會了', learnable: '能學', tier_closed: '階還沒開', unmet: '條件不夠' }
const resOf = (branch: string) => res.value.filter((r) => r.branch === branch)
function learn(s: LearnView): void {
  const why = e.night.learn(s.id)
  if (why) ui.toast(why, 'warn')
  else ui.toast(`學會了夜課「${s.name}」。`)
}
</script>

<template>
  <section class="panel cut pad night" data-night>
    <p class="h">夜課<Hint>五個分支各自看自己的條件開階：共通看性經歷的次數或和幾個人有過，其餘四支看傾向的軸。學一招要花體悟；體悟從成人場景與成人事件來，不能用歷練點換。掛在你沒有的標籤上的技能不顯示；被內容篩選關掉的整個不出現。</Hint></p>
    <div class="kv"><span>體悟</span><b class="ins" data-insight>{{ list?.insight ?? 0 }}</b></div>
    <p v-if="!list" class="empty-note">還沒有主角。</p>
    <div v-else class="branches">
      <div v-for="b in list.branches" :key="b.branch" class="br" :data-branch="b.branch">
        <div class="bh"><b>{{ b.name }}</b><span class="pips" :aria-label="`開到 ${b.tier} 階`" data-tier><i v-for="n in 5" :key="n" :class="{ on: n <= b.tier }" /></span><span class="mono" data-tier-n>{{ b.tier }} 階</span></div>
        <p class="basis" data-basis>{{ b.basis.text }}</p>
        <ol class="gates" data-gates>
          <li v-for="g in b.basis.tiers" :key="g.tier" :class="{ open: g.open }" :data-gate="g.tier" :data-open="g.open"><b>{{ g.tier }}</b><small>{{ g.need }}</small></li>
        </ol>
        <ul class="sk">
          <template v-for="(en, i) in nightEntries(b)" :key="en.kind === 'skill' ? en.skill.id : `m${en.tier}-${i}`">
          <li v-if="en.kind === 'masked'" class="s tier_closed masked" :data-masked="en.tier"><span class="nm"><b>…</b><small>{{ en.tier }} 階・{{ en.count }} 個</small></span></li>
          <li v-else class="s" :class="[en.skill.status, { deep: en.skill.deep }]" :data-skill="en.skill.id" :data-status="en.skill.status" :data-deep="en.skill.deep || undefined" :title="en.skill.reasons.join('')">
            <span class="nm"><b>{{ en.skill.name }}</b><small v-if="en.skill.deep" class="deepnote" data-deep-note>標籤深，效果 +1 級</small><small>{{ en.skill.tier }} 階・{{ en.skill.cost }} 點體悟<template v-if="e.night.skill(en.skill.id).tagName">・掛在「{{ e.night.skill(en.skill.id).tagName }}」</template></small></span>
            <span class="st" data-status-text>{{ STATUS[en.skill.status] }}</span>
            <ReasonButton v-if="en.skill.status !== 'learned'" sm :pri="en.skill.status === 'learnable'" :reason="e.night.learnBlock(en.skill.id)" :data-learn="en.skill.id" @go="learn(en.skill)">學</ReasonButton>
            <small v-if="en.skill.reason" class="r" data-reason>{{ en.skill.reason }}</small>
          </li>
          </template>
          <li v-if="b.skills.length === 0" class="empty-note">這一支沒有你看得到的技能。</li>
        </ul>
        <p v-if="b.hidden > 0" class="why" data-hidden>{{ hiddenLine(b.hidden) }}</p>
        <ul v-if="resOf(b.branch).length" class="rs" data-resonances>
          <li v-for="r in resOf(b.branch)" :key="r.id" :class="{ on: r.on }" :data-resonance="r.id"><b>{{ r.name }}</b><small>{{ r.tier }} 階的共鳴・{{ r.on ? '生效中' : '還沒開' }}</small><small v-if="r.desc">{{ r.desc }}</small></li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.night { display: grid; gap: var(--space-3); min-width: 0; }
.ins { color: var(--a); font-size: var(--fs-section); }
.branches { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: var(--space-3); }
.br { display: grid; gap: var(--space-2); align-content: start; padding: var(--space-3); background: var(--bg-2); min-width: 0; }
.bh { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.pips { display: flex; gap: 3px; }
.pips i { width: 16px; height: 8px; border-radius: 3px; background: var(--bg-3); }
.pips i.on { background: var(--a); }
.basis { margin: 0; color: var(--ink-2); font-size: var(--fs-fine); }
.gates { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.gates li { display: flex; gap: var(--space-2); align-items: baseline; padding: 2px 6px; background: var(--bg-1); opacity: .6; font-size: var(--fs-fine); }
.gates li.open { opacity: 1; box-shadow: inset 0 0 0 1px var(--a); }
.gates small { color: var(--ink-3); }
.s.deep { box-shadow: inset 0 0 0 1px var(--ap); }
.s .deepnote { color: var(--ap); }
.s.masked { grid-template-columns: 1fr; }
.why { color: var(--ink-3); font-size: var(--fs-fine); }
.sk, .rs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.s { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px var(--space-3); align-items: center; padding: 6px 8px; background: var(--bg-1); }
.s .nm small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.s .st { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 800; }
.s .r { grid-column: 1 / -1; color: var(--warn); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.s.learned { box-shadow: inset 3px 0 0 var(--a); }
.s.learned .st { color: var(--a); }
.s.learnable { box-shadow: inset 3px 0 0 var(--ap); }
.s.tier_closed { opacity: .55; }
.rs li { display: grid; padding: 6px 8px; background: var(--bg-1); opacity: .6; }
.rs li.on { opacity: 1; box-shadow: inset 3px 0 0 var(--ep); }
.rs small { color: var(--ink-3); font-size: var(--fs-fine); }
</style>
