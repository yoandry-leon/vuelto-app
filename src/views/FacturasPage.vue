<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap">
        <div class="rb-navbar">
          <button type="button" class="rb-navlink" @click="goBack">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Inicio
          </button>
          <span class="title">Facturas</span>
          <button type="button" class="rb-navlink end" aria-label="Nueva factura" @click="router.push('/tabs/inicio/facturas/nueva')">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        <div class="hero">
          <span class="rb-small" style="font-size: 14px">Gastos fijos de {{ monthName(month) }}</span>
          <span class="rb-big">{{ formatPesos(state.total) }}</span>
          <div class="rb-progress" style="width: 100%; margin-top: 8px"><span :style="{ width: `${state.total ? (state.paid / state.total) * 100 : 0}%` }" /></div>
          <div class="totals rb-small"><span>Pagado {{ formatPesos(state.paid) }}</span><span>Falta {{ formatPesos(state.pending) }}</span></div>
        </div>

        <div v-if="state.upcoming.length" class="rb-section">
          <span class="rb-label">Por vencer</span>
          <div class="rb-group">
            <div v-for="b in state.upcoming" :key="b.bill.id" class="rb-row bill">
              <button type="button" class="check" :aria-label="`Marcar ${b.bill.name} como pagada`" @click="markPaid(b)" />
              <button type="button" class="grow" @click="edit(b.bill.id)">
                <span>{{ b.bill.name }}</span>
                <span class="sub" :class="{ 'rb-warn': b.daysLeft <= 2 }">{{ dueLabel(b.dueDate, today) }}{{ b.bill.autopay ? ' · débito automático' : '' }}{{ b.bill.note ? ` · ${b.bill.note}` : '' }}{{ b.estimated ? ' · monto estimado' : '' }}</span>
              </button>
              <span class="rb-amount" :class="{ 'rb-muted': b.estimated }" style="font-weight: 500">{{ b.estimated ? '≈ ' : '' }}{{ formatPesos(b.amount) }}</span>
            </div>
          </div>
        </div>

        <div v-if="state.done.length" class="rb-section">
          <span class="rb-label">Pagadas</span>
          <div class="rb-group">
            <div v-for="b in state.done" :key="b.bill.id" class="rb-row bill">
              <button type="button" class="check on" :aria-label="`${b.bill.name} pagada`" @click="unmark(b)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
              </button>
              <button type="button" class="grow" @click="edit(b.bill.id)">
                <span>{{ b.bill.name }}</span>
                <span class="sub">Pagado el {{ Number(b.paid?.date.slice(8, 10)) }}{{ b.paid?.method ? ` · ${String(b.paid.method).toLowerCase()}` : '' }}{{ b.paid?.ticketId && gastos.byId(b.paid.ticketId)?.billId !== b.bill.id ? ' · registrado aparte' : '' }}</span>
              </button>
              <span class="rb-amount rb-muted">{{ formatPesos(b.amount) }}</span>
            </div>
          </div>
        </div>
        <div class="rb-group">
          <label class="rb-row">
            <span class="grow"><span>Avisarme 2 días antes</span><span class="sub">{{ finanzas.remindersOn ? 'A las 10 de la mañana, salvo las de débito automático' : 'Una notificación por cada factura sin pagar' }}</span></span>
            <input type="checkbox" class="rb-switch" :checked="finanzas.remindersOn" @change="toggleReminders(($event.target as HTMLInputElement).checked, $event)" />
          </label>
        </div>
        <span v-if="!finanzas.bills.length" class="rb-empty"><span class="t">Todavía no cargaste facturas</span><span class="s">Tocá + para agregar la luz, el alquiler o lo que pagues todos los meses.</span></span>
        <span class="rb-note">Van aparte de tu presupuesto del mes: pagarlas no cambia lo que te queda para el día a día. Tocá el círculo para marcarla pagada y la factura para cambiarla. Si registrás el pago, se marca sola.</span>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { actionSheetController, alertController, IonContent, IonPage, toastController, useIonRouter } from '@ionic/vue';
import { computed } from 'vue';
import { type Account, accountFor, accountOf } from '@/domain/accounts';
import { billPaymentTicket, type BillStatus, billsForMonth } from '@/domain/bills';
import { dueLabel, monthKey, monthName, todayIso } from '@/domain/dates';
import { formatPesos, parseAmount } from '@/domain/money';
import { useFinanzasStore } from '@/stores/finanzas';
import { enableReminders } from '@/services/reminders';
import { useGastosStore } from '@/stores/gastos';

const router = useIonRouter();
const finanzas = useFinanzasStore();
const gastos = useGastosStore();

const today = computed(() => todayIso());
const month = computed(() => monthKey(today.value));
const state = computed(() => billsForMonth(finanzas.bills, month.value, gastos.tickets, today.value));

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/tabs/inicio', 'back', 'replace');
}

async function toggleReminders(on: boolean, e: Event) {
  if (!on) {
    await finanzas.setRemindersOn(false);
    return;
  }
  if (await enableReminders()) {
    await finanzas.setRemindersOn(true);
    return;
  }
  (e.target as HTMLInputElement).checked = false;
  const alert = await alertController.create({
    header: 'Sin permiso para avisarte',
    message: 'Activá las notificaciones de Rumbo en Ajustes para recibir los avisos de vencimiento.',
    buttons: ['Entendido'],
  });
  await alert.present();
}

function edit(id: string) {
  router.push(`/tabs/inicio/facturas/${id}`);
}

/** La cuenta con que se pagó la última vez esta factura; si no hay, la de débito en las automáticas y la de transferencias en las demás. */
function lastAccount(b: BillStatus): Account | undefined {
  const previous = gastos.sorted.find((t) => t.billId === b.bill.id);
  if (previous) return accountOf(previous, finanzas.accounts);
  return accountFor(finanzas.accounts, b.bill.autopay ? 'Débito' : 'Transferencia') ?? finanzas.accounts[0];
}

/**
 * El círculo: marca la factura pagada y anota el gasto en Movimientos como gasto fijo (no sale del presupuesto).
 * En una variable primero pregunta cuánto vino este mes.
 */
async function markPaid(b: BillStatus) {
  let amount = b.amount;
  if (b.bill.variable) {
    const alert = await alertController.create({
      header: `¿Cuánto pagaste de ${b.bill.name.toLowerCase()}?`,
      message: b.estimated ? `El mes pasado fueron ${formatPesos(b.amount)}.` : undefined,
      inputs: [{ name: 'amount', type: 'text', value: String(b.amount).replace('.', ','), attributes: { inputmode: 'decimal' } }],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Pagada', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { amount: string } }>();
    if (role !== 'confirm') return;
    const typed = parseAmount(data?.values.amount ?? '');
    if (!(typed > 0)) return;
    amount = typed;
    await finanzas.setBillAmount(b.bill.id, month.value, amount);
  }
  const account = lastAccount(b);
  await gastos.addAll([billPaymentTicket(b.bill, { amount, date: today.value, payment: account?.payment ?? 'Transferencia', accountId: account?.id })]);
  const toast = await toastController.create({ message: `${b.bill.name}: pagada y anotada en Movimientos`, duration: 2000, position: 'top', cssClass: 'rb-toast' });
  await toast.present();
}

async function unmark(b: BillStatus) {
  const ticket = b.paid?.ticketId ? gastos.byId(b.paid.ticketId) : undefined;
  // Pagada con un gasto que se registró aparte (se marcó sola): se desmarca cambiando ese gasto
  if (ticket && ticket.billId !== b.bill.id) {
    const alert = await alertController.create({
      header: b.bill.name,
      message: 'Se marcó sola porque registraste el pago. Para desmarcarla, borrá o cambiá ese gasto en Movimientos.',
      buttons: ['Entendido'],
    });
    await alert.present();
    return;
  }
  const sheet = await actionSheetController.create({
    header: ticket ? `${b.bill.name} · también se borra el gasto de ${formatPesos(b.amount)} en Movimientos` : b.bill.name,
    buttons: [
      {
        text: 'Marcar como no pagada',
        role: 'destructive',
        handler: () => void (ticket ? gastos.remove(ticket.id) : finanzas.unmarkBillPaid(b.bill.id, month.value)),
      },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}
</script>

<style scoped>
.hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 4px; text-align: center; }
.totals { display: flex; justify-content: space-between; width: 100%; }
.rb-row.bill { gap: 12px; }
.rb-wrap .bill .grow { text-align: left; }
.rb-wrap .check { width: 26px; height: 26px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--rb-neutral-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rb-wrap .check.on { background: var(--rb-accent); box-shadow: none; }
</style>
