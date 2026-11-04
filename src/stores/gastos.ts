import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { KNOWN_STORES, seedTickets } from '@/data/seed';
import { cfeKey } from '@/domain/cfe';
import { monthKey, todayIso } from '@/domain/dates';
import { round2, USD_RATE } from '@/domain/money';
import type { PaperItem, ReadItem } from '@/domain/paper';
import { assignAccounts, lastAccountId } from '@/domain/accounts';
import { phraseDrafts } from '@/domain/carga';
import { CATEGORIES, SUBCATEGORIES } from '@/domain/categories';
import { parseQuickEntries } from '@/domain/quickEntry';
import type { StatementLink } from '@/domain/statement';
import { type Deletion, deletionsFor, mergeRemote, needsReview, pendingToUpload, type RemoteExpense } from '@/domain/sync';
import { mainCategory } from '@/domain/totals';
import type { Category, CfeHeader, IsoDate, Line, NewTicket, PaymentMethod, Ticket } from '@/domain/types';
import { learnFromTicket, vendorKey, type VendorRules } from '@/domain/vendors';
import { KEYS, stored } from '@/services/storage';
import { useFinanzasStore } from './finanzas';

const gastosDb = stored<Ticket[]>(KEYS.gastos);
const puestosDb = stored<Record<string, VendorRules>>(KEYS.puestos);
const borradosDb = stored<Deletion[]>(KEYS.borrados);

function newId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Lo que se cambia en la pantalla "Editar gasto". */
export interface TicketEdit {
  store: string;
  date: IsoDate;
  payment: PaymentMethod;
  /** La cuenta elegida; `payment` es su tipo. */
  accountId?: string;
  kind?: 'ingreso';
  note?: string;
  photoUri?: string;
  /** En un gasto de una línea: el monto en la moneda elegida. */
  amount?: number;
  currency?: 'UYU' | 'USD';
  category?: Category;
  subcategory?: string;
  /** En un ticket con productos: las líneas con las categorías corregidas. */
  lines?: Line[];
}

/** Los gastos de la persona (de la app y de WhatsApp) y la cola de lo que falta subir. */
export const useGastosStore = defineStore('gastos', () => {
  const tickets = ref<Ticket[]>([]);
  /** Lo aprendido de cada puesto sin QR, por clave normalizada del nombre. */
  const vendors = ref<Record<string, VendorRules>>({});
  const loaded = ref(false);
  /** Lo borrado en el teléfono que falta borrar en el servidor. */
  const deletions = ref<Deletion[]>([]);
  const month = ref(monthKey(todayIso()));

  const sorted = computed(() =>
    [...tickets.value].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)),
  );
  /** Meses con al menos un gasto, del más nuevo al más viejo. */
  const months = computed(() => [...new Set(sorted.value.map((t) => monthKey(t.date)))]);
  const monthTickets = computed(() => sorted.value.filter((t) => monthKey(t.date) === month.value));
  const todayTickets = computed(() => sorted.value.filter((t) => t.date === todayIso()));
  /** Lo que sube en la próxima sincronización. */
  const pending = computed(() => pendingToUpload(tickets.value));
  /** Lo que no sube hasta que la persona lo corrija. */
  const toReview = computed(() => needsReview(sorted.value));
  const knownVendors = computed(() => Object.values(vendors.value).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));

  async function persist() {
    await gastosDb.save(tickets.value);
  }

  /** Carga lo guardado; la primera vez, los datos de ejemplo. */
  async function init() {
    if (loaded.value) return;
    const [stored, learned, borrados] = await Promise.all([gastosDb.load(), puestosDb.load(), borradosDb.load()]);
    tickets.value = stored ?? seedTickets();
    vendors.value = learned ?? {};
    deletions.value = borrados ?? [];
    if (!stored) await persist();
    loaded.value = true;
  }

  function byId(id: string): Ticket | undefined {
    return tickets.value.find((t) => t.id === id);
  }

  function findByCfe(h: Pick<CfeHeader, 'rut' | 'cfeType' | 'serie' | 'number'>): Ticket | undefined {
    const key = cfeKey(h);
    return tickets.value.find((t) => t.cfe && cfeKey(t.cfe) === key);
  }

  /** El comercio de un RUT: de la tabla de comercios conocidos o de un ticket anterior con el mismo RUT. */
  function storeNameFor(rut: string): { name: string; category: Category } | undefined {
    const known = KNOWN_STORES[rut];
    if (known) return known;
    const previous = sorted.value.find((t) => t.cfe?.rut === rut && !t.store.startsWith('Comercio RUT'));
    return previous ? { name: previous.store, category: mainCategory(previous) } : undefined;
  }

  async function add(ticket: NewTicket): Promise<Ticket> {
    const [t] = await addAll([ticket]);
    return t;
  }

  /** Guarda de una vez lo que se armó en la pantalla de registrar (la carga). */
  async function addAll(news: NewTicket[]): Promise<Ticket[]> {
    const now = new Date().toISOString();
    // Lo que llega sin cuenta (dictado, Siri, el reloj, un ticket leído) toma la de su medio de pago
    const { accounts } = useFinanzasStore();
    const withAccounts = assignAccounts(news, accounts, lastAccountId(tickets.value, accounts));
    const saved = withAccounts.map((n): Ticket => ({ ...n, id: newId(), sync: { state: 'pendiente' }, createdAt: now }));
    if (!saved.length) return saved;
    tickets.value.push(...saved);
    month.value = monthKey(saved[saved.length - 1].date);
    await persist();
    return saved;
  }

  /**
   * Una frase que llega sin pasar por la pantalla (lo anotado con Siri o con el reloj): se guarda como se entiende,
   * igual que en la pantalla de Voz. Si no tiene monto, queda para revisar con la frase como nombre.
   */
  async function addFromPhrase(phrase: string, source: 'voz' | 'texto', today: IsoDate = todayIso(), category?: string): Promise<Ticket[]> {
    const entries = parseQuickEntries(phrase, today);
    // La categoría elegida en el reloj gana sobre la entendida
    if (category && (CATEGORIES as readonly string[]).includes(category)) {
      const chosen = category as Category;
      entries.items = entries.items.map((i) => (i.category === chosen ? i : { ...i, category: chosen, subcategory: SUBCATEGORIES[chosen][0] ?? 'Varios' }));
    }
    const payment = entries.payment ?? sorted.value[0]?.payment ?? 'Efectivo';
    if (!entries.items.length) {
      return [await add({ source, store: phrase.trim() || 'Gasto', date: entries.date ?? today, payment, phrase, lines: [], discounts: [], review: 'No encontramos el monto' })];
    }
    return addAll(phraseDrafts(phrase, entries, { source, payment, date: today, newId }).map((d) => d.ticket));
  }

  /** Cambiar algo ya subido lo vuelve a dejar pendiente, para que el cambio llegue a la cuenta. */
  function touched(t: Ticket): Ticket['sync'] {
    return t.sync.state === 'subido' ? { ...t.sync, state: 'pendiente' } : t.sync;
  }

  /**
   * Guarda lo cambiado en "Editar gasto". El monto, la moneda y la categoría solo se tocan en un gasto de una línea
   * (o sin líneas, el que esperaba el monto, que así sale de "para revisar"); en un ticket con productos se pasan
   * sus `lines` con las categorías corregidas.
   */
  async function edit(id: string, e: TicketEdit) {
    const t = byId(id);
    if (!t) return;
    t.store = e.store.trim() || t.store;
    t.date = e.date;
    t.payment = e.payment;
    if (e.accountId) t.accountId = e.accountId;
    if (e.kind) t.kind = e.kind;
    else delete t.kind;
    if (e.note?.trim()) t.note = e.note.trim();
    else delete t.note;
    if (e.photoUri) t.photoUri = e.photoUri;
    if (e.lines && t.lines.length > 1) t.lines = e.lines;
    if (e.amount !== undefined && e.amount > 0 && t.lines.length <= 1) {
      const rate = t.usd?.rate ?? USD_RATE;
      const base: Line = t.lines[0] ?? { raw: t.store, pretty: t.store, category: 'Otros', subcategory: 'Varios', amount: 0 };
      const category = e.category ? { category: e.category, subcategory: e.subcategory ?? SUBCATEGORIES[e.category][0] } : {};
      t.lines = [{ ...base, pretty: t.store, amount: e.currency === 'USD' ? round2(e.amount * rate) : e.amount, ...category }];
      if (e.currency === 'USD') t.usd = { amount: e.amount, rate };
      else delete t.usd;
      delete t.review;
    }
    t.sync = touched(t);
    await persist();
  }

  /**
   * Importa un extracto bancario: registra los movimientos nuevos y vincula los que ya estaban anotados, que
   * quedan en la cuenta del extracto. Un vinculado cambia, así que vuelve a subir.
   */
  async function importStatement(news: NewTicket[], links: StatementLink[]): Promise<{ added: Ticket[]; linked: number }> {
    let linked = 0;
    for (const l of links) {
      const t = byId(l.id);
      if (!t || t.bank) continue;
      t.bank = l.bank;
      t.accountId = l.accountId;
      t.payment = l.payment;
      if (l.amount !== undefined && t.lines.length === 1) t.lines = [{ ...t.lines[0], amount: l.amount }];
      t.sync = touched(t);
      linked++;
    }
    const added = await addAll(news);
    if (linked && !added.length) await persist();
    return { added, linked };
  }

  /**
   * Borra uno o varios movimientos del teléfono. Quedan anotados para borrarlos también del servidor en la
   * próxima sincronización; si no, el servidor los devolvería al traer lo de la cuenta.
   */
  async function remove(ids: string | string[]) {
    const gone = new Set(Array.isArray(ids) ? ids : [ids]);
    const removed = tickets.value.filter((t) => gone.has(t.id));
    if (!removed.length) return;
    tickets.value = tickets.value.filter((t) => !gone.has(t.id));
    deletions.value = [...deletions.value, ...deletionsFor(removed)];
    await Promise.all([persist(), borradosDb.save(deletions.value)]);
  }

  /** El servidor ya borró estos: dejan de estar pendientes. */
  async function deletionsSynced(done: Deletion[]) {
    const ids = new Set(done.map((d) => d.clientId));
    deletions.value = deletions.value.filter((d) => !ids.has(d.clientId));
    await borradosDb.save(deletions.value);
  }

  /** Junta lo que devolvió el servidor (lo subido y lo registrado por WhatsApp) sin duplicar ni revivir lo borrado. */
  async function applyRemote(remote: RemoteExpense[]) {
    tickets.value = mergeRemote(tickets.value, remote, new Date().toISOString(), deletions.value);
    await persist();
  }

  function vendorRules(name: string): VendorRules | undefined {
    const key = vendorKey(name);
    return key ? vendors.value[key] : undefined;
  }

  /** Aprende de un ticket de papel confirmado: lo que leyó el modelo contra lo que la persona guardó. */
  async function learnVendor(vendorName: string, read: ReadItem[], saved: PaperItem[]) {
    const key = vendorKey(vendorName);
    if (!key) return;
    vendors.value = { ...vendors.value, [key]: learnFromTicket(vendors.value[key], { vendorName, read, saved, at: new Date().toISOString() }) };
    await puestosDb.save(vendors.value);
  }

  async function resetDemo() {
    tickets.value = seedTickets();
    vendors.value = {};
    deletions.value = [];
    month.value = monthKey(todayIso());
    await Promise.all([persist(), puestosDb.save({}), borradosDb.clear()]);
  }

  return {
    tickets, vendors, loaded, month, sorted, months, monthTickets, todayTickets, pending, toReview, knownVendors,
    init, byId, findByCfe, storeNameFor, addAll, addFromPhrase, edit, remove, importStatement,
    applyRemote, vendorRules, learnVendor, resetDemo, deletions, deletionsSynced,
  };
});
