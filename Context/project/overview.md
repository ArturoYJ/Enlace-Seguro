# EnlaceSeguro — resumen vigente

**Revisado:** 2026-11-04
**Checkout de referencia:** rama `develop` del repositorio local enlazado a `origin`.

## Propósito

EnlaceSeguro es un prototipo móvil para ayudar a revisar enlaces sospechosos antes de abrirlos. La app envía la entrada a una API; el backend aplica controles, solicita una inspección automatizada y presenta un resultado explicado. El veredicto es una ayuda para decidir, no una garantía de seguridad.

## Stack y decisiones vigentes

- **App móvil:** React Native con Expo SDK 57/Expo Router. Hay un slice amplio pero aún parcial en `frontend/mobile/` (bienvenida, acceso/registro, sesión, análisis manual de URL/mensaje con extracción local, historial/detalle y cuenta), pero no es la app completa ni tiene QA iOS/Android instalado.
- **Consola admin:** Vite + React/TypeScript independiente en `frontend/admin-console/`, con sesión en memoria; login, métricas y auditoría implementados. QA visual, API en navegador y hosting reales pendientes.
- **API:** Node.js 22, TypeScript y Fastify. Hay código de autenticación, análisis, historial, administración y conexión a MongoDB/sandbox.
- **Persistencia:** MongoDB 8.0.x. La propuesta académica original mencionaba PostgreSQL 16; esa propuesta queda como antecedente y no describe el stack vigente del checkout.
- **Análisis de navegador:** un servicio sandbox Fastify con pool configurable de contextos Playwright/Chromium. La presencia del servicio no demuestra aislamiento de red/contenedor en despliegue.
- **Cuota:** hasta cinco solicitudes admitidas por usuario y día calendario en `America/Mexico_City`; los intentos admitidos se registran en un documento diario.

Fuentes de decisiones y contrato: [`architecture/auth-design.md`](../architecture/auth-design.md), [`architecture/system.json`](../architecture/system.json), [`../../api/openapi.yaml`](../../api/openapi.yaml) y [`../../database/modeling/schema-proposal.md`](../../database/modeling/schema-proposal.md).

## Estado comprobado en el checkout

- La API contiene rutas y casos de uso para registro/login/refresh/logout/perfil, envío de análisis, historial y detalle, eventos de auditoría y métricas administrativas.
- El backend admite solicitud y metadatos del job en la misma escritura MongoDB. El worker ahora reclama trabajos persistentes con polling, lease y fencing; el cap global Mongo transaccional con singleton fue agregado y validado en replica set desechable; no certificar recuperación/estrés en staging.
- El sandbox contiene guardas Anti-SSRF, routing/filtrado de tráfico Playwright, señales básicas, evaluación de veredictos y captura local. Playwright genera WebP real y storage rechaza PNG mal etiquetado; Chromium real verifica firma y persistencia. La integración Mongo/API/worker/Sandbox/Chromium prueba tanto `inconclusive` sin captura/veredicto ante certificado inválido de imagen/iframe como una captura WebP real devuelta por el proxy API. El proxy permanece apagado hasta validar aislamiento privado; el purgador local tiene pruebas, pero no hay scheduler ni validación staging.
- Las rutas internas `/analyze` y `/captures/:attemptId` exigen un token Bearer compartido con la API; `/health` queda público y no hay CORS habilitado. La API requiere URL HTTPS explícita en producción, limita HTTP a loopback no productivo y rechaza redirecciones (ADR-0006); la política está probada unitariamente, pero no acredita TLS configurado en despliegue ni aislamiento de red/egress.
- La app móvil está iniciada, no completa: onboarding, auth, sesión expirada, análisis manual/paste con extracción local de una URL y polling, avisos 5.4/5.5 (offline solo ante error de transporte, cuota solo tras 429), historial/detalle y cuenta/cuota/logout con confirmación; Inicio representa carga y error/reintento de cuota sin ocultar el estado. El cliente conserva el mensaje solo en memoria y envía únicamente la URL extraída; compartir desde otras apps está diferido. 63 pruebas UI/sesión usan respuestas controladas; incluyen rechazo de entradas mayores a 480, restauración temporal sin borrar refresh token y anuncios accesibles de transiciones sin URL ni repetición por polling. No sustituyen E2E móvil instalado contra API ni QA nativa. Se comparó parcialmente el login con Figma en Expo Web 390×884; safe-area nativa y paridad integral siguen sin verificar. La spec fue aprobada el 2026-11-03; plan en `../../docs/roadmap/mobile-implementation-plan.md`.
- Los endpoints de métricas y auditoría usan rango civil inclusivo de `America/Mexico_City`; auditoría convierte a intervalo semiabierto con pruebas de límites UTC/local. La consola ya implementa gate admin, sesión en memoria, filtros aprobados y estados de carga/error/vacío; nueve pruebas, typecheck, lint y build pasan. E2E Chromium fixture-only encontró cero violaciones axe WCAG A/AA en las vistas probadas; falta comparación visual completa con Figma, revisión manual de accesibilidad/contraste y hosting/CORS real.
- No se encontraron adaptadores de VirusTotal, Google Safe Browsing, URLhaus ni RDAP/WHOIS. Los `sourceResults` actuales describen al sandbox/guardas, no consultas a esos proveedores.
- El sandbox devuelve referencias internas y expone `GET /captures/:attemptId`; la API ya ofrece `GET /analyses/{attemptId}/capture` con auth, propiedad, WebP y no-store. Sigue deshabilitado por defecto hasta verificar red privada; no exponer la ruta interna Sandbox al cliente.
- El worker puede terminar `inconclusive` sin análisis/veredicto cuando Chromium observa `ERR_CERT_*` en el documento o cualquier subrecurso; el código estable `tls_certificate_invalid` se audita como `analysis.inconclusive`. Fallos de reputación/fuentes externas aún no están integrados. Migración 004 marca `inconclusive` intentos legacy activos sin input recuperable.
- La propuesta menciona extracción de URL desde mensajes y compartir desde otras apps; la primera está implementada localmente en el cliente para una URL única (hasta 480 caracteres), y el propietario decidió diferir compartir para release inicial. La app no implementa share intents.

## Diseño visual de referencia

El archivo Figma organiza estos grupos: sistema de diseño; bienvenida; acceso; análisis; historial; cuenta y avisos. La spec aprobada y plan en `../../docs/superpowers/specs/2026-11-03-enlaceseguro-mobile-client-design.md` y `../../docs/roadmap/mobile-implementation-plan.md` distinguen pantallas planeadas de capacidades disponibles. El incremento actual incluye navegación inferior e historial/detalle/cuenta básicos; captura permanece bloqueada, la cobertura visual de avisos es parcial y tokens/QA de paridad siguen pendientes.

## Verificación ejecutada el 2026-11-04

- `api`: `npm test` regular: 76/76; typecheck/build pasan. La suite efímera MongoDB 8.0.34 incluye recuperación/lease/fencing, migraciones 004–006, cap global, snapshots de cola sin IDs, filtros admin de `America/Mexico_City`, matriz, smoke, explain, TTL y dump/restore. El flujo HTTP de base usa pool determinista, pero dos casos adicionales ejecutan Playwright real: TLS inválido en imagen/iframe termina `inconclusive` sin veredicto/captura; página limpia guarda WebP real y el proxy API devuelve sus bytes. Un servidor HTTPS local autofirmado prueba que el cliente API falla cerrado antes de que el handler reciba HTTP; no prueba certificados/ruta de producción ni SIGTERM/restart real multiproceso en staging. Snapshots de cola salen a stdout; alertas/sink productivo no están configurados.
- `sandbox`: 47/47 pruebas unitarias, typecheck y build pasan; `npm run test:browser` pasa 9/9 pruebas Chromium con fixtures loopback. El pool real cubre TLS inválido del documento principal y subrecursos como `inconclusive/tls_certificate_invalid`, sin señal DOM, veredicto ni captura; también deadline global, WebP, bloqueo de service workers/adjuntos y solicitudes SSRF secundarias a loopback. Errores Playwright se mapean a señales estables sin mensaje, URL o query. No prueba DNS rebinding, egress, disco colgado, límites de proceso ni aislamiento de red.
- MongoDB: suite efímera integral en MongoDB 8.0.34 pasó bootstrap, integración concurrente de cuota (20 solicitudes, 5 admitidas), paginación P4 sobre tres días, API HTTP+Mongo, migraciones forward-only 004–006 desde strict 003 e idempotencia, cap global, 55 aserciones de validadores + 22 smoke, entrada AES-256-GCM de hasta 64 KiB, claim/lease/recovery/fencing, TTL eventual para historial, resumen personal con límites exactos, fail-closed ante estado parcial, explain P4/P5/A1/A2/A3 y dump/restore lógico a DB hermana. La última ejecución local, 2026-11-04, pasó y su contenedor se eliminó; restore conservó conteos/índices. Staging, backup administrado/PITR y restore persistente siguen pendientes. No presentar como validación productiva.
- `frontend/mobile`: validación local: Jest 63/63 en diez suites, lint, typecheck y export Android/iOS/web pasan; incluye Inicio con cuota compacta y badges semánticos, pantalla 3.2 dedicada, resultados 3.3/3.6, extracción local de una URL desde mensaje, retry explícito e `inconclusive` sin veredicto. Tarjetas muestran hostname/fecha, no ruta/query; sin fuentes no integradas ni capturas. Expo Doctor 21/21 pasó previamente. QA web parcial cubre login; comparación visual de Inicio y pantallas de análisis a 390 px sigue pendiente, sin builds nativos. Despliegue y aislamiento de red siguen sin verificar.

## Límites de seguridad que no deben sobreafirmarse

- El código aplica controles de URL/redirección y contextos temporales, pero no hay configuración de infraestructura versionada que pruebe aislamiento de red/contenedor.
- Chromium usa `chromiumSandbox:true` y TLS estricto (`ignoreHTTPSErrors:false`); un error `ERR_CERT_*` observado en documento principal o subrecurso termina como `inconclusive/tls_certificate_invalid`, sin veredicto/captura. El smoke local de Docker hardened pasa con perfil seccomp Playwright fijado y solo `SYS_CHROOT` añadido, sin red y con Chromium sandboxed (ADR-0010); no valida runner Linux ni egress/aislamiento productivo.
- La evaluación cubre señales heurísticas concretas; no demuestra detección general de phishing ni reputación externa.
- El login usa rate limit compartido Mongo/HMAC (20 por IP/minuto, 10 por cuenta/15 min, reset al éxito, 429+`Retry-After` y fail-closed 503); fue validado en MongoDB 8 desechable, incluido el caso concurrente. No hay CI remoto ni configuración real de proxies/secretos verificada.

## Fuentes

- [`sources.md`](sources.md) — propuesta original, contexto histórico, implementación local y referencia visual.
- [`requirements.md`](requirements.md) — requisitos y estado observado por requisito.
- [`architecture/`](../architecture/) — decisiones, grafo y diagramas vigentes.
- [`../../api/openapi.yaml`](../../api/openapi.yaml) — contrato de la API.
