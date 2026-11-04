/** Fecha local en formato ISO corto: '2026-09-30'. */
export type IsoDate = string;

/** Las categorías de Rumbo. Carnes, almacén o limpieza son subcategorías de Supermercado. */
export type Category = 'Supermercado' | 'Delivery y salidas' | 'Transporte' | 'Servicios' | 'Salud' | 'Hogar' | 'Otros';

export type PaymentMethod = 'Débito' | 'Crédito' | 'Efectivo' | 'Transferencia' | 'Otro';

export type DiscountKind = 'ley19210' | 'banco' | 'comercio' | 'otro';

export interface Line {
  /** Texto tal como viene en el ticket ("YERBA C/PALO 1KG"). */
  raw: string;
  /** Nombre legible ("Yerba con palo 1 kg"). */
  pretty: string;
  category: Category;
  subcategory: string;
  /** Importe de la línea en pesos, IVA incluido, antes de descuentos del ticket. */
  amount: number;
  quantity?: number;
  /** Tasa de IVA si el ticket la indica (22, 10 o 0). */
  ivaRate?: 22 | 10 | 0;
}

export interface Discount {
  label: string;
  kind: DiscountKind;
  /** Monto positivo que se resta del total. */
  amount: number;
}

/** Datos del CFE leídos del QR de DGI. */
export interface CfeHeader {
  rut: string;
  cfeType: number;
  serie: string;
  number: string;
  /** Total declarado en el QR. */
  total: number;
  date: IsoDate;
  securityCode?: string;
  /** URL original del QR, para abrir la consulta en DGI. */
  url: string;
}

/**
 * Cómo entró el gasto.
 * qr: QR de DGI (verificable) · papel: foto de un ticket sin QR · voz y texto: frase como en WhatsApp
 * ("450 feria efectivo") · whatsapp: registrado en el bot, llega al sincronizar · extracto: importado del
 * extracto del banco.
 */
export type TicketSource = 'qr' | 'papel' | 'voz' | 'texto' | 'whatsapp' | 'extracto';

/**
 * pendiente: registrado en el teléfono, todavía no subió a la cuenta del bot.
 * subido: ya está en la cuenta (o vino de ella).
 */
export type SyncState = 'pendiente' | 'subido';

export interface SyncInfo {
  state: SyncState;
  /** Id en el servidor del bot, cuando ya subió. */
  remoteId?: string;
  syncedAt?: string;
}

/** Un gasto. Se llama Ticket por historia: también lo es un gasto dicho por voz, sin comprobante. */
export interface Ticket {
  id: string;
  source: TicketSource;
  store: string;
  date: IsoDate;
  payment: PaymentMethod;
  lines: Line[];
  discounts: Discount[];
  cfe?: CfeHeader;
  /** URI local de la foto del ticket, si se sacó. En los tickets de papel es un data URL JPEG reducido. */
  photoUri?: string;
  /** Total escrito en un ticket de papel, si tiene. Hace las veces del total del QR para controlar la suma. */
  writtenTotal?: number;
  /** Lo que dijo o escribió la persona: "450 en la feria, efectivo". */
  phrase?: string;
  /** Por qué conviene revisarlo antes de darlo por bueno ("No se leyó el monto"). */
  review?: string;
  /** Pagado en dólares: las líneas quedan en pesos (para el presupuesto) y acá el monto original. */
  usd?: UsdAmount;
  /** Plata que entró (un cobro, un reintegro): no cuenta como gasto en el presupuesto. Sin el campo es un gasto. */
  kind?: 'ingreso';
  /** Lo que la persona anota a mano sobre el movimiento. */
  note?: string;
  /** Es el pago de esa factura (un gasto fijo): se ve entre los gastos pero no sale del presupuesto del día a día. */
  billId?: string;
  /** La cuenta de la que salió (o a la que entró). `payment` es el tipo de esa cuenta. Falta en datos viejos. */
  accountId?: string;
  /** El movimiento del extracto bancario que es este gasto (importado de ahí o vinculado a uno ya anotado). */
  bank?: BankRef;
  sync: SyncInfo;
  createdAt: string;
}

/** Un movimiento de un extracto bancario. */
export interface BankRef {
  /** Marca del movimiento (cuenta, fecha, monto y texto): con ella no se importa dos veces. */
  ref: string;
  /** Lo que dice el banco: "COMPRA CON TARJETA DE DEBITO TATA 123". */
  text: string;
}

export interface UsdAmount {
  amount: number;
  /** Pesos por dólar con que se pasó a pesos. */
  rate: number;
}

/** Un gasto armado en la pantalla de registrar, antes de guardarse. */
export type NewTicket = Omit<Ticket, 'id' | 'createdAt' | 'sync'>;
