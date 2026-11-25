<script setup lang="ts">
import { computed, ref } from 'vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import ResultNote from './ResultNote.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { DISSECT_MINUTES } from '@engine/src/features/enemies'
import { minutesText } from '../../lib/craftView'

/**
 * 戰後的解剖（CRAFTING 第 10.4 節、LIFE 第 9 節）：打贏之後一小時內，倒下的對象身上有義體可以拆。一場一次。
 * 對象、能拆到什麼、做的人的沉溺與勢力的敵對值都是引擎的 dissectOptions；做不到的原因也是引擎的。
 */
const eng = useEngine()
const ui = useUi()
const options = computed(() => eng.craft.dissectOptions())
const done = ref<{ result: string; lines: string[] } | null>(null)
function dissect(key: string) {
  const r = eng.craft.dissect(key)
  if (r.why) { ui.toast(r.why, 'warn'); return }
  done.value = { result: r.result, lines: r.lines }
}
</script>

<template>
  <div class="dis">
    <section class="panel cut pad" data-dissect>
      <p class="h">可以解剖的對象<Hint title="解剖">拆人的義體要付代價：做的人的沉溺會上升，那個勢力的敵對值也會上升；機器不用。要有人會解剖，而且一場只能做一次。</Hint></p>
      <div v-if="!options.length" class="empty-note" data-no-dissect>現在沒有可以解剖的對象：要在打贏一場戰鬥之後一小時內，而且倒下的對象身上有義體。</div>
      <div v-for="o in options" :key="o.key" class="lrow opt" :data-dissect-target="o.key">
        <span class="grow">
          <b>{{ o.name }}<template v-if="o.human">（人）</template></b>
          <small v-if="o.items.length">可能拆到：{{ o.items.map((i) => i.name).join('、') }}</small>
          <small>代價：{{ o.sink > 0 ? `沉溺 +${o.sink}` : '沒有沉溺' }}<template v-if="o.hostility">；{{ o.hostility.faction }}的敵對值 +{{ o.hostility.amount }}</template>・{{ minutesText(DISSECT_MINUTES) }}</small>
        </span>
        <ReasonButton sm pri :reason="o.block" data-dissect-go @go="dissect(o.key)">解剖</ReasonButton>
      </div>
    </section>
    <ResultNote v-if="done" :result="done.result" :lines="done.lines" />
  </div>
</template>

<style scoped>
.opt { margin-bottom: 6px; align-items: center; }
</style>
