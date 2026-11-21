<script setup lang="ts">
import { type Component } from 'vue'
import { useUi, type DialogName } from '../stores/ui'
import BagDialog from '../dialogs/BagDialog.vue'
import CharacterDialog from '../dialogs/CharacterDialog.vue'
import TalkDialog from '../dialogs/TalkDialog.vue'
import ShopDialog from '../dialogs/ShopDialog.vue'
import SettingsDialog from '../dialogs/SettingsDialog.vue'
import RosterDialog from '../dialogs/RosterDialog.vue'
import RelationsDialog from '../dialogs/RelationsDialog.vue'
import SkillTreeDialog from '../dialogs/SkillTreeDialog.vue'
import CraftDialog from '../dialogs/CraftDialog.vue'
import ChannelDialog from '../dialogs/ChannelDialog.vue'
import ContractDialog from '../dialogs/ContractDialog.vue'
import BillsDialog from '../dialogs/BillsDialog.vue'
import GuideDialog from '../dialogs/GuideDialog.vue'
import MemoDialog from '../dialogs/MemoDialog.vue'
import PendingDialog from '../dialogs/PendingDialog.vue'
import SaveDialog from '../dialogs/SaveDialog.vue'
import CityDialog from '../dialogs/CityDialog.vue'
import TransitDialog from '../dialogs/TransitDialog.vue'
import FixerDialog from '../dialogs/FixerDialog.vue'
import LiveDialog from '../dialogs/LiveDialog.vue'
import CutDialog from '../dialogs/CutDialog.vue'
import MechDialog from '../dialogs/MechDialog.vue'
import ClinicDialog from '../dialogs/ClinicDialog.vue'
import GarageDialog from '../dialogs/GarageDialog.vue'
import DifficultyDialog from '../dialogs/DifficultyDialog.vue'

/** 對話框層：照 ui.stack 的順序畫。Esc 關最上面那一個（App.vue 的全域快捷鍵）。 */
const REGISTRY: Record<DialogName, Component> = {
  bag: BagDialog, character: CharacterDialog, talk: TalkDialog, shop: ShopDialog, settings: SettingsDialog,
  roster: RosterDialog, relations: RelationsDialog, skills: SkillTreeDialog, craft: CraftDialog, channel: ChannelDialog, contract: ContractDialog,
  bills: BillsDialog, guide: GuideDialog, memo: MemoDialog, pending: PendingDialog, saves: SaveDialog, city: CityDialog, transit: TransitDialog,
  fixer: FixerDialog, live: LiveDialog, cut: CutDialog, mech: MechDialog, clinic: ClinicDialog, garage: GarageDialog, difficulty: DifficultyDialog,
}
const ui = useUi()
</script>

<template>
  <component :is="REGISTRY[d.name]" v-for="(d, i) in ui.stack" :key="d.id" :entry-id="d.id" :stacked="i > 0" v-bind="d.props" />
  <div class="toasts" aria-live="polite">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: var(--z-toast); display: grid; gap: 6px; width: min(420px, calc(100vw - 24px)); pointer-events: none; }
.toast { background: #120D19; color: #F3E9FF; box-shadow: inset 3px 0 0 #45D6C5, 4px 4px 0 #0E0A14; padding: 10px 14px; font-size: var(--fs-ui); font-weight: 700; }
.toast.warn { box-shadow: inset 3px 0 0 #FF8A5C, 4px 4px 0 #0E0A14; }
</style>
