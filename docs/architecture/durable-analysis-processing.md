# Procesamiento durable de análisis

**Estado:** arquitectura MongoDB embebida aprobada por el usuario el 2026-11-03; implementación local validada en MongoDB 8 desechable. Staging, carga, monitorización y recuperación administrada siguen pendientes. No elegir proveedor cloud para la cola en esta etapa.

## Decisión y motivo

Persistir el job como metadatos de cada elemento de `daily_analyses.attempts`. La admisión/cuota y el job se guardan en la misma operación atómica, así no existe ventana entre escribir la solicitud y publicar a una cola separada. Un worker independiente del proveedor consulta Mongo, reclama por CAS y aplica fencing por token. El cuerpo del job lleva solo identidad opaca; el API recupera y descifra la URL desde el registro existente.

Alternativas evaluadas: outbox/colección adicional con transacción y más coordinación; cola administrada condicionada a ADR de nube. Se difieren porque la cola administrada todavía no tiene proveedor aprobado y la transacción separada añade complejidad sin reducir la superficie de datos cifrados ya existente.

## Contrato del job

- La escritura de admisión inicia `processingStatus: received` y `job: { state: queued, attemptCount: 0, availableAt: receivedAt }`.
- El worker reclama un job elegible con una escritura atómica que incrementa intentos, asigna `leaseOwner`, `leaseToken` aleatorio y `leaseExpiresAt`, y mueve el intento a `processing`.
- Si el proceso muere, otro worker puede reclamar la fila al vencer el lease. Cada resultado/reintento/terminal requiere el token vigente; un worker retrasado con token vencido no puede sobrescribir el intento.
- `completed` y `dead` no vuelven a la cola. Fallas temporales de red, timeout, HTTP 429/5xx y respuesta inválida se reintentan con backoff exponencial (1, 2, 4… hasta 60 segundos) hasta el máximo configurado; fallas no reintentables se marcan `failed`. Al agotarse los intentos la transición terminal y auditoría usan códigos estables sin texto crudo.
- Reintentos máximos por defecto: 4; el rango de configuración es 1–10. Concurrencia por réplica default 2; polling default 1 s. El lease default 180 s debe superar al timeout HTTP del Sandbox por al menos 10 s.
- Al recibir SIGINT/SIGTERM el worker deja de reclamar jobs y drena el poll en curso y sus trabajos activos durante un plazo acotado. `ANALYSIS_JOB_SHUTDOWN_GRACE_MS` default es timeout HTTP Sandbox +10 s (40 s con timeout 30 s), debe quedar al menos 5 s sobre el timeout y por debajo del lease; coordinarlo con el plazo de terminación del runtime. Si vence, la API cierra y sale no-cero; no marca/reencola jobs ni libera leases manualmente. El fencing impide que un worker obsoleto escriba tras el reclaim cuando venza el lease. No sustituye prueba de SIGTERM en staging.
- El payload interno no transporta URL, correo ni secreto; solo identidad del job/lease. Entrada original hasta 64 KiB se cifra con AES-256-GCM, AAD `userId/localDate/attemptId`, y se descifra exclusivamente en el worker. TTL 366 días desde el intento más reciente del documento diario está aprobado para el baseline; ADR-0008 detalla la ventana móvil de métricas. No es decisión legal de retención productiva.
- La suite de migración 004 actualiza el validador, crea índice de reclamación y migra intentos existentes: `completed`/`inconclusive`→job completado, `failed`/`validation_failed`→dead, `received`/`processing` con input→queued; sin input en un estado activo se vuelve `inconclusive` con `input_unavailable` y job dead. Es forward-only y requiere respaldo/ensayo staging antes de producción.

## Sandbox y reintento idempotente

El Sandbox deduplica llamadas activas y conserva resultados locales por `attemptId` durante 10 minutos; una misma identidad con URL distinta genera conflicto. La cola interna del pool de navegador es finita (`maxConcurrency * 2`), rechaza saturación con HTTP 503 y `Retry-After: 1`; el número de resultados cacheados se limita a 5,000 y vence a los 10 minutos. Esto reduce trabajo duplicado tras timeout mientras el mismo Sandbox sigue activo, pero **no es idempotencia distribuida** entre réplicas ni cancela una navegación Playwright al abortar el fetch.

## Evidencia y límites pendientes

Runbook operativo del snapshot: [`docs/operations/durable-analysis-queue.md`](../operations/durable-analysis-queue.md).

- La implementación elimina `setImmediate` del request HTTP y añade polling Mongo, lease/fencing, backoff/reintento, auditoría terminal y drain acotado en shutdown; las pruebas unitarias cubren drain normal, claim concurrente al shutdown y timeout con lease recuperable. La API emite snapshots JSON de baja cardinalidad con conteos de cola, leases, reintentos, dead jobs, antigüedad y carga del worker, sin PII/IDs y sin ruta pública.
- Pruebas de integración requieren MongoDB 8 desechable: admisión+claim, no doble claim bajo lease vigente, recuperación por vencimiento, fencing, completado terminal, flujo HTTP API→worker→Sandbox y lectura de historial sin filtrar metadatos internos. Un harness separado con dos procesos API probó drain por SIGTERM y reclaim tras SIGKILL/lease vencido; sigue sin equivalente en staging.
- Sandbox prueba deduplicación, URL conflictiva, cola finita y HTTP 503 de backpressure. Estas pruebas no sustituyen pruebas de carga, red egress o cancelación de Chromium.
- El cap global durable ya usa singleton Mongo + transacción para contar jobs pendientes en la misma admisión/cuota (ADR-0005 en Context y ADR-0007 técnico, migración forward-only 005). Se validó en replica set desechable con dos clientes; `ANALYSIS_JOB_MAX_PENDING` del entorno local no es sizing de producción. Faltan calibración de carga, alertas y ensayo de saturación en staging.
- La instrumentación de snapshots existe, pero faltan sink persistente, thresholds/alertas aprobados, reproceso operacional explícito, validación de explain bajo volumen representativo, prueba de caída/reinicio completa y staging con varios procesos. El snapshot es una consulta agregada por intervalo configurable (default 60 s), no una garantía de observabilidad continua.
- La evidencia API/Mongo/Sandbox de procesamiento durable usa Sandbox sintético/fake. Por separado, el contexto Playwright real se probó con certificado autofirmado local y TLS estricto; esto no certifica integración del pool productivo, aislamiento de red, egress, DNS rebinding ni cancelación segura.
- El proveedor cloud, restore administrado, SLO/RTO/RPO, secretos y operación productiva quedan como decisiones G0/G4.
