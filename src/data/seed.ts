import type { Bill } from '@/domain/bills';
import type { Budget } from '@/domain/budget';
import { rutCheckDigit } from '@/domain/cfe';
import { daysInMonth, monthKey, shiftDay, shiftMonth, todayIso } from '@/domain/dates';
import { formatUYU } from '@/domain/money';
import { ticketTotals } from '@/domain/totals';
import type { Debt, SavingsGoal } from '@/domain/goals';
import type { ReadItem } from '@/domain/paper';
import type { Holding, InvestmentGoal, SimulationAssumptions } from '@/domain/investment';
import type { RemoteExpense } from '@/domain/sync';
import type { Category, CfeHeader, Discount, IsoDate, Line, PaymentMethod, Ticket, TicketSource } from '@/domain/types';

/**
 * Datos de ejemplo de Rumbo: los mismos números que la propuesta (octubre con $ 32.550 gastados de $ 45.000).
 * Comercios, RUT y montos son inventados. Las fechas son relativas a hoy, para que "Hoy" siempre tenga gastos.
 */

/** Arma un RUT de 12 dígitos con dígito verificador válido a partir de 11. */
export function demoRut(first11: string): string {
  // Si esa base no admite dígito verificador, se prueba con el siguiente número.
  for (let n = Number(first11); ; n++) {
    const base = String(n).padStart(11, '0');
    const dv = rutCheckDigit(base);
    if (dv >= 0) return base + String(dv);
  }
}

export function demoQrUrl(rut: string, type: number, serie: string, number: string, total: number, ddmmyyyy: string): string {
  return `https://www.efactura.dgi.gub.uy/consultaQR/cfe?${rut},${type},${serie},${number},${total.toFixed(2)},${ddmmyyyy},DEMO00`;
}

const L = (raw: string, pretty: string, category: Category, subcategory: string, amount: number): Line => ({ raw, pretty, category, subcategory, amount });
const ley = (amount: number): Discount => ({ label: 'Ley 19.210 · débito', kind: 'ley19210', amount });

function cfe(rut: string, serie: string, number: string, total: number, date: IsoDate): CfeHeader {
  const [y, m, d] = date.split('-');
  return { rut, cfeType: 101, serie, number, total, date, url: demoQrUrl(rut, 101, serie, number, total, `${d}/${m}/${y}`) };
}

const RUT_ESQUINA = demoRut('21589347001');
const RUT_DISCO = demoRut('21600412001');
export const RUT_BLANQUEADA = demoRut('21765432001');

/** Comercios conocidos por RUT. En el producto real es una tabla del servidor, alimentada por los propios usuarios. */
export const KNOWN_STORES: Record<string, { name: string; category: Category }> = {
  [RUT_ESQUINA]: { name: 'Almacén La Esquina', category: 'Supermercado' },
  [RUT_DISCO]: { name: 'Disco', category: 'Supermercado' },
  [RUT_BLANQUEADA]: { name: 'Super La Blanqueada', category: 'Supermercado' },
};

/** El QR de "Simular lectura del QR" y las líneas que devuelve el lector de demo para ese QR. */
export const DEMO_SCAN = {
  qr: demoQrUrl(RUT_BLANQUEADA, 101, 'A', '1203556', 1046.4, '30/09/2026'),
  lines: [
    L('YERBA C/PALO 500G', 'Yerba con palo 500 g', 'Supermercado', 'Almacén', 146),
    L('LECHE DESCR. 1L X3', 'Leche descremada 1 L ×3', 'Supermercado', 'Lácteos y huevos', 144),
    L('MANTECA 200G', 'Manteca 200 g', 'Supermercado', 'Lácteos y huevos', 98),
    L('QUESO DAMBO KG 0,4', 'Queso dambo 400 g', 'Supermercado', 'Lácteos y huevos', 236),
    L('MANZANA ROJA KG 1,1', 'Manzana roja 1,1 kg', 'Supermercado', 'Verdulería', 121),
    L('PAN FLAUTA X2', 'Pan flauta ×2', 'Supermercado', 'Panadería', 90),
    L('AGUA MIN. 2,25L X2', 'Agua mineral 2,25 L ×2', 'Supermercado', 'Bebidas', 110),
    L('ALFAJOR MAICENA X6', 'Alfajores de maicena ×6', 'Supermercado', 'Almacén', 110),
  ] as Line[],
  discounts: [ley(8.6)] as Discount[],
};

/** El ticket en papel de "Probar con un ticket de ejemplo" (navegador): lo que devolvería el lector, con un monto dudoso. */
export const DEMO_PAPER: { store: string; items: ReadItem[]; writtenTotal: number } = {
  store: 'Panadería del Barrio',
  items: [
    { written: 'PAN FLAUTA X2', name: 'Pan flauta x2', amount: 80 },
    { written: 'LECHE 1L', name: 'Leche 1 L', amount: 42 },
    { written: 'QUESO DAMBO 300G', name: 'Queso dambo 300 g', amount: 210, doubtful: true },
    { written: 'PILAS AA X4', name: 'Pilas AA x4', amount: 190 },
  ],
  writtenTotal: 522,
};

/** Día `n` del mes de `today`, sin pasarse de hoy (los gastos de ejemplo nunca están en el futuro). */
function dayOf(today: IsoDate, n: number): IsoDate {
  const day = Math.min(n, Number(today.slice(8, 10)));
  return `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

function at(date: IsoDate, hh: number, mm: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

let seq = 0;
function gasto(
  date: IsoDate,
  source: TicketSource,
  store: string,
  lines: Line[],
  payment: PaymentMethod,
  extra: Partial<Ticket> & { time?: [number, number] } = {},
): Ticket {
  const { time = [12, 0], ...rest } = extra;
  return {
    id: `s${++seq}`,
    source,
    store,
    date,
    payment,
    lines,
    discounts: [],
    sync: { state: 'subido', remoteId: `seed-${seq}` },
    createdAt: at(date, time[0], time[1]),
    ...rest,
  };
}

const one = (store: string, category: Category, subcategory: string, amount: number) => [L(store, store, category, subcategory, amount)];

export function seedTickets(today: IsoDate = todayIso()): Ticket[] {
  seq = 0;
  const d = (n: number) => dayOf(today, n);
  const prev = shiftMonth(monthKey(today), -1);
  const p = (n: number) => `${prev}-${String(Math.min(n, daysInMonth(prev))).padStart(2, '0')}`;
  const pending = { state: 'pendiente' as const };

  return [
    // Hoy: lo de la pantalla de inicio. Feria, almacén y almuerzo se registraron sin señal.
    gasto(today, 'voz', 'Feria', one('Feria', 'Supermercado', 'Verdulería', 450), 'Efectivo', { phrase: '450 en la feria, efectivo', sync: pending, time: [11, 20] }),
    gasto(
      today,
      'qr',
      'Almacén La Esquina',
      [
        L('POLLO ENTERO 1KG', 'Pollo entero 1 kg', 'Supermercado', 'Carnes', 289),
        L('CARNE PICADA 500G', 'Carne picada 500 g', 'Supermercado', 'Carnes', 245),
        L('YERBA 1KG', 'Yerba 1 kg', 'Supermercado', 'Almacén', 239),
        L('ACEITE GIRASOL 900ML', 'Aceite de girasol 900 ml', 'Supermercado', 'Almacén', 129),
        L('ARROZ 1KG', 'Arroz 1 kg', 'Supermercado', 'Almacén', 79),
        L('HUEVOS X12', 'Huevos ×12', 'Supermercado', 'Lácteos y huevos', 179),
        L('LECHE 1L X2', 'Leche 1 L ×2', 'Supermercado', 'Lácteos y huevos', 84),
        L('DETERGENTE 750ML', 'Detergente 750 ml', 'Supermercado', 'Limpieza', 98),
      ],
      'Débito',
      { cfe: cfe(RUT_ESQUINA, 'A', '0457712', 1342, today), sync: pending, time: [19, 42] },
    ),
    gasto(today, 'texto', 'Almuerzo', one('Almuerzo', 'Delivery y salidas', 'Almuerzo', 390), 'Débito', { phrase: 'almuerzo 390 débito', sync: pending, time: [13, 5] }),
    gasto(today, 'whatsapp', 'Ómnibus', one('Ómnibus', 'Transporte', 'Ómnibus', 52), 'Efectivo', { phrase: 'ómnibus 52', time: [8, 5] }),
    // Una foto de farmacia en la que no se leyó el monto: queda para revisar y no sube hasta corregirla.
    gasto(today, 'papel', 'Farmacia', [], 'Efectivo', { review: 'No se leyó el monto', sync: pending, time: [17, 30] }),

    // El resto del mes. Por categoría suma lo mismo que la propuesta.
    gasto(d(2), 'qr', 'Disco', one('Compra del mes', 'Supermercado', 'Almacén', 4120), 'Débito', { cfe: cfe(RUT_DISCO, 'B', '1189034', 4120, d(2)) }),
    gasto(d(3), 'texto', 'Super El Ceibo', one('Super El Ceibo', 'Supermercado', 'Almacén', 3250), 'Débito', { phrase: '3250 super el ceibo débito' }),
    gasto(d(5), 'voz', 'Carnicería', one('Carnicería', 'Supermercado', 'Carnes', 1560), 'Efectivo', { phrase: '1560 en la carnicería' }),
    gasto(d(4), 'whatsapp', 'Feria', one('Feria', 'Supermercado', 'Verdulería', 1180), 'Efectivo', { phrase: 'feria 1180' }),
    gasto(d(6), 'texto', 'Panadería', one('Panadería', 'Supermercado', 'Panadería', 498), 'Efectivo'),
    gasto(d(2), 'whatsapp', 'PedidosYa', one('PedidosYa', 'Delivery y salidas', 'Delivery', 1290), 'Crédito'),
    gasto(d(3), 'texto', 'Bar', one('Bar', 'Delivery y salidas', 'Bar y café', 980), 'Débito'),
    gasto(d(4), 'voz', 'Cena', one('Cena', 'Delivery y salidas', 'Restorán', 2140), 'Crédito', { phrase: 'cena 2140 con tarjeta' }),
    gasto(d(6), 'whatsapp', 'Delivery', one('Delivery', 'Delivery y salidas', 'Delivery', 1350), 'Crédito'),
    gasto(d(7), 'texto', 'Café', one('Café', 'Delivery y salidas', 'Bar y café', 1000), 'Débito'),
    gasto(d(1), 'texto', 'Nafta', one('Nafta', 'Transporte', 'Combustible', 3000), 'Débito'),
    gasto(d(2), 'whatsapp', 'Recarga STM', one('Recarga STM', 'Transporte', 'Ómnibus', 1000), 'Débito'),
    gasto(d(5), 'texto', 'Uber', one('Uber', 'Transporte', 'Taxi y apps', 698), 'Crédito'),
    gasto(d(6), 'texto', 'Peaje', one('Peaje', 'Transporte', 'Peajes', 450), 'Efectivo'),
    gasto(d(3), 'whatsapp', 'Farmacia', one('Farmacia', 'Salud', 'Farmacia', 1380), 'Débito'),
    gasto(d(4), 'texto', 'Orden mutualista', one('Orden mutualista', 'Salud', 'Mutualista', 890), 'Débito'),
    gasto(d(5), 'texto', 'Óptica', one('Óptica', 'Salud', 'Cuidado personal', 2280), 'Efectivo'),
    gasto(d(2), 'texto', 'Regalo cumpleaños', one('Regalo cumpleaños', 'Otros', 'Varios', 1800), 'Crédito'),
    gasto(d(4), 'whatsapp', 'Peluquería', one('Peluquería', 'Otros', 'Varios', 950), 'Efectivo'),
    gasto(d(7), 'texto', 'Kiosco', one('Kiosco', 'Otros', 'Varios', 500), 'Efectivo'),

    // Mes anterior: hasta el día 8 se gastó un 8 % más que en este mes.
    gasto(p(2), 'whatsapp', 'Disco', one('Disco', 'Supermercado', 'Almacén', 9800), 'Débito'),
    gasto(p(3), 'texto', 'Nafta', one('Nafta', 'Transporte', 'Combustible', 3200), 'Débito'),
    gasto(p(6), 'texto', 'Tata', one('Tata', 'Supermercado', 'Almacén', 14380), 'Débito'),
    gasto(p(7), 'whatsapp', 'Cena', one('Cena', 'Delivery y salidas', 'Restorán', 4000), 'Crédito'),
    gasto(p(8), 'texto', 'Recarga STM', one('Recarga STM', 'Transporte', 'Ómnibus', 4000), 'Débito'),
    gasto(p(15), 'whatsapp', 'Feria', one('Feria', 'Supermercado', 'Verdulería', 2000), 'Efectivo'),
    gasto(p(22), 'texto', 'Farmacia', one('Farmacia', 'Salud', 'Farmacia', 1500), 'Débito'),
    gasto(p(27), 'whatsapp', 'Delivery', one('Delivery', 'Delivery y salidas', 'Delivery', 2200), 'Crédito'),

    // El alquiler del mes, marcado pagado en Facturas: se ve en Movimientos como gasto fijo y no sale del presupuesto
    gasto(d(1), 'texto', 'Alquiler', one('Alquiler', 'Servicios', 'Alquiler', 18200), 'Transferencia', { billId: 'alquiler', time: [9, 30] }),
  ];
}

/**
 * Un extracto de débito de ejemplo, para probar la importación en el navegador. Repite hasta cuatro gastos con
 * débito del mes (los que ya están anotados, con la fecha corrida un día como cuando el banco acredita después, y
 * el último cinco días, para la conciliación sin importar la fecha) y suma compras nuevas, un débito automático,
 * un sueldo, un retiro y el pago de la tarjeta.
 */
export function demoStatement(tickets: Ticket[], today: IsoDate = todayIso()): string {
  const d = (n: number) => dayOf(today, n);
  const fecha = (iso: IsoDate) => iso.split('-').reverse().join('/');
  const monto = (n: number) => formatUYU(n).replace('$ ', '');
  const month = monthKey(today);
  const anotados = tickets
    .filter((t) => t.payment === 'Débito' && !t.kind && !t.usd && !t.review && !t.bank && !t.billId && monthKey(t.date) === month)
    .slice(0, 4)
    .map((t, i) => {
      const next = shiftDay(t.date, i === 3 ? 5 : 1);
      return { date: next > today ? t.date : next, text: `COMPRA CON TARJETA DE DEBITO ${t.store.toUpperCase()} MONTEVIDEO`, amount: ticketTotals(t).net, credit: false };
    });
  const rows = [
    { date: d(1), text: 'TRANSFERENCIA RECIBIDA SUELDO', amount: 62000, credit: true },
    { date: d(2), text: 'COMPRA CON TARJETA DE DEBITO TATA 4410 MONTEVIDEO', amount: 1845.5, credit: false },
    { date: d(3), text: 'DEBITO AUTOMATICO ANTEL', amount: 1590, credit: false },
    { date: d(4), text: 'RETIRO REDBROU CAJERO 0021', amount: 2000, credit: false },
    { date: d(5), text: 'MERCADOPAGO*LIBRERIA DEL SUR', amount: 760, credit: false },
    { date: d(6), text: 'PAGO TARJETA VISA', amount: 8000, credit: false },
    ...anotados,
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  let saldo = 48250;
  const lines = rows.map((r) => {
    saldo += r.credit ? r.amount : -r.amount;
    return [fecha(r.date), r.text, r.credit ? '' : monto(r.amount), r.credit ? monto(r.amount) : '', monto(saldo)].join(';');
  });
  return [
    'Banco;Banco de ejemplo;;;',
    `Cuenta;Caja de ahorro en pesos;;;`,
    `Período;${fecha(`${month}-01`)} al ${fecha(today)};;;`,
    ';;;;',
    'Fecha;Descripción;Débito;Crédito;Saldo',
    `${fecha(`${month}-01`)};SALDO ANTERIOR;;;${monto(48250)}`,
    ...lines,
  ].join('\r\n');
}

export function seedBudget(): Budget {
  return {
    total: 45000,
    categories: { Supermercado: 15000, 'Delivery y salidas': 6000, Transporte: 8000, Salud: 9000, Otros: 7000 },
  };
}

export function seedGoals(today: IsoDate = todayIso()): SavingsGoal[] {
  const m = (delta: number, day: number) => `${shiftMonth(monthKey(today), delta)}-${String(day).padStart(2, '0')}`;
  return [
    {
      id: 'fondo',
      name: 'Fondo de emergencia',
      currency: 'UYU',
      target: 60000,
      monthly: 3500,
      where: 'Caja de ahorro',
      emergency: { monthlyFixed: 15000, months: 4 },
      movements: [
        { date: m(-4, 1), amount: 13000, note: 'Aporte' },
        { date: m(-1, 1), amount: 3500, note: 'Aporte' },
        { date: m(-1, 18), amount: -2000, note: 'Retiro · arreglo del auto' },
        { date: m(0, 1), amount: 3500, note: 'Aporte' },
      ],
    },
    {
      id: 'vacaciones',
      name: 'Vacaciones',
      currency: 'USD',
      target: 1000,
      monthly: 150,
      where: 'Caja de ahorro en dólares',
      movements: [
        { date: m(-4, 5), amount: 400, note: 'Aporte' },
        { date: m(-1, 5), amount: 150, note: 'Aporte' },
      ],
    },
  ];
}

export function seedDebts(today: IsoDate = todayIso()): Debt[] {
  const month = monthKey(today);
  return [
    { id: 'tarjeta', name: 'Tarjeta de crédito', kind: 'tarjeta', balance: 24300, dueDate: `${month}-09`, minimum: 4860 },
    { id: 'prestamo', name: 'Préstamo', kind: 'prestamo', balance: 19200, installments: { paid: 6, total: 12, amount: 3200 }, dueDay: 20 },
    { id: 'amigo', name: 'Te debe un amigo', kind: 'me-deben', balance: 2000, since: `${shiftMonth(month, -1)}-28` },
  ];
}

/** Las facturas del mes. El alquiler ya está pagado: su gasto está en seedTickets. */
export function seedBills(): Bill[] {
  return [
    { id: 'tarjeta', name: 'Tarjeta de crédito', amount: 4860, dueDay: 9, note: 'pago mínimo', keywords: ['tarjeta'], paid: {} },
    { id: 'luz', name: 'Luz', amount: 2150, variable: true, dueDay: 12, autopay: true, keywords: ['ute', 'luz'], paid: {} },
    { id: 'internet', name: 'Internet y celular', amount: 1890, dueDay: 15, keywords: ['antel', 'internet'], paid: {} },
    { id: 'gastos-comunes', name: 'Gastos comunes', amount: 4540, variable: true, dueDay: 20, keywords: ['gastos comunes'], paid: {} },
    { id: 'alquiler', name: 'Alquiler', amount: 18200, dueDay: 1, keywords: ['alquiler'], paid: {} },
  ];
}

export interface Portfolio {
  holdings: Holding[];
  contributedUsd: number;
  goals: InvestmentGoal[];
  simulation: SimulationAssumptions & { goalId: string };
}

export function seedPortfolio(): Portfolio {
  return {
    holdings: [
      { id: 'indexado', name: 'Fondo indexado', valueUsd: 2900 },
      { id: 'letras', name: 'Letras', valueUsd: 1200 },
      { id: 'cripto', name: 'Cripto', valueUsd: 720 },
    ],
    contributedUsd: 4500,
    goals: [
      { id: 'apartamento', name: 'Entrada del apartamento', targetUsd: 20000, savedUsd: 3100, byYear: 2031 },
      { id: 'retiro', name: 'Retiro', targetUsd: 0, savedUsd: 1720, monthlyUsd: 50 },
    ],
    simulation: { goalId: 'apartamento', monthlyUsd: 200, years: 5, annualRate: 0.05 },
  };
}

/**
 * Lo que ya tiene el servidor simulado del bot: lo subido del seed y un gasto nuevo hecho por WhatsApp,
 * que aparece en el historial la primera vez que se sincroniza.
 */
export function seedServer(today: IsoDate = todayIso()): RemoteExpense[] {
  return [
    { id: 'seed-4', source: 'whatsapp', store: 'Ómnibus', amount: 52, category: 'Transporte', subcategory: 'Ómnibus', payment: 'Efectivo', date: today, createdAt: at(today, 8, 5), phrase: 'ómnibus 52' },
    { id: 'wa-kiosco', source: 'whatsapp', store: 'Kiosco', amount: 120, category: 'Otros', subcategory: 'Varios', payment: 'Efectivo', date: today, createdAt: at(today, 15, 10), phrase: 'kiosco 120' },
  ];
}
