# ADR-0007: Capacidad global transaccional de jobs de análisis

- **Estado:** Aprobado por el usuario e implementado; suite MongoDB desechable pasó el 2026-11-04. Stress multiproceso/staging y sizing productivo pendientes.
- **Fecha:** 2026-11-04
- **Contexto:** G1-JOBS/G2-BASE

## Contexto

El límite de cinco análisis diarios limita a cada usuario, no la cola agregada. `ANALYSIS_JOB_CONCURRENCY` limita consumo por réplica, pero distintas réplicas pueden admitir trabajo concurrentemente y Mongo guarda jobs embebidos en documentos diarios distintos. Un `countDocuments()` antes de insertar, semáforo local o conteo por réplica tiene una carrera y no constituye capacidad global.

## Decisión

- Mantener los jobs embebidos en `daily_analyses.attempts`; agregar singleton `analysis_queue_capacity` (`_id: "global"`, `pendingCount`, `maxPending`, `updatedAt`).
- `pendingCount` equivale a todos los jobs en estado `queued` o `leased`, incluidos reintentos diferidos y trabajos en ejecución. `completed` y `dead` no cuentan.
- Una transacción Mongo reserva un slot con CAS solo si `pendingCount < maxPending`, y admite el intento dentro del mismo callback transaccional que aplica la cuota diaria y escribe el job. Si capacidad o cuota rechazan la admisión, se aborta la transacción completa: no queda slot fantasma ni consume cuota.
- Claim y reintento (leased→queued) mantienen el contador. Transiciones fenced a `completed`/`dead` liberan exactamente un slot en la misma transacción que cambia el job; workers stale no decrementan. El lease agotado terminaliza y libera también de forma transaccional.
- La sobrecarga de cola devuelve HTTP 503 `ANALYSIS_QUEUE_CAPACITY_EXCEEDED`, `Retry-After: 5`, sin `attemptId` ni cuota consumida. Fallo/configuración ausente del registro de capacidad falla cerrado como servicio temporalmente no disponible.
- Se usa `ANALYSIS_JOB_MAX_PENDING`. En desarrollo y pruebas el fallback es 1000 para poder ejecutar el stack local; producción debe declararlo explícitamente. La migración 005 siembra ese valor y startup verifica coincidencia exacta. Es una capacidad inicial configurable, no un sizing productivo: G0 debe validarla con carga, latencia, presupuesto y capacidad Sandbox antes de staging.
- La migración forward-only 005 calcula jobs activos y falla sin reducir/eliminar trabajo si exceden el cap. Pausa API/worker durante cutover; preserva `purgeAt` original en `historyPurgeAt`, omite temporalmente el TTL efectivo en documentos activos y crea el singleton. Si ya existe, un drift contra la agregación no se repara automáticamente: falla y requiere runbook de reconciliación en ventana controlada.
- MongoDB debe operar como replica set o clúster compatible con transacciones. Startup conectado verifica `hello.setName`/primary; la suite local usa un replica set MongoDB 8.0.34 de un miembro. Las operaciones de migración se aplican explícitamente, no desde la API.

## TTL y retención

La cola no debe perder jobs ni dejar capacidad ocupada para siempre si un documento diario expira antes de terminar. La 005 preserva el valor TTL actual en un campo requerido `historyPurgeAt`; mientras el documento contenga al menos un job `queued|leased`, omite `purgeAt` (el índice TTL ignora documentos sin fecha). La última transición terminal restaura `purgeAt` a `historyPurgeAt` y libera el slot en la misma transacción. Así no se purgan análisis encolados y el período TTL histórico de 366 días no se reinicia ni extiende al completar; el deadline del bucket se calcula con el intento más reciente. La semántica/actualización de la retención se define en ADR-0008. Los queries de usuario/admin filtran `historyPurgeAt` para no exponer historial retenido únicamente porque tiene trabajo activo; el worker puede reclamar cualquier job activo independientemente de la expiración histórica.

## Operación de la transacción

- El intento/UUID, timestamps y sobre cifrado se generan una sola vez fuera de `withTransaction`, y se reutilizan si el driver reintenta el callback.
- Solo errores transitorios compatibles con retry se reintentan por el driver; una respuesta no admitida se produce después del abort.
- Una escritura terminal idempotente requiere `attemptId`, `state` pendiente, estado de análisis esperado y `leaseToken` vigente, además de `pendingCount > 0` en el singleton.
- `maxPending` es metadato de capacidad. Cambiarlo en staging/producción requiere proceso operacional/migración documentada; no se escribe dinámicamente desde cada réplica.

## Alternativas

1. **Conteo previo/per-réplica:** rechazada por sobrepaso bajo concurrencia entre usuarios o réplicas.
2. **Colección/cola managed separada:** se difiere; requiere proveedor aprobado y altera la decisión vigente de job embebido.
3. **Contador singleton + transacción Mongo:** elegida por permitir que la reserva, cuota y job tengan una sola frontera atómica multi-réplica.

## Evidencia requerida

- En Mongo replica set desechable: con `maxPending=2`, dos clientes/repo independientes y varias admisiones concurrentes de usuarios distintos, exactamente dos admisiones y las excedentes 503; contador y jobs pendientes deben quedar en 2. La prueba local automatizada usa tres contendientes; una prueba de estrés multiproceso mayor sigue requerida antes de staging.
- Lleno no consume la cuota diaria; error de cuota revierte el slot; abort/retry de transacción no duplica slot ni job.
- Completion/failure/lease exhaustion concurrentes decrementan una sola vez; retry y reclamación no decrementan; token stale no decrementa; contador nunca negativo.
- Migración 005 idempotente, cuenta jobs legacy, falla sin mutación ante cola sobre cap, protege TTL de pendientes y preserva `historyPurgeAt`; startup falla con migración ausente, drift o límite diferente.
- La suite en Mongo standalone ya no es soporte válido: el runner debe comprobar elect primary y transacciones. Evidencia del runner no sustituye prueba multiproceso en staging.

## Límites

El singleton serializa admisiones terminales según la carga y puede ser hot document. Medir contención/latencia antes de escalar el cap. La cola completa, métricas/alertas, sizing definitivo, despliegue gestionado, PITR y restore productivo siguen pendientes. No certificar producción por las pruebas locales.
