<template>
  <div v-if="header" class="rb-wrap ticket-qr">
    <div class="rb-navbar">
      <button type="button" class="rb-navlink" @click="emit('back')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Cámara
      </button>
      <span class="title">Ticket por QR</span>
      <span />
    </div>

    <div class="hero">
      <span class="store">{{ store }}</span>
      <span class="total rb-amount">{{ formatPesos(header.total) }}</span>
      <span class="read"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rb-accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>Leído del QR · {{ dayMonthYear(header.date) }}</span>
    </div>

    <!-- Una sola alerta: ya registrado, o algo raro en el QR -->
    <div v-if="duplicate" class="rb-alert">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rb-warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
      <span class="grow"><span class="t">Este ticket ya está {{ duplicate }}</span><span class="s">Mismo RUT, serie y número. No se suma dos veces.</span></span>
    </div>
    <div v-else-if="warning" class="rb-alert">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rb-warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
      <span class="grow"><span class="t">Revisá el ticket</span><span class="s">{{ warning }}</span></span>
    </div>

    <div class="rb-group">
      <button type="button" class="rb-row big" @click="sheetOpen = true">
        <span class="grow">Categoría</span>
        <span class="value">{{ category.category }}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></span>
      </button>
      <button type="button" class="rb-row big" @click="accountOpen = true">
        <span class="grow">Cuenta</span>
        <span class="value">{{ account?.name ?? 'Elegí la cuenta' }}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></span>
      </button>
    </div>

    <button type="button" class="split" :disabled="!!duplicate || busy" @click="split">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rb-muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
      <span class="grow"><span>Separar por productos (opcional)</span><span class="s">Con una foto del ticket</span></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M9 18l6-6-6-6" /></svg>
    </button>

    <details class="data">
      <summary>Datos del comprobante</summary>
      <span>{{ cfeLabel(header) }} · RUT {{ formatRut(header.rut) }}. El nombre del comercio sale de tickets anteriores con el mismo RUT o se completa al sincronizar.</span>
    </details>

    <button v-if="duplicate === 'guardado'" type="button" class="rb-btn neutral confirm" @click="emit('back')">Escanear otro</button>
    <button v-else type="button" class="rb-btn primary confirm" :disabled="!!duplicate || busy" @click="confirm">Confirmar y agregar · {{ formatPesos(header.total) }}</button>

    <account-sheet :open="accountOpen" :selected="account?.id" :subtitle="store" @select="pickAccount" @close="accountOpen = false" />
    <category-sheet :open="sheetOpen" :category="category.category" :subcategory="category.subcategory" :subtitle="store" @select="pickCategory" @close="sheetOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { computed, ref } from 'vue';
import AccountSheet from '@/components/AccountSheet.vue';
import CategorySheet from '@/components/CategorySheet.vue';
import { type Account, accountFor, accountOf } from '@/domain/accounts';
import { qrDraft } from '@/domain/carga';
import { cfeLabel, formatRut } from '@/domain/cfe';
import { MESES } from '@/domain/dates';
import { formatPesos } from '@/domain/money';
import type { Category } from '@/domain/types';
import { pickImageFile, takePaperPhoto } from '@/services/paperCapture';
import { demoReceiptReader } from '@/services/receiptReader';
import { newDraftId, useCargaStore } from '@/stores/carga';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';

/** back: volver a la cámara · added: agregado a la carga (con lo que se muestra) · split: a la foto para separar productos. */
const emit = defineEmits<{ back: []; added: [text: string]; split: [] }>();

const gastos = useGastosStore();
const finanzas = useFinanzasStore();
const carga = useCargaStore();

const header = computed(() => carga.qr?.header);
const warning = computed(() => carga.qr?.warnings[0]);
const known = computed(() => (header.value ? gastos.storeNameFor(header.value.rut) : undefined));
const store = computed(() => known.value?.name ?? (header.value ? `Comercio RUT ${formatRut(header.value.rut)}` : ''));
const duplicate = computed(() => {
  if (!header.value) return '';
  if (gastos.findByCfe(header.value)) return 'guardado';
  return carga.hasCfe(header.value) ? 'en la carga' : '';
});

const categoryChoice = ref<{ category: Category; subcategory: string }>();
const category = computed(() => categoryChoice.value ?? { category: known.value?.category ?? 'Supermercado', subcategory: 'Almacén' });
/** La cuenta de la última vez en ese comercio; si no, la de débito (o la primera). */
const accountChoice = ref<Account>();
const account = computed(() => {
  if (accountChoice.value) return accountChoice.value;
  const previous = gastos.sorted.find((t) => t.cfe?.rut === header.value?.rut);
  return (previous && accountOf(previous, finanzas.accounts)) ?? accountFor(finanzas.accounts, 'Débito') ?? finanzas.accounts[0];
});
const payment = computed(() => account.value?.payment ?? 'Débito');
const accountOpen = ref(false);
const sheetOpen = ref(false);
const busy = ref(false);

/** '6 oct 2026' */
function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1].slice(0, 3)} ${y}`;
}

function pickCategory(v: { category: Category; subcategory: string }) {
  categoryChoice.value = v;
  sheetOpen.value = false;
}

function pickAccount(a: Account) {
  accountChoice.value = a;
  accountOpen.value = false;
}

/** Separar por productos: una foto del ticket y la pantalla del papel, con el total del QR como control. */
async function split() {
  if (!header.value) return;
  const qr = { header: header.value, store: store.value, payment: payment.value, accountId: account.value?.id, ...category.value };
  if (!Capacitor.isNativePlatform()) {
    const picked = await pickImageFile(true);
    if (!picked) return;
    carga.photo = { ...picked, qr };
    emit('split');
    return;
  }
  busy.value = true;
  try {
    const shot = await takePaperPhoto();
    if (shot === 'cancelled') return;
    carga.photo = { ...shot, qr };
    emit('split');
  } catch (e) {
    console.warn('Foto', e);
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  const h = header.value;
  if (!h || duplicate.value) return;
  busy.value = true;
  try {
    const read = await demoReceiptReader.readLines(h);
    // Sin detalle (una línea por el total): toma el comercio y la categoría elegidos. Con detalle, la categoría tocada a mano va a todas.
    const lines =
      read.lines.length === 1
        ? [{ ...read.lines[0], pretty: store.value, ...category.value }]
        : read.lines.map((l) => (categoryChoice.value ? { ...l, ...categoryChoice.value } : l));
    carga.add([qrDraft(h, { store: store.value, payment: payment.value, accountId: account.value?.id, lines, discounts: read.discounts }, newDraftId())]);
    carga.qr = undefined;
    emit('added', `${store.value} ${formatPesos(h.total)}`);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ticket-qr { min-height: 100%; box-sizing: border-box; gap: 18px; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); background: var(--rb-bg); }
.hero { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 0 8px; }
.hero .store { font-size: 17px; color: var(--rb-muted); text-align: center; }
.hero .total { font-size: 56px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
.hero .read { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--rb-muted); }
.rb-row.big { min-height: 56px; font-size: 17px; width: 100%; }
.rb-wrap .split { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 0 14px; border-radius: 14px; background: #fff; width: 100%; box-sizing: border-box; }
.split .grow { flex-grow: 1; display: flex; flex-direction: column; gap: 2px; font-size: 16px; }
.split .s { font-size: 14px; color: var(--rb-muted); }
.rb-wrap .split:disabled { opacity: 0.5; }
.data { padding: 0 4px; font-size: 14px; color: var(--rb-muted); }
.data summary { min-height: 36px; display: flex; align-items: center; cursor: pointer; }
.data span { display: block; line-height: 1.6; }
.confirm { margin-top: auto; min-height: 54px; font-size: 16px; }
</style>
