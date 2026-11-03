<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap editar">
        <div class="rb-navbar">
          <button type="button" class="rb-navlink" @click="goBack">Cancelar</button>
          <span class="title">{{ kind === 'ingreso' ? 'Editar ingreso' : 'Editar gasto' }}</span>
          <span />
        </div>

        <template v-if="ticket">
          <div class="seg" role="tablist" aria-label="Tipo de movimiento">
            <button type="button" role="tab" :class="{ on: kind === 'gasto' }" :aria-selected="kind === 'gasto'" @click="kind = 'gasto'">Gasto</button>
            <button type="button" role="tab" :class="{ on: kind === 'ingreso' }" :aria-selected="kind === 'ingreso'" @click="kind = 'ingreso'">Ingreso</button>
          </div>

          <!-- Una sola alerta: lo que no deja subir el gasto, o una suma que no cierra -->
          <div v-if="ticket.review" class="rb-alert">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rb-warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
            <span class="grow"><span class="t">{{ ticket.review }}</span><span class="s">Escribí el monto y guardá: recién ahí se sube a tu cuenta.</span></span>
          </div>
          <div v-else-if="check.status === 'mismatch'" class="rb-alert">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rb-warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
            <span class="grow"><span class="t">La suma no da el total {{ totalRef }}</span><span class="s">Difiere {{ formatPesos(Math.abs(check.diff)) }}. Revisá los productos.</span></span>
          </div>

          <div class="amount-line">
            <button v-if="single" type="button" class="cur" aria-label="Cambiar moneda" @click="currency = currency === 'UYU' ? 'USD' : 'UYU'">{{ currency === 'USD' ? 'USD' : '$' }}</button>
            <template v-if="single">
              <label class="sr" for="gasto-monto">Monto</label>
              <input id="gasto-monto" ref="amountInput" v-model="amountText" class="amount" :class="{ income: kind === 'ingreso' }" inputmode="decimal" placeholder="0" autocomplete="off" :style="{ width: `${Math.max(2, amountText.length + 0.5)}ch` }" />
            </template>
            <span v-else class="amount fixed" :class="{ income: kind === 'ingreso' }">{{ formatPesos(totals.net) }}</span>
          </div>
          <span v-if="single && currency === 'USD'" class="rb-small center">{{ formatPesos(round2((parseAmount(amountText) || 0) * rate)) }} en el presupuesto, a $ {{ String(rate).replace('.', ',') }} por dólar</span>

          <div class="rb-group">
            <label class="rb-row">
              <span class="grow">Descripción</span>
              <input v-model="store" class="rb-inline-input wide" aria-label="Descripción" />
            </label>
            <button v-if="single && kind === 'gasto'" type="button" class="rb-row" @click="editing = 0">
              <span class="grow">Categoría</span>
              <span class="value">{{ categoryLabel(category.category, category.subcategory) }}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></span>
            </button>
            <button type="button" class="rb-row" @click="accountOpen = true">
              <span class="grow">{{ kind === 'ingreso' ? 'A qué cuenta entró' : 'Cuenta' }}</span>
              <span class="value">{{ account?.name ?? payment }}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></span>
            </button>
            <label class="rb-row date">
              <span class="grow">Fecha</span>
              <span class="value">{{ dateLabel }}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></span>
              <input v-model="date" type="date" :max="todayIso()" aria-label="Fecha" />
            </label>
          </div>

          <!-- Ticket con productos: agrupados por subcategoría, tocando uno se le cambia la categoría -->
          <template v-if="!single">
            <div v-for="g in groups" :key="g.name" class="rb-section">
              <span class="rb-label">{{ g.name }} · {{ formatPesos(g.amount) }}</span>
              <div class="rb-group">
                <button v-for="l in g.lines" :key="l.index" type="button" class="rb-row" @click="editing = l.index">
                  <span class="grow"><span>{{ l.line.pretty }}</span><span v-if="l.line.category !== 'Supermercado' || ticket.source === 'papel'" class="sub">{{ l.line.category }}</span></span>
                  <span class="rb-muted rb-amount">{{ formatPesos(l.line.amount) }}</span>
                </button>
              </div>
            </div>
            <div v-if="ticket.discounts.length" class="rb-group">
              <div v-for="(d, i) in ticket.discounts" :key="i" class="rb-row"><span class="grow">{{ d.label }}</span><span class="rb-good rb-amount">{{ formatPesos(-d.amount) }}</span></div>
            </div>
          </template>

          <div class="rb-group">
            <label class="rb-row">
              <span class="grow">Nota</span>
              <input v-model="note" class="rb-inline-input wide" placeholder="Opcional" aria-label="Nota" />
            </label>
            <button type="button" class="rb-row" @click="photoAction">
              <span class="grow">Comprobante</span>
              <span class="link">{{ photo ? (photoOpen ? 'Ocultar foto' : 'Ver foto') : 'Agregar foto' }}</span>
            </button>
            <a v-if="ticket.cfe" class="rb-row" :href="ticket.cfe.url" target="_blank" rel="noopener"><span class="grow">Ver en la DGI</span><span class="value">{{ cfeLabel(ticket.cfe) }}</span></a>
          </div>
          <button v-if="photo && photoOpen" type="button" class="photo" aria-label="Cambiar la foto" @click="takePhoto">
            <img :src="photo" alt="Foto del comprobante" />
            <span class="photo-hint">Tocá para cambiarla</span>
          </button>

          <div class="status">
            <sync-icon :state="syncState" />
            <span>{{ statusText }}</span>
          </div>
          <span v-if="fixedIds.has(ticket.id)" class="rb-note">Es el pago de una factura: se ve entre tus gastos pero no sale del presupuesto del día a día.</span>

          <div class="actions">
            <button type="button" class="rb-btn primary" :disabled="!canSave" @click="save">Guardar cambios</button>
            <button type="button" class="delete" @click="confirmDelete">{{ kind === 'ingreso' ? 'Eliminar ingreso' : 'Eliminar gasto' }}</button>
          </div>
        </template>

        <div v-else class="rb-empty"><span class="t">No encontramos ese movimiento</span></div>
      </div>
      <account-sheet
        :open="accountOpen"
        :selected="account?.id"
        :title="kind === 'ingreso' ? 'A qué cuenta entró' : 'Cuenta'"
        :subtitle="store"
        @select="pickAccount"
        @close="accountOpen = false"
      />
      <category-sheet
        :open="editing !== null"
        :category="editingLine?.category ?? 'Otros'"
        :subcategory="editingLine?.subcategory"
        :subtitle="single ? store : editingPretty"
        @select="applyCategory"
        @close="editing = null"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { alertController, IonContent, IonPage, useIonRouter } from '@ionic/vue';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import AccountSheet from '@/components/AccountSheet.vue';
import CategorySheet from '@/components/CategorySheet.vue';
import SyncIcon from '@/components/SyncIcon.vue';
import { useFixedCostIds } from '@/composables/fixedCosts';
import { type Account, accountOf } from '@/domain/accounts';
import { categoryLabel } from '@/domain/categories';
import { cfeLabel } from '@/domain/cfe';
import { MESES, timeOf, todayIso } from '@/domain/dates';
import { formatPesos, parseAmount, round2, USD_RATE } from '@/domain/money';
import { parseQuickEntry } from '@/domain/quickEntry';
import { checkAgainstQr, checkAgainstWrittenTotal, ticketTotals } from '@/domain/totals';
import type { Category, Line, PaymentMethod, TicketSource } from '@/domain/types';
import { pickImageFile, takePaperPhoto } from '@/services/paperCapture';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';
import { useSyncStore } from '@/stores/sync';

const props = defineProps<{ id: string }>();
const router = useIonRouter();
const fixedIds = useFixedCostIds();
const gastos = useGastosStore();
const finanzas = useFinanzasStore();
const sync = useSyncStore();

const ticket = computed(() => gastos.byId(props.id));
/** Un gasto de una línea (o sin líneas, esperando el monto): el monto se edita acá. Con productos, es la suma. */
const single = computed(() => (ticket.value?.lines.length ?? 0) <= 1);

// Lo que se edita: se aplica todo junto con "Guardar cambios"
const kind = ref<'gasto' | 'ingreso'>('gasto');
const amountText = ref('');
const currency = ref<'UYU' | 'USD'>('UYU');
const store = ref('');
const category = ref<{ category: Category; subcategory: string }>({ category: 'Otros', subcategory: 'Varios' });
const payment = ref<PaymentMethod>('Efectivo');
const accountId = ref<string>();
const account = computed(() => finanzas.accounts.find((a) => a.id === accountId.value));
const accountOpen = ref(false);
const date = ref(todayIso());
const note = ref('');
const photo = ref<string>();
const lines = ref<Line[]>([]);
const amountInput = ref<HTMLInputElement>();
const rate = computed(() => ticket.value?.usd?.rate ?? USD_RATE);
const totals = computed(() => (ticket.value ? ticketTotals({ ...ticket.value, lines: lines.value }) : { gross: 0, discounts: 0, net: 0 }));

const toInput = (n: number) => String(round2(n)).replace('.', ',');

/** Carga el formulario con lo guardado. */
function load() {
  const t = ticket.value;
  if (!t) return;
  kind.value = t.kind ?? 'gasto';
  currency.value = t.usd ? 'USD' : 'UYU';
  const net = ticketTotals(t).net;
  amountText.value = t.usd ? toInput(t.usd.amount) : net ? toInput(net) : '';
  store.value = t.store;
  // Sin líneas no hay categoría: se deduce del comercio ("Farmacia" → Salud · Farmacia)
  const base = t.lines[0] ?? parseQuickEntry(t.store);
  category.value = { category: base.category, subcategory: base.subcategory };
  payment.value = t.payment;
  accountId.value = accountOf(t, finanzas.accounts)?.id;
  date.value = t.date;
  note.value = t.note ?? '';
  photo.value = t.photoUri;
  lines.value = t.lines.map((l) => ({ ...l }));
}
watch(() => props.id, load);
onMounted(async () => {
  load();
  if (ticket.value?.review) {
    await nextTick();
    amountInput.value?.focus();
  }
});

const amount = computed(() => parseAmount(amountText.value));
const dirty = computed(() => {
  const t = ticket.value;
  if (!t) return false;
  const base = t.lines[0];
  const changedSingle =
    single.value &&
    (currency.value !== (t.usd ? 'USD' : 'UYU') ||
      amount.value !== (t.usd ? t.usd.amount : ticketTotals(t).net) ||
      category.value.category !== base?.category ||
      category.value.subcategory !== base?.subcategory);
  const changedLines = !single.value && lines.value.some((l, i) => l.category !== t.lines[i]?.category || l.subcategory !== t.lines[i]?.subcategory);
  return (
    kind.value !== (t.kind ?? 'gasto') ||
    store.value.trim() !== t.store ||
    payment.value !== t.payment ||
    accountId.value !== accountOf(t, finanzas.accounts)?.id ||
    date.value !== t.date ||
    note.value.trim() !== (t.note ?? '') ||
    photo.value !== t.photoUri ||
    changedSingle ||
    changedLines
  );
});
const canSave = computed(() => dirty.value && !!store.value.trim() && (!single.value || amount.value > 0));

/** '6 oct, 11:20' */
const dateLabel = computed(() => {
  const d = date.value;
  const day = `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
  return ticket.value && d === ticket.value.date ? `${day}, ${timeOf(ticket.value.createdAt)}` : day;
});

/** Con QR se controla contra el total de la DGI; en un ticket de papel, contra el total escrito. */
const check = computed(() => {
  const t = ticket.value;
  if (!t || t.lines.length < 2) return { status: 'no-qr' } as const;
  return t.cfe ? checkAgainstQr(t) : checkAgainstWrittenTotal(t);
});
const totalRef = computed(() => (ticket.value?.cfe ? 'del QR' : 'escrito en el papel'));

const groups = computed(() => {
  const map = new Map<string, { name: string; amount: number; lines: { index: number; line: Line }[] }>();
  lines.value.forEach((line, index) => {
    const g = map.get(line.subcategory) ?? { name: line.subcategory, amount: 0, lines: [] };
    g.amount = round2(g.amount + line.amount);
    g.lines.push({ index, line });
    map.set(line.subcategory, g);
  });
  return [...map.values()];
});

const ORIGIN: Record<TicketSource, string> = {
  voz: 'por voz',
  texto: 'con el teclado',
  qr: 'con el QR de la DGI',
  papel: 'con una foto',
  whatsapp: 'por WhatsApp',
};
const syncState = computed(() => {
  const t = ticket.value;
  if (!t) return 'telefono' as const;
  if (t.review) return 'revisar' as const;
  if (t.sync.state === 'subido') return 'sincronizado' as const;
  return sync.online && sync.syncing ? ('subiendo' as const) : ('telefono' as const);
});
/** "Registrado por voz · se sube al volver la conexión" */
const statusText = computed(() => {
  const t = ticket.value;
  if (!t) return '';
  let state = sync.online ? 'se sube enseguida' : 'se sube al volver la conexión';
  if (t.review) state = 'no se sube hasta que lo corrijas';
  else if (t.sync.state === 'subido') state = t.cfe ? 'sincronizado y validado con la DGI' : 'sincronizado';
  return `Registrado ${t.billId ? 'desde Facturas' : ORIGIN[t.source]} · ${state}`;
});

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/tabs/movimientos', 'back', 'replace');
}

/** Línea que se está recategorizando (en un gasto de una línea, la categoría del formulario); null con la hoja cerrada. */
const editing = ref<number | null>(null);
const editingLine = computed(() => (editing.value === null ? undefined : single.value ? category.value : lines.value[editing.value]));
const editingPretty = computed(() => (editing.value === null ? undefined : lines.value[editing.value]?.pretty));

function applyCategory(value: { category: Category; subcategory: string }) {
  const index = editing.value;
  editing.value = null;
  if (index === null) return;
  if (single.value) category.value = value;
  else lines.value[index] = { ...lines.value[index], ...value };
}

function pickAccount(a: Account) {
  accountId.value = a.id;
  payment.value = a.payment;
  accountOpen.value = false;
}

const photoOpen = ref(false);

async function takePhoto() {
  if (!Capacitor.isNativePlatform()) {
    // En el navegador el selector se abre en el mismo toque
    const picked = await pickImageFile(true);
    if (picked) photo.value = picked.photo;
    return;
  }
  try {
    const shot = await takePaperPhoto();
    if (shot !== 'cancelled') photo.value = shot.photo;
  } catch (e) {
    console.warn('Foto', e);
  }
}

function photoAction() {
  if (photo.value) photoOpen.value = !photoOpen.value;
  else void takePhoto();
}

async function save() {
  const t = ticket.value;
  if (!t || !canSave.value) return;
  await gastos.edit(t.id, {
    store: store.value,
    date: date.value,
    payment: payment.value,
    accountId: accountId.value,
    kind: kind.value === 'ingreso' ? 'ingreso' : undefined,
    note: note.value,
    photoUri: photo.value,
    ...(single.value ? { amount: amount.value, currency: currency.value, ...category.value } : { lines: lines.value }),
  });
  goBack();
}

async function confirmDelete() {
  const t = ticket.value;
  if (!t) return;
  const what = kind.value === 'ingreso' ? 'ingreso' : 'gasto';
  const alert = await alertController.create({
    header: `¿Eliminar este ${what}?`,
    message: `${t.store}, ${formatPesos(ticketTotals(t).net)}. Se borra de este teléfono${t.sync.state === 'subido' ? ' y de tu cuenta del bot' : ''}.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar',
        role: 'destructive',
        handler: async () => {
          await gastos.remove(t.id);
          goBack();
        },
      },
    ],
  });
  await alert.present();
}
</script>

<style scoped>
.editar { gap: 16px; min-height: 100%; box-sizing: border-box; padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 18px); }
.seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 3px; border-radius: 10px; background: var(--rb-segment); }
.rb-wrap .seg button { height: 40px; border-radius: 8px; font-size: 15px; text-align: center; }
.rb-wrap .seg button.on { background: #fff; font-weight: 600; }
.amount-line { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 0; }
.rb-wrap .cur { height: 36px; padding: 0 12px; border-radius: 999px; background: var(--rb-segment); font-size: 15px; font-weight: 600; }
.amount { min-width: 2ch; max-width: 260px; border: 0; background: transparent; color: var(--rb-ink); font-size: 48px; font-weight: 600; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; outline: none; padding: 0; }
.amount::placeholder { color: var(--rb-chevron); }
.amount.fixed { line-height: 1.1; }
.amount.income { color: var(--rb-accent); }
.center { text-align: center; margin-top: -10px; }
.wide { flex: 1; min-width: 0; color: var(--rb-ink); }
.rb-row.date { position: relative; cursor: pointer; }
.rb-row.date input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.link { color: var(--rb-accent); }
.rb-wrap .photo { position: relative; display: block; width: 100%; border-radius: 14px; overflow: hidden; background: var(--rb-line); }
.photo img { display: block; width: 100%; height: auto; }
.photo-hint { position: absolute; right: 10px; bottom: 10px; background: rgba(17, 17, 17, 0.8); color: #fff; font-size: 12px; font-weight: 500; padding: 6px 10px; border-radius: 999px; }
.status { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 14px; color: var(--rb-muted); }
.actions { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
.actions .rb-btn { min-height: 54px; font-size: 16px; }
.rb-wrap .delete { height: 44px; color: var(--rb-danger); font-size: 16px; font-weight: 500; text-align: center; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
