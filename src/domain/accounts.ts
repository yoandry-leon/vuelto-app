import { monthKey } from './dates';
import { round2 } from './money';
import { isIncome, ticketTotals } from './totals';
import type { NewTicket, PaymentMethod, Ticket } from './types';

/**
 * De dónde sale la plata de un gasto: "Efectivo", "BROU débito", "Visa Itaú". Cada cuenta tiene un tipo, y el
 * medio de pago del gasto (`Ticket.payment`) sale de ese tipo, así que elegir la cuenta alcanza.
 */
export interface Account {
  id: string;
  name: string;
  /** El tipo de la cuenta: con qué se paga desde ella. */
  payment: PaymentMethod;
}

/** Las cuentas con que arranca la app (y las de los datos guardados antes de que existieran). Se pueden renombrar. */
export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'efectivo', name: 'Efectivo', payment: 'Efectivo' },
  { id: 'debito', name: 'Tarjeta de débito', payment: 'Débito' },
  { id: 'credito', name: 'Tarjeta de crédito', payment: 'Crédito' },
  { id: 'transferencia', name: 'Transferencias', payment: 'Transferencia' },
];

/** Cómo se muestra el tipo de cuenta: "débito", "crédito". */
export const ACCOUNT_KIND: Record<PaymentMethod, string> = {
  Efectivo: 'efectivo',
  Débito: 'débito',
  Crédito: 'crédito',
  Transferencia: 'transferencia',
  Otro: 'otro',
};

/**
 * La cuenta para un medio de pago dicho o leído ("con débito"): la preferida si es de ese tipo (la última usada),
 * si no la primera de ese tipo.
 */
export function accountFor(accounts: Account[], payment: PaymentMethod, preferred?: string): Account | undefined {
  const fav = accounts.find((a) => a.id === preferred);
  if (fav && fav.payment === payment) return fav;
  return accounts.find((a) => a.payment === payment);
}

/** La cuenta de un gasto. Los anteriores a las cuentas no tienen `accountId`: se usa la primera de su medio de pago. */
export function accountOf(t: Pick<Ticket, 'accountId' | 'payment'>, accounts: Account[]): Account | undefined {
  return accounts.find((a) => a.id === t.accountId) ?? accounts.find((a) => a.payment === t.payment);
}

/**
 * Le pone cuenta a los gastos nuevos que no la traen (dictados, por Siri o el reloj, leídos de un ticket), según su
 * medio de pago. Los que ya la traen quedan con el medio de pago de su cuenta.
 */
export function assignAccounts(news: NewTicket[], accounts: Account[], preferred?: string): NewTicket[] {
  return news.map((t) => {
    const own = t.accountId ? accounts.find((a) => a.id === t.accountId) : undefined;
    if (own) return own.payment === t.payment ? t : { ...t, payment: own.payment };
    const account = accountFor(accounts, t.payment, preferred);
    return account ? { ...t, accountId: account.id } : t;
  });
}

/** La cuenta del último gasto registrado: la que propone el teclado. */
export function lastAccountId(tickets: Ticket[], accounts: Account[]): string | undefined {
  const last = [...tickets]
    .filter((t) => !isIncome(t) && !t.billId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  return last ? accountOf(last, accounts)?.id : accounts[0]?.id;
}

/**
 * Cuánto salió de cada cuenta en el mes: todos los gastos, también los fijos (la plata salió igual), sin los
 * ingresos. Las cuentas sin gastos aparecen en cero; las más usadas primero.
 */
export function spentByAccount(tickets: Ticket[], accounts: Account[], month: string): { account: Account; spent: number; count: number }[] {
  const out = new Map(accounts.map((a) => [a.id, { account: a, spent: 0, count: 0 }]));
  for (const t of tickets) {
    if (monthKey(t.date) !== month || isIncome(t)) continue;
    const a = accountOf(t, accounts);
    const row = a && out.get(a.id);
    if (!row) continue;
    row.spent = round2(row.spent + ticketTotals(t).net);
    row.count++;
  }
  return [...out.values()].sort((a, b) => b.spent - a.spent);
}
