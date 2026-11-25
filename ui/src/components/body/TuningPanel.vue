<script setup lang="ts">
import { computed } from 'vue'
import type { QuietOpts } from '@engine/src/features/tuning'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { signed } from '../../lib/bodyView'
import { fmt } from '../../lib/price'

/**
 * 調校（LEWD_SYSTEM 第 4 節、第 1 節「怎麼變」；features/tuning）：橋的調校槽（裝著什麼、裝不穩、鎖在誰手上）、能裝的清單、四項橋參數與每個來源、靜室。
 * 在調校診所才裝得上、拆得掉，在靜室才調得了參數；價錢、時間、擋住的原因（沒有橋、槽滿了、上鎖、錢不夠、不在那種設施）都是引擎的 tuning（stores/engine.ts），這裡不算。
 * 靜水這類「感載消退 +N」寫在被動效果的明細裡（來源是調校）。
 */
const eng = useEngine()
const ui = useUi()
const view = computed(() => eng.tuning.view())
const list = computed(() => eng.tuning.list())
const here = computed(() => eng.tuning.here())
const PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const

function done(why: string | null, ok: string) {
  if (why) ui.toast(why, 'warn')
  else ui.toast(ok)
}
const install = (id: string) => done(eng.tuning.install(id), '裝好了。')
const remove = (id: string) => done(eng.tuning.remove(id), '拆掉了。')
const quiet = (param: QuietOpts['param'], dir: 1 | -1) => done(eng.tuning.quiet(param, dir), '調好了。')
const quietLabel = (param: QuietOpts['param'], dir: 1 | -1): string => {
  const q = eng.tuning.quietQuote(param, dir)
  return q ? `${dir > 0 ? '往上' : '往下'} ${Math.abs(q.delta)}・C$${fmt(q.price)}${q.sink ? `・沉溺 +${q.sink}` : ''}` : dir > 0 ? '往上' : '往下'
}
</script>

<template>
  <div class="tune" data-tuning>
    <section class="panel cut pad" data-tuning-slots>
      <p class="h">調校槽<Hint>橋上的調校槽裝韌體設定檔，正反兩面都寫在它的說明裡。調校診所才裝得上、拆得掉；上了鎖的拆不了，要找鑰匙的人。換橋時沒上鎖的調校會被清掉。</Hint></p>
      <div v-if="view && !view.has_bridge" class="empty-note" data-no-bridge>沒有橋就沒有調校槽。</div>
      <template v-else-if="view">
        <div v-for="s in view.slots" :key="s.index" class="slot" :class="{ empty: s.id === null }" :data-slot="s.index" :data-tuning-id="s.id ?? ''">
          <template v-if="s.id !== null">
            <span class="grow">
              <b data-name>{{ s.name }}</b>
              <small v-if="s.desc">{{ s.desc }}</small>
              <small v-if="s.unstable" class="warn-t" data-unstable>裝不穩（{{ s.unstable_why }}）：正的那幾筆不算。</small>
              <small v-if="s.lock" class="warn-t" data-lock>{{ s.lock.text }}</small>
              <span v-if="s.flags.length" class="chips"><span v-for="f in s.flags" :key="f.id" class="tag">{{ f.name }}</span></span>
            </span>
            <ReasonButton sm :reason="eng.tuning.removeBlock(s.id)" data-remove @go="remove(s.id!)">拆掉<template v-if="eng.tuning.removeQuote(s.id)">（C${{ fmt(eng.tuning.removeQuote(s.id)!.price) }}）</template></ReasonButton>
          </template>
          <span v-else class="empty-note" data-empty-slot>第 {{ s.index + 1 }} 槽是空的。</span>
        </div>
      </template>
    </section>

    <section class="panel cut pad" data-tuning-list>
      <p class="h">能裝的調校<Hint>內容篩選關掉的題材不列。要在調校診所才裝得上；現在{{ here?.install ? `在${here.name}` : '不在調校診所' }}。</Hint></p>
      <div v-for="t in list" :key="t.id" class="slot" :class="{ on: t.installed }" :data-tuning-item="t.id">
        <span class="grow"><b>{{ t.name }}</b><small>{{ t.desc }}</small><small v-if="!t.stable" class="warn-t">你現在裝上會裝不穩（{{ t.why }}）。</small></span>
        <span v-if="t.installed" class="tag hot">裝著</span>
        <ReasonButton v-else sm pri :reason="eng.tuning.installBlock(t.id)" :data-install="t.id" @go="install(t.id)">裝（C${{ fmt(t.price) }}）</ReasonButton>
      </div>
      <div v-if="!list.length" class="empty-note" data-none>這個世界沒有調校可以裝。</div>
    </section>

    <section class="panel cut pad" data-tuning-params>
      <p class="h">橋參數<Hint>有效值＝基本值＋各個來源（義體、藥、調校、沉溺……）。靜室可以付錢把一項的基本值往上或往下調幾點，每週有次數；往上調沉溺會增加。</Hint></p>
      <div v-if="view?.params" class="params">
        <div v-for="p in PARAMS" :key="p" class="param" :data-param="p">
          <b>{{ view.params[p].name }}</b>
          <span class="mono val" data-value>{{ view.params[p].value }}</span>
          <small class="k">基本 <span data-base>{{ view.params[p].base }}</span><template v-for="s in view.params[p].sources" :key="s.source">・{{ eng.body.sourceName(s.source) }} {{ signed(s.amount) }}</template></small>
          <span v-if="here?.quiet_room" class="qr">
            <ReasonButton sm :reason="eng.tuning.quietBlock(p, -1)" :data-quiet-down="p" @go="quiet(p, -1)">{{ quietLabel(p, -1) }}</ReasonButton>
            <ReasonButton sm :reason="eng.tuning.quietBlock(p, 1)" :data-quiet-up="p" @go="quiet(p, 1)">{{ quietLabel(p, 1) }}</ReasonButton>
          </span>
        </div>
      </div>
      <div v-else class="empty-note">沒有橋，沒有橋參數。</div>
      <div v-if="!here?.quiet_room" class="empty-note" data-no-quiet>這裡沒有靜室；要在有靜室的設施才調得了橋參數。</div>
    </section>
  </div>
</template>

<style scoped>
.tune { display: grid; gap: var(--space-4); }
.slot { display: flex; gap: var(--space-4); align-items: flex-start; padding: var(--space-3) var(--space-4); background: var(--bg-2); margin-top: var(--space-2); font-size: var(--fs-sm); }
.slot.on { box-shadow: inset 3px 0 0 var(--a); }
.slot.empty { opacity: .7; }
.slot .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.slot small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.slot small.warn-t { color: var(--warn); }
.params { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3); }
.param { display: grid; gap: var(--space-1); background: var(--bg-2); padding: var(--space-3); align-content: start; }
.param .val { font-size: var(--fs-num); font-weight: 900; }
.qr { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
</style>
