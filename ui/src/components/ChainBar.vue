<script setup lang="ts">
import type { StepRecord, StepStatus } from '@engine/src'

/**
 * 任務鏈列：最新一條鏈的每一步一顆標籤（狀態用顏色與字，不只靠顏色），AI 的那幾步可以重試或改用規則，擲骰那一步可以重擲。
 * 只顯示與呼叫：每一步能不能按、按了怎麼算，都是引擎的事（store 的 retryStep、useRules、reroll）。
 */
defineProps<{ steps: StepRecord[]; busy: boolean }>()
const emit = defineEmits<{ (e: 'retry', id: string): void; (e: 'rules', id: string): void; (e: 'reroll'): void }>()
const NAME: Record<string, string> = { roll: '擲骰', judge: '判定', hint: '提示', person: '人物', reward: '獎勵', relate: '關係', text: '正文', apply: '套用' }
const STATUS: Record<StepStatus, string> = { waiting: '等待', running: '進行中', done: '完成', failed: '出錯', fallback: '改用規則', skipped: '略過' }
</script>

<template>
  <div class="chainbar" aria-label="任務鏈">
    <div v-for="s in steps" :key="s.id" class="cs" :class="s.status" :data-step="s.id">
      <span class="nm">{{ NAME[s.id] ?? s.id }}</span>
      <span class="stt">{{ STATUS[s.status] }}</span>
      <span v-if="s.kind === 'ai' && (s.status === 'failed' || s.status === 'done' || s.status === 'fallback')" class="acts">
        <button type="button" class="btn sm" :disabled="busy" @click="emit('retry', s.id)">重試</button>
        <button v-if="s.status !== 'fallback'" type="button" class="btn sm" :disabled="busy" @click="emit('rules', s.id)">用規則</button>
      </span>
      <span v-else-if="s.id === 'roll' && s.status === 'done'" class="acts"><button type="button" class="btn sm" :disabled="busy" @click="emit('reroll')">重擲</button></span>
    </div>
  </div>
</template>

<style scoped>
.chainbar { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.cs { display: inline-flex; align-items: center; gap: var(--space-2); padding: 2px 8px; border-radius: 6px; background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--kc, var(--line-2)); font-size: var(--fs-fine); font-weight: 800; }
.cs .stt { color: var(--kc, var(--ink-3)); }
.cs.done { --kc: var(--ok); } .cs.running { --kc: var(--a); } .cs.failed { --kc: var(--hp); } .cs.fallback { --kc: var(--ap); } .cs.skipped { opacity: .55; }
.acts { display: inline-flex; gap: 4px; }
</style>
