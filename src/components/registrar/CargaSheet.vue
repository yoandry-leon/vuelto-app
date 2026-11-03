<template>
  <ion-content class="rb-page">
    <div class="rb-wrap carga">
      <div class="rb-navbar">
        <button type="button" class="rb-navlink" @click="emit('close')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Seguir
        </button>
        <span class="title">Tu carga</span>
        <button v-if="carga.items.length" type="button" class="rb-navlink end danger" @click="clear">Vaciar</button>
        <span v-else />
      </div>

      <div class="hero">
        <span class="total rb-amount">{{ cartTotal(all) }}</span>
        <span class="sub">{{ all.length === 1 ? '1 gasto' : `${all.length} gastos` }} · todavía sin guardar</span>
      </div>

      <div v-if="all.length" class="rb-group list">
        <div v-for="(d, i) in carga.items" :key="d.id" class="row">
          <span class="num" aria-hidden="true">{{ i + 1 }}</span>
          <button type="button" class="grow" @click="open(d)">
            <span class="t">{{ d.title }}</span>
            <span class="s">{{ draftSubtitle(d, finanzas.accounts) }} · {{ draftOrigin(d) }}</span>
          </button>
          <span class="amt rb-amount">{{ draftAmountText(d) }}</span>
          <button type="button" class="x" :aria-label="`Quitar ${d.title}`" @click="carga.remove(d.id)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <!-- El que está en el teclado también se guarda: se marca con el número en verde -->
        <div v-for="d in editing" :key="d.id" class="row">
          <span class="num current" aria-hidden="true">{{ carga.items.length + 1 }}</span>
          <button type="button" class="grow" @click="emit('close')">
            <span class="t">{{ d.title }}</span>
            <span class="s">{{ draftSubtitle(d, finanzas.accounts) }} · el que estabas cargando</span>
          </button>
          <span class="amt rb-amount">{{ draftAmountText(d) }}</span>
          <button type="button" class="x" :aria-label="`Borrar ${d.title}`" @click="emit('discardEditor')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <div v-else class="rb-empty"><span class="t">No hay nada en la carga</span><span class="s">Escribí, dictá o escaneá un gasto y tocá "+ Agregar otro".</span></div>
      <span v-if="carga.items.length" class="rb-note">Tocá un gasto para corregirlo.</span>

      <div class="actions">
        <button type="button" class="rb-btn secondary" @click="emit('close')">+ Agregar otro</button>
        <button type="button" class="rb-btn primary" :disabled="!all.length" @click="emit('save')">{{ all.length ? `Guardar ${all.length} · ${cartTotal(all)}` : 'Guardar' }}</button>
      </div>
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { actionSheetController, alertController, IonContent } from '@ionic/vue';
import { computed } from 'vue';
import { cartTotal, type Draft, draftAmountText, draftOrigin, draftSubtitle, splitPurchase } from '@/domain/carga';
import { formatPesos } from '@/domain/money';
import { newDraftId, useCargaStore } from '@/stores/carga';
import { useFinanzasStore } from '@/stores/finanzas';

/** Lo que está escrito en el teclado (cero o más borradores: una frase puede ser varios gastos). */
const props = defineProps<{ editing: Draft[] }>();
/**
 * close: volver al teclado · save: guardar todo · edit: corregir ese gasto en el teclado ·
 * discardEditor: borrar lo que estaba escrito en el teclado.
 */
const emit = defineEmits<{ close: []; save: []; edit: [draft: Draft]; discardEditor: [] }>();

const carga = useCargaStore();
const finanzas = useFinanzasStore();
const all = computed(() => [...carga.items, ...props.editing]);

/** Un gasto suelto se corrige en el teclado; una compra con productos se puede separar. */
async function open(d: Draft) {
  if (d.ticket.lines.length <= 1) {
    emit('edit', d);
    return;
  }
  const sheet = await actionSheetController.create({
    header: `${d.title} · ${d.ticket.lines.map((l) => `${l.pretty} ${formatPesos(l.amount)}`).join(', ')}`,
    buttons: [
      ...(d.ticket.cfe
        ? []
        : [{ text: `Separar en ${d.ticket.lines.length} gastos`, handler: () => replace(d, splitPurchase(d, newDraftId)) }]),
      { text: 'Quitar', role: 'destructive', handler: () => carga.remove(d.id) },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

function replace(d: Draft, drafts: Draft[]) {
  const i = carga.items.findIndex((x) => x.id === d.id);
  if (i >= 0) carga.items.splice(i, 1, ...drafts);
}

async function clear() {
  const n = carga.items.length;
  const alert = await alertController.create({
    header: '¿Vaciar la carga?',
    message: n === 1 ? 'Se quita el gasto sin guardar.' : `Se quitan los ${n} gastos sin guardar.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Vaciar', role: 'destructive' },
    ],
  });
  await alert.present();
  if ((await alert.onDidDismiss()).role === 'destructive') carga.clear();
}
</script>

<style scoped>
.carga { min-height: 100%; box-sizing: border-box; gap: 16px; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); }
.rb-wrap .rb-navlink.danger { color: var(--rb-danger); }
.hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0 4px; }
.hero .total { font-size: 46px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
.hero .sub { font-size: 15px; color: var(--rb-muted); }
.row { display: flex; align-items: center; gap: 12px; min-height: 68px; border-bottom: 1px solid var(--rb-line); }
.row:last-child { border-bottom: 0; }
.num { width: 28px; height: 28px; border-radius: 50%; background: var(--rb-segment); color: var(--rb-ink-3); font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.num.current { background: #fff; color: var(--rb-accent); box-shadow: 0 0 0 2px var(--rb-accent); }
.rb-wrap .row .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; text-align: left; }
.row .t { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .s { font-size: 14px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amt { font-size: 16px; font-weight: 500; }
.rb-wrap .x { width: 44px; height: 44px; margin-right: -10px; border-radius: 50%; color: var(--rb-muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.actions { margin-top: auto; display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
.actions .rb-btn { min-height: 54px; font-size: 15px; }
</style>
