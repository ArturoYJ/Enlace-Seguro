# Base de datos y modelado

## Fuente de patrones

- [`modeling/access-patterns.csv`](modeling/access-patterns.csv) es la tabla de patrones de acceso del ejercicio.
- [`modeling/query-catalog.md`](modeling/query-catalog.md) ofrece una guía de navegación; el CSV conserva los datos tabulares.

## Estado BDaaS

El usuario confirmó MongoDB como motor de esta actividad, independiente de la propuesta original en PostgreSQL. El esquema base aprobado se documenta en `modeling/logical-model.md` y `modeling/schema-proposal.md`; la representación física inicial está en `schema/collection-validators.js` y el bootstrap en `migrations/001_create_mongodb_schema.js`.

Baseline local: MongoDB Community Server 8.0.x en replica set desechable para transacciones. La última ejecución integral de `tests/run-mongodb-suite.sh` se revalidó el 2026-11-04 con MongoDB 8.0.34: migraciones 001–006, cuatro archivos de integración API/DB, 55 aserciones de matriz, 22 smoke, explain, TTL eventual y dump/restore lógico a una base hermana con conteos e índices críticos comprobados. La migración 006 y sus pruebas verifican la retención de 366 días y su idempotencia; la ventana móvil de métricas es `[ahora−365×24 h, ahora)`. El runner terminó correctamente y eliminó su contenedor efímero; no tocó bases persistentes. Esto verifica el harness local, no operación productiva. Backups administrados/PITR, migración y restore en staging y combinaciones fuera de la matriz siguen pendientes.

El plan y resultados están en [`operations/mongodb-production-validation-plan.md`](operations/mongodb-production-validation-plan.md). `tests/run-mongodb-suite.sh` crea un contenedor MongoDB 8.0.34 temporal, ejecuta integración API, explain, matriz de validadores, smoke y TTL, y lo elimina al terminar.
