import { type Account, accountOf } from './accounts';
import { categoryLabel, SOURCE_LABEL, SUBCATEGORIES } from './categories';
import { cfeKey } from './cfe';
import { formatPesos, formatUsd, parseAmount, round2, USD_RATE } from './money';
import { normalize } from './products';
import type { QuickEntries } from './quickEntry';
import { mainCategory, QR_TOLERANCE, ticketTotals } from './totals';
import type { Category, CfeHeader, Discount, IsoDate, Line, NewTicket, PaymentMethod, Ticket } from './types';

/**
 * La carga: los gastos armados en la pantalla de registrar que todavía no se guardaron.
 * Nada se registra hasta tocar Guardar; entonces cada borrador pasa a ser un gasto.
 */
export interface Draft {
  id: string;
  /** Cómo se ve en la carga: "Café", "Feria", "Almacén La Esquina". */
  title: string;
  ticket: NewTicket;
  /** Vino de un chip "Sumar" (los gastos de siempre). */
  suggested?: boolean;
}

export type Currency = 'UYU' | 'USD';

/**
 * La grilla de categorías del teclado: las del día a día (los servicios son gastos fijos, van en Facturas).
 * Delivery y Salidas son la misma categoría ("Delivery y salidas") con distinta subcategoría; el nombre de cada
 * celda es el de `categoryLabel`.
 */
export const KEYPAD_CATEGORIES: { label: string; category: Category; subcategory: string }[] = [
  { label: 'Supermercado', category: 'Supermercado', subcategory: 'Almacén' },
  { label: 'Delivery', category: 'Delivery y salidas', subcategory: 'Delivery' },
  { label: 'Transporte', category: 'Transporte', subcategory: 'Ómnibus' },
  { label: 'Salidas', category: 'Delivery y salidas', subcategory: 'Restorán' },
  { label: 'Salud', category: 'Salud', subcategory: 'Farmacia' },
  { label: 'Otros', category: 'Otros', subcategory: 'Varios' },
];

/**
 * La subcategoría al tocar una celda: la entendida de la descripción si es de esa categoría
 * ("café" → Bar y café dentro de Salidas), si no la de la celda.
 */
export function keypadSubcategory(cell: { category: Category; subcategory: string; label: string }, inferred?: { category: Category; subcategory: string }): string {
  if (inferred && inferred.category === cell.category && categoryLabel(inferred.category, inferred.subcategory) === cell.label) return inferred.subcategory;
  return SUBCATEGORIES[cell.category].includes(cell.subcategory) ? cell.subcategory : SUBCATEGORIES[cell.category][0];
}

/** Una tecla del teclado numérico sobre el monto escrito ("1234,5"): cifras, coma decimal y borrar. */
export function pressKey(text: string, key: string): string {
  if (key === 'del') return text.slice(0, -1);
  if (key === ',') return text.includes(',') ? text : `${text || '0'},`;
  if (!/^\d$/.test(key)) return text;
  const [int, dec] = text.split(',');
  if (dec !== undefined) return dec.length < 2 ? text + key : text;
  if (int.length >= 7) return text;
  return int === '0' ? key : text + key;
}

/** El monto del teclado como se ve: "12345,5" → "12.345,5"; vacío → "0". */
export function keypadDisplay(text: string): string {
  if (!text) return '0';
  const [int, dec] = text.split(',');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === undefined ? grouped : `${grouped},${dec}`;
}

/** El monto del teclado como número; 0 si no hay. */
export function keypadAmount(text: string): number {
  const n = parseAmount(text.replace(/,$/, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Un gasto escrito con el teclado. */
export interface KeypadExpense {
  amount: number;
  currency: Currency;
  description: string;
  category: Category;
  subcategory: string;
  payment: PaymentMethod;
  /** La cuenta elegida; `payment` es su tipo. */
  accountId?: string;
  date: IsoDate;
}

export function keypadDraft(e: KeypadExpense, id: string, rate = USD_RATE): Draft {
  const description = e.description.trim();
  const title = description ? description.charAt(0).toUpperCase() + description.slice(1) : categoryLabel(e.category, e.subcategory);
  const usd = e.currency === 'USD';
  return {
    id,
    title,
    ticket: {
      source: 'texto',
      store: title,
      date: e.date,
      payment: e.payment,
      lines: [{ raw: description || title, pretty: title, category: e.category, subcategory: e.subcategory, amount: usd ? round2(e.amount * rate) : e.amount }],
      discounts: [],
      ...(usd ? { usd: { amount: e.amount, rate } } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    },
  };
}

/**
 * Lo entendido de una frase (dictada o escrita como en WhatsApp) como gastos de la carga:
 * los artículos de una misma compra van juntos en un gasto con una línea cada uno, y lo demás
 * (el ómnibus, el almuerzo) va aparte. El medio de pago dicho para todo gana sobre `payment`.
 */
export function phraseDrafts(
  phrase: string,
  entries: QuickEntries,
  opts: { source: 'voz' | 'texto'; payment: PaymentMethod; date: IsoDate; newId: () => string },
): Draft[] {
  const payment = entries.payment ?? opts.payment;
  const date = entries.date ?? opts.date;
  const base = { source: opts.source, date, discounts: [] as Discount[], ...(phrase.trim() ? { phrase: phrase.trim() } : {}) };
  const purchase = entries.together ? entries.items.filter((i) => !i.apart) : [];
  const apart = entries.together ? entries.items.filter((i) => i.apart) : entries.items;
  const drafts: Draft[] = [];
  if (purchase.length) {
    const title = entries.store || purchase[0].name || 'Compra';
    drafts.push({
      id: opts.newId(),
      title,
      ticket: {
        ...base,
        store: title,
        payment,
        lines: purchase.map((i) => {
          const name = i.name || 'Artículo';
          return { raw: name, pretty: name, category: i.category, subcategory: i.subcategory, amount: i.amount };
        }),
      },
    });
  }
  for (const it of apart) {
    const title = it.place ?? (it.name || categoryLabel(it.category, it.subcategory));
    drafts.push({
      id: opts.newId(),
      title,
      ticket: {
        ...base,
        store: title,
        payment: it.payment ?? payment,
        lines: [{ raw: phrase.trim() || title, pretty: title, category: it.category, subcategory: it.subcategory, amount: it.amount }],
      },
    });
  }
  return drafts;
}

/** Una compra de varios artículos, separada en un gasto por artículo. */
export function splitPurchase(d: Draft, newId: () => string): Draft[] {
  if (d.ticket.lines.length < 2) return [d];
  return d.ticket.lines.map((l) => ({ id: newId(), title: l.pretty, ticket: { ...d.ticket, store: l.pretty, lines: [{ ...l }] } }));
}

/** Lo que suma un borrador: en pesos, o en dólares si se pagó en dólares. */
export function draftAmount(d: Draft): { currency: Currency; amount: number } {
  if (d.ticket.usd) return { currency: 'USD', amount: d.ticket.usd.amount };
  return { currency: 'UYU', amount: ticketTotals(d.ticket).net };
}

export function draftAmountText(d: Draft): string {
  const { currency, amount } = draftAmount(d);
  return currency === 'USD' ? formatUsd(amount) : formatPesos(amount);
}

/** De dónde salió, en "Tu carga": "Voz", "Teclado", "QR DGI", "Foto" o "Sugerencia". */
export function draftOrigin(d: Draft): string {
  return d.suggested ? 'Sugerencia' : SOURCE_LABEL[d.ticket.source];
}

/**
 * "Salidas · BROU débito"; en una compra, "Supermercado · 3 productos · Efectivo" (o sin la categoría si mezcla
 * varias). Con las cuentas se muestra la del gasto; sin ellas, el medio de pago.
 */
export function draftSubtitle(d: Draft, accounts?: Account[]): string {
  const t = d.ticket;
  const from = (accounts && accountOf(t, accounts)?.name) ?? t.payment;
  if (t.lines.length < 2) return `${categoryLabel(mainCategory(t), t.lines[0]?.subcategory)} · ${from}`;
  const categories = new Set(t.lines.map((l) => l.category));
  const what = categories.size === 1 ? `${categoryLabel(t.lines[0].category, t.lines[0].subcategory)} · ` : '';
  return `${what}${t.lines.length} productos · ${from}`;
}

/** El total de la carga: "$ 1.012", o "$ 1.012 + USD 20" si hay gastos en dólares. */
export function cartTotal(drafts: Draft[]): string {
  let pesos = 0;
  let usd = 0;
  for (const d of drafts) {
    const a = draftAmount(d);
    if (a.currency === 'USD') usd += a.amount;
    else pesos += a.amount;
  }
  const parts = [];
  if (pesos || !usd) parts.push(formatPesos(round2(pesos)));
  if (usd) parts.push(formatUsd(round2(usd)));
  return parts.join(' + ');
}

/** Para reconocer el mismo gasto dicho dos veces: nombre y monto. */
function sameExpense(a: Draft, b: Draft): boolean {
  if (a.ticket.cfe && b.ticket.cfe) return cfeKey(a.ticket.cfe) === cfeKey(b.ticket.cfe);
  const x = draftAmount(a);
  const y = draftAmount(b);
  return normalize(a.title) === normalize(b.title) && x.currency === y.currency && Math.abs(x.amount - y.amount) < 0.005;
}

/**
 * Separa lo nuevo de lo que ya está en la carga: un "52 de ómnibus" dicho otra vez no se agrega solo,
 * se pregunta ("¿Es otro viaje?").
 */
export function splitDuplicates(fresh: Draft[], cart: Draft[]): { added: Draft[]; duplicates: Draft[] } {
  const added: Draft[] = [];
  const duplicates: Draft[] = [];
  for (const d of fresh) {
    if (cart.some((c) => sameExpense(c, d))) duplicates.push(d);
    else added.push(d);
  }
  return { added, duplicates };
}

/** Un gasto que se repite, para sumarlo a la carga de un toque ("+ Ómnibus $ 52"). */
export interface FrequentExpense {
  title: string;
  amount: number;
  category: Category;
  subcategory: string;
  payment: PaymentMethod;
}

/**
 * Los gastos sueltos de siempre (mismo nombre y monto), los que más se repiten primero y,
 * entre los que se repiten igual, los más recientes. No cuenta compras de varios artículos,
 * tickets con QR o en papel, ni gastos en dólares o para revisar.
 */
export function frequentExpenses(tickets: Ticket[], limit = 6): FrequentExpense[] {
  const seen = new Map<string, { item: FrequentExpense; count: number; last: string }>();
  for (const t of tickets) {
    if (t.lines.length !== 1 || t.usd || t.review || t.kind || t.source === 'qr' || t.source === 'papel') continue;
    const [line] = t.lines;
    if (!(line.amount > 0)) continue;
    const key = `${normalize(t.store)}|${line.amount}`;
    const when = `${t.date}|${t.createdAt}`;
    const prev = seen.get(key);
    const item = { title: t.store, amount: line.amount, category: line.category, subcategory: line.subcategory, payment: t.payment };
    if (!prev) seen.set(key, { item, count: 1, last: when });
    else seen.set(key, { item: when > prev.last ? item : prev.item, count: prev.count + 1, last: when > prev.last ? when : prev.last });
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
    .slice(0, limit)
    .map((x) => x.item);
}

export function frequentDraft(f: FrequentExpense, date: IsoDate, id: string): Draft {
  return {
    id,
    suggested: true,
    title: f.title,
    ticket: {
      source: 'texto',
      store: f.title,
      date,
      payment: f.payment,
      lines: [{ raw: f.title, pretty: f.title, category: f.category, subcategory: f.subcategory, amount: f.amount }],
      discounts: [],
    },
  };
}

/** Un ticket con QR de la DGI, confirmado en su pantalla. */
export function qrDraft(
  header: CfeHeader,
  input: { store: string; payment: PaymentMethod; accountId?: string; lines: Line[]; discounts: Discount[]; photoUri?: string },
  id: string,
): Draft {
  return {
    id,
    title: input.store,
    ticket: {
      source: 'qr',
      store: input.store,
      date: header.date,
      payment: input.payment,
      lines: input.lines,
      discounts: input.discounts,
      cfe: header,
      ...(input.photoUri ? { photoUri: input.photoUri } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
    },
  };
}

/** Un producto leído de la foto de un ticket, ya con su categoría. */
export interface PaperRow {
  key: number;
  name: string;
  /** Lo escrito en el papel, para aprender del puesto. */
  written?: string;
  amount: number;
  category: Category;
  subcategory: string;
  /** El lector no estaba seguro del monto y la persona todavía no lo confirmó. */
  doubtful?: boolean;
}

/** Los productos agrupados por categoría, en el orden en que aparece cada una. */
export function paperGroups(rows: PaperRow[]): { category: Category; total: number; rows: PaperRow[] }[] {
  const groups: { category: Category; total: number; rows: PaperRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.category === r.category);
    if (!g) groups.push((g = { category: r.category, total: 0, rows: [] }));
    g.rows.push(r);
    g.total = round2(g.total + r.amount);
  }
  return groups;
}

function paperLine(r: PaperRow): Line {
  const name = r.name.trim() || 'Producto sin nombre';
  return { raw: r.written?.trim() || name, pretty: name, category: r.category, subcategory: r.subcategory, amount: r.amount };
}

/**
 * Lo que agrega a la carga un ticket sacado con foto: un gasto con todos sus productos o uno por categoría.
 * Con QR siempre es uno solo (el comprobante es uno); si los productos suman más que el total del QR,
 * la diferencia queda como descuento del ticket.
 */
export function paperDrafts(input: {
  store: string;
  date: IsoDate;
  payment: PaymentMethod;
  accountId?: string;
  rows: PaperRow[];
  writtenTotal?: number;
  photoUri?: string;
  qr?: CfeHeader;
  byCategory: boolean;
  newId: () => string;
}): Draft[] {
  const rows = input.rows.filter((r) => r.amount > 0);
  const store = input.store.trim() || 'Ticket en papel';
  const photo = input.photoUri ? { photoUri: input.photoUri } : {};
  if (input.qr) {
    const lines = rows.map(paperLine);
    const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
    const extra = round2(sum - input.qr.total);
    const discounts: Discount[] = extra > QR_TOLERANCE ? [{ label: 'Descuentos del ticket', kind: 'otro', amount: extra }] : [];
    return [qrDraft(input.qr, { store, payment: input.payment, accountId: input.accountId, lines, discounts, ...photo }, input.newId())];
  }
  const base = { source: 'papel' as const, store, date: input.date, payment: input.payment, discounts: [], ...photo, ...(input.accountId ? { accountId: input.accountId } : {}) };
  if (!rows.length) {
    const total = input.writtenTotal;
    if (!total || total <= 0) return [];
    return [{ id: input.newId(), title: store, ticket: { ...base, lines: [{ raw: store, pretty: store, category: 'Otros', subcategory: 'Varios', amount: total }], writtenTotal: total } }];
  }
  const groups = paperGroups(rows);
  if (!input.byCategory || groups.length < 2) {
    return [{ id: input.newId(), title: store, ticket: { ...base, lines: rows.map(paperLine), ...(input.writtenTotal ? { writtenTotal: input.writtenTotal } : {}) } }];
  }
  return groups.map((g) => ({ id: input.newId(), title: store, ticket: { ...base, lines: g.rows.map(paperLine) } }));
}
