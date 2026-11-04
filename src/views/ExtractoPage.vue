<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap extracto">
        <div class="rb-navbar">
          <button type="button" class="rb-navlink" @click="goBack">Cancelar</button>
          <span class="title">Importar extracto</span>
          <span />
        </div>

        <div class="rb-group">
          <button type="button" class="rb-row" @click="accountOpen = true">
            <span class="grow"><span>Cuenta</span></span>
            <span class="value">
              {{ account ? account.name : 'Elegí una' }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </span>
          </button>
        </div>

        <template v-if="!file">
          <div class="rb-card intro">
            <span class="rb-icon-circle" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
            </span>
            <span class="t">Subí el extracto de tu banco</span>
            <span class="s">Bajalo en CSV desde la web o la app del banco; si viene en Excel, abrilo y guardalo como CSV. Se lee en el teléfono y no se manda a ningún lado.</span>
            <span class="s">Lo que ya anotaste se vincula con el extracto, y lo que falta se registra. Vos elegís qué entra.</span>
          </div>
          <button type="button" class="rb-btn primary" :disabled="!account" @click="pick">Elegir archivo</button>
          <button v-if="!native" type="button" class="rb-btn soft demo" :disabled="!account" @click="useDemo">Probar con un extracto de ejemplo</button>
        </template>

        <template v-else>
          <div class="rb-card file">
            <div class="file-head">
              <span class="name">{{ file.name }}</span>
              <button type="button" class="link" @click="pick">Cambiar</button>
            </div>
            <span class="s">{{ items.length === 1 ? '1 movimiento' : `${items.length} movimientos` }}{{ period ? ` · ${period}` : '' }}</span>
            <span class="s">Columnas: {{ columnsText }}</span>
            <div class="links">
              <button type="button" class="link" @click="changeColumns">Cambiar columnas</button>
              <button v-if="layout?.columns.amount !== undefined" type="button" class="link" @click="flipSigns">Invertir gastos y entradas</button>
            </div>
          </div>
          <span v-if="skipped" class="rb-note">{{ skipped === 1 ? '1 fila no se pudo leer' : `${skipped} filas no se pudieron leer` }} (sin fecha o sin monto). Si son muchas, revisá las columnas.</span>

          <div v-if="!items.length" class="rb-empty">
            <span class="t">No encontramos movimientos</span>
            <span class="s">Probá cambiar las columnas: la fecha, la descripción y el monto.</span>
          </div>

          <section v-for="g in groups" :key="g.key" class="rb-section">
            <div class="rb-section-head">
              <span class="rb-label">{{ g.title }}</span>
              <span class="rb-small">{{ g.items.length }}</span>
            </div>
            <div class="rb-group">
              <div v-for="it in g.items" :key="it.ref" class="row" :class="{ off: it.action === 'omitir' }">
                <button type="button" class="check-btn" :aria-label="it.action === 'omitir' ? `Importar ${it.store}` : `No importar ${it.store}`" :aria-pressed="it.action !== 'omitir'" @click="toggle(it)">
                  <span class="check" :class="{ on: it.action !== 'omitir' }">
                    <svg v-if="it.action !== 'omitir'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                  </span>
                </button>
                <button type="button" class="grow" @click="open(it)">
                  <span class="t">{{ it.store }}</span>
                  <span class="s">{{ subtitle(it) }}</span>
                </button>
                <span class="amt rb-amount" :class="{ income: it.row.income }">{{ amountText(it) }}</span>
              </div>
            </div>
            <span class="rb-note">{{ g.note }}</span>
          </section>

          <span v-if="imported" class="rb-note">{{ imported === 1 ? '1 movimiento ya estaba importado' : `${imported} movimientos ya estaban importados` }}: no se vuelven a agregar.</span>

          <div class="bottom">
            <button type="button" class="rb-btn primary" :disabled="!toAdd && !toLink" @click="confirm">{{ buttonText }}</button>
          </div>
        </template>
      </div>
      <account-sheet
        :open="accountOpen"
        :selected="account?.id"
        title="Cuenta del extracto"
        subtitle="Los movimientos se registran en esta cuenta"
        @select="pickAccount"
        @close="accountOpen = false"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { actionSheetController, alertController, IonContent, IonPage, toastController, useIonRouter } from '@ionic/vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AccountSheet from '@/components/AccountSheet.vue';
import { demoStatement } from '@/data/seed';
import type { Account } from '@/domain/accounts';
import { categoryLabel, CATEGORIES, SUBCATEGORIES } from '@/domain/categories';
import { shortDate } from '@/domain/dates';
import { formatPesos, formatUsd } from '@/domain/money';
import {
  columnNames, detectLayout, type ImportItem, importChanges, linkCandidates, linkedAmount, looksLikeSpreadsheet, parseCsv, planImport,
  readRows, type StatementColumns, type StatementLayout,
} from '@/domain/statement';
import { ticketTotals } from '@/domain/totals';
import type { Ticket } from '@/domain/types';
import { pickStatementFile } from '@/services/statementFile';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';

const router = useIonRouter();
const route = useRoute();
const finanzas = useFinanzasStore();
const gastos = useGastosStore();
const native = Capacitor.isNativePlatform();

// La cuenta llega en ?cuenta=; si no, la primera que no es efectivo (un extracto es de un banco o una tarjeta)
const accountId = ref<string>();
watch(
  () => route.query.cuenta,
  (q) => {
    if (route.path !== '/tabs/movimientos/extracto') return;
    accountId.value = typeof q === 'string' && finanzas.accounts.some((a) => a.id === q) ? q : (finanzas.accounts.find((a) => a.payment !== 'Efectivo') ?? finanzas.accounts[0])?.id;
  },
  { immediate: true },
);
const account = computed(() => finanzas.accounts.find((a) => a.id === accountId.value));
const accountOpen = ref(false);

const file = ref<{ name: string; cells: string[][] }>();
const layout = ref<StatementLayout>();
const items = ref<ImportItem[]>([]);
const skipped = ref(0);

/** Vuelve a leer los movimientos (con las columnas de `layout`) y a compararlos con lo anotado. */
function plan() {
  if (!file.value || !layout.value || !account.value) return;
  const read = readRows(file.value.cells, layout.value);
  skipped.value = read.skipped;
  items.value = planImport(read.rows, gastos.tickets, account.value);
}

function load(name: string, text: string) {
  if (looksLikeSpreadsheet(text)) {
    void notice('Es un archivo de Excel', 'Abrilo en Excel o Numbers y guardalo como CSV (separado por comas o por punto y coma).');
    return;
  }
  const cells = parseCsv(text);
  const found = detectLayout(cells, account.value?.payment === 'Crédito');
  if (!found) {
    void notice('No encontramos los movimientos', 'Revisá que sea el extracto en CSV, con una columna de fecha y otra de monto.');
    return;
  }
  file.value = { name, cells };
  layout.value = found;
  plan();
}

/** El selector se abre en el mismo toque, sin esperar nada antes. */
async function pick() {
  const picked = await pickStatementFile();
  if (picked) load(picked.name, picked.text);
}

function useDemo() {
  load('extracto-ejemplo.csv', demoStatement(gastos.tickets));
}

function pickAccount(a: Account) {
  accountOpen.value = false;
  accountId.value = a.id;
  plan();
}

async function notice(header: string, message: string) {
  const alert = await alertController.create({ header, message, buttons: ['Entendido'] });
  await alert.present();
}

const day = (iso: string) => shortDate(iso).split(' ').slice(1).join(' ');

const period = computed(() => {
  const dates = items.value.map((i) => i.row.date).sort();
  if (!dates.length) return '';
  return dates[0] === dates[dates.length - 1] ? day(dates[0]) : `del ${day(dates[0])} al ${day(dates[dates.length - 1])}`;
});

const names = computed(() => (file.value && layout.value ? columnNames(file.value.cells, layout.value) : []));
const columnsText = computed(() => {
  const c = layout.value?.columns;
  if (!c) return '';
  const n = (i?: number) => (i === undefined ? '' : names.value[i] ?? `Columna ${i + 1}`);
  const amount = c.amount !== undefined ? n(c.amount) : [n(c.debit), n(c.credit)].filter(Boolean).join(' y ');
  return [n(c.date), n(c.description), amount, c.usd !== undefined ? n(c.usd) : ''].filter(Boolean).join(' · ');
});

const ticketsById = computed(() => new Map(gastos.tickets.map((t) => [t.id, t])));

const groups = computed(() => {
  const pending = items.value.filter((i) => !i.imported);
  return [
    { key: 'anotados', title: 'Ya anotados', items: pending.filter((i) => i.match), note: 'Son gastos que ya registraste: quedan vinculados al extracto y pasan a esta cuenta. No se duplican.' },
    { key: 'nuevos', title: 'Nuevos', items: pending.filter((i) => !i.match && i.kind === 'gasto'), note: 'No los encontramos entre tus gastos: se registran en esta cuenta. Tocá uno para cambiarle la categoría o elegir un gasto que ya anotaste.' },
    { key: 'ingresos', title: 'Entradas de plata', items: pending.filter((i) => !i.match && i.kind === 'ingreso'), note: 'Vienen sin marcar: muchas son pases desde otra cuenta tuya. Marcá las que sean ingresos de verdad, como el sueldo.' },
    { key: 'pases', title: 'Pagos de tarjeta y retiros', items: pending.filter((i) => !i.match && i.kind === 'pase'), note: 'No son gastos nuevos: la plata pasa a otra cuenta. Lo que pagues con la tarjeta o en efectivo se anota aparte.' },
  ].filter((g) => g.items.length);
});
const imported = computed(() => items.value.filter((i) => i.imported).length);
const toAdd = computed(() => items.value.filter((i) => i.action === 'registrar').length);
const toLink = computed(() => items.value.filter((i) => i.action === 'vincular').length);

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const buttonText = computed(() => {
  if (toAdd.value && toLink.value) return `Registrar ${toAdd.value} y vincular ${toLink.value}`;
  if (toAdd.value) return `Registrar ${plural(toAdd.value, 'movimiento', 'movimientos')}`;
  if (toLink.value) return `Vincular ${plural(toLink.value, 'gasto', 'gastos')}`;
  return 'Nada para importar';
});

function amountText(it: ImportItem): string {
  const n = it.row.income ? it.row.amount : -it.row.amount;
  return it.row.currency === 'USD' ? formatUsd(n, { sign: true }) : formatPesos(n, { sign: true });
}

function ticketText(t: Ticket): string {
  const net = Math.abs(ticketTotals(t).net);
  return `${t.store} · ${day(t.date)} · ${t.usd ? formatUsd(t.usd.amount) : formatPesos(net)}`;
}

function subtitle(it: ImportItem): string {
  const t = it.match ? ticketsById.value.get(it.match) : undefined;
  if (t) {
    const amount = linkedAmount(t, it.row);
    return amount === undefined ? `Anotado como ${t.store} · ${day(t.date)}` : `${t.store}: de ${formatPesos(Math.abs(ticketTotals(t).net))} pasa a ${formatPesos(amount)}`;
  }
  if (it.kind === 'gasto') return `${categoryLabel(it.category, it.subcategory)} · ${day(it.row.date)}`;
  return `${day(it.row.date)} · ${it.row.text}`;
}

/** El círculo: entra o no entra, con lo que corresponde (vincular si tiene un gasto anotado, si no registrar). */
function toggle(it: ImportItem) {
  if (it.action !== 'omitir') it.action = 'omitir';
  else it.action = it.match ? 'vincular' : 'registrar';
}

/** Tocar un movimiento: vincularlo con otro gasto, registrarlo como nuevo, cambiarle la categoría o dejarlo afuera. */
async function open(it: ImportItem) {
  const t = it.match ? ticketsById.value.get(it.match) : undefined;
  const buttons = [
    ...(t && it.action !== 'vincular' ? [{ text: `Es ${t.store} del ${day(t.date)}`, handler: () => void (it.action = 'vincular') }] : []),
    { text: t ? 'Es otro gasto que ya anoté…' : 'Ya lo anoté: elegir el gasto…', handler: () => void chooseLink(it) },
    ...(t || it.action !== 'registrar'
      ? [{ text: 'Registrarlo como nuevo', handler: () => { it.match = undefined; it.action = 'registrar'; } }]
      : []),
    ...(!t ? [{ text: `Cambiar la categoría (${categoryLabel(it.category, it.subcategory)})`, handler: () => void chooseCategory(it) }] : []),
    ...(it.action !== 'omitir' ? [{ text: 'No importarlo', role: 'destructive', handler: () => void (it.action = 'omitir') }] : []),
    { text: 'Cancelar', role: 'cancel' },
  ];
  const sheet = await actionSheetController.create({ header: `${it.row.text} · ${day(it.row.date)} · ${amountText(it)}`, buttons });
  await sheet.present();
}

async function chooseLink(it: ImportItem) {
  const options = linkCandidates(it, items.value, gastos.tickets);
  if (!options.length) {
    await notice('No hay gastos para elegir', `No encontramos ${it.row.income ? 'ingresos anotados' : 'gastos anotados'} 10 días antes o después, sin vincular.`);
    return;
  }
  const sheet = await actionSheetController.create({
    header: `¿Cuál de tus ${it.row.income ? 'ingresos' : 'gastos'} es ${it.store}?`,
    buttons: [
      ...options.map((t) => ({ text: ticketText(t), handler: () => { it.match = t.id; it.action = 'vincular'; } })),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function chooseCategory(it: ImportItem) {
  const sheet = await actionSheetController.create({
    header: `Categoría de ${it.store}`,
    buttons: [
      ...CATEGORIES.map((c) => ({
        text: c,
        handler: () => {
          if (c !== it.category) it.subcategory = SUBCATEGORIES[c][0] ?? 'Varios';
          it.category = c;
          it.action = 'registrar';
        },
      })),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

type ColumnKey = keyof Pick<StatementColumns, 'date' | 'description' | 'amount' | 'debit' | 'credit'>;

/** Cambiar qué columna es la fecha, la descripción o el monto (en una columna con signo, o débito y crédito aparte). */
async function changeColumns() {
  const which: [ColumnKey, string][] = [
    ['date', 'La fecha'],
    ['description', 'La descripción'],
    ['amount', 'El monto (una columna, con signo)'],
    ['debit', 'Lo que salió (débito)'],
    ['credit', 'Lo que entró (crédito)'],
  ];
  const sheet = await actionSheetController.create({
    header: '¿Qué columna querés cambiar?',
    buttons: [...which.map(([key, text]) => ({ text, handler: () => void chooseColumn(key, text) })), { text: 'Cancelar', role: 'cancel' }],
  });
  await sheet.present();
}

async function chooseColumn(key: ColumnKey, label: string) {
  const sheet = await actionSheetController.create({
    header: label,
    buttons: [
      ...names.value.map((name, i) => ({
        text: name,
        handler: () => {
          if (!layout.value) return;
          const c = { ...layout.value.columns, [key]: i };
          // Un monto con signo reemplaza a débito y crédito, y al revés
          if (key === 'amount') {
            delete c.debit;
            delete c.credit;
          } else if (key === 'debit' || key === 'credit') delete c.amount;
          layout.value = { ...layout.value, columns: c };
          plan();
        },
      })),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

function flipSigns() {
  if (!layout.value) return;
  layout.value = { ...layout.value, expensesPositive: !layout.value.expensesPositive };
  plan();
}

async function confirm() {
  if (!account.value || (!toAdd.value && !toLink.value)) return;
  const id = account.value.id;
  const { news, links } = importChanges(items.value, account.value, gastos.tickets);
  const { added, linked } = await gastos.importStatement(news, links);
  router.navigate(`/tabs/movimientos?cuenta=${encodeURIComponent(id)}`, 'back', 'replace');
  const parts = [added.length ? `${plural(added.length, 'movimiento registrado', 'movimientos registrados')}` : '', linked ? `${plural(linked, 'vinculado', 'vinculados')}` : ''];
  const toast = await toastController.create({ message: `Extracto importado: ${parts.filter(Boolean).join(' y ')}`, duration: 2600, position: 'top', cssClass: 'rb-toast' });
  await toast.present();
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/tabs/movimientos/cuentas', 'back', 'replace');
}
</script>

<style scoped>
.extracto { gap: 16px; min-height: 100%; box-sizing: border-box; }
.intro { align-items: flex-start; gap: 8px; }
.intro .t { font-size: 17px; font-weight: 600; }
.intro .s { font-size: 14px; line-height: 1.5; color: var(--rb-muted); }
.rb-wrap .demo { align-self: center; }
.file { gap: 4px; }
.file-head { display: flex; align-items: baseline; gap: 12px; }
.file .name { flex-grow: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file .s { font-size: 14px; color: var(--rb-muted); line-height: 1.45; }
.links { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 4px; }
.rb-wrap .link { color: var(--rb-accent); font-size: 15px; font-weight: 500; min-height: 32px; }
.row { display: flex; align-items: center; gap: 10px; min-height: 60px; border-bottom: 1px solid var(--rb-line); }
.row:last-child { border-bottom: 0; }
.rb-wrap .check-btn { width: 36px; height: 44px; margin-left: -6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.check { width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--rb-neutral-border); display: flex; align-items: center; justify-content: center; }
.check.on { background: var(--rb-accent); box-shadow: none; }
.rb-wrap .row .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 8px 0; text-align: left; }
.row .t { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .s { font-size: 13px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.off .t, .row.off .amt { color: var(--rb-muted); }
.amt { font-size: 16px; font-weight: 500; }
.amt.income { color: var(--rb-accent); }
.bottom { position: sticky; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); margin-top: auto; padding-top: 4px; }
</style>
