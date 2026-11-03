<template>
  <ion-content class="rb-page">
    <div class="rb-wrap voz">
      <div class="rb-navbar">
        <button type="button" class="rb-navlink" @click="toKeypad">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Teclado
        </button>
        <span class="title">Por voz</span>
        <span />
      </div>

      <div class="steps" role="status" :aria-label="stepsLabel">
        <template v-for="(s, i) in steps" :key="s.done">
          <span v-if="i" class="sep" />
          <span v-if="i + 1 === step" class="current"><span class="rb-dot" />{{ s.now }}</span>
          <span v-else class="step" :class="{ done: i + 1 < step }">
            <svg v-if="i + 1 < step" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--rb-accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>{{ s.done }}
          </span>
        </template>
      </div>

      <span class="said" :class="{ hint: !shownPhrase }">{{ shownPhrase ? `"${shownPhrase}"` : listening ? (ready ? 'Te escucho…' : 'Preparando el micrófono…') : 'Decí uno o varios gastos: "un café de 120, almuerzo 390 con débito y 52 de ómnibus"' }}</span>

      <div v-if="fresh.length" class="news">
        <div class="news-head"><span class="label">Nuevos · {{ fresh.length }}</span><span class="rb-muted rb-amount">{{ cartTotal(fresh) }}</span></div>
        <div class="news-list">
          <div v-for="d in fresh" :key="d.id" class="news-row">
            <button type="button" class="grow" @click="editDraft(d)">
              <span class="t">{{ d.title }}</span>
              <span class="s">{{ draftSubtitle(d, finanzas.accounts) }}</span>
            </button>
            <span class="amt rb-amount">{{ draftAmountText(d) }}</span>
            <button type="button" class="x" :aria-label="`Quitar ${d.title}`" @click="removeFresh(d.id)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Una sola alerta: lo que pide una decisión -->
      <div v-if="alert" class="rb-attention-card">
        <div class="grow"><span class="t">{{ alert.title }}</span><span class="s">{{ alert.detail }}</span></div>
        <button v-if="alert.action" type="button" class="white-btn" @click="alert.action.run">{{ alert.action.label }}</button>
      </div>

      <div v-if="carga.items.length" class="already">
        <span class="grow">Ya en la carga: {{ carga.items.map((d) => d.title).join(', ') }}</span>
        <span class="rb-amount">{{ carga.total }}</span>
      </div>

      <div class="mic">
        <button
          v-if="status?.available"
          type="button"
          class="mic-btn"
          :class="{ on: listening }"
          :aria-label="listening ? 'Terminar de dictar' : 'Dictar gastos'"
          :aria-pressed="listening"
          @pointerdown.prevent="pressMic"
          @pointerup="releaseMic"
          @pointerleave="cancelHold"
          @pointercancel="cancelHold"
          @keydown.enter.prevent="toggleMic"
          @keydown.space.prevent="toggleMic"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          {{ micLabel }}
        </button>
        <span v-if="status?.available && statusNote" class="note">{{ statusNote }}</span>
      </div>

      <div class="actions">
        <button type="button" class="rb-btn secondary" @click="toKeypad">Seguir en teclado</button>
        <button type="button" class="rb-btn primary" :disabled="!total.length || listening" @click="saveAll">{{ total.length ? `Guardar ${total.length} · ${cartTotal(total)}` : 'Guardar' }}</button>
      </div>
    </div>

    <category-sheet
      :open="!!editingCategory"
      :category="editingCategory?.ticket.lines[0]?.category ?? 'Otros'"
      :subcategory="editingCategory?.ticket.lines[0]?.subcategory"
      :subtitle="editingCategory?.title"
      @select="pickCategory"
      @close="editingCategory = undefined"
    />
  </ion-content>
</template>

<script setup lang="ts">
import { actionSheetController, alertController, IonContent } from '@ionic/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CategorySheet from '@/components/CategorySheet.vue';
import { lastAccountId } from '@/domain/accounts';
import { cartTotal, type Draft, draftAmountText, draftSubtitle, phraseDrafts, splitDuplicates, splitPurchase } from '@/domain/carga';
import { todayIso } from '@/domain/dates';
import { formatPesos, parseAmount } from '@/domain/money';
import { parseQuickEntries } from '@/domain/quickEntry';
import type { Category, PaymentMethod } from '@/domain/types';
import { type Listening, speechStatus, type SpeechStatus, startListening } from '@/services/speech';
import { newDraftId, useCargaStore } from '@/stores/carga';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';

const props = defineProps<{ autoListen?: boolean }>();
/** keypad: volver al teclado con lo dictado en la carga · save: guardar toda la carga. */
const emit = defineEmits<{ keypad: []; save: [] }>();

const gastos = useGastosStore();
const finanzas = useFinanzasStore();
const carga = useCargaStore();

/** Lo dictado en esta pantalla, que pasa a la carga al volver al teclado o al guardar. */
const fresh = ref<Draft[]>([]);
/** Lo de la última frase que ya estaba en la carga: no se agrega sin preguntar. */
const duplicates = ref<Draft[]>([]);
const notUnderstood = ref('');
const phrase = ref('');
const partial = ref('');
const total = computed(() => [...carga.items, ...fresh.value]);

const status = ref<SpeechStatus>();
const listening = ref(false);
const ready = ref(false);
/** Con el dedo apretado: al soltar termina. Con un toque corto queda escuchando hasta otro toque. */
const holding = ref(false);
const dictationError = ref('');
let session: Promise<Listening | undefined> | undefined;
/** Cada dictado tiene su número: el final de uno viejo no se procesa dos veces. */
let round = 0;
let handledRound = 0;
let pressedAt = 0;

const shownPhrase = computed(() => (listening.value ? partial.value : phrase.value));
const step = computed(() => (listening.value || (!fresh.value.length && !duplicates.value.length) ? 1 : 3));
const steps = computed(() => [
  { done: 'Escuché', now: listening.value ? 'Escuchando' : 'Hablá' },
  { done: 'Entendí', now: 'Entendiendo' },
  { done: 'Confirmá', now: 'Confirmá' },
]);
const stepsLabel = computed(() => (step.value === 1 ? 'Paso 1 de 3: escuchar' : 'Paso 3 de 3: listo para confirmar'));
const micLabel = computed(() => {
  if (listening.value) return holding.value ? 'Soltá para terminar' : 'Tocá para terminar';
  return fresh.value.length ? 'Mantené para sumar más' : 'Tocá o mantené para hablar';
});
const statusNote = computed(() => {
  const s = status.value;
  if (!s || s.offline) return '';
  if (s.downloading) return 'Bajando el español para dictar sin conexión. Mientras tanto, dictar necesita señal.';
  return 'Para dictar sin señal, descargá el español en los ajustes de dictado del teléfono.';
});

/** El medio de pago si no se dice: el de la cuenta del último gasto. */
const lastPayment = (): PaymentMethod => finanzas.accounts.find((a) => a.id === lastAccountId(gastos.tickets, finanzas.accounts))?.payment ?? 'Efectivo';

/** La alerta de la pantalla: un duplicado, una frase sin montos, un error del micrófono o un teléfono que no dicta. */
const alert = computed((): { title: string; detail: string; action?: { label: string; run: () => void } } | undefined => {
  const dups = duplicates.value;
  if (dups.length) {
    const one = dups.length === 1;
    const transport = dups.every((d) => d.ticket.lines[0]?.category === 'Transporte');
    return {
      title: `${dups.map((d) => `${d.title} ${draftAmountText(d)}`).join(', ')}: ¿${one ? 'duplicado' : 'duplicados'}?`,
      detail: one ? 'Ya está en la carga. No lo agregué.' : 'Ya están en la carga. No los agregué.',
      action: { label: one ? (transport ? 'Es otro viaje, agregarlo' : 'Es otro, agregarlo') : 'Son otros, agregarlos', run: addDuplicates },
    };
  }
  if (dictationError.value) return { title: 'No se pudo dictar', detail: dictationError.value };
  if (notUnderstood.value) return { title: 'No encontré ningún monto', detail: `Probá de nuevo diciendo cuánto, por ejemplo "450 en la feria".` };
  if (status.value && !status.value.available) return { title: 'Este teléfono no puede dictar ahora', detail: 'Seguí en el teclado: escribí el monto y en qué.' };
  return undefined;
});

/** Palabras de compras que el dictado sin conexión confunde ("refresco" → "escritura"). */
const DICTATION_WORDS = [
  'efectivo', 'débito', 'crédito', 'transferencia', 'lucas', 'feria', 'súper', 'almacén', 'ómnibus', 'farmacia', 'STM', 'UTE', 'OSE', 'Antel',
  'refresco', 'palta', 'yerba', 'fideos', 'tomate', 'cebolla', 'papa', 'boniato', 'zapallito', 'morrón', 'lechuga', 'manzana', 'banana',
  'queso', 'manteca', 'leche', 'huevos', 'pan', 'bizcochos', 'asado', 'pollo', 'detergente', 'lavandina', 'agua', 'jugo', 'vino',
];

/** Palabras que conviene que el dictado reconozca bien: los comercios de siempre, medios de pago y productos. */
function hints(): string[] {
  const stores = [...new Set(gastos.sorted.map((t) => t.store))].slice(0, 40);
  return [...stores, ...DICTATION_WORDS];
}

/** Lo entendido de una frase pasa a "Nuevos"; lo que ya estaba en la carga queda para preguntar. */
function understand(text: string, forRound: number) {
  if (forRound <= handledRound) return;
  handledRound = forRound;
  phrase.value = text.trim();
  partial.value = '';
  duplicates.value = [];
  notUnderstood.value = '';
  if (!phrase.value) return;
  const entries = parseQuickEntries(phrase.value, todayIso());
  // Cada gasto toma la cuenta de su medio de pago ("con débito" → la de débito)
  const drafts = carga.withAccounts(phraseDrafts(phrase.value, entries, { source: 'voz', payment: lastPayment(), date: todayIso(), newId: newDraftId }));
  // En compilaciones de prueba llega a la consola de Xcode/logcat: sirve para sumar frases reales a los tests
  console.info(`Dictado ${JSON.stringify({ phrase: phrase.value, parsed: entries })}`);
  if (!drafts.length) {
    notUnderstood.value = phrase.value;
    return;
  }
  const { added, duplicates: dups } = splitDuplicates(drafts, total.value);
  fresh.value.push(...added);
  duplicates.value = dups;
}

function startDictation() {
  if (listening.value) return;
  const mine = ++round;
  listening.value = true;
  ready.value = false;
  partial.value = '';
  dictationError.value = '';
  session = startListening({
    onText: (t) => (partial.value = t),
    onEnd: (t, error) => {
      // Terminó solo (silencio largo): queda lo entendido
      if (error && !t) dictationError.value = error;
      session = undefined;
      listening.value = false;
      holding.value = false;
      understand(t || partial.value, mine);
    },
    hints: hints(),
  })
    .then((s) => {
      ready.value = true;
      return s;
    })
    .catch((e: unknown) => {
      dictationError.value = e instanceof Error ? e.message : 'No se pudo dictar.';
      listening.value = false;
      holding.value = false;
      return undefined;
    });
}

async function stopDictation() {
  const pending = session;
  const mine = round;
  session = undefined;
  holding.value = false;
  if (!pending) return;
  const s = await pending;
  let text = partial.value;
  try {
    if (s) text = (await s.stop()) || text;
  } catch (e) {
    dictationError.value = e instanceof Error ? e.message : 'No se pudo dictar.';
  }
  listening.value = false;
  understand(text, mine);
}

function pressMic() {
  if (listening.value) {
    void stopDictation();
    return;
  }
  pressedAt = Date.now();
  holding.value = true;
  startDictation();
}

function releaseMic() {
  if (!holding.value) return;
  // Toque corto: sigue escuchando hasta el próximo toque
  if (Date.now() - pressedAt < 350) holding.value = false;
  else void stopDictation();
}

function cancelHold() {
  if (holding.value) void stopDictation();
}

function toggleMic() {
  if (listening.value) void stopDictation();
  else startDictation();
}

function addDuplicates() {
  fresh.value.push(...duplicates.value);
  duplicates.value = [];
}

function removeFresh(id: string) {
  fresh.value = fresh.value.filter((d) => d.id !== id);
}

const editingCategory = ref<Draft>();

function replaceFresh(id: string, drafts: Draft[]) {
  const i = fresh.value.findIndex((d) => d.id === id);
  if (i >= 0) fresh.value.splice(i, 1, ...drafts);
}

async function askAmount(d: Draft) {
  const a = await alertController.create({
    header: d.title,
    inputs: [{ name: 'amount', type: 'text', value: String(d.ticket.lines[0].amount).replace('.', ','), attributes: { inputmode: 'decimal' } }],
    buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', role: 'confirm' }],
  });
  await a.present();
  const { role, data } = await a.onDidDismiss<{ values: { amount: string } }>();
  const n = parseAmount(data?.values.amount ?? '');
  if (role !== 'confirm' || !(n > 0)) return;
  replaceFresh(d.id, [{ ...d, ticket: { ...d.ticket, lines: [{ ...d.ticket.lines[0], amount: n }] } }]);
}

/** Tocar un gasto dictado: corregir el monto o la categoría, o separar una compra en sus artículos. */
async function editDraft(d: Draft) {
  const many = d.ticket.lines.length > 1;
  const sheet = await actionSheetController.create({
    header: `${d.title} · ${many ? d.ticket.lines.map((l) => `${l.pretty} ${formatPesos(l.amount)}`).join(', ') : draftAmountText(d)}`,
    buttons: [
      ...(many
        ? [{ text: `Separar en ${d.ticket.lines.length} gastos`, handler: () => replaceFresh(d.id, splitPurchase(d, newDraftId)) }]
        : [
            { text: 'Cambiar el monto', handler: () => void askAmount(d) },
            { text: 'Cambiar la categoría', handler: () => void (editingCategory.value = d) },
          ]),
      { text: 'Quitar', role: 'destructive', handler: () => removeFresh(d.id) },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

function pickCategory(v: { category: Category; subcategory: string }) {
  const d = editingCategory.value;
  editingCategory.value = undefined;
  if (d) replaceFresh(d.id, [{ ...d, ticket: { ...d.ticket, lines: d.ticket.lines.map((l) => ({ ...l, ...v })) } }]);
}

function moveToCart() {
  carga.add(fresh.value);
  fresh.value = [];
  duplicates.value = [];
}

async function toKeypad() {
  await stopDictation();
  moveToCart();
  emit('keypad');
}

async function saveAll() {
  await stopDictation();
  moveToCart();
  emit('save');
}

onMounted(async () => {
  status.value = await speechStatus();
  if (props.autoListen && status.value.available) startDictation();
});
onBeforeUnmount(() => void stopDictation());
</script>

<style scoped>
.voz { min-height: 100%; box-sizing: border-box; gap: 14px; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); }
.steps { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 14px; color: var(--rb-muted); }
.step { display: flex; align-items: center; gap: 5px; }
.sep { width: 16px; height: 1px; background: var(--rb-neutral-border); }
.current { height: 30px; padding: 0 12px; border-radius: 999px; background: #eaf6f0; color: var(--rb-accent-dark); font-weight: 600; display: flex; align-items: center; gap: 6px; }
.current .rb-dot { width: 8px; height: 8px; background: var(--rb-accent); }
.said { font-size: 19px; font-weight: 500; line-height: 1.4; text-align: center; padding: 4px 8px; }
.said.hint { font-size: 16px; font-weight: 400; color: var(--rb-muted); }
.news { display: flex; flex-direction: column; gap: 6px; }
.news-head { display: flex; justify-content: space-between; padding: 0 4px; font-size: 14px; }
.news-head .label { font-weight: 600; color: var(--rb-accent); text-transform: uppercase; letter-spacing: 0.04em; }
.news-list { border-radius: 14px; background: #fff; padding: 0 14px; box-shadow: 0 0 0 2px var(--rb-accent); }
.news-row { display: flex; align-items: center; gap: 10px; min-height: 58px; border-bottom: 1px solid var(--rb-line); }
.news-row:last-child { border-bottom: 0; }
.rb-wrap .news-row .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.news-row .t { font-size: 16px; }
.news-row .s { font-size: 13px; color: var(--rb-muted); }
.news-row .amt { font-size: 16px; font-weight: 600; }
.rb-wrap .x { width: 40px; height: 40px; margin-right: -8px; border-radius: 50%; color: var(--rb-muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rb-attention-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; background: var(--rb-attention); }
.rb-attention-card .grow { display: flex; flex-direction: column; gap: 2px; }
.rb-attention-card .t { font-size: 16px; font-weight: 600; }
.rb-attention-card .s { font-size: 14px; color: var(--rb-attention-ink); }
.rb-wrap .white-btn { align-self: flex-start; height: 40px; padding: 0 14px; border-radius: 10px; background: #fff; font-size: 15px; font-weight: 500; }
.already { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px; border-radius: 14px; border: 1px dashed var(--rb-neutral-border); color: var(--rb-muted); font-size: 15px; }
.already .grow { flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mic { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.rb-wrap .mic-btn { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px; border-radius: 999px; background: #fff; font-size: 15px; color: var(--rb-ink); touch-action: none; user-select: none; -webkit-user-select: none; transition: transform 0.15s; }
.mic-btn svg { color: var(--rb-accent); }
.rb-wrap .mic-btn.on { background: var(--rb-accent); color: #fff; transform: scale(1.06); }
.mic-btn.on svg { color: #fff; }
.note { font-size: 13px; color: var(--rb-muted); text-align: center; max-width: 300px; line-height: 1.4; }
.actions { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
.actions .rb-btn { min-height: 52px; font-size: 15px; }
</style>
