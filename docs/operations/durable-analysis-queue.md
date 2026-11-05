# Operación de cola durable de análisis

**Estado:** instrumentación local; thresholds, alertas y staging siguen pendientes.

## Señales disponibles

Cada réplica API emite `analysis_queue_snapshot` en stdout al iniciar y luego al intervalo configurado. Contiene capacidad/pendientes globales, jobs `queued` y `leased`, leases vencidas, jobs en reintento, jobs `dead`, edad del pendiente más antiguo, carga en vuelo y fallos consecutivos de polling. No contiene identificadores, URL, correo ni secretos.

El contador singleton `pendingCount` es la fuente exacta de admisión. El desglose agregado permite detectar divergencia operativa; una discrepancia requiere detener admisiones antes de intentar una corrección manual. La consulta usa estados indexados y corre como máximo una vez por intervalo.

## Diagnóstico y recuperación

1. Correlaciona hora/evento entre réplicas; distingue `pollFailureCount` de fallos de procesamiento. Revisa `/health`, conectividad Mongo/Sandbox y disponibilidad del servicio.
2. Si la cola aumenta, compara `pendingCount`, `queuedCount`, `leasedCount`, `oldestPendingAgeMs` e `inFlightCount` por réplica. No aumentes concurrencia ni `maxPending` sin medir Sandbox, Mongo y límites aprobados.
3. Un lease vencido puede ser reclamado automáticamente por otro worker. Verifica que el nuevo intento progrese; fencing protege frente a escrituras tardías del proceso anterior.
4. Jobs `dead` son terminales y no se reencolan automáticamente. No edites `daily_analyses` ni `analysis_queue_capacity` directamente, no borres lease/token y no alteres el contador. Preserva evidencia y abre una tarea de reproceso controlado con auditoría antes de reintentar.
5. Si el servicio no se recupera, drena o escala según [`staging-release-runbook.md`](./staging-release-runbook.md) una vez adaptado y aprobado; monitorea el drain. Tras SIGKILL, espera lease expiry y confirma recuperación. Nunca reutilices tokens de fencing.

## Alertas y límites

No hay umbrales configurados todavía: faltan carga objetivo, SLO, presupuesto y sink/retención de logs. Al elegir observabilidad en G0/G4, configurar alertas para ocupación sostenida, edad del job, lease vencida, jobs `dead`, errores de polling y divergencia de conteos; validar ruido y tiempo de detección en staging. El evento JSON local es instrumentación, no una alerta ni un SLO.

No se implementa reproceso manual en esta fase. No exponer snapshots en `/health`, `/admin/metrics` ni endpoint público: health permanece para disponibilidad básica y la consola conserva su contrato aprobado.
