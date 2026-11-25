<script setup lang="ts">
import { computed } from 'vue'
import { toMinutes } from '@engine/src'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { groupPassives, spanText } from '../../lib/bodyView'

/**
 * 藥與成癮（DOWNTIME 3.4、3.5 節；ITEMS 第 4 節）：背包裡的藥可以使用（戰鬥外）、生效中的（剩多久）、每一種的成癮值與是不是依賴、戒斷中的與懲罰、抑制劑的開關與反彈的倒數。
 * 全部讀引擎的 drugView 與被動效果（來源 drug、withdrawal）；元件只編排，不算成癮值，也不判斷能不能吃。
 */
const eng = useEngine()
const ui = useUi()
const v = computed(() => eng.body.drugs())
const now = computed(() => toMinutes(eng.state.time))
const STAGE = { none: '還沒有依賴', dependent: '依賴', heavy: '重度依賴' } as const
const effects = computed(() => groupPassives(eng.body.passives(), eng.body.sourceName, eng.body.names, ['drug', 'withdrawal']))
function use(item: string, name: string) {
  const why = eng.body.useDrug(item)
  if (why) ui.toast(why, 'warn')
  else ui.toast(`用了${name}。`)
}
function toggleSupp() {
  const s = v.value?.suppressant
  const why = eng.body.suppressant(!(s?.weekly ?? false))
  if (why) ui.toast(why, 'warn')
}
</script>

<template>
  <section v-if="v" class="panel cut pad drugs" data-drug-panel>
    <p class="h">藥<Hint title="藥與成癮">吃藥只有戰鬥外才在這裡；戰鬥中的藥放在快取格。每吃一劑成癮值上升，到了依賴的門檻，太久沒用就進入戒斷，戒斷有懲罰。</Hint></p>
    <div class="grp">
      <p class="k">背包裡的藥</p>
      <div v-for="u in v.usable" :key="u.item" class="lrow" :data-usable="u.item">
        <span class="grow"><b>{{ u.name }}</b><small>×{{ u.qty }}</small></span>
        <ReasonButton sm pri :reason="u.block" data-act="use" @go="use(u.item, u.name)">使用</ReasonButton>
      </div>
      <p v-if="!v.usable.length" class="empty-note">背包裡沒有藥。</p>
    </div>
    <div class="grp">
      <p class="k">生效中</p>
      <div v-for="a in v.active" :key="a.id" class="lrow" :data-active="a.id">
        <span class="grow"><b>{{ a.name }}</b><small>{{ a.left === null ? '撐過這一場戰鬥' : `剩 ${spanText(a.left)}` }}</small></span>
      </div>
      <div v-for="a in v.after" :key="'after-' + a.id" class="lrow" :data-after="a.id">
        <span class="grow"><b>{{ a.name }}的後勁</b><small>剩 {{ spanText(a.until - now) }}</small></span>
      </div>
      <p v-if="!v.active.length && !v.after.length" class="empty-note">身上沒有藥效。</p>
    </div>
    <div class="grp">
      <p class="k">成癮</p>
      <div v-for="a in v.addiction" :key="a.id" class="lrow" :data-addiction="a.id" :class="{ warn: a.stage !== 'none' }">
        <span class="grow">
          <b>{{ a.name }}　<span class="mono" data-value>{{ a.value }}</span></b>
          <small>
            <span :data-stage="a.stage">{{ STAGE[a.stage] }}</span>
            <template v-if="a.withdrawal">・戒斷中，還有 {{ spanText(a.withdrawal.left) }}<template v-if="a.withdrawal.heavy">（重度）</template></template>
            <template v-else-if="a.until_withdrawal !== null">・再 {{ spanText(a.until_withdrawal) }}沒用就進入戒斷</template>
          </small>
        </span>
      </div>
      <p v-if="!v.addiction.length" class="empty-note">沒有成癮。</p>
    </div>
    <div v-if="effects.length" class="grp" data-drug-effects>
      <p class="k">現在的加減（藥與戒斷）</p>
      <div v-for="g in effects" :key="g.source" class="eff"><b>{{ g.name }}</b>
        <span v-for="r in g.rows" :key="r.label" class="tag" :class="{ warn: g.source === 'withdrawal' }"><small>{{ r.label }}</small> {{ r.lines.join('；') }}</span>
      </div>
    </div>
    <div class="grp" data-suppressant>
      <p class="k">抑制劑<Hint>每週帳單付一份：生效時沉溺的下限降低、別人看到的沉溺也降低。停掉之後有一段反彈，下限反而升高。</Hint></p>
      <div class="lrow">
        <span class="grow">
          <b>{{ v.suppressant.weekly ? '每週帳單付抑制劑' : '沒有付抑制劑' }}</b>
          <small><MoneyTag kind="acc" :amount="v.suppressant.price" :size="12" />／週<template v-if="v.suppressant.active">・生效到 {{ spanText((v.suppressant.until ?? now) - now) }}後</template><template v-if="v.suppressant.rebound">・反彈中，還有 {{ spanText((v.suppressant.rebound_until ?? now) - now) }}</template></small>
        </span>
        <ReasonButton sm :reason="eng.body.suppressantBlock(!v.suppressant.weekly)" data-act="suppressant" @go="toggleSupp">{{ v.suppressant.weekly ? '停掉' : '開始付' }}</ReasonButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.drugs { display: grid; gap: var(--space-4); align-content: start; }
.grp { display: grid; gap: var(--space-2); }
.lrow.warn { box-shadow: inset 3px 0 0 var(--warn); }
.eff { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
.tag small { color: var(--ink-3); margin-right: var(--space-2); }
</style>
