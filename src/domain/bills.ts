import { daysBetween, daysInMonth, dueLabel, monthKey, shiftDay, shiftMonth } from './dates';
import { formatPesos, round2 } from './money';
import { normalize } from './products';
import { isIncome, ticketTotals } from './totals';
import { productCategory } from './quickEntry';
import type { Category, IsoDate, NewTicket, PaymentMethod, Ticket } from './types';

/** Un gasto fijo que vence todos los meses: luz, alquiler, la tarjeta. */
export interface Bill {
  id: string;
  name: string;
  /** El monto de siempre; en una factura variable, el estimado (el último que se pagó). */
  amount: number;
  /** El monto cambia cada mes (la luz, los gastos comunes): hasta saber el de este mes se muestra como estimado. */
  variable?: boolean;
  /** El monto real de un mes, por mes '2026-10', cuando no es el de siempre. */
  amounts?: Record<string, number>;
  /** Día del mes en que vence (si el mes es más corto, el último día). */
  dueDay: number;
  autopay?: boolean;
  /** Aclaración que se muestra: "pago mínimo". */
  note?: string;
  /** Palabras que identifican el pago entre los gastos registrados ("ute", "luz"). */
  keywords: string[];
  /** Pagos marcados a mano, por mes '2026-10'. */
  paid: Record<string, { date: IsoDate; method?: PaymentMethod | string }>;
}

export interface BillStatus {
  bill: Bill;
  /** Lo de este mes: lo pagado si se registró el pago, el monto del mes o el de siempre. */
  amount: number;
  /** Factura variable sin el monto de este mes: `amount` es un estimado. */
  estimated: boolean;
  dueDate: IsoDate;
  /** Negativo si ya venció. */
  daysLeft: number;
  paid?: { date: IsoDate; method?: string; ticketId?: string };
}

/** El pago de la tarjeta no es un gasto nuevo: las compras con tarjeta ya se registraron una por una. */
export function isCardPayment(bill: Bill): boolean {
  return normalize(bill.name).includes('tarjeta');
}

export function billDueDate(bill: Bill, month: string): IsoDate {
  return `${month}-${String(Math.min(bill.dueDay, daysInMonth(month))).padStart(2, '0')}`;
}

/** El monto de la factura en un mes: el cargado para ese mes o el de siempre. */
export function billAmount(bill: Bill, month: string): number {
  return bill.amounts?.[month] ?? bill.amount;
}

/**
 * Un gasto del mes con el concepto de la factura y un monto parecido: ±5 % en una fija y ±35 % en una variable
 * (la luz de invierno puede ser bastante más que la de verano).
 */
export function findBillPayment(bill: Bill, tickets: Ticket[], month: string): Ticket | undefined {
  const keys = bill.keywords.map((k) => normalize(k)).filter(Boolean);
  const expected = billAmount(bill, month);
  const tolerance = bill.variable && bill.amounts?.[month] === undefined ? 0.35 : 0.05;
  return tickets.find((t) => {
    if (monthKey(t.date) !== month || isIncome(t)) return false;
    const text = ` ${normalize([t.store, ...t.lines.map((l) => `${l.pretty} ${l.subcategory}`)].join(' '))} `;
    const net = Math.abs(ticketTotals(t).net);
    return keys.some((k) => text.includes(` ${k} `) || text.includes(` ${k}`)) && Math.abs(net - expected) <= expected * tolerance;
  });
}

/**
 * Los gastos registrados que son el pago de una factura en esos meses. Las facturas van aparte del presupuesto
 * del mes, así que estos gastos no cuentan como gastado aunque se hayan registrado por voz, foto o QR.
 */
export function billPaymentIds(bills: Bill[], tickets: Ticket[], months: string[]): Set<string> {
  const ids = new Set<string>(tickets.filter((t) => t.billId).map((t) => t.id));
  for (const m of months) {
    for (const b of bills) {
      const t = findBillPayment(b, tickets, m);
      if (t) ids.add(t.id);
    }
  }
  return ids;
}

/** Palabras para reconocer el pago a partir del nombre: "Gastos comunes" → ["gastos comunes"]. */
export function keywordsFor(name: string): string[] {
  const n = normalize(name).trim();
  return n ? [n] : [];
}

/** El gasto que se anotó como pago de esta factura en ese mes (al marcarla pagada). */
export function billTicket(bill: Bill, tickets: Ticket[], month: string): Ticket | undefined {
  return tickets.find((t) => t.billId === bill.id && monthKey(t.date) === month);
}

/** La categoría del gasto fijo, por el nombre de la factura: la luz es Servicios · Luz; la tarjeta, Servicios · Tarjeta. */
export function billCategory(bill: Bill): { category: Category; subcategory: string } {
  const guess = productCategory(bill.name);
  if (guess.category !== 'Otros') return guess;
  return isCardPayment(bill) ? { category: 'Servicios', subcategory: 'Tarjeta' } : guess;
}

/** El gasto que se agrega a Movimientos al marcar pagada una factura. */
export function billPaymentTicket(bill: Bill, input: { amount: number; date: IsoDate; payment: PaymentMethod; accountId?: string }): NewTicket {
  const { category, subcategory } = billCategory(bill);
  return {
    source: 'texto',
    store: bill.name,
    date: input.date,
    payment: input.payment,
    lines: [{ raw: bill.name, pretty: bill.name, category, subcategory, amount: input.amount }],
    discounts: [],
    billId: bill.id,
    ...(input.accountId ? { accountId: input.accountId } : {}),
  };
}

function statusOf(bill: Bill, month: string, tickets: Ticket[], today: IsoDate): BillStatus {
  const dueDate = billDueDate(bill, month);
  const known = bill.amounts?.[month];
  const status: BillStatus = {
    bill,
    amount: known ?? bill.amount,
    estimated: !!bill.variable && known === undefined,
    dueDate,
    daysLeft: daysBetween(today, dueDate),
  };
  const manual = bill.paid[month];
  const own = billTicket(bill, tickets, month);
  if (own) {
    // Marcada pagada desde Facturas: el gasto anotado dice cuánto y cómo
    status.paid = { date: own.date, method: own.payment, ticketId: own.id };
    status.amount = round2(Math.abs(ticketTotals(own).net));
    status.estimated = false;
  } else if (manual) status.paid = { ...manual };
  else {
    const t = findBillPayment(bill, tickets, month);
    if (t) {
      status.paid = { date: t.date, method: t.payment, ticketId: t.id };
      // Lo registrado es lo que se pagó de verdad
      if (known === undefined) {
        status.amount = round2(Math.abs(ticketTotals(t).net));
        status.estimated = false;
      }
    }
  }
  return status;
}

export function billsForMonth(bills: Bill[], month: string, tickets: Ticket[], today: IsoDate) {
  const statuses = bills.map((b) => statusOf(b, month, tickets, today));
  const total = round2(statuses.reduce((s, b) => s + b.amount, 0));
  const paid = round2(statuses.filter((s) => s.paid).reduce((s, b) => s + b.amount, 0));
  return {
    total,
    paid,
    pending: round2(total - paid),
    upcoming: statuses.filter((s) => !s.paid).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    done: statuses.filter((s) => s.paid).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
  };
}

/** "Te aviso 2 días antes de cada vencimiento": las impagas que vencen entre hoy y dentro de `daysBefore` días. */
export function dueReminders(bills: Bill[], tickets: Ticket[], today: IsoDate, daysBefore = 2): BillStatus[] {
  return billsForMonth(bills, monthKey(today), tickets, today).upcoming.filter((s) => s.daysLeft >= 0 && s.daysLeft <= daysBefore);
}

/** Un aviso de vencimiento para programar en el teléfono. */
export interface BillReminder {
  /** Número estable por factura y mes, para poder reemplazar o cancelar el aviso. */
  id: number;
  billId: string;
  month: string;
  /** Fecha y hora local del aviso: '2026-10-07T10:00'. */
  at: string;
  title: string;
  body: string;
}

/**
 * Los avisos de "vence en 2 días" de este mes y el que viene, para las facturas sin pagar ni con débito
 * automático. Si el día del aviso ya pasó pero la factura todavía no venció, avisa hoy a la hora indicada
 * (si esa hora no pasó). `nowTime` es la hora actual 'HH:MM'.
 */
export function billReminderPlan(
  bills: Bill[],
  tickets: Ticket[],
  today: IsoDate,
  nowTime: string,
  options: { daysBefore?: number; hour?: string } = {},
): BillReminder[] {
  const daysBefore = options.daysBefore ?? 2;
  const hour = options.hour ?? '10:00';
  const month = monthKey(today);
  const reminders: BillReminder[] = [];
  for (const m of [month, shiftMonth(month, 1)]) {
    for (const s of billsForMonth(bills, m, tickets, today).upcoming) {
      if (s.bill.autopay || s.daysLeft < 0) continue;
      let day = shiftDay(s.dueDate, -daysBefore);
      if (day < today) day = today;
      if (day === today && nowTime >= hour) continue;
      const left = daysBetween(day, s.dueDate);
      const when = left === 0 ? 'hoy' : left === 1 ? 'mañana' : `en ${left} días`;
      reminders.push({
        id: reminderId(s.bill.id, m),
        billId: s.bill.id,
        month: m,
        at: `${day}T${hour}`,
        title: s.bill.name,
        body: `Vence ${when} (${dueLabel(s.dueDate, day).split(' · ')[0].toLowerCase()}) · ${s.estimated ? '≈ ' : ''}${formatPesos(s.amount)}${s.bill.note ? ` · ${s.bill.note}` : ''}`,
      });
    }
  }
  return reminders.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Un entero positivo que no cambia entre aperturas de la app (los avisos del teléfono usan ids numéricos). */
function reminderId(billId: string, month: string): number {
  let h = 7;
  for (const c of `${billId}|${month}`) h = (h * 31 + c.charCodeAt(0)) % 2_000_000_000;
  return h + 1;
}
