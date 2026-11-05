# Plan de implementación — app móvil EnlaceSeguro

**Estado:** aprobado; implementación en curso por incrementos
**Spec aprobada por el usuario:** 2026-11-03, `docs/superpowers/specs/2026-11-03-enlaceseguro-mobile-client-design.md`
**Alcance:** cliente React Native iOS/Android; no incluye consola admin, proveedores reputacionales ni recepción de enlaces compartidos.

**Estado actual (2026-11-05):** la app usa Expo SDK 58 (actualizada desde SDK 57 para coincidir con el Expo Go disponible). El usuario confirmó manualmente en iPhone bienvenida, login, navegación, análisis visible en historial y retorno a login al cerrar sesión. Jest: 94 pruebas; lint y typecheck pasan. APK Android compilado, sin prueba en dispositivo. Pendientes: expiración/recuperación de sesión manual, QA visual contra Figma y VoiceOver. Los hitos SDK 57 más abajo conservan el historial de implementación.

## Base de diseño observada en Figma

Inspección de la sección `0 · Sistema de diseño` y pantallas de Análisis del archivo [Enlace-Seguro en Figma](https://www.figma.com/design/ekFR5DJ6fDbGUjO2OkcGHs/Enlace-Seguro?node-id=5-1207).

| Token/nombre visible | Valor observado | Uso inicial |
|---|---|---|
| Primary | `#2F7BF5` | Acción principal, foco, progreso |
| Secondary | `#1F2D45` | Superficies y elementos secundarios |
| Tertiary | `#16233A` | Paneles/superficie de navegación |
| Neutral | `#0A1220` | Fondo profundo |
| Heading / Body / Label | IBM Plex Sans | Familia tipográfica mostrada en las tres muestras |

El board muestra tonos derivados (rampas de color) y variantes de botón primary/secondary/inverted/outlined, pero no se pudieron leer todos los stops/tamaños del inspector: no inventar valores ausentes. Las pantallas de Análisis confirman visualmente base azul marino, tarjetas densas, CTA azul y estados semánticos rojo/rosa (peligroso), verde menta (sin señales), ámbar (sospechoso), línea de progreso y navegación inferior. El texto de resultado debe conservar advertencia de que ausencia de señales no garantiza seguridad.

**Inspección de `3.1 Inicio` (2026-11-04):** frame móvil de 390 × 1016 px. Su orden es encabezado, bloque de análisis, fila resumen y lista reciente, con navegación inferior fija. La fila resumen presenta tres columnas: analizados, peligrosos y sospechosos; precede a los recientes. Los números visibles 18/4/3 son datos de muestra de Figma, no valores de producto. Mantener el orden y la jerarquía, pero conectar solo conteos reales y mostrar estados de carga/error/vacío.

**Contrato de entrada extraído de `3.1 Inicio`:** aceptar URL o mensaje de hasta 480 caracteres; extraer en el cliente un solo destino HTTP(S), quitar puntuación de cierre de oración y enviar solo ese destino a la API. Si no hay URL, hay varios destinos o la URL es inválida, no enviar y pedir corrección. El texto completo del mensaje permanece en memoria local y se limpia tras admitir correctamente el análisis; no entra en telemetría, logs ni persistencia. La API y el sandbox siguen recibiendo una URL, no texto libre.

**Navegación implementada desde el mismo frame:** tabs fijas **Inicio / Analizar / Historial**. Inicio y Analizar comparten la pantalla 3.1; Analizar selecciona estado de tab propio y enfoca el campo, sin duplicar formulario ni requests. Cuenta abre desde el avatar del encabezado. `/auth/me` no expone nombre de perfil, por eso el encabezado usa identidad EnlaceSeguro y no un nombre inventado.

**Límite de medición:** en Figma, `0 · Sistema de diseño` contiene una sola imagen raster dentro de una sección (no variables ni componentes de color separados). Los cuatro colores y la tipografía de la tabla son valores legibles en la imagen; los stops exactos de las rampas, tonos semánticos, opacidades, radios y espacios no son inspeccionables como propiedades vectoriales. Los tokens auxiliares usados por el primer slice siguen siendo aproximaciones visuales temporales. M1 queda abierto hasta medirlos desde una fuente con resolución suficiente o el asset original; no presentar esta primera pasada como paridad visual pixel-perfect. El rótulo de marca en ese board dice “Clinical Defense”; se conserva EnlaceSeguro como identidad del producto y no se copia ese nombre.

### Dirección de producto (para que el sistema no derive a UI genérica)

- **Dominio:** URL, redirecciones, TLS, señales, sandbox aislado, procedencia de fuentes, cuota y privacidad.
- **Mundo cromático:** azul tinta, azul cobalto, pizarra, coral, menta, ámbar, blanco frío y grafito.
- **Firma:** tarjeta de veredicto conectada a una línea temporal de pasos comprobables (recepción, validación, inspección, resultado), separando evidencia de certeza.
- **Defaults reemplazados:** resultado binario por niveles peligroso/sospechoso/sin señales con caveat; spinner genérico por progreso temporal por etapas; URL libre por campo de enlace con acción de pegar; historial tipo tabla por tarjetas compactas con señales de estado.

## Decisión técnica de scaffold

- **Expo SDK 57 estable + Expo Router + TypeScript**, conservando React Native. Se elige la release estable que coincide con el flujo actual de Expo Go durante la transición a SDK 58; Node local 22.23.1 supera el mínimo documentado de 22.13.x. Paquetes nativos se instalarán con `npx expo install` y versiones compatibles del SDK.
- La tabla oficial de SDK 57 fija React Native 0.86, React 19.2.3, iOS 16.4+ y Xcode 26.4+. La comprobación del 2026-11-04 confirma que este equipo solo tiene Command Line Tools: `xcodebuild` requiere Xcode completo y `xcrun` no encuentra `simctl`; no hay `ANDROID_HOME`/`ANDROID_SDK_ROOT`, `adb` ni Maestro. Scaffold/typecheck/bundle pueden validarse aquí, pero builds/simuladores nativos requieren EAS Build, CI macOS/Android o toolchains instaladas. No afirmar QA iOS/Android hasta correrlos en dispositivos reales/emulados.
- Navegación en grupos público/privado con Expo Router; tokens de sesión solo en `expo-secure-store`, nunca AsyncStorage/plaintext. No persistir URLs completas en logs ni caché local persistente.
- Cliente API tipado según OpenAPI; no se crean mocks de proveedores en producción. Uso de fixtures únicamente en tests visuales/unitarios, claramente identificados.

## Fases y tareas

### Avance implementado (2026-11-03)

- Scaffold Expo SDK 57 + Router creado en `frontend/mobile/`; identidad/scheme EnlaceSeguro, IBM Plex Sans, SecureStore y cuatro anclas exactas del sistema Figma configurados. Los tonos auxiliares/medidas visuales siguen provisionales y M1 permanece abierto.
- Primer incremento de UI: bienvenida de tres pasos, acceso, registro y análisis manual integrado a `/auth/*`, `/analyses` y `/auth/me`; respuestas visibles derivan del contrato actual y conservan caveat. Login solo muestra aviso de intentos cuando recibe HTTP 429.
- Refresh token se guarda en SecureStore en iOS/Android; access token permanece en memoria. No se persisten URLs ni se exponen capturas.
- Se agregó historial paginado por cursor, detalle autenticado por `attemptId`/`localDate` y cuenta con perfil/cuota/logout; pestañas inferiores conectan análisis, historial y cuenta. El historial presenta dominio (no URL completa), estado y fecha. Detalle renderiza veredicto, razones, señales y dominios de destino/redirección; no expone referencias de captura ni atribuye consultas a proveedores.
- La restauración de sesión ahora conserva el refresh token ante fallos transitorios de red/servidor; invalida el estado React cuando refresh deja de ser válido y cierra localmente la sesión aunque falle la revocación remota. Reintentar un análisis fallido solo prepara de nuevo la URL; el usuario debe confirmar el POST manualmente.
- El onboarding ahora muestra un aviso de restauración cuando el refresh falla temporalmente y permite reintentar sin borrar el token ni marcar la sesión como expirada. Si el servidor rechaza definitivamente el refresh, se conserva el flujo dedicado de sesión expirada y no se ofrece retry. La acción está deduplicada mientras está en curso.
- Se añadió acción explícita de pegar URL desde el portapapeles; no se lee clipboard al abrir la pantalla ni se envía automáticamente.
- Inicio carga hasta tres análisis reales mediante `GET /analyses?limit=3`, con carga/error+reintento/vacío, navegación a detalle/historial y refresco tras admisión. Muestra solo host y fecha; no renderiza path/query. `GET /analyses/summary` owner-only aplica ventana exacta `[now − 365×24 h, now)`; retención diaria: 366 días. La UI nunca usa cifras de muestra.
- El campo sigue frame 3.1: entrada multilinea URL/mensaje, tope 480, contador, Pegar/Borrar y extracción local de una URL HTTP(S). Solo URL extraída llega a `POST /analyses`; texto original no sale de memoria del cliente. Falla cerrada ante cero/múltiples URL, URL inválida o input demasiado largo. Utilidad y tests de aislamiento del payload añadidos.
- Tabs alineadas con Figma: Inicio/Analizar/Historial. Analizar enfoca el composer de Inicio; Cuenta queda disponible desde el avatar. El usuario de `/auth/me` no trae nombre, así que no se muestra nombre personal ficticio.
- Se configuró Jest + jest-expo y una suite inicial de seis pruebas: cinco de ciclo de sesión (access token solo en memoria; conservar refresh ante red temporal; limpiar refresh tras 401; actualizar estado React al expirar; logout local pese a fallo remoto) y una prueba Router que recorre bienvenida → acceso. RNTL 13 se fijó porque Expo Router SDK57 lo requiere para su testing library.
- Se añadieron dos pruebas Router del flujo de análisis: esquema URL no permitido no dispara `POST /analyses`, y respuesta HTTP 429 explica cuota sin inventar un resultado. RNTL 13 se fijó porque Expo Router SDK57 lo requiere para su testing library.
- Se agregó ruta de resultado tras polling y una prueba del historial con dos páginas cursor, validando que rutas/query privados del enlace no aparecen en pantalla. Los tests usan respuestas controladas en UI, no reemplazan integración/E2E con API real.
- Se añadieron pruebas de UI para `429` en login y `409` en registro, contrastando con los estados diseñados en Figma.
- Se agregó prueba de admisión offline: comunica el error de conexión, mantiene el enlace escrito en el campo para que el usuario reintente manualmente y no genera un POST automático adicional.
- Se probó sesión corrupta en SecureStore: el contenido inválido se elimina localmente, no dispara una llamada API y no hidrata una sesión autenticada.
- Se añadieron pruebas de navegación protegida para historial y cuenta: sin access token, ambas rutas redirigen al acceso y no hacen llamadas API.
- Se añadió prueba de error de conectividad del historial: expone acción manual de reintento y confirma que una página vacía posterior muestra su estado vacío sin duplicar requests.
- Se implementó la pantalla dedicada de sesión expirada: cuando el refresh guardado es rechazado o un recurso protegido confirma expiración tras renovar, las rutas protegidas (incluido onboarding de retorno) dirigen a esa pantalla; los fallos de red al restaurar sesión siguen siendo transitorios y no se presentan como expiración. El login exitoso limpia el estado expired.
- La acción de cierre de sesión en Cuenta ahora abre confirmación 5.3 antes de revocar tokens; la persona puede cancelar, y el diálogo aclara que el alcance es este dispositivo. Se evita que el toque inicial dispare logout.
- Los estados Figma 5.4/5.5 tienen diálogos accesibles: el aviso offline solo aparece ante `NETWORK_ERROR`, conserva la URL y no reintenta el POST; el de cuota solo aparece tras 429 API y usa límite/fecha de reinicio de `/auth/me` si está disponible, sin inventarlos.
- Validación de ese corte inicial: `npm run test:ci` (6 suites, 23 pruebas), `npm run lint`, `npm run typecheck` y `npm run export` para Android/iOS/web pasaron tras añadir pantalla/guards, confirmación, estados offline/reintento y reintento del bootstrap de sesión. La suite móvil evolucionó a 57/57 en diez suites; builds/simuladores nativos siguen pendientes por falta de Xcode y Android SDK.
- Auditoría de dependencias posterior a Jest/RNTL: `npm audit --omit=dev` reporta 14 LOW, 0 moderate/high/critical; los avisos runtime se propagan desde `deepmerge` hacia el toolchain Expo y no se aplicó `--force` por riesgo de salto incompatible del SDK. Requiere reevaluación con actualizaciones compatibles antes del release.
- Pendientes del plan: E2E de app instalada en simuladores con el API/Mongo fixture (workflow listo, ejecución remota pendiente); captura aún deshabilitada hasta verificar aislamiento privado; extraer tokens restantes y completar primitives; QA visual/accesibilidad contra todos los frames, validar anuncios en VoiceOver/TalkBack y completar builds nativos.

### M0 — Scaffold verificable

1. [x] Crear `frontend/mobile/` desde template oficial Expo Router para SDK 57.
2. [~] Establecer scripts de lint/typecheck/test/start y lockfile npm; 29 pruebas cubren sesión (incluida sesión corrupta/expirada/retry transitorio), onboarding, auth errors, análisis (incluido offline, sin reintento automático), lista reciente saneada, navegación, confirmación/cancelación de logout, rutas protegidas, reintento de historial/cuenta y cursor/redacción con API controlada; siguen pendientes flujos completos contra backend. `npm ci --ignore-scripts` limpio posterior a Jest se completó correctamente.
3. [x] Configurar identidad de app, scheme, status bar, orientación y safe areas sin permisos innecesarios.
4. [~] Doctor Expo, lint, typecheck y export Metro Android/iOS/web pasan; pruebas nativas y de dispositivo pendientes por toolchains.

**Salida:** repo ejecuta plantilla limpia en bundle y no deriva fuera de SDK 57.

### M1 — Design system

- [~] 2026-11-04: revisión WCAG encontró `textMuted` y texto blanco sobre CTA con contraste insuficiente. Se agregaron `primaryText`, `primaryAction`, contraste de secundarios y pruebas estáticas WCAG AA (ADR-0009). Se conserva `primary` de Figma para iconos/progreso. Falta QA visual/nativa; variantes nuevas derivadas no son tokens exactos medidos.

1. `theme/tokens.ts`: publicar solamente colores/tipo verificados; valores todavía no inspeccionados quedan deliberadamente ausentes hasta lectura de Figma.
2. Cargar IBM Plex Sans en weights requeridos mediante `expo-font`, validando pesos con la referencia.
3. [~] Implementar primitives accesibles: botones/campos/cards/estados y `BottomTabs` existen; contraste estático AA ahora tiene pruebas. `PrimaryButton` admite variantes primary/secondary/inverted/outlined usando tokens existentes (sin inventar nuevos colores); `Alert` anuncia estados semánticos (errores assertive); `Skeleton` es estático y decorativo. Alert se consume en Cuenta/Inicio/Historial; Skeleton en cargas de perfil de Cuenta, recientes de Inicio e Historial. Feedback accesible y retry permanecen. Showcase dev-only implementado y cubierto por prueba. Falta QA nativa/dynamic type/visual contra Figma.
4. [x] Showcase interno dev-only integrado en Cuenta; no es ruta ni se empaqueta para release. `npm run export` verifica bundles Android/iOS/Web y falla si contienen sus marcadores.
5. [~] El 2026-11-04 QA automatizado de la exportación web detectó falta de `lang`/título y etiqueta ARIA inválida en la paginación de bienvenida. Ya se añadieron idioma/título verificables y progreso accesible. axe-core WCAG 2 A/AA/2.1 AA pasa en los tres slides de bienvenida y acceso/registro a 390 px y 320 px, sin overflow horizontal; esto no sustituye VoiceOver/TalkBack, dynamic type ni QA nativa/Figma.

### M2 — Navegación, sesión y acceso

1. [~] Rutas públicas: bienvenida, acceso, registro, duplicado/429 y pantalla dedicada 5.2 de sesión expirada. Las rutas protegidas distinguen credencial rechazada de fallo transitorio de red; el onboarding ofrece reintentar restauración temporal sin ir al login. Falta QA nativa.
2. [x] API client con base URL por `EXPO_PUBLIC_API_URL`; la app no registra body/URL, email ni tokens. `.env.example` y documentación local disponibles.
3. [~] Refresh token en SecureStore, access token en memoria, restauración/rotación, sign-in, sign-up y logout; distingue expiración permanente y falla transitoria; una sesión recuperada con login vuelve al estado normal. La salida local se completa aun ante fallo remoto; la prueba API valida logout → refresh 401 y revocación Mongo. El workflow Maestro relanza sin limpiar datos y verifica pantalla de acceso, además de comprobar revocación de tokens de la cuenta sintética; ejecución nativa/remota aún pendiente.
4. Manejar de forma distinta `400`, `401`, `409`, `429` y fallos de red; login 429 y cuota de análisis 429 son estados diferenciados, y el aviso offline 5.4 requiere fallo de transporte (no un 5xx HTTP). Status no documentados usan mensaje genérico.
5. [~] 94 pruebas Jest cubren refresh temporal/reintento e invalidado, token solo en memoria, expiración, SecureStore corrupto, navegación, bienvenida → login, URL inválida, 400/401/409/429/red, resultados, métricas, recientes, historial, redacción y portapapeles (lectura solo al tocar Pegar, contenido vacío/oversize/error). Un 422 no documentado tiene regresión de fallback genérico. Errores API en auth, análisis, historial, detalle y cuenta usan mensajes controlados. Ampliar con E2E nativo y builds/dispositivos.

### M3 — Análisis y resultados

1. [~] Inicio: URL o mensaje hasta 480 caracteres; input manual, pegado nativo y botón Pegar rechazan >480 sin truncar silenciosamente; extracción local de una URL. Cuota real integrada como estado compacto del composer; tres análisis recientes usan icono y badge semánticos desde veredicto/estado, fecha y hostname solamente. Métricas reales con ventana `[now − 365×24 h, now)` y TTL 366 días. No se copiaron cifras ni snippets de muestra de Figma. Falta comparativa visual completa a 390×1016, QA nativa y E2E instalado.
2. [~] `POST /analyses` navega a un detalle dedicado; `received`/`processing` muestran progreso, timer derivado de `receivedAt`, polling con backoff y límite de 90 s. Abortar al salir solo detiene polling del cliente: el job durable sigue en backend. “Seguir en segundo plano” vuelve a Inicio y el resultado permanece en historial. Estados visuales reflejan solo `received` y `processing`; no se afirma que una subfase de navegador haya terminado. Error 429 abre aviso 5.5 únicamente con respuesta API. Falta QA visual/nativa y E2E integrado.
3. [~] Resultados `peligroso`, `sospechoso` y `sin_amenazas_detectadas` usan tarjeta semántica, hostname, fecha real, razones del Sandbox y caveat; CTA permite otro análisis o historial. Se omiten señales internas crudas, proveedores no integrados y URLs completas. Captura sigue fuera de la UI hasta cerrar su gate.
4. [~] `failed` muestra error neutral con retry solo tras acción explícita; el nuevo POST puede consumir cuota y se informa. `validation_failed` y `inconclusive` conservan mensajes/estados separados; `inconclusive` nunca se presenta como veredicto benigno o error de infraestructura no probado. Copy de Figma con proveedores, causas y consejos de muestra no se afirma como hecho.
5. API ya implementa `GET /analyses/{attemptId}/capture` autenticado, owner-only y proxy a Sandbox; se mantiene deshabilitado por `CAPTURE_PROXY_ENABLED=false` y oculto en móvil hasta verificar la red privada API↔Sandbox en staging. Pruebas locales cubren propiedad/MIME/tamaño, pero no staging ni aislamiento real.

### M4 — Historial y cuenta

1. [~] Historial con paginación cursor de `GET /analyses`, estados vacío, cargando, error y fin de lista; pruebas UI controladas cubren cursor, offline/reintento y redacción. Icono/badge semántico ahora comparte mapeo con Inicio y deriva solo de veredicto/estado real, incluidos loading e inconclusive. La suite API↔Mongo prueba la paginación backend, pero falta una prueba extremo a extremo del cliente móvil contra API.
2. [~] Detalle desde API autenticada con `localDate`; la integración Fastify+Mongo confirma rechazo cross-owner (404). Falta cubrir ese contrato desde el cliente móvil integrado.
3. [~] Cuenta con `/auth/me`, cuota real y logout local/remoto; ante fallo de perfil muestra acción explícita de reintento y alternativa de volver al acceso; las credenciales expiradas llevan a pantalla de sesión expirada. Figma 5.1 ahora usa fecha real de registro y estadísticas de `/analyses/summary` (total/peligrosos/sospechosos) para la ventana móvil exacta de 365 días con TTL técnico de 366; el total cuenta solicitudes en cualquier estado y los veredictos requieren persistencia. Se omiten nombre y cifras de muestra. Figma 5.3 usa confirmación inferior y acción destructiva, con cancelar/confirmar. Verificación de revocación definida en API/Maestro (relanzamiento conserva sesión cerrada y fixture Mongo sin refresh tokens activos); falta ejecutar E2E nativo/remoto, screenshot QA y foco/modal de lector nativo.
4. Aviso de cuota según error real; no usar contador local como fuente de verdad.
5. Preferencias persistentes y notificaciones push permanecen fuera del MVP. El propietario decidió diferir compartir externo para release inicial y mantener pegar URL; ver `docs/architecture/incoming-share-viability.md`. No se habilitó ningún intent o extensión.

### M5 — QA de producto y visual

1. [~] 94 tests Jest de sesión, navegación, errores auth/análisis, lista reciente sanitizada, cursor, extracción URL y portapapeles usan respuestas controladas. El workflow E2E Android/iOS definido con API/Mongo desechables y Maestro incluye registro inválido 400, login 401, registro duplicado 409 y acceso correcto; happy path valida URL-only cifrada, resultado completado, estado inconcluso sin veredicto, fallo sin veredicto con reintento explícito y logout; cuota exige 429 en el sexto análisis. Fixture API/Mongo local confirmó los tres estados terminales; helper verifica tres entradas cifradas y payload solo para el resultado completado. E2E Maestro instalado/remoto y QA visual/nativa siguen pendientes.
2. Comparación con Figma en viewport/dispositivo iOS y Android; revisar jerarquía, safe areas, tamaños de fuente, estados y contraste. La ejecución nativa local no es posible en este Mac (sin Xcode/simctl, Android SDK/adb ni Maestro). Expo Web actual solo muestra onboarding y no permite autenticar; la vista local observada es 335×710, no el frame 390×1016. No contarla como QA de Inicio/Cuenta.

3. Repo remoto confirmado público el 2026-11-04. Los standard hosted runners usados por `.github/workflows/mobile-e2e.yml` (`ubuntu-24.04`, `macos-26-intel`) no cobran minutos en repos públicos según [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) y [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Workflow aún sin ejecución remota; el checkout local no se ha publicado y no se inicia workflow sin la autorización de publicación correspondiente.
3. Accesibilidad: labels, orden de foco, objetivos táctiles, dynamic type y colores no usados como único portador de estado.
4. Matriz mínima: versión mínima declarada, última iOS soportada, Android mínimo y actual; pantalla compacta y grande.
5. No cerrar la fase solo con Expo Go/web; ejecutar builds EAS o toolchains nativas e instalar en ambas plataformas.

## Criterios de aceptación

- Todas las pantallas incluidas en la spec/Figma tienen ruta, estado o disposición documentada; ninguna integración ausente se presenta como real.
- Cero tokens/URLs/passwords en logs y almacenamiento no cifrado; polling termina y evita avalanchas de requests.
- Contratos cliente coinciden con OpenAPI; 400/401/409/429/error de red tienen tratamiento explícito y statuses no documentados usan fallback seguro.
- CI valida lockfile, typecheck, pruebas y bundle export; prueba nativa por plataforma se incorpora al carril de CI/build correspondiente.
- QA visual y accesible se documenta con evidencia para iOS y Android antes de cerrar G3-APP.

## Dependencias y riesgos

- Antes de pantallas finales: leer y registrar el resto de tokens exactos en Figma; estos datos parciales no autorizan aproximar toda la escala visual.
- Integración depende de job durable y contrato de estados; capturas, de endpoint/API y red privada; flujo “demasiados intentos”, de rate-limit real.
- Costos E2E verificados el 2026-11-04: `origin` es el repo público `ArturoYJ/Enlace-Seguro`; los jobs usan runners estándar `ubuntu-24.04` y `macos-26-intel`, sin runners grandes. GitHub documenta cómputo gratis y sin límite de minutos para runners estándar en repos públicos; el workflow no sube artefactos ni usa datos/secretos reales. Sus límites son 55 min Linux y 60 min macOS; si el repo pasa a privado, el peor caso por timeouts sería aprox. US$4.05 antes del crédito incluido (55×US$0.006 + 60×US$0.062, tarifas consultadas hoy, redondeo por job). Fuentes: [billing y uso](https://docs.github.com/en/actions/concepts/billing-and-usage), [precios de runners](https://docs.github.com/en/billing/reference/actions-runner-pricing), [runners públicos estándar](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). La revisión cubre el costo de cómputo, no almacenamiento/log retention ni política futura de GitHub. El API fixture se enlaza a `127.0.0.1` en iOS; solo Android expone bind `0.0.0.0` para acceso por `10.0.2.2`. `.github/workflows/mobile-e2e.yml` y `ci.yml` siguen locales/untracked; el primer run requiere publicación autorizada, no hecha. Esta máquina tampoco tiene Xcode/Simulator ni Android SDK; no se valida native E2E aquí.
- Capturas E2E: Maestro 2.11 soporta `takeScreenshot` y `--test-output-dir` según [documentación del comando](https://docs.maestro.dev/reference/commands-available/takescreenshot) y [CLI](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options). El workflow actual no captura ni sube PNG. Al ser público el repo, los artifacts también serían accesibles a lectores públicos según [política de descarga de artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts); limitar retención (recomendación: 1 día) y usar exclusivamente datos `example.test` antes de aprobar carga. No subir artifacts hasta aprobación del propietario. Pixel 6/iPhone de CI permitirán QA nativa, pero sus viewports no coinciden exactamente con Figma 390×1016.

## Fuentes técnicas

- Expo SDK 57 y matriz oficial de plataformas: https://docs.expo.dev/versions/v57.0.0/
- Expo Router: https://docs.expo.dev/router/introduction/
- Expo SecureStore: https://docs.expo.dev/versions/v57.0.0/sdk/securestore/
