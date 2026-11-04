import type { Account } from './accounts';
import { daysBetween } from './dates';
import { parseAmount, round2, USD_RATE } from './money';
import { normalize } from './products';
import { productCategory } from './quickEntry';
import { isIncome, mainCategory, QR_TOLERANCE, ticketTotals } from './totals';
import type { BankRef, Category, IsoDate, NewTicket, PaymentMethod, Ticket } from './types';
import { vendorKey } from './vendors';

/*
 * Extractos bancarios: el CSV que se baja de la web o la app del banco. Cada banco arma el suyo distinto,
 * así que las columnas se adivinan por el encabezado (o por los datos, si no tiene) y la persona las puede
 * corregir. Todo se lee en el teléfono.
 */

/** Los bancos exportan en UTF-8 o en Latin-1 (Windows-1252): si no es UTF-8 válido, se lee como Latin-1. */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Un Excel de verdad (.xlsx o .xls binario) no se puede leer: hay que guardarlo como CSV. */
export function looksLikeSpreadsheet(text: string): boolean {
  return text.startsWith('PK') || text.slice(0, 2000).includes('\u0000') || /^�{2,}|^ÐÏ/.test(text);
}

const CANDIDATES = [';', '\t', ','];

/** Cuántas veces aparece `ch` en la línea fuera de comillas. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

/**
 * El separador del CSV. Con la coma decimal, los bancos de acá separan con punto y coma, así que se prueba
 * primero `;`, después el tabulador y al final la coma.
 */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => CANDIDATES.some((c) => l.includes(c))).slice(0, 30);
  for (const c of CANDIDATES.slice(0, 2)) {
    if (lines.length && lines.filter((l) => countOutsideQuotes(l, c) > 0).length >= lines.length * 0.6) return c;
  }
  return ',';
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
};

function htmlText(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Algunos bancos bajan una tabla HTML con extensión .xls: se leen sus filas igual que las de un CSV. */
function parseHtmlTable(text: string): string[][] {
  return text
    .split(/<tr[\s>]/i)
    .slice(1)
    .map((tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => htmlText(m[1])));
}

/** Separa el archivo en filas y celdas: detecta el separador, respeta las comillas y descarta las filas vacías. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  if (/<table[\s>]/i.test(clean.slice(0, 5000))) return parseHtmlTable(clean).filter((r) => r.some((c) => c !== ''));
  const delimiter = detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell.trim()]);
  return rows.filter((r) => r.some((c) => c !== ''));
}

const MONTHS: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12 };

function iso(y: number, m: number, d: number): IsoDate | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Fechas como las escriben los bancos: "12/10/2026", "12-10-26", "2026-10-12", "12 oct 2026", con o sin hora. */
export function parseBankDate(s: string): IsoDate | undefined {
  const t = normalize(s.trim());
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s/-]([a-z]{3})[a-z]*\.?[\s/-](\d{4}|\d{2})(?!\d)/.exec(t);
  if (m && MONTHS[m[2]]) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), MONTHS[m[2]], Number(m[1]));
  return undefined;
}

/**
 * Montos como los escriben los bancos: "1.200,50", "-1200.50", "(1.200,50)" o "1.200,50-" (negativos),
 * "$ 450", "U$S 25". Una celda vacía da NaN.
 */
export function parseBankAmount(s: string): number {
  let t = s.replace(/u\$s|us\$|usd|uyu|\$|\s| /gi, '').replace('−', '-');
  if (!t) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    negative = !negative;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  const n = parseAmount(t);
  if (Number.isNaN(n)) return NaN;
  return negative ? -n : n;
}

/** Qué columna del archivo es cada cosa (posiciones desde 0). */
export interface StatementColumns {
  date: number;
  description: number;
  /** Una sola columna con el monto, con signo. */
  amount?: number;
  /** O dos: lo que salió y lo que entró. */
  debit?: number;
  credit?: number;
  /** Una columna aparte con los montos en dólares (los resúmenes de tarjeta traen pesos y dólares). */
  usd?: number;
  /** Una columna con la moneda de cada movimiento. */
  currency?: number;
}

export interface StatementLayout {
  /** La fila del encabezado; -1 si el archivo no tiene. */
  headerRow: number;
  columns: StatementColumns;
  /** Con una sola columna de monto: los gastos vienen en positivo (como en un resumen de tarjeta). */
  expensesPositive: boolean;
}

const HEADER = {
  date: /^(fecha|fec|dia|date)\b|\bfecha\b/,
  description: [/descripcion|concepto|detalle|leyenda/, /comercio|establecimiento|movimiento|description/, /referencia|observaciones/],
  debit: /debito|\bdebe\b|cargo|egreso|retiro|salida/,
  credit: /credito|\bhaber\b|abono|ingreso|deposito|entrada/,
  amount: /importe|monto|valor|amount|^\$$|pesos|u\$s|usd|us\$|dolares/,
  usd: /u\$s|usd|us\$|dolares/,
  currency: /^(moneda|mon\.?|divisa|currency)$/,
  balance: /saldo|balance/,
};

function findHeader(cells: string[]): StatementColumns | undefined {
  const h = cells.map((c) => normalize(c).trim());
  const dates = h.map((c, i) => (HEADER.date.test(c) ? i : -1)).filter((i) => i >= 0);
  // "Fecha valor" es cuándo se acreditó: se prefiere la fecha del movimiento
  const date = dates.find((i) => !h[i].includes('valor')) ?? dates[0];
  if (date === undefined) return undefined;
  const free = (i: number) => i !== date && !dates.includes(i) && !HEADER.balance.test(h[i]) && h[i] !== '';
  const pick = (re: RegExp, except: number[] = []) => {
    const i = h.findIndex((c, j) => free(j) && !except.includes(j) && re.test(c));
    return i >= 0 ? i : undefined;
  };
  const currency = pick(HEADER.currency);
  let debit = pick(HEADER.debit, currency !== undefined ? [currency] : []);
  let credit = pick(HEADER.credit, [debit ?? -1, currency ?? -1]);
  const taken = [debit ?? -1, credit ?? -1, currency ?? -1];
  const amounts = h.map((c, i) => (free(i) && !taken.includes(i) && HEADER.amount.test(c) ? i : -1)).filter((i) => i >= 0);
  const usd = amounts.length > 1 ? amounts.find((i) => HEADER.usd.test(h[i])) : undefined;
  let amount = amounts.find((i) => i !== usd);
  if (amount === undefined && debit === undefined && credit === undefined) return undefined;
  // Una sola columna "Débitos/Créditos": es un monto con signo
  if (amount === undefined && (debit === undefined) !== (credit === undefined)) {
    amount = debit ?? credit;
    debit = credit = undefined;
  }
  let description: number | undefined;
  for (const re of HEADER.description) {
    description = pick(re, [...taken, ...amounts]);
    if (description !== undefined) break;
  }
  // Sin una columna con nombre de descripción: la primera de texto que quede libre
  description ??= h.findIndex((_, i) => free(i) && ![...taken, ...amounts].includes(i));
  if (description < 0) return undefined;
  return { date, description, amount, debit, credit, usd, currency };
}

const isAmountCell = (c: string) => c !== '' && !Number.isNaN(parseBankAmount(c)) && !parseBankDate(c);

/** Sin encabezado: la fecha es la primera columna con fechas, el monto la primera con números y la descripción la de más texto. */
function guessFromData(rows: string[][]): StatementColumns | undefined {
  const data = rows.filter((r) => r.some((c) => parseBankDate(c))).slice(0, 30);
  if (!data.length) return undefined;
  const width = Math.max(...data.map((r) => r.length));
  const share = (test: (c: string) => boolean, i: number) => data.filter((r) => test(r[i] ?? '')).length / data.length;
  const cols = [...Array(width).keys()];
  const date = cols.find((i) => share((c) => !!parseBankDate(c), i) >= 0.8);
  if (date === undefined) return undefined;
  const numeric = cols.filter((i) => i !== date && share(isAmountCell, i) >= 0.5);
  const text = cols
    .filter((i) => i !== date && !numeric.includes(i))
    .sort((a, b) => data.reduce((s, r) => s + (r[b]?.length ?? 0), 0) - data.reduce((s, r) => s + (r[a]?.length ?? 0), 0));
  if (!numeric.length || !text.length) return undefined;
  return { date, description: text[0], amount: numeric[0] };
}

/**
 * Adivina dónde está cada cosa: busca el encabezado en las primeras filas (los bancos ponen antes los
 * datos de la cuenta) y, si no hay, mira los datos. `credit` es una cuenta de tarjeta de crédito: con una
 * sola columna de monto, sus compras vienen en positivo.
 */
export function detectLayout(rows: string[][], credit = false): StatementLayout | undefined {
  let headerRow = -1;
  let columns: StatementColumns | undefined;
  for (let i = 0; i < Math.min(rows.length, 40) && !columns; i++) {
    columns = findHeader(rows[i]);
    if (columns) headerRow = i;
  }
  columns ??= guessFromData(rows);
  if (!columns) return undefined;
  const layout: StatementLayout = { headerRow, columns, expensesPositive: false };
  const col = columns.amount;
  if (col !== undefined) {
    // Una lista sin ningún negativo es una lista de compras; un resumen de tarjeta también
    const amounts = rows.slice(headerRow + 1).map((r) => parseBankAmount(r[col] ?? '')).filter((n) => !Number.isNaN(n));
    layout.expensesPositive = credit || (amounts.length > 0 && !amounts.some((n) => n < 0));
  }
  return layout;
}

/** Un movimiento del extracto. */
export interface StatementRow {
  /** Fila en el archivo, para mantener el orden. */
  line: number;
  date: IsoDate;
  /** Lo que dice el banco, tal cual. */
  text: string;
  /** Siempre positivo, en la moneda del movimiento. */
  amount: number;
  income: boolean;
  currency: 'UYU' | 'USD';
}

const SUMMARY_ROW = /^(saldo|total|subtotal)\b/;

/** Lee los movimientos con las columnas elegidas. `skipped` cuenta las filas con datos que no se pudieron leer. */
export function readRows(rows: string[][], layout: StatementLayout): { rows: StatementRow[]; skipped: number } {
  const { columns: c, headerRow, expensesPositive } = layout;
  const out: StatementRow[] = [];
  let skipped = 0;
  rows.forEach((r, line) => {
    if (line <= headerRow) return;
    const cell = (i?: number) => (i === undefined ? '' : (r[i] ?? '').trim());
    const text = cell(c.description).replace(/\s+/g, ' ');
    if (SUMMARY_ROW.test(normalize(text)) || SUMMARY_ROW.test(normalize(cell(c.date)))) return;
    const date = parseBankDate(cell(c.date));
    let signed = NaN;
    let currency: StatementRow['currency'] = 'UYU';
    if (c.debit !== undefined || c.credit !== undefined) {
      const out = Math.abs(parseBankAmount(cell(c.debit)));
      const into = Math.abs(parseBankAmount(cell(c.credit)));
      if (out > 0) signed = -out;
      else if (into > 0) signed = into;
    } else {
      signed = parseBankAmount(cell(c.amount));
      if (expensesPositive) signed = -signed;
    }
    if ((Number.isNaN(signed) || signed === 0) && c.usd !== undefined) {
      signed = parseBankAmount(cell(c.usd));
      if (expensesPositive && c.debit === undefined) signed = -signed;
      currency = 'USD';
    }
    if (c.currency !== undefined && /u\$s|usd|us\$|dolar/.test(normalize(cell(c.currency)))) currency = 'USD';
    if (!date || Number.isNaN(signed)) {
      // Una fila con algo que parece un movimiento (fecha o monto) y no se pudo leer entera
      if (date || r.some(isAmountCell)) skipped++;
      return;
    }
    if (signed === 0) return;
    out.push({ line, date, text: text || 'Movimiento', amount: round2(Math.abs(signed)), income: signed > 0, currency });
  });
  return { rows: out, skipped };
}

/** Los nombres de las columnas, para elegirlas: los del encabezado o "Columna 3" con un ejemplo. */
export function columnNames(rows: string[][], layout: Pick<StatementLayout, 'headerRow'>): string[] {
  const sample = rows.slice(layout.headerRow + 1).find((r) => r.some((c) => parseBankDate(c))) ?? [];
  const width = Math.max(rows[layout.headerRow]?.length ?? 0, sample.length);
  return [...Array(width).keys()].map((i) => {
    const name = layout.headerRow >= 0 ? rows[layout.headerRow][i] : '';
    const example = sample[i] ? ` (${sample[i].length > 18 ? `${sample[i].slice(0, 18)}…` : sample[i]})` : '';
    return name || `Columna ${i + 1}${example}`;
  });
}

/** Lo que el banco agrega alrededor del comercio: "COMPRA CON TARJETA DE DÉBITO", el número de tarjeta, la ciudad. */
const BANK_NOISE = [
  /\b(compra|cpra)s?\s+(con\s+)?(tarjeta|tarj|tc|td)?\s*(de\s+)?(d[eé]bito|cr[eé]dito|deb|cred)?\b/g,
  /\b(d[eé]bito|deb\.?)\s+(autom[aá]tico|aut\.?)\b/g,
  /\bpago\s+(de\s+)?servicios?\b/g,
  /\b(pos|redpagos|abitab|web|online|internet|ecommerce)\b/g,
  /\b(montevideo|mvd|mdeo|uruguay|ury|uy)\b/g,
  /\b(x{2,}|\*{2,})\d+\b/g,
  /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g,
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g,
  /\b[a-z]*\d{4,}[a-z]*\b/g,
  /\bsuc\.?\s*\d*\b/g,
];

const LOWER_WORDS = new Set(['de', 'del', 'la', 'el', 'y', 'en', 'a', 'al', 'los', 'las']);

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** El comercio que se lee en la descripción del banco: "COMPRA CON TARJETA DE DEBITO TATA 123456 MONTEVIDEO" → "Tata". */
export function storeFromBankText(text: string): string {
  let s = text.toLowerCase().replace(/[*_]/g, ' ').replace(/\s+/g, ' ').trim();
  // "MERCADOPAGO*TIENDA" o "PAYU*COMERCIO": lo de después del asterisco es el comercio
  const star = /^(mercadopago|mpago|payu|paypal|dlocal|sq) (.+)$/.exec(s);
  if (star) s = star[2];
  for (const re of BANK_NOISE) s = s.replace(re, ' ');
  const clean = s.replace(/[^\p{L}\p{N}&' .-]/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '');
  return titleCase(clean || text.toLowerCase().replace(/\s+/g, ' ').trim());
}

/**
 * Qué es cada movimiento:
 * - gasto: plata que salió;
 * - ingreso: plata que entró (un sueldo, pero también un pase desde otra cuenta tuya);
 * - pase: un pago de tarjeta o un retiro de efectivo. La plata cambia de cuenta: no es un gasto nuevo.
 */
export type RowKind = 'gasto' | 'ingreso' | 'pase';

const MOVES = /\b(retiro|retiros|cajero|atm|extraccion|su pago|pago (de )?(la |su )?(tarjeta|tarj|resumen)|pago (visa|master|mastercard|oca|amex|american|cabal|creditel|diners|lider|anda|passcard)|pago tc)\b/;

export function rowKind(row: StatementRow): RowKind {
  if (MOVES.test(normalize(row.text))) return 'pase';
  return row.income ? 'ingreso' : 'gasto';
}

/**
 * La marca de cada movimiento, para no importarlo dos veces: la cuenta, la fecha, el monto y el texto.
 * Dos movimientos iguales el mismo día (dos boletos) se distinguen por el orden.
 */
export function rowRefs(rows: StatementRow[], accountId: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${accountId}|${r.date}|${r.income ? '+' : '-'}${r.amount}${r.currency === 'USD' ? 'usd' : ''}|${vendorKey(r.text)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

/** registrar: se agrega como gasto nuevo · vincular: es un gasto ya anotado · omitir: no se toca. */
export type ImportAction = 'registrar' | 'vincular' | 'omitir';

export interface ImportItem {
  row: StatementRow;
  ref: string;
  kind: RowKind;
  /** Ya se importó antes: el id del gasto que tiene esta marca. */
  imported?: string;
  /** El gasto ya anotado que es este movimiento. */
  match?: string;
  action: ImportAction;
  store: string;
  category: Category;
  subcategory: string;
}

/** Días de diferencia que se aceptan entre lo anotado y lo que dice el banco (que a veces lo acredita después). */
export const MATCH_DAYS = 3;

/** El monto de un gasto en la moneda del movimiento del banco. */
function amountIn(t: Ticket, currency: StatementRow['currency']): number | undefined {
  if (currency === 'USD') return t.usd?.amount;
  return t.usd ? undefined : Math.abs(ticketTotals(t).net);
}

/** Qué tan cerca de la cuenta del extracto está un gasto: 0 la misma cuenta, 1 el mismo tipo, 2 otra. */
function accountDistance(t: Ticket, account: Account): number {
  if (t.accountId ? t.accountId === account.id : t.payment === account.payment) return 0;
  return t.payment === account.payment ? 1 : 2;
}

/** La categoría de un comercio: la de un gasto anterior con ese nombre, o la que dicen sus palabras. */
function categoryFor(store: string, tickets: Ticket[]): { category: Category; subcategory: string } {
  const key = vendorKey(store);
  const before = key ? [...tickets].reverse().find((t) => vendorKey(t.store) === key && t.lines.length) : undefined;
  if (before) {
    const category = mainCategory(before);
    return { category, subcategory: before.lines.find((l) => l.category === category)?.subcategory ?? 'Varios' };
  }
  return productCategory(store);
}

/**
 * Arma la importación: qué movimientos ya se importaron, cuáles son gastos que la persona ya anotó (mismo
 * monto, fecha cercana; primero los de esta cuenta) y cuáles son nuevos. Los ingresos y los pases vienen sin
 * marcar: muchas veces son plata que se movió entre las propias cuentas.
 * Los gastos en efectivo no se vinculan solos: un monto chico se repite y casi nunca es el mismo.
 */
export function planImport(rows: StatementRow[], tickets: Ticket[], account: Account): ImportItem[] {
  const refs = rowRefs(rows, account.id);
  const byRef = new Map(tickets.filter((t) => t.bank).map((t) => [t.bank!.ref, t.id]));
  const free = tickets.filter((t) => !t.bank && !t.review && (account.payment === 'Efectivo' || t.payment !== 'Efectivo'));

  // Todas las parejas posibles, de la mejor a la peor; cada gasto y cada movimiento se usan una vez
  const pairs: { row: number; id: string; score: number }[] = [];
  rows.forEach((r, i) => {
    if (byRef.has(refs[i])) return;
    for (const t of free) {
      if (isIncome(t) !== r.income) continue;
      const amount = amountIn(t, r.currency);
      if (amount === undefined || Math.abs(amount - r.amount) > QR_TOLERANCE) continue;
      const days = Math.abs(daysBetween(t.date, r.date));
      if (days > MATCH_DAYS) continue;
      pairs.push({ row: i, id: t.id, score: accountDistance(t, account) * 10 + days });
    }
  });
  pairs.sort((a, b) => a.score - b.score);
  const matched = new Map<number, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (matched.has(p.row) || used.has(p.id)) continue;
    matched.set(p.row, p.id);
    used.add(p.id);
  }

  return rows.map((row, i): ImportItem => {
    const kind = rowKind(row);
    const store = storeFromBankText(row.text);
    const base = { row, ref: refs[i], kind, store, ...categoryFor(store, tickets) };
    const imported = byRef.get(refs[i]);
    if (imported) return { ...base, imported, action: 'omitir' };
    const match = matched.get(i);
    if (match) return { ...base, match, action: 'vincular' };
    return { ...base, action: kind === 'gasto' ? 'registrar' : 'omitir' };
  });
}

/**
 * Los gastos que se pueden elegir a mano para un movimiento: del mismo tipo (gasto o ingreso), todavía sin
 * vincular a otro movimiento, de hasta 10 días antes o después; primero los de monto y fecha más parecidos.
 */
export function linkCandidates(item: ImportItem, items: ImportItem[], tickets: Ticket[], limit = 8): Ticket[] {
  const taken = new Set(items.filter((x) => x !== item && x.match && x.action === 'vincular').map((x) => x.match));
  const distance = (t: Ticket) => {
    const amount = amountIn(t, item.row.currency) ?? Math.abs(ticketTotals(t).net);
    return Math.abs(amount - item.row.amount) / Math.max(item.row.amount, 1) + Math.abs(daysBetween(t.date, item.row.date)) / 10;
  };
  return tickets
    .filter((t) => !t.bank && !taken.has(t.id) && isIncome(t) === item.row.income && Math.abs(daysBetween(t.date, item.row.date)) <= 10)
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, limit);
}

/**
 * El monto que toma un gasto anotado al vincularlo, si el banco cobró otro (una propina, un recargo): solo en un
 * gasto en pesos de una línea y sin descuentos. En uno con productos se deja como está.
 */
export function linkedAmount(t: Ticket, row: StatementRow): number | undefined {
  if (t.lines.length !== 1 || t.discounts.length || t.usd || row.currency !== 'UYU') return undefined;
  return Math.abs(Math.abs(ticketTotals(t).net) - row.amount) > QR_TOLERANCE ? row.amount : undefined;
}

/** Lo que se marca en un gasto ya anotado al vincularlo: queda en la cuenta del extracto, con el monto del banco. */
export interface StatementLink {
  id: string;
  bank: BankRef;
  accountId: string;
  payment: PaymentMethod;
  amount?: number;
}

/** Lo que hay que hacer al confirmar: los gastos nuevos y los ya anotados que se vinculan. */
export function importChanges(items: ImportItem[], account: Account, tickets: Ticket[]): { news: NewTicket[]; links: StatementLink[] } {
  const news: NewTicket[] = [];
  const links: StatementLink[] = [];
  for (const it of items) {
    const bank: BankRef = { ref: it.ref, text: it.row.text };
    const t = it.match ? tickets.find((x) => x.id === it.match) : undefined;
    if (it.action === 'vincular' && t) {
      const amount = linkedAmount(t, it.row);
      links.push({ id: t.id, bank, accountId: account.id, payment: account.payment, ...(amount !== undefined ? { amount } : {}) });
    } else if (it.action === 'registrar') {
      const usd = it.row.currency === 'USD';
      news.push({
        source: 'extracto',
        store: it.store,
        date: it.row.date,
        payment: account.payment,
        accountId: account.id,
        lines: [{ raw: it.row.text, pretty: it.store, category: it.category, subcategory: it.subcategory, amount: usd ? round2(it.row.amount * USD_RATE) : it.row.amount }],
        discounts: [],
        ...(it.row.income ? { kind: 'ingreso' as const } : {}),
        ...(usd ? { usd: { amount: it.row.amount, rate: USD_RATE } } : {}),
        bank,
      });
    }
  }
  return { news, links };
}
