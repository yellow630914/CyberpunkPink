<script setup lang="ts">
import Hint from '../Hint.vue'
import type { AdminPanel } from '../../lib/netView'

/**
 * 管理行動（內海戰鬥，CYBERSPACE 6.6 節；UI.md 第 5 節）：有主控的潛網者輪到時才出現。七個按鈕各寫要花多少 RAM，旁邊寫這一回合還能做幾次；
 * 灰掉的帶引擎的原因；要選格子或目標的走戰鬥畫面現有的目標流程（發 pick 給上層）。這裡不算 DC、次數與花費。
 */
defineProps<{ panel: AdminPanel; selected: string | null }>()
const emit = defineEmits<{ (e: 'pick', id: string): void }>()
</script>

<template>
  <div class="grp" data-admin-panel>
    <span class="k">管理行動<span class="left mono" data-admin-left>這一回合還能做 {{ panel.left }}／{{ panel.limit }} 次</span>
      <Hint>只有潛網者有。每個行動花 RAM；每次做完追蹤度往上加，檢定失敗再加。</Hint></span>
    <div class="adm">
      <button v-for="a in panel.buttons" :key="a.id" type="button" class="btn sm" :class="{ pri: selected === a.id, 'is-unavailable': !!a.reason }"
        :aria-disabled="a.reason ? 'true' : undefined" :aria-pressed="selected === a.id" :title="a.reason ?? a.desc" :data-admin="a.id" @click="emit('pick', a.id)">{{ a.name }}<small>RAM {{ a.ram }}</small></button>
    </div>
  </div>
</template>

<style scoped>
.grp { display: grid; gap: var(--space-2); min-width: 0; }
.left { margin-left: var(--space-2); color: var(--ink-2); font-weight: 800; }
.adm { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr)); gap: var(--space-2); }
.adm .btn { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); min-height: 40px; }
.adm small { font: 800 var(--fs-tiny) var(--mono); color: var(--ram); }
.adm .pri small { color: inherit; }
</style>
