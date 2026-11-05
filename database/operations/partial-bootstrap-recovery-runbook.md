# Runbook: recuperación de bootstrap MongoDB parcial

**Estado:** procedimiento de decisión documentado; rechazo y preservación de estado comprobados en MongoDB 8.0.34 efímero. No es autorización para intervenir una base persistente.

## Invariante

`001_create_mongodb_schema.js` crea cinco colecciones/índices en secuencia y **no es reanudable**. Si encuentra alguna colección objetivo, rechaza toda ejecución antes de modificarla. No borrar colecciones ni base de datos automáticamente para “reintentar”.

## Respuesta inicial (cualquier entorno)

1. Detener jobs/escrituras que dependan de las colecciones afectadas; no repetir el bootstrap.
2. Confirmar usuario, cluster/host y nombre exacto de base antes de cualquier comando de escritura.
3. Capturar versión MongoDB, `getCollectionNames()`, `getCollectionInfos()` (validadores/validationLevel/action), `getIndexes()` por colección y conteos/documentos afectados. Guardar salida con acceso restringido; no exportar credenciales ni datos personales a tickets.
4. Crear y verificar backup/snapshot consistente antes de intentar cambios. Registrar método, timestamp y restore point. La suite valida un `mongodump`/`mongorestore` lógico sobre DB desechable; no sustituye un restore point-in-time/snapshot del proveedor ni restore en staging.
5. Determinar si el estado parcial contiene solo colecciones vacías creadas por el bootstrap o datos/índices/validadores preexistentes. Si no se puede demostrarlo, tratarlo como datos persistentes valiosos y detener la intervención.

## Base desechable de prueba

- Si no se necesita conservarla, una persona operadora puede descartar explícitamente **solo la base de prueba identificada** y crear una nueva con nombre `enlaceseguro_test_*`; el runner no hace ese borrado automáticamente.
- Para probar el rechazo parcial, `run-mongodb-suite.sh` crea una base hermana desechable con `users` y un sentinel. El bootstrap debe rechazar el estado y preservar colección/índice/documento; luego el contenedor temporal entero se elimina por `--rm`.
- Nunca reutilizar la base parcial para integración normal, pues el runner espera un target vacío.

## Base persistente/dev compartida

- No ejecutar `dropDatabase`, `drop`, `collMod`, `createIndex` ni el bootstrap antes de una revisión humana del snapshot, contenido, validadores, índices y dependencias.
- Redactar una **nueva migración forward-only**, no editar el bootstrap: precondiciones por colección/índice, comprobaciones de documentos, operaciones idempotentes por paso y detección de colisiones únicas; registrar checkpoints/resultados y cómo abortar sin ampliar daño.
- Probarla en staging desde estados representativos (vacío, parcial, completa) y restaurar el backup de prueba. Revisar compatibilidad de validador y ventana de mantenimiento.
- Obtener aprobación explícita del responsable de datos/servicio, programar ventana y monitorear. Si precondiciones difieren, abortar sin mutación y volver a inspección.

## Evidencia y límites

- Comprobación parcial: ver `database/tests/run-mongodb-suite.sh` y `database/operations/mongodb-production-validation-plan.md`.
- `run-mongodb-suite.sh` conserva un dump gzip dentro del contenedor efímero, restaura a una base hermana distinta y compara conteos de las cinco colecciones e índices únicos/TTL críticos. Esto solo comprueba la herramienta y el formato lógico con datos sintéticos en MongoDB Community 8.0.34.
- El test solo demuestra que el bootstrap se niega y preserva el sentinel cuando existe `users`; no simula cada punto posible de interrupción ni constituye una migración de recuperación.
- Backup/restore administrado, cifrado/retención del backup, restauración de staging con TLS/credenciales, migración incremental recuperable y ejecución en staging siguen siendo puertas antes de cualquier base persistente/productiva.
