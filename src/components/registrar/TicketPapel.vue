<template>
  <div v-if="photo" class="rb-wrap papel">
    <div class="rb-navbar">
      <button type="button" class="rb-navlink" @click="emit('back')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>{{ qr ? 'Ticket' : 'Cámara' }}
      </button>
      <span class="title">{{ qr ? 'Por productos' : 'Ticket en papel' }}</span>
      <button type="button" class="rb-navlink end" :disabled="reading" @click="retake">Repetir</button>
    </div>

    <div class="summary">
      <img v-if="photo.photo" :src="photo.photo" alt="Foto del ticket" class="thumb" />
      <div v-else class="thumb paper" aria-hidden="true"><i class="w70 c" /><i /><i class="w80" /><i /><i class="w50 r" /></div>
      <div class="grow">
        <button v-if="!qr" type="button" class="vendor" :class="{ empty: !vendor }" @click="pickVendor">{{ vendor || '¿De qué puesto es?' }}</button>
        <span v-else class="vendor">{{ qr.store }}</span>
        <span class="s">{{ reading ? readingText : `${shortDay(date)} · ${qr ? 'con QR' : 'sin QR'} · ${plural(rows.length, 'producto', 'productos')}` }}</span>
      </div>
      <span v-if="reading" class="spinner" aria-hidden="true" />
      <span v-else class="total rb-amount">{{ formatPesos(shownTotal) }}</span>
    </div>

    <!-- Una sola alerta: lo que hay que confirmar, o lo que no cierra -->
    <div v-if="alert" class="rb-alert" :class="{ info: alert.info }">
      <svg v-if="!alert.info" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rb-warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
      <span class="grow"><span class="t">{{ alert.title }}</span><span class="s">{{ alert.detail }}</span></span>
    </div>

    <div v-for="g in groups" :key="g.category" class="group">
      <div class="group-head">
        <span class="rb-label" style="padding: 0">{{ g.category }} · {{ formatPesos(g.total) }}</span>
        <button type="button" class="change" @click="changingGroup = g.category">Cambiar</button>
      </div>
      <div class="items">
        <template v-for="r in g.rows" :key="r.key">
          <div v-if="r.doubtful" :id="`papel-row-${r.key}`" class="doubt" :class="{ flash: flashKey === r.key }">
            <div class="line"><span>{{ r.name || 'Sin nombre' }}</span><span class="rb-amount" style="font-weight: 600">¿{{ formatPesos(r.amount) }}?</span></div>
            <div class="doubt-actions">
              <button type="button" class="rb-btn neutral" @click="editRow(r)">Corregir</button>
              <button type="button" class="rb-btn primary" @click="confirmRow(r)">Sí, es {{ formatPesos(r.amount) }}</button>
            </div>
          </div>
          <button v-else type="button" class="item" @click="editRow(r)">
            <span class="name">{{ r.name || 'Sin nombre' }}</span>
            <span class="rb-amount amount">{{ formatPesos(r.amount) }}<svg v-if="confirmed.has(r.key)" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rb-accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg></span>
          </button>
        </template>
      </div>
    </div>

    <button type="button" class="add" :disabled="reading" @click="addRow">+ Agregar producto</button>

    <div class="footer">
      <div v-if="!qr && groups.length > 1" class="seg" role="tablist" aria-label="Cómo agregarlo">
        <button type="button" role="tab" :class="{ on: !byCategory }" :aria-selected="!byCategory" @click="byCategory = false">Un gasto · {{ formatPesos(sum) }}</button>
        <button type="button" role="tab" :class="{ on: byCategory }" :aria-selected="byCategory" @click="byCategory = true">Por categoría · {{ groups.length }}</button>
      </div>
      <button v-if="doubtful.length" type="button" class="rb-btn fix" @click="reviewDoubtful">Revisar {{ plural(doubtful.length, 'importe pendiente', 'importes pendientes') }}</button>
      <button v-else type="button" class="rb-btn primary" :disabled="!drafts.length || reading" @click="addToCart">{{ addLabel }}</button>
    </div>

    <category-sheet
      :open="!!changingGroup"
      :category="changingGroup ?? 'Otros'"
      :subtitle="changingGroup ? `Los productos de ${changingGroup}` : ''"
      @select="pickGroupCategory"
      @close="changingGroup = undefined"
    />
  </div>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { actionSheetController, alertController } from '@ionic/vue';
import { computed, onMounted, ref, watch } from 'vue';
import CategorySheet from '@/components/CategorySheet.vue';
import { DEMO_PAPER } from '@/data/seed';
import { type PaperRow, paperDrafts, paperGroups } from '@/domain/carga';
import { MESES, shortDate, todayIso } from '@/domain/dates';
import { formatPesos, parseAmount, round2 } from '@/domain/money';
import type { ReadItem } from '@/domain/paper';
import { productCategory } from '@/domain/quickEntry';
import { findSimilarTicket, QR_TOLERANCE, ticketTotals } from '@/domain/totals';
import type { Category } from '@/domain/types';
import { applyVendorRules, vendorRulesContext } from '@/domain/vendors';
import { pickImageFile, takePaperPhoto } from '@/services/paperCapture';
import { choosePaperReader, type PaperReaderKind } from '@/services/receiptReader';
import { newDraftId, useCargaStore } from '@/stores/carga';
import { useGastosStore } from '@/stores/gastos';

/** back: volver a la cámara (o al ticket con QR) · added: agregado a la carga, con lo que se muestra. */
const emit = defineEmits<{ back: []; added: [text: string] }>();

const gastos = useGastosStore();
const carga = useCargaStore();

const photo = computed(() => carga.photo);
const qr = computed(() => photo.value?.qr);
const date = computed(() => qr.value?.header.date ?? todayIso());

let nextKey = 0;
const rows = ref<PaperRow[]>([]);
/** Lo que leyó el lector antes de aplicar lo aprendido del puesto. */
const rawItems = ref<ReadItem[]>([]);
/** Lo leído con lo aprendido ya aplicado: contra esto se aprende al confirmar. */
const lastReading = ref<ReadItem[]>([]);
const writtenTotal = ref<number>();
const vendor = ref('');
const reading = ref(false);
const readingText = ref('Leyendo el ticket…');
const readerKind = ref<PaperReaderKind>('manual');
const note = ref<{ title: string; detail: string; info?: boolean }>();
/** La persona ya cambió algo: una lectura nueva no le pisa lo corregido. */
const edited = ref(false);
/** Productos con la categoría elegida a mano: cambiarles el nombre no la recalcula. */
const manualCategory = new Set<number>();
const confirmed = ref(new Set<number>());
const byCategory = ref(true);
const changingGroup = ref<Category>();
const flashKey = ref<number>();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** '6 oct' */
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1].slice(0, 3)}`;

const groups = computed(() => paperGroups(rows.value));
const sum = computed(() => round2(rows.value.reduce((s, r) => s + r.amount, 0)));
const shownTotal = computed(() => (rows.value.length ? sum.value : writtenTotal.value ?? 0));
const doubtful = computed(() => rows.value.filter((r) => r.doubtful));
const rules = computed(() => (vendor.value ? gastos.vendorRules(vendor.value) : undefined));

/** El total contra el que se controla la suma: el del QR o el escrito en el papel. */
const reference = computed(() => qr.value?.header.total ?? writtenTotal.value);
const alert = computed(() => {
  if (reading.value) return undefined;
  const n = doubtful.value.length;
  if (n) return { title: n === 1 ? '1 importe para confirmar' : `${n} importes para confirmar`, detail: 'Revisalo antes de agregar el ticket' };
  const target = reference.value;
  if (target !== undefined && rows.value.length) {
    const diff = round2(sum.value - target);
    if (qr.value && diff < -QR_TOLERANCE) return { title: `Faltan ${formatPesos(-diff)} para el total del QR`, detail: 'Revisá si quedó algún producto sin leer.' };
    if (qr.value && diff > QR_TOLERANCE) return { title: `Los productos suman ${formatPesos(diff)} más que el QR`, detail: 'La diferencia queda como descuento del ticket (Ley 19.210, banco o comercio).', info: true };
    if (!qr.value && Math.abs(diff) > QR_TOLERANCE) return { title: `Los productos suman ${formatPesos(sum.value)}`, detail: `El papel dice ${formatPesos(target)}. Revisá si falta alguno.` };
  }
  return note.value;
});

const drafts = computed(() =>
  photo.value
    ? paperDrafts({
        store: qr.value?.store ?? vendor.value,
        date: date.value,
        payment: qr.value?.payment ?? 'Efectivo',
        accountId: qr.value?.accountId,
        rows: rows.value,
        writtenTotal: writtenTotal.value,
        photoUri: photo.value.photo || undefined,
        qr: qr.value?.header,
        byCategory: byCategory.value,
        newId: newDraftId,
      })
    : [],
);
const addLabel = computed(() => {
  const d = drafts.value;
  if (d.length > 1) return `Sumar ${d.length} gastos a la carga`;
  return `Sumar a la carga · ${formatPesos(d.length ? ticketTotals(d[0].ticket).net : 0)}`;
});

/** Sin categoría propia (pilas, cargador), un producto de un ticket con QR toma la del comercio. */
function categorize(name: string): { category: Category; subcategory: string } {
  const c = productCategory(name);
  if (c.category === 'Otros' && qr.value) return { category: qr.value.category, subcategory: qr.value.subcategory };
  return c;
}

/** Arma los productos con lo leído, aplicando lo aprendido del puesto elegido. */
function applyReading() {
  const { items } = applyVendorRules(rules.value, rawItems.value);
  lastReading.value = items;
  rows.value = items.map((i) => ({ key: nextKey++, name: i.name, written: i.written, amount: i.amount, ...categorize(i.name), ...(i.doubtful ? { doubtful: true } : {}) }));
  manualCategory.clear();
  confirmed.value = new Set();
}

/** Por qué no se leyó con IA, cuando la persona lo puede arreglar. */
const STATUS_HINT: Record<string, string> = {
  appleIntelligenceNotEnabled: 'Activá Apple Intelligence en Ajustes y Rumbo va a leer el papel con IA.',
  modelNotReady: 'Apple Intelligence se está terminando de descargar. En un rato Rumbo va a leer el papel con IA.',
  DOWNLOADABLE: 'Este teléfono está bajando Gemini Nano. Cuando termine, Rumbo va a leer el papel con IA.',
  DOWNLOADING: 'Este teléfono está bajando Gemini Nano. Cuando termine, Rumbo va a leer el papel con IA.',
};

/** Lee la foto con el lector del teléfono. Lo leído solo precarga: la persona revisa antes de agregar. */
async function read() {
  const p = photo.value;
  if (!p) return;
  rows.value = [];
  rawItems.value = [];
  writtenTotal.value = undefined;
  note.value = undefined;
  edited.value = false;
  if (p.demo) {
    vendor.value = DEMO_PAPER.store;
    rawItems.value = DEMO_PAPER.items.map((i) => ({ ...i }));
    writtenTotal.value = DEMO_PAPER.writtenTotal;
    applyReading();
    return;
  }
  const { reader, kind, status } = await choosePaperReader();
  readerKind.value = kind;
  if (kind === 'manual') {
    note.value = { title: 'Cargá los productos mirando la foto', detail: 'En este equipo no se lee automáticamente. Con el total solo también sirve.', info: true };
    return;
  }
  const hint = kind === 'ocr' && STATUS_HINT[status] ? ` ${STATUS_HINT[status]}` : '';
  readingText.value = rules.value ? `Leyendo con lo aprendido de «${rules.value.name}»…` : 'Leyendo el ticket…';
  reading.value = true;
  try {
    // El comercio que devuelva el modelo no se usa: el puesto lo elige la persona,
    // y un nombre inventado crearía un puesto falso con reglas mal aprendidas.
    const r = await reader.read(p.photo, { rules: vendorRulesContext(rules.value), path: p.path });
    rawItems.value = r.items;
    writtenTotal.value = r.writtenTotal;
    applyReading();
    if (!r.items.length) note.value = { title: 'No se leyeron productos', detail: `Agregalos mirando la foto.${hint}`, info: true };
    else if (hint) note.value = { title: 'Leído sin IA', detail: hint.trim(), info: true };
  } catch {
    note.value = { title: 'No pudimos leer la foto', detail: `Agregá los productos mirándola.${hint}` };
  } finally {
    reading.value = false;
  }
}

async function pickVendor() {
  const known = gastos.knownVendors.slice(0, 6);
  const sheet = await actionSheetController.create({
    header: '¿De qué puesto o comercio es?',
    subHeader: 'Rumbo aprende de lo que corregís para leer mejor el próximo ticket de ese puesto.',
    buttons: [
      ...known.map((v) => ({ text: v.name, handler: () => void setVendor(v.name) })),
      { text: known.length ? 'Otro…' : 'Escribir el nombre…', handler: () => void askVendor() },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function askVendor() {
  const a = await alertController.create({
    header: 'Puesto o comercio',
    inputs: [{ name: 'name', type: 'text', value: vendor.value, placeholder: 'Puesto de Mario, feria de Tristán Narvaja' }],
    buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Listo', role: 'confirm' }],
  });
  await a.present();
  const { role, data } = await a.onDidDismiss<{ values: { name: string } }>();
  if (role === 'confirm' && data?.values.name.trim()) await setVendor(data.values.name.trim());
}

/** Con un puesto conocido y nada corregido todavía, se vuelve a leer (con IA) o se aplica lo aprendido. */
async function setVendor(name: string) {
  vendor.value = name;
  if (!rules.value || edited.value || !rawItems.value.length) return;
  if (readerKind.value === 'ia' && !photo.value?.demo) await read();
  else applyReading();
}

function confirmRow(r: PaperRow) {
  r.doubtful = false;
  confirmed.value = new Set([...confirmed.value, r.key]);
  edited.value = true;
}

async function askRow(header: string, row?: PaperRow): Promise<{ name: string; amount: number } | 'remove' | undefined> {
  const a = await alertController.create({
    header,
    inputs: [
      { name: 'name', type: 'text', value: row?.name ?? '', placeholder: 'Producto' },
      { name: 'amount', type: 'text', value: row ? String(row.amount).replace('.', ',') : '', placeholder: '$ 0', attributes: { inputmode: 'decimal' } },
    ],
    buttons: [
      ...(row ? [{ text: 'Quitar', role: 'destructive' }] : []),
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Listo', role: 'confirm' },
    ],
  });
  await a.present();
  const { role, data } = await a.onDidDismiss<{ values: { name: string; amount: string } }>();
  if (role === 'destructive') return 'remove';
  const amount = parseAmount(data?.values.amount ?? '');
  if (role !== 'confirm' || !(amount > 0)) return undefined;
  return { name: data?.values.name.trim() ?? '', amount };
}

async function editRow(r: PaperRow) {
  const out = await askRow('Corregir producto', r);
  if (!out) return;
  edited.value = true;
  if (out === 'remove') {
    rows.value = rows.value.filter((x) => x.key !== r.key);
    return;
  }
  const renamed = out.name !== r.name;
  Object.assign(r, out, { doubtful: false }, renamed && !manualCategory.has(r.key) ? categorize(out.name) : {});
  confirmed.value = new Set([...confirmed.value, r.key]);
}

async function addRow() {
  const out = await askRow('Agregar producto');
  if (!out || out === 'remove') return;
  edited.value = true;
  rows.value.push({ key: nextKey++, ...out, ...categorize(out.name) });
}

function pickGroupCategory(v: { category: Category; subcategory: string }) {
  const from = changingGroup.value;
  changingGroup.value = undefined;
  edited.value = true;
  for (const r of rows.value) {
    if (r.category !== from) continue;
    Object.assign(r, v);
    manualCategory.add(r.key);
  }
}

/** "Revisar 1 importe pendiente": lleva al importe dudoso y lo resalta. */
function reviewDoubtful() {
  const first = doubtful.value[0];
  if (!first) return;
  document.getElementById(`papel-row-${first.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flashKey.value = first.key;
  setTimeout(() => (flashKey.value = undefined), 700);
}

async function retake() {
  const qrContext = qr.value;
  if (!Capacitor.isNativePlatform()) {
    const picked = await pickImageFile(true);
    if (picked) carga.photo = { ...picked, qr: qrContext };
    return;
  }
  try {
    const shot = await takePaperPhoto();
    if (shot !== 'cancelled') carga.photo = { ...shot, qr: qrContext };
  } catch (e) {
    console.warn('Foto', e);
  }
}

async function confirmSimilar(amount: number): Promise<boolean> {
  const similar = findSimilarTicket(gastos.tickets, { date: date.value, amount });
  if (!similar) return true;
  const a = await alertController.create({
    header: '¿Ya lo registraste?',
    message: `El ${shortDate(similar.date)} ya tenés «${similar.store}» por ${formatPesos(amount)}.`,
    buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Agregar igual', role: 'confirm' }],
  });
  await a.present();
  return (await a.onDidDismiss()).role === 'confirm';
}

async function addToCart() {
  const d = drafts.value;
  if (!d.length || doubtful.value.length) return;
  const amount = round2(d.reduce((s, x) => s + ticketTotals(x.ticket).net, 0));
  if (!qr.value && !(await confirmSimilar(amount))) return;
  // Lo que la persona confirmó es la "clave" para leer el próximo ticket de este puesto
  if (vendor.value && !qr.value) await gastos.learnVendor(vendor.value, lastReading.value, rows.value.map((r) => ({ name: r.name, amount: r.amount })));
  carga.add(d);
  const store = qr.value?.store ?? (vendor.value || 'Ticket en papel');
  if (qr.value) carga.qr = undefined;
  carga.photo = undefined;
  emit('added', `${store} ${formatPesos(amount)}`);
}

watch(photo, (p, before) => {
  if (p && p !== before) void read();
});
onMounted(() => void read());
</script>

<style scoped>
.papel { min-height: 100%; box-sizing: border-box; gap: 14px; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); background: var(--rb-bg); }
.summary { display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 14px; background: #fff; }
.thumb { width: 48px; height: 64px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: #ede9e2; }
.thumb.paper { padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; }
.thumb.paper i { display: block; height: 2px; background: #cfc9bf; }
.thumb.paper i.c { height: 3px; background: #b8b2a8; align-self: center; margin-bottom: 4px; }
.thumb.paper i.r { height: 3px; background: #b8b2a8; align-self: flex-end; margin-top: auto; }
.w50 { width: 50%; } .w70 { width: 70%; } .w80 { width: 80%; }
.summary .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.rb-wrap .vendor { font-size: 16px; font-weight: 500; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-wrap .vendor.empty { color: var(--rb-accent); }
.summary .s { font-size: 14px; color: var(--rb-muted); }
.summary .total { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
.rb-alert.info { background: #fff; }
.rb-alert.info .s { color: var(--rb-muted); }
.group { display: flex; flex-direction: column; gap: 6px; }
.group-head { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
.rb-wrap .change { min-height: 44px; color: var(--rb-accent); font-size: 15px; }
.items { border-radius: 14px; background: #fff; padding: 0 14px; overflow: hidden; }
.rb-wrap .item { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-height: 50px; border-bottom: 1px solid var(--rb-line); font-size: 16px; }
.items > :last-child { border-bottom: 0; }
.item .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .amount { display: flex; align-items: center; gap: 6px; }
.doubt { display: flex; flex-direction: column; gap: 10px; margin: 0 -14px; padding: 12px 14px; background: var(--rb-attention); border-bottom: 1px solid var(--rb-line); transition: background 0.2s; }
.doubt.flash { background: #ffe3bf; }
.doubt .line { display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
.doubt-actions { display: grid; grid-template-columns: 1fr 1.3fr; gap: 8px; }
.doubt-actions .rb-btn { min-height: 44px; border-radius: 12px; font-size: 15px; }
.rb-wrap .add { min-height: 48px; border-radius: 14px; background: #fff; color: var(--rb-accent); font-size: 15px; font-weight: 500; text-align: center; }
.footer { margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--rb-line); }
.seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 3px; border-radius: 10px; background: var(--rb-segment); }
.rb-wrap .seg button { height: 42px; border-radius: 8px; font-size: 15px; text-align: center; }
.rb-wrap .seg button.on { background: #fff; font-weight: 600; }
.footer .rb-btn { min-height: 54px; font-size: 16px; }
.spinner { width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid var(--rb-line); border-top-color: var(--rb-accent); animation: spin 0.8s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
