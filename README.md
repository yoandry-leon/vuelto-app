# Rumbo

App de finanzas personales que funciona **sin conexión** y se sincroniza con la cuenta del bot de WhatsApp. Registrás un gasto por voz, texto, foto del ticket o el **QR de la DGI**; todo se procesa en el teléfono, queda en una cola y sube solo cuando vuelve la señal. Suma presupuesto por categoría, metas de ahorro, deudas, facturas por vencer, fondo de emergencia e inversión.

Stack: **Ionic 9 + Vue 3 + TypeScript + Pinia + Capacitor 8** (iOS y Android), Vite y Vitest.

## Empezar

```bash
npm install
ionic serve          # navegador: http://localhost:8100
npm test             # tests de dominio
ionic build          # chequeo de tipos + build a dist/
```

En el navegador no hay cámara: el modo **QR DGI** ofrece **Simular lectura del QR** o **pegar el texto de un QR real**. En **Sincronizar → Pruebas** podés simular que no hay señal y volver a los datos de ejemplo.

### Celular (Capacitor)

```bash
ionic cap sync         # build + copia a ios/ y android/
ionic cap open ios     # Xcode
ionic cap open android # Android Studio
```

El identificador es `uy.rumbo.app`. Ver `CLAUDE.md` para los detalles de iOS (CocoaPods, UTF-8) y Android.

## Pantallas

| Pestaña | Qué tiene |
| --- | --- |
| Inicio | Disponible del mes, registro rápido, gastos de hoy, próximo vencimiento, movimientos y facturas |
| Presupuesto | Gastado por categoría contra el límite, comparación con el mes anterior, editar límites |
| Registrar (+) | Voz, texto ("450 feria efectivo"), foto del ticket (con lo aprendido de cada puesto) y QR de la DGI |
| Metas | Ahorro (fondo de emergencia con meses cubiertos), deudas y pagos, inversión con simulación |
| Sincronizar | Estado de la conexión, para revisar, por subir y subidos hoy |

## Estructura

```
src/
  domain/          lógica pura, sin Ionic (todo testeado)
    quickEntry.ts  "450 feria efectivo" → monto, categoría, comercio y medio de pago
    budget.ts      presupuesto del mes por categoría
    goals.ts       metas de ahorro, fondo de emergencia, deudas
    bills.ts       facturas fijas, vencimientos y avisos
    investment.ts  valor de la cartera y simulación de aportes
    sync.ts        qué sube, qué falta revisar y cómo se juntan los gastos del bot
    cfe.ts         parser del QR de DGI, RUT, tipos de CFE, clave anti-duplicados
    totals.ts      totales por ticket, chequeo contra el QR, notas de crédito
    paper.ts, ocr.ts, promptFormat.ts, vendors.ts   tickets en papel y lo aprendido de cada puesto
  data/seed.ts     datos de ejemplo
  services/        Capacitor con salida segura en web (red, cámara, escáner, lectura, servidor simulado)
  stores/          gastos, finanzas y sync (Pinia)
  views/           una por pantalla
tests/unit/        Vitest
```

## Qué es real y qué es demo

| Parte | Estado |
| --- | --- |
| Registro por texto y QR de la DGI | Real, sin conexión |
| Foto del ticket con IA local | Real en iPhone con Apple Intelligence (iOS 27); OCR en Android |
| Voz | Real: reconocimiento de iOS y Android dentro del teléfono cuando tiene el español descargado; entiende montos en palabras y "lucas" |
| Cola offline y sincronización | Real en el teléfono; **el servidor del bot es simulado** (`services/syncServer.ts`) |
| Presupuesto, metas, deudas, facturas, inversión | Real, datos locales |
| Cuentas e importación del extracto bancario (CSV) | Real, se lee en el teléfono; las columnas se adivinan y se pueden corregir |
| Widgets, pantalla bloqueada, Centro de control, botón de acción | Real en iPhone (iOS 18+) |
| Siri y Atajos ("Anotar un gasto en Rumbo", "Cuánto me queda en Rumbo") | Real en iPhone, sin abrir la app |
| Avisos de vencimiento | Real (notificaciones locales, se prenden en Facturas) |
| Apple Watch: app (disponible, hoy, vencimiento, dictar) y complicaciones | Real; dictar en el reloj manda el gasto al iPhone |
| Android: widgets, botón del panel rápido, atajos del ícono | Real |
| Nombres de comercios por RUT | **Demo**: tabla local en `seed.ts` |

## Próximos pasos

1. Servidor real del bot y reemplazo de `simulatedServer`.
2. Wear OS (Galaxy Watch), si hace falta.
