# ADR-0005: Capacidad global transaccional de jobs

- **Estado:** Aprobada por el usuario; implementación local verificada en MongoDB desechable
- **Fecha:** 2026-11-03
- **Contexto:** La cuota por usuario y la concurrencia por réplica no acotan el número total de análisis pendientes. Un conteo previo o un semáforo local tiene carrera multi-réplica.
- **Decisión:** Mongo singleton `analysis_queue_capacity` mantiene `pendingCount/maxPending`. Transacciones admiten slot, cuota diaria y job juntos; transiciones terminales fenced y agotamiento de lease liberan un slot; retry/claim conservan el contador. El cap se configura como `ANALYSIS_JOB_MAX_PENDING` y cada API verifica el valor sembrado.
- **Retención:** `historyPurgeAt` conserva el vencimiento original. Documentos con jobs `queued|leased` omiten temporalmente `purgeAt` y lo restauran a la fecha original al terminalizar el último job.
- **Implementación:** Migración forward-only 005; detalles en [`ADR-0007 de decisiones técnicas`](../../docs/decisions/ADR-0007-global-analysis-queue-capacity.md).
- **Evidencia y límites:** Suite MongoDB 8.0.34 desechable como replica set valida admisión con dos clientes, full capacity, terminalización, migración 005 desde strict 003/idempotencia, TTL y dump/restore. No prueba carga multiproceso en staging, drift operacional productivo, presupuesto ni sizing; `1000` es solo default local. No certificar producción.
