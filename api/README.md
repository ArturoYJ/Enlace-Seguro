# API — EnlaceSeguro

Servicio backend REST desarrollado con Node.js 22 LTS, TypeScript y Fastify 5.x.
Persistencia en MongoDB 8.0.x Community Server.

## Contrato de API
- [`openapi.yaml`](openapi.yaml) define el contrato completo OpenAPI 3.1.0 para autenticación, gestión de cuotas atómicas, análisis y panel administrativo.
- Diseño de autenticación documentado en [`../Context/architecture/auth-design.md`](../Context/architecture/auth-design.md).

## Integración interna con Sandbox

- Configura `SANDBOX_SERVICE_URL` y un `SANDBOX_SERVICE_TOKEN` aleatorio de al menos 32 bytes, compartido con el Sandbox mediante el gestor de secretos local/de despliegue; no uses el valor placeholder del `.env.example`. HTTP se admite solo para `localhost`/loopback fuera de producción; producción requiere una URL HTTPS configurada explícitamente. La validación TLS estándar de Node permanece activa.
- Las llamadas internas rechazan redirecciones (`redirect: error`) para que el Bearer no se reenvíe a otro origen. No incluyas credenciales, query ni fragmento en la URL base.
- La API envía Bearer a `POST /analyze` y, cuando se habilite el proxy, a `GET /captures/:attemptId`; `/health` no requiere token.
- La autenticación de servicio es defensa en profundidad: el guard de URL y TLS protege el transporte configurado, pero producción aún exige red privada y políticas egress verificadas; esto no demuestra aislamiento de red.
- `SANDBOX_ANALYSIS_TIMEOUT_MS` limita el request HTTP de análisis (default 30000 ms; rango válido 1–120000). Mantén el deadline Sandbox `SANDBOX_ANALYSIS_DEADLINE_MS` (default 25000 ms; máximo 28000) al menos 5 s por debajo del timeout API. Sandbox devuelve 504 al expirar, y el worker reintenta 502/504 con backoff acotado; nunca persiste veredicto benigno por timeout. El `AbortSignal` HTTP por sí solo no cancela Chromium si el cliente API corta antes del deadline Sandbox.
- El procesamiento durable usa polling Mongo embebido en `daily_analyses.attempts`; se quita `setImmediate` de la ruta HTTP. El worker reclama con lease, token de fencing y reintentos exponenciales acotados; el cuerpo de la cola solo guarda referencias, mientras la URL se descifra dentro del API worker.
- `ANALYSIS_JOB_CONCURRENCY` limita trabajos activos por réplica (default 2); `ANALYSIS_JOB_POLL_INTERVAL_MS` ajusta el sondeo (default 1000 ms); `ANALYSIS_JOB_LEASE_MS` controla recuperación tras expiración (default 180000 ms); `ANALYSIS_JOB_SHUTDOWN_GRACE_MS` limita cuánto espera el apagado los polls/jobs activos (default: timeout Sandbox HTTP + 10 s; `40000` con el timeout predeterminado). Debe ser menor que la lease y menor que el plazo de terminación del runtime. Si vence, API cierra y sale con código no cero sin marcar jobs fallidos; quedan leased y fencing/reclaim los recupera al expirar la lease. `ANALYSIS_JOB_MAX_ATTEMPTS` limita intentos totales (default 4). Ajustar concurrencia agregada junto con Sandbox y capacidad Mongo; cada réplica tendrá su propio límite.
- `ANALYSIS_JOB_SNAPSHOT_INTERVAL_MS` emite un evento JSON `analysis_queue_snapshot` en stdout (default 60000 ms; rango 10000–300000). Incluye conteos de cola/leases/reintentos/dead, edad del pendiente más antiguo y trabajo activo por proceso; omite IDs, URL y datos de usuario. No crea ruta pública ni fija umbrales de alerta. Integrar retención/alertas al sink elegido después de G0. Ver [`docs/operations/durable-analysis-queue.md`](../docs/operations/durable-analysis-queue.md).
- `ANALYSIS_JOB_MAX_PENDING` define la capacidad global exacta mediante contador singleton y transacciones Mongo (default local 1000; producción lo exige explícitamente y debe dimensionarse antes de staging). Las transacciones requieren replica set o clúster compatible; API comprueba la topología y la coincidencia del cap con migración 005.
- `GET /analyses/{attemptId}/capture` sirve una captura `image/webp` solo al propietario, sin excepción para administradores, y nunca expone la referencia local. Está deshabilitado por defecto (`CAPTURE_PROXY_ENABLED=false`); habilítalo solo después de verificar aislamiento de red privado API-Sandbox. El proxy rechaza redirecciones, valida MIME/magic bytes y limita el cuerpo a 5 MiB. No se ha validado aún en staging.

## Protección de entradas de análisis

- La API conserva el contrato de entrada de hasta 64 KiB UTF-8 y cifra el valor completo con AES-256-GCM antes de persistirlo en MongoDB. El sobre incluye `keyVersion`, IV, tag y ciphertext; los metadatos asociados (usuario/fecha/intento) están autenticados, y no se guarda el texto nuevo en claro en Mongo.
- El API debe recibir `ANALYSIS_INPUT_ENCRYPTION_KEY` como base64url canónico de 32 bytes, igual en todas las réplicas. Genera una clave con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; no la guardes en Git ni en logs. Respalda la clave junto con las políticas de recuperación: perderla vuelve irrecuperable el historial cifrado. Rotación/versionado formal aún debe definirse antes de producción.
- Aplica `database/migrations/003_encrypt_analysis_inputs.js`, `004_durable_analysis_jobs.js`, `005_analysis_queue_capacity.js` y `006_extend_analysis_history_retention_366_days.js` después de 001/002 antes de arrancar; configura la misma `ANALYSIS_JOB_MAX_PENDING` durante migración y en todas las réplicas. Startup conectado valida cifrado, jobs, topología y capacidad. La 005 preserva TTL histórico y cuenta trabajos activos; sigue un procedimiento forward-only y de ventana controlada. El cifrado de campo no reemplaza cifrado de disco/red, permisos mínimos, gestor de secretos ni revisión de retención.
- El historial autenticado devuelve el valor descifrado solo al propietario. `daily_analyses` conserva el documento 366 días desde el `receivedAt` más reciente; al añadir otro intento se actualiza `purgeAt` a `max(receivedAt)+366d`. La migración de documentos existentes debe calcularlo desde su intento más reciente, no desde la fecha de migración. Al compartir TTL por bucket diario, intentos anteriores pueden permanecer hasta <24 h adicionales; ninguno se purga antes de 366 días. Esta retención conserva los 365 días exactos requeridos para métricas personales; es baseline del ejercicio, no política legal/productiva.

## Métricas personales de Inicio

- `GET /analyses/summary` usa el usuario del JWT; no acepta `userId`, fechas ni período del cliente. Es de solo lectura y devuelve únicamente conteos, sin IDs de análisis, URL/entrada, digest ni datos de proveedores.
- La ventana la fija el servidor como `[now − 365×24 h, now)`, con límites en instantes UTC y predicado exacto sobre `attempts.receivedAt`. El total incluye todo intento admitido en ese intervalo, incluidos pendientes, fallidos, no concluyentes y con error de validación. Los conteos `peligrosos` y `sospechosos` incluyen únicamente el veredicto correspondiente ya persistido.
- En Mongo filtrar propietario y días locales candidatos antes de `$unwind`; después filtrar el timestamp exacto y agrupar. No contar solicitudes rechazadas por cuota: no se persisten. La UI debe renderizar datos reales y estados de carga/error/vacío; las cifras del prototipo Figma no son datos.

## Protección de login

- Antes de arrancar, aplica `database/migrations/002_create_login_rate_limit_buckets.js` después del bootstrap 001 y configura `LOGIN_RATE_LIMIT_HMAC_KEY` con un secreto aleatorio de al menos 32 bytes UTF-8, consistente entre réplicas. No uses el placeholder de `.env.example`.
- Política aprobada: 20 intentos por IP/minuto y 10 fallos por cuenta/15 minutos. El slot por cuenta se reserva atómicamente antes de comprobar credenciales, protegiendo el umbral ante concurrencia; un login exitoso limpia el bucket. MongoDB compartido coordina todas las instancias; si el storage no está disponible, `/auth/login` devuelve 503 (fail-closed), y el exceso responde 429 con `Retry-After`.
- `TRUST_PROXY_CIDRS` admite una lista separada por comas de CIDRs exactos de balanceadores confiables. Vacío significa no confiar en `X-Forwarded-For`; no configures `*` ni confíes en redes no administradas.
- Los buckets guardan IDs HMAC, fechas de eventos y vencimiento, no correo/IP en claro. No se debe agregar correo/IP a logs o auditoría de autenticación.
- La política pasó la suite MongoDB 8.0.34 desechable, incluida una regresión concurrente HTTP; siguen pendientes la configuración de proxy/secretos reales y la validación de despliegue. Ver [ADR-0004](../docs/decisions/ADR-0004-login-rate-limit.md).

## Orígenes web permitidos

- `CORS_ALLOWED_ORIGINS` es una lista de orígenes exactos separados por comas para una consola web alojada en otro origen. Vacía desactiva el acceso CORS desde navegadores; los clientes móviles nativos no necesitan CORS. Se aceptan orígenes HTTPS; HTTP solo para `localhost`, `127.0.0.1` o `[::1]` fuera de producción. No usar `*`, `null`, paths ni credenciales en la URL.
- La API no emite `Access-Control-Allow-Credentials`; el contrato actual usa tokens Bearer, no cookies. Un origen permitido puede enviar `Authorization` y `Content-Type` en preflight. CORS limita qué respuestas ve JavaScript de otro origen; **no reemplaza** autenticación, autorización de rol ni controles de red.
- Antes de desplegar la consola, fijar su origen exacto en staging/producción y probar preflight, cambio de origen, TLS y acceso admin. No hay consola desplegada ni origen productivo aprobado todavía.

## Paginación por cursor

- Los cursores de `/analyses` y `/admin/audit-events` son opacos: el cliente debe reenviar literalmente `nextCursor` sin construirlos ni modificarlos.
- Cursor inválido/corrupto devuelve `400 application/problem+json`; no vuelve silenciosamente a la primera página. `/analyses` limita página a 1–50 (default 10), `/admin/audit-events` a 1–100 (default 20).

## Harness E2E móvil (solo prueba)

- `npm run e2e:server` inicia la API real, el worker durable y un Sandbox sintético que nunca navega a la URL recibida. No es un modo de desarrollo ni debe ejecutarse con datos persistentes.
- Requiere `MONGO_TEST_URI` apuntando a una base **vacía, local y desechable** `enlaceseguro_test_e2e_*` en replica set, migrada 001–006 con `maxPending=100`. Por defecto API escucha solo en `127.0.0.1`; `E2E_API_HOST=0.0.0.0` se permite únicamente para el job aislado con emulador Android. `E2E_API_PORT` default es 3000.
- El workflow `.github/workflows/mobile-e2e.yml` crea y elimina la base temporal; consulta `../docs/architecture/mobile-e2e-readiness.md`. Nunca envíes URLs reales, credenciales productivas ni claves de servicio a este harness.

## Harness local de cierre/recuperación del worker (solo prueba)

- `node tests/operations/worker-shutdown-recovery.mjs` compila la API y valida dos procesos reales contra MongoDB 8.0.34 replica set desechable: drenaje en `SIGTERM` con el segundo proceso disponible, y recuperación del job tras `SIGKILL`, vencimiento de lease y nuevo fencing token.
- Solo usa `127.0.0.1`, Sandbox HTTP sintético y hosts `.test`; requiere Docker activo y la imagen `mongo:8.0.34` ya disponible. No descarga la imagen, no monta volúmenes y no requiere secretos/configuración externa. El harness verifica base vacía y nombre único antes de migrar; su cleanup elimina procesos propios, base temporal y contenedor.
- Esto valida ciclo de vida local y Mongo, no plazo de terminación de un proveedor cloud, TLS/Playwright real, red privada, egress ni staging. Ejecutar únicamente con Docker local disponible.
