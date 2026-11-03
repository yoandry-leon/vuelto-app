import { describe, expect, it } from 'vitest';
import { type Account, accountFor, accountOf, assignAccounts, lastAccountId, spentByAccount } from '@/domain/accounts';
import { draftSubtitle, keypadDraft } from '@/domain/carga';
import { mergeRemote, toRemote } from '@/domain/sync';
import type { NewTicket, Ticket } from '@/domain/types';

const CUENTAS: Account[] = [
  { id: 'efectivo', name: 'Efectivo', payment: 'Efectivo' },
  { id: 'brou', name: 'BROU débito', payment: 'Débito' },
  { id: 'itau', name: 'Itaú débito', payment: 'Débito' },
  { id: 'visa', name: 'Visa Itaú', payment: 'Crédito' },
];

function gasto(id: string, amount: number, extra: Partial<Ticket> = {}): Ticket {
  return {
    id, source: 'texto', store: id, date: '2026-10-05', payment: 'Efectivo', discounts: [],
    lines: [{ raw: id, pretty: id, category: 'Supermercado', subcategory: 'Almacén', amount }],
    sync: { state: 'subido' }, createdAt: `2026-10-05T10:0${amount % 10}:00.000Z`, ...extra,
  };
}

describe('cuentas', () => {
  it('"con débito" usa la cuenta de débito preferida, o la primera de ese tipo', () => {
    expect(accountFor(CUENTAS, 'Débito')?.id).toBe('brou');
    expect(accountFor(CUENTAS, 'Débito', 'itau')?.id).toBe('itau');
    // La preferida no es de ese tipo: se usa la primera que sí
    expect(accountFor(CUENTAS, 'Crédito', 'itau')?.id).toBe('visa');
    expect(accountFor(CUENTAS, 'Transferencia')).toBeUndefined();
  });

  it('los gastos viejos, sin cuenta, toman la primera de su medio de pago', () => {
    expect(accountOf({ payment: 'Débito' }, CUENTAS)?.id).toBe('brou');
    expect(accountOf({ payment: 'Débito', accountId: 'itau' }, CUENTAS)?.id).toBe('itau');
    // Una cuenta borrada: pasa a otra de su tipo
    expect(accountOf({ payment: 'Crédito', accountId: 'borrada' }, CUENTAS)?.id).toBe('visa');
  });

  it('al guardar, lo que llega sin cuenta toma la de su medio de pago, y la elegida manda sobre el medio de pago', () => {
    const base: NewTicket = { source: 'voz', store: 'Feria', date: '2026-10-05', payment: 'Débito', lines: [], discounts: [] };
    const [dicho, elegido] = assignAccounts([base, { ...base, payment: 'Efectivo', accountId: 'visa' }], CUENTAS, 'itau');
    expect(dicho.accountId).toBe('itau');
    expect(elegido).toMatchObject({ accountId: 'visa', payment: 'Crédito' });
  });

  it('el teclado propone la cuenta del último gasto (sin contar ingresos ni facturas)', () => {
    const tickets = [
      gasto('a', 100, { accountId: 'visa', payment: 'Crédito', createdAt: '2026-10-05T09:00:00.000Z' }),
      gasto('b', 200, { accountId: 'itau', payment: 'Débito', createdAt: '2026-10-05T10:00:00.000Z' }),
      gasto('c', 300, { kind: 'ingreso', accountId: 'brou', createdAt: '2026-10-05T11:00:00.000Z' }),
      gasto('d', 400, { billId: 'luz', accountId: 'brou', createdAt: '2026-10-05T12:00:00.000Z' }),
    ];
    expect(lastAccountId(tickets, CUENTAS)).toBe('itau');
    expect(lastAccountId([], CUENTAS)).toBe('efectivo');
  });

  it('cuánto salió de cada cuenta en el mes, con los gastos fijos y sin los ingresos', () => {
    const tickets = [
      gasto('feria', 450),
      gasto('super', 1200, { accountId: 'brou', payment: 'Débito' }),
      gasto('viejo', 300, { payment: 'Débito' }),
      gasto('luz', 2150, { accountId: 'brou', payment: 'Débito', billId: 'luz' }),
      gasto('sueldo', 50000, { accountId: 'brou', kind: 'ingreso' }),
      gasto('setiembre', 999, { date: '2026-09-30' }),
    ];
    expect(spentByAccount(tickets, CUENTAS, '2026-10').map((r) => [r.account.id, r.spent, r.count])).toEqual([
      ['brou', 3650, 3],
      ['efectivo', 450, 1],
      ['itau', 0, 0],
      ['visa', 0, 0],
    ]);
  });

  it('el gasto del teclado lleva la cuenta, y la carga la muestra por su nombre', () => {
    const d = keypadDraft({ amount: 120, currency: 'UYU', description: 'Café', category: 'Delivery y salidas', subcategory: 'Bar y café', payment: 'Débito', accountId: 'itau', date: '2026-10-05' }, 'x');
    expect(d.ticket).toMatchObject({ accountId: 'itau', payment: 'Débito' });
    expect(draftSubtitle(d, CUENTAS)).toBe('Salidas · Itaú débito');
    expect(draftSubtitle(d)).toBe('Salidas · Débito');
  });

  it('la cuenta viaja al servidor, y un cambio de cuenta vuelve a subir', () => {
    const t = gasto('a', 100, { accountId: 'brou', payment: 'Débito', sync: { state: 'pendiente', remoteId: 'r1' } });
    expect(toRemote(t).accountId).toBe('brou');
    const enServidor = { ...toRemote({ ...t, accountId: 'itau' }), id: 'r1' };
    expect(mergeRemote([t], [enServidor], 'ahora')[0].sync.state).toBe('pendiente');
    expect(mergeRemote([t], [{ ...toRemote(t), id: 'r1' }], 'ahora')[0].sync.state).toBe('subido');
  });
});
