<template>
  <ion-modal :is-open="open" :initial-breakpoint="1" :breakpoints="[0, 1]" class="sheet-modal" @did-dismiss="emit('close')">
    <div class="rb-sheet">
      <div class="head">
        <div class="titles">
          <div class="t">{{ title ?? 'Cuenta' }}</div>
          <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
        </div>
        <button type="button" class="icon-btn" aria-label="Cerrar" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="list">
        <button v-for="a in finanzas.accounts" :key="a.id" type="button" class="item" :aria-pressed="a.id === selected" @click="emit('select', a)">
          <span class="name"><span>{{ a.name }}</span><span class="kind">{{ ACCOUNT_KIND[a.payment] }}</span></span>
          <svg v-if="a.id === selected" class="check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </button>
        <button type="button" class="item add" @click="add">+ Nueva cuenta</button>
      </div>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { IonModal } from '@ionic/vue';
import { createAccount } from '@/composables/accountPrompts';
import { ACCOUNT_KIND, type Account } from '@/domain/accounts';
import { useFinanzasStore } from '@/stores/finanzas';

/** Hoja para elegir de qué cuenta sale (o a cuál entra) la plata. */
defineProps<{ open: boolean; selected?: string; title?: string; subtitle?: string }>();
const emit = defineEmits<{ select: [account: Account]; close: [] }>();

const finanzas = useFinanzasStore();

/** La cuenta nueva queda elegida. */
async function add() {
  const created = await createAccount();
  if (created) emit('select', created);
}
</script>

<style scoped>
ion-modal.sheet-modal { --height: auto; --border-radius: 16px; --background: var(--rb-bg); }
.titles { flex-grow: 1; min-width: 0; }
.titles .t { font-size: 18px; font-weight: 600; }
.subtitle { font-size: 13px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-sheet .icon-btn { width: 36px; height: 36px; border-radius: 50%; background: var(--rb-segment); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.list { background: #fff; border-radius: 14px; padding: 0 14px; max-height: 60vh; overflow-y: auto; }
.rb-sheet .item { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--rb-line); font-size: 16px; }
.rb-sheet .item:last-child { border-bottom: 0; }
.item .name { flex-grow: 1; display: flex; flex-direction: column; gap: 2px; }
.item .kind { font-size: 13px; color: var(--rb-muted); }
.check { color: var(--rb-accent); }
.rb-sheet .item.add { color: var(--rb-accent); font-weight: 500; }
</style>
