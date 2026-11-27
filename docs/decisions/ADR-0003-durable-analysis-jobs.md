# ADR-0003: Cola durable embebida para análisis

- **Estado:** Aprobado por el usuario e implementado localmente; validación de G2 en curso.
- **Fecha:** 2026-11-03
- **Contexto:** `POST /analyses` antes despachaba con `setImmediate`, lo que podía perder trabajo tras reinicio y enviaba la URL cruda directamente al ejecutor. Mongo ya registra atómicamente admisión y cuota en `daily_analyses.attempts`; la entrada original ahora se cifra hasta 64 KiB.
- **Decisión:** guardar metadatos de job en el mismo subdocumento del intento y consumir por polling Mongo con lease, token de fencing, reintentos acotados y backoff. Mantener el payload de job opaco; descifrar URL dentro del worker API.
- **Motivo:** el job embebido conserva relación con su intento; una transacción replica-set incluye ahora también la reserva del contador global, cuota y admisión sin introducir un outbox/cola cloud. Leases expiran tras caída; fencing impide que un trabajador tardío guarde un resultado después de que otro haya recuperado el job.
- **Alternativas:** outbox/colección adicional con transacción (más piezas y despliegue); cola cloud administrada (bloqueada por decisión de proveedor, no aprobada aún).
- **Consecuencias:** se requieren migraciones forward-only 004 (jobs) y 005 (capacidad/TTL); cada réplica aplica límites propios de worker; la cola pendiente ahora tiene cap global transaccional por singleton Mongo (ADR-0005 en Context, ADR-0007 técnico); staging y stress multiproceso siguen pendientes. Sandbox devuelve backpressure por capacidad local y deduplica idempotencia dentro de proceso, pero no cancela trabajo Chromium ni comparte la caché entre réplicas.
- **Config inicial:** concurrencia 2 por API replica; poll 1,000 ms; lease 180,000 ms y al menos 10,000 ms sobre timeout HTTP Sandbox; drain de shutdown acotado al timeout HTTP +10,000 ms (40,000 ms con timeout default), al menos +5,000 ms y menor que lease; máximo 4 intentos (configurable 1–10); backoff 1/2/4… hasta 60 s. Si el drain expira, el proceso cierra no-cero y el job conserva lease para recuperación por expiración/fencing; no se reencola ni se marca fallido durante SIGTERM.
- **Evidencia requerida antes de producción:** aplicar 004/005 en staging tras backup; restaurar; simular reinicio y expiración de lease con varios workers; probar fallas 429/5xx/timeout, fencing y deduplicación, carga/saturación y logs sin datos sensibles; validar índices y alertas/runbooks. Las transacciones requieren replica set o clúster compatible. No certificar egress/aislamiento, capturas, ni Chromium real a partir de tests sintéticos.
- **Privacidad:** la URL queda cifrada en Mongo con clave de aplicación y TTL baseline aprobado de 366 días para `daily_analyses`. Gestor/rotación/recuperación de clave, retención productiva, borrado de cuenta y revisión legal de transferencias siguen pendientes.

## Referencias

- `docs/architecture/durable-analysis-processing.md`
- `database/migrations/004_durable_analysis_jobs.js`
- `api/src/infrastructure/workers/AnalysisJobWorker.ts`
