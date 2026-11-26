<script setup lang="ts">
import { computed } from 'vue'
import { toMinutes } from '@engine/src'
import { BRIDGE_CATS } from '@engine/src/features/cyberware'
import Hint from '../Hint.vue'
import GradeBadge from '../GradeBadge.vue'
import { useEngine } from '../../stores/engine'
import { CAT_COLOR, CATEGORY_NAME } from '../../lib/skillView'
import { pieceEffectLines, signed, spanText, statusText } from '../../lib/bodyView'

/**
 * 橋（UI.md 8.3 節的抬頭）：型號（設計圖的名字）、四類容量與它的組成（照軟體分到的、補到下限或被扣的、零件的親和）、機能的清單、四項橋參數（基本值、有效值、每個來源）。
 * 全部讀引擎（衍生數值 bridge_cap_*、bridge_*；stores/engine.ts 的 body）；沒有橋的人只寫一句。調校槽裝了幾個是引擎的 tuning.bridgeView（裝卸在 TuningPanel）。
 */
const eng = useEngine()
const bridge = computed(() => eng.body.bridge())
const cap = computed(() => eng.body.capacity())
const params = computed(() => eng.body.bridgeParams())
/** 調校槽（引擎的 tuning.bridgeView）：只在這裡數裝了幾個，裝卸在診所與橋分頁的調校區 */
const slots = computed(() => eng.tuning.view()?.slots ?? null)
const now = computed(() => toMinutes(eng.state.time))
const cats = BRIDGE_CATS
const grade = (n: number): 1 | 2 | 3 | 4 | 5 => Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5
</script>

<template>
  <section class="panel cut pad bp" data-bridge-panel>
    <template v-if="bridge">
      <div class="hd" data-bridge-head>
        <b class="nm" data-bridge-name>{{ bridge.name }}</b>
        <GradeBadge :grade="grade(bridge.grade)" />
        <span class="tag" data-bridge-status>{{ statusText(bridge) }}</span>
        <span v-if="bridge.status === 'recovering' && bridge.ready_at !== undefined" class="tag warn">機能要再等 {{ spanText(bridge.ready_at - now) }}</span>
        <span v-if="slots" class="tag" data-tuning-count>調校槽 {{ slots.filter((x) => x.id !== null).length }}／{{ slots.length }}</span>
      </div>
      <div v-if="cap" class="caps" data-bridge-caps>
        <div v-for="c in cats" :key="c" class="cap" :data-cap="c">
          <span class="cn" :style="{ color: CAT_COLOR[c] }">{{ CATEGORY_NAME[c] }}</span>
          <b class="mono num" data-cap-total>{{ cap.split[c] }}</b>
          <span class="k mono" data-cap-parts>分到 {{ cap.from[c].share }}<template v-if="cap.from[c].floor !== 0">・補到下限 {{ signed(cap.from[c].floor) }}</template><template v-if="cap.from[c].affinity !== 0">・零件親和 {{ signed(cap.from[c].affinity) }}</template></span>
        </div>
        <span class="k">晶片總量 {{ cap.chip }}<Hint>晶片給總量，軟體決定四類各分幾份；每類至少有下限，不夠的從最多的那一類扣；零件的親和直接加在那一類上。</Hint></span>
      </div>
      <div class="fn" data-bridge-funcs>
        <span class="k">機能<Hint>橋自己帶的機能；休養中的橋容量照算，機能要等休養完才生效。</Hint></span>
        <span v-for="(t, i) in pieceEffectLines(bridge, eng.body.names)" :key="i" class="tag" :class="{ dim: bridge.status !== 'ready' }">{{ t }}</span>
        <span v-if="!bridge.effects.length" class="k">沒有機能。</span>
      </div>
    </template>
    <p v-else class="empty-note" data-no-bridge>{{ eng.body.noBridgeNote }}橋是一件義體，裝上之後才有技能的容量與橋參數。</p>
    <div v-if="params" class="params" data-bridge-params>
      <div v-for="p in params" :key="p.id" class="param" :data-param="p.id">
        <b>{{ p.name }}</b>
        <span class="mono" data-param-value>{{ p.value }}</span>
        <small class="k">基本 <span data-param-base>{{ p.base }}</span><template v-for="(x, i) in p.parts" :key="i">・{{ x.label }} {{ signed(x.value) }}</template></small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bp { display: grid; gap: var(--space-3); }
.hd { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.nm { font-size: var(--fs-card); }
.caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3) var(--space-5); }
.cap { display: grid; grid-template-columns: 56px auto; gap: var(--space-1) var(--space-3); align-items: baseline; }
.cap .k { grid-column: 1 / -1; }
.cn { font-weight: 900; font-size: var(--fs-sm); }
.num { font-size: var(--fs-lg); }
.fn { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
.tag.dim { opacity: .55; }
.params { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-3); }
.param { display: grid; background: var(--bg-2); padding: var(--space-3); }
.param .mono { font-size: var(--fs-num); font-weight: 900; }
</style>
