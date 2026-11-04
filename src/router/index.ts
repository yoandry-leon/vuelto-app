import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import TabsPage from '@/views/TabsPage.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/tabs/inicio' },
  {
    path: '/tabs/',
    component: TabsPage,
    children: [
      { path: '', redirect: '/tabs/inicio' },
      { path: 'inicio', component: () => import('@/views/HomePage.vue') },
      { path: 'inicio/facturas', component: () => import('@/views/FacturasPage.vue') },
      { path: 'inicio/facturas/nueva', component: () => import('@/views/FacturaPage.vue') },
      { path: 'inicio/facturas/:id', component: () => import('@/views/FacturaPage.vue'), props: true },
      { path: 'inicio/gasto/:id', component: () => import('@/views/GastoPage.vue'), props: true },
      { path: 'presupuesto', component: () => import('@/views/PresupuestoPage.vue') },
      { path: 'registrar', component: () => import('@/views/RegistrarPage.vue') },
      { path: 'metas', component: () => import('@/views/MetasPage.vue') },
      { path: 'metas/nueva', component: () => import('@/views/NuevaMetaPage.vue') },
      { path: 'metas/ahorro/:id', component: () => import('@/views/MetaAhorroPage.vue'), props: true },
      { path: 'metas/inversion', component: () => import('@/views/InversionPage.vue') },
      { path: 'metas/inversion/nueva', component: () => import('@/views/NuevaInversionPage.vue') },
      { path: 'movimientos', component: () => import('@/views/MovimientosPage.vue') },
      { path: 'movimientos/gasto/:id', component: () => import('@/views/GastoPage.vue'), props: true },
      { path: 'movimientos/sync', component: () => import('@/views/SyncPage.vue') },
      { path: 'movimientos/cuentas', component: () => import('@/views/CuentasPage.vue') },
      { path: 'movimientos/extracto', component: () => import('@/views/ExtractoPage.vue') },
      // Rutas de antes del rediseño (Sincronizar era una pestaña)
      { path: 'sync', redirect: '/tabs/movimientos/sync' },
      { path: 'sync/gasto/:id', redirect: (to) => `/tabs/movimientos/gasto/${to.params.id}` },
      { path: 'inicio/movimientos', redirect: '/tabs/movimientos' },
    ],
  },
  { path: '/:rest(.*)*', redirect: '/tabs/inicio' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
