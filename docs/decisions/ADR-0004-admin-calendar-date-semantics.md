# ADR-0004: Semántica de fechas civiles en filtros administrativos

- **Estado:** Aprobada por el usuario
- **Fecha:** 2026-11-03
- **Contexto:** `/admin/metrics` agregaba por `localDate` de México, pero `/admin/audit-events` interpretaba las fechas de consulta en UTC. Un mismo selector daba períodos distintos entre pantallas.
- **Decisión:** Ambos endpoints usan fechas civiles inclusivas de `America/Mexico_City`. Auditoría convierte el inicio al comienzo del primer día y el fin al comienzo del día siguiente exclusivo, filtrando instantes `occurredAt` UTC sin modificar los valores almacenados.
- **Implementación:** `api/src/infrastructure/database/mongo/MongoSecurityAuditRepository.ts`; contrato en `api/openapi.yaml`; integración por Fastify+Mongo en `api/tests/integration/AnalysisFlowHttp.integration.test.ts`.
- **Evidencia y límites:** La integración prueba límites de inicio, fin, medianoche local y proximidad a medianoche UTC en MongoDB 8.0.34 desechable. No prueba despliegue/staging. Ver `docs/architecture/admin-console-readiness.md`.
