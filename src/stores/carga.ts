import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { assignAccounts, lastAccountId } from '@/domain/accounts';
import { cartTotal, type Draft } from '@/domain/carga';
import { cfeKey } from '@/domain/cfe';
import type { Category, CfeHeader, PaymentMethod, Ticket } from '@/domain/types';
import type { CapturedPaper } from '@/services/paperCapture';
import { useFinanzasStore } from './finanzas';
import { useGastosStore } from './gastos';

export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Lo que pasa la pantalla de Ticket por QR a la del papel cuando se separa por productos. */
export interface QrContext {
  header: CfeHeader;
  store: string;
  category: Category;
  subcategory: string;
  payment: PaymentMethod;
  accountId?: string;
}

/**
 * La carga de la pantalla de registrar: los gastos armados con el teclado, la voz o la cámara que
 * todavía no se guardaron. Vive en memoria; nada se registra hasta `saveAll`.
 */
export const useCargaStore = defineStore('carga', () => {
  const items = ref<Draft[]>([]);
  /** El último agregado, que la carga muestra como "recién agregado". */
  const lastId = ref<string>();
  /** El QR que leyó la cámara, para la pantalla de Ticket por QR. */
  const qr = ref<{ header: CfeHeader; warnings: string[] }>();
  /** La foto que sacó la cámara, para la pantalla del ticket en papel (con el QR si es para separar por productos). */
  const photo = ref<CapturedPaper & { qr?: QrContext; demo?: boolean }>();

  const total = computed(() => cartTotal(items.value));

  /** Les pone cuenta a los borradores que no la traen (según su medio de pago), para mostrarla en la carga. */
  function withAccounts(drafts: Draft[]): Draft[] {
    const gastos = useGastosStore();
    const { accounts } = useFinanzasStore();
    const preferred = lastAccountId(gastos.tickets, accounts);
    return drafts.map((d) => ({ ...d, ticket: assignAccounts([d.ticket], accounts, preferred)[0] }));
  }

  function add(drafts: Draft[]) {
    if (!drafts.length) return;
    items.value.push(...withAccounts(drafts));
    lastId.value = drafts[drafts.length - 1].id;
  }

  function remove(id: string) {
    items.value = items.value.filter((d) => d.id !== id);
    if (lastId.value === id) lastId.value = undefined;
  }

  function clear() {
    items.value = [];
    lastId.value = undefined;
    qr.value = undefined;
    photo.value = undefined;
  }

  function hasCfe(header: CfeHeader): boolean {
    const key = cfeKey(header);
    return items.value.some((d) => d.ticket.cfe && cfeKey(d.ticket.cfe) === key);
  }

  /** Guarda la carga (más `extra`, lo que todavía está en pantalla) y la vacía. */
  async function saveAll(extra: Draft[] = []): Promise<Ticket[]> {
    const gastos = useGastosStore();
    const saved = await gastos.addAll([...items.value, ...extra].map((d) => d.ticket));
    clear();
    return saved;
  }

  return { items, lastId, qr, photo, total, add, remove, clear, hasCfe, saveAll, withAccounts };
});
