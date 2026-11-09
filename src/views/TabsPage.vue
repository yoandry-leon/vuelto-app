<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet />
      <ion-tab-bar slot="bottom" :class="{ hidden: fullScreen }">
        <ion-tab-button tab="inicio" href="/tabs/inicio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          <ion-label>Inicio</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="presupuesto" href="/tabs/presupuesto">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
          <ion-label>Presupuesto</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="registrar" href="/tabs/registrar" class="plus" aria-label="Registrar gasto">
          <span class="plus-btn">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
        </ion-tab-button>
        <ion-tab-button tab="metas" href="/tabs/metas">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>
          <ion-label>Metas</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="movimientos" href="/tabs/movimientos">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          <ion-label>Movimientos</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/vue';
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { lastTab } from '@/composables/lastTab';

const route = useRoute();
/**
 * Registrar y los formularios (editar un movimiento, nueva meta) van a pantalla completa, como en la propuesta:
 * sin barra inferior, con Cancelar arriba.
 */
const FULL_SCREEN = /^\/tabs\/(registrar|metas\/nueva|metas\/inversion\/nueva|inicio\/facturas\/|movimientos\/extracto|[a-z]+\/gasto\/)/;
const fullScreen = computed(() => FULL_SCREEN.test(route.path));
watch(
  () => route.path,
  (p) => {
    // Las pantallas completas no cuentan: desde Registrar se abre el extracto, y Cancelar no tiene que volver ahí
    if (p.startsWith('/tabs/') && !FULL_SCREEN.test(p)) lastTab.value = p;
  },
  { immediate: true },
);
</script>

<style scoped>
ion-tab-bar {
  --background: rgba(255, 255, 255, 0.96);
  --border: 1px solid var(--rb-line);
  /* Ionic ya suma el área segura como padding-bottom (content-box): no repetirla acá */
  height: 58px;
  padding-top: 6px;
  align-items: flex-start;
}
ion-tab-bar.hidden { display: none; }
ion-tab-button { --color: #6b6b70; --color-selected: var(--rb-accent); --ripple-color: transparent; justify-content: flex-start; gap: 3px; }
ion-tab-button ion-label { font-size: 11px; font-weight: 500; margin: 0; }
ion-tab-button.tab-selected ion-label { font-weight: 600; }
ion-tab-button svg { flex-shrink: 0; }
.plus { --color: #fff; --color-selected: #fff; justify-content: center; }
.plus-btn { width: 52px; height: 52px; border-radius: 50%; background: var(--rb-accent); color: #fff; display: flex; align-items: center; justify-content: center; }
</style>
