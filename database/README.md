# Base de datos y modelado

## Fuente de patrones

- [`modeling/access-patterns.csv`](modeling/access-patterns.csv) es la tabla de patrones de acceso del ejercicio.
- [`modeling/query-catalog.md`](modeling/query-catalog.md) ofrece una guía de navegación; el CSV conserva los datos tabulares.

## Estado BDaaS

El usuario confirmó MongoDB como motor de esta actividad, independiente de la propuesta original en PostgreSQL. El esquema base aprobado se documenta en `modeling/logical-model.md` y `modeling/schema-proposal.md`; la representación física inicial está en `schema/collection-validators.js` y el bootstrap en `migrations/001_create_mongodb_schema.js`.

Baseline de validación: MongoDB Community Server 8.0.x, último parche disponible, autogestionado y sin sharding para el ejercicio. El bootstrap se preparó pero **no se ha ejecutado**. Los casos de validación están en `schema/validation-cases.md`; no afirmar que los validadores o índices fueron comprobados hasta correrlos en un servidor 8.0.x de prueba.
