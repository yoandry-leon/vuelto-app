import { describe, expect, it } from 'vitest';
import type { Account } from '@/domain/accounts';
import {
  decodeText, detectLayout, importChanges, linkCandidates, parseBankAmount, parseBankDate, parseCsv, planImport,
  readRows, storeFromBankText, type StatementRow,
} from '@/domain/statement';
import { mergeRemote, toRemote } from '@/domain/sync';
import type { Ticket } from '@/domain/types';

const BROU: Account = { id: 'brou', name: 'BROU débito', payment: 'Débito' };
const VISA: Account = { id: 'visa', name: 'Visa', payment: 'Crédito' };

/** Como lo baja un banco de acá: datos de la cuenta arriba, punto y coma, débito y crédito aparte, saldo. */
const EXTRACTO_BROU = [
  'Banco;República Oriental del Uruguay;;;',
  'Cuenta;Caja de ahorro en pesos;;;',
  'Período;01/10/2026 al 31/10/2026;;;',
  ';;;;',
  'Fecha;Descripción;Débito;Crédito;Saldo',
  '01/10/2026;SALDO ANTERIOR;;;45.000,00',
  '02/10/2026;COMPRA CON TARJETA DE DEBITO TATA 1234 MONTEVIDEO;1.845,50;;43.154,50',
  '03/10/2026;DEBITO AUTOMATICO ANTEL;1.590,00;;41.564,50',
  '05/10/2026;TRANSFERENCIA RECIBIDA;;35.000,00;76.564,50',
  '06/10/2026;RETIRO REDBROU CAJERO 0021;2.000,00;;74.564,50',
  '06/10/2026;COMPRA STM;52,00;;74.512,50',
  '06/10/2026;COMPRA STM;52,00;;74.460,50',
  '07/10/2026;COMPRA;;;',
  'Total;;7.391,50;35.000,00;',
].join('\r\n');

function leer(text: string, credit = false): StatementRow[] {
  const cells = parseCsv(text);
  const layout = detectLayout(cells, credit);
  if (!layout) throw new Error('sin columnas');
  return readRows(cells, layout).rows;
}

function gasto(id: string, amount: number, date: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id, source: 'texto', store: id, date, payment: 'Débito', discounts: [],
    lines: [{ raw: id, pretty: id, category: 'Supermercado', subcategory: 'Almacén', amount }],
    sync: { state: 'subido', remoteId: `r-${id}` }, createdAt: `${date}T10:00:00.000Z`, ...extra,
  };
}

describe('leer el extracto', () => {
  it('fechas y montos como los escriben los bancos', () => {
    expect(parseBankDate('12/10/2026')).toBe('2026-10-12');
    expect(parseBankDate('2/1/26 14:33')).toBe('2026-01-02');
    expect(parseBankDate('2026-10-12T00:00:00')).toBe('2026-10-12');
    expect(parseBankDate('12 oct. 2026')).toBe('2026-10-12');
    expect(parseBankDate('12-Set-2026')).toBe('2026-09-12');
    expect(parseBankDate('Período')).toBeUndefined();
    expect(parseBankAmount('1.845,50')).toBe(1845.5);
    expect(parseBankAmount('-1,200.00')).toBe(-1200);
    expect(parseBankAmount('(1.200,50)')).toBe(-1200.5);
    expect(parseBankAmount('1.200,50-')).toBe(-1200.5);
    expect(parseBankAmount('U$S 12,99')).toBe(12.99);
    expect(parseBankAmount('')).toBeNaN();
  });

  it('un archivo en Latin-1 se lee con sus tildes', () => {
    const latin1 = Uint8Array.from([...'Descripción;Débito'].map((c) => c.charCodeAt(0)));
    expect(decodeText(latin1)).toBe('Descripción;Débito');
    expect(decodeText(new TextEncoder().encode('Crédito'))).toBe('Crédito');
  });

  it('saltea los datos de la cuenta, el saldo anterior y los totales; débito resta y crédito suma', () => {
    const rows = leer(EXTRACTO_BROU);
    expect(rows.map((r) => [r.date, r.amount, r.income])).toEqual([
      ['2026-10-02', 1845.5, false],
      ['2026-10-03', 1590, false],
      ['2026-10-05', 35000, true],
      ['2026-10-06', 2000, false],
      ['2026-10-06', 52, false],
      ['2026-10-06', 52, false],
    ]);
    expect(rows[0].text).toBe('COMPRA CON TARJETA DE DEBITO TATA 1234 MONTEVIDEO');
  });

  it('cuenta las filas que parecen movimientos y no se pudieron leer', () => {
    // La compra del 7 no tiene monto
    const base = parseCsv(EXTRACTO_BROU);
    expect(readRows(base, detectLayout(base)!).skipped).toBe(1);
    const cells = parseCsv(`${EXTRACTO_BROU}\r\nayer;COMPRA DISCO;980,00;;`);
    expect(readRows(cells, detectLayout(cells)!).skipped).toBe(2);
  });

  it('con comas, comillas y un solo importe con signo', () => {
    const rows = leer(['"Fecha","Concepto","Importe","Saldo"', '"2026-10-02","COMPRA POS DEVOTO, CARRASCO","-1,200.00","10,000.00"', '"2026-10-03","DEPOSITO","5,000.00","15,000.00"'].join('\n'));
    expect(rows.map((r) => [r.text, r.amount, r.income])).toEqual([
      ['COMPRA POS DEVOTO, CARRASCO', 1200, false],
      ['DEPOSITO', 5000, true],
    ]);
  });

  it('un resumen de tarjeta: compras en positivo, pesos y dólares en columnas aparte', () => {
    const rows = leer(['Fecha;Detalle;Importe $;Importe U$S', '04/10/26;PEDIDOSYA*PEDIDO;640,00;', '07/10/26;NETFLIX.COM;;12,99', '10/10/26;SU PAGO;-8.000,00;'].join('\n'), true);
    expect(rows.map((r) => [r.text, r.amount, r.income, r.currency])).toEqual([
      ['PEDIDOSYA*PEDIDO', 640, false, 'UYU'],
      ['NETFLIX.COM', 12.99, false, 'USD'],
      ['SU PAGO', 8000, true, 'UYU'],
    ]);
  });

  it('sin encabezado: la fecha, el texto y el monto se adivinan por los datos', () => {
    const rows = leer('02/10/2026;COMPRA DISCO;-980,00\n03/10/2026;FARMACIA SAN ROQUE;-1.380,00\n04/10/2026;SUELDO;52.000,00');
    expect(rows.map((r) => [r.text, r.amount, r.income])).toEqual([
      ['COMPRA DISCO', 980, false],
      ['FARMACIA SAN ROQUE', 1380, false],
      ['SUELDO', 52000, true],
    ]);
  });

  it('una tabla HTML con extensión .xls', () => {
    const html = '<table><tr><th>Fecha</th><th>Descripci&oacute;n</th><th>Importe</th></tr><tr><td>02/10/2026</td><td>COMPRA&nbsp;TATA</td><td>-1.845,50</td></tr></table>';
    expect(leer(html).map((r) => [r.text, r.amount])).toEqual([['COMPRA TATA', 1845.5]]);
  });

  it('el comercio sale de la descripción del banco', () => {
    expect(storeFromBankText('COMPRA CON TARJETA DE DEBITO TATA 1234 MONTEVIDEO')).toBe('Tata');
    expect(storeFromBankText('DEBITO AUTOMATICO ANTEL')).toBe('Antel');
    expect(storeFromBankText('COMPRA POS DEVOTO, CARRASCO')).toBe('Devoto Carrasco');
    expect(storeFromBankText('MERCADOPAGO*LIBRERIA DEL SUR')).toBe('Libreria del Sur');
    expect(storeFromBankText('Compra con tarjeta de débito Farmacia ****4821 12/10')).toBe('Farmacia');
    expect(storeFromBankText('TRANSFERENCIA RECIBIDA')).toBe('Transferencia Recibida');
  });
});

describe('importar a una cuenta', () => {
  const rows = leer(EXTRACTO_BROU);
  const tickets = [
    // Anotado el día anterior, en la misma cuenta: es la compra del Tata
    gasto('tata', 1845.5, '2026-10-01', { accountId: 'brou', store: 'Tata' }),
    // Anotado con otra tarjeta de débito: igual es el mismo
    gasto('antel', 1590, '2026-10-03', { accountId: 'itau', store: 'Antel' }),
    // Los boletos en efectivo no se vinculan solos
    gasto('stm', 52, '2026-10-06', { payment: 'Efectivo', accountId: 'efectivo', store: 'Ómnibus' }),
    // Mismo monto pero cinco días antes: no es
    gasto('viejo', 2000, '2026-10-01'),
  ];

  it('separa lo ya anotado, lo nuevo, las entradas y los pases', () => {
    const plan = planImport(rows, tickets, BROU);
    expect(plan.map((i) => [i.store, i.kind, i.action, i.match])).toEqual([
      ['Tata', 'gasto', 'vincular', 'tata'],
      ['Antel', 'gasto', 'vincular', 'antel'],
      ['Transferencia Recibida', 'ingreso', 'omitir', undefined],
      ['Retiro Redbrou Cajero', 'pase', 'omitir', undefined],
      ['Stm', 'gasto', 'registrar', undefined],
      ['Stm', 'gasto', 'registrar', undefined],
    ]);
    expect(plan[4]).toMatchObject({ category: 'Transporte', subcategory: 'Ómnibus' });
    // Dos boletos iguales el mismo día son dos movimientos distintos
    expect(plan[4].ref).not.toBe(plan[5].ref);
  });

  it('con dos gastos iguales, se queda con el de la cuenta del extracto', () => {
    const dos = [gasto('otra', 1845.5, '2026-10-02', { accountId: 'visa', payment: 'Crédito' }), gasto('esta', 1845.5, '2026-10-02', { accountId: 'brou' })];
    expect(planImport(rows.slice(0, 1), dos, BROU)[0].match).toBe('esta');
  });

  it('confirmar registra los nuevos en la cuenta y vincula los anotados', () => {
    const plan = planImport(rows, tickets, BROU);
    plan[2].action = 'registrar';
    const { news, links } = importChanges(plan, BROU, tickets);
    expect(links.map((l) => [l.id, l.accountId, l.payment])).toEqual([
      ['tata', 'brou', 'Débito'],
      ['antel', 'brou', 'Débito'],
    ]);
    expect(news.map((n) => [n.store, n.kind, n.accountId, n.source, n.lines[0].amount])).toEqual([
      ['Transferencia Recibida', 'ingreso', 'brou', 'extracto', 35000],
      ['Stm', undefined, 'brou', 'extracto', 52],
      ['Stm', undefined, 'brou', 'extracto', 52],
    ]);
    expect(news[1].bank?.text).toBe('COMPRA STM');
  });

  it('importar el mismo extracto otra vez no duplica nada', () => {
    const plan = planImport(rows, tickets, BROU);
    const { news, links } = importChanges(plan, BROU, tickets);
    const after = [
      ...tickets.map((t) => {
        const l = links.find((x) => x.id === t.id);
        return l ? { ...t, bank: l.bank } : t;
      }),
      ...news.map((n, i) => ({ ...n, id: `n${i}`, sync: { state: 'pendiente' as const }, createdAt: '' })),
    ];
    const again = planImport(rows, after, BROU);
    expect(again.filter((i) => i.action !== 'omitir')).toEqual([]);
    expect(again.filter((i) => i.imported).length).toBe(4);
  });

  it('un dólar del resumen de tarjeta se registra en dólares, con los pesos para el presupuesto', () => {
    const [netflix] = leer('Fecha;Detalle;Importe $;Importe U$S\n07/10/26;NETFLIX.COM;;12,99', true);
    const { news } = importChanges(planImport([netflix], [], VISA), VISA, []);
    expect(news[0]).toMatchObject({ usd: { amount: 12.99, rate: 40 }, payment: 'Crédito', lines: [{ amount: 519.6 }] });
  });

  it('vinculado a mano con otro monto, un gasto suelto toma el del banco; uno con productos no', () => {
    const plan = planImport(rows, tickets, BROU);
    const cena = gasto('cena', 1800, '2026-10-02');
    const disco = { ...gasto('disco', 1000, '2026-10-02'), lines: [...gasto('disco', 1000, '2026-10-02').lines, ...gasto('disco', 845.5, '2026-10-02').lines] };
    plan[0].match = 'cena';
    plan[1].match = 'disco';
    const { links } = importChanges(plan, BROU, [...tickets, cena, disco]);
    expect(links.map((l) => [l.id, l.amount])).toEqual([
      ['cena', 1845.5],
      ['disco', undefined],
    ]);
  });

  it('a mano se puede elegir otro gasto: los de monto y fecha más parecidos primero', () => {
    const plan = planImport(rows, tickets, BROU);
    const retiro = plan[3];
    const options = linkCandidates(retiro, plan, [...tickets, gasto('cerca', 1990, '2026-10-05')]);
    expect(options.map((t) => t.id)).toEqual(['cerca', 'viejo', 'stm']);
  });

  it('el vínculo con el extracto viaja al servidor y vuelve', () => {
    const t = gasto('tata', 1845.5, '2026-10-01', { bank: { ref: 'brou|2026-10-02|-1845.5|tata', text: 'COMPRA TATA' } });
    const remote = { ...toRemote(t), id: 'r9', clientId: 'otro-telefono' };
    expect(remote.bank?.text).toBe('COMPRA TATA');
    expect(mergeRemote([], [remote], 'ahora')[0].bank).toEqual(t.bank);
  });
});
