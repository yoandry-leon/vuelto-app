<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap nuevo">
        <div class="rb-navbar">
          <button type="button" class="rb-navlink" @click="cancel">Cancelar</button>
          <span class="title">Nuevos gastos</span>
          <span v-if="!sync.online" class="end conn"><span class="rb-dot" style="background: var(--rb-warn-dot)" />Sin conexión</span>
          <span v-else />
        </div>

        <!-- La carga en una fila: tocándola se ve entera ("Tu carga") -->
        <button type="button" class="cart" :disabled="!allDrafts.length" aria-label="Ver los gastos en la carga" @click="sheet = 'carga'">
          <span class="num" aria-hidden="true">{{ carga.items.length }}</span>
          <span class="grow">
            <span class="t">En la carga · sin guardar</span>
            <span class="s">{{ cartText }}</span>
          </span>
          <span class="amt rb-amount">{{ carga.total }}</span>
          <svg v-if="allDrafts.length" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M9 18l6-6-6-6" /></svg>
        </button>

        <div v-if="frequent.length" class="sumar">
          <span class="label">Sumar</span>
          <button v-for="f in frequent" :key="`${f.title}-${f.amount}`" type="button" class="chip" @click="addFrequent(f)">+ {{ f.title }} {{ formatPesos(f.amount) }}</button>
        </div>

        <div class="editor">
          <div class="ed-head">
            <span class="ed-title">Gasto {{ carga.items.length + 1 }} · se incluye al guardar</span>
            <div class="ed-tools">
              <button type="button" class="tool" aria-label="Dictar gastos" @click="openSheet('voz')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
              <button type="button" class="tool" aria-label="Escanear ticket" @click="openSheet('camara')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </button>
            </div>
          </div>
          <div class="amount-line">
            <button type="button" class="cur" aria-label="Cambiar moneda" @click="currency = currency === 'UYU' ? 'USD' : 'UYU'">{{ currency === 'USD' ? 'USD' : '$' }}</button>
            <span class="amount" :class="{ empty: !typed && !phraseTotal }" aria-live="polite">{{ typed || !phraseTotal ? keypadDisplay(amountText) : keypadDisplay(String(phraseTotal).replace('.', ',')) }}</span>
          </div>
          <label class="sr" for="registrar-desc">Descripción</label>
          <input id="registrar-desc" v-model="desc" class="desc" placeholder="¿En qué? (opcional)" autocomplete="off" enterkeyhint="done" @keydown.enter="($event.target as HTMLInputElement).blur()" />
          <div class="cats" role="radiogroup" aria-label="Categoría">
            <button
              v-for="c in cells"
              :key="c.label"
              type="button"
              role="radio"
              class="cat"
              :class="{ on: c.label === selectedLabel }"
              :aria-checked="c.label === selectedLabel"
              @click="pickCell(c)"
            >{{ c.label }}</button>
          </div>
          <div class="opts">
            <button type="button" class="opt account" aria-label="Cuenta" @click="accountOpen = true">{{ shownAccount?.name ?? 'Cuenta' }}</button>
            <label class="opt date">
              <span>{{ dateLabel }}</span>
              <input v-model="date" type="date" :max="today" aria-label="Fecha" @change="dateTouched = true" />
            </label>
          </div>
        </div>

        <div class="keypad">
          <button v-for="k in KEYS" :key="k" type="button" class="key" :aria-label="k === 'del' ? 'Borrar' : k === ',' ? 'Coma decimal' : k" @click="press(k)">{{ k === 'del' ? '⌫' : k }}</button>
        </div>

        <div class="actions">
          <button type="button" class="rb-btn secondary" :disabled="!editorDrafts.length" @click="addOther">+ Agregar otro</button>
          <button type="button" class="rb-btn primary" :disabled="!allDrafts.length || saving" @click="save()">{{ saveLabel }}</button>
        </div>
      </div>

      <account-sheet :open="accountOpen" :selected="shownAccount?.id" subtitle="De dónde sale la plata" @select="pickAccount" @close="accountOpen = false" />
      <ion-modal :is-open="sheet === 'carga'" class="rb-full" @did-dismiss="sheet = null">
        <carga-sheet :editing="editorDrafts" @close="sheet = null" @save="saveFromSheet" @edit="editDraft" @discard-editor="resetEditor" />
      </ion-modal>
      <ion-modal :is-open="sheet === 'voz'" class="rb-full" @did-dismiss="sheet = null">
        <voz-sheet :auto-listen="autoListen" @keypad="sheet = null" @save="saveFromSheet" />
      </ion-modal>
      <ion-modal :is-open="sheet === 'camara'" class="rb-full camara-modal" @did-dismiss="sheet = null">
        <camara-sheet @close="sheet = null" />
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { alertController, IonContent, IonModal, IonPage, onIonViewDidLeave, onIonViewWillEnter, toastController, useIonRouter } from '@ionic/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import CamaraSheet from '@/components/registrar/CamaraSheet.vue';
import AccountSheet from '@/components/AccountSheet.vue';
import CargaSheet from '@/components/registrar/CargaSheet.vue';
import VozSheet from '@/components/registrar/VozSheet.vue';
import { lastTab } from '@/composables/lastTab';
import {
  cartTotal, type Draft, draftAmountText, frequentDraft, type FrequentExpense, frequentExpenses, KEYPAD_CATEGORIES,
  keypadAmount, keypadDisplay, keypadDraft, keypadSubcategory, phraseDrafts, pressKey,
} from '@/domain/carga';
import { categoryLabel } from '@/domain/categories';
import { relativeDay, timeOf, todayIso } from '@/domain/dates';
import { formatPesos, round2 } from '@/domain/money';
import { normalize } from '@/domain/products';
import { parseQuickEntries, parseQuickEntry } from '@/domain/quickEntry';
import { type Account, accountFor, lastAccountId } from '@/domain/accounts';
import type { Category } from '@/domain/types';
import { newDraftId, useCargaStore } from '@/stores/carga';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';
import { useSyncStore } from '@/stores/sync';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

const route = useRoute();
const router = useIonRouter();
const gastos = useGastosStore();
const finanzas = useFinanzasStore();
const carga = useCargaStore();
const sync = useSyncStore();

/** Voz y cámara se abren a pantalla completa encima del teclado: la ruta queda siempre en /tabs/registrar. */
const sheet = ref<'carga' | 'voz' | 'camara' | null>(null);
const autoListen = ref(false);

// El gasto que se está escribiendo
const amountText = ref('');
const currency = ref<'UYU' | 'USD'>('UYU');
const desc = ref('');
const categoryChoice = ref<{ category: Category; subcategory: string }>();
/** La cuenta de la que sale el gasto: la del último gasto, hasta que se elija otra. */
const lastAccount = () => lastAccountId(gastos.tickets, finanzas.accounts);
const accountId = ref(lastAccount());
const accountTouched = ref(false);
const accountOpen = ref(false);
const today = ref(todayIso());
const date = ref(today.value);
const dateTouched = ref(false);
const now = ref(new Date().toISOString());

const typed = computed(() => keypadAmount(amountText.value));
/** Lo que se entiende de la descripción: la categoría ("café" → Salidas) o, sin monto en el teclado, gastos enteros ("450 feria efectivo"). */
const inferred = computed(() => {
  const q = parseQuickEntry(desc.value, today.value);
  return q.category === 'Otros' ? undefined : { category: q.category, subcategory: q.subcategory };
});
const descEntries = computed(() => (typed.value || !/\d/.test(desc.value) ? undefined : parseQuickEntries(desc.value, today.value)));
const phraseTotal = computed(() => round2(descEntries.value?.items.reduce((s, i) => s + i.amount, 0) ?? 0));

const selected = computed(() => categoryChoice.value ?? inferred.value ?? { category: 'Otros' as Category, subcategory: 'Varios' });
const selectedLabel = computed(() => categoryLabel(selected.value.category, selected.value.subcategory));
/** La última celda es "Otros", o la categoría entendida cuando no está en la grilla (ute → Servicios, ferretería → Hogar). */
const cells = computed(() => {
  const s = selected.value;
  if (KEYPAD_CATEGORIES.some((c) => c.label === selectedLabel.value)) return KEYPAD_CATEGORIES;
  return [...KEYPAD_CATEGORIES.slice(0, -1), { label: s.category, category: s.category, subcategory: s.subcategory }];
});

const chosenAccount = computed(() => finanzas.accounts.find((a) => a.id === accountId.value) ?? finanzas.accounts[0]);
/** Si la descripción dice el medio de pago ("450 feria efectivo"), se usa la cuenta de ese tipo, salvo que se haya elegido otra. */
const shownAccount = computed(() => {
  const said = !accountTouched.value && descEntries.value?.payment;
  return (said && accountFor(finanzas.accounts, said, accountId.value)) || chosenAccount.value;
});
const dateLabel = computed(() => {
  if (date.value === today.value) return `Hoy, ${timeOf(now.value)}`;
  const d = relativeDay(date.value, today.value);
  return d.charAt(0).toUpperCase() + d.slice(1);
});

/** El gasto en pantalla como borradores: uno con el monto del teclado, o los entendidos de la descripción. */
const editorDrafts = computed((): Draft[] => {
  if (typed.value) {
    const { category, subcategory } = selected.value;
    const account = shownAccount.value;
    return [keypadDraft({ amount: typed.value, currency: currency.value, description: desc.value, category, subcategory, payment: account?.payment ?? 'Efectivo', accountId: account?.id, date: date.value }, 'editor')];
  }
  const entries = descEntries.value;
  if (!entries?.items.length) return [];
  const account = chosenAccount.value;
  const drafts = phraseDrafts(desc.value, entries, { source: 'texto', payment: account?.payment ?? 'Efectivo', date: dateTouched.value ? date.value : entries.date ?? date.value, newId: () => 'editor' });
  // Una cuenta elegida a mano vale para todo; si no, cada gasto toma la del medio de pago dicho al guardarse
  if (accountTouched.value && account) drafts.forEach((d) => Object.assign(d.ticket, { payment: account.payment, accountId: account.id }));
  // Una categoría tocada a mano gana sobre la entendida, si es un gasto de una sola línea
  if (categoryChoice.value && drafts.length === 1 && drafts[0].ticket.lines.length === 1) Object.assign(drafts[0].ticket.lines[0], categoryChoice.value);
  return drafts;
});
const allDrafts = computed(() => [...carga.items, ...editorDrafts.value]);
const saving = ref(false);
const saveLabel = computed(() => (allDrafts.value.length ? `Guardar todo · ${cartTotal(allDrafts.value)}` : 'Guardar'));

/** Los de siempre que no están ya en la carga ni en pantalla. */
const frequent = computed(() => {
  const taken = new Set([...carga.items.map((d) => normalize(d.title)), normalize(desc.value)]);
  return frequentExpenses(gastos.tickets)
    .filter((f) => !taken.has(normalize(f.title)))
    .slice(0, 2);
});

/** "Recién agregado: Ómnibus $ 52", o lo que hay en la carga. */
const cartText = computed(() => {
  const items = carga.items;
  if (!items.length) return 'Nada se registra hasta que toques Guardar';
  const last = items.find((d) => d.id === carga.lastId);
  return last ? `Recién agregado: ${last.title} ${draftAmountText(last)}` : items.map((d) => d.title).join(', ');
});

function press(key: string) {
  amountText.value = pressKey(amountText.value, key);
}

function pickCell(c: { label: string; category: Category; subcategory: string }) {
  categoryChoice.value = { category: c.category, subcategory: keypadSubcategory(c, inferred.value) };
}

function pickAccount(a: Account) {
  accountId.value = a.id;
  accountTouched.value = true;
  accountOpen.value = false;
}

function withIds(drafts: Draft[]): Draft[] {
  return drafts.map((d) => ({ ...d, id: newDraftId() }));
}

function resetEditor() {
  amountText.value = '';
  desc.value = '';
  categoryChoice.value = undefined;
  if (!dateTouched.value) date.value = today.value;
}

/** Pasa a la carga lo que está en pantalla y deja el teclado listo para el próximo. */
function addOther() {
  const drafts = editorDrafts.value;
  if (!drafts.length) return;
  carga.add(withIds(drafts));
  resetEditor();
}

function addFrequent(f: FrequentExpense) {
  carga.add([frequentDraft(f, date.value, newDraftId())]);
}

function openSheet(which: 'voz' | 'camara', listen = false) {
  // Lo que ya estaba escrito "se incluye al guardar": pasa a la carga antes de dictar o escanear
  addOther();
  autoListen.value = listen;
  sheet.value = which;
}

function resetAll() {
  carga.clear();
  resetEditor();
  currency.value = 'UYU';
  accountTouched.value = false;
  dateTouched.value = false;
  accountId.value = lastAccount();
  date.value = today.value;
}

async function save() {
  if (saving.value || !allDrafts.value.length) return;
  saving.value = true;
  try {
    const saved = await carga.saveAll(withIds(editorDrafts.value));
    resetAll();
    router.navigate('/tabs/inicio', 'back', 'replace');
    const toast = await toastController.create({
      message: saved.length === 1 ? 'Gasto guardado en el teléfono' : `${saved.length} gastos guardados en el teléfono`,
      duration: 2200,
      position: 'top',
      cssClass: 'rb-toast',
    });
    await toast.present();
  } finally {
    saving.value = false;
  }
}

async function saveFromSheet() {
  sheet.value = null;
  await save();
}

/**
 * "Tocá un gasto para corregirlo" en Tu carga: vuelve al teclado con ese gasto. Lo que estaba escrito no se pierde:
 * pasa a la carga.
 */
function editDraft(d: Draft) {
  addOther();
  carga.remove(d.id);
  const line = d.ticket.lines[0];
  amountText.value = d.ticket.usd ? String(d.ticket.usd.amount).replace('.', ',') : String(line?.amount ?? '').replace('.', ',');
  currency.value = d.ticket.usd ? 'USD' : 'UYU';
  desc.value = d.title;
  if (line) categoryChoice.value = { category: line.category, subcategory: line.subcategory };
  accountId.value = d.ticket.accountId ?? accountFor(finanzas.accounts, d.ticket.payment)?.id;
  accountTouched.value = true;
  date.value = d.ticket.date;
  dateTouched.value = d.ticket.date !== today.value;
  sheet.value = null;
}

async function cancel() {
  const n = allDrafts.value.length;
  if (n) {
    const alert = await alertController.create({
      header: n === 1 ? '¿Descartar el gasto?' : `¿Descartar ${n} gastos?`,
      message: 'Todavía no se guardaron.',
      buttons: [
        { text: 'Seguir cargando', role: 'cancel' },
        { text: 'Descartar', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
  }
  resetAll();
  router.navigate(lastTab.value, 'back', 'replace');
}

/** La ruta cuyo `?modo=` ya se atendió: volver a la pestaña con la misma URL no reabre la voz ni la cámara. */
let handledPath = '';

/**
 * `?modo=voz|foto|qr` (widgets, botón de acción, Centro de control) abre directo la voz o la cámara.
 * Los links de afuera llegan con `&n=` distinto cada vez (nativeBridges), así que siempre se atienden.
 */
function enter() {
  today.value = todayIso();
  now.value = new Date().toISOString();
  if (!dateTouched.value) date.value = today.value;
  if (!accountTouched.value && !carga.items.length) accountId.value = lastAccount();
  if (route.fullPath === handledPath) return;
  handledPath = route.fullPath;
  const modo = String(route.query.modo ?? '');
  if (modo === 'voz') openSheet('voz', route.query.escuchar === '1');
  else if (modo === 'foto' || modo === 'qr') openSheet('camara');
}

onIonViewWillEnter(enter);
// Un link rumbo://registrar con la pantalla ya abierta no vuelve a "entrar": se abre a mano
watch(
  () => route.fullPath,
  (path, before) => {
    if (path.startsWith('/tabs/registrar') && before?.startsWith('/tabs/registrar') && path !== before) enter();
  },
);
onIonViewDidLeave(() => (sheet.value = null));

/** Con teclado físico (o en la compu): cifras, coma, borrar y Enter para agregar otro. */
function onKey(e: KeyboardEvent) {
  if (sheet.value || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (!route.path.startsWith('/tabs/registrar')) return;
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === ',' || e.key === '.') press(',');
  else if (e.key === 'Backspace') press('del');
  else if (e.key === 'Enter') addOther();
  else return;
  e.preventDefault();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
/* Alto de pantalla: el teclado y Guardar quedan abajo; si no entra, se desplaza */
.nuevo { min-height: 100%; box-sizing: border-box; gap: 8px; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); }
.conn { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--rb-muted); }
.nuevo > * { flex-shrink: 0; }
.rb-wrap .cart { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 0 14px; border-radius: 14px; background: #fff; width: 100%; box-sizing: border-box; text-align: left; }
.rb-wrap .cart:disabled { cursor: default; }
.num { width: 28px; height: 28px; border-radius: 50%; background: var(--rb-segment); color: var(--rb-ink-3); font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cart .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cart .t { font-size: 15px; font-weight: 600; }
.cart .s { font-size: 13px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cart .amt { font-size: 15px; font-weight: 500; }
.sumar { display: flex; align-items: center; gap: 6px; height: 44px; overflow-x: auto; scrollbar-width: none; }
.sumar::-webkit-scrollbar { display: none; }
.sumar .label { font-size: 13px; color: var(--rb-muted); flex-shrink: 0; }
.rb-wrap .chip { height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--rb-line); background: #fff; font-size: 15px; white-space: nowrap; flex-shrink: 0; }
.editor { background: #fff; border-radius: 14px; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 0 0 2px var(--rb-accent); }
.ed-head { display: flex; justify-content: space-between; align-items: center; }
.ed-title { font-size: 14px; font-weight: 600; color: var(--rb-accent); }
.ed-tools { display: flex; gap: 6px; }
.rb-wrap .tool { width: 44px; height: 36px; border-radius: 10px; background: var(--rb-bg); display: flex; align-items: center; justify-content: center; }
.amount-line { display: flex; align-items: center; justify-content: center; gap: 8px; }
.rb-wrap .cur { height: 36px; padding: 0 12px; border-radius: 999px; background: var(--rb-segment); font-size: 14px; font-weight: 600; }
.amount { font-size: 36px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.amount.empty { color: var(--rb-chevron); }
.desc { width: 100%; height: 32px; border: 0; background: transparent; text-align: center; color: var(--rb-ink); font-size: 16px; outline: none; }
.desc::placeholder { color: var(--rb-muted); }
.cats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.rb-wrap .cat { height: 44px; border-radius: 10px; background: var(--rb-bg); font-size: 14px; font-weight: 500; text-align: center; }
.rb-wrap .cat.on { background: var(--rb-accent); color: #fff; }
.opts { display: flex; gap: 6px; }
.rb-wrap .opt.account { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
.rb-wrap .opt { flex: 1; height: 44px; border-radius: 10px; background: var(--rb-bg); font-size: 15px; text-align: center; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer; }
.opt.date input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.keypad { margin-top: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.rb-wrap .key { height: 50px; border-radius: 10px; background: #fff; font-size: 22px; font-weight: 500; text-align: center; touch-action: manipulation; }
.rb-wrap .key:active { background: var(--rb-segment); }
.actions { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
.actions .rb-btn { min-height: 52px; font-size: 15px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
