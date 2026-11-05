# Plan de validación MongoDB para EnlaceSeguro

**Estado:** migraciones forward-only 002–005, smoke, matriz, explain, TTL, integración concurrente y backup/restore lógico ejecutados en MongoDB 8.0.34 desechable; comportamiento fail-closed ante estado parcial comprobado y runbook documentado. Backup/restore administrado y validación en staging siguen pendientes.
**Regla de seguridad:** no ejecutar el bootstrap ni casos de escritura contra bases de datos del usuario o con datos existentes.

## Última ejecución integral (2026-11-04)

- `bash database/tests/run-mongodb-suite.sh` terminó con código 0 en MongoDB 8.0.34 replica set desechable (`--rm`, sin volumen, puerto loopback).
- Pasaron cuatro archivos de integración API/DB, migraciones 001–005 e idempotencia/upgrade desde strict 003, 55 aserciones de matriz, 22 smoke, explain P4/P5/A1/A2/A3, TTL eventual y dump/restore lógico a una base hermana. El restore conservó conteos y los índices críticos comprobados por el runner.
- El cleanup eliminó el contenedor. No se usó base persistente ni información de usuario.
- Esto no verifica backups administrados/PITR, restore en staging, continuidad multi-réplica, rendimiento de producción ni recuperación operacional.

## Baseline inspeccionado

`database/migrations/001_create_mongodb_schema.js` exige una base nombrada, rechaza bases de sistema y se detiene si ya encuentra colecciones. Crea cinco colecciones (`users`, `daily_analyses`, `reputation_cache`, `security_audit_events`, `refresh_tokens`) y sus índices/validadores secuencialmente. Si se interrumpe, puede dejar estado parcial que no se reanuda con una segunda ejecución normal. No agregar borrado automático como recuperación.

La máquina de desarrollo tiene `mongosh` y Docker. Para el smoke se inició Docker Desktop y se creó un contenedor `--rm`, sin volumen y enlazado a loopback, que luego se eliminó. No se conectó ni modificó ninguna base persistente.

## Secuencia segura

1. Crear harness dedicado de integración que solo acepte URI de prueba y nombre de DB efímero permitido; fallar antes de conectar si faltan marcadores de entorno de test. No reutilizar `.env` de aplicación.
2. Definir y probar procedimiento de bootstrap desde cero y recuperación manual/incremental para fallo intermedio. Capturar versión, colecciones, validadores e índices antes/después. El runner desechable ahora prueba fail-closed ante bootstrap parcial; consultar el runbook antes de operar en cualquier base persistente.
3. Ejecutar `database/tests/mongodb-smoke-tests.js`: impone prefijo `enlaceseguro_test_` y versión 8.0.x; cubre cinco colecciones, validadores, email/admin/daily/global attemptId, máximo de intentos, índices TTL y limitación multikey intradocumento.
4. Completar la matriz de `schema/validation-cases.md` por colección: propiedades adicionales, enums, tamaños/topes y restricciones de tipos. El smoke no sustituye la matriz.
5. Validar unicidad y comportamiento que JSON Schema no garantiza: token y caché; el duplicado intradocumento multikey debe protegerse en repositorio/backend.
6. Probar integración API↔Mongo, cuota concurrente (quinto/sexto intento), idempotencia, autorización/propiedad, transiciones, consultas y paginación.
7. Sembrar datos sintéticos representativos: al menos 365 días, 0–5 intentos/día y múltiples usuarios. Medir P4/P5/A1/A2/cuota con `explain('executionStats')`; guardar `winningPlan`, keys/docs examinados, sort/spill y latencias.
8. Probar TTL como eventual y verificar filtros de expiración en lectura. Probar por separado almacenamiento y purga de capturas; TTL Mongo no borra objetos externos.
9. Ensayar backup y restore con datos de prueba antes de aceptar el procedimiento operativo.

## Ejecución preliminar confirmada (2026-11-03)

- MongoDB `8.0.34` efímero, contenedor `--rm` sin volumen y puerto enlazado solo a `127.0.0.1`; DB `enlaceseguro_test_g0` nueva.
- El bootstrap creó las cinco colecciones, validadores e índices y rechazó una inserción inválida.
- La ejecución directa del smoke test pasó 21 assertions para las cinco colecciones, validadores, índices únicos/TTL, topes e intento ID global. También confirmó que el índice multikey permite repetidos dentro de un mismo documento; debe protegerlo la API.
- `database/tests/run-mongodb-suite.sh` crea una instancia MongoDB temporal sin volumen y enlazada a loopback; el trap elimina el contenedor. La suite incluye integración, explain, matriz, smoke, TTL y restauración lógica.
- La integración API comprobó 20 admisiones concurrentes: exactamente cinco se aceptan y 15 reciben cuota, sin excepción del driver; además cubre duplicado de `attemptId`, sexto intento, duplicado global, actualización y lectura del intento.
- El primer intento del test reveló la causa raíz: MongoDB 8.0.34 rechaza `$expr` dentro del filtro de `findOneAndUpdate` con `upsert` (`QueryFeatureNotAllowed`, código 224). Se reemplazó por actualización condicional en pipeline dentro de una operación atómica; el filtro no usa `$expr`.
- El error inicial de `$expr` fue corregido y su regresión es parte de la integración del repositorio.

## Evidencia integral desechable (2026-11-03)

- Comando: `MONGO_EXPLAIN_REPORT_PATH=database/operations/validation-results/mongodb-explain-2026-11-03.json ./database/tests/run-mongodb-suite.sh`.
- Entorno: MongoDB 8.0.34, contenedor `--rm`, sin volumen, puerto aleatorio enlazado a `127.0.0.1`, DB `enlaceseguro_test_20261103114919_73606` más DB hermana temporal `_partial` para simular estado interrumpido. Se verificó la salida del trap; no se usaron bases persistentes.
- Integración API↔Mongo: 20 admisiones simultáneas desde DB vacía; cinco aceptadas, 15 por cuota y ninguna excepción de driver. También duplicado intradía/global, sexto intento, actualización, lectura y cursor P4 con páginas de dos elementos sobre 11 intentos en tres días: sin omisiones/duplicados y orden estable.
- Validador: 51 casos adicionales dirigidos a restricciones por colección, incluida aceptación del sobre cifrado de hasta 64 KiB, estados/lease de job y rechazo de sobre malformado/extra properties; smoke aparte con 21 comprobaciones. No cubre cada combinación ni intenta un documento cercano al máximo BSON de 16 MiB.
- TTL `daily_analyses`: con el monitor pausado, el documento pasó `purgeAt` y siguió almacenado; `MongoDailyAnalysisRepository.listUserAttempts()` lo excluyó. Al reactivar TTL, Mongo lo eliminó tras ~55.5 s. Esto verifica eventualidad para el índice diario, no purga de capturas externas ni cada índice TTL.
- Explain sintético: 12 usuarios, 365 días, 4,380 documentos diarios/13,140 intentos y 1,460 eventos de auditoría. Evidencia completa (incluidos winning plans) en `database/operations/validation-results/mongodb-explain-2026-11-03.json`.
  - P4 primera y siguiente página: 365 keys/docs examinados para los 365 documentos diarios del usuario y `IXSCAN uq_daily_analyses_user_date`; el `$sort` permanece después de `$unwind`/proyección, sin que el índice del documento padre elimine el ordenamiento.
  - P5 propio/global: 1 key/doc; ambos usaron `uq_daily_analyses_attempt_id` (en P5 propio, Mongo eligió el índice multikey global y filtró propietario/fecha en FETCH).
  - A1/A2 auditoría: 51 keys/docs para página de 51; usaron los índices de fecha y tipo+fecha respectivamente.
  - A3 métricas: 2,220 keys/docs del rango con `ix_daily_analyses_local_date`.
  - El explain reporta la presencia del stage `$sort` de P4; no se registraron contadores explícitos `usedDisk`/`spills`, por lo que no se afirma ausencia de spill.
- El runner simula una base hermana con solo `users` más sentinel; el bootstrap rechaza la ejecución y preserva la colección/índice/documento. Runbook: `database/operations/partial-bootstrap-recovery-runbook.md`. Esto comprueba la negativa segura, no es una recuperación incremental.
- Backup/restore desechable: el runner hace `mongodump --archive --gzip` de las cinco colecciones, restaura con `mongorestore` a una DB hermana distinta, compara conteos y verifica conjunto de colecciones e índices únicos/TTL clave; los cinco conjuntos de datos se restauraron con cero fallos. No demuestra backup administrado del proveedor, PITR, cifrado/retención ni restore de staging.
- Sigue pendiente migración recuperable/forward-only, restore administrado y pruebas en staging, pruebas de otros repositorios API, autorización de pertenencia/RBAC y TTL para otras colecciones. P4 aún no tiene prueba E2E del handler HTTP.

## Criterio de aceptación

Informe reproducible con versión MongoDB, harness/URI de prueba, fixtures, comandos, resultados esperados/observados y salida de explain. No se usa ni borra información real; la decisión de ejecución del bootstrap sobre cualquier ambiente persistente requiere revisión humana aparte.
