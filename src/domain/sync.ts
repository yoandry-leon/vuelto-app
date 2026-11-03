import { cfeKey } from './cfe';
import { mainCategory, ticketTotals } from './totals';
import type { CfeHeader, Category, IsoDate, PaymentMethod, Ticket, TicketSource, UsdAmount } from './types';

/** Un gasto como lo guarda el servidor del bot: una línea, sin el detalle de artículos. */
export interface RemoteExpense {
  id: string;
  /** Id del gasto en el teléfono que lo subió; los del bot no lo tienen. */
  clientId?: string;
  source: TicketSource;
  store: string;
  amount: number;
  category: Category;
  subcategory?: string;
  payment: PaymentMethod;
  date: IsoDate;
  createdAt: string;
  phrase?: string;
  cfe?: Pick<CfeHeader, 'rut' | 'cfeType' | 'serie' | 'number'>;
  /** Pagado en dólares: `amount` va en pesos y acá el monto original. */
  usd?: UsdAmount;
  /** Plata que entró; sin el campo es un gasto. */
  kind?: 'ingreso';
  /** El pago de una factura (gasto fijo). */
  billId?: string;
  /** La cuenta de la que salió. */
  accountId?: string;
  note?: string;
}

export type RemoteExpenseInput = Omit<RemoteExpense, 'id'> & { clientId: string };

/** Lo que sube: pendiente y sin nada para revisar. Lo dudoso espera a que la persona lo corrija. */
export function pendingToUpload(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.sync.state === 'pendiente' && !t.review);
}

export function needsReview(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.review);
}

/** El gasto como lo sube la app. `clientId` deja que el servidor ignore un reintento. */
export function toRemote(t: Ticket): RemoteExpenseInput {
  const category = mainCategory(t);
  const remote: RemoteExpenseInput = {
    clientId: t.id,
    source: t.source,
    store: t.store,
    amount: ticketTotals(t).net,
    category,
    subcategory: t.lines.find((l) => l.category === category)?.subcategory,
    payment: t.payment,
    date: t.date,
    createdAt: t.createdAt,
  };
  if (t.phrase) remote.phrase = t.phrase;
  if (t.usd) remote.usd = t.usd;
  if (t.kind) remote.kind = t.kind;
  if (t.billId) remote.billId = t.billId;
  if (t.accountId) remote.accountId = t.accountId;
  if (t.note) remote.note = t.note;
  if (t.cfe) remote.cfe = { rut: t.cfe.rut, cfeType: t.cfe.cfeType, serie: t.cfe.serie, number: t.cfe.number };
  return remote;
}

/**
 * Un movimiento borrado en el teléfono, para que el servidor lo borre también. `clientId` es el id local
 * (lo que subió la app) y `remoteId` el del servidor, si ya se había subido o vino de WhatsApp.
 */
export interface Deletion {
  clientId: string;
  remoteId?: string;
}

/** Lo que hay que avisar al servidor al borrar estos movimientos. */
export function deletionsFor(tickets: Ticket[]): Deletion[] {
  return tickets.map((t) => ({ clientId: t.id, ...(t.sync.remoteId ? { remoteId: t.sync.remoteId } : {}) }));
}

/** El servidor ya tiene la versión de este gasto que está en el teléfono (con sus últimas correcciones). */
function reflects(t: Ticket, r: RemoteExpense): boolean {
  const mine = toRemote(t);
  return (
    mine.store === r.store &&
    mine.amount === r.amount &&
    mine.date === r.date &&
    mine.payment === r.payment &&
    mine.category === r.category &&
    (mine.kind ?? '') === (r.kind ?? '') &&
    (mine.note ?? '') === (r.note ?? '') &&
    (mine.accountId ?? '') === (r.accountId ?? '')
  );
}

function isDeleted(r: RemoteExpense, deletions: Deletion[]): boolean {
  return deletions.some((d) => (d.remoteId !== undefined && d.remoteId === r.id) || (r.clientId !== undefined && d.clientId === r.clientId));
}

/**
 * Junta lo que tiene el servidor con lo local, sin duplicar:
 * - lo que subió este teléfono (mismo clientId) queda marcado como subido, si el servidor ya tiene su última versión;
 * - un mismo comprobante registrado en el bot y en la app (misma clave del CFE) cuenta una sola vez;
 * - lo demás (lo registrado por WhatsApp) se agrega al historial;
 * - lo que se borró en el teléfono (`deletions`) no se vuelve a agregar.
 */
export function mergeRemote(local: Ticket[], remote: RemoteExpense[], now: string, deletions: Deletion[] = []): Ticket[] {
  const out = [...local];
  for (const r of remote) {
    // Lo borrado en el teléfono no vuelve, aunque el servidor todavía no se haya enterado
    if (isDeleted(r, deletions)) continue;
    // Lo que subió este teléfono (mismo clientId) o ya conocido (mismo id del servidor)
    const mine = r.clientId ? out.findIndex((t) => t.id === r.clientId) : -1;
    const known = mine >= 0 ? mine : out.findIndex((t) => t.sync.remoteId === r.id);
    if (known >= 0) {
      const t = out[known];
      // Queda subido cuando el servidor tiene lo último; un cambio que todavía no llegó sigue pendiente
      if (t.sync.state === 'pendiente') {
        out[known] = { ...t, sync: reflects(t, r) ? { state: 'subido', remoteId: r.id, syncedAt: now } : { ...t.sync, remoteId: r.id } };
      }
      continue;
    }
    let idx = -1;
    if (r.cfe) {
      const key = cfeKey(r.cfe);
      idx = out.findIndex((t) => t.cfe && cfeKey(t.cfe) === key);
    }
    if (idx >= 0) {
      out[idx] = { ...out[idx], sync: { state: 'subido', remoteId: r.id, syncedAt: now } };
      continue;
    }
    out.push({
      id: `w-${r.id}`,
      source: r.source,
      store: r.store,
      date: r.date,
      payment: r.payment,
      lines: [{ raw: r.phrase ?? r.store, pretty: r.store, category: r.category, subcategory: r.subcategory ?? 'Varios', amount: r.amount }],
      discounts: [],
      ...(r.phrase ? { phrase: r.phrase } : {}),
      ...(r.usd ? { usd: r.usd } : {}),
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.billId ? { billId: r.billId } : {}),
      ...(r.accountId ? { accountId: r.accountId } : {}),
      ...(r.note ? { note: r.note } : {}),
      sync: { state: 'subido', remoteId: r.id, syncedAt: now },
      createdAt: r.createdAt,
    });
  }
  return out;
}
