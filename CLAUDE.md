# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rumbo is a personal-finance mobile app that works **offline** and syncs with the user's WhatsApp-bot account. Expenses are registered by voice, text ("450 feria efectivo"), a photo of the receipt, or the DGI QR code printed on a Uruguayan CFE (Comprobante Fiscal Electrónico). Everything is processed on the phone, queued, and uploaded when the connection comes back. It also covers a monthly budget, savings goals (with an emergency fund), debts, bills due, and investments. The app was previously called Vuelto (receipts only); the receipt and paper-reading code comes from it. Stack: Ionic 9 + Vue 3 (`<script setup>`) + TypeScript + Pinia + Capacitor 8, built with Vite and tested with Vitest.

All UI copy, code comments and test descriptions are in **Rioplatense Spanish** (voseo: "Apuntá al código QR", and "setiembre", not "septiembre"). Keep new code consistent with that.

## Commands

Prefer the **Ionic CLI** (`ionic`, installed globally, not a project dependency) for serving, building and Capacitor tasks:

```bash
ionic serve            # dev server at http://localhost:8100 (runs vite --host=localhost --port=8100)
ionic build            # runs npm run build: typecheck + vite build to dist/
ionic cap add android|ios
ionic cap sync         # build + copy web assets/plugins to native projects
ionic cap open android|ios
```

Tests and typechecking have no Ionic command; use npm:

```bash
npm test               # vitest run (tests/unit/**/*.spec.ts, jsdom)
npm run test:watch
npm run typecheck      # vue-tsc --noEmit
npx vitest run tests/unit/cfe.spec.ts         # single file
npx vitest run -t "resta los descuentos"      # single test by name
```

The test devices' IDs (`IPHONE_UDID`, `WATCH_UDID`, `ANDROID_SERIAL`) live in `.env.local`, which is not committed; `.env.example` lists the variables. Load them with `set -a; source .env.local; set +a`, then use `xcrun devicectl … --device "$IPHONE_UDID"` or `adb -s "$ANDROID_SERIAL"`. They have no `VITE_` prefix, so Vite never bundles them.

There is no linter. `tsconfig.json` is `strict` with `noUnusedLocals`/`noUnusedParameters`, so an unused import or parameter fails `typecheck` and `build`. The `@/` alias maps to `src/` in both Vite and TS.

The browser has no camera. Registrar's camera screen shows a drawn receipt with three buttons instead: "Simular QR" (uses `DEMO_SCAN.qr` from the seed), "Pegar QR" (the text of a real QR) and "Ticket de ejemplo" (`DEMO_PAPER`, a paper receipt with one doubtful amount). Movimientos → sync icon → Pruebas has a "Simular sin señal" switch and "Volver a los datos de ejemplo", which resets every store.

## Architecture

**Layering.** `src/domain/` is pure TypeScript with no Ionic, Vue or Capacitor imports, and it is the only layer with tests. Put business rules there. `src/services/` wraps Capacitor plugins and always has a safe web fallback (check with `Capacitor.isNativePlatform()`). Four Pinia setup stores connect the two layers for the views:
- `stores/gastos.ts`: the `Ticket[]` (every expense, whatever its source) and the per-vendor rules.
- `stores/finanzas.ts`: budget, savings goals, debts, bills and the investment portfolio.
- `stores/sync.ts`: connection state and the upload/download with the bot's server.
- `stores/carga.ts`: the cart of Registrar ("la carga"), expenses built on screen but not saved yet. It lives in memory only.

`App.vue` runs `gastos.init()` and `finanzas.init()`, then `sync.start()`.

**State and persistence.** Each store serializes its whole state to Capacitor Preferences through `stored(KEYS.x)` (`services/storage.ts`). The keys are `rumbo.gastos.v1`, `rumbo.puestos.v1` (vendor rules), `rumbo.finanzas.v1` (which also holds the accounts), `rumbo.sync.v1`, `rumbo.servidor-simulado.v1` and `rumbo.borrados.v1` (pending deletions). Every mutation ends with `persist()`, which rewrites the full value. On first launch (nothing stored) `init()` loads the seed (`seedTickets()`, `seedBudget()`, `seedGoals()`…) and saves it. The seed builds dates relative to today, so the demo always shows the current month. Changing the shape of a stored type means handling data already stored under its key.

**Money rules** (`domain/totals.ts`, `domain/money.ts`). These rules are the core of the app:
- Amounts are plain `number` pesos, IVA included. Round every sum with `round2`.
- `Discount.amount` is positive and is **always subtracted** (Ley 19.210, bank, store). This is deliberate: a competitor showed the Ley 19.210 line without subtracting it.
- Credit notes (CFE types 102 and 112, `CREDIT_NOTE_TYPES`) flip sign in both `ticketTotals` and `summarize`.
- `checkAgainstQr` compares `|net|` with `cfe.total` within `QR_TOLERANCE` (0.50) to validate the line reading.
- `formatUYU` produces `$ 1.046,40` (dot for thousands, comma for decimals, U+2212 `−` for negatives). `formatPesos` is the Rumbo display format (`$ 12.450`, `− $ 450`, `+ $ 2.000`, decimals only when the amount has cents); `formatUsd` does the same with `USD`. Use `parseAmount` for user input, since it accepts both `1.046,40` and `1046.40`.
- Budget (`domain/budget.ts`) splits each ticket's discounts across its lines proportionally, and `vsPrevious` compares with the previous month up to the same day. A category is `atRisk` from 80% of its limit.
- **The budget covers day-to-day spending only.** Bills (fixed costs) are tracked separately in Facturas. `budgetStatus(..., bills)` and `monthProjection` drop incomes and any expense that `billPaymentIds` recognizes as a bill payment, so paying a bill (with the circle or by registering the expense) changes neither what is spent nor the projection.
- `monthProjection` is what is spent so far plus what the previous month spent after today's day, rounded to whole pesos.
- Fixed costs are still visible:
  - Paying a bill adds an expense with `Ticket.billId`, and `useFixedCostIds` (`composables/fixedCosts.ts`) marks these as "Gasto fijo · Factura" in Movimientos and Hoy.
  - Inicio reads "Te quedan para gastos del día a día". Its "Gastos fijos de octubre" card shows what has been paid of the month's total, with a bar and the next bill.
  - Presupuesto opens with "Plan de octubre": fixed costs plus the day-to-day budget, a split bar, and a link to Facturas. Below come the day-to-day card, the projection and "Día a día por categoría".
- Expenses paid in dollars keep their lines in pesos, converted at `USD_RATE` (`domain/money.ts`, 40 until the server provides the day's rate), so the budget keeps working. The original amount is in `Ticket.usd` (`{ amount, rate }`), which is what lists and `GastoPage` show, and it travels to the server as `RemoteExpense.usd`.

**Accounts** (`domain/accounts.ts`). Every expense comes out of an account ("Efectivo", "BROU débito", "Visa Itaú"), stored as `Ticket.accountId`. Each account's `payment` is its type, and `Ticket.payment` is always that type, so the code that reads the payment method didn't change.
- The accounts live in `finanzas.accounts` (`FinanzasData.accounts`). Older data without them gets `DEFAULT_ACCOUNTS`: Efectivo, Tarjeta de débito, Tarjeta de crédito, Transferencias.
- `accountOf` resolves a ticket's account. Tickets without `accountId` (older data, or one whose account was deleted) fall back to the first account of their payment method.
- `gastos.addAll` (and `carga.add`, so the cart can show the name) runs `assignAccounts`. Anything without an account, such as a dictation, Siri, the watch or a read ticket, gets the account of its payment method ("con débito" → the debit account), preferring `lastAccountId`, the account of the last expense.
- The keypad's account button and the "Cuenta" rows in Editar gasto and Ticket por QR open `components/AccountSheet.vue`, which also has "+ Nueva cuenta" (`composables/accountPrompts.ts`: a name, then a type).
- Movimientos has a "Cuenta" chip (`?cuenta=<id>` filters). "Tus cuentas" (`views/CuentasPage.vue`, `/tabs/movimientos/cuentas`) shows `spentByAccount` for a month. That includes fixed costs and excludes incomes; there are no balances. Tapping an account lets you see its expenses, rename it, change its type or delete it (never the last one).
- `accountId` travels to the server (`RemoteExpense.accountId`) and is part of `reflects`, so changing an expense's account uploads it again.

**Dates** are local `IsoDate` strings (`'2026-09-30'`), never `Date` objects in the model. Month keys are `'YYYY-MM'` (`monthKey`, `shiftMonth`). UI labels come from `relativeDay` ("Hoy", "Ayer"), `dueLabel` ("Vie 9 · en 3 días") and `timeOf`.

**Registering an expense** (`views/RegistrarPage.vue`, "Nuevos gastos"). It works like a cart: expenses go into "la carga" (`stores/carga.ts`, the pure helpers are in `domain/carga.ts`) and nothing is saved until "Guardar todo", which calls `gastos.addAll` and returns to Inicio with a toast. Every cart entry is a `Draft` (`{ id, title, ticket: NewTicket }`).
- The keypad screen has the cart list, "Sumar" chips (`frequentExpenses`: the single-line expenses repeated most often, then the most recent), and the expense being typed. That expense has an amount from the numeric keypad (`pressKey`, `keypadDisplay`, `keypadAmount`), a `$`/`USD` toggle, a description, a 3×2 category grid of day-to-day categories (`KEYPAD_CATEGORIES`: Supermercado, Delivery, Transporte, Salidas, Salud, Otros; Delivery and Salidas are subcategories of "Delivery y salidas", and the last cell turns into Servicios or Hogar when the description says so), an account button (a payment method said in the description picks the account of that type unless one was chosen) and a date. The typed expense counts in "Guardar todo" and moves into the cart with "+ Agregar otro".
- A phrase typed in the description with no amount on the keypad ("450 feria efectivo y 52 de ómnibus") is parsed like dictation: `parseQuickEntries` → `phraseDrafts`.
- The keypad screen shows the cart as one row ("En la carga · sin guardar", the last one added and the total). Tapping it opens "Tu carga" (`components/registrar/CargaSheet.vue`), which lists every draft plus the expense being typed ("el que estabas cargando"), each with its origin (`draftOrigin`: Voz, Teclado, QR DGI, Foto or Sugerencia for the "Sumar" chips). Tapping a single-line draft loads it back into the keypad to correct it (what was typed moves into the cart first); a purchase with several items can be split. "Vaciar" (with confirmation) empties the cart, and each row has its own ×.
- Voz (`components/registrar/VozSheet.vue`) and the camera (`CamaraSheet.vue`) open as full-screen `ion-modal`s over the keypad, not as routes. Ionic sends each tab button to the last URL visited in that tab, so with routes the + button would reopen Voz after saving from it.
- `?modo=voz|foto|qr` opens the matching modal (`escuchar=1` starts listening). Each URL is handled once (`handledPath`), so going back to the tab doesn't reopen it, and `nativeBridges` adds `&n=<timestamp>` to every external `rumbo://registrar` link so a second tap on a widget still works.
- Voz parses with `parseQuickEntries` (`domain/quickEntry.ts`), which first runs `spokenToDigits` (`domain/spokenNumbers.ts`) because dictation can return amounts in words ("mil doscientos", "dos lucas y media"); small numbers below 10 on their own ("dos empanadas") are left alone. `phraseDrafts` turns the result into drafts, shown under "Nuevos". `splitDuplicates` holds back anything already in the cart with the same name and amount ("Ómnibus $ 52: ¿duplicado?") until the user taps "Es otro viaje, agregarlo". Tapping a row changes its amount or category, or splits a purchase into one expense per item (`splitPurchase`).
- One phrase can hold several amounts ("en la feria gasté 168 de cebolla, 120 de tomate y 90 de papa"). `parseQuickEntries` splits it into `QuickItem`s:
  - It splits at commas and "y", decides once per phrase whether the amount comes before or after its words, and attaches amount-less chunks to the right item ("pan y leche 180").
  - Each keyword in `KEYWORDS` has a kind: `lugar` (feria, súper), `producto` (cebolla, yerba) or `gasto` (almuerzo, ómnibus).
  - `gasto` items (bus, lunch) always stand alone. `together` is true when at least two of the other items form one purchase, either because a single place was named or because they are all products. `phraseDrafts` makes that purchase one draft with one line per item, and makes each `apart` item its own draft. `gastos.addFromPhrase` (Siri and the watch) uses the same function.
  - Dictation quirks handled in the domain:
    - Uruguayan prices: "cuatro 80" → 480, and "4 480" → 480 (`joinPrices` in `spokenNumbers.ts`).
    - Spoken corrections: "o sea", "perdón", "corregí eso" make the next amount replace the previous item.
    - Periods act as separators.
    - Filler words are dropped ("ok", "bien", and "paste" for a misheard "gasté").
    - `MISHEARD` maps an item named only "Steam", "Sting" or "este" to STM.
  - A payment method said at the end, or said only once in a single purchase, applies to everything.
- Dictation goes through `services/speech.ts`. The mic button starts on a short tap and stops on the next one, or works as push-to-talk while held ("Mantené para sumar más": each dictation adds to "Nuevos"). Natively it uses the app-local `OfflineSpeech` plugin, and in the browser the Web Speech API. The plugin emits `partial` while the person speaks and `end` when the recognizer stops by itself (long silence or error).
- The camera keeps `@capacitor-mlkit/barcode-scanning`'s `startScan()` running live. The plugin draws the preview behind the WebView, so `html.rb-scanning` (`theme/app.css`) makes everything transparent except `.camara`. The dark frame around the viewfinder is a large `box-shadow`. A DGI QR shows the "QR de la DGI detectado" card. The shutter takes a paper photo (`takePaperPhoto`: the document scanner on Android, the Camera plugin on iPhone), and the gallery button uses a file input (`pickImageFile`). After a ticket is added the camera stays open for the next one.
- Ticket por QR (`TicketQr.vue`): `parseCfeQr` (DGI URL `...consultaQR/cfe?RUT,TIPO,SERIE,NUMERO,TOTAL,FECHA,CODIGO`, validates the RUT check digit) → store name from `gastos.storeNameFor` (`KNOWN_STORES` or an earlier ticket with that RUT), category and payment → `demoReceiptReader.readLines(header)` → `qrDraft`. A ticket already saved or already in the cart is detected by `cfeKey` (rut-type-serie-number) and can't be added again. "Separar por productos" takes a photo and opens the paper screen with the QR as context. That makes one QR ticket with the photo's lines, and any amount above the QR total becomes a "Descuentos del ticket" discount.
- Ticket en papel (`TicketPapel.vue`): the paper-receipt flow described below. Rows are grouped by category (`productCategory` from the name, `paperGroups`), and `paperDrafts` adds either one expense or one per category ("Por categoría"). A doubtful amount must be confirmed ("Sí, es $ 210") or fixed before adding.

**Ticket sources.** `Ticket.source` takes one of five values (`SOURCE_LABEL` in `domain/categories.ts`):
- `'qr'`: verified through the DGI QR.
- `'papel'`: a photo of a receipt with no QR, such as a market stall's.
- `'voz'` and `'texto'`: a phrase, kept in `Ticket.phrase`.
- `'whatsapp'`: registered through the bot and downloaded on sync.

A ticket with `review` set (e.g. "No se leyó el monto") is not uploaded until the user types the amount in `GastoPage` and saves.

**Editing a movement** (`views/GastoPage.vue`, "Editar gasto"). Tapping a movement opens a form; nothing changes until "Guardar cambios", which calls `gastos.edit` (`TicketEdit`) and marks an uploaded ticket `pendiente` again.
- The form has Gasto/Ingreso, the amount with `$`/`USD` (single-line tickets only; with several items the amount is their sum and each item's category can be changed), Descripción (the store), Categoría, Cuenta (the account, which sets the payment method), Fecha, Nota (`Ticket.note`) and Comprobante (attach a photo to `photoUri`).
- Under the form there is a sync line ("Registrado por voz · se sube al volver la conexión") and "Eliminar gasto".
- An income is `Ticket.kind = 'ingreso'`. Lines stay positive. `isIncome`/`expensesOnly` (`domain/totals.ts`) keep incomes out of `budgetStatus`, `monthProjection`, `summarize`, bill matching, the widget's "today" and the "Sumar" chips. Lists show incomes as `+ $ X` in green, and the day totals in Movimientos add them.

**Sync** (`domain/sync.ts`, `stores/sync.ts`, `services/syncServer.ts`). Every ticket has `sync: { state: 'pendiente' | 'subido', remoteId? }`.
- `pendingToUpload` is every `pendiente` ticket without `review`. Editing an uploaded ticket marks it `pendiente` again.
- `syncNow()` first sends deletions, then pushes `toRemote(t)` (the local id goes as `clientId`), then pulls. `mergeRemote` matches by `clientId`, then `remoteId`, then `cfeKey`, so nothing is duplicated; unknown remote expenses are added as `'whatsapp'` tickets.
- A pending ticket only becomes `subido` when the server's copy `reflects` the local one (same store, amount, date, payment, category, kind and note). The server's `push` updates an existing `clientId` instead of ignoring it, so an edited ticket uploads again and doesn't stay pending forever.
- Deleting (`gastos.remove`, one id or many) records a `Deletion` (`clientId` plus `remoteId` if known) under the Preferences key `rumbo.borrados.v1`. `syncNow` sends the deletions with `server.remove` before anything else, and `mergeRemote` skips them, so a deleted movement never comes back from the server.
- It runs on start, whenever a new ticket becomes pending, and when the connection comes back (`services/network.ts`).
- The bot's server does not exist yet. `simulatedServer` keeps its data in Preferences, adds 700 ms of latency, and throws `OfflineError` when offline (real or simulated). A real server must implement the same `SyncServer` interface (`push`, `pull`, `remove`).

A paper ticket is unverified and has no discounts. It stores the photo as a downscaled JPEG data URL in `photoUri` (`services/photo.ts`) and may have a `writtenTotal`. `checkAgainstWrittenTotal` compares the lines against `writtenTotal` the same way `checkAgainstQr` compares them against the QR total.

Paper tickets have no RUT or number, so `cfeKey` dedupe doesn't apply. `findSimilarTicket` (same day, same amount) only asks before adding and never blocks.

A reader can flag an amount it isn't sure about with `ReadItem.doubtful`. Apple Intelligence fills a `doubtful` field in the `@Generable` schema, and Gemini Nano writes `?` after the amount ("210?"), which `parsePaperFormat` reads.

The `PaperReader` interface (`services/receiptReader.ts`) is the seam for automatic reading, and `choosePaperReader()` picks the implementation:
- `onDevicePaperReader` (`kind: 'ia'`) on iOS 27 devices whose Apple Intelligence model reports the `.vision` capability.
- `ocrPaperReader` (`kind: 'ocr'`) on Android and on other iPhones. It runs ML Kit text recognition (no AI) and builds lines with `parseOcrLines` (`domain/ocr.ts`), which groups OCR fragments by height so a name and the amount to its right become one item. Tested on real handwriting on a Redmi Note 11, it read 2 fragments out of a whole page, so it is only useful for printed receipts. `domain/ocr.ts` tests include that real capture.
- `manualPaperReader` (`kind: 'manual'`, reads nothing) in the browser.

On Android the photo comes from ML Kit's document scanner (`services/paperCapture.ts`), which crops and straightens the paper and hands the reader a full-resolution file.

On Android, `nanoPaperReader` (`kind: 'ia'`) uses Gemini Nano via `@capacitor-mlkit/genai-prompt` when `checkFeatureStatus()` is `AVAILABLE`.
- It needs AICore (Pixel 9 or newer, Galaxy S24/S25…). On `DOWNLOADABLE` the app requests the download and falls back to OCR meanwhile.
- Nano returns free text, so the prompt asks for the compact line format in `domain/promptFormat.ts` (`PAPER_FORMAT_INSTRUCTIONS` and `parsePaperFormat` live together).
- It runs with `temperature: 0`, `topK: 1` and a fixed seed, so the same photo gives the same reading.
- It requires `minSdkVersion = 26` (`android/variables.gradle`).
- The test Redmi Note 11 returns `UNAVAILABLE`, and the Galaxy S24 Ultra (Android 16, serial in `$ANDROID_SERIAL`) rejects it with AICore error 606 "Feature 636 is not available" (no Prompt API on that model). This path is untested on a real model. The S24 does have on-device speech (`es-US`).

To query plugins on the phone without touching it, attach to the WebView DevTools socket (debug builds only):
- `adb -s <serial> forward tcp:9333 localabstract:webview_devtools_remote_$(adb -s <serial> shell pidof uy.rumbo.app)`.
- Then send `Runtime.evaluate` over the WebSocket listed at `http://localhost:9333/json`, e.g. `Capacitor.Plugins.GenAiPrompt.checkFeatureStatus()`.

Whatever is read only pre-fills the form. `normalizePaperReading` cleans the model output first, and the user always reviews before saving.

**Per-vendor learning** (`domain/vendors.ts`) replaces any hardcoded glossary of market abbreviations. Don't add vendor knowledge to the model instructions by hand.
- The user picks the vendor ("¿De qué puesto es?") in the paper screen's summary card, after the photo. If that vendor has rules and nothing was edited yet, an `ia` reader reads the photo again with them; other readers just re-apply `applyVendorRules`. The model's own store name is ignored, because it hallucinates names and a fake vendor would collect bad rules.
- When the ticket is added to the cart, `learnFromTicket` compares what the model read (each line has `written`, the literal text, plus `name`) with what the user saved. It pairs lines by amount, then by product name, and stores `abbreviations` (written → product) and `products` (last price) for that vendor. Lines it can't pair confidently teach nothing.
- On the next ticket from that vendor, `vendorRulesContext` is passed to the model as extra instructions, and `applyVendorRules` deterministically replaces names whose literal text matches a learned abbreviation.
- The rules are stored on-device only, under the Preferences key `rumbo.puestos.v1`, keyed by `vendorKey(name)`.

**App-local native plugin.** `PaperVision` (`ios/App/App/PaperVisionPlugin.swift`) wraps the Foundation Models framework. It sends `Attachment(cgImage)` plus a `@Generable` `PaperReceipt` schema.
- It is registered in `MainViewController.swift` (`capacitorDidLoad`). The Capacitor 8 template builds the root view controller in code in `SceneDelegate.swift`, which ignores `Main.storyboard`, so `SceneDelegate` must instantiate `MainViewController()`.
- On launch the plugin prints `PaperVision: modelo <status>` to the Xcode/devicectl console, which shows whether the device can read paper receipts.
- New Swift files must be added to the `App` target in `project.pbxproj`. The project has no synchronized folders. Use the `xcodeproj` gem bundled with CocoaPods rather than editing by hand.
- The Mac here runs macOS 26, which lacks the image API, so test this on the iPhone.

**App-local speech plugin.** `OfflineSpeech` exists on both platforms with the same API (`availability`, `start({hints})`, `stop`):
- iOS (`ios/App/App/OfflineSpeechPlugin.swift`, registered next to `PaperVision`) has two engines, and both run on-device. It tries the locales `es-UY`, `es-AR`, `es-419`, `es-US`… in that order. It needs `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`.
  - On iOS 26+ it uses `SpeechAnalyzer` + `SpeechTranscriber` (`.progressiveTranscription`), wrapped in `AnalyzerSession`. On launch, `prepareAnalyzer()` checks `AssetInventory` and downloads the Spanish model if needed; this needs a connection once. It logs `OfflineSpeech: SpeechAnalyzer es_US · <status>`. Microphone buffers are converted with `AVAudioConverter` to `bestAvailableAudioFormat`. Final results are appended and the volatile one is shown on top. The test iPhone uses `es_US`.
  - Otherwise it falls back to `SFSpeechRecognizer` with `requiresOnDeviceRecognition`. That recognizer **restarts its transcription after every pause**, so `receive()` joins the pieces: a piece is closed when `speechRecognitionMetadata` arrives, or when `isNewSegment` detects a restart. It logs `OfflineSpeech: <locale> · sin conexión: <bool>`.
  - It logs `OfflineSpeech: entendido "<text>"` per dictation. `VozSheet` logs `Dictado {phrase, parsed}`, and those make good test cases.
- Android (`android/app/src/main/java/uy/rumbo/app/OfflineSpeechPlugin.java`, registered in `MainActivity.onCreate` before `super`):
  - On Android 13+ it asks the on-device recognizer which Spanish is installed (`checkRecognitionSupport`) and requests the download when that Spanish is only supported. Otherwise it uses Google's recognizer with `EXTRA_PREFER_OFFLINE`, which works offline only if the offline Spanish pack is downloaded.
  - The manifest needs `RECORD_AUDIO` and a `<queries>` entry for `android.speech.RecognitionService`, or `isRecognitionAvailable` returns false on Android 11+.
  - The recognizer **ends its session after each pause** (≈1 s). On the Galaxy S24 it ignores `EXTRA_SEGMENTED_SESSION`. `continueOrFinish` therefore restarts listening with the same intent until the user taps stop (or `MAX_DICTATION_MS`), and `receive()` joins the pieces.
  - `start` resolves on `onReadyForSpeech`, because the mic takes about 1 s to open. Until then the UI shows "Preparando el micrófono…".
  - Logcat tag `OfflineSpeech` logs every partial (`parcial:`), `final:` and `entendido "…"`.
- Each dictation has a `session` number so late callbacks from a cancelled one can't end the current one.

**Widgets, controls, Siri and reminders (iOS).** These features share data through the App Group `group.uy.rumbo.app`. Both targets carry entitlements: `App/App.entitlements` and `RumboWidgets/RumboWidgets.entitlements`. Free Personal Team signing accepts the App Group.
- `composables/nativeBridges.ts` (started from `App.vue`) rebuilds `widgetSnapshot()` (`domain/widgets.ts`) whenever tickets, budget or bills change. The snapshot holds already-formatted text, and the `RumboWidgets` plugin (`App/RumboWidgetsPlugin.swift`) writes it to the App Group and reloads timelines and controls.
- The `RumboWidgets` extension target (iOS 18+, bundle `uy.rumbo.app.widgets`) follows the proposal's Widgets board:
  - `DisponibleWidget`:
    - Small: the amount and "72% de octubre usado".
    - Medium: adds "+ Gasto" and the last three expenses with "N sin sincronizar".
    - Lock screen: a ring of the percent used, plus "$ X disponible / Tarjeta vence el viernes".
  - `RegistrarWidget`: a small 2×2 Voz/Texto/Foto/QR grid, and a mic button on the lock screen.
  - `RegistrarGastoControl`: the "Registrar gasto" control for Control Center and the Action button.
  - The widgets only read `RumboSnapshot` and never recompute; the Swift struct must mirror `WidgetSnapshot` (`usedText` and `nextBill.shortText` come precomputed).
- `App/Shared/` (`RumboShared.swift`, `RumboOpenIntents.swift`) belongs to **both** targets. The open intents return `OpenURLIntent(rumbo://…)`.
- App Intents (`App/RumboAppIntents.swift`, app target only) provide the Siri phrases:
  - "Anotar un gasto en Rumbo" appends the phrase to an App Group inbox without opening the app. `nativeBridges` imports it on launch or resume through `gastos.addFromPhrase`.
  - "Cuánto me queda en Rumbo" and "Qué vence en Rumbo" answer from the snapshot.
  - The project's development region is `es`, so the Siri phrases match in Spanish.
- Deep links use `rumbo://` (`CFBundleURLTypes`) and `deepLinkRoute()` (`domain/deepLinks.ts`). `rumbo://registrar?modo=voz&escuchar=1` opens the Voz screen already listening (`RegistrarPage` → `VozSheet autoListen`).
- Bill reminders use `@capacitor/local-notifications`. `billReminderPlan()` (`domain/bills.ts`) schedules 10:00 two days before each unpaid, non-autopay bill this month and next, but only when `finanzas.remindersOn` is set by the switch in Facturas. Tapping a reminder opens `rumbo://facturas`.
- New widget files must be added to the `RumboWidgets` target with the xcodeproj gem, the same way as other new Swift files. `ionic cap sync` doesn't touch the extension, because the Podfile only covers `App`.

**Apple Watch.** It is built from two watchOS targets embedded in the iOS app. The `Embed Watch Content` build phase copies the watch app to `$(CONTENTS_FOLDER_PATH)/Watch`.
- `RumboWatch` (bundle `uy.rumbo.app.watchkitapp`, watchOS 10+, single-target SwiftUI app) follows the proposal artifact's Watch board, "only the essentials". The flow is Inicio → system dictation → Confirmar → Listo.
  - Inicio shows the available amount, a thin bar and "Dictar gasto". When transfers are queued it adds "Sin conexión · N en cola".
  - Dictation takes one tap (`DictadoView` + `Recorder.swift`). watchOS has no speech API for apps, and its system dictation always opens the keyboard first, so the app records instead.
    - `Recorder` records 16 kHz AAC with live meter bars and stops after 1.6 s of silence.
    - The file goes to the iPhone with `transferFile`. `WatchBridge` transcribes it on-device (`FileTranscriber`: SpeechAnalyzer, falling back to SFSpeechRecognizer) and returns `{id, transcript}` by `sendMessage`, or by `transferUserInfo` as a fallback.
    - If the iPhone is unreachable, or doesn't answer within 12 s, the recording is marked `autosave`. The iPhone then saves the transcript directly to the inbox, with no confirmation.
    - `WatchBridge.activate()` runs in `AppDelegate`, because the watch can wake the app in the background.
    - Typing through `TextFieldLink` only appears when the microphone fails.
  - Confirmar shows the amount, category and payment method from `QuickParse.swift`, a display-only Swift port of the phrase parser. It has "Guardar" and "Cambiar categoría". A changed category travels as `category` in the userInfo, and `gastos.addFromPhrase` applies it.
  - The phrase goes to the iPhone with `transferUserInfo`, which queues while the phone is away. On the iPhone, `App/WatchBridge.swift` appends it to the same App Group inbox as Siri. The plugin then fires an `inbox` event so the app imports it at once (`onInboxChanged` in `nativeBridges`).
- The iPhone sends the snapshot with `updateApplicationContext` each time `RumboWidgets.update` runs. The watch app saves it in its own App Group, which is per device, for the complications.
- `RumboWatchWidgets` (bundle `uy.rumbo.app.watchkitapp.widgets`) is the complications extension. As in the design, it has a ring of the used share with the available amount inside ("12,4k"), plus a "+" complication that opens the app. Both watch targets compile `App/Shared/RumboShared.swift`.
- Installing on the watch: the test watch is an Apple Watch Series 10 on watchOS 27, UDID in `$WATCH_UDID`.
  - Xcode 27 has no "Devices and Simulators" window. Devices live in the separate **Device Hub** app.
  - To connect the watch: in Device Hub choose File → Pair Nearby Device…, then on the watch turn on Developer Mode (Settings → Privacy & Security) and pair it. The Developer Mode option only showed up on the watch after Device Hub had been waiting to pair.
  - Then build the shared `RumboWatch` scheme with the watch as destination, using `-allowProvisioningUpdates -allowProvisioningDeviceRegistration`. That registers the watch's UDID in the free profiles.
  - Install with `xcrun devicectl device install app --device <watch> …/Debug-watchos/RumboWatch.app`.
  - Without that registration, the iPhone's Watch app offers "Instalar", but the install fails.
  - `xcrun devicectl device capture screenshot --device <watch> --destination x.png` takes a screenshot of the watch.
- To check that the watch Swift compiles without a watch, run `xcodebuild -project App.xcodeproj -target RumboWatch -sdk watchos CODE_SIGNING_ALLOWED=NO build`.

**Android widgets and shortcuts** (`android/app/src/main/java/uy/rumbo/app/`):
- The `RumboWidgets` plugin saves the same snapshot JSON in SharedPreferences (`RumboWidgetData`) and redraws the RemoteViews widgets:
  - `DisponibleWidget` uses a small layout, or a medium one from about 250 dp wide (it has quick links), picked by size on Android 12+.
  - `RegistrarWidget` is the 2×2 Voz/Texto/Foto/QR grid, the same as the iPhone's. It only opens `rumbo://registrar?modo=…` links and doesn't read the snapshot.
  - `VencimientoWidget` shows the next bill due.
- `DictarTileService` is a quick-settings tile that opens `rumbo://registrar?modo=voz&escuchar=1`.
- Static launcher shortcuts live in `res/xml/shortcuts.xml`.
- `MainActivity` has an intent filter for the `rumbo` scheme. Capacitor's App plugin turns those intents into `appUrlOpen`.

**Seams for real implementations.** The `ReceiptReader` interface in `services/receiptReader.ts` is where a vision-model backend (`POST /receipts/read`) will plug in. Today it returns fixed lines for the demo QR and a single "total" line for any real QR. `KNOWN_STORES` (RUT → name and category) in `data/seed.ts` is a demo stand-in for a server table. `simulatedServer` is the seam for the bot's real server. The README's "Qué es real y qué es demo" table tracks what is real and what is still demo.

**Bills** (`domain/bills.ts`, `views/FacturasPage.vue`, `views/FacturaPage.vue`). Facturas is reached from Inicio's bill card, which is always there when bills exist ("Próximo vencimiento", "Vencida sin pagar" or "Todo pagado este mes"). It also opens from Metas → Tarjeta de crédito → Ver facturas, and from reminder notifications.
- The + creates a bill (`/tabs/inicio/facturas/nueva`) and tapping a bill edits or deletes it (`/tabs/inicio/facturas/:id`).
- The circle marks it paid by adding the payment as an expense (`billPaymentTicket`: the bill's name, `billCategory`, the last payment method used for it, `billId`). Unmarking deletes that expense.
- A bill is paid by (in order) its own `billId` expense, a manual `paid[month]` record (older data), or a registered expense that `findBillPayment` recognizes. That last kind can only be unmarked by changing the expense.
- A bill with `variable` ("El monto cambia cada mes", like UTE or gastos comunes) shows its `amount` as an estimate (`≈ $ 2.150`, `BillStatus.estimated`) until that month's real amount is known. That amount comes from `Bill.amounts[month]` (typed in the form, or asked when marking it paid) or from the matched payment ticket. The last amount paid becomes the next estimate.
- `findBillPayment` accepts ±5 % for fixed bills and ±35 % for variable ones without a month amount. `BillStatus.amount` (not `bill.amount`) is what Facturas' totals, reminders and the widget use.

**Goal forms.** The + in Metas opens "Nueva meta de ahorro" (`views/NuevaMetaPage.vue`, `/tabs/metas/nueva`), and the + in Inversión opens "Meta de inversión" (`views/NuevaInversionPage.vue`, `/tabs/metas/inversion/nueva`).
- Savings goal: preset chips, target, amount already saved (added as the first movement), "Para cuándo" (`SavingsGoal.deadline`, a month key) and where the money is kept. "Para llegar a tiempo" comes from `monthlyToReach` and becomes the goal's `monthly`.
- "Recordarme el aporte" (`SavingsGoal.remind`) schedules a notification on the 1st of each month at 10:00 (`goalReminderPlan` → `scheduleGoalReminders`, kind `meta`, which opens `rumbo://metas`). Bill reminders use kind `factura`, and each kind only replaces its own notifications.
- Investment goal: target and invested amount in USD, a term in years, and sliders for the monthly contribution and the assumed yearly return. The result uses `futureValue`, and `monthlyNeeded` gives the contribution that reaches the target. Creating it also points Inversión's simulation at the new goal.

**Routing** (`router/index.ts`). Everything lives under `/tabs/` in `TabsPage.vue`, whose tabs are `inicio`, `presupuesto`, `registrar` (the round + button), `metas` and `movimientos`. Detail pages are nested under their tab so the tab bar stays visible: `inicio/facturas`, `inicio/gasto/:id`, `movimientos/gasto/:id` (the same `GastoPage`), `movimientos/sync` (Sincronización, opened from the sync icon in Movimientos and the status pill in Inicio), `metas/ahorro/:id` and `metas/inversion`. The old `sync`, `sync/gasto/:id` and `inicio/movimientos` routes redirect. Registrar and the forms (editing a movement, new goals) are full-screen: `TabsPage` hides the tab bar on those routes (`FULL_SCREEN`), and Cancelar (which asks before discarding the cart) returns to the tab recorded in `composables/lastTab.ts`. Navigate with `useIonRouter()` from `@ionic/vue` so Ionic's page transitions and stack work.

Movimientos has search, the "Sin subir" and "Por revisar" chips, and a category chip that comes from Presupuesto's "Ver gastos" (`?categoria=`). The filters and the search cover every month.
- "Seleccionar" turns on multi-select: rows show a check circle (`GastoRow` `selecting`/`selected`), each day has "Todo el día", and the top bar offers "Todos".
- A red "Eliminar N movimientos" button sticks to the bottom and deletes the selection after a confirmation.
- Selection only covers what the current filters show.

**Theming.** Ionic is forced to `mode: 'ios'` on every platform, and the views mostly use plain HTML styled like iOS grouped lists rather than Ionic list components. The palette is CSS variables `--rb-*` in `theme/variables.css`, following the proposal's "Sistema de diseño" board:
- Colors: accent green `#16815F`, secondary text `#55555A`, gray icons `#8E8E93`, neutral borders `#C7C7CC`, blue `#2F5BEA`, and amber attention backgrounds and text (`--rb-attention*`, `#FFF4E5` / `#8A4B08`).
- Rules: one alert per screen (`rb-alert`), shown only for something that needs action. Sync states are gray icons with no text (`components/SyncIcon.vue`); amber is only for "revisar".
- Shared classes are in `theme/app.css`: `rb-group`, `rb-row` (56 px), `rb-card`, `rb-section`, `rb-btn` with `primary` / `secondary` / `fix` / `neutral` / `soft` (52 px), `rb-chip` (40 px), `rb-pill`, `rb-alert`, `rb-search`, …. Category colors and subcategories live in `domain/categories.ts`. The app is light mode only. The Geist font is bundled via `@fontsource/geist` so the app works offline. Alerts and action sheets use `alertController`/`actionSheetController`.

## Native (Capacitor)

`appId` is `uy.rumbo.app` (`appName` Rumbo; the Android package and `MainActivity` live in `uy/rumbo/app`) and `webDir` is `dist`. The launcher icons and splash screens were drawn by a CoreGraphics script, not `@capacitor/assets`. QR scanning uses `@capacitor-mlkit/barcode-scanning`, which installs the Google scanner module on Android on demand.

**Android** (`android/`):
- `ANDROID_HOME` is not set in this shell. Export `ANDROID_HOME=$HOME/Library/Android/sdk`, then run `ionic cap sync android`, `cd android && ./gradlew assembleDebug`, and `adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk`.
- With an emulator also attached, `adb` needs `-s <serial>`.
- The test phone is a Xiaomi. MIUI rejects USB installs (`INSTALL_FAILED_USER_RESTRICTED`) unless "Instalar vía USB" is enabled in developer options, and every install must be confirmed on the phone's screen within a few seconds.
- The debug APK is ~77 MB, mostly because `@capacitor-mlkit/text-recognition` bundles OCR models for every script (Latin, Chinese, Devanagari, Japanese, Korean).
- JS `console.*` reaches logcat (`Capacitor/Console`) only in debug builds. `ocrPaperReader` logs `PaperOCR {lines, reading}` there, which can be turned into `domain/ocr.ts` test cases.

**iOS** (`ios/`) has some non-obvious constraints:
- It uses **CocoaPods, not SPM**. The ML Kit plugin has no `Package.swift`, so Capacitor 8's default SPM template silently drops the scanner. The platform was created with `npx cap add ios --packagemanager CocoaPods`, because `ionic cap add` doesn't forward that flag.
- `pod install` (also run by `ionic cap sync ios`) crashes with "Unicode Normalization not appropriate for ASCII-8BIT" unless the shell has a UTF-8 locale: prefix with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- The deployment target is **15.5**, set in both the `Podfile` and `project.pbxproj`, because GoogleMLKit 8 requires it.
- **`ios/` can't build for the iOS Simulator.** ML Kit ships no arm64-simulator slice (the pods set `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64`), and Xcode 27 offers no x86_64 simulators. To preview natively, build a throwaway copy of `ios/` outside the repo:
  - Point the Podfile paths at the absolute `node_modules`, delete every `CapacitorMlkit*` pod (barcode scanning, text recognition, document scanner), and remove their plugin classes from `App/capacitor.config.json` → `packageClassList`.
  - Then run `pod install` and build. The QR scanner and the OCR won't work in that build; the rest of the UI will.
- Safe areas only exist natively (they are 0 in the browser). `ion-tab-bar` already adds `--ion-safe-area-bottom` as padding with `box-sizing: content-box`, so don't add it again to its height.
- Signing uses automatic style with the developer's Personal Team (`DEVELOPMENT_TEAM = UUPAXS7TLU`). Free-provisioned installs expire after 7 days: the app, its widgets and the watch app then refuse to open ("invalid code signature… not explicitly trusted").
  - To renew, rebuild with `-allowProvisioningUpdates` (this creates new profiles) and install over the existing app; the data is kept. Reinstall the watch app separately too.
  - If it still won't open, the iPhone has to verify the developer again under Ajustes → General → VPN y gestión de dispositivos, with an internet connection.
- `NSCameraUsageDescription` is set in `ios/App/App/Info.plist`.
