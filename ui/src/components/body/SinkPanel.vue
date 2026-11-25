<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../Hint.vue'
import TrackBar from '../TrackBar.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { effectText, floorRows, signed, spanText } from '../../lib/bodyView'

/**
 * 沉溺（UI.md 8.1 節與 8.2 節的身體分頁右邊）：現在的值、下限與它的組成（哪一件義體墊了多少、抑制劑、暫時的）、落在哪一段與這一段的得失、別人看到的值、治療。
 * 全部讀引擎的 sinkView 與治療的報價；元件不算分段，也不算下限。therapy 為 true 時列出治療（站在提供治療的設施上才有報價）。
 */
const props = defineProps<{ therapy?: boolean }>()
const eng = useEngine()
const ui = useUi()
const v = computed(() => eng.body.sink())
const parts = computed(() => (v.value ? floorRows(v.value.floorParts) : []))
const gain = computed(() => (v.value ? v.value.effects.map((e) => ({ label: e.label, text: effectText(e, eng.body.names) })) : []))
const here = computed(() => (props.therapy ? eng.body.therapyHere() : null))
const quote = computed(() => (here.value ? eng.body.therapyQuote({}) : null))
const block = computed(() => (here.value ? eng.body.therapyBlock({}) : null))
function treat() {
  const why = eng.body.therapy({})
  if (why) ui.toast(why, 'warn')
  else ui.toast('做完了。')
}
</script>

<template>
  <section v-if="v" class="panel cut pad sink" data-sink-panel>
    <p class="h">沉溺<Hint title="沉溺">值越高越容易陷進去。下限是身上義體、抑制劑與暫時的加減撐起來的最低處，下限以下降不了。落在哪一段、這一段的得失都是引擎的規則。</Hint></p>
    <TrackBar :value="v.value" :max="100" color="var(--sink)" :marks="[v.floor]" />
    <div class="kv" data-sink-value><span>現在的值</span><b class="mono">{{ v.value }}</b></div>
    <div class="kv" data-sink-floor><span>下限</span><b class="mono">{{ v.floor }}</b></div>
    <div class="comp" data-floor-parts>
      <span v-for="(p, i) in parts" :key="i" class="tag" :data-floor-part="p.value">{{ p.label }} {{ signed(p.value) }}</span>
      <span v-if="!parts.length" class="k">沒有東西墊著。</span>
    </div>
    <div v-if="v.floorMods.length" class="k" data-floor-mods>暫時的：<template v-for="(m, i) in v.floorMods" :key="i"><span class="tag">{{ m.why ?? '暫時的加減' }} {{ signed(m.amount) }}</span> </template></div>
    <div class="kv" data-band><span>這一段</span><b>{{ v.band.name }}<small v-if="v.next" class="k">　下一段「{{ v.next.name }}」（{{ v.next.min }}）</small></b></div>
    <div v-if="gain.length" class="gains" data-band-effects>
      <span v-for="(g, i) in gain" :key="i" class="tag"><small>{{ g.label }}</small> {{ g.text }}</span>
    </div>
    <div class="kv" data-shown><span>別人看到的<Hint>藥、調校與面具能讓別人看到的沉溺比真正的低。</Hint></span><b class="mono">{{ v.shown }}<small v-if="v.shown !== v.value" class="k">（{{ v.shownBand.name }}）</small></b></div>
    <div class="kv" data-week><span>這一週</span><b>睡了 {{ v.sleeps }} 次／要 {{ v.sleepsNeeded }} 次<small class="k">{{ v.decaysNextMonday ? '・下個週一會下降' : '' }}</small></b></div>
    <template v-if="here">
      <p class="h mt">治療<Hint>在提供治療的設施上才做得了；能降多少、花多少錢與時間都是引擎的報價。</Hint></p>
      <div class="kv"><span>地方</span><b>{{ here.name }}</b></div>
      <template v-if="quote">
        <div class="kv" data-therapy-amount><span>最多降</span><b class="ok-t">{{ quote.amount }}</b></div>
        <div class="kv" data-therapy-time><span>花的時間</span><b>{{ spanText(quote.minutes) }}</b></div>
        <div class="kv" data-therapy-price><span>費用</span><b><MoneyTag v-if="quote.price > 0" :kind="quote.pay === 'cash' ? 'cash' : 'acc'" :amount="quote.price" :size="12" /><template v-else>不用錢</template></b></div>
      </template>
      <div v-if="block" class="blocking" data-reason>{{ block }}</div>
      <div class="go left"><ReasonButton pri :reason="block" data-act="therapy" @go="treat">{{ here.kind === 'counsel' ? '做心理治療' : '斷線靜修' }}</ReasonButton></div>
    </template>
    <p v-else-if="therapy" class="k" data-no-therapy>這裡沒有做沉溺治療的地方。</p>
  </section>
  <section v-else class="panel cut pad empty-note">還沒有主角。</section>
</template>

<style scoped>
.sink { display: grid; gap: var(--space-2); align-content: start; }
.comp, .gains { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.mt { margin-top: var(--space-4); }
.go.left { justify-content: flex-start; }
.tag small { color: var(--ink-3); margin-right: var(--space-2); }
</style>
