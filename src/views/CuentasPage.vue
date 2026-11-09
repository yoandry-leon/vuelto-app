<template>
  <ion-page>
    <ion-content class="rb-page">
      <div class="rb-wrap cuentas">
        <div class="rb-navbar">
          <button type="button" class="rb-navlink" @click="goBack">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Movimientos
          </button>
          <span class="title">Tus cuentas</span>
          <button type="button" class="rb-navlink end" aria-label="Nueva cuenta" @click="createAccount">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        <div class="hero">
          <button type="button" class="rb-pill" @click="pickMonth">
            Lo que salió en {{ monthName(month) }}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <span class="rb-big">{{ formatPesos(total) }}</span>
        </div>

        <div class="rb-group">
          <button v-for="r in rows" :key="r.account.id" type="button" class="rb-row" @click="openAccount(r.account)">
            <span class="grow">
              <span>{{ r.account.name }}</span>
              <span class="sub">{{ ACCOUNT_KIND[r.account.payment] }} · {{ r.count === 1 ? '1 gasto' : `${r.count} gastos` }}</span>
            </span>
            <span class="rb-amount amount">{{ r.spent ? formatPesos(-r.spent) : '$ 0' }}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        <button type="button" class="rb-btn secondary" @click="importStatement()">Importar y conciliar extracto</button>

        <span class="rb-note">Cada gasto sale de una cuenta, y su medio de pago es el tipo de esa cuenta. Incluye los gastos fijos: la plata salió igual, aunque no cuente en el presupuesto del día a día.</span>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { actionSheetController, alertController, IonContent, IonPage, useIonRouter } from '@ionic/vue';
import { computed, ref } from 'vue';
import { askAccountKind, askAccountName, createAccount } from '@/composables/accountPrompts';
import { ACCOUNT_KIND, type Account, spentByAccount } from '@/domain/accounts';
import { monthKey, monthLabel, monthName, todayIso } from '@/domain/dates';
import { formatPesos, round2 } from '@/domain/money';
import { useFinanzasStore } from '@/stores/finanzas';
import { useGastosStore } from '@/stores/gastos';

const router = useIonRouter();
const finanzas = useFinanzasStore();
const gastos = useGastosStore();

const month = ref(monthKey(todayIso()));
const rows = computed(() => spentByAccount(gastos.tickets, finanzas.accounts, month.value));
const total = computed(() => round2(rows.value.reduce((s, r) => s + r.spent, 0)));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function pickMonth() {
  const options = [...new Set([monthKey(todayIso()), ...gastos.months])].sort().reverse().slice(0, 12);
  const sheet = await actionSheetController.create({
    header: 'Mes',
    buttons: [...options.map((m) => ({ text: capitalize(monthLabel(m)), handler: () => void (month.value = m) })), { text: 'Cancelar', role: 'cancel' }],
  });
  await sheet.present();
}

/** Tocar una cuenta: ver sus gastos, cambiarle el nombre o el tipo, o borrarla. */
async function openAccount(a: Account) {
  const sheet = await actionSheetController.create({
    header: `${a.name} · ${ACCOUNT_KIND[a.payment]}`,
    buttons: [
      { text: 'Ver sus gastos', handler: () => void router.push(`/tabs/movimientos?cuenta=${encodeURIComponent(a.id)}`) },
      { text: 'Importar y conciliar extracto', handler: () => importStatement(a) },
      { text: 'Cambiar el nombre', handler: () => void rename(a) },
      { text: 'Cambiar el tipo', handler: () => void changeKind(a) },
      ...(finanzas.accounts.length > 1 ? [{ text: 'Eliminar cuenta', role: 'destructive', handler: () => void confirmDelete(a) }] : []),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

/** Subir el extracto del banco de esa cuenta (sin cuenta, la pantalla propone una). */
function importStatement(a?: Account) {
  router.push(a ? `/tabs/movimientos/extracto?cuenta=${encodeURIComponent(a.id)}` : '/tabs/movimientos/extracto');
}

async function rename(a: Account) {
  const name = await askAccountName('Nombre de la cuenta', a.name);
  if (name) await finanzas.updateAccount(a.id, { name });
}

async function changeKind(a: Account) {
  const payment = await askAccountKind(`¿Qué tipo de cuenta es ${a.name}?`);
  if (payment) await finanzas.updateAccount(a.id, { payment });
}

async function confirmDelete(a: Account) {
  const alert = await alertController.create({
    header: `¿Eliminar ${a.name}?`,
    message: 'Sus gastos no se borran: pasan a otra cuenta de su mismo tipo, si tenés una.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Eliminar', role: 'destructive' },
    ],
  });
  await alert.present();
  if ((await alert.onDidDismiss()).role === 'destructive') await finanzas.removeAccount(a.id);
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/tabs/movimientos', 'back', 'replace');
}
</script>

<style scoped>
.cuentas { gap: 16px; }
.hero { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 4px 0 8px; }
.rb-row { gap: 10px; }
.amount { font-weight: 500; }
</style>
