<script setup lang="ts">
import { computed, ref } from 'vue'
import ItemSlot from '../../components/ItemSlot.vue'
import GradeBadge from '../../components/GradeBadge.vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useGame } from '../../stores/game'
import { useUi } from '../../stores/ui'
import { ITEMS } from '../../data/items'
import { attrMod } from '../../lib/creation'
import type { ItemDef } from '../../data/types'

/**
 * 角色的「內海」分頁（UI 8.2 節，ITEMS 第 11 節、CYBERSPACE 4.2、4.3 節）：甲板、構裝槽、存著的 SKIN；右欄是網內的數字。
 * 點構裝槽換構裝，同時只能開一個防護；點 SKIN 換穿，只在接入點，戰鬥中不能換。
 */
const g = useGame()
const ui = useUi()
const deckId = computed(() => g.cyber.brain.find(id => id && /甲板/.test(ITEMS[id].name)) ?? null)
const deck = computed(() => (deckId.value ? ITEMS[deckId.value] : null))
const slotsN = computed(() => Number(deck.value?.cyber?.effect.match(/構裝槽 (\d+)/)?.[1] ?? 0))
const firewall = computed(() => Number(deck.value?.cyber?.effect.match(/防火牆 (\d+)/)?.[1] ?? 0))
const sel = ref(0)
const selDef = computed(() => { const id = g.deck.slots[sel.value]; return id ? ITEMS[id] : null })
/** 能換進來的構裝：背包裡的與其他槽裡的。 */
const owned = computed(() => g.inventory.filter(s => ITEMS[s.def].kind === 'construct').map(s => ITEMS[s.def]))
const cls = (d: ItemDef | null) => (d?.net && d.net.cls !== 'SKIN' ? d.net.cls : '')
function swapIn(d: ItemDef) {
  const st = g.inventory.find(s => s.def === d.id)
  if (!st) return
  const prev = g.deck.slots[sel.value]
  g.removeItem(st.uid)
  if (prev) g.addItem(prev)
  g.deck.slots[sel.value] = d.id
  if (cls(d) === '防護' && !g.deck.activeGuard) g.deck.activeGuard = d.id
}
function takeOut() {
  const prev = g.deck.slots[sel.value]
  if (!prev) return
  g.deck.slots[sel.value] = null
  if (g.deck.activeGuard === prev) g.deck.activeGuard = null
  g.addItem(prev)
}
function setGuard(id: string) { g.deck.activeGuard = id; ui.toast(`防護改開「${ITEMS[id].name}」；同時只能開一個。`) }
const atAccess = computed(() => g.loc.facility === 'myhome')
const eng = useEngine()
const skinBlock = computed(() => (eng.inBattle || eng.commission.view() !== null ? '戰鬥中與委託副本裡不能換 SKIN。' : atAccess.value ? null : '換 SKIN 要在接入點：據點的接入艙、潛艙店。'))
const worn = computed(() => ITEMS[g.deck.skinWorn])
const skinInfo = computed(() => (worn.value.net && worn.value.net.cls === 'SKIN' ? worn.value.net : null))
const attr = (n: string) => g.character.attrs.find(a => a.name === n)!.eff
const ramMax = computed(() => 4 + attrMod(attr('智識')))
const guardDef = computed(() => (g.deck.activeGuard ? ITEMS[g.deck.activeGuard] : null))
const guardVal = computed(() => Number(guardDef.value?.stats?.find(s => s[0] === '防護')?.[1] ?? 0))
const legal = computed(() => g.deck.slots.filter(Boolean).map(id => ITEMS[id!]).filter(d => d.legality !== '自由'))
</script>

<template>
  <section class="net">
    <div class="panel cut pad">
      <p class="h">甲板<Hint>有甲板才有 RAM。甲板決定構裝槽幾格與防火牆；構裝體佔兩格。</Hint></p>
      <div v-if="deck" class="dh"><ItemSlot :item="deck" size="md" /><div><div class="k">腦的義體・{{ deck.brand }}</div><h3 :style="{ color: `var(--g${deck.grade})` }">{{ deck.name }}</h3><div class="chips"><GradeBadge :grade="deck.grade" /><span class="tag">構裝槽 {{ slotsN }}</span><span class="tag">防火牆 {{ firewall }}</span></div></div></div>
      <div v-else class="blocking">腦裡沒有甲板：沒有 RAM，進不了子網。</div>
      <p class="h mt">構裝槽 {{ g.deck.slots.filter(Boolean).length }}／{{ slotsN }}</p>
      <div class="cgrid">
        <ItemSlot v-for="(id, i) in g.deck.slots.slice(0, slotsN)" :key="i" :item="id ? ITEMS[id] : null" slot-icon="ic-net_weapon" :label="id ? cls(ITEMS[id]) : undefined" show-name :selected="sel === i" @select="sel = i" />
      </div>
      <div class="swap">
        <template v-if="selDef">
          <div class="kv"><span>{{ cls(selDef) }}構裝</span><b>{{ selDef.stats?.map(s => `${s[0]} ${s[1]}`).join('・') }}</b></div>
          <div v-if="cls(selDef) === '防護'" class="kv"><span>防護<Hint>同時只能開一個防護構裝。</Hint></span><b><ReasonButton sm :pri="g.deck.activeGuard !== selDef.id" :reason="g.deck.activeGuard === selDef.id ? '已經開著。' : null" @go="setGuard(selDef.id)">{{ g.deck.activeGuard === selDef.id ? '開著' : '改開這一個' }}</ReasonButton></b></div>
        </template>
        <p class="h">換進來<Hint>背包裡的構裝。換下來的放回背包。</Hint></p>
        <div class="cgrid sm">
          <ItemSlot v-for="d in owned" :key="d.id" :item="d" size="sm" show-name @select="swapIn(d)" />
        </div>
        <div v-if="!owned.length" class="empty-note">背包裡沒有別的構裝。</div>
        <div class="go"><ReasonButton sm :reason="selDef ? null : '這一格是空的。'" @go="takeOut">拿下來</ReasonButton></div>
      </div>
      <p class="h mt">SKIN・{{ g.deck.skins.length }} 套</p>
      <div class="cgrid">
        <ItemSlot v-for="id in g.deck.skins" :key="id" :item="ITEMS[id]" slot-icon="ic-skin" show-name :selected="g.deck.skinWorn === id" :label="g.deck.skinWorn === id ? '穿著' : undefined" :dye="g.dyes[`skin:${id}`] ?? null" @select="skinBlock ? ui.toast(skinBlock, 'warn') : (g.deck.skinWorn = id)" />
      </div>
      <div class="go left"><ReasonButton sm :reason="g.deck.skinWorn ? null : '沒有穿著的 SKIN。'" data-open-dye @go="ui.open('dye', { dyeKey: `skin:${g.deck.skinWorn}`, where: 'net', place: '化身編輯' })">染 SKIN 的顏色</ReasonButton></div>
    </div>
    <aside class="panel cut pad">
      <p class="h">網內的數字<Hint>RAM 上限是 4 加智識的調整值；傷害加值是魅力的調整值（CYBERSPACE 4.1 節）。外觀不改數值。</Hint></p>
      <div class="kv"><span>RAM 上限</span><b>{{ ramMax }}</b></div>
      <div class="kv"><span>RAM 回復</span><b>每回合 1</b></div>
      <div class="kv"><span>防護</span><b>{{ guardVal }}{{ guardDef ? `・${guardDef.name}` : '' }}</b></div>
      <div class="kv"><span>感載上限</span><b>{{ g.character.load[1] }}</b></div>
      <div class="kv"><span>承受層數</span><b>{{ g.character.layers[1] }}</b></div>
      <div class="kv"><span>傷害加值</span><b>+{{ attrMod(attr('魅力')) }}</b></div>
      <p class="h mt">SKIN・{{ worn.name }}</p>
      <div class="kv"><span>風格</span><b>{{ skinInfo?.style }}</b></div>
      <div class="kv"><span>風格值</span><b>{{ skinInfo?.styleValue }}</b></div>
      <div class="kv"><span>曝露度</span><b>{{ skinInfo?.exposure }}／3</b></div>
      <p class="h mt">掃橋看得到<Hint>掃橋讀得到甲板裡存了什麼。</Hint></p>
      <div v-if="!legal.length" class="empty-note">甲板裡都是自由的東西。</div>
      <div v-for="d in legal" :key="d.id" class="kv"><span>{{ d.name }}</span><b class="warn-t">{{ d.legality }}</b></div>
    </aside>
  </section>
</template>

<style scoped>
.net { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; align-items: start; }
.dh { display: grid; grid-template-columns: 64px 1fr; gap: 12px; align-items: center; }
.dh h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.mt { margin-top: 14px; }
.cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px; }
.cgrid.sm { grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); }
.swap { margin-top: 10px; padding: 10px; background: var(--bg-2); }
@media (max-width: 1100px) { .net { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .cgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
