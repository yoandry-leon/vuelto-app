<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap">
        <!-- Eligiendo varios para borrar: la barra cambia a Cancelar · N seleccionados · Todos -->
        <div v-if="selecting" class="rb-navbar select-bar">
          <button type="button" class="rb-navlink" @click="stopSelecting">Cancelar</button>
          <span class="title">{{ selected.size ? `${selected.size} ${selected.size === 1 ? 'seleccionado' : 'seleccionados'}` : 'Elegí movimientos' }}</span>
          <button type="button" class="rb-navlink end" @click="toggleAll">{{ allSelected ? 'Ninguno' : 'Todos' }}</button>
        </div>
        <div v-else class="head">
          <h1 class="rb-title" style="padding: 0">Movimientos</h1>
          <div class="actions">
            <button type="button" class="rb-round sync" aria-label="Sincronización" @click="router.push('/tabs/movimientos/sync')">
              <sync-icon :state="syncState" />
            </button>
            <button type="button" class="rb-pill month" @click="pickMonth">
              {{ capitalize(monthName(month)) }}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
        </div>

        <label class="rb-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span class="sr">Buscar movimientos</span>
          <input v-model="query" type="search" placeholder="Buscar comercio o categoría" enterkeyhint="search" />
        </label>

        <div class="filters-row">
        <div class="filters" role="tablist" aria-label="Filtrar movimientos">
          <button type="button" role="tab" class="rb-chip" :class="{ on: filter === 'todos' }" :aria-selected="filter === 'todos'" @click="filter = 'todos'">Todos</button>
          <button v-if="categoryFilter" type="button" class="rb-chip on" @click="categoryFilter = undefined">
            {{ categoryFilter }}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <!-- De qué cuenta salió: filtra la lista o lleva a "Tus cuentas" -->
          <button v-if="accountFilter" type="button" class="rb-chip on" @click="accountFilter = undefined">
            {{ accountFilter.name }}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <button v-else type="button" class="rb-chip" @click="pickAccount">
            Cuenta
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button v-if="gastos.pending.length" type="button" role="tab" class="rb-chip" :class="{ on: filter === 'sin-subir' }" :aria-selected="filter === 'sin-subir'" @click="filter = 'sin-subir'">Sin subir · {{ gastos.pending.length }}</button>
          <button v-if="gastos.toReview.length" type="button" role="tab" class="rb-chip" :class="{ on: filter === 'revisar' }" :aria-selected="filter === 'revisar'" @click="filter = 'revisar'">
            <span v-if="filter !== 'revisar'" class="rb-dot" style="width: 8px; height: 8px; background: var(--rb-warn)" />Por revisar · {{ gastos.toReview.length }}
          </button>
        </div>
        <button v-if="!selecting && days.length" type="button" class="select-link" @click="selecting = true">Seleccionar</button>
        </div>

        <div v-for="d in days" :key="d.date" class="rb-section">
          <div class="rb-section-head">
            <span class="rb-label" style="padding: 0">{{ relativeDay(d.date) }}</span>
            <button v-if="selecting" type="button" class="day-link" @click="toggleDay(d.items)">{{ d.items.every((t) => selected.has(t.id)) ? 'Quitar el día' : 'Todo el día' }}</button>
            <span v-else class="rb-small rb-amount">{{ d.total ? formatPesos(d.total, { sign: true }) : '' }}</span>
          </div>
          <div class="rb-group">
            <gasto-row v-for="t in d.items" :key="t.id" :ticket="t" :icon="false" :fixed="fixedIds.has(t.id)" :selecting="selecting" :selected="selected.has(t.id)" @open="openRow" />
          </div>
        </div>
        <div v-if="!days.length" class="rb-empty">
          <span class="t">{{ query || filter !== 'todos' || categoryFilter || accountFilter ? 'No hay movimientos con ese filtro' : `Sin gastos en ${monthName(month)}` }}</span>
        </div>

        <div v-if="selecting" class="bulk">
          <button type="button" class="rb-btn delete" :disabled="!selected.size" @click="deleteSelected">
            {{ selected.size ? `Eliminar ${selected.size} ${selected.size === 1 ? 'movimiento' : 'movimientos'}` : 'Eliminar' }}
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { actionSheetController, alertController, IonContent, IonPage, onIonViewWillLeave, toastController, useIonRouter } from '@ionic/vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import GastoRow from '@/components/GastoRow.vue';
import SyncIcon from '@/components/SyncIcon.vue';
import { useFixedCostIds } from '@/composables/fixedCosts';
import { type Account, accountOf, spentByAccount } from '@/domain/accounts';
import { monthKey, monthName, relativeDay, todayIso } from '@/domain/dates';
import { formatPesos, round2 } from '@/domain/money';
import { normalize } from '@/domain/products';
import { isIncome, ticketTotals } from '@/domain/totals';
import type { Category, Ticket } from '@/domain/types';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';
import { useSyncStore } from '@/stores/sync';

const router = useIonRouter();
const fixedIds = useFixedCostIds();
const route = useRoute();
const gastos = useGastosStore();
const finanzas = useFinanzasStore();
const sync = useSyncStore();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const month = ref(monthKey(todayIso()));
const query = ref('');
const filter = ref<'todos' | 'sin-subir' | 'revisar'>('todos');
/** "Ver gastos" de una categoría en Presupuesto llega con ?categoria= */
const categoryFilter = ref<Category>();
watch(
  () => route.query.categoria,
  (c) => {
    if (typeof c === 'string' && c) {
      categoryFilter.value = c as Category;
      filter.value = 'todos';
    }
  },
  { immediate: true },
);
/** "Ver sus gastos" en Tus cuentas llega con ?cuenta= */
const accountFilterId = ref<string>();
const accountFilter = computed({
  get: () => finanzas.accounts.find((a) => a.id === accountFilterId.value),
  set: (a: Account | undefined) => (accountFilterId.value = a?.id),
});
watch(
  () => route.query.cuenta,
  (c) => {
    if (typeof c === 'string' && c) {
      accountFilterId.value = c;
      filter.value = 'todos';
    }
  },
  { immediate: true },
);

/** "Cuenta ▾": cada cuenta con lo que salió de ella este mes, y el acceso a Tus cuentas. */
async function pickAccount() {
  const spent = spentByAccount(gastos.tickets, finanzas.accounts, month.value);
  const sheet = await actionSheetController.create({
    header: `De qué cuenta salió · ${monthName(month.value)}`,
    buttons: [
      ...spent.map((r) => ({ text: `${r.account.name} · ${formatPesos(-r.spent)}`, handler: () => void (accountFilterId.value = r.account.id) })),
      { text: 'Ver tus cuentas', handler: () => void router.push('/tabs/movimientos/cuentas') },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

const syncState = computed(() => {
  if (gastos.toReview.length) return 'revisar' as const;
  if (gastos.pending.length) return sync.syncing && sync.online ? ('subiendo' as const) : ('telefono' as const);
  return 'sincronizado' as const;
});

const months = computed(() => [...new Set([monthKey(todayIso()), ...gastos.months])].sort().reverse().slice(0, 12));

async function pickMonth() {
  const sheet = await actionSheetController.create({
    header: 'Mes',
    buttons: [
      ...months.value.map((m) => ({ text: capitalize(monthName(m)), handler: () => void (month.value = m) })),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

function matches(t: Ticket): boolean {
  if (filter.value === 'sin-subir' && t.sync.state !== 'pendiente') return false;
  if (filter.value === 'revisar' && !t.review) return false;
  if (categoryFilter.value && !t.lines.some((l) => l.category === categoryFilter.value)) return false;
  if (accountFilter.value && accountOf(t, finanzas.accounts)?.id !== accountFilter.value.id) return false;
  const q = normalize(query.value.trim());
  if (!q) return true;
  const text = normalize([t.store, t.phrase ?? '', ...t.lines.flatMap((l) => [l.pretty, l.category, l.subcategory])].join(' '));
  return text.includes(q);
}

const days = computed(() => {
  const map = new Map<string, Ticket[]>();
  const inMonth = filter.value === 'todos' && !query.value.trim();
  for (const t of gastos.sorted) {
    // Los filtros de estado y la búsqueda miran todos los meses
    if (inMonth && monthKey(t.date) !== month.value) continue;
    if (matches(t)) map.set(t.date, [...(map.get(t.date) ?? []), t]);
  }
  // Lo del día como en la cuenta: los gastos restan y los ingresos suman
  return [...map.entries()].map(([date, items]) => ({ date, items, total: round2(items.reduce((s, t) => s + (isIncome(t) ? 1 : -1) * ticketTotals(t).net, 0)) }));
});

// Elegir varios para borrarlos de una vez
const selecting = ref(false);
const selected = ref(new Set<string>());
const visible = computed(() => days.value.flatMap((d) => d.items));
const allSelected = computed(() => visible.value.length > 0 && visible.value.every((t) => selected.value.has(t.id)));

function openRow(id: string) {
  if (!selecting.value) {
    router.push(`/tabs/movimientos/gasto/${id}`);
    return;
  }
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleDay(items: Ticket[]) {
  const next = new Set(selected.value);
  const all = items.every((t) => next.has(t.id));
  for (const t of items) {
    if (all) next.delete(t.id);
    else next.add(t.id);
  }
  selected.value = next;
}

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(visible.value.map((t) => t.id));
}

function stopSelecting() {
  selecting.value = false;
  selected.value = new Set();
}

async function deleteSelected() {
  const ids = [...selected.value];
  if (!ids.length) return;
  const n = ids.length;
  const uploaded = gastos.tickets.some((t) => selected.value.has(t.id) && t.sync.state === 'subido');
  const alert = await alertController.create({
    header: n === 1 ? '¿Eliminar 1 movimiento?' : `¿Eliminar ${n} movimientos?`,
    message: uploaded ? 'Se borran de este teléfono y de tu cuenta del bot. No se puede deshacer.' : 'Se borran de este teléfono. No se puede deshacer.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Eliminar', role: 'destructive' },
    ],
  });
  await alert.present();
  if ((await alert.onDidDismiss()).role !== 'destructive') return;
  await gastos.remove(ids);
  stopSelecting();
  const toast = await toastController.create({ message: n === 1 ? 'Movimiento eliminado' : `${n} movimientos eliminados`, duration: 2000, position: 'top', cssClass: 'rb-toast' });
  await toast.present();
}

onIonViewWillLeave(stopSelecting);
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; padding: 4px 4px 0; }
.actions { display: flex; align-items: center; gap: 8px; }
.rb-wrap .sync { background: var(--rb-segment); }
.filters-row { display: flex; align-items: center; gap: 8px; }
.filters { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; }
.rb-wrap .select-link { flex-shrink: 0; min-height: 40px; padding: 0 2px; color: var(--rb-accent); font-size: 15px; }
.select-bar { padding: 0 4px; }
.rb-wrap .day-link { min-height: 28px; color: var(--rb-accent); font-size: 14px; }
/* La barra de borrar queda pegada abajo mientras se elige */
.bulk { position: sticky; bottom: 12px; padding-top: 4px; }
.rb-wrap .rb-btn.delete { min-height: 52px; background: var(--rb-danger); color: #fff; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); }
.rb-wrap .rb-btn.delete:disabled { background: var(--rb-segment); color: var(--rb-muted); box-shadow: none; }
.filters::-webkit-scrollbar { display: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
