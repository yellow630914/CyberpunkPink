<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ItemSlot from '../../components/ItemSlot.vue'
import GradeBadge from '../../components/GradeBadge.vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useGame } from '../../stores/game'
import { useUi } from '../../stores/ui'
import { LEGAL_NAME, grade, bumpScript, candidateLine, constructLines, deckSlot, pieceSlot, skinSlot, slotRows, slotsText } from '../../lib/deckView'

/**
 * 角色的「內海」分頁（UI 8.2 節，ITEMS 11.9 節、CYBERSPACE 4.2、4.3 節）：甲板、構裝槽、帶著的腳本、SKIN；右欄是網內的數字。
 * 這裡只編排：讀 store 的 deck（引擎 features/deck 的 deckView 與衍生數值）、呼叫它的動作。槽數、能不能裝、為什麼不能、
 * RAM 與防護都是引擎的答案，原因直接顯示引擎寫的那一句；裝與卸各花時間（引擎的 deck_rule），戰鬥中與網內的行程進行中整頁唯讀。
 */
const eng = useEngine()
const g = useGame()
const ui = useUi()

const lock = computed(() => eng.deck.lock())
const view = computed(() => eng.deck.view())
const nums = computed(() => eng.deck.numbers())
const sync = computed(() => eng.deck.sync())
const deck = computed(() => view.value?.deck ?? null)
const rows = computed(() => (view.value ? slotRows(view.value) : []))

/** 選到的槽（格的編號）；新甲板或裝卸之後，選到的格不見了就回到沒選 */
const sel = ref<number | null>(null)
watch(() => view.value?.cells.length, () => { if (sel.value !== null && sel.value >= (view.value?.cells.length ?? 0)) sel.value = null })
const selCell = computed(() => (sel.value === null ? null : view.value?.cells[sel.value] ?? null))
const selPiece = computed(() => (selCell.value?.piece ? view.value!.equipped.find((e) => e.piece.id === selCell.value!.piece!.id) ?? null : null))
const selEntry = computed(() => (selPiece.value ? eng.deck.construct(selPiece.value.piece.id) : undefined))
const pick = (i: number, c: { reserved?: boolean }) => { if (c.reserved) { ui.toast('這一槽被專屬構裝佔掉了。', 'warn'); return } sel.value = i }

const say = (why: string | null, ok?: string) => { if (why) ui.toast(why, 'warn'); else if (ok) ui.toast(ok) }
const swapNote = '（裝與卸各多花 1 分鐘）'
const reasonOf = (own: string | null) => lock.value ?? own
const install = (item: string) => say(eng.deck.install(item), '裝上了。')
const remove = (item: string) => { say(eng.deck.remove(item), '卸下了。'); sel.value = null }

// ---- 腳本 ----
const scriptRows = computed(() => {
  const v = view.value
  if (!v) return []
  const list = eng.deck.scriptList()
  return v.scripts.available.map((a) => {
    const now = list.find((s) => s.item === a.item)?.qty ?? 0
    return { ...a, now, plusWhy: now >= a.have ? '背包裡沒有更多了。' : eng.deck.scriptsBlock(bumpScript(list, a.item, 1)), minusWhy: now <= 0 ? '沒有帶這一種。' : null }
  })
})
const bump = (item: string, by: 1 | -1) => say(eng.deck.scripts(bumpScript(eng.deck.scriptList(), item, by)))

// ---- SKIN ----
const worn = computed(() => view.value?.skins.find((s) => s.worn) ?? null)

// ---- 掃橋看得到 ----
const legal = computed(() => (view.value?.equipped ?? []).map((e) => ({ name: e.piece.name, legal: eng.deck.construct(e.piece.id)?.legal ?? 'free' })).filter((x) => x.legal !== 'free'))
</script>

<template>
  <section class="net">
    <div class="panel cut pad">
      <p v-if="lock" class="blocking" data-testid="deck-lock">{{ lock }}整頁唯讀。</p>
      <p class="h">甲板<Hint>有甲板才有 RAM。甲板決定構裝槽幾格與防火牆；構裝體佔兩格。換甲板時裝不下的構裝退回背包。</Hint></p>
      <div v-if="deck?.has" class="dh">
        <ItemSlot :item="deckSlot({ item: deck.deck!, name: deck.name!, grade: deck.grade })" size="md" inert />
        <div>
          <div class="k">{{ deck.source === 'rental' ? '租來的甲板' : '腦的甲板' }}</div>
          <h3 :style="{ color: `var(--g${deck.grade})` }">{{ deck.name }}</h3>
          <div class="chips"><GradeBadge :grade="grade(deck.grade)" /><span class="tag">構裝槽 {{ deck.slotsTotal }}</span><span class="tag">防火牆 {{ deck.firewall }}</span></div>
        </div>
      </div>
      <div v-else class="nodeck" data-testid="no-deck">沒有甲板：沒有 RAM、不能在網內戰鬥</div>
      <div v-if="view?.decks.some((d) => !d.current)" class="swap">
        <p class="h">背包裡的甲板<Hint>換上之後，原本那一副留在背包。</Hint></p>
        <div class="list">
          <div v-for="d in view.decks.filter((x) => !x.current)" :key="d.uid" class="row">
            <span class="ic"><ItemSlot :item="deckSlot(d)" size="sm" inert /></span>
            <span class="nm">{{ d.name }}<small>{{ d.grade }} 級・槽 {{ d.slots }}・防火牆 {{ d.firewall }}</small></span>
            <ReasonButton sm :pri="!reasonOf(d.block)" :reason="reasonOf(d.block)" @go="say(eng.deck.equip(d.uid), '換好甲板了。')">裝上</ReasonButton>
          </div>
        </div>
      </div>

      <p class="h mt">構裝槽 {{ view ? slotsText(view) : '0' }}<Hint>構裝與快駭程式共用同一排槽。{{ swapNote }}</Hint></p>
      <div v-if="!deck?.has" class="cgrid" data-testid="slots-empty">
        <ItemSlot v-for="i in 4" :key="i" :item="null" slot-icon="ic-net_weapon" label="空" inert />
      </div>
      <div v-else class="cgrid" data-testid="slots">
        <ItemSlot v-for="r in rows" :key="r.cell.index" :item="r.item" slot-icon="ic-net_weapon" :label="r.label" show-name :selected="sel === r.cell.index" :class="{ reserved: r.cell.reserved, cont: r.cell.continued }" :data-cell="r.cell.index" :data-reserved="r.cell.reserved ? 1 : undefined" @select="pick(r.cell.index, r.cell)" />
      </div>

      <div v-if="deck?.has && selCell" class="swap" data-testid="slot-detail">
        <template v-if="selPiece">
          <div class="kv"><span>{{ selPiece.piece.name }}</span><b><GradeBadge :grade="grade(selPiece.piece.grade)" /></b></div>
          <div v-for="l in constructLines(selEntry)" :key="l[0]" class="kv"><span>{{ l[0] }}</span><b>{{ l[1] }}</b></div>
          <p v-if="selPiece.note" class="warn-t note" data-testid="over-note">{{ selPiece.note }}</p>
          <div class="go"><ReasonButton sm :reason="reasonOf(selPiece.removeBlock)" data-remove @go="remove(selPiece.piece.id)">卸下（1 分鐘）</ReasonButton></div>
        </template>
        <template v-else>
          <p class="h">背包裡裝得上的<Hint>灰掉的裝不上，點了會說原因。{{ swapNote }}</Hint></p>
          <div v-if="!view?.candidates.length" class="empty-note">背包裡沒有構裝或快駭程式。</div>
          <div class="list">
            <div v-for="c in view?.candidates" :key="c.item" class="row" :class="{ 'is-unavailable': !!reasonOf(c.block) }" :data-cand="c.item">
              <span class="ic"><ItemSlot :item="pieceSlot(c.piece)" size="sm" inert /></span>
              <span class="nm">{{ c.piece.name }}<small>{{ candidateLine(c) }}</small><small v-if="c.block" class="why">{{ c.block }}</small></span>
              <ReasonButton sm :pri="!reasonOf(c.block)" :reason="reasonOf(c.block)" @go="install(c.item)">裝上</ReasonButton>
            </div>
          </div>
        </template>
      </div>

      <p class="h mt">腳本・帶 {{ view?.scripts.carried.reduce((n, s) => n + s.qty, 0) ?? 0 }}／{{ view?.scripts.limit ?? 0 }}<Hint>一次性的程式，不佔構裝槽；最多帶「甲板等級 ＋1」支。打完用掉的從背包扣。沒有甲板不能帶。</Hint></p>
      <div v-if="!scriptRows.length" class="empty-note">背包裡沒有腳本。</div>
      <div class="list" data-testid="scripts">
        <div v-for="s in scriptRows" :key="s.item" class="row two">
          <span class="nm">{{ s.name }}<small>背包 {{ s.have }}・帶著 {{ s.now }}</small></span>
          <span class="step">
            <ReasonButton sm :reason="reasonOf(s.minusWhy)" @go="bump(s.item, -1)">−</ReasonButton>
            <ReasonButton sm :reason="reasonOf(s.plusWhy)" @go="bump(s.item, 1)">＋</ReasonButton>
          </span>
        </div>
      </div>

      <p class="h mt">SKIN・{{ view?.skins.length ?? 0 }} 套<Hint>化身的穿著，只是外觀；背包裡有才穿得上。戰鬥中不能換。</Hint></p>
      <div v-if="!view?.skins.length" class="empty-note">背包裡沒有 SKIN。</div>
      <div class="cgrid" data-testid="skins">
        <ItemSlot v-for="s in view?.skins" :key="s.item" :item="skinSlot(s)" slot-icon="ic-skin" show-name :selected="s.worn" :label="s.worn ? '穿著' : undefined" :dye="g.dyes[`skin:${s.item}`] ?? null" :unavailable="s.worn ? null : reasonOf(s.block)" @select="s.worn ? null : say(eng.deck.skin(s.item), '換好 SKIN 了。')" />
      </div>
      <div class="go left"><ReasonButton sm :reason="worn ? null : '沒有穿著的 SKIN。'" data-open-dye @go="ui.open('dye', { dyeKey: `skin:${worn!.item}`, where: 'net', place: '化身編輯' })">染 SKIN 的顏色</ReasonButton></div>
    </div>

    <aside class="panel cut pad">
      <p class="h">網內的數字<Hint>全部讀引擎的衍生數值（甲板、技能、義體加進去之後的結果）。外觀不改數值。</Hint></p>
      <div class="kv"><span>RAM 上限</span><b data-stat="ram_max">{{ nums.ramMax }}</b></div>
      <div class="kv"><span>RAM 回復</span><b data-stat="ram_regen">每回合 {{ nums.ramRegen }}</b></div>
      <div class="kv"><span>防護<Hint>裝著的防護構裝裡最高的那一件。</Hint></span><b data-stat="net_guard">{{ nums.guard }}</b></div>
      <div class="kv"><span>防火牆</span><b data-stat="deck_firewall">{{ nums.firewall }}</b></div>
      <div class="kv"><span>感載上限</span><b data-stat="load_cap">{{ nums.loadCap }}</b></div>
      <div class="kv"><span>承受層數</span><b data-stat="afterglow_cap">{{ nums.layers }}</b></div>
      <p v-if="!nums.hasDeck" class="empty-note">沒有甲板：沒有 RAM。</p>
      <p class="h mt">同步檔位<Hint>你開得到的最高一檔，以及更高的幾檔為什麼開不了。</Hint></p>
      <div v-if="sync" data-testid="sync">
        <div v-for="x in sync.gears" :key="x.id" class="kv" :class="{ 'is-unavailable': !x.ok }"><span>{{ x.name }}</span><b>{{ x.ok ? (x.id === sync.cap ? '開得到（最高）' : '開得到') : x.why.join('') }}</b></div>
      </div>
      <p class="h mt">掃橋看得到<Hint>掃橋讀得到甲板裡存了什麼。</Hint></p>
      <div v-if="!legal.length" class="empty-note">甲板裡都是自由的東西。</div>
      <div v-for="d in legal" :key="d.name" class="kv"><span>{{ d.name }}</span><b class="warn-t">{{ LEGAL_NAME[d.legal] ?? d.legal }}</b></div>
    </aside>
  </section>
</template>

<style scoped>
.net { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; align-items: start; }
.dh { display: grid; grid-template-columns: 64px 1fr; gap: 12px; align-items: center; }
.dh h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.nodeck { padding: 16px 12px; border: 1px dashed var(--line-2); color: var(--ink-3); font-size: var(--fs-sm); font-weight: 700; }
.mt { margin-top: 14px; }
.cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px; }
.swap { margin-top: 10px; padding: 10px; background: var(--bg-2); }
.list { display: grid; gap: 8px; }
.row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.row .ic { width: 56px; }
.row .nm { display: grid; gap: 2px; font-size: var(--fs-sm); font-weight: 800; min-width: 0; }
.row .nm small { color: var(--ink-3); font-weight: 600; font-size: var(--fs-xs); }
.row .nm small.why { color: var(--warn); }
.row.two { grid-template-columns: minmax(0, 1fr) auto; }
.step { display: inline-flex; gap: 6px; }
.note { font-size: var(--fs-sm); margin: 6px 0; }
.reserved { opacity: .6; }
.cont { opacity: .7; }
.blocking { margin: 0 0 10px; }
@media (max-width: 1100px) { .net { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .cgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
